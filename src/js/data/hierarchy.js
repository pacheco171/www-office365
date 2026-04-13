/* ══════════ HIERARCHY — Estrutura Organizacional AD ══════════
   Define a hierarquia: SETOR MACRO > AREA > PESSOAS > LICENCA
   Setores manuais (Lojas, Servicos) nao sao sobrescritos nas importacoes.
   Persistido via /api/hierarchy no servidor.                             */

let HIERARCHY = {};
// Formato: { "TI": { areas: ["Infraestrutura","Desenvolvimento",...], manual: false },
//            "Lojas": { areas: [], manual: true }, ... }

// Reverse map: area name -> setor macro
let AREA_TO_MACRO = {};

/** Reconstroi o mapa reverso area->macro */
function rebuildAreaMap() {
  AREA_TO_MACRO = {};
  Object.keys(HIERARCHY).forEach(function(macro) {
    var h = HIERARCHY[macro];
    (h.areas || []).forEach(function(area) {
      AREA_TO_MACRO[area.toLowerCase()] = macro;
    });
    // O proprio nome do macro tambem resolve para si
    AREA_TO_MACRO[macro.toLowerCase()] = macro;
  });
}

/** Resolve setor macro e area de um registro.
    Usa r.area (extraido do AD na importacao) quando disponivel.
    Retorna { macro: string, area: string } */
function resolveHierarchy(r) {
  var setor = (r.setor || 'Sem Setor').trim();
  var area = r.area ? r.area.trim() : null;

  // Preferir valores pré-computados pelo servidor
  if (r.macro) return { macro: r.macro, area: r.hierArea || area || 'Geral' };

  // 1. Se o registro ja tem area definida (veio do AD com hierarquia)
  if (area) {
    return { macro: setor, area: area };
  }

  var setorLower = setor.toLowerCase();

  // 2. Setor eh uma area conhecida dentro de um macro (mapeamento manual)
  //    MAS: se o setor TAMBÉM existe como macro independente na hierarquia,
  //    tratar como macro próprio (não rebaixar a sub-área de outro).
  //    Ex: "Desenvolvimento" existe como setor E como área de "TI".
  if (AREA_TO_MACRO[setorLower]) {
    var macro = AREA_TO_MACRO[setorLower];
    // Se o setor == nome do macro, area = "Geral"
    if (setorLower === macro.toLowerCase()) {
      return { macro: macro, area: 'Geral' };
    }
    // Se o setor existe como macro independente, NÃO mapear para outro macro
    if (HIERARCHY[setor]) {
      return { macro: setor, area: 'Geral' };
    }
    return { macro: macro, area: setor };
  }

  // 3. Se nao esta mapeado, cria macro com nome do setor e area Geral
  return { macro: setor, area: 'Geral' };
}

/** Agrupa registros pela hierarquia.
    Retorna: [{ macro, manual, areas: [{ name, members:[], custo, licCount, subareas: [{ name, members:[], custo, licCount }] }], totalMembers, totalCusto }] */
function groupByHierarchy(records) {
  var macroMap = {};

  records.forEach(function(r) {
    var h = resolveHierarchy(r);
    if (!macroMap[h.macro]) {
      var hConf = HIERARCHY[h.macro];
      macroMap[h.macro] = { macro: h.macro, manual: !!(hConf && hConf.manual), areaMap: {} };
    }
    var m = macroMap[h.macro];
    if (!m.areaMap[h.area]) {
      m.areaMap[h.area] = { name: h.area, members: [], custo: 0, licCount: 0, subareaMap: {} };
    }
    var a = m.areaMap[h.area];
    a.members.push(r);
    a.custo += userCost(r);
    if (r.licId && r.licId !== 'none') a.licCount++;

    // Agrupar por subarea se existir
    var subName = r.subarea || null;
    if (subName) {
      if (!a.subareaMap[subName]) {
        a.subareaMap[subName] = { name: subName, members: [], custo: 0, licCount: 0 };
      }
      var sa = a.subareaMap[subName];
      sa.members.push(r);
      sa.custo += userCost(r);
      if (r.licId && r.licId !== 'none') sa.licCount++;
    }
  });

  var result = [];
  Object.keys(macroMap).sort().forEach(function(key) {
    var m = macroMap[key];
    var areas = Object.values(m.areaMap).map(function(a) {
      // Converter subareaMap em array ordenado
      a.subareas = Object.values(a.subareaMap).sort(function(x, y) {
        return y.custo - x.custo;
      });
      delete a.subareaMap;
      return a;
    }).sort(function(a, b) {
      return b.custo - a.custo;
    });
    var totalMembers = areas.reduce(function(s, a) { return s + a.members.length; }, 0);
    var totalCusto = areas.reduce(function(s, a) { return s + a.custo; }, 0);
    var totalLic = areas.reduce(function(s, a) { return s + a.licCount; }, 0);
    result.push({
      macro: m.macro,
      manual: m.manual,
      areas: areas,
      totalMembers: totalMembers,
      totalCusto: totalCusto,
      totalLic: totalLic
    });
  });

  // Ordenar por custo decrescente
  result.sort(function(a, b) { return b.totalCusto - a.totalCusto; });
  return result;
}

/** Carrega hierarquia do servidor */
function loadHierarchy() {
  return fetch('/api/hierarchy')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      HIERARCHY = (data && data.hierarchy) || {};
      rebuildAreaMap();
    })
    .catch(function() {
      HIERARCHY = {};
      rebuildAreaMap();
    });
}

/** Salva hierarquia no servidor */
function saveHierarchy() {
  return fetch('/api/hierarchy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hierarchy: HIERARCHY })
  }).catch(function() {});
}

/** Adiciona uma area a um macro setor */
function addAreaToMacro(macro, area) {
  if (!HIERARCHY[macro]) HIERARCHY[macro] = { areas: [], manual: false };
  if (HIERARCHY[macro].areas.indexOf(area) < 0) {
    HIERARCHY[macro].areas.push(area);
  }
  rebuildAreaMap();
  return saveHierarchy();
}

/** Remove uma area de um macro setor */
function removeAreaFromMacro(macro, area) {
  if (!HIERARCHY[macro]) return Promise.resolve();
  var idx = HIERARCHY[macro].areas.indexOf(area);
  if (idx >= 0) HIERARCHY[macro].areas.splice(idx, 1);
  rebuildAreaMap();
  return saveHierarchy();
}

/** Cria um novo setor macro */
function createMacroSetor(name, opts) {
  opts = opts || {};
  HIERARCHY[name] = { areas: opts.areas || [], manual: !!opts.manual };
  rebuildAreaMap();
  return saveHierarchy();
}

/** Remove um setor macro */
function removeMacroSetor(name) {
  delete HIERARCHY[name];
  rebuildAreaMap();
  return saveHierarchy();
}

/** Renderiza subdivisoes por area dentro de um setor expandido.
    Usado no dashboard (ver todos) e na view Por Setor.
    Mostra TODAS as areas configuradas na hierarquia, mesmo vazias.
    Suporta 3 niveis: setor > area > subarea (quando existem subareas no AD).
    @param {object} s - setor com {name, members, custo, byLic}
    @param {string} prefix - prefixo unico para IDs
    @returns {string} HTML */
function renderSetorSubAreas(s, prefix) {
  var chevronSvg = '<svg class="setor-sub-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>';
  // Agrupar TODOS os membros por area (usando hierarquia) — inclui inativos
  var areaMap = {};
  s.members.forEach(function(r) {
    var h = resolveHierarchy(r);
    var areaName = h.area || 'Geral';
    if (!areaMap[areaName]) areaMap[areaName] = { members: [], subareaMap: {} };
    areaMap[areaName].members.push(r);

    // Agrupar por subarea se existir
    if (r.subarea) {
      if (!areaMap[areaName].subareaMap[r.subarea]) areaMap[areaName].subareaMap[r.subarea] = [];
      areaMap[areaName].subareaMap[r.subarea].push(r);
    }
  });

  // Garantir que todas as areas configuradas na hierarquia aparecem
  var hConf = HIERARCHY[s.name];
  if (hConf && hConf.areas) {
    hConf.areas.forEach(function(area) {
      if (!areaMap[area]) areaMap[area] = { members: [], subareaMap: {} };
    });
  }
  // Garantir subareas configuradas
  if (hConf && hConf.subareas) {
    Object.keys(hConf.subareas).forEach(function(area) {
      if (!areaMap[area]) areaMap[area] = { members: [], subareaMap: {} };
      (hConf.subareas[area] || []).forEach(function(sub) {
        if (!areaMap[area].subareaMap[sub]) areaMap[area].subareaMap[sub] = [];
      });
    });
  }

  // Coletar todas as areas e ordenar: com membros primeiro (por custo desc), vazias por ultimo
  var areaKeys = Object.keys(areaMap).sort(function(a, b) {
    var membrosA = areaMap[a].members.length;
    var membrosB = areaMap[b].members.length;
    if (membrosA === 0 && membrosB > 0) return 1;
    if (membrosA > 0 && membrosB === 0) return -1;
    var custoA = areaMap[a].members.reduce(function(sum, r) { return sum + userCost(r); }, 0);
    var custoB = areaMap[b].members.reduce(function(sum, r) { return sum + userCost(r); }, 0);
    return custoB - custoA;
  });

  // Se NAO tem hierarquia configurada e so tem "Geral", tabela direta
  var hasConfiguredAreas = hConf && hConf.areas && hConf.areas.length > 0;
  var onlyGeral = areaKeys.length <= 1 && areaKeys[0] === 'Geral';
  if (!hasConfiguredAreas && onlyGeral) {
    if (!s.members.length) return '';
    return renderAreaUsersTable(s.members);
  }

  var subIdx = 0;
  var subHtml = areaKeys.map(function(areaName) {
    var areaData = areaMap[areaName];
    var members = areaData.members;
    var subCusto = members.reduce(function(sum, r) { return sum + userCost(r); }, 0);
    var licCount = members.filter(function(r) { return r.licId && r.licId !== 'none'; }).length;
    var isEmpty = members.length === 0;
    var idx = subIdx++;

    // Verificar se tem subareas
    var subareaKeys = Object.keys(areaData.subareaMap).sort(function(a, b) {
      var custoA = (areaData.subareaMap[a] || []).reduce(function(sum, r) { return sum + userCost(r); }, 0);
      var custoB = (areaData.subareaMap[b] || []).reduce(function(sum, r) { return sum + userCost(r); }, 0);
      return custoB - custoA;
    });
    var hasSubareas = subareaKeys.length > 0;
    var directMembers = members.filter(function(r) { return !r.subarea; });

    // Conteudo interno
    var bodyContent = '';
    if (isEmpty) {
      bodyContent = '<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px">Nenhuma pessoa atribuida a esta area.<br>Use o botao <strong>Editar setor</strong> de cada colaborador para atribuir.</div>';
    } else if (hasSubareas) {
      // Pastinhas de subarea (mesmo estilo, indentadas)
      var saIdx = 0;
      bodyContent = subareaKeys.map(function(saName) {
        var saMembers = areaData.subareaMap[saName] || [];
        var saCusto = saMembers.reduce(function(sum, r) { return sum + userCost(r); }, 0);
        var saLicCount = saMembers.filter(function(r) { return r.licId && r.licId !== 'none'; }).length;
        var saI = saIdx++;
        var saPrefix = prefix + '-sub-' + idx + '-sa';
        return '<div class="setor-sub-group setor-subarea-group" id="' + saPrefix + '-sub-' + saI + '">' +
          '<div class="setor-sub-header setor-subarea-header" onclick="toggleSubArea(\'' + saPrefix + '\',' + saI + ')">' +
            chevronSvg +
            '<span class="setor-sub-name">' + esc(saName) + '</span>' +
            '<span class="setor-sub-meta">' + (function(){var np=saMembers.filter(function(r){return !r.tipo||r.tipo==='Pessoa';}).length;var no=saMembers.length-np;return np+(no>0?' pessoas · '+no+' comp.':' pessoa'+(np!==1?'s':''));})() + '</span>' +
            '<span class="setor-sub-meta">' + saLicCount + ' licenca' + (saLicCount !== 1 ? 's' : '') + '</span>' +
            '<span class="setor-sub-cost">' + fmtBRL(saCusto) + '</span>' +
          '</div>' +
          '<div class="setor-sub-body">' +
            '<div class="setor-sub-body-inner">' +
              renderAreaUsersTable(saMembers) +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');
      // Pessoas diretas na area (sem subarea)
      if (directMembers.length > 0) {
        bodyContent += renderAreaUsersTable(directMembers);
      }
    } else {
      bodyContent = renderAreaUsersTable(members);
    }

    return '<div class="setor-sub-group' + (isEmpty ? ' empty-area' : '') + '" id="' + prefix + '-sub-' + idx + '">' +
      '<div class="setor-sub-header" onclick="toggleSubArea(\'' + prefix + '\',' + idx + ')">' +
        chevronSvg +
        '<span class="setor-sub-name">' + esc(areaName) + '</span>' +
        '<span class="setor-sub-meta">' + (function(){var np=members.filter(function(r){return !r.tipo||r.tipo==='Pessoa';}).length;var no=members.length-np;return np+(no>0?' pessoas · '+no+' comp.':' pessoa'+(np!==1?'s':''));})() + '</span>' +
        (isEmpty ? '' : '<span class="setor-sub-meta">' + licCount + ' licenca' + (licCount !== 1 ? 's' : '') + '</span>') +
        '<span class="setor-sub-cost">' + (isEmpty ? '—' : fmtBRL(subCusto)) + '</span>' +
      '</div>' +
      '<div class="setor-sub-body">' +
        '<div class="setor-sub-body-inner">' +
          bodyContent +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  var totalCusto = s.members.reduce(function(sum, r) { return sum + userCost(r); }, 0);
  return subHtml +
    '<div class="setor-sub-footer">' +
      '<span class="setor-sub-footer-label">Total ' + esc(s.name) + ' (' + areaKeys.length + ' areas)</span>' +
      '<span class="setor-sub-footer-val">' + fmtBRL(totalCusto) + '</span>' +
    '</div>';
}

/** Contador global para IDs unicos de tabelas paginadas */
var _areaTableIdx = 0;

/** Renderiza tabela de usuarios de uma area com paginação inline */
function renderAreaUsersTable(members) {
  var sorted = members.slice().sort(function(a, b) { return (a.nome||'').localeCompare(b.nome||''); });
  var tid = 'area-tbl-' + (_areaTableIdx++);
  var defaultPer = sorted.length;

  // Guardar dados no window para acesso posterior
  if (!window._areaTableData) window._areaTableData = {};
  window._areaTableData[tid] = { members: sorted, per: defaultPer, page: 1 };

  return '<div id="' + tid + '-wrap">' +
    _buildAreaTable(tid, sorted, 1, defaultPer) +
  '</div>';
}

/** Constroi HTML da tabela paginada */
function _buildAreaTable(tid, members, page, per) {
  var total = members.length;
  var pages = Math.max(1, Math.ceil(total / per));
  if (page > pages) page = pages;
  var start = (page - 1) * per;
  var pageRows = members.slice(start, start + per);

  var rows = pageRows.map(function(r) {
    return '<tr onclick="openDetail(' + r.id + ')">' +
      '<td><span class="setor-user-avatar">' + ini(r.nome) + '</span>' + esc(r.nome) + '</td>' +
      '<td style="font-size:11px;color:var(--muted)">' + esc(r.email) + '</td>' +
      '<td>' + licBadge(r.licId) + '</td>' +
      '<td style="color:var(--brown);font-weight:600">' + fmtBRL(userCost(r)) + '</td>' +
      '<td>' + statusBadge(r.status) + '</td>' +
    '</tr>';
  }).join('');

  var table = '<table class="setor-users-table">' +
    '<thead><tr><th>Colaborador</th><th>E-mail</th><th>Licenca</th><th>Custo/mes</th><th>Status</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>';

  // Controles de paginação (só se tiver mais de 10 membros)
  if (total <= 10) return table;

  var perSelect = '<div class="per-page"><label>Exibir</label>' +
    '<select onchange="_areaTableSetPer(\'' + tid + '\',this.value)">' +
    [10, 20, 30, 40, 50].map(function(n) {
      return '<option value="' + n + '"' + (n === per ? ' selected' : '') + '>' + n + '</option>';
    }).join('') +
    '<option value="' + total + '"' + (per >= total ? ' selected' : '') + '>Todas</option>' +
    '</select></div>';

  var pagBtns = '';
  if (pages > 1) {
    for (var i = 1; i <= Math.min(pages, 10); i++) {
      pagBtns += '<button class="page-btn' + (i === page ? ' active' : '') + '" onclick="_areaTableGoPage(\'' + tid + '\',' + i + ')">' + i + '</button>';
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

/** Muda quantidade por pagina */
function _areaTableSetPer(tid, per) {
  per = parseInt(per, 10) || 10;
  var d = window._areaTableData[tid];
  if (!d) return;
  d.per = per;
  d.page = 1;
  var wrap = document.getElementById(tid + '-wrap');
  if (wrap) wrap.innerHTML = _buildAreaTable(tid, d.members, 1, per);
}

/** Vai para pagina especifica */
function _areaTableGoPage(tid, page) {
  var d = window._areaTableData[tid];
  if (!d) return;
  d.page = page;
  var wrap = document.getElementById(tid + '-wrap');
  if (wrap) wrap.innerHTML = _buildAreaTable(tid, d.members, page, d.per);
}

function toggleSubArea(prefix, idx) {
  var el = document.getElementById(prefix + '-sub-' + idx);
  if (el) el.classList.toggle('open');
}

/* ── Modal de configuracao de hierarquia ── */
function openHierarchyModal() {
  renderHierarchyModal();
  document.getElementById('hierOverlay').classList.add('open');
}

function closeHierarchyModal() {
  document.getElementById('hierOverlay').classList.remove('open');
}

function renderHierarchyModal() {
  var content = document.getElementById('hierContent');
  var macros = Object.keys(HIERARCHY).sort();
  if (!macros.length) {
    content.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px">Nenhum setor macro configurado. Adicione abaixo.</div>';
  } else {
    content.innerHTML = macros.map(function(macro) {
      var h = HIERARCHY[macro];
      var subs = h.subareas || {};
      var areasHtml = (h.areas || []).map(function(a) {
        var subList = subs[a] || [];
        var subHtml = subList.length > 0
          ? '<div style="padding-left:16px;margin-top:2px">' + subList.map(function(sa) {
              return '<span class="hier-area-chip" style="font-size:10px;opacity:.8">' + sa + '</span>';
            }).join('') + '</div>'
          : '';
        return '<span class="hier-area-chip">' + a + (subList.length ? ' (' + subList.length + ')' : '') + '<button onclick="removeHierArea(\'' + escAttr(macro) + '\',\'' + escAttr(a) + '\')">&times;</button></span>' + subHtml;
      }).join('');
      return '<div class="hier-macro-row">' +
        '<span class="hier-macro-name">' + esc(macro) + '</span>' +
        (h.manual ? '<span class="hier-macro-manual">Manual</span>' : '') +
        '<button class="btn btn-outline btn-sm" style="font-size:10px;padding:3px 8px" onclick="removeHierMacro(\'' + escAttr(macro) + '\')">Remover</button>' +
      '</div>' +
      (areasHtml ? '<div class="hier-area-list">' + areasHtml + '</div>' : '<div class="hier-area-list" style="padding-left:24px;font-size:11px;color:var(--muted);margin-bottom:8px">Nenhuma area configurada</div>');
    }).join('');
  }

  // Atualizar select de macros para adicionar area
  var sel = document.getElementById('hierAreaMacro');
  sel.innerHTML = macros.map(function(m) { return '<option value="' + m + '">' + m + '</option>'; }).join('');
}

function addHierMacro() {
  var input = document.getElementById('hierNewMacro');
  var name = input.value.trim();
  if (!name) { toast('Informe o nome do setor macro.'); return; }
  var manual = document.getElementById('hierNewManual').checked;
  createMacroSetor(name, { manual: manual }).then(function() {
    input.value = '';
    document.getElementById('hierNewManual').checked = false;
    renderHierarchyModal();
    renderLicView();
  });
}

function removeHierMacro(name) {
  removeMacroSetor(name).then(function() {
    renderHierarchyModal();
    renderLicView();
  });
}

function addHierArea() {
  var macro = document.getElementById('hierAreaMacro').value;
  var input = document.getElementById('hierNewArea');
  var area = input.value.trim();
  if (!macro) { toast('Selecione um setor macro.'); return; }
  if (!area) { toast('Informe o nome da area.'); return; }
  addAreaToMacro(macro, area).then(function() {
    input.value = '';
    renderHierarchyModal();
    renderLicView();
  });
}

function removeHierArea(macro, area) {
  removeAreaFromMacro(macro, area).then(function() {
    renderHierarchyModal();
    renderLicView();
  });
}
