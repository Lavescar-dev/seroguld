/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    if (process.env.NEXT_PUBLIC_API_BASE_URL && process.env.NEXT_PUBLIC_API_BASE_URL !== 'auto') {
      return [];
    }

    const proxyTarget = process.env.NEXT_SERVER_API_PROXY || 'http://localhost:8000';

    return [
      {
        source: '/api/:path*',
        destination: `${proxyTarget}/api/:path*`,
      },
      {
        source: '/media/:path*',
        destination: `${proxyTarget}/media/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
