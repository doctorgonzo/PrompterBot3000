import challengeData from "../../data/photoshop-challenges.json" with { type: "json" };
import {
  actorName,
  defer,
  editOriginalResponse,
  getOption,
  type Command,
  type Env,
  type Interaction,
} from "../lib/discord.ts";
import { fetchImagePrompt, reportUnsplashUse } from "../lib/images/index.ts";
import { pick } from "../lib/random.ts";
import { openThreadForInteraction, threadNameFor } from "../lib/threads.ts";
import { PHOTOSHOP_COMMAND } from "./definitions.ts";

const PHOTOSHOP_COLOR = 0x5b8fa8;

const challenges = (challengeData as { challenges: string[] }).challenges;

async function deliver(
  env: Env,
  interaction: Interaction,
  options: { sourceId?: string; wantsThread: boolean },
): Promise<void> {
  const image = await fetchImagePrompt(env, Math.random, options.sourceId);

  if (!image) {
    await editOriginalResponse(env, interaction.token, {
      content: options.sourceId
        ? "That collection isn't responding right now — try again, or leave `source` off to use any of them."
        : "Couldn't reach any image source just now. Try again in a moment.",
    });
    return;
  }

  const challenge = pick(challenges, Math.random);
  const requester = actorName(interaction);

  const message = await editOriginalResponse(env, interaction.token, {
    embeds: [
      {
        title: "🖼️ Photoshop Challenge",
        // Attribution sits in the description because footers can't hold links,
        // and some sources require the credit to be linked.
        description: `**${challenge}**\n\n${image.attribution}`,
        color: PHOTOSHOP_COLOR,
        image: { url: image.imageUrl },
        ...(requester ? { footer: { text: `for ${requester}` } } : {}),
      },
    ],
  });

  if (image.usageTrackingUrl) {
    await reportUnsplashUse(env, image.usageTrackingUrl);
  }

  if (options.wantsThread && interaction.guild_id && message) {
    await openThreadForInteraction(
      env,
      interaction.token,
      threadNameFor(image.title, "🖼️ "),
      message,
    );
  }
}

/**
 * Unlike /writingprompt this hits the network, so it defers first and fills in
 * the message afterwards. That also hands back the posted message directly,
 * so the thread needs no lookup.
 */
export const photoshop: Command = {
  name: PHOTOSHOP_COMMAND.name,
  handler: ({ interaction, env, ctx }) => {
    const rawSource = getOption(interaction, "source");
    const sourceId = typeof rawSource === "string" ? rawSource : undefined;
    const wantsThread = getOption(interaction, "thread") !== false;

    ctx.waitUntil(deliver(env, interaction, { sourceId, wantsThread }));
    return defer();
  },
};
