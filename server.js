require("dotenv").config();
const express = require("express");
const path = require("path");
const {
  getDashboard,
  renovarFila,
  updateFila,
  asignarEnFila,
  eliminarCliente,
  reasignarCuenta
} = require("./sheets");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

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
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/renovar", auth, async (req, res) => {
  try {
    const { row, dias } = req.body || {};
    if (!row || !dias) return res.status(400).json({ ok: false, error: "Faltan {row, dias}" });
    const out = await renovarFila(Number(row), Number(dias));
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/update", auth, async (req, res) => {
  try {
    const { row, fields } = req.body || {};
    if (!row || !fields || typeof fields !== "object") {
      return res.status(400).json({ ok: false, error: "Faltan {row, fields}" });
    }
    const out = await updateFila(Number(row), fields);
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/asignar", auth, async (req, res) => {
  try {
    const { row, nombre, telefono, dias } = req.body || {};
    if (!row || !nombre || !telefono) {
      return res.status(400).json({ ok: false, error: "Faltan {row, nombre, telefono}" });
    }
    const out = await asignarEnFila({ rowNumber: Number(row), nombre, telefono, dias: dias ?? 30 });
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/delete", auth, async (req, res) => {
  try {
    const { row } = req.body || {};
    if (!row) return res.status(400).json({ ok: false, error: "Falta {row}" });
    const out = await eliminarCliente(Number(row));
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/reassign", auth, async (req, res) => {
  try {
    const { fromRow, toRow } = req.body || {};
    if (!fromRow || !toRow) return res.status(400).json({ ok: false, error: "Faltan {fromRow, toRow}" });
    const out = await reasignarCuenta({ fromRow: Number(fromRow), toRow: Number(toRow) });
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// --- SOLUCIÓN FINAL PARA EL ERROR DE RUTA ---
// Esta RegExp captura cualquier ruta que no sea de la API y sirve el frontend.
app.get(/^(?!\/api).+/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor en puerto " + PORT);
});
