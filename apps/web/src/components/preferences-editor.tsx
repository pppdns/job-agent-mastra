"use client";

import {
  JOB_LEVEL_LABELS,
  JOB_LEVELS,
  PREFERENCE_LEVEL_LABELS,
  PREFERENCE_LEVELS,
  type PreferenceLevel,
  type Preferences,
  ROLE_FOCUS,
  ROLE_FOCUS_LABELS,
  TRAVEL_LIMIT_LABELS,
  TRAVEL_LIMITS,
  type TravelLimit,
} from "@copilot/shared";
import { PlusIcon, XIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useState, useTransition } from "react";
import { editPreferencesAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** The color a level gets everywhere (chips use the same mapping). */
export const LEVEL_DOT: Record<PreferenceLevel, string> = {
  preferred: "bg-success",
  ok: "bg-muted-foreground/40",
  disliked: "bg-warning",
  no: "bg-destructive",
};

const selectClass = "h-8 rounded-md border bg-background px-2 text-sm";

function LevelSelect({
  label,
  value,
  onChange,
  optional,
}: {
  label: string;
  value: PreferenceLevel | null;
  onChange: (level: PreferenceLevel | null) => void;
  /** Offers "No opinion" (unset). */
  optional?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", value ? LEVEL_DOT[value] : "border")}
      />
      <select
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || null) as PreferenceLevel | null)}
        className={selectClass}
      >
        {optional && <option value="">No opinion</option>}
        {PREFERENCE_LEVELS.map((l) => (
          <option key={l} value={l}>
            {PREFERENCE_LEVEL_LABELS[l]}
          </option>
        ))}
      </select>
    </span>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0">
      <legend className="contents">
        <span className="text-sm font-semibold">{title}</span>
      </legend>
      {hint && <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </fieldset>
  );
}

/** Editable `{ name, level }` rows (places, languages). */
function NamedLevels({
  label,
  items,
  placeholder,
  onChange,
}: {
  label: string;
  items: { name: string; level: PreferenceLevel }[];
  placeholder: string;
  onChange: (items: { name: string; level: PreferenceLevel }[]) => void;
}) {
  const set = (i: number, patch: Partial<{ name: string; level: PreferenceLevel }>) =>
    onChange(items.map((item, j) => (j === i ? { ...item, ...patch } : item)));
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place, never reordered
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={`${label} ${i + 1}`}
            value={item.name}
            placeholder={placeholder}
            onChange={(e) => set(i, { name: e.target.value })}
            className="h-8 w-48"
          />
          <LevelSelect
            label={`${label} ${i + 1} level`}
            value={item.level}
            onChange={(level) => level && set(i, { level })}
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Remove ${item.name || label}`}
            className="text-muted-foreground"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="self-start text-muted-foreground"
        onClick={() => onChange([...items, { name: "", level: "ok" }])}
      >
        <PlusIcon />
        Add {label.toLowerCase()}
      </Button>
    </div>
  );
}

const places = (items: { place: string; level: PreferenceLevel }[]) =>
  items.map((i) => ({ name: i.place, level: i.level }));
const unplaces = (items: { name: string; level: PreferenceLevel }[]) =>
  items.map((i) => ({ place: i.name, level: i.level }));

const numberOrNull = (value: string) => {
  const n = Number(value);
  return value.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The structured preferences: what code reads to color chips and screen jobs, and what every
 * prompt gets as fixed sentences. Saved as one new profile version.
 */
export function PreferencesEditor({
  preferences,
  version,
}: {
  preferences: Preferences;
  version: number;
}) {
  const [draft, setDraft] = useState(preferences);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(draft) !== JSON.stringify(preferences);
  const wm = draft.workMode;
  const setWm = (patch: Partial<Preferences["workMode"]>) =>
    setDraft({ ...draft, workMode: { ...wm, ...patch } });
  const setSalary = (patch: Partial<Preferences["salary"]>) =>
    setDraft({ ...draft, salary: { ...draft.salary, ...patch } });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const home =
        draft.home?.city.trim() && draft.home.country.trim()
          ? { city: draft.home.city.trim(), country: draft.home.country.trim() }
          : null;
      const cleaned: Preferences = {
        ...draft,
        home,
        workMode: {
          ...wm,
          hybrid: wm.hybrid.filter((p) => p.place.trim()),
          onsite: wm.onsite.filter((p) => p.place.trim()),
        },
        languages: draft.languages.filter((l) => l.name.trim()),
      };
      const result = await editPreferencesAction(cleaned, version);
      if (result.error) setError(result.error);
      else setMessage(result.message ?? "Saved.");
    });
  };

  const focusLevel = (focus: (typeof ROLE_FOCUS)[number]) =>
    draft.roleFocus.find((f) => f.focus === focus)?.level ?? null;
  const setFocus = (focus: (typeof ROLE_FOCUS)[number], level: PreferenceLevel | null) =>
    setDraft({
      ...draft,
      roleFocus: [
        ...draft.roleFocus.filter((f) => f.focus !== focus),
        ...(level ? [{ focus, level }] : []),
      ].sort((a, b) => ROLE_FOCUS.indexOf(a.focus) - ROLE_FOCUS.indexOf(b.focus)),
    });
  const jobLevel = (level: (typeof JOB_LEVELS)[number]) =>
    draft.levels.find((l) => l.level === level)?.preference ?? null;
  const setJobLevel = (level: (typeof JOB_LEVELS)[number], preference: PreferenceLevel | null) =>
    setDraft({
      ...draft,
      levels: [
        ...draft.levels.filter((l) => l.level !== level),
        ...(preference ? [{ level, preference }] : []),
      ].sort((a, b) => JOB_LEVELS.indexOf(a.level) - JOB_LEVELS.indexOf(b.level)),
    });

  return (
    <form
      onSubmit={submit}
      aria-label="Structured preferences"
      className="flex flex-col gap-4 rounded-xl border p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Structured preferences</h3>
        {dirty && (
          <Badge variant="outline" className="border-warning/40 text-warning">
            Unsaved changes
          </Badge>
        )}
        <p className="basis-full text-xs text-muted-foreground">
          The app colors job chips and screens postings by these, and every assessment reads them.
          Preferred is green, OK neutral, disliked amber, no is a deal-breaker (red).
        </p>
      </div>

      <Group title="Home" hint="Decides which remote restrictions and offices are reachable.">
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="Home city"
            placeholder="City"
            value={draft.home?.city ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                home: { city: e.target.value, country: draft.home?.country ?? "" },
              })
            }
            className="h-8 w-48"
          />
          <Input
            aria-label="Home country"
            placeholder="Country"
            value={draft.home?.country ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                home: { city: draft.home?.city ?? "", country: e.target.value },
              })
            }
            className="h-8 w-48"
          />
        </div>
      </Group>

      <Group title="Work mode">
        <div className="flex items-center gap-2 text-sm">
          <span className="w-36">Remote</span>
          <LevelSelect
            label="Remote"
            value={wm.remote}
            onChange={(l) => l && setWm({ remote: l })}
          />
        </div>
        <p className="text-xs text-muted-foreground">Hybrid in</p>
        <NamedLevels
          label="Hybrid place"
          placeholder="e.g. Budapest"
          items={places(wm.hybrid)}
          onChange={(items) => setWm({ hybrid: unplaces(items) })}
        />
        <div className="flex items-center gap-2 text-sm">
          <span className="w-36">Hybrid elsewhere</span>
          <LevelSelect
            label="Hybrid elsewhere"
            value={wm.hybridElsewhere}
            onChange={(l) => l && setWm({ hybridElsewhere: l })}
          />
        </div>
        <p className="text-xs text-muted-foreground">On-site in</p>
        <NamedLevels
          label="On-site place"
          placeholder="e.g. Budapest"
          items={places(wm.onsite)}
          onChange={(items) => setWm({ onsite: unplaces(items) })}
        />
        <div className="flex items-center gap-2 text-sm">
          <span className="w-36">On-site elsewhere</span>
          <LevelSelect
            label="On-site elsewhere"
            value={wm.onsiteElsewhere}
            onChange={(l) => l && setWm({ onsiteElsewhere: l })}
          />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="w-36">Most office days</span>
          <select
            aria-label="Most office days a week"
            value={wm.maxOfficeDaysPerWeek ?? ""}
            onChange={(e) =>
              setWm({ maxOfficeDaysPerWeek: e.target.value ? Number(e.target.value) : null })
            }
            className={selectClass}
          >
            <option value="">No limit</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} a week
              </option>
            ))}
          </select>
        </div>
      </Group>

      <Group
        title="Salary (yearly)"
        hint="Colors the salary chip: under the floor red, at or above great green. Pay in other currencies is converted roughly. Never screens jobs out."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Salary floor"
            type="number"
            min={0}
            step={1000}
            placeholder="Floor"
            value={draft.salary.floor ?? ""}
            onChange={(e) => setSalary({ floor: numberOrNull(e.target.value) })}
            className="h-8 w-32"
          />
          <Input
            aria-label="Great salary"
            type="number"
            min={0}
            step={1000}
            placeholder="Great from"
            value={draft.salary.high ?? ""}
            onChange={(e) => setSalary({ high: numberOrNull(e.target.value) })}
            className="h-8 w-32"
          />
          <Input
            aria-label="Salary currency"
            maxLength={3}
            value={draft.salary.currency}
            onChange={(e) => setSalary({ currency: e.target.value.toUpperCase() })}
            className="h-8 w-20 uppercase"
          />
        </div>
      </Group>

      <Group title="Main programming languages" hint="Judged on what a role mainly uses.">
        <NamedLevels
          label="Language"
          placeholder="e.g. TypeScript"
          items={draft.languages}
          onChange={(languages) => setDraft({ ...draft, languages })}
        />
      </Group>

      <Group title="What the role is mainly about">
        <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {ROLE_FOCUS.map((focus) => (
            <div key={focus} className="flex items-center justify-between gap-2 text-sm">
              {ROLE_FOCUS_LABELS[focus]}
              <LevelSelect
                label={ROLE_FOCUS_LABELS[focus]}
                value={focusLevel(focus)}
                onChange={(l) => setFocus(focus, l)}
                optional
              />
            </div>
          ))}
        </div>
      </Group>

      <Group title="Levels">
        <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {JOB_LEVELS.map((level) => (
            <div key={level} className="flex items-center justify-between gap-2 text-sm">
              {JOB_LEVEL_LABELS[level]}
              <LevelSelect
                label={`${JOB_LEVEL_LABELS[level]} level`}
                value={jobLevel(level)}
                onChange={(l) => setJobLevel(level, l)}
                optional
              />
            </div>
          ))}
        </div>
      </Group>

      <Group title="Travel" hint="Fine up to this; more counts as disliked.">
        <select
          aria-label="Travel is fine up to"
          value={draft.travel.okUpTo ?? ""}
          onChange={(e) =>
            setDraft({
              ...draft,
              travel: { okUpTo: (e.target.value || null) as TravelLimit | null },
            })
          }
          className={cn(selectClass, "self-start")}
        >
          <option value="">No opinion</option>
          {TRAVEL_LIMITS.map((t) => (
            <option key={t} value={t}>
              {TRAVEL_LIMIT_LABELS[t]}
            </option>
          ))}
        </select>
      </Group>

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Button type="submit" size="sm" disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save preferences"}
        </Button>
        {dirty && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(preferences)}>
            Discard
          </Button>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && !dirty && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
    </form>
  );
}
