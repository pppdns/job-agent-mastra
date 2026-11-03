// M3 extraction spike: Tavily extract (advanced) vs Firecrawl scrape on real LinkedIn job URLs.
// Live, costs a few credits. Run from the repo root:
//   node --env-file=apps/agent/.env apps/agent/scripts/spikes/extraction.ts <out-dir> <url>...
// Raw outputs go to <out-dir> (keep it outside the repo); stdout gets a summary only.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [outDir, ...urls] = process.argv.slice(2);
if (!outDir || urls.length === 0) throw new Error("usage: extraction.ts <out-dir> <url>...");
mkdirSync(outDir, { recursive: true });

function key(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function tavily(url: string) {
  const res = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key("TAVILY_API_KEY")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      urls: url,
      extract_depth: "advanced",
      format: "markdown",
      include_usage: true,
    }),
  });
  const body = (await res.json()) as {
    results?: { raw_content?: string }[];
    failed_results?: { error?: string }[];
    usage?: unknown;
  };
  return {
    status: res.status,
    text: body.results?.[0]?.raw_content ?? "",
    error: body.failed_results?.[0]?.error,
    usage: body.usage,
  };
}

async function firecrawl(url: string) {
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key("FIRECRAWL_API_KEY")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: 60000 }),
  });
  const body = (await res.json()) as {
    data?: { markdown?: string; metadata?: { title?: string; statusCode?: number; url?: string } };
    error?: string;
  };
  return {
    status: res.status,
    text: body.data?.markdown ?? "",
    error: body.error,
    title: body.data?.metadata?.title,
    finalUrl: body.data?.metadata?.url,
    pageStatus: body.data?.metadata?.statusCode,
  };
}

const SIGNALS = {
  aboutTheJob: /about the job|job description|responsibilities|requirements|qualifications/i,
  loginWall: /sign in to|join now|authwall|join linkedin|log in to see/i,
  seeMore: /show more|see more/i,
};

function summarize(text: string) {
  const signals = Object.fromEntries(
    Object.entries(SIGNALS).map(([name, re]) => [name, re.test(text)]),
  );
  return { chars: text.length, words: text.split(/\s+/).filter(Boolean).length, ...signals };
}

for (const [i, url] of urls.entries()) {
  const id = `job${i + 1}`;
  const started = Date.now();
  const [t, f] = await Promise.allSettled([tavily(url), firecrawl(url)]);
  const elapsed = Date.now() - started;
  console.log(`\n=== ${id} ${url} (${elapsed} ms for both)`);
  for (const [name, result] of [
    ["tavily", t],
    ["firecrawl", f],
  ] as const) {
    if (result.status === "rejected") {
      console.log(`  ${name}: threw ${String(result.reason).slice(0, 200)}`);
      continue;
    }
    const { text, ...meta } = result.value;
    writeFileSync(join(outDir, `${id}.${name}.md`), text);
    console.log(`  ${name}:`, JSON.stringify({ ...meta, ...summarize(text) }));
    console.log(`    head: ${text.slice(0, 300).replace(/\s+/g, " ")}`);
  }
}
