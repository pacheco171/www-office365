/* ══════════ NAVIGATION — Navegação entre views ══════════ */

/** Navega entre views da aplicação e renderiza conteúdo da view selecionada */
function switchView(name){
  // Progress bar
  if(typeof uiProgress!=='undefined')uiProgress.start();

  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));

  var viewEl=document.getElementById('view-'+name);
  viewEl.classList.add('active');
  document.querySelector(`[data-view="${name}"]`).classList.add('active');

  // Re-trigger view entrance animation
  if(typeof uiTransition!=='undefined')uiTransition.viewSwitch(viewEl);

  if(name!=='dashboard')dashSnapIdx=null;
  if(name==='dashboard'){updateMetrics();drawCharts();renderCompare();}
  if(name==='licencas'){renderLicView();renderLicHist();}
  if(name==='setores'){renderSetores();renderSetorHist();}
  if(name==='historico')renderHistView();
  if(name==='radar'){renderRadar();if(typeof syncRadarAcoes==='function')syncRadarAcoes();}
  if(name==='contratos')renderContracts();
  if(name==='relatorio')renderReport();
  if(name==='auditoria')renderAuditoria();
  if(name==='sugestoes'&&typeof loadAnnotations==='function')loadAnnotations();
  closeDetail();

  // Finish progress
  if(typeof uiProgress!=='undefined')setTimeout(function(){uiProgress.done();},120);
}
document.querySelectorAll('.nav-item').forEach(n=>n.addEventListener('click',()=>switchView(n.dataset.view)));

/** Alterna entre abas dentro de uma view */
function switchTab(view,tab,btn){
  const prefix=view+'-';
  document.querySelectorAll(`#view-${view} .tab-panel`).forEach(p=>p.classList.remove('active'));
  document.querySelectorAll(`#view-${view} .tab-btn`).forEach(b=>b.classList.remove('active'));
  var tabEl=document.getElementById(prefix+tab);
  tabEl.classList.add('active');
  btn.classList.add('active');
  if(view==='licencas'&&tab==='otimizar'&&typeof renderOptimization==='function')renderOptimization();
  if(view==='licencas'&&tab==='hist')renderLicHist();
  if(view==='setores'&&tab==='hist')renderSetorHist();
  if(view==='setores'&&tab==='atual')renderSetores();
  if(view==='radar'&&tab==='alertas')renderRadar();
  if(view==='radar'&&tab==='acoes')renderAcoes();
  if(view==='radar'&&tab==='simulador'&&typeof renderSimulador==='function')renderSimulador();
}
