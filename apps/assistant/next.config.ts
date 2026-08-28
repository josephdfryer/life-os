import type { NextConfig } from "next";
import path from "path";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  serverExternalPackages: ["twilio", "pg"],
};

export default withWorkflow(nextConfig);
