const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Puntos: exacto=4, ganador=1, fallo=0
function calcPts(ps1, ps2, rs1, rs2) {
  if (ps1 === rs1 && ps2 === rs2) return 4;
  const pRes = ps1 > ps2 ? 'W' : ps1 === ps2 ? 'D' : 'L';
  const rRes = rs1 > rs2 ? 'W' : rs1 === rs2 ? 'D' : 'L';
  return pRes === rRes ? 1 : 0;
}

function calcTabla(picks, results) {
  const scores = {};
  const rachas = {};

  // All participant names
  const names = Object.keys(picks);

  // Init
  names.forEach(name => {
    scores[name] = 0;
    rachas[name] = [];
  });

  // Sort matches by id
  const matchIds = Object.keys(results).sort();

  matchIds.forEach(mid => {
    const r = results[mid];
    if (!r || !r.done) return;

    names.forEach(name => {
      const p = picks[name] && picks[name][mid];
      if (p && typeof p.s1 === 'number') {
        const pts = calcPts(p.s1, p.s2, r.s1, r.s2);
        scores[name] += pts;
        // racha: 2=exacto, 1=ganador, 0=fallo
        rachas[name].push(pts > 1 ? 2 : pts > 0 ? 1 : 0);
      }
    });
  });

  // Build tabla sorted by pts
  const tabla = names.map(name => ({
    name,
    pts: scores[name],
    racha: rachas[name].slice(-6), // last 6
  })).sort((a, b) => b.pts - a.pts);

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

    // POST resultado → recalcula tabla automáticamente
    if (req.method === 'POST' && action === 'result') {
      const { id, s1, s2, done } = req.body;
      const results = await redis.get('quiniela:results') || {};
      results[id] = { s1, s2, done };
      await redis.set('quiniela:results', results);

      // Recalcular tabla si el partido está finalizado
      if (done) {
        const picks = await redis.get('quiniela:picks') || {};
        if (Object.keys(picks).length > 0) {
          const tabla = calcTabla(picks, results);
          await redis.set('quiniela:tabla', tabla);
        }
      }
      return res.status(200).json({ ok: true });
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
      // Recalculate tabla with new picks
      const results = await redis.get('quiniela:results') || {};
      const tabla = calcTabla(picks, results);
      await redis.set('quiniela:tabla', tabla);
      return res.status(200).json({ ok: true, participantes: Object.keys(picks).length });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
