import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
  // the local editions folder is the content store when no database is configured — ship it with every function
  outputFileTracingIncludes: { "/**": ["./editions/**/*", "./supabase/migrations/*.sql"] },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=(self \"https://checkout.dodopayments.com\")" },
          // The lesson engine is one inline script by design (a self-contained page), so inline is allowed;
          // everything else is locked to this origin plus Google Fonts.
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'" }]
            : []),
        ],
      },
    ];
  },
  async redirects() {
    // the legacy GitHub Pages layout (/e/NNN/) → the app's archive
    return [
      { source: "/e", destination: "/library", permanent: true },
      { source: "/e/:n(\\d{3})", destination: "/l/:n", permanent: true },
      { source: "/e/:n(\\d{3})/:rest*", destination: "/l/:n", permanent: true },
      { source: "/e/:rest*", destination: "/library", permanent: true },
    ];
  },
};

export default nextConfig;
