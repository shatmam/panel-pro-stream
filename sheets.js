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
  if (!process.env.GOOGLE_CREDENTIALS_JSON && !fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`No se encontró GOOGLE_CREDENTIALS_JSON ni el archivo ${CREDENTIALS_PATH}`);
  }
}

async function getClient() {
  requireEnv();
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    try {
      const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
      return new google.auth.GoogleAuth({
        credentials: creds,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      }).getClient();
    } catch (e) {
      console.error("Error al leer GOOGLE_CREDENTIALS_JSON:", e.message);
    }
  }
  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  }).getClient();
}

async function getSheets() {
  const auth = await getClient();
  return google.sheets({ version: "v4", auth });
}

async function getRawRows() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A:Z`,
  });
  return res.data.values || [];
}

function parseRows(rows) {
  if (rows.length < 1) return { map: {}, rows: [] };
  const headers = rows[0].map(h => norm(h));
  const map = {};
  headers.forEach((h, i) => { if (h) map[h] = i; });

  const data = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 1;
    
    // LIMPIEZA EXTREMA: Quitamos cualquier cosa que no sea número o signo menos
    const rawDias = String(r[map["dias restantes"]] || "0").replace(/[^0-9\-]/g, "");
    const diasVal = parseInt(rawDias);
    
    let nombreC = (r[map["nombre"]] || "").trim();
    let estadoOriginal = (r[map["estado"]] || "").toUpperCase().trim();

    // LÓGICA DE ESTADO:
    let estadoFinal = estadoOriginal;

    // Si la celda está vacía o el nombre es "Disponible", no hacemos nada
    if (nombreC && norm(nombreC) !== "disponible") {
        // SI LOS DÍAS SON 0 O MENOS, ES VENCIDO POR NARICES
        if (!isNaN(diasVal) && diasVal <= 0) {
            estadoFinal = "VENCIDO";
        } else if (estadoOriginal !== "VENCIDO") {
            estadoFinal = "ACTIVO";
        }
    }

    data.push({
      row: rowNum,
      servicio: r[map["servicio"]] || "",
      correo: r[map["correo"]] || "",
      contrasena: r[map["contrasena"]] || r[map["password"]] || "",
      perfil: r[map["perfil"]] || "",
      pin: r[map["pin"]] || "",
      nombre: nombreC,
      telefono: r[map["telefono"]] || "",
      estado: estadoFinal,
      inicio: r[map["fecha de inicio"]] || "",
      vencimiento: r[map["fecha de vencimiento"]] || "",
      dias: isNaN(diasVal) ? 0 : diasVal
    });
  }
  return { map, rows: data };
}

async function getDashboard() {
  const raw = await getRawRows();
  return parseRows(raw);
}

function buildUpdatesForRow(map, rowNumber, data) {
  const updates = [];
  for (const key in data) {
    const colName = norm(key);
    if (map[colName] !== undefined) {
      const colLetter = String.fromCharCode(65 + map[colName]);
      updates.push({
        range: `${TAB}!${colLetter}${rowNumber}`,
        values: [[data[key]]]
      });
    }
  }
  return updates;
}

async function batchUpdate(resourceValues) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    resource: {
      valueInputOption: "USER_ENTERED",
      data: resourceValues
    }
  });
}

function getFormulas(dias) {
  const isEn = FORCED_LOCALE === "en";
  return {
    inicio: isEn ? "=TODAY()" : "=HOY()",
    vencimiento: isEn ? `=INDIRECT("RC[-1]"; FALSE) + ${dias}` : `=INDIRECT("RC[-1]"; FALSO) + ${dias}`,
    dias: isEn ? `=INDIRECT("RC[-1]"; FALSE) - TODAY()` : `=INDIRECT("RC[-1]"; FALSO) - HOY()`
  };
}

async function renovarFila({ rowNumber, dias }) {
  const { map } = await getDashboard();
  const formulas = getFormulas(dias);
  const updates = buildUpdatesForRow(map, rowNumber, {
    "Estado": "ACTIVO",
    "Fecha de inicio": formulas.inicio,
    "Fecha de vencimiento": formulas.vencimiento,
    "Días restantes": formulas.dias
  });
  await batchUpdate(updates);
  return { ok: true };
}

async function updateFila({ rowNumber, data }) {
  const { map } = await getDashboard();
  const updates = buildUpdatesForRow(map, rowNumber, data);
  await batchUpdate(updates);
  return { ok: true };
}

async function asignarEnFila({ rowNumber, nombre, telefono, dias }) {
  const { map, rows } = await getDashboard();
  const target = rows.find(r => Number(r.row) === rowNumber);
  if (!target) throw new Error("Fila no encontrada");

  const formulas = getFormulas(dias);
  const updates = buildUpdatesForRow(map, rowNumber, {
    "Nombre": nombre,
    "Telefono": telefono,
    "Teléfono": telefono,
    "Estado": "ACTIVO",
    "Fecha de inicio": formulas.inicio,
    "Fecha de vencimiento": formulas.vencimiento,
    "Días restantes": formulas.dias
  });

  await batchUpdate(updates);
  return {
    servicio: target.servicio,
    correo: target.correo,
    contrasena: target.contrasena,
    perfil: target.perfil,
    pin: target.pin
  };
}

async function eliminarCliente(rowNumber) {
  const { map } = await getDashboard();
  const updates = buildUpdatesForRow(map, rowNumber, {
    "Nombre": "Disponible", "Telefono": "", "Teléfono": "", "Estado": "",
    "Fecha de inicio": "", "Fecha de vencimiento": "", "Días restantes": ""
  });
  await batchUpdate(updates);
  return { ok: true };
}

async function reasignarCuenta({ fromRow, toRow }) {
  const { map, rows } = await getDashboard();
  const src = rows.find(r => Number(r.row) === Number(fromRow));
  const dest = rows.find(r => Number(r.row) === Number(toRow));

  if (!src || norm(src.nombre) === "disponible") throw new Error("Origen no válido.");
  if (!dest || norm(dest.nombre) !== "disponible") throw new Error("Destino no disponible.");

  const diasRestantes = parseInt(src.dias) || 30;
  const formulas = getFormulas(diasRestantes);

  const updatesDest = buildUpdatesForRow(map, dest.row, {
    "Nombre": src.nombre,
    "Telefono": src.telefono || "",
    "Teléfono": src.telefono || "",
    "Estado": "ACTIVO",
    "Fecha de inicio": formulas.inicio,
    "Fecha de vencimiento": formulas.vencimiento,
    "Días restantes": formulas.dias
  });

  const updatesSrc = buildUpdatesForRow(map, src.row, {
    "Nombre": "Disponible", "Telefono": "", "Teléfono": "", "Estado": "",
    "Fecha de inicio": "", "Fecha de vencimiento": "", "Días restantes": ""
  });

  await batchUpdate([...updatesDest, ...updatesSrc]);
  return { ok: true, servicio: src.servicio, correo: dest.correo, contrasena: dest.contrasena, perfil: dest.perfil, pin: dest.pin };
}

module.exports = { getDashboard, renovarFila, updateFila, asignarEnFila, eliminarCliente, reasignarCuenta };
