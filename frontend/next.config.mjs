/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Tell Next.js this directory is the workspace root, so it doesn't pick the
  // wrong package-lock when there are multiple lockfiles in parent folders.
  outputFileTracingRoot: process.cwd(),
  webpack: (config) => {
    // wagmi/RainbowKit pulls in some optional Node-only deps and a
    // React-Native AsyncStorage import inside @metamask/sdk that's only used
    // when running in RN. Stub them out for the browser build.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

export default nextConfig;
