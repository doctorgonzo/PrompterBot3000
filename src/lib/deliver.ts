import { getOriginalResponse, type DiscordMessage, type Env, type Interaction } from "./discord.ts";
import type { BuiltPrompt } from "./prompt-builders.ts";
import { markSeen, rememberLastPrompt } from "./store.ts";
import { openThreadForInteraction } from "./threads.ts";

/**
 * Everything that happens after a prompt is visible: usage reporting, recording
 * it as seen, remembering it for /reroll, and opening its thread.
 *
 * Always run this via `ctx.waitUntil` — the prompt is already posted, so none of
 * it should be able to delay or fail the command. Pass `message` when the caller
 * already has one (the deferred path gets it back from the edit); otherwise it
 * is looked up, with retries.
 */
export async function finalizePrompt(
  env: Env,
  interaction: Interaction,
  built: BuiltPrompt,
  options: { message?: DiscordMessage; wantsThread: boolean },
): Promise<void> {
  if (built.onPosted) await built.onPosted(env);

  if (interaction.guild_id) {
    await markSeen(env, interaction.guild_id, built.dedupeKey);
  }

  const message = options.message ?? (await getOriginalResponse(env, interaction.token));
  if (!message) return;

  if (interaction.channel_id) {
    await rememberLastPrompt(env, interaction.channel_id, {
      messageId: message.id,
      channelId: message.channel_id,
      kind: built.kind,
      options: built.options,
    });
  }

  if (options.wantsThread && interaction.guild_id) {
    await openThreadForInteraction(env, interaction.token, built.threadName, message);
  }
}
