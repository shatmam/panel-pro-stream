require("dotenv").config();
const fs = require("fs");
const { google } = require("googleapis");

const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Hoja1";
const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || "./credentials.json";
const FORCED_LOCALE = (process.env.SHEETS_LOCALE || "es").toLowerCase().trim();

// --- UTILIDADES ---

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

function parseDias(x) {
  if (x === undefined || x === null) return 0;
  const t = String(x).trim();
  if (!t || t === "" || t === "NaN") return 0;
  // Limpia el texto para dejar solo números, puntos o comas
  const clean = t.replace(",", ".").replace(/[^\d.-]/g, "");
  const n = parseFloat(clean);
  return isFinite(n) ? Math.floor(n) : 0;
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

function diasFormula({ locale, venceCell }) {
  if (locale === "en") return `=IF(ISBLANK(${venceCell}),"",${venceCell}-TODAY())`;
  return `=SI(ESBLANCO(${venceCell});"";${venceCell}-HOY())`;
}

// --- CLIENTE GOOGLE ---

async function getClient() {
  let creds;
  if (process.env.GOOGLE_CREDS_JSON) {
    creds = JSON.parse(process.env.GOOGLE_CREDS_JSON);
  } else {
    if (!fs.existsSync(CREDENTIALS_PATH)) throw new Error("Faltan credenciales de Google");
    creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  }
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return google.sheets({ version: "v4", auth });
}

// --- LÓGICA DE NEGOCIO ---

async function readAll() {
  const sheets = await getClient();
  // Rango A:M para cubrir hasta "Días restantes" del proveedor
  const range = `${TAB}!A:M`;
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });
  const values = resp.data.values || [];

  if (!values.length) return { rows: [] };

  // Buscamos la fila de encabezados (usualmente la 1, índice 0)
  const rows = [];
  const rawData = values.slice(1); // Saltamos la primera fila de títulos

  rawData.forEach((r, i) => {
    const rowNumber = i + 2; // +2 porque Excel/Sheets empieza en 1 y saltamos el header
    const hasAny = r.some(c => String(c ?? "").trim() !== "");
    if (!hasAny) return;

    // Mapeo manual basado en tu imagen:
    // A=0, B=1(nom), C=2(tel), D=3(srv), E=4(mail), F=5(pass), G=6(perf), H=7(pin), I=8(inicio), J=9(venc), K=10(dias), L=11(vProv), M=12(dProv)
    const dCliente = parseDias(r[10]);
    const dProv = parseDias(r[12]);

    rows.push({
      row: rowNumber,
      codigo: r[0] || "",
      nombre: r[1] || "",
      telefono: r[2] || "",
      servicio: r[3] || "",
      correo: r[4] || "",
      contrasena: r[5] || "",
      perfil: r[6] || "",
      pin: r[7] || "",
      inicio: r[8] || "",
      vencimiento: r[9] || "",
      dias: String(dCliente), // Esto evita el "NaN DÍAS" en el frontend
      diasNum: dCliente,
      bucket: bucketByDias(dCliente),
      // Datos Proveedor
      venceProv: r[11] || "",
      diasProv: dProv
    });
  });

  return { rows };
}

async function getDashboard() {
  const { rows } = await readAll();
  const counts = { vencidos: 0, porvencer: 0, activos: 0, total: rows.length };
  
  const availableByService = {};
  let availableTotal = 0;

  rows.forEach(r => {
    if (isDisponible(r)) {
      availableTotal++;
      const svc = String(r.servicio || "OTROS").trim().toUpperCase();
      availableByService[svc] = (availableByService[svc] || 0) + 1;
    } else {
      counts[r.bucket]++;
    }
  });

  // Ordenar: Vencidos primero, luego por vencer, luego activos
  const order = { vencidos: 0, porvencer: 1, activos: 2 };
  rows.sort((a, b) => {
    if (order[a.bucket] !== order[b.bucket]) return order[a.bucket] - order[b.bucket];
    return a.diasNum - b.diasNum;
  });

  return { counts, rows, availableByService, availableTotal };
}

async function renovarFila(rowNumber, diasExtra) {
  const sheets = await getClient();
  const { rows } = await readAll();
  const rowData = rows.find(r => r.row === rowNumber);
  
  if (!rowData) throw new Error("Fila no encontrada");

  // Si no hay fecha previa, usamos hoy
  let base = new Date(rowData.vencimiento);
  if (isNaN(base.getTime())) base = today0();

  const nueva = new Date(base.getTime() + Number(diasExtra) * 86400000);
  const fechaISO = toISODateOnly(nueva);

  // Actualizar Fecha (Col J = índice 9)
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!J${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[fechaISO]] }
  });

  // Re-aplicar formula de días (Col K = índice 10)
  const formula = diasFormula({ locale: FORCED_LOCALE, venceCell: `J${rowNumber}` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!K${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[formula]] }
  });

  return { ok: true, nuevaFecha: fechaISO };
}

async function asignarEnFila({ rowNumber, nombre, telefono, dias = 30 }) {
  const sheets = await getClient();
  const hoy = today0();
  const vence = new Date(hoy.getTime() + Number(dias) * 86400000);
  const formula = diasFormula({ locale: FORCED_LOCALE, venceCell: `J${rowNumber}` });

  // Actualizamos el rango B:K (Nombre hasta Días restantes)
  const values = [[
    nombre,                 // B
    telefono,               // C
    undefined,              // D (No tocamos Servicio)
    undefined,              // E (No tocamos Correo)
    undefined,              // F (No tocamos Pass)
    undefined,              // G (No tocamos Perfil)
    undefined,              // H (No tocamos PIN)
    toISODateOnly(hoy),     // I (Inicio)
    toISODateOnly(vence),   // J (Vencimiento)
    formula                 // K (Días)
  ]];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!B${rowNumber}:K${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values }
  });

  return { ok: true };
}

async function eliminarCliente(rowNumber) {
  const sheets = await getClient();
  const formula = diasFormula({ locale: FORCED_LOCALE, venceCell: `J${rowNumber}` });
  
  // Limpiamos datos del cliente pero dejamos la estructura
  // Nombre="Disponible", Tel="", Inicio="", Venc="", Dias=Formula
  const values = [["Disponible", "", "", "", "", "", "", "", "", formula]];
  
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!B${rowNumber}:K${rowNumber}`, // No tocamos columna A (G) ni columna L/M (Proveedor)
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["Disponible", "", "", "", "", "", "", "", "", ""]] } 
  });
  
  // Limpiamos celdas específicas de fecha para que no queden restos
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!I${rowNumber}:J${rowNumber}`
  });

  return { ok: true };
}

async function updateFila(rowNumber, fields) {
  const sheets = await getClient();
  // Mapeo simple de campos a columnas
  const map = { nombre: "B", telefono: "C", servicio: "D", correo: "E", contrasena: "F", perfil: "G", pin: "H" };
  
  for (const [key, value] of Object.entries(fields)) {
    const col = map[key];
    if (col) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${TAB}!${col}${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[value]] }
      });
    }
  }
  return { ok: true };
}

async function reasignarCuenta({ fromRow, toRow }) {
  const { rows } = await readAll();
  const src = rows.find(r => r.row === fromRow);
  const dest = rows.find(r => r.row === toRow);

  if (!src || !dest) throw new Error("Filas no válidas");

  // Movemos datos del cliente de src a dest
  await asignarEnFila({ 
    rowNumber: toRow, 
    nombre: src.nombre, 
    telefono: src.telefono, 
    dias: src.diasNum 
  });
  
  // Limpiamos origen
  await eliminarCliente(fromRow);

  return { ok: true };
}

module.exports = {
  getDashboard,
  renovarFila,
  updateFila,
  asignarEnFila,
  eliminarCliente,
  reasignarCuenta
};
