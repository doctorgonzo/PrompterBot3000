import type { Command } from "../lib/discord.ts";
import { photoshop } from "./photoshop.ts";
import { ping } from "./ping.ts";
import { writingPrompt } from "./writingprompt.ts";

const ALL: Command[] = [ping, writingPrompt, photoshop];

export const commands = new Map<string, Command>(ALL.map((command) => [command.name, command]));
