import { reply, type Command } from "../lib/discord.ts";
import { PING_COMMAND } from "./definitions.ts";

/**
 * Phase 0 smoke test: proves signature verification, routing, and deployment all
 * work before any real feature depends on them.
 */
export const ping: Command = {
  name: PING_COMMAND.name,
  handler: () => reply("Awake and listening. 🎨", { ephemeral: true }),
};
