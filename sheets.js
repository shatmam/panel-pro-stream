const fs = require("fs");
const { google } = require("googleapis");

const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Clientes";
const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || "./credentials.json";

// Detectar idioma de fórmulas (es para SI/HOY, en para IF/TODAY)
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

function requireEnv() {
  if (!SHEET_ID) throw new Error("Falta SHEET_ID en las variables de entorno");
  if (!fs.existsSync(CREDENTIALS_PATH)) throw new Error(`No existe el archivo ${CREDENTIALS_PATH}`);
}

async function getClient() {
  requireEnv();
  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

// Obtener todos los datos del dashboard
async function getDashboard() {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A1:Z2000`,
  });

  const rows = res.data.values;
  if (!rows || rows.length === 0) return { rows: [] };

  const headers = rows[0].map(h => h.toLowerCase().trim());
  const jsonData = rows.slice(1).map((row, index) => {
    const obj = { row: index + 2 }; // +2 porque Excel empieza en 1 y saltamos cabecera
    headers.forEach((header, i) => {
      obj[header] = row[i] || "";
    });
    
    // Lógica de Bucket (Vencidos vs Activos)
    const dias = parseInt(obj["dias restantes"] || obj["dias"]) || 0;
    obj.bucket = dias <= 0 ? "vencidos" : "activos";
    obj.dias = dias;
    
    return obj;
  });

  return { rows: jsonData };
}

// Asignar una cuenta "Disponible" a un cliente
async function asignarEnFila({ rowNumber, nombre, telefono, dias }) {
  const sheets = await getClient();
  const { rows } = await getDashboard();
  const headers = Object.keys(rows[0] || {}).filter(k => k !== 'row' && k !== 'bucket');

  const fechaInicio = new Date().toLocaleDateString("es-ES");
  
  // Fórmulas según idioma
  const formulaVence = FORCED_LOCALE === "es" 
    ? `=SI(ESBLANCO(E${rowNumber});"";G${rowNumber}+H${rowNumber})`
    : `=IF(ISBLANK(E${rowNumber}),"",G${rowNumber}+H${rowNumber})`;

  const updates = [
    { range: `${TAB}!E${rowNumber}`, values: [[nombre]] },     // Columna E: Nombre
    { range: `${TAB}!F${rowNumber}`, values: [[telefono]] },   // Columna F: Telefono
    { range: `${TAB}!G${rowNumber}`, values: [[fechaInicio]] },// Columna G: Inicio
    { range: `${TAB}!H${rowNumber}`, values: [[dias]] },        // Columna H: Dias
    { range: `${TAB}!I${rowNumber}`, values: [[formulaVence]] } // Columna I: Vencimiento
  ];

  for (const update of updates) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: update.range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: update.values },
    });
  }

  const r = rows.find(x => x.row === rowNumber);
  return { ok: true, servicio: r.servicio, correo: r.correo, contrasena: r.contrasena, perfil: r.perfil, pin: r.pin };
}

// Renovar días a un cliente existente
async function renovarFila({ row, dias }) {
  const sheets = await getClient();
  const currentRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!H${row}`,
  });

  const currentDays = parseInt(currentRes.data.values?.[0]?.[0]) || 0;
  const newDays = currentDays + parseInt(dias);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!H${row}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[newDays]] },
  });

  return { ok: true, newDays };
}

// Liberar cuenta (Borrar cliente)
async function eliminarCliente(rowNumber) {
  const sheets = await getClient();
  
  // Limpiamos los campos del cliente pero dejamos los de la cuenta (correo, pass, etc.)
  const values = [["Disponible", "", "", "", ""]]; 
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!E${rowNumber}:I${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  return { ok: true };
}

// Mover cliente de una cuenta a otra
async function reasignarCuenta({ fromRow, toRow }) {
  const sheets = await getClient();
  const { rows } = await getDashboard();
  
  const src = rows.find(r => r.row === fromRow);
  const dest = rows.find(r => r.row === toRow);

  if (!src || !dest) throw new Error("Fila origen o destino no encontrada");

  // 1. Copiar datos al destino
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!E${toRow}:H${toRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[src.nombre, src.telefono, src.inicio, src.dias]] },
  });

  // 2. Limpiar el origen
  await eliminarCliente(fromRow);

  return { ok: true, servicio: dest.servicio, correo: dest.correo, contrasena: dest.contrasena, perfil: dest.perfil, pin: dest.pin };
}

module.exports = {
  getDashboard,
  renovarFila,
  asignarEnFila,
  eliminarCliente,
  reasignarCuenta
};
