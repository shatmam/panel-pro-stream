const fs = require("fs");
const { google } = require("googleapis");

// Variables de entorno
const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Clientes";
const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || "./credentials.json";
const FORCED_LOCALE = (process.env.SHEETS_LOCALE || "").toLowerCase().trim();

/**
 * Normaliza textos para comparaciones (quita acentos, espacios y pasa a minúsculas)
 */
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

/**
 * Verifica que existan las credenciales necesarias antes de arrancar
 */
function requireEnv() {
  if (!SHEET_ID) throw new Error("Falta SHEET_ID en las variables de entorno");
  
  // Si no hay variable de Railway Y tampoco existe el archivo local, da error
  if (!process.env.GOOGLE_CREDS_JSON && !fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`No se encontró GOOGLE_CREDS_JSON ni el archivo ${CREDENTIALS_PATH}`);
  }
}

/**
 * Obtiene el cliente de Google Auth (Compatible con Local y Railway)
 */
async function getClient() {
  requireEnv();
  
  let creds;
  // 1. Prioridad: Variable de entorno (Para Railway)
  if (process.env.GOOGLE_CREDS_JSON) {
    try {
      creds = JSON.parse(process.env.GOOGLE_CREDS_JSON);
    } catch (e) {
      throw new Error("La variable GOOGLE_CREDS_JSON no tiene un formato JSON válido");
    }
  } 
  // 2. Segunda opción: Archivo local (Para tu PC)
  else {
    creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  }

  const client = new google.auth.JWT(
    creds.client_email,
    null,
    creds.private_key,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  return client;
}

/**
 * Lógica de negocio del Panel
 */

async function getDashboard() {
  const client = await getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A:Z`,
  });

  const rows = res.data.values;
  if (!rows || rows.length === 0) return { headers: [], rows: [] };

  const headers = rows[0];
  const dataRows = rows.slice(1).map((r, i) => {
    const obj = { row: i + 2 };
    headers.forEach((h, idx) => {
      const key = norm(h);
      obj[key] = r[idx] || "";
      // Mapeo amigable para el frontend
      if (key === "nombre") obj.nombre = r[idx];
      if (key === "correo") obj.correo = r[idx];
      if (key === "servicio") obj.servicio = r[idx];
      if (key === "estado") obj.estado = r[idx];
      if (key === "fecha de vencimiento") obj.vencimiento = r[idx];
    });
    return obj;
  });

  return { headers, rows: dataRows };
}

async function batchUpdate(updates) {
  const client = await getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    resource: {
      valueInputOption: "USER_ENTERED",
      data: updates
    }
  });
}

function buildUpdatesForRow(map, rowNumber, data) {
  const updates = [];
  for (const [colName, value] of Object.entries(data)) {
    const colLetter = map[norm(colName)];
    if (colLetter) {
      updates.push({
        range: `${TAB}!${colLetter}${rowNumber}`,
        values: [[value]]
      });
    }
  }
  return updates;
}

// --- Funciones de acción ---

async function asignarEnFila({ rowNumber, nombre, telefono, dias }) {
  const { headers } = await getDashboard();
  const map = {};
  headers.forEach((h, i) => {
    map[norm(h)] = String.fromCharCode(65 + i);
  });

  const hoy = FORCED_LOCALE === "es" ? "=HOY()" : "=TODAY()";
  
  const updates = buildUpdatesForRow(map, rowNumber, {
    "Nombre": nombre,
    "Telefono": telefono,
    "Teléfono": telefono,
    "Estado": "ACTIVO",
    "Fecha de inicio": hoy,
    "Días": dias,
    "Dias": dias
  });

  await batchUpdate(updates);
  return { ok: true };
}

async function renovarFila(rowNumber, dias) {
  const { headers } = await getDashboard();
  const map = {};
  headers.forEach((h, i) => map[norm(h)] = String.fromCharCode(65 + i));

  const updates = buildUpdatesForRow(map, rowNumber, {
    "Dias": dias,
    "Días": dias,
    "Estado": "ACTIVO"
  });

  await batchUpdate(updates);
  return { ok: true };
}

async function eliminarCliente(rowNumber) {
  const { headers } = await getDashboard();
  const map = {};
  headers.forEach((h, i) => map[norm(h)] = String.fromCharCode(65 + i));

  const updates = buildUpdatesForRow(map, rowNumber, {
    "Nombre": "Disponible",
    "Telefono": "",
    "Teléfono": "",
    "Estado": "",
    "Fecha de inicio": "",
    "Fecha de vencimiento": "",
    "Días restantes": ""
  });

  await batchUpdate(updates);
  return { ok: true };
}

async function reasignarCuenta({ fromRow, toRow }) {
  const { rows, headers } = await getDashboard();
  const map = {};
  headers.forEach((h, i) => map[norm(h)] = String.fromCharCode(65 + i));

  const src = rows.find(r => Number(r.row) === Number(fromRow));
  if (!src) throw new Error("No encuentro el cliente origen.");

  const dest = rows.find(r => Number(r.row) === Number(toRow));
  if (!dest) throw new Error("No encuentro el destino.");

  const updatesDest = buildUpdatesForRow(map, dest.row, {
    "Nombre": src.nombre,
    "Telefono": src.telefono || "",
    "Teléfono": src.telefono || "",
    "Estado": src.estado || "ACTIVO",
    "Fecha de inicio": src.inicio || "",
    "Fecha de vencimiento": src.vencimiento || ""
  });

  const updatesSrc = buildUpdatesForRow(map, src.row, {
    "Nombre": "Disponible",
    "Telefono": "",
    "Teléfono": "",
    "Estado": "",
    "Fecha de inicio": "",
    "Fecha de vencimiento": ""
  });

  await batchUpdate([...updatesDest, ...updatesSrc]);

  return { 
    ok: true, 
    servicio: src.servicio, 
    correo: src.correo, 
    contrasena: src.contrasena || src.password,
    perfil: src.perfil,
    pin: src.pin 
  };
}

module.exports = {
  getDashboard,
  renovarFila,
  asignarEnFila,
  eliminarCliente,
  reasignarCuenta
};
