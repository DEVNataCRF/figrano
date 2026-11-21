import './globals.css';

export const metadata = {
  // Prévia do link (WhatsApp, Google): vem da instalação, não do código
  title: process.env.NEXT_PUBLIC_STORE_TITLE || 'Cardápio · Delivery',
  description: process.env.NEXT_PUBLIC_STORE_DESCRIPTION || 'Confira o cardápio e faça seu pedido direto pelo site da loja.',
  ...(process.env.NEXT_PUBLIC_SITE_URL ? { metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL), openGraph: { images: ['/marca/og.jpg'] } } : {}),
  icons: { icon: '/favicon.ico' },
};

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#FFF8EC' };

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <head>
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
