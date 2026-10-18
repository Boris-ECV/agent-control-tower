import type { Metadata } from "next";
import "./globals.css";

import { AppSidebar } from "@/components/layout/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

// docs/design-system.md 第2節：zh-TW 內容以系統字體堆疊呈現，不載入任何
// web font（next/font 不使用）。

export const metadata: Metadata = {
  title: "成本總覽 — Agent Control Tower",
  description: "本月成本 vs 預算總覽、預估月底超支、跨 Agent 期間比較。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <SidebarProvider>
          <AppSidebar />
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
