import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { loginEnabled } from "@/server/session";

/** Every page behind the login. `/login` lives outside this group, so it never renders chat titles. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <SidebarProvider>
      <AppSidebar canSignOut={loginEnabled()} />
      <SidebarInset className="h-dvh">{children}</SidebarInset>
    </SidebarProvider>
  );
}
