import type { Metadata } from "next";
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
