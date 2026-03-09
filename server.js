require("dotenv").config();
const express = require("express");
const path = require("path");
const {
  getDashboard,
  renovarFila,
  asignarEnFila,
  eliminarCliente,
  reasignarCuenta
} = require("./sheets");

const app = express();
app.use(express.json({ limit: "1mb" }));

// Servir archivos estáticos desde la raíz
app.use(express.static(__dirname));

function auth(req, res, next) {
  const required = process.env.ADMIN_KEY;
  if (!required) return next();
  const key = req.headers["x-admin-key"];
  if (key !== required) return res.status(401).json({ ok: false, error: "No autorizado" });
  next();
}

app.get("/api/dashboard", auth, async (req, res) => {
  try {
    const data = await getDashboard();
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/renovar", auth, async (req, res) => {
  try {
    const { row, dias } = req.body;
    const out = await renovarFila({ row: Number(row), dias: Number(dias) });
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/asignar", auth, async (req, res) => {
  try {
    const { row, nombre, telefono, dias } = req.body;
    const out = await asignarEnFila({ rowNumber: Number(row), nombre, telefono, dias: dias ?? 30 });
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/delete", auth, async (req, res) => {
  try {
    const { row } = req.body;
    const out = await eliminarCliente(Number(row));
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/reassign", auth, async (req, res) => {
  try {
    const { fromRow, toRow } = req.body;
    const out = await reasignarCuenta({ fromRow: Number(fromRow), toRow: Number(toRow) });
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Esta línea es vital: sirve el index.html para cualquier otra ruta
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
