# AutoPrompter

A Discord bot that posts Photoshop challenges and writing prompts for the
Madison, WI artist community.

Runs on Cloudflare Workers over Discord's HTTP interactions API — no always-on
gateway connection, so it costs **$0/month** on the free tier and there is no
server to babysit.

---

## Status

**Phase 4 complete.** Live commands:

| Command | Who | What it does |
|---|---|---|
| `/ping` | Anyone | Confirms the bot is awake (visible only to you) |
| `/writingprompt [genre] [length] [constraint] [thread]` | Anyone | Posts a writing prompt |
| `/photoshop [source] [thread]` | Anyone | Posts an image as a Photoshop challenge |
| `/promptconfig [source] [enabled]` | Manage Server | View or change which image sources this server uses |
| `/reroll` | Manage Messages | Replaces the most recent prompt in the channel |

The two moderator commands are gated with `default_member_permissions`, so
Discord hides them from regular members. Server admins can override that
per-command under **Server Settings → Integrations**.

`/writingprompt` draws from an 80-prompt curated pack blended with a
combinatorial mixer worth 15,600 base combinations, so the pool doesn't run dry.
Every option is optional:

- **genre** — literary, speculative, sci-fi, cyberpunk, horror, mystery, humor,
  poetry
- **length** — flash fiction, a scene, a poem
- **constraint** — adds a formal challenge ("write it in second person",
  "nobody may cry")
- **thread** — opens a thread on the prompt for responses. On by default; pass
  `thread: False` for a quick prompt that shouldn't spawn one.

Poetry only comes as poems, so a combination like Humor + A poem is
unsatisfiable; the bot says so privately rather than posting nothing.

Threads are opened after the prompt is already visible, so a thread failure can
never delay or break the prompt itself. If the bot lacks **Create Public
Threads** in that channel it says so privately, to whoever ran the command.

### `/photoshop`

Pairs a random image with a challenge framing ("Make it a movie poster", "Put
this somewhere it absolutely does not belong", "Make it Wisconsin").

Sources, tried in weighted-random order:

| Source | Weight | Share | Key needed |
|---|---|---|---|
| Unsplash | 70 | ~70% | Yes — `UNSPLASH_ACCESS_KEY` |
| The Met | 15 | ~15% | No |
| Art Institute of Chicago | 15 | ~15% | No |

Modern photography dominates because it is the easiest to work with. Museum art
stays in the rotation for variety at roughly 30% combined.

The Met is restricted to **paintings**. Its collection is mostly prints, coins,
fragments and trade cards, which make poor Photoshop material, and its
"Photographs" medium is largely cigarette-card portrait sets — Unsplash covers
photography far better. The Art Institute needs no such filter: its
public-domain subset is already about two-thirds paintings.

Unsplash is skipped entirely when no key is configured, and the museum sources
need none — the command works out of the box either way, just with a
museum-heavy mix.

If a source is down or returns nothing usable, the next one is tried. Only when
every available source fails does the bot report a problem.

**Attribution** appears on every post — title, creator, date, collection, and
license, linked back to the source page. Unsplash credit carries the referral
tags its API terms require, and its usage endpoint is pinged after posting.

Because this hits the network it uses a deferred response: Discord shows
"thinking…" for a moment, then the image replaces it. That is expected.

### `/promptconfig`

Run it with no options to see which sources are on. Pass `source` plus
`enabled` to toggle one for the whole server — no redeploy needed.

Disabling every source doesn't silence the command: `/photoshop` ignores the
blocklist rather than post nothing.

### `/reroll`

Deletes the most recent prompt in the channel and posts a fresh one of the same
kind, with the same filters. For when an image lands badly or a prompt doesn't
suit the room. Deleting the message takes its thread with it, which is the
intent.

If nothing can be generated to replace it, the original is left alone rather
than deleted into an empty gap.

### Repeat suppression

Every prompt posted is recorded per-server for 45 days, and draws that come back
as recent repeats are redrawn past — up to three times for images, five for
writing prompts. If everything drawn is still a repeat, it posts anyway: a
repeat beats an empty channel.

This needs the `PROMPT_STATE` KV binding. Without it the bot still works, just
without memory — no repeat suppression, no saved source settings, and `/reroll`
has nothing to point at.

Image prompts pull only from open-license collections. Note that museum
collections include classical nudes — appropriate for most art communities, but
worth knowing before pointing this at a general channel. If it doesn't suit your
server, `/promptconfig` turns the museum sources off, and `/reroll` retracts any
single post that lands badly.

---

## One-time setup

### 1. Local credentials

```bash
cp .dev.vars.example .dev.vars
```

Fill in the values from the
[Discord Developer Portal](https://discord.com/developers/applications).
`.dev.vars` is gitignored — real tokens never get committed.

Set `DISCORD_GUILD_ID` to your Madison server while developing. Commands then
register instantly instead of taking up to an hour to propagate.

### 2. Create the KV namespace

```bash
npx wrangler kv namespace create PROMPT_STATE
```

Put the printed id into `wrangler.toml` under `[[kv_namespaces]]`, replacing the
one committed there — that one belongs to the original deployment and won't be
writable by your account.

### 3. Deploy the Worker

```bash
npx wrangler login
```

```bash
npm run deploy
```

Note the URL it prints, e.g. `https://autoprompterbot.<your-subdomain>.workers.dev`.

### 4. Upload production secrets

`.dev.vars` is local-only. The deployed Worker needs its own copy — run each of
these and paste the value when prompted:

```bash
npx wrangler secret put DISCORD_PUBLIC_KEY
```

```bash
npx wrangler secret put DISCORD_APPLICATION_ID
```

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
```

### 5. Point Discord at the Worker

In the Developer Portal → your app → **General Information** → **Interactions
Endpoint URL**, enter:

```
https://autoprompterbot.<your-subdomain>.workers.dev/interactions
```

Discord immediately sends a signed PING and refuses to save the URL if the
response is wrong — so a successful save *is* your verification that signing
works in production.

### 6. Invite the bot to your server

Do this **before** registering commands. Guild-scoped registration requires the
bot to already be in the guild — otherwise Discord returns `403 Missing Access`,
which looks like a bad token but isn't.

Replace `<APPLICATION_ID>` with yours:

```
https://discord.com/api/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot%20applications.commands&permissions=309237763136
```

That permission integer grants: view channels, send messages, embed links,
attach files, add reactions, read message history, create public threads, and
send messages in threads.

### 7. Register the slash commands

```bash
npm run register
```

Then type `/ping` in any channel — the bot should reply, visible only to you.

The bot needs **no privileged intents** — not even Message Content. Everything
arrives through slash commands, which keeps the approval surface minimal and
avoids Discord's verification requirements as the server grows.

---

## Daily use

| Command | What it does |
|---|---|
| `npm run doctor` | Check credentials, token validity, and server membership |
| `npm run sources` | Draw live samples from each image source |
| `npm test` | Full end-to-end suite against a real local Worker |
| `npm run dev` | Local Worker at `localhost:8787` |
| `npm run deploy` | Ship to Cloudflare |
| `npm run register` | Push slash command changes to Discord |
| `npm run typecheck` | Type check without emitting |
| `npm run tail` | Live production logs |

Re-run `npm run register` after any edit to `src/commands/definitions.ts`.
Editing handler code only needs `npm run deploy`.

---

## Troubleshooting

Start here:

```bash
npm run doctor
```

It reports which credentials are set, whether the bot token actually works, and
which servers the bot is in — without printing any secret values.

| Symptom | Cause |
|---|---|
| `403 Missing Access` (code 50001) on register | Bot isn't in the server yet — do step 5 first |
| `401 Unauthorized` on register | Bot token is wrong; reset it and update `.dev.vars` |
| Discord won't save the endpoint URL | `/interactions` missing from the URL, or step 4 secrets not uploaded |
| Commands don't appear in Discord | `DISCORD_GUILD_ID` unset, so they registered globally — allow up to an hour |

`npm run tail` streams live production logs, which is the fastest way to see
whether a request is even reaching the Worker.

---

## Continuous deployment

`.github/workflows/ci.yml` runs on every push and pull request.

- **Test job** — typecheck plus the full suite. Runs on PRs too, including from
  forks: the tests need no credentials and make no outbound calls, so a
  community PR adding writing prompts gets validated automatically.
- **Deploy job** — pushes to `main` only, and only after tests pass. Deploys to
  Cloudflare, then re-registers slash commands.

Both deploy steps are skipped when their secrets are absent, so the workflow is
green from the first run and starts deploying once you add them.

### Required secrets

Set under **Settings → Secrets and variables → Actions**:

| Secret | Needed for | Where it comes from |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Deploying | Cloudflare dashboard, "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | Deploying | Cloudflare dashboard sidebar, or `npx wrangler whoami` |
| `DISCORD_APPLICATION_ID` | Registering commands | Same value as in `.dev.vars` |
| `DISCORD_BOT_TOKEN` | Registering commands | Same value as in `.dev.vars` |
| `DISCORD_GUILD_ID` | Registering commands | Same value as in `.dev.vars` |

The Discord secrets are optional. Without them the bot still deploys; you just
run `npm run register` by hand when command *options* change. Editing prompt
text or handler code never needs registering.

Worker secrets (`DISCORD_PUBLIC_KEY` and friends) are configured in Cloudflare
via `wrangler secret put` and are unrelated to these — deploying does not
touch them.

---

## Tests

```bash
npm test
```

Two suites, 120 checks. `scripts/test-units.mjs` covers prompt selection and
thread naming against the real data files — every genre/length combination,
filter correctness, generated-text grammar, genre pool isolation, and
determinism under a seeded RNG — so a bad edit to `data/*.json` fails here
rather than in the channel.

`scripts/smoke-test.mjs` boots a real Worker, generates a throwaway Ed25519 keypair, and signs requests
exactly the way Discord does — including negative cases (tampered signature,
missing headers, body swapped after signing). It needs no credentials and never
touches your Discord app.

It also runs a mock Discord on a second port, wired in through `DISCORD_API_BASE`,
so the full thread sequence gets exercised for real: looking up the message we
just posted, retrying while it settles, opening the thread on it, and reporting
a permission failure privately.

The same mock stands in for the Met, Art Institute, and Unsplash APIs, so
`/photoshop` is covered end to end — including source fallback when an API is
down, forced source selection, Unsplash referral tags and usage reporting, and
the case where every source fails at once.

Signature verification is the one place where a silent bug is expensive: accept
a bad signature and Discord disables the endpoint. Hence testing it for real
rather than trusting that it looks right.

---

## Layout

```
src/
  index.ts               Worker entry: routing, verification, error handling
  lib/
    verify.ts            Ed25519 signature verification (WebCrypto)
    discord.ts           API types and response helpers
    prompts.ts           Prompt selection: curated pack + mixer
    prompt-builders.ts   Builds the message for each prompt kind
    deliver.ts           Post-publish work: seen-marking, thread, reroll pointer
    store.ts             Workers KV: seen set, guild config, last prompt
    threads.ts           Thread naming and creation
    random.ts            Seedable pick / weighted ordering helpers
    http.ts              JSON fetch with timeout, returns null on failure
    images/
      index.ts           Weighted source selection with fallback
      met.ts             The Met Open Access
      artic.ts           Art Institute of Chicago
      unsplash.ts        Unsplash (optional)
  commands/
    definitions.ts       Command schemas and the genre/length vocabulary — no
                         Workers imports, so plain Node can import it
    index.ts             Name -> handler registry
    ping.ts              Health check command
    writingprompt.ts     /writingprompt
    photoshop.ts         /photoshop
    promptconfig.ts      /promptconfig
    reroll.ts            /reroll
scripts/
  register-commands.mjs  Pushes definitions to Discord
  doctor.mjs             Diagnoses credential and setup problems
  test-units.mjs         Prompt selection and thread naming unit tests
  smoke-test.mjs         End-to-end suite, with a mock Discord
data/
  writing-prompts.json     Curated prompts
  prompt-mixer.json        Combinatorial parts
  photoshop-challenges.json  Challenge framings
```

### Adding writing prompts

Edit `data/writing-prompts.json` — each entry needs `text`, a `genre`, and a
`length`. No code change needed; `npm run deploy` picks it up.

To extend the mixer, edit `data/prompt-mixer.json`. The parts are composed as
`{character} {situation}, {setting}.` so the grammar only holds if you match the
existing shapes: characters are capitalized noun phrases ("A night janitor at an
aquarium"), situations are third-person-singular verb phrases ("finds a letter
addressed to someone who died a decade ago"), and settings are prepositional
phrases ("on a frozen lake dotted with ice shanties").

The default character and setting pools are contemporary-realist, which works
for literary, horror, mystery, and humor but not for genres with their own
furniture — "A crossing guard is the only crew member awake for the course
correction" is nonsense. Sci-fi and cyberpunk therefore have dedicated pools
under `charactersByGenre` and `settingsByGenre`, which replace the defaults
entirely for those genres. Add a key there for any future genre that needs it.

`npm test` checks that generated text stays well-formed and that genre pools
don't leak into each other.

### Adding a command

1. Add the schema to `src/commands/definitions.ts`.
2. Create the handler in `src/commands/`, exporting a `Command`.
3. Add it to the `ALL` array in `src/commands/index.ts`.
4. `npm run register && npm run deploy`.

### The 3-second rule

Discord kills an interaction that isn't answered within 3 seconds, which is not
enough time to reliably fetch an image from a third-party API. Handlers that
call the network should return `defer()` immediately, do the slow work inside
`ctx.waitUntil(...)`, then call `editOriginalResponse(...)` to replace the
"thinking…" placeholder. Both helpers are in `src/lib/discord.ts`.

---

## Roadmap

- [x] **Phase 0** — Worker deployed, signatures verified, `/ping` responding
- [x] **Phase 1** — `/writingprompt` with curated packs + combinatorial mixer
- [x] **Phase 2** — `/photoshop` pulling from the Met, Art Institute of Chicago,
      and Unsplash, with attribution and source fallback
- [x] **Phase 2.5** — Auto-threading (pulled forward from Phase 3)
- [x] **Phase 4** — Mod config, source blocklist, `/reroll`, repeat suppression
- [ ] **Phase 3** — Scheduled daily prompt via cron
- [ ] **Phase 5** — Submission gallery, hall of fame, weekly recap

### Image sourcing policy

Every image post carries source, creator, and license. Sources are limited to
open-license APIs (Met Museum Open Access, Art Institute of Chicago, Unsplash).
Openverse and Wikimedia Commons are easy to add — implement the `ImageSource`
interface in `src/lib/images/` and register it in that directory's `index.ts`.
Reddit scraping is deliberately excluded; it's the one path here with real
terms-of-service risk.
