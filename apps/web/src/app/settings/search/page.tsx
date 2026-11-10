import { getSearchSettings } from "@copilot/db";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { SearchSettingsForm } from "@/components/search-settings-form";
import { appDb } from "@/server/db";

export default function SearchSettingsPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader>
        <Link href="/discovery" className="text-sm text-muted-foreground hover:text-foreground">
          Discovery
        </Link>
        <span className="text-sm text-muted-foreground">/</span>
        <h1 className="text-sm font-semibold">Search settings</h1>
      </PageHeader>
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-4">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading settings…</p>}>
          <Settings />
        </Suspense>
      </div>
    </div>
  );
}

async function Settings() {
  await connection(); // libsql is synchronous: keep these reads out of prerendering
  const settings = await getSearchSettings(await appDb());
  return <SearchSettingsForm settings={settings} />;
}
