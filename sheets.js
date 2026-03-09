const fs = require("fs");
const { google } = require("googleapis");

const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Clientes";
const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || "./credentials.json";

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
  if (!SHEET_ID) throw new Error("Falta SHEET_ID");
  if (!fs.existsSync(CREDENTIALS_PATH)) throw new Error("No existe credentials.json");
}

async function getClient() {
  requireEnv();

  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

function isDisponible(row) {
  const n = norm(row.nombre || "");
  return n === "disponible" || n === "" || n === "-";
}

function parseDias(x) {
  const t = String(x ?? "").trim();
  if (!t) return NaN;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function bucketByDias(d) {
  if (Number.isFinite(d) && d <= 0) return "vencidos";
  if (Number.isFinite(d) && d <= 3) return "porvencer";
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

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function readAll() {

  const sheets = await getClient();

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A:Z`
  });

  const values = resp.data.values || [];

  const header = values[0];
  const rows = [];

  values.slice(1).forEach((r, i) => {

    if (!r.some(c => String(c || "").trim())) return;

    const dias = parseDias(r[10]);

    rows.push({
      row: i + 2,
      codigo: r[0],
      servicio: r[1],
      correo: r[2],
      contrasena: r[3],
      perfil: r[4],
      pin: r[5],
      nombre: r[6],
      telefono: r[7],
      inicio: r[8],
      vencimiento: r[9],
      dias: r[10],
      diasNum: dias,
      bucket: bucketByDias(dias)
    });

  });

  return { rows };
}

async function asignarEnFila({ rowNumber, nombre, telefono, dias = 30 }) {

  const { rows } = await readAll();

  const r = rows.find(x => x.row == rowNumber);

  if (!r) throw new Error("Fila no encontrada");
  if (!isDisponible(r)) throw new Error("Cuenta no disponible");

  const sheets = await getClient();

  const hoy = today0();
  const vence = new Date(hoy.getTime() + dias * 86400000);

  const updates = [
    [`${TAB}!G${rowNumber}`, nombre],
    [`${TAB}!H${rowNumber}`, telefono],
    [`${TAB}!I${rowNumber}`, toISODateOnly(hoy)],
    [`${TAB}!J${rowNumber}`, toISODateOnly(vence)]
  ];

  for (const u of updates) {

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: u[0],
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[u[1]]] }
    });

  }

  return {
    servicio: r.servicio,
    correo: r.correo,
    contrasena: r.contrasena,
    perfil: r.perfil,
    pin: r.pin,
    vence: toISODateOnly(vence)
  };

}

async function eliminarCliente(rowNumber) {

  const sheets = await getClient();

  const updates = [
    [`${TAB}!G${rowNumber}`, "Disponible"],
    [`${TAB}!H${rowNumber}`, ""],
    [`${TAB}!I${rowNumber}`, ""],
    [`${TAB}!J${rowNumber}`, ""],
    [`${TAB}!K${rowNumber}`, ""]
  ];

  for (const u of updates) {

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: u[0],
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[u[1]]] }
    });

  }

  return { ok: true };

}

async function reasignarCuenta({ fromRow, toRow }) {

  const { rows } = await readAll();

  const src = rows.find(r => r.row == fromRow);
  const dest = rows.find(r => r.row == toRow);

  if (!src) throw new Error("Origen no encontrado");
  if (!dest) throw new Error("Destino no encontrado");

  if (!isDisponible(dest)) throw new Error("Destino no disponible");

  if (!norm(dest.servicio).includes(norm(src.servicio)))
    throw new Error("Servicios no coinciden");

  const sheets = await getClient();

  const updates = [

    [`${TAB}!G${toRow}`, src.nombre],
    [`${TAB}!H${toRow}`, src.telefono],
    [`${TAB}!I${toRow}`, src.inicio],
    [`${TAB}!J${toRow}`, src.vencimiento],

    [`${TAB}!G${fromRow}`, "Disponible"],
    [`${TAB}!H${fromRow}`, ""],
    [`${TAB}!I${fromRow}`, ""],
    [`${TAB}!J${fromRow}`, ""]

  ];

  for (const u of updates) {

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: u[0],
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[u[1]]] }
    });

  }

  return {
    servicio: dest.servicio,
    correo: dest.correo,
    contrasena: dest.contrasena,
    perfil: dest.perfil,
    pin: dest.pin
  };

}

module.exports = {
  readAll,
  asignarEnFila,
  eliminarCliente,
  reasignarCuenta
};
