import { createSecureHeaders } from "next-secure-headers";

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    appDir: true
  },
  headers: async () => [
    {
      source: "/(.*)",
      headers: createSecureHeaders()
    }
  ]
};

export default nextConfig;
