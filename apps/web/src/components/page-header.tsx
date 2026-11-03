import { SidebarTrigger } from "@/components/ui/sidebar";

export function PageHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
      <SidebarTrigger />
      {children}
    </header>
  );
}
