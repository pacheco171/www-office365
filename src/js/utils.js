/* ══════════ HELPERS — Funções utilitárias compartilhadas ══════════ */

/** Escapa HTML para prevenir XSS ao inserir texto no DOM */
function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}

/** Escapa aspas para uso seguro em atributos HTML */
function escAttr(s){return s.replace(/'/g,"\\'").replace(/"/g,'&quot;');}

/** Extrai iniciais do nome (até 2 letras) para exibir em avatares */
const ini=n=>n.trim().split(' ').filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('');

/** Formata data ISO (YYYY-MM-DD) para formato brasileiro (DD/MM/YYYY) */
const fmtDate=iso=>{if(!iso)return'—';const[y,m,d]=iso.split('-');return`${d}/${m}/${y}`;};

/** Formata valor numérico como moeda brasileira (R$ 1.234,56) */
const fmtBRL=v=>'R$ '+v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});

/** Busca licença pelo ID, retorna 'none' como fallback */
const getLic=id=>licById[id]||licById['none'];

/** Nomes abreviados dos meses (índice 1-12, posição 0 vazia) */
const MESES=['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

/** Gera badge HTML colorido para exibir tipo de licença */
function licBadge(id){const l=getLic(id);return`<span class="lic-badge ${l.cls}">${l.ico} ${l.short}</span>`;}

/** Gera badge HTML de status (Ativo/Pendente/Inativo) com dot colorido */
function statusBadge(s){
  const cls=s==='Ativo'?'b-active':s==='Pendente'?'b-pending':'b-inactive';
  const dot=s==='Ativo'?'var(--green)':s==='Pendente'?'var(--yellow)':'var(--muted)';
  return`<span class="badge ${cls}"><span class="bdot" style="background:${dot}"></span>${s}</span>`;
}

/** Gera chip de variação numérica (+N verde / -N vermelho / — neutro) */
function deltaBadge(v,invert=false){
  if(v===0||v==null)return'<span class="chip chip-neutral">—</span>';
  const up=invert?v<0:v>0;
  const cls=up?'chip-up':'chip-down';
  const sign=v>0?'+':'';
  return`<span class="chip ${cls}">${sign}${v}</span>`;
}

/** Gera chip de variação monetária em BRL (+R$X verde / -R$X vermelho) */
function deltaBRLBadge(v){
  if(v===0||v==null)return'<span class="chip chip-neutral">—</span>';
  const cls=v>0?'chip-up':'chip-down';
  const sign=v>0?'+':'';
  return`<span class="chip ${cls}">${sign}${fmtBRL(Math.abs(v))}</span>`;
}
