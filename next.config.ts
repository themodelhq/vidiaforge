import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // NOTE: ignoreBuildErrors and eslint.ignoreDuringBuilds are intentionally
  // NOT set. TypeScript errors and ESLint errors must be fixed, not hidden.
  reactStrictMode: false,
  // Allow the dev server to be accessed from the sandbox preview gateway.
  allowedDevOrigins: ["https://*.z.ai", "http://*.z.ai"],
  // Security headers applied to all responses.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), display-capture=(self)" },
        ],
      },
      {
        // Immutable cache for static build assets.
        source: "/_next/static/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
