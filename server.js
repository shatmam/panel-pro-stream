require("dotenv").config();
const express = require("express");
const path = require("path");
const { getDashboard, renovarFila, asignarEnFila, eliminarCliente, reasignarCuenta } = require("./sheets");

const app = express();
app.use(express.json());

// Servir archivos estáticos desde la raíz y desde public (por si acaso)
app.use(express.static(__dirname));require("dotenv").config();
const express = require("express");
const path = require("path");
const { getDashboard, renovarFila, asignarEnFila, eliminarCliente, reasignarCuenta } = require("./sheets");

const app = express();
app.use(express.json());

// Servir archivos desde la raíz
app.use(express.static(__dirname));

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

// ... aquí van tus rutas POST (/api/asignar, /api/renovar, etc.) ...

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
app.use(express.static(path.join(__dirname, "public")));

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

// Rutas API (Asignar, Renovar, etc. - Mantenlas como las tienes)

app.get("*", (req, res) => {
  // Busca el index.html primero en raíz, luego en public
  res.sendFile(path.join(__dirname, "index.html"), (err) => {
    if (err) res.sendFile(path.join(__dirname, "public", "index.html"));
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor iniciado en puerto " + PORT));

