/* ══════════ FORECAST DE CUSTO ══════════ */
function computeForecast(monthsAhead){
  if(snapshots.length<2)return null;

  var historico=snapshots.map(function(s){return{
    label:s.label,mes:s.mes,ano:s.ano,
    custo:snapshotCost(s),
    users:s.data.length,
    licenciados:s.data.filter(function(r){return r.licId!=='none';}).length
  };});

  // Calcular taxas de crescimento mes a mes
  var taxas=[];
  for(var i=1;i<historico.length;i++){
    if(historico[i-1].custo>0){
      taxas.push((historico[i].custo-historico[i-1].custo)/historico[i-1].custo);
    }
  }
  if(!taxas.length)return null;

  var taxaMedia=taxas.reduce(function(s,t){return s+t;},0)/taxas.length;
  var stddev=Math.sqrt(taxas.reduce(function(s,t){return s+Math.pow(t-taxaMedia,2);},0)/taxas.length);
  // Com poucos snapshots o stddev fica 0 — usar margem mínima de 2% para separar cenários
  if(stddev<0.02)stddev=0.02;

  var ultimo=historico[historico.length-1];
  var projecoes=[];

  for(var m=1;m<=monthsAhead;m++){
    var mesIdx=((ultimo.mes-1+m)%12)+1;
    var ano=ultimo.ano+Math.floor((ultimo.mes-1+m)/12);
    projecoes.push({
      label:MESES[mesIdx]+'/'+ano,
      otimista:ultimo.custo*Math.pow(1+taxaMedia-stddev,m),
      base:ultimo.custo*Math.pow(1+taxaMedia,m),
      pessimista:ultimo.custo*Math.pow(1+taxaMedia+stddev,m),
      mes:m
    });
  }

  // Por setor
  var lastSnap=snapshots[snapshots.length-1];
  var prevSnap=snapshots[snapshots.length-2];
  var setorMap={};
  lastSnap.data.filter(function(r){return r.status!=='Inativo';}).forEach(function(r){
    if(!setorMap[r.setor])setorMap[r.setor]={custoAtual:0,users:0};
    setorMap[r.setor].custoAtual+=userCost(r);
    setorMap[r.setor].users++;
  });
  if(prevSnap){
    var prevSetorMap={};
    prevSnap.data.filter(function(r){return r.status!=='Inativo';}).forEach(function(r){
      if(!prevSetorMap[r.setor])prevSetorMap[r.setor]=0;
      prevSetorMap[r.setor]+=userCost(r);
    });
    for(var setor in setorMap){
      var data=setorMap[setor];
      var prev=prevSetorMap[setor]||data.custoAtual;
      data.taxa=prev>0?(data.custoAtual-prev)/prev:0;
      data.projecao=data.custoAtual*Math.pow(1+data.taxa,monthsAhead);
    }
  }

  return{historico:historico,projecoes:projecoes,taxaCrescimento:taxaMedia,stddev:stddev,porSetor:setorMap};
}

function renderForecast(){
  var el=document.getElementById('forecastSection');
  var horizonte=parseInt((document.getElementById('forecastHorizonte')||{}).value||'6');
  var fc=computeForecast(horizonte);

  if(!fc){
    el.innerHTML='<div style="text-align:center;padding:48px;color:var(--muted)">'+
      '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="var(--border)" stroke-width="1.5" style="margin-bottom:12px"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>'+
      '<div style="font-size:15px;font-weight:700;margin-bottom:6px">Dados insuficientes</div>'+
      '<div style="font-size:13px">Importe pelo menos 2 meses de snapshots para gerar projecoes.</div></div>';
    return;
  }

  var taxaPct=(fc.taxaCrescimento*100).toFixed(1);
  var taxaColor=fc.taxaCrescimento>0?'var(--red)':fc.taxaCrescimento<0?'var(--green)':'var(--muted)';
  var lastProj=fc.projecoes[fc.projecoes.length-1];
  var intervaloMin=fmtBRL(lastProj.otimista);
  var intervaloMax=fmtBRL(lastProj.pessimista);

  // ── Cards ──
  var html='<div class="fc-cards">';

  html+='<div class="fc-card fc-card--taxa">';
  html+='<div class="fc-label">Taxa media mensal</div>';
  html+='<div class="fc-value" style="color:'+taxaColor+'">'+(fc.taxaCrescimento>0?'+':'')+taxaPct+'%</div>';
  html+='<div class="fc-sub">Desvio: '+(fc.stddev*100).toFixed(1)+'%</div>';
  html+='</div>';

  html+='<div class="fc-card fc-card--base">';
  html+='<div class="fc-label">Projecao realista ('+horizonte+'m)</div>';
  html+='<div class="fc-value" style="color:var(--brown)">'+fmtBRL(lastProj.base)+'</div>';
  html+='<div class="fc-sub">Custo mensal estimado</div>';
  html+='</div>';

  html+='<div class="fc-card fc-card--intervalo">';
  html+='<div class="fc-label">Intervalo de confianca</div>';
  html+='<div class="fc-value" style="font-size:20px;color:var(--muted)">'+intervaloMin+' ~ '+intervaloMax+'</div>';
  html+='<div class="fc-sub">Otimista a pessimista</div>';
  html+='</div>';

  html+='<div class="fc-card fc-card--horizonte">';
  html+='<div class="fc-label">Horizonte</div>';
  html+='<select class="form-select" id="forecastHorizonte" onchange="renderForecast()" style="margin-top:6px;width:auto;font-size:14px;font-weight:700">';
  [3,6,12].forEach(function(v){
    html+='<option value="'+v+'"'+(horizonte===v?' selected':'')+'>'+v+' meses</option>';
  });
  html+='</select>';
  html+='<div class="fc-sub">Meses a frente</div>';
  html+='</div>';

  html+='</div>';

  // ── Grafico SVG ──
  html+=drawForecastChart(fc);

  // ── Tabela cenarios ──
  html+='<div class="fc-table-wrap">';
  html+='<div class="fc-table-hdr">Projecoes por cenario</div>';
  html+='<table><thead><tr><th>Mes</th><th>Otimista</th><th>Realista</th><th>Pessimista</th><th>Variacao</th></tr></thead><tbody>';
  var custoAtual=fc.historico[fc.historico.length-1].custo;
  for(var j=0;j<fc.projecoes.length;j++){
    var p=fc.projecoes[j];
    var varPct=((p.base-custoAtual)/custoAtual*100).toFixed(1);
    var varColor=p.base>custoAtual?'var(--red)':'var(--green)';
    html+='<tr>'+
      '<td style="font-weight:600">'+p.label+'</td>'+
      '<td><span class="fc-scenario fc-scenario--otimista">'+fmtBRL(p.otimista)+'</span></td>'+
      '<td><span class="fc-scenario fc-scenario--realista">'+fmtBRL(p.base)+'</span></td>'+
      '<td><span class="fc-scenario fc-scenario--pessimista">'+fmtBRL(p.pessimista)+'</span></td>'+
      '<td style="color:'+varColor+';font-weight:600">'+(p.base>custoAtual?'+':'')+varPct+'%</td>'+
    '</tr>';
  }
  html+='</tbody></table></div>';

  // ── Tabela por setor ──
  var setores=Object.entries(fc.porSetor).sort(function(a,b){return b[1].custoAtual-a[1].custoAtual;});
  if(setores.length){
    var maxSetorCusto=setores[0][1].custoAtual||1;
    html+='<div class="fc-table-wrap">';
    html+='<div class="fc-table-hdr">Projecao por setor ('+horizonte+' meses)</div>';
    html+='<table><thead><tr><th>Setor</th><th>Usuarios</th><th>Custo Atual</th><th>Taxa</th><th>Projecao</th><th style="min-width:100px">Impacto</th></tr></thead><tbody>';
    for(var k=0;k<setores.length;k++){
      var setor=setores[k][0];
      var data=setores[k][1];
      var t=data.taxa!=null?(data.taxa*100).toFixed(1)+'%':'--';
      var tColor=data.taxa>0?'var(--red)':data.taxa<0?'var(--green)':'var(--muted)';
      var barPct=Math.round(data.custoAtual/maxSetorCusto*100);
      var barColor=data.taxa>0?'var(--red)':data.taxa<0?'var(--green)':'var(--tan)';
      html+='<tr>'+
        '<td style="font-weight:600">'+setor+'</td>'+
        '<td>'+data.users+'</td>'+
        '<td>'+fmtBRL(data.custoAtual)+'</td>'+
        '<td style="color:'+tColor+';font-weight:600">'+(data.taxa>0?'+':'')+t+'</td>'+
        '<td style="font-weight:700">'+(data.projecao!=null?fmtBRL(data.projecao):'--')+'</td>'+
        '<td><div class="fc-setor-bar"><div class="fc-setor-bar-fill" style="width:'+barPct+'%;background:'+barColor+'"></div></div></td>'+
      '</tr>';
    }
    html+='</tbody></table></div>';
  }

  el.innerHTML=html;
}

function drawForecastChart(fc){
  var allHist=fc.historico.map(function(h){return h.custo;});
  var allProj=fc.projecoes.map(function(p){return p.pessimista;});
  var allValues=allHist.concat(allProj);
  var maxVal=Math.max.apply(null,allValues)*1.15||1;
  var barW=38;
  var gap=8;
  var totalBars=fc.historico.length+fc.projecoes.length;
  var chartW=Math.max(totalBars*(barW+gap)+80,400);
  var chartH=200;
  var bottomPad=36;
  var topPad=10;

  var html='<div class="fc-chart-wrap">';
  html+='<div class="fc-chart-title">Evolucao de custo mensal</div>';
  html+='<div class="fc-chart-legend">';
  html+='<div class="fc-legend-item"><div class="fc-legend-dot" style="background:var(--brown)"></div>Historico</div>';
  html+='<div class="fc-legend-item"><div class="fc-legend-dot" style="background:var(--tan);border:1.5px dashed var(--brown)"></div>Projecao (realista)</div>';
  html+='</div>';

  html+='<svg width="'+chartW+'" height="'+(chartH+bottomPad+topPad)+'" viewBox="0 0 '+chartW+' '+(chartH+bottomPad+topPad)+'" style="display:block;width:100%;max-width:'+chartW+'px">';

  // Linhas de grade
  for(var i=0;i<=4;i++){
    var y=topPad+chartH-chartH*(i/4);
    var val=maxVal*(i/4);
    html+='<line x1="48" y1="'+y+'" x2="'+chartW+'" y2="'+y+'" stroke="var(--border)" stroke-width="0.5"/>';
    html+='<text x="44" y="'+(y+4)+'" text-anchor="end" font-size="9" font-weight="600" fill="var(--muted)">'+(val/1000).toFixed(0)+'k</text>';
  }

  var x=60;

  // Barras historico
  for(var h=0;h<fc.historico.length;h++){
    var item=fc.historico[h];
    var barH=chartH*(item.custo/maxVal);
    var yPos=topPad+chartH-barH;
    html+='<rect x="'+x+'" y="'+yPos+'" width="'+barW+'" height="'+barH+'" fill="var(--brown)" rx="4" opacity="0.85"/>';
    // Valor no topo
    html+='<text x="'+(x+barW/2)+'" y="'+(yPos-5)+'" text-anchor="middle" font-size="8" font-weight="700" fill="var(--brown)">'+(item.custo/1000).toFixed(1)+'k</text>';
    // Label
    html+='<text x="'+(x+barW/2)+'" y="'+(topPad+chartH+16)+'" text-anchor="middle" font-size="9" font-weight="600" fill="var(--muted)">'+item.label+'</text>';
    x+=barW+gap;
  }

  // Linha separadora
  html+='<line x1="'+(x-gap/2)+'" y1="'+topPad+'" x2="'+(x-gap/2)+'" y2="'+(topPad+chartH)+'" stroke="var(--border)" stroke-width="1" stroke-dasharray="4,3"/>';

  // Barras projecao
  for(var p=0;p<fc.projecoes.length;p++){
    var proj=fc.projecoes[p];
    var barH2=chartH*(proj.base/maxVal);
    var yPos2=topPad+chartH-barH2;
    // Faixa otimista-pessimista
    var yOtim=topPad+chartH-chartH*(proj.otimista/maxVal);
    var yPess=topPad+chartH-chartH*(proj.pessimista/maxVal);
    html+='<rect x="'+(x-2)+'" y="'+Math.min(yOtim,yPess)+'" width="'+(barW+4)+'" height="'+Math.abs(yPess-yOtim)+'" fill="var(--brown)" rx="3" opacity="0.06"/>';
    // Barra base
    html+='<rect x="'+x+'" y="'+yPos2+'" width="'+barW+'" height="'+barH2+'" fill="var(--tan)" rx="4" opacity="0.7" stroke="var(--brown)" stroke-width="1.5" stroke-dasharray="4,3"/>';
    // Valor
    html+='<text x="'+(x+barW/2)+'" y="'+(yPos2-5)+'" text-anchor="middle" font-size="8" font-weight="700" fill="var(--brown)">'+(proj.base/1000).toFixed(1)+'k</text>';
    // Label
    html+='<text x="'+(x+barW/2)+'" y="'+(topPad+chartH+16)+'" text-anchor="middle" font-size="9" font-weight="600" fill="var(--muted)">'+proj.label+'</text>';
    x+=barW+gap;
  }

  html+='</svg></div>';
  return html;
}

function toggleForecast(){
  var panel=document.getElementById('forecastPanel');
  var btn=document.getElementById('forecastToggleBtn');
  if(panel.style.display==='none'){
    panel.style.display='block';
    if(btn)btn.classList.add('active');
    renderForecast();
  }else{
    panel.style.display='none';
    if(btn)btn.classList.remove('active');
  }
}
