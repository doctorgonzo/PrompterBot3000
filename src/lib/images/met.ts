import { fetchJson } from "../http.ts";
import { pick, type Rng } from "../random.ts";
import type { Env } from "../discord.ts";
import { displayTitle, VARIETY_TERMS, type ImageResult, type ImageSource } from "./types.ts";

const DEFAULT_BASE = "https://collectionapi.metmuseum.org/public/collection/v1";

/** Not every search hit is public domain, resolves, or has a usable image. */
const OBJECT_ATTEMPTS = 6;

/**
 * The Met's collection is dominated by prints, coins, fragments and trade cards,
 * which make poor Photoshop material. Paintings only: its "Photographs" medium
 * is full of cigarette-card portrait sets, and Unsplash covers photography.
 *
 * The API treats `medium` as a single value — pipe-separated lists match almost
 * nothing — so this stays a single term.
 */
const MEDIUM = "Paintings";

interface MetSearch {
  objectIDs: number[] | null;
}

interface MetObject {
  isPublicDomain: boolean;
  primaryImage: string;
  primaryImageSmall: string;
  title: string;
  artistDisplayName: string;
  objectDate: string;
  objectURL: string;
}

export const met: ImageSource = {
  id: "met",
  label: "The Met",
  weight: 15,
  isAvailable: () => true,

  async fetch(env: Env, rng: Rng): Promise<ImageResult | null> {
    const base = env.MET_API_BASE ?? DEFAULT_BASE;
    const term = pick(VARIETY_TERMS, rng);

    const search = await fetchJson<MetSearch>(
      `${base}/search?hasImages=true&medium=${encodeURIComponent(MEDIUM)}&q=${encodeURIComponent(term)}`,
    );
    if (!search?.objectIDs?.length) return null;

    for (let attempt = 0; attempt < OBJECT_ATTEMPTS; attempt++) {
      const id = pick(search.objectIDs, rng);
      const object = await fetchJson<MetObject>(`${base}/objects/${id}`);

      if (!object?.isPublicDomain) continue;

      // Prefer the smaller derivative: originals run to many megabytes and
      // Discord's embed proxy gives up on them.
      const imageUrl = object.primaryImageSmall || object.primaryImage;
      if (!imageUrl) continue;

      const creator = object.artistDisplayName || "Unknown artist";
      const date = object.objectDate ? `, ${object.objectDate}` : "";
      const title = displayTitle(object.title);

      return {
        imageUrl,
        title,
        attribution: `[${title}](${object.objectURL}) — ${creator}${date} · The Met · Public domain`,
        sourceId: met.id,
        sourceLabel: met.label,
      };
    }

    return null;
  },
};
