import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Remove the Next.js "N" dev-tools badge from the corner of the site.
  devIndicators: false,
};

export default nextConfig;
