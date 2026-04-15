/* ══════════ CONFIG — Graph API Integration ══════════ */

var _configStatusInterval = null;

function _startConfigStatusPolling() {
  if (_configStatusInterval) return;
  _configStatusInterval = setInterval(function() {
    if (typeof getActivePage === 'function' && getActivePage() !== 'config') {
      clearInterval(_configStatusInterval);
      _configStatusInterval = null;
      return;
    }
    fetch('/api/graph/status').then(function(r) { return r.json(); }).then(function(status) {
      updateSyncStatus(status);
    }).catch(function() {});
  }, 10000);
}

/** Toggle visibilidade de campo password */
function toggleFieldVis(inputId, btn) {
  var el = document.getElementById(inputId);
  if (!el) return;
  var isPassword = el.type === 'password';
  el.type = isPassword ? 'text' : 'password';
  // Trocar ícone: olho aberto ↔ olho fechado
  if (isPassword) {
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  } else {
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  }
}

function loadGraphConfig() {
  fetch('/api/me').then(function(r) { return r.json(); }).then(function(me) {
    var label = document.getElementById('cfgTenantLabel');
    if (label) label.textContent = me.tenant_id || 'desconhecido';
  }).catch(function() {});

  fetch('/api/graph/config').then(function(r) { return r.json(); }).then(function(cfg) {
    // Credenciais: mostrar placeholder mascarado, campo vazio para edição
    var tenantInput = document.getElementById('cfgTenantId');
    var clientInput = document.getElementById('cfgClientId');
    var secretInput = document.getElementById('cfgClientSecret');
    if (!tenantInput || !clientInput || !secretInput) return;

    tenantInput.value = '';
    tenantInput.placeholder = cfg.tenant_id_masked || 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';

    clientInput.value = '';
    clientInput.placeholder = cfg.client_id_masked || 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';

    secretInput.value = '';
    secretInput.placeholder = cfg.client_secret_masked ? 'Configurado — deixe vazio para manter' : 'Nenhum secret configurado';

    document.getElementById('cfgDomain').value = cfg.domain || '';
    document.getElementById('cfgOuRoot').value = cfg.ou_root || '';
    document.getElementById('cfgAutoSync').checked = !!cfg.auto_sync;
    document.getElementById('cfgSyncInterval').value = String(cfg.sync_interval_hours || 24);

    var hint = document.getElementById('cfgSecretHint');
    if (cfg.client_secret_masked) {
      hint.textContent = 'Atual: ' + cfg.client_secret_masked;
    } else {
      hint.textContent = 'Nenhum secret configurado';
    }

    updateSyncStatus(cfg.status);
    _startConfigStatusPolling();
  }).catch(function() {});
}

function updateSyncStatus(status) {
  var dot = document.getElementById('graphStatusDot');
  var text = document.getElementById('graphStatusText');
  var logEl = document.getElementById('graphSyncLog');
  if (!dot || !text || !logEl) return;

  if (!status) { text.textContent = 'Sem informacao'; return; }

  if (status.running) {
    dot.className = 'config-status-dot status-running';
    text.textContent = 'Sincronizando...';
  } else if (status.lastError) {
    dot.className = 'config-status-dot status-error';
    text.textContent = 'Erro: ' + status.lastError;
  } else if (status.lastSync) {
    dot.className = 'config-status-dot status-ok';
    var d = new Date(status.lastSync);
    var autoLabel = document.getElementById('cfgAutoSync').checked ? ' · Auto-sync ativo' : '';
    text.textContent = 'Ultima sync: ' + d.toLocaleString('pt-BR') + autoLabel;
  } else {
    dot.className = 'config-status-dot status-idle';
    text.textContent = 'Nunca sincronizado — configure as credenciais e clique em Sincronizar';
  }

  if (status.lastResult) {
    var r = status.lastResult;
    logEl.innerHTML = '<div class="config-log-entry config-log-success">' +
      '<strong>Ultimo sync concluido</strong> em ' + r.elapsed_seconds + 's' +
      '<div style="margin-top:4px;font-size:12px">' +
        r.users + ' usuarios · ' +
        (r.ad_setores ? r.ad_setores + ' setores · ' + r.ad_areas + ' areas do AD · ' : '') +
        r.mailbox_usage + ' com dados de mailbox · ' +
        r.onedrive_usage + ' com dados de OneDrive · ' +
        'Snapshot: ' + r.snapshot +
      '</div></div>';
  }
  if (status.lastError && !status.running) {
    logEl.innerHTML += '<div class="config-log-entry config-log-error">' + status.lastError + '</div>';
  }
}

function saveGraphConfig() {
  var payload = {
    domain: document.getElementById('cfgDomain').value.trim() || 'liveoficial.com.br',
    ou_root: document.getElementById('cfgOuRoot').value.trim() || 'Setores',
    auto_sync: document.getElementById('cfgAutoSync').checked,
    sync_interval_hours: parseInt(document.getElementById('cfgSyncInterval').value) || 24
  };
  // Só enviar credenciais se o campo foi preenchido (vazio = manter atual)
  var tenant = document.getElementById('cfgTenantId').value.trim();
  var client = document.getElementById('cfgClientId').value.trim();
  var secret = document.getElementById('cfgClientSecret').value.trim();
  if (tenant) payload.tenant_id = tenant;
  if (client) payload.client_id = client;
  if (secret) payload.client_secret = secret;

  fetch('/api/graph/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(r) { return r.json(); }).then(function() {
    toast('Configuracoes salvas');
    loadGraphConfig();
  }).catch(function() { toast('Erro ao salvar'); });
}

function testGraphConnection() {
  var el = document.getElementById('graphTestResult');
  el.innerHTML = '<span style="color:var(--muted)">Testando conexao...</span>';

  var payload = {};
  // Só enviar se preencheu novos valores (senão usa os salvos no servidor)
  var tenant = document.getElementById('cfgTenantId').value.trim();
  var client = document.getElementById('cfgClientId').value.trim();
  var secret = document.getElementById('cfgClientSecret').value.trim();
  if (tenant) payload.tenant_id = tenant;
  if (client) payload.client_id = client;
  if (secret) payload.client_secret = secret;

  fetch('/api/graph/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.ok) {
      el.innerHTML = '<span class="config-test-ok">Conexao OK — Organizacao: <strong>' + (data.organization || '?') + '</strong></span>';
    } else {
      el.innerHTML = '<span class="config-test-err">Falha: ' + (data.error || 'Erro desconhecido') + '</span>';
    }
  }).catch(function(e) {
    el.innerHTML = '<span class="config-test-err">Erro de rede: ' + e.message + '</span>';
  });
}

function triggerGraphSync() {
  var btn = document.getElementById('btnSyncNow');
  btn.disabled = true;
  btn.textContent = 'Sincronizando...';

  fetch('/api/graph/sync', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        toast('Erro: ' + data.error);
      } else {
        toast('Sync iniciado em background — acompanhe o status abaixo');
      }
      // Poll status a cada 3s por 5min
      var polls = 0;
      var interval = setInterval(function() {
        polls++;
        fetch('/api/graph/status').then(function(r) { return r.json(); }).then(function(status) {
          updateSyncStatus(status);
          if (!status.running || polls > 100) {
            clearInterval(interval);
            btn.disabled = false;
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Sincronizar agora';
            if (!status.running && status.lastResult) {
              refresh();
              toast('Sync concluido: ' + status.lastResult.users + ' usuarios sincronizados');
            }
          }
        }).catch(function() {});
      }, 3000);
    })
    .catch(function() {
      toast('Erro de rede');
      btn.disabled = false;
      btn.textContent = 'Sincronizar agora';
    });
}

function remapSetores() {
  var btn = document.getElementById('btnRemapSetores');
  btn.disabled = true;
  btn.textContent = 'Reprocessando setores...';

  fetch('/api/graph/remap-setores', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 7h18M3 12h18M3 17h18"/></svg> Reprocessar setores via DN';
      if (data.error) {
        toast('Erro: ' + data.error);
      } else {
        toast('Setores reprocessados: ' + data.updated + ' atualizados, ' + data.skipped_fixo + ' fixos mantidos, ' + data.total_dns + ' DNs lidos');
        refresh();
      }
    })
    .catch(function() {
      toast('Erro de rede');
      btn.disabled = false;
      btn.textContent = 'Reprocessar setores via DN';
    });
}

/** Salva auto_sync e intervalo automaticamente ao alterar */
function saveAutoSyncSetting() {
  var autoSync = document.getElementById('cfgAutoSync').checked;
  var interval = parseInt(document.getElementById('cfgSyncInterval').value) || 24;

  fetch('/api/graph/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auto_sync: autoSync, sync_interval_hours: interval })
  }).then(function(r) { return r.json(); }).then(function() {
    if (autoSync) {
      toast('Sync automático ativado — a cada ' + interval + 'h');
    } else {
      toast('Sync automático desativado');
    }
  }).catch(function() { toast('Erro ao salvar'); });
}

/* ══════════ AI CONFIG ══════════ */

function loadAiConfig() {
  fetch('/api/graph/config').then(function(r) { return r.json(); }).then(function(cfg) {
    var input = document.getElementById('cfgAiApiKey');
    var hint = document.getElementById('cfgAiKeyHint');
    if (!input) return;
    input.value = '';
    if (cfg.ai_api_key_masked) {
      input.placeholder = 'Configurada — deixe vazio para manter';
      if (hint) hint.textContent = 'Atual: ' + cfg.ai_api_key_masked;
    } else {
      input.placeholder = 'sk-ant-...';
      if (hint) hint.textContent = 'Nenhuma API key configurada';
    }
  }).catch(function() {});
}

function saveAiConfig() {
  var key = document.getElementById('cfgAiApiKey').value.trim();
  if (!key) { toast('Nenhuma key informada'); return; }

  fetch('/api/graph/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ai_api_key: key })
  }).then(function(r) { return r.json(); }).then(function() {
    toast('API key salva');
    loadAiConfig();
  }).catch(function() { toast('Erro ao salvar'); });
}

function testAiConnection() {
  var el = document.getElementById('aiTestResult');
  el.innerHTML = '<span style="color:var(--muted)">Testando conexao...</span>';

  var payload = {};
  var key = document.getElementById('cfgAiApiKey').value.trim();
  if (key) payload.ai_api_key = key;

  fetch('/api/ai/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.ok) {
      el.innerHTML = '<span class="config-test-ok">Conexao OK — Modelo: <strong>' + (data.model || '?') + '</strong></span>';
    } else {
      el.innerHTML = '<span class="config-test-err">Falha: ' + (data.error || 'Erro desconhecido') + '</span>';
    }
  }).catch(function(e) {
    el.innerHTML = '<span class="config-test-err">Erro de rede: ' + e.message + '</span>';
  });
}

// Carregar config no acesso direto à URL /config (quando já é a página inicial)
document.addEventListener('DOMContentLoaded', function() {
  if (document.getElementById('view-config')) {
    loadGraphConfig();
    loadAiConfig();
  }

  // Auto-save ao mudar checkbox/select de sync (delegado para funcionar após swap SPA)
  document.addEventListener('change', function(e) {
    if (e.target && e.target.id === 'cfgAutoSync') saveAutoSyncSetting();
    if (e.target && e.target.id === 'cfgSyncInterval') saveAutoSyncSetting();
  });
});
