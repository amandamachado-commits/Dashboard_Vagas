// =============================================================
//  API do dashboard de TURNOVER.
//
//  SEGURANÇA
//  - Lê a planilha no servidor e devolve SÓ NÚMEROS AGREGADOS
//    (contagens e percentuais). Nenhuma linha individual sai daqui.
//  - Só as colunas da LISTA BRANCA são usadas. Nome, Nome Social,
//    Data de Nascimento, PCD, Escolaridade, Idade, Cargo, Cidade e Estado
//    são descartadas na leitura e nunca saem do servidor.
//
//  Filtros: /api/turnover?time=Vendas&ano=2026&mes=3
//  Diagnóstico (só contagens): /api/turnover?diagnostico=1
// =============================================================

// ---------- PLANILHA (use a planilha BASE, sem dados pessoais) ----------
//   https://docs.google.com/spreadsheets/d/  ID  /edit#gid=  NÚMERO DA ABA
const PLANILHA_TURNOVER = {
  id: '1OTxTvrVfbOcQV-lT0m_85DtboTI7cDwa_Q--jMfBTQM',        // 👉 ID da planilha
  gidDesligamentos: '0',                                     // 👉 gid da aba com o quadro de pessoas (0 = primeira aba)
};
const vazio = (v) => !v || String(v).startsWith('COLE_AQUI');
const SHEET_ID = process.env.SHEET_ID_TURNOVER || (vazio(PLANILHA_TURNOVER.id) ? '' : PLANILHA_TURNOVER.id);
const GID_DESLIG = process.env.GID_DESLIGAMENTOS || (vazio(PLANILHA_TURNOVER.gidDesligamentos) ? '' : PLANILHA_TURNOVER.gidDesligamentos);

// LISTA BRANCA — únicas colunas lidas (nomes aceitos, sem acento, maiúsculo)
// Contratações e headcount são calculados a partir de ADMISSÃO + DESLIGAMENTO
// (cada linha é uma pessoa: data de admissão sempre preenchida, data de
// desligamento só preenchida para quem já saiu).
const CAMPOS_DESLIG = {
  data:      ['DT DESLIGAMENTO', 'DT DE DESLIGAMENTO', 'DATA DESLIGAMENTO', 'DATA DE DESLIGAMENTO',
              'DATA DO DESLIGAMENTO', 'DESLIGAMENTO', 'DT SAIDA', 'DT DE SAIDA', 'DATA DE SAIDA'],
  admissao:  ['DATA DE ADMISSAO', 'DT ADMISSAO', 'DT DE ADMISSAO', 'DATA ADMISSAO', 'ADMISSAO'],
  time:      ['SETOR', 'TIME', 'AREA'],
  tipo:      ['TIPO DO DESLIGAMENTO', 'TIPO DE DESLIGAMENTO', 'TIPO DESLIGAMENTO'],
  motivo:    ['MOTIVO', 'MOTIVO DO DESLIGAMENTO', 'MOTIVO DESLIGAMENTO'],
};

const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho',
  'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

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

// Entende datas em vários formatos e devolve "AAAA-MM-DD" (ou null):
//   10/01/2026 · 10-01-2026 · 10.01.2026 · 2026-01-10 · 10/jan/2026 · 10 de janeiro de 2026
//   jan 10, 2026 · 45667 (número de série do Google Sheets / Excel)
const MESES_TXT = { JAN: 1, FEV: 2, FEB: 2, MAR: 3, ABR: 4, APR: 4, MAI: 5, MAY: 5, JUN: 6, JUL: 7,
  AGO: 8, AUG: 8, SET: 9, SEP: 9, OUT: 10, OCT: 10, NOV: 11, DEZ: 12, DEC: 12 };
function montarData(ano, mes, dia) {
  ano = String(ano); if (ano.length === 2) ano = '20' + ano;
  mes = Number(mes); dia = Number(dia);
  if (!(mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31)) return null;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}
function paraData(v) {
  v = String(v || '').trim();
  if (!v) return null;
  let m;
  // 2026-01-10 (ou 2026/01/10)
  if ((m = v.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return montarData(m[1], m[2], m[3]);
  // 10/01/2026 · 10-01-2026 · 10.01.2026
  if ((m = v.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/))) {
    let [, a, b, ano] = m, dia = a, mes = b;
    if (+a <= 12 && +b > 12) { dia = b; mes = a; }
    else if (+a <= 12 && +b <= 12 && process.env.DATE_ORDER === 'mdy') { dia = b; mes = a; }
    return montarData(ano, mes, dia);
  }
  // Número de série (Sheets/Excel): dias desde 30/12/1899
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const n = Math.floor(Number(v));
    if (n > 20000 && n < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return d.toISOString().slice(0, 10);
    }
  }
  // Mês escrito: "10/jan/2026", "10 de janeiro de 2026", "10-jan-26", "jan 10, 2026"
  const t = normalizar(v).replace(/\./g, '');
  if ((m = t.match(/^(\d{1,2})[\s\/-]*(?:DE\s+)?([A-Z]{3})[A-Z]*[\s\/-]*(?:DE\s+)?(\d{2,4})/))) {
    if (MESES_TXT[m[2]]) return montarData(m[3], MESES_TXT[m[2]], m[1]);
  }
  if ((m = t.match(/^([A-Z]{3})[A-Z]*\s+(\d{1,2}),?\s+(\d{4})/))) {
    if (MESES_TXT[m[1]]) return montarData(m[3], MESES_TXT[m[1]], m[2]);
  }
  return null;
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
  return t.length > 40 ? t.slice(0, 40) + '…' : t.charAt(0).toUpperCase() + t.slice(1);
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
    mapa[campo] = idx;
  }
  return { iCab, mapa, cabecalho: linhas[iCab] };
}

const pegar = (col, i) => (i >= 0 ? (col[i] ?? '').trim() : '');

// ---------- leitura (com cache de 60s para não sobrecarregar o Google) ----------
let cache = { quando: 0, dados: null };

async function lerTudo() {
  if (cache.dados && Date.now() - cache.quando < 60000) return cache.dados;

  const linhasD = await baixarCSV(GID_DESLIG, 'desligamentos');
  const mD = mapear(linhasD, CAMPOS_DESLIG, 'tipo');
  if (!mD) throw new Error('Não encontrei a coluna "Tipo do desligamento" na aba de desligamentos.');
  if (mD.mapa.data < 0) throw new Error('Não encontrei a coluna com a DATA DO DESLIGAMENTO (ex.: "DT DESLIGAMENTO").');
  const hoje = new Date();
  const hojeISO = hoje.toISOString().slice(0, 10);
  // Contadores para o diagnóstico (sem nenhum dado pessoal)
  const info = { linhasLidas: 0, semData: 0, dataNaoEntendida: 0, dataNoFuturo: 0, formatosNaoEntendidos: [] };
  // Cada linha é uma pessoa: fica no array mesmo sem desligamento (pessoa ativa),
  // pois a admissão dela conta para contratações e para o headcount.
  const pessoas = linhasD.slice(mD.iCab + 1).map((col) => {
    if (!col.some((c) => String(c).trim())) return null; // linha vazia
    info.linhasLidas++;

    const brutoDeslig = pegar(col, mD.mapa.data);
    let dataDeslig = paraData(brutoDeslig);
    if (!brutoDeslig) {
      info.semData++;
    } else if (!dataDeslig) {
      info.dataNaoEntendida++;
      // guarda só o FORMATO (números viram 9): ex. "99/99/9999" — nunca a data real
      const formato = brutoDeslig.replace(/\d/g, '9').slice(0, 30);
      if (info.formatosNaoEntendidos.length < 5 && !info.formatosNaoEntendidos.includes(formato)) {
        info.formatosNaoEntendidos.push(formato);
      }
    } else if (dataDeslig > hojeISO) {
      info.dataNoFuturo++;
      dataDeslig = null;
    }

    const dataAdm = paraData(pegar(col, mD.mapa.admissao));
    return {
      mes: dataDeslig ? dataDeslig.slice(0, 7) : null,
      desligamento: dataDeslig,
      admissao: dataAdm,
      time: pegar(col, mD.mapa.time) || 'Não informado',
      tipo: dataDeslig ? padronizarTipo(pegar(col, mD.mapa.tipo)) : null,
      motivo: dataDeslig ? categoria(pegar(col, mD.mapa.motivo)) : null,
    };
  }).filter(Boolean);

  cache = { quando: Date.now(), dados: { pessoas, mD, info } };
  return cache.dados;
}

// ---------- cálculo (tudo agregado) ----------
const contar = (lista, campo) => {
  const m = new Map();
  lista.forEach((r) => m.set(r[campo], (m.get(r[campo]) || 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const pct = (a, b) => (b ? Math.round((10000 * a) / b) / 100 : null);

// Headcount numa data: quem já tinha admissão e ainda não tinha saído (ou saiu depois).
const headcountEm = (pessoas, dataISO) => pessoas
  .filter((r) => r.admissao && r.admissao <= dataISO && (!r.desligamento || r.desligamento > dataISO)).length;
const umDiaAntes = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

function calcular({ pessoas }, { time, ano, mes }) {
  const noPeriodo = (m) => m && (!ano || m.startsWith(ano)) && (!mes || Number(m.slice(5, 7)) === Number(mes));
  const roster = pessoas.filter((r) => !time || r.time === time);
  const D = roster.filter((r) => noPeriodo(r.mes));

  const hojeISO = new Date().toISOString().slice(0, 10);
  let inicioISO, fimISO;
  if (ano && mes) {
    const mm = String(Number(mes)).padStart(2, '0');
    inicioISO = `${ano}-${mm}-01`;
    fimISO = `${ano}-${mm}-${String(new Date(Number(ano), Number(mes), 0).getDate()).padStart(2, '0')}`;
  } else if (ano) {
    inicioISO = `${ano}-01-01`;
    fimISO = `${ano}-12-31`;
  } else {
    const admissoes = roster.map((r) => r.admissao).filter(Boolean).sort();
    inicioISO = admissoes[0] || hojeISO;
    fimISO = hojeISO;
  }
  if (fimISO > hojeISO) fimISO = hojeISO;

  // Headcount médio (e, por tabela, o % de turnover) só faz sentido dentro de um
  // período limitado. Com "Todos" os anos juntos, contratações acumuladas de vários
  // anos contra um headcount de 2 pontos dariam uma taxa sem sentido — por isso só
  // calculamos quando um ano foi escolhido no filtro.
  const hcInicio = ano ? headcountEm(roster, umDiaAntes(inicioISO)) : null;
  const hcFim = ano ? headcountEm(roster, fimISO) : null;
  const hcMedio = ano && (hcInicio + hcFim) > 0 ? (hcInicio + hcFim) / 2 : null;
  const contratacoes = roster.filter((r) => r.admissao && r.admissao >= inicioISO && r.admissao <= fimISO).length;

  const vol = D.filter((r) => r.tipo === 'Voluntário').length;
  const turnoverGeral = hcMedio ? pct((contratacoes + D.length) / 2, hcMedio) : null;
  const turnoverVoluntario = hcMedio ? pct(vol, hcMedio) : null;

  const mesAtual = hojeISO.slice(0, 7);
  const meses = [...new Set([
    ...D.map((r) => r.mes),
    ...roster.filter((r) => r.admissao).map((r) => r.admissao.slice(0, 7)),
  ])].filter((m) => m <= mesAtual && noPeriodo(m)).sort();
  const porMes = meses.map((m) => ({
    mes: m,
    desligamentos: D.filter((r) => r.mes === m).length,
    contratacoes: roster.filter((r) => r.admissao && r.admissao.slice(0, 7) === m).length,
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
    // Desligamentos por time, separados por tipo: { time, total, tipos: { Voluntário: n, ... } }
    porTime: contar(D, 'time').map(([t, n]) => ({
      time: t,
      total: n,
      tipos: Object.fromEntries(contar(D.filter((r) => r.time === t), 'tipo')),
    })),
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
        pessoas: {
          total: dados.pessoas.length,
          comAdmissao: dados.pessoas.filter((r) => r.admissao).length,
          desligamentos: dados.pessoas.filter((r) => r.desligamento).length,
          ...dados.info,
          colunas: colunas(dados.mD, CAMPOS_DESLIG),
        },
      });
    }

    const filtro = { time: p.get('time') || '', ano: p.get('ano') || '', mes: p.get('mes') || '' };
    const todosMeses = dados.pessoas.flatMap((r) => [r.mes, r.admissao ? r.admissao.slice(0, 7) : null]).filter(Boolean);
    const anos = [...new Set(todosMeses.map((m) => m.slice(0, 4)))].sort().reverse();
    const ordenar = (lista) => [...new Set(lista)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const times = ordenar(dados.pessoas.map((r) => r.time));
    // Times que têm desligamento em cada ano → { "2026": ["Vendas", ...], ... }
    const timesPorAno = Object.fromEntries(anos.map((a) => [a,
      ordenar(dados.pessoas.filter((r) => r.mes && r.mes.startsWith(a)).map((r) => r.time))]));

    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({
      versao: 'v5', // aparece no dashboard ao lado de "Atualizado em"
      atualizadoEm: new Date(cache.quando).toISOString(),
      opcoes: { times, timesPorAno, anos, meses: NOMES_MES },
      ...calcular(dados, filtro),
    });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ erro: e.message || 'Não foi possível ler a planilha de turnover.' });
  }
}