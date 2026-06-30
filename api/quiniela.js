const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Calcula puntos de un pick vs resultado real
// 4 pts = exacto (3 resultado + 1 ganador)
// 1 pt  = ganador/empate correcto
// 0 pts = fallo
function calcPts(pick, real) {
  if (!pick || real.s1 === undefined) return 0;
  if (pick.s1 === real.s1 && pick.s2 === real.s2) return 4;
  const realWinner = real.s1 === real.s2 ? 'E' : (real.s1 > real.s2 ? '1' : '2');
  const pickWinner = pick.s1 === pick.s2 ? 'E' : (pick.s1 > pick.s2 ? '1' : '2');
  if (pickWinner === realWinner) return 1;
  return 0;
}

// Recalcula la tabla completa desde picks + results
async function recalcTabla(results, picks, tablaActual) {
  const tabla = (tablaActual || []).map(p => ({ ...p, pts: 0 }));
  const doneResults = Object.entries(results).filter(([, r]) => r.done);
  for (const entry of tabla) {
    const playerPicks = picks[entry.name];
    if (!playerPicks) continue;
    let pts = 0;
    for (const [matchId, real] of doneResults) {
      pts += calcPts(playerPicks.picks[matchId], real);
    }
    entry.pts = pts;
  }
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
      const data = await redis.get('quiniela:results') || {};
      return res.status(200).json(data);
    }
    if (req.method === 'GET' && action === 'tabla') {
      const data = await redis.get('quiniela:tabla') || null;
      return res.status(200).json(data);
    }
    if (req.method === 'GET' && action === 'previas') {
      const data = await redis.get('quiniela:previas') || [];
      return res.status(200).json(data);
    }

    // Cuando Henry mete un resultado → guarda + recalcula tabla automáticamente
    if (req.method === 'POST' && action === 'result') {
      const { id, s1, s2, done } = req.body;
      const [results, picks, tablaActual] = await Promise.all([
        redis.get('quiniela:results'),
        redis.get('quiniela:picks'),
        redis.get('quiniela:tabla'),
      ]);
      const resultsUpd = results || {};
      resultsUpd[id] = { s1, s2, done };
      const tablaUpd = picks && done
        ? await recalcTabla(resultsUpd, picks, tablaActual)
        : tablaActual;
      await Promise.all([
        redis.set('quiniela:results', resultsUpd),
        picks && done ? redis.set('quiniela:tabla', tablaUpd) : Promise.resolve(),
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
    if (req.method === 'GET' && action === 'picks') {
      const data = await redis.get('quiniela:picks') || {};
      return res.status(200).json(data);
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
