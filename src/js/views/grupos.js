/* ══════════ GRUPOS — Relatório de grupos M365 / Azure AD ══════════ */

var _gruposData = null;
var _gruposLastUpdated = null;
var _gruposUpdateTimer = null;

function refreshGrupos() {
  _gruposData = null;
  _gruposLastUpdated = new Date();
  clearTimeout(_gruposUpdateTimer);
  var el = document.getElementById('gruposLastUpdated');
  if(el) el.textContent = 'Agora mesmo';
  renderGruposView();
  _gruposUpdateTimer = setTimeout(_updateGruposLastUpdated, 60000);
}

function _updateGruposLastUpdated() {
  if(!_gruposLastUpdated || document.hidden) return;
  var mins = Math.floor((new Date() - _gruposLastUpdated) / 60000);
  var el = document.getElementById('gruposLastUpdated');
  if(el) {
    el.textContent = mins < 1 ? 'Agora mesmo' : 'Atualizado há ' + mins + ' min';
    _gruposUpdateTimer = setTimeout(_updateGruposLastUpdated, 60000);
  }
}

function renderGruposView(){
  var kpiEl = document.getElementById('gruposKpis');
  var tblEl = document.getElementById('gruposTable');
  if(!kpiEl || !tblEl) return;

  if(_gruposData){
    _renderGruposContent(kpiEl, tblEl, _gruposData);
    return;
  }

  kpiEl.innerHTML = ReportTable.kpiCards([
    {label:'Total Grupos', value:'...'},
    {label:'Microsoft 365', value:'...'},
    {label:'Segurança', value:'...'},
    {label:'Distribuição', value:'...'}
  ]);
  tblEl.innerHTML = loadingHTML('Carregando grupos...');

  fetchWithTimeout('/api/reports/groups').then(function(r){ return r.json(); }).then(function(res){
    if(res.error){
      tblEl.innerHTML = errorHTML('refreshGrupos', res.error);
      return;
    }
    _gruposData = res.data || [];
    _renderGruposContent(kpiEl, tblEl, _gruposData);
  }).catch(function(){
    tblEl.innerHTML = errorHTML('refreshGrupos');
  });
}

function _grupoType(g){
  if((g.groupTypes||[]).indexOf('Unified') >= 0) return 'Microsoft 365';
  if(g.securityEnabled && !g.mailEnabled) return 'Segurança';
  if(!g.securityEnabled && g.mailEnabled) return 'Distribuição';
  if(g.securityEnabled && g.mailEnabled) return 'Mail-Segurança';
  return 'Outro';
}

function _renderGruposContent(kpiEl, tblEl, data){
  var m365 = 0, sec = 0, dist = 0;
  data.forEach(function(g){
    g._type = _grupoType(g);
    if(g._type === 'Microsoft 365') m365++;
    else if(g._type === 'Segurança') sec++;
    else if(g._type === 'Distribuição') dist++;
  });

  kpiEl.innerHTML = ReportTable.kpiCards([
    {label:'Total Grupos', value: data.length},
    {label:'Microsoft 365', value: m365},
    {label:'Segurança', value: sec},
    {label:'Distribuição', value: dist}
  ]);

  var columns = [
    {label:'Nome', key:'displayName', render: function(r){
      return '<div><div style="font-weight:700;font-size:13px">'+esc(r.displayName||'—')+'</div>'
        +(r.description ? '<div style="font-size:11px;color:var(--muted);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(r.description)+'</div>' : '')+'</div>';
    }, sortValue: function(r){ return (r.displayName||'').toLowerCase(); }},
    {label:'Tipo', key:'_type', render: function(r){
      var cls = r._type === 'Microsoft 365' ? 'lic-f3' : r._type === 'Segurança' ? 'lic-e3' : r._type === 'Distribuição' ? 'lic-bstd' : 'lic-none';
      return '<span class="lic-badge '+cls+'">'+esc(r._type)+'</span>';
    }},
    {label:'Membros', key:'memberCount', render: function(r){
      var cnt = r.memberCount != null ? r.memberCount : '—';
      return '<span class="cost-val">'+cnt+'</span>';
    }, sortValue: function(r){ return r.memberCount||0; }},
    {label:'Criado em', key:'createdDateTime', render: function(r){
      return '<span class="date-cell">'+(r.createdDateTime ? fmtDate(r.createdDateTime.split('T')[0]) : '—')+'</span>';
    }},
    {label:'', key:'_expand', render: function(r){
      return '<button class="act-btn" onclick="event.stopPropagation();_loadGrupoMembros(\''+esc(r.id)+'\',this)">Ver membros</button>';
    }, sortable: false}
  ];

  ReportTable.build('gruposTable', columns, data, {
    perPage: 20,
    exportName: 'grupos',
    emptyMessage: 'Nenhum grupo encontrado.'
  });
}

function _loadGrupoMembros(groupId, btn){
  if(btn.dataset.loaded){
    var existing = document.getElementById('gm-'+groupId);
    if(existing){ existing.remove(); btn.dataset.loaded=''; btn.textContent='Ver membros'; return; }
  }
  btn.textContent = 'Carregando...';
  btn.disabled = true;
  fetch('/api/reports/groups/'+groupId+'/members').then(function(r){ return r.json(); }).then(function(res){
    btn.disabled = false;
    btn.textContent = 'Ocultar';
    btn.dataset.loaded = '1';
    var members = res.data || [];
    var tr = btn.closest('tr');
    var newRow = document.createElement('tr');
    newRow.id = 'gm-'+groupId;
    var html = '<td colspan="5" style="padding:12px 20px;background:var(--surface2)">';
    if(members.length === 0){
      html += '<span style="color:var(--muted)">Nenhum membro encontrado</span>';
    } else {
      html += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
      members.forEach(function(m){
        html += '<div class="dept-tag" style="display:flex;align-items:center;gap:6px;cursor:pointer" onclick="openDetailByEmail(\''+escAttr(m.email||'')+'\')"><div class="avatar" style="width:22px;height:22px;font-size:9px">'+ini(m.displayName||'?')+'</div>'+esc(m.displayName||m.email||'—')+'</div>';
      });
      html += '</div>';
    }
    html += '</td>';
    newRow.innerHTML = html;
    tr.after(newRow);
  }).catch(function(){
    btn.disabled = false;
    btn.textContent = 'Erro';
    setTimeout(function(){ btn.textContent = 'Ver membros'; }, 2000);
  });
}
