(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  const state = {
    queue: [],          // array of track objects currently playing through
    currentIndex: -1,
    shuffle: false,
    repeat: "off",       // off | all | one
    favorites: new Set(JSON.parse(localStorage.getItem("frekuensi:favorites") || "[]")),
    recent: JSON.parse(localStorage.getItem("frekuensi:recent") || "[]"),
    lastResults: [],
  };

  const trending = [
    { q: "lofi hujan malam", label: "Lofi hujan malam", note: "buat nemenin ngantuk" },
    { q: "akustik indie indonesia", label: "Akustik indie", note: "santai sore-sore" },
    { q: "dangdut koplo remix", label: "Koplo remix", note: "buat yang niat goyang" },
    { q: "city pop jepang 80an", label: "City pop 80an", note: "nostalgia tanpa nostalgia" },
    { q: "lagu galau2000an", label: "Galau 2000-an", note: "siapin tisu" },
    { q: "jazz kafe malam", label: "Jazz kafe", note: "kerja sambil santai" },
  ];

  // ---------------------------------------------------------------------
  // Shorthand DOM helpers
  // ---------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const audio = $("#audioEl");

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function toast(message, isError = false) {
    const root = $("#toastRoot");
    const el = document.createElement("div");
    el.className = "toast" + (isError ? " is-error" : "");
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateY(8px)"; }, 2600);
    setTimeout(() => el.remove(), 3000);
  }

  // ---------------------------------------------------------------------
  // View switching (home / search) — single page, no reload
  // ---------------------------------------------------------------------
  function setView(name) {
    $$(".view").forEach((v) => v.classList.remove("is-active"));
    $(`#view-${name}`).classList.add("is-active");
    $$(".nav-link").forEach((b) => b.classList.toggle("is-active", b.dataset.view === name));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $$(".nav-link").forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.view)));
  $('[data-action="go-home"]').addEventListener("click", () => setView("home"));

  // ---------------------------------------------------------------------
  // Recently searched (localStorage)
  // ---------------------------------------------------------------------
  function pushRecent(q) {
    state.recent = [q, ...state.recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 8);
    localStorage.setItem("frekuensi:recent", JSON.stringify(state.recent));
    renderRecent();
  }

  function renderRecent() {
    const section = $("#recentSection");
    const row = $("#recentChips");
    row.innerHTML = "";
    if (!state.recent.length) { section.hidden = true; return; }
    section.hidden = false;
    state.recent.forEach((q) => {
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.textContent = q;
      chip.addEventListener("click", () => runSearch(q));
      row.appendChild(chip);
    });
  }

  // ---------------------------------------------------------------------
  // Trending rail
  // ---------------------------------------------------------------------
  function renderTrending() {
    const rail = $("#trendingRail");
    rail.innerHTML = "";
    trending.forEach((t) => {
      const card = document.createElement("div");
      card.className = "rail-card";
      card.innerHTML = `<div class="rail-emoji">📻</div><h4>${t.label}</h4><p>${t.note}</p>`;
      card.addEventListener("click", () => runSearch(t.q));
      rail.appendChild(card);
    });
  }

  // ---------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------
  const trackCardTpl = $("#trackCardTpl");

  async function runSearch(query) {
    query = query.trim();
    if (!query) return;

    setView("search");
    $("#searchHeading").textContent = `Hasil untuk "${query}"`;
    $("#searchMeta").textContent = "";
    $("#trackGrid").innerHTML = "";
    $("#searchEmpty").hidden = true;
    $("#searchSkeleton").hidden = false;

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      $("#searchSkeleton").hidden = true;

      if (!res.ok || !data.tracks || !data.tracks.length) {
        $("#searchEmpty").hidden = false;
        $("#searchMeta").textContent = "0 hasil";
        return;
      }

      state.lastResults = data.tracks;
      pushRecent(query);
      $("#searchMeta").textContent = `${data.tracks.length} hasil`;
      renderTrackGrid(data.tracks);
    } catch (err) {
      $("#searchSkeleton").hidden = true;
      $("#searchEmpty").hidden = false;
      toast("Gagal terhubung ke server pencarian.", true);
    }
  }

  function renderTrackGrid(tracks) {
    const grid = $("#trackGrid");
    grid.innerHTML = "";
    tracks.forEach((track, i) => grid.appendChild(buildTrackCard(track, tracks, i)));
  }

  function buildTrackCard(track, list, index) {
    const node = trackCardTpl.content.firstElementChild.cloneNode(true);
    const img = $("img", node);
    img.src = track.thumbnail || "";
    img.alt = track.title;
    $('[data-role="title"]', node).textContent = track.title;
    $('[data-role="artist"]', node).textContent = track.uploader || "Tidak diketahui";
    $('[data-role="duration"]', node).textContent = track.duration ? fmtTime(track.duration) : "—";

    const favBtn = $('[data-role="favorite"]', node);
    favBtn.classList.toggle("is-active", state.favorites.has(track.id));
    favBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleFavorite(track.id, favBtn); });

    $('[data-role="info"]', node).addEventListener("click", (e) => { e.stopPropagation(); openDetails(track); });
    $('[data-role="download"]', node).addEventListener("click", (e) => { e.stopPropagation(); openDownload(track); });

    const playHandler = () => playFromList(list, index);
    $('[data-role="play"]', node).addEventListener("click", (e) => { e.stopPropagation(); playHandler(); });
    node.addEventListener("click", playHandler);

    return node;
  }

  function toggleFavorite(id, btnEl) {
    if (state.favorites.has(id)) state.favorites.delete(id);
    else state.favorites.add(id);
    localStorage.setItem("frekuensi:favorites", JSON.stringify([...state.favorites]));
    if (btnEl) btnEl.classList.toggle("is-active", state.favorites.has(id));
    syncMiniFavButton();
  }

  // ---------------------------------------------------------------------
  // Song details modal (uses existing Search That Song lyrics endpoint)
  // ---------------------------------------------------------------------
  async function openDetails(track) {
    const modal = $("#detailsModal");
    modal.hidden = false;
    $("#detailsArt").src = track.thumbnail || "";
    $("#detailsTitle").textContent = track.title;
    $("#detailsArtist").textContent = track.uploader || "Tidak diketahui";
    $("#detailsFacts").innerHTML = `<dt>Durasi</dt><dd>${track.duration ? fmtTime(track.duration) : "—"}</dd>`;
    $("#detailsLyricsWrap").hidden = true;
    $("#detailsStatus").textContent = "Mencari info lagu…";

    try {
      const q = `${track.title} ${track.uploader || ""}`.trim();
      const res = await fetch(`/api/lyrics?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) {
        $("#detailsStatus").textContent = data.error || "Info tidak ditemukan.";
        return;
      }
      $("#detailsStatus").textContent = "";
      if (data.albumArtwork) $("#detailsArt").src = data.albumArtwork;

      const facts = [];
      if (data.artist) facts.push(["Artis", data.artist]);
      if (data.album) facts.push(["Album", data.album]);
      if (data.year) facts.push(["Tahun", data.year]);
      if (data.genre) facts.push(["Genre", data.genre]);
      if (data.confidence) facts.push(["Akurasi", `${data.confidence}%`]);
      $("#detailsFacts").innerHTML = facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");

      if (data.lyrics) {
        $("#detailsLyricsWrap").hidden = false;
        $("#detailsLyrics").textContent = data.lyrics;
      } else if (data.relevantChunk) {
        $("#detailsLyricsWrap").hidden = false;
        $("#detailsLyrics").textContent = data.relevantChunk;
      }
    } catch (err) {
      $("#detailsStatus").textContent = "Gagal mengambil info lagu.";
    }
  }

  // ---------------------------------------------------------------------
  // Download flow: POST job -> SSE progress -> file
  // ---------------------------------------------------------------------
  function openDownload(track) {
    const modal = $("#downloadModal");
    modal.hidden = false;
    $("#dlIdle").hidden = false;
    $("#dlSuccess").hidden = true;
    $("#dlError").hidden = true;
    $("#dlTitle").textContent = `Menyiapkan “${track.title}”…`;
    setRing(0);
    $("#dlSpeed").textContent = "— KB/s";
    $("#dlEta").textContent = "ETA —";

    fetch(`/api/download/${track.id}`, { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        if (!data.jobId) throw new Error(data.error || "Gagal memulai unduhan");
        const es = new EventSource(`/api/download/${data.jobId}/events`);
        es.onmessage = (ev) => {
          const p = JSON.parse(ev.data);
          if (p.status === "error") {
            es.close();
            $("#dlIdle").hidden = true;
            $("#dlError").hidden = false;
            $("#dlErrorText").textContent = p.error || "Gagal mengunduh.";
            return;
          }
          setRing(parseFloat(p.percent || 0));
          $("#dlSpeed").textContent = p.speed ? `${p.speed}` : "— KB/s";
          $("#dlEta").textContent = p.eta ? `ETA ${p.eta}` : "ETA —";
          if (p.status === "done") {
            es.close();
            $("#dlIdle").hidden = true;
            $("#dlSuccess").hidden = false;
            $("#dlSaveBtn").onclick = () => {
              window.location.href = `/api/download/${data.jobId}/file`;
            };
          }
        };
        es.onerror = () => {
          es.close();
        };
      })
      .catch((err) => {
        $("#dlIdle").hidden = true;
        $("#dlError").hidden = false;
        $("#dlErrorText").textContent = err.message || "Gagal mengunduh.";
      });
  }

  function setRing(percent) {
    const circumference = 276.5;
    const offset = circumference - (circumference * percent) / 100;
    $("#dlRingFill").style.strokeDashoffset = offset;
    $("#dlPercentLabel").textContent = `${Math.round(percent)}%`;
  }

  // ---------------------------------------------------------------------
  // Player
  // ---------------------------------------------------------------------
  function playFromList(list, index) {
    state.queue = list.slice();
    state.currentIndex = index;
    loadCurrent(true);
    renderQueue();
  }

  function loadCurrent(autoplay) {
    const track = state.queue[state.currentIndex];
    if (!track) return;

    audio.src = `/api/stream/${track.id}`;
    $("#miniPlayer").hidden = false;

    [["#miniArt", "src"], ["#fullArt", "src"]].forEach(([sel, attr]) => { $(sel)[attr] = track.thumbnail || ""; });
    $("#miniTitle").textContent = track.title;
    $("#miniArtist").textContent = track.uploader || "Tidak diketahui";
    $("#fullTitle").textContent = track.title;
    $("#fullArtist").textContent = track.uploader || "Tidak diketahui";
    $("#fullBg").style.backgroundImage = `url("${track.thumbnail || ""}")`;
    syncMiniFavButton();

    if (autoplay) audio.play().catch(() => {});
    updatePlayIcons();
    renderQueue();
  }

  function updatePlayIcons() {
    const playing = !audio.paused && !audio.ended;
    const playSvg = '<path d="M8 5v14l11-7z"/>';
    const pauseSvg = '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>';
    $("#miniPlayIcon").innerHTML = playing ? pauseSvg : playSvg;
    $("#fullPlayIcon").innerHTML = playing ? pauseSvg : playSvg;
    $("#miniEq").classList.toggle("is-playing", playing);
    $("#fullEq").classList.toggle("is-playing", playing);
    $("#fullArt").classList.toggle("is-spinning", playing);
  }

  function togglePlay() {
    if (!audio.src) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  function playNext(manual) {
    if (!state.queue.length) return;
    if (state.repeat === "one" && !manual) { audio.currentTime = 0; audio.play(); return; }

    if (state.shuffle) {
      let next = Math.floor(Math.random() * state.queue.length);
      if (state.queue.length > 1 && next === state.currentIndex) next = (next + 1) % state.queue.length;
      state.currentIndex = next;
    } else {
      state.currentIndex += 1;
      if (state.currentIndex >= state.queue.length) {
        if (state.repeat === "all") state.currentIndex = 0;
        else { state.currentIndex = state.queue.length - 1; return; }
      }
    }
    loadCurrent(true);
  }

  function playPrev() {
    if (!state.queue.length) return;
    if (audio.currentTime > 4) { audio.currentTime = 0; return; }
    state.currentIndex = Math.max(0, state.currentIndex - 1);
    loadCurrent(true);
  }

  function syncMiniFavButton() {
    const track = state.queue[state.currentIndex];
    $("#miniFavBtn").classList.toggle("is-active", !!track && state.favorites.has(track.id));
  }

  audio.addEventListener("play", updatePlayIcons);
  audio.addEventListener("pause", updatePlayIcons);
  audio.addEventListener("ended", () => playNext(false));
  audio.addEventListener("timeupdate", () => {
    const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    $("#miniProgressFill").style.width = `${pct}%`;
    $("#fullSeek").value = pct || 0;
    $("#fullCurrent").textContent = fmtTime(audio.currentTime);
    $("#fullDuration").textContent = fmtTime(audio.duration || 0);
  });
  audio.addEventListener("error", () => toast("Gagal memuat audio, coba lagu lain.", true));

  $("#miniPlayBtn").addEventListener("click", togglePlay);
  $("#fullPlayBtn").addEventListener("click", togglePlay);
  $("#miniNextBtn").addEventListener("click", () => playNext(true));
  $("#fullNextBtn").addEventListener("click", () => playNext(true));
  $("#miniPrevBtn").addEventListener("click", playPrev);
  $("#fullPrevBtn").addEventListener("click", playPrev);
  $("#miniFavBtn").addEventListener("click", () => {
    const track = state.queue[state.currentIndex];
    if (track) toggleFavorite(track.id, null);
    syncMiniFavButton();
  });

  $("#fullShuffleBtn").addEventListener("click", () => {
    state.shuffle = !state.shuffle;
    $("#fullShuffleBtn").classList.toggle("is-active", state.shuffle);
    toast(state.shuffle ? "Acak: nyala" : "Acak: mati");
  });

  $("#fullRepeatBtn").addEventListener("click", () => {
    state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
    $("#fullRepeatBtn").classList.toggle("is-active", state.repeat !== "off");
    toast(state.repeat === "off" ? "Ulangi: mati" : state.repeat === "all" ? "Ulangi: semua" : "Ulangi: satu lagu");
  });

  $("#fullSeek").addEventListener("input", (e) => {
    if (audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration;
  });

  $("#volumeSlider").addEventListener("input", (e) => { audio.volume = e.target.value / 100; });
  audio.volume = 0.8;

  $("#speedSelect").addEventListener("change", (e) => { audio.playbackRate = parseFloat(e.target.value); });

  // Fullscreen player open/close
  function openFullPlayer() { if (state.queue.length) $("#fullPlayer").hidden = false; }
  $("#miniExpandBtn").addEventListener("click", openFullPlayer);
  $("#miniExpandBtn2").addEventListener("click", openFullPlayer);
  $("#collapsePlayerBtn").addEventListener("click", () => { $("#fullPlayer").hidden = true; });

  // ---------------------------------------------------------------------
  // Queue drawer
  // ---------------------------------------------------------------------
  function renderQueue() {
    const list = $("#queueList");
    list.innerHTML = "";
    state.queue.forEach((track, i) => {
      const li = document.createElement("li");
      li.className = "queue-item" + (i === state.currentIndex ? " is-current" : "");
      li.innerHTML = `<img src="${track.thumbnail || ""}" alt="" /><div><div class="qi-title">${track.title}</div><div class="qi-artist">${track.uploader || ""}</div></div>`;
      li.addEventListener("click", () => { state.currentIndex = i; loadCurrent(true); });
      list.appendChild(li);
    });
  }

  $("#queueToggleBtn").addEventListener("click", () => { $("#queueDrawer").hidden = false; });
  $("[data-close-queue]").addEventListener("click", () => { $("#queueDrawer").hidden = true; });

  // ---------------------------------------------------------------------
  // Generic modal close (details / download)
  // ---------------------------------------------------------------------
  $$("[data-close]").forEach((btn) => btn.addEventListener("click", (e) => { e.target.closest(".modal-scrim").hidden = true; }));
  $$(".modal-scrim").forEach((scrim) => scrim.addEventListener("click", (e) => { if (e.target === scrim) scrim.hidden = true; }));

  // ---------------------------------------------------------------------
  // Search forms
  // ---------------------------------------------------------------------
  $("#heroSearchForm").addEventListener("submit", (e) => { e.preventDefault(); runSearch($("#heroSearchInput").value); });
  $("#topSearchForm").addEventListener("submit", (e) => { e.preventDefault(); runSearch($("#topSearchInput").value); });

  // ---------------------------------------------------------------------
  // Ambient floating-particles background
  // ---------------------------------------------------------------------
  function initParticles() {
    const canvas = $("#particles");
    const ctx = canvas.getContext("2d");
    let particles = [];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    const count = window.innerWidth < 700 ? 26 : 50;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.8 + 0.4,
        vy: Math.random() * 0.25 + 0.05,
        vx: (Math.random() - 0.5) * 0.15,
        a: Math.random() * 0.5 + 0.15,
      });
    }

    function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      for (const p of particles) {
        p.y -= p.vy; p.x += p.vx;
        if (p.y < -4) { p.y = canvas.height + 4; p.x = Math.random() * canvas.width; }
        ctx.globalAlpha = p.a;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(tick);
    }
    tick();
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  renderTrending();
  renderRecent();
  initParticles();
})();
