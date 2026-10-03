"use client";
import { useEffect, useSyncExternalStore } from "react";

const CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
/** 본체와 같은 side 유닛. 슬롯 id는 AdSense 콘솔에서 온다. */
const SLOT = "5177925548";

/**
 * 도면 옆 세로 광고. 데스크톱에서만 띄운다 — 좁은 화면에서는 캔버스를 잡아먹고, 확대·이동하다
 * 잘못 눌리기 쉽다. 또 docmoa.com 에서만 띄운다. vercel.app 주소는 AdSense에 등록된 사이트가
 * 아니라서 거기까지 광고를 내보낼 이유가 없다.
 */
const noop = () => () => {};
export function AdRail({ label }: { label: string }) {
  // 서버 렌더에서는 false, 클라이언트에서 주소를 보고 정한다(하이드레이션 불일치 없이).
  const onSite = useSyncExternalStore(noop, () => location.hostname === "docmoa.com", () => false);
  useEffect(() => {
    if (!onSite) return;
    try {
      ((window as unknown as { adsbygoogle: unknown[] }).adsbygoogle ||= []).push({});
    } catch { /* 광고가 안 떠도 뷰어는 굴러가야 한다 */ }
  }, [onSite]);

  if (!CLIENT || !onSite) return null;
  return (
    <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-s border-slate-700 p-3 lg:block" aria-label={label}>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <ins
        className="adsbygoogle block"
        style={{ display: "block", minHeight: 600 }}
        data-ad-client={CLIENT}
        data-ad-slot={SLOT}
        data-ad-format="vertical"
      />
    </aside>
  );
}
