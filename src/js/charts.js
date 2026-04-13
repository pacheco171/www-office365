/* ══════════ CHARTS — Gráficos do dashboard ══════════ */

/** Renderiza todos os gráficos do dashboard */
function drawCharts(){
  if(getActivePage()!=='dashboard')return;
  drawDonut();drawBarCusto();drawBarCustoMedioSetor();drawBarStatus();
}

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
  if(!svg)return;
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
  html+=`<circle cx="${cx}" cy="${cy}" r="${r-2}" fill="white"/><text x="${cx}" y="${cy-5}" text-anchor="middle" font-family="Outfit" font-size="16" font-weight="800" fill="#1e1c1a">${total}</text><text x="${cx}" y="${cy+10}" text-anchor="middle" font-family="Lexend" font-size="9" fill="#8a8070">planos</text>`;
  svg.innerHTML=html;
  _el('donutLegend').innerHTML=entries.map(([id,cnt])=>`
    <div class="dl-item"><div class="dl-dot" style="background:${getLic(id).color}"></div>
    <span class="dl-name">${getLic(id).short}</span><span class="dl-val">${cnt}</span></div>`).join('');
}

/** Desenha gráfico de barras de custo por setor (top 10) */
function drawBarCusto(){
  const barEl=document.getElementById('barChart');
  if(!barEl)return;
  const d=dashData();
  const bySetor={};
  d.filter(r=>r.status==='Ativo').forEach(r=>{const h=resolveHierarchy(r);bySetor[h.macro]=(bySetor[h.macro]||0)+userCost(r);});
  const sorted=Object.entries(bySetor).sort((a,b)=>b[1]-a[1]);
  const top=sorted.slice(0,10);
  const max=top[0]?.[1]||1;
  barEl.innerHTML=top.map(([s,v])=>`
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
  if(!el)return;
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
  if(!panel)return;
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
  var el=document.getElementById('dashSetorTier-'+tierKey);
  if(el)el.classList.add('active');
  btn.classList.add('active');
}

function _syncVerTodosLink(id, open){
  var lnk=document.getElementById(id);
  if(lnk) lnk.textContent=open?t('dash.ver_menos'):t('dash.ver_todos');
}

/** Toggle do painel "ver todos os setores" no dashboard */
function toggleSetorAll(){
  var el=document.getElementById('setorAllPanel');
  if(el) el.classList.toggle('open');
  _syncVerTodosLink('verTodosSetor', el&&el.classList.contains('open'));
}

/** Calcula custo médio por pessoa/setor — retorna array ordenado [{name, media, count, custoTotal}, ...] */
function _calcCustoMedioSetor(){
  var d=dashData();
  var bySetor={};
  d.filter(function(r){return r.status==='Ativo'&&r.licId&&r.licId!=='none'&&r.licId!=='other';}).forEach(function(r){
    var h=resolveHierarchy(r);
    if(!bySetor[h.macro]) bySetor[h.macro]={custo:0,count:0};
    bySetor[h.macro].custo+=userCost(r);
    bySetor[h.macro].count++;
  });
  return Object.entries(bySetor).map(function(e){
    return{name:e[0],media:e[1].count>0?e[1].custo/e[1].count:0,count:e[1].count,custoTotal:e[1].custo};
  }).sort(function(a,b){return b.media-a.media;});
}

/** Renderiza barras de custo médio num elemento (top N) */
function _renderCustoMedioBars(el, data){
  var max=data.length?data[0].media:1;
  el.innerHTML=data.map(function(e){
    return '<div class="bc-row">'+
      '<div class="bc-label" title="'+e.name+'">'+e.name+'</div>'+
      '<div class="bc-track"><div class="bc-fill" style="width:'+Math.round(e.media/max*100)+'%;background:var(--green)"></div></div>'+
      '<div class="bc-val">'+fmtBRL(e.media)+'<span style="font-size:9px;color:var(--muted);margin-left:3px">('+e.count+')</span></div>'+
    '</div>';
  }).join('');
}

/** Desenha gráfico de barras de custo médio por pessoa/setor (top 10) */
function drawBarCustoMedioSetor(){
  var el=document.getElementById('custoMedioSetorChart');
  if(!el)return;
  var sorted=_calcCustoMedioSetor();
  _renderCustoMedioBars(el, sorted.slice(0,10));
  // Atualiza painel completo se estiver aberto
  var panel=document.getElementById('custoMedioAllPanel');
  if(panel&&panel.classList.contains('open')) _renderCustoMedioAllPanel(sorted);
}

/** Renderiza painel completo "ver todos" do custo médio */
function _renderCustoMedioAllPanel(sorted){
  if(!sorted) sorted=_calcCustoMedioSetor();
  var totalPessoas=sorted.reduce(function(s,e){return s+e.count;},0);
  var totalCusto=sorted.reduce(function(s,e){return s+e.custoTotal;},0);
  var mediaGeral=totalPessoas>0?totalCusto/totalPessoas:0;
  var maiorMedia=sorted.length?sorted[0]:null;
  var menorMedia=sorted.length?sorted[sorted.length-1]:null;

  // Cards consolidados
  var consolEl=document.getElementById('custoMedioConsolidated');
  if(consolEl){
    consolEl.innerHTML=
      '<div class="setor-consol-card total">'+
        '<div class="setor-consol-label">Média geral</div>'+
        '<div class="setor-consol-val">'+fmtBRL(mediaGeral)+'</div>'+
        '<div class="setor-consol-sub">'+totalPessoas+' pessoas em '+sorted.length+' setores</div>'+
      '</div>'+
      '<div class="setor-consol-card high">'+
        '<div class="setor-consol-label">Maior média</div>'+
        '<div class="setor-consol-val">'+(maiorMedia?fmtBRL(maiorMedia.media):'—')+'</div>'+
        '<div class="setor-consol-sub">'+(maiorMedia?maiorMedia.name+' ('+maiorMedia.count+' pessoas)':'—')+'</div>'+
      '</div>'+
      '<div class="setor-consol-card low">'+
        '<div class="setor-consol-label">Menor média</div>'+
        '<div class="setor-consol-val">'+(menorMedia?fmtBRL(menorMedia.media):'—')+'</div>'+
        '<div class="setor-consol-sub">'+(menorMedia?menorMedia.name+' ('+menorMedia.count+' pessoas)':'—')+'</div>'+
      '</div>'+
      '<div class="setor-consol-card mid">'+
        '<div class="setor-consol-label">Custo total</div>'+
        '<div class="setor-consol-val">'+fmtBRL(totalCusto)+'</div>'+
        '<div class="setor-consol-sub">'+fmtBRL(totalCusto*12)+' / ano</div>'+
      '</div>';
  }

  // Ranking com paginação
  var rankEl=document.getElementById('custoMedioRanking');
  if(!rankEl)return;
  // Guardar dados para paginação
  window._cmRankData={sorted:sorted,totalCusto:totalCusto};
  window._cmRankPer=window._cmRankPer||10;
  window._cmRankPage=1;
  _buildCustoMedioRank();
}

/** Badge de posição para top 3 */
function _rankBadge(i){
  var colors=['#c9942a','#8a8a8a','#a0603a']; // ouro, prata, bronze
  if(i>2)return '';
  return '<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:'+colors[i]+';color:#fff;font-size:9px;font-weight:800;margin-right:6px">'+(i+1)+'</span>';
}

/** Constroi tabela paginada do ranking */
function _buildCustoMedioRank(){
  var rankEl=document.getElementById('custoMedioRanking');
  if(!rankEl||!window._cmRankData)return;
  var sorted=window._cmRankData.sorted;
  var totalCusto=window._cmRankData.totalCusto;
  var per=window._cmRankPer;
  var page=window._cmRankPage;
  var total=sorted.length;
  var max=sorted.length?sorted[0].media:1;

  // Paginação
  var pages=per>=total?1:Math.ceil(total/per);
  if(page>pages)page=pages;
  var start=(page-1)*per;
  var rows=per>=total?sorted:sorted.slice(start,start+per);

  var thStyle='padding:10px 14px;font-size:10px;color:var(--muted);letter-spacing:1.5px;text-transform:uppercase;font-weight:700';

  var html=
    '<div style="margin-top:16px;border:1px solid var(--border);border-radius:10px;overflow:hidden">'+
      '<table style="width:100%;border-collapse:collapse;font-size:12px">'+
        '<thead><tr style="background:var(--surface2)">'+
          '<th style="'+thStyle+';text-align:left;width:50px">#</th>'+
          '<th style="'+thStyle+';text-align:left">Setor</th>'+
          '<th style="'+thStyle+';text-align:center">Pessoas</th>'+
          '<th style="'+thStyle+';text-align:left;min-width:160px">Custo médio</th>'+
          '<th style="'+thStyle+';text-align:right">Custo total</th>'+
          '<th style="'+thStyle+';text-align:right">% do total</th>'+
        '</tr></thead>'+
        '<tbody>'+rows.map(function(e,idx){
          var i=start+idx;
          var pct=totalCusto>0?Math.round(e.custoTotal/totalCusto*100):0;
          var barW=Math.round(e.media/max*100);
          var rowBg=idx%2===0?'var(--surface)':'var(--surface2)';
          var badge=_rankBadge(i);
          var posNum=badge?'':'<span style="font-weight:700;color:var(--muted)">'+(i+1)+'</span>';
          return '<tr style="background:'+rowBg+';border-top:1px solid var(--border)">'+
            '<td style="padding:8px 14px">'+(badge||posNum)+'</td>'+
            '<td style="padding:8px 14px;font-weight:600">'+e.name+'</td>'+
            '<td style="padding:8px 14px;text-align:center;color:var(--muted)">'+e.count+'</td>'+
            '<td style="padding:8px 14px">'+
              '<div style="display:flex;align-items:center;gap:8px">'+
                '<div style="flex:1;height:6px;background:var(--sand-lt);border-radius:3px;overflow:hidden">'+
                  '<div style="height:100%;width:'+barW+'%;background:var(--green);border-radius:3px"></div>'+
                '</div>'+
                '<span style="font-weight:700;white-space:nowrap">'+fmtBRL(e.media)+'</span>'+
              '</div>'+
            '</td>'+
            '<td style="padding:8px 14px;text-align:right;font-weight:600;color:var(--brown)">'+fmtBRL(e.custoTotal)+'</td>'+
            '<td style="padding:8px 14px;text-align:right;color:var(--muted)">'+pct+'%</td>'+
          '</tr>';
        }).join('')+
        '</tbody>'+
      '</table>'+
    '</div>';

  // Controles de paginação
  var info='Mostrando '+(start+1)+'–'+Math.min(start+per,total)+' de '+total+' setores';
  var perOpts=[10,20,30,40,50].map(function(n){
    return '<option value="'+n+'"'+(n===per?' selected':'')+'>'+n+'</option>';
  }).join('')+'<option value="'+total+'"'+(per>=total?' selected':'')+'>Todos</option>';

  var pagBtns='';
  if(pages>1){
    for(var p=1;p<=Math.min(pages,10);p++){
      pagBtns+='<button class="page-btn'+(p===page?' active':'')+'" onclick="_cmRankGoPage('+p+')">'+p+'</button>';
    }
  }

  html+='<div class="area-table-controls" style="margin-top:10px">'+
    '<span class="area-table-info">'+info+'</span>'+
    '<div class="per-page"><label>Exibir</label><select onchange="_cmRankSetPer(this.value)">'+perOpts+'</select></div>'+
    (pagBtns?'<div class="area-table-pag">'+pagBtns+'</div>':'')+
  '</div>';

  rankEl.innerHTML=html;
}

/** Muda quantidade por página do ranking */
function _cmRankSetPer(val){
  window._cmRankPer=parseInt(val,10)||10;
  window._cmRankPage=1;
  _buildCustoMedioRank();
}

/** Vai para página do ranking */
function _cmRankGoPage(p){
  window._cmRankPage=p;
  _buildCustoMedioRank();
}

/** Toggle do painel "ver todos" do custo médio */
function toggleCustoMedioAll(){
  var el=document.getElementById('custoMedioAllPanel');
  if(!el) return;
  el.classList.toggle('open');
  if(el.classList.contains('open')) _renderCustoMedioAllPanel();
  _syncVerTodosLink('verTodosMedio', el.classList.contains('open'));
}

/** Desenha gráfico de barras de status (Ativo/Pendente/Inativo) */
function drawBarStatus(){
  const statusEl=document.getElementById('statusChart');
  if(!statusEl)return;
  const d=dashData().filter(r=>r.licId!=='none'&&r.licId!=='other');
  const byStatus={Ativo:0,Pendente:0,Inativo:0};
  d.forEach(r=>{byStatus[r.status]=(byStatus[r.status]||0)+1;});
  const max=Math.max(...Object.values(byStatus));
  const colors={Ativo:'var(--green)',Pendente:'var(--yellow)',Inativo:'var(--muted)'};
  statusEl.innerHTML=Object.entries(byStatus).map(([s,v])=>`
    <div class="bc-row">
      <div class="bc-label">${s}</div>
      <div class="bc-track"><div class="bc-fill" style="width:${Math.round(v/max*100)}%;background:${colors[s]}"></div></div>
      <div class="bc-val">${v}</div>
    </div>`).join('');
}

document.addEventListener('i18n:change', function(){
  var setorPanel=document.getElementById('setorAllPanel');
  _syncVerTodosLink('verTodosSetor', setorPanel&&setorPanel.classList.contains('open'));
  var medioPanel=document.getElementById('custoMedioAllPanel');
  _syncVerTodosLink('verTodosMedio', medioPanel&&medioPanel.classList.contains('open'));
});
