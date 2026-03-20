require("dotenv").config();
const express = require("express");
const path = require("path");

const {
  getDashboard,
  renovarFila,
  updateFila,
  asignarEnFila,
  eliminarCliente,
  reasignarCuenta,
  getPagos,
  addPago
} = require("./sheets");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function auth(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (process.env.ADMIN_KEY && key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }
  next();
}

// CLIENTES
app.get("/api/dashboard", auth, async (req, res) => {
  const data = await getDashboard();
  res.json({ ok: true, ...data });
});

// PAGOS
app.get("/api/pagos", auth, async (req, res) => {
  const data = await getPagos();
  res.json({ ok: true, data });
});

app.post("/api/pagos/add", auth, async (req, res) => {
  const out = await addPago(req.body);
  res.json({ ok: true, ...out });
});

// FRONT
app.get(/^(?!\/api).+/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(3000, () => console.log("Servidor listo"));
