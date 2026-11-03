"use client";

import { CheckIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { approveJobDraftAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

/** Approves exactly the draft shown on the job page; the page then re-renders from the DB. */
export function ApproveDraftButton({ draftId, version }: { draftId: string; version: number }) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const approve = () =>
    startTransition(async () => {
      setError(undefined);
      const { outcome } = await approveJobDraftAction(draftId);
      if (outcome === "changed") setError("A newer draft was saved since. Review it first.");
      else if (outcome !== "approved") setError("Couldn't approve this draft. Try again.");
    });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" onClick={approve} disabled={pending}>
        <CheckIcon />
        Approve draft v{version}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
