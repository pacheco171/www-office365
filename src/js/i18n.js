(function () {
  var SUPPORTED = ['pt', 'en', 'es'];
  var DEFAULT_LANG = 'pt';
  var STORAGE_KEY = 'i18n_lang';
  var _current = DEFAULT_LANG;

  var _dicts = {
    pt: window.I18N_PT || {},
    en: window.I18N_EN || {},
    es: window.I18N_ES || {}
  };

  function _load() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.indexOf(saved) >= 0) _current = saved;
    } catch (e) {}
  }

  function t(key, vars) {
    var dict = _dicts[_current] || _dicts[DEFAULT_LANG];
    var val = dict[key];
    if (val === undefined) val = _dicts[DEFAULT_LANG][key];
    if (val === undefined) return key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        val = val.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), vars[k]);
      });
    }
    return val;
  }

  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.title = t(el.getAttribute('data-i18n-title'));
    });
    document.querySelectorAll('option[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.documentElement.lang = _current === 'pt' ? 'pt-BR' : _current;
    _updateSwitcher();
  }

  function setLanguage(lang) {
    if (SUPPORTED.indexOf(lang) < 0) return;
    _current = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
    applyTranslations();
    document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: lang } }));
  }

  function getLanguage() { return _current; }

  function _updateSwitcher() {
    document.querySelectorAll('.lang-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.lang === _current);
    });
  }

  _load();

  window.t = t;
  window.setLanguage = setLanguage;
  window.getLanguage = getLanguage;
  window.applyTranslations = applyTranslations;

  applyTranslations();
}());
