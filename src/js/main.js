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

/** Renderiza a view da página atual após carregamento de dados */
function renderCurrentPage(){
  var page=getActivePage();
  if(page==='dashboard'){updateMetrics();drawCharts();renderCompare();}
  if(page==='colaboradores'){renderTable();}
  if(page==='licencas'){renderLicView();renderLicHist();}
  if(page==='setores'){renderSetores();renderSetorHist();}
  if(page==='historico')renderHistView();
  if(page==='radar'){renderRadar();if(typeof syncRadarAcoes==='function')syncRadarAcoes();}
  if(page==='contratos')renderContracts();
  if(page==='relatorio')renderReport();
  if(page==='auditoria')renderAuditoria();
  if(page==='sugestoes'&&typeof loadAnnotations==='function')loadAnnotations();
}

/** Re-renderiza a view atual (chamado após alteração de dados) */
function refresh(){
  updateMetrics();
  var page=getActivePage();
  if(page==='colaboradores')renderTable();
  if(page==='licencas'){renderLicView();renderLicHist();}
  if(page==='setores'){renderSetores();renderSetorHist();}
  if(page==='dashboard'){drawCharts();renderCompare();}
  if(page==='historico')renderHistView();
}

/** Boot da aplicação — carrega dados do servidor e renderiza UI inicial */
(function(){
  var s=authGetSession();
  if(s)document.getElementById('sbUserName').textContent=s.name||s.username;

  // Progress bar no carregamento inicial
  if(typeof uiProgress!=='undefined')uiProgress.start();

  // Skeleton na tabela de colaboradores enquanto carrega
  if(getActivePage()==='colaboradores'&&typeof uiSkeleton!=='undefined')uiSkeleton.table('tableBody',8,6);

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
    // Backfill cargoOrigem para registros antigos
    db.forEach(function(r){
      if(!r.cargoOrigem) r.cargoOrigem=(r.cargo||'')==='Colaborador'?'fallback':'ad';
    });
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
    updateMetrics();renderCurrentPage();
    if(typeof uiProgress!=='undefined')uiProgress.done();
  }).catch(function(){
    updateMetrics();renderCurrentPage();
    if(typeof uiProgress!=='undefined')uiProgress.done();
  });
  loadChangelog();
}());
