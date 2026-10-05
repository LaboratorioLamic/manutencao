// ═══════════════════════════════════════════════════════════════
// cq.js — Módulo de Controle de Qualidade — LAMIC
// Núcleo: armazenamento, unidades, permissões, trilha de auditoria,
// aba principal, painel, configurações, card da Início e integrações.
// Base: RDC ANVISA 978/2025 (Cap. VII — Gestão do Controle da Qualidade),
// RDC 63/2011, PALC 2021 (seção 11) e ISO 15189:2022 (7.3.7).
// Demais arquivos: cq-engine.js (cálculos), cq-cadastros.js,
// cq-lancamento.js, cq-graficos.js, cq-acoes.js.
// ═══════════════════════════════════════════════════════════════

// ── STORAGE ──────────────────────────────────────────────────
// Cada registro fica em nó próprio. Resultados e corridas são
// particionados por unidade e mês e nunca são escutados por inteiro.
const CQ_KEYS = {
  config:     'gestao-cq-config-v1',      // cadastros (escutado)
  alvos:      'gestao-cq-alvos-v1',       // /{u}/{teste}/{alvoId} (escutado só da unidade ativa)
  corridas:   'gestao-cq-corridas-v1',    // /{u}/{yyyymm}/{corridaKey}
  resultados: 'gestao-cq-resultados-v1',  // /{u}/{yyyymm}/{teste}/{resKey}
  acoes:      'gestao-cq-acoes-v1',       // /{u}/{ano}/{ncId}
  indices:    'gestao-cq-indices-v1',     // /{u}/{ultimo|pendentes|ncAbertas} (escutado)
  seq:        'gestao-cq-seq-v1',         // /{u}/{corridas|nc}/{ano}
  uso:        'gestao-cq-uso-v1',         // /{colecao}/{id}: true — cadastro já usado em lançamento
  exclusoes:  'gestao-cq-exclusoes-v1',   // /{tk} — cadastros excluídos antes de qualquer lançamento
  cargas:     'gestao-cq-cargas-v1',      // /{u}/{lote da carga} — reserva do lote único do ciclo de esterilização
};
const CQ_VERSAO = '1.0.0';

const CQ_CATALOGOS_PADRAO = {
  causas: [
    'Erro de digitação / transcrição', 'Controle deteriorado ou mal reconstituído', 'Frasco de controle vencido / estabilidade excedida',
    'Reagente deteriorado ou troca de lote', 'Calibração inadequada ou vencida', 'Falha do equipamento', 'Após manutenção do equipamento',
    'Água reagente fora da especificação', 'Temperatura / condições ambientais', 'Erro do operador', 'Erro aleatório (sem causa identificada)',
  ],
  acoes: [
    'Repetição do controle (mesmo frasco)', 'Novo frasco de controle', 'Recalibração', 'Troca de lote ou frasco de reagente',
    'Manutenção / limpeza do equipamento', 'Acionamento da assistência técnica', 'Retreinamento do operador',
    'Reprocessamento de amostras de pacientes', 'Outra',
  ],
  fontesETa: [
    'CLIA 2024 (EUA)', 'RiliBÄK (Alemanha)', 'Variação biológica — desejável (EFLM)', 'Variação biológica — mínima',
    'Variação biológica — ótima', 'Estado da arte / CEQ (provedor)', 'Fabricante', 'Definida pelo laboratório (justificada)',
  ],
};

const CQ_COLECOES = ['unidades', 'analitos', 'materiais', 'lotesControle', 'insumoProdutos', 'insumos', 'testes', 'validacoes'];

let cqState = {
  config: { unidades: {}, analitos: {}, materiais: {}, lotesControle: {}, insumoProdutos: {}, insumos: {}, testes: {}, validacoes: {},
            catalogos: JSON.parse(JSON.stringify(CQ_CATALOGOS_PADRAO)) },
  alvos: {},     // { testeId: { alvoId: alvo } } da unidade ativa
  indices: {},   // { unidadeId: { ultimo, pendentes, ncAbertas } }
};

let _cqConfigReady  = false;
let _cqIndicesReady = false;
let _cqAlvosReady   = false;
let _cqUnsubAlvos   = null;
let _cqAlvosUnidade = null;
let _cqSub          = 'painel';
let _cqPromptCb     = null;
let _cqSalvando     = false;

const CQ_STATUS = {
  aceito:    { label: 'Aceito',          cls: 'cq-st-aceito'  },
  alerta:    { label: 'Alerta',          cls: 'cq-st-alerta'  },
  rejeitado: { label: 'Rejeitado',       cls: 'cq-st-rejeitado' },
  sem_alvo:  { label: 'Sem alvo',        cls: 'cq-st-semalvo' },
  pendente:  { label: 'Aguardando',      cls: 'cq-st-pendente' },
};
const CQ_DECISAO = {
  liberado:               { label: 'Liberado',                 cls: 'cq-st-aceito',    sigla: 'L' },
  rejeitado:              { label: 'Rejeitado',                cls: 'cq-st-rejeitado', sigla: 'R' },
  liberado_com_violacao:  { label: 'Liberado com justificativa', cls: 'cq-st-alerta',  sigla: 'O' },
};
const CQ_CORRIDA_STATUS = {
  pendente:  { label: 'Aguardando avaliação', cls: 'cq-st-pendente' },
  liberada:  { label: 'Liberada',             cls: 'cq-st-aceito' },
  parcial:   { label: 'Parcialmente liberada', cls: 'cq-st-alerta' },
  rejeitada: { label: 'Rejeitada',            cls: 'cq-st-rejeitado' },
};
const CQ_DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const CQ_FUSOS = {
  'America/Sao_Paulo': 'Brasília (UTC−3)', 'America/Bahia': 'Bahia (UTC−3)', 'America/Fortaleza': 'Fortaleza (UTC−3)',
  'America/Recife': 'Recife (UTC−3)', 'America/Belem': 'Belém (UTC−3)', 'America/Cuiaba': 'Cuiabá (UTC−4)',
  'America/Manaus': 'Manaus (UTC−4)', 'America/Porto_Velho': 'Porto Velho (UTC−4)', 'America/Rio_Branco': 'Rio Branco (UTC−5)',
  'America/Noronha': 'Fernando de Noronha (UTC−2)',
};
const CQ_PAPEIS = { operador: 'Operador', supervisor: 'Supervisor', rt: 'Responsável técnico' };

const CQ_ICO = {
  beaker:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3h6"/><path d="M10 3v6.5L4.6 18.4A2 2 0 006.3 21.5h11.4a2 2 0 001.7-3.1L14 9.5V3"/><line x1="7.5" y1="15" x2="16.5" y2="15"/></svg>`,
  painel:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>`,
  lancar:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`,
  lista:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.5" fill="currentColor"/><circle cx="3" cy="12" r="1.5" fill="currentColor"/><circle cx="3" cy="18" r="1.5" fill="currentColor"/></svg>`,
  grafico: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 17 8 11 12 14 17 7 21 10"/><line x1="3" y1="21" x2="21" y2="21"/></svg>`,
  alerta:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  cadastro:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>`,
  plus:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  check:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
  close:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  edit:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`,
  ativo:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
  clock:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  lock:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`,
  print:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
  undo:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>`,
  play:    `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7 4.5v15a1 1 0 001.5.86l12-7.5a1 1 0 000-1.72l-12-7.5A1 1 0 007 4.5z"/></svg>`,
  pause:   `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4.5" width="4" height="15" rx="1.2"/><rect x="14" y="4.5" width="4" height="15" rx="1.2"/></svg>`,
  ban:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
  unidade: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  repeat:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>`,
  info:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="11"/><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none"/></svg>`,
  busca:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  shield:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
};

// ── INICIALIZAÇÃO ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  cqLoad();
  _cqInjectModals();
  _cqHookTab();
  window.addEventListener('beforeunload', e => {
    if (_cqSalvando) { e.preventDefault(); e.returnValue = ''; }
  });
});

function cqLoad() {
  window._dbReady.then(() => {
    window.dbListen(CQ_KEYS.config, data => {
      const first = !_cqConfigReady;
      _cqConfigReady = true;
      _cqApplyConfig(data);
      _cqMigrarEquipAnalitos(data);
      _cqMigrarEquipInsumos(data);
      _cqEncerrarVencidos();
      _cqGarantirUnidadeAtiva();
      _cqOuvirAlvos();
      cqRender();
      if (document.getElementById('cpanel-cq')?.classList.contains('active')) cqRenderConfig();
      if (typeof renderHome === 'function' && (first || document.getElementById('tab-inicio')?.classList.contains('active'))) renderHome();
    });
    window.dbListen(CQ_KEYS.indices, data => {
      _cqIndicesReady = true;
      cqState.indices = (data && typeof data === 'object') ? data : {};
      _cqUpdateNavBadge();
      if (_cqTabAtiva() && ['painel', 'corridas', 'ncs'].includes(_cqSub)) cqRender();
      if (typeof renderHome === 'function' && document.getElementById('tab-inicio')?.classList.contains('active')) renderHome();
    });
  });
}

// Gatilho: lote de controle ou de insumo com validade expirada é encerrado automaticamente.
// Roda ao carregar/alterar os cadastros e a cada hora (virada do dia com o app aberto). A chave da
// trilha deriva da validade e da última alteração do lote, então estações simultâneas gravam o mesmo
// registro em vez de duplicá-lo. `encerradoAuto` mantém o lote disponível para corrida retroativa
// datada dentro da validade (o lançamento continua bloqueando lote vencido na data da corrida).
let _cqEncerrandoVencidos = false;
async function _cqEncerrarVencidos() {
  if (_cqEncerrandoVencidos || !_cqConfigReady || window._dbConnected === false) return;
  if (!_cqCan('configurar') && !_cqCan('lancar')) return;
  const hoje = _cqHoje();
  const alvos = [];
  ['lotesControle', 'insumos'].forEach(col => Object.values(cqState.config[col] || {}).forEach(l => {
    if (l.validade && l.validade < hoje && l.status !== 'encerrado') alvos.push({ col, l: _cqLoteCru(l) });
  }));
  if (!alvos.length) return;
  _cqEncerrandoVencidos = true;
  const updates = {};
  const agora = _cqAgora();
  alvos.forEach(({ col, l }) => {
    const p = `${CQ_KEYS.config}/${col}/${l.id}`;
    const tk = (Date.parse(`${l.validade}T00:00:00Z`) + 864e5).toString(36).padStart(9, '0') + 'auto' + String(l.atualizadoEm || '').replace(/\D/g, '').slice(-6);
    const antes = CQ_STATUS_LOTE[l.status || 'em_uso']?.label || l.status;
    updates[`${p}/status`] = 'encerrado';
    updates[`${p}/encerradoAuto`] = { em: agora, validade: l.validade, statusAnterior: l.status || 'em_uso' };
    updates[`${p}/atualizadoEm`] = agora;
    updates[`${p}/trilha/${tk}`] = _cqTrilhaEntry('automatico', `Lote encerrado automaticamente: validade ${_cqFmtData(l.validade)} expirada`,
      [{ campo: 'Situação', antes, depois: 'Encerrado' }], { automatico: true });
  });
  try { await window.dbUpdate(updates); } finally { _cqEncerrandoVencidos = false; }
}
setInterval(() => { if (_cqConfigReady) _cqEncerrarVencidos(); }, 60 * 60 * 1000);

// Migração (uma vez): o equipamento/sistema passou a ser cadastrado no analito e o teste
// escolhe entre eles. Vincula a cada analito os equipamentos e sistemas dos testes existentes.
let _cqMigrouEquip = false;
function _cqMigrarEquipAnalitos(data) {
  if (_cqMigrouEquip || data?.migracoes?.analitoEquip || !_cqCan('configurar') || window._dbConnected === false) return;
  _cqMigrouEquip = true;
  const updates = {};
  Object.values(cqState.config.analitos).forEach(a => {
    const ativoIds = _cqArr(a.ativoIds).slice(), sistemas = _cqArr(a.sistemas).slice(), add = [];
    Object.values(cqState.config.testes).filter(t => t.analitoId === a.id).forEach(t => {
      if (t.ativoId) {
        if (!ativoIds.includes(t.ativoId)) { ativoIds.push(t.ativoId); add.push(_cqEquipTeste(t)); }
      } else {
        const sis = t.sistemaAnalitico || 'Bancada / manual';
        if (!sistemas.some(x => x.toLowerCase() === sis.toLowerCase())) { sistemas.push(sis); add.push(sis); }
      }
    });
    if (!add.length) return;
    const p = `${CQ_KEYS.config}/analitos/${a.id}`;
    updates[`${p}/ativoIds`] = ativoIds;
    updates[`${p}/sistemas`] = sistemas;
    updates[`${p}/trilha/${_cqTk()}`] = _cqTrilhaEntry('migracao', `Equipamentos/sistemas vinculados a partir dos testes existentes: ${add.join(', ')}`);
  });
  updates[`${CQ_KEYS.config}/migracoes/analitoEquip`] = { em: _cqAgora(), porNome: _cqSess().nome, versao: CQ_VERSAO };
  window.dbUpdate(updates).then(ok => { if (!ok) _cqMigrouEquip = false; });
}

// Migração (uma vez): insumo passou de um equipamento (ativoId) para vários equipamentos/sistemas (equips)
let _cqMigrouInsEquip = false;
function _cqMigrarEquipInsumos(data) {
  if (_cqMigrouInsEquip || data?.migracoes?.insumoEquips || !_cqCan('configurar') || window._dbConnected === false) return;
  _cqMigrouInsEquip = true;
  const updates = {};
  Object.values(cqState.config.insumos).filter(i => i.ativoId).forEach(i => {
    const p = `${CQ_KEYS.config}/insumos/${i.id}`;
    updates[`${p}/equips`] = [...new Set([..._cqArr(i.equips), 'a:' + i.ativoId])];
    updates[`${p}/ativoId`] = null;
    updates[`${p}/trilha/${_cqTk()}`] = _cqTrilhaEntry('migracao', `Equipamento convertido para a lista de equipamentos/sistemas: ${_cqRotuloEquip('a:' + i.ativoId)}`);
  });
  updates[`${CQ_KEYS.config}/migracoes/insumoEquips`] = { em: _cqAgora(), porNome: _cqSess().nome, versao: CQ_VERSAO };
  window.dbUpdate(updates).then(ok => { if (!ok) _cqMigrouInsEquip = false; });
}

// Equipamento/sistema: chaves 'a:<ativoId>' (ativo cadastrado) ou 'm:<sistema>' (sem equipamento)
function _cqRotuloEquip(k) {
  k = String(k || '');
  if (k.startsWith('a:')) return _cqNomeAtivo(k.slice(2));
  return k.startsWith('m:') ? k.slice(2) : k;
}
function _cqEquipDoTeste(t) { return t?.ativoId ? 'a:' + t.ativoId : 'm:' + (t?.sistemaAnalitico || 'Bancada / manual'); }
// Equipamentos/sistemas do insumo (compatível com o campo antigo ativoId)
function _cqEquipsInsumo(i) {
  const eqs = _cqArr(i?.equips);
  return eqs.length ? eqs : (i?.ativoId ? ['a:' + i.ativoId] : []);
}
// Material de controle serve ao equipamento/sistema e ao analito do teste?
// Sem equipamentos (ou sem analitos) cadastrados = serve a qualquer um (ex.: controle multianalito de terceira parte)
function _cqMaterialServe(m, equip, analitoId) {
  const eqs = _cqArr(m?.equips), ans = _cqArr(m?.analitoIds);
  const okEq = !eqs.length || !equip || eqs.some(k => _cqEquipChave(k) === _cqEquipChave(equip));
  const okAn = !ans.length || !analitoId || ans.includes(analitoId);
  return okEq && okAn;
}

// Opções do popover de equipamentos do insumo: ativos do CQ + equipamentos e sistemas dos analitos
function _cqOpcoesEquipInsumo(manter) {
  const mapa = new Map();
  const add = o => { const k = _cqEquipChave(o.value); if (!mapa.has(k)) mapa.set(k, o); };
  const SIS = 'Sem equipamento (bancada / manual)';
  _cqAtivosCQ().forEach(a => add({ value: 'a:' + a.id, label: a.nome || a.id, sub: [a.codigo, a.modelo].filter(Boolean).join(' · '), grupo: a.setor || 'Sem setor' }));
  Object.values(cqState.config.analitos).filter(a => a.ativo !== false && _cqNaUnidade(a)).forEach(an => _cqEquipsDoAnalito(an).forEach(o => {
    const sis = o.value.startsWith('m:');
    add({ value: o.value, label: sis ? o.label : (o.ativo?.nome || o.label), sub: sis ? 'Sistema analítico sem equipamento' : (o.ativo?.codigo || ''), grupo: sis ? SIS : (o.ativo?.setor || 'Sem setor') });
  }));
  _cqArr(manter).forEach(k => add({ value: k, label: _cqRotuloEquip(k), sub: 'Não vinculado a analito', grupo: String(k).startsWith('m:') ? SIS : 'Sem setor' }));
  const ordem = o => (o.grupo === SIS ? '1' : '0') + o.grupo;
  return [...mapa.values()].sort((a, b) => ordem(a).localeCompare(ordem(b)) || a.label.localeCompare(b.label));
}

// Equipamentos e sistemas analíticos do analito, como opções do teste ('a:<ativoId>' | 'm:<sistema>')
function _cqEquipsDoAnalito(an) {
  if (!an) return [];
  const eq = _cqArr(an.ativoIds).map(id => {
    const a = typeof _ativoById === 'function' ? _ativoById(id) : null;
    return { value: 'a:' + id, label: `${a?.nome || 'Equipamento removido'}${a?.codigo ? ' · ' + a.codigo : ''}`, grupo: a?.setor || 'Equipamentos', ativo: a };
  }).filter(o => o.ativo?.statusUso !== 'em_desuso');
  const sis = _cqArr(an.sistemas).map(x => ({ value: 'm:' + x, label: x, grupo: 'Sem equipamento (bancada / manual)' }));
  return [...eq, ...sis];
}

function _cqApplyConfig(d) {
  const src = (d && typeof d === 'object') ? d : {};
  CQ_COLECOES.forEach(c => {
    const out = {};
    Object.entries(src[c] || {}).forEach(([id, r]) => { if (r && typeof r === 'object') out[id] = { ...r, id }; });
    cqState.config[c] = out;
  });
  const cat = src.catalogos;
  if (cat && typeof cat === 'object') {
    Object.keys(CQ_CATALOGOS_PADRAO).forEach(k => {
      const v = _cqArr(cat[k]);
      if (v.length) cqState.config.catalogos[k] = v;
    });
  }
  _cqHidratarInsumos();
}

// ── PRODUTOS E LOTES DE INSUMO ───────────────────────────────
// O produto (insumoProdutos) guarda tipo, fabricante, equipamentos/analitos e o preparo interno;
// o lote (insumos) guarda produtoId, número, validade, situação e os preparos. Em memória o lote
// recebe os campos do produto, então quem lê `insumos` continua vendo nome, tipo, equips etc.
// Lote antigo (sem produtoId) mantém os próprios campos até ser organizado em produto.
const CQ_CAMPOS_PRODUTO = ['tipo', 'nome', 'fabricante', 'regAnvisa', 'equips', 'analitoIds', 'preparoInterno', 'preparo'];
function _cqLoteCru(i) { return i?._cru || i; }
function _cqProdutoInsumo(i) { const pid = _cqLoteCru(i)?.produtoId; return pid ? cqState.config.insumoProdutos[pid] || null : null; }
function _cqHidratarInsumos() {
  const prods = cqState.config.insumoProdutos || {};
  Object.entries(cqState.config.insumos || {}).forEach(([id, x]) => {
    const l = _cqLoteCru(x);
    const p = l?.produtoId ? prods[l.produtoId] : null;
    if (!p) { cqState.config.insumos[id] = l; return; }
    const h = { ...l };
    CQ_CAMPOS_PRODUTO.forEach(k => { h[k] = p[k] ?? null; });
    Object.defineProperty(h, '_cru', { value: l });
    cqState.config.insumos[id] = h;
  });
}
function _cqLotesDoProduto(pid) { return Object.values(cqState.config.insumos).filter(i => _cqLoteCru(i).produtoId === pid); }
// Nome do produto controlado pelo teste (vínculo por id; testes antigos guardam só o nome)
function _cqNomeProdutoTeste(t) { return cqState.config.insumoProdutos[t?.insumoProdutoId]?.nome || t?.insumoProduto || ''; }

// Filtro de situação dos lotes (controles e insumos). Lote vencido é encerrado pelo gatilho
// (_cqEncerrarVencidos); "Vencido" lista os de validade expirada, encerrados ou ainda não.
const CQ_SITUACAO_FILTRO = { em_uso: 'Em uso', em_avaliacao: 'Em avaliação', quarentena: 'Quarentena', encerrado: 'Encerrado', vencido: 'Vencido' };
function _cqLoteVencido(l, hoje) { return !!(l?.validade && l.validade < (hoje || _cqHoje())); }
// Vencido e ainda não encerrado (o gatilho não rodou: sem conexão ou sem permissão nesta estação)
function _cqLoteVencidoAberto(l, hoje) { return _cqLoteVencido(l, hoje) && l.status !== 'encerrado'; }
function _cqLoteNaSituacao(l, sel, hoje) {
  if (!_cqArr(sel).length) return true;
  return sel.includes(l.status || 'em_uso') || (sel.includes('vencido') && _cqLoteVencido(l, hoje));
}
function _cqLoteSituacaoBadge(l, hoje) {
  if (_cqLoteVencidoAberto(l, hoje)) return '<span class="cq-badge cq-st-rejeitado">Vencido</span>';
  if (l.status === 'encerrado' && _cqLoteVencido(l, hoje)) return `<span class="cq-badge cq-st-semalvo" title="${l.encerradoAuto ? `Encerrado automaticamente em ${_cqFmtDH(l.encerradoAuto.em)}` : 'Encerrado'}">Encerrado · vencido</span>`;
  return _cqBadge(CQ_STATUS_LOTE, l.status || 'em_uso');
}

function _cqOuvirAlvos() {
  const u = _cqUnidadeAtivaId();
  if (u === _cqAlvosUnidade) return;
  if (_cqUnsubAlvos) { _cqUnsubAlvos(); _cqUnsubAlvos = null; }
  _cqAlvosUnidade = u;
  cqState.alvos = {};
  _cqAlvosReady = false;
  if (!u) return;
  _cqUnsubAlvos = window.dbListen(`${CQ_KEYS.alvos}/${u}`, data => {
    if (_cqAlvosUnidade !== u) return;
    const out = {};
    Object.entries((data && typeof data === 'object') ? data : {}).forEach(([t, mapa]) => {
      out[t] = {};
      Object.entries(mapa || {}).forEach(([id, a]) => { if (a && typeof a === 'object') out[t][id] = { ...a, id }; });
    });
    cqState.alvos = out;
    _cqAlvosReady = true;
    if (_cqTabAtiva()) cqRender();
  });
}

// ── HELPERS ───────────────────────────────────────────────────
function _cqUid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
// Chave de trilha: ordenável no tempo e única entre estações
function _cqTk() { return Date.now().toString(36).padStart(9, '0') + Math.random().toString(36).slice(2, 6); }
function _cqEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _cqArr(v) {
  if (Array.isArray(v)) return v.filter(x => x !== null && x !== undefined);
  if (v && typeof v === 'object') return Object.values(v);
  return [];
}
function _cqAgora() { return new Date().toISOString(); }
function _cqPad(n) { return String(n).padStart(2, '0'); }

// Data/hora local "YYYY-MM-DDTHH:mm" no fuso da unidade
function _cqNowLocal(fuso) {
  const d = new Date();
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: fuso || _cqUnidade()?.fuso || undefined, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  } catch (e) {
    return `${d.getFullYear()}-${_cqPad(d.getMonth() + 1)}-${_cqPad(d.getDate())}T${_cqPad(d.getHours())}:${_cqPad(d.getMinutes())}`;
  }
}
function _cqHoje(fuso) { return _cqNowLocal(fuso).slice(0, 10); }
function _cqFmtData(s) {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return d ? `${d}/${m}/${y}` : '—';
}
function _cqFmtDH(s) {
  if (!s) return '—';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return `${_cqFmtData(s)} ${s.slice(11, 16)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return _cqFmtData(s);
  const d = new Date(s);
  if (isNaN(d)) return _cqFmtData(s);
  return `${_cqPad(d.getDate())}/${_cqPad(d.getMonth() + 1)}/${d.getFullYear()} ${_cqPad(d.getHours())}:${_cqPad(d.getMinutes())}`;
}
function _cqFmtMes(yyyymm) {
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return yyyymm ? `${nomes[Number(String(yyyymm).slice(4, 6)) - 1]}/${String(yyyymm).slice(0, 4)}` : '—';
}
function _cqNum(v, dec) { return CQEngine.fmtNum(v, dec); }
function _cqVal(id) { const el = document.getElementById(id); return el ? String(el.value ?? '').trim() : ''; }
function _cqChk(id) { return !!document.getElementById(id)?.checked; }
function _cqSet(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }

function _cqSess() {
  const s = typeof currentSession !== 'undefined' ? currentSession : null;
  return { id: s?.userId || null, nome: s?.nomeCompleto || s?.username || 'Sistema' };
}
function _cqIsAdmin() { return typeof currentSession !== 'undefined' && !!currentSession?.isAdmin; }
function _cqCan(k) {
  if (_cqIsAdmin()) return true;
  return typeof authHasPermission === 'function' && authHasPermission('cq.' + k);
}
function _cqEstacao() { try { return localStorage.getItem('cq-estacao') || ''; } catch (e) { return ''; } }
function _cqLocal() { return { unidadeId: _cqUnidadeAtivaId(), estacao: _cqEstacao() || 'não informada' }; }

// Assinatura: quem, quando e onde (RDC 978 art. 105, II)
function _cqAssinatura(extra) {
  const u = _cqSess();
  return { porId: u.id, porNome: u.nome, em: _cqAgora(), ..._cqLocal(), ...(extra || {}) };
}

// Entrada de trilha de auditoria (somente acrescentada)
function _cqTrilhaEntry(acao, texto, diffs, extras) {
  const u = _cqSess();
  return { ts: _cqAgora(), userId: u.id, userName: u.nome, ..._cqLocal(), acao, texto: texto || '', diffs: diffs || [], ...(extras || {}) };
}
function _cqTrilhaAdd(rec, acao, texto, diffs, extras) {
  rec.trilha = rec.trilha && typeof rec.trilha === 'object' && !Array.isArray(rec.trilha) ? rec.trilha : {};
  rec.trilha[_cqTk()] = _cqTrilhaEntry(acao, texto, diffs, extras);
}
function _cqTrilhaLista(rec) {
  return Object.entries(rec?.trilha || {}).sort(([a], [b]) => a.localeCompare(b)).map(([, t]) => ({ ...t, diffs: _cqArr(t.diffs) }));
}

function _cqDiff(antes, depois, labels, fmt) {
  const diffs = [];
  Object.keys(labels).forEach(k => {
    const a = antes?.[k], b = depois?.[k];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) return;
    const vazio = x => x === undefined || x === null || x === '' || (Array.isArray(x) && !x.length);
    if (vazio(a) && vazio(b)) return;
    const f = (fmt && fmt[k]) || (x => Array.isArray(x) ? x.join(', ') : (typeof x === 'object' ? JSON.stringify(x) : String(x)));
    diffs.push({ campo: labels[k], antes: vazio(a) ? '—' : f(a), depois: vazio(b) ? '—' : f(b) });
  });
  return diffs;
}

// ── SELEÇÃO MÚLTIPLA EM POPOVER ──────────────────────────────
// opcoes: [{ value, label, sub?, grupo? }]. O estado fica em _cqMulti (não no DOM),
// então _cqMultiVal funciona mesmo antes de o popover ser aberto.
const _cqMulti = {};
// `resumo` (ex.: 'analitos'): com mais de um item marcado, o botão mostra um chip só ("3 analitos") em vez de um por item
function _cqMultiHTML(id, opcoes, selecionados, { placeholder = 'Selecione…', disabled = false, onchange = null, vazio = 'Nenhuma opção.', resumo = '' } = {}) {
  _cqMulti[id] = { opcoes: opcoes || [], sel: new Set(_cqArr(selecionados)), placeholder, disabled, onchange, vazio, busca: '', resumo };
  return `<div class="cq-ms${disabled ? ' cq-ms-off' : ''}" id="${id}">
    <div class="cq-ms-btn" id="${id}-btn" tabindex="${disabled ? -1 : 0}" role="button" aria-haspopup="listbox"
      onclick="cqMultiAbrir('${id}')" onkeydown="if(event.key==='Enter'||event.key===' '||event.key==='ArrowDown'){event.preventDefault();cqMultiAbrir('${id}')}">${_cqMultiBtnHTML(id)}</div>
    <div class="cq-ms-pop" id="${id}-pop" style="display:none;" onkeydown="if(event.key==='Escape'){event.stopPropagation();cqMultiFechar('${id}',true)}">
      <div class="cq-ms-busca">${CQ_ICO.lista}<input type="text" id="${id}-busca" placeholder="Buscar…" autocomplete="off" oninput="cqMultiBuscar('${id}',this.value)"></div>
      <div class="cq-ms-acoes"><button type="button" onclick="cqMultiTodos('${id}',true)">Marcar visíveis</button><button type="button" onclick="cqMultiTodos('${id}',false)">Limpar</button></div>
      <div class="cq-ms-lista" id="${id}-lista" role="listbox" aria-multiselectable="true"></div>
    </div>
  </div>`;
}
function _cqMultiVal(id) { return [...(_cqMulti[id]?.sel || [])]; }
function _cqMultiBtnHTML(id) {
  const m = _cqMulti[id];
  if (!m) return '';
  const porValor = new Map(m.opcoes.map(o => [o.value, o]));
  const sel = [...m.sel];
  if (m.resumo && sel.length > 1) {
    const nomes = sel.map(v => porValor.get(v)?.label || _cqRotuloMulti(v)).join('\n');
    return `<div class="cq-ms-chips cq-ms-resumo"><span class="cq-ms-chip" title="${_cqEsc(nomes)}"><span class="cq-ms-chip-txt">${sel.length} ${_cqEsc(m.resumo)}</span>${m.disabled ? '' : `<button type="button" title="Limpar" onclick="event.stopPropagation();cqMultiTodos('${id}',false)">×</button>`}</span></div>
    <svg class="cq-ms-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
  }
  const chips = sel.slice(0, 6).map(v => `<span class="cq-ms-chip" title="${_cqEsc(porValor.get(v)?.label || _cqRotuloMulti(v))}"><span class="cq-ms-chip-txt">${_cqEsc(porValor.get(v)?.label || _cqRotuloMulti(v))}</span>${m.disabled ? '' : `<button type="button" title="Remover" onclick="event.stopPropagation();cqMultiDesmarcarSel('${id}',${sel.indexOf(v)})">×</button>`}</span>`).join('');
  return `<div class="cq-ms-chips">${sel.length ? chips + (sel.length > 6 ? `<span class="cq-ms-mais">+${sel.length - 6}</span>` : '') : `<span class="cq-ms-ph">${_cqEsc(m.placeholder)}</span>`}</div>
    <svg class="cq-ms-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
}
function _cqMultiListaHTML(id) {
  const m = _cqMulti[id];
  const q = (m.busca || '').toLowerCase().trim();
  const vis = m.opcoes.filter(o => !q || `${o.label} ${o.sub || ''} ${o.grupo || ''}`.toLowerCase().includes(q));
  if (!vis.length) return `<div class="cq-ms-vazio">${_cqEsc(q ? 'Nada encontrado.' : m.vazio)}</div>`;
  let grupo = null;
  return vis.map(o => {
    const idx = m.opcoes.indexOf(o);
    const cab = o.grupo !== undefined && o.grupo !== grupo ? `<div class="cq-ms-grupo">${_cqEsc((grupo = o.grupo) || 'Sem grupo')}</div>` : '';
    const on = m.sel.has(o.value);
    return `${cab}<label class="cq-ms-op${on ? ' on' : ''}" role="option" aria-selected="${on}">
      <input type="checkbox" ${on ? 'checked' : ''} onchange="cqMultiMarcarIdx('${id}',${idx},this.checked)">
      <span class="cq-ms-op-txt">${_cqEsc(o.label)}${o.sub ? `<small>${_cqEsc(o.sub)}</small>` : ''}</span></label>`;
  }).join('');
}
function _cqMultiAtualizar(id, lista = true) {
  const b = document.getElementById(id + '-btn');
  if (b) b.innerHTML = _cqMultiBtnHTML(id);
  const l = document.getElementById(id + '-lista');
  if (lista && l) l.innerHTML = _cqMultiListaHTML(id);
}
function cqMultiAbrir(id) {
  const m = _cqMulti[id];
  const pop = document.getElementById(id + '-pop');
  if (!m || m.disabled || !pop) return;
  if (pop.style.display !== 'none') { cqMultiFechar(id); return; }
  Object.keys(_cqMulti).forEach(o => { if (o !== id) cqMultiFechar(o); });
  m.busca = '';
  const busca = document.getElementById(id + '-busca');
  if (busca) busca.value = '';
  _cqMultiAtualizar(id);
  pop.style.display = '';
  document.getElementById(id)?.classList.add('aberto');
  setTimeout(() => busca?.focus(), 30);
}
function cqMultiFechar(id, foco) {
  const pop = document.getElementById(id + '-pop');
  if (!pop || pop.style.display === 'none') return;
  pop.style.display = 'none';
  document.getElementById(id)?.classList.remove('aberto');
  if (foco) document.getElementById(id + '-btn')?.focus();
}
function cqMultiBuscar(id, q) {
  if (!_cqMulti[id]) return;
  _cqMulti[id].busca = q;
  const l = document.getElementById(id + '-lista');
  if (l) l.innerHTML = _cqMultiListaHTML(id);
}
function cqMultiMarcar(id, v, on) {
  const m = _cqMulti[id];
  if (!m || m.disabled) return;
  if (on) m.sel.add(v); else m.sel.delete(v);
  _cqMultiAtualizar(id);
  if (typeof m.onchange === 'function') m.onchange(_cqMultiVal(id));
}
// Variantes por índice (os valores podem conter aspas e não vão para atributos HTML)
function cqMultiMarcarIdx(id, idx, on) { const o = _cqMulti[id]?.opcoes[idx]; if (o) cqMultiMarcar(id, o.value, on); }
function cqMultiDesmarcarSel(id, idx) { const v = _cqMultiVal(id)[idx]; if (v !== undefined) cqMultiMarcar(id, v, false); }
function _cqRotuloMulti(v) { return /^[am]:/.test(String(v)) && typeof _cqRotuloEquip === 'function' ? _cqRotuloEquip(v) : v; }
function cqMultiTodos(id, on) {
  const m = _cqMulti[id];
  if (!m || m.disabled) return;
  const q = (m.busca || '').toLowerCase().trim();
  if (on) m.opcoes.filter(o => !q || `${o.label} ${o.sub || ''} ${o.grupo || ''}`.toLowerCase().includes(q)).forEach(o => m.sel.add(o.value));
  else m.sel.clear();
  _cqMultiAtualizar(id);
  if (typeof m.onchange === 'function') m.onchange(_cqMultiVal(id));
}
// Troca as opções mantendo marcados só os que continuam disponíveis
function _cqMultiOpcoes(id, opcoes) {
  const m = _cqMulti[id];
  if (!m) return;
  m.opcoes = opcoes || [];
  const validos = new Set(m.opcoes.map(o => o.value));
  [...m.sel].forEach(v => { if (!validos.has(v)) m.sel.delete(v); });
  _cqMultiAtualizar(id);
}
document.addEventListener('mousedown', e => {
  Object.keys(_cqMulti).forEach(id => {
    const el = document.getElementById(id);
    if (el && !(e.target && typeof el.contains === 'function' && el.contains(e.target))) cqMultiFechar(id);
  });
});

// ── LISTA DE ITENS (adicionar, remover, ordenar) ─────────────
// Campo de cadastro de itens de texto: cada item numa linha, "Adicionar" (ou Enter) inclui, × remove,
// setas reordenam (`ordenavel`). `travados`: itens em uso que não podem sair. `sugestoes`: itens já
// cadastrados (ex.: na unidade) oferecidos como atalho, filtrados pelo texto digitado.
// O estado fica em _cqItens; _cqItensVal lê a lista.
const _cqItens = {};
const _cqItensChave = s => _cqNormBusca(String(s || '').trim().replace(/\s+/g, ' '));
function _cqItensHTML(id, itens, opts = {}) {
  const vistos = new Set();
  const lista = _cqArr(itens).map(x => String(x).trim()).filter(x => x && !vistos.has(_cqItensChave(x)) && vistos.add(_cqItensChave(x)));
  _cqItens[id] = { ...opts, itens: lista, travados: new Set(_cqArr(opts.travados).map(_cqItensChave)), sugestoes: _cqArr(opts.sugestoes) };
  const m = _cqItens[id];
  return `<div class="cq-itens${m.disabled ? ' cq-itens-off' : ''}" id="${id}">
    <div class="cq-itens-lista" id="${id}-lista">${_cqItensListaHTML(id)}</div>
    ${m.disabled ? '' : `<div class="cq-itens-add">
      <input type="text" class="field-input" id="${id}-in" maxlength="${m.max || 80}" placeholder="${_cqEsc(m.placeholder || 'Novo item')}" autocomplete="off"
        oninput="_cqItensSugAtualizar('${id}')" onkeydown="if(event.key==='Enter'){event.preventDefault();cqItensAdicionar('${id}')}">
      <button type="button" class="btn btn-primary btn-sm" onclick="cqItensAdicionar('${id}')">${CQ_ICO.plus} Adicionar</button></div>
    <div class="cq-itens-sug" id="${id}-sug">${_cqItensSugHTML(id)}</div>`}
  </div>`;
}
function _cqItensVal(id) { return [...(_cqItens[id]?.itens || [])]; }
function _cqItensListaHTML(id) {
  const m = _cqItens[id];
  if (!m.itens.length) return `<div class="cq-itens-vazio">${_cqEsc(m.vazio || 'Nenhum item adicionado.')}</div>`;
  const seta = pts => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="${pts}"/></svg>`;
  return m.itens.map((v, i) => {
    const trav = m.travados.has(_cqItensChave(v));
    return `<div class="cq-item${trav ? ' travado' : ''}">
      ${m.ordenavel ? `<span class="cq-item-n">${i + 1}</span>` : '<span class="cq-item-dot"></span>'}
      <span class="cq-item-txt">${_cqEsc(v)}</span>
      ${trav ? `<span class="cq-item-lock" title="${_cqEsc(m.travadoMotivo || 'Em uso')}">${CQ_ICO.lock}</span>` : ''}
      ${m.disabled ? '' : `<span class="cq-item-acoes">
        ${m.ordenavel ? `<button type="button" class="cq-icobtn" title="Subir" ${i ? '' : 'disabled'} onclick="cqItensMover('${id}',${i},-1)">${seta('18 15 12 9 6 15')}</button>
          <button type="button" class="cq-icobtn" title="Descer" ${i < m.itens.length - 1 ? '' : 'disabled'} onclick="cqItensMover('${id}',${i},1)">${seta('6 9 12 15 18 9')}</button>` : ''}
        <button type="button" class="cq-icobtn cq-item-rem" title="${trav ? _cqEsc(m.travadoMotivo || 'Em uso') + ' — não pode ser removido' : 'Remover'}" ${trav ? 'disabled' : ''} onclick="cqItensRemover('${id}',${i})">${CQ_ICO.close}</button></span>`}
    </div>`;
  }).join('');
}
function _cqItensSugHTML(id) {
  const m = _cqItens[id];
  if (!m.sugestoes.length) return '';
  const ja = new Set(m.itens.map(_cqItensChave));
  const q = _cqItensChave(document.getElementById(id + '-in')?.value || '');
  const livres = m.sugestoes.filter(s => !ja.has(_cqItensChave(s)));
  const lista = livres.filter(s => !q || _cqItensChave(s).includes(q));
  if (!livres.length) return '';
  return `<div class="cq-itens-sug-tit">${_cqEsc(m.sugestoesRotulo || 'Já cadastrados')}</div>
    <div class="cq-itens-chips">${lista.slice(0, 24).map(s => `<button type="button" class="cq-itens-chip" title="Adicionar" onclick="cqItensAdicionarSug('${id}',${m.sugestoes.indexOf(s)})">${CQ_ICO.plus}<span>${_cqEsc(s)}</span></button>`).join('')
      || '<span class="cq-muted">Nenhum já cadastrado corresponde ao texto digitado.</span>'}${lista.length > 24 ? `<span class="cq-muted">+${lista.length - 24} — digite para filtrar</span>` : ''}</div>`;
}
function _cqItensAtualizar(id) {
  const l = document.getElementById(id + '-lista');
  if (l) l.innerHTML = _cqItensListaHTML(id);
  _cqItensSugAtualizar(id);
  if (typeof _cqItens[id]?.onchange === 'function') _cqItens[id].onchange(_cqItensVal(id));
}
function _cqItensSugAtualizar(id) {
  const s = document.getElementById(id + '-sug');
  if (s && _cqItens[id]) s.innerHTML = _cqItensSugHTML(id);
}
function cqItensAdicionar(id, valor) {
  const m = _cqItens[id];
  if (!m || m.disabled) return;
  const inp = document.getElementById(id + '-in');
  const v = String(valor ?? inp?.value ?? '').trim().replace(/\s+/g, ' ');
  if (!v) { inp?.focus(); return; }
  if (m.itens.some(x => _cqItensChave(x) === _cqItensChave(v))) { showToast(`“${v}” já está na lista.`, 'error'); inp?.select(); return; }
  m.itens.push(v);
  if (inp) inp.value = '';
  _cqItensAtualizar(id);
  inp?.focus();
}
function cqItensAdicionarSug(id, idx) { const s = _cqItens[id]?.sugestoes[idx]; if (s !== undefined) cqItensAdicionar(id, s); }
function cqItensRemover(id, idx) {
  const m = _cqItens[id];
  if (!m || m.disabled || m.travados.has(_cqItensChave(m.itens[idx]))) return;
  m.itens.splice(idx, 1);
  _cqItensAtualizar(id);
}
function cqItensMover(id, idx, d) {
  const m = _cqItens[id];
  const j = idx + d;
  if (!m || m.disabled || j < 0 || j >= m.itens.length) return;
  [m.itens[idx], m.itens[j]] = [m.itens[j], m.itens[idx]];
  _cqItensAtualizar(id);
}

// ── SELEÇÃO ÚNICA EM POPOVER (com busca) ─────────────────────
// opcoes: [{ value, label, sub?, grupo?, extra? }]. Estado em _cqSel; valor lido por _cqSelVal.
const _cqSel = {};
function _cqSelHTML(id, opcoes, valor, { placeholder = 'Selecione…', disabled = false, onchange = null, vazio = 'Nenhuma opção.', busca = 'Buscar…' } = {}) {
  _cqSel[id] = { opcoes: opcoes || [], valor: valor ?? '', placeholder, disabled, onchange, vazio, buscaPh: busca, q: '', ativo: 0, vis: [] };
  return `<div class="cq-ms cq-pick cq-sel${disabled ? ' cq-ms-off' : ''}" id="${id}">
    <div class="cq-ms-btn" id="${id}-btn" tabindex="${disabled ? -1 : 0}" role="button" aria-haspopup="listbox"
      onclick="cqSelAbrir('${id}')" onkeydown="cqSelTeclaBtn(event,'${id}')">${_cqSelBtnHTML(id)}</div>
    <div class="cq-ms-pop" id="${id}-pop" style="display:none;" onkeydown="cqSelTecla(event,'${id}')">
      <div class="cq-ms-busca">${CQ_ICO.busca}<input type="text" id="${id}-busca" placeholder="${_cqEsc(busca)}" autocomplete="off" oninput="cqSelBuscar('${id}',this.value)"></div>
      <div class="cq-ms-lista cq-pick-lista" id="${id}-lista" role="listbox"></div>
    </div>
  </div>`;
}
function _cqSelVal(id) { return _cqSel[id]?.valor ?? ''; }
function _cqSelBtnHTML(id) {
  const m = _cqSel[id];
  const o = m.opcoes.find(x => x.value === m.valor);
  const txt = o ? `<span class="cq-sel-txt"><b>${_cqEsc(o.label)}</b>${o.sub ? `<small>${_cqEsc(o.sub)}</small>` : ''}</span>`
    : `<span class="cq-ms-ph">${_cqEsc(m.valor || m.placeholder)}</span>`;
  return `${txt}<svg class="cq-ms-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
}
function _cqSelListaHTML(id) {
  const m = _cqSel[id];
  const termos = _cqNormBusca(m.q).split(/\s+/).filter(Boolean);
  m.vis = m.opcoes.filter(o => { const t = _cqNormBusca(`${o.label} ${o.sub || ''} ${o.grupo || ''}`); return termos.every(x => t.includes(x)); });
  if (m.ativo >= m.vis.length) m.ativo = Math.max(0, m.vis.length - 1);
  if (!m.vis.length) return `<div class="cq-ms-vazio">${_cqEsc(termos.length ? 'Nada encontrado.' : m.vazio)}</div>`;
  let grupo;
  return m.vis.map((o, i) => {
    const cab = o.grupo !== undefined && o.grupo !== grupo ? `<div class="cq-ms-grupo">${_cqEsc((grupo = o.grupo) || '')}</div>` : '';
    return `${cab}<div class="cq-ms-op cq-pick-op${i === m.ativo ? ' ativo' : ''}${o.value === m.valor ? ' on' : ''}" role="option" aria-selected="${o.value === m.valor}" data-i="${i}"
      onmousedown="event.preventDefault()" onclick="cqSelEscolher('${id}',${i})" onmousemove="cqSelHover('${id}',${i})">
      <span class="cq-ms-op-txt"><span>${_cqEsc(o.label)}</span>${o.sub ? `<small>${_cqEsc(o.sub)}</small>` : ''}</span>
      ${o.extra ? `<span class="cq-pick-ult">${_cqEsc(o.extra)}</span>` : ''}</div>`;
  }).join('');
}
function _cqNormBusca(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function cqSelAbrir(id, texto) {
  const m = _cqSel[id], pop = document.getElementById(id + '-pop');
  if (!m || m.disabled || !pop) return;
  if (pop.style.display !== 'none' && texto === undefined) { cqSelFechar(id); return; }
  Object.keys(_cqSel).forEach(o => { if (o !== id) cqSelFechar(o); });
  m.q = texto || '';
  m.ativo = Math.max(0, m.opcoes.findIndex(o => o.value === m.valor));
  const inp = document.getElementById(id + '-busca');
  if (inp) inp.value = m.q;
  document.getElementById(id + '-lista').innerHTML = _cqSelListaHTML(id);
  pop.style.display = '';
  document.getElementById(id)?.classList.add('aberto');
  setTimeout(() => { inp?.focus(); document.querySelector(`#${id}-lista .cq-pick-op.ativo`)?.scrollIntoView({ block: 'nearest' }); }, 20);
}
function cqSelFechar(id, foco) {
  const pop = document.getElementById(id + '-pop');
  if (!pop || pop.style.display === 'none') return;
  pop.style.display = 'none';
  document.getElementById(id)?.classList.remove('aberto');
  if (foco) document.getElementById(id + '-btn')?.focus();
}
function cqSelBuscar(id, q) { const m = _cqSel[id]; if (!m) return; m.q = q; m.ativo = 0; document.getElementById(id + '-lista').innerHTML = _cqSelListaHTML(id); }
function cqSelHover(id, i) {
  const m = _cqSel[id];
  if (!m || m.ativo === i) return;
  m.ativo = i;
  document.querySelectorAll(`#${id}-lista .cq-pick-op`).forEach(el => el.classList.toggle('ativo', Number(el.dataset.i) === i));
}
function cqSelEscolher(id, i) {
  const m = _cqSel[id], o = m?.vis[i];
  if (!o) return;
  m.valor = o.value;
  const b = document.getElementById(id + '-btn');
  if (b) b.innerHTML = _cqSelBtnHTML(id);
  cqSelFechar(id, true);
  if (typeof m.onchange === 'function') m.onchange(o.value);
}
function cqSelTeclaBtn(e, id) {
  if (['Enter', ' ', 'ArrowDown'].includes(e.key)) { e.preventDefault(); cqSelAbrir(id); return; }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); cqSelAbrir(id, e.key); }
}
function cqSelTecla(e, id) {
  const m = _cqSel[id], n = m?.vis.length || 0;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cqSelFechar(id, true); return; }
  if (e.key === 'Enter') { e.preventDefault(); cqSelEscolher(id, m.ativo); return; }
  if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || !n) return;
  e.preventDefault();
  cqSelHover(id, (m.ativo + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
  document.querySelector(`#${id}-lista .cq-pick-op[data-i="${m.ativo}"]`)?.scrollIntoView({ block: 'nearest' });
}
document.addEventListener('mousedown', e => {
  Object.keys(_cqSel).forEach(id => { const el = document.getElementById(id); if (el && !el.contains(e.target)) cqSelFechar(id); });
});

// Equipamentos (ativos) disponíveis para o CQ: setores das unidades (todos quando nenhuma unidade define setores)
function _cqAtivosCQ() {
  const ativos = (typeof state !== 'undefined' && Array.isArray(state?.ativos)) ? state.ativos.filter(a => a && a.statusUso !== 'em_desuso') : [];
  const setores = new Set(Object.values(cqState.config.unidades).filter(u => u.ativa !== false).flatMap(u => _cqArr(u.setores)));
  return ativos.filter(a => !setores.size || setores.has(a.setor))
    .sort((a, b) => (a.setor || '').localeCompare(b.setor || '') || (a.nome || '').localeCompare(b.nome || ''));
}
function _cqOpcoesAtivos(extraIds) {
  const lista = _cqAtivosCQ();
  _cqArr(extraIds).forEach(id => {
    if (lista.some(a => a.id === id)) return;
    const a = typeof _ativoById === 'function' ? _ativoById(id) : null;
    lista.push(a || { id, nome: 'Equipamento removido', setor: '' });
  });
  return lista.map(a => ({ value: a.id, label: a.nome || a.id, sub: [a.codigo, a.modelo].filter(Boolean).join(' · '), grupo: a.setor || '' }));
}
function _cqNomeAtivo(id) {
  const a = typeof _ativoById === 'function' ? _ativoById(id) : null;
  return a?.nome || 'Equipamento removido';
}

function _cqOptions(lista, atual, vazio = '— Selecione —') {
  const itens = [...lista];
  if (atual && !itens.includes(atual)) itens.unshift(atual);
  return (vazio !== null ? `<option value="">${vazio}</option>` : '') +
    itens.map(v => `<option value="${_cqEsc(v)}" ${v === atual ? 'selected' : ''}>${_cqEsc(v)}</option>`).join('');
}
function _cqMapOptions(map, atual, vazio = '— Selecione —') {
  return (vazio !== null ? `<option value="">${vazio}</option>` : '') +
    Object.entries(map).map(([k, v]) => `<option value="${_cqEsc(k)}" ${k === atual ? 'selected' : ''}>${_cqEsc(typeof v === 'string' ? v : v.label)}</option>`).join('');
}
function _cqBadge(map, k, extra) {
  const c = map[k] || {};
  return `<span class="cq-badge ${c.cls || ''}">${_cqEsc(c.label || k || '—')}${extra || ''}</span>`;
}

function _cqUsuarios() {
  const users = typeof authState !== 'undefined' ? (authState.users || []) : [];
  return users.filter(u => u.ativo !== false).sort((a, b) => (a.nomeCompleto || '').localeCompare(b.nomeCompleto || ''));
}
function _cqNomeUsuario(id) {
  const u = (typeof authState !== 'undefined' ? authState.users || [] : []).find(x => x.id === id);
  return u ? (u.nomeCompleto || u.username) : '';
}

// Grava um registro de cadastro inteiro (com trilha) em seu próprio nó
async function _cqSalvarRegistro(colecao, rec) {
  rec.atualizadoEm = _cqAgora();
  const ok = await window.dbUpdate({ [`${CQ_KEYS.config}/${colecao}/${rec.id}`]: rec });
  if (!ok) { showToast('Falha ao gravar. Verifique a conexão e tente novamente.', 'error'); return false; }
  cqState.config[colecao][rec.id] = rec;
  if (colecao === 'insumos' || colecao === 'insumoProdutos') _cqHidratarInsumos();
  return true;
}

// Marca um cadastro como usado em lançamento (bloqueia a exclusão dele)
function _cqMarcarUso(updates, colecao, id) {
  if (id) updates[`${CQ_KEYS.uso}/${colecao}/${id}`] = true;
}

async function _cqProximoNumero(u, tipo) {
  const un = cqState.config.unidades[u];
  const ano = _cqHoje(un?.fuso).slice(0, 4);
  const n = await window.dbTransaction(`${CQ_KEYS.seq}/${u}/${tipo}/${ano}`, v => (Number(v) || 0) + 1);
  if (!n) return null;
  const sig = (un?.sigla || 'UN').toUpperCase();
  return tipo === 'nc' ? `NC-${sig}-${ano}-${String(n).padStart(3, '0')}` : `${sig}-${ano}-${String(n).padStart(6, '0')}`;
}

// Bloqueios gerais para gravações do CQ
function _cqPodeGravar() {
  if (window._dbConnected === false) { showToast('Sem conexão com o banco: lançamentos do CQ ficam bloqueados até a conexão voltar.', 'error'); return false; }
  if (Math.abs(window._dbClockSkewMs || 0) > 5 * 60 * 1000) {
    showToast('O relógio deste computador está desajustado em mais de 5 minutos. Corrija a data/hora do sistema antes de lançar.', 'error');
    return false;
  }
  return true;
}

// ── UNIDADES ─────────────────────────────────────────────────
function _cqUnidadesVisiveis() {
  const me = _cqSess().id;
  return Object.values(cqState.config.unidades)
    .filter(u => u.ativa !== false || _cqIsAdmin())
    .filter(u => _cqIsAdmin() || !!(u.membros && me && u.membros[me]))
    .sort((a, b) => (a.sigla || '').localeCompare(b.sigla || ''));
}
function _cqUnidadeAtivaId() {
  let id = null;
  try { id = localStorage.getItem('cq-unidade-ativa'); } catch (e) { /* sem storage */ }
  const vis = _cqUnidadesVisiveis();
  if (id && vis.some(u => u.id === id)) return id;
  return vis[0]?.id || null;
}
function _cqUnidade() { const id = _cqUnidadeAtivaId(); return id ? cqState.config.unidades[id] : null; }
function _cqGarantirUnidadeAtiva() {
  const id = _cqUnidadeAtivaId();
  try { if (id) localStorage.setItem('cq-unidade-ativa', id); } catch (e) { /* sem storage */ }
}
function cqSetUnidade(id) {
  try { localStorage.setItem('cq-unidade-ativa', id); } catch (e) { /* sem storage */ }
  _cqOuvirAlvos();
  if (typeof _cqLancReset === 'function') _cqLancReset();
  cqRender();
}
function _cqPapel(u, userId) { return cqState.config.unidades[u]?.membros?.[userId || _cqSess().id] || null; }
function _cqPolitica(u) {
  return Object.assign({ liberarAceitosAoSalvar: true, comentarioObrigatorioAlerta: true, reautenticar: true, retroativoHoras: 24 },
    cqState.config.unidades[u || _cqUnidadeAtivaId()]?.politica || {});
}
// Modo de lançamento de corridas: 'lote' (grade com todos os testes do equipamento) ou
// 'fracionada' (o operador adiciona os testes realizados, um a um). Padrão da unidade + exceção por equipamento.
const CQ_MODOS_CORRIDA = { lote: 'Em lote (todos os testes do equipamento)', fracionada: 'Fracionada (adicionar teste a teste)' };
function _cqChaveModoEquip(grupoKey) { return encodeURIComponent(grupoKey || '').replace(/\./g, '%2E'); }
function _cqModoCorrida(u, grupoKey) {
  const pol = _cqPolitica(u);
  const m = (grupoKey && pol.modoCorridaEquip?.[_cqChaveModoEquip(grupoKey)]) || pol.modoCorrida;
  return CQ_MODOS_CORRIDA[m] ? m : 'lote';
}

// ── CONSULTAS DE CADASTRO ────────────────────────────────────
function _cqTestesDaUnidade(u, { incluirInativos = false } = {}) {
  return Object.values(cqState.config.testes).filter(t => t.unidadeId === u && (incluirInativos || t.ativo !== false));
}
function _cqAnalito(id) { return cqState.config.analitos[id] || null; }
function _cqNomeTeste(t) {
  const a = _cqAnalito(t?.analitoId);
  if (!a) return t?.analitoNome || 'Analito removido';
  // Qualitativos (ex.: microbiologia) distinguem o meio/insumo controlado pelo campo método
  return _cqTesteQual(t) && t.metodo ? `${a.nome} · ${t.metodo}` : a.nome;
}
// Teste qualitativo ou semiquantitativo (resultado por categoria, sem média/DP)
function _cqTesteQual(t) { const a = _cqAnalito(t?.analitoId); return !!a && a.tipo !== undefined && a.tipo !== 'quantitativo'; }
function _cqControleQual(t, n) { return t?.controlesQual?.[n] || null; }
function _cqRotuloNivel(t, n) {
  const c = _cqControleQual(t, n);
  return _cqTesteQual(t) && c?.rotulo ? c.rotulo : `Nível ${n}`;
}
// Nível do lote de controle usado pelo nível n do teste (em qualitativos cada nível pode vir de um material diferente)
function _cqNivelNoLote(t, n) {
  if (!_cqTesteQual(t)) return Number(n);
  const lote = _cqLoteDoNivel(t, n);
  const c = _cqControleQual(t, n);
  return Number(c?.nivelLote) || Number(_cqArr(lote?.niveis)[0]) || 1;
}
function _cqValidadeLoteTeste(t, n, u, hoje) {
  const lote = _cqLoteDoNivel(t, n);
  return lote ? _cqValidadeLote(lote, _cqNivelNoLote(t, n), u, hoje) : null;
}
// Nível qualitativo sem material (ex.: placa não inoculada no teste de esterilidade)
function _cqNivelSemMaterial(t, n) { return _cqTesteQual(t) && !_cqControleQual(t, n)?.materialId; }
function _cqEquipTeste(t) {
  if (!t) return '—';
  if (!t.ativoId) return t.sistemaAnalitico || 'Bancada / manual';
  const a = typeof _ativoById === 'function' ? _ativoById(t.ativoId) : null;
  return (a?.nome) || t.ativoSnap?.nome || 'Equipamento removido';
}
function _cqGrupoEquip(t) { return t.ativoId ? 'a:' + t.ativoId : 'm:' + (t.sistemaAnalitico || 'Bancada / manual'); }
function _cqNiveisTeste(t) { return _cqArr(t?.niveis).map(Number).filter(n => n > 0).sort((a, b) => a - b); }
function _cqLoteDoNivel(t, nivel) { return t?.lotesAtivos?.[nivel] ? cqState.config.lotesControle[t.lotesAtivos[nivel]] || null : null; }

// ── CADASTROS POR UNIDADE ────────────────────────────────────
// Analitos, materiais, lotes de controle e insumos pertencem a uma ou mais unidades (`unidadeIds`).
// Registro anterior a esta regra (sem unidadeIds) aparece em todas até ser associado.
const CQ_COLECOES_UNIDADE = ['analitos', 'materiais', 'lotesControle', 'insumoProdutos', 'insumos'];
function _cqUnidadesRec(r) { return _cqArr(r?.unidadeIds); }
function _cqSemUnidade(r) { return !!r && !_cqUnidadesRec(r).length; }
function _cqNaUnidade(r, u) { const us = _cqUnidadesRec(r); return !us.length || us.includes(u || _cqUnidadeAtivaId()); }
function _cqDaUnidade(colecao, u) { return Object.values(cqState.config[colecao] || {}).filter(r => _cqNaUnidade(r, u)); }
function _cqSiglasUnidades(ids) { return _cqArr(ids).map(id => cqState.config.unidades[id]?.sigla || '?').join(', '); }
// Selo da lista: sem unidade (pendente) ou as siglas quando o cadastro é compartilhado
function _cqUnidadesTag(r) {
  if (_cqSemUnidade(r)) return ' <span class="cq-badge cq-st-alerta" title="Cadastro sem unidade: aparece em todas. Associe-o às unidades que o usam.">sem unidade</span>';
  const us = _cqUnidadesRec(r);
  return us.length > 1 ? ` <span class="cq-badge cq-st-semalvo" title="Compartilhado entre unidades">${_cqEsc(_cqSiglasUnidades(us))}</span>` : '';
}
// Unidades em que testes usam o cadastro (não pode ser desassociado delas)
function _cqUnidadesEmUso(colecao, id) {
  const us = new Set();
  Object.values(cqState.config.testes).forEach(t => {
    const usa = colecao === 'analitos' ? t.analitoId === id
      : colecao === 'materiais' ? (t.materialId === id || Object.values(t.controlesQual || {}).some(c => c?.materialId === id))
      : colecao === 'lotesControle' ? Object.values(t.lotesAtivos || {}).includes(id)
      : colecao === 'insumoProdutos' ? t.insumoProdutoId === id
      : false;
    if (usa) us.add(t.unidadeId);
  });
  if (colecao === 'insumos') Object.entries(cqState.indices || {}).forEach(([u, idx]) => {
    if (Object.values(idx?.ultimo || {}).some(x => x?.lr === id || x?.lk === id)) us.add(u);
  });
  return us;
}
// Campo de unidades dos formulários de cadastro (novo: unidade ativa marcada)
function _cqUnidadesCampoHTML(idCampo, rec, pode, nota, colecao) {
  // Cadastro antigo sem unidade: sugere as unidades em que é usado + a ativa
  const sel = !rec ? [_cqUnidadeAtivaId()].filter(Boolean)
    : _cqSemUnidade(rec) ? [...new Set([...(colecao ? _cqUnidadesEmUso(colecao, rec.id) : []), _cqUnidadeAtivaId()])].filter(Boolean)
    : _cqUnidadesRec(rec);
  const ops = Object.values(cqState.config.unidades).filter(u => u.ativa !== false || sel.includes(u.id))
    .sort((a, b) => (a.sigla || '').localeCompare(b.sigla || ''))
    .map(u => ({ value: u.id, label: `${u.sigla} — ${u.nome}` }));
  return `<div class="form-field"><label class="field-label">Unidades <span class="required">*</span></label>
    ${_cqMultiHTML(idCampo, ops, sel, { placeholder: 'Selecione as unidades que usam este cadastro', disabled: !pode, vazio: 'Nenhuma unidade cadastrada.' })}
    ${rec && _cqSemUnidade(rec) ? '<div class="cq-nota cq-txt-amarelo">Cadastro antigo sem unidade: hoje aparece em todas. Confira as unidades sugeridas e salve.</div>' : ''}
    <div class="cq-nota">${nota || 'Só aparece nas listas e nos testes das unidades selecionadas.'}</div></div>`;
}
// Lê e valida o campo; não deixa remover unidade em que testes usam o cadastro
function _cqUnidadesCapturar(idCampo, colecao, antes) {
  const sel = _cqMultiVal(idCampo);
  if (!sel.length) { showToast('Selecione ao menos uma unidade.', 'error'); return null; }
  if (antes) {
    const fora = [..._cqUnidadesEmUso(colecao, antes.id)].filter(u => !sel.includes(u));
    if (fora.length) { showToast(`Em uso por testes da(s) unidade(s) ${_cqSiglasUnidades(fora)}: mantenha-a(s) selecionada(s).`, 'error'); return null; }
  }
  return sel;
}
// Cadastro duplicado que existe só em outras unidades: oferece associá-lo à unidade ativa
function _cqOferecerAssociar(colecao, rec, rotulo) {
  const u = _cqUnidadeAtivaId();
  if (!rec || _cqNaUnidade(rec, u)) return false;
  const un = cqState.config.unidades[u];
  _cqPrompt({
    titulo: 'Cadastro já existe', subtitulo: rotulo,
    corpo: `<div class="cq-nota">${_cqEsc(rotulo)} já está cadastrado na(s) unidade(s) <b>${_cqEsc(_cqSiglasUnidades(_cqUnidadesRec(rec)))}</b>. Para usá-lo também em <b>${_cqEsc(un?.sigla || '')}</b>, associe o cadastro existente a esta unidade (não cria duplicata).</div>`,
    confirmar: `Associar a ${un?.sigla || 'esta unidade'}`,
    onConfirm: async () => {
      const unidadeIds = [..._cqUnidadesRec(rec), u];
      const p = `${CQ_KEYS.config}/${colecao}/${rec.id}`;
      const ok = await window.dbUpdate({ [`${p}/unidadeIds`]: unidadeIds, [`${p}/atualizadoEm`]: _cqAgora(),
        [`${p}/trilha/${_cqTk()}`]: _cqTrilhaEntry('edicao', `Associado à unidade ${un?.sigla || u}`) });
      if (!ok) { showToast('Falha ao gravar. Verifique a conexão.', 'error'); return false; }
      cqState.config[colecao][rec.id] = { ..._cqLoteCru(rec), unidadeIds };
      _cqHidratarInsumos();
      showToast(`Cadastro associado a ${un?.sigla || 'esta unidade'}.`, 'success');
      cqDrawerClose();
      cqRender();
      return true;
    },
  });
  return true;
}

// Alvo vigente para (teste, lote, nível) num instante (dataHora local)
function _cqAlvoVigente(testeId, loteId, nivel, dataHora) {
  const mapa = cqState.alvos[testeId] || {};
  const lim = dataHora || '9999-12-31T23:59';
  return Object.values(mapa)
    .filter(a => a.loteControleId === loteId && Number(a.nivel) === Number(nivel) && (a.vigenteDesde || '') <= lim && !a.revogado)
    .sort((a, b) => (b.vigenteDesde || '').localeCompare(a.vigenteDesde || '') || (b.criadoEm || '').localeCompare(a.criadoEm || ''))[0] || null;
}

// Validade do lote de controle. Recebimento e abertura de frascos são controlados no sistema
// de estoque; aqui vale a validade do lote. Parâmetros mantidos por compatibilidade.
function _cqValidadeLote(lote, nivel, u, hoje) {
  if (!lote) return null;
  void nivel; void u;
  return CQEngine.validadeEfetiva({ validade: lote.validade }, hoje || _cqHoje());
}

// ── RESULTADOS: CARGA SOB DEMANDA COM CACHE ──────────────────
const _cqResCache = new Map();   // `${u}|${mes}|${t}` → { resKey: resultado expandido }
const _cqResPend  = new Map();

async function cqCarregarResultados(u, mes, t, { forcar = false } = {}) {
  const k = `${u}|${mes}|${t}`;
  if (!forcar && _cqResCache.has(k)) return _cqResCache.get(k);
  if (!forcar && _cqResPend.has(k)) return _cqResPend.get(k);
  const p = window.dbLoad(`${CQ_KEYS.resultados}/${u}/${mes}/${t}`).then(raw => {
    const out = {};
    Object.entries(raw || {}).forEach(([rk, r]) => { if (r && typeof r === 'object') out[rk] = CQEngine.expandirResultado(r, rk); });
    _cqResCache.set(k, out);
    _cqResPend.delete(k);
    return out;
  });
  _cqResPend.set(k, p);
  return p;
}
function _cqResCacheSet(u, mes, t, resKey, expandido) {
  const k = `${u}|${mes}|${t}`;
  if (!_cqResCache.has(k)) return;
  _cqResCache.get(k)[resKey] = expandido;
}
function _cqResCacheInvalidar(u, mes, t) { _cqResCache.delete(`${u}|${mes}|${t}`); }

// Após gravações em lote (importação, exemplo): descarta tudo que as telas guardam em memória
function _cqInvalidarCaches() {
  _cqResCache.clear();
  if (typeof _cqCorrCache !== 'undefined') _cqCorrCache = null;
  if (typeof _cqGraf !== 'undefined') _cqGraf.dados = null;
  if (typeof _cqNcCache !== 'undefined') _cqNcCache = null;
}

// Resultados de um teste num intervalo de meses (lista, em ordem cronológica)
async function cqResultadosPeriodo(u, t, mesDe, mesAte, opts) {
  const meses = CQEngine.mesesEntre(mesDe, mesAte);
  const lotes = await Promise.all(meses.map(m => cqCarregarResultados(u, m, t, opts)));
  return lotes.flatMap(o => Object.values(o)).sort((a, b) => (a.corridaKey || '').localeCompare(b.corridaKey || '') || a.nivel - b.nivel);
}

// Histórico para avaliação das regras (corridas anteriores a `antesDe`)
async function cqHistoricoTeste(u, teste, antesDe, { forcar = false } = {}) {
  const jan = CQEngine.janelaMax(teste.regras || {});
  const mesAtual = CQEngine.mesDe(antesDe);
  let meses = 2, lista = [];
  for (;;) {
    const ms = CQEngine.mesesAnteriores(mesAtual, meses);
    const lotes = await Promise.all(ms.map(m => cqCarregarResultados(u, m, teste.id, { forcar })));
    lista = lotes.flatMap(o => Object.values(o));
    const hist = CQEngine.prepararHistorico(lista, { antesDe, reinicio: teste.reinicioHistorico || null, janelaMax: jan,
      incluirRejeitados: !!teste.opcoesRegras?.incluirRejeitados });
    const corridas = new Set(hist.map(h => h.chave)).size;
    const inicio = teste.inicioUso ? CQEngine.mesDe(teste.inicioUso) : null;
    const maisAntigo = ms[ms.length - 1];
    if (corridas >= jan || meses >= 6 || (inicio && maisAntigo <= inicio)) return hist;
    meses += 2;
  }
}

async function cqCarregarCorridasMes(u, mes) {
  const raw = await window.dbLoad(`${CQ_KEYS.corridas}/${u}/${mes}`);
  const out = {};
  Object.entries(raw || {}).forEach(([k, c]) => { if (c && typeof c === 'object') out[k] = { ...c, key: k, mes }; });
  return out;
}
async function cqCarregarCorrida(u, mes, key) {
  const c = await window.dbLoad(`${CQ_KEYS.corridas}/${u}/${mes}/${key}`);
  return c ? { ...c, key, mes } : null;
}

// ── ABA PRINCIPAL ────────────────────────────────────────────
function _cqTabAtiva() { return !!document.getElementById('tab-cq')?.classList.contains('active'); }

function _cqHookTab() {
  const tabEl = document.getElementById('tab-cq');
  if (!tabEl) return;
  const obs = new MutationObserver(() => { if (tabEl.classList.contains('active')) _cqInitTab(); });
  obs.observe(tabEl, { attributes: true, attributeFilter: ['class'] });
  if (tabEl.classList.contains('active')) _cqInitTab();
}

function _cqInitTab() {
  const tabEl = document.getElementById('tab-cq');
  if (!tabEl) return;
  if (tabEl.dataset.cqInit !== '1') {
    tabEl.dataset.cqInit = '1';
    tabEl.innerHTML = _cqBuildTabHTML();
  }
  cqRender();
}

const CQ_SUBS = {
  painel:    { label: 'Painel',               ico: 'painel' },
  lancar:    { label: 'Lançar corrida',       ico: 'lancar' },
  corridas:  { label: 'Corridas e liberação', ico: 'lista' },
  graficos:  { label: 'Gráficos e histórico', ico: 'grafico' },
  ncs:       { label: 'Não conformidades',    ico: 'alerta' },
  cadastros: { label: 'Cadastros',            ico: 'cadastro' },
};

function _cqBuildTabHTML() {
  return `
<div class="cq-wrap">
  <aside class="rotina-left-nav cq-left-nav">
    <div class="rotina-nav-label">Controle de Qualidade</div>
    ${Object.entries(CQ_SUBS).map(([k, s]) => `<div class="rotina-nav-item${k === _cqSub ? ' active' : ''}" id="cqnav-${k}" onclick="cqNav('${k}')">${CQ_ICO[s.ico]}${s.label}<span class="cq-subnav-badge" id="cqnav-badge-${k}" style="display:none;"></span></div>`).join('')}
  </aside>
  <div class="cq-content">
    <div class="cq-topbar" id="cq-topbar"></div>
    <div class="cq-body" id="cq-body"></div>
  </div>
</div>`;
}

function cqNav(sub) {
  if (!CQ_SUBS[sub]) return;
  _cqSub = sub;
  document.querySelectorAll('#tab-cq .cq-left-nav .rotina-nav-item').forEach(el => el.classList.toggle('active', el.id === 'cqnav-' + sub));
  cqRender();
}

function cqRender() {
  _cqUpdateNavBadge();
  const body = document.getElementById('cq-body');
  if (!body || !_cqTabAtiva()) return;
  _cqRenderTopbar();
  if (!_cqConfigReady) { body.innerHTML = `<div class="cq-vazio">Carregando…</div>`; return; }
  const un = _cqUnidade();
  if (!un) {
    body.innerHTML = `<div class="cq-vazio cq-vazio-grande">${CQ_ICO.unidade}
      <h3>Nenhuma unidade de CQ disponível</h3>
      <p>${Object.keys(cqState.config.unidades).length
        ? 'Você não está vinculado a nenhuma unidade. Peça ao responsável pelo CQ para incluí-lo como membro de uma unidade.'
        : 'Cadastre a primeira unidade em Configurações › Controle de Qualidade.'}</p>
      ${_cqCan('configurar') ? `<button class="btn btn-primary" onclick="switchTab('config');setTimeout(()=>switchConfigTab('cq'),50)">${CQ_ICO.plus} Configurar unidades</button>` : ''}
    </div>`;
    return;
  }
  const fn = {
    painel: _cqRenderPainel,
    lancar: typeof cqRenderLancar === 'function' ? cqRenderLancar : null,
    corridas: typeof cqRenderCorridas === 'function' ? cqRenderCorridas : null,
    graficos: typeof cqRenderGraficos === 'function' ? cqRenderGraficos : null,
    ncs: typeof cqRenderNCs === 'function' ? cqRenderNCs : null,
    cadastros: typeof cqRenderCadastros === 'function' ? cqRenderCadastros : null,
  }[_cqSub];
  if (fn) fn(body); else body.innerHTML = '<div class="cq-vazio">Em construção.</div>';
}

function _cqRenderTopbar() {
  const el = document.getElementById('cq-topbar');
  if (!el) return;
  const vis = _cqUnidadesVisiveis();
  const u = _cqUnidadeAtivaId();
  const est = _cqEstacao();
  el.innerHTML = `
    <div class="cq-topbar-unidade">
      ${CQ_ICO.unidade}
      <span class="cq-topbar-lbl">Unidade</span>
      ${vis.length ? `<select class="field-select cq-unidade-select" onchange="cqSetUnidade(this.value)">
        ${vis.map(x => `<option value="${x.id}" ${x.id === u ? 'selected' : ''}>${_cqEsc(x.sigla)} — ${_cqEsc(x.nome)}${x.validacao ? ' (validação)' : ''}${x.ativa === false ? ' (inativa)' : ''}</option>`).join('')}
      </select>` : '<span class="cq-muted">nenhuma</span>'}
    </div>
    <div class="cq-topbar-estacao ${est ? '' : 'cq-estacao-falta'}" title="Nome desta estação de trabalho (registrado em cada lançamento)" onclick="cqEditarEstacao()">
      ${CQ_ICO.ativo}<span>${est ? _cqEsc(est) : 'Definir estação'}</span>
    </div>
    ${window._dbAmbienteTeste ? '<span class="cq-badge cq-st-rejeitado">AMBIENTE DE TESTE</span>' : ''}
    <div class="cq-spacer"></div>
    ${u && _cqCan('lancar') ? `<button class="btn btn-primary" onclick="cqNav('lancar')">${CQ_ICO.plus} Lançar corrida</button>` : ''}`;
}

function cqEditarEstacao() {
  _cqPrompt({
    titulo: 'Estação de trabalho', subtitulo: 'Identifica o computador/local em cada registro (RDC 978, art. 105, II)',
    corpo: `<div class="form-field"><label class="field-label">Nome da estação</label>
      <input type="text" id="cq-prompt-estacao" class="field-input" maxlength="40" value="${_cqEsc(_cqEstacao())}" placeholder="Ex.: BIOQ-01, Bancada hematologia"></div>
      <div class="cq-nota">Gravado apenas neste navegador. Use um nome único por computador.</div>`,
    confirmar: 'Salvar',
    onConfirm: () => {
      const v = _cqVal('cq-prompt-estacao');
      if (!v) { showToast('Informe o nome da estação.', 'error'); return false; }
      try { localStorage.setItem('cq-estacao', v); } catch (e) { showToast('Não foi possível gravar neste navegador.', 'error'); return false; }
      cqRender();
      if (document.getElementById('cpanel-cq')?.classList.contains('active')) cqRenderConfig();
      return true;
    },
  });
}

// ── PAINEL ───────────────────────────────────────────────────
function _cqTesteSemCQHoje(t, ultimo, un) {
  const f = t.frequencia?.tipo || 'diaria';
  const hoje = _cqHoje(un?.fuso);
  const dow = new Date(hoje + 'T12:00:00').getDay();
  const dias = _cqArr(un?.diasOperacao).map(Number);
  if (dias.length && !dias.includes(dow)) return false;
  const ult = (ultimo?.dataHora || '').slice(0, 10);
  if (['diaria', 'por_corrida', 'por_turno'].includes(f)) return ult !== hoje;
  if (f === 'semanal') return !ult || CQEngine.diasEntre(ult, hoje) >= 7;
  if (f === 'quinzenal') return !ult || CQEngine.diasEntre(ult, hoje) >= 15;
  if (f === 'mensal') return !ult || CQEngine.diasEntre(ult, hoje) >= 30;
  return false;
}

function _cqLotesVencendo(u, dias = 30) {
  const hoje = _cqHoje();
  const out = [];
  const usados = new Map();
  const ultimo = (cqState.indices[u] || {}).ultimo || {};
  const insumos = new Set();
  _cqTestesDaUnidade(u).forEach(t => {
    Object.entries(t.lotesAtivos || {}).forEach(([nivel, lid]) => {
      const nl = _cqNivelNoLote(t, nivel);
      if (!usados.has(lid + '|' + nl)) usados.set(lid + '|' + nl, { lid, nivel: nl });
    });
    // Lotes de meio de cultura, corante ou reagente usados na última corrida do teste
    ['lr', 'lk'].forEach(c => { if (ultimo[t.id]?.[c]) insumos.add(ultimo[t.id][c]); });
  });
  usados.forEach(({ lid, nivel }) => {
    const lote = cqState.config.lotesControle[lid];
    const v = _cqValidadeLote(lote, nivel, u, hoje);
    if (v && v.dataLimite && v.diasRestantes <= dias) out.push({ lote, nivel, v });
  });
  insumos.forEach(id => {
    const ins = cqState.config.insumos[id];
    if (!ins || ins.status === 'encerrado') return;
    const v = CQEngine.validadeEfetiva({ validade: ins.validade }, hoje);
    if (v.dataLimite && v.diasRestantes <= dias) out.push({ insumo: ins, v });
  });
  return out.sort((a, b) => a.v.diasRestantes - b.v.diasRestantes);
}

function _cqRenderPainel(body) {
  const u = _cqUnidadeAtivaId();
  const un = _cqUnidade();
  const idx = cqState.indices[u] || {};
  const ultimo = idx.ultimo || {};
  const testes = _cqTestesDaUnidade(u);
  const pend = Object.entries(idx.pendentes || {}).map(([k, p]) => ({ key: k, ...p })).sort((a, b) => (a.dataHora || '').localeCompare(b.dataHora || ''));
  const ncs = Object.entries(idx.ncAbertas || {}).map(([k, n]) => ({ id: k, ...n }));
  const vencendo = _cqLotesVencendo(u);
  const semHoje = testes.filter(t => _cqTesteSemCQHoje(t, ultimo[t.id], un));
  const provisorios = [];
  testes.filter(t => !_cqTesteQual(t)).forEach(t => _cqNiveisTeste(t).forEach(n => {
    const lid = t.lotesAtivos?.[n];
    const a = lid ? _cqAlvoVigente(t.id, lid, n) : null;
    if (!a || ['fabricante', 'provisorio'].includes(a.origem)) provisorios.push({ t, n, a });
  }));

  const tile = (v, l, cls, onclick) => `<div class="oc-kpi ${cls}" onclick="${onclick}"><div class="oc-kpi-val">${v}</div><div class="oc-kpi-lbl">${l}</div></div>`;
  const kpis = `<div class="oc-kpis cq-kpis">
    ${tile(pend.length, 'Corridas aguardando avaliação', pend.length ? 'oc-kpi-amber' : '', "cqNav('corridas')")}
    ${tile(ncs.length, 'Não conformidades abertas', ncs.length ? 'oc-kpi-red' : '', "cqNav('ncs')")}
    ${tile(semHoje.length, 'Testes sem CQ hoje', semHoje.length ? 'oc-kpi-cyan' : '', "cqNav('lancar')")}
    ${tile(vencendo.length, 'Lotes/frascos vencendo (30 dias)', vencendo.some(x => x.v.vencido) ? 'oc-kpi-red' : vencendo.length ? 'oc-kpi-amber' : '', "cqNav('cadastros')")}
    ${tile(provisorios.length, 'Níveis sem alvo estabelecido', provisorios.length ? 'oc-kpi-amber' : '', "cqCadPendencias()")}
  </div>`;

  // Cartões por equipamento
  const grupos = {};
  testes.forEach(t => { (grupos[_cqGrupoEquip(t)] = grupos[_cqGrupoEquip(t)] || { nome: _cqEquipTeste(t), ativoId: t.ativoId, testes: [] }).testes.push(t); });
  const cards = Object.entries(grupos).sort(([, a], [, b]) => a.nome.localeCompare(b.nome)).map(([gk, g]) => {
    const ativo = g.ativoId && typeof _ativoById === 'function' ? _ativoById(g.ativoId) : null;
    const st = ativo?.statusUso;
    const chips = g.testes.sort((a, b) => _cqNomeTeste(a).localeCompare(_cqNomeTeste(b))).map(t => {
      const ul = ultimo[t.id];
      const sem = _cqTesteSemCQHoje(t, ul, un);
      let cls = 'cq-chip-cinza', tit = 'Sem corrida registrada';
      if (ul) {
        const s = ul.decisao === 'R' ? 'rejeitado' : (ul.status || 'aceito');
        cls = { aceito: 'cq-chip-verde', alerta: 'cq-chip-amarelo', rejeitado: 'cq-chip-vermelho', sem_alvo: 'cq-chip-amarelo' }[s] || 'cq-chip-cinza';
        tit = `Última corrida ${_cqFmtDH(ul.dataHora)} · ${CQ_STATUS[s]?.label || s}${ul.decisao ? '' : ' · aguardando avaliação'}`;
      }
      if (sem) tit += ' · sem CQ hoje';
      return `<span class="cq-chip ${cls}${sem ? ' cq-chip-sem' : ''}" title="${_cqEsc(tit)}" onclick="cqAbrirGrafico('${t.id}')">${_cqEsc(_cqNomeTeste(t))}</span>`;
    }).join('');
    return `<div class="cq-equip-card">
      <div class="cq-equip-head">
        <div class="cq-equip-ico">${CQ_ICO.ativo}</div>
        <div style="min-width:0;flex:1;"><div class="cq-equip-nome">${_cqEsc(g.nome)}</div>
          <div class="cq-equip-sub">${g.testes.length} teste${g.testes.length !== 1 ? 's' : ''}${st === 'em_pausa' ? ' · <span class="cq-txt-amarelo">em pausa (verificação)</span>' : st === 'em_desuso' ? ' · em desuso' : ''}</div></div>
        ${_cqCan('lancar') ? `<button class="btn btn-outline btn-sm" onclick="cqLancarPara('${_cqEsc(gk)}')">${CQ_ICO.lancar} Lançar</button>` : ''}
      </div>
      <div class="cq-chips">${chips}</div>
    </div>`;
  }).join('');

  const listaPend = pend.slice(0, 8).map(p => `<div class="cq-pend-item" onclick="cqAbrirCorrida('${p.mes || CQEngine.mesDe(p.key)}','${p.key}')">
      <span class="cq-dot ${p.temRejeicao ? 'cq-dot-vermelho' : 'cq-dot-amarelo'}"></span>
      <div style="flex:1;min-width:0;"><div class="cq-pend-tit">${_cqEsc(p.numero || p.key)} · ${_cqEsc(p.equipNome || '')}</div>
      <div class="cq-pend-sub">${_cqFmtDH(p.dataHora)} · ${p.nPend || 0} teste(s) aguardando${p.temRejeicao ? ' · com rejeição' : ''}</div></div></div>`).join('');
  const listaVenc = vencendo.slice(0, 8).map(x => {
    if (x.insumo) {
      return `<div class="cq-pend-item" onclick="cqNav('cadastros')"><span class="cq-dot ${x.v.vencido ? 'cq-dot-vermelho' : 'cq-dot-amarelo'}"></span>
      <div style="flex:1;min-width:0;"><div class="cq-pend-tit">${_cqEsc(x.insumo.nome)} · lote ${_cqEsc(x.insumo.lote)}</div>
      <div class="cq-pend-sub">${x.v.vencido ? 'Vencido' : `Vence em ${x.v.diasRestantes} dia(s)`} (${_cqEsc(CQ_TIPOS_INSUMO[x.insumo.tipo] || 'insumo')}: ${_cqFmtData(x.v.dataLimite)})</div></div></div>`;
    }
    const mat = cqState.config.materiais[x.lote.materialId];
    return `<div class="cq-pend-item" onclick="cqNav('cadastros')"><span class="cq-dot ${x.v.vencido ? 'cq-dot-vermelho' : 'cq-dot-amarelo'}"></span>
      <div style="flex:1;min-width:0;"><div class="cq-pend-tit">${_cqEsc(mat?.nome || 'Material')} · lote ${_cqEsc(x.lote.lote)} · nível ${x.nivel}</div>
      <div class="cq-pend-sub">${x.v.vencido ? 'Vencido' : `Vence em ${x.v.diasRestantes} dia(s)`} (${x.v.motivo === 'estabilidade' ? 'estabilidade após abertura' : 'validade'}: ${_cqFmtData(x.v.dataLimite)})</div></div></div>`;
  }).join('');

  body.innerHTML = `
  ${kpis}
  <div class="cq-painel-grid">
    <div class="cq-painel-main">
      <div class="cq-sec-titulo">Equipamentos e testes · ${_cqEsc(un.sigla)}</div>
      ${cards || `<div class="cq-vazio">Nenhum teste cadastrado nesta unidade. ${_cqCan('configurar') ? `<a href="#" onclick="cqNav('cadastros');return false;">Cadastrar testes</a>` : ''}</div>`}
      <div class="cq-legenda"><span class="cq-chip cq-chip-verde">aceito</span><span class="cq-chip cq-chip-amarelo">alerta / sem alvo</span><span class="cq-chip cq-chip-vermelho">rejeitado</span><span class="cq-chip cq-chip-cinza">sem registro</span><span class="cq-chip cq-chip-cinza cq-chip-sem">sem CQ hoje</span></div>
    </div>
    <div class="cq-painel-side">
      <div class="cq-card"><div class="cq-card-tit">Aguardando avaliação</div>${listaPend || '<div class="cq-vazio-p">Nenhuma corrida pendente.</div>'}
        ${pend.length > 8 ? `<a href="#" class="cq-link" onclick="cqNav('corridas');return false;">Ver todas (${pend.length})</a>` : ''}</div>
      <div class="cq-card"><div class="cq-card-tit">Lotes e frascos</div>${listaVenc || '<div class="cq-vazio-p">Nenhum vencimento nos próximos 30 dias.</div>'}</div>
      ${provisorios.length ? `<div class="cq-card"><div class="cq-card-tit">Alvos provisórios ou ausentes</div>
        ${provisorios.slice(0, 8).map(p => `<div class="cq-pend-item" onclick="cqAbrirAlvos('${p.t.id}')"><span class="cq-dot cq-dot-amarelo"></span>
          <div style="flex:1;min-width:0;"><div class="cq-pend-tit">${_cqEsc(_cqNomeTeste(p.t))} · nível ${p.n}</div>
          <div class="cq-pend-sub">${_cqEsc(_cqEquipTeste(p.t))} · ${p.a ? (p.a.origem === 'fabricante' ? 'faixa do fabricante' : `provisório (n=${p.a.nPontos || '?'})`) : (p.t.lotesAtivos?.[p.n] ? 'sem alvo' : 'sem lote de controle')}</div></div></div>`).join('')}</div>` : ''}
    </div>
  </div>`;
}

// ── NAV BADGE E CARD DA INÍCIO ───────────────────────────────
function _cqContagens() {
  const me = _cqSess().id;
  let pend = 0, ncs = 0, rej = 0;
  _cqUnidadesVisiveis().forEach(u => {
    const idx = cqState.indices[u.id] || {};
    const p = Object.values(idx.pendentes || {});
    pend += p.length;
    rej += p.filter(x => x.temRejeicao).length;
    ncs += Object.keys(idx.ncAbertas || {}).length;
  });
  return { pend, ncs, rej, me };
}

function _cqUpdateNavBadge() {
  const el = document.getElementById('cq-nav-badge');
  if (!el) return;
  const k = _cqContagens();
  const n = k.pend + k.ncs;
  el.style.display = n > 0 ? '' : 'none';
  el.textContent = n;
  el.classList.toggle('critica', k.rej > 0);
  el.title = `${k.pend} corrida(s) aguardando avaliação · ${k.ncs} NC aberta(s)`;
  const b1 = document.getElementById('cqnav-badge-corridas');
  if (b1) { b1.style.display = k.pend ? '' : 'none'; b1.textContent = k.pend; }
  const b2 = document.getElementById('cqnav-badge-ncs');
  if (b2) { b2.style.display = k.ncs ? '' : 'none'; b2.textContent = k.ncs; }
}

function cqRenderHomeCard() {
  if (!_cqConfigReady || !(typeof authCanViewTab !== 'function' || authCanViewTab('cq'))) return '';
  const unidades = _cqUnidadesVisiveis().filter(u => !u.validacao);
  if (!unidades.length) return '';
  let pend = 0, ncs = 0, sem = 0, venc = 0, rej = 0;
  const linhas = unidades.map(un => {
    const idx = cqState.indices[un.id] || {};
    const p = Object.values(idx.pendentes || {});
    const n = Object.keys(idx.ncAbertas || {}).length;
    const s = _cqTestesDaUnidade(un.id).filter(t => _cqTesteSemCQHoje(t, (idx.ultimo || {})[t.id], un)).length;
    const v = _cqLotesVencendo(un.id).filter(x => x.v.diasRestantes <= 7).length;
    pend += p.length; ncs += n; sem += s; venc += v; rej += p.filter(x => x.temRejeicao).length;
    return { un, p: p.length, n, s, v };
  });
  const tile = (v, l, cls) => `<div class="oc-hk ${cls}" onclick="switchTab('cq')"><div class="oc-hk-v">${v}</div><div class="oc-hk-l">${l}</div></div>`;
  return `<div class="home-chart-card oc-home-card cq-home-card">
    <div class="home-chart-header">
      <span class="home-chart-title">Controle de Qualidade</span>
      <span class="home-chart-badge" style="cursor:pointer;" onclick="switchTab('cq')">Abrir</span>
    </div>
    <div class="oc-hk-row">
      ${tile(pend, 'Corridas aguardando avaliação', rej ? 'red' : pend ? 'amber' : '')}
      ${tile(ncs, 'Não conformidades abertas', ncs ? 'red' : '')}
      ${tile(sem, 'Testes sem CQ hoje', sem ? 'cyan' : '')}
      ${tile(venc, 'Lotes vencendo (7 dias)', venc ? 'amber' : '')}
    </div>
    ${linhas.length > 1 ? `<div class="cq-home-unidades">${linhas.map(l => `<div class="cq-home-un"><b>${_cqEsc(l.un.sigla)}</b><span>${l.p} pend.</span><span>${l.n} NC</span><span>${l.s} sem CQ</span></div>`).join('')}</div>` : ''}
  </div>`;
}

// ── MODAIS GENÉRICOS ─────────────────────────────────────────
function _cqInjectModals() {
  const div = document.createElement('div');
  div.innerHTML = `
<div class="ot-form-drawer cq-drawer" id="cq-drawer">
  <div class="drawer-header">
    <div class="drawer-header-icon" id="cq-drawer-ico" style="color:var(--cyan);">${CQ_ICO.beaker}</div>
    <div style="flex:1;min-width:0;"><div class="drawer-title" id="cq-drawer-title"></div><div class="drawer-subtitle" id="cq-drawer-sub"></div></div>
    <button class="modal-close" onclick="cqDrawerClose()">${CQ_ICO.close}</button>
  </div>
  <div class="drawer-body cq-drawer-body" id="cq-drawer-body"></div>
  <div class="drawer-footer" id="cq-drawer-foot"></div>
</div>

<div class="modal-overlay modal-ot-view cq-modal" id="cq-modal">
  <div class="modal wide">
    <div class="modal-header">
      <div class="modal-header-left">
        <div class="modal-header-icon" id="cq-modal-ico" style="color:var(--cyan);">${CQ_ICO.beaker}</div>
        <div><div class="modal-title" id="cq-modal-title"></div><div class="modal-subtitle" id="cq-modal-sub"></div></div>
      </div>
      <button class="modal-close" onclick="cqModalClose()">${CQ_ICO.close}</button>
    </div>
    <div class="modal-body cq-modal-body" id="cq-modal-body"></div>
    <div class="modal-footer cq-modal-foot" id="cq-modal-foot"></div>
  </div>
</div>

<div class="modal-overlay modal-ot-sm cq-prompt" id="cq-prompt">
  <div class="modal">
    <div class="modal-header">
      <div class="modal-header-left">
        <div class="modal-header-icon" style="color:var(--cyan);">${CQ_ICO.shield}</div>
        <div><div class="modal-title" id="cq-prompt-title"></div><div class="modal-subtitle" id="cq-prompt-sub"></div></div>
      </div>
      <button class="modal-close" onclick="cqPromptClose()">${CQ_ICO.close}</button>
    </div>
    <div class="modal-body" id="cq-prompt-body"></div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="cqPromptClose()">Voltar</button>
      <button class="btn btn-primary" id="cq-prompt-ok" onclick="cqPromptConfirmar()"></button>
    </div>
  </div>
</div>`;
  document.body.appendChild(div);
}

function cqDrawerOpen({ titulo, subtitulo, corpo, rodape, icone, cor }) {
  delete document.getElementById('cq-drawer-title').dataset.teste;
  document.getElementById('cq-drawer-title').textContent = titulo || '';
  document.getElementById('cq-drawer-sub').textContent = subtitulo || '';
  const ico = document.getElementById('cq-drawer-ico');
  ico.innerHTML = CQ_ICO[icone] || CQ_ICO.beaker;
  ico.style.color = cor || 'var(--cyan)';
  document.getElementById('cq-drawer-body').innerHTML = corpo || '';
  document.getElementById('cq-drawer-foot').innerHTML = rodape || '';
  otOpenModal('cq-drawer');
}
function cqDrawerClose() { otCloseModal('cq-drawer'); }

function cqModalOpen({ titulo, subtitulo, corpo, rodape, icone, cor }) {
  document.getElementById('cq-modal-title').textContent = titulo || '';
  document.getElementById('cq-modal-sub').textContent = subtitulo || '';
  const ico = document.getElementById('cq-modal-ico');
  ico.innerHTML = CQ_ICO[icone] || CQ_ICO.beaker;
  ico.style.color = cor || 'var(--cyan)';
  document.getElementById('cq-modal-body').innerHTML = corpo || '';
  document.getElementById('cq-modal-foot').innerHTML = rodape || '';
  otOpenModal('cq-modal');
}
function cqModalClose() { otCloseModal('cq-modal'); }

// Prompt genérico: onConfirm retorna true (ou Promise<true>) para fechar
function _cqPrompt({ titulo, subtitulo, corpo, confirmar, perigo, onConfirm, largo }) {
  document.getElementById('cq-prompt')?.classList.toggle('cq-prompt-largo', !!largo);
  document.getElementById('cq-prompt-title').textContent = titulo || '';
  document.getElementById('cq-prompt-sub').textContent = subtitulo || '';
  document.getElementById('cq-prompt-body').innerHTML = corpo || '';
  const ok = document.getElementById('cq-prompt-ok');
  ok.textContent = confirmar || 'Confirmar';
  ok.className = 'btn ' + (perigo ? 'btn-danger cq-btn-perigo' : 'btn-primary');
  ok.disabled = false;
  _cqPromptCb = onConfirm;
  otOpenModal('cq-prompt');
  setTimeout(() => document.querySelector('#cq-prompt-body input:not([type=hidden]), #cq-prompt-body textarea, #cq-prompt-body select')?.focus(), 80);
}
async function cqPromptConfirmar() {
  const ok = document.getElementById('cq-prompt-ok');
  if (!_cqPromptCb || ok.disabled) return;
  ok.disabled = true;
  try {
    const fechar = await _cqPromptCb();
    if (fechar) cqPromptClose();
  } finally { ok.disabled = false; }
}
function cqPromptClose() { otCloseModal('cq-prompt'); _cqPromptCb = null; }

// Reautenticação para assinaturas críticas (política da unidade)
function _cqReautenticar(motivo) {
  return new Promise(resolve => {
    if (!_cqPolitica().reautenticar || typeof authVerifyCurrentPassword !== 'function') { resolve(true); return; }
    let resolvido = false;
    _cqPrompt({
      titulo: 'Confirme sua identidade', subtitulo: motivo || 'Assinatura eletrônica',
      corpo: `<div class="form-field"><label class="field-label">Usuário</label><input type="text" class="field-input" value="${_cqEsc(_cqSess().nome)}" disabled></div>
        <div class="form-field"><label class="field-label">Senha <span class="required">*</span></label>
        <input type="password" id="cq-reauth-pwd" class="field-input" autocomplete="current-password" onkeydown="if(event.key==='Enter')cqPromptConfirmar()"></div>`,
      confirmar: 'Assinar',
      onConfirm: () => {
        if (!authVerifyCurrentPassword(document.getElementById('cq-reauth-pwd')?.value || '')) { showToast('Senha incorreta.', 'error'); return false; }
        resolvido = true;
        resolve(true);
        return true;
      },
    });
    const el = document.getElementById('cq-prompt');
    const obs = new MutationObserver(() => {
      if (!el.classList.contains('open')) { obs.disconnect(); if (!resolvido) resolve(false); }
    });
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
  });
}

// Botão Ativar / Inativar do rodapé (ao lado de Excluir). O campo continua no formulário como checkbox
// oculto: o botão o inverte e chama o salvar do cadastro (validações, diferenças e trilha de sempre).
// cfg: { ids: 'id1,id2' (checkboxes), fn: nome da função de salvar, colecao, id, campo ('ativo' | 'ativa'), ativo }
function _cqBtnAtivoHTML(cfg) {
  if (!cfg) return '';
  return `<button type="button" class="btn btn-outline cq-btn-ativo ${cfg.ativo ? 'on' : 'off'}" title="${cfg.ativo ? 'Inativar: deixa de ser oferecido em lançamentos e cadastros novos' : 'Reativar o cadastro'}"
    onclick="cqAtivoAlternar('${cfg.ids}','${cfg.fn}','${cfg.colecao}','${cfg.id}','${cfg.campo || 'ativo'}')">${cfg.ativo ? `${CQ_ICO.pause} Inativar` : `${CQ_ICO.play} Ativar`}</button>`;
}
async function cqAtivoAlternar(ids, fn, colecao, id, campo) {
  const chks = String(ids).split(',').map(x => document.getElementById(x)).filter(Boolean);
  if (!chks.length || typeof window[fn] !== 'function' || _cqSalvando) return;
  const novo = !chks[0].checked;
  chks.forEach(c => { c.checked = novo; });
  await window[fn]();
  // Salvar recusado (validação) ou à espera de justificativa: o formulário volta ao valor gravado
  const rec = cqState.config[colecao]?.[id];
  if (rec && (rec[campo] !== false) !== novo) chks.forEach(c => { c.checked = !novo; });
}
// Aviso no topo do formulário de cadastro inativo
function _cqInativoNota(rec, campo = 'ativo', texto) {
  if (!rec || rec[campo] !== false) return '';
  return `<div class="cq-alerta-box cq-inativo-box">${CQ_ICO.pause} Inativo — ${texto || 'não é oferecido em lançamentos nem em cadastros novos'}. Use “Ativar” no rodapé para reativar.</div>`;
}

// Abas da janela lateral: [{ k, rotulo, html }] (itens falsy ignorados). Com uma aba só, sem cabeçalho.
// Os campos das abas ocultas continuam no DOM, então o salvar lê todas.
function _cqAbasHTML(grupo, abas, ativa) {
  const lista = abas.filter(Boolean);
  if (lista.length < 2) return lista[0]?.html || '';
  const at = lista.some(a => a.k === ativa) ? ativa : lista[0].k;
  return `<div class="ot-modal-tabs cq-drawer-tabs" id="cq-abas-${grupo}">${lista.map(a => `<button type="button" class="ot-modal-tab-btn${a.k === at ? ' active' : ''}" data-aba="${a.k}" onclick="cqAbaTrocar('${grupo}','${a.k}')">${a.rotulo}</button>`).join('')}</div>
    ${lista.map(a => `<div class="cq-aba-pane" data-grupo="${grupo}" data-aba="${a.k}" style="${a.k === at ? '' : 'display:none;'}">${a.html}</div>`).join('')}`;
}
function cqAbaTrocar(grupo, aba) {
  document.querySelectorAll(`#cq-abas-${grupo} .ot-modal-tab-btn`).forEach(b => b.classList.toggle('active', b.dataset.aba === aba));
  document.querySelectorAll(`.cq-aba-pane[data-grupo="${grupo}"]`).forEach(p => { p.style.display = p.dataset.aba === aba ? '' : 'none'; });
}
// Aba "Rastreabilidade" (só para cadastro existente), com o número de registros
function _cqAbaTrilha(rec) {
  if (!rec) return null;
  const n = _cqTrilhaLista(rec).length;
  return { k: 'trilha', rotulo: `Rastreabilidade${n ? ` <span class="cq-step-qtd">${n}</span>` : ''}`, html: _cqTrilhaHTML(rec) };
}

// Trilha formatada (lista) para exibição
function _cqTrilhaHTML(rec) {
  const itens = _cqTrilhaLista(rec).reverse();
  if (!itens.length) return '<div class="cq-vazio-p">Sem registros.</div>';
  return `<div class="cq-trilha">${itens.map(t => `<div class="cq-trilha-item">
    <div class="cq-trilha-head"><b>${_cqEsc(t.userName || '—')}</b> · ${_cqFmtDH(t.ts)}${t.estacao ? ` · estação ${_cqEsc(t.estacao)}` : ''}</div>
    <div class="cq-trilha-txt">${_cqEsc(t.texto || t.acao)}</div>
    ${t.diffs.length ? `<div class="cq-trilha-diffs">${t.diffs.map(d => `<div><span>${_cqEsc(d.campo)}:</span> <s>${_cqEsc(d.antes)}</s> → <b>${_cqEsc(d.depois)}</b></div>`).join('')}</div>` : ''}
  </div>`).join('')}</div>`;
}

// ── CONFIGURAÇÕES › CONTROLE DE QUALIDADE ────────────────────
function cqRenderConfig() {
  const body = document.getElementById('cpanel-cq-body');
  if (!body) return;
  if (!_cqCan('configurar')) { body.innerHTML = '<div class="cq-vazio">Sem permissão para configurar o Controle de Qualidade.</div>'; return; }
  const unidades = Object.values(cqState.config.unidades).sort((a, b) => (a.sigla || '').localeCompare(b.sigla || ''));
  const cat = cqState.config.catalogos;
  const validacoes = Object.values(cqState.config.validacoes).sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const catBloco = (k, titulo, desc) => `<div class="cq-cfg-cat">
    <div class="cq-cfg-cat-tit">${titulo}</div><div class="cq-nota">${desc}</div>
    <div class="cq-tags">${_cqArr(cat[k]).map((v, i) => `<span class="cq-tag">${_cqEsc(v)}<button onclick="cqCatRemover('${k}',${i})" title="Remover">×</button></span>`).join('')}</div>
    <div class="cq-cfg-add"><input type="text" class="field-input" id="cq-cat-add-${k}" placeholder="Novo item" onkeydown="if(event.key==='Enter')cqCatAdicionar('${k}')">
      <button class="btn btn-outline btn-sm" onclick="cqCatAdicionar('${k}')">${CQ_ICO.plus} Adicionar</button></div>
  </div>`;

  body.innerHTML = `
  <div class="cq-cfg">
    <section class="cq-cfg-sec">
      <div class="cq-cfg-sec-head"><div><h3>Unidades</h3><p>Cada unidade que executa exames tem CIQ e CEQ próprios (RDC 978, arts. 178 e 186).</p></div>
        <button class="btn btn-primary btn-sm" onclick="cqUnidadeForm(null)">${CQ_ICO.plus} Nova unidade</button></div>
      <table class="ot-list-table cq-table">
        <thead><tr><th class="ot-list-th">Sigla</th><th class="ot-list-th">Nome</th><th class="ot-list-th">CNES</th><th class="ot-list-th">RT</th><th class="ot-list-th">Membros</th><th class="ot-list-th">Situação</th></tr></thead>
        <tbody>${unidades.length ? unidades.map(un => `<tr class="ot-list-row" onclick="cqUnidadeForm('${un.id}')">
          <td><b>${_cqEsc(un.sigla)}</b></td><td>${_cqEsc(un.nome)}</td><td>${_cqEsc(un.cnes || '—')}</td>
          <td>${_cqEsc(_cqNomeUsuario(un.rtUserId) || '—')}</td><td>${Object.keys(un.membros || {}).length}</td>
          <td>${un.ativa === false ? '<span class="cq-badge cq-st-semalvo">Inativa</span>' : '<span class="cq-badge cq-st-aceito">Ativa</span>'}${un.validacao ? ' <span class="cq-badge cq-st-pendente">Validação</span>' : ''}</td>
        </tr>`).join('') : '<tr><td colspan="6" class="cq-td-vazio">Nenhuma unidade cadastrada.</td></tr>'}</tbody>
      </table>
    </section>

    <section class="cq-cfg-sec">
      <div class="cq-cfg-sec-head"><div><h3>Esta estação de trabalho</h3><p>Nome do computador/local gravado em cada registro (RDC 978, art. 105, II).</p></div></div>
      <div class="cq-cfg-add"><input type="text" class="field-input" id="cq-cfg-estacao" maxlength="40" value="${_cqEsc(_cqEstacao())}" placeholder="Ex.: BIOQ-01">
        <button class="btn btn-outline btn-sm" onclick="cqSalvarEstacaoCfg()">${CQ_ICO.check} Salvar</button></div>
    </section>

    <section class="cq-cfg-sec">
      <div class="cq-cfg-sec-head"><div><h3>Catálogos</h3><p>Listas usadas nas não conformidades e nas especificações da qualidade.</p></div></div>
      <div class="cq-cfg-cats">
        ${catBloco('causas', 'Causas de rejeição', 'Usadas na investigação das corridas rejeitadas.')}
        ${catBloco('acoes', 'Ações corretivas', 'Ações registradas nas não conformidades.')}
        ${catBloco('fontesETa', 'Fontes de erro total permitido', 'Modelo científico das especificações da qualidade (PALC 11.4).')}
      </div>
    </section>

    <section class="cq-cfg-sec">
      <div class="cq-cfg-sec-head"><div><h3>Validação do módulo</h3><p>Versão em uso: <b>${CQ_VERSAO}</b>. Registre a validação antes de usar em rotina (RDC 978, art. 106).</p></div>
        <button class="btn btn-outline btn-sm" onclick="cqValidacaoForm()">${CQ_ICO.plus} Registrar validação</button></div>
      ${validacoes.length ? `<table class="ot-list-table cq-table"><thead><tr><th class="ot-list-th">Data</th><th class="ot-list-th">Versão</th><th class="ot-list-th">Escopo / protocolo</th><th class="ot-list-th">Resultado</th><th class="ot-list-th">Assinado por</th></tr></thead>
        <tbody>${validacoes.map(v => `<tr><td>${_cqFmtData(v.data)}</td><td>${_cqEsc(v.versao)}</td><td style="max-width:320px;">${_cqEsc(v.escopo)}</td>
          <td>${v.resultado === 'aprovado' ? '<span class="cq-badge cq-st-aceito">Aprovado</span>' : '<span class="cq-badge cq-st-rejeitado">Reprovado</span>'}</td>
          <td>${_cqEsc(v.assinatura?.porNome || '—')}<div class="cq-muted">${_cqFmtDH(v.assinatura?.em)}</div></td></tr>`).join('')}</tbody></table>`
        : `<div class="cq-alerta-box">${CQ_ICO.alerta} Nenhuma validação registrada para a versão ${CQ_VERSAO}.</div>`}
    </section>

    <section class="cq-cfg-sec">
      <div class="cq-cfg-sec-head"><div><h3>Planilhas (Excel)</h3><p>Exporte cadastros, alvos, corridas, resultados e não conformidades, ou importe cadastros e resultados históricos. Na importação, registros existentes são ignorados e resultados viram corridas avaliadas pelas regras de cada teste.</p></div>
        <div class="cq-cfg-btns"><button class="btn btn-outline btn-sm" onclick="cqPlanilhaModelo()">${CQ_ICO.lista} Baixar modelo</button>
          <button class="btn btn-outline btn-sm" onclick="cqPlanilhaExportarForm()">${CQ_ICO.print} Exportar</button>
          <button class="btn btn-primary btn-sm" onclick="cqPlanilhaImportarEscolher()">${CQ_ICO.plus} Importar planilha</button></div></div>
    </section>

    ${_cqIsAdmin() ? `<section class="cq-cfg-sec">
      <div class="cq-cfg-sec-head"><div><h3>Manutenção</h3><p>Recalcula os índices (pendências, últimas corridas e NCs abertas) da unidade ativa a partir dos registros.</p></div>
        <button class="btn btn-outline btn-sm" onclick="cqReconstruirIndices()">${CQ_ICO.undo} Reconstruir índices</button></div>
    </section>
    <section class="cq-cfg-sec">
      <div class="cq-cfg-sec-head"><div><h3>Dados de exemplo</h3><p>Cria a unidade fictícia <b>EXEMP</b> com cadastros, alvos, cerca de 45 dias de corridas (aceites, alertas, rejeições com repetição) e não conformidades, para demonstrar o funcionamento completo do módulo. Remova-os antes de usar o CQ em rotina.</p></div>
        ${typeof cqExemploCriar !== 'function' ? '' : _cqExemploExiste()
          ? `<button class="btn btn-outline btn-sm cq-btn-perigo" onclick="cqExemploRemover()">${CQ_ICO.undo} Remover dados de exemplo</button>`
          : `<button class="btn btn-outline btn-sm" onclick="cqExemploCriar()">${CQ_ICO.plus} Criar dados de exemplo</button>`}</div>
    </section>
    <section class="cq-cfg-sec cq-cfg-perigo">
      <div class="cq-cfg-sec-head"><div><h3>Apagar dados do Controle de Qualidade</h3><p>Remove do banco todos os cadastros, alvos, corridas, resultados, não conformidades, índices e numerações do CQ, de todas as unidades. Uma cópia em <code>.json</code> é baixada antes da exclusão. Os registros do CQ devem ser retidos pelo prazo regulatório (RDC 978/2025) — use somente para descartar dados de teste.</p></div>
        <button class="btn btn-outline btn-sm cq-btn-perigo" onclick="cqApagarTudo()">${CQ_ICO.alerta} Apagar dados do CQ</button></div>
    </section>` : ''}
  </div>`;
}

function cqSalvarEstacaoCfg() {
  const v = _cqVal('cq-cfg-estacao');
  if (!v) { showToast('Informe o nome da estação.', 'error'); return; }
  try { localStorage.setItem('cq-estacao', v); } catch (e) { showToast('Não foi possível gravar neste navegador.', 'error'); return; }
  showToast('Estação definida.', 'success');
  cqRender();
}

async function cqCatAdicionar(k) {
  const v = _cqVal('cq-cat-add-' + k);
  if (!v) return;
  const lista = _cqArr(cqState.config.catalogos[k]);
  if (lista.some(x => x.toLowerCase() === v.toLowerCase())) { showToast('Item já existe.', 'error'); return; }
  const nova = [...lista, v];
  if (await window.dbUpdate({ [`${CQ_KEYS.config}/catalogos/${k}`]: nova })) {
    cqState.config.catalogos[k] = nova;
    cqRenderConfig();
  } else showToast('Falha ao gravar.', 'error');
}
async function cqCatRemover(k, i) {
  const lista = _cqArr(cqState.config.catalogos[k]);
  if (lista.length <= 1) { showToast('A lista precisa ter ao menos um item.', 'error'); return; }
  const nova = lista.filter((_, j) => j !== i);
  if (await window.dbUpdate({ [`${CQ_KEYS.config}/catalogos/${k}`]: nova })) {
    cqState.config.catalogos[k] = nova;
    cqRenderConfig();
  } else showToast('Falha ao gravar.', 'error');
}

// ── FORMULÁRIO DE UNIDADE ────────────────────────────────────
let _cqUnFormId = null;
const CQ_LBL_UNIDADE = {
  sigla: 'Sigla', nome: 'Nome', cnes: 'CNES', endereco: 'Endereço', fuso: 'Fuso horário', setores: 'Setores',
  rtUserId: 'Responsável técnico', ativa: 'Ativa', validacao: 'Unidade de validação', diasOperacao: 'Dias de operação',
  membros: 'Membros', politica: 'Política de liberação',
};

function cqUnidadeForm(id) {
  if (!_cqCan('configurar')) return;
  const un = id ? cqState.config.unidades[id] : null;
  _cqUnFormId = id || null;
  const pol = Object.assign({ liberarAceitosAoSalvar: true, comentarioObrigatorioAlerta: true, reautenticar: true, retroativoHoras: 24 }, un?.politica || {});
  const dias = un ? _cqArr(un.diasOperacao).map(Number) : [1, 2, 3, 4, 5, 6];
  const setoresSel = _cqArr(un?.setores);
  const setores = typeof state !== 'undefined' ? [...(state.setores || [])].sort((a, b) => a.localeCompare(b, 'pt')) : [];
  const membros = un?.membros || {};
  const users = _cqUsuarios();
  const equipsUn = id && typeof _cqGruposLanc === 'function' ? _cqGruposLanc(id) : [];
  cqDrawerOpen({
    titulo: un ? `Unidade ${un.sigla}` : 'Nova unidade', subtitulo: 'Local que executa exames e realiza CIQ/CEQ', icone: 'unidade',
    corpo: _cqAbasHTML('un', [{ k: 'dados', rotulo: 'Unidade', html: `
      ${_cqInativoNota(un, 'ativa', 'não aparece na seleção de unidades para quem não é administrador')}
      <div class="form-section"><div class="form-section-title">${CQ_ICO.unidade}Identificação</div>
        <div class="form-row">
          <div class="form-field" style="max-width:130px;"><label class="field-label">Sigla <span class="required">*</span></label><input type="text" id="cq-un-sigla" class="field-input" maxlength="8" value="${_cqEsc(un?.sigla)}" placeholder="MAT"></div>
          <div class="form-field"><label class="field-label">Nome <span class="required">*</span></label><input type="text" id="cq-un-nome" class="field-input" maxlength="80" value="${_cqEsc(un?.nome)}" placeholder="Unidade Matriz"></div>
        </div>
        <div class="form-row">
          <div class="form-field"><label class="field-label">CNES</label><input type="text" id="cq-un-cnes" class="field-input" maxlength="12" value="${_cqEsc(un?.cnes)}"></div>
          <div class="form-field"><label class="field-label">Fuso horário</label><select id="cq-un-fuso" class="field-select">${_cqMapOptions(CQ_FUSOS, un?.fuso || 'America/Sao_Paulo', null)}</select></div>
        </div>
        <div class="form-field"><label class="field-label">Endereço</label><input type="text" id="cq-un-endereco" class="field-input" maxlength="160" value="${_cqEsc(un?.endereco)}"></div>
        <div class="form-field"><label class="field-label">Responsável técnico</label>
          <select id="cq-un-rt" class="field-select"><option value="">— Selecione —</option>${users.map(u => `<option value="${u.id}" ${u.id === un?.rtUserId ? 'selected' : ''}>${_cqEsc(u.nomeCompleto || u.username)}</option>`).join('')}</select></div>
        <div class="form-field"><label class="field-label">Setores de ativos desta unidade</label>
          <div class="cq-nota">Restringe os equipamentos oferecidos no cadastro de testes. Sem seleção, todos os ativos aparecem.</div>
          <div class="cq-checks">${setores.map(s => `<label class="oc-check"><input type="checkbox" class="cq-un-setor" value="${_cqEsc(s)}" ${setoresSel.includes(s) ? 'checked' : ''}> ${_cqEsc(s)}</label>`).join('') || '<span class="cq-muted">Nenhum setor cadastrado.</span>'}</div></div>
        <div class="form-field"><label class="field-label">Dias de operação</label>
          <div class="cq-checks cq-checks-inline">${CQ_DIAS.map((d, i) => `<label class="oc-check"><input type="checkbox" class="cq-un-dia" value="${i}" ${dias.includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div></div>
        <div class="cq-checks">
          <input type="checkbox" id="cq-un-ativa" hidden ${un?.ativa === false ? '' : 'checked'}>
          <label class="oc-check"><input type="checkbox" id="cq-un-validacao" ${un?.validacao ? 'checked' : ''}> Unidade de validação (testes do sistema; fora dos indicadores)</label>
        </div>
      </div>
      <div class="form-section"><div class="form-section-title">${CQ_ICO.shield}Política de liberação</div>
        <div class="cq-checks">
          <label class="oc-check"><input type="checkbox" id="cq-un-pol-lib" ${pol.liberarAceitosAoSalvar ? 'checked' : ''}> Liberar automaticamente, ao salvar, os testes aceitos (sem violação) quando o usuário tem permissão de liberar</label>
          <label class="oc-check"><input type="checkbox" id="cq-un-pol-com" ${pol.comentarioObrigatorioAlerta ? 'checked' : ''}> Exigir comentário para liberar testes em alerta</label>
          <label class="oc-check"><input type="checkbox" id="cq-un-pol-reauth" ${pol.reautenticar ? 'checked' : ''}> Exigir senha em assinaturas críticas (liberar com violação, alterar alvos)</label>
        </div>
        <div class="form-field" style="max-width:260px;"><label class="field-label">Lançamento retroativo sem justificativa até (horas)</label>
          <input type="number" min="0" max="720" id="cq-un-pol-retro" class="field-input" value="${Number(pol.retroativoHoras) || 0}"></div>
      </div>
      <div class="form-section"><div class="form-section-title">${CQ_ICO.lista}Lançamento de corridas</div>
        <div class="cq-nota">Em lote: a grade mostra todos os testes do equipamento. Fracionada: o operador adiciona só os testes realizados naquela corrida, um a um — para rotinas em que os testes rodam em horários distintos. O modo pode ser trocado na própria tela de lançamento.</div>
        <div class="form-field" style="max-width:360px;"><label class="field-label">Modo padrão da unidade</label>
          <select id="cq-un-pol-modo" class="field-select">${_cqMapOptions(CQ_MODOS_CORRIDA, CQ_MODOS_CORRIDA[pol.modoCorrida] ? pol.modoCorrida : 'lote', null)}</select></div>
        ${equipsUn.length ? `<div class="form-field"><label class="field-label">Exceções por equipamento / sistema</label>
          <div class="cq-membros">${equipsUn.map(g => `<div class="cq-membro"><span>${_cqEsc(g.nome)}<span class="cq-muted"> ${g.testes.length} teste(s)</span></span>
            <select class="field-select cq-un-modo-equip" data-k="${_cqEsc(_cqChaveModoEquip(g.key))}"><option value="">Padrão da unidade</option>${Object.entries(CQ_MODOS_CORRIDA).map(([k, l]) => `<option value="${k}" ${pol.modoCorridaEquip?.[_cqChaveModoEquip(g.key)] === k ? 'selected' : ''}>${_cqEsc(l)}</option>`).join('')}</select></div>`).join('')}</div></div>` : ''}
      </div>
      ${typeof _cqEsterUnidadeHTML === 'function' ? _cqEsterUnidadeHTML(id, equipsUn) : ''}
      <div class="form-section"><div class="form-section-title">${CQ_ICO.lock}Membros e papéis</div>
        <div class="cq-nota">Só os membros veem e lançam nesta unidade. As ações permitidas dependem também das permissões do grupo do usuário.</div>
        <div class="cq-membros">${users.map(u => `<div class="cq-membro"><span>${_cqEsc(u.nomeCompleto || u.username)}<span class="cq-muted"> ${_cqEsc(u.cargo || '')}</span></span>
          <select class="field-select cq-un-membro" data-user="${u.id}">${_cqMapOptions(CQ_PAPEIS, membros[u.id] || '', 'Sem acesso')}</select></div>`).join('')}</div>
      </div>
` }, _cqAbaTrilha(un)]),
    rodape: `${un ? `<div class="cq-rodape-esq">${_cqBtnAtivoHTML({ ids: 'cq-un-ativa', fn: 'cqUnidadeSalvar', colecao: 'unidades', id: un.id, campo: 'ativa', ativo: un.ativa !== false })}</div>` : ''}
      <button class="btn btn-outline" onclick="cqDrawerClose()">Cancelar</button>
      <button class="btn btn-primary" onclick="cqUnidadeSalvar()">${CQ_ICO.check} Salvar</button>`,
  });
}

async function cqUnidadeSalvar() {
  if (_cqSalvando) return;
  const sigla = _cqVal('cq-un-sigla').toUpperCase(), nome = _cqVal('cq-un-nome');
  if (!sigla || !/^[A-Z0-9]{1,8}$/.test(sigla)) { showToast('Informe a sigla (até 8 letras ou números).', 'error'); return; }
  if (!nome) { showToast('Informe o nome da unidade.', 'error'); return; }
  if (Object.values(cqState.config.unidades).some(u => u.sigla === sigla && u.id !== _cqUnFormId)) { showToast('Já existe unidade com esta sigla.', 'error'); return; }
  const antes = _cqUnFormId ? cqState.config.unidades[_cqUnFormId] : null;
  const membros = {};
  document.querySelectorAll('#cq-drawer .cq-un-membro').forEach(sel => { if (sel.value) membros[sel.dataset.user] = sel.value; });
  const rec = {
    ...(antes || {}),
    id: _cqUnFormId || _cqUid(), sigla, nome, cnes: _cqVal('cq-un-cnes'), endereco: _cqVal('cq-un-endereco'),
    fuso: _cqVal('cq-un-fuso') || 'America/Sao_Paulo', rtUserId: _cqVal('cq-un-rt') || null,
    setores: [...document.querySelectorAll('#cq-drawer .cq-un-setor:checked')].map(x => x.value),
    diasOperacao: [...document.querySelectorAll('#cq-drawer .cq-un-dia:checked')].map(x => Number(x.value)),
    ativa: _cqChk('cq-un-ativa'), validacao: _cqChk('cq-un-validacao'), membros,
    politica: { liberarAceitosAoSalvar: _cqChk('cq-un-pol-lib'), comentarioObrigatorioAlerta: _cqChk('cq-un-pol-com'),
                reautenticar: _cqChk('cq-un-pol-reauth'), retroativoHoras: Math.max(0, Number(_cqVal('cq-un-pol-retro')) || 0),
                modoCorrida: CQ_MODOS_CORRIDA[_cqVal('cq-un-pol-modo')] ? _cqVal('cq-un-pol-modo') : 'lote' },
  };
  // Exceções por equipamento: preserva as de equipamentos que não aparecem agora (ex.: sem testes ativos)
  const modosEquip = { ...(antes?.politica?.modoCorridaEquip || {}) };
  document.querySelectorAll('#cq-drawer .cq-un-modo-equip').forEach(sel => { if (sel.value) modosEquip[sel.dataset.k] = sel.value; else delete modosEquip[sel.dataset.k]; });
  if (Object.keys(modosEquip).length) rec.politica.modoCorridaEquip = modosEquip;
  if (rec.rtUserId && !rec.membros[rec.rtUserId]) rec.membros[rec.rtUserId] = 'rt';
  if (!antes) { rec.criadoEm = _cqAgora(); rec.criadoPor = _cqAssinatura(); }
  const fmt = {
    rtUserId: v => _cqNomeUsuario(v) || v, ativa: v => v ? 'Sim' : 'Não', validacao: v => v ? 'Sim' : 'Não',
    diasOperacao: v => _cqArr(v).map(i => CQ_DIAS[i]).join(', '), fuso: v => CQ_FUSOS[v] || v,
    membros: v => Object.entries(v || {}).map(([id, p]) => `${_cqNomeUsuario(id) || id} (${CQ_PAPEIS[p] || p})`).join('; '),
    politica: v => JSON.stringify(v),
  };
  const diffs = antes ? _cqDiff(antes, rec, CQ_LBL_UNIDADE, fmt) : [];
  if (antes && !diffs.length) { cqDrawerClose(); return; }
  _cqTrilhaAdd(rec, antes ? 'edicao' : 'criacao', antes ? 'Unidade alterada' : 'Unidade cadastrada', diffs);
  _cqSalvando = true;
  try {
    if (await _cqSalvarRegistro('unidades', rec)) {
      showToast(antes ? 'Unidade atualizada.' : 'Unidade cadastrada.', 'success');
      cqDrawerClose();
      _cqGarantirUnidadeAtiva();
      cqRenderConfig();
      cqRender();
    }
  } finally { _cqSalvando = false; }
}

function cqValidacaoForm() {
  _cqPrompt({
    titulo: 'Registrar validação do módulo', subtitulo: `Versão ${CQ_VERSAO} · RDC 978, art. 106`,
    corpo: `<div class="form-row"><div class="form-field"><label class="field-label">Data <span class="required">*</span></label><input type="date" id="cq-val-data" class="field-input" value="${_cqHoje()}"></div>
      <div class="form-field"><label class="field-label">Resultado <span class="required">*</span></label><select id="cq-val-res" class="field-select"><option value="aprovado">Aprovado</option><option value="reprovado">Reprovado</option></select></div></div>
      <div class="form-field"><label class="field-label">Escopo / protocolo executado <span class="required">*</span></label>
        <textarea id="cq-val-escopo" class="field-textarea" style="min-height:90px;" placeholder="Ex.: protocolo PV-CQ-01 — cálculos de média/DP/z, regras de Westgard com casos conhecidos, trilha de auditoria, permissões, relatórios. Testes automatizados: 45/45 aprovados."></textarea></div>
      <div class="form-field"><label class="field-label">Observações / desvios</label><textarea id="cq-val-obs" class="field-textarea" style="min-height:60px;"></textarea></div>`,
    confirmar: 'Assinar e registrar',
    onConfirm: async () => {
      const data = _cqVal('cq-val-data'), escopo = _cqVal('cq-val-escopo');
      if (!data || !escopo) { showToast('Informe a data e o escopo.', 'error'); return false; }
      const rec = { id: _cqUid(), versao: CQ_VERSAO, data, resultado: _cqVal('cq-val-res'), escopo, observacoes: _cqVal('cq-val-obs'),
                    assinatura: _cqAssinatura(), criadoEm: _cqAgora() };
      _cqTrilhaAdd(rec, 'criacao', 'Validação registrada');
      if (!(await _cqSalvarRegistro('validacoes', rec))) return false;
      showToast('Validação registrada.', 'success');
      cqRenderConfig();
      return true;
    },
  });
}

// Recalcula os índices da unidade ativa a partir dos registros (12 meses)
async function cqReconstruirIndices() {
  const u = _cqUnidadeAtivaId();
  if (!u || !_cqIsAdmin()) return;
  if (!_cqPodeGravar()) return;
  showToast('Reconstruindo índices…', 'success');
  const mesAtual = CQEngine.mesDe(_cqNowLocal());
  const meses = CQEngine.mesesAnteriores(mesAtual, 12);
  const corridas = (await Promise.all(meses.map(m => cqCarregarCorridasMes(u, m)))).flatMap(o => Object.values(o));
  const idx = { ultimo: {}, pendentes: {}, ncAbertas: {} };
  corridas.sort((a, b) => a.key.localeCompare(b.key)).forEach(c => {
    Object.entries(c.testes || {}).forEach(([t, ct]) => {
      if (ct.naoRealizado) return;
      idx.ultimo[t] = { dataHora: c.dataHora, corridaKey: c.key, mes: c.mes, status: ct.avaliacao?.status || 'aceito',
                        decisao: ct.decisao ? CQ_DECISAO[ct.decisao.acao]?.sigla : null, lr: ct.lr || null, lk: ct.lk || null };
    });
    const p = _cqResumoPendencia(c);
    if (p) idx.pendentes[c.key] = p;
  });
  const ano = Number(mesAtual.slice(0, 4));
  for (const a of [ano, ano - 1]) {
    const ncs = await window.dbLoad(`${CQ_KEYS.acoes}/${u}/${a}`);
    Object.entries(ncs || {}).forEach(([id, nc]) => {
      if (nc && nc.status !== 'concluida' && nc.status !== 'cancelada') idx.ncAbertas[id] = { numero: nc.numero, testeId: nc.testeId, ano: a, abertaEm: nc.criadoEm };
    });
  }
  const ok = await window.dbUpdate({ [`${CQ_KEYS.indices}/${u}`]: idx });
  showToast(ok ? 'Índices reconstruídos.' : 'Falha ao gravar os índices.', ok ? 'success' : 'error');
}

// Apaga todos os nós do CQ (somente administrador). Antes da exclusão baixa
// uma cópia completa em JSON; se a leitura falhar, nada é apagado.
function cqApagarTudo() {
  if (!_cqIsAdmin()) { showToast('Somente administradores podem apagar os dados do CQ.', 'error'); return; }
  _cqPrompt({
    titulo: 'Apagar dados do Controle de Qualidade', subtitulo: 'Ação irreversível', perigo: true, confirmar: 'Apagar tudo',
    corpo: `<div class="cq-alerta-box">${CQ_ICO.alerta} Todos os dados do CQ de <b>todas as unidades</b> serão removidos do banco. Uma cópia em <code>.json</code> será baixada antes da exclusão.</div>
      <div class="form-field"><label class="field-label">Digite <b>APAGAR</b> para confirmar <span class="required">*</span></label>
        <input type="text" id="cq-apagar-conf" class="field-input" autocomplete="off" placeholder="APAGAR"></div>
      <div class="form-field"><label class="field-label">Sua senha <span class="required">*</span></label>
        <input type="password" id="cq-apagar-pwd" class="field-input" autocomplete="current-password" onkeydown="if(event.key==='Enter')cqPromptConfirmar()"></div>`,
    onConfirm: async () => {
      if (_cqVal('cq-apagar-conf').toUpperCase() !== 'APAGAR') { showToast('Digite APAGAR para confirmar.', 'error'); return false; }
      if (typeof authVerifyCurrentPassword !== 'function' || !authVerifyCurrentPassword(document.getElementById('cq-apagar-pwd')?.value || '')) {
        showToast('Senha incorreta.', 'error'); return false;
      }
      if (!_cqPodeGravar()) return false;

      // dbGet (e não dbLoad, que devolve null tanto para "vazio" quanto para erro)
      const copia = {};
      try {
        const vals = await Promise.all(Object.values(CQ_KEYS).map(k => window.dbGet(k)));
        Object.values(CQ_KEYS).forEach((k, i) => { copia[k] = vals[i]; });
      } catch (err) {
        console.error('[cq.js] cqApagarTudo: falha ao ler os dados para a cópia:', err);
        showToast('Não foi possível ler os dados para a cópia de segurança. Nada foi apagado.', 'error');
        return false;
      }

      const agora = new Date();
      const u = _cqSess();
      const json = JSON.stringify({ _meta: { tipo: 'cq-copia-antes-exclusao', versao: CQ_VERSAO, geradoEm: agora.toISOString(), porId: u.id, porNome: u.nome, estacao: _cqEstacao() || 'não informada' }, ...copia }, null, 2);
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `cq-copia-antes-exclusao-${agora.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      const updates = {};
      Object.values(CQ_KEYS).forEach(k => { updates[k] = null; });
      const ok = await window.dbUpdate(updates);
      if (!ok) { showToast('Falha ao apagar os dados do CQ. Nada foi removido.', 'error'); return false; }
      try { localStorage.removeItem('cq-unidade-ativa'); } catch (e) { /* sem storage */ }
      showToast('Dados do Controle de Qualidade apagados. Cópia baixada.', 'success');
      return true;
    },
  });
}

// Resumo de pendência de uma corrida (null quando todos os testes foram avaliados)
function _cqResumoPendencia(c) {
  const ts = Object.values(c.testes || {}).filter(ct => !ct.naoRealizado);
  const pend = ts.filter(ct => !ct.decisao);
  if (!pend.length) return null;
  return { numero: c.numero || null, mes: c.mes || CQEngine.mesDe(c.key), dataHora: c.dataHora, equipNome: c.ativoSnap?.nome || c.sistemaAnalitico || '',
           nPend: pend.length, temRejeicao: pend.some(ct => ct.avaliacao?.status === 'rejeitado') };
}

function _cqStatusCorrida(c) {
  const ts = Object.values(c.testes || {}).filter(ct => !ct.naoRealizado);
  if (!ts.length) return 'liberada';
  if (ts.some(ct => !ct.decisao)) return 'pendente';
  const acoes = ts.map(ct => ct.decisao.acao);
  if (acoes.every(a => a === 'rejeitado')) return 'rejeitada';
  if (acoes.some(a => a === 'rejeitado')) return 'parcial';
  return 'liberada';
}

// ── ATALHOS USADOS POR OUTROS ARQUIVOS ───────────────────────
function cqAbrirGrafico(testeId) {
  if (typeof cqGraficoSelecionar === 'function') cqGraficoSelecionar(testeId);
  cqNav('graficos');
}
function cqAbrirAlvos(testeId) {
  cqNav('cadastros');
  if (typeof cqTesteForm === 'function') setTimeout(() => cqTesteForm(testeId, 'alvos'), 30);
}
