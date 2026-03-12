/* ══════════ COLLABORATORS TABLE — Tabela principal de colaboradores ══════════ */

var _colabReq=0; // controle de request obsoleta
var _colabDebounce=null;

/** Dispara renderTable com debounce (para input de busca) */
function debouncedRender(){
  clearTimeout(_colabDebounce);
  _colabDebounce=setTimeout(function(){currentPage=1;renderTable();},300);
}

/** Altera quantidade de itens por página e re-renderiza */
function changePerPage(val){
  PER=val==='all'?9999:parseInt(val);
  currentPage=1;
  renderTable();
}

/** Renderiza tabela de colaboradores com paginação server-side */
function renderTable(){
  var q=document.getElementById('searchInput').value;
  var fs=document.getElementById('fltSetor').value;
  var fl=document.getElementById('fltLic').value;
  var fst=document.getElementById('fltStatus').value;
  var effectivePer=PER===Infinity?9999:PER;

  var params='page='+currentPage+'&per='+effectivePer;
  if(q)params+='&q='+encodeURIComponent(q);
  if(fs)params+='&setor='+encodeURIComponent(fs);
  if(fl)params+='&licId='+encodeURIComponent(fl);
  if(fst)params+='&status='+encodeURIComponent(fst);
  if(sortField){
    params+='&sort='+encodeURIComponent(sortField);
    params+='&order='+(sortAsc?'asc':'desc');
  }

  var reqId=++_colabReq;
  fetch('/api/colaboradores?'+params)
    .then(function(r){return r.json();})
    .then(function(data){
      if(reqId!==_colabReq)return; // resposta obsoleta
      var rows=data.rows||[];
      var total=data.total||0;
      var page=data.page||1;
      var pages=data.pages||1;
      currentPage=page;

      var tbody=document.getElementById('tableBody');
      if(!rows.length){
        tbody.innerHTML='<tr class="empty-row"><td colspan="8">Nenhum colaborador encontrado.</td></tr>';
        document.getElementById('tableInfo').textContent='0 resultados';
        buildPagination('pagination',0,0,function(){});
        return;
      }
      tbody.innerHTML=rows.map(function(r){
        var c=r.custo!=null?r.custo:userCost(r);
        return'<tr onclick="openDetail('+r.id+')">'
          +'<td><div class="person-cell"><div class="avatar">'+ini(r.nome)+'</div>'
          +'<div><div class="person-name">'+r.nome+'</div><div class="person-email">'+r.email+'</div></div></div></td>'
          +'<td><span class="dept-tag">'+r.setor+'</span>'+(r.area?'<span style="font-size:10px;color:var(--muted);margin-left:4px">/ '+r.area+'</span>':'')+(r.setorFixo?'<span class="setor-lock" title="Setor fixo — não sobrescrito na importação">🔒</span>':'')+'</td>'
          +'<td style="color:var(--muted);font-size:12px">'+r.cargo+(r.cargoFixo?'<span class="setor-lock" title="Cargo fixo — não sobrescrito na importação">🔒</span>':'')+'</td>'
          +'<td>'+licBadge(r.licId)+(r.addons||[]).filter(function(a){return licById[a]&&licById[a].price>0;}).map(function(a){return' '+licBadge(a);}).join('')+'</td>'
          +'<td><span class="cost-val">'+(c>0?fmtBRL(c):'—')+'</span>'+(c>0?'<span class="cost-per">/mês</span>':'')+'</td>'
          +'<td>'+statusBadge(r.status)+'</td>'
          +'<td class="date-cell">'+fmtDate(r.dataISO)+'</td>'
          +'<td style="white-space:nowrap">'+(canEdit()?'<button class="act-btn" onclick="event.stopPropagation();openOverrideModal('+r.id+')" title="Editar setor">✎</button> ':'')+'<button class="act-btn" onclick="event.stopPropagation();openDetail('+r.id+')">Ver</button></td>'
        +'</tr>';
      }).join('');

      var from=(page-1)*effectivePer+1;
      var to=Math.min(page*effectivePer,total);
      document.getElementById('tableInfo').textContent='Mostrando '+from+'–'+to+' de '+total;
      buildPagination('pagination',pages,page,function(p){currentPage=p;renderTable();});

      // Atualizar filtros com dados do servidor
      if(data.filters){
        _updateFiltersFromServer(data.filters, fs, fl);
      }
    })
    .catch(function(){
      // Fallback: se API falhar, usa dados locais
      _renderTableLocal();
    });
}

/** Atualiza selects de filtro com dados do servidor */
function _updateFiltersFromServer(filters, curSetor, curLic){
  _filtersFromServer=true;
  var ss=document.getElementById('fltSetor');
  if(filters.setores){
    var opts=filters.setores.sort();
    ss.innerHTML='<option value="">Todos os setores</option>'+opts.map(function(o){
      return'<option'+(o===curSetor?' selected':'')+'>'+o+'</option>';
    }).join('');
    document.getElementById('setorList').innerHTML=opts.map(function(o){return'<option value="'+o+'">';}).join('');
  }
  var ls=document.getElementById('fltLic');
  if(filters.licIds){
    var used=filters.licIds;
    if(used.indexOf('none')<0)used.push('none');
    ls.innerHTML='<option value="">Todas as licenças</option>'+LICENSES.filter(function(l){return used.indexOf(l.id)>=0;}).map(function(l){
      return'<option value="'+l.id+'"'+(l.id===curLic?' selected':'')+'>'+l.name+'</option>';
    }).join('');
  }
}

/** Fallback: renderiza tabela com dados locais (caso API falhe) */
function _renderTableLocal(){
  var q=document.getElementById('searchInput').value.toLowerCase();
  var fs=document.getElementById('fltSetor').value;
  var fl=document.getElementById('fltLic').value;
  var fst=document.getElementById('fltStatus').value;
  var rows=db.filter(function(r){
    var l=getLic(r.licId);
    var txt=(r.nome+r.email+r.setor+(r.area||'')+r.cargo+l.name+l.short).toLowerCase();
    return(!q||txt.indexOf(q)>=0)&&(!fs||r.setor===fs)&&(!fl||r.licId===fl)&&(!fst||r.status===fst);
  });
  if(sortField){
    rows.sort(function(a,b){
      var av=sortField==='custo'?userCost(a):a[sortField];
      var bv=sortField==='custo'?userCost(b):b[sortField];
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
  if(!slice.length){tbody.innerHTML='<tr class="empty-row"><td colspan="8">Nenhum colaborador encontrado.</td></tr>';return;}
  tbody.innerHTML=slice.map(function(r){
    var c=userCost(r);
    return'<tr onclick="openDetail('+r.id+')">'
      +'<td><div class="person-cell"><div class="avatar">'+ini(r.nome)+'</div>'
      +'<div><div class="person-name">'+r.nome+'</div><div class="person-email">'+r.email+'</div></div></div></td>'
      +'<td><span class="dept-tag">'+r.setor+'</span>'+(r.area?'<span style="font-size:10px;color:var(--muted);margin-left:4px">/ '+r.area+'</span>':'')+(r.setorFixo?'<span class="setor-lock" title="Setor fixo">🔒</span>':'')+'</td>'
      +'<td style="color:var(--muted);font-size:12px">'+r.cargo+(r.cargoFixo?'<span class="setor-lock" title="Cargo fixo">🔒</span>':'')+'</td>'
      +'<td>'+licBadge(r.licId)+(r.addons||[]).filter(function(a){return licById[a]&&licById[a].price>0;}).map(function(a){return' '+licBadge(a);}).join('')+'</td>'
      +'<td><span class="cost-val">'+(c>0?fmtBRL(c):'—')+'</span>'+(c>0?'<span class="cost-per">/mês</span>':'')+'</td>'
      +'<td>'+statusBadge(r.status)+'</td>'
      +'<td class="date-cell">'+fmtDate(r.dataISO)+'</td>'
      +'<td style="white-space:nowrap">'+(canEdit()?'<button class="act-btn" onclick="event.stopPropagation();openOverrideModal('+r.id+')" title="Editar setor">✎</button> ':'')+'<button class="act-btn" onclick="event.stopPropagation();openDetail('+r.id+')">Ver</button></td>'
    +'</tr>';
  }).join('');
  var from=(currentPage-1)*effectivePer+1,to=Math.min(currentPage*effectivePer,total);
  document.getElementById('tableInfo').textContent='Mostrando '+from+'–'+to+' de '+total;
  buildPagination('pagination',pages,currentPage,function(p){currentPage=p;renderTable();});
}

/** Alterna ordenação por campo (toggle asc/desc) */
function sortBy(f){if(sortField===f)sortAsc=!sortAsc;else{sortField=f;sortAsc=true;}currentPage=1;renderTable();}

/** Gera botões de paginação numérica */
function buildPagination(id,pages,cur,cb){
  var pg=document.getElementById(id);pg.innerHTML='';
  for(var i=1;i<=Math.min(pages,10);i++){
    var b=document.createElement('button');b.className='page-btn'+(i===cur?' active':'');
    b.textContent=i;b.onclick=(function(p){return function(){cb(p);};})(i);pg.appendChild(b);
  }
}
