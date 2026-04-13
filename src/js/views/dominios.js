/* ══════════ DOMÍNIOS — Relatório de domínios verificados ══════════ */

var _dominiosData = null;

function renderDominiosView(){
  var kpiEl = document.getElementById('dominiosKpis');
  var tblEl = document.getElementById('dominiosTable');
  if(!kpiEl || !tblEl) return;

  if(_dominiosData){
    _renderDominiosContent(kpiEl, tblEl, _dominiosData);
    return;
  }

  kpiEl.innerHTML = ReportTable.kpiCards([
    {label:'Total Domínios', value:'...'},
    {label:'Verificados', value:'...'},
    {label:'Default', value:'...'},
    {label:'Federados', value:'...'}
  ]);
  tblEl.innerHTML = loadingHTML('Carregando domínios...');

  fetchWithTimeout('/api/reports/domains').then(function(r){ return r.json(); }).then(function(res){
    if(res.error){
      tblEl.innerHTML = errorHTML('renderDominiosView', res.error);
      return;
    }
    _dominiosData = res.data || [];
    _renderDominiosContent(kpiEl, tblEl, _dominiosData);
  }).catch(function(){
    tblEl.innerHTML = errorHTML('renderDominiosView');
  });
}

function _renderDominiosContent(kpiEl, tblEl, data){
  var verified = 0, defaultD = 0, federated = 0;
  data.forEach(function(d){
    if(d.isVerified) verified++;
    if(d.isDefault) defaultD++;
    if(d.authType === 'Federated') federated++;
  });

  kpiEl.innerHTML = ReportTable.kpiCards([
    {label:'Total Domínios', value: data.length},
    {label:'Verificados', value: verified},
    {label:'Default', value: defaultD},
    {label:'Federados', value: federated}
  ]);

  var columns = [
    {label:'Domínio', key:'id', render: function(r){
      return '<span style="font-weight:700;font-size:14px">'+esc(r.id)+'</span>'+(r.isDefault ? ' <span class="badge b-active" style="margin-left:6px">Default</span>' : '');
    }, sortValue: function(r){ return r.id; }},
    {label:'Tipo', key:'authType', render: function(r){
      var cls = r.authType === 'Federated' ? 'b-pending' : 'b-active';
      var label = r.authType === 'Federated' ? 'Federado' : 'Gerenciado';
      return '<span class="badge '+cls+'">'+esc(label)+'</span>';
    }},
    {label:'Verificado', key:'isVerified', render: function(r){
      return r.isVerified ? '<span class="badge b-active">Verificado</span>' : '<span class="badge b-inactive">Pendente</span>';
    }},
    {label:'Serviços Suportados', key:'services', render: function(r){
      return (r.services || []).map(function(s){
        return '<span class="dept-tag" style="margin:2px">'+esc(s)+'</span>';
      }).join(' ') || '<span style="color:var(--muted)">—</span>';
    }, sortable: false}
  ];

  ReportTable.build('dominiosTable', columns, data, {
    perPage: 50,
    exportName: 'dominios',
    emptyMessage: 'Nenhum domínio encontrado.'
  });
}
