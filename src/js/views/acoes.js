/* ══════════ CENTRO DE AÇÕES ══════════ */
let currentAcaoId=null;

function syncRadarAcoes(){
  const ativos=db.filter(r=>r.status==='Ativo');
  const bloqueados=db.filter(r=>r.status==='Inativo'&&r.licId!=='none');
  const opKw=['auxiliar','operador','costureira','cortador','estampador','bordadeiro','embalagem','expedição','conferente','separador','zelador','porteiro'];
  const superLic=ativos.filter(r=>{
    const cl=r.cargo.toLowerCase();
    return opKw.some(k=>cl.includes(k))&&['bstd','e3'].includes(r.licId);
  });

  // Criar/atualizar ações para bloqueados
  for(const r of bloqueados){
    const key='bloqueado_'+r.id;
    if(!acoes.find(a=>a.tipo===key)){
      acoes.push({
        id:Date.now()+Math.random()*1000|0,tipo:key,categoria:'bloqueado',
        userId:r.id,userName:r.nome,userEmail:r.email,
        descricao:'Usuário bloqueado com licença '+getLic(r.licId).short+' ativa ('+fmtBRL(userCost(r))+'/mês)',
        status:'novo',responsavel:'',
        comentarios:[],historico:[],
        criadoEm:new Date().toISOString(),atualizadoEm:new Date().toISOString()
      });
    }
  }

  // Criar/atualizar ações para super-licenciados
  for(const r of superLic){
    const key='superlic_'+r.id;
    if(!acoes.find(a=>a.tipo===key)){
      acoes.push({
        id:Date.now()+Math.random()*1000|0,tipo:key,categoria:'superlicenciado',
        userId:r.id,userName:r.nome,userEmail:r.email,
        descricao:'Cargo operacional ('+r.cargo+') com '+getLic(r.licId).short+' — economia de '+fmtBRL(userCost(r)-25)+'/mês com downgrade para F3',
        status:'novo',responsavel:'',
        comentarios:[],historico:[],
        criadoEm:new Date().toISOString(),atualizadoEm:new Date().toISOString()
      });
    }
  }

  // Remover ações cujo problema já foi resolvido (user não mais no grupo)
  const bloqIds=new Set(bloqueados.map(r=>'bloqueado_'+r.id));
  const supIds=new Set(superLic.map(r=>'superlic_'+r.id));
  acoes.forEach(a=>{
    if(a.categoria==='bloqueado'&&!bloqIds.has(a.tipo)&&a.status!=='resolvido')a.status='resolvido';
    if(a.categoria==='superlicenciado'&&!supIds.has(a.tipo)&&a.status!=='resolvido')a.status='resolvido';
  });

  // Deduplicar: para cada tipo, manter apenas a entrada mais recente
  const tipoMap=new Map();
  for(const a of acoes){
    const ex=tipoMap.get(a.tipo);
    if(!ex||new Date(a.criadoEm)>new Date(ex.criadoEm))tipoMap.set(a.tipo,a);
  }
  acoes=([...tipoMap.values()]);

  persist();
}

function renderAcoes(){
  const el=document.getElementById('acoesContent');
  if(!acoes.length){
    el.innerHTML=`<div style="text-align:center;padding:60px;color:var(--muted)">
      <div style="font-size:16px;font-weight:700;margin-bottom:6px">Nenhuma ação pendente</div>
      <div style="font-size:13px">Ações são criadas automaticamente a partir dos alertas do Radar.</div>
    </div>`;
    return;
  }

  const counts={novo:0,em_analise:0,resolvido:0,ignorado:0};
  acoes.forEach(a=>counts[a.status]=(counts[a.status]||0)+1);

  let html=`<div class="acao-kpis">
    <div class="acao-kpi"><div class="acao-kpi-val" style="color:var(--red)">${counts.novo}</div><div class="acao-kpi-label">Novos</div></div>
    <div class="acao-kpi"><div class="acao-kpi-val" style="color:var(--yellow)">${counts.em_analise}</div><div class="acao-kpi-label">Em Análise</div></div>
    <div class="acao-kpi"><div class="acao-kpi-val" style="color:var(--green)">${counts.resolvido}</div><div class="acao-kpi-label">Resolvidos</div></div>
    <div class="acao-kpi"><div class="acao-kpi-val" style="color:var(--muted)">${counts.ignorado}</div><div class="acao-kpi-label">Ignorados</div></div>
  </div>`;

  const statusOrder={novo:0,em_analise:1,ignorado:2,resolvido:3};
  const sorted=[...acoes].sort((a,b)=>(statusOrder[a.status]||0)-(statusOrder[b.status]||0)||(a.userName||'').localeCompare(b.userName||''));

  html+=`<div class="acao-list">`;
  for(const a of sorted){
    const badgeCls=a.status==='novo'?'acao-status-novo':a.status==='em_analise'?'acao-status-analise':a.status==='resolvido'?'acao-status-resolvido':'acao-status-ignorado';
    const statusLabel={novo:'Novo',em_analise:'Em Análise',resolvido:'Resolvido',ignorado:'Ignorado'}[a.status]||a.status;
    const catLabel=a.categoria==='bloqueado'?'Bloqueado com licença':'Super-licenciado';
    const catCls=a.categoria==='bloqueado'?'acao-cat-red':'acao-cat-yellow';
    const dtCriado=new Date(a.criadoEm).toLocaleDateString('pt-BR');
    html+=`<div class="acao-card" onclick="openAcaoModal(${a.id})">
      <div class="acao-card-top">
        <span class="acao-cat-badge ${catCls}">${catLabel}</span>
        <span class="acao-status-badge ${badgeCls}">${statusLabel}</span>
      </div>
      <div class="acao-card-name">${a.userName}</div>
      <div class="acao-card-desc">${a.descricao}</div>
      <div class="acao-card-footer">
        ${a.responsavel?`<span class="acao-card-resp">Resp: ${a.responsavel}</span>`:'<span class="acao-card-resp" style="color:var(--muted)">Sem responsável</span>'}
        <span class="acao-card-comments">${a.comentarios.length} coment.</span>
        <span style="color:var(--muted);font-size:11px">#${a.id} · ${dtCriado}</span>
      </div>
    </div>`;
  }
  html+=`</div>`;

  el.innerHTML=html;
}

function openAcaoModal(id){
  const a=acoes.find(x=>x.id===id);
  if(!a)return;
  currentAcaoId=id;
  document.getElementById('acaoModalTitle').textContent=a.userName;
  document.getElementById('acaoModalSub').textContent=a.descricao;
  document.getElementById('acaoStatus').value=a.status;
  document.getElementById('acaoResponsavel').value=a.responsavel||'';

  // Histórico
  const histEl=document.getElementById('acaoHistorico');
  if(a.historico.length){
    histEl.innerHTML=a.historico.map(h=>{
      const dt=new Date(h.quando);
      return`<div style="padding:4px 0;border-bottom:1px solid var(--border)">
        <strong>${h.campo}</strong>: ${h.de} → ${h.para}
        <span style="float:right">${dt.toLocaleDateString('pt-BR')} · ${h.autor||'—'}</span>
      </div>`;
    }).join('');
  }else{
    histEl.innerHTML='<div style="color:var(--muted);font-size:12px">Nenhuma alteração ainda.</div>';
  }

  // Comentários
  const commEl=document.getElementById('acaoComments');
  if(a.comentarios.length){
    commEl.innerHTML=a.comentarios.map(c=>{
      const dt=new Date(c.criadoEm);
      return`<div class="acao-comment-item">
        <div class="acao-comment-header"><strong>${c.autor}</strong><span>${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span></div>
        <div>${c.texto}</div>
      </div>`;
    }).join('');
  }else{
    commEl.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px 0">Nenhum comentário.</div>';
  }

  document.getElementById('acaoNewComment').value='';
  document.getElementById('acaoOverlay').classList.add('open');
}

function closeAcaoModal(){
  document.getElementById('acaoOverlay').classList.remove('open');
  currentAcaoId=null;
}

function updateAcaoStatus(){
  const a=acoes.find(x=>x.id===currentAcaoId);
  if(!a)return;
  const newStatus=document.getElementById('acaoStatus').value;
  if(newStatus===a.status)return;
  const s=authGetSession();
  const autor=s?s.name||s.username:'Sistema';
  a.historico.push({campo:'status',de:a.status,para:newStatus,autor,quando:new Date().toISOString()});
  a.status=newStatus;
  a.atualizadoEm=new Date().toISOString();
  logChange('acao_status','acao',a.id,a.userName,[{campo:'status',de:a.historico[a.historico.length-1].de,para:newStatus}]);
  persist();renderAcoes();openAcaoModal(currentAcaoId);
}

function setAcaoResponsavel(){
  const a=acoes.find(x=>x.id===currentAcaoId);
  if(!a)return;
  const newResp=document.getElementById('acaoResponsavel').value.trim();
  if(newResp===a.responsavel)return;
  const s=authGetSession();
  const autor=s?s.name||s.username:'Sistema';
  a.historico.push({campo:'responsavel',de:a.responsavel||'(vazio)',para:newResp||'(vazio)',autor,quando:new Date().toISOString()});
  a.responsavel=newResp;
  a.atualizadoEm=new Date().toISOString();
  persist();
}

function addAcaoComment(){
  const a=acoes.find(x=>x.id===currentAcaoId);
  if(!a)return;
  const texto=document.getElementById('acaoNewComment').value.trim();
  if(!texto)return;
  const s=authGetSession();
  const autor=s?s.name||s.username:'Sistema';
  a.comentarios.push({id:Date.now(),autor,texto,criadoEm:new Date().toISOString()});
  a.atualizadoEm=new Date().toISOString();
  logChange('acao_comment','acao',a.id,a.userName,'Comentário: '+texto.substring(0,50));
  persist();openAcaoModal(currentAcaoId);
}
