const fs = require("fs");
const { google } = require("googleapis");

const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Hoja1"; // Ajustado a "Hoja1" según lo común, cámbialo si es necesario
const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || "./credentials.json";

const FORCED_LOCALE = (process.env.SHEETS_LOCALE || "es").toLowerCase().trim();

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

async function getClient() {
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
  const limit = Math.min(values.length, 20);
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

function diasFormula({ locale, venceCell }) {
  if (locale === "en") return `=IF(ISBLANK(${venceCell}),"",${venceCell}-TODAY())`;
  return `=SI(ESBLANCO(${venceCell});"";${venceCell}-HOY())`;
}

// ✅ Función mejorada para leer toda la hoja incluyendo Proveedores
async function readAll() {
  const sheets = await getClient();
  const range = `${TAB}!A:M`; // Leemos hasta la columna M
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });

  const values = resp.data.values || [];
  if (!values.length) return { headerRowIndex: -1, header: [], map: {}, rows: [] };

  const headerRowIndex = findHeaderRow(values);
  if (headerRowIndex === -1) throw new Error("No se encontraron encabezados.");

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

    // Buscamos columnas de días (Col J/K para Cliente, L/M para Proveedor)
    const dCliente = parseDias(get(r, "dias restantes"));
    // Buscamos específicamente el segundo "dias restantes" (columna M)
    const dProv = parseDias(r[12]); 

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
      vencimiento: r[9] || "", // Columna J
      diasNum: dCliente,
      bucket: bucketByDias(dCliente),
      // Datos de Proveedor
      venceProv: r[11] || "", // Columna L
      diasProv: dProv          // Columna M
    });
  });

  return { headerRowIndex, header, map, rows };
}

async function getDashboard() {
  const { rows } = await readAll();
  const counts = { vencidos: 0, porvencer: 0, activos: 0, total: rows.length };
  rows.forEach(r => { if(counts[r.bucket] !== undefined) counts[r.bucket]++; });

  const availableByService = {};
  const availableByServiceProfile = {};
  let availableTotal = 0;

  rows.forEach(r => {
    if (isDisponible(r)) {
      availableTotal++;
      const svc = String(r.servicio || "OTROS").trim() || "OTROS";
      availableByService[svc] = (availableByService[svc] || 0) + 1;
      const p = String(r.perfil || "").trim() || "—";
      availableByServiceProfile[svc] = availableByServiceProfile[svc] || {};
      availableByServiceProfile[svc][p] = (availableByServiceProfile[svc][p] || 0) + 1;
    }
  });

  return { counts, rows, availableByService, availableByServiceProfile, availableTotal };
}

// ✅ Función para renovar la cuenta con el PROVEEDOR (Columna L)
async function renovarProveedor(rowNumber, nuevaFechaISO) {
  const sheets = await getClient();
  const range = `${TAB}!L${rowNumber}`; 
  
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[nuevaFechaISO]] }
  });
  return { ok: true };
}

// ... (Mantengo las funciones asignarEnFila, eliminarCliente, reasignarCuenta del original)
// Solo asegúrate de que buildUpdatesForRow use los nombres de tu tabla.

async function eliminarCliente(rowNumber) {
    const sheets = await getClient();
    // Limpiamos de la B a la K (Nombre hasta Días restantes cliente)
    // Según tu imagen, las columnas del cliente terminan en K
    const range = `${TAB}!B${rowNumber}:K${rowNumber}`;
    const emptyValues = [["Disponible", "", "", "", "", "", "", "", "", ""]];

    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: emptyValues }
    });
    return { row: rowNumber, ok: true };
}

module.exports = {
  getDashboard,
  renovarFila: require("./sheets").renovarFila, // Si necesitas la original
  updateFila: require("./sheets").updateFila,
  asignarEnFila: require("./sheets").asignarEnFila,
  eliminarCliente,
  reasignarCuenta: require("./sheets").reasignarCuenta,
  renovarProveedor
};
