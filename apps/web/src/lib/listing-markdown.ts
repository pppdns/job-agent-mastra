/** Drops image markup (and links left empty by it): images are never loaded from page text. */
export const withoutImages = (markdown: string) =>
  markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[\s*\]\([^)]*\)/g, "");
