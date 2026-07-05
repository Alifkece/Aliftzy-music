# Frekuensi — Music Web App

A web conversion of your Telegram music bot. The backend logic is unchanged —
same `yt-dlp` search/download calls, same Search That Song calls — only the
Telegram transport layer was swapped for an Express REST API, and a new
static frontend (`/public`) talks to that API.

## What was reused vs. removed

**Reused as-is (logic untouched):**
- `ytdlpSearch` / `ytSearch` — SoundCloud search via yt-dlp
- `downloadWithProgress` — same `yt-dlp` args (`bestaudio/best`, extract to mp3).
  Only the stdout parser was extended to also read out speed/ETA from the
  same `--newline` output, so the web progress bar has more than a bare
  percentage. yt-dlp itself is called identically to the bot.
- `stsSearch` and all its `_sts*` helpers — Search That Song lyrics/song ID

**Removed (Telegram-only plumbing, has no web equivalent):**
- `bot.command(...)`, `bot.action(...)`, inline keyboards
- `playSearchCache` (per-Telegram-user Map) — replaced by an in-memory
  `trackCache`/`fileCache`/`jobs` bookkeeping layer, since HTTP needs some
  way to refer back to a search result by id instead of `callback_data`
- The `/tiktokdl` command — out of scope for a music streaming site; say the
  word and it can be added back as `/api/tiktok`.

## Running it

```bash
npm install
npm start
```

Requires `yt-dlp` (and `ffmpeg`, which `yt-dlp` uses for the mp3 extraction)
on the machine running the server — exactly as the original bot did. Set
`YTDLP_BIN` if it's not on your `PATH`.

Open `http://localhost:3000`.

## API surface

| Method | Route                          | Wraps                          |
|--------|--------------------------------|---------------------------------|
| GET    | `/api/search?q=`               | `ytSearch`                      |
| GET    | `/api/track/:id`                | cached search result lookup     |
| GET    | `/api/lyrics?q=`                | `stsSearch`                     |
| GET    | `/api/stream/:id`               | `downloadWithProgress` (cached) |
| POST   | `/api/download/:id`             | starts a download job           |
| GET    | `/api/download/:jobId/events`   | SSE progress feed               |
| GET    | `/api/download/:jobId/file`     | serves the finished mp3         |

## Known limitation

`trackCache` / `fileCache` / `jobs` are plain in-memory `Map`s scoped to a
single Node process — fine for a personal/demo deployment, but swap in Redis
or a DB before running multiple instances behind a load balancer.
