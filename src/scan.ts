import axios from "axios";

/**
 * Returns plain-text content for a URL.
 *
 * If FIRECRAWL_API_KEY is set, uses Firecrawl (same engine as Agent 1 /
 * the website-audit agent) for a proper crawl+clean. Otherwise falls back
 * to a basic fetch + tag-strip, which is fine for a single-page MVP but
 * will miss content that's rendered client-side.
 */
export async function scrapeSiteText(url: string): Promise<string> {
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;

  if (firecrawlKey) {
    const res = await axios.post(
      "https://api.firecrawl.dev/v1/scrape",
      { url, formats: ["markdown"] },
      { headers: { Authorization: `Bearer ${firecrawlKey}` } }
    );
    const markdown: string | undefined = res.data?.data?.markdown;
    if (markdown) return markdown;
  }

  const res = await axios.get(url, { timeout: 15000 });
  const html: string = res.data;
  return stripHtml(html);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20000); // keep the LLM prompt bounded
}
