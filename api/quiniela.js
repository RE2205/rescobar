const { Redis } = require('@upstash/redis');
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Partidos ya incluidos en la base de Henry (no recalcular)
// Se actualiza cada vez que Henry verifica manualmente
const BASELINE_MATCHES = ['m73','m76','m74','m75','m78','m77','m79','m80',
                          'm82','m81','m84','m83','m85','m88','m86','m87',
                          'm89','m90'];

const MATCH_ORDER = ['m73','m76','m74','m75','m78','m77','m79','m80',
                     'm82','m81','m84','m83','m85','m88','m86','m87',
                     'm89','m90','m91','m92','m93','m94','m95','m96'];

function calcPts(pick, real) {
  if (!pick || real.s1 === undefined) return 0;
  if (pick.s1 === real.s1 && pick.s2 === real.s2) return 4;
  const rw = real.s1 === real.s2 ? 'E' : (real.s1 > real.s2 ? '1' : '2');
  const pw = pick.s1 === pick.s2 ? 'E' : (pick.s1 > pick.s2 ? '1' : '2');
  return pw === rw ? 1 : 0;
}

async function recalcTabla(results, picks, tablaActual) {
  // Solo calcular partidos NUEVOS (no en baseline) que estén done o live
  const newMatches = MATCH_ORDER.filter(id =>
    !BASELINE_MATCHES.includes(id) && results[id] && (results[id].done || results[id].live)
  );
  const doneNew = newMatches.filter(id => results[id].done);

  const tabla = (tablaActual || []).map(p => {
    const playerPicks = (picks[p.name] || {}).picks || {};
    // base_pts = lo que Henry tiene guardado (fuente de verdad para partidos viejos)
    const basePts = p.base_pts !== undefined ? p.base_pts : p.pts;
    // Sumar solo los partidos nuevos
    const newPts = newMatches.reduce((sum, id) => sum + calcPts(playerPicks[id], results[id]), 0);
    const totalPts = basePts + newPts;

    // Racha: solo partidos done (baseline + nuevos)
    const allDone = [...BASELINE_MATCHES.filter(id => results[id]?.done), ...doneNew];
    let racha = 0;
    for (let i = allDone.length - 1; i >= 0; i--) {
      if (calcPts(playerPicks[allDone[i]], results[allDone[i]]) === 4) racha++;
      else break;
    }
    const last6 = allDone.slice(-6);
    const rachaArr = last6.map(id => {
      const pts = calcPts(playerPicks[id], results[id]);
      return pts === 4 ? 2 : pts === 1 ? 1 : 0;
    });
    while (rachaArr.length < 6) rachaArr.unshift(0);

    return { ...p, pts: totalPts, base_pts: basePts, racha: rachaArr, trend: String(racha) };
  });

  tabla.sort((a, b) => b.pts - a.pts);
  return tabla;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { action } = req.query;

  try {
    if (req.method === 'GET' && action === 'results')
      return res.status(200).json(await redis.get('quiniela:results') || {});
    if (req.method === 'GET' && action === 'tabla')
      return res.status(200).json(await redis.get('quiniela:tabla') || null);
    if (req.method === 'GET' && action === 'previas')
      return res.status(200).json(await redis.get('quiniela:previas') || []);
    if (req.method === 'GET' && action === 'picks')
      return res.status(200).json(await redis.get('quiniela:picks') || {});

    // Henry mete resultado → solo suma puntos del partido nuevo
    if (req.method === 'POST' && action === 'result') {
      const { id, s1, s2, done, live } = req.body;
      const [results, picks, tablaActual] = await Promise.all([
        redis.get('quiniela:results'),
        redis.get('quiniela:picks'),
        redis.get('quiniela:tabla'),
      ]);
      const resultsUpd = results || {};
      resultsUpd[id] = { s1, s2, done: !!done, live: !!live };
      const tablaUpd = picks ? await recalcTabla(resultsUpd, picks, tablaActual) : tablaActual;
      await Promise.all([
        redis.set('quiniela:results', resultsUpd),
        picks ? redis.set('quiniela:tabla', tablaUpd) : Promise.resolve(),
      ]);
      return res.status(200).json({ ok: true, tabla: tablaUpd });
    }

    if (req.method === 'POST' && action === 'tabla') {
      const { tabla } = req.body;
      // Al guardar tabla de Henry, fijar base_pts = pts actuales
      const tablaConBase = tabla.map(p => ({ ...p, base_pts: p.pts }));
      await redis.set('quiniela:tabla', tablaConBase);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'POST' && action === 'previa') {
      const { title, body, date } = req.body;
      const previas = await redis.get('quiniela:previas') || [];
      previas.unshift({ id: Date.now(), title, body, date });
      await redis.set('quiniela:previas', previas);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE' && action === 'previa') {
      const { id } = req.body;
      const previas = (await redis.get('quiniela:previas') || []).filter(p => p.id !== id);
      await redis.set('quiniela:previas', previas);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'POST' && action === 'picks') {
      const { picks } = req.body;
      await redis.set('quiniela:picks', picks);
      return res.status(200).json({ ok: true, participantes: Object.keys(picks).length });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
