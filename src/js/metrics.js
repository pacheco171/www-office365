/* ══════════ METRICS — Métricas e indicadores do dashboard ══════════ */

var _filtersFromServer=false;

/** Helper: acesso seguro a elemento DOM (retorna stub se não existe) */
function _el(id){
  var e=document.getElementById(id);
  if(e)return e;
  return {textContent:'',innerHTML:'',style:{},value:'',setAttribute:function(){},classList:{add:function(){},remove:function(){}}};
}

/** Recalcula e atualiza todas as métricas do dashboard (totais, deltas, filtros) */
function updateMetrics(){
  const d=dashData().filter(r=>r.licId!=='none'&&r.licId!=='other');
  const total=d.length;
  const ativos=d.filter(r=>r.status==='Ativo');
  const custo=ativos.reduce((s,r)=>s+userCost(r),0);

  let dTotal='',dLic='',dCusto='';
  let prevSnap=null;
  if(dashSnapIdx!=null&&dashSnapIdx>0){
    prevSnap=snapshots[dashSnapIdx-1];
  }else if(dashSnapIdx==null&&snapshots.length>=2){
    prevSnap=snapshots[snapshots.length-2];
  }
  if(prevSnap){
    const pc=snapshotCost(prevSnap);
    const pt=prevSnap.data.filter(r=>r.licId!=='none'&&r.licId!=='other').length;
    const pl=prevSnap.data.filter(r=>r.licId!=='none'&&r.licId!=='other').length;
    dTotal=`<span class="mc-delta ${total-pt>0?'up':total-pt<0?'down':'neutral'}">${total-pt>0?'+':''}${total-pt} vs ${prevSnap.label}</span>`;
    dLic=`<span class="mc-delta ${total-pl>0?'up':total-pl<0?'down':'neutral'}">${total-pl>0?'+':''}${total-pl} vs ${prevSnap.label}</span>`;
    const dc=custo-pc;
    dCusto=`<span class="mc-delta ${dc>0?'up':dc<0?'down':'neutral'}">${dc>0?'+':''}${fmtBRL(Math.abs(dc))} vs ${prevSnap.label}</span>`;
  }

  // Separar pessoas de contas não-pessoa
  var pessoas=d.filter(function(r){return !r.tipo||r.tipo==='Pessoa';});
  var nPessoas=pessoas.length;
  var nCompartilhados=d.filter(function(r){return r.tipo==='Compartilhado'||r.tipo==='Servico';}).length;
  var nLojas=d.filter(function(r){return r.tipo==='Loja';}).length;
  var nSalas=d.filter(function(r){return r.tipo==='Sala';}).length;
  var pessoasAtivas=pessoas.filter(function(r){return r.status==='Ativo';});

  var pessoasLic=pessoas.filter(function(r){return r.licId!=='none'&&r.licId!=='other';}).length;

  _el('mTotal').textContent=nPessoas;
  _el('mLic').textContent=pessoasLic;
  _el('mCusto').textContent='R$'+custo.toLocaleString('pt-BR',{maximumFractionDigits:0});
  var subParts=[pessoasAtivas.length+' pessoas'];
  if(nCompartilhados>0)subParts.push(nCompartilhados+' compartilhadas');
  if(nLojas>0)subParts.push(nLojas+' lojas');
  if(nSalas>0)subParts.push(nSalas+' salas');
  _el('mTotalSub').textContent=subParts.join(' · ');
  _el('mLicSub').textContent=Math.round(pessoasLic/Math.max(nPessoas,1)*100)+'% das pessoas';
  _el('mCustoSub').textContent='Anual: '+fmtBRL(custo*12);
  _el('mLicBar').style.width=Math.round(pessoasLic/Math.max(nPessoas,1)*100)+'%';
  _el('custoAnual').textContent=fmtBRL(custo*12);

  var viewLabel=dashSnapIdx!=null&&snapshots[dashSnapIdx]?snapshots[dashSnapIdx].label:'atual';
  _el('dashSub').textContent=nPessoas+' pessoas · '+nCompartilhados+' compartilhadas · custo mensal R$'+custo.toLocaleString('pt-BR',{maximumFractionDigits:0})+(dashSnapIdx!=null?' · '+viewLabel:'');
  _el('colabSub').textContent=nPessoas+' pessoas · '+total+' contas no total';
  _el('mTotalDelta').innerHTML=dTotal;
  _el('mLicDelta').innerHTML=dLic;
  _el('mCustoDelta').innerHTML=dCusto;

  // Custo médio por usuário (apenas ativos com licença paga)
  var custoMedio=ativos.length>0?custo/ativos.length:0;
  _el('mCustoMedio').textContent=fmtBRL(custoMedio);
  _el('mCustoMedioSub').textContent=ativos.length+' usuários ativos';
  _el('mCustoMedioBar').style.width='100%';
  // Delta custo médio
  var dCustoMedio='';
  if(prevSnap){
    var prevAtivos=prevSnap.data.filter(function(r){return r.status==='Ativo'&&r.licId!=='none'&&r.licId!=='other';});
    var prevCusto=prevAtivos.reduce(function(s,r){return s+userCost(r);},0);
    var prevMedio=prevAtivos.length>0?prevCusto/prevAtivos.length:0;
    var dm=custoMedio-prevMedio;
    dCustoMedio='<span class="mc-delta '+(dm>0?'up':dm<0?'down':'neutral')+'">'+(dm>0?'+':'')+fmtBRL(Math.abs(dm))+' vs '+prevSnap.label+'</span>';
  }
  _el('mCustoMedioDelta').innerHTML=dCustoMedio;

  // sidebar — custo por licença
  const byLic={};
  ativos.forEach(r=>{
    byLic[r.licId]=(byLic[r.licId]||0)+getLic(r.licId).price;
    (r.addons||[]).forEach(a=>{byLic[a]=(byLic[a]||0)+(licById[a]?.price||0);});
  });
  var sbShort={bstd:'Biz Std',bbasic:'Biz Basic',apps:'Apps Biz',f3:'F3',e3:'E3',pbi:'PBI Pro'};
  _el('sbRows').innerHTML=Object.entries(byLic).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).map(([id,v])=>
    `<div class="sb-row"><span class="sb-k">${sbShort[id]||getLic(id).short}</span><span class="sb-v">${fmtBRL(v)}</span></div>`).join('');
  _el('sbTotal').textContent=fmtBRL(custo);

  // filters — usa db local como fallback (API paginada atualiza via _updateFiltersFromServer)
  if(!_filtersFromServer){
    var ss=document.getElementById('fltSetor');
    if(ss){
      var cs=ss.value;
      const opts=[...new Set(db.map(r=>r.setor))].sort();
      ss.innerHTML='<option value="">Todos os setores</option>'+opts.map(o=>`<option${o===cs?' selected':''}>${o}</option>`).join('');
      var ls=document.getElementById('fltLic'),cl=ls.value;
      const used=[...new Set(db.filter(r=>r.licId!=='none'&&r.licId!=='other').map(r=>r.licId))];
      ls.innerHTML='<option value="">Todas as licenças</option>'+LICENSES.filter(l=>used.includes(l.id)).map(l=>`<option value="${l.id}"${l.id===cl?' selected':''}>${l.name}</option>`).join('');
      _el('setorList').innerHTML=opts.map(o=>`<option value="${o}">`).join('');
    }
  }

  if(typeof renderDashSnapTabs==='function')renderDashSnapTabs();

  // Smart alerts banner
  renderDashAlerts(d, custo);
}

/** Renderiza banner de alertas inteligentes no dashboard */
function renderDashAlerts(data, custoMensal) {
  var el = document.getElementById('dashAlertsBanner');
  if (!el) return;
  var alerts = [];
  var totalSaving = 0;

  // 1. Inativos com licença
  var inatPagos = data.filter(function(r){return r.status!=='Ativo' && r.licId && r.licId!=='none' && r.licId!=='other';});
  if (inatPagos.length) {
    var c = inatPagos.reduce(function(s,r){return s+(r.custo||0);},0);
    alerts.push({icon:'!',text:inatPagos.length+' inativos com licença',val:c});
    totalSaving += c;
  }

  // 2. Contratos cheios
  if (typeof contracts !== 'undefined') {
    var ativos = data.filter(function(r){return r.status==='Ativo';});
    contracts.forEach(function(ct) {
      var used = ativos.filter(function(r){return r.licId===ct.licId;}).length;
      if (ct.qtd && used/ct.qtd > 0.95) {
        alerts.push({icon:'●',text:(ct.nome||ct.licId)+' '+Math.round(used/ct.qtd*100)+'% ocupado'});
      }
    });
  }

  // 3. Tendência de custo
  if (snapshots.length >= 2) {
    var prev = snapshots[snapshots.length-2];
    var cP = (prev.data||[]).reduce(function(s,r){return s+(r.custo||0);},0);
    if (cP > 0) {
      var delta = custoMensal - cP;
      var pctD = Math.round(delta/cP*100);
      if (pctD > 5) alerts.push({icon:'▲',text:'Custo subiu '+pctD+'% vs '+prev.label});
    }
  }

  if (!alerts.length) { el.style.display = 'none'; return; }
  if (sessionStorage.getItem('dashAlertsDismissed')) { el.style.display = 'none'; return; }

  var html = '<div class="dab-icon" style="font-size:16px;font-weight:700;color:var(--yellow)">!</div><div class="dab-text"><strong>'+alerts.length+' oportunidade'+(alerts.length>1?'s':'')+' detectada'+(alerts.length>1?'s':'')+'</strong>';
  if (totalSaving > 0) html += ' — economia potencial <strong>'+fmtBRL(totalSaving)+'/mês</strong>';
  html += '<div class="dab-items">';
  alerts.forEach(function(a) { html += '<span class="dab-item">'+a.icon+' '+a.text+'</span>'; });
  html += '</div></div>';
  html += '<div class="dab-actions"><button class="btn btn-outline btn-sm" onclick="if(typeof aiChat!==\'undefined\')aiChat.toggle()">Analisar</button>';
  html += '<button class="dab-dismiss" onclick="this.closest(\'.dash-alerts-banner\').style.display=\'none\';sessionStorage.setItem(\'dashAlertsDismissed\',1)" title="Dispensar">×</button></div>';

  el.innerHTML = html;
  el.style.display = 'flex';
  el.className = 'dash-alerts-banner' + (alerts.some(function(a){return a.icon==='!';}) ? ' has-warn' : '');
}
