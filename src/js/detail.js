/* ══════════ DETAIL PANEL — Painel lateral de detalhes ══════════ */

/** Badge de origem do cargo */
function cargoOrigemBadge(r){
  if(r.cargoFixo)return'<span class="cargo-badge cargo-badge-override" title="Definido manualmente">manual</span>';
  var o=r.cargoOrigem||'ad';
  if(o==='fallback')return'<span class="cargo-badge cargo-badge-fallback" title="Cargo não preenchido no AD — valor padrão">sem dado no AD</span>';
  return'<span class="cargo-badge cargo-badge-ad" title="Obtido do Active Directory">AD</span>';
}

/** Abre painel lateral com detalhes completos do colaborador */
function openDetail(id){
  const r=db.find(x=>x.id===id);if(!r)return;
  const l=getLic(r.licId);
  const c=userCost(r);
  const addonList=(r.addons||[]).map(a=>licById[a]).filter(Boolean);
  const lcStyle=`background:${l.color}10;border-color:${l.color}30;color:${l.color}`;
  document.getElementById('detailContent').innerHTML=`
    <div class="dp-avatar">${ini(r.nome)}</div>
    <div class="dp-name">${r.nome}</div>
    <div class="dp-role">${r.cargo} · ${r.setor}${r.area?' / '+r.area:''}${r.subarea?' / '+r.subarea:''}</div>
    <div class="dp-section">
      <div class="dp-sec-title">Informações</div>
      <div class="dp-row"><span class="dp-key">E-mail</span><span class="dp-val" style="font-size:11px">${r.email}</span></div>
      <div class="dp-row"><span class="dp-key">Setor</span><span class="dp-val">${r.setor}${r.setorFixo?' <span title="Setor fixo" style="font-size:11px">🔒</span>':''}</span></div>
      ${r.area?`<div class="dp-row"><span class="dp-key">Área</span><span class="dp-val">${r.area}</span></div>`:''}
      ${r.subarea?`<div class="dp-row"><span class="dp-key">Sub-área</span><span class="dp-val">${r.subarea}</span></div>`:''}
      ${r.responsavel?`<div class="dp-row"><span class="dp-key">Responsável</span><span class="dp-val">${r.responsavel}</span></div>`:''}
      <div class="dp-row"><span class="dp-key">Cargo</span><span class="dp-val" style="display:inline-flex;align-items:center;gap:8px"><span>${r.cargo}</span>${cargoOrigemBadge(r)}</span></div>
      <div class="dp-row"><span class="dp-key">Criado em</span><span class="dp-val">${fmtDate(r.dataISO)}</span></div>
      <div class="dp-row"><span class="dp-key">Status</span><span class="dp-val">${statusBadge(r.status)}</span></div>
      ${r.demissao?`<div class="dp-row"><span class="dp-key">Bloqueado em</span><span class="dp-val" style="color:var(--red)">${fmtDate(r.demissao)}</span></div>`:''}
    </div>
    <div class="dp-section">
      <div class="dp-sec-title">Licença Microsoft 365</div>
      <div class="lic-detail-card" style="${lcStyle}">
        <div class="ldc-name">${l.name}</div>
        <div class="ldc-desc">${l.tier}${addonList.length?` + ${addonList.map(a=>a.short).join(', ')}`:''}
        </div>
        ${r.licRaw&&r.licRaw.includes('+')?`<div style="margin-top:8px;font-size:11px;opacity:.55;line-height:1.7">${r.licRaw.split('+').map(p=>`<div>· ${p.trim()}</div>`).join('')}</div>`:''}
        <div class="ldc-features">${l.features.map(f=>`<div class="ldc-feat"><span class="ldc-feat-dot" style="color:${l.color}">●</span><span>${f}</span></div>`).join('')}</div>
        <div class="ldc-cost">
          <div><div class="ldc-cost-label">Por mês</div><div class="ldc-cost-val" style="color:${l.color}">${c>0?fmtBRL(c):'Gratuito'}</div></div>
          <div style="text-align:right"><div class="ldc-cost-label">Por ano</div><div class="ldc-cost-val">${c>0?fmtBRL(c*12):'—'}</div></div>
        </div>
      </div>
      ${addonList.filter(a=>a.price>0).length?`<div style="margin-top:8px;font-size:11px;color:var(--muted)">
        Inclui add-ons: ${addonList.map(a=>`${a.short} ${a.price>0?'('+fmtBRL(a.price)+'/mês)':'(grátis)'}`).join(' · ')}
      </div>`:''}
    </div>
    ${(function(){
      var u=(typeof getUserUsage==='function')?getUserUsage(r):null;
      if(!u)return'';
      var rows=[];
      if(u.mailboxMB!=null)rows.push('<div class="dp-row"><span class="dp-key">Caixa de email</span><span class="dp-val">'+fmtStorage(u.mailboxMB)+' usados'+(u.mailboxItems?' ('+u.mailboxItems+' itens)':'')+'</span></div>');
      if(u.onedriveMB!=null)rows.push('<div class="dp-row"><span class="dp-key">OneDrive</span><span class="dp-val">'+fmtStorage(u.onedriveMB)+' usados'+(u.onedriveFiles?' ('+u.onedriveFiles+' arquivos)':'')+'</span></div>');
      if(u.appsDesktop!=null)rows.push('<div class="dp-row"><span class="dp-key">Apps desktop</span><span class="dp-val">'+(u.appsDesktop?'<span style="color:var(--green)">Usa</span>':'<span style="color:var(--muted)">Nao usa</span>')+'</span></div>');
      if(u.appsWeb!=null)rows.push('<div class="dp-row"><span class="dp-key">Apps web</span><span class="dp-val">'+(u.appsWeb?'<span style="color:var(--green)">Usa</span>':'<span style="color:var(--muted)">Nao usa</span>')+'</span></div>');
      if(u.lastActivity)rows.push('<div class="dp-row"><span class="dp-key">Ultima atividade</span><span class="dp-val">'+u.lastActivity+'</span></div>');
      if(!rows.length)return'';
      return'<div class="dp-section"><div class="dp-sec-title">Dados de Uso</div>'+rows.join('')+'</div>';
    })()}
    <div style="margin-top:20px;display:flex;gap:8px">
      <button class="btn btn-outline" style="flex:1;justify-content:center" onclick="closeDetail()">Fechar</button>
      ${userRole!=='gestor'?`<button class="btn btn-dark" style="flex:1;justify-content:center" onclick="closeDetail();openModal(${r.id})">Editar</button>`:''}
    </div>`;
  document.getElementById('detailPanel').classList.add('open');
}

/** Fecha o painel lateral de detalhes */
function closeDetail(){document.getElementById('detailPanel').classList.remove('open');}
