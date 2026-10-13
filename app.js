// =============================================================
//  Dashboard de vagas — roda no navegador.
//  Só recebe da API os campos liberados (ver api/vagas.js).
//  >>> Depois de baixar, renomeie este arquivo para app.js <<<
// =============================================================

const FILTROS = [
  ['ano', 'Ano'], ['bu', 'BU'], ['area', 'Área'],
  ['lideranca', 'Liderança'], ['recrutadora', 'Recrutadora'], ['status', 'Status'],
];
const CORES_STATUS = {
  'Fechada': '#400FF2', 'Em andamento': '#9884FF',
  'Congelada': '#B6C3E2', 'Cancelada': '#C6C5C9',
};

Chart.defaults.font.family = '"Google Sans Flex", system-ui, sans-serif';
Chart.defaults.color = '#3D4C6F';
Chart.defaults.borderColor = '#DBE1F0';
Chart.defaults.plugins.legend.display = false;

let dados = [];
const graficos = {};
const $ = (s) => document.querySelector(s);
const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
const paraDate = (s) => (s ? new Date(s + 'T00:00:00') : null);
const dataBR = (s) => (s ? s.split('-').reverse().join('/') : '—');
const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const fmt = (n, casas = 0) =>
  n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

function contar(lista, campo) {
  const m = new Map();
  lista.forEach((r) => { const k = r[campo] || 'Não informado'; m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function diasEmAberto(r) {
  const a = paraDate(r.abertura);
  if (!a) return null;
  return Math.round((hoje - a) / 86400000) - (r.congelamento || 0);
}

function noPrazo(fechadas) {
  const avaliadas = fechadas.filter((r) => ['Dentro do prazo', 'Fora do prazo'].includes(r.prazoSituacao));
  const ok = avaliadas.filter((r) => r.prazoSituacao === 'Dentro do prazo').length;
  return { ok, total: avaliadas.length, pct: avaliadas.length ? (100 * ok) / avaliadas.length : null };
}

// ---------- carregamento ----------
async function iniciar() {
  try {
    const resp = await fetch('/api/vagas');
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.erro || 'erro ao carregar');
    dados = json.vagas;
    $('#atualizado').textContent = 'Atualizado em ' + new Date(json.atualizadoEm).toLocaleString('pt-BR');
    montarFiltros();
    render();
  } catch (e) {
    const aviso = document.createElement('div');
    aviso.className = 'aviso';
    aviso.textContent = 'Não foi possível carregar os dados: ' + e.message;
    $('#conteudo').replaceChildren(aviso);
    $('#atualizado').textContent = '';
  }
}

function montarFiltros() {
  const box = $('#filtros');
  FILTROS.forEach(([campo, rotulo]) => {
    const valores = [...new Set(dados.map((r) => r[campo]).filter((v) => v !== '' && v != null))]
      .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true }));
    const label = document.createElement('label');
    label.textContent = rotulo;
    const sel = document.createElement('select');
    sel.id = 'f-' + campo;
    sel.add(new Option('Todos', ''));
    valores.forEach((v) => sel.add(new Option(v, v)));
    sel.addEventListener('change', render);
    label.appendChild(sel);
    box.appendChild(label);
  });
}

const filtrados = () =>
  dados.filter((r) => FILTROS.every(([c]) => { const v = $('#f-' + c).value; return !v || String(r[c]) === v; }));

// ---------- desenho ----------
function kpis(itens) {
  const box = $('#kpis');
  box.replaceChildren();
  itens.forEach(([rotulo, valor, det, destaque]) => {
    const d = document.createElement('div');
    d.className = 'kpi' + (destaque ? ' destaque' : '');
    ['rotulo', 'valor', 'det'].forEach((cls, i) => {
      const e = document.createElement('div');
      e.className = cls;
      e.textContent = [rotulo, valor, det][i] || '';
      d.appendChild(e);
    });
    box.appendChild(d);
  });
}

function desenhar(id, cfg) {
  graficos[id]?.destroy();
  graficos[id] = new Chart(document.getElementById(id), cfg);
}

function barras(id, pares, { horizontal = false, cores } = {}) {
  desenhar(id, {
    type: 'bar',
    data: {
      labels: pares.map((p) => p[0]),
      datasets: [{
        label: 'Vagas',
        data: pares.map((p) => p[1]),
        backgroundColor: cores ? pares.map((p) => cores[p[0]] || '#9884FF') : '#400FF2',
        borderRadius: 4,
        maxBarThickness: 32,
      }],
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      maintainAspectRatio: false,
      scales: {
        x: { beginAtZero: true, grid: { display: horizontal }, ticks: { precision: 0 } },
        y: { beginAtZero: true, grid: { display: !horizontal }, ticks: { precision: 0 } },
      },
    },
  });
}

function tabela(sel, cabecalho, linhas, numericas = []) {
  const t = $(sel);
  t.replaceChildren();
  const trh = t.createTHead().insertRow();
  cabecalho.forEach((c, i) => {
    const th = document.createElement('th');
    th.textContent = c;
    if (numericas.includes(i)) th.className = 'num';
    trh.appendChild(th);
  });
  const tb = t.createTBody();
  if (!linhas.length) {
    const td = tb.insertRow().insertCell();
    td.colSpan = cabecalho.length;
    td.textContent = 'Nenhuma vaga para os filtros escolhidos.';
    return;
  }
  linhas.forEach((l) => {
    const tr = tb.insertRow();
    l.forEach((v, i) => {
      const td = tr.insertCell();
      if (numericas.includes(i)) td.className = 'num';
      if (v && typeof v === 'object') {
        const s = document.createElement('span');
        s.className = 'selo ' + v.classe;
        s.textContent = v.texto;
        td.appendChild(s);
      } else td.textContent = v ?? '—';
    });
  });
}

function render() {
  const L = filtrados();
  const fechadas = L.filter((r) => r.status === 'Fechada');
  const andamento = L.filter((r) => r.status === 'Em andamento');
  const slas = fechadas.map((r) => r.sla).filter((v) => v != null);
  const prazo = noPrazo(fechadas);
  const acima = andamento.filter((r) => { const d = diasEmAberto(r); return d != null && r.prazo && d > r.prazo; }).length;

  kpis([
    ['Total de vagas', fmt(L.length), ''],
    ['Em andamento', fmt(andamento.length), acima ? `${acima} acima do prazo` : 'nenhuma acima do prazo'],
    ['Fechadas', fmt(fechadas.length), ''],
    ['Congeladas · Canceladas',
      `${L.filter((r) => r.status === 'Congelada').length} · ${L.filter((r) => r.status === 'Cancelada').length}`, ''],
    ['SLA médio', slas.length ? fmt(media(slas)) + ' dias' : '—', 'vagas fechadas', true],
    ['Fechadas no prazo', prazo.pct == null ? '—' : fmt(prazo.pct) + '%', `${prazo.ok} de ${prazo.total}`, true],
  ]);

  // Status
  barras('g-status', contar(L, 'status'), { cores: CORES_STATUS });

  // SLA por mês de fechamento
  const porMes = new Map();
  fechadas.forEach((r) => {
    if (r.sla == null || !r.fechamento) return;
    const k = r.fechamento.slice(0, 7);
    if (!porMes.has(k)) porMes.set(k, []);
    porMes.get(k).push(r.sla);
  });
  const meses = [...porMes.keys()].sort();
  desenhar('g-sla', {
    type: 'line',
    data: {
      labels: meses.map((m) => {
        const [a, mm] = m.split('-');
        return new Date(a, mm - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
      }),
      datasets: [
        { label: 'SLA médio (dias)', data: meses.map((m) => Math.round(media(porMes.get(m)))),
          borderColor: '#400FF2', backgroundColor: '#400FF2', tension: 0.25, pointRadius: 3 },
        { label: 'Prazo padrão (30 dias)', data: meses.map(() => 30),
          borderColor: '#3D4C6F', borderDash: [6, 4], borderWidth: 1, pointRadius: 0 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 12 } } },
      scales: { y: { beginAtZero: true }, x: { grid: { display: false } } },
    },
  });

  barras('g-area', contar(L, 'area'), { horizontal: true });
  barras('g-lid', contar(L, 'lideranca').slice(0, 12), { horizontal: true });
  barras('g-bu', contar(L, 'bu'));
  barras('g-tipo', contar(L, 'tipo'));

  // Recrutadoras
  const grupos = new Map();
  L.forEach((r) => {
    const k = r.recrutadora || 'Não informado';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(r);
  });
  const linhasRec = [...grupos.entries()]
    .map(([nome, rs]) => {
      const f = rs.filter((r) => r.status === 'Fechada');
      const s = f.map((r) => r.sla).filter((v) => v != null);
      const p = noPrazo(f);
      return [nome, rs.length, rs.filter((r) => r.status === 'Em andamento').length, f.length,
        s.length ? fmt(media(s)) : '—', p.pct == null ? '—' : fmt(p.pct) + '%'];
    })
    .sort((a, b) => b[1] - a[1]);
  tabela('#t-rec', ['Recrutadora', 'Vagas', 'Em andamento', 'Fechadas', 'SLA médio (dias)', '% no prazo'],
    linhasRec, [1, 2, 3, 4, 5]);

  // Vagas em andamento
  const linhasAbertas = andamento
    .map((r) => ({ r, d: diasEmAberto(r) }))
    .sort((a, b) => (b.d ?? -1) - (a.d ?? -1))
    .map(({ r, d }) => {
      let situacao = '—';
      if (d != null && r.prazo) {
        if (d > r.prazo) situacao = { classe: 'erro', texto: 'Acima do prazo' };
        else if (d >= r.prazo - 5) situacao = { classe: 'alerta', texto: 'Em risco' };
        else situacao = { classe: 'ok', texto: 'No prazo' };
      }
      return [r.vaga, r.area, r.lideranca, r.recrutadora, dataBR(r.abertura), d ?? '—', r.prazo ?? '—', situacao];
    });
  tabela('#t-abertas', ['Vaga', 'Área', 'Liderança', 'Recrutadora', 'Abertura', 'Dias em aberto', 'Prazo', 'Situação'],
    linhasAbertas, [5, 6]);
}

iniciar();
