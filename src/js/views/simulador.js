/* ══════════ SIMULADOR DE ECONOMIA ══════════ */
let simSelections=new Set();

function getSimCandidates(){
  const ativos=db.filter(r=>r.status==='Ativo');
  const bloqueados=db.filter(r=>r.status==='Inativo'&&r.licId!=='none');
  const opKw=['auxiliar','operador','costureira','cortador','estampador','bordadeiro','embalagem','expedição','conferente','separador','zelador','porteiro'];
  const superLic=ativos.filter(r=>{
    const cl=r.cargo.toLowerCase();
    return opKw.some(k=>cl.includes(k))&&['bstd','e3'].includes(r.licId);
  });

  const candidates=[];

  for(const r of bloqueados){
    candidates.push({
      id:'rem_'+r.id,tipo:'remover',userId:r.id,userName:r.nome,setor:r.setor,
      licAtual:getLic(r.licId).short,proposta:'Outros',
      economiaMensal:userCost(r),
      descricao:'Remover licença de usuário bloqueado'
    });
  }

  for(const r of superLic){
    const economia=userCost(r)-25;
    candidates.push({
      id:'dwn_'+r.id,tipo:'downgrade',userId:r.id,userName:r.nome,setor:r.setor,
      licAtual:getLic(r.licId).short,proposta:'O365 F3',
      economiaMensal:economia,
      descricao:'Downgrade para F3 — cargo operacional'
    });
  }

  return candidates;
}

function renderSimulador(){
  const el=document.getElementById('simuladorContent');
  const candidates=getSimCandidates();

  if(!candidates.length){
    el.innerHTML=`<div style="text-align:center;padding:60px;color:var(--muted)">
      <div style="font-size:16px;font-weight:700;margin-bottom:6px">Nenhuma oportunidade encontrada</div>
      <div style="font-size:13px">O Radar não identificou bloqueados ou super-licenciados no momento.</div>
    </div>`;
    return;
  }

  // Limpar seleções que não existem mais
  simSelections=new Set([...simSelections].filter(id=>candidates.find(c=>c.id===id)));

  const selectedItems=candidates.filter(c=>simSelections.has(c.id));
  const totalEconomia=selectedItems.reduce((s,c)=>s+c.economiaMensal,0);
  const totalPossivel=candidates.reduce((s,c)=>s+c.economiaMensal,0);

  // Agrupar por tipo
  const removals=candidates.filter(c=>c.tipo==='remover');
  const downgrades=candidates.filter(c=>c.tipo==='downgrade');

  let html=`<div class="sim-summary-bar">
    <div>
      <span style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-weight:700">Economia selecionada</span>
      <div style="font-family:'Outfit',sans-serif;font-size:24px;font-weight:800;color:var(--green)">${fmtBRL(totalEconomia)}<span style="font-size:14px;font-weight:400;color:var(--muted)">/mês</span></div>
      <div style="font-size:12px;color:var(--green)">${fmtBRL(totalEconomia*12)}/ano</div>
    </div>
    <div style="text-align:center">
      <div style="font-size:24px;font-weight:800;color:var(--brown)">${selectedItems.length}</div>
      <div style="font-size:11px;color:var(--muted)">de ${candidates.length} ações</div>
    </div>
    <div style="text-align:right">
      <span style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-weight:700">Total possível</span>
      <div style="font-family:'Outfit',sans-serif;font-size:20px;font-weight:700;color:var(--muted)">${fmtBRL(totalPossivel)}/mês</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn btn-outline" onclick="exportSimCSV()" ${!selectedItems.length?'disabled':''}>Exportar CSV</button>
      <button class="btn btn-outline" onclick="printSimSummary()" ${!selectedItems.length?'disabled':''}>Imprimir</button>
    </div>
  </div>`;

  function renderGroup(title,color,items){
    if(!items.length)return'';
    const groupId='simgrp_'+title.replace(/\s/g,'');
    const allSelected=items.every(c=>simSelections.has(c.id));
    let g=`<div class="sim-group">
      <div class="sim-group-header">
        <label class="sim-checkbox-wrap"><input type="checkbox" ${allSelected?'checked':''} onchange="toggleSimSelectAll('${title.replace(/\s/g,'')}',this.checked,[${items.map(c=>"'"+c.id+"'").join(',')}])"><span class="sim-check-mark"></span></label>
        <span style="font-size:13px;font-weight:700;color:${color}">${title}</span>
        <span style="font-size:12px;color:var(--muted);margin-left:8px">${items.length} ações · ${fmtBRL(items.reduce((s,c)=>s+c.economiaMensal,0))}/mês</span>
      </div>`;
    for(const c of items){
      const sel=simSelections.has(c.id);
      g+=`<div class="sim-row${sel?' sim-row-selected':''}">
        <label class="sim-checkbox-wrap"><input type="checkbox" ${sel?'checked':''} onchange="toggleSimSelection('${c.id}')"><span class="sim-check-mark"></span></label>
        <div style="flex:1">
          <div style="font-weight:600;font-size:13px">${c.userName}</div>
          <div style="font-size:11px;color:var(--muted)">${c.setor} · ${c.descricao}</div>
        </div>
        <div style="text-align:center;min-width:140px">
          <span style="font-size:11px;color:var(--muted)">${c.licAtual}</span>
          <span style="color:var(--muted)"> → </span>
          <span style="font-size:11px;font-weight:700">${c.proposta}</span>
        </div>
        <div style="text-align:right;min-width:120px;font-weight:700;color:var(--green)">${fmtBRL(c.economiaMensal)}/mês</div>
      </div>`;
    }
    g+=`</div>`;
    return g;
  }

  html+=renderGroup('Remover licença (bloqueados)','var(--red)',removals);
  html+=renderGroup('Downgrade para F3 (operacionais)','var(--yellow)',downgrades);

  el.innerHTML=html;
}

function toggleSimSelection(id){
  if(simSelections.has(id))simSelections.delete(id);
  else simSelections.add(id);
  renderSimulador();
}

function toggleSimSelectAll(group,checked,ids){
  for(const id of ids){
    if(checked)simSelections.add(id);
    else simSelections.delete(id);
  }
  renderSimulador();
}

function exportSimCSV(){
  const candidates=getSimCandidates().filter(c=>simSelections.has(c.id));
  if(!candidates.length)return;
  let csv='Nome,Setor,Tipo,Licença Atual,Proposta,Economia Mensal\n';
  for(const c of candidates){
    csv+=`"${c.userName}","${c.setor}","${c.tipo}","${c.licAtual}","${c.proposta}","${c.economiaMensal.toFixed(2)}"\n`;
  }
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='simulador_economia.csv';a.click();
  URL.revokeObjectURL(url);
  toast('CSV exportado com '+candidates.length+' ações');
}

function printSimSummary(){
  const candidates=getSimCandidates().filter(c=>simSelections.has(c.id));
  if(!candidates.length)return;
  const total=candidates.reduce((s,c)=>s+c.economiaMensal,0);
  const w=window.open('','_blank','width=800,height=600');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Simulador de Economia — LIVE! M365</title>
    <style>body{font-family:'Lexend',sans-serif;padding:40px;color:#1a1816}h1{font-size:22px;margin-bottom:4px}
    table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:8px 12px;border-bottom:1px solid #e5ddd0;text-align:left;font-size:13px}
    th{background:#f5f0e8;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;color:#8a8070}
    .total{margin-top:20px;font-size:18px;font-weight:800;color:#5a8a6a}</style></head><body>
    <h1>Simulador de Economia — LIVE! M365</h1>
    <p style="color:#8a8070;font-size:13px">${candidates.length} ações selecionadas · Gerado em ${new Date().toLocaleDateString('pt-BR')}</p>
    <table><thead><tr><th>Nome</th><th>Setor</th><th>Tipo</th><th>De</th><th>Para</th><th>Economia/mês</th></tr></thead><tbody>`);
  for(const c of candidates){
    w.document.write(`<tr><td>${c.userName}</td><td>${c.setor}</td><td>${c.tipo}</td><td>${c.licAtual}</td><td>${c.proposta}</td><td>R$ ${c.economiaMensal.toFixed(2)}</td></tr>`);
  }
  w.document.write(`</tbody></table>
    <div class="total">Economia total: ${fmtBRL(total)}/mês · ${fmtBRL(total*12)}/ano</div>
    </body></html>`);
  w.document.close();
  w.print();
}
