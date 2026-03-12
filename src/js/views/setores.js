/* ══════════ SETORES VIEW — Visão por setores/departamentos ══════════ */

/** Agrupa dados por setor macro e classifica em faixas de custo (high/mid/low) */
function computeSetorData(source){
  const map={};
  (source||db).forEach(r=>{
    // Agrupar por setor macro (hierarquia AD) em vez de r.setor direto
    const h=resolveHierarchy(r);
    const macroName=h.macro;
    if(!map[macroName]) map[macroName]={name:macroName,members:[],custo:0,byLic:{}};
    const s=map[macroName];
    s.members.push(r);
    if(r.status==='Ativo') s.custo+=userCost(r);
    s.byLic[r.licId]=(s.byLic[r.licId]||0)+1;
  });
  const all=Object.values(map).sort((a,b)=>b.custo-a.custo);
  const tiers={high:[],mid:[],low:[]};
  all.forEach(s=>{
    if(s.custo>=1000) tiers.high.push(s);
    else if(s.custo>=500) tiers.mid.push(s);
    else tiers.low.push(s);
  });
  const total=all.reduce((s,x)=>s+x.custo,0);
  return{all,tiers,total};
}

/** Renderiza cards consolidados de faixas de custo */
function renderSetorConsolidated(data){
  const el=document.getElementById('setorConsolidated');
  const tierInfo=[
    {key:'high',label:'Acima de R$ 1.000',cls:'high'},
    {key:'mid',label:'R$ 500 – R$ 999',cls:'mid'},
    {key:'low',label:'Abaixo de R$ 500',cls:'low'}
  ];
  el.innerHTML=`
    <div class="setor-consol-card total">
      <div class="setor-consol-label">Total geral</div>
      <div class="setor-consol-val">${fmtBRL(data.total)}</div>
      <div class="setor-consol-sub">${data.all.length} setores</div>
    </div>
    ${tierInfo.map(t=>{
      const sectors=data.tiers[t.key];
      const tierTotal=sectors.reduce((s,x)=>s+x.custo,0);
      return`<div class="setor-consol-card ${t.cls}">
        <div class="setor-consol-label">${t.label}</div>
        <div class="setor-consol-val">${fmtBRL(tierTotal)}</div>
        <div class="setor-consol-sub">${sectors.length} setor${sectors.length!==1?'es':''}</div>
      </div>`;
    }).join('')}`;
}

/** Renderiza painel expansível de setores por faixa de custo */
function renderSetorTier(tierKey,sectors){
  const panel=document.getElementById('setorTier-'+tierKey);
  if(!sectors.length){
    panel.innerHTML='<div class="setor-tier-empty">Nenhum setor nesta faixa de custo.</div>';
    return;
  }
  const chevronSvg='<svg class="setor-tier-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>';
  const tierTotal=sectors.reduce((s,x)=>s+x.custo,0);
  const items=sectors.map((s,idx)=>{
    const licCount=s.members.filter(r=>r.licId&&r.licId!=='none').length;
    const nPessoas=s.members.filter(r=>!r.tipo||r.tipo==='Pessoa').length;
    const nOutros=s.members.length-nPessoas;
    const metaPessoas=nPessoas+(nOutros>0?' pessoas · '+nOutros+' compartilhada'+(nOutros!==1?'s':''):' pessoas');
    return`<div class="setor-tier-item" id="stier-${tierKey}-${idx}">
      <div class="setor-tier-header" onclick="toggleSetorExpand('${tierKey}',${idx})">
        ${chevronSvg}
        <span class="setor-tier-name">${s.name}</span>
        <span class="setor-tier-meta">${metaPessoas}</span>
        <span class="setor-tier-meta">${licCount} licença${licCount!==1?'s':''}</span>
        <span class="setor-tier-cost">${fmtBRL(s.custo)}</span>
      </div>
      <div class="setor-tier-body">
        <div class="setor-tier-body-inner">
          ${renderSetorSubAreas(s,'st-'+tierKey+'-'+idx)}
        </div>
      </div>
    </div>`;
  }).join('');

  panel.innerHTML=items+`
    <div class="setor-tier-footer">
      <span class="setor-tier-footer-label">Total da faixa</span>
      <span class="setor-tier-footer-val">${fmtBRL(tierTotal)}</span>
    </div>`;
}

/** Toggle expandir/colapsar setor na view de setores */
function toggleSetorExpand(tierKey,idx){
  const el=document.getElementById('stier-'+tierKey+'-'+idx);
  if(el) el.classList.toggle('open');
}

/** Alterna entre abas de faixas (high/mid/low) na view de setores */
function switchSetorTier(tierKey,btn){
  document.querySelectorAll('#setores-atual .sub-tab-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('#setores-atual .sub-tab-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('setorTier-'+tierKey).classList.add('active');
  btn.classList.add('active');
}

/** Renderiza view completa de setores (consolidado + faixas) */
function renderSetores(){
  const data=computeSetorData();
  renderSetorConsolidated(data);
  renderSetorTier('high',data.tiers.high);
  renderSetorTier('mid',data.tiers.mid);
  renderSetorTier('low',data.tiers.low);
}

/** Renderiza tabela de histórico de custo por setor ao longo dos snapshots */
function renderSetorHist(){
  const tbody=document.getElementById('setorHistBody');
  if(!snapshots.length){tbody.innerHTML=`<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--muted)">Nenhum histórico disponível.</td></tr>`;return;}
  const rows=[];
  snapshots.forEach((snap,si)=>{
    // Agrupar por setor macro
    const macroMap={};
    snap.data.forEach(r=>{
      const h=resolveHierarchy(r);
      if(!macroMap[h.macro]) macroMap[h.macro]=[];
      macroMap[h.macro].push(r);
    });
    Object.keys(macroMap).sort().forEach(s=>{
      const members=macroMap[s].filter(r=>r.status==='Ativo');
      const custo=members.reduce((sum,r)=>sum+userCost(r),0);
      const byLic={};members.forEach(r=>{byLic[r.licId]=(byLic[r.licId]||0)+1;});
      const dom=Object.entries(byLic).sort((a,b)=>b[1]-a[1])[0];
      // Custo do mesmo macro no snapshot anterior
      let prev=null;
      if(si>0){
        const prevMacroMembers=snapshots[si-1].data.filter(r=>resolveHierarchy(r).macro===s&&r.status==='Ativo');
        prev=prevMacroMembers.reduce((sum,r)=>sum+userCost(r),0);
      }
      const dc=prev!=null?custo-prev:null;
      rows.push({snap,s,members:members.length,custo,dom,dc});
    });
  });
  tbody.innerHTML=rows.reverse().map(({snap,s,members,custo,dom,dc})=>`
    <tr>
      <td>${snap.label}</td>
      <td><span class="dept-tag">${s}</span></td>
      <td>${members}</td>
      <td><strong style="color:var(--brown)">${fmtBRL(custo)}</strong></td>
      <td>${dom?licBadge(dom[0]):'—'}</td>
      <td>${dc!=null?deltaBRLBadge(dc):'—'}</td>
    </tr>`).join('');
}
