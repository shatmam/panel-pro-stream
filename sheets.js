const { google } = require("googleapis");

const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Clientes";

async function getClient() {
  let auth;
  
  try {
    if (process.env.GOOGLE_SERVICE_ACCOUNT) {
      // Intenta leer desde la variable de entorno de Railway
      const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
      auth = new google.auth.GoogleAuth({
        credentials: creds,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
    } else {
      // Intenta leer desde el archivo local si existe
      auth = new google.auth.GoogleAuth({
        keyFile: "./credentials.json",
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
    }
    return google.sheets({ version: "v4", auth });
  } catch (err) {
    console.error("ERROR DE AUTENTICACIÓN:", err.message);
    throw new Error("Credenciales de Google no configuradas correctamente.");
  }
}

// ... Mantén el resto de tus funciones (getDashboard, asignarEnFila, etc.) igual ...
// Solo asegúrate de exportarlas al final:
module.exports = { getDashboard, renovarFila, asignarEnFila, eliminarCliente, reasignarCuenta };
