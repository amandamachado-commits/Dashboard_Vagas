// =============================================================
//  Proteção de acesso: pede usuário e senha antes de abrir
//  QUALQUER página ou a API. Usuário e senha ficam nas
//  variáveis de ambiente do Vercel — nunca escreva no código.
//  >>> Depois de baixar, renomeie este arquivo para middleware.js <<<
// =============================================================

export const config = { matcher: '/:path*' };

export default function middleware(request) {
  const usuario = process.env.DASHBOARD_USER;
  const senha = process.env.DASHBOARD_PASSWORD;

  // Sem senha configurada, o site fica fechado (nunca aberto por engano).
  if (!usuario || !senha) {
    return new Response('Acesso não configurado.', { status: 503 });
  }

  const auth = request.headers.get('authorization') || '';
  const [esquema, codificado] = auth.split(' ');
  if (esquema === 'Basic' && codificado) {
    const [u, ...resto] = atob(codificado).split(':');
    if (u === usuario && resto.join(':') === senha) return; // liberado
  }

  return new Response('Acesso restrito.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Dashboard de Vagas", charset="UTF-8"' },
  });
}
