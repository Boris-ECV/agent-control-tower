"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

// 4 組 9 項導覽資料，逐字對應 docs/design/SDLCCT-34.md 的 zh-TW 標籤。
// 僅 Cost Dashboard 與 System 兩項有 href（可導覽）；其餘 7 項無 href，
// 永遠不會被 usePathname() 比對為 isActive，也不會有任何點擊行為
// （設計文件決策 4：不加 onClick、不加 disabled）。
type NavItem = {
  label: string;
  href?: string;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "總覽",
    items: [{ label: "成本儀表板", href: "/cost-dashboard" }],
  },
  {
    label: "治理",
    items: [
      { label: "Agent 清單" },
      { label: "異常與告警" },
      { label: "預算與節省模擬" },
      { label: "政策引擎" },
      { label: "核准流程" },
    ],
  },
  {
    label: "操作",
    items: [{ label: "暫停 Agent" }, { label: "緊急關閉" }],
  },
  {
    label: "設定",
    items: [{ label: "系統", href: "/settings/system" }],
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="none">
      <SidebarHeader>
        <span className="px-2 text-lg leading-[26px] font-semibold text-sidebar-foreground">
          Agent Control Tower
        </span>
      </SidebarHeader>
      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) =>
                  item.href ? (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton
                        render={<Link href={item.href} />}
                        isActive={pathname === item.href}
                      >
                        {item.label}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ) : (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton type="button">{item.label}</SidebarMenuButton>
                    </SidebarMenuItem>
                  ),
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
