// =============================================================
//  API do dashboard: lê a planilha NO SERVIDOR e devolve
//  SOMENTE os campos liberados. Nada além da lista abaixo
//  chega ao navegador (orçamento, pessoa substituída, vaga
//  afirmativa/PCD e código da vaga ficam de fora).
//
//  Versão 2:
//  - encontra as colunas pelo NOME do cabeçalho (não quebra se
//    alguém inserir uma coluna nova)
//  - lê todas as linhas da aba, sem depender de começar na linha 4
//  - calcula o SLA quando a célula estiver vazia
//  - diagnóstico em /api/vagas?diagnostico=1 (só contagens)
// =============================================================

const SHEET_ID = process.env.SHEET_ID;

// Abas lidas. Se a aba tiver outro nome na planilha, ajuste aqui.
// "gid" é opcional: é o número que aparece no fim do link da aba
// (…#gid=123456). Quando preenchido, a leitura fica mais confiável.
const ABAS = [
  { ano: 2024, nome: 'Controle de Vagas 2024', gid: process.env.GID_2024 },
  { ano: 2025, nome: ' Controle de Vagas 2025', gid: process.env.GID_2025 },
  { ano: 2026, nome: 'Controle de Vagas 2026', gid: process.env.GID_2026 },
];

// LISTA BRANCA. "cabecalho" = nome da coluna na planilha (sem acento,
// maiúsculo). "ultima" = quando o nome se repete, usa a última coluna.
// "desvio" = posição em relação à coluna STATUS DA VAGA, usada se o
// cabeçalho não for encontrado.
const CAMPOS_LIBERADOS = {
  vaga:         { cabecalho: 'VAGA',                     desvio: -1 },
  status:       { cabecalho: 'STATUS DA VAGA',           desvio: 0 },
  tipo:         { cabecalho: 'TIPO DA VAGA',             desvio: 2 },
  selecao:      { cabecalho: 'TIPO DA SELECAO',          desvio: 3 },
  area:         { cabecalho: 'AREA',                     desvio: 6, ultima: true },
  lideranca:    { cabecalho: 'LIDERANCA RESPONSAVEL',    desvio: 7, ultima: true },
  bu:           { cabecalho: 'BU',                       desvio: 8, ultima: true },
  recrutadora:  { cabecalho: 'RECRUTADORA RESPONSAVEL',  desvio: 9 },
  abertura:     { cabecalho: 'DATA DE ABERTURA',         desvio: 10 },
  fechamento:   { cabecalho: 'DATA DE FECHAMENTO',       desvio: 11 },
  congelamento: { cabecalho: 'DIAS DE CONGELAMENTO',     desvio: 12, comeca: true },
  prazo:        { cabecalho: 'PRAZO',                    desvio: 13 },
  sla:          { cabecalho: 'SLA',                      desvio: 14 },
  statusPrazo:  { cabecalho: 'STATUS DO PRAZO',          desvio: 15 },
};

const CAMPOS_DATA = ['abertura', 'fechamento'];
const CAMPOS_NUMERO = ['congelamento', 'prazo', 'sla'];

const normalizar = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();

function parseCSV(texto) {
  const linhas = [];
  let linha = [], atual = '', aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { atual += '"'; i++; } else aspas = false;
      } else atual += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(atual); atual = ''; }
    else if (c === '\n') { linha.push(atual); linhas.push(linha); linha = []; atual = ''; }
    else if (c !== '\r') atual += c;
  }
  if (atual || linha.length) { linha.push(atual); linhas.push(linha); }
  return linhas;
}

// Aceita 20/01/2026, 1/20/2026, 2026-01-20 e 20/01/26
function paraData(v) {
  v = (v || '').trim();
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let [, a, b, ano] = m;
  if (ano.length === 2) ano = '20' + ano;
  let dia = a, mes = b;
  if (+a <= 12 && +b > 12) { dia = b; mes = a; }                  // claramente mês/dia
  else if (+a <= 12 && +b <= 12 && process.env.DATE_ORDER === 'mdy') { dia = b; mes = a; }
  return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

function paraNumero(v) {
  v = String(v || '').trim();
  if (!v) return null;
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function situacaoPrazo(s) {
  s = (s || '').toLowerCase();
  if (s.includes('dentro')) return 'Dentro do prazo';
  if (s.includes('em dia')) return 'Em dia';
  if (s.includes('fora')) return 'Fora do prazo';
  if (s.includes('atras')) return 'Atrasada';
  if (s.includes('cancel')) return 'Cancelada';
  if (s.includes('congel')) return 'Congelada';
  return '';
}

function padronizarStatus(s) {
  const n = normalizar(s);
  if (!n) return '';
  if (n.startsWith('FECHAD')) return 'Fechada';
  if (n.includes('ANDAMENTO') || n.startsWith('ABERT')) return 'Em andamento';
  if (n.startsWith('CONGELAD')) return 'Congelada';
  if (n.startsWith('CANCELAD')) return 'Cancelada';
  return s.trim();
}

const diasEntre = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

async function baixarCSV({ nome, gid }) {
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;
  const url = gid
    ? `${base}/export?format=csv&gid=${encodeURIComponent(gid)}`
    : `${base}/gviz/tq?tqx=out:csv&headers=0&sheet=${encodeURIComponent(nome)}`;
  const resp = await fetch(url, { redirect: 'follow' });
  const tipo = resp.headers.get('content-type') || '';
  if (!resp.ok || !tipo.includes('csv')) {
    throw new Error(`Não foi possível ler a aba "${nome.trim()}" (a planilha está compartilhada por link?)`);
  }
  return parseCSV(await resp.text());
}

function mapearColunas(cabecalho) {
  const nomes = cabecalho.map(normalizar);
  const iStatus = nomes.indexOf('STATUS DA VAGA');
  const mapa = {};
  for (const [campo, def] of Object.entries(CAMPOS_LIBERADOS)) {
    let idx = -1;
    nomes.forEach((n, i) => {
      const bate = def.comeca ? n.startsWith(def.cabecalho) : n === def.cabecalho;
      if (bate && (idx === -1 || def.ultima)) idx = i;
    });
    mapa[campo] = idx !== -1 ? idx : iStatus + def.desvio;
  }
  return mapa;
}

async function lerAba(aba) {
  const linhas = await baixarCSV(aba);
  const iCab = linhas.findIndex((l) => l.some((c) => normalizar(c) === 'STATUS DA VAGA'));
  if (iCab === -1) {
    throw new Error(`A aba "${aba.nome.trim()}" não foi encontrada ou não tem a coluna STATUS DA VAGA.`);
  }
  const mapa = mapearColunas(linhas[iCab]);

  const vagas = linhas.slice(iCab + 1)
    .map((col) => {
      const r = { ano: aba.ano };
      for (const campo of Object.keys(CAMPOS_LIBERADOS)) {
        const bruto = (col[mapa[campo]] ?? '').trim();
        if (CAMPOS_DATA.includes(campo)) r[campo] = paraData(bruto);
        else if (CAMPOS_NUMERO.includes(campo)) r[campo] = paraNumero(bruto);
        else r[campo] = bruto;
      }
      r.status = padronizarStatus(r.status);
      // SLA vazio? calcula: fechamento - abertura - dias congelada
      if (r.sla == null && r.abertura && r.fechamento) {
        r.sla = Math.max(0, diasEntre(r.abertura, r.fechamento) - (r.congelamento || 0));
      }
      r.prazoSituacao = situacaoPrazo(r.statusPrazo);
      // Fechada sem status de prazo preenchido? compara SLA x prazo
      if (!r.prazoSituacao && r.status === 'Fechada' && r.sla != null && r.prazo) {
        r.prazoSituacao = r.sla <= r.prazo ? 'Dentro do prazo' : 'Fora do prazo';
      }
      delete r.statusPrazo;
      return r;
    })
    .filter((r) => r.status && (r.vaga || r.area));

  return { vagas, mapa, cabecalho: linhas[iCab], linhasLidas: linhas.length, linhaCabecalho: iCab + 1 };
}

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!SHEET_ID) {
    return res.status(500).json({ erro: 'Variável SHEET_ID não configurada.' });
  }
  const diagnostico = new URL(req.url, 'http://x').searchParams.has('diagnostico');

  try {
    const resultados = await Promise.all(ABAS.map(lerAba));

    if (diagnostico) {
      // Só contagens e nomes de coluna — nenhum dado de pessoa.
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(resultados.map((r, i) => {
        const porStatus = {};
        r.vagas.forEach((v) => { porStatus[v.status] = (porStatus[v.status] || 0) + 1; });
        const colunas = {};
        for (const [campo, idx] of Object.entries(r.mapa)) colunas[campo] = r.cabecalho[idx] ?? '(não encontrada)';
        return {
          aba: ABAS[i].nome.trim(),
          leitura: ABAS[i].gid ? 'gid' : 'nome da aba',
          linhasLidas: r.linhasLidas,
          linhaDoCabecalho: r.linhaCabecalho,
          vagasValidas: r.vagas.length,
          porStatus,
          comSLA: r.vagas.filter((v) => v.sla != null).length,
          comDataAbertura: r.vagas.filter((v) => v.abertura).length,
          colunas,
        };
      }));
    }

    const vagas = resultados.flatMap((r) => r.vagas);
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    return res.status(200).json({ atualizadoEm: new Date().toISOString(), vagas });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ erro: e.message || 'Não foi possível ler a planilha agora.' });
  }
}
