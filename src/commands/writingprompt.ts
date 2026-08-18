import { actorName, getOption, reply, replyWith, type Command } from "../lib/discord.ts";
import { finalizePrompt } from "../lib/deliver.ts";
import { buildWritingPrompt, isFailure } from "../lib/prompt-builders.ts";
import { asGenre, asLength } from "../lib/prompts.ts";
import { hasSeen } from "../lib/store.ts";
import { WRITING_PROMPT_COMMAND } from "./definitions.ts";

/**
 * Answers inline rather than deferring: selection is local, and the repeat
 * check is a handful of fast KV reads, so this stays well inside Discord's
 * three second window.
 */
export const writingPrompt: Command = {
  name: WRITING_PROMPT_COMMAND.name,
  handler: async ({ interaction, env, ctx }) => {
    const guildId = interaction.guild_id;

    const built = await buildWritingPrompt(
      {
        genre: asGenre(getOption(interaction, "genre")),
        length: asLength(getOption(interaction, "length")),
        constraint: getOption(interaction, "constraint") === true,
      },
      {
        requester: actorName(interaction),
        isRepeat: guildId ? (key) => hasSeen(env, guildId, key) : undefined,
      },
    );

    if (isFailure(built)) {
      return reply(built.error, { ephemeral: true });
    }

    // Threads are opt-out: absent means yes.
    const wantsThread = getOption(interaction, "thread") !== false;
    ctx.waitUntil(finalizePrompt(env, interaction, built, { wantsThread }));

    return replyWith(built.payload);
  },
};
