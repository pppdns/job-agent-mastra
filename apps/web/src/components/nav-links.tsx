"use client";

import { BriefcaseIcon, RadarIcon, UserIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

/**
 * Without `active`, renders the static links (prerendered fallback) without reading the URL.
 * `newMatches`: discovered matches not opened yet (badge on Jobs).
 */
export function NavLinks({
  active = false,
  newMatches = 0,
}: {
  active?: boolean;
  newMatches?: number;
}) {
  return active ? (
    <ActiveNavLinks newMatches={newMatches} />
  ) : (
    <Links pathname="" newMatches={newMatches} />
  );
}

function ActiveNavLinks({ newMatches }: { newMatches: number }) {
  return <Links pathname={usePathname()} newMatches={newMatches} />;
}

function Links({ pathname, newMatches }: { pathname: string; newMatches: number }) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={pathname.startsWith("/jobs")}>
          <Link href="/jobs" onClick={() => setOpenMobile(false)}>
            <BriefcaseIcon />
            <span>Jobs</span>
          </Link>
        </SidebarMenuButton>
        {newMatches > 0 && (
          <SidebarMenuBadge
            aria-label={`${newMatches} new match${newMatches === 1 ? "" : "es"}`}
            title="New matches you haven't opened"
          >
            {newMatches > 99 ? "99+" : newMatches}
          </SidebarMenuBadge>
        )}
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          isActive={pathname.startsWith("/discovery") || pathname.startsWith("/settings")}
        >
          <Link href="/discovery" onClick={() => setOpenMobile(false)}>
            <RadarIcon />
            <span>Discovery</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={pathname.startsWith("/profile")}>
          <Link href="/profile" onClick={() => setOpenMobile(false)}>
            <UserIcon />
            <span>Profile</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
