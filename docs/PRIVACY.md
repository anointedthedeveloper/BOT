# Privacy, limits and risks

## What the bot can and cannot know

- The bot is a *linked device* of the WhatsApp account you connect. It receives what that account receives **while it is online**. It has no access to anyone else's phone, backups, or messages sent to other accounts.
- WhatsApp announces a "delete for everyone" as an event containing only the **id** of the removed message. The original content is available only if the bot had already received and stored it while monitoring was on. The bot never claims otherwise: every notification says whether the original is available, was not stored, or was never seen.
- Messages edited, disappearing-message expiry, and "delete for me" on other people's devices are not observable.

## What is stored (and when)

| Data | When | How long | Where |
|---|---|---|---|
| User row: role, ban flag | First time someone messages the bot | Until explicitly cleared in the database (no command does this) | `users` |
| Monitored-chat marker (has this chat been told monitoring is on) | Once per chat, the first message captured after `,delete on` | Until `,delete off` (wipes it) | `chats` |
| Cached message (sender, time, type, optional text, optional media file) | Only in chats where deleted-message monitoring is on (`,delete on`), announced with a notice in that chat | `CACHE_TTL_HOURS` (default 24h), deleted immediately after a notification is delivered, or wiped entirely on `,delete off` | `message_cache` (TTL index + explicit wipe) |
| WhatsApp session | After linking | Until logout / `auth:reset` | `AUTH_DIR` or `wa_auth` |

Never stored: media when monitoring mode is `meta`/`full` (text-only or metadata-only) or media over `MAX_MEDIA_MB`; view-once content, under any mode, ever; status updates/broadcasts; newsletters; history-sync backlog. Message text is only kept when `ALLOW_CONTENT_LOGGING` allows it; media only when `ALLOW_MEDIA_CACHING` allows it.

Encryption at rest (AES-256-GCM, `DATA_ENCRYPTION_KEY`) covers cached message text, cached media files and the Mongo-stored session. It does **not** hide metadata such as ids and timestamps, and a file-based session (`AUTH_STORE=file`) is plain Baileys output — protect that volume.

## Consent model

- **Default: nothing is monitored.** `,delete on` must be run (or `DEFAULT_ARCHIVE_MODE` set at deploy time) before anything is captured anywhere.
- Deleted-message monitoring is **owner-controlled and global** in this build — there is no per-chat opt-in/opt-out command, and no per-sender logging opt-out. Turning it on with `,delete on` applies to every chat the bot is in, immediately.
- This is still never silent: the **first message captured in each chat posts a visible "monitoring is ON" notice right there**, every time, with no way to suppress it — that notice is the one thing this design does not make configurable.
- Deleted content recovered this way is sent to the **owner privately**, never posted back into the chat or sent to anyone else.
- `,delete off` turns monitoring off everywhere and **immediately deletes every cached message and file** — nothing lingers once it's off.
- `ALLOW_CONTENT_LOGGING=false` makes text capture impossible for the whole deployment; `ALLOW_MEDIA_CACHING=false` does the same for media, regardless of what `,delete on` is set to.

Because there is no per-chat consent step beyond that notice, the owner is responsible for having the agreement of the people in any group they turn this on for — the bot enforces disclosure, not consent.

## View-once media: deliberately not implemented

WhatsApp's view-once protection is something the *sender* turns on for a specific piece of media. There is no officially supported, permitted interface for a linked-device client to retain that media after it's been viewed — any such capability would mean defeating a protection the sender chose, without their knowledge. This bot does not implement it in any form: it is not detected-and-skipped only for storage (the way other content might be refused) — there is no code path that touches view-once content for retention purposes at all, and no command claims to support it.

## Risks of unofficial WhatsApp Web integrations

- **Terms of Service:** automated third-party clients are not permitted by WhatsApp. Accounts can be restricted or permanently banned, especially for bulk or unsolicited messaging. This bot only replies to people who message it and sends no broadcasts.
- **Fragility:** the protocol is reverse-engineered. Baileys 7 is a release candidate; breakage after WhatsApp changes is expected. Pin versions, test upgrades, keep backups.
- **Credential risk:** a linked-device session is equivalent to account access. Anyone who obtains the session files / Mongo `wa_auth` data can read and send as that account. Restrict access, use a dedicated number, never commit or log it (this project does neither).
- **Privacy law:** capturing other people's messages can create legal obligations (consent, notice, retention limits, data-subject requests) depending on where you and they are. This project provides a mandatory in-chat notice and an immediate wipe on `,delete off`, but does not make a deployment compliant by itself — the owner decides where this is appropriate to run.
- **Production alternative:** for business or high-volume use, prefer the official WhatsApp Business Platform (Cloud API).
