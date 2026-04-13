/* ══════════ EXCHANGE D-7 — Relatório de uso de caixas de correio ══════════ */

var _exchangeData = null;
var _exchangeFilter = { topN: null, status: null, inactive: false, showArchive: false };
var _exchangeTopExpanded = false;
var _exchangeLastUpdated = null;
var _exchangeUpdateTimer = null;

function refreshExchange() {
  _exchangeData = null;
  _exchangeLastUpdated = new Date();
  clearTimeout(_exchangeUpdateTimer);
  var el = document.getElementById('exchangeLastUpdated');
  if(el) el.textContent = 'Agora mesmo';
  renderExchangeView();
  _exchangeUpdateTimer = setTimeout(_updateExchangeLastUpdated, 60000);
}

function _updateExchangeLastUpdated() {
  if(!_exchangeLastUpdated || document.hidden) return;
  var mins = Math.floor((new Date() - _exchangeLastUpdated) / 60000);
  var el = document.getElementById('exchangeLastUpdated');
  if(el) {
    el.textContent = mins < 1 ? 'Agora mesmo' : 'Atualizado há ' + mins + ' min';
    _exchangeUpdateTimer = setTimeout(_updateExchangeLastUpdated, 60000);
  }
}

function renderExchangeView(){
  var tblEl = document.getElementById('exchangeTable');
  if(!tblEl) return;

  if(_exchangeData){
    _renderExchangeContent(tblEl, _exchangeData);
    return;
  }

  tblEl.innerHTML = loadingHTML('Carregando dados do Exchange...');

  fetchWithTimeout('/api/reports/exchange').then(function(r){ return r.json(); }).then(function(res){
    if(res.error){
      tblEl.innerHTML = errorHTML('refreshExchange', res.error);
      return;
    }
    _exchangeData = res.data || [];
    _renderExchangeContent(tblEl, _exchangeData);
  }).catch(function(){
    tblEl.innerHTML = errorHTML('refreshExchange');
  });
}

function _exchangeApplyFilter(data){
  var result = data.slice().sort(function(a, b){ return (b.quotaPct||0) - (a.quotaPct||0); });
  if(_exchangeFilter.showArchive){
    result = result.filter(function(r){ return r.hasArchive; });
  }
  if(_exchangeFilter.inactive){
    result = result.filter(function(r){ return !r.lastActivity; });
  }
  if(_exchangeFilter.status){
    result = result.filter(function(r){ return (r.quotaStatus||'Normal') === _exchangeFilter.status; });
  }
  if(_exchangeFilter.topN){
    result = result.slice(0, _exchangeFilter.topN);
  }
  return result;
}

function _exchangeSetTopN(n){
  _exchangeFilter.topN = n;
  _exchangeRebuild();
}

function _exchangeSetStatus(s){
  _exchangeFilter.status = (_exchangeFilter.status === s) ? null : s;
  _exchangeRebuild();
}

function _exchangeSetInactive(){
  _exchangeFilter.inactive = !_exchangeFilter.inactive;
  _exchangeRebuild();
}

function _exchangeSetShowArchive(){
  _exchangeFilter.showArchive = !_exchangeFilter.showArchive;
  _exchangeRebuild();
}

function _exchangeToggleTop(){
  _exchangeTopExpanded = !_exchangeTopExpanded;
  var topEl = document.getElementById('exchangeTop');
  if(topEl && _exchangeData) _renderExchangeTop(topEl, _exchangeData);
}

function _exchangeRebuild(){
  if(!_exchangeData) return;
  var filtersEl = document.getElementById('exchangeFilters');
  var tblEl = document.getElementById('exchangeTable');
  if(filtersEl) _renderExchangeFilterBar(filtersEl, _exchangeData);
  if(tblEl) _renderExchangeTable(tblEl, _exchangeData);
}

function _renderExchangeFilterBar(el, data){
  var topNs = [10, 15, 20];
  var statuses = [{key:'Crítico', label:'Crítico'}, {key:'Warning', label:'Atenção'}, {key:'Normal', label:'Normal'}];
  var allClear = _exchangeFilter.topN===null && _exchangeFilter.status===null && !_exchangeFilter.inactive && !_exchangeFilter.showArchive;

  var inactive = 0, archiveTotalMB = 0, archiveCount = 0;
  if(data) data.forEach(function(r){
    archiveTotalMB += r.archiveMB || 0;
    if(!r.lastActivity) inactive++;
    if(r.hasArchive) archiveCount++;
  });

  var inactiveLabel = 'Sem Atividade' + (data ? ' ('+inactive+')' : '');
  var archiveLabel = 'Arquivo Morto' + (archiveCount > 0 ? ' ('+archiveCount+')' : '');

  var html = '<div class="exch-filter-bar">';
  html += '<div class="exch-filter-group">';
  html += '<button class="exch-filter-btn'+(allClear?' active':'')+'" onclick="_exchangeFilter.topN=null;_exchangeFilter.status=null;_exchangeFilter.inactive=false;_exchangeFilter.showArchive=false;_exchangeRebuild()">Todos</button>';
  topNs.forEach(function(n){
    html += '<button class="exch-filter-btn'+(_exchangeFilter.topN===n?' active':'')+'" onclick="_exchangeSetTopN('+n+')">Top '+n+'</button>';
  });
  html += '</div>';
  html += '<div class="exch-filter-group">';
  statuses.forEach(function(s){
    html += '<button class="exch-filter-btn'+(_exchangeFilter.status===s.key?' active':'')+'" onclick="_exchangeFilter.topN=null;_exchangeSetStatus(\''+s.key+'\')">'+s.label+'</button>';
  });
  html += '</div>';
  html += '<div class="exch-filter-group">';
  html += '<button class="exch-filter-btn exch-filter-inactive'+(_exchangeFilter.inactive?' active':'')+'" onclick="_exchangeSetInactive()">'+inactiveLabel+'</button>';
  html += '</div>';
  html += '<div class="exch-filter-group">';
  html += '<button class="exch-filter-btn exch-filter-archive'+(_exchangeFilter.showArchive?' active':'')+'" onclick="_exchangeSetShowArchive()">'+archiveLabel+'</button>';
  html += '</div>';
  html += '</div>';
  el.innerHTML = html;
}

function _renderExchangeTable(tblEl, data){
  var columns = [
    {label:'Usuário', key:'displayName', render: function(r){
      return '<div class="person-cell"><div class="avatar">'+ini(r.displayName||'?')+'</div><div><div class="person-name">'+esc(r.displayName||'—')+'</div><div class="person-email">'+esc(r.email||'')+'</div></div></div>';
    }, sortValue: function(r){ return (r.displayName||'').toLowerCase(); }},
    {label:'Armazenamento', key:'storageMB', render: function(r){ return '<span class="cost-val">'+ReportTable.fmtMB(r.storageMB)+'</span>'; }, sortValue: function(r){ return r.storageMB||0; }},
  ];

  if(_exchangeFilter.showArchive){
    columns.push({label:'Arquivo Morto', key:'hasArchive', render: function(r){
      if(!r.hasArchive) return '<span style="color:var(--muted);font-size:12px">—</span>';
      if(r.archiveMB) return '<div style="display:flex;flex-direction:column;gap:1px">'
        +'<span class="cost-val">'+ReportTable.fmtMB(r.archiveMB)+'</span>'
        +'<span style="font-size:11px;color:var(--muted)">'+(r.archiveItemCount||0)+' itens</span>'
        +'</div>';
      return '<span class="badge b-pending"><span class="badge-dot"></span>Vazio</span>';
    }, sortValue: function(r){ return r.hasArchive ? 1 : 0; }});
  }

  columns.push(
    {label:'Itens', key:'itemCount', sortValue: function(r){ return r.itemCount||0; }},
    {label:'Última Atividade', key:'lastActivity', render: function(r){ return '<span class="date-cell">'+(r.lastActivity ? fmtDate(r.lastActivity) : '<em style="color:var(--red)">Sem atividade</em>')+'</span>'; }},
    {label:'Cota Usada', key:'quotaPct', render: function(r){
      var pct = r.quotaPct || 0;
      var color = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--yellow)' : 'var(--green)';
      return '<div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:6px;background:var(--sand-lt);border-radius:3px;overflow:hidden"><div style="width:'+Math.min(pct,100)+'%;height:100%;background:'+color+';border-radius:3px"></div></div><span style="font-size:12px;font-weight:700;color:'+color+'">'+pct.toFixed(0)+'%</span></div>';
    }, sortValue: function(r){ return r.quotaPct||0; }},
    {label:'Status Cota', key:'quotaStatus', render: function(r){
      var s = r.quotaStatus || 'Normal';
      var cls = s === 'Normal' ? 'b-active' : s === 'Warning' ? 'b-pending' : 'b-danger';
      var label = s === 'Warning' ? 'Atenção' : (s === 'Prohibited' || s === 'Crítico') ? 'Crítico' : 'Normal';
      return '<span class="badge '+cls+'"><span class="badge-dot"></span>'+esc(label)+'</span>';
    }}
  );

  var filtered = _exchangeApplyFilter(data);
  ReportTable.build('exchangeTable', columns, filtered, {
    perPage: 20,
    exportName: 'exchange-d7',
    emptyMessage: 'Nenhum dado de mailbox encontrado. Execute uma sincronização na tela Config.',
    onRowClick: function(r){ openDetailByEmail(r.email); }
  });
}

function _renderExchangeTop(el, data){
  var sorted = data.slice().sort(function(a,b){ return (b.storageMB||0) - (a.storageMB||0); });
  var total = Math.min(15, sorted.length);
  var showCount = _exchangeTopExpanded ? total : Math.min(5, total);
  var top = sorted.slice(0, showCount);
  if(!top.length){ el.innerHTML = ''; return; }

  var totalMB = 0;
  data.forEach(function(r){ totalMB += r.storageMB || 0; });
  var avgMB = data.length ? totalMB / data.length : 0;

  var maxMB = sorted[0].storageMB || 1;
  var rankClass = function(i){ return i===0?'rank-gold':i===1?'rank-silver':i===2?'rank-bronze':'rank-other'; };
  var barColor = function(pct){ return pct>=90?'var(--red)':pct>=70?'var(--yellow)':'var(--green)'; };

  var rows = top.map(function(r, i){
    var pct = r.quotaPct || 0;
    var barW = Math.round((r.storageMB||0) / maxMB * 100);
    return '<div class="exch-top-row '+rankClass(i)+'" style="cursor:pointer" onclick="openDetailByEmail(\''+escAttr(r.email||'')+'\')">'
      +'<div class="exch-rank-badge">'
        +'<div class="exch-top-avatar">'+ini(r.displayName||'?')+'</div>'
        +'<span class="exch-rank-num">'+(i+1)+'</span>'
      +'</div>'
      +'<div class="exch-top-uinfo">'
        +'<div class="exch-top-name-row">'
          +'<span class="exch-top-name" title="'+esc(r.displayName||'').replace(/"/g,'&quot;')+'">'+esc(r.displayName||'—')+'</span>'
          +'<span class="exch-top-storage">'+ReportTable.fmtMB(r.storageMB)+'</span>'
        +'</div>'
        +'<div class="exch-top-bar-wrap">'
          +'<div class="exch-top-bar"><div class="exch-top-bar-fill" style="width:'+barW+'%;background:'+barColor(pct)+'"></div></div>'
          +'<span class="exch-top-pct">'+pct.toFixed(0)+'%</span>'
        +'</div>'
      +'</div>'
      +'</div>';
  }).join('');

  var toggleBtn = total > 5
    ? '<button class="exch-top-toggle" onclick="_exchangeToggleTop()">'
      + (_exchangeTopExpanded ? 'Ver menos ↑' : 'Ver todos '+total+' →')
      + '</button>'
    : '';

  var summaryBar = '<div class="exch-summary-bar">'
    +'<span class="exch-summary-item">'+data.length+' caixas</span>'
    +'<span class="exch-summary-dot">·</span>'
    +'<span class="exch-summary-item">'+ReportTable.fmtMB(totalMB)+'</span>'
    +'<span class="exch-summary-dot">·</span>'
    +'<span class="exch-summary-item">'+ReportTable.fmtMB(avgMB)+'/usr</span>'
    +'</div>';

  el.innerHTML = '<div class="exch-top-section">'
    +'<div class="exch-top-header"><span class="exch-top-title">Top '+showCount+' Armazenamento</span>'+toggleBtn+'</div>'
    +summaryBar
    +'<div class="exch-top-rows">'+rows+'</div>'
    +'</div>';
}

function _renderExchangeContent(tblEl, data){
  var topEl = document.getElementById('exchangeTop');
  if(topEl) _renderExchangeTop(topEl, data);

  var filtersEl = document.getElementById('exchangeFilters');
  if(filtersEl) _renderExchangeFilterBar(filtersEl, data);

  _renderExchangeTable(tblEl, data);
}
