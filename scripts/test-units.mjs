#!/usr/bin/env node
/**
 * Unit tests for prompt selection and thread naming. Runs against the real data
 * files, so a bad edit to data/*.json fails here rather than in the channel.
 *
 *   node scripts/test-units.mjs   (also runs as part of `npm test`)
 */

import { pickWritingPrompt, promptStats } from "../src/lib/prompts.ts";
import { threadNameFor } from "../src/lib/threads.ts";
import { buildWritingPrompt } from "../src/lib/prompt-builders.ts";
import { runPromptClosures } from "../src/lib/closures.ts";
import { weightedOrder } from "../src/lib/random.ts";
import { IMAGE_SOURCES, fetchImagePrompt, selectSources, drawFrom } from "../src/lib/images/index.ts";
import { shortHash } from "../src/lib/store.ts";
import { localTime, shouldPostNow, nextKind, DEFAULT_DAILY_HOUR, runDailyPrompts, resolveDays, describeDays, EVERY_DAY } from "../src/lib/daily.ts";
import { createServer } from "node:http";
import { displayTitle } from "../src/lib/images/types.ts";
import challenges from "../data/photoshop-challenges.json" with { type: "json" };
import { GENRES, LENGTHS, GENRE_LABELS, IMAGE_SOURCE_CHOICES } from "../src/commands/definitions.ts";
import mixer from "../data/prompt-mixer.json" with { type: "json" };

let passed = 0;
let failed = 0;

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Deterministic PRNG so failures are reproducible. */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DRAWS = 300;

console.log(`\nData (${promptStats.curated} curated, ${promptStats.combinations.toLocaleString()} combinations)`);
check("curated pack is non-trivial", promptStats.curated >= 50, `only ${promptStats.curated}`);
check("mixer produces thousands of combinations", promptStats.combinations > 5000);

console.log("\nUnfiltered draws");
{
  const rng = seeded(1);
  const results = Array.from({ length: DRAWS }, () => pickWritingPrompt({}, rng));
  check("never returns null without filters", results.every(Boolean));
  const sources = new Set(results.map((r) => r?.source));
  check("blends curated and generated", sources.has("curated") && sources.has("generated"), [...sources].join(","));
  check("no prompt carries a constraint unless asked", results.every((r) => r?.constraint === undefined));
}

console.log("\nFilter combinations");
{
  let allRespected = true;
  let nullMismatch = "";

  for (const genre of [undefined, ...GENRES]) {
    for (const length of [undefined, ...LENGTHS]) {
      // Poetry is the only genre with poems, and poems are its only length.
      const impossible = genre !== undefined && length !== undefined && (genre === "poetry") !== (length === "poem");

      const rng = seeded(42);
      for (let i = 0; i < DRAWS; i++) {
        const prompt = pickWritingPrompt({ genre, length }, rng);
        const label = `${genre ?? "any"}/${length ?? "any"}`;

        if (impossible) {
          if (prompt !== null) nullMismatch ||= `${label} should be unsatisfiable, got a prompt`;
          continue;
        }
        if (prompt === null) {
          nullMismatch ||= `${label} returned null but should be satisfiable`;
          break;
        }
        if (genre && prompt.genre !== genre) { allRespected = false; nullMismatch ||= `${label} gave genre ${prompt.genre}`; break; }
        if (length && prompt.length !== length) { allRespected = false; nullMismatch ||= `${label} gave length ${prompt.length}`; break; }
      }
    }
  }

  check("every filter combination behaves correctly", nullMismatch === "", nullMismatch);
  check("filters are always respected", allRespected);
}

console.log("\nGenerated prompt quality");
{
  const rng = seeded(7);
  const generated = [];
  while (generated.length < 200) {
    const prompt = pickWritingPrompt({}, rng);
    if (prompt?.source === "generated") generated.push(prompt);
  }

  check("no double spaces", generated.every((p) => !p.text.includes("  ")), generated.find((p) => p.text.includes("  "))?.text);
  check("starts with a capital", generated.every((p) => /^[A-Z]/.test(p.text)));
  check("ends with a period", generated.every((p) => p.text.endsWith(".")));
  check("no empty slots left unfilled", generated.every((p) => !p.text.includes("{")));
  check("never generates poetry", generated.every((p) => p.genre !== "poetry" && p.length !== "poem"));

  const unique = new Set(generated.map((p) => p.text));
  check("draws are varied", unique.size > 190, `${unique.size}/200 unique`);
}

console.log("\nGenre-specific mixer pools");
{
  // The universal character pool is contemporary-realist. Sci-fi and cyberpunk
  // must draw from their own pools or the results are nonsense.
  for (const genre of ["scifi", "cyberpunk"]) {
    const rng = seeded(11);
    const generated = [];
    let guard = 0;
    while (generated.length < 60 && guard++ < 5000) {
      const prompt = pickWritingPrompt({ genre }, rng);
      if (prompt?.source === "generated") generated.push(prompt);
    }

    const characters = mixer.charactersByGenre[genre];
    const settings = mixer.settingsByGenre[genre];

    check(
      `${genre}: every character comes from its own pool`,
      generated.length > 0 && generated.every((p) => characters.some((c) => p.text.startsWith(c))),
      generated.find((p) => !characters.some((c) => p.text.startsWith(c)))?.text,
    );
    check(
      `${genre}: every setting comes from its own pool`,
      generated.every((p) => settings.some((setting) => p.text.includes(setting))),
      generated.find((p) => !settings.some((setting) => p.text.includes(setting)))?.text,
    );
    check(
      `${genre}: no contemporary-realist characters leak in`,
      generated.every((p) => !mixer.characters.some((c) => p.text.startsWith(c))),
    );
  }

  check("every genre has a display label", GENRES.every((g) => typeof GENRE_LABELS[g] === "string"));
  check("every genre has curated prompts", GENRES.every((g) => pickWritingPrompt({ genre: g }, seeded(5)) !== null));
}

console.log("\nThread names");
{
  check("short prompts pass through with a prefix", threadNameFor("A cursed object is trying its best.") === "✍️ A cursed object is trying its best.");

  const long = "A tailor who remembers every client's measurements agrees to judge a competition they do not understand, during the last shift before a long holiday.";
  const name = threadNameFor(long);
  check("long prompts fit Discord's 100 character cap", name.length <= 100, `${name.length} chars`);
  check("long prompts are elided", name.endsWith("…"));
  // The visible body must be a genuine prefix of the original, cut where a word
  // actually ends rather than mid-word.
  const prefixLength = "✍️ ".length;
  const body = name.slice(prefixLength, -1);
  const nextChar = long.charAt(body.length);
  check("elided body is a real prefix of the prompt", long.startsWith(body), body);
  check("elision lands on a word boundary", /[\s,.;:]/.test(nextChar), `cut before ${JSON.stringify(nextChar)}`);

  check("newlines are flattened", !threadNameFor("Line one.\n\nLine two.").includes("\n"));

  // Every prompt in the pack must produce a legal thread name.
  const rng = seeded(77);
  let worst = 0;
  for (let i = 0; i < 500; i++) {
    const prompt = pickWritingPrompt({}, rng);
    worst = Math.max(worst, threadNameFor(prompt.text).length);
  }
  check("no prompt in rotation exceeds the cap", worst <= 100, `longest was ${worst}`);
}

console.log("\nConstraints");
{
  const rng = seeded(3);
  const withConstraint = Array.from({ length: DRAWS }, () => pickWritingPrompt({ constraint: true }, rng));
  check("constraint is always attached when requested", withConstraint.every((p) => typeof p?.constraint === "string" && p.constraint.length > 0));
  check("more than one constraint is in rotation", new Set(withConstraint.map((p) => p?.constraint)).size > 5);
}

console.log("\nDeterminism");
{
  const a = Array.from({ length: 20 }, ((rng) => () => pickWritingPrompt({}, rng))(seeded(99)));
  const b = Array.from({ length: 20 }, ((rng) => () => pickWritingPrompt({}, rng))(seeded(99)));
  check("same seed gives same sequence", JSON.stringify(a) === JSON.stringify(b));
}

console.log("\nImage sources");
{
  const adapterIds = IMAGE_SOURCES.map((source) => source.id).sort();
  const choiceIds = IMAGE_SOURCE_CHOICES.map((choice) => choice.value).sort();
  check("slash choices match the registered adapters", JSON.stringify(adapterIds) === JSON.stringify(choiceIds), `${adapterIds} vs ${choiceIds}`);

  const unsplashWeight = IMAGE_SOURCES.find((s) => s.id === "unsplash").weight;
  const museumWeight = IMAGE_SOURCES.filter((s) => s.id !== "unsplash").reduce((n, s) => n + s.weight, 0);
  check("photography outweighs museums", unsplashWeight > museumWeight, `unsplash ${unsplashWeight} vs museums ${museumWeight}`);
  check("museums are still reachable", museumWeight > 0);

  const unsplash = IMAGE_SOURCES.find((source) => source.id === "unsplash");
  check("Unsplash is off without a key", unsplash.isAvailable({}) === false);
  check("Unsplash switches on with a key", unsplash.isAvailable({ UNSPLASH_ACCESS_KEY: "x" }) === true);
  check("museum sources need no key", IMAGE_SOURCES.filter((s) => s.id !== "unsplash").every((s) => s.isAvailable({})));

  // No network involved: an unknown source narrows the list to nothing.
  const noSources = await fetchImagePrompt({}, seeded(1), { forcedSourceId: "definitely-not-a-source" });
  check("an unknown forced source yields null", noSources === null);
}

console.log("\nSource selection");
{
  const env = { UNSPLASH_ACCESS_KEY: "key" };
  const ids = (list) => list.map((s) => s.id).sort().join(",");

  check("all sources when nothing is restricted", selectSources(IMAGE_SOURCES, env).length === 3);
  check("unavailable sources are dropped", ids(selectSources(IMAGE_SOURCES, {})) === "artic,met");
  check("a forced source wins", ids(selectSources(IMAGE_SOURCES, env, { forcedSourceId: "met" })) === "met");
  check("disabled sources are removed", ids(selectSources(IMAGE_SOURCES, env, { disabledSourceIds: ["met"] })) === "artic,unsplash");
  check("a forced source ignores the blocklist",
    ids(selectSources(IMAGE_SOURCES, env, { forcedSourceId: "met", disabledSourceIds: ["met"] })) === "met",
    "an explicit request should beat the guild default");
  // Otherwise a moderator could accidentally silence the command entirely.
  check("disabling everything falls back to all sources",
    selectSources(IMAGE_SOURCES, env, { disabledSourceIds: ["met", "artic", "unsplash"] }).length === 3);
}

console.log("\nRepeat suppression");
{
  const stub = (id, results) => {
    let call = 0;
    return { id, label: id, weight: 10, isAvailable: () => true, fetch: async () => results[call++] ?? null };
  };
  const image = (key) => ({ imageUrl: "u", title: "t", attribution: "a", sourceId: "s", sourceLabel: "s", dedupeKey: key });
  const seen = (...keys) => async (key) => keys.includes(key);

  let got = await drawFrom([stub("a", [image("fresh")])], {}, seeded(1), { isRepeat: seen("old") });
  check("a fresh draw is returned", got?.dedupeKey === "fresh");

  got = await drawFrom([stub("a", [image("old"), image("old2"), image("fresh")])], {}, seeded(1), { isRepeat: seen("old", "old2") });
  check("repeats are redrawn past", got?.dedupeKey === "fresh");

  got = await drawFrom([stub("a", [image("old"), image("old"), image("old")])], {}, seeded(1), { isRepeat: seen("old") });
  check("a repeat beats posting nothing", got?.dedupeKey === "old", "should fall back rather than return null");

  got = await drawFrom([stub("a", [null]), stub("b", [image("fresh")])], {}, seeded(1), {});
  check("a failing source falls through to the next", got?.dedupeKey === "fresh");

  got = await drawFrom([stub("a", [null]), stub("b", [null])], {}, seeded(1), {});
  check("all sources failing yields null", got === null);

  got = await drawFrom([], {}, seeded(1), {});
  check("an empty source list yields null", got === null);

  let calls = 0;
  const counting = { id: "c", label: "c", weight: 1, isAvailable: () => true,
    fetch: async () => { calls++; return image("old"); } };
  await drawFrom([counting], {}, seeded(1), { isRepeat: seen("old"), repeatAttempts: 2 });
  check("redraws are bounded", calls === 2, `made ${calls} attempts`);
}

console.log("\nKey hashing");
{
  check("hashing is stable", shortHash("A cursed object.") === shortHash("A cursed object."));
  check("different text hashes differently", shortHash("one") !== shortHash("two"));
  check("hashes are short and key-safe", /^[a-z0-9]{1,8}$/.test(shortHash("Some prompt text here.")), shortHash("Some prompt text here."));

  // Repeated draws produce repeated text, so compare distinct texts against
  // distinct hashes — equal counts means no two prompts share a key.
  const texts = new Set();
  const hashes = new Set();
  const rng = seeded(21);
  for (let i = 0; i < 2000; i++) {
    const text = pickWritingPrompt({}, rng).text;
    texts.add(text);
    hashes.add(shortHash(text));
  }
  check("no collisions across the prompt pool", hashes.size === texts.size, `${texts.size} texts -> ${hashes.size} hashes`);
}

console.log("\nSubmission deadlines");
{
  const withDeadline = await buildWritingPrompt({}, { closesInHours: 24 });
  const field = withDeadline.payload.embeds[0].fields?.find((f) => /close/i.test(f.name));

  check("a deadline is attached", typeof withDeadline.closesAt === "number");
  check("the deadline is roughly right",
    Math.abs(withDeadline.closesAt - (Math.floor(Date.now() / 1000) + 24 * 3600)) < 60,
    String(withDeadline.closesAt));
  check("the embed shows it", Boolean(field), JSON.stringify(withDeadline.payload.embeds[0].fields));
  // Discord renders <t:...> in each reader's own timezone.
  check("it uses Discord timestamp markup", /<t:\d+:[FR]>/.test(field?.value ?? ""), field?.value);
  check("the deadline survives into reroll options", withDeadline.options.closes === 24);

  const noDeadline = await buildWritingPrompt({}, {});
  check("no deadline by default", noDeadline.closesAt === undefined);
  check("no deadline field by default",
    !(noDeadline.payload.embeds[0].fields ?? []).some((f) => /close/i.test(f.name)));

  const zero = await buildWritingPrompt({}, { closesInHours: 0 });
  check("zero hours means no deadline", zero.closesAt === undefined);

  // A constraint and a deadline must coexist rather than overwrite each other.
  const both = await buildWritingPrompt({ constraint: true }, { closesInHours: 48 });
  const names = (both.payload.embeds[0].fields ?? []).map((f) => f.name);
  check("constraint and deadline coexist",
    names.some((n) => /constraint/i.test(n)) && names.some((n) => /close/i.test(n)),
    names.join(", "));
}

console.log("\nClosing submission threads");
{
  const fakeKv = () => {
    const map = new Map();
    return {
      map,
      async get(key, type) { const raw = map.get(key); return raw === undefined ? null : (type === "json" ? JSON.parse(raw) : raw); },
      async put(key, value) { map.set(key, value); },
      async delete(key) { map.delete(key); },
      async list({ prefix = "" } = {}) { return { keys: [...map.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
    };
  };

  const calls = [];
  let postOk = true;
  let lockOk = true;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push({ method: req.method, url: req.url, body });
      const failing = (req.method === "POST" && !postOk) || (req.method === "PATCH" && !lockOk);
      res.writeHead(failing ? 403 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify(failing ? { message: "Missing Permissions" } : { id: "t1" }));
    });
  });
  const port = 8791;
  await new Promise((resolve) => server.listen(port, resolve));
  const makeEnv = (kv) => ({ DISCORD_API_BASE: `http://localhost:${port}`, DISCORD_APPLICATION_ID: "a", DISCORD_BOT_TOKEN: "t", PROMPT_STATE: kv });

  const now = Math.floor(Date.UTC(2026, 6, 1, 15) / 1000);
  const at = new Date(now * 1000);

  let kv = fakeKv();
  kv.map.set("close:thread-1", JSON.stringify({ threadId: "thread-1", closesAt: now - 60 }));
  calls.length = 0;
  let closed = await runPromptClosures(makeEnv(kv), at);

  check("a due thread is closed", closed === 1, `closed ${closed}`);
  check("a closing notice is posted", calls.some((c) => c.method === "POST" && c.url === "/channels/thread-1/messages"));
  check("the notice says submissions are closed", /closed/i.test(calls.find((c) => c.method === "POST")?.body ?? ""));
  const lock = calls.find((c) => c.method === "PATCH");
  check("the thread is locked and archived",
    JSON.parse(lock?.body ?? "{}").locked === true && JSON.parse(lock?.body ?? "{}").archived === true, lock?.body);
  check("the record is cleared", kv.map.size === 0);
  // Notice before lock: you cannot post into an archived thread.
  check("the notice precedes the lock",
    calls.findIndex((c) => c.method === "POST") < calls.findIndex((c) => c.method === "PATCH"));

  kv = fakeKv();
  kv.map.set("close:thread-2", JSON.stringify({ threadId: "thread-2", closesAt: now + 3600 }));
  calls.length = 0;
  closed = await runPromptClosures(makeEnv(kv), at);
  check("a future deadline is left alone", closed === 0 && calls.length === 0);
  check("its record is kept", kv.map.size === 1);

  // Without Manage Threads the notice still lands; only the lock fails.
  kv = fakeKv();
  kv.map.set("close:thread-3", JSON.stringify({ threadId: "thread-3", closesAt: now - 60 }));
  calls.length = 0;
  lockOk = false;
  closed = await runPromptClosures(makeEnv(kv), at);
  check("a failed lock still counts as closed", closed === 1, "the deadline was still announced");
  check("the notice was posted anyway", calls.some((c) => c.method === "POST"));
  lockOk = true;

  // A deleted thread (e.g. rerolled) must not be retried forever.
  kv = fakeKv();
  kv.map.set("close:gone", JSON.stringify({ threadId: "gone", closesAt: now - 60 }));
  postOk = false;
  closed = await runPromptClosures(makeEnv(kv), at);
  check("a vanished thread is not counted", closed === 0);
  check("a vanished thread is cleared, not retried forever", kv.map.size === 0);
  postOk = true;

  server.close();
}

console.log("\nDaily scheduling: local time");
{
  const at = (iso) => localTime(new Date(iso));

  check("summer resolves to CDT", at("2026-07-01T15:00:00Z").hour === 10, JSON.stringify(at("2026-07-01T15:00:00Z")));
  check("winter resolves to CST", at("2026-01-15T15:00:00Z").hour === 9, JSON.stringify(at("2026-01-15T15:00:00Z")));
  // The whole reason for scheduling on local hour: a fixed UTC cron would
  // drift by an hour between these two dates.
  check("the same UTC hour differs across DST",
    at("2026-07-01T15:00:00Z").hour !== at("2026-01-15T15:00:00Z").hour);

  check("midnight is hour 0, never 24", at("2026-07-01T05:00:00Z").hour === 0);
  check("the date rolls with local time, not UTC", at("2026-07-01T04:59:00Z").date === "2026-06-30");
  check("dates are ISO formatted", /^\d{4}-\d{2}-\d{2}$/.test(at("2026-01-15T15:00:00Z").date));
}

console.log("\nDaily scheduling: when to post");
{
  const config = (over = {}) => ({ guildId: "g", channelId: "c", kind: "writing", hour: 10, ...over });

  check("not yet due", shouldPostNow(config(), { date: "2026-07-01", hour: 9, weekday: 3 }) === false);
  check("due on the hour", shouldPostNow(config(), { date: "2026-07-01", hour: 10, weekday: 3 }) === true);
  // Catch-up: a missed or failed run still posts later the same day.
  check("a missed hour catches up later", shouldPostNow(config(), { date: "2026-07-01", hour: 14, weekday: 3 }) === true);
  check("already posted today stays quiet",
    shouldPostNow(config({ lastPostedDate: "2026-07-01" }), { date: "2026-07-01", hour: 14, weekday: 3 }) === false);
  check("yesterday's post does not block today",
    shouldPostNow(config({ lastPostedDate: "2026-06-30" }), { date: "2026-07-01", hour: 10, weekday: 3 }) === true);
  // 2am does not exist on spring-forward day; >= is what saves an hour:2 server.
  check("a nonexistent DST hour still posts",
    shouldPostNow(config({ hour: 2 }), localTime(new Date("2026-03-08T08:00:00Z"))) === true);

  check("the default hour is reasonable", DEFAULT_DAILY_HOUR >= 6 && DEFAULT_DAILY_HOUR <= 20);
}

console.log("\nDaily scheduling: cadence");
{
  check("weekday is reported", localTime(new Date("2026-07-01T15:00:00Z")).weekday === 3, "2026-07-01 is a Wednesday");
  check("Sunday is 0", localTime(new Date("2026-07-05T15:00:00Z")).weekday === 0);

  check("every day covers the week", resolveDays("daily").length === 7);
  check("weekdays excludes the weekend", resolveDays("weekdays").join(",") === "1,2,3,4,5");
  check("weekends are Saturday and Sunday", resolveDays("weekends").sort().join(",") === "0,6");
  check("a single weekday resolves alone", resolveDays("monday").join(",") === "1");
  check("an unknown value falls back to every day", resolveDays("nonsense").length === 7);

  check("cadence reads naturally",
    describeDays(EVERY_DAY) === "every day" &&
    describeDays([1, 2, 3, 4, 5]) === "every weekday" &&
    describeDays([1]) === "every Monday",
    [describeDays(EVERY_DAY), describeDays([1,2,3,4,5]), describeDays([1])].join(" | "));
  check("an absent cadence describes as every day", describeDays(undefined) === "every day");

  const weekly = { guildId: "g", channelId: "c", kind: "writing", hour: 10, days: [1] };
  const wednesday = localTime(new Date("2026-07-01T15:00:00Z"));
  const monday = localTime(new Date("2026-07-06T15:00:00Z"));

  check("a weekly schedule skips other days", shouldPostNow(weekly, wednesday) === false);
  check("a weekly schedule posts on its day", shouldPostNow(weekly, monday) === true);

  // Schedules saved before cadence existed must keep working.
  const legacy = { guildId: "g", channelId: "c", kind: "writing", hour: 10 };
  check("a schedule with no cadence posts daily",
    shouldPostNow(legacy, wednesday) === true && shouldPostNow(legacy, monday) === true);
}

console.log("\nDaily scheduling: kind rotation");
{
  check("a fixed kind is returned as-is", nextKind({ kind: "writing" }) === "writing" && nextKind({ kind: "photoshop" }) === "photoshop");
  check("alternate follows writing with photoshop", nextKind({ kind: "alternate", lastKind: "writing" }) === "photoshop");
  check("alternate follows photoshop with writing", nextKind({ kind: "alternate", lastKind: "photoshop" }) === "writing");
  check("alternate starts with writing", nextKind({ kind: "alternate" }) === "writing");

  // Rotation must not stall on either kind.
  let state = { kind: "alternate" };
  const seen = [];
  for (let i = 0; i < 6; i++) {
    const kind = nextKind(state);
    seen.push(kind);
    state = { kind: "alternate", lastKind: kind };
  }
  check("rotation alternates indefinitely", seen.join(",") === "writing,photoshop,writing,photoshop,writing,photoshop", seen.join(","));
}

console.log("\nDaily scheduling: posting");
{
  /** Minimal in-memory stand-in for Workers KV. */
  const fakeKv = () => {
    const map = new Map();
    return {
      map,
      async get(key, type) {
        const raw = map.get(key);
        if (raw === undefined) return null;
        return type === "json" ? JSON.parse(raw) : raw;
      },
      async put(key, value) { map.set(key, value); },
      async delete(key) { map.delete(key); },
      async list({ prefix = "" } = {}) {
        return { keys: [...map.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
      },
    };
  };

  const requests = [];
  let postStatus = 200;
  const discord = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body });
      if (req.url.endsWith("/messages") && postStatus !== 200) {
        res.writeHead(postStatus, { "content-type": "application/json" });
        return res.end(JSON.stringify({ message: "nope" }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "daily-msg", channel_id: "daily-chan" }));
    });
  });
  const port = 8790;
  await new Promise((resolve) => discord.listen(port, resolve));

  const makeEnv = (kv) => ({
    DISCORD_API_BASE: `http://localhost:${port}`,
    DISCORD_APPLICATION_ID: "app",
    DISCORD_BOT_TOKEN: "token",
    PROMPT_STATE: kv,
  });

  // 15:00 UTC on a summer day is 10:00 in Madison.
  const dueAt = new Date("2026-07-01T15:00:00Z");
  const config = (over = {}) => JSON.stringify({ guildId: "g1", channelId: "daily-chan", kind: "writing", hour: 10, ...over });

  let kv = fakeKv();
  kv.map.set("daily:g1", config());
  requests.length = 0;
  let posted = await runDailyPrompts(makeEnv(kv), dueAt);

  check("a due server gets a post", posted === 1, `posted ${posted}`);
  const sent = requests.find((r) => r.method === "POST" && r.url === "/channels/daily-chan/messages");
  check("it posts to the configured channel", Boolean(sent), requests.map((r) => `${r.method} ${r.url}`).join(" | "));
  check("the post carries a prompt embed", Boolean(JSON.parse(sent?.body ?? "{}").embeds?.[0]?.description));
  check("a thread is opened on it", requests.some((r) => r.url.endsWith("/threads")));
  check("the day is recorded", JSON.parse(kv.map.get("daily:g1")).lastPostedDate === "2026-07-01");
  check("the prompt is remembered for /reroll", Boolean(kv.map.get("last:daily-chan")));

  // Running again the same day must not double-post.
  requests.length = 0;
  posted = await runDailyPrompts(makeEnv(kv), new Date("2026-07-01T18:00:00Z"));
  check("a second run the same day posts nothing", posted === 0 && requests.length === 0, `posted ${posted}`);

  // The next day it posts again.
  posted = await runDailyPrompts(makeEnv(kv), new Date("2026-07-02T15:00:00Z"));
  check("the next day posts again", posted === 1);

  // Not yet due.
  kv = fakeKv();
  kv.map.set("daily:g1", config({ hour: 20 }));
  requests.length = 0;
  posted = await runDailyPrompts(makeEnv(kv), dueAt);
  check("a server whose hour has not arrived stays quiet", posted === 0 && requests.length === 0);

  // A failed post must not consume the day.
  kv = fakeKv();
  kv.map.set("daily:g1", config());
  postStatus = 500;
  posted = await runDailyPrompts(makeEnv(kv), dueAt);
  check("a failed post reports nothing posted", posted === 0);
  check("a failed post does not consume the day",
    JSON.parse(kv.map.get("daily:g1")).lastPostedDate === undefined,
    "otherwise an outage silently skips a whole day");
  postStatus = 200;

  // Alternate rotation persists across days.
  kv = fakeKv();
  kv.map.set("daily:g1", config({ kind: "alternate" }));
  await runDailyPrompts(makeEnv(kv), dueAt);
  const firstKind = JSON.parse(kv.map.get("daily:g1")).lastKind;
  await runDailyPrompts(makeEnv(kv), new Date("2026-07-02T15:00:00Z"));
  const secondKind = JSON.parse(kv.map.get("daily:g1")).lastKind;
  check("alternate rotation is persisted", firstKind === "writing" && secondKind === "photoshop", `${firstKind} then ${secondKind}`);

  // A weekly server must not post on the wrong day.
  kv = fakeKv();
  kv.map.set("daily:g1", config({ days: [1] }));
  requests.length = 0;
  posted = await runDailyPrompts(makeEnv(kv), dueAt); // a Wednesday
  check("a weekly schedule stays quiet off-day", posted === 0 && requests.length === 0);
  posted = await runDailyPrompts(makeEnv(kv), new Date("2026-07-06T15:00:00Z")); // a Monday
  check("a weekly schedule posts on its day", posted === 1);

  // One broken server must not stop the others.
  kv = fakeKv();
  kv.map.set("daily:g1", config());
  kv.map.set("daily:g2", JSON.stringify({ guildId: "g2", channelId: "other-chan", kind: "writing", hour: 10 }));
  posted = await runDailyPrompts(makeEnv(kv), dueAt);
  check("every due server is served", posted === 2, `posted ${posted}`);

  discord.close();
}

console.log("\nTitle normalisation");
{
  const long = "A Short History of General John Cabell Breckinridge, from the Histories of Generals series of booklets (N78) for Duke brand cigarettes";
  const trimmed = displayTitle(long);
  check("long museum titles are trimmed", trimmed.length <= 110 && trimmed.endsWith("…"), `${trimmed.length} chars`);
  check("trimming keeps a real prefix", long.startsWith(trimmed.slice(0, -1)));
  check("short titles pass through untouched", displayTitle("Soap Bubbles") === "Soap Bubbles");
  check("missing titles become Untitled", displayTitle("") === "Untitled" && displayTitle(null) === "Untitled" && displayTitle(undefined) === "Untitled");
  check("whitespace is flattened", displayTitle("Two   Women\non the Shore") === "Two Women on the Shore");
  check("trimmed titles still fit a thread name", threadNameFor(displayTitle(long)).length <= 100);
}

console.log("\nWeighted ordering");
{
  const items = [{ id: "a", weight: 70 }, { id: "b", weight: 20 }, { id: "c", weight: 10 }];

  const rng = seeded(4);
  const orders = Array.from({ length: 600 }, () => weightedOrder(items, rng));
  check("every source appears exactly once", orders.every((o) => o.length === 3 && new Set(o.map((i) => i.id)).size === 3));

  const firstCounts = {};
  for (const order of orders) firstCounts[order[0].id] = (firstCounts[order[0].id] ?? 0) + 1;
  check("heavier weights are tried first more often",
    firstCounts.a > firstCounts.b && firstCounts.b > firstCounts.c,
    JSON.stringify(firstCounts));
  check("the lightest source is still reachable", firstCounts.c > 0);

  const x = weightedOrder(items, seeded(12));
  const y = weightedOrder(items, seeded(12));
  check("ordering is deterministic under a seed", JSON.stringify(x) === JSON.stringify(y));
}

console.log("\nPhotoshop challenges");
{
  const list = challenges.challenges;
  check("challenge pack is non-trivial", list.length >= 20, `${list.length}`);
  check("every challenge is a complete sentence", list.every((c) => /^[A-Z]/.test(c) && /[.!?]$/.test(c)));
  check("challenges fit an embed heading", list.every((c) => c.length < 120));
  check("no duplicate challenges", new Set(list).size === list.length);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
