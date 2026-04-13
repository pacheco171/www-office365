/* ══════════ REPORT TABLE — Builder genérico de tabelas de relatório ══════════ */

var ReportTable = (function(){

  function build(containerId, columns, data, opts){
    opts = opts || {};
    var perPage = opts.perPage || 20;
    var searchable = opts.searchable !== false;
    var exportable = opts.exportable !== false;
    var emptyMsg = opts.emptyMessage || 'Nenhum dado encontrado';
    var exportName = opts.exportName || 'relatorio';

    var state = {
      data: data,
      filtered: data.slice(),
      sortCol: null,
      sortAsc: true,
      page: 1,
      perPage: perPage,
      search: '',
      focusSearch: false
    };

    function applySearch(){
      var q = state.search.toLowerCase();
      state.filtered = !q ? state.data.slice() : state.data.filter(function(row){
        return columns.some(function(col){
          var v = col.value ? col.value(row) : row[col.key];
          return v != null && String(v).toLowerCase().includes(q);
        });
      });
      applySort();
    }

    function applySort(){
      if(state.sortCol !== null){
        var col = columns[state.sortCol];
        state.filtered.sort(function(a,b){
          var va = col.sortValue ? col.sortValue(a) : (col.value ? col.value(a) : a[col.key]);
          var vb = col.sortValue ? col.sortValue(b) : (col.value ? col.value(b) : b[col.key]);
          if(va == null) va = '';
          if(vb == null) vb = '';
          var r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR');
          return state.sortAsc ? r : -r;
        });
      }
      state.page = 1;
      render();
    }

    function render(){
      var c = document.getElementById(containerId);
      if(!c) return;

      var shouldFocus = state.focusSearch || (document.activeElement && document.activeElement.id === containerId+'_search');
      state.focusSearch = false;

      var showAll = state.perPage === 0;
      var totalPages = showAll ? 1 : Math.max(1, Math.ceil(state.filtered.length / state.perPage));
      if(state.page > totalPages) state.page = totalPages;
      var start = showAll ? 0 : (state.page - 1) * state.perPage;
      var pageData = showAll ? state.filtered : state.filtered.slice(start, start + state.perPage);

      var html = '';

      if(searchable || exportable){
        html += '<div class="toolbar">';
        if(searchable){
          var hasSearch = !!state.search;
          html += '<div class="search-wrap">'
            +'<svg class="si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
            +'<input type="text" class="search-input" placeholder="Buscar..." value="'+esc(state.search)+'" id="'+containerId+'_search">'
            +'<span class="search-count'+(hasSearch?' visible':'')+'">'+(hasSearch?state.filtered.length+' de '+state.data.length:'')+'</span>'
            +'<button class="search-clear'+(hasSearch?' visible':'')+'" id="'+containerId+'_clear" title="Limpar busca">'
            +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
            +'</button></div>';
        }
        if(exportable){
          html += '<button class="btn btn-outline" id="'+containerId+'_export"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Exportar CSV</button>';
        }
        html += '</div>';
      }

      html += '<div class="table-wrap"><table><thead><tr>';
      columns.forEach(function(col, i){
        var sortCls = col.sortable !== false ? ' class="sort"' : '';
        var arrowHtml = col.sortable !== false
          ? ' <span style="font-size:8px;visibility:'+(state.sortCol===i?'visible':'hidden')+'">'+(state.sortCol===i?(state.sortAsc?'▲':'▼'):'▲')+'</span>'
          : '';
        html += '<th'+sortCls+' data-col="'+i+'">'+esc(col.label)+arrowHtml+'</th>';
      });
      html += '</tr></thead><tbody>';

      if(pageData.length === 0){
        html += '<tr><td colspan="'+columns.length+'" style="text-align:center;padding:40px;color:var(--muted)">'+emptyMsg+'</td></tr>';
      } else {
        pageData.forEach(function(row){
          var trAttr = opts.onRowClick ? ' style="cursor:pointer"' : '';
          html += '<tr'+trAttr+'>';
          columns.forEach(function(col){
            var val = col.render ? col.render(row) : esc(String(col.value ? col.value(row) : (row[col.key] != null ? row[col.key] : '—')));
            html += '<td>'+val+'</td>';
          });
          html += '</tr>';
        });
      }

      html += '</tbody></table>';

      html += '<div class="table-footer"><div class="table-footer-left">';
      html += '<span class="table-info">'+state.filtered.length+' registro'+(state.filtered.length!==1?'s':'')+'</span>';
      var perPageOpts = opts.perPageOptions || [10, 20, 50, 100];
      html += '<div class="per-page"><span>Exibir</span><select id="'+containerId+'_pp">';
      perPageOpts.forEach(function(n){
        html += '<option value="'+n+'"'+(n===state.perPage?' selected':'')+'>'+n+'</option>';
      });
      html += '<option value="0"'+(state.perPage===0?' selected':'')+'>Todos</option>';
      html += '</select></div></div>';

      html += '<div class="pagination">';
      if(totalPages > 1){
        var range = pagRange(state.page, totalPages);
        if(state.page > 1) html += '<button class="page-btn" data-p="'+(state.page-1)+'">‹</button>';
        range.forEach(function(p){
          if(p === '...') html += '<span style="padding:0 4px;color:var(--muted)">…</span>';
          else html += '<button class="page-btn'+(p===state.page?' active':'')+'" data-p="'+p+'">'+p+'</button>';
        });
        if(state.page < totalPages) html += '<button class="page-btn" data-p="'+(state.page+1)+'">›</button>';
      }
      html += '</div></div></div>';

      c.innerHTML = html;

      if(searchable){
        var inp = document.getElementById(containerId+'_search');
        var clearBtn = document.getElementById(containerId+'_clear');
        if(inp){
          inp.addEventListener('input', function(){
            state.search = this.value;
            applySearch();
          });
          inp.addEventListener('keydown', function(e){
            if(e.key === 'Escape' && state.search){
              e.preventDefault();
              state.search = '';
              state.focusSearch = true;
              applySearch();
            }
          });
          if(shouldFocus){
            inp.focus();
            var len = inp.value.length;
            inp.setSelectionRange(len, len);
          }
        }
        if(clearBtn){
          clearBtn.addEventListener('click', function(){
            state.search = '';
            state.focusSearch = true;
            applySearch();
          });
        }
      }

      if(exportable){
        var btn = document.getElementById(containerId+'_export');
        if(btn) btn.addEventListener('click', function(){ doExport(columns, state.filtered, exportName); });
      }

      var ppSel = document.getElementById(containerId+'_pp');
      if(ppSel) ppSel.addEventListener('change', function(){ state.perPage = parseInt(this.value); state.page = 1; render(); });

      c.querySelectorAll('th.sort').forEach(function(th){
        th.addEventListener('click', function(){
          var ci = parseInt(this.dataset.col);
          if(state.sortCol === ci){
            state.sortAsc = !state.sortAsc;
          } else {
            state.sortCol = ci;
            state.sortAsc = columns[ci] && columns[ci].sortDescFirst ? false : true;
          }
          applySort();
        });
      });

      c.querySelectorAll('.page-btn').forEach(function(b){
        b.addEventListener('click', function(){ state.page = parseInt(this.dataset.p); render(); });
      });

      if(opts.onRowClick){
        c.querySelectorAll('tbody tr').forEach(function(tr, i){
          if(pageData[i]) tr.addEventListener('click', function(){ opts.onRowClick(pageData[i]); });
        });
      }
    }

    applySearch();
    return { refresh: function(newData, resetSort){ state.data = newData; if(resetSort) state.sortCol = null; applySearch(); } };
  }

  function pagRange(cur, total){
    if(total <= 7) return Array.from({length:total},function(_,i){return i+1;});
    var r = [];
    r.push(1);
    if(cur > 3) r.push('...');
    for(var i = Math.max(2, cur-1); i <= Math.min(total-1, cur+1); i++) r.push(i);
    if(cur < total-2) r.push('...');
    r.push(total);
    return r;
  }

  function doExport(columns, data, name){
    var hdr = columns.map(function(c){ return c.label; }).join(',');
    var rows = data.map(function(row){
      return columns.map(function(col){
        var v = col.value ? col.value(row) : row[col.key];
        if(v == null) v = '';
        return '"'+String(v).replace(/"/g,'""')+'"';
      }).join(',');
    });
    var a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,\uFEFF'+encodeURIComponent(hdr+'\n'+rows.join('\n'));
    a.download = name+'-'+new Date().toISOString().slice(0,10)+'.csv';
    a.click();
    if(typeof toast === 'function') toast('CSV exportado!');
  }

  function kpiCards(items){
    return '<div class="metrics">' + items.map(function(item){
      return '<div class="metric-card"><div class="metric-label">'+esc(item.label)+'</div><div class="metric-val">'+esc(String(item.value))+'</div>'
        + (item.sub ? '<div class="metric-sub">'+item.sub+'</div>' : '')
        + '</div>';
    }).join('') + '</div>';
  }

  function fmtBytes(bytes){
    if(bytes == null || isNaN(bytes)) return '—';
    var n = Number(bytes);
    if(n < 1024) return n + ' B';
    if(n < 1048576) return (n/1024).toFixed(1) + ' KB';
    if(n < 1073741824) return (n/1048576).toFixed(1) + ' MB';
    return (n/1073741824).toFixed(2) + ' GB';
  }

  function fmtMB(mb){
    if(mb == null || isNaN(mb)) return '—';
    if(mb < 1024) return mb.toFixed(1) + ' MB';
    return (mb/1024).toFixed(2) + ' GB';
  }

  return { build: build, kpiCards: kpiCards, fmtBytes: fmtBytes, fmtMB: fmtMB };
})();
