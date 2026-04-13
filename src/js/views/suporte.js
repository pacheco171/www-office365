/* ══════════ SUPORTE — Chat IA + Sistema de Chamados ══════════ */

var _suporteTickets = null;

function renderSuporteView(){
  _renderSuporteChat();
  _renderSuporteForm();
  _loadSuporteTickets();
}

function _renderSuporteChat(){
  var el = document.getElementById('suporteChatContent');
  if(!el) return;

  el.innerHTML = '<div class="suporte-chat-inline">'
    + '<div style="text-align:center;margin-bottom:20px">'
    + '<div style="font-size:32px;margin-bottom:8px">&#129302;</div>'
    + '<div style="font-weight:700;font-size:16px">Assistente LIVE!</div>'
    + '<div style="font-size:12px;color:var(--muted)">Pergunte sobre licenças, custos, otimização ou qualquer dúvida sobre o Microsoft 365</div>'
    + '</div>'
    + '<div id="suporteChatMessages" style="min-height:200px;max-height:400px;overflow-y:auto;padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:12px"></div>'
    + '<div style="display:flex;gap:8px">'
    + '<input type="text" class="form-input" id="suporteChatInput" placeholder="Digite sua pergunta..." style="flex:1" onkeydown="if(event.key===\'Enter\')_sendSuporteChat()">'
    + '<button class="btn btn-dark" onclick="_sendSuporteChat()">Enviar</button>'
    + '</div>'
    + '</div>';
}

function _sendSuporteChat(){
  var input = document.getElementById('suporteChatInput');
  var messages = document.getElementById('suporteChatMessages');
  if(!input || !messages || !input.value.trim()) return;

  var q = input.value.trim();
  input.value = '';

  messages.innerHTML += '<div style="margin-bottom:12px;text-align:right"><div style="display:inline-block;background:var(--black);color:#fff;padding:8px 14px;border-radius:10px 10px 2px 10px;font-size:13px;max-width:80%">'+esc(q)+'</div></div>';

  messages.innerHTML += '<div style="margin-bottom:12px" id="suporteBotTyping"><div style="display:inline-block;background:var(--sand-lt);padding:8px 14px;border-radius:10px 10px 10px 2px;font-size:13px;color:var(--muted)">Analisando...</div></div>';
  messages.scrollTop = messages.scrollHeight;

  if(typeof aiChat !== 'undefined' && typeof aiChat.ask === 'function'){
    aiChat.ask(q, function(answer){
      var typing = document.getElementById('suporteBotTyping');
      if(typing) typing.remove();
      messages.innerHTML += '<div style="margin-bottom:12px"><div style="display:inline-block;background:var(--sand-lt);padding:8px 14px;border-radius:10px 10px 10px 2px;font-size:13px;max-width:80%;line-height:1.5">'+answer+'</div></div>';
      messages.scrollTop = messages.scrollHeight;
    });
  } else {
    setTimeout(function(){
      var typing = document.getElementById('suporteBotTyping');
      if(typing) typing.remove();
      var response = _getLocalResponse(q);
      messages.innerHTML += '<div style="margin-bottom:12px"><div style="display:inline-block;background:var(--sand-lt);padding:8px 14px;border-radius:10px 10px 10px 2px;font-size:13px;max-width:80%;line-height:1.5">'+response+'</div></div>';
      messages.scrollTop = messages.scrollHeight;
    }, 800);
  }
}

function _getLocalResponse(q){
  var ql = q.toLowerCase();
  if(ql.includes('licença') || ql.includes('license')) return 'Para gerenciar licenças, acesse a seção <strong>Licenças M365</strong> no menu lateral. Lá você encontra a distribuição por tipo, setor e histórico.';
  if(ql.includes('custo') || ql.includes('preço')) return 'Os custos são calculados automaticamente com base nas licenças atribuídas. Confira o <strong>Dashboard</strong> para o resumo e o <strong>Radar</strong> para oportunidades de economia.';
  if(ql.includes('radar') || ql.includes('economia')) return 'O <strong>Radar</strong> detecta automaticamente desperdícios e oportunidades de economia. Acesse pelo menu Gestão → Radar.';
  if(ql.includes('segurança') || ql.includes('alerta')) return 'Verifique a seção <strong>Alertas de Segurança</strong> no menu Segurança para ver alertas do Microsoft e análise local de riscos.';
  return 'Obrigado pela pergunta! Para suporte mais detalhado, abra um chamado na aba <strong>Abrir Chamado</strong>. Nossa equipe responderá em até 24h.';
}

function _renderSuporteForm(){
  var el = document.getElementById('suporteFormContent');
  if(!el) return;

  el.innerHTML = '<div class="suporte-form">'
    + '<div style="text-align:center;margin-bottom:24px"><div style="font-weight:700;font-size:16px">Abrir Chamado</div><div style="font-size:12px;color:var(--muted)">Descreva seu problema ou solicitação. Nossa equipe responderá por e-mail.</div></div>'
    + '<div class="form-group"><label>Assunto *</label><input type="text" class="form-input" id="ticketSubject" placeholder="Ex: Problema ao acessar o OneDrive"></div>'
    + '<div class="form-group"><label>Categoria</label><select class="form-select" id="ticketCategory"><option value="Licença">Licença</option><option value="Acesso">Acesso</option><option value="Configuração">Configuração</option><option value="Bug">Bug / Erro</option><option value="Outro">Outro</option></select></div>'
    + '<div class="form-group"><label>Descrição *</label><textarea class="form-input" id="ticketMessage" placeholder="Descreva detalhadamente o problema ou solicitação..."></textarea></div>'
    + '<div style="text-align:right"><button class="btn btn-dark" onclick="_submitTicket()">Enviar Chamado</button></div>'
    + '</div>';
}

function _submitTicket(){
  var subject = document.getElementById('ticketSubject');
  var category = document.getElementById('ticketCategory');
  var message = document.getElementById('ticketMessage');

  if(!subject.value.trim() || !message.value.trim()){
    toast('Preencha o assunto e a descrição.');
    return;
  }

  var ticket = {
    subject: subject.value.trim(),
    category: category.value,
    message: message.value.trim()
  };

  fetch('/api/support/ticket', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(ticket)
  }).then(function(r){ return r.json(); }).then(function(res){
    if(res.error){
      toast('Erro: '+res.error);
      return;
    }
    toast('Chamado enviado com sucesso!');
    subject.value = '';
    message.value = '';
    _suporteTickets = null;
    _loadSuporteTickets();
  }).catch(function(){
    toast('Erro ao enviar chamado.');
  });
}

function _loadSuporteTickets(){
  var el = document.getElementById('suporteChamadosContent');
  if(!el) return;

  if(_suporteTickets){
    _renderTickets(el, _suporteTickets);
    return;
  }

  el.innerHTML = loadingHTML('Carregando chamados...');

  fetchWithTimeout('/api/support/tickets').then(function(r){ return r.json(); }).then(function(res){
    _suporteTickets = res.data || [];
    _renderTickets(el, _suporteTickets);
  }).catch(function(){
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">Nenhum chamado encontrado.</div>';
  });
}

function _renderTickets(el, tickets){
  if(tickets.length === 0){
    el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--muted)">Nenhum chamado aberto. Use a aba "Abrir Chamado" para criar um.</div>';
    return;
  }

  var html = '<div style="padding:16px">';
  tickets.forEach(function(t){
    var statusCls = t.status === 'resolvido' ? 'b-active' : t.status === 'em_andamento' ? 'b-pending' : 'b-inactive';
    var statusLabel = t.status === 'resolvido' ? 'Resolvido' : t.status === 'em_andamento' ? 'Em Andamento' : 'Aberto';
    html += '<div class="ticket-card">';
    html += '<div class="ticket-card-hdr"><div class="ticket-card-subject">'+esc(t.subject)+'</div><span class="badge '+statusCls+'">'+statusLabel+'</span></div>';
    html += '<div class="ticket-card-body">'+esc(t.message||'').substring(0,200)+(t.message && t.message.length > 200 ? '...' : '')+'</div>';
    html += '<div class="ticket-card-meta"><span>'+esc(t.category||'')+'</span><span>'+(t.created ? fmtDate(t.created.split('T')[0]) : '')+'</span></div>';
    html += '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
}
