# WhatsApp Utility Bot

A privacy-first, modular WhatsApp utility bot built on [Baileys](https://github.com/WhiskeySockets/Baileys) (`7.0.0-rc14`) and MongoDB. It helps you save and organise messages you choose to keep, search them, and — **only in chats where archiving was explicitly switched on** — tells you when a message was deleted, being precise about whether the original content was actually available.

> **Read this first:** Baileys is an *unofficial* WhatsApp Web client. Using it can violate WhatsApp's Terms of Service and can get a number restricted or banned. Use a dedicated number, never message people who did not ask for it, and see [docs/PRIVACY.md](docs/PRIVACY.md) for the full risk and privacy discussion.

## What is and isn't supported

| Requested feature | Status | Notes |
|---|---|---|
| Command router, `/menu /help /ping /info /settings /bookmark /search /privacy /owner /restart` | ✅ Supported | Plus `/note`, `/save` (alias `/saved`) and `/admin`. |
| Save & organise messages | ✅ Supported | Works on messages **you reply to** with `/save` or `/bookmark` (WhatsApp includes the quoted content in your reply). Text, image, video, audio, document, sticker. Files are stored per-user, encrypted at rest when a key is set. |
| Bookmarks & personal notes, `#tags` | ✅ Supported | Per-user numbering (`#12`). |
| Search saved content | ✅ Supported | Searches only the requester's own notes/bookmarks/saved items (`/search words type:note #tag`). |
| Configurable notifications | ✅ Supported | `/settings set notifyDeletes on\|off`, `ackReactions`, `timezone`. |
| **Deleted-message notifications** | ⚠️ **Depends on events** | Requires (1) the bot to be connected when the delete arrives, and (2) the chat to have been archived *before* the message was sent. See below. |
| Privacy controls | ✅ Supported | `/privacy`: archive mode per chat, sender opt-out, retention, export, purge. Operator kill-switch `ALLOW_CONTENT_LOGGING=false`. |
| Roles, rate limiting, spam mute, health checks, structured redacted logs, error reporting | ✅ Supported | |
| Configurable prefix & identity | ✅ Supported | Env defaults; owner can override at runtime (`/admin prefix`, `/admin botname`). |
| QR login, pairing-code login, session persistence, reconnection, graceful shutdown | ✅ Supported | Session in files or MongoDB. |
| Docker + compose | ✅ Provided | See *Verification status* below. |
| **View-once media** | ❌ **Not implemented — by design** | The bot never opens, saves or forwards view-once content. A view-once message is recorded (if at all) as "a view-once message arrived" with no content, and `/save` refuses it. |
| Recovering messages the bot never received / was offline for / from before archiving was on | ❌ Impossible | WhatsApp delivers a delete as an *event* only; it does not include the old content. |
| Reading other people's devices, or silently logging groups/contacts | ❌ Not implemented | Archiving needs an explicit, announced opt-in per chat. |

### How deleted-message notifications actually work

1. An authorised person runs `/privacy archive meta|full` in a chat. The bot **posts a visible notice in that chat**. Only the owner can do this in groups; anyone else only in their own private chat with the bot.
2. While a chat is archived, each message the bot *receives* is cached for `CACHE_TTL_HOURS` (default 24h): sender, time and type (`meta`); plus the text (`full`); plus photos, videos, stickers, audio and documents up to `MAX_MEDIA_MB` (`media`, encrypted on disk when a key is set). Text and files are only kept if the sender has not opted out and the operator allows it (`ALLOW_CONTENT_LOGGING`, `ALLOW_MEDIA_CACHING`). View-once content is **never** stored.
3. When WhatsApp sends a revoke event, the bot reports exactly one of:
   - 🗑️ **original content available** – text and/or the file was captured while the chat was archived (the file is re-sent right after the notice);
   - 🗑️ **content not stored** – the message was seen, but only metadata was kept (and why: meta mode, sender opt-out, media, view-once…);
   - 🗑️ **original NOT available** – the bot has no record of it (sent before archiving, not received, or expired).
4. Chats that are not archived produce nothing: no cache, no notice.

## Quick start

```bash
cp .env.example .env        # set MONGODB_URI and OWNER_NUMBERS at minimum
npm ci
npm start                   # scan the QR code: WhatsApp > Linked devices > Link a device
```

Then send `/ping` from the owner number. Full instructions (Docker, VPS, backups, troubleshooting): **[docs/SETUP.md](docs/SETUP.md)**.

```bash
docker compose up -d        # bot + MongoDB
docker compose logs -f bot  # scan the QR code on first run
```

## Commands

| Command | Who | What it does |
|---|---|---|
| `/menu` | everyone | Lists the commands you may use |
| `/help [cmd]` | everyone | Usage instructions |
| `/ping` | everyone | Responsiveness check |
| `/info` | everyone | Version, uptime, connection status (admins also see counters) |
| `/settings [set k v \| reset]` | users | Personal preferences |
| `/note <text>` · `list` · `show #n` · `delete #n` | users | Personal notes, `#tags` supported |
| `/bookmark [note]` (reply) · `list` · `show` · `delete` | users | Saves a *reference* + 200-char excerpt |
| `/save [note]` (reply) · `/saved list\|show\|delete` | users | Saves text/media you chose to keep |
| `/sticker` (reply to a photo/GIF/video/sticker) | users | Converts it into a WhatsApp sticker |
| `/search words [type:…] [#tag]` | users | Searches your own saved content |
| `/privacy [logging\|retention\|archive off\|meta\|full\|media\|export\|purge]` | everyone* | Data retention and logging controls |
| `/owner` | everyone | Owner contact (only what the operator configured) |
| `/admin allow\|disallow\|ban\|unban\|list\|stats` | admins | User management |
| `/admin promote\|demote\|prefix\|botname\|identity-reset` | owner | Role & identity management |
| `/restart` → `/restart confirm` | owner | Two-step restart |

\* `/privacy` stays reachable even in private mode so anyone can opt out of text capture.

## Roles & modes

- **owner** – listed in `OWNER_NUMBERS` (config only; the database can never grant it) or a message sent from the linked account itself.
- **admin** – promoted by the owner.
- **user** – anyone when `BOT_MODE=public`; otherwise only people the owner/admins `allow`.
- Others (private mode) are ignored silently; banned users are ignored silently.

## Architecture

```
src/
  index.js          process entry: config, signals, startup
  app.js            composition root (wires everything, lifecycle)
  config/           env parsing + validation (fails fast, lists all problems)
  events/           WhatsApp event handlers (context building, message upsert)
  commands/         one file per command + registry + router
  middleware/       error boundary → identity/role → rate limit → authorize
  services/         WhatsApp client, archive, deletion notifier, permissions,
                    rate limiter, media store, retention job, health, error reporter
  database/         MongoDB connection, indexes, repositories, Mongo auth state
  utils/            logger (redaction), crypto, jid/message parsing, text helpers
test/               node:test suites (real mongod via mongodb-memory-server, fake socket)
```

Events → `events/` (no business logic) → `services/` (rules) → `database/` (persistence). Commands only talk to services/repositories through the dependency container.

## Security highlights

- No credentials in code; everything via environment variables. `.env`, `data/` and auth folders are git-ignored.
- QR codes and pairing codes are printed to the terminal only — never to the logger. The logger redacts credentials, keys, URIs and message bodies; JIDs are masked (`user:…0001`).
- Optional AES-256-GCM encryption at rest (`DATA_ENCRYPTION_KEY`) for notes, saved text, cached text, saved media and the Mongo-stored WhatsApp session.
- The WhatsApp session is a full-account credential: protect the `/data` volume or Mongo database like a password.
- Admin/owner commands are authorised by role on every call; owner status cannot be set through the database; admins cannot ban the owner or other admins.
- Per-user rate limiting with escalation to a temporary mute. Replayed (stale) messages after a reconnect are ignored for command purposes.
- Minimal collection: nothing is captured from a chat without an announced opt-in; cached messages auto-expire via a MongoDB TTL index; saved items expire per user retention; `/privacy purge` deletes everything about a user.

## Stickers

Reply to a photo, GIF/video or existing sticker with `/sticker` to convert it into a WhatsApp sticker. Images are padded to a square transparent WebP; video/GIF clips (capped at 10 seconds) become an animated WebP via `ffmpeg`. Requires the `ffmpeg` binary (included in the Docker image) and the `sharp` package (installed automatically). View-once media is refused, same as `/save`.

## Branding

Set `BRAND_IMAGE_PATH` to a local `.png`/`.jpg`/`.webp` file to attach it to every command reply. Short replies (≤1000 characters) become a single image+caption message; longer replies (e.g. `/menu`) get the image first, then the full text as a normal message, so nothing is ever truncated. Leave it unset for plain-text replies (the default). A missing or unreadable file logs a warning and falls back to plain text rather than failing startup.

## Development

```bash
npm test          # 100+ tests: routing, permissions, DB, privacy rules, reconnect logic, error handling
npm run check     # syntax check of all files
npm run auth:reset -- --yes   # forget the WhatsApp session (forces a new QR)
```

### Verification status

Verified in this repository: dependencies install from a clean lockfile (including `npm ci --omit=dev`); the full test suite passes against a real `mongod`; the real process boots, connects to MongoDB, serves `/healthz` + `/readyz`, receives a real QR code from WhatsApp's servers, and shuts down cleanly on `SIGTERM`.

**Not verified here:** scanning the QR with a phone and exchanging live messages (requires a human with a WhatsApp account), and building the Docker image (no Docker daemon was available in the build environment). The Dockerfile uses only `npm ci`, a non-root user and a Node HEALTHCHECK, and its production-install steps were reproduced manually.
