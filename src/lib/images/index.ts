import type { Env } from "../discord.ts";
import { weightedOrder, type Rng } from "../random.ts";
import { artic } from "./artic.ts";
import { met } from "./met.ts";
import { unsplash } from "./unsplash.ts";
import type { ImageResult, ImageSource } from "./types.ts";

export { reportUnsplashUse } from "./unsplash.ts";
export type { ImageResult } from "./types.ts";

export const IMAGE_SOURCES: readonly ImageSource[] = [met, artic, unsplash];

/**
 * Fetches one image, trying sources in weighted-random order and falling
 * through on failure — a single API being down should not break the command.
 *
 * Returns null only when every available source failed.
 */
export async function fetchImagePrompt(
  env: Env,
  rng: Rng = Math.random,
  forcedSourceId?: string,
): Promise<ImageResult | null> {
  let candidates = IMAGE_SOURCES.filter((source) => source.isAvailable(env));

  if (forcedSourceId) {
    candidates = candidates.filter((source) => source.id === forcedSourceId);
  }

  if (candidates.length === 0) return null;

  for (const source of weightedOrder(candidates, rng)) {
    const result = await source.fetch(env, rng);
    if (result) return result;
    console.warn("image source returned nothing, falling through", source.id);
  }

  return null;
}
