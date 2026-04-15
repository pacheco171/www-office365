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
  if(view==='aplicativos'&&tab==='registrations')_loadAppsRegistrations();
  if(view==='aplicativos'&&tab==='principals')_loadAppsServicePrincipals();
  if(view==='alertas'&&tab==='microsoft')_loadAlertasMicrosoft();
  if(view==='alertas'&&tab==='local')_loadAlertasLocal();
  if(view==='alertas'&&tab==='resumo')_renderAlertasResumo(document.getElementById('alertasResumoContent'));
  if(view==='suporte'&&tab==='chat')_renderSuporteChat();
  if(view==='suporte'&&tab==='novo')_renderSuporteForm();
  if(view==='suporte'&&tab==='chamados')_loadSuporteTickets();
}

function toggleNavSidebar(btn) {
  var aside = document.querySelector('aside');
  if (!aside) return;
  var isCollapsed = aside.classList.toggle('sidebar-collapsed');
  var overlay = document.getElementById('sidebarOverlay');
  if (overlay) overlay.style.display = isCollapsed ? 'none' : 'block';
  if (btn) btn.setAttribute('aria-expanded', String(!isCollapsed));
}

function toggleNavGroup(label){
  var section = label.dataset.section;
  var group = label.nextElementSibling;
  if(!group || !group.classList.contains('nav-group')) return;
  var isCollapsed = group.classList.toggle('collapsed');
  label.classList.toggle('collapsed', isCollapsed);
  var saved = JSON.parse(localStorage.getItem('nav_collapsed') || '{}');
  saved[section] = isCollapsed;
  localStorage.setItem('nav_collapsed', JSON.stringify(saved));
}

document.addEventListener('DOMContentLoaded',function(){
  if(window.innerWidth<=1024){
    var a=document.querySelector('aside');
    if(a)a.classList.add('sidebar-collapsed');
  }
});

(function initNavGroups(){
  var saved = JSON.parse(localStorage.getItem('nav_collapsed') || '{}');
  var hasAnySaved = Object.keys(saved).length > 0;
  document.querySelectorAll('.nav-label.collapsible').forEach(function(label){
    var section = label.dataset.section;
    var group = label.nextElementSibling;
    if(!group || !group.classList.contains('nav-group')) return;
    var hasActive = group.querySelector('.nav-item.active');
    var shouldCollapse;
    if(hasActive){
      shouldCollapse = false;
    } else if(hasAnySaved && saved[section] !== undefined){
      shouldCollapse = saved[section];
    } else {
      shouldCollapse = !hasAnySaved;
    }
    if(shouldCollapse){
      group.classList.add('collapsed');
      label.classList.add('collapsed');
    }
  });
}());
