const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const tabla = [
  {name:'Sophia Escobar',pts:31},{name:'Gilmar Pacheco',pts:30},
  {name:'Erick Palma',pts:30},{name:'Walter',pts:29},
  {name:'Henry',pts:28},{name:'Gabby Escobar',pts:28},
  {name:'Alfaro De León',pts:26},{name:'Javier del Cid',pts:25},
  {name:'Winny',pts:25},{name:'Sotomayor Leiva',pts:25},
  {name:'Sofia Pacheco (Fer)',pts:25},{name:'Alejandro',pts:23},
  {name:'Estuardo del Cid',pts:23},{name:'Girón Alfaro',pts:23},
  {name:'René del Cid',pts:21},{name:'Ronald Ochoa',pts:20},
  {name:'Mario Escobar',pts:20},{name:'Andres',pts:20},
  {name:'Rodrigo del Cid',pts:19},{name:'Mazariegos Lucas',pts:19},
  {name:'Karla',pts:18},{name:'Ronalito',pts:15},
  {name:'Pivaral',pts:14},{name:'Claudio',pts:11},
];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  await redis.set('quiniela:tabla', tabla);
  await redis.set('quiniela:previas', []);
  return res.status(200).json({ ok: true, msg: 'Tabla reseteada' });
};
