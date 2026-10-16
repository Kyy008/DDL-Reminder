import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  output: "export",
  images: {
    unoptimized: true
  }
};

export default nextConfig;
