/* ══════════ COLLABORATORS TABLE — Tabela principal de colaboradores ══════════ */

/* Filtro de macro-setor ativo (vindo do dashboard) */
var _activeMacroFilter = null;

/** Limpa filtro de macro-setor e re-renderiza */
window._clearMacroFilter = function() {
  _activeMacroFilter = null;
  currentPage = 1;
  renderTable();
};

/** Renderiza celula de cargo com indicador de certeza */
function cargoCell(r){
  var orig=r.cargoOrigem||'ad';
  var cls='cargo-origin cargo-origin-'+orig;
  var tip=typeof t==='function'?(orig==='ad'?t('cargo.ad'):t('cargo.fallback')):(orig==='ad'?'Cargo do AD':'Cargo não definido no AD');
  if(r.cargoFixo||orig==='override'){cls='cargo-origin cargo-origin-override';tip=typeof t==='function'?t('cargo.override'):'Cargo definido manualmente';}
  return '<span class="'+cls+'" title="'+tip+'">'+esc(r.cargo)+'</span>';
}

var _colabDebounce=null;

/** Dispara renderTable com debounce (para input de busca) */
function debouncedRender(){
  clearTimeout(_colabDebounce);
  _colabDebounce=setTimeout(function(){currentPage=1;renderTable();},300);
}

/** Mostra ou esconde o botão X de limpar busca */
function _toggleSearchClear(){
  var inp=document.getElementById('searchInput');
  var btn=document.getElementById('searchClear');
  if(btn) btn.classList.toggle('visible', !!(inp&&inp.value));
}

/** Limpa o campo de busca e re-renderiza */
function clearSearch(){
  var inp=document.getElementById('searchInput');
  if(inp) inp.value='';
  _toggleSearchClear();
  currentPage=1;
  renderTable();
}

/** Altera quantidade de itens por página e re-renderiza */
function changePerPage(val){
  PER=val==='all'?9999:parseInt(val);
  currentPage=1;
  renderTable();
}

/** Renderiza tabela de colaboradores com paginação client-side */
function renderTable(){
  _updateSortHeaders();
  if(!db||!db.length){
    var tbody=document.getElementById('tableBody');
    if(tbody)tbody.innerHTML='<tr class="empty-row"><td colspan="8">Carregando...</td></tr>';
    return;
  }
  _renderTableLocal();
}

/** Renderiza tabela com dados em memória (client-side) */
function _renderTableLocal(){
  // Aplica filtro vindo de navegação do dashboard (clique em setor macro ou status)
  if (window._pendingColabFilter) {
    var _pf = window._pendingColabFilter;
    window._pendingColabFilter = null;
    if (_pf.macro) {
      _activeMacroFilter = _pf.macro;
      // Resetar fltSetor para não conflitar
      var _s = document.getElementById('fltSetor'); if (_s) _s.value = '';
    }
    if (_pf.status) { var _st = document.getElementById('fltStatus'); if (_st) _st.value = _pf.status; }
  }
  var _aside=document.querySelector('aside');
  var _asideScroll=_aside?_aside.scrollTop:0;
  var q=document.getElementById('searchInput').value.toLowerCase();
  var fs=document.getElementById('fltSetor').value;
  // Se o usuário selecionou um setor manualmente, limpa o filtro de macro
  if (fs && _activeMacroFilter) _activeMacroFilter = null;
  var fl=document.getElementById('fltLic').value;
  var fst=document.getElementById('fltStatus').value;
  var fc=document.getElementById('fltCargo')?document.getElementById('fltCargo').value:'';
  var fp=document.getElementById('fltPeriodo')?document.getElementById('fltPeriodo').value:'';
  var cutoff=fp?new Date(new Date().setDate(new Date().getDate()-parseInt(fp))):null;

  // Chip de macro-setor ativo: injeta/remove na toolbar
  var _toolbar=document.querySelector('.toolbar');
  var _chip=document.getElementById('_macroChip');
  if (_activeMacroFilter) {
    if (!_chip && _toolbar) {
      _chip=document.createElement('div');
      _chip.id='_macroChip';
      _chip.style.cssText='display:flex;align-items:center;gap:6px;background:var(--sand-lt);border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:12px;font-weight:600;white-space:nowrap;cursor:default';
      _chip.innerHTML='<span style="color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:1px">Setor</span> <span id="_macroChipName"></span> <button onclick="window._clearMacroFilter()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:16px;line-height:1;padding:0 0 0 4px" title="Limpar filtro">×</button>';
      _toolbar.appendChild(_chip);
    }
    var _cn=document.getElementById('_macroChipName');
    if (_cn) _cn.textContent=_activeMacroFilter;
  } else {
    if (_chip) _chip.remove();
  }

  var rows=db.filter(function(r){
    if(typeof userRole!=='undefined'&&userRole==='gestor'&&typeof userSetor!=='undefined'&&userSetor&&r.setor!==userSetor)return false;
    var l=getLic(r.licId);
    var txt=(r.nome+r.email+r.setor+(r.area||'')+r.cargo+l.name+l.short).toLowerCase();
    if(q&&txt.indexOf(q)<0)return false;
    if(fs&&r.setor!==fs)return false;
    if(!fs&&_activeMacroFilter&&resolveHierarchy(r).macro!==_activeMacroFilter)return false;
    if(fl&&r.licId!==fl)return false;
    if(!fl&&r.licId==='other')return false;
    if(fst&&r.status!==fst)return false;
    if(fc){var orig=r.cargoFixo?'override':(r.cargoOrigem||'ad');if(orig!==fc)return false;}
    if(cutoff&&r.dataISO&&new Date(r.dataISO)<cutoff)return false;
    return true;
  });
  if(sortField){
    rows.sort(function(a,b){
      var av=sortField==='custo'?(a.custo!=null?a.custo:userCost(a)):a[sortField];
      var bv=sortField==='custo'?(b.custo!=null?b.custo:userCost(b)):b[sortField];
      if(typeof av==='string')return sortAsc?av.localeCompare(bv):bv.localeCompare(av);
      return sortAsc?av-bv:bv-av;
    });
  }else{
    rows.sort(function(a,b){return(a.nome||'').localeCompare(b.nome||'');});
  }
  var total=rows.length;
  var effectivePer=PER===Infinity?total:PER;
  var pages=Math.max(1,Math.ceil(total/effectivePer));
  currentPage=Math.min(currentPage,pages);
  var slice=rows.slice((currentPage-1)*effectivePer,currentPage*effectivePer);
  var tbody=document.getElementById('tableBody');
  if(!slice.length){
    tbody.innerHTML='<tr class="empty-row"><td colspan="8">'+(typeof t==='function'?t('col.nenhum'):'Nenhum colaborador encontrado.')+'</td></tr>';
    document.getElementById('tableInfo').textContent='0 '+(typeof t==='function'?t('col.resultados'):'resultados');
    buildPagination('pagination',0,0,function(){});
    return;
  }
  tbody.innerHTML=slice.map(function(r){
    var c=r.custo!=null?r.custo:userCost(r);
    return'<tr onclick="openDetail('+r.id+')">'
      +'<td><div class="person-cell"><div class="avatar">'+ini(r.nome)+'</div>'
      +'<div><div class="person-name">'+r.nome+'</div><div class="person-email">'+r.email+'</div></div></div></td>'
      +'<td><span class="dept-tag">'+r.setor+'</span>'+(r.area?'<span style="font-size:10px;color:var(--muted);margin-left:4px">/ '+r.area+'</span>':'')+(r.subarea?'<span style="font-size:10px;color:var(--muted);margin-left:2px">/ '+r.subarea+'</span>':'')+(r.setorFixo?'<span class="setor-lock" title="Setor fixo — não sobrescrito na importação">🔒</span>':'')+'</td>'
      +'<td style="font-size:12px">'+cargoCell(r)+'</td>'
      +'<td>'+licBadge(r.licId)+(r.addons||[]).filter(function(a){return licById[a]&&licById[a].price>0;}).map(function(a){return' '+licBadge(a);}).join('')+'</td>'
      +'<td class="td-custo"><span class="cost-val">'+(c>0?fmtBRL(c):'—')+'</span>'+(c>0?'<span class="cost-per">/mês</span>':'')+'</td>'
      +'<td>'+statusBadge(r.status)+'</td>'
      +'<td class="date-cell">'+fmtDate(r.dataISO)+'</td>'
      +'<td style="white-space:nowrap">'+(canEdit()?'<button class="act-btn" onclick="event.stopPropagation();openOverrideModal('+r.id+')" title="Editar setor">✎</button> ':'')+'<button class="act-btn" onclick="event.stopPropagation();openDetail('+r.id+')">Ver</button></td>'
    +'</tr>';
  }).join('');
  var from=(currentPage-1)*effectivePer+1,to=Math.min(currentPage*effectivePer,total);
  document.getElementById('tableInfo').textContent=typeof t==='function'?t('col.mostrando',{from:from,to:to,total:total}):'Mostrando '+from+'–'+to+' de '+total;
  buildPagination('pagination',pages,currentPage,function(p){currentPage=p;renderTable();});
  if(_aside)_aside.scrollTop=_asideScroll;
}

/** Atualiza ícones de seta nos cabeçalhos de coluna ordenáveis */
function _updateSortHeaders(){
  ['custo','dataISO'].forEach(function(f){
    var sp=document.getElementById('sort-icon-'+f);
    if(!sp) return;
    if(sortField===f) sp.textContent=sortAsc?' ▲':' ▼';
    else sp.textContent=' ↕';
  });
}

/** Alterna ordenação por campo (toggle asc/desc) */
function sortBy(f){if(sortField===f)sortAsc=!sortAsc;else{sortField=f;sortAsc=true;}currentPage=1;renderTable();}

/** Gera botões de paginação com primeira/última página e total */
function buildPagination(id,pages,cur,cb){
  var pg=document.getElementById(id);
  if(!pg)return;
  pg.innerHTML='';
  var first=document.createElement('button');
  first.type='button';first.className='page-btn';first.textContent='«';first.disabled=(cur===1);
  first.onclick=function(){cb(1);};pg.appendChild(first);
  var start=Math.max(1,cur-2);var end=Math.min(pages,cur+2);
  for(var i=start;i<=end;i++){
    var b=document.createElement('button');b.type='button';b.className='page-btn'+(i===cur?' active':'');
    b.textContent=i;b.onclick=(function(p){return function(){cb(p);};})(i);pg.appendChild(b);
  }
  var last=document.createElement('button');
  last.type='button';last.className='page-btn';last.textContent='»';last.disabled=(cur===pages||pages===0);
  last.onclick=function(){cb(pages);};pg.appendChild(last);
  var info=document.createElement('span');
  info.className='page-info';info.textContent='Página '+cur+' de '+pages;
  pg.appendChild(info);
}

/* ══════════ IMPORTAÇÃO CSV RH ══════════ */

/** Abre o modal de resultado da importação */
function openRHModal(){
  var m=document.getElementById('rhImportModal');
  if(m){m.style.display='flex';}
}

/** Fecha o modal de resultado da importação */
function closeRHModal(){
  var m=document.getElementById('rhImportModal');
  if(m){m.style.display='none';}
  // Limpar o input para permitir reimportar o mesmo arquivo
  var inp=document.getElementById('rhCsvInput');
  if(inp) inp.value='';
}

/** Chamada quando usuário seleciona o arquivo CSV */
function uploadRHCsv(input){
  var file=input&&input.files&&input.files[0];
  if(!file) return;
  var syncAd=false; // Mudar para true para também atualizar o AD
  var formData=new FormData();
  formData.append('file', file);

  var body=document.getElementById('rhImportBody');
  if(body) body.innerHTML='<p style="color:var(--text-muted,#888)">Processando '+esc(file.name)+'...</p>';
  openRHModal();

  var url='/api/import/rh-csv'+(syncAd?'?sync_ad=true':'');
  fetch(url,{method:'POST',body:formData})
    .then(function(r){return r.json();})
    .then(function(res){_showRHImportResult(res, file.name);})
    .catch(function(err){
      if(body) body.innerHTML='<p style="color:#e55">Erro ao importar: '+esc(String(err))+'</p>';
    });
}

/** Renderiza o resultado da importação no modal */
function _showRHImportResult(res, filename){
  var body=document.getElementById('rhImportBody');
  if(!body) return;

  if(res.error){
    body.innerHTML='<p style="color:#e55">'+esc(res.error)+'</p>';
    return;
  }

  var html='';
  // Sumário
  html+='<div style="display:flex;gap:20px;margin-bottom:18px;flex-wrap:wrap">';
  html+='<div style="background:var(--bg,#141420);border-radius:8px;padding:12px 18px;min-width:110px"><div style="font-size:.75rem;color:var(--text-muted,#888);margin-bottom:4px">Total no CSV</div><div style="font-size:1.6rem;font-weight:700">'+res.total_csv+'</div></div>';
  html+='<div style="background:var(--bg,#141420);border-radius:8px;padding:12px 18px;min-width:110px"><div style="font-size:.75rem;color:var(--text-muted,#888);margin-bottom:4px">Atualizados</div><div style="font-size:1.6rem;font-weight:700;color:#4ade80">'+res.total_matched+'</div></div>';
  html+='<div style="background:var(--bg,#141420);border-radius:8px;padding:12px 18px;min-width:110px"><div style="font-size:.75rem;color:var(--text-muted,#888);margin-bottom:4px">Não encontrados</div><div style="font-size:1.6rem;font-weight:700;color:#fbbf24">'+res.total_unmatched+'</div></div>';
  html+='</div>';
  html+='<p style="font-size:.8rem;color:var(--text-muted,#888);margin:0 0 14px">Arquivo: <strong>'+esc(filename)+'</strong> &nbsp;|&nbsp; Os overrides fixos foram salvos e não serão sobrescritos pelo sync do AD.</p>';

  // Tabela de matched
  if(res.matched&&res.matched.length){
    html+='<details open><summary style="cursor:pointer;font-weight:600;margin-bottom:8px">Atualizados ('+res.matched.length+')</summary>';
    html+='<div style="overflow-x:auto"><table style="width:100%;font-size:.8rem;border-collapse:collapse">';
    html+='<thead><tr style="color:var(--text-muted,#888);border-bottom:1px solid var(--border,#2a2a3a)"><th style="text-align:left;padding:4px 8px">Nome</th><th style="text-align:left;padding:4px 8px">Email</th><th style="text-align:left;padding:4px 8px">Setor</th><th style="text-align:left;padding:4px 8px">Cargo</th>'+(res.ad_sync?'<th style="text-align:left;padding:4px 8px">AD</th>':'')+'</tr></thead><tbody>';
    res.matched.forEach(function(m){
      var adCell='';
      if(res.ad_sync){
        var adOk=m.ad&&m.ad.ok;
        adCell='<td style="padding:4px 8px"><span style="color:'+(adOk?'#4ade80':'#fbbf24')+'">'+(adOk?'OK':esc((m.ad&&m.ad.reason)||'—'))+'</span></td>';
      }
      html+='<tr style="border-bottom:1px solid var(--border,#2a2a3a)"><td style="padding:4px 8px">'+esc(m.nome||'')+'</td><td style="padding:4px 8px;color:var(--text-muted,#888)">'+esc(m.email||'')+'</td><td style="padding:4px 8px">'+esc(m.setor||'—')+'</td><td style="padding:4px 8px">'+esc(m.cargo||'—')+'</td>'+adCell+'</tr>';
    });
    html+='</tbody></table></div></details>';
  }

  // Tabela de unmatched
  if(res.unmatched&&res.unmatched.length){
    html+='<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:600;margin-bottom:8px;color:#fbbf24">Não encontrados ('+res.unmatched.length+')</summary>';
    html+='<div style="overflow-x:auto"><table style="width:100%;font-size:.8rem;border-collapse:collapse">';
    html+='<thead><tr style="color:var(--text-muted,#888);border-bottom:1px solid var(--border,#2a2a3a)"><th style="text-align:left;padding:4px 8px">Nome no CSV</th><th style="text-align:left;padding:4px 8px">Cargo CSV</th><th style="text-align:left;padding:4px 8px">Setor CSV</th><th style="text-align:left;padding:4px 8px">Motivo</th></tr></thead><tbody>';
    res.unmatched.forEach(function(u){
      html+='<tr style="border-bottom:1px solid var(--border,#2a2a3a)"><td style="padding:4px 8px">'+esc(u.nome_csv||'')+'</td><td style="padding:4px 8px">'+esc(u.cargo_csv||'—')+'</td><td style="padding:4px 8px">'+esc(u.setor_csv||'—')+'</td><td style="padding:4px 8px;color:#fbbf24">'+esc(u.motivo||'')+'</td></tr>';
    });
    html+='</tbody></table></div></details>';
  }

  // Botão de refresh
  html+='<div style="margin-top:18px;display:flex;gap:10px;justify-content:flex-end">';
  html+='<button class="btn btn-outline" onclick="closeRHModal()">Fechar</button>';
  html+='<button class="btn btn-primary" onclick="closeRHModal();if(typeof refresh===\'function\')refresh();">Atualizar tabela</button>';
  html+='</div>';

  body.innerHTML=html;
  // Atualizar a tabela em background
  if(res.total_matched>0 && typeof refresh==='function') refresh();
}
