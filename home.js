// ═══════════════════════════════════════════════════════════════
// home.js — Dashboard KPI Principal — Manutenção LAMIC
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── ESTADO ───────────────────────────────────────────────────
  const _MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  let _hf = {
    modo:        'geral',   // 'geral' | 'ano' | 'mes' | 'custom'
    dataInicio:  '',
    dataFim:     '',
    mesSel:      null,    // mês selecionado no picker (1-12)
    anoSel:      null,    // ano selecionado no picker de mês
    pickerNavAno:null,    // ano exibido na grade de meses (navegação)
    anoPicker:   null,    // ano selecionado no picker de ano
  };
  let _activeNotifTab = 'tarefas';
  let _homeOnlyMine   = false;
  let _hupMinhas = false; // toggle "Minhas Execuções" no card de últimas publicações
  let _hupPage   = 0;    // página atual das publicações (5 por página)
  let _falhaTabByAtivo = {}; // { [ativoKey]: 'falha'|'causa'|'deteccao'|'dano' }
  let _falhaPage = 0;        // página atual do bloco "OTs de Ativos com Falha" (3 por página)
  const KPI_CARDS_PER_PAGE = 6;
  let _kpiCardPage = 0;      // página atual do modal de cards KPI (ativosEmUso / ativosParados)
  let _kpiCardTipo = '';     // tipo do KPI aberto atualmente no modal

  // ── HELPERS DE DATA ──────────────────────────────────────────
  function _initPeriodo(modo) {
    const hoje = new Date();
    if (modo) _hf.modo = modo;

    if (_hf.modo === 'geral') {
      _hf.dataInicio = '';
      _hf.dataFim    = '';

    } else if (_hf.modo === 'ano') {
      const ano = _hf.anoPicker || hoje.getFullYear();
      _hf.dataInicio = `${ano}-01-01`;
      _hf.dataFim    = ano === hoje.getFullYear()
        ? hoje.toISOString().split('T')[0]
        : `${ano}-12-31`;

    } else if (_hf.modo === 'mes') {
      const mes = _hf.mesSel  || (hoje.getMonth() + 1);
      const ano = _hf.anoSel  || hoje.getFullYear();
      const m   = String(mes).padStart(2, '0');
      const y   = String(ano);
      _hf.dataInicio = `${y}-${m}-01`;
      const ultimo   = new Date(ano, mes, 0).getDate();
      const fim      = `${y}-${m}-${String(ultimo).padStart(2,'0')}`;
      const hojeSt   = hoje.toISOString().split('T')[0];
      _hf.dataFim    = fim > hojeSt ? hojeSt : fim;

    } else if (_hf.modo === 'custom' && (!_hf.dataInicio || !_hf.dataFim)) {
      const inicio = new Date(); inicio.setDate(hoje.getDate() - 30);
      _hf.dataInicio = inicio.toISOString().split('T')[0];
      _hf.dataFim    = hoje.toISOString().split('T')[0];
    }
  }

  function _modoLabel() {
    if (_hf.modo === 'geral')  return 'Geral';
    if (_hf.modo === 'custom') return 'Personalizado';
    if (_hf.modo === 'ano') {
      const ano = _hf.anoPicker || new Date().getFullYear();
      return `${ano}`;
    }
    if (_hf.modo === 'mes') {
      const mes = _hf.mesSel || new Date().getMonth() + 1;
      const ano = _hf.anoSel || new Date().getFullYear();
      return `${_MESES[mes - 1]} ${ano}`;
    }
    return 'Período';
  }

  // ── HELPERS DE ACESSO AO ESTADO ──────────────────────────────
  function _setores() {
    return (typeof _getFilteredSetores === 'function')
      ? _getFilteredSetores()
      : (state?.setores || []);
  }

  function _otSetor(ot) {
    if (ot.ativoIdx != null && typeof state !== 'undefined') {
      const a = state.ativos[ot.ativoIdx];
      if (a?.setor) return a.setor;
    }
    return ot.setor || '';
  }

  function _tarefaSetor(t) {
    if (t.equipamentoIdx != null && typeof state !== 'undefined') {
      return state.ativos[t.equipamentoIdx]?.setor || '';
    }
    const rotina = state?.rotinas?.find(r => r.id === t.rotinaId);
    if (!rotina) return '';
    if (rotina.setor) return rotina.setor;
    if (rotina.equipamentoIdx != null) return state?.ativos[rotina.equipamentoIdx]?.setor || '';
    return '';
  }

  function _inSetor(setor) {
    const s = _setores();
    return !setor || s.includes(setor);
  }

  function _inPeriod(dateStr) {
    if (!dateStr || !_hf.dataInicio || !_hf.dataFim) return true;
    const d = (dateStr + '').split('T')[0];
    return d >= _hf.dataInicio && d <= _hf.dataFim;
  }

  function _hoje() {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }

  // ── CÁLCULO DE KPIs ─────────────────────────────────────────
  function calcKPIs() {
    const hoje = _hoje();
    const ordens      = (typeof otState !== 'undefined' ? otState.ordens : []) || [];
    const ativos      = state?.ativos      || [];
    const rotinas     = state?.rotinas     || [];
    const tarefas     = state?.tarefas     || [];
    const publicacoes = state?.publicacoes || [];

    // Filtro "Meus itens": restringe OTs, tarefas e pubs ao responsável logado
    const _sess = typeof currentSession !== 'undefined' ? currentSession : null;
    const _uid  = _sess?.userId;
    const _gid  = _sess?.grupoId;
    function _isMine_ot(o) {
      return o.responsavelId === _uid;
    }
    function _isMine_tarefa(t) {
      const resp = t.responsaveis || { usuarios: [], grupos: [] };
      return resp.usuarios.includes(_uid) || (_gid && resp.grupos.includes(_gid));
    }
    function _isMine_pub(p) {
      return p.publicadoPorId === _uid;
    }

    const ordensVis   = ordens.filter(o => _inSetor(_otSetor(o)) && (!_homeOnlyMine || !_uid || _isMine_ot(o)));
    const ativosVis   = ativos.filter(a => _inSetor(a.setor));  // ativos: sem filtro por responsável
    const rotinasVis  = rotinas.filter(r => {
      const setor = r.setor || (r.equipamentoIdx != null ? ativos[r.equipamentoIdx]?.setor : '') || '';
      return _inSetor(setor);
    });
    const tarefasVis  = tarefas.filter(t => _inSetor(_tarefaSetor(t)) && (!_homeOnlyMine || !_uid || _isMine_tarefa(t)));
    const tarefasIds  = new Set(tarefasVis.map(t => t.id));
    const pubsVis     = publicacoes.filter(p => tarefasIds.has(p.tarefaId) && (!_homeOnlyMine || !_uid || _isMine_pub(p)));

    // OT counts
    const otByStatus = { pendente: 0, em_processo: 0, em_revisao: 0, concluida: 0, cancelada: 0 };
    ordensVis.forEach(o => { if (otByStatus[o.status] !== undefined) otByStatus[o.status]++; });

    const otConcluidas = ordensVis.filter(o => o.status === 'concluida' && _inPeriod(o.criadoEm)).length;
    const otsFalhaList = ordensVis.filter(o => o.tipo === 'corretiva' && o.ativoFalhou && _inPeriod(o.criadoEm));
    const otsFalhaTotal = otsFalhaList.length;

    const otByTipo = { corretiva: 0, implantacao: 0, melhoria: 0, alteracao: 0 };
    ordensVis.forEach(o => { if (otByTipo[o.tipo] !== undefined) otByTipo[o.tipo]++; });

    const otBySev = { critica: 0, alta: 0, media: 0, baixa: 0 };
    ordensVis.forEach(o => { if (otBySev[o.severidade] !== undefined) otBySev[o.severidade]++; });

    // Tarefas
    const tarefasAtrasadas = tarefasVis.filter(t =>
      t.status === 'Ativo' && t.proximaData &&
      new Date(t.proximaData + 'T00:00:00') < hoje
    );
    const tarefasProximas = tarefasVis.filter(t => {
      if (t.status !== 'Ativo' || !t.proximaData) return false;
      const due  = new Date(t.proximaData + 'T00:00:00');
      const diff = Math.ceil((due - hoje) / 86400000);
      return diff >= 0 && t.lembrete !== null && t.lembrete !== undefined && diff <= t.lembrete;
    });

    // Publicações — campo "tipo" pode não existir em registros antigos;
    // publicação de execução é qualquer pub sem tipo='notificacao'
    const pubsPeriodo  = pubsVis.filter(p => _inPeriod(p.dataPublicacao));
    const execsPeriodo = pubsPeriodo.filter(p => !p.tipo || p.tipo === 'execucao');

    // % cumprimento
    const tarefasVencPeriodo = tarefasVis.filter(t =>
      t.proximaData && _inPeriod(t.proximaData) && t.status === 'Ativo'
    );
    const base = tarefasVencPeriodo.length + execsPeriodo.length;
    const pctCumprimento = base > 0 ? Math.min(100, Math.round((execsPeriodo.length / base) * 100)) : 0;

    // OTs corretivas abertas
    const otCorretivas = ordensVis.filter(o =>
      o.tipo === 'corretiva' && !['concluida', 'cancelada'].includes(o.status)
    ).length;

    // OTs de Serviço Abertas: abertas, não corretivas
    const otsServicoList = ordensVis.filter(o =>
      o.tipo !== 'corretiva' && !['concluida', 'cancelada'].includes(o.status)
    );
    const otsServico = otsServicoList.length;

    // OTs com Atraso: abertas (não finalizadas) com prazo vencido
    const hoje2 = _hoje();
    const otsAtrasoList = ordensVis.filter(o => {
      if (['concluida', 'cancelada'].includes(o.status)) return false;
      if (!o.prazo) return false;
      const d = new Date(o.prazo + 'T00:00:00');
      return d < hoje2;
    });
    const otsAtraso = otsAtrasoList.length;

    // OTs críticas abertas (para painel)
    const otCriticasAbertas = ordensVis.filter(o =>
      o.severidade === 'critica' && !['concluida', 'cancelada'].includes(o.status)
    );

    // Tarefas por tipo de rotina
    const tiposRotina = state?.tiposRotina || ['Preventivo', 'Rotina'];
    const tarefasByTipo = {};
    tiposRotina.forEach(tipo => {
      const rIds = new Set(rotinasVis.filter(r => r.tipo === tipo).map(r => r.id));
      tarefasByTipo[tipo] = tarefasVis.filter(t => rIds.has(t.rotinaId)).length;
    });

    // Ativos parados (statusUso === 'em_pausa') no setor filtrado
    const ativosParados = ativosVis.filter(a => a.statusUso === 'em_pausa');
    // Ativos em uso: exclui pausados E em desuso
    const ativosEmUsoFiltered = ativosVis.filter(a => a.statusUso !== 'em_pausa' && a.statusUso !== 'em_desuso');

    // OTs corretivas com dados de falha, agrupadas por ativo (respeitando filtro de período)
    // Inclui qualquer OT corretiva que tenha ao menos um campo de falha preenchido
    const otsComFalha = ordensVis.filter(o =>
      o.tipo === 'corretiva' &&
      _inPeriod(o.criadoEm) &&
      (o.tipoFalha || o.causaRaiz || o.metodoDetec || o.tipoDano)
    );
    const otsFalhaByAtivo = {};
    otsComFalha.forEach(o => {
      const ativoIdx = o.ativoIdx !== null && o.ativoIdx !== undefined ? Number(o.ativoIdx) : null;
      const ativo = ativoIdx !== null ? state?.ativos[ativoIdx] : null;
      const key = ativo ? String(ativoIdx) : '__sem_ativo__';
      const nome = ativo ? ativo.nome : 'Sem ativo';
      if (!otsFalhaByAtivo[key]) otsFalhaByAtivo[key] = { nome, ots: [] };
      otsFalhaByAtivo[key].ots.push(o);
    });

    return {
      otEmProcesso:  otByStatus.em_processo,
      otEmRevisao:   otByStatus.em_revisao,
      otsServico, otsServicoList,
      otsAtraso, otsAtrasoList,
      otConcluidas,
      otsFalhaTotal, otsFalhaList,
      tarefasAtrasadas: tarefasAtrasadas.length,
      tarefasConcluidas: execsPeriodo.length,
      otCorretivas,
      rotinasAtivas: rotinasVis.filter(r => r.status === 'Ativo').length,
      rotinasAtivasList: rotinasVis.filter(r => r.status === 'Ativo'),
      totalAtivos:   ativosVis.length,
      ativosEmUso:   ativosEmUsoFiltered.length,
      ativosEmUsoList: ativosEmUsoFiltered,
      ativosParados: ativosParados.length,
      ativosParadosList: ativosParados,
      pctCumprimento,
      execsPeriodo:  execsPeriodo.length,
      execsPeriodoList: execsPeriodo,
      otByStatus, otByTipo, otBySev, tarefasByTipo,
      otPorMes: _calcOtsPorMes(ordensVis),
      totalOTs: ordensVis.length,
      otsFalhaByAtivo,
      tarefasAtrasadasList: tarefasAtrasadas,
      tarefasProximasList:  tarefasProximas,
      otCriticasAbertas,
      ordensVis,
      tarefasVisList: tarefasVis,
    };
  }

  function _calcOtsPorMes(ordens) {
    const hoje = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - (5 - i), 1);
      const label = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
      const count = ordens.filter(o => {
        if (!o.criadoEm) return false;
        const od = new Date(o.criadoEm);
        return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth();
      }).length;
      return { label, count };
    });
  }

  // ── GRÁFICOS SVG ─────────────────────────────────────────────
  function f(n) { return Number(n).toFixed(2); }

  function _donutChart(segments, size) {
    size = size || 130;
    const cx = size / 2, cy = size / 2;
    const r  = size * 0.32;
    const sw = size * 0.17;
    const C  = 2 * Math.PI * r;
    const total = segments.reduce((s, sg) => s + sg.value, 0);

    if (total === 0) {
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e8edf2" stroke-width="${sw}"/>
      </svg>`;
    }

    let offset = 0;
    const arcs = segments.map(sg => {
      const dash = (sg.value / total) * C;
      const el = `<circle cx="${cx}" cy="${cy}" r="${r}"
        fill="none" stroke="${sg.color}" stroke-width="${sw}"
        stroke-dasharray="${f(Math.max(0, dash - 1.5))} ${f(Math.max(0, C - dash + 1.5))}"
        stroke-dashoffset="${f(-offset)}"/>`;
      offset += dash;
      return el;
    }).join('');

    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
      style="transform:rotate(-90deg);display:block;">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f0f4f8" stroke-width="${sw}"/>
      ${arcs}
    </svg>`;
  }

  function _gaugeChart(value, size) {
    size = size || 148;
    const r  = size * 0.37;
    const sw = r * 0.21;
    const cx = size / 2;
    const cy = r + sw * 0.6 + 2;

    const p   = Math.min(1, Math.max(0, value / 100));
    const clr = value >= 80 ? '#2a9d8f' : value >= 50 ? '#f4a261' : '#e63946';

    const bgPath = `M ${f(cx - r)} ${f(cy)} A ${f(r)} ${f(r)} 0 0 0 ${f(cx + r)} ${f(cy)}`;
    const endAngle = Math.PI * (1 - p);
    const ex = cx + r * Math.cos(endAngle);
    const ey = cy - r * Math.sin(endAngle);
    const fillPath = p <= 0 ? ''
      : `M ${f(cx - r)} ${f(cy)} A ${f(r)} ${f(r)} 0 ${p >= 1 ? 1 : 0} 0 ${f(ex)} ${f(ey)}`;

    return `
      <div class="home-gauge-wrap">
        <svg width="${size}" height="${f(cy + sw * 0.6 + 4)}"
          viewBox="0 0 ${size} ${f(cy + sw * 0.6 + 4)}">
          <path d="${bgPath}" fill="none" stroke="#f0f4f8"
            stroke-width="${f(sw)}" stroke-linecap="round"/>
          ${fillPath ? `<path d="${fillPath}" fill="none" stroke="${clr}"
            stroke-width="${f(sw)}" stroke-linecap="round"/>` : ''}
        </svg>
        <div class="home-gauge-val" style="color:${clr}">${value}%</div>
        <div class="home-gauge-sub">Taxa de Cumprimento</div>
      </div>`;
  }

  function _hBarChart(items) {
    const max = Math.max(...items.map(i => i.value), 1);
    return `<div class="home-hbar-chart">${items.map(it =>
      `<div class="home-hbar-row">
        <div class="home-hbar-label">${it.label}</div>
        <div class="home-hbar-track">
          <div class="home-hbar-fill"
            style="width:${((it.value / max) * 100).toFixed(1)}%;background:${it.color}"></div>
        </div>
        <div class="home-hbar-val">${it.value}</div>
      </div>`).join('')}</div>`;
  }

  function _barChart(items) {
    const max = Math.max(...items.map(i => i.count), 1);
    return `<div class="home-bar-chart">${items.map(it => {
      const h = Math.max(3, (it.count / max) * 85);
      return `<div class="home-bar-col">
        <div class="home-bar-val">${it.count > 0 ? it.count : ''}</div>
        <div class="home-bar-bar" style="height:${h}px"></div>
        <div class="home-bar-lbl">${it.label}</div>
      </div>`;
    }).join('')}</div>`;
  }

  // ── RENDER PRINCIPAL ─────────────────────────────────────────
  function renderHome() {
    const container = document.getElementById('tab-inicio');
    if (!container) return;
    // Garante período sempre consistente com o modo atual
    if (!_hf.dataInicio && _hf.modo !== 'geral' && _hf.modo !== 'custom') _initPeriodo();

    const kpis = calcKPIs();

    container.innerHTML = `
      <div class="home-dashboard">
        ${_renderFiltros()}
        <div class="home-grid">
          <div class="home-main">
            ${_renderKPIRow1(kpis)}
            ${_renderMidCharts(kpis)}
            ${_renderKPIRow2(kpis)}
            ${_renderBottomCharts(kpis)}
          </div>
          <div class="home-sidebar">
            ${_renderNotifPanel(kpis)}
            ${_renderDonutOT(kpis)}
            ${_renderDonutTipos(kpis)}
          </div>
        </div>
      </div>`;
  }

  // ── FILTRO DE PERÍODO ─────────────────────────────────────────
  function _renderFiltros() {
    const ck = (k) => _hf.modo === k
      ? `<svg class="hpo-ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
      : '';

    // Rótulo do período atual (para pill e botão)
    const periodoLabel = _modoLabel();
    const rangeLabel = _hf.modo !== 'geral' && _hf.dataInicio && _hf.dataFim
      ? `${_fmtDate(_hf.dataInicio)} — ${_fmtDate(_hf.dataFim)}`
      : _hf.modo === 'geral' ? 'Todos os registros' : '';

    // Dropdown: ao selecionar modo com picker, mostra picker inline apenas
    // neste dropdown secundário (abre após seleção para refinar)
    const showMesPicker  = _hf.modo === 'mes';
    const showAnoPicker  = _hf.modo === 'ano';
    const showCustom     = _hf.modo === 'custom';

    return `
      <div class="home-filter-bar" id="home-filter-bar">
        <div class="home-period-btn-wrap">

          <!-- Botão principal -->
          <button class="home-period-btn" onclick="homeToggleDropdown(event)" id="home-period-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <span class="home-period-label">${periodoLabel}</span>
            ${rangeLabel ? `<span class="home-period-range">${rangeLabel}</span>` : ''}
            <svg class="home-period-chevron" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>

          <!-- Dropdown de seleção de modo -->
          <div class="home-period-dropdown" id="home-period-dropdown" style="display:none"
            onclick="event.stopPropagation()">

            <div class="hpd-modes">
              <div class="home-period-option ${_hf.modo==='geral'?'active':''}"
                onclick="homeSetModo('geral')">
                <div class="hpo-check">${ck('geral')}</div>
                <div class="hpo-info">
                  <div class="hpo-label">Geral</div>
                  <div class="hpo-desc">Todos os registros</div>
                </div>
              </div>
              <div class="home-period-option ${_hf.modo==='ano'?'active':''}"
                onclick="homeSetModo('ano')">
                <div class="hpo-check">${ck('ano')}</div>
                <div class="hpo-info">
                  <div class="hpo-label">Ano</div>
                  <div class="hpo-desc">${_hf.modo==='ano' ? periodoLabel : 'Ano corrente'}</div>
                </div>
              </div>
              <div class="home-period-option ${_hf.modo==='mes'?'active':''}"
                onclick="homeSetModo('mes')">
                <div class="hpo-check">${ck('mes')}</div>
                <div class="hpo-info">
                  <div class="hpo-label">Mês</div>
                  <div class="hpo-desc">${_hf.modo==='mes' ? periodoLabel : 'Mês corrente'}</div>
                </div>
              </div>
              <div class="home-period-option ${_hf.modo==='custom'?'active':''}"
                onclick="homeSetModo('custom')">
                <div class="hpo-check">${ck('custom')}</div>
                <div class="hpo-info">
                  <div class="hpo-label">Personalizado</div>
                  <div class="hpo-desc">Defina o intervalo</div>
                </div>
              </div>
            </div>

            <!-- Picker de mês (visível quando modo=mes) -->
            ${showMesPicker ? `<div class="hpd-picker-sep"></div>${_renderMesPicker()}` : ''}

            <!-- Picker de ano (visível quando modo=ano) -->
            ${showAnoPicker ? `<div class="hpd-picker-sep"></div>${_renderAnoPicker()}` : ''}

            <!-- Intervalo personalizado -->
            ${showCustom ? `
              <div class="hpd-picker-sep"></div>
              <div class="home-period-custom">
                <div class="home-period-custom-row">
                  <label>De</label>
                  <input type="date" value="${_hf.dataInicio}" class="home-custom-date"
                    onchange="homeCustomDate('dataInicio',this.value)" max="${new Date().toISOString().split('T')[0]}">
                  <label>Até</label>
                  <input type="date" value="${_hf.dataFim}" class="home-custom-date"
                    onchange="homeCustomDate('dataFim',this.value)" max="${new Date().toISOString().split('T')[0]}">
                </div>
              </div>` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-left:auto;">
          <button class="home-mine-btn${_homeOnlyMine ? ' active' : ''}" onclick="homeToggleMine()" title="Mostrar apenas meus itens">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;flex-shrink:0;"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
            Meus itens
          </button>
          <button class="home-mine-btn" onclick="switchTab('rotina');switchRotinaTab('agenda');" title="Abrir Agenda">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </button>
        </div>
      </div>`;
  }

  // ── PICKER DE MÊS ────────────────────────────────────────────
  function _renderMesPicker() {
    const hoje   = new Date();
    const navAno = _hf.pickerNavAno || _hf.anoSel || hoje.getFullYear();
    const mesSel = _hf.mesSel  || (hoje.getMonth() + 1);
    const anoSel = _hf.anoSel  || hoje.getFullYear();

    const meses = _MESES.map((nome, i) => {
      const m = i + 1;
      const isAtivo = m === mesSel && navAno === anoSel;
      // Desabilita meses futuros no ano atual
      const futuro  = navAno > hoje.getFullYear() ||
                     (navAno === hoje.getFullYear() && m > hoje.getMonth() + 1);
      return `<button
        class="hpm-mes ${isAtivo ? 'sel' : ''} ${futuro ? 'dis' : ''}"
        ${futuro ? 'disabled' : `onclick="homeSelectMes(${m},${navAno})"`}>
        ${nome}
      </button>`;
    }).join('');

    return `
      <div class="home-picker-wrap" onclick="event.stopPropagation()">
        <div class="hpm-nav">
          <button class="hpm-nav-btn" onclick="homeNavMes(-1)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <span class="hpm-ano">${navAno}</span>
          <button class="hpm-nav-btn"
            ${navAno >= hoje.getFullYear() ? 'disabled' : `onclick="homeNavMes(1)"`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
        <div class="hpm-grid">${meses}</div>
      </div>`;
  }

  // ── PICKER DE ANO ─────────────────────────────────────────────
  function _renderAnoPicker() {
    const hoje    = new Date();
    const anoAtual = hoje.getFullYear();
    const anoSel  = _hf.anoPicker || anoAtual;
    // Mostra últimos 6 anos + ano atual
    const anos = Array.from({ length: 7 }, (_, i) => anoAtual - 6 + i);

    const btns = anos.map(a => `
      <button class="hpa-ano ${a === anoSel ? 'sel' : ''} ${a > anoAtual ? 'dis' : ''}"
        ${a > anoAtual ? 'disabled' : `onclick="homeSelectAno(${a})"`}>
        ${a}
      </button>`).join('');

    return `
      <div class="home-picker-wrap" onclick="event.stopPropagation()">
        <div class="hpa-grid">${btns}</div>
      </div>`;
  }

  function _fmtDate(d) {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  }
  function _fmtDateTime(iso) {
    if (!iso) return '';
    if (!iso.includes('T')) return _fmtDate(iso);
    const [datePart, timePart] = iso.split('T');
    const [y, m, day] = datePart.split('-');
    const [h, min] = timePart.split(':');
    return `${day}/${m}/${y} ${h}:${min}`;
  }

  // ── ÍCONES SVG ───────────────────────────────────────────────
  const _ico = {
    clock:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    eye:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    check:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
    alert:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    checkC:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    wrench:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
    monitor: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
    pause:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
    bell:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    chart:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3v18h18"/><path d="M7 16l4-4 4 4 6-6"/></svg>`,
    task:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
    empty:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3v18h18"/><path d="M7 16l4-4 4 4 6-6"/></svg>`,
    ok:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
    next:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`,
  };

  // ── KPI CARD ─────────────────────────────────────────────────
  function _kpi(titulo, valor, svg, cls, sub, tipo) {
    return `<div class="home-kpi-card ${cls}"
      onclick="homeOpenKPI('${tipo}')" style="cursor:pointer">
      <div class="home-kpi-icon">${svg}</div>
      <div class="home-kpi-body">
        <div class="home-kpi-value">${valor}</div>
        <div class="home-kpi-title">${titulo}</div>
        ${sub ? `<div class="home-kpi-subtitle">${sub}</div>` : ''}
      </div>
      <div class="home-kpi-arrow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    </div>`;
  }

  // Row 1: OTs com Atraso | OTs de Serviço Abertas | OTs Concluídas | OTs Corretivas Abertas
  function _renderKPIRow1(k) {
    return `<div class="home-kpi-row">
      ${_kpi('OTs Corretivas Abertas', k.otCorretivas,  _ico.wrench,
          k.otCorretivas > 0 ? 'kpi-amber' : 'kpi-cyan', 'Em aberto', 'otCorretivas')}
      ${_kpi('OTs de Serviço Abertas', k.otsServico,    _ico.eye,
          'kpi-cyan', 'Não corretivas em aberto', 'otsServico')}
      ${_kpi('OTs com Falha',          k.otsFalhaTotal, _ico.alert,   'kpi-red',   'Ativos com falha registrada', 'otsFalha')}
      ${_kpi('OTs com Atraso',         k.otsAtraso,     _ico.clock,
          'kpi-amber', 'Prazo vencido', 'otsAtraso')}
    </div>`;
  }

  // Row 2: Tarefas com Atraso | Rotinas Ativas | Ativos Parados | Ativos Cadastrados
  function _renderKPIRow2(k) {
    return `<div class="home-kpi-row">
      ${_kpi('Tarefas com Atraso', k.tarefasAtrasadas,  _ico.alert,
          'kpi-amber',
          'Vencidas sem conclusão', 'tarefasAtrasadas')}
      ${_kpi('Rotinas Ativas',     k.rotinasAtivas,     _ico.refresh, 'kpi-cyan',
          'Planos ativos', 'rotinasAtivas')}
      ${_kpi('Ativos Parados',     k.ativosParados,     _ico.pause,
          k.ativosParados > 0 ? 'kpi-red' : 'kpi-default',
          'Em pausa / manutenção', 'ativosParados')}
      ${_kpi('Ativos em Uso',      k.ativosEmUso,       _ico.monitor, 'kpi-green',
          'Operando normalmente', 'ativosEmUso')}
    </div>`;
  }

  // ── MODAL DE LISTAGEM KPI ─────────────────────────────────────
  function _ensureKPIModal() {
    if (document.getElementById('home-kpi-modal')) return;
    const el = document.createElement('div');
    el.id = 'home-kpi-modal';
    el.className = 'hkm-overlay';
    el.innerHTML = `
      <div class="hkm-box" onclick="event.stopPropagation()">
        <div class="hkm-header">
          <div class="hkm-title-area">
            <div class="hkm-title" id="hkm-title"></div>
            <div class="hkm-count" id="hkm-count"></div>
          </div>
          <button class="hkm-close" onclick="homeCloseKPI()" title="Fechar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="hkm-body" id="hkm-body"></div>
      </div>`;
    el.addEventListener('click', () => homeCloseKPI());
    document.body.appendChild(el);
  }

  function _otTipoLabel(t) {
    return { corretiva:'Corretiva', implantacao:'Implantação', melhoria:'Melhoria', alteracao:'Alteração' }[t] || t;
  }
  function _otStLabel(s) {
    return { pendente:'Pendente', em_processo:'Em Processo', em_revisao:'Em Revisão', concluida:'Concluída', cancelada:'Cancelada' }[s] || s;
  }
  function _sevLabel(s) {
    return { critica:'Crítica', alta:'Alta', media:'Média', baixa:'Baixa' }[s] || s;
  }

  function _buildKPIData(tipo, k) {
    const hoje = _hoje();

    const _otivoInfo = (ot) => {
      const a = ot.ativoIdx != null ? state?.ativos[ot.ativoIdx] : null;
      return a ? `${_esc(a.nome)}<small>${_esc(a.setor)}</small>` : _esc(ot.setor || '—');
    };
    const _tarefaAtivo = (t) => {
      const a = t.equipamentoIdx != null ? state?.ativos[t.equipamentoIdx] : null;
      const r = state?.rotinas?.find(x => x.id === t.rotinaId);
      return a ? `${_esc(a.nome)}<small>${_esc(a.setor)}</small>` : _esc(r?.setor || '—');
    };

    // Wrapper: fecha o modal KPI antes de abrir o detalhe
    const _fn = (expr) => `homeCloseKPI();${expr}`;

    switch (tipo) {

      case 'otsAtraso':
        return { titulo: 'OTs com Atraso', cols: ['Nº', 'Título', 'Ativo / Setor', 'Tipo', 'Prazo', 'Atraso'],
          rows: (k.otsAtrasoList || [])
            .sort((a, b) => (a.prazo || '').localeCompare(b.prazo || ''))
            .map(o => {
              const d = new Date(o.prazo + 'T00:00:00');
              const dias = Math.ceil((hoje - d) / 86400000);
              return {
                cells: [_esc(o.numero), _esc(o.titulo||'—'), _otivoInfo(o),
                        _otTipoLabel(o.tipo), _fmtDate(o.prazo),
                        `<span class="hkm-badge hkm-danger">${dias}d de atraso</span>`],
                fn: _fn(`otOpenView('${o.id}')`),
              };
            }),
        };

      case 'otsServico':
        return { titulo: 'OTs de Serviço Abertas', cols: ['Nº', 'Título', 'Ativo / Setor', 'Tipo', 'Status', 'Abertura'],
          rows: (k.otsServicoList || [])
            .sort((a, b) => (['critica','alta','media','baixa'].indexOf(a.severidade)) - (['critica','alta','media','baixa'].indexOf(b.severidade)))
            .map(o => ({
              cells: [_esc(o.numero), _esc(o.titulo||'—'), _otivoInfo(o),
                      _otTipoLabel(o.tipo),
                      `<span class="hkm-badge hkm-st-${o.status}">${_otStLabel(o.status)}</span>`,
                      _fmtDate((o.criadoEm||'').split('T')[0])],
              fn: _fn(`otOpenView('${o.id}')`),
            })),
        };

      case 'otConcluidas':
        return { titulo: 'OTs Concluídas no Período', cols: ['Nº', 'Título', 'Ativo / Setor', 'Tipo', 'Abertura'],
          rows: k.ordensVis.filter(o => o.status === 'concluida' && _inPeriod(o.criadoEm)).map(o => ({
            cells: [_esc(o.numero), _esc(o.titulo||'—'), _otivoInfo(o),
                    _otTipoLabel(o.tipo), _fmtDate((o.criadoEm||'').split('T')[0])],
            fn: _fn(`otOpenView('${o.id}')`),
          })),
        };

      case 'otsFalha':
        return { titulo: 'OTs com Falha de Ativo', cols: ['Nº', 'Título', 'Ativo / Setor', 'Tipo de Falha', 'Severidade', 'Status', 'Abertura'],
          rows: (k.otsFalhaList || []).map(o => ({
            cells: [_esc(o.numero), _esc(o.titulo||'—'), _otivoInfo(o),
                    _esc(o.tipoFalha||'—'),
                    `<span class="hkm-badge hkm-sev-${o.severidade}">${_sevLabel(o.severidade)}</span>`,
                    `<span class="hkm-badge hkm-st-${o.status}">${_otStLabel(o.status)}</span>`,
                    _fmtDate((o.criadoEm||'').split('T')[0])],
            fn: _fn(`otOpenView('${o.id}')`),
          })),
        };

      case 'otCorretivas':
        return { titulo: 'OTs Corretivas Abertas', cols: ['Nº', 'Título', 'Ativo / Setor', 'Severidade', 'Status'],
          rows: k.ordensVis.filter(o => o.tipo === 'corretiva' && !['concluida','cancelada'].includes(o.status))
            .sort((a, b) => (['critica','alta','media','baixa'].indexOf(a.severidade)) - (['critica','alta','media','baixa'].indexOf(b.severidade)))
            .map(o => ({
              cells: [_esc(o.numero), _esc(o.titulo||'—'), _otivoInfo(o),
                      `<span class="hkm-badge hkm-sev-${o.severidade}">${_sevLabel(o.severidade)}</span>`,
                      `<span class="hkm-badge hkm-st-${o.status}">${_otStLabel(o.status)}</span>`],
              fn: _fn(`otOpenView('${o.id}')`),
            })),
        };

      case 'tarefasConcluidas':
        // Usa a lista já filtrada por setor+período do calcKPIs (mesmo conjunto que o contador do card)
        return { titulo: 'Tarefas Concluídas no Período', cols: ['Tarefa', 'Ativo / Setor', 'Concluída em', 'Por'],
          rows: (k.execsPeriodoList || []).map(p => {
            const t = state?.tarefas?.find(x => x.id === p.tarefaId);
            const r = t ? state?.rotinas?.find(x => x.id === t.rotinaId) : null;
            return {
              cells: [_esc(t?.titulo || r?.nome || '—'), _tarefaAtivo(t || {}),
                      _fmtDateTime(p.dataPublicacao || ''), _esc(p.publicadoPorNome || '—')],
              fn: t ? _fn(`openTarefaDetalhe('${t.id}')`) : '',
            };
          }),
        };

      case 'tarefasAtrasadas':
        return { titulo: 'Tarefas com Atraso', cols: ['Tarefa', 'Ativo / Setor', 'Vencimento', 'Atraso'],
          rows: k.tarefasAtrasadasList.map(t => {
            const due  = new Date(t.proximaData + 'T00:00:00');
            const dias = Math.ceil((hoje - due) / 86400000);
            return {
              cells: [_esc(t.titulo || state?.rotinas?.find(x => x.id === t.rotinaId)?.nome || '—'),
                      _tarefaAtivo(t),
                      _fmtDate(t.proximaData),
                      `<span class="hkm-badge hkm-danger">${dias}d de atraso</span>`],
              fn: _fn(`openTarefaDetalhe('${t.id}')`),
            };
          }),
        };

      case 'rotinasAtivas':
        return { titulo: 'Rotinas Ativas', cols: ['Nome', 'Ativo / Setor', 'Tipo', 'Tarefas'],
          rows: (k.rotinasAtivasList || []).map(r => {
            const a = r.equipamentoIdx != null ? state?.ativos[r.equipamentoIdx] : null;
            const aInfo = a ? `${_esc(a.nome)}<small>${_esc(a.setor)}</small>` : _esc(r.setor || '—');
            const numTarefas = (k.tarefasVisList || []).filter(t => t.rotinaId === r.id).length;
            return {
              cells: [_esc(r.nome), aInfo, _esc(r.tipo), String(numTarefas)],
              fn: _fn(`viewRotina('${r.id}')`),
            };
          }),
        };

      case 'ativosEmUso':
        return {
          titulo: 'Ativos em Uso',
          cards: (k.ativosEmUsoList || []).map(a => {
            const idx = (state?.ativos || []).indexOf(a);
            const alertCounts = typeof getAtivoAlertCounts === 'function' ? getAtivoAlertCounts(idx) : { danger: 0, warning: 0, total: 0 };
            return { ativo: a, idx, tipo: 'em_uso', otsAssoc: [], alertCounts };
          }),
        };

      case 'ativosParados':
        return {
          titulo: 'Ativos Parados',
          cards: (k.ativosParadosList || []).map(a => {
            const idx = (state?.ativos || []).indexOf(a);
            const otsAssoc = (a.pausaOTs || []).map(id => {
              const ot = (typeof otState !== 'undefined' ? otState.ordens : []).find(o => o.id === id);
              return ot ? { numero: ot.numero || id, id: ot.id } : { numero: id, id };
            });
            return { ativo: a, idx, tipo: 'em_pausa', otsAssoc };
          }),
        };

      default: return { titulo: '', cols: [], rows: [] };
    }
  }

  // ── ÚLTIMAS PUBLICAÇÕES ──────────────────────────────────────
  function _renderUltimasPublicacoes() {
    const sessao = typeof authGetCurrentUser === 'function' ? authGetCurrentUser() : null;
    const userId = sessao?.userId;

    // Pool base: todas do setor filtrado, sem notificações
    const pool = (state?.publicacoes || [])
      .filter(p => {
        if (p.tipo === 'notificacao') return false;
        const t = state?.tarefas?.find(x => x.id === p.tarefaId);
        if (!t) return false;
        return _inSetor(_tarefaSetor(t));
      })
      .sort((a, b) => (b.dataPublicacao || '') > (a.dataPublicacao || '') ? 1 : -1);

    // Quando toggle ativo: filtra apenas do usuário logado
    const poolFiltrado = _hupMinhas && userId
      ? pool.filter(p => p.publicadoPorId === userId)
      : pool;

    const HUP_PER_PAGE  = 5;
    const HUP_MAX_PAGES = 10;
    const poolLimitado  = poolFiltrado.slice(0, HUP_PER_PAGE * HUP_MAX_PAGES);
    const totalPubs     = poolLimitado.length;
    const totalPages    = Math.max(1, Math.ceil(totalPubs / HUP_PER_PAGE));
    if (_hupPage >= totalPages) _hupPage = totalPages - 1;
    const pubs = poolLimitado.slice(_hupPage * HUP_PER_PAGE, (_hupPage + 1) * HUP_PER_PAGE);

    const btnLabel = _hupMinhas ? 'Todas' : 'Minhas Execuções';
    const btnIcon  = _hupMinhas
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

    const header = `
      <div class="home-chart-header">
        <span class="home-chart-title">Últimas Publicações</span>
        <button class="hup-toggle-btn${_hupMinhas ? ' active' : ''}"
          onclick="homeToggleMinhas()" title="${_hupMinhas ? 'Ver todas' : 'Ver apenas minhas'}">
          ${btnIcon}
          ${btnLabel}
        </button>
      </div>`;

    if (pubs.length === 0) {
      return `<div class="home-chart-card">
        ${header}
        <div class="hup-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
          <span>${_hupMinhas ? 'Você não tem execuções registradas' : 'Nenhuma execução registrada'}</span>
        </div>
      </div>`;
    }

    const items = pubs.map((p, idx) => {
      const t      = state?.tarefas?.find(x => x.id === p.tarefaId);
      const r      = t ? state?.rotinas?.find(x => x.id === t.rotinaId) : null;
      const a      = t?.equipamentoIdx != null ? state?.ativos[t.equipamentoIdx] : null;
      const nome   = _esc(t?.titulo || r?.nome || '—');
      const ativo  = a ? _esc(a.nome) : '—';
      const setor  = _esc(a?.setor || r?.setor || '—');
      const data   = _fmtDateTime(p.dataPublicacao || '');
      const por    = _esc(p.publicadoPorNome || '—');
      const fn     = `viewPublicacao('${p.id}')`;
      const iniciais = (p.publicadoPorNome || '?').split(' ')
        .filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
      const isMinha = userId && p.publicadoPorId === userId;
      const isLast  = idx === pubs.length - 1;

      return `<div class="hup-item${fn ? ' hup-item-click' : ''}${isLast ? ' hup-item-last' : ''}"
        ${fn ? `onclick="${fn}"` : ''}>
        <div class="hup-timeline">
          <div class="hup-dot${isMinha ? ' hup-dot-mine' : ''}"></div>
          ${isLast ? '' : '<div class="hup-line"></div>'}
        </div>
        <div class="hup-content">
          <div class="hup-row-top">
            <span class="hup-task-name">${nome}</span>
            <span class="hup-date">${data}</span>
          </div>
          <div class="hup-row-bot">
            <div class="hup-asset">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="3" width="20" height="14" rx="2"/>
                <line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
              ${ativo} <span class="hup-setor-tag">${setor}</span>
            </div>
            <div class="hup-author">
              <div class="hup-avatar${isMinha ? ' hup-avatar-mine' : ''}">${iniciais}</div>
              <span>${por}</span>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');

    const pageNums = totalPages > 1
      ? Array.from({ length: totalPages }, (_, i) =>
          `<button class="hup-page-btn${i === _hupPage ? ' hup-page-active' : ''}"
            onclick="homeHupPage(${i})" ${i === _hupPage ? 'disabled' : ''}>${i + 1}</button>`
        ).join('')
      : '';
    const pagination = totalPages > 1 ? `
      <div class="hup-pagination">
        <button class="hup-page-btn" onclick="homeHupPage(${_hupPage - 1})" ${_hupPage === 0 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:14px;height:14px;"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        ${pageNums}
        <button class="hup-page-btn" onclick="homeHupPage(${_hupPage + 1})" ${_hupPage >= totalPages - 1 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:14px;height:14px;"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>` : '';

    return `<div class="home-chart-card">
      ${header}
      <div class="hup-feed">${items}</div>
      ${pagination}
    </div>`;
  }

  // ── MID CHARTS ───────────────────────────────────────────────
  function _renderFalhaAtivo(key, entry) {
    const tab = _falhaTabByAtivo[key] || 'falha';
    const tabs = [
      { id: 'falha',     label: 'Falha',     field: 'tipoFalha'   },
      { id: 'causa',     label: 'Causa',     field: 'causaRaiz'   },
      { id: 'deteccao',  label: 'Detecção',  field: 'metodoDetec' },
      { id: 'dano',      label: 'Dano',      field: 'tipoDano'    },
    ];
    const activeTab = tabs.find(t => t.id === tab) || tabs[0];

    // Contagem de valores para a aba ativa
    const counts = {};
    entry.ots.forEach(o => {
      const v = o[activeTab.field];
      if (v) counts[v] = (counts[v] || 0) + 1;
    });
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    const items = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value, pct: total > 0 ? Math.round((value / total) * 100) : 0 }));

    const colors = ['#e63946','#f4a261','#00a8cc','#2a9d8f','#7c3aed','#718096'];

    return `<div class="hfa-card">
      <div class="hfa-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:13px;height:13px;flex-shrink:0;color:var(--cyan);"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        <span class="hfa-ativo-nome">${entry.nome}</span>
        <span class="hfa-count-badge">${entry.ots.length} OT${entry.ots.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="hfa-tabs">
        ${tabs.map(t => `<button class="hfa-tab${t.id === tab ? ' active' : ''}"
          onclick="homeFalhaSetTab('${key}','${t.id}')">${t.label}</button>`).join('')}
      </div>
      <div class="hfa-body">
        ${items.length === 0
          ? `<div class="hfa-empty">Sem dados para esta categoria</div>`
          : items.map((it, i) => `
          <div class="hfa-row">
            <div class="hfa-row-label" title="${it.label}">${it.label}</div>
            <div class="hfa-row-right">
              <div class="hfa-row-bar-wrap">
                <div class="hfa-row-bar" style="width:${it.pct}%;background:${colors[i % colors.length]};"></div>
              </div>
              <div class="hfa-row-stat"><span class="hfa-row-qty">${it.value}</span><span class="hfa-row-pct">${it.pct}%</span></div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  }

  window.homeFalhaSetTab = function (key, tab) {
    _falhaTabByAtivo[key] = tab;
    renderHome();
  };

  window.homeFalhaPage = function (page) {
    _falhaPage = page;
    renderHome();
  };

  function _renderMidCharts(k) {
    const entries = Object.entries(k.otsFalhaByAtivo);
    const totalOtsFalha = entries.reduce((s, [, e]) => s + e.ots.length, 0);

    const HFA_PER_PAGE  = 3;
    const hfaTotalPages = Math.max(1, Math.ceil(entries.length / HFA_PER_PAGE));
    if (_falhaPage >= hfaTotalPages) _falhaPage = hfaTotalPages - 1;
    const entriesPage   = entries.slice(_falhaPage * HFA_PER_PAGE, (_falhaPage + 1) * HFA_PER_PAGE);

    const hfaPageNums = hfaTotalPages > 1
      ? Array.from({ length: hfaTotalPages }, (_, i) =>
          `<button class="hup-page-btn${i === _falhaPage ? ' hup-page-active' : ''}"
            onclick="homeFalhaPage(${i})" ${i === _falhaPage ? 'disabled' : ''}>${i + 1}</button>`
        ).join('')
      : '';
    const hfaPagination = hfaTotalPages > 1 ? `
      <div class="hup-pagination" style="border-top:1px solid var(--border);padding:8px 16px 14px;">
        <button class="hup-page-btn" onclick="homeFalhaPage(${_falhaPage - 1})" ${_falhaPage === 0 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:14px;height:14px;"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        ${hfaPageNums}
        <button class="hup-page-btn" onclick="homeFalhaPage(${_falhaPage + 1})" ${_falhaPage >= hfaTotalPages - 1 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:14px;height:14px;"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>` : '';

    return `<div class="home-mid-charts">
      <div class="home-chart-card home-falha-card">
        <div class="home-chart-header">
          <span class="home-chart-title">OTs de Ativos com Falha</span>
          <span class="home-chart-badge">${totalOtsFalha}</span>
        </div>
        <div class="home-chart-body home-falha-body">
          ${entries.length === 0
            ? `<div class="home-chart-empty">${_ico.chart}<span>Nenhuma OT corretiva com dados de falha</span></div>`
            : `<div class="hfa-grid">${entriesPage.map(([key, entry]) => _renderFalhaAtivo(key, entry)).join('')}</div>`}
        </div>
        ${hfaPagination}
      </div>
      ${_renderUltimasPublicacoes()}
    </div>`;
  }

  // ── BOTTOM CHARTS ────────────────────────────────────────────
  function _renderBottomCharts(k) {
    const sevItems = [
      { label: 'Crítica', value: k.otBySev.critica || 0, color: '#e63946' },
      { label: 'Alta',    value: k.otBySev.alta    || 0, color: '#f4a261' },
      { label: 'Média',   value: k.otBySev.media   || 0, color: '#00a8cc' },
      { label: 'Baixa',   value: k.otBySev.baixa   || 0, color: '#2a9d8f' },
    ];
    const hasSev = sevItems.some(i => i.value > 0);
    const hasMes = k.otPorMes.some(m => m.count > 0);

    return `<div class="home-bottom-charts">
      <div class="home-chart-card">
        <div class="home-chart-header">
          <span class="home-chart-title">OTs Abertas por Mês</span>
        </div>
        <div class="home-chart-body">
          ${hasMes ? _barChart(k.otPorMes)
            : `<div class="home-chart-empty">${_ico.chart}<span>Sem dados nos últimos 6 meses</span></div>`}
        </div>
      </div>
      <div class="home-chart-card">
        <div class="home-chart-header">
          <span class="home-chart-title">Severidade das OTs</span>
          <span class="home-chart-badge">${k.totalOTs}</span>
        </div>
        <div class="home-chart-body">
          ${hasSev ? _hBarChart(sevItems)
            : `<div class="home-chart-empty">${_ico.chart}<span>Sem OTs cadastradas</span></div>`}
        </div>
      </div>
    </div>`;
  }

  // ── PAINEL DE NOTIFICAÇÕES ────────────────────────────────────
  function _renderNotifPanel(k) {
    const hoje = _hoje();

    // Lista de tarefas: vencidas primeiro, depois próximas
    const tarefaItems = [];

    k.tarefasAtrasadasList.forEach(t => {
      const rotina = state?.rotinas?.find(r => r.id === t.rotinaId);
      const ativo  = t.equipamentoIdx != null ? state?.ativos[t.equipamentoIdx] : null;
      const due    = new Date(t.proximaData + 'T00:00:00');
      const dias   = Math.ceil((hoje - due) / 86400000);
      tarefaItems.push({
        id:     t.id,
        titulo: t.titulo || rotina?.nome || 'Tarefa',
        meta:   ativo ? `${ativo.nome} · ${ativo.setor}` : (rotina?.setor || '—'),
        badge:  `${dias}d atraso`,
        bCls:   'notif-badge-red',
        dot:    '#e63946',
        dias,
        tipo:   'atraso',
      });
    });

    k.tarefasProximasList.forEach(t => {
      const rotina = state?.rotinas?.find(r => r.id === t.rotinaId);
      const ativo  = t.equipamentoIdx != null ? state?.ativos[t.equipamentoIdx] : null;
      const due    = new Date(t.proximaData + 'T00:00:00');
      const dias   = Math.ceil((due - hoje) / 86400000);
      tarefaItems.push({
        id:     t.id,
        titulo: t.titulo || rotina?.nome || 'Tarefa',
        meta:   ativo ? `${ativo.nome} · ${ativo.setor}` : (rotina?.setor || '—'),
        badge:  dias === 0 ? 'Hoje' : `${dias}d restante${dias !== 1 ? 's' : ''}`,
        bCls:   dias === 0 ? 'notif-badge-red' : 'notif-badge-amber',
        dot:    dias === 0 ? '#e63946' : '#f4a261',
        dias,
        tipo:   'proxima',
      });
    });

    // Lista de OTs abertas (pendente + em_processo + em_revisao), ordenadas por severidade
    const sevOrd = { critica: 0, alta: 1, media: 2, baixa: 3 };
    const otItems = k.ordensVis
      .filter(o => !['concluida', 'cancelada'].includes(o.status))
      .sort((a, b) => (sevOrd[a.severidade] ?? 9) - (sevOrd[b.severidade] ?? 9))
      .map(ot => {
        const ativo = ot.ativoIdx != null ? state?.ativos[ot.ativoIdx] : null;
        const stCfg = {
          pendente:   { label: 'Pendente',    cls: 'notif-badge-gray'   },
          em_processo:{ label: 'Em Processo', cls: 'notif-badge-blue'   },
          em_revisao: { label: 'Em Revisão',  cls: 'notif-badge-amber'  },
        };
        const sevCfg = {
          critica: { dot: '#e63946' },
          alta:    { dot: '#f4a261' },
          media:   { dot: '#00a8cc' },
          baixa:   { dot: '#2a9d8f' },
        };
        const sc = stCfg[ot.status] || { label: ot.status, cls: 'notif-badge-gray' };

        // Flag de prazo
        let prazoBadge = '';
        if (ot.prazo) {
          const todayP = new Date(); todayP.setHours(0,0,0,0);
          const dP = new Date(ot.prazo + 'T00:00:00');
          const diffP = Math.ceil((dP - todayP) / 86400000);
          let alertLimit = null;
          if (ot.prazoAlertaDias !== undefined && ot.prazoAlertaDias !== null) {
            const parsed = parseInt(ot.prazoAlertaDias, 10);
            if (!Number.isNaN(parsed) && parsed >= 0) alertLimit = parsed;
          }
          if (diffP < 0) {
            prazoBadge = `<span class="home-notif-badge notif-badge-red" style="margin-left:4px">Vencida ${Math.abs(diffP)}d</span>`;
          } else if (diffP === 0) {
            prazoBadge = `<span class="home-notif-badge notif-badge-red" style="margin-left:4px">Vence hoje</span>`;
          } else if (alertLimit !== null && diffP <= alertLimit) {
            prazoBadge = `<span class="home-notif-badge notif-badge-amber" style="margin-left:4px">${diffP}d restante${diffP !== 1 ? 's' : ''}</span>`;
          }
        }

        return {
          id:         ot.id,
          num:        ot.numero || ot.id,
          titulo:     ot.titulo || ot.num,
          meta:       ativo ? `${ativo.nome} · ${ativo.setor}` : (ot.setor || '—'),
          badge:      sc.label,
          bCls:       sc.cls,
          dot:        sevCfg[ot.severidade]?.dot || '#718096',
          sev:        ot.severidade,
          prazoBadge,
        };
      });

    // Dados já chegam filtrados por _homeOnlyMine via calcKPIs
    const tarefaItemsVis = tarefaItems;
    const otItemsVis     = otItems;

    const tabT = _activeNotifTab === 'tarefas';
    const cntT = tarefaItemsVis.length;
    const cntO = otItemsVis.length;

    const _tarefaList = cntT === 0
      ? `<div class="home-notif-empty">
           ${_ico.ok}
           <span>${_homeOnlyMine ? 'Nenhuma tarefa atribuída a você' : 'Sem tarefas pendentes'}</span>
         </div>`
      : tarefaItemsVis.map(it =>
          `<div class="home-notif-item"
            onclick="openPublicarModalDireto('${it.id}')">
            <div class="home-notif-dot" style="background:${it.dot}"></div>
            <div class="home-notif-content">
              <div class="home-notif-title">${_esc(it.titulo)}</div>
              <div class="home-notif-meta">${_esc(it.meta)}</div>
            </div>
            <span class="home-notif-badge ${it.bCls}">${it.badge}</span>
          </div>`).join('');

    const _otList = cntO === 0
      ? `<div class="home-notif-empty">
           ${_ico.ok}
           <span>${_homeOnlyMine ? 'Nenhuma OT atribuída a você' : 'Sem OTs em aberto'}</span>
         </div>`
      : otItemsVis.map(it =>
          `<div class="home-notif-item"
            onclick="otOpenView('${it.id}')">
            <div class="home-notif-dot" style="background:${it.dot}"></div>
            <div class="home-notif-content">
              <div class="home-notif-title">${_esc(it.num)} — ${_esc(it.titulo)}</div>
              <div class="home-notif-meta">${_esc(it.meta)}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
              <span class="home-notif-badge ${it.bCls}">${it.badge}</span>
              ${it.prazoBadge}
            </div>
          </div>`).join('');

    return `
      <div class="home-side-card home-notif-card">
        <div class="home-notif-header">
          <div class="home-notif-tabs">
            <button class="home-notif-tab ${tabT ? 'active' : ''}"
              onclick="homeNotifTab('tarefas')">
              ${_ico.task}
              Tarefas
              ${cntT > 0 ? `<span class="home-notif-count">${cntT}</span>` : ''}
            </button>
            <button class="home-notif-tab ${!tabT ? 'active' : ''}"
              onclick="homeNotifTab('ots')">
              ${_ico.wrench}
              OTs
              ${cntO > 0 ? `<span class="home-notif-count cnt-blue">${cntO}</span>` : ''}
            </button>
          </div>
        </div>
        <div class="home-notif-body">
          <div class="home-notif-panel ${tabT ? '' : 'hidden'}" id="home-notif-tarefas">
            ${_tarefaList}
          </div>
          <div class="home-notif-panel ${!tabT ? '' : 'hidden'}" id="home-notif-ots">
            ${_otList}
          </div>
        </div>
      </div>`;
  }

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── DONUT OT STATUS ──────────────────────────────────────────
  function _renderDonutOT(k) {
    const segs = [
      { label: 'Pendentes',   value: k.otByStatus.pendente    || 0, color: '#718096' },
      { label: 'Em Processo', value: k.otByStatus.em_processo || 0, color: '#00a8cc' },
      { label: 'Em Revisão',  value: k.otByStatus.em_revisao  || 0, color: '#f4a261' },
      { label: 'Concluídas',  value: k.otByStatus.concluida   || 0, color: '#2a9d8f' },
      { label: 'Canceladas',  value: k.otByStatus.cancelada   || 0, color: '#e63946' },
    ];
    const total = segs.reduce((s, g) => s + g.value, 0);
    return `
      <div class="home-side-card">
        <div class="home-chart-header">
          <span class="home-chart-title">Ordens de Trabalho</span>
          <span class="home-side-total">${total}</span>
        </div>
        <div class="home-donut-wrap">
          ${_donutChart(segs)}
          <div class="home-donut-center">${total}</div>
        </div>
        <div class="home-legend">
          ${segs.map(s => `
            <div class="home-legend-item">
              <span class="home-legend-dot" style="background:${s.color}"></span>
              <span class="home-legend-label">${s.label}</span>
              <span class="home-legend-num">${s.value}</span>
            </div>`).join('')}
        </div>
      </div>`;
  }

  // ── DONUT OT TIPOS ───────────────────────────────────────────
  function _renderDonutTipos(k) {
    const cfg = {
      corretiva:   { label: 'Corretiva',   color: '#e63946' },
      implantacao: { label: 'Implantação', color: '#7c3aed' },
      melhoria:    { label: 'Melhoria',    color: '#00a8cc' },
      alteracao:   { label: 'Alteração',   color: '#f4a261' },
    };
    const segs = Object.entries(k.otByTipo).map(([tp, v]) => ({
      label: cfg[tp]?.label || tp, value: v, color: cfg[tp]?.color || '#718096',
    }));
    const total = segs.reduce((s, g) => s + g.value, 0);
    return `
      <div class="home-side-card">
        <div class="home-chart-header">
          <span class="home-chart-title">Tipos de OT</span>
          <span class="home-side-total">${total}</span>
        </div>
        <div class="home-donut-wrap">
          ${_donutChart(segs)}
          <div class="home-donut-center">${total}</div>
        </div>
        <div class="home-legend">
          ${segs.map(s => `
            <div class="home-legend-item">
              <span class="home-legend-dot" style="background:${s.color}"></span>
              <span class="home-legend-label">${s.label}</span>
              <span class="home-legend-num">${s.value}</span>
            </div>`).join('')}
        </div>
      </div>`;
  }

  // ── INICIALIZAÇÃO ─────────────────────────────────────────────
  function initHome() {
    _initPeriodo('geral');
    renderHome();
  }

  // ── FECHA DROPDOWN AO CLICAR FORA ────────────────────────────
  function _closeDropdownOutside(e) {
    const btn  = document.getElementById('home-period-btn');
    const drop = document.getElementById('home-period-dropdown');
    if (!drop || !btn) return;
    if (!btn.contains(e.target) && !drop.contains(e.target)) {
      drop.style.display = 'none';
    }
  }

  // ── API PÚBLICA ───────────────────────────────────────────────
  window.initHome   = initHome;
  window.renderHome = renderHome;

  window.homeToggleDropdown = function (e) {
    e.stopPropagation();
    const drop = document.getElementById('home-period-dropdown');
    if (!drop) return;
    const visible = drop.style.display !== 'none';
    drop.style.display = visible ? 'none' : 'block';
    if (!visible) {
      setTimeout(() => {
        document.addEventListener('click', _closeDropdownOutside, { once: true });
      }, 0);
    }
  };

  // Mantém dropdown aberto após re-render para modos com picker inline
  function _keepDropdown() {
    const drop = document.getElementById('home-period-dropdown');
    if (drop) drop.style.display = 'block';
  }

  function _closeDrop() {
    const drop = document.getElementById('home-period-dropdown');
    if (drop) drop.style.display = 'none';
  }

  window.homeSetModo = function (modo) {
    _hf.modo = modo;
    const hoje = new Date();
    if (modo === 'mes') {
      if (!_hf.mesSel)        _hf.mesSel        = hoje.getMonth() + 1;
      if (!_hf.anoSel)        _hf.anoSel        = hoje.getFullYear();
      if (!_hf.pickerNavAno)  _hf.pickerNavAno  = _hf.anoSel;
    } else if (modo === 'ano') {
      if (!_hf.anoPicker) _hf.anoPicker = hoje.getFullYear();
    } else if (modo === 'custom') {
      // não fecha — mantém aberto para digitar datas
      _initPeriodo(modo);
      renderHome();
      _keepDropdown();
      return;
    }
    _initPeriodo();
    _closeDrop();
    renderHome();
  };

  // Abre o picker inline de mês (botão de edição ao lado do pill)
  window.homeOpenMesPicker = function (e) {
    e.stopPropagation();
    const drop = document.getElementById('home-period-dropdown');
    if (!drop) return;
    const visible = drop.style.display !== 'none';
    drop.style.display = visible ? 'none' : 'block';
    if (!visible) setTimeout(() => {
      document.addEventListener('click', _closeDropdownOutside, { once: true });
    }, 0);
  };

  // Navega ano no picker de mês
  window.homeNavMes = function (dir) {
    _hf.pickerNavAno = (_hf.pickerNavAno || new Date().getFullYear()) + dir;
    renderHome();
    _keepDropdown();
  };

  // Seleciona um mês no picker — aplica imediatamente
  window.homeSelectMes = function (mes, ano) {
    _hf.mesSel       = mes;
    _hf.anoSel       = ano;
    _hf.pickerNavAno = ano;
    _initPeriodo();
    _closeDrop();
    renderHome();
  };

  // Seleciona um ano no picker — aplica imediatamente
  window.homeSelectAno = function (ano) {
    _hf.anoPicker = ano;
    _initPeriodo();
    _closeDrop();
    renderHome();
  };

  window.homeCustomDate = function (chave, valor) {
    _hf[chave] = valor;
    if (_hf.dataInicio && _hf.dataFim) { _closeDrop(); renderHome(); }
  };

  window.homeToggleMine = function () {
    _homeOnlyMine = !_homeOnlyMine;
    renderHome();
  };

  window.homeNotifTab = function (tab) {
    _activeNotifTab = tab;
    // Troca apenas as classes sem re-renderizar tudo
    document.querySelectorAll('.home-notif-tab').forEach(b => b.classList.remove('active'));
    const btn = tab === 'tarefas'
      ? document.querySelector('.home-notif-tab:first-child')
      : document.querySelector('.home-notif-tab:last-child');
    if (btn) btn.classList.add('active');

    document.getElementById('home-notif-tarefas')?.classList.toggle('hidden', tab !== 'tarefas');
    document.getElementById('home-notif-ots')?.classList.toggle('hidden', tab !== 'ots');
  };

  // ── MODAL KPI PÚBLICO ────────────────────────────────────────
  function _renderAtivoCard(card) {
    const { ativo: a, idx, tipo, otsAssoc, alertCounts } = card;
    const initials = (a.nome || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    const isParado = tipo === 'em_pausa';
    const stripeClass = isParado ? 'stripe-amber' : (alertCounts?.danger > 0 ? 'stripe-red' : alertCounts?.warning > 0 ? 'stripe-amber' : 'stripe-green');
    const avClass    = isParado ? 'av-amber'  : 'av-green';
    const sbClass    = isParado ? 'sb-amber'  : 'sb-green';
    const sbLabel    = isParado ? 'Parado'    : 'Em Uso';
    const sbIcon     = isParado
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    const clickFn = idx >= 0 ? `homeCloseKPI();visualizarAtivo(${idx})` : '';

    // Ícones de alerta ao lado do badge "Em Uso"
    let alertIcons = '';
    if (!isParado && alertCounts && alertCounts.total > 0) {
      const _alertChip = (count, color, bg, border, hoverBg, svgPath, tipText) =>
        `<span title="${tipText}" onclick="event.stopPropagation();homeCloseKPI();visualizarAtivo(${idx})"
          onmouseenter="this.style.background='${hoverBg}';this.style.transform='scale(1.08)'"
          onmouseleave="this.style.background='${bg}';this.style.transform='scale(1)'"
          style="display:inline-flex;align-items:center;gap:4px;padding:3px 7px 3px 5px;background:${bg};border:1px solid ${border};border-radius:20px;color:${color};font-size:10px;font-weight:700;cursor:pointer;transition:all .15s;user-select:none;line-height:1;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px;flex-shrink:0;">${svgPath}</svg>
          ${count}
        </span>`;
      if (alertCounts.danger > 0)
        alertIcons += _alertChip(
          alertCounts.danger,
          '#e63946', 'rgba(230,57,70,0.13)', 'rgba(230,57,70,0.35)', 'rgba(230,57,70,0.22)',
          `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>`,
          `${alertCounts.danger} atividade${alertCounts.danger !== 1 ? 's' : ''} vencida${alertCounts.danger !== 1 ? 's' : ''}`
        );
      if (alertCounts.warning > 0)
        alertIcons += _alertChip(
          alertCounts.warning,
          '#f4a261', 'rgba(244,162,97,0.13)', 'rgba(244,162,97,0.35)', 'rgba(244,162,97,0.22)',
          `<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
          `${alertCounts.warning} atividade${alertCounts.warning !== 1 ? 's' : ''} no prazo`
        );
    }
    const alertBlock = '';

    const dv = (v) => v && v !== '-' && v !== '—'
      ? `<div class="hkm-ac-dv">${_esc(v)}</div>`
      : `<div class="hkm-ac-dv dv-muted">—</div>`;

    const otsBlock = isParado && otsAssoc.length > 0
      ? `<div class="hkm-ac-footer">
          <div class="hkm-ac-ots">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
            OTs: <strong>${otsAssoc.map(o => _esc(o.numero)).join(', ')}</strong>
          </div>
          ${clickFn ? `<div class="hkm-ac-open-btn">Ver ativo <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></div>` : ''}
        </div>`
      : clickFn
        ? `<div class="hkm-ac-footer">
            <div></div>
            <div class="hkm-ac-open-btn">Ver ativo <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></div>
          </div>`
        : '';

    return `<div class="hkm-asset-card" ${clickFn ? `onclick="${clickFn}"` : ''}>
      <div class="hkm-ac-stripe ${stripeClass}"></div>
      <div class="hkm-ac-top">
        <div class="hkm-ac-avatar ${avClass}">${initials}</div>
        <div class="hkm-ac-info">
          <div class="hkm-ac-name" title="${_esc(a.nome)}">${_esc(a.nome)}</div>
          ${a.codigo ? `<div class="hkm-ac-code">${_esc(a.codigo)}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:5px;">
          ${alertIcons}
          <div class="hkm-ac-status-badge ${sbClass}">${sbIcon}${sbLabel}</div>
        </div>
      </div>
      <div class="hkm-ac-meta">
        ${a.setor ? `<span class="hkm-ac-tag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>${_esc(a.setor)}</span>` : ''}
        ${a.categoria ? `<span class="hkm-ac-tag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>${_esc(a.categoria)}</span>` : ''}
      </div>
      <div class="hkm-ac-details">
        <div class="hkm-ac-detail-item">
          <div class="hkm-ac-dl">Marca</div>
          ${dv(a.marca)}
        </div>
        <div class="hkm-ac-detail-item">
          <div class="hkm-ac-dl">Modelo</div>
          ${dv(a.modelo)}
        </div>
        <div class="hkm-ac-detail-item">
          <div class="hkm-ac-dl">Nº de Série</div>
          ${dv(a.serie)}
        </div>
        <div class="hkm-ac-detail-item">
          <div class="hkm-ac-dl">Fornecedor</div>
          ${dv(a.fornecedor)}
        </div>
      </div>
      ${alertBlock}
      ${otsBlock}
    </div>`;
  }

  function _renderKpiCards(cards) {
    const body = document.getElementById('hkm-body');
    const n = cards.length;
    document.getElementById('hkm-count').textContent = `${n} ativo${n !== 1 ? 's' : ''}`;
    if (n === 0) {
      body.innerHTML = `<div class="hkm-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <span>Nenhum ativo encontrado</span>
      </div>`;
      return;
    }
    const totalPages = Math.max(1, Math.ceil(n / KPI_CARDS_PER_PAGE));
    if (_kpiCardPage >= totalPages) _kpiCardPage = totalPages - 1;
    const page = cards.slice(_kpiCardPage * KPI_CARDS_PER_PAGE, (_kpiCardPage + 1) * KPI_CARDS_PER_PAGE);

    const pagination = totalPages > 1 ? `
      <div class="hkm-pagination">
        <button class="hkm-pg-btn" onclick="homeKpiPrevPage()" ${_kpiCardPage === 0 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="hkm-pg-info">${_kpiCardPage + 1} / ${totalPages}</span>
        <button class="hkm-pg-btn" onclick="homeKpiNextPage()" ${_kpiCardPage >= totalPages - 1 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>` : '';

    body.innerHTML = `<div class="hkm-asset-grid">${page.map(_renderAtivoCard).join('')}</div>${pagination}`;
  }

  window.homeKpiPrevPage = function () {
    if (_kpiCardPage > 0) { _kpiCardPage--; _refreshKpiModal(); }
  };
  window.homeKpiNextPage = function () {
    _kpiCardPage++;
    _refreshKpiModal();
  };
  function _refreshKpiModal() {
    const k = calcKPIs();
    const data = _buildKPIData(_kpiCardTipo, k);
    if (data.cards) _renderKpiCards(data.cards);
  }

  window.homeOpenKPI = function (tipo) {
    _ensureKPIModal();
    _kpiCardTipo = tipo;
    _kpiCardPage = 0;
    const k = calcKPIs();
    const data = _buildKPIData(tipo, k);

    document.getElementById('hkm-title').textContent = data.titulo;
    const body = document.getElementById('hkm-body');

    if (data.cards) {
      _renderKpiCards(data.cards);
    } else {
      const n = (data.rows || []).length;
      document.getElementById('hkm-count').textContent = `${n} item${n !== 1 ? 's' : ''}`;
      if (n === 0) {
        body.innerHTML = `<div class="hkm-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <span>Nenhum item encontrado</span>
        </div>`;
      } else {
        body.innerHTML = `<table class="hkm-table">
          <thead><tr>${data.cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
          <tbody>
            ${data.rows.map(r =>
              `<tr ${r.fn ? `onclick="${r.fn}" class="hkm-clickable"` : ''}>
                ${r.cells.map(c => `<td>${c}</td>`).join('')}
              </tr>`
            ).join('')}
          </tbody>
        </table>`;
      }
    }

    document.getElementById('home-kpi-modal').classList.add('open');
  };

  window.homeCloseKPI = function () {
    document.getElementById('home-kpi-modal')?.classList.remove('open');
  };

  window.homeToggleMinhas = function () {
    _hupMinhas = !_hupMinhas;
    _hupPage = 0;
    renderHome();
  };

  window.homeHupPage = function (page) {
    _hupPage = page;
    renderHome();
  };

})();
