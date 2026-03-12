/* ══════════ SNAPSHOT ══════════ */
function saveSnapshot(mes,ano){
  const label=MESES[mes]+'/'+ano;
  const existing=snapshots.findIndex(s=>s.mes===mes&&s.ano===ano);
  const snap={mes,ano,label,data:db.map(r=>({...r,addons:[...(r.addons||[])]}))}; 
  if(existing>=0)snapshots[existing]=snap;
  else snapshots.push(snap);
  snapshots.sort((a,b)=>a.ano!==b.ano?a.ano-b.ano:a.mes-b.mes);
  persist();
}

function snapshotCost(snap){
  return snap.data.filter(r=>r.status!=='Inativo').reduce((s,r)=>s+userCost(r),0);
}
