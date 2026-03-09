const fs = require("fs");
const { google } = require("googleapis");

const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Clientes";
const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || "./credentials.json";

function norm(s) {
  return String(s ?? "").toLowerCase().trim()
    .replace(/\s+/g, " ")
    .replace(/[áàä]/g, "a").replace(/[éèë]/g, "e").replace(/[íìï]/g, "i").replace(/[óòö]/g, "o").replace(/[úùü]/g, "u");
}

async function getClient() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    return new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    }).getClient();
  }
  return new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  }).getClient();
}

async function getSheets() {
  const auth = await getClient();
  return google.sheets({ version: "v4", auth });
}

function parseRows(rows) {
  if (rows.length < 1) return { map: {}, rows: [], availableTotal: 0, availableByService: {} };
  
  const headers = rows[0].map(h => norm(h));
  const map = {};
  headers.forEach((h, i) => { if (h) map[h] = i; });

  let parsed = [];
  let availableTotal = 0;
  let availableByService = {};

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[map["servicio"]] && !r[map["correo"]]) continue;

    const nombreRaw = (r[map["nombre"]] || "").trim();
    const esDisponible = norm(nombreRaw) === "disponible" || !nombreRaw;
    
    const rawDias = String(r[map["dias restantes"]] || "0").replace(/[^0-9\-]/g, "");
    let diasVal = parseInt(rawDias) || 0;

    let bucket = "activos";
    if (esDisponible) {
      bucket = "disponible";
      availableTotal++;
      const svc = (r[map["servicio"]] || "OTROS").trim().toUpperCase();
      availableByService[svc] = (availableByService[svc] || 0) + 1;
    } else if (diasVal <= 0) {
      bucket = "vencidos";
    } else if (diasVal <= 3) {
      bucket = "porvencer";
    }

    parsed.push({
      row: i + 1,
      servicio: r[map["servicio"]] || "",
      correo: r[map["correo"]] || "",
      contrasena: r[map["contrasena"]] || r[map["password"]] || "",
      perfil: r[map["perfil"]] || "",
      pin: r[map["pin"]] || "",
      nombre: nombreRaw,
      telefono: r[map["telefono"]] || "",
      vencimiento: r[map["fecha de vencimiento"]] || "",
      dias: diasVal,
      bucket: bucket
    });
  }

  // ORDEN: Vencidos -> Por Vencer -> Activos -> Disponibles
  parsed.sort((a, b) => {
    const p = { "vencidos": 1, "porvencer": 2, "activos": 3, "disponible": 4 };
    return p[a.bucket] - p[b.bucket] || a.dias - b.dias;
  });

  return { map, rows: parsed, availableTotal, availableByService };
}

async function getDashboard() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TAB}!A:Z` });
  return parseRows(res.data.values || []);
}

// ... (Aquí irían tus funciones de renovar, asignar, etc. que ya tienes)
// Solo asegúrate de exportar al final:
module.exports = { getDashboard };
