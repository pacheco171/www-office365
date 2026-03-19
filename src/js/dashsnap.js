/* ══════════ DASHBOARD SNAPSHOT SELECTOR ══════════ */
function renderDashSnapTabs(){
  const el=document.getElementById('dashSnapTabs');
  if(!el)return;
  if(!snapshots.length){el.style.display='none';return;}
  el.style.display='flex';
  const tabs=[{label:'Atual',idx:null}];
  snapshots.forEach((s,i)=>tabs.push({label:s.label,idx:i}));
  el.innerHTML=tabs.map(t=>
    `<button class="dash-snap-tab${(dashSnapIdx===t.idx)?' active':''}" onclick="selectDashSnap(${t.idx})">${t.label}</button>`
  ).join('');
}

function selectDashSnap(idx){
  dashSnapIdx=idx;
  renderDashSnapTabs();
  updateMetrics();
  drawCharts();
  renderCompare();
}
