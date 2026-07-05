// server.js
// -----------------------------------------------------------------------------
// Express backend for the Frekuensi web player.
//
// Everything in the "REUSED FROM BOT" section below is lifted directly from
// the original Telegram bot (play-command.js) with the Telegram plumbing
// (bot.command / ctx.reply / inline keyboards) removed. The actual search
// and download logic — yt-dlp calls, Search That Song calls — is untouched.
//
// The only functional change is inside downloadWithProgress: the original
// bot only needed a bare percentage to edit a Telegram message. The web UI
// needs percent + speed + ETA for a real progress bar, so the --newline
// output from yt-dlp (which already contains that info) is parsed a little
// more thoroughly. The yt-dlp arguments themselves are unchanged.
// -----------------------------------------------------------------------------

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");
const axios = require("axios");

const YTDLP_BIN = process.env.YTDLP_BIN || "yt-dlp";
const AUDIO_DIR = path.join(__dirname, "tmp_audio");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

// ============================================================================
// REUSED FROM BOT — search
// ============================================================================

function ytdlpSearch(query, limit = 3) {
  return new Promise((resolve, reject) => {
    const ytdlp = spawn(YTDLP_BIN, [
      `scsearch${limit}:${query}`,
      "--dump-json",
      "--no-playlist",
      "--flat-playlist",
    ]);

    let out = "";
    let errOut = "";

    ytdlp.stdout.on("data", (data) => { out += data.toString(); });
    ytdlp.stderr.on("data", (data) => { errOut += data.toString(); });

    ytdlp.on("error", (err) => {
      reject(err.code === "ENOENT" ? new Error("yt-dlp tidak ditemukan di server") : err);
    });

    ytdlp.on("close", (code) => {
      if (code !== 0) return reject(new Error(errOut || `yt-dlp exit code ${code}`));
      try {
        const items = out
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
        resolve(items);
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function ytSearch(query) {
  try {
    const items = await ytdlpSearch(query, 5);

    return {
      tracks: items.map((v) => ({
        title: v.title,
        url: v.url || v.webpage_url,
        uploader: v.uploader,
        duration: v.duration,
        thumbnail: v.thumbnail || v.thumbnails?.[v.thumbnails.length - 1]?.url,
      })),
    };
  } catch (err) {
    console.error("ytSearch error:", err.message);
    return { tracks: [] };
  }
}

// ============================================================================
// REUSED FROM BOT — download (progress parsing extended, args untouched)
// ============================================================================

function downloadWithProgress(url, output, onProgress) {
  return new Promise((resolve, reject) => {
    const ytdlp = spawn(YTDLP_BIN, [
      "-f",
      "bestaudio/best",
      "--extract-audio",
      "--audio-format",
      "mp3",
      "-o",
      output,
      "--newline",
      url,
    ]);

    ytdlp.on("error", (err) => {
      reject(err.code === "ENOENT" ? "yt-dlp tidak ditemukan di server" : err.message);
    });

    ytdlp.stdout.on("data", (data) => {
      const text = data.toString();
      // Original bot only pulled the percentage out. The web UI additionally
      // wants transfer speed and ETA, both of which yt-dlp already prints on
      // the same line, e.g.:
      //   [download]  42.1% of 3.45MiB at 512.00KiB/s ETA 00:04
      const match = text.match(
        /(\d+\.\d)%(?:\s+of\s+~?[\d.]+\w+)?\s+at\s+([\d.]+\w+\/s|Unknown\s?speed)\s+ETA\s+([\d:]+|Unknown)/
      );
      if (match) {
        onProgress({
          percent: match[1],
          speed: match[2] && !/unknown/i.test(match[2]) ? match[2] : null,
          eta: match[3] && !/unknown/i.test(match[3]) ? match[3] : null,
        });
      } else {
        const simple = text.match(/(\d+\.\d)%/);
        if (simple) onProgress({ percent: simple[1], speed: null, eta: null });
      }
    });

    ytdlp.on("close", (code) => {
      if (code === 0) resolve(true);
      else reject("Download error code " + code);
    });
  });
}

// ============================================================================
// REUSED FROM BOT — Search That Song (lyrics / song identification)
// ============================================================================

const STS_BASE = "https://searchthatsong.com";
const STS_UA =
  "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 VyrSTS/1.0";

function _stsExtractSessionId(setCookieArr) {
  if (!setCookieArr) return null;
  const cookies = Array.isArray(setCookieArr) ? setCookieArr : [setCookieArr];
  for (const c of cookies) {
    const m = c.match(/session_id=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}

async function _stsRoutePreview(query, sessionCookie = "") {
  const headers = {
    "User-Agent": STS_UA,
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    ...(sessionCookie ? { Cookie: sessionCookie } : {}),
  };
  const res = await axios.post(
    `${STS_BASE}/api/search/route-preview`,
    { query },
    { headers, validateStatus: () => true }
  );
  if (res.status !== 200) throw new Error(`request failed [rp] status=${res.status}`);
  const sid = _stsExtractSessionId(res.headers["set-cookie"]);
  return { route: res.data, sessionId: sid };
}

async function _stsFullSearch(query, routePreview, sessionId = "") {
  const headers = {
    "User-Agent": STS_UA,
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    ...(sessionId ? { Cookie: `session_id=${sessionId}` } : {}),
  };
  const res = await axios.post(
    `${STS_BASE}/`,
    { data: query, route_preview: routePreview, search_mode: "web_search" },
    { headers, validateStatus: () => true }
  );
  if (res.status !== 200) throw new Error(`request failed [fs] status=${res.status}`);
  return res.data;
}

function _stsBuildResult(raw) {
  const a = raw.answer || raw;
  return {
    song: a.song ?? null,
    artist: a.artist ?? null,
    album: a.album ?? null,
    year: a.year_song_released ?? a.year ?? null,
    genre: a.genre ?? null,
    confidence: a.router_confidence ?? null,
    lyrics: a.plain_lyrics && a.plain_lyrics !== "n/a" ? a.plain_lyrics : null,
    relevantChunk:
      a.most_relevant_chunk && a.most_relevant_chunk !== "n/a" ? a.most_relevant_chunk : null,
    previewUrl: a.preview_audio_url ?? null,
    albumArtwork: a.album_artwork_url ?? a.album_artwork ?? null,
    youtubeUrl: a.Youtube_URL ?? a.youtube_url ?? null,
  };
}

async function stsSearch(query) {
  const { route: routeData, sessionId } = await _stsRoutePreview(query, "");
  const sid = sessionId || routeData.session_id;
  const routePreview = routeData.route ?? routeData;
  const fullData = await _stsFullSearch(query, routePreview, sid);
  return _stsBuildResult(fullData);
}

// ============================================================================
// NEW — thin state needed only because HTTP is stateless (Telegram's
// callback_data + in-memory Map did this job before). No search/download
// logic lives here, just bookkeeping so the frontend can refer to a track by
// a short id instead of passing the raw source URL around.
// ============================================================================

const trackCache = new Map(); // trackId -> track object
const fileCache = new Map(); // trackId -> local mp3 path
const jobs = new Map(); // jobId -> { trackId, status, percent, speed, eta, error, listeners:Set }

function makeTrackId() {
  return crypto.randomBytes(8).toString("hex");
}

function ensureDownload(trackId) {
  // Returns { promise, jobId } — promise resolves with the local file path.
  const track = trackCache.get(trackId);
  if (!track) return Promise.reject(new Error("Track tidak ditemukan, coba cari ulang."));

  if (fileCache.has(trackId)) {
    return Promise.resolve(fileCache.get(trackId));
  }

  const output = path.join(AUDIO_DIR, `${trackId}.mp3`);

  return downloadWithProgress(track.url, output, () => {}).then(() => {
    fileCache.set(trackId, output);
    return output;
  });
}

function startDownloadJob(trackId) {
  const track = trackCache.get(trackId);
  if (!track) throw new Error("Track tidak ditemukan, coba cari ulang.");

  const jobId = crypto.randomBytes(8).toString("hex");
  const job = { trackId, status: "pending", percent: "0", speed: null, eta: null, error: null, listeners: new Set() };
  jobs.set(jobId, job);

  const emit = () => {
    for (const send of job.listeners) send(job);
  };

  if (fileCache.has(trackId)) {
    job.status = "done";
    job.percent = "100";
    job.filePath = fileCache.get(trackId);
    setImmediate(emit);
    return jobId;
  }

  const output = path.join(AUDIO_DIR, `${trackId}.mp3`);
  job.status = "downloading";

  downloadWithProgress(track.url, output, (p) => {
    job.percent = p.percent;
    job.speed = p.speed;
    job.eta = p.eta;
    emit();
  })
    .then(() => {
      fileCache.set(trackId, output);
      job.status = "done";
      job.percent = "100";
      job.filePath = output;
      emit();
    })
    .catch((err) => {
      job.status = "error";
      job.error = typeof err === "string" ? err : err.message;
      emit();
    });

  return jobId;
}

// ============================================================================
// Express app
// ============================================================================

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- search -------------------------------------------------------------
app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "Parameter q wajib diisi." });

  try {
    const result = await ytSearch(q);
    const tracks = result.tracks.map((t) => {
      const id = makeTrackId();
      trackCache.set(id, t);
      return {
        id,
        title: t.title,
        uploader: t.uploader,
        duration: t.duration,
        thumbnail: t.thumbnail,
      };
    });
    res.json({ query: q, tracks });
  } catch (err) {
    console.error("/api/search error:", err.message);
    res.status(500).json({ error: "Gagal mencari lagu, coba lagi beberapa saat." });
  }
});

// --- track details --------------------------------------------------------
app.get("/api/track/:id", (req, res) => {
  const track = trackCache.get(req.params.id);
  if (!track) return res.status(404).json({ error: "Track tidak ditemukan, coba cari ulang." });
  res.json({ id: req.params.id, title: track.title, uploader: track.uploader, duration: track.duration, thumbnail: track.thumbnail });
});

// --- lyrics / song info (Search That Song) --------------------------------
app.get("/api/lyrics", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "Parameter q wajib diisi." });

  try {
    const result = await stsSearch(q);
    if (!result.song) {
      return res.status(404).json({ error: "Lagu tidak ditemukan, coba kata kunci yang lebih spesifik." });
    }
    res.json(result);
  } catch (err) {
    console.error("/api/lyrics error:", err.message);
    res.status(502).json({ error: "Terjadi kesalahan saat mencari lagu, server mungkin lagi bermasalah." });
  }
});

// --- streaming (for the in-browser player) --------------------------------
app.get("/api/stream/:id", async (req, res) => {
  const trackId = req.params.id;
  if (!trackCache.has(trackId)) return res.status(404).json({ error: "Track tidak ditemukan." });

  try {
    const filePath = await ensureDownload(trackId);
    const stat = fs.statSync(filePath);
    const range = req.headers.range;

    if (!range) {
      res.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": stat.size, "Accept-Ranges": "bytes" });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": "audio/mpeg",
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } catch (err) {
    console.error("/api/stream error:", err.message || err);
    res.status(502).json({ error: "Gagal menyiapkan audio, coba lagi." });
  }
});

// --- download: kick off a job ---------------------------------------------
app.post("/api/download/:id", (req, res) => {
  try {
    const jobId = startDownloadJob(req.params.id);
    res.json({ jobId });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// --- download: progress stream (SSE) ---------------------------------------
app.get("/api/download/:jobId/events", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).end();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (j) => {
    res.write(`data: ${JSON.stringify({ status: j.status, percent: j.percent, speed: j.speed, eta: j.eta, error: j.error })}\n\n`);
    if (j.status === "done" || j.status === "error") {
      job.listeners.delete(send);
      res.end();
    }
  };

  job.listeners.add(send);
  send(job); // fire immediately with current state

  req.on("close", () => job.listeners.delete(send));
});

// --- download: fetch the finished file --------------------------------
app.get("/api/download/:jobId/file", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== "done") return res.status(404).json({ error: "File belum siap." });

  const track = trackCache.get(job.trackId);
  const niceName = `${(track?.title || "audio").replace(/[^\w\s-]/g, "").slice(0, 80)}.mp3`;
  res.download(job.filePath, niceName);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Frekuensi server jalan di http://localhost:${PORT}`);
});
