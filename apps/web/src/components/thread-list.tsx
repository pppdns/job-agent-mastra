"use client";

import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { deleteChat, renameChat } from "@/app/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { MAX_TITLE_CHARS } from "@/lib/chat-schema";

export type ThreadListItem = { id: string; title: string };

const displayTitle = (title: string) => title.trim() || "New chat";

export function ThreadList({ threads }: { threads: ThreadListItem[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ThreadListItem | null>(null);
  const [pending, startTransition] = useTransition();

  if (threads.length === 0) {
    return <p className="px-2 text-sm text-muted-foreground">No chats yet.</p>;
  }

  function confirmDelete() {
    const thread = deleting;
    if (!thread) return;
    startTransition(async () => {
      await deleteChat(thread.id);
      setDeleting(null);
      if (pathname === `/c/${thread.id}`) router.push("/");
    });
  }

  return (
    <>
      <SidebarMenu aria-label="Chats">
        {threads.map((thread) => {
          const href = `/c/${thread.id}`;
          return (
            <SidebarMenuItem key={thread.id}>
              {editingId === thread.id ? (
                <RenameForm
                  thread={thread}
                  onDone={() => setEditingId(null)}
                  onSubmit={(title) =>
                    startTransition(async () => {
                      await renameChat(thread.id, title);
                      setEditingId(null);
                    })
                  }
                />
              ) : (
                <>
                  <SidebarMenuButton asChild isActive={pathname === href}>
                    <Link href={href} onClick={() => setOpenMobile(false)}>
                      <span>{displayTitle(thread.title)}</span>
                    </Link>
                  </SidebarMenuButton>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuAction showOnHover aria-label={`Chat actions`}>
                        <MoreHorizontalIcon />
                      </SidebarMenuAction>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      side="right"
                      align="start"
                      // Returning focus to the trigger would blur (and close) the rename input.
                      onCloseAutoFocus={(event) => event.preventDefault()}
                    >
                      <DropdownMenuItem onSelect={() => setEditingId(thread.id)}>
                        <PencilIcon />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(thread)}>
                        <Trash2Icon />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              “{displayTitle(deleting?.title ?? "")}” and its messages will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                confirmDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RenameForm({
  thread,
  onSubmit,
  onDone,
}: {
  thread: ThreadListItem;
  onSubmit: (title: string) => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(displayTitle(thread.title));
  // Enter and the following blur must not submit twice.
  const submitted = useRef(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (submitted.current) return;
    submitted.current = true;
    const next = title.trim();
    if (!next || next === thread.title) return onDone();
    onSubmit(next);
  }

  return (
    <form onSubmit={submit}>
      <Input
        autoFocus
        aria-label="Chat title"
        value={title}
        maxLength={MAX_TITLE_CHARS}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={submit}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          submitted.current = true;
          onDone();
        }}
        className="h-8"
      />
    </form>
  );
}
