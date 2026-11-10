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

export function SearchSettingsForm({ settings }: { settings: SearchSettings }) {
  const [state, action, pending] = useActionState<DiscoveryActionState, FormData>(
    saveSearchSettingsAction,
    null,
  );
  const { himalayas, linkedin } = settings.sources;
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
          <Field label="Currency" hint="Pay in other currencies isn't compared.">
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
