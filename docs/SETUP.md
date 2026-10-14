# Setup guide

## 1. Prerequisites

- Node.js **20+** (22 recommended) and npm — or Docker with Compose.
- A MongoDB 6+ database (local, Docker, or MongoDB Atlas).
- A WhatsApp account to link. **Use a dedicated number** if you can; see [PRIVACY.md](PRIVACY.md).

## 2. Configure

```bash
cp .env.example .env
```

Minimum edits:

| Variable | Value |
|---|---|
| `MONGODB_URI` | e.g. `mongodb://127.0.0.1:27017` or your Atlas string |
| `OWNER_NUMBERS` | your number, digits only, international format (`15551234567`). Several allowed, comma separated. |

Strongly recommended:

```bash
echo "DATA_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env   # encrypt saved data at rest — back this key up!
```

and leave `BOT_MODE=private` unless you really want everyone who messages the linked number to be able to use the bot.

The app validates the configuration at start-up and prints *every* problem before exiting with code 2.

## 3. Run locally

```bash
npm ci
npm start
```

On first start a QR code appears in the terminal (it is never written to the logs). On the phone: **WhatsApp → Settings → Linked devices → Link a device** and scan it.

Prefer a code over a QR? Set `PAIRING_PHONE_NUMBER=15551234567` and choose **Link with phone number instead** on the phone; the 8-character code is printed in the terminal.

Check it works: send `/ping` from the owner number (or from the linked account itself — messages sent *from* the linked account count as the owner).

Health: `curl localhost:3000/healthz` (alive) and `curl -i localhost:3000/readyz` (200 only when MongoDB and WhatsApp are connected).

## 4. Run with Docker Compose (bot + MongoDB)

```bash
cp .env.example .env     # edit OWNER_NUMBERS, DATA_ENCRYPTION_KEY …  (MONGODB_URI is overridden by compose)
docker compose up -d --build
docker compose logs -f bot    # scan the QR code on first start
```

- Session + saved media live in the `bot-data` volume; the database in `mongo-data`. **Both hold private data** — do not publish them or snapshot them to shared locations unencrypted.
- The bot container runs as a non-root user, restarts automatically (`unless-stopped`), has a health check and handles `docker stop` gracefully.
- MongoDB is not exposed to the host. If you expose it, enable authentication first.

Plain Docker with an external MongoDB:

```bash
docker build -t whatsapp-utility-bot .
docker run -d --name wabot --restart unless-stopped --env-file .env -v wabot-data:/data whatsapp-utility-bot
docker logs -f wabot
```

## 5. Running without Docker (VPS)

systemd unit (`/etc/systemd/system/wabot.service`):

```ini
[Unit]
Description=WhatsApp utility bot
After=network-online.target mongod.service

[Service]
WorkingDirectory=/opt/wabot
EnvironmentFile=/opt/wabot/.env
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
User=wabot
# SIGTERM triggers the graceful shutdown
KillSignal=SIGTERM
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
```

pm2 works too: `pm2 start src/index.js --name wabot`. Set `RESTART_MODE=exit` if you want `/restart` to restart the whole process under a supervisor (otherwise it just reconnects).

## 6. Hosting without a persistent disk

Set `AUTH_STORE=mongo` so the WhatsApp session is stored in MongoDB (encrypted when `DATA_ENCRYPTION_KEY` is set). Saved *media* still needs `MEDIA_DIR` on a persistent volume — or simply don't use `/save` on media.

## 7. Using the privacy features

Two ways to turn on deleted-message recovery — same underlying system, different scope:

```
/privacy archive meta     one chat: remember sender/time/type of new messages (no text)
/privacy archive full     one chat: … and the text, so a deletion can show it
/privacy archive media    one chat: … and photos/videos/stickers/audio/documents, re-sent if deleted
/privacy archive off      one chat: stop and wipe that chat's cache

/delete on                owner only: turn it on (media if allowed, else full) for EVERY chat at once
/delete on dm             same, but deletions are sent to you privately instead of posted in the chat
/delete off               owner only: turn the above back off
/delete status            show the current default

/privacy logging off      refuse capture of YOUR text in archived chats
/privacy retention 14     auto-delete your new saved items after 14 days
```

Either way, the first message captured in a chat posts the same visible "archiving is ON" notice right there — there is no silent option, regardless of `inchat`/`dm`. A chat you explicitly turned off with `/privacy archive off` stays off even while `/delete on` is active globally. By default deletions are shown back **in the chat they happened in**; `/delete on dm` routes them to the owner privately instead (the notice says which). `DEFAULT_ARCHIVE_MODE` in `.env` sets the mode at deploy time instead of via `/delete`.

## 8. Operations

| Task | How |
|---|---|
| Logs | JSON on stdout. `LOG_LEVEL=debug` for more. Message text/credentials are redacted. |
| Backup | `mongodump` the database, copy `/data/media` **and** keep `DATA_ENCRYPTION_KEY` separately. |
| Update | `git pull && npm ci && restart` (or `docker compose up -d --build`). The session persists. |
| Log out / new number | `npm run auth:reset -- --yes` (or delete the `bot-data` volume), also remove the device in WhatsApp → Linked devices, then start and scan again. |
| Change prefix/name | `/admin prefix !` · `/admin botname Jarvis` (owner). `/admin identity-reset` restores `.env` values. |
| Rotate `DATA_ENCRYPTION_KEY` | Not automatic: existing encrypted data needs the old key. Export users' data first or keep the old key until items expire. |

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Invalid configuration: …` | Fix the listed variables in `.env`. |
| `Could not connect to MongoDB` | Check `MONGODB_URI`, network/firewall, Atlas IP allow-list. |
| Bot ignores your commands | `BOT_MODE=private` and you are not an owner: check `OWNER_NUMBERS`. If WhatsApp identifies you by LID, add `yourlid@lid` to `OWNER_NUMBERS` (the log shows masked ids; messaging from the linked phone itself always counts as owner). Also check the prefix (`/info`). |
| Log: `connection_replaced` and the process exits | Another instance is using the same session. Run only one. |
| Log: `logged_out` and a new QR appears | The device was removed on the phone (or the account logged it out). Scan the new QR. |
| QR keeps refreshing | It expires in ~1 minute; scan quickly or use `PAIRING_PHONE_NUMBER`. |
| `/readyz` returns 503 | WhatsApp not connected yet (status `qr`/`connecting`) or MongoDB unreachable; the body shows which. |
| Repeated disconnects (408/428) | Unstable network or hosting. The client backs off (1s → 60s) and gives up after 20 consecutive failures so your supervisor can restart it. |
| No deleted-message notice | The chat must be archiving (`/privacy archive …` or `/delete on`) *before* the message was sent, and the bot must have been online. `notifyDeletes` only matters for a chat someone enabled individually via `/privacy archive` (it has no effect on `/delete on`'s global default, since no single person "owns" that setting). Even with everything on, only a "deletion detected" notice may be possible for messages sent before archiving started — that is by design, not a bug. |
