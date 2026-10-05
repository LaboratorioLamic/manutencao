// ═══════════════════════════════════════════════════════════════
// Cadastro inicial do monitoramento da esterilização (autoclave) — LAMIC
// Cria, na unidade ativa do CQ: analitos (integrador químico tipo 5 e indicador
// biológico), materiais de controle (Integron e Bio-Indicador 24 h Maquira),
// lotes (se informados), testes da autoclave e a ficha do ciclo com programas.
//
// Como usar: abra o sistema, entre na aba Controle de Qualidade com a unidade
// certa selecionada, aperte F12 › Console, cole este arquivo inteiro e Enter.
// O script mostra o resumo e pede confirmação antes de gravar. Pode rodar de
// novo depois de preencher os lotes: o que já existe é reaproveitado.
// ═══════════════════════════════════════════════════════════════
(async () => {
  // ── PREENCHA (vazio = deixa para depois) ─────────────────────
  const AUTOCLAVE_ID = '';           // id de um ativo já cadastrado; vazio: usa a autoclave EXEMPLO abaixo
  // Autoclave EXEMPLO: criada em Ativos se ainda não existir um ativo com este código. Edite depois na tela de Ativos.
  const AUTOCLAVE_EXEMPLO = { nome: 'Autoclave — EXEMPLO (alterar)', codigo: 'AUT-EX', marca: 'PREENCHER', modelo: 'PREENCHER', serie: 'PREENCHER' };
  const CICLOS_POR_DIA = 3;          // ciclos (corridas do integrador) esperados por dia
  const PREFIXO_LOTE_CARGA = 'AC1';  // EXEMPLO — lote da carga sai como AC1-AAAAMMDD-NN
  const INTEGRON = { fabricante: '', regAnvisa: '', lote: '', validade: '' };   // ex.: lote '24091A', validade '2027-03-31'
  const BIOINDICADOR = { lote: '', validade: '' };                              // ex.: lote '0225B', validade '2026-12-31'
  const INCLUIR_BOWIE_DICK = false;  // true só se a autoclave tiver bomba de vácuo (RDC 1002, art. 88)

  // Programas da autoclave: EXEMPLO. Troque pelos valores do manual (fase de esterilização,
  // pressão manométrica) antes de usar em rotina — Configurações › Unidade › Ciclos de esterilização.
  const UN_PRESSAO = 'kgf/cm²';
  const PROGRAMAS = [
    { nome: '134 °C — EXEMPLO, conferir manual', tempMin: 134, tempMax: 137, tempoMin: 4, pressaoMin: 2.0, pressaoMax: 2.3 },
    { nome: '121 °C — EXEMPLO, conferir manual', tempMin: 121, tempMax: 124, tempoMin: 15, pressaoMin: 1.0, pressaoMax: 1.3 },
  ];
  // ─────────────────────────────────────────────────────────────

  const falha = m => { console.error('[cadastro esterilização] ' + m); alert(m); };
  if (typeof cqState === 'undefined' || !cqState.config?.unidades || typeof CQ_MODELOS_ESTER === 'undefined') return falha('Abra o sistema atualizado e a aba Controle de Qualidade antes de rodar.');
  if (!_cqCan('configurar')) return falha('Seu usuário não tem a permissão "configurar" do CQ.');
  const u = _cqUnidadeAtivaId();
  const un = cqState.config.unidades[u];
  if (!un) return falha('Nenhuma unidade ativa no CQ.');

  // Autoclave: AUTOCLAVE_ID informado ou a EXEMPLO (reaproveitada pelo código; criada se não existir)
  const ativos = (state.ativos || []).filter(a => a && a.id && a.statusUso !== 'em_desuso');
  let auto = null, autoNovo = null;
  if (AUTOCLAVE_ID) {
    auto = ativos.find(a => a.id === AUTOCLAVE_ID);
    if (!auto) {
      console.table(ativos.map(a => ({ id: a.id, nome: a.nome, codigo: a.codigo, setor: a.setor })));
      return falha('AUTOCLAVE_ID não encontrado entre os ativos em uso (lista no console).');
    }
  } else {
    auto = ativos.find(a => (a.codigo || '').toLowerCase() === AUTOCLAVE_EXEMPLO.codigo.toLowerCase()) || null;
    if (!auto) {
      if (!_stateFirebaseReady) return falha('Os ativos ainda não carregaram do banco. Aguarde alguns segundos e rode de novo.');
      if (typeof _can === 'function' && !_can('ativos.criar')) return falha('Seu usuário não tem permissão para criar ativos. Informe AUTOCLAVE_ID de um ativo existente.');
      const setor = _cqArr(un.setores)[0] || (state.setores || [])[0] || 'Laboratório Central';
      const categoria = (state.categorias || []).find(c => /equipamento/i.test(c)) || (state.categorias || [])[0] || 'Equipamentos Médicos';
      autoNovo = { id: uid(), nome: AUTOCLAVE_EXEMPLO.nome, codigo: AUTOCLAVE_EXEMPLO.codigo, setor, categoria, tipo: 'Equipamento',
        marca: AUTOCLAVE_EXEMPLO.marca || '-', modelo: AUTOCLAVE_EXEMPLO.modelo || '-', serie: AUTOCLAVE_EXEMPLO.serie || '-',
        nota: 'Cadastro EXEMPLO criado pelo script de implantação do monitoramento da esterilização — alterar com os dados reais.',
        statusUso: 'em_uso', pausaOTs: [], pausaOcorrencias: [], _historico: [] };
      _registrarEdicao(autoNovo, null);
      auto = autoNovo;
    }
  }

  const hoje = _cqHoje(un.fuso);
  const dataOk = v => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= hoje);
  if (!dataOk(INTEGRON.validade) || !dataOk(BIOINDICADOR.validade)) return falha('Validade no formato AAAA-MM-DD e não vencida.');
  if (!!INTEGRON.lote !== !!INTEGRON.validade || !!BIOINDICADOR.lote !== !!BIOINDICADOR.validade) return falha('Informe lote e validade juntos (ou deixe os dois vazios).');
  const prefixo = (PREFIXO_LOTE_CARGA || String(auto.codigo || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12) || 'AC').toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{0,11}$/.test(prefixo)) return falha('PREFIXO_LOTE_CARGA: letras, números e hífen (até 12).');

  const C = CQ_KEYS.config, cfg = cqState.config, agora = _cqAgora(), ass = _cqAssinatura();
  const ORIGEM = 'script de implantação do monitoramento da esterilização';
  const updates = {}, resumo = [], pendencias = [];
  if (autoNovo) {
    resumo.push({ item: 'Ativo', nome: `${autoNovo.nome} · ${autoNovo.codigo} · ${autoNovo.setor}`, acao: 'criar (EXEMPLO)' });
    const reais = ativos.filter(a => /autoclav|esteriliz/i.test(`${a.nome || ''} ${a.modelo || ''}`));
    if (reais.length) pendencias.push(`Já existe(m) ativo(s) parecido(s): ${reais.map(a => `${a.nome} (id ${a.id})`).join(', ')} — se for a autoclave real, cancele e informe AUTOCLAVE_ID`);
  }
  if (/EXEMPLO|PREENCHER/i.test(`${auto.nome} ${auto.marca} ${auto.modelo} ${auto.serie}`)) pendencias.push(`Dados reais da autoclave "${auto.nome}" (Ativos › editar: nome, código, marca, modelo, série)`);
  if (PREFIXO_LOTE_CARGA === 'AC1') pendencias.push('Prefixo do lote da carga "AC1" é EXEMPLO (Configurações › Unidade › Ciclos de esterilização)');
  const novo = (rec, texto) => { rec.criadoEm = agora; rec.criadoPor = ass; rec.atualizadoEm = agora; _cqTrilhaAdd(rec, 'criacao', `${texto} (${ORIGEM})`); return rec; };
  const comItem = (arr, v) => (_cqArr(arr).includes(v) ? _cqArr(arr) : [..._cqArr(arr), v]);
  const editar = (col, rec, campos, texto) => {
    const mud = Object.entries(campos).filter(([k, v]) => JSON.stringify(rec[k] ?? null) !== JSON.stringify(v));
    if (!mud.length) return false;
    mud.forEach(([k, v]) => { updates[`${C}/${col}/${rec.id}/${k}`] = v; });
    updates[`${C}/${col}/${rec.id}/atualizadoEm`] = agora;
    updates[`${C}/${col}/${rec.id}/trilha/${_cqTk()}`] = _cqTrilhaEntry('edicao', `${texto} (${ORIGEM})`);
    return true;
  };

  // 1. Analitos qualitativos
  const modelos = CQ_MODELOS_ESTER.filter(m => m.codigo !== 'EST-BD' || INCLUIR_BOWIE_DICK);
  const an = {};
  for (const m of modelos) {
    const ex = Object.values(cfg.analitos).find(a => (a.nome || '').toLowerCase() === m.nome.toLowerCase());
    if (ex) {
      const falta = m.escala.filter(e => !_cqArr(ex.escala).includes(e));
      if (falta.length) return falha(`O analito "${ex.nome}" já existe com outros resultados possíveis (faltam: ${falta.join(', ')}). Ajuste o analito ou renomeie-o e rode de novo.`);
      const campos = { ativoIds: comItem(ex.ativoIds, auto.id) };
      if (_cqArr(ex.unidadeIds).length) campos.unidadeIds = comItem(ex.unidadeIds, u);
      const mudou = editar('analitos', ex, campos, `Vinculado à autoclave ${auto.nome} (${un.sigla})`);
      an[m.codigo] = ex;
      resumo.push({ item: 'Analito', nome: m.nome, acao: mudou ? 'existente — vinculado à autoclave' : 'existente' });
    } else {
      const rec = novo({ id: _cqUid() + m.codigo.slice(-2).toLowerCase(), codigo: m.codigo, nome: m.nome, unidadeMedida: '', decimais: 0, tipo: 'qualitativo',
        especialidade: 'Outros', limitesDecisao: [], eta: null, cvMeta: null, escala: [...m.escala], toleranciaPassos: null,
        ativoIds: [auto.id], sistemas: [], unidadeIds: [u], ativo: true }, 'Analito cadastrado');
      updates[`${C}/analitos/${rec.id}`] = rec;
      an[m.codigo] = rec;
      resumo.push({ item: 'Analito', nome: m.nome, acao: 'criar' });
    }
  }

  // 2. Materiais de controle (indicadores)
  const matDef = [
    { k: 'EST-IQ5', nome: 'Integron — integrador químico classe 5 (vapor)', fabricante: INTEGRON.fabricante || 'PREENCHER — fabricante (ver caixa)',
      regAnvisa: INTEGRON.regAnvisa, codigoReferencia: 'ISO 11140-1, classe 5 · vapor 121 a 134 °C · amarelo → preto (viragem completa)',
      armazenamento: 'Local seco, ao abrigo da luz; uso único', niveis: { 1: { nome: 'Pacote teste' } } },
    { k: 'EST-IB', nome: 'Bio-Indicador 24 h (Geobacillus stearothermophilus)', fabricante: 'Maquira Indústria de Produtos Odontológicos S.A.',
      regAnvisa: 'Isento de registro (bula 0403047 rev. 04)', codigoReferencia: 'G. stearothermophilus ATCC 7953 · 10⁵ a 10⁶ esporos · leitura em 24 h a 55–60 °C',
      armazenamento: '15 a 30 °C, UR 35 a 60 %, ao abrigo do sol; descartar após autoclavar 30 min a 121 °C', niveis: { 1: { nome: 'Ampola' } },
      bulaUrl: 'https://maquira.com.br/wp-content/uploads/2023/05/IFU-Bioindicador-24h-Rev.-04.pdf' },
    { k: 'EST-BD', nome: 'Pacote de teste Bowie & Dick — EXEMPLO', fabricante: 'PREENCHER — fabricante', regAnvisa: '',
      codigoReferencia: 'ISO 11140-4 · 1º ciclo do dia, câmara vazia', armazenamento: 'Conforme bula', niveis: { 1: { nome: 'Pacote B&D' } } },
  ].filter(d => an[d.k]);
  const mat = {};
  for (const d of matDef) {
    const a = an[d.k];
    const ex = Object.values(cfg.materiais).find(x => (x.nome || '').toLowerCase() === d.nome.toLowerCase());
    if (ex) {
      const campos = { equips: comItem(ex.equips, 'a:' + auto.id) };
      if (_cqArr(ex.analitoIds).length) campos.analitoIds = comItem(ex.analitoIds, a.id);
      if (_cqArr(ex.unidadeIds).length) campos.unidadeIds = comItem(ex.unidadeIds, u);
      const mudou = editar('materiais', ex, campos, `Vinculado à autoclave ${auto.nome} (${un.sigla})`);
      mat[d.k] = ex;
      resumo.push({ item: 'Material', nome: d.nome, acao: mudou ? 'existente — vinculado à autoclave' : 'existente' });
    } else {
      const rec = novo({ id: _cqUid(), nome: d.nome, fabricante: d.fabricante, fornecedor: '', tipo: 'comercial', regAnvisa: d.regAnvisa, matriz: '',
        codigoReferencia: d.codigoReferencia, estabilidadeAbertoDias: null, armazenamento: d.armazenamento, niveis: d.niveis,
        equips: ['a:' + auto.id], analitoIds: [a.id], unidadeIds: [u], ativo: true }, 'Material cadastrado');
      updates[`${C}/materiais/${rec.id}`] = rec;
      mat[d.k] = rec;
      resumo.push({ item: 'Material', nome: d.nome, acao: 'criar' });
    }
    if (/PREENCHER/.test(mat[d.k].fabricante || '')) pendencias.push(`Fabricante de "${d.nome}" (Controles/Materiais)`);
  }

  // 3. Lotes (só os informados)
  const lote = {};
  const loteDef = [['EST-IQ5', INTEGRON], ['EST-IB', BIOINDICADOR]].filter(([k]) => mat[k]);
  for (const [k, L] of loteDef) {
    const m = mat[k];
    if (!L.lote) { pendencias.push(`Lote e validade de "${m.nome}" (Controles/Materiais › Novo lote › Uso nos testes)`); continue; }
    const ex = Object.values(cfg.lotesControle).find(x => x.materialId === m.id && (x.lote || '').toLowerCase() === L.lote.toLowerCase());
    if (ex) { lote[k] = ex; resumo.push({ item: 'Lote', nome: `${m.nome} · ${ex.lote}`, acao: 'existente' }); continue; }
    const rec = novo({ id: _cqUid(), materialId: m.id, lote: L.lote.trim(), validade: L.validade, niveis: [1], unidadeIds: [u], status: 'em_uso',
      bulaUrl: matDef.find(d => d.k === k)?.bulaUrl || '', observacoes: '' }, 'Lote cadastrado');
    updates[`${C}/lotesControle/${rec.id}`] = rec;
    lote[k] = rec;
    resumo.push({ item: 'Lote', nome: `${m.nome} · ${rec.lote} · val. ${rec.validade}`, acao: 'criar' });
  }
  if (INCLUIR_BOWIE_DICK) pendencias.push('Lote do pacote Bowie & Dick (Controles/Materiais › Novo lote)');

  // 4. Testes da autoclave
  const ativoSnap = { nome: auto.nome || '', codigo: auto.codigo || '', serie: auto.serie || '', modelo: auto.modelo || '' };
  const testeDef = [
    { k: 'EST-IQ5', niveis: { 1: ['Pacote teste', 0] }, frequencia: { tipo: 'por_corrida', vezesDia: Math.max(1, Number(CICLOS_POR_DIA) || 1) } },
    { k: 'EST-IB', niveis: { 1: ['Ampola teste (no pacote)', 0], 2: ['Ampola controle (fora da autoclave)', 1] }, frequencia: { tipo: 'semanal', vezesDia: 1 } },
    { k: 'EST-BD', niveis: { 1: ['Pacote Bowie & Dick (1º ciclo do dia)', 0] }, frequencia: { tipo: 'diaria', vezesDia: 1 } },
  ].filter(d => an[d.k] && mat[d.k]);
  for (const d of testeDef) {
    const a = an[d.k], m = mat[d.k], modelo = CQ_MODELOS_ESTER.find(x => x.codigo === d.k);
    const niveis = Object.keys(d.niveis).map(Number);
    const lotesAtivos = {};
    if (lote[d.k]) niveis.forEach(n => { lotesAtivos[n] = lote[d.k].id; });   // mesmo lote para ampola teste e controle (bula)
    const ex = _cqTestesDaUnidade(u, { incluirInativos: true }).find(t => t.analitoId === a.id && t.ativoId === auto.id);
    if (ex) {
      const la = { ...(ex.lotesAtivos || {}) };
      niveis.forEach(n => { if (!la[n] && lotesAtivos[n] && ex.controlesQual?.[n]?.materialId === m.id) la[n] = lotesAtivos[n]; });
      const mudou = editar('testes', ex, { lotesAtivos: la }, `Lote em uso definido: ${lote[d.k]?.lote || ''}`);
      resumo.push({ item: 'Teste', nome: `${a.nome} · ${auto.nome}`, acao: mudou ? 'existente — lote em uso definido' : 'existente' });
      continue;
    }
    const controlesQual = {};
    Object.entries(d.niveis).forEach(([n, [rotulo, i]]) => { controlesQual[n] = { rotulo, materialId: m.id, esperado: modelo.escala[i] }; });
    const rec = novo({ id: _cqUid(), unidadeId: u, analitoId: a.id, ativoId: auto.id, sistemaAnalitico: '', metodo: '', niveis, materialId: '',
      lotesAtivos, frequencia: d.frequencia, regrasPreset: 'qualitativo', regras: {}, opcoesRegras: {}, controlesQual,
      insumoTipo: '', insumoProduto: '', insumoProdutoId: '', exigirInsumo: false, inicioUso: hoje, ativo: true, etaOverride: null,
      ativoSnap, versaoConfig: 1 }, 'Teste cadastrado');
    updates[`${C}/testes/${rec.id}`] = rec;
    resumo.push({ item: 'Teste', nome: `${a.nome} · ${auto.nome}`, acao: `criar (${CQ_FREQ[d.frequencia.tipo]})` });
  }

  // 5. Ficha do ciclo de esterilização da autoclave
  const kEq = _cqChaveModoEquip('a:' + auto.id);
  const cfgAntes = un.esterilizacao?.[kEq];
  if (cfgAntes) resumo.push({ item: 'Ficha do ciclo', nome: auto.nome, acao: 'existente (não alterada)' });
  else {
    const programas = {};
    PROGRAMAS.forEach((p, i) => {
      const id = _cqUid() + i;
      programas[id] = { id, nome: p.nome, ordem: i, tempMin: p.tempMin, tempMax: p.tempMax ?? null, tempoMin: p.tempoMin, pressaoMin: p.pressaoMin, pressaoMax: p.pressaoMax ?? null };
    });
    const rec = { ativo: true, prefixo, unPressao: UN_PRESSAO, programas, equipNome: auto.nome || '', atualizadoEm: agora, atualizadoPor: ass };
    updates[`${C}/unidades/${u}/esterilizacao/${kEq}`] = rec;
    updates[`${C}/unidades/${u}/atualizadoEm`] = agora;
    updates[`${C}/unidades/${u}/trilha/${_cqTk()}`] = _cqTrilhaEntry('edicao', `Ficha do ciclo de esterilização — ${auto.nome} (${ORIGEM})`,
      [{ campo: `Ficha de esterilização · ${auto.nome}`, antes: 'não configurada', depois: _cqEsterResumoCfg(rec) }]);
    resumo.push({ item: 'Ficha do ciclo', nome: auto.nome, acao: `criar · prefixo ${prefixo} · ${PROGRAMAS.length} programa(s)` });
  }
  const progs = cfgAntes ? _cqEsterProgramas(cfgAntes) : PROGRAMAS;
  if (progs.some(p => /EXEMPLO/i.test(p.nome))) pendencias.push('Programas da autoclave com valores de EXEMPLO (Configurações › Unidade › Ciclos de esterilização › Configurar)');

  // Resumo e confirmação
  console.log(`%cUnidade ${un.sigla} — ${un.nome} · Autoclave: ${auto.nome}${auto.codigo ? ' (' + auto.codigo + ')' : ''}`, 'font-weight:bold');
  console.table(resumo);
  if (pendencias.length) console.warn('Pendências depois do cadastro:\n- ' + pendencias.join('\n- '));
  const n = Object.keys(updates).length;
  if (!n) { alert('Nada a gravar: tudo já está cadastrado.'); return; }
  if (!confirm(`Gravar no banco (unidade ${un.sigla}, autoclave ${auto.nome})?\n\n${resumo.map(r => `• ${r.item}: ${r.nome} — ${r.acao}`).join('\n')}`
    + (pendencias.length ? `\n\nFicam pendentes:\n- ${pendencias.join('\n- ')}` : ''))) { console.log('Cancelado. Nada foi gravado.'); return; }
  if (!_cqPodeGravar()) return;
  if (autoNovo) {
    // Mesmo caminho da tela de Ativos: inclui no estado e grava
    state.ativos.push(autoNovo);
    saveState();
    console.log(`Ativo criado: ${autoNovo.nome} (id ${autoNovo.id})`);
  }
  const ok = await window.dbUpdate(updates);
  if (!ok) return falha('Falha ao gravar. Nada foi salvo; verifique a conexão.');
  console.log(`%cCadastro gravado (${n} caminho(s)).`, 'color:green;font-weight:bold');
  showToast('Monitoramento da esterilização cadastrado. Veja as pendências no console.', 'success');
  if (typeof cqRender === 'function') setTimeout(cqRender, 300);
})();
