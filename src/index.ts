import { commands } from "./commands/index.ts";
import { InteractionType, pong, reply, type Env, type Interaction } from "./lib/discord.ts";
import { verifyDiscordRequest } from "./lib/verify.ts";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Plain health check, handy for eyeballing a deploy in a browser.
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("AutoPrompter is running. Interactions endpoint: POST /interactions", {
        headers: { "content-type": "text/plain;charset=UTF-8" },
      });
    }

    if (request.method !== "POST" || url.pathname !== "/interactions") {
      return new Response("Not found", { status: 404 });
    }

    if (!env.DISCORD_PUBLIC_KEY) {
      console.error("DISCORD_PUBLIC_KEY is not set");
      return new Response("Server misconfigured", { status: 500 });
    }

    // Must verify against the raw bytes, before parsing.
    const rawBody = await request.text();
    const valid = await verifyDiscordRequest(request, rawBody, env.DISCORD_PUBLIC_KEY);
    if (!valid) {
      return new Response("Bad request signature", { status: 401 });
    }

    let interaction: Interaction;
    try {
      interaction = JSON.parse(rawBody) as Interaction;
    } catch {
      return new Response("Malformed payload", { status: 400 });
    }

    if (interaction.type === InteractionType.PING) {
      return pong();
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      const command = commands.get(interaction.data?.name ?? "");
      if (!command) {
        console.warn("Unknown command", interaction.data?.name);
        return reply("I don't know that command yet.", { ephemeral: true });
      }

      try {
        return await command.handler({ interaction, env, ctx });
      } catch (error) {
        // Never leak a stack trace into a public channel.
        console.error("Command failed", interaction.data?.name, error);
        return reply("Something went wrong running that. The error is in the logs.", {
          ephemeral: true,
        });
      }
    }

    return new Response("Unhandled interaction type", { status: 400 });
  },

  // Phase 3 will post the scheduled daily prompt here.
  async scheduled(event: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log("Cron fired", event.cron, new Date(event.scheduledTime).toISOString());
  },
};
