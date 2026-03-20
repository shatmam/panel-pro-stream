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

function parseDias(x) {
  const t = String(x ?? "").trim();
  if (!t) return NaN;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function bucketByDias(d) {
  if (Number.isFinite(d) && d <= 0) return "vencidos";
  if (Number.isFinite(d) && d >= 1 && d <= 3) return "porvencer";
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
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  const dt2 = new Date(s);
  if (!Number.isNaN(dt2.getTime())) return dt2;
  return null;
}

function detectLocaleFormula(headerRow) {
  if (FORCED_LOCALE === "en" || FORCED_LOCALE === "es") return FORCED_LOCALE;
  return "es";
}

function diasFormula({ locale, venceCell }) {
  if (locale === "en") return `=IF(ISBLANK(${venceCell}),"",${venceCell}-TODAY())`;
  return `=SI(ESBLANCO(${venceCell});"";${venceCell}-HOY())`;
}

function mapCol(map, name) {
  const i = map[norm(name)];
  return (i == null) ? null : (i + 1);
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
  const range = `${TAB}!A:Z`;
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });
  const values = resp.data.values || [];
  if (!values.length) return { headerRowIndex: -1, header: [], map: {}, rows: [] };

  const headerRowIndex = findHeaderRow(values);
  if (headerRowIndex === -1) throw new Error('No encuentro headers.');

  const header = values[headerRowIndex] || [];
  const map = headerMap(header);
  const idx = (name) => (map[norm(name)] ?? -1);
  const get = (row, name) => {
    const i = idx(name);
    return i >= 0 ? (row[i] ?? "") : "";
  };

  const rows = [];
  const rawData = values.slice(headerRowIndex + 1);
  rawData.forEach((r, i) => {
    const rowNumber = (headerRowIndex + 2) + i;
    const hasAny = (r || []).some(c => String(c ?? "").trim() !== "");
    if (!hasAny) return;

    rows.push({
      row: rowNumber,
      codigo: r[0] || "",
      nombre: get(r, "nombre"),
      telefono: get(r, "telefono") || get(r, "teléfono"),
      servicio: get(r, "servicio"),
      correo: get(r, "correo"),
      contrasena: get(r, "contraseña") || get(r, "contrasena"),
      perfil: get(r, "perfil"),
      pin: get(r, "pin"),
      inicio: get(r, "fecha de inicio"),
      vencimiento: get(r, "fecha de vencimiento"),
      proveedorVence: get(r, "proveedor"), // Columna L
      dias: get(r, "dias restantes") // Columna K
    });
  });
  return { headerRowIndex, header, map, rows };
}

async function getDashboard() {
  const { rows } = await readAll();
  const counts = { vencidos: 0, porvencer: 0, activos: 0, total: rows.length };
  
  rows.forEach(r => {
    const d = parseDias(r.dias);
    const bucket = bucketByDias(d);
    r.bucket = bucket;
    r.diasNum = d;
    counts[bucket]++;
  });

  const availableByService = {};
  rows.forEach(r => {
    if (isDisponible(r)) {
      const svc = String(r.servicio || "OTROS").trim() || "OTROS";
      availableByService[svc] = (availableByService[svc] || 0) + 1;
    }
  });

  return { counts, rows, availableByService };
}

// ✅ Función de actualización robusta
async function updateFila(rowNumber, fields) {
  const { map, header } = await readAll();
  const locale = detectLocaleFormula(header);
  const updates = [];

  // Mapeo de campos permitidos
  const allowed = {
    nombre: ["nombre"],
    telefono: ["telefono", "teléfono"],
    servicio: ["servicio"],
    correo: ["correo"],
    contrasena: ["contraseña", "contrasena"],
    perfil: ["perfil"],
    pin: ["pin"],
    estado: ["estado"]
  };

  // 1. Procesar campos normales
  for (const [k, v] of Object.entries(fields)) {
    const headers = allowed[k];
    if (!headers) continue;
    for (const h of headers) {
      const colIdx = mapCol(map, h);
      if (!colIdx) continue;
      updates.push({ range: `${TAB}!${colLetter(colIdx)}${rowNumber}`, values: [[v]] });
      break;
    }
  }

  // 2. LOGICA ESPECIAL: RENOVAR PROVEEDOR (COLUMNA L y M)
  if (fields.fechaProveedor) {
    const colProvIdx = mapCol(map, "proveedor"); // Columna L
    const colDiasProvIdx = mapCol(map, "dias restantes"); // Buscamos la segunda instancia si existe, o columna 13 (M)
    
    if (colProvIdx) {
      const base = today0();
      const nueva = new Date(base.getTime() + Number(fields.fechaProveedor) * 86400000);
      const colProvLetra = colLetter(colProvIdx);
      
      // Actualizar Fecha Proveedor (Columna L)
      updates.push({
        range: `${TAB}!${colProvLetra}${rowNumber}`,
        values: [[toISODateOnly(nueva)]]
      });

      // Actualizar Días Restantes Proveedor (Columna M - Es la col 13 fija según tu imagen)
      const colMLetra = "M"; 
      const formula = diasFormula({ locale, venceCell: `${colProvLetra}${rowNumber}` });
      updates.push({
        range: `${TAB}!${colMLetra}${rowNumber}`,
        values: [[formula]]
      });
    }
  }

  if (!updates.length) return { updated: 0 };
  await batchUpdate(updates);
  return { updated: updates.length };
}

// --- Resto de funciones originales ---
async function renovarFila(rowNumber, diasExtra) {
  const { map, header } = await readAll();
  const locale = detectLocaleFormula(header);
  const colVenceIdx = mapCol(map, "fecha de vencimiento");
  const colDiasIdx = mapCol(map, "dias restantes");
  const colVence = colLetter(colVenceIdx);
  const sheets = await getClient();
  const getResp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TAB}!${colVence}${rowNumber}` });
  const raw = (getResp.data.values?.[0]?.[0]) ?? "";
  const base = parseDateFlexible(raw) || today0();
  const nueva = new Date(base.getTime() + Number(diasExtra) * 86400000);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `${TAB}!${colVence}${rowNumber}`,
    valueInputOption: "USER_ENTERED", requestBody: { values: [[toISODateOnly(nueva)]] }
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `${TAB}!${colLetter(colDiasIdx)}${rowNumber}`,
    valueInputOption: "USER_ENTERED", requestBody: { values: [[diasFormula({ locale, venceCell: `${colVence}${rowNumber}` })]] }
  });
  return { row: rowNumber, nuevaFecha: toISODateOnly(nueva) };
}

async function asignarEnFila({ rowNumber, nombre, telefono, dias = 30 }) {
  const { rows, map, header } = await readAll();
  const r = rows.find(x => Number(x.row) === Number(rowNumber));
  const hoy = today0();
  const vence = new Date(hoy.getTime() + Number(dias) * 86400000);
  const colVenceIdx = mapCol(map, "fecha de vencimiento");
  const updates = [];
  const fields = { "Nombre": nombre, "Telefono": telefono, "Estado": "ACTIVO", "Fecha de inicio": toISODateOnly(hoy), "Fecha de vencimiento": toISODateOnly(vence) };
  for (const [h, v] of Object.entries(fields)) {
    const c = mapCol(map, h);
    if (c) updates.push({ range: `${TAB}!${colLetter(c)}${r.row}`, values: [[v]] });
  }
  const formula = diasFormula({ locale: detectLocaleFormula(header), venceCell: cellRef(colVenceIdx, r.row) });
  const cDias = mapCol(map, "dias restantes");
  if (cDias) updates.push({ range: `${TAB}!${colLetter(cDias)}${r.row}`, values: [[formula]] });
  await batchUpdate(updates);
  return { row: r.row, correo: r.correo, vence: toISODateOnly(vence) };
}

async function eliminarCliente(rowNumber) {
  const { map } = await readAll();
  const campos = ["Nombre", "Telefono", "Teléfono", "Estado", "Fecha de inicio", "Fecha de vencimiento", "Días restantes"];
  const updates = [];
  campos.forEach(h => {
    const c = mapCol(map, h);
    if (c) updates.push({ range: `${TAB}!${colLetter(c)}${rowNumber}`, values: [[ h === "Nombre" ? "Disponible" : "" ]] });
  });
  await batchUpdate(updates);
  return { row: rowNumber, ok: true };
}

async function reasignarCuenta({ fromRow, toRow }) {
  const { rows, map } = await readAll();
  const src = rows.find(r => Number(r.row) === Number(fromRow));
  const dest = rows.find(r => Number(r.row) === Number(toRow));
  const updates = [];
  const campos = ["Nombre", "Telefono", "Estado", "Fecha de inicio", "Fecha de vencimiento", "Días restantes"];
  campos.forEach(h => {
    const c = mapCol(map, h);
    if (c) updates.push({ range: `${TAB}!${colLetter(c)}${dest.row}`, values: [[ src[norm(h)] || "" ]] });
  });
  await batchUpdate(updates);
  await eliminarCliente(fromRow);
  return { ok: true };
}

module.exports = { getDashboard, renovarFila, updateFila, asignarEnFila, eliminarCliente, reasignarCuenta };
