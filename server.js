import express from "express";
import cors from "cors";
import { google } from "googleapis";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

let sheets;

async function initGoogle() {

  try {

    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });

    sheets = google.sheets({ version: "v4", auth });

    console.log("Google Sheets conectado");

  } catch (err) {

    console.error("Error credenciales:", err.message);

  }

}

function norm(v) {
  return (v || "").toString().trim().toLowerCase();
}

async function getRows() {

  try {

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Clientes!A2:M"
    });

    return res.data.values || [];

  } catch (err) {

    console.error("Error leyendo sheet:", err.message);
    return [];

  }

}

async function updateRow(row, values) {

  try {

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Clientes!A${row}:M${row}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [values] }
    });

  } catch (err) {

    console.error("Error actualizando fila:", err.message);

  }

}

app.get("/", (req, res) => {
  res.send("Servidor Streaming OK");
});

app.get("/cuentas", async (req, res) => {

  const rows = await getRows();

  res.json(rows);

});

app.post("/asignar", async (req, res) => {

  try {

    const { nombre, telefono, servicio } = req.body;

    const rows = await getRows();

    for (let i = 0; i < rows.length; i++) {

      const row = rows[i];

      const cliente = norm(row[1]);
      const servicioRow = norm(row[3]);

      if ((cliente === "disponible" || cliente === "") && servicioRow === norm(servicio)) {

        const rowNumber = i + 2;

        const hoy = new Date();
        const venc = new Date();
        venc.setDate(hoy.getDate() + 30);

        const inicio = hoy.toISOString().split("T")[0];
        const vencimiento = venc.toISOString().split("T")[0];

        const newRow = [...row];

        newRow[1] = nombre;
        newRow[2] = telefono;
        newRow[8] = inicio;
        newRow[9] = vencimiento;
        newRow[11] = "ACTIVO";

        await updateRow(rowNumber, newRow);

        return res.json({ ok: true, cuenta: newRow });

      }

    }

    res.json({ ok: false, msg: "No hay cuentas disponibles" });

  } catch (err) {

    console.error(err);
    res.json({ ok: false });

  }

});

app.post("/liberar", async (req, res) => {

  try {

    const { codigo } = req.body;

    const rows = await getRows();

    for (let i = 0; i < rows.length; i++) {

      if (rows[i][0] === codigo) {

        const rowNumber = i + 2;

        const row = rows[i];

        row[1] = "Disponible";
        row[2] = "";
        row[8] = "";
        row[9] = "";
        row[11] = "";

        await updateRow(rowNumber, row);

        return res.json({ ok: true });

      }

    }

    res.json({ ok: false });

  } catch (err) {

    console.error(err);
    res.json({ ok: false });

  }

});

app.post("/renovar", async (req, res) => {

  try {

    const { codigo, dias } = req.body;

    const rows = await getRows();

    for (let i = 0; i < rows.length; i++) {

      if (rows[i][0] === codigo) {

        const rowNumber = i + 2;

        const row = rows[i];

        const venc = new Date(row[9]);

        venc.setDate(venc.getDate() + Number(dias));

        row[9] = venc.toISOString().split("T")[0];

        await updateRow(rowNumber, row);

        return res.json({ ok: true });

      }

    }

    res.json({ ok: false });

  } catch (err) {

    console.error(err);
    res.json({ ok: false });

  }

});

initGoogle().then(() => {

  app.listen(PORT, () => {
    console.log("Servidor corriendo en puerto " + PORT);
  });

});
