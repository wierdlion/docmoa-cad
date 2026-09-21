import type { Metadata, Viewport } from "next";
import { LOCALES, DEFAULT_LOCALE, getDict, isLocale, isRtl, pageUrl, type Locale } from "@/lib/i18n";
import "../globals.css";

/** 영어는 /cad, 나머지는 /cad/<로케일>. 본체가 docmoa.com/<로케일>/cad 를 이리로 넘긴다. */
export const dynamicParams = false;
export function generateStaticParams() {
  return [{ loc: [] as string[] }, ...LOCALES.filter((l) => l !== DEFAULT_LOCALE).map((l) => ({ loc: [l] }))];
}

const localeOf = (loc?: string[]): Locale => (loc?.[0] && isLocale(loc[0]) ? loc[0] : DEFAULT_LOCALE);

export async function generateMetadata({ params }: { params: Promise<{ loc?: string[] }> }): Promise<Metadata> {
  const locale = localeOf((await params).loc);
  const t = getDict(locale);
  return {
    title: t.title,
    description: t.desc,
    alternates: {
      canonical: pageUrl(locale),
      languages: { ...Object.fromEntries(LOCALES.map((l) => [l, pageUrl(l)])), "x-default": pageUrl(DEFAULT_LOCALE) },
    },
  };
}

// 도면을 손가락으로 확대하므로 브라우저 기본 줌과 겹치지 않게 한다.
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export default async function RootLayout({ children, params }: { children: React.ReactNode; params: Promise<{ loc?: string[] }> }) {
  const locale = localeOf((await params).loc);
  return (
    <html lang={locale} dir={isRtl(locale) ? "rtl" : "ltr"}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
