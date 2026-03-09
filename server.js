const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

let sheets;

async function init() {

  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

  const auth = new google.auth.GoogleAuth({
    credentials: credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  sheets = google.sheets({
    version: "v4",
    auth
  });

}

app.get("/", (req,res)=>{
  res.send("Servidor funcionando");
});

app.get("/cuentas", async (req,res)=>{

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Clientes!A2:M"
  });

  res.json(response.data.values || []);

});

init().then(()=>{

  app.listen(PORT,()=>{
    console.log("Servidor activo en puerto",PORT);
  });

});
