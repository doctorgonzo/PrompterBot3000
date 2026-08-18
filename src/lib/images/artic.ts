import { fetchJson } from "../http.ts";
import { pick, randomInt, type Rng } from "../random.ts";
import type { Env } from "../discord.ts";
import { displayTitle, VARIETY_TERMS, type ImageResult, type ImageSource } from "./types.ts";

const DEFAULT_BASE = "https://api.artic.edu/api/v1";

/**
 * The search API rejects offsets past roughly 1000, so paging alone gives a
 * small window. Varying the query term shifts which window we get.
 */
const PAGE_SIZE = 20;
const MAX_PAGE = 50;

/**
 * IIIF "best fit" form (!w,h). An explicit width fails with 403 on any scan
 * narrower than the request — the server refuses to upscale — whereas this caps
 * at the native size instead.
 */
const IIIF_MAX_EDGE = 1686;

interface ArticResponse {
  data: Array<{
    id: number;
    title: string;
    artist_display: string;
    date_display: string;
    image_id: string | null;
  }>;
  config?: { iiif_url?: string };
}

export const artic: ImageSource = {
  id: "artic",
  label: "Art Institute of Chicago",
  weight: 15,
  isAvailable: () => true,

  async fetch(env: Env, rng: Rng): Promise<ImageResult | null> {
    const base = env.AIC_API_BASE ?? DEFAULT_BASE;
    const term = pick(VARIETY_TERMS, rng);
    const page = 1 + randomInt(MAX_PAGE, rng);

    const url =
      `${base}/artworks/search?q=${encodeURIComponent(term)}` +
      `&query[term][is_public_domain]=true` +
      `&fields=id,title,artist_display,date_display,image_id` +
      `&limit=${PAGE_SIZE}&page=${page}`;

    const response = await fetchJson<ArticResponse>(url, {
      // Requested by the Art Institute's API guidelines.
      headers: { "AIC-User-Agent": "AutoPrompter (Discord bot)" },
    });

    const usable = response?.data?.filter((artwork) => artwork.image_id) ?? [];
    if (usable.length === 0) return null;

    const artwork = pick(usable, rng);
    const iiif = response?.config?.iiif_url ?? "https://www.artic.edu/iiif/2";

    // artist_display is multi-line ("Name\nAmerican, born 1945").
    const creator = artwork.artist_display?.split("\n")[0]?.trim() || "Unknown artist";
    const date = artwork.date_display ? `, ${artwork.date_display}` : "";
    const title = displayTitle(artwork.title);
    const pageUrl = `https://www.artic.edu/artworks/${artwork.id}`;

    return {
      imageUrl: `${iiif}/${artwork.image_id}/full/!${IIIF_MAX_EDGE},${IIIF_MAX_EDGE}/0/default.jpg`,
      title,
      attribution: `[${title}](${pageUrl}) — ${creator}${date} · Art Institute of Chicago · Public domain (CC0)`,
      sourceId: artic.id,
      sourceLabel: artic.label,
    };
  },
};
