#!/usr/bin/env node
/**
 * End-to-end test against a real `wrangler dev` worker.
 *
 *   npm test
 *
 * Generates a throwaway Ed25519 keypair, boots the worker with it as the
 * public key, then signs requests exactly the way Discord does. This is the only
 * way to be sure signature verification actually works in workerd — a bug here
 * means Discord disables the endpoint, so it is worth testing for real.
 *
 * No credentials needed; nothing here touches your Discord app.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";

const PORT = Number(process.env.SMOKE_PORT ?? 8788);
const MOCK_PORT = PORT + 1;
const BASE = `http://localhost:${PORT}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stand-in for discord.com. The Worker is pointed here via DISCORD_API_BASE so
 * the thread flow (look up our own message, then open a thread on it) is
 * exercised for real without touching Discord.
 */
const mock = { requests: [], originalNotFoundTimes: 0, threadStatus: 200, failSources: [] };

function resetMock(overrides = {}) {
  mock.requests = [];
  mock.originalNotFoundTimes = 0;
  mock.threadStatus = 200;
  mock.failSources = [];
  Object.assign(mock, overrides);
}

const MOCK_IMAGE = "https://images.example.test/mock.jpg";
const MOCK_IMAGE_SMALL = "https://images.example.test/mock-small.jpg";

/** Canned upstream responses for the three image sources. */
function imageSourceResponse(url) {
  if (url.startsWith("/met/search")) return { objectIDs: [101, 102, 103] };
  if (url.startsWith("/met/objects/")) {
    return {
      isPublicDomain: true,
      primaryImageSmall: MOCK_IMAGE_SMALL,
      primaryImage: MOCK_IMAGE,
      title: "Mock Object",
      artistDisplayName: "A Painter",
      objectDate: "1850",
      objectURL: "https://www.metmuseum.org/art/collection/search/101",
    };
  }
  if (url.startsWith("/aic/artworks/search")) {
    return {
      data: [{ id: 55, title: "Mock Artwork", artist_display: "An Artist\nAmerican, born 1900", date_display: "1901", image_id: "img-abc" }],
      config: { iiif_url: "https://iiif.example.test" },
    };
  }
  if (url.startsWith("/unsplash/photos/random")) {
    return {
      urls: { regular: MOCK_IMAGE, full: MOCK_IMAGE },
      links: { html: "https://unsplash.com/photos/1", download_location: `http://localhost:${MOCK_PORT}/unsplash/track` },
      user: { name: "A Photographer", links: { html: "https://unsplash.com/@someone" } },
      description: "A mock photo",
      alt_description: null,
    };
  }
  return null;
}

const sourceIdFor = (url) => (url.startsWith("/met") ? "met" : url.startsWith("/aic") ? "artic" : url.startsWith("/unsplash") ? "unsplash" : null);

const discordMock = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    mock.requests.push({ method: req.method, url: req.url, body });

    const json = (status, payload) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (req.method === "GET" && req.url.endsWith("/messages/@original")) {
      if (mock.originalNotFoundTimes > 0) {
        mock.originalNotFoundTimes--;
        return json(404, { message: "Unknown Message", code: 10008 });
      }
      return json(200, { id: "msg-1", channel_id: "chan-1" });
    }

    const sourceId = sourceIdFor(req.url);
    if (sourceId) {
      if (mock.failSources.includes(sourceId)) return json(500, { error: "source down" });
      if (req.url.startsWith("/unsplash/track")) return json(200, {});
      const payload = imageSourceResponse(req.url);
      return payload ? json(200, payload) : json(404, {});
    }

    if (req.method === "PATCH" && req.url.endsWith("/messages/@original")) {
      return json(200, { id: "msg-1", channel_id: "chan-1" });
    }

    if (req.method === "POST" && req.url.endsWith("/threads")) {
      if (mock.threadStatus !== 200) {
        return json(mock.threadStatus, { message: "Missing Permissions", code: 50013 });
      }
      return json(200, { id: "thread-1" });
    }

    return json(200, {});
  });
});

/**
 * Waits until the mock stops receiving requests.
 *
 * Background work (thread creation, usage pings) can still be in flight when a
 * test finishes. Without draining it first, the next test's freshly reset log
 * picks up the previous test's requests and fails intermittently.
 */
async function settle(quietMs = 500, maxMs = 8000) {
  const deadline = Date.now() + maxMs;
  let seen = mock.requests.length;
  let quietSince = Date.now();

  while (Date.now() < deadline) {
    await sleep(100);
    if (mock.requests.length !== seen) {
      seen = mock.requests.length;
      quietSince = Date.now();
    } else if (Date.now() - quietSince >= quietMs) {
      return;
    }
  }
}

async function waitForRequest(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = mock.requests.find(predicate);
    if (found) return found;
    await sleep(100);
  }
  return null;
}

const isThreadCall = (r) => r.method === "POST" && r.url.endsWith("/threads");
const isFollowUp = (r) => r.method === "POST" && r.url.startsWith("/webhooks/") && !r.url.endsWith("/threads");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicHex = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString("hex");

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

async function post(payload, { corrupt = false, omitHeaders = false, sendInstead = null } = {}) {
  const signed = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));

  let signature = sign(null, Buffer.from(timestamp + signed), privateKey).toString("hex");
  if (corrupt) signature = (signature[0] === "a" ? "b" : "a") + signature.slice(1);

  const headers = { "content-type": "application/json" };
  if (!omitHeaders) {
    headers["x-signature-ed25519"] = signature;
    headers["x-signature-timestamp"] = timestamp;
  }

  // sendInstead lets us sign one body and transmit a different one.
  const wire = sendInstead === null ? signed : JSON.stringify(sendInstead);
  const response = await fetch(`${BASE}/interactions`, { method: "POST", headers, body: wire });
  const text = await response.text();

  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Non-JSON responses (errors) are fine; callers assert on status.
  }
  return { status: response.status, text, json };
}

const PING = { id: "1", type: 1, token: "token", application_id: "000" };

const STRING_OPTION = 3;
const BOOLEAN_OPTION = 5;

const slashCommand = (name, options = [], overrides = {}) => ({
  id: "1",
  type: 2,
  token: "token",
  application_id: "000",
  guild_id: "guild",
  channel_id: "channel",
  data: { id: "d", name, ...(options.length > 0 ? { options } : {}) },
  member: { user: { id: "u1", username: "tester" } },
  ...overrides,
});

const stringOption = (name, value) => ({ name, type: STRING_OPTION, value });
const intOption = (name, value) => ({ name, type: 4, value });
const channelOption = (name, value) => ({ name, type: 7, value });
const boolOption = (name, value) => ({ name, type: BOOLEAN_OPTION, value });

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function runTests() {
  console.log("\nSignature verification");
  let result = await post(PING);
  check("valid PING returns PONG", result.status === 200 && result.json?.type === 1, `HTTP ${result.status} ${result.text}`);

  result = await post(PING, { corrupt: true });
  check("tampered signature is rejected", result.status === 401, `HTTP ${result.status}`);

  result = await post(PING, { omitHeaders: true });
  check("missing signature headers rejected", result.status === 401, `HTTP ${result.status}`);

  result = await post(PING, { sendInstead: { ...PING, extra: "swapped-after-signing" } });
  check("body swapped after signing is rejected", result.status === 401, `HTTP ${result.status}`);

  console.log("\nCommand routing");
  result = await post(slashCommand("ping"));
  check(
    "/ping replies ephemerally",
    result.status === 200 && result.json?.type === 4 && result.json?.data?.flags === 64,
    `HTTP ${result.status} ${result.text}`,
  );

  result = await post(slashCommand("definitely-not-registered"));
  check(
    "unknown command fails gracefully",
    result.status === 200 && result.json?.data?.flags === 64,
    `HTTP ${result.status} ${result.text}`,
  );

  console.log("\nWriting prompts");
  result = await post(slashCommand("writingprompt"));
  const embed = result.json?.data?.embeds?.[0];
  check(
    "/writingprompt returns a public embed",
    result.status === 200 && embed?.description?.length > 0 && result.json?.data?.flags === undefined,
    `HTTP ${result.status} ${result.text}`,
  );
  check("embed footer credits the requester", embed?.footer?.text?.includes("tester"), embed?.footer?.text);

  result = await post(slashCommand("writingprompt", [stringOption("genre", "horror")]));
  check(
    "genre filter is honored",
    result.json?.data?.embeds?.[0]?.footer?.text?.toLowerCase().includes("horror"),
    result.json?.data?.embeds?.[0]?.footer?.text,
  );

  result = await post(slashCommand("writingprompt", [boolOption("constraint", true)]));
  const fields = result.json?.data?.embeds?.[0]?.fields ?? [];
  check("constraint option adds a Constraint field", fields.some((f) => f.name === "Constraint" && f.value), JSON.stringify(fields));

  result = await post(slashCommand("writingprompt", [stringOption("genre", "humor"), stringOption("length", "poem")]));
  check(
    "unsatisfiable filters explain themselves privately",
    result.status === 200 && result.json?.data?.flags === 64 && /poetry/i.test(result.json?.data?.content ?? ""),
    result.text,
  );

  result = await post(slashCommand("writingprompt", [intOption("closes", 24)]));
  const deadlineField = (result.json?.data?.embeds?.[0]?.fields ?? []).find((f) => /close/i.test(f.name));
  check("a writing prompt can carry a deadline", Boolean(deadlineField), JSON.stringify(result.json?.data?.embeds?.[0]?.fields));
  check("the deadline renders in the reader's timezone", /<t:\d+:[FR]>/.test(deadlineField?.value ?? ""), deadlineField?.value);

  result = await post(slashCommand("writingprompt", [intOption("closes", 0)]));
  check("no deadline is the default",
    !(result.json?.data?.embeds?.[0]?.fields ?? []).some((f) => /close/i.test(f.name)));

  result = await post(slashCommand("writingprompt", [stringOption("genre", "not-a-genre")]));
  check("bogus option value falls back instead of erroring", result.json?.data?.embeds?.[0]?.description?.length > 0, result.text);

  console.log("\nThread creation");
  await settle();
  resetMock();
  result = await post(slashCommand("writingprompt"));
  check("prompt still posts when a thread is requested", result.json?.data?.embeds?.[0]?.description?.length > 0);

  const threadCall = await waitForRequest(isThreadCall);
  check("a thread is opened by default", Boolean(threadCall));
  check("thread hangs off the message we just posted", threadCall?.url === "/channels/chan-1/messages/msg-1/threads", threadCall?.url);

  if (threadCall) {
    const payload = JSON.parse(threadCall.body);
    check("thread name is within Discord's cap", payload.name?.length > 0 && payload.name.length <= 100, `${payload.name?.length} chars`);
    check("thread sets an auto-archive duration", typeof payload.auto_archive_duration === "number");
  }

  await settle();

  resetMock({ originalNotFoundTimes: 2 });
  await post(slashCommand("writingprompt"));
  check("thread still opens while the message is settling", Boolean(await waitForRequest(isThreadCall)));
  check(
    "the message lookup was actually retried",
    mock.requests.filter((r) => r.url.endsWith("/messages/@original")).length >= 3,
    `${mock.requests.filter((r) => r.url.endsWith("/messages/@original")).length} lookups`,
  );

  await settle();

  resetMock();
  await post(slashCommand("writingprompt", [boolOption("thread", false)]));
  await settle();
  check("thread:false opens no thread", !mock.requests.some(isThreadCall));

  await settle();

  resetMock({ threadStatus: 403 });
  await post(slashCommand("writingprompt"));
  const followUp = await waitForRequest(isFollowUp);
  check("missing permission is reported privately", Boolean(followUp) && JSON.parse(followUp.body).flags === 64, followUp?.body);
  check("the private notice names the missing permission", /Create Public Threads/.test(followUp?.body ?? ""), followUp?.body);

  console.log("\nPhotoshop prompts");
  const isEdit = (r) => r.method === "PATCH" && r.url.endsWith("/messages/@original");

  await settle();

  resetMock();
  result = await post(slashCommand("photoshop"));
  check("/photoshop defers immediately", result.status === 200 && result.json?.type === 5, `HTTP ${result.status} ${result.text}`);

  let edit = await waitForRequest(isEdit);
  check("the deferred message gets filled in", Boolean(edit));
  const psEmbed = edit && JSON.parse(edit.body).embeds?.[0];
  check("an image is embedded", psEmbed?.image?.url?.length > 0, JSON.stringify(psEmbed?.image));
  check("a challenge framing is included", /\*\*.+\*\*/.test(psEmbed?.description ?? ""), psEmbed?.description);
  check("attribution links back to the source", /\[.+\]\(https?:\/\//.test(psEmbed?.description ?? ""), psEmbed?.description);
  check("a submission thread is opened", Boolean(await waitForRequest(isThreadCall)));

  await settle();

  resetMock({ failSources: ["met", "artic"] });
  await post(slashCommand("photoshop"));
  edit = await waitForRequest(isEdit);
  const fallbackEmbed = edit && JSON.parse(edit.body).embeds?.[0];
  check("falls through to a working source when others fail", fallbackEmbed?.image?.url?.length > 0, edit?.body?.slice(0, 120));
  check("the fallback actually used Unsplash", /Unsplash/.test(fallbackEmbed?.description ?? ""), fallbackEmbed?.description);

  await settle();

  resetMock();
  await post(slashCommand("photoshop", [stringOption("source", "met")]));
  edit = await waitForRequest(isEdit);
  check("the Met uses its full-size image, not the ~600px derivative",
    JSON.parse(edit?.body ?? "{}").embeds?.[0]?.image?.url === MOCK_IMAGE,
    JSON.parse(edit?.body ?? "{}").embeds?.[0]?.image?.url);

  await settle();
  resetMock();
  await post(slashCommand("photoshop", [stringOption("source", "unsplash")]));
  edit = await waitForRequest(isEdit);
  check("forcing a source only queries that source",
    mock.requests.some((r) => r.url.startsWith("/unsplash")) && !mock.requests.some((r) => r.url.startsWith("/met")),
    mock.requests.map((r) => r.url).join(" "));
  check("Unsplash credit carries the required referral tags", /utm_source=/.test(JSON.parse(edit?.body ?? "{}").embeds?.[0]?.description ?? ""));
  check("Unsplash usage is reported back", Boolean(await waitForRequest((r) => r.url.startsWith("/unsplash/track"))));

  await settle();

  resetMock({ failSources: ["met", "artic", "unsplash"] });
  await post(slashCommand("photoshop"));
  edit = await waitForRequest(isEdit);
  const failBody = JSON.parse(edit?.body ?? "{}");
  check("total source failure explains itself", typeof failBody.content === "string" && failBody.content.length > 0, edit?.body);
  check("no empty embed is posted on failure", !failBody.embeds);
  await settle();
  check("no thread is opened when nothing was posted", !mock.requests.some(isThreadCall));

  await settle();

  resetMock();
  await post(slashCommand("photoshop", [intOption("closes", 48)]));
  edit = await waitForRequest(isEdit);
  const psFields = JSON.parse(edit?.body ?? "{}").embeds?.[0]?.fields ?? [];
  check("a photoshop challenge can carry a deadline", psFields.some((f) => /close/i.test(f.name)), JSON.stringify(psFields));

  await settle();
  resetMock();
  await post(slashCommand("photoshop", [boolOption("thread", false)]));
  await waitForRequest(isEdit);
  await settle();
  check("photoshop thread:false opens no thread", !mock.requests.some(isThreadCall));

  console.log("\nModerator controls");
  const isDelete = (r) => r.method === "DELETE" && r.url.startsWith("/channels/");

  await settle();
  resetMock();
  result = await post(slashCommand("promptconfig"));
  check("/promptconfig reports current settings privately",
    result.status === 200 && result.json?.data?.flags === 64 && /Image sources/.test(result.json?.data?.content ?? ""),
    result.text);
  check("every source is listed", ["The Met", "Art Institute", "Unsplash"].every((label) => (result.json?.data?.content ?? "").includes(label)));

  result = await post(slashCommand("promptconfig", [stringOption("source", "met"), boolOption("enabled", false)]));
  check("a source can be disabled", /disabled/i.test(result.json?.data?.content ?? ""), result.text);

  await settle();
  resetMock();
  await post(slashCommand("photoshop"));
  await waitForRequest(isEdit);
  check("a disabled source is not queried", !mock.requests.some((r) => r.url.startsWith("/met")),
    mock.requests.filter((r) => r.url.startsWith("/met")).map((r) => r.url).join(" "));

  result = await post(slashCommand("promptconfig", [stringOption("source", "met"), boolOption("enabled", true)]));
  check("a source can be re-enabled", /enabled/i.test(result.json?.data?.content ?? ""), result.text);

  result = await post(slashCommand("promptconfig", [stringOption("source", "met")]));
  check("changing a source without enabled is rejected", /enabled/i.test(result.json?.data?.content ?? "") && result.json?.data?.flags === 64);

  console.log("\nReroll");
  await settle();
  resetMock();
  await post(slashCommand("reroll", [], { channel_id: "never-used-channel" }));
  edit = await waitForRequest(isEdit);
  check("reroll with no prior prompt says so", /nothing to reroll/i.test(JSON.parse(edit?.body ?? "{}").content ?? ""), edit?.body);
  check("reroll with nothing to replace deletes nothing", !mock.requests.some(isDelete));

  await settle();
  resetMock();
  await post(slashCommand("photoshop", [], { channel_id: "reroll-channel" }));
  await waitForRequest(isEdit);
  await settle();

  resetMock();
  await post(slashCommand("reroll", [], { channel_id: "reroll-channel" }));
  const deleted = await waitForRequest(isDelete);
  check("reroll retracts the previous prompt", Boolean(deleted), mock.requests.map((r) => `${r.method} ${r.url}`).join(" | "));
  check("it deletes the right message", deleted?.url === "/channels/chan-1/messages/msg-1", deleted?.url);

  edit = await waitForRequest(isEdit);
  check("reroll posts a replacement", Boolean(JSON.parse(edit?.body ?? "{}").embeds?.[0]?.image?.url), edit?.body?.slice(0, 100));
  check("the replacement gets its own thread", Boolean(await waitForRequest(isThreadCall)));

  console.log("\nDaily schedule");
  await settle();
  resetMock();

  result = await post(slashCommand("schedule", [], { guild_id: "daily-guild" }));
  check("an unscheduled server says so", /nothing scheduled/i.test(result.json?.data?.content ?? "") && result.json?.data?.flags === 64, result.text);

  result = await post(slashCommand("schedule", [
    stringOption("kind", "alternate"),
    channelOption("channel", "chan-daily"),
    intOption("hour", 9),
  ], { guild_id: "daily-guild" }));
  const scheduled = result.json?.data?.content ?? "";
  check("a schedule can be set", /on/i.test(scheduled) && scheduled.includes("<#chan-daily>"), result.text);
  check("the hour is echoed in plain language", /9am/.test(scheduled), scheduled);
  check("it says when it starts", /starting/i.test(scheduled), scheduled);

  result = await post(slashCommand("schedule", [], { guild_id: "daily-guild" }));
  check("the schedule is persisted", /alternating/i.test(result.json?.data?.content ?? ""), result.text);

  result = await post(slashCommand("schedule", [stringOption("kind", "writing")], { guild_id: "daily-guild" }));
  check("the channel is remembered when only the kind changes", (result.json?.data?.content ?? "").includes("<#chan-daily>"), result.text);

  result = await post(slashCommand("schedule", [stringOption("days", "monday")], { guild_id: "daily-guild" }));
  check("cadence can be changed to weekly", /every Monday/i.test(result.json?.data?.content ?? ""), result.text);

  result = await post(slashCommand("schedule", [stringOption("days", "weekdays")], { guild_id: "daily-guild" }));
  check("cadence can be set to weekdays", /every weekday/i.test(result.json?.data?.content ?? ""), result.text);

  result = await post(slashCommand("schedule", [intOption("closes", 48)], { guild_id: "daily-guild" }));
  check("scheduled posts can carry a deadline", /48 hours/.test(result.json?.data?.content ?? ""), result.text);

  result = await post(slashCommand("schedule", [stringOption("kind", "off")], { guild_id: "daily-guild" }));
  check("a schedule can be turned off", /off/i.test(result.json?.data?.content ?? ""), result.text);

  result = await post(slashCommand("schedule", [], { guild_id: "daily-guild" }));
  check("turning it off clears the schedule", /nothing scheduled/i.test(result.json?.data?.content ?? ""), result.text);

  result = await post(slashCommand("schedule", [stringOption("kind", "writing")], { guild_id: "fresh-guild" }));
  check("setting a kind without a channel is rejected", /channel/i.test(result.json?.data?.content ?? ""), result.text);

  console.log("\nHTTP surface");
  let response = await fetch(`${BASE}/`);
  check("GET / serves health text", response.ok && (await response.text()).includes("AutoPrompter"));

  response = await fetch(`${BASE}/interactions`);
  check("GET /interactions is 404", response.status === 404, `HTTP ${response.status}`);
}

const worker = spawn(
  "npx",
  [
    "wrangler", "dev",
    "--port", String(PORT),
    "--var", `DISCORD_PUBLIC_KEY:${publicHex}`,
    "--var", "DISCORD_APPLICATION_ID:000000000000000000",
    "--var", "DISCORD_BOT_TOKEN:test-token-not-real",
    "--var", `DISCORD_API_BASE:http://localhost:${MOCK_PORT}`,
    "--var", `MET_API_BASE:http://localhost:${MOCK_PORT}/met`,
    "--var", `AIC_API_BASE:http://localhost:${MOCK_PORT}/aic`,
    "--var", `UNSPLASH_API_BASE:http://localhost:${MOCK_PORT}/unsplash`,
    "--var", "UNSPLASH_ACCESS_KEY:test-unsplash-key",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

const workerLog = [];
worker.stdout.on("data", (chunk) => workerLog.push(chunk.toString()));
worker.stderr.on("data", (chunk) => workerLog.push(chunk.toString()));

let exitCode = 1;
try {
  await new Promise((resolve) => discordMock.listen(MOCK_PORT, resolve));
  console.log(`Mock Discord on http://localhost:${MOCK_PORT}`);
  console.log(`Booting worker on ${BASE} ...`);
  if (!(await waitForServer())) {
    console.error("Worker never became ready. Output:\n" + workerLog.join(""));
    process.exit(1);
  }

  await runTests();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  exitCode = failed === 0 ? 0 : 1;
} catch (error) {
  console.error("\nTest run crashed:", error);
  console.error(workerLog.join(""));
} finally {
  worker.kill("SIGTERM");
  discordMock.close();
}

process.exit(exitCode);
