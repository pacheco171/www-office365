/* ══════════ ALERTAS DE SEGURANÇA — Graph Security + Análise Local ══════════ */

var _alertasLastUpdated = null;
var _alertasUpdateTimer = null;

function refreshAlertas() {
  sessionStorage.removeItem('vc_alertas_ms');
  sessionStorage.removeItem('vc_alertas_local');
  _alertasMsData = null;
  _alertasLocalData = null;
  _alertasLastUpdated = new Date();
  clearTimeout(_alertasUpdateTimer);
  var el = document.getElementById('alertasLastUpdated');
  if(el) el.textContent = 'Agora mesmo';
  renderAlertasView();
  _alertasUpdateTimer = setTimeout(_updateAlertasLastUpdated, 60000);
}

function _updateAlertasLastUpdated() {
  if(!_alertasLastUpdated || document.hidden) return;
  var mins = Math.floor((new Date() - _alertasLastUpdated) / 60000);
  var el = document.getElementById('alertasLastUpdated');
  if(el) {
    el.textContent = mins < 1 ? 'Agora mesmo' : 'Atualizado há ' + mins + ' min';
    _alertasUpdateTimer = setTimeout(_updateAlertasLastUpdated, 60000);
  }
}

var _sevMap = {high:'Alta',medium:'Média',low:'Baixa',informational:'Info'};
var _statusMap = {resolved:'Resolvido',inProgress:'Em andamento',newAlert:'Novo',new:'Novo',unknown:'Desconhecido',dismissed:'Descartado'};

var _msAlertTitleMap = {
  'Atypical travel':'Viagem atípica',
  'User restricted from sending email':'Usuário com restrição de envio de e-mail',
  'User unblocked from sending email':'Usuário desbloqueado para envio de e-mail',
  'Email sending limit exceeded':'Limite de envio de e-mail excedido',
  'Anonymous IP address':'Endereço IP anônimo',
  'Activity from anonymous IP address':'Atividade de endereço IP anônimo',
  'Sign-in from anonymous IP address':'Login de endereço IP anônimo',
  'Activity from suspicious IP address':'Atividade de endereço IP suspeito',
  'Impossible travel':'Viagem impossível',
  'Impossible travel activity':'Atividade de viagem impossível',
  'Atypical travel activity':'Atividade de viagem atípica',
  'Unfamiliar sign-in properties':'Propriedades de entrada não reconhecidas',
  'Activity from infrequent country':'Atividade de país incomum',
  'Sign-in from unfamiliar location':'Login de local desconhecido',
  'Malware linked to infected device':'Malware vinculado a dispositivo infectado',
  'Sign-in from infected device':'Login de dispositivo infectado',
  'Malware detection':'Detecção de malware',
  'Malware not zapped':'Malware não removido automaticamente',
  'Password spray':'Ataque de pulverização de senha',
  'Leaked credentials':'Credenciais vazadas',
  'Azure AD threat intelligence':'Inteligência de ameaças do Azure AD',
  'Microsoft Entra threat intelligence':'Inteligência de ameaças do Microsoft Entra',
  'Suspicious inbox forwarding':'Encaminhamento suspeito na caixa de entrada',
  'Suspicious inbox manipulation rule':'Regra de manipulação suspeita na caixa de entrada',
  'Suspicious email forwarding activity':'Atividade suspeita de encaminhamento de e-mail',
  'Forwarding/redirect rule':'Regra de encaminhamento/redirecionamento',
  'Mass file download':'Download em massa de arquivos',
  'Unusual file download':'Download incomum de arquivos',
  'Mass file deletion':'Exclusão em massa de arquivos',
  'Mass deletion':'Exclusão em massa',
  'Unusual file access':'Acesso incomum a arquivos',
  'Suspicious file sharing activity':'Atividade suspeita de compartilhamento de arquivos',
  'Ransomware activity':'Atividade de ransomware',
  'Phishing email delivered to user':'E-mail de phishing entregue ao usuário',
  'Phishing email not zapped':'E-mail de phishing não removido automaticamente',
  'Email messages containing phishing URL':'E-mails com URL de phishing',
  'Email messages containing malware':'E-mails com malware',
  'Malicious URL click':'Clique em URL maliciosa',
  'Suspicious application consent':'Consentimento de aplicativo suspeito',
  'OAuth App with suspicious activities':'Aplicativo OAuth com atividades suspeitas',
  'Suspicious Power Automate activity':'Atividade suspeita no Power Automate',
  'Suspicious connector activity':'Atividade suspeita de conector',
  'Admin escalation':'Escalação de privilégio de administrador',
  'Multiple failed login attempts':'Múltiplas tentativas de login com falha',
  'User compromised':'Usuário comprometido',
  'Account compromised':'Conta comprometida',
  'High-risk sign-in':'Login de alto risco',
  'Risky sign-in':'Login arriscado',
  'Suspicious sign-in activity':'Atividade de login suspeita',
  'Suspicious user activity':'Atividade suspeita do usuário',
  'Data exfiltration':'Exfiltração de dados',
  'Sensitive information in email':'Informações confidenciais em e-mail',
  'Admin triggered manual investigation':'Investigação manual iniciada pelo administrador'
};

function _traduzAlertTitle(title){
  return _msAlertTitleMap[title] || title;
}

var _alertasMsData = null;
var _alertasLocalData = null;

function renderAlertasView(){
  _loadAlertasMicrosoft();
  _loadAlertasLocal();
}

function _loadAlertasMicrosoft(){
  var el = document.getElementById('alertasMsContent');
  if(!el) return;

  if(!_alertasMsData){try{var _c=JSON.parse(sessionStorage.getItem('vc_alertas_ms'));if(_c)_alertasMsData=_c;}catch(e){}}
  if(_alertasMsData){
    _renderAlertasMs(el, _alertasMsData);
    return;
  }

  el.innerHTML = loadingHTML('Carregando alertas do Microsoft Security...');

  fetchWithTimeout('/api/security/alerts').then(function(r){ return r.json(); }).then(function(res){
    if(res.error){
      el.innerHTML = errorHTML('refreshAlertas', res.error);
      return;
    }
    _alertasMsData = res.data || [];
    try{sessionStorage.setItem('vc_alertas_ms',JSON.stringify(_alertasMsData));}catch(e){}
    _renderAlertasMs(el, _alertasMsData);
  }).catch(function(){
    el.innerHTML = errorHTML('refreshAlertas');
  });
}

function _renderAlertasMs(el, data){
  if(data.length === 0){
    el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--green);font-weight:700">Nenhum alerta ativo encontrado — tudo em ordem!</div>';
    return;
  }

  var high = data.filter(function(a){ return a.severity === 'high'; }).length;
  var medium = data.filter(function(a){ return a.severity === 'medium'; }).length;
  var low = data.filter(function(a){ return a.severity === 'low' || a.severity === 'informational'; }).length;

  var html = ReportTable.kpiCards([
    {label:'Total Alertas', value: data.length},
    {label:'Alta', value: high, sub: high > 0 ? '<span style="color:var(--red)">Requer atenção</span>' : ''},
    {label:'Média', value: medium},
    {label:'Baixa / Info', value: low}
  ]);

  html += '<div style="margin-top:16px">';
  data.forEach(function(alert){
    var sevCls = alert.severity === 'high' ? 'sev-high' : alert.severity === 'medium' ? 'sev-medium' : alert.severity === 'low' ? 'sev-low' : 'sev-info';
    html += '<div class="alert-card" style="border-left:3px solid '+(alert.severity==='high'?'var(--red)':alert.severity==='medium'?'var(--yellow)':'var(--muted)')+'">';
    html += '<div class="alert-card-hdr"><div class="alert-card-title">'+esc(_traduzAlertTitle(alert.title||'Sem título'))+'</div>';
    html += '<div style="display:flex;gap:8px;align-items:center"><span class="alert-severity '+sevCls+'">'+esc(_sevMap[alert.severity]||alert.severity||'Info')+'</span>';
    html += '<span class="alert-card-date">'+(alert.createdDateTime ? fmtDate(alert.createdDateTime.split('T')[0]) : '')+'</span></div></div>';
    html += '<div class="alert-card-desc">'+esc(alert.description||'')+'</div>';
    if(alert.status){
      var _isNew=alert.status==='newAlert'||alert.status==='new';
      var _novoCls=_isNew?('b-novo-'+(alert.severity==='high'?'high':alert.severity==='medium'?'medium':alert.severity==='informational'?'info':'low')):(alert.status==='resolved'?'b-active':alert.status==='inProgress'?'b-pending':'b-inactive');
      html+='<div style="margin-top:8px"><span class="badge '+_novoCls+'">'+esc(_statusMap[alert.status]||alert.status)+'</span></div>';
    }
    html += '</div>';
  });
  html += '</div>';

  el.innerHTML = html;
}

function _loadAlertasLocal(){
  var el = document.getElementById('alertasLocalContent');
  var resumoEl = document.getElementById('alertasResumoContent');
  if(!el) return;

  if(!_alertasLocalData){try{var _cl=JSON.parse(sessionStorage.getItem('vc_alertas_local'));if(_cl)_alertasLocalData=_cl;}catch(e){}}
  if(_alertasLocalData){
    _renderAlertasLocal(el, _alertasLocalData);
    if(resumoEl) _renderAlertasResumo(resumoEl);
    return;
  }

  el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--muted)">Analisando dados locais...</div>';

  fetch('/api/security/analysis').then(function(r){ return r.json(); }).then(function(res){
    if(res.error){
      el.innerHTML = '<div class="empty-state error-state"><div class="empty-icon">⚠️</div><div class="empty-title">Não foi possível carregar</div><div class="empty-msg">'+esc(res.error)+'</div><button class="btn btn-dark" onclick="refreshAlertas()">Tentar novamente</button></div>';
      return;
    }
    _alertasLocalData = res.data || {};
    try{sessionStorage.setItem('vc_alertas_local',JSON.stringify(_alertasLocalData));}catch(e){}
    _renderAlertasLocal(el, _alertasLocalData);
    if(resumoEl) _renderAlertasResumo(resumoEl);
  }).catch(function(){
    el.innerHTML = '<div class="empty-state error-state"><div class="empty-icon">⚠️</div><div class="empty-title">Não foi possível carregar</div><div class="empty-msg">Erro na análise local.</div><button class="btn btn-dark" onclick="refreshAlertas()">Tentar novamente</button></div>';
  });
}

var _erroSignIn = {
  50126: 'Usuário ou senha inválidos',
  50053: 'Conta bloqueada por excesso de tentativas',
  50057: 'Conta desabilitada',
  50055: 'Senha expirada',
  50173: 'Senha temporária expirada — troca obrigatória',
  50074: 'Autenticação forte requerida',
  50076: 'Autenticação multifator requerida',
  50079: 'Registro de MFA necessário',
  50097: 'Autenticação de dispositivo requerida',
  53003: 'Acesso bloqueado por Acesso Condicional',
  530032: 'Bloqueado por política de segurança do tenant',
  50158: 'Desafio de segurança externo não satisfeito',
  50034: 'Usuário não encontrado no diretório',
  50144: 'Senha do usuário expirada',
  50140: 'Token de continuidade de sessão inválido',
  50089: 'Token expirado',
  50020: 'Usuário não autorizado (token de convidado ou externo)',
  65001: 'Consentimento de aplicativo não concedido',
  70011: 'Escopo de permissão inválido',
  70016: 'Autorização pendente (device flow)',
  80007: 'Falha na validação do domínio',
  90014: 'Campo obrigatório ausente na solicitação',
  500011: 'Recurso de serviço não encontrado',
  700016: 'Aplicativo não encontrado no tenant'
};

function _traduzMotivo(code, motivo){
  if(code && _erroSignIn[code]) return _erroSignIn[code];
  if(!motivo) return code ? 'Código de erro: ' + code : '—';
  return motivo;
}

var _localSectionCols = {
  noMfa: [
    {label:'Nome', key:'displayName', render: function(r){ return '<div style="display:flex;align-items:center;gap:8px"><div class="avatar" style="width:26px;height:26px;font-size:10px;flex-shrink:0">'+ini(r.displayName||r.email||'?')+'</div><span>'+esc(r.displayName||'—')+'</span></div>'; }},
    {label:'E-mail', key:'email', render: function(r){ return '<span style="font-size:12px;color:var(--muted)">'+esc(r.email||'—')+'</span>'; }},
    {label:'Setor', key:'setor', render: function(r){ return r.setor ? '<span class="dept-tag" style="font-size:11px">'+esc(r.setor)+'</span>' : '<span style="color:var(--muted)">—</span>'; }},
    {label:'Cargo', key:'cargo', render: function(r){ return esc(r.cargo||'—'); }}
  ],
  staleAccounts: [
    {label:'Nome', key:'displayName', render: function(r){ return '<div style="display:flex;align-items:center;gap:8px"><div class="avatar" style="width:26px;height:26px;font-size:10px;flex-shrink:0">'+ini(r.displayName||r.email||'?')+'</div><span>'+esc(r.displayName||'—')+'</span></div>'; }},
    {label:'E-mail', key:'email', render: function(r){ return '<span style="font-size:12px;color:var(--muted)">'+esc(r.email||'—')+'</span>'; }},
    {label:'Licença', key:'licId', render: function(r){ return typeof licBadge === 'function' ? licBadge(r.licId||'none') : esc(r.licId||'—'); }, sortValue: function(r){ return typeof getLic === 'function' ? (getLic(r.licId||'none').price||0) : 0; }},
    {label:'Custo/mês', key:'custo', render: function(r){ var c=r.custo||0; return c>0?'<span class="cost-val">'+fmtBRL(c)+'</span><span class="cost-per">/mês</span>':'<span style="color:var(--muted)">—</span>'; }, sortValue: function(r){ return r.custo||0; }},
    {label:'Último Acesso', key:'lastActivity', sortDescFirst: true, render: function(r){ return r.lastActivity ? '<span class="badge b-inactive">'+esc(fmtDate(r.lastActivity))+'</span>' : '<span style="color:var(--muted)">—</span>'; }, sortValue: function(r){ return r.lastActivity||''; }},
    {label:'Dias Inativo', key:'diasInativo', sortDescFirst: true, render: function(r){ return r.diasInativo ? '<span class="badge b-danger">'+r.diasInativo+' dias</span>' : '<span style="color:var(--muted)">—</span>'; }, sortValue: function(r){ return r.diasInativo||0; }},
    {label:'Setor', key:'setor', render: function(r){ return r.setor ? '<span class="dept-tag" style="font-size:11px;cursor:pointer" data-val="'+esc(r.setor)+'" onclick="_staleFilterSet(\'stale-filter-setor\',this.dataset.val)">'+esc(r.setor)+'</span>' : '<span style="color:var(--muted)">—</span>'; }},
    {label:'Cargo', key:'cargo', render: function(r){ return r.cargo ? '<span style="cursor:pointer;text-decoration:underline dotted" data-val="'+esc(r.cargo)+'" onclick="_staleFilterSet(\'stale-filter-cargo\',this.dataset.val)">'+esc(r.cargo)+'</span>' : '<span style="color:var(--muted)">—</span>'; }}
  ],
  adminsNoMfa: [
    {label:'Nome', key:'displayName', render: function(r){ return '<div style="display:flex;align-items:center;gap:8px"><div class="avatar" style="width:26px;height:26px;font-size:10px;flex-shrink:0">'+ini(r.displayName||r.email||'?')+'</div><span>'+esc(r.displayName||'—')+'</span></div>'; }},
    {label:'E-mail', key:'email', render: function(r){ return '<span style="font-size:12px;color:var(--muted)">'+esc(r.email||'—')+'</span>'; }}
  ],
  failedSignIns: [
    {label:'Nome', key:'displayName', render: function(r){ return '<div style="display:flex;align-items:center;gap:8px"><div class="avatar" style="width:26px;height:26px;font-size:10px;flex-shrink:0">'+ini(r.displayName||r.email||'?')+'</div><span>'+esc(r.displayName||'—')+'</span></div>'; }},
    {label:'E-mail', key:'email', render: function(r){ return '<span style="font-size:12px;color:var(--muted)">'+esc(r.email||'—')+'</span>'; }},
    {label:'Motivo', key:'motivo', render: function(r){ return '<span style="font-size:12px;color:var(--text)">'+esc(_traduzMotivo(r.errorCode, r.motivo))+'</span>'; }},
    {label:'Data', key:'data', render: function(r){ return r.data ? '<span class="date-cell">'+esc(fmtDate(r.data))+'</span>' : '<span style="color:var(--muted)">—</span>'; }, sortValue: function(r){ return r.data||''; }}
  ],
  blockedWithLicense: [
    {label:'Nome', key:'displayName', render: function(r){ return '<div style="display:flex;align-items:center;gap:8px"><div class="avatar" style="width:26px;height:26px;font-size:10px;flex-shrink:0">'+ini(r.displayName||r.email||'?')+'</div><span>'+esc(r.displayName||'—')+'</span></div>'; }},
    {label:'E-mail', key:'email', render: function(r){ return '<span style="font-size:12px;color:var(--muted)">'+esc(r.email||'—')+'</span>'; }},
    {label:'Licença', key:'licId', render: function(r){ return typeof licBadge === 'function' ? licBadge(r.licId||'none') : esc(r.licId||'—'); }, sortValue: function(r){ return typeof getLic === 'function' ? (getLic(r.licId||'none').price||0) : 0; }},
    {label:'Custo/mês', key:'custo', render: function(r){ var c=r.custo||0; return c>0?'<span class="cost-val">'+fmtBRL(c)+'</span><span class="cost-per">/mês</span>':'<span style="color:var(--muted)">—</span>'; }, sortValue: function(r){ return r.custo||0; }},
    {label:'Setor', key:'setor', render: function(r){ return r.setor ? '<span class="dept-tag" style="font-size:11px">'+esc(r.setor)+'</span>' : '<span style="color:var(--muted)">—</span>'; }},
    {label:'Cargo', key:'cargo', render: function(r){ return esc(r.cargo||'—'); }}
  ]
};

function _renderAlertasLocal(el, data){
  var sections = [
    {key:'noMfa', title:'Usuários sem MFA', severity:'high', desc:'Usuários que não possuem autenticação multifator habilitada', open:true},
    {key:'staleAccounts', title:'Contas Inativas (90+ dias)', severity:'medium', desc:'Contas com status ativo mas sem atividade há mais de 90 dias', open:true},
    {key:'adminsNoMfa', title:'Administradores sem MFA', severity:'high', desc:'Usuários com funções administrativas que não possuem MFA', open:false},
    {key:'failedSignIns', title:'Logins com Falha', severity:'medium', desc:'Tentativas de login que falharam recentemente', open:false},
    {key:'blockedWithLicense', title:'Bloqueados com Licença', severity:'low', desc:'Usuários inativos que ainda possuem licença ativa', open:false}
  ];

  var html = '';
  sections.forEach(function(sec){
    var items = data[sec.key] || [];
    var count = items.length;
    var sevColor = sec.severity === 'high' ? 'var(--red)' : sec.severity === 'medium' ? 'var(--yellow)' : 'var(--muted)';
    var countBg = sec.severity === 'high' ? 'rgba(184,92,74,.12)' : sec.severity === 'medium' ? 'rgba(184,144,58,.12)' : 'rgba(138,128,112,.1)';

    html += '<div class="analysis-section'+(sec.open && count > 0 ? ' open' : '')+'">';
    html += '<div class="analysis-section-hdr" onclick="this.parentElement.classList.toggle(\'open\')">';
    html += '<div class="analysis-section-title"><span style="color:'+sevColor+'">&#9679;</span>'+esc(sec.title);
    html += '<span class="analysis-section-count" style="background:'+countBg+';color:'+sevColor+'">'+count+'</span></div>';
    html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;color:var(--muted)"><polyline points="6 9 12 15 18 9"/></svg>';
    html += '</div>';
    html += '<div class="analysis-section-body">';
    html += '<div style="font-size:12px;color:var(--muted);margin-bottom:12px">'+esc(sec.desc)+'</div>';

    if(count === 0){
      html += '<div style="padding:12px;color:var(--green);font-weight:600;font-size:13px">Nenhum problema detectado</div>';
    } else {
      if(sec.key === 'staleAccounts') html += '<div id="alerta-filter-stale" class="stale-filter-bar"></div>';
      if(sec.key === 'blockedWithLicense') html += '<div id="alerta-filter-blocked" class="stale-filter-bar"></div>';
      html += '<div id="alerta-tbl-'+sec.key+'"></div>';
    }

    html += '</div></div>';
  });

  el.innerHTML = html;

  sections.forEach(function(sec){
    var items = data[sec.key] || [];
    if(items.length === 0) return;
    if(sec.key === 'staleAccounts'){
      _initStaleFilter(items);
      return;
    }
    if(sec.key === 'blockedWithLicense'){
      _initBlockedFilter(items);
      return;
    }
    var cols = _localSectionCols[sec.key] || [
      {label:'Nome', key:'displayName'},
      {label:'E-mail', key:'email'}
    ];
    ReportTable.build('alerta-tbl-'+sec.key, cols, items, {
      perPage: 10,
      perPageOptions: [10, 20, 30],
      exportName: 'seguranca-'+sec.key,
      searchable: true,
      exportable: true
    });
  });
}

var _staleApplyFilter = null;
var _staleFilterClicked = false;

function _staleFilterSet(selectId, val){
  _staleFilterClicked = true;
  var el = document.getElementById(selectId);
  if(el) el.value = val;
  if(_staleApplyFilter) _staleApplyFilter();
}

function _initStaleFilter(items){
  var filterEl = document.getElementById('alerta-filter-stale');
  var currentRange = '';
  var currentSort = 'custo-desc';
  var currentLic = '';
  var currentSetor = '';
  var currentCargo = '';
  var tblInstance = null;

  function licPrice(r){
    if(r.custo != null) return r.custo;
    return typeof getLic === 'function' ? (getLic(r.licId||'none').price||0) : 0;
  }

  function getFiltered(){
    var filtered = items.slice();
    if(currentRange){
      var parts = currentRange.split('-');
      var min = parseInt(parts[0]);
      var max = parts.length > 1 ? parseInt(parts[1]) : Infinity;
      filtered = filtered.filter(function(x){ return (x.diasInativo||0) >= min && (x.diasInativo||0) <= max; });
    }
    if(currentLic) filtered = filtered.filter(function(x){ return (x.licId||'none') === currentLic; });
    if(currentSetor) filtered = filtered.filter(function(x){ return (x.setor||'') === currentSetor; });
    if(currentCargo) filtered = filtered.filter(function(x){ return (x.cargo||'') === currentCargo; });
    if(currentSort === 'dias-desc') filtered.sort(function(a,b){ return (b.diasInativo||0)-(a.diasInativo||0); });
    else if(currentSort === 'dias-asc') filtered.sort(function(a,b){ return (a.diasInativo||0)-(b.diasInativo||0); });
    else if(currentSort === 'acesso-asc') filtered.sort(function(a,b){ return String(a.lastActivity||'').localeCompare(String(b.lastActivity||'')); });
    else if(currentSort === 'acesso-desc') filtered.sort(function(a,b){ return String(b.lastActivity||'').localeCompare(String(a.lastActivity||'')); });
    else if(currentSort === 'custo-desc') filtered.sort(function(a,b){ return licPrice(b)-licPrice(a); });
    else if(currentSort === 'custo-asc') filtered.sort(function(a,b){ return licPrice(a)-licPrice(b); });
    return filtered;
  }

  function applyFilter(){
    var rEl = document.getElementById('stale-filter-range');
    var sEl = document.getElementById('stale-filter-sort');
    var lEl = document.getElementById('stale-filter-lic');
    var setorEl = document.getElementById('stale-filter-setor');
    var cargoEl = document.getElementById('stale-filter-cargo');
    if(rEl) currentRange = rEl.value;
    if(sEl) currentSort = sEl.value;
    if(lEl) currentLic = lEl.value;
    if(setorEl) currentSetor = setorEl.value;
    if(cargoEl) currentCargo = cargoEl.value;
    if(tblInstance) tblInstance.refresh(getFiltered(), true);
  }
  _staleApplyFilter = applyFilter;

  if(filterEl){
    var uniqueLics = items.reduce(function(acc, x){
      var id = x.licId || 'none';
      if(!acc.find(function(e){ return e.id === id; })){
        var name = typeof getLic === 'function' ? getLic(id).short : id;
        var price = typeof getLic === 'function' ? (getLic(id).price||0) : 0;
        acc.push({id: id, name: name, price: price});
      }
      return acc;
    }, []);
    uniqueLics.sort(function(a,b){ return b.price - a.price; });

    var uniqueSetores = items.reduce(function(acc, x){
      var s = x.setor || '';
      if(s && acc.indexOf(s) === -1) acc.push(s);
      return acc;
    }, []).sort(function(a,b){ return a.localeCompare(b, 'pt-BR'); });

    var uniqueCargos = items.reduce(function(acc, x){
      var c = x.cargo || '';
      if(c && acc.indexOf(c) === -1) acc.push(c);
      return acc;
    }, []).sort(function(a,b){ return a.localeCompare(b, 'pt-BR'); });

    var licOpts = '<option value="">Todas</option>'
      + uniqueLics.map(function(l){
          return '<option value="'+esc(l.id)+'">'+esc(l.name)+(l.price > 0 ? ' ('+fmtBRL(l.price)+'/mês)' : '')+'</option>';
        }).join('');

    var setorOpts = '<option value="">Todos</option>'
      + uniqueSetores.map(function(s){ return '<option value="'+esc(s)+'">'+esc(s)+'</option>'; }).join('');

    var cargoOpts = '<option value="">Todos</option>'
      + uniqueCargos.map(function(c){ return '<option value="'+esc(c)+'">'+esc(c)+'</option>'; }).join('');

    filterEl.innerHTML =
      '<span class="stale-filter-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>Faixa:</span>'
      +'<select id="stale-filter-range" class="stale-select">'
      +'<option value="">Todos</option>'
      +'<option value="90-120">90 a 120 dias</option>'
      +'<option value="121-180">121 a 180 dias</option>'
      +'<option value="181-365">181 a 365 dias</option>'
      +'<option value="366-99999">Mais de 365 dias</option>'
      +'</select>'
      +'<span class="stale-filter-label" style="margin-left:4px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>Licença:</span>'
      +'<select id="stale-filter-lic" class="stale-select">'+licOpts+'</select>'
      +'<span class="stale-filter-label" style="margin-left:4px">Setor:</span>'
      +'<select id="stale-filter-setor" class="stale-select">'+setorOpts+'</select>'
      +'<span class="stale-filter-label" style="margin-left:4px">Cargo:</span>'
      +'<select id="stale-filter-cargo" class="stale-select">'+cargoOpts+'</select>'
      +'<span class="stale-filter-label" style="margin-left:4px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>Ordenar:</span>'
      +'<select id="stale-filter-sort" class="stale-select">'
      +'<option value="custo-desc">Mais cara primeiro</option>'
      +'<option value="custo-asc">Mais barata primeiro</option>'
      +'<option value="dias-desc">Mais tempo inativo</option>'
      +'<option value="dias-asc">Menos tempo inativo</option>'
      +'<option value="acesso-asc">Último acesso mais antigo</option>'
      +'<option value="acesso-desc">Último acesso mais recente</option>'
      +'</select>';
    document.getElementById('stale-filter-range').addEventListener('change', applyFilter);
    document.getElementById('stale-filter-lic').addEventListener('change', applyFilter);
    document.getElementById('stale-filter-setor').addEventListener('change', applyFilter);
    document.getElementById('stale-filter-cargo').addEventListener('change', applyFilter);
    document.getElementById('stale-filter-sort').addEventListener('change', applyFilter);
  }

  tblInstance = ReportTable.build('alerta-tbl-staleAccounts', _localSectionCols.staleAccounts, getFiltered(), {
    perPage: 10,
    perPageOptions: [10, 20, 30],
    exportName: 'seguranca-staleAccounts',
    searchable: true,
    exportable: true,
    onRowClick: function(row){
      if(_staleFilterClicked){ _staleFilterClicked = false; return; }
      if(!row.email) return;
      if(typeof db !== 'undefined'){
        var found = db.find(function(x){ return x.email && x.email.toLowerCase() === row.email.toLowerCase(); });
        if(found && typeof openDetail === 'function'){ openDetail(found.id); return; }
      }
      if(typeof toast === 'function') toast('Colaborador não encontrado na base local.');
    }
  });
}

function _initBlockedFilter(items){
  var filterEl = document.getElementById('alerta-filter-blocked');
  var currentSort = 'custo-desc';
  var tblInstance = null;

  function licPrice(r){
    if(r.custo != null) return r.custo;
    return typeof getLic === 'function' ? (getLic(r.licId||'none').price||0) : 0;
  }

  function getFiltered(){
    var filtered = items.slice();
    if(currentSort === 'custo-desc') filtered.sort(function(a,b){ return licPrice(b)-licPrice(a); });
    else if(currentSort === 'custo-asc') filtered.sort(function(a,b){ return licPrice(a)-licPrice(b); });
    else if(currentSort === 'nome-asc') filtered.sort(function(a,b){ return String(a.displayName||'').localeCompare(String(b.displayName||''), 'pt-BR'); });
    return filtered;
  }

  function applyFilter(){
    var sEl = document.getElementById('blocked-filter-sort');
    if(sEl) currentSort = sEl.value;
    if(tblInstance) tblInstance.refresh(getFiltered(), true);
  }

  if(filterEl){
    filterEl.innerHTML =
      '<span class="stale-filter-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>Ordenar:</span>'
      +'<select id="blocked-filter-sort" class="stale-select">'
      +'<option value="custo-desc">Mais cara primeiro</option>'
      +'<option value="custo-asc">Mais barata primeiro</option>'
      +'<option value="nome-asc">Nome A-Z</option>'
      +'</select>';
    document.getElementById('blocked-filter-sort').addEventListener('change', applyFilter);
  }

  tblInstance = ReportTable.build('alerta-tbl-blockedWithLicense', _localSectionCols.blockedWithLicense, getFiltered(), {
    perPage: 10,
    perPageOptions: [10, 20, 30],
    exportName: 'seguranca-blockedWithLicense',
    searchable: true,
    exportable: true,
    onRowClick: function(row){
      if(!row.email) return;
      if(typeof db !== 'undefined'){
        var found = db.find(function(x){ return x.email && x.email.toLowerCase() === row.email.toLowerCase(); });
        if(found && typeof openDetail === 'function'){ openDetail(found.id); return; }
      }
      if(typeof toast === 'function') toast('Colaborador não encontrado na base local.');
    }
  });
}

function _renderAlertasResumo(el){
  var msAlerts = _alertasMsData || [];
  var local = _alertasLocalData || {};

  var totalIssues = 0;
  ['noMfa','staleAccounts','adminsNoMfa','failedSignIns','blockedWithLicense'].forEach(function(k){
    totalIssues += (local[k]||[]).length;
  });

  var highCount = msAlerts.filter(function(a){ return a.severity === 'high'; }).length + (local.noMfa||[]).length + (local.adminsNoMfa||[]).length;
  var medCount = msAlerts.filter(function(a){ return a.severity === 'medium'; }).length + (local.staleAccounts||[]).length + (local.failedSignIns||[]).length;
  var lowCount = msAlerts.filter(function(a){ return a.severity === 'low' || a.severity === 'informational'; }).length + (local.blockedWithLicense||[]).length;

  var total = highCount + medCount + lowCount;
  var score = total === 0 ? 100 : Math.max(0, Math.round(100 - (highCount * 10 + medCount * 3 + lowCount * 1)));

  var scoreColor = score >= 80 ? 'var(--green)' : score >= 50 ? 'var(--yellow)' : 'var(--red)';

  var html = '<div class="resumo-grid">';

  html += '<div style="text-align:center;padding:30px">';
  html += '<div style="position:relative;width:160px;height:160px;margin:0 auto">';
  html += '<svg viewBox="0 0 160 160" style="width:160px;height:160px;transform:rotate(-90deg)">';
  html += '<circle cx="80" cy="80" r="70" fill="none" stroke="var(--sand-lt)" stroke-width="12"/>';
  html += '<circle cx="80" cy="80" r="70" fill="none" stroke="'+scoreColor+'" stroke-width="12" stroke-dasharray="'+Math.round(440*score/100)+' 440" stroke-linecap="round"/>';
  html += '</svg>';
  html += '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center">';
  html += '<div style="font-size:36px;font-weight:800;font-family:Outfit;color:'+scoreColor+'">'+score+'</div>';
  html += '<div style="font-size:11px;color:var(--muted)">de 100</div></div></div>';
  html += '<div style="font-weight:700;font-size:15px;margin-top:16px">Score de Segurança</div>';
  html += '<div style="font-size:12px;color:var(--muted)">Baseado em alertas + análise local</div>';
  html += '</div>';

  html += '<div>';
  html += ReportTable.kpiCards([
    {label:'Alertas Microsoft', value: msAlerts.length},
    {label:'Problemas Locais', value: totalIssues},
    {label:'Risco Alto', value: highCount, sub: highCount > 0 ? '<span style="color:var(--red)">Atenção</span>' : ''},
    {label:'Risco Médio', value: medCount}
  ]);

  var distTotal = Math.max(1, highCount + medCount + lowCount);
  html += '<div style="margin-top:20px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px 20px">';
  html += '<div style="font-weight:700;font-size:13px;margin-bottom:12px">Distribuição por Severidade</div>';
  html += '<div style="display:flex;height:24px;border-radius:6px;overflow:hidden;background:var(--sand-lt)">';
  if(highCount > 0) html += '<div style="width:'+Math.round(highCount/distTotal*100)+'%;background:var(--red)" title="Alta: '+highCount+'"></div>';
  if(medCount > 0) html += '<div style="width:'+Math.round(medCount/distTotal*100)+'%;background:var(--yellow)" title="Média: '+medCount+'"></div>';
  if(lowCount > 0) html += '<div style="width:'+Math.round(lowCount/distTotal*100)+'%;background:var(--muted)" title="Baixa: '+lowCount+'"></div>';
  html += '</div>';
  html += '<div style="display:flex;justify-content:space-between;margin-top:8px;font-size:11px;color:var(--muted)">';
  html += '<span><span style="color:var(--red)">&#9679;</span> Alta: '+highCount+'</span>';
  html += '<span><span style="color:var(--yellow)">&#9679;</span> Média: '+medCount+'</span>';
  html += '<span><span style="color:var(--muted)">&#9679;</span> Baixa: '+lowCount+'</span>';
  html += '</div></div>';
  html += '</div>';

  html += '</div>';
  el.innerHTML = html;
}
