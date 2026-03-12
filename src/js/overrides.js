/* ══════════ OVERRIDES — Setor Fixo/Manual ══════════
   Gerencia overrides de setor para contas que NÃO vêm do AD
   (lojas, serviços, e-mails compartilhados).
   Persistência via overrides.json separado do data.json.        */

let overrides = {};  // { "email@dom": { setor, area?, tipo?, cargo?, fixo, updatedAt } }

/** Carrega overrides de setor do servidor */
function loadOverrides() {
  return fetch('/api/overrides')
    .then(r => r.json())
    .then(data => { overrides = (data && data.overrides) || {}; })
    .catch(() => { overrides = {}; });
}

/** Aplica overrides no array de registros (db ou snapshot.data) em memória.
    Usado após import CSV e ao carregar dados. */
function applyOverridesLocal(records) {
  records.forEach(r => {
    const email = (r.email || '').trim().toLowerCase();
    const ov = overrides[email];
    if (ov && ov.fixo) {
      r.setor = ov.setor;
      if (ov.area) r.area = ov.area;
      if (ov.tipo) r.tipo = ov.tipo;
      if (ov.cargo) r.cargo = ov.cargo;
      r.setorFixo = true;
      r.cargoFixo = !!ov.cargo;
    } else {
      r.setorFixo = false;
      r.cargoFixo = false;
    }
  });
}

/** Salva override via API (PUT se fixo=true, DELETE se fixo=false) */
function saveOverride(email, setor, tipo, fixo, cargo, area) {
  email = email.trim().toLowerCase();
  if (fixo) {
    return fetch('/api/overrides/' + encodeURIComponent(email), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setor: setor, area: area || null, tipo: tipo || null, cargo: cargo || null, fixo: true })
    }).then(r => r.json()).then(() => {
      overrides[email] = { setor: setor, fixo: true, updatedAt: new Date().toISOString() };
      if (area) overrides[email].area = area;
      if (tipo) overrides[email].tipo = tipo;
      if (cargo) overrides[email].cargo = cargo;
    });
  } else {
    return removeOverride(email);
  }
}

/** Remove override via API (DELETE) */
function removeOverride(email) {
  email = email.trim().toLowerCase();
  return fetch('/api/overrides/' + encodeURIComponent(email), { method: 'DELETE' })
    .then(r => r.json()).then(() => { delete overrides[email]; });
}

/* ── Detecção automática de Lojas (L###) ─────────────────────── */

/** Verifica se o nome do registro segue padrão de loja (ex: L001, L186 - Uberlandia) */
function isLoja(r) {
  var nomeBase = String(r.nome || r.displayName || r.colaborador || r.user || '').trim();
  return /^L\d{3}\b/i.test(nomeBase);
}

/** Auto-cria overrides para registros detectados como loja.
    Respeita override manual: se o usuário já desmarcou fixo (fixo===false),
    não reativa automaticamente.
    Chamado no init (main.js) após sync. */
function autoOverrideLojas(records) {
  let count = 0;
  records.forEach(function(r) {
    if (!isLoja(r)) return;
    const email = (r.email || '').trim().toLowerCase();
    if (!email) return;
    const ov = overrides[email];
    // Se já existe override com fixo explicitamente false, respeitar escolha manual
    if (ov && ov.fixo === false) return;
    // Se já existe override com fixo true, não precisa recriar
    if (ov && ov.fixo) return;
    // Criar override automático: setor=Lojas, cargo=Loja, tipo=Lojas
    overrides[email] = {
      setor: 'Lojas',
      cargo: 'Loja',
      tipo: 'Lojas',
      fixo: true,
      updatedAt: new Date().toISOString()
    };
    count++;
    // Persistir no servidor (fire-and-forget)
    fetch('/api/overrides/' + encodeURIComponent(email), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setor: 'Lojas', cargo: 'Loja', tipo: 'Lojas', fixo: true })
    }).catch(function() {});
  });
  if (count > 0) console.log('[autoOverrideLojas] Criados', count, 'overrides automáticos para lojas L###');
}

/* ── Modal "Editar Setor" ────────────────────────────────────── */
let overrideEditEmail = null;

/** Abre modal de edição de setor/cargo/area para um colaborador */
function openOverrideModal(id) {
  const r = db.find(x => x.id === id);
  if (!r) return;
  overrideEditEmail = r.email.trim().toLowerCase();
  const ov = overrides[overrideEditEmail];

  document.getElementById('ovNome').textContent = r.nome;
  document.getElementById('ovEmail').textContent = r.email;

  // Popula select de setores existentes (macros da hierarquia + setores do db)
  const hierMacros = Object.keys(HIERARCHY);
  const dbSetores = [...new Set(db.map(x => x.setor))];
  const setores = [...new Set([...hierMacros, ...dbSetores])].sort();
  const sel = document.getElementById('ovSetor');
  sel.innerHTML = setores.map(s => '<option value="' + s + '">' + s + '</option>').join('')
    + '<option value="__novo__">+ Novo setor...</option>';

  // Campo de novo setor
  const novoWrap = document.getElementById('ovNovoSetorWrap');
  const novoInput = document.getElementById('ovNovoSetor');
  novoWrap.style.display = 'none';
  novoInput.value = '';
  sel.onchange = function () {
    novoWrap.style.display = sel.value === '__novo__' ? 'block' : 'none';
    updateOverrideAreaSelect(sel.value);
  };

  // Popula select de areas (sub-setor)
  function updateOverrideAreaSelect(macroName) {
    const areaSel = document.getElementById('ovArea');
    const hConf = HIERARCHY[macroName];
    const areas = (hConf && hConf.areas) || [];
    // Tambem incluir areas existentes nos dados
    const dbAreas = [...new Set(db.filter(x => x.setor === macroName && x.area).map(x => x.area))];
    const allAreas = [...new Set([...areas, ...dbAreas])].sort();
    areaSel.innerHTML = '<option value="">— Sem area (Geral) —</option>' +
      allAreas.map(a => '<option value="' + a + '">' + a + '</option>').join('') +
      '<option value="__nova__">+ Nova area...</option>';
    // Setar area atual
    const areaAtual = (ov && ov.area) || r.area || '';
    if (areaAtual && allAreas.indexOf(areaAtual) < 0 && areaAtual !== '') {
      areaSel.insertAdjacentHTML('afterbegin', '<option value="' + areaAtual + '">' + areaAtual + '</option>');
    }
    areaSel.value = areaAtual || '';
    const novaAreaWrap = document.getElementById('ovNovaAreaWrap');
    novaAreaWrap.style.display = 'none';
    areaSel.onchange = function() {
      novaAreaWrap.style.display = areaSel.value === '__nova__' ? 'block' : 'none';
    };
  }

  // Select de tipo
  const tipoSel = document.getElementById('ovTipo');
  tipoSel.value = (ov && ov.tipo) || (r.tipo || '');

  // Select de cargo
  const cargoSel = document.getElementById('ovCargo');
  const cargoCustomWrap = document.getElementById('ovCargoCustomWrap');
  const cargoCustomInput = document.getElementById('ovCargoCustom');
  const cargoAtual = (ov && ov.cargo) || '';
  cargoCustomWrap.style.display = 'none';
  cargoCustomInput.value = '';
  // Se o valor salvo não está nas opções predefinidas, selecionar "Outro"
  const presetCargos = [...cargoSel.options].map(o => o.value).filter(v => v && v !== '__custom__');
  if (cargoAtual && !presetCargos.includes(cargoAtual)) {
    cargoSel.value = '__custom__';
    cargoCustomWrap.style.display = 'block';
    cargoCustomInput.value = cargoAtual;
  } else {
    cargoSel.value = cargoAtual;
  }
  cargoSel.onchange = function () {
    cargoCustomWrap.style.display = cargoSel.value === '__custom__' ? 'block' : 'none';
  };

  // Valor atual do setor
  const setorAtual = (ov && ov.fixo) ? ov.setor : r.setor;
  if (setores.includes(setorAtual)) {
    sel.value = setorAtual;
  } else {
    // Adicionar como opção temporária
    sel.insertAdjacentHTML('afterbegin', '<option value="' + setorAtual + '">' + setorAtual + '</option>');
    sel.value = setorAtual;
  }

  // Checkbox fixo
  document.getElementById('ovFixo').checked = !!(ov && ov.fixo);

  // Atualizar select de areas para o setor atual
  updateOverrideAreaSelect(setorAtual);

  document.getElementById('overrideOverlay').classList.add('open');
}

/** Fecha modal de edição de setor */
function closeOverrideModal() {
  document.getElementById('overrideOverlay').classList.remove('open');
  overrideEditEmail = null;
}

/** Valida e salva override do modal (setor, area, cargo, tipo) */
function saveOverrideModal() {
  if (!overrideEditEmail) return;

  const sel = document.getElementById('ovSetor');
  let setor = sel.value;
  if (setor === '__novo__') {
    setor = document.getElementById('ovNovoSetor').value.trim();
    if (!setor) { toast('Atenção: Informe o nome do novo setor.'); return; }
  }

  const tipo = document.getElementById('ovTipo').value || null;
  const fixo = document.getElementById('ovFixo').checked;

  // Area
  const areaSelVal = document.getElementById('ovArea').value;
  let area = null;
  if (areaSelVal === '__nova__') {
    area = document.getElementById('ovNovaArea').value.trim() || null;
    if (!area) { toast('Informe o nome da nova area.'); return; }
    // Auto-adicionar area a hierarquia
    if (typeof addAreaToMacro === 'function') addAreaToMacro(setor, area);
  } else if (areaSelVal) {
    area = areaSelVal;
  }

  // Cargo
  const cargoSelVal = document.getElementById('ovCargo').value;
  let cargo = null;
  if (cargoSelVal === '__custom__') {
    cargo = document.getElementById('ovCargoCustom').value.trim() || null;
    if (cargoSelVal === '__custom__' && !cargo) { toast('Informe o cargo personalizado.'); return; }
  } else if (cargoSelVal) {
    cargo = cargoSelVal;
  }

  saveOverride(overrideEditEmail, setor, tipo, fixo, cargo, area).then(() => {
    // Atualizar registro em memória
    const rec = db.find(x => (x.email || '').trim().toLowerCase() === overrideEditEmail);
    if (rec) {
      rec.setor = setor;
      rec.area = area || null;
      if (tipo) rec.tipo = tipo;
      if (cargo) { rec.cargo = cargo; rec.cargoFixo = true; }
      rec.setorFixo = fixo;
    }
    // Atualizar snapshot ativo também
    snapshots.forEach(snap => {
      const sr = snap.data.find(x => (x.email || '').trim().toLowerCase() === overrideEditEmail);
      if (sr) {
        sr.setor = setor;
        sr.area = area || null;
        if (tipo) sr.tipo = tipo;
        if (cargo) { sr.cargo = cargo; sr.cargoFixo = true; }
        sr.setorFixo = fixo;
      }
    });

    closeOverrideModal();
    refresh();
    const parts = [];
    if (fixo) parts.push('Setor: "' + setor + '"');
    if (area) parts.push('Area: "' + area + '"');
    if (cargo) parts.push('Cargo: "' + cargo + '"');
    toast(fixo ? (parts.join(' · ') + ' 🔒') : 'Override removido — valores voltarão ao CSV.');
  }).catch(() => { toast('Erro ao salvar override.'); });
}
