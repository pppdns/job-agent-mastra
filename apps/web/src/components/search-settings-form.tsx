"use client";

import type { SearchSettings } from "@copilot/shared";
import { useActionState } from "react";
import { type DiscoveryActionState, saveSearchSettingsAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the child.
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function ListField({
  name,
  label,
  hint,
  values,
  rows = 4,
}: {
  name: string;
  label: string;
  hint?: string;
  values: string[];
  rows?: number;
}) {
  return (
    <Field label={label} hint={hint}>
      <Textarea
        name={name}
        defaultValue={values.join("\n")}
        rows={rows}
        className="font-mono text-xs"
      />
    </Field>
  );
}

function Check({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium">
      <input
        type="checkbox"
        name={name}
        defaultChecked={checked}
        className="size-4 accent-primary"
      />
      {label}
    </label>
  );
}

/** Paid boards with the shared actor settings (results per search, spend cap per run). */
const ACTOR_BOARDS = [
  { id: "ycombinator", label: "YC Work at a Startup", price: "about $0.10 per 1,000 results" },
  { id: "jobgether", label: "Jobgether", price: "about $0.10 per 1,000 results" },
  {
    id: "dice",
    label: "Dice",
    price: "about $1 per 1,000, per phrase; mostly on-site US roles",
  },
  { id: "builtin", label: "Built In", price: "about $1.07 per 1,000, billed in pages of 25" },
  {
    id: "hiringcafe",
    label: "HiringCafe",
    price: "about $1.25 per 1,000, per phrase; ATS apply links",
  },
] as const;

export function SearchSettingsForm({ settings }: { settings: SearchSettings }) {
  const [state, action, pending] = useActionState<DiscoveryActionState, FormData>(
    saveSearchSettingsAction,
    null,
  );
  const { himalayas, linkedin, weworkremotely, remoteok, remotive, nodesk } = settings.sources;
  return (
    <form action={action} aria-label="Search settings" className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">What to search for</h2>
        <ListField
          name="queries"
          label="Search phrases"
          hint="One per line. Each is sent to every source; they never filter results on their own, since similar jobs have very different titles."
          values={settings.queries}
          rows={5}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">What to screen out</h2>
        <p className="text-sm text-muted-foreground">
          The screen only drops clear misfits. Anything uncertain (no salary, remote status unknown,
          an unusual title) goes on to the AI triage. Every dropped posting keeps its reason on the
          Discovery page.
        </p>
        <ListField
          name="titleExclude"
          label="Title excludes"
          hint="One phrase per line. A title is dropped when it contains every word of a phrase (whole words: “intern” doesn't match “internal”)."
          values={settings.titleExclude}
          rows={6}
        />
        <ListField
          name="blockedCompanies"
          label="Blocked companies"
          hint="One per line; legal forms like Inc or GmbH don't matter."
          values={settings.blockedCompanies}
          rows={2}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <ListField
            name="remoteRegions"
            label="Remote from"
            hint="A remote role limited only to other countries is dropped. “Europe” covers European countries."
            values={settings.remoteRegions}
            rows={4}
          />
          <ListField
            name="onsitePlaces"
            label="On-site or hybrid in"
            hint="A role the source marks as not remote is dropped elsewhere."
            values={settings.onsitePlaces}
            rows={4}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Max age (days)" hint="Older postings are dropped.">
            <Input
              name="maxAgeDays"
              type="number"
              min={1}
              max={90}
              defaultValue={settings.maxAgeDays}
            />
          </Field>
          <Field label="Minimum salary (yearly)" hint="Only applied when pay is stated.">
            <Input
              name="minSalaryAmount"
              type="number"
              min={0}
              step={1000}
              defaultValue={settings.minSalary?.amount ?? ""}
              placeholder="none"
            />
          </Field>
          <Field
            label="Currency"
            hint="EUR and USD pay are compared at a rough fixed rate; other currencies aren't."
          >
            <Input
              name="minSalaryCurrency"
              maxLength={3}
              defaultValue={settings.minSalary?.currency ?? "EUR"}
              className="uppercase"
            />
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Triage and assessments</h2>
        <p className="text-sm text-muted-foreground">
          Every job that passes the screen gets a quick triage score (0–100) against your profile.
          Jobs under the threshold are hidden; the best new matches of each run get a full
          assessment.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Show jobs scoring at least" hint="0–100. Lower it to see more.">
            <Input
              name="triageThreshold"
              type="number"
              min={0}
              max={100}
              defaultValue={settings.triageThreshold}
            />
          </Field>
          <Field label="Full assessments per run" hint="About $0.04 each, best matches first.">
            <Input
              name="maxAssessmentsPerRun"
              type="number"
              min={0}
              max={50}
              defaultValue={settings.maxAssessmentsPerRun}
            />
          </Field>
          <Field
            label="Triage at most per run"
            hint="About $0.002 a job. The rest waits for the next run."
          >
            <Input
              name="maxTriagePerRun"
              type="number"
              min={0}
              max={2000}
              defaultValue={settings.maxTriagePerRun}
            />
          </Field>
          <Field
            label="Max model spend per run (USD)"
            hint="Triage plus assessments; triage leaves the assessments' share."
          >
            <Input
              name="maxLlmUsdPerRun"
              type="number"
              min={0}
              max={50}
              step={0.1}
              defaultValue={settings.maxLlmUsdPerRun}
            />
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Sources</h2>
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <Check
            name="himalayasEnabled"
            label="Himalayas (free official API)"
            checked={himalayas.enabled}
          />
          <Field
            label="Pages per search phrase"
            hint="20 jobs per page; a backfill reads up to 10."
          >
            <Input
              name="himalayasMaxPages"
              type="number"
              min={1}
              max={10}
              defaultValue={himalayas.maxPages}
              className="w-24"
            />
          </Field>
        </div>
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <p className="text-sm font-medium">Free remote-job feeds</p>
          <p className="text-xs text-muted-foreground">
            Feeds can't be searched: each run reads their latest jobs and the screen and triage sort
            them. Jobs link back to the board, as their terms ask.
          </p>
          <Check
            name="weworkremotelyEnabled"
            label="We Work Remotely (RSS)"
            checked={weworkremotely.enabled}
          />
          <ListField
            name="weworkremotelyCategories"
            label="We Work Remotely categories"
            hint="Feed slugs from weworkremotely.com/categories/<slug>.rss, one per line."
            values={weworkremotely.categories}
            rows={4}
          />
          <Check
            name="remoteokEnabled"
            label="Remote OK (latest ~100 jobs of every kind)"
            checked={remoteok.enabled}
          />
          <Check
            name="remotiveEnabled"
            label="Remotive (a small set, 24 h delayed)"
            checked={remotive.enabled}
          />
          <Check
            name="nodeskEnabled"
            label="NoDesk (RSS, short descriptions)"
            checked={nodesk.enabled}
          />
          <ListField
            name="nodeskCategories"
            label="NoDesk categories"
            hint="Slugs from nodesk.co/remote-jobs/<slug>/, one per line."
            values={nodesk.categories}
            rows={2}
          />
        </div>
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <Check
            name="linkedinEnabled"
            label="LinkedIn (Apify, paid per result)"
            checked={linkedin.enabled}
          />
          <ListField
            name="linkedinLocations"
            label="LinkedIn locations"
            hint="Each search phrase is searched in each location."
            values={linkedin.locations}
            rows={3}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Results per search"
              hint="About $0.36 per 1,000 results; a backfill takes 4×."
            >
              <Input
                name="linkedinLimitPerSearch"
                type="number"
                min={1}
                max={500}
                defaultValue={linkedin.limitPerSearch}
              />
            </Field>
            <Field label="Max spend per run (USD)" hint="A backfill may spend 4×.">
              <Input
                name="linkedinMaxUsdPerRun"
                type="number"
                min={0.01}
                max={20}
                step={0.01}
                defaultValue={linkedin.maxUsdPerRun}
              />
            </Field>
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <p className="text-sm font-medium">More paid boards (Apify)</p>
          <p className="text-xs text-muted-foreground">
            A backfill may spend 4× the per-run cap. Compare boards on the discovery page (matches,
            overlap, cost per match) and turn off the ones that don't pay off.
          </p>
          {ACTOR_BOARDS.map((board) => {
            const config = settings.sources[board.id];
            return (
              <div key={board.id} className="grid items-end gap-3 sm:grid-cols-[1fr_8rem_8rem]">
                <div className="flex flex-col gap-0.5">
                  <Check name={`${board.id}Enabled`} label={board.label} checked={config.enabled} />
                  <span className="pl-6 text-xs text-muted-foreground">{board.price}</span>
                </div>
                <Field label="Results per search">
                  <Input
                    name={`${board.id}LimitPerSearch`}
                    type="number"
                    min={1}
                    max={200}
                    defaultValue={config.limitPerSearch}
                  />
                </Field>
                <Field label="Max USD per run">
                  <Input
                    name={`${board.id}MaxUsdPerRun`}
                    type="number"
                    min={0.01}
                    max={20}
                    step={0.01}
                    defaultValue={config.maxUsdPerRun}
                  />
                </Field>
              </div>
            );
          })}
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_8rem]">
            <div className="flex flex-col gap-2">
              <Check
                name="wellfoundEnabled"
                label="Wellfound (about $2.80 per 1,000; ~30 jobs per role page)"
                checked={settings.sources.wellfound.enabled}
              />
              <ListField
                name="wellfoundRoles"
                label="Wellfound role pages"
                hint="Slugs from wellfound.com/role/r/<slug>, one per line."
                values={settings.sources.wellfound.roles}
                rows={3}
              />
            </div>
            <Field label="Max USD per run">
              <Input
                name="wellfoundMaxUsdPerRun"
                type="number"
                min={0.01}
                max={20}
                step={0.01}
                defaultValue={settings.sources.wellfound.maxUsdPerRun}
              />
            </Field>
          </div>
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_8rem_8rem_8rem]">
            <div className="flex flex-col gap-0.5">
              <Check
                name="careersitesEnabled"
                label="Company career sites"
                checked={settings.sources.careersites.enabled}
              />
              <span className="pl-6 text-xs text-muted-foreground">
                Greenhouse, Lever, Ashby, Workday and ~50 more ATS; $0.002 per job, at least 200 per
                run (about $0.40), repeats billed too
              </span>
            </div>
            <Field label="Jobs per run">
              <Input
                name="careersitesLimit"
                type="number"
                min={200}
                max={1000}
                step={50}
                defaultValue={settings.sources.careersites.limit}
              />
            </Field>
            <Field label="Max USD per run">
              <Input
                name="careersitesMaxUsdPerRun"
                type="number"
                min={0.01}
                max={20}
                step={0.01}
                defaultValue={settings.sources.careersites.maxUsdPerRun}
              />
            </Field>
            <Field label="Hours between runs">
              <Input
                name="careersitesMinHoursBetweenRuns"
                type="number"
                min={0}
                max={168}
                defaultValue={settings.sources.careersites.minHoursBetweenRuns}
              />
            </Field>
          </div>
        </div>
        <Field
          label="Monthly Apify budget (USD)"
          hint="Paid sources are skipped once this much was spent in the last 30 days. Set the same limit in Apify Console (Billing → Usage limit) as a backstop."
        >
          <Input
            name="apifyMonthlyBudgetUsd"
            type="number"
            min={0}
            max={1000}
            step={1}
            defaultValue={settings.apifyMonthlyBudgetUsd}
            className="w-32"
          />
        </Field>
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save and re-screen"}
        </Button>
        {state && (
          <p
            role="status"
            className={state.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
