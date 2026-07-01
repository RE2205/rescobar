const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function calcPts(pick, real) {
  if (!pick || real.s1 === undefined) return 0;
  if (pick.s1 === real.s1 && pick.s2 === real.s2) return 4;
  const rw = real.s1 === real.s2 ? 'E' : (real.s1 > real.s2 ? '1' : '2');
  const pw = pick.s1 === pick.s2 ? 'E' : (pick.s1 > pick.s2 ? '1' : '2');
  return pw === rw ? 1 : 0;
}

const MATCH_ORDER = ['m73','m76','m74','m75','m78','m77','m79','m80','m82','m81','m84','m83','m85','m88','m86','m87'];

async function recalcTabla(results, picks, tablaActual) {
  // Incluye partidos done Y live para puntos en tiempo real
  const activeResults = Object.entries(results).filter(([, r]) => r.done || r.live);
  const orderedActive = MATCH_ORDER
    .filter(id => results[id] && (results[id].done || results[id].live))
    .map(id => [id, results[id]]);

  const tabla = (tablaActual || []).map(p => {
    const playerPicks = (picks[p.name] || {}).picks || {};
    let pts = 0;
    orderedActive.forEach(([mid, real]) => { pts += calcPts(playerPicks[mid], real); });

    // Racha: exactos consecutivos desde el último partido done hacia atrás
    const doneOrdered = MATCH_ORDER.filter(id => results[id] && results[id].done);
    let racha = 0;
    for (let i = doneOrdered.length - 1; i >= 0; i--) {
      if (calcPts(playerPicks[doneOrdered[i]], results[doneOrdered[i]]) === 4) racha++;
      else break;
    }

    // Array últimos 6 para la barra visual
    const last6 = MATCH_ORDER.filter(id => results[id] && (results[id].done || results[id].live)).slice(-6);
    const rachaArr = last6.map(mid => {
      const p2 = calcPts(playerPicks[mid], results[mid]);
      return p2 === 4 ? 2 : (p2 === 1 ? 1 : 0);
    });
    while (rachaArr.length < 6) rachaArr.unshift(0);

    return { ...p, pts, racha: rachaArr, trend: String(racha) };
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
    if (req.method === 'GET' && action === 'results') {
      return res.status(200).json(await redis.get('quiniela:results') || {});
    }
    if (req.method === 'GET' && action === 'tabla') {
      return res.status(200).json(await redis.get('quiniela:tabla') || null);
    }
    if (req.method === 'GET' && action === 'previas') {
      return res.status(200).json(await redis.get('quiniela:previas') || []);
    }
    if (req.method === 'GET' && action === 'picks') {
      return res.status(200).json(await redis.get('quiniela:picks') || {});
    }

    // Henry mete gol o marca final → recalcula tabla automáticamente
    if (req.method === 'POST' && action === 'result') {
      const { id, s1, s2, done, live } = req.body;
      const [results, picks, tablaActual] = await Promise.all([
        redis.get('quiniela:results'),
        redis.get('quiniela:picks'),
        redis.get('quiniela:tabla'),
      ]);
      const resultsUpd = results || {};
      resultsUpd[id] = { s1, s2, done: !!done, live: !!live };
      const tablaUpd = picks
        ? await recalcTabla(resultsUpd, picks, tablaActual)
        : tablaActual;
      await Promise.all([
        redis.set('quiniela:results', resultsUpd),
        picks ? redis.set('quiniela:tabla', tablaUpd) : Promise.resolve(),
      ]);
      return res.status(200).json({ ok: true, tabla: tablaUpd });
    }

    if (req.method === 'POST' && action === 'tabla') {
      const { tabla } = req.body;
      await redis.set('quiniela:tabla', tabla);
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
