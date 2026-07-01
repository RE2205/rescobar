// api/admin.js — Panel de administración de pacientes
// Protegido por ADMIN_PASSWORD en env vars

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Verificar contraseña
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) {
    return res.status(500).json({ error: "KV no configurado. Agregá KV_REST_API_URL y KV_REST_API_TOKEN en Vercel." });
  }

  try {
    // GET — Listar todos los pacientes
    if (req.method === "GET") {
      const index = await kvGet(kvUrl, kvToken, "patients:index");
      const claves = index || [];
      const pacientes = [];

      for (const clave of claves) {
        const data = await kvGet(kvUrl, kvToken, "patient:" + clave);
        const lastUse = await kvGet(kvUrl, kvToken, "lastuse:" + clave);
        if (data) {
          pacientes.push({ clave, ...data, lastUse: lastUse || null });
        }
      }

      return res.status(200).json({ pacientes, total: pacientes.length });
    }

    // POST — Agregar o actualizar paciente
    if (req.method === "POST") {
      const { clave, nombre, skill } = req.body;
      if (!clave || !nombre || !skill) {
        return res.status(400).json({ error: "Faltan campos: clave, nombre, skill" });
      }

      const claveUpper = clave.toUpperCase().trim();
      const validSkills = ["general", "artistas"];
      if (!validSkills.includes(skill)) {
        return res.status(400).json({ error: "Skill inválida. Opciones: " + validSkills.join(", ") });
      }

      // Guardar paciente
      const paciente = {
        nombre,
        skill,
        active: true,
        createdAt: new Date().toISOString(),
      };
      await kvSet(kvUrl, kvToken, "patient:" + claveUpper, paciente);

      // Actualizar índice
      const index = (await kvGet(kvUrl, kvToken, "patients:index")) || [];
      if (!index.includes(claveUpper)) {
        index.push(claveUpper);
        await kvSet(kvUrl, kvToken, "patients:index", index);
      }

      return res.status(200).json({ ok: true, message: `Paciente ${claveUpper} creado`, paciente });
    }

    // DELETE — Desactivar paciente (no borrar, solo desactivar)
    if (req.method === "DELETE") {
      const { clave } = req.body;
      if (!clave) return res.status(400).json({ error: "Falta clave" });

      const claveUpper = clave.toUpperCase().trim();
      const paciente = await kvGet(kvUrl, kvToken, "patient:" + claveUpper);
      if (!paciente) return res.status(404).json({ error: "Paciente no encontrado" });

      paciente.active = false;
      paciente.deactivatedAt = new Date().toISOString();
      await kvSet(kvUrl, kvToken, "patient:" + claveUpper, paciente);

      return res.status(200).json({ ok: true, message: `Paciente ${claveUpper} desactivado` });
    }

    return res.status(405).json({ error: "Método no soportado" });
  } catch (error) {
    console.error("Admin error:", error);
    return res.status(500).json({ error: "Error interno" });
  }
}

// KV Helpers
async function kvGet(url, token, key) {
  const res = await fetch(`${url}/get/${key}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (data.result === null) return null;
  try { return JSON.parse(data.result); } catch { return data.result; }
}

async function kvSet(url, token, key, value) {
  const val = typeof value === "string" ? value : JSON.stringify(value);
  return await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(["SET", key, val]),
  }).then(r => r.json());
}
