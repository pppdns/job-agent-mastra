import { cn } from "cn";
import { KanbanIcon, ListIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const VIEWS = [
  { view: "board", href: "/jobs/board", label: "Board", icon: KanbanIcon },
  { view: "list", href: "/jobs", label: "List", icon: ListIcon },
] as const;

/** Board | List switch in the Jobs header. */
export function ViewToggle({ current }: { current: "list" | "board" }) {
  return (
    <nav aria-label="Jobs view" className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {VIEWS.map(({ view, href, label, icon: Icon }) => {
        const active = view === current;
        return (
          <Button
            key={view}
            asChild
            size="sm"
            variant={active ? "secondary" : "ghost"}
            className={cn("h-7 px-2", active && "bg-background shadow-xs hover:bg-background")}
          >
            <Link href={href} aria-current={active ? "page" : undefined}>
              <Icon />
              {label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
