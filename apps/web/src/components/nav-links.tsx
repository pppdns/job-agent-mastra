"use client";

import { BriefcaseIcon, RadarIcon, UserIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

/** Without `active`, renders the static links (prerendered fallback) without reading the URL. */
export function NavLinks({ active = false }: { active?: boolean }) {
  return active ? <ActiveNavLinks /> : <Links pathname="" />;
}

function ActiveNavLinks() {
  return <Links pathname={usePathname()} />;
}

function Links({ pathname }: { pathname: string }) {
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
