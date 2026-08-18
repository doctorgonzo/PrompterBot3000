#!/usr/bin/env node
/**
 * Pushes the slash command definitions to Discord.
 *
 * Run after any change to src/commands/definitions.ts:  npm run register
 *
 * Reads credentials from .dev.vars (or the environment). If DISCORD_GUILD_ID is
 * set, commands register to that one server and appear instantly — global
 * commands can take up to an hour to propagate, which makes iterating painful.
 */

import { COMMAND_DEFINITIONS } from "../src/commands/definitions.ts";
import { loadDevVars } from "./load-env.mjs";

loadDevVars();

const applicationId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

const missing = [
  ["DISCORD_APPLICATION_ID", applicationId],
  ["DISCORD_BOT_TOKEN", botToken],
].filter(([, value]) => !value).map(([name]) => name);

if (missing.length > 0) {
  console.error(`Missing ${missing.join(" and ")}.`);
  console.error("Add them to .dev.vars (see .dev.vars.example) or export them.");
  process.exit(1);
}

const url = guildId
  ? `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${applicationId}/commands`;

const scope = guildId ? `guild ${guildId} (instant)` : "globally (may take up to an hour)";
console.log(`Registering ${COMMAND_DEFINITIONS.length} command(s) ${scope}...`);

const response = await fetch(url, {
  method: "PUT", // PUT replaces the full set, so deleted commands actually disappear.
  headers: {
    "content-type": "application/json",
    authorization: `Bot ${botToken}`,
  },
  body: JSON.stringify(COMMAND_DEFINITIONS),
});

const body = await response.text();

if (!response.ok) {
  console.error(`Discord rejected the request (HTTP ${response.status}):`);
  console.error(body);
  process.exit(1);
}

for (const command of JSON.parse(body)) {
  console.log(`  /${command.name} — ${command.description}`);
}
console.log("Done.");
