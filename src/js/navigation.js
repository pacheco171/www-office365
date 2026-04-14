/* ══════════ NAVIGATION — Navegação entre views (SPA client-side) ══════════ */

/* Cache de HTML das views já visitadas (memória da sessão) */
var _pageCache = {};

/* Intercepta cliques nos links da sidebar para navegação SPA */
document.addEventListener('click', function(e) {
  var link = e.target.closest('a.nav-item[href]');
  if (!link) return;
  var url = link.getAttribute('href');
  if (!url || url.indexOf('://') >= 0 || url.charAt(0) === '#') return;
  e.preventDefault();
  _spaNavigate(url);
});

/* Suporte ao botão Voltar/Avançar do browser */
window.addEventListener('popstate', function() {
  _spaNavigate(window.location.pathname, true);
});

function _spaNavigate(url, fromPop) {
  var page = url.replace(/^\//, '') || 'dashboard';
  if (document.body.dataset.page === page) return;

  if (_pageCache[url]) {
    _spaSwap(_pageCache[url].content, url, page, _pageCache[url].title, fromPop);
    return;
  }

  fetch(url, { headers: { 'X-SPA': '1' } })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var parser = new DOMParser();
      var doc = parser.parseFromString(html, 'text/html');
      var main = doc.querySelector('main');
      var title = doc.querySelector('title');
      _pageCache[url] = {
        content: main ? main.innerHTML : '',
        title: title ? title.textContent : ''
      };
      _spaSwap(_pageCache[url].content, url, page, _pageCache[url].title, fromPop);
    })
    .catch(function() {
      window.location.href = url;
    });
}

function _spaSwap(content, url, page, title, fromPop) {
  /* Troca o conteúdo do main */
  var main = document.querySelector('main');
  if (main) main.innerHTML = content;

  /* Atualiza page name no body */
  document.body.dataset.page = page;

  /* Atualiza título da aba */
  if (title) document.title = title;

  /* Atualiza classe active na sidebar */
  document.querySelectorAll('a.nav-item').forEach(function(item) {
    var href = item.getAttribute('href');
    var isRoot = (url === '/' || url === '') && (href === '/' || href === '');
    item.classList.toggle('active', href === url || isRoot);
  });

  /* Expande o nav-group que contém o item ativo (se estiver colapsado) */
  var activeItem = document.querySelector('a.nav-item.active');
  if (activeItem) {
    var group = activeItem.closest('.nav-group');
    if (group && group.classList.contains('collapsed')) {
      group.classList.remove('collapsed');
      var label = group.previousElementSibling;
      if (label) label.classList.remove('collapsed');
    }
  }

  /* Atualiza URL sem reload */
  if (!fromPop) history.pushState({ page: page }, '', url);

  /* Re-aplica traduções e renderiza a view com dados já em memória */
  if (typeof applyTranslations === 'function') applyTranslations();
  if (typeof _rendered !== 'undefined') _rendered[page] = false;
  renderCurrentPage();
}



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
