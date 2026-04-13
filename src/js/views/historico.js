/* ══════════ HISTÓRICO VIEW ══════════ */
function renderHistoricoChart(snaps) {
  if(typeof Chart === 'undefined') return;
  var sorted = snaps.slice().reverse();
  var labels = sorted.map(function(s){ return s.label; });
  var custos = sorted.map(function(s){ return snapshotCost(s); });
  var usuarios = sorted.map(function(s){ return s.data.filter(function(r){ return r.status !== 'Inativo'; }).length; });
  var ctx = document.getElementById('historicoChart');
  if(!ctx) return;
  if(window._historicoChart) window._historicoChart.destroy();
  window._historicoChart = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {label:'Custo Mensal (R$)', data: custos, borderColor:'#9c7a52', backgroundColor:'rgba(156,122,82,.1)', yAxisID:'y', tension:.3},
        {label:'Usuários Ativos', data: usuarios, borderColor:'#5a8a6a', backgroundColor:'rgba(90,138,106,.1)', yAxisID:'y1', tension:.3}
      ]
    },
    options:{
      responsive:true,
      interaction:{mode:'index'},
      scales:{
        y:{type:'linear',position:'left',ticks:{callback:function(v){return'R$'+v.toLocaleString('pt-BR');}}},
        y1:{type:'linear',position:'right',grid:{drawOnChartArea:false}}
      }
    }
  });
}

function renderHistView(){
  const el=document.getElementById('histView');
  if(!snapshots.length){
    el.innerHTML=`<div style="text-align:center;padding:60px;color:var(--muted)"><div style="margin-bottom:16px"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--border)" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><div style="font-size:16px;font-weight:700;margin-bottom:6px">Nenhum histórico ainda</div><div style="font-size:13px">Sincronize com o Azure para criar o primeiro snapshot mensal.</div></div>`;
    return;
  }
  var chartHtml='<div class="chart-block" style="background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:20px;margin-bottom:20px"><div class="chart-title" style="font-weight:700;font-size:14px;margin-bottom:12px">Evolução mensal</div><canvas id="historicoChart" height="120"></canvas></div>';
  el.innerHTML=chartHtml+snapshots.map((snap,i)=>{
    const prev=i>0?snapshots[i-1]:null;
    const c=snapshotCost(snap),pc=prev?snapshotCost(prev):null;
    const byLic={};
    snap.data.filter(r=>r.status!=='Inativo').forEach(r=>{
      byLic[r.licId]=(byLic[r.licId]||0)+1;
      (r.addons||[]).filter(a=>licById[a]?.price>0).forEach(a=>{byLic[a]=(byLic[a]||0)+1;});
    });
    const variacaoBtn=i>0?`<button class="btn btn-outline" style="margin-top:12px;font-size:12px" onclick="toggleVariacao(${i},this)">Ver variação detalhada</button><div id="variacao-${i}" style="display:none;margin-top:12px"></div>`:'';
    return`<div style="background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:20px;margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
        <div>
          <div style="font-family:'Outfit',sans-serif;font-size:20px;font-weight:800;text-transform:uppercase">${snap.label}</div>
          <div style="font-size:12px;color:var(--muted)">${snap.data.length} usuários · ${snap.data.filter(r=>r.licId!=='none').length} licenciados</div>
        </div>
        <div style="text-align:right">
          <div style="font-family:'Outfit',sans-serif;font-size:24px;font-weight:800;color:var(--brown)">${fmtBRL(c)}</div>
          ${pc!=null?(()=>{
            const uPrev=prev.data.filter(r=>r.status!=='Inativo').length;
            const uCurr=snap.data.filter(r=>r.status!=='Inativo').length;
            const du=uCurr-uPrev;
            const duSign=du>0?'+':'';
            return`<div>${deltaBRLBadge(c-pc)} vs ${prev.label}</div>`
              +(du!==0?`<div style="margin-top:2px;font-size:11px;color:var(--muted)">${duSign}${du} usuários</div>`:'');
          })():'<div style="font-size:11px;color:var(--muted)">Primeiro snapshot</div>'}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
        ${LICENSES.filter(l=>byLic[l.id]&&l.id!=='none'&&l.id!=='other').sort((a,b)=>(byLic[b.id]||0)*b.price-(byLic[a.id]||0)*a.price).map(l=>`
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;">
            <div style="font-size:11px;color:${l.color};font-weight:700">${l.short}</div>
            <div style="font-family:'Outfit',sans-serif;font-size:20px;font-weight:800">${byLic[l.id]}</div>
            <div style="font-size:13px;color:var(--text);font-weight:600">${l.price>0?fmtBRL(byLic[l.id]*l.price):''}</div>
          </div>`).join('')}
      </div>
      ${variacaoBtn}
    </div>`;
  }).reverse().join('');
  setTimeout(function(){ renderHistoricoChart(snapshots); }, 0);
}
