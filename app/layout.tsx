import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DWG 뷰어 · 도면 보기 | DocMoa",
  description: "AutoCAD 없이 브라우저에서 DWG·DXF 도면을 엽니다. 로그인·용량 제한 없음, 파일은 서버로 전송되지 않습니다.",
};

// 도면을 손가락으로 확대하므로 브라우저 기본 줌과 겹치지 않게 한다.
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
