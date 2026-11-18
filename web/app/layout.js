import './globals.css';

export const metadata = {
  title: 'Sabores da Sil · Delivery',
  description: 'Salgados, porções e delícias da Sil, de Guaçuí-ES. Peça direto pelo site, sem taxa de aplicativo.',
  openGraph: { images: ['/marca/og.jpg'] },
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
