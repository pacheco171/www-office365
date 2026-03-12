/* ══════════ CHARTS — Gráficos do dashboard ══════════ */

/** Renderiza todos os gráficos do dashboard */
function drawCharts(){drawDonut();drawBarCusto();drawBarStatus();}

/** Desenha gráfico SVG donut de distribuição de licenças */
function drawDonut(){
  const d=dashData();
  const byLic={};
  d.filter(r=>r.licId!=='none').forEach(r=>{
    byLic[r.licId]=(byLic[r.licId]||0)+1;
    (r.addons||[]).forEach(a=>{byLic[a]=(byLic[a]||0)+1;});
  });
  const entries=Object.entries(byLic).sort((a,b)=>b[1]-a[1]);
  const total=entries.reduce((s,[,v])=>s+v,0);
  const svg=document.getElementById('donutSvg');
  const cx=55,cy=55,R=44,r=28,tau=Math.PI*2;
  let html='',angle=-Math.PI/2;
  entries.forEach(([id,cnt])=>{
    const slice=(cnt/total)*tau;
    const x1=cx+R*Math.cos(angle),y1=cy+R*Math.sin(angle);
    angle+=slice;
    const x2=cx+R*Math.cos(angle),y2=cy+R*Math.sin(angle);
    const ix1=cx+r*Math.cos(angle-slice),iy1=cy+r*Math.sin(angle-slice);
    const ix2=cx+r*Math.cos(angle),iy2=cy+r*Math.sin(angle);
    const large=slice>Math.PI?1:0;
    html+=`<path d="M${x1},${y1} A${R},${R} 0 ${large},1 ${x2},${y2} L${ix2},${iy2} A${r},${r} 0 ${large},0 ${ix1},${iy1} Z" fill="${getLic(id).color}" opacity=".85"/>`;
  });
  html+=`<circle cx="${cx}" cy="${cy}" r="${r-2}" fill="white"/><text x="${cx}" y="${cy-5}" text-anchor="middle" font-family="Barlow Condensed" font-size="16" font-weight="800" fill="#1e1c1a">${total}</text><text x="${cx}" y="${cy+10}" text-anchor="middle" font-family="Barlow" font-size="9" fill="#8a8070">planos</text>`;
  svg.innerHTML=html;
  document.getElementById('donutLegend').innerHTML=entries.map(([id,cnt])=>`
    <div class="dl-item"><div class="dl-dot" style="background:${getLic(id).color}"></div>
    <span class="dl-name">${getLic(id).short}</span><span class="dl-val">${cnt}</span></div>`).join('');
}

/** Desenha gráfico de barras de custo por setor (top 10) */
function drawBarCusto(){
  const d=dashData();
  const bySetor={};
  d.filter(r=>r.status==='Ativo').forEach(r=>{const h=resolveHierarchy(r);bySetor[h.macro]=(bySetor[h.macro]||0)+userCost(r);});
  const sorted=Object.entries(bySetor).sort((a,b)=>b[1]-a[1]);
  const top=sorted.slice(0,10);
  const max=top[0]?.[1]||1;
  document.getElementById('barChart').innerHTML=top.map(([s,v])=>`
    <div class="bc-row">
      <div class="bc-label" title="${s}">${s}</div>
      <div class="bc-track"><div class="bc-fill" style="width:${Math.round(v/max*100)}%;background:var(--tan)"></div></div>
      <div class="bc-val">${fmtBRL(v)}</div>
    </div>`).join('');
  renderDashSetorTiers();
}

/** Renderiza cards consolidados de faixas de custo no dashboard */
function renderDashSetorTiers(){
  const data=computeSetorData(dashData());
  const el=document.getElementById('dashSetorConsolidated');
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
  ['high','mid','low'].forEach(k=>renderDashTierPanel(k,data.tiers[k]));
}

/** Renderiza painel expansível de setores por faixa no dashboard */
function renderDashTierPanel(tierKey,sectors){
  const panel=document.getElementById('dashSetorTier-'+tierKey);
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
    return`<div class="setor-tier-item" id="dstier-${tierKey}-${idx}">
      <div class="setor-tier-header" onclick="toggleDashSetorExpand('${tierKey}',${idx})">
        ${chevronSvg}
        <span class="setor-tier-name">${s.name}</span>
        <span class="setor-tier-meta">${metaPessoas}</span>
        <span class="setor-tier-meta">${licCount} licença${licCount!==1?'s':''}</span>
        <span class="setor-tier-cost">${fmtBRL(s.custo)}</span>
      </div>
      <div class="setor-tier-body">
        <div class="setor-tier-body-inner">
          ${renderSetorSubAreas(s,'ds-'+tierKey+'-'+idx)}
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

/** Toggle expandir/colapsar setor no dashboard */
function toggleDashSetorExpand(tierKey,idx){
  const el=document.getElementById('dstier-'+tierKey+'-'+idx);
  if(el) el.classList.toggle('open');
}

/** Alterna entre abas de faixas (high/mid/low) no dashboard */
function switchDashSetorTier(tierKey,btn){
  document.querySelectorAll('#setorAllPanel .sub-tab-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('#setorAllPanel .sub-tab-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('dashSetorTier-'+tierKey).classList.add('active');
  btn.classList.add('active');
}

/** Toggle do painel "ver todos os setores" no dashboard */
function toggleSetorAll(){
  document.getElementById('setorAllPanel').classList.toggle('open');
}

/** Desenha gráfico de barras de status (Ativo/Pendente/Inativo) */
function drawBarStatus(){
  const d=dashData();
  const byStatus={Ativo:0,Pendente:0,Inativo:0};
  d.forEach(r=>{byStatus[r.status]=(byStatus[r.status]||0)+1;});
  const max=Math.max(...Object.values(byStatus));
  const colors={Ativo:'var(--green)',Pendente:'var(--yellow)',Inativo:'var(--muted)'};
  document.getElementById('statusChart').innerHTML=Object.entries(byStatus).map(([s,v])=>`
    <div class="bc-row">
      <div class="bc-label">${s}</div>
      <div class="bc-track"><div class="bc-fill" style="width:${Math.round(v/max*100)}%;background:${colors[s]}"></div></div>
      <div class="bc-val">${v}</div>
    </div>`).join('');
}
