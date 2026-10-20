import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";

import { AppSidebar } from "@/components/layout/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { t } from "@/lib/i18n/t";

// docs/design-system.md 第2節：zh-TW 內容以系統字體堆疊呈現，不載入任何
// web font（next/font 不使用）。

export const metadata: Metadata = {
  title: t("app.metadata.title"),
  description: t("app.metadata.description"),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <SidebarProvider>
          {/* AppSidebar 用 usePathname() 判斷 active 連結，在 build-time 靜態
              prerender 下屬於 runtime-only 的動態 hook（SDLCCT-48 是這個
              repo 第一個動態路由段 /agents/[key]，才第一次觸發
              next.config.ts `cacheComponents: true` 對這個既有、所有頁面共
              用的 root layout 元件的這條檢查 -- 靜態頁面之前從未踩到）。
              包一層 Suspense 允許 blocking fallback，純粹是 build-time 機
              制要求，AppSidebar 本身不會真的 suspend，執行期行為不變。 */}
          <Suspense fallback={null}>
            <AppSidebar />
          </Suspense>
          <SidebarInset>
            <div className="flex items-center p-2 md:hidden">
              <SidebarTrigger />
            </div>
            {children}
          </SidebarInset>
        </SidebarProvider>
      </body>
    </html>
  );
}
