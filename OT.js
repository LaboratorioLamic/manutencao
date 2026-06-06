// ═══════════════════════════════════════════════════════════════
// OT.js — Módulo Ordem de Trabalho — Manutenção LAMIC
// ═══════════════════════════════════════════════════════════════

// ── STORAGE ──────────────────────────────────────────────────
const OT_KEY = 'gestao-ot-v1';

let otState = {
  ordens: [],
  publicacoes: [],
  catalogos: {
    tiposFalha:   ['Elétrica', 'Mecânica', 'Software', 'Estrutural', 'Operacional', 'Hidráulica'],
    causasRaiz:   ['Desgaste natural', 'Mau uso', 'Falta de manutenção', 'Falha de componente', 'Causa externa', 'Fim de vida útil'],
    metodosDetec: ['Inspeção visual', 'Alarme do equipamento', 'Relatório de usuário', 'Monitoramento preventivo', 'Falha total'],
    tiposDano:    ['Sem dano', 'Dano ao ativo', 'Dano à operação', 'Risco ao paciente', 'Dano patrimonial'],
  }
};

function otSave() {
  localStorage.setItem(OT_KEY, JSON.stringify(otState));
}
function otLoad() {
  try {
    const raw = localStorage.getItem(OT_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object') return;
    if (Array.isArray(d.ordens))      otState.ordens      = d.ordens;
    if (Array.isArray(d.publicacoes)) otState.publicacoes = d.publicacoes;
    if (d.catalogos && typeof d.catalogos === 'object') {
      const c = d.catalogos;
      if (Array.isArray(c.tiposFalha))   otState.catalogos.tiposFalha   = c.tiposFalha;
      if (Array.isArray(c.causasRaiz))   otState.catalogos.causasRaiz   = c.causasRaiz;
      if (Array.isArray(c.metodosDetec)) otState.catalogos.metodosDetec = c.metodosDetec;
      if (Array.isArray(c.tiposDano))    otState.catalogos.tiposDano    = c.tiposDano;
    }
  } catch { /* ignora */ }
}

// ── CONSTANTES ────────────────────────────────────────────────
const OT_STATUSES = ['pendente', 'em_processo', 'em_revisao', 'concluida', 'cancelada'];

const OT_STATUS_CFG = {
  pendente:    { label: 'Pendentes',   dot: '#718096', countBg: 'rgba(113,128,150,0.12)', countColor: '#718096' },
  em_processo: { label: 'Em Processo', dot: '#00a8cc', countBg: 'rgba(0,168,204,0.12)',   countColor: '#00a8cc' },
  em_revisao:  { label: 'Em Revisão',  dot: '#f4a261', countBg: 'rgba(244,162,97,0.15)',  countColor: '#b45309' },
  concluida:   { label: 'Concluídas',  dot: '#2a9d8f', countBg: 'rgba(42,157,143,0.12)', countColor: '#2a9d8f' },
  cancelada:   { label: 'Canceladas',  dot: '#e63946', countBg: 'rgba(230,57,70,0.1)',    countColor: '#e63946' },
};

const OT_TIPO_CFG = {
  corretiva:   { label: 'Corretiva',    cls: 'ot-badge-tipo-corretiva'   },
  implantacao: { label: 'Implantação',  cls: 'ot-badge-tipo-implantacao' },
  melhoria:    { label: 'Melhoria',     cls: 'ot-badge-tipo-melhoria'    },
  alteracao:   { label: 'Alteração',    cls: 'ot-badge-tipo-alteracao'   },
};

const OT_SEV_CFG = {
  baixa:   { label: 'Baixa',   cls: 'ot-badge-sev-baixa'   },
  media:   { label: 'Média',   cls: 'ot-badge-sev-media'   },
  alta:    { label: 'Alta',    cls: 'ot-badge-sev-alta'     },
  critica: { label: 'Crítica', cls: 'ot-badge-sev-critica'  },
};

const OT_PUB_CFG = {
  comentario:    { label: 'Comentário',   bg: 'rgba(113,128,150,0.12)', color: '#718096'  },
  atualizacao:   { label: 'Atualização',  bg: 'rgba(0,168,204,0.12)',   color: '#00a8cc'  },
  evidencia:     { label: 'Evidência',    bg: 'rgba(244,162,97,0.12)',  color: '#b45309'  },
  transferencia: { label: 'Transferência',bg: 'rgba(139,92,246,0.1)',   color: '#7c3aed'  },
  conclusao:     { label: 'Conclusão',    bg: 'rgba(42,157,143,0.12)', color: '#2a9d8f'  },
  cancelamento:  { label: 'Cancelamento', bg: 'rgba(230,57,70,0.1)',    color: '#e63946'  },
  devolucao:     { label: 'Devolução',    bg: 'rgba(244,162,97,0.12)',  color: '#b45309'  },
};

const OT_CHECKLIST_TPL = {
  corretiva: [
    'Identificar e isolar o equipamento defeituoso',
    'Registrar estado inicial com fotografias',
    'Diagnosticar causa raiz',
    'Executar reparo / substituição',
    'Testar funcionamento pós-reparo',
    'Registrar evidências fotográficas finais',
  ],
  implantacao: [
    'Receber e conferir o equipamento com nota fiscal',
    'Verificar documentação técnica e manual',
    'Definir e preparar local de instalação',
    'Instalar e configurar o equipamento',
    'Treinar operadores responsáveis',
    'Registrar no patrimônio / sistema de ativos',
  ],
  melhoria: [
    'Levantar requisitos e escopo da melhoria',
    'Elaborar plano de execução',
    'Obter aprovação do gestor responsável',
    'Executar a melhoria planejada',
    'Validar resultado com as partes interessadas',
    'Documentar processo e lições aprendidas',
  ],
  alteracao: [
    'Identificar o escopo da alteração',
    'Avaliar impacto nos processos e equipamentos',
    'Obter aprovação formal da alteração',
    'Executar a alteração conforme plano',
    'Testar e validar o resultado',
    'Atualizar documentação técnica',
  ],
};

// ── ESTADO LOCAL DO MÓDULO ────────────────────────────────────
let _otFormId    = null; // null = nova OT, string = editar
let _otViewId    = null; // OT aberta na view
let _otSubTemp   = [];   // subtarefas em edição
let _otAtivoIdx  = null; // ativo selecionado no form
let _otPubAnexos = [];   // anexos da publicação em progresso
let _otFilterTipo = '';
let _otFilterSev  = '';
let _otSearchQ    = '';
let _otFilterAtivoIdx = null;
let _otFilterMyOTs    = false;
let _otFilterDate     = { mode: null, mes: null, ano: null, de: null, ate: null };
let _otViewMode       = 'kanban'; // kanban | calendario | lista
let _otCalYear        = new Date().getFullYear();
let _otCalMonth       = new Date().getMonth();
let _otListSort       = { col: 'criadoEm', dir: -1 };

// ── DRAG & DROP STATE ─────────────────────────────────────────
let _dragOtId      = null;
let _dragOriginCol = null;

// ── NÚMERO SEQUENCIAL ─────────────────────────────────────────
function _otNextNum() {
  const year = new Date().getFullYear();
  const seq = otState.ordens.filter(o => o.numero && o.numero.startsWith(`OT-${year}-`)).length + 1;
  return `OT-${year}-${String(seq).padStart(3, '0')}`;
}

// ── INICIALIZAÇÃO ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  otLoad();
  _otInjectModals();
  _otExtendUpload();
  _otHookTab();
});

function _otHookTab() {
  const tabEl = document.getElementById('tab-os');
  if (!tabEl) return;
  const obs = new MutationObserver(() => {
    if (tabEl.classList.contains('active')) _otInitTab();
  });
  obs.observe(tabEl, { attributes: true, attributeFilter: ['class'] });
  if (tabEl.classList.contains('active')) _otInitTab();
}

function _otInitTab() {
  const tabEl = document.getElementById('tab-os');
  if (!tabEl || tabEl.dataset.otInit === '1') return;
  tabEl.dataset.otInit = '1';
  tabEl.innerHTML = _otBuildTabHTML();
  _otBindToolbar();
  _otRenderView_mode();
}

function _otBuildTabHTML() {
  return `
<div class="ot-wrapper">
  <!-- Abas de modo de visualização -->
  <div class="ot-view-tabs">
    <button class="ot-view-tab-btn active" id="ot-vtab-kanban" onclick="otSetViewMode('kanban')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="10" rx="1"/><rect x="14" y="17" width="7" height="4" rx="1"/></svg>
      Kanban
    </button>
    <button class="ot-view-tab-btn" id="ot-vtab-calendario" onclick="otSetViewMode('calendario')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      Calendário
    </button>
    <button class="ot-view-tab-btn" id="ot-vtab-lista" onclick="otSetViewMode('lista')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.5" fill="currentColor"/><circle cx="3" cy="12" r="1.5" fill="currentColor"/><circle cx="3" cy="18" r="1.5" fill="currentColor"/></svg>
      Lista
    </button>
    <div style="flex:1;"></div>
  </div>
  <!-- Toolbar de filtros -->
  <div class="ot-toolbar">
    <div class="ot-search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" id="ot-search-input" placeholder="Buscar OT..." oninput="otSearchChange(this.value)">
    </div>
    <!-- Filtro de Ativo com botão de seleção -->
    <div style="display:flex;align-items:center;gap:4px;">
      <div id="ot-filter-ativo-wrap" class="ot-filter-ativo-wrap" onclick="otOpenFilterAtivoSearch()" title="Selecionar ativo" style="cursor:pointer;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        <span id="ot-filter-ativo-label">Selecionar ativo</span>
      </div>
      <button class="ot-filter-ativo-btn" id="ot-filter-ativo-clear" onclick="otClearFilterAtivo()" title="Limpar ativo" style="display:none;">×</button>
    </div>
    <select class="ot-filter-select" id="ot-filter-tipo" onchange="otFilterChange()">
      <option value="">Todos os tipos</option>
      <option value="corretiva">Corretiva</option>
      <option value="implantacao">Implantação</option>
      <option value="melhoria">Melhoria</option>
      <option value="alteracao">Alteração</option>
    </select>
    <select class="ot-filter-select" id="ot-filter-sev" onchange="otFilterChange()">
      <option value="">Toda severidade</option>
      <option value="critica">Crítica</option>
      <option value="alta">Alta</option>
      <option value="media">Média</option>
      <option value="baixa">Baixa</option>
    </select>
    <!-- Botão de filtro de data (calendário) -->
    <div class="ot-date-filter-wrap" id="ot-date-filter-wrap">
      <button class="ot-date-filter-btn" id="ot-date-filter-btn" onclick="otToggleDatePicker()" title="Filtrar por período">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span id="ot-date-filter-label">Período</span>
      </button>
      <div class="ot-date-picker-popup" id="ot-date-picker-popup" style="display:none;">
        <div class="ot-date-picker-tabs">
          <button class="ot-dp-tab active" data-mode="mes" onclick="otDpSetMode('mes')">Mês</button>
          <button class="ot-dp-tab" data-mode="ano" onclick="otDpSetMode('ano')">Ano</button>
          <button class="ot-dp-tab" data-mode="custom" onclick="otDpSetMode('custom')">Personalizado</button>
        </div>
        <div id="ot-dp-mes-panel" class="ot-dp-panel">
          <div class="ot-dp-row">
            <select id="ot-dp-mes-sel" class="field-select" style="flex:1;">
              ${['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'].map((m,i)=>`<option value="${i}" ${i===new Date().getMonth()?'selected':''}>${m}</option>`).join('')}
            </select>
            <select id="ot-dp-mes-ano-sel" class="field-select" style="width:90px;">
              ${Array.from({length:6},(_,k)=>new Date().getFullYear()-2+k).map(y=>`<option value="${y}" ${y===new Date().getFullYear()?'selected':''}>${y}</option>`).join('')}
            </select>
          </div>
        </div>
        <div id="ot-dp-ano-panel" class="ot-dp-panel" style="display:none;">
          <select id="ot-dp-ano-sel" class="field-select" style="width:100%;">
            ${Array.from({length:6},(_,k)=>new Date().getFullYear()-2+k).map(y=>`<option value="${y}" ${y===new Date().getFullYear()?'selected':''}>${y}</option>`).join('')}
          </select>
        </div>
        <div id="ot-dp-custom-panel" class="ot-dp-panel" style="display:none;">
          <div class="ot-dp-row">
            <div style="flex:1;"><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px;">De</label>
              <input type="date" id="ot-dp-de" class="field-input" style="width:100%;"></div>
            <div style="flex:1;"><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px;">Até</label>
              <input type="date" id="ot-dp-ate" class="field-input" style="width:100%;"></div>
          </div>
        </div>
        <div class="ot-dp-actions">
          <button class="btn btn-outline" style="font-size:12px;padding:5px 10px;" onclick="otClearDateFilter()">Limpar</button>
          <button class="btn btn-primary" style="font-size:12px;padding:5px 12px;" onclick="otApplyDateFilter()">Aplicar</button>
        </div>
      </div>
    </div>
    <div class="ot-toolbar-spacer"></div>
    <!-- Botão Minhas OTs -->
    <button class="ot-my-ots-btn" id="ot-my-ots-btn" onclick="otToggleMyOTs()" title="Minhas OTs">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
      Minhas OTs
    </button>
  </div>
  <div id="ot-main-content" style="flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0;"></div>
  <button class="ot-fab" onclick="otOpenForm(null)" title="Nova OT">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
  </button>
</div>`;
}

function _otBindToolbar() {
  document.getElementById('ot-search-input')?.addEventListener('input', e => {
    _otSearchQ = e.target.value.toLowerCase();
    _otRenderView_mode();
  });
  // Fecha date picker ao clicar fora
  if (!window._otDatePickerBound) {
    document.addEventListener('click', e => {
      if (!e.target.closest('#ot-date-filter-wrap')) {
        document.getElementById('ot-date-picker-popup')?.style && (document.getElementById('ot-date-picker-popup').style.display = 'none');
      }
    });
    window._otDatePickerBound = true;
  }
  // Fecha modal de busca de ativo de filtro ao clicar fora
  if (!window._otFilterAtivoModalBound) {
    document.addEventListener('click', e => {
      if (!e.target.closest('#modal-ot-filter-ativo')) {
        // handled by modal overlay
      }
    });
    window._otFilterAtivoModalBound = true;
  }
}

function otSearchChange(v) { _otSearchQ = v.toLowerCase(); _otRenderView_mode(); }
function otFilterChange() {
  _otFilterTipo = document.getElementById('ot-filter-tipo')?.value || '';
  _otFilterSev  = document.getElementById('ot-filter-sev')?.value  || '';
  _otRenderView_mode();
}

// ── MODO DE VISUALIZAÇÃO ──────────────────────────────────────
function otSetViewMode(mode) {
  _otViewMode = mode;
  ['kanban','calendario','lista'].forEach(m => {
    document.getElementById('ot-vtab-' + m)?.classList.toggle('active', m === mode);
  });
  // Esconde fab original no modo kanban (já tem o inline), mostra nos outros
  const fab = document.querySelector('.ot-fab:not(.ot-fab-inline)');
  if (fab) fab.style.display = mode === 'kanban' ? 'flex' : 'flex';
  // Oculta filtro de data no calendário
  const dfWrap = document.getElementById('ot-date-filter-wrap');
  if (dfWrap) dfWrap.style.display = mode === 'calendario' ? 'none' : '';
  _otRenderView_mode();
}

function _otRenderView_mode() {
  if (_otViewMode === 'kanban') _otRenderKanban();
  else if (_otViewMode === 'calendario') _otRenderCalendario();
  else if (_otViewMode === 'lista') _otRenderLista();
}

// ── FILTRO DE ATIVO ───────────────────────────────────────────
function otOpenFilterAtivoSearch() {
  const input = document.getElementById('ot-filter-ativo-search-input');
  if (input) input.value = '';
  _otRenderFilterAtivoList('');
  otOpenModal('modal-ot-filter-ativo');
  setTimeout(() => input?.focus(), 80);
}

function otFilterAtivoSearchInput(q) { _otRenderFilterAtivoList(q.toLowerCase()); }

function _otRenderFilterAtivoList(q) {
  const list = document.getElementById('ot-filter-ativo-search-list');
  if (!list || typeof state === 'undefined') return;

  // Coleta os índices de ativo que aparecem nas OTs considerando todos os filtros EXCETO o filtro de ativo
  const savedAtivoIdx = _otFilterAtivoIdx;
  _otFilterAtivoIdx = null;
  const otsVisiveis = _otGetFiltered();
  _otFilterAtivoIdx = savedAtivoIdx;

  const idxComOTs = new Set(otsVisiveis.map(o => o.ativoIdx).filter(i => i !== null && i !== undefined));

  const ativos = state.ativos.map((a, i) => ({ ...a, _idx: i }))
    .filter(a => {
      if (!idxComOTs.has(a._idx)) return false;
      return !q || `${a.nome} ${a.codigo} ${a.setor}`.toLowerCase().includes(q);
    });

  if (ativos.length === 0) {
    list.innerHTML = '<div class="autocomplete-empty">Nenhum ativo encontrado</div>'; return;
  }
  list.innerHTML = ativos.slice(0, 40).map(a => `
    <div class="ativo-search-card" onclick="otSelectFilterAtivo(${a._idx})">
      <div class="ativo-search-card-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      </div>
      <div>
        <div class="ativo-search-card-name">${_escHtml(a.nome)}</div>
        <div class="ativo-search-card-meta">${a.codigo ? a.codigo + ' · ' : ''}${a.setor || ''}${idxComOTs.has(a._idx) ? ` · ${otsVisiveis.filter(o => o.ativoIdx === a._idx).length} OT(s)` : ''}</div>
      </div>
    </div>`).join('');
}

function otSelectFilterAtivo(idx) {
  _otFilterAtivoIdx = idx;
  otCloseModal('modal-ot-filter-ativo');
  const ativo = typeof state !== 'undefined' ? state.ativos[idx] : null;
  const label = document.getElementById('ot-filter-ativo-label');
  if (label) label.textContent = ativo ? _escHtml(ativo.nome) : 'Selecionar ativo';
  const clearBtn = document.getElementById('ot-filter-ativo-clear');
  if (clearBtn) clearBtn.style.display = ativo ? '' : 'none';
  const wrap = document.getElementById('ot-filter-ativo-wrap');
  if (wrap) wrap.classList.toggle('active', !!ativo);
  _otRenderView_mode();
}

function otClearFilterAtivo() {
  _otFilterAtivoIdx = null;
  const label = document.getElementById('ot-filter-ativo-label');
  if (label) label.textContent = 'Selecionar ativo';
  const clearBtn = document.getElementById('ot-filter-ativo-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  const wrap = document.getElementById('ot-filter-ativo-wrap');
  if (wrap) wrap.classList.remove('active');
  _otRenderView_mode();
}

// ── FILTRO MINHAS OTs ─────────────────────────────────────────
function otToggleMyOTs() {
  _otFilterMyOTs = !_otFilterMyOTs;
  document.getElementById('ot-my-ots-btn')?.classList.toggle('active', _otFilterMyOTs);
  _otRenderView_mode();
}

// ── FILTRO DE DATA ────────────────────────────────────────────
let _otDpCurrentMode = 'mes';

function otToggleDatePicker() {
  const popup = document.getElementById('ot-date-picker-popup');
  if (!popup) return;
  popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
}

function otDpSetMode(mode) {
  _otDpCurrentMode = mode;
  document.querySelectorAll('.ot-dp-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  ['mes','ano','custom'].forEach(m => {
    const panel = document.getElementById(`ot-dp-${m}-panel`);
    if (panel) panel.style.display = m === mode ? '' : 'none';
  });
}

function otApplyDateFilter() {
  const mode = _otDpCurrentMode;
  if (mode === 'mes') {
    const mes = parseInt(document.getElementById('ot-dp-mes-sel')?.value);
    const ano = parseInt(document.getElementById('ot-dp-mes-ano-sel')?.value);
    _otFilterDate = { mode: 'mes', mes, ano, de: null, ate: null };
    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    document.getElementById('ot-date-filter-label').textContent = `${meses[mes]}/${ano}`;
  } else if (mode === 'ano') {
    const ano = parseInt(document.getElementById('ot-dp-ano-sel')?.value);
    _otFilterDate = { mode: 'ano', mes: null, ano, de: null, ate: null };
    document.getElementById('ot-date-filter-label').textContent = String(ano);
  } else {
    const de  = document.getElementById('ot-dp-de')?.value;
    const ate = document.getElementById('ot-dp-ate')?.value;
    if (!de && !ate) { showToast('Informe ao menos uma data.', 'error'); return; }
    _otFilterDate = { mode: 'custom', mes: null, ano: null, de, ate };
    document.getElementById('ot-date-filter-label').textContent = `${de ? _fmtDate(de) : '...'} – ${ate ? _fmtDate(ate) : '...'}`;
  }
  document.getElementById('ot-date-filter-btn')?.classList.add('active');
  document.getElementById('ot-date-picker-popup').style.display = 'none';
  _otRenderView_mode();
}

function otClearDateFilter() {
  _otFilterDate = { mode: null, mes: null, ano: null, de: null, ate: null };
  document.getElementById('ot-date-filter-label').textContent = 'Período';
  document.getElementById('ot-date-filter-btn')?.classList.remove('active');
  document.getElementById('ot-date-picker-popup').style.display = 'none';
  _otRenderView_mode();
}

function _otPassesDateFilter(o) {
  if (!_otFilterDate.mode) return true;
  const dataRef = o.prazo || o.criadoEm?.split('T')[0] || '';
  if (!dataRef) return true;
  const d = new Date(dataRef + (dataRef.length === 10 ? 'T00:00:00' : ''));
  if (_otFilterDate.mode === 'mes') {
    return d.getFullYear() === _otFilterDate.ano && d.getMonth() === _otFilterDate.mes;
  } else if (_otFilterDate.mode === 'ano') {
    return d.getFullYear() === _otFilterDate.ano;
  } else {
    const de  = _otFilterDate.de  ? new Date(_otFilterDate.de  + 'T00:00:00') : null;
    const ate = _otFilterDate.ate ? new Date(_otFilterDate.ate + 'T23:59:59') : null;
    if (de  && d < de)  return false;
    if (ate && d > ate) return false;
    return true;
  }
}

// ── FILTRO CENTRAL ────────────────────────────────────────────
function _otGetFiltered() {
  const sess = typeof currentSession !== 'undefined' ? currentSession : null;
  return otState.ordens.filter(o => {
    const ativo = (o.ativoIdx !== null && o.ativoIdx !== undefined && typeof state !== 'undefined')
      ? state.ativos[o.ativoIdx] : null;
    if (ativo) {
      if (typeof _userCanSeeAtivo === 'function' && !_userCanSeeAtivo(ativo)) return false;
    } else if (o.setor) {
      const visSetores = (typeof authGetVisibleSetores === 'function') ? authGetVisibleSetores() : null;
      if (visSetores && !visSetores.includes(o.setor)) return false;
    }
    if (_otFilterAtivoIdx !== null && o.ativoIdx !== _otFilterAtivoIdx) return false;
    if (_otFilterMyOTs && sess) {
      if (o.responsavelId !== sess.userId) return false;
    }
    if (!_otPassesDateFilter(o)) return false;
    if (_otFilterTipo && o.tipo !== _otFilterTipo) return false;
    if (_otFilterSev  && o.severidade !== _otFilterSev) return false;
    if (_otSearchQ) {
      const hay = `${o.numero} ${o.titulo} ${o.responsavelNome} ${o.solicitanteNome}`.toLowerCase();
      if (!hay.includes(_otSearchQ)) return false;
    }
    return true;
  });
}

// ── KANBAN RENDER ─────────────────────────────────────────────
function _otRenderKanban() {
  const content = document.getElementById('ot-main-content');
  if (!content) return;
  content.innerHTML = `<div class="ot-board" id="ot-board"></div>`;
  const board = document.getElementById('ot-board');
  if (!board) return;

  const filtered = _otGetFiltered();

  board.innerHTML = OT_STATUSES.map(status => {
    const cfg   = OT_STATUS_CFG[status];
    const cards = filtered.filter(o => o.status === status);
    return `
<div class="ot-column" id="otcol-${status}">
  <div class="ot-col-header">
    <div class="ot-col-dot" style="background:${cfg.dot}"></div>
    <span class="ot-col-title">${cfg.label}</span>
    <span class="ot-col-count" style="background:${cfg.countBg};color:${cfg.countColor}">${cards.length}</span>
  </div>
  <div class="ot-col-body" id="otbody-${status}"
    ondragover="otDragOver(event,'${status}')"
    ondragleave="otDragLeave(event,'${status}')"
    ondrop="otDrop(event,'${status}')">
    ${cards.length === 0 ? `<div class="ot-col-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
      Nenhuma OT
    </div>` : cards.map(o => _otCardHTML(o)).join('')}
  </div>
</div>`;
  }).join('');
}

function _otCardDeadlineInfo(o) {
  if (!o.prazo) return { diff: null, alertLimit: 2, cls: '', txt: '' };
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(o.prazo + 'T00:00:00');
  const diff = Math.ceil((d - today) / 86400000);
  let alertLimit = 2;
  if (o.prazoAlertaDias !== undefined && o.prazoAlertaDias !== null) {
    const parsed = parseInt(o.prazoAlertaDias, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) alertLimit = parsed;
  }
  const cls = diff < 0 ? 'ot-card-overdue' : (diff <= alertLimit ? 'ot-card-warning' : '');
  const txt = diff < 0 ? `Vencida ${Math.abs(diff)}d` : (diff === 0 ? 'Vence hoje' : _fmtDate(o.prazo));
  return { diff, alertLimit, cls, txt };
}

function _otCardHTML(o) {
  const tipoCfg = OT_TIPO_CFG[o.tipo] || {};
  const sevCfg  = OT_SEV_CFG[o.severidade]  || {};
  const ativo   = (typeof state !== 'undefined' && o.ativoIdx !== null && o.ativoIdx !== undefined)
    ? state.ativos[o.ativoIdx] : null;

  const sub      = o.subtarefas || [];
  const subDone  = sub.filter(s => s.concluida).length;
  const subTotal = sub.length;
  const pct      = subTotal > 0 ? Math.round((subDone / subTotal) * 100) : 0;

  const { diff, alertLimit, cls: prazoClass, txt: prazoTxt } = _otCardDeadlineInfo(o);

  const prazoHtml = o.prazo ? `<div class="ot-card-meta-row">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      <span class="${prazoClass}">${prazoTxt}</span>
    </div>` : '';

  // Cor da barra lateral: vermelho=vencida, laranja=em alerta, senão usa severidade
  const deadlineSide = diff !== null && diff < 0 ? 'ot-card-side-overdue'
    : (diff !== null && diff <= alertLimit ? 'ot-card-side-warning' : '');

  const terceiroHtml = o.terceirizado
    ? `<span class="ot-badge ot-badge-terceiro">Terceirizado</span>` : '';

  return `<div class="ot-card ${deadlineSide}" data-sev="${deadlineSide ? '' : o.severidade}"
  draggable="true"
  ondragstart="otDragStart(event,'${o.id}','${o.status}')"
  ondragend="otDragEnd(event)"
  onclick="otOpenView('${o.id}')">
  <div class="ot-card-top">
    <span class="ot-card-num">${o.numero}</span>
    <button class="ot-card-menu-btn" onclick="event.stopPropagation();otCardMenu('${o.id}')" title="Ações">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
    </button>
  </div>
  <div class="ot-card-title">${_escHtml(o.titulo)}</div>
  <div class="ot-card-badges">
    <span class="ot-badge ${tipoCfg.cls}">${tipoCfg.label}</span>
    <span class="ot-badge ${sevCfg.cls}">${sevCfg.label}</span>
    ${terceiroHtml}
  </div>
  <div class="ot-card-meta">
    ${ativo ? `<div class="ot-card-meta-row">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      <span class="ot-card-meta-val">${_escHtml(ativo.nome)}${ativo.codigo ? ' · ' + ativo.codigo : ''}</span>
    </div>` : ''}
    ${o.responsavelNome ? `<div class="ot-card-meta-row">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
      <span class="ot-card-meta-val">${_escHtml(o.responsavelNome)}</span>
    </div>` : `<div class="ot-card-meta-row" style="color:var(--amber);font-weight:600;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span>Sem responsável</span>
    </div>`}
    ${prazoHtml}
  </div>
  ${subTotal > 0 ? `<div class="ot-card-footer">
    <div class="ot-card-progress-label">
      <span>Subtarefas</span><span>${subDone}/${subTotal}</span>
    </div>
    <div class="ot-progress-bar-wrap">
      <div class="ot-progress-bar-fill" style="width:${pct}%;background:${pct === 100 ? 'var(--green)' : 'var(--cyan)'}"></div>
    </div>
  </div>` : ''}
</div>`;
}

// ── CALENDÁRIO RENDER ─────────────────────────────────────────
function _otRenderCalendario() {
  const content = document.getElementById('ot-main-content');
  if (!content) return;
  const filtered = _otGetFiltered();
  const year = _otCalYear, month = _otCalMonth;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  // Agrupa OTs por dia de prazo
  const byDay = {};
  filtered.forEach(o => {
    if (!o.prazo) return;
    const d = new Date(o.prazo + 'T00:00:00');
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    const day = d.getDate();
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(o);
  });

  const today = new Date(); today.setHours(0,0,0,0);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  let cells = '';
  const startBlank = firstDay === 0 ? 6 : firstDay - 1; // segunda = 0
  for (let i = 0; i < startBlank; i++) cells += `<div class="ot-cal-cell ot-cal-blank"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = dayStr === todayStr;
    const ots = byDay[d] || [];
    const maxShow = 3;
    cells += `<div class="ot-cal-cell${isToday ? ' ot-cal-today' : ''}">
      <span class="ot-cal-day-num">${d}</span>
      <div class="ot-cal-ots">
        ${ots.slice(0, maxShow).map(o => {
          const { cls } = _otCardDeadlineInfo(o);
          return `<div class="ot-cal-ot-pill ${cls ? 'ot-cal-pill-' + (cls.includes('overdue') ? 'overdue' : 'warning') : ''}" onclick="otOpenView('${o.id}')" title="${_escHtml(o.titulo)}">
            <span class="ot-cal-pill-dot ot-cal-dot-${o.tipo}"></span>
            ${_escHtml(o.titulo.length > 20 ? o.titulo.slice(0,20)+'…' : o.titulo)}
          </div>`;
        }).join('')}
        ${ots.length > maxShow ? `<div class="ot-cal-more">+${ots.length - maxShow} mais</div>` : ''}
      </div>
    </div>`;
  }

  content.innerHTML = `
<div class="ot-cal-wrapper">
  <div class="ot-cal-header">
    <div class="ot-cal-nav-group">
      <button class="ot-cal-nav-btn" onclick="otCalNav(-1)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <button class="ot-cal-title" onclick="otCalOpenPicker()" title="Selecionar mês/ano">${meses[month]} ${year}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px;margin-left:4px;opacity:0.6;"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <button class="ot-cal-nav-btn" onclick="otCalNav(1)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
    <div id="ot-cal-picker" class="ot-cal-picker" style="display:none;"></div>
  </div>
  <div class="ot-cal-grid">
    <div class="ot-cal-dow">Seg</div><div class="ot-cal-dow">Ter</div><div class="ot-cal-dow">Qua</div>
    <div class="ot-cal-dow">Qui</div><div class="ot-cal-dow">Sex</div><div class="ot-cal-dow">Sáb</div><div class="ot-cal-dow">Dom</div>
    ${cells}
  </div>
</div>`;
}

function otCalNav(dir) {
  _otCalMonth += dir;
  if (_otCalMonth < 0) { _otCalMonth = 11; _otCalYear--; }
  if (_otCalMonth > 11) { _otCalMonth = 0; _otCalYear++; }
  _otRenderCalendario();
}

let _otCalPickerYear = null;
function otCalOpenPicker() {
  const picker = document.getElementById('ot-cal-picker');
  if (!picker) return;
  if (picker.style.display !== 'none') { picker.style.display = 'none'; return; }
  _otCalPickerYear = _otCalYear;
  otCalRenderPicker();
  picker.style.display = 'block';
  const close = (e) => { if (!picker.contains(e.target) && !e.target.closest('.ot-cal-title')) { picker.style.display = 'none'; document.removeEventListener('mousedown', close); } };
  setTimeout(() => document.addEventListener('mousedown', close), 0);
}
function otCalRenderPicker() {
  const picker = document.getElementById('ot-cal-picker');
  if (!picker) return;
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  picker.innerHTML = `
    <div class="ot-cal-picker-header">
      <button class="ot-cal-nav-btn" onclick="otCalPickerYearNav(-1)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span class="ot-cal-picker-year">${_otCalPickerYear}</span>
      <button class="ot-cal-nav-btn" onclick="otCalPickerYearNav(1)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
    <div class="ot-cal-picker-grid">
      ${meses.map((m, i) => `<button class="ot-cal-picker-month${_otCalPickerYear === _otCalYear && i === _otCalMonth ? ' active' : ''}" onclick="otCalPickerSelect(${i})">${m}</button>`).join('')}
    </div>`;
}
function otCalPickerYearNav(dir) {
  _otCalPickerYear += dir;
  otCalRenderPicker();
}
function otCalPickerSelect(month) {
  _otCalMonth = month;
  _otCalYear = _otCalPickerYear;
  const picker = document.getElementById('ot-cal-picker');
  if (picker) picker.style.display = 'none';
  _otRenderCalendario();
}

// ── LISTA RENDER ──────────────────────────────────────────────
const OT_LIST_COLS = [
  { key: 'numero',         label: 'Número'      },
  { key: 'titulo',         label: 'Título'       },
  { key: 'tipo',           label: 'Tipo'         },
  { key: 'severidade',     label: 'Severidade'   },
  { key: 'status',         label: 'Status'       },
  { key: 'responsavelNome',label: 'Responsável'  },
  { key: 'prazo',          label: 'Prazo'        },
  { key: 'criadoEm',       label: 'Criada em'    },
];

function _otRenderLista() {
  const content = document.getElementById('ot-main-content');
  if (!content) return;
  const filtered = _otGetFiltered();
  const { col, dir } = _otListSort;
  const sorted = [...filtered].sort((a, b) => {
    let va = a[col] || '', vb = b[col] || '';
    if (col === 'criadoEm' || col === 'prazo') {
      va = va || ''; vb = vb || '';
    }
    return va < vb ? -dir : va > vb ? dir : 0;
  });

  const headerCols = OT_LIST_COLS.map(c => `
    <th class="ot-list-th${c.key === col ? ' sorted' : ''}" onclick="otListSort('${c.key}')">
      ${c.label}
      ${c.key === col ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px;margin-left:3px;">${dir === 1 ? '<polyline points="18 15 12 9 6 15"/>' : '<polyline points="6 9 12 15 18 9"/>'}</svg>` : ''}
    </th>`).join('');

  const rows = sorted.length === 0
    ? `<tr><td colspan="${OT_LIST_COLS.length}" style="text-align:center;padding:32px;color:var(--text-muted);">Nenhuma OT encontrada</td></tr>`
    : sorted.map(o => {
        const tipoCfg = OT_TIPO_CFG[o.tipo] || {};
        const sevCfg  = OT_SEV_CFG[o.severidade] || {};
        const stCfg   = OT_STATUS_CFG[o.status] || {};
        const { cls: prazoClass, txt: prazoTxt } = _otCardDeadlineInfo(o);
        return `<tr class="ot-list-row" onclick="otOpenView('${o.id}')">
          <td><span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-muted);">${_escHtml(o.numero)}</span></td>
          <td style="font-weight:600;color:var(--text-primary);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escHtml(o.titulo)}</td>
          <td><span class="ot-badge ${tipoCfg.cls}">${tipoCfg.label}</span></td>
          <td><span class="ot-badge ${sevCfg.cls}">${sevCfg.label}</span></td>
          <td><span class="ot-status-badge ot-status-${o.status}" style="font-size:11px;padding:2px 8px;">${stCfg.label}</span></td>
          <td style="font-size:13px;color:var(--text-secondary);">${_escHtml(o.responsavelNome || '—')}</td>
          <td><span class="${prazoClass || ''}" style="font-size:12.5px;">${prazoTxt || (o.prazo ? _fmtDate(o.prazo) : '—')}</span></td>
          <td style="font-size:12px;color:var(--text-muted);">${_fmtDate(o.criadoEm?.split('T')[0] || '')}</td>
        </tr>`;
      }).join('');

  content.innerHTML = `
<div class="ot-list-wrapper">
  <table class="ot-list-table">
    <thead><tr>${headerCols}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

function otListSort(col) {
  if (_otListSort.col === col) _otListSort.dir *= -1;
  else { _otListSort.col = col; _otListSort.dir = -1; }
  _otRenderLista();
}

// ── DRAG & DROP ───────────────────────────────────────────────
function otDragStart(event, otId, originStatus) {
  _dragOtId      = otId;
  _dragOriginCol = originStatus;
  event.currentTarget.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
}
function otDragEnd(event) {
  event.currentTarget?.classList.remove('dragging');
  document.querySelectorAll('.ot-col-body').forEach(el => el.classList.remove('drag-over'));
  _dragOtId = null; _dragOriginCol = null;
}
function otDragOver(event, status) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  document.getElementById('otbody-' + status)?.classList.add('drag-over');
}
function otDragLeave(event, status) {
  document.getElementById('otbody-' + status)?.classList.remove('drag-over');
}
function otDrop(event, targetStatus) {
  event.preventDefault();
  document.getElementById('otbody-' + targetStatus)?.classList.remove('drag-over');
  if (!_dragOtId || _dragOriginCol === targetStatus) return;
  _otTryTransition(_dragOtId, targetStatus);
}

function _otTryTransition(otId, targetStatus) {
  const o = otState.ordens.find(x => x.id === otId);
  if (!o) return;
  const from = o.status;

  // Bloqueios: apenas OTs canceladas são finais; OTs concluídas podem ser reabertas/alteradas
  if (from === 'cancelada') {
    showToast('OTs canceladas não podem ser movidas.', 'error'); return;
  }

  // Validações de transição
  if (targetStatus === 'em_processo' && !o.responsavelNome) {
    showToast('Defina um responsável antes de iniciar a OT.', 'error');
    otOpenView(otId); return;
  }
  if (targetStatus === 'em_revisao') {
    const sub = o.subtarefas || [];
    if (sub.length > 0 && !sub.some(s => s.concluida)) {
      showToast('Conclua ao menos uma subtarefa antes de enviar para revisão.', 'error'); return;
    }
  }
  if (targetStatus === 'concluida') {
    const sub = o.subtarefas || [];
    if (sub.length > 0 && sub.some(s => !s.concluida)) {
      showToast('Conclua todas as subtarefas antes de concluir a OT.', 'error'); return;
    }
    const pubs = otState.publicacoes.filter(p => p.otId === otId);
    if (pubs.length === 0) {
      showToast('Adicione ao menos uma publicação de evidência antes de concluir.', 'error'); return;
    }
  }
  if (targetStatus === 'cancelada') {
    _otOpenCancelModal(otId); return;
  }

  // Transição direta (Gestor/Admin abre direto em Em Processo)
  if (targetStatus === 'em_processo' && from === 'pendente') {
    _otSetStatus(otId, targetStatus, 'transferencia',
      `OT avançada para Em Processo.`);
    return;
  }

  // Devolução de revisão
  if (targetStatus === 'em_processo' && from === 'em_revisao') {
    _otOpenDevolveModal(otId); return;
  }

  _otSetStatus(otId, targetStatus, _otPubTipoForTransition(from, targetStatus), '');
}

function _otPubTipoForTransition(from, to) {
  if (to === 'concluida')   return 'conclusao';
  if (to === 'cancelada')   return 'cancelamento';
  if (to === 'em_processo') return 'transferencia';
  return 'atualizacao';
}

function _otSetStatus(otId, newStatus, pubTipo, texto) {
  const idx = otState.ordens.findIndex(x => x.id === otId);
  if (idx < 0) return;
  const old = otState.ordens[idx].status;
  if (old === 'cancelada') {
    showToast('OTs canceladas não podem ser movidas.', 'error'); return;
  }
  otState.ordens[idx].status      = newStatus;
  otState.ordens[idx].atualizadoEm = new Date().toISOString();
  if (newStatus === 'concluida') otState.ordens[idx].dataConclusao = new Date().toISOString().split('T')[0];

  const sess = typeof currentSession !== 'undefined' ? currentSession : null;
  if (texto || pubTipo) {
    otState.publicacoes.push({
      id: _otUid(), otId,
      tipo: pubTipo || 'atualizacao',
      texto: texto || `Status alterado de ${OT_STATUS_CFG[old]?.label} para ${OT_STATUS_CFG[newStatus]?.label}.`,
      statusAntes: old, statusDepois: newStatus,
      autorId: sess?.userId || null, autorNome: sess?.nomeCompleto || sess?.username || null,
      data: new Date().toISOString(), anexos: [],
    });
  }
  otSave();
  _otRenderKanban();
  showToast(`OT movida para ${OT_STATUS_CFG[newStatus]?.label}.`, 'success');
}

// ── EXCLUIR OT ────────────────────────────────────────────────
let _otDeleteId = null;
function otOpenDeleteConfirm(id) {
  _otDeleteId = id;
  const o = otState.ordens.find(x => x.id === id);
  if (!o) return;
  const el = document.getElementById('ot-delete-title-display');
  if (el) el.textContent = o.titulo;
  const input = document.getElementById('ot-delete-confirm-input');
  if (input) input.value = '';
  otOpenModal('modal-ot-delete');
}
function otConfirmDelete() {
  const o = otState.ordens.find(x => x.id === _otDeleteId);
  if (!o) return;
  const input = document.getElementById('ot-delete-confirm-input')?.value.trim();
  if (input !== o.titulo) { showToast('O título digitado não corresponde.', 'error'); return; }
  otState.ordens = otState.ordens.filter(x => x.id !== _otDeleteId);
  otState.publicacoes = otState.publicacoes.filter(p => p.otId !== _otDeleteId);
  otSave();
  otCloseModal('modal-ot-delete');
  otCloseModal('modal-ot-view');
  _otRenderView_mode();
  showToast('OT excluída.', 'success');
  _otDeleteId = null;
}

// ── MODAL CANCELAMENTO ────────────────────────────────────────
let _otCancelId = null;
function _otOpenCancelModal(otId) {
  _otCancelId = otId;
  document.getElementById('ot-cancel-motivo').value = '';
  otOpenModal('modal-ot-cancel');
}
function otConfirmCancel() {
  const motivo = document.getElementById('ot-cancel-motivo').value.trim();
  if (!motivo) { showToast('Informe o motivo do cancelamento.', 'error'); return; }
  const idx = otState.ordens.findIndex(x => x.id === _otCancelId);
  if (idx < 0) return;
  otState.ordens[idx].status             = 'cancelada';
  otState.ordens[idx].motivoCancelamento = motivo;
  otState.ordens[idx].atualizadoEm      = new Date().toISOString();
  const sess = typeof currentSession !== 'undefined' ? currentSession : null;
  otState.publicacoes.push({
    id: _otUid(), otId: _otCancelId, tipo: 'cancelamento',
    texto: motivo, statusAntes: otState.ordens[idx].status, statusDepois: 'cancelada',
    autorId: sess?.userId || null, autorNome: sess?.nomeCompleto || sess?.username || null,
    data: new Date().toISOString(), anexos: [],
  });
  otSave();
  otCloseModal('modal-ot-cancel');
  _otRenderKanban();
  showToast('OT cancelada.', 'success');
}

// ── MODAL DEVOLUÇÃO ───────────────────────────────────────────
let _otDevolveId = null;
function _otOpenDevolveModal(otId) {
  _otDevolveId = otId;
  document.getElementById('ot-devolve-motivo').value = '';
  otOpenModal('modal-ot-devolve');
}
function otConfirmDevolve() {
  const motivo = document.getElementById('ot-devolve-motivo').value.trim();
  if (!motivo) { showToast('Informe o motivo da devolução.', 'error'); return; }
  _otSetStatus(_otDevolveId, 'em_processo', 'devolucao', motivo);
  otCloseModal('modal-ot-devolve');
}

// ── MODAL FORMULÁRIO OT ───────────────────────────────────────
function otOpenForm(id) {
  _otFormId   = id;
  _otAtivoIdx = null;
  _otRespId   = null;
  const o     = id ? otState.ordens.find(x => x.id === id) : null;

  document.getElementById('ot-form-title').textContent   = id ? 'Editar OT' : 'Nova Ordem de Trabalho';
  document.getElementById('ot-form-save-lbl').textContent = id ? 'Salvar Alterações' : 'Criar OT';

  // Reset campos
  _otFormSetField('ot-f-tipo',       o?.tipo        || 'corretiva');
  _otFormSetField('ot-f-titulo',     o?.titulo      || '');
  _otFormSetField('ot-f-descricao',  o?.descricao   || '');
  _otFormSetField('ot-f-severidade', o?.severidade  || 'media');
  _otFormSetField('ot-f-prazo',      o?.prazo       || '');
  // Alerta padrão em branco para novas OTs; preserva valor existente ao editar
  _otFormSetField('ot-f-prazo-alerta', (o?.prazoAlertaDias !== undefined && o?.prazoAlertaDias !== null) ? o.prazoAlertaDias : '');
  _otFormSetField('ot-f-resp',       o?.responsavelId || '');
  _otFormSetField('ot-f-tipo-falha', o?.tipoFalha   || '');
  _otFormSetField('ot-f-causa',      o?.causaRaiz   || '');
  _otFormSetField('ot-f-deteccao',   o?.metodoDetec || '');
  _otFormSetField('ot-f-dano',       o?.tipoDano    || '');

  // Ativo vinculado
  _otAtivoIdx = o?.ativoIdx ?? null;
  _otRenderAtivoChip();

  // Responsável
  _otBuildRespSelect(o?.responsavelId || '');

  // Toggles
  const ativoFalhou = !!(o?.ativoFalhou);
  const terceirizado = !!(o?.terceirizado);
  _otSetToggle('ot-toggle-falhou', ativoFalhou);
  _otSetToggle('ot-toggle-terceiro', terceirizado);
  document.getElementById('ot-falha-section').classList.toggle('show', ativoFalhou && o?.tipo === 'corretiva');
  document.getElementById('ot-terceiro-section').classList.toggle('show', terceirizado);

  // Selects de empresa/responsável (populados do módulo Empresas)
  if (typeof empPopulateBothSelects === 'function') {
    empPopulateBothSelects('ot-f-empresa', 'ot-f-resp-empresa', o?.empresa || '', o?.respEmpresa || '');
  }

  // Subtarefas
  _otSubTemp = o?.subtarefas ? JSON.parse(JSON.stringify(o.subtarefas)) : [];

  // Catalogs selects
  _otPopulateCatalogSelects();

  // Checar se deve mostrar falha section
  _otOnTipoChange();

  // Aba padrão
  otSwitchFormTab('dados');
  _otRenderSubList();
  otOpenModal('modal-ot-form');
}

function _otFormSetField(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = val;
}

function _otBuildRespSelect(selectedId) {
  _otRespId = selectedId || null;
  _otRenderRespChip();
}

let _otRespId = null;

function _otRenderRespChip() {
  const wrap = document.getElementById('ot-resp-chip-wrap');
  if (!wrap) return;
  const users = typeof authState !== 'undefined' ? authState.users : [];
  const user = _otRespId ? users.find(u => u.id === _otRespId) : null;
  if (user) {
    wrap.innerHTML = `<div style="display:flex;align-items:center;gap:6px;">
      <span class="ativo-selecionado-chip">
        ${_escHtml(user.nomeCompleto)}${user.cargo ? ' · ' + _escHtml(user.cargo) : ''}
        <span class="chip-x" onclick="otClearResp()">×</span>
      </span>
    </div>`;
  } else {
    wrap.innerHTML = `<button type="button" class="btn btn-outline" onclick="otOpenRespSearch()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
      Selecionar Responsável
    </button>`;
  }
}

function otClearResp() { _otRespId = null; _otRenderRespChip(); }

function otOpenRespSearch() {
  const input = document.getElementById('ot-resp-search-input');
  if (input) input.value = '';
  _otRenderRespSearchList('');
  otOpenModal('modal-ot-resp-search');
  setTimeout(() => document.getElementById('ot-resp-search-input')?.focus(), 80);
}

function otRespSearchInput(q) { _otRenderRespSearchList(q.toLowerCase()); }

function _otRenderRespSearchList(q) {
  const list = document.getElementById('ot-resp-search-list');
  if (!list) return;
  const users = (typeof authState !== 'undefined' ? authState.users : [])
    .filter(u => u.ativo !== false)
    .filter(u => !q || `${u.nomeCompleto} ${u.cargo || ''}`.toLowerCase().includes(q));
  if (users.length === 0) {
    list.innerHTML = '<div class="autocomplete-empty">Nenhum usuário encontrado</div>';
    return;
  }
  list.innerHTML = users.map(u => `
    <div class="ativo-search-card" onclick="otSelectResp('${u.id}')">
      <div class="ativo-search-card-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
      </div>
      <div>
        <div class="ativo-search-card-name">${_escHtml(u.nomeCompleto)}</div>
        <div class="ativo-search-card-meta">${u.cargo ? _escHtml(u.cargo) : 'Sem cargo'}</div>
      </div>
    </div>`).join('');
}

function otSelectResp(id) {
  _otRespId = id;
  otCloseModal('modal-ot-resp-search');
  _otRenderRespChip();
}

function _otSetToggle(id, active) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('active', active);
}

function otToggleFalhou() {
  const el  = document.getElementById('ot-toggle-falhou');
  const sec = document.getElementById('ot-falha-section');
  const isCorretiva = document.getElementById('ot-f-tipo')?.value === 'corretiva';
  el?.classList.toggle('active');
  const on = el?.classList.contains('active');
  if (sec) sec.classList.toggle('show', on && isCorretiva);
}

function otToggleTerceiro() {
  const el  = document.getElementById('ot-toggle-terceiro');
  const sec = document.getElementById('ot-terceiro-section');
  el?.classList.toggle('active');
  sec?.classList.toggle('show', el?.classList.contains('active'));
}

function _otOnTipoChange() {
  const tipo = document.getElementById('ot-f-tipo')?.value;
  const falhouToggle = document.getElementById('ot-toggle-falhou');
  const falhouRow    = document.getElementById('ot-falhou-row');
  const falhaSection = document.getElementById('ot-falha-section');
  if (falhouRow) falhouRow.style.display = tipo === 'corretiva' ? '' : 'none';
  if (tipo !== 'corretiva') {
    falhouToggle?.classList.remove('active');
    falhaSection?.classList.remove('show');
  }
}

function otFormTipoChange() { _otOnTipoChange(); }

function _otRenderAtivoChip() {
  const wrap = document.getElementById('ot-ativo-chip-wrap');
  if (!wrap) return;
  const ativo = (_otAtivoIdx !== null && typeof state !== 'undefined') ? state.ativos[_otAtivoIdx] : null;
  if (ativo) {
    wrap.innerHTML = `<div style="display:flex;align-items:center;gap:6px;">
      <span class="ativo-selecionado-chip">
        ${_escHtml(ativo.nome)}${ativo.codigo ? ' · ' + ativo.codigo : ''}
        <span class="chip-x" onclick="otClearAtivo()">×</span>
      </span>
    </div>`;
  } else {
    wrap.innerHTML = `<button type="button" class="btn btn-outline" onclick="otOpenAtivoSearch()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      Vincular Ativo
    </button>`;
  }
}

function otClearAtivo() { _otAtivoIdx = null; _otRenderAtivoChip(); }

function otOpenAtivoSearch() {
  const list = document.getElementById('ot-ativo-search-list');
  const input = document.getElementById('ot-ativo-search-input');
  if (input) input.value = '';
  _otRenderAtivoSearchList('');
  otOpenModal('modal-ot-ativo-search');
}

function otAtivoSearchInput(q) { _otRenderAtivoSearchList(q.toLowerCase()); }

function _otRenderAtivoSearchList(q) {
  const list = document.getElementById('ot-ativo-search-list');
  if (!list || typeof state === 'undefined') return;
  const ativos = state.ativos.map((a, i) => ({ ...a, _idx: i }))
    .filter(a => !q || `${a.nome} ${a.codigo} ${a.setor}`.toLowerCase().includes(q));
  if (ativos.length === 0) {
    list.innerHTML = '<div class="autocomplete-empty">Nenhum ativo encontrado</div>';
    return;
  }
  list.innerHTML = ativos.slice(0, 40).map(a => `
    <div class="ativo-search-card" onclick="otSelectAtivo(${a._idx})">
      <div class="ativo-search-card-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      </div>
      <div>
        <div class="ativo-search-card-name">${_escHtml(a.nome)}</div>
        <div class="ativo-search-card-meta">${a.codigo ? a.codigo + ' · ' : ''}${a.setor || ''}</div>
      </div>
    </div>`).join('');
}

function otSelectAtivo(idx) {
  _otAtivoIdx = idx;
  otCloseModal('modal-ot-ativo-search');
  _otRenderAtivoChip();
  // Preenche setor automaticamente
  const ativo = typeof state !== 'undefined' ? state.ativos[idx] : null;
  if (ativo?.setor) {
    const setorEl = document.getElementById('ot-f-setor-display');
    if (setorEl) setorEl.textContent = ativo.setor;
  }
}

// ── TABS DO FORM ──────────────────────────────────────────────
function otSwitchFormTab(tab) {
  const modal = document.getElementById('modal-ot-form');
  if (!modal) return;
  modal.querySelectorAll('.ot-modal-tab-btn[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  modal.querySelectorAll('.ot-modal-tab-panel[data-tab]').forEach(p => {
    p.classList.toggle('active', p.dataset.tab === tab);
  });
  if (tab === 'subtarefas') _otRenderSubList();
}

function otSwitchViewTab(tab) {
  const modal = document.getElementById('modal-ot-view');
  if (!modal) return;
  modal.querySelectorAll('.ot-modal-tab-btn[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  modal.querySelectorAll('.ot-modal-tab-panel[data-tab]').forEach(p => {
    p.classList.toggle('active', p.dataset.tab === tab);
  });
}

// ── SUBTAREFAS ────────────────────────────────────────────────
function _otRenderSubList() {
  const list = document.getElementById('ot-sub-list');
  if (!list) return;
  if (_otSubTemp.length === 0) {
    list.innerHTML = `<div class="checklist-empty-tip">Nenhuma subtarefa ainda. Adicione ou use o template do tipo de OT.</div>`;
    return;
  }
  list.innerHTML = _otSubTemp.map((s, i) => `
    <div class="ot-sub-item${s.concluida ? ' done' : ''}">
      <div class="ot-sub-check${s.concluida ? ' checked' : ''}" onclick="otToggleSub(${i})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div class="ot-sub-body">
        <div class="ot-sub-desc">${_escHtml(s.descricao)}</div>
        <div class="ot-sub-meta">
          ${s.exigeEvidencia ? `<span class="ot-sub-ev-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px;"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg> Exige evidência</span>` : ''}
          ${s.concluidoPorNome ? `<span>✓ ${_escHtml(s.concluidoPorNome)}</span>` : ''}
        </div>
      </div>
      <div class="ot-sub-actions">
        <button class="ot-sub-del-btn" onclick="otRemoveSub(${i})" title="Remover">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>`).join('');
  const badge = document.querySelector('.ot-modal-tab-btn[data-tab="subtarefas"] .ot-modal-tab-badge');
  if (badge) badge.textContent = _otSubTemp.length;
}

function otToggleSub(i) {
  if (!_otSubTemp[i]) return;
  _otSubTemp[i].concluida = !_otSubTemp[i].concluida;
  if (_otSubTemp[i].concluida) {
    const sess = typeof currentSession !== 'undefined' ? currentSession : null;
    _otSubTemp[i].concluidoPorId   = sess?.userId       || null;
    _otSubTemp[i].concluidoPorNome = sess?.nomeCompleto || null;
    _otSubTemp[i].concluidoEm      = new Date().toISOString();
  } else {
    _otSubTemp[i].concluidoPorId   = null;
    _otSubTemp[i].concluidoPorNome = null;
    _otSubTemp[i].concluidoEm      = null;
  }
  _otRenderSubList();
}

function otAddSub() {
  const input = document.getElementById('ot-sub-new-input');
  const ev    = document.getElementById('ot-sub-new-ev');
  const desc  = input?.value.trim();
  if (!desc) { showToast('Descreva a subtarefa.', 'error'); input?.focus(); return; }
  _otSubTemp.push({ id: _otUid(), descricao: desc, exigeEvidencia: !!(ev?.checked), concluida: false,
    concluidoPorId: null, concluidoPorNome: null, concluidoEm: null, anexos: [] });
  if (input) input.value = '';
  if (ev)    ev.checked  = false;
  _otRenderSubList();
}

function otRemoveSub(i) {
  _otSubTemp.splice(i, 1);
  _otRenderSubList();
}

function otLoadSubTemplate() {
  const tipo = document.getElementById('ot-f-tipo')?.value;
  const tpl  = OT_CHECKLIST_TPL[tipo] || [];
  if (tpl.length === 0) { showToast('Nenhum template para este tipo.', 'info'); return; }
  const novos = tpl.filter(desc => !_otSubTemp.some(s => s.descricao === desc))
    .map(desc => ({ id: _otUid(), descricao: desc, exigeEvidencia: false, concluida: false,
      concluidoPorId: null, concluidoPorNome: null, concluidoEm: null, anexos: [] }));
  _otSubTemp.push(...novos);
  _otRenderSubList();
  showToast(`${novos.length} subtarefa(s) do template adicionadas.`, 'success');
}

// ── SALVAR OT ─────────────────────────────────────────────────
function otSaveForm() {
  const titulo = document.getElementById('ot-f-titulo')?.value.trim();
  if (!titulo) { showToast('Informe o título da OT.', 'error'); otSwitchFormTab('dados'); return; }
  const tipo = document.getElementById('ot-f-tipo')?.value;
  if (!tipo)  { showToast('Selecione o tipo da OT.', 'error'); return; }
  if (_otAtivoIdx === null) { showToast('Vincule um ativo à OT.', 'error'); otSwitchFormTab('dados'); return; }
  const prazo = document.getElementById('ot-f-prazo')?.value;
  if (!prazo) { showToast('Informe o prazo da OT.', 'error'); otSwitchFormTab('dados'); return; }
  if (!_otRespId) { showToast('Selecione o responsável técnico.', 'error'); otSwitchFormTab('dados'); return; }

  const respId  = _otRespId || '';
  const respUser = respId && typeof authState !== 'undefined'
    ? authState.users.find(u => u.id === respId) : null;

  const sess = typeof currentSession !== 'undefined' ? currentSession : null;
  const ativoFalhou  = !!(document.getElementById('ot-toggle-falhou')?.classList.contains('active')) && tipo === 'corretiva';
  const terceirizado = !!(document.getElementById('ot-toggle-terceiro')?.classList.contains('active'));

  const now = new Date().toISOString();

  if (_otFormId) {
    // Editar existente
    const idx = otState.ordens.findIndex(x => x.id === _otFormId);
    if (idx < 0) return;
    const cur = otState.ordens[idx];
    Object.assign(otState.ordens[idx], {
      tipo, titulo,
      descricao:  document.getElementById('ot-f-descricao')?.value.trim()  || '',
      severidade: document.getElementById('ot-f-severidade')?.value || 'media',
      prazo:      document.getElementById('ot-f-prazo')?.value      || '',
      ativoIdx:   _otAtivoIdx,
      responsavelId:   respId,
      responsavelNome: respUser?.nomeCompleto || '',
      prazoAlertaDias: (() => {
        const raw = document.getElementById('ot-f-prazo-alerta')?.value;
        if (raw === '' || raw === null || raw === undefined) return null;
        const v = parseInt(raw, 10);
        return Number.isNaN(v) || v < 0 ? null : v;
      })(),
      terceirizado,
      empresa:     terceirizado ? (document.getElementById('ot-f-empresa')?.value.trim()      || '') : '',
      respEmpresa: terceirizado ? (document.getElementById('ot-f-resp-empresa')?.value.trim() || '') : '',
      ativoFalhou,
      tipoFalha:   ativoFalhou ? (document.getElementById('ot-f-tipo-falha')?.value || '') : '',
      causaRaiz:   ativoFalhou ? (document.getElementById('ot-f-causa')?.value      || '') : '',
      metodoDetec: ativoFalhou ? (document.getElementById('ot-f-deteccao')?.value   || '') : '',
      tipoDano:    ativoFalhou ? (document.getElementById('ot-f-dano')?.value        || '') : '',
      subtarefas:  _otSubTemp.slice(),
      atualizadoEm: now,
    });
  } else {
    // Nova OT
    // Status inicial: se tem responsável, pode ser em_processo; caso contrário pendente
    const statusInicial = 'pendente';
    otState.ordens.push({
      id: _otUid(),
      numero: _otNextNum(),
      tipo, titulo,
      descricao:  document.getElementById('ot-f-descricao')?.value.trim()  || '',
      status:     statusInicial,
      severidade: document.getElementById('ot-f-severidade')?.value || 'media',
      prazo:      document.getElementById('ot-f-prazo')?.value      || '',
      ativoIdx:   _otAtivoIdx,
      setor:      (_otAtivoIdx !== null && typeof state !== 'undefined')
                    ? (state.ativos[_otAtivoIdx]?.setor || '') : '',
      solicitanteId:   sess?.userId       || null,
      solicitanteNome: sess?.nomeCompleto || sess?.username || '',
      responsavelId:   respId,
      responsavelNome: respUser?.nomeCompleto || '',
      prazoAlertaDias: (() => {
        const raw = document.getElementById('ot-f-prazo-alerta')?.value;
        if (raw === '' || raw === null || raw === undefined) return null;
        const v = parseInt(raw, 10);
        return Number.isNaN(v) || v < 0 ? null : v;
      })(),
      terceirizado,
      empresa:     terceirizado ? (document.getElementById('ot-f-empresa')?.value.trim()      || '') : '',
      respEmpresa: terceirizado ? (document.getElementById('ot-f-resp-empresa')?.value.trim() || '') : '',
      ativoFalhou,
      tipoFalha:   ativoFalhou ? (document.getElementById('ot-f-tipo-falha')?.value || '') : '',
      causaRaiz:   ativoFalhou ? (document.getElementById('ot-f-causa')?.value      || '') : '',
      metodoDetec: ativoFalhou ? (document.getElementById('ot-f-deteccao')?.value   || '') : '',
      tipoDano:    ativoFalhou ? (document.getElementById('ot-f-dano')?.value        || '') : '',
      subtarefas:  _otSubTemp.slice(),
      motivoCancelamento: '',
      dataConclusao: '',
      dataAbertura: now.split('T')[0],
      atualizadoEm: now,
      criadoEm:    now,
      criadoPorId:   sess?.userId       || null,
      criadoPorNome: sess?.nomeCompleto || sess?.username || '',
    });
  }

  otSave();
  otCloseModal('modal-ot-form');
  _otRenderKanban();
  showToast(_otFormId ? 'OT atualizada.' : 'OT criada com sucesso!', 'success');
}

// ── VIEW DA OT ────────────────────────────────────────────────
function otOpenView(id) {
  _otViewId = id;
  const o = otState.ordens.find(x => x.id === id);
  if (!o) return;
  _otRenderView(o);
  otOpenModal('modal-ot-view');
}

function _otRenderView(o) {
  const ativo = (o.ativoIdx !== null && o.ativoIdx !== undefined && typeof state !== 'undefined')
    ? state.ativos[o.ativoIdx] : null;
  const tipoCfg = OT_TIPO_CFG[o.tipo] || {};
  const sevCfg  = OT_SEV_CFG[o.severidade]  || {};

  const sub = o.subtarefas || [];
  const subDone = sub.filter(s => s.concluida).length;
  const pct = sub.length > 0 ? Math.round(subDone / sub.length * 100) : 0;

  const pubs = otState.publicacoes.filter(p => p.otId === o.id)
    .sort((a, b) => a.data < b.data ? 1 : -1);

  const canEdit = o.status !== 'cancelada';

  const el = document.getElementById('ot-view-body');
  if (!el) return;

  const OT_STATUS_ICONS = {
    pendente:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    em_processo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>`,
    em_revisao:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    concluida:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><polyline points="20 6 9 17 4 12"/></svg>`,
    cancelada:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  };

  // Publicações por tipo para sub-abas
  // conclusao, transferencia, cancelamento e devolucao são agrupados em 'atualizacao'
  const PUB_TABS = [
    { key: 'comentario',  label: 'Comentários', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>` },
    { key: 'evidencia',   label: 'Evidências',  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>` },
    { key: 'atualizacao', label: 'Atualizações', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>` },
  ];
  const ATUALIZACAO_TIPOS = new Set(['atualizacao','conclusao','transferencia','cancelamento','devolucao']);

  const pubsByTipo = {
    comentario:  pubs.filter(p => p.tipo === 'comentario'),
    evidencia:   pubs.filter(p => p.tipo === 'evidencia'),
    atualizacao: pubs.filter(p => ATUALIZACAO_TIPOS.has(p.tipo)),
  };
  const firstTabWithPubs = PUB_TABS.find(t => pubsByTipo[t.key]?.length > 0)?.key || 'comentario';

  el.innerHTML = `
<div class="ot-view-hero">
  <div class="ot-view-hero-num">${_escHtml(o.numero)} · Aberta em ${_fmtDate(o.dataAbertura)}</div>
  <div class="ot-view-hero-title">${_escHtml(o.titulo)}</div>
  <div class="ot-view-hero-badges">
    <span class="ot-view-hero-badge"><span class="ot-badge ${tipoCfg.cls}" style="font-size:11px;">${tipoCfg.label}</span></span>
    <span class="ot-view-hero-badge"><span class="ot-badge ${sevCfg.cls}" style="font-size:11px;">${sevCfg.label}</span></span>
    ${o.terceirizado ? `<span class="ot-view-hero-badge"><span class="ot-badge ot-badge-terceiro" style="font-size:11px;color:#fff;background:rgba(139,92,246,0.35);border-color:rgba(139,92,246,0.55);">Terceirizado</span></span>` : ''}
  </div>
</div>

<div class="ot-modal-tabs" style="margin-bottom:16px;">
  <button class="ot-modal-tab-btn active" data-tab="ordem" onclick="otSwitchViewTab('ordem')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    Informações
  </button>
  <button class="ot-modal-tab-btn" data-tab="subtarefas" onclick="otSwitchViewTab('subtarefas')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
    Subtarefas <span class="ot-modal-tab-badge">${sub.length}</span>
  </button>
  <button class="ot-modal-tab-btn" data-tab="publicacoes" onclick="otSwitchViewTab('publicacoes')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
    Publicações <span class="ot-modal-tab-badge">${pubs.length}</span>
  </button>
</div>

<div class="ot-modal-tab-panel active" data-tab="ordem">
<div class="detail-grid" style="margin-bottom:16px;">
  <div class="detail-card">
    <div class="detail-label">Solicitante</div>
    <div class="detail-value">${_escHtml(o.solicitanteNome || '—')}</div>
  </div>
  <div class="detail-card">
    <div class="detail-label">Responsável Técnico</div>
    <div class="detail-value">${_escHtml(o.responsavelNome || '—')}</div>
  </div>
  ${ativo ? `<div class="detail-card">
    <div class="detail-label">Ativo Vinculado</div>
    <div class="detail-value">${_escHtml(ativo.nome)}${ativo.codigo ? '<br><span style="font-size:12px;font-family:DM Mono,monospace;color:var(--text-muted)">' + ativo.codigo + '</span>' : ''}</div>
  </div>` : ''}
  <div class="detail-card">
    <div class="detail-label">Setor</div>
    <div class="detail-value">${_escHtml(o.setor || (ativo?.setor) || '—')}</div>
  </div>
  <div class="detail-card">
    <div class="detail-label">Prazo</div>
    <div class="detail-value">${o.prazo ? _fmtDate(o.prazo) : '—'}</div>
  </div>
  ${o.prazoAlertaDias !== undefined && o.prazoAlertaDias !== null ? `<div class="detail-card">
    <div class="detail-label">Alerta</div>
    <div class="detail-value">${_escHtml(String(o.prazoAlertaDias))} dia(s)</div>
  </div>` : ''}
  ${o.dataConclusao ? `<div class="detail-card">
    <div class="detail-label">Data de Conclusão</div>
    <div class="detail-value">${_fmtDate(o.dataConclusao)}</div>
  </div>` : ''}
</div>
${o.descricao ? `<div class="detail-note" style="margin-bottom:16px;">
  <div class="detail-label" style="margin-bottom:6px;">Descrição</div>
  <div style="font-size:13px;color:var(--text-primary);line-height:1.6;">${_escHtml(o.descricao)}</div>
</div>` : ''}
${o.ativoFalhou && o.tipo === 'corretiva' ? `
<div class="form-section-title" style="margin-bottom:12px;">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
  Análise de Falha
</div>
<div class="detail-grid" style="margin-bottom:16px;">
  <div class="detail-card"><div class="detail-label">Tipo de Falha</div><div class="detail-value">${_escHtml(o.tipoFalha || '—')}</div></div>
  <div class="detail-card"><div class="detail-label">Causa Raiz</div><div class="detail-value">${_escHtml(o.causaRaiz || '—')}</div></div>
  <div class="detail-card"><div class="detail-label">Método de Detecção</div><div class="detail-value">${_escHtml(o.metodoDetec || '—')}</div></div>
  <div class="detail-card"><div class="detail-label">Tipo de Dano</div><div class="detail-value">${_escHtml(o.tipoDano || '—')}</div></div>
</div>` : ''}
${o.terceirizado ? `
<div class="form-section-title" style="margin-bottom:12px;">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a7 7 0 0114 0v2"/></svg>
  Dados do Terceirizado
</div>
<div class="detail-grid" style="margin-bottom:16px;">
  ${o.empresa ? (() => {
    const emp = typeof empState !== 'undefined' ? empState.empresas.find(e => e.nome === o.empresa) : null;
    const respObj = emp?.responsaveis?.find(r => r.nome === o.respEmpresa);
    const whatsHtml = respObj?.contato
      ? `<a href="https://wa.me/${respObj.contato.replace(/\D/g,'')}" target="_blank" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#25d366;color:#fff;text-decoration:none;margin-left:4px;" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="currentColor" style="width:11px;height:11px;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.557 4.12 1.528 5.852L0 24l6.335-1.507A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.79 9.79 0 01-5.012-1.376l-.36-.213-3.757.893.946-3.656-.235-.376A9.79 9.79 0 012.182 12C2.182 6.565 6.565 2.182 12 2.182S21.818 6.565 21.818 12 17.435 21.818 12 21.818z"/></svg></a>` : '';
    return `<div class="detail-card"><div class="detail-label">Empresa / Prestador</div>
      <div class="detail-value">${_escHtml(o.empresa)}
        ${emp?.email ? `<div style="font-size:11px;color:var(--text-muted);">${_escHtml(emp.email)}</div>` : ''}
        ${(emp?.contatos||[]).filter(c=>c.tipo==='WhatsApp').map(c=>`<div style="font-size:11px;color:var(--cyan);display:flex;align-items:center;gap:4px;">${_escHtml(c.valor)}<a href="https://wa.me/${c.valor.replace(/\D/g,'')}" target="_blank" style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:#25d366;color:#fff;text-decoration:none;" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="currentColor" style="width:9px;height:9px;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.557 4.12 1.528 5.852L0 24l6.335-1.507A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.79 9.79 0 01-5.012-1.376l-.36-.213-3.757.893.946-3.656-.235-.376A9.79 9.79 0 012.182 12C2.182 6.565 6.565 2.182 12 2.182S21.818 6.565 21.818 12 17.435 21.818 12 21.818z"/></svg></a></div>`).join('')}
      </div>
    </div>
    ${o.respEmpresa ? `<div class="detail-card"><div class="detail-label">Responsável pela empresa</div>
      <div class="detail-value" style="display:flex;align-items:center;gap:6px;">
        ${_escHtml(o.respEmpresa)}${whatsHtml}
        ${respObj?.contato ? `<div style="font-size:11px;color:var(--cyan);">${_escHtml(respObj.contato)}</div>` : ''}
      </div>
    </div>` : ''}`;
  })() : ''}
</div>` : ''}
${o.motivoCancelamento ? `<div class="detail-note" style="border-left-color:var(--red);margin-bottom:16px;">
  <div class="detail-label" style="margin-bottom:6px;color:var(--red);">Motivo do Cancelamento</div>
  <div style="font-size:13px;">${_escHtml(o.motivoCancelamento)}</div>
</div>` : ''}
</div>

<div class="ot-modal-tab-panel" data-tab="subtarefas">
  ${sub.length > 0 ? `
  <div class="form-section-title" style="margin-bottom:10px;">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
    Subtarefas — ${subDone}/${sub.length} (${pct}%)
  </div>
  <div class="ot-sub-list" style="margin-bottom:16px;">
  ${sub.map((s, i) => {
    const evPubs = otState.publicacoes.filter(p => p.otId === o.id && p.tipo === 'evidencia' && p.subtarefaId === s.id);
    const hasEvidence = evPubs.length > 0;
    const blocked = s.exigeEvidencia && !hasEvidence && !s.concluida && canEdit;
    return `<div class="ot-sub-item${s.concluida ? ' done' : ''}" style="cursor:${canEdit && !blocked ? 'pointer' : 'default'}" onclick="${canEdit && !blocked ? `otViewToggleSub('${o.id}',${i})` : blocked ? `showToast('Adicione uma publicação de evidência vinculada a esta subtarefa antes de concluir.','error')` : ''}">
      <div class="ot-sub-check${s.concluida ? ' checked' : ''}${blocked ? ' blocked' : ''}">
        ${blocked ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;color:#b45309;"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`}
      </div>
      <div class="ot-sub-body">
        <div class="ot-sub-desc">${_escHtml(s.descricao)}</div>
        <div class="ot-sub-meta">
          ${s.exigeEvidencia ? `<span class="ot-sub-ev-badge">${hasEvidence ? '✓ Evidência vinculada' : 'Exige evidência'}</span>` : ''}
          ${s.concluidoPorNome ? `<span>✓ ${_escHtml(s.concluidoPorNome)} · ${s.concluidoEm ? _fmtDateTime(s.concluidoEm) : ''}</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('')}
  </div>` : `<div class="checklist-empty-tip">Nenhuma subtarefa ainda.</div>`}
</div>

<div class="ot-modal-tab-panel" data-tab="publicacoes">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
    <div style="font-size:14px;font-weight:700;color:var(--text-primary);">Publicações</div>
    ${canEdit ? `<button class="btn btn-primary" style="padding:6px 14px;font-size:12px;" onclick="otOpenPubModal()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Nova Publicação
    </button>` : ''}
  </div>
  <!-- Sub-abas de publicação -->
  <div class="ot-pub-subtabs" id="ot-pub-subtabs">
    ${PUB_TABS.map(t => {
      const count = pubsByTipo[t.key]?.length || 0;
      return `<button class="ot-pub-subtab-btn${t.key === firstTabWithPubs ? ' active' : ''}" data-pubtab="${t.key}" onclick="otSwitchPubTab('${t.key}')">
        ${t.icon}
        <span>${t.label}</span>
        ${count > 0 ? `<span class="ot-pub-subtab-count">${count}</span>` : ''}
      </button>`;
    }).join('')}
  </div>
  ${PUB_TABS.map(t => {
    const tPubs = pubsByTipo[t.key] || [];
    return `<div class="ot-pub-subtab-panel${t.key === firstTabWithPubs ? ' active' : ''}" data-pubtab="${t.key}">
      ${tPubs.length === 0
        ? `<div class="checklist-empty-tip">Nenhuma publicação de ${t.label.toLowerCase()} ainda.</div>`
        : `<div class="ot-pub-log">${tPubs.map(p => _otPubEntryHTML(p)).join('')}</div>`}
    </div>`;
  }).join('')}
</div>
`;

  // Status dropdown moderno com ícones e cores
  const hdrRight = document.querySelector('#modal-ot-view .modal-header > div:nth-child(2)');
  if (hdrRight) {
    const existing = hdrRight.querySelector('.ot-status-wrap');
    if (existing) existing.remove();
    const curCfg = OT_STATUS_CFG[o.status] || {};
    const wrapHtml = `
      <div class="ot-status-wrap" style="position:relative;margin-right:8px;">
        <button class="ot-status-dropdown-btn ot-status-btn-${o.status}" id="ot-status-btn">
          ${OT_STATUS_ICONS[o.status] || ''}
          <span>${curCfg.label || 'Status'}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px;margin-left:4px;"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>`;
    hdrRight.insertAdjacentHTML('afterbegin', wrapHtml);
    const btn = hdrRight.querySelector('#ot-status-btn');
    if (btn) {
      const existingMenu = document.getElementById('ot-status-menu');
      if (existingMenu) existingMenu.remove();
      const menu = document.createElement('div');
      menu.id = 'ot-status-menu';
      menu.className = 'ot-status-menu-dropdown';
      document.body.appendChild(menu);
      const statuses = OT_STATUSES.filter(s => s !== o.status);
      menu.innerHTML = `<div class="ot-status-menu-header">Alterar Status</div>` + statuses.map(s => {
        const cfg = OT_STATUS_CFG[s] || {};
        return `<div class="ot-status-menu-item ot-status-item-${s}" data-status="${s}">
          ${OT_STATUS_ICONS[s] || ''}
          <span>${cfg.label || s}</span>
        </div>`;
      }).join('');
      menu.addEventListener('click', ev => {
        const item = ev.target.closest('.ot-status-menu-item');
        if (!item) return;
        const status = item.dataset.status;
        if (status) otChangeStatusFromView(o.id, status);
        menu.classList.remove('open');
      });
      btn.onclick = ev => {
        ev.stopPropagation();
        document.querySelectorAll('.ot-status-menu-dropdown').forEach(m => { if (m !== menu) m.classList.remove('open'); });
        if (menu.classList.contains('open')) { menu.classList.remove('open'); return; }
        const rect = btn.getBoundingClientRect();
        menu.style.minWidth = Math.max(rect.width, 180) + 'px';
        menu.style.top  = (rect.bottom + 6) + 'px';
        menu.style.left = (rect.right - Math.max(rect.width, 180)) + 'px';
        menu.classList.add('open');
      };
      if (!window._otStatusMenuBound) {
        document.addEventListener('click', () => {
          document.querySelectorAll('.ot-status-menu-dropdown').forEach(m => m.classList.remove('open'));
        });
        window._otStatusMenuBound = true;
      }
    }
  }
}

function otSwitchPubTab(key) {
  document.querySelectorAll('.ot-pub-subtab-btn').forEach(b => b.classList.toggle('active', b.dataset.pubtab === key));
  document.querySelectorAll('.ot-pub-subtab-panel').forEach(p => p.classList.toggle('active', p.dataset.pubtab === key));
}

// Helper to change status from within the view and keep the same tab open
function otChangeStatusFromView(otId, targetStatus) {
  const currentTab = document.querySelector('#modal-ot-view .ot-modal-tab-btn.active')?.dataset.tab || 'ordem';
  _otTryTransition(otId, targetStatus);
  // Re-render view and restore tab (if view still open)
  setTimeout(() => {
    if (_otViewId === otId) {
      const o = otState.ordens.find(x => x.id === otId);
      if (o) {
        _otRenderView(o);
        otSwitchViewTab(currentTab);
      }
    }
  }, 120);
}

function _otPubEntryHTML(p) {
  const cfg = OT_PUB_CFG[p.tipo] || OT_PUB_CFG.atualizacao;
  const anexos = p.anexos || [];
  return `<div class="ot-pub-entry ot-pub-entry-clickable" onclick="otOpenPubView('${p.id}')">
  <div class="ot-pub-timeline">
    <div class="ot-pub-dot ot-pub-dot-${p.tipo}"></div>
  </div>
  <div class="ot-pub-body">
    <div class="ot-pub-header">
      <span class="ot-pub-tipo-badge" style="background:${cfg.bg};color:${cfg.color}">${cfg.label}</span>
      <span class="ot-pub-autor">${_escHtml(p.autorNome || '—')}</span>
      <span class="ot-pub-data">${_fmtDateTime(p.data)}</span>
    </div>
    ${p.texto ? `<div class="ot-pub-texto">${_escHtml(p.texto.length > 120 ? p.texto.slice(0,120)+'…' : p.texto)}</div>` : ''}
    ${anexos.length > 0 ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${anexos.length} anexo(s)</div>` : ''}
  </div>
</div>`;
}

function otViewToggleSub(otId, i) {
  const idx = otState.ordens.findIndex(x => x.id === otId);
  if (idx < 0) return;
  const sub = otState.ordens[idx].subtarefas;
  if (!sub[i]) return;
  // preserve current active tab in view
  const currentTab = document.querySelector('#modal-ot-view .ot-modal-tab-btn.active')?.dataset.tab || 'subtarefas';
  sub[i].concluida = !sub[i].concluida;
  if (sub[i].concluida) {
    const sess = typeof currentSession !== 'undefined' ? currentSession : null;
    sub[i].concluidoPorId   = sess?.userId       || null;
    sub[i].concluidoPorNome = sess?.nomeCompleto || null;
    sub[i].concluidoEm      = new Date().toISOString();
  } else {
    sub[i].concluidoPorId = sub[i].concluidoPorNome = sub[i].concluidoEm = null;
  }
  otSave();
  _otRenderKanban();
  _otRenderView(otState.ordens[idx]);
  // restore previously active tab
  otSwitchViewTab(currentTab);
}

// ── PUBLICAÇÃO DA OT ──────────────────────────────────────────
function otOpenPubModal() {
  _otPubReturnTab = document.querySelector('#modal-ot-view .ot-modal-tab-btn.active')?.dataset.tab || 'publicacoes';
  _otEditPubId = null;
  _otPubAnexos = [];
  const tipoSel = document.getElementById('ot-pub-tipo');
  if (tipoSel) tipoSel.value = 'comentario';
  const texto = document.getElementById('ot-pub-texto');
  if (texto) texto.value = '';
  _otUpdatePubCharCount();
  _otRenderPubAnexos();
  _otRenderPubSubtarefaSelect();
  if (typeof resetUploadZone === 'function') resetUploadZone('ot-pub');
  const titleEl = document.getElementById('ot-pub-modal-title');
  if (titleEl) titleEl.textContent = 'Nova Publicação';
  const subEl = document.getElementById('ot-pub-modal-subtitle');
  if (subEl) subEl.textContent = 'Registre comentário, atualização ou evidência';
  const btnEl = document.getElementById('btn-ot-confirmar-pub');
  if (btnEl) btnEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;"><polyline points="20 6 9 17 4 12"/></svg> Confirmar Publicação`;
  otOpenModal('modal-ot-pub');
}

function otOpenEditPub(pubId) {
  const p = otState.publicacoes.find(x => x.id === pubId);
  if (!p) return;
  _otPubReturnTab = document.querySelector('#modal-ot-view .ot-modal-tab-btn.active')?.dataset.tab || 'publicacoes';
  _otEditPubId = pubId;
  _otPubAnexos = (p.anexos || []).slice();

  const tipoSel = document.getElementById('ot-pub-tipo');
  if (tipoSel) { tipoSel.value = p.tipo; }
  const texto = document.getElementById('ot-pub-texto');
  if (texto) texto.value = p.texto || '';
  _otUpdatePubCharCount();
  _otRenderPubAnexos();
  _otRenderPubSubtarefaSelect();
  // pré-selecionar subtarefa
  const subSel = document.getElementById('ot-pub-subtarefa-sel');
  if (subSel && p.subtarefaId) subSel.value = p.subtarefaId;
  otPubTipoChange();
  if (typeof resetUploadZone === 'function') resetUploadZone('ot-pub');
  const titleEl = document.getElementById('ot-pub-modal-title');
  if (titleEl) titleEl.textContent = 'Editar Publicação';
  const subEl = document.getElementById('ot-pub-modal-subtitle');
  if (subEl) subEl.textContent = 'Atualize o conteúdo desta publicação';
  const btnEl = document.getElementById('btn-ot-confirmar-pub');
  if (btnEl) btnEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;"><polyline points="20 6 9 17 4 12"/></svg> Salvar Alterações`;
  otCloseModal('modal-ot-pub-view');
  otOpenModal('modal-ot-pub');
}

function _otUpdatePubCharCount() {
  const texto = document.getElementById('ot-pub-texto');
  const counter = document.getElementById('ot-pub-char-count');
  if (!texto || !counter) return;
  const max = 1000;
  const len = texto.value.length;
  counter.textContent = `${len}/${max}`;
  counter.style.color = len > max * 0.9 ? 'var(--red)' : 'var(--text-muted)';
  if (len > max) texto.value = texto.value.slice(0, max);
}

function otPubTipoChange() {
  const tipo = document.getElementById('ot-pub-tipo')?.value;
  const subRow = document.getElementById('ot-pub-subtarefa-row');
  if (subRow) subRow.style.display = tipo === 'evidencia' ? '' : 'none';
}

function _otRenderPubSubtarefaSelect() {
  const sel = document.getElementById('ot-pub-subtarefa-sel');
  if (!sel) return;
  const o = _otViewId ? otState.ordens.find(x => x.id === _otViewId) : null;
  const subs = (o?.subtarefas || []).filter(s => s.exigeEvidencia);
  sel.innerHTML = `<option value="">— Nenhuma (publicação geral) —</option>` +
    subs.map(s => `<option value="${s.id}">${_escHtml(s.descricao)}</option>`).join('');
}

function otAddPubAnexo(anexo) {
  _otPubAnexos.push(anexo);
  _otRenderPubAnexos();
}

function otRemovePubAnexo(i) {
  _otPubAnexos.splice(i, 1);
  _otRenderPubAnexos();
}

function _otRenderPubAnexos() {
  const list = document.getElementById('ot-pub-anexo-list');
  if (!list) return;
  if (_otPubAnexos.length === 0) { list.innerHTML = ''; return; }
  list.innerHTML = _otPubAnexos.map((a, i) => `
    <div class="anexo-item">
      <a href="${a.url}" target="_blank" style="color:var(--cyan);display:flex;align-items:center;gap:5px;text-decoration:none;font-size:12.5px;font-weight:500;flex:1;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        ${_escHtml(a.titulo)}
      </a>
      <button class="anexo-del" onclick="otRemovePubAnexo(${i})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:11px;height:11px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`).join('');
}

function otConfirmPub() {
  if (typeof _uploadsInProgress !== 'undefined' && _uploadsInProgress['ot-pub']) {
    showToast('Aguarde o término do envio do arquivo.', 'info'); return;
  }
  if (typeof _uploadQueues !== 'undefined' && _uploadQueues['ot-pub']?.file) {
    showToast('Envie o arquivo selecionado antes de confirmar.', 'error'); return;
  }
  const texto = document.getElementById('ot-pub-texto')?.value.trim();
  const tipo  = document.getElementById('ot-pub-tipo')?.value || 'comentario';
  if (!texto && _otPubAnexos.length === 0) {
    showToast('Informe uma descrição ou adicione um anexo.', 'error'); return;
  }
  const subtarefaId = tipo === 'evidencia'
    ? (document.getElementById('ot-pub-subtarefa-sel')?.value || null)
    : null;

  // Modo edição: atualiza publicação existente
  if (_otEditPubId) {
    const idx = otState.publicacoes.findIndex(x => x.id === _otEditPubId);
    if (idx !== -1) {
      otState.publicacoes[idx] = {
        ...otState.publicacoes[idx],
        tipo, texto, subtarefaId: subtarefaId || null,
        anexos: _otPubAnexos.slice(),
        editadoEm: new Date().toISOString(),
      };
      otSave();
      otCloseModal('modal-ot-pub');
      if (typeof resetUploadZone === 'function') resetUploadZone('ot-pub');
      _otPubAnexos = [];
      _otEditPubId = null;
      const o = otState.ordens.find(x => x.id === _otViewId);
      if (o) { _otRenderView(o); otSwitchViewTab(_otPubReturnTab); }
      showToast('Publicação atualizada.', 'success');
    }
    return;
  }

  const sess = typeof currentSession !== 'undefined' ? currentSession : null;
  const pub = {
    id: _otUid(), otId: _otViewId, tipo, texto,
    subtarefaId: subtarefaId || null,
    autorId: sess?.userId || null, autorNome: sess?.nomeCompleto || sess?.username || null,
    data: new Date().toISOString(), anexos: _otPubAnexos.slice(),
    statusAntes: null, statusDepois: null,
  };
  otState.publicacoes.push(pub);
  otSave();
  otCloseModal('modal-ot-pub');
  if (typeof resetUploadZone === 'function') resetUploadZone('ot-pub');
  _otPubAnexos = [];
  const o = otState.ordens.find(x => x.id === _otViewId);
  if (o) {
    _otRenderView(o);
    otSwitchViewTab(_otPubReturnTab);
    otSwitchPubTab('publicacoes');
  }
  showToast('Publicação registrada.', 'success');
}

// ── EXCLUIR PUBLICAÇÃO ────────────────────────────────────────
let _otDeletePubId = null;
function otOpenDeletePub(pubId) {
  _otDeletePubId = pubId;
  otOpenModal('modal-ot-delete-pub');
}
function otConfirmDeletePub() {
  if (!_otDeletePubId) return;
  otState.publicacoes = otState.publicacoes.filter(p => p.id !== _otDeletePubId);
  otSave();
  otCloseModal('modal-ot-delete-pub');
  otCloseModal('modal-ot-pub-view');
  const currentTab = document.querySelector('#modal-ot-view .ot-modal-tab-btn.active')?.dataset.tab || 'publicacoes';
  const o = otState.ordens.find(x => x.id === _otViewId);
  if (o) { _otRenderView(o); otSwitchViewTab(currentTab); }
  showToast('Publicação excluída.', 'success');
  _otDeletePubId = null;
}

// ── VER PUBLICAÇÃO ────────────────────────────────────────────
let _otViewPubId  = null;
let _otEditPubId  = null; // null = nova publicação, string = editando
let _otPubReturnTab = 'publicacoes'; // aba ativa ao abrir modal de publicação
function otOpenPubView(pubId) {
  _otViewPubId = pubId;
  const p = otState.publicacoes.find(x => x.id === pubId);
  if (!p) return;
  const cfg = OT_PUB_CFG[p.tipo] || OT_PUB_CFG.atualizacao;
  const anexos = p.anexos || [];
  const o = _otViewId ? otState.ordens.find(x => x.id === _otViewId) : null;
  const sub = p.subtarefaId ? o?.subtarefas?.find(s => s.id === p.subtarefaId) : null;

  const iconMap = {
    pdf:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:32px;height:32px;color:#e63946;"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>`,
    img:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:32px;height:32px;color:#00a8cc;"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    other: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:32px;height:32px;color:#718096;"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  };
  const getIcon = (a) => {
    const ext = (a.titulo || '').split('.').pop().toLowerCase();
    if (ext === 'pdf') return iconMap.pdf;
    if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return iconMap.img;
    return iconMap.other;
  };

  const el = document.getElementById('ot-pub-view-body');
  if (el) el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
      <span class="ot-pub-tipo-badge" style="background:${cfg.bg};color:${cfg.color};font-size:12px;padding:3px 10px;">${cfg.label}</span>
      <span style="font-size:12px;color:var(--text-muted);">${_escHtml(p.autorNome || '—')} · ${_fmtDateTime(p.data)}</span>
    </div>
    ${sub ? `<div style="font-size:12px;color:var(--amber);margin-bottom:10px;display:flex;align-items:center;gap:5px;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><polyline points="9 11 12 14 22 4"/></svg>
      Subtarefa: ${_escHtml(sub.descricao)}
    </div>` : ''}
    ${p.texto ? `<textarea readonly style="width:100%;box-sizing:border-box;font-size:14px;color:var(--text-primary);line-height:1.6;margin-bottom:14px;background:var(--bg);border:1.5px solid var(--border);border-radius:var(--radius);padding:10px 12px;resize:none;font-family:inherit;min-height:180px;max-height:400px;overflow-y:auto;word-break:break-word;cursor:default;">${_escHtml(p.texto)}</textarea>` : ''}
    ${anexos.length > 0 ? `
      <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px;">Anexos</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;">
        ${anexos.map(a => `
          <a href="${a.url}" target="_blank" style="display:flex;flex-direction:column;align-items:center;gap:6px;text-decoration:none;background:var(--bg);border:1.5px solid var(--border);border-radius:10px;padding:14px 16px;min-width:80px;transition:box-shadow .15s;cursor:pointer;" onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,.1)'" onmouseout="this.style.boxShadow=''">
            ${getIcon(a)}
            <span style="font-size:11px;color:var(--text-secondary);font-weight:600;text-align:center;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escHtml(a.titulo)}</span>
          </a>`).join('')}
      </div>` : ''}
  `;
  otOpenModal('modal-ot-pub-view');
}

// ── CARD MENU (ações rápidas) ─────────────────────────────────
function otCardMenu(id) {
  const o = otState.ordens.find(x => x.id === id);
  if (!o) return;
  // Abre a view com o menu de ações disponível via botões no footer
  otOpenView(id);
}

// ── CATÁLOGO ──────────────────────────────────────────────────
let _otCatKey = null;
const OT_CAT_LABELS = {
  tiposFalha:   'Tipos de Falha',
  causasRaiz:   'Causas Raiz',
  metodosDetec: 'Métodos de Detecção',
  tiposDano:    'Tipos de Dano Causado',
};

function otOpenCatalog(key) {
  _otCatKey = key;
  document.getElementById('ot-cat-title').textContent = OT_CAT_LABELS[key] || key;
  document.getElementById('ot-cat-new-input').value = '';
  _otRenderCatList();
  otOpenModal('modal-ot-cat');
}

function _otRenderCatList() {
  const list = document.getElementById('ot-cat-list');
  if (!list || !_otCatKey) return;
  const items = otState.catalogos[_otCatKey] || [];
  if (items.length === 0) {
    list.innerHTML = '<div class="checklist-empty-tip" style="padding:12px;">Nenhum item cadastrado.</div>';
    return;
  }
  list.innerHTML = items.map((item, i) => `
    <div class="ot-cat-item">
      <span class="ot-cat-item-text">${_escHtml(item)}</span>
      <button class="ot-cat-item-del" onclick="otRemoveCatItem(${i})" title="Remover">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`).join('');
}

function otAddCatItem() {
  const input = document.getElementById('ot-cat-new-input');
  const val   = input?.value.trim();
  if (!val) { showToast('Digite um valor.', 'error'); return; }
  if (!_otCatKey) return;
  if (otState.catalogos[_otCatKey].includes(val)) { showToast('Item já cadastrado.', 'info'); return; }
  otState.catalogos[_otCatKey].push(val);
  otSave();
  if (input) input.value = '';
  _otRenderCatList();
  _otPopulateCatalogSelects();
}

function otRemoveCatItem(i) {
  if (!_otCatKey) return;
  otState.catalogos[_otCatKey].splice(i, 1);
  otSave();
  _otRenderCatList();
  _otPopulateCatalogSelects();
}

function _otPopulateCatalogSelects() {
  const map = {
    'ot-f-tipo-falha': 'tiposFalha',
    'ot-f-causa':      'causasRaiz',
    'ot-f-deteccao':   'metodosDetec',
    'ot-f-dano':       'tiposDano',
  };
  for (const [selId, catKey] of Object.entries(map)) {
    const sel = document.getElementById(selId);
    if (!sel) continue;
    const cur = sel.value;
    sel.innerHTML = `<option value="">— Selecione —</option>` +
      (otState.catalogos[catKey] || []).map(v => `<option value="${_escHtml(v)}" ${v === cur ? 'selected' : ''}>${_escHtml(v)}</option>`).join('');
  }
}

// ── UPLOAD INTEGRATION ────────────────────────────────────────
function _otExtendUpload() {
  if (typeof _uploadQueues === 'undefined') return;
  _uploadQueues['ot-pub']     = { file: null, dataUrl: null };
  _SAVE_BTN_IDS['ot-pub']    = 'btn-ot-confirmar-pub';
  _uploadsInProgress['ot-pub'] = false;
}

function _otGetUploadPrefixo() {
  const o = _otViewId ? otState.ordens.find(x => x.id === _otViewId) : null;
  return o ? o.numero : 'OT';
}

// ── MODAL HELPERS ─────────────────────────────────────────────
function otOpenModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('open');
  el.style.opacity    = '1';
  el.style.pointerEvents = 'all';
}
function otCloseModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  el.style.opacity       = '';
  el.style.pointerEvents = '';
}

// ── HELPERS ───────────────────────────────────────────────────
function _otUid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function _escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _fmtDate(str) {
  if (!str) return '—';
  const [y, m, d] = String(str).split('T')[0].split('-');
  return `${d}/${m}/${y}`;
}
function _fmtDateTime(str) {
  if (!str) return '—';
  const d = new Date(str);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ── INJEÇÃO DE MODAIS ─────────────────────────────────────────
function _otInjectModals() {
  const div = document.createElement('div');
  div.innerHTML = _otModalsHTML();
  document.body.appendChild(div);
  // Bind upload zone após injeção
  setTimeout(() => {
    if (typeof initUploadZone === 'function') initUploadZone('ot-pub');
  }, 100);
}

function _otModalsHTML() {
  return `
<!-- ══ MODAL CRIAR/EDITAR OT ══ -->
<div class="modal-overlay modal-ot-form" id="modal-ot-form">
  <div class="modal wide">
    <div class="modal-header">
      <div class="modal-header-left">
        <div class="modal-header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        </div>
        <div><div class="modal-title" id="ot-form-title">Nova Ordem de Trabalho</div>
          <div class="modal-subtitle">Preencha os dados da OT</div></div>
      </div>
      <button class="modal-close" onclick="otCloseModal('modal-ot-form')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="ot-modal-tabs">
      <button class="ot-modal-tab-btn active" data-tab="dados" onclick="otSwitchFormTab('dados')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        Dados da OT
      </button>
      <button class="ot-modal-tab-btn" data-tab="subtarefas" onclick="otSwitchFormTab('subtarefas')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        Subtarefas
        <span class="ot-modal-tab-badge">0</span>
      </button>
    </div>
    <div class="modal-body" style="padding:0;">
      <!-- ABA DADOS -->
      <div class="ot-modal-tab-panel active" data-tab="dados" style="padding:24px 28px;">
        <div class="form-section">
          <div class="form-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Informações Gerais
          </div>
          <div class="form-row">
            <div class="form-field">
              <label class="field-label">Tipo <span class="required">*</span></label>
              <select id="ot-f-tipo" class="field-select" onchange="otFormTipoChange()">
                <option value="corretiva">Corretiva</option>
                <option value="implantacao">Implantação</option>
                <option value="melhoria">Melhoria / Projeto</option>
                <option value="alteracao">Alteração</option>
              </select>
            </div>
            <div class="form-field">
              <label class="field-label">Severidade <span class="required">*</span></label>
              <select id="ot-f-severidade" class="field-select">
                <option value="baixa">Baixa</option>
                <option value="media" selected>Média</option>
                <option value="alta">Alta</option>
                <option value="critica">Crítica</option>
              </select>
            </div>
          </div>
          <div class="form-field">
            <label class="field-label">Título <span class="required">*</span></label>
            <input type="text" id="ot-f-titulo" class="field-input" placeholder="Descreva brevemente a OT...">
          </div>
          <div class="form-field">
            <label class="field-label">Descrição</label>
            <textarea id="ot-f-descricao" class="field-textarea" placeholder="Detalhes sobre o problema, objetivo ou escopo..." style="min-height:80px;"></textarea>
          </div>
          <div class="form-field">
            <label class="field-label">Ativo Vinculado</label>
            <div id="ot-ativo-chip-wrap"></div>
          </div>
          <div class="form-row">
            <div class="form-field">
              <label class="field-label">Prazo</label>
              <input type="date" id="ot-f-prazo" class="field-input">
            </div>
            <div class="form-field">
              <label class="field-label">Alerta (Dias)</label>
              <input type="number" id="ot-f-prazo-alerta" class="field-input" min="0" max="365" placeholder="Dias para alerta de prazo">
            </div>
          </div>
        </div>

        <div class="form-section">
          <div class="form-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
            Atribuição
          </div>
          <div class="form-field">
            <label class="field-label">Responsável Técnico</label>
            <div id="ot-resp-chip-wrap"></div>
          </div>
          <div class="form-field">
            <label class="field-label" style="margin-bottom:8px;">Terceirizado</label>
            <div class="ot-toggle-row" id="ot-toggle-terceiro" onclick="otToggleTerceiro()">
              <div class="ot-toggle-switch"></div>
              <span class="ot-toggle-label">Serviço executado por empresa/pessoa terceirizada</span>
            </div>
          </div>
          <div class="ot-terceiro-section" id="ot-terceiro-section">
            <div class="form-row">
              <div class="form-field" style="margin-bottom:0;">
                <label class="field-label">Empresa / Prestador</label>
                <select id="ot-f-empresa" class="field-select" onchange="empPopulateTecnicoSelect('ot-f-resp-empresa','ot-f-empresa')">
                  <option value="">— Selecione a empresa —</option>
                </select>
              </div>
              <div class="form-field" style="margin-bottom:0;">
                <label class="field-label">Responsável pela empresa</label>
                <select id="ot-f-resp-empresa" class="field-select">
                  <option value="">— Selecione o responsável —</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div class="form-section" id="ot-corretiva-section">
          <div class="form-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            Falha do Equipamento
          </div>
          <div class="form-field" id="ot-falhou-row">
            <label class="field-label" style="margin-bottom:8px;">O ativo falhou / avariou?</label>
            <div class="ot-toggle-row" id="ot-toggle-falhou" onclick="otToggleFalhou()">
              <div class="ot-toggle-switch"></div>
              <span class="ot-toggle-label">Registrar falha do ativo (habilita análise de causa)</span>
            </div>
          </div>
          <div class="ot-falha-section" id="ot-falha-section">
            <div class="form-row">
              <div class="form-field" style="margin-bottom:12px;">
                <label class="field-label">Tipo de Falha</label>
                <div class="ot-catalog-field">
                  <select id="ot-f-tipo-falha" class="field-select"></select>
                  <button class="ot-catalog-add-btn" onclick="otOpenCatalog('tiposFalha')" title="Gerenciar tipos">+</button>
                </div>
              </div>
              <div class="form-field" style="margin-bottom:12px;">
                <label class="field-label">Causa Raiz</label>
                <div class="ot-catalog-field">
                  <select id="ot-f-causa" class="field-select"></select>
                  <button class="ot-catalog-add-btn" onclick="otOpenCatalog('causasRaiz')" title="Gerenciar causas">+</button>
                </div>
              </div>
            </div>
            <div class="form-row">
              <div class="form-field" style="margin-bottom:0;">
                <label class="field-label">Método de Detecção</label>
                <div class="ot-catalog-field">
                  <select id="ot-f-deteccao" class="field-select"></select>
                  <button class="ot-catalog-add-btn" onclick="otOpenCatalog('metodosDetec')" title="Gerenciar métodos">+</button>
                </div>
              </div>
              <div class="form-field" style="margin-bottom:0;">
                <label class="field-label">Tipo de Dano Causado</label>
                <div class="ot-catalog-field">
                  <select id="ot-f-dano" class="field-select"></select>
                  <button class="ot-catalog-add-btn" onclick="otOpenCatalog('tiposDano')" title="Gerenciar danos">+</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ABA SUBTAREFAS -->
      <div class="ot-modal-tab-panel" data-tab="subtarefas" style="padding:24px 28px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <div class="form-section-title" style="margin-bottom:0;border:none;padding:0;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/></svg>
            Subtarefas
          </div>
        </div>
        <div id="ot-sub-list" class="ot-sub-list"></div>
        <div class="ot-sub-add-row" style="margin-top:12px;">
          <input type="text" id="ot-sub-new-input" class="field-input" placeholder="Nova subtarefa..."
            onkeydown="if(event.key==='Enter')otAddSub()" style="flex:1;">
          <button class="btn btn-primary" onclick="otAddSub()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Adicionar
          </button>
        </div>
        <div class="ot-sub-add-options">
          <label>
            <input type="checkbox" id="ot-sub-new-ev">
            Exige evidência fotográfica ao concluir
          </label>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="otCloseModal('modal-ot-form')">Cancelar</button>
      <button class="btn btn-primary" onclick="otSaveForm()" id="btn-ot-form-save">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:15px;height:15px;"><polyline points="20 6 9 17 4 12"/></svg>
        <span id="ot-form-save-lbl">Criar OT</span>
      </button>
    </div>
  </div>
</div>

<!-- ══ MODAL VIEW OT ══ -->
<div class="modal-overlay modal-ot-view" id="modal-ot-view">
  <div class="modal wide">
    <div class="modal-header">
      <div class="modal-header-left">
        <div class="modal-header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        </div>
        <div><div class="modal-title">Ordem de Trabalho</div>
          <div class="modal-subtitle">Detalhes e histórico</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="btn btn-outline" style="padding:6px 12px;font-size:12px;" onclick="otEditFromView()" id="btn-ot-view-edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
          Editar
        </button>
        <button class="modal-close" onclick="otCloseModal('modal-ot-view')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
    <div class="modal-body" id="ot-view-body"></div>
    <div class="modal-footer" style="justify-content:space-between;">
      <button class="btn btn-outline" style="color:var(--red);border-color:rgba(230,57,70,0.3);" onclick="otOpenDeleteConfirm(_otViewId)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        Excluir OT
      </button>
      <button class="btn btn-outline" onclick="otCloseModal('modal-ot-view')">Fechar</button>
    </div>
  </div>
</div>

<!-- ══ MODAL PUBLICAÇÃO OT ══ -->
<div class="modal-overlay modal-ot-pub" id="modal-ot-pub">
  <div class="modal">
    <div class="modal-header">
      <div class="modal-header-left">
        <div class="modal-header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        </div>
        <div><div class="modal-title" id="ot-pub-modal-title">Nova Publicação</div>
          <div class="modal-subtitle" id="ot-pub-modal-subtitle">Registre comentário, atualização ou evidência</div></div>
      </div>
      <button class="modal-close" onclick="otCloseModal('modal-ot-pub')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="form-field">
        <label class="field-label">Tipo de Publicação</label>
        <select id="ot-pub-tipo" class="field-select" onchange="otPubTipoChange()">
          <option value="comentario">Comentário</option>
          <option value="evidencia">Evidência</option>
          <option value="atualizacao">Atualização</option>
          <option value="conclusao">Conclusão</option>
          <option value="transferencia">Transferência</option>
        </select>
      </div>
      <div class="form-field" id="ot-pub-subtarefa-row" style="display:none;">
        <label class="field-label">Subtarefa Vinculada</label>
        <select id="ot-pub-subtarefa-sel" class="field-select"></select>
      </div>
      <div class="form-field">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <label class="field-label" style="margin-bottom:0;">Descrição</label>
          <span id="ot-pub-char-count" style="font-size:11px;color:var(--text-muted);">0/1000</span>
        </div>
        <textarea id="ot-pub-texto" class="field-textarea" placeholder="Descreva o que foi realizado, observações..." style="min-height:90px;" oninput="_otUpdatePubCharCount()"></textarea>
      </div>
      <div class="form-section-title" style="margin-bottom:10px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
        Anexos / Evidências
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">
        <input type="text" id="ot-pub-upload-title" class="field-input" placeholder="Nome do arquivo" style="flex:1;">
        <button id="ot-pub-upload-btn" class="btn btn-primary"
          onclick="doUploadAnexo('ot-pub', a => otAddPubAnexo(a), () => _otGetUploadPrefixo())"
          style="flex-shrink:0;" title="Fazer upload">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:14px;height:14px;">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Enviar
        </button>
      </div>
      <div id="ot-pub-upload-zone" class="upload-drop-zone" title="Clique ou arraste um arquivo PDF ou imagem">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:28px;height:28px;opacity:.45;"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <div class="upload-drop-text"><strong>Clique ou arraste o arquivo</strong><br><span>PDF ou imagem</span></div>
        <input type="file" id="ot-pub-file-input" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.svg" style="display:none;">
      </div>
      <div id="ot-pub-file-preview" style="display:none;margin-top:6px;"></div>
      <div id="ot-pub-anexo-list" style="margin-top:8px;"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="otCloseModal('modal-ot-pub')">Cancelar</button>
      <button class="btn btn-primary" id="btn-ot-confirmar-pub" onclick="otConfirmPub()" style="background:var(--green);">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;"><polyline points="20 6 9 17 4 12"/></svg>
        Confirmar Publicação
      </button>
    </div>
  </div>
</div>

<!-- ══ MODAL CANCELAMENTO ══ -->
<div class="modal-overlay modal-ot-sm" id="modal-ot-cancel">
  <div class="modal sm">
    <div class="modal-header">
      <div class="modal-header-left">
        <div class="modal-header-icon" style="background:rgba(230,57,70,0.15);border-color:rgba(230,57,70,0.3);color:var(--red);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        </div>
        <div><div class="modal-title">Cancelar OT</div>
          <div class="modal-subtitle">Esta ação é irreversível</div></div>
      </div>
      <button class="modal-close" onclick="otCloseModal('modal-ot-cancel')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="form-field">
        <label class="field-label">Motivo do Cancelamento <span class="required">*</span></label>
        <textarea id="ot-cancel-motivo" class="field-textarea" placeholder="Descreva o motivo..."></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="otCloseModal('modal-ot-cancel')">Voltar</button>
      <button class="btn btn-primary" onclick="otConfirmCancel()" style="background:var(--red);">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        Confirmar Cancelamento
      </button>
    </div>
  </div>
</div>

<!-- ══ MODAL DEVOLUÇÃO ══ -->
<div class="modal-overlay modal-ot-sm" id="modal-ot-devolve">
  <div class="modal sm">
    <div class="modal-header">
      <div class="modal-header-left">
        <div class="modal-header-icon" style="background:rgba(244,162,97,0.15);border-color:rgba(244,162,97,0.3);color:#b45309;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
        </div>
        <div><div class="modal-title">Devolver para Execução</div>
          <div class="modal-subtitle">Informe o motivo da devolução</div></div>
      </div>
      <button class="modal-close" onclick="otCloseModal('modal-ot-devolve')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="form-field">
        <label class="field-label">Motivo da Devolução <span class="required">*</span></label>
        <textarea id="ot-devolve-motivo" class="field-textarea" placeholder="O que precisa ser corrigido ou complementado?"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="otCloseModal('modal-ot-devolve')">Cancelar</button>
      <button class="btn btn-primary" onclick="otConfirmDevolve()" style="background:var(--amber);color:#fff;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
        Devolver
      </button>
    </div>
  </div>
</div>

<!-- ══ MODAL CATÁLOGO ══ -->
<div class="modal-overlay modal-ot-cat" id="modal-ot-cat">
  <div class="modal sm">
    <div class="modal-header">
      <div class="modal-header-left">
        <div class="modal-header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
        </div>
        <div><div class="modal-title" id="ot-cat-title">Catálogo</div>
          <div class="modal-subtitle">Gerencie os itens pré-cadastrados</div></div>
      </div>
      <button class="modal-close" onclick="otCloseModal('modal-ot-cat')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div style="display:flex;gap:8px;margin-bottom:4px;">
        <input type="text" id="ot-cat-new-input" class="field-input" placeholder="Novo item..."
          onkeydown="if(event.key==='Enter')otAddCatItem()" style="flex:1;">
        <button class="btn btn-primary" onclick="otAddCatItem()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Adicionar
        </button>
      </div>
      <div id="ot-cat-list" class="ot-cat-list"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" onclick="otCloseModal('modal-ot-cat')">Fechar</button>
    </div>
  </div>
</div>

<!-- ══ MODAL BUSCA DE RESPONSÁVEL ══ -->
<div class="modal-overlay" id="modal-ot-resp-search" style="z-index:750;">
  <div class="modal sm">
    <div class="modal-header">
      <div class="modal-header-left">
        <div class="modal-header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
        </div>
        <div><div class="modal-title">Selecionar Responsável</div></div>
      </div>
      <button class="modal-close" onclick="otCloseModal('modal-ot-resp-search')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="ativo-search-input-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" class="field-input" id="ot-resp-search-input" placeholder="Buscar por nome ou cargo..."
          oninput="otRespSearchInput(this.value)">
      </div>
      <div id="ot-resp-search-list" class="ativo-search-list"></div>
    </div>
  </div>
</div>

<!-- ══ MODAL BUSCA DE ATIVO ══ -->
<div class="modal-overlay" id="modal-ot-ativo-search" style="z-index:750;">
  <div class="modal sm">
    <div class="modal-header">
      <div class="modal-header-left">
        <div class="modal-header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </div>
        <div><div class="modal-title">Vincular Ativo</div></div>
      </div>
      <button class="modal-close" onclick="otCloseModal('modal-ot-ativo-search')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="ativo-search-input-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" class="field-input" id="ot-ativo-search-input" placeholder="Buscar por nome, código ou setor..."
          oninput="otAtivoSearchInput(this.value)">
      </div>
      <div id="ot-ativo-search-list" class="ativo-search-list"></div>
    </div>
  </div>
</div>

<!-- ══ MODAL FILTRO ATIVO ══ -->
<div class="modal-overlay" id="modal-ot-filter-ativo" style="z-index:750;">
  <div class="modal sm">
    <div class="modal-header">
      <div class="modal-header-left">
        <div class="modal-header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        </div>
        <div><div class="modal-title">Filtrar por Ativo</div></div>
      </div>
      <button class="modal-close" onclick="otCloseModal('modal-ot-filter-ativo')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="ativo-search-input-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" class="field-input" id="ot-filter-ativo-search-input" placeholder="Buscar por nome, código ou setor..."
          oninput="otFilterAtivoSearchInput(this.value)">
      </div>
      <div id="ot-filter-ativo-search-list" class="ativo-search-list"></div>
    </div>
  </div>
</div>

<!-- ══ MODAL EXCLUIR OT ══ -->
<div class="modal-overlay modal-ot-sm" id="modal-ot-delete" style="z-index:740;">
  <div class="modal sm">
    <div class="modal-header">
      <div class="modal-header-left">
        <div class="modal-header-icon" style="background:rgba(230,57,70,0.15);border-color:rgba(230,57,70,0.3);color:var(--red);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </div>
        <div><div class="modal-title" style="color:var(--red);">Excluir OT</div>
          <div class="modal-subtitle">Esta ação é irreversível</div></div>
      </div>
      <button class="modal-close" onclick="otCloseModal('modal-ot-delete')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body" style="background:rgba(230,57,70,0.04);border-radius:0 0 var(--radius-lg) var(--radius-lg);">
      <div style="display:flex;align-items:center;gap:8px;background:rgba(230,57,70,0.08);border:1px solid rgba(230,57,70,0.2);border-radius:var(--radius);padding:10px 12px;margin-bottom:14px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0;color:var(--red);"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span style="font-size:13px;color:var(--red);font-weight:600;">Todos os dados e publicações desta OT serão excluídos permanentemente.</span>
      </div>
      <div class="form-field">
        <label class="field-label">Para confirmar, digite o título da OT:</label>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:6px;font-style:italic;" id="ot-delete-title-display"></div>
        <input type="text" id="ot-delete-confirm-input" class="field-input" placeholder="Digite o título exato..." style="border-color:rgba(230,57,70,0.4);">
      </div>
    </div>
    <div class="modal-footer" style="border-top:1px solid rgba(230,57,70,0.15);">
      <button class="btn btn-outline" onclick="otCloseModal('modal-ot-delete')">Cancelar</button>
      <button class="btn btn-primary" onclick="otConfirmDelete()" style="background:var(--red);">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        Excluir OT
      </button>
    </div>
  </div>
</div>

<!-- ══ MODAL VER PUBLICAÇÃO ══ -->
<div class="modal-overlay" id="modal-ot-pub-view" style="z-index:730;">
  <div class="modal md">
    <div class="modal-header">
      <div class="modal-header-left">
        <div class="modal-header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        </div>
        <div><div class="modal-title">Publicação</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <button class="modal-close" onclick="otCloseModal('modal-ot-pub-view')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
    <div class="modal-body" id="ot-pub-view-body"></div>
    <div class="modal-footer" style="justify-content:space-between;">
      <button class="btn btn-outline" style="color:var(--red);border-color:rgba(230,57,70,0.3);" onclick="otOpenDeletePub(_otViewPubId)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        Excluir
      </button>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-outline" style="color:var(--cyan);border-color:rgba(0,168,204,0.3);" onclick="otOpenEditPub(_otViewPubId)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Editar
        </button>
        <button class="btn btn-outline" onclick="otCloseModal('modal-ot-pub-view')">Fechar</button>
      </div>
    </div>
  </div>
</div>

<!-- ══ MODAL EXCLUIR PUBLICAÇÃO ══ -->
<div class="modal-overlay" id="modal-ot-delete-pub" style="z-index:750;">
  <div class="modal sm">
    <div class="modal-header">
      <div class="modal-header-left">
        <div class="modal-header-icon" style="background:rgba(230,57,70,0.15);border-color:rgba(230,57,70,0.3);color:var(--red);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        </div>
        <div><div class="modal-title">Excluir Publicação</div>
          <div class="modal-subtitle">Esta ação é irreversível</div></div>
      </div>
      <button class="modal-close" onclick="otCloseModal('modal-ot-delete-pub')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <p style="font-size:13.5px;color:var(--text-secondary);line-height:1.6;">Deseja excluir esta publicação permanentemente?</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="otCloseModal('modal-ot-delete-pub')">Cancelar</button>
      <button class="btn btn-primary" onclick="otConfirmDeletePub()" style="background:var(--red);">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        Excluir
      </button>
    </div>
  </div>
</div>
`;
}

// ── EDITAR A PARTIR DA VIEW ───────────────────────────────────
function otEditFromView() {
  const o = _otViewId ? otState.ordens.find(x => x.id === _otViewId) : null;
  if (!o || o.status === 'concluida' || o.status === 'cancelada') {
    showToast('OTs concluídas ou canceladas não podem ser editadas.', 'error'); return;
  }
  otCloseModal('modal-ot-view');
  otOpenForm(_otViewId);
}
