<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Super Streaming Admin</title>

  <style>
    :root{
      --bg0:#070A16; --bg1:#0B1026; --bg2:#0E173A;
      --line: rgba(255,255,255,.10);
      --txt:#F6F8FF; --muted:#B5C0FF;
      --red:#ff3b5f; --green:#18c964; --yellow:#f5b301;
      --cyan:#23d5f2; --blue:#4f8cff; --purple:#b094ff;
      --shadow: 0 20px 70px rgba(0,0,0,.55);
      --shadow2: 0 10px 30px rgba(0,0,0,.45);
    }
    *{box-sizing:border-box}
    html,body{height:100%}
    body{
      margin:0; font-family: system-ui, -apple-system, sans-serif;
      color:var(--txt);
      background: radial-gradient(900px 520px at 12% 8%, rgba(79,140,255,.22), transparent 60%),
                  linear-gradient(180deg, var(--bg0), var(--bg1) 40%, var(--bg2));
    }
    .wrap{max-width:1400px;margin:0 auto;padding:22px 18px 70px}
    .topbar{ display:flex;align-items:center;justify-content:space-between; gap:14px;flex-wrap:wrap; margin-bottom:18px; }
    .brand{display:flex;align-items:center;gap:14px;}
    .logo{ width:50px;height:50px;border-radius:18px; display:grid;place-items:center; font-weight:1000; background: linear-gradient(135deg, var(--blue), var(--purple)); border:1px solid var(--line); }
    .title h1{margin:0;font-size:22px;line-height:1}
    .title .sub{margin:0;color:var(--muted);font-size:12px}
    .top-actions{ display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end; }
    .k{font-size:12px;color:var(--muted);margin-bottom:6px}
    .input, select{ width:100%; padding:12px 14px; border-radius:14px; border:1px solid var(--line); background: rgba(10,14,35,.65); color:var(--txt); outline:none; }
    .btn{ border:0;cursor:pointer; padding:12px 16px; border-radius:14px; font-weight:900; color:#06101a; background: linear-gradient(135deg, var(--cyan), var(--blue)); transition:.12s; white-space:nowrap; }
    .btn-outline{ color:var(--txt); background: rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); }
    .btn-green{ background: linear-gradient(135deg, var(--green), var(--cyan)); }
    .kpis{ display:grid; grid-template-columns: repeat(3, 1fr); gap:16px; margin-bottom:18px; }
    .kpi{ background: rgba(12,16,35,.62); border:1px solid var(--line); border-radius: 22px; padding: 22px 18px; text-align:center; backdrop-filter: blur(16px); position:relative; }
    .kpi .n{ font-size:44px; font-weight:1000; margin:0; }
    .kpi .lbl{ color: var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:1.4px; }
    .panel{ background: rgba(12,16,35,.62); border:1px solid var(--line); border-radius: 22px; padding:18px; backdrop-filter: blur(16px); }
    .assign{ display:grid; grid-template-columns: 1.3fr 1.3fr 1.2fr auto; gap:14px; align-items:end; margin-bottom:14px; }
    .assign2{ display:grid; grid-template-columns: 2fr 1fr; gap:14px; align-items:end; margin-bottom:16px; }
    .tablewrap{ border-radius: 18px; border:1px solid var(--line); overflow:auto; background: rgba(9,12,28,.35); }
    table{ width:100%; border-collapse:collapse; min-width: 1200px; }
    th, td{ padding: 16px 14px; border-bottom:1px solid rgba(255,255,255,.06); font-size: 13px; }
    th{ color: var(--muted); text-transform:uppercase; font-size:11px; letter-spacing:.9px; background: rgba(9,12,28,.92); }
    .actions{ display:flex; gap:10px; }
    .a-btn{ border:0; cursor:pointer; padding:10px 14px; border-radius: 12px; font-weight:1000; font-size:12px; }
    .a-copy{ background: linear-gradient(135deg, var(--cyan), var(--blue)); }
    .a-renew{ background: var(--green); }
    .a-del{ background: var(--red); color:#fff; }
    .err{ display:none; margin: 10px 0; padding:12px; border-radius:14px; background: rgba(255,59,95,.14); color:#ffd5dc; }
    .chip{ padding:8px 12px; border-radius:999px; background: rgba(255,255,255,.06); font-size:12px; font-weight:900; }
  </style>
</head>

<body>
  <div class="wrap">
    <div class="topbar">
      <div class="brand">
        <div class="logo">SS</div>
        <div class="title">
          <h1>Panel de Clientes</h1>
          <p class="sub">renovaciones • asignaciones • control</p>
        </div>
      </div>

      <div class="top-actions">
        <div>
          <div class="k">Admin key (opcional)</div>
          <input class="input" id="adminKey" placeholder="Admin key..." style="width:180px"/>
        </div>

        <!-- BOTÓN NUEVO: PANEL PROVEEDORES -->
        <button class="btn" style="background: linear-gradient(135deg, var(--purple), var(--blue)); color:white;" onclick="window.location.href='/proveedores'">
          💳 PROVEEDORES
        </button>

        <button class="btn btn-outline" id="btnReload">Actualizar</button>

        <div class="inline" style="display:flex; gap:8px;">
          <select id="autoOn" class="input" style="width:120px">
            <option value="on" selected>Auto ON</option>
            <option value="off">Auto OFF</option>
          </select>
          <button class="btn btn-outline" id="btnAutoApply">Aplicar</button>
        </div>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><p class="n" id="cActivos">0</p><div class="lbl">ACTIVOS</div></div>
      <div class="kpi" style="color:var(--red)"><p class="n" id="cVencidos">0</p><div class="lbl">VENCIDOS</div></div>
      <div class="kpi"><p class="n" id="cTotal">0</p><div class="lbl">TOTAL</div></div>
    </div>

    <div class="panel">
      <div class="assign">
        <div><div class="k">SERVICIO</div><select id="asSvc" class="input"></select></div>
        <div><div class="k">CUENTA LIBRE</div><select id="asAccount" class="input"></select></div>
        <div><div class="k">CLIENTE</div><input id="asName" class="input" placeholder="Nombre"/></div>
        <button id="btnAssign" class="btn btn-green">✓ ASIGNAR</button>
      </div>

      <div class="assign2">
        <div><div class="k">TELÉFONO / DÍAS</div><div style="display:flex;gap:10px;"><input id="asTel" class="input" placeholder="Teléfono"/><input id="asDays" class="input" type="number" value="30" style="width:100px"/></div></div>
        <div><div class="k">FILTRAR</div><select id="f" class="input"><option value="">TODOS</option><option value="vencidos">VENCIDOS</option><option value="activos">ACTIVOS</option></select></div>
      </div>

      <input class="input" id="q" placeholder="Buscar cliente o cuenta..." style="margin-bottom:15px"/>
      <div id="status" style="font-size:12px; color:var(--muted)">Cargando...</div>
      <div id="err" class="err"></div>
      <div id="availBySvc" style="display:flex; gap:8px; margin-top:10px"></div>
      <div id="assignMsg" class="err" style="background:rgba(24,201,100,.1); border:1px solid var(--green); color:white; display:none"></div>

      <div class="tablewrap" style="margin-top:14px;">
        <table>
          <thead>
            <tr>
              <th>SERVICIO</th><th>CUENTA</th><th>CLIENTE</th><th>TELÉFONO</th><th>ESTADO</th><th>ACCIONES</th>
            </tr>
          </thead>
          <tbody id="tb"></tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    // Tu Script original de index.html sigue aquí debajo sin cambios...
    // (Pega aquí todo el bloque <script> que tenías en tu archivo original)
  </script>
</body>
</html>
