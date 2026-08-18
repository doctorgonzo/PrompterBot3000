import { postMessage, startThreadFromMessage, type Env } from "./discord.ts";
import { buildPhotoshopPrompt, buildWritingPrompt, isFailure } from "./prompt-builders.ts";
import {
  getGuildConfig,
  hasSeen,
  listDailyConfigs,
  markSeen,
  rememberLastPrompt,
  setDailyConfig,
  type DailyConfig,
  type PromptKind,
} from "./store.ts";

/** Everything schedules against Madison local time, so DST is handled for us. */
export const DAILY_TIME_ZONE = "America/Chicago";

export const DEFAULT_DAILY_HOUR = 10;

const AUTO_ARCHIVE_MINUTES = 10080;

export interface LocalTime {
  /** YYYY-MM-DD in DAILY_TIME_ZONE. */
  date: string;
  /** 0-23 in DAILY_TIME_ZONE. */
  hour: number;
}

export function localTime(instant: Date, timeZone: string = DAILY_TIME_ZONE): LocalTime {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    // h23 rather than hour12:false, which can yield "24" at midnight.
    hourCycle: "h23",
  }).formatToParts(instant);

  const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value ?? "";

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
  };
}

/**
 * True when this server is due a post.
 *
 * Uses `>=` rather than an exact hour match so a failed or missed run catches up
 * later the same day instead of skipping it entirely. `lastPostedDate` is what
 * keeps that from posting more than once a day.
 */
export function shouldPostNow(config: DailyConfig, now: LocalTime): boolean {
  if (now.hour < config.hour) return false;
  return config.lastPostedDate !== now.date;
}

/** "alternate" swaps kinds each day; anything else posts what it says. */
export function nextKind(config: DailyConfig): PromptKind {
  if (config.kind !== "alternate") return config.kind;
  return config.lastKind === "writing" ? "photoshop" : "writing";
}

async function postDaily(env: Env, config: DailyConfig, now: LocalTime): Promise<boolean> {
  const kind = nextKind(config);
  const context = { isRepeat: (key: string) => hasSeen(env, config.guildId, key) };

  const built =
    kind === "writing"
      ? await buildWritingPrompt({}, context)
      : await buildPhotoshopPrompt(
          env,
          { disabledSourceIds: (await getGuildConfig(env, config.guildId)).disabledSources },
          context,
        );

  if (isFailure(built)) {
    console.error("daily prompt could not be built", config.guildId, built.error);
    return false;
  }

  const message = await postMessage(env, config.channelId, built.payload);
  if (!message) {
    // Deliberately not marking it posted, so the next hourly run retries.
    return false;
  }

  if (built.onPosted) await built.onPosted(env);
  await markSeen(env, config.guildId, built.dedupeKey);

  await rememberLastPrompt(env, config.channelId, {
    messageId: message.id,
    channelId: message.channel_id,
    kind: built.kind,
    options: built.options,
  });

  await startThreadFromMessage(env, message, built.threadName, AUTO_ARCHIVE_MINUTES);

  await setDailyConfig(env, { ...config, lastKind: built.kind, lastPostedDate: now.date });
  return true;
}

/**
 * Runs every hour. Each server posts once a day, at its own configured hour.
 * Returns how many posts went out, for logging.
 */
export async function runDailyPrompts(env: Env, instant: Date): Promise<number> {
  const now = localTime(instant);
  const configs = await listDailyConfigs(env);

  let posted = 0;
  for (const config of configs) {
    if (!shouldPostNow(config, now)) continue;

    try {
      if (await postDaily(env, config, now)) posted++;
    } catch (error) {
      // One server's failure must not stop the others.
      console.error("daily prompt failed", config.guildId, error);
    }
  }

  return posted;
}
