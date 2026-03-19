/* ══════════ VARIAÇÃO EXPLICADA ══════════ */
function computeVariacao(snapA,snapB){
  const mapA=new Map(), mapB=new Map();
  snapA.data.forEach(r=>mapA.set(r.email,r));
  snapB.data.forEach(r=>mapB.set(r.email,r));

  const added=[],removed=[],upgraded=[],downgraded=[],unchanged=[];

  // Usuários em B mas não em A → adicionados
  for(const[email,r] of mapB){
    if(!mapA.has(email)){
      added.push({...r,custoDelta:userCost(r)});
    }
  }

  // Usuários em A mas não em B → removidos
  for(const[email,r] of mapA){
    if(!mapB.has(email)){
      removed.push({...r,custoDelta:-userCost(r)});
    }
  }

  // Usuários em ambos → comparar licenças
  for(const[email,rB] of mapB){
    const rA=mapA.get(email);
    if(!rA)continue;
    const costA=userCost(rA),costB=userCost(rB);
    const delta=costB-costA;
    if(rA.licId!==rB.licId){
      if(costB>costA){
        upgraded.push({...rB,licAnterior:rA.licId,custoDelta:delta});
      }else if(costB<costA){
        downgraded.push({...rB,licAnterior:rA.licId,custoDelta:delta});
      }else{
        unchanged.push({...rB,licAnterior:rA.licId,custoDelta:0});
      }
    }else{
      // Verificar mudanças de addons
      const addonsA=(rA.addons||[]).sort().join(',');
      const addonsB=(rB.addons||[]).sort().join(',');
      if(addonsA!==addonsB&&delta!==0){
        if(delta>0)upgraded.push({...rB,licAnterior:rA.licId,custoDelta:delta});
        else downgraded.push({...rB,licAnterior:rA.licId,custoDelta:delta});
      }
    }
  }

  const totalImpact=added.reduce((s,r)=>s+r.custoDelta,0)
    +removed.reduce((s,r)=>s+r.custoDelta,0)
    +upgraded.reduce((s,r)=>s+r.custoDelta,0)
    +downgraded.reduce((s,r)=>s+r.custoDelta,0);

  return{added,removed,upgraded,downgraded,totalImpact};
}

function renderVariacaoDetail(snapIdx){
  if(snapIdx<=0||snapIdx>=snapshots.length)return'';
  const snapB=snapshots[snapIdx],snapA=snapshots[snapIdx-1];
  const v=computeVariacao(snapA,snapB);

  function sectionHtml(title,color,bgColor,items,showLicAnterior){
    if(!items.length)return'';
    let html=`<div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;padding:6px 10px;background:${bgColor};border-radius:6px;display:inline-block">${title} (${items.length})</div>
      <div style="display:flex;flex-direction:column;gap:4px">`;
    for(const r of items){
      html+=`<div style="display:flex;align-items:center;gap:10px;padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-size:12px">
        <span style="font-weight:600;min-width:180px">${r.nome}</span>
        <span class="dept-tag" style="font-size:10px">${r.setor||'—'}</span>`;
      if(showLicAnterior&&r.licAnterior){
        html+=`${licBadge(r.licAnterior)}<span style="color:var(--muted)">→</span>${licBadge(r.licId)}`;
      }else{
        html+=licBadge(r.licId);
      }
      html+=`<span style="margin-left:auto;font-weight:700;color:${r.custoDelta>0?'var(--red)':r.custoDelta<0?'var(--green)':'var(--muted)'}">${r.custoDelta>0?'+':''}${fmtBRL(Math.abs(r.custoDelta))}</span>
      </div>`;
    }
    html+=`</div></div>`;
    return html;
  }

  let html='';
  html+=sectionHtml('Adicionados',v.added.length?'var(--green)':'var(--muted)','rgba(90,138,106,.08)',v.added,false);
  html+=sectionHtml('Removidos',v.removed.length?'var(--red)':'var(--muted)','rgba(184,92,74,.08)',v.removed,false);
  html+=sectionHtml('Upgrade',v.upgraded.length?'var(--yellow)':'var(--muted)','rgba(184,144,58,.08)',v.upgraded,true);
  html+=sectionHtml('Downgrade',v.downgraded.length?'var(--green)':'var(--muted)','rgba(90,138,106,.08)',v.downgraded,true);

  html+=`<div style="padding:12px 16px;background:var(--sand-lt);border-radius:8px;display:flex;justify-content:space-between;align-items:center;margin-top:8px">
    <span style="font-size:13px;font-weight:700">Impacto líquido no custo mensal</span>
    <span style="font-family:'Outfit',sans-serif;font-size:20px;font-weight:800;color:${v.totalImpact>0?'var(--red)':v.totalImpact<0?'var(--green)':'var(--muted)'}">${v.totalImpact>0?'+':''}${fmtBRL(Math.abs(v.totalImpact))}</span>
  </div>`;

  return html;
}

function toggleVariacao(idx,btn){
  const container=document.getElementById('variacao-'+idx);
  if(!container)return;
  if(container.style.display==='none'||!container.style.display){
    if(!container.innerHTML)container.innerHTML=renderVariacaoDetail(idx);
    container.style.display='block';
    btn.textContent='Ocultar variação detalhada';
  }else{
    container.style.display='none';
    btn.textContent='Ver variação detalhada';
  }
}
