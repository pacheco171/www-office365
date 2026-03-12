/* ══════════ VIEW AUDITORIA ══════════ */
let auditPage=1;
let AUDIT_PER=20;
let auditFilterAction='';
let auditFilterEntity='';
function changeAuditPerPage(val){AUDIT_PER=val==='all'?9999:parseInt(val);auditPage=1;renderAuditoria();}

function actionLabel(action){
  const map={
    'create':'Criado','update':'Editado','delete':'Removido',
    'license_change':'Licença alterada','import':'Importação',
    'contract_create':'Contrato criado','contract_update':'Contrato editado',
    'acao_status':'Status ação','acao_comment':'Comentário ação'
  };
  return map[action]||action;
}

function actionBadgeClass(action){
  if(action==='create'||action==='contract_create')return'audit-badge-green';
  if(action==='update'||action==='contract_update'||action==='license_change')return'audit-badge-yellow';
  if(action==='delete')return'audit-badge-red';
  if(action==='import')return'audit-badge-blue';
  return'audit-badge-neutral';
}

function formatChanges(changes){
  if(!changes)return'';
  if(typeof changes==='string')return'<span class="audit-field-diff">'+changes+'</span>';
  if(Array.isArray(changes)){
    return changes.map(function(c){
      return'<span class="audit-field-diff"><strong>'+c.campo+':</strong> '+c.de+' → '+c.para+'</span>';
    }).join('');
  }
  return'';
}

function renderAuditoria(){
  var el=document.getElementById('auditoriaContent');
  var effPer=AUDIT_PER===Infinity?9999:AUDIT_PER;

  loadChangelogPage(auditPage,effPer,auditFilterAction,auditFilterEntity)
    .then(function(data){
      // API com paginação retorna objeto {entries,total,page,pages}
      if(!data||typeof data!=='object'||!data.entries){
        // Fallback: API retornou array raw (sem paginação)
        _renderAuditoriaLocal();
        return;
      }

      var entries=data.entries;
      var total=data.total;
      var pages=data.pages;
      var page=data.page;
      auditPage=page;

      if(!entries.length&&total===0){
        el.innerHTML='<div style="text-align:center;padding:60px;color:var(--muted)">'
          +'<div style="margin-bottom:16px"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--border)" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>'
          +'<div style="font-size:16px;font-weight:700;margin-bottom:6px">Nenhum registro ainda</div>'
          +'<div style="font-size:13px">Alterações em colaboradores, licenças e contratos aparecerão aqui.</div>'
          +'</div>';
        return;
      }

      // Filtros — precisamos das listas completas de ações/tipos
      // Usamos o que temos no changelog local se disponível, senão listamos do que veio
      var actions=changelog.length?[...new Set(changelog.map(function(e){return e.action;}))]:
        [...new Set(entries.map(function(e){return e.action;}))];
      var entities=changelog.length?[...new Set(changelog.map(function(e){return e.entityType;}))]:
        [...new Set(entries.map(function(e){return e.entityType;}))];

      var html='<div class="audit-filters">'
        +'<select class="filter-select" onchange="auditFilterAction=this.value;auditPage=1;renderAuditoria()">'
        +'<option value="">Todas as ações</option>'
        +actions.map(function(a){return'<option value="'+a+'"'+(auditFilterAction===a?' selected':'')+'>'+actionLabel(a)+'</option>';}).join('')
        +'</select>'
        +'<select class="filter-select" onchange="auditFilterEntity=this.value;auditPage=1;renderAuditoria()">'
        +'<option value="">Todos os tipos</option>'
        +entities.map(function(e){return'<option value="'+e+'"'+(auditFilterEntity===e?' selected':'')+'>'+e+'</option>';}).join('')
        +'</select>'
        +'<span class="audit-count">'+total+' registro'+(total!==1?'s':'')+'</span>'
        +'</div>';

      html+='<div class="audit-table"><table><thead><tr>'
        +'<th>Data/Hora</th><th>Ação</th><th>Tipo</th><th>Entidade</th><th>Alterações</th><th>Autor</th>'
        +'</tr></thead><tbody>';

      for(var i=0;i<entries.length;i++){
        var entry=entries[i];
        var dt=new Date(entry.criadoEm);
        var dateStr=dt.toLocaleDateString('pt-BR')+' '+dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
        html+='<tr class="audit-row">'
          +'<td style="white-space:nowrap;font-size:12px;color:var(--muted)">'+dateStr+'</td>'
          +'<td><span class="audit-action-badge '+actionBadgeClass(entry.action)+'">'+actionLabel(entry.action)+'</span></td>'
          +'<td style="font-size:12px">'+(entry.entityType||'—')+'</td>'
          +'<td style="font-weight:600">'+(entry.entityName||'—')+'</td>'
          +'<td>'+formatChanges(entry.changes)+'</td>'
          +'<td style="font-size:12px;color:var(--muted)">'+(entry.autor||'—')+'</td>'
          +'</tr>';
      }
      html+='</tbody></table></div>';

      html+='<div class="table-footer" style="margin-top:0;border-radius:0 0 11px 11px">';
      html+='<div class="table-footer-left"><div class="table-info">'+total+' registro'+(total!==1?'s':'')+'</div>';
      html+='<div class="per-page"><label>Exibir</label><select onchange="changeAuditPerPage(this.value)">';
      [10,20,30,40,50,'all'].forEach(function(v){
        var label=v==='all'?'Todas':v;
        var sel=(v==='all'&&AUDIT_PER>=9999)||(v===AUDIT_PER)?' selected':'';
        html+='<option value="'+v+'"'+sel+'>'+label+'</option>';
      });
      html+='</select></div></div>';
      if(pages>1){
        html+='<div class="pagination">';
        for(var p=1;p<=Math.min(pages,10);p++){
          html+='<button class="page-btn'+(p===auditPage?' active':'')+'" onclick="auditPage='+p+';renderAuditoria()">'+p+'</button>';
        }
        html+='</div>';
      }
      html+='</div>';

      el.innerHTML=html;
    })
    .catch(function(){
      _renderAuditoriaLocal();
    });
}

/** Fallback: renderiza auditoria com changelog local */
function _renderAuditoriaLocal(){
  var el=document.getElementById('auditoriaContent');
  if(!changelog.length){
    el.innerHTML='<div style="text-align:center;padding:60px;color:var(--muted)">'
      +'<div style="margin-bottom:16px"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--border)" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>'
      +'<div style="font-size:16px;font-weight:700;margin-bottom:6px">Nenhum registro ainda</div>'
      +'<div style="font-size:13px">Alterações em colaboradores, licenças e contratos aparecerão aqui.</div>'
      +'</div>';
    return;
  }

  var filtered=changelog.slice();
  if(auditFilterAction)filtered=filtered.filter(function(e){return e.action===auditFilterAction;});
  if(auditFilterEntity)filtered=filtered.filter(function(e){return e.entityType===auditFilterEntity;});

  var total=filtered.length;
  var effPer=AUDIT_PER>=9999?total:AUDIT_PER;
  var pages=Math.max(1,Math.ceil(total/effPer));
  if(auditPage>pages)auditPage=pages;
  var start=(auditPage-1)*effPer;
  var page=filtered.slice(start,start+effPer);

  var actions=[...new Set(changelog.map(function(e){return e.action;}))];
  var entities=[...new Set(changelog.map(function(e){return e.entityType;}))];

  var html='<div class="audit-filters">'
    +'<select class="filter-select" onchange="auditFilterAction=this.value;auditPage=1;renderAuditoria()">'
    +'<option value="">Todas as ações</option>'
    +actions.map(function(a){return'<option value="'+a+'"'+(auditFilterAction===a?' selected':'')+'>'+actionLabel(a)+'</option>';}).join('')
    +'</select>'
    +'<select class="filter-select" onchange="auditFilterEntity=this.value;auditPage=1;renderAuditoria()">'
    +'<option value="">Todos os tipos</option>'
    +entities.map(function(e){return'<option value="'+e+'"'+(auditFilterEntity===e?' selected':'')+'>'+e+'</option>';}).join('')
    +'</select>'
    +'<span class="audit-count">'+total+' registro'+(total!==1?'s':'')+'</span>'
    +'</div>';

  html+='<div class="audit-table"><table><thead><tr>'
    +'<th>Data/Hora</th><th>Ação</th><th>Tipo</th><th>Entidade</th><th>Alterações</th><th>Autor</th>'
    +'</tr></thead><tbody>';

  for(var i=0;i<page.length;i++){
    var entry=page[i];
    var dt=new Date(entry.criadoEm);
    var dateStr=dt.toLocaleDateString('pt-BR')+' '+dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    html+='<tr class="audit-row">'
      +'<td style="white-space:nowrap;font-size:12px;color:var(--muted)">'+dateStr+'</td>'
      +'<td><span class="audit-action-badge '+actionBadgeClass(entry.action)+'">'+actionLabel(entry.action)+'</span></td>'
      +'<td style="font-size:12px">'+(entry.entityType||'—')+'</td>'
      +'<td style="font-weight:600">'+(entry.entityName||'—')+'</td>'
      +'<td>'+formatChanges(entry.changes)+'</td>'
      +'<td style="font-size:12px;color:var(--muted)">'+(entry.autor||'—')+'</td>'
      +'</tr>';
  }
  html+='</tbody></table></div>';

  html+='<div class="table-footer" style="margin-top:0;border-radius:0 0 11px 11px">';
  html+='<div class="table-footer-left"><div class="table-info">'+total+' registro'+(total!==1?'s':'')+'</div>';
  html+='<div class="per-page"><label>Exibir</label><select onchange="changeAuditPerPage(this.value)">';
  [10,20,30,40,50,'all'].forEach(function(v){
    var label=v==='all'?'Todas':v;
    var sel=(v==='all'&&AUDIT_PER>=9999)||(v===AUDIT_PER)?' selected':'';
    html+='<option value="'+v+'"'+sel+'>'+label+'</option>';
  });
  html+='</select></div></div>';
  if(pages>1){
    html+='<div class="pagination">';
    for(var p=1;p<=pages;p++){
      html+='<button class="page-btn'+(p===auditPage?' active':'')+'" onclick="auditPage='+p+';renderAuditoria()">'+p+'</button>';
    }
    html+='</div>';
  }
  html+='</div>';

  el.innerHTML=html;
}
