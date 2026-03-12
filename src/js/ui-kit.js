/* ╔═══════════════════════════════════════════════════════════════════╗
   ║  UI-KIT JS  —  Skeleton Loaders + Progress Bar + View Transition ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

/* ── TOP PROGRESS BAR ─────────────────────────────────────────────── */
var uiProgress = (function() {
  var el, bar, progress, timer;

  function init() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'ui-progress';
    bar = document.createElement('div');
    bar.className = 'ui-progress-bar';
    el.appendChild(bar);
    document.body.appendChild(el);
  }

  function start() {
    init();
    progress = 0;
    bar.style.transition = 'width .15s linear';
    bar.style.width = '0%';
    el.classList.add('active');

    timer = setInterval(function() {
      progress += (90 - progress) * 0.08;
      if (progress > 88) progress = 88;
      bar.style.width = progress + '%';
    }, 80);
  }

  function done() {
    clearInterval(timer);
    if (!bar) return;
    bar.style.transition = 'width .3s cubic-bezier(0.2,0.8,0.2,1)';
    bar.style.width = '100%';
    setTimeout(function() {
      el.classList.remove('active');
      setTimeout(function() { bar.style.width = '0%'; }, 240);
    }, 280);
  }

  return { start: start, done: done };
})();

/* ── SKELETON LOADERS ─────────────────────────────────────────────── */
var uiSkeleton = {
  /** Gera N linhas skeleton para uma tabela.
   *  @param {string} tbodyId — id do <tbody>
   *  @param {number} cols — quantidade de colunas
   *  @param {number} [rows=5] — quantidade de linhas skeleton
   */
  table: function(tbodyId, cols, rows) {
    var tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    rows = rows || 5;
    var html = '';
    for (var r = 0; r < rows; r++) {
      html += '<tr class="skeleton-row">';
      for (var c = 0; c < cols; c++) {
        var w = 40 + Math.random() * 40;
        html += '<td><div style="height:12px;width:' + w + '%;background:var(--sand-lt);border-radius:4px;position:relative;overflow:hidden;">' +
                '<div style="position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent);animation:uiShimmer 1.6s infinite;"></div>' +
                '</div></td>';
      }
      html += '</tr>';
    }
    tbody.innerHTML = html;
  },

  /** Gera cards skeleton.
   *  @param {string} containerId
   *  @param {number} [count=4]
   *  @param {number} [height=120] — altura em px
   */
  cards: function(containerId, count, height) {
    var container = document.getElementById(containerId);
    if (!container) return;
    count = count || 4;
    height = height || 120;
    var html = '';
    for (var i = 0; i < count; i++) {
      html += '<div class="skeleton" style="height:' + height + 'px;border-radius:11px;border:1px solid var(--border);"></div>';
    }
    container.innerHTML = html;
  }
};

/* ── VIEW TRANSITION HELPER ───────────────────────────────────────── */
var uiTransition = {
  /** Adiciona classe de entrada ao trocar de view. */
  viewSwitch: function(viewEl) {
    if (!viewEl) return;
    viewEl.style.animation = 'none';
    void viewEl.offsetHeight; // force reflow
    viewEl.style.animation = '';
  }
};
