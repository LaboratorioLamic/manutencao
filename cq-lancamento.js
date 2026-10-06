// ═══════════════════════════════════════════════════════════════
// cq-lancamento.js — Lançamento e liberação de corridas — LAMIC
// Registro dos resultados de controle por corrida analítica, avaliação
// pelas regras configuradas, liberação/rejeição por responsável,
// correção e invalidação preservando o dado original.
// RDC 978/2025: def. XII (corrida), arts. 102, 105-II, 116, 180 I-V, 183.
// ═══════════════════════════════════════════════════════════════

let _cqLanc = null;           // estado do lançamento em edição
let _cqCorrFiltro = { mes: null, status: 'todas', grupo: '' };
let _cqCorrCache = null;      // { u, mes, corridas }
let _cqCorrAberta = null;     // { u, mes, key }

const CQ_ESTADO_SIGLA = { aceito: 'A', alerta: 'W', rejeitado: 'R', sem_alvo: 'X' };
const CQ_SIGLA_ESTADO = { A: 'aceito', W: 'alerta', R: 'rejeitado', X: 'sem_alvo', P: 'sem_alvo' };

function _cqLancReset() { _cqLanc = null; }

function _cqLancNovo(grupo) {
  const u = _cqUnidadeAtivaId();
  return {
    u, grupo: grupo || '', dataHora: _cqNowLocal(), operadorId: _cqSess().id,
    flags: { posManutPrev: false, posManutCorr: false, reinicioEquip: false, verificacao: false, otRef: '' },
    retroJust: '', repeticaoDe: null, somenteTestes: null, linhas: {}, hist: {}, carregando: new Set(), rascunhoRestaurado: false,
    modo: grupo ? _cqModoCorrida(u, grupo) : 'lote', selecionados: [],   // corrida fracionada: testes adicionados, na ordem
  };
}

// Corrida fracionada: a grade mostra só os testes adicionados pelo operador (repetição sempre usa o teste fixo)
function _cqLancFrac() { return !!_cqLanc && _cqLanc.modo === 'fracionada' && !_cqLanc.somenteTestes; }

// Grupos (equipamentos ou sistemas manuais) com testes ativos na unidade
function _cqGruposLanc(u) {
  const g = {};
  _cqTestesDaUnidade(u).forEach(t => {
    const ativo = t.ativoId && typeof _ativoById === 'function' ? _ativoById(t.ativoId) : null;
    if (ativo?.statusUso === 'em_desuso') return;
    const k = _cqGrupoEquip(t);
    (g[k] = g[k] || { key: k, nome: _cqEquipTeste(t), ativoId: t.ativoId || null, ativo, testes: [] }).testes.push(t);
  });
  Object.values(g).forEach(x => x.testes.sort((a, b) => _cqNomeTeste(a).localeCompare(_cqNomeTeste(b))));
  return Object.values(g).sort((a, b) => a.nome.localeCompare(b.nome));
}

function cqLancarPara(grupoKey) {
  _cqLanc = _cqLancNovo(grupoKey);
  cqNav('lancar');
}

// Abre o lançamento para repetir o controle de um teste rejeitado
async function cqRepetirControle(mes, ck, testeId) {
  const t = cqState.config.testes[testeId];
  if (!t) return;
  const c = await cqCarregarCorrida(_cqUnidadeAtivaId(), mes, ck);
  const ct = c?.testes?.[testeId] || {};
  cqModalClose();
  _cqLanc = _cqLancNovo(_cqGrupoEquip(t));
  _cqLanc.repeticaoDe = { mes, key: ck, numero: c?.numero || ck, testeId, ncId: ct.ncId || null, ncAno: ct.ncAno || null };
  _cqLanc.somenteTestes = [testeId];
  cqNav('lancar');
}

// ── TELA DE LANÇAMENTO ───────────────────────────────────────
function cqRenderLancar(body) {
  const u = _cqUnidadeAtivaId();
  if (!_cqCan('lancar')) { body.innerHTML = '<div class="cq-vazio">Sem permissão para lançar corridas.</div>'; return; }
  if (!_cqLanc || _cqLanc.u !== u) _cqLanc = _cqLancNovo('');
  const grupos = _cqGruposLanc(u);
  const g = grupos.find(x => x.key === _cqLanc.grupo);
  if (g && !_cqLanc.carregado) { _cqLancCarregarGrupo(); return; }
  // Atualização remota durante a digitação: só recalcula as linhas, sem perder o foco
  if (g && body.dataset.lancGrupo === _cqLanc.grupo && document.activeElement?.closest?.('#cq-grade, #cq-l-ester')) {
    _cqGradeAtualizarTudo();
    return;
  }
  body.dataset.lancGrupo = g ? _cqLanc.grupo : '';
  const users = _cqUsuarios().filter(x => _cqPapel(u, x.id) || x.id === _cqSess().id);
  const agora = _cqNowLocal();
  const ester = g && typeof _cqEsterLancCfg === 'function' ? _cqEsterLancCfg() : null;
  body.innerHTML = `
  <div class="cq-lanc">
    ${_cqLanc.repeticaoDe ? `<div class="cq-alerta-box cq-info-box">${CQ_ICO.repeat} Repetição do controle da corrida ${_cqEsc(_cqLanc.repeticaoDe.numero)}. A repetição isolada não é ação corretiva: registre causa e ação na não conformidade.</div>` : ''}
    <div class="cq-lanc-head">
      <div class="form-field cq-lanc-equip"><label class="field-label">Equipamento / sistema <span class="required">*</span></label>
        <select class="field-select" id="cq-l-grupo" onchange="cqLancGrupo(this.value)">
          <option value="">— Selecione —</option>
          ${grupos.map(x => `<option value="${_cqEsc(x.key)}" ${x.key === _cqLanc.grupo ? 'selected' : ''}>${_cqEsc(x.nome)} (${x.testes.length})${x.ativo?.statusUso === 'em_pausa' ? ' — em pausa' : ''}</option>`).join('')}
        </select></div>
      <div class="form-field" style="max-width:200px;"><label class="field-label">Data/hora da corrida <span class="required">*</span></label>
        <input type="datetime-local" class="field-input" id="cq-l-dh" max="${agora}" value="${_cqEsc(_cqLanc.dataHora)}" onchange="cqLancDataHora(this.value)"></div>
      <div class="form-field" style="max-width:240px;"><label class="field-label">${ester ? 'Operador do equipamento' : 'Executado por'} <span class="required">*</span></label>
        <select class="field-select" id="cq-l-oper" onchange="_cqLanc.operadorId=this.value">${users.map(x => `<option value="${x.id}" ${x.id === _cqLanc.operadorId ? 'selected' : ''}>${_cqEsc(x.nomeCompleto || x.username)}</option>`).join('')}</select></div>
      ${g ? _cqLancModoHTML() : ''}
    </div>
    ${g ? `
    ${g.ativo?.statusUso === 'em_pausa' ? `<div class="cq-alerta-box">${CQ_ICO.alerta} Equipamento em pausa: esta corrida será registrada como <b>verificação</b> (pós-manutenção / liberação), sem liberar resultados de pacientes.</div>` : ''}
    <div id="cq-l-retro"></div>
    <div class="cq-lanc-flags">
      <span class="cq-lanc-flags-lbl">Condições da corrida:</span>
      <label class="oc-check"><input type="checkbox" ${_cqLanc.flags.posManutPrev ? 'checked' : ''} onchange="_cqLanc.flags.posManutPrev=this.checked"> Após manutenção preventiva</label>
      <label class="oc-check"><input type="checkbox" ${_cqLanc.flags.posManutCorr ? 'checked' : ''} onchange="_cqLanc.flags.posManutCorr=this.checked"> Após manutenção corretiva</label>
      <label class="oc-check"><input type="checkbox" ${_cqLanc.flags.reinicioEquip ? 'checked' : ''} onchange="_cqLanc.flags.reinicioEquip=this.checked"> Após reinício do equipamento</label>
      <input type="text" class="field-input cq-lanc-otref" placeholder="Nº OT / ocorrência (opcional)" value="${_cqEsc(_cqLanc.flags.otRef)}" oninput="_cqLanc.flags.otRef=this.value">
    </div>
    ${typeof _cqEsterLancHTML === 'function' ? _cqEsterLancHTML() : ''}
    ${_cqLanc.rascunhoRestaurado ? `<div class="cq-alerta-box cq-info-box">${CQ_ICO.undo} Rascunho não salvo restaurado deste computador. <a href="#" onclick="cqLancDescartarRascunho();return false;">Descartar rascunho</a></div>` : ''}
    ${_cqLancAddHTML()}
    <div class="cq-grade-wrap"><table class="cq-grade" id="cq-grade">${_cqGradeHTML(g)}</table></div>
    <div class="cq-lanc-rodape">
      <div class="cq-nota" id="cq-l-nota">${_cqLancNotaTxt()}</div>
      <div class="cq-spacer"></div>
      <button class="btn btn-outline" onclick="cqLancLimpar()">Limpar</button>
      <button class="btn btn-primary" id="cq-l-salvar" onclick="cqLancSalvar()">${CQ_ICO.check} Salvar corrida</button>
    </div>` : `<div class="cq-vazio">${grupos.length ? 'Selecione o equipamento para lançar os controles.' : 'Nenhum teste ativo nesta unidade. Cadastre testes em Cadastros.'}</div>`}
  </div>`;
  if (g) { _cqLancAtualizarRetro(); _cqGradeAtualizarTudo(); if (ester) _cqEsterAtualizar(); }
}

function cqLancGrupo(k) {
  const anterior = _cqLanc;
  _cqLanc = _cqLancNovo(k);
  _cqLanc.dataHora = anterior?.dataHora || _cqNowLocal();
  _cqLanc.operadorId = anterior?.operadorId || _cqSess().id;
  _cqLancCarregarGrupo();
}

function cqLancDataHora(v) {
  const diaAntes = (_cqLanc.dataHora || '').slice(0, 10);
  _cqLanc.dataHora = v;
  _cqLancAtualizarRetro();
  // Histórico e alvos dependem da data/hora da corrida
  Object.keys(_cqLanc.linhas).forEach(t => { delete _cqLanc.hist[t]; });
  // Lotes de insumo oferecidos dependem do dia (encerrados por vencimento valem até a validade)
  const grade = document.getElementById('cq-grade');
  if (grade && diaAntes !== (v || '').slice(0, 10)) grade.innerHTML = _cqGradeHTML();
  _cqGradeAtualizarTudo();
  _cqLancCarregarHistoricos();
  // Leitura de ciclo já registrado: os ciclos oferecidos dependem da data/hora da corrida
  if (_cqLanc.ciclo?.modo === 'vinculado' && typeof _cqEsterRedesenhar === 'function') _cqEsterRedesenhar();
}

function _cqLancAtualizarRetro() {
  const el = document.getElementById('cq-l-retro');
  if (!el || !_cqLanc) return;
  const horas = _cqHorasAtras(_cqLanc.dataHora);
  const lim = Number(_cqPolitica().retroativoHoras) || 0;
  if (horas !== null && horas > lim) {
    el.innerHTML = `<div class="cq-alerta-box">${CQ_ICO.clock} Lançamento retroativo (${Math.floor(horas)} h atrás). Justifique:
      <input type="text" class="field-input" id="cq-l-retro-just" style="margin-top:6px;" value="${_cqEsc(_cqLanc.retroJust)}" oninput="_cqLanc.retroJust=this.value" placeholder="Ex.: falha do sistema no plantão; registro em papel transcrito"></div>`;
  } else el.innerHTML = '';
}

function _cqHorasAtras(dh) {
  if (!dh) return null;
  const agora = _cqNowLocal();
  const a = Date.UTC(+dh.slice(0, 4), +dh.slice(5, 7) - 1, +dh.slice(8, 10), +dh.slice(11, 13), +dh.slice(14, 16));
  const b = Date.UTC(+agora.slice(0, 4), +agora.slice(5, 7) - 1, +agora.slice(8, 10), +agora.slice(11, 13), +agora.slice(14, 16));
  return (b - a) / 3600000;
}

// Testes do equipamento disponíveis neste lançamento
function _cqLancTodosTestes() {
  const g = _cqGruposLanc(_cqLanc.u).find(x => x.key === _cqLanc.grupo);
  if (!g) return [];
  return _cqLanc.somenteTestes ? g.testes.filter(t => _cqLanc.somenteTestes.includes(t.id)) : g.testes;
}
// Testes exibidos na grade (na fracionada, só os adicionados)
function _cqLancTestes() {
  const todos = _cqLancTodosTestes();
  if (!_cqLancFrac()) return todos;
  return _cqLanc.selecionados.map(id => todos.find(t => t.id === id)).filter(Boolean);
}

function _cqLinhaVazia(tid) {
  const ult = ((cqState.indices[_cqLanc.u] || {}).ultimo || {})[tid];
  return { valores: {}, lr: ult?.lr || '', lk: ult?.lk || '', nr: false, motivoNR: '', posCalibracao: false };
}
function _cqLinhaPreenchida(l) { return !!l && (l.nr || Object.values(l.valores || {}).some(v => String(v || '').trim())); }

function _cqLancCarregarGrupo() {
  const testes = _cqLancTodosTestes();
  // Rascunho local
  let rasc = null;
  try { rasc = JSON.parse(localStorage.getItem(_cqRascunhoKey()) || 'null'); } catch (e) { rasc = null; }
  testes.forEach(t => { _cqLanc.linhas[t.id] = _cqLinhaVazia(t.id); });
  if (rasc && rasc.linhas && !_cqLanc.repeticaoDe) {
    Object.entries(rasc.linhas).forEach(([tid, l]) => { if (_cqLanc.linhas[tid]) Object.assign(_cqLanc.linhas[tid], l); });
    _cqLanc.rascunhoRestaurado = Object.values(rasc.linhas).some(l => Object.values(l.valores || {}).some(v => v));
    // Fracionada: restaura os testes adicionados e garante os que já têm valor digitado
    const sel = _cqArr(rasc.selecionados).filter(id => _cqLanc.linhas[id]);
    testes.forEach(t => { if (_cqLinhaPreenchida(_cqLanc.linhas[t.id]) && !sel.includes(t.id)) sel.push(t.id); });
    _cqLanc.selecionados = sel;
    // Ficha do ciclo de esterilização digitada
    if (rasc.ciclo && typeof rasc.ciclo === 'object') {
      _cqLanc.ciclo = { ...rasc.ciclo };
      if (rasc.ciclo.lote || rasc.ciclo.pacotes || rasc.ciclo.temp) _cqLanc.rascunhoRestaurado = true;
    }
  }
  _cqLanc.carregado = true;
  const body = document.getElementById('cq-body');
  if (body) body.dataset.lancGrupo = '';
  cqRender();
  _cqLancCarregarHistoricos();
}

async function _cqLancCarregarHistoricos() {
  const lanc = _cqLanc;
  const antesDe = (CQEngine.chaveTempo(lanc.dataHora) || '999999999999') + '_~';
  await Promise.all(_cqLancTestes().map(async t => {
    if (lanc.hist[t.id]) return;
    // Qualitativos não usam regras entre corridas: não há histórico a carregar
    if (_cqTesteQual(t)) { lanc.hist[t.id] = []; _cqGradeAtualizarLinha(t); return; }
    lanc.carregando.add(t.id);
    _cqGradeAtualizarLinha(t);
    try { lanc.hist[t.id] = await cqHistoricoTeste(lanc.u, t, antesDe); }
    catch (e) { lanc.hist[t.id] = []; console.error('[cq] histórico', e); }
    lanc.carregando.delete(t.id);
    if (_cqLanc === lanc) _cqGradeAtualizarLinha(t);
  }));
}

function _cqRascunhoKey() { return `cq-draft-${_cqLanc.u}-${_cqLanc.grupo}`; }
function _cqRascunhoSalvar() {
  if (!_cqLanc?.grupo || _cqLanc.repeticaoDe) return;
  const ciclo = typeof _cqEsterRascunho === 'function' ? _cqEsterRascunho() : null;
  try { localStorage.setItem(_cqRascunhoKey(), JSON.stringify({ em: _cqAgora(), linhas: _cqLanc.linhas, selecionados: _cqLanc.selecionados, ciclo })); } catch (e) { /* sem storage */ }
}
function _cqRascunhoLimpar() { try { localStorage.removeItem(_cqRascunhoKey()); } catch (e) { /* sem storage */ } }
function cqLancDescartarRascunho() { _cqRascunhoLimpar(); const k = _cqLanc.grupo, modo = _cqLanc.modo; _cqLanc = _cqLancNovo(k); _cqLanc.modo = modo; _cqLancCarregarGrupo(); }
function cqLancLimpar() {
  if (!_cqLanc) return;
  _cqRascunhoLimpar();
  const k = _cqLanc.grupo, rep = _cqLanc.repeticaoDe, so = _cqLanc.somenteTestes, modo = _cqLanc.modo;
  _cqLanc = _cqLancNovo(k);
  _cqLanc.repeticaoDe = rep; _cqLanc.somenteTestes = so; _cqLanc.modo = modo;
  _cqLancCarregarGrupo();
}

// ── CORRIDA FRACIONADA ───────────────────────────────────────
function cqLancModo(modo) {
  if (!_cqLanc || !CQ_MODOS_CORRIDA[modo] || _cqLanc.modo === modo) return;
  // Ao passar para fracionada, mantém na grade os testes que já têm algo digitado
  if (modo === 'fracionada') _cqLanc.selecionados = _cqLancTodosTestes().filter(t => _cqLinhaPreenchida(_cqLanc.linhas[t.id])).map(t => t.id);
  _cqLanc.modo = modo;
  _cqRascunhoSalvar();
  _cqLancRedesenharGrade();
  _cqLancCarregarHistoricos();
}

function cqLancAdicionar(tid) {
  if (!_cqLancFrac() || !tid || _cqLanc.selecionados.includes(tid)) return;
  if (!_cqLancTodosTestes().some(t => t.id === tid)) return;
  if (!_cqLanc.linhas[tid]) _cqLanc.linhas[tid] = _cqLinhaVazia(tid);
  _cqLanc.selecionados.push(tid);
  _cqRascunhoSalvar();
  _cqLancRedesenharGrade();
  _cqLancCarregarHistoricos();
  const inp = document.querySelector(`#cq-grade .cq-g-input:not([disabled])[data-t="${tid}"]`);
  if (inp) inp.focus();
}

function cqLancRemover(tid) {
  if (!_cqLancFrac()) return;
  _cqLanc.selecionados = _cqLanc.selecionados.filter(x => x !== tid);
  _cqLanc.linhas[tid] = _cqLinhaVazia(tid);
  _cqRascunhoSalvar();
  _cqLancRedesenharGrade();
}

function _cqLancRedesenharGrade() {
  const grade = document.getElementById('cq-grade');
  if (!grade) { cqRender(); return; }
  const add = document.getElementById('cq-l-add');
  if (add) add.outerHTML = _cqLancAddHTML();
  const seg = document.getElementById('cq-l-modo');
  if (seg) seg.outerHTML = _cqLancModoHTML();
  const nota = document.getElementById('cq-l-nota');
  if (nota) nota.innerHTML = _cqLancNotaTxt();
  grade.innerHTML = _cqGradeHTML();
  _cqGradeAtualizarTudo();
}

function _cqLancModoHTML() {
  if (_cqLanc.somenteTestes) return '<div id="cq-l-modo"></div>';
  return `<div class="form-field" id="cq-l-modo"><label class="field-label">Corrida</label>
    <div class="cq-seg">${[['lote', 'Em lote'], ['fracionada', 'Fracionada']].map(([k, l]) => `<button type="button" class="${_cqLanc.modo === k ? 'active' : ''}" title="${_cqEsc(CQ_MODOS_CORRIDA[k])}" onclick="cqLancModo('${k}')">${l}</button>`).join('')}</div></div>`;
}

// Barra "Adicionar teste" da corrida fracionada: popover com busca e navegação por teclado
let _cqPick = { busca: '', ativo: 0, vis: [] };

function _cqLancAddHTML() {
  if (!_cqLancFrac()) return '<div id="cq-l-add"></div>';
  const resto = _cqPickOpcoes();
  const n = _cqLanc.selecionados.length;
  const off = !resto.length;
  return `<div class="cq-lanc-add" id="cq-l-add">
    <div class="cq-ms cq-pick${off ? ' cq-ms-off' : ''}" id="cq-l-pick">
      <div class="cq-ms-btn" id="cq-l-pick-btn" tabindex="${off ? -1 : 0}" role="button" aria-haspopup="listbox"
        onclick="cqPickAbrir()" onkeydown="cqPickTeclaBtn(event)">
        <span class="cq-pick-ico">${CQ_ICO.plus}</span>
        <span class="cq-ms-ph">${off ? 'Todos os testes do equipamento já foram adicionados' : 'Adicionar teste realizado — clique ou comece a digitar…'}</span>
        <svg class="cq-ms-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="cq-ms-pop" id="cq-l-pick-pop" style="display:none;" onkeydown="cqPickTecla(event)">
        <div class="cq-ms-busca">${CQ_ICO.busca}<input type="text" id="cq-l-pick-busca" placeholder="Buscar por analito, meio, método…" autocomplete="off" oninput="cqPickBuscar(this.value)"></div>
        <div class="cq-ms-lista cq-pick-lista" id="cq-l-pick-lista" role="listbox"></div>
        <div class="cq-pick-rodape"><span><kbd>↑</kbd><kbd>↓</kbd> navegar</span><span><kbd>Enter</kbd> adicionar</span><span><kbd>Esc</kbd> fechar</span></div>
      </div>
    </div>
    <span class="cq-pick-cont"><b>${n}</b> de ${n + resto.length} teste(s) nesta corrida</span>
  </div>`;
}

// Testes ainda não adicionados, agrupados por analito
function _cqPickOpcoes() {
  const ultimo = (cqState.indices[_cqLanc.u] || {}).ultimo || {};
  return _cqLancTodosTestes().filter(t => !_cqLanc.selecionados.includes(t.id)).map(t => {
    const an = _cqAnalito(t.analitoId);
    const u = ultimo[t.id];
    return { id: t.id, grupo: an?.nome || _cqNomeTeste(t), label: t.metodo || an?.nome || _cqNomeTeste(t),
      sub: _cqTesteQual(t) ? (CQ_TIPOS_ANALITO[an?.tipo] || 'Qualitativo') : (an?.unidadeMedida || ''),
      ultimo: u?.dataHora || null, status: u?.status || null };
  }).sort((a, b) => a.grupo.localeCompare(b.grupo, 'pt') || a.label.localeCompare(b.label, 'pt'));
}

function _cqPickNorm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

// Destaca o trecho buscado (comparação sem acentos; índices preservados por caractere)
function _cqPickRealce(txt, q) {
  if (!q) return _cqEsc(txt);
  const i = _cqPickNorm(txt).indexOf(q);
  if (i < 0 || _cqPickNorm(txt).length !== String(txt).length) return _cqEsc(txt);
  return `${_cqEsc(txt.slice(0, i))}<mark>${_cqEsc(txt.slice(i, i + q.length))}</mark>${_cqEsc(txt.slice(i + q.length))}`;
}

function _cqPickListaHTML() {
  const q = _cqPickNorm(_cqPick.busca).trim();
  const termos = q.split(/\s+/).filter(Boolean);
  const vis = _cqPickOpcoes().filter(o => { const alvo = _cqPickNorm(`${o.grupo} ${o.label} ${o.sub}`); return termos.every(x => alvo.includes(x)); });
  _cqPick.vis = vis;
  if (_cqPick.ativo >= vis.length) _cqPick.ativo = Math.max(0, vis.length - 1);
  if (!vis.length) return `<div class="cq-ms-vazio">${q ? 'Nenhum teste encontrado.' : 'Nenhum teste disponível.'}</div>`;
  const cor = { aceito: 'cq-dot-verde', alerta: 'cq-dot-amarelo', rejeitado: 'cq-dot-vermelho' };
  let grupo = null;
  return vis.map((o, i) => {
    const cab = o.grupo !== grupo ? `<div class="cq-ms-grupo">${_cqPickRealce((grupo = o.grupo), termos[0])}</div>` : '';
    return `${cab}<div class="cq-ms-op cq-pick-op${i === _cqPick.ativo ? ' ativo' : ''}" role="option" aria-selected="${i === _cqPick.ativo}" data-i="${i}"
        onmousedown="event.preventDefault()" onclick="cqPickEscolher(${i})" onmousemove="cqPickHover(${i})">
      <span class="cq-ms-op-txt"><span>${_cqPickRealce(o.label, termos[0])}</span>${o.sub ? `<small>${_cqEsc(o.sub)}</small>` : ''}</span>
      <span class="cq-pick-ult" title="${o.status ? 'Última avaliação: ' + _cqEsc(CQ_STATUS[o.status]?.label || o.status) : ''}">
        ${o.ultimo ? `${o.status ? `<span class="cq-dot ${cor[o.status] || ''}"></span>` : ''}último ${_cqFmtDH(o.ultimo)}` : '<i>sem lançamentos</i>'}</span>
    </div>`;
  }).join('');
}

function cqPickAbrir(textoInicial) {
  const pop = document.getElementById('cq-l-pick-pop');
  if (!pop || document.getElementById('cq-l-pick')?.classList.contains('cq-ms-off')) return;
  if (pop.style.display !== 'none' && textoInicial === undefined) { cqPickFechar(); return; }
  _cqPick = { busca: textoInicial || '', ativo: 0, vis: [] };
  const inp = document.getElementById('cq-l-pick-busca');
  if (inp) inp.value = _cqPick.busca;
  document.getElementById('cq-l-pick-lista').innerHTML = _cqPickListaHTML();
  pop.style.display = '';
  document.getElementById('cq-l-pick')?.classList.add('aberto');
  setTimeout(() => { inp?.focus(); if (inp) inp.selectionStart = inp.selectionEnd = inp.value.length; }, 20);
}

function cqPickFechar(foco) {
  const pop = document.getElementById('cq-l-pick-pop');
  if (!pop || pop.style.display === 'none') return;
  pop.style.display = 'none';
  document.getElementById('cq-l-pick')?.classList.remove('aberto');
  if (foco) document.getElementById('cq-l-pick-btn')?.focus();
}

function cqPickBuscar(q) {
  _cqPick.busca = q;
  _cqPick.ativo = 0;
  const l = document.getElementById('cq-l-pick-lista');
  if (l) { l.innerHTML = _cqPickListaHTML(); l.scrollTop = 0; }
}

function cqPickHover(i) {
  if (_cqPick.ativo === i) return;
  _cqPick.ativo = i;
  document.querySelectorAll('#cq-l-pick-lista .cq-pick-op').forEach(el => el.classList.toggle('ativo', Number(el.dataset.i) === i));
}

function cqPickEscolher(i) {
  const o = _cqPick.vis[i];
  if (!o) return;
  cqPickFechar();
  cqLancAdicionar(o.id);
}

// Botão fechado: Enter/espaço/seta abrem; digitar uma letra abre já filtrando
function cqPickTeclaBtn(e) {
  if (['Enter', ' ', 'ArrowDown'].includes(e.key)) { e.preventDefault(); cqPickAbrir(); return; }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); cqPickAbrir(e.key); }
}

function cqPickTecla(e) {
  const n = _cqPick.vis.length;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cqPickFechar(true); return; }
  if (e.key === 'Enter') { e.preventDefault(); cqPickEscolher(_cqPick.ativo); return; }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' || !n) return;
  e.preventDefault();
  _cqPick.ativo = (_cqPick.ativo + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
  cqPickHover(_cqPick.ativo);
  document.querySelector(`#cq-l-pick-lista .cq-pick-op[data-i="${_cqPick.ativo}"]`)?.scrollIntoView({ block: 'nearest' });
}

document.addEventListener('mousedown', e => {
  const el = document.getElementById('cq-l-pick');
  if (el && !el.contains(e.target)) cqPickFechar();
});

function _cqLancNotaTxt() {
  return (_cqLancFrac() ? 'Corrida fracionada: adicione só os testes realizados neste horário; os demais ficam para outra corrida. ' : '')
    + 'Enter avança para a linha de baixo. Colar uma coluna do Excel preenche as linhas seguintes. Valores com vírgula ou ponto decimal.';
}

function _cqMaxNiveis(testes) { return Math.max(1, ...testes.map(t => Math.max(0, ..._cqNiveisTeste(t)))); }

function _cqGradeHTML() {
  const testes = _cqLancTestes();
  const maxN = _cqMaxNiveis(testes);
  const head = `<thead><tr><th class="cq-g-teste">Teste</th>${Array.from({ length: maxN }, (_, i) => `<th class="cq-g-nivel">Nível ${i + 1}</th>`).join('')}<th>Insumos (lote)</th><th class="cq-g-status">Avaliação</th></tr></thead>`;
  const rows = testes.map(t => {
    const l = _cqLanc.linhas[t.id] || {};
    const an = _cqAnalito(t.analitoId);
    const niveis = _cqNiveisTeste(t);
    const qual = _cqTesteQual(t);
    const escala = _cqArr(an?.escala);
    const cells = Array.from({ length: maxN }, (_, i) => {
      const n = i + 1;
      if (!niveis.includes(n)) return '<td class="cq-g-na"></td>';
      const lid = t.lotesAtivos?.[n];
      if (qual) {
        const bloq = l.nr || (!_cqNivelSemMaterial(t, n) && !lid);
        return `<td class="cq-g-cell cq-g-cell-q" id="cq-g-${t.id}-${n}">
        <select class="cq-g-input cq-g-qsel" data-t="${t.id}" data-n="${n}" ${bloq ? 'disabled' : ''} onchange="cqLancValor('${t.id}',${n},this.value)" onkeydown="cqLancTecla(event)">
          <option value="">—</option>${escala.map(e => `<option value="${_cqEsc(e)}" ${e === l.valores?.[n] ? 'selected' : ''}>${_cqEsc(e)}</option>`).join('')}</select>
        <div class="cq-g-alvo" id="cq-g-alvo-${t.id}-${n}"></div></td>`;
      }
      return `<td class="cq-g-cell" id="cq-g-${t.id}-${n}">
        <input type="text" inputmode="decimal" class="cq-g-input" data-t="${t.id}" data-n="${n}" value="${_cqEsc(l.valores?.[n] || '')}" ${l.nr || !lid ? 'disabled' : ''}
          oninput="cqLancValor('${t.id}',${n},this.value)" onkeydown="cqLancTecla(event)" onpaste="cqLancColar(event)" autocomplete="off">
        <div class="cq-g-alvo" id="cq-g-alvo-${t.id}-${n}"></div></td>`;
    }).join('');
    const diaCorrida = (_cqLanc.dataHora || _cqNowLocal()).slice(0, 10);
    const optIns = (lista, atual) => `<option value="">—</option>` + lista.map(i => `<option value="${i.id}" ${i.id === atual ? 'selected' : ''} ${i.vencido || i.bloqueado ? 'class="cq-opt-bloq"' : ''}>${_cqEsc(i.lote)}${i.vencido ? ' (vencido)' : i.bloqueado ? ' (quarentena)' : ''}</option>`).join('');
    const linhaTeste = `<td class="cq-g-teste"><div class="cq-g-nome">${_cqEsc(_cqNomeTeste(t))}</div><div class="cq-muted">${qual ? _cqEsc(CQ_TIPOS_ANALITO[an?.tipo] || '') : `${_cqEsc(an?.unidadeMedida || '')}${t.metodo ? ' · ' + _cqEsc(t.metodo) : ''}`}</div>
        ${_cqLancFrac() ? `<button type="button" class="cq-icobtn cq-g-remover" title="Remover este teste da corrida" onclick="cqLancRemover('${t.id}')">${CQ_ICO.close}</button>` : ''}
        <label class="cq-g-nrlbl"><input type="checkbox" ${l.nr ? 'checked' : ''} onchange="cqLancNR('${t.id}',this.checked)"> não realizado</label>
        ${l.nr ? `<input type="text" class="field-input cq-g-nrmot" placeholder="Motivo" value="${_cqEsc(l.motivoNR)}" oninput="_cqLanc.linhas['${t.id}'].motivoNR=this.value;_cqRascunhoSalvar()">` : ''}</td>`;
    if (qual) {
      const tipo = t.insumoTipo;
      const prodNome = _cqNomeProdutoTeste(t);
      const lista = tipo ? _cqInsumosPara(t.analitoId, tipo, t.insumoProdutoId || t.insumoProduto, _cqEquipDoTeste(t), _cqLanc.u, diaCorrida) : [];
      return `<tr class="cq-g-row${l.nr ? ' cq-g-nr' : ''}" id="cq-g-row-${t.id}">${linhaTeste}${cells}
      <td class="cq-g-ins">${tipo ? `<select class="field-select cq-g-sel" title="Lote de ${_cqEsc((CQ_TIPOS_INSUMO[tipo] || 'insumo').toLowerCase())}${prodNome ? ' — ' + _cqEsc(prodNome) : ''}" onchange="cqLancInsumo('${t.id}','lr',this.value)">${optIns(lista, l.lr)}</select>
        ${_cqLancPrepHTML(t, l)}
        <div class="cq-muted">${_cqEsc(prodNome || CQ_TIPOS_INSUMO[tipo] || '')}${t.exigirInsumo ? ' <span class="required">*</span>' : ''}</div>
        ${!lista.length ? `<div class="cq-txt-amarelo" style="font-size:11px;">${_cqEsc(_cqInsumosDiagnostico(t, tipo, _cqLanc.u))}</div>` : ''}` : '<span class="cq-muted">—</span>'}</td>
      <td class="cq-g-status" id="cq-g-st-${t.id}"></td></tr>`;
    }
    const reag = _cqInsumosPara(t.analitoId, 'reagente', '', _cqEquipDoTeste(t), _cqLanc.u, diaCorrida), cal = _cqInsumosPara(t.analitoId, 'calibrador', '', _cqEquipDoTeste(t), _cqLanc.u, diaCorrida);
    return `<tr class="cq-g-row${l.nr ? ' cq-g-nr' : ''}" id="cq-g-row-${t.id}">
      ${linhaTeste}
      ${cells}
      <td class="cq-g-ins">
        ${reag.length ? `<select class="field-select cq-g-sel" title="Lote de reagente" onchange="cqLancInsumo('${t.id}','lr',this.value)">${optIns(reag, l.lr)}</select>${_cqLancPrepHTML(t, l)}` : ''}
        ${cal.length ? `<select class="field-select cq-g-sel" title="Lote de calibrador" onchange="cqLancInsumo('${t.id}','lk',this.value)">${optIns(cal, l.lk)}</select>` : ''}
        ${!reag.length && !cal.length ? '<span class="cq-muted">—</span>' : ''}
        <label class="cq-g-nrlbl"><input type="checkbox" ${l.posCalibracao ? 'checked' : ''} onchange="_cqLanc.linhas['${t.id}'].posCalibracao=this.checked"> após calibração</label>
      </td>
      <td class="cq-g-status" id="cq-g-st-${t.id}"></td></tr>`;
  }).join('');
  if (!testes.length && _cqLancFrac()) return head + `<tbody><tr><td colspan="${maxN + 3}" class="cq-td-vazio">Nenhum teste adicionado. Use “Adicionar teste” acima para incluir os testes realizados nesta corrida.</td></tr></tbody>`;
  return head + `<tbody>${rows}</tbody>`;
}

// ── LOTE DO CONTROLE NA GRADE ─────────────────────────────────
// Cada nível mostra o lote em uso. A troca feita aqui é definitiva (lote em uso do teste, com
// justificativa e trilha), como na aba "Uso nos testes" do lote; não é uma escolha por corrida,
// porque o lote define o alvo e o histórico das regras.
function _cqPodeTrocarLoteLanc() { return _cqCan('configurar') || _cqCan('liberar'); }
function _cqLancDia() { return (_cqLanc?.dataHora || _cqNowLocal()).slice(0, 10); }
function _cqMaterialDoNivel(t, n) { return _cqTesteQual(t) ? (_cqControleQual(t, n)?.materialId || '') : (t.materialId || ''); }
// Problema do lote na data da corrida ('' = utilizável)
function _cqLoteProblema(lote, t, n, dia) {
  if (!lote) return 'sem lote';
  if (_cqValidadeLote(lote, _cqNivelNoLote(t, n), _cqLanc?.u, dia)?.vencido) return 'vencido';
  if (lote.status === 'quarentena') return 'quarentena';
  if (lote.status === 'encerrado') return 'encerrado';
  return '';
}
function _cqLancLoteChip(t, n) {
  const lote = _cqLoteDoNivel(t, n);
  const prob = _cqLoteProblema(lote, t, n, _cqLancDia());
  const txt = lote ? `${lote.lote}${prob ? ' · ' + prob : ''}` : 'sem lote';
  const tit = `Lote do controle${lote ? ` ${lote.lote} · val. ${_cqFmtData(lote.validade)}` : ''}${prob ? ` — ${prob}` : ''}`;
  if (!_cqPodeTrocarLoteLanc()) return `<span class="cq-g-lote${prob ? ' erro' : ''}" title="${_cqEsc(tit)}">${_cqEsc(txt)}</span>`;
  return `<button type="button" class="cq-g-lote${prob ? ' erro' : ''}" title="${_cqEsc(tit)}. Clique para trocar o lote em uso." onclick="cqLancTrocarLote('${t.id}',${n})">${_cqEsc(txt)}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="6 9 12 15 18 9"/></svg></button>`;
}
// Lotes que podem assumir o nível: mesmo material, nível presente no lote (quantitativo), unidade do teste,
// em uso ou em avaliação e dentro da validade na data da corrida
function _cqLotesTrocaNivel(t, n, dia) {
  const matId = _cqMaterialDoNivel(t, n);
  if (!matId) return [];
  const qual = _cqTesteQual(t);
  return Object.values(cqState.config.lotesControle)
    .filter(l => l.materialId === matId && _cqNaUnidade(l, t.unidadeId) && ['em_uso', 'em_avaliacao'].includes(l.status || 'em_uso')
      && !(l.validade && l.validade < dia) && (qual || _cqArr(l.niveis).map(Number).includes(Number(n))))
    .sort((a, b) => (b.validade || '').localeCompare(a.validade || ''));
}
function cqLancTrocarLote(tid, n) {
  const t = cqState.config.testes[tid];
  if (!t) return;
  if (!_cqPodeTrocarLoteLanc()) { showToast('Sem permissão para trocar o lote em uso do teste.', 'error'); return; }
  const dia = _cqLancDia();
  const qual = _cqTesteQual(t);
  const atual = _cqLoteDoNivel(t, n);
  const cands = _cqLotesTrocaNivel(t, n, dia).filter(l => l.id !== atual?.id);
  const mat = cqState.config.materiais[_cqMaterialDoNivel(t, n)];
  if (!cands.length) { showToast(`Nenhum outro lote de ${mat?.nome || 'controle'} em uso ou em avaliação, dentro da validade, nesta unidade. Cadastre-o em Controles/Materiais.`, 'error'); return; }
  const dec = _cqAnalito(t.analitoId)?.decimais ?? 2;
  const alvoTxt = (l, m) => { const a = _cqAlvoVigente(t.id, l.id, m, _cqLanc?.dataHora); return a ? `${_cqNum(a.media, dec)} ± ${_cqNum(a.dp, dec + 1)}` : 'sem alvo'; };
  const rot = m => qual ? _cqRotuloNivel(t, m) : `N${m}`;
  // Níveis do teste com o mesmo material: a troca costuma valer para o frasco todo
  const mesmos = _cqNiveisTeste(t).filter(m => _cqMaterialDoNivel(t, m) === _cqMaterialDoNivel(t, n));
  const marcado = m => Number(m) === Number(n) || (atual && t.lotesAtivos?.[m] === atual.id);
  _cqPrompt({
    titulo: 'Trocar lote do controle', subtitulo: `${_cqNomeTeste(t)} · ${_cqEquipTeste(t)}`,
    corpo: `<div class="cq-nota">Lote em uso hoje: <b>${_cqEsc(atual?.lote || 'nenhum')}</b>${mat ? ` (${_cqEsc(mat.nome)})` : ''}. A troca vale para as próximas corridas deste teste e fica registrada no teste e no lote.</div>
      <div class="form-field"><label class="field-label">Novo lote <span class="required">*</span></label>
        <select id="cq-lanc-troca-lote" class="field-select">${cands.map(l => `<option value="${l.id}">${_cqEsc(l.lote)} · val. ${_cqFmtData(l.validade)} · ${_cqEsc(CQ_STATUS_LOTE[l.status || 'em_uso']?.label || l.status)}${qual ? '' : ` · alvo ${rot(n)}: ${alvoTxt(l, n)}`}</option>`).join('')}</select></div>
      ${mesmos.length > 1 ? `<div class="form-field"><label class="field-label">Níveis</label><div class="cq-checks cq-checks-inline">${mesmos.map(m => `<label class="oc-check"><input type="checkbox" class="cq-lanc-troca-niv" value="${m}" ${marcado(m) ? 'checked' : ''}> ${_cqEsc(rot(m))} <span class="cq-muted">(hoje: ${_cqEsc(_cqLoteDoNivel(t, m)?.lote || 'sem lote')})</span></label>`).join('')}</div></div>` : ''}
      <div class="form-field"><label class="field-label">Justificativa <span class="required">*</span></label>
        <textarea id="cq-lanc-troca-just" class="field-textarea" style="min-height:60px;" placeholder="Ex.: frasco do lote anterior esgotado; início do lote novo."></textarea></div>
      ${qual ? '' : '<div class="cq-nota">Lote sem alvo vigente: a corrida é avaliada como “sem alvo” até o alvo ser cadastrado (aba Alvos do teste).</div>'}`,
    confirmar: 'Trocar lote',
    onConfirm: async () => {
      const lote = cqState.config.lotesControle[_cqVal('cq-lanc-troca-lote')];
      const just = _cqVal('cq-lanc-troca-just');
      const niveis = mesmos.length > 1 ? [...document.querySelectorAll('#cq-prompt-body .cq-lanc-troca-niv:checked')].map(c => Number(c.value)) : [Number(n)];
      if (!lote) { showToast('Selecione o novo lote.', 'error'); return false; }
      if (!niveis.length) { showToast('Selecione ao menos um nível.', 'error'); return false; }
      if (!qual) {
        const fora = niveis.filter(m => !_cqArr(lote.niveis).map(Number).includes(m));
        if (fora.length) { showToast(`O lote ${lote.lote} não tem o(s) nível(is) ${fora.map(rot).join(', ')}.`, 'error'); return false; }
      }
      if (!just) { showToast('Informe a justificativa.', 'error'); return false; }
      if (!_cqPodeGravar()) return false;
      const la = { ...(t.lotesAtivos || {}) };
      niveis.forEach(m => { la[m] = lote.id; });
      const fmtL = v => Object.entries(v || {}).map(([m, id]) => `${rot(m)}: ${cqState.config.lotesControle[id]?.lote || id}`).join('; ') || '—';
      const agora = _cqAgora();
      const C = CQ_KEYS.config;
      const ok = await window.dbUpdate({
        [`${C}/testes/${t.id}/lotesAtivos`]: la,
        [`${C}/testes/${t.id}/atualizadoEm`]: agora,
        [`${C}/testes/${t.id}/trilha/${_cqTk()}`]: _cqTrilhaEntry('edicao', `Troca de lote no lançamento da corrida: ${just}`, [{ campo: CQ_LBL_TESTE.lotesAtivos, antes: fmtL(t.lotesAtivos), depois: fmtL(la) }]),
        [`${C}/lotesControle/${lote.id}/atualizadoEm`]: agora,
        [`${C}/lotesControle/${lote.id}/trilha/${_cqTk()}`]: _cqTrilhaEntry('edicao', `Definido como lote em uso de ${_cqNomeTeste(t)} · ${_cqEquipTeste(t)} (${niveis.map(rot).join(', ')}) no lançamento da corrida: ${just}`),
      });
      if (!ok) { showToast('Falha ao gravar. Verifique a conexão.', 'error'); return false; }
      cqState.config.testes[t.id] = { ...t, lotesAtivos: la };
      const semAlvo = qual ? [] : niveis.filter(m => !_cqAlvoVigente(t.id, lote.id, m, _cqLanc?.dataHora));
      showToast(semAlvo.length ? `Lote ${lote.lote} em uso. Sem alvo em ${semAlvo.map(rot).join(', ')}: cadastre-o na aba Alvos do teste.` : `Lote ${lote.lote} em uso.`, semAlvo.length ? 'error' : 'success');
      if (typeof _cqLancRedesenharGrade === 'function') _cqLancRedesenharGrade();
      return true;
    },
  });
}

function cqLancValor(tid, n, v) {
  const l = _cqLanc?.linhas[tid];
  if (!l) return;
  l.valores[n] = v;
  _cqRascunhoSalvar();
  const t = cqState.config.testes[tid];
  if (t) _cqGradeAtualizarLinha(t);
}
function cqLancNR(tid, v) {
  const l = _cqLanc.linhas[tid];
  l.nr = v;
  if (v) l.valores = {};
  _cqRascunhoSalvar();
  document.getElementById('cq-grade').innerHTML = _cqGradeHTML();
  _cqGradeAtualizarTudo();
}
function cqLancInsumo(tid, campo, v) {
  const l = _cqLanc.linhas[tid];
  l[campo] = v;
  if (campo === 'lr') { delete l.prep; l.prepData = ''; l.prepResp = ''; }   // o preparo pertence ao lote escolhido
  _cqRascunhoSalvar();
  if (campo === 'lr') { _cqLancRedesenharGrade(); return; }
  _cqGradeAtualizarLinha(cqState.config.testes[tid]);
}

// Preparo do lote de insumo preparado no laboratório: escolhe um preparo existente ou registra um novo
function _cqLancPrepHTML(t, l) {
  const ins = l.lr ? cqState.config.insumos[l.lr] : null;
  if (!ins?.preparoInterno) return '';
  const dia = (_cqLanc.dataHora || _cqNowLocal()).slice(0, 10);
  // Uso único: só os preparos ainda não usados em corrida (registrados antes na aba Preparos), do mais antigo ao mais novo
  const unico = !!ins.preparoUsoUnico;
  const preps = _cqPreparosDe(ins).filter(p => (!p.finalizado && !(unico && Object.keys(p.corridas || {}).length)) || p.id === l.prep);
  if (l.prep === undefined) l.prep = (unico ? [...preps].reverse() : preps).find(p => _cqPrepUsavel(p, dia))?.id || 'novo';
  if (l.prep === 'novo') { l.prepData = l.prepData || dia; l.prepResp = l.prepResp || _cqSess().id; l.prepUn = l.prepUn || _cqPrepUltimaUnidade(_cqLoteCru(ins).produtoId) || 'mL'; }
  const respNome = id => { const u = _cqUsuarios().find(x => x.id === id); return u ? (u.nomeCompleto || u.username) : ''; };
  const ops = preps.map(p => {
    const venc = p.validade && p.validade < dia;
    return `<option value="${p.id}" ${p.id === l.prep ? 'selected' : ''} ${p.situacao === 'reprovado' ? 'disabled' : ''}>Preparo ${_cqEsc(_cqPrepTxt(p))}${venc ? ' (vencido)' : p.situacao === 'reprovado' ? ' (reprovado)' : p.situacao === 'em_avaliacao' ? ' (em avaliação)' : ''}</option>`;
  }).join('');
  const info = `cqPreparoInfo('${ins.id}','${l.prep}','${l.prepData || ''}','${_cqEsc(respNome(l.prepResp)).replace(/'/g, '&#39;')}')`;
  const camposNovo = `<input type="date" class="field-input" title="Data do preparo" max="${dia}" value="${_cqEsc(l.prepData)}" onchange="cqLancPrepCampo('${t.id}','prepData',this.value)">
      <select class="field-select" title="Responsável pelo preparo" onchange="cqLancPrepCampo('${t.id}','prepResp',this.value)">${_cqUsuarios().map(u => `<option value="${u.id}" ${u.id === l.prepResp ? 'selected' : ''}>${_cqEsc(u.nomeCompleto || u.username)}</option>`).join('')}</select>
      <div class="cq-prep-qtd-lin"><input type="number" class="field-input" min="0" step="any" inputmode="decimal" title="Quantidade preparada (opcional)" placeholder="Qtd. (opcional)" value="${_cqEsc(l.prepQtd || '')}" onchange="cqLancPrepCampo('${t.id}','prepQtd',this.value)">
        <select class="field-select" title="Unidade" onchange="cqLancPrepCampo('${t.id}','prepUn',this.value)">${CQ_UNID_PREPARO.map(x => `<option ${x === l.prepUn ? 'selected' : ''}>${x}</option>`).join('')}</select></div>`;
  // Lote sem preparos registrados: a lista teria só "+ Novo preparo", então vai direto para data e responsável
  if (!preps.length) {
    return `<div class="cq-prep-novo">
      <div class="cq-prep-cab"><span>${unico ? 'Preparo (uso único)' : 'Preparo'}</span><button type="button" class="cq-icobtn" title="Informações do preparo" onclick="${info}">${CQ_ICO.info}</button></div>
      ${camposNovo}
    </div>`;
  }
  return `<div class="cq-prep">
      <select class="field-select cq-g-sel" title="Preparo do lote ${_cqEsc(ins.lote)}" onchange="cqLancPrep('${t.id}',this.value)">${ops}<option value="novo" ${l.prep === 'novo' ? 'selected' : ''}>+ Novo preparo</option></select>
      <button type="button" class="cq-icobtn" title="Informações do preparo" onclick="${info}">${CQ_ICO.info}</button>
    </div>
    ${(() => { const p = l.prep && l.prep !== 'novo' ? preps.find(x => x.id === l.prep) : null; return p && !p.legado ? `<div class="cq-prep-sitlin">${_cqPrepSituacaoBtn(ins, p, 'lanc')}</div>` : ''; })()}
    ${l.prep === 'novo' ? `<div class="cq-prep-novo">${camposNovo}</div>` : ''}`;
}
function cqLancPrep(tid, v) {
  const l = _cqLanc.linhas[tid];
  l.prep = v;
  if (v !== 'novo') { l.prepData = ''; l.prepResp = ''; l.prepQtd = ''; }
  _cqRascunhoSalvar();
  _cqLancRedesenharGrade();
}
function cqLancPrepCampo(tid, campo, v) { _cqLanc.linhas[tid][campo] = v; _cqRascunhoSalvar(); }

function cqLancTecla(e) {
  if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  // Em listas (qualitativos) as setas escolhem a opção; só Enter avança
  if (e.target.tagName === 'SELECT' && e.key !== 'Enter') return;
  e.preventDefault();
  const inputs = [...document.querySelectorAll('#cq-grade .cq-g-input:not([disabled])')];
  const el = e.target;
  const mesmos = inputs.filter(i => i.dataset.n === el.dataset.n);
  let idx = mesmos.indexOf(el) + (e.key === 'ArrowUp' ? -1 : 1);
  let alvo = mesmos[idx];
  if (!alvo && e.key === 'Enter') {
    // fim da coluna: vai para o topo da próxima coluna
    const prox = inputs.filter(i => Number(i.dataset.n) === Number(el.dataset.n) + 1);
    alvo = prox[0];
  }
  if (alvo) { alvo.focus(); alvo.select(); }
}

function cqLancColar(e) {
  const txt = (e.clipboardData || window.clipboardData)?.getData('text') || '';
  const linhas = txt.replace(/\r/g, '').split('\n').filter((x, i, a) => x !== '' || i < a.length - 1);
  if (linhas.length <= 1) return;
  e.preventDefault();
  const el = e.target;
  const mesmos = [...document.querySelectorAll(`#cq-grade .cq-g-input:not([disabled])[data-n="${el.dataset.n}"]`)];
  let i = mesmos.indexOf(el);
  linhas.forEach(v => {
    const inp = mesmos[i++];
    if (!inp) return;
    inp.value = v.split('\t')[0].trim();
    cqLancValor(inp.dataset.t, Number(inp.dataset.n), inp.value);
  });
}

// Avaliação em tempo real de uma linha (teste)
function _cqAvaliarLinha(t) {
  if (_cqTesteQual(t)) return _cqAvaliarLinhaQual(t);
  const l = _cqLanc.linhas[t.id] || { valores: {} };
  const porNivel = {}, atual = [], erros = [];
  _cqNiveisTeste(t).forEach(n => {
    const txt = (l.valores?.[n] || '').trim();
    if (!txt) return;
    const v = CQEngine.parseNumero(txt);
    if (v === null) { erros.push(`Nível ${n}: valor inválido "${txt}"`); porNivel[n] = { invalido: true }; return; }
    const lid = t.lotesAtivos?.[n];
    const alvo = lid ? _cqAlvoVigente(t.id, lid, n, _cqLanc.dataHora) : null;
    const z = alvo ? CQEngine.zScore(v, alvo.media, alvo.dp) : null;
    porNivel[n] = { valor: v, alvo, z, loteId: lid };
    atual.push({ nivel: n, z });
  });
  const niveis = _cqNiveisTeste(t);
  const preenchidos = Object.keys(porNivel).length;
  const completo = preenchidos === niveis.length && !erros.length;
  let r = null;
  if (atual.length && !erros.length) {
    r = CQEngine.avaliarCorrida({ atual, historico: _cqLanc.hist[t.id] || [], regras: t.regras || {}, opcoes: { gatilho12s: !!t.opcoesRegras?.gatilho12s } });
    if (typeof _cqEsterAplicar === 'function') r = _cqEsterAplicar(r, _cqEsterFalhasLanc());
  }
  return { porNivel, r, completo, preenchidos, erros };
}

// Qualitativo: compara o resultado escolhido com o esperado de cada controle
function _cqAvaliarLinhaQual(t) {
  const l = _cqLanc.linhas[t.id] || { valores: {} };
  const an = _cqAnalito(t.analitoId);
  const escala = _cqArr(an?.escala);
  const porNivel = {}, atual = [], erros = [];
  _cqNiveisTeste(t).forEach(n => {
    const txt = String(l.valores?.[n] || '').trim();
    if (!txt) return;
    const obtido = escala.find(e => e.toLowerCase() === txt.toLowerCase());
    if (!obtido) { erros.push(`Nível ${n}: resultado fora da lista "${txt}"`); porNivel[n] = { invalido: true }; return; }
    const c = _cqControleQual(t, n) || {};
    porNivel[n] = { obtido, esperado: c.esperado || null, loteId: c.materialId ? (t.lotesAtivos?.[n] || null) : null };
    atual.push({ nivel: n, obtido, esperado: c.esperado || '', rotulo: _cqRotuloNivel(t, n) });
  });
  const preenchidos = Object.keys(porNivel).length;
  const completo = preenchidos === _cqNiveisTeste(t).length && !erros.length;
  let r = atual.length && !erros.length
    ? CQEngine.avaliarCorridaQualitativa({ atual, tipo: an?.tipo, escala, tolerancia: an?.toleranciaPassos })
    : null;
  // Ciclo de esterilização com parâmetro físico fora da especificação: indicador rejeitado
  if (r && typeof _cqEsterAplicar === 'function') r = _cqEsterAplicar(r, _cqEsterFalhasLanc());
  return { porNivel, r, completo, preenchidos, erros, qual: true };
}

function _cqGradeAtualizarLinhaQual(t, st, l) {
  _cqNiveisTeste(t).forEach(n => {
    const el = document.getElementById(`cq-g-alvo-${t.id}-${n}`);
    if (!el) return;
    const c = _cqControleQual(t, n) || {};
    const mat = cqState.config.materiais[c.materialId];
    el.innerHTML = `<div><span title="${_cqEsc(mat ? `${mat.nome}${mat.codigoReferencia ? ' · ' + mat.codigoReferencia : ''}` : 'Sem material')}">${_cqEsc(_cqRotuloNivel(t, n))}</span>
      · esp.: ${c.esperado ? _cqEsc(c.esperado) : '<span class="cq-txt-vermelho">não definido</span>'}</div>
      ${_cqNivelSemMaterial(t, n) ? '' : `<div class="cq-g-lote-lin">${_cqLancLoteChip(t, n)}</div>`}`;
  });
  if (l.nr) { st.innerHTML = '<span class="cq-muted">não realizado</span>'; return; }
  const a = _cqAvaliarLinhaQual(t);
  _cqNiveisTeste(t).forEach(n => {
    const cell = document.getElementById(`cq-g-${t.id}-${n}`);
    if (!cell) return;
    cell.classList.remove('cq-c-aceito', 'cq-c-alerta', 'cq-c-rejeitado', 'cq-c-semalvo', 'cq-c-invalido');
    const pn = a.porNivel[n];
    if (!pn) return;
    if (pn.invalido) { cell.classList.add('cq-c-invalido'); return; }
    const s = a.r?.porNivel[n]?.status || 'sem_alvo';
    cell.classList.add({ aceito: 'cq-c-aceito', alerta: 'cq-c-alerta', rejeitado: 'cq-c-rejeitado', sem_alvo: 'cq-c-semalvo' }[s]);
  });
  if (a.erros.length) { st.innerHTML = `<span class="cq-txt-vermelho">${_cqEsc(a.erros[0])}</span>`; return; }
  if (!a.preenchidos) { st.innerHTML = ''; return; }
  const s = a.r?.status || 'sem_alvo';
  st.innerHTML = `${_cqBadge(CQ_STATUS, s)}${a.r?.violacoes.length ? ` <span class="cq-g-regras">${a.r.violacoes.map(v => CQEngine.rotuloRegra(v.regra)).join(', ')}</span>` : ''}
    ${!a.completo ? '<div class="cq-muted cq-g-zs"><span class="cq-txt-amarelo">níveis faltando</span></div>' : ''}`;
}

function _cqGradeAtualizarTudo() { _cqLancTestes().forEach(_cqGradeAtualizarLinha); }

function _cqGradeAtualizarLinha(t) {
  if (!t || !_cqLanc?.linhas[t.id]) return;
  const st = document.getElementById('cq-g-st-' + t.id);
  if (!st) return;
  const an = _cqAnalito(t.analitoId);
  const dec = an?.decimais ?? 2;
  const l = _cqLanc.linhas[t.id];
  if (_cqTesteQual(t)) { _cqGradeAtualizarLinhaQual(t, st, l); return; }
  _cqNiveisTeste(t).forEach(n => {
    const lid = t.lotesAtivos?.[n];
    const alvo = lid ? _cqAlvoVigente(t.id, lid, n, _cqLanc.dataHora) : null;
    const el = document.getElementById(`cq-g-alvo-${t.id}-${n}`);
    if (!el) return;
    const lote = lid ? cqState.config.lotesControle[lid] : null;
    el.innerHTML = `<div class="cq-g-lote-lin">${_cqLancLoteChip(t, n)}</div>${!lid ? ''
      : alvo ? `<div>${_cqNum(alvo.media, dec)} ± ${_cqNum(alvo.dp, dec + 1)}${['fabricante', 'provisorio'].includes(alvo.origem) ? ` <span title="Alvo ${_cqEsc(CQ_ORIGEM_ALVO[alvo.origem]?.label || 'provisório')}">*</span>` : ''}</div>`
      : '<div class="cq-txt-amarelo">sem alvo</div>'}`;
  });
  if (l.nr) { st.innerHTML = '<span class="cq-muted">não realizado</span>'; return; }
  const a = _cqAvaliarLinha(t);
  _cqNiveisTeste(t).forEach(n => {
    const cell = document.getElementById(`cq-g-${t.id}-${n}`);
    if (!cell) return;
    cell.classList.remove('cq-c-aceito', 'cq-c-alerta', 'cq-c-rejeitado', 'cq-c-semalvo', 'cq-c-invalido');
    const pn = a.porNivel[n];
    if (!pn) { cell.title = ''; return; }
    if (pn.invalido) { cell.classList.add('cq-c-invalido'); return; }
    const s = a.r?.porNivel[n]?.status || 'sem_alvo';
    cell.classList.add({ aceito: 'cq-c-aceito', alerta: 'cq-c-alerta', rejeitado: 'cq-c-rejeitado', sem_alvo: 'cq-c-semalvo' }[s]);
    cell.title = pn.z !== null ? `z = ${_cqNum(pn.z, 2)}` : 'Sem alvo';
  });
  const carregando = _cqLanc.carregando.has(t.id) || !_cqLanc.hist[t.id];
  if (a.erros.length) { st.innerHTML = `<span class="cq-txt-vermelho">${_cqEsc(a.erros[0])}</span>`; return; }
  if (!a.preenchidos) { st.innerHTML = carregando ? '<span class="cq-muted">carregando histórico…</span>' : ''; return; }
  const zs = Object.entries(a.porNivel).map(([n, p]) => `N${n} z=${p.z === null ? '—' : _cqNum(p.z, 2)}`).join(' · ');
  const s = a.r?.status || 'sem_alvo';
  st.innerHTML = `${_cqBadge(CQ_STATUS, s)}${a.r?.violacoes.length ? ` <span class="cq-g-regras">${a.r.violacoes.map(v => CQEngine.rotuloRegra(v.regra)).join(', ')}</span>` : ''}
    <div class="cq-muted cq-g-zs">${zs}${!a.completo ? ' · <span class="cq-txt-amarelo">níveis faltando</span>' : ''}${carregando ? ' · carregando histórico…' : ''}</div>`;
}

// ── SALVAR CORRIDA ───────────────────────────────────────────
async function cqLancSalvar() {
  if (_cqSalvando || !_cqLanc) return;
  if (!_cqCan('lancar')) { showToast('Sem permissão para lançar.', 'error'); return; }
  if (!_cqPodeGravar()) return;
  if (!_cqEstacao()) { showToast('Defina o nome desta estação de trabalho antes de lançar.', 'error'); cqEditarEstacao(); return; }
  const lanc = _cqLanc;
  const u = lanc.u;
  const un = cqState.config.unidades[u];
  const g = _cqGruposLanc(u).find(x => x.key === lanc.grupo);
  if (!g) { showToast('Selecione o equipamento.', 'error'); return; }
  const dh = _cqVal('cq-l-dh') || lanc.dataHora;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dh)) { showToast('Informe a data/hora da corrida.', 'error'); return; }
  if (dh > _cqNowLocal()) { showToast('A data/hora da corrida não pode estar no futuro.', 'error'); return; }
  const horas = _cqHorasAtras(dh);
  const retro = horas > (Number(_cqPolitica(u).retroativoHoras) || 0);
  if (retro && !lanc.retroJust.trim()) { showToast('Justifique o lançamento retroativo.', 'error'); return; }
  const operador = _cqUsuarios().find(x => x.id === lanc.operadorId);
  if (!operador) { showToast('Informe quem executou a corrida.', 'error'); return; }

  const testes = _cqLancTestes();
  const hoje = dh.slice(0, 10);
  const realizados = [], naoRealizados = [], problemas = [];
  testes.forEach(t => {
    const l = lanc.linhas[t.id];
    if (l.nr) {
      if (!l.motivoNR.trim()) problemas.push(`${_cqNomeTeste(t)}: informe o motivo de não realização`);
      else naoRealizados.push(t);
      return;
    }
    const a = _cqAvaliarLinha(t);
    if (!a.preenchidos) { if (_cqLancFrac()) problemas.push(`${_cqNomeTeste(t)}: digite os resultados ou remova o teste da corrida`); return; }
    if (a.erros.length) { problemas.push(`${_cqNomeTeste(t)}: ${a.erros[0]}`); return; }
    if (!a.completo) { problemas.push(`${_cqNomeTeste(t)}: preencha todos os níveis ou marque “não realizado”`); return; }
    _cqNiveisTeste(t).forEach(n => {
      if (_cqNivelSemMaterial(t, n)) return;
      const lote = _cqLoteDoNivel(t, n);
      if (!lote) { problemas.push(`${_cqNomeTeste(t)} N${n}: sem lote de controle definido`); return; }
      if (lote.status === 'quarentena') problemas.push(`${_cqNomeTeste(t)} N${n}: lote ${lote.lote} em quarentena`);
      const v = _cqValidadeLoteTeste(t, n, u, hoje);
      if (v?.vencido) problemas.push(`${_cqNomeTeste(t)} N${n}: ${v.motivo === 'estabilidade' ? 'frasco aberto/repique além da estabilidade' : 'lote vencido'} (${_cqFmtData(v.dataLimite)}) — RDC 978, art. 102`);
    });
    if (t.exigirInsumo && !l.lr) problemas.push(`${_cqNomeTeste(t)}: informe o lote do ${(CQ_TIPOS_INSUMO[t.insumoTipo] || 'insumo').toLowerCase()}`);
    const insP = l.lr ? cqState.config.insumos[l.lr] : null;
    if (insP?.preparoInterno) {
      if (!l.prep) problemas.push(`${_cqNomeTeste(t)}: informe o preparo do lote ${insP.lote}`);
      else if (l.prep === 'novo') {
        if (!l.prepData || !l.prepResp) problemas.push(`${_cqNomeTeste(t)}: informe data e responsável do novo preparo`);
        else if (l.prepData > hoje) problemas.push(`${_cqNomeTeste(t)}: data do preparo posterior à corrida`);
        else if (_cqPrepValidade(insP, l.prepData) < hoje) problemas.push(`${_cqNomeTeste(t)}: preparo de ${_cqFmtData(l.prepData)} vencido para esta corrida`);
      } else {
        const pp = _cqPreparo(insP, l.prep);
        if (!pp) problemas.push(`${_cqNomeTeste(t)}: preparo não encontrado — escolha outro`);
        else if (pp.situacao === 'reprovado') problemas.push(`${_cqNomeTeste(t)}: preparo de ${_cqFmtData(pp.data)} reprovado no controle`);
        else if (pp.finalizado) problemas.push(`${_cqNomeTeste(t)}: preparo de ${_cqFmtData(pp.data)} finalizado — escolha outro ou registre um novo`);
        else if (insP.preparoUsoUnico && Object.keys(pp.corridas || {}).length) problemas.push(`${_cqNomeTeste(t)}: preparo ${pp.codigo || 'de ' + _cqFmtData(pp.data)} de uso único já usado em outra corrida`);
        else if (pp.validade && pp.validade < hoje) problemas.push(`${_cqNomeTeste(t)}: preparo de ${_cqFmtData(pp.data)} vencido (${_cqFmtData(pp.validade)}) — RDC 978, art. 102`);
      }
    }
    ['lr', 'lk'].forEach(c => {
      const ins = l[c] ? cqState.config.insumos[l[c]] : null;
      if (ins && ins.validade && ins.validade < hoje) problemas.push(`${_cqNomeTeste(t)}: ${CQ_TIPOS_INSUMO[ins.tipo]} lote ${ins.lote} vencido — RDC 978, art. 102`);
      if (ins && ins.status === 'quarentena') problemas.push(`${_cqNomeTeste(t)}: ${CQ_TIPOS_INSUMO[ins.tipo]} lote ${ins.lote} em quarentena`);
    });
    realizados.push(t);
  });
  if (problemas.length) {
    showToast(problemas.slice(0, 3).join(' · ') + (problemas.length > 3 ? ` (+${problemas.length - 3})` : ''), 'error');
    return;
  }
  if (!realizados.length) { showToast(_cqLancFrac() && !testes.length ? 'Adicione ao menos um teste à corrida.' : 'Nenhum resultado digitado.', 'error'); return; }
  // Ficha do ciclo de esterilização (RDC 1002, art. 91)
  const ester = typeof _cqEsterValidar === 'function' ? _cqEsterValidar(dh) : { ciclo: null };
  if (ester.erro) { showToast(ester.erro, 'error'); return; }
  const ciclo = ester.ciclo;

  const btn = document.getElementById('cq-l-salvar');
  if (btn) btn.disabled = true;
  _cqSalvando = true;
  let reservaLote = null;     // caminho do lote da carga reservado; liberado se a corrida não for gravada
  let gravou = false;
  try {
    // Reavalia com o histórico atualizado (outra estação pode ter salvo agora)
    const antesDe = CQEngine.chaveTempo(dh) + '_~';
    lanc.dataHora = dh;
    await Promise.all(realizados.map(async t => { lanc.hist[t.id] = _cqTesteQual(t) ? [] : await cqHistoricoTeste(u, t, antesDe, { forcar: true }); }));
    const ck = CQEngine.chaveCorrida(dh);
    const mes = CQEngine.mesDe(dh);
    if (ciclo && !ciclo.vinculo) {
      const res = await _cqEsterReservarLote(u, ciclo.loteCarga, { corridaKey: ck, mes, dataHora: dh, equip: g.key });
      if (!res.ok) { showToast(res.msg, 'error'); return; }
      reservaLote = res.path;
    }
    const numero = await _cqProximoNumero(u, 'corridas');
    if (!numero) { showToast('Não foi possível gerar o número da corrida. Tente novamente.', 'error'); return; }
    const pol = _cqPolitica(u);
    const podeLiberar = _cqCan('liberar');
    const verificacao = g.ativo?.statusUso === 'em_pausa';
    const ass = _cqAssinatura();
    const updates = {};
    const testesHdr = {};
    const idxUltimo = (cqState.indices[u] || {}).ultimo || {};
    const resumoTxt = [];
    const prepNovos = {};      // `${lr}|${chave}` → objeto do preparo criado nesta corrida (compartilhado entre testes)
    const prepSeqUsado = {};   // lr → números de preparo já usados nesta corrida
    const prepDoTeste = (t, l, autoLib) => {
      const ins = l.lr ? cqState.config.insumos[l.lr] : null;
      if (!ins?.preparoInterno || !l.prep) return null;
      const uso = { numero, mes, dataHora: dh, testeId: t.id };
      const avaliacao = { numero, corridaKey: ck, mes, ..._cqAssinatura() };
      if (l.prep === 'novo' || l.prep === 'legado') {
        const leg = l.prep === 'legado' ? _cqPreparo(ins, 'legado') : null;
        const k = `${l.lr}|${l.prep}|${l.prepData}|${l.prepResp}`;
        if (!prepNovos[k]) {
          const resp = _cqUsuarios().find(x => x.id === l.prepResp);
          const data = leg ? leg.data : l.prepData;
          const seq = _cqPrepSeq(ins) + (prepSeqUsado[l.lr] = (prepSeqUsado[l.lr] || 0) + 1) - 1;
          const qtd = leg ? 0 : Number(String(l.prepQtd || '').replace(',', '.'));
          const obj = { id: _cqUid(), seq, codigo: _cqPrepCodigo(ins, seq), data, responsavelId: leg ? null : l.prepResp, responsavel: leg ? leg.responsavel : (resp?.nomeCompleto || resp?.username || ''),
            ...(qtd > 0 ? { quantidade: qtd, unidadeQtd: l.prepUn || '' } : {}),
            validade: _cqPrepValidade(ins, data), situacao: leg ? 'liberado' : 'em_avaliacao', legado: !!leg, origem: 'lancamento', criadoEm: ass.em, criadoPor: ass, corridas: {} };
          // Uso único: consumido nesta corrida (sai dos lançamentos; a decisão da corrida ainda libera ou reprova)
          if (ins.preparoUsoUnico) obj.finalizado = { auto: true, motivo: `uso único — corrida ${numero}`, ...ass };
          prepNovos[k] = obj;
          updates[`${CQ_KEYS.config}/insumos/${l.lr}/preparos/${obj.id}`] = obj;
          updates[`${CQ_KEYS.config}/insumos/${l.lr}/trilha/${_cqTk()}${obj.id.slice(-3)}`] = _cqTrilhaEntry('edicao', `Preparo ${obj.codigo} de ${_cqFmtData(data)} (${obj.responsavel}${_cqPrepQtdTxt(obj) ? ', ' + _cqPrepQtdTxt(obj) : ''}) registrado na corrida ${numero}`);
        }
        const obj = prepNovos[k];
        obj.corridas[ck] = uso;
        if (autoLib && obj.situacao === 'em_avaliacao') { obj.situacao = 'liberado'; obj.avaliacao = avaliacao; }
        return obj.id;
      }
      updates[`${CQ_KEYS.config}/insumos/${l.lr}/preparos/${l.prep}/corridas/${ck}`] = uso;
      // Uso único registrado antes (aba Preparos): consumido nesta corrida
      if (ins.preparoUsoUnico && !_cqPreparo(ins, l.prep)?.finalizado) updates[`${CQ_KEYS.config}/insumos/${l.lr}/preparos/${l.prep}/finalizado`] = { auto: true, motivo: `uso único — corrida ${numero}`, ...ass };
      if (autoLib && _cqPreparo(ins, l.prep)?.situacao === 'em_avaliacao') {
        updates[`${CQ_KEYS.config}/insumos/${l.lr}/preparos/${l.prep}/situacao`] = 'liberado';
        updates[`${CQ_KEYS.config}/insumos/${l.lr}/preparos/${l.prep}/avaliacao`] = avaliacao;
      }
      return l.prep;
    };

    realizados.forEach(t => {
      const l = lanc.linhas[t.id];
      const a = _cqAvaliarLinha(t);
      const r = a.r;
      const ult = idxUltimo[t.id];
      const trocaLr = !!(ult?.lr && l.lr && ult.lr !== l.lr);
      const trocaLk = !!(ult?.lk && l.lk && ult.lk !== l.lk);
      const autoLib = pol.liberarAceitosAoSalvar && podeLiberar && r.status === 'aceito' && !verificacao;
      const decisao = autoLib ? { acao: 'liberado', auto: true, comentario: 'Liberado ao salvar (sem violações)', ...ass } : null;
      const prepId = prepDoTeste(t, l, autoLib);
      const niveisMap = {};
      Object.entries(a.porNivel).forEach(([n, p]) => {
        const resKey = `${ck}_n${n}`;
        niveisMap[n] = resKey;
        const est = r.porNivel[n]?.status || 'sem_alvo';
        const res = a.qual ? CQEngine.compactarResultado({
          corridaKey: ck, nivel: Number(n), loteControleId: p.loteId, obtido: p.obtido, esperado: p.esperado,
          estado: CQ_ESTADO_SIGLA[est], regras: r.porNivel[n]?.regras || [], decisao: decisao ? 'L' : null, loteReagenteId: l.lr || null, preparoId: prepId,
        }) : CQEngine.compactarResultado({
          corridaKey: ck, nivel: Number(n), loteControleId: p.loteId, valor: p.valor, alvoId: p.alvo?.id || null,
          media: p.alvo?.media ?? null, dp: p.alvo?.dp ?? null, z: p.z === null ? null : CQEngine.arred(p.z, 4),
          estado: CQ_ESTADO_SIGLA[est], regras: r.porNivel[n]?.regras || [], decisao: decisao ? 'L' : null,
          loteReagenteId: l.lr || null, loteCalibradorId: l.lk || null, preparoId: prepId,
        });
        updates[`${CQ_KEYS.resultados}/${u}/${mes}/${t.id}/${resKey}`] = res;
        _cqMarcarUso(updates, 'lotesControle', p.loteId);
        _cqMarcarUso(updates, 'materiais', cqState.config.lotesControle[p.loteId]?.materialId || t.controlesQual?.[n]?.materialId);
      });
      _cqMarcarUso(updates, 'testes', t.id);
      _cqMarcarUso(updates, 'analitos', t.analitoId);
      _cqMarcarUso(updates, 'materiais', t.materialId);
      _cqMarcarUso(updates, 'insumos', l.lr);
      _cqMarcarUso(updates, 'insumos', l.lk);
      testesHdr[t.id] = {
        niveis: niveisMap, lr: l.lr || null, lk: l.lk || null, prep: prepId, posCalibracao: !!l.posCalibracao,
        trocaLoteReagente: trocaLr, trocaLoteCalibrador: trocaLk, versaoConfig: t.versaoConfig || 1,
        avaliacao: { status: r.status, violacoes: r.violacoes.map(v => ({ regra: v.regra, severidade: v.severidade, escopo: v.escopo, niveis: v.niveis, texto: v.texto })),
                     ...(r.statusIndicadores ? { statusIndicadores: r.statusIndicadores } : {}) },
        decisao,
      };
      if (!ult || (ult.dataHora || '') <= dh) {
        updates[`${CQ_KEYS.indices}/${u}/ultimo/${t.id}`] = { dataHora: dh, corridaKey: ck, mes, status: r.status, decisao: decisao ? 'L' : null, lr: l.lr || null, lk: l.lk || null };
      }
      resumoTxt.push(`${_cqNomeTeste(t)}: ${CQ_STATUS[r.status]?.label}`);
    });
    naoRealizados.forEach(t => { testesHdr[t.id] = { naoRealizado: true, motivo: lanc.linhas[t.id].motivoNR.trim() }; });

    const hdr = {
      numero, unidadeId: u, ativoId: g.ativoId || null,
      ativoSnap: g.ativo ? { nome: g.ativo.nome || '', codigo: g.ativo.codigo || '', serie: g.ativo.serie || '' } : null,
      sistemaAnalitico: g.ativoId ? null : g.nome, dataHora: dh,
      operadorId: operador.id, operadorNome: operador.nomeCompleto || operador.username,
      lancadoPorId: ass.porId, lancadoPorNome: ass.porNome, lancadoEm: ass.em, servTs: window.dbServerTs(), estacao: ass.estacao,
      retroativo: retro ? { horas: Math.round(horas), justificativa: lanc.retroJust.trim() } : null,
      flags: { posManutPrev: lanc.flags.posManutPrev, posManutCorr: lanc.flags.posManutCorr, reinicioEquip: lanc.flags.reinicioEquip,
               verificacao, otRef: lanc.flags.otRef.trim() || null },
      repeticaoDe: lanc.repeticaoDe ? lanc.repeticaoDe.key : null,
      testes: testesHdr, trilha: {},
    };
    hdr.status = _cqStatusCorrida(hdr);
    if (_cqLancFrac()) hdr.fracionada = true;
    let txtCiclo = '';
    if (ciclo) {
      hdr.ciclo = ciclo;
      if (ciclo.vinculo) {
        // Leitura do indicador biológico: referência cruzada no ciclo de origem
        const v = ciclo.vinculo;
        updates[`${CQ_KEYS.corridas}/${u}/${v.mes}/${v.key}/ciclo/leituras/${ck}`] = { numero, mes, dataHora: dh };
        updates[`${CQ_KEYS.corridas}/${u}/${v.mes}/${v.key}/trilha/${_cqTk()}`] = _cqTrilhaEntry('edicao', `Leitura de indicador do ciclo ${ciclo.loteCarga} registrada na corrida ${numero}`);
        txtCiclo = ` · leitura do ciclo ${ciclo.loteCarga} (corrida ${v.numero || v.key})`;
      } else {
        updates[`${reservaLote}/numero`] = numero;
        txtCiclo = ` · ciclo ${ciclo.loteCarga}, ${ciclo.programa.nome}, ${ciclo.pacotes.length} pacote(s)${ciclo.conforme ? '' : ` — parâmetros físicos fora da especificação: ${ciclo.falhas.join('; ')}`}`;
      }
    }
    hdr.trilha[_cqTk()] = _cqTrilhaEntry('criacao', `Corrida ${numero} lançada${hdr.fracionada ? ' (fracionada)' : ''}${txtCiclo} — ${resumoTxt.join('; ')}`);
    updates[`${CQ_KEYS.corridas}/${u}/${mes}/${ck}`] = hdr;
    const pend = _cqResumoPendencia({ ...hdr, key: ck, mes });
    if (pend) updates[`${CQ_KEYS.indices}/${u}/pendentes/${ck}`] = pend;
    const rep = lanc.repeticaoDe;
    if (rep?.ncId && rep.ncAno && testesHdr[rep.testeId]) {
      updates[`${CQ_KEYS.acoes}/${u}/${rep.ncAno}/${rep.ncId}/repeticoes/${ck}`] = {
        numero, mes, dataHora: dh, status: testesHdr[rep.testeId].avaliacao?.status || null, porNome: ass.porNome,
      };
    }

    const ok = await window.dbUpdate(updates);
    if (!ok) { showToast('Falha ao gravar a corrida. Nada foi salvo; tente novamente.', 'error'); return; }
    gravou = true;
    // Atualiza caches dos resultados
    Object.entries(updates).forEach(([p, v]) => {
      if (!p.startsWith(CQ_KEYS.resultados + '/')) return;
      const [, , m2, t2, rk] = p.slice(CQ_KEYS.resultados.length).split('/');
      _cqResCacheSet(u, m2, t2, rk, CQEngine.expandirResultado(v, rk));
    });
    _cqRascunhoLimpar();
    const nRej = realizados.filter(t => testesHdr[t.id].avaliacao.status === 'rejeitado').length;
    showToast(`Corrida ${numero} salva.${nRej ? ` ${nRej} teste(s) rejeitado(s): avalie e registre a ação corretiva.` : pend ? ' Aguardando avaliação.' : ' Todos os testes liberados.'}`, nRej ? 'error' : 'success');
    const repet = lanc.repeticaoDe;
    _cqLanc = _cqLancNovo(lanc.grupo);
    if (!repet) _cqLanc.modo = lanc.modo;   // fracionada: próxima corrida começa vazia, no mesmo modo
    if (lanc.ciclo && typeof _cqEsterVazio === 'function') _cqLanc.ciclo = _cqEsterVazio(lanc.ciclo.programaId);   // mantém o programa
    cqRender();
    if (pend || repet) cqAbrirCorrida(mes, ck);
  } finally {
    // Corrida não gravada: libera o lote da carga reservado
    if (reservaLote && !gravou) await window.dbUpdate({ [reservaLote]: null });
    _cqSalvando = false;
    if (btn) btn.disabled = false;
  }
}

// ── LISTA DE CORRIDAS ────────────────────────────────────────
function cqRenderCorridas(body) {
  const u = _cqUnidadeAtivaId();
  if (!_cqCorrFiltro.mes) _cqCorrFiltro.mes = CQEngine.mesDe(_cqNowLocal());
  const idx = cqState.indices[u] || {};
  const pend = Object.entries(idx.pendentes || {}).map(([k, p]) => ({ key: k, ...p })).sort((a, b) => (a.dataHora || '').localeCompare(b.dataHora || ''));
  const meses = CQEngine.mesesAnteriores(CQEngine.mesDe(_cqNowLocal()), 24);
  const grupos = _cqGruposLanc(u);
  body.innerHTML = `
  <div class="cq-corr">
    ${pend.length ? `<div class="cq-card cq-card-pend"><div class="cq-card-tit">${CQ_ICO.clock} Aguardando avaliação (${pend.length})
      ${_cqCan('liberar') ? '' : '<span class="cq-muted"> · sem permissão para liberar</span>'}</div>
      <div class="cq-pend-grid">${pend.map(p => `<div class="cq-pend-item" onclick="cqAbrirCorrida('${p.mes || CQEngine.mesDe(p.key)}','${p.key}')">
        <span class="cq-dot ${p.temRejeicao ? 'cq-dot-vermelho' : 'cq-dot-amarelo'}"></span>
        <div style="flex:1;min-width:0;"><div class="cq-pend-tit">${_cqEsc(p.numero || p.key)} · ${_cqEsc(p.equipNome || '')}</div>
        <div class="cq-pend-sub">${_cqFmtDH(p.dataHora)} · ${p.nPend} teste(s)${p.temRejeicao ? ' · <b class="cq-txt-vermelho">rejeição</b>' : ''}</div></div></div>`).join('')}</div></div>` : ''}
    <div class="cq-toolbar">
      <select class="field-select" style="max-width:160px;" onchange="_cqCorrFiltro.mes=this.value;_cqCorrCache=null;cqRender()">${meses.map(m => `<option value="${m}" ${m === _cqCorrFiltro.mes ? 'selected' : ''}>${_cqFmtMes(m)}</option>`).join('')}</select>
      <select class="field-select" style="max-width:240px;" onchange="_cqCorrFiltro.grupo=this.value;_cqCorrRenderLista()"><option value="">Todos os equipamentos</option>${grupos.map(x => `<option value="${_cqEsc(x.key)}" ${x.key === _cqCorrFiltro.grupo ? 'selected' : ''}>${_cqEsc(x.nome)}</option>`).join('')}</select>
      <select class="field-select" style="max-width:200px;" onchange="_cqCorrFiltro.status=this.value;_cqCorrRenderLista()">
        <option value="todas" ${_cqCorrFiltro.status === 'todas' ? 'selected' : ''}>Todas</option>${Object.entries(CQ_CORRIDA_STATUS).map(([k, s]) => `<option value="${k}" ${k === _cqCorrFiltro.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
      <div class="cq-spacer"></div>
      <button class="btn btn-outline btn-sm" onclick="_cqCorrCache=null;cqRender()">${CQ_ICO.undo} Atualizar</button>
    </div>
    <div id="cq-corr-lista"><div class="cq-vazio-p">Carregando…</div></div>
  </div>`;
  _cqCorrCarregar();
}

async function _cqCorrCarregar() {
  const u = _cqUnidadeAtivaId(), mes = _cqCorrFiltro.mes;
  if (!_cqCorrCache || _cqCorrCache.u !== u || _cqCorrCache.mes !== mes) {
    const corridas = await cqCarregarCorridasMes(u, mes);
    _cqCorrCache = { u, mes, corridas };
  }
  _cqCorrRenderLista();
}

function _cqCorrRenderLista() {
  const el = document.getElementById('cq-corr-lista');
  if (!el || !_cqCorrCache) return;
  const lista = Object.values(_cqCorrCache.corridas)
    .filter(c => _cqCorrFiltro.status === 'todas' || (c.status || _cqStatusCorrida(c)) === _cqCorrFiltro.status)
    .filter(c => !_cqCorrFiltro.grupo || (_cqCorrFiltro.grupo === (c.ativoId ? 'a:' + c.ativoId : 'm:' + (c.sistemaAnalitico || 'Bancada / manual'))))
    .sort((a, b) => b.key.localeCompare(a.key));
  el.innerHTML = `<div class="oc-table-scroll"><table class="ot-list-table cq-table">
    <thead><tr><th class="ot-list-th">Nº</th><th class="ot-list-th">Data/hora</th><th class="ot-list-th">Equipamento</th><th class="ot-list-th">Testes</th><th class="ot-list-th">Avaliação</th><th class="ot-list-th">Situação</th><th class="ot-list-th">Executado por</th></tr></thead>
    <tbody>${lista.length ? lista.map(c => {
      const ts = Object.values(c.testes || {}).filter(x => !x.naoRealizado);
      const cont = s => ts.filter(x => x.avaliacao?.status === s).length;
      const st = c.status || _cqStatusCorrida(c);
      return `<tr class="ot-list-row" onclick="cqAbrirCorrida('${c.mes}','${c.key}')">
        <td class="oc-num">${_cqEsc(c.numero)}${c.repeticaoDe ? ' <span title="Repetição">↻</span>' : ''}</td><td style="white-space:nowrap;">${_cqFmtDH(c.dataHora)}${c.retroativo ? ' <span class="cq-badge cq-st-alerta" title="Retroativo">R</span>' : ''}</td>
        <td>${_cqEsc(c.ativoSnap?.nome || c.sistemaAnalitico || '—')}${c.flags?.verificacao ? ' <span class="cq-badge cq-st-pendente">verificação</span>' : ''}${c.observacao ? ` <span class="cq-badge cq-st-alerta" title="${_cqEsc(c.observacao)}">sem lote</span>` : ''}
          ${c.ciclo?.loteCarga ? ` <span class="cq-badge ${c.ciclo.conforme === false ? 'cq-st-rejeitado' : 'cq-st-semalvo'}" title="${c.ciclo.vinculo ? 'Leitura de indicador do ciclo' : 'Lote da carga'}${c.ciclo.conforme === false ? ' — parâmetros físicos fora da especificação' : ''}">${c.ciclo.vinculo ? 'leitura ' : ''}${_cqEsc(c.ciclo.loteCarga)}</span>` : ''}</td>
        <td>${ts.length}</td>
        <td style="white-space:nowrap;">${cont('aceito') ? `<span class="cq-badge cq-st-aceito">${cont('aceito')}</span> ` : ''}${cont('alerta') ? `<span class="cq-badge cq-st-alerta">${cont('alerta')}</span> ` : ''}${cont('rejeitado') ? `<span class="cq-badge cq-st-rejeitado">${cont('rejeitado')}</span> ` : ''}${cont('sem_alvo') ? `<span class="cq-badge cq-st-semalvo">${cont('sem_alvo')}</span>` : ''}</td>
        <td>${_cqBadge(CQ_CORRIDA_STATUS, st)}</td><td>${_cqEsc(c.operadorNome || '—')}</td></tr>`;
    }).join('') : '<tr><td colspan="7" class="cq-td-vazio">Nenhuma corrida no período.</td></tr>'}</tbody></table></div>`;
}

// ── DETALHE DA CORRIDA ───────────────────────────────────────
async function cqAbrirCorrida(mes, key) {
  const u = _cqUnidadeAtivaId();
  _cqCorrAberta = { u, mes, key };
  cqModalOpen({ titulo: 'Corrida', subtitulo: 'Carregando…', corpo: '<div class="cq-vazio-p">Carregando…</div>', icone: 'lista' });
  await _cqCorrRenderDetalhe(true);
}

async function _cqCorrRenderDetalhe(forcar) {
  const ctx = _cqCorrAberta;
  if (!ctx) return;
  const c = await cqCarregarCorrida(ctx.u, ctx.mes, ctx.key);
  if (!c) { document.getElementById('cq-modal-body').innerHTML = '<div class="cq-vazio">Corrida não encontrada.</div>'; return; }
  const testesIds = Object.keys(c.testes || {});
  const resPorTeste = {};
  await Promise.all(testesIds.map(async t => { resPorTeste[t] = await cqCarregarResultados(ctx.u, ctx.mes, t, { forcar }); }));
  if (_cqCorrAberta !== ctx) return;
  const podeLib = _cqCan('liberar');
  const me = _cqSess().id;
  const st = _cqStatusCorrida(c);
  const linhas = testesIds.map(tid => {
    const t = cqState.config.testes[tid];
    const ct = c.testes[tid];
    const nome = t ? _cqNomeTeste(t) : 'Teste removido';
    if (ct.naoRealizado) return `<tr class="cq-g-nr"><td><b>${_cqEsc(nome)}</b></td><td colspan="3" class="cq-muted">Não realizado: ${_cqEsc(ct.motivo)}</td><td></td></tr>`;
    const dec = _cqAnalito(t?.analitoId)?.decimais ?? 2;
    const nivs = Object.entries(ct.niveis || {}).sort(([a], [b]) => a - b).map(([n, rk]) => {
      const r = resPorTeste[tid]?.[rk];
      if (!r) return `<div class="cq-det-nivel">N${n}: <span class="cq-muted">—</span></div>`;
      const est = CQ_SIGLA_ESTADO[r.estado] || 'sem_alvo';
      const podeCorr = !r.invalidado && (_cqCan('invalidar') || (c.lancadoPorId === me && !ct.decisao));
      const q = r.obtido !== undefined;
      return `<div class="cq-det-nivel ${r.invalidado ? 'cq-det-inval' : ''}">
        <span class="cq-det-n" title="${_cqEsc(t ? _cqRotuloNivel(t, n) : '')}">N${n}</span>
        <b class="${{ aceito: '', alerta: 'cq-txt-amarelo', rejeitado: 'cq-txt-vermelho' }[est] || ''}">${q ? _cqEsc(r.obtido) : _cqNum(r.valor, dec)}</b>
        ${r.valorOriginal !== undefined ? `<span class="cq-muted" title="Valor original">(orig. ${q ? _cqEsc(r.valorOriginal) : _cqNum(r.valorOriginal, dec)})</span>` : ''}
        <span class="cq-muted">${q ? `${_cqEsc(t ? _cqRotuloNivel(t, n) : '')} · esperado ${_cqEsc(r.esperado || '—')}`
          : `z ${r.z === undefined || r.z === null ? '—' : _cqNum(r.z, 2)} · alvo ${r.media !== undefined ? `${_cqNum(r.media, dec)} ± ${_cqNum(r.dp, dec + 1)}` : '—'}`}</span>
        ${_cqArr(r.regras).length ? `<span class="cq-g-regras">${_cqArr(r.regras).map(x => CQEngine.rotuloRegra(x)).join(', ')}</span>` : ''}
        ${r.invalidado ? `<span class="cq-badge cq-st-semalvo" title="${_cqEsc(r.invalidacao?.motivo)}">invalidado</span>` : ''}
        ${r.observacao ? `<span class="cq-badge cq-st-alerta" title="${_cqEsc(r.observacao)}">sem lote</span>` : ''}
        ${podeCorr ? `<span class="cq-det-acoes"><button class="cq-icobtn" title="Corrigir valor" onclick="cqCorrigirResultado('${tid}','${rk}')">${CQ_ICO.edit}</button>
          <button class="cq-icobtn" title="Invalidar resultado" onclick="cqInvalidarResultado('${tid}','${rk}')">${CQ_ICO.ban}</button></span>` : ''}
      </div>`;
    }).join('');
    const av = ct.avaliacao || {};
    const viol = _cqArr(av.violacoes).map(v => `<div class="cq-det-viol ${v.severidade === 'rejeicao' ? 'cq-txt-vermelho' : 'cq-txt-amarelo'}">• ${_cqEsc(v.texto)}</div>`).join('');
    let decisaoHTML = '';
    if (ct.decisao) {
      const d = ct.decisao;
      decisaoHTML = `${_cqBadge(CQ_DECISAO, d.acao)}<div class="cq-muted">${_cqEsc(d.porNome)} · ${_cqFmtDH(d.em)}${d.auto ? ' · automática' : ''}</div>${d.comentario && !d.auto ? `<div class="cq-det-com">“${_cqEsc(d.comentario)}”</div>` : ''}
        ${ct.ncId ? `<a href="#" class="cq-link" onclick="cqAbrirNC('${ctx.u}','${_cqEsc(ct.ncAno || ctx.mes.slice(0, 4))}','${ct.ncId}');return false;">${CQ_ICO.alerta} Não conformidade</a>` : ''}
        ${d.acao === 'rejeitado' && _cqCan('lancar') ? `<button class="btn btn-outline btn-sm" style="margin-top:4px;" onclick="cqRepetirControle('${ctx.mes}','${ctx.key}','${tid}')">${CQ_ICO.repeat} Repetir controle</button>` : ''}`;
    } else if (podeLib) {
      const s = av.status;
      decisaoHTML = `<div class="cq-det-btns">
        ${s !== 'rejeitado' ? `<button class="btn btn-primary btn-sm" onclick="cqDecidir('${tid}','liberado')">${CQ_ICO.check} Liberar</button>` : ''}
        <button class="btn btn-outline btn-sm cq-btn-rej" onclick="cqDecidir('${tid}','rejeitado')">${CQ_ICO.ban} Rejeitar</button>
        ${s === 'rejeitado' ? `<button class="btn btn-outline btn-sm" onclick="cqDecidir('${tid}','liberado_com_violacao')" title="Exige justificativa técnica e senha">Liberar c/ justificativa</button>` : ''}
      </div>`;
    } else decisaoHTML = '<span class="cq-muted">Aguardando avaliação</span>';
    const extras = [ct.posCalibracao ? 'após calibração' : '', ct.trocaLoteReagente ? 'troca de lote de reagente' : '', ct.trocaLoteCalibrador ? 'troca de lote de calibrador' : ''].filter(Boolean);
    const insLr = ct.lr ? cqState.config.insumos[ct.lr] : null;
    const prepLr = ct.prep && insLr ? _cqPreparo(insLr, ct.prep) : null;
    const ins = [ct.lr ? (t && _cqTesteQual(t) ? `${insLr?.nome || 'Insumo'} lote ${insLr?.lote || '?'}` : `Reag. ${insLr?.lote || '?'}`) + (prepLr ? ` · preparo ${_cqPrepTxt(prepLr)}` : '') : '',
                 ct.lk ? `Cal. ${cqState.config.insumos[ct.lk]?.lote || '?'}` : ''].filter(Boolean);
    return `<tr><td><b>${_cqEsc(nome)}</b><div class="cq-muted">${_cqEsc(_cqAnalito(t?.analitoId)?.unidadeMedida || '')}${ins.length ? ' · ' + _cqEsc(ins.join(' · ')) : ''}</div>
        ${extras.length ? `<div class="cq-txt-amarelo" style="font-size:11px;">${_cqEsc(extras.join(' · '))}</div>` : ''}
        ${ct.observacao ? `<div class="cq-txt-amarelo" style="font-size:11px;">Obs.: ${_cqEsc(ct.observacao)}</div>` : ''}
        ${t ? `<a href="#" class="cq-link" onclick="cqModalClose();cqAbrirGrafico('${tid}');return false;">${CQ_ICO.grafico} gráfico</a>` : ''}</td>
      <td>${nivs}</td><td>${_cqBadge(CQ_STATUS, av.status || 'sem_alvo')}${viol}</td><td>${decisaoHTML}</td></tr>`;
  }).join('');
  const flags = [c.fracionada ? 'Corrida fracionada' : '', c.flags?.posManutPrev ? 'Após manutenção preventiva' : '', c.flags?.posManutCorr ? 'Após manutenção corretiva' : '', c.flags?.reinicioEquip ? 'Após reinício' : '',
                 c.flags?.verificacao ? 'Verificação (equipamento em pausa)' : '', c.flags?.otRef ? `Ref.: ${c.flags.otRef}` : ''].filter(Boolean);
  const aceitosPend = testesIds.filter(tid => !c.testes[tid].naoRealizado && !c.testes[tid].decisao && c.testes[tid].avaliacao?.status === 'aceito');
  document.getElementById('cq-modal-title').textContent = `Corrida ${c.numero}`;
  document.getElementById('cq-modal-sub').textContent = `${c.ativoSnap?.nome || c.sistemaAnalitico || ''} · ${_cqFmtDH(c.dataHora)}`;
  document.getElementById('cq-modal-body').innerHTML = `
    <div class="cq-det-head">
      <div><span class="cq-muted">Situação</span>${_cqBadge(CQ_CORRIDA_STATUS, st)}</div>
      <div><span class="cq-muted">Executado por</span><b>${_cqEsc(c.operadorNome)}</b></div>
      <div><span class="cq-muted">Lançado por</span><b>${_cqEsc(c.lancadoPorNome)}</b><span class="cq-muted">${_cqFmtDH(c.lancadoEm)} · ${_cqEsc(c.estacao || '')}</span></div>
      ${c.retroativo ? `<div><span class="cq-muted">Retroativo</span><b>${_cqEsc(c.retroativo.justificativa)}</b></div>` : ''}
      ${c.observacao ? `<div><span class="cq-muted">Observação</span><b class="cq-txt-amarelo">${_cqEsc(c.observacao)}</b></div>` : ''}
      ${c.repeticaoDe ? `<div><span class="cq-muted">Repetição de</span><a href="#" onclick="cqAbrirCorrida('${CQEngine.mesDe(c.repeticaoDe)}','${c.repeticaoDe}');return false;">${_cqEsc(c.repeticaoDe)}</a></div>` : ''}
    </div>
    ${flags.length ? `<div class="cq-det-flags">${flags.map(f => `<span class="cq-tag">${_cqEsc(f)}</span>`).join('')}</div>` : ''}
    ${typeof _cqEsterDetalheHTML === 'function' ? _cqEsterDetalheHTML(c) : ''}
    <div class="oc-table-scroll"><table class="ot-list-table cq-table cq-det-tbl"><thead><tr><th class="ot-list-th">Teste</th><th class="ot-list-th">Resultados</th><th class="ot-list-th">Avaliação</th><th class="ot-list-th">Decisão</th></tr></thead><tbody>${linhas}</tbody></table></div>
    <details class="cq-det-trilha"><summary>Rastreabilidade da corrida</summary>${_cqTrilhaHTML(c)}</details>`;
  document.getElementById('cq-modal-foot').innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn btn-outline" onclick="cqImprimirCorrida()">${CQ_ICO.print} Imprimir</button></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${podeLib && aceitosPend.length > 1 ? `<button class="btn btn-primary" onclick="cqLiberarAceitos()">${CQ_ICO.check} Liberar ${aceitosPend.length} aceitos</button>` : ''}
      <button class="btn btn-outline" onclick="cqModalClose()">Fechar</button></div>`;
  document.getElementById('cq-modal-foot').style.justifyContent = 'space-between';
}

// ── DECISÕES (liberação / rejeição) ──────────────────────────
function cqDecidir(testeId, acao) {
  const ctx = _cqCorrAberta;
  if (!ctx || !_cqCan('liberar')) return;
  const t = cqState.config.testes[testeId];
  const nome = t ? _cqNomeTeste(t) : 'Teste';
  const pol = _cqPolitica(ctx.u);
  cqCarregarCorrida(ctx.u, ctx.mes, ctx.key).then(c => {
    const ct = c?.testes?.[testeId];
    if (!ct) return;
    if (ct.decisao) { showToast(`Já avaliado por ${ct.decisao.porNome}.`, 'error'); _cqCorrRenderDetalhe(true); return; }
    const s = ct.avaliacao?.status;
    if (acao === 'liberado' && s === 'aceito' && !c.flags?.verificacao) { _cqAplicarDecisao(ctx, testeId, 'liberado', ''); return; }
    const exigeCom = acao !== 'liberado' || s === 'sem_alvo' || (s === 'alerta' && pol.comentarioObrigatorioAlerta) || c.flags?.verificacao;
    const titulos = { liberado: 'Liberar', rejeitado: 'Rejeitar', liberado_com_violacao: 'Liberar com justificativa' };
    _cqPrompt({
      titulo: `${titulos[acao]} · ${nome}`,
      subtitulo: acao === 'liberado_com_violacao' ? 'Liberação de corrida rejeitada pelas regras — assinatura obrigatória'
        : acao === 'rejeitado' ? 'Os resultados de pacientes desta corrida não devem ser liberados' : (s === 'sem_alvo' ? 'Avaliação manual (sem alvo definido)' : 'Avaliação do responsável'),
      corpo: `${acao === 'rejeitado' ? `<div class="cq-nota">Será aberta uma não conformidade para registrar causa, ação corretiva e impacto em pacientes (RDC 978, art. 180, IV).</div>` : ''}
        ${acao === 'liberado_com_violacao' ? `<div class="cq-alerta-box">${CQ_ICO.alerta} Use apenas com fundamento técnico (ex.: violação explicada por erro de digitação já corrigido, controle deteriorado com repetição aceita). Uma não conformidade será aberta.</div>` : ''}
        <div class="form-field"><label class="field-label">${acao === 'liberado' ? 'Comentário' : 'Justificativa'} ${exigeCom ? '<span class="required">*</span>' : ''}</label>
          <textarea id="cq-dec-com" class="field-textarea" style="min-height:70px;"></textarea></div>
        ${acao === 'liberado_com_violacao' ? _cqSenhaCampoHTML() : ''}`,
      confirmar: titulos[acao], perigo: acao !== 'liberado',
      onConfirm: async () => {
        const com = _cqVal('cq-dec-com');
        if (exigeCom && !com) { showToast('Informe a justificativa.', 'error'); return false; }
        if (acao === 'liberado_com_violacao' && !_cqSenhaOk()) return false;
        return _cqAplicarDecisao(ctx, testeId, acao, com);
      },
    });
  });
}

async function cqLiberarAceitos() {
  const ctx = _cqCorrAberta;
  if (!ctx || !_cqCan('liberar')) return;
  const c = await cqCarregarCorrida(ctx.u, ctx.mes, ctx.key);
  if (c?.flags?.verificacao) { showToast('Corrida de verificação: avalie cada teste com comentário.', 'error'); return; }
  const ids = Object.keys(c?.testes || {}).filter(t => !c.testes[t].naoRealizado && !c.testes[t].decisao && c.testes[t].avaliacao?.status === 'aceito');
  for (const t of ids) await _cqAplicarDecisao(ctx, t, 'liberado', '', { semRender: true });
  _cqCorrRenderDetalhe(true);
  showToast(`${ids.length} teste(s) liberado(s).`, 'success');
}

// Grava a decisão (transação: só a primeira decisão vale) e seus efeitos
async function _cqAplicarDecisao(ctx, testeId, acao, comentario, opts = {}) {
  if (!_cqPodeGravar()) return false;
  const base = `${CQ_KEYS.corridas}/${ctx.u}/${ctx.mes}/${ctx.key}`;
  const decisao = { acao, comentario: comentario || '', ..._cqAssinatura(), ...(acao === 'liberado_com_violacao' ? { reautenticado: !!_cqPolitica(ctx.u).reautenticar } : {}) };
  const gravada = await window.dbTransaction(`${base}/testes/${testeId}/decisao`, cur => (cur ? undefined : decisao));
  const c = await cqCarregarCorrida(ctx.u, ctx.mes, ctx.key);
  if (!gravada || !c) {
    const d = c?.testes?.[testeId]?.decisao;
    showToast(d ? `Já avaliado por ${d.porNome}.` : 'Falha ao gravar a decisão.', 'error');
    if (!opts.semRender) _cqCorrRenderDetalhe(true);
    return false;
  }
  const ct = c.testes[testeId];
  const t = cqState.config.testes[testeId];
  const sigla = CQ_DECISAO[acao].sigla;
  const updates = {};
  Object.values(ct.niveis || {}).forEach(rk => { updates[`${CQ_KEYS.resultados}/${ctx.u}/${ctx.mes}/${testeId}/${rk}/d`] = sigla; });
  const novoStatus = _cqStatusCorrida(c);
  updates[`${base}/status`] = novoStatus;
  updates[`${base}/trilha/${_cqTk()}`] = _cqTrilhaEntry('decisao', `${t ? _cqNomeTeste(t) : testeId}: ${CQ_DECISAO[acao].label}${comentario ? ' — ' + comentario : ''}`);
  const pend = _cqResumoPendencia(c);
  updates[`${CQ_KEYS.indices}/${ctx.u}/pendentes/${ctx.key}`] = pend || null;
  const ult = (cqState.indices[ctx.u] || {}).ultimo?.[testeId];
  if (ult && ult.corridaKey === ctx.key) updates[`${CQ_KEYS.indices}/${ctx.u}/ultimo/${testeId}/decisao`] = sigla;
  const insP = ct.lr && ct.prep ? cqState.config.insumos[ct.lr] : null;
  const prepP = insP ? _cqPreparo(insP, ct.prep) : null;
  if (prepP?.situacao === 'em_avaliacao') {
    const sit = acao === 'rejeitado' ? 'reprovado' : 'liberado';
    const pb = `${CQ_KEYS.config}/insumos/${ct.lr}/preparos/${ct.prep}`;
    updates[`${pb}/situacao`] = sit;
    updates[`${pb}/avaliacao`] = { numero: c.numero, corridaKey: ctx.key, mes: ctx.mes, acao, ..._cqAssinatura() };
    updates[`${CQ_KEYS.config}/insumos/${ct.lr}/trilha/${_cqTk()}`] = _cqTrilhaEntry('edicao', `Preparo de ${_cqFmtData(prepP.data)} ${sit === 'liberado' ? 'liberado' : 'reprovado'} pela decisão da corrida ${c.numero}`);
  }

  let ncNumero = null;
  if (acao !== 'liberado' && typeof _cqNovaNC === 'function') {
    const nc = await _cqNovaNC(ctx, c, testeId, acao, comentario);
    if (nc) {
      ncNumero = nc.numero;
      const ano = nc.ano;
      updates[`${CQ_KEYS.acoes}/${ctx.u}/${ano}/${nc.id}`] = nc;
      updates[`${CQ_KEYS.indices}/${ctx.u}/ncAbertas/${nc.id}`] = { numero: nc.numero, testeId, ano, abertaEm: nc.criadoEm };
      updates[`${base}/testes/${testeId}/ncId`] = nc.id;
      updates[`${base}/testes/${testeId}/ncAno`] = ano;
    }
  }
  const ok = await window.dbUpdate(updates);
  if (!ok) showToast('A decisão foi gravada, mas houve falha ao atualizar índices. Use “Reconstruir índices” se a pendência persistir.', 'error');
  Object.values(ct.niveis || {}).forEach(rk => {
    const k = `${ctx.u}|${ctx.mes}|${testeId}`;
    const cache = _cqResCache.get(k);
    if (cache?.[rk]) cache[rk].decisao = sigla;
  });
  _cqCorrCache = null;
  if (!opts.semRender) {
    showToast(`${CQ_DECISAO[acao].label}.${ncNumero ? ` Não conformidade ${ncNumero} aberta.` : ''}`, acao === 'liberado' ? 'success' : 'error');
    _cqCorrRenderDetalhe(true);
    if (_cqSub === 'corridas') _cqCorrCarregar();
  }
  return true;
}

// ── CORREÇÃO E INVALIDAÇÃO (dado original preservado) ────────
function cqCorrigirResultado(testeId, resKey) {
  const ctx = _cqCorrAberta;
  const r = _cqResCache.get(`${ctx.u}|${ctx.mes}|${testeId}`)?.[resKey];
  const t = cqState.config.testes[testeId];
  if (!r || !t) return;
  if (r.obtido !== undefined) { _cqCorrigirQual(ctx, t, r, resKey); return; }
  const dec = _cqAnalito(t.analitoId)?.decimais ?? 2;
  _cqPrompt({
    titulo: 'Corrigir valor', subtitulo: `${_cqNomeTeste(t)} · nível ${r.nivel} · valor atual ${_cqNum(r.valor, dec)}`,
    corpo: `<div class="cq-nota">O valor original permanece registrado (RDC 978, art. 116). A avaliação do teste nesta corrida será recalculada.</div>
      <div class="form-field"><label class="field-label">Novo valor <span class="required">*</span></label><input type="text" inputmode="decimal" id="cq-corr-val" class="field-input"></div>
      <div class="form-field"><label class="field-label">Motivo <span class="required">*</span></label><textarea id="cq-corr-mot" class="field-textarea" style="min-height:60px;" placeholder="Ex.: erro de digitação — valor do equipamento 98,2"></textarea></div>`,
    confirmar: 'Corrigir',
    onConfirm: async () => {
      const v = CQEngine.parseNumero(_cqVal('cq-corr-val')), mot = _cqVal('cq-corr-mot');
      if (v === null) { showToast('Valor inválido.', 'error'); return false; }
      if (!mot) { showToast('Informe o motivo.', 'error'); return false; }
      if (v === r.valor) { showToast('O valor é igual ao atual.', 'error'); return false; }
      return _cqAlterarResultado(ctx, testeId, resKey, { tipo: 'correcao', valor: v, motivo: mot });
    },
  });
}

function _cqCorrigirQual(ctx, t, r, resKey) {
  const escala = _cqArr(_cqAnalito(t.analitoId)?.escala);
  _cqPrompt({
    titulo: 'Corrigir resultado', subtitulo: `${_cqNomeTeste(t)} · ${_cqRotuloNivel(t, r.nivel)} · atual “${r.obtido}”`,
    corpo: `<div class="cq-nota">O resultado original permanece registrado (RDC 978, art. 116). A avaliação do teste nesta corrida será recalculada.</div>
      <div class="form-field"><label class="field-label">Resultado correto <span class="required">*</span></label>
        <select id="cq-corr-val" class="field-select"><option value="">— Selecione —</option>${escala.map(e => `<option value="${_cqEsc(e)}">${_cqEsc(e)}</option>`).join('')}</select></div>
      <div class="form-field"><label class="field-label">Motivo <span class="required">*</span></label><textarea id="cq-corr-mot" class="field-textarea" style="min-height:60px;" placeholder="Ex.: leitura registrada na placa errada"></textarea></div>`,
    confirmar: 'Corrigir',
    onConfirm: async () => {
      const v = _cqVal('cq-corr-val'), mot = _cqVal('cq-corr-mot');
      if (!escala.includes(v)) { showToast('Escolha o resultado na lista.', 'error'); return false; }
      if (!mot) { showToast('Informe o motivo.', 'error'); return false; }
      if (v === r.obtido) { showToast('O resultado é igual ao atual.', 'error'); return false; }
      return _cqAlterarResultado(ctx, t.id, resKey, { tipo: 'correcao', valor: v, motivo: mot });
    },
  });
}

function cqInvalidarResultado(testeId, resKey) {
  const ctx = _cqCorrAberta;
  const t = cqState.config.testes[testeId];
  _cqPrompt({
    titulo: 'Invalidar resultado', subtitulo: t ? `${_cqNomeTeste(t)}` : '',
    corpo: `<div class="cq-nota">O resultado continua registrado, mas deixa de entrar nas estatísticas e nas regras entre corridas.</div>
      <div class="form-field"><label class="field-label">Motivo <span class="required">*</span></label><textarea id="cq-inv-mot" class="field-textarea" style="min-height:60px;" placeholder="Ex.: frasco contaminado; amostra controle trocada"></textarea></div>`,
    confirmar: 'Invalidar', perigo: true,
    onConfirm: async () => {
      const mot = _cqVal('cq-inv-mot');
      if (!mot) { showToast('Informe o motivo.', 'error'); return false; }
      return _cqAlterarResultado(ctx, testeId, resKey, { tipo: 'invalidacao', motivo: mot });
    },
  });
}

async function _cqAlterarResultado(ctx, testeId, resKey, op) {
  if (!_cqPodeGravar()) return false;
  const t = cqState.config.testes[testeId];
  const c = await cqCarregarCorrida(ctx.u, ctx.mes, ctx.key);
  const ct = c?.testes?.[testeId];
  if (!t || !ct) return false;
  if (!_cqCan('invalidar') && !(c.lancadoPorId === _cqSess().id && !ct.decisao)) { showToast('Sem permissão.', 'error'); return false; }
  const resMap = await cqCarregarResultados(ctx.u, ctx.mes, testeId, { forcar: true });
  const r = resMap[resKey];
  if (!r) return false;
  const ass = _cqAssinatura();
  const tk = _cqTk();
  const base = `${CQ_KEYS.resultados}/${ctx.u}/${ctx.mes}/${testeId}/${resKey}`;
  const updates = {};
  const novo = { ...r };
  const qual = r.obtido !== undefined;
  if (op.tipo === 'correcao' && qual) {
    novo.obtido = op.valor;
    if (r.valorOriginal === undefined) { novo.valorOriginal = r.obtido; updates[`${base}/vo`] = r.obtido; }
    updates[`${base}/q`] = op.valor;
    updates[`${base}/k/${tk}`] = { campo: 'obtido', antes: r.obtido, depois: op.valor, motivo: op.motivo, ...ass };
  } else if (op.tipo === 'correcao') {
    novo.valor = op.valor;
    if (r.valorOriginal === undefined) { novo.valorOriginal = r.valor; updates[`${base}/vo`] = r.valor; }
    novo.z = CQEngine.zScore(op.valor, r.media, r.dp);
    updates[`${base}/v`] = op.valor;
    updates[`${base}/z`] = novo.z === null ? null : CQEngine.arred(novo.z, 4);
    updates[`${base}/k/${tk}`] = { campo: 'valor', antes: r.valor, depois: op.valor, motivo: op.motivo, ...ass };
  } else {
    novo.invalidado = true;
    novo.invalidacao = { motivo: op.motivo, ...ass };
    updates[`${base}/i`] = novo.invalidacao;
  }
  // Reavalia o teste nesta corrida com os níveis válidos
  const atuais = Object.values(ct.niveis || {}).map(rk => (rk === resKey ? novo : resMap[rk])).filter(x => x && !x.invalidado);
  let av;
  if (qual) {
    const an = _cqAnalito(t.analitoId);
    av = CQEngine.avaliarCorridaQualitativa({ atual: atuais.map(x => ({ nivel: x.nivel, obtido: x.obtido, esperado: x.esperado, rotulo: _cqRotuloNivel(t, x.nivel) })),
                                              tipo: an?.tipo, escala: _cqArr(an?.escala), tolerancia: an?.toleranciaPassos });
  } else {
    const hist = await cqHistoricoTeste(ctx.u, t, ctx.key, { forcar: true });
    av = CQEngine.avaliarCorrida({ atual: atuais.map(x => ({ nivel: x.nivel, z: x.z ?? null })), historico: hist, regras: t.regras || {},
                                   opcoes: { gatilho12s: !!t.opcoesRegras?.gatilho12s } });
  }
  // Ciclo de esterilização fora da especificação continua rejeitando o teste
  if (c.ciclo && !c.ciclo.vinculo && typeof _cqEsterAplicar === 'function') av = _cqEsterAplicar(av, c.ciclo.falhas);
  atuais.forEach(x => {
    const rk = Object.entries(ct.niveis).find(([n]) => Number(n) === Number(x.nivel))?.[1];
    if (!rk) return;
    const est = av.porNivel[x.nivel]?.status || 'sem_alvo';
    updates[`${CQ_KEYS.resultados}/${ctx.u}/${ctx.mes}/${testeId}/${rk}/e`] = CQ_ESTADO_SIGLA[est];
    updates[`${CQ_KEYS.resultados}/${ctx.u}/${ctx.mes}/${testeId}/${rk}/r`] = av.porNivel[x.nivel]?.regras?.length ? av.porNivel[x.nivel].regras : null;
  });
  const cbase = `${CQ_KEYS.corridas}/${ctx.u}/${ctx.mes}/${ctx.key}`;
  const statusAntes = ct.avaliacao?.status;
  updates[`${cbase}/testes/${testeId}/avaliacao`] = { status: atuais.length ? av.status : 'sem_alvo',
    violacoes: av.violacoes.map(v => ({ regra: v.regra, severidade: v.severidade, escopo: v.escopo, niveis: v.niveis, texto: v.texto })),
    statusIndicadores: av.statusIndicadores || null };
  const dec = _cqAnalito(t.analitoId)?.decimais ?? 2;
  const txt = op.tipo === 'correcao'
    ? (qual ? `${_cqNomeTeste(t)} N${r.nivel}: resultado corrigido de “${r.obtido}” para “${op.valor}” — ${op.motivo}`
            : `${_cqNomeTeste(t)} N${r.nivel}: valor corrigido de ${_cqNum(r.valor, dec)} para ${_cqNum(op.valor, dec)} — ${op.motivo}`)
    : `${_cqNomeTeste(t)} N${r.nivel}: resultado invalidado — ${op.motivo}`;
  updates[`${cbase}/trilha/${_cqTk()}`] = _cqTrilhaEntry(op.tipo, txt + (ct.decisao ? ` (após a decisão “${CQ_DECISAO[ct.decisao.acao]?.label}”, que foi mantida)` : '') +
    (statusAntes !== av.status ? ` · avaliação: ${CQ_STATUS[statusAntes]?.label || statusAntes} → ${CQ_STATUS[av.status]?.label || av.status}` : ''));
  if (!ct.decisao) {
    const c2 = JSON.parse(JSON.stringify(c));
    c2.testes[testeId].avaliacao = { status: av.status };
    updates[`${CQ_KEYS.indices}/${ctx.u}/pendentes/${ctx.key}`] = _cqResumoPendencia(c2) || null;
  }
  const ult = (cqState.indices[ctx.u] || {}).ultimo?.[testeId];
  if (ult && ult.corridaKey === ctx.key) updates[`${CQ_KEYS.indices}/${ctx.u}/ultimo/${testeId}/status`] = av.status;
  const ok = await window.dbUpdate(updates);
  if (!ok) { showToast('Falha ao gravar.', 'error'); return false; }
  _cqResCacheInvalidar(ctx.u, ctx.mes, testeId);
  showToast(op.tipo === 'correcao' ? 'Valor corrigido; original preservado.' : 'Resultado invalidado.', 'success');
  if (ct.decisao && statusAntes !== av.status) showToast('A avaliação mudou após a decisão. Revise a decisão registrada na trilha.', 'error');
  _cqCorrRenderDetalhe(true);
  return true;
}

// ── IMPRESSÃO DA CORRIDA ─────────────────────────────────────
async function cqImprimirCorrida() {
  const ctx = _cqCorrAberta;
  if (!ctx) return;
  const c = await cqCarregarCorrida(ctx.u, ctx.mes, ctx.key);
  if (!c) return;
  const un = cqState.config.unidades[ctx.u];
  const linhas = [];
  for (const [tid, ct] of Object.entries(c.testes || {})) {
    const t = cqState.config.testes[tid];
    const nome = t ? _cqNomeTeste(t) : tid;
    if (ct.naoRealizado) { linhas.push(`<tr><td>${_cqEsc(nome)}</td><td colspan="5">Não realizado: ${_cqEsc(ct.motivo)}</td></tr>`); continue; }
    const res = await cqCarregarResultados(ctx.u, ctx.mes, tid);
    const dec = _cqAnalito(t?.analitoId)?.decimais ?? 2;
    const niveisCt = Object.entries(ct.niveis || {}).filter(([, rk]) => rk);
    niveisCt.sort(([a], [b]) => a - b).forEach(([n, rk], i, arr) => {
      const r = res[rk] || {};
      const q = r.obtido !== undefined;
      linhas.push(`<tr>${i === 0 ? `<td rowspan="${arr.length}">${_cqEsc(nome)}<br><small>${_cqEsc(_cqAnalito(t?.analitoId)?.unidadeMedida || '')}</small>${ct.lr ? `<br><small>${_cqEsc(cqState.config.insumos[ct.lr]?.nome || '')} lote ${_cqEsc(cqState.config.insumos[ct.lr]?.lote || '?')}</small>` : ''}</td>` : ''}
        <td>N${n}${q && t ? `<br><small>${_cqEsc(_cqRotuloNivel(t, n))}</small>` : ''}</td>
        <td>${q ? _cqEsc(r.obtido) : _cqNum(r.valor, dec)}${r.valorOriginal !== undefined ? ` <small>(orig. ${q ? _cqEsc(r.valorOriginal) : _cqNum(r.valorOriginal, dec)})</small>` : ''}${r.invalidado ? ' <small>(invalidado)</small>' : ''}${r.observacao ? `<br><small>${_cqEsc(r.observacao)}</small>` : ''}</td>
        <td>${q ? _cqEsc(r.esperado || '—') : r.media !== undefined ? `${_cqNum(r.media, dec)} ± ${_cqNum(r.dp, dec + 1)}` : '—'}</td><td>${r.z !== undefined && r.z !== null ? _cqNum(r.z, 2) : '—'}</td>
        ${i === 0 ? `<td rowspan="${arr.length}">${_cqEsc(CQ_STATUS[ct.avaliacao?.status]?.label || '')}${_cqArr(ct.avaliacao?.violacoes).map(v => `<br><small>${_cqEsc(v.texto)}</small>`).join('')}
          <br><b>${_cqEsc(ct.decisao ? CQ_DECISAO[ct.decisao.acao]?.label : 'Aguardando avaliação')}</b>${ct.decisao ? `<br><small>${_cqEsc(ct.decisao.porNome)} · ${_cqFmtDH(ct.decisao.em)}${ct.decisao.comentario && !ct.decisao.auto ? ' — ' + _cqEsc(ct.decisao.comentario) : ''}</small>` : ''}</td>` : ''}</tr>`);
    });
  }
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Corrida ${_cqEsc(c.numero)}</title>
  <style>@page{size:A4;margin:14mm}body{font:12px/1.4 system-ui,sans-serif;color:#111}h1{font-size:16px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:10px}
  th,td{border:1px solid #999;padding:4px 6px;vertical-align:top;text-align:left}th{background:#eee}small{color:#555}.meta{display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;margin-top:6px}</style></head>
  <body><h1>Registro de corrida de controle interno — ${_cqEsc(c.numero)}</h1>
  <div class="meta"><div><b>Unidade:</b> ${_cqEsc(un?.sigla)} — ${_cqEsc(un?.nome)}${un?.cnes ? ` (CNES ${_cqEsc(un.cnes)})` : ''}</div><div><b>Equipamento:</b> ${_cqEsc(c.ativoSnap?.nome || c.sistemaAnalitico || '')}${c.ativoSnap?.serie ? ` · S/N ${_cqEsc(c.ativoSnap.serie)}` : ''}</div>
  <div><b>Data/hora:</b> ${_cqFmtDH(c.dataHora)}</div><div><b>Executado por:</b> ${_cqEsc(c.operadorNome)}</div>
  <div><b>Lançado por:</b> ${_cqEsc(c.lancadoPorNome)} em ${_cqFmtDH(c.lancadoEm)} (estação ${_cqEsc(c.estacao || '')})</div><div><b>Situação:</b> ${_cqEsc(CQ_CORRIDA_STATUS[_cqStatusCorrida(c)]?.label)}</div>${c.observacao ? `<div style="grid-column:1/-1;"><b>Observação:</b> ${_cqEsc(c.observacao)}</div>` : ''}</div>
  ${typeof _cqEsterImpressaoHTML === 'function' ? _cqEsterImpressaoHTML(c) : ''}
  <table><thead><tr><th>Teste</th><th>Nível</th><th>Resultado</th><th>Alvo (média ± DP) / esperado</th><th>z</th><th>Avaliação / decisão</th></tr></thead><tbody>${linhas.join('')}</tbody></table>
  <p><small>Emitido em ${_cqFmtDH(_cqAgora())} por ${_cqEsc(_cqSess().nome)} · Sistema LAMIC — Controle de Qualidade v${CQ_VERSAO}</small></p>
  <script>window.onload=()=>window.print()<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { showToast('Permita pop-ups para imprimir.', 'error'); return; }
  w.document.write(html);
  w.document.close();
}
