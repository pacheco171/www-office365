/* ══════════ APLICATIVOS — Registros de Aplicativo + Entidades de Serviço ══════════ */

var _appsRegData = null;
var _appsSPData = null;

function renderAplicativosView(){
  _loadAppsRegistrations();
  _loadAppsServicePrincipals();
}

function _loadAppsRegistrations(){
  var kpiEl = document.getElementById('appsRegKpis');
  var tblEl = document.getElementById('appsRegTable');
  if(!kpiEl || !tblEl) return;

  if(_appsRegData){
    _renderAppsRegContent(kpiEl, tblEl, _appsRegData);
    return;
  }

  kpiEl.innerHTML = ReportTable.kpiCards([{label:'Total Apps', value:'...'},{label:'Proprietários', value:'...'},{label:'Externos', value:'...'},{label:'Multi-Locatário', value:'...'}]);
  tblEl.innerHTML = loadingHTML('Carregando aplicativos...');

  fetchWithTimeout('/api/reports/applications').then(function(r){ return r.json(); }).then(function(res){
    if(res.error){ tblEl.innerHTML = errorHTML('renderAplicativosView', res.error); return; }
    _appsRegData = res.data || [];
    _renderAppsRegContent(kpiEl, tblEl, _appsRegData);
  }).catch(function(){
    tblEl.innerHTML = errorHTML('renderAplicativosView');
  });
}

function _renderAppsRegContent(kpiEl, tblEl, data){
  var multiTenant = 0;
  data.forEach(function(a){ if(a.signInAudience && a.signInAudience.indexOf('Multi') >= 0) multiTenant++; });

  kpiEl.innerHTML = ReportTable.kpiCards([
    {label:'Total Apps', value: data.length},
    {label:'Locatário Único', value: data.length - multiTenant},
    {label:'Multi-Locatário', value: multiTenant},
    {label:'Registros', value: data.length}
  ]);

  var columns = [
    {label:'Nome', key:'displayName', render: function(r){
      return '<div style="font-weight:700;font-size:13px">'+esc(r.displayName||'—')+'</div>';
    }, sortValue: function(r){ return (r.displayName||'').toLowerCase(); }},
    {label:'ID do App', key:'appId', render: function(r){
      return '<span style="font-size:11px;color:var(--muted);font-family:monospace">'+esc(r.appId||'—')+'</span>';
    }},
    {label:'Público-alvo', key:'signInAudience', render: function(r){
      var s = r.signInAudience || '—';
      var short = s.replace('AzureADMyOrg','Locatário Único').replace('AzureADMultipleOrgs','Multi-Locatário').replace('AzureADandPersonalMicrosoftAccount','Multi + Pessoal');
      return '<span class="dept-tag">'+esc(short)+'</span>';
    }},
    {label:'Criado em', key:'createdDateTime', render: function(r){
      return '<span class="date-cell">'+(r.createdDateTime ? fmtDate(r.createdDateTime.split('T')[0]) : '—')+'</span>';
    }}
  ];

  ReportTable.build('appsRegTable', columns, data, {
    perPage: 20, exportName: 'registros-aplicativos',
    emptyMessage: 'Nenhum registro de aplicativo encontrado. Verifique a permissão Application.Read.All.'
  });
}

function _loadAppsServicePrincipals(){
  var kpiEl = document.getElementById('appsSPKpis');
  var tblEl = document.getElementById('appsSPTable');
  if(!kpiEl || !tblEl) return;

  if(_appsSPData){
    _renderAppsSPContent(kpiEl, tblEl, _appsSPData);
    return;
  }

  kpiEl.innerHTML = ReportTable.kpiCards([{label:'Total', value:'...'},{label:'Proprietários (MS)', value:'...'},{label:'Terceiros', value:'...'},{label:'Desabilitados', value:'...'}]);
  tblEl.innerHTML = loadingHTML('Carregando entidades de serviço...');

  fetchWithTimeout('/api/reports/service-principals').then(function(r){ return r.json(); }).then(function(res){
    if(res.error){ tblEl.innerHTML = errorHTML('renderAplicativosView', res.error); return; }
    _appsSPData = res.data || [];
    _renderAppsSPContent(kpiEl, tblEl, _appsSPData);
  }).catch(function(){
    tblEl.innerHTML = errorHTML('renderAplicativosView');
  });
}

function _renderAppsSPContent(kpiEl, tblEl, data){
  var firstParty = 0, thirdParty = 0, disabled = 0;
  var msId = 'f8cdef31-a31e-4b4a-93e4-5f571e91255a';
  data.forEach(function(a){
    if(!a.accountEnabled) disabled++;
    if(a.appOwnerOrgId === msId) firstParty++; else thirdParty++;
  });

  kpiEl.innerHTML = ReportTable.kpiCards([
    {label:'Total', value: data.length},
    {label:'Proprietários (MS)', value: firstParty},
    {label:'Terceiros', value: thirdParty},
    {label:'Desabilitados', value: disabled}
  ]);

  var columns = [
    {label:'Nome', key:'displayName', render: function(r){
      var color = r.accountEnabled ? '' : 'opacity:0.5;';
      return '<div style="font-weight:700;font-size:13px;'+color+'">'+esc(r.displayName||'—')+'</div>';
    }, sortValue: function(r){ return (r.displayName||'').toLowerCase(); }},
    {label:'Tipo', key:'type', render: function(r){
      var is1st = r.appOwnerOrgId === msId;
      return is1st ? '<span class="lic-badge lic-f3">Microsoft</span>' : '<span class="lic-badge lic-bstd">Terceiro</span>';
    }},
    {label:'Tipo Entidade', key:'spType', render: function(r){
      var t = (r.spType||'Application').replace('Application','Aplicativo').replace('ManagedIdentity','Identidade Gerenciada').replace('Legacy','Legado');
      return '<span class="dept-tag">'+esc(t)+'</span>';
    }},
    {label:'Status', key:'accountEnabled', render: function(r){
      return r.accountEnabled ? '<span class="badge b-active">Ativo</span>' : '<span class="badge b-inactive">Desabilitado</span>';
    }},
    {label:'Criado em', key:'createdDateTime', render: function(r){
      return '<span class="date-cell">'+(r.createdDateTime ? fmtDate(r.createdDateTime.split('T')[0]) : '—')+'</span>';
    }}
  ];

  ReportTable.build('appsSPTable', columns, data, {
    perPage: 20, exportName: 'entidades-servico',
    emptyMessage: 'Nenhuma entidade de serviço encontrada.'
  });
}
