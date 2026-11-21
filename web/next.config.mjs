/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  distDir: process.env.FIGRANO_NEXT_DIST_DIR || '.next',
  // Site estático (Cloudflare Pages): tudo vem da API do Sabores pelo navegador
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  // O projeto fica dentro de outro repositório (Sabores): a raiz do build é esta pasta
  turbopack: { root: import.meta.dirname },
  // Só no desenvolvimento: libera abrir o servidor local por outro endereço
  // (ex.: o IP da rede, para testar no celular). FIGRANO_DEV_ORIGINS=192.168.0.10
  allowedDevOrigins: (process.env.FIGRANO_DEV_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
};

export default nextConfig;
