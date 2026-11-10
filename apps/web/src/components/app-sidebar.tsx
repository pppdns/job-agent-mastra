import { unseenMatchCount } from "@copilot/db";
import { LogOutIcon } from "lucide-react";
import { connection } from "next/server";
import { Suspense } from "react";
import { logoutAction } from "@/app/login/actions";
import { NavLinks } from "@/components/nav-links";
import { NewChatButton } from "@/components/new-chat-button";
import { ThreadList } from "@/components/thread-list";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { appDb } from "@/server/db";
import { listThreads } from "@/server/threads";

export function AppSidebar({ canSignOut = false }: { canSignOut?: boolean }) {
  return (
    <Sidebar>
      <SidebarHeader>
        <p className="px-2 pt-1 text-sm font-semibold">Job Research Copilot</p>
        <NewChatButton />
        {/* usePathname() needs a Suspense boundary under Cache Components. */}
        <Suspense fallback={<NavLinks />}>
          <ActiveNav />
        </Suspense>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Chats</SidebarGroupLabel>
          <SidebarGroupContent>
            <Suspense fallback={<ThreadListSkeleton />}>
              <Threads />
            </Suspense>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {canSignOut ? (
        <SidebarFooter>
          <form action={logoutAction}>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton type="submit">
                  <LogOutIcon />
                  Sign out
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </form>
        </SidebarFooter>
      ) : null}
    </Sidebar>
  );
}

async function ActiveNav() {
  await connection(); // libsql is synchronous: keep this read out of prerendering
  const newMatches = await unseenMatchCount(await appDb()).catch(() => 0);
  return <NavLinks active newMatches={newMatches} />;
}

async function Threads() {
  try {
    const threads = await listThreads();
    return (
      <ThreadList
        threads={threads.map(({ id, title, archived }) => ({ id, title: title ?? "", archived }))}
      />
    );
  } catch (error) {
    console.error("listing chats failed", error);
    return <p className="px-2 text-sm text-muted-foreground">Couldn't load chats.</p>;
  }
}

function ThreadListSkeleton() {
  return (
    <SidebarMenu>
      {/* Fixed widths: SidebarMenuSkeleton's Math.random() breaks prerendering. */}
      {["80%", "65%", "72%"].map((width) => (
        <SidebarMenuItem key={width} className="flex h-8 items-center px-2">
          <Skeleton className="h-4" style={{ width }} />
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
