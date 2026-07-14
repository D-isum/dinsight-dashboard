const publicApiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';
const apiProxyTarget = process.env.DINSIGHT_API_PROXY_TARGET || publicApiUrl;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output produces .next/standalone/ with a self-contained
  // server.js + the minimal node_modules subset Next actually needs at
  // runtime. The Docker image ships only this, no full node_modules tree.
  // Required for the production container; harmless for `pnpm dev`.
  output: 'standalone',
  env: {
    NEXT_PUBLIC_API_URL: publicApiUrl,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiProxyTarget}/:path*`,
      },
    ];
  },
};

export default nextConfig;
