// ═══════════════════════════════════════════════════════════════
// cq-cadastros.js — Cadastros do Controle de Qualidade — LAMIC
// Analitos, materiais e lotes de controle, reagentes/calibradores (estoque,
// recebimento e abertura de frascos ficam no sistema de estoque), testes
// (estratégia de controle e regras — art. 176 II/III, art. 180 II) e
// alvos versionados (média/DP — CLSI C24, PALC 11.5).
// ═══════════════════════════════════════════════════════════════

let _cqCadTab = 'analitos';
let _cqCadBusca = '';
let _cqTesteFormId = null;
let _cqTesteFormTab = 'config';
let _cqTesteDraft = null;

const CQ_TIPOS_ANALITO = { quantitativo: 'Quantitativo', qualitativo: 'Qualitativo', semiquantitativo: 'Semiquantitativo' };
const CQ_TIPOS_MATERIAL = {
  comercial: 'Controle comercial', fornecido_kit: 'Controle do kit / fabricante', pool_interno: 'Pool interno (alternativo)',
  cepa_referencia: 'Cepa de referência (ATCC / rastreável)', lamina_controle: 'Lâmina controle (coloração)',
};
const CQ_TIPOS_INSUMO = { reagente: 'Reagente', calibrador: 'Calibrador', kit: 'Kit', meio_cultura: 'Meio de cultura', corante: 'Corante / kit de coloração' };
const CQ_FREQ = {
  por_corrida: 'A cada corrida analítica', diaria: 'Diária', por_turno: 'A cada turno', semanal: 'Semanal',
  quinzenal: 'Quinzenal', mensal: 'Mensal', por_lote: 'A cada novo lote ou preparo',
  lote_remessa: 'A cada lote / remessa (uso único)',
};

// Analitos qualitativos usados no controle de meios de cultura e colorações.
// Ponto de partida: o RT revisa as categorias antes do uso (RDC 978, art. 176, III).
const CQ_MODELOS_MICRO = [
  { nome: 'Esterilidade de meio de cultura', codigo: 'MIC-EST',
    escala: ['Sem crescimento', 'Com crescimento (contaminado)'] },
  { nome: 'Desempenho de meio de cultura', codigo: 'MIC-DES',
    escala: ['Crescimento com características esperadas', 'Crescimento com características atípicas', 'Sem crescimento', 'Crescimento inibido', 'Crescimento não inibido'] },
  { nome: 'Coloração de Gram', codigo: 'MIC-GRAM',
    escala: ['Gram-positivo (roxo)', 'Gram-negativo (rosa/vermelho)', 'Coloração inadequada'] },
  { nome: 'Coloração de Ziehl-Neelsen (BAAR)', codigo: 'MIC-BAAR',
    escala: ['BAAR presentes (bacilos vermelhos)', 'BAAR ausentes', 'Coloração inadequada'] },
];
// Monitoramento da esterilização a vapor (RDC 1002/2025, arts. 88-90; bulas dos indicadores).
// Integrador tipo 5/6 em todo ciclo; indicador biológico semanal (ampola teste = negativo, ampola controle = positivo).
const CQ_MODELOS_ESTER = [
  { nome: 'Integrador químico tipo 5 (vapor)', codigo: 'EST-IQ5',
    escala: ['Viragem completa (aprovado)', 'Viragem incompleta ou ausente (reprovado)'] },
  { nome: 'Indicador biológico (G. stearothermophilus)', codigo: 'EST-IB',
    escala: ['Negativo (sem crescimento, meio púrpura)', 'Positivo (crescimento, meio amarelo)'] },
  { nome: 'Teste de Bowie & Dick', codigo: 'EST-BD',
    escala: ['Mudança de cor uniforme (aprovado)', 'Mudança de cor não uniforme (reprovado)'] },
];
const CQ_MODELOS = {
  micro: { lista: CQ_MODELOS_MICRO, titulo: 'Modelos de microbiologia', sub: 'Controle de meios de cultura e colorações', esp: 'Microbiologia', nomeCurto: 'microbiologia' },
  ester: { lista: CQ_MODELOS_ESTER, titulo: 'Modelos de esterilização', sub: 'Indicadores químico e biológico da autoclave', esp: 'Outros', nomeCurto: 'esterilização' },
};
const CQ_ORIGEM_ALVO = {
  fabricante: { label: 'Fabricante (bula)', cls: 'cq-st-alerta' },
  provisorio: { label: 'Provisório (laboratório)', cls: 'cq-st-alerta' },
  estabelecido: { label: 'Estabelecido (laboratório)', cls: 'cq-st-aceito' },
  cumulativo: { label: 'Cumulativo', cls: 'cq-st-aceito' },
};
const CQ_ESPECIALIDADES = ['Bioquímica', 'Hematologia', 'Coagulação', 'Imunologia', 'Hormônios', 'Urinálise', 'Gasometria', 'Microbiologia', 'Parasitologia', 'Biologia molecular', 'Toxicologia', 'Outros'];

let _cqCadEquips = [];            // filtro de equipamentos/sistemas da aba Analitos e testes ('a:…' | 'm:…')
let _cqCadAnalitos = [];          // filtro de analitos (ids), com busca por código ou nome
let _cqCadPend = false;           // só analitos com pendência
let _cqCadSit = ['em_uso'];
let _cqCadAtivo = 'ativos';       // ativos | inativos | todos (as três abas)       // situação dos lotes nas abas Controles/Materiais e Reagentes (vazio = todas)
const _cqCadExp = new Map();      // analitoId → expandido (sem entrada: segue o filtro)

function cqRenderCadastros(body) {
  // Ordem: analito (equipamentos/sistemas e seus testes) → materiais e lotes → reagentes. O teste é criado dentro do analito.
  const tabs = { analitos: 'Analitos e testes', materiais: 'Controles/Materiais', insumos: 'Reagentes, meios e insumos' };
  if (!tabs[_cqCadTab]) _cqCadTab = 'analitos';
  _cqCadBusca = '';   // as abas usam os filtros de analito, equipamento, situação e ativos no lugar da busca
  const cfg = cqState.config;
  const uAt = _cqUnidadeAtivaId();
  const qtd = { analitos: _cqDaUnidade('analitos', uAt).length, materiais: _cqDaUnidade('materiais', uAt).length,
                insumos: _cqDaUnidade('insumoProdutos', uAt).length + _cqDaUnidade('insumos', uAt).filter(i => !_cqProdutoInsumo(i)).length };
  const podeCfg = _cqCan('configurar');
  const nSemUn = CQ_COLECOES_UNIDADE.reduce((n, c) => n + Object.values(cfg[c] || {}).filter(_cqSemUnidade).length, 0);
  const novo = {
    analitos: podeCfg ? `<button class="btn btn-outline btn-sm" onclick="cqModelosMicro()" title="Cria analitos qualitativos para meios de cultura e colorações">${CQ_ICO.beaker} Modelos de microbiologia</button>
      <button class="btn btn-outline btn-sm" onclick="cqModelosMicro('ester')" title="Cria analitos qualitativos para o integrador químico, o indicador biológico e o Bowie &amp; Dick da autoclave">${CQ_ICO.beaker} Modelos de esterilização</button>
      <button class="btn btn-primary btn-sm" onclick="cqAnalitoForm(null)">${CQ_ICO.plus} Novo analito</button>` : '',
    materiais: podeCfg ? `<button class="btn btn-outline btn-sm" onclick="cqLoteForm(null)">${CQ_ICO.plus} Novo lote</button>
      <button class="btn btn-primary btn-sm" onclick="cqMaterialForm(null)">${CQ_ICO.plus} Novo material / cepa</button>` : '',
    insumos: podeCfg ? `${_cqInsumosLegados().length ? `<button class="btn btn-outline btn-sm" onclick="cqInsumosOrganizar()" title="Lotes cadastrados antes da separação entre produto e lote">${CQ_ICO.alerta} Organizar ${_cqInsumosLegados().length} lote(s) antigo(s)</button>` : ''}
      <button class="btn btn-outline btn-sm" onclick="cqInsumoForm(null)">${CQ_ICO.plus} Novo lote</button>
      <button class="btn btn-primary btn-sm" onclick="cqInsumoProdutoForm(null)">${CQ_ICO.plus} Novo produto</button>` : '',
  }[_cqCadTab];
  // Filtros de analito e de equipamento/sistema (as três abas; a seleção vale ao trocar de aba).
  // Um restringe o outro: só aparecem os analitos dos equipamentos marcados e vice-versa.
  const opsAn = _cqCadOpsAnalitos(uAt, _cqCadEquips);
  _cqCadAnalitos = _cqCadAnalitos.filter(id => opsAn.some(o => o.value === id));
  const ops = _cqCadOpsEquips(uAt, _cqCadAnalitos);
  const validos = new Set(ops.map(o => _cqEquipChave(o.value)));
  _cqCadEquips = _cqCadEquips.filter(v => validos.has(_cqEquipChave(v)));
  let filtros = `<div class="cq-cad-equip cq-cad-an">${_cqMultiHTML('cq-cad-an', opsAn, _cqCadAnalitos, { placeholder: 'Todos os analitos', resumo: 'analitos',
      onchange: v => { _cqCadAnalitos = v; _cqCadFiltrosCruzar('an'); }, vazio: 'Nenhum analito vinculado aos equipamentos e sistemas marcados.' })}</div>
    <div class="cq-cad-equip">${_cqMultiHTML('cq-cad-equip', ops, _cqCadEquips, { placeholder: 'Todos os equipamentos e sistemas', resumo: 'equipamentos / sistemas',
      onchange: v => { _cqCadEquips = v; _cqCadFiltrosCruzar('equip'); }, vazio: 'Nenhum equipamento ou sistema vinculado aos analitos marcados.' })}</div>`;
  // Ativos / Inativos / Todos, com a contagem da aba
  const colAtivo = { analitos: 'analitos', materiais: 'materiais', insumos: 'insumoProdutos' }[_cqCadTab];
  const recsAtivo = _cqDaUnidade(colAtivo, uAt);
  const nInat = recsAtivo.filter(r => r.ativo === false).length + (_cqCadTab === 'analitos' ? _cqTestesDaUnidade(uAt, { incluirInativos: true }).filter(t => t.ativo === false && _cqAnalito(t.analitoId)?.ativo !== false).length : 0);
  const segAtivo = [['ativos', 'Ativos', recsAtivo.length - recsAtivo.filter(r => r.ativo === false).length], ['inativos', 'Inativos', nInat], ['todos', 'Todos', null]];
  filtros = `<div class="cq-seg cq-cad-ativo" role="group" aria-label="Ativos ou inativos">${segAtivo.map(([k, l, n]) => `<button type="button" class="${_cqCadAtivo === k ? 'active' : ''}" onclick="cqCadAtivo('${k}')">${k === 'inativos' ? CQ_ICO.pause : k === 'ativos' ? CQ_ICO.play : ''}${l}${n !== null ? ` <span class="cq-seg-n">${n}</span>` : ''}</button>`).join('')}</div>` + filtros;
  if (_cqCadTab === 'analitos') {
    filtros += `<button type="button" class="cq-filtro-chip${_cqCadPend ? ' on' : ''}" onclick="cqCadPendToggle()" title="Testes sem lote, sem alvo ou sem resultado esperado, e analitos sem teste">${CQ_ICO.alerta} Só com pendência</button>`;
  } else {
    const ops = Object.entries(CQ_SITUACAO_FILTRO).map(([k, l]) => ({ value: k, label: l, sub: k === 'vencido' ? 'Validade expirada (encerrados automaticamente ou não)' : k === 'encerrado' ? 'Inclui os vencidos, encerrados automaticamente' : '' }));
    filtros += `<div class="cq-cad-sit" title="Situação dos lotes exibidos"><span>Situação</span><div class="cq-cad-equip">${_cqMultiHTML('cq-cad-sit', ops, _cqCadSit, { placeholder: 'Todas',
        onchange: v => { _cqCadSit = v; _cqCadRenderLista(); } })}</div></div>`;
  }
  body.innerHTML = `
  <div class="cq-cad">
    <div class="ot-modal-tabs cq-subtabs">${Object.entries(tabs).map(([k, l], i) => `<button class="ot-modal-tab-btn${k === _cqCadTab ? ' active' : ''}" onclick="cqCadTab('${k}')"><span class="cq-step${qtd[k] ? ' feito' : ''}">${i + 1}</span>${l}${qtd[k] ? `<span class="cq-step-qtd">${qtd[k]}</span>` : ''}</button>`).join('')}</div>
    <div class="cq-toolbar cq-toolbar-wrap">
      ${filtros}
      <div class="cq-spacer"></div>${podeCfg && nSemUn ? `<button class="btn btn-outline btn-sm" onclick="cqAssociarSemUnidade()" title="Cadastros antigos sem unidade aparecem em todas as unidades">${CQ_ICO.unidade} Associar ${nSemUn} cadastro(s) sem unidade</button>` : ''}${novo}
    </div>
    <div id="cq-cad-lista"></div>
  </div>`;
  _cqCadRenderLista();
}

function cqCadTab(t) { _cqCadTab = t; _cqCadBusca = ''; _cqCadExp.clear(); cqRender(); }
function cqCadAtivo(v) { _cqCadAtivo = v; _cqCadExp.clear(); cqRender(); }
// Material / produto conforme o filtro Ativos / Inativos / Todos
function _cqCadAtivoBate(r) { return _cqCadAtivo === 'todos' || (_cqCadAtivo === 'inativos') === (r?.ativo === false); }
function cqCadPendToggle() { _cqCadPend = !_cqCadPend; _cqCadExp.clear(); cqRender(); }
// Atalho do painel: lista já filtrada pelas pendências
function cqCadPendencias() { _cqCadTab = 'analitos'; _cqCadPend = true; _cqCadBusca = ''; _cqCadEquips = []; _cqCadAnalitos = []; _cqCadExp.clear(); cqNav('cadastros'); }
function cqCadExpandir(id, aberto) { _cqCadExp.set(id, !aberto); _cqCadRenderLista(); }
// Grupos (analito / material / produto) recolhidos por padrão; a busca por texto e "Só com pendência" os abrem
let _cqCadIdsLista = [];
function _cqCadAbertoPadrao() { return !!_cqCadBusca.trim() || (_cqCadTab === 'analitos' && _cqCadPend); }
function _cqCadAberto(id) { return _cqCadExp.has(id) ? _cqCadExp.get(id) : _cqCadAbertoPadrao(); }
function cqCadExpandirTodos(abrir) { _cqCadIdsLista.forEach(id => _cqCadExp.set(id, abrir)); _cqCadRenderLista(); }
// Cabeçalho da coluna da seta: expande ou recolhe todos os grupos da lista
function _cqCadThExpandir(ids) {
  _cqCadIdsLista = ids;
  const todos = ids.length && ids.every(_cqCadAberto);
  return `<th class="ot-list-th" style="width:34px;">${ids.length ? `<button type="button" class="cq-icobtn cq-an-exp${todos ? ' aberto' : ''}" title="${todos ? 'Recolher todos' : 'Expandir todos'}" onclick="cqCadExpandirTodos(${!todos})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="9 6 15 12 9 18"/></svg></button>` : ''}</th>`;
}

// Analito × equipamento/sistema da unidade: vínculo do cadastro do analito ou de um teste dele
function _cqCadAnalitoNoEquip(a, chaves, testesU) {
  return _cqEquipsDoAnalito(a).some(o => chaves.has(_cqEquipChave(o.value)))
    || testesU.some(t => t.analitoId === a.id && chaves.has(_cqEquipChave(_cqEquipDoTeste(t))));
}
// Opções do filtro de analitos: todos os da unidade ou só os dos equipamentos/sistemas marcados
function _cqCadOpsAnalitos(u, equipsSel) {
  const chaves = new Set(_cqArr(equipsSel).map(_cqEquipChave));
  const testesU = chaves.size ? _cqTestesDaUnidade(u, { incluirInativos: true }) : [];
  return _cqDaUnidade('analitos', u).filter(a => !chaves.size || _cqCadAnalitoNoEquip(a, chaves, testesU))
    .sort((a, b) => (a.especialidade || '').localeCompare(b.especialidade || '') || (a.nome || '').localeCompare(b.nome || ''))
    .map(a => ({ value: a.id, label: a.codigo ? `${a.codigo} — ${a.nome}` : a.nome, sub: a.tipo && a.tipo !== 'quantitativo' ? CQ_TIPOS_ANALITO[a.tipo] : (a.unidadeMedida || ''), grupo: a.especialidade || 'Sem especialidade' }));
}
// Opções do filtro de equipamentos/sistemas: todos ou só os dos analitos marcados
function _cqCadOpsEquips(u, anSel) {
  const ops = _cqCadOpcoesEquip(u);
  const ids = new Set(_cqArr(anSel));
  if (!ids.size) return ops;
  const testesU = _cqTestesDaUnidade(u, { incluirInativos: true });
  return ops.filter(o => {
    const k = new Set([_cqEquipChave(o.value)]);
    return [...ids].some(id => { const a = _cqAnalito(id); return a && _cqCadAnalitoNoEquip(a, k, testesU); });
  });
}
// Depois de mudar um dos filtros, refaz as opções do outro (descartando marcações que deixaram de valer)
function _cqCadFiltrosCruzar(origem) {
  const u = _cqUnidadeAtivaId();
  if (origem === 'an') { _cqMultiOpcoes('cq-cad-equip', _cqCadOpsEquips(u, _cqCadAnalitos)); _cqCadEquips = _cqMultiVal('cq-cad-equip'); }
  else { _cqMultiOpcoes('cq-cad-an', _cqCadOpsAnalitos(u, _cqCadEquips)); _cqCadAnalitos = _cqMultiVal('cq-cad-an'); }
  _cqCadExp.clear();
  _cqCadRenderLista();
}

// Filtro das abas Controles/Materiais e Reagentes: o material ou produto aparece quando serve a algum
// analito e a algum equipamento/sistema selecionado. Sem analitos no cadastro = serve a todos; sem
// equipamentos = serve aos equipamentos dos analitos dele (ou a qualquer um, se também não tiver analitos).
function _cqCadFiltroServe(rec, equips) {
  const ans = _cqArr(rec?.analitoIds);
  if (_cqCadAnalitos.length && ans.length && !ans.some(a => _cqCadAnalitos.includes(a))) return false;
  if (!_cqCadEquips.length) return true;
  const sel = new Set(_cqCadEquips.map(_cqEquipChave));
  const eqs = _cqArr(equips);
  if (eqs.length) return eqs.some(k => sel.has(_cqEquipChave(k)));
  if (!ans.length) return true;
  return ans.some(a => _cqEquipsDoAnalito(_cqAnalito(a)).some(o => sel.has(_cqEquipChave(o.value))));
}

// Opções do filtro: equipamentos (respeitando os setores da unidade) e sistemas sem equipamento dos analitos e testes da unidade
function _cqCadOpcoesEquip(u) {
  const SIS = 'Sistemas sem equipamento (bancada / manual)';
  const mapa = new Map();
  const add = o => { const k = _cqEquipChave(o.value); if (!mapa.has(k)) mapa.set(k, o); };
  _cqEquipsTodos(u).forEach(o => {
    const sis = o.value.startsWith('m:');
    add({ value: o.value, label: sis ? o.label : (o.ativo?.nome || o.label), sub: sis ? 'Sistema analítico sem equipamento' : [o.ativo?.codigo, o.ativo?.modelo].filter(Boolean).join(' · '),
          grupo: sis ? SIS : (o.ativo?.setor || o.grupo || 'Equipamentos') });
  });
  _cqTestesDaUnidade(u, { incluirInativos: true }).forEach(t => {
    const v = _cqEquipDoTeste(t), sis = v.startsWith('m:');
    add({ value: v, label: _cqEquipTeste(t), sub: sis ? 'Sistema analítico sem equipamento' : 'Equipamento de teste', grupo: sis ? SIS : 'Outros equipamentos' });
  });
  const ordem = o => (o.grupo === SIS ? '1' : '0') + o.grupo;
  return [...mapa.values()].sort((a, b) => ordem(a).localeCompare(ordem(b)) || a.label.localeCompare(b.label));
}

// Pendências de um teste ativo: nível sem lote, sem alvo (quantitativo) ou sem resultado esperado (qualitativo)
function _cqPendenciasTeste(t) {
  const p = [];
  if (t.ativo === false) return p;
  const qual = _cqTesteQual(t);
  _cqNiveisTeste(t).forEach(n => {
    if (qual) {
      if (!_cqControleQual(t, n)?.esperado) p.push(`N${n} sem esperado`);
      if (!_cqNivelSemMaterial(t, n) && !_cqLoteDoNivel(t, n)) p.push(`N${n} sem lote`);
      else if (_cqLoteDoNivel(t, n)?.status === 'encerrado') p.push(`N${n} lote encerrado`);
      return;
    }
    const lid = t.lotesAtivos?.[n];
    if (_cqLoteDoNivel(t, n)?.status === 'encerrado') p.push(`N${n} lote encerrado`);
    if (!lid) p.push(`N${n} sem lote`);
    else if (!_cqAlvoVigente(t.id, lid, n)) p.push(`N${n} sem alvo`);
  });
  return p;
}

// Linha de um teste (lista do analito e aba Testes do analito)
function _cqTesteLinhaHTML(t) {
  const niveis = _cqNiveisTeste(t);
  const qual = _cqTesteQual(t);
  const an = _cqAnalito(t.analitoId);
  const lotes = niveis.map(n => {
    const rot = qual ? _cqEsc(_cqRotuloNivel(t, n)) : `N${n}`;
    if (qual && _cqNivelSemMaterial(t, n)) return `${rot}: sem material`;
    const l = _cqLoteDoNivel(t, n);
    return `${rot}: ${l ? _cqEsc(l.lote) : '<span class="cq-txt-vermelho">sem lote</span>'}`;
  }).join(' · ');
  const criterio = qual
    ? niveis.map(n => { const e = _cqControleQual(t, n)?.esperado; return e ? `<div style="font-size:11.5px;">N${n}: ${_cqEsc(e)}</div>` : `<span class="cq-badge cq-st-rejeitado">N${n} sem esperado</span>`; }).join('')
    : niveis.map(n => { const lid = t.lotesAtivos?.[n]; const a = lid ? _cqAlvoVigente(t.id, lid, n) : null;
        return a ? `<span class="cq-badge ${CQ_ORIGEM_ALVO[a.origem]?.cls || ''}" title="${_cqEsc(CQ_ORIGEM_ALVO[a.origem]?.label || '')}">N${n}</span>` : `<span class="cq-badge cq-st-rejeitado">N${n} sem alvo</span>`; }).join(' ');
  const regras = qual ? (an?.tipo === 'semiquantitativo' ? 'Concordância (±1 categoria = alerta)' : 'Concordância com o esperado')
    : `${_cqEsc(CQEngine.PRESETS[t.regrasPreset]?.label || 'Personalizado')}<div class="cq-muted">${_cqResumoRegras(t.regras)}</div>`;
  return `<tr class="ot-list-row${t.ativo === false ? ' oc-row-final' : ''}" onclick="cqTesteForm('${t.id}')">
    <td><b>${_cqEsc(_cqEquipTeste(t))}</b>${t.ativo === false ? ' <span class="cq-badge cq-st-semalvo">inativo</span>' : ''}</td>
    <td>${_cqEsc(t.metodo || '—')}</td><td style="font-size:12px;">${lotes || '—'}</td>
    <td style="font-size:12px;">${regras}</td><td style="font-size:12px;">${_cqEsc(CQ_FREQ[t.frequencia?.tipo] || '—')}</td><td>${criterio}</td></tr>`;
}
function _cqTestesTabelaHTML(a, ts) {
  const pode = _cqCan('configurar');
  const qual = a.tipo && a.tipo !== 'quantitativo';
  return `<div class="oc-table-scroll"><table class="ot-list-table cq-table cq-table-sm cq-an-testes-tbl">
      <thead><tr><th class="ot-list-th">Equipamento / sistema</th><th class="ot-list-th">${qual ? 'Meio / insumo' : 'Método'}</th><th class="ot-list-th">Níveis e lotes</th><th class="ot-list-th">${qual ? 'Critério' : 'Regras'}</th><th class="ot-list-th">Frequência</th><th class="ot-list-th">${qual ? 'Esperado' : 'Alvos'}</th></tr></thead>
      <tbody>${ts.length ? ts.map(_cqTesteLinhaHTML).join('') : '<tr><td colspan="6" class="cq-td-vazio">Nenhum teste deste analito nesta unidade.</td></tr>'}</tbody></table></div>
    ${pode ? `<button class="btn btn-outline btn-sm cq-an-novo-teste" onclick="event.stopPropagation();cqTesteForm(null,null,{analitoId:'${a.id}'})" ${_cqEquipsDoAnalito(a).length ? '' : 'disabled title="Vincule antes um equipamento ou sistema ao analito"'}>${CQ_ICO.plus} Novo teste de ${_cqEsc(a.nome)}</button>` : ''}`;
}

// Lista resumida dos testes (aba Testes do analito, dentro da janela lateral): uma linha por teste, sem tabela
function _cqTestesCompactoHTML(a, ts) {
  const pode = _cqCan('configurar');
  const itens = ts.map(t => {
    const qual = _cqTesteQual(t);
    const pend = _cqPendenciasTeste(t);
    const lotes = _cqNiveisTeste(t).map(n => {
      if (qual && _cqNivelSemMaterial(t, n)) return null;
      const l = _cqLoteDoNivel(t, n);
      return l ? l.lote : null;
    }).filter(Boolean);
    const sub = [t.metodo ? _cqEquipTeste(t) : '', `${_cqNiveisTeste(t).length} nível(is)`, lotes.length ? `lote ${[...new Set(lotes)].join(', ')}` : ''].filter(Boolean).join(' · ');
    const st = t.ativo === false ? '<span class="cq-badge cq-st-semalvo">inativo</span>'
      : pend.length ? `<span class="cq-badge cq-st-alerta" title="${_cqEsc(pend.join('; '))}">${pend.length} pendência(s)</span>`
      : '<span class="cq-badge cq-st-aceito">ok</span>';
    return `<div class="cq-te-item${t.ativo === false ? ' inativo' : ''}" onclick="cqTesteForm('${t.id}')" title="Abrir teste">
      <div class="cq-te-item-txt"><b>${_cqEsc(t.metodo || _cqEquipTeste(t))}</b><small>${_cqEsc(sub)}</small></div>${st}
      <svg class="cq-te-item-seta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="9 6 15 12 9 18"/></svg></div>`;
  }).join('');
  return `<div class="cq-te-lista">${itens || '<div class="cq-ms-vazio">Nenhum teste deste analito nesta unidade.</div>'}</div>
    ${pode ? `<button class="btn btn-outline btn-sm cq-an-novo-teste" onclick="cqTesteForm(null,null,{analitoId:'${a.id}'})" ${_cqEquipsDoAnalito(a).length ? '' : 'disabled'}>${CQ_ICO.plus} Novo teste</button>` : ''}`;
}

function _cqCadRenderLista() {
  const el = document.getElementById('cq-cad-lista');
  if (!el) return;
  const q = _cqCadBusca.toLowerCase().trim();
  const bate = txt => !q || String(txt).toLowerCase().includes(q);
  const u = _cqUnidadeAtivaId();
  const hoje = _cqHoje();

  if (_cqCadTab === 'analitos') {
    const testesU = _cqTestesDaUnidade(u, { incluirInativos: true })
      .sort((a, b) => _cqEquipTeste(a).localeCompare(_cqEquipTeste(b)) || (a.metodo || '').localeCompare(b.metodo || ''));
    const chaves = new Set(_cqCadEquips.map(_cqEquipChave));
    const anSel = new Set(_cqCadAnalitos);
    const filtrando = !!q || chaves.size > 0 || anSel.size > 0 || _cqCadPend || _cqCadAtivo === 'inativos';
    const txtTeste = t => `${_cqEquipTeste(t)} ${t.metodo || ''} ${_cqNiveisTeste(t).map(n => _cqLoteDoNivel(t, n)?.lote || '').join(' ')}`;
    const linhas = [];
    _cqDaUnidade('analitos', u).sort((a, b) => (a.nome || '').localeCompare(b.nome || '')).forEach(a => {
      if (anSel.size && !anSel.has(a.id)) return;
      const todos = testesU.filter(t => t.analitoId === a.id);
      let ts = todos;
      // Ativos: analito ativo e só os testes ativos. Inativos: analito inativo (com os testes) ou os testes inativos de um analito ativo
      if (_cqCadAtivo === 'ativos') { if (a.ativo === false) return; ts = ts.filter(t => t.ativo !== false); }
      else if (_cqCadAtivo === 'inativos' && a.ativo !== false) { ts = ts.filter(t => t.ativo === false); if (!ts.length) return; }
      if (chaves.size) {
        ts = ts.filter(t => chaves.has(_cqEquipChave(_cqEquipDoTeste(t))));
        if (!ts.length && !_cqEquipsDoAnalito(a).some(o => chaves.has(_cqEquipChave(o.value)))) return;
      }
      if (q && !bate(`${a.codigo || ''} ${a.nome} ${a.especialidade || ''}`)) { ts = ts.filter(t => bate(txtTeste(t))); if (!ts.length) return; }
      const semTeste = !todos.length && a.ativo !== false;
      const comPend = ts.map(t => ({ t, p: _cqPendenciasTeste(t) }));
      const nPend = comPend.reduce((n, x) => n + x.p.length, 0);
      if (_cqCadPend) { if (!nPend && !semTeste) return; ts = comPend.filter(x => x.p.length).map(x => x.t); }
      linhas.push({ a, ts, nTotal: todos.length, nPend, semTeste });
    });
    const chev = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="9 6 15 12 9 18"/></svg>`;
    el.innerHTML = `<div class="oc-table-scroll"><table class="ot-list-table cq-table cq-an-tbl">
      <thead><tr>${_cqCadThExpandir(linhas.map(x => x.a.id))}<th class="ot-list-th">Código</th><th class="ot-list-th">Analito</th><th class="ot-list-th">Unidade</th><th class="ot-list-th">Tipo</th><th class="ot-list-th">Especialidade</th><th class="ot-list-th">Equipamentos / sistemas</th><th class="ot-list-th">ETa / resultados</th><th class="ot-list-th">Testes</th></tr></thead>
      <tbody>${linhas.length ? linhas.map(({ a, ts, nTotal, nPend, semTeste }) => {
        const aberto = _cqCadAberto(a.id);
        const qual = a.tipo && a.tipo !== 'quantitativo';
        return `<tr class="ot-list-row${a.ativo === false ? ' oc-row-final' : ''}${aberto ? ' cq-an-aberto' : ''}" onclick="cqAnalitoForm('${a.id}')">
          <td><button type="button" class="cq-icobtn cq-an-exp${aberto ? ' aberto' : ''}" title="${aberto ? 'Ocultar' : 'Mostrar'} testes" onclick="event.stopPropagation();cqCadExpandir('${a.id}',${aberto})">${chev}</button></td>
          <td class="oc-num">${_cqEsc(a.codigo || '—')}</td><td><b>${_cqEsc(a.nome)}</b>${_cqUnidadesTag(a)}</td><td>${_cqEsc(a.unidadeMedida || '—')}</td>
          <td>${_cqEsc(CQ_TIPOS_ANALITO[a.tipo] || a.tipo || CQ_TIPOS_ANALITO.quantitativo)}</td><td>${_cqEsc(a.especialidade || '—')}</td>
          <td style="font-size:12px;max-width:240px;">${_cqEquipsDoAnalito(a).length ? _cqEsc(_cqEquipsDoAnalito(a).map(o => o.label).join(', ')) : '<span class="cq-txt-amarelo">nenhum — vincule para criar testes</span>'}</td>
          <td style="font-size:12px;">${qual ? `${_cqArr(a.escala).length} resultados possíveis`
            : a.eta?.valor ? `<span title="${_cqEsc(a.eta.fonte || '')}">${_cqNum(Number(a.eta.valor), 1)}${a.eta.tipo === 'abs' ? ' ' + _cqEsc(a.unidadeMedida) : '%'}</span>` : '<span class="cq-txt-amarelo">ETa não definido</span>'}</td>
          <td style="white-space:nowrap;">${nTotal ? `<span class="cq-an-nteste">${nTotal}</span>` : ''}${nPend ? ` <span class="cq-badge cq-st-alerta" title="Níveis sem lote, sem alvo ou sem esperado">${nPend} pendência(s)</span>` : ''}${semTeste ? '<span class="cq-badge cq-st-semalvo">sem teste</span>' : ''}</td></tr>
        ${aberto ? `<tr class="cq-an-testes"><td></td><td colspan="8">${_cqTestesTabelaHTML(a, ts)}</td></tr>` : ''}`;
      }).join('') : `<tr><td colspan="9" class="cq-td-vazio">${filtrando ? 'Nenhum analito ou teste corresponde aos filtros.' : 'Nenhum analito nesta unidade.'}</td></tr>`}</tbody>
    </table></div>`;
    return;
  }

  const chev = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="9 6 15 12 9 18"/></svg>`;
  const sit = _cqCadSit;
  const podeCfg = _cqCan('configurar');
  // Linha do grupo (material / produto) com a seta que mostra os lotes; recolhida por padrão
  const grupoTr = (id, cls, onclick, celulas) => {
    const aberto = _cqCadAberto(id);
    return { aberto, html: `<tr class="ot-list-row${cls}${aberto ? ' cq-an-aberto' : ''}" onclick="${onclick}">
      <td><button type="button" class="cq-icobtn cq-an-exp${aberto ? ' aberto' : ''}" title="${aberto ? 'Ocultar' : 'Mostrar'} lotes" onclick="event.stopPropagation();cqCadExpandir('${id}',${aberto})">${chev}</button></td>${celulas}</tr>` };
  };
  const nLotesHTML = (ls, total) => {
    if (!total) return '<span class="cq-badge cq-st-semalvo">sem lote</span>';
    const venc = ls.filter(l => _cqLoteVencidoAberto(l, hoje)).length;
    return `<span class="cq-an-nteste" title="${ls.length} de ${total} lote(s) na situação filtrada">${ls.length}</span>${total > ls.length ? `<span class="cq-muted"> / ${total}</span>` : ''}${venc ? ` <span class="cq-badge cq-st-rejeitado">${venc} vencido(s)</span>` : ''}`;
  };
  const filtroAnEq = _cqCadAnalitos.length > 0 || _cqCadEquips.length > 0;
  const vazioSit = sit.length ? ` na situação ${sit.map(k => CQ_SITUACAO_FILTRO[k]).join(' / ').toLowerCase()}` : '';
  const vazioLotes = (total, cols = 5) => `<tr><td colspan="${cols}" class="cq-td-vazio">${total ? `Nenhum lote${vazioSit}.` : 'Nenhum lote cadastrado.'}</td></tr>`;
  const equipsAnalitosHTML = (eqs, ans) => `${eqs.length ? `<b>${_cqEsc(eqs.map(_cqRotuloEquip).join(', '))}</b>` : '<span class="cq-muted">Qualquer equipamento</span>'}<br>${_cqArr(ans).length ? _cqEsc(_cqArr(ans).map(a => _cqAnalito(a)?.nome || '?').join(', ')) : '<span class="cq-muted">Todos os analitos</span>'}`;

  if (_cqCadTab === 'materiais') {
    // Testes da unidade com o lote em uso (abre a aba "Uso nos testes" do lote)
    const usoTxt = l => {
      const ts = _cqTestesDaUnidade(u).filter(t => Object.values(t.lotesAtivos || {}).includes(l.id));
      return ts.length ? `<a href="#" onclick="event.preventDefault();event.stopPropagation();cqLoteForm('${l.id}',{aba:'uso'})" title="${_cqEsc(ts.map(t => `${_cqNomeTeste(t)} · ${_cqEquipTeste(t)}`).join('; '))}">${ts.length} teste(s)</a>` : '<span class="cq-muted">—</span>';
    };
    const todosLotes = _cqDaUnidade('lotesControle', u);
    const linhas = [];
    _cqDaUnidade('materiais', u).sort((a, b) => (a.nome || '').localeCompare(b.nome || '')).forEach(m => {
      if (!_cqCadAtivoBate(m) || !_cqCadFiltroServe(m, m.equips)) return;
      const todos = todosLotes.filter(l => l.materialId === m.id).sort((a, b) => (b.validade || '').localeCompare(a.validade || ''));
      let ls = todos.filter(l => _cqLoteNaSituacao(l, sit, hoje));
      if (!bate(`${m.nome} ${m.fabricante || ''} ${m.codigoReferencia || ''} ${m.matriz || ''}`)) { ls = ls.filter(l => bate(l.lote)); if (!ls.length) return; }
      // Some o material cujos lotes estão todos fora da situação filtrada; o sem lote fica (pendência), se ativo
      if (!ls.length && todos.length && _cqCadAtivo !== 'inativos') return;
      linhas.push({ m, ls, total: todos.length });
    });
    el.innerHTML = `<div class="oc-table-scroll"><table class="ot-list-table cq-table cq-an-tbl">
      <thead><tr>${_cqCadThExpandir(linhas.map(x => x.m.id))}<th class="ot-list-th">Material</th><th class="ot-list-th">Fabricante</th><th class="ot-list-th">Tipo</th><th class="ot-list-th">Matriz</th><th class="ot-list-th">Níveis</th><th class="ot-list-th">Equipamentos / analitos</th><th class="ot-list-th">Lotes</th></tr></thead>
      <tbody>${linhas.length ? linhas.map(({ m, ls, total }) => {
        const g = grupoTr(m.id, m.ativo === false ? ' oc-row-final' : '', `cqMaterialForm('${m.id}')`, `
          <td><b>${_cqEsc(m.nome)}</b>${_cqUnidadesTag(m)}${m.ativo === false ? ' <span class="cq-badge cq-st-semalvo">inativo</span>' : ''}${m.codigoReferencia ? `<div class="cq-muted">${_cqEsc(m.codigoReferencia)}</div>` : ''}</td>
          <td>${_cqEsc(m.fabricante || '—')}${m.regAnvisa ? `<div class="cq-muted">ANVISA ${_cqEsc(m.regAnvisa)}</div>` : ''}</td><td>${_cqEsc(CQ_TIPOS_MATERIAL[m.tipo] || m.tipo)}</td><td>${_cqEsc(m.matriz || '—')}</td>
          <td>${Object.entries(m.niveis || {}).map(([n, x]) => `N${n}${x?.nome ? ' ' + _cqEsc(x.nome) : ''}`).join(', ')}</td>
          <td style="font-size:12px;max-width:260px;">${equipsAnalitosHTML(_cqArr(m.equips), m.analitoIds)}</td>
          <td style="white-space:nowrap;">${nLotesHTML(ls, total)}</td>`);
        return g.html + (g.aberto ? `<tr class="cq-an-testes"><td></td><td colspan="7">
          <div class="oc-table-scroll"><table class="ot-list-table cq-table cq-table-sm cq-an-testes-tbl">
            <thead><tr><th class="ot-list-th">Lote</th><th class="ot-list-th">Níveis</th><th class="ot-list-th">Validade</th><th class="ot-list-th">Em uso em</th><th class="ot-list-th">Observações</th><th class="ot-list-th">Situação</th></tr></thead>
            <tbody>${ls.length ? ls.map(l => `<tr class="ot-list-row" onclick="cqLoteForm('${l.id}')"><td class="oc-num" style="font-size:12.5px;">${_cqEsc(l.lote)}${_cqUnidadesTag(l)}</td>
              <td>${_cqArr(l.niveis).map(n => 'N' + n).join(', ')}</td><td class="${_cqLoteVencido(l, hoje) ? 'oc-vencido' : ''}">${_cqFmtData(l.validade)}</td>
              <td style="font-size:12px;">${usoTxt(l)}</td>
              <td style="font-size:12px;max-width:300px;">${_cqEsc(l.observacoes || '—')}</td><td>${_cqLoteSituacaoBadge(l, hoje)}</td></tr>`).join('') : vazioLotes(total, 6)}</tbody></table></div>
          ${podeCfg ? `<button class="btn btn-outline btn-sm cq-an-novo-teste" onclick="event.stopPropagation();cqLoteForm(null,{materialId:'${m.id}'})">${CQ_ICO.plus} Novo lote de ${_cqEsc(m.nome)}</button>` : ''}</td></tr>` : '');
      }).join('') : `<tr><td colspan="8" class="cq-td-vazio">${q || filtroAnEq ? 'Nenhum material ou lote corresponde aos filtros.' : `Nenhum material com lote${vazioSit} nesta unidade.`}</td></tr>`}</tbody>
    </table></div>`;
    return;
  }

  if (_cqCadTab === 'insumos') {
    const lotesU = _cqDaUnidade('insumos', u);
    const prods = new Map(_cqDaUnidade('insumoProdutos', u).map(p => [p.id, p]));
    lotesU.forEach(i => { const p = _cqProdutoInsumo(i); if (p) prods.set(p.id, p); });
    const linhas = [];
    [...prods.values()].sort((a, b) => (CQ_TIPOS_INSUMO[a.tipo] || '').localeCompare(CQ_TIPOS_INSUMO[b.tipo] || '') || (a.nome || '').localeCompare(b.nome || '', 'pt')).forEach(p => {
      if (!_cqCadAtivoBate(p) || !_cqCadFiltroServe(p, _cqEquipsInsumo(p))) return;
      const todos = lotesU.filter(i => _cqLoteCru(i).produtoId === p.id).sort((a, b) => (b.validade || '').localeCompare(a.validade || ''));
      let ls = todos.filter(l => _cqLoteNaSituacao(l, sit, hoje));
      if (!bate(`${p.nome} ${p.fabricante || ''} ${p.regAnvisa || ''} ${CQ_TIPOS_INSUMO[p.tipo] || ''}`)) { ls = ls.filter(l => bate(l.lote)); if (!ls.length) return; }
      if (!ls.length && todos.length && _cqCadAtivo !== 'inativos') return;
      linhas.push({ p, ls, total: todos.length });
    });
    const prepTxt = l => {
      if (!l.preparoInterno) return '<span class="cq-muted">—</span>';
      const ps = _cqPreparosDe(l);
      return ps.length ? `${ps.length} · último ${_cqFmtData(ps[0].data)}` : '<span class="cq-muted">nenhum</span>';
    };
    const legados = _cqCadAtivo === 'inativos' ? [] : lotesU.filter(i => !_cqProdutoInsumo(i)).filter(i => _cqLoteNaSituacao(i, sit, hoje) && _cqCadFiltroServe(i, _cqEquipsInsumo(i)) && bate(`${i.nome} ${i.lote} ${i.fabricante || ''}`))
      .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt') || (b.validade || '').localeCompare(a.validade || ''));
    el.innerHTML = `<div class="oc-table-scroll"><table class="ot-list-table cq-table cq-an-tbl">
      <thead><tr>${_cqCadThExpandir(linhas.map(x => x.p.id))}<th class="ot-list-th">Tipo</th><th class="ot-list-th">Produto</th><th class="ot-list-th">Equipamentos / analitos</th><th class="ot-list-th">Preparo interno</th><th class="ot-list-th">Lotes</th></tr></thead>
      <tbody>${linhas.length ? linhas.map(({ p, ls, total }) => {
        const prep = p.preparoInterno ? `Sim${p.preparo?.validadeDias ? ` · validade ${p.preparo.validadeDias} dia(s)` : ''}${p.preparo?.especificacao ? `<div class="cq-muted">${_cqEsc(p.preparo.especificacao)}</div>` : ''}` : '<span class="cq-muted">Não</span>';
        const g = grupoTr(p.id, p.ativo === false ? ' oc-row-final' : '', `cqInsumoProdutoForm('${p.id}')`, `
          <td>${_cqEsc(CQ_TIPOS_INSUMO[p.tipo] || p.tipo)}</td>
          <td><b>${_cqEsc(p.nome)}</b>${_cqUnidadesTag(p)}${p.ativo === false ? ' <span class="cq-badge cq-st-semalvo">inativo</span>' : ''}<div class="cq-muted">${_cqEsc([p.fabricante, p.regAnvisa ? 'ANVISA ' + p.regAnvisa : ''].filter(Boolean).join(' · '))}</div></td>
          <td style="font-size:12px;max-width:260px;">${equipsAnalitosHTML(_cqEquipsInsumo(p), p.analitoIds)}</td>
          <td style="font-size:12px;">${prep}</td>
          <td style="white-space:nowrap;">${nLotesHTML(ls, total)}</td>`);
        return g.html + (g.aberto ? `<tr class="cq-an-testes"><td></td><td colspan="5">
          <div class="oc-table-scroll"><table class="ot-list-table cq-table cq-table-sm cq-an-testes-tbl">
            <thead><tr><th class="ot-list-th">Lote</th><th class="ot-list-th">Validade</th><th class="ot-list-th">Preparos</th><th class="ot-list-th">Observações</th><th class="ot-list-th">Situação</th></tr></thead>
            <tbody>${ls.length ? ls.map(l => `<tr class="ot-list-row" onclick="cqInsumoForm('${l.id}')"><td class="oc-num" style="font-size:12.5px;">${_cqEsc(l.lote)}${_cqUnidadesTag(l)}</td>
              <td class="${_cqLoteVencido(l, hoje) ? 'oc-vencido' : ''}">${_cqFmtData(l.validade)}</td><td style="font-size:12px;">${prepTxt(l)}</td>
              <td style="font-size:12px;max-width:300px;">${_cqEsc(l.observacoes || '—')}</td><td>${_cqLoteSituacaoBadge(l, hoje)}</td></tr>`).join('') : vazioLotes(total)}</tbody></table></div>
          ${podeCfg ? `<button class="btn btn-outline btn-sm cq-an-novo-teste" onclick="event.stopPropagation();cqInsumoForm(null,{produtoId:'${p.id}'})">${CQ_ICO.plus} Novo lote de ${_cqEsc(p.nome)}</button>` : ''}</td></tr>` : '');
      }).join('') : `<tr><td colspan="6" class="cq-td-vazio">${q || filtroAnEq ? 'Nenhum produto ou lote corresponde aos filtros.' : `Nenhum produto com lote${vazioSit} nesta unidade.`}</td></tr>`}</tbody>
    </table></div>
    ${legados.length ? `<div class="cq-sec-titulo" style="margin-top:22px;">Lotes sem produto (cadastro antigo)</div>
      <div class="cq-nota" style="margin-bottom:8px;">Cadastrados quando produto e lote eram um registro só. ${podeCfg ? 'Use “Organizar lote(s) antigo(s)” acima ou abra o lote e escolha o produto.' : 'Um usuário com permissão de configurar deve organizá-los em produtos.'}</div>
      <div class="oc-table-scroll"><table class="ot-list-table cq-table">
        <thead><tr><th class="ot-list-th">Tipo</th><th class="ot-list-th">Produto</th><th class="ot-list-th">Lote</th><th class="ot-list-th">Validade</th><th class="ot-list-th">Equipamentos / analitos</th><th class="ot-list-th">Situação</th></tr></thead>
        <tbody>${legados.map(i => `<tr class="ot-list-row" onclick="cqInsumoForm('${i.id}')"><td>${_cqEsc(CQ_TIPOS_INSUMO[i.tipo] || i.tipo)}</td>
          <td><b>${_cqEsc(i.nome)}</b>${_cqUnidadesTag(i)}<div class="cq-muted">${_cqEsc(i.fabricante || '')}</div></td><td class="oc-num" style="font-size:12.5px;">${_cqEsc(i.lote)}</td>
          <td class="${_cqLoteVencido(i, hoje) ? 'oc-vencido' : ''}">${_cqFmtData(i.validade)}</td>
          <td style="font-size:12px;max-width:240px;">${equipsAnalitosHTML(_cqEquipsInsumo(i), i.analitoIds)}</td>
          <td>${_cqLoteSituacaoBadge(i, hoje)}</td></tr>`).join('')}</tbody>
      </table></div>` : ''}`;
  }
}

// Lista compacta de lotes (abas Lotes do material e do produto); `abrir` = função do formulário do lote
function _cqLotesCompactoHTML(lotes, abrir, novo) {
  const hoje = _cqHoje();
  return `<div class="cq-te-lista">${lotes.map(l => `<div class="cq-te-item${l.status === 'encerrado' ? ' inativo' : ''}" onclick="${abrir}('${l.id}')" title="Abrir lote">
      <div class="cq-te-item-txt"><b>Lote ${_cqEsc(l.lote)}</b><small>${_cqEsc([`val. ${_cqFmtData(l.validade)}`, _cqSiglasUnidades(_cqUnidadesRec(l)), l.observacoes].filter(Boolean).join(' · '))}</small></div>${_cqLoteSituacaoBadge(l, hoje)}
      <svg class="cq-te-item-seta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="9 6 15 12 9 18"/></svg></div>`).join('')
    || '<div class="cq-ms-vazio">Nenhum lote cadastrado.</div>'}</div>${novo || ''}`;
}
// Aviso no formulário do lote encerrado pelo gatilho de vencimento
function _cqEncerradoAutoNota(l) {
  if (!l || l.status !== 'encerrado' || !l.encerradoAuto) return '';
  return `<div class="cq-alerta-box">${CQ_ICO.alerta} Encerrado automaticamente em ${_cqFmtDH(l.encerradoAuto.em)}: validade ${_cqFmtData(l.encerradoAuto.validade)} expirada. Para reabrir, corrija a validade e altere a situação.</div>`;
}

const CQ_STATUS_LOTE = {
  em_uso: { label: 'Em uso', cls: 'cq-st-aceito' }, em_avaliacao: { label: 'Em avaliação', cls: 'cq-st-pendente' },
  quarentena: { label: 'Quarentena', cls: 'cq-st-alerta' }, encerrado: { label: 'Encerrado', cls: 'cq-st-semalvo' },
};

function _cqResumoRegras(regras) {
  return CQEngine.ORDEM_REGRAS.filter(k => regras?.[k] && regras[k] !== 'off')
    .map(k => CQEngine.REGRAS[k].label + (regras[k] === 'alerta' ? ' (alerta)' : '')).join(' / ') || 'sem regras';
}

function _cqRodapeForm(fnSalvar, podeEditar, fnExcluir, ativoCfg) {
  const esq = podeEditar ? `${fnExcluir ? `<button class="btn btn-outline cq-btn-perigo" onclick="${fnExcluir}">Excluir</button>` : ''}${_cqBtnAtivoHTML(ativoCfg)}` : '';
  return `${esq ? `<div class="cq-rodape-esq">${esq}</div>` : ''}
    <button class="btn btn-outline" onclick="cqDrawerClose()">${podeEditar ? 'Cancelar' : 'Fechar'}</button>
    ${podeEditar ? `<button class="btn btn-primary" onclick="${fnSalvar}">${CQ_ICO.check} Salvar</button>` : ''}`;
}
function _cqRo(pode) { return pode ? '' : 'disabled'; }

// ── ANALITOS ─────────────────────────────────────────────────
let _cqAnalitoFormId = null;
const CQ_LBL_ANALITO = {
  codigo: 'Código', nome: 'Nome', unidadeMedida: 'Unidade', decimais: 'Casas decimais', tipo: 'Tipo', especialidade: 'Especialidade',
  limitesDecisao: 'Limites de decisão', eta: 'Erro total permitido', cvMeta: 'CV meta', escala: 'Resultados possíveis',
  toleranciaPassos: 'Tolerância (categorias)', ativoIds: 'Equipamentos', sistemas: 'Sistemas sem equipamento', unidadeIds: 'Unidades', ativo: 'Ativo',
};
const _cqFmtSistemas = v => _cqArr(v).join(', ') || '—';
// Sugestões dos campos de lista do analito: o que já está cadastrado na unidade
function _cqSistemasDaUnidade(u) {
  const mapa = new Map();
  const add = x => { const v = String(x || '').trim(); if (v && !mapa.has(_cqItensChave(v))) mapa.set(_cqItensChave(v), v); };
  _cqDaUnidade('analitos', u).forEach(a => _cqArr(a.sistemas).forEach(add));
  _cqTestesDaUnidade(u, { incluirInativos: true }).filter(t => !t.ativoId).forEach(t => add(t.sistemaAnalitico || 'Bancada / manual'));
  return [...mapa.values()].sort((a, b) => a.localeCompare(b, 'pt'));
}
function _cqResultadosDaUnidade(u, exceto) {
  const mapa = new Map();
  _cqDaUnidade('analitos', u).filter(a => a.id !== exceto && a.tipo && a.tipo !== 'quantitativo')
    .forEach(a => _cqArr(a.escala).forEach(x => { const v = String(x || '').trim(); if (v && !mapa.has(_cqItensChave(v))) mapa.set(_cqItensChave(v), v); }));
  return [...mapa.values()];
}

// Equipamentos/sistemas do formulário do analito; não remove os que têm testes
function _cqAnalitoEquipCapturar(analitoId) {
  const ativoIds = _cqMultiVal('cq-an-ativos');
  const vistos = new Set();
  const sistemas = _cqItensVal('cq-an-sistemas').map(x => x.trim().replace(/\s+/g, ' ')).filter(x => x && !vistos.has(x.toLowerCase()) && vistos.add(x.toLowerCase()));
  if (analitoId) {
    const faltando = new Set();
    Object.values(cqState.config.testes).filter(t => t.analitoId === analitoId).forEach(t => {
      if (t.ativoId ? !ativoIds.includes(t.ativoId) : !vistos.has((t.sistemaAnalitico || 'Bancada / manual').toLowerCase())) faltando.add(_cqEquipTeste(t));
    });
    if (faltando.size) { showToast(`Em uso por testes deste analito, não pode ser removido: ${[...faltando].join(', ')}.`, 'error'); return null; }
  }
  return { ativoIds, sistemas };
}
const _cqFmtAtivos = v => _cqArr(v).map(_cqNomeAtivo).join(', ') || '—';

function cqAnalitoForm(id, aba) {
  const a = id ? cqState.config.analitos[id] : null;
  const u = _cqUnidadeAtivaId();
  const testesA = a ? _cqTestesDaUnidade(u, { incluirInativos: true }).filter(t => t.analitoId === a.id)
    .sort((x, y) => _cqEquipTeste(x).localeCompare(_cqEquipTeste(y)) || (x.metodo || '').localeCompare(y.metodo || '')) : [];
  const outrasUn = a ? [...new Set(Object.values(cqState.config.testes).filter(t => t.analitoId === a.id && t.unidadeId !== u).map(t => t.unidadeId))] : [];
  const abaT = a && aba === 'testes';
  const pode = _cqCan('configurar');
  _cqAnalitoFormId = id || null;
  const fontes = cqState.config.catalogos.fontesETa;
  const tipo = a?.tipo || 'quantitativo';
  const quant = tipo === 'quantitativo';
  // O tipo não muda depois que há testes: os resultados gravados dependem dele
  const emUso = !!a && Object.values(cqState.config.testes).some(t => t.analitoId === a.id);
  // Sistemas e resultados em uso por testes deste analito (não podem sair da lista)
  const testesAn = a ? Object.values(cqState.config.testes).filter(t => t.analitoId === a.id) : [];
  const sisEmUso = testesAn.filter(t => !t.ativoId).map(t => t.sistemaAnalitico || 'Bancada / manual');
  const escEmUso = testesAn.flatMap(t => _cqNiveisTeste(t).map(n => _cqControleQual(t, n)?.esperado).filter(Boolean));
  cqDrawerOpen({
    titulo: a ? a.nome : 'Novo analito', subtitulo: 'Substância ou característica medida', icone: 'beaker',
    corpo: `
      ${a ? `<div class="ot-modal-tabs cq-drawer-tabs" id="cq-an-abas">
        <button class="ot-modal-tab-btn${abaT ? '' : ' active'}" data-aba="id" onclick="cqAnalitoAba('id')">Identificação</button>
        <button class="ot-modal-tab-btn${abaT ? ' active' : ''}" data-aba="testes" onclick="cqAnalitoAba('testes')">Testes${testesA.length ? ` <span class="cq-step-qtd">${testesA.length}</span>` : ''}</button>
        <button class="ot-modal-tab-btn" data-aba="trilha" onclick="cqAnalitoAba('trilha')">${_cqAbaTrilha(a).rotulo}</button></div>
      <div id="cq-an-pane-testes" style="padding-top:14px;${abaT ? '' : 'display:none;'}">
        ${outrasUn.length ? `<div class="cq-nota">Também há testes deste analito em: ${_cqEsc(_cqSiglasUnidades(outrasUn))} (selecione a unidade para vê-los).</div>` : ''}
        ${!_cqEquipsDoAnalito(a).length ? `<div class="cq-alerta-box">${CQ_ICO.alerta} Vincule ao menos um equipamento ou sistema analítico na aba Identificação e salve para criar testes.</div>` : ''}
        ${_cqTestesCompactoHTML(a, testesA)}
      </div>` : ''}
      <div id="cq-an-pane-id" style="${abaT ? 'display:none;' : ''}">
      ${_cqInativoNota(a, 'ativo', 'não aparece nos cadastros de testes nem nos lançamentos')}
      <div class="form-section"><div class="form-section-title">${CQ_ICO.beaker}Identificação</div>
        <div class="form-row">
          <div class="form-field" style="max-width:140px;"><label class="field-label">Código</label><input type="text" id="cq-an-codigo" class="field-input" maxlength="16" value="${_cqEsc(a?.codigo)}" ${_cqRo(pode)}></div>
          <div class="form-field"><label class="field-label">Nome <span class="required">*</span></label><input type="text" id="cq-an-nome" class="field-input" maxlength="80" value="${_cqEsc(a?.nome)}" placeholder="Ex.: Glicose" ${_cqRo(pode)}></div>
        </div>
        <div class="form-row">
          <div class="form-field"><label class="field-label">Tipo</label><select id="cq-an-tipo" class="field-select" onchange="cqAnalitoTipoChange()" ${pode && !emUso ? '' : 'disabled'}>
            ${Object.entries(CQ_TIPOS_ANALITO).map(([k, l]) => `<option value="${k}" ${k === tipo ? 'selected' : ''}>${l}</option>`).join('')}</select>
            ${emUso ? '<div class="cq-nota">O tipo não pode ser alterado: há testes cadastrados com este analito.</div>' : ''}</div>
          <div class="form-field"><label class="field-label">Especialidade</label><select id="cq-an-esp" class="field-select" ${_cqRo(pode)}>${_cqOptions(CQ_ESPECIALIDADES, a?.especialidade || '')}</select></div>
        </div>
        ${_cqUnidadesCampoHTML('cq-an-un', a, pode, 'O analito só aparece nas listas e no cadastro de testes das unidades selecionadas.', 'analitos')}
        <div class="cq-an-equip">
          <div class="form-field"><label class="field-label">Equipamentos que dosam este analito</label>
            ${_cqMultiHTML('cq-an-ativos', _cqOpcoesAtivos(a?.ativoIds), a?.ativoIds, { placeholder: 'Nenhum equipamento vinculado', disabled: !pode, vazio: 'Nenhum equipamento ativo nos setores das unidades do CQ.' })}</div>
          <div class="form-field"><label class="field-label">Sistemas analíticos sem equipamento (bancada / manual)</label>
            ${_cqItensHTML('cq-an-sistemas', a?.sistemas, { placeholder: 'Ex.: Bancada de microbiologia', disabled: !pode, max: 60,
              vazio: 'Nenhum sistema sem equipamento.', travados: sisEmUso, travadoMotivo: 'Usado por teste deste analito',
              sugestoes: _cqSistemasDaUnidade(u), sugestoesRotulo: 'Já cadastrados na unidade — clique para adicionar' })}</div>
          <div class="cq-nota">Os testes deste analito escolhem o equipamento ou sistema nesta lista, e os reagentes e insumos são filtrados pelo equipamento.${emUso ? ' Equipamentos e sistemas com testes cadastrados não podem ser removidos.' : ''}</div>
        </div>
        <div id="cq-an-quant" style="${quant ? '' : 'display:none;'}">
        <div class="form-row">
          <div class="form-field"><label class="field-label">Unidade de medida <span class="required">*</span></label><input type="text" id="cq-an-unidade" class="field-input" maxlength="20" value="${_cqEsc(a?.unidadeMedida)}" placeholder="mg/dL" ${_cqRo(pode)}></div>
          <div class="form-field" style="max-width:130px;"><label class="field-label">Casas decimais</label><input type="number" min="0" max="4" id="cq-an-dec" class="field-input" value="${a?.decimais ?? 1}" ${_cqRo(pode)}></div>
        </div>
        <div class="form-field"><label class="field-label">Limites de decisão clínica</label>
          <input type="text" id="cq-an-limites" class="field-input" value="${_cqEsc(_cqArr(a?.limitesDecisao).join('; '))}" placeholder="Ex.: 70; 100; 126 (separados por ponto e vírgula)" ${_cqRo(pode)}>
          <div class="cq-nota">Os níveis de controle devem ficar próximos desses valores (PALC 11.3, ISO 15189 7.3.7.2).</div></div>
        </div>
      </div>
      <div class="form-section" id="cq-an-qual" style="${quant ? 'display:none;' : ''}"><div class="form-section-title">${CQ_ICO.lista}Resultados possíveis</div>
        <div class="form-field"><label class="field-label">Resultados <span class="required">*</span> <span class="cq-muted">(mínimo 2)</span></label>
          ${_cqItensHTML('cq-an-escala', a?.escala, { placeholder: 'Ex.: Sem crescimento', disabled: !pode, ordenavel: true, max: 80,
            vazio: 'Nenhum resultado. Adicione ao menos dois.', travados: escEmUso, travadoMotivo: 'Resultado esperado em teste deste analito',
            sugestoes: _cqResultadosDaUnidade(u, a?.id), sugestoesRotulo: 'Usados em outros analitos da unidade — clique para adicionar' })}
          <div class="cq-nota">O operador escolhe o resultado nesta lista; o sistema compara com o resultado esperado de cada controle (RDC 978, art. 180, II e V).
            Semiquantitativo: use as setas para deixar em ordem crescente, começando pelo negativo (ex.: Negativo, Traços, 1+, 2+, 3+).</div></div>
        <div class="form-field" id="cq-an-tol-wrap" style="max-width:260px;${tipo === 'semiquantitativo' ? '' : 'display:none;'}"><label class="field-label">Tolerância (categorias)</label>
          <input type="number" min="0" max="2" id="cq-an-tol" class="field-input" value="${a?.toleranciaPassos ?? 1}" ${_cqRo(pode)}>
          <div class="cq-nota">Diferença aceita como alerta. Passar de negativo para positivo (ou o contrário) sempre rejeita.</div></div>
        <input type="checkbox" id="cq-an-ativo-q" hidden ${a?.ativo === false ? '' : 'checked'}>
      </div>
      <div class="form-section" id="cq-an-espec" style="${quant ? '' : 'display:none;'}"><div class="form-section-title">${CQ_ICO.shield}Especificação da qualidade</div>
        <div class="form-row">
          <div class="form-field"><label class="field-label">Erro total permitido (ETa)</label><input type="text" id="cq-an-eta" class="field-input" inputmode="decimal" value="${_cqEsc(a?.eta?.valor ?? '')}" placeholder="Ex.: 8" ${_cqRo(pode)}></div>
          <div class="form-field" style="max-width:150px;"><label class="field-label">Expresso em</label><select id="cq-an-eta-tipo" class="field-select" ${_cqRo(pode)}><option value="%" ${a?.eta?.tipo !== 'abs' ? 'selected' : ''}>%</option><option value="abs" ${a?.eta?.tipo === 'abs' ? 'selected' : ''}>unidade do analito</option></select></div>
        </div>
        <div class="form-field"><label class="field-label">Fonte (modelo científico)</label><select id="cq-an-eta-fonte" class="field-select" ${_cqRo(pode)}>${_cqOptions(fontes, a?.eta?.fonte || '')}</select></div>
        <div class="form-field"><label class="field-label">Referência / observação</label><input type="text" id="cq-an-eta-ref" class="field-input" maxlength="200" value="${_cqEsc(a?.eta?.referencia)}" placeholder="Ex.: CMS-3355-F (2024); EFLM BV database, acesso em 10/2026" ${_cqRo(pode)}></div>
        <div class="form-row">
          <div class="form-field"><label class="field-label">CV meta (%)</label><input type="text" id="cq-an-cvmeta" class="field-input" inputmode="decimal" value="${_cqEsc(a?.cvMeta?.valor ?? '')}" ${_cqRo(pode)}></div>
          <div class="form-field"><label class="field-label">Fonte do CV meta</label><input type="text" id="cq-an-cvmeta-fonte" class="field-input" value="${_cqEsc(a?.cvMeta?.fonte)}" placeholder="Ex.: VB desejável (0,5 × CVI)" ${_cqRo(pode)}></div>
        </div>
        <input type="checkbox" id="cq-an-ativo" hidden ${a?.ativo === false ? '' : 'checked'}>
      </div>
      </div>
      ${a ? `<div id="cq-an-pane-trilha" style="padding-top:14px;display:none;">${_cqTrilhaHTML(a)}</div>` : ''}`,
    rodape: _cqRodapeForm('cqAnalitoSalvar()', pode, a ? `cqExcluirCadastro('analitos','${a.id}')` : '',
      a && { ids: 'cq-an-ativo,cq-an-ativo-q', fn: 'cqAnalitoSalvar', colecao: 'analitos', id: a.id, ativo: a.ativo !== false }),
  });
  delete document.getElementById('cq-drawer-title')?.dataset.teste;
}
function cqAnalitoAba(aba) {
  document.querySelectorAll('#cq-an-abas .ot-modal-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.aba === aba));
  [['testes', 'cq-an-pane-testes'], ['id', 'cq-an-pane-id'], ['trilha', 'cq-an-pane-trilha']].forEach(([k, id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = k === aba ? '' : 'none';
  });
}
// Analito novo salvo: oferece criar o primeiro teste já vinculado
function _cqOferecerPrimeiroTeste(rec) {
  if (!_cqEquipsDoAnalito(rec).length || !_cqNaUnidade(rec)) return;
  _cqPrompt({
    titulo: 'Analito cadastrado', subtitulo: rec.nome,
    corpo: `<div class="cq-nota">Criar agora o primeiro teste de <b>${_cqEsc(rec.nome)}</b> nesta unidade? Se ainda faltar o material/lote de controle ou o insumo, cadastre-os nas abas 2 e 3 e crie o teste depois pelo próprio analito.</div>`,
    confirmar: 'Criar teste',
    onConfirm: () => { setTimeout(() => cqTesteForm(null, null, { analitoId: rec.id }), 60); return true; },
  });
}

function _cqSetChk(id, v) { const el = document.getElementById(id); if (el) el.checked = !!v; }

function cqAnalitoTipoChange() {
  const tipo = _cqVal('cq-an-tipo') || 'quantitativo';
  const quant = tipo === 'quantitativo';
  [['cq-an-quant', quant], ['cq-an-espec', quant], ['cq-an-qual', !quant], ['cq-an-tol-wrap', tipo === 'semiquantitativo']].forEach(([id, vis]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = vis ? '' : 'none';
  });
}

async function cqAnalitoSalvar() {
  if (_cqSalvando) return;
  const antes0 = _cqAnalitoFormId ? cqState.config.analitos[_cqAnalitoFormId] : null;
  const tipo = _cqVal('cq-an-tipo') || antes0?.tipo || 'quantitativo';
  if (tipo !== 'quantitativo') return _cqAnalitoQualSalvar(tipo);
  const nome = _cqVal('cq-an-nome'), um = _cqVal('cq-an-unidade');
  if (!nome) { showToast('Informe o nome do analito.', 'error'); return; }
  if (!um) { showToast('Informe a unidade de medida.', 'error'); return; }
  const etaTxt = _cqVal('cq-an-eta'), eta = etaTxt ? CQEngine.parseNumero(etaTxt) : null;
  if (etaTxt && (eta === null || eta <= 0)) { showToast('ETa inválido.', 'error'); return; }
  if (eta !== null && !_cqVal('cq-an-eta-fonte')) { showToast('Informe a fonte do ETa (modelo científico).', 'error'); return; }
  const cvTxt = _cqVal('cq-an-cvmeta'), cv = cvTxt ? CQEngine.parseNumero(cvTxt) : null;
  if (cvTxt && (cv === null || cv <= 0)) { showToast('CV meta inválido.', 'error'); return; }
  const limites = _cqVal('cq-an-limites').split(';').map(s => CQEngine.parseNumero(s.trim())).filter(v => v !== null);
  const antes = _cqAnalitoFormId ? cqState.config.analitos[_cqAnalitoFormId] : null;
  const dupQ = Object.values(cqState.config.analitos).find(x => x.nome.toLowerCase() === nome.toLowerCase() && x.unidadeMedida === um && x.id !== _cqAnalitoFormId);
  if (dupQ) { if (!_cqOferecerAssociar('analitos', dupQ, `Analito ${dupQ.nome} (${dupQ.unidadeMedida})`)) showToast('Já existe analito com este nome e unidade.', 'error'); return; }
  const eq = _cqAnalitoEquipCapturar(_cqAnalitoFormId);
  if (!eq) return;
  const unidadeIds = _cqUnidadesCapturar('cq-an-un', 'analitos', antes);
  if (!unidadeIds) return;
  const rec = {
    ...(antes || {}), id: _cqAnalitoFormId || _cqUid(), codigo: _cqVal('cq-an-codigo'), nome, unidadeMedida: um,
    decimais: Math.min(4, Math.max(0, Number(_cqVal('cq-an-dec')) || 0)), tipo: 'quantitativo',
    especialidade: _cqVal('cq-an-esp'), limitesDecisao: limites, escala: null, toleranciaPassos: null,
    eta: eta !== null ? { valor: eta, tipo: _cqVal('cq-an-eta-tipo') || '%', fonte: _cqVal('cq-an-eta-fonte'), referencia: _cqVal('cq-an-eta-ref') } : null,
    cvMeta: cv !== null ? { valor: cv, fonte: _cqVal('cq-an-cvmeta-fonte') } : null,
    ...eq, unidadeIds, ativo: _cqChk('cq-an-ativo'),
  };
  if (!antes) { rec.criadoEm = _cqAgora(); rec.criadoPor = _cqAssinatura(); }
  const fmt = { eta: v => v ? `${v.valor}${v.tipo === 'abs' ? ' ' + um : '%'} (${v.fonte})` : '—', cvMeta: v => v ? `${v.valor}% (${v.fonte || ''})` : '—', ativoIds: _cqFmtAtivos, sistemas: _cqFmtSistemas, unidadeIds: _cqSiglasUnidades, ativo: v => v ? 'Sim' : 'Não' };
  const diffs = antes ? _cqDiff(antes, rec, CQ_LBL_ANALITO, fmt) : [];
  if (antes && !diffs.length) { cqDrawerClose(); return; }
  _cqTrilhaAdd(rec, antes ? 'edicao' : 'criacao', antes ? 'Analito alterado' : 'Analito cadastrado', diffs);
  _cqSalvando = true;
  try {
    if (await _cqSalvarRegistro('analitos', rec)) { showToast('Analito salvo.', 'success'); cqDrawerClose(); cqRender(); if (!antes) _cqOferecerPrimeiroTeste(rec); }
  } finally { _cqSalvando = false; }
}

// Analito qualitativo/semiquantitativo: lista de resultados possíveis no lugar de unidade e ETa
async function _cqAnalitoQualSalvar(tipo) {
  const nome = _cqVal('cq-an-nome');
  if (!nome) { showToast('Informe o nome do analito.', 'error'); return; }
  const escala = CQEngine.parseEscala(_cqItensVal('cq-an-escala').join('\n'));
  if (escala.length < 2) { showToast('Adicione ao menos dois resultados possíveis.', 'error'); return; }
  const antes = _cqAnalitoFormId ? cqState.config.analitos[_cqAnalitoFormId] : null;
  const dupQl = Object.values(cqState.config.analitos).find(x => x.nome.toLowerCase() === nome.toLowerCase() && (x.tipo || 'quantitativo') !== 'quantitativo' && x.id !== _cqAnalitoFormId);
  if (dupQl) { if (!_cqOferecerAssociar('analitos', dupQl, `Analito ${dupQl.nome}`)) showToast('Já existe analito qualitativo com este nome.', 'error'); return; }
  // Resultados usados como esperado em testes não podem sair da lista
  const usados = new Set();
  Object.values(cqState.config.testes).filter(t => t.analitoId === _cqAnalitoFormId)
    .forEach(t => _cqNiveisTeste(t).forEach(n => { const e = _cqControleQual(t, n)?.esperado; if (e) usados.add(e); }));
  const faltando = [...usados].filter(e => !escala.includes(e));
  if (faltando.length) { showToast(`Resultado em uso como esperado em testes: ${faltando.join(', ')}.`, 'error'); return; }
  const eq = _cqAnalitoEquipCapturar(_cqAnalitoFormId);
  if (!eq) return;
  const unidadeIds = _cqUnidadesCapturar('cq-an-un', 'analitos', antes);
  if (!unidadeIds) return;
  const rec = {
    ...(antes || {}), id: _cqAnalitoFormId || _cqUid(), codigo: _cqVal('cq-an-codigo'), nome, unidadeMedida: '', decimais: 0, tipo,
    especialidade: _cqVal('cq-an-esp'), limitesDecisao: [], eta: null, cvMeta: null, escala,
    toleranciaPassos: tipo === 'semiquantitativo' ? Math.min(2, Math.max(0, Number(_cqVal('cq-an-tol')) || 0)) : null,
    ...eq, unidadeIds, ativo: _cqChk('cq-an-ativo-q'),
  };
  if (!antes) { rec.criadoEm = _cqAgora(); rec.criadoPor = _cqAssinatura(); }
  const fmt = { escala: v => _cqArr(v).join(' | '), tipo: v => CQ_TIPOS_ANALITO[v] || v, ativoIds: _cqFmtAtivos, sistemas: _cqFmtSistemas, unidadeIds: _cqSiglasUnidades, ativo: v => v ? 'Sim' : 'Não' };
  const diffs = antes ? _cqDiff(antes, rec, CQ_LBL_ANALITO, fmt) : [];
  if (antes && !diffs.length) { cqDrawerClose(); return; }
  _cqTrilhaAdd(rec, antes ? 'edicao' : 'criacao', antes ? 'Analito alterado' : 'Analito cadastrado', diffs);
  _cqSalvando = true;
  try {
    if (await _cqSalvarRegistro('analitos', rec)) { showToast('Analito salvo.', 'success'); cqDrawerClose(); cqRender(); if (!antes) _cqOferecerPrimeiroTeste(rec); }
  } finally { _cqSalvando = false; }
}

// Cadastros antigos sem unidade: associa às unidades dos testes que os usam (insumos: dos últimos
// lançamentos); os sem uso vão para a unidade ativa. Lote sem uso segue o material.
function cqAssociarSemUnidade() {
  if (!_cqCan('configurar')) return;
  const cfg = cqState.config;
  const uAt = _cqUnidadeAtivaId();
  const unAt = cfg.unidades[uAt];
  const prop = {};   // col → { id → { rec, us:Set, porUso } }
  CQ_COLECOES_UNIDADE.forEach(col => {
    prop[col] = {};
    Object.values(cfg[col] || {}).filter(_cqSemUnidade).forEach(rec => {
      const us = _cqUnidadesEmUso(col, rec.id);
      prop[col][rec.id] = { rec, us, porUso: us.size > 0 };
    });
  });
  const unidadesDe = (col, id) => prop[col][id] ? prop[col][id].us : new Set(_cqUnidadesRec(cfg[col][id]));
  // Material usado por lote em uso precisa estar nas unidades desse lote
  Object.values(prop.lotesControle).forEach(p => {
    const pm = prop.materiais[p.rec.materialId];
    if (pm && p.us.size) { p.us.forEach(u => pm.us.add(u)); pm.porUso = true; }
  });
  // Produto de insumo: idem com os lotes dele
  Object.values(prop.insumos).forEach(p => {
    const pp = prop.insumoProdutos[_cqLoteCru(p.rec).produtoId];
    if (pp && p.us.size) { p.us.forEach(u => pp.us.add(u)); pp.porUso = true; }
  });
  Object.values(prop.materiais).forEach(p => { if (!p.us.size) p.us.add(uAt); });
  Object.values(prop.insumoProdutos).forEach(p => { if (!p.us.size) p.us.add(uAt); });
  Object.values(prop.lotesControle).forEach(p => { if (!p.us.size) unidadesDe('materiais', p.rec.materialId).forEach(u => p.us.add(u)); });
  Object.values(prop.insumos).forEach(p => { const pid = _cqLoteCru(p.rec).produtoId; if (!p.us.size && pid) unidadesDe('insumoProdutos', pid).forEach(u => p.us.add(u)); });
  ['analitos', 'lotesControle', 'insumos'].forEach(col => Object.values(prop[col]).forEach(p => { if (!p.us.size) p.us.add(uAt); }));
  const total = CQ_COLECOES_UNIDADE.reduce((n, c) => n + Object.keys(prop[c]).length, 0);
  if (!total) { showToast('Todos os cadastros já estão associados a unidades.', 'success'); return; }
  const nomes = { analitos: 'Analitos', materiais: 'Materiais de controle', lotesControle: 'Lotes de controle', insumoProdutos: 'Produtos (reagentes e insumos)', insumos: 'Lotes de reagentes e insumos' };
  const secoes = CQ_COLECOES_UNIDADE.filter(c => Object.keys(prop[c]).length).map(c => {
    const ps = Object.values(prop[c]).sort((a, b) => _cqResumoCadastro(c, a.rec).localeCompare(_cqResumoCadastro(c, b.rec)));
    const nUso = ps.filter(p => p.porUso).length;
    return `<details class="cq-assoc-sec"><summary><b>${nomes[c]}</b> · ${ps.length}${nUso ? ` <span class="cq-muted">(${nUso} pelo uso em testes)</span>` : ''}</summary>
      ${ps.map(p => `<div class="cq-assoc-item"><span>${_cqEsc(_cqResumoCadastro(c, p.rec))}</span><b>${_cqEsc(_cqSiglasUnidades([...p.us]))}</b></div>`).join('')}</details>`;
  }).join('');
  _cqPrompt({
    titulo: 'Associar cadastros às unidades', subtitulo: `${total} cadastro(s) sem unidade`,
    corpo: `<div class="cq-nota">Cadastros usados em testes serão associados às unidades desses testes (reagentes: às dos últimos lançamentos). Os sem uso irão para a unidade ativa, <b>${_cqEsc(unAt?.sigla || '')}</b>. Depois é possível ajustar cada cadastro. A alteração fica registrada na rastreabilidade.</div>${secoes}`,
    confirmar: 'Associar',
    onConfirm: async () => {
      const updates = {};
      const agora = _cqAgora();
      CQ_COLECOES_UNIDADE.forEach(c => Object.values(prop[c]).forEach(p => {
        const base = `${CQ_KEYS.config}/${c}/${p.rec.id}`;
        updates[`${base}/unidadeIds`] = [...p.us];
        updates[`${base}/atualizadoEm`] = agora;
        updates[`${base}/trilha/${_cqTk()}${p.rec.id.slice(-3)}`] = _cqTrilhaEntry('edicao', `Associado à(s) unidade(s) ${_cqSiglasUnidades([...p.us])} ${p.porUso ? '(uso em testes)' : '(cadastro sem uso)'}`);
      }));
      if (!(await window.dbUpdate(updates))) { showToast('Falha ao gravar. Nada foi alterado.', 'error'); return false; }
      CQ_COLECOES_UNIDADE.forEach(c => Object.values(prop[c]).forEach(p => { cfg[c][p.rec.id] = { ..._cqLoteCru(p.rec), unidadeIds: [...p.us] }; }));
      _cqHidratarInsumos();
      showToast(`${total} cadastro(s) associado(s).`, 'success');
      cqRender();
      return true;
    },
  });
}

// Cria os analitos qualitativos de um conjunto de modelos (microbiologia ou esterilização) que ainda não existem
function cqModelosMicro(tipo) {
  if (!_cqCan('configurar')) return;
  const mod = CQ_MODELOS[tipo] || CQ_MODELOS.micro;
  const u = _cqUnidadeAtivaId();
  const un = cqState.config.unidades[u];
  const porNome = new Map(Object.values(cqState.config.analitos).map(a => [(a.nome || '').toLowerCase(), a]));
  const novos = mod.lista.filter(m => !porNome.has(m.nome.toLowerCase()));
  // Já cadastrados só em outras unidades: associa à unidade ativa em vez de duplicar
  const associar = mod.lista.map(m => porNome.get(m.nome.toLowerCase())).filter(a => a && !_cqNaUnidade(a, u));
  if (!novos.length && !associar.length) { showToast(`Os analitos de ${mod.nomeCurto} já estão cadastrados nesta unidade.`, 'success'); return; }
  _cqPrompt({
    titulo: mod.titulo, subtitulo: `${mod.sub} · ${un?.sigla || ''}`,
    corpo: `<div class="cq-nota">${novos.length ? `Serão criados ${novos.length} analito(s) qualitativo(s) na unidade ${_cqEsc(un?.sigla || '')}. ` : ''}${associar.length ? `${associar.length} já cadastrado(s) em outra unidade será(ão) associado(s) a ${_cqEsc(un?.sigla || '')}. ` : ''}Revise os resultados possíveis com o RT antes de cadastrar os testes.</div>
      ${novos.map(m => `<div class="cq-modelo-item"><b>${_cqEsc(m.nome)}</b><div class="cq-muted">${_cqEsc(m.escala.join(' · '))}</div></div>`).join('')}
      ${associar.map(a => `<div class="cq-modelo-item"><b>${_cqEsc(a.nome)}</b><div class="cq-muted">Existente (${_cqEsc(_cqSiglasUnidades(_cqUnidadesRec(a)))}) — será associado</div></div>`).join('')}
      ${tipo === 'ester' ? `<div class="cq-nota">Depois: vincule cada analito à autoclave, cadastre os indicadores como material de controle (com lote e validade) e crie os testes —
        integrador: nível 1 “Pacote teste”, esperado “Viragem completa”, a cada corrida; indicador biológico: nível 1 “Ampola teste (no pacote)” esperado “Negativo”
        e nível 2 “Ampola controle (fora da autoclave)” esperado “Positivo”, mesmo lote nos dois níveis, semanal. Ative a ficha do ciclo da autoclave em Configurações › Unidade.</div>` : ''}`,
    confirmar: novos.length ? 'Criar analitos' : 'Associar analitos',
    onConfirm: async () => {
      const updates = {};
      const criados = [];
      novos.forEach(m => {
        const rec = { id: _cqUid() + m.codigo.slice(-2).toLowerCase(), codigo: m.codigo, nome: m.nome, unidadeMedida: '', decimais: 0, tipo: 'qualitativo',
                      especialidade: mod.esp, limitesDecisao: [], escala: [...m.escala], ativo: true, unidadeIds: [u],
                      criadoEm: _cqAgora(), criadoPor: _cqAssinatura(), atualizadoEm: _cqAgora() };
        _cqTrilhaAdd(rec, 'criacao', `Analito cadastrado a partir do modelo de ${mod.nomeCurto}`);
        updates[`${CQ_KEYS.config}/analitos/${rec.id}`] = rec;
        criados.push(rec);
      });
      associar.forEach(a => {
        const p = `${CQ_KEYS.config}/analitos/${a.id}`;
        updates[`${p}/unidadeIds`] = [..._cqUnidadesRec(a), u];
        updates[`${p}/trilha/${_cqTk()}${a.id.slice(-3)}`] = _cqTrilhaEntry('edicao', `Associado à unidade ${un?.sigla || u} (modelos de ${mod.nomeCurto})`);
      });
      if (!(await window.dbUpdate(updates))) { showToast('Falha ao gravar. Verifique a conexão e tente novamente.', 'error'); return false; }
      criados.forEach(r => { cqState.config.analitos[r.id] = r; });
      associar.forEach(a => { cqState.config.analitos[a.id] = { ...a, unidadeIds: [..._cqUnidadesRec(a), u] }; });
      showToast([novos.length ? `${novos.length} analito(s) criado(s)` : '', associar.length ? `${associar.length} associado(s) a ${un?.sigla || ''}` : ''].filter(Boolean).join(' e ') + '.', 'success');
      cqRender();
      return true;
    },
  });
}

// ── MATERIAIS DE CONTROLE ────────────────────────────────────
let _cqMaterialFormId = null;
const CQ_LBL_MATERIAL = {
  nome: 'Nome', fabricante: 'Fabricante', fornecedor: 'Fornecedor', regAnvisa: 'Registro ANVISA', tipo: 'Tipo', matriz: 'Matriz',
  codigoReferencia: 'Código de referência', niveis: 'Níveis', armazenamento: 'Armazenamento',
  estabilidadeAbertoDias: 'Estabilidade após abertura (dias)', equips: 'Equipamentos / sistemas', analitoIds: 'Analitos', unidadeIds: 'Unidades', ativo: 'Ativo',
};

function cqMaterialForm(id) {
  const m = id ? cqState.config.materiais[id] : null;
  const pode = _cqCan('configurar');
  _cqMaterialFormId = id || null;
  const niveis = m?.niveis || { 1: { nome: 'Normal' }, 2: { nome: 'Patológico' } };
  cqDrawerOpen({
    titulo: m ? m.nome : 'Novo material de controle', subtitulo: 'Amostra controle usada no CIQ (RDC 978, art. 181)', icone: 'beaker',
    corpo: _cqAbasHTML('mat', [{ k: 'dados', rotulo: 'Material', html: `
      ${_cqInativoNota(m, 'ativo', 'não é oferecido em testes novos')}
      <div class="form-section"><div class="form-section-title">${CQ_ICO.beaker}Material</div>
        <div class="form-field"><label class="field-label">Nome <span class="required">*</span></label><input type="text" id="cq-mat-nome" class="field-input" maxlength="80" value="${_cqEsc(m?.nome)}" placeholder="Ex.: Lyphochek Assayed Chemistry Control" ${_cqRo(pode)}></div>
        <div class="form-row">
          <div class="form-field"><label class="field-label">Fabricante <span class="required">*</span></label><input type="text" id="cq-mat-fab" class="field-input" value="${_cqEsc(m?.fabricante)}" ${_cqRo(pode)}></div>
          <div class="form-field"><label class="field-label">Fornecedor</label><input type="text" id="cq-mat-forn" class="field-input" value="${_cqEsc(m?.fornecedor)}" ${_cqRo(pode)}></div>
        </div>
        <div class="form-row">
          <div class="form-field"><label class="field-label">Tipo</label><select id="cq-mat-tipo" class="field-select" ${_cqRo(pode)}>${_cqMapOptions(CQ_TIPOS_MATERIAL, m?.tipo || 'comercial', null)}</select></div>
          <div class="form-field"><label class="field-label">Registro ANVISA</label><input type="text" id="cq-mat-anvisa" class="field-input" value="${_cqEsc(m?.regAnvisa)}" ${_cqRo(pode)}></div>
        </div>
        ${_cqUnidadesCampoHTML('cq-mat-un', m, pode, 'O material e seus lotes só aparecem nas unidades selecionadas.', 'materiais')}
        <div class="form-field"><label class="field-label">Equipamentos / sistemas</label>
          ${_cqMultiHTML('cq-mat-equip', _cqOpcoesEquipInsumo(m?.equips), m?.equips, { placeholder: 'Qualquer equipamento ou bancada', disabled: !pode, onchange: cqMaterialEquipChange, vazio: 'Nenhum equipamento ou sistema cadastrado.' })}</div>
        <div class="form-field"><label class="field-label">Analitos controlados <span class="cq-muted" id="cq-mat-an-escopo">${_cqArr(m?.equips).length ? '(vazio = todos dos equipamentos)' : '(vazio = todos)'}</span></label>
          ${_cqMultiHTML('cq-mat-an', _cqOpcoesAnalitosEquip(m?.equips, m?.analitoIds), m?.analitoIds, { placeholder: 'Todos os analitos', disabled: !pode, vazio: 'Nenhum analito vinculado a estes equipamentos/sistemas.' })}
          <div class="cq-nota">No cadastro do teste, só aparecem os materiais (e seus lotes) do equipamento/sistema e do analito escolhidos. Vazio: serve a qualquer um (ex.: controle multianalito de terceira parte).</div></div>
        <div class="form-field"><label class="field-label">Código de referência da cepa / lâmina</label><input type="text" id="cq-mat-ref" class="field-input" maxlength="60" value="${_cqEsc(m?.codigoReferencia)}" placeholder="Ex.: ATCC 25922 (cepas: espécie no nome, ex.: Escherichia coli)" ${_cqRo(pode)}>
          <div class="cq-nota">Cepas de referência: use cepas rastreáveis (ATCC, NCTC ou equivalente). Estoque, recebimento e abertura de frascos são controlados no sistema de estoque.</div></div>
        <div class="form-row">
          <div class="form-field"><label class="field-label">Matriz</label><input type="text" id="cq-mat-matriz" class="field-input" value="${_cqEsc(m?.matriz)}" placeholder="Soro humano, sangue total…" ${_cqRo(pode)}></div>
          <div class="form-field"><label class="field-label">Estabilidade após abertura (dias)</label><input type="number" min="0" id="cq-mat-estab" class="field-input" value="${_cqEsc(m?.estabilidadeAbertoDias ?? '')}" ${_cqRo(pode)}></div>
        </div>
        <div class="form-field"><label class="field-label">Armazenamento</label><input type="text" id="cq-mat-arm" class="field-input" value="${_cqEsc(m?.armazenamento)}" placeholder="Ex.: 2 a 8 °C; após reconstituição −20 °C" ${_cqRo(pode)}></div>
        <div class="form-field"><label class="field-label">Níveis</label>
          ${[1, 2, 3].map(n => `<div class="cq-nivel-row"><label class="oc-check"><input type="checkbox" class="cq-mat-nivel" value="${n}" ${niveis[n] ? 'checked' : ''} ${_cqRo(pode)}> Nível ${n}</label>
            <input type="text" class="field-input cq-mat-nivel-nome" data-n="${n}" value="${_cqEsc(niveis[n]?.nome || '')}" placeholder="Nome (opcional)" ${_cqRo(pode)}></div>`).join('')}
        </div>
        ${m?.tipo === 'pool_interno' || !m ? `<div class="cq-nota">Pool interno: forma alternativa de avaliação da precisão quando não há controle comercial (RDC 978, art. 182; PALC 11.9). Documente preparo, homogeneidade e estabilidade.</div>` : ''}
        <input type="checkbox" id="cq-mat-ativo" hidden ${m?.ativo === false ? '' : 'checked'}>
      </div>
` }, m && (() => {
      const ls = Object.values(cqState.config.lotesControle).filter(l => l.materialId === m.id).sort((a, b) => (b.validade || '').localeCompare(a.validade || ''));
      return { k: 'lotes', rotulo: `Lotes${ls.length ? ` <span class="cq-step-qtd">${ls.length}</span>` : ''}`,
        html: _cqLotesCompactoHTML(ls, 'cqLoteForm', pode ? `<button class="btn btn-outline btn-sm cq-an-novo-teste" onclick="cqLoteForm(null,{materialId:'${m.id}'})">${CQ_ICO.plus} Novo lote</button>` : '') };
    })(), _cqAbaTrilha(m)]),
    rodape: _cqRodapeForm('cqMaterialSalvar()', pode, m ? `cqExcluirCadastro('materiais','${m.id}')` : '',
      m && { ids: 'cq-mat-ativo', fn: 'cqMaterialSalvar', colecao: 'materiais', id: m.id, ativo: m.ativo !== false }),
  });
}

function cqMaterialEquipChange(equips) {
  _cqMultiOpcoes('cq-mat-an', _cqOpcoesAnalitosEquip(equips, []));
  const esc = document.getElementById('cq-mat-an-escopo');
  if (esc) esc.textContent = _cqArr(equips).length ? '(vazio = todos dos equipamentos)' : '(vazio = todos)';
}

async function cqMaterialSalvar() {
  if (_cqSalvando) return;
  const nome = _cqVal('cq-mat-nome'), fab = _cqVal('cq-mat-fab');
  if (!nome || !fab) { showToast('Informe nome e fabricante.', 'error'); return; }
  const niveis = {};
  document.querySelectorAll('#cq-drawer .cq-mat-nivel:checked').forEach(c => {
    const n = c.value;
    niveis[n] = { nome: document.querySelector(`#cq-drawer .cq-mat-nivel-nome[data-n="${n}"]`)?.value.trim() || '' };
  });
  if (!Object.keys(niveis).length) { showToast('Selecione ao menos um nível.', 'error'); return; }
  const antes = _cqMaterialFormId ? cqState.config.materiais[_cqMaterialFormId] : null;
  const est = _cqVal('cq-mat-estab');
  const equips = _cqMultiVal('cq-mat-equip');
  const analitoIds = _cqMultiVal('cq-mat-an');
  // Não remove equipamento/sistema nem analito de testes que usam este material
  if (antes && (equips.length || analitoIds.length)) {
    const fora = new Set();
    Object.values(cqState.config.testes).filter(t => t.materialId === antes.id || Object.values(t.controlesQual || {}).some(c => c?.materialId === antes.id))
      .forEach(t => { if (!_cqMaterialServe({ equips, analitoIds }, _cqEquipDoTeste(t), t.analitoId)) fora.add(`${_cqNomeTeste(t)} · ${_cqEquipTeste(t)}`); });
    if (fora.size) { showToast(`Material em uso pelos testes: ${[...fora].join('; ')}. Mantenha esses equipamentos/sistemas e analitos.`, 'error'); return; }
  }
  if (!antes) {
    const dupM = Object.values(cqState.config.materiais).find(x => x.nome.toLowerCase() === nome.toLowerCase() && (x.fabricante || '').toLowerCase() === fab.toLowerCase());
    if (dupM && _cqOferecerAssociar('materiais', dupM, `Material ${dupM.nome} — ${dupM.fabricante}`)) return;
  }
  const unidadeIds = _cqUnidadesCapturar('cq-mat-un', 'materiais', antes);
  if (!unidadeIds) return;
  // Lotes do material não podem ficar em unidades que o material deixou
  const lotesFora = antes ? Object.values(cqState.config.lotesControle).filter(l => l.materialId === antes.id && _cqUnidadesRec(l).some(x => !unidadeIds.includes(x))) : [];
  if (lotesFora.length) { showToast(`Lote(s) ${lotesFora.map(l => l.lote).join(', ')} deste material estão em unidades que você removeu. Ajuste os lotes antes.`, 'error'); return; }
  const rec = {
    ...(antes || {}), id: _cqMaterialFormId || _cqUid(), nome, fabricante: fab, fornecedor: _cqVal('cq-mat-forn'),
    tipo: _cqVal('cq-mat-tipo') || 'comercial', regAnvisa: _cqVal('cq-mat-anvisa'), matriz: _cqVal('cq-mat-matriz'), codigoReferencia: _cqVal('cq-mat-ref'),
    estabilidadeAbertoDias: est === '' ? null : Math.max(0, Number(est) || 0), armazenamento: _cqVal('cq-mat-arm'), niveis, equips, analitoIds, unidadeIds,
    ativo: _cqChk('cq-mat-ativo'),
  };
  if (!antes) { rec.criadoEm = _cqAgora(); rec.criadoPor = _cqAssinatura(); }
  const fmt = { niveis: v => Object.entries(v || {}).map(([n, x]) => `N${n}${x?.nome ? ' ' + x.nome : ''}`).join(', '), tipo: v => CQ_TIPOS_MATERIAL[v] || v,
                equips: v => _cqArr(v).map(_cqRotuloEquip).join(', ') || 'Qualquer', analitoIds: v => _cqArr(v).map(a => _cqAnalito(a)?.nome || a).join(', ') || 'Todos',
                unidadeIds: _cqSiglasUnidades, ativo: v => v ? 'Sim' : 'Não' };
  const diffs = antes ? _cqDiff(antes, rec, CQ_LBL_MATERIAL, fmt) : [];
  if (antes && !diffs.length) { cqDrawerClose(); return; }
  _cqTrilhaAdd(rec, antes ? 'edicao' : 'criacao', antes ? 'Material alterado' : 'Material cadastrado', diffs);
  _cqSalvando = true;
  try {
    if (await _cqSalvarRegistro('materiais', rec)) { showToast('Material salvo.', 'success'); cqDrawerClose(); cqRender(); }
  } finally { _cqSalvando = false; }
}

// ── LOTES DE CONTROLE ────────────────────────────────────────
let _cqLoteFormId = null;
const CQ_LBL_LOTE = { materialId: 'Material', lote: 'Lote', niveis: 'Níveis', validade: 'Validade', bulaUrl: 'Bula / valores do fabricante', status: 'Situação', observacoes: 'Observações', unidadeIds: 'Unidades' };

// Testes (nas unidades do lote) cujo nível usa o material do lote: candidatos a ter este lote em uso.
// Quantitativo: material do teste + nível presente no lote. Qualitativo: material do nível.
function _cqLoteUsoCandidatos(l) {
  const niveisLote = _cqArr(l.niveis).map(Number);
  return Object.values(cqState.config.testes)
    .filter(t => _cqNaUnidade(l, t.unidadeId) && (t.ativo !== false || Object.values(t.lotesAtivos || {}).includes(l.id)))
    .map(t => {
      const qual = _cqTesteQual(t);
      const niveis = _cqNiveisTeste(t).filter(n => qual ? _cqControleQual(t, n)?.materialId === l.materialId : t.materialId === l.materialId && niveisLote.includes(n));
      return { t, niveis };
    })
    .filter(x => x.niveis.length)
    .sort((a, b) => _cqNomeTeste(a.t).localeCompare(_cqNomeTeste(b.t), 'pt') || _cqEquipTeste(a.t).localeCompare(_cqEquipTeste(b.t), 'pt'));
}
function _cqLoteUsoHTML(l, pode) {
  const cands = _cqLoteUsoCandidatos(l);
  const mat = cqState.config.materiais[l.materialId];
  if (!cands.length) return `<div class="cq-nota">Nenhum teste usa o material ${_cqEsc(mat?.nome || '')} nas unidades deste lote. Escolha o material no cadastro do teste (aba Analitos e testes); depois o lote pode ser definido aqui.</div>`;
  const bloq = l.status === 'quarentena' || l.status === 'encerrado' || _cqLoteVencido(l);
  const multiUn = _cqUnidadesRec(l).length !== 1;
  const total = cands.reduce((s, x) => s + x.niveis.length, 0);
  const comEste = cands.reduce((s, x) => s + x.niveis.filter(n => x.t.lotesAtivos?.[n] === l.id).length, 0);
  // Um cartão por teste; cada nível é uma pílula marcável com o lote em uso hoje
  const cartoes = cands.map(({ t, niveis }) => {
    const qual = _cqTesteQual(t);
    const pilulas = niveis.map(n => {
      const atual = _cqLoteDoNivel(t, n);
      const usa = atual?.id === l.id;
      // Alvo só é conhecido para a unidade ativa (os alvos são carregados por unidade)
      const semAlvo = usa && !qual && _cqAlvosReady && t.unidadeId === _cqUnidadeAtivaId() && !_cqAlvoVigente(t.id, l.id, n);
      const hoje = usa ? 'este lote' : atual ? `${atual.lote}${_cqLoteVencido(atual) ? ' (vencido)' : atual.status === 'encerrado' ? ' (encerrado)' : ''}` : 'sem lote';
      const off = !pode || (bloq && !usa);
      return `<label class="cq-uso-nivel${usa ? ' on' : ''}${off ? ' off' : ''}" title="${usa ? 'Desmarque para retirar este lote do nível' : `Hoje: ${_cqEsc(hoje)} — marque para usar este lote`}">
        <input type="checkbox" class="cq-lote-uso" data-t="${t.id}" data-n="${n}" ${usa ? 'checked' : ''} ${off ? 'disabled' : ''} onchange="this.closest('.cq-uso-nivel').classList.toggle('on',this.checked)">
        <b>${_cqEsc(qual ? _cqRotuloNivel(t, n) : `N${n}`)}</b><small class="${!usa && !atual ? 'cq-txt-amarelo' : ''}">${_cqEsc(hoje)}</small>${semAlvo ? '<span class="cq-uso-alerta" title="Cadastre o alvo deste lote na aba Alvos do teste">sem alvo</span>' : ''}</label>`;
    }).join('');
    return `<div class="cq-uso-teste${t.ativo === false ? ' inativo' : ''}">
      <div class="cq-uso-cab"><b>${_cqEsc(_cqNomeTeste(t))}</b><small>${_cqEsc([_cqEquipTeste(t), multiUn ? _cqSiglasUnidades([t.unidadeId]) : '', t.ativo === false ? 'inativo' : ''].filter(Boolean).join(' · '))}</small></div>
      <div class="cq-uso-niveis">${pilulas}</div></div>`;
  }).join('');
  return `${bloq ? `<div class="cq-alerta-box">${CQ_ICO.alerta} Lote ${l.status === 'quarentena' ? 'em quarentena' : _cqLoteVencido(l) ? 'vencido' : 'encerrado'}: não pode passar a ser o lote em uso de um teste.</div>` : ''}
    <div class="cq-uso-resumo">Em uso em <b>${comEste}</b> de ${total} nível(is) de ${cands.length} teste(s)</div>
    <div class="cq-uso-lista">${cartoes}</div>
    <div class="cq-nota" style="margin-top:8px;">Marque o nível para usar este lote (substitui o lote em uso; a troca fica registrada no teste e no lote, com justificativa). Testes quantitativos precisam do alvo do novo lote (aba “Alvos” do teste).
      Aparecem os testes cujo nível usa o material ${_cqEsc(mat?.nome || '')}.</div>`;
}
// Mudanças de lote em uso marcadas na aba "Uso nos testes": [{ t, la (novo lotesAtivos), mud: [texto] }]
function _cqLoteUsoCapturar(l) {
  const porTeste = new Map();
  document.querySelectorAll('#cq-drawer .cq-lote-uso').forEach(c => {
    const t = cqState.config.testes[c.dataset.t];
    if (!t || c.disabled) return;
    const n = c.dataset.n;
    const atual = t.lotesAtivos?.[n] || null;
    if (c.checked === (atual === l.id)) return;
    const x = porTeste.get(t.id) || { t, la: { ...(t.lotesAtivos || {}) }, mud: [] };
    const rot = _cqTesteQual(t) ? _cqRotuloNivel(t, n) : `N${n}`;
    if (c.checked) { x.la[n] = l.id; x.mud.push(`${rot}: ${cqState.config.lotesControle[atual]?.lote || 'sem lote'} → ${l.lote}`); }
    else { delete x.la[n]; x.mud.push(`${rot}: ${l.lote} → sem lote`); }
    porTeste.set(t.id, x);
  });
  return [...porTeste.values()];
}

function cqLoteForm(id, opts = {}) {
  const l = id ? cqState.config.lotesControle[id] : null;
  const pode = _cqCan('configurar');
  _cqLoteFormId = id || null;
  const mats = Object.values(cqState.config.materiais).filter(m => m.id === l?.materialId || m.id === opts.materialId || (m.ativo !== false && _cqNaUnidade(m))).sort((a, b) => a.nome.localeCompare(b.nome));
  if (!mats.length) { showToast('Cadastre antes o material de controle desta unidade.', 'error'); return; }
  const mat0 = l ? cqState.config.materiais[l.materialId] : (cqState.config.materiais[opts.materialId] || mats[0]);
  // Número de níveis de teste com este lote em uso
  const usoN = l ? Object.values(cqState.config.testes).reduce((s, t) => s + Object.values(t.lotesAtivos || {}).filter(x => x === l.id).length, 0) : 0;
  cqDrawerOpen({
    titulo: l ? `Lote ${l.lote}` : 'Novo lote de controle', subtitulo: mat0 ? mat0.nome : '', icone: 'beaker',
    corpo: _cqAbasHTML('lote', [{ k: 'dados', rotulo: 'Lote', html: `
      ${_cqEncerradoAutoNota(l)}
      <div class="form-section"><div class="form-section-title">${CQ_ICO.beaker}Lote</div>
        <div class="form-field"><label class="field-label">Material <span class="required">*</span></label>
          <select id="cq-lote-mat" class="field-select" onchange="cqLoteMatChange()" ${l || !pode ? 'disabled' : ''}>${mats.map(m => `<option value="${m.id}" ${m.id === mat0?.id ? 'selected' : ''}>${_cqEsc(m.nome)} — ${_cqEsc(m.fabricante)}</option>`).join('')}</select></div>
        <div class="form-row">
          <div class="form-field"><label class="field-label">Número do lote <span class="required">*</span></label><input type="text" id="cq-lote-num" class="field-input" maxlength="40" value="${_cqEsc(l?.lote)}" ${l || !pode ? 'disabled' : ''}></div>
          <div class="form-field"><label class="field-label">Validade <span class="required">*</span></label><input type="date" id="cq-lote-val" class="field-input" value="${_cqEsc(l?.validade)}" ${_cqRo(pode)}></div>
        </div>
        <div class="form-field"><label class="field-label">Níveis deste lote</label><div class="cq-checks cq-checks-inline" id="cq-lote-niveis">${_cqLoteNiveisHTML(mat0, l, pode)}</div></div>
        ${_cqUnidadesCampoHTML('cq-lote-un', l, pode, 'Unidades que usam este lote (precisam estar entre as do material).', 'lotesControle')}
        <div class="form-row">
          <div class="form-field"><label class="field-label">Situação</label><select id="cq-lote-status" class="field-select" ${_cqRo(pode)}>${_cqMapOptions(CQ_STATUS_LOTE, l?.status || 'em_uso', null)}</select>
            <div class="cq-nota">Vencido o lote, a situação passa a “Encerrado” automaticamente.</div></div>
          <div class="form-field"><label class="field-label">Link da bula / tabela de valores</label><input type="url" id="cq-lote-bula" class="field-input" value="${_cqEsc(l?.bulaUrl)}" placeholder="https://…" ${_cqRo(pode)}></div>
        </div>
        <div class="form-field"><label class="field-label">Observações</label><textarea id="cq-lote-obs" class="field-textarea" style="min-height:50px;" ${_cqRo(pode)}>${_cqEsc(l?.observacoes)}</textarea></div>
      </div>
` }, l && { k: 'uso', rotulo: `Uso nos testes${usoN ? ` <span class="cq-step-qtd">${usoN}</span>` : ''}`, html: _cqLoteUsoHTML(l, pode) }, _cqAbaTrilha(l)], opts.aba),
    rodape: _cqRodapeForm('cqLoteSalvar()', pode, l ? `cqExcluirCadastro('lotesControle','${l.id}')` : ''),
  });
}

function _cqLoteNiveisHTML(mat, l, pode) {
  const sel = l ? _cqArr(l.niveis).map(Number) : Object.keys(mat?.niveis || {}).map(Number);
  return Object.entries(mat?.niveis || {}).map(([n, x]) => `<label class="oc-check"><input type="checkbox" class="cq-lote-nivel" value="${n}" ${sel.includes(Number(n)) ? 'checked' : ''} ${l || !pode ? 'disabled' : ''}> Nível ${n}${x?.nome ? ' (' + _cqEsc(x.nome) + ')' : ''}</label>`).join('');
}
function cqLoteMatChange() {
  const mat = cqState.config.materiais[_cqVal('cq-lote-mat')];
  const el = document.getElementById('cq-lote-niveis');
  if (el) el.innerHTML = _cqLoteNiveisHTML(mat, null, true);
}

async function cqLoteSalvar() {
  if (_cqSalvando) return;
  const antes = _cqLoteFormId ? cqState.config.lotesControle[_cqLoteFormId] : null;
  const materialId = antes ? antes.materialId : _cqVal('cq-lote-mat');
  const lote = antes ? antes.lote : _cqVal('cq-lote-num');
  const validade = _cqVal('cq-lote-val');
  const niveis = antes ? _cqArr(antes.niveis) : [...document.querySelectorAll('#cq-drawer .cq-lote-nivel:checked')].map(c => Number(c.value));
  if (!materialId || !lote) { showToast('Informe material e número do lote.', 'error'); return; }
  if (!validade) { showToast('Informe a validade do lote.', 'error'); return; }
  if (!niveis.length) { showToast('Selecione os níveis do lote.', 'error'); return; }
  const dupL = antes ? null : Object.values(cqState.config.lotesControle).find(x => x.materialId === materialId && x.lote.toLowerCase() === lote.toLowerCase());
  if (dupL) { if (!_cqOferecerAssociar('lotesControle', dupL, `Lote ${dupL.lote} — ${cqState.config.materiais[materialId]?.nome || ''}`)) showToast('Lote já cadastrado para este material.', 'error'); return; }
  const unidadeIds = _cqUnidadesCapturar('cq-lote-un', 'lotesControle', antes);
  if (!unidadeIds) return;
  const matL = cqState.config.materiais[materialId];
  const foraMat = _cqUnidadesRec(matL).length ? unidadeIds.filter(x => !_cqUnidadesRec(matL).includes(x)) : [];
  if (foraMat.length) { showToast(`O material ${matL.nome} não está associado à(s) unidade(s) ${_cqSiglasUnidades(foraMat)}. Associe o material antes.`, 'error'); return; }
  const rec = { ...(antes || {}), id: _cqLoteFormId || _cqUid(), materialId, lote, validade, niveis, unidadeIds,
                status: _cqVal('cq-lote-status') || 'em_uso', bulaUrl: _cqVal('cq-lote-bula'), observacoes: _cqVal('cq-lote-obs') };
  if (rec.status !== 'encerrado') delete rec.encerradoAuto;   // reaberto: o gatilho volta a valer
  if (!antes) { rec.criadoEm = _cqAgora(); rec.criadoPor = _cqAssinatura(); }
  const fmt = { status: v => CQ_STATUS_LOTE[v]?.label || v, materialId: v => cqState.config.materiais[v]?.nome || v, niveis: v => _cqArr(v).map(n => 'N' + n).join(', '), unidadeIds: _cqSiglasUnidades };
  const diffs = antes ? _cqDiff(antes, rec, CQ_LBL_LOTE, fmt) : [];
  const uso = antes ? _cqLoteUsoCapturar(antes) : [];
  if (antes && !diffs.length && !uso.length) { cqDrawerClose(); return; }
  // Lote que deixa de poder ser usado não pode ficar como lote em uso marcado agora
  const bloqueado = rec.status === 'quarentena' || rec.status === 'encerrado' || _cqLoteVencido(rec);
  if (bloqueado && uso.some(x => Object.values(x.la).includes(rec.id))) { showToast('Lote em quarentena, encerrado ou vencido não pode passar a ser o lote em uso de um teste.', 'error'); return; }
  const fmtLotes = v => Object.entries(v || {}).map(([n, id]) => `N${n}: ${(id === rec.id ? rec : cqState.config.lotesControle[id])?.lote || id}`).join('; ') || '—';
  const gravar = async justificativa => {
    if (diffs.length || !antes) _cqTrilhaAdd(rec, antes ? 'edicao' : 'criacao', antes ? 'Lote alterado' : 'Lote cadastrado', diffs);
    if (uso.length) _cqTrilhaAdd(rec, 'edicao', `Lote em uso alterado no cadastro do lote — ${uso.map(x => `${_cqNomeTeste(x.t)} · ${_cqEquipTeste(x.t)} (${x.mud.join(', ')})`).join('; ')}: ${justificativa}`);
    rec.atualizadoEm = _cqAgora();
    const C = CQ_KEYS.config;
    const updates = { [`${C}/lotesControle/${rec.id}`]: rec };
    uso.forEach(x => {
      const p = `${C}/testes/${x.t.id}`;
      updates[`${p}/lotesAtivos`] = x.la;
      updates[`${p}/atualizadoEm`] = rec.atualizadoEm;
      updates[`${p}/trilha/${_cqTk()}${x.t.id.slice(-3)}`] = _cqTrilhaEntry('edicao', `Troca de lote definida no cadastro do lote ${rec.lote}: ${justificativa}`,
        [{ campo: CQ_LBL_TESTE.lotesAtivos, antes: fmtLotes(x.t.lotesAtivos), depois: fmtLotes(x.la) }]);
    });
    _cqSalvando = true;
    try {
      if (!(await window.dbUpdate(updates))) { showToast('Falha ao gravar. Verifique a conexão e tente novamente.', 'error'); return false; }
      cqState.config.lotesControle[rec.id] = rec;
      uso.forEach(x => { cqState.config.testes[x.t.id] = { ...x.t, lotesAtivos: x.la }; });
      showToast(uso.length ? `Lote salvo; lote em uso atualizado em ${uso.length} teste(s).` : 'Lote salvo.', 'success');
      cqRender();
      // Lote novo: reabre na aba "Uso nos testes" para defini-lo como lote em uso
      if (!antes) cqLoteForm(rec.id, { aba: _cqLoteUsoCandidatos(rec).length ? 'uso' : 'dados' }); else cqDrawerClose();
      return true;
    } finally { _cqSalvando = false; }
  };
  if (!uso.length) { await gravar(''); return; }
  _cqPrompt({
    titulo: 'Troca de lote em uso', subtitulo: `Lote ${rec.lote} — registre o motivo`,
    corpo: `<div class="cq-nota">${uso.map(x => `<div><b>${_cqEsc(_cqNomeTeste(x.t))}</b> · ${_cqEsc(_cqEquipTeste(x.t))}: ${_cqEsc(x.mud.join(', '))}</div>`).join('')}</div>
      <div class="form-field"><label class="field-label">Justificativa <span class="required">*</span></label>
        <textarea id="cq-lote-uso-just" class="field-textarea" style="min-height:70px;" placeholder="Ex.: lote anterior esgotado; novo lote avaliado em paralelo por 10 dias."></textarea></div>`,
    confirmar: 'Confirmar',
    onConfirm: async () => {
      const j = _cqVal('cq-lote-uso-just');
      if (!j) { showToast('Informe a justificativa.', 'error'); return false; }
      return gravar(j);
    },
  });
}

// ── REAGENTES, MEIOS E INSUMOS: PRODUTO ──────────────────────
// Produto (insumoProdutos): tipo, fabricante, equipamentos/analitos e preparo interno.
// Os lotes (insumos) apontam para o produto e herdam esses dados (ver _cqHidratarInsumos).
let _cqInsProdFormId = null;
const CQ_LBL_INS_PRODUTO = { tipo: 'Tipo', nome: 'Produto', fabricante: 'Fabricante', regAnvisa: 'Registro ANVISA', equips: 'Equipamentos / sistemas', analitoIds: 'Analitos',
                             preparoInterno: 'Preparado no laboratório', preparo: 'Dados do preparo', unidadeIds: 'Unidades', ativo: 'Ativo' };
const _cqFmtPreparo = v => v ? [v.especificacao, v.armazenamento, v.riscos ? 'riscos: ' + v.riscos : '', v.validadeDias ? `validade ${v.validadeDias} dia(s) após preparo` : ''].filter(Boolean).join(' · ') : '—';

function cqInsumoProdutoForm(id) {
  const p = id ? cqState.config.insumoProdutos[id] : null;
  const pode = _cqCan('configurar');
  _cqInsProdFormId = id || null;
  const sel = _cqArr(p?.analitoIds);
  const equips = _cqEquipsInsumo(p);
  const prep = p?.preparo || {};
  const lotes = p ? _cqLotesDoProduto(p.id).sort((a, b) => (b.validade || '').localeCompare(a.validade || '')) : [];
  cqDrawerOpen({
    titulo: p ? p.nome : 'Novo produto', subtitulo: 'Reagente, calibrador, meio de cultura ou corante — os lotes são cadastrados no produto', icone: 'beaker',
    corpo: _cqAbasHTML('prod', [{ k: 'dados', rotulo: 'Produto', html: `
      ${_cqInativoNota(p, 'ativo', 'não é oferecido em testes novos')}
      <div class="form-section"><div class="form-section-title">${CQ_ICO.beaker}Produto</div>
        <div class="form-row">
          <div class="form-field" style="max-width:190px;"><label class="field-label">Tipo</label><select id="cq-ins-tipo" class="field-select" ${_cqRo(pode)}>${_cqMapOptions(CQ_TIPOS_INSUMO, p?.tipo || 'reagente', null)}</select></div>
          <div class="form-field"><label class="field-label">Produto <span class="required">*</span></label><input type="text" id="cq-ins-nome" class="field-input" maxlength="100" value="${_cqEsc(p?.nome)}" placeholder="Ex.: Ágar EMB" ${_cqRo(pode)}></div>
        </div>
        <div class="form-row">
          <div class="form-field"><label class="field-label">Fabricante</label><input type="text" id="cq-ins-fab" class="field-input" value="${_cqEsc(p?.fabricante)}" ${_cqRo(pode)}></div>
          <div class="form-field"><label class="field-label">Registro ANVISA</label><input type="text" id="cq-ins-anvisa" class="field-input" value="${_cqEsc(p?.regAnvisa)}" ${_cqRo(pode)}></div>
        </div>
        ${_cqUnidadesCampoHTML('cq-ins-un', p, pode, 'O produto e seus lotes só aparecem nas unidades selecionadas.', 'insumoProdutos')}
        <div class="form-field"><label class="field-label">Equipamentos / sistemas</label>
          ${_cqMultiHTML('cq-ins-equip', _cqOpcoesEquipInsumo(equips), equips, { placeholder: 'Qualquer equipamento ou bancada', disabled: !pode, onchange: cqInsumoEquipChange, vazio: 'Nenhum equipamento ou sistema cadastrado.' })}
          <div class="cq-nota">Ativos dos setores do CQ e sistemas analíticos sem equipamento informados nos analitos. Vazio: serve a qualquer um.</div></div>
        <div class="form-field"><label class="field-label">Analitos <span class="cq-muted" id="cq-ins-an-escopo">${equips.length ? '(vazio = todos dos equipamentos)' : '(vazio = todos)'}</span></label>
          ${_cqMultiHTML('cq-ins-an', _cqOpcoesAnalitosEquip(equips, sel), sel, { placeholder: 'Todos os analitos', disabled: !pode, vazio: 'Nenhum analito vinculado a estes equipamentos/sistemas (vincule no cadastro do analito).' })}
          <div class="cq-nota">Com equipamento ou sistema selecionado, só aparecem os analitos vinculados a ele no cadastro de analitos.</div></div>
        <input type="checkbox" id="cq-ins-ativo" hidden ${p?.ativo === false ? '' : 'checked'}>
      </div>
      <div class="form-section"><div class="form-section-title">${CQ_ICO.beaker}Preparo no laboratório (RDC 978, art. 101)</div>
        <label class="oc-check"><input type="checkbox" id="cq-ins-prep" ${p?.preparoInterno ? 'checked' : ''} onchange="document.getElementById('cq-ins-prep-campos').style.display=this.checked?'':'none'" ${_cqRo(pode)}> Preparado ou fracionado pelo laboratório (meio preparado a partir do desidratado, corante diluído…)</label>
        <div id="cq-ins-prep-campos" style="${p?.preparoInterno ? '' : 'display:none;'}">
          <div class="cq-nota">Lote e validade são os de cada lote do produto (ex.: meio desidratado). Data e responsável de cada preparo são informados no lançamento da corrida.</div>
          <div class="form-row">
            <div class="form-field"><label class="field-label">Concentração / especificação</label><input type="text" id="cq-ins-prep-esp" class="field-input" value="${_cqEsc(prep.especificacao)}" placeholder="Ex.: 36 g/L; pH 7,2 ± 0,2" ${_cqRo(pode)}></div>
            <div class="form-field" style="max-width:200px;"><label class="field-label">Validade após preparo (dias)</label><input type="number" min="1" max="3650" id="cq-ins-prep-dias" class="field-input" value="${_cqEsc(prep.validadeDias ?? '')}" placeholder="Ex.: 30" ${_cqRo(pode)}></div>
          </div>
          <div class="form-row">
            <div class="form-field"><label class="field-label">Armazenamento <span class="required">*</span></label><input type="text" id="cq-ins-prep-arm" class="field-input" value="${_cqEsc(prep.armazenamento)}" placeholder="Ex.: 2 a 8 °C, protegido da luz" ${_cqRo(pode)}></div>
            <div class="form-field"><label class="field-label">Riscos potenciais</label><input type="text" id="cq-ins-prep-risco" class="field-input" value="${_cqEsc(prep.riscos)}" placeholder="Ex.: irritante; inflamável" ${_cqRo(pode)}></div>
          </div>
        </div>
      </div>
` }, p && { k: 'lotes', rotulo: `Lotes${lotes.length ? ` <span class="cq-step-qtd">${lotes.length}</span>` : ''}`,
        html: _cqLotesCompactoHTML(lotes, 'cqInsumoForm', pode ? `<button class="btn btn-outline btn-sm cq-an-novo-teste" onclick="cqInsumoForm(null,{produtoId:'${p.id}'})">${CQ_ICO.plus} Novo lote</button>` : '') },
      _cqAbaTrilha(p)]),
    rodape: _cqRodapeForm('cqInsumoProdutoSalvar()', pode, p ? `cqExcluirCadastro('insumoProdutos','${p.id}')` : '',
      p && { ids: 'cq-ins-ativo', fn: 'cqInsumoProdutoSalvar', colecao: 'insumoProdutos', id: p.id, ativo: p.ativo !== false }),
  });
}

// Analitos oferecidos no produto: os vinculados ao equipamento (todos sem equipamento) + os já marcados
function _cqOpcoesAnalitosEquip(equips, manter) {
  const fica = new Set(_cqArr(manter));
  const chaves = new Set(_cqArr(equips).map(_cqEquipChave));
  return Object.values(cqState.config.analitos)
    .filter(a => fica.has(a.id) || (a.ativo !== false && _cqNaUnidade(a) && (!chaves.size || _cqEquipsDoAnalito(a).some(o => chaves.has(_cqEquipChave(o.value))))))
    .sort((a, b) => (a.especialidade || '').localeCompare(b.especialidade || '') || a.nome.localeCompare(b.nome))
    .map(a => ({ value: a.id, label: a.nome, sub: [a.codigo, a.unidadeMedida || CQ_TIPOS_ANALITO[a.tipo] || ''].filter(Boolean).join(' · '), grupo: a.especialidade || '' }));
}
function cqInsumoEquipChange(equips) {
  _cqMultiOpcoes('cq-ins-an', _cqOpcoesAnalitosEquip(equips, []));
  const esc = document.getElementById('cq-ins-an-escopo');
  if (esc) esc.textContent = _cqArr(equips).length ? '(vazio = todos dos equipamentos)' : '(vazio = todos)';
}

async function cqInsumoProdutoSalvar() {
  if (_cqSalvando) return;
  const antes = _cqInsProdFormId ? cqState.config.insumoProdutos[_cqInsProdFormId] : null;
  const nome = _cqVal('cq-ins-nome'), tipo = _cqVal('cq-ins-tipo') || 'reagente', fabricante = _cqVal('cq-ins-fab');
  if (!nome) { showToast('Informe o nome do produto.', 'error'); return; }
  const preparoInterno = _cqChk('cq-ins-prep');
  const diasTxt = _cqVal('cq-ins-prep-dias');
  const preparo = preparoInterno ? {
    especificacao: _cqVal('cq-ins-prep-esp'), armazenamento: _cqVal('cq-ins-prep-arm'), riscos: _cqVal('cq-ins-prep-risco'),
    validadeDias: diasTxt === '' ? null : Math.max(1, Math.round(Number(diasTxt)) || 0) || null,
  } : null;
  if (preparo && !preparo.armazenamento) { showToast('Preparo interno: informe o armazenamento (RDC 978, art. 101).', 'error'); return; }
  const norm = x => _cqNormBusca(String(x || '').trim());
  if (!antes) {
    const dup = Object.values(cqState.config.insumoProdutos).find(x => x.tipo === tipo && norm(x.nome) === norm(nome) && norm(x.fabricante) === norm(fabricante));
    if (dup) { if (!_cqOferecerAssociar('insumoProdutos', dup, `${dup.nome}${dup.fabricante ? ' — ' + dup.fabricante : ''}`)) showToast('Produto já cadastrado (mesmo tipo, nome e fabricante).', 'error'); return; }
  }
  const equips = _cqMultiVal('cq-ins-equip'), analitoIds = _cqMultiVal('cq-ins-an');
  // Testes que controlam o produto: o tipo não muda e o produto continua servindo ao analito e ao equipamento deles
  if (antes) {
    const testes = Object.values(cqState.config.testes).filter(t => t.insumoProdutoId === antes.id);
    if (testes.length && tipo !== antes.tipo) { showToast(`Produto controlado pelos testes ${testes.map(_cqNomeTeste).join('; ')}: o tipo não pode mudar.`, 'error'); return; }
    const fora = testes.filter(t => !_cqMaterialServe({ equips, analitoIds }, _cqEquipDoTeste(t), t.analitoId)).map(t => `${_cqNomeTeste(t)} · ${_cqEquipTeste(t)}`);
    if (fora.length) { showToast(`Produto controlado pelos testes ${fora.join('; ')}. Mantenha esses equipamentos/sistemas e analitos.`, 'error'); return; }
  }
  const unidadeIds = _cqUnidadesCapturar('cq-ins-un', 'insumoProdutos', antes);
  if (!unidadeIds) return;
  // Lotes do produto não podem ficar em unidades que o produto deixou
  const lotesFora = antes ? _cqLotesDoProduto(antes.id).filter(l => _cqUnidadesRec(l).some(x => !unidadeIds.includes(x))) : [];
  if (lotesFora.length) { showToast(`Lote(s) ${lotesFora.map(l => l.lote).join(', ')} deste produto estão em unidades que você removeu. Ajuste os lotes antes.`, 'error'); return; }
  const rec = { ...(antes || {}), id: _cqInsProdFormId || _cqUid(), tipo, nome, fabricante, regAnvisa: _cqVal('cq-ins-anvisa'),
                equips, analitoIds, preparoInterno, preparo, unidadeIds, ativo: _cqChk('cq-ins-ativo') };
  if (!antes) { rec.criadoEm = _cqAgora(); rec.criadoPor = _cqAssinatura(); }
  const fmt = { tipo: v => CQ_TIPOS_INSUMO[v] || v, analitoIds: v => _cqArr(v).map(a => _cqAnalito(a)?.nome || a).join(', ') || 'Todos',
                equips: v => _cqArr(v).map(_cqRotuloEquip).join(', ') || 'Qualquer', unidadeIds: _cqSiglasUnidades, preparoInterno: v => v ? 'Sim' : 'Não',
                preparo: _cqFmtPreparo, ativo: v => v === false ? 'Não' : 'Sim' };
  const diffs = antes ? _cqDiff(antes, rec, CQ_LBL_INS_PRODUTO, fmt) : [];
  if (antes && !diffs.length) { cqDrawerClose(); return; }
  _cqTrilhaAdd(rec, antes ? 'edicao' : 'criacao', antes ? 'Produto alterado' : 'Produto cadastrado', diffs);
  _cqSalvando = true;
  try {
    if (await _cqSalvarRegistro('insumoProdutos', rec)) {
      cqRender();
      if (antes) { showToast('Produto salvo.', 'success'); cqDrawerClose(); }
      else { showToast('Produto salvo. Cadastre agora o lote em uso.', 'success'); cqInsumoForm(null, { produtoId: rec.id }); }
    }
  } finally { _cqSalvando = false; }
}

// ── REAGENTES, MEIOS E INSUMOS: LOTE ─────────────────────────
let _cqInsumoFormId = null;
const CQ_LBL_INSUMO = { produtoId: 'Produto', lote: 'Lote', validade: 'Validade', status: 'Situação', preparoUsoUnico: 'Preparo de uso único', observacoes: 'Observações', unidadeIds: 'Unidades' };

function cqInsumoForm(id, opts = {}) {
  const i = id ? cqState.config.insumos[id] : null;
  const pode = _cqCan('configurar');
  _cqInsumoFormId = id || null;
  const prodAtual = _cqProdutoInsumo(i);
  const legado = !!i && !prodAtual;
  const norm = x => _cqNormBusca(String(x || '').trim());
  const prods = Object.values(cqState.config.insumoProdutos).filter(p => p.id === prodAtual?.id || (p.ativo !== false && _cqNaUnidade(p)))
    .sort((a, b) => (CQ_TIPOS_INSUMO[a.tipo] || '').localeCompare(CQ_TIPOS_INSUMO[b.tipo] || '') || a.nome.localeCompare(b.nome, 'pt'));
  if (!prods.length) {
    if (legado) showToast('Lote antigo: cadastre antes o produto ou use “Organizar lote(s) antigo(s)”.', 'error');
    else showToast('Cadastre antes o produto (reagente, meio de cultura, corante…).', 'error');
    if (!legado) return;
  }
  // Lote antigo: sugere o produto de mesmo tipo e nome, se houver um só
  const sugerido = legado ? prods.filter(p => p.tipo === i.tipo && norm(p.nome) === norm(i.nome)) : [];
  const pid = prodAtual?.id || opts.produtoId || (sugerido.length === 1 ? sugerido[0].id : '');
  const p0 = cqState.config.insumoProdutos[pid];
  const porTipo = {};
  prods.forEach(p => { (porTipo[p.tipo] = porTipo[p.tipo] || []).push(p); });
  const opsProd = Object.entries(porTipo).map(([t, ps]) => `<optgroup label="${_cqEsc(CQ_TIPOS_INSUMO[t] || t)}">${ps.map(p => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${_cqEsc(p.nome)}${p.fabricante ? ' — ' + _cqEsc(p.fabricante) : ''}</option>`).join('')}</optgroup>`).join('');
  cqDrawerOpen({
    titulo: i ? `${i.nome} · lote ${i.lote}` : 'Novo lote', subtitulo: p0 ? `${CQ_TIPOS_INSUMO[p0.tipo] || ''} · ${p0.nome}` : 'Reagentes, calibradores, meios de cultura e corantes usados nas corridas', icone: 'beaker',
    corpo: _cqAbasHTML('ins', [{ k: 'dados', rotulo: 'Lote', html: `
      ${_cqEncerradoAutoNota(i)}
      ${legado ? `<div class="cq-alerta-box">${CQ_ICO.alerta} Lote cadastrado antes da separação entre produto e lote: ${_cqEsc(CQ_TIPOS_INSUMO[i.tipo] || i.tipo)} “${_cqEsc(i.nome)}”${i.fabricante ? `, ${_cqEsc(i.fabricante)}` : ''}${_cqEquipsInsumo(i).length ? `, ${_cqEsc(_cqEquipsInsumo(i).map(_cqRotuloEquip).join(', '))}` : ''}${_cqArr(i.analitoIds).length ? `, analitos ${_cqEsc(_cqArr(i.analitoIds).map(a => _cqAnalito(a)?.nome || '?').join(', '))}` : ''}.
        Escolha o produto correspondente: o lote passa a seguir o cadastro dele (equipamentos, analitos e preparo).</div>` : ''}
      <div class="form-section"><div class="form-section-title">${CQ_ICO.beaker}Lote</div>
        <div class="form-field"><label class="field-label">Produto <span class="required">*</span></label>
          <select id="cq-ins-prod" class="field-select" onchange="cqInsumoProdChange()" ${prodAtual || !pode ? 'disabled' : ''}>${pid ? '' : '<option value="">— Selecione o produto —</option>'}${opsProd}</select>
          ${prodAtual ? '<div class="cq-nota">O produto não muda depois do cadastro do lote. Lote no produto errado: encerre-o (ou exclua, se não tiver lançamentos) e cadastre-o no produto certo.</div>' : ''}</div>
        <div class="form-row">
          <div class="form-field"><label class="field-label">Lote <span class="required">*</span></label><input type="text" id="cq-ins-lote" class="field-input" maxlength="60" value="${_cqEsc(i?.lote)}" placeholder="Ex.: 610061" ${i || !pode ? 'disabled' : ''}></div>
          <div class="form-field"><label class="field-label">Validade <span class="required">*</span></label><input type="date" id="cq-ins-val" class="field-input" value="${_cqEsc(i?.validade)}" ${_cqRo(pode)}></div>
        </div>
        <div class="form-field"><label class="field-label">Situação</label><select id="cq-ins-status" class="field-select" ${_cqRo(pode)}>${_cqMapOptions(CQ_STATUS_LOTE, i?.status || 'em_uso', null)}</select>
          <div class="cq-nota">Vencido o lote, a situação passa a “Encerrado” automaticamente.</div></div>
        <div class="form-field" id="cq-ins-unico-wrap" style="${p0?.preparoInterno ? '' : 'display:none;'}">
          <label class="oc-check"><input type="checkbox" id="cq-ins-unico" ${i?.preparoUsoUnico ? 'checked' : ''} ${_cqRo(pode)}> Preparo de uso único — um preparo novo a cada corrida</label>
          <div class="cq-nota">O lançamento não oferece preparos anteriores: cada corrida registra o seu (data e responsável), avaliado pela decisão dela.</div></div>
        ${_cqUnidadesCampoHTML('cq-ins-un', i, pode, 'Unidades que usam este lote (precisam estar entre as do produto). O lote só é oferecido nos lançamentos delas.', 'insumos')}
        <div class="form-field"><label class="field-label">Observações</label><textarea id="cq-ins-obs" class="field-textarea" style="min-height:50px;" ${_cqRo(pode)}>${_cqEsc(i?.observacoes)}</textarea></div>
      </div>
` }, i?.preparoInterno && { k: 'preparos', rotulo: `Preparos${_cqPreparosDe(i).length ? ` <span class="cq-step-qtd">${_cqPreparosDe(i).length}</span>` : ''}`, html: _cqPreparosHistoricoHTML(i) },
      _cqAbaTrilha(i)], opts.aba),
    rodape: _cqRodapeForm('cqInsumoSalvar()', pode, i ? `cqExcluirCadastro('insumos','${i.id}')` : ''),
  });
}

// Uso único só faz sentido em produto preparado no laboratório
function cqInsumoProdChange() {
  const w = document.getElementById('cq-ins-unico-wrap');
  if (w) w.style.display = cqState.config.insumoProdutos[_cqVal('cq-ins-prod')]?.preparoInterno ? '' : 'none';
}

async function cqInsumoSalvar() {
  if (_cqSalvando) return;
  const antes = _cqInsumoFormId ? cqState.config.insumos[_cqInsumoFormId] : null;
  const cruA = antes ? _cqLoteCru(antes) : null;
  // Produto fixo depois do cadastro do lote (lote antigo, sem produto, escolhe uma vez)
  const produtoId = cruA?.produtoId && cqState.config.insumoProdutos[cruA.produtoId] ? cruA.produtoId : _cqVal('cq-ins-prod');
  const prod = cqState.config.insumoProdutos[produtoId];
  const lote = antes ? antes.lote : _cqVal('cq-ins-lote'), validade = _cqVal('cq-ins-val');
  if (!prod) { showToast('Selecione o produto.', 'error'); return; }
  if (!lote || !validade) { showToast('Informe lote e validade.', 'error'); return; }
  const norm = x => _cqNormBusca(String(x || '').trim());
  const dup = Object.values(cqState.config.insumos).find(x => x.id !== antes?.id && _cqLoteCru(x).produtoId === produtoId && norm(x.lote) === norm(lote));
  if (dup) { if (antes || !_cqOferecerAssociar('insumos', dup, `${prod.nome} — lote ${dup.lote}`)) showToast('Lote já cadastrado para este produto.', 'error'); return; }
  const unidadeIds = _cqUnidadesCapturar('cq-ins-un', 'insumos', antes);
  if (!unidadeIds) return;
  const foraProd = _cqUnidadesRec(prod).length ? unidadeIds.filter(x => !_cqUnidadesRec(prod).includes(x)) : [];
  if (foraProd.length) { showToast(`O produto ${prod.nome} não está associado à(s) unidade(s) ${_cqSiglasUnidades(foraProd)}. Associe o produto antes.`, 'error'); return; }
  // O registro do lote guarda só os dados do lote; os do produto vêm do cadastro dele.
  // Lote antigo: data/responsável do preparo do cadastro viram `preparoLegado` (primeiro preparo no próximo uso).
  const base = { ...(cruA || {}) };
  CQ_CAMPOS_PRODUTO.forEach(k => { delete base[k]; });
  delete base.ativoId;
  if (cruA && !cruA.produtoId && cruA.preparo?.data && !cruA.preparoLegado) base.preparoLegado = { data: cruA.preparo.data, responsavel: cruA.preparo.responsavel || '' };
  const rec = { ...base, id: _cqInsumoFormId || _cqUid(), produtoId, lote, validade, status: _cqVal('cq-ins-status') || 'em_uso',
                observacoes: _cqVal('cq-ins-obs'), unidadeIds, preparoUsoUnico: !!prod.preparoInterno && _cqChk('cq-ins-unico') };
  if (rec.status !== 'encerrado') delete rec.encerradoAuto;   // reaberto: o gatilho volta a valer
  if (!antes) { rec.criadoEm = _cqAgora(); rec.criadoPor = _cqAssinatura(); }
  const fmt = { produtoId: v => cqState.config.insumoProdutos[v]?.nome || v, status: v => CQ_STATUS_LOTE[v]?.label || v, unidadeIds: _cqSiglasUnidades, preparoUsoUnico: v => v ? 'Sim' : 'Não' };
  const diffs = antes ? _cqDiff(cruA, rec, CQ_LBL_INSUMO, fmt) : [];
  if (antes && !diffs.length) { cqDrawerClose(); return; }
  const legado = antes && !cruA.produtoId;
  _cqTrilhaAdd(rec, antes ? 'edicao' : 'criacao', !antes ? 'Lote de insumo cadastrado'
    : legado ? `Lote organizado no produto ${prod.nome} (antes: ${[CQ_TIPOS_INSUMO[cruA.tipo] || cruA.tipo, cruA.nome, cruA.fabricante, _cqEquipsInsumo(cruA).map(_cqRotuloEquip).join(', '), _cqArr(cruA.analitoIds).map(a => _cqAnalito(a)?.nome || a).join(', '), cruA.preparoInterno ? 'preparo: ' + _cqFmtPreparo(cruA.preparo) : ''].filter(Boolean).join(' · ')})`
    : 'Lote de insumo alterado', diffs);
  _cqSalvando = true;
  try {
    if (await _cqSalvarRegistro('insumos', rec)) { showToast('Lote salvo.', 'success'); cqDrawerClose(); cqRender(); }
  } finally { _cqSalvando = false; }
}

// ── ORGANIZAR LOTES ANTIGOS EM PRODUTOS ──────────────────────
// Antes, cada lote trazia tipo, nome, fabricante, equipamentos, analitos e preparo. Lotes com o mesmo
// tipo, nome, equipamentos/sistemas, analitos e preparo interno formam um produto; diferença em algum
// desses campos (que decidem em quais testes o lote é oferecido) gera produtos separados, para não
// mudar o que o lançamento oferece. Fabricante/ANVISA/dados do preparo divergentes: vale o lote mais recente.
function _cqInsumosLegados() { return Object.values(cqState.config.insumos).filter(i => !_cqProdutoInsumo(i)); }

function cqInsumosOrganizar() {
  if (!_cqCan('configurar')) return;
  const legados = _cqInsumosLegados();
  if (!legados.length) { showToast('Não há lotes antigos para organizar.', 'success'); return; }
  const norm = x => _cqNormBusca(String(x || '').trim());
  const chave = x => [x.tipo || 'reagente', norm(x.nome), _cqEquipsInsumo(x).map(_cqEquipChave).sort().join(','), _cqArr(x.analitoIds).slice().sort().join(','), x.preparoInterno ? 1 : 0].join('|');
  const grupos = new Map();
  legados.forEach(i => { const k = chave(i); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(i); });
  const existentes = Object.values(cqState.config.insumoProdutos);
  const plano = [...grupos.entries()].map(([k, ls]) => {
    ls.sort((a, b) => (b.validade || '').localeCompare(a.validade || '') || (b.criadoEm || '').localeCompare(a.criadoEm || ''));
    const ref = ls[0];
    const prim = c => ls.map(i => String(i[c] || '').trim()).find(Boolean) || '';
    const distintos = c => [...new Set(ls.map(i => String(i[c] || '').trim()).filter(Boolean))];
    const conflitos = [['fabricante', 'Fabricante'], ['regAnvisa', 'Registro ANVISA']].filter(([c]) => distintos(c).length > 1).map(([c, l]) => `${l}: ${distintos(c).join(' / ')} — vale “${prim(c)}”`);
    let preparo = null;
    if (ref.preparoInterno) {
      const pr = ls.map(i => i.preparo).find(x => x && (x.armazenamento || x.especificacao)) || ref.preparo || {};
      preparo = { especificacao: pr.especificacao || '', armazenamento: pr.armazenamento || '', riscos: pr.riscos || '', validadeDias: pr.validadeDias ?? null };
      if (new Set(ls.map(i => _cqFmtPreparo({ ...i.preparo, data: null }))).size > 1) conflitos.push(`Dados do preparo diferentes entre os lotes — vale “${_cqFmtPreparo(preparo)}”`);
    }
    // Lote sem unidade aparece em todas: o produto também fica sem unidade
    const us = ls.some(_cqSemUnidade) ? [] : [...new Set(ls.flatMap(_cqUnidadesRec))];
    const ex = existentes.find(p => chave(p) === k) || null;
    const addUs = ex && _cqUnidadesRec(ex).length ? (us.length ? us.filter(x => !_cqUnidadesRec(ex).includes(x)) : null) : [];
    const prod = ex || { id: _cqUid(), tipo: ref.tipo || 'reagente', nome: String(ref.nome || '').trim(), fabricante: prim('fabricante'), regAnvisa: prim('regAnvisa'),
                         equips: _cqEquipsInsumo(ref), analitoIds: _cqArr(ref.analitoIds), preparoInterno: !!ref.preparoInterno, preparo, unidadeIds: us, ativo: true };
    return { ls, ex, addUs, prod, conflitos };
  }).sort((a, b) => (a.prod.nome || '').localeCompare(b.prod.nome || '', 'pt'));
  const nomesRepetidos = new Set(plano.map(x => norm(x.prod.nome)).filter((n, i, arr) => arr.indexOf(n) !== i));
  // Testes que guardam só o nome do produto: vinculados quando um único produto do plano (ou existente) serve a eles
  const candidatos = [...existentes, ...plano.filter(x => !x.ex).map(x => x.prod)];
  const testesVinc = Object.values(cqState.config.testes).filter(t => t.insumoProduto && !cqState.config.insumoProdutos[t.insumoProdutoId]).map(t => {
    let c = candidatos.filter(p => p.tipo === t.insumoTipo && norm(p.nome) === norm(t.insumoProduto) && _cqMaterialServe(p, _cqEquipDoTeste(t), t.analitoId) && (_cqSemUnidade(p) || _cqUnidadesRec(p).includes(t.unidadeId)));
    // Mais de um: fica o que tem lote não encerrado na unidade do teste
    if (c.length > 1) {
      const lotesDe = p => [..._cqLotesDoProduto(p.id), ...(plano.find(x => x.prod === p)?.ls || [])];
      c = c.filter(p => lotesDe(p).some(l => l.status !== 'encerrado' && _cqNaUnidade(l, t.unidadeId)));
    }
    return c.length === 1 ? { t, p: c[0] } : null;
  }).filter(Boolean);
  const nNovos = plano.filter(x => !x.ex).length;
  const corpo = `<div class="cq-nota">Cada produto passa a concentrar tipo, fabricante, ANVISA, equipamentos/sistemas, analitos e preparo; o lote fica com número, validade, situação, unidades e preparos.
      Lotes de mesmo nome com equipamentos, analitos ou preparo diferentes viram produtos separados, para não mudar o que é oferecido nos lançamentos.
      Os ids dos lotes não mudam: corridas, resultados e preparos já lançados continuam ligados a eles. Tudo fica registrado na rastreabilidade.</div>
    ${plano.map(x => `<details class="cq-assoc-sec" ${x.conflitos.length || nomesRepetidos.has(norm(x.prod.nome)) ? 'open' : ''}><summary><b>${_cqEsc(x.prod.nome)}</b> · ${_cqEsc(CQ_TIPOS_INSUMO[x.prod.tipo] || x.prod.tipo)} · ${x.ls.length} lote(s)
        ${x.ex ? ' <span class="cq-badge cq-st-aceito">produto existente</span>' : ' <span class="cq-badge cq-st-pendente">novo produto</span>'}${x.conflitos.length ? ' <span class="cq-badge cq-st-alerta">revisar</span>' : ''}</summary>
      <div class="cq-assoc-item"><span>Equipamentos / analitos</span><b>${_cqEsc([_cqEquipsInsumo(x.prod).map(_cqRotuloEquip).join(', ') || 'Qualquer equipamento', _cqArr(x.prod.analitoIds).map(a => _cqAnalito(a)?.nome || '?').join(', ') || 'todos os analitos'].join(' · '))}</b></div>
      ${!x.ex ? `<div class="cq-assoc-item"><span>Fabricante / unidades</span><b>${_cqEsc([x.prod.fabricante || '—', _cqUnidadesRec(x.prod).length ? _cqSiglasUnidades(_cqUnidadesRec(x.prod)) : 'todas (sem unidade)'].join(' · '))}</b></div>` : ''}
      ${x.addUs?.length ? `<div class="cq-assoc-item"><span>Produto passa a valer também em</span><b>${_cqEsc(_cqSiglasUnidades(x.addUs))}</b></div>` : ''}
      ${x.ls.map(l => `<div class="cq-assoc-item"><span>Lote ${_cqEsc(l.lote)} · val. ${_cqFmtData(l.validade)}</span><b>${_cqEsc(CQ_STATUS_LOTE[l.status || 'em_uso']?.label || l.status)}</b></div>`).join('')}
      ${x.conflitos.map(c => `<div class="cq-nota cq-txt-amarelo">${_cqEsc(c)}</div>`).join('')}
      ${nomesRepetidos.has(norm(x.prod.nome)) ? '<div class="cq-nota cq-txt-amarelo">Há outro produto com este nome e configuração diferente. Se for o mesmo produto, depois ajuste equipamentos/analitos e mova os lotes pelo cadastro do lote.</div>' : ''}
    </details>`).join('')}
    ${testesVinc.length ? `<div class="cq-nota" style="margin-top:10px;">${testesVinc.length} teste(s) passarão a apontar para o produto pelo cadastro (não só pelo nome): ${_cqEsc(testesVinc.map(x => _cqNomeTeste(x.t)).join('; '))}.</div>` : ''}`;
  _cqPrompt({
    titulo: 'Organizar lotes antigos em produtos', subtitulo: `${legados.length} lote(s) → ${plano.length} produto(s) (${nNovos} novo(s))`, corpo, confirmar: 'Organizar',
    onConfirm: async () => {
      if (!_cqPodeGravar()) return false;
      const updates = {};
      const agora = _cqAgora();
      const C = CQ_KEYS.config;
      plano.forEach(x => {
        if (!x.ex) {
          const rec = { ...x.prod, criadoEm: agora, criadoPor: _cqAssinatura(), atualizadoEm: agora };
          _cqTrilhaAdd(rec, 'migracao', `Produto criado a partir de ${x.ls.length} lote(s) antigo(s): ${x.ls.map(l => l.lote).join(', ')}${x.conflitos.length ? '. ' + x.conflitos.join('; ') : ''}`);
          updates[`${C}/insumoProdutos/${rec.id}`] = rec;
        } else {
          const ps = `${C}/insumoProdutos/${x.ex.id}`;
          if (x.addUs === null) updates[`${ps}/unidadeIds`] = [];
          else if (x.addUs.length) updates[`${ps}/unidadeIds`] = [..._cqUnidadesRec(x.ex), ...x.addUs];
          updates[`${ps}/atualizadoEm`] = agora;
          updates[`${ps}/trilha/${_cqTk()}${x.ex.id.slice(-3)}`] = _cqTrilhaEntry('migracao', `Recebeu ${x.ls.length} lote(s) antigo(s): ${x.ls.map(l => l.lote).join(', ')}${x.addUs === null ? '; passa a valer em todas as unidades (lote sem unidade)' : x.addUs.length ? `; passa a valer também em ${_cqSiglasUnidades(x.addUs)}` : ''}`);
        }
        x.ls.forEach(l => {
          const cru = _cqLoteCru(l);
          const pl = `${C}/insumos/${l.id}`;
          updates[`${pl}/produtoId`] = x.prod.id;
          CQ_CAMPOS_PRODUTO.forEach(k => { updates[`${pl}/${k}`] = null; });
          updates[`${pl}/ativoId`] = null;
          if (cru.preparo?.data && !cru.preparoLegado) updates[`${pl}/preparoLegado`] = { data: cru.preparo.data, responsavel: cru.preparo.responsavel || '' };
          updates[`${pl}/atualizadoEm`] = agora;
          updates[`${pl}/trilha/${_cqTk()}${l.id.slice(-3)}`] = _cqTrilhaEntry('migracao', `Lote organizado no produto ${x.prod.nome} (antes no lote: ${[CQ_TIPOS_INSUMO[cru.tipo] || cru.tipo, cru.nome, cru.fabricante, cru.regAnvisa ? 'ANVISA ' + cru.regAnvisa : '', _cqEquipsInsumo(cru).map(_cqRotuloEquip).join(', '), _cqArr(cru.analitoIds).map(a => _cqAnalito(a)?.nome || a).join(', '), cru.preparoInterno ? 'preparo: ' + _cqFmtPreparo(cru.preparo) : ''].filter(Boolean).join(' · ')})`);
        });
      });
      testesVinc.forEach(({ t, p }) => {
        const pt = `${C}/testes/${t.id}`;
        updates[`${pt}/insumoProdutoId`] = p.id;
        updates[`${pt}/trilha/${_cqTk()}${t.id.slice(-3)}`] = _cqTrilhaEntry('migracao', `Produto controlado vinculado ao cadastro do produto ${p.nome}`);
      });
      updates[`${C}/migracoes/insumoProdutos`] = { em: agora, porNome: _cqSess().nome, versao: CQ_VERSAO, lotes: legados.length, produtos: nNovos };
      if (!(await window.dbUpdate(updates))) { showToast('Falha ao gravar. Nada foi alterado.', 'error'); return false; }
      showToast(`${legados.length} lote(s) organizados em ${plano.length} produto(s).`, 'success');
      cqRender();
      return true;
    },
  });
}

// ── PREPAROS DE INSUMO (RDC 978, art. 101) ───────────────────
// insumos/{id}/preparos/{pid}: { data, responsavel, validade, situacao, avaliacao, corridas:{ck:…} }.
// O preparo nasce no lançamento; a primeira decisão sobre uma corrida que o usa o libera ou reprova.
const CQ_SITUACAO_PREPARO = {
  em_avaliacao: { label: 'Em avaliação', cls: 'cq-st-pendente' }, liberado: { label: 'Liberado', cls: 'cq-st-aceito' }, reprovado: { label: 'Reprovado', cls: 'cq-st-rejeitado' },
};
function _cqSomarDias(iso, dias) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + dias));
  return d.toISOString().slice(0, 10);
}
// Validade do preparado: data + dias do cadastro, limitada à validade do produto
function _cqPrepValidade(ins, data) {
  const dias = Number(ins?.preparo?.validadeDias);
  if (!data || !(dias > 0)) return ins?.validade || null;
  const v = _cqSomarDias(data, dias);
  return ins?.validade && ins.validade < v ? ins.validade : v;
}
function _cqPreparosDe(ins) {
  const lista = Object.values(ins?.preparos || {}).filter(p => p && p.id);
  // Cadastro antigo (data/responsável no insumo): vira o primeiro preparo, gravado no próximo uso
  const leg = ins?.preparoLegado || ins?.preparo;
  if (!lista.length && leg?.data) lista.push({ id: 'legado', data: leg.data, responsavel: leg.responsavel || '', situacao: 'liberado', legado: true });
  return lista.map(p => ({ ...p, validade: p.validade || _cqPrepValidade(ins, p.data) }))
    .sort((a, b) => (b.data || '').localeCompare(a.data || '') || (b.criadoEm || '').localeCompare(a.criadoEm || ''));
}
function _cqPreparo(ins, id) { return id ? _cqPreparosDe(ins).find(p => p.id === id) || null : null; }
// Finalizado (consumido, descartado ou de uso único já lançado): sai do lançamento; a situação (liberado/reprovado) é mantida
function _cqPrepUsavel(p, dia) { return !!p && !p.finalizado && p.situacao !== 'reprovado' && !(p.validade && dia && p.validade < dia); }
function _cqPrepFinalizadoTxt(p) {
  const f = p?.finalizado;
  if (!f) return '';
  return `${f.auto ? 'finalizado automaticamente' : `finalizado por ${f.porNome || '—'}`} em ${_cqFmtDH(f.em)}${f.motivo ? ` — ${f.motivo}` : ''}`;
}
function _cqPrepTxt(p) { return p ? `${_cqFmtData(p.data)} · ${p.responsavel || '—'}` : ''; }

// Quem pode alterar a situação de um preparo (equivale a decidir sobre o controle dele)
function _cqPodeSituacaoPreparo() { return _cqCan('liberar') || _cqCan('configurar'); }
// Origem da situação atual: decisão de corrida ou alteração manual
function _cqPrepAvaliacaoTxt(p) {
  const a = p?.avaliacao;
  if (!a) return '';
  return a.manual ? `alterado por ${a.porNome || '—'} em ${_cqFmtDH(a.em)}` : `decisão da corrida ${a.numero || ''}${a.porNome ? ' · ' + a.porNome : ''}`;
}
// Selo da situação; clicável para alterar quando há permissão (onde: 'lote' | 'lanc' | 'info')
function _cqPrepSituacaoBtn(i, p, onde) {
  const sit = CQ_SITUACAO_PREPARO[p.situacao || 'em_avaliacao'];
  const pode = _cqPodeSituacaoPreparo() && !p.legado && !p.novo;
  const rot = `${_cqEsc(sit.label)}${p.finalizado ? ' · finalizado' : ''}`;
  const cls = p.finalizado ? 'cq-st-semalvo' : sit.cls;
  return pode ? `<button type="button" class="cq-badge ${cls} cq-prep-sit" title="Alterar situação ou finalizar o preparo" onclick="event.stopPropagation();cqPreparoSituacao('${i.id}','${p.id}','${onde}')">${rot}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="6 9 12 15 18 9"/></svg></button>`
    : `<span class="cq-badge ${cls}">${rot}</span>`;
}
function _cqPreparosHistoricoHTML(i) {
  const ps = _cqPreparosDe(i);
  const hoje = _cqHoje();
  if (!ps.length) return `<div class="cq-nota">Nenhum preparo registrado. ${i.preparoUsoUnico ? 'Lote de uso único: cada corrida registra o seu preparo.' : 'O primeiro é criado no lançamento da corrida (“+ Novo preparo”).'}</div>`;
  const item = p => {
    const nC = Object.keys(p.corridas || {}).length;
    const venc = !p.finalizado && p.validade && p.validade < hoje;
    const sub = [`${nC} corrida(s)`, p.finalizado ? _cqPrepFinalizadoTxt(p) : _cqPrepAvaliacaoTxt(p), p.legado ? 'cadastro antigo' : ''].filter(Boolean).join(' · ');
    return `<div class="cq-prep-item${p.finalizado ? ' finalizado' : ''}">
      <div class="cq-prep-data"><b>${_cqFmtData(p.data)}</b><small class="${venc ? 'cq-txt-vermelho' : ''}" title="Validade do preparado">val. ${_cqFmtData(p.validade)}</small></div>
      <div class="cq-prep-info"><span title="${_cqEsc(p.responsavel || '')}">${_cqEsc(p.responsavel || '—')}</span><small title="${_cqEsc(sub)}">${_cqEsc(sub)}</small></div>
      ${_cqPrepSituacaoBtn(i, p, 'lote')}
      <button type="button" class="cq-icobtn" title="Imprimir rótulo" onclick="cqImprimirRotulo('${i.id}','${p.id}')">${CQ_ICO.print}</button>
    </div>`;
  };
  const ativos = ps.filter(p => !p.finalizado), fins = ps.filter(p => p.finalizado);
  return `${i.preparoUsoUnico ? '<div class="cq-nota" style="margin-bottom:8px;">Lote de uso único: um preparo por corrida, finalizado automaticamente ao registrar a corrida.</div>' : ''}
    ${ativos.length ? `<div class="cq-prep-lista">${ativos.map(item).join('')}</div>` : '<div class="cq-nota">Nenhum preparo em uso: o próximo é registrado no lançamento da corrida.</div>'}
    ${fins.length ? `<details class="cq-prep-fins"${ativos.length ? '' : ' open'}><summary>Finalizados (${fins.length})</summary><div class="cq-prep-lista">${fins.map(item).join('')}</div></details>` : ''}
    ${_cqPodeSituacaoPreparo() ? '<div class="cq-nota" style="margin-top:8px;">Clique na situação para alterá-la ou finalizar o preparo (com justificativa). Preparos finalizados ou reprovados não são oferecidos nos lançamentos.</div>' : ''}`;
}

// Altera a situação de um preparo (aba Preparos do lote, lançamento da corrida ou informações do preparo)
function cqPreparoSituacao(insId, prepId, onde) {
  if (!_cqPodeSituacaoPreparo()) { showToast('Sem permissão para alterar a situação do preparo.', 'error'); return; }
  const i = cqState.config.insumos[insId];
  const p = i ? _cqPreparo(i, prepId) : null;
  if (!p || p.legado) { showToast('Preparo do cadastro antigo: a situação é registrada no primeiro uso dele.', 'error'); return; }
  if (onde === 'info') cqModalClose();
  const atual = p.situacao || 'em_avaliacao';
  const finAtual = !!p.finalizado;
  _cqPrompt({
    titulo: 'Situação do preparo', subtitulo: `${i.nome} · lote ${i.lote} · preparo de ${_cqFmtData(p.data)}`,
    corpo: `<div class="form-field"><label class="field-label">Situação</label>
        <select id="cq-prep-sit" class="field-select">${_cqMapOptions(CQ_SITUACAO_PREPARO, atual, null)}</select>
        ${p.avaliacao ? `<div class="cq-nota">Atual: ${_cqEsc(CQ_SITUACAO_PREPARO[atual]?.label || atual)} — ${_cqEsc(_cqPrepAvaliacaoTxt(p))}.</div>` : ''}</div>
      <label class="oc-check"><input type="checkbox" id="cq-prep-fin" ${finAtual ? 'checked' : ''}> Preparo finalizado (consumido ou descartado) — não aparece mais nos lançamentos</label>
      ${finAtual ? `<div class="cq-nota">${_cqEsc(_cqPrepFinalizadoTxt(p))}. Desmarque para reabrir.</div>` : ''}
      <div class="form-field" style="margin-top:10px;"><label class="field-label">Justificativa <span class="required">*</span></label>
        <textarea id="cq-prep-just" class="field-textarea" style="min-height:70px;" placeholder="Ex.: esterilidade lida após 48 h sem crescimento; preparo liberado. / Placas consumidas."></textarea></div>
      <div class="cq-nota">Reprovado ou finalizado: deixa de ser oferecido nos lançamentos. Corridas que já usaram o preparo não mudam.</div>`,
    confirmar: 'Salvar',
    onConfirm: async () => {
      const sit = _cqVal('cq-prep-sit'), just = _cqVal('cq-prep-just'), fin = _cqChk('cq-prep-fin');
      if (sit === atual && fin === finAtual) { showToast('Nada mudou: altere a situação ou a finalização.', 'error'); return false; }
      if (!just) { showToast('Informe a justificativa.', 'error'); return false; }
      if (!_cqPodeGravar()) return false;
      const ass = _cqAssinatura();
      const pb = `${CQ_KEYS.config}/insumos/${insId}/preparos/${prepId}`;
      const de = CQ_SITUACAO_PREPARO[atual]?.label || atual, para = CQ_SITUACAO_PREPARO[sit]?.label || sit;
      const updates = {};
      const diffs = [];
      const avaliacao = sit !== atual ? { manual: true, acao: sit, motivo: just, ...ass } : null;
      if (avaliacao) {
        updates[`${pb}/situacao`] = sit;
        updates[`${pb}/avaliacao`] = avaliacao;
        diffs.push({ campo: 'Situação do preparo', antes: de, depois: para });
      }
      const finalizado = fin ? (finAtual ? p.finalizado : { auto: false, motivo: just, ...ass }) : null;
      if (fin !== finAtual) {
        updates[`${pb}/finalizado`] = finalizado;
        diffs.push({ campo: 'Preparo finalizado', antes: finAtual ? 'Sim' : 'Não', depois: fin ? 'Sim' : 'Não' });
      }
      updates[`${pb}/historico/${_cqTk()}`] = { de: atual, para: sit, finalizado: fin, motivo: just, ...ass };
      updates[`${CQ_KEYS.config}/insumos/${insId}/atualizadoEm`] = ass.em;
      updates[`${CQ_KEYS.config}/insumos/${insId}/trilha/${_cqTk()}`] = _cqTrilhaEntry('edicao', `Preparo de ${_cqFmtData(p.data)} ${fin && !finAtual ? 'finalizado' : !fin && finAtual ? 'reaberto' : 'alterado'}: ${just}`, diffs);
      if (!(await window.dbUpdate(updates))) { showToast('Falha ao gravar. Verifique a conexão.', 'error'); return false; }
      const cru = _cqLoteCru(i).preparos?.[prepId];
      if (cru) { if (avaliacao) { cru.situacao = sit; cru.avaliacao = avaliacao; } cru.finalizado = finalizado; }
      showToast(fin && !finAtual ? 'Preparo finalizado.' : !fin && finAtual ? 'Preparo reaberto.' : `Preparo ${para.toLowerCase()}.`, 'success');
      if (onde === 'lote') cqInsumoForm(insId, { aba: 'preparos' });
      else if (onde === 'lanc' && typeof _cqLancRedesenharGrade === 'function') _cqLancRedesenharGrade();
      return true;
    },
  });
}

// Informações do preparo (botão ⓘ do lançamento)
function cqPreparoInfo(insId, prepId, dataNovo, respNovo) {
  const i = cqState.config.insumos[insId];
  if (!i) return;
  const pf = i.preparo || {};
  const p = prepId === 'novo' ? { data: dataNovo, responsavel: respNovo, situacao: 'em_avaliacao', novo: true, validade: _cqPrepValidade(i, dataNovo) } : _cqPreparo(i, prepId);
  const lin = (l, v) => `<div class="cq-info-lin"><span>${l}</span><b>${v || '—'}</b></div>`;
  const corridas = Object.values(p?.corridas || {}).sort((a, b) => (b.dataHora || '').localeCompare(a.dataHora || ''));
  cqModalOpen({
    titulo: `${i.nome} · lote ${i.lote}`, subtitulo: 'Preparo no laboratório (RDC 978, art. 101)', icone: 'beaker',
    corpo: `<div class="cq-info-grid">
        ${lin('Tipo', _cqEsc(CQ_TIPOS_INSUMO[i.tipo] || i.tipo))}${lin('Lote do produto', `${_cqEsc(i.lote)} · val. ${_cqFmtData(i.validade)}`)}
        ${lin('Concentração / especificação', _cqEsc(pf.especificacao))}${lin('Armazenamento', _cqEsc(pf.armazenamento))}
        ${lin('Riscos', _cqEsc(pf.riscos || 'Ver FISPQ'))}${lin('Validade após preparo', pf.validadeDias ? `${pf.validadeDias} dia(s)` : 'a do produto')}
        ${i.preparoUsoUnico ? lin('Uso', 'Único — um preparo por corrida') : ''}
      </div>
      <div class="cq-sec-titulo" style="margin-top:14px;">${p?.novo ? 'Novo preparo (será registrado ao salvar a corrida)' : 'Preparo selecionado'}</div>
      ${p ? `<div class="cq-info-grid">${lin('Data do preparo', _cqFmtData(p.data))}${lin('Responsável', _cqEsc(p.responsavel))}
          ${lin('Validade do preparado', _cqFmtData(p.validade))}${lin('Situação', _cqPrepSituacaoBtn(i, p, 'info'))}
          ${p.avaliacao ? lin(p.avaliacao.manual ? 'Situação definida' : 'Avaliado', _cqEsc(_cqPrepAvaliacaoTxt(p)) + (p.avaliacao.motivo ? `<div class="cq-muted">${_cqEsc(p.avaliacao.motivo)}</div>` : '')) : ''}
          ${p.finalizado ? lin('Finalizado', _cqEsc(_cqPrepFinalizadoTxt(p))) : ''}
          ${lin('Corridas que usaram', String(corridas.length))}</div>
        ${corridas.length ? `<div class="cq-muted" style="margin-top:6px;font-size:12px;">${corridas.slice(0, 8).map(c => `${_cqEsc(c.numero || '')} (${_cqFmtDH(c.dataHora)})`).join(' · ')}${corridas.length > 8 ? '…' : ''}</div>` : ''}`
        : '<div class="cq-nota">Nenhum preparo selecionado.</div>'}`,
    rodape: `<div></div><div style="display:flex;gap:8px;">${p && !p.novo ? `<button class="btn btn-outline" onclick="cqImprimirRotulo('${i.id}','${p.id}')">${CQ_ICO.print} Imprimir rótulo</button>` : ''}
      <button class="btn btn-outline" onclick="cqModalClose()">Fechar</button></div>`,
  });
  document.getElementById('cq-modal-foot').style.justifyContent = 'space-between';
}

// Rótulo do reagente/insumo preparado no laboratório (RDC 978, art. 101, I a VIII)
function cqImprimirRotulo(id, prepId) {
  const i = cqState.config.insumos[id];
  if (!i?.preparoInterno) return;
  const pf = i.preparo || {};
  const pr = _cqPreparo(i, prepId) || _cqPreparosDe(i)[0] || {};
  const p = { ...pf, data: pr.data, responsavel: pr.responsavel };
  const un = _cqUnidade();
  const linha = (l, v) => v ? `<div><b>${l}:</b> ${_cqEsc(v)}</div>` : '';
  const rot = `<div class="rot"><div class="t">${_cqEsc(i.nome)}</div>
    ${linha('Especificação', p.especificacao)}${linha('Lote', i.lote)}${linha('Preparo', _cqFmtData(p.data))}
    ${linha('Validade', _cqFmtData(pr.validade || i.validade))}${linha('Preparado por', p.responsavel)}${linha('Armazenar', p.armazenamento)}
    ${linha('Riscos', p.riscos || 'Ver FISPQ')}${un ? `<div class="u">${_cqEsc(un.sigla)} — ${_cqEsc(un.nome)}</div>` : ''}</div>`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Rótulo ${_cqEsc(i.lote)}</title>
    <style>@page{margin:8mm}body{font:10px/1.3 system-ui,sans-serif;color:#000;display:flex;flex-wrap:wrap;gap:4mm}
    .rot{width:62mm;border:1px solid #000;padding:2.5mm;box-sizing:border-box;page-break-inside:avoid}.t{font-weight:700;font-size:11.5px;margin-bottom:1mm}.u{margin-top:1mm;font-size:8.5px;color:#333}</style></head>
    <body>${rot.repeat(8)}<script>window.onload=()=>window.print()<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { showToast('Permita pop-ups para imprimir.', 'error'); return; }
  w.document.write(html);
  w.document.close();
}

// Insumos utilizáveis num teste (validade e situação); `produto` é o id do produto (só os lotes dele)
// ou, em testes antigos, o nome do insumo; `equipTeste` restringe ao equipamento/sistema do teste
// ('a:…' | 'm:…'; insumos sem equipamento servem a qualquer um)
function _cqInsumosPara(analitoId, tipo, produto, equipTeste, u, dia) {
  const hoje = dia || _cqHoje();
  // Encerrado pelo gatilho de vencimento continua valendo para corrida datada até a validade
  const aberto = i => i.status !== 'encerrado' || (!!i.encerradoAuto && !!dia && !!i.validade && i.validade >= dia);
  const pr = produto ? cqState.config.insumoProdutos[produto] : null;
  if (pr) {
    return _cqDaUnidade('insumos', u).filter(i => _cqLoteCru(i).produtoId === pr.id && aberto(i))
      .map(i => ({ ...i, vencido: !!(i.validade && i.validade < hoje), bloqueado: i.status === 'quarentena' }))
      .sort((a, b) => (b.validade || '').localeCompare(a.validade || ''));
  }
  const prod = (produto || '').trim().toLowerCase();
  return _cqDaUnidade('insumos', u)
    .filter(i => i.tipo === tipo && (!_cqArr(i.analitoIds).length || _cqArr(i.analitoIds).includes(analitoId)))
    .filter(i => { const eqs = _cqEquipsInsumo(i); return !eqs.length || !equipTeste || eqs.some(k => _cqEquipChave(k) === _cqEquipChave(equipTeste)); })
    .filter(i => !prod || (i.nome || '').trim().toLowerCase() === prod)
    .filter(aberto)
    .map(i => ({ ...i, vencido: !!(i.validade && i.validade < hoje), bloqueado: i.status === 'quarentena' }))
    .sort((a, b) => (b.validade || '').localeCompare(a.validade || ''));
}

// Por que nenhum lote aparece para o teste: aponta o critério que exclui o lote mais próximo
function _cqInsumosDiagnostico(t, tipo, u) {
  const pr = cqState.config.insumoProdutos[t.insumoProdutoId];
  if (pr) {
    const ls = _cqLotesDoProduto(pr.id);
    if (!ls.length) return `nenhum lote do produto ${pr.nome} — cadastre em “Reagentes, meios e insumos”.`;
    if (!ls.some(i => _cqNaUnidade(i, u))) return `nenhum lote de ${pr.nome} associado a esta unidade.`;
    return `todos os lotes de ${pr.nome} desta unidade estão encerrados — cadastre o novo lote.`;
  }
  const prod = (t.insumoProduto || '').trim().toLowerCase();
  const equip = _cqEquipDoTeste(t);
  const motivos = i => {
    const m = [];
    if (!_cqNaUnidade(i, u)) m.push(`não está associado a esta unidade`);
    if (i.tipo !== tipo) m.push(`tipo "${CQ_TIPOS_INSUMO[i.tipo] || i.tipo}" ≠ "${CQ_TIPOS_INSUMO[tipo] || tipo}" do teste`);
    if (_cqArr(i.analitoIds).length && !_cqArr(i.analitoIds).includes(t.analitoId)) m.push('analito não vinculado');
    const eqs = _cqEquipsInsumo(i);
    if (eqs.length && equip && !eqs.some(k => _cqEquipChave(k) === _cqEquipChave(equip))) m.push('equipamento/sistema diferente');
    if (prod && (i.nome || '').trim().toLowerCase() !== prod) m.push(`produto "${i.nome}" ≠ "${t.insumoProduto}" exigido no teste`);
    if (i.status === 'encerrado') m.push('lote encerrado');
    return m;
  };
  const cand = Object.values(cqState.config.insumos).map(i => ({ i, m: motivos(i) })).filter(x => x.m.length)
    .sort((a, b) => a.m.length - b.m.length);
  if (!cand.length) return 'nenhum lote cadastrado';
  const c = cand[0];
  return `nenhum lote compatível — ${c.i.nome} (lote ${c.i.lote}): ${c.m.join('; ')}. Ajuste o insumo ou o teste.`;
}

// ── TESTES (analito × equipamento × método × unidade) ────────
const CQ_LBL_TESTE = {
  analitoId: 'Analito', ativoId: 'Equipamento', sistemaAnalitico: 'Sistema analítico', metodo: 'Método', niveis: 'Níveis',
  materialId: 'Material de controle', lotesAtivos: 'Lotes em uso', frequencia: 'Frequência', regrasPreset: 'Conjunto de regras',
  regras: 'Regras', opcoesRegras: 'Opções das regras', etaOverride: 'ETa específico do teste', inicioUso: 'Início de uso', ativo: 'Ativo',
  controlesQual: 'Controles e resultados esperados', insumoTipo: 'Insumo controlado', insumoProduto: 'Produto controlado', insumoProdutoId: 'Cadastro do produto controlado', exigirInsumo: 'Exigir lote do insumo',
};

// Mapa por nível sem posições vazias (o RTDB devolve {1:…,2:…} como array)
function _cqMapaNiveis(x) {
  const out = {};
  Object.entries(x || {}).forEach(([n, v]) => { if (v !== null && v !== undefined && v !== '' && Number(n) > 0) out[n] = v; });
  return out;
}
// Critérios de avaliação do teste: regras (quantitativo) ou resultados esperados (qualitativo)
function _cqCriteriosTeste(x) {
  const esperados = {};
  _cqNiveisTeste(x).forEach(n => { esperados[n] = x.controlesQual?.[n]?.esperado || ''; });
  return CQEngine.canonico({ r: x.regras || {}, o: x.opcoesRegras || {}, e: esperados });
}

let _cqTesteAnalitoFixo = null;   // teste novo criado a partir do analito

function cqTesteForm(id, aba, opts = {}) {
  const t = id ? cqState.config.testes[id] : null;
  const anFixo = !t && opts.analitoId ? cqState.config.analitos[opts.analitoId] : null;
  if (!t && !anFixo) { showToast('Crie o teste a partir do analito (aba Analitos e testes).', 'error'); return; }
  if (anFixo && !_cqEquipsDoAnalito(anFixo).length) { showToast('Vincule antes um equipamento ou sistema analítico ao analito.', 'error'); return; }
  _cqTesteAnalitoFixo = anFixo ? anFixo.id : null;
  _cqTesteFormId = id || null;
  _cqTesteFormTab = aba || 'config';
  _cqTesteDraft = t ? JSON.parse(JSON.stringify(t)) : {
    unidadeId: _cqUnidadeAtivaId(), analitoId: '', ativoId: null, sistemaAnalitico: '', metodo: '', niveis: [1, 2],
    materialId: '', lotesAtivos: {}, frequencia: { tipo: 'por_corrida', vezesDia: 1 }, regrasPreset: 'westgard_n2',
    regras: { ...CQEngine.PRESETS.westgard_n2.regras }, opcoesRegras: { gatilho12s: false, incluirRejeitados: false },
    controlesQual: {}, insumoTipo: '', insumoProduto: '', insumoProdutoId: '', exigirInsumo: false,
    inicioUso: _cqHoje(), ativo: true,
  };
  if (anFixo) {
    const d = _cqTesteDraft;
    d.analitoId = anFixo.id;
    // Um só equipamento/sistema do analito na unidade: já vem selecionado
    const eqs = _cqEquipsTodos(d.unidadeId).filter(o => _cqEquipsDoAnalito(anFixo).some(x => _cqEquipChave(x.value) === _cqEquipChave(o.value)));
    if (eqs.length === 1) { d.ativoId = eqs[0].value.startsWith('a:') ? eqs[0].value.slice(2) : null; d.sistemaAnalitico = eqs[0].value.startsWith('m:') ? eqs[0].value.slice(2) : ''; }
    _cqTesteAjustarTipo(d);
  }
  _cqTesteRender();
}

// Estrutura do teste conforme o tipo do analito (regras × resultados esperados)
function _cqTesteAjustarTipo(d) {
  const qual = _cqTesteQual(d);
  if (qual && d.regrasPreset !== 'qualitativo') {
    Object.assign(d, { niveis: [1], controlesQual: {}, lotesAtivos: {}, materialId: '', regrasPreset: 'qualitativo', regras: {}, opcoesRegras: {},
                       insumoTipo: '', insumoProduto: '', insumoProdutoId: '', metodo: '', exigirInsumo: true,
                       frequencia: { tipo: 'por_lote', vezesDia: 1 } });
  } else if (!qual && d.regrasPreset === 'qualitativo') {
    Object.assign(d, { niveis: [1, 2], controlesQual: {}, lotesAtivos: {}, regrasPreset: 'westgard_n2', regras: { ...CQEngine.PRESETS.westgard_n2.regras },
                       opcoesRegras: { gatilho12s: false, incluirRejeitados: false }, insumoTipo: '', insumoProduto: '', insumoProdutoId: '', exigirInsumo: false,
                       frequencia: { tipo: 'por_corrida', vezesDia: 1 } });
  }
}

// Troca de analito num teste novo: ajusta a estrutura (regras × resultados esperados)
function cqTesteAnalitoChange() {
  _cqTesteCapturar();
  const d = _cqTesteDraft;
  d.analitoId = _cqVal('cq-te-analito');
  _cqTesteDescartarMateriais(d);
  _cqTesteAjustarTipo(d);
  _cqTesteRender();
}

// Teste novo: primeiro o equipamento/sistema; a lista de analitos vem dos vinculados a ele
function cqTesteEquipChange() {
  _cqTesteCapturar();
  const d = _cqTesteDraft;
  const eq = d.ativoId ? 'a:' + d.ativoId : (d.sistemaAnalitico ? 'm:' + d.sistemaAnalitico : '');
  if (d.analitoId && !_cqTesteAnalitoFixo && !_cqAnalitosDoEquip(eq, d.unidadeId).some(a => a.id === d.analitoId)) {
    d.analitoId = '';
    if (document.getElementById('cq-te-analito')) document.getElementById('cq-te-analito').value = '';
  }
  _cqTesteDescartarMateriais(d);
  _cqTesteRender();
}

// Descarta material e lotes que não servem ao equipamento/sistema e ao analito escolhidos
function _cqTesteDescartarMateriais(d) {
  const eq = d.ativoId ? 'a:' + d.ativoId : (d.sistemaAnalitico ? 'm:' + d.sistemaAnalitico : '');
  if (d.materialId && !_cqMaterialServe(cqState.config.materiais[d.materialId], eq, d.analitoId)) { d.materialId = ''; d.lotesAtivos = {}; }
  Object.entries(d.controlesQual || {}).forEach(([n, c]) => {
    if (c?.materialId && !_cqMaterialServe(cqState.config.materiais[c.materialId], eq, d.analitoId)) { c.materialId = ''; delete d.lotesAtivos?.[n]; }
  });
}

// Chave de comparação: sistemas manuais sem diferença de maiúsculas/minúsculas
function _cqEquipChave(v) { return String(v || '').startsWith('m:') ? String(v).toLowerCase() : String(v || ''); }
// Equipamentos/sistemas vinculados a algum analito ativo (equipamentos restritos aos setores da unidade)
function _cqEquipsTodos(u) {
  const setores = _cqArr(cqState.config.unidades[u]?.setores);
  const mapa = new Map();
  Object.values(cqState.config.analitos).filter(a => a.ativo !== false && _cqNaUnidade(a, u)).forEach(a => _cqEquipsDoAnalito(a).forEach(o => {
    if (o.ativo && setores.length && !setores.includes(o.ativo.setor)) return;
    const k = _cqEquipChave(o.value);
    if (!mapa.has(k)) mapa.set(k, o);
  }));
  const ordem = o => (o.value.startsWith('m:') ? '1' : '0') + (o.grupo || '');
  return [...mapa.values()].sort((a, b) => ordem(a).localeCompare(ordem(b)) || a.label.localeCompare(b.label));
}
function _cqAnalitosDoEquip(eq, u) {
  if (!eq) return [];
  const k = _cqEquipChave(eq);
  return Object.values(cqState.config.analitos).filter(a => a.ativo !== false && _cqNaUnidade(a, u) && _cqEquipsDoAnalito(a).some(o => _cqEquipChave(o.value) === k))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

function _cqTesteRender() {
  const t = _cqTesteFormId ? cqState.config.testes[_cqTesteFormId] : null;
  const tabs = !t ? { config: 'Configuração' }
    : _cqTesteQual(t) ? { config: 'Configuração', trilha: 'Rastreabilidade' }
    : { config: 'Configuração', alvos: 'Alvos (média e DP)', trilha: 'Rastreabilidade' };
  if (!tabs[_cqTesteFormTab]) _cqTesteFormTab = 'config';
  const titulo = t ? `${_cqNomeTeste(t)} · ${_cqEquipTeste(t)}` : 'Novo teste';
  const anVolta = _cqAnalito(t?.analitoId || _cqTesteAnalitoFixo);
  let corpo = `${anVolta ? `<a href="#" class="cq-link cq-voltar" onclick="cqAnalitoForm('${anVolta.id}','testes');return false;">← ${_cqEsc(anVolta.nome)}</a>` : ''}<div class="ot-modal-tabs cq-drawer-tabs">${Object.entries(tabs).map(([k, l]) => `<button class="ot-modal-tab-btn${k === _cqTesteFormTab ? ' active' : ''}" onclick="cqTesteAba('${k}')">${l}</button>`).join('')}</div>`;
  let rodape = `${t && _cqCan('configurar') ? `<div class="cq-rodape-esq"><button class="btn btn-outline cq-btn-perigo" onclick="cqExcluirCadastro('testes','${t.id}')">Excluir</button>${_cqTesteFormTab === 'config' ? _cqBtnAtivoHTML({ ids: 'cq-te-habilitado', fn: 'cqTesteSalvar', colecao: 'testes', id: t.id, ativo: t.ativo !== false }) : ''}</div>` : ''}
    <button class="btn btn-outline" onclick="cqDrawerClose()">Fechar</button>`;
  if (_cqTesteFormTab === 'config') {
    corpo += _cqTesteConfigHTML();
    if (_cqCan('configurar')) rodape += `<button class="btn btn-primary" onclick="cqTesteSalvar()">${CQ_ICO.check} Salvar</button>`;
  } else if (_cqTesteFormTab === 'alvos') {
    corpo += `<div id="cq-alvos-wrap">${_cqAlvosHTML(t)}</div>`;
  } else {
    corpo += `<div style="padding-top:12px;">${_cqTrilhaHTML(t)}</div>`;
  }
  const aberto = document.getElementById('cq-drawer')?.classList.contains('open');
  if (aberto && document.getElementById('cq-drawer-title')?.dataset.teste === String(_cqTesteFormId)) {
    document.getElementById('cq-drawer-title').textContent = titulo;
    document.getElementById('cq-drawer-body').innerHTML = corpo;
    document.getElementById('cq-drawer-foot').innerHTML = rodape;
  } else {
    cqDrawerOpen({ titulo, subtitulo: 'Estratégia de controle do teste (RDC 978, arts. 176 e 180)', icone: 'beaker', corpo, rodape });
    document.getElementById('cq-drawer-title').dataset.teste = String(_cqTesteFormId);
  }
}

function cqTesteAba(aba) {
  if (_cqTesteFormTab === 'config') _cqTesteCapturar();
  _cqTesteFormTab = aba;
  _cqTesteRender();
}

function _cqTesteConfigHTML() {
  const d = _cqTesteDraft;
  const pode = _cqCan('configurar');
  const podeRegras = pode && (_cqCan('definirAlvos') || !_cqTesteFormId);
  const un = _cqUnidade();
  const equipAtual = d.ativoId ? 'a:' + d.ativoId : (d.sistemaAnalitico ? 'm:' + d.sistemaAnalitico : '');
  const uTe = d.unidadeId || _cqUnidadeAtivaId();
  const analitos = _cqAnalitosDoEquip(equipAtual, uTe);
  if (d.analitoId && !analitos.some(a => a.id === d.analitoId) && _cqAnalito(d.analitoId)) analitos.unshift(_cqAnalito(d.analitoId));
  const equipTe = d.ativoId ? 'a:' + d.ativoId : (d.sistemaAnalitico ? 'm:' + d.sistemaAnalitico : '');
  const mats = Object.values(cqState.config.materiais).filter(m => m.id === d.materialId || (m.ativo !== false && _cqNaUnidade(m, uTe) && _cqMaterialServe(m, equipTe, d.analitoId)))
    .sort((a, b) => a.nome.localeCompare(b.nome));
  const anTe = _cqAnalito(d.analitoId);
  const opsEquip = _cqEquipsTodos(d.unidadeId || _cqUnidadeAtivaId())
    .filter(o => !_cqTesteAnalitoFixo || _cqEquipsDoAnalito(anTe).some(x => _cqEquipChave(x.value) === _cqEquipChave(o.value)));
  if (equipAtual && !opsEquip.some(o => _cqEquipChave(o.value) === _cqEquipChave(equipAtual))) opsEquip.unshift({ value: equipAtual, label: d.ativoId ? _cqEquipTeste(d) : d.sistemaAnalitico, grupo: 'Atual' });
  const gruposEquip = [...new Set(opsEquip.map(o => o.grupo))];
  void un;
  const lotesEmUso = new Set(Object.values(d.lotesAtivos || {}));
  const lotesMat = Object.values(cqState.config.lotesControle).filter(l => l.materialId === d.materialId && l.status !== 'encerrado' && (lotesEmUso.has(l.id) || _cqNaUnidade(l, uTe)))
    .sort((a, b) => (b.validade || '').localeCompare(a.validade || ''));
  const niveis = _cqArr(d.niveis).map(Number);
  const qual = _cqTesteQual(d);
  const regrasGrid = CQEngine.ORDEM_REGRAS.map(k => {
    const r = CQEngine.REGRAS[k];
    const v = d.regras?.[k] || 'off';
    return `<tr><td><b>${r.label}</b><div class="cq-muted">${_cqEsc(r.descricao)}</div></td><td class="cq-muted" style="font-size:11px;">${r.tipoErro === 'aleatorio' ? 'aleatório' : 'sistemático'}</td>
      <td><select class="field-select cq-regra-sel" data-regra="${k}" onchange="cqTesteRegraChange()" ${podeRegras ? '' : 'disabled'}>
        <option value="off" ${v === 'off' ? 'selected' : ''}>Desligada</option><option value="alerta" ${v === 'alerta' ? 'selected' : ''}>Alerta</option><option value="rejeicao" ${v === 'rejeicao' ? 'selected' : ''}>Rejeição</option></select></td></tr>`;
  }).join('');
  return `<div style="padding-top:14px;">
    ${_cqInativoNota(_cqTesteFormId ? d : null, 'ativo', 'não aparece nos lançamentos de corridas')}
    <div class="form-section"><div class="form-section-title">${CQ_ICO.beaker}Analito e sistema analítico</div>
      <div class="form-row">
        <div class="form-field"><label class="field-label">1. Equipamento / sistema analítico <span class="required">*</span></label>
          ${!opsEquip.length ? `<div class="cq-alerta-box">${CQ_ICO.alerta} Nenhum analito tem equipamento ou sistema vinculado nesta unidade. Vincule no cadastro do analito.</div>`
            : `<select id="cq-te-equip" class="field-select" onchange="cqTesteEquipChange()" ${_cqTesteFormId || !pode ? 'disabled' : ''}><option value="">— Selecione —</option>
              ${gruposEquip.map(g => `<optgroup label="${_cqEsc(g)}">${opsEquip.filter(o => o.grupo === g).map(o => `<option value="${_cqEsc(o.value)}" ${_cqEquipChave(o.value) === _cqEquipChave(equipAtual) ? 'selected' : ''}>${_cqEsc(o.label)}</option>`).join('')}</optgroup>`).join('')}</select>`}</div>
        <div class="form-field"><label class="field-label">2. Analito <span class="required">*</span></label>
          ${!equipAtual && !_cqTesteAnalitoFixo ? `<select id="cq-te-analito" class="field-select" disabled><option value="">Selecione antes o equipamento / sistema</option></select>`
            : `<select id="cq-te-analito" class="field-select" onchange="cqTesteAnalitoChange()" ${_cqTesteFormId || _cqTesteAnalitoFixo || !pode ? 'disabled' : ''}>${analitos.length ? `<option value="">— Selecione —</option>` + analitos.map(a => `<option value="${a.id}" ${a.id === d.analitoId ? 'selected' : ''}>${_cqEsc(a.nome)} (${_cqEsc(a.tipo && a.tipo !== 'quantitativo' ? CQ_TIPOS_ANALITO[a.tipo].toLowerCase() : a.unidadeMedida)})</option>`).join('') : '<option value="">Nenhum analito vinculado a este equipamento</option>'}</select>`}</div>
      </div>
      <div class="cq-nota" style="margin-top:-6px;">Os analitos listados são os vinculados ao equipamento / sistema no cadastro de analitos.</div>
      <div class="form-row">
        <div class="form-field"><label class="field-label">${qual ? 'Meio / insumo controlado' : 'Método'}</label>${qual ? _cqTesteInsumoCampoHTML(d, pode)
          : `<input type="text" id="cq-te-metodo" class="field-input" value="${_cqEsc(d.metodo)}" placeholder="Ex.: Hexoquinase" ${_cqRo(pode)}>`}</div>
        <div class="form-field" style="max-width:170px;"><label class="field-label">Início de uso</label><input type="date" id="cq-te-inicio" class="field-input" value="${_cqEsc(d.inicioUso)}" ${_cqRo(pode)}></div>
      </div>
    </div>
    ${qual ? _cqTesteQualSecoesHTML(d, pode, podeRegras) : `
    <div class="form-section"><div class="form-section-title">${CQ_ICO.beaker}Controle: níveis, material e lotes</div>
      <div class="form-field"><label class="field-label">Material de controle <span class="required">*</span></label>
        <select id="cq-te-material" class="field-select" onchange="cqTesteMaterialChange()" ${_cqRo(pode)}>${_cqMapOptions(Object.fromEntries(mats.map(m => [m.id, `${m.nome} — ${m.fabricante}`])), d.materialId)}</select></div>
      <div class="form-field"><label class="field-label">Níveis controlados e lote em uso</label>
        ${[1, 2, 3].map(n => {
          const temNoMat = !!cqState.config.materiais[d.materialId]?.niveis?.[n];
          const lotes = lotesMat.filter(l => _cqArr(l.niveis).map(Number).includes(n));
          return `<div class="cq-nivel-row"><label class="oc-check"><input type="checkbox" class="cq-te-nivel" value="${n}" ${niveis.includes(n) ? 'checked' : ''} ${!temNoMat || !pode ? 'disabled' : ''}> Nível ${n}</label>
            <select class="field-select cq-te-lote" data-n="${n}" ${!temNoMat || !pode ? 'disabled' : ''}><option value="">— Lote —</option>
              ${lotes.map(l => `<option value="${l.id}" ${d.lotesAtivos?.[n] === l.id ? 'selected' : ''}>${_cqEsc(l.lote)} · val. ${_cqFmtData(l.validade)}${l.status === 'quarentena' ? ' (quarentena)' : ''}</option>`).join('')}</select></div>`;
        }).join('')}
        <div class="cq-nota">Use níveis próximos dos limites de decisão clínica. Ao trocar o lote, cadastre o alvo do novo lote na aba “Alvos”. O lote em uso também pode ser definido no cadastro do lote (Controles/Materiais › lote › Uso nos testes).</div></div>
      <div class="form-row">
        <div class="form-field"><label class="field-label">Frequência</label><select id="cq-te-freq" class="field-select" ${_cqRo(pode)}>${_cqMapOptions(CQ_FREQ, d.frequencia?.tipo || 'por_corrida', null)}</select></div>
        <div class="form-field" style="max-width:150px;"><label class="field-label">Corridas por dia</label><input type="number" min="1" max="24" id="cq-te-vezes" class="field-input" value="${Number(d.frequencia?.vezesDia) || 1}" ${_cqRo(pode)}></div>
      </div>
      <div class="cq-nota">RDC 978, art. 183: CIQ no mínimo a cada corrida analítica e após cada manutenção preventiva e corretiva.</div>
    </div>
    <div class="form-section"><div class="form-section-title">${CQ_ICO.shield}Regras de controle (Westgard)</div>
      <div class="form-field"><label class="field-label">Conjunto de regras</label>
        <select id="cq-te-preset" class="field-select" onchange="cqTestePresetChange()" ${podeRegras ? '' : 'disabled'}>
          ${Object.entries(CQEngine.PRESETS).map(([k, p]) => `<option value="${k}" ${k === d.regrasPreset ? 'selected' : ''}>${_cqEsc(p.label)}</option>`).join('')}
          <option value="personalizado" ${!CQEngine.PRESETS[d.regrasPreset] ? 'selected' : ''}>Personalizado</option></select>
        ${!podeRegras ? '<div class="cq-nota">Alterar regras exige a permissão “Definir médias, DP e regras”.</div>' : ''}</div>
      <table class="cq-regras-tbl">${regrasGrid}</table>
      <div class="cq-checks" style="margin-top:8px;">
        <label class="oc-check"><input type="checkbox" id="cq-te-gatilho" ${d.opcoesRegras?.gatilho12s ? 'checked' : ''} ${podeRegras ? '' : 'disabled'}> Usar 1-2s como gatilho (só aplica as demais regras quando algum controle excede ±2 DP)</label>
        <label class="oc-check"><input type="checkbox" id="cq-te-increj" ${d.opcoesRegras?.incluirRejeitados ? 'checked' : ''} ${podeRegras ? '' : 'disabled'}> Incluir corridas rejeitadas no histórico das regras</label>
      </div>
    </div>
    <div class="form-section"><div class="form-section-title">${CQ_ICO.shield}Especificação da qualidade</div>
      <div class="cq-nota">Padrão do analito: ${(() => { const a = _cqAnalito(d.analitoId); return a?.eta ? `ETa ${_cqNum(Number(a.eta.valor), 1)}${a.eta.tipo === 'abs' ? ' ' + _cqEsc(a.unidadeMedida) : '%'} (${_cqEsc(a.eta.fonte)})` : 'não definido'; })()}.</div>
      <div class="form-row">
        <div class="form-field"><label class="field-label">ETa específico deste teste (%)</label><input type="text" inputmode="decimal" id="cq-te-eta" class="field-input" value="${_cqEsc(d.etaOverride?.valor ?? '')}" placeholder="Vazio = usar o do analito" ${_cqRo(pode)}></div>
        <div class="form-field"><label class="field-label">Justificativa</label><input type="text" id="cq-te-eta-just" class="field-input" value="${_cqEsc(d.etaOverride?.justificativa)}" ${_cqRo(pode)}></div>
      </div>
      <input type="checkbox" id="cq-te-habilitado" hidden ${d.ativo === false ? '' : 'checked'}>
    </div>
    ${_cqTesteFormId && pode ? `<div class="form-section"><div class="form-section-title">${CQ_ICO.undo}Histórico das regras</div>
      <div class="cq-nota">${d.reinicioHistorico ? `Histórico reiniciado em ${_cqFmtDH(CQEngine.dataDeChave(d.reinicioHistorico))}. ` : ''}Reiniciar faz as regras entre corridas desconsiderarem resultados anteriores (ex.: após troca de método ou grande manutenção).</div>
      <button class="btn btn-outline btn-sm" onclick="cqTesteReiniciarHistorico()">${CQ_ICO.undo} Reiniciar histórico das regras</button></div>` : ''}`}
  </div>`;
}

// Seções do teste qualitativo: um controle por nível (cepa, lâmina ou placa não inoculada) com resultado esperado
function _cqTesteQualSecoesHTML(d, pode, podeRegras) {
  const an = _cqAnalito(d.analitoId);
  const escala = _cqArr(an?.escala);
  const niveis = _cqArr(d.niveis).map(Number);
  const usados = new Set(Object.values(d.controlesQual || {}).map(c => c?.materialId).filter(Boolean));
  const equipTe = d.ativoId ? 'a:' + d.ativoId : (d.sistemaAnalitico ? 'm:' + d.sistemaAnalitico : '');
  const uTe = d.unidadeId || _cqUnidadeAtivaId();
  const mats = Object.values(cqState.config.materiais).filter(m => usados.has(m.id) || (m.ativo !== false && _cqNaUnidade(m, uTe) && _cqMaterialServe(m, equipTe, d.analitoId)))
    .sort((a, b) => a.nome.localeCompare(b.nome));
  const insTipo = d.insumoTipo || '';
  // Lotes que o lançamento vai oferecer para o insumo escolhido no campo do teste
  const lotesIns = d.insumoTipo ? _cqInsumosPara(d.analitoId, d.insumoTipo, d.insumoProdutoId || d.insumoProduto, equipTe, uTe) : [];
  const ctrls = [1, 2, 3].map(n => {
    const c = d.controlesQual?.[n] || {};
    const lotes = c.materialId ? Object.values(cqState.config.lotesControle).filter(l => l.materialId === c.materialId && l.status !== 'encerrado' && (d.lotesAtivos?.[n] === l.id || _cqNaUnidade(l, uTe)))
      .sort((a, b) => (b.validade || '').localeCompare(a.validade || '')) : [];
    return `<div class="cq-qual-ctrl">
      <label class="oc-check"><input type="checkbox" class="cq-te-nivel" value="${n}" ${niveis.includes(n) ? 'checked' : ''} ${_cqRo(pode)}> Nível ${n}</label>
      <input type="text" class="field-input cq-te-qrot" data-n="${n}" maxlength="40" value="${_cqEsc(c.rotulo)}" placeholder="${n === 1 ? 'Ex.: Cepa positiva' : n === 2 ? 'Ex.: Cepa de inibição' : 'Ex.: Placa não inoculada'}" ${_cqRo(pode)}>
      <select class="field-select cq-te-qmat" data-n="${n}" onchange="cqTesteMaterialChange()" ${_cqRo(pode)}>
        <option value="">— Sem material (placa / lâmina não inoculada) —</option>
        ${mats.map(m => `<option value="${m.id}" ${m.id === c.materialId ? 'selected' : ''}>${_cqEsc(m.nome)}${m.codigoReferencia ? ' · ' + _cqEsc(m.codigoReferencia) : ''}</option>`).join('')}</select>
      <select class="field-select cq-te-lote" data-n="${n}" ${c.materialId && pode ? '' : 'disabled'}><option value="">${c.materialId ? '— Lote —' : 'sem lote'}</option>
        ${lotes.map(l => `<option value="${l.id}" ${d.lotesAtivos?.[n] === l.id ? 'selected' : ''}>${_cqEsc(l.lote)} · val. ${_cqFmtData(l.validade)}${l.status === 'quarentena' ? ' (quarentena)' : ''}</option>`).join('')}</select>
      <select class="field-select cq-te-qesp" data-n="${n}" ${podeRegras ? '' : 'disabled'}><option value="">— Resultado esperado —</option>
        ${escala.map(e => `<option value="${_cqEsc(e)}" ${e === c.esperado ? 'selected' : ''}>${_cqEsc(e)}</option>`).join('')}</select>
    </div>`;
  }).join('');
  return `
    <div class="form-section"><div class="form-section-title">${CQ_ICO.beaker}Controles e resultado esperado</div>
      <div class="cq-qual-ctrl cq-qual-head"><span>Nível</span><span>Identificação</span><span>Material (cepa / lâmina)</span><span>Lote em uso</span><span>Esperado</span></div>
      ${ctrls}
      <div class="cq-nota">Ex.: desempenho do Ágar EMB → N1 “Cepa positiva” E. coli ATCC 25922 = crescimento com características esperadas; N2 “Cepa de inibição” S. aureus ATCC 25923 = crescimento inibido.
        Esterilidade → N1 “Placa não inoculada”, sem material, esperado “Sem crescimento”. Confirme os esperados com a bula do meio e o POP.
        O lote em uso também pode ser definido no cadastro do lote (Controles/Materiais › lote › Uso nos testes).</div>
      ${!podeRegras ? '<div class="cq-nota">Alterar resultados esperados exige a permissão “Definir médias, DP e regras”.</div>' : ''}
      <div class="form-row">
        <div class="form-field"><label class="field-label">Frequência</label><select id="cq-te-freq" class="field-select" ${_cqRo(pode)}>${_cqMapOptions(CQ_FREQ, d.frequencia?.tipo || 'por_lote', null)}</select></div>
        <div class="form-field" style="max-width:150px;"><label class="field-label">Corridas por dia</label><input type="number" min="1" max="24" id="cq-te-vezes" class="field-input" value="${Number(d.frequencia?.vezesDia) || 1}" ${_cqRo(pode)}></div>
      </div>
    </div>
    <div class="form-section"><div class="form-section-title">${CQ_ICO.beaker}Insumo controlado</div>
      ${insTipo ? `<div class="form-field"><label class="field-label">Lotes oferecidos no lançamento · ${_cqEsc(CQ_TIPOS_INSUMO[insTipo] || insTipo)}${_cqNomeProdutoTeste(d) ? ' · ' + _cqEsc(_cqNomeProdutoTeste(d)) : ''}</label>
        ${lotesIns.length ? `<div class="cq-ins-compat">${lotesIns.map(i => `<span class="cq-ins-compat-item${i.vencido ? ' venc' : ''}" title="${_cqEsc([i.fabricante, i.vencido ? 'vencido' : i.bloqueado ? 'quarentena' : ''].filter(Boolean).join(' · '))}">lote <b>${_cqEsc(i.lote)}</b> · val. ${_cqFmtData(i.validade)}${i.vencido ? ' (vencido)' : i.bloqueado ? ' (quarentena)' : ''}</span>`).join('')}</div>`
          : `<div class="cq-nota cq-txt-amarelo">Nenhum lote em uso deste insumo nesta unidade. Cadastre o novo lote ${d.insumoProdutoId ? 'no produto, em' : 'em'} “Reagentes, meios e insumos”.</div>`}</div>`
        : '<div class="cq-nota">Sem insumo controlado: escolha o meio, corante ou kit no campo “Meio / insumo controlado” acima para rastrear o lote em cada lançamento.</div>'}
      ${insTipo ? `<label class="oc-check"><input type="checkbox" id="cq-te-exigeins" ${d.exigirInsumo ? 'checked' : ''} ${_cqRo(pode)}> Exigir o lote do insumo em cada lançamento (rastreabilidade do lote controlado)</label>` : ''}
      <input type="checkbox" id="cq-te-habilitado" hidden ${d.ativo === false ? '' : 'checked'}>
    </div>`;
}

// Produtos que servem ao teste: unidade, analito e equipamento/sistema. O teste guarda o produto;
// o lançamento oferece todos os lotes dele, inclusive os cadastrados depois.
// Lotes antigos (sem produto) entram agrupados pelo nome, como antes da separação produto × lote.
function _cqProdutosTeste(d) {
  const u = d.unidadeId || _cqUnidadeAtivaId();
  const eq = d.ativoId ? 'a:' + d.ativoId : (d.sistemaAnalitico ? 'm:' + d.sistemaAnalitico : '');
  const serve = x => (!_cqArr(x.analitoIds).length || !d.analitoId || _cqArr(x.analitoIds).includes(d.analitoId))
    && (!_cqEquipsInsumo(x).length || !eq || _cqEquipsInsumo(x).some(k => _cqEquipChave(k) === _cqEquipChave(eq)));
  const lotes = _cqDaUnidade('insumos', u).filter(i => i.status !== 'encerrado');
  const out = _cqDaUnidade('insumoProdutos', u).filter(p => p.nome && p.tipo !== 'calibrador' && (p.ativo !== false || p.id === d.insumoProdutoId) && serve(p))
    .map(p => ({ id: p.id, nome: p.nome.trim(), tipo: p.tipo, fab: p.fabricante || '', lotes: lotes.filter(i => _cqLoteCru(i).produtoId === p.id) }));
  const mapa = new Map();
  lotes.filter(i => !_cqProdutoInsumo(i) && i.nome && i.tipo !== 'calibrador' && serve(i)).forEach(i => {
    const k = i.nome.trim().toLowerCase();
    const p = mapa.get(k) || { id: '', nome: i.nome.trim(), lotes: [], tipos: {}, fab: i.fabricante || '' };
    p.lotes.push(i);
    p.tipos[i.tipo] = (p.tipos[i.tipo] || 0) + 1;
    mapa.set(k, p);
  });
  return [...out, ...[...mapa.values()].map(p => ({ ...p, tipo: Object.entries(p.tipos).sort((a, b) => b[1] - a[1])[0][0] }))];
}
// Produto escolhido no campo do teste: valor = id do produto ou, para lotes antigos, o nome
function _cqProdutoDoTeste(d, valor) {
  const v = String(valor || '').trim();
  if (!v) return null;
  const prods = _cqProdutosTeste(d);
  return prods.find(p => p.id && p.id === v) || prods.find(p => !p.id && _cqNormBusca(p.nome) === _cqNormBusca(v)) || null;
}

// Campo "Meio / insumo controlado" (qualitativos): popover com os produtos cadastrados
function _cqTesteInsumoCampoHTML(d, pode) {
  const hoje = _cqHoje();
  const prods = _cqProdutosTeste(d).sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || (CQ_TIPOS_INSUMO[a.tipo] || '').localeCompare(CQ_TIPOS_INSUMO[b.tipo] || '') || a.nome.localeCompare(b.nome, 'pt'));
  const ops = [{ value: '', label: 'Sem insumo controlado', sub: 'O teste não controla meio, corante ou kit' },
    ...prods.map(p => {
      const venc = p.lotes.filter(i => i.validade && i.validade < hoje).length;
      const ult = [...p.lotes].sort((a, b) => (b.validade || '').localeCompare(a.validade || ''))[0];
      return { value: p.id || p.nome, label: p.nome, grupo: p.id ? (CQ_TIPOS_INSUMO[p.tipo] || p.tipo) : 'Lotes sem produto (cadastro antigo)',
        sub: [p.fab, p.lotes.length ? `${p.lotes.length} lote(s)${venc ? `, ${venc} vencido(s)` : ''}` : 'sem lote em uso'].filter(Boolean).join(' · '), extra: ult?.validade ? `val. ${_cqFmtData(ult.validade)}` : '' };
    })];
  // Vínculo pelo id do produto; testes antigos: o texto do campo é reaproveitado quando corresponde a um produto cadastrado
  const atual = (d.insumoProduto || d.metodo || '').trim();
  const achado = (d.insumoProdutoId && ops.find(o => o.value === d.insumoProdutoId)) || ops.find(o => o.value && _cqNormBusca(o.label) === _cqNormBusca(atual));
  if (atual && !achado) ops.push({ value: atual, label: atual, sub: 'Atual — não corresponde a um produto cadastrado para este analito e equipamento/sistema', grupo: 'Revisar' });
  const vazio = d.analitoId ? 'Nenhum meio, corante ou kit desta unidade vinculado a este analito e equipamento/sistema.' : 'Escolha antes o analito.';
  return `${_cqSelHTML('cq-te-insumo', ops, achado ? achado.value : atual, { placeholder: 'Selecione o meio, corante ou kit', disabled: !pode,
      onchange: cqTesteInsumoChange, busca: 'Buscar meio, corante ou kit…', vazio })}
    ${atual && !achado ? '<div class="cq-nota cq-txt-amarelo">Revise: escolha o insumo cadastrado correspondente para o lançamento oferecer os lotes dele.</div>' : ''}
    ${!prods.length && d.analitoId ? '<div class="cq-nota">Cadastre o produto em “Reagentes, meios e insumos” vinculado a este analito e equipamento/sistema.</div>' : ''}`;
}
function cqTesteInsumoChange() { _cqTesteCapturar(); _cqTesteRender(); }

function cqTesteMaterialChange() {
  _cqTesteCapturar();
  // Ao trocar o material de um nível qualitativo, o lote anterior deixa de valer
  const d = _cqTesteDraft;
  Object.entries(d.lotesAtivos || {}).forEach(([n, lid]) => {
    const c = d.controlesQual?.[n];
    if (c && cqState.config.lotesControle[lid]?.materialId !== c.materialId) delete d.lotesAtivos[n];
  });
  _cqTesteRender();
}
function cqTestePresetChange() {
  const k = _cqVal('cq-te-preset');
  const p = CQEngine.PRESETS[k];
  if (!p) return;
  _cqTesteCapturar();
  _cqTesteDraft.regrasPreset = k;
  _cqTesteDraft.regras = { ...p.regras };
  _cqTesteRender();
}
function cqTesteRegraChange() {
  const sel = document.getElementById('cq-te-preset');
  if (sel) sel.value = 'personalizado';
}

// Lê o formulário de configuração para o rascunho
function _cqTesteCapturarEquip(d) {
  d.analitoId = _cqVal('cq-te-analito');
  if (!document.getElementById('cq-te-equip')) return;
  const eq = _cqVal('cq-te-equip');
  d.ativoId = eq.startsWith('a:') ? eq.slice(2) : null;
  d.sistemaAnalitico = eq.startsWith('m:') ? eq.slice(2) : '';
}

function _cqTesteCapturar() {
  if (document.getElementById('cq-te-insumo')) { _cqTesteCapturarQual(); return; }
  if (!document.getElementById('cq-te-material')) return;
  const d = _cqTesteDraft;
  if (!_cqTesteFormId) _cqTesteCapturarEquip(d);
  d.metodo = _cqVal('cq-te-metodo');
  d.inicioUso = _cqVal('cq-te-inicio');
  d.materialId = _cqVal('cq-te-material');
  d.niveis = [...document.querySelectorAll('#cq-drawer .cq-te-nivel:checked')].map(c => Number(c.value));
  d.lotesAtivos = {};
  document.querySelectorAll('#cq-drawer .cq-te-lote').forEach(s => { if (s.value && d.niveis.includes(Number(s.dataset.n))) d.lotesAtivos[s.dataset.n] = s.value; });
  d.frequencia = { tipo: _cqVal('cq-te-freq') || 'por_corrida', vezesDia: Math.max(1, Number(_cqVal('cq-te-vezes')) || 1) };
  const preset = _cqVal('cq-te-preset');
  d.regrasPreset = CQEngine.PRESETS[preset] ? preset : 'personalizado';
  d.regras = {};
  document.querySelectorAll('#cq-drawer .cq-regra-sel').forEach(s => { if (s.value !== 'off') d.regras[s.dataset.regra] = s.value; });
  d.opcoesRegras = { gatilho12s: _cqChk('cq-te-gatilho'), incluirRejeitados: _cqChk('cq-te-increj') };
  const eta = CQEngine.parseNumero(_cqVal('cq-te-eta'));
  d.etaOverride = eta !== null && eta > 0 ? { valor: eta, tipo: '%', justificativa: _cqVal('cq-te-eta-just') } : null;
  d.ativo = _cqChk('cq-te-habilitado');
}

function _cqTesteCapturarQual() {
  const d = _cqTesteDraft;
  if (!_cqTesteFormId) _cqTesteCapturarEquip(d);
  d.inicioUso = _cqVal('cq-te-inicio');
  d.materialId = '';
  d.niveis = [...document.querySelectorAll('#cq-drawer .cq-te-nivel:checked')].map(c => Number(c.value));
  d.controlesQual = {};
  d.lotesAtivos = {};
  [1, 2, 3].forEach(n => {
    const campo = cls => document.querySelector(`#cq-drawer ${cls}[data-n="${n}"]`)?.value || '';
    const c = { rotulo: campo('.cq-te-qrot').trim(), materialId: campo('.cq-te-qmat'), esperado: campo('.cq-te-qesp') };
    if (c.rotulo || c.materialId || c.esperado || d.niveis.includes(n)) d.controlesQual[n] = c;
    const lote = campo('.cq-te-lote');
    if (lote && c.materialId && d.niveis.includes(n)) d.lotesAtivos[n] = lote;
  });
  d.frequencia = { tipo: _cqVal('cq-te-freq') || 'por_lote', vezesDia: Math.max(1, Number(_cqVal('cq-te-vezes')) || 1) };
  d.regrasPreset = 'qualitativo';
  d.regras = {};
  d.opcoesRegras = {};
  d.etaOverride = null;
  // Meio / insumo controlado: o produto escolhido define nome do teste, tipo e filtro dos lotes
  const v = _cqSelVal('cq-te-insumo');
  const prod = _cqProdutoDoTeste(d, v);
  d.metodo = prod ? prod.nome : v;
  if (prod) { d.insumoProduto = prod.nome; d.insumoTipo = prod.tipo; d.insumoProdutoId = prod.id || ''; }
  else if (!v) { d.insumoProduto = ''; d.insumoTipo = ''; d.insumoProdutoId = ''; }
  // texto antigo que não corresponde a insumo cadastrado: mantém o vínculo anterior até ser revisado
  const chk = document.getElementById('cq-te-exigeins');
  d.exigirInsumo = !!d.insumoTipo && (chk ? chk.checked : true);
  d.ativo = _cqChk('cq-te-habilitado');
}

async function cqTesteSalvar() {
  if (_cqSalvando || !_cqCan('configurar')) return;
  _cqTesteCapturar();
  const d = _cqTesteDraft;
  const antes = _cqTesteFormId ? cqState.config.testes[_cqTesteFormId] : null;
  if (!d.analitoId) { showToast('Selecione o analito.', 'error'); return; }
  if (!d.ativoId && !d.sistemaAnalitico) { showToast('Selecione o equipamento ou sistema analítico (vinculado no cadastro do analito).', 'error'); return; }
  if (!antes && !_cqEquipsDoAnalito(_cqAnalito(d.analitoId)).some(o => _cqEquipChave(o.value) === _cqEquipChave(d.ativoId ? 'a:' + d.ativoId : 'm:' + d.sistemaAnalitico))) {
    showToast('Este equipamento/sistema não está vinculado ao analito.', 'error'); return;
  }
  const qual = _cqTesteQual(d);
  if (!d.niveis.length) { showToast('Selecione ao menos um nível de controle.', 'error'); return; }
  if (qual) {
    const escala = _cqArr(_cqAnalito(d.analitoId)?.escala);
    const semEsp = d.niveis.find(n => !escala.includes(d.controlesQual?.[n]?.esperado));
    if (semEsp) { showToast(`Defina o resultado esperado do nível ${semEsp} (RDC 978, art. 180, II).`, 'error'); return; }
    d.niveis.forEach(n => { if (!d.controlesQual[n].rotulo) d.controlesQual[n].rotulo = d.controlesQual[n].materialId ? `Nível ${n}` : 'Sem material'; });
  } else {
    if (!d.materialId) { showToast('Selecione o material de controle.', 'error'); return; }
    if (!Object.keys(d.regras).some(k => d.regras[k] === 'rejeicao')) { showToast('Defina ao menos uma regra de rejeição (RDC 978, art. 180, II).', 'error'); return; }
  }
  if (d.etaOverride && !d.etaOverride.justificativa) { showToast('Justifique o ETa específico do teste.', 'error'); return; }
  const u = d.unidadeId || _cqUnidadeAtivaId();
  const dup = _cqTestesDaUnidade(u, { incluirInativos: true }).find(t => t.id !== _cqTesteFormId && t.analitoId === d.analitoId &&
    (t.ativoId || null) === (d.ativoId || null) && (t.ativoId ? true : (t.sistemaAnalitico || '') === (d.sistemaAnalitico || '')) && (t.metodo || '') === (d.metodo || ''));
  if (dup) { showToast(`Já existe este teste (analito, equipamento e ${qual ? 'meio/insumo' : 'método'}) nesta unidade.`, 'error'); return; }
  const regrasMudaram = antes && _cqCriteriosTeste(antes) !== _cqCriteriosTeste(d);
  if (regrasMudaram && !_cqCan('definirAlvos')) { showToast(qual ? 'Sem permissão para alterar resultados esperados.' : 'Sem permissão para alterar regras.', 'error'); return; }
  const lotesMudaram = antes && CQEngine.canonico(_cqMapaNiveis(antes.lotesAtivos)) !== CQEngine.canonico(_cqMapaNiveis(d.lotesAtivos));

  const concluir = async (justificativa) => {
    const ativo = d.ativoId && typeof _ativoById === 'function' ? _ativoById(d.ativoId) : null;
    const rec = { ...(antes || {}), ...d, id: _cqTesteFormId || _cqUid(), unidadeId: u,
                  ativoSnap: ativo ? { nome: ativo.nome || '', codigo: ativo.codigo || '', serie: ativo.serie || '', modelo: ativo.modelo || '' } : (antes?.ativoSnap || null),
                  versaoConfig: (antes?.versaoConfig || 0) + (regrasMudaram || !antes ? 1 : 0) };
    if (!antes) { rec.criadoEm = _cqAgora(); rec.criadoPor = _cqAssinatura(); }
    const fmt = {
      analitoId: v => _cqAnalito(v)?.nome || v, ativoId: v => (typeof _ativoById === 'function' && _ativoById(v)?.nome) || v,
      niveis: v => _cqArr(v).map(n => 'N' + n).join(', '), materialId: v => cqState.config.materiais[v]?.nome || v,
      lotesAtivos: v => Object.entries(v || {}).map(([n, l]) => `N${n}: ${cqState.config.lotesControle[l]?.lote || l}`).join('; '),
      frequencia: v => `${CQ_FREQ[v?.tipo] || v?.tipo} (${v?.vezesDia || 1}×/dia)`, regras: v => _cqResumoRegras(v),
      regrasPreset: v => CQEngine.PRESETS[v]?.label || 'Personalizado', opcoesRegras: v => `gatilho 1-2s: ${v?.gatilho12s ? 'sim' : 'não'}; incluir rejeitados: ${v?.incluirRejeitados ? 'sim' : 'não'}`,
      etaOverride: v => v ? `${v.valor}% (${v.justificativa})` : '—', ativo: v => v ? 'Sim' : 'Não',
      controlesQual: v => Object.entries(_cqMapaNiveis(v)).map(([n, c]) => `N${n} ${c.rotulo || ''}: ${cqState.config.materiais[c.materialId]?.nome || 'sem material'} → ${c.esperado || '—'}`).join('; '),
      insumoTipo: v => CQ_TIPOS_INSUMO[v] || '—', exigirInsumo: v => v ? 'Sim' : 'Não', insumoProdutoId: v => cqState.config.insumoProdutos[v]?.nome || v,
    };
    const diffs = antes ? _cqDiff(antes, rec, CQ_LBL_TESTE, fmt) : [];
    if (antes && !diffs.length) { cqDrawerClose(); return true; }
    _cqTrilhaAdd(rec, antes ? 'edicao' : 'criacao', antes ? `Teste alterado${justificativa ? ': ' + justificativa : ''}` : 'Teste cadastrado', diffs,
      regrasMudaram ? { versaoConfig: rec.versaoConfig } : null);
    _cqSalvando = true;
    try {
      if (!(await _cqSalvarRegistro('testes', rec))) return false;
      showToast(antes ? 'Teste atualizado.' : qual ? 'Teste cadastrado.' : 'Teste cadastrado. Cadastre agora os alvos (média e DP) de cada nível.', 'success');
      _cqTesteFormId = rec.id;
      _cqTesteDraft = JSON.parse(JSON.stringify(rec));
      _cqTesteFormTab = antes || qual ? 'config' : 'alvos';
      document.getElementById('cq-drawer-title').dataset.teste = String(rec.id);
      _cqTesteRender();
      cqRender();
      return true;
    } finally { _cqSalvando = false; }
  };

  if (regrasMudaram || lotesMudaram) {
    _cqPrompt({
      titulo: regrasMudaram ? (qual ? 'Alteração dos resultados esperados' : 'Alteração das regras de controle') : 'Troca de lote de controle',
      subtitulo: regrasMudaram ? `Nova versão da configuração (v${(antes.versaoConfig || 0) + 1})` : 'Registre o motivo da troca',
      corpo: `<div class="form-field"><label class="field-label">Justificativa <span class="required">*</span></label>
        <textarea id="cq-te-just" class="field-textarea" style="min-height:70px;" placeholder="${regrasMudaram ? 'Ex.: Sigma 5,8 no último semestre — simplificação para 1-3s/2-2s/R-4s conforme Westgard Sigma Rules.' : 'Ex.: lote anterior esgotado; novo lote avaliado em paralelo por 10 dias.'}"></textarea></div>
        ${regrasMudaram ? _cqSenhaCampoHTML() : ''}`,
      confirmar: 'Confirmar',
      onConfirm: async () => {
        const j = _cqVal('cq-te-just');
        if (!j) { showToast('Informe a justificativa.', 'error'); return false; }
        if (regrasMudaram && !_cqSenhaOk()) return false;
        return concluir(j);
      },
    });
    return;
  }
  await concluir('');
}

function cqTesteReiniciarHistorico() {
  const t = cqState.config.testes[_cqTesteFormId];
  if (!t) return;
  _cqPrompt({
    titulo: 'Reiniciar histórico das regras', subtitulo: `${_cqNomeTeste(t)} · ${_cqEquipTeste(t)}`,
    corpo: `<div class="cq-nota">As regras entre corridas (2-2s, 4-1s, 10x…) passarão a considerar apenas corridas posteriores a agora. Os resultados anteriores continuam registrados.</div>
      <div class="form-field"><label class="field-label">Justificativa <span class="required">*</span></label><textarea id="cq-rh-just" class="field-textarea" style="min-height:60px;"></textarea></div>${_cqSenhaCampoHTML()}`,
    confirmar: 'Reiniciar', perigo: true,
    onConfirm: async () => {
      const j = _cqVal('cq-rh-just');
      if (!j) { showToast('Informe a justificativa.', 'error'); return false; }
      if (!_cqSenhaOk()) return false;
      const rec = JSON.parse(JSON.stringify(t));
      rec.reinicioHistorico = CQEngine.chaveTempo(_cqNowLocal()) + '_zzzzz';
      _cqTrilhaAdd(rec, 'reinicio_historico', `Histórico das regras reiniciado: ${j}`);
      if (!(await _cqSalvarRegistro('testes', rec))) return false;
      _cqTesteDraft = JSON.parse(JSON.stringify(rec));
      _cqTesteRender();
      showToast('Histórico reiniciado.', 'success');
      return true;
    },
  });
}

// Campo de senha embutido em prompts de assinatura (respeita a política da unidade)
function _cqSenhaCampoHTML() {
  if (!_cqPolitica().reautenticar) return '';
  return `<div class="form-field"><label class="field-label">Sua senha (assinatura) <span class="required">*</span></label>
    <input type="password" id="cq-assin-pwd" class="field-input" autocomplete="current-password"></div>`;
}
function _cqSenhaOk() {
  if (!_cqPolitica().reautenticar || typeof authVerifyCurrentPassword !== 'function') return true;
  if (!authVerifyCurrentPassword(document.getElementById('cq-assin-pwd')?.value || '')) { showToast('Senha incorreta.', 'error'); return false; }
  return true;
}

// ── ALVOS (média e DP versionados) ───────────────────────────
function _cqAlvosHTML(t) {
  if (!t) return '';
  const pode = _cqCan('definirAlvos');
  const an = _cqAnalito(t.analitoId);
  const dec = an?.decimais ?? 2;
  const mapa = cqState.alvos[t.id] || {};
  const blocos = _cqNiveisTeste(t).map(n => {
    const lid = t.lotesAtivos?.[n];
    const lote = lid ? cqState.config.lotesControle[lid] : null;
    const versoes = Object.values(mapa).filter(a => Number(a.nivel) === n).sort((a, b) => (b.vigenteDesde || '').localeCompare(a.vigenteDesde || ''));
    const vig = lid ? _cqAlvoVigente(t.id, lid, n) : null;
    return `<div class="cq-alvo-bloco">
      <div class="cq-alvo-head"><div><b>Nível ${n}</b> · lote em uso: ${lote ? _cqEsc(lote.lote) : '<span class="cq-txt-vermelho">nenhum</span>'}</div>
        ${pode && lote ? `<button class="btn btn-primary btn-sm" onclick="cqAlvoForm('${t.id}',${n},'${lid}')">${CQ_ICO.plus} Novo alvo</button>` : ''}</div>
      ${vig ? `<div class="cq-alvo-vig"><div><span class="cq-muted">Média</span><b>${_cqNum(vig.media, dec)}</b></div><div><span class="cq-muted">DP</span><b>${_cqNum(vig.dp, dec + 1)}</b></div>
        <div><span class="cq-muted">CV</span><b>${_cqNum(Math.abs(vig.dp / vig.media) * 100, 2)}%</b></div><div><span class="cq-muted">Origem</span>${_cqBadge(CQ_ORIGEM_ALVO, vig.origem)}</div>
        <div><span class="cq-muted">Vigente desde</span><b>${_cqFmtDH(vig.vigenteDesde)}</b></div></div>` : `<div class="cq-alerta-box">${CQ_ICO.alerta} Sem alvo para o lote em uso: os resultados ficarão “sem alvo” e exigirão decisão manual.</div>`}
      ${versoes.length ? `<table class="ot-list-table cq-table cq-table-sm"><thead><tr><th class="ot-list-th">Lote</th><th class="ot-list-th">Vigente desde</th><th class="ot-list-th">Média</th><th class="ot-list-th">DP</th><th class="ot-list-th">Origem</th><th class="ot-list-th">n</th><th class="ot-list-th">Justificativa / aprovação</th></tr></thead><tbody>
        ${versoes.map(a => `<tr${a.id === vig?.id ? ' class="cq-row-destaque"' : ''}><td>${_cqEsc(cqState.config.lotesControle[a.loteControleId]?.lote || '?')}</td><td>${_cqFmtDH(a.vigenteDesde)}</td>
          <td>${_cqNum(a.media, dec)}</td><td>${_cqNum(a.dp, dec + 1)}</td><td>${_cqBadge(CQ_ORIGEM_ALVO, a.origem)}</td><td>${a.nPontos || '—'}</td>
          <td style="font-size:11.5px;max-width:220px;">${_cqEsc(a.justificativa)}<div class="cq-muted">${_cqEsc(a.aprovado?.porNome || '')} · ${_cqFmtDH(a.aprovado?.em)}</div></td></tr>`).join('')}</tbody></table>` : ''}
    </div>`;
  }).join('');
  return `<div style="padding-top:12px;">
    <div class="cq-nota">Cada alteração cria uma nova versão; as anteriores permanecem registradas. Cada resultado guarda a média e o DP usados na sua avaliação (RDC 978, art. 116).</div>
    ${blocos || '<div class="cq-vazio-p">Selecione níveis e lotes na aba Configuração.</div>'}</div>`;
}

let _cqAlvoCtx = null;

function cqAlvoForm(testeId, nivel, loteId) {
  const t = cqState.config.testes[testeId];
  if (!t || !_cqCan('definirAlvos')) return;
  const an = _cqAnalito(t.analitoId);
  const lote = cqState.config.lotesControle[loteId];
  _cqAlvoCtx = { testeId, nivel, loteId };
  _cqPrompt({
    titulo: `Novo alvo · nível ${nivel}`, subtitulo: `${_cqNomeTeste(t)} · lote ${lote?.lote || '?'} (${an?.unidadeMedida || ''})`,
    corpo: `
      <div class="form-field"><label class="field-label">Origem</label>
        <select id="cq-alvo-origem" class="field-select" onchange="cqAlvoOrigemChange()">${_cqMapOptions(Object.fromEntries(Object.entries(CQ_ORIGEM_ALVO).map(([k, v]) => [k, v.label])), 'fabricante', null)}</select></div>
      <div id="cq-alvo-fab">
        <div class="cq-nota">Faixa da bula (média ± k·DP). Faixas do fabricante costumam ser largas: use como alvo provisório até ter 20 resultados.</div>
        <div class="form-row"><div class="form-field"><label class="field-label">Mínimo</label><input type="text" inputmode="decimal" id="cq-alvo-min" class="field-input" oninput="cqAlvoFaixaCalc()"></div>
          <div class="form-field"><label class="field-label">Máximo</label><input type="text" inputmode="decimal" id="cq-alvo-max" class="field-input" oninput="cqAlvoFaixaCalc()"></div>
          <div class="form-field" style="max-width:90px;"><label class="field-label">k (DP)</label><input type="text" inputmode="decimal" id="cq-alvo-k" class="field-input" value="2" oninput="cqAlvoFaixaCalc()"></div></div>
      </div>
      <div id="cq-alvo-dados" style="display:none;">
        <div class="form-row"><div class="form-field"><label class="field-label">Período dos dados</label><select id="cq-alvo-meses" class="field-select"><option value="1">Mês atual</option><option value="2">2 meses</option><option value="3" selected>3 meses</option><option value="6">6 meses</option></select></div>
          <div class="form-field" style="justify-content:flex-end;display:flex;flex-direction:column;"><button class="btn btn-outline btn-sm" onclick="cqAlvoCalcular()">${CQ_ICO.grafico} Calcular a partir dos dados</button></div></div>
        <div id="cq-alvo-calc-res"></div>
      </div>
      <div class="form-row"><div class="form-field"><label class="field-label">Média <span class="required">*</span></label><input type="text" inputmode="decimal" id="cq-alvo-media" class="field-input"></div>
        <div class="form-field"><label class="field-label">DP <span class="required">*</span></label><input type="text" inputmode="decimal" id="cq-alvo-dp" class="field-input"></div>
        <div class="form-field" style="max-width:90px;"><label class="field-label">n</label><input type="number" min="0" id="cq-alvo-n" class="field-input"></div></div>
      <div class="form-field"><label class="field-label">Vigente a partir de <span class="required">*</span></label><input type="datetime-local" id="cq-alvo-desde" class="field-input" value="${_cqNowLocal()}"></div>
      <div class="form-field"><label class="field-label">Justificativa <span class="required">*</span></label><textarea id="cq-alvo-just" class="field-textarea" style="min-height:60px;" placeholder="Ex.: média e DP de 20 corridas (01 a 25/09), lote novo avaliado em paralelo."></textarea></div>
      ${_cqSenhaCampoHTML()}`,
    confirmar: 'Assinar e salvar',
    onConfirm: cqAlvoSalvar,
  });
}

function cqAlvoOrigemChange() {
  const o = _cqVal('cq-alvo-origem');
  document.getElementById('cq-alvo-fab').style.display = o === 'fabricante' ? '' : 'none';
  document.getElementById('cq-alvo-dados').style.display = o === 'fabricante' ? 'none' : '';
}
function cqAlvoFaixaCalc() {
  const mn = CQEngine.parseNumero(_cqVal('cq-alvo-min')), mx = CQEngine.parseNumero(_cqVal('cq-alvo-max')), k = CQEngine.parseNumero(_cqVal('cq-alvo-k')) || 2;
  if (mn === null || mx === null || mx <= mn) return;
  const t = cqState.config.testes[_cqAlvoCtx.testeId];
  const dec = (_cqAnalito(t.analitoId)?.decimais ?? 2) + 2;
  _cqSet('cq-alvo-media', String(CQEngine.arred((mn + mx) / 2, dec)).replace('.', ','));
  _cqSet('cq-alvo-dp', String(CQEngine.arred(CQEngine.dpDeFaixa(mn, mx, k), dec)).replace('.', ','));
}

async function cqAlvoCalcular() {
  const ctx = _cqAlvoCtx;
  const t = cqState.config.testes[ctx.testeId];
  const u = t.unidadeId;
  const meses = Number(_cqVal('cq-alvo-meses')) || 3;
  const mesAte = CQEngine.mesDe(_cqNowLocal());
  const mesDe = CQEngine.mesesAnteriores(mesAte, meses)[meses - 1];
  const el = document.getElementById('cq-alvo-calc-res');
  el.innerHTML = '<div class="cq-nota">Carregando resultados…</div>';
  const res = (await cqResultadosPeriodo(u, t.id, mesDe, mesAte, { forcar: true }))
    .filter(r => Number(r.nivel) === Number(ctx.nivel) && r.loteControleId === ctx.loteId && !r.invalidado && !r.excluido && r.decisao !== 'R' && Number.isFinite(r.valor));
  // CV de referência: alvo estabelecido mais recente do mesmo nível em outro lote
  const anteriores = Object.values(cqState.alvos[t.id] || {}).filter(a => Number(a.nivel) === Number(ctx.nivel) && a.loteControleId !== ctx.loteId && ['estabelecido', 'cumulativo'].includes(a.origem))
    .sort((a, b) => (b.vigenteDesde || '').localeCompare(a.vigenteDesde || ''));
  const cvRef = anteriores[0] ? Math.abs(anteriores[0].dp / anteriores[0].media) * 100 : null;
  const r = CQEngine.estabelecerAlvo(res.map(x => x.valor), { cvReferencia: cvRef });
  const dec = (_cqAnalito(t.analitoId)?.decimais ?? 2) + 2;
  if (r.ok) {
    _cqSet('cq-alvo-media', String(CQEngine.arred(r.media, dec)).replace('.', ','));
    _cqSet('cq-alvo-dp', String(CQEngine.arred(r.dp, dec)).replace('.', ','));
    _cqSet('cq-alvo-n', r.n);
    _cqSet('cq-alvo-origem', r.origem);
    if (!_cqVal('cq-alvo-just')) _cqSet('cq-alvo-just', `Calculado com ${r.n} resultados do lote (${_cqFmtMes(mesDe)} a ${_cqFmtMes(mesAte)}).`);
  }
  el.innerHTML = `<div class="cq-calc-box">${r.ok ? `n = <b>${r.n}</b> · média <b>${_cqNum(r.media, dec - 1)}</b> · DP <b>${_cqNum(r.dp, dec)}</b> · CV <b>${_cqNum(r.cv, 2)}%</b>` : ''}
    ${cvRef ? `<div class="cq-muted">CV do lote anterior: ${_cqNum(cvRef, 2)}%</div>` : ''}
    ${r.avisos.map(a => `<div class="cq-txt-amarelo">• ${_cqEsc(a)}</div>`).join('')}</div>`;
}

async function cqAlvoSalvar() {
  const ctx = _cqAlvoCtx;
  const t = cqState.config.testes[ctx.testeId];
  const media = CQEngine.parseNumero(_cqVal('cq-alvo-media')), dp = CQEngine.parseNumero(_cqVal('cq-alvo-dp'));
  const desde = _cqVal('cq-alvo-desde'), just = _cqVal('cq-alvo-just'), origem = _cqVal('cq-alvo-origem');
  if (media === null || dp === null || dp <= 0) { showToast('Informe média e DP válidos (DP > 0).', 'error'); return false; }
  if (!desde) { showToast('Informe a data de início de vigência.', 'error'); return false; }
  if (!just) { showToast('Informe a justificativa.', 'error'); return false; }
  if (!_cqSenhaOk()) return false;
  const cv = Math.abs(dp / media) * 100;
  const an = _cqAnalito(t.analitoId);
  const eta = t.etaOverride?.valor || (an?.eta?.tipo === '%' ? Number(an.eta.valor) : null);
  if (eta && cv > eta / 2) showToast(`Atenção: CV de ${_cqNum(cv, 1)}% é alto em relação ao ETa (${_cqNum(eta, 1)}%).`, 'error');
  const anterior = _cqAlvoVigente(t.id, ctx.loteId, ctx.nivel, desde);
  const id = _cqUid();
  const alvo = {
    id, loteControleId: ctx.loteId, nivel: Number(ctx.nivel), media, dp, origem,
    nPontos: Number(_cqVal('cq-alvo-n')) || null, vigenteDesde: desde, substitui: anterior?.id || null, justificativa: just,
    faixaFabricante: origem === 'fabricante' ? { min: CQEngine.parseNumero(_cqVal('cq-alvo-min')), max: CQEngine.parseNumero(_cqVal('cq-alvo-max')), k: CQEngine.parseNumero(_cqVal('cq-alvo-k')) || 2 } : null,
    aprovado: _cqAssinatura({ reautenticado: !!_cqPolitica().reautenticar }), criadoEm: _cqAgora(),
  };
  const u = t.unidadeId;
  const trilhaTeste = _cqTrilhaEntry('alvo', `Novo alvo N${ctx.nivel} lote ${cqState.config.lotesControle[ctx.loteId]?.lote}: média ${media}, DP ${dp} (${CQ_ORIGEM_ALVO[origem]?.label}) — ${just}`);
  const ok = await window.dbUpdate({
    [`${CQ_KEYS.alvos}/${u}/${t.id}/${id}`]: alvo,
    [`${CQ_KEYS.config}/testes/${t.id}/trilha/${_cqTk()}`]: trilhaTeste,
  });
  if (!ok) { showToast('Falha ao gravar o alvo.', 'error'); return false; }
  (cqState.alvos[t.id] = cqState.alvos[t.id] || {})[id] = alvo;
  showToast('Alvo registrado.', 'success');
  if (_cqTesteFormId === t.id && _cqTesteFormTab === 'alvos') _cqTesteRender();
  cqRender();
  return true;
}

// ── EXCLUSÃO DE CADASTROS SEM LANÇAMENTOS ────────────────────
// Só é possível excluir cadastros que nunca entraram em uma corrida e dos
// quais nenhum outro cadastro depende. Cadastros já usados devem ser
// inativados (registros do CQ são retidos — RDC 978/2025). Cada exclusão
// fica registrada com cópia do cadastro em CQ_KEYS.exclusoes.
const CQ_COLECAO_LABEL = { testes: 'teste', analitos: 'analito', materiais: 'material de controle', lotesControle: 'lote de controle', insumoProdutos: 'produto', insumos: 'lote de insumo' };

// Leitura que lança exceção em caso de erro (dbLoad devolve null tanto para "vazio" quanto para erro)
function _cqLerOuFalhar(path) { return window.dbGet(path); }

// Marcadores de uso. Na primeira chamada varre os lançamentos gravados antes
// de os marcadores existirem e grava o resultado (uma única vez).
async function _cqUsoCarregar() {
  const atual = await _cqLerOuFalhar(CQ_KEYS.uso);
  if (atual && atual._v) return atual;
  const [corridas, resultados] = await Promise.all([_cqLerOuFalhar(CQ_KEYS.corridas), _cqLerOuFalhar(CQ_KEYS.resultados)]);
  const updates = {};
  const vals = o => Object.values(o && typeof o === 'object' ? o : {});
  vals(corridas).forEach(meses => vals(meses).forEach(cs => vals(cs).forEach(c => {
    Object.entries(c?.testes || {}).forEach(([tid, ct]) => {
      if (ct?.naoRealizado) return;
      _cqMarcarUso(updates, 'testes', tid);
      _cqMarcarUso(updates, 'insumos', ct?.lr);
      _cqMarcarUso(updates, 'insumos', ct?.lk);
    });
  })));
  vals(resultados).forEach(meses => vals(meses).forEach(ts => Object.entries(ts && typeof ts === 'object' ? ts : {}).forEach(([tid, rs]) => {
    _cqMarcarUso(updates, 'testes', tid);
    vals(rs).forEach(raw => {
      const r = CQEngine.expandirResultado(raw);
      _cqMarcarUso(updates, 'lotesControle', r.loteControleId);
      _cqMarcarUso(updates, 'insumos', r.loteReagenteId);
      _cqMarcarUso(updates, 'insumos', r.loteCalibradorId);
    });
  })));
  updates[`${CQ_KEYS.uso}/_v`] = _cqAgora();
  if (!(await window.dbUpdate(updates))) throw new Error('Falha ao gravar os marcadores de uso do CQ.');
  const uso = { ...(atual || {}) };
  Object.keys(updates).forEach(p => {
    const [col, id] = p.slice(CQ_KEYS.uso.length + 1).split('/');
    if (id) (uso[col] = uso[col] || {})[id] = true; else uso[col] = updates[p];
  });
  return uso;
}

// Motivos que impedem a exclusão (lista vazia = pode excluir)
function _cqBloqueiosExclusao(colecao, id, uso) {
  const cfg = cqState.config;
  const usado = (c, x) => !!(x && uso?.[c]?.[x]);
  const testes = Object.values(cfg.testes);
  const matsDoTeste = t => [t.materialId, ...Object.values(t.controlesQual || {}).map(c => c?.materialId)].filter(Boolean);
  const lotesDoTeste = t => Object.values(t.lotesAtivos || {}).filter(Boolean);
  const nomeTeste = t => `teste ${_cqNomeTeste(t)} · ${_cqEquipTeste(t)}`;
  const motivos = [];

  if (colecao === 'testes') {
    const comIndice = Object.values(cqState.indices || {}).some(ix => ix?.ultimo?.[id]);
    if (usado('testes', id) || comIndice) motivos.push('Possui lançamentos de CQ.');
  } else if (colecao === 'analitos') {
    if (usado('analitos', id) || testes.some(t => t.analitoId === id && usado('testes', t.id))) motivos.push('Possui lançamentos de CQ.');
    testes.filter(t => t.analitoId === id).forEach(t => motivos.push(`Usado no ${nomeTeste(t)} (exclua o teste antes).`));
    Object.values(cfg.insumoProdutos).filter(p => _cqArr(p.analitoIds).includes(id)).forEach(p => motivos.push(`Vinculado ao produto ${p.nome}.`));
    Object.values(cfg.insumos).filter(i => !_cqProdutoInsumo(i) && _cqArr(i.analitoIds).includes(id)).forEach(i => motivos.push(`Vinculado ao lote de insumo ${i.nome} ${i.lote}.`));
  } else if (colecao === 'materiais') {
    const lotes = Object.values(cfg.lotesControle).filter(l => l.materialId === id);
    if (usado('materiais', id) || lotes.some(l => usado('lotesControle', l.id)) || testes.some(t => matsDoTeste(t).includes(id) && usado('testes', t.id))) motivos.push('Possui lançamentos de CQ.');
    lotes.forEach(l => motivos.push(`Possui o lote de controle ${l.lote} (exclua o lote antes).`));
    testes.filter(t => matsDoTeste(t).includes(id)).forEach(t => motivos.push(`Usado no ${nomeTeste(t)}.`));
  } else if (colecao === 'lotesControle') {
    if (usado('lotesControle', id)) motivos.push('Possui lançamentos de CQ.');
    testes.filter(t => lotesDoTeste(t).includes(id)).forEach(t => motivos.push(`Em uso no ${nomeTeste(t)}.`));
  } else if (colecao === 'insumoProdutos') {
    const lotes = _cqLotesDoProduto(id);
    if (lotes.some(l => usado('insumos', l.id))) motivos.push('Possui lançamentos de CQ.');
    lotes.forEach(l => motivos.push(`Possui o lote ${l.lote} (exclua o lote antes).`));
    testes.filter(t => t.insumoProdutoId === id).forEach(t => motivos.push(`Controlado pelo ${nomeTeste(t)}.`));
  } else if (colecao === 'insumos') {
    if (usado('insumos', id)) motivos.push('Possui lançamentos de CQ.');
  }
  return motivos;
}

function _cqResumoCadastro(colecao, r) {
  if (colecao === 'testes') return `${_cqNomeTeste(r)} · ${_cqEquipTeste(r)}`;
  if (colecao === 'analitos') return [r.codigo, r.nome].filter(Boolean).join(' — ');
  if (colecao === 'materiais') return `${r.nome} (${r.fabricante || '—'})`;
  if (colecao === 'lotesControle') return `Lote ${r.lote} — ${cqState.config.materiais[r.materialId]?.nome || '?'}`;
  if (colecao === 'insumoProdutos') return `${r.nome} (${CQ_TIPOS_INSUMO[r.tipo] || r.tipo})`;
  if (colecao === 'insumos') return `${r.nome || '?'} — lote ${r.lote}`;
  return r.id;
}

async function cqExcluirCadastro(colecao, id) {
  if (!_cqCan('configurar')) { showToast('Sem permissão para excluir cadastros do CQ.', 'error'); return; }
  const rec = cqState.config[colecao]?.[id];
  if (!rec) return;
  if (!_cqPodeGravar()) return;
  const rotulo = CQ_COLECAO_LABEL[colecao] || 'cadastro';
  let uso;
  try { uso = await _cqUsoCarregar(); }
  catch (err) {
    console.error('[cq-cadastros.js] cqExcluirCadastro:', err);
    showToast('Não foi possível verificar os lançamentos. Tente novamente.', 'error');
    return;
  }
  const motivos = _cqBloqueiosExclusao(colecao, id, uso);
  if (motivos.length) {
    _cqPrompt({
      titulo: `Não é possível excluir este ${rotulo}`, subtitulo: _cqResumoCadastro(colecao, rec), confirmar: 'Entendi',
      corpo: `<div class="cq-alerta-box">${CQ_ICO.alerta} ${motivos.map(m => _cqEsc(m)).join('<br>')}</div>
        <div class="cq-nota">Cadastros com lançamentos não podem ser excluídos — os registros do CQ devem ser retidos (RDC 978/2025). Desmarque “Ativo” ou altere a situação para retirá-lo de uso.</div>`,
      onConfirm: () => true,
    });
    return;
  }
  _cqPrompt({
    titulo: `Excluir ${rotulo}`, subtitulo: _cqResumoCadastro(colecao, rec), perigo: true, confirmar: 'Excluir',
    corpo: `<div class="cq-nota">Este ${rotulo} não possui lançamentos de CQ. A exclusão remove o cadastro${colecao === 'testes' || colecao === 'lotesControle' ? ' e os alvos vinculados' : ''}. Uma cópia fica registrada no histórico de exclusões.</div>
      <div class="form-field"><label class="field-label">Motivo <span class="required">*</span></label>
        <input type="text" id="cq-excl-motivo" class="field-input" maxlength="200" placeholder="Ex.: cadastro de teste / cadastrado em duplicidade" onkeydown="if(event.key==='Enter')cqPromptConfirmar()"></div>`,
    onConfirm: async () => {
      const motivo = _cqVal('cq-excl-motivo');
      if (!motivo) { showToast('Informe o motivo da exclusão.', 'error'); return false; }
      if (!_cqPodeGravar()) return false;
      let alvosTodos, usoAgora;
      try { [alvosTodos, usoAgora] = await Promise.all([_cqLerOuFalhar(CQ_KEYS.alvos), _cqLerOuFalhar(CQ_KEYS.uso)]); }
      catch (err) { console.error('[cq-cadastros.js] cqExcluirCadastro:', err); showToast('Falha ao ler o banco. Nada foi excluído.', 'error'); return false; }
      // Revalida: outra estação pode ter lançado depois da primeira verificação
      if (_cqBloqueiosExclusao(colecao, id, usoAgora || uso).length) { showToast('Este cadastro passou a ter vínculos. Nada foi excluído.', 'error'); return true; }

      const updates = { [`${CQ_KEYS.config}/${colecao}/${id}`]: null };
      const alvosRemovidos = {};
      Object.entries(alvosTodos || {}).forEach(([u, porTeste]) => Object.entries(porTeste || {}).forEach(([tid, mapa]) => {
        Object.entries(mapa || {}).forEach(([aid, a]) => {
          if ((colecao === 'testes' && tid === id) || (colecao === 'lotesControle' && a?.loteControleId === id)) {
            updates[`${CQ_KEYS.alvos}/${u}/${tid}/${aid}`] = null;
            alvosRemovidos[`${u}|${tid}|${aid}`] = a;
          }
        });
      }));
      updates[`${CQ_KEYS.exclusoes}/${_cqTk()}`] = {
        colecao, id, resumo: _cqResumoCadastro(colecao, rec), motivo, registro: rec,
        alvos: Object.keys(alvosRemovidos).length ? alvosRemovidos : null, ..._cqAssinatura(),
      };
      if (!(await window.dbUpdate(updates))) { showToast('Falha ao excluir. Verifique a conexão e tente novamente.', 'error'); return false; }
      delete cqState.config[colecao][id];
      if (colecao === 'testes') delete cqState.alvos[id];
      showToast(`${rotulo.charAt(0).toUpperCase() + rotulo.slice(1)} excluído.`, 'success');
      cqDrawerClose();
      cqRender();
      return true;
    },
  });
}
