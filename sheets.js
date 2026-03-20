require("dotenv").config();
const fs = require("fs");
const { google } = require("googleapis");

const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Hoja1";
const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || "./credentials.json";

// --- UTILIDADES ---

function norm(s) {
  return String(s ?? "").toLowerCase().trim();
}

// Función robusta: Si no es número, devuelve 0. NUNCA devuelve NaN.
function parseDias(x) {
  if (x === undefined || x === null || x === "") return 0;
  const clean = String(x).replace(",", ".").replace(/[^\d.-]/g, "");
  const n = parseFloat(clean);
  return isFinite(n) ? Math.floor(n) : 0;
}

function bucketByDias(d) {
  if (d <= 0) return "vencidos";
  if (d >= 1 && d <= 3) return "porvencer";
  return "activos";
}

// --- CLIENTE GOOGLE ---

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

// --- LÓGICA PRINCIPAL ---

async function readAll() {
  const sheets = await getClient();
  // Leemos hasta la M para asegurar que entran los días del proveedor
  const range = `${TAB}!A:M`;
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });
  const values = resp.data.values || [];

  if (!values.length) return { rows: [] };

  const processedRows = [];
  // Saltamos la fila 1 (encabezados)
  const rawData = values.slice(1); 

  rawData.forEach((r, i) => {
    const rowNumber = i + 2;
    
    // Validar si la fila tiene datos mínimos (Columna B o D)
    if (!r[1] && !r[3]) return; 

    const nombreRaw = r[1] || "";
    const nombreNorm = norm(nombreRaw);
    const esDisponible = nombreNorm === "disponible" || nombreNorm === "";

    // Mapeo por ÍNDICE FIJO (Basado estrictamente en tu captura)
    // A=0, B=1, C=2, D=3, E=4, F=5, G=6, H=7, I=8, J=9, K=10, L=11, M=12
    
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
      // CLIENTE ASIGNADO: Leemos columna K (índice 10)
      const dCliente = parseDias(r[10]); 
      rowData.vencimiento = r[9] || "";
      rowData.dias = `${dCliente} DÍAS`;
      rowData.diasNum = dCliente;
      rowData.bucket = bucketByDias(dCliente);

      // PROVEEDOR: Leemos columna M (índice 12)
      rowData.venceProv = r[11] || "";
      const dProv = parseDias(r[12]);
      rowData.diasProv = dProv;
      rowData.diasProvTexto = `${dProv} DÍAS`;
    } else {
      // DISPONIBLE: Limpiamos todo para que el HTML no muestre nada
      rowData.vencimiento = "";
      rowData.dias = ""; 
      rowData.diasNum = 999;
      rowData.bucket = "disponible";
      rowData.venceProv = "";
      rowData.diasProv = 0;
      rowData.diasProvTexto = "";
    }

    processedRows.push(rowData);
  });

  return { rows: processedRows };
}

async function getDashboard() {
  const { rows } = await readAll();
  
  // Estadísticas (solo clientes, no disponibles)
  const clientes = rows.filter(r => !r.esDisponible);
  const counts = { vencidos: 0, porvencer: 0, activos: 0, total: clientes.length };
  clientes.forEach(r => { if(counts[r.bucket]) counts[r.bucket]++; });

  // Stock disponible
  const availableByService = {};
  let availableTotal = 0;
  rows.forEach(r => {
    if (r.esDisponible && r.servicio) {
      availableTotal++;
      const svc = r.servicio.trim().toUpperCase();
      availableByService[svc] = (availableByService[svc] || 0) + 1;
    }
  });

  // Ordenar: Vencidos -> Por vencer -> Activos -> Disponibles
  const order = { vencidos: 0, porvencer: 1, activos: 2, disponible: 3 };
  rows.sort((a, b) => {
    if (order[a.bucket] !== order[b.bucket]) return order[a.bucket] - order[b.bucket];
    return a.diasNum - b.diasNum;
  });

  return { counts, rows, availableByService, availableTotal };
}

// Función nueva para la página de proveedores
async function getProveedores() {
  const { rows } = await readAll();
  // Solo filas que tengan una cuenta (correo)
  const soloCuentas = rows.filter(r => r.correo && r.correo.includes("@"));
  
  return { 
    ok: true, 
    rows: soloCuentas.map(r => ({
      ...r,
      // Estado basado en el proveedor (Columna M)
      bucketProv: r.diasProv <= 0 ? "vencidos" : (r.diasProv <= 5 ? "porvencer" : "activos")
    }))
  };
}

module.exports = {
  getDashboard,
  getProveedores,
  // ... (Aquí van asignarEnFila, eliminarCliente, etc. que ya tienes)
};
