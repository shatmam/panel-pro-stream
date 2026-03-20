require("dotenv").config();
const fs = require("fs");
const { google } = require("googleapis");

const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Hoja1";
const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || "./credentials.json";

// Auxiliar para limpiar texto
function norm(s) {
  return String(s ?? "").toLowerCase().trim();
}

// Procesa los días solo si son números válidos
function parseDias(x) {
  if (!x) return null;
  const clean = String(x).replace(",", ".").replace(/[^\d.-]/g, "");
  const n = parseFloat(clean);
  return isFinite(n) ? Math.floor(n) : null;
}

async function getClient() {
  let creds;
  if (process.env.GOOGLE_CREDS_JSON) {
    creds = JSON.parse(process.env.GOOGLE_CREDS_JSON);
  } else {
    creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  }
  return google.sheets({ 
    version: "v4", 
    auth: new google.auth.GoogleAuth({ credentials: creds, scopes: ["https://www.googleapis.com/auth/spreadsheets"] }) 
  });
}

async function readAll() {
  const sheets = await getClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TAB}!A:M` });
  const values = resp.data.values || [];

  if (!values.length) return { rows: [] };

  const processedRows = [];
  const rawData = values.slice(1); // Saltamos encabezado

  rawData.forEach((r, i) => {
    const rowNumber = i + 2;
    const nombreRaw = r[1] || "";
    const nombreNorm = norm(nombreRaw);

    // Ignorar filas totalmente vacías
    if (!r.some(c => String(c ?? "").trim() !== "")) return;

    const esDisponible = nombreNorm === "disponible" || nombreNorm === "";

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
      esDisponible: esDisponible
    };

    if (!esDisponible) {
      // SOLO SI HAY CLIENTE: Procesamos fechas y días
      const dCliente = parseDias(r[10]);
      rowData.vencimiento = r[9] || "";
      rowData.dias = dCliente !== null ? `${dCliente} DÍAS` : "Expira hoy";
      rowData.diasNum = dCliente ?? 0;
      
      // Bucket para colores
      if (rowData.diasNum <= 0) rowData.bucket = "vencidos";
      else if (rowData.diasNum <= 3) rowData.bucket = "porvencer";
      else rowData.bucket = "activos";

      // Datos Proveedor
      rowData.venceProv = r[11] || "";
      rowData.diasProv = parseDias(r[12]) ?? 0;
    } else {
      // SI ESTÁ DISPONIBLE: Limpiamos todo rastro de fechas/días
      rowData.vencimiento = "";
      rowData.dias = ""; // Queda vacío en el panel
      rowData.diasNum = 999; 
      rowData.bucket = "disponible";
      rowData.venceProv = "";
      rowData.diasProv = null;
    }

    processedRows.push(rowData);
  });

  return { rows: processedRows };
}

async function getDashboard() {
  const { rows } = await readAll();
  
  // Contadores solo para clientes reales
  const clientes = rows.filter(r => !r.esDisponible);
  const counts = { vencidos: 0, porvencer: 0, activos: 0, total: clientes.length };
  clientes.forEach(r => { if(counts[r.bucket] !== undefined) counts[r.bucket]++; });

  // Stock de disponibles
  const availableByService = {};
  let availableTotal = 0;
  rows.forEach(r => {
    if (r.esDisponible && r.servicio) {
      availableTotal++;
      const svc = r.servicio.trim().toUpperCase();
      availableByService[svc] = (availableByService[svc] || 0) + 1;
    }
  });

  // Orden: Vencidos -> Por Vencer -> Activos -> Disponibles al final
  const order = { vencidos: 0, porvencer: 1, activos: 2, disponible: 3 };
  rows.sort((a, b) => {
    if (order[a.bucket] !== order[b.bucket]) return order[a.bucket] - order[b.bucket];
    return (a.diasNum || 0) - (b.diasNum || 0);
  });

  return { counts, rows, availableByService, availableTotal };
}

// --- ACCIONES RESTANTES ---

async function asignarEnFila({ rowNumber, nombre, telefono, dias = 30 }) {
  const sheets = await getClient();
  const hoy = new Date();
  const vence = new Date(hoy.getTime() + Number(dias) * 86400000);
  const isoVence = vence.toISOString().slice(0, 10);
  
  // Fórmula de días según tu configuración (usando J como referencia de fecha)
  const formula = `=SI(ESBLANCO(J${rowNumber});"";J${rowNumber}-HOY())`;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!B${rowNumber}:K${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { 
      values: [[nombre, telefono, undefined, undefined, undefined, undefined, undefined, hoy.toISOString().slice(0, 10), isoVence, formula]] 
    }
  });
  return { ok: true };
}

async function eliminarCliente(rowNumber) {
  const sheets = await getClient();
  // Al liberar, limpiamos Nombre y borramos Teléfono, Fechas y Días
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!B${rowNumber}:C${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["Disponible", ""]] }
  });
  // Limpiamos rango de fechas e inicio (I a K)
  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `${TAB}!I${rowNumber}:K${rowNumber}` });
  return { ok: true };
}

module.exports = { getDashboard, asignarEnFila, eliminarCliente };
