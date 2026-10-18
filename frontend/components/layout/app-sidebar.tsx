"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { t } from "@/lib/i18n/t";

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
    label: t("sidebar.groups.overview"),
    items: [{ label: t("sidebar.items.costDashboard"), href: "/cost-dashboard" }],
  },
  {
    label: t("sidebar.groups.governance"),
    items: [
      { label: t("sidebar.items.agentList") },
      { label: t("sidebar.items.anomalyAlerts") },
      { label: t("sidebar.items.budgetSimulation") },
      { label: t("sidebar.items.policyEngine") },
      { label: t("sidebar.items.approvalFlow") },
    ],
  },
  {
    label: t("sidebar.groups.operations"),
    items: [{ label: t("sidebar.items.pauseAgent") }, { label: t("sidebar.items.emergencyShutdown") }],
  },
  {
    label: t("sidebar.groups.settings"),
    items: [{ label: t("sidebar.items.system"), href: "/settings/system" }],
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="offcanvas">
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
