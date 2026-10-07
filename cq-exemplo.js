// ═══════════════════════════════════════════════════════════════
// cq-exemplo.js — Dados de exemplo do Controle de Qualidade — LAMIC
// Cria uma unidade fictícia ("EXEMP") com cadastros no modelo atual (produto ×
// lote de insumo, lotes encerrados por vencimento, meio preparado com preparos,
// qualitativos e semiquantitativo), alvos, ~45 dias de corridas (aceitas,
// alertas, rejeições com repetição, corrida fracionada), não conformidades
// e índices, para demonstrar o módulo. Tudo fica identificado com
// `exemplo: true`, ids iniciados por "ex-" e dados particionados na
// unidade de exemplo, e é removido por cqExemploRemover().
// Os valores são gerados por um gerador pseudoaleatório com semente fixa
// e avaliados pelo mesmo motor (CQEngine) usado nos lançamentos reais.
// ═══════════════════════════════════════════════════════════════

const CQ_EX_U = 'ex-un';
const CQ_EX_FUSO = 'America/Sao_Paulo';
const CQ_EX_DIAS = 45;

function _cqExemploExiste() {
  return !!cqState.config.unidades[CQ_EX_U] || CQ_COLECOES.some(c => Object.keys(cqState.config[c] || {}).some(id => id.startsWith('ex-')));
}

// Gerador pseudoaleatório determinístico (mulberry32) e normal padrão (Box-Muller)
function _cqExRng(seed) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  return { rnd, normal };
}

// Data local (fuso da unidade) deslocada em dias: "YYYY-MM-DD"
function _cqExDia(hoje, d) {
  const dt = new Date(Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 1, +hoje.slice(8, 10)) + d * 86400000);
  return dt.toISOString().slice(0, 10);
}
// "YYYY-MM-DDTHH:mm" local (São Paulo, UTC−3) → ISO, com deslocamento em minutos
function _cqExIso(dh, min) { return new Date(Date.parse(`${dh}:00-03:00`) + (min || 0) * 60000).toISOString(); }
function _cqExSomaMin(dh, min) {
  const d = new Date(Date.parse(`${dh}:00Z`) + min * 60000).toISOString();
  return d.slice(0, 16);
}

function cqExemploCriar() {
  if (!_cqIsAdmin()) { showToast('Somente administradores podem criar dados de exemplo.', 'error'); return; }
  if (!_cqConfigReady) { showToast('Aguarde o carregamento do CQ.', 'info'); return; }
  if (_cqExemploExiste()) { showToast('Os dados de exemplo já existem. Remova-os antes de criar de novo.', 'error'); return; }
  _cqPrompt({
    titulo: 'Criar dados de exemplo', subtitulo: 'Área fictícia “EXEMP”',
    corpo: `<div class="cq-nota">Será criada a área <b>EXEMP — Área de exemplo</b> com cerca de ${CQ_EX_DIAS} dias de corridas:</div>
      <ul class="cq-nota" style="margin:6px 0 10px 18px;padding:0;">
        <li><b>Bioquímica</b> (glicose, colesterol, creatinina): Westgard com aceites, alertas, rejeições, repetições, troca de lote de reagente e lote anterior encerrado por vencimento.</li>
        <li><b>Microbiologia</b> (corrida fracionada): coloração de Gram semanal e Ágar Mueller Hinton preparado no laboratório, com preparos anteriores finalizados (consumidos), um reprovado e descartado e o de hoje em avaliação (desempenho atípico aguardando decisão).</li>
        <li><b>Urinálise</b>: proteína na tira reagente (semiquantitativo), com alerta de uma categoria e uma discordância.</li>
        <li>Produtos com vários lotes (em uso, em avaliação, quarentena, encerrado), produto sem lote e não conformidades abertas e concluídas.</li>
      </ul>
      <div class="cq-alerta-box">${CQ_ICO.alerta} Os dados são fictícios e ficam gravados no banco até serem removidos por “Remover dados de exemplo”. Não use a área de exemplo para registros reais.</div>`,
    confirmar: 'Criar dados de exemplo',
    onConfirm: async () => {
      if (!_cqPodeGravar()) return false;
      let updates;
      try { updates = _cqExemploMontar(); }
      catch (err) { console.error('[cq-exemplo.js] Falha ao montar os dados de exemplo:', err); showToast('Falha ao gerar os dados de exemplo.', 'error'); return false; }
      if (!(await window.dbUpdate(updates))) { showToast('Falha ao gravar os dados de exemplo. Nada foi criado.', 'error'); return false; }
      _cqInvalidarCaches();
      cqSetUnidade(CQ_EX_U);
      cqRenderConfig();
      showToast('Dados de exemplo criados. Área EXEMP selecionada na aba Controle de Qualidade.', 'success');
      return true;
    },
  });
}

// Monta todas as gravações (um único dbUpdate atômico)
function _cqExemploMontar() {
  const U = CQ_EX_U;
  const me = _cqSess();
  const hoje = _cqHoje(CQ_EX_FUSO);
  const agoraLocal = _cqNowLocal(CQ_EX_FUSO);
  const ini = _cqExDia(hoje, -(CQ_EX_DIAS + 15));
  const rng = _cqExRng(20261003);
  const updates = {};
  // Cadastros compartilháveis ficam só na unidade de exemplo
  const cfg = (col, rec) => { const r = CQ_COLECOES_UNIDADE.includes(col) ? { unidadeIds: [U], ...rec } : rec; updates[`${CQ_KEYS.config}/${col}/${rec.id}`] = r; return r; };
  const ass = (dh, min) => ({ porId: me.id, porNome: me.nome, em: dh ? _cqExIso(dh, min) : _cqAgora(), unidadeId: U, estacao: 'EXEMPLO' });
  const tr = (dh, min, acao, texto, diffs) => ({ ts: _cqExIso(dh, min), userId: me.id, userName: me.nome, unidadeId: U, estacao: 'EXEMPLO', acao, texto, diffs: diffs || [] });
  // Chave da trilha a partir do instante do registro: a ordem de exibição segue a cronologia
  let nTr = 0;
  const trK = (dh, min) => Date.parse(_cqExIso(dh, min)).toString(36).padStart(9, '0') + String(++nTr).padStart(4, '0');
  const addTr = (rec, dh, min, acao, texto, diffs) => { rec.trilha[trK(dh, min)] = tr(dh, min, acao, texto, diffs); };
  const novo = (rec, txt, dhCriacao) => {
    const dh = dhCriacao || `${ini}T08:00`;
    return { ...rec, exemplo: true, criadoEm: _cqExIso(dh), criadoPor: ass(dh), trilha: { [trK(dh, 0)]: tr(dh, 0, 'criacao', `${txt} (dados de exemplo)`) } };
  };
  // Lote vencido encerrado pelo gatilho (_cqEncerrarVencidos) no dia seguinte à validade
  const encerrarAuto = (rec, validade) => {
    const dh = `${_cqExDia(validade, 1)}T00:05`;
    rec.status = 'encerrado';
    rec.encerradoAuto = { em: _cqExIso(dh), validade, statusAnterior: 'em_uso' };
    addTr(rec, dh, 0, 'automatico', `Lote encerrado automaticamente: validade ${_cqFmtData(validade)} expirada`, [{ campo: 'Situação', antes: 'Em uso', depois: 'Encerrado' }]);
    rec.trilha[Object.keys(rec.trilha).pop()].automatico = true;
    return rec;
  };

  // ── Unidade (microbiologia em corrida fracionada: Gram e meios rodam em momentos distintos) ──
  const sisBq = 'Analisador bioquímico (exemplo)', sisMic = 'Bancada de microbiologia (exemplo)', sisUri = 'Leitura de tiras reagentes (exemplo)';
  cfg('unidades', novo({
    id: U, sigla: 'EXEMP', nome: 'Área de exemplo (dados fictícios)', cnes: '', endereco: '', fuso: CQ_EX_FUSO, rtUserId: me.id,
    setores: [], diasOperacao: [0, 1, 2, 3, 4, 5, 6], ativa: true, validacao: true, membros: { [me.id]: 'rt' },
    politica: { liberarAceitosAoSalvar: true, comentarioObrigatorioAlerta: true, reautenticar: true, retroativoHoras: 24,
                modoCorrida: 'lote', modoCorridaEquip: { [_cqChaveModoEquip('m:' + sisMic)]: 'fracionada' } },
  }, 'Área cadastrada'));

  // ── Analitos (com os sistemas analíticos onde são dosados) ──
  const AN = {
    glic: { id: 'ex-an-glic', codigo: 'EX-GLI', nome: 'Glicose (exemplo)', unidadeMedida: 'mg/dL', decimais: 0, eta: 8, limites: [70, 100, 126] },
    col:  { id: 'ex-an-col', codigo: 'EX-COL', nome: 'Colesterol total (exemplo)', unidadeMedida: 'mg/dL', decimais: 0, eta: 10, limites: [190, 240] },
    crea: { id: 'ex-an-crea', codigo: 'EX-CRE', nome: 'Creatinina (exemplo)', unidadeMedida: 'mg/dL', decimais: 2, eta: 10, limites: [1.3] },
  };
  Object.values(AN).forEach(a => cfg('analitos', novo({
    id: a.id, codigo: a.codigo, nome: a.nome, unidadeMedida: a.unidadeMedida, decimais: a.decimais, tipo: 'quantitativo', especialidade: 'Bioquímica',
    limitesDecisao: a.limites, escala: null, toleranciaPassos: null, ativo: true, cvMeta: null, ativoIds: [], sistemas: [sisBq],
    eta: { valor: a.eta, tipo: '%', fonte: 'CLIA 2024 (EUA)', referencia: 'Valor ilustrativo' },
  }, 'Analito cadastrado')));
  // Qualitativos e semiquantitativo: escala = resultados possíveis (a ordem importa no semiquantitativo)
  const QL = {
    'ex-an-gram': { codigo: 'EX-GRAM', nome: 'Coloração de Gram (exemplo)', tipo: 'qualitativo', esp: 'Microbiologia', sis: sisMic, escala: [...CQ_MODELOS_MICRO[2].escala] },
    'ex-an-est':  { codigo: 'EX-EST', nome: 'Esterilidade de meio de cultura (exemplo)', tipo: 'qualitativo', esp: 'Microbiologia', sis: sisMic, escala: [...CQ_MODELOS_MICRO[0].escala] },
    'ex-an-des':  { codigo: 'EX-DES', nome: 'Desempenho de meio de cultura (exemplo)', tipo: 'qualitativo', esp: 'Microbiologia', sis: sisMic, escala: [...CQ_MODELOS_MICRO[1].escala] },
    'ex-an-prot': { codigo: 'EX-PROT', nome: 'Proteína na urina — tira (exemplo)', tipo: 'semiquantitativo', esp: 'Urinálise', sis: sisUri, escala: ['Negativo', 'Traços', '1+', '2+', '3+'], tol: 1 },
  };
  Object.entries(QL).forEach(([id, a]) => cfg('analitos', novo({
    id, codigo: a.codigo, nome: a.nome, unidadeMedida: '', decimais: 0, tipo: a.tipo, especialidade: a.esp, limitesDecisao: [], eta: null, cvMeta: null,
    escala: a.escala, toleranciaPassos: a.tol ?? null, ativo: true, ativoIds: [], sistemas: [a.sis],
  }, 'Analito cadastrado')));
  const escalaGram = QL['ex-an-gram'].escala, escalaEst = QL['ex-an-est'].escala, escalaDes = QL['ex-an-des'].escala, escalaProt = QL['ex-an-prot'].escala;

  // ── Materiais, cepas e lotes de controle ──
  const validade = _cqExDia(hoje, 300);
  cfg('materiais', novo({
    id: 'ex-mat-bq', nome: 'Controle bioquímico (exemplo)', fabricante: 'Fabricante fictício', fornecedor: '', tipo: 'comercial', regAnvisa: '',
    matriz: 'Soro humano liofilizado', codigoReferencia: '', estabilidadeAbertoDias: 30, armazenamento: '2 a 8 °C; após reconstituição 2 a 8 °C',
    niveis: { 1: { nome: 'Normal' }, 2: { nome: 'Patológico' } }, equips: ['m:' + sisBq], analitoIds: Object.values(AN).map(a => a.id), ativo: true,
  }, 'Material cadastrado'));
  // Lote anterior (vencido e encerrado), lote em uso e o próximo em avaliação paralela
  const valBqAnt = _cqExDia(ini, -1);
  cfg('lotesControle', encerrarAuto(novo({
    id: 'ex-lt-bq-ant', materialId: 'ex-mat-bq', lote: 'EX-2025B', validade: valBqAnt, niveis: [1, 2], status: 'em_uso', bulaUrl: '', observacoes: 'Lote anterior',
  }, 'Lote cadastrado', `${_cqExDia(ini, -200)}T08:00`), valBqAnt));
  cfg('lotesControle', novo({
    id: 'ex-lt-bq', materialId: 'ex-mat-bq', lote: 'EX-2026A', validade, niveis: [1, 2], status: 'em_uso', bulaUrl: '', observacoes: 'Lote em uso',
  }, 'Lote cadastrado'));
  cfg('lotesControle', novo({
    id: 'ex-lt-bq-prox', materialId: 'ex-mat-bq', lote: 'EX-2026B', validade: _cqExDia(hoje, 420), niveis: [1, 2], status: 'em_avaliacao', bulaUrl: '',
    observacoes: 'Próximo lote — em avaliação paralela antes da troca',
  }, 'Lote cadastrado', `${_cqExDia(hoje, -6)}T09:00`));
  const cepas = [
    { id: 'ex-mat-sau', nome: 'Staphylococcus aureus (exemplo)', ref: 'ATCC 25923', lote: 'ex-lt-sau', ans: ['ex-an-gram'] },
    { id: 'ex-mat-eco', nome: 'Escherichia coli (exemplo)', ref: 'ATCC 25922', lote: 'ex-lt-eco', ans: ['ex-an-gram', 'ex-an-des'] },
  ];
  cepas.forEach(c => cfg('materiais', novo({
    id: c.id, nome: c.nome, fabricante: 'Coleção de culturas fictícia', fornecedor: '', tipo: 'cepa_referencia', regAnvisa: '', matriz: 'Cepa liofilizada',
    codigoReferencia: c.ref, estabilidadeAbertoDias: 7, armazenamento: 'Estoque −20 °C; cultura de trabalho 2 a 8 °C', niveis: { 1: { nome: '' } }, equips: ['m:' + sisMic], analitoIds: c.ans, ativo: true,
  }, 'Material cadastrado')));
  cepas.forEach(c => cfg('lotesControle', novo({
    id: c.lote, materialId: c.id, lote: `EX-${c.ref.replace(/\D/g, '')}`, validade, niveis: [1], status: 'em_uso', bulaUrl: '', observacoes: 'Repique semanal',
  }, 'Lote cadastrado')));
  cfg('materiais', novo({
    id: 'ex-mat-uri', nome: 'Controle de urinálise (exemplo)', fabricante: 'Fabricante fictício', fornecedor: '', tipo: 'comercial', regAnvisa: '',
    matriz: 'Urina humana liofilizada', codigoReferencia: '', estabilidadeAbertoDias: 30, armazenamento: '2 a 8 °C',
    niveis: { 1: { nome: 'Negativo' }, 2: { nome: 'Positivo' } }, equips: ['m:' + sisUri], analitoIds: ['ex-an-prot'], ativo: true,
  }, 'Material cadastrado'));
  cfg('lotesControle', novo({
    id: 'ex-lt-uri', materialId: 'ex-mat-uri', lote: 'EX-URI-26', validade, niveis: [1, 2], status: 'em_uso', bulaUrl: '', observacoes: '',
  }, 'Lote cadastrado'));

  // ── Reagentes, calibrador, corante e meio: produto + lotes ──
  const produto = (id, tipo, nome, analitoIds, sis, extra) => cfg('insumoProdutos', novo({
    id, tipo, nome, fabricante: 'Fabricante fictício', regAnvisa: '', analitoIds, equips: ['m:' + sis], preparoInterno: false, preparo: null, ativo: true, ...(extra || {}),
  }, 'Produto cadastrado'));
  const lote = (id, produtoId, num, val, extra, dhCriacao) => cfg('insumos', novo({ id, produtoId, lote: num, validade: val, status: 'em_uso', observacoes: '', ...(extra || {}) }, 'Lote de insumo cadastrado', dhCriacao));
  produto('ex-pi-glic', 'reagente', 'Reagente glicose (exemplo)', [AN.glic.id], sisBq);
  produto('ex-pi-col', 'reagente', 'Reagente colesterol (exemplo)', [AN.col.id], sisBq);
  produto('ex-pi-crea', 'reagente', 'Reagente creatinina (exemplo)', [AN.crea.id], sisBq);
  produto('ex-pi-cal', 'calibrador', 'Calibrador bioquímico (exemplo)', Object.values(AN).map(a => a.id), sisBq);
  produto('ex-pi-gram', 'corante', 'Kit de coloração de Gram (exemplo)', ['ex-an-gram'], sisMic);
  produto('ex-pi-tira', 'reagente', 'Tira reagente de urina (exemplo)', ['ex-an-prot'], sisUri);
  produto('ex-pi-mh', 'meio_cultura', 'Ágar Mueller Hinton (exemplo)', ['ex-an-est', 'ex-an-des'], sisMic, {
    preparoInterno: true, preparo: { especificacao: '38 g/L; pH 7,3 ± 0,1', armazenamento: '2 a 8 °C, protegido da luz', riscos: 'Pó irritante', validadeDias: 28 } });
  produto('ex-pi-as', 'meio_cultura', 'Ágar sangue de carneiro (exemplo)', ['ex-an-est', 'ex-an-des'], sisMic);   // sem lote: aparece como pendência
  // Glicose: lote RG-000 venceu no meio do período (encerrado pelo gatilho) e a rotina passou ao RG-001
  const dTrocaGlic = -20;
  const valGlicAnt = _cqExDia(hoje, dTrocaGlic - 1);
  encerrarAuto(lote('ex-ins-glic-ant', 'ex-pi-glic', 'RG-000', valGlicAnt, null, `${_cqExDia(ini, -120)}T08:00`), valGlicAnt);
  lote('ex-ins-glic', 'ex-pi-glic', 'RG-001', validade, null, `${_cqExDia(hoje, dTrocaGlic - 3)}T08:00`);
  lote('ex-ins-col', 'ex-pi-col', 'RC-001', validade);
  lote('ex-ins-crea', 'ex-pi-crea', 'RK-001', validade);
  lote('ex-ins-cal', 'ex-pi-cal', 'CAL-01', validade);
  lote('ex-ins-gram', 'ex-pi-gram', 'GR-001', validade);
  lote('ex-ins-gram-2', 'ex-pi-gram', 'GR-002', _cqExDia(hoje, 540), { status: 'quarentena', observacoes: 'Novo fornecedor: aguarda coloração em paralelo antes da liberação' }, `${_cqExDia(hoje, -3)}T10:00`);
  lote('ex-ins-tira', 'ex-pi-tira', 'TR-2604', validade);
  const loteMH = lote('ex-ins-mh', 'ex-pi-mh', 'MH-2611', _cqExDia(hoje, 500), { observacoes: 'Meio desidratado (frasco de 500 g)', preparos: {} });

  // ── Testes e alvos ──
  const regras = { ...CQEngine.PRESETS.westgard_n2.regras };
  // alvos: média e DP estabelecidos no lote em uso; bula: faixa do fabricante [mín, máx] do lote em uso e do próximo lote
  const TQ = [
    { id: 'ex-te-glic', an: AN.glic, metodo: 'Hexoquinase', lr: d => (d < dTrocaGlic ? 'ex-ins-glic-ant' : 'ex-ins-glic'), alvos: { 1: [95, 2.5], 2: [280, 6.5] },
      bula: { 1: [85, 105], 2: [250, 310] }, bulaProx: { 1: [88, 108], 2: [245, 305] } },
    { id: 'ex-te-col', an: AN.col, metodo: 'Enzimático colorimétrico', lr: () => 'ex-ins-col', alvos: { 1: [180, 4.5], 2: [260, 6] },
      bula: { 1: [160, 200], 2: [232, 288] }, bulaProx: { 1: [156, 196], 2: [237, 293] } },
    { id: 'ex-te-crea', an: AN.crea, metodo: 'Jaffé cinético', lr: () => 'ex-ins-crea', alvos: { 1: [1.0, 0.04], 2: [4.5, 0.13] },
      bula: { 1: [0.85, 1.15], 2: [4.0, 5.0] }, bulaProx: { 1: [0.9, 1.2], 2: [3.9, 4.9] } },
  ];
  // Alvo a partir da faixa da bula (média = centro; DP = amplitude / 2k, k = 2)
  const alvoBula = ([min, max], dec) => ({ media: CQEngine.arred((min + max) / 2, dec + 1), dp: CQEngine.arred((max - min) / 4, dec + 2), faixaFabricante: { min, max, k: 2 } });
  const TESTES = {};
  TQ.forEach(t => {
    t.rec = novo({
      id: t.id, unidadeId: U, analitoId: t.an.id, ativoId: null, ativoSnap: null, sistemaAnalitico: sisBq, metodo: t.metodo, inicioUso: ini,
      materialId: 'ex-mat-bq', niveis: [1, 2], lotesAtivos: { 1: 'ex-lt-bq', 2: 'ex-lt-bq' }, frequencia: { tipo: 'diaria', vezesDia: 1 },
      regrasPreset: 'westgard_n2', regras: { ...regras }, opcoesRegras: { gatilho12s: false, incluirRejeitados: false }, etaOverride: null,
      controlesQual: {}, insumoTipo: '', insumoProduto: '', insumoProdutoId: '', exigirInsumo: false, ativo: true, versaoConfig: 1,
    }, 'Teste cadastrado', `${_cqExDia(ini, -30)}T08:00`);   // antes do alvo da bula (período de estabelecimento)
    t.alvoRec = {};
    const dec = t.an.decimais;
    const dhBula = `${_cqExDia(ini, -30)}T09:00`, dhProx = `${_cqExDia(hoje, -6)}T09:30`;
    [1, 2].forEach(n => {
      const [media, dp] = t.alvos[n];
      const base = `ex-al-${t.id.slice(6)}-${n}`;
      // 1) Bula do fabricante: usada enquanto o laboratório acumulava as 20 corridas do estabelecimento
      const fab = { id: `${base}-fab`, loteControleId: 'ex-lt-bq', nivel: n, ...alvoBula(t.bula[n], dec), origem: 'fabricante', nPontos: null, vigenteDesde: `${_cqExDia(ini, -30)}T00:00`, substitui: null,
        justificativa: 'Valores da bula do lote EX-2026A até o estabelecimento da média e DP do laboratório (exemplo)', aprovado: ass(dhBula), criadoEm: _cqExIso(dhBula), exemplo: true };
      // 2) Estabelecido pelo laboratório (vigente nas corridas do período)
      t.alvoRec[n] = {
        id: base, loteControleId: 'ex-lt-bq', nivel: n, media, dp, origem: 'estabelecido', nPontos: 20, vigenteDesde: `${ini}T00:00`, substitui: fab.id,
        justificativa: 'Média e DP de 20 corridas no período de estabelecimento (exemplo)', faixaFabricante: null,
        aprovado: ass(`${ini}T10:00`), criadoEm: _cqExIso(`${ini}T10:00`), exemplo: true,
      };
      // 3) Próximo lote (EX-2026B, em avaliação paralela): alvo da bula até haver dados próprios
      const prox = { id: `${base}-prox`, loteControleId: 'ex-lt-bq-prox', nivel: n, ...alvoBula(t.bulaProx[n], dec), origem: 'fabricante', nPontos: null, vigenteDesde: `${_cqExDia(hoje, -6)}T00:00`, substitui: null,
        justificativa: 'Bula do lote EX-2026B para a avaliação em paralelo antes da troca (exemplo)', aprovado: ass(dhProx), criadoEm: _cqExIso(dhProx), exemplo: true };
      [fab, t.alvoRec[n], prox].forEach(a => { updates[`${CQ_KEYS.alvos}/${U}/${t.id}/${a.id}`] = a; });
    });
    [[dhBula, 'fab', 'EX-2026A', t.bula], [`${ini}T10:00`, null, 'EX-2026A', null], [dhProx, 'prox', 'EX-2026B', t.bulaProx]].forEach(([dh, , lote, faixa]) => {
      const txt = [1, 2].map(n => {
        const a = faixa ? alvoBula(faixa[n], dec) : { media: t.alvos[n][0], dp: t.alvos[n][1] };
        return `N${n} média ${a.media}, DP ${a.dp}`;
      }).join('; ');
      addTr(t.rec, dh, 0, 'alvo', `Novo alvo lote ${lote}: ${txt} (${faixa ? CQ_ORIGEM_ALVO.fabricante.label : CQ_ORIGEM_ALVO.estabelecido.label}) — dados de exemplo`);
    });
    TESTES[t.id] = cfg('testes', t.rec);
  });
  // Qualitativos: o produto controlado é vinculado pelo cadastro (insumoProdutoId)
  const testeQual = (id, analitoId, sis, metodo, controlesQual, lotesAtivos, frequencia, insumoTipo, produtoId) => {
    TESTES[id] = cfg('testes', novo({
      id, unidadeId: U, analitoId, ativoId: null, ativoSnap: null, sistemaAnalitico: sis, metodo, inicioUso: ini, materialId: '',
      niveis: Object.keys(controlesQual).map(Number), controlesQual, lotesAtivos, frequencia: { tipo: frequencia, vezesDia: 1 },
      regrasPreset: 'qualitativo', regras: {}, opcoesRegras: {}, etaOverride: null,
      insumoTipo, insumoProduto: metodo, insumoProdutoId: produtoId, exigirInsumo: true, ativo: true, versaoConfig: 1,
    }, 'Teste cadastrado'));
    return TESTES[id];
  };
  const TG = testeQual('ex-te-gram', 'ex-an-gram', sisMic, 'Kit de coloração de Gram (exemplo)',
    { 1: { rotulo: 'S. aureus ATCC 25923', materialId: 'ex-mat-sau', esperado: escalaGram[0] }, 2: { rotulo: 'E. coli ATCC 25922', materialId: 'ex-mat-eco', esperado: escalaGram[1] } },
    { 1: 'ex-lt-sau', 2: 'ex-lt-eco' }, 'semanal', 'corante', 'ex-pi-gram');
  const TE = testeQual('ex-te-est', 'ex-an-est', sisMic, 'Ágar Mueller Hinton (exemplo)',
    { 1: { rotulo: 'Placa não inoculada', materialId: '', esperado: escalaEst[0] } }, {}, 'por_lote', 'meio_cultura', 'ex-pi-mh');
  const TD = testeQual('ex-te-des', 'ex-an-des', sisMic, 'Ágar Mueller Hinton (exemplo)',
    { 1: { rotulo: 'E. coli ATCC 25922', materialId: 'ex-mat-eco', esperado: escalaDes[0] } }, { 1: 'ex-lt-eco' }, 'por_lote', 'meio_cultura', 'ex-pi-mh');
  const TU = testeQual('ex-te-prot', 'ex-an-prot', sisUri, 'Tira reagente de urina (exemplo)',
    { 1: { rotulo: 'Controle negativo', materialId: 'ex-mat-uri', nivelLote: 1, esperado: 'Negativo' }, 2: { rotulo: 'Controle positivo', materialId: 'ex-mat-uri', nivelLote: 2, esperado: '2+' } },
    { 1: 'ex-lt-uri', 2: 'ex-lt-uri' }, 'diaria', 'reagente', 'ex-pi-tira');
  const nomeAn = { ...Object.fromEntries(Object.values(AN).map(a => [a.id, a.nome])), ...Object.fromEntries(Object.entries(QL).map(([id, a]) => [id, a.nome])) };
  const nomeT = t => QL[t.analitoId] ? `${nomeAn[t.analitoId]} · ${t.metodo}` : nomeAn[t.analitoId];

  // ── Corridas ──
  const seq = {};
  const proxNumero = (tipo, ano) => {
    seq[`${tipo}/${ano}`] = (seq[`${tipo}/${ano}`] || 0) + 1;
    const n = seq[`${tipo}/${ano}`];
    return tipo === 'nc' ? `NC-EXEMP-${ano}-${String(n).padStart(3, '0')}` : `EXEMP-${ano}-${String(n).padStart(6, '0')}`;
  };
  const hist = {};          // testeId → resultados expandidos (para as regras entre corridas)
  const ultimo = {}, pendentes = {}, ncAbertas = {};
  const ncs = [];
  let sufixo = 0;

  // Grava uma corrida. linhas: [{ t, qual, valores: {n: z | obtido}, lr, lk, prep, trocaLr, motivo }]
  const gravarCorrida = (dh, sistema, linhas, opts = {}) => {
    const ck = CQEngine.chaveCorrida(dh, 'ex' + String(++sufixo).padStart(3, '0'));
    const mes = CQEngine.mesDe(dh);
    const numero = proxNumero('corridas', dh.slice(0, 4));
    const testes = {};
    const resumo = [];
    const rejeitados = [];
    linhas.forEach(L => {
      const t = L.t;
      const porNivel = {}, atual = [];
      let r;
      if (L.qual) {
        const q = QL[t.analitoId];
        Object.entries(L.valores).forEach(([n, obtido]) => {
          const c = t.controlesQual[n];
          porNivel[n] = { obtido, esperado: c.esperado, loteId: t.lotesAtivos[n] || null };
          atual.push({ nivel: Number(n), obtido, esperado: c.esperado, rotulo: c.rotulo });
        });
        r = CQEngine.avaliarCorridaQualitativa({ atual, tipo: q.tipo, escala: q.escala, tolerancia: q.tol });
      } else {
        const tq = TQ.find(x => x.id === t.id);
        Object.entries(L.valores).forEach(([n, z]) => {
          const alvo = tq.alvoRec[n];
          const valor = CQEngine.arred(alvo.media + z * alvo.dp, tq.an.decimais);
          const zz = CQEngine.zScore(valor, alvo.media, alvo.dp);
          porNivel[n] = { valor, alvo, z: zz, loteId: 'ex-lt-bq' };
          atual.push({ nivel: Number(n), z: zz });
        });
        const h = CQEngine.prepararHistorico(hist[t.id] || [], { antesDe: ck, janelaMax: CQEngine.janelaMax(t.regras) });
        r = CQEngine.avaliarCorrida({ atual, historico: h, regras: t.regras, opcoes: { gatilho12s: false } });
      }
      // Decisão: aceitos liberados ao salvar; alertas liberados com comentário (exceto na corrida de hoje); rejeições rejeitadas
      let decisao = null;
      if (r.status === 'aceito') decisao = { acao: 'liberado', auto: true, comentario: 'Liberado ao salvar (sem violações)', ...ass(dh, 5) };
      else if (r.status === 'alerta' && !opts.pendente) decisao = { acao: 'liberado', comentario: L.comentario || 'Alerta avaliado: sem tendência nos níveis e corridas anteriores; resultados liberados.', ...ass(dh, 20) };
      else if (r.status === 'rejeitado' && !opts.pendente) decisao = { acao: 'rejeitado', comentario: L.motivo || 'Controle fora dos limites; resultados de pacientes retidos.', ...ass(dh, 15) };
      const sigla = decisao ? CQ_DECISAO[decisao.acao].sigla : null;
      const niveisMap = {};
      Object.entries(porNivel).forEach(([n, p]) => {
        const rk = `${ck}_n${n}`;
        niveisMap[n] = rk;
        const est = CQ_ESTADO_SIGLA[r.porNivel[n]?.status || 'sem_alvo'];
        const res = L.qual
          ? { corridaKey: ck, nivel: Number(n), loteControleId: p.loteId, obtido: p.obtido, esperado: p.esperado, estado: est, regras: r.porNivel[n]?.regras || [], decisao: sigla, loteReagenteId: L.lr || null, preparoId: L.prep || null }
          : { corridaKey: ck, nivel: Number(n), loteControleId: p.loteId, valor: p.valor, alvoId: p.alvo.id, media: p.alvo.media, dp: p.alvo.dp,
              z: CQEngine.arred(p.z, 4), estado: est, regras: r.porNivel[n]?.regras || [], decisao: sigla, loteReagenteId: L.lr || null, loteCalibradorId: L.lk || null };
        updates[`${CQ_KEYS.resultados}/${U}/${mes}/${t.id}/${rk}`] = CQEngine.compactarResultado(res);
        (hist[t.id] = hist[t.id] || []).push(res);
        _cqMarcarUso(updates, 'lotesControle', p.loteId);
        _cqMarcarUso(updates, 'materiais', t.controlesQual?.[n]?.materialId || t.materialId);
      });
      _cqMarcarUso(updates, 'testes', t.id);
      _cqMarcarUso(updates, 'analitos', t.analitoId);
      _cqMarcarUso(updates, 'materiais', t.materialId);
      _cqMarcarUso(updates, 'insumos', L.lr);
      _cqMarcarUso(updates, 'insumos', L.lk);
      testes[t.id] = {
        niveis: niveisMap, lr: L.lr || null, lk: L.lk || null, prep: L.prep || null, posCalibracao: !!L.posCalibracao, trocaLoteReagente: !!L.trocaLr, trocaLoteCalibrador: false, versaoConfig: 1,
        avaliacao: { status: r.status, violacoes: r.violacoes.map(v => ({ regra: v.regra, severidade: v.severidade, escopo: v.escopo, niveis: v.niveis, texto: v.texto })) },
        decisao,
      };
      ultimo[t.id] = { dataHora: dh, corridaKey: ck, mes, status: r.status, decisao: sigla, lr: L.lr || null, lk: L.lk || null };
      resumo.push(`${nomeT(t)}: ${CQ_STATUS[r.status]?.label}`);
      if (decisao?.acao === 'rejeitado') rejeitados.push({ t, r, decisao, motivo: L.motivo });
    });
    const hdr = {
      numero, unidadeId: U, ativoId: null, ativoSnap: null, sistemaAnalitico: sistema, dataHora: dh,
      operadorId: me.id, operadorNome: me.nome, lancadoPorId: me.id, lancadoPorNome: me.nome, lancadoEm: _cqExIso(dh, 3), servTs: Date.parse(_cqExIso(dh, 3)), estacao: 'EXEMPLO',
      retroativo: null, flags: { posManutPrev: false, posManutCorr: false, reinicioEquip: false, verificacao: false, otRef: null },
      repeticaoDe: opts.repeticaoDe || null, testes, exemplo: true, trilha: {},
    };
    if (_cqModoCorridaEx(sistema) === 'fracionada') hdr.fracionada = true;
    addTr(hdr, dh, 3, 'criacao', `Corrida ${numero} lançada${hdr.fracionada ? ' (fracionada)' : ''} — ${resumo.join('; ')}`);
    Object.entries(testes).forEach(([tid, ct]) => {
      if (ct.decisao && !ct.decisao.auto) addTr(hdr, dh, ct.decisao.acao === 'rejeitado' ? 15 : 20, 'decisao', `${nomeT(TESTES[tid])}: ${CQ_DECISAO[ct.decisao.acao].label} — ${ct.decisao.comentario}`);
    });
    hdr.status = _cqStatusCorrida(hdr);
    const pend = _cqResumoPendencia({ ...hdr, key: ck, mes });
    if (pend) pendentes[ck] = pend;
    rejeitados.forEach(x => ncs.push({ ...x, ck, mes, dh, numero, hdr }));
    updates[`${CQ_KEYS.corridas}/${U}/${mes}/${ck}`] = hdr;
    return { ck, mes, numero, hdr, rejeitados };
  };
  const _cqModoCorridaEx = sistema => sistema === sisMic ? 'fracionada' : 'lote';

  // Preparos do Ágar MH (RDC 978, art. 101): criados na corrida; a decisão da corrida libera ou reprova
  let nPrep = 0;
  const prepararMH = (dia, dh, valores, opts = {}) => {
    // O preparo anterior é finalizado quando o novo é feito (consumido ou, se reprovado, descartado)
    Object.values(loteMH.preparos).filter(x => !x.finalizado).forEach(x => {
      const motivo = x.situacao === 'reprovado' ? 'Descartado (reprovado no controle)' : `Consumido; substituído pelo preparo de ${_cqFmtData(dia)}`;
      x.finalizado = { auto: false, motivo, ...ass(dh, -5) };
      addTr(loteMH, dh, -5, 'edicao', `Preparo de ${_cqFmtData(x.data)} finalizado: ${motivo}`, [{ campo: 'Preparo finalizado', antes: 'Não', depois: 'Sim' }]);
    });
    const id = `ex-pr-${++nPrep}`;
    const p = { id, seq: nPrep, codigo: `MH-2611-P${String(nPrep).padStart(2, '0')}`, dataHora: dh.slice(0, 16), quantidade: nPrep % 2 ? 500 : 900, unidadeQtd: 'mL', origem: 'lancamento',
      data: dia, responsavelId: me.id, responsavel: me.nome, validade: _cqPrepValidade({ validade: loteMH.validade, preparo: { validadeDias: 28 } }, dia),
      situacao: 'em_avaliacao', legado: false, criadoEm: _cqExIso(dh, 3), criadoPor: ass(dh, 3), corridas: {} };
    loteMH.preparos[id] = p;
    const c = gravarCorrida(dh, sisMic, [
      { t: TE, qual: true, lr: 'ex-ins-mh', prep: id, valores: { 1: valores.est }, motivo: opts.motivo },
      { t: TD, qual: true, lr: 'ex-ins-mh', prep: id, valores: { 1: valores.des } },
    ], { pendente: opts.pendente });
    [TE, TD].forEach(t => { p.corridas[c.ck] = { numero: c.numero, mes: c.mes, dataHora: dh, testeId: t.id }; });
    addTr(loteMH, dh, 3, 'edicao', `Preparo de ${_cqFmtData(dia)} (${me.nome}) registrado na corrida ${c.numero}`);
    const decs = Object.values(c.hdr.testes).map(ct => ct.decisao).filter(Boolean);
    if (decs.length === 2) {
      const reprova = decs.some(x => x.acao === 'rejeitado');
      p.situacao = reprova ? 'reprovado' : 'liberado';
      p.avaliacao = { numero: c.numero, corridaKey: c.ck, mes: c.mes, acao: reprova ? 'rejeitado' : 'liberado', ...ass(dh, reprova ? 15 : 5) };
      addTr(loteMH, dh, reprova ? 15 : 5, 'edicao', `Preparo de ${_cqFmtData(dia)} ${reprova ? 'reprovado' : 'liberado'} pela decisão da corrida ${c.numero}`);
    }
    return c;
  };

  // Cenários: rejeição 1-3s na glicose, desvio sistemático no colesterol, alertas na creatinina,
  // preparo de meio contaminado, discordância e alerta de uma categoria na urinálise
  const zBase = () => Math.max(-1.8, Math.min(1.8, rng.normal() * 0.75));
  const dGlicRej = -31, dColIni = -12, dCreaAlerta = [-20, -5];
  const dPreparos = [-42, -28, -27, -14, 0];     // -28: preparo contaminado (reprovado); -27: novo preparo
  const dUriAlerta = [-24, -9], dUriRej = -33;
  let colCorrigido = false;
  const minAntesDeAgora = (dh, hoje0, min) => (hoje0 && dh >= agoraLocal ? _cqExSomaMin(agoraLocal, -min) : dh);
  for (let d = -CQ_EX_DIAS + 1; d <= 0; d++) {
    const dia = _cqExDia(hoje, d);
    const hoje0 = d === 0;
    const dh = minAntesDeAgora(`${dia}T07:30`, hoje0, 25);
    const linhas = TQ.map(tq => {
      const z = { 1: zBase(), 2: zBase() };
      let motivo = '';
      if (tq.id === 'ex-te-glic' && d === dGlicRej) { z[1] = 3.4; motivo = 'Resultado do nível 1 acima de 3 DP (erro aleatório). Bolha na cubeta observada.'; }
      if (tq.id === 'ex-te-col' && d >= dColIni && !colCorrigido) { z[1] = 1.3 + Math.abs(zBase()) * 0.4; z[2] = 1.4 + Math.abs(zBase()) * 0.4; motivo = 'Desvio sistemático positivo nos dois níveis; suspeita de calibração.'; }
      if (tq.id === 'ex-te-crea' && dCreaAlerta.includes(d)) z[d === -20 ? 2 : 1] = d === -20 ? 2.3 : -2.2;
      if (tq.id === 'ex-te-crea' && hoje0) z[1] = 2.4;
      return { t: tq.rec, valores: z, lr: tq.lr(d), lk: 'ex-ins-cal', trocaLr: tq.id === 'ex-te-glic' && d === dTrocaGlic, motivo };
    });
    const c = gravarCorrida(dh, sisBq, linhas, { pendente: hoje0 });
    // Repetição após rejeição (após ação corretiva), só com os testes rejeitados
    if (c.rejeitados.length && !hoje0) {
      c.rejeitados.forEach(x => { if (x.t.id === 'ex-te-col') colCorrigido = true; });
      const dhRep = _cqExSomaMin(dh, 90);
      const rep = gravarCorrida(dhRep, sisBq, c.rejeitados.map(x => {
        const tq = TQ.find(q => q.id === x.t.id);
        return { t: tq.rec, valores: { 1: zBase() * 0.6, 2: zBase() * 0.6 }, lr: tq.lr(d), lk: 'ex-ins-cal', posCalibracao: tq.id === 'ex-te-col' };
      }), { repeticaoDe: c.ck });
      c.rejeitados.forEach(x => { x.repeticao = { ck: rep.ck, mes: rep.mes, numero: rep.numero, dh: dhRep, status: rep.hdr.testes[x.t.id]?.avaliacao?.status }; });
      ncs.filter(n => n.ck === c.ck).forEach(n => { n.repeticao = c.rejeitados.find(x => x.t.id === n.t.id)?.repeticao; });
    }
    // Urinálise diária: N2 positivo esperado 2+ (1+ ou 3+ = alerta; negativo = discordância)
    const dhUri = minAntesDeAgora(`${dia}T08:15`, hoje0, 20);
    const n2 = d === dUriRej ? 'Negativo' : dUriAlerta.includes(d) ? (d === -9 ? '3+' : '1+') : '2+';
    gravarCorrida(dhUri, sisUri, [{
      t: TU, qual: true, lr: 'ex-ins-tira', valores: { 1: 'Negativo', 2: n2 },
      motivo: d === dUriRej ? 'Controle positivo lido como negativo: tira exposta à umidade (frasco aberto sem dessecante).' : '',
      comentario: 'Diferença de uma categoria no controle positivo; nível negativo concordante e sem recorrência. Resultados liberados.',
    }], { pendente: hoje0 });
    // Microbiologia (fracionada): coloração de Gram semanal; discordância no nível 2 três semanas atrás
    if ((-d) % 7 === 0) {
      const disc = d === -21;
      const dhMic = minAntesDeAgora(_cqExSomaMin(dh, 90), hoje0, 15);
      gravarCorrida(dhMic, sisMic, [{
        t: TG, qual: true, lr: 'ex-ins-gram',
        valores: { 1: escalaGram[0], 2: disc ? escalaGram[2] : escalaGram[1] },
        motivo: disc ? 'E. coli com coloração inadequada (descoloração insuficiente).' : '',
      }], { pendente: hoje0 });
    }
    // Ágar MH: esterilidade e desempenho a cada preparo
    if (dPreparos.includes(d)) {
      const contaminado = d === -28;
      // Preparo de hoje: desempenho com características atípicas, aguardando a decisão (preparo em avaliação)
      prepararMH(dia, minAntesDeAgora(`${dia}T10:00`, hoje0, 10), { est: contaminado ? escalaEst[1] : escalaEst[0], des: hoje0 ? escalaDes[1] : escalaDes[0] }, {
        pendente: hoje0, motivo: contaminado ? 'Crescimento na placa não inoculada após 48 h: preparo contaminado, descartado e refeito.' : '' });
    }
  }

  // ── Não conformidades ──
  const textosNC = {
    'ex-te-glic': { causa: 'Erro aleatório (sem causa identificada)', acao: 'Repetição do controle (mesmo frasco)', fatores: { procedimento: true },
      inv: 'Bolha observada na cubeta do nível 1. Demais níveis e corridas anteriores sem tendência. Repetição aceita.' },
    'ex-te-col': { causa: 'Calibração inadequada ou vencida', acao: 'Recalibração', fatores: { equipamento: true, materiais: true },
      inv: 'Desvio positivo nos dois níveis em corridas consecutivas (erro sistemático). Calibração com 35 dias; recalibrado e controle repetido.' },
    'ex-te-gram': { causa: 'Reagente deteriorado ou troca de lote', acao: 'Troca de lote ou frasco de reagente', fatores: { materiais: true },
      inv: 'Álcool-acetona com frasco aberto há 4 meses; descoloração insuficiente. Frasco substituído e coloração repetida com resultado esperado.' },
    'ex-te-est': { causa: 'Erro do operador', acao: 'Outra', desc: 'Preparo descartado e refeito; limpeza do fluxo laminar antes do novo preparo', fatores: { procedimento: true, ambiente: true },
      inv: 'Placa não inoculada com crescimento após 48 h. Fluxo laminar sem limpeza registrada no dia. Preparo descartado; novo preparo no dia seguinte aprovado na esterilidade e no desempenho.' },
    'ex-te-prot': { causa: 'Reagente deteriorado ou troca de lote', acao: 'Troca de lote ou frasco de reagente', fatores: { materiais: true },
      inv: 'Frasco de tiras aberto sem dessecante. Tiras do frasco descartadas; controles repetidos com novo frasco, concordantes.' },
  };
  const ultimaNC = ncs.length ? ncs[ncs.length - 1] : null;
  ncs.forEach(x => {
    const ano = x.dh.slice(0, 4);
    const id = `ex-nc-${x.ck}-${x.t.id.slice(6)}`;
    const tx = textosNC[x.t.id] || { causa: 'Erro aleatório (sem causa identificada)', acao: 'Repetição do controle (mesmo frasco)', fatores: { procedimento: true }, inv: 'Violação isolada; repetição aceita.' };
    const anteriores = (hist[x.t.id] || []).filter(r => r.corridaKey < x.ck && ['L', 'O'].includes(r.decisao)).sort((a, b) => b.corridaKey.localeCompare(a.corridaKey));
    const ultAceita = anteriores[0] ? { key: anteriores[0].corridaKey, mes: CQEngine.mesDe(anteriores[0].corridaKey), dataHora: CQEngine.dataDeChave(anteriores[0].corridaKey) } : null;
    const aberta = x === ultimaNC;   // a mais recente fica em tratamento
    const nc = {
      id, numero: proxNumero('nc', ano), ano, unidadeId: U, tipo: 'rejeicao', corridaKey: x.ck, mes: x.mes, corridaNumero: x.numero, dataHoraCorrida: x.dh,
      testeId: x.t.id, testeNome: nomeT(x.t), equipNome: x.hdr.sistemaAnalitico, ativoId: null,
      violacoes: _cqArr(x.r.violacoes).map(v => v.texto), decisaoComentario: x.decisao.comentario,
      impacto: { ultimaCorridaAceita: ultAceita, intervaloDe: ultAceita?.dataHora || '', intervaloAte: x.dh },
      status: 'aberta', criadoEm: _cqExIso(x.dh, 15), criadoPor: ass(x.dh, 15), exemplo: true, trilha: {},
      investigacao: { fatores: tx.fatores, texto: tx.inv }, causa: tx.causa,
      acoes: { [trK(x.dh, 40)]: { tipo: tx.acao, descricao: tx.desc || '', ...ass(x.dh, 40) } },
    };
    addTr(nc, x.dh, 15, 'criacao', `Não conformidade aberta: ${CQ_NC_TIPO.rejeicao} — ${nc.testeNome}, corrida ${x.numero} — ${x.decisao.comentario}`);
    addTr(nc, x.dh, 35, 'edicao', 'Investigação / impacto atualizados');
    addTr(nc, x.dh, 40, 'acao', `Ação registrada: ${tx.acao}`);
    if (x.repeticao) nc.repeticoes = { [x.repeticao.ck]: { numero: x.repeticao.numero, mes: x.repeticao.mes, dataHora: x.repeticao.dh, status: x.repeticao.status || null, porNome: me.nome } };
    if (aberta) {
      // NC em tratamento: falta avaliar o impacto em pacientes e concluir
      ncAbertas[id] = { numero: nc.numero, testeId: x.t.id, ano, abertaEm: nc.criadoEm };
    } else {
      Object.assign(nc.impacto, { reprocessadas: 'sim', qtd: 12, diferencaSignificativa: 'nao', laudosAfetados: 'nao', laudosRetificados: '',
        justificativa: 'Amostras do intervalo reprocessadas após a ação corretiva, sem diferença clinicamente significativa (exemplo).' });
      nc.status = 'concluida';
      nc.conclusao = { texto: 'Causa tratada; repetição aceita e sem impacto em laudos (exemplo).', ...ass(x.dh, 24 * 60), reautenticado: true };
      nc.eficacia = { eficaz: true, texto: 'Corridas seguintes aceitas, sem recorrência (exemplo).', ...ass(x.dh, 7 * 24 * 60) };
      addTr(nc, x.dh, 24 * 60, 'conclusao', `Não conformidade concluída: ${nc.conclusao.texto}`);
      addTr(nc, x.dh, 7 * 24 * 60, 'eficacia', `Eficácia: eficaz — ${nc.eficacia.texto}`);
    }
    updates[`${CQ_KEYS.acoes}/${U}/${ano}/${id}`] = nc;
    // hdr já está em updates (mesma referência): vincula a NC ao teste da corrida
    x.hdr.testes[x.t.id].ncId = id;
    x.hdr.testes[x.t.id].ncAno = ano;
  });

  // ── Índices e numeração ──
  updates[`${CQ_KEYS.indices}/${U}`] = { ultimo, pendentes, ncAbertas };
  Object.entries(seq).forEach(([k, n]) => { updates[`${CQ_KEYS.seq}/${U}/${k}`] = n; });
  return updates;
}

// ── REMOÇÃO ──────────────────────────────────────────────────
function cqExemploRemover() {
  if (!_cqIsAdmin()) { showToast('Somente administradores podem remover os dados de exemplo.', 'error'); return; }
  const exId = id => String(id || '').startsWith('ex-');
  // Cadastros reais que apontam para cadastros de exemplo impedem a remoção
  const reais = Object.values(cqState.config.testes).filter(t => !exId(t.id) && (exId(t.analitoId) || exId(t.materialId) ||
    Object.values(t.lotesAtivos || {}).some(exId) || Object.values(t.controlesQual || {}).some(c => exId(c?.materialId))));
  const lotesReais = [...Object.values(cqState.config.lotesControle).filter(l => !exId(l.id) && exId(l.materialId)),
    ...Object.values(cqState.config.insumos).filter(l => !exId(l.id) && exId(_cqLoteCru(l).produtoId))];
  if (reais.length || lotesReais.length) {
    showToast(`Há cadastros reais usando cadastros de exemplo (${[...reais.map(t => _cqNomeTeste(t)), ...lotesReais.map(l => 'lote ' + l.lote)].join(', ')}). Ajuste-os antes de remover.`, 'error');
    return;
  }
  _cqPrompt({
    titulo: 'Remover dados de exemplo', subtitulo: 'Área EXEMP e cadastros “(exemplo)”', perigo: true, confirmar: 'Remover',
    corpo: `<div class="cq-nota">Remove a área de exemplo com todas as suas corridas, resultados, alvos, não conformidades e índices, e os cadastros de exemplo (ids iniciados por “ex-”). Dados de outras áreas não são alterados.</div>`,
    onConfirm: async () => {
      if (!_cqPodeGravar()) return false;
      const updates = {};
      ['alvos', 'corridas', 'resultados', 'acoes', 'indices', 'seq'].forEach(k => { updates[`${CQ_KEYS[k]}/${CQ_EX_U}`] = null; });
      CQ_COLECOES.forEach(c => Object.keys(cqState.config[c] || {}).filter(exId).forEach(id => { updates[`${CQ_KEYS.config}/${c}/${id}`] = null; }));
      let uso = null;
      try { uso = await window.dbGet(CQ_KEYS.uso); }
      catch (err) { console.error('[cq-exemplo.js] Falha ao ler marcadores de uso:', err); showToast('Falha ao ler o banco. Nada foi removido.', 'error'); return false; }
      Object.entries(uso || {}).forEach(([col, ids]) => {
        if (ids && typeof ids === 'object') Object.keys(ids).filter(exId).forEach(id => { updates[`${CQ_KEYS.uso}/${col}/${id}`] = null; });
      });
      if (!(await window.dbUpdate(updates))) { showToast('Falha ao remover os dados de exemplo.', 'error'); return false; }
      _cqInvalidarCaches();
      try { if (localStorage.getItem('cq-unidade-ativa') === CQ_EX_U) localStorage.removeItem('cq-unidade-ativa'); } catch (e) { /* sem storage */ }
      _cqOuvirAlvos();
      cqRender();
      cqRenderConfig();
      showToast('Dados de exemplo removidos.', 'success');
      return true;
    },
  });
}
