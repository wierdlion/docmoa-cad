import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { LOCALES, DEFAULT_LOCALE, getDict, isLocale, isRtl, pageUrl, type Locale } from "@/lib/i18n";
import "../../globals.css";

/** 영어는 /cad/view, 나머지는 /cad/view/<로케일>. 공개 주소와 앱 내부 경로를 같게 둔다 —
 *  다르면 하이드레이션 뒤 Next 라우터가 제 경로로 URL을 되돌린다. */
export const dynamicParams = false;
export function generateStaticParams() {
  return [{ loc: [] as string[] }, ...LOCALES.filter((l) => l !== DEFAULT_LOCALE).map((l) => ({ loc: [l] }))];
}

const ADS = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;

const localeOf = (loc?: string[]): Locale => (loc?.[0] && isLocale(loc[0]) ? loc[0] : DEFAULT_LOCALE);

export async function generateMetadata({ params }: { params: Promise<{ loc?: string[] }> }): Promise<Metadata> {
  const locale = localeOf((await params).loc);
  const t = getDict(locale);
  return {
    title: t.title,
    description: t.desc,
    // 검색 결과는 본체 랜딩(/cad)이 받는다. 빈 캔버스뿐인 이 페이지가 대신 잡히면 안 된다.
    robots: { index: false, follow: true },
    alternates: { canonical: pageUrl(locale) },
  };
}

// 도면을 손가락으로 확대하므로 브라우저 기본 줌과 겹치지 않게 한다.
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export default async function RootLayout({ children, params }: { children: React.ReactNode; params: Promise<{ loc?: string[] }> }) {
  const locale = localeOf((await params).loc);
  return (
    <html lang={locale} dir={isRtl(locale) ? "rtl" : "ltr"}>
      <body className="font-sans antialiased">
        {children}
        {/* 뷰어가 먼저 뜨는 게 우선이라 afterInteractive. 광고는 도면 옆 레일에서만 쓴다. */}
        {ADS && <Script src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADS}`} crossOrigin="anonymous" strategy="afterInteractive" />}
      </body>
    </html>
  );
}
