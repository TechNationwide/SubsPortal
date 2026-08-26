import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // Prefer API_PROXY_TARGET for local theme preview against live API.
    // NEXT_PUBLIC_API_URL empty => browser calls same-origin /api/* (avoids CORS).
    const api =
      process.env.API_PROXY_TARGET ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://127.0.0.1:8001";
    return [
      {
        source: "/api/:path*",
        destination: `${api.replace(/\/$/, "")}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
