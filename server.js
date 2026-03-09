import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { google } from "googleapis";

const app = express();

app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

function norm(v) {
  return (v || "").toString().trim().toLowerCase();
}

async function getRows() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Clientes!A2:M"
  });

  return res.data.values || [];
}

async function updateRow(row, values) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Clientes!A${row}:M${row}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [values]
    }
  });
}

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

      const estadoNombre = norm(row[1]);
      const servicioRow = norm(row[3]);

      if (
        (estadoNombre === "disponible" || estadoNombre === "") &&
        servicioRow === norm(servicio)
      ) {

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

        return res.json({
          ok: true,
          cuenta: newRow
        });
      }
    }

    res.json({ ok: false, msg: "No hay cuentas disponibles" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/liberar", async (req, res) => {

  const { codigo } = req.body;

  const rows = await getRows();

  for (let i = 0; i < rows.length; i++) {

    const row = rows[i];

    if (row[0] === codigo) {

      const rowNumber = i + 2;

      const newRow = [...row];

      newRow[1] = "Disponible";
      newRow[2] = "";
      newRow[8] = "";
      newRow[9] = "";
      newRow[11] = "";

      await updateRow(rowNumber, newRow);

      return res.json({ ok: true });
    }
  }

  res.json({ ok: false });
});

app.post("/renovar", async (req, res) => {

  const { codigo, dias } = req.body;

  const rows = await getRows();

  for (let i = 0; i < rows.length; i++) {

    const row = rows[i];

    if (row[0] === codigo) {

      const rowNumber = i + 2;

      const venc = new Date(row[9]);
      venc.setDate(venc.getDate() + Number(dias));

      const newRow = [...row];
      newRow[9] = venc.toISOString().split("T")[0];

      await updateRow(rowNumber, newRow);

      return res.json({ ok: true });
    }
  }

  res.json({ ok: false });
});

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});
