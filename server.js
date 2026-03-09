require("dotenv").config();
const express = require("express");
const path = require("path");
const { getDashboard, renovarFila, asignarEnFila, eliminarCliente, reasignarCuenta } = require("./sheets");

const app = express();
app.use(express.json());
app.use(express.static(__dirname)); // Sirve index.html desde la raíz

function auth(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (process.env.ADMIN_KEY && key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
}

app.get("/api/dashboard", auth, async (req, res) => {
  try { res.json(await getDashboard()); } 
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ... (tus otras rutas POST /api/asignar, etc.)

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor listo en puerto " + PORT));
