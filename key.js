// ═══════════════════════════════════════════════════════════════
// key.js — Sistema de Autenticação — Manutenção LAMIC
// ═══════════════════════════════════════════════════════════════

const AUTH_KEY = 'auth-key-v1';

let authState = {
  users:  [],
  groups: [],
  cargos: [],
  allowRegistration: true
};

let currentSession = null;
/*
  Session: { userId, username, nomeCompleto, cargo, cpf,
             grupoId, isAdmin, setores[], loginAt }

  User:    { id, nomeCompleto, cpf, cargo, username, passwordHash,
             setores[], grupoId, isAdmin, ativo, createdAt }

  Group:   { id, nome, isDefault, permissoes: {
               ativos:      { criar, editar, excluir, editarSetor, editarCategoria },
               rotinas:     { criar, editar, excluir, editarTipo },
               tarefas:     { criar, editar, excluir, publicar },
               atividades:  { editar, excluir },
               ot:          { criarOT, editarOT, excluirOT, alterarStatus,
                              realizarPublicacoes, editarPublicacoes, excluirPublicacoes },
               config:      { visualizarConfig, backup,
                              gerenciarUsuarios, gerenciarGrupos }
             }}
*/

// ── HASH (obfuscação simples para localStorage) ──────────────
function _hashPwd(pwd) {
  let h = 5381;
  const s = pwd + 'lamic-key-2024';
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + '-' +
    btoa(unescape(encodeURIComponent(pwd))).slice(-8);
}

function _verifyPwd(plain, stored) {
  return _hashPwd(plain) === stored;
}

// ── PERSISTÊNCIA ─────────────────────────────────────────────
function _saveAuth() {
  localStorage.setItem(AUTH_KEY, JSON.stringify(authState));
}

function _loadAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d && typeof d === 'object') {
      authState.users  = Array.isArray(d.users)  ? d.users  : [];
      authState.groups = Array.isArray(d.groups) ? d.groups : [];
      authState.allowRegistration = d.allowRegistration !== false;
      // Migração: unifica criarUsuarios/editarUsuarios/deletarUsuarios → gerenciarUsuarios
      authState.groups.forEach(g => {
        if (!g.permissoes?.config) return;
        const c = g.permissoes.config;
        if ('criarUsuarios' in c || 'editarUsuarios' in c || 'deletarUsuarios' in c) {
          c.gerenciarUsuarios = !!(c.criarUsuarios || c.editarUsuarios || c.deletarUsuarios);
          delete c.criarUsuarios; delete c.editarUsuarios; delete c.deletarUsuarios;
        }
        // Migração: renomeia os → ot
        if (g.permissoes.os) { g.permissoes.ot = g.permissoes.os; delete g.permissoes.os; }
      });
      // Migração: reconstrói lista de cargos a partir dos usuários se não existir
      if (Array.isArray(d.cargos) && d.cargos.length > 0) {
        authState.cargos = d.cargos;
      } else {
        authState.cargos = [...new Set(authState.users.map(u => u.cargo).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, 'pt-BR'));
      }
    }
  } catch {}
}

// ── UTILITÁRIOS ──────────────────────────────────────────────
function _authUid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function formatCPF(v) {
  return v.replace(/\D/g, '')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
    .slice(0, 14);
}

function _getInitials(name) {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ── API PÚBLICA ───────────────────────────────────────────────
function authHasAdmin() {
  return authState.users.some(u => u.isAdmin);
}

function authGetDefaultGroup() {
  return authState.groups.find(g => g.isDefault) || null;
}

function authIsRegistrationAllowed() {
  return authState.allowRegistration !== false;
}

function authGetCurrentUser() {
  return currentSession;
}

function authHasPermission(key) {
  if (!currentSession) return false;
  if (currentSession.isAdmin) return true;
  if (!currentSession.grupoId) return false;
  const group = authState.groups.find(g => g.id === currentSession.grupoId);
  if (!group?.permissoes) return false;
  let perm = group.permissoes;
  for (const p of key.split('.')) {
    perm = perm?.[p];
    if (perm === undefined || perm === null) return false;
  }
  return !!perm;
}

function authGetVisibleSetores() {
  if (!currentSession) return null;
  if (currentSession.isAdmin) return null;
  const g = authState.groups.find(g => g.id === currentSession.grupoId);
  if (g && Array.isArray(g.setoresPermitidos) && g.setoresPermitidos.length > 0) {
    return g.setoresPermitidos;
  }
  return null;
}

// ── OPERAÇÕES ────────────────────────────────────────────────
function authLogin(username, password) {
  const user = authState.users.find(u =>
    u.username.toLowerCase() === (username || '').toLowerCase().trim() &&
    u.ativo !== false
  );
  if (!user) return { ok: false, error: 'Usuário não encontrado ou inativo.' };
  if (!_verifyPwd(password, user.passwordHash))
    return { ok: false, error: 'Senha incorreta.' };

  currentSession = {
    userId:       user.id,
    username:     user.username,
    nomeCompleto: user.nomeCompleto,
    cargo:        user.cargo  || '',
    cpf:          user.cpf    || '',
    grupoId:      user.grupoId || null,
    isAdmin:      !!user.isAdmin,
    setores:      user.setores || [],
    loginAt:      new Date().toISOString()
  };
  localStorage.setItem('auth-session', JSON.stringify(currentSession));
  return { ok: true, user: currentSession };
}

function authLogout() {
  currentSession = null;
  localStorage.removeItem('auth-session');
  location.reload();
}

function authCreateAdmin(data) {
  if (authHasAdmin()) return { ok: false, error: 'Já existe um administrador.' };
  const { nomeCompleto, cpf, cargo, username, password, confirmPassword } = data;
  if (!nomeCompleto?.trim()) return { ok: false, error: 'Informe o nome completo.' };
  if (!username?.trim())    return { ok: false, error: 'Informe o nome de usuário.' };
  if (!password)             return { ok: false, error: 'Informe a senha.' };
  if (password !== confirmPassword)
    return { ok: false, error: 'As senhas não conferem.' };
  if (password.length < 4)
    return { ok: false, error: 'A senha deve ter ao menos 4 caracteres.' };
  if (authState.users.some(u =>
    u.username.toLowerCase() === username.toLowerCase().trim()))
    return { ok: false, error: 'Nome de usuário já em uso.' };

  const cargoTrimmed = (cargo || '').trim();
  authState.users.push({
    id:           _authUid(),
    nomeCompleto: nomeCompleto.trim(),
    cpf:          (cpf    || '').trim(),
    cargo:        cargoTrimmed,
    username:     username.trim(),
    passwordHash: _hashPwd(password),
    setores:      [],
    grupoId:      null,
    isAdmin:      true,
    ativo:        true,
    createdAt:    new Date().toISOString()
  });
  // Adiciona o cargo à lista se ainda não existir
  if (cargoTrimmed && !authState.cargos.includes(cargoTrimmed)) {
    authState.cargos.push(cargoTrimmed);
    authState.cargos.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }
  _saveAuth();
  return { ok: true };
}

function authRegister(data) {
  const { nomeCompleto, cpf, cargo, username, password, confirmPassword, setores } = data;
  if (!nomeCompleto?.trim()) return { ok: false, error: 'Informe o nome completo.' };
  if (!username?.trim())    return { ok: false, error: 'Informe o nome de usuário.' };
  if (!password)             return { ok: false, error: 'Informe a senha.' };
  if (password !== confirmPassword)
    return { ok: false, error: 'As senhas não conferem.' };
  if (password.length < 4)
    return { ok: false, error: 'A senha deve ter ao menos 4 caracteres.' };
  if (authState.users.some(u =>
    u.username.toLowerCase() === username.toLowerCase().trim()))
    return { ok: false, error: 'Nome de usuário já em uso.' };

  const defaultGroup = authGetDefaultGroup();
  if (!defaultGroup)
    return { ok: false, error: 'Nenhum grupo padrão definido. Contate o administrador.' };

  authState.users.push({
    id:           _authUid(),
    nomeCompleto: nomeCompleto.trim(),
    cpf:          (cpf    || '').trim(),
    cargo:        (cargo  || '').trim(),
    username:     username.trim(),
    passwordHash: _hashPwd(password),
    setores:      setores || [],
    grupoId:      defaultGroup.id,
    isAdmin:      false,
    ativo:        true,
    createdAt:    new Date().toISOString()
  });
  _saveAuth();
  return { ok: true };
}

function authUpdateUserProfile(userId, updates) {
  const idx = authState.users.findIndex(u => u.id === userId);
  if (idx < 0) return { ok: false, error: 'Usuário não encontrado.' };

  if (updates.password) {
    if (updates.password !== updates.confirmPassword)
      return { ok: false, error: 'As senhas não conferem.' };
    if (updates.password.length < 4)
      return { ok: false, error: 'A senha deve ter ao menos 4 caracteres.' };
    authState.users[idx].passwordHash = _hashPwd(updates.password);
  }
  if (updates.setores !== undefined) {
    authState.users[idx].setores = updates.setores;
    if (currentSession?.userId === userId) {
      currentSession.setores = updates.setores;
      localStorage.setItem('auth-session', JSON.stringify(currentSession));
    }
  }
  _saveAuth();
  return { ok: true };
}

// ── RESTAURAR SESSÃO ─────────────────────────────────────────
function _restoreSession() {
  try {
    const s = JSON.parse(localStorage.getItem('auth-session'));
    if (!s?.userId) return false;
    const user = authState.users.find(u => u.id === s.userId && u.ativo !== false);
    if (!user) return false;
    currentSession = {
      userId:       user.id,
      username:     user.username,
      nomeCompleto: user.nomeCompleto,
      cargo:        user.cargo  || '',
      cpf:          user.cpf    || '',
      grupoId:      user.grupoId || null,
      isAdmin:      !!user.isAdmin,
      setores:      user.setores || [],
      loginAt:      s.loginAt || new Date().toISOString()
    };
    return true;
  } catch { return false; }
}

// ── ESTADO TEMPORÁRIO (seleção de setores) ───────────────────
let _sectorModalCallback = null;

// ── INICIALIZAÇÃO ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  _loadAuth();

  // Garantir logout automático ao atualizar a página.
  localStorage.removeItem('auth-session');

  if (_restoreSession()) {
    _unlockApp();
    return;
  }

  if (!authHasAdmin()) {
    showAuthScreen('first-admin');
  } else {
    showAuthScreen('login');
  }
});

function showAuthScreen(name) {
  document.querySelectorAll('.auth-screen').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('auth-screen-' + name);
  if (el) el.classList.add('active');
  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.style.display = 'flex';
  if (name === 'login')    _updateLoginButtons();
  if (name === 'register') _populateCargoSelect('reg-cargo', '');
}

// Paleta de cores para avatares
const _AVATAR_PALETTE = [
  '#2a9d8f','#00a8cc','#3f51b5','#9c27b0','#e91e63',
  '#ff9800','#4caf50','#795548','#607d8b','#e63946'
];

function _avatarColor(str) {
  if (!str) return 'var(--cyan)';
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
  return _AVATAR_PALETTE[Math.abs(h) % _AVATAR_PALETTE.length];
}

function _unlockApp() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.style.display = 'none';
  document.body.classList.remove('auth-locked');
  _updateSidebarUser();
  applyPermissions();
  // Dispara refresh com timeout para garantir que o DOMContentLoaded do script.js já rodou
  setTimeout(() => {
    if (typeof atualizarSelects    === 'function') atualizarSelects();
    if (typeof refreshTaskFlagsUI  === 'function') refreshTaskFlagsUI();
    _initTopbarSectorFilter();
  }, 60);
}

// Setores disponíveis para o usuário (considerando restrição de grupo)
function _getAvailableSetores() {
  const all = (typeof state !== 'undefined' && Array.isArray(state.setores)) ? state.setores : [];
  const groupAllowed = authGetVisibleSetores();
  return groupAllowed ? all.filter(s => groupAllowed.includes(s)) : all;
}

// Filtro de setores ativo na sessão (null = não inicializado; array = setores selecionados)
let _topbarSetorFilter = null;

// Inicializa o filtro da topbar considerando o override por usuário
function _initTopbarSectorFilter() {
  const available  = _getAvailableSetores(); // setores do grupo
  const userPref   = currentSession?.setores; // override individual configurado pelo admin
  if (Array.isArray(userPref) && userPref.length > 0) {
    // Interseção: só mostra setores que estão tanto no override quanto no grupo
    const intersection = available.filter(s => userPref.includes(s));
    _topbarSetorFilter = intersection.length > 0 ? intersection : [...available];
  } else {
    _topbarSetorFilter = [...available];
  }
  _updateTopbarSectorBtn();
}

// Atualiza o botão da topbar com o estado atual do filtro
function _updateTopbarSectorBtn() {
  const badge = document.getElementById('sector-filter-badge');
  const txt   = document.getElementById('sector-badge-text');
  if (!badge || !txt) return;
  badge.style.display = ''; // sempre visível após login
  const available = _getAvailableSetores();
  const selected  = Array.isArray(_topbarSetorFilter) ? _topbarSetorFilter : available;
  if (available.length === 0 || selected.length >= available.length) {
    txt.textContent = 'Todos os setores';
    badge.style.background = '';
    badge.style.borderColor = '';
  } else {
    txt.textContent = selected.length === 1 ? selected[0] : `${selected.length}/${available.length} setores`;
    badge.style.background = 'rgba(0,168,204,0.25)';
    badge.style.borderColor = 'var(--cyan)';
  }
}

// Abre o modal de seleção de setores para o filtro da topbar
function openTopbarSectorFilter() {
  const available = _getAvailableSetores();
  const current   = Array.isArray(_topbarSetorFilter) ? _topbarSetorFilter : available;
  _openSectorModal(current, function (sel) {
    _topbarSetorFilter = sel;
    _updateTopbarSectorBtn();
    if (typeof renderCards              === 'function') renderCards();
    if (typeof renderRotinasTable       === 'function') renderRotinasTable();
    if (typeof renderTarefasTable       === 'function') renderTarefasTable();
    if (typeof renderAtividadesTable    === 'function') renderAtividadesTable();
    if (typeof _otRenderKanban          === 'function') _otRenderKanban();
    if (typeof atualizarSelects         === 'function') atualizarSelects();
    if (typeof updateNotifBadge         === 'function') updateNotifBadge();
    if (typeof renderHome               === 'function') renderHome();
  }, available);
}

// Verifica se o usuário pode ver um ativo com base no filtro de setores ativo
function _userCanSeeAtivo(ativo) {
  if (!ativo) return false;
  const filter = Array.isArray(_topbarSetorFilter) ? _topbarSetorFilter : _getAvailableSetores();
  return filter.length === 0 || filter.includes(ativo.setor);
}

// Retorna os setores do state filtrados pelo filtro ativo da topbar
function _getFilteredSetores() {
  const all    = (typeof state !== 'undefined' && Array.isArray(state.setores)) ? state.setores : [];
  const filter = Array.isArray(_topbarSetorFilter) ? _topbarSetorFilter : _getAvailableSetores();
  return filter.length > 0 ? all.filter(s => filter.includes(s)) : all;
}

// Aplica visibilidade/estado de botões com base nas permissões do usuário logado
function applyPermissions() {
  if (!currentSession) return;

  function vis(id, show) {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
  }

  const can = key => currentSession.isAdmin || authHasPermission(key);

  // FAB criar
  vis('fab-new-ativo',   can('ativos.criar'));
  vis('fab-new-rotina',  can('rotinas.criar'));
  vis('fab-new-tarefa',  can('tarefas.criar'));

  // Botões de editar setor, categoria e tipo
  vis('btn-editar-setor-toolbar',  can('ativos.editarSetor'));
  vis('btn-editar-setor-form',     can('ativos.editarSetor'));
  vis('btn-editar-categoria-form',  can('ativos.editarCategoria'));
  vis('btn-nova-categoria-toolbar', can('ativos.editarCategoria'));
  vis('btn-editar-tipo-rotina',    can('rotinas.editarTipo'));

  // Botões de config
  vis('btn-novo-usuario',  can('config.gerenciarUsuarios'));
  vis('btn-novo-grupo',    can('config.gerenciarGrupos'));
  vis('btn-nova-empresa',  can('config.gerenciarEmpresas'));

  // Config sub-nav
  const canUsers  = can('config.gerenciarUsuarios');
  const canGroups = can('config.gerenciarGrupos');
  const canBackup = can('config.backup');
  vis('cnav-usuario', canUsers);
  vis('cnav-grupos',  canGroups);
  vis('cnav-backup',  canBackup);

  // Config nav principal — controlado por 'visualizarConfig'
  const canConfig = can('config.visualizarConfig');
  vis('nav-config', canConfig);
  vis('nav-section-sistema', canConfig);

  // Toggle de cadastro (apenas admin vê)
  vis('cfg-allow-registration-row', currentSession.isAdmin);

  // Se a aba config estiver ativa, navegar para o primeiro painel visível
  if (document.getElementById('tab-config')?.classList.contains('active')) {
    if (typeof _switchConfigTabFirst === 'function') _switchConfigTabFirst();
  }
}

function _updateLoginButtons() {
  const btnReg = document.getElementById('btn-login-register');
  if (btnReg) btnReg.style.display = authIsRegistrationAllowed() ? '' : 'none';
}

function _updateSidebarUser() {
  if (!currentSession) return;
  const pill = document.getElementById('sidebar-user-pill');
  if (!pill) return;
  const initials = _getInitials(currentSession.nomeCompleto);
  const color    = _avatarColor(currentSession.username || currentSession.nomeCompleto);
  const role     = currentSession.isAdmin
    ? 'Administrador'
    : (currentSession.cargo || 'Usuário');
  pill.innerHTML = `
    <div class="user-avatar" style="background:${color};">${initials}</div>
    <div style="flex:1;min-width:0;overflow:hidden;">
      <div class="user-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${currentSession.nomeCompleto}</div>
      <div class="user-role">${role}</div>
    </div>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      style="width:14px;height:14px;flex-shrink:0;opacity:.35;color:rgba(255,255,255,.6);">
      <circle cx="12" cy="8" r="4"/>
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
    </svg>`;
}

// ── FORMULÁRIO: LOGIN ─────────────────────────────────────────
function authDoLogin() {
  const username = (document.getElementById('login-username')?.value || '').trim();
  const password =  document.getElementById('login-password')?.value || '';
  if (!username || !password) {
    _showAuthError('login-error', 'Preencha todos os campos.');
    return;
  }
  const result = authLogin(username, password);
  if (result.ok) {
    document.getElementById('login-error').style.display = 'none';
    _unlockApp();
  } else {
    _showAuthError('login-error', result.error);
    const pwd = document.getElementById('login-password');
    if (pwd) { pwd.value = ''; pwd.focus(); }
  }
}

// ── FORMULÁRIO: CRIAR PRIMEIRO ADMIN ─────────────────────────
function authDoCreateAdmin() {
  const data = {
    nomeCompleto:    document.getElementById('admin-nome')?.value     || '',
    cpf:             document.getElementById('admin-cpf')?.value      || '',
    cargo:           document.getElementById('admin-cargo')?.value    || '',
    username:        document.getElementById('admin-username')?.value || '',
    password:        document.getElementById('admin-password')?.value || '',
    confirmPassword: document.getElementById('admin-confirm')?.value  || ''
  };
  const result = authCreateAdmin(data);
  if (result.ok) {
    document.getElementById('admin-error').style.display = 'none';
    const r = authLogin(data.username, data.password);
    if (r.ok) _unlockApp();
  } else {
    _showAuthError('admin-error', result.error);
  }
}

// ── FORMULÁRIO: CADASTRO ──────────────────────────────────────
function authDoRegister() {
  const data = {
    nomeCompleto:    document.getElementById('reg-nome')?.value     || '',
    cpf:             document.getElementById('reg-cpf')?.value      || '',
    cargo:           document.getElementById('reg-cargo')?.value    || '',
    username:        document.getElementById('reg-username')?.value || '',
    password:        document.getElementById('reg-password')?.value || '',
    confirmPassword: document.getElementById('reg-confirm')?.value  || ''
  };
  const result = authRegister(data);
  if (result.ok) {
    document.getElementById('reg-error').style.display = 'none';
    ['reg-nome','reg-cpf','reg-cargo','reg-username','reg-password','reg-confirm']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    showAuthScreen('login');
    setTimeout(() => {
      if (typeof showToast === 'function')
        showToast('Conta criada! Faça login para continuar.', 'success');
    }, 80);
  } else {
    _showAuthError('reg-error', result.error);
  }
}

// ── MODAL GENÉRICO DE SETORES ─────────────────────────────────
function _openSectorModal(currentSelected, callback, availableSetores) {
  _sectorModalCallback = callback;
  const setores = availableSetores ||
    ((typeof state !== 'undefined' && Array.isArray(state.setores)) ? state.setores : []);
  const list = document.getElementById('sector-modal-list');
  if (!list) return;

  if (setores.length === 0) {
    list.innerHTML = `<div class="sector-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
      </svg>
      Nenhum setor cadastrado.<br>Cadastre setores no módulo Ativos primeiro.
    </div>`;
  } else {
    list.innerHTML = setores.map(s => {
      const val = s.replace(/"/g, '&quot;');
      const checked = currentSelected.includes(s);
      return `<label class="sector-check-card${checked ? ' checked' : ''}">
        <input type="checkbox" value="${val}" ${checked ? 'checked' : ''}
          onchange="_onSectorCheckChange(this)">
        <span class="sector-check-card-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px;">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </span>
        <span class="sector-check-card-label">${s}</span>
      </label>`;
    }).join('');
  }
  _updateSectorModalState();
  document.getElementById('modal-sector-select')?.classList.add('open');
}

function _onSectorCheckChange(cb) {
  const card = cb.closest('.sector-check-card');
  if (card) card.classList.toggle('checked', cb.checked);
  _updateSectorModalState();
}

function _updateSectorModalState() {
  const all     = document.querySelectorAll('#sector-modal-list input[type=checkbox]');
  const checked = document.querySelectorAll('#sector-modal-list input[type=checkbox]:checked');
  const n       = checked.length;
  const total   = all.length;

  const countEl = document.getElementById('sector-modal-count');
  if (countEl) countEl.textContent = n === 0 ? 'Nenhum selecionado' : `${n} de ${total} selecionado${n !== 1 ? 's' : ''}`;

  const allBtn = document.getElementById('btn-sector-select-all');
  if (allBtn) {
    const isAll = total > 0 && n === total;
    allBtn.innerHTML = isAll
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Desmarcar todos`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px;"><polyline points="20 6 9 17 4 12"/></svg> Selecionar todos`;
  }

  const confirmBtn = document.getElementById('btn-confirm-sectors');
  if (confirmBtn) {
    confirmBtn.disabled = n === 0;
    confirmBtn.style.opacity = n === 0 ? '.45' : '';
    confirmBtn.style.cursor  = n === 0 ? 'not-allowed' : '';
  }
}

function toggleSelectAllSectors() {
  const checkboxes = document.querySelectorAll('#sector-modal-list input[type=checkbox]');
  const allChecked = Array.from(checkboxes).every(c => c.checked);
  checkboxes.forEach(c => {
    c.checked = !allChecked;
    const card = c.closest('.sector-check-card');
    if (card) card.classList.toggle('checked', !allChecked);
  });
  _updateSectorModalState();
}

function closeSectorModal() {
  document.getElementById('modal-sector-select')?.classList.remove('open');
  _sectorModalCallback = null;
}

function confirmSectorModal() {
  const checked = document.querySelectorAll('#sector-modal-list input[type=checkbox]:checked');
  const selected = Array.from(checked).map(c => c.value);
  if (selected.length === 0) {
    if (typeof showToast === 'function') showToast('Selecione ao menos 1 setor.', 'error');
    return;
  }
  if (_sectorModalCallback) _sectorModalCallback(selected);
  closeSectorModal();
}

// ── PERFIL DO USUÁRIO ─────────────────────────────────────────
function openUserProfileModal() {
  if (!currentSession) return;
  const user = authState.users.find(u => u.id === currentSession.userId);
  if (!user) return;

  _setTextEl('profile-nome',     user.nomeCompleto || '—');
  _setTextEl('profile-cpf',      user.cpf          || '—');
  _setTextEl('profile-cargo',    user.cargo        || '—');
  _setTextEl('profile-username', user.username     || '—');
  const grpName = user.isAdmin
    ? 'Administrador'
    : (authState.groups.find(g => g.id === user.grupoId)?.nome || '—');
  _setTextEl('profile-grupo', grpName);

  const np = document.getElementById('profile-new-password');
  const cp = document.getElementById('profile-confirm-password');
  if (np) np.value = '';
  if (cp) cp.value = '';

  const errEl = document.getElementById('profile-error');
  if (errEl) errEl.style.display = 'none';

  document.getElementById('modal-user-profile')?.classList.add('open');
  if (typeof closeSidebar === 'function') closeSidebar();
}

function closeUserProfileModal() {
  document.getElementById('modal-user-profile')?.classList.remove('open');
}

function saveUserProfile() {
  const newPwd  = document.getElementById('profile-new-password')?.value  || '';
  const confPwd = document.getElementById('profile-confirm-password')?.value || '';
  const updates = {};
  if (newPwd) { updates.password = newPwd; updates.confirmPassword = confPwd; }

  const result = authUpdateUserProfile(currentSession.userId, updates);
  if (result.ok) {
    document.getElementById('profile-error').style.display = 'none';
    closeUserProfileModal();
    _updateSidebarUser();
    _updateTopbarSectorBtn();
    if (typeof showToast === 'function')
      showToast('Perfil atualizado com sucesso!', 'success');
    if (typeof atualizarSelects   === 'function') atualizarSelects();
    if (typeof refreshTaskFlagsUI === 'function') refreshTaskFlagsUI();
  } else {
    _showAuthError('profile-error', result.error);
  }
}

// ── LOGOUT ────────────────────────────────────────────────────
function authDoLogout() {
  if (typeof openModal === 'function') {
    openModal('modal-confirmar-logout');
  } else {
    if (!confirm('Deseja sair do sistema?')) return;
    authLogout();
  }
}

function _confirmarLogout() {
  if (typeof closeModal === 'function') closeModal('modal-confirmar-logout');
  authLogout();
}

// ── HELPERS DE UI ─────────────────────────────────────────────
function _showAuthError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

function _setTextEl(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ═══════════════════════════════════════════════════════════════
// GERENCIAMENTO DE CARGOS
// ═══════════════════════════════════════════════════════════════

function _ensureCargos() {
  if (!Array.isArray(authState.cargos)) authState.cargos = [];
}

function authGetCargos() {
  _ensureCargos();
  return [...authState.cargos].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function authAddCargo(nome) {
  _ensureCargos();
  const n = (nome || '').trim();
  if (!n) return { ok: false, error: 'Informe o nome do cargo.' };
  if (authState.cargos.includes(n)) return { ok: false, error: 'Cargo já cadastrado.' };
  authState.cargos.push(n);
  authState.cargos.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  _saveAuth();
  return { ok: true };
}

function authEditCargo(oldName, newName) {
  _ensureCargos();
  const n = (newName || '').trim();
  if (!n) return { ok: false, error: 'Informe o nome do cargo.' };
  if (n === oldName) return { ok: true };
  if (authState.cargos.includes(n)) return { ok: false, error: 'Cargo já cadastrado.' };
  const idx = authState.cargos.indexOf(oldName);
  if (idx < 0) return { ok: false, error: 'Cargo não encontrado.' };
  authState.cargos[idx] = n;
  // Atualiza todos os usuários com esse cargo
  authState.users.forEach(u => { if (u.cargo === oldName) u.cargo = n; });
  // Atualiza sessão atual se necessário
  if (currentSession?.cargo === oldName) {
    currentSession.cargo = n;
    localStorage.setItem('auth-session', JSON.stringify(currentSession));
    _updateSidebarUser();
  }
  authState.cargos.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  _saveAuth();
  return { ok: true };
}

function authDeleteCargo(nome) {
  _ensureCargos();
  const count = authState.users.filter(u => u.cargo === nome).length;
  if (count > 0)
    return { ok: false, error: `${count} usuário(s) usa(m) este cargo. Altere-os antes de excluir.` };
  authState.cargos = authState.cargos.filter(c => c !== nome);
  _saveAuth();
  return { ok: true };
}

// Popula um <select> com os cargos cadastrados
function _populateCargoSelect(selectId, currentValue) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const cargos = authGetCargos();
  sel.innerHTML = '<option value="">— Sem cargo —</option>' +
    cargos.map(c =>
      `<option value="${c}"${c === currentValue ? ' selected' : ''}>${c}</option>`
    ).join('');
}

// ── Modal de gerenciamento de cargos ────────────────────────
let _cargoEditingOldName = null;
let _cargoOpenedFrom     = null; // 'user-edit' | 'register'

function openCargosModal(from) {
  _cargoEditingOldName = null;
  _cargoOpenedFrom     = from || 'user-edit';
  document.getElementById('cargos-error').style.display = 'none';
  document.getElementById('cargo-input').value = '';
  const lbl = document.getElementById('cargo-save-label');
  if (lbl) lbl.textContent = 'Adicionar';
  _renderCargosModal();
  document.getElementById('modal-cargos-manage')?.classList.add('open');
}

function closeCargosModal() {
  document.getElementById('modal-cargos-manage')?.classList.remove('open');
  // Recarrega o select de origem
  if (_cargoOpenedFrom === 'register') {
    _populateCargoSelect('reg-cargo', document.getElementById('reg-cargo')?.value || '');
  } else {
    _populateCargoSelect('user-edit-cargo', document.getElementById('user-edit-cargo')?.value || '');
  }
  _cargoOpenedFrom = null;
}

function _renderCargosModal() {
  const list  = document.getElementById('cargos-list');
  const errEl = document.getElementById('cargos-error');
  if (errEl) errEl.style.display = 'none';
  if (!list) return;
  const cargos = authGetCargos();
  if (cargos.length === 0) {
    list.innerHTML = `<div style="padding:18px;text-align:center;color:var(--text-muted);font-size:13px;">
      Nenhum cargo cadastrado ainda.
    </div>`;
    return;
  }
  list.innerHTML = cargos.map(c => `
    <div class="cargo-row">
      <span class="cargo-name">${c}</span>
      <div style="display:flex;gap:4px;">
        <button class="btn btn-outline btn-icon" onclick='startEditCargo(${JSON.stringify(c)})' title="Editar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>
          </svg>
        </button>
        <button class="btn btn-outline btn-icon" onclick='doDeleteCargo(${JSON.stringify(c)})' title="Excluir"
          style="color:var(--red);border-color:rgba(230,57,70,.3);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
          </svg>
        </button>
      </div>
    </div>`).join('');
}

function startEditCargo(nome) {
  _cargoEditingOldName = nome;
  const input = document.getElementById('cargo-input');
  if (input) { input.value = nome; input.focus(); input.select(); }
  _setTextEl('cargo-save-label', 'Atualizar');
  _setTextEl('cargo-form-label', 'Editar cargo');
  const cancelBtn = document.getElementById('btn-cancel-cargo-edit');
  if (cancelBtn) cancelBtn.style.display = '';
  document.getElementById('cargos-error').style.display = 'none';
}

function cancelEditCargo() {
  _cargoEditingOldName = null;
  const input = document.getElementById('cargo-input');
  if (input) input.value = '';
  _setTextEl('cargo-save-label', 'Adicionar');
  _setTextEl('cargo-form-label', 'Novo cargo');
  const cancelBtn = document.getElementById('btn-cancel-cargo-edit');
  if (cancelBtn) cancelBtn.style.display = 'none';
  document.getElementById('cargos-error').style.display = 'none';
}

function doSaveCargo() {
  const nome = (document.getElementById('cargo-input')?.value || '').trim();
  const wasEditing = !!_cargoEditingOldName;
  const result = wasEditing
    ? authEditCargo(_cargoEditingOldName, nome)
    : authAddCargo(nome);

  if (result.ok) {
    _cargoEditingOldName = null;
    document.getElementById('cargo-input').value = '';
    const lbl = document.getElementById('cargo-save-label');
    if (lbl) lbl.textContent = 'Adicionar';
    document.getElementById('cargos-error').style.display = 'none';
    _renderCargosModal();
    if (typeof showToast === 'function')
      showToast(wasEditing ? 'Cargo atualizado em todos os usuários!' : 'Cargo adicionado!', 'success');
  } else {
    _showAuthError('cargos-error', result.error);
  }
}

function doDeleteCargo(nome) {
  const result = authDeleteCargo(nome);
  if (result.ok) {
    _renderCargosModal();
    if (typeof showToast === 'function') showToast('Cargo excluído.', 'success');
  } else {
    _showAuthError('cargos-error', result.error);
  }
}

// ═══════════════════════════════════════════════════════════════
// GERENCIAMENTO DE USUÁRIOS (admin)
// ═══════════════════════════════════════════════════════════════

let _userEditId          = null;
let _userEditIsAdmin     = false;
let _userEditSetoresTemp = []; // [] = sem override (usa todos do grupo)
let _usersFilter         = 'ativo';

function toggleUserEditAdmin() {
  if (!currentSession?.isAdmin) return;
  _userEditIsAdmin = !_userEditIsAdmin;
  updateUserEditAdminButton();
}

function updateUserEditAdminButton() {
  const btn      = document.getElementById('btn-user-edit-admin');
  const grupoSel = document.getElementById('user-edit-grupo');
  const grupoReq = document.getElementById('user-edit-grupo-req');
  if (!btn) return;

  // Só exibe o botão se o admin logado estiver editando outro usuário
  const isEditingSelf = _userEditId === currentSession?.userId;
  if (!currentSession?.isAdmin || isEditingSelf) {
    btn.style.display = 'none';
    return;
  }
  btn.style.display = '';

  if (_userEditIsAdmin) {
    btn.title     = 'Remover administrador';
    btn.className = 'btn btn-primary btn-icon user-admin-toggle-btn';
    btn.style.cssText = 'flex-shrink:0;padding:0 10px;min-width:36px;background:var(--cyan);border-color:var(--cyan);';
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>`;
    // Admin não precisa de grupo
    if (grupoSel) { grupoSel.disabled = true; grupoSel.value = ''; }
    if (grupoReq) grupoReq.style.display = 'none';
  } else {
    btn.title     = 'Promover a administrador';
    btn.className = 'btn btn-outline btn-icon user-admin-toggle-btn';
    btn.style.cssText = 'flex-shrink:0;padding:0 10px;min-width:36px;';
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>`;
    if (grupoSel) grupoSel.disabled = false;
    if (grupoReq) grupoReq.style.display = '';
  }
}

function promoteAdmin(id) {
  const u = authState.users.find(u => u.id === id);
  if (!u || !currentSession?.isAdmin || u.id === currentSession.userId) return;
  if (!confirm(`Promover "${u.nomeCompleto}" a administrador?`)) return;
  u.isAdmin = true;
  _saveAuth();
  renderUsersTable();
  if (typeof showToast === 'function') showToast(`${u.nomeCompleto} agora é administrador.`, 'success');
}

function demoteAdmin(id) {
  const u = authState.users.find(u => u.id === id);
  if (!u || !currentSession?.isAdmin || u.id === currentSession.userId) return;
  if (!confirm(`Remover permissão de administrador de "${u.nomeCompleto}"?`)) return;
  u.isAdmin = false;
  _saveAuth();
  renderUsersTable();
  if (typeof showToast === 'function') showToast(`Permissão de administrador removida de ${u.nomeCompleto}.`, 'info');
}

function renderUsersTable() {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;

  renderRegistrationToggle();

  const meId = currentSession?.userId;

  const sorted = [...authState.users]
    .filter(u => {
      if (_usersFilter === 'ativo')   return u.ativo !== false;
      if (_usersFilter === 'inativo') return u.ativo === false;
      return true;
    })
    .sort((a, b) => {
      if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
      return a.nomeCompleto.localeCompare(b.nomeCompleto, 'pt-BR');
    });

  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="data-table-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
      </svg>
      <strong>Nenhum usuário ${_usersFilter === 'ativo' ? 'ativo' : _usersFilter === 'inativo' ? 'inativo' : 'cadastrado'}</strong>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = sorted.map(u => {
    const isMe      = u.id === meId;
    const initials  = _getInitials(u.nomeCompleto);
    const avatarClr = _avatarColor(u.username || u.nomeCompleto);
    const grpName   = u.isAdmin
      ? '<span class="chip chip-cyan" style="font-size:10px;">Admin</span>'
      : `<span class="chip chip-gray" style="font-size:10.5px;">${authState.groups.find(g => g.id === u.grupoId)?.nome || '—'}</span>`;
    const statusChip = u.ativo !== false
      ? '<span class="chip chip-green">Ativo</span>'
      : '<span class="chip chip-gray">Inativo</span>';
    const canManageUsers = currentSession?.isAdmin || authHasPermission('config.gerenciarUsuarios');
    const canDelete   = canManageUsers && !isMe && !u.isAdmin;
    const canDemote   = u.isAdmin && !isMe && currentSession?.isAdmin;

    const adminBtn = canDemote
      ? `<button class="btn btn-outline btn-icon" onclick="demoteAdmin('${u.id}')" title="Remover administrador"
          style="color:var(--amber);border-color:rgba(255,183,3,.3);margin-left:4px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <line x1="4" y1="4" x2="20" y2="20" stroke-width="2.5"/>
          </svg>
        </button>`
      : '';

    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="cfg-user-avatar" style="background:${avatarClr};">${initials}</div>
          <div>
            <div style="font-weight:600;font-size:13px;">${u.nomeCompleto}${isMe ? '<span style="font-size:10px;color:var(--cyan);font-weight:700;margin-left:6px;">Você</span>' : ''}</div>
            <div style="font-size:11px;color:var(--text-muted);font-family:\'DM Mono\',monospace;">${u.username}</div>
          </div>
        </div>
      </td>
      <td style="font-size:12px;color:var(--text-secondary);">${u.cpf || '—'}</td>
      <td style="font-size:12.5px;color:var(--text-secondary);">${u.cargo || '—'}</td>
      <td>${grpName}</td>
      <td>${statusChip}</td>
      <td style="text-align:right;white-space:nowrap;">
        ${canManageUsers ? `<button class="btn btn-outline btn-icon" onclick="openUserEditModal('${u.id}')" title="Editar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>
          </svg>
        </button>` : ''}
        ${adminBtn}
        <button class="btn btn-outline btn-icon" onclick="deleteUser('${u.id}')" title="Excluir"
          style="color:var(--red);border-color:rgba(230,57,70,.3);margin-left:4px;"
          ${!canDelete ? 'disabled style="opacity:.25;cursor:not-allowed;color:var(--red);border-color:rgba(230,57,70,.3);margin-left:4px;"' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
          </svg>
        </button>
      </td>
    </tr>`;
  }).join('');
}

function renderRegistrationToggle() {
  const btn = document.getElementById('btn-toggle-registration');
  if (!btn) return;
  btn.classList.toggle('cfg-toggle-on', authIsRegistrationAllowed());
}

function setUsersFilter(filter) {
  _usersFilter = filter;
  ['ativo','inativo','ambos'].forEach(f => {
    const btn = document.getElementById('sfbtn-user-' + f);
    if (!btn) return;
    btn.classList.toggle('active',       f === filter);
    btn.classList.toggle('active-green', f === filter);
  });
  renderUsersTable();
}

function toggleAllowRegistration() {
  authState.allowRegistration = !authState.allowRegistration;
  _saveAuth();
  renderRegistrationToggle();
  _updateLoginButtons();
  if (typeof showToast === 'function')
    showToast(authState.allowRegistration
      ? 'Criação de contas habilitada.' : 'Criação de contas desabilitada.', 'info');
}

// ── Modal criar/editar usuário ───────────────────────────────
function openUserEditModal(id) {
  if (currentSession && !currentSession.isAdmin && !authHasPermission('config.gerenciarUsuarios')) {
    if (typeof showToast === 'function') showToast('Você não tem permissão para gerenciar usuários.', 'error');
    return;
  }
  _userEditId = id || null;

  const errEl = document.getElementById('user-edit-error');
  if (errEl) errEl.style.display = 'none';
  document.getElementById('user-edit-modal-title').textContent = id ? 'Editar Usuário' : 'Novo Usuário';

  // Label de senha obrigatória
  const reqLabel = document.getElementById('user-pwd-req-label');
  if (reqLabel) reqLabel.style.display = id ? 'none' : 'inline';

  // Popula select de grupos
  const groupSel = document.getElementById('user-edit-grupo');
  if (groupSel) {
    groupSel.innerHTML = '<option value="">— Selecione um grupo —</option>' +
      authState.groups.map(g =>
        `<option value="${g.id}">${g.nome}${g.isDefault ? ' ★' : ''}</option>`
      ).join('');
    groupSel.disabled = false;
  }

  _populateCargoSelect('user-edit-cargo', '');

  if (id) {
    const u = authState.users.find(u => u.id === id);
    if (!u) return;
    document.getElementById('user-edit-nome').value      = u.nomeCompleto || '';
    document.getElementById('user-edit-cpf').value       = u.cpf          || '';
    _populateCargoSelect('user-edit-cargo', u.cargo || '');
    document.getElementById('user-edit-username').value  = u.username     || '';
    document.getElementById('user-edit-password').value  = '';
    document.getElementById('user-edit-confirm').value   = '';
    if (groupSel) { groupSel.value = u.grupoId || ''; }
    const statusEl = document.getElementById('user-edit-status');
    if (statusEl) {
      statusEl.checked = u.ativo !== false;
      const isSelf = currentSession?.userId === id;
      statusEl.disabled = isSelf;
      const statusHint = document.getElementById('user-edit-status-self-hint');
      if (statusHint) statusHint.style.display = isSelf ? 'inline' : 'none';
    }
    _userEditIsAdmin = !!u.isAdmin;
    _userEditSetoresTemp = Array.isArray(u.setores) ? [...u.setores] : [];
  } else {
    ['user-edit-nome','user-edit-cpf','user-edit-cargo','user-edit-username',
     'user-edit-password','user-edit-confirm'].forEach(elId => {
      const el = document.getElementById(elId);
      if (el) el.value = '';
    });
    if (groupSel) groupSel.disabled = false;
    const statusEl2 = document.getElementById('user-edit-status');
    if (statusEl2) { statusEl2.checked = true; statusEl2.disabled = false; }
    const statusHint2 = document.getElementById('user-edit-status-self-hint');
    if (statusHint2) statusHint2.style.display = 'none';
    _userEditIsAdmin = false;
    _userEditSetoresTemp = [];
  }
  updateUserEditStatusLabel();
  _updateUserEditSetoresBtn();
  updateUserEditAdminButton();
  document.getElementById('modal-user-edit')?.classList.add('open');
}

function closeUserEditModal() {
  document.getElementById('modal-user-edit')?.classList.remove('open');
}

// Retorna os setores disponíveis para o grupo selecionado no modal de edição
function _getUserEditAvailableSetores() {
  const all = (typeof state !== 'undefined' && Array.isArray(state.setores)) ? state.setores : [];
  const grupoId = document.getElementById('user-edit-grupo')?.value || '';
  if (!grupoId) return all;
  const g = authState.groups.find(g => g.id === grupoId);
  if (g && Array.isArray(g.setoresPermitidos) && g.setoresPermitidos.length > 0) {
    return all.filter(s => g.setoresPermitidos.includes(s));
  }
  return all;
}

function _onUserEditGrupoChange() {
  // Ao trocar de grupo, zera o override para herdar os setores do novo grupo
  _userEditSetoresTemp = [];
  _updateUserEditSetoresBtn();
}

function openUserEditSectorModal() {
  const available = _getUserEditAvailableSetores();
  if (available.length === 0) {
    if (typeof showToast === 'function') showToast('Selecione um grupo primeiro.', 'error');
    return;
  }
  // Se não tem override, pré-seleciona todos os disponíveis
  const current = _userEditSetoresTemp.length > 0
    ? _userEditSetoresTemp.filter(s => available.includes(s))
    : [...available];
  _openSectorModal(current, function (sel) {
    // Se selecionou todos, não guarda override (significa "todos do grupo")
    _userEditSetoresTemp = sel.length === available.length ? [] : sel;
    _updateUserEditSetoresBtn();
  }, available);
}

function _updateUserEditSetoresBtn() {
  const lbl = document.getElementById('user-edit-setores-label');
  if (!lbl) return;
  const available = _getUserEditAvailableSetores();
  const n = _userEditSetoresTemp.length;
  if (n === 0 || n >= available.length) {
    lbl.textContent = available.length > 0 ? `Todos (${available.length})` : 'Todos do grupo';
  } else {
    lbl.textContent = `${n} de ${available.length} setores`;
  }
}

function updateUserEditStatusLabel() {
  const t = document.getElementById('user-edit-status');
  const l = document.getElementById('user-edit-status-label');
  if (t && l) l.textContent = t.checked ? 'Ativo' : 'Inativo';
}

function saveUserEdit() {
  if (currentSession && !currentSession.isAdmin && !authHasPermission('config.gerenciarUsuarios')) {
    if (typeof showToast === 'function') showToast('Você não tem permissão para gerenciar usuários.', 'error');
    return;
  }
  const nome     = (document.getElementById('user-edit-nome')?.value     || '').trim();
  const cpf      = (document.getElementById('user-edit-cpf')?.value      || '').trim();
  const cargo    = (document.getElementById('user-edit-cargo')?.value    || '').trim();
  const username = (document.getElementById('user-edit-username')?.value || '').trim();
  const pwd      = document.getElementById('user-edit-password')?.value  || '';
  const conf     = document.getElementById('user-edit-confirm')?.value   || '';
  const grupoId  = document.getElementById('user-edit-grupo')?.value     || null;
  const isSelf   = _userEditId && currentSession?.userId === _userEditId;
  const ativo    = isSelf ? true : (document.getElementById('user-edit-status')?.checked !== false);

  if (!nome)     { _showAuthError('user-edit-error', 'Informe o nome completo.'); return; }
  if (!username) { _showAuthError('user-edit-error', 'Informe o nome de usuário.'); return; }
  if (!_userEditId && !pwd) { _showAuthError('user-edit-error', 'Informe uma senha para o novo usuário.'); return; }
  if (!_userEditIsAdmin && !grupoId) { _showAuthError('user-edit-error', 'Selecione um grupo para o usuário.'); return; }
  if (authState.users.some(u => u.username.toLowerCase() === username.toLowerCase() && u.id !== _userEditId))
    { _showAuthError('user-edit-error', 'Nome de usuário já em uso.'); return; }
  if (pwd) {
    if (pwd !== conf)      { _showAuthError('user-edit-error', 'As senhas não conferem.'); return; }
    if (pwd.length < 4)    { _showAuthError('user-edit-error', 'Senha deve ter ao menos 4 caracteres.'); return; }
  }

  if (_userEditId) {
    const idx = authState.users.findIndex(u => u.id === _userEditId);
    if (idx < 0) return;
    const u = authState.users[idx];
    u.nomeCompleto = nome; u.cpf = cpf; u.cargo = cargo; u.username = username;
    u.setores = _userEditSetoresTemp.slice();
    u.ativo = ativo;
    if (!u.isAdmin) {
      u.grupoId = grupoId || null;
      if (_userEditIsAdmin) u.isAdmin = true;
    }
    if (pwd) u.passwordHash = _hashPwd(pwd);
    // Refresh session if editing self
    if (currentSession?.userId === _userEditId) {
      currentSession.nomeCompleto = nome; currentSession.cargo = cargo;
      currentSession.setores = _userEditSetoresTemp.slice();
      if (grupoId) currentSession.grupoId = grupoId;
      localStorage.setItem('auth-session', JSON.stringify(currentSession));
      _updateSidebarUser();
      _initTopbarSectorFilter(); // reinicializa filtro com novos setores
    }
  } else {
    authState.users.push({
      id: _authUid(), nomeCompleto: nome, cpf, cargo, username,
      passwordHash: _hashPwd(pwd),
      setores: _userEditSetoresTemp.slice(),
      grupoId: grupoId || null, isAdmin: _userEditIsAdmin, ativo,
      createdAt: new Date().toISOString()
    });
  }
  _saveAuth();
  closeUserEditModal();
  renderUsersTable();
  if (typeof showToast === 'function')
    showToast(_userEditId ? 'Usuário atualizado!' : 'Usuário criado!', 'success');
}

function deleteUser(id) {
  if (currentSession && !currentSession.isAdmin && !authHasPermission('config.gerenciarUsuarios')) {
    if (typeof showToast === 'function') showToast('Você não tem permissão para excluir usuários.', 'error');
    return;
  }
  const u = authState.users.find(u => u.id === id);
  if (!u) return;
  if (u.isAdmin) { if (typeof showToast==='function') showToast('Não é possível excluir o administrador.', 'error'); return; }
  if (u.id === currentSession?.userId) { if (typeof showToast==='function') showToast('Você não pode excluir sua própria conta.', 'error'); return; }
  if (!confirm(`Excluir o usuário "${u.nomeCompleto}"? Esta ação não pode ser desfeita.`)) return;
  authState.users = authState.users.filter(u => u.id !== id);
  _saveAuth();
  renderUsersTable();
  if (typeof showToast === 'function') showToast('Usuário excluído.', 'success');
}

// ═══════════════════════════════════════════════════════════════
// GERENCIAMENTO DE GRUPOS (admin)
// ═══════════════════════════════════════════════════════════════

const PERM_STRUCTURE = {
  ativos:     { label: 'Ativos',           keys: ['criar','editar','excluir','editarSetor','editarCategoria'] },
  rotinas:    { label: 'Rotinas',          keys: ['criar','editar','excluir','editarTipo'] },
  tarefas:    { label: 'Tarefas',          keys: ['criar','editar','excluir','publicar'] },
  atividades: { label: 'Atividades',       keys: ['editar','excluir','gerenciarAnexos'] },
  ot:         { label: 'OT',               keys: ['criarOT','editarOT','excluirOT','alterarStatus','realizarPublicacoes','editarPublicacoes','excluirPublicacoes'] },
  config:     { label: 'Configurações',    keys: ['visualizarConfig','backup','gerenciarUsuarios','gerenciarGrupos','gerenciarEmpresas'] }
};

const PERM_LABELS = {
  criar:'Criar', editar:'Editar', excluir:'Excluir', gerenciarAnexos:'Gerenciar Anexos', publicar:'Publicar',
  editarSetor:'Editar setores', editarCategoria:'Editar categorias', editarTipo:'Editar tipos',
  criarOT:'Criar OT', editarOT:'Editar OT', excluirOT:'Excluir OT',
  alterarStatus:'Alterar Status',
  realizarPublicacoes:'Realizar Publicações',
  editarPublicacoes:'Editar Publicações',
  excluirPublicacoes:'Excluir Publicações',
  visualizarConfig:'Visualizar configurações', backup:'Backup',
  gerenciarUsuarios:'Gerenciar usuários', gerenciarGrupos:'Gerenciar grupos',
  gerenciarEmpresas:'Gerenciar empresas'
};

function _emptyPermissoes() {
  const p = {};
  for (const [cat, { keys }] of Object.entries(PERM_STRUCTURE)) {
    p[cat] = {};
    keys.forEach(k => { p[cat][k] = false; });
  }
  return p;
}

let _groupEditId = null;

function renderGroupsTable() {
  const tbody = document.getElementById('groups-tbody');
  if (!tbody) return;

  if (authState.groups.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="data-table-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="9" cy="7" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6"/>
        <circle cx="17" cy="7" r="3"/><path d="M21 20c0-3.3-2.7-6-6-6"/>
      </svg>
      <strong>Nenhum grupo cadastrado</strong>
      <p>Crie grupos para gerenciar permissões de usuários</p>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = authState.groups.map(g => {
    const memberCount = authState.users.filter(u => u.grupoId === g.id).length;
    const defaultCell = g.isDefault
      ? '<span class="chip chip-cyan" style="font-size:10px;">Padrão</span>'
      : `<button class="btn btn-outline" style="font-size:11px;padding:3px 10px;min-height:0;height:26px;"
           onclick="setGroupDefault('${g.id}')">Definir padrão</button>`;
    return `<tr>
      <td style="font-weight:600;font-size:13px;">${g.nome}</td>
      <td><span class="chip chip-gray">${memberCount} membro${memberCount!==1?'s':''}</span></td>
      <td>${defaultCell}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn btn-outline" onclick="openGroupSectorModal('${g.id}')" title="Permissão de Setores"
          style="font-size:11px;padding:3px 10px;min-height:0;height:26px;gap:5px;margin-right:4px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
          </svg>
          Setores ${g.setoresPermitidos?.length > 0 ? '(' + g.setoresPermitidos.length + ')' : 'Todos'}
        </button>
        <button class="btn btn-outline btn-icon" onclick="openGroupEditModal('${g.id}')" title="Editar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>
          </svg>
        </button>
        <button class="btn btn-outline btn-icon" onclick="deleteGroup('${g.id}')" title="Excluir"
          style="color:var(--red);border-color:rgba(230,57,70,.3);margin-left:4px;"
          ${g.isDefault ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
          </svg>
        </button>
      </td>
    </tr>`;
  }).join('');
}

let _groupSectorEditId = null;
let _groupSectorTemp = [];

function openGroupSectorModal(groupId) {
  const g = authState.groups.find(g => g.id === groupId);
  if (!g) return;
  _groupSectorEditId = groupId;
  _groupSectorTemp = [...(g.setoresPermitidos || [])];

  const setores = (typeof state !== 'undefined' && Array.isArray(state.setores)) ? state.setores : [];
  const list = document.getElementById('group-sector-list');
  if (!list) return;

  if (setores.length === 0) {
    list.innerHTML = `<div class="data-table-empty" style="padding:24px;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/></svg>
      <strong>Nenhum setor cadastrado</strong>
    </div>`;
  } else {
    list.innerHTML = setores.map(s => {
      const checked = _groupSectorTemp.length === 0 || _groupSectorTemp.includes(s);
      const val = s.replace(/"/g, '&quot;');
      return `<label class="sector-check-card${checked ? ' checked' : ''}">
        <input type="checkbox" value="${val}" ${checked ? 'checked' : ''} onchange="_onGroupSectorCheck(this)">
        <span class="sector-check-card-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px;">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </span>
        <span class="sector-check-card-label">${s}</span>
      </label>`;
    }).join('');
  }

  const titleEl = document.getElementById('group-sector-modal-title');
  if (titleEl) titleEl.textContent = `Setores — ${g.nome}`;
  _updateGroupSectorCount();
  document.getElementById('modal-group-sector')?.classList.add('open');
}

function _onGroupSectorCheck(cb) {
  if (cb) {
    const card = cb.closest('.sector-check-card');
    if (card) card.classList.toggle('checked', cb.checked);
  }
  const checkboxes = document.querySelectorAll('#group-sector-list input[type=checkbox]');
  const allChecked = [...checkboxes].every(c => c.checked);
  _groupSectorTemp = allChecked ? [] : [...checkboxes].filter(c => c.checked).map(c => c.value);
  _updateGroupSectorCount();
}

function _updateGroupSectorCount() {
  const checkboxes = [...document.querySelectorAll('#group-sector-list input[type=checkbox]')];
  const n = checkboxes.filter(c => c.checked).length;
  const total = checkboxes.length;
  const countEl = document.getElementById('group-sector-count');
  if (countEl) countEl.textContent = n === 0 ? 'Nenhum selecionado' : `${n} de ${total} selecionado${n !== 1 ? 's' : ''}`;
  const btn = document.getElementById('btn-group-sector-all');
  if (btn) {
    const isAll = total > 0 && n === total;
    btn.innerHTML = isAll
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Desmarcar todos`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px;"><polyline points="20 6 9 17 4 12"/></svg> Selecionar todos`;
  }
}

function _toggleGroupSectorAll() {
  const checkboxes = document.querySelectorAll('#group-sector-list input[type=checkbox]');
  const allChecked = [...checkboxes].every(c => c.checked);
  checkboxes.forEach(c => { c.checked = !allChecked; });
  _onGroupSectorCheck();
}

function saveGroupSectorModal() {
  const checkboxes = document.querySelectorAll('#group-sector-list input[type=checkbox]');
  const all = [...checkboxes];
  const allChecked = all.every(c => c.checked);
  const selected = allChecked ? [] : all.filter(c => c.checked).map(c => c.value);
  const g = authState.groups.find(g => g.id === _groupSectorEditId);
  if (g) {
    g.setoresPermitidos = selected;

    // Sincroniza user.setores: remove setores que o grupo não permite mais
    authState.users
      .filter(u => u.grupoId === _groupSectorEditId && Array.isArray(u.setores) && u.setores.length > 0)
      .forEach(u => {
        if (selected.length === 0) return; // grupo sem restrição: mantém tudo
        u.setores = u.setores.filter(s => selected.includes(s));
        // Atualiza sessão ativa se for o usuário logado
        if (currentSession?.userId === u.id) {
          currentSession.setores = u.setores;
          localStorage.setItem('auth-session', JSON.stringify(currentSession));
        }
      });

    _saveAuth();
  }
  document.getElementById('modal-group-sector')?.classList.remove('open');
  renderGroupsTable();
  // Se o grupo editado é o do usuário logado, reinicializa o filtro da topbar
  if (currentSession?.grupoId === _groupSectorEditId) _initTopbarSectorFilter();
  if (typeof showToast === 'function') showToast('Setores do grupo atualizados.', 'success');
}

function closeGroupSectorModal() {
  document.getElementById('modal-group-sector')?.classList.remove('open');
}

function openGroupEditModal(id) {
  _groupEditId = id || null;
  const errEl = document.getElementById('group-edit-error');
  if (errEl) errEl.style.display = 'none';
  document.getElementById('group-edit-modal-title').textContent = id ? 'Editar Grupo' : 'Novo Grupo';

  if (id) {
    const g = authState.groups.find(g => g.id === id);
    if (!g) return;
    document.getElementById('group-edit-nome').value      = g.nome || '';
    document.getElementById('group-edit-default').checked = !!g.isDefault;
    _renderPermissions(g.permissoes || _emptyPermissoes());
  } else {
    document.getElementById('group-edit-nome').value      = '';
    document.getElementById('group-edit-default').checked = false;
    _renderPermissions(_emptyPermissoes());
  }
  updateGroupEditDefaultLabel();
  document.getElementById('modal-group-edit')?.classList.add('open');
}

function closeGroupEditModal() {
  document.getElementById('modal-group-edit')?.classList.remove('open');
}

function updateGroupEditDefaultLabel() {
  const el = document.getElementById('group-edit-default-label');
  if (el) el.textContent = document.getElementById('group-edit-default')?.checked
    ? 'Grupo Padrão' : 'Não é padrão';
}

const PERM_ICONS = {
  ativos:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>`,
  rotinas:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>`,
  tarefas:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`,
  atividades: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  ot:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`,
  config:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`
};

function _renderPermissions(permissoes) {
  const container = document.getElementById('group-perm-container');
  if (!container) return;
  container.innerHTML = Object.entries(PERM_STRUCTURE).map(([cat, { label, keys }]) => {
    const activeCount = keys.filter(k => permissoes[cat]?.[k]).length;
    const allChecked  = activeCount === keys.length;
    return `<div class="perm-category" id="perm-cat-${cat}">
      <div class="perm-cat-header">
        <div class="perm-cat-header-left">
          <div class="perm-cat-icon">${PERM_ICONS[cat] || ''}</div>
          <div class="perm-cat-title-wrap">
            <span class="perm-cat-label">${label}</span>
            <span class="perm-cat-badge${activeCount > 0 ? ' has-active' : ''}" id="perm-badge-${cat}">
              ${activeCount}/${keys.length}
            </span>
          </div>
        </div>
        <button type="button" class="perm-cat-toggle-btn${allChecked ? ' all-active' : ''}"
          id="perm-all-btn-${cat}" onclick="toggleAllCatPerms('${cat}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:10px;height:10px;">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          ${allChecked ? 'Desmarcar todos' : 'Marcar todos'}
        </button>
        <input type="checkbox" id="perm-all-${cat}" ${allChecked ? 'checked' : ''} style="display:none;">
      </div>
      <div class="perm-rows">
        ${keys.map(k => {
          const on = !!permissoes[cat]?.[k];
          return `<label class="perm-row${on ? ' active' : ''}" id="perm-row-${cat}-${k}"
            onclick="_onPermRowClick(this,'${cat}','${k}')">
            <input type="checkbox" id="perm-${cat}-${k}" ${on ? 'checked' : ''}>
            <span class="perm-row-toggle"></span>
            <span class="perm-row-label">${PERM_LABELS[k] || k}</span>
          </label>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

function _onPermRowClick(rowEl, cat, k) {
  const cb = document.getElementById(`perm-${cat}-${k}`);
  if (!cb) return;
  cb.checked = !cb.checked;
  rowEl.classList.toggle('active', cb.checked);
  updateCatAllCheck(cat);
}

function toggleAllCatPerms(cat) {
  const keys    = PERM_STRUCTURE[cat]?.keys || [];
  const allCb   = document.getElementById('perm-all-' + cat);
  const newState = allCb ? !allCb.checked : true;
  if (allCb) allCb.checked = newState;
  keys.forEach(k => {
    const cb  = document.getElementById(`perm-${cat}-${k}`);
    const row = document.getElementById(`perm-row-${cat}-${k}`);
    if (cb)  cb.checked = newState;
    if (row) row.classList.toggle('active', newState);
  });
  _updateCatHeader(cat);
}

function updateCatAllCheck(cat) {
  const keys    = PERM_STRUCTURE[cat]?.keys || [];
  const allEl   = document.getElementById('perm-all-' + cat);
  const allOn   = keys.every(k => document.getElementById(`perm-${cat}-${k}`)?.checked);
  if (allEl) allEl.checked = allOn;
  _updateCatHeader(cat);
}

function _updateCatHeader(cat) {
  const keys        = PERM_STRUCTURE[cat]?.keys || [];
  const activeCount = keys.filter(k => document.getElementById(`perm-${cat}-${k}`)?.checked).length;
  const allOn       = activeCount === keys.length;

  const badge = document.getElementById(`perm-badge-${cat}`);
  if (badge) {
    badge.textContent = `${activeCount}/${keys.length}`;
    badge.classList.toggle('has-active', activeCount > 0);
  }
  const btn = document.getElementById(`perm-all-btn-${cat}`);
  if (btn) {
    btn.classList.toggle('all-active', allOn);
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:10px;height:10px;">
      ${allOn
        ? '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
        : '<polyline points="20 6 9 17 4 12"/>'}
    </svg>
    ${allOn ? 'Desmarcar todos' : 'Marcar todos'}`;
  }
}

function _readPermissions() {
  const p = _emptyPermissoes();
  for (const [cat, { keys }] of Object.entries(PERM_STRUCTURE)) {
    keys.forEach(k => { const el = document.getElementById(`perm-${cat}-${k}`); if (el) p[cat][k] = el.checked; });
  }
  return p;
}

function saveGroupEdit() {
  const nome      = (document.getElementById('group-edit-nome')?.value || '').trim();
  const isDefault = document.getElementById('group-edit-default')?.checked || false;

  if (!nome) { _showAuthError('group-edit-error', 'Informe o nome do grupo.'); return; }
  if (authState.groups.some(g => g.nome.toLowerCase() === nome.toLowerCase() && g.id !== _groupEditId))
    { _showAuthError('group-edit-error', 'Já existe um grupo com este nome.'); return; }

  const permissoes = _readPermissions();

  if (isDefault) authState.groups.forEach(g => { g.isDefault = false; });

  if (_groupEditId) {
    const idx = authState.groups.findIndex(g => g.id === _groupEditId);
    if (idx < 0) return;
    authState.groups[idx].nome       = nome;
    authState.groups[idx].isDefault  = isDefault;
    authState.groups[idx].permissoes = permissoes;
  } else {
    authState.groups.push({ id: _authUid(), nome, isDefault, permissoes, createdAt: new Date().toISOString() });
  }
  _saveAuth();
  closeGroupEditModal();
  renderGroupsTable();
  if (typeof showToast === 'function')
    showToast(_groupEditId ? 'Grupo atualizado!' : 'Grupo criado!', 'success');
}

function deleteGroup(id) {
  const g = authState.groups.find(g => g.id === id);
  if (!g) return;
  if (g.isDefault) { if (typeof showToast==='function') showToast('Não é possível excluir o grupo padrão.', 'error'); return; }
  const n = authState.users.filter(u => u.grupoId === id).length;
  if (n > 0) { if (typeof showToast==='function') showToast(`Este grupo tem ${n} membro(s). Mova-os antes de excluir.`, 'error'); return; }
  if (!confirm(`Excluir o grupo "${g.nome}"?`)) return;
  authState.groups = authState.groups.filter(g => g.id !== id);
  _saveAuth();
  renderGroupsTable();
  if (typeof showToast === 'function') showToast('Grupo excluído.', 'success');
}

function setGroupDefault(id) {
  authState.groups.forEach(g => { g.isDefault = g.id === id; });
  _saveAuth();
  renderGroupsTable();
  const g = authState.groups.find(g => g.id === id);
  if (typeof showToast === 'function') showToast(`"${g?.nome}" definido como grupo padrão.`, 'success');
}

// Enter nos formulários de auth
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter') return;
  const overlay = document.getElementById('auth-overlay');
  if (!overlay || overlay.style.display === 'none' || overlay.style.display === '') return;
  const active = document.querySelector('.auth-screen.active');
  if (!active) return;
  if (active.id === 'auth-screen-login')       authDoLogin();
  else if (active.id === 'auth-screen-first-admin') authDoCreateAdmin();
  else if (active.id === 'auth-screen-register')    authDoRegister();
});
