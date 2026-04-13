/* ══════════ COMPARE DASHBOARD — Comparativo entre snapshots ══════════ */

/** Toggle do painel de comparativo */
function toggleCompare(){
  var panel=document.getElementById('comparePanel');
  var btn=document.getElementById('compareToggleBtn');
  if(!panel)return;
  if(panel.style.display==='none'){
    var forecastPanel=document.getElementById('forecastPanel');
    if(forecastPanel)forecastPanel.style.display='none';
    var forecastBtn=document.getElementById('forecastToggleBtn');
    if(forecastBtn)forecastBtn.classList.remove('active');
    panel.style.display='block';
    if(btn)btn.classList.add('active');
    renderCompare();
  }else{
    panel.style.display='none';
    if(btn)btn.classList.remove('active');
  }
}

/** Renderiza seção de comparativo entre os 2 últimos snapshots */
function renderCompare(){
  const el=document.getElementById('compareSection');
  if(!el)return;
  var panel=document.getElementById('comparePanel');
  if(panel&&panel.style.display==='none')return;
  if(snapshots.length<2){el.innerHTML='<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px">'+t('dash.sem_snapshots')+'</div>';return;}
  const s1=snapshots[snapshots.length-2],s2=snapshots[snapshots.length-1];
  const c1=snapshotCost(s1),c2=snapshotCost(s2);

  const licCount=(snap)=>{
    const m={};
    snap.data.filter(r=>r.status!=='Inativo').forEach(r=>{
      m[r.licId]=(m[r.licId]||0)+1;
      (r.addons||[]).forEach(a=>{if(licById[a]?.price>0)m[a]=(m[a]||0)+1;});
    });
    return m;
  };
  const m1=licCount(s1),m2=licCount(s2);
  const allIds=[...new Set([...Object.keys(m1),...Object.keys(m2)])].filter(id=>id!=='none');

  const cardHtml=(snap,counts)=>`
    <div class="compare-card">
      <div class="compare-header">
        <div><div class="compare-month">${snap.label}</div><div style="font-size:11px;color:var(--muted);margin-top:3px">${snap.data.length} ${t('dash.usuarios')}</div></div>
        <div class="compare-total">${fmtBRL(snapshotCost(snap))}</div>
      </div>
      ${LICENSES.filter(l=>counts[l.id]&&l.id!=='none'&&l.id!=='other').sort((a,b)=>(counts[b.id]||0)*b.price-(counts[a.id]||0)*a.price).map(l=>`
        <div class="compare-row-item">
          <span class="cri-name">${licBadge(l.id)}</span>
          <span class="cri-qty">${counts[l.id]} ${t('dash.usuarios')}</span>
          <span class="cri-val">${fmtBRL((counts[l.id]||0)*l.price)}</span>
        </div>`).join('')}
    </div>`;

  const diffRows=allIds.map(id=>{
    const l=getLic(id);
    const q1=m1[id]||0,q2=m2[id]||0;
    const dq=q2-q1,dv=(q2-q1)*l.price;
    if(dq===0)return null;
    const pl=Math.abs(dq)>1?'s':'';
    const reason=dq>0?t('dash.usuario_add',{n:'+'+dq,pl}):t('dash.usuario_rem',{n:dq,pl});
    return`<div class="diff-row">
      <div class="diff-lic">${licBadge(id)}</div>
      <div class="diff-qty">${q1} → ${q2}</div>
      <div class="diff-val">${deltaBRLBadge(dv)}</div>
      <div class="diff-reason">${reason}</div>
    </div>`;
  }).filter(Boolean);

  el.innerHTML=`
    <div style="font-size:10px;color:var(--muted);letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:12px">${t('dash.comparativo',{s1:s1.label,s2:s2.label})}</div>
    <div class="compare-row">${cardHtml(s1,m1)}${cardHtml(s2,m2)}
      ${diffRows.length?`<div class="diff-card">
        <div class="diff-title">${t('dash.variacoes',{s1:s1.label,s2:s2.label})} ${deltaBRLBadge(c2-c1)}</div>
        ${diffRows.join('')}
      </div>`:''}
    </div>`;
}

document.addEventListener('i18n:change',function(){
  var panel=document.getElementById('comparePanel');
  if(panel&&panel.style.display!=='none')renderCompare();
});
