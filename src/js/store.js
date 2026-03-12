/* ══════════ MINI-STORE (Zustand-inspired) ══════════
 * Estado reativo em memória com persistência em localStorage.
 *
 * API:
 *   createStore(name, initialState)  → store
 *   store.getState()                 → state snapshot
 *   store.setState(partial | fn)     → atualiza estado + persiste + notifica
 *   store.subscribe(listener)        → retorna unsubscribe fn
 *   store.destroy()                  → limpa listeners + remove do storage
 * ══════════════════════════════════════════════════ */

/**
 * Cria um store reativo com persistência automática em localStorage.
 * @param {string} name        chave usada no localStorage
 * @param {object} initialState  estado padrão (usado se não houver dado persistido)
 * @returns {object} store
 */
function createStore(name, initialState) {
  var STORAGE_KEY = 'store_' + name;
  var listeners = [];

  // Hidrata do localStorage ou usa initialState
  var state = _hydrate(STORAGE_KEY, initialState);

  function _hydrate(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? Object.assign({}, fallback, JSON.parse(raw)) : Object.assign({}, fallback);
    } catch (e) {
      return Object.assign({}, fallback);
    }
  }

  function _persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* quota exceeded — falha silenciosa */ }
  }

  function _notify() {
    for (var i = 0; i < listeners.length; i++) {
      listeners[i](state);
    }
  }

  return {
    /** Retorna snapshot atual do estado. */
    getState: function() {
      return state;
    },

    /**
     * Atualiza o estado (shallow merge).
     * Aceita objeto parcial ou função (prevState) => parcial.
     */
    setState: function(partial) {
      var next = typeof partial === 'function' ? partial(state) : partial;
      if (!next) return;
      state = Object.assign({}, state, next);
      _persist();
      _notify();
    },

    /**
     * Registra listener chamado a cada mudança de estado.
     * @param {function} listener  recebe (state)
     * @returns {function} unsubscribe
     */
    subscribe: function(listener) {
      listeners.push(listener);
      return function() {
        listeners = listeners.filter(function(l) { return l !== listener; });
      };
    },

    /** Limpa estado, remove do storage e notifica. */
    destroy: function() {
      state = Object.assign({}, initialState);
      localStorage.removeItem(STORAGE_KEY);
      _notify();
    }
  };
}
