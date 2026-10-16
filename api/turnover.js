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

// ---------- PLANILHA (use a planilha BASE, sem dados pessoais) ----------
//   https://docs.google.com/spreadsheets/d/  ID  /edit#gid=  NÚMERO DA ABA
const PLANILHA_TURNOVER = {
  id: '1OTxTvrVfbOcQV-lT0m_85DtboTI7cDwa_Q--jMfBTQM',        // ID da planilha
  gidDesligamentos: '0',                                     // aba de desligamentos
  gidIndicadores: '',                                        // opcional: só se quiser informar os números à mão
};
const vazio = (v) => !v || String(v).startsWith('COLE_AQUI');
const SHEET_ID = process.env.SHEET_ID_TURNOVER || (vazio(PLANILHA_TURNOVER.id) ? '' : PLANILHA_TURNOVER.id);
const GID_DESLIG = process.env.GID_DESLIGAMENTOS || (vazio(PLANILHA_TURNOVER.gidDesligamentos) ? '' : PLANILHA_TURNOVER.gidDesligamentos);
const GID_IND = process.env.GID_INDICADORES || (vazio(PLANILHA_TURNOVER.gidIndicadores) ? '' : PLANILHA_TURNOVER.gidIndicadores);

// LISTA BRANCA — únicas colunas lidas (nomes aceitos, sem acento, maiúsculo)
const CAMPOS_DESLIG = {
  data:     ['DT DESLIGAMENTO', 'DT DE DESLIGAMENTO', 'DATA DESLIGAMENTO', 'DATA DE DESLIGAMENTO',
             'DATA DO DESLIGAMENTO', 'DESLIGAMENTO', 'DT SAIDA', 'DT DE SAIDA', 'DATA DE SAIDA'],
  admissao: ['DT ADMISSAO', 'DT DE ADMISSAO', 'DATA DE ADMISSAO', 'DATA ADMISSAO', 'ADMISSAO'],
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
  // número de série do Google/Excel (ex.: 46023 = 01/01/2026)
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  // "15 de jan. de 2026", "15-jan-2026", "15/janeiro/2026"
  const t = normalizar(v);
  m = t.match(/^(\d{1,2})[\s\/.-]*(?:DE\s+)?([A-Z]{3})[A-Z]*\.?[\s\/.-]*(?:DE\s+)?(\d{2,4})/);
  if (m && ABREV.includes(m[2])) {
    const ano = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${ano}-${String(ABREV.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  // "15/01/2026", "15.01.2026", "15-01-2026"
  m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
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

// Texto curto e padronizado (motivo é categoria, não texto livre)
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
    for (const nome of aceitos) { idx = nomes.indexOf(nome); if (idx >= 0) break; } // respeita a ordem de preferência
    // se não achou o nome exato, procura um cabeçalho "parecido" (ex.: "DT. ADMISSÃO", "Data Admissão (dd/mm)")
    if (idx < 0 && PARECIDO[campo]) idx = nomes.findIndex(PARECIDO[campo]);
    mapa[campo] = idx;
  }
  return { iCab, mapa, cabecalho: linhas[iCab] };
}

// Cabeçalhos "parecidos" aceitos quando o nome exato não existe
const PARECIDO = {
  admissao: (n) => n.includes('ADMISS') && !n.includes('TEMPO'),
  data: (n) => n.includes('DESLIG') && (n.includes('DT') || n.includes('DATA')) && !n.includes('TIPO') && !n.includes('MOTIVO'),
};

const pegar = (col, i) => (i >= 0 ? (col[i] ?? '').trim() : '');

// ---------- leitura (com cache de 60s para não sobrecarregar o Google) ----------
let cache = { quando: 0, dados: null };

async function lerTudo() {
  if (cache.dados && Date.now() - cache.quando < 60000) return cache.dados;

  const linhasD = await baixarCSV(GID_DESLIG, 'desligamentos');
  const mD = mapear(linhasD, CAMPOS_DESLIG, 'tipo');
  if (!mD) throw new Error('Não encontrei a coluna "Tipo do desligamento" na aba de desligamentos.');
  if (mD.mapa.data < 0) throw new Error('Não encontrei a coluna com a DATA DO DESLIGAMENTO (ex.: "DT DESLIGAMENTO").');
  const hoje = new Date().toISOString().slice(0, 10);
  // Uma linha por pessoa (ativas e desligadas). Guardamos só datas e categorias.
  const pessoas = linhasD.slice(mD.iCab + 1).map((col) => {
    const adm = paraData(pegar(col, mD.mapa.admissao));
    let desl = paraData(pegar(col, mD.mapa.data));
    if (desl && desl > hoje) desl = null; // desligamento futuro ainda não conta
    if (!adm && !desl) return null;
    return {
      adm, desl,
      time: pegar(col, mD.mapa.time) || 'Não informado',
      estado: pegar(col, mD.mapa.estado) || 'Não informado',
      tipo: padronizarTipo(pegar(col, mD.mapa.tipo)),
      motivo: categoria(pegar(col, mD.mapa.motivo)),
    };
  }).filter(Boolean);
  const deslig = pessoas.filter((p) => p.desl).map((p) => ({ ...p, mes: p.desl.slice(0, 7) }));

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

  const exAdm = linhasD.slice(mD.iCab + 1).map((col) => pegar(col, mD.mapa.admissao)).find(Boolean) || '(vazio)';
  const formatoAdm = exAdm.replace(/\d/g, '9');

  cache = { quando: Date.now(), dados: { pessoas, deslig, ind, mD, mI, formatoAdm } };
  return cache.dados;
}

// ---------- cálculo (tudo agregado) ----------
const contar = (lista, campo) => {
  const m = new Map();
  lista.forEach((r) => m.set(r[campo], (m.get(r[campo]) || 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const pct = (a, b) => (b ? Math.round((10000 * a) / b) / 100 : null);

// Último dia do mês "2026-03" → "2026-03-31"
const fimDoMes = (m) => {
  const [a, mm] = m.split('-').map(Number);
  return new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10);
};
const somaMes = (m, n) => {
  const [a, mm] = m.split('-').map(Number);
  const d = new Date(Date.UTC(a, mm - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

function calcular({ pessoas, deslig, ind, mI, mD }, { time, ano, mes }) {
  const hoje = new Date().toISOString().slice(0, 10);
  const mesAtual = hoje.slice(0, 7);
  const noPeriodo = (m) => (!ano || m.startsWith(ano)) && (!mes || Number(m.slice(5, 7)) === Number(mes));
  const doTime = (r) => !time || r.time === time;

  const P = pessoas.filter(doTime);
  const D = deslig.filter((r) => noPeriodo(r.mes) && doTime(r));

  // Meses do período (até o mês atual)
  const todosMeses = [...new Set([
    ...pessoas.filter((p) => p.adm).map((p) => p.adm.slice(0, 7)),
    ...deslig.map((r) => r.mes),
  ])].filter((m) => m <= mesAtual).sort();
  // Lista contínua de meses do período, até o mês atual
  const inicioFaixa = ano ? `${ano}-01` : todosMeses[0];
  const fimFaixa = ano ? (`${ano}-12` < mesAtual ? `${ano}-12` : mesAtual) : mesAtual;
  const meses = [];
  if (inicioFaixa) for (let m = inicioFaixa; m <= fimFaixa; m = somaMes(m, 1)) if (noPeriodo(m)) meses.push(m);

  // ---- Fonte 1 (preferida): aba Indicadores, se existir ----
  const usarAba = mI && ind.length && !(time && !(mI.mapa.time >= 0));
  // ---- Fonte 2: calculado a partir das datas de admissão/desligamento ----
  const temAdmissao = mD && mD.mapa.admissao >= 0 && pessoas.some((p) => p.adm);

  const ativosEm = (data) => P.filter((p) => p.adm && p.adm <= data && (!p.desl || p.desl > data)).length;
  let contratacoes = null, hcMedio = null, contrPorMes = {};

  if (usarAba) {
    const I = ind.filter((r) => noPeriodo(r.mes) && doTime(r));
    meses.forEach((m) => { contrPorMes[m] = I.filter((r) => r.mes === m).reduce((s, r) => s + r.contratacoes, 0); });
    contratacoes = I.reduce((s, r) => s + r.contratacoes, 0);
    const hcs = [...new Set(I.map((r) => r.mes))].map((m) => I.filter((r) => r.mes === m && r.headcount != null)
      .reduce((s, r) => s + r.headcount, 0)).filter((v) => v > 0);
    hcMedio = hcs.length ? hcs.reduce((a, b) => a + b, 0) / hcs.length : null;
  } else if (temAdmissao && meses.length) {
    meses.forEach((m) => { contrPorMes[m] = P.filter((p) => p.adm && p.adm.slice(0, 7) === m && p.adm <= hoje).length; });
    contratacoes = Object.values(contrPorMes).reduce((a, b) => a + b, 0);
    // Headcount médio = média entre o início do período e o fim de cada mês
    const inicio = new Date(Date.UTC(+meses[0].slice(0, 4), +meses[0].slice(5, 7) - 1, 0)).toISOString().slice(0, 10);
    const pontos = [ativosEm(inicio), ...meses.map((m) => ativosEm(fimDoMes(m) < hoje ? fimDoMes(m) : hoje))];
    const validos = pontos.filter((v) => v > 0);
    hcMedio = validos.length ? validos.reduce((a, b) => a + b, 0) / validos.length : null;
  }

  // Fórmulas iguais às do Power BI:
  //  Turnover geral      = ((contratações + desligamentos) / 2) / HC
  //  Turnover voluntário = desligamentos voluntários / HC   (antes era "14" digitado à mão; agora conta sozinho)
  //  Retenção            = 1 − turnover voluntário
  const vol = D.filter((r) => r.tipo === 'Voluntário').length;
  const turnoverGeral = hcMedio && contratacoes != null ? pct((contratacoes + D.length) / 2, hcMedio) : null;
  const turnoverVoluntario = hcMedio ? pct(vol, hcMedio) : null;

  const porMes = meses.map((m) => ({
    mes: m,
    desligamentos: D.filter((r) => r.mes === m).length,
    contratacoes: contratacoes == null ? null : (contrPorMes[m] || 0),
  }));

  const total = D.length;
  return {
    kpis: {
      contratacoes,
      desligamentos: total,
      headcountMedio: hcMedio ? Math.round(hcMedio) : null,
      ativosHoje: temAdmissao ? ativosEm(hoje) : null,
      turnoverGeral,
      turnoverVoluntario,
      // Igual ao Power BI: Retenção = 1 − Turnover Voluntário (em branco se o voluntário for < 0% ou > 100%)
      retencao: turnoverVoluntario == null || turnoverVoluntario < 0 || turnoverVoluntario > 100
        ? null : Math.round((100 - turnoverVoluntario) * 100) / 100,
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
        desligamentos: {
          pessoasNaPlanilha: dados.pessoas.length,
          desligados: dados.deslig.length,
          ativos: dados.pessoas.filter((p) => !p.desl).length,
          comDataDeAdmissao: dados.pessoas.filter((p) => p.adm).length,
          formatoDaAdmissao: dados.formatoAdm, // só o FORMATO (números viram 9), nunca a data real
          colunas: colunas(dados.mD, CAMPOS_DESLIG),
        },
        indicadores: dados.mI
          ? { linhas: dados.ind.length, colunas: colunas(dados.mI, CAMPOS_IND) }
          : 'aba Indicadores não configurada (contratações e headcount calculados pelas datas de admissão/desligamento)',
      });
    }

    const filtro = { time: p.get('time') || '', ano: p.get('ano') || '', mes: p.get('mes') || '' };
    const anos = [...new Set([...dados.deslig.map((r) => r.mes), ...dados.ind.map((r) => r.mes)].map((m) => m.slice(0, 4)))].sort().reverse();
    const times = [...new Set(dados.pessoas.map((r) => r.time))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

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