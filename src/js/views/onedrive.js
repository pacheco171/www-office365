/* ══════════ ONEDRIVE D-7 — Relatório de uso de armazenamento ══════════ */

var _onedriveData = null;

function renderOnedriveView(){
  var kpiEl = document.getElementById('onedriveKpis');
  var tblEl = document.getElementById('onedriveTable');
  if(!kpiEl || !tblEl) return;

  if(_onedriveData){
    _renderOnedriveContent(kpiEl, tblEl, _onedriveData);
    return;
  }

  kpiEl.innerHTML = ReportTable.kpiCards([
    {label:'Total Contas', value:'...'},
    {label:'Armazenamento Total', value:'...'},
    {label:'Média / Usuário', value:'...'},
    {label:'Sem Atividade (7d)', value:'...'}
  ]);
  tblEl.innerHTML = loadingHTML('Carregando dados do OneDrive...');

  fetchWithTimeout('/api/reports/onedrive', 90000).then(function(r){ return r.json(); }).then(function(res){
    if(res.error){
      tblEl.innerHTML = errorHTML('renderOnedriveView', res.error);
      return;
    }
    _onedriveData = res.data || [];
    _renderOnedriveContent(kpiEl, tblEl, _onedriveData);
  }).catch(function(){
    tblEl.innerHTML = errorHTML('renderOnedriveView');
  });
}

function _renderOnedriveContent(kpiEl, tblEl, data){
  var totalMB = 0, inactive = 0, totalFiles = 0;
  data.forEach(function(r){
    totalMB += r.storageMB || 0;
    totalFiles += r.fileCount || 0;
    if(!r.lastActivity) inactive++;
  });
  var avgMB = data.length ? totalMB / data.length : 0;

  kpiEl.innerHTML = ReportTable.kpiCards([
    {label:'Total Contas', value: data.length},
    {label:'Armazenamento Total', value: ReportTable.fmtMB(totalMB)},
    {label:'Média / Usuário', value: ReportTable.fmtMB(avgMB)},
    {label:'Sem Atividade (7d)', value: inactive, sub: data.length ? Math.round(inactive/data.length*100)+'%' : ''}
  ]);

  var columns = [
    {label:'Usuário', key:'displayName', render: function(r){
      return '<div class="person-cell"><div class="avatar">'+ini(r.displayName||'?')+'</div><div><div class="person-name">'+esc(r.displayName||'—')+'</div><div class="person-email">'+esc(r.email||'')+'</div></div></div>';
    }, sortValue: function(r){ return (r.displayName||'').toLowerCase(); }},
    {label:'Armazenamento', key:'storageMB', render: function(r){ return '<span class="cost-val">'+ReportTable.fmtMB(r.storageMB)+'</span>'; }, sortValue: function(r){ return r.storageMB||0; }},
    {label:'Arquivos', key:'fileCount', sortValue: function(r){ return r.fileCount||0; }},
    {label:'Arquivos Ativos', key:'activeFileCount', sortValue: function(r){ return r.activeFileCount||0; }},
    {label:'Última Atividade', key:'lastActivity', render: function(r){ return '<span class="date-cell">'+(r.lastActivity ? fmtDate(r.lastActivity) : '<em style="color:var(--red)">Sem atividade</em>')+'</span>'; }},
    {label:'Link', key:'siteUrl', render: function(r){
      if(!r.siteUrl) return '<span style="color:var(--muted)">—</span>';
      return '<a href="'+esc(r.siteUrl)+'" target="_blank" rel="noopener" style="color:var(--brown);font-size:11px;text-decoration:underline" onclick="event.stopPropagation()">Acessar</a>';
    }, sortable: false}
  ];

  ReportTable.build('onedriveTable', columns, data, {
    perPage: 20,
    exportName: 'onedrive-d7',
    emptyMessage: 'Nenhum dado de OneDrive encontrado. Execute uma sincronização na tela Config.',
    onRowClick: function(r){ openDetailByEmail(r.email); }
  });
}
