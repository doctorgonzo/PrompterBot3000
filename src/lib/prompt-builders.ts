import challengeData from "../../data/photoshop-challenges.json" with { type: "json" };
import { GENRE_LABELS, LENGTH_HINTS, LENGTH_LABELS } from "../commands/definitions.ts";
import type { Env } from "./discord.ts";
import { fetchImagePrompt } from "./images/index.ts";
import { pickWritingPrompt, type Genre, type Length } from "./prompts.ts";
import { pick } from "./random.ts";
import { shortHash, type PromptKind } from "./store.ts";
import { threadNameFor } from "./threads.ts";

const WRITING_COLOR = 0xe0a458;
const PHOTOSHOP_COLOR = 0x5b8fa8;

/** Redraws allowed before accepting a prompt this guild has seen recently. */
const WRITING_REPEAT_ATTEMPTS = 5;

const challenges = (challengeData as { challenges: string[] }).challenges;

/** Unix seconds for the deadline, or undefined when there isn't one. */
function deadlineFrom(hours: number | undefined, now = Date.now()): number | undefined {
  if (!hours || hours <= 0) return undefined;
  return Math.floor(now / 1000) + hours * 3600;
}

/**
 * Discord renders <t:...> in the reader's own timezone, so a deadline reads
 * correctly for everyone without us naming one.
 */
function deadlineField(closesAt: number) {
  return {
    name: "⏳ Submissions close",
    value: `<t:${closesAt}:F> — <t:${closesAt}:R>`,
  };
}

export interface BuiltPrompt {
  kind: PromptKind;
  /** Unix seconds when submissions close, if a deadline was requested. */
  closesAt?: number;
  /** Message payload, ready to post or to PATCH into a deferred response. */
  payload: Record<string, unknown>;
  threadName: string;
  dedupeKey: string;
  /** The options that produced it, so /reroll can reproduce the same filters. */
  options: Record<string, string | number | boolean>;
  /** Fired after posting, for sources that require usage reporting. */
  onPosted?: (env: Env) => Promise<void>;
}

export interface BuildFailure {
  error: string;
}

export type BuildResult = BuiltPrompt | BuildFailure;

export const isFailure = (result: BuildResult): result is BuildFailure => "error" in result;

export interface BuildContext {
  requester?: string;
  /** Hours until submissions close. 0 or absent means no deadline. */
  closesInHours?: number;
  /** Returns true when this prompt was posted in the guild recently. */
  isRepeat?: (dedupeKey: string) => Promise<boolean>;
}

export interface WritingOptions {
  genre?: Genre;
  length?: Length;
  constraint?: boolean;
}

export async function buildWritingPrompt(
  options: WritingOptions,
  context: BuildContext = {},
): Promise<BuildResult> {
  let chosen = null;
  let firstRepeat = null;

  for (let attempt = 0; attempt < WRITING_REPEAT_ATTEMPTS; attempt++) {
    const candidate = pickWritingPrompt(options);
    if (!candidate) break;

    const key = `w:${shortHash(candidate.text)}`;
    if (!context.isRepeat || !(await context.isRepeat(key))) {
      chosen = candidate;
      break;
    }
    firstRepeat ??= candidate;
  }

  // A recent repeat still beats posting nothing.
  const prompt = chosen ?? firstRepeat;

  if (!prompt) {
    return {
      error:
        `Nothing matches **${options.genre ? GENRE_LABELS[options.genre] : "any genre"}** and ` +
        `**${options.length ? LENGTH_LABELS[options.length] : "any length"}** — poems only come ` +
        "from the poetry genre. Try one filter or the other.",
    };
  }

  const footer: string[] = [GENRE_LABELS[prompt.genre], LENGTH_HINTS[prompt.length]];
  if (context.requester) footer.push(`for ${context.requester}`);

  const closesAt = deadlineFrom(context.closesInHours);
  const fields = [
    ...(prompt.constraint ? [{ name: "Constraint", value: prompt.constraint }] : []),
    ...(closesAt ? [deadlineField(closesAt)] : []),
  ];

  return {
    kind: "writing",
    ...(closesAt ? { closesAt } : {}),
    payload: {
      embeds: [
        {
          title: "✍️ Writing Prompt",
          description: prompt.text,
          color: WRITING_COLOR,
          ...(fields.length > 0 ? { fields } : {}),
          footer: { text: footer.join(" · ") },
        },
      ],
    },
    threadName: threadNameFor(prompt.text),
    dedupeKey: `w:${shortHash(prompt.text)}`,
    options: {
      ...(options.genre ? { genre: options.genre } : {}),
      ...(options.length ? { length: options.length } : {}),
      ...(options.constraint ? { constraint: true } : {}),
      ...(context.closesInHours ? { closes: context.closesInHours } : {}),
    },
  };
}

export interface PhotoshopOptions {
  sourceId?: string;
  disabledSourceIds?: readonly string[];
}

export async function buildPhotoshopPrompt(
  env: Env,
  options: PhotoshopOptions,
  context: BuildContext = {},
): Promise<BuildResult> {
  const image = await fetchImagePrompt(env, Math.random, {
    forcedSourceId: options.sourceId,
    disabledSourceIds: options.disabledSourceIds,
    isRepeat: context.isRepeat,
  });

  if (!image) {
    return {
      error: options.sourceId
        ? "That collection isn't responding right now — try again, or leave `source` off to use any of them."
        : "Couldn't reach any image source just now. Try again in a moment.",
    };
  }

  const challenge = pick(challenges, Math.random);
  const closesAt = deadlineFrom(context.closesInHours);

  return {
    kind: "photoshop",
    ...(closesAt ? { closesAt } : {}),
    payload: {
      embeds: [
        {
          title: "🖼️ Photoshop Challenge",
          // Attribution sits in the description because embed footers can't
          // hold links, and some sources require the credit to be linked.
          description: `**${challenge}**\n\n${image.attribution}`,
          color: PHOTOSHOP_COLOR,
          image: { url: image.imageUrl },
          ...(closesAt ? { fields: [deadlineField(closesAt)] } : {}),
          ...(context.requester ? { footer: { text: `for ${context.requester}` } } : {}),
        },
      ],
    },
    threadName: threadNameFor(image.title, "🖼️ "),
    dedupeKey: image.dedupeKey,
    options: {
      ...(options.sourceId ? { source: options.sourceId } : {}),
      ...(context.closesInHours ? { closes: context.closesInHours } : {}),
    },
    ...(image.usageTrackingUrl
      ? {
          onPosted: async (usedEnv: Env) => {
            const { reportUnsplashUse } = await import("./images/index.ts");
            await reportUnsplashUse(usedEnv, image.usageTrackingUrl!);
          },
        }
      : {}),
  };
}
