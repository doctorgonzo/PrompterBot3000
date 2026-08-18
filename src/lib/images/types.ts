import type { Env } from "../discord.ts";
import type { Rng } from "../random.ts";

export interface ImageResult {
  imageUrl: string;
  title: string;
  /** Markdown, and may contain links — some sources require linked credit. */
  attribution: string;
  sourceId: string;
  sourceLabel: string;
  /**
   * Some APIs (Unsplash) require a ping when a photo is actually used. Fired
   * after the message is posted, never blocking it.
   */
  usageTrackingUrl?: string;
}

export interface ImageSource {
  id: string;
  label: string;
  /** Relative likelihood of being tried first. Museums are weighted higher. */
  weight: number;
  isAvailable: (env: Env) => boolean;
  fetch: (env: Env, rng: Rng) => Promise<ImageResult | null>;
}

/**
 * Normalises a title for display. Museum titles can run to several hundred
 * characters ("A Short History of General John Cabell Breckinridge, from the
 * Histories of Generals series of booklets (N78) for Duke brand cigarettes"),
 * which reads badly as link text and as a thread name.
 */
export function displayTitle(raw: string | null | undefined, max = 110): string {
  const title = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!title) return "Untitled";
  if (title.length <= max) return title;
  const cut = title.slice(0, max - 1).replace(/[\s,;:—-]+\S*$/, "");
  return `${cut || title.slice(0, max - 1)}…`;
}

/**
 * Search terms used to vary results. These reorder relevance rather than
 * filtering, which is what keeps repeat draws from feeling samey.
 */
export const VARIETY_TERMS = [
  "portrait", "landscape", "still life", "armor", "horse", "garden", "ship",
  "mask", "dog", "cat", "dance", "market", "storm", "bridge", "musician",
  "banquet", "hat", "mirror", "angel", "battle", "river", "winter", "harvest",
  "fruit", "window", "crowd", "ruins", "flowers", "night", "workshop",
] as const;
