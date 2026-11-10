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
import { loginEnabled } from "@/server/session";
import { listThreads } from "@/server/threads";

export function AppSidebar() {
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
      <Suspense fallback={null}>
        <SignOut />
      </Suspense>
    </Sidebar>
  );
}

/** Runtime check: the image is built without APP_PASSWORD, so a prerendered value would be wrong. */
async function SignOut() {
  await connection();
  if (!loginEnabled()) return null;
  return (
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
  );
}

async function ActiveNav() {
  await connection(); // libsql is synchronous: keep this read out of prerendering
  const newMatches = await unseenMatchCount(await appDb()).catch(() => 0);
  return <NavLinks active newMatches={newMatches} />;
}

async function Threads() {
  // The chat list is fetched from the agent per request: without this, Cache Components
  // prerenders it and the fetch is cut off when the prerender ends ("fetch() rejects when the
  // prerender is complete"), which the catch below would log as a failure.
  await connection();
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
