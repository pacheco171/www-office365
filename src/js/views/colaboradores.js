/* ══════════ COLLABORATORS TABLE — Tabela principal de colaboradores ══════════ */

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
  var _aside=document.querySelector('aside');
  var _asideScroll=_aside?_aside.scrollTop:0;
  var q=document.getElementById('searchInput').value.toLowerCase();
  var fs=document.getElementById('fltSetor').value;
  var fl=document.getElementById('fltLic').value;
  var fst=document.getElementById('fltStatus').value;
  var fc=document.getElementById('fltCargo')?document.getElementById('fltCargo').value:'';
  var fp=document.getElementById('fltPeriodo')?document.getElementById('fltPeriodo').value:'';
  var cutoff=fp?new Date(new Date().setDate(new Date().getDate()-parseInt(fp))):null;
  var rows=db.filter(function(r){
    var l=getLic(r.licId);
    var txt=(r.nome+r.email+r.setor+(r.area||'')+r.cargo+l.name+l.short).toLowerCase();
    if(q&&txt.indexOf(q)<0)return false;
    if(fs&&r.setor!==fs)return false;
    if(fl&&r.licId!==fl)return false;
    if(!fl&&(r.licId==='none'||r.licId==='other'))return false;
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
      +'<td><span class="cost-val">'+(c>0?fmtBRL(c):'—')+'</span>'+(c>0?'<span class="cost-per">/mês</span>':'')+'</td>'
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
