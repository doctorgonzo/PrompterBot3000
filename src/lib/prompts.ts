import curatedData from "../../data/writing-prompts.json" with { type: "json" };
import mixerData from "../../data/prompt-mixer.json" with { type: "json" };
import { GENRES, LENGTHS } from "../commands/definitions.ts";
import { pick, type Rng } from "./random.ts";

export type Genre = (typeof GENRES)[number];
export type Length = (typeof LENGTHS)[number];

export interface WritingPrompt {
  text: string;
  genre: Genre;
  length: Length;
  source: "curated" | "generated";
  /** Optional formal constraint, only present when the user asked for one. */
  constraint?: string;
}

export interface PromptFilters {
  genre?: Genre;
  length?: Length;
  constraint?: boolean;
}

/** Injectable so tests can drive selection deterministically. */
export type { Rng };

const curated = curatedData.prompts as ReadonlyArray<{
  text: string;
  genre: Genre;
  length: Length;
}>;

const mixer = mixerData as {
  characters: readonly string[];
  charactersByGenre: Partial<Record<Genre, readonly string[]>>;
  situations: ReadonlyArray<{ genre: Genre; text: string }>;
  settings: readonly string[];
  settingsByGenre: Partial<Record<Genre, readonly string[]>>;
  constraints: readonly string[];
};

/** Share of requests answered by the mixer rather than the curated pack. */
const GENERATED_SHARE = 1 / 3;

/** The mixer writes prose situations; it has no business generating poetry. */
const GENERATED_LENGTHS: readonly Length[] = ["flash", "scene"];

/**
 * Builds a prompt from mixer parts. Returns null when the filters ask for
 * something the mixer cannot produce (poetry, or a poem-length piece).
 */
function generate(filters: PromptFilters, rng: Rng): WritingPrompt | null {
  if (filters.length === "poem" || filters.genre === "poetry") return null;

  const situations = filters.genre
    ? mixer.situations.filter((situation) => situation.genre === filters.genre)
    : mixer.situations;

  if (situations.length === 0) return null;

  // Situation first: its genre decides which character and setting pools apply.
  // The universal pools are contemporary-realist, which would be nonsense for
  // sci-fi or cyberpunk ("A crossing guard is the only crew member awake...").
  const situation = pick(situations, rng);
  const character = pick(mixer.charactersByGenre[situation.genre] ?? mixer.characters, rng);
  const setting = pick(mixer.settingsByGenre[situation.genre] ?? mixer.settings, rng);

  return {
    text: `${character} ${situation.text}, ${setting}.`,
    genre: situation.genre,
    length: filters.length ?? pick(GENERATED_LENGTHS, rng),
    source: "generated",
  };
}

function curatedPool(filters: PromptFilters) {
  return curated.filter(
    (prompt) =>
      (!filters.genre || prompt.genre === filters.genre) &&
      (!filters.length || prompt.length === filters.length),
  );
}

/**
 * Picks a prompt matching the filters, blending the curated pack with generated
 * ones so the pool doesn't feel exhausted after a month.
 *
 * Returns null only when no source can satisfy the filters — e.g. Humor + A poem.
 * Callers should tell the user rather than treating it as an error.
 */
export function pickWritingPrompt(
  filters: PromptFilters = {},
  rng: Rng = Math.random,
): WritingPrompt | null {
  const pool = curatedPool(filters);

  // Try the mixer first on its share of requests, but always fall back rather
  // than failing when it can't serve the filters.
  let prompt: WritingPrompt | null = rng() < GENERATED_SHARE ? generate(filters, rng) : null;

  if (!prompt && pool.length > 0) {
    prompt = { ...pick(pool, rng), source: "curated" };
  }

  if (!prompt) {
    prompt = generate(filters, rng);
  }

  if (!prompt) return null;

  return filters.constraint ? { ...prompt, constraint: pick(mixer.constraints, rng) } : prompt;
}

/** Exposed for the README and tests; counts each genre's actual pools. */
export const promptStats = {
  curated: curated.length,
  combinations: mixer.situations.reduce((total, situation) => {
    const characters = mixer.charactersByGenre[situation.genre] ?? mixer.characters;
    const settings = mixer.settingsByGenre[situation.genre] ?? mixer.settings;
    return total + characters.length * settings.length;
  }, 0),
};

export function asGenre(value: unknown): Genre | undefined {
  return typeof value === "string" && (GENRES as readonly string[]).includes(value)
    ? (value as Genre)
    : undefined;
}

export function asLength(value: unknown): Length | undefined {
  return typeof value === "string" && (LENGTHS as readonly string[]).includes(value)
    ? (value as Length)
    : undefined;
}
