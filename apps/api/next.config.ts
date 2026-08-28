// No `output: "standalone"`. It is incompatible with Vercel's managed output
// here — the build fails looking for next-server.js.nft.json — and every other
// app in the repo had it removed for the same reason. docker/Dockerfile.nextjs
// still copies .next/standalone, so container builds need a different strategy
// before they will work again; that is a repo-wide decision, not a per-app one.
import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  serverExternalPackages: ["pg"],
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
};

export default nextConfig;
