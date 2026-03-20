const fs = require("fs");
const { google } = require("googleapis");

const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Hoja1";
const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || "./credentials.json";

function parseDias(x) {
  if (x === undefined || x === null || x === "") return 0;
  const clean = String(x).replace(",", ".").replace(/[^\d.-]/g, "");
  const n = parseFloat(clean);
  return isFinite(n) ? Math.floor(n) : 0;
}

async function getClient() {
  let creds;
  if (process.env.GOOGLE_CREDS_JSON) {
    creds = JSON.parse(process.env.GOOGLE_CREDS_JSON);
  } else {
    creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  }
  return google.sheets({ version: "v4", auth: new google.auth.GoogleAuth({
    credentials: creds, scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  })});
}

async function readAll() {
  const sheets = await getClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TAB}!A:M` });
  const values = resp.data.values || [];
  if (!values.length) return { rows: [] };

  const processedRows = [];
  values.slice(1).forEach((r, i) => {
    const rowNumber = i + 2;
    if (!r[1] && !r[3] && !r[4]) return; // Ignorar si no hay nombre, servicio ni correo

    const nombreRaw = r[1] || "";
    const esDisponible = nombreRaw.toLowerCase().trim() === "disponible" || nombreRaw === "";

    const rowData = {
      row: rowNumber,
      codigo: r[0] || "",
      nombre: esDisponible ? "Disponible" : nombreRaw,
      telefono: r[2] || "",
      servicio: r[3] || "",
      correo: r[4] || "",
      contrasena: r[5] || "",
      perfil: r[6] || "",
      pin: r[7] || "",
      esDisponible
    };

    if (!esDisponible) {
      // Cliente (Índices J=9, K=10)
      const dCli = parseDias(r[10]);
      rowData.vencimiento = r[9] || "";
      rowData.dias = `${dCli} DÍAS`;
      rowData.diasNum = dCli;
      rowData.bucket = dCli <= 0 ? "vencidos" : (dCli <= 3 ? "porvencer" : "activos");
      
      // Proveedor (Índices L=11, M=12)
      const dProv = parseDias(r[12]);
      rowData.venceProv = r[11] || "";
      rowData.diasProv = dProv;
      rowData.diasProvTexto = `${dProv} DÍAS`;
    } else {
      rowData.vencimiento = "";
      rowData.dias = ""; // Limpio para disponibles
      rowData.diasNum = 999;
      rowData.bucket = "disponible";
    }
    processedRows.push(rowData);
  });
  return { rows: processedRows };
}

async function getDashboard() {
  const { rows } = await readAll();
  const clientes = rows.filter(r => !r.esDisponible);
  const counts = { vencidos: 0, porvencer: 0, activos: 0, total: clientes.length };
  clientes.forEach(r => { if(counts[r.bucket] !== undefined) counts[r.bucket]++; });

  const availableByService = {};
  rows.forEach(r => {
    if (r.esDisponible && r.servicio) {
      const s = r.servicio.toUpperCase();
      availableByService[s] = (availableByService[s] || 0) + 1;
    }
  });

  rows.sort((a, b) => {
    const order = { vencidos: 0, porvencer: 1, activos: 2, disponible: 3 };
    if (order[a.bucket] !== order[b.bucket]) return order[a.bucket] - order[b.bucket];
    return a.diasNum - b.diasNum;
  });

  return { counts, rows, availableByService, availableTotal: rows.filter(r => r.esDisponible).length };
}

async function getProveedores() {
  const { rows } = await readAll();
  // Mostramos todas las cuentas que tengan correo (estén o no disponibles)
  const cuentas = rows.filter(r => r.correo && r.correo.includes("@"));
  return {
    ok: true,
    rows: cuentas.map(r => ({
      ...r,
      bucketProv: r.diasProv <= 0 ? "vencidos" : (r.diasProv <= 5 ? "porvencer" : "activos")
    }))
  };
}

async function eliminarCliente(rowNumber) {
  const sheets = await getClient();
  // Limpiamos Columnas B (Nombre), C (Tel), I (Inicio), J (Venc), K (Días)
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!B${rowNumber}:C${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["Disponible", ""]] }
  });
  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `${TAB}!I${rowNumber}:K${rowNumber}` });
  return { ok: true };
}

async function asignarEnFila({ rowNumber, nombre, telefono, dias }) {
  const sheets = await getClient();
  const hoy = new Date();
  const vence = new Date(hoy.getTime() + dias * 86400000);
  const fVence = vence.toISOString().slice(0, 10);
  const formula = `=SI(ESBLANCO(J${rowNumber});"";J${rowNumber}-HOY())`;
  
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!B${rowNumber}:C${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[nombre, telefono]] }
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!I${rowNumber}:K${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[hoy.toISOString().slice(0, 10), fVence, formula]] }
  });
  return { ok: true };
}

module.exports = { getDashboard, getProveedores, eliminarCliente, asignarEnFila };
