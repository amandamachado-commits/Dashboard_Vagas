// =============================================================
//  API do dashboard de TURNOVER.
//
//  SEGURANÇA
//  - Lê a planilha no servidor e devolve SÓ NÚMEROS AGREGADOS
//    (contagens e percentuais). Nenhuma linha individual sai daqui.
//  - Só as colunas da LISTA BRANCA são usadas. Nome, Nome Social,
//    Data de Nascimento, PCD, Escolaridade, Idade, Cargo e Cidade
//    são descartadas na leitura e nunca saem do servidor.
//
//  Filtros: /api/turnover?time=Vendas&ano=2026&mes=3
//  Diagnóstico (só contagens): /api/turnover?diagnostico=1
// =============================================================

// ---------- PLANILHA ----------
//   https://docs.google.com/spreadsheets/d/  ID  /edit#gid=  NÚMERO DA ABA
const PLANILHA_TURNOVER = {
  id: '1OTxTvrVfbOcQV-lT0m_85DtboTI7cDwa_Q--jMfBTQM',        // ID da planilha
  gidDesligamentos: '0',                                     // aba de desligamentos
  gidIndicadores:'123456789',      // 👉 número da aba Indicadores
};
const vazio = (v) => !v || String(v).startsWith('COLE_AQUI');
const SHEET_ID = process.env.SHEET_ID_TURNOVER || (vazio(PLANILHA_TURNOVER.id) ? '' : PLANILHA_TURNOVER.id);
const GID_DESLIG = process.env.GID_DESLIGAMENTOS || (vazio(PLANILHA_TURNOVER.gidDesligamentos) ? '' : PLANILHA_TURNOVER.gidDesligamentos);
const GID_IND = process.env.GID_INDICADORES || (vazio(PLANILHA_TURNOVER.gidIndicadores) ? '' : PLANILHA_TURNOVER.gidIndicadores);

// LISTA BRANCA — únicas colunas usadas (nomes aceitos, sem acento, maiúsculo)
const CAMPOS_DESLIG = {
  data:     ['DT DESLIGAMENTO', 'DT DE DESLIGAMENTO', 'DATA DESLIGAMENTO', 'DATA DE DESLIGAMENTO',
             'DATA DO DESLIGAMENTO', 'DESLIGAMENTO', 'DT SAIDA', 'DT DE SAIDA', 'DATA DE SAIDA'],
  time:     ['SETOR', 'TIME', 'AREA'],
  estado:   ['ESTADO', 'UF'],
  tipo:     ['TIPO DO DESLIGAMENTO', 'TIPO DE DESLIGAMENTO', 'TIPO DESLIGAMENTO'],
  motivo:   ['MOTIVO', 'MOTIVO DO DESLIGAMENTO', 'MOTIVO DESLIGAMENTO'],
};
const CAMPOS_IND = {
  mes:           ['MES', 'MES/ANO', 'COMPETENCIA', 'DATA'],
  time:          ['SETOR', 'TIME', 'AREA'],
  contratacoes:  ['CONTRATACOES', 'ADMISSOES', 'CONTRATADOS'],
  headcount:     ['HEADCOUNT', 'HC', 'ATIVOS', 'COLABORADORES'],
};

const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho',
  'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const ABREV = NOMES_MES.map((m) => m.normalize('NFD').replace(/[\u0300-\u036f]/g, '').slice(0, 3).toUpperCase());

const normalizar = (s) =>
  String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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
  if (+a <= 12 && +b > 12) { dia = b; mes = a; }
  else if (+a <= 12 && +b <= 12 && process.env.DATE_ORDER === 'mdy') { dia = b; mes = a; }
  return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

// "01/2026", "jan/2026", "Janeiro 2026", "2026-01", "01/01/2026" → "2026-01"
function paraMes(v) {
  const t = normalizar(v);
  if (!t) return null;
  const d = paraData(v);
  if (d) return d.slice(0, 7);
  let m = t.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = t.match(/^([A-Z]{3})[A-Z]*[\/\s.-]*(?:DE\s+)?(\d{2,4})$/);
  if (m && ABREV.includes(m[1])) {
    const ano = m[2].length === 2 ? '20' + m[2] : m[2];
    return `${ano}-${String(ABREV.indexOf(m[1]) + 1).padStart(2, '0')}`;
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

function padronizarTipo(s) {
  const n = normalizar(s);
  if (!n) return 'Não informado';
  if (n.includes('ENCERRAMENTO') || n.includes('TERMINO') || n.includes('FIM DE CONTRATO') ||
      n.includes('EXPERIENCIA')) return 'Encerramento de contrato';
  if (n.includes('INVOLUNT')) return 'Involuntário';
  if (n.includes('VOLUNT') || n.includes('PEDIDO')) return 'Voluntário';
  if (n.includes('DEMISS') || n.includes('DISPENSA') || n.includes('JUSTA CAUSA')) return 'Involuntário';
  return 'Outro';
}

// Motivo como categoria curta (não texto livre)
const categoria = (s) => {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (!t) return 'Não informado';
  // "Baixa Performance" e "Baixa performance" viram a mesma categoria
  const p = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  return p.length > 40 ? p.slice(0, 40) + '…' : p;
};

async function baixarCSV(gid, rotulo) {
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;
  const g = String(gid || '').replace(/\D/g, '');
  const urls = [`${base}/export?format=csv&gid=${g}`, `${base}/gviz/tq?tqx=out:csv&headers=0&gid=${g}`];
  const falhas = [];
  for (const url of urls) {
    try {
      const r = await fetch(url, { redirect: 'follow' });
      if (r.ok && (r.headers.get('content-type') || '').includes('csv')) return parseCSV(await r.text());
      falhas.push(`HTTP ${r.status}`);
    } catch (e) { falhas.push(e.message); }
  }
  throw new Error(`Não foi possível ler a aba de ${rotulo} (${falhas.join(' · ')}). ` +
    'Confira o ID, o gid e se a planilha está compartilhada por link.');
}

function mapear(linhas, campos, campoChave) {
  const iCab = linhas.findIndex((l) => l.map(normalizar).some((c) => campos[campoChave].includes(c)));
  if (iCab === -1) return null;
  const nomes = linhas[iCab].map(normalizar);
  const mapa = {};
  for (const [campo, aceitos] of Object.entries(campos)) {
    let idx = -1;
    for (const nome of aceitos) { idx = nomes.indexOf(nome); if (idx >= 0) break; }
    mapa[campo] = idx;
  }
  return { iCab, mapa, cabecalho: linhas[iCab] };
}

const pegar = (col, i) => (i >= 0 ? (col[i] ?? '').trim() : '');

// ---------- leitura (cache de 60s) ----------
let cache = { quando: 0, dados: null };

async function lerTudo() {
  if (cache.dados && Date.now() - cache.quando < 60000) return cache.dados;

  const linhasD = await baixarCSV(GID_DESLIG, 'desligamentos');
  const mD = mapear(linhasD, CAMPOS_DESLIG, 'tipo');
  if (!mD) throw new Error('Não encontrei a coluna "Tipo do desligamento" na aba de desligamentos.');
  if (mD.mapa.data < 0) throw new Error('Não encontrei a coluna com a DATA DO DESLIGAMENTO (ex.: "DT DESLIGAMENTO").');
  const hoje = new Date();
  const deslig = linhasD.slice(mD.iCab + 1).map((col) => {
    const data = paraData(pegar(col, mD.mapa.data));
    if (!data || new Date(data) > hoje) return null;
    return {
      mes: data.slice(0, 7),
      time: pegar(col, mD.mapa.time) || 'Não informado',
      estado: pegar(col, mD.mapa.estado) || 'Não informado',
      tipo: padronizarTipo(pegar(col, mD.mapa.tipo)),
      motivo: categoria(pegar(col, mD.mapa.motivo)),
    };
  }).filter(Boolean);

  let ind = [], mI = null;
  if (GID_IND) {
    const linhasI = await baixarCSV(GID_IND, 'indicadores');
    mI = mapear(linhasI, CAMPOS_IND, 'mes');
    if (mI) {
      ind = linhasI.slice(mI.iCab + 1).map((col) => {
        const mes = paraMes(pegar(col, mI.mapa.mes));
        if (!mes) return null;
        return {
          mes,
          time: pegar(col, mI.mapa.time),
          contratacoes: paraNumero(pegar(col, mI.mapa.contratacoes)) ?? 0,
          headcount: paraNumero(pegar(col, mI.mapa.headcount)),
        };
      }).filter(Boolean);
    }
  }

  cache = { quando: Date.now(), dados: { deslig, ind, mD, mI } };
  return cache.dados;
}

// ---------- cálculo (tudo agregado) ----------
const contar = (lista, campo) => {
  const m = new Map();
  lista.forEach((r) => m.set(r[campo], (m.get(r[campo]) || 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const pct = (a, b) => (b ? Math.round((10000 * a) / b) / 100 : null);

function calcular({ deslig, ind, mI }, { time, ano, mes }) {
  const noPeriodo = (m) => (!ano || m.startsWith(ano)) && (!mes || Number(m.slice(5, 7)) === Number(mes));
  const D = deslig.filter((r) => noPeriodo(r.mes) && (!time || r.time === time));

  const indTemTime = mI && mI.mapa.time >= 0;
  const usarInd = !(time && !indTemTime);
  const I = usarInd ? ind.filter((r) => noPeriodo(r.mes) && (!time || r.time === time)) : [];

  const mesesI = [...new Set(I.map((r) => r.mes))];
  const hcPorMes = mesesI.map((m) => I.filter((r) => r.mes === m && r.headcount != null)
    .reduce((s, r) => s + r.headcount, 0)).filter((v) => v > 0);
  const hcMedio = hcPorMes.length ? hcPorMes.reduce((a, b) => a + b, 0) / hcPorMes.length : null;
  const contratacoes = usarInd && ind.length ? I.reduce((s, r) => s + r.contratacoes, 0) : null;

  const vol = D.filter((r) => r.tipo === 'Voluntário').length;
  const turnoverGeral = hcMedio && contratacoes != null ? pct((contratacoes + D.length) / 2, hcMedio) : null;
  const turnoverVoluntario = hcMedio ? pct(vol, hcMedio) : null;

  const mesAtual = new Date().toISOString().slice(0, 7);
  const meses = [...new Set([...D.map((r) => r.mes), ...I.map((r) => r.mes)])].filter((m) => m <= mesAtual).sort();
  const porMes = meses.map((m) => ({
    mes: m,
    desligamentos: D.filter((r) => r.mes === m).length,
    contratacoes: usarInd && ind.length ? I.filter((r) => r.mes === m).reduce((s, r) => s + r.contratacoes, 0) : null,
  }));

  const total = D.length;
  return {
    kpis: {
      contratacoes,
      desligamentos: total,
      headcountMedio: hcMedio ? Math.round(hcMedio) : null,
      turnoverGeral,
      turnoverVoluntario,
      retencao: turnoverVoluntario == null ? null : Math.round((100 - turnoverVoluntario) * 100) / 100,
    },
    porTipo: contar(D, 'tipo').map(([k, n]) => [k, n, pct(n, total)]),
    porEstado: contar(D, 'estado').map(([k, n]) => [k, n, pct(n, total)]),
    porMotivo: contar(D, 'motivo'),
    porMes,
  };
}

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!SHEET_ID || !GID_DESLIG) {
    return res.status(500).json({ erro: 'Preencha o ID e o gid da planilha em api/turnover.js (PLANILHA_TURNOVER).' });
  }
  const p = new URL(req.url, 'http://x').searchParams;
  try {
    const dados = await lerTudo();

    if (p.has('diagnostico')) {
      res.setHeader('Cache-Control', 'no-store');
      const colunas = (m, campos) => Object.fromEntries(Object.keys(campos)
        .map((c) => [c, m && m.mapa[c] >= 0 ? m.cabecalho[m.mapa[c]] : '(não encontrada)']));
      return res.status(200).json({
        desligamentos: { total: dados.deslig.length, colunas: colunas(dados.mD, CAMPOS_DESLIG) },
        indicadores: dados.mI
          ? { linhas: dados.ind.length, colunas: colunas(dados.mI, CAMPOS_IND) }
          : 'aba Indicadores não configurada (sem ela não há contratações nem % de turnover)',
      });
    }

    const filtro = { time: p.get('time') || '', ano: p.get('ano') || '', mes: p.get('mes') || '' };
    const anos = [...new Set([...dados.deslig, ...dados.ind].map((r) => r.mes.slice(0, 4)))].sort().reverse();
    const times = [...new Set(dados.deslig.map((r) => r.time))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({
      atualizadoEm: new Date(cache.quando).toISOString(),
      opcoes: { times, anos, meses: NOMES_MES },
      ...calcular(dados, filtro),
    });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ erro: e.message || 'Não foi possível ler a planilha de turnover.' });
  }
}