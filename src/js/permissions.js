/* ══════════ PERMISSIONS + ANOTAÇÕES VISUAIS ══════════ */

let annotations=[];

/** Carrega role do usuário logado e aplica restrições de UI */
function loadUserRole(){
  return fetch('/api/me')
    .then(function(r){return r.json();})
    .then(function(data){
      userRole=data.role||'viewer';
      globalAdmin=data.global_admin||false;
      applyRoleRestrictions();
      if(userRole==='superadmin')loadAnnotations();
      return userRole;
    })
    .catch(function(){
      userRole='viewer';
      applyRoleRestrictions();
    });
}

/** Aplica restrições visuais baseadas na role */
function applyRoleRestrictions(){
  var isSuperAdmin = userRole==='superadmin' || globalAdmin;

  // Nav item de config — admin, superadmin e global admin vêem
  var configNav=document.querySelector('a.nav-item[href="/config"]');
  if(configNav) configNav.style.display=(isSuperAdmin||userRole==='admin')?'':'none';

  // Nav item de sugestões/anotações — admin e superadmin
  var sugNav=document.getElementById('navSugestoes');
  if(sugNav) sugNav.style.display=(userRole==='admin'||isSuperAdmin)?'':'none';

  // Badge de role na sidebar
  var badge=document.getElementById('sbRoleBadge');
  if(badge){
    var labels={superadmin:'Super Admin',admin:'Admin',viewer:'Visualizador',tecnico:'Técnico'};
    var colors={superadmin:'var(--brown)',admin:'var(--green)',viewer:'var(--muted)',tecnico:'var(--muted)'};
    badge.textContent=labels[userRole]||'Visualizador';
    badge.style.color=colors[userRole]||'var(--muted)';
    badge.style.display='';
  }

  // Restrições do técnico — sem visibilidade de valores financeiros
  if(userRole==='tecnico'){
    // Classe no body — permite seletores CSS de alta especificidade
    document.body.classList.add('role-tecnico');
    // CSS injection: cobre [data-financial] + IDs existentes no HTML original
    // (independe de template cacheado — funciona mesmo sem novos atributos no HTML)
    if(!document.getElementById('_technicoCss')){
      var s=document.createElement('style');
      s.id='_technicoCss';
      s.textContent=[
        /* coluna custo na tabela — células e header */
        'body.role-tecnico .td-custo{display:none!important}',
        'body.role-tecnico #thCusto{display:none!important}',
        /* colaboradores: coluna Criado em — header (7º th) e células */
        'body.role-tecnico #view-colaboradores thead th:nth-child(7),body.role-tecnico .date-cell{display:none!important}',
        /* colaboradores: filtro Certeza do cargo (wrapper inclui o ?) */
        'body.role-tecnico .filter-with-help{display:none!important}',
        /* colaboradores: filtro de período (filtra por data de criação) */
        'body.role-tecnico #fltPeriodo{display:none!important}',
        /* elementos marcados com data-financial */
        'body.role-tecnico [data-financial]{display:none!important}',
        /* botões e painéis de análise financeira por ID */
        'body.role-tecnico #compareToggleBtn,body.role-tecnico #forecastToggleBtn{display:none!important}',
        'body.role-tecnico #comparePanel,body.role-tecnico #forecastPanel{display:none!important}',
        'body.role-tecnico #custoMedioAllPanel,body.role-tecnico #setorAllPanel{display:none!important}',
        /* custo anual estimado no card Por status (classes únicas) */
        'body.role-tecnico .chart-custo-anual{display:none!important}',
        'body.role-tecnico .chart-custo-sub{display:none!important}',
        /* layout: 2 cards e 2 charts proporcionais */
        'body.role-tecnico .metrics{grid-template-columns:repeat(2,1fr)!important}',
        'body.role-tecnico .charts-row{grid-template-columns:repeat(2,1fr)!important}',
        /* contratos: 4 KPIs visíveis (sem os 2 de custo) */
        'body.role-tecnico .contract-kpis{grid-template-columns:repeat(4,1fr)!important}',
        /* contratos: th das colunas de custo — belt-and-suspenders via nth-child */
        'body.role-tecnico #view-contratos thead th:nth-child(6),body.role-tecnico #view-contratos thead th:nth-child(7){display:none!important}',
        /* contratos: fatura — seção inteira por posição (não depende de data-financial) */
        'body.role-tecnico #view-contratos .contracts-main-col .contracts-table-wrap:last-child{display:none!important}',
        /* contratos: fatura — valores específicos belt-and-suspenders */
        'body.role-tecnico #faturaTotal,body.role-tecnico #faturaTotalFooter,body.role-tecnico .fatura-total-label,body.role-tecnico .fatura-val-total,body.role-tecnico .fatura-total-row,body.role-tecnico .fatura-table thead{display:none!important}',
        /* contratos: tabela detalhamento proporcional com 5 colunas */
        'body.role-tecnico #view-contratos .contracts-table-wrap:not([data-financial]) table{table-layout:fixed;width:100%}',
        'body.role-tecnico #view-contratos .contracts-table-wrap:not([data-financial]) thead th:nth-child(1){width:35%}',
        'body.role-tecnico #view-contratos .contracts-table-wrap:not([data-financial]) thead th:nth-child(2),body.role-tecnico #view-contratos .contracts-table-wrap:not([data-financial]) thead th:nth-child(3),body.role-tecnico #view-contratos .contracts-table-wrap:not([data-financial]) thead th:nth-child(4){width:14%}',
        'body.role-tecnico #view-contratos .contracts-table-wrap:not([data-financial]) thead th:nth-child(5){width:23%}',
        /* contratos: células com overflow elegante no layout fixo */
        'body.role-tecnico #view-contratos .contracts-table-wrap:not([data-financial]) td{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        /* radar: ocultar tabs Centro de Ações e Simulador */
        'body.role-tecnico #radarTabAcoes,body.role-tecnico #radarTabSimulador{display:none!important}'
      ].join('');
      document.head.appendChild(s);
    }
    // Tabs do radar — técnico só vê Alertas
    ['radarTabAcoes','radarTabSimulador'].forEach(function(id){
      var el=document.getElementById(id);
      if(el)el.style.display='none';
    });
    // Chart cards de custo — sem ID, esconder via traversal do elemento interno
    ['barChart','custoMedioSetorChart'].forEach(function(id){
      var el=document.getElementById(id);
      if(el){var card=el.closest?el.closest('.chart-card'):null;if(card)card.style.display='none';}
    });
    // Wrapper dos botões de análise financeira (div sem ID/class, pai dos botões)
    var cmpBtn=document.getElementById('compareToggleBtn');
    if(cmpBtn&&cmpBtn.parentNode)cmpBtn.parentNode.style.display='none';
    // "Custo anual estimado" — título e divider (template antigo sem wrapper data-financial)
    var ca=document.getElementById('custoAnual');
    if(ca&&!(ca.closest?ca.closest('[data-financial]'):null)){
      ca.style.display='none';
      var prev=ca.previousElementSibling;
      if(prev)prev.style.display='none'; // .chart-title "Custo anual estimado"
      var divEl=prev?prev.previousElementSibling:null;
      if(divEl&&divEl.classList&&divEl.classList.contains('divider'))divEl.style.display='none';
      var next=ca.nextElementSibling;
      if(next)next.style.display='none'; // .chart-custo-sub
    }
    // Seção "Resumo de custo" no modal
    var cp=document.getElementById('costPreviewSection');
    if(cp)cp.style.display='none';
    // Menu items ocultos para técnico
    var _tecnicoNavHide=['/licencas','/setores','/historico','/dominios','/aplicativos','/privilegios','/relatorio','/auditoria','/suporte'];
    _tecnicoNavHide.forEach(function(href){
      var el=document.querySelector('a.nav-item[href="'+href+'"]');
      if(el)el.style.display='none';
    });
    // Seções que o técnico SEMPRE pode ver — allowlist explícita
    // (sobrepõe qualquer entrada acidental na blocklist acima)
    var _tecnicoNavAllow=['/exchange','/onedrive','/grupos','/alertas','/politicas','/assessment'];
    _tecnicoNavAllow.forEach(function(href){
      var el=document.querySelector('a.nav-item[href="'+href+'"]');
      if(el)el.style.display='flex';
    });
    // Labels de seção — garantir visibilidade enquanto houver itens visíveis
    ['relatorios','seguranca'].forEach(function(sec){
      var lbl=document.querySelector('.nav-label[data-section="'+sec+'"]');
      if(lbl)lbl.style.display='';
    });
    // Seção "Licenças M365" fica vazia — ocultar o label
    var _lblLic=document.querySelector('.nav-label[data-i18n="nav.licencas_m365"]');
    if(_lblLic)_lblLic.style.display='none';
  }

  // Botões de edição — só superadmin pode editar
  if(!isSuperAdmin){
    document.querySelectorAll('[data-perm="edit"]').forEach(function(el){
      el.style.display='none';
    });
  }

  // Botão importar RH — só superadmin vê
  var btnRH=document.getElementById('btnImportarRH');
  if(btnRH) btnRH.style.display=isSuperAdmin?'':'none';

  // Config read-only para admins (inputs desabilitados)
  if(userRole==='admin'&&!isSuperAdmin){
    document.querySelectorAll('#view-config input, #view-config select').forEach(function(el){
      el.disabled=true;
      el.style.opacity='0.6';
    });
  }

  // Ativar menu de contexto para admin e superadmin
  if(userRole==='admin'||isSuperAdmin){
    _enableContextMenu();
  }
}

function canEdit(){return userRole==='superadmin';}
function canSuggest(){return userRole==='admin'||userRole==='superadmin';}

// ══════════ MENU DE CONTEXTO (botão direito) ══════════

var _ctxData=null; // dados do clique guardados para o popup

function _enableContextMenu(){
  document.addEventListener('contextmenu',function(e){
    if(!canSuggest())return; // deixa menu nativo
    // Não interceptar em inputs, textareas, selects
    var tag=(e.target.tagName||'').toLowerCase();
    if(tag==='input'||tag==='textarea'||tag==='select')return;
    // Não interceptar na sidebar
    if(e.target.closest&&e.target.closest('.sidebar'))return;

    e.preventDefault();
    _closeContextMenu();
    closeAnnotatePopup();

    // Capturar info do elemento clicado
    var realEl=e.target;
    var elSelector='';
    var elText='';
    if(realEl){
      if(realEl.id)elSelector='#'+realEl.id;
      else if(realEl.className&&typeof realEl.className==='string')elSelector='.'+realEl.className.split(' ')[0];
      var topbar=realEl.closest?realEl.closest('.topbar'):null;
      if(topbar){
        var hEl=topbar.querySelector('.page-heading');
        var sEl=topbar.querySelector('.page-sub');
        var hTxt=hEl?(hEl.innerText||hEl.textContent||'').trim():'';
        var sTxt=sEl?(sEl.innerText||sEl.textContent||'').trim():'';
        var combined=hTxt&&sTxt?hTxt+' \u2014 '+sTxt:hTxt||sTxt;
        elText=combined.length>65?combined.substring(0,64)+'\u2026':combined;
      }else{
        var rawText=(realEl.innerText||realEl.textContent||'').replace(/\s+/g,' ').trim();
        elText=rawText.length>65?rawText.substring(0,64)+'\u2026':rawText;
      }
    }

    // Posição relativa ao main
    var main=document.querySelector('main');
    var mainRect=main.getBoundingClientRect();
    var xPct=Math.round((e.clientX-mainRect.left)/mainRect.width*100);
    var yPx=Math.round(e.clientY+main.scrollTop-mainRect.top);

    _ctxData={cx:e.clientX,cy:e.clientY,xPct:xPct,yPx:yPx,elSelector:elSelector,elText:elText};

    // Criar menu de contexto customizado
    var menu=document.createElement('div');
    menu.id='annContextMenu';
    menu.className='ann-ctx-menu';
    menu.innerHTML=
      '<div class="ann-ctx-item" onclick="_ctxSuggest()">'+
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>'+
        'Sugerir alteração aqui'+
      '</div>';

    // Posicionar menu
    var menuW=220,menuH=42;
    var left=e.clientX;
    var top=e.clientY;
    if(left+menuW>window.innerWidth)left=window.innerWidth-menuW-8;
    if(top+menuH>window.innerHeight)top=window.innerHeight-menuH-8;
    menu.style.left=left+'px';
    menu.style.top=top+'px';
    document.body.appendChild(menu);

    // Animar entrada
    requestAnimationFrame(function(){menu.classList.add('visible');});

    // Fechar ao clicar fora ou ESC
    setTimeout(function(){
      document.addEventListener('click',_closeContextMenu);
      document.addEventListener('contextmenu',_closeContextMenu);
    },10);
  });
}

function _closeContextMenu(){
  var m=document.getElementById('annContextMenu');
  if(m)m.remove();
  document.removeEventListener('click',_closeContextMenu);
  document.removeEventListener('contextmenu',_closeContextMenu);
}

/** Chamado ao clicar "Sugerir alteração aqui" no menu de contexto */
function _ctxSuggest(){
  _closeContextMenu();
  if(!_ctxData)return;
  showAnnotatePopup(_ctxData.cx,_ctxData.cy,_ctxData.xPct,_ctxData.yPx,_ctxData.elSelector,_ctxData.elText);
}

// ══════════ POPUP DE ANOTAÇÃO ══════════

/** Retorna a view ativa atual */
function _activeView(){
  var el=document.querySelector('.view.active');
  return el?el.id.replace('view-',''):'';
}

/** Mostra popup para digitar a anotação */
function showAnnotatePopup(cx,cy,xPct,yPx,elSelector,elText){
  var old=document.getElementById('annotatePopup');
  if(old)old.remove();

  // Marcador visual no ponto clicado
  var marker=document.createElement('div');
  marker.id='annClickMarker';
  marker.style.cssText='position:fixed;left:'+(cx-8)+'px;top:'+(cy-8)+'px;width:16px;height:16px;border-radius:50%;background:var(--brown);opacity:.6;z-index:9005;pointer-events:none;animation:pinBounce .3s ease;';
  document.body.appendChild(marker);

  var popup=document.createElement('div');
  popup.id='annotatePopup';
  popup.className='ann-popup';

  var contextHtml=elText?
    '<div class="ann-popup-context"><strong style="font-size:10px;text-transform:uppercase;letter-spacing:.3px;display:block;margin-bottom:2px;opacity:.7">Elemento selecionado</strong>'+esc(elText)+'</div>':'';

  var safeSelector=elSelector.replace(/'/g,"\\'");
  var safeText=elText.replace(/'/g,"\\'").replace(/\n/g,' ');

  popup.innerHTML=
    '<div class="ann-popup-header">'+
      '<span class="ann-popup-title">Sua sugestão</span>'+
      '<button class="ann-popup-close" onclick="closeAnnotatePopup()">&times;</button>'+
    '</div>'+
    contextHtml+
    '<textarea id="annText" class="ann-popup-input" placeholder="Ex: Esse gráfico deveria mostrar os valores em porcentagem..." rows="3"></textarea>'+
    '<div style="display:flex;gap:8px;margin-top:8px">'+
      '<button class="btn btn-outline" style="flex:1" onclick="closeAnnotatePopup()">Cancelar</button>'+
      '<button class="btn btn-dark" style="flex:1" onclick="sendAnnotation('+xPct+','+yPx+',\''+safeSelector+'\',\''+safeText+'\')">Enviar</button>'+
    '</div>';

  // Posicionar popup perto do clique
  var popLeft=Math.min(Math.max(cx-150,12),window.innerWidth-320);
  var popTop=cy+20;
  if(popTop+280>window.innerHeight)popTop=cy-280;
  popup.style.left=popLeft+'px';
  popup.style.top=Math.max(popTop,12)+'px';
  document.body.appendChild(popup);

  setTimeout(function(){var ta=document.getElementById('annText');if(ta)ta.focus();},50);
}

function closeAnnotatePopup(){
  var p=document.getElementById('annotatePopup');
  if(p)p.remove();
  var m=document.getElementById('annClickMarker');
  if(m)m.remove();
}

// ESC fecha popup
document.addEventListener('keydown',function(e){
  if(e.key==='Escape')closeAnnotatePopup();
});

/** Envia a anotação para o servidor */
function sendAnnotation(xPct,yPx,elSelector,elText){
  var text=(document.getElementById('annText').value||'').trim();
  if(!text){toast('Digite uma descrição.');return;}

  fetch('/api/annotations',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      text:text,
      view:_activeView(),
      xPct:xPct,
      yPx:yPx,
      elSelector:elSelector,
      elText:elText
    })
  })
  .then(function(r){return r.json();})
  .then(function(data){
    if(data.ok){
      closeAnnotatePopup();
      toast('Sugestão enviada! O Enzzo será notificado.');
      if(userRole==='superadmin')loadAnnotations();
    }else{
      toast('Erro: '+(data.error||'falha'));
    }
  })
  .catch(function(){toast('Erro ao enviar.');});
}

// ══════════ PINOS E LISTA DE ANOTAÇÕES ══════════

/** Carrega e renderiza anotações (pinos) — só superadmin vê */
function loadAnnotations(){
  fetch('/api/annotations')
    .then(function(r){return r.json();})
    .then(function(data){
      if(!Array.isArray(data))return;
      annotations=data;
      renderAnnotationPins();
      renderAnnotationsList();
    })
    .catch(function(){});
}

/** Renderiza pinos flutuantes na view ativa */
function renderAnnotationPins(){
  document.querySelectorAll('.ann-pin').forEach(function(p){p.remove();});
  if(userRole!=='superadmin')return;

  var view=_activeView();
  var viewEl=document.getElementById('view-'+view);
  if(!viewEl)return;

  var pending=annotations.filter(function(a){return a.view===view&&a.status==='pendente';});
  pending.forEach(function(a,i){
    var pin=document.createElement('div');
    pin.className='ann-pin';
    pin.title=a.author+': '+a.text;
    pin.textContent=i+1;
    pin.style.left=a.xPct+'%';
    pin.style.top=(a.yPx-14)+'px';
    pin.onclick=function(e){
      e.stopPropagation();
      showPinDetail(a,pin);
    };
    viewEl.appendChild(pin);
  });
}

/** Mostra detalhe de um pino ao clicar */
function showPinDetail(a,pinEl){
  var old=document.getElementById('annPinDetail');
  if(old)old.remove();

  var rect=pinEl.getBoundingClientRect();
  var d=document.createElement('div');
  d.id='annPinDetail';
  d.className='ann-pin-detail';
  d.innerHTML=
    '<div class="ann-pin-detail-header">'+
      '<strong>'+esc(a.author)+'</strong>'+
      '<span style="color:var(--muted);font-size:10px">'+fmtDate(a.date)+'</span>'+
    '</div>'+
    (a.elText?'<div class="ann-pin-context">Elemento: '+esc(a.elText)+'</div>':'')+
    '<div class="ann-pin-text">'+esc(a.text)+'</div>'+
    '<div class="ann-pin-actions">'+
      '<button class="btn btn-sm btn-outline" onclick="resolveAnnotation('+a.id+',\'feita\')">Feito</button>'+
      '<button class="btn btn-sm btn-outline" style="color:var(--red);border-color:var(--red)" onclick="resolveAnnotation('+a.id+',\'recusada\')">Recusar</button>'+
      '<button class="btn btn-sm btn-outline" onclick="deleteAnnotation('+a.id+')">Excluir</button>'+
    '</div>';
  d.style.left=Math.min(rect.right+8,window.innerWidth-300)+'px';
  d.style.top=Math.max(rect.top-10,8)+'px';
  document.body.appendChild(d);

  function _pinEscHandler(e){
    if(e.key==='Escape'){
      d.remove();
      document.removeEventListener('keydown',_pinEscHandler);
    }
  }
  document.addEventListener('keydown',_pinEscHandler);

  setTimeout(function(){
    document.addEventListener('click',function closePinDetail(ev){
      if(!d.contains(ev.target)&&ev.target!==pinEl){
        d.remove();
        document.removeEventListener('click',closePinDetail);
        document.removeEventListener('keydown',_pinEscHandler);
      }
    });
  },100);
}

function resolveAnnotation(id,status){
  fetch('/api/annotations/'+id,{
    method:'PATCH',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({status:status})
  })
  .then(function(r){return r.json();})
  .then(function(data){
    if(data.ok){
      var d=document.getElementById('annPinDetail');
      if(d)d.remove();
      toast(status==='feita'?'Marcada como feita!':'Anotação recusada.');
      loadAnnotations();
    }
  });
}

function deleteAnnotation(id){
  fetch('/api/annotations/'+id,{method:'DELETE'})
  .then(function(r){return r.json();})
  .then(function(data){
    if(data.ok){
      var d=document.getElementById('annPinDetail');
      if(d)d.remove();
      toast('Anotação excluída.');
      loadAnnotations();
    }
  });
}

/** Renderiza lista de anotações na view Sugestões */
function renderAnnotationsList(){
  var list=document.getElementById('suggestionsList');
  if(!list)return;
  if(!annotations.length){
    list.innerHTML='<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px">Nenhuma anotação ainda.</div>';
    return;
  }
  var statusIcons={pendente:'◐',feita:'●',recusada:'○'};
  var viewLabels={dashboard:'Dashboard',colaboradores:'Colaboradores',licencas:'Licenças',setores:'Por Setor',historico:'Histórico',radar:'Radar',contratos:'Contratos',relatorio:'Relatório',config:'Config'};
  list.innerHTML=annotations.slice().reverse().map(function(a){
    var viewLabel=viewLabels[a.view]||a.view;
    var actions=userRole==='superadmin'&&a.status==='pendente'?
      '<div class="sug-footer">'+
        '<button class="btn btn-sm btn-outline" onclick="resolveAnnotation('+a.id+',\'feita\')">Feito</button>'+
        '<button class="btn btn-sm btn-outline" onclick="resolveAnnotation('+a.id+',\'recusada\')">Recusar</button>'+
        '<button class="btn btn-sm btn-outline" onclick="deleteAnnotation('+a.id+')">Excluir</button>'+
      '</div>':'';
    return '<div class="sug-item'+(a.status!=='pendente'?' sug-resolved':'')+'">'+
      '<div class="sug-item-header">'+
        '<span class="sug-author">'+(statusIcons[a.status]||'')+' '+esc(a.author)+'</span>'+
        '<span class="sug-date">'+fmtDate(a.date)+'</span>'+
      '</div>'+
      '<div class="sug-view-badge">'+esc(viewLabel)+'</div>'+
      (a.elText?'<div class="ann-el-ref">'+esc(a.elText)+'</div>':'')+
      '<div class="sug-text">'+esc(a.text)+'</div>'+
      '<div class="sug-status-label" style="color:'+(a.status==='pendente'?'var(--yellow)':a.status==='feita'?'var(--green)':'var(--red)')+'">'+a.status+'</div>'+
      actions+
    '</div>';
  }).join('');
}

// Atualizar pinos quando troca de view
document.addEventListener('DOMContentLoaded',function(){
  var views=document.querySelectorAll('.view');
  var observer=new MutationObserver(function(){
    if(userRole==='superadmin')renderAnnotationPins();
  });
  views.forEach(function(v){
    observer.observe(v,{attributes:true,attributeFilter:['class']});
  });
});
