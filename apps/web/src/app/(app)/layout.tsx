import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

/** Every page behind the login. `/login` lives outside this group, so it never renders chat titles. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-dvh">{children}</SidebarInset>
    </SidebarProvider>
  );
}
