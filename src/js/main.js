/* ══════════ INICIALIZAÇÃO E REFRESH ══════════ */

/** Copia URL do admin center para clipboard e mostra toast */
function copyPS(){navigator.clipboard.writeText('https://admin.microsoft.com').then(()=>toast('URL copiada!'));}

/** Exibe mensagem toast temporária (padrão 3.5s) */
function toast(msg,dur){
  dur=dur||3500;
  var t=document.getElementById('toast');
  t.innerHTML=msg;t.classList.add('show');
  setTimeout(function(){t.classList.remove('show');},dur);
}

/** Re-renderiza todas as views ativas (tabela, charts, métricas).
    Chamado após qualquer alteração de dados. */
function refresh(){
  updateMetrics();renderTable();
  if(document.getElementById('view-licencas').classList.contains('active')){renderLicView();renderLicHist();}
  if(document.getElementById('view-setores').classList.contains('active')){renderSetores();renderSetorHist();}
  if(document.getElementById('view-dashboard').classList.contains('active')){drawCharts();renderCompare();}
  if(document.getElementById('view-historico').classList.contains('active'))renderHistView();
}

/** Boot da aplicação — carrega dados do servidor e renderiza UI inicial */
(function(){
  var s=authGetSession();
  if(s)document.getElementById('sbUserName').textContent=s.name||s.username;

  // Progress bar no carregamento inicial
  if(typeof uiProgress!=='undefined')uiProgress.start();

  // Skeleton na tabela de colaboradores enquanto carrega
  if(typeof uiSkeleton!=='undefined')uiSkeleton.table('tableBody',8,6);

  // Carrega dados + overrides + hierarquia em paralelo
  Promise.all([
    fetch('/api/data').then(function(r){return r.json();}),
    typeof loadOverrides==='function'?loadOverrides():Promise.resolve(),
    typeof loadHierarchy==='function'?loadHierarchy():Promise.resolve(),
    typeof loadAzureSubs==='function'?loadAzureSubs():Promise.resolve(),
    typeof loadUserRole==='function'?loadUserRole():Promise.resolve(),
    typeof loadLicenses==='function'?loadLicenses():Promise.resolve()
  ]).then(function(results){
    var data=results[0];
    if(Array.isArray(data.db))db=data.db;
    if(Array.isArray(data.snapshots))snapshots=data.snapshots;
    if(Array.isArray(data.contracts))contracts=data.contracts;
    if(Array.isArray(data.acoes))acoes=data.acoes;
    if(data.usage&&typeof data.usage==='object')usageData=data.usage;
    if(Array.isArray(data.fatura)&&data.fatura.length)faturaData=data.fatura;
    // Re-normalizar setores dos dados carregados (corrige variantes salvas)
    if(typeof normalizeSetor==='function'){
      db.forEach(function(r){
        if(r.setor) r.setor=normalizeSetor(r.setor);
      });
      snapshots.forEach(function(snap){
        (snap.data||[]).forEach(function(r){
          if(r.setor) r.setor=normalizeSetor(r.setor);
        });
      });
    }
    if(typeof autoOverrideLojas==='function')autoOverrideLojas(db);
    if(typeof applyOverridesLocal==='function')applyOverridesLocal(db);
    updateMetrics();renderTable();drawCharts();
    if(typeof uiProgress!=='undefined')uiProgress.done();
  }).catch(function(){
    updateMetrics();renderTable();drawCharts();
    if(typeof uiProgress!=='undefined')uiProgress.done();
  });
  loadChangelog();
}());
