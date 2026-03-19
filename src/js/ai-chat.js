/* ══════════ AI CHAT — Assistente M365 (v3) ══════════ */
/* Motor de análise proativo com typing animation, follow-ups e insights automáticos */
var aiChat = (function() {
  var panel, messageList, input, sendBtn, fab, badge;
  var isOpen = false, isTyping = false;
  var lastTopic = null, lastSetor = null;

  /* ── Helpers ── */
  var R = function(v){return 'R$ '+(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});};
  var pct = function(a,b){return b?Math.round(a/b*100):0;};
  var norm = function(s){return(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w\s]/g,' ').replace(/\s+/g,' ').trim();};
  var D = function(){return typeof db!=='undefined'?db:[];};
  var S = function(){return typeof snapshots!=='undefined'?snapshots:[];};
  var U = function(){return typeof usageData!=='undefined'?usageData:{};};
  var CT = function(){return typeof contracts!=='undefined'?contracts:[];};
  var LN = function(id){var l=(typeof LICENSES!=='undefined'?LICENSES:[]).find(function(x){return x.id===id;});return l?l.short||l.name:id||'Sem licença';};
  var LP = function(id){var l=(typeof LICENSES!=='undefined'?LICENSES:[]).find(function(x){return x.id===id;});return l?l.price:0;};

  /* ── Cache ── */
  var cx = {};
  function build() {
    var data = D(); if(cx._len===data.length) return cx;
    var at=[],in_=[],ct=0,bL={},bS={},bT={},bC={};
    for(var i=0;i<data.length;i++){
      var r=data[i],c=r.custo||0,lid=r.licId||'none',s=r.setor||'Sem Setor',t=r.tipo||'Pessoa',cargo=r.cargo||'—';
      ct+=c;
      if(r.status==='Ativo')at.push(r);else in_.push(r);
      if(!bL[lid])bL[lid]={n:0,c:0};bL[lid].n++;bL[lid].c+=c;
      if(!bS[s])bS[s]={n:0,c:0,at:0,us:[]};bS[s].n++;bS[s].c+=c;if(r.status==='Ativo')bS[s].at++;bS[s].us.push(r);
      if(!bT[t])bT[t]={n:0,c:0};bT[t].n++;bT[t].c+=c;
      if(!bC[cargo])bC[cargo]={n:0,c:0};bC[cargo].n++;bC[cargo].c+=c;
    }
    cx={_len:data.length,data:data,at:at,in_:in_,ct:ct,bL:bL,bS:bS,bT:bT,bC:bC};
    return cx;
  }

  /* ══════════ HEALTH SCORE ══════════ */
  function calcHealth() {
    var c = build(), score = 100;
    if(!c.data.length) return {score:0,issues:[]};
    var issues = [];
    // Inativos com licença
    var ip = c.in_.filter(function(r){return r.licId&&r.licId!=='none'&&r.licId!=='other';});
    if(ip.length){
      var pen = Math.min(30, ip.length*2);
      score -= pen;
      var cv=0;ip.forEach(function(r){cv+=(r.custo||0);});
      issues.push({type:'warn',text:'<span class="ai-ic-val">'+ip.length+' inativos</span> com licença paga',sub:'Desperdiçando <strong>'+R(cv)+'/mês</strong>',saving:cv});
    }
    // E3 em cargo básico
    var e3b = c.at.filter(function(r){if(r.licId!=='e3')return false;var g=norm(r.cargo||'');return g==='colaborador'||g.indexOf('assistente')>=0||g.indexOf('auxiliar')>=0||g.indexOf('estagiario')>=0||g.indexOf('operador')>=0||g.indexOf('atendente')>=0;});
    if(e3b.length){
      var eco=e3b.length*(LP('e3')-LP('bstd'));
      score -= Math.min(20, e3b.length*2);
      issues.push({type:'tip',text:'<span class="ai-ic-val">'+e3b.length+'</span> com E3 em cargo básico',sub:'Downgrade → Standard: <strong>'+R(eco)+'/mês</strong>',saving:eco});
    }
    // Uso baixo
    var usage = U();
    if(Object.keys(usage).length){
      var low=[];
      c.at.forEach(function(r){if(!r.licId||r.licId==='none')return;var u=usage[r.email];if(u&&(u.mailboxMB||0)<50&&(u.onedriveMB||0)<50)low.push(r);});
      if(low.length>5){
        score -= Math.min(15, Math.round(low.length/2));
        var lc=0;low.forEach(function(r){lc+=(r.custo||0);});
        issues.push({type:'tip',text:'<span class="ai-ic-val">'+low.length+'</span> ativos com uso muito baixo',sub:'Custo sob revisão: <strong>'+R(lc)+'/mês</strong>',saving:lc});
      }
    }
    // Contas serviço/compartilhada com licença premium
    var sv = c.data.filter(function(r){return(r.tipo==='Compartilhado'||r.tipo==='Servico'||r.tipo==='Sala')&&(r.licId==='bstd'||r.licId==='e3');});
    if(sv.length){
      var sc=0;sv.forEach(function(r){sc+=((r.custo||0)-LP('f3'));});
      if(sc>0){score-=Math.min(10,sv.length*2);
      issues.push({type:'tip',text:'<span class="ai-ic-val">'+sv.length+'</span> contas de serviço com licença premium',sub:'Possível economia: <strong>'+R(sc)+'/mês</strong>',saving:sc});}
    }
    // Tendência de custo
    var snaps = S();
    if(snaps.length>=2){
      var last=snaps[snaps.length-1],prev=snaps[snaps.length-2],cL=0,cP=0;
      (last.data||[]).forEach(function(r){cL+=(r.custo||0);}); (prev.data||[]).forEach(function(r){cP+=(r.custo||0);});
      var delta=cL-cP,pctD=cP?Math.round(delta/cP*100):0;
      if(pctD>5){score-=Math.min(10,pctD);issues.push({type:'trend',text:'Custo <span class="ai-ic-val">subiu '+pctD+'%</span> vs mês anterior',sub:prev.label+' → '+last.label+': '+(delta>0?'+':'')+R(delta)});}
      else if(pctD<-2){issues.push({type:'info',text:'Custo <span class="ai-ic-val">caiu '+Math.abs(pctD)+'%</span> vs mês anterior',sub:'Boa tendência! '+prev.label+' → '+last.label+': '+R(delta)});}
    }
    // Contratos
    var contracts = CT();
    contracts.forEach(function(ct){
      var used=c.at.filter(function(r){return r.licId===ct.licId;}).length;
      var occ=ct.qtd?pct(used,ct.qtd):0;
      if(occ>95){score-=5;issues.push({type:'warn',text:'Contrato <span class="ai-ic-val">'+(ct.nome||LN(ct.licId))+'</span> '+occ+'% ocupado',sub:used+'/'+ct.qtd+' — risco de falta'});}
    });
    return {score:Math.max(0,Math.min(100,score)),issues:issues};
  }

  /* ══════════ ROUTER ══════════ */
  var TOPICS = [
    {id:'greet',  w:3, k:['oi','ola','bom dia','boa tarde','boa noite','hey','hello','eai','e ai','fala','salve']},
    {id:'help',   w:3, k:['ajuda','help','o que voce','pode fazer','como funciona','comandos','menu','o que sabe']},
    {id:'resumo', w:2, k:['resumo','visao geral','overview','dashboard','geral','situacao','status','como estamos','me conta','relatorio']},
    {id:'custo',  w:2, k:['gasto','gastando','custo','quanto custa','quanto pagamos','quanto pago','valor','preco','investimento','fatura','pagamento','pagar','caro','barato','dinheiro','orcamento','budget']},
    {id:'setor',  w:2, k:['setor','setores','departamento','departamentos','area','areas','equipe','equipes','time','times']},
    {id:'desp',   w:2, k:['desperdi','desperdicio','inativ','sem uso','nao usa','ocioso','parado','licenca sobrando','sobrando','jogando fora','perdendo','desnecessari']},
    {id:'otim',   w:2, k:['reduzir','economizar','economia','otimizar','otimizacao','baixar custo','cortar','melhorar','sugest','recomend','dica','conselho','o que posso fazer','o que fazer','como melhorar','como economizar','oportunidade']},
    {id:'lic',    w:2, k:['licen','plano','tipo de licen','distribuic','business standard','business basic','e3','f3','power bi','apps for']},
    {id:'uso',    w:2, k:['uso','mailbox','onedrive','storage','armazenamento','apps','utiliza','quem usa','quem nao usa','atividade','email','teams']},
    {id:'trend',  w:2, k:['tendencia','historico','evolucao','comparar','comparativo','mes passado','cresci','subiu','caiu','mudou','variacao','variou','ao longo','meses']},
    {id:'top',    w:2, k:['top','mais caro','quem gasta','quem custa','ranking','maiores','maior custo','mais paga']},
    {id:'contrato',w:2,k:['contrato','contratado','contratados','ocupacao','vagas','renovacao']},
    {id:'tipo',   w:2, k:['tipo','tipos','compartilhad','servico','sala','loja','lojas','recurso','recursos','conta de servico','conta compartilhada']},
    {id:'cargo',  w:2, k:['cargo','cargos','funcao','funcoes','role','perfil','perfis']},
    {id:'pessoa', w:1, k:['quem e','informacao','info','dados de','buscar','procurar','encontrar','sobre o','sobre a','me fala do','me fala da']},
    {id:'explain',w:2, k:['diferenca','diferente','qual a diferenca','o que e','o que inclui','explica','significa','para que serve','comparar licenca','versus','vs']},
    {id:'count',  w:1, k:['quantos','quantas','total de','numero de','quantidade']},
    {id:'whatif', w:3, k:['e se','se eu','se a gente','se nos','se remover','se trocar','se downgrade','se mudar','simulacao','simular','cenario','hipotese']},
    {id:'health', w:3, k:['saude','health','score','nota','pontuacao','avaliacao','como esta']},
    {id:'compare',w:2, k:['comparar setor','comparar area','versus','vs','contra','em relacao']},
  ];

  function route(q) {
    var scores={};
    for(var t=0;t<TOPICS.length;t++){var tp=TOPICS[t],s=0;for(var k=0;k<tp.k.length;k++){if(q.indexOf(tp.k[k])>=0)s+=tp.w;}if(s>0)scores[tp.id]=s;}
    var person=findPerson(q),setor=findSetor(q),lic=findLic(q);
    if(person)scores['pessoa']=(scores['pessoa']||0)+5;
    if(setor){scores['setor']=(scores['setor']||0)+4;lastSetor=setor;}
    if(lic)scores['explain']=(scores['explain']||0)+3;
    var best=null,bs=0;for(var id in scores)if(scores[id]>bs){bs=scores[id];best=id;}
    if(!best&&q.split(' ').length<=4&&lastTopic)best=lastTopic;
    return{topic:best,person:person,setor:setor,lic:lic};
  }

  function findPerson(q){
    var data=D(),best=null,bl=0;
    for(var i=0;i<data.length;i++){
      var n=norm(data[i].nome);
      if(n.length>3&&q.indexOf(n)>=0&&n.length>bl){best=data[i];bl=n.length;}
      var parts=n.split(' ');
      for(var p=0;p<parts.length;p++){if(parts[p].length>=4&&q.indexOf(parts[p])>=0&&parts[p].length>bl){best=data[i];bl=parts[p].length;}}
    }
    return best;
  }
  function findSetor(q){
    var data=D(),setores={};
    for(var i=0;i<data.length;i++)if(data[i].setor)setores[data[i].setor]=true;
    var keys=Object.keys(setores).sort(function(a,b){return b.length-a.length;});
    for(var i=0;i<keys.length;i++)if(q.indexOf(norm(keys[i]))>=0)return keys[i];
    return null;
  }
  function findLic(q){
    var map={'business standard':'bstd','bstd':'bstd','standard':'bstd','business basic':'bbasic','bbasic':'bbasic','basic':'bbasic','apps for business':'apps','apps business':'apps','f3':'f3','frontline':'f3','e3':'e3','enterprise':'e3','power bi':'pbi','pbi':'pbi'};
    for(var k in map)if(q.indexOf(k)>=0)return map[k];
    return null;
  }

  /* ══════════ ANÁLISES ══════════ */
  function analyze(question) {
    var q=norm(question),data=D();
    if(!data.length)return{text:'Nenhum dado carregado. Sincronize em **Config > Sincronizar agora**.',followups:[]};
    var c=build(),r=route(q),answer,followups=[];

    switch(r.topic){
      case 'greet':   answer=anaGreet(c);followups=mkf(['Resumo geral','Como otimizar?','Tem desperdício?','Quais setores gastam mais?']);break;
      case 'help':    answer=anaHelp();followups=mkf(['Resumo','Custos','Setores','Desperdício','Otimizar']);break;
      case 'resumo':  answer=anaResumo(c);followups=mkf(['Custos por licença','Top setores','Desperdícios','Como otimizar?']);break;
      case 'custo':   answer=r.setor?anaSetorDetalhe(r.setor,c):anaCusto(c);followups=r.setor?mkf(['Desperdício em '+r.setor,'Top custos '+r.setor,'Uso em '+r.setor,'Todos os setores']):mkf(['Por setor','Por licença','Tendência','Como otimizar?']);break;
      case 'setor':   answer=r.setor?anaSetorDetalhe(r.setor,c):anaSetores(c);followups=r.setor?mkf(['Desperdício em '+r.setor,'Top custos '+r.setor,'Uso em '+r.setor,'Voltar setores']):mkf(['Custos','Tendência','Top custos','Desperdício']);break;
      case 'desp':    answer=r.setor?anaSetorDesp(r.setor,c):anaDesp(c);followups=r.setor?mkf(['Detalhe '+r.setor,'Uso em '+r.setor,'Desperdício geral']):mkf(['Como otimizar?','Top custos','Setores','Tendência']);break;
      case 'otim':    answer=anaOtim(c);followups=mkf(['Ver inativos','Top custos','Setores','Tendência','E se removermos inativos?']);break;
      case 'lic':     answer=r.lic?anaLicDetalhe(r.lic,c):anaLicencas(c);followups=mkf(['O que inclui o E3?','Diferença Standard vs Basic','Custos','Otimizar']);break;
      case 'uso':     answer=r.setor?anaUsoSetor(r.setor,c):anaUso(c);followups=r.setor?mkf(['Detalhe '+r.setor,'Desperdício '+r.setor,'Uso geral']):mkf(['Desperdício','Otimizar','Setores','Top custos']);break;
      case 'trend':   answer=anaTrend(c);followups=mkf(['Resumo','Custos','Otimizar','Setores']);break;
      case 'top':     answer=r.setor?anaTopSetor(r.setor,c):anaTop(c);followups=r.setor?mkf(['Detalhe '+r.setor,'Top geral','Desperdício']):mkf(['Setores','Desperdício','Otimizar','Tendência']);break;
      case 'contrato':answer=anaContratos(c);followups=mkf(['Custos','Licenças','Otimizar']);break;
      case 'tipo':    answer=anaTipos(c);followups=mkf(['Contas de serviço caras','Custos','Resumo']);break;
      case 'cargo':   answer=anaCargos(c);followups=mkf(['Otimizar','Setores','Licenças']);break;
      case 'pessoa':  answer=r.person?anaPessoa(r.person,c):'Não encontrei essa pessoa. Tente o nome ou parte dele.';followups=r.person?mkf(['Setor '+(r.person.setor||''),'Top custos','Outra pessoa']):mkf(['Resumo','Ajuda']);break;
      case 'explain': answer=r.lic?anaExplainLic(r.lic):anaExplainGeral();followups=mkf(['Licenças','Custos','Otimizar']);break;
      case 'count':   answer=anaCount(q,c);followups=mkf(['Resumo','Custos','Setores']);break;
      case 'whatif':   answer=anaWhatIf(q,c);followups=mkf(['E se downgrade E3?','E se removermos inativos?','Custos atuais','Otimizar']);break;
      case 'health':  answer=anaHealth(c);followups=mkf(['Como otimizar?','Desperdícios','Resumo']);break;
      case 'compare': answer=anaCompareSetores(q,c);followups=mkf(['Setores','Custos','Top custos']);break;
      default:
        if(r.person){answer=anaPessoa(r.person,c);followups=mkf(['Setor '+(r.person.setor||''),'Top custos']);}
        else if(r.setor){answer=anaSetorDetalhe(r.setor,c);followups=mkf(['Desperdício '+r.setor,'Top custos '+r.setor]);}
        else{answer=anaResumo(c);followups=mkf(['Custos','Setores','Desperdício','Otimizar','Ajuda']);}
    }
    if(r.topic)lastTopic=r.topic;
    return{text:answer,followups:followups};
  }
  function mkf(arr){return arr;}

  /* ── Análises ── */
  function anaGreet(c){
    var h=calcHealth(),lines=['Olá! Seu M365 tem **'+c.data.length+' contas** com custo de **'+R(c.ct)+'/mês**.'];
    if(h.issues.length){lines.push('','Detectei **'+h.issues.length+' ponto'+(h.issues.length>1?'s':'')+' de atenção:**');
      var totalSav=0;h.issues.forEach(function(is){lines.push('- '+is.text.replace(/<[^>]+>/g,''));if(is.saving)totalSav+=is.saving;});
      if(totalSav>0)lines.push('','[ECONOMIA] **Economia potencial: '+R(totalSav)+'/mês** ('+R(totalSav*12)+'/ano)');
    }else{lines.push('','[OK] Tudo parece bem otimizado!');}
    return lines.join('\n');
  }

  function anaHelp(){return['**Posso responder sobre:**','','[ECONOMIA] Custos — "quanto gastamos?", "custo do TI"','[SETOR] Setores — "setores mais caros", "detalhe do comercial"','[PERFIL] Pessoas — "quem é Maria?", "dados do João"','[LICENCAS] Licenças — "distribuição", "o que inclui E3?"','[!] Desperdício — "licenças sobrando?", "inativos"','[DICA] Otimização — "como economizar?", "sugestões"','[DADOS] Uso — "dados de uso", "quem não usa mailbox?"','[TENDENCIA] Tendência — "evolução dos custos"','[RANKING] Rankings — "quem gasta mais?", "top 10"','[SIMULAR] Simulação — "e se removermos inativos?", "e se downgrade E3?"','[SAUDE] Saúde — "qual a saúde do M365?"','[CONTRATOS] Contratos — "ocupação dos contratos"','[TIPOS] Tipos/Cargos — "contas de serviço", "cargos"','','Também busco **nomes de pessoas** e **setores** diretamente!'].join('\n');}

  function anaResumo(c){
    var h=calcHealth();
    var ip=c.in_.filter(function(r){return r.licId&&r.licId!=='none'&&r.licId!=='other';});
    var cd=0;ip.forEach(function(r){cd+=(r.custo||0);});
    var topS=Object.keys(c.bS).sort(function(a,b){return c.bS[b].c-c.bS[a].c;}).slice(0,3);
    var cls=h.score>=90?'good':h.score>=70?'warn':'bad';
    var lines=['**Visão geral do Microsoft 365**','','**Saúde: '+h.score+'/100**','',
      '- **'+c.data.length+'** contas ('+c.at.length+' ativas, '+c.in_.length+' inativas)',
      '- Custo mensal: **'+R(c.ct)+'**',
      '- Custo anual: **'+R(c.ct*12)+'**',
      '- Média/ativo: **'+R(c.at.length?c.ct/c.at.length:0)+'**'];
    if(ip.length)lines.push('- ALERTA: '+ip.length+' inativos com licença: **'+R(cd)+'/mês perdidos**');
    lines.push('','**Top setores:**');
    topS.forEach(function(s,i){lines.push((i+1)+'. '+s+': '+c.bS[s].n+'p, **'+R(c.bS[s].c)+'/mês** ('+pct(c.bS[s].c,c.ct)+'%)');});
    if(h.issues.length){lines.push('','**Alertas:**');h.issues.slice(0,3).forEach(function(is){lines.push('- '+is.text.replace(/<[^>]+>/g,''));});}
    return lines.join('\n');
  }

  function anaCusto(c){
    var ca=0;c.at.forEach(function(r){ca+=(r.custo||0);});
    var lines=['**[ECONOMIA] Custo mensal: '+R(c.ct)+'**','**Anual: '+R(c.ct*12)+'**','','- '+c.data.length+' contas ('+c.at.length+' ativas)','- Média/ativo: **'+R(c.at.length?ca/c.at.length:0)+'**','','**Por licença:**'];
    Object.keys(c.bL).sort(function(a,b){return c.bL[b].c-c.bL[a].c;}).forEach(function(lid){
      var s=c.bL[lid];lines.push('- '+LN(lid)+': **'+s.n+'** × '+R(LP(lid))+' = **'+R(s.c)+'/mês** ('+pct(s.c,c.ct)+'%)');
    });
    return lines.join('\n');
  }

  function anaSetores(c){
    var sorted=Object.keys(c.bS).sort(function(a,b){return c.bS[b].c-c.bS[a].c;});
    var lines=['**[SETOR] Setores por custo:**',''];
    sorted.forEach(function(s,i){var st=c.bS[s];var inat=st.n-st.at;lines.push((i+1)+'. **'+s+'**: '+st.n+'p'+(inat?' ('+inat+' inat.)':'')+', **'+R(st.c)+'/mês** ('+pct(st.c,c.ct)+'%)');});
    lines.push('','[DICA] Pergunte "**detalhe do [setor]**" para drill-down.');
    return lines.join('\n');
  }

  function anaSetorDetalhe(setor,c){
    var st=c.bS[setor];if(!st)return'Setor **'+setor+'** não encontrado.';
    var bL={},bA={};
    st.us.forEach(function(r){var lid=r.licId||'none';bL[lid]=(bL[lid]||0)+1;var a=r.area||'Geral';if(!bA[a])bA[a]={n:0,c:0};bA[a].n++;bA[a].c+=(r.custo||0);});
    var inat=st.n-st.at;
    var lines=['**[SETOR] '+setor+'**','','- **'+st.n+'** pessoas ('+st.at+' ativos'+(inat?', '+inat+' inativos':'')+')','- Custo: **'+R(st.c)+'/mês** ('+R(st.c*12)+'/ano)','- Média: **'+R(st.at?st.c/st.at:0)+'/pessoa**'];
    var aKeys=Object.keys(bA);
    if(aKeys.length>1||(aKeys.length===1&&aKeys[0]!=='Geral')){
      lines.push('','**Áreas:**');
      aKeys.sort(function(a,b){return bA[b].c-bA[a].c;}).forEach(function(a){lines.push('- '+a+': '+bA[a].n+'p, **'+R(bA[a].c)+'/mês**');});
    }
    lines.push('','**Licenças:**');
    Object.keys(bL).sort(function(a,b){return bL[b]-bL[a];}).forEach(function(lid){lines.push('- '+LN(lid)+': '+bL[lid]);});
    var ipS=st.us.filter(function(r){return r.status!=='Ativo'&&r.licId&&r.licId!=='none'&&r.licId!=='other';});
    if(ipS.length){var cd=0;ipS.forEach(function(r){cd+=(r.custo||0);});lines.push('','ALERTA: **'+ipS.length+' inativos com licença**: '+R(cd)+'/mês');ipS.slice(0,5).forEach(function(r){lines.push('  - '+r.nome+' ('+LN(r.licId)+')');});if(ipS.length>5)lines.push('  - ...+'+( ipS.length-5)+' mais');}
    var topU=st.us.filter(function(r){return(r.custo||0)>0;}).sort(function(a,b){return(b.custo||0)-(a.custo||0);}).slice(0,5);
    if(topU.length){lines.push('','**Mais caros:**');topU.forEach(function(r,i){lines.push((i+1)+'. '+r.nome+' — '+LN(r.licId)+' **'+R(r.custo)+'**');});}
    return lines.join('\n');
  }

  function anaDesp(c){
    var ip=c.in_.filter(function(r){return r.licId&&r.licId!=='none'&&r.licId!=='other';});
    var cd=0;ip.forEach(function(r){cd+=(r.custo||0);});
    var lines=['**ALERTA: Análise de desperdício:**',''];
    if(ip.length){
      lines.push('**'+ip.length+' contas inativas com licença paga**');
      lines.push('- Desperdiçando: **'+R(cd)+'/mês** ('+R(cd*12)+'/ano)','','**Por licença:**');
      var bL={};ip.forEach(function(r){var lid=r.licId;if(!bL[lid])bL[lid]={n:0,c:0,nm:[]};bL[lid].n++;bL[lid].c+=(r.custo||0);if(bL[lid].nm.length<4)bL[lid].nm.push(r.nome);});
      Object.keys(bL).sort(function(a,b){return bL[b].c-bL[a].c;}).forEach(function(lid){var b=bL[lid];lines.push('- '+LN(lid)+': **'+b.n+'** → '+R(b.c)+'/mês');lines.push('  '+b.nm.join(', ')+(b.n>4?'...':''));});
      var bS={};ip.forEach(function(r){var s=r.setor||'—';if(!bS[s])bS[s]={n:0,c:0};bS[s].n++;bS[s].c+=(r.custo||0);});
      lines.push('','**Por setor:**');
      Object.keys(bS).sort(function(a,b){return bS[b].c-bS[a].c;}).slice(0,5).forEach(function(s){lines.push('- '+s+': '+bS[s].n+' inativos → '+R(bS[s].c)+'/mês');});
    }else{lines.push('[OK] Nenhum inativo com licença paga!');}
    var usage=U(),low=[];
    c.at.forEach(function(r){if(!r.licId||r.licId==='none')return;var u=usage[r.email];if(u&&(u.mailboxMB||0)<50&&(u.onedriveMB||0)<50)low.push(r);});
    if(low.length){var lc=0;low.forEach(function(r){lc+=(r.custo||0);});lines.push('','**'+low.length+' ativos com uso muito baixo** (<50MB):');lines.push('- Custo: **'+R(lc)+'/mês**');low.slice(0,5).forEach(function(r){lines.push('  - '+r.nome+' ('+r.setor+', '+LN(r.licId)+')');});if(low.length>5)lines.push('  - ...+'+(low.length-5)+' mais');}
    if(ip.length)lines.push('','[DICA] **Ação:** Remover licenças dos inativos economiza **'+R(cd)+'/mês** imediatamente.');
    return lines.join('\n');
  }

  function anaSetorDesp(setor,c){
    var st=c.bS[setor];if(!st)return'Setor **'+setor+'** não encontrado.';
    var ip=st.us.filter(function(r){return r.status!=='Ativo'&&r.licId&&r.licId!=='none'&&r.licId!=='other';});
    if(!ip.length)return'[OK] **'+setor+'** não tem inativos com licença paga!';
    var cv=0;ip.forEach(function(r){cv+=(r.custo||0);});
    var lines=['**ALERTA: Desperdício em '+setor+':**','','**'+ip.length+' inativos** com licença: **'+R(cv)+'/mês**',''];
    ip.forEach(function(r){lines.push('- '+r.nome+' — '+LN(r.licId)+' ('+R(r.custo)+'/mês)');});
    return lines.join('\n');
  }

  function anaOtim(c){
    var lines=['**[DICA] Oportunidades de otimização:**',''],total=0,num=0;
    var ip=c.in_.filter(function(r){return r.licId&&r.licId!=='none'&&r.licId!=='other';});
    if(ip.length){var cv=0;ip.forEach(function(r){cv+=(r.custo||0);});lines.push('**'+(++num)+'. Remover licenças de inativos**','- '+ip.length+' contas → **'+R(cv)+'/mês**','- Risco: zero (contas já inativas)','');total+=cv;}
    var e3b=c.at.filter(function(r){if(r.licId!=='e3')return false;var g=norm(r.cargo||'');return g==='colaborador'||g.indexOf('assistente')>=0||g.indexOf('auxiliar')>=0||g.indexOf('estagiario')>=0||g.indexOf('operador')>=0||g.indexOf('atendente')>=0;});
    if(e3b.length){var eco=e3b.length*(LP('e3')-LP('bstd'));lines.push('**'+(++num)+'. E3 → Standard** (cargos básicos)','- '+e3b.length+' usuários → **'+R(eco)+'/mês**','- Perdem: compliance avançado, mail ilimitado','');total+=eco;}
    var usage=U();
    if(Object.keys(usage).length){
      var nd=c.at.filter(function(r){if(r.licId!=='bstd')return false;var u=usage[r.email];return u&&!u.appsDesktop;});
      if(nd.length){var eco=nd.length*(LP('bstd')-LP('bbasic'));lines.push('**'+(++num)+'. Standard → Basic** (sem apps desktop)','- '+nd.length+' usuários → **'+R(eco)+'/mês**','- Perdem: instalação desktop','');total+=eco;}
      var lb=c.at.filter(function(r){if(r.licId!=='bbasic')return false;var u=usage[r.email];return u&&(u.mailboxMB||0)<200&&(u.onedriveMB||0)<500;});
      if(lb.length){var eco=lb.length*(LP('bbasic')-LP('f3'));lines.push('**'+(++num)+'. Basic → F3** (uso muito baixo)','- '+lb.length+' usuários → **'+R(eco)+'/mês**','- Perdem: storage (50GB→2GB mail)','');total+=eco;}
    }
    var sv=c.data.filter(function(r){return(r.tipo==='Compartilhado'||r.tipo==='Servico'||r.tipo==='Sala')&&(r.licId==='bstd'||r.licId==='e3');});
    if(sv.length){var sc=0;sv.forEach(function(r){sc+=((r.custo||0)-LP('f3'));});if(sc>0){lines.push('**'+(++num)+'. Contas de serviço com licença premium**','- '+sv.length+' contas → até **'+R(sc)+'/mês**','');total+=sc;}}
    if(total>0){lines.push('**[DADOS] Economia total: '+R(total)+'/mês ('+R(total*12)+'/ano)**');lines.push('Isso é **'+pct(total,c.ct)+'%** do custo atual.');}
    else lines.push('[OK] Custos bem otimizados!');
    return lines.join('\n');
  }

  function anaLicencas(c){
    var lines=['**[LICENCAS] Licenças (ativos):**',''];
    Object.keys(c.bL).sort(function(a,b){return c.bL[b].c-c.bL[a].c;}).forEach(function(lid){var s=c.bL[lid];lines.push('- **'+LN(lid)+'**: '+s.n+' × '+R(LP(lid))+' = **'+R(s.c)+'/mês** ('+pct(s.c,c.ct)+'%)');});
    lines.push('','[DICA] Pergunte "**o que inclui o E3?**" ou "**diferença standard vs basic**".');
    return lines.join('\n');
  }

  function anaLicDetalhe(lid,c){
    var s=c.bL[lid]||{n:0,c:0};var users=c.data.filter(function(r){return r.licId===lid;});
    var at=users.filter(function(r){return r.status==='Ativo';}).length;
    var lines=['**[LICENCAS] '+LN(lid)+'**','','- Preço: **'+R(LP(lid))+'/mês**','- Total: **'+s.n+'** ('+at+' ativos)','- Custo: **'+R(s.c)+'/mês**'];
    var bS={};users.forEach(function(r){var s=r.setor||'—';bS[s]=(bS[s]||0)+1;});
    lines.push('','**Por setor:**');Object.keys(bS).sort(function(a,b){return bS[b]-bS[a];}).slice(0,8).forEach(function(s){lines.push('- '+s+': '+bS[s]);});
    return lines.join('\n');
  }

  function anaExplainLic(lid){
    var f={'bstd':['Apps desktop (Word, Excel, PowerPoint, Outlook)','Teams completo + Webinars','Exchange 50GB','OneDrive 1TB','SharePoint'],'bbasic':['Apps web e mobile apenas','Teams completo','Exchange 50GB','OneDrive 1TB','SharePoint'],'e3':['Tudo do Standard +','Exchange ilimitado','Compliance e auditoria','eDiscovery','Information Rights Management'],'f3':['Apps web e mobile apenas','Teams Essentials','Exchange 2GB','OneDrive 2GB','Ideal para frontline'],'apps':['Apps desktop (Word, Excel, PowerPoint)','OneDrive 1TB','SEM Exchange/email','SEM Teams','Ideal como add-on'],'pbi':['Dashboards compartilhados','Relatórios avançados','API e embed','Add-on (precisa licença base)']};
    var feat=f[lid];if(!feat)return'Licença não encontrada.';
    var lines=['**'+LN(lid)+' — '+R(LP(lid))+'/mês**','','**Inclui:**'];feat.forEach(function(x){lines.push('- '+x);});
    return lines.join('\n');
  }

  function anaExplainGeral(){
    return['**Comparativo de licenças:**','','- **E3** ('+R(LP('e3'))+'): Desktop ✓ · Mail ilimitado · Compliance','- **Standard** ('+R(LP('bstd'))+'): Desktop ✓ · Mail 50GB · Teams completo','- **Basic** ('+R(LP('bbasic'))+'): Web/Mobile · Mail 50GB · Teams','- **F3** ('+R(LP('f3'))+'): Web/Mobile · Mail 2GB · Drive 2GB','- **Apps** ('+R(LP('apps'))+'): Desktop ✓ · SEM mail · SEM Teams','','[DICA] Standard vs Basic: **'+R(LP('bstd')-LP('bbasic'))+'/mês** a mais = apps desktop','[DICA] E3 vs Standard: **'+R(LP('e3')-LP('bstd'))+'/mês** a mais = compliance + mail ilimitado'].join('\n');
  }

  function anaUso(c){
    var usage=U(),keys=Object.keys(usage);
    if(!keys.length)return'Dados de uso indisponíveis. Sincronize em **Config**.';
    var m={t:0,lo:0,hi:0,sm:0},d={t:0,lo:0,hi:0,sm:0},ap={dk:0,wb:0,mb:0};
    keys.forEach(function(e){var u=usage[e];if(u.mailboxMB!=null){m.t++;m.sm+=u.mailboxMB;if(u.mailboxMB<100)m.lo++;if(u.mailboxMB>5000)m.hi++;}if(u.onedriveMB!=null){d.t++;d.sm+=u.onedriveMB;if(u.onedriveMB<100)d.lo++;if(u.onedriveMB>10000)d.hi++;}if(u.appsDesktop)ap.dk++;if(u.appsWeb)ap.wb++;if(u.appsMobile)ap.mb++;});
    return['**Análise de uso:**','','**Mailbox:** '+m.t+' usuários · Média: '+Math.round(m.t?m.sm/m.t:0)+'MB','- '+m.lo+' com <100MB ('+pct(m.lo,m.t)+'%) · '+m.hi+' com >5GB','','**OneDrive:** '+d.t+' usuários · Média: '+Math.round(d.t?d.sm/d.t:0)+'MB','- '+d.lo+' com <100MB ('+pct(d.lo,d.t)+'%) · '+d.hi+' com >10GB','','**Apps M365:** Desktop: **'+ap.dk+'** · Web: **'+ap.wb+'** · Mobile: **'+ap.mb+'**','',''+pct(m.lo,m.t)+'% com mailbox vazio pode indicar licença desnecessária.'].join('\n');
  }

  function anaUsoSetor(setor,c){
    var st=c.bS[setor];if(!st)return'Setor não encontrado.';
    var usage=U(),dk=0,wb=0,mb=0,low=[];
    st.us.forEach(function(r){if(r.status!=='Ativo')return;var u=usage[r.email];if(!u)return;if(u.appsDesktop)dk++;if(u.appsWeb)wb++;if(u.appsMobile)mb++;if((u.mailboxMB||0)<50&&(u.onedriveMB||0)<50)low.push(r);});
    var lines=['**[DADOS] Uso em '+setor+':**','','- Desktop: '+dk+' · Web: '+wb+' · Mobile: '+mb];
    if(low.length){var lc=0;low.forEach(function(r){lc+=(r.custo||0);});lines.push('','ALERTA: **'+low.length+' com uso muito baixo** ('+R(lc)+'/mês):');low.slice(0,5).forEach(function(r){lines.push('- '+r.nome+' ('+LN(r.licId)+')');});if(low.length>5)lines.push('- ...+'+(low.length-5));}
    return lines.join('\n');
  }

  function anaTrend(c){
    var snaps=S();if(snaps.length<2)return'Necessário **2+ snapshots**. Sincronize em meses diferentes.';
    var lines=['**[TENDENCIA] Tendência:**',''],prevC=0;
    snaps.slice(-6).forEach(function(snap,i){var cv=0;(snap.data||[]).forEach(function(r){cv+=(r.custo||0);});var d=i>0?cv-prevC:0;var ind=i===0?'':(d>0?' ▲+'+R(d):d<0?' ▼'+R(d):' →');lines.push('- **'+snap.label+'**: '+(snap.data||[]).length+'p, '+R(cv)+ind);prevC=cv;});
    var f=snaps[0],l=snaps[snaps.length-1],cF=0,cL=0;
    (f.data||[]).forEach(function(r){cF+=(r.custo||0);}); (l.data||[]).forEach(function(r){cL+=(r.custo||0);});
    lines.push('','**Total ('+f.label+' → '+l.label+'):** '+(cL>=cF?'+':'')+R(cL-cF));
    return lines.join('\n');
  }

  function anaTop(c){
    var sorted=c.data.filter(function(r){return(r.custo||0)>0;}).sort(function(a,b){return(b.custo||0)-(a.custo||0);});
    var lines=['**[RANKING] Top 15 por custo:**',''];
    sorted.slice(0,15).forEach(function(r,i){lines.push((i+1)+'. **'+r.nome+'** — '+r.setor+' · '+LN(r.licId)+' → **'+R(r.custo)+'**');});
    return lines.join('\n');
  }
  function anaTopSetor(setor,c){
    var st=c.bS[setor];if(!st)return'Setor não encontrado.';
    var sorted=st.us.filter(function(r){return(r.custo||0)>0;}).sort(function(a,b){return(b.custo||0)-(a.custo||0);});
    var lines=['**[RANKING] Top em '+setor+':**',''];
    sorted.slice(0,10).forEach(function(r,i){lines.push((i+1)+'. **'+r.nome+'** — '+LN(r.licId)+' **'+R(r.custo)+'** '+(r.status!=='Ativo'?'_(inativo)_':''));});
    return lines.join('\n');
  }

  function anaContratos(c){
    var contracts=CT();if(!contracts.length)return'Nenhum contrato cadastrado. Vá em **Contratos**.';
    var lines=['**[CONTRATOS] Contratos:**',''];
    contracts.forEach(function(ct){var used=c.at.filter(function(r){return r.licId===ct.licId;}).length;var occ=ct.qtd?pct(used,ct.qtd):0;lines.push('- **'+(ct.nome||LN(ct.licId))+'**: '+used+'/'+ct.qtd+' ('+occ+'%) — '+R((ct.preco||0)*(ct.qtd||0))+'/mês'+(occ>95?' — **atenção**':''));});
    return lines.join('\n');
  }

  function anaTipos(c){
    var lines=['**[TIPOS] Tipos de conta:**',''];
    Object.keys(c.bT).sort(function(a,b){return c.bT[b].n-c.bT[a].n;}).forEach(function(t){lines.push('- **'+t+'**: '+c.bT[t].n+' contas, **'+R(c.bT[t].c)+'/mês**');});
    return lines.join('\n');
  }

  function anaCargos(c){
    var sorted=Object.keys(c.bC).sort(function(a,b){return c.bC[b].n-c.bC[a].n;});
    var lines=['**[CARGOS] Top cargos:**',''];
    sorted.slice(0,15).forEach(function(cv,i){lines.push((i+1)+'. **'+cv+'**: '+c.bC[cv].n+'p, '+R(c.bC[cv].c)+'/mês');});
    return lines.join('\n');
  }

  function anaPessoa(r,c){
    var usage=U(),u=usage[r.email];
    var lines=['**[PERFIL] '+r.nome+'**','','- Email: '+r.email,'- Setor: **'+(r.setor||'—')+'**'+(r.area?' > '+r.area:'')+(r.subarea?' > '+r.subarea:''),'- Cargo: '+(r.cargo||'—'),'- Licença: **'+LN(r.licId)+'** ('+R(LP(r.licId))+'/mês)','- Custo: **'+R(r.custo)+'/mês**','- Status: **'+r.status+'**','- Tipo: '+(r.tipo||'Pessoa')];
    if(u){lines.push('','**Uso:**');
      if(u.mailboxMB!=null)lines.push('- Mailbox: '+Math.round(u.mailboxMB)+'MB'+(u.mailboxItems?' ('+u.mailboxItems+' itens)':''));
      if(u.onedriveMB!=null)lines.push('- OneDrive: '+Math.round(u.onedriveMB)+'MB'+(u.onedriveFiles?' ('+u.onedriveFiles+' arq.)':''));
      var apps=[];if(u.appsDesktop)apps.push('Desktop [OK]');if(u.appsWeb)apps.push('Web [OK]');if(u.appsMobile)apps.push('Mobile [OK]');
      if(apps.length)lines.push('- Apps: '+apps.join(' · '));
      if(!u.appsDesktop&&!u.appsWeb&&!u.appsMobile)lines.push('- Sem uso de apps detectado');}
    // Recomendações
    if(r.status!=='Ativo'&&r.licId&&r.licId!=='none')lines.push('','ALERTA: **Inativo com licença!** Remova para economizar **'+R(r.custo)+'/mês**.');
    else if(u&&!u.appsDesktop&&(r.licId==='bstd'||r.licId==='e3')){var nl=r.licId==='e3'?'bstd':'bbasic';lines.push('','[DICA] Não usa desktop → downgrade para **'+LN(nl)+'** economiza **'+R(LP(r.licId)-LP(nl))+'/mês**.');}
    else if(u&&(u.mailboxMB||0)<50&&(u.onedriveMB||0)<50&&r.licId&&r.licId!=='none'&&r.licId!=='f3')lines.push('','[DICA] Uso muito baixo. Avaliar se precisa de licença **'+LN(r.licId)+'**.');
    return lines.join('\n');
  }

  function anaCount(q,c){
    if(q.indexOf('inativ')>=0)return'**'+c.in_.length+'** contas inativas.';
    if(q.indexOf('ativ')>=0)return'**'+c.at.length+'** contas ativas.';
    if(q.indexOf('licen')>=0){var n=0;c.data.forEach(function(r){if(r.licId&&r.licId!=='none')n++;});return'**'+n+'** com licença.';}
    if(q.indexOf('setor')>=0)return'**'+Object.keys(c.bS).length+'** setores.';
    return'**'+c.data.length+'** contas ('+c.at.length+' ativas, '+c.in_.length+' inativas).';
  }

  /* ── What-If ── */
  function anaWhatIf(q,c){
    // Remover inativos
    if(q.indexOf('remov')>=0&&(q.indexOf('inativ')>=0||q.indexOf('licen')>=0)){
      var ip=c.in_.filter(function(r){return r.licId&&r.licId!=='none'&&r.licId!=='other';});
      var cv=0;ip.forEach(function(r){cv+=(r.custo||0);});
      if(!ip.length)return'[OK] Não há inativos com licença para remover.';
      return['**[SIMULAR] Simulação: remover licenças de inativos**','','- Afetados: **'+ip.length+' contas**','- Economia: **'+R(cv)+'/mês** ('+R(cv*12)+'/ano)','- Novo custo mensal: **'+R(c.ct-cv)+'** (era '+R(c.ct)+')','- Redução: **'+pct(cv,c.ct)+'%**','','Risco: **zero** — contas já estão inativas.'].join('\n');
    }
    // Downgrade E3
    if(q.indexOf('e3')>=0||q.indexOf('enterprise')>=0){
      var e3=c.at.filter(function(r){return r.licId==='e3';});
      if(!e3.length)return'Não há usuários com E3.';
      var eco=e3.length*(LP('e3')-LP('bstd'));
      return['**[SIMULAR] Simulação: downgrade TODOS E3 → Standard**','','- Afetados: **'+e3.length+' usuários**','- Economia: **'+R(eco)+'/mês** ('+R(eco*12)+'/ano)','- Novo custo mensal: **'+R(c.ct-eco)+'**','','ALERTA: **Atenção:** Perdem compliance avançado, Exchange ilimitado, eDiscovery.','Recomendo avaliar caso a caso — nem todos podem fazer downgrade.'].join('\n');
    }
    // Downgrade Standard → Basic
    if(q.indexOf('standard')>=0&&q.indexOf('basic')>=0){
      var bstd=c.at.filter(function(r){return r.licId==='bstd';});
      if(!bstd.length)return'Não há usuários com Business Standard.';
      var eco=bstd.length*(LP('bstd')-LP('bbasic'));
      return['**[SIMULAR] Simulação: downgrade TODOS Standard → Basic**','','- Afetados: **'+bstd.length+' usuários**','- Economia: **'+R(eco)+'/mês** ('+R(eco*12)+'/ano)','','ALERTA: **Atenção:** Perdem apps desktop (Word, Excel, etc.)','Só faz sentido para quem usa apenas web/mobile.'].join('\n');
    }
    return['**[SIMULAR] Simulações disponíveis:**','','Pergunte coisas como:','- "E se removermos licenças dos inativos?"','- "E se downgrade todos E3?"','- "E se todos Standard virassem Basic?"','','Simulo o impacto financeiro de cada cenário.'].join('\n');
  }

  function anaHealth(c){
    var h=calcHealth();var cls=h.score>=90?'Excelente':h.score>=70?'Precisa atenção':'Crítico';
    var lines=['**[SAUDE] Saúde do M365: '+h.score+'/100 '+cls+'**',''];
    if(h.issues.length){lines.push('**Pontos de atenção:**');h.issues.forEach(function(is){lines.push('- '+is.text.replace(/<[^>]+>/g,''));if(is.sub)lines.push('  '+is.sub.replace(/<[^>]+>/g,''));});
      var totalSav=0;h.issues.forEach(function(is){if(is.saving)totalSav+=is.saving;});
      if(totalSav)lines.push('','[ECONOMIA] **Economia potencial: '+R(totalSav)+'/mês**');}
    else lines.push('[OK] Nenhum problema detectado. Excelente gestão!');
    lines.push('','**Como melhorar o score:**','- Remova licenças de inativos (+30 pontos)','- Adeque licenças aos cargos (+20 pontos)','- Monitore uso e contratos (+15 pontos)');
    return lines.join('\n');
  }

  function anaCompareSetores(q,c){
    // Tenta achar 2 setores na pergunta
    var setores=Object.keys(c.bS);
    var found=[];
    setores.sort(function(a,b){return b.length-a.length;}).forEach(function(s){if(q.indexOf(norm(s))>=0&&found.length<2)found.push(s);});
    if(found.length<2)return anaSetores(c);
    var a=c.bS[found[0]],b=c.bS[found[1]];
    return['**[DADOS] '+found[0]+' vs '+found[1]+':**','','| | **'+found[0]+'** | **'+found[1]+'** |','|---|---|---|',
      '- Pessoas: **'+a.n+'** vs **'+b.n+'**',
      '- Ativos: **'+a.at+'** vs **'+b.at+'**',
      '- Custo: **'+R(a.c)+'** vs **'+R(b.c)+'**',
      '- Média: **'+R(a.at?a.c/a.at:0)+'** vs **'+R(b.at?b.c/b.at:0)+'**',
      '- % total: **'+pct(a.c,c.ct)+'%** vs **'+pct(b.c,c.ct)+'%**',
    ].join('\n');
  }

  /* ══════════ UI ══════════ */
  function init() {
    fab = document.createElement('button');
    fab.className = 'ai-fab';
    fab.title = 'Assistente M365';
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
    fab.onclick = toggle;
    document.body.appendChild(fab);
    badge = document.createElement('span');
    badge.className = 'ai-fab-badge';
    fab.appendChild(badge);

    panel = document.createElement('div');
    panel.className = 'ai-panel';
    panel.innerHTML =
      '<div class="ai-header"><div class="ai-header-left"><div class="ai-header-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><rect x="3" y="10" width="18" height="8" rx="2"/><path d="M12 18v4"/><path d="M8 22h8"/></svg></div><div><div class="ai-header-title">Assistente M365</div><div class="ai-header-sub">Análise inteligente dos seus dados</div></div></div><div class="ai-header-actions"><button class="ai-header-btn" title="Limpar" id="aiClearBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button><button class="ai-header-btn" title="Fechar" id="aiCloseBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div></div>'+
      '<div class="ai-messages" id="aiMessages"></div>'+
      '<div class="ai-input-area"><textarea class="ai-input" id="aiInput" placeholder="Pergunte sobre custos, setores, pessoas..." rows="1"></textarea><button class="ai-send" id="aiSend" title="Enviar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button></div>';
    document.body.appendChild(panel);

    messageList = document.getElementById('aiMessages');
    input = document.getElementById('aiInput');
    sendBtn = document.getElementById('aiSend');
    document.getElementById('aiCloseBtn').onclick = toggle;
    document.getElementById('aiClearBtn').onclick = function(){lastTopic=null;lastSetor=null;showWelcome();};
    sendBtn.onclick = send;
    input.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
    input.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,80)+'px';});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&isOpen)toggle();});
    messageList.addEventListener('click',function(e){
      var sug=e.target.closest('.ai-suggestion')||e.target.closest('.ai-followup');
      if(sug){input.value=sug.getAttribute('data-q');send();}
    });

    // Delayed init — wait for data to load
    setTimeout(function(){showWelcome();updateBadge();},2000);
  }

  function updateBadge(){
    var data=D();if(!data.length){badge.textContent='';return;}
    var h=calcHealth();
    var count=h.issues.filter(function(is){return is.type==='warn'||is.type==='tip';}).length;
    badge.textContent=count>0?count:'';
  }

  function showWelcome(){
    var data=D();
    if(!data.length){
      messageList.innerHTML='<div class="ai-welcome"><div class="ai-welcome-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><rect x="3" y="10" width="18" height="8" rx="2"/><path d="M12 18v4"/><path d="M8 22h8"/></svg></div><div class="ai-welcome-title">Assistente M365</div><div class="ai-welcome-text">Carregando dados...</div></div>';
      return;
    }
    var c=build(),h=calcHealth();
    var cls=h.score>=90?'health-good':h.score>=70?'health-warn':'health-bad';
    var html='<div class="ai-welcome">';
    // Health score
    html+='<div class="ai-health-row"><div class="ai-health-circle '+cls+'">'+h.score+'</div><div class="ai-health-label"><strong>Saúde M365</strong>'+c.data.length+' contas · '+R(c.ct)+'/mês</div></div>';
    // Insights
    if(h.issues.length){
      html+='<div class="ai-welcome-insights">';
      h.issues.slice(0,4).forEach(function(is){
        html+='<div class="ai-insight-card ai-ic-'+is.type+'"><div class="ai-ic-icon">'+icSvg(is.type)+'</div><div class="ai-ic-text">'+is.text+(is.sub?'<br><span style="font-size:11px;color:var(--muted)">'+is.sub+'</span>':'')+'</div></div>';
      });
      html+='</div>';
    }
    // Suggestions
    html+='<div class="ai-suggestions">';
    html+='<span class="ai-suggestion" data-q="Como otimizar?">Otimizar</span>';
    html+='<span class="ai-suggestion" data-q="Tem desperdício?">Desperdício</span>';
    html+='<span class="ai-suggestion" data-q="Setores mais caros">Setores</span>';
    html+='<span class="ai-suggestion" data-q="Saúde do M365">Saúde</span>';
    html+='<span class="ai-suggestion" data-q="E se removermos inativos?">Simular</span>';
    html+='<span class="ai-suggestion" data-q="Ajuda">Ajuda</span>';
    html+='</div></div>';
    messageList.innerHTML=html;
  }

  function toggle(){
    isOpen=!isOpen;
    if(isOpen){panel.classList.add('open');fab.classList.add('hidden');input.focus();updateBadge();}
    else{panel.classList.remove('open');fab.classList.remove('hidden');fab.focus();}
  }

  function appendMsg(role,content){
    var w=messageList.querySelector('.ai-welcome');if(w)w.remove();
    var div=document.createElement('div');
    div.className='ai-msg ai-msg-'+role;
    if(role==='ai')div.innerHTML=renderMd(content);else div.textContent=content;
    messageList.appendChild(div);
    messageList.scrollTop=messageList.scrollHeight;
    return div;
  }

  function appendFollowups(list){
    if(!list||!list.length)return;
    var wrap=document.createElement('div');wrap.className='ai-followups';
    list.forEach(function(txt){
      var btn=document.createElement('button');btn.className='ai-followup';btn.setAttribute('data-q',txt);btn.textContent=txt;
      wrap.appendChild(btn);
    });
    messageList.appendChild(wrap);
    messageList.scrollTop=messageList.scrollHeight;
  }

  function send(){
    if(isTyping)return;
    var text=(input.value||'').trim();if(!text)return;
    input.value='';input.style.height='auto';
    appendMsg('user',text);
    isTyping=true;sendBtn.disabled=true;

    var result=analyze(text);
    var fullText=result.text||result;
    var followups=result.followups||[];

    // Typing animation — word by word
    var bubble=appendMsg('ai','');
    var words=fullText.split(/(\s+)/);
    var idx=0,accumulated='';
    bubble.innerHTML='<span class="ai-cursor"></span>';

    var timer=setInterval(function(){
      if(idx>=words.length){
        clearInterval(timer);
        bubble.innerHTML=renderMd(fullText);
        appendFollowups(followups);
        isTyping=false;sendBtn.disabled=false;
        return;
      }
      accumulated+=words[idx];idx++;
      // Render every 3 words for speed
      if(idx%3===0||idx>=words.length){
        bubble.innerHTML=renderMd(accumulated)+'<span class="ai-cursor"></span>';
        messageList.scrollTop=messageList.scrollHeight;
      }
    },18);
  }

  /* ── SVG Icons ── */
  var IC={
    warn:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    tip:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>',
    info:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    trend:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>'
  };
  function icSvg(type){return'<svg class="ai-ic-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+(IC[type]||IC.info).replace(/<\/?svg[^>]*>/g,'')+'</svg>';}
  function renderMd(text){
    if(!text)return'';
    // Remover tags de categoria — o contexto já é dado pelo título
    text=text.replace(/\[(ECONOMIA|DADOS|SETOR|PERFIL|LICENCAS|TENDENCIA|RANKING|SIMULAR|SAUDE|CONTRATOS|TIPOS|CARGOS|CONFIG|QUEDA|DICA|!)\]\s?/g,'');
    text=text.replace(/\[([●◐○])\]\s?/g,'');
    text=text.replace(/ALERTA:\s?/g,'');
    // [OK] no início de frase → remover; inline (Desktop [OK]) → check
    text=text.replace(/^\[OK\]\s?/gm,'');
    text=text.replace(/\[OK\]/g,'\u2713');
    var html=text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    html=html.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
    html=html.replace(/`([^`]+)`/g,'<code style="background:var(--sand-lt);padding:1px 5px;border-radius:3px;font-size:12px">$1</code>');
    html=html.replace(/_([^_]+)_/g,'<em>$1</em>');
    var lines=html.split('\n'),result=[],inList=false,lt='';
    for(var i=0;i<lines.length;i++){
      var tr=lines[i].trim();
      if(/^[-\u2022]\s/.test(tr)||/^- /.test(tr)){
        if(!inList||lt!=='ul'){if(inList)result.push('</'+lt+'>');result.push('<ul>');inList=true;lt='ul';}
        result.push('<li>'+tr.replace(/^[-\u2022]\s*/,'').replace(/^- /,'')+'</li>');
        continue;}
      if(/^\d+\.\s/.test(tr)){
        if(!inList||lt!=='ol'){if(inList)result.push('</'+lt+'>');result.push('<ol>');inList=true;lt='ol';}
        result.push('<li>'+tr.replace(/^\d+\.\s/,'')+'</li>');continue;}
      if(inList){result.push('</'+lt+'>');inList=false;}
      if(!tr)continue;
      result.push('<p>'+tr+'</p>');
    }
    if(inList)result.push('</'+lt+'>');
    return result.join('');
  }

  document.addEventListener('DOMContentLoaded',init);
  return{toggle:toggle};
})();
