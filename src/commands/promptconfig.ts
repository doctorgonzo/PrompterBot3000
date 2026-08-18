import { getOption, reply, type Command, type Env } from "../lib/discord.ts";
import { IMAGE_SOURCES } from "../lib/images/index.ts";
import { getGuildConfig, isStoreAvailable, setSourceEnabled, type GuildConfig } from "../lib/store.ts";
import { PROMPT_CONFIG_COMMAND } from "./definitions.ts";

function describe(config: GuildConfig, env: Env): string {
  const lines = IMAGE_SOURCES.map((source) => {
    const off = config.disabledSources.includes(source.id);
    const unavailable = !source.isAvailable(env);

    const state = unavailable
      ? "⚠️ unavailable (no API key configured)"
      : off
        ? "❌ disabled"
        : "✅ enabled";

    return `- **${source.label}** — ${state}`;
  });

  const enabledCount = IMAGE_SOURCES.filter(
    (source) => source.isAvailable(env) && !config.disabledSources.includes(source.id),
  ).length;

  if (enabledCount === 0) {
    lines.push("\n> Every source is off, so `/photoshop` will ignore this list rather than post nothing.");
  }

  return `**Image sources for this server**\n${lines.join("\n")}`;
}

/**
 * Gated to Manage Server via `default_member_permissions`, so Discord hides it
 * from regular members. Server admins can override that per-command under
 * Server Settings → Integrations.
 */
export const promptConfig: Command = {
  name: PROMPT_CONFIG_COMMAND.name,
  handler: async ({ interaction, env }) => {
    const guildId = interaction.guild_id;
    if (!guildId) {
      return reply("This only works inside a server.", { ephemeral: true });
    }

    if (!isStoreAvailable(env)) {
      return reply(
        "Storage isn't configured, so settings can't be saved. The `PROMPT_STATE` KV binding is missing.",
        { ephemeral: true },
      );
    }

    const source = getOption(interaction, "source");
    const enabled = getOption(interaction, "enabled");

    // No source given: just report the current state.
    if (typeof source !== "string") {
      return reply(describe(await getGuildConfig(env, guildId), env), { ephemeral: true });
    }

    if (typeof enabled !== "boolean") {
      return reply("Pass `enabled` as well — `True` to turn a source on, `False` to turn it off.", {
        ephemeral: true,
      });
    }

    const updated = await setSourceEnabled(env, guildId, source, enabled);
    if (!updated) {
      return reply("Couldn't save that — storage rejected the write. Try again.", { ephemeral: true });
    }

    const label = IMAGE_SOURCES.find((candidate) => candidate.id === source)?.label ?? source;
    return reply(
      `**${label}** is now ${enabled ? "enabled" : "disabled"}.\n\n${describe(updated, env)}`,
      { ephemeral: true },
    );
  },
};
