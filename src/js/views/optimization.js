/* ══════════ OPTIMIZATION — Analise de Oportunidades de Economia ══════════
   Identifica usuarios com licencas mais caras do que o necessario
   e sugere downgrade com base em perfil de uso/cargo/setor.            */

/* ── Regras de otimizacao ── */

/** Mapa de downgrade sugerido por licenca.
 *  Cada regra tem: condição (fn) + licença sugerida + motivo */
var OPT_RULES = [
  // 1. Inativos com licenca paga → remover
  {
    id: 'inactive-paid',
    title: 'Inativos com licenca paga',
    desc: 'Usuarios bloqueados/inativos que ainda possuem licenca paga atribuida.',
    severity: 'high',
    test: function(r) {
      return r.status === 'Inativo' && r.licId !== 'none' && userCost(r) > 0;
    },
    suggest: 'none',
    reason: 'Usuario inativo — licenca pode ser removida'
  },
  // 2. E3 em cargo genérico → poderia ser Standard ou Basic
  {
    id: 'e3-downgrade',
    title: 'Office 365 E3 em perfil basico',
    desc: 'Usuarios com licenca Enterprise E3 (R$ 90,29) que nao parecem precisar de recursos enterprise (compliance, auditoria avancada).',
    severity: 'high',
    test: function(r) {
      if (r.licId !== 'e3' || r.status === 'Inativo') return false;
      var cargo = (r.cargo || '').toLowerCase();
      // Se cargo indica gestao/diretoria/compliance, manter E3
      var needsE3 = /diretor|gerente|compliance|audit|juridic|legal|cto|cio|cfo|ceo/.test(cargo);
      return !needsE3;
    },
    suggest: 'bstd',
    reason: function(r) {
      if ((r.cargoOrigem || 'ad') === 'fallback') return 'Cargo nao preenchido no AD — confirmar funcao antes de fazer downgrade';
      return 'Perfil nao requer recursos Enterprise — Business Standard atende';
    }
  },
  // 3. Business Standard em cargo operacional → poderia ser Basic ou F3
  {
    id: 'bstd-to-basic',
    title: 'Business Standard sem uso de apps desktop',
    desc: 'Usuarios com Standard (R$ 78,15) em funcoes que provavelmente usam apenas email e Teams, sem necessidade de Word/Excel/PowerPoint desktop.',
    severity: 'medium',
    test: function(r) {
      if (r.licId !== 'bstd' || r.status === 'Inativo') return false;
      var cargo = (r.cargo || '').toLowerCase();
      var setor = (r.setor || '').toLowerCase();
      // Setores/cargos que provavelmente nao usam apps desktop
      var basicProfile = /loja|vendedor|atendente|operador|auxiliar|estagiario|jovem aprendiz|recepcion|porteiro|motorista|entregador|estoquista|repositor|caixa|promotor/.test(cargo) ||
        /lojas|servico|serviço/.test(setor);
      return basicProfile;
    },
    suggest: 'bbasic',
    reason: 'Perfil operacional — Business Basic (web + email 50GB) atende'
  },
  // 4. Business Basic onde F3 bastaria (email 2GB suficiente)
  {
    id: 'basic-to-f3',
    title: 'Business Basic onde F3 bastaria',
    desc: 'Usuarios com Basic (R$ 31,21) em funcoes frontline que nao precisam de 50GB de email — Office 365 F3 (R$ 25) com 2GB seria suficiente.',
    severity: 'low',
    test: function(r) {
      if (r.licId !== 'bbasic' || r.status === 'Inativo') return false;
      var cargo = (r.cargo || '').toLowerCase();
      var setor = (r.setor || '').toLowerCase();
      // Perfis frontline que usam pouco email
      var frontline = /loja|vendedor|atendente|operador|auxiliar|promotor|repositor|caixa|porteiro|motorista|entregador|estoquista/.test(cargo) ||
        /lojas/.test(setor);
      return frontline;
    },
    suggest: 'f3',
    reason: 'Perfil frontline — F3 com 2GB de email e apps web atende'
  },
  // 5. Business Standard em setores que poderiam usar Basic
  {
    id: 'bstd-setor-basic',
    title: 'Business Standard em cargo generico',
    desc: 'Usuarios com Standard (R$ 78,15) cujo cargo e "Colaborador" sem especializacao definida. Avaliar se realmente precisam de apps desktop (Word/Excel instalados) ou se a versao web (Basic R$ 31,21) atende.',
    severity: 'medium',
    test: function(r) {
      if (r.licId !== 'bstd' || r.status === 'Inativo') return false;
      var cargo = (r.cargo || '').toLowerCase();
      // Ja coberto pela regra bstd-to-basic
      var basicProfile = /loja|vendedor|atendente|operador|auxiliar|estagiario|jovem aprendiz|recepcion|porteiro|motorista|entregador|estoquista|repositor|caixa|promotor/.test(cargo);
      if (basicProfile) return false; // ja pego pela outra regra
      // Cargo generico "Colaborador" sem especializacao
      return cargo === 'colaborador';
    },
    suggest: 'bbasic',
    reason: function(r) {
      if ((r.cargoOrigem || 'ad') === 'fallback') return 'Cargo nao preenchido no AD — confirmar funcao real antes de alterar licenca';
      return 'Cargo generico — avaliar se precisa de apps desktop (Standard) ou se web basta (Basic)';
    }
  }
];

/** Analisa todos os registros e retorna oportunidades agrupadas */
function analyzeOptimization() {
  var results = [];
  var seen = {}; // evita duplicatas (email ja analisado por regra mais prioritaria)

  OPT_RULES.forEach(function(rule) {
    var matches = [];
    db.forEach(function(r) {
      var email = (r.email || '').toLowerCase();
      if (seen[email]) return;
      if (rule.test(r)) {
        var currentCost = userCost(r);
        var sugLic = licById[rule.suggest];
        var sugCost = sugLic ? sugLic.price : 0;
        // Manter custo dos addons
        var addonCost = (r.addons || []).reduce(function(s, id) { return s + (licById[id] ? licById[id].price : 0); }, 0);
        var saving = currentCost - sugCost - addonCost;
        if (saving <= 0) return;
        matches.push({
          record: r,
          currentLic: r.licId,
          suggestedLic: rule.suggest,
          currentCost: currentCost,
          suggestedCost: sugCost + addonCost,
          saving: saving,
          reason: typeof rule.reason === 'function' ? rule.reason(r) : rule.reason
        });
        seen[email] = true;
      }
    });
    if (matches.length) {
      matches.sort(function(a, b) { return (a.record.nome||'').localeCompare(b.record.nome||''); });
      var totalSaving = matches.reduce(function(s, m) { return s + m.saving; }, 0);
      results.push({
        rule: rule,
        matches: matches,
        totalSaving: totalSaving
      });
    }
  });

  // Ordenar por economia total decrescente
  results.sort(function(a, b) { return b.totalSaving - a.totalSaving; });
  return results;
}

/* ── Render ── */
function renderOptimization() {
  var container = document.getElementById('optContent');
  var analysis = analyzeOptimization();

  if (!db.length) {
    container.innerHTML = '<div class="opt-empty">Nenhum dado disponivel. Importe um CSV para comecar.</div>';
    return;
  }

  var grandSaving = analysis.reduce(function(s, g) { return s + g.totalSaving; }, 0);
  var totalUsers = analysis.reduce(function(s, g) { return s + g.matches.length; }, 0);
  var currentTotal = db.filter(function(r) { return r.status !== 'Inativo'; }).reduce(function(s, r) { return s + userCost(r); }, 0);

  // Summary cards
  var summaryHtml = '<div class="opt-summary">' +
    '<div class="opt-summary-card">' +
      '<div class="opt-summary-icon opt-icon-saving">$</div>' +
      '<div><div class="opt-summary-label">Economia potencial/mes</div>' +
      '<div class="opt-summary-val opt-val-saving">' + fmtBRL(grandSaving) + '</div>' +
      '<div class="opt-summary-sub">' + fmtBRL(grandSaving * 12) + '/ano</div></div>' +
    '</div>' +
    '<div class="opt-summary-card">' +
      '<div class="opt-summary-icon opt-icon-users">&#9679;</div>' +
      '<div><div class="opt-summary-label">Usuarios para revisar</div>' +
      '<div class="opt-summary-val">' + totalUsers + '</div>' +
      '<div class="opt-summary-sub">de ' + db.length + ' total</div></div>' +
    '</div>' +
    '<div class="opt-summary-card">' +
      '<div class="opt-summary-icon opt-icon-pct">%</div>' +
      '<div><div class="opt-summary-label">Reducao possivel</div>' +
      '<div class="opt-summary-val">' + (currentTotal > 0 ? Math.round(grandSaving / currentTotal * 100) : 0) + '%</div>' +
      '<div class="opt-summary-sub">do custo mensal atual</div></div>' +
    '</div>' +
  '</div>';

  if (!analysis.length) {
    container.innerHTML = summaryHtml +
      '<div class="opt-empty">Nenhuma oportunidade de otimizacao identificada. As licencas parecem adequadas aos perfis.</div>';
    return;
  }

  // Disclaimer
  var disclaimerHtml = '<div class="opt-disclaimer">' +
    'As sugestoes abaixo sao baseadas em cargo, setor e status. ' +
    'Avalie cada caso individualmente antes de alterar licencas — ' +
    'alguns usuarios podem ter necessidades especificas nao refletidas no perfil.' +
  '</div>';

  // Rule groups
  var groupsHtml = analysis.map(function(group, gi) {
    var rule = group.rule;
    var sevClass = 'opt-sev-' + rule.severity;
    var sevLabel = rule.severity === 'high' ? 'Alta' : rule.severity === 'medium' ? 'Media' : 'Baixa';

    var headerHtml = '<div class="opt-group-header" onclick="toggleOptGroup(' + gi + ')">' +
      '<svg class="opt-group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>' +
      '<div class="opt-group-info">' +
        '<div class="opt-group-title">' + esc(rule.title) + '</div>' +
        '<div class="opt-group-desc">' + esc(rule.desc) + '</div>' +
      '</div>' +
      '<span class="opt-sev-badge ' + sevClass + '">' + sevLabel + '</span>' +
      '<div class="opt-group-nums">' +
        '<div class="opt-group-count">' + group.matches.length + ' usuario' + (group.matches.length !== 1 ? 's' : '') + '</div>' +
        '<div class="opt-group-saving">' + fmtBRL(group.totalSaving) + '/mes</div>' +
      '</div>' +
    '</div>';

    var tableHtml = '<div class="opt-group-body">' +
      '<div class="opt-group-body-inner">' +
        '<table class="opt-table">' +
          '<thead><tr>' +
            '<th>Colaborador</th>' +
            '<th>Setor</th>' +
            '<th>Cargo</th>' +
            '<th>Licenca atual</th>' +
            '<th>Sugestao</th>' +
            '<th>Economia/mes</th>' +
          '</tr></thead>' +
          '<tbody>' + group.matches.map(function(m) {
            var r = m.record;
            return '<tr onclick="openDetail(' + r.id + ')">' +
              '<td><div class="person-cell"><div class="avatar">' + ini(r.nome) + '</div>' +
                '<div><div class="person-name">' + esc(r.nome) + '</div>' +
                '<div class="person-email">' + esc(r.email) + '</div></div></div></td>' +
              '<td><span class="dept-tag">' + esc(r.setor) + '</span></td>' +
              '<td style="font-size:12px">' + cargoCell(r) + '</td>' +
              '<td>' + licBadge(m.currentLic) + '<div class="opt-cost-current">' + fmtBRL(m.currentCost) + '</div></td>' +
              '<td>' + licBadge(m.suggestedLic) + '<div class="opt-cost-suggested">' + fmtBRL(m.suggestedCost) + '</div></td>' +
              '<td><span class="opt-saving-badge">' + fmtBRL(m.saving) + '</span></td>' +
            '</tr>';
          }).join('') + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';

    return '<div class="opt-group" id="optGroup-' + gi + '">' + headerHtml + tableHtml + '</div>';
  }).join('');

  container.innerHTML = summaryHtml + disclaimerHtml + groupsHtml;
}

function toggleOptGroup(idx) {
  var el = document.getElementById('optGroup-' + idx);
  if (el) el.classList.toggle('open');
}
