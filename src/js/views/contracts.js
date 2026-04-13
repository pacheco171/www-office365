/* ══════════ CONTRATOS ══════════ */
let contracts=[];
let azureSubs=[];  // dados de assinatura do Azure (subscribedSkus)
function persistContracts(){persist();}
let editingContractId=null;

function countUsedLic(licId){
  return db.filter(r=>r.licId===licId||(r.addons||[]).includes(licId)).length;
}

/** Carrega dados de assinatura do Azure */
function loadAzureSubs(){
  return fetch('/api/subscriptions')
    .then(r=>r.json())
    .then(data=>{azureSubs=Array.isArray(data)?data:[];})
    .catch(()=>{azureSubs=[];});
}

/** Retorna dados consolidados por licId (Azure + contratos manuais) */
function getSubData(licId){
  // Azure: somar todas as SKUs que mapeiam para esse licId
  const azSkus=azureSubs.filter(s=>s.licId===licId);
  const azEnabled=azSkus.reduce((s,x)=>s+x.enabled,0);
  const azConsumed=azSkus.reduce((s,x)=>s+x.consumed,0);
  // Contratos manuais
  const cons=contracts.filter(c=>c.licId===licId);
  const manualQtd=cons.reduce((s,c)=>s+c.qtd,0);
  // Fonte primária: Azure se disponível, senão contratos manuais
  const hasAzure=azEnabled>0;
  const contratadas=hasAzure?azEnabled:manualQtd;
  const emUso=hasAzure?azConsumed:countUsedLic(licId);
  return{contratadas,emUso,hasAzure,cons,azSkus};
}

function renderContracts(){
  // ── KPIs resumo ──
  let totalContratadas=0,totalEmUso=0,totalCustoUso=0,totalCustoOcioso=0;
  const licData=LICENSES.filter(l=>l.id!=='none'&&l.id!=='other').map(l=>{
    const sd=getSubData(l.id);
    const free=sd.contratadas-sd.emUso;
    const pct=sd.contratadas>0?Math.round(sd.emUso/sd.contratadas*100):null;
    const usedCost=sd.emUso*l.price;
    const freeCost=Math.max(0,free)*l.price;
    const over=sd.emUso>sd.contratadas&&sd.contratadas>0;
    const warn=pct>=90&&!over;
    totalContratadas+=sd.contratadas;
    totalEmUso+=sd.emUso;
    totalCustoUso+=usedCost;
    totalCustoOcioso+=Math.max(0,freeCost);
    return{l,sd,free,pct,usedCost,freeCost,over,warn};
  });

  // ── KPIs ──
  const kpiEl=document.getElementById('contractKpis');
  if(kpiEl){
    const totalFree=totalContratadas-totalEmUso;
    const totalPct=totalContratadas>0?Math.round(totalEmUso/totalContratadas*100):0;
    kpiEl.innerHTML=`
      <div class="contract-kpi">
        <div class="contract-kpi-val">${totalContratadas}</div>
        <div class="contract-kpi-label">Contratadas</div>
      </div>
      <div class="contract-kpi">
        <div class="contract-kpi-val">${totalEmUso}</div>
        <div class="contract-kpi-label">Em uso</div>
      </div>
      <div class="contract-kpi">
        <div class="contract-kpi-val" style="color:${totalFree<0?'var(--red)':totalFree>0?'var(--green)':'var(--muted)'}">${totalFree}</div>
        <div class="contract-kpi-label">Disponíveis</div>
      </div>
      <div class="contract-kpi">
        <div class="contract-kpi-val">${totalPct}%</div>
        <div class="contract-kpi-label">Ocupação</div>
        <div class="contract-kpi-bar"><div class="contract-kpi-bar-fill" style="width:${Math.min(totalPct,100)}%;background:${totalPct>100?'var(--red)':totalPct>=90?'var(--yellow)':'var(--green)'}"></div></div>
      </div>
      <div class="contract-kpi">
        <div class="contract-kpi-val" style="color:var(--brown)">${fmtBRL(totalCustoUso)}</div>
        <div class="contract-kpi-label">Custo em uso / mês</div>
      </div>
      <div class="contract-kpi">
        <div class="contract-kpi-val" style="color:${totalCustoOcioso>0?'var(--red)':'var(--green)'}">${totalCustoOcioso>0?fmtBRL(totalCustoOcioso):'R$ 0,00'}</div>
        <div class="contract-kpi-label">Custo ocioso / mês</div>
      </div>`;
  }

  // ── Fonte de dados ──
  const hintEl=document.getElementById('contractSourceHint');
  if(hintEl){
    const hasAz=azureSubs.length>0;
    hintEl.innerHTML=hasAz?'<span style="color:var(--green)">● Azure</span> dados do tenant':'<span style="color:var(--muted)">Sem dados do Azure — execute um sync</span>';
  }

  // ── Tabela principal ──
  const rows=licData.map(({l,sd,free,pct,usedCost,freeCost,over,warn})=>{
    const srcIcon=sd.hasAzure?'<span title="Dados do Azure" style="color:var(--green);font-size:10px;margin-left:4px">●</span>':'';
    return`<tr>
      <td>${licBadge(l.id)}${srcIcon}</td>
      <td>${sd.contratadas>0?'<strong>'+sd.contratadas+'</strong>':'<span style="color:var(--muted)">—</span>'}</td>
      <td><strong>${sd.emUso}</strong></td>
      <td>${sd.contratadas>0?`<strong style="color:${over?'var(--red)':free>0?'var(--green)':'var(--muted)'}">${free}</strong>`:'—'}</td>
      <td style="min-width:90px">${pct!=null?`
        <div style="display:flex;align-items:center;gap:7px;">
          <div style="flex:1;height:5px;background:var(--sand-lt);border-radius:3px;overflow:hidden">
            <div style="width:${Math.min(pct,100)}%;height:100%;border-radius:3px;background:${over?'var(--red)':warn?'var(--yellow)':'var(--green)'}"></div>
          </div>
          <span style="font-size:11px;font-weight:700;color:${over?'var(--red)':warn?'var(--yellow)':'var(--muted)'};white-space:nowrap">${pct}%</span>
        </div>`:'—'}</td>
      <td><strong style="color:var(--brown)">${usedCost>0?fmtBRL(usedCost):'—'}</strong></td>
      <td><span style="color:${freeCost>0?'var(--red)':sd.contratadas>0?'var(--green)':'var(--muted)'}">${freeCost>0?fmtBRL(freeCost):sd.contratadas>0?'R$ 0,00':'—'}</span></td>
    </tr>`;
  });

  // Linha de totais
  rows.push(`<tr style="background:var(--sand-lt);font-weight:700">
    <td>Total</td>
    <td>${totalContratadas}</td>
    <td>${totalEmUso}</td>
    <td style="color:${totalContratadas-totalEmUso<0?'var(--red)':'var(--green)'}">${totalContratadas-totalEmUso}</td>
    <td>${totalContratadas>0?Math.round(totalEmUso/totalContratadas*100)+'%':'—'}</td>
    <td style="color:var(--brown)">${fmtBRL(totalCustoUso)}</td>
    <td style="color:${totalCustoOcioso>0?'var(--red)':'var(--green)'}">${totalCustoOcioso>0?fmtBRL(totalCustoOcioso):'R$ 0,00'}</td>
  </tr>`);

  document.getElementById('contractTableBody').innerHTML=rows.join('');

  // Renderizar fatura
  initFatura();
}

function openContractModal(licId=null){
  const sel=document.getElementById('cLicId');
  sel.innerHTML='<option value="">Selecione...</option>'+
    LICENSES.filter(l=>l.id!=='none'&&l.id!=='other').map(l=>`<option value="${l.id}">${l.name}</option>`).join('');
  if(licId){
    const ex=contracts.find(c=>c.licId===licId);
    if(ex){
      editingContractId=ex.id;
      document.getElementById('contractModalTitle').textContent='Editar Contrato';
      document.getElementById('cNome').value=ex.nome;
      sel.value=ex.licId;
      document.getElementById('cQtd').value=ex.qtd;
      document.getElementById('cPreco').value=ex.preco;
      document.getElementById('cInicio').value=ex.inicio||'';
      document.getElementById('cFim').value=ex.fim||'';
    }
  }else{
    editingContractId=null;
    document.getElementById('contractModalTitle').textContent='Novo Contrato';
    ['cNome','cQtd','cPreco','cInicio','cFim'].forEach(i=>document.getElementById(i).value='');
    sel.value='';
  }
  updateContractPrice();
  document.getElementById('contractOverlay').classList.add('open');
}
function closeContractModal(){document.getElementById('contractOverlay').classList.remove('open');}
function bgCloseContract(e){if(e.target.id==='contractOverlay')closeContractModal();}
function updateContractPrice(){
  const q=parseFloat(document.getElementById('cQtd').value)||0;
  const p=parseFloat(document.getElementById('cPreco').value)||0;
  document.getElementById('cpContrato').textContent=fmtBRL(q*p);
  document.getElementById('cpContratoAno').textContent=fmtBRL(q*p*12);
}
function saveContract(){
  const nome=document.getElementById('cNome').value.trim();
  const licId=document.getElementById('cLicId').value;
  const qtd=parseInt(document.getElementById('cQtd').value)||0;
  const preco=parseFloat(document.getElementById('cPreco').value)||0;
  const inicio=document.getElementById('cInicio').value;
  const fim=document.getElementById('cFim').value;
  if(!nome){toast('Atenção: Informe o nome do contrato.');return;}
  if(!licId){toast('Atenção: Selecione uma licença.');return;}
  if(!qtd){toast('Atenção: Informe a quantidade.');return;}
  if(editingContractId){
    const idx=contracts.findIndex(c=>c.id===editingContractId);
    const before={...contracts[idx]};
    contracts[idx]={...contracts[idx],nome,licId,qtd,preco,inicio,fim};
    const diffs=diffFields(before,contracts[idx],['nome','licId','qtd','preco','inicio','fim']);
    if(diffs.length)logChange('contract_update','contrato',editingContractId,nome,diffs);
  }else{
    const newId=Date.now();
    contracts.push({id:newId,nome,licId,qtd,preco,inicio,fim});
    logChange('contract_create','contrato',newId,nome,'Contrato criado: '+getLic(licId).short+' x'+qtd);
  }
  persistContracts();closeContractModal();renderContracts();toast('Contrato salvo!');
}

// ══════════ FATURA MICROSOFT ══════════

var faturaLines=[];

var FATURA_DEFAULT=[
  {venc:'Já Migrado',produto:'M 365 Business Std - Anual/Mensal',qtd:223,unit:78.15},
  {venc:'Já Migrado',produto:'M 365 Business Basic - Anual/Mensal',qtd:300,unit:31.21},
  {venc:'Já Migrado',produto:'M 365 Power Bi Pro - Anual/Mensal',qtd:33,unit:87.55},
  {venc:'Já Migrado',produto:'Planner Plan 1 - Anual/Mensal',qtd:3,unit:62.54},
  {venc:'Já Migrado',produto:'Office 365 F3 - Anual/Mensal',qtd:25,unit:25.00},
  {venc:'fev/26',produto:'Microsoft Teams Enterprise Anual/Mensal',qtd:1,unit:53.49},
  {venc:'fev/26',produto:'Office 365 E3 (no Teams) Anual/Mensal',qtd:1,unit:90.29},
  {venc:'mar/26',produto:'Microsoft 365 Business Standard',qtd:77,unit:78.15},
  {venc:'abr/26',produto:'Exchange Online Archiving for Exchange Online',qtd:4,unit:18.78},
  {venc:'jun/26',produto:'Microsoft 365 Copilot',qtd:1,unit:210.98},
  {venc:'jun/26',produto:'Microsoft Entra ID P1',qtd:1,unit:37.56},
  {venc:'ago/26',produto:'OneDrive for business (Plan 2)',qtd:1,unit:62.55},
  {venc:'ago/26',produto:'Power BI Premium Per User',qtd:1,unit:150.00},
  {venc:'set/26',produto:'Planner and Project Plan 3 Anual/Mensal',qtd:1,unit:187.55},
  {venc:'out/26',produto:'Microsoft 365 Apps for business Anual/Mensal',qtd:51,unit:51.54},
  {venc:'out/26',produto:'Office 365 F3 Anual/Mensal',qtd:186,unit:25.00},
  {venc:'nov/26',produto:'Office 365 F3 Anual/Mensal',qtd:12,unit:25.00},
  {venc:'nov/26',produto:'M 365 Power Bi Pro - Anual/Mensal',qtd:2,unit:87.55},
];

function initFatura(){
  // Carregar do data.json ou usar default
  if(typeof faturaData!=='undefined'&&Array.isArray(faturaData)&&faturaData.length){
    faturaLines=faturaData;
  }else{
    faturaLines=FATURA_DEFAULT.map(function(l,i){return{id:i+1,venc:l.venc,produto:l.produto,qtd:l.qtd,unit:l.unit};});
  }
  renderFatura();
}

function renderFatura(){
  var tbody=document.getElementById('faturaTableBody');
  if(!tbody)return;
  var canEd=canEdit();
  var html='';
  var grandTotal=0;
  for(var i=0;i<faturaLines.length;i++){
    var l=faturaLines[i];
    var total=Math.round(l.qtd*l.unit*100)/100;
    grandTotal+=total;
    if(canEd){
      html+='<tr>'+
        '<td><input type="text" value="'+esc(l.venc)+'" onchange="updFatura('+i+',\'venc\',this.value)"></td>'+
        '<td><input type="text" value="'+esc(l.produto)+'" onchange="updFatura('+i+',\'produto\',this.value)"></td>'+
        '<td><input type="number" value="'+l.qtd+'" min="0" onchange="updFatura('+i+',\'qtd\',this.value)" oninput="previewFaturaTotal('+i+',this)"></td>'+
        '<td><input type="number" value="'+l.unit.toFixed(2)+'" min="0" step="0.01" onchange="updFatura('+i+',\'unit\',this.value)" oninput="previewFaturaTotal('+i+',this)"></td>'+
        '<td class="fatura-val-total" id="faturaRowTotal'+i+'">'+fmtBRL(total)+'</td>'+
        '<td><button class="fatura-del-btn" onclick="delFaturaRow('+i+')" title="Remover">&times;</button></td>'+
      '</tr>';
    }else{
      html+='<tr>'+
        '<td>'+esc(l.venc)+'</td>'+
        '<td>'+esc(l.produto)+'</td>'+
        '<td style="text-align:right">'+l.qtd+'</td>'+
        '<td style="text-align:right">'+fmtBRL(l.unit)+'</td>'+
        '<td class="fatura-val-total">'+fmtBRL(total)+'</td>'+
      '</tr>';
    }
  }
  tbody.innerHTML=html;
  document.getElementById('faturaTotal').textContent=fmtBRL(grandTotal);
  document.getElementById('faturaTotalFooter').textContent=fmtBRL(grandTotal);
}

function previewFaturaTotal(idx,el){
  // Preview instantâneo ao digitar
  var row=faturaLines[idx];
  var tr=el.closest('tr');
  var inputs=tr.querySelectorAll('input[type="number"]');
  var q=parseFloat(inputs[0].value)||0;
  var u=parseFloat(inputs[1].value)||0;
  var totalEl=document.getElementById('faturaRowTotal'+idx);
  if(totalEl)totalEl.textContent=fmtBRL(Math.round(q*u*100)/100);
  // Recalcular grand total
  var grand=0;
  for(var i=0;i<faturaLines.length;i++){
    if(i===idx){grand+=Math.round(q*u*100)/100;}
    else{grand+=Math.round(faturaLines[i].qtd*faturaLines[i].unit*100)/100;}
  }
  document.getElementById('faturaTotal').textContent=fmtBRL(grand);
  document.getElementById('faturaTotalFooter').textContent=fmtBRL(grand);
}

function updFatura(idx,field,val){
  if(field==='qtd')faturaLines[idx].qtd=parseInt(val)||0;
  else if(field==='unit')faturaLines[idx].unit=parseFloat(val)||0;
  else faturaLines[idx][field]=val;
  renderFatura();
  saveFatura();
}

function addFaturaRow(){
  faturaLines.push({id:Date.now(),venc:'',produto:'',qtd:0,unit:0});
  renderFatura();
  // Focar no primeiro input da nova linha
  var tbody=document.getElementById('faturaTableBody');
  var lastRow=tbody.lastElementChild;
  if(lastRow){var inp=lastRow.querySelector('input');if(inp)inp.focus();}
}

function delFaturaRow(idx){
  const linha=faturaLines[idx];
  if(!confirm('Remover "'+linha.produto+'" da fatura?'))return;
  faturaLines.splice(idx,1);
  renderFatura();
  saveFatura();
}

function saveFatura(){
  fetch('/api/fatura',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(faturaLines)
  }).catch(function(){});
}
