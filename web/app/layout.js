import './globals.css';

export const metadata = {
  title: 'Figrano',
  description: 'Peça direto do restaurante, sem taxa de aplicativo.',
};

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#F6F4F0' };

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
