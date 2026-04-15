/* ══════════ BUSCA GLOBAL (Ctrl+K) ══════════ */

document.addEventListener('keydown', function(e) {
  if((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    openGlobalSearch();
  }
  if(e.key === 'Escape') closeGlobalSearch();
});

function openGlobalSearch() {
  var overlay = document.getElementById('globalSearchOverlay');
  if(!overlay) return;
  overlay.style.display = 'flex';
  var input = document.getElementById('globalSearchInput');
  if(input) { input.value = ''; input.focus(); }
  document.getElementById('globalSearchResults').innerHTML = '';
}

function closeGlobalSearch() {
  var overlay = document.getElementById('globalSearchOverlay');
  if(overlay) overlay.style.display = 'none';
}

var _globalSearchDebounce = null;
function globalSearchQuery(val) {
  var container = document.getElementById('globalSearchResults');
  if(!container) return;
  var q = (val || '').trim().toLowerCase();
  if(!q) { clearTimeout(_globalSearchDebounce); container.innerHTML = ''; return; }
  clearTimeout(_globalSearchDebounce);
  _globalSearchDebounce = setTimeout(function() { _doGlobalSearch(q, val, container); }, 200);
}
function _doGlobalSearch(q, val, container) {
  if(!db || !db.length) {
    container.innerHTML = '<div class="gs-empty">' + (typeof t === 'function' ? t('search.carregando') : 'Dados ainda carregando...') + '</div>';
    return;
  }
  var results = db.filter(function(r) {
    var lic = (typeof getLic === 'function') ? getLic(r.licId) : {name:''};
    return (r.nome||'').toLowerCase().indexOf(q) >= 0
      || (r.email||'').toLowerCase().indexOf(q) >= 0
      || (r.setor||'').toLowerCase().indexOf(q) >= 0
      || (lic.name||'').toLowerCase().indexOf(q) >= 0;
  }).slice(0, 12);
  if(!results.length) {
    container.innerHTML = '<div class="gs-empty">' + (typeof t === 'function' ? t('search.nenhum', {q: val}) : 'Nenhum resultado para "'+val+'"') + '</div>';
    return;
  }
  container.innerHTML = results.map(function(r) {
    var lic = (typeof getLic === 'function') ? getLic(r.licId) : {short:''};
    var initials = (typeof ini === 'function') ? ini(r.nome) : (r.nome||'?').slice(0,2).toUpperCase();
    return '<div class="gs-item" onclick="closeGlobalSearch();if(typeof openDetail===\'function\')openDetail('+r.id+')">'
      +'<div class="gs-item-avatar">'+initials+'</div>'
      +'<div class="gs-item-info">'
      +'<div class="gs-item-name">'+(r.nome||'—')+'</div>'
      +'<div class="gs-item-sub">'+(r.setor||'')+(lic.short?' · '+lic.short:'')+'</div>'
      +'</div>'
      +'</div>';
  }).join('');
}

/* ══════════ INICIALIZAÇÃO E REFRESH ══════════ */

document.addEventListener('i18n:change', function() {
  Object.keys(_rendered).forEach(function(k){_rendered[k]=false;});
  updateMetrics();
  renderCurrentPage();
});

/** Copia URL do admin center para clipboard e mostra toast */
function copyPS(){navigator.clipboard.writeText('https://admin.microsoft.com').then(()=>toast(typeof t==='function'?t('common.url_copiada'):'URL copiada!'));}

/** Exibe mensagem toast temporária (padrão 3.5s) */
function toast(msg,dur){
  dur=dur||3500;
  var t=document.getElementById('toast');
  t.innerHTML=msg;t.classList.add('show');
  setTimeout(function(){t.classList.remove('show');},dur);
}

/* Controla quais views já foram renderizadas (evita re-render desnecessário) */
var _rendered = {};

/* ── Lazy loading de views de relatório ── */
var _loadedViews = {};
var _LAZY_VIEWS = {
  'exchange':    '/src/js/views/exchange.js',
  'onedrive':    '/src/js/views/onedrive.js',
  'dominios':    '/src/js/views/dominios.js',
  'grupos':      '/src/js/views/grupos.js',
  'aplicativos': '/src/js/views/aplicativos.js',
  'privilegios': '/src/js/views/privilegios.js',
  'politicas':   '/src/js/views/politicas.js',
  'alertas':     '/src/js/views/alertas.js',
  'assessment':  '/src/js/views/assessment.js',
  'suporte':     '/src/js/views/suporte.js',
  'auditoria':   '/src/js/views/auditoria.js',
  'relatorio':   '/src/js/views/report.js',
  'config':      '/src/js/views/config.js'
};

/** Injeta script de view sob demanda e executa callback quando pronto */
function _lazyView(page, cb) {
  if (_loadedViews[page]) { cb(); return; }
  var s = document.createElement('script');
  s.src = (_LAZY_VIEWS[page] || '') + '?v=' + (window._sv || '');
  s.onload = function() { _loadedViews[page] = true; cb(); };
  s.onerror = function() { console.warn('[lazy] falha ao carregar view:', page); };
  document.head.appendChild(s);
}

/** Renderiza a view da página atual após carregamento de dados */
function renderCurrentPage(){
  var page=getActivePage();
  if(_rendered[page])return;
  _rendered[page]=true;
  if(page==='dashboard'){updateMetrics();drawCharts();renderCompare();}
  if(page==='colaboradores'){renderTable();}
  if(page==='licencas'){renderLicView();renderLicHist();}
  if(page==='setores'){renderSetores();renderSetorHist();}
  if(page==='historico')renderHistView();
  if(page==='radar'){renderRadar();if(typeof syncRadarAcoes==='function')syncRadarAcoes();}
  if(page==='contratos')renderContracts();
  if(page==='sugestoes'&&typeof loadAnnotations==='function')loadAnnotations();
  /* views lazy: carregam o script na primeira visita */
  if(_LAZY_VIEWS[page]){
    _rendered[page]=false; /* permite re-chamar após load */
    _lazyView(page, function(){
      _rendered[page]=true;
      if(page==='relatorio')renderReport();
      if(page==='auditoria')renderAuditoria();
      if(page==='exchange')renderExchangeView();
      if(page==='onedrive')renderOnedriveView();
      if(page==='dominios')renderDominiosView();
      if(page==='grupos')renderGruposView();
      if(page==='aplicativos')renderAplicativosView();
      if(page==='privilegios')renderPrivilegiosView();
      if(page==='politicas')renderPoliticasView();
      if(page==='alertas')renderAlertasView();
      if(page==='assessment')renderAssessmentView();
      if(page==='suporte')renderSuporteView();
      if(page==='config'){
        if(typeof loadGraphConfig==='function')loadGraphConfig();
        if(typeof loadAiConfig==='function')loadAiConfig();
      }
    });
  }
}

/** Re-renderiza a view atual (chamado após alteração de dados) */
function refresh(){
  invalidateBootCache();
  Object.keys(_rendered).forEach(function(k){_rendered[k]=false;});
  updateMetrics();
  var page=getActivePage();
  if(page==='colaboradores')renderTable();
  if(page==='licencas'){renderLicView();renderLicHist();}
  if(page==='setores'){renderSetores();renderSetorHist();}
  if(page==='dashboard'){drawCharts();renderCompare();}
  if(page==='historico')renderHistView();
}

function applyBoot(boot){
  var data=boot.data||{};
  if(Array.isArray(data.db))db=data.db;
  if(Array.isArray(data.snapshots))snapshots=data.snapshots;
  if(Array.isArray(data.contracts))contracts=data.contracts;
  if(Array.isArray(data.acoes))acoes=data.acoes;
  if(data.usage&&typeof data.usage==='object')usageData=data.usage;
  if(Array.isArray(data.fatura)&&data.fatura.length)faturaData=data.fatura;
  if(boot.overrides)overrides=(boot.overrides.overrides)||{};
  if(boot.hierarchy){HIERARCHY=(boot.hierarchy.hierarchy)||{};if(typeof rebuildAreaMap==='function')rebuildAreaMap();}
  if(Array.isArray(boot.subscriptions))azureSubs=boot.subscriptions;
  if(boot.me){userRole=boot.me.role||'viewer';globalAdmin=boot.me.global_admin||false;if(typeof applyRoleRestrictions==='function')applyRoleRestrictions();if(userRole==='superadmin'&&typeof loadAnnotations==='function')loadAnnotations();}
  if(Array.isArray(boot.licenses)&&boot.licenses.length){LICENSES=boot.licenses;licById=Object.fromEntries(LICENSES.map(function(l){return[l.id,l];}));}
  if(boot.tenants&&typeof initTenantSwitcher==='function')initTenantSwitcher(boot.tenants);
  db.forEach(function(r){
    if(!r.cargoOrigem) r.cargoOrigem=(r.cargo||'')==='Colaborador'?'fallback':'ad';
  });
  if(typeof normalizeSetor==='function'){
    db.forEach(function(r){ if(r.setor) r.setor=normalizeSetor(r.setor); });
    snapshots.forEach(function(snap){
      (snap.data||[]).forEach(function(r){ if(r.setor) r.setor=normalizeSetor(r.setor); });
    });
  }
  if(typeof autoOverrideLojas==='function')autoOverrideLojas(db);
  if(typeof applyOverridesLocal==='function')applyOverridesLocal(db);
}

function bootProgress(percent,msg){
  var bar=document.getElementById('progress');
  var status=document.getElementById('statusText');
  if(bar)bar.style.width=percent+'%';
  if(status&&msg){
    status.classList.add('fade');
    setTimeout(function(){
      status.textContent=msg;
      status.classList.remove('fade');
    },300);
  }
}

function dismissBootLoader(){
  sessionStorage.removeItem('boot_pending');
  var bl=document.getElementById('loader');
  if(!bl)return;
  bl.classList.add('fade-out');
  setTimeout(function(){bl.remove();},500);
}

/* ── Cache do /api/boot em sessionStorage (TTL: 5 min) ── */
var _BOOT_TTL = 5 * 60 * 1000;
function _bootCacheKey() {
  var s = typeof authGetSession === 'function' ? (authGetSession() || {}) : {};
  return 'boot_v2_' + (s.tenant || s.username || 'default');
}
function fetchBoot() {
  /* boot_pending = pós-login ou troca de tenant: sempre buscar dados frescos
     para garantir que a animação do loader rode por tempo suficiente */
  if (!sessionStorage.getItem('boot_pending')) {
    var key = _bootCacheKey();
    var raw = sessionStorage.getItem(key);
    if (raw) {
      try {
        var entry = JSON.parse(raw);
        if (Date.now() - entry.ts < _BOOT_TTL) return Promise.resolve(entry.data);
      } catch(e) { /* cache corrompido, ignora */ }
    }
  }
  return fetch('/api/boot', {cache:'no-store'})
    .then(function(r){ return r.json(); })
    .then(function(boot){
      var key = _bootCacheKey();
      try { sessionStorage.setItem(key, JSON.stringify({ts: Date.now(), data: boot})); } catch(e){}
      return boot;
    });
}

function invalidateBootCache(){
  sessionStorage.removeItem('boot_cache');
  try { sessionStorage.removeItem(_bootCacheKey()); } catch(e){}
}

(function(){
  var s=authGetSession();
  if(s)document.getElementById('sbUserName').textContent=s.name||s.username;

  if(typeof uiProgress!=='undefined')uiProgress.start();
  if(getActivePage()==='colaboradores'&&typeof uiSkeleton!=='undefined')uiSkeleton.table('tableBody',8,6);

  var _bootDone = false;
  var _bootSteps = [
    { p: 20,  msg: 'Conectando ao tenant...' },
    { p: 40,  msg: 'Validando credenciais...' },
    { p: 60,  msg: 'Sincronizando usu\u00e1rios...' },
    { p: 80,  msg: 'Carregando licen\u00e7as...' },
  ];
  var _bootIdx = 0;
  bootProgress(_bootSteps[0].p, _bootSteps[0].msg);
  _bootIdx = 1;
  var _bootTimer = setInterval(function(){
    if(_bootDone || _bootIdx >= _bootSteps.length){ clearInterval(_bootTimer); return; }
    bootProgress(_bootSteps[_bootIdx].p, _bootSteps[_bootIdx].msg);
    _bootIdx++;
  }, 1200);

  fetchBoot().then(function(boot){
    _bootDone = true;
    clearInterval(_bootTimer);
    bootProgress(100,'Finalizando ambiente...');
    applyBoot(boot);
    updateMetrics();renderCurrentPage();
    if(typeof uiProgress!=='undefined')uiProgress.done();
  }).catch(function(e){
    _bootDone = true;
    clearInterval(_bootTimer);
    console.warn('[app] boot error');
    try{updateMetrics();}catch(e2){console.warn('[app] metrics error');}
    try{renderCurrentPage();}catch(e2){console.warn('[app] render error');}
    if(typeof uiProgress!=='undefined')uiProgress.done();
  }).finally(function(){
    dismissBootLoader();
  });
  if(typeof loadChangelog==='function')loadChangelog();
}());

function initTenantSwitcher(data) {
  var sw = document.getElementById('tenantSwitcher');
  var nameEl = document.getElementById('tenantDisplayName');
  var dd = document.getElementById('tenantDropdown');
  var chevron = document.getElementById('tenantChevron');
  if (!sw || !nameEl || !dd) return;
  var tenants = data.tenants || [];
  var current = data.current || '';
  var currentName = data.current_name || current;
  if (!currentName) return;
  nameEl.textContent = currentName;
  sw.style.display = 'flex';
  var isGA = typeof globalAdmin !== 'undefined' && globalAdmin;
  if (tenants.length > 1 || isGA) {
    if (chevron) chevron.style.display = '';
    var items = tenants.map(function(t) {
      return '<div class="tenant-item' + (t.slug === current ? ' active' : '') + '" onclick="switchTenant(\'' + t.slug + '\')">' + t.name + '</div>';
    }).join('');
    if (isGA) {
      items += '<div class="tenant-item tenant-add" onclick="event.stopPropagation();openAddTenantModal()">+ Novo tenant</div>';
    }
    dd.innerHTML = items;
  }
}

var _ntStep = 1;

function openAddTenantModal() {
  var dd = document.getElementById('tenantDropdown');
  if (dd) dd.classList.add('hidden');
  _ntStep = 1;
  document.getElementById('ntName').value = '';
  document.getElementById('ntSlug').value = '';
  document.getElementById('ntAzureTenantId').value = '';
  document.getElementById('ntClientId').value = '';
  document.getElementById('ntClientSecret').value = '';
  document.getElementById('ntDomain').value = '';
  document.getElementById('ntError').textContent = '';
  document.getElementById('ntStep1').style.display = '';
  document.getElementById('ntStep2').style.display = 'none';
  document.getElementById('ntStepLabel').textContent = 'Passo 1 de 2 — Identificação';
  document.getElementById('ntNextBtn').textContent = 'Próximo →';
  document.getElementById('ntNextBtn').disabled = false;
  document.getElementById('newTenantOverlay').classList.add('open');
}

function closeAddTenantModal() {
  document.getElementById('newTenantOverlay').classList.remove('open');
}

function ntNext() {
  var errEl = document.getElementById('ntError');
  errEl.textContent = '';
  if (_ntStep === 1) {
    var name = (document.getElementById('ntName').value || '').trim();
    var slug = (document.getElementById('ntSlug').value || '').trim();
    if (!name || !slug) { errEl.textContent = 'Nome e identificador são obrigatórios.'; return; }
    if (!/^[a-z0-9-]+$/.test(slug)) { errEl.textContent = 'Identificador: apenas letras minúsculas, números e hífens.'; return; }
    _ntStep = 2;
    document.getElementById('ntStep1').style.display = 'none';
    document.getElementById('ntStep2').style.display = '';
    document.getElementById('ntStepLabel').textContent = 'Passo 2 de 2 — API Microsoft Graph (opcional)';
    document.getElementById('ntNextBtn').textContent = 'Criar Tenant';
  } else {
    var name = (document.getElementById('ntName').value || '').trim();
    var slug = (document.getElementById('ntSlug').value || '').trim();
    var config = {
      tenant_id: (document.getElementById('ntAzureTenantId').value || '').trim(),
      client_id: (document.getElementById('ntClientId').value || '').trim(),
      client_secret: (document.getElementById('ntClientSecret').value || '').trim(),
      domain: (document.getElementById('ntDomain').value || '').trim(),
    };
    document.getElementById('ntNextBtn').disabled = true;
    fetch('/api/admin/tenants', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: name, slug: slug, config: config})
    }).then(function(r) { return r.json().then(function(d) { return {ok: r.ok, data: d}; }); })
      .then(function(res) {
        if (res.ok) {
          closeAddTenantModal();
          switchTenant(res.data.slug);
        } else {
          document.getElementById('ntNextBtn').disabled = false;
          errEl.textContent = res.data.error || 'Erro ao criar tenant.';
          _ntStep = 1;
          document.getElementById('ntStep1').style.display = '';
          document.getElementById('ntStep2').style.display = 'none';
          document.getElementById('ntStepLabel').textContent = 'Passo 1 de 2 — Identificação';
          document.getElementById('ntNextBtn').textContent = 'Próximo →';
        }
      })
      .catch(function() {
        document.getElementById('ntNextBtn').disabled = false;
        errEl.textContent = 'Erro de conexão.';
      });
  }
}

function openTenantSelector() {
  var dd = document.getElementById('tenantDropdown');
  if (!dd) return;
  dd.classList.toggle('hidden');
}

function switchTenant(slug) {
  invalidateBootCache();
  sessionStorage.setItem('boot_pending','1');
  fetch('/api/tenant/switch', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({tenant: slug})
  }).then(function(r) {
    if (r.ok) location.reload();
  });
}

document.addEventListener('click', function(e) {
  var sw = document.getElementById('tenantSwitcher');
  var dd = document.getElementById('tenantDropdown');
  if (sw && dd && !sw.contains(e.target)) dd.classList.add('hidden');
});
