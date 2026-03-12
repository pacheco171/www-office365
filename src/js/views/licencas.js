/* ══════════ LICENSE VIEW — Drill-down Hierarquico ══════════
   Nivel 1: Setores Macro (cards)
   Nivel 2: Areas dentro do setor
   Nivel 3: Pessoas dentro da area
   Nivel 4: Licenca + custo da pessoa                          */

// Estado da navegacao drill-down
var licDrillLevel = 'macro'; // 'macro' | 'areas' | 'pessoas'
var licDrillMacro = null;    // setor macro selecionado
var licDrillArea = null;     // area selecionada
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
    return l.id !== 'none' && (counts[l.id] > 0 || !l.addon);
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

function setLicFilter(id) { filterLicId = filterLicId === id ? null : id; licDrillLevel = 'macro'; licDrillMacro = null; licDrillArea = null; renderLicView(); }
function clearLicFilter() { filterLicId = null; licDrillLevel = 'macro'; licDrillMacro = null; licDrillArea = null; renderLicView(); }

/* ── Breadcrumb ── */
function renderLicBreadcrumb() {
  var parts = ['<span class="lic-bread-item lic-bread-link" onclick="licGoToLevel(\'macro\')">Setores</span>'];
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
  if (level === 'macro') { licDrillMacro = null; licDrillArea = null; }
  if (level === 'areas') { licDrillArea = null; }
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
    '<div class="lic-summary-card"><div class="lic-summary-label">Usuarios ativos</div><div class="lic-summary-val">' + grandUsers + '</div></div>' +
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

function licDrillIntoMacro(macro) {
  licDrillMacro = macro;
  licDrillLevel = 'areas';
  renderLicDrill();
}

/* ── Nivel 2: Areas dentro de um setor ── */
function renderAreasLevel() {
  var macroData = licHierData.find(function(m) { return m.macro === licDrillMacro; });
  if (!macroData) return '<div class="lic-drill-empty">Setor nao encontrado.</div>';

  var headerHtml = '<div class="lic-area-header">' +
    '<div class="lic-area-header-info">' +
      '<div class="lic-area-header-name">' + esc(macroData.macro) + '</div>' +
      '<div class="lic-area-header-sub">' + macroData.totalMembers + ' usuarios / ' + macroData.totalLic + ' licencas / ' + fmtBRL(macroData.totalCusto) + '/mes</div>' +
    '</div>' +
  '</div>';

  var areasHtml = '<div class="lic-area-list">' + macroData.areas.map(function(a) {
    var pct = macroData.totalCusto > 0 ? Math.round(a.custo / macroData.totalCusto * 100) : 0;
    return '<div class="lic-area-item" onclick="licDrillIntoArea(\'' + escAttr(a.name) + '\')">' +
      '<div class="lic-area-item-left">' +
        '<div class="lic-area-item-name">' + esc(a.name) + '</div>' +
        '<div class="lic-area-item-meta">' + a.members.length + ' pessoa' + (a.members.length !== 1 ? 's' : '') + ' / ' + a.licCount + ' licenca' + (a.licCount !== 1 ? 's' : '') + '</div>' +
      '</div>' +
      '<div class="lic-area-item-right">' +
        '<div class="lic-area-item-cost">' + fmtBRL(a.custo) + '</div>' +
        '<div class="lic-area-item-pct">' + pct + '% do setor</div>' +
      '</div>' +
      '<div class="lic-card-bar" style="margin-top:8px"><div class="lic-card-bar-fill" style="width:' + pct + '%;background:var(--brown)"></div></div>' +
    '</div>';
  }).join('') + '</div>';

  // Totalizador
  var footerHtml = '<div class="lic-area-footer">' +
    '<span class="lic-area-footer-label">Total ' + esc(macroData.macro) + '</span>' +
    '<span class="lic-area-footer-val">' + fmtBRL(macroData.totalCusto) + '/mes</span>' +
  '</div>';

  return headerHtml + areasHtml + footerHtml;
}

function licDrillIntoArea(area) {
  licDrillArea = area;
  licDrillLevel = 'pessoas';
  renderLicDrill();
}

/* ── Nivel 3: Pessoas dentro de uma area ── */
function renderPessoasLevel() {
  var macroData = licHierData.find(function(m) { return m.macro === licDrillMacro; });
  if (!macroData) return '<div class="lic-drill-empty">Setor nao encontrado.</div>';
  var areaData = macroData.areas.find(function(a) { return a.name === licDrillArea; });
  if (!areaData) return '<div class="lic-drill-empty">Area nao encontrada.</div>';

  var headerHtml = '<div class="lic-area-header">' +
    '<div class="lic-area-header-info">' +
      '<div class="lic-area-header-name">' + esc(licDrillMacro) + ' / ' + esc(licDrillArea) + '</div>' +
      '<div class="lic-area-header-sub">' + areaData.members.length + ' pessoa' + (areaData.members.length !== 1 ? 's' : '') + ' / ' + fmtBRL(areaData.custo) + '/mes</div>' +
    '</div>' +
  '</div>';

  // Tabela de pessoas
  var sortedMembers = areaData.members.slice().sort(function(a, b) {
    return (a.nome||'').localeCompare(b.nome||'');
  });

  var tableHtml = '<div class="lic-pessoas-table-wrap">' +
    '<table class="lic-pessoas-table">' +
      '<thead><tr>' +
        '<th>Colaborador</th>' +
        '<th>E-mail</th>' +
        '<th>Licenca</th>' +
        '<th>Custo/mes</th>' +
        '<th>Status</th>' +
        '<th></th>' +
      '</tr></thead>' +
      '<tbody>' + sortedMembers.map(function(r) {
        var c = userCost(r);
        return '<tr onclick="openDetail(' + r.id + ')">' +
          '<td><div class="person-cell"><div class="avatar">' + ini(r.nome) + '</div>' +
            '<div><div class="person-name">' + esc(r.nome) + '</div></div></div></td>' +
          '<td><span class="lic-pessoa-email">' + esc(r.email) + '</span></td>' +
          '<td>' + licBadge(r.licId) + '</td>' +
          '<td><span class="cost-val">' + (c > 0 ? fmtBRL(c) : '—') + '</span>' + (c > 0 ? '<span class="cost-per">/mes</span>' : '') + '</td>' +
          '<td>' + statusBadge(r.status) + '</td>' +
          '<td><button class="act-btn" onclick="event.stopPropagation();openDetail(' + r.id + ')">Ver</button></td>' +
        '</tr>';
      }).join('') + '</tbody>' +
    '</table>' +
  '</div>';

  // Totalizador
  var footerHtml = '<div class="lic-area-footer">' +
    '<span class="lic-area-footer-label">Total ' + esc(licDrillArea) + ' (' + areaData.members.length + ' pessoas)</span>' +
    '<span class="lic-area-footer-val">' + fmtBRL(areaData.custo) + '/mes</span>' +
  '</div>';

  return headerHtml + tableHtml + footerHtml;
}

/* ── Historico (mantido) ── */
function renderLicHist() {
  var tbody = document.getElementById('licHistBody');
  if (!snapshots.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--muted)">Nenhum historico ainda. Importe CSVs de meses anteriores.</td></tr>'; return; }
  tbody.innerHTML = snapshots.map(function(snap, i) {
    var prev = i > 0 ? snapshots[i - 1] : null;
    var c = snapshotCost(snap), pc = prev ? snapshotCost(prev) : null;
    var comLic = snap.data.filter(function(r) { return r.licId !== 'none'; }).length;
    var semLic = snap.data.filter(function(r) { return r.licId === 'none'; }).length;
    var dc = pc != null ? c - pc : null;
    return '<tr>' +
      '<td><strong>' + snap.label + '</strong></td>' +
      '<td>' + snap.data.length + '</td>' +
      '<td>' + comLic + '</td>' +
      '<td>' + semLic + '</td>' +
      '<td><strong style="color:var(--brown)">' + fmtBRL(c) + '</strong></td>' +
      '<td>' + (dc != null ? deltaBRLBadge(dc) : '<span class="chip chip-neutral">—</span>') + '</td>' +
    '</tr>';
  }).reverse().join('');
}
