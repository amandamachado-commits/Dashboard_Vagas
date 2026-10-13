// =============================================================
//  API do dashboard: lê a planilha NO SERVIDOR e devolve
//  SOMENTE os campos liberados. Nada além da lista abaixo
//  chega ao navegador (orçamento, pessoa substituída, vaga
//  afirmativa/PCD e código da vaga ficam de fora).
//  >>> Depois de baixar, renomeie para vagas.js e coloque
//      dentro da subpasta "api" <<<
// =============================================================

const SHEET_ID = process.env.SHEET_ID;

// Abas lidas. Atenção: a aba de 2025 tem um espaço antes do nome.
const ABAS = [
  { ano: 2024, nome: 'Controle de Vagas 2024' },
  { ano: 2025, nome: ' Controle de Vagas 2025' },
  { ano: 2026, nome: 'Controle de Vagas 2026' },
];

// LISTA BRANCA — posição da coluna contando a partir da coluna B (B = 0).
// Para liberar um campo novo, ele precisa ser adicionado aqui de propósito.
const CAMPOS_LIBERADOS = {
  vaga: 7,          // I  - VAGA
  status: 8,        // J  - STATUS DA VAGA
  tipo: 10,         // L  - TIPO DA VAGA
  selecao: 11,      // M  - TIPO DA SELEÇÃO
  area: 14,         // P  - ÁREA
  lideranca: 15,    // Q  - LIDERANÇA RESPONSÁVEL
  bu: 16,           // R  - BU
  recrutadora: 17,  // S  - RECRUTADORA RESPONSÁVEL
  abertura: 18,     // T  - DATA DE ABERTURA
  fechamento: 19,   // U  - DATA DE FECHAMENTO
  congelamento: 20, // V  - DIAS DE CONGELAMENTO
  prazo: 21,        // W  - PRAZO
  sla: 22,          // X  - SLA
  statusPrazo: 23,  // Y  - STATUS DO PRAZO
};

const CAMPOS_DATA = ['abertura', 'fechamento'];
const CAMPOS_NUMERO = ['congelamento', 'prazo', 'sla'];

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

// Aceita 20/01/2025, 2025-01-20 e (com DATE_ORDER=mdy) 1/20/2025
function paraData(v) {
  v = (v || '').trim();
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    let [, a, b, ano] = m;
    let dia = a, mes = b;
    if (process.env.DATE_ORDER === 'mdy') { dia = b; mes = a; }
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }
  return null;
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

async function lerAba({ ano, nome }) {
  const url =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
    `?tqx=out:csv&headers=0&range=B4:Y&sheet=${encodeURIComponent(nome)}`;
  const resp = await fetch(url);
  const tipo = resp.headers.get('content-type') || '';
  if (!resp.ok || !tipo.includes('csv')) {
    throw new Error(`Não foi possível ler a aba "${nome.trim()}"`);
  }
  const linhas = parseCSV(await resp.text());

  return linhas
    .map((col) => {
      const r = { ano };
      for (const [campo, i] of Object.entries(CAMPOS_LIBERADOS)) {
        const bruto = (col[i] ?? '').trim();
        if (CAMPOS_DATA.includes(campo)) r[campo] = paraData(bruto);
        else if (CAMPOS_NUMERO.includes(campo)) r[campo] = paraNumero(bruto);
        else r[campo] = bruto;
      }
      r.prazoSituacao = situacaoPrazo(r.statusPrazo);
      delete r.statusPrazo;
      return r;
    })
    .filter((r) => r.status && (r.vaga || r.area));
}

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!SHEET_ID) {
    return res.status(500).json({ erro: 'Variável SHEET_ID não configurada.' });
  }
  try {
    const vagas = (await Promise.all(ABAS.map(lerAba))).flat();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ atualizadoEm: new Date().toISOString(), vagas });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ erro: 'Não foi possível ler a planilha agora.' });
  }
}
