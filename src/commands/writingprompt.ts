import {
  actorName,
  getOption,
  reply,
  replyWithEmbed,
  type Command,
} from "../lib/discord.ts";
import { pickWritingPrompt, type Genre, type Length } from "../lib/prompts.ts";
import { openThreadForInteraction, threadNameFor } from "../lib/threads.ts";
import {
  GENRES,
  GENRE_LABELS,
  LENGTHS,
  LENGTH_HINTS,
  LENGTH_LABELS,
  WRITING_PROMPT_COMMAND,
} from "./definitions.ts";

const PROMPT_COLOR = 0xe0a458;

function asGenre(value: unknown): Genre | undefined {
  return typeof value === "string" && (GENRES as readonly string[]).includes(value)
    ? (value as Genre)
    : undefined;
}

function asLength(value: unknown): Length | undefined {
  return typeof value === "string" && (LENGTHS as readonly string[]).includes(value)
    ? (value as Length)
    : undefined;
}

/**
 * Pure and synchronous — no network call, so this answers well inside Discord's
 * 3 second window and needs no deferred response.
 */
export const writingPrompt: Command = {
  name: WRITING_PROMPT_COMMAND.name,
  handler: ({ interaction, env, ctx }) => {
    const genre = asGenre(getOption(interaction, "genre"));
    const length = asLength(getOption(interaction, "length"));
    const wantsConstraint = getOption(interaction, "constraint") === true;
    // Threads are opt-out: absent means yes.
    const wantsThread = getOption(interaction, "thread") !== false;

    const prompt = pickWritingPrompt({ genre, length, constraint: wantsConstraint });

    if (!prompt) {
      // The only unsatisfiable combinations mix poetry with prose lengths.
      return reply(
        `Nothing matches **${genre ? GENRE_LABELS[genre] : "any genre"}** and **${
          length ? LENGTH_LABELS[length] : "any length"
        }** — poems only come from the poetry genre. Try one filter or the other.`,
        { ephemeral: true },
      );
    }

    // Threads only exist in guilds, and this runs after the reply is already
    // out, so a thread failure never blocks or delays the prompt itself.
    if (wantsThread && interaction.guild_id) {
      ctx.waitUntil(
        openThreadForInteraction(env, interaction.token, threadNameFor(prompt.text)),
      );
    }

    const footer: string[] = [GENRE_LABELS[prompt.genre], LENGTH_HINTS[prompt.length]];
    const requester = actorName(interaction);
    if (requester) footer.push(`for ${requester}`);

    return replyWithEmbed({
      title: "✍️ Writing Prompt",
      description: prompt.text,
      color: PROMPT_COLOR,
      ...(prompt.constraint
        ? { fields: [{ name: "Constraint", value: prompt.constraint }] }
        : {}),
      footer: { text: footer.join(" · ") },
    });
  },
};
