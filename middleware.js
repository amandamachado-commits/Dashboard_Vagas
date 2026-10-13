// =============================================================
//  Proteção de acesso com tela de login própria.
//  Sem sessão válida: páginas vão para /login.html e a API
//  responde 401. A sessão é um cookie assinado, válido por 12h.
// =============================================================

export const config = { matcher: '/:path*' };

const LIVRES = ['/login.html', '/api/login', '/style.css', '/favicon.ico'];

async function assinar(texto, chave) {
  const k = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(chave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(texto));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function iguais(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function sessaoValida(request) {
  const usuario = process.env.DASHBOARD_USER;
  const senha = process.env.DASHBOARD_PASSWORD;
  if (!usuario || !senha) return false;
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)sessao=([^;]+)/);
  if (!m) return false;
  const [expira, assinatura] = decodeURIComponent(m[1]).split('.');
  if (!expira || !assinatura || Date.now() > Number(expira)) return false;
  const esperada = await assinar(`sessao|${expira}`, `${usuario}:${senha}`);
  return iguais(assinatura, esperada);
}

export default async function middleware(request) {
  const url = new URL(request.url);
  if (LIVRES.includes(url.pathname)) return;

  if (await sessaoValida(request)) return;

  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ erro: 'Sessão expirada. Entre novamente.' }), {
      status: 401, headers: { 'content-type': 'application/json' },
    });
  }
  return Response.redirect(new URL('/login.html', request.url), 302);
}