// Remoção única do ativo obsoleto "Fixadores Citológicos" (CITO) e de tudo o que é dele no cadastro de ativos:
// rotina "Troca de Fixadores", as 2 tarefas de troca e as publicações (atividades) delas.
// O histórico já foi migrado para CQ › Preparos (área CITO) por migrar-fixadores-cito.js.
//
// RDC 978/2025, art. 115: registros são guardados por 5 anos. Antes de apagar, o script baixa um
// backup .json com o ativo, a rotina, as tarefas e as publicações originais — GUARDE ESSE ARQUIVO.
//
// Uso: colar no console (F12) do app aberto e logado como administrador (ou com permissão de excluir ativos).
// 1º: roda em prévia (nada é apagado). 2º: cqApagarFixadoresCITO({ apagar: 'APAGAR' })
async function cqApagarFixadoresCITO({ apagar = '' } = {}) {
  const ATIVO = 'atv_m23', ROTINA = 'mqav8ft8uasa8', TAREFAS = ['mqaverehvsuyo', 'mqavnnywlzmyi'];
  const FLAG_MIG = 'gestao-cq-config-v1/migracoes/fixadoresCITO';
  const pare = msg => { console.error('[remoção] ' + msg); return null; };

  if (typeof state === 'undefined' || typeof _stateFirebaseReady === 'undefined' || !_stateFirebaseReady) return pare('Cadastro de ativos ainda não carregado. Aguarde a tela inicial e tente de novo.');
  if (typeof currentSession === 'undefined' || !currentSession) return pare('Faça login antes.');
  if (!currentSession.isAdmin && !(typeof _can === 'function' && _can('ativos.excluir'))) return pare('Sem permissão para excluir ativos.');
  if (window._dbConnected === false) return pare('Sem conexão com o banco.');
  const mig = await window.dbGet(FLAG_MIG);
  if (!mig) return pare('O histórico ainda não foi migrado para o CQ (rode antes migrar-fixadores-cito.js). Nada foi apagado.');
  if (mig.ativoRemovido) return pare(`Ativo já removido em ${mig.ativoRemovido.em} por ${mig.ativoRemovido.porNome}. Nada a fazer.`);

  const idx = state.ativos.findIndex(a => a && a.id === ATIVO);
  if (idx < 0) return pare('Ativo atv_m23 não encontrado (já removido?).');
  const ativo = state.ativos[idx];
  if (!/fixador/i.test(ativo.nome || '')) return pare(`O ativo atv_m23 é "${ativo.nome}", não Fixadores Citológicos. Nada foi apagado.`);

  const rotinas = state.rotinas.filter(r => r && (r.equipamentoId === ATIVO || r.id === ROTINA));
  const tarefas = state.tarefas.filter(t => t && (t.equipamentoId === ATIVO || TAREFAS.includes(t.id)));
  const tids = new Set(tarefas.map(t => t.id));
  const pubs = (state.publicacoes || []).filter(p => p && tids.has(p.tarefaId));

  // Fora do escopo deste script: publicações arquivadas, OTs e ocorrências do ativo
  const arq = await window.dbGet('gestao-pubs-arquivo-v1/grupos');
  let nArq = 0;
  const varrer = o => { if (!o || typeof o !== 'object') return; if (o.tarefaId && o.dataRealizada) { if (tids.has(o.tarefaId)) nArq++; return; } Object.values(o).forEach(varrer); };
  varrer(arq);
  if (nArq) return pare(`${nArq} publicação(ões) destas tarefas estão no arquivo de publicações. Este script não as trata. Nada foi apagado.`);
  const ots = (typeof otState !== 'undefined' ? otState.ordens : []).filter(o => (typeof otAtivoIds === 'function' ? otAtivoIds(o) : [o.ativoId]).includes(ATIVO));
  if (ots.length) return pare(`O ativo tem ${ots.length} OT(s): ${ots.map(o => o.numero).join(', ')}. Nada foi apagado.`);
  const ocs = typeof ocListarPorAtivo === 'function' ? ocListarPorAtivo(ATIVO, { incluirCanceladas: true }) : [];
  if (ocs.length) return pare(`O ativo tem ${ocs.length} ocorrência(s). Nada foi apagado.`);
  const anexos = pubs.reduce((n, p) => n + (p.anexos || []).length, 0);

  console.table([
    { item: 'Ativo', qtd: 1, detalhe: `${ativo.codigo} — ${ativo.nome} (posição ${idx})` },
    { item: 'Rotinas', qtd: rotinas.length, detalhe: rotinas.map(r => r.nome).join(', ') },
    { item: 'Tarefas', qtd: tarefas.length, detalhe: tarefas.map(t => t.titulo).join(', ') },
    { item: 'Publicações (atividades)', qtd: pubs.length, detalhe: pubs.length ? `${pubs[0].dataRealizada} a ${pubs[pubs.length - 1].dataRealizada}` : '' },
    { item: 'Anexos', qtd: anexos, detalhe: anexos ? 'os arquivos no armazenamento NÃO são apagados' : '' },
  ]);
  if (apagar !== 'APAGAR') {
    console.log("[remoção] PRÉVIA — nada foi apagado. Para apagar (baixa o backup antes): cqApagarFixadoresCITO({ apagar: 'APAGAR' })");
    return { ativo, rotinas, tarefas, publicacoes: pubs };
  }

  // 1. Backup obrigatório (art. 115): sem o download, nada é apagado
  const agora = new Date().toISOString();
  const nomeArq = `backup-fixadores-citologicos-${agora.slice(0, 10)}.json`;
  const backup = { geradoEm: agora, geradoPor: currentSession.nomeCompleto || currentSession.username || '', motivo: 'Ativo obsoleto: histórico migrado para CQ › Preparos (área CITO)',
    migracaoCQ: mig, ativo, posicaoAtivo: idx, rotinas, tarefas, publicacoes: pubs };
  try {
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: nomeArq });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) { return pare('Falha ao gerar o backup: ' + err.message + '. Nada foi apagado.'); }
  console.log(`[remoção] Backup baixado: ${nomeArq}. Guarde-o por 5 anos (RDC 978, art. 115).`);

  // 2. Remoção, igual à exclusão de ativo do app: índices posteriores recuam uma posição
  state.rotinas = state.rotinas.filter(r => !rotinas.includes(r));
  state.tarefas = state.tarefas.filter(t => !tarefas.includes(t));
  state.publicacoes = (state.publicacoes || []).filter(p => !pubs.includes(p));
  state.rotinas.forEach(r => { if (r.equipamentoIdx > idx) r.equipamentoIdx--; });
  state.tarefas.forEach(t => { if (t.equipamentoIdx > idx) t.equipamentoIdx--; });
  let otsAjustadas = false;
  (typeof otState !== 'undefined' ? otState.ordens : []).forEach(o => {
    if (o.ativoIdx !== null && o.ativoIdx !== undefined && o.ativoIdx !== '' && Number(o.ativoIdx) > idx) { o.ativoIdx = Number(o.ativoIdx) - 1; otsAjustadas = true; }
  });
  state.ativos.splice(idx, 1);
  await window.dbSave('gestao-ativos-v2', state);
  if (otsAjustadas && typeof otSave === 'function') otSave();

  // 3. Confere no banco e registra a remoção junto da migração
  const confere = await window.dbGet('gestao-ativos-v2');
  if ((confere?.ativos || []).some(a => a && a.id === ATIVO)) return pare('O banco ainda tem o ativo: a gravação falhou. Recarregue a página e confira antes de tentar de novo.');
  await window.dbUpdate({ [`${FLAG_MIG}/ativoRemovido`]: { em: agora, porId: currentSession.userId || null, porNome: currentSession.nomeCompleto || currentSession.username || '',
    backup: nomeArq, ativo: `${ativo.codigo} — ${ativo.nome}`, rotinas: rotinas.length, tarefas: tarefas.length, publicacoes: pubs.length } });
  if (typeof refreshTaskFlagsUI === 'function') refreshTaskFlagsUI();
  console.log(`[remoção] Concluída: ativo, ${rotinas.length} rotina(s), ${tarefas.length} tarefa(s) e ${pubs.length} publicação(ões) removidos. Recarregue a página.`);
  return true;
}
cqApagarFixadoresCITO();
