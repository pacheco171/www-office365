/* ══════════ MODAL EDIT — Criação e edição de colaboradores ══════════ */

/** Renderiza grid de seleção de licença no modal */
function buildLicGrid(){
  document.getElementById('licGrid').innerHTML=LICENSES.filter(l=>!l.addon||l.id==='pbi').map(l=>
    `<div class="lic-opt${l.id===selLicId?' sel':''}" data-id="${l.id}" onclick="pickLic('${l.id}')">
      <div class="lic-opt-ico">${l.ico}</div>
      <div class="lic-opt-name">${l.short}</div>
      <div class="lic-opt-price">${l.price>0?fmtBRL(l.price)+'/mês':'Gratuito'}</div>
      <div class="lic-opt-tier">${l.tier}</div>
    </div>`).join('');
}

/** Callback de seleção de licença: atualiza UI e custo preview */
function pickLic(id){
  selLicId=id;
  document.querySelectorAll('.lic-opt').forEach(el=>el.classList.toggle('sel',el.dataset.id===id));
  const l=getLic(id);
  document.getElementById('cpLic').textContent=l.name;
  document.getElementById('cpDesc').textContent=l.features[0]+(l.features.length>1?` + ${l.features.length-1} recursos`:'');
  document.getElementById('cpMes').textContent=fmtBRL(l.price);
  document.getElementById('cpAno').textContent=fmtBRL(l.price*12);
}

/** Popula datalist de responsáveis baseado no setor selecionado */
function updateResponsavelSuggestions(){
  const setor=document.getElementById('fSetor').value.trim();
  const dl=document.getElementById('respList');
  if(setor==='Comercial'){
    dl.innerHTML=COMERCIAL_RESPONSAVEIS.map(r=>`<option value="${r.label} (${r.resp})">`).join('');
  }else{
    const existing=[...new Set(db.filter(r=>r.setor===setor&&r.responsavel).map(r=>r.responsavel))].sort((a,b)=>a.localeCompare(b));
    dl.innerHTML=existing.map(v=>`<option value="${v}">`).join('');
  }
}

/** Abre modal de criação/edição de colaborador. Se id=null, modo criação. */
function openModal(id=null){
  editingId=id;buildLicGrid();
  if(id){
    const r=db.find(x=>x.id===id);
    document.getElementById('modalTitleText').textContent='Editar Colaborador';
    document.getElementById('fNome').value=r.nome;document.getElementById('fEmail').value=r.email;
    document.getElementById('fSetor').value=r.setor;document.getElementById('fCargo').value=r.cargo;
    document.getElementById('fData').value=r.dataISO;document.getElementById('fStatus').value=r.status;
    document.getElementById('fResponsavel').value=r.responsavel||'';
    selLicId=r.licId;document.getElementById('saveBtn').textContent='Salvar Alterações';
  }else{
    document.getElementById('modalTitleText').textContent='Novo Colaborador';
    ['fNome','fEmail','fSetor','fCargo','fResponsavel'].forEach(i=>document.getElementById(i).value='');
    document.getElementById('fData').valueAsDate=new Date();document.getElementById('fStatus').value='Ativo';
    selLicId='bbasic';document.getElementById('saveBtn').textContent='Salvar Colaborador';
  }
  updateResponsavelSuggestions();
  document.getElementById('fSetor').addEventListener('input',updateResponsavelSuggestions);
  buildLicGrid();pickLic(selLicId);
  document.getElementById('modalOverlay').classList.add('open');
}

/** Fecha o modal e limpa estado de edição */
function closeModal(){document.getElementById('modalOverlay').classList.remove('open');editingId=null;}

/** Fecha modal ao clicar no overlay (fundo) */
function bgClose(e){if(e.target.id==='modalOverlay')closeModal();}

/** Valida, salva (cria ou atualiza) colaborador e persiste */
function saveColaborador(){
  const nome=document.getElementById('fNome').value.trim();
  const setor=document.getElementById('fSetor').value.trim();
  if(!nome){toast('Atenção: Informe o nome.');return;}
  if(!setor){toast('Atenção: Informe o setor.');return;}
  const email=document.getElementById('fEmail').value.trim()||nome.split(' ')[0].toLowerCase()+'@liveoficial.com.br';
  const cargo=document.getElementById('fCargo').value.trim()||'Colaborador';
  const status=document.getElementById('fStatus').value;
  const dataISO=document.getElementById('fData').value||new Date().toISOString().slice(0,10);
  const responsavel=document.getElementById('fResponsavel').value.trim();
  if(editingId){
    const idx=db.findIndex(x=>x.id===editingId);
    const before={...db[idx]};
    db[idx]={...db[idx],nome,email,setor,cargo,status,dataISO,licId:selLicId,addons:[],responsavel};
    const diffs=diffFields(before,db[idx],['nome','email','setor','cargo','status','licId','responsavel']);
    if(diffs.length)logChange('update','colaborador',editingId,nome,diffs);
    toast(''+nome+' atualizado!');
  }else{
    const newId=Date.now();
    db.push({id:newId,nome,email,setor,cargo,licId:selLicId,addons:[],licRaw:'',status,dataISO,responsavel});
    logChange('create','colaborador',newId,nome,'Novo colaborador criado');
    toast(''+nome+' adicionado!');
  }
  persist();
  refresh();closeModal();
}
