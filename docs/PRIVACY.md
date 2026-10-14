# Privacy, limits and risks

## What the bot can and cannot know

- The bot is a *linked device* of the WhatsApp account you connect. It receives what that account receives **while it is online**. It has no access to anyone else's phone, backups, or messages sent to other accounts.
- WhatsApp announces a "delete for everyone" as an event containing only the **id** of the removed message. The original content is available only if the bot had already received and stored it. The bot never claims otherwise: every notice says whether the original is available, was not stored, or was never seen.
- Messages edited, disappearing-message expiry, and "delete for me" on other people's devices are not observable.

## What is stored (and when)

| Data | When | How long | Where |
|---|---|---|---|
| User row: preferences, role, allow/ban flags, counter | First time someone uses a command | Preferences are reset by `/privacy purge`; the row itself stays so bans remain effective | `users` |
| Notes, bookmarks, saved messages/media | Only when the user explicitly runs `/note`, `/bookmark`, `/save` | Per-user retention (default 30 days; `0` = until deleted) | `items`, media files |
| Message cache (sender id, time, type, optional text) | Only in chats where an authorised person ran `/privacy archive meta\|full`, announced in the chat | `CACHE_TTL_HOURS` (default 24h), deleted after a notification is delivered, wiped on `archive off` | `message_cache` (TTL index) |
| Chat archive setting | When archiving is configured | Until changed | `chats` |
| WhatsApp session | After linking | Until logout / `auth:reset` | `AUTH_DIR` or `wa_auth` |

Never stored: media from archived chats, view-once content, status updates/broadcasts, newsletters, history-sync backlog, message text unless `full` mode + sender not opted out + operator allows.

Encryption at rest (AES-256-GCM, `DATA_ENCRYPTION_KEY`) covers item text/notes, cached text, saved media files and the Mongo-stored session. It does **not** hide metadata such as ids and timestamps, and a file-based session (`AUTH_STORE=file`) is plain Baileys output — protect that volume.

## Consent model

- **Default: nothing is archived.**
- Group chats: only the owner can enable archiving; the bot posts a notice listing what is kept and for how long. The owner is responsible for having the group's agreement.
- Private chats: the person you are chatting with (via the bot's number) can enable it for their own chat; the owner can enable it for chats on the linked account — again with a visible notice.
- Any participant can refuse text capture of their own messages with `/privacy logging off`, even in private mode.
- `ALLOW_CONTENT_LOGGING=false` makes text capture impossible for the whole deployment.

## View-once and disappearing media

The bot does not circumvent view-once or disappearing-media protections. View-once messages are detected only to *skip* them: no content, no caption, no media is stored, saved, forwarded or bookmarked, and `/save` / `/bookmark` refuse them.

## Risks of unofficial WhatsApp Web integrations

- **Terms of Service:** automated third-party clients are not permitted by WhatsApp. Accounts can be restricted or permanently banned, especially for bulk or unsolicited messaging. This bot only replies to people who message it and sends no broadcasts.
- **Fragility:** the protocol is reverse-engineered. Baileys 7 is a release candidate; breakage after WhatsApp changes is expected. Pin versions, test upgrades, keep backups.
- **Credential risk:** a linked-device session is equivalent to account access. Anyone who obtains the session files / Mongo `wa_auth` data can read and send as that account. Restrict access, use a dedicated number, never commit or log it (this project does neither).
- **Privacy law:** capturing other people's messages can create legal obligations (consent, notice, retention limits, data-subject requests) depending on where you and they are. This project provides notice, opt-out, retention and purge tools but does not make a deployment compliant by itself.
- **Production alternative:** for business or high-volume use, prefer the official WhatsApp Business Platform (Cloud API).
