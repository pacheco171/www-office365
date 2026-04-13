/* ══════════ RELATÓRIO EXECUTIVO ══════════ */
function renderReport(){
  const now=new Date();
  const mesAtual=MESES[now.getMonth()+1]+'/'+now.getFullYear();
  const total=db.length;
  const ativos=db.filter(r=>r.status==='Ativo');
  const comLic=db.filter(r=>r.licId!=='none').length;
  const semLic=db.filter(r=>r.licId==='none').length;
  const custo=ativos.reduce((s,r)=>s+userCost(r),0);
  const bloqueados=db.filter(r=>r.status==='Inativo'&&r.licId!=='none');
  const opKw=['auxiliar','operador','costureira','cortador','estampador','bordadeiro','embalagem','expedição'];
  const superLic=ativos.filter(r=>{const c=r.cargo.toLowerCase();return opKw.some(k=>c.includes(k))&&['bstd','e3'].includes(r.licId);});

  const byLic={};
  ativos.forEach(r=>{
    byLic[r.licId]=(byLic[r.licId]||0)+1;
    (r.addons||[]).filter(a=>licById[a]?.price>0).forEach(a=>{byLic[a]=(byLic[a]||0)+1;});
  });
  const bySetor={};
  ativos.forEach(r=>{bySetor[r.setor]=(bySetor[r.setor]||0)+userCost(r);});
  const topSetores=Object.entries(bySetor).sort((a,b)=>b[1]-a[1]).slice(0,5);

  let deltaHTML='';
  if(snapshots.length>=1){
    const prev=snapshots[snapshots.length-1];
    const dc=custo-snapshotCost(prev);
    const cls=dc>0?'var(--red)':dc<0?'var(--green)':'var(--muted)';
    const sign=dc>0?'+ ':'− ';
    deltaHTML=`<div class="report-kpi-delta" style="color:${cls}">${sign}${fmtBRL(Math.abs(dc))} vs ${prev.label}</div>`;
  }

  // SVG icons for sections
  const icoKpi=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>`;
  const icoAlert2=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  const icoLic=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-4 0v2"/></svg>`;
  const icoSetor=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;

  // Alerts
  const alerts=[];
  if(bloqueados.length>0){
    const custo_bloq=bloqueados.reduce((s,r)=>s+userCost(r),0);
    alerts.push({
      color:'var(--red)', bg:'rgba(184,92,74,.1)',
      title:`${bloqueados.length} usuário${bloqueados.length>1?'s':''} bloqueado${bloqueados.length>1?'s':''} com licença ativa`,
      desc:`Custo mensal desperdiçado: <strong>${fmtBRL(custo_bloq)}</strong>. Recomendação: acessar a tela Radar e remover as licenças.`
    });
  }
  if(superLic.length>0){
    const eco=superLic.reduce((s,r)=>s+(userCost(r)-25),0);
    alerts.push({
      color:'var(--yellow)', bg:'rgba(184,144,58,.1)',
      title:`${superLic.length} cargo${superLic.length>1?'s':''} operacional${superLic.length>1?'is':''} com licença Business Standard`,
      desc:`Economia potencial com downgrade para Office 365 F3: <strong>${fmtBRL(eco)}/mês · ${fmtBRL(eco*12)}/ano</strong>.`
    });
  }
  const overContracts=contracts.filter(c=>countUsedLic(c.licId)/Math.max(c.qtd,1)>=0.9);
  if(overContracts.length>0){
    alerts.push({
      color:'var(--yellow)', bg:'rgba(184,144,58,.1)',
      title:'Contratos próximos do limite de licenças',
      desc:`${overContracts.map(c=>getLic(c.licId).short+' ('+Math.round(countUsedLic(c.licId)/c.qtd*100)+'%)').join(', ')}. Considere ampliar antes da renovação.`
    });
  }

  document.getElementById('reportContent').innerHTML=`
  <div class="report-wrap">
    <div class="report-header">
      <div>
        <div class="report-logo">LIVE<em>!</em></div>
        <div class="report-logo-sub">Microsoft 365 — Gestão de Licenças</div>
      </div>
      <div class="report-meta">
        <div class="report-meta-ref">Relatório ${mesAtual}</div>
        <div class="report-meta-date">Gerado em ${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>
    </div>

    <div class="report-section">
      <div class="report-section-title">${icoKpi} Resumo do mês</div>
      <div class="report-kpis">
        <div class="report-kpi">
          <div class="report-kpi-val">${total}</div>
          <div class="report-kpi-label">Total de usuários</div>
        </div>
        <div class="report-kpi">
          <div class="report-kpi-val">${comLic}</div>
          <div class="report-kpi-label">Licenciados</div>
          <div class="report-kpi-delta" style="color:var(--muted)">${Math.round(comLic/Math.max(total,1)*100)}% do total</div>
        </div>
        <div class="report-kpi">
          <div class="report-kpi-val" style="color:var(--brown)">${fmtBRL(custo)}</div>
          <div class="report-kpi-label">Custo mensal</div>
          ${deltaHTML}
        </div>
        <div class="report-kpi">
          <div class="report-kpi-val" style="color:var(--brown)">${fmtBRL(custo*12)}</div>
          <div class="report-kpi-label">Projeção anual</div>
        </div>
      </div>
    </div>

    ${alerts.length>0?`
    <div class="report-section">
      <div class="report-section-title">${icoAlert2} Alertas e recomendações</div>
      ${alerts.map(a=>`
        <div class="report-alert">
          <div class="report-alert-icon" style="background:${a.bg}">
            <svg viewBox="0 0 24 24" fill="none" stroke="${a.color}" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div class="report-alert-body">
            <div class="report-alert-title" style="color:${a.color}">${a.title}</div>
            <div class="report-alert-desc">${a.desc}</div>
          </div>
        </div>`).join('')}
    </div>`:''}

    <div class="report-section">
      <div class="report-section-title">${icoLic} Licenças ativas</div>
      <table class="report-table">
        <thead><tr><th>Licença</th><th>Tier</th><th>Usuários</th><th>Preço unit./mês</th><th>Custo total/mês</th><th>% do custo</th></tr></thead>
        <tbody>
          ${LICENSES.filter(l=>byLic[l.id]&&l.id!=='none'&&l.id!=='other').sort((a,b)=>(byLic[b.id]||0)*b.price-(byLic[a.id]||0)*a.price).map(l=>`
            <tr>
              <td>${licBadge(l.id)}</td>
              <td style="color:var(--muted);font-size:11px">${l.tier}</td>
              <td><strong>${byLic[l.id]}</strong></td>
              <td style="color:var(--muted)">${l.price>0?fmtBRL(l.price):'Gratuito'}</td>
              <td><strong style="color:var(--brown)">${fmtBRL((byLic[l.id]||0)*l.price)}</strong></td>
              <td style="color:var(--muted)">${custo>0?Math.round((byLic[l.id]||0)*l.price/custo*100)+'%':'—'}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td colspan="2"><strong>Total</strong></td>
          <td><strong>${comLic}</strong></td>
          <td></td>
          <td><strong style="color:var(--brown)">${fmtBRL(custo)}</strong></td>
          <td>100%</td>
        </tr></tfoot>
      </table>
    </div>

    <div class="report-section">
      <div class="report-section-title">${icoSetor} Top 5 setores por custo</div>
      <table class="report-table">
        <thead><tr><th>Setor</th><th>Usuários ativos</th><th>Custo mensal</th><th>% do total</th></tr></thead>
        <tbody>
          ${topSetores.map(([s,v])=>`
            <tr>
              <td><strong>${s}</strong></td>
              <td>${db.filter(r=>r.setor===s&&r.status==='Ativo').length}</td>
              <td><strong style="color:var(--brown)">${fmtBRL(v)}</strong></td>
              <td style="color:var(--muted)">${custo>0?Math.round(v/custo*100)+'%':'—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="report-footer">
      <span>LIVE! Gestão Microsoft 365</span>
      <span>Gerado em ${now.toLocaleDateString('pt-BR')}</span>
    </div>
  </div>`;
}
