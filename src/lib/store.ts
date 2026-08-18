import type { Env } from "./discord.ts";

/**
 * Persistent state in Workers KV: which prompts a guild has seen recently,
 * per-guild source settings, and the last prompt posted in each channel.
 *
 * Every function degrades gracefully when the binding is missing, so the bot
 * keeps working (just without memory) if KV is unconfigured.
 */

/** How long a prompt counts as "recently seen". */
const SEEN_TTL_SECONDS = 60 * 60 * 24 * 45;

/** The reroll pointer only needs to outlive a moderator noticing a bad post. */
const LAST_PROMPT_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface GuildConfig {
  disabledSources: string[];
}

export type PromptKind = "writing" | "photoshop";

export interface LastPrompt {
  messageId: string;
  /** Taken from the posted message rather than assumed from the interaction. */
  channelId: string;
  kind: PromptKind;
  /** The original command options, so a reroll keeps the same filters. */
  options: Record<string, string | boolean>;
}

const EMPTY_CONFIG: GuildConfig = { disabledSources: [] };

/** What a server has scheduled. Absent means no daily post. */
export interface DailyConfig {
  guildId: string;
  channelId: string;
  /** "alternate" swaps between the two kinds each day. */
  kind: PromptKind | "alternate";
  /** Hour of the day in DAILY_TIME_ZONE, 0-23. */
  hour: number;
  /** Last kind actually posted, so "alternate" knows which comes next. */
  lastKind?: PromptKind;
  /** Local date (YYYY-MM-DD) of the last post, to prevent double-posting. */
  lastPostedDate?: string;
}

/** Cheap, stable hash so prompt text becomes a tidy key. */
export function shortHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function isStoreAvailable(env: Env): boolean {
  return Boolean(env.PROMPT_STATE);
}

export async function hasSeen(env: Env, guildId: string, key: string): Promise<boolean> {
  if (!env.PROMPT_STATE) return false;
  try {
    return (await env.PROMPT_STATE.get(`seen:${guildId}:${key}`)) !== null;
  } catch (error) {
    // Never let a storage hiccup stop a prompt going out.
    console.error("hasSeen failed", error);
    return false;
  }
}

export async function markSeen(env: Env, guildId: string, key: string): Promise<void> {
  if (!env.PROMPT_STATE) return;
  try {
    await env.PROMPT_STATE.put(`seen:${guildId}:${key}`, "1", {
      expirationTtl: SEEN_TTL_SECONDS,
    });
  } catch (error) {
    console.error("markSeen failed", error);
  }
}

export async function getGuildConfig(env: Env, guildId: string): Promise<GuildConfig> {
  if (!env.PROMPT_STATE) return EMPTY_CONFIG;
  try {
    const stored = await env.PROMPT_STATE.get<GuildConfig>(`config:${guildId}`, "json");
    return stored?.disabledSources ? stored : EMPTY_CONFIG;
  } catch (error) {
    console.error("getGuildConfig failed", error);
    return EMPTY_CONFIG;
  }
}

/** Returns the updated config, or null when there is nowhere to store it. */
export async function setSourceEnabled(
  env: Env,
  guildId: string,
  sourceId: string,
  enabled: boolean,
): Promise<GuildConfig | null> {
  if (!env.PROMPT_STATE) return null;

  const current = await getGuildConfig(env, guildId);
  const disabled = new Set(current.disabledSources);

  if (enabled) disabled.delete(sourceId);
  else disabled.add(sourceId);

  const updated: GuildConfig = { disabledSources: [...disabled].sort() };

  try {
    await env.PROMPT_STATE.put(`config:${guildId}`, JSON.stringify(updated));
    return updated;
  } catch (error) {
    console.error("setSourceEnabled failed", error);
    return null;
  }
}

export async function rememberLastPrompt(
  env: Env,
  channelId: string,
  prompt: LastPrompt,
): Promise<void> {
  if (!env.PROMPT_STATE) return;
  try {
    await env.PROMPT_STATE.put(`last:${channelId}`, JSON.stringify(prompt), {
      expirationTtl: LAST_PROMPT_TTL_SECONDS,
    });
  } catch (error) {
    console.error("rememberLastPrompt failed", error);
  }
}

export async function getLastPrompt(env: Env, channelId: string): Promise<LastPrompt | null> {
  if (!env.PROMPT_STATE) return null;
  try {
    return await env.PROMPT_STATE.get<LastPrompt>(`last:${channelId}`, "json");
  } catch (error) {
    console.error("getLastPrompt failed", error);
    return null;
  }
}

export async function clearLastPrompt(env: Env, channelId: string): Promise<void> {
  if (!env.PROMPT_STATE) return;
  try {
    await env.PROMPT_STATE.delete(`last:${channelId}`);
  } catch (error) {
    console.error("clearLastPrompt failed", error);
  }
}

export async function getDailyConfig(env: Env, guildId: string): Promise<DailyConfig | null> {
  if (!env.PROMPT_STATE) return null;
  try {
    return await env.PROMPT_STATE.get<DailyConfig>(`daily:${guildId}`, "json");
  } catch (error) {
    console.error("getDailyConfig failed", error);
    return null;
  }
}

export async function setDailyConfig(env: Env, config: DailyConfig): Promise<boolean> {
  if (!env.PROMPT_STATE) return false;
  try {
    await env.PROMPT_STATE.put(`daily:${config.guildId}`, JSON.stringify(config));
    return true;
  } catch (error) {
    console.error("setDailyConfig failed", error);
    return false;
  }
}

export async function clearDailyConfig(env: Env, guildId: string): Promise<boolean> {
  if (!env.PROMPT_STATE) return false;
  try {
    await env.PROMPT_STATE.delete(`daily:${guildId}`);
    return true;
  } catch (error) {
    console.error("clearDailyConfig failed", error);
    return false;
  }
}

/**
 * Every server with a daily post configured. Fine to load wholesale — this is
 * one small record per server, read once an hour.
 */
export async function listDailyConfigs(env: Env): Promise<DailyConfig[]> {
  if (!env.PROMPT_STATE) return [];

  try {
    const configs: DailyConfig[] = [];
    let cursor: string | undefined;

    do {
      const page = await env.PROMPT_STATE.list({ prefix: "daily:", cursor });
      for (const key of page.keys) {
        const config = await env.PROMPT_STATE.get<DailyConfig>(key.name, "json");
        if (config?.channelId) configs.push(config);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    return configs;
  } catch (error) {
    console.error("listDailyConfigs failed", error);
    return [];
  }
}
