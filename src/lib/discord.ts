/**
 * Minimal Discord API surface. Plain `as const` objects rather than TS enums so
 * these files stay readable by Node's type-stripping loader (scripts/ imports them).
 */

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const;

export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
} as const;

export const MessageFlags = {
  EPHEMERAL: 1 << 6,
} as const;

export const DISCORD_API = "https://discord.com/api/v10";

export interface CommandOptionValue {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: CommandOptionValue[];
}

export interface Interaction {
  id: string;
  type: number;
  token: string;
  application_id: string;
  guild_id?: string;
  channel_id?: string;
  data?: {
    id: string;
    name: string;
    options?: CommandOptionValue[];
  };
  member?: { user: { id: string; username: string }; permissions?: string };
  user?: { id: string; username: string };
}

export interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_BOT_TOKEN: string;
  /** Optional: enables the Unsplash image source when present. */
  UNSPLASH_ACCESS_KEY?: string;
  /** Optional: everything degrades gracefully when this binding is absent. */
  PROMPT_STATE?: KVNamespace;
  /** Test-only overrides so the suite can point at mock APIs. */
  DISCORD_API_BASE?: string;
  MET_API_BASE?: string;
  AIC_API_BASE?: string;
  UNSPLASH_API_BASE?: string;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
}

const apiBase = (env: Env) => env.DISCORD_API_BASE ?? DISCORD_API;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface CommandContext {
  interaction: Interaction;
  env: Env;
  /** Use `ctx.waitUntil` to finish slow work after returning a deferred response. */
  ctx: ExecutionContext;
}

export interface Command {
  name: string;
  handler: (context: CommandContext) => Promise<Response> | Response;
}

/** Reads the invoking user's id from either a guild (member) or DM (user) interaction. */
export function actorId(interaction: Interaction): string | undefined {
  return interaction.member?.user.id ?? interaction.user?.id;
}

export function getOption(interaction: Interaction, name: string): string | number | boolean | undefined {
  return interaction.data?.options?.find((option) => option.name === name)?.value;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json;charset=UTF-8" },
  });
}

export function pong(): Response {
  return jsonResponse({ type: InteractionResponseType.PONG });
}

export function reply(content: string, options: { ephemeral?: boolean } = {}): Response {
  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content,
      ...(options.ephemeral ? { flags: MessageFlags.EPHEMERAL } : {}),
    },
  });
}

/**
 * Tells Discord "working on it" so we keep the interaction alive past its 3s
 * deadline. Follow up with `editOriginalResponse` within 15 minutes.
 */
/** Replies with an arbitrary message payload (embeds, content, or both). */
export function replyWith(payload: Record<string, unknown>): Response {
  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: payload,
  });
}

export function defer(options: { ephemeral?: boolean } = {}): Response {
  return jsonResponse({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    ...(options.ephemeral ? { data: { flags: MessageFlags.EPHEMERAL } } : {}),
  });
}

/**
 * Replaces the "thinking..." placeholder created by `defer`. Returns the
 * resulting message, which is what you need to hang a thread off.
 */
export async function editOriginalResponse(
  env: Env,
  interactionToken: string,
  payload: Record<string, unknown>,
): Promise<DiscordMessage | null> {
  const url = `${apiBase(env)}/webhooks/${env.DISCORD_APPLICATION_ID}/${interactionToken}/messages/@original`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.error("editOriginalResponse failed", response.status, await response.text());
    return null;
  }
  return (await response.json()) as DiscordMessage;
}

/**
 * How long to keep asking Discord for the message we just replied with.
 *
 * `ctx.waitUntil` work starts before our interaction response has finished
 * flushing, so the message genuinely may not exist for the first attempt. A 404
 * here is expected, not an error.
 */
const ORIGINAL_RESPONSE_BACKOFF_MS = [0, 250, 500, 1000, 1500];

export async function getOriginalResponse(
  env: Env,
  interactionToken: string,
): Promise<DiscordMessage | null> {
  const url = `${apiBase(env)}/webhooks/${env.DISCORD_APPLICATION_ID}/${interactionToken}/messages/@original`;

  for (const delay of ORIGINAL_RESPONSE_BACKOFF_MS) {
    if (delay > 0) await sleep(delay);

    const response = await fetch(url);
    if (response.ok) return (await response.json()) as DiscordMessage;

    if (response.status !== 404) {
      console.error("getOriginalResponse failed", response.status, await response.text());
      return null;
    }
  }

  console.error("getOriginalResponse: message never appeared");
  return null;
}

/** Sends an additional message on the same interaction, up to 15 minutes later. */
export async function followUp(
  env: Env,
  interactionToken: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const url = `${apiBase(env)}/webhooks/${env.DISCORD_APPLICATION_ID}/${interactionToken}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.error("followUp failed", response.status, await response.text());
  }
}

/** Opens a public thread hanging off an existing message. */
export async function startThreadFromMessage(
  env: Env,
  message: DiscordMessage,
  name: string,
  autoArchiveMinutes: number,
): Promise<{ ok: true } | { ok: false; status: number }> {
  const url = `${apiBase(env)}/channels/${message.channel_id}/messages/${message.id}/threads`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    },
    body: JSON.stringify({ name, auto_archive_duration: autoArchiveMinutes }),
  });

  if (response.ok) return { ok: true };

  console.error("startThreadFromMessage failed", response.status, await response.text());
  return { ok: false, status: response.status };
}

export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  image?: { url: string };
}

export function replyWithEmbed(embed: Embed, options: { ephemeral?: boolean } = {}): Response {
  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      embeds: [embed],
      ...(options.ephemeral ? { flags: MessageFlags.EPHEMERAL } : {}),
    },
  });
}

/** Display name of whoever ran the command, for attribution in a footer. */
export function actorName(interaction: Interaction): string | undefined {
  return interaction.member?.user.username ?? interaction.user?.username;
}

/** Deletes a message. Used by /reroll to retract a prompt it is replacing. */
export async function deleteMessage(
  env: Env,
  channelId: string,
  messageId: string,
): Promise<boolean> {
  const response = await fetch(`${apiBase(env)}/channels/${channelId}/messages/${messageId}`, {
    method: "DELETE",
    headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
  });

  // 404 means it is already gone, which is the outcome we wanted anyway.
  if (response.ok || response.status === 404) return true;

  console.error("deleteMessage failed", response.status, await response.text());
  return false;
}
