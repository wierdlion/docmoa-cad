import type { NextConfig } from "next";

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
];

const nextConfig: NextConfig = {
  // docmoa.com/cad 로 rewrite 되어 붙는다. 본체와는 별도 빌드 — GPL 경계가 여기다.
  basePath: "/cad",
  turbopack: {
    // libredwg의 emscripten glue는 Node 분기에서 내장 모듈을 부른다. 브라우저에선 실행되지 않지만
    // 번들러가 해석은 해야 하므로 빈 모듈로 돌린다.
    resolveAlias: Object.fromEntries(
      ["module", "fs", "path", "url", "crypto"].map((m) => [m, { browser: "./lib/node-stub.ts" }]),
    ),
  },
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/(.*)", headers: SECURITY_HEADERS },
      // wasm 9MB, 한글 폰트 2MB. 내용이 바뀌지 않으므로 재방문에서는 받지 않게 한다.
      { source: "/:dir(wasm|fonts)/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

export default nextConfig;
