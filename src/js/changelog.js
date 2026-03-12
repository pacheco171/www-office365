/* ══════════ CHANGELOG — Registro de auditoria ══════════
   Mantém histórico de alterações (criar, editar, importar, etc.)
   Persistido via /api/changelog no servidor. Máximo 500 entradas. */

let changelog=[];

/** Carrega histórico de auditoria do servidor */
function loadChangelog(){
  return fetch('/api/changelog').then(r=>r.json()).then(data=>{
    if(Array.isArray(data))changelog=data;
  }).catch(()=>{});
}

/** Carrega changelog paginado do servidor */
function loadChangelogPage(page,per,action,entityType){
  var params='page='+page+'&per='+per;
  if(action)params+='&action='+encodeURIComponent(action);
  if(entityType)params+='&entityType='+encodeURIComponent(entityType);
  return fetch('/api/changelog?'+params).then(function(r){return r.json();});
}

/** Persiste changelog no servidor (POST /api/changelog) */
function persistChangelog(){
  fetch('/api/changelog',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(changelog)
  }).catch(()=>{});
}

/** Registra uma alteração no changelog.
    @param {string} action — Tipo: 'create', 'update', 'delete', 'import', 'license_change'
    @param {string} entityType — Entidade afetada: 'colaborador', 'snapshot', etc.
    @param {number} entityId — ID do registro afetado
    @param {string} entityName — Nome legível (para exibição)
    @param {string|Array} changes — Descrição ou array de {campo, de, para} */
function logChange(action,entityType,entityId,entityName,changes){
  const s=authGetSession();
  changelog.unshift({
    id:Date.now(),
    action,
    entityType,
    entityId,
    entityName,
    changes,
    autor:s?s.name||s.username:'Sistema',
    criadoEm:new Date().toISOString()
  });
  if(changelog.length>500)changelog.length=500;
  persistChangelog();
}

/** Compara campos entre dois objetos e retorna lista de diferenças. */
function diffFields(before,after,fields){
  const diffs=[];
  for(const f of fields){
    const bv=before[f]!=null?String(before[f]):'';
    const av=after[f]!=null?String(after[f]):'';
    if(bv!==av)diffs.push({campo:f,de:bv||'(vazio)',para:av||'(vazio)'});
  }
  return diffs;
}
