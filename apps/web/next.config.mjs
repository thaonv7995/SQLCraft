import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
  const nextConfig = {
  // Production Docker images (see apps/web/Dockerfile)
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  async rewrites() {
    return [
      {
        // Keep browser calls on same-origin (/v1/*), proxy internally to API service.
        source: '/v1/:path*',
        destination: `${process.env.NEXT_INTERNAL_API_ORIGIN || 'http://localhost:4000'}/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
