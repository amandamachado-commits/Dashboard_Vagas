// =============================================================
//  Dashboard de vagas — roda no navegador.
//  Só recebe da API os campos liberados (ver api/vagas.js).
// =============================================================

const FILTROS = [
  ['ano', 'Ano'], ['bu', 'BU'], ['area', 'Área'],
  ['lideranca', 'Liderança'], ['recrutadora', 'Recrutadora'], ['status', 'Status'],
  ['tipo', 'Tipo de vaga'],
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
function botaoSair() {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'limpar';
  b.textContent = 'Sair';
  b.addEventListener('click', async () => {
    await fetch('/api/login?sair=1', { method: 'POST' }).catch(() => {});
    location.href = '/login.html';
  });
  $('header').appendChild(b);
}

async function iniciar() {
  botaoSair();
  try {
    const resp = await fetch('/api/vagas');
    if (resp.status === 401) { location.href = '/login.html'; return; }
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
    const label = document.createElement('label');
    label.textContent = rotulo;
    const sel = document.createElement('select');
    sel.id = 'f-' + campo;
    sel.add(new Option('Todos', ''));
    sel.addEventListener('change', render);
    label.appendChild(sel);
    box.appendChild(label);
  });

  // Botão para limpar todos os filtros
  const limpar = document.createElement('button');
  limpar.type = 'button';
  limpar.className = 'limpar';
  limpar.textContent = 'Limpar filtros';
  limpar.addEventListener('click', () => {
    FILTROS.forEach(([c]) => { $('#f-' + c).value = ''; });
    render();
  });
  box.appendChild(limpar);

  // Botão "Mostrar filtros / Ocultar filtros"
  const btn = $('#btn-filtros');
  btn.addEventListener('click', () => {
    const abrir = box.classList.contains('oculto');
    box.classList.toggle('oculto', !abrir);
    btn.textContent = abrir ? 'Ocultar filtros' : 'Mostrar filtros';
    btn.setAttribute('aria-expanded', String(abrir));
  });
}

// Texto ao lado do botão: quais filtros estão ativos
function resumoFiltros() {
  const ativos = FILTROS
    .map(([c, rotulo]) => [rotulo, $('#f-' + c).value])
    .filter(([, v]) => v);
  $('#resumo-filtros').textContent = ativos.length
    ? 'Filtrando por: ' + ativos.map(([r, v]) => `${r} ${v}`).join(' · ')
    : 'Sem filtros: mostrando todas as vagas';
}

// Clique num gráfico: aplica o filtro. Clicar de novo no mesmo valor desfaz.
function filtrarPor(campo, valor) {
  const sel = $('#f-' + campo);
  if (!sel) return;
  const existe = [...sel.options].some((o) => o.value === String(valor));
  if (!existe) return;
  sel.value = sel.value === String(valor) ? '' : String(valor);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const valorDe = (r, c) => String(r[c] ?? '').trim();

// Aplica todos os filtros, menos o que estiver em "ignorar"
const filtrados = (ignorar) =>
  dados.filter((r) => FILTROS.every(([c]) => {
    if (c === ignorar) return true;
    const v = $('#f-' + c).value;
    return !v || valorDe(r, c) === v;
  }));

// Filtros em cascata: cada lista mostra só as opções que existem
// com os outros filtros escolhidos, com a quantidade de vagas.
function atualizarOpcoes() {
  FILTROS.forEach(([campo]) => {
    const sel = $('#f-' + campo);
    const atual = sel.value;
    const cont = new Map();
    filtrados(campo).forEach((r) => {
      const v = valorDe(r, campo);
      if (v) cont.set(v, (cont.get(v) || 0) + 1);
    });
    if (atual && !cont.has(atual)) cont.set(atual, 0); // mantém a escolha atual
    const valores = [...cont.keys()].sort((a, b) => {
      // no filtro Status, "Em andamento" vem sempre primeiro
      if (campo === 'status') {
        if (a === 'Em andamento') return -1;
        if (b === 'Em andamento') return 1;
      }
      return a.localeCompare(b, 'pt-BR', { numeric: true });
    });
    sel.replaceChildren(new Option('Todos', ''));
    valores.forEach((v) => sel.add(new Option(`${v} (${cont.get(v)})`, v)));
    sel.value = atual;
  });
}

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

function barras(id, pares, { horizontal = false, cores, campo } = {}) {
  const selecionado = campo ? $('#f-' + campo).value : '';
  const corBase = (rotulo) => (cores ? cores[rotulo] || '#9884FF' : '#400FF2');
  desenhar(id, {
    type: 'bar',
    data: {
      labels: pares.map((p) => p[0]),
      datasets: [{
        label: 'Vagas',
        data: pares.map((p) => p[1]),
        // barra selecionada fica destacada; as outras ficam claras
        backgroundColor: pares.map((p) =>
          !selecionado || String(p[0]) === selecionado ? corBase(p[0]) : '#D9CDFD'),
        borderRadius: 4,
        maxBarThickness: 32,
      }],
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      maintainAspectRatio: false,
      onClick: (evt, elementos, grafico) => {
        if (!campo || !elementos.length) return;
        const valor = grafico.data.labels[elementos[0].index];
        setTimeout(() => filtrarPor(campo, valor), 0);
      },
      onHover: (evt, elementos) => {
        evt.native.target.style.cursor = campo && elementos.length ? 'pointer' : 'default';
      },
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
  atualizarOpcoes();
  resumoFiltros();
  const L = filtrados();
  const ativos = FILTROS.filter(([c]) => $('#f-' + c).value).length;
  $('#atualizado').dataset.base ??= $('#atualizado').textContent;
  $('#atualizado').textContent = ativos
    ? `Mostrando ${L.length} de ${dados.length} vagas · ${$('#atualizado').dataset.base}`
    : $('#atualizado').dataset.base;

  const fechadas = L.filter((r) => r.status === 'Fechada');
  const andamento = L.filter((r) => r.status === 'Em andamento');
  const slas = fechadas.map((r) => r.sla).filter((v) => v != null);
  const prazo = noPrazo(fechadas);
  const emAberto = andamento.map(diasEmAberto).filter((v) => v != null);
  const acima = andamento.filter((r) => { const d = diasEmAberto(r); return d != null && r.prazo && d > r.prazo; }).length;

  kpis([
    ['Total de vagas', fmt(L.length), ''],
    ['Em andamento', fmt(andamento.length), acima ? `${acima} acima do prazo` : 'nenhuma acima do prazo'],
    ['Fechadas', fmt(fechadas.length), ''],
    ['Congeladas · Canceladas',
      `${L.filter((r) => r.status === 'Congelada').length} · ${L.filter((r) => r.status === 'Cancelada').length}`, ''],
    ['SLA médio', slas.length ? fmt(media(slas)) + ' dias' : '—',
      slas.length ? `${slas.length} vagas fechadas` : 'só vagas fechadas têm SLA', true],
    ['Fechadas no prazo', prazo.pct == null ? '—' : fmt(prazo.pct) + '%', `${prazo.ok} de ${prazo.total}`, true],
    ['Tempo médio em aberto', emAberto.length ? fmt(media(emAberto)) + ' dias' : '—',
      emAberto.length ? `${emAberto.length} vagas em andamento` : 'nenhuma vaga em andamento', true],
  ]);

  // Vagas em andamento (tabela do topo)
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

  // Status
  barras('g-status', contar(L, 'status'), { cores: CORES_STATUS, campo: 'status' });

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

  barras('g-area', contar(L, 'area'), { horizontal: true, campo: 'area' });
  barras('g-lid', contar(L, 'lideranca').slice(0, 12), { horizontal: true, campo: 'lideranca' });
  barras('g-bu', contar(L, 'bu'), { campo: 'bu' });
  barras('g-tipo', contar(L, 'tipo'), { campo: 'tipo' });
}

iniciar();