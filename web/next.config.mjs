/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Só no desenvolvimento: libera abrir o servidor local por outro endereço
  // (ex.: o IP da rede, para testar no celular). Defina no .env.local:
  // FIGRANO_DEV_ORIGINS=192.168.0.10
  allowedDevOrigins: (process.env.FIGRANO_DEV_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
};

export default nextConfig;
