"use client";

import { SquarePenIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";

export function NewChatButton() {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();

  return (
    <Button
      variant="outline"
      className="justify-start"
      onClick={() => {
        // The thread is created by the agent on the first message.
        router.push(`/c/${crypto.randomUUID()}`);
        setOpenMobile(false);
      }}
    >
      <SquarePenIcon />
      New chat
    </Button>
  );
}
