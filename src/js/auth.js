/* ══════════ AUTH SERVICE ══════════
 * Integração com API LDAP via proxy server (HTTP-only cookies).
 *
 * Tokens ficam EXCLUSIVAMENTE em cookies HTTP-only — nunca
 * acessíveis via JavaScript (proteção contra XSS / F12).
 *
 * O store guarda apenas dados do usuário (nome, email, etc).
 * ══════════════════════════════════ */

// ── Role do usuário logado (carregado de /api/me) ──
var userRole = 'viewer'; // default até carregar

// ── Store de autenticação (apenas dados do usuário, SEM tokens) ───
var authStore = createStore('auth', {
  username:   null,
  name:       null,
  email:      null,
  department: null,
  loginAt:    null
});

// ─────────────────────────────────────────────────────────────────

/**
 * Autentica o usuário via proxy server.
 * Tokens são setados como cookies HTTP-only pelo servidor.
 * @param {string} username  formato nome.sobrenome
 * @param {string} password
 * @returns {Promise<object>} dados do usuário (sem tokens)
 */
function authLogin(username, password) {
  return fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username, password: password })
  })
  .catch(function() {
    throw new Error('Não foi possível conectar ao servidor de autenticação.');
  })
  .then(function(res) {
    return res.json().then(function(data) {
      if (!res.ok) {
        throw new Error(data.error || 'Credenciais inválidas.');
      }
      return data;
    });
  })
  .then(function(data) {
    var user = data.user || {};

    authStore.setState({
      username:   user.username || username,
      name:       user.name || username,
      email:      user.email || '',
      department: user.department || '',
      loginAt:    new Date().toISOString()
    });

    return authStore.getState();
  });
}

/** Retorna a sessão atual ou null (dados do usuário, sem tokens). */
function authGetSession() {
  var s = authStore.getState();
  return s.username ? s : null;
}

/** Encerra a sessão e redireciona para o login. */
function authLogout() {
  fetch('/api/auth/logout', { method: 'POST' }).catch(function() {});
  authStore.destroy();
  window.location.replace('login.html');
}

/**
 * Renova o access_token via proxy server (cookie HTTP-only).
 * @returns {Promise<void>}
 */
function authRefresh() {
  return fetch('/api/auth/refresh', { method: 'POST' })
    .then(function(res) {
      if (!res.ok) throw new Error('Sessão expirada.');
    });
}

/**
 * Guard: redireciona para login se não autenticado.
 * Renova o token proativamente quando faltar menos de 5 min para expirar.
 */
function authRequire() {
  var session = authGetSession();
  if (!session) {
    window.location.replace('login.html');
    return false;
  }
  return true;
}

// Checagem periódica do token a cada 4 minutos
setInterval(function() {
  var session = authGetSession();
  if (!session) return;
  authRefresh().catch(function() { authLogout(); });
}, 4 * 60 * 1000);


// ── Fetch wrapper — NÃO injeta mais Authorization header ──
// Os cookies HTTP-only são enviados automaticamente pelo browser.
// Apenas intercepta 401/403 para tentar refresh ou redirecionar.
var _originalFetch = window.fetch;
window.fetch = function(url, opts) {
  if (typeof url === 'string' && url.startsWith('/api/') && !url.startsWith('/api/auth/')) {
    var session = authGetSession();
    if (!session) {
      window.location.replace('login.html');
      return Promise.reject(new Error('Não autenticado'));
    }
    return _originalFetch.call(window, url, opts).then(function(response) {
      if (response.status === 401 || response.status === 403) {
        return authRefresh().then(function() {
          return _originalFetch.call(window, url, opts);
        }).catch(function() {
          authLogout();
          return response;
        });
      }
      return response;
    });
  }
  return _originalFetch.call(window, url, opts);
};
