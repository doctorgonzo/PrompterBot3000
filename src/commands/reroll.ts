import {
  actorName,
  defer,
  deleteMessage,
  editOriginalResponse,
  type Command,
  type Env,
  type Interaction,
} from "../lib/discord.ts";
import { finalizePrompt } from "../lib/deliver.ts";
import { buildPhotoshopPrompt, buildWritingPrompt, isFailure } from "../lib/prompt-builders.ts";
import { asGenre, asLength } from "../lib/prompts.ts";
import { clearLastPrompt, getGuildConfig, getLastPrompt, hasSeen } from "../lib/store.ts";
import { REROLL_COMMAND } from "./definitions.ts";

async function rerollLast(env: Env, interaction: Interaction): Promise<void> {
  const channelId = interaction.channel_id;
  const guildId = interaction.guild_id;

  if (!channelId || !guildId) {
    await editOriginalResponse(env, interaction.token, {
      content: "This only works inside a server channel.",
    });
    return;
  }

  const last = await getLastPrompt(env, channelId);
  if (!last) {
    await editOriginalResponse(env, interaction.token, {
      content: "Nothing to reroll here — I haven't posted a prompt in this channel recently.",
    });
    return;
  }

  const context = {
    requester: actorName(interaction),
    isRepeat: (key: string) => hasSeen(env, guildId, key),
  };

  const built =
    last.kind === "writing"
      ? await buildWritingPrompt(
          {
            genre: asGenre(last.options.genre),
            length: asLength(last.options.length),
            constraint: last.options.constraint === true,
          },
          context,
        )
      : await buildPhotoshopPrompt(
          env,
          {
            sourceId: typeof last.options.source === "string" ? last.options.source : undefined,
            disabledSourceIds: (await getGuildConfig(env, guildId)).disabledSources,
          },
          context,
        );

  if (isFailure(built)) {
    // Leave the original in place if we have nothing to replace it with.
    await editOriginalResponse(env, interaction.token, { content: built.error });
    return;
  }

  // Retract the old prompt first, so the channel never shows both at once.
  // Deleting the message takes its thread with it, which is the intent.
  // Uses the message's own channel rather than assuming it matches this
  // interaction's.
  const removed = await deleteMessage(env, last.channelId ?? channelId, last.messageId);
  if (!removed) {
    console.warn("reroll could not delete the previous prompt", last.messageId);
  }
  await clearLastPrompt(env, channelId);

  const message = await editOriginalResponse(env, interaction.token, built.payload);
  await finalizePrompt(env, interaction, built, {
    message: message ?? undefined,
    wantsThread: true,
  });
}

/**
 * Replaces the most recent prompt in this channel with a fresh draw of the same
 * kind and filters — for when an image lands badly or a prompt doesn't suit.
 *
 * Gated to Manage Messages via `default_member_permissions`.
 */
export const reroll: Command = {
  name: REROLL_COMMAND.name,
  handler: ({ interaction, env, ctx }) => {
    ctx.waitUntil(rerollLast(env, interaction));
    return defer();
  },
};
