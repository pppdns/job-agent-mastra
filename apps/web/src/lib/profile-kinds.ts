import type { ProfileFactKind } from "@copilot/shared";
import {
  type LucideIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  UserRoundIcon,
} from "lucide-react";

/**
 * How each kind of profile fact looks on /profile and what it does in judgements (see the
 * triager and rescorer prompts): hard requirements decide, soft preferences move the score,
 * background is context.
 */
export const PROFILE_KIND_UI: Record<
  ProfileFactKind,
  {
    title: string;
    icon: LucideIcon;
    hint: string;
    placeholder: string;
    accent: string;
    dot: string;
  }
> = {
  hard_requirement: {
    title: "Hard requirements",
    icon: ShieldCheckIcon,
    hint: "Deal-breakers. A job that breaks one is ruled out.",
    placeholder: "e.g. Remote within the EU only",
    accent: "text-warning bg-warning/10",
    dot: "bg-warning",
  },
  soft_preference: {
    title: "Soft preferences",
    icon: SlidersHorizontalIcon,
    hint: "Nice to have. Each one moves the fit score up or down.",
    placeholder: "e.g. Prefers small teams",
    accent: "text-info bg-info/10",
    dot: "bg-info",
  },
  background: {
    title: "Background",
    icon: UserRoundIcon,
    hint: "Facts about you, like location, languages or experience. Context for judging fit.",
    placeholder: "e.g. Based in Budapest; speaks Hungarian and English",
    accent: "text-muted-foreground bg-muted",
    dot: "bg-muted-foreground/50",
  },
};
