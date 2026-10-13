// =============================================================
//  Login com usuário e senha (tela dentro da página).
//  POST /api/login        → entra
//  POST /api/login?sair=1 → sai
//  Variáveis no Vercel: DASHBOARD_USER e DASHBOARD_PASSWORD
// =============================================================
import { createHmac, timingSafeEqual } from 'node:crypto';

const DOZE_HORAS = 12 * 60 * 60 * 1000;

function iguais(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && timingSafeEqual(A, B);
}

async function lerCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  let texto = '';
  for await (const parte of req) texto += parte;
  try { return JSON.parse(texto); } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const seguro = (req.headers.host || '').startsWith('localhost') ? '' : ' Secure;';

  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });

  if (new URL(req.url, 'http://x').searchParams.has('sair')) {
    res.setHeader('Set-Cookie', `sessao=; Path=/; HttpOnly;${seguro} SameSite=Lax; Max-Age=0`);
    return res.status(200).json({ ok: true });
  }

  const usuario = process.env.DASHBOARD_USER;
  const senha = process.env.DASHBOARD_PASSWORD;
  if (!usuario || !senha) return res.status(503).json({ erro: 'Acesso não configurado.' });

  const { usuario: u = '', senha: s = '' } = await lerCorpo(req);
  if (!iguais(u, usuario) || !iguais(s, senha)) {
    await new Promise((r) => setTimeout(r, 800));
    return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
  }

  const expira = Date.now() + DOZE_HORAS;
  const assinatura = createHmac('sha256', `${usuario}:${senha}`).update(`sessao|${expira}`).digest('hex');
  res.setHeader('Set-Cookie',
    `sessao=${expira}.${assinatura}; Path=/; HttpOnly;${seguro} SameSite=Lax; Max-Age=${DOZE_HORAS / 1000}`);
  return res.status(200).json({ ok: true });
}