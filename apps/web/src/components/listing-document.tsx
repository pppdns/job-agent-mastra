import type { Source } from "@copilot/db";
import { ExternalLinkIcon, FileTextIcon } from "lucide-react";
import { Streamdown } from "streamdown";
import { withoutImages } from "@/lib/listing-markdown";

const formatDate = (d: Date) =>
  d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

const host = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/**
 * The listing exactly as it was read, framed like an embedded document so it reads as one
 * verbatim block, apart from everything the app inferred from it.
 */
export function ListingDocument({ source, label }: { source: Source; label: string }) {
  return (
    <section aria-label="Original job description" className="flex flex-col gap-2">
      <h2 className="font-semibold">Original job description</h2>
      <p className="text-sm text-muted-foreground">
        The listing as it was read, unedited. Everything above is derived from it.
      </p>
      <figure className="overflow-hidden rounded-xl border bg-muted/60 ring-1 ring-foreground/5">
        <figcaption className="flex min-w-0 items-center gap-2 border-b bg-muted px-3 py-2 text-xs text-muted-foreground">
          <FileTextIcon className="size-4 shrink-0" />
          <span className="shrink-0 font-medium text-foreground">{label}</span>
          {source.url && (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              title={source.url}
              className="inline-flex min-w-0 items-center gap-1 underline-offset-4 hover:underline"
            >
              <span className="truncate">{host(source.url)}</span>
              <ExternalLinkIcon className="size-3 shrink-0" />
            </a>
          )}
          <span className="ml-auto shrink-0">
            Read {formatDate(source.retrievedAt)}
            {source.truncated ? " · truncated" : ""}
          </span>
        </figcaption>
        <div className="max-h-[36rem] overflow-y-auto p-3 sm:p-5">
          <article className="mx-auto max-w-[68ch] rounded-md border bg-background px-5 py-6 text-sm leading-relaxed shadow-sm sm:px-8 sm:py-8 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_p:empty]:hidden [&>div>:first-child]:mt-0">
            <Streamdown
              // Untrusted page text: no images or raw HTML, so it can't make the browser fetch URLs.
              disallowedElements={["img"]}
              skipHtml
            >
              {withoutImages(source.content)}
            </Streamdown>
          </article>
        </div>
      </figure>
    </section>
  );
}
