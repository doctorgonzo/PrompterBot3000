import {
  followUp,
  getOriginalResponse,
  startThreadFromMessage,
  MessageFlags,
  type DiscordMessage,
  type Env,
} from "./discord.ts";

/** Discord's hard cap on thread names. */
const MAX_THREAD_NAME = 100;

/** 7 days. Available to all guilds since the boost-level requirement was dropped. */
const AUTO_ARCHIVE_MINUTES = 10080;

/**
 * Derives a thread name from prompt text, trimmed to a word boundary so it
 * doesn't cut mid-word.
 */
export function threadNameFor(text: string, prefix = "✍️ "): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const available = MAX_THREAD_NAME - prefix.length;

  if (flat.length <= available) return prefix + flat;

  const truncated = flat.slice(0, available - 1);
  const atWordBoundary = truncated.replace(/[\s,.;:—-]+\S*$/, "");

  return prefix + (atWordBoundary || truncated) + "…";
}

function failureMessage(status: number): string {
  if (status === 403) {
    return "I posted the prompt, but I can't open a thread here — a mod needs to give me **Create Public Threads** in this channel.";
  }
  if (status === 429) {
    return "I posted the prompt, but Discord is rate-limiting thread creation right now.";
  }
  return `I posted the prompt, but couldn't open a thread (Discord returned ${status}).`;
}

/**
 * Opens a thread on the message we just posted.
 *
 * Intended for `ctx.waitUntil` — the prompt is already visible by the time this
 * runs, so a failure here must not look like the command failed. Pass `message`
 * when you already have it (the deferred path gets one back from the edit);
 * otherwise it is looked up, with retries.
 */
export async function openThreadForInteraction(
  env: Env,
  interactionToken: string,
  name: string,
  message?: DiscordMessage,
): Promise<void> {
  const target = message ?? (await getOriginalResponse(env, interactionToken));

  if (!target) {
    await followUp(env, interactionToken, {
      content: "I posted the prompt, but couldn't find it again to open a thread.",
      flags: MessageFlags.EPHEMERAL,
    });
    return;
  }

  const result = await startThreadFromMessage(env, target, name, AUTO_ARCHIVE_MINUTES);

  if (!result.ok) {
    await followUp(env, interactionToken, {
      content: failureMessage(result.status),
      flags: MessageFlags.EPHEMERAL,
    });
  }
}
