import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** @type {import('next').NextConfig | ((phase: string) => import('next').NextConfig)} */
const nextConfig = (phase) => {
  // NOTE: dev 서버가 실행 중인 상태에서 `next build`가 `.next`를 덮어쓰면
  // UI가 `/_next/static/...` 404로 깨질 수 있으므로(distDir 충돌),
  // production build/start 출력 디렉터리를 분리한다.
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    reactStrictMode: true,
    distDir: isDev ? ".next" : ".next-prod",
  };
};

export default nextConfig;
