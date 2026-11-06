import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // pg 是原生模块，必须走 Node runtime
  serverExternalPackages: ['pg'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
