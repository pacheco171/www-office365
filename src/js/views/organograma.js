/* ══════════ ORGANOGRAMA — Árvore hierárquica por setor ══════════ */

var _orgData     = [];
var _orgFiltered = [];
var _orgEditMacro = '';
var _orgEditOverrides = {};
var _orgAllUsers = [];

/* ── Carrega dados e renderiza ─────────────────────────────────────────────── */

function renderOrganograma() {
  var grid = document.getElementById('orgGrid');
  if (!grid) return;
  grid.innerHTML = '<div class="org-loading">Carregando...</div>';

  var isSuper = typeof userRole !== 'undefined' && userRole === 'superadmin';

  var pUsers = isSuper
    ? fetch('/api/organograma/usuarios')
        .then(function(r) { return r.ok ? r.json() : []; })
        .catch(function() { return []; })
    : Promise.resolve([]);

  Promise.all([
    fetch('/api/organograma').then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }),
    pUsers,
  ])
    .then(function(results) {
      _orgData = results[0];
      _orgAllUsers = Array.isArray(results[1]) ? results[1] : [];
      var sub = document.getElementById('orgSub');
      if (sub) sub.textContent = _orgData.length + ' setores';
      _orgFilter();
    })
    .catch(function(err) {
      grid.innerHTML = '<div class="org-loading" style="color:var(--red)">Erro ao carregar: ' + err.message + '</div>';
    });
}

/* ── Filtro de busca ───────────────────────────────────────────────────────── */

function _orgFilter() {
  var q = ((document.getElementById('orgSearch') || {}).value || '').trim().toLowerCase();
  if (!q) {
    _orgFiltered = _orgData;
  } else {
    _orgFiltered = _orgData.filter(function(s) {
      if (s.macro.toLowerCase().indexOf(q) >= 0) return true;
      if (s.responsavel && (
        s.responsavel.nome.toLowerCase().indexOf(q) >= 0 ||
        s.responsavel.cargo.toLowerCase().indexOf(q) >= 0
      )) return true;
      return s.equipe.some(function(m) {
        return m.nome.toLowerCase().indexOf(q) >= 0 || m.cargo.toLowerCase().indexOf(q) >= 0;
      });
    });
  }
  _orgRender();
}

/* ── Renderização dos cards ────────────────────────────────────────────────── */

function _orgRender() {
  var grid = document.getElementById('orgGrid');
  if (!grid) return;

  if (!_orgFiltered.length) {
    grid.innerHTML = '<div class="org-loading">Nenhum setor encontrado.</div>';
    return;
  }

  var isSuperadmin = typeof userRole !== 'undefined' && userRole === 'superadmin';

  grid.innerHTML = _orgFiltered.map(function(s) {
    var editBtn = isSuperadmin
      ? '<button class="org-edit-btn" onclick="_orgOpenEditModal(\'' + _esc(s.macro) + '\')" title="Editar árvore">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
        + '</button>'
      : '';

    var treeHtml = s.tree && s.tree.length
      ? _renderTreeNodes(s.tree, 0, true)
      : '<div class="org-empty">Sem membros</div>';

    return '<div class="org-card">'
      + '<div class="org-card-header">'
      + '<div class="org-card-title">' + _esc(s.macro) + '</div>'
      + '<div class="org-card-meta">' + s.total + ' colaborador' + (s.total !== 1 ? 'es' : '') + ' na área</div>'
      + editBtn
      + '</div>'
      + '<div class="org-tree-wrap">' + treeHtml + '</div>'
      + '</div>';
  }).join('');
}

/* ── Renderização recursiva da árvore ─────────────────────────────────────── */

function _renderTreeNodes(nodes, depth, isRoot) {
  if (!nodes || !nodes.length) return '';

  var INLINE_LIMIT = depth === 0 ? 1 : 4; // no card: raiz + 4 filhos diretos
  var visible = nodes.slice(0, INLINE_LIMIT);
  var hidden  = nodes.slice(INLINE_LIMIT);

  var html = '<ul class="org-tree' + (depth === 0 ? ' org-tree-root' : '') + '">';

  visible.forEach(function(n) {
    var isRootNode = depth === 0 && isRoot;
    var hasChildren = n.children && n.children.length > 0;

    html += '<li class="org-tree-li">';
    html += '<div class="org-node' + (isRootNode ? ' org-node-root' : '') + '">';
    html += '<span class="org-node-avatar' + (isRootNode ? ' org-node-avatar-root' : '') + '">' + _ini(n.nome) + '</span>';
    html += '<span class="org-node-info">';
    html += '<span class="org-node-nome">' + _esc(n.nome) + '</span>';
    if (n.cargo) html += '<span class="org-node-cargo">' + _esc(n.cargo) + '</span>';
    html += '</span>';
    html += '</div>';

    if (hasChildren) {
      html += _renderTreeNodes(n.children, depth + 1, false);
    }
    html += '</li>';
  });

  if (hidden.length) {
    var hiddenId = 'oth_' + Math.random().toString(36).slice(2, 8);
    html += '<li class="org-tree-li org-tree-more">';
    html += '<span class="org-mais" onclick="_orgToggleMore(this,\'' + hiddenId + '\')">'
      + '+ ' + hidden.length + ' mais</span>';
    html += '<div id="' + hiddenId + '" style="display:none">';
    html += '<ul class="org-tree">';
    hidden.forEach(function(n) {
      html += '<li class="org-tree-li">';
      html += '<div class="org-node">';
      html += '<span class="org-node-avatar">' + _ini(n.nome) + '</span>';
      html += '<span class="org-node-info">';
      html += '<span class="org-node-nome">' + _esc(n.nome) + '</span>';
      if (n.cargo) html += '<span class="org-node-cargo">' + _esc(n.cargo) + '</span>';
      html += '</span></div>';
      if (n.children && n.children.length) {
        html += _renderTreeNodes(n.children, depth + 1, false);
      }
      html += '</li>';
    });
    html += '</ul></div></li>';
  }

  html += '</ul>';
  return html;
}

function _orgToggleMore(btn, id) {
  var el = document.getElementById(id);
  if (!el) return;
  var showing = el.style.display !== 'none';
  el.style.display = showing ? 'none' : 'block';
  var count = el.querySelectorAll('.org-tree-li:not(.org-tree-more)').length;
  btn.textContent = showing ? '+ ' + count + ' mais' : 'Ver menos';
}

/* ══════════ MODAL DE EDIÇÃO DA ÁRVORE ══════════ */

function _orgOpenEditModal(macro) {
  _orgEditMacro = macro;
  var sector = _orgData.find(function(s) { return s.macro === macro; });
  if (!sector) return;

  _orgEditOverrides = {};

  var modal = document.getElementById('orgEditModal');
  if (modal && modal.parentNode !== document.body) {
    document.body.appendChild(modal);
  }
  document.getElementById('orgEditModalTitle').textContent = macro;

  _orgPopulatePapeisSelects(sector);
  _orgRenderEditTree(sector);

  modal.style.display = 'flex';
}

function _orgPopulatePapeisSelects(sector) {
  var gerente = sector.gerente_email || '';
  var coords = {};
  (sector.coordenadores_emails || []).forEach(function(e) { coords[e] = true; });

  var fonte = (_orgAllUsers && _orgAllUsers.length)
    ? _orgAllUsers
    : (sector.todos_membros || []).map(function(m) {
        return { email: m.email, nome: m.nome, cargo: m.cargo, macro: sector.macro };
      });

  var porMacro = {};
  fonte.forEach(function(m) {
    var key = m.macro || sector.macro || 'Sem setor';
    (porMacro[key] = porMacro[key] || []).push(m);
  });
  Object.keys(porMacro).forEach(function(k) {
    porMacro[k].sort(function(a, b) { return (a.nome || '').localeCompare(b.nome || ''); });
  });

  var currentMacro = sector.macro;
  var outros = Object.keys(porMacro).filter(function(k) { return k !== currentMacro; }).sort();
  var ordered = [];
  if (porMacro[currentMacro]) ordered.push({ label: 'Setor desta área', members: porMacro[currentMacro] });
  outros.forEach(function(k) { ordered.push({ label: k, members: porMacro[k] }); });

  function buildOptions(selectedCheck) {
    return ordered.map(function(group) {
      var opts = group.members.map(function(m) {
        var label = m.nome + (m.cargo ? ' — ' + m.cargo : '');
        var sel = selectedCheck(m.email) ? ' selected' : '';
        return '<option value="' + _esc(m.email) + '"' + sel + '>' + _esc(label) + '</option>';
      }).join('');
      return '<optgroup label="' + _esc(group.label) + '">' + opts + '</optgroup>';
    }).join('');
  }

  var selG = document.getElementById('orgGerenteSelect');
  if (selG) {
    selG.innerHTML = '<option value="">— Automático (por cargo) —</option>'
      + buildOptions(function(e) { return e === gerente; });
  }

  var selC = document.getElementById('orgCoordSelect');
  if (selC) {
    selC.innerHTML = buildOptions(function(e) { return !!coords[e]; });
  }
}

function _orgReadPapeis() {
  var selG = document.getElementById('orgGerenteSelect');
  var selC = document.getElementById('orgCoordSelect');
  var gerente = selG ? (selG.value || '') : '';
  var coords = [];
  if (selC) {
    for (var i = 0; i < selC.options.length; i++) {
      if (selC.options[i].selected && selC.options[i].value && selC.options[i].value !== gerente) {
        coords.push(selC.options[i].value);
      }
    }
  }
  return { gerente_email: gerente, coordenadores_emails: coords };
}

function _orgRenderEditTree(sector) {
  var container = document.getElementById('orgEditTree');
  if (!container) return;
  container.innerHTML = _renderEditNodes(sector.tree, null, sector);
}

function _renderEditNodes(nodes, parentEmail, sector) {
  if (!nodes || !nodes.length) return '';
  var html = '<ul class="org-tree org-tree-edit">';
  nodes.forEach(function(n) {
    var isRoot = !parentEmail;
    html += '<li class="org-tree-li">';
    html += '<div class="org-node org-node-editable' + (isRoot ? ' org-node-root' : '') + '" data-email="' + _esc(n.email) + '" data-parent="' + _esc(parentEmail || '') + '">';
    html += '<span class="org-node-avatar' + (isRoot ? ' org-node-avatar-root' : '') + '">' + _ini(n.nome) + '</span>';
    html += '<span class="org-node-info">';
    html += '<span class="org-node-nome">' + _esc(n.nome) + '</span>';
    if (n.cargo) html += '<span class="org-node-cargo">' + _esc(n.cargo) + '</span>';
    html += '</span>';
    html += '<button class="org-move-btn" onclick="_orgMoveNode(this)" title="Mover para outro pai">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>'
      + '</button>';
    html += '</div>';
    if (n.children && n.children.length) {
      html += _renderEditNodes(n.children, n.email, sector);
    }
    html += '</li>';
  });
  html += '</ul>';
  return html;
}

/* ── Seleção de novo pai ───────────────────────────────────────────────────── */

function _orgMoveNode(btn) {
  var nodeDiv = btn.parentElement;
  var email   = nodeDiv.dataset.email;
  var macro   = _orgEditMacro;
  var sector  = _orgData.find(function(s) { return s.macro === macro; });
  if (!sector) return;

  // Coleta todos os membros do setor como opções de pai
  var allMembers = _flattenTree(sector.tree);

  // Remove o próprio nó e seus descendentes das opções
  var descendants = _getDescendants(sector.tree, email);
  descendants.push(email);

  var options = allMembers.filter(function(m) { return descendants.indexOf(m.email) === -1; });

  // Injeta inline um select de escolha de pai
  if (nodeDiv.querySelector('.org-parent-select')) {
    nodeDiv.querySelector('.org-parent-select').remove();
    return;
  }

  var sel = document.createElement('select');
  sel.className = 'org-parent-select';
  sel.innerHTML = '<option value="">— Tornar raiz —</option>'
    + options.map(function(m) {
        return '<option value="' + _esc(m.email) + '">' + _esc(m.nome) + ' (' + _esc(m.cargo) + ')</option>';
      }).join('');

  sel.onchange = function() {
    _orgEditOverrides[email] = sel.value;  // "" = raiz
    sel.remove();
    // Re-renderiza a árvore do modal com os novos overrides aplicados
    var updatedSector = _applyOverridesToTree(sector);
    document.getElementById('orgEditTree').innerHTML = _renderEditNodes(updatedSector.tree, null, sector);
  };

  nodeDiv.appendChild(sel);
  sel.focus();
}

function _flattenTree(nodes) {
  var result = [];
  (nodes || []).forEach(function(n) {
    result.push({ email: n.email, nome: n.nome, cargo: n.cargo, nivel: n.nivel });
    if (n.children && n.children.length) {
      result = result.concat(_flattenTree(n.children));
    }
  });
  return result;
}

function _getDescendants(nodes, targetEmail) {
  var node = _findNode(nodes, targetEmail);
  if (!node) return [];
  return _flattenTree(node.children || []).map(function(m) { return m.email; });
}

function _findNode(nodes, email) {
  for (var i = 0; i < (nodes || []).length; i++) {
    if (nodes[i].email === email) return nodes[i];
    var found = _findNode(nodes[i].children, email);
    if (found) return found;
  }
  return null;
}

/* Reconstrói a árvore localmente aplicando _orgEditOverrides */
function _applyOverridesToTree(sector) {
  // Achata todos os membros
  var allMembers = _flattenTree(sector.tree);
  // Aplica overrides sobre a estrutura original
  // Manda para a API que faz o rebuild — aqui apenas previsualizamos
  // Rebuild simplificado: monta parent_map combinando árvore original + overrides
  var parentMap = {};

  // Extrai parent_map da árvore original
  function extractParents(nodes, parentEmail) {
    (nodes || []).forEach(function(n) {
      parentMap[n.email] = parentEmail || null;
      extractParents(n.children, n.email);
    });
  }
  extractParents(sector.tree, null);

  // Aplica overrides locais
  Object.keys(_orgEditOverrides).forEach(function(email) {
    parentMap[email] = _orgEditOverrides[email] || null;
  });

  // Reconstrói árvore a partir do parentMap
  var nodes = {};
  allMembers.forEach(function(m) {
    nodes[m.email] = { email: m.email, nome: m.nome, cargo: m.cargo, nivel: m.nivel, children: [] };
  });

  var roots = [];
  allMembers.forEach(function(m) {
    var parent = parentMap[m.email];
    if (parent && nodes[parent]) {
      nodes[parent].children.push(nodes[m.email]);
    } else {
      roots.push(nodes[m.email]);
    }
  });

  return { tree: roots };
}

/* ── Fechar / Salvar / Reset ───────────────────────────────────────────────── */

function closeOrgEditModal() {
  document.getElementById('orgEditModal').style.display = 'none';
  _orgEditOverrides = {};
}

function saveOrgTree() {
  if (!_orgEditMacro) return;

  var sector = _orgData.find(function(s) { return s.macro === _orgEditMacro; });
  if (!sector) return;

  var toSave = {};
  Object.keys(_orgEditOverrides).forEach(function(email) {
    toSave[email] = _orgEditOverrides[email] || '';
  });

  var papeis = _orgReadPapeis();

  fetch('/api/organograma/papeis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      macro: _orgEditMacro,
      gerente_email: papeis.gerente_email,
      coordenadores_emails: papeis.coordenadores_emails,
    }),
  })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (!res.ok) throw new Error(res.error || 'falha nos papéis');
      return fetch('/api/organograma/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ macro: _orgEditMacro, overrides: toSave }),
      });
    })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (res.ok) {
        closeOrgEditModal();
        _orgData = [];
        renderOrganograma();
        if (typeof toast === 'function') toast('Alterações salvas.');
      } else {
        if (typeof toast === 'function') toast('Erro: ' + (res.error || 'falha'));
      }
    })
    .catch(function(err) {
      if (typeof toast === 'function') toast('Erro ao salvar: ' + (err.message || 'falha'));
    });
}

function resetOrgTree() {
  if (!_orgEditMacro) return;
  var macro = _orgEditMacro;

  Promise.all([
    fetch('/api/organograma/papeis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ macro: macro, gerente_email: '', coordenadores_emails: [] }),
    }).then(function(r) { return r.json(); }),
    fetch('/api/organograma/tree', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ macro: macro, overrides: null }),
    }).then(function(r) { return r.json(); }),
  ]).then(function(results) {
    if (results[0].ok && results[1].ok) {
      closeOrgEditModal();
      _orgData = [];
      renderOrganograma();
      if (typeof toast === 'function') toast('Área resetada para automático.');
    } else {
      if (typeof toast === 'function') toast('Erro ao resetar.');
    }
  }).catch(function() {
    if (typeof toast === 'function') toast('Erro ao resetar.');
  });
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */

function _ini(nome) {
  if (!nome) return '?';
  var parts = nome.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (nome.slice(0, 2)).toUpperCase();
}

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
