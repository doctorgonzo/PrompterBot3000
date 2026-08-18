import { fetchJson } from "../http.ts";
import type { Rng } from "../random.ts";
import type { Env } from "../discord.ts";
import { displayTitle, type ImageResult, type ImageSource } from "./types.ts";

const DEFAULT_BASE = "https://api.unsplash.com";

/** Unsplash's API terms require referral tracking on credit links. */
const UTM = "?utm_source=AutoPrompter&utm_medium=referral";

interface UnsplashPhoto {
  id: string;
  urls: { regular: string; full: string };
  links: { html: string; download_location?: string };
  user: { name: string; links: { html: string } };
  description: string | null;
  alt_description: string | null;
}

export const unsplash: ImageSource = {
  id: "unsplash",
  label: "Unsplash",
  weight: 70,

  // Silently absent unless a key is configured, so the bot works without one.
  isAvailable: (env: Env) => Boolean(env.UNSPLASH_ACCESS_KEY),

  async fetch(env: Env, _rng: Rng): Promise<ImageResult | null> {
    const base = env.UNSPLASH_API_BASE ?? DEFAULT_BASE;

    const photo = await fetchJson<UnsplashPhoto>(
      `${base}/photos/random?content_filter=high&orientation=landscape`,
      { headers: { authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}` } },
    );

    if (!photo?.urls?.regular || !photo.user) return null;

    const title = displayTitle(photo.description || photo.alt_description || "Untitled photo");

    return {
      imageUrl: photo.urls.regular,
      title,
      // Wording and links are prescribed by Unsplash's attribution guidelines.
      attribution:
        `[${title}](${photo.links.html}${UTM}) — Photo by ` +
        `[${photo.user.name}](${photo.user.links.html}${UTM}) on ` +
        `[Unsplash](https://unsplash.com/${UTM})`,
      sourceId: unsplash.id,
      sourceLabel: unsplash.label,
      dedupeKey: `unsplash:${photo.id}`,
      usageTrackingUrl: photo.links.download_location,
    };
  },
};

/** Unsplash asks that this be pinged whenever a photo is actually used. */
export async function reportUnsplashUse(env: Env, trackingUrl: string): Promise<void> {
  if (!env.UNSPLASH_ACCESS_KEY) return;

  try {
    await fetch(trackingUrl, {
      headers: { authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}` },
      signal: AbortSignal.timeout(4000),
    });
  } catch (error) {
    // Best effort only; never let this affect the posted prompt.
    console.error("Unsplash usage ping failed", error);
  }
}
