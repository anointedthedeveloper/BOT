# WhatsApp Deleted-Message & Sticker Bot

A small, single-purpose WhatsApp bot built on [Baileys](https://github.com/WhiskeySockets/Baileys) (`7.0.0-rc14`) and MongoDB. It does exactly two things: tells the owner privately when a monitored message gets deleted (with the original content, if it was captured), and turns photos/videos into WhatsApp stickers. Nothing else.

> **Unofficial WhatsApp client:** Baileys is a reverse-engineered WhatsApp Web client, not an official API. Using it can violate WhatsApp's Terms of Service and risks the linked number being restricted. Use a dedicated number. See [docs/PRIVACY.md](docs/PRIVACY.md) for the full risk and privacy discussion.

## Commands

The prefix is a comma (`,`), fixed — there is no command to change it.

```
DELETED MESSAGES
,delete on      — Enable monitoring
,delete off     — Disable monitoring (also wipes everything cached)
,delete status  — Check monitoring status

STICKERS
,sticker        — Reply to (or caption) a photo, GIF/video or sticker to convert it

SETTINGS
,settings            — Compact overview of what's on
,settings delete on|off
,settings sticker on|off
,settings status      — Current values
```

Everything above except `,menu` itself (which just prints this) is owner-only. See [Roles](#roles) below — there is no user-management system left in this bot, so "owner" is the only privileged role that exists.

## How deleted-message monitoring works — and its real limits

1. `,delete on` turns monitoring on for **every chat the bot is in**, immediately, without touching each chat individually.
2. The **first message a chat sends after that** triggers a one-time, visible `📦 Deleted-message monitoring is now ON` notice posted **in that chat**. This is not optional and cannot be turned off — anyone in a monitored chat can see monitoring is active.
3. While monitoring is on, each message the bot *receives* is cached briefly (`CACHE_TTL_HOURS`, default 24h): sender, time, type, and — when `ALLOW_CONTENT_LOGGING`/`ALLOW_MEDIA_CACHING` allow it — the text and/or media file too (encrypted on disk when `DATA_ENCRYPTION_KEY` is set).
4. When WhatsApp reports a message was deleted (`revoke`), the bot sends the **owner** (never anyone else, never posted back in the chat) exactly one of:
   - 🗑️ **original content available** — the text and/or file was captured; the file is re-sent right after.
   - 🗑️ **content not stored** — the bot saw the message but didn't keep its content (and says why).
   - 🗑️ **original NOT available** — the bot has no record of it at all.
5. `,delete off` turns monitoring off everywhere and **deletes every cached message and file** immediately — nothing is left lingering once it's off.

**Hard limits, not bugs:**
- A message deleted **before** `,delete on` was ever run, or sent while the bot was offline, cannot be recovered — WhatsApp's delete event carries only the message's id, never its old content. The bot reports this plainly ("original NOT available") rather than guessing.
- Media is only captured when `ALLOW_MEDIA_CACHING=true` (the default); if the operator disables it, deleted photos/videos are reported but never shown.
- A chat that was **never monitored** (no message captured there since monitoring last turned on) never produces a notification at all, even if a message is deleted in it.

## View-once media: not implemented, on purpose

View-once is WhatsApp's own protection on media the sender marked "see once." There is no officially supported, permitted way for a linked-device client like this bot to retain view-once content after it's been viewed — doing so would mean silently defeating a protection the sender deliberately turned on, without their knowledge. Rather than fake this or quietly work around it, this bot **does not implement it**: no `,viewonce` command exists, `/sticker` and nothing else ever touches view-once content, and the menu never advertises a feature that isn't there. If Baileys or WhatsApp ever exposes a compliant, authorized way to do this, it can be added later — until then, leaving it out is the honest choice.

## Quick start

```bash
cp .env.example .env        # set MONGODB_URI and OWNER_NUMBERS at minimum
npm ci
npm start                   # scan the QR code: WhatsApp > Linked devices > Link a device
```

Then, from the owner's number, send `,menu`. Full instructions (Docker, VPS, troubleshooting): **[docs/SETUP.md](docs/SETUP.md)**.

```bash
docker compose up -d        # bot + MongoDB
docker compose logs -f bot  # scan the QR code on first run
```

## Stickers

Reply to a photo, GIF/video or existing sticker with `,sticker` — or send/caption the media itself with `,sticker` — to get it back as a WhatsApp sticker. Images are padded to a 512×512 transparent WebP via `sharp`; video/GIF clips (capped at 10 seconds) become an animated WebP via `ffmpeg`. Both are bundled in the Docker image; `ffmpeg` must be installed separately for a non-Docker deployment (static image stickers work without it).

- Oversized files are refused before downloading (`MAX_MEDIA_MB`).
- Unsupported formats (audio, documents, plain text) get a clear "can't sticker that" message, not a crash.
- A broken/corrupt file is reported as a friendly error; an actual processing failure (e.g. `ffmpeg` missing) is reported as a bug instead, with a reference.
- All temporary files are written to a per-conversion temp directory and removed when the command finishes, success or failure.
- The sticker's pack name/author (`STICKER_PACK_NAME`/`STICKER_PACK_AUTHOR`) default to the bot's name.
- Can be switched off entirely with `,settings sticker off`.

## Settings persistence

`,delete on/off` and `,settings sticker on/off` are stored in MongoDB (the `bot_config` collection) and survive a restart — set once, they stay set until changed again.

## Roles

- **owner** — listed in `OWNER_NUMBERS` (config only; the database can never grant this) or a message sent from the linked account itself. Owner-only: `,delete`, `,settings`.
- Everyone else can use `,menu` and (when enabled and `BOT_MODE=public`) `,sticker`. There is no admin/allow-list tier in this build — it was removed along with the other general-purpose commands.

## Architecture

```
src/
  index.js          process entry: config, signals, startup
  app.js             composition root (wires everything, lifecycle)
  config/            env parsing + validation (fails fast, lists all problems)
  events/            WhatsApp event handlers (context building, message upsert)
  commands/          delete.js, menu.js, settings.js, sticker.js + registry/router
  middleware/        error boundary → identity/role → rate limit → authorize
  services/          WhatsApp client, archive (capture), deletion notifier, permissions,
                      rate limiter, media store, sticker conversion, retention sweep, health
  database/          MongoDB connection, indexes, repositories (users, chats, message cache)
  utils/             logger (redaction), crypto, jid/message parsing, text helpers
test/                node:test suites (real mongod via mongodb-memory-server, fake socket,
                      real sharp/ffmpeg sticker conversions)
```

## Security highlights

- No credentials in code; everything via environment variables. `.env`, `data/` and auth folders are git-ignored.
- QR codes and pairing codes are printed to the terminal (or saved to `QR_IMAGE_PATH`) only — never to the logger. The logger redacts credentials, keys, URIs and message bodies; JIDs are masked in logs.
- Optional AES-256-GCM encryption at rest (`DATA_ENCRYPTION_KEY`) for cached message text, cached media files and the Mongo-stored WhatsApp session.
- The WhatsApp session is a full-account credential: protect the `/data` volume or Mongo database like a password.
- `,delete` and `,settings` are owner-only on every call; owner status cannot be set through the database.
- Per-sender rate limiting with escalation to a temporary mute, so `,sticker`'s `ffmpeg` work can't be used to spam the process.
- Minimal collection: nothing is captured unless monitoring is on, that's always disclosed in-chat, cached messages auto-expire via a MongoDB TTL index or a retention sweep, and `,delete off` wipes everything immediately.

## Development

```bash
npm test          # node:test: command routing, permissions, DB, monitoring behaviour,
                   # reconnect logic, error handling, real sticker conversions
npm run check     # syntax check of all files
npm run auth:reset -- --yes   # forget the WhatsApp session (forces a new QR)
```

### Verification status

Verified in this repository: dependencies install from a clean lockfile (including `npm ci --omit=dev`); the full test suite passes against a real `mongod`, including real `sharp`/`ffmpeg` sticker conversions (static and animated); the real process boots, connects to MongoDB, serves `/healthz` + `/readyz`, receives a real QR code from WhatsApp's servers, and shuts down cleanly on `SIGTERM`.

**Not verified here:** scanning the QR with a phone and exchanging live messages (requires a human with a WhatsApp account), and building the Docker image (no Docker daemon was available in the build environment).
