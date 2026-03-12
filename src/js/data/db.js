/* ══════════ DATA STORE — Estado global da aplicação ══════════
   Dados em memória carregados do servidor via /api/data na inicialização.
   persist() salva TODOS os dados de volta ao servidor atomicamente. */
let db = [];           // Lista de colaboradores ativos (último snapshot)
let snapshots = [];    // Histórico mensal de snapshots [{mes, ano, label, data:[...]}]
let acoes = [];        // Ações/tarefas pendentes
let usageData = {};    // Dados de uso por email {email: {mailboxMB, onedriveMB, ...}}
let faturaData = [];   // Linhas da fatura Microsoft [{venc, produto, qtd, unit}]

/** Persiste todos os dados no servidor de forma atômica (POST /api/data).
    Agrupa db, snapshots, contracts, acoes e usage em um único payload. */
function persist(){
  fetch('/api/data',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({db,snapshots,contracts,acoes,usage:usageData})
  }).catch(()=>{});
}

// ── Subdivisão do Comercial por responsável ──────────────────────────────────
const COMERCIAL_RESPONSAVEIS = [
  { key: 'operacional',  label: 'Operacional',  resp: 'Alan' },
  { key: 'exportacao',   label: 'Exportação',   resp: 'Josi' },
  { key: 'varejo',       label: 'Varejo',       resp: 'Gabi' },
  { key: 'atacado',      label: 'Atacado',      resp: 'Paty' },
  { key: 'planejamento', label: 'Planejamento', resp: 'Sandro' },
];

// ── Estado de UI (local por usuário) ─────────────────────────────────────────
let selLicId='bbasic',sortField=null,sortAsc=true,currentPage=1,licPage=1,editingId=null,filterLicId=null;

// Snapshot selecionado no dashboard (null = dados atuais do db)
let dashSnapIdx=null;

/** Retorna os dados ativos para o dashboard: snapshot selecionado ou db atual */
function dashData(){
  if(dashSnapIdx!=null&&snapshots[dashSnapIdx])return snapshots[dashSnapIdx].data;
  return db;
}
let PER=10;
