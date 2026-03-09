const fs = require("fs");
const { google } = require("googleapis");

const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Clientes";
const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || "./credentials.json";
const FORCED_LOCALE = (process.env.SHEETS_LOCALE || "").toLowerCase().trim();

function norm(s) {
  return String(s ?? "").toLowerCase().trim()
    .replace(/\s+/g, " ")
    .replace(/[áàä]/g, "a").replace(/[éèë]/g, "e").replace(/[íìï]/g, "i").replace(/[óòö]/g, "o").replace(/[úùü]/g, "u");
}

function requireEnv() {
  if (!SHEET_ID) throw new Error("Falta SHEET_ID en las variables de entorno");
  if (!process.env.GOOGLE_CREDENTIALS_JSON && !fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error("No se encontró GOOGLE_CREDENTIALS_JSON ni el archivo credentials.json");
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
    } catch (e) { console.error("Error credenciales:", e.message); }
  }
  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  return new google.auth.GoogleAuth({ credentials: creds, scopes: ["https://www.googleapis.com/auth/spreadsheets"] }).getClient();
}

async function getSheets() {
  const auth = await getClient();
  return google.sheets({ version: "v4", auth });
}

async function getRawRows() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TAB}!A:Z` });
  return res.data.values || [];
}

function parseRows(rows) {
  if (rows.length < 1) return { map: {}, rows: [], stats: { vencidos: 0, activos: 0, disponibles: 0, total: 0 } };
  const headers = rows[0].map(h => norm(h));
  const map = {};
  headers.forEach((h, i) => { if (h) map[h] = i; });

  let parsed = [];
  let stats = { vencidos: 0, activos: 0, disponibles: 0, total: 0 };

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[map["servicio"]] && !r[map["correo"]]) continue; 

    const rowNum = i + 1;
    const nombreRaw = (r[map["nombre"]] || "").trim();
    const esDisponible = !nombreRaw || norm(nombreRaw) === "disponible";

    const rawDias = String(r[map["dias restantes"]] || "0").replace(/[^0-9\-]/g, "");
    let diasVal = parseInt(rawDias);
    if (isNaN(diasVal)) diasVal = 0;

    let estadoFinal = "";
    
    if (esDisponible) {
      estadoFinal = "DISPONIBLE";
      stats.disponibles++;
    } else {
      stats.total++; // Es un cliente real
      if (diasVal <= 0) {
        estadoFinal = "VENCIDO";
        stats.vencidos++;
      } else {
        estadoFinal = "ACTIVO";
        stats.activos++;
      }
    }

    parsed.push({
      row: rowNum,
      servicio: r[map["servicio"]] || "",
      correo: r[map["correo"]] || "",
      contrasena: r[map["contrasena"]] || r[map["password"]] || "",
      perfil: r[map["perfil"]] || "",
      pin: r[map["pin"]] || "",
      nombre: esDisponible ? "Disponible" : nombreRaw,
      telefono: r[map["telefono"]] || "",
      estado: estadoFinal,
      inicio: r[map["fecha de inicio"]] || "",
      vencimiento: r[map["fecha de vencimiento"]] || "",
      dias: diasVal
    });
  }

  // ORDEN: 1. Vencidos, 2. Activos (por días), 3. Disponibles
  parsed.sort((a, b) => {
    const prioridad = { "VENCIDO": 1, "ACTIVO": 2, "DISPONIBLE": 3 };
    if (prioridad[a.estado] !== prioridad[b.estado]) return prioridad[a.estado] - prioridad[b.estado];
    return a.dias - b.dias;
  });

  return { map, rows: parsed, stats };
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
      updates.push({ range: `${TAB}!${colLetter}${rowNumber}`, values: [[data[key]]] });
    }
  }
  return updates;
}

async function batchUpdate(resourceValues) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    resource: { valueInputOption: "USER_ENTERED", data: resourceValues }
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
    "Estado": "ACTIVO", "Fecha de inicio": formulas.inicio, "Fecha de vencimiento": formulas.vencimiento, "Días restantes": formulas.dias
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
  const { map } = await getDashboard();
  const formulas = getFormulas(dias);
  const updates = buildUpdatesForRow(map, rowNumber, {
    "Nombre": nombre, "Telefono": telefono, "Teléfono": telefono, "Estado": "ACTIVO",
    "Fecha de inicio": formulas.inicio, "Fecha de vencimiento": formulas.vencimiento, "Días restantes": formulas.dias
  });
  await batchUpdate(updates);
  return { ok: true };
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
  const rawRows = await getRawRows();
  const headers = rawRows[0].map(h => norm(h));
  const localMap = {};
  headers.forEach((h, i) => { if (h) localMap[h] = i; });
  const destData = rawRows[toRow - 1];

  const diasRestantes = parseInt(src.dias) || 30;
  const formulas = getFormulas(diasRestantes);

  const updatesDest = buildUpdatesForRow(localMap, toRow, {
    "Nombre": src.nombre, "Telefono": src.telefono || "", "Teléfono": src.telefono || "", "Estado": "ACTIVO",
    "Fecha de inicio": formulas.inicio, "Fecha de vencimiento": formulas.vencimiento, "Días restantes": formulas.dias
  });

  const updatesSrc = buildUpdatesForRow(localMap, fromRow, {
    "Nombre": "Disponible", "Telefono": "", "Teléfono": "", "Estado": "",
    "Fecha de inicio": "", "Fecha de vencimiento": "", "Días restantes": ""
  });

  await batchUpdate([...updatesDest, ...updatesSrc]);
  return { 
    ok: true, 
    servicio: src.servicio, 
    correo: destData[localMap["correo"]] || "", 
    contrasena: destData[localMap["contrasena"]] || destData[localMap["password"]] || "", 
    perfil: destData[localMap["perfil"]] || "", 
    pin: destData[localMap["pin"]] || "" 
  };
}

module.exports = { getDashboard, renovarFila, updateFila, asignarEnFila, eliminarCliente, reasignarCuenta };
