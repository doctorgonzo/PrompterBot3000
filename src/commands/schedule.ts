import { getOption, reply, type Command } from "../lib/discord.ts";
import {
  DEFAULT_DAILY_HOUR,
  describeDays,
  localTime,
  nextKind,
  resolveDays,
} from "../lib/daily.ts";
import {
  clearDailyConfig,
  getDailyConfig,
  isStoreAvailable,
  setDailyConfig,
  type DailyConfig,
} from "../lib/store.ts";
import { SCHEDULE_COMMAND } from "./definitions.ts";

const KIND_LABELS: Record<string, string> = {
  writing: "writing prompts",
  photoshop: "Photoshop challenges",
  alternate: "alternating writing prompts and Photoshop challenges",
};

/** Renders the hour the way a person would say it. */
function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${suffix}`;
}

function describe(config: DailyConfig): string {
  const upNext = config.kind === "alternate" ? ` Up next: ${KIND_LABELS[nextKind(config)]}.` : "";
  return (
    `Scheduled prompts are **on** — ${KIND_LABELS[config.kind]} in <#${config.channelId}>, ` +
    `**${describeDays(config.days)}** at **${hourLabel(config.hour)}** Madison time.${upNext}`
  );
}

export const schedule: Command = {
  name: SCHEDULE_COMMAND.name,
  handler: async ({ interaction, env }) => {
    const guildId = interaction.guild_id;
    if (!guildId) {
      return reply("This only works inside a server.", { ephemeral: true });
    }

    if (!isStoreAvailable(env)) {
      return reply(
        "Storage isn't configured, so a schedule can't be saved. The `PROMPT_STATE` KV binding is missing.",
        { ephemeral: true },
      );
    }

    const kind = getOption(interaction, "kind");
    const channel = getOption(interaction, "channel");
    const hour = getOption(interaction, "hour");
    const days = getOption(interaction, "days");
    const existing = await getDailyConfig(env, guildId);

    // No options: report the current schedule.
    if (kind === undefined && channel === undefined && hour === undefined && days === undefined) {
      return reply(
        existing
          ? describe(existing)
          : "Nothing scheduled. Set it up with `/schedule kind:` and `channel:`.",
        { ephemeral: true },
      );
    }

    if (kind === "off") {
      await clearDailyConfig(env, guildId);
      return reply("Scheduled prompts are now **off**.", { ephemeral: true });
    }

    const channelId = typeof channel === "string" ? channel : existing?.channelId;
    if (!channelId) {
      return reply("Tell me where to post it — pass `channel:` as well.", { ephemeral: true });
    }

    const resolvedKind = (typeof kind === "string" ? kind : existing?.kind ?? "alternate") as
      DailyConfig["kind"];
    const resolvedHour = typeof hour === "number" ? hour : existing?.hour ?? DEFAULT_DAILY_HOUR;
    const resolvedDays =
      typeof days === "string" ? resolveDays(days) : existing?.days ?? resolveDays("daily");

    const now = localTime(new Date());

    const config: DailyConfig = {
      guildId,
      channelId,
      kind: resolvedKind,
      hour: resolvedHour,
      days: resolvedDays,
      ...(existing?.lastKind ? { lastKind: existing.lastKind } : {}),
      // If today's slot has already passed, mark today as done so scheduling
      // doesn't fire a surprise post within the hour. Starts tomorrow instead.
      ...(now.hour >= resolvedHour ? { lastPostedDate: now.date } : {}),
    };

    if (!(await setDailyConfig(env, config))) {
      return reply("Couldn't save that — storage rejected the write. Try again.", {
        ephemeral: true,
      });
    }

    // "Next time" rather than "tomorrow" — with a weekly cadence the next slot
    // may be days away.
    const startsWhen =
      now.hour >= resolvedHour || !resolvedDays.includes(now.weekday)
        ? " Starting next time it comes round."
        : " Starting today.";

    return reply(`${describe(config)}${startsWhen}`, { ephemeral: true });
  },
};
