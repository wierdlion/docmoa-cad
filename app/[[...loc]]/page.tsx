import Viewer from "@/components/viewer";
import { DEFAULT_LOCALE, getDict, isLocale, type Locale } from "@/lib/i18n";

export default async function Page({ params }: { params: Promise<{ loc?: string[] }> }) {
  const loc = (await params).loc;
  const locale: Locale = loc?.[0] && isLocale(loc[0]) ? loc[0] : DEFAULT_LOCALE;
  return <Viewer locale={locale} t={getDict(locale)} />;
}
