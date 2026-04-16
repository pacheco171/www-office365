/* ══════════ POLÍTICAS DE ACESSO — Conditional Access Policies ══════════ */

var _politicasData = null;
var _politicasLastUpdated = null;
var _politicasUpdateTimer = null;

function refreshPoliticas() {
  sessionStorage.removeItem('vc_politicas');
  _politicasData = null;
  _politicasLastUpdated = new Date();
  clearTimeout(_politicasUpdateTimer);
  var el = document.getElementById('politicasLastUpdated');
  if(el) el.textContent = 'Agora mesmo';
  renderPoliticasView();
  _politicasUpdateTimer = setTimeout(_updatePoliticasLastUpdated, 60000);
}

function _updatePoliticasLastUpdated() {
  if(!_politicasLastUpdated || document.hidden) return;
  var mins = Math.floor((new Date() - _politicasLastUpdated) / 60000);
  var el = document.getElementById('politicasLastUpdated');
  if(el) {
    el.textContent = mins < 1 ? 'Agora mesmo' : 'Atualizado há ' + mins + ' min';
    _politicasUpdateTimer = setTimeout(_updatePoliticasLastUpdated, 60000);
  }
}

function renderPoliticasView(){
  var kpiEl = document.getElementById('politicasKpis');
  var tblEl = document.getElementById('politicasTable');
  if(!kpiEl || !tblEl) return;

  if(!_politicasData){try{var _c=JSON.parse(sessionStorage.getItem('vc_politicas'));if(_c)_politicasData=_c;}catch(e){}}
  if(_politicasData){
    _renderPoliticasContent(kpiEl, tblEl, _politicasData);
    return;
  }

  kpiEl.innerHTML = ReportTable.kpiCards([{label:'Total Políticas', value:'...'},{label:'Ativas', value:'...'},{label:'Desativadas', value:'...'},{label:'Somente Relatório', value:'...'}]);
  tblEl.innerHTML = loadingHTML('Carregando políticas...');

  fetchWithTimeout('/api/reports/policies').then(function(r){ return r.json(); }).then(function(res){
    if(res.error){ tblEl.innerHTML = errorHTML('refreshPoliticas', res.error); return; }
    _politicasData = res.data || [];
    try{sessionStorage.setItem('vc_politicas',JSON.stringify(_politicasData));}catch(e){}
    _renderPoliticasContent(kpiEl, tblEl, _politicasData);
  }).catch(function(){
    tblEl.innerHTML = errorHTML('refreshPoliticas');
  });
}

function _renderPoliticasContent(kpiEl, tblEl, data){
  var enabled = 0, disabled = 0, reportOnly = 0;
  data.forEach(function(p){
    if(p.state === 'enabled') enabled++;
    else if(p.state === 'disabled') disabled++;
    else if(p.state === 'enabledForReportingButNotEnforced') reportOnly++;
  });

  kpiEl.innerHTML = ReportTable.kpiCards([
    {label:'Total Políticas', value: data.length},
    {label:'Ativas', value: enabled},
    {label:'Desativadas', value: disabled},
    {label:'Somente Relatório', value: reportOnly}
  ]);

  var columns = [
    {label:'Nome', key:'displayName', render: function(r){
      return '<div style="font-weight:700;font-size:13px">'+esc(r.displayName||'—')+'</div>';
    }, sortValue: function(r){ return (r.displayName||'').toLowerCase(); }},
    {label:'Estado', key:'state', render: function(r){
      var s = r.state || 'disabled';
      if(s === 'enabled') return '<span class="badge b-active">Ativa</span>';
      if(s === 'enabledForReportingButNotEnforced') return '<span class="badge b-pending">Somente Relatório</span>';
      return '<span class="badge b-inactive">Desativada</span>';
    }},
    {label:'Usuários', key:'userScope', render: function(r){
      var scope = r.userScope || 'Todos';
      return '<span class="dept-tag">'+esc(scope)+'</span>';
    }},
    {label:'Aplicativos', key:'appScope', render: function(r){
      var scope = r.appScope || 'Todos';
      return '<span class="dept-tag">'+esc(scope)+'</span>';
    }},
    {label:'Controles', key:'grantControls', render: function(r){
      return (r.grantControls || []).map(function(c){
        return '<span class="dept-tag" style="margin:2px">'+esc(c)+'</span>';
      }).join(' ') || '<span style="color:var(--muted)">—</span>';
    }, sortable: false},
    {label:'Condições', key:'conditions', render: function(r){
      var conds = r.conditions || [];
      return conds.length ? conds.map(function(c){ return '<span class="dept-tag" style="margin:2px;font-size:10px">'+esc(c)+'</span>'; }).join(' ') : '<span style="color:var(--muted)">—</span>';
    }, sortable: false}
  ];

  ReportTable.build('politicasTable', columns, data, {
    perPage: 20, exportName: 'politicas-acesso',
    emptyMessage: 'Nenhuma política encontrada. Verifique a permissão Policy.Read.All.'
  });
}
