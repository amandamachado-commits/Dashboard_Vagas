// =============================================================
//  Aba TURNOVER + troca de abas do site.
//  Recebe da API só números agregados (nenhum dado de pessoa).
// =============================================================
(() => {
  const q = (s) => document.querySelector(s);
  const DL = window.ChartDataLabels ? [window.ChartDataLabels] : []; // rótulos nos gráficos
  const fmt = (n, casas = 0) =>
    n == null || !Number.isFinite(n) ? '—'
      : n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  const fmtPct = (n) => (n == null ? '—' : fmt(n, 2) + '%');
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho',
    'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const rotuloMes = (m, mostrarAno) => {
    const nome = MESES[Number(m.slice(5, 7)) - 1].toLowerCase();
    return mostrarAno ? `${nome.slice(0, 3)}/${m.slice(2, 4)}` : nome;
  };

  // Cores da marca
  const COR_TIPO = {
    'Voluntário': '#400FF2', 'Involuntário': '#9884FF', 'Encerramento de contrato': '#04017B',
    'Outro': '#C6C5C9', 'Não informado': '#DBE1F0',
  };
  const PALETA = ['#400FF2', '#04017B', '#9884FF', '#320AC2', '#6E87C6', '#B29EFA',
    '#3D4C6F', '#546BA8', '#D9CDFD', '#92A5D3'];
  const TEXTO_CLARO = new Set(['#400FF2', '#04017B', '#320AC2', '#3D4C6F', '#546BA8', '#6E87C6']);

  let iniciado = false;
  const graficos = {};

  // ---------- abas ----------
  function mostrarAba(nome) {
    document.querySelectorAll('.aba').forEach((b) => {
      const ativa = b.dataset.aba === nome;
      b.classList.toggle('ativa', ativa);
      b.setAttribute('aria-selected', String(ativa));
    });
    q('#conteudo').hidden = nome !== 'vagas';
    q('#turnover').hidden = nome !== 'turnover';
    if (nome === 'turnover' && !iniciado) { iniciado = true; carregar(true); }
    try { history.replaceState(null, '', nome === 'turnover' ? '#turnover' : '#'); } catch {}
  }
  document.querySelectorAll('.aba').forEach((b) => b.addEventListener('click', () => mostrarAba(b.dataset.aba)));

  // ---------- dados ----------
  async function carregar(primeiraVez = false) {
    const params = new URLSearchParams();
    if (!primeiraVez) {
      ['time', 'ano', 'mes'].forEach((c) => { const v = q('#tf-' + c).value; if (v) params.set(c, v); });
    }
    q('#t-atualizado').textContent = 'Carregando…';
    try {
      const r = await fetch('/api/turnover?' + params);
      if (r.status === 401) { location.href = '/login.html'; return; }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || 'erro ao carregar');

      if (primeiraVez) {
        montarFiltros(j.opcoes);
        // começa no ano mais recente, como no painel de referência
        if (j.opcoes.anos[0]) { q('#tf-ano').value = j.opcoes.anos[0]; return carregar(); }
      }
      q('#t-atualizado').textContent = 'Atualizado em ' + new Date(j.atualizadoEm).toLocaleString('pt-BR');
      render(j);
    } catch (e) {
      const aviso = document.createElement('div');
      aviso.className = 'aviso';
      aviso.textContent = 'Não foi possível carregar o turnover: ' + e.message;
      q('#t-corpo').replaceChildren(aviso);
      q('#t-atualizado').textContent = '';
    }
  }

  function montarFiltros(opcoes) {
    const preencher = (id, itens) => {
      const sel = q(id);
      sel.replaceChildren(new Option('Todos', ''));
      itens.forEach(([valor, texto]) => sel.add(new Option(texto, valor)));
      sel.addEventListener('change', () => carregar());
    };
    preencher('#tf-time', opcoes.times.map((t) => [t, t]));
    preencher('#tf-ano', opcoes.anos.map((a) => [a, a]));
    preencher('#tf-mes', opcoes.meses.map((m, i) => [String(i + 1), m]));
  }

  // ---------- desenho ----------
  function desenhar(id, cfg) {
    graficos[id]?.destroy();
    graficos[id] = new Chart(document.getElementById(id), cfg);
  }

  function kpis(k) {
    const itens = [
      ['Contratações', fmt(k.contratacoes), k.contratacoes == null ? 'cadastre a aba Indicadores' : ''],
      ['Desligamentos', fmt(k.desligamentos), ''],
      ['Turnover geral', fmtPct(k.turnoverGeral),
        k.headcountMedio ? `headcount médio ${fmt(k.headcountMedio)}` : 'precisa de headcount'],
      ['Retenção', fmtPct(k.retencao), '100% − turnover voluntário'],
      ['Turnover voluntário', fmtPct(k.turnoverVoluntario), 'pedidos de desligamento'],
    ];
    const box = q('#t-kpis');
    box.replaceChildren();
    itens.forEach(([rotulo, valor, det]) => {
      const d = document.createElement('div');
      d.className = 'kpi kpi-turnover';
      [['rotulo', rotulo], ['valor', valor], ['det', det]].forEach(([cls, t]) => {
        const e = document.createElement('div'); e.className = cls; e.textContent = t; d.appendChild(e);
      });
      box.appendChild(d);
    });
  }

  function render(j) {
    kpis(j.kpis);
    const vazio = !j.kpis.desligamentos;

    // 1) Tipo de desligamento (rosca)
    desenhar('tg-tipo', {
      type: 'doughnut',
      plugins: DL,
      data: {
        labels: j.porTipo.map((t) => `${t[0]} · ${t[1]} (${fmt(t[2], 1)}%)`),
        datasets: [{ data: j.porTipo.map((t) => t[1]),
          backgroundColor: j.porTipo.map((t) => COR_TIPO[t[0]] || '#C6C5C9'), borderWidth: 2, borderColor: '#fff' }],
      },
      options: {
        maintainAspectRatio: false, cutout: '55%',
        plugins: {
          legend: { display: true, position: 'bottom', labels: { boxWidth: 12 } },
          tooltip: { callbacks: { label: (c) => ` ${c.label}` } },
          datalabels: {
            color: '#fff', font: { weight: 500, size: 13 },
            formatter: (v) => v || '',
            display: (c) => c.dataset.data[c.dataIndex] / (j.kpis.desligamentos || 1) > 0.06,
          },
        },
      },
    });

    // 2) % por estado (barras horizontais)
    desenhar('tg-estado', {
      type: 'bar',
      plugins: DL,
      data: {
        labels: j.porEstado.map((e) => e[0]),
        datasets: [{ label: '% dos desligamentos', data: j.porEstado.map((e) => e[2]),
          backgroundColor: '#400FF2', borderRadius: 3, maxBarThickness: 18 }],
      },
      options: {
        indexAxis: 'y', maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => ` ${fmt(c.raw, 2)}% (${j.porEstado[c.dataIndex][1]} desligamentos)` } },
          datalabels: { anchor: 'end', align: 'end', color: '#3D4C6F', formatter: (v) => fmt(v, 1) + '%' },
        },
        scales: {
          x: { beginAtZero: true, suggestedMax: 100, ticks: { callback: (v) => v + '%' } },
          y: { grid: { display: false } },
        },
      },
    });

    // 3) Contratações x Desligamentos por mês (barras empilhadas)
    const mostrarAno = !q('#tf-ano').value;
    const temContr = j.porMes.some((m) => m.contratacoes != null);
    const series = [
      ...(temContr ? [{ label: 'Contratações', data: j.porMes.map((m) => m.contratacoes ?? 0), backgroundColor: '#400FF2' }] : []),
      { label: 'Desligamentos', data: j.porMes.map((m) => m.desligamentos), backgroundColor: '#9884FF' },
    ];
    desenhar('tg-mes', {
      type: 'bar',
      plugins: DL,
      data: { labels: j.porMes.map((m) => rotuloMes(m.mes, mostrarAno)),
        datasets: series.map((s) => ({ ...s, borderRadius: 3, maxBarThickness: 44 })) },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'top', align: 'start', labels: { boxWidth: 12 } },
          datalabels: { color: '#fff', font: { weight: 500 }, formatter: (v) => (v ? v : '') },
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });

    // 4) Motivo do desligamento (mapa de árvore; se o plugin não carregar, vira barras)
    const motivos = j.porMotivo.map(([motivo, n]) => ({ motivo, n }));
    const corMotivo = (i) => PALETA[i % PALETA.length];
    let treemapOk = true;
    try { Chart.registry.getController('treemap'); } catch { treemapOk = false; }
    if (treemapOk && motivos.length) {
      desenhar('tg-motivo', {
        type: 'treemap',
        data: { datasets: [{
          tree: motivos, key: 'n', groups: ['motivo'], spacing: 2, borderWidth: 0,
          backgroundColor: (c) => (c.type === 'data' ? corMotivo(c.dataIndex) : 'transparent'),
          labels: {
            display: true, align: 'left', position: 'top', overflow: 'fit',
            color: (c) => (TEXTO_CLARO.has(corMotivo(c.dataIndex)) ? '#fff' : '#18233C'),
            font: [{ size: 13, weight: 500 }, { size: 12 }],
            formatter: (c) => [c.raw.g, String(c.raw.v)],
          },
        }] },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { display: false },
            tooltip: { callbacks: { title: (i) => i[0].raw.g, label: (c) => ` ${c.raw.v} desligamentos` } } },
        },
      });
    } else {
      desenhar('tg-motivo', {
        type: 'bar',
        data: { labels: motivos.map((m) => m.motivo),
          datasets: [{ data: motivos.map((m) => m.n), backgroundColor: motivos.map((_, i) => corMotivo(i)), borderRadius: 3 }] },
        options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } } },
      });
    }

    q('#t-vazio').hidden = !vazio;
  }

  if (location.hash === '#turnover') mostrarAba('turnover');
})();
