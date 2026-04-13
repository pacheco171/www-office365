/* ══════════ PRIVILÉGIOS — Usuários com roles administrativas ══════════ */

var _privilegiosData = null;
var _privilegiosLastUpdated = null;
var _privilegiosUpdateTimer = null;

function refreshPrivilegios() {
  _privilegiosData = null;
  _privilegiosLastUpdated = new Date();
  clearTimeout(_privilegiosUpdateTimer);
  var el = document.getElementById('privilegiosLastUpdated');
  if(el) el.textContent = 'Agora mesmo';
  renderPrivilegiosView();
  _privilegiosUpdateTimer = setTimeout(_updatePrivilegiosLastUpdated, 60000);
}

function _updatePrivilegiosLastUpdated() {
  if(!_privilegiosLastUpdated || document.hidden) return;
  var mins = Math.floor((new Date() - _privilegiosLastUpdated) / 60000);
  var el = document.getElementById('privilegiosLastUpdated');
  if(el) {
    el.textContent = mins < 1 ? 'Agora mesmo' : 'Atualizado há ' + mins + ' min';
    _privilegiosUpdateTimer = setTimeout(_updatePrivilegiosLastUpdated, 60000);
  }
}

var _roleDescMap = {
  'global administrator': 'Acesso total a todos os recursos e configurações do Azure AD e serviços Microsoft 365',
  'exchange administrator': 'Gerencia caixas de correio, grupos de distribuição, conectores e políticas do Exchange Online',
  'sharepoint administrator': 'Gerencia sites do SharePoint Online, OneDrive for Business e configurações de armazenamento',
  'security administrator': 'Gerencia políticas de segurança, alertas e configurações de proteção contra ameaças',
  'user administrator': 'Cria e gerencia usuários, grupos e licenças; redefine senhas de não-administradores',
  'privileged role administrator': 'Gerencia atribuições de funções no Azure AD e no Privileged Identity Management',
  'compliance administrator': 'Gerencia configurações de conformidade, retenção de dados e relatórios regulatórios',
  'billing administrator': 'Gerencia assinaturas, compras e informações de cobrança do Microsoft 365',
  'conditional access administrator': 'Cria e gerencia políticas de acesso condicional do Azure AD',
  'teams administrator': 'Gerencia o Microsoft Teams, incluindo reuniões, canais e configurações de chamadas',
  'intune administrator': 'Gerencia o Microsoft Intune para controle de dispositivos e aplicativos móveis',
  'reports reader': 'Leitura de relatórios de uso e atividades do Microsoft 365',
  'security reader': 'Leitura de relatórios e informações de segurança do Azure AD',
  'guest inviter': 'Pode convidar usuários externos (convidados) para o Azure AD',
  'password administrator': 'Redefine senhas para usuários não-administradores e outros administradores de senha',
  'groups administrator': 'Gerencia grupos, políticas de expiração e naming do Azure AD',
  'application administrator': 'Cria e gerencia aplicativos corporativos, registros de aplicativos e proxy de aplicativo',
  'cloud application administrator': 'Cria e gerencia aplicativos corporativos e registros de aplicativos, sem gerenciamento de proxy',
  'directory readers': 'Leitura de informações básicas do diretório',
  'helpdesk administrator': 'Redefine senhas e invalida tokens de atualização para usuários não-administradores',
  'license administrator': 'Atribui, remove e atualiza licenças de serviço para usuários e grupos',
  'message center reader': 'Lê mensagens e atualizações no Centro de Mensagens do Microsoft 365',
  'authentication administrator': 'Gerencia métodos de autenticação e redefine senhas para usuários não-administradores',
  'privileged authentication administrator': 'Redefine senhas e métodos de autenticação para qualquer usuário, incluindo administradores globais',
};

function _roleDescFallback(name) {
  return _roleDescMap[(name || '').toLowerCase()] || '';
}

var _criticalRoles = ['global administrator','exchange administrator','sharepoint administrator',
  'security administrator','user administrator','privileged role administrator',
  'compliance administrator','billing administrator'];

function renderPrivilegiosView(){
  var kpiEl = document.getElementById('privUserKpis');
  var tblEl = document.getElementById('privUserTable');
  var rolesTbl = document.getElementById('privRolesTable');
  if(!kpiEl || !tblEl) return;

  if(_privilegiosData){
    _renderPrivContent(kpiEl, tblEl, rolesTbl, _privilegiosData);
    return;
  }

  kpiEl.innerHTML = ReportTable.kpiCards([{label:'Total Admins', value:'...'},{label:'Global Admins', value:'...'},{label:'Roles Ativas', value:'...'},{label:'Multi-Role', value:'...'}]);
  tblEl.innerHTML = loadingHTML('Carregando usuários privilegiados...');

  fetchWithTimeout('/api/reports/privileged-users').then(function(r){ return r.json(); }).then(function(res){
    if(res.error){
      tblEl.innerHTML = errorHTML('refreshPrivilegios', 'Verifique as permissões da aplicação no Azure AD e tente novamente.');
      return;
    }
    _privilegiosData = res.data || {};
    _renderPrivContent(kpiEl, tblEl, rolesTbl, _privilegiosData);
  }).catch(function(){
    tblEl.innerHTML = errorHTML('refreshPrivilegios');
  });
}

function _renderPrivContent(kpiEl, tblEl, rolesTbl, data){
  var roles = data.roles || [];
  var userMap = {};

  roles.forEach(function(role){
    (role.members || []).forEach(function(m){
      var key = m.id || m.email;
      if(!userMap[key]) userMap[key] = {id: m.id, displayName: m.displayName, email: m.email, roles: []};
      userMap[key].roles.push(role.displayName);
    });
  });

  var users = Object.values(userMap);
  var globalAdmins = users.filter(function(u){ return u.roles.some(function(r){ return r.toLowerCase() === 'global administrator'; }); });
  var multiRole = users.filter(function(u){ return u.roles.length > 1; });

  kpiEl.innerHTML = ReportTable.kpiCards([
    {label:'Total Admins', value: users.length},
    {label:'Global Admins', value: globalAdmins.length},
    {label:'Funções Ativas', value: roles.length},
    {label:'Multi-Função', value: multiRole.length}
  ]);

  var userCols = [
    {label:'Usuário', key:'displayName', render: function(r){
      return '<div class="person-cell"><div class="avatar">'+ini(r.displayName||'?')+'</div><div><div class="person-name">'+esc(r.displayName||'—')+'</div><div class="person-email">'+esc(r.email||'')+'</div></div></div>';
    }, sortValue: function(r){ return (r.displayName||'').toLowerCase(); }},
    {label:'Funções', key:'roles', render: function(r){
      return r.roles.map(function(role){
        var isCritical = _criticalRoles.indexOf(role.toLowerCase()) >= 0;
        var isGlobal = role.toLowerCase() === 'global administrator';
        var cls = isGlobal ? 'background:rgba(184,92,74,.15);color:var(--red);border:1px solid rgba(184,92,74,.3)' : isCritical ? 'background:rgba(184,144,58,.12);color:var(--yellow);border:1px solid rgba(184,144,58,.25)' : '';
        return '<span class="dept-tag" style="margin:2px;'+cls+'">'+esc(role)+'</span>';
      }).join(' ');
    }, sortable: false},
    {label:'Qtd Funções', key:'roleCount', value: function(r){ return r.roles.length; }, render: function(r){
      var cnt = r.roles.length;
      var style = cnt > 2 ? 'color:var(--red);font-weight:700' : 'font-weight:700';
      return '<span style="'+style+'">'+cnt+'</span>';
    }, sortValue: function(r){ return r.roles.length; }}
  ];

  ReportTable.build('privUserTable', userCols, users, {
    perPage: 20, exportName: 'usuarios-privilegiados',
    emptyMessage: 'Nenhum usuário privilegiado encontrado.',
    onRowClick: function(r){ openDetailByEmail(r.email); }
  });

  if(rolesTbl){
    var roleCols = [
      {label:'Função', key:'displayName', render: function(r){
        var isCritical = _criticalRoles.indexOf(r.displayName.toLowerCase()) >= 0;
        var style = isCritical ? 'font-weight:700;color:var(--red)' : 'font-weight:700';
        return '<span style="'+style+'">'+esc(r.displayName)+'</span>';
      }, sortValue: function(r){ return r.displayName.toLowerCase(); }},
      {label:'Descrição da Função', key:'description', render: function(r){
        var desc = r.description || _roleDescFallback(r.displayName);
        return '<span style="font-size:12px;color:var(--muted);max-width:400px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(desc||'')+'">'+esc(desc||'—')+'</span>';
      }},
      {label:'Membros', key:'memberCount', render: function(r){
        return '<span class="cost-val">'+(r.members||[]).length+'</span>';
      }, sortValue: function(r){ return (r.members||[]).length; }},
      {label:'', key:'_detail', render: function(r){
        return (r.members||[]).map(function(m){
          return '<span class="dept-tag" style="margin:2px">'+esc(m.displayName||m.email||'—')+'</span>';
        }).join(' ');
      }, sortable: false}
    ];

    ReportTable.build('privRolesTable', roleCols, roles, {
      perPage: 50, exportName: 'roles-administrativas',
      emptyMessage: 'Nenhuma role encontrada.'
    });
  }
}
