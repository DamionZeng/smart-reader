import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // These packages must NOT be bundled by webpack — they rely on
  // runtime Node.js module resolution (dynamic imports, file paths,
  // worker resolution) that breaks when webpack relocates files.
  // On Vercel, failing to externalize pdfjs-dist causes the PDF
  // parser to crash at module load time because the worker .mjs
  // path no longer resolves in the bundled output.
  serverExternalPackages: [
    "pdfjs-dist",
    "pngjs",
    "mammoth",
    "canvas",
  ],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
};

export default nextConfig;
