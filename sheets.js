const fs = require("fs");
const { google } = require("googleapis");

const SHEET_ID = process.env.SHEET_ID;
const TAB = process.env.SHEET_TAB || "Clientes";
const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || "./credentials.json";
const FORCED_LOCALE = (process.env.SHEETS_LOCALE || "").toLowerCase().trim();

function norm(s) {
  return String(s ?? "").toLowerCase().trim()
    .replace(/\s+/g, " ")
    .replace(/[áàä]/g, "a").replace(/[éèë]/g, "e").replace(/[íìï]/g, "i").replace(/[óòö]/g, "o").replace(/[úùü]/g, "u");
}

function parseRows(rows) {
  if (rows.length < 1) return { map: {}, rows: [], stats: { total: 0, active: 0, expired: 0, available: 0 } };
  
  const headers = rows[0].map(h => norm(h));
  const map = {};
  headers.forEach((h, i) => { if (h) map[h] = i; });

  let parsed = [];
  let stats = { total: 0, active: 0, expired: 0, available: 0 };

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[map["servicio"]] && !r[map["correo"]]) continue;

    const rowNum = i + 1;
    const nombreRaw = (r[map["nombre"]] || "").trim();
    const esDisponible = !nombreRaw || norm(nombreRaw) === "disponible";

    const rawDias = String(r[map["dias restantes"]] || "0").replace(/[^0-9\-]/g, "");
    let diasVal = parseInt(rawDias);
    if (isNaN(diasVal)) diasVal = 0;

    let estadoFinal = "";
    if (esDisponible) {
      estadoFinal = "DISPONIBLE";
      stats.available++;
    } else {
      stats.total++; // Cuenta como cliente real
      if (diasVal <= 0) {
        estadoFinal = "VENCIDO";
        stats.expired++;
      } else {
        estadoFinal = "ACTIVO";
        stats.active++;
      }
    }

    parsed.push({
      row: rowNum,
      servicio: r[map["servicio"]] || "",
      correo: r[map["correo"]] || "",
      contrasena: r[map["contrasena"]] || r[map["password"]] || "",
      perfil: r[map["perfil"]] || "",
      pin: r[map["pin"]] || "",
      nombre: esDisponible ? "Disponible" : nombreRaw,
      telefono: r[map["telefono"]] || "",
      estado: estadoFinal,
      inicio: r[map["fecha de inicio"]] || "",
      vencimiento: r[map["fecha de vencimiento"]] || "",
      dias: diasVal
    });
  }

  // ORDEN: Vencidos (1), Activos (2), Disponibles (3)
  parsed.sort((a, b) => {
    const p = { "VENCIDO": 1, "ACTIVO": 2, "DISPONIBLE": 3 };
    if (p[a.estado] !== p[b.estado]) return p[a.estado] - p[b.estado];
    return a.dias - b.dias;
  });

  return { map, rows: parsed, stats };
}

// ... (El resto de funciones como getDashboard, renovarFila, etc., se mantienen igual)
// Asegúrate de exportar correctamente al final:
module.exports = { getDashboard, renovarFila, updateFila, asignarEnFila, eliminarCliente, reasignarCuenta };
