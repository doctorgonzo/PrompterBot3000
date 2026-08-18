#!/usr/bin/env node
/**
 * Removes guild-scoped slash commands from DISCORD_GUILD_ID.
 *
 *   npm run unregister-guild
 *
 * Needed when moving from one-server to global registration. Global commands
 * do not replace guild-scoped ones — they stack, so every command would appear
 * twice in the original server until the guild copies are cleared.
 *
 * Run this BEFORE removing DISCORD_GUILD_ID, since it needs that value.
 */

import { loadDevVars } from "./load-env.mjs";

loadDevVars();

const applicationId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!applicationId || !botToken || !guildId) {
  console.error("Need DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.");
  process.exit(1);
}

const url = `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`;
const headers = { "content-type": "application/json", authorization: `Bot ${botToken}` };

const listResponse = await fetch(url, { headers });

// Distinguish a real error from an empty list — treating a 403 as "nothing to
// do" would quietly report success while leaving the commands in place.
if (!listResponse.ok) {
  console.error(`Could not read guild commands (HTTP ${listResponse.status}):`);
  console.error(await listResponse.text());
  process.exit(1);
}

const existing = await listResponse.json();

if (!Array.isArray(existing)) {
  console.error("Unexpected response from Discord:", JSON.stringify(existing).slice(0, 200));
  process.exit(1);
}

if (existing.length === 0) {
  console.log(`No guild-scoped commands registered in ${guildId}. Nothing to do.`);
  process.exit(0);
}

console.log(`Removing ${existing.length} guild-scoped command(s) from ${guildId}:`);
for (const command of existing) console.log(`  /${command.name}`);

// An empty PUT replaces the whole set with nothing.
const response = await fetch(url, { method: "PUT", headers, body: "[]" });

if (!response.ok) {
  console.error(`Discord rejected the request (HTTP ${response.status}):`);
  console.error(await response.text());
  process.exit(1);
}

console.log("\nDone. Global commands remain; allow up to an hour for them to appear.");
