const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

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
    if (req.method === 'POST' && action === 'result') {
      const { id, s1, s2, done } = req.body;
      const results = await redis.get('quiniela:results') || {};
      results[id] = { s1, s2, done };
      await redis.set('quiniela:results', results);
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
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
