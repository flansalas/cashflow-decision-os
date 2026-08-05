import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: '/dashboard',
        destination: '/plan',
        permanent: true,
      },
      {
        source: '/cashflow',
        has: [
          {
            type: 'query',
            key: 'mode',
            value: 'ap',
          },
        ],
        destination: '/payables',
        permanent: true,
      },
      {
        source: '/cashflow',
        has: [
          {
            type: 'query',
            key: 'mode',
            value: 'ar',
          },
        ],
        destination: '/receivables',
        permanent: true,
      },
      {
        source: '/cashflow',
        destination: '/receivables',
        permanent: true,
      },
      {
        source: '/cash-adjustments',
        destination: '/adjustments',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
