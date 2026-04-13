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
var globalAdmin = false;

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
  sessionStorage.removeItem('boot_cache');
  sessionStorage.removeItem('boot_pending');
  window.location.replace('login.html');
}

/**
 * Renova o access_token via proxy server (cookie HTTP-only).
 * @returns {Promise<void>}
 */
function authRefresh() {
  var ctrl = new AbortController();
  var timer = setTimeout(function(){ ctrl.abort(); }, 8000);
  return _originalFetch.call(window, '/api/auth/refresh', { method: 'POST', signal: ctrl.signal })
    .then(function(res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('Sessão expirada.');
    }).catch(function(err) {
      clearTimeout(timer);
      throw err;
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

var _originalFetch = window.fetch;
var _refreshPromise = null;

setInterval(function() {
  var session = authGetSession();
  if (!session) return;
  authRefresh().catch(function() { authLogout(); });
}, 4 * 60 * 1000);

function _singleRefresh() {
  if (!_refreshPromise) {
    _refreshPromise = authRefresh().then(function() {
      _refreshPromise = null;
    }).catch(function(err) {
      _refreshPromise = null;
      throw err;
    });
  }
  return _refreshPromise;
}

window.fetch = function(url, opts) {
  if (typeof url === 'string' && url.startsWith('/api/') && !url.startsWith('/api/auth/')) {
    var session = authGetSession();
    if (!session) {
      window.location.replace('login.html');
      return Promise.reject(new Error('Não autenticado'));
    }
    return _originalFetch.call(window, url, opts).then(function(response) {
      if (response.status === 401 || response.status === 403) {
        return _singleRefresh().then(function() {
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
