import type { Env } from "../discord.ts";
import { weightedOrder, type Rng } from "../random.ts";
import { artic } from "./artic.ts";
import { met } from "./met.ts";
import { unsplash } from "./unsplash.ts";
import type { ImageResult, ImageSource } from "./types.ts";

export { reportUnsplashUse } from "./unsplash.ts";
export type { ImageResult } from "./types.ts";

export const IMAGE_SOURCES: readonly ImageSource[] = [met, artic, unsplash];

export interface FetchImageOptions {
  /** Restrict to a single source, as requested by the `source` option. */
  forcedSourceId?: string;
  /** Sources a moderator has turned off for this guild. */
  disabledSourceIds?: readonly string[];
  /** Returns true if this artwork was posted here recently. */
  isRepeat?: (dedupeKey: string) => Promise<boolean>;
  /** Redraws allowed per source before accepting a repeat. */
  repeatAttempts?: number;
}

const DEFAULT_REPEAT_ATTEMPTS = 3;

/**
 * Fetches one image, trying sources in weighted-random order and falling
 * through on failure — a single API being down should not break the command.
 *
 * When `isRepeat` is supplied, recently posted artwork is redrawn past. If
 * everything drawn turns out to be a repeat, the first one is returned anyway:
 * a repeat beats posting nothing.
 *
 * Returns null only when no source could produce anything.
 */
/**
 * Narrows the source list by availability, a forced choice, and the guild's
 * blocklist. Exported for testing.
 */
export function selectSources(
  sources: readonly ImageSource[],
  env: Env,
  options: FetchImageOptions = {},
): ImageSource[] {
  const available = sources.filter((source) => source.isAvailable(env));

  if (options.forcedSourceId) {
    return available.filter((source) => source.id === options.forcedSourceId);
  }

  if (options.disabledSourceIds?.length) {
    const enabled = available.filter(
      (source) => !options.disabledSourceIds!.includes(source.id),
    );
    // Ignore the blocklist rather than post nothing if it disables everything.
    if (enabled.length > 0) return enabled;
  }

  return available;
}

/**
 * Draws from an explicit source list. Exported so the fallback and repeat logic
 * can be tested with stub sources instead of live APIs.
 */
export async function drawFrom(
  sources: readonly ImageSource[],
  env: Env,
  rng: Rng,
  options: FetchImageOptions = {},
): Promise<ImageResult | null> {
  if (sources.length === 0) return null;

  const attempts = options.repeatAttempts ?? DEFAULT_REPEAT_ATTEMPTS;
  let firstRepeat: ImageResult | null = null;

  for (const source of weightedOrder(sources, rng)) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const result = await source.fetch(env, rng);

      if (!result) {
        console.warn("image source returned nothing, falling through", source.id);
        break;
      }

      if (!options.isRepeat || !(await options.isRepeat(result.dedupeKey))) {
        return result;
      }

      firstRepeat ??= result;
    }
  }

  return firstRepeat;
}

export async function fetchImagePrompt(
  env: Env,
  rng: Rng = Math.random,
  options: FetchImageOptions = {},
): Promise<ImageResult | null> {
  return drawFrom(selectSources(IMAGE_SOURCES, env, options), env, rng, options);
}
