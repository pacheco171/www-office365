/* ══════════ CHECKLIST — Consistencia Fonte vs Sistema ══════════ */

/* ── Comparar CSV uploadado vs dados atuais do sistema (sem importar) ── */
function auditFromCSV(event) {
  var file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  var statusEl = document.getElementById('auditStatusText');
  var resultsEl = document.getElementById('auditResults');
  statusEl.textContent = 'Lendo CSV...';
  resultsEl.innerHTML = '';

  var reader = new FileReader();
  reader.onload = function(ev) {
    var text = ev.target.result.replace(/^\uFEFF/, '');
    var csvMap = _parseAuditCSV(text);
    if (!csvMap) {
      statusEl.textContent = '';
      resultsEl.innerHTML = '<div class="audit-error">CSV invalido ou sem colunas reconhecidas.</div>';
      return;
    }

    // Montar mapa do sistema atual
    var dbMap = {};
    db.forEach(function(r) {
      var email = (r.email || '').toLowerCase().trim();
      if (email) dbMap[email] = r;
    });

    // Comparar
    var diffs = _compareAuditMaps(csvMap, dbMap);
    var data = {
      ok: true,
      source: 'CSV (' + file.name + ')',
      total_fonte: Object.keys(csvMap).length,
      total_sistema: Object.keys(dbMap).length,
      total_diffs: diffs.length,
      diffs: diffs,
    };
    renderAuditResults(data);
  };
  reader.readAsText(file, 'UTF-8');
}

function _parseAuditCSV(text) {
  var lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;

  function parseLine(line) {
    var res = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') inQ = !inQ;
      else if (c === ',' && !inQ) { res.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    res.push(cur.trim());
    return res;
  }

  var headers = parseLine(lines[0]).map(function(h) { return h.toLowerCase().replace(/['"]/g, '').trim(); });
  var fc = function(keys) {
    for (var k = 0; k < keys.length; k++) {
      var i = headers.indexOf(keys[k]);
      if (i >= 0) return i;
    }
    return -1;
  };

  var iNome = fc(['display name', 'name', 'displayname', 'nome']);
  var iEmail = fc(['user principal name', 'emailaddress', 'email', 'mail', 'userprincipalname']);
  var iSetor = fc(['department', 'departamento', 'setor']);
  var iCargo = fc(['title', 'cargo', 'jobtitle']);
  var iLic = fc(['licenses', 'licenças', 'license', 'licenca']);
  var iBlocked = fc(['block credential', 'blockcredential']);
  var iOU = fc(['ou', 'organizationalunit', 'distinguishedname']);

  if (iEmail < 0 && iNome < 0) return null;

  var DOMAIN = 'liveoficial.com.br';
  var map = {};

  for (var i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    var cols = parseLine(lines[i]);
    var get = function(ix) { return (ix >= 0 && cols[ix]) ? cols[ix].replace(/^"|"$/g, '').trim() : ''; };

    var email = get(iEmail).toLowerCase();
    if (!email || !email.includes('@' + DOMAIN) || email.includes('#ext#')) continue;

    var nomeRaw = get(iNome);
    // Limpar sufixo " - Setor" do Display Name
    var nome = nomeRaw;
    var sufMatch = !/^L\d{3}\b/i.test(nomeRaw) && !/Placa:/i.test(nomeRaw) && nomeRaw.match(/^(.+?)\s+-\s+([A-Z\u00C0-\u00DA\u00C7a-z\u00E0-\u00FA\u00E7][A-Z\u00C0-\u00DA\u00C7a-z\u00E0-\u00FA\u00E70-9&!.\- ]*?)$/);
    var nomeSuffix = null;
    if (sufMatch) {
      nome = sufMatch[1].trim();
      nomeSuffix = sufMatch[2].trim();
    }

    var deptRaw = get(iSetor);
    var setor = deptRaw || 'Sem Setor';
    var area = null;
    // Parse hierarquia do department
    var seps = [' - ', ' / ', ' > ', ' | '];
    for (var s = 0; s < seps.length; s++) {
      var pos = setor.indexOf(seps[s]);
      if (pos > 0) {
        area = setor.substring(pos + seps[s].length).trim();
        setor = setor.substring(0, pos).trim();
        break;
      }
    }
    // Tentar OU/DistinguishedName
    var ouRaw = get(iOU);
    if (ouRaw && ouRaw.includes('OU=')) {
      var ous = [];
      ouRaw.split(',').forEach(function(part) {
        part = part.trim();
        if (part.toUpperCase().indexOf('OU=') === 0) ous.push(part.substring(3));
      });
      // Remover OU raiz "Setores" se presente
      if (ous.length && ous[ous.length - 1].toLowerCase() === 'setores') ous.pop();
      if (ous.length >= 2) {
        setor = ous[ous.length - 1]; // macro
        area = ous[0]; // mais proximo do user
      } else if (ous.length === 1) {
        setor = ous[0];
      }
    }
    if (setor === 'Sem Setor' && nomeSuffix) setor = nomeSuffix;
    // Normalizar setor
    if (typeof normalizeSetor === 'function') setor = normalizeSetor(setor);
    if (typeof SETOR_NORMALIZE !== 'undefined' && SETOR_NORMALIZE[setor]) setor = SETOR_NORMALIZE[setor];

    var cargo = get(iCargo) || 'Colaborador';
    var licRawVal = get(iLic);
    var licResult = (typeof resolveLicIds === 'function') ? resolveLicIds(licRawVal) : { licId: 'none', addons: [] };
    var blocked = get(iBlocked).toLowerCase();
    var status = (blocked === 'true') ? 'Inativo' : 'Ativo';

    map[email] = {
      nome: nome,
      setor: setor,
      area: area,
      cargo: cargo,
      licId: licResult.licId,
      addons: licResult.addons,
      status: status,
    };
  }

  return Object.keys(map).length ? map : null;
}

/** Limpa sufixo " - Setor" do nome (ex: "Enzzo Pacheco - TI" -> "Enzzo Pacheco") */
function _cleanNameSuffix(name) {
  if (!name) return '';
  var m = name.match(/^(.+?)\s+-\s+[A-Z\u00C0-\u00DA\u00C7a-z\u00E0-\u00FA\u00E7]/);
  if (m) return m[1].trim();
  return name.trim();
}

/** Normaliza string para comparacao (trim, lowercase de acentos consistente) */
function _normCompare(s) {
  return (s || '').trim().replace(/\s+/g, ' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function _compareAuditMaps(sourceMap, dbMap) {
  var diffs = [];
  var allEmails = {};
  Object.keys(sourceMap).forEach(function(e) { allEmails[e] = true; });
  Object.keys(dbMap).forEach(function(e) { allEmails[e] = true; });

  Object.keys(allEmails).sort().forEach(function(email) {
    var src = sourceMap[email];
    var loc = dbMap[email];

    if (src && !loc) {
      diffs.push({ email: email, nome: src.nome || email, tipo: 'somente_fonte', campos: [], resumo: 'Existe no CSV mas nao no sistema' });
      return;
    }
    if (loc && !src) {
      diffs.push({ email: email, nome: loc.nome || email, tipo: 'somente_sistema', campos: [], resumo: 'Existe no sistema mas nao no CSV' });
      return;
    }

    var campos = [];
    var isSetorFixo = loc.setorFixo || false;
    var isCargoFixo = loc.cargoFixo || false;

    // Nome — limpar sufixo " - Setor" dos dois lados antes de comparar
    var srcNome = _cleanNameSuffix(src.nome);
    var locNome = _cleanNameSuffix(loc.nome);
    if (srcNome && _normCompare(srcNome) !== _normCompare(locNome))
      campos.push({ campo: 'nome', ad: srcNome, sistema: locNome, fixo: false });

    // Setor — ignorar se CSV vazio e sistema preenchido
    var srcSetor = _normCompare(src.setor);
    var locSetor = _normCompare(loc.setor);
    if (srcSetor && srcSetor !== (locSetor || 'sem setor'))
      campos.push({ campo: 'setor', ad: src.setor, sistema: loc.setor || 'Sem Setor', fixo: isSetorFixo });

    // Area — ignorar se CSV vazio e sistema preenchido
    var srcArea = _normCompare(src.area);
    var locArea = _normCompare(loc.area);
    if (srcArea && srcArea !== locArea)
      campos.push({ campo: 'area', ad: src.area || '(vazio)', sistema: loc.area || '(vazio)', fixo: isSetorFixo });

    // Cargo — ignorar se CSV vazio e sistema preenchido
    var srcCargo = _normCompare(src.cargo);
    var locCargo = _normCompare(loc.cargo);
    if (srcCargo && srcCargo !== locCargo)
      campos.push({ campo: 'cargo', ad: src.cargo, sistema: loc.cargo || '', fixo: isCargoFixo });

    // Licenca — ignorar se CSV vazio e sistema preenchido
    var srcLic = src.licId || '';
    var locLic = loc.licId || '';
    if (srcLic && srcLic !== locLic)
      campos.push({ campo: 'licenca', ad: srcLic || 'none', sistema: locLic || 'none', fixo: false });

    // Addons — ignorar se CSV vazio e sistema preenchido
    var srcAddons = (src.addons || []).slice().sort().join(',');
    var locAddons = (loc.addons || []).slice().sort().join(',');
    if (srcAddons && srcAddons !== locAddons)
      campos.push({ campo: 'addons', ad: srcAddons || '(nenhum)', sistema: locAddons || '(nenhum)', fixo: false });

    // Status — ignorar se CSV vazio e sistema preenchido
    if ((src.status || '') && (src.status || '') !== (loc.status || ''))
      campos.push({ campo: 'status', ad: src.status, sistema: loc.status || '', fixo: false });

    if (campos.length) {
      diffs.push({ email: email, nome: srcNome || email, tipo: 'divergencia', campos: campos, resumo: campos.map(function(c) { return c.campo; }).join(', ') });
    }
  });

  return diffs;
}

function runGraphAudit() {
  var btn = document.getElementById('btnRunAudit');
  var statusEl = document.getElementById('auditStatusText');
  var resultsEl = document.getElementById('auditResults');

  btn.disabled = true;
  btn.textContent = 'Verificando...';
  statusEl.textContent = 'Comparando dados...';
  resultsEl.innerHTML = '';

  fetch('/api/graph/audit', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> Rodar Checklist';

      if (data.error) {
        statusEl.textContent = '';
        resultsEl.innerHTML = '<div class="audit-error">Erro: ' + esc(data.error) + '</div>';
        return;
      }

      renderAuditResults(data);
    })
    .catch(function(e) {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> Rodar Checklist';
      statusEl.textContent = '';
      resultsEl.innerHTML = '<div class="audit-error">Erro de rede: ' + e.message + '</div>';
    });
}

function renderAuditResults(data) {
  var statusEl = document.getElementById('auditStatusText');
  var resultsEl = document.getElementById('auditResults');
  var diffs = data.diffs || [];
  var source = data.source || 'Fonte';

  // Contagens por tipo
  var somenteFonte = diffs.filter(function(d) { return d.tipo === 'somente_fonte'; });
  var somenteSistema = diffs.filter(function(d) { return d.tipo === 'somente_sistema'; });
  var divergencias = diffs.filter(function(d) { return d.tipo === 'divergencia'; });

  // Contagem de campos divergentes
  var campoCounts = {};
  divergencias.forEach(function(d) {
    d.campos.forEach(function(c) {
      campoCounts[c.campo] = (campoCounts[c.campo] || 0) + 1;
    });
  });

  if (diffs.length === 0) {
    statusEl.innerHTML = '<span style="color:var(--green);font-weight:600">Tudo consistente — 0 divergencias</span>';
    resultsEl.innerHTML = '<div class="audit-ok">' +
      '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="var(--green)" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' +
      '<div style="margin-top:8px;font-weight:600;color:var(--green)">Dados 100% consistentes</div>' +
      '<div style="font-size:12px;color:var(--muted)">Fonte: ' + esc(source) + ' (' + data.total_fonte + ' usuarios) / Sistema (' + data.total_sistema + ' usuarios)</div>' +
    '</div>';
    return;
  }

  statusEl.innerHTML = '<span style="color:var(--red);font-weight:600">' + diffs.length + ' divergencia' + (diffs.length !== 1 ? 's' : '') + '</span>' +
    '<span style="color:var(--muted);margin-left:8px">Fonte: ' + esc(source) + '</span>';

  var html = '';

  // KPIs
  html += '<div class="audit-kpis">';
  html += '<div class="audit-kpi"><div class="audit-kpi-val" style="color:var(--red)">' + divergencias.length + '</div><div class="audit-kpi-label">Campos divergentes</div></div>';
  html += '<div class="audit-kpi"><div class="audit-kpi-val" style="color:var(--yellow)">' + somenteFonte.length + '</div><div class="audit-kpi-label">Somente na fonte</div></div>';
  html += '<div class="audit-kpi"><div class="audit-kpi-val" style="color:var(--muted)">' + somenteSistema.length + '</div><div class="audit-kpi-label">Somente no sistema</div></div>';
  html += '<div class="audit-kpi"><div class="audit-kpi-val" style="color:var(--green)">' + (data.total_fonte - diffs.length) + '</div><div class="audit-kpi-label">Consistentes</div></div>';
  html += '</div>';

  // Resumo por campo
  if (Object.keys(campoCounts).length) {
    html += '<div class="audit-campo-resumo">';
    var campoLabels = { nome: 'Nome', setor: 'Setor', area: 'Area', cargo: 'Cargo', licenca: 'Licenca', addons: 'Add-ons', status: 'Status' };
    Object.keys(campoCounts).sort(function(a, b) { return campoCounts[b] - campoCounts[a]; }).forEach(function(campo) {
      html += '<span class="audit-campo-chip">' + (campoLabels[campo] || campo) + ' <strong>' + campoCounts[campo] + '</strong></span>';
    });
    html += '</div>';
  }

  // Filtros
  html += '<div class="audit-filters">';
  html += '<button class="audit-filter-btn active" onclick="filterAudit(\'todos\',this)">Todos (' + diffs.length + ')</button>';
  if (divergencias.length) html += '<button class="audit-filter-btn" onclick="filterAudit(\'divergencia\',this)">Divergencias (' + divergencias.length + ')</button>';
  if (somenteFonte.length) html += '<button class="audit-filter-btn" onclick="filterAudit(\'somente_fonte\',this)">Somente fonte (' + somenteFonte.length + ')</button>';
  if (somenteSistema.length) html += '<button class="audit-filter-btn" onclick="filterAudit(\'somente_sistema\',this)">Somente sistema (' + somenteSistema.length + ')</button>';
  html += '</div>';

  // Tabela de divergencias
  var fonteLabel = source.indexOf('CSV') >= 0 ? 'Valor no CSV' : 'Valor no AD';
  html += '<div class="audit-table-wrap"><table class="audit-table"><thead><tr>' +
    '<th>Colaborador</th><th>Tipo</th><th>Campo</th><th>' + esc(fonteLabel) + '</th><th>Valor no Sistema</th><th></th>' +
  '</tr></thead><tbody>';

  diffs.sort(function(a, b) { return (a.nome || '').localeCompare(b.nome || ''); }).forEach(function(d) {
    if (d.tipo === 'somente_fonte') {
      html += '<tr class="audit-row" data-tipo="somente_fonte">' +
        '<td><div class="person-cell"><div class="avatar" style="background:var(--yellow)">' + ini(d.nome) + '</div><div><div class="person-name">' + esc(d.nome) + '</div><div class="person-email">' + esc(d.email) + '</div></div></div></td>' +
        '<td><span class="audit-tipo-badge audit-tipo-ad">Somente fonte</span></td>' +
        '<td colspan="2" style="color:var(--muted);font-size:12px">' + esc(d.resumo) + '</td>' +
        '<td></td><td></td>' +
      '</tr>';
    } else if (d.tipo === 'somente_sistema') {
      html += '<tr class="audit-row" data-tipo="somente_sistema">' +
        '<td><div class="person-cell"><div class="avatar" style="background:var(--muted)">' + ini(d.nome) + '</div><div><div class="person-name">' + esc(d.nome) + '</div><div class="person-email">' + esc(d.email) + '</div></div></div></td>' +
        '<td><span class="audit-tipo-badge audit-tipo-sistema">Somente sistema</span></td>' +
        '<td colspan="2" style="color:var(--muted);font-size:12px">' + esc(d.resumo) + '</td>' +
        '<td></td><td></td>' +
      '</tr>';
    } else {
      d.campos.forEach(function(c, ci) {
        html += '<tr class="audit-row" data-tipo="divergencia">';
        if (ci === 0) {
          html += '<td rowspan="' + d.campos.length + '"><div class="person-cell"><div class="avatar">' + ini(d.nome) + '</div><div><div class="person-name">' + esc(d.nome) + '</div><div class="person-email">' + esc(d.email) + '</div></div></div></td>';
          html += '<td rowspan="' + d.campos.length + '"><span class="audit-tipo-badge audit-tipo-diff">Divergencia</span></td>';
        }
        var campoLabel = { nome: 'Nome', setor: 'Setor', area: 'Area', cargo: 'Cargo', licenca: 'Licenca', addons: 'Add-ons', status: 'Status' }[c.campo] || c.campo;
        html += '<td><span class="audit-campo-label">' + campoLabel + '</span>' + (c.fixo ? '<span class="audit-fixo-badge" title="Campo com override fixo — nao sera sobrescrito pelo sync">fixo</span>' : '') + '</td>';
        html += '<td class="audit-val-ad">' + esc(c.ad || '') + '</td>';
        html += '<td class="audit-val-sistema">' + esc(c.sistema || '') + '</td>';
        if (ci === 0) {
          var matchR = db.find(function(r) { return (r.email || '').toLowerCase() === d.email; });
          if (matchR) {
            html += '<td rowspan="' + d.campos.length + '" style="text-align:center"><button class="act-btn" onclick="openDetail(' + matchR.id + ')" title="Ver detalhes">Ver</button></td>';
          } else {
            html += '<td rowspan="' + d.campos.length + '"></td>';
          }
        }
        html += '</tr>';
      });
    }
  });

  html += '</tbody></table></div>';

  resultsEl.innerHTML = html;
}

function filterAudit(tipo, btn) {
  document.querySelectorAll('.audit-filter-btn').forEach(function(b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');

  document.querySelectorAll('.audit-row').forEach(function(row) {
    if (tipo === 'todos') {
      row.style.display = '';
    } else {
      row.style.display = row.getAttribute('data-tipo') === tipo ? '' : 'none';
    }
  });
}
