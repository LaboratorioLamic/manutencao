// ══════════════════════════════════════════
// AGENDA DE MANUTENÇÃO
// ══════════════════════════════════════════

(function () {

  // ── Estado local da agenda ──
  let _agendaMes  = new Date().getMonth();
  let _agendaAno  = new Date().getFullYear();
  let _pickerAno  = _agendaAno;

  const MESES = [
    'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
  ];

  // ── Filtros ──
  state._ativoFiltroAgendaIdx  = null;
  state._rotinaFiltroAgendaId  = null;
  state._minhasTarefasAgenda   = false;

  // ══════════════════════════════════════════
  // FILTRO INLINE — Tipo / Setor / Categoria
  // ══════════════════════════════════════════
  window.toggleAgendaFiltroInline = function () {
    const panel = document.getElementById('agenda-filter-inline');
    const btn   = document.getElementById('btn-agenda-filtro');
    if (!panel) return;
    const abrindo = !panel.classList.contains('open');
    panel.classList.toggle('open', abrindo);
    if (btn) btn.classList.toggle('active', abrindo);
    if (abrindo) _popularSelectsAgenda();
  };

  function _popularSelectsAgenda() {
    const selTipo  = document.getElementById('agenda-filter-tipo');
    const selSetor = document.getElementById('agenda-filter-setor');
    const selCat   = document.getElementById('agenda-filter-cat');
    if (!selTipo || !selSetor || !selCat) return;

    const ativosVisiveis = (typeof _userCanSeeAtivo === 'function')
      ? state.ativos.filter(a => _userCanSeeAtivo(a))
      : state.ativos;
    const tipos    = [...new Set(state.rotinas.map(r => r.tipo).filter(Boolean))].sort();
    const setores  = [...new Set(ativosVisiveis.map(a => a.setor).filter(Boolean))].sort();
    const cats     = [...new Set(ativosVisiveis.map(a => a.categoria).filter(Boolean))].sort();

    const _rebuild = (sel, items, placeholder) => {
      const cur = sel.value;
      sel.innerHTML = `<option value="">${placeholder}</option>` +
        items.map(v => `<option value="${v}"${v === cur ? ' selected' : ''}>${v}</option>`).join('');
    };
    _rebuild(selTipo,  tipos,   'Todos');
    _rebuild(selSetor, setores, 'Todos');
    _rebuild(selCat,   cats,    'Todas');
  }

  // ══════════════════════════════════════════
  // FILTRO — Minhas Tarefas
  // ══════════════════════════════════════════
  window.toggleMinhasTarefasAgenda = function () {
    state._minhasTarefasAgenda = !state._minhasTarefasAgenda;
    const btn = document.getElementById('btn-minhas-tarefas-agenda');
    if (btn) {
      if (state._minhasTarefasAgenda) {
        btn.style.background      = 'var(--night)';
        btn.style.color           = '#fff';
        btn.style.borderColor     = 'var(--night)';
        btn.style.boxShadow       = '0 3px 10px rgba(14,22,40,0.25)';
      } else {
        btn.style.background  = '';
        btn.style.color       = '';
        btn.style.borderColor = '';
        btn.style.boxShadow   = '';
      }
    }
    renderAgendaCalendario();
  };

  // ══════════════════════════════════════════
  // FILTROS — Ativo
  // ══════════════════════════════════════════
  window.setAtivoFiltroAgenda = function (idx) {
    state._ativoFiltroAgendaIdx = (idx !== undefined) ? idx : null;
    const ativo = idx !== undefined ? state.ativos[idx] : null;
    const display = document.getElementById('ativo-selector-display-agenda');
    if (display) {
      if (ativo) {
        display.innerHTML = `<div class="ativo-selecionado-chip" onclick="limparAtivoFiltroAgenda()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><path d="M20 16V7a2 2 0 00-2-2H6a2 2 0 00-2 2v9"/></svg>
          ${ativo.nome}
          <span class="chip-x" title="Limpar">&times;</span>
        </div>`;
      } else {
        display.innerHTML = `<button class="btn-select-ativo" onclick="openAtivoSelectorCtx('agenda')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Filtrar por Ativo
        </button>`;
      }
    }
    _updateRotinaFiltroAgendaWrap();
    renderAgendaCalendario();
    closeModal('modal-ativo-selector');
  };

  window.limparAtivoFiltroAgenda = function () {
    state._rotinaFiltroAgendaId = null;
    _updateRotinaFiltroAgendaDisplay();
    setAtivoFiltroAgenda(undefined);
  };

  // ── Filtros — Rotina ──
  function _updateRotinaFiltroAgendaWrap() {
    const wrap = document.getElementById('rotina-filter-agenda-wrap');
    if (!wrap) return;
    const hasAtivo = (state._ativoFiltroAgendaIdx ?? null) !== null;
    wrap.style.display = hasAtivo ? '' : 'none';
    if (!hasAtivo) {
      state._rotinaFiltroAgendaId = null;
      _updateRotinaFiltroAgendaDisplay();
    }
  }

  function _updateRotinaFiltroAgendaDisplay() {
    const wrap = document.getElementById('rotina-filter-agenda-wrap');
    if (!wrap) return;
    const rotinaId = state._rotinaFiltroAgendaId ?? null;
    if (rotinaId) {
      const rotina = state.rotinas.find(r => r.id === rotinaId);
      wrap.innerHTML = `<div class="ativo-selecionado-chip" onclick="limparRotinaFiltroAgenda()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        ${rotina?.nome || 'Rotina'}
        <span class="chip-x" title="Limpar">&times;</span>
      </div>`;
    } else {
      wrap.innerHTML = `<button class="btn-select-ativo" id="btn-filtrar-rotina-agenda" onclick="openRotinaSelectorCtx('agenda')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>
        Filtrar por Rotina
      </button>`;
    }
  }

  window.setRotinaFiltroAgenda = function (rotinaId) {
    state._rotinaFiltroAgendaId = rotinaId ?? null;
    _updateRotinaFiltroAgendaDisplay();
    renderAgendaCalendario();
    closeModal('modal-rotina-selector-agenda');
  };

  window.limparRotinaFiltroAgenda = function () {
    setRotinaFiltroAgenda(null);
  };

  // ══════════════════════════════════════════
  // CÁLCULO DE DATAS FUTURAS
  // ══════════════════════════════════════════

  // Avança uma data pelo intervalo da tarefa, pulando domingo (dia 0)
  function _nextDate(dateStr, tarefa) {
    if (!dateStr || !tarefa) return null;
    if (tarefa.frequencia === 'Sempre') return null;

    const n = parseInt(tarefa.fazerCada) || 1;
    const d = new Date(dateStr + 'T12:00:00');

    if (tarefa.frequencia === 'DiaDaSemana') {
      // Próximo dia da semana selecionado
      const dias = (tarefa.diasSemana || []).filter(x => x !== 0).sort((a, b) => a - b);
      if (dias.length === 0) return null;
      for (let i = 1; i <= 7; i++) {
        const probe = new Date(d);
        probe.setDate(d.getDate() + i);
        if (dias.includes(probe.getDay())) return probe.toISOString().split('T')[0];
      }
      return null;
    }

    switch (tarefa.frequencia) {
      case 'Dia':    d.setDate(d.getDate() + n); break;
      case 'Semana': d.setDate(d.getDate() + n * 7); break;
      case 'Meses':  d.setMonth(d.getMonth() + n); break;
      case 'Anos':   d.setFullYear(d.getFullYear() + n); break;
      default: return null;
    }

    // Evitar domingo: avança até segunda
    while (d.getDay() === 0) d.setDate(d.getDate() + 1);

    return d.toISOString().split('T')[0];
  }

  // Gera todas as datas futuras projetadas de uma tarefa dentro de um intervalo
  function _projetarDatas(tarefa, dataInicioStr, dataFimStr) {
    const datas = [];
    if (tarefa.status === 'Inativo') return datas;
    if (tarefa.frequencia === 'Sempre') return datas;

    // Ponto de partida: proximaData se existir, senão dataTarefa
    let base = tarefa.proximaData || tarefa.dataTarefa;
    if (!base) return datas;

    const inicio = new Date(dataInicioStr + 'T00:00:00');
    const fim    = new Date(dataFimStr    + 'T23:59:59');

    // Limite de segurança para evitar loop infinito
    const MAX_ITER = 500;
    let iter = 0;

    // Se a base for muito anterior ao início, avançar rapidamente
    let bDate = new Date(base + 'T12:00:00');
    while (bDate < inicio && iter < MAX_ITER) {
      const next = _nextDate(base, tarefa);
      if (!next || next === base) break;
      base = next;
      bDate = new Date(base + 'T12:00:00');
      iter++;
    }

    iter = 0;
    // Coletar datas dentro do intervalo
    while (iter < MAX_ITER) {
      const d = new Date(base + 'T12:00:00');
      if (d > fim) break;
      if (d >= inicio) datas.push(base);

      // Verificar limite de repetições
      if (tarefa.repetir === 'Por') {
        const nPubs = state.publicacoes.filter(p => p.tarefaId === tarefa.id).length;
        const nProj = datas.length;
        if (nPubs + nProj >= (tarefa.vezes || 1)) break;
      }

      const next = _nextDate(base, tarefa);
      if (!next || next === base) break;
      base = next;
      iter++;
    }

    return datas;
  }

  // ══════════════════════════════════════════
  // VISIBILIDADE POR PERMISSÃO
  // ══════════════════════════════════════════
  function _tarefaVisivel(t) {
    if (typeof _userCanSeeAtivo === 'function') {
      const ativo = state.ativos[t.equipamentoIdx];
      if (!ativo || !_userCanSeeAtivo(ativo)) return false;
    }
    return true;
  }

  // ══════════════════════════════════════════
  // MONTA ÍNDICE DE EVENTOS POR DATA
  // ══════════════════════════════════════════
  // Retorna { 'YYYY-MM-DD': [ { tarefa, tipo:'publicada'|'pendente', pub? } ] }
  function _buildEventosDoMes(ano, mes) {
    const fAtivoIdx  = state._ativoFiltroAgendaIdx ?? null;
    const fRotinaId  = state._rotinaFiltroAgendaId  ?? null;

    // Primeiro e último dia do mês
    const primeiroDia = `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
    const ultimoDia   = new Date(ano, mes + 1, 0);
    const ultimoDiaStr = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(ultimoDia.getDate()).padStart(2, '0')}`;

    const eventos = {};

    const minhasTarefas = state._minhasTarefasAgenda;
    const sessao = minhasTarefas && (typeof authGetCurrentUser === 'function') ? authGetCurrentUser() : null;

    const fTipo  = document.getElementById('agenda-filter-tipo')?.value  || '';
    const fSetor = document.getElementById('agenda-filter-setor')?.value || '';
    const fCat   = document.getElementById('agenda-filter-cat')?.value   || '';

    const tarefasFiltradas = state.tarefas.filter(t => {
      if (!_tarefaVisivel(t)) return false;
      if (fAtivoIdx !== null && t.equipamentoIdx !== fAtivoIdx) return false;
      if (fRotinaId !== null && t.rotinaId !== fRotinaId) return false;
      if (sessao) {
        const resp = t.responsaveis || { usuarios: [], grupos: [] };
        const temUsuario = resp.usuarios.includes(sessao.userId);
        const temGrupo   = sessao.grupoId && resp.grupos.includes(sessao.grupoId);
        if (!temUsuario && !temGrupo) return false;
      }
      if (fTipo || fSetor || fCat) {
        const rotina = state.rotinas.find(r => r.id === t.rotinaId);
        const ativo  = state.ativos[t.equipamentoIdx];
        if (fTipo  && rotina?.tipo       !== fTipo)  return false;
        if (fSetor && ativo?.setor       !== fSetor) return false;
        if (fCat   && ativo?.categoria   !== fCat)   return false;
      }
      return true;
    });

    function addEvento(dateStr, obj) {
      if (!eventos[dateStr]) eventos[dateStr] = [];
      eventos[dateStr].push(obj);
    }

    tarefasFiltradas.forEach(tarefa => {
      // 1. Atividades publicadas neste mês
      state.publicacoes
        .filter(p => p.tarefaId === tarefa.id)
        .forEach(pub => {
          const d = (pub.dataRealizada || pub.dataPublicacao || '').split('T')[0];
          if (d >= primeiroDia && d <= ultimoDiaStr) {
            addEvento(d, { tarefa, tipo: 'publicada', pub });
          }
        });

      // 2. Projeção futura (apenas tarefas ativas)
      if (tarefa.status !== 'Inativo') {
        const datas = _projetarDatas(tarefa, primeiroDia, ultimoDiaStr);
        datas.forEach(d => {
          // Não duplicar se já há publicação nesta data
          const jaPublicada = (eventos[d] || []).some(ev => ev.tarefa.id === tarefa.id && ev.tipo === 'publicada');
          if (!jaPublicada) {
            addEvento(d, { tarefa, tipo: 'pendente' });
          }
        });
      }
    });

    return eventos;
  }

  // ══════════════════════════════════════════
  // RENDERIZAR CALENDÁRIO
  // ══════════════════════════════════════════
  window.agendaNavMes = function (delta) {
    _agendaMes += delta;
    if (_agendaMes > 11) { _agendaMes = 0;  _agendaAno++; }
    if (_agendaMes < 0)  { _agendaMes = 11; _agendaAno--; }
    renderAgendaCalendario();
  };

  window.renderAgendaCalendario = function () {
    const labelEl = document.getElementById('agenda-mes-label');
    const gridEl  = document.getElementById('agenda-grid');
    if (!labelEl || !gridEl) return;

    labelEl.textContent = `${MESES[_agendaMes]} ${_agendaAno}`;

    const eventos = _buildEventosDoMes(_agendaAno, _agendaMes);

    // Dia da semana do 1º dia (0=Dom)
    const primeiroDiaSemana = new Date(_agendaAno, _agendaMes, 1).getDay();
    const diasNoMes = new Date(_agendaAno, _agendaMes + 1, 0).getDate();

    const hoje = new Date();
    const hojeStr = hoje.toISOString().split('T')[0];

    let cells = '';

    // Células vazias antes do dia 1
    for (let i = 0; i < primeiroDiaSemana; i++) {
      cells += `<div class="agenda-cell agenda-cell-vazio"></div>`;
    }

    for (let dia = 1; dia <= diasNoMes; dia++) {
      const dateStr = `${_agendaAno}-${String(_agendaMes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      const evs = eventos[dateStr] || [];
      const isHoje = dateStr === hojeStr;
      const isDom  = new Date(_agendaAno, _agendaMes, dia).getDay() === 0;

      // Agrupa por ativo para exibição compacta
      const porAtivo = {};
      evs.forEach(ev => {
        const key = ev.tarefa.equipamentoIdx;
        if (!porAtivo[key]) porAtivo[key] = { ativoIdx: key, total: 0, temPublicada: false, temPendente: false };
        porAtivo[key].total++;
        if (ev.tipo === 'publicada') porAtivo[key].temPublicada = true;
        else porAtivo[key].temPendente = true;
      });

      const ativos = Object.values(porAtivo);
      const MAX_CHIPS = 2;
      const chipsHtml = ativos.slice(0, MAX_CHIPS).map(a => {
        const ativo = state.ativos[a.ativoIdx];
        const nome  = ativo?.nome || '—';
        let cls = 'agenda-chip';
        if (a.temPendente && a.temPublicada) cls += ' agenda-chip-misto';
        else if (a.temPublicada) cls += ' agenda-chip-ok';
        else cls += ' agenda-chip-pend';
        return `<div class="${cls}" title="${nome}">${nome} <span class="agenda-chip-count">${a.total}</span></div>`;
      }).join('');

      const extra = ativos.length > MAX_CHIPS
        ? `<div class="agenda-chip-extra">+${ativos.length - MAX_CHIPS}</div>`
        : '';

      cells += `<div class="agenda-cell${isHoje ? ' agenda-cell-hoje' : ''}${isDom ? ' agenda-cell-dom' : ''}${evs.length ? ' agenda-cell-com-ev' : ''}"
        onclick="abrirAgendaDia('${dateStr}')">
        <div class="agenda-cell-num">${dia}</div>
        <div class="agenda-cell-chips">${chipsHtml}${extra}</div>
      </div>`;
    }

    gridEl.innerHTML = cells;
  };

  // ══════════════════════════════════════════
  // PICKER DE MÊS/ANO
  // ══════════════════════════════════════════
  window.agendaAbrirMesPicker = function () {
    _pickerAno = _agendaAno;
    _renderPickerMeses();
    document.getElementById('agenda-picker-ano').textContent = _pickerAno;
    document.getElementById('agenda-picker-popup').style.display   = '';
    document.getElementById('agenda-picker-backdrop').style.display = '';
  };

  window.agendaFecharMesPicker = function () {
    document.getElementById('agenda-picker-popup').style.display   = 'none';
    document.getElementById('agenda-picker-backdrop').style.display = 'none';
  };

  window.agendaPickerNavAno = function (delta) {
    _pickerAno += delta;
    document.getElementById('agenda-picker-ano').textContent = _pickerAno;
    _renderPickerMeses();
  };

  function _renderPickerMeses() {
    const el = document.getElementById('agenda-picker-meses');
    if (!el) return;
    el.innerHTML = MESES.map((m, i) => {
      const ativo = i === _agendaMes && _pickerAno === _agendaAno;
      return `<button class="agenda-picker-mes${ativo ? ' ativo' : ''}" onclick="agendaPickerSelecionarMes(${i})">${m.slice(0, 3)}</button>`;
    }).join('');
  }

  window.agendaPickerSelecionarMes = function (mes) {
    _agendaMes = mes;
    _agendaAno = _pickerAno;
    agendaFecharMesPicker();
    renderAgendaCalendario();
  };

  // ══════════════════════════════════════════
  // MODAL DETALHE DO DIA
  // ══════════════════════════════════════════
  function _flagHtml(tarefa) {
    const f = getTaskFlag(tarefa);
    const icons = {
      'flag-danger':   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
      'flag-warning':  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px;"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
      'flag-ok':       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px;"><polyline points="20 6 9 17 4 12"/></svg>`,
      'flag-inactive': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px;"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
    };
    return `<span class="task-flag ${f.cls}">${icons[f.cls] || ''}${f.label}</span>`;
  }

  window.abrirAgendaDia = function (dateStr) {
    const fAtivoIdx  = state._ativoFiltroAgendaIdx ?? null;
    const fRotinaId  = state._rotinaFiltroAgendaId  ?? null;

    // Coleta eventos do dia (re-usa a lógica do mês mas filtra pelo dia)
    const evs = _buildEventosDoMes(_agendaAno, _agendaMes)[dateStr] || [];

    const [y, m, d] = dateStr.split('-');
    const data = new Date(Number(y), Number(m) - 1, Number(d));
    const diasSemana = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

    document.getElementById('agenda-dia-titulo').textContent =
      `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
    document.getElementById('agenda-dia-subtitulo').textContent =
      diasSemana[data.getDay()];

    const content = document.getElementById('agenda-dia-content');

    if (evs.length === 0) {
      content.innerHTML = `<div class="data-table-empty" style="padding:32px 0;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <strong>Nenhuma tarefa neste dia</strong>
      </div>`;
    } else {
      // Separar publicadas e pendentes
      const publicadas = evs.filter(ev => ev.tipo === 'publicada');
      const pendentes  = evs.filter(ev => ev.tipo === 'pendente');

      let html = '';

      if (publicadas.length) {
        html += `<div class="agenda-dia-secao-titulo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
          Atividades Concluídas (${publicadas.length})
        </div>`;
        html += _renderTabelaDia(publicadas, 'publicada');
      }

      if (pendentes.length) {
        html += `<div class="agenda-dia-secao-titulo" style="margin-top:${publicadas.length ? '20px' : '0'};">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Tarefas Pendentes / Projetadas (${pendentes.length})
        </div>`;
        html += _renderTabelaDia(pendentes, 'pendente');
      }

      content.innerHTML = html;
    }

    openModal('modal-agenda-dia');
  };

  function _renderTabelaDia(evs, tipo) {
    const canPublicar = typeof _can === 'function' ? _can('tarefas.publicar') : true;

    const rows = evs.map(ev => {
      const { tarefa, pub } = ev;
      const rotina = state.rotinas.find(r => r.id === tarefa.rotinaId);
      const ativo  = state.ativos[tarefa.equipamentoIdx];

      const nomeAtivo   = ativo?.nome   || '—';
      const codigoAtivo = ativo?.codigo || '';
      const nomeRotina  = rotina?.nome  || '—';
      const tipoRotina  = rotina?.tipo  || '';
      const prazo       = tarefa.proximaData ? formatDate(tarefa.proximaData) : (tarefa.dataTarefa ? formatDate(tarefa.dataTarefa) : '—');
      const lembrete    = tarefa.lembrete ? `${tarefa.lembrete}d` : '—';
      const flagHtml    = _flagHtml(tarefa);

      let acaoHtml = '';
      if (tipo === 'publicada' && pub) {
        const dataReal = typeof formatDataRealizadaHtml === 'function'
          ? formatDataRealizadaHtml(pub.dataRealizada)
          : formatDate(pub.dataRealizada || '');
        const pubPor = pub.publicadoPorNome || pub.publicadoPorId || '—';
        acaoHtml = `<button class="btn btn-outline" style="font-size:11px;padding:4px 10px;"
          onclick="viewPublicacaoFromAgenda('${pub.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Ver
        </button>`;
        return `<tr onclick="viewPublicacaoFromAgenda('${pub.id}')" style="cursor:pointer;">
          <td><div style="font-weight:600;font-size:12.5px;">${nomeAtivo}</div><div style="font-size:10.5px;color:var(--text-muted);font-family:'DM Mono',monospace;">${codigoAtivo}</div></td>
          <td><div style="font-size:12.5px;">${nomeRotina}</div><div style="font-size:10.5px;color:var(--text-muted);">${tipoRotina}</div></td>
          <td style="font-size:12.5px;">${tarefa.titulo || '—'}</td>
          <td style="font-size:12px;">${dataReal}</td>
          <td style="font-size:12px;color:var(--text-muted);">${pubPor}</td>
          <td></td>
          <td onclick="event.stopPropagation()">${acaoHtml}</td>
        </tr>`;
      } else {
        // Pendente/projetada
        if (canPublicar && tarefa.status === 'Ativo') {
          acaoHtml = `<button class="btn btn-primary" style="font-size:11px;padding:4px 10px;"
            onclick="_agendaAbrirPublicar('${tarefa.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
            Publicar
          </button>`;
        } else {
          acaoHtml = `<button class="btn btn-outline" style="font-size:11px;padding:4px 10px;"
            onclick="closeAgendaDiaModal();openTarefaDetalhe('${tarefa.id}')">
            Ver
          </button>`;
        }
        return `<tr onclick="closeAgendaDiaModal();openTarefaDetalhe('${tarefa.id}')" style="cursor:pointer;">
          <td><div style="font-weight:600;font-size:12.5px;">${nomeAtivo}</div><div style="font-size:10.5px;color:var(--text-muted);font-family:'DM Mono',monospace;">${codigoAtivo}</div></td>
          <td><div style="font-size:12.5px;">${nomeRotina}</div><div style="font-size:10.5px;color:var(--text-muted);">${tipoRotina}</div></td>
          <td style="font-size:12.5px;">${tarefa.titulo || '—'}</td>
          <td style="font-size:12.5px;">${prazo}</td>
          <td style="font-size:12px;">${lembrete}</td>
          <td>${flagHtml}</td>
          <td onclick="event.stopPropagation()">${acaoHtml}</td>
        </tr>`;
      }
    }).join('');

    const isPub = tipo === 'publicada';
    const col4  = isPub ? 'Realizado em' : 'Prazo';
    const col5  = isPub ? 'Por' : 'Lembrete';

    return `<div class="data-table-wrapper" style="margin-bottom:4px;overflow-x:auto;">
      <div class="atividades-table-scroll" style="overflow-x:visible;">
        <table class="data-table" style="min-width:600px;">
          <thead>
            <tr>
              <th>Ativo</th>
              <th>Rotina</th>
              <th>Atividade</th>
              <th>${col4}</th>
              <th>${col5}</th>
              <th>Flag</th>
              <th style="width:80px;"></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }

  window.closeAgendaDiaModal = function () {
    closeModal('modal-agenda-dia');
  };

  window._agendaAbrirPublicar = function (tarefaId) {
    closeAgendaDiaModal();
    openPublicarModalDireto(tarefaId);
  };

  // Atualiza o calendário sempre que refreshTaskFlagsUI for chamado com a agenda ativa
  window._agendaRefreshHook = function () {
    if (document.getElementById('rpanel-agenda')?.classList.contains('active')) {
      renderAgendaCalendario();
    }
  };

})();

