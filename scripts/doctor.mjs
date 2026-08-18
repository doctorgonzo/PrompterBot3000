#!/usr/bin/env node
/**
 * Diagnoses setup problems against the live Discord API.
 *
 *   npm run doctor
 *
 * Checks which credentials are present, whether the bot token actually works,
 * and which servers the bot has been invited to. Never prints secret values.
 *
 * Most useful for telling apart the two errors that look alike:
 *   401 Unauthorized  -> the bot token is wrong
 *   403 Missing Access -> the token is fine, but the bot isn't in that server
 */

import { loadDevVars } from "./load-env.mjs";

loadDevVars();

const token = process.env.DISCORD_BOT_TOKEN;
const applicationId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_GUILD_ID;

const REQUIRED = ["DISCORD_APPLICATION_ID", "DISCORD_PUBLIC_KEY", "DISCORD_BOT_TOKEN"];
const OPTIONAL = ["DISCORD_GUILD_ID"];

console.log("Credentials");
for (const name of [...REQUIRED, ...OPTIONAL]) {
  const value = process.env[name];
  const optional = OPTIONAL.includes(name);
  const status = value ? `set (${value.length} chars)` : optional ? "not set (optional)" : "MISSING";
  console.log(`  ${name.padEnd(24)} ${status}`);
}

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`\nFill in ${missing.join(", ")} in .dev.vars, then re-run.`);
  process.exit(1);
}

const api = (path) =>
  fetch(`https://discord.com/api/v10${path}`, { headers: { authorization: `Bot ${token}` } });

console.log("\nBot token");
let response = await api("/users/@me");
if (!response.ok) {
  console.error(`  INVALID — HTTP ${response.status}: ${await response.text()}`);
  console.error("\n  Reset it at Developer Portal -> Bot -> Reset Token, then update .dev.vars.");
  process.exit(1);
}

const bot = await response.json();
console.log(`  Valid — authenticated as "${bot.username}" (id ${bot.id})`);
if (bot.id !== applicationId) {
  console.log(`  WARNING: bot id does not match DISCORD_APPLICATION_ID (${applicationId}).`);
  console.log("  These come from the same app and should be identical.");
}

console.log("\nServer membership");
response = await api("/users/@me/guilds");
if (!response.ok) {
  console.error(`  HTTP ${response.status}: ${await response.text()}`);
  process.exit(1);
}

const guilds = await response.json();
if (guilds.length === 0) {
  console.log("  The bot is not in any server yet.");
} else {
  for (const guild of guilds) {
    const marker = guild.id === guildId ? "  <-- DISCORD_GUILD_ID" : "";
    console.log(`  ${guild.id}  ${guild.name}${marker}`);
  }
}

if (guildId && !guilds.some((guild) => guild.id === guildId)) {
  console.log(`\n  DISCORD_GUILD_ID ${guildId} is not in that list, so registering guild`);
  console.log("  commands will fail with 403 Missing Access. Invite the bot first:");
  console.log(
    `\n  https://discord.com/api/oauth2/authorize?client_id=${applicationId}` +
      "&scope=bot%20applications.commands&permissions=309237763136\n",
  );
  process.exit(1);
}

console.log("\nAll checks passed.");
