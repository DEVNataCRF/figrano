import './globals.css';

export const metadata = {
  // Prévia do link (WhatsApp, Google): vem da instalação, não do código
  title: process.env.NEXT_PUBLIC_STORE_TITLE || 'Cardápio · Delivery',
  description: process.env.NEXT_PUBLIC_STORE_DESCRIPTION || 'Confira o cardápio e faça seu pedido direto pelo site da loja.',
  ...(process.env.NEXT_PUBLIC_SITE_URL ? { metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL), openGraph: { images: ['/marca/og.jpg'] } } : {}),
  icons: { icon: '/favicon.ico' },
};

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#FFF8EC' };

/**
 * Política de conteúdo (só no build de produção; o Next de desenvolvimento usa scripts próprios).
 * O site é estático e o Next põe pequenos scripts no HTML, por isso script-src precisa de
 * 'unsafe-inline'; o resto segura: nada de plugin, formulário para fora, base trocada ou
 * conexão com endereço que não seja o próprio site e a API da loja.
 */
const API_ORIGIN = (() => { try { return new URL(process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3333/api/v1').origin; } catch { return ''; } })();
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' ${API_ORIGIN}`,
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <head>
        {process.env.NODE_ENV === 'production' && <meta httpEquiv="Content-Security-Policy" content={CSP} />}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Nunito:wght@400;600;700;800&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
