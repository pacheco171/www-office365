/* ══════════ NAVIGATION — Navegação entre views (multi-page) ══════════ */

/** Retorna o nome da página atual (atributo data-page do body) */
function getActivePage(){
  return document.body.dataset.page||'dashboard';
}

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
