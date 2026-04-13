/* ══════════ ASSESSMENT — Microsoft Secure Score ══════════ */

var _assessCatMap = {
  'Identity': 'Identidade',
  'Data': 'Dados',
  'Device': 'Dispositivo',
  'Apps': 'Aplicativos',
  'Infrastructure': 'Infraestrutura',
  'Account': 'Conta',
  'Tenant': 'Tenant',
};

function _trCat(s){ return _assessCatMap[s] || s; }

var _assessmentData = null;
var _assessmentLastUpdated = null;
var _assessmentUpdateTimer = null;

function refreshAssessment() {
  _assessmentData = null;
  _assessmentLastUpdated = new Date();
  clearTimeout(_assessmentUpdateTimer);
  var el = document.getElementById('assessmentLastUpdated');
  if(el) el.textContent = 'Agora mesmo';
  renderAssessmentView();
  _assessmentUpdateTimer = setTimeout(_updateAssessmentLastUpdated, 60000);
}

function _updateAssessmentLastUpdated() {
  if(!_assessmentLastUpdated || document.hidden) return;
  var mins = Math.floor((new Date() - _assessmentLastUpdated) / 60000);
  var el = document.getElementById('assessmentLastUpdated');
  if(el) {
    el.textContent = mins < 1 ? 'Agora mesmo' : 'Atualizado há ' + mins + ' min';
    _assessmentUpdateTimer = setTimeout(_updateAssessmentLastUpdated, 60000);
  }
}

function ignoreRecommendation(id) {
  var ignored = JSON.parse(localStorage.getItem('assessment_ignored') || '[]');
  if(ignored.indexOf(id) < 0) ignored.push(id);
  localStorage.setItem('assessment_ignored', JSON.stringify(ignored));
  renderAssessmentView();
}

function confirmIgnoreRecommendation(id) {
  if(!confirm('Ignorar esta recomendação?\n\nEla será marcada como não aplicável e removida da lista de pendências.')) return;
  ignoreRecommendation(id);
}

function renderAssessmentView(){
  var el = document.getElementById('assessmentContent');
  if(!el) return;

  if(_assessmentData){
    _renderAssessmentContent(el, _assessmentData);
    return;
  }

  el.innerHTML = loadingHTML('Carregando Secure Score...');

  Promise.all([
    fetchWithTimeout('/api/security/secure-score').then(function(r){ return r.json(); }),
    fetchWithTimeout('/api/security/score-profiles').then(function(r){ return r.json(); })
  ]).then(function(results){
    var scoreRes = results[0];
    var profilesRes = results[1];
    if(scoreRes.error){
      el.innerHTML = errorHTML('refreshAssessment', scoreRes.error);
      return;
    }
    _assessmentData = {
      score: scoreRes.data || {},
      profiles: profilesRes.data || []
    };
    _renderAssessmentContent(el, _assessmentData);
  }).catch(function(){
    el.innerHTML = errorHTML('refreshAssessment');
  });
}

function _renderAssessmentContent(el, data){
  var score = data.score;
  var profiles = data.profiles;
  var current = score.currentScore || 0;
  var max = score.maxScore || 100;
  var pct = max > 0 ? Math.round(current / max * 100) : 0;
  var scoreColor = pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--yellow)' : 'var(--red)';

  var comparatives = score.averageComparativeScores || [];
  var sectorAvg = 0, globalAvg = 0;
  comparatives.forEach(function(c){
    if(c.basis === 'AllTenants') globalAvg = c.averageScore || 0;
    if(c.basis === 'TotalSeats') sectorAvg = c.averageScore || 0;
  });
  if(!sectorAvg) sectorAvg = globalAvg;

  var controlScores = score.controlScores || [];
  var controlMap = {};
  controlScores.forEach(function(cs){ controlMap[cs.controlName] = cs; });

  var ignored = JSON.parse(localStorage.getItem('assessment_ignored') || '[]');

  var recommendations = profiles.map(function(p){
    var cs = controlMap[p.controlName] || {};
    return {
      controlName: p.controlName,
      title: p.title || p.controlName,
      category: p.controlCategory || 'Outro',
      description: p.description || '',
      remediation: p.remediation || '',
      maxScore: p.maxScore || 0,
      currentScore: cs.score || 0,
      deprecated: p.deprecated || false,
      rank: p.rank || 999
    };
  }).filter(function(r){ return !r.deprecated; }).sort(function(a,b){ return a.rank - b.rank; });

  var pending = recommendations.filter(function(r){ return r.currentScore < r.maxScore && ignored.indexOf(r.controlName) < 0; });
  pending.forEach(function(r){
    var gain = r.maxScore - r.currentScore;
    r._priority = gain >= 5 ? 'alta' : gain >= 2 ? 'media' : 'baixa';
  });
  var completed = recommendations.filter(function(r){ return r.currentScore >= r.maxScore && r.maxScore > 0; });
  var potentialGain = pending.reduce(function(s,r){ return s + (r.maxScore - r.currentScore); }, 0);

  var completedPct = recommendations.length > 0 ? Math.round(completed.length / recommendations.length * 100) : 0;
  var statusLabel = pct >= 80 ? 'Excelente' : pct >= 60 ? 'Bom' : pct >= 40 ? 'Necessita Atenção' : 'Crítico';
  var statusDesc = pct >= 80 ? 'Seu tenant está bem protegido. Continue monitorando.' : pct >= 60 ? 'Há oportunidades de melhoria que podem aumentar sua segurança.' : pct >= 40 ? 'Várias recomendações importantes estão pendentes.' : 'Ações urgentes são necessárias para proteger seu ambiente.';

  var html = '';

  html += '<div class="assess-overview">';

  html += '<div class="assess-score-panel">';
  html += '<div class="assess-gauge">';
  html += '<svg viewBox="0 0 180 180" style="width:180px;height:180px;transform:rotate(-90deg)">';
  html += '<circle cx="90" cy="90" r="78" fill="none" stroke="var(--sand-lt)" stroke-width="14"/>';
  html += '<circle cx="90" cy="90" r="78" fill="none" stroke="'+scoreColor+'" stroke-width="14" stroke-dasharray="'+Math.round(490*pct/100)+' 490" stroke-linecap="round"/>';
  html += '</svg>';
  html += '<div class="assess-gauge-label"><div class="assess-gauge-val" style="color:'+scoreColor+'">'+pct+'%</div>';
  html += '<div class="assess-gauge-sub">'+current.toFixed(1)+' / '+max.toFixed(1)+' pts</div></div></div>';
  html += '<div class="assess-score-status" style="color:'+scoreColor+'">'+statusLabel+'</div>';
  html += '<div class="assess-score-desc">'+statusDesc+'</div>';
  html += '<div class="score-scale">';
  html += '<span class="scale-item scale-red">0–40% Crítico</span>';
  html += '<span class="scale-item scale-yellow">40–70% Moderado</span>';
  html += '<span class="scale-item scale-green">70–100% Seguro</span>';
  html += '</div>';
  html += '</div>';

  html += '<div class="assess-stats-grid">';

  html += '<div class="assess-stat-card">';
  html += '<div class="assess-stat-icon" style="background:rgba(90,138,106,.1);color:var(--green)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>';
  html += '<div class="assess-stat-info"><div class="assess-stat-val">'+completed.length+' <span style="font-size:12px;color:var(--muted);font-weight:500">/ '+recommendations.length+'</span></div>';
  html += '<div class="assess-stat-label">Recomendações Concluídas</div>';
  html += '<div style="margin-top:6px;height:4px;background:var(--sand-lt);border-radius:2px;overflow:hidden"><div style="width:'+completedPct+'%;height:100%;background:var(--green);border-radius:2px"></div></div>';
  html += '<div style="font-size:10px;color:var(--muted);margin-top:3px">'+completedPct+'% completo</div>';
  html += '</div></div>';

  html += '<div class="assess-stat-card">';
  html += '<div class="assess-stat-icon" style="background:rgba(184,144,58,.1);color:var(--yellow)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>';
  html += '<div class="assess-stat-info"><div class="assess-stat-val">'+pending.length+'</div>';
  html += '<div class="assess-stat-label">Pendentes para Revisão</div>';
  var highP = pending.filter(function(r){ return r._priority === 'alta'; }).length;
  var medP = pending.filter(function(r){ return r._priority === 'media'; }).length;
  var lowP = pending.filter(function(r){ return r._priority === 'baixa'; }).length;
  html += '<div style="display:flex;gap:8px;margin-top:6px;font-size:10px">';
  html += '<span style="color:var(--red)">'+highP+' alta</span>';
  html += '<span style="color:var(--yellow)">'+medP+' média</span>';
  html += '<span style="color:var(--muted)">'+lowP+' baixa</span>';
  html += '</div></div></div>';

  html += '<div class="assess-stat-card">';
  html += '<div class="assess-stat-icon" style="background:rgba(0,120,212,.08);color:#0078d4"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg></div>';
  html += '<div class="assess-stat-info"><div class="assess-stat-val" style="color:var(--green)">+'+potentialGain.toFixed(1)+' pts</div>';
  html += '<div class="assess-stat-label">Ganho Potencial</div>';
  html += '<div style="font-size:10px;color:var(--muted);margin-top:4px">Pontos que podem ser conquistados implementando as recomendações pendentes</div>';
  html += '</div></div>';

  html += '<div class="assess-stat-card">';
  html += '<div class="assess-stat-icon" style="background:rgba(156,122,82,.1);color:var(--brown)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div>';
  html += '<div class="assess-stat-info"><div class="assess-stat-label" style="margin-bottom:8px">Comparativo do Setor</div>';
  var bars = [
    {label:'Sua organização', value: pct, color: scoreColor},
    {label:'Média do setor', value: max > 0 ? Math.round(sectorAvg/max*100) : 0, color:'var(--brown)'},
    {label:'Média global', value: max > 0 ? Math.round(globalAvg/max*100) : 0, color:'var(--muted)'}
  ];
  bars.forEach(function(b){
    html += '<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px"><span>'+b.label+'</span><span style="font-weight:700;color:'+b.color+'">'+b.value+'%</span></div>';
    html += '<div style="height:4px;background:var(--sand-lt);border-radius:2px;overflow:hidden"><div style="width:'+b.value+'%;height:100%;background:'+b.color+';border-radius:2px"></div></div></div>';
  });
  html += '</div></div>';

  html += '</div></div>';

  var highCount = pending.filter(function(r){ return r._priority === 'alta'; }).length;
  var medCount = pending.filter(function(r){ return r._priority === 'media'; }).length;
  var lowCount = pending.filter(function(r){ return r._priority === 'baixa'; }).length;

  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:24px;margin-bottom:12px;flex-wrap:wrap;gap:8px">';
  html += '<div style="font-weight:700;font-size:15px">Recomendações Pendentes</div>';
  html += '<div class="assess-filters" style="display:flex;gap:6px">';
  html += '<button class="assess-filter-btn active" data-filter="todas" onclick="_filterAssessRecs(\'todas\',this)">Todas <span style="opacity:.6">('+pending.length+')</span></button>';
  html += '<button class="assess-filter-btn" data-filter="alta" onclick="_filterAssessRecs(\'alta\',this)" style="--fc:var(--red)">Alta <span style="opacity:.6">('+highCount+')</span></button>';
  html += '<button class="assess-filter-btn" data-filter="media" onclick="_filterAssessRecs(\'media\',this)" style="--fc:var(--yellow)">Média <span style="opacity:.6">('+medCount+')</span></button>';
  html += '<button class="assess-filter-btn" data-filter="baixa" onclick="_filterAssessRecs(\'baixa\',this)" style="--fc:var(--muted)">Baixa <span style="opacity:.6">('+lowCount+')</span></button>';
  html += '</div></div>';

  html += '<div class="assess-recs" id="assessRecsList">';

  var categories = {};
  pending.forEach(function(r){
    if(!categories[r.category]) categories[r.category] = [];
    categories[r.category].push(r);
  });

  Object.keys(categories).sort().forEach(function(cat){
    html += '<div class="assess-cat-label" style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;padding:8px 0">'+esc(_trCat(cat))+' ('+categories[cat].length+')</div>';
    categories[cat].forEach(function(rec, idx){
      var gain = rec.maxScore - rec.currentScore;
      var recId = 'rec-'+cat.replace(/\s/g,'')+'-'+idx;
      var prioColor = rec._priority === 'alta' ? 'var(--red)' : rec._priority === 'media' ? 'var(--yellow)' : 'var(--muted)';
      var prioLabel = rec._priority === 'alta' ? 'Alto' : rec._priority === 'media' ? 'Médio' : 'Baixo';
      html += '<div class="assess-rec" id="'+recId+'" data-priority="'+rec._priority+'">';
      html += '<div class="assess-rec-hdr"><div style="display:flex;align-items:center;gap:8px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+prioColor+';flex-shrink:0"></span><div class="assess-rec-title">'+esc(rec.title)+'</div></div>';
      html += '<div style="display:flex;align-items:center;gap:8px"><span class="badge" style="font-size:10px;padding:2px 6px;background:'+prioColor+'15;color:'+prioColor+';border:1px solid '+prioColor+'30"><span style="color:var(--muted);font-weight:400">Impacto: </span>'+prioLabel+'</span>';
      html += '<div class="assess-rec-score" style="color:var(--green)">+'+gain.toFixed(1)+' pts</div></div></div>';
      html += '<div class="assess-rec-desc">'+esc(rec.description)+'</div>';
      html += '<div class="rec-actions">';
      if(rec.remediation){
        html += '<span class="assess-rec-toggle" onclick="document.getElementById(\''+recId+'\').classList.toggle(\'open\');this.textContent=this.textContent===\'Ver solução\'?\'Ocultar\':\'Ver solução\'">Ver solução</span>';
      }
      html += '<button class="btn-ignore" data-recid="'+esc(rec.controlName||rec.title)+'" onclick="confirmIgnoreRecommendation(this.dataset.recid)" title="Marcar como não aplicável">Ignorar</button>';
      html += '</div>';
      if(rec.remediation){
        html += '<div class="assess-rec-remediation">'+esc(rec.remediation)+'</div>';
      }
      html += '</div>';
    });
  });

  if(pending.length === 0){
    html += '<div style="text-align:center;padding:40px;color:var(--green);font-weight:700">Todas as recomendações foram implementadas!</div>';
  }

  html += '</div>';
  el.innerHTML = html;
}

function _filterAssessRecs(filter, btn){
  document.querySelectorAll('.assess-filter-btn').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  document.querySelectorAll('.assess-rec').forEach(function(rec){
    if(filter === 'todas' || rec.dataset.priority === filter){
      rec.style.display = '';
    } else {
      rec.style.display = 'none';
    }
  });
  document.querySelectorAll('.assess-cat-label').forEach(function(label){
    var next = label.nextElementSibling;
    var hasVisible = false;
    while(next && next.classList.contains('assess-rec')){
      if(next.style.display !== 'none') hasVisible = true;
      next = next.nextElementSibling;
    }
    label.style.display = hasVisible ? '' : 'none';
  });
}
