const fs = require("fs");
const { google } = require("googleapis");

const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Clientes";
const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || "./credentials.json";

function requireEnv() {
  if (!SHEET_ID) throw new Error("Falta SHEET_ID");

  if (!process.env.GOOGLE_CREDS_JSON && !fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error("Faltan credenciales de Google");
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

// ================= CLIENTES =================

async function getDashboard() {
  const sheets = await getClient();

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A:Z`
  });

  const values = resp.data.values || [];
  if (values.length <= 1) return { rows: [] };

  const rows = values.slice(1).map((r, i) => ({
    row: i + 2,
    nombre: r[1] || "",
    telefono: r[2] || "",
    servicio: r[3] || "",
    correo: r[4] || "",
    contrasena: r[5] || "",
    perfil: r[6] || "",
    pin: r[7] || "",
    vencimiento: r[8] || "",
    dias: r[9] || "",
    bucket: "activos"
  }));

  return { rows };
}

async function renovarFila(row, dias) {
  return { ok: true };
}

async function updateFila(row, fields) {
  return { ok: true };
}

async function asignarEnFila({ rowNumber, nombre, telefono }) {
  return { ok: true };
}

async function eliminarCliente(row) {
  return { ok: true };
}

async function reasignarCuenta({ fromRow, toRow }) {
  return { ok: true };
}

// ================= PAGOS =================

const PAGOS_TAB = "Pagos";

async function getPagos() {
  const sheets = await getClient();

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${PAGOS_TAB}!A:E`
  });

  const values = resp.data.values || [];
  if (values.length <= 1) return [];

  return values.slice(1).map((r, i) => ({
    row: i + 2,
    proveedor: r[0] || "",
    servicio: r[1] || "",
    monto: Number(r[2] || 0),
    fecha: r[3] || "",
    estado: r[4] || "PENDIENTE"
  }));
}

async function addPago({ proveedor, servicio, monto, fecha }) {
  const sheets = await getClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${PAGOS_TAB}!A:E`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[proveedor, servicio, monto, fecha, "PENDIENTE"]]
    }
  });

  return { ok: true };
}

module.exports = {
  getDashboard,
  renovarFila,
  updateFila,
  asignarEnFila,
  eliminarCliente,
  reasignarCuenta,
  getPagos,
  addPago
};
