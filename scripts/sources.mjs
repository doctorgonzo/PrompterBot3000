#!/usr/bin/env node
/**
 * Draws live samples from each image source, to eyeball what the bot would post.
 *
 *   npm run sources
 *
 * Reads UNSPLASH_ACCESS_KEY from .dev.vars if present; the museum sources need
 * no credentials. Also verifies each image URL actually loads.
 */

import { loadDevVars } from "./load-env.mjs";
import { IMAGE_SOURCES } from "../src/lib/images/index.ts";

loadDevVars();

const env = { UNSPLASH_ACCESS_KEY: process.env.UNSPLASH_ACCESS_KEY };
const DRAWS = Number(process.env.DRAWS ?? 3);

// Discord fetches embed images with its own user agent; some hosts reject
// Node's default, so mimic a real client when checking reachability.
const UA = { "user-agent": "Discordbot/2.0 (+https://discordapp.com)" };

for (const source of IMAGE_SOURCES) {
  if (!source.isAvailable(env)) {
    console.log(`\n[${source.label}] skipped — no API key configured\n`);
    continue;
  }

  console.log(`\n[${source.label}] weight ${source.weight}`);

  for (let i = 0; i < DRAWS; i++) {
    const result = await source.fetch(env, Math.random);
    if (!result) {
      console.log("  (no result)");
      continue;
    }

    let status = "unchecked";
    try {
      const response = await fetch(result.imageUrl, { headers: UA });
      const bytes = (await response.arrayBuffer()).byteLength;
      status = `${response.status}, ${Math.round(bytes / 1024)} KB`;
    } catch (error) {
      status = `unreachable (${error.message})`;
    }

    console.log(`  ${result.title}`);
    console.log(`    image: ${status}`);
    console.log(`    credit: ${result.attribution}`);
  }
}
console.log();
