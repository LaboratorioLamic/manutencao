// ═══════════════════════════════════════════════════════════════
// org.js — Unidades e setores (hierarquia compartilhada)
// Unidade (ex.: NTO) → Setores (ex.: Hematologia). O ativo pertence a um setor
// e, por ele, a uma unidade. Ativos, Rotinas, OT, Ocorrências, Início e CQ leem
// a hierarquia apenas pelas funções deste arquivo.
//
// Modelo antigo: `state.setores` é uma lista de nomes que mistura unidades
// ("01 - Unidade NTO") e setores ("Hematologia"). Cada nome antigo ainda não
// tratado aparece como setor "sem unidade" (id 'n:<nome>'). Na tela de Unidades
// e setores cada um é movido para uma unidade (vira setor dela) ou transformado
// em unidade; o vínculo fica em `legado`, então ativos, permissões, OT e
// ocorrências que guardam o nome antigo passam a apontar para o setor novo.
// O vínculo com o Controle de Qualidade é feito no CQ (unidade.orgUnidadeId).
// ═══════════════════════════════════════════════════════════════

const ORG_KEY = 'gestao-org-v1';

// { unidades: { id: { id, sigla, nome, ativa } },
//   setores:  { id: { id, nome, unidadeId, ativo } },
//   legado:   { k: { nome, setorId, unidadeId, em, porNome } } }   ← nome antigo → setor novo ('' = sem setor)
let orgState = { unidades: {}, setores: {}, legado: {} };
let _orgReady = false;
let _orgMapaLegado = new Map();   // nome antigo normalizado → setorId ('' = tratado sem setor)

document.addEventListener('DOMContentLoaded', () => {
  window._dbReady.then(() => {
    window.dbListen(ORG_KEY, data => {
      _orgReady = true;
      const d = (data && typeof data === 'object') ? data : {};
      const obj = v => (v && typeof v === 'object') ? v : {};
      orgState = { unidades: obj(d.unidades), setores: obj(d.setores), legado: obj(d.legado) };
      _orgMapaLegado = new Map(Object.values(orgState.legado).filter(x => x && x.nome).map(x => [_orgNorm(x.nome), x.setorId || '']));
      _orgAoMudar();
    });
  });
});

function _orgEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Conteúdo de string JS ('...') dentro de atributo HTML (onclick="f('…')")
function _orgJsAttr(s) { return _orgEsc(String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")); }
function _orgNorm(s) { return String(s || '').trim().toLocaleLowerCase('pt-BR'); }
function _orgUid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ── CONSULTAS ────────────────────────────────────────────────
// Há unidades cadastradas? (filtros de unidade e agrupamentos só aparecem a partir daí)
function _orgMigrado() { return Object.values(orgState.unidades || {}).some(Boolean); }

// Unidades, ordenadas por sigla. opts.todas inclui as inativas.
function _orgUnidades(opts = {}) {
  return Object.values(orgState.unidades || {})
    .filter(u => u && (opts.todas || u.ativa !== false))
    .sort((a, b) => (a.sigla || '').localeCompare(b.sigla || '', 'pt-BR'));
}
function _orgUnidade(id) { return id ? (orgState.unidades?.[id] || null) : null; }
function _orgSiglaUnidade(id) { const u = _orgUnidade(id); return u ? (u.sigla || u.nome || '') : ''; }

// Nomes do modelo antigo (lista + nomes usados nos ativos)
function _orgNomesLegados() {
  const nomes = (typeof state !== 'undefined' && Array.isArray(state.setores)) ? state.setores.filter(Boolean) : [];
  const set = new Set(nomes);
  if (typeof state !== 'undefined') (state.ativos || []).forEach(a => { if (a?.setor && !a.setorId) set.add(a.setor); });
  return [...set];
}
function _orgLegadoTratado(nome) { return _orgMapaLegado.has(_orgNorm(nome)); }
// Nomes antigos ainda sem destino (aparecem como setores sem unidade)
function _orgNomesPendentes() { return _orgNomesLegados().filter(n => !_orgLegadoTratado(n)); }
function _orgSetorVirtual(nome) { return { id: 'n:' + nome, nome, unidadeId: null, ativo: true, virtual: true }; }

// Setores. unidadeId: undefined = todos; null = sem unidade; id = da unidade. opts.todos inclui inativos.
function _orgSetores(unidadeId, opts = {}) {
  let lista = [
    ...Object.values(orgState.setores || {}).filter(s => s && (opts.todos || s.ativo !== false)),
    ..._orgNomesPendentes().map(_orgSetorVirtual)
  ];
  if (unidadeId !== undefined) lista = lista.filter(s => (s.unidadeId || null) === (unidadeId || null));
  return lista.sort((a, b) =>
    _orgSiglaUnidade(a.unidadeId).localeCompare(_orgSiglaUnidade(b.unidadeId), 'pt-BR') ||
    (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
}
// Setor por id. 'n:<nome>' = nome antigo: resolve pelo vínculo (legado) ou fica como setor sem unidade
function _orgSetor(id) {
  if (!id) return null;
  if (orgState.setores?.[id]) return orgState.setores[id];
  if (!String(id).startsWith('n:')) return null;
  const nome = String(id).slice(2);
  const k = _orgNorm(nome);
  if (_orgMapaLegado.has(k)) return orgState.setores?.[_orgMapaLegado.get(k)] || null;
  return _orgSetorVirtual(nome);
}
function _orgSetoresPorNome(nome, unidadeId) {
  const n = _orgNorm(nome);
  if (!n) return [];
  return _orgSetores(unidadeId, { todos: true }).filter(s => _orgNorm(s.nome) === n);
}
// Id do setor correspondente a um nome antigo ('' = sem correspondência)
function _orgIdDeNomeLegado(nome) { return nome ? (_orgSetor('n:' + nome)?.id || '') : ''; }

// Setor de um ativo: pelo setorId; sem ele, pelo nome antigo
function _orgSetorDoAtivo(a) {
  if (!a) return null;
  if (a.setorId && orgState.setores?.[a.setorId]) return orgState.setores[a.setorId];
  return a.setor ? _orgSetor('n:' + a.setor) : null;
}
function _orgSetorIdDoAtivo(a) {
  const s = _orgSetorDoAtivo(a);
  if (s) return s.id;
  return a?.setor ? 'n:' + a.setor : '';
}
function _orgUnidadeIdDoAtivo(a) { return _orgSetorDoAtivo(a)?.unidadeId || ''; }
function _orgUnidadeIdDoSetor(setorId) { return _orgSetor(setorId)?.unidadeId || ''; }

// "NTO · Hematologia" (opts.semUnidade: só o nome)
function _orgRotuloSetor(id, opts = {}) {
  const s = _orgSetor(id);
  if (!s) return id && String(id).startsWith('n:') ? String(id).slice(2) : '';
  const sig = opts.semUnidade ? '' : _orgSiglaUnidade(s.unidadeId);
  return sig ? `${sig} · ${s.nome}` : s.nome;
}
// Rótulo do setor de um ativo (cai no nome gravado no ativo)
function _orgRotuloAtivo(a, opts = {}) {
  const s = _orgSetorDoAtivo(a);
  if (s) return _orgRotuloSetor(s.id, opts);
  return a?.setor || '';
}
// Id de setor a partir de um par gravado (setorId, nome) — OT/ocorrência/rotina antigas
function _orgSetorIdDeRef(setorId, nome) {
  if (setorId && orgState.setores?.[setorId]) return setorId;
  if (!nome) return '';
  return _orgIdDeNomeLegado(nome) || 'n:' + nome;
}
// Rótulo a partir de um par (setorId, nome gravado) — OT e ocorrências guardam os dois
function _orgRotuloRef(setorId, nome, opts = {}) {
  const id = _orgSetorIdDeRef(setorId, nome);
  return (id && _orgRotuloSetor(id, opts)) || nome || '';
}

// Nomes antigos (permissões, unidades do CQ sem vínculo) → ids de setor
function _orgIdsDeNomes(nomes) {
  return [...new Set((Array.isArray(nomes) ? nomes : []).map(_orgIdDeNomeLegado).filter(Boolean))];
}
// Setores (todos, inclusive inativos) das unidades informadas
function _orgSetoresDasUnidades(unidadeIds) {
  const set = new Set(Array.isArray(unidadeIds) ? unidadeIds : []);
  if (!set.size) return [];
  return Object.values(orgState.setores || {}).filter(s => s && s.unidadeId && set.has(s.unidadeId)).map(s => s.id);
}

// Referência de setor para gravar em OT/ocorrência (histórico)
function _orgRefDoAtivo(a) {
  const s = _orgSetorDoAtivo(a);
  return { setor: s?.nome || a?.setor || '', setorId: s && !s.virtual ? s.id : '', unidadeId: s?.unidadeId || '' };
}

// ── FILTROS EM PAR (Unidade + Setor) ─────────────────────────
// Unidades que têm ao menos um dos setores informados (+ "Sem unidade" quando houver)
function _orgUnidadesDosSetores(setorIds) {
  const ids = new Set();
  let semUnidade = false;
  (setorIds || []).forEach(id => { const u = _orgUnidadeIdDoSetor(id); if (u) ids.add(u); else semUnidade = true; });
  const lista = _orgUnidades({ todas: true }).filter(u => ids.has(u.id)).map(u => ({ value: u.id, label: u.sigla, sub: u.nome }));
  if (semUnidade && _orgMigrado()) lista.push({ value: '__sem__', label: 'Sem unidade', sub: '' });
  return lista;
}
// Setor passa no filtro de unidade? ('' = todas; '__sem__' = sem unidade)
function _orgSetorNaUnidade(setorId, unidadeFiltro) {
  if (!unidadeFiltro) return true;
  const u = _orgUnidadeIdDoSetor(setorId);
  return unidadeFiltro === '__sem__' ? !u : u === unidadeFiltro;
}
// Opções de setor (value = id) restritas a uma lista de ids e a um filtro de unidade
function _orgOpcoesSetores(setorIds, unidadeFiltro, opts = {}) {
  const set = new Set(setorIds || []);
  return [...set].filter(id => _orgSetorNaUnidade(id, unidadeFiltro))
    .map(id => ({ value: id, label: _orgRotuloSetor(id, { semUnidade: !!unidadeFiltro || opts.semUnidade }) || id, unidade: _orgSiglaUnidade(_orgUnidadeIdDoSetor(id)) }))
    .sort((a, b) => (a.unidade || '').localeCompare(b.unidade || '', 'pt-BR') || a.label.localeCompare(b.label, 'pt-BR'));
}
// Ativo passa nos filtros de unidade e setor? ('', 'todas'/'todos' = sem filtro)
function _orgAtivoPassa(a, unidadeFiltro, setorFiltro) {
  const id = _orgSetorIdDoAtivo(a);
  if (setorFiltro && setorFiltro !== 'todos' && id !== setorFiltro) return false;
  if (unidadeFiltro && unidadeFiltro !== 'todas' && !_orgSetorNaUnidade(id, unidadeFiltro)) return false;
  return true;
}
// Chave de ordenação "unidade › setor" de um ativo
function _orgChaveOrdemAtivo(a) {
  const s = _orgSetorDoAtivo(a);
  return ((s ? _orgSiglaUnidade(s.unidadeId) + '\u0001' + s.nome : (a?.setor || '')) || '').toLowerCase();
}
// HTML de <option> para um <select> de unidade
function _orgOptionsUnidade(lista, atual, vazio = 'Todas as unidades') {
  return `<option value="">${_orgEsc(vazio)}</option>` +
    lista.map(o => `<option value="${_orgEsc(o.value)}"${o.value === atual ? ' selected' : ''}>${_orgEsc(o.label)}${o.sub ? ' — ' + _orgEsc(o.sub) : ''}</option>`).join('');
}

// ── REAÇÃO A MUDANÇAS ────────────────────────────────────────
function _orgRefreshTelas() {
  const call = n => { if (typeof window[n] === 'function') { try { window[n](); } catch (e) { console.error(`[org.js] ${n}:`, e); } } };
  ['atualizarSelects', 'renderCards', 'renderRotinasTable', 'renderTarefasTable', 'renderAtividadesTable',
   '_otRenderKanban', 'ocRender', 'renderAgendaCalendario', 'updateNotifBadge', 'renderHome', 'cqRender'].forEach(call);
}
function _orgAoMudar() {
  if (typeof currentSession !== 'undefined' && currentSession && typeof _initTopbarSectorFilter === 'function') _initTopbarSectorFilter();
  _orgRefreshTelas();
  orgRenderGerenciador();
  if (document.getElementById('cpanel-cq')?.classList.contains('active') && typeof cqRenderConfig === 'function') cqRenderConfig();
}

// ── TELA "UNIDADES E SETORES" (modal da aba Ativos ou painel de Configurações) ──
// Visão geral: um card por unidade. Clicar no card abre a janela da unidade
// (modal-org-unidade), que lista os setores como chips e permite cadastrar novos.
let _orgEdit = null;          // { tipo: 'unidade'|'setor'|'tornar', id }
let _orgNovaUnidade = false;  // card "Nova unidade" aberto como formulário
let _orgDetalheId = null;     // unidade aberta na janela de setores
let _orgBusca = '';           // filtro dos cards de unidade
let _orgBuscaSetor = '';      // filtro dos chips de setor na janela

function _orgPodeEditar() {
  return typeof authHasPermission === 'function' && authHasPermission('ativos.editarSetor');
}

function openSetorModal() {
  _orgEdit = null;
  if (typeof openModal === 'function') openModal('modal-setor');
  orgRenderGerenciador();
}
function orgAbrirOrganizacao() { openSetorModal(); }

function orgFecharGerenciador() {
  if (_orgDetalheId) orgFecharUnidade();
  if (typeof closeModal === 'function') closeModal('modal-setor');
  _orgEdit = null;
  _orgNovaUnidade = false;
  orgRenderGerenciador();
}

// Renderiza no modal (quando aberto) ou no painel de Configurações — nunca nos dois (ids repetidos)
function _orgAlvoGerenciador() {
  const modal = document.getElementById('org-gerenciador');
  const cfg = document.getElementById('org-gerenciador-cfg');
  if (document.getElementById('modal-setor')?.classList.contains('open')) { if (cfg) cfg.innerHTML = ''; return modal; }
  if (modal) modal.innerHTML = '';
  return document.getElementById('cpanel-org')?.classList.contains('active') ? cfg : null;
}

function _orgContarAtivos(setorId) {
  return (typeof state !== 'undefined' ? state.ativos : []).filter(a => a && _orgSetorIdDoAtivo(a) === setorId).length;
}
function _orgContarAtivosNome(nome) {
  return (typeof state !== 'undefined' ? state.ativos : []).filter(a => a && !a.setorId && a.setor === nome).length;
}
// Grupos/usuários que ainda citam o nome antigo nas permissões
function _orgPermissoesComNome(nome) {
  if (typeof authState === 'undefined') return 0;
  return (authState.groups || []).filter(g => (g.setoresPermitidos || []).includes(nome)).length
    + (authState.users || []).filter(u => (u.setores || []).includes(nome)).length;
}

// Ativos e OTs abertas por setor — uma passada só por renderização
function _orgContagens() {
  const ativos = new Map(), ots = new Map();
  const inc = (m, k) => { if (k) m.set(k, (m.get(k) || 0) + 1); };
  (typeof state !== 'undefined' ? state.ativos || [] : []).forEach(a => { if (a) inc(ativos, _orgSetorIdDoAtivo(a)); });
  (typeof otState !== 'undefined' ? otState.ordens || [] : []).forEach(o => {
    if (o && !['concluida', 'cancelada'].includes(o.status)) inc(ots, _orgSetorIdDeRef(o.setorId, o.setor));
  });
  return { ativos, ots };
}
function _orgResumoUnidade(u, cont) {
  const setores = _orgSetores(u.id, { todos: true });
  const soma = m => setores.reduce((t, s) => t + (m.get(s.id) || 0), 0);
  return { setores, setoresAtivos: setores.filter(s => s.ativo !== false).length, ativos: soma(cont.ativos), ots: soma(cont.ots) };
}

// Cor fixa por unidade (derivada da sigla) para identificar o card e a janela
const _ORG_CORES = ['#0891b2', '#2a9d8f', '#7c3aed', '#e76f51', '#2563eb', '#b7791f', '#db2777', '#059669'];
function _orgCor(u) {
  let h = 0;
  for (const c of String(u?.sigla || u?.id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return _ORG_CORES[h % _ORG_CORES.length];
}
const _orgPl = (n, um, varios) => `${n === 1 ? um : varios}`;
// Texto para busca: minúsculo e sem acentos
function _orgBuscaNorm(s) { return _orgNorm(s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }

// Troca o conteúdo mantendo o foco (e o texto digitado) do campo em uso
function _orgPintar(el, html) {
  const a = document.activeElement;
  const foco = a && a.id && el.contains(a)
    ? { id: a.id, val: a.value, ini: a.selectionStart, fim: a.selectionEnd, texto: a.tagName === 'INPUT' && /^(text|search)$/.test(a.type) }
    : null;
  el.innerHTML = html;
  if (!foco) return;
  const n = document.getElementById(foco.id);
  if (!n) return;
  if (foco.texto) n.value = foco.val;
  n.focus();
  if (foco.texto) { try { n.setSelectionRange(foco.ini, foco.fim); } catch (e) { /* campo sem seleção */ } }
}

const _ORG_ICO = {
  edit:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
  del:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  off:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
  on:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',
  plus:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  seta:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
  busca:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  predio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-4h6v4"/><path d="M9 10h.01M15 10h.01M9 14h.01M15 14h.01"/></svg>',
  setor:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  ativo:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
  ot:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>',
  cq:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6"/><path d="M10 3v6l-5 9a2 2 0 001.8 3h10.4a2 2 0 001.8-3l-5-9V3"/><path d="M7.5 15h9"/></svg>'
};

// ── VISÃO GERAL: CARDS DAS UNIDADES ──────────────────────────
function orgRenderGerenciador() {
  _orgRenderDetalhe();
  const el = _orgAlvoGerenciador();
  if (!el) return;
  const pode = _orgPodeEditar();
  const unidades = _orgUnidades({ todas: true });
  const cont = _orgContagens();
  const resumos = unidades.map(u => ({ u, r: _orgResumoUnidade(u, cont) }));
  const soma = k => resumos.reduce((t, x) => t + x.r[k], 0);
  const nAtivas = unidades.filter(u => u.ativa !== false).length;
  const nOts = soma('ots');
  const stat = (ico, n, rot, sub, cls = '') => `<div class="org-stat ${cls}">
      <span class="org-stat-ico">${ico}</span>
      <div><b>${n}</b><span>${rot}</span>${sub ? `<small>${sub}</small>` : ''}</div>
    </div>`;
  _orgPintar(el, `
    <div class="org-topo">
      <div class="org-stats">
        ${stat(_ORG_ICO.predio, nAtivas, _orgPl(nAtivas, 'unidade', 'unidades'), unidades.length > nAtivas ? `+${unidades.length - nAtivas} inativa(s)` : '')}
        ${stat(_ORG_ICO.setor, soma('setoresAtivos'), _orgPl(soma('setoresAtivos'), 'setor', 'setores'), '')}
        ${stat(_ORG_ICO.ativo, soma('ativos'), _orgPl(soma('ativos'), 'ativo vinculado', 'ativos vinculados'), '')}
        ${stat(_ORG_ICO.ot, nOts, _orgPl(nOts, 'OT aberta', 'OTs abertas'), '', nOts ? 'org-stat-alerta' : '')}
      </div>
      ${unidades.length ? `<label class="org-busca">${_ORG_ICO.busca}
        <input type="search" id="org-busca" placeholder="Buscar unidade ou setor…" value="${_orgEsc(_orgBusca)}" oninput="orgFiltrarUnidades(this.value)">
      </label>` : ''}
    </div>
    <div class="org-grid">
      ${resumos.map(x => _orgCardHTML(x.u, x.r, cont)).join('')}
      ${pode ? _orgCardNovoHTML() : ''}
    </div>
    <div class="org-vazio org-sem-resultado" hidden>Nenhuma unidade ou setor encontrado.</div>
    ${!unidades.length && !pode ? '<div class="org-vazio">Nenhuma unidade cadastrada.</div>' : ''}
    ${_orgPendentesHTML(pode, unidades)}`);
  if (_orgBusca) orgFiltrarUnidades(_orgBusca);
}

function _orgCardHTML(u, r, cont) {
  const inativa = u.ativa === false;
  const ativos = r.setores.filter(s => s.ativo !== false)
    .sort((a, b) => (cont.ativos.get(b.id) || 0) - (cont.ativos.get(a.id) || 0));
  const prev = ativos.slice(0, 5);
  const busca = _orgBuscaNorm([u.sigla, u.nome, ...r.setores.map(s => s.nome)].join(' '));
  const abrir = `orgAbrirUnidade('${_orgJsAttr(u.id)}')`;
  const vinculoCQ = _orgUnidadesCQ(u.id).length > 0;
  return `<div class="org-card${inativa ? ' org-inativo' : ''}" style="--org-cor:${_orgCor(u)}" role="button" tabindex="0"
      data-busca="${_orgEsc(busca)}" onclick="${abrir}"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${abrir}}"
      title="Abrir os setores de ${_orgEsc(u.sigla)}">
    <div class="org-card-top">
      <span class="org-sigla-badge">${_orgEsc(u.sigla)}</span>
      <div class="org-card-tit">
        <b>${_orgEsc(u.nome)}</b>
        <span>${inativa ? '<em class="org-pill org-pill-off">Inativa</em>' : '<em class="org-pill org-pill-on">Ativa</em>'}${vinculoCQ ? '<em class="org-pill">CQ</em>' : ''}</span>
      </div>
      <span class="org-card-seta">${_ORG_ICO.seta}</span>
    </div>
    <div class="org-card-nums">
      <div><b>${r.setoresAtivos}</b><span>${_orgPl(r.setoresAtivos, 'setor', 'setores')}</span></div>
      <div><b>${r.ativos}</b><span>${_orgPl(r.ativos, 'ativo', 'ativos')}</span></div>
      <div class="${r.ots ? 'org-num-alerta' : ''}"><b>${r.ots}</b><span>${_orgPl(r.ots, 'OT aberta', 'OTs abertas')}</span></div>
    </div>
    <div class="org-card-prev">
      ${prev.map(s => `<span>${_orgEsc(s.nome)}</span>`).join('') || '<i>Nenhum setor ainda — clique para cadastrar</i>'}
      ${ativos.length > prev.length ? `<span class="org-mais">+${ativos.length - prev.length}</span>` : ''}
    </div>
  </div>`;
}

function _orgCardNovoHTML() {
  if (!_orgNovaUnidade) {
    return `<button type="button" class="org-card org-card-novo" onclick="orgNovaUnidade(true)">
      <span class="org-novo-ico">${_ORG_ICO.plus}</span>
      <b>Nova unidade</b>
      <small>Cadastre a unidade e, em seguida, os setores dela</small>
    </button>`;
  }
  const esc = `if(event.key==='Escape')orgNovaUnidade(false)`;
  return `<div class="org-card org-card-form">
    <b class="org-form-tit">${_ORG_ICO.predio} Nova unidade</b>
    <input type="text" id="org-un-nova-sigla" class="field-input org-sigla" maxlength="8" placeholder="Sigla (ex.: NTO)"
      onkeydown="if(event.key==='Enter')document.getElementById('org-un-nova-nome').focus();${esc}">
    <input type="text" id="org-un-nova-nome" class="field-input" placeholder="Nome da unidade"
      onkeydown="if(event.key==='Enter')orgUnidadeSalvar(null);${esc}">
    <div class="org-form-acoes">
      <button class="btn btn-outline btn-sm" onclick="orgNovaUnidade(false)">Cancelar</button>
      <button class="btn btn-primary btn-sm" onclick="orgUnidadeSalvar(null)">${_ORG_ICO.plus} Cadastrar</button>
    </div>
  </div>`;
}

function orgNovaUnidade(abrir) {
  _orgNovaUnidade = !!abrir;
  orgRenderGerenciador();
  if (abrir) document.getElementById('org-un-nova-sigla')?.focus();
}

function orgFiltrarUnidades(txt) {
  _orgBusca = txt || '';
  const q = _orgBuscaNorm(_orgBusca);
  let n = 0;
  document.querySelectorAll('.org-grid .org-card[data-busca]').forEach(c => {
    const ok = !q || c.dataset.busca.includes(q);
    c.hidden = !ok;
    if (ok) n++;
  });
  const vazio = document.querySelector('.org-sem-resultado');
  if (vazio) vazio.hidden = !(q && !n);
}

// ── JANELA DA UNIDADE: SETORES EM CHIPS ──────────────────────
function orgAbrirUnidade(id) {
  _orgDetalheId = id;
  _orgBuscaSetor = '';
  if (_orgEdit?.tipo !== 'tornar') _orgEdit = null;
  if (typeof openModal === 'function') openModal('modal-org-unidade');
  // Chips entram animados só na abertura (não a cada atualização do banco)
  const el = document.getElementById('org-detalhe');
  el?.classList.add('org-anim');
  setTimeout(() => el?.classList.remove('org-anim'), 500);
  _orgRenderDetalhe();
  if (_orgPodeEditar() && !_orgSetores(id, { todos: true }).length) setTimeout(() => document.getElementById('org-novo-setor')?.focus(), 150);
}

function orgFecharUnidade() {
  if (typeof closeModal === 'function') closeModal('modal-org-unidade');
  _orgDetalheId = null;
  if (_orgEdit?.tipo !== 'tornar') _orgEdit = null;
  orgRenderGerenciador();
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || _orgConfirmAberto || !_orgDetalheId || !document.getElementById('modal-org-unidade')?.classList.contains('open')) return;
  e.preventDefault();
  if (_orgEdit) orgCancelar(); else orgFecharUnidade();
});

function _orgRenderDetalhe() {
  const el = document.getElementById('org-detalhe');
  if (!el || !_orgDetalheId || !document.getElementById('modal-org-unidade')?.classList.contains('open')) return;
  const u = _orgUnidade(_orgDetalheId);
  const tit = document.getElementById('org-det-titulo');
  const sub = document.getElementById('org-det-sub');
  if (!u) { el.innerHTML = '<div class="org-vazio">Carregando unidade…</div>'; return; }
  const pode = _orgPodeEditar();
  const inativa = u.ativa === false;
  const cont = _orgContagens();
  const r = _orgResumoUnidade(u, cont);
  // Ativos primeiro; dentro de cada grupo segue a ordem alfabética de _orgSetores
  const setores = [...r.setores].sort((a, b) => (a.ativo === false) - (b.ativo === false));
  const testes = new Map(setores.map(s => [s.id, _orgTestesCQDoSetor(s.id).length]));
  const nTestes = [...testes.values()].reduce((t, n) => t + n, 0);
  const nInativos = setores.length - r.setoresAtivos;
  const uid = _orgJsAttr(u.id);
  const editando = _orgEdit?.tipo === 'unidade' && _orgEdit.id === u.id;
  const cqs = _orgUnidadesCQ(u.id);

  if (tit) tit.textContent = `${u.sigla} — ${u.nome}`;
  if (sub) sub.textContent = inativa ? 'Unidade inativa' : 'Setores da unidade';
  el.style.setProperty('--org-cor', _orgCor(u));

  const opcoesUn = atual => _orgUnidades({ todas: true }).map(x => `<option value="${_orgEsc(x.id)}"${x.id === atual ? ' selected' : ''}>${_orgEsc(x.sigla)} — ${_orgEsc(x.nome)}</option>`).join('');
  const chip = s => {
    const sid = _orgJsAttr(s.id);
    if (_orgEdit?.tipo === 'setor' && _orgEdit.id === s.id) {
      return `<div class="org-schip editing">
        <input type="text" id="org-setor-nome" class="field-input" value="${_orgEsc(s.nome)}" placeholder="Nome do setor" onkeydown="if(event.key==='Enter')orgSetorSalvar('${sid}')">
        <select id="org-setor-unidade" class="field-input" title="Unidade (mover o setor)">${opcoesUn(s.unidadeId)}</select>
        <button class="btn btn-outline btn-sm" onclick="orgCancelar()">Cancelar</button>
        <button class="btn btn-primary btn-sm" onclick="orgSetorSalvar('${sid}')">Salvar</button>
      </div>`;
    }
    const off = s.ativo === false;
    const na = cont.ativos.get(s.id) || 0, no = cont.ots.get(s.id) || 0, nt = testes.get(s.id) || 0;
    return `<div class="org-schip${off ? ' org-inativo' : ''}" data-busca="${_orgEsc(_orgBuscaNorm(s.nome))}">
      <span class="org-schip-ini">${_orgEsc((s.nome || '?').trim().charAt(0).toUpperCase())}</span>
      <div class="org-schip-body">
        <div class="org-schip-nome" title="${_orgEsc(s.nome)}"><span>${_orgEsc(s.nome)}</span>${off ? ' <em class="org-pill org-pill-off">Inativo</em>' : ''}</div>
        <div class="org-schip-meta">
          <span class="${na ? '' : 'org-zero'}" title="${na} ${_orgPl(na, 'ativo', 'ativos')} no setor">${_ORG_ICO.ativo}${na}</span>
          <span class="${no ? 'org-meta-alerta' : 'org-zero'}" title="${no} ${_orgPl(no, 'OT aberta', 'OTs abertas')}">${_ORG_ICO.ot}${no}</span>
          <span class="${nt ? '' : 'org-zero'}" title="${nt} ${_orgPl(nt, 'teste', 'testes')} de Controle de Qualidade">${_ORG_ICO.cq}${nt}</span>
        </div>
      </div>
      ${pode && !s.virtual ? `<span class="org-schip-acoes">
        <button onclick="orgEditar('setor','${sid}')" title="Renomear ou mover para outra unidade">${_ORG_ICO.edit}</button>
        <button onclick="orgSetorAtivar('${sid}', ${off})" title="${off ? 'Reativar' : 'Inativar'}">${off ? _ORG_ICO.on : _ORG_ICO.off}</button>
        <button class="org-perigo" onclick="orgSetorExcluir('${sid}')" title="Excluir">${_ORG_ICO.del}</button>
      </span>` : ''}
    </div>`;
  };

  _orgPintar(el, `
    <div class="org-det-head">
      ${editando ? `<div class="org-det-edit">
        <input type="text" id="org-un-sigla" class="field-input org-sigla" maxlength="8" value="${_orgEsc(u.sigla)}" placeholder="Sigla">
        <input type="text" id="org-un-nome" class="field-input" value="${_orgEsc(u.nome)}" placeholder="Nome" onkeydown="if(event.key==='Enter')orgUnidadeSalvar('${uid}')">
        <button class="btn btn-outline btn-sm" onclick="orgCancelar()">Cancelar</button>
        <button class="btn btn-primary btn-sm" onclick="orgUnidadeSalvar('${uid}')">Salvar</button>
      </div>` : `
        <span class="org-sigla-badge lg">${_orgEsc(u.sigla)}</span>
        <div class="org-det-tit">
          <b>${_orgEsc(u.nome)}</b>
          <span>${inativa ? '<em class="org-pill org-pill-off">Inativa</em>' : '<em class="org-pill org-pill-on">Ativa</em>'}
            ${cqs.length ? `<em class="org-pill" title="Unidade(s) do Controle de Qualidade vinculada(s)">CQ · ${cqs.map(c => _orgEsc(c.sigla || c.nome || '')).join(', ')}</em>` : ''}</span>
        </div>
        ${pode ? `<div class="org-det-acoes">
          <button class="btn btn-outline btn-sm" onclick="orgEditar('unidade','${uid}')">${_ORG_ICO.edit} Editar</button>
          <button class="btn btn-outline btn-sm" onclick="orgUnidadeAtivar('${uid}', ${inativa})">${inativa ? _ORG_ICO.on + ' Reativar' : _ORG_ICO.off + ' Inativar'}</button>
          <button class="btn btn-outline btn-sm org-btn-perigo" onclick="orgUnidadeExcluir('${uid}')" title="Excluir unidade">${_ORG_ICO.del}</button>
        </div>` : ''}`}
    </div>

    <div class="org-card-nums org-det-nums">
      <div><b>${r.setoresAtivos}</b><span>${_orgPl(r.setoresAtivos, 'setor ativo', 'setores ativos')}</span></div>
      <div><b>${r.ativos}</b><span>${_orgPl(r.ativos, 'ativo', 'ativos')}</span></div>
      <div class="${r.ots ? 'org-num-alerta' : ''}"><b>${r.ots}</b><span>${_orgPl(r.ots, 'OT aberta', 'OTs abertas')}</span></div>
      <div><b>${nTestes}</b><span>${_orgPl(nTestes, 'teste de CQ', 'testes de CQ')}</span></div>
    </div>

    ${pode && !inativa ? `<div class="org-det-add">
      <span class="org-det-add-ico">${_ORG_ICO.plus}</span>
      <input type="text" id="org-novo-setor" placeholder="Novo setor em ${_orgEsc(u.sigla)} — vários: separe por ; (ex.: Hematologia; Bioquímica)"
        onkeydown="if(event.key==='Enter')orgSetoresAdicionar('${uid}')">
      <button class="btn btn-primary btn-sm" onclick="orgSetoresAdicionar('${uid}')">Adicionar</button>
    </div>` : inativa ? '<div class="org-det-aviso">Unidade inativa — reative para cadastrar setores.</div>' : ''}

    <div class="org-det-bar">
      <div><b>Setores</b> <small>${r.setoresAtivos} ${_orgPl(r.setoresAtivos, 'ativo', 'ativos')}${nInativos ? ` · ${nInativos} ${_orgPl(nInativos, 'inativo', 'inativos')}` : ''}</small></div>
      ${setores.length > 6 ? `<label class="org-busca org-busca-sm">${_ORG_ICO.busca}
        <input type="search" id="org-busca-setor" placeholder="Filtrar setores…" value="${_orgEsc(_orgBuscaSetor)}" oninput="orgFiltrarSetores(this.value)">
      </label>` : ''}
    </div>
    <div class="org-schips">${setores.map(chip).join('') || `<div class="org-vazio org-vazio-grande">${_ORG_ICO.setor}<span>Nenhum setor nesta unidade${pode && !inativa ? ' — cadastre o primeiro acima' : ''}.</span></div>`}</div>
    <div class="org-vazio org-schip-sem" hidden>Nenhum setor encontrado.</div>`);
  if (_orgBuscaSetor) orgFiltrarSetores(_orgBuscaSetor);
}

function orgFiltrarSetores(txt) {
  _orgBuscaSetor = txt || '';
  const q = _orgBuscaNorm(_orgBuscaSetor);
  let n = 0;
  document.querySelectorAll('#org-detalhe .org-schip[data-busca]').forEach(c => {
    const ok = !q || c.dataset.busca.includes(q);
    c.hidden = !ok;
    if (ok) n++;
  });
  const vazio = document.querySelector('#org-detalhe .org-schip-sem');
  if (vazio) vazio.hidden = !(q && !n);
}

// Itens da lista antiga ainda sem destino: mover para uma unidade (vira setor) ou transformar em unidade
function _orgPendentesHTML(pode, unidades) {
  const pend = _orgNomesPendentes().sort((a, b) => a.localeCompare(b, 'pt-BR'));
  if (!pend.length) return '';
  const ativas = unidades.filter(u => u.ativa !== false);
  const optsUn = `<option value="">— Unidade —</option>` + ativas.map(u => `<option value="${_orgEsc(u.id)}">${_orgEsc(u.sigla)} — ${_orgEsc(u.nome)}</option>`).join('');
  const linha = (nome, i) => {
    const n = _orgContarAtivosNome(nome);
    if (_orgEdit?.tipo === 'tornar' && _orgEdit.id === nome) {
      const p = _orgParseUnidade(nome);
      const precisaSetor = n > 0 || _orgPermissoesComNome(nome) > 0;
      return `<div class="org-pend-item editing">
        <b>${_orgEsc(nome)}</b> → nova unidade:
        <div class="org-linha">
          <input type="text" id="org-tornar-sigla" class="field-input org-sigla" maxlength="8" value="${_orgEsc(_orgSiglaSugerida(p.curto))}" placeholder="Sigla">
          <input type="text" id="org-tornar-nome" class="field-input" value="${_orgEsc(p.nome)}" placeholder="Nome da unidade">
        </div>
        ${precisaSetor ? `<div class="org-linha"><span>Setor para os ${n} ativo(s) e permissões que estão nela:</span>
          <input type="text" id="org-tornar-setor" class="field-input" value="Geral" placeholder="Ex.: Geral"></div>` : ''}
        <div class="org-linha" style="justify-content:flex-end;">
          <button class="btn btn-outline" onclick="orgCancelar()">Cancelar</button>
          <button class="btn btn-primary" onclick="orgLegadoTornarUnidade(${i})">Criar unidade</button>
        </div>
      </div>`;
    }
    return `<div class="org-pend-item">
      ${pode ? `<input type="checkbox" class="org-pend-chk" value="${i}" title="Selecionar">` : ''}
      <span class="org-pend-nome"><b>${_orgEsc(nome)}</b> <small>${n} ativo${n === 1 ? '' : 's'}</small></span>
      ${pode ? `<span class="org-pend-acoes">
        ${ativas.length ? `<select id="org-pend-un-${i}" class="field-input">${optsUn}</select>
        <button class="btn btn-outline btn-sm" onclick="orgLegadoMover([${i}], document.getElementById('org-pend-un-${i}').value)">Mover</button>` : ''}
        <button class="btn btn-outline btn-sm" onclick="orgEditar('tornar', ${i})">Tornar unidade</button>
        ${n === 0 ? `<button class="btn btn-outline btn-sm" onclick="orgLegadoExcluir(${i})" title="Remover da lista">${_ORG_ICO.del}</button>` : ''}
      </span>` : ''}
    </div>`;
  };
  _orgPendLista = pend;
  return `<div class="org-unidade org-sem-unidade">
    <div class="org-unidade-head"><div class="org-unidade-tit"><b>Lista antiga — sem unidade (${pend.length})</b>
      <span>itens do cadastro antigo de setores. Mova cada setor para a sua unidade ou transforme em unidade os itens que são unidades (ex.: “01 - Unidade NTO”).</span></div></div>
    ${pode && ativas.length ? `<div class="org-linha org-pend-lote">
      <span>Selecionados →</span><select id="org-pend-lote" class="field-input" style="max-width:280px;">${optsUn}</select>
      <button class="btn btn-outline btn-sm" onclick="orgLegadoMoverSelecionados()">Mover selecionados</button>
    </div>` : ''}
    ${pend.map(linha).join('')}
  </div>`;
}
let _orgPendLista = [];

function orgEditar(tipo, id) {
  _orgEdit = { tipo, id: tipo === 'tornar' ? _orgPendLista[id] : id };
  orgRenderGerenciador();
  document.getElementById({ setor: 'org-setor-nome', unidade: 'org-un-nome', tornar: 'org-tornar-sigla' }[tipo])?.focus();
}
function orgCancelar() { _orgEdit = null; orgRenderGerenciador(); }

// "01 - Unidade NTO" → { nome: 'Unidade NTO', curto: 'NTO' }
function _orgParseUnidade(txt) {
  const m = String(txt || '').match(/^\s*[\w.]+\s*[-–—]\s*(.+)$/);
  const nome = (m ? m[1] : String(txt || '')).trim();
  return { nome, curto: nome.replace(/^unidade\s+/i, '').trim() };
}
function _orgSiglaSugerida(curto) {
  return String(curto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8);
}

function _orgPodeGravar() {
  if (!_orgPodeEditar()) { showToast('Sem permissão para editar unidades e setores.', 'error'); return false; }
  if (!_orgReady || window._dbConnected === false) { showToast('Sem conexão com o banco. Tente novamente.', 'error'); return false; }
  return true;
}
// ── CONFIRMAÇÃO (janela própria no lugar do confirm() do navegador) ──
// tipo: 'perigo' (excluir) | 'aviso' (inativar) | 'info' (mover). mensagem/detalhe aceitam HTML já escapado.
// Resolve true ao confirmar; false ao cancelar, clicar fora ou Esc.
let _orgConfirmAberto = null;
const _ORG_CONF_ICO = {
  perigo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>',
  aviso:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>'
};
function _orgConfirmar({ tipo = 'aviso', titulo, mensagem, detalhe = '', confirmar = 'Confirmar', cancelar = 'Cancelar' }) {
  if (_orgConfirmAberto) _orgConfirmAberto(false);
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = `org-conf org-conf-${tipo}`;
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<div class="org-conf-box">
      <div class="org-conf-ico">${_ORG_CONF_ICO[tipo] || _ORG_CONF_ICO.aviso}</div>
      <div class="org-conf-tit" id="org-conf-tit">${_orgEsc(titulo)}</div>
      <div class="org-conf-msg">${mensagem}</div>
      ${detalhe ? `<div class="org-conf-det">${detalhe}</div>` : ''}
      <div class="org-conf-acoes">
        <button type="button" class="btn btn-outline" data-r="0">${_orgEsc(cancelar)}</button>
        <button type="button" class="btn org-conf-ok" data-r="1">${_orgEsc(confirmar)}</button>
      </div>
    </div>`;
    el.setAttribute('aria-labelledby', 'org-conf-tit');
    const anterior = document.activeElement;
    const tecla = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(false); }
      else if (e.key === 'Tab') {
        // Foco preso entre os dois botões
        const [b0, b1] = el.querySelectorAll('button');
        if (e.shiftKey && document.activeElement === b0) { e.preventDefault(); b1.focus(); }
        else if (!e.shiftKey && document.activeElement === b1) { e.preventDefault(); b0.focus(); }
      }
    };
    const fechar = r => {
      if (_orgConfirmAberto !== fechar) return;
      _orgConfirmAberto = null;
      document.removeEventListener('keydown', tecla, true);
      el.classList.remove('aberto');
      setTimeout(() => el.remove(), 180);
      try { anterior?.focus?.(); } catch (e) { /* elemento já saiu da tela */ }
      resolve(r);
    };
    _orgConfirmAberto = fechar;
    el.addEventListener('mousedown', e => { if (e.target === el) fechar(false); });
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => fechar(b.dataset.r === '1')));
    document.addEventListener('keydown', tecla, true);
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('aberto'));
    // Excluir começa no "Cancelar" (Enter não apaga por engano); os demais, no botão de ação
    el.querySelector(tipo === 'perigo' ? '[data-r="0"]' : '[data-r="1"]').focus();
  });
}

function _orgCarimbo() {
  return { atualizadoEm: new Date().toISOString(), atualizadoPor: (typeof currentSession !== 'undefined' && currentSession?.nomeCompleto) || '' };
}

// ── UNIDADES ─────────────────────────────────────────────────
async function orgUnidadeSalvar(id) {
  if (!_orgPodeGravar()) return;
  const sigla = (document.getElementById(id ? 'org-un-sigla' : 'org-un-nova-sigla')?.value || '').trim().toUpperCase();
  const nome  = (document.getElementById(id ? 'org-un-nome' : 'org-un-nova-nome')?.value || '').trim();
  if (!sigla || !nome) { showToast('Informe a sigla e o nome da unidade.', 'error'); return; }
  if (_orgUnidades({ todas: true }).some(u => u.id !== id && _orgNorm(u.sigla) === _orgNorm(sigla))) { showToast('Já existe uma unidade com essa sigla.', 'error'); return; }
  const atual = id ? _orgUnidade(id) : null;
  const novoId = id || _orgUid('un_');
  const rec = { ...(atual || { ativa: true, criadoEm: new Date().toISOString() }), id: novoId, sigla, nome, ..._orgCarimbo() };
  const ok = await window.dbUpdate({ [`${ORG_KEY}/unidades/${novoId}`]: rec });
  if (!ok) { showToast('Falha ao salvar a unidade.', 'error'); return; }
  _orgEdit = null;
  showToast(id ? 'Unidade salva!' : 'Unidade cadastrada. Adicione os setores dela.', 'success');
  if (id) { orgRenderGerenciador(); return; }
  _orgNovaUnidade = false;
  orgAbrirUnidade(novoId);
  setTimeout(() => document.getElementById('org-novo-setor')?.focus(), 150);
}

async function orgUnidadeAtivar(id, ativar) {
  if (!_orgPodeGravar()) return;
  const u = _orgUnidade(id);
  if (!u) return;
  if (!ativar && !(await _orgConfirmar({
    tipo: 'aviso', titulo: 'Inativar unidade?', confirmar: 'Inativar',
    mensagem: `A unidade <b>${_orgEsc(u.sigla)} — ${_orgEsc(u.nome)}</b> deixa de aparecer nas seleções.`,
    detalhe: 'Ativos e históricos são mantidos. Você pode reativá-la quando quiser.'
  }))) return;
  await window.dbUpdate({ [`${ORG_KEY}/unidades/${id}/ativa`]: !!ativar, [`${ORG_KEY}/unidades/${id}/atualizadoEm`]: new Date().toISOString() });
}

// Unidades do CQ vinculadas a esta unidade do sistema
function _orgUnidadesCQ(id) {
  return typeof cqState !== 'undefined' ? Object.values(cqState.config?.unidades || {}).filter(c => c && c.orgUnidadeId === id) : [];
}

async function orgUnidadeExcluir(id) {
  if (!_orgPodeGravar()) return;
  const u = _orgUnidade(id);
  if (!u) return;
  if (Object.values(orgState.setores).some(s => s && s.unidadeId === id)) { showToast('Não é possível excluir: a unidade tem setores. Mova ou exclua os setores antes (ou inative a unidade).', 'error'); return; }
  if (_orgUnidadesCQ(id).length) { showToast('Não é possível excluir: a unidade está vinculada ao Controle de Qualidade. Inative-a.', 'error'); return; }
  if (typeof authState !== 'undefined' && (authState.groups || []).some(g => (g.unidadeIdsPermitidas || []).includes(id))) { showToast('Não é possível excluir: há grupos de usuários com acesso a esta unidade.', 'error'); return; }
  if (!(await _orgConfirmar({
    tipo: 'perigo', titulo: 'Excluir unidade?', confirmar: 'Excluir unidade',
    mensagem: `A unidade <b>${_orgEsc(u.sigla)} — ${_orgEsc(u.nome)}</b> será excluída.`,
    detalhe: 'Esta ação não pode ser desfeita.'
  }))) return;
  if (!(await window.dbUpdate({ [`${ORG_KEY}/unidades/${id}`]: null }))) { showToast('Falha ao excluir a unidade.', 'error'); return; }
  if (_orgDetalheId === id) orgFecharUnidade();
}

// ── SETORES ──────────────────────────────────────────────────
// Testes de CQ que usam o setor (pelo setorId gravado ou pelo equipamento)
function _orgTestesCQDoSetor(setorId) {
  if (typeof cqState === 'undefined') return [];
  return Object.values(cqState.config?.testes || {}).filter(t => {
    if (t.setorId) return t.setorId === setorId;
    const a = t.ativoId && typeof _ativoById === 'function' ? _ativoById(t.ativoId) : null;
    return a ? _orgSetorIdDoAtivo(a) === setorId : false;
  });
}

// Adiciona um ou vários setores (separados por ;) à unidade
async function orgSetoresAdicionar(unidadeId) {
  if (!_orgPodeGravar()) return;
  const inp = document.getElementById('org-novo-setor');
  const nomes = [...new Set(String(inp?.value || '').split(/[;\n]/).map(s => s.trim()).filter(Boolean))];
  if (!nomes.length) { showToast('Informe o nome do setor.', 'error'); return; }
  const ja = nomes.filter(n => Object.values(orgState.setores).some(s => s && s.unidadeId === unidadeId && _orgNorm(s.nome) === _orgNorm(n)));
  const novos = nomes.filter(n => !ja.includes(n));
  if (!novos.length) { showToast(`Já existe(m) em ${_orgSiglaUnidade(unidadeId)}: ${ja.join(', ')}.`, 'error'); return; }
  const up = {};
  novos.forEach(nome => {
    const id = _orgUid('st_');
    up[`${ORG_KEY}/setores/${id}`] = { id, nome, unidadeId, ativo: true, criadoEm: new Date().toISOString(), ..._orgCarimbo() };
  });
  if (!(await window.dbUpdate(up))) { showToast('Falha ao salvar os setores.', 'error'); return; }
  showToast(`${novos.length} setor(es) adicionado(s)${ja.length ? ` · já existiam: ${ja.join(', ')}` : ''}.`, 'success');
  const campo = document.getElementById('org-novo-setor');
  if (campo) { campo.value = ''; campo.focus(); }
}

async function orgSetorSalvar(id) {
  if (!_orgPodeGravar()) return;
  const atual = orgState.setores[id];
  if (!atual) return;
  const nome = (document.getElementById('org-setor-nome')?.value || '').trim();
  const un = document.getElementById('org-setor-unidade')?.value || atual.unidadeId;
  if (!nome) { showToast('Informe o nome do setor.', 'error'); return; }
  if (!_orgUnidade(un)) { showToast('Escolha a unidade do setor.', 'error'); return; }
  if (Object.values(orgState.setores).some(s => s && s.id !== id && s.unidadeId === un && _orgNorm(s.nome) === _orgNorm(nome))) { showToast(`Já existe o setor "${nome}" em ${_orgSiglaUnidade(un)}.`, 'error'); return; }
  if (atual.unidadeId !== un) {
    // Mover de unidade muda a unidade de todos os ativos do setor
    const testes = _orgTestesCQDoSetor(id).filter(t => _orgUnidadeCQDoTeste(t) && _orgUnidadeCQDoTeste(t) !== un);
    if (testes.length) { showToast(`Não é possível mover: ${testes.length} teste(s) de CQ de outra unidade usam este setor.`, 'error'); return; }
    const nAt = _orgContarAtivos(id);
    if (!(await _orgConfirmar({
      tipo: 'info', titulo: 'Mover setor?', confirmar: 'Mover setor',
      mensagem: `O setor <b>${_orgEsc(atual.nome)}</b> sai de <b>${_orgEsc(_orgSiglaUnidade(atual.unidadeId))}</b> e passa para <b>${_orgEsc(_orgSiglaUnidade(un))}</b>.`,
      detalhe: nAt ? `${nAt} ativo(s) deste setor passam a pertencer a essa unidade.` : 'O setor não tem ativos vinculados.'
    }))) return;
  }
  const ok = await window.dbUpdate({ [`${ORG_KEY}/setores/${id}`]: { ...atual, nome, unidadeId: un, ..._orgCarimbo() } });
  if (!ok) { showToast('Falha ao salvar o setor.', 'error'); return; }
  // Renomeado: atualiza o nome de exibição gravado nos ativos
  if (atual.nome !== nome) {
    let mudou = false;
    state.ativos.forEach(a => { if (a && a.setorId === id && a.setor !== nome) { a.setor = nome; mudou = true; } });
    if (mudou) saveState();
  }
  _orgEdit = null;
  orgRenderGerenciador();
  showToast('Setor salvo!', 'success');
}
// Unidade do sistema da unidade de CQ do teste
function _orgUnidadeCQDoTeste(t) {
  return typeof cqState !== 'undefined' ? (cqState.config?.unidades?.[t.unidadeId]?.orgUnidadeId || '') : '';
}

async function orgSetorAtivar(id, ativar) {
  if (!_orgPodeGravar()) return;
  const s = orgState.setores[id];
  if (!s) return;
  if (!ativar && !(await _orgConfirmar({
    tipo: 'aviso', titulo: 'Inativar setor?', confirmar: 'Inativar',
    mensagem: `O setor <b>${_orgEsc(s.nome)}</b> (${_orgEsc(_orgSiglaUnidade(s.unidadeId))}) deixa de ser oferecido para novos cadastros.`,
    detalhe: 'Ativos e históricos são mantidos. Você pode reativá-lo quando quiser.'
  }))) return;
  await window.dbUpdate({ [`${ORG_KEY}/setores/${id}/ativo`]: !!ativar, [`${ORG_KEY}/setores/${id}/atualizadoEm`]: new Date().toISOString() });
}

async function orgSetorExcluir(id) {
  if (!_orgPodeGravar()) return;
  const s = orgState.setores[id];
  if (!s) return;
  const bloqueio = [];
  const nAtivos = _orgContarAtivos(id);
  if (nAtivos) bloqueio.push(`${nAtivos} ativo(s)`);
  const nGrupos = typeof authState !== 'undefined' ? (authState.groups || []).filter(g => (g.setorIdsPermitidos || []).includes(id)).length : 0;
  if (nGrupos) bloqueio.push(`${nGrupos} grupo(s) de usuários`);
  const nTestes = _orgTestesCQDoSetor(id).length;
  if (nTestes) bloqueio.push(`${nTestes} teste(s) de CQ`);
  const nOT = (typeof otState !== 'undefined' ? otState.ordens : []).filter(o => o && o.setorId === id).length;
  if (nOT) bloqueio.push(`${nOT} OT(s)`);
  if (Object.values(orgState.legado).some(x => x && x.setorId === id)) bloqueio.push('vínculo com item da lista antiga');
  if (bloqueio.length) { showToast(`Não é possível excluir: o setor é usado por ${bloqueio.join(', ')}. Inative-o.`, 'error'); return; }
  if (!(await _orgConfirmar({
    tipo: 'perigo', titulo: 'Excluir setor?', confirmar: 'Excluir setor',
    mensagem: `O setor <b>${_orgEsc(s.nome)}</b> (${_orgEsc(_orgSiglaUnidade(s.unidadeId))}) será excluído.`,
    detalhe: 'Esta ação não pode ser desfeita.'
  }))) return;
  await window.dbUpdate({ [`${ORG_KEY}/setores/${id}`]: null });
}

// ── LISTA ANTIGA ─────────────────────────────────────────────
// Ativos que estavam no nome antigo passam a apontar para o setor (nome de exibição = setor novo)
function _orgAplicarNosAtivos(nome, setorId, nomeSetor) {
  let mudou = false;
  state.ativos.forEach(a => {
    if (a && !a.setorId && a.setor === nome) { a.setorId = setorId; a.setor = nomeSetor; mudou = true; }
  });
  if (mudou) saveState();
}
function _orgEntradaLegado(nome, setorId, unidadeId) {
  return { nome, setorId: setorId || '', unidadeId: unidadeId || '', em: new Date().toISOString(),
           porNome: (typeof currentSession !== 'undefined' && currentSession?.nomeCompleto) || '' };
}

function orgLegadoMoverSelecionados() {
  const idx = [...document.querySelectorAll('.org-pend-chk:checked')].map(c => Number(c.value));
  if (!idx.length) { showToast('Marque os itens a mover.', 'error'); return; }
  orgLegadoMover(idx, document.getElementById('org-pend-lote')?.value);
}

// Move itens da lista antiga para a unidade: cada um vira setor dela (reaproveita setor de mesmo nome)
async function orgLegadoMover(indices, unidadeId) {
  if (!_orgPodeGravar()) return;
  if (!unidadeId || !_orgUnidade(unidadeId)) { showToast('Escolha a unidade.', 'error'); return; }
  const nomes = indices.map(i => _orgPendLista[i]).filter(Boolean);
  if (!nomes.length) return;
  const up = {}, destino = {};
  nomes.forEach(nome => {
    let s = Object.values(orgState.setores).find(x => x && x.unidadeId === unidadeId && _orgNorm(x.nome) === _orgNorm(nome));
    if (!s) {
      s = { id: _orgUid('st_'), nome, unidadeId, ativo: true, criadoEm: new Date().toISOString(), ..._orgCarimbo() };
      up[`${ORG_KEY}/setores/${s.id}`] = s;
    }
    destino[nome] = s;
    up[`${ORG_KEY}/legado/${_orgUid('lg_')}`] = _orgEntradaLegado(nome, s.id, unidadeId);
  });
  if (!(await window.dbUpdate(up))) { showToast('Falha ao mover.', 'error'); return; }
  nomes.forEach(nome => _orgAplicarNosAtivos(nome, destino[nome].id, destino[nome].nome));
  showToast(`${nomes.length} item(ns) movido(s) para ${_orgSiglaUnidade(unidadeId)}.`, 'success');
}

// Transforma um item da lista antiga em unidade; ativos/permissões dele vão para um setor da nova unidade
async function orgLegadoTornarUnidade() {
  if (!_orgPodeGravar()) return;
  const nome = _orgEdit?.tipo === 'tornar' ? _orgEdit.id : null;
  if (!nome) return;
  const sigla = (document.getElementById('org-tornar-sigla')?.value || '').trim().toUpperCase();
  const nomeUn = (document.getElementById('org-tornar-nome')?.value || '').trim();
  const setorEl = document.getElementById('org-tornar-setor');
  const nomeSetor = setorEl ? setorEl.value.trim() : '';
  if (!sigla || !nomeUn) { showToast('Informe a sigla e o nome da unidade.', 'error'); return; }
  if (_orgUnidades({ todas: true }).some(u => _orgNorm(u.sigla) === _orgNorm(sigla))) { showToast('Já existe uma unidade com essa sigla.', 'error'); return; }
  if (setorEl && !nomeSetor) { showToast('Informe o setor para os ativos que estão nesta unidade (ex.: Geral).', 'error'); return; }
  const ts = new Date().toISOString();
  const unId = _orgUid('un_');
  const up = { [`${ORG_KEY}/unidades/${unId}`]: { id: unId, sigla, nome: nomeUn, ativa: true, criadoEm: ts, ..._orgCarimbo() } };
  let setorId = '';
  if (nomeSetor) {
    setorId = _orgUid('st_');
    up[`${ORG_KEY}/setores/${setorId}`] = { id: setorId, nome: nomeSetor, unidadeId: unId, ativo: true, criadoEm: ts, ..._orgCarimbo() };
  }
  up[`${ORG_KEY}/legado/${_orgUid('lg_')}`] = _orgEntradaLegado(nome, setorId, unId);
  if (!(await window.dbUpdate(up))) { showToast('Falha ao criar a unidade.', 'error'); return; }
  if (setorId) _orgAplicarNosAtivos(nome, setorId, nomeSetor);
  _orgEdit = null;
  showToast(`Unidade ${sigla} criada${setorId ? ` com o setor ${nomeSetor}` : ''}.`, 'success');
}

// Remove da lista antiga um item sem ativos e sem permissões
async function orgLegadoExcluir(i) {
  if (!_orgPodeEditar()) { showToast('Sem permissão para editar setores.', 'error'); return; }
  const nome = _orgPendLista[i];
  if (!nome) return;
  if (state.ativos.some(a => a && a.setor === nome && !a.setorId)) { showToast('Não é possível remover: há ativos neste item.', 'error'); return; }
  if (_orgPermissoesComNome(nome)) { showToast('Não é possível remover: há grupos ou usuários com acesso a este item.', 'error'); return; }
  if (!(await _orgConfirmar({
    tipo: 'perigo', titulo: 'Remover da lista antiga?', confirmar: 'Remover',
    mensagem: `O item <b>${_orgEsc(nome)}</b> sai da lista antiga de setores.`,
    detalhe: 'Não há ativos nem permissões usando este item.'
  }))) return;
  state.setores = (state.setores || []).filter(s => s !== nome);
  saveState();
  orgRenderGerenciador();
}

// ── BACKUP ───────────────────────────────────────────────────
function _orgParaBackup() { return { unidades: orgState.unidades, setores: orgState.setores, legado: orgState.legado }; }
