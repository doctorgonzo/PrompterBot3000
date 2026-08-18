import {
  actorName,
  defer,
  editOriginalResponse,
  getOption,
  type Command,
  type Env,
  type Interaction,
} from "../lib/discord.ts";
import { finalizePrompt } from "../lib/deliver.ts";
import { buildPhotoshopPrompt, isFailure } from "../lib/prompt-builders.ts";
import { getGuildConfig, hasSeen } from "../lib/store.ts";
import { PHOTOSHOP_COMMAND } from "./definitions.ts";

async function deliver(
  env: Env,
  interaction: Interaction,
  options: { sourceId?: string; wantsThread: boolean },
): Promise<void> {
  const guildId = interaction.guild_id;
  const config = guildId ? await getGuildConfig(env, guildId) : { disabledSources: [] };

  const built = await buildPhotoshopPrompt(
    env,
    { sourceId: options.sourceId, disabledSourceIds: config.disabledSources },
    {
      requester: actorName(interaction),
      isRepeat: guildId ? (key) => hasSeen(env, guildId, key) : undefined,
    },
  );

  if (isFailure(built)) {
    await editOriginalResponse(env, interaction.token, { content: built.error });
    return;
  }

  const message = await editOriginalResponse(env, interaction.token, built.payload);
  await finalizePrompt(env, interaction, built, {
    message: message ?? undefined,
    wantsThread: options.wantsThread,
  });
}

/**
 * Defers first because this hits the network. The edit also hands back the
 * posted message, so the thread needs no lookup.
 */
export const photoshop: Command = {
  name: PHOTOSHOP_COMMAND.name,
  handler: ({ interaction, env, ctx }) => {
    const rawSource = getOption(interaction, "source");

    ctx.waitUntil(
      deliver(env, interaction, {
        sourceId: typeof rawSource === "string" ? rawSource : undefined,
        wantsThread: getOption(interaction, "thread") !== false,
      }),
    );

    return defer();
  },
};
