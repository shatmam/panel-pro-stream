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

// Configuraciones base (Sin mover carpetas para no romper rutas de archivos)
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname)); 

// Middleware de Autenticación (Original)
function auth(req, res, next) {
  const required = process.env.ADMIN_KEY;
  if (!required) return next();
  const key = req.headers["x-admin-key"];
  if (key !== required) return res.status(401).json({ ok: false, error: "No autorizado" });
  next();
}

// --- RUTAS DE NAVEGACIÓN ---

// Ruta para el Panel de Clientes (Principal)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Ruta para el nuevo Panel de Proveedores
app.get("/proveedores", (req, res) => {
  res.sendFile(path.join(__dirname, "proveedores.html"));
});


// --- ENDPOINTS DE API (LOGICA ORIGINAL) ---

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

// --- API: RENOVAR PROVEEDOR (COLUMNA M) ---
app.post("/api/renovar-proveedor", auth, async (req, res) => {
  try {
    const { correo, dias } = req.body || {};
    if (!correo || !dias) return res.status(400).json({ ok: false, error: "Faltan {correo, dias}" });

    const data = await getDashboard();
    // Filtramos las filas que coinciden con el correo del proveedor
    const filasCoincidentes = data.rows.filter(f => f.correo === correo);

    if (filasCoincidentes.length === 0) {
      return res.status(404).json({ ok: false, error: "No se encontraron filas con ese correo" });
    }

    // Actualizamos la columna M a través de la propiedad 'fechaProveedor'
    for (const fila of filasCoincidentes) {
      await updateFila(Number(fila.row), { fechaProveedor: dias });
    }

    res.json({ ok: true, message: `Proveedor actualizado en ${filasCoincidentes.length} filas.` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Redirección final para rutas no encontradas (Evita el error de "Cannot GET")
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor corriendo exitosamente en puerto " + PORT);
});
