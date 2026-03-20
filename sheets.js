async function readAll() {
  const sheets = await getClient();
  // Leemos hasta la columna M (Índice 12)
  const range = `${TAB}!A:M`; 
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });

  const values = resp.data.values || [];
  if (!values.length) return { rows: [] };

  const headerRowIndex = findHeaderRow(values);
  const header = values[headerRowIndex] || [];
  const map = headerMap(header);

  const rows = [];
  const rawData = values.slice(headerRowIndex + 1);

  rawData.forEach((r, i) => {
    const rowNumber = (headerRowIndex + 2) + i;
    if (!(r || []).some(c => String(c ?? "").trim() !== "")) return;

    const nombreRaw = r[map[norm("nombre")]] || "";
    const esDisp = norm(nombreRaw) === "disponible" || nombreRaw === "";

    // --- CÁLCULO DE DÍAS (CLIENTE) ---
    // Usamos el índice 10 (Columna K) para evitar el error del nombre
    const dCli = esDisp ? 0 : parseDias(r[10]); 

    // --- CÁLCULO DE DÍAS (PROVEEDOR) ---
    // Usamos el índice 12 (Columna M)
    const dProv = parseDias(r[12]); 

    rows.push({
      row: rowNumber,
      codigo: r[0] || "",
      nombre: esDisp ? "Disponible" : nombreRaw,
      telefono: r[map[norm("telefono")]] || "",
      servicio: r[map[norm("servicio")]] || "",
      correo: r[map[norm("correo")]] || "",
      contrasena: r[map[norm("contraseña")]] || r[map[norm("contrasena")]] || "",
      perfil: r[map[norm("perfil")]] || "",
      pin: r[map[norm("pin")]] || "",
      vencimiento: r[map[norm("fecha de vencimiento")]] || "",
      dias: esDisp ? "" : `${dCli} DÍAS`,
      diasNum: dCli,
      // Datos específicos del proveedor
      venceProv: r[11] || "", // Columna L
      diasProv: dProv,
      diasProvTexto: `${dProv} DÍAS`,
      bucket: esDisp ? "disponible" : bucketByDias(dCli),
      bucketProv: bucketByDias(dProv),
      esDisponible: esDisp
    });
  });

  return { headerRowIndex, header, map, rows };
}

// Asegúrate de exportar getProveedores al final
async function getProveedores() {
  const { rows } = await readAll();
  // Filtramos para que solo salgan filas que tengan un correo (cuentas reales)
  const cuentas = rows.filter(r => r.correo && r.correo.includes("@"));
  return { ok: true, rows: cuentas };
}
