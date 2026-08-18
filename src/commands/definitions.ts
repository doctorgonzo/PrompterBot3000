/**
 * Slash command definitions, kept free of any Workers-specific imports so the
 * registration script (plain Node) can import this file directly.
 *
 * After changing anything here, re-run: npm run register
 */

export const CHAT_INPUT = 1;
const STRING_OPTION = 3;
const INTEGER_OPTION = 4;
const BOOLEAN_OPTION = 5;
const CHANNEL_OPTION = 7;
const GUILD_TEXT_CHANNEL = 0;

/** Single source of truth: prompt filtering and the slash choices both use these. */
export const GENRES = [
  "literary",
  "speculative",
  "scifi",
  "cyberpunk",
  "horror",
  "mystery",
  "humor",
  "poetry",
] as const;

export const LENGTHS = ["flash", "scene", "poem"] as const;

/** Display names — several genres don't title-case correctly on their own. */
export const GENRE_LABELS = {
  literary: "Literary",
  speculative: "Speculative",
  scifi: "Sci-fi",
  cyberpunk: "Cyberpunk",
  horror: "Horror",
  mystery: "Mystery",
  humor: "Humor",
  poetry: "Poetry",
} as const;

export const LENGTH_LABELS = {
  flash: "Flash fiction",
  scene: "A scene",
  poem: "A poem",
} as const;

/** Shown in the embed footer, where the extra detail is useful. */
export const LENGTH_HINTS = {
  flash: "flash fiction, under 500 words",
  scene: "a scene",
  poem: "a poem",
} as const;

export const PING_COMMAND = {
  name: "ping",
  description: "Check that AutoPrompter is awake",
  type: CHAT_INPUT,
};

export const WRITING_PROMPT_COMMAND = {
  name: "writingprompt",
  description: "Get a writing prompt for the channel",
  type: CHAT_INPUT,
  options: [
    {
      name: "genre",
      description: "Narrow it to one genre",
      type: STRING_OPTION,
      required: false,
      choices: GENRES.map((genre) => ({ name: GENRE_LABELS[genre], value: genre })),
    },
    {
      name: "length",
      description: "How long a piece to aim for",
      type: STRING_OPTION,
      required: false,
      choices: LENGTHS.map((length) => ({ name: LENGTH_LABELS[length], value: length })),
    },
    {
      name: "constraint",
      description: "Add a formal constraint to make it harder",
      type: BOOLEAN_OPTION,
      required: false,
    },
    {
      name: "thread",
      description: "Open a thread for responses (default: yes)",
      type: BOOLEAN_OPTION,
      required: false,
    },
  ],
};

/** Must stay in sync with the adapters in src/lib/images — a test enforces it. */
export const IMAGE_SOURCE_CHOICES = [
  { name: "The Met", value: "met" },
  { name: "Art Institute of Chicago", value: "artic" },
  { name: "Unsplash", value: "unsplash" },
];

export const PHOTOSHOP_COMMAND = {
  name: "photoshop",
  description: "Post an image as a Photoshop challenge",
  type: CHAT_INPUT,
  options: [
    {
      name: "source",
      description: "Pull from one specific collection",
      type: STRING_OPTION,
      required: false,
      choices: IMAGE_SOURCE_CHOICES,
    },
    {
      name: "thread",
      description: "Open a thread for submissions (default: yes)",
      type: BOOLEAN_OPTION,
      required: false,
    },
  ],
};

/** Discord permission bitfields, as strings — the API expects them that way. */
const MANAGE_GUILD = "32";
const MANAGE_MESSAGES = "8192";

export const PROMPT_CONFIG_COMMAND = {
  name: "promptconfig",
  description: "View or change which image sources this server uses",
  type: CHAT_INPUT,
  // Hidden from regular members; admins can override under Integrations.
  default_member_permissions: MANAGE_GUILD,
  options: [
    {
      name: "source",
      description: "Which source to change (omit to just view the current settings)",
      type: STRING_OPTION,
      required: false,
      choices: IMAGE_SOURCE_CHOICES,
    },
    {
      name: "enabled",
      description: "Turn the chosen source on or off",
      type: BOOLEAN_OPTION,
      required: false,
    },
  ],
};

export const DAILY_KIND_CHOICES = [
  { name: "Writing prompts", value: "writing" },
  { name: "Photoshop challenges", value: "photoshop" },
  { name: "Alternate between both", value: "alternate" },
  { name: "Off", value: "off" },
];

export const DAILY_COMMAND = {
  name: "daily",
  description: "Schedule a daily prompt for this server",
  type: CHAT_INPUT,
  default_member_permissions: MANAGE_GUILD,
  options: [
    {
      name: "kind",
      description: "What to post each day, or Off to stop",
      type: STRING_OPTION,
      required: false,
      choices: DAILY_KIND_CHOICES,
    },
    {
      name: "channel",
      description: "Which channel to post in",
      type: CHANNEL_OPTION,
      required: false,
      channel_types: [GUILD_TEXT_CHANNEL],
    },
    {
      name: "hour",
      description: "Hour of day in Madison time, 0-23 (default 10)",
      type: INTEGER_OPTION,
      required: false,
      min_value: 0,
      max_value: 23,
    },
  ],
};

export const REROLL_COMMAND = {
  name: "reroll",
  description: "Replace the most recent prompt in this channel with a new one",
  type: CHAT_INPUT,
  default_member_permissions: MANAGE_MESSAGES,
};

export const COMMAND_DEFINITIONS = [
  PING_COMMAND,
  WRITING_PROMPT_COMMAND,
  PHOTOSHOP_COMMAND,
  PROMPT_CONFIG_COMMAND,
  DAILY_COMMAND,
  REROLL_COMMAND,
];
