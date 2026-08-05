import type { NextConfig } from "next";

let dbHost = "unknown";
try {
  if (process.env.DATABASE_URL) {
    dbHost = new URL(process.env.DATABASE_URL).hostname;
  }
} catch(e) {}
console.log("=== DIAGNOSTIC DB_HOST ===", dbHost);
console.log("=== DIAGNOSTIC CLERK_PK ===", (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "").substring(0, 15));

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
