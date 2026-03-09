const fs = require("fs");
const { google } = require("googleapis");

const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Clientes";
const CREDENTIALS_PATH = "./credentials.json";

async function getClient() {
  let auth;
  
  // Lógica para Railway: Intentar leer de variable de entorno primero
  if (process.env.GOOGLE_SERVICE_ACCOUNT) {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  } 
  // Si no, intentar leer el archivo local
  else if (fs.existsSync(CREDENTIALS_PATH)) {
    auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  } else {
    throw new Error("No se encontraron credenciales (ni archivo credentials.json ni variable GOOGLE_SERVICE_ACCOUNT)");
  }

  return google.sheets({ version: "v4", auth });
}

// ... (El resto de tus funciones getDashboard, asignarEnFila, etc., se mantienen igual)
// Asegúrate de exportarlas al final:
module.exports = { getDashboard, renovarFila, asignarEnFila, eliminarCliente, reasignarCuenta };
