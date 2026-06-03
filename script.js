  // ── ESTADO GLOBAL ──
  const STORAGE_KEY = 'gestao-ativos-v2';
  let state = {
    setores: ["Laboratório Central", "Triagem", "Imagens"],
    categorias: ["Equipamentos Médicos", "Mobiliário Clínico", "TI"],
    ativos: [],
    tiposRotina: ['Preventivo', 'Rotina'],
    rotinas: [],
    tarefas: [],
    publicacoes: []
  };

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    refreshTaskFlagsUI();
  }

  function isModalOpen(id) {
    return document.getElementById(id)?.classList.contains('open');
  }

  function getActiveSubTab(prefix, tabs) {
    for (const t of tabs) {
      const el = document.getElementById(prefix + '-' + t);
      if (el && el.style.display !== 'none') return t;
    }
    return tabs[0];
  }

  function refreshTaskFlagsUI() {
    renderCards();
    renderRotinasTable();
    renderTarefasTable();
    renderAtividadesTable();
    updateNotifBadge();

    if (document.getElementById('notif-dropdown')?.classList.contains('open')) {
      renderNotifDropdown();
    }
    if (document.getElementById('ativos-notif-dropdown')?.classList.contains('open')) {
      renderAtivosNotifDropdown();
    }

    if (isModalOpen('modal-rotina-view') && rotinaViewId) {
      renderRotinaViewInfo();
      renderRotinaViewTarefas();
      const rvTab = getActiveSubTab('rvtab', ['info', 'tarefas', 'atividades']);
      if (rvTab === 'atividades') renderRotinaViewAtividades();
    }

    if (isModalOpen('modal-visualizar') && ativoEdicaoIndex !== null && ativoEdicaoIndex !== undefined) {
      _atualizarBadgesAtivoTabs(ativoEdicaoIndex);
      const avTab = getActiveSubTab('avtab', ['info', 'rotinas', 'tarefas', 'atividades']);
      if (avTab === 'rotinas') _renderAtivoRotinas();
      if (avTab === 'tarefas') _renderAtivoTarefas();
      if (avTab === 'atividades') _renderAtivoAtividades();
    }

    if (isModalOpen('modal-tarefa-detalhe') && tarefaDetalheId) {
      renderTarefaDetalheContent(tarefaDetalheId);
    }

    if (isModalOpen('modal-historico') && _historicoTarefaId) {
      renderHistoricoTable(_historicoTarefaId);
    }
  }
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
  }

  const storedState = loadState();
  if (storedState && typeof storedState === 'object') {
    state = {
      setores: Array.isArray(storedState.setores) ? storedState.setores : state.setores,
      categorias: Array.isArray(storedState.categorias) ? storedState.categorias : state.categorias,
      ativos: Array.isArray(storedState.ativos) ? storedState.ativos : state.ativos,
      tiposRotina: Array.isArray(storedState.tiposRotina) ? storedState.tiposRotina : state.tiposRotina,
      rotinas: Array.isArray(storedState.rotinas) ? storedState.rotinas : state.rotinas,
      tarefas: Array.isArray(storedState.tarefas) ? storedState.tarefas : state.tarefas,
      publicacoes: Array.isArray(storedState.publicacoes) ? storedState.publicacoes : state.publicacoes
    };
  }

  // ── UTILITÁRIOS ──
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function formatDate(str) {
    if (!str) return '—';
    const value = typeof str === 'string' ? str : String(str);
    const datePart = (value.includes('T') ? value.split('T')[0] : value);
    const [y,m,d] = datePart.split('-');
    return `${d}/${m}/${y}`;
  }
  function parseDataRealizada(str) {
    if (!str) return { date: '', time: '' };
    const value = typeof str === 'string' ? str : String(str);
    if (value.includes('T')) {
      const [date, timePart] = value.split('T');
      const time = (timePart || '').slice(0, 5);
      return { date, time: /^\d{2}:\d{2}$/.test(time) ? time : '' };
    }
    return { date: value, time: '' };
  }
  function buildDataRealizada(date, time) {
    if (!date) return '';
    return time ? `${date}T${time}` : date;
  }
  function dataRealizadaSortKey(str) {
    const { date, time } = parseDataRealizada(str);
    return (date || '') + 'T' + (time || '00:00');
  }
  function formatDataRealizadaHtml(str) {
    const { date, time } = parseDataRealizada(str);
    if (!date) return '—';
    const dateStr = formatDate(date);
    if (!time) return dateStr;
    return `${dateStr}<span class="data-realizada-hora">${time}</span>`;
  }
  function formatDataRealizadaText(str) {
    const { date, time } = parseDataRealizada(str);
    if (!date) return '—';
    return time ? `${formatDate(date)} ${time}` : formatDate(date);
  }
  function getTarefaLabel(t) {
    if (!t) return '—';
    const ativo = state.ativos[t.equipamentoIdx];
    const parts = [];
    if (ativo?.nome) parts.push(ativo.nome);
    if (ativo?.codigo) parts.push(ativo.codigo);
    if (t.dataTarefa) parts.push('prog. ' + formatDate(t.dataTarefa));
    return parts.length ? parts.join(' · ') : '—';
  }
  function calcProximaData(dateStr, rotina) {
    if (!dateStr || !rotina) return '';
    const d = new Date(dateStr + 'T12:00:00');
    const n = parseInt(rotina.fazerCada) || 1;
    switch (rotina.frequencia) {
      case 'Dia':    d.setDate(d.getDate() + n); break;
      case 'Semana': d.setDate(d.getDate() + n * 7); break;
      case 'Meses':  d.setMonth(d.getMonth() + n); break;
      case 'Anos':   d.setFullYear(d.getFullYear() + n); break;
    }
    return d.toISOString().split('T')[0];
  }
  function getTaskFlag(tarefa) {
    if (tarefa.status === 'Inativo') return { cls: 'flag-inactive', icon: '⏸', label: 'Inativo' };
    if (!tarefa.proximaData) return { cls: 'flag-ok', icon: '✓', label: 'Ok' };
    const today = new Date(); today.setHours(0,0,0,0);
    const due = new Date(tarefa.proximaData + 'T00:00:00');
    const diff = Math.ceil((due - today) / 86400000);
    if (diff < 0) return { cls: 'flag-danger', icon: '!', label: `Vencida ${Math.abs(diff)}d` };
    if (diff <= (tarefa.lembrete || 3)) return { cls: 'flag-warning', icon: '⚠', label: `${diff}d restantes` };
    return { cls: 'flag-ok', icon: '✓', label: `${diff}d` };
  }

  // ── INICIALIZAÇÃO ──
  document.addEventListener("DOMContentLoaded", () => {
    atualizarSelects();       // popula setores, categorias, tipos
    atualizarFiltrosRotina(); // filtros do painel rotina
    populateTipoSelect();     // select de tipo no drawer
    renderCards();
    updateNotifBadge();
    updateAtivosFiltroBtn();
    setInterval(refreshTaskFlagsUI, 60000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshTaskFlagsUI();
    });
    switchTab('ativos');
  });

  // ── SIDEBAR OVERLAY ──
  function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-backdrop').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-backdrop').classList.remove('open');
    document.body.style.overflow = '';
  }

  // ── TOAST ──
  let _toastTimer = null;
  function showToast(msg, type = 'success') {
    const el = document.getElementById('toast');
    const icons = {
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
      error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
    };
    el.innerHTML = (icons[type] || '') + msg;
    el.className = `toast ${type} show`;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  // ── NAVEGAÇÃO ──
  const TAB_TITLES = { inicio:'Início', ativos:'Ativos', rotina:'Rotina', os:'Ordens de Serviço', config:'Configurações' };
  function switchTab(tabId) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('tab-' + tabId)?.classList.add('active');
    document.getElementById('nav-' + tabId)?.classList.add('active');
    const title = TAB_TITLES[tabId] || tabId;
    document.getElementById('topbar-title').textContent = title;
    document.getElementById('topbar-breadcrumb').textContent = 'Sistema / ' + title;
    closeSidebar();
    if (tabId !== 'ativos') closeAtivosFilter();
    // Inicializar conteúdo ao trocar de aba
    if (tabId === 'rotina') {
      atualizarFiltrosRotina();
      populateTipoSelect();
    }
    if (tabId === 'rotina' || tabId === 'ativos') refreshTaskFlagsUI();
  }

  // ── ROTINA SUBTABS ──
  let activeRotinaTab = 'rotinas';
  function switchRotinaTab(tab) {
    activeRotinaTab = tab;
    document.querySelectorAll('.rotina-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.rotina-nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('rpanel-' + tab).classList.add('active');
    document.getElementById('rnav-' + tab).classList.add('active');
    renderRotinasTable();
    renderTarefasTable();
    renderAtividadesTable();
    updateNotifBadge();
  }

  // ── NOTIFICAÇÕES ──
  function toggleNotifDropdown() {
    const dd = document.getElementById('notif-dropdown');
    dd.classList.toggle('open');
    if (dd.classList.contains('open')) renderNotifDropdown();
  }
  document.addEventListener('click', e => {
    if (!e.target.closest('.notif-wrapper')) {
      document.getElementById('notif-dropdown')?.classList.remove('open');
      document.getElementById('ativos-notif-dropdown')?.classList.remove('open');
    }
    if (!e.target.closest('#ativos-filter-toolbar-zone') && isAtivosFilterOpen()) {
      closeAtivosFilter();
    }
  });

  function renderNotifDropdown() {
    const list = document.getElementById('notif-list');
    const alerts = getNotifAlerts('rotina');
    document.getElementById('notif-count-label').textContent = alerts.length + ' alerta' + (alerts.length !== 1 ? 's' : '');
    if (alerts.length === 0) {
      list.innerHTML = '<div class="notif-empty">Nenhum alerta no momento</div>';
      return;
    }
    list.innerHTML = alerts.map(a => `
      <div class="notif-item" onclick="switchRotinaTab('tarefas');openTarefaDetalhe('${a.tarefaId}');document.getElementById('notif-dropdown').classList.remove('open')">
        <div class="notif-dot ${a.tipo}"></div>
        <div class="notif-text">
          <strong>${a.rotinaNome}</strong> — ${a.equipNome}
          <small>${a.msg}</small>
        </div>
      </div>`).join('');
  }

  function ativoPassesAtivosFilters(equipamentoIdx) {
    const ativo = state.ativos[equipamentoIdx];
    if (!ativo) return false;
    const fSetor = document.getElementById('main-sector-filter')?.value || 'todos';
    const fCat   = document.getElementById('main-category-filter')?.value || 'todas';
    if (fSetor !== 'todos' && ativo.setor !== fSetor) return false;
    if (fCat !== 'todas' && ativo.categoria !== fCat) return false;
    return true;
  }

  function tarefaPassesRotinaNotifFilters(t) {
    const rotina = state.rotinas.find(r => r.id === t.rotinaId);
    const ativo  = state.ativos[t.equipamentoIdx];
    if (!rotina || !ativo) return false;

    const fTipo   = document.getElementById('filter-tipo')?.value || '';
    const fSetor  = document.getElementById('filter-setor-rotina')?.value || '';
    const fCat    = document.getElementById('filter-cat-rotina')?.value || '';
    const fAtivoIdx = state._ativoFiltroIdx ?? null;

    if (fAtivoIdx !== null && fAtivoIdx !== undefined && t.equipamentoIdx !== fAtivoIdx) return false;
    if (fTipo && rotina.tipo !== fTipo) return false;
    if (fSetor && ativo.setor !== fSetor) return false;
    if (fCat && ativo.categoria !== fCat) return false;

    const rStatus = rotina.status || 'Ativo';
    if (_rotinaStatusFilter === 'ativo' && rStatus !== 'Ativo') return false;
    if (_rotinaStatusFilter === 'inativo' && rStatus !== 'Inativo') return false;

    if (activeRotinaTab === 'tarefas') {
      if (!tarefaPassesStatusFilter(t, 'main')) return false;
      const fTarefaAtivo = state._ativoFiltroTarefasIdx ?? null;
      if (fTarefaAtivo !== null && fTarefaAtivo !== undefined && t.equipamentoIdx !== fTarefaAtivo) return false;
    }

    if (activeRotinaTab === 'atividades') {
      const fAtivAtivo = state._ativoFiltroAtividadesIdx ?? null;
      if (fAtivAtivo !== null && fAtivAtivo !== undefined && t.equipamentoIdx !== fAtivAtivo) return false;
    }

    return true;
  }

  function getNotifAlerts(context) {
    const today = new Date(); today.setHours(0,0,0,0);
    const alerts = [];
    state.tarefas.forEach(t => {
      const tStatus = t.status || 'Ativo';
      if (tStatus !== 'Ativo') return;
      if (!t.proximaData) return;

      if (context === 'rotina' && !tarefaPassesRotinaNotifFilters(t)) return;
      if (context === 'ativos' && !ativoPassesAtivosFilters(t.equipamentoIdx)) return;

      const rotina = state.rotinas.find(r => r.id === t.rotinaId);
      const ativo = state.ativos[t.equipamentoIdx];
      if (!rotina || !ativo) return;
      const due = new Date(t.proximaData + 'T00:00:00');
      const diffDays = Math.ceil((due - today) / 86400000);
      if (diffDays < 0) {
        alerts.push({
          tarefaId: t.id, equipamentoIdx: t.equipamentoIdx, proximaData: t.proximaData,
          tipo: 'danger', rotinaNome: rotina.nome, equipNome: ativo.nome, equipCodigo: ativo.codigo,
          msg: `Vencida há ${Math.abs(diffDays)} dia(s)`, diffDays
        });
      } else if (diffDays <= (t.lembrete || 3)) {
        alerts.push({
          tarefaId: t.id, equipamentoIdx: t.equipamentoIdx, proximaData: t.proximaData,
          tipo: 'warning', rotinaNome: rotina.nome, equipNome: ativo.nome, equipCodigo: ativo.codigo,
          msg: `Vence em ${diffDays} dia(s)`, diffDays
        });
      }
    });
    alerts.sort((a, b) => {
      if (a.tipo !== b.tipo) return a.tipo === 'danger' ? -1 : 1;
      return (a.diffDays ?? 0) - (b.diffDays ?? 0);
    });
    return alerts;
  }

  function getAtivoAlertCounts(equipamentoIdx) {
    if (!ativoPassesAtivosFilters(equipamentoIdx)) return { danger: 0, warning: 0, total: 0 };
    let danger = 0, warning = 0;
    state.tarefas.filter(t => t.equipamentoIdx === equipamentoIdx && t.status === 'Ativo').forEach(t => {
      const f = getTaskFlag(t);
      if (f.cls === 'flag-danger') danger++;
      else if (f.cls === 'flag-warning') warning++;
    });
    return { danger, warning, total: danger + warning };
  }

  function toggleAtivosNotifDropdown() {
    const dd = document.getElementById('ativos-notif-dropdown');
    if (!dd) return;
    dd.classList.toggle('open');
    if (dd.classList.contains('open')) renderAtivosNotifDropdown();
  }

  function renderAtivosNotifDropdown() {
    const list = document.getElementById('ativos-notif-list');
    const label = document.getElementById('ativos-notif-count-label');
    if (!list) return;
    const alerts = getNotifAlerts('ativos');
    if (label) label.textContent = alerts.length + ' alerta' + (alerts.length !== 1 ? 's' : '');
    if (alerts.length === 0) {
      list.innerHTML = '<div class="notif-empty">Nenhum alerta no momento</div>';
      return;
    }
    list.innerHTML = alerts.map(a => `
      <div class="notif-item" onclick="openAlertaFromAtivos('${a.tarefaId}');document.getElementById('ativos-notif-dropdown').classList.remove('open')">
        <div class="notif-dot ${a.tipo}"></div>
        <div class="notif-text">
          <strong>${a.rotinaNome}</strong> — ${a.equipNome}
          <small>${a.equipCodigo ? a.equipCodigo + ' · ' : ''}${a.msg} · ${formatDate(a.proximaData)}</small>
        </div>
      </div>`).join('');
  }

  function openAlertaFromAtivos(tarefaId) {
    const t = state.tarefas.find(t => t.id === tarefaId);
    if (!t) return;
    openTarefaDetalhe(tarefaId);
  }

  function updateNotifBadge() {
    const rotinaCount = getNotifAlerts('rotina').length;
    const ativosCount = getNotifAlerts('ativos').length;
    const badge = document.getElementById('notif-badge');
    if (badge) {
      badge.textContent = rotinaCount;
      badge.classList.toggle('visible', rotinaCount > 0);
    }
    const ativosBadge = document.getElementById('ativos-notif-badge');
    if (ativosBadge) {
      ativosBadge.textContent = ativosCount;
      ativosBadge.classList.toggle('visible', ativosCount > 0);
    }
    if (document.getElementById('notif-dropdown')?.classList.contains('open')) {
      renderNotifDropdown();
    }
    if (document.getElementById('ativos-notif-dropdown')?.classList.contains('open')) {
      renderAtivosNotifDropdown();
    }
  }

  // ══════════════════════════════════════════
  // ── DRAWER DE TAREFA ──
  // ══════════════════════════════════════════
  let tarefaEdicaoId = null;

  function openTarefaDrawerParaRotina(rotinaId) {
    const r = state.rotinas.find(r => r.id === rotinaId);
    if (!r) return;
    // Abre o drawer normalmente e depois pré-preenche
    openTarefaDrawer(null, rotinaId);
  }

  function openTarefaDrawer(id = null, preRotinaId = null) {
    if (!id && !preRotinaId && state.rotinas.length === 0) {
      showToast('Cadastre pelo menos uma rotina antes de criar tarefas.', 'info');
      return;
    }
    tarefaEdicaoId = id;
    const editing = id ? state.tarefas.find(t => t.id === id) : null;

    document.getElementById('drawer-tarefa-title').textContent = id ? 'Editar Tarefa' : 'Nova Tarefa';
    document.getElementById('tarefa-save-label').textContent = id ? 'Salvar Alterações' : 'Salvar Tarefa';

    // Popula select de equipamentos que possuem rotinas
    const equipIdxSet = [...new Set(state.rotinas.map(r => r.equipamentoIdx))];
    const equipSel = document.getElementById('tarefa-equip-select');
    equipSel.innerHTML = '<option value="">Selecione o equipamento...</option>' +
      equipIdxSet.map(i => {
        const a = state.ativos[i];
        return a ? `<option value="${i}">${a.nome} — ${a.codigo}</option>` : '';
      }).join('');

    // Limpar campos
    document.getElementById('tarefa-rotina-select').innerHTML = '<option value="">Selecione a rotina...</option>';
    document.getElementById('tarefa-rotina-info').style.display = 'none';
    document.getElementById('tarefa-data').value = '';
    document.getElementById('tarefa-lembrete').value = '';
    document.getElementById('tarefa-obs').value = '';
    document.getElementById('tarefa-status').checked = true;
    updateTarefaStatusToggleLabel();
    setProximaDataDisplay('');

    if (editing) {
      equipSel.value = editing.equipamentoIdx;
      onTarefaEquipChange();
      document.getElementById('tarefa-rotina-select').value = editing.rotinaId;
      onTarefaRotinaChange();
      document.getElementById('tarefa-data').value = editing.dataTarefa || '';
      document.getElementById('tarefa-lembrete').value = editing.lembrete || '';
      document.getElementById('tarefa-obs').value = editing.observacoes || '';
      document.getElementById('tarefa-status').checked = (editing.status || 'Ativo') === 'Ativo';
      updateTarefaStatusToggleLabel();
      document.getElementById('tarefa-anexo-obrigatorio').checked = !!editing.anexoObrigatorio;
      setProximaDataDisplay(editing.proximaData || '');
      document.getElementById('tarefa-proxima-data').value = editing.proximaData || '';

      // Bloquear reativação se concluída por repetições
      const statusSel = document.getElementById('tarefa-status');
      if (editing.autoInativada) {
        statusSel.disabled = true;
        statusSel.title = 'Tarefa concluída automaticamente — não pode ser reativada';
      } else {
        statusSel.disabled = false;
        statusSel.title = '';
      }
    } else if (preRotinaId) {
      // Pré-preenche a partir de uma rotina específica
      const r = state.rotinas.find(r => r.id === preRotinaId);
      if (r) {
        equipSel.value = r.equipamentoIdx;
        onTarefaEquipChange();
        document.getElementById('tarefa-rotina-select').value = preRotinaId;
        onTarefaRotinaChange();
      }
      document.getElementById('tarefa-status').disabled = false;
    } else {
      document.getElementById('tarefa-status').disabled = false;
    }

    // Inicializa checklist e toggle de anexo
    checklistTarefaTemp = editing ? JSON.parse(JSON.stringify(editing.checklistTarefa || [])) : [];
    if (!editing) document.getElementById('tarefa-anexo-obrigatorio').checked = false;
    renderTarefaChecklistBuilder();
    atualizarAbaTarefaChecklist();
    switchTarefaDrawerTab('dados');

    document.getElementById('right-drawer-tarefa').classList.add('open');
    document.getElementById('drawer-backdrop').classList.add('open');
  }

  function updateTarefaStatusToggleLabel() {
    const toggle = document.getElementById('tarefa-status');
    const label = document.getElementById('tarefa-status-label');
    if (!toggle || !label) return;
    label.textContent = toggle.checked ? 'Ativo' : 'Inativo';
  }

  // ── ABAS DO DRAWER DE TAREFA ──
  function switchTarefaDrawerTab(tab) {
    ['dados','checklist'].forEach(t => {
      document.getElementById('dtab-tarefa-' + t).classList.toggle('active', t === tab);
      document.getElementById('dtab-tarefa-btn-' + t).classList.toggle('active', t === tab);
    });
  }

  // ── CHECKLIST DA TAREFA ──
  let checklistTarefaTemp = [];

  function addTarefaChecklistItem() {
    const input = document.getElementById('tarefa-checklist-novo-item');
    const texto = input.value.trim();
    if (!texto) return;
    checklistTarefaTemp.push({ id: uid(), texto });
    input.value = '';
    renderTarefaChecklistBuilder();
    atualizarAbaTarefaChecklist();
  }

  function removeTarefaChecklistItem(id) {
    checklistTarefaTemp = checklistTarefaTemp.filter(i => i.id !== id);
    renderTarefaChecklistBuilder();
    atualizarAbaTarefaChecklist();
  }

  function editTarefaChecklistItem(id) {
    const item = checklistTarefaTemp.find(i => i.id === id);
    if (!item) return;
    const novoTexto = prompt('Editar item:', item.texto);
    if (novoTexto === null) return;
    const t = novoTexto.trim();
    if (!t) return;
    item.texto = t;
    renderTarefaChecklistBuilder();
  }

  function renderTarefaChecklistBuilder() {
    const container = document.getElementById('tarefa-checklist-builder');
    if (!container) return;
    if (checklistTarefaTemp.length === 0) {
      container.innerHTML = `<div class="checklist-empty-tip">Nenhum item adicionado.</div>`;
      return;
    }
    container.innerHTML = checklistTarefaTemp.map((item, i) => `
      <div class="checklist-item-row">
        <div class="checklist-item-num">${i + 1}</div>
        <div class="checklist-item-text">${item.texto}</div>
        <button class="checklist-item-del" onclick="editTarefaChecklistItem('${item.id}')" title="Editar" style="color:var(--cyan);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:13px;height:13px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        </button>
        <button class="checklist-item-del" onclick="removeTarefaChecklistItem('${item.id}')" title="Remover">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`).join('');
  }

  function atualizarAbaTarefaChecklist() {
    const labelEl = document.getElementById('dtab-tarefa-checklist-label');
    if (!labelEl) return;
    const n = checklistTarefaTemp.length;
    labelEl.textContent = n > 0 ? `Checklist da Tarefa (${n})` : 'Checklist da Tarefa';
  }

  function closeTarefaDrawer() {
    document.getElementById('right-drawer-tarefa').classList.remove('open');
    document.getElementById('drawer-backdrop').classList.remove('open');
  }

  function closeAllDrawers() {
    closeRotinaDrawer();
    closeTarefaDrawer();
  }

  function onTarefaEquipChange() {
    const equipIdx = parseInt(document.getElementById('tarefa-equip-select').value);
    const rotSel = document.getElementById('tarefa-rotina-select');
    document.getElementById('tarefa-rotina-info').style.display = 'none';
    setProximaDataDisplay('');

    if (isNaN(equipIdx)) {
      rotSel.innerHTML = '<option value="">Selecione a rotina...</option>';
      return;
    }
    const rotinas = state.rotinas.filter(r => r.equipamentoIdx === equipIdx);
    rotSel.innerHTML = '<option value="">Selecione a rotina...</option>' +
      rotinas.map(r => `<option value="${r.id}">${r.nome} (${r.tipo})</option>`).join('');
  }

  function onTarefaRotinaChange() {
    const rotinaId = document.getElementById('tarefa-rotina-select').value;
    const infoBox  = document.getElementById('tarefa-rotina-info');

    if (!rotinaId) { infoBox.style.display = 'none'; return; }

    const r = state.rotinas.find(r => r.id === rotinaId);
    if (!r) return;
    const ativo = state.ativos[r.equipamentoIdx];
    const repStr = r.repetir === 'Por' ? `${r.vezes}x` : 'Sempre';
    const nCheck = r.checklist?.length || 0;

    document.getElementById('tinfo-tipo').textContent  = r.tipo;
    document.getElementById('tinfo-freq').textContent  = `A cada ${r.fazerCada} ${r.frequencia}`;
    document.getElementById('tinfo-rep').textContent   = repStr;
    document.getElementById('tinfo-setor').textContent = ativo?.setor || '—';
    document.getElementById('tinfo-cat').textContent   = ativo?.categoria || '—';
    document.getElementById('tinfo-check').textContent = nCheck > 0 ? `${nCheck} item${nCheck>1?'s':''}` : 'Sem checklist';

    infoBox.style.display = '';
    autoCalcProximaData();
  }

  function autoCalcProximaData() {
    const rotinaId = document.getElementById('tarefa-rotina-select').value;
    const data     = document.getElementById('tarefa-data').value;
    if (!rotinaId || !data) { setProximaDataDisplay(''); return; }
    const rotina   = state.rotinas.find(r => r.id === rotinaId);
    if (!rotina) return;
    const proxima  = calcProximaData(data, rotina);
    document.getElementById('tarefa-proxima-data').value = proxima;
    setProximaDataDisplay(proxima);
  }

  function setProximaDataDisplay(val) {
    const el = document.getElementById('tarefa-proxima-display');
    if (!el) return;
    if (val) {
      el.classList.add('filled');
      el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${formatDate(val)}`;
    } else {
      el.classList.remove('filled');
      el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Calculado automaticamente`;
    }
  }

  function saveTarefa() {
    const equipIdx = parseInt(document.getElementById('tarefa-equip-select').value);
    const rotinaId = document.getElementById('tarefa-rotina-select').value;
    const data     = document.getElementById('tarefa-data').value;
    const lembrete = parseInt(document.getElementById('tarefa-lembrete').value) || 3;
    const proxima  = document.getElementById('tarefa-proxima-data').value;
    const status   = document.getElementById('tarefa-status').checked ? 'Ativo' : 'Inativo';
    const obs               = document.getElementById('tarefa-obs').value.trim();
    const anexoObrigatorio  = document.getElementById('tarefa-anexo-obrigatorio').checked;

    if (isNaN(equipIdx)) { showToast('Selecione o equipamento.', 'error'); return; }
    if (!rotinaId)        { showToast('Selecione a rotina.', 'error'); return; }
    if (!data)            { showToast('Informe a data da tarefa.', 'error'); return; }

    // Bloquear reativação de tarefa auto-inativada por conclusão de repetições
    const existente = tarefaEdicaoId ? state.tarefas.find(t => t.id === tarefaEdicaoId) : null;
    if (existente?.autoInativada && status === 'Ativo') {
      showToast('Esta tarefa foi concluída e não pode ser reativada.', 'error');
      return;
    }

    const tarefa = {
      id: tarefaEdicaoId || uid(),
      equipamentoIdx: equipIdx,
      rotinaId, dataTarefa: data,
      proximaData: proxima, lembrete, status, observacoes: obs,
      checklistTarefa: checklistTarefaTemp.slice(),
      anexoObrigatorio,
      autoInativada: existente?.autoInativada || false
    };

    if (tarefaEdicaoId) {
      const idx = state.tarefas.findIndex(t => t.id === tarefaEdicaoId);
      if (idx >= 0) state.tarefas[idx] = tarefa;
    } else {
      state.tarefas.push(tarefa);
    }
    saveState();
    closeTarefaDrawer();
    showToast(tarefaEdicaoId ? 'Tarefa atualizada!' : 'Tarefa cadastrada!', 'success');
  }

  // ══════════════════════════════════════════
  // ── TABELA DE TAREFAS ──
  // ══════════════════════════════════════════
  function renderTarefasTable() {
    const tbody = document.getElementById('tarefas-tbody');
    if (!tbody) return;

    const fAtivoIdx = state._ativoFiltroTarefasIdx ?? null;
    const list = state.tarefas.filter(t => {
      if (fAtivoIdx !== null && t.equipamentoIdx !== fAtivoIdx) return false;
      return tarefaPassesStatusFilter(t, 'main');
    });

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="data-table-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        <strong>Nenhuma tarefa encontrada</strong>
        <p>Ajuste o filtro de ativo ou crie uma nova tarefa</p>
      </div></td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(t => {
      const rotina = state.rotinas.find(r => r.id === t.rotinaId);
      const ativo  = state.ativos[t.equipamentoIdx];
      const flag   = getTaskFlag(t);
      const nPubs  = state.publicacoes.filter(p => p.tarefaId === t.id).length;
      const statusChip = t.status === 'Ativo'
        ? '<span class="chip chip-green">Ativo</span>'
        : '<span class="chip chip-gray">Inativo</span>';
      return `<tr onclick="openTarefaDetalhe('${t.id}')">
        <td><span class="task-flag ${flag.cls}">
          ${flag.cls === 'flag-danger' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' :
            flag.cls === 'flag-warning' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px;"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' :
            flag.cls === 'flag-ok' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px;"><polyline points="20 6 9 17 4 12"/></svg>' :
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px;"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'}
          ${flag.label}
        </span></td>
        <td>
          <div style="font-weight:600;">Rotina: ${rotina?.nome || '—'}</div>
          <div style="font-size:11px;color:var(--text-muted);">${rotina?.tipo || ''}</div>
        </td>
        <td>
          <div style="font-weight:500;">${ativo?.nome || '—'}</div>
          <div style="font-size:11px;color:var(--text-muted);font-family:'DM Mono',monospace;">${ativo?.codigo || ''}</div>
        </td>
        <td style="font-size:12.5px;">${formatDate(t.dataTarefa)}</td>
        <td style="font-size:12.5px;${t.proximaData ? '' : 'color:var(--text-muted);'}">${t.proximaData ? formatDate(t.proximaData) : '—'}</td>
        <td style="font-size:12.5px;">${t.lembrete ? t.lembrete + ' dias' : '—'}</td>
        <td>${statusChip}${nPubs > 0 ? `<span class="chip chip-cyan" style="margin-left:6px;">${nPubs} pub.</span>` : ''}</td>
      </tr>`;
    }).join('');
  }

  // ══════════════════════════════════════════
  // ── DETALHE DA TAREFA ──
  // ══════════════════════════════════════════
  let tarefaDetalheId = null;

  function renderTarefaDetalheContent(id) {
    tarefaDetalheId = id;
    const t = state.tarefas.find(t => t.id === id);
    if (!t) return;
    const rotina = state.rotinas.find(r => r.id === t.rotinaId);
    const ativo  = state.ativos[t.equipamentoIdx];
    const flag   = getTaskFlag(t);
    const nPubs  = state.publicacoes.filter(p => p.tarefaId === id).length;

    document.getElementById('tarefa-detalhe-title').textContent = rotina?.nome || 'Tarefa';
    document.getElementById('tarefa-detalhe-subtitle').textContent = ativo?.nome || '';

    const flagIconMap = {
      'flag-ok':       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
      'flag-warning':  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>`,
      'flag-danger':   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
      'flag-inactive': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
    };

    document.getElementById('tarefa-detalhe-body').innerHTML = `
      <div class="view-hero">
        <div class="view-hero-name">${rotina?.nome || '—'}</div>
        <div class="view-badges" style="margin-top:8px;">
          <span class="view-badge">${ativo?.nome || '—'} &bull; ${ativo?.codigo || ''}</span>
          <span class="view-badge">${rotina?.tipo || ''}</span>
        </div>
        <div class="task-flag-hero ${flag.cls}" style="margin-top:10px;">
          ${flagIconMap[flag.cls] || ''}
          ${flag.label}
        </div>
      </div>

      <div class="task-detail-section">
        <div class="task-detail-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Dados da Rotina
        </div>
        <div class="rotina-view-grid">
          <div class="detail-card"><div class="detail-label">Frequência</div><div class="detail-value">A cada ${rotina?.fazerCada || '?'} ${rotina?.frequencia || ''}</div></div>
          <div class="detail-card"><div class="detail-label">Repetição</div><div class="detail-value">${rotina?.repetir === 'Por' ? rotina.vezes + ' vez(es)' : 'Sempre'}</div></div>
          <div class="detail-card"><div class="detail-label">Setor</div><div class="detail-value">${ativo?.setor || '—'}</div></div>
          <div class="detail-card"><div class="detail-label">Categoria</div><div class="detail-value">${ativo?.categoria || '—'}</div></div>
        </div>
      </div>

      <div class="task-detail-section">
        <div class="task-detail-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Programação da Tarefa
        </div>
        <div class="rotina-view-grid">
          <div class="detail-card"><div class="detail-label">Data da Tarefa</div><div class="detail-value">${formatDate(t.dataTarefa)}</div></div>
          <div class="detail-card"><div class="detail-label">Próxima Data</div><div class="detail-value" style="color:var(--cyan);">${t.proximaData ? formatDate(t.proximaData) : '—'}</div></div>
          <div class="detail-card"><div class="detail-label">Lembrete</div><div class="detail-value">${t.lembrete ? t.lembrete + ' dias antes' : '—'}</div></div>
          <div class="detail-card"><div class="detail-label">Status</div><div class="detail-value">${t.status}</div></div>
          <div class="detail-card"><div class="detail-label">Publicações</div><div class="detail-value">${nPubs} registrada${nPubs !== 1 ? 's' : ''}</div></div>
          <div class="detail-card"><div class="detail-label">Checklist Geral</div><div class="detail-value">${rotina?.checklist?.length > 0 ? rotina.checklist.length + ' item(s)' : '—'}</div></div>
          <div class="detail-card"><div class="detail-label">Checklist da Tarefa</div><div class="detail-value" style="${t.checklistTarefa?.length > 0 ? 'color:var(--cyan);' : ''}">${t.checklistTarefa?.length > 0 ? t.checklistTarefa.length + ' item(s)' : '—'}</div></div>
        </div>
        ${t.observacoes ? `<div class="detail-note" style="margin-top:10px;">
          <div class="detail-label" style="margin-bottom:6px;">Observações</div>
          <div style="font-size:13px;color:var(--text-secondary);white-space:pre-line;">${t.observacoes}</div>
        </div>` : ''}
      </div>`;

    const btnPub = document.getElementById('btn-publicar-tarefa');
    if (btnPub) btnPub.style.display = (t.status === 'Inativo') ? 'none' : '';
  }

  function openTarefaDetalhe(id) {
    renderTarefaDetalheContent(id);
    openModal('modal-tarefa-detalhe');
  }

  function editarTarefaAtual() {
    openTarefaDrawer(tarefaDetalheId);
  }

  function excluirTarefaAtual() {
    if (!confirm('Excluir esta tarefa? O histórico de publicações também será removido.')) return;
    state.tarefas = state.tarefas.filter(t => t.id !== tarefaDetalheId);
    state.publicacoes = state.publicacoes.filter(p => p.tarefaId !== tarefaDetalheId);
    saveState();
    closeModal('modal-tarefa-detalhe');
    showToast('Tarefa excluída.', 'success');
  }

  function abrirHistoricoTarefa() {
    openHistoricoModal(tarefaDetalheId);
  }

  // ══════════════════════════════════════════
  // ── PUBLICAR TAREFA ──
  // ══════════════════════════════════════════
  let pubChecklistState = {};
  let pubAnexos = [];

  function addPubAnexo() {
    const tituloEl = document.getElementById('pub-anexo-titulo');
    const urlEl    = document.getElementById('pub-anexo-input');
    const url   = urlEl.value.trim();
    const titulo = tituloEl.value.trim() || `Anexo ${pubAnexos.length + 1}`;
    if (!url) { showToast('Informe o link do anexo.', 'error'); return; }
    pubAnexos.push({ titulo, url });
    tituloEl.value = '';
    urlEl.value = '';
    renderPubAnexos();
  }

  function removePubAnexo(idx) {
    pubAnexos.splice(idx, 1);
    renderPubAnexos();
  }

  function renderPubAnexos() {
    const list = document.getElementById('pub-anexo-list');
    if (!list) return;
    if (pubAnexos.length === 0) { list.innerHTML = ''; return; }
    list.innerHTML = pubAnexos.map((a, i) => `
      <div class="anexo-item">
        <div class="anexo-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${a.titulo}</div>
          <a class="anexo-link" href="${a.url}" target="_blank" title="${a.url}" style="font-size:11px;">${a.url}</a>
        </div>
        <button class="anexo-del" onclick="removePubAnexo(${i})" title="Remover">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`).join('');
  }

  function openPublicarModal() {
    const t = state.tarefas.find(t => t.id === tarefaDetalheId);
    if (!t) return;
    if (t.status === 'Inativo') { showToast('Tarefas inativas não podem ser publicadas.', 'error'); return; }
    const rotina = state.rotinas.find(r => r.id === t.rotinaId);

    const now = new Date();
    document.getElementById('pub-data-realizada').value = now.toISOString().split('T')[0];
    document.getElementById('pub-hora-realizada').value =
      String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    document.getElementById('pub-notas').value = '';
    pubChecklistState = {};
    pubAnexos = [];
    const _ai = document.getElementById('pub-anexo-input');   if (_ai) _ai.value = '';
    const _at = document.getElementById('pub-anexo-titulo');  if (_at) _at.value = '';
    renderPubAnexos();

    // Seção de anexos
    const anexoSection = document.getElementById('pub-anexo-section');
    const reqLabel     = document.getElementById('pub-anexo-req-label');
    if (anexoSection) {
      anexoSection.style.display = '';
      if (reqLabel) reqLabel.style.display = t.anexoObrigatorio ? '' : 'none';
    }

    // Checklists separados — Geral (rotina) e da Tarefa, ambos exibidos se existirem
    const section = document.getElementById('pub-checklist-section');
    const tarefaChecklist = t.checklistTarefa || [];
    const rotinaChecklist = rotina?.checklist || [];
    const allItems = [...rotinaChecklist, ...tarefaChecklist]; // todos para validação

    if (allItems.length > 0) {
      section.style.display = '';
      let html = '';
      if (rotinaChecklist.length > 0) {
        html += `<div class="form-section-title" style="margin-bottom:6px;margin-top:0;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 11 12 14 22 4"/></svg>
          Checklist Geral — marque todos os itens
        </div>`;
        html += rotinaChecklist.map(it => `
          <div class="pub-check-item" id="pcheck-${it.id}" onclick="togglePubCheck('${it.id}', ${allItems.length})">
            <div class="pub-check-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg></div>
            <span class="pub-check-text">${it.texto}</span>
          </div>`).join('');
      }
      if (tarefaChecklist.length > 0) {
        html += `<div class="form-section-title" style="margin-bottom:6px;margin-top:${rotinaChecklist.length > 0 ? '14px' : '0'};">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 11 12 14 22 4"/></svg>
          Checklist da Tarefa — marque todos os itens
        </div>`;
        html += tarefaChecklist.map(it => `
          <div class="pub-check-item" id="pcheck-${it.id}" onclick="togglePubCheck('${it.id}', ${allItems.length})">
            <div class="pub-check-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg></div>
            <span class="pub-check-text">${it.texto}</span>
          </div>`).join('');
      }
      document.getElementById('pub-checklist').innerHTML = html;
      updatePubProgress(allItems.length);
    } else {
      section.style.display = 'none';
    }

    closeModal('modal-tarefa-detalhe');
    openModal('modal-publicar');
  }

  function togglePubCheck(itemId, total) {
    pubChecklistState[itemId] = !pubChecklistState[itemId];
    const el = document.getElementById('pcheck-' + itemId);
    el.classList.toggle('checked', !!pubChecklistState[itemId]);
    updatePubProgress(total);
  }

  function updatePubProgress(total) {
    const done = Object.values(pubChecklistState).filter(Boolean).length;
    document.getElementById('pub-progress-label').textContent = `${done} / ${total} itens marcados`;
    document.getElementById('pub-progress-bar').style.width = total > 0 ? `${(done/total)*100}%` : '0%';
  }

  function publicarTarefa() {
    const t = state.tarefas.find(t => t.id === tarefaDetalheId);
    if (!t) return;
    const rotina = state.rotinas.find(r => r.id === t.rotinaId);
    const dataPub = document.getElementById('pub-data-realizada').value;
    const horaPub = document.getElementById('pub-hora-realizada').value;

    if (!dataPub) { showToast('Informe a data de realização.', 'error'); return; }
    if (!horaPub) { showToast('Informe a hora de realização.', 'error'); return; }
    const dataRealizada = buildDataRealizada(dataPub, horaPub);
    const dataRealizadaDate = parseDataRealizada(dataRealizada).date;

    // Valida obrigatoriedade de anexo
    if (t.anexoObrigatorio && pubAnexos.length === 0) {
      showToast('Adicione pelo menos 1 anexo para publicar esta tarefa.', 'error'); return;
    }

    // Valida ambos os checklists separadamente
    const tarefaChecklist = t.checklistTarefa || [];
    const rotinaChecklist = rotina?.checklist || [];
    const checkItems = [...rotinaChecklist, ...tarefaChecklist];
    if (checkItems.length > 0) {
      const allChecked = checkItems.every(it => pubChecklistState[it.id]);
      if (!allChecked) { showToast('Marque todos os itens do checklist para publicar.', 'error'); return; }
    }

    const pub = {
      id: uid(),
      tarefaId: tarefaDetalheId,
      dataRealizada,
      dataPublicacao: new Date().toISOString().split('T')[0],
      checklistMarcado: checkItems.map(it => it.id),
      notas: document.getElementById('pub-notas').value.trim(),
      anexos: pubAnexos.slice()
    };
    state.publicacoes.push(pub);

    // Atualiza próxima data da tarefa baseado na data realizada
    const novaProxima = calcProximaData(dataRealizadaDate, rotina);
    const tIdx = state.tarefas.findIndex(tt => tt.id === tarefaDetalheId);
    if (tIdx >= 0) {
      state.tarefas[tIdx].proximaData = novaProxima;
      state.tarefas[tIdx].dataTarefa  = dataRealizadaDate;

      // Auto-inativar ao atingir o número de repetições
      if (rotina.repetir === 'Por') {
        const nPubs = state.publicacoes.filter(p => p.tarefaId === tarefaDetalheId).length;
        if (nPubs >= rotina.vezes) {
          state.tarefas[tIdx].status = 'Inativo';
          state.tarefas[tIdx].autoInativada = true;
        }
      }
    }

    closeModal('modal-publicar');
    saveState();

    const autoInativ = state.tarefas[tIdx]?.autoInativada;
    if (autoInativ) {
      showToast(`Rotina concluída! Tarefa inativada após ${rotina.vezes} publicação(ões).`, 'info');
    } else {
      showToast('Tarefa publicada com sucesso!', 'success');
    }
  }

  // ══════════════════════════════════════════
  // ── HISTÓRICO ──
  // ══════════════════════════════════════════
  function openHistoricoModal(tarefaId) {
    const t = state.tarefas.find(t => t.id === tarefaId);
    const rotina = t ? state.rotinas.find(r => r.id === t.rotinaId) : null;
    document.getElementById('historico-title').textContent =
      rotina ? `Histórico — ${rotina.nome}` : 'Histórico de Publicações';
    renderHistoricoTable(tarefaId);
    openModal('modal-historico');
  }

  let _historicoTarefaId = null;

  function renderHistoricoTable(tarefaId) {
    _historicoTarefaId = tarefaId;
    const tbody = document.getElementById('historico-tbody');
    const pubs  = state.publicacoes.filter(p => p.tarefaId === tarefaId)
      .sort((a, b) => dataRealizadaSortKey(b).localeCompare(dataRealizadaSortKey(a)));

    if (pubs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="data-table-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <strong>Nenhuma publicação registrada</strong>
        <p>Publique a tarefa para registrar o histórico</p>
      </div></td></tr>`;
      return;
    }

    tbody.innerHTML = pubs.map(p => {
      const nCheck = p.checklistMarcado?.length || 0;
      const checkStr = nCheck > 0 ? `<span class="chip chip-green">${nCheck} item${nCheck>1?'s':''}</span>` : '<span style="color:var(--text-muted)">—</span>';
      return `<tr class="historico-pub-row" onclick="viewPublicacao('${p.id}')">
        <td style="font-weight:600;">${formatDataRealizadaHtml(p.dataRealizada)}</td>
        <td style="font-size:12px;color:var(--text-muted);">${formatDate(p.dataPublicacao)}</td>
        <td>${checkStr}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:var(--text-secondary);">${p.notas || '<span style="color:var(--text-muted)">—</span>'}</td>
        <td onclick="event.stopPropagation();" style="white-space:nowrap;">
          <button class="btn btn-outline btn-icon" onclick="abrirEditarPublicacao('${p.id}')" title="Editar" style="padding:5px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:13px;height:13px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
          </button>
          <button class="btn btn-outline btn-icon" onclick="excluirPublicacao('${p.id}')" title="Excluir" style="padding:5px;color:var(--red);border-color:rgba(230,57,70,0.3);margin-left:4px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:13px;height:13px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>
        </td>
      </tr>`;
    }).join('');
  }

  let _editPubAnexos = [];

  function _renderEditPubAnexos() {
    const list = document.getElementById('edit-pub-anexo-list');
    if (!list) return;
    if (_editPubAnexos.length === 0) { list.innerHTML = ''; return; }
    list.innerHTML = _editPubAnexos.map((a, i) => `
      <div class="anexo-item">
        <div class="anexo-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${a.titulo}</div>
          <a class="anexo-link" href="${a.url}" target="_blank" style="font-size:11px;">${a.url}</a>
        </div>
        <button class="anexo-del" onclick="_removeEditPubAnexo(${i})" title="Remover">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`).join('');
  }

  function addEditPubAnexo() {
    const titulo = document.getElementById('edit-pub-anexo-titulo').value.trim() || `Anexo ${_editPubAnexos.length + 1}`;
    const url    = document.getElementById('edit-pub-anexo-url').value.trim();
    if (!url) { showToast('Informe o link do anexo.', 'error'); return; }
    _editPubAnexos.push({ titulo, url });
    document.getElementById('edit-pub-anexo-titulo').value = '';
    document.getElementById('edit-pub-anexo-url').value = '';
    _renderEditPubAnexos();
  }

  function _removeEditPubAnexo(idx) {
    _editPubAnexos.splice(idx, 1);
    _renderEditPubAnexos();
  }

  function abrirEditarPublicacao(pubId) {
    const p = state.publicacoes.find(p => p.id === pubId);
    if (!p) return;
    const { date, time } = parseDataRealizada(p.dataRealizada);
    document.getElementById('edit-pub-id').value   = pubId;
    document.getElementById('edit-pub-data').value = date;
    document.getElementById('edit-pub-hora').value = time || '00:00';
    document.getElementById('edit-pub-notas').value = p.notas || '';
    // Carrega anexos existentes — normaliza formato legado
    _editPubAnexos = (p.anexos || []).map((a, i) =>
      typeof a === 'string' ? { titulo: `Anexo ${i + 1}`, url: a } : { ...a }
    );
    document.getElementById('edit-pub-anexo-titulo').value = '';
    document.getElementById('edit-pub-anexo-url').value = '';
    _renderEditPubAnexos();
    openModal('modal-editar-pub');
  }

  function salvarEdicaoPublicacao() {
    const pubId = document.getElementById('edit-pub-id').value;
    const data  = document.getElementById('edit-pub-data').value;
    const hora  = document.getElementById('edit-pub-hora').value;
    const notas = document.getElementById('edit-pub-notas').value.trim();
    if (!data) { showToast('Informe a data de realização.', 'error'); return; }
    if (!hora) { showToast('Informe a hora de realização.', 'error'); return; }
    const idx = state.publicacoes.findIndex(p => p.id === pubId);
    if (idx < 0) return;
    state.publicacoes[idx].dataRealizada = buildDataRealizada(data, hora);
    state.publicacoes[idx].notas = notas;
    state.publicacoes[idx].anexos = _editPubAnexos.slice();
    saveState();
    closeModal('modal-editar-pub');
    showToast('Publicação atualizada!', 'success');
  }

  function excluirPublicacao(pubId) {
    if (!confirm('Excluir este registro de publicação?')) return;
    const p = state.publicacoes.find(p => p.id === pubId);
    state.publicacoes = state.publicacoes.filter(p => p.id !== pubId);

    // Se a tarefa estava auto-inativada e agora tem menos publicações, permitir reativação
    if (p) {
      const t = state.tarefas.find(t => t.id === p.tarefaId);
      if (t?.autoInativada) {
        const rotina = state.rotinas.find(r => r.id === t.rotinaId);
        const nPubs = state.publicacoes.filter(pp => pp.tarefaId === t.id).length;
        if (rotina && nPubs < rotina.vezes) {
          const tIdx = state.tarefas.findIndex(tt => tt.id === t.id);
          state.tarefas[tIdx].autoInativada = false;
          state.tarefas[tIdx].status = 'Ativo';
        }
      }
    }

    saveState();
    showToast('Publicação excluída.', 'success');
  }

  function viewPublicacao(pubId) {
    const p = state.publicacoes.find(p => p.id === pubId);
    if (!p) return;
    const t = state.tarefas.find(t => t.id === p.tarefaId);
    const rotina = t ? state.rotinas.find(r => r.id === t.rotinaId) : null;
    const rotinaChecklist  = rotina?.checklist || [];
    const tarefaChecklist  = t?.checklistTarefa || [];

    function checkListHtml(items, label) {
      if (!items.length) return '';
      return `<div style="margin-top:14px;">
        <div class="form-section-title" style="margin-bottom:8px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/></svg>
          ${label}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${items.map(it => `
            <div class="pub-check-item checked" style="cursor:default;">
              <div class="pub-check-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg></div>
              <span class="pub-check-text">${it.texto}</span>
            </div>`).join('')}
        </div>
      </div>`;
    }

    // Normaliza anexos: suporte a formato novo {titulo,url} e legado (string)
    const anexosNorm = (p.anexos || []).map((a, i) =>
      typeof a === 'string' ? { titulo: `Anexo ${i + 1}`, url: a } : a
    );

    const anexosHtml = anexosNorm.length > 0 ? `
      <div style="margin-top:16px;">
        <div class="form-section-title" style="margin-bottom:10px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
          Anexos (${anexosNorm.length})
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;">
          ${anexosNorm.map(a => `
            <a href="${a.url}" target="_blank" title="${a.url}" style="text-decoration:none;display:block;">
              <div style="background:var(--bg-card);border:1.5px solid rgba(230,57,70,0.22);border-radius:12px;padding:14px 10px 12px;display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;transition:transform 0.18s,box-shadow 0.18s,border-color 0.18s,background 0.18s;"
                   onmouseover="this.style.borderColor='rgba(230,57,70,0.6)';this.style.background='rgba(230,57,70,0.05)';this.style.transform='translateY(-3px)';this.style.boxShadow='0 6px 18px rgba(230,57,70,0.15)'"
                   onmouseout="this.style.borderColor='rgba(230,57,70,0.22)';this.style.background='var(--bg-card)';this.style.transform='';this.style.boxShadow=''">
                <div style="width:46px;height:54px;border-radius:9px;background:rgba(230,57,70,0.09);border:1.5px solid rgba(230,57,70,0.28);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#e63946" stroke-width="1.8" stroke-linecap="round" style="width:22px;height:22px;">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <span style="font-size:7px;font-weight:900;color:#e63946;letter-spacing:1px;">PDF</span>
                </div>
                <span style="font-size:12px;font-weight:600;color:var(--text-primary);text-align:center;word-break:break-word;line-height:1.35;width:100%;">${a.titulo}</span>
              </div>
            </a>`).join('')}
        </div>
      </div>` : '';

    document.getElementById('pub-view-subtitle').textContent =
      `Realizada em ${formatDataRealizadaText(p.dataRealizada)} · Publicada em ${formatDate(p.dataPublicacao)}`;

    const ativo = t ? state.ativos[t.equipamentoIdx] : null;

    document.getElementById('pub-view-body').innerHTML = `
      <div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap;">
        <div style="flex:1;min-width:220px;">
          <div class="form-section-title" style="margin-bottom:8px;">Ativo</div>
          <div style="background:var(--bg);border:1.2px solid var(--border);border-radius:8px;padding:12px;">
            <div style="font-weight:700;font-size:15px;color:var(--text-primary);">${ativo?.nome || '—'}</div>
            <div style="font-size:13px;color:var(--text-muted);margin-top:6px;">Código: ${ativo?.codigo || '—'}</div>
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
              <span class="chip chip-gray" style="font-size:11px;">Setor: ${ativo?.setor || '—'}</span>
              <span class="chip chip-gray" style="font-size:11px;">Categoria: ${ativo?.categoria || '—'}</span>
            </div>
          </div>
        </div>
        <div style="flex:1;min-width:220px;">
          <div class="form-section-title" style="margin-bottom:8px;">Rotina</div>
          <div style="background:var(--bg);border:1.2px solid var(--border);border-radius:8px;padding:12px;">
            <div style="font-weight:700;font-size:15px;color:var(--text-primary);">${rotina?.nome || '—'}</div>
            <div style="font-size:13px;color:var(--text-muted);margin-top:6px;">Tipo: ${rotina?.tipo || '—'}</div>
            <div style="font-size:13px;color:var(--text-muted);margin-top:4px;">Frequência: A cada ${rotina?.fazerCada || '—'} ${rotina?.frequencia || '—'}</div>
            <div style="font-size:13px;color:var(--text-muted);margin-top:4px;">Repetir: ${rotina?.repetir === 'Por' ? (rotina?.vezes || '—') + 'x' : (rotina?.repetir || 'Sempre')}</div>
          </div>
        </div>
      </div>

      <div style="margin-top:14px;" class="view-hero">
        <div class="view-hero-name">Execução</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">Tarefa: ${getTarefaLabel(t)}</div>
        <div class="view-badges" style="margin-top:8px;">
          <span class="view-badge">Realizada: ${formatDataRealizadaText(p.dataRealizada)}</span>
          <span class="view-badge">Publicada: ${formatDate(p.dataPublicacao)}</span>
        </div>
      </div>

      ${checkListHtml(rotinaChecklist, 'Checklist Geral Verificado')}
      ${checkListHtml(tarefaChecklist, 'Checklist da Tarefa Verificado')}
      ${anexosHtml}
      ${p.notas ? `
        <div class="detail-note" style="margin-top:14px;">
          <div class="detail-label" style="margin-bottom:6px;">Observações</div>
          <div style="font-size:13px;color:var(--text-secondary);white-space:pre-line;">${p.notas}</div>
        </div>` : ''}`;

    openModal('modal-pub-view');
  }

  // ══════════════════════════════════════════
  // ── TABELA DE ATIVIDADES ──
  // ══════════════════════════════════════════
  function renderAtividadesTable() {
    const tbody = document.getElementById('atividades-tbody');
    if (!tbody) return;

    const fAtivoIdx = state._ativoFiltroAtividadesIdx ?? null;
    const pubs = state.publicacoes
      .slice()
      .sort((a, b) => dataRealizadaSortKey(b).localeCompare(dataRealizadaSortKey(a)))
      .filter(p => {
        if (fAtivoIdx === null) return true;
        const t = state.tarefas.find(t => t.id === p.tarefaId);
        return t && t.equipamentoIdx === fAtivoIdx;
      });

    if (pubs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="data-table-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        <strong>Nenhuma atividade encontrada</strong>
        <p>Ajuste o filtro ou publique tarefas para ver atividades</p>
      </div></td></tr>`;
      return;
    }

    tbody.innerHTML = pubs.map(p => {
      const t      = state.tarefas.find(t => t.id === p.tarefaId);
      const rotina = t ? state.rotinas.find(r => r.id === t.rotinaId) : null;
      const ativo  = t ? state.ativos[t.equipamentoIdx] : null;
      return `<tr onclick="viewPublicacao('${p.id}')">
        <td style="font-weight:700;color:var(--text-primary);">${formatDataRealizadaHtml(p.dataRealizada)}</td>
        <td>
          <div style="font-weight:600;">Rotina: ${rotina?.nome || '—'}</div>
          <div style="font-size:11px;color:var(--text-muted);">${rotina?.tipo || ''}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Tarefa: ${getTarefaLabel(t)}</div>
        </td>
        <td>
          <div style="font-weight:500;">${ativo?.nome || '—'}</div>
          <div style="font-size:11px;color:var(--text-muted);font-family:'DM Mono',monospace;">${ativo?.codigo || ''}</div>
        </td>
        <td><span class="chip chip-gray">${ativo?.setor || '—'}</span></td>
        <td><span class="chip chip-gray">${ativo?.categoria || '—'}</span></td>
        <td style="font-size:12px;color:var(--text-muted);">${formatDate(p.dataPublicacao)}</td>
        <td onclick="event.stopPropagation();" style="white-space:nowrap;">
          <button class="btn btn-outline btn-icon" onclick="abrirEditarPublicacao('${p.id}')" title="Editar" style="padding:5px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:13px;height:13px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
          </button>
          <button class="btn btn-outline btn-icon" onclick="excluirPublicacao('${p.id}')" title="Excluir" style="padding:5px;color:var(--red);border-color:rgba(230,57,70,0.3);margin-left:4px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:13px;height:13px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>
        </td>
      </tr>`;
    }).join('');
  }

  // ══════════════════════════════════════════
  // ── FILTROS DE STATUS ──
  // ══════════════════════════════════════════
  let _rotinaStatusFilter = 'ativo';
  let _tarefaStatusFilter = 'ativo';
  let _rvTarefaStatusFilter = 'ativo';
  let _avTarefaStatusFilter = 'ativo';
  let _avRotinaStatusFilter = 'ativo';

  function getTarefaStatusFilter(ctx) {
    if (ctx === 'rv') return _rvTarefaStatusFilter;
    if (ctx === 'av') return _avTarefaStatusFilter;
    return _tarefaStatusFilter;
  }

  function getRotinaStatusFilter(ctx) {
    if (ctx === 'av') return _avRotinaStatusFilter;
    return _rotinaStatusFilter;
  }

  function rotinaPassesStatusFilter(r, ctx) {
    const f = getRotinaStatusFilter(ctx);
    const rStatus = r.status || 'Ativo';
    if (f === 'ativo' && rStatus !== 'Ativo') return false;
    if (f === 'inativo' && rStatus !== 'Inativo') return false;
    return true;
  }

  function tarefaPassesStatusFilter(t, ctx) {
    const f = getTarefaStatusFilter(ctx);
    const tStatus = t.status || 'Ativo';
    if (f === 'ativo' && tStatus !== 'Ativo') return false;
    if (f === 'inativo' && tStatus !== 'Inativo') return false;
    return true;
  }

  function setRotinaStatusFilter(val) {
    _rotinaStatusFilter = val;
    ['ativo','inativo','ambos'].forEach(v => {
      const btn = document.getElementById('sfbtn-rotina-' + v);
      if (!btn) return;
      btn.className = 'status-filter-btn' + (v === val ? (v === 'ativo' ? ' active active-green' : v === 'inativo' ? ' active active-gray' : ' active') : '');
    });
    renderRotinasTable();
    updateNotifBadge();
  }

  function setAtivoRotinaStatusFilter(val) {
    _avRotinaStatusFilter = val;
    ['ativo', 'inativo', 'ambos'].forEach(v => {
      const btn = document.getElementById('sfbtn-av-rotina-' + v);
      if (!btn) return;
      btn.className = 'status-filter-btn' + (v === val
        ? (v === 'ativo' ? ' active active-green' : v === 'inativo' ? ' active active-gray' : ' active')
        : '');
    });
    _renderAtivoRotinas();
  }

  function setTarefaStatusFilter(ctx, val) {
    if (ctx === 'rv') _rvTarefaStatusFilter = val;
    else if (ctx === 'av') _avTarefaStatusFilter = val;
    else _tarefaStatusFilter = val;

    const prefix = ctx === 'rv' ? 'sfbtn-rv-tarefa' : ctx === 'av' ? 'sfbtn-av-tarefa' : 'sfbtn-tarefa';
    ['ativo', 'inativo', 'ambos'].forEach(v => {
      const btn = document.getElementById(prefix + '-' + v);
      if (!btn) return;
      btn.className = 'status-filter-btn' + (v === val
        ? (v === 'ativo' ? ' active active-green' : v === 'inativo' ? ' active active-gray' : ' active')
        : '');
    });

    if (ctx === 'rv') renderRotinaViewTarefas();
    else if (ctx === 'av') _renderAtivoTarefas();
    else renderTarefasTable();
    updateNotifBadge();
  }

  // ── ALERTAS POR ROTINA ──
  function getRotinaAlerts(rotinaId) {
    const tarefas = state.tarefas.filter(t => t.rotinaId === rotinaId && t.status === 'Ativo');
    let danger = 0, warning = 0;
    tarefas.forEach(t => {
      const f = getTaskFlag(t);
      if (f.cls === 'flag-danger')  danger++;
      else if (f.cls === 'flag-warning') warning++;
    });
    return { danger, warning, total: danger + warning };
  }

  // ══════════════════════════════════════════
  // ── RENDER TABELA DE ROTINAS ──
  // ══════════════════════════════════════════
  function renderRotinasTable() {
    const tbody = document.getElementById('rotinas-tbody');
    if (!tbody) return;
    const fTipo   = document.getElementById('filter-tipo')?.value || '';
    const fSetor  = document.getElementById('filter-setor-rotina')?.value || '';
    const fCat    = document.getElementById('filter-cat-rotina')?.value || '';
    const fAtivoIdx = state._ativoFiltroIdx ?? null;

    const list = state.rotinas.filter(r => {
      const ativo = state.ativos[r.equipamentoIdx];
      if (!ativo) return false;
      if (fAtivoIdx !== null && r.equipamentoIdx !== fAtivoIdx) return false;
      if (fTipo && r.tipo !== fTipo) return false;
      if (fSetor && ativo.setor !== fSetor) return false;
      if (fCat && ativo.categoria !== fCat) return false;
      // Filtro de status
      const rStatus = r.status || 'Ativo';
      if (_rotinaStatusFilter === 'ativo' && rStatus !== 'Ativo') return false;
      if (_rotinaStatusFilter === 'inativo' && rStatus !== 'Inativo') return false;
      return true;
    });

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="data-table-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <strong>Nenhuma rotina encontrada</strong>
        <p>Ajuste os filtros ou cadastre uma nova rotina com o botão "+"</p>
      </div></td></tr>`;
      return;
    }

    const tipoCls = { Preventivo:'chip-blue', Rotina:'chip-cyan' };

    tbody.innerHTML = list.map(r => {
      const ativo     = state.ativos[r.equipamentoIdx];
      const freq      = `A cada ${r.fazerCada} ${r.frequencia}`;
      const clChip    = tipoCls[r.tipo] || 'chip-gray';
      const nItems    = r.checklist?.length || 0;
      const isInativo = r.status === 'Inativo';
      const alerts    = getRotinaAlerts(r.id);

      let alertBadge = '';
      if (!isInativo && alerts.total > 0) {
        const cls  = alerts.danger > 0 ? 'flag-danger' : 'flag-warning';
        const icon = alerts.danger > 0
          ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px;flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px;flex-shrink:0;"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>`;
        const tip  = [alerts.danger > 0 ? `${alerts.danger} vencida(s)` : '', alerts.warning > 0 ? `${alerts.warning} próxima(s)` : ''].filter(Boolean).join(', ');
        alertBadge = `<span class="task-flag ${cls}" style="font-size:10px;padding:2px 7px;margin-left:6px;" title="${tip}">${icon}${alerts.total}</span>`;
      }

      return `<tr onclick="viewRotina('${r.id}')" style="${isInativo ? 'opacity:0.6;' : ''}">
        <td>
          <div style="display:flex;align-items:center;">
            <strong style="font-weight:600;">${r.nome}</strong>
            ${isInativo ? '<span class="chip chip-gray" style="margin-left:6px;font-size:10px;">Inativa</span>' : alertBadge}
          </div>
        </td>
        <td>
          <div style="font-weight:500;">${ativo?.nome || '—'}</div>
          <div style="font-size:11px;color:var(--text-muted);font-family:'DM Mono',monospace;">${ativo?.codigo || ''}</div>
        </td>
        <td><span class="chip ${clChip}">${r.tipo}</span></td>
        <td><span class="chip chip-gray">${ativo?.setor || '—'}</span></td>
        <td><span class="chip chip-gray">${ativo?.categoria || '—'}</span></td>
        <td style="font-size:12.5px;">${freq}</td>
        <td>${nItems > 0
          ? `<span class="chip chip-green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;"><polyline points="9 11 12 14 22 4"/></svg>${nItems} item${nItems>1?'s':''}</span>`
          : '<span style="color:var(--text-muted);font-size:12px;">—</span>'}</td>
      </tr>`;
    }).join('');
    updateNotifBadge();
  }

  // ── ATIVO SELECIONADO COMO FILTRO ──
  let _ativoFiltroNome = null;
  function setAtivoFiltro(idx) {
    state._ativoFiltroIdx = idx;
    const ativo = state.ativos[idx];
    _ativoFiltroNome = ativo?.nome || null;
    const display = document.getElementById('ativo-selector-display');
    if (display) {
      if (ativo) {
        display.innerHTML = `<div class="ativo-selecionado-chip" onclick="limparAtivoFiltro()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><path d="M20 16V7a2 2 0 00-2-2H6a2 2 0 00-2 2v9"/></svg>
          ${ativo.nome}
          <span class="chip-x" title="Limpar">&times;</span>
        </div>`;
      } else {
        display.innerHTML = `<button class="btn-select-ativo" onclick="openAtivoSelectorModal()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Selecionar Ativo
        </button>`;
      }
    }
    // Ocultar filtros de setor/categoria quando um ativo está selecionado
    const setorEl = document.getElementById('filter-setor-rotina');
    const catEl   = document.getElementById('filter-cat-rotina');
    if (setorEl) setorEl.style.display = ativo ? 'none' : '';
    if (catEl)   catEl.style.display   = ativo ? 'none' : '';
    renderRotinasTable();
    updateNotifBadge();
    closeModal('modal-ativo-selector');
  }
  function limparAtivoFiltro() { setAtivoFiltro(undefined); state._ativoFiltroIdx = null; updateNotifBadge(); }

  // ── ATIVO FILTRO TAREFAS ──
  function setAtivoFiltroTarefas(idx) {
    state._ativoFiltroTarefasIdx = (idx !== undefined) ? idx : null;
    const ativo = idx !== undefined ? state.ativos[idx] : null;
    const display = document.getElementById('ativo-selector-display-tarefas');
    if (display) {
      if (ativo) {
        display.innerHTML = `<div class="ativo-selecionado-chip" onclick="limparAtivoFiltroTarefas()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><path d="M20 16V7a2 2 0 00-2-2H6a2 2 0 00-2 2v9"/></svg>
          ${ativo.nome}
          <span class="chip-x" title="Limpar">&times;</span>
        </div>`;
      } else {
        display.innerHTML = `<button class="btn-select-ativo" onclick="openAtivoSelectorCtx('tarefas')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Filtrar por Ativo
        </button>`;
      }
    }
    renderTarefasTable();
    updateNotifBadge();
    closeModal('modal-ativo-selector');
  }
  function limparAtivoFiltroTarefas() { setAtivoFiltroTarefas(undefined); updateNotifBadge(); }

  // ── ATIVO FILTRO ATIVIDADES ──
  function setAtivoFiltroAtividades(idx) {
    state._ativoFiltroAtividadesIdx = (idx !== undefined) ? idx : null;
    const ativo = idx !== undefined ? state.ativos[idx] : null;
    const display = document.getElementById('ativo-selector-display-atividades');
    if (display) {
      if (ativo) {
        display.innerHTML = `<div class="ativo-selecionado-chip" onclick="limparAtivoFiltroAtividades()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><path d="M20 16V7a2 2 0 00-2-2H6a2 2 0 00-2 2v9"/></svg>
          ${ativo.nome}
          <span class="chip-x" title="Limpar">&times;</span>
        </div>`;
      } else {
        display.innerHTML = `<button class="btn-select-ativo" onclick="openAtivoSelectorCtx('atividades')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Filtrar por Ativo
        </button>`;
      }
    }
    renderAtividadesTable();
    updateNotifBadge();
    closeModal('modal-ativo-selector');
  }
  function limparAtivoFiltroAtividades() { setAtivoFiltroAtividades(undefined); updateNotifBadge(); }

  // ── MODAL BUSCA DE ATIVO ──
  let _ativoSelectorCtx = 'rotinas';

  function openAtivoSelectorModal() { openAtivoSelectorCtx('rotinas'); }

  function openAtivoSelectorCtx(ctx) {
    _ativoSelectorCtx = ctx;
    document.getElementById('ativo-selector-search').value = '';
    renderAtivoSelectorList();
    openModal('modal-ativo-selector');
  }

  function renderAtivoSelectorList() {
    const q = document.getElementById('ativo-selector-search').value.toLowerCase();
    const container = document.getElementById('ativo-selector-list');
    const found = state.ativos
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => !q || a.nome.toLowerCase().includes(q) || a.codigo.toLowerCase().includes(q) || a.setor.toLowerCase().includes(q));

    if (found.length === 0) {
      container.innerHTML = `<div class="ativo-search-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        Nenhum ativo encontrado
      </div>`;
      return;
    }
    container.innerHTML = found.map(({ a, i }) => `
      <div class="ativo-search-card" onclick="selectAtivoCtx(${i})">
        <div class="ativo-search-card-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 16V7a2 2 0 00-2-2H6a2 2 0 00-2 2v9m16 0H4"/></svg>
        </div>
        <div>
          <div class="ativo-search-card-name">${a.nome}</div>
          <div class="ativo-search-card-meta">${a.codigo} &bull; ${a.setor} &bull; ${a.categoria}</div>
        </div>
      </div>`).join('');
  }

  function selectAtivoCtx(idx) {
    if (_ativoSelectorCtx === 'rotinas') setAtivoFiltro(idx);
    else if (_ativoSelectorCtx === 'tarefas') setAtivoFiltroTarefas(idx);
    else if (_ativoSelectorCtx === 'atividades') setAtivoFiltroAtividades(idx);
  }

  // ══════════════════════════════════════════
  // ── DRAWER DE ROTINA ──
  // ══════════════════════════════════════════
  let rotinaEdicaoId = null;
  let checklistTemp = [];

  function openRotinaDrawer(id = null) {
    rotinaEdicaoId = id;
    const editing = id ? state.rotinas.find(r => r.id === id) : null;
    checklistTemp = editing ? JSON.parse(JSON.stringify(editing.checklist || [])) : [];

    document.getElementById('drawer-rotina-title').textContent = id ? 'Editar Rotina' : 'Nova Rotina';
    document.getElementById('drawer-rotina-subtitle').textContent = id ? 'Altere os dados da rotina' : 'Preencha os dados da rotina de manutenção';
    document.getElementById('drawer-save-label').textContent = id ? 'Salvar Alterações' : 'Salvar Rotina';

    // Limpar / preencher campos
    const el = v => document.getElementById(v);
    if (!id) {
      el('rotina-nome').value = '';
      el('rotina-equip-input').value = '';
      el('rotina-tipo').value = '';
      el('rotina-fazer-cada').value = '';
      el('rotina-frequencia').value = 'Meses';
      el('rotina-repetir').value = 'Sempre';
      el('rotina-vezes').value = '';
      el('field-vezes').style.display = 'none';
      setRotinaEquipDisplay(null);
    } else {
      const r = editing;
      const ativo = state.ativos[r.equipamentoIdx];
      el('rotina-nome').value = r.nome;
      el('rotina-equip-input').value = ativo?.nome || '';
      el('rotina-tipo').value = r.tipo;
      el('rotina-fazer-cada').value = r.fazerCada;
      el('rotina-frequencia').value = r.frequencia;
      el('rotina-repetir').value = r.repetir;
      el('rotina-vezes').value = r.vezes || '';
      el('field-vezes').style.display = r.repetir === 'Por' ? '' : 'none';
      setRotinaEquipDisplay(r.equipamentoIdx);
      _selectedEquipIdx = r.equipamentoIdx;
    }

    populateTipoSelect();
    switchDrawerTab('operacao');
    renderChecklistBuilder();

    document.getElementById('right-drawer').classList.add('open');
    document.getElementById('drawer-backdrop').classList.add('open');
  }

  function closeRotinaDrawer() {
    document.getElementById('right-drawer').classList.remove('open');
    document.getElementById('drawer-backdrop').classList.remove('open');
    _selectedEquipIdx = null;
  }

  function switchDrawerTab(tab) {
    ['operacao','checklist'].forEach(t => {
      document.getElementById('dtab-' + t).classList.toggle('active', t === tab);
      document.getElementById('dtab-btn-' + t).classList.toggle('active', t === tab);
    });
  }

  function toggleVezesField() {
    const val = document.getElementById('rotina-repetir').value;
    document.getElementById('field-vezes').style.display = val === 'Por' ? '' : 'none';
  }

  // ── EQUIPMENT AUTOCOMPLETE ──
  let _selectedEquipIdx = null;

  function filterEquipAutocomplete() {
    const q = document.getElementById('rotina-equip-input').value.toLowerCase();
    const dd = document.getElementById('rotina-equip-dropdown');
    if (!q) { dd.innerHTML = ''; dd.classList.remove('open'); return; }
    const matches = state.ativos.map((a, i) => ({ a, i })).filter(({ a }) =>
      a.nome.toLowerCase().includes(q) || a.codigo.toLowerCase().includes(q));
    if (matches.length === 0) {
      dd.innerHTML = '<div class="autocomplete-empty">Nenhum equipamento encontrado</div>';
    } else {
      dd.innerHTML = matches.map(({ a, i }) => `
        <div class="autocomplete-opt" onclick="selectEquip(${i})">
          <div class="autocomplete-opt-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 16V7a2 2 0 00-2-2H6a2 2 0 00-2 2v9m16 0H4"/></svg>
          </div>
          <div>
            <div class="autocomplete-opt-name">${a.nome}</div>
            <div class="autocomplete-opt-meta">${a.codigo} &bull; ${a.setor} &bull; ${a.categoria}</div>
          </div>
        </div>`).join('');
    }
    dd.classList.add('open');
  }

  function selectEquip(idx) {
    _selectedEquipIdx = idx;
    const ativo = state.ativos[idx];
    document.getElementById('rotina-equip-input').value = ativo.nome;
    setRotinaEquipDisplay(idx);
    closeEquipDropdown();
  }

  function closeEquipDropdown() {
    document.getElementById('rotina-equip-dropdown')?.classList.remove('open');
  }

  function setRotinaEquipDisplay(idx) {
    const ativo = idx !== null && idx !== undefined ? state.ativos[idx] : null;
    const s = document.getElementById('rotina-setor-display');
    const c = document.getElementById('rotina-cat-display');
    if (ativo) {
      s.innerHTML = `<span class="read-field-badge">${ativo.setor}</span>`;
      c.innerHTML = `<span class="read-field-badge">${ativo.categoria}</span>`;
    } else {
      s.innerHTML = `<span class="read-field-placeholder">— automático —</span>`;
      c.innerHTML = `<span class="read-field-placeholder">— automático —</span>`;
    }
  }

  // ── SALVAR ROTINA ──
  function saveRotina() {
    const nome = document.getElementById('rotina-nome').value.trim();
    const tipo = document.getElementById('rotina-tipo').value;
    const fazerCada = parseInt(document.getElementById('rotina-fazer-cada').value);
    const frequencia = document.getElementById('rotina-frequencia').value;
    const repetir = document.getElementById('rotina-repetir').value;
    const vezes = repetir === 'Por' ? parseInt(document.getElementById('rotina-vezes').value) : null;

    if (!nome) { showToast('Informe o nome da rotina.', 'error'); return; }
    if (_selectedEquipIdx === null || _selectedEquipIdx === undefined) {
      const typed = document.getElementById('rotina-equip-input').value.trim().toLowerCase();
      const found = state.ativos.findIndex(a => a.nome.toLowerCase() === typed);
      if (found === -1) { showToast('Selecione um equipamento válido da lista.', 'error'); return; }
      _selectedEquipIdx = found;
    }
    if (!tipo) { showToast('Selecione o tipo da rotina.', 'error'); return; }
    if (!fazerCada || fazerCada < 1) { showToast('Informe o valor de "Fazer a cada".', 'error'); return; }
    if (repetir === 'Por' && (!vezes || vezes < 1)) { showToast('Informe a quantidade de vezes.', 'error'); return; }

    const rotinaExistente = rotinaEdicaoId ? state.rotinas.find(r => r.id === rotinaEdicaoId) : null;
    const rotina = {
      id: rotinaEdicaoId || uid(),
      nome, tipo, equipamentoIdx: _selectedEquipIdx,
      fazerCada, frequencia, repetir, vezes,
      checklist: checklistTemp.slice(),
      status: rotinaExistente?.status || 'Ativo'
    };

    if (rotinaEdicaoId) {
      const idx = state.rotinas.findIndex(r => r.id === rotinaEdicaoId);
      if (idx >= 0) {
        const antiga = state.rotinas[idx];
        const frequenciaAlterada =
          antiga.fazerCada !== rotina.fazerCada ||
          antiga.frequencia !== rotina.frequencia;

        state.rotinas[idx] = rotina;

        // Recalcula próxima data das tarefas vinculadas se a frequência mudou
        if (frequenciaAlterada) {
          let recalculadas = 0;
          state.tarefas.forEach((t, ti) => {
            if (t.rotinaId !== rotinaEdicaoId) return;
            if (!t.dataTarefa) return;
            const novaProxima = calcProximaData(t.dataTarefa, rotina);
            state.tarefas[ti] = { ...t, proximaData: novaProxima };
            recalculadas++;
          });
          if (recalculadas > 0) {
            showToast(`Rotina atualizada! Próxima data recalculada em ${recalculadas} tarefa${recalculadas > 1 ? 's' : ''}.`, 'success');
          } else {
            showToast('Rotina atualizada!', 'success');
          }
        } else {
          showToast('Rotina atualizada!', 'success');
        }
      }
    } else {
      state.rotinas.push(rotina);
      showToast('Rotina cadastrada!', 'success');
    }
    saveState();
    closeRotinaDrawer();
  }

  // ── CHECKLIST BUILDER ──
  function addChecklistItem() {
    const input = document.getElementById('checklist-novo-item');
    const texto = input.value.trim();
    if (!texto) return;
    checklistTemp.push({ id: uid(), texto });
    input.value = '';
    renderChecklistBuilder();
  }

  function removeChecklistItem(id) {
    checklistTemp = checklistTemp.filter(i => i.id !== id);
    renderChecklistBuilder();
  }

  function renderChecklistBuilder() {
    const container = document.getElementById('checklist-builder');
    const emptyMsg = document.getElementById('checklist-empty-msg');
    if (checklistTemp.length === 0) {
      container.innerHTML = `<div class="checklist-empty-tip" id="checklist-empty-msg">
        Nenhum item adicionado. O checklist é opcional — adicione itens acima.
      </div>`;
      return;
    }
    container.innerHTML = checklistTemp.map((item, i) => `
      <div class="checklist-item-row">
        <div class="checklist-item-num">${i + 1}</div>
        <div class="checklist-item-text">${item.texto}</div>
        <button class="checklist-item-del" onclick="removeChecklistItem('${item.id}')" title="Remover">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`).join('');
  }

  // ── TIPOS DE ROTINA ──
  function populateTipoSelect() {
    const sel = document.getElementById('rotina-tipo');
    const cur = sel.value;
    const filt = document.getElementById('filter-tipo');
    sel.innerHTML = `<option value="">Selecione...</option>` +
      state.tiposRotina.map(t => `<option value="${t}">${t}</option>`).join('');
    if (cur) sel.value = cur;
    filt.innerHTML = `<option value="">Tipo (Todos)</option>` +
      state.tiposRotina.map(t => `<option value="${t}">${t}</option>`).join('');
  }

  function openTipoModal() {
    renderTipoList();
    document.getElementById('input-novo-tipo').value = '';
    openModal('modal-tipo');
  }

  function renderTipoList() {
    const container = document.getElementById('tipo-list');
    const fixed = ['Preventivo', 'Rotina'];
    container.innerHTML = state.tiposRotina.map((t, i) => `
      <div class="list-item-row">
        <span class="list-item-name">${t}${fixed.includes(t) ? ' <span style="font-size:10px;color:var(--text-muted);">(padrão)</span>' : ''}</span>
        <span class="list-item-actions">
          ${!fixed.includes(t) ? `<button class="btn btn-outline btn-icon" onclick="removerTipo(${i})" style="color:var(--red);" title="Remover">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>` : ''}
        </span>
      </div>`).join('');
  }

  function salvarTipo() {
    const val = document.getElementById('input-novo-tipo').value.trim();
    if (!val || state.tiposRotina.includes(val)) return;
    state.tiposRotina.push(val);
    saveState();
    renderTipoList();
    populateTipoSelect();
    document.getElementById('input-novo-tipo').value = '';
  }

  function removerTipo(idx) {
    const fixed = ['Preventivo', 'Rotina'];
    if (fixed.includes(state.tiposRotina[idx])) return;
    state.tiposRotina.splice(idx, 1);
    saveState();
    renderTipoList();
    populateTipoSelect();
  }

  // ── VER / EDITAR / DELETAR ROTINA ──
  let rotinaViewId = null;

  function viewRotina(id) {
    rotinaViewId = id;
    switchRotinaViewTab('info');
    renderRotinaViewInfo();
    // Inicializa badge da aba Tarefas com contagem de alertas
    renderRotinaViewTarefas();
    switchRotinaViewTab('info'); // volta para info após renderizar tarefas
    openModal('modal-rotina-view');
  }

  function switchRotinaViewTab(tab) {
    ['info','tarefas','atividades'].forEach(t => {
      document.getElementById('rvtab-' + t).style.display = t === tab ? 'block' : 'none';
      document.getElementById('rvtab-btn-' + t).classList.toggle('active', t === tab);
    });
    if (tab === 'tarefas') renderRotinaViewTarefas();
    if (tab === 'atividades') renderRotinaViewAtividades();
  }

  function renderRotinaViewInfo() {
    const r = state.rotinas.find(r => r.id === rotinaViewId);
    if (!r) return;
    const ativo  = state.ativos[r.equipamentoIdx];
    const repStr = r.repetir === 'Por' ? `${r.vezes} vez(es)` : 'Sempre';
    const isInativo = r.status === 'Inativo';

    document.getElementById('rotina-view-title').textContent = r.nome;
    document.getElementById('rotina-view-subtitle').textContent = isInativo ? 'Rotina Inativa' : 'Informações completas';

    // Atualiza botão toggle
    const btnToggle = document.getElementById('btn-toggle-rotina');
    if (btnToggle) {
      if (isInativo) {
        btnToggle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:16px;height:16px;"><polygon points="5 3 19 12 5 21 5 3"/></svg> Ativar`;
        btnToggle.style.color = 'var(--green)';
        btnToggle.style.borderColor = 'rgba(42,157,143,0.4)';
      } else {
        btnToggle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:16px;height:16px;"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Inativar`;
        btnToggle.style.color = '';
        btnToggle.style.borderColor = '';
      }
    }

    document.getElementById('rotina-view-body').innerHTML = `
      <div class="view-hero">
        <div class="view-hero-name">${r.nome}</div>
        <div class="view-badges" style="margin-top:10px;">
          <span class="view-badge">${r.tipo}</span>
          <span class="view-badge">A cada ${r.fazerCada} ${r.frequencia}</span>
          <span class="view-badge">${repStr}</span>
          ${isInativo ? '<span class="view-badge" style="background:rgba(230,57,70,0.15);border-color:rgba(230,57,70,0.3);color:var(--red);">Inativa</span>' : ''}
        </div>
      </div>
      <div class="rotina-view-grid">
        <div class="detail-card"><div class="detail-label">Equipamento</div><div class="detail-value">${ativo?.nome||'—'}</div></div>
        <div class="detail-card"><div class="detail-label">Código</div><div class="detail-value" style="font-family:'DM Mono',monospace;">${ativo?.codigo||'—'}</div></div>
        <div class="detail-card"><div class="detail-label">Setor</div><div class="detail-value">${ativo?.setor||'—'}</div></div>
        <div class="detail-card"><div class="detail-label">Categoria</div><div class="detail-value">${ativo?.categoria||'—'}</div></div>
      </div>
      ${r.checklist?.length > 0 ? `
        <div style="margin-top:16px;">
          <div class="form-section-title" style="margin-bottom:10px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 11 12 14 22 4"/></svg>
            Checklist (${r.checklist.length} item${r.checklist.length>1?'s':''})
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${r.checklist.map((it,i) => `<div class="checklist-item-row" style="cursor:default;">
              <div class="checklist-item-num">${i+1}</div>
              <div class="checklist-item-text">${it.texto}</div>
            </div>`).join('')}
          </div>
        </div>` : ''}
    `;
  }

  function renderRotinaViewTarefas() {
    const container = document.getElementById('rotina-view-tarefas-list');
    const tarefas   = state.tarefas.filter(t => t.rotinaId === rotinaViewId && tarefaPassesStatusFilter(t, 'rv'));
    const alerts    = getRotinaAlerts(rotinaViewId);

    // Atualiza label da aba com badge de alertas
    const tabBtn = document.getElementById('rvtab-btn-tarefas');
    if (tabBtn) {
      const badgeHtml = alerts.total > 0
        ? ` <span style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 4px;border-radius:20px;font-size:10px;font-weight:700;background:${alerts.danger > 0 ? 'var(--red)' : 'var(--amber)'};color:#fff;margin-left:4px;">${alerts.total}</span>`
        : '';
      tabBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg> Tarefas${badgeHtml}`;
    }

    // Botão de adicionar tarefa para esta rotina
    const addBtnHtml = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
        <button class="btn btn-primary" style="font-size:12px;padding:7px 14px;" onclick="openTarefaDrawerParaRotina('${rotinaViewId}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:14px;height:14px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nova Tarefa
        </button>
      </div>`;

    if (tarefas.length === 0) {
      const filtro = getTarefaStatusFilter('rv');
      const msgFiltro = filtro !== 'ambos'
        ? '<p>Nenhuma tarefa com o filtro selecionado. Tente "Ambos".</p>'
        : '<p>Clique em "Nova Tarefa" acima para criar uma tarefa para esta rotina</p>';
      container.innerHTML = addBtnHtml + `<div class="data-table-empty" style="padding:24px 16px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        <strong>Nenhuma tarefa encontrada</strong>
        ${msgFiltro}
      </div>`;
      return;
    }

    // Cabeçalho resumo de alertas
    let summaryHtml = '';
    if (alerts.total > 0) {
      const parts = [];
      if (alerts.danger > 0)  parts.push(`<span class="task-flag flag-danger"  style="font-size:11px;padding:3px 10px;">${alerts.danger} vencida${alerts.danger > 1 ? 's' : ''}</span>`);
      if (alerts.warning > 0) parts.push(`<span class="task-flag flag-warning" style="font-size:11px;padding:3px 10px;">${alerts.warning} próxima${alerts.warning > 1 ? 's' : ''}</span>`);
      summaryHtml = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:10px 14px;background:rgba(230,57,70,0.05);border:1px solid rgba(230,57,70,0.15);border-radius:8px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span style="font-size:12px;font-weight:600;color:var(--text-primary);">${alerts.total} tarefa${alerts.total > 1 ? 's' : ''} com alerta</span>
        <div style="display:flex;gap:6px;margin-left:4px;">${parts.join('')}</div>
      </div>`;
    }

    const rotina = state.rotinas.find(r => r.id === rotinaViewId);
    container.innerHTML = addBtnHtml + summaryHtml + `<div style="display:flex;flex-direction:column;gap:8px;">` +
      tarefas.map(t => {
        const flag  = getTaskFlag(t);
        const ativo = state.ativos[t.equipamentoIdx];
        const nPubs = state.publicacoes.filter(p => p.tarefaId === t.id).length;
        const isAlert = flag.cls === 'flag-danger' || flag.cls === 'flag-warning';
        return `<div class="list-item-row" style="cursor:pointer;${isAlert ? 'border-left:3px solid ' + (flag.cls === 'flag-danger' ? 'var(--red)' : 'var(--amber)') + ';' : ''}" onclick="openTarefaDetalhe('${t.id}')">
          <div style="display:flex;flex-direction:column;gap:4px;flex:1;">
            <div style="font-weight:600;font-size:13px;">Rotina: ${rotina?.nome || '—'}</div>
            <div style="font-size:11px;color:var(--text-muted);">${ativo?.nome || '—'}${ativo?.codigo ? ' · ' + ativo.codigo : ''}</div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px;">
              <span class="task-flag ${flag.cls}" style="font-size:11px;">${flag.label}</span>
              <span style="font-size:12px;color:var(--text-muted);">Data: ${formatDate(t.dataTarefa)}</span>
              ${nPubs > 0 ? `<span class="chip chip-cyan" style="font-size:10px;">${nPubs} pub.</span>` : ''}
            </div>
            <div style="font-size:12px;color:var(--text-muted);">Próxima: ${t.proximaData ? formatDate(t.proximaData) : '—'}</div>
          </div>
          <span class="chip ${t.status === 'Ativo' ? 'chip-green' : 'chip-gray'}">${t.status}</span>
        </div>`;
      }).join('') + `</div>`;
  }

  function renderRotinaViewAtividades() {
    const container = document.getElementById('rotina-view-atividades-list');
    const tarefaIds = state.tarefas.filter(t => t.rotinaId === rotinaViewId).map(t => t.id);
    const rotina = state.rotinas.find(r => r.id === rotinaViewId);
    const pubs = state.publicacoes
      .filter(p => tarefaIds.includes(p.tarefaId))
      .sort((a, b) => dataRealizadaSortKey(b).localeCompare(dataRealizadaSortKey(a)));
    if (pubs.length === 0) {
      container.innerHTML = `<div class="data-table-empty" style="padding:32px 16px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        <strong>Nenhuma atividade registrada</strong>
        <p>As atividades aparecem após publicar tarefas desta rotina</p>
      </div>`;
      return;
    }
    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;">` +
      pubs.map(p => {
        const t = state.tarefas.find(t => t.id === p.tarefaId);
        return `
        <div class="list-item-row" style="cursor:pointer;" onclick="viewPublicacao('${p.id}')">
          <div style="display:flex;flex-direction:column;gap:3px;flex:1;">
            <div style="font-weight:600;font-size:13px;">Realizada: ${formatDataRealizadaHtml(p.dataRealizada)}</div>
            <div style="font-size:11px;color:var(--text-muted);">Rotina: ${rotina?.nome || '—'} · Tarefa: ${getTarefaLabel(t)}</div>
            <div style="font-size:11px;color:var(--text-muted);">Publicada em ${formatDate(p.dataPublicacao)}</div>
          </div>
          ${p.notas ? `<span style="font-size:12px;color:var(--text-secondary);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.notas}</span>` : ''}
        </div>`;
      }).join('') + `</div>`;
  }

  function toggleRotinaStatus() {
    const r = state.rotinas.find(r => r.id === rotinaViewId);
    if (!r) return;
    const novoStatus = r.status === 'Inativo' ? 'Ativo' : 'Inativo';
    r.status = novoStatus;
    saveState();
    showToast(`Rotina ${novoStatus === 'Inativo' ? 'inativada' : 'ativada'} com sucesso!`, 'success');
  }

  function editarRotinaAtual() {
    openRotinaDrawer(rotinaViewId);
  }

  function confirmarDeleteRotina() {
    if (!confirm('Excluir esta rotina? As tarefas vinculadas também serão removidas.')) return;
    state.rotinas = state.rotinas.filter(r => r.id !== rotinaViewId);
    state.tarefas = state.tarefas.filter(t => t.rotinaId !== rotinaViewId);
    saveState();
    closeModal('modal-rotina-view');
    renderRotinasTable();
  }

  // ── FILTROS DA ABA ROTINA ──
  function atualizarFiltrosRotina() {
    const setorOpts = state.setores.map(s => `<option value="${s}">${s}</option>`).join('');
    const catOpts = state.categorias.map(c => `<option value="${c}">${c}</option>`).join('');
    const fs = document.getElementById('filter-setor-rotina');
    const fc = document.getElementById('filter-cat-rotina');
    if (fs) fs.innerHTML = `<option value="">Setor (Todos)</option>` + setorOpts;
    if (fc) fc.innerHTML = `<option value="">Categoria (Todas)</option>` + catOpts;
  }

  function isAtivosFilterOpen() {
    return document.getElementById('ativos-filter-inline')?.classList.contains('open');
  }

  function openAtivosFilter() {
    const panel = document.getElementById('ativos-filter-inline');
    const btn   = document.getElementById('btn-ativos-filtro');
    panel?.classList.add('open');
    if (panel) panel.setAttribute('aria-hidden', 'false');
    btn?.classList.add('active');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }

  function closeAtivosFilter() {
    const panel = document.getElementById('ativos-filter-inline');
    const btn   = document.getElementById('btn-ativos-filtro');
    panel?.classList.remove('open');
    if (panel) panel.setAttribute('aria-hidden', 'true');
    btn?.classList.remove('active');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function toggleAtivosFilter() {
    if (isAtivosFilterOpen()) closeAtivosFilter();
    else openAtivosFilter();
  }

  function limparAtivosFiltros() {
    const cat = document.getElementById('main-category-filter');
    if (cat) cat.value = 'todas';
    renderCards();
    updateNotifBadge();
    updateAtivosFiltroBtn();
  }

  function updateAtivosFiltroBtn() {
    const btn = document.getElementById('btn-ativos-filtro');
    const cat = document.getElementById('main-category-filter');
    if (!btn || !cat) return;
    const hasFilter = cat.value !== 'todas';
    if (!isAtivosFilterOpen()) btn.classList.toggle('active', hasFilter);
  }

  // ── MODAIS ──
  function openModal(id) { document.getElementById(id)?.classList.add('open'); }
  function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

  let ativoEdicaoIndex = null;
  let setorEdicaoIndex = -1;
  let categoriaEdicaoIndex = -1;

  function openSetorModal(index = -1) {
    setorEdicaoIndex = index;
    renderSetorModal();
    openModal('modal-setor');
  }

  function openCategoriaModal(index = -1) {
    categoriaEdicaoIndex = index;
    renderCategoriaModal();
    openModal('modal-categoria');
  }

  function openAtivoModal(index = null) {
    ativoEdicaoIndex = index;
    document.getElementById('modal-ativo-title').textContent = index === null ? 'Novo Ativo' : 'Editar Ativo';
    document.querySelector('#modal-ativo .modal-subtitle').textContent = index === null ? 'Preencha os dados do equipamento' : 'Altere os dados do equipamento';

    if (index === null) {
      document.querySelectorAll('#modal-ativo input, #modal-ativo textarea').forEach(el => el.value = '');
      document.getElementById('ativo-setor').value = '';
      document.getElementById('ativo-categoria').value = '';
    } else {
      const ativo = state.ativos[index];
      document.getElementById('ativo-nome').value = ativo.nome;
      document.getElementById('ativo-codigo').value = ativo.codigo;
      document.getElementById('ativo-setor').value = ativo.setor;
      document.getElementById('ativo-categoria').value = ativo.categoria;
      document.getElementById('ativo-marca').value = ativo.marca !== '-' ? ativo.marca : '';
      document.getElementById('ativo-modelo').value = ativo.modelo !== '-' ? ativo.modelo : '';
      document.getElementById('ativo-serie').value = ativo.serie !== '-' ? ativo.serie : '';
      document.getElementById('ativo-fornecedor').value = ativo.fornecedor !== '-' ? ativo.fornecedor : '';
      document.getElementById('ativo-nota').value = ativo.nota;
    }

    openModal('modal-ativo');
  }

  function visualizarAtivo(index, initialTab = 'info') {
    ativoEdicaoIndex = index;
    const ativo = state.ativos[index];
    document.getElementById('visualizar-title').textContent = ativo.nome;
    document.getElementById('visualizar-subtitle').textContent = `${ativo.setor} · ${ativo.categoria}`;

    document.getElementById('visualizar-body').innerHTML = `
      <div class="view-hero">
        <div class="view-hero-name">${ativo.nome}</div>
        <div class="view-hero-code">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:12px;height:12px;"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          ${ativo.codigo}
        </div>
        <div class="view-badges">
          <span class="view-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:11px;height:11px;"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>${ativo.setor}</span>
          <span class="view-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:11px;height:11px;"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>${ativo.categoria}</span>
        </div>
      </div>
      <div class="detail-grid">
        <div class="detail-card"><div class="detail-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>Marca</div><div class="detail-value">${ativo.marca}</div></div>
        <div class="detail-card"><div class="detail-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/></svg>Modelo</div><div class="detail-value">${ativo.modelo}</div></div>
        <div class="detail-card"><div class="detail-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>Nº de Série</div><div class="detail-value">${ativo.serie}</div></div>
        <div class="detail-card"><div class="detail-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 16V7a2 2 0 00-2-2H6a2 2 0 00-2 2v9"/><path d="M16 21H8a2 2 0 01-2-2v-1h12v1a2 2 0 01-2 2z"/></svg>Fornecedor</div><div class="detail-value">${ativo.fornecedor}</div></div>
        <div class="detail-note"><div class="detail-label" style="margin-bottom:6px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:11px;height:11px;color:var(--cyan);"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>Observações</div>
          <div class="detail-value" style="font-weight:400;font-size:13px;color:var(--text-secondary);white-space:pre-line;">${ativo.nota || '<span style="color:var(--text-muted);font-style:italic;">Nenhuma observação cadastrada.</span>'}</div>
        </div>
      </div>`;

    // Atualiza badges das abas
    _atualizarBadgesAtivoTabs(index);
    switchAtivoTab(initialTab);
    openModal('modal-visualizar');
  }

  function _atualizarBadgesAtivoTabs(index) {
    // Rotinas e Atividades: apenas o nome, sem contagem
    const lbR = document.getElementById('avtab-label-rotinas');
    const lbA = document.getElementById('avtab-label-atividades');
    if (lbR) lbR.textContent = 'Rotinas';
    if (lbA) lbA.textContent = 'Atividades';

    // Tarefas: badge colorido apenas se houver tarefas vencidas ou próximas
    const tarefasAtivas = state.tarefas.filter(t => t.equipamentoIdx === index && t.status === 'Ativo');
    let danger = 0, warning = 0;
    tarefasAtivas.forEach(t => {
      const f = getTaskFlag(t);
      if (f.cls === 'flag-danger')       danger++;
      else if (f.cls === 'flag-warning') warning++;
    });
    const total = danger + warning;
    const lbT = document.getElementById('avtab-label-tarefas');
    if (!lbT) return;
    if (total > 0) {
      const cor = danger > 0 ? 'var(--red)' : 'var(--amber)';
      lbT.innerHTML = `Tarefas <span style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 4px;border-radius:20px;font-size:10px;font-weight:700;background:${cor};color:#fff;margin-left:4px;">${total}</span>`;
    } else {
      lbT.textContent = 'Tarefas';
    }
  }

  function switchAtivoTab(tab) {
    ['info','rotinas','tarefas','atividades'].forEach(t => {
      document.getElementById('avtab-' + t).style.display = t === tab ? 'block' : 'none';
      document.getElementById('avtab-btn-' + t).classList.toggle('active', t === tab);
    });
    if (tab === 'rotinas')    _renderAtivoRotinas();
    if (tab === 'tarefas')    _renderAtivoTarefas();
    if (tab === 'atividades') _renderAtivoAtividades();
  }

  function _renderAtivoRotinas() {
    const idx = ativoEdicaoIndex;
    const container = document.getElementById('ativo-rotinas-list');
    const filtro = getRotinaStatusFilter('av');
    const rotinas = state.rotinas.filter(r => r.equipamentoIdx === idx && rotinaPassesStatusFilter(r, 'av'));
    const addBtn = `<div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
      <button class="btn btn-primary" style="font-size:12px;padding:7px 14px;" onclick="openRotinaDrawerParaAtivo(${idx})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:14px;height:14px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nova Rotina
      </button>
    </div>`;
    if (rotinas.length === 0) {
      const msgFiltro = filtro !== 'ambos'
        ? '<p>Nenhuma rotina com o filtro selecionado. Tente "Ambos".</p>'
        : '<p>Clique em "Nova Rotina" para criar uma</p>';
      container.innerHTML = addBtn + `<div class="data-table-empty" style="padding:24px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg><strong>Nenhuma rotina vinculada</strong>${msgFiltro}</div>`;
      return;
    }
    const tipoCls = { Preventivo:'chip-blue', Rotina:'chip-cyan' };
    container.innerHTML = addBtn + `<div style="display:flex;flex-direction:column;gap:8px;">` +
      rotinas.map(r => {
        const isInativo = r.status === 'Inativo';
        const alerts = getRotinaAlerts(r.id);
        let badge = '';
        if (!isInativo && alerts.total > 0) {
          const cls = alerts.danger > 0 ? 'flag-danger' : 'flag-warning';
          badge = `<span class="task-flag ${cls}" style="font-size:10px;padding:2px 7px;margin-left:6px;">${alerts.total}</span>`;
        }
        return `<div class="list-item-row" style="cursor:pointer;${isInativo?'opacity:0.6;':''}" onclick="viewRotina('${r.id}')">
          <div style="flex:1;">
            <div style="display:flex;align-items:center;"><strong style="font-size:13px;">${r.nome}</strong>${badge}${isInativo?'<span class="chip chip-gray" style="margin-left:6px;font-size:10px;">Inativa</span>':''}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">A cada ${r.fazerCada} ${r.frequencia} · ${r.repetir === 'Por' ? r.vezes + 'x' : 'Sempre'}</div>
          </div>
          <span class="chip ${tipoCls[r.tipo]||'chip-gray'}">${r.tipo}</span>
        </div>`;
      }).join('') + `</div>`;
  }

  function _renderAtivoTarefas() {
    const idx = ativoEdicaoIndex;
    const container = document.getElementById('ativo-tarefas-list');
    const tarefas = state.tarefas.filter(t => t.equipamentoIdx === idx && tarefaPassesStatusFilter(t, 'av'));
    const addBtn = `<div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
      <button class="btn btn-primary" style="font-size:12px;padding:7px 14px;" onclick="openTarefaDrawerParaAtivo(${idx})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:14px;height:14px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nova Tarefa
      </button>
    </div>`;
    if (tarefas.length === 0) {
      const filtro = getTarefaStatusFilter('av');
      const msgFiltro = filtro !== 'ambos'
        ? '<p>Nenhuma tarefa com o filtro selecionado. Tente "Ambos".</p>'
        : '<p>Clique em "Nova Tarefa" para criar uma</p>';
      container.innerHTML = addBtn + `<div class="data-table-empty" style="padding:24px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg><strong>Nenhuma tarefa encontrada</strong>${msgFiltro}</div>`;
      return;
    }
    container.innerHTML = addBtn + `<div style="display:flex;flex-direction:column;gap:8px;">` +
      tarefas.map(t => {
        const rotina = state.rotinas.find(r => r.id === t.rotinaId);
        const flag   = getTaskFlag(t);
        const nPubs  = state.publicacoes.filter(p => p.tarefaId === t.id).length;
        return `<div class="list-item-row" style="cursor:pointer;" onclick="openTarefaDetalhe('${t.id}')">
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <strong style="font-size:13px;">Rotina: ${rotina?.nome || '—'}</strong>
              <span class="task-flag ${flag.cls}" style="font-size:11px;">${flag.label}</span>
              ${nPubs > 0 ? `<span class="chip chip-cyan" style="font-size:10px;">${nPubs} pub.</span>` : ''}
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Data: ${formatDate(t.dataTarefa)} · Próxima: ${t.proximaData ? formatDate(t.proximaData) : '—'}</div>
          </div>
          <span class="chip ${t.status==='Ativo'?'chip-green':'chip-gray'}">${t.status}</span>
        </div>`;
      }).join('') + `</div>`;
  }

  function _renderAtivoAtividades() {
    const idx = ativoEdicaoIndex;
    const container = document.getElementById('ativo-atividades-list');
    const tarefaIds = state.tarefas.filter(t => t.equipamentoIdx === idx).map(t => t.id);
    const pubs = state.publicacoes
      .filter(p => tarefaIds.includes(p.tarefaId))
      .sort((a, b) => dataRealizadaSortKey(b).localeCompare(dataRealizadaSortKey(a)));
    if (pubs.length === 0) {
      container.innerHTML = `<div class="data-table-empty" style="padding:24px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg><strong>Nenhuma atividade registrada</strong><p>As atividades aparecem após publicar tarefas deste ativo</p></div>`;
      return;
    }
    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;">` +
      pubs.map(p => {
        const t      = state.tarefas.find(t => t.id === p.tarefaId);
        const rotina = t ? state.rotinas.find(r => r.id === t.rotinaId) : null;
        return `<div class="list-item-row" style="cursor:pointer;" onclick="viewPublicacao('${p.id}')">
          <div style="flex:1;">
            <div style="font-weight:600;font-size:13px;">Realizada: ${formatDataRealizadaHtml(p.dataRealizada)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Rotina: ${rotina?.nome || '—'} · Tarefa: ${getTarefaLabel(t)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Publicada: ${formatDate(p.dataPublicacao)}</div>
          </div>
          ${p.anexos?.length > 0 ? `<span class="chip chip-cyan" style="font-size:10px;">${p.anexos.length} anexo${p.anexos.length>1?'s':''}</span>` : ''}
        </div>`;
      }).join('') + `</div>`;
  }

  // Abrir drawer de rotina pré-selecionando o ativo
  function openRotinaDrawerParaAtivo(idx) {
    openRotinaDrawer(null);
    setTimeout(() => {
      _selectedEquipIdx = idx;
      const ativo = state.ativos[idx];
      if (ativo) {
        document.getElementById('rotina-equip-input').value = ativo.nome;
        setRotinaEquipDisplay(idx);
      }
    }, 50);
  }

  // Abrir drawer de tarefa pré-selecionando o ativo
  function openTarefaDrawerParaAtivo(idx) {
    openTarefaDrawer(null);
    setTimeout(() => {
      const equipSel = document.getElementById('tarefa-equip-select');
      if (equipSel) {
        equipSel.value = idx;
        onTarefaEquipChange();
      }
    }, 50);
  }

  function editarAtivoAtual() {
    closeModal('modal-visualizar');
    openAtivoModal(ativoEdicaoIndex);
  }

  function renderSetorModal() {
    const container = document.getElementById('setor-list');
    container.innerHTML = state.setores.length === 0
      ? `<div style="text-align:center;padding:12px 0;color:var(--text-muted);font-size:13px;">Nenhum setor cadastrado.</div>`
      : state.setores.map((setor, index) => `
      <div class="list-item-row">
        <span class="list-item-name">${setor}</span>
        <span class="list-item-actions">
          <button class="btn btn-outline btn-icon" onclick="openSetorModal(${index})" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
          <button class="btn btn-outline btn-icon" onclick="removerSetor(${index})" title="Excluir" style="color:var(--red);border-color:rgba(230,57,70,0.3);" onmouseover="this.style.background='rgba(230,57,70,0.08)'" onmouseout="this.style.background=''"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
        </span>
      </div>
    `).join('');
    document.getElementById('input-novo-setor').value = setorEdicaoIndex >= 0 ? state.setores[setorEdicaoIndex] : '';
    document.getElementById('setor-save-btn').textContent = setorEdicaoIndex >= 0 ? 'Salvar' : 'Adicionar';
  }

  function renderCategoriaModal() {
    const container = document.getElementById('categoria-list');
    container.innerHTML = state.categorias.length === 0
      ? `<div style="text-align:center;padding:12px 0;color:var(--text-muted);font-size:13px;">Nenhuma categoria cadastrada.</div>`
      : state.categorias.map((categoria, index) => `
      <div class="list-item-row">
        <span class="list-item-name">${categoria}</span>
        <span class="list-item-actions">
          <button class="btn btn-outline btn-icon" onclick="openCategoriaModal(${index})" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
          <button class="btn btn-outline btn-icon" onclick="removerCategoria(${index})" title="Excluir" style="color:var(--red);border-color:rgba(230,57,70,0.3);" onmouseover="this.style.background='rgba(230,57,70,0.08)'" onmouseout="this.style.background=''"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
        </span>
      </div>
    `).join('');
    document.getElementById('input-nova-categoria').value = categoriaEdicaoIndex >= 0 ? state.categorias[categoriaEdicaoIndex] : '';
    document.getElementById('categoria-save-btn').textContent = categoriaEdicaoIndex >= 0 ? 'Salvar' : 'Adicionar';
  }

  function removerSetor(index) {
    state.setores.splice(index, 1);
    saveState();
    atualizarSelects();
    setorEdicaoIndex = -1;
    renderSetorModal();
  }

  function removerCategoria(index) {
    state.categorias.splice(index, 1);
    saveState();
    atualizarSelects();
    categoriaEdicaoIndex = -1;
    renderCategoriaModal();
  }

  function atualizarSelects() {
    const setorOptions = state.setores.map(s => `<option value="${s}">${s}</option>`).join('');
    document.getElementById('main-sector-filter').innerHTML = `<option value="todos">Setor (Todos)</option>` + setorOptions;
    document.getElementById('ativo-setor').innerHTML = `<option value="">Selecione...</option>` + setorOptions;
    const catOptions = state.categorias.map(c => `<option value="${c}">${c}</option>`).join('');
    document.getElementById('main-category-filter').innerHTML = `<option value="todas">Todas</option>` + catOptions;
    document.getElementById('ativo-categoria').innerHTML = `<option value="">Selecione...</option>` + catOptions;
    atualizarFiltrosRotina();
    populateTipoSelect();
    updateAtivosFiltroBtn();
  }

  function salvarSetor() {
    const val = document.getElementById('input-novo-setor').value.trim();
    if (!val) return;
    if (setorEdicaoIndex >= 0) {
      state.setores[setorEdicaoIndex] = val;
    } else if (!state.setores.includes(val)) {
      state.setores.push(val);
    }
    saveState();
    atualizarSelects();
    document.getElementById('input-novo-setor').value = '';
    setorEdicaoIndex = -1;
    renderSetorModal();
    closeModal('modal-setor');
    showToast('Setor salvo!', 'success');
  }

  function salvarCategoria() {
    const val = document.getElementById('input-nova-categoria').value.trim();
    if (!val) return;
    if (categoriaEdicaoIndex >= 0) {
      state.categorias[categoriaEdicaoIndex] = val;
    } else if (!state.categorias.includes(val)) {
      state.categorias.push(val);
    }
    saveState();
    atualizarSelects();
    document.getElementById('input-nova-categoria').value = '';
    categoriaEdicaoIndex = -1;
    renderCategoriaModal();
    closeModal('modal-categoria');
    showToast('Categoria salva!', 'success');
  }

  function salvarAtivo() {
    const nome = document.getElementById('ativo-nome').value.trim();
    const codigo = document.getElementById('ativo-codigo').value.trim();
    const setor = document.getElementById('ativo-setor').value;
    const categoria = document.getElementById('ativo-categoria').value;
    
    if(!nome || !codigo || !setor || !categoria) {
      showToast('Preencha os campos obrigatórios (*).', 'error'); return;
    }

    const ativo = {
      nome, codigo, setor, categoria,
      marca: document.getElementById('ativo-marca').value.trim() || "-",
      modelo: document.getElementById('ativo-modelo').value.trim() || "-",
      serie: document.getElementById('ativo-serie').value.trim() || "-",
      fornecedor: document.getElementById('ativo-fornecedor').value.trim() || "-",
      nota: document.getElementById('ativo-nota').value.trim()
    };

    if (ativoEdicaoIndex === null) {
      state.ativos.push(ativo);
    } else {
      state.ativos[ativoEdicaoIndex] = ativo;
    }
    saveState();

    ativoEdicaoIndex = null;
    document.querySelectorAll('#modal-ativo input, #modal-ativo textarea').forEach(el => el.value = '');
    document.getElementById('ativo-setor').value = '';
    document.getElementById('ativo-categoria').value = '';
    closeModal('modal-ativo');
    showToast('Ativo salvo com sucesso!', 'success');
  }

  function renderCards() {
    const grid = document.getElementById('assets-grid');
    const fSetor = document.getElementById('main-sector-filter').value;
    const fCat = document.getElementById('main-category-filter').value;

    const filtrados = state.ativos
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => {
        const matchSetor = fSetor === 'todos' || item.setor === fSetor;
        const matchCat = fCat === 'todas' || item.categoria === fCat;
        return matchSetor && matchCat;
      });

    if (filtrados.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          <h3>Nenhum ativo encontrado</h3>
          <p>Clique no botão "+" abaixo para cadastrar um novo equipamento.</p>
        </div>`;
      return;
    }

    grid.innerHTML = filtrados.map(({ item: a, index }) => {
      const { danger, warning, total } = getAtivoAlertCounts(index);
      const alertCls = danger > 0 ? 'alert-danger' : (warning > 0 ? 'alert-warning' : '');

      let flagHtml = '';
      if (total > 0) {
        const cls  = danger > 0 ? 'flag-danger' : 'flag-warning';
        const icon = danger > 0
          ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px;flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px;flex-shrink:0;"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>`;
        const tip  = [danger > 0 ? `${danger} vencida(s)` : '', warning > 0 ? `${warning} próxima(s)` : ''].filter(Boolean).join(', ');
        flagHtml = `<span class="task-flag ${cls}" style="font-size:11px;padding:3px 8px;white-space:nowrap;" title="${tip}" onclick="event.stopPropagation();openAtivoAlertasResumo(${index})">${icon}&nbsp;${total} alerta${total > 1 ? 's' : ''}</span>`;
      }

      return `
      <div class="asset-card ${alertCls}" onclick="visualizarAtivo(${index})">
        <div class="asset-header">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
            <div>
              <div class="asset-title">${a.nome}</div>
              <div class="asset-code">${a.codigo}</div>
            </div>
            ${flagHtml}
          </div>
        </div>
        <div class="asset-body">
          <div class="asset-row"><span class="asset-label">Marca</span><span class="asset-val">${a.marca}</span></div>
          <div class="asset-row"><span class="asset-label">Modelo</span><span class="asset-val">${a.modelo}</span></div>
          <div class="asset-row"><span class="asset-label">Nº Série</span><span class="asset-val">${a.serie}</span></div>
          <div class="asset-row"><span class="asset-label">Fornecedor</span><span class="asset-val">${a.fornecedor}</span></div>
        </div>
        <div class="asset-badges">
          <span class="badge">${a.setor}</span>
          <span class="badge">${a.categoria}</span>
        </div>
      </div>`;
    }).join('');
  }

  function openAtivoAlertasResumo(equipamentoIdx) {
    visualizarAtivo(equipamentoIdx, 'tarefas');
  }