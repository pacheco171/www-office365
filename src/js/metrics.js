/* ══════════ METRICS — Métricas e indicadores do dashboard ══════════ */

var _filtersFromServer=false;

/** Recalcula e atualiza todas as métricas do dashboard (totais, deltas, filtros) */
function updateMetrics(){
  const d=dashData();
  const total=d.length;
  const comLic=d.filter(r=>r.licId!=='none').length;
  const ativos=d.filter(r=>r.status==='Ativo');
  const custo=ativos.reduce((s,r)=>s+userCost(r),0);
  const semLic=d.filter(r=>r.licId==='none'&&r.setor!=='Lojas').length;

  // Deltas vs previous snapshot
  // ATUAL (dashSnapIdx==null) → db = latest snapshot, so compare vs second-to-last
  // Snapshot selected (dashSnapIdx=N) → compare vs snapshots[N-1]
  let dTotal='',dLic='',dCusto='',dSem='';
  let prevSnap=null;
  if(dashSnapIdx!=null&&dashSnapIdx>0){
    prevSnap=snapshots[dashSnapIdx-1];
  }else if(dashSnapIdx==null&&snapshots.length>=2){
    prevSnap=snapshots[snapshots.length-2];
  }
  if(prevSnap){
    const pc=snapshotCost(prevSnap);
    const pt=prevSnap.data.length;
    const pl=prevSnap.data.filter(r=>r.licId!=='none').length;
    const ps=prevSnap.data.filter(r=>r.licId==='none'&&r.setor!=='Lojas').length;
    dTotal=`<span class="mc-delta ${total-pt>0?'up':total-pt<0?'down':'neutral'}">${total-pt>0?'+':''}${total-pt} vs ${prevSnap.label}</span>`;
    dLic=`<span class="mc-delta ${comLic-pl>0?'up':comLic-pl<0?'down':'neutral'}">${comLic-pl>0?'+':''}${comLic-pl} vs ${prevSnap.label}</span>`;
    const dc=custo-pc;
    dCusto=`<span class="mc-delta ${dc>0?'up':dc<0?'down':'neutral'}">${dc>0?'+':''}${fmtBRL(Math.abs(dc))} vs ${prevSnap.label}</span>`;
    dSem=`<span class="mc-delta ${semLic-ps>0?'up':semLic-ps<0?'down':'neutral'}">${semLic-ps>0?'+':''}${semLic-ps} vs ${prevSnap.label}</span>`;
  }

  // Separar pessoas de contas não-pessoa
  var pessoas=d.filter(function(r){return !r.tipo||r.tipo==='Pessoa';});
  var nPessoas=pessoas.length;
  var nCompartilhados=d.filter(function(r){return r.tipo==='Compartilhado'||r.tipo==='Servico';}).length;
  var nLojas=d.filter(function(r){return r.tipo==='Loja';}).length;
  var nSalas=d.filter(function(r){return r.tipo==='Sala';}).length;
  var pessoasAtivas=pessoas.filter(function(r){return r.status==='Ativo';});
  var pessoasLic=pessoas.filter(function(r){return r.licId!=='none';}).length;
  var custoPessoas=pessoasAtivas.reduce(function(s,r){return s+userCost(r);},0);

  document.getElementById('mTotal').textContent=nPessoas;
  document.getElementById('mLic').textContent=pessoasLic;
  document.getElementById('mCusto').textContent='R$'+custo.toLocaleString('pt-BR',{maximumFractionDigits:0});
  var semLicAtivos=d.filter(function(r){return r.licId==='none'&&r.setor!=='Lojas'&&r.status==='Ativo';}).length;
  document.getElementById('mSemLic').textContent=semLic;
  var subParts=[pessoasAtivas.length+' pessoas'];
  if(nCompartilhados>0)subParts.push(nCompartilhados+' compartilhadas');
  if(nLojas>0)subParts.push(nLojas+' lojas');
  if(nSalas>0)subParts.push(nSalas+' salas');
  document.getElementById('mTotalSub').textContent=subParts.join(' · ');
  document.getElementById('mLicSub').textContent=Math.round(pessoasLic/Math.max(nPessoas,1)*100)+'% das pessoas';
  document.getElementById('mCustoSub').textContent='Anual: '+fmtBRL(custo*12);
  document.getElementById('mSemLicSub').textContent=semLicAtivos>0?semLicAtivos+' ativo'+(semLicAtivos!==1?'s':'')+' em Outros':Math.round(semLic/Math.max(total,1)*100)+'% sem atribuição';
  document.getElementById('mLicBar').style.width=Math.round(comLic/Math.max(total,1)*100)+'%';
  const totalSemLojas=d.filter(r=>r.setor!=='Lojas').length;
  document.getElementById('mSemLicBar').style.width=Math.round(semLic/Math.max(totalSemLojas,1)*100)+'%';
  document.getElementById('custoAnual').textContent=fmtBRL(custo*12);

  var viewLabel=dashSnapIdx!=null&&snapshots[dashSnapIdx]?snapshots[dashSnapIdx].label:'atual';
  document.getElementById('dashSub').textContent=nPessoas+' pessoas · '+nCompartilhados+' compartilhadas · custo mensal R$'+custo.toLocaleString('pt-BR',{maximumFractionDigits:0})+(dashSnapIdx!=null?' · '+viewLabel:'');
  document.getElementById('colabSub').textContent=nPessoas+' pessoas · '+total+' contas no total';
  document.getElementById('mTotalDelta').innerHTML=dTotal;
  document.getElementById('mLicDelta').innerHTML=dLic;
  document.getElementById('mCustoDelta').innerHTML=dCusto;
  document.getElementById('mSemLicDelta').innerHTML=dSem;

  // sidebar — custo por licença
  const byLic={};
  ativos.filter(r=>r.licId!=='none').forEach(r=>{
    byLic[r.licId]=(byLic[r.licId]||0)+getLic(r.licId).price;
    (r.addons||[]).forEach(a=>{byLic[a]=(byLic[a]||0)+(licById[a]?.price||0);});
  });
  document.getElementById('sbRows').innerHTML=Object.entries(byLic).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).map(([id,v])=>
    `<div class="sb-row"><span class="sb-k">${getLic(id).short}</span><span class="sb-v">${fmtBRL(v)}</span></div>`).join('');
  document.getElementById('sbTotal').textContent=fmtBRL(custo);

  // filters — usa db local como fallback (API paginada atualiza via _updateFiltersFromServer)
  if(!_filtersFromServer){
    const ss=document.getElementById('fltSetor'),cs=ss.value;
    const opts=[...new Set(db.map(r=>r.setor))].sort();
    ss.innerHTML='<option value="">Todos os setores</option>'+opts.map(o=>`<option${o===cs?' selected':''}>${o}</option>`).join('');
    const ls=document.getElementById('fltLic'),cl=ls.value;
    const used=[...new Set(db.map(r=>r.licId))];
    if(!used.includes('none'))used.push('none');
    ls.innerHTML='<option value="">Todas as licenças</option>'+LICENSES.filter(l=>used.includes(l.id)).map(l=>`<option value="${l.id}"${l.id===cl?' selected':''}>${l.name}</option>`).join('');
    document.getElementById('setorList').innerHTML=opts.map(o=>`<option value="${o}">`).join('');
  }

  renderDashSnapTabs();
}
