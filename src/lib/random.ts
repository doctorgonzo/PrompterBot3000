/** Shared randomness helpers. The Rng is injectable so tests stay deterministic. */

export type Rng = () => number;

export function randomInt(maxExclusive: number, rng: Rng): number {
  return Math.floor(rng() * maxExclusive);
}

export function pick<T>(items: readonly T[], rng: Rng): T {
  const item = items[randomInt(items.length, rng)];
  if (item === undefined) {
    throw new Error("pick() called on an empty list");
  }
  return item;
}

/**
 * Orders items by weighted random selection without replacement, so callers can
 * walk the result as a preference order and fall through on failure.
 */
export function weightedOrder<T extends { weight: number }>(items: readonly T[], rng: Rng): T[] {
  const remaining = [...items];
  const ordered: T[] = [];

  while (remaining.length > 0) {
    const total = remaining.reduce((sum, item) => sum + item.weight, 0);
    let roll = rng() * total;

    let index = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      roll -= remaining[i]!.weight;
      if (roll <= 0) {
        index = i;
        break;
      }
    }

    ordered.push(...remaining.splice(index, 1));
  }

  return ordered;
}
