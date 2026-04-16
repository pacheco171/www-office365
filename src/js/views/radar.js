/* ══════════ RADAR ══════════
   Detecta oportunidades de economia em licenças M365 usando dados reais
   de uso vindos da API do Azure (mailbox, OneDrive, apps desktop/web/mobile).

   Blocos de análise:
   1. Bloqueados com licença ativa
   2. Basic → F3 (mailbox < 2GB E OneDrive < 2GB)
   3. Standard → Basic (sem uso de apps desktop)
   4. Cargos operacionais com licença cara
   5. Email subutilizado (< 2GB de 50GB)
   6. Sem setor definido                                              */

var USAGE_THRESHOLDS = {
  mailboxLowMB: 2000,
  onedriveLowMB: 2000,
};

// Estado de paginação, colapso e filtro por bloco
var radarBlockState = {};
var radarFilterBlock = null; // null = mostrar todos, 'radar-block-xxx' = só esse

function getBlockState(id) {
  if (!radarBlockState[id]) radarBlockState[id] = { pageSize: 20, collapsed: false };
  return radarBlockState[id];
}

function getUserUsage(r) {
  var email = (r.email || '').trim().toLowerCase();
  return (typeof usageData !== 'undefined' && usageData[email]) || null;
}

function fmtStorage(mb) {
  if (mb == null) return '—';
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
  return Math.round(mb) + ' MB';
}

function hasUsageData() {
  return typeof usageData !== 'undefined' && Object.keys(usageData).length > 0;
}

function detectStdToBasicCandidates(ativos) {
  var hasUsage = hasUsageData();
  var needsDesktop = /analis|gerente|diretor|coordenador|supervis|engenheir|contad|financ|controller|auditor|comprad|planej|designer|estilis|desenvolv|program|arquitet|consul|espec|tech|lider|líder|gestor/i;
  var setorDesktop = /ti|desenvolvimento|engenharia|contabilidade|financeiro|diretoria|auditoria|estilo|marketing|compras/i;

  return ativos.filter(function(r) {
    if (r.licId !== 'bstd') return false;
    var cargo = r.cargo || '';
    var setor = r.setor || '';
    var usage = getUserUsage(r);
    if (hasUsage && usage) {
      if (usage.appsDesktop === true) return false;
      if (usage.appsDesktop == null && usage.mailboxMB != null && usage.mailboxMB > USAGE_THRESHOLDS.mailboxLowMB) return false;
      return true;
    }
    if (needsDesktop.test(cargo)) return false;
    if (setorDesktop.test(setor)) return false;
    return true;
  });
}

function detectBasicToF3Candidates(ativos) {
  var hasUsage = hasUsageData();
  var opCargos = /auxiliar|operador|costureira|cortador|estampador|bordadeiro|embalagem|expedição|expedicao|conferente|separador|zelador|porteiro|motorista|ajudante|servente|limpeza|vigilante|recepcionista|almoxarif|cozinheir|copeira|jardineiro|manutençao|manutenção|soldador|mecanico|mecânico|eletricista|montador|pintor|pedreiro|carpinteiro|serralheiro|caldeireiro|torneiro|fresador|funileiro|prensista|dobrador/i;

  return ativos.filter(function(r) {
    if (r.licId !== 'bbasic') return false;
    var cargo = r.cargo || '';
    var usage = getUserUsage(r);
    if (hasUsage && usage) {
      if (usage.mailboxMB != null && usage.mailboxMB > 2000) return false;
      if (usage.onedriveMB != null && usage.onedriveMB > 2000) return false;
      return true;
    }
    if (opCargos.test(cargo)) return true;
    return false;
  }).sort(function(a, b) {
    var uA = getUserUsage(a), uB = getUserUsage(b);
    return (uA ? uA.mailboxMB || 0 : 9999) - (uB ? uB.mailboxMB || 0 : 9999);
  });
}

function detectLowUsageCandidates(ativos) {
  if (!hasUsageData()) return [];
  return ativos.filter(function(r) {
    if (r.licId !== 'bstd' && r.licId !== 'bbasic') return false;
    var usage = getUserUsage(r);
    if (!usage || usage.mailboxMB == null) return false;
    return usage.mailboxMB < USAGE_THRESHOLDS.mailboxLowMB;
  }).sort(function(a, b) {
    var uA = getUserUsage(a), uB = getUserUsage(b);
    return (uA ? uA.mailboxMB : 0) - (uB ? uB.mailboxMB : 0);
  });
}

/** Filtra para mostrar só um bloco do radar (ou volta a mostrar todos) */
function radarFilterTo(blockId) {
  if (radarFilterBlock === blockId) {
    radarFilterBlock = null; // toggle: clicou no mesmo → volta todos
  } else {
    radarFilterBlock = blockId;
    var st = getBlockState(blockId);
    if (st.collapsed) st.collapsed = false;
  }
  renderRadar();
}

/** Volta a mostrar todos os blocos */
function radarShowAll() {
  radarFilterBlock = null;
  renderRadar();
}

/** Toggle colapso de um bloco */
function radarToggleBlock(blockId) {
  var st = getBlockState(blockId);
  st.collapsed = !st.collapsed;
  renderRadar();
}

/** Muda page size de um bloco */
function radarSetPageSize(blockId, size) {
  var st = getBlockState(blockId);
  st.pageSize = size;
  renderRadar();
}

function renderRadar(){
  var ativos=db.filter(function(r){return r.status==='Ativo';});
  var bloqueados=db.filter(function(r){return r.status==='Inativo'&&r.licId!=='none';});
  var opKw=['auxiliar','operador','costureira','cortador','estampador','bordadeiro','embalagem','expedição','conferente','separador','zelador','porteiro'];
  var superLic=ativos.filter(function(r){
    var cl=(r.cargo||'').toLowerCase();
    return opKw.some(function(k){return cl.indexOf(k)>=0;})&&(r.licId==='bstd'||r.licId==='e3');
  });
  var basicToF3=detectBasicToF3Candidates(ativos);
  var basicToF3Emails={}; basicToF3.forEach(function(r){basicToF3Emails[(r.email||'').toLowerCase()]=true;});
  var stdToBasic=detectStdToBasicCandidates(ativos);
  var stdEmails={}; stdToBasic.forEach(function(r){stdEmails[(r.email||'').toLowerCase()]=true;});
  var lowUsage=detectLowUsageCandidates(ativos);
  var lowUsageUnique=lowUsage.filter(function(r){var e=(r.email||'').toLowerCase();return !stdEmails[e]&&!basicToF3Emails[e];});
  var semSetor=db.filter(function(r){return !r.setor||r.setor==='Sem Setor';});

  var custoBloq=bloqueados.reduce(function(s,r){return s+userCost(r);},0);
  var economiaDowngrade=superLic.reduce(function(s,r){return s+(userCost(r)-25);},0);
  var priceDiff=licById['bstd'].price-licById['bbasic'].price;
  var economiaStdBasic=stdToBasic.length*priceDiff;
  var basicF3Diff=licById['bbasic'].price-licById['f3'].price;
  var economiaBasicF3=basicToF3.length*basicF3Diff;
  var economiaLowUsage=lowUsageUnique.reduce(function(s,r){
    return s+(licById[r.licId].price-licById['f3'].price);
  },0);
  var totalPotencial=custoBloq+economiaDowngrade+economiaStdBasic+economiaBasicF3+economiaLowUsage;

  var usageCount=hasUsageData()?Object.keys(usageData).length:0;
  var appsCount=0;
  if(hasUsageData()){
    for(var k in usageData){if(usageData[k].appsDesktop!=null)appsCount++;}
  }

  // KPIs — clicáveis para scrollar até o bloco
  var chevron='<svg class="radar-kpi-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10"><polyline points="9 18 15 12 9 6"/></svg>';
  document.getElementById('radarKpis').innerHTML=
    kpiCard('rgba(184,92,74,.1)','var(--red)','<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
      bloqueados.length, bloqueados.length>0?'var(--red)':'var(--black)',
      'Bloqueados com licença',
      bloqueados.length>0?'<span data-financial>'+fmtBRL(custoBloq)+'/mês desperdiçado</span>':'Nenhum',
      bloqueados.length>0?'var(--red)':'var(--muted)', 'radar-block-bloqueados')+
    kpiCard('rgba(0,120,212,.1)','#0078d4','<polyline points="7 13 12 18 17 13"/><line x1="12" y1="6" x2="12" y2="18"/>',
      basicToF3.length, basicToF3.length>0?'#0078d4':'var(--black)',
      'Basic → F3',
      basicToF3.length>0?'Economia <span data-financial>'+fmtBRL(economiaBasicF3)+'/mês</span>':'Nenhum',
      basicToF3.length>0?'#0078d4':'var(--muted)', 'radar-block-basicf3')+
    kpiCard('rgba(181,164,142,.12)','var(--brown)','<polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/>',
      stdToBasic.length, stdToBasic.length>0?'var(--brown)':'var(--black)',
      'Standard → Basic',
      stdToBasic.length>0?'Economia <span data-financial>'+fmtBRL(economiaStdBasic)+'/mês</span>':'Nenhum',
      stdToBasic.length>0?'var(--brown)':'var(--muted)', 'radar-block-stdbasic')+
    kpiCard('rgba(184,144,58,.1)','var(--yellow)','<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
      superLic.length, superLic.length>0?'var(--yellow)':'var(--black)',
      'Operacionais com licença cara',
      superLic.length>0?'Economia <span data-financial>'+fmtBRL(economiaDowngrade)+'/mês</span>':'Nenhum',
      superLic.length>0?'var(--yellow)':'var(--muted)', 'radar-block-superlicenciados')+
    kpiCard('rgba(90,138,106,.1)','var(--green)','<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
      fmtBRL(totalPotencial), 'var(--green)',
      'Economia potencial / mês',
      fmtBRL(totalPotencial*12)+' / ano',
      'var(--green)', null, true)+
    kpiCard('rgba(0,120,212,.06)','#0078d4','<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
      usageCount, '#0078d4',
      'Dados de uso (Azure API)',
      appsCount+' com info de apps desktop',
      'var(--muted)', null);

  // ICON SVGs
  var icoAlert='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  var icoWarn='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  var icoOk='<svg viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
  var icoUser='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>';
  var icoF3='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="7 13 12 18 17 13"/><line x1="12" y1="6" x2="12" y2="18"/></svg>';
  var icoDown='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/></svg>';
  var icoMail='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22 7 12 13 2 7"/></svg>';

  var html='';

  // Block 1 — Bloqueados
  html+=section('radar-block-bloqueados',
    'var(--red)','rgba(184,92,74,.1)',icoAlert,
    'Bloqueados com licença ativa',
    'Usuários inativos que ainda geram custo — remova a licença',
    bloqueados.length>0?bloqueados.length+' usuários <span data-financial>· '+fmtBRL(custoBloq)+'/mês</span>':'Nenhum',
    bloqueados.length>0?'radar-badge-red':'radar-badge-green',
    bloqueados.slice().sort(function(a,b){return (a.nome||'').localeCompare(b.nome||'');}).map(function(r){
      return {
        r:r, cost: fmtBRL(userCost(r))+'/mês',
        detail: '<span class="dept-tag">'+esc(r.setor)+'</span>'+licBadge(r.licId)+(r.demissao?'<span style="color:var(--red);font-size:10px">bloqueado '+fmtDate(r.demissao)+'</span>':''),
        btnLabel:'Remover licença', btnFn:'removeLic('+r.id+')'
      };
    }),
    'Nenhum usuário bloqueado com licença ativa.'
  );

  // Block 2 — Basic → F3
  var basicF3Sub=hasUsageData()
    ?'Dados reais da API: mailbox < 2 GB e OneDrive < 2 GB nos últimos 30 dias'
    :'Estimativa por cargo — sincronize com o Azure para dados reais de uso';
  html+=section('radar-block-basicf3',
    '#0078d4','rgba(0,120,212,.1)',icoF3,
    'Basic → F3: economia prioritária',
    basicF3Sub,
    basicToF3.length>0?basicToF3.length+' usuários <span data-financial>· economia '+fmtBRL(economiaBasicF3)+'/mês</span>':'Nenhum candidato',
    basicToF3.length>0?'radar-badge-yellow':'radar-badge-green',
    basicToF3.map(function(r){
      var usage=getUserUsage(r);
      var usageInfo='';
      if(usage){
        var parts=[];
        if(usage.mailboxMB!=null)parts.push('Email: '+fmtStorage(usage.mailboxMB)+' / 2 GB');
        if(usage.onedriveMB!=null)parts.push('OneDrive: '+fmtStorage(usage.onedriveMB)+' / 2 GB');
        if(parts.length)usageInfo='<span class="radar-usage-info">'+parts.join(' · ')+'</span>';
      }
      return {
        r:r, cost: fmtBRL(basicF3Diff)+'/mês',
        detail: '<span class="dept-tag">'+esc(r.setor)+'</span><span style="color:var(--muted);font-size:11px">'+esc(r.cargo)+'</span>'+licBadge('bbasic')+'<span style="color:var(--muted)">\u2192</span>'+licBadge('f3')+usageInfo,
        btnLabel:'Migrar p/ F3', btnFn:"downgradeLic("+r.id+",'f3')"
      };
    }),
    'Nenhum candidato a migração Basic → F3.'
  );

  // Block 3 — Standard → Basic
  var stdSub=hasUsageData()
    ?(appsCount>0
      ?'Dados reais: '+appsCount+' usuários com info de apps desktop dos últimos 30 dias'
      :'Dados de mailbox/OneDrive disponíveis — apps desktop sem info')
    :'Estimativa por cargo/setor — sincronize para dados reais de uso';
  html+=section('radar-block-stdbasic',
    'var(--brown)','rgba(181,164,142,.12)',icoDown,
    'Standard → Basic: sem uso de apps desktop',
    stdSub,
    stdToBasic.length>0?stdToBasic.length+' usuários <span data-financial>· economia '+fmtBRL(economiaStdBasic)+'/mês</span>':'Nenhum',
    stdToBasic.length>0?'radar-badge-yellow':'radar-badge-green',
    stdToBasic.sort(function(a,b){return (a.nome||'').localeCompare(b.nome||'');}).map(function(r){
      var usage=getUserUsage(r);
      var usageInfo='';
      if(usage){
        var parts=[];
        if(usage.appsDesktop===false)parts.push('Desktop: não usa');
        else if(usage.appsDesktop===true)parts.push('Desktop: usa');
        if(usage.desktopApps&&usage.desktopApps.length)parts.push(usage.desktopApps.join(', '));
        if(usage.mailboxMB!=null)parts.push('Email: '+fmtStorage(usage.mailboxMB));
        if(usage.onedriveMB!=null)parts.push('OneDrive: '+fmtStorage(usage.onedriveMB));
        if(usage.appsWeb===true)parts.push('Web: usa');
        if(usage.appsMobile===true)parts.push('Mobile: usa');
        if(parts.length)usageInfo='<span class="radar-usage-info">'+parts.join(' · ')+'</span>';
      }
      return {
        r:r, cost: fmtBRL(priceDiff)+'/mês',
        detail: '<span class="dept-tag">'+esc(r.setor)+'</span><span style="color:var(--muted);font-size:11px">'+esc(r.cargo)+'</span>'+licBadge('bstd')+'<span style="color:var(--muted)">\u2192</span>'+licBadge('bbasic')+usageInfo,
        btnLabel:'Migrar p/ Basic', btnFn:"downgradeLic("+r.id+",'bbasic')"
      };
    }),
    'Nenhum candidato a migração Standard → Basic.'
  );

  // Block 4 — Operacionais
  html+=section('radar-block-superlicenciados',
    'var(--yellow)','rgba(184,144,58,.1)',icoWarn,
    'Cargos operacionais com licença cara',
    'Detecção por palavras-chave no cargo (auxiliar, operador, costureira, etc.)',
    superLic.length>0?superLic.length+' usuários <span data-financial>· economia '+fmtBRL(economiaDowngrade)+'/mês</span>':'Nenhum',
    superLic.length>0?'radar-badge-yellow':'radar-badge-green',
    superLic.slice().sort(function(a,b){return (a.nome||'').localeCompare(b.nome||'');}).map(function(r){
      var usage=getUserUsage(r);
      var usageInfo='';
      if(usage){
        var parts=[];
        if(usage.mailboxMB!=null)parts.push('Email: '+fmtStorage(usage.mailboxMB));
        if(usage.onedriveMB!=null)parts.push('OneDrive: '+fmtStorage(usage.onedriveMB));
        if(usage.appsDesktop===true)parts.push('Usa desktop');
        if(usage.appsDesktop===false)parts.push('Não usa desktop');
        if(parts.length)usageInfo='<span class="radar-usage-info">'+parts.join(' · ')+'</span>';
      }
      return {
        r:r, cost: fmtBRL(userCost(r)-25)+'/mês',
        detail: '<span class="dept-tag">'+esc(r.setor)+'</span><span style="color:var(--muted);font-size:11px">'+esc(r.cargo)+'</span>'+licBadge(r.licId)+'<span style="color:var(--muted)">→</span>'+licBadge('f3')+usageInfo,
        btnLabel:'Fazer downgrade', btnFn:"downgradeLic("+r.id+",'f3')"
      };
    }),
    'Nenhum cargo operacional com licença desproporcional.'
  );

  // Block 5 — Email subutilizado
  if(hasUsageData()){
    html+=section('radar-block-lowusage',
      '#0078d4','rgba(0,120,212,.08)',icoMail,
      'Caixa de email subutilizada (< '+fmtStorage(USAGE_THRESHOLDS.mailboxLowMB)+' de 50 GB)',
      'Licença oferece 50 GB mas usa menos de 2 GB — candidatos a F3 (2 GB, <span data-financial>R$ '+licById['f3'].price.toFixed(2).replace('.',',')+'/mês</span>)',
      lowUsageUnique.length>0?lowUsageUnique.length+' usuários <span data-financial>· economia '+fmtBRL(economiaLowUsage)+'/mês</span>':'Nenhum',
      lowUsageUnique.length>0?'radar-badge-yellow':'radar-badge-green',
      lowUsageUnique.slice().sort(function(a,b){return (a.nome||'').localeCompare(b.nome||'');}).map(function(r){
        var usage=getUserUsage(r);
        var mb=usage?usage.mailboxMB:0;
        var pctUsed=Math.round(mb/51200*100*10)/10;
        var saving=licById[r.licId].price-licById['f3'].price;
        return {
          r:r, cost: fmtBRL(saving)+'/mês',
          detail: '<span class="dept-tag">'+esc(r.setor)+'</span>'+licBadge(r.licId)+'<span style="color:var(--muted)">\u2192</span>'+licBadge('f3')+
            '<span class="radar-usage-bar"><span class="radar-usage-fill" style="width:'+Math.max(pctUsed,1)+'%"></span></span>'+
            '<span class="radar-usage-info">'+fmtStorage(mb)+' / 50 GB ('+pctUsed+'%)</span>',
          btnLabel:'Migrar p/ F3', btnFn:"downgradeLic("+r.id+",'f3')"
        };
      }),
      'Nenhum usuário com caixa subutilizada.'
    );
  }

  // Block 6 — Sem setor
  html+=section('radar-block-semsetor',
    'var(--muted)','rgba(138,128,112,.1)',icoUser,
    'Sem setor definido',
    'Contas sem OU no AD — geralmente contas de serviço ou recurso',
    semSetor.length>0?semSetor.length+' contas':'Nenhum',
    semSetor.length>0?'radar-badge-yellow':'radar-badge-green',
    semSetor.slice().sort(function(a,b){return (a.nome||'').localeCompare(b.nome||'');}).map(function(r){
      return {
        r:r, cost: userCost(r)>0?fmtBRL(userCost(r))+'/mês':'—',
        detail: licBadge(r.licId)+'<span style="color:var(--muted)">'+esc(r.cargo)+'</span>',
        btnLabel:'Editar', btnFn:'openDetail('+r.id+')'
      };
    }),
    'Todos os colaboradores têm setor definido.'
  );

  // Botão "Mostrar todos" quando há filtro ativo
  if (radarFilterBlock) {
    html = '<div class="radar-back-bar"><button class="radar-back-btn" onclick="radarShowAll()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="15 18 9 12 15 6"/></svg> Mostrar todos os blocos</button></div>' + html;
  }

  document.getElementById('radarContent').innerHTML=html;

}

// Fechar dropdowns de paginação ao clicar fora
document.addEventListener('click', function(e) {
  if (e.target.closest && e.target.closest('.radar-pager-dropdown')) return;
  var open = document.querySelectorAll('.radar-pager-dropdown.open');
  for (var i = 0; i < open.length; i++) open[i].classList.remove('open');
});

/** Gera HTML de um KPI card clicável */
function kpiCard(bg, strokeColor, svgPath, val, valColor, label, sub, subColor, targetBlockId, wrapFinancial) {
  var isActive = radarFilterBlock === targetBlockId;
  var clickAttr = targetBlockId ? ' onclick="radarFilterTo(\''+targetBlockId+'\')"' : '';
  var activeCls = isActive ? ' radar-kpi-active' : '';
  var chevron = targetBlockId ? '<svg class="radar-kpi-chevron" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2.5" width="10" height="10"><polyline points="9 18 15 12 9 6"/></svg>' : '';
  var dataFin = wrapFinancial ? ' data-financial' : '';
  return '<div class="radar-kpi'+activeCls+'"'+clickAttr+dataFin+'>'+
    '<div class="radar-kpi-icon" style="background:'+bg+'">'+
      '<svg viewBox="0 0 24 24" fill="none" stroke="'+strokeColor+'" stroke-width="2.5">'+svgPath+'</svg>'+
    '</div>'+
    '<div class="radar-kpi-body">'+
      '<div class="radar-kpi-val" style="color:'+valColor+'">'+val+'</div>'+
      '<div class="radar-kpi-label">'+label+chevron+'</div>'+
      '<div class="radar-kpi-sub" style="color:'+subColor+'">'+sub+'</div>'+
    '</div>'+
  '</div>';
}

/** Toggle dropdown de paginação */
function radarTogglePageDropdown(blockId) {
  var el = document.getElementById('radar-pager-'+blockId);
  if (!el) return;
  el.classList.toggle('open');
}

/** Gera HTML de um bloco do radar com collapse + paginação */
function section(blockId, color, bgColor, icon, title, sub, badge, badgeCls, items, emptyMsg){
  // Se há filtro ativo e não é este bloco, esconder
  if (radarFilterBlock && radarFilterBlock !== blockId) return '';

  var st = getBlockState(blockId);
  var collapsed = st.collapsed;
  var pageSize = st.pageSize;
  var total = items.length;
  var chevronCls = collapsed ? '' : ' open';
  var collapseChevron = '<svg class="radar-collapse-chevron'+chevronCls+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="6 9 12 15 18 9"/></svg>';

  var headerHtml = '<div class="radar-block-header" onclick="radarToggleBlock(\''+blockId+'\')" style="cursor:pointer">'+
    '<div class="radar-block-left">'+
      '<div class="radar-block-icon" style="background:'+bgColor+';color:'+color+'">'+icon+'</div>'+
      '<div>'+
        '<div class="radar-block-title">'+title+'</div>'+
        '<div class="radar-block-sub">'+sub+'</div>'+
      '</div>'+
    '</div>'+
    '<div style="display:flex;align-items:center;gap:8px">'+
      '<span class="radar-badge '+badgeCls+'">'+badge+'</span>'+
      collapseChevron+
    '</div>'+
  '</div>';

  if (collapsed || total === 0) {
    var body = '';
    if (!collapsed && total === 0) {
      body = '<div class="radar-empty-row"><svg viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg><span>'+emptyMsg+'</span></div>';
    }
    return '<div class="radar-block" id="'+blockId+'">'+headerHtml+body+'</div>';
  }

  // Paginação
  var visibleItems = pageSize === 0 ? items : items.slice(0, pageSize);
  var rows = visibleItems.map(function(it){
    return '<div class="radar-row" onclick="openDetail('+it.r.id+')">'+
      '<div class="radar-row-avatar">'+ini(it.r.nome)+'</div>'+
      '<div>'+
        '<div class="radar-row-name">'+it.r.nome+'</div>'+
        '<div style="font-size:11px;color:var(--muted)">'+it.r.email+'</div>'+
      '</div>'+
      '<div class="radar-row-meta">'+it.detail+'</div>'+
      '<div class="radar-row-cost" data-financial style="color:'+color+'">'+it.cost+'</div>'+
      '<button class="radar-row-btn" onclick="event.stopPropagation();'+it.btnFn+'">'+it.btnLabel+'</button>'+
    '</div>';
  }).join('');

  // Dropdown de paginação no topo (entre header e rows)
  var pageSizes = [10, 20, 30, 40, 50, 0]; // 0 = Todos
  var pagerHtml = '';
  if (total > 10) {
    var showing = pageSize === 0 ? total : Math.min(pageSize, total);
    var pageSizeLabel = pageSize === 0 ? 'Todos' : pageSize;
    pagerHtml = '<div class="radar-pager-bar">'+
      '<span class="radar-pager-info">Mostrando '+showing+' de '+total+'</span>'+
      '<div class="radar-pager-dropdown" id="radar-pager-'+blockId+'">'+
        '<button class="radar-pager-trigger" onclick="event.stopPropagation();radarTogglePageDropdown(\''+blockId+'\')">'+
          pageSizeLabel+' <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10"><polyline points="6 9 12 15 18 9"/></svg>'+
        '</button>'+
        '<div class="radar-pager-menu">'+
          pageSizes.map(function(s){
            var label = s === 0 ? 'Todos' : s;
            var active = (s === pageSize) ? ' active' : '';
            return '<button class="radar-pager-opt'+active+'" onclick="event.stopPropagation();radarSetPageSize(\''+blockId+'\','+s+')">'+label+'</button>';
          }).join('')+
        '</div>'+
      '</div>'+
    '</div>';
  }

  return '<div class="radar-block" id="'+blockId+'">'+headerHtml+pagerHtml+rows+'</div>';
}

function removeLic(id){
  var r=db.find(function(x){return x.id===id;});if(!r)return;
  if(!confirm('Remover licença de '+r.nome+'?'))return;
  var oldLic=r.licId;
  r.licId='none';r.addons=[];r.licRaw='Unlicensed';
  logChange('license_change','colaborador',id,r.nome,[{campo:'licId',de:getLic(oldLic).short,para:'Outros'}]);
  persist();refresh();renderRadar();toast('Licença removida de '+r.nome);
}
function downgradeLic(id,newLicId){
  var r=db.find(function(x){return x.id===id;});if(!r)return;
  if(!confirm('Fazer downgrade de '+r.nome+' para '+getLic(newLicId).short+'?'))return;
  var oldLic=r.licId;
  r.licId=newLicId;r.addons=(r.addons||[]).filter(function(a){return a==='pbi';});
  logChange('license_change','colaborador',id,r.nome,[{campo:'licId',de:getLic(oldLic).short,para:getLic(newLicId).short}]);
  persist();refresh();renderRadar();toast(r.nome+' atualizado para '+getLic(newLicId).short);
}
