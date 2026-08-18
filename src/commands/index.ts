import type { Command } from "../lib/discord.ts";
import { daily } from "./daily.ts";
import { photoshop } from "./photoshop.ts";
import { ping } from "./ping.ts";
import { promptConfig } from "./promptconfig.ts";
import { reroll } from "./reroll.ts";
import { writingPrompt } from "./writingprompt.ts";

const ALL: Command[] = [ping, writingPrompt, photoshop, promptConfig, daily, reroll];

export const commands = new Map<string, Command>(ALL.map((command) => [command.name, command]));
