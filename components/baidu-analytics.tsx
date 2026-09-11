"use client";

import { useEffect, useRef, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Script from "next/script";

export const BAIDU_TONGJI_ID = "f6f5319c0051e650bdefb0885f6aa8d7";

declare global {
  interface Window {
    _hmt?: Array<unknown[]>;
  }
}

function BaiduPageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isFirstLoad = useRef(true);

  useEffect(() => {
    // 首次载入时百度统计脚本会自动抓取当前页面 PV，跳过首屏以避免重复统计
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      return;
    }

    if (typeof window !== "undefined") {
      window._hmt = window._hmt || [];
      const search = searchParams?.toString();
      const url = search ? `${pathname}?${search}` : pathname;
      window._hmt.push(["_trackPageview", url]);
    }
  }, [pathname, searchParams]);

  return null;
}

export function BaiduAnalytics() {
  return (
    <>
      <Script
        id="baidu-tongji"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
var _hmt = _hmt || [];
(function() {
  var hm = document.createElement("script");
  hm.src = "https://hm.baidu.com/hm.js?${BAIDU_TONGJI_ID}";
  var s = document.getElementsByTagName("script")[0]; 
  s.parentNode.insertBefore(hm, s);
})();
          `,
        }}
      />
      <Suspense fallback={null}>
        <BaiduPageViewTracker />
      </Suspense>
    </>
  );
}
