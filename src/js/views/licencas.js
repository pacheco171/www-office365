/* ══════════ LICENSE VIEW — Drill-down Hierarquico ══════════
   Nivel 1: Setores Macro (cards)
   Nivel 2: Areas dentro do setor
   Nivel 3: Pessoas dentro da area
   Nivel 4: Licenca + custo da pessoa                          */

// Estado da navegacao drill-down
var licDrillLevel = 'macro'; // 'macro' | 'all-users' | 'areas' | 'pessoas'
var licDrillMacro = null;    // setor macro selecionado
var licDrillArea = null;     // area selecionada
var licDrillSubarea = null;  // subarea selecionada
var licHierData = [];        // cache do agrupamento

/* ── Render principal ── */
function renderLicView() {
  // Cards de licenca (resumo superior)
  var counts = {};
  LICENSES.forEach(function(l) { counts[l.id] = 0; });
  db.forEach(function(r) {
    counts[r.licId] = (counts[r.licId] || 0) + 1;
    (r.addons || []).forEach(function(a) { counts[a] = (counts[a] || 0) + 1; });
  });
  var total = db.length;
  document.getElementById('licOverview').innerHTML = LICENSES.filter(function(l) {
    return l.id !== 'none' && l.id !== 'other' && (counts[l.id] > 0 || !l.addon);
  }).map(function(l) {
    return '<div class="lic-card' + (filterLicId === l.id ? ' selected-lic' : '') + '" onclick="setLicFilter(\'' + l.id + '\')">' +
      '<div class="lic-card-top">' +
        '<div class="lic-card-badge" style="border-color:' + l.color + '20;color:' + l.color + ';background:' + l.color + '12">' + l.tier + '</div>' +
        '<div style="font-size:11px;color:var(--muted)">' + l.ico + '</div>' +
      '</div>' +
      '<div class="lic-card-count" style="color:' + l.color + '">' + (counts[l.id] || 0) + '</div>' +
      '<div class="lic-card-name">' + l.name + '</div>' +
      '<div class="lic-card-price">' + (l.price > 0 ? fmtBRL(l.price) + '/usuario/mes' : 'Gratuito') + '</div>' +
      '<div class="lic-card-cost">' + (counts[l.id] && l.price > 0 ? fmtBRL(counts[l.id] * l.price) + '/mes' : '') + '</div>' +
      '<div class="lic-card-bar"><div class="lic-card-bar-fill" style="width:' + Math.round((counts[l.id] || 0) / Math.max(total, 1) * 100) + '%;background:' + l.color + '"></div></div>' +
    '</div>';
  }).join('');

  // Agrupar dados pela hierarquia
  var source = filterLicId ? db.filter(function(r) {
    return r.licId === filterLicId || (r.addons || []).includes(filterLicId);
  }) : db;
  licHierData = groupByHierarchy(source);

  // Render do nivel atual
  renderLicDrill();
}

function setLicFilter(id) { filterLicId = filterLicId === id ? null : id; licDrillLevel = 'macro'; licDrillMacro = null; licDrillArea = null; licDrillSubarea = null; renderLicView(); }
function clearLicFilter() { filterLicId = null; licDrillLevel = 'macro'; licDrillMacro = null; licDrillArea = null; licDrillSubarea = null; renderLicView(); }

/* ── Breadcrumb ── */
function renderLicBreadcrumb() {
  var parts = ['<span class="lic-bread-item lic-bread-link" onclick="licGoToLevel(\'macro\')">Setores</span>'];
  if (licDrillLevel === 'all-users') {
    parts.push('<span class="lic-bread-sep">/</span>');
    parts.push('<span class="lic-bread-item">Todos os usuarios</span>');
    return '<div class="lic-breadcrumb">' + parts.join('') + '</div>';
  }
  if (licDrillMacro) {
    parts.push('<span class="lic-bread-sep">/</span>');
    parts.push('<span class="lic-bread-item' + (licDrillLevel === 'areas' ? '' : ' lic-bread-link') + '" onclick="licGoToLevel(\'areas\')">' + licDrillMacro + '</span>');
  }
  if (licDrillArea) {
    parts.push('<span class="lic-bread-sep">/</span>');
    parts.push('<span class="lic-bread-item">' + licDrillArea + '</span>');
  }
  return '<div class="lic-breadcrumb">' + parts.join('') + '</div>';
}

function licGoToLevel(level) {
  if (level === 'macro') { licDrillMacro = null; licDrillArea = null; licDrillSubarea = null; }
  if (level === 'areas') { licDrillArea = null; licDrillSubarea = null; }
  licDrillLevel = level;
  renderLicDrill();
}

/* ── Render drill-down ── */
function renderLicDrill() {
  var container = document.getElementById('licDrillContent');
  var breadEl = document.getElementById('licBreadcrumb');

  if (licDrillLevel === 'macro') {
    breadEl.innerHTML = renderLicBreadcrumb();
    container.innerHTML = renderMacroLevel();
  } else if (licDrillLevel === 'all-users') {
    breadEl.innerHTML = renderLicBreadcrumb();
    container.innerHTML = renderAllUsersLevel();
  } else if (licDrillLevel === 'areas') {
    breadEl.innerHTML = renderLicBreadcrumb();
    container.innerHTML = renderAreasLevel();
  } else if (licDrillLevel === 'pessoas') {
    breadEl.innerHTML = renderLicBreadcrumb();
    container.innerHTML = renderPessoasLevel();
  }
}

/* ── Nivel 1: Setores Macro ── */
function renderMacroLevel() {
  if (!licHierData.length) {
    return '<div class="lic-drill-empty">Nenhum dado disponivel. Importe um CSV para comecar.</div>';
  }
  var grandTotal = licHierData.reduce(function(s, m) { return s + m.totalCusto; }, 0);
  var grandUsers = licHierData.reduce(function(s, m) { return s + m.totalMembers; }, 0);

  var summaryHtml = '<div class="lic-macro-summary">' +
    '<div class="lic-summary-card"><div class="lic-summary-label">Setores</div><div class="lic-summary-val">' + licHierData.length + '</div></div>' +
    '<div class="lic-summary-card lic-summary-clickable" onclick="licShowAllUsers()" title="Ver todos os usuarios"><div class="lic-summary-label">Usuarios ativos</div><div class="lic-summary-val">' + grandUsers + '</div></div>' +
    '<div class="lic-summary-card"><div class="lic-summary-label">Custo mensal total</div><div class="lic-summary-val lic-summary-cost">' + fmtBRL(grandTotal) + '</div></div>' +
  '</div>';

  var cardsHtml = '<div class="lic-macro-grid">' + licHierData.map(function(m) {
    var pct = grandTotal > 0 ? Math.round(m.totalCusto / grandTotal * 100) : 0;
    return '<div class="lic-macro-card" onclick="licDrillIntoMacro(\'' + escAttr(m.macro) + '\')">' +
      '<div class="lic-macro-card-header">' +
        '<div class="lic-macro-card-name">' + esc(m.macro) + '</div>' +
        (m.manual ? '<span class="lic-macro-manual-badge">Manual</span>' : '') +
      '</div>' +
      '<div class="lic-macro-card-stats">' +
        '<div class="lic-macro-stat"><div class="lic-macro-stat-val">' + m.totalMembers + '</div><div class="lic-macro-stat-label">usuarios</div></div>' +
        '<div class="lic-macro-stat"><div class="lic-macro-stat-val">' + m.areas.length + '</div><div class="lic-macro-stat-label">areas</div></div>' +
        '<div class="lic-macro-stat"><div class="lic-macro-stat-val">' + m.totalLic + '</div><div class="lic-macro-stat-label">licencas</div></div>' +
      '</div>' +
      '<div class="lic-macro-card-cost">' + fmtBRL(m.totalCusto) + '<span class="lic-macro-card-pct">' + pct + '%</span></div>' +
      '<div class="lic-card-bar"><div class="lic-card-bar-fill" style="width:' + pct + '%;background:var(--brown)"></div></div>' +
    '</div>';
  }).join('') + '</div>';

  return summaryHtml + cardsHtml;
}

/* ── Todos os usuarios (lista flat) ── */
function licShowAllUsers() {
  licDrillLevel = 'all-users';
  licDrillMacro = null;
  licDrillArea = null;
  licDrillSubarea = null;
  renderLicDrill();
}

function renderAllUsersLevel() {
  var source = filterLicId ? db.filter(function(r) {
    return r.licId === filterLicId || (r.addons || []).includes(filterLicId);
  }) : db;

  var allMembers = source.slice().sort(function(a, b) {
    return (a.nome || '').localeCompare(b.nome || '');
  });

  var totalCusto = allMembers.reduce(function(s, r) { return s + userCost(r); }, 0);

  var headerHtml = '<div class="lic-area-header">' +
    '<div class="lic-area-header-info">' +
      '<div class="lic-area-header-name">Todos os usuarios' + (filterLicId ? ' — ' + esc(getLic(filterLicId).name) : '') + '</div>' +
      '<div class="lic-area-header-sub">' + allMembers.length + ' usuario' + (allMembers.length !== 1 ? 's' : '') + ' / ' + fmtBRL(totalCusto) + '/mes</div>' +
    '</div>' +
  '</div>';

  var footerHtml = '<div class="lic-area-footer">' +
    '<span class="lic-area-footer-label">Total (' + allMembers.length + ' usuarios)</span>' +
    '<span class="lic-area-footer-val">' + fmtBRL(totalCusto) + '/mes</span>' +
  '</div>';

  return headerHtml + _renderLicPessoasTable(allMembers) + footerHtml;
}

function licDrillIntoMacro(macro) {
  licDrillMacro = macro;
  licDrillLevel = 'areas';
  renderLicDrill();
}

/* ── Nivel 2: Areas dentro de um setor (expansivel com pessoas) ── */
function renderAreasLevel() {
  var macroData = licHierData.find(function(m) { return m.macro === licDrillMacro; });
  if (!macroData) return '<div class="lic-drill-empty">Setor nao encontrado.</div>';

  var headerHtml = '<div class="lic-area-header">' +
    '<div class="lic-area-header-info">' +
      '<div class="lic-area-header-name">' + esc(macroData.macro) + '</div>' +
      '<div class="lic-area-header-sub">' + macroData.totalMembers + ' usuarios / ' + macroData.totalLic + ' licencas / ' + fmtBRL(macroData.totalCusto) + '/mes</div>' +
    '</div>' +
  '</div>';

  var chevronSvg = '<svg class="lic-area-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>';

  var areasHtml = '<div class="lic-area-list">' + macroData.areas.map(function(a, idx) {
    var pct = macroData.totalCusto > 0 ? Math.round(a.custo / macroData.totalCusto * 100) : 0;
    var areaId = 'lic-area-' + idx;

    // Construir conteudo expansivel com pessoas
    var bodyContent = '';
    var hasSubareas = a.subareas && a.subareas.length > 0;

    if (hasSubareas) {
      // Subareas expansiveis dentro da area
      bodyContent = a.subareas.map(function(sa, saIdx) {
        var saId = areaId + '-sa-' + saIdx;
        var saSorted = sa.members.slice().sort(function(x,y){return (x.nome||'').localeCompare(y.nome||'');});
        return '<div class="lic-subarea-group" id="' + saId + '">' +
          '<div class="lic-subarea-header" onclick="event.stopPropagation();toggleLicSubarea(\'' + saId + '\')">' +
            chevronSvg +
            '<span class="lic-subarea-name">' + esc(sa.name) + '</span>' +
            '<span class="lic-subarea-meta">' + sa.members.length + ' pessoa' + (sa.members.length !== 1 ? 's' : '') + '</span>' +
            '<span class="lic-subarea-cost">' + fmtBRL(sa.custo) + '</span>' +
          '</div>' +
          '<div class="lic-subarea-body">' + _renderLicPessoasTable(saSorted) + '</div>' +
        '</div>';
      }).join('');
      // Pessoas diretas (sem subarea)
      var directMembers = a.members.filter(function(r) { return !r.subarea; });
      if (directMembers.length > 0) {
        var directSorted = directMembers.slice().sort(function(x,y){return (x.nome||'').localeCompare(y.nome||'');});
        bodyContent += '<div style="margin-top:8px;padding:8px 0 4px;font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:1px">Sem sub-area (' + directMembers.length + ')</div>' +
          _renderLicPessoasTable(directSorted);
      }
    } else {
      var sorted = a.members.slice().sort(function(x,y){return (x.nome||'').localeCompare(y.nome||'');});
      bodyContent = _renderLicPessoasTable(sorted);
    }

    return '<div class="lic-area-item lic-area-expandable" id="' + areaId + '">' +
      '<div class="lic-area-item-header" onclick="toggleLicArea(\'' + areaId + '\')">' +
        chevronSvg +
        '<div class="lic-area-item-left">' +
          '<div class="lic-area-item-name">' + esc(a.name) + '</div>' +
          '<div class="lic-area-item-meta">' + a.members.length + ' pessoa' + (a.members.length !== 1 ? 's' : '') + ' / ' + a.licCount + ' licenca' + (a.licCount !== 1 ? 's' : '') + '</div>' +
        '</div>' +
        '<div class="lic-area-item-right">' +
          '<div class="lic-area-item-cost">' + fmtBRL(a.custo) + '</div>' +
          '<div class="lic-area-item-pct">' + pct + '% do setor</div>' +
        '</div>' +
      '</div>' +
      '<div class="lic-card-bar" style="margin:0 16px"><div class="lic-card-bar-fill" style="width:' + pct + '%;background:var(--brown)"></div></div>' +
      '<div class="lic-area-item-body">' + bodyContent + '</div>' +
    '</div>';
  }).join('') + '</div>';

  // Totalizador
  var footerHtml = '<div class="lic-area-footer">' +
    '<span class="lic-area-footer-label">Total ' + esc(macroData.macro) + '</span>' +
    '<span class="lic-area-footer-val">' + fmtBRL(macroData.totalCusto) + '/mes</span>' +
  '</div>';

  return headerHtml + areasHtml + footerHtml;
}

function toggleLicArea(id) {
  var el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

function toggleLicSubarea(id) {
  var el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

function licDrillIntoArea(area) {
  licDrillArea = area;
  licDrillLevel = 'pessoas';
  renderLicDrill();
}

/** Contador global para IDs de tabelas de licenças paginadas */
var _licTableIdx = 0;

/** Renderiza tabela de pessoas (helper reutilizavel) com paginação */
function _renderLicPessoasTable(members) {
  var tid = 'lic-tbl-' + (_licTableIdx++);
  var defaultPer = members.length;

  if (!window._licTableData) window._licTableData = {};
  window._licTableData[tid] = { members: members, per: defaultPer, page: 1 };

  return '<div id="' + tid + '-wrap">' +
    _buildLicTable(tid, members, 1, defaultPer) +
  '</div>';
}

function _buildLicTable(tid, members, page, per) {
  var total = members.length;
  var pages = Math.max(1, Math.ceil(total / per));
  if (page > pages) page = pages;
  var start = (page - 1) * per;
  var pageRows = members.slice(start, start + per);

  var rows = pageRows.map(function(r) {
    var c = userCost(r);
    return '<tr onclick="openDetail(' + r.id + ')">' +
      '<td><div class="person-cell"><div class="avatar">' + ini(r.nome) + '</div>' +
        '<div><div class="person-name">' + esc(r.nome) + '</div></div></div></td>' +
      '<td><span class="lic-pessoa-email">' + esc(r.email) + '</span></td>' +
      '<td>' + licBadge(r.licId) + ((r.addons && r.addons.length) ? ' ' + r.addons.map(function(a){ return licBadge(a); }).join(' ') : '') + '</td>' +
      '<td><span class="cost-val">' + (c > 0 ? fmtBRL(c) : '—') + '</span>' + (c > 0 ? '<span class="cost-per">/mes</span>' : '') + '</td>' +
      '<td>' + statusBadge(r.status) + '</td>' +
      '<td><button class="act-btn" onclick="event.stopPropagation();openDetail(' + r.id + ')">Ver</button></td>' +
    '</tr>';
  }).join('');

  var table = '<div class="lic-pessoas-table-wrap">' +
    '<table class="lic-pessoas-table">' +
      '<thead><tr><th>Colaborador</th><th>E-mail</th><th>Licenca</th><th>Custo/mes</th><th>Status</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>' +
  '</div>';

  if (total <= 10) return table;

  var perSelect = '<div class="per-page"><label>Exibir</label>' +
    '<select onchange="_licTableSetPer(\'' + tid + '\',this.value)">' +
    [10, 20, 30, 40, 50].map(function(n) {
      return '<option value="' + n + '"' + (n === per ? ' selected' : '') + '>' + n + '</option>';
    }).join('') +
    '<option value="' + total + '"' + (per >= total ? ' selected' : '') + '>Todas</option>' +
    '</select></div>';

  var pagBtns = '';
  if (pages > 1) {
    for (var i = 1; i <= Math.min(pages, 10); i++) {
      pagBtns += '<button class="page-btn' + (i === page ? ' active' : '') + '" onclick="_licTableGoPage(\'' + tid + '\',' + i + ')">' + i + '</button>';
    }
  }

  var info = 'Mostrando ' + (start + 1) + '–' + Math.min(start + per, total) + ' de ' + total;

  var controls = '<div class="area-table-controls">' +
    '<span class="area-table-info">' + info + '</span>' +
    perSelect +
    (pagBtns ? '<div class="area-table-pag">' + pagBtns + '</div>' : '') +
  '</div>';

  return table + controls;
}

function _licTableSetPer(tid, per) {
  per = parseInt(per, 10) || 10;
  var d = window._licTableData[tid];
  if (!d) return;
  d.per = per;
  d.page = 1;
  var wrap = document.getElementById(tid + '-wrap');
  if (wrap) wrap.innerHTML = _buildLicTable(tid, d.members, 1, per);
}

function _licTableGoPage(tid, page) {
  var d = window._licTableData[tid];
  if (!d) return;
  d.page = page;
  var wrap = document.getElementById(tid + '-wrap');
  if (wrap) wrap.innerHTML = _buildLicTable(tid, d.members, page, d.per);
}

/* ── Nivel 3: Pessoas/subareas dentro de uma area ── */
function renderPessoasLevel() {
  var macroData = licHierData.find(function(m) { return m.macro === licDrillMacro; });
  if (!macroData) return '<div class="lic-drill-empty">Setor nao encontrado.</div>';
  var areaData = macroData.areas.find(function(a) { return a.name === licDrillArea; });
  if (!areaData) return '<div class="lic-drill-empty">Area nao encontrada.</div>';

  // Se veio de subarea drill, filtrar apenas essa subarea
  if (licDrillSubarea) {
    var saData = (areaData.subareas || []).find(function(sa) { return sa.name === licDrillSubarea; });
    var saMembers = saData ? saData.members : [];
    var headerHtml = '<div class="lic-area-header">' +
      '<div class="lic-area-header-info">' +
        '<div class="lic-area-header-name">' + esc(licDrillMacro) + ' / ' + esc(licDrillArea) + ' / ' + esc(licDrillSubarea) + '</div>' +
        '<div class="lic-area-header-sub">' + saMembers.length + ' pessoa' + (saMembers.length !== 1 ? 's' : '') + ' / ' + fmtBRL(saMembers.reduce(function(s,r){return s+userCost(r);},0)) + '/mes</div>' +
      '</div>' +
    '</div>';
    var sorted = saMembers.slice().sort(function(a,b){return (a.nome||'').localeCompare(b.nome||'');});
    var footerHtml = '<div class="lic-area-footer">' +
      '<span class="lic-area-footer-label">Total ' + esc(licDrillSubarea) + ' (' + saMembers.length + ' pessoas)</span>' +
      '<span class="lic-area-footer-val">' + fmtBRL(saMembers.reduce(function(s,r){return s+userCost(r);},0)) + '/mes</span>' +
    '</div>';
    return headerHtml + _renderLicPessoasTable(sorted) + footerHtml;
  }

  var headerHtml = '<div class="lic-area-header">' +
    '<div class="lic-area-header-info">' +
      '<div class="lic-area-header-name">' + esc(licDrillMacro) + ' / ' + esc(licDrillArea) + '</div>' +
      '<div class="lic-area-header-sub">' + areaData.members.length + ' pessoa' + (areaData.members.length !== 1 ? 's' : '') + ' / ' + fmtBRL(areaData.custo) + '/mes</div>' +
    '</div>' +
  '</div>';

  var hasSubareas = areaData.subareas && areaData.subareas.length > 0;
  var contentHtml = '';

  if (hasSubareas) {
    // Mostrar cards de subareas (igual ao nivel 2 mostra areas)
    contentHtml = '<div class="lic-area-list">' + areaData.subareas.map(function(sa) {
      var pct = areaData.custo > 0 ? Math.round(sa.custo / areaData.custo * 100) : 0;
      return '<div class="lic-area-item" onclick="licDrillIntoSubarea(\'' + escAttr(sa.name) + '\')">' +
        '<div class="lic-area-item-left">' +
          '<div class="lic-area-item-name">' + esc(sa.name) + '</div>' +
          '<div class="lic-area-item-meta">' + sa.members.length + ' pessoa' + (sa.members.length !== 1 ? 's' : '') + ' / ' + sa.licCount + ' licenca' + (sa.licCount !== 1 ? 's' : '') + '</div>' +
        '</div>' +
        '<div class="lic-area-item-right">' +
          '<div class="lic-area-item-cost">' + fmtBRL(sa.custo) + '</div>' +
          '<div class="lic-area-item-pct">' + pct + '% da area</div>' +
        '</div>' +
        '<div class="lic-card-bar" style="margin-top:8px"><div class="lic-card-bar-fill" style="width:' + pct + '%;background:var(--brown)"></div></div>' +
      '</div>';
    }).join('') + '</div>';
    // Pessoas diretas (sem subarea)
    var directMembers = areaData.members.filter(function(r) { return !r.subarea; });
    if (directMembers.length > 0) {
      var directSorted = directMembers.slice().sort(function(a,b){return (a.nome||'').localeCompare(b.nome||'');});
      contentHtml += '<div style="margin-top:12px;padding:8px 0 4px;font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:1px">Sem sub-area (' + directMembers.length + ')</div>' +
        _renderLicPessoasTable(directSorted);
    }
  } else {
    var sortedMembers = areaData.members.slice().sort(function(a, b) {
      return (a.nome||'').localeCompare(b.nome||'');
    });
    contentHtml = _renderLicPessoasTable(sortedMembers);
  }

  // Totalizador
  var footerHtml = '<div class="lic-area-footer">' +
    '<span class="lic-area-footer-label">Total ' + esc(licDrillArea) + ' (' + areaData.members.length + ' pessoas)</span>' +
    '<span class="lic-area-footer-val">' + fmtBRL(areaData.custo) + '/mes</span>' +
  '</div>';

  return headerHtml + contentHtml + footerHtml;
}

function licDrillIntoSubarea(subarea) {
  licDrillSubarea = subarea;
  renderLicDrill();
}

/* ── Historico (mantido) ── */
function renderLicHist() {
  var tbody = document.getElementById('licHistBody');
  if (!snapshots.length) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--muted)">Nenhum historico ainda. Importe CSVs de meses anteriores.</td></tr>'; return; }
  tbody.innerHTML = snapshots.map(function(snap, i) {
    var prev = i > 0 ? snapshots[i - 1] : null;
    var c = snapshotCost(snap), pc = prev ? snapshotCost(prev) : null;
    var total = snap.data.filter(function(r) { return r.licId !== 'none' && r.licId !== 'other'; }).length;
    var dc = pc != null ? c - pc : null;
    return '<tr>' +
      '<td><strong>' + snap.label + '</strong></td>' +
      '<td>' + total + '</td>' +
      '<td><strong style="color:var(--brown)">' + fmtBRL(c) + '</strong></td>' +
      '<td>' + (dc != null ? deltaBRLBadge(dc) : '<span class="chip chip-neutral">—</span>') + '</td>' +
    '</tr>';
  }).reverse().join('');
}
