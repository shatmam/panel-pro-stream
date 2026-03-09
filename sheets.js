const { google } = require("googleapis");

const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Clientes";

async function getClient() {
  let auth;
  try {
    // PRIORIDAD 1: Variable de entorno (Para Railway)
    if (process.env.GOOGLE_SERVICE_ACCOUNT) {
      const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
      auth = new google.auth.GoogleAuth({
        credentials: creds,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
    } 
    // PRIORIDAD 2: Archivo local (Para tu PC)
    else {
      auth = new google.auth.GoogleAuth({
        keyFile: "./credentials.json",
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
    }
    return google.sheets({ version: "v4", auth });
  } catch (err) {
    console.error("ERROR CRÍTICO DE AUTENTICACIÓN:", err.message);
    throw err; // Esto enviará el error al log de Railway sin tumbar todo el sistema
  }
}

// ... aquí siguen tus funciones (getDashboard, renovarFila, etc.) tal cual las tenías ...
// Asegúrate de que todas estén exportadas al final
module.exports = { getDashboard, renovarFila, asignarEnFila, eliminarCliente, reasignarCuenta };
