const fs = require("fs");
const { google } = require("googleapis");

const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Clientes";
const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || "./credentials.json";
const FORCED_LOCALE = (process.env.SHEETS_LOCALE || "es").toLowerCase().trim();

function norm(s) {
  return String(s ?? "").toLowerCase().trim().replace(/\s+/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

async function getClient() {
  let creds;
  if (process.env.GOOGLE_CREDS_JSON) {
    creds = JSON.parse(process.env.GOOGLE_CREDS_JSON);
  } else {
    creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  }
  return google.sheets({ version: "v4", auth: new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  })});
}

function colLetter(n) {
  if (!n || n < 1) return "A";
  let s = "";
  while (n > 0) {
    let m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function readAll() {
  const sheets = await getClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TAB}!A:M` });
  const values = resp.data.values || [];
  if (!values.length) return { rows: [], map: {} };

  // Buscar cabecera (fila que contiene nombre, telefono y servicio)
  let headerIdx = values.findIndex(r => {
    const row = r.map(norm);
    return row.includes("nombre") && row.includes("servicio");
  });
  if (headerIdx === -1) headerIdx = 0;

  const header = values[headerIdx].map(norm);
  const map = {}; header.forEach((h, i) => { if (h) map[h] = i; });

  const rows = values.slice(headerIdx + 1).map((r, i) => {
    const get = (name) => {
      const idx = map[norm(name)];
      return (idx !== undefined && r[idx] !== undefined) ? String(r[idx]).trim() : "";
    };
    const d = parseFloat(get("dias restantes").replace(",", ".")) || 0;
    return {
      row: headerIdx + i + 2,
      nombre: get("nombre"),
      correo: get("correo"),
      servicio: get("servicio"),
      perfil: get("perfil"),
      pin: get("pin"),
      dias: d,
      proveedorVence: get("proveedor") || get("fecha proveedor"),
      bucket: d <= 0 ? "vencidos" : (d <= 3 ? "porvencer" : "activos")
    };
  }).filter(r => r.nombre !== "");

  return { rows, map, headerIdx };
}

async function updateFila(row, fields) {
  const { map } = await readAll();
  const sheets = await getClient();
  const updates = [];

  for (const [key, val] of Object.entries(fields)) {
    if (key === "fechaProveedor") {
      const fecha = new Date();
      fecha.setDate(fecha.getDate() + Number(val));
      const fStr = fecha.toISOString().split('T')[0];
      const colL = map[norm("proveedor")] ?? 11; // Columna L por defecto
      updates.push({ range: `${TAB}!${colLetter(colL + 1)}${row}`, values: [[fStr]] });
      // Fórmula en M
      const formula = FORCED_LOCALE === "es" ? `=SI(ESBLANCO(L${row});"";L${row}-HOY())` : `=IF(ISBLANK(L${row}),"",L${row}-TODAY())`;
      updates.push({ range: `${TAB}!M${row}`, values: [[formula]] });
    } else {
      const idx = map[norm(key)];
      if (idx !== undefined) updates.push({ range: `${TAB}!${colLetter(idx + 1)}${row}`, values: [[val]] });
    }
  }

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: "USER_ENTERED", data: updates }
    });
  }
  return { ok: true };
}

async function getDashboard() {
  const { rows } = await readAll();
  return {
    counts: {
      activos: rows.filter(r => r.bucket === "activos").length,
      vencidos: rows.filter(r => r.bucket === "vencidos").length,
      total: rows.length
    },
    rows
  };
}

module.exports = { getDashboard, updateFila, readAll };
