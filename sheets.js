const fs = require("fs");
const { google } = require("googleapis");

const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Clientes";
const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || "./credentials.json";

const FORCED_LOCALE = (process.env.SHEETS_LOCALE || "").toLowerCase().trim();

function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[áàä]/g, "a")
    .replace(/[éèë]/g, "e")
    .replace(/[íìï]/g, "i")
    .replace(/[óòö]/g, "o")
    .replace(/[úùü]/g, "u");
}

function requireEnv() {
  if (!SHEET_ID) throw new Error("Falta SHEET_ID en las variables de entorno");
  if (!process.env.GOOGLE_CREDS_JSON && !fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`No se encontró GOOGLE_CREDS_JSON ni el archivo ${CREDENTIALS_PATH}`);
  }
}

async function getClient() {
  requireEnv();
  let creds;
  if (process.env.GOOGLE_CREDS_JSON) {
    creds = JSON.parse(process.env.GOOGLE_CREDS_JSON);
  } else {
    creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  }
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return google.sheets({ version: "v4", auth });
}

function findHeaderRow(values) {
  const limit = Math.min(values.length, 120);
  for (let r = 0; r < limit; r++) {
    const row = (values[r] || []).map(norm);
    if (row.includes("nombre") && row.includes("telefono") && row.includes("servicio")) return r;
  }
  return -1;
}

function headerMap(headerRow) {
  const map = {};
  (headerRow || []).forEach((h, i) => {
    const k = norm(h);
    if (k) map[k] = i;
  });
  return map;
}

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellRef(colIdx, row) {
  return `${colLetter(colIdx)}${row}`;
}

// ✅ Corregido para que NUNCA devuelva NaN en el objeto final
function parseDias(x) {
  const t = String(x ?? "").trim();
  if (!t || t === "NaN") return 0;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

function bucketByDias(d) {
  if (d <= 0) return "vencidos";
  if (d >= 1 && d <= 3) return "porvencer";
  return "activos";
}

function toISODateOnly(d) {
  return d.toISOString().slice(0, 10);
}

function today0() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isDisponible(row) {
  return norm(row.nombre || "") === "disponible";
}

function parseDateFlexible(val) {
  if (val == null) return null;
  const s = String(val).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  return new Date(s);
}

function detectLocaleFormula(headerRow) {
  return "es"; 
}

function diasFormula({ locale, venceCell }) {
  return `=SI(ESBLANCO(${venceCell});"";${venceCell}-HOY())`;
}

function mapCol(map, name) {
  const i = map[norm(name)];
  return (i == null) ? null : (i + 1);
}

function buildUpdatesForRow(map, rowNumber, fieldsObj) {
  const updates = [];
  for (const [headerName, value] of Object.entries(fieldsObj)) {
    const colIdx = mapCol(map, headerName);
    if (!colIdx) continue;
    updates.push({
      range: `${TAB}!${colLetter(colIdx)}${rowNumber}`,
      values: [[value]]
    });
  }
  return updates;
}

async function batchUpdate(updates) {
  const sheets = await getClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: "USER_ENTERED", data: updates }
  });
}

async function readAll() {
  const sheets = await getClient();
  const range = `${TAB}!A:M`; // Leemos hasta la M para el proveedor
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });

  const values = resp.data.values || [];
  if (!values.length) return { headerRowIndex: -1, header: [], map: {}, rows: [] };

  const headerRowIndex = findHeaderRow(values);
  if (headerRowIndex === -1) throw new Error('No encuentro headers.');

  const header = values[headerRowIndex] || [];
  const map = headerMap(header);

  const rows = [];
  const rawData = values.slice(headerRowIndex + 1);

  rawData.forEach((r, i) => {
    const rowNumber = (headerRowIndex + 2) + i;
    if (!(r || []).some(c => String(c ?? "").trim() !== "")) return;

    const nombreRaw = r[map[norm("nombre")]] ?? "";
    const esDisp = norm(nombreRaw) === "disponible";

    // Índices fijos según tu tabla para evitar errores de nombres duplicados
    const dCli = esDisp ? 0 : parseDias(r[10]); // Columna K (Días Cliente)
    const dProv = parseDias(r[12]); // Columna M (Días Proveedor)

    rows.push({
      row: rowNumber,
      codigo: r[0] || "",
      nombre: esDisp ? "Disponible" : nombreRaw,
      telefono: r[map[norm("telefono")]] || "",
      servicio: r[map[norm("servicio")]] || "",
      correo: r[map[norm("correo")]] || "",
      contrasena: r[map[norm("contraseña")]] || r[map[norm("contrasena")]] || "",
      perfil: r[map[norm("perfil")]] || "",
      pin: r[map[norm("pin")]] || "",
      inicio: r[map[norm("fecha de inicio")]] || "",
      vencimiento: r[map[norm("fecha de vencimiento")]] || "",
      venceProv: r[11] || "", // Columna L
      dias: esDisp ? "" : `${dCli} DÍAS`,
      diasNum: dCli,
      diasProv: dProv,
      diasProvTexto: `${dProv} DÍAS`,
      bucket: esDisp ? "disponible" : bucketByDias(dCli),
      bucketProv: bucketByDias(dProv),
      esDisponible: esDisp
    });
  });

  return { headerRowIndex, header, map, rows };
}

async function getDashboard() {
  const { rows } = await readAll();
  const clientes = rows.filter(r => !r.esDisponible);
  const counts = { vencidos: 0, porvencer: 0, activos: 0, total: clientes.length };
  clientes.forEach(r => { if(counts[r.bucket] !== undefined) counts[r.bucket]++; });

  const availableByService = {};
  rows.forEach(r => {
    if (r.esDisponible && r.servicio) {
      const svc = String(r.servicio).trim().toUpperCase();
      availableByService[svc] = (availableByService[svc] || 0) + 1;
    }
  });

  const order = { vencidos: 0, porvencer: 1, activos: 2, disponible: 3 };
  rows.sort((a, b) => (order[a.bucket] - order[b.bucket]) || (a.diasNum - b.diasNum));

  return { counts, rows, availableByService, availableTotal: rows.filter(r => r.esDisponible).length };
}

// NUEVA FUNCIÓN PARA PROVEEDORES
async function getProveedores() {
  const { rows } = await readAll();
  const cuentas = rows.filter(r => r.correo && r.correo.includes("@"));
  return { ok: true, rows: cuentas };
}

async function renovarFila(rowNumber, diasExtra) {
  const { map } = await readAll();
  const colVenceIdx = mapCol(map, "fecha de vencimiento");
  const sheets = await getClient();
  const getResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!${colLetter(colVenceIdx)}${rowNumber}`
  });
  const base = parseDateFlexible(getResp.data.values?.[0]?.[0]) || today0();
  const nueva = new Date(base.getTime() + Number(diasExtra) * 86400000);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!${colLetter(colVenceIdx)}${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[toISODateOnly(nueva)]] }
  });
  return { row: rowNumber, ok: true };
}

async function eliminarCliente(rowNumber) {
  const { map } = await readAll();
  const updates = buildUpdatesForRow(map, rowNumber, {
    "Nombre": "Disponible",
    "Telefono": "",
    "Estado": "",
    "Fecha de inicio": "",
    "Fecha de vencimiento": "",
    "Días restantes": ""
  });
  await batchUpdate(updates);
  return { row: rowNumber, ok: true };
}

async function asignarEnFila({ rowNumber, nombre, telefono, dias = 30 }) {
  const { map } = await readAll();
  const hoy = today0();
  const vence = new Date(hoy.getTime() + Number(dias) * 86400000);
  const colVenceIdx = mapCol(map, "fecha de vencimiento");
  const formulaDias = diasFormula({ locale: "es", venceCell: cellRef(colVenceIdx, rowNumber) });

  const updates = buildUpdatesForRow(map, rowNumber, {
    "Nombre": nombre,
    "Telefono": telefono,
    "Estado": "ACTIVO",
    "Fecha de inicio": toISODateOnly(hoy),
    "Fecha de vencimiento": toISODateOnly(vence),
    "Días restantes": formulaDias
  });
  await batchUpdate(updates);
  return { ok: true };
}

module.exports = {
  getDashboard,
  getProveedores,
  renovarFila,
  asignarEnFila,
  eliminarCliente
};
