/* ══════════ LICENSES — valores reais da fatura ══════════ */
// Preços por usuário/mês conforme fatura enviada
// Apps for Business: R$51,54/mês conforme fatura
let LICENSES=[
  {id:'none',    name:'Sem Licença 365',         short:'Sem Lic.',    price:0,    addon:false, tier:'—',         cls:'lic-none',    ico:'○', color:'#8a8070',
   csvNames:['unlicensed'], features:['Sem acesso ao Microsoft 365']},
  {id:'bstd',    name:'M365 Business Standard', short:'Business Standard', price:78.15,addon:false, tier:'Business',  cls:'lic-bstd',    ico:'◉', color:'#7a5c30',
   csvNames:['microsoft 365 business standard'], features:['Apps desktop completos','Teams + Webinars','Exchange 50 GB','OneDrive 1 TB','SharePoint']},
  {id:'bbasic',  name:'M365 Business Basic',    short:'Business Basic',   price:31.21,addon:false, tier:'Business',  cls:'lic-bbasic',  ico:'◎', color:'#9c7a52',
   csvNames:['microsoft 365 business basic'], features:['Apps Office web e mobile','Teams completo','Exchange 50 GB','OneDrive 1 TB','SharePoint']},
  {id:'apps',    name:'M365 Apps for Business', short:'Apps Business',    price:51.54,addon:true,  tier:'Add-on',    cls:'lic-apps',    ico:'◍', color:'#c97a20',
   csvNames:['microsoft 365 apps for business'], features:['Word/Excel/PowerPoint desktop','OneDrive 1 TB','Sem Exchange','Sem Teams']},
  {id:'f3',      name:'Office 365 F3',          short:'O365 F3',     price:25,   addon:false, tier:'Frontline', cls:'lic-f3',      ico:'◌', color:'#0078d4',
   csvNames:['office 365 f3'], features:['Apps web e mobile','Teams Essentials','Exchange 2 GB','OneDrive 2 GB']},
  {id:'e3',      name:'Office 365 E3',          short:'O365 E3',     price:90.29,addon:false, tier:'Enterprise',cls:'lic-e3',      ico:'⬡', color:'#3a7050',
   csvNames:['office 365 e3','office 365 e3 (no teams)'], features:['Apps desktop ilimitados','Teams Enterprise','Exchange ilimitado','Compliance e auditoria']},
  {id:'pbi',     name:'Power BI Pro',           short:'PBI Pro',     price:87.55,addon:true,  tier:'Add-on',    cls:'lic-pbi',     ico:'◈', color:'#b8903a',
   csvNames:['power bi pro','power bi premium per user','m 365 power bi pro'], features:['Dashboards compartilhados','Relatórios avançados','API e embed']},
  {id:'planner1',name:'Planner Plan 1',          short:'Planner 1',   price:62.54,addon:true,  tier:'Add-on',    cls:'lic-planner1',ico:'▣', color:'#217346',
   csvNames:['planner plan 1'], features:['Planner Premium','Gestão de tarefas avançada','Visualizações de cronograma']},
  {id:'planner3',name:'Planner and Project Plan 3',short:'Planner+Project 3',price:187.55,addon:true,tier:'Add-on',  cls:'lic-planner3',ico:'▩', color:'#1a5c30',
   csvNames:['planner and project plan 3','project professional'], features:['Planner Premium','Project Online','Gestão de projetos completa','Relatórios de portfólio']},
  {id:'other',   name:'Sem Licença 365',         short:'Sem Lic.',    price:0,    addon:false, tier:'—',         cls:'lic-none',    ico:'○', color:'#8a8070',
   csvNames:[], features:['Licença não mapeada']},
];

const LIC_PRIORITY=['e3','bstd','bbasic','f3','pbi','planner3','planner1','apps','other','none'];

// Detecta se uma string de licença significa "sem licença"
function isSemLicenca(txt) {
  var t = String(txt || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return !t || t === '-' || t === 'unlicensed' ||
    t.indexOf('sem licenca') >= 0 || t.indexOf('no license') >= 0 ||
    t.indexOf('unassigned') >= 0;
}

// Mapa SKU partNumber → licId (para resolver licRaw com partNumbers do Azure)
const SKU_LIC_MAP={
  'O365_BUSINESS_ESSENTIALS':'bbasic','O365_BUSINESS_PREMIUM':'bstd','O365_BUSINESS':'apps',
  'OFFICE_365_E3':'e3','OFFICE_365_E3_(NO_TEAMS)':'e3','OFFICESUBSCRIPTION':'apps',
  'SPB':'bstd','SMB_BUSINESS_PREMIUM':'bstd','SMB_BUSINESS_ESSENTIALS':'bbasic','SMB_BUSINESS':'apps',
  'ENTERPRISEPACK':'e3','DESKLESSPACK':'f3','POWER_BI_PRO':'pbi','M365_F1_COMM':'f3','SPE_F1':'f3',
  'PROJECT_P1':'planner1','PROJECTPROFESSIONAL':'planner3',
};
const SKU_FREE=new Set(['FLOW_FREE','POWER_BI_STANDARD','TEAMS_EXPLORATORY','STREAM',
  'MICROSOFT_TEAMS_ENTERPRISE_NEW','AAD_PREMIUM','EXCHANGEARCHIVE_ADDON',
  'POWERAPPS_DEV','CCIBOTS_PRIVPREV_VIRAL','MICROSOFT_365_COPILOT',
  'POWER_PAGES_VTRIAL_FOR_MAKERS','WACONEDRIVEENTERPRISE','RIGHTSMANAGEMENT_ADHOC',
  'MCOEV','MCOMEETADV','PHONESYSTEM_VIRTUALUSER','WINDOWS_STORE','POWER_AUTOMATE_FREE','FORMS_PRO',
  'VISIOCLIENT','THREAT_INTELLIGENCE']);

// Resolve licId principal E lista de add-ons pagos de uma string "LicA+LicB+LicC"
function resolveLicIds(licString){
  if(isSemLicenca(licString))
    return{licId:'none',addons:[],licRaw:licString||''};
  const parts=licString.split('+').map(s=>s.trim());
  const found=[]; // [{id, addon}]
  for(const part of parts){
    const upper=part.toUpperCase();
    const lower=part.toLowerCase();
    // Tentar SKU partNumber primeiro
    const skuLid=SKU_LIC_MAP[upper];
    if(skuLid){
      const lic=licById[skuLid];
      found.push({id:skuLid,addon:lic?lic.addon:false});
      continue;
    }
    if(SKU_FREE.has(upper))continue;
    // Tentar csvNames (nomes amigáveis)
    for(const l of LICENSES){
      if(l.csvNames.some(n=>lower===n)){found.push({id:l.id,addon:l.addon});break;}
    }
  }
  if(!found.length)return{licId:'other',addons:[],licRaw:licString};
  const mains=found.filter(f=>!f.addon).map(f=>f.id);
  const addons=found.filter(f=>f.addon).map(f=>f.id);
  let licId='other';
  for(const id of LIC_PRIORITY){if(mains.includes(id)){licId=id;break;}}
  if(licId==='other'&&addons.length)licId=addons[0];
  return{licId,addons,licRaw:licString};
}

// Custo total de um usuário = licença principal + todos add-ons pagos
function userCost(r){
  if(r.custo != null) return r.custo;
  const main=licById[r.licId]?.price||0;
  const addonCost=(r.addons||[]).reduce((s,id)=>s+(licById[id]?.price||0),0);
  return main+addonCost;
}

let licById=Object.fromEntries(LICENSES.map(l=>[l.id,l]));

/** Carrega catálogo de licenças do servidor (fonte única de preços) */
function loadLicenses(){
  return fetch('/api/licenses').then(function(r){return r.json();}).then(function(data){
    if(Array.isArray(data)&&data.length){
      LICENSES=data;
      licById=Object.fromEntries(LICENSES.map(function(l){return[l.id,l];}));
    }
  }).catch(function(){/* mantém array hardcoded como fallback */});
}
const LIC_COLORS=LICENSES.map(l=>l.color);
