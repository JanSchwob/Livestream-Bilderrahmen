/* Fenster – YouTube-Livestream als randloser Bilderrahmen. */
(() => {
  'use strict';

  const OVERLAY_TIMEOUT = 6000;
  const WATCHDOG_INTERVAL = 30 * 1000;
  const STALL_TICKS_BEFORE_RELOAD = 2;
  const MAX_RELOADS = 3;
  const LOAD_TIMEOUT = 20 * 1000;
  const PREFERRED_RETRY_INTERVAL = 60 * 60 * 1000;
  const ALL_FAILED_RETRY = 2 * 60 * 1000;
  const DAILY_RELOAD_HOUR = 4;
  const SWITCH_FADE = 300;
  // YouTube blendet nach dem Start einige Sekunden Titel und Bedienelemente ein;
  // so lange bleibt der Vorhang (mit weichgezeichnetem Vorschaubild) zu.
  const CURTAIN_HOLD = 4500;
  const SOUND_VERIFY_DELAY = 1500;

  const ERRORS_UNAVAILABLE = [101, 150, 153];

  const params = new URLSearchParams(location.search);
  // Für Kiosk-Browser mit erlaubtem Autoplay: Ton ohne ersten Tap wiederherstellen.
  const AUTOSOUND = params.get('autosound') === '1';
  // Zeigt auf den Kacheln den Fehlergrund (z. B. "Fehler 150").
  const DEBUG = params.get('debug') === '1';

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const $ = (sel) => document.querySelector(sel);
  const els = {
    stage: $('#stage'),
    frame: $('#frame'),
    curtain: $('#curtain'),
    curtainImg: $('#curtainImg'),
    tap: $('#tap'),
    notice: $('#notice'),
    overlay: $('#overlay'),
    nowName: $('#nowName'),
    nowMeta: $('#nowMeta'),
    soundBtn: $('#soundBtn'),
    soundHint: $('#soundHint'),
    volume: $('#volume'),
    tiles: $('#tiles'),
  };

  /* ---------- Speicher ---------- */

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('fenster.' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('fenster.' + key, JSON.stringify(value));
      } catch (e) { /* privater Modus o. ä. */ }
    },
  };

  /* ---------- Zustand ---------- */

  let streams = [];
  const status = {};         // id -> 'offline' | 'unavailable'
  const reasons = {};        // id -> letzter Fehlergrund, sichtbar mit ?debug=1
  let preferredId = store.get('streamId', null);
  let soundOn = store.get('soundOn', false) === true;
  let volume = clampVolume(store.get('volume', 80));
  let gestureSeen = AUTOSOUND;
  let soundBlocked = false;

  let player = null;
  let playerReady = false;
  let current = null;
  let loadToken = 0;
  let loadTimer = 0;
  let awaitingPlay = false;
  let lastTime = 0;
  let stallTicks = 0;
  let reloads = 0;
  let allFailedTimer = 0;
  let curtainTimer = 0;
  let verifyTimer = 0;
  let overlayOpen = false;
  let overlayTimer = 0;
  let wakeLock = null;
  const notices = { offline: null, failed: null, start: null };

  function clampVolume(v) {
    v = Number(v);
    return Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 80;
  }

  /* ---------- Start ---------- */

  function loadStreams() {
    return fetch('streams.json', { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error('streams.json: HTTP ' + r.status);
        return r.json();
      })
      .then((list) => {
        const valid = (Array.isArray(list) ? list : []).filter((s) => s && s.id && s.videoId);
        if (!valid.length) throw new Error('streams.json enthält keine Streams');
        return valid;
      });
  }

  let ytPromise = null;
  function loadYouTubeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (ytPromise) return ytPromise;
    ytPromise = new Promise((resolve, reject) => {
      window.onYouTubeIframeAPIReady = resolve;
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        ytPromise = null;
        script.remove();
        reject(new Error('YouTube-API nicht erreichbar'));
      };
      document.head.appendChild(script);
    });
    return ytPromise;
  }

  function boot() {
    Promise.all([loadStreams(), loadYouTubeApi()])
      .then(([list]) => {
        streams = list;
        setNotice('start', null);
        buildTiles();
        const preferred = streams.find((s) => s.id === preferredId) || streams[0];
        preferredId = preferred.id;
        playStream(preferred);
      })
      .catch((err) => {
        console.warn(err);
        setNotice('start', navigator.onLine ? 'Wird geladen …' : null);
        setTimeout(boot, navigator.onLine ? 15000 : 5000);
      });
  }

  /* ---------- Player ---------- */

  function layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ratio = 16 / 9;
    let fw = w;
    let fh = w / ratio;
    if (fh < h) {
      fh = h;
      fw = h * ratio;
    }
    // 2 px Überstand gegen Haarlinien an den Rändern
    fw = Math.ceil(fw) + 2;
    fh = Math.ceil(fh) + 2;
    const s = els.frame.style;
    s.width = fw + 'px';
    s.height = fh + 'px';
    s.left = Math.round((w - fw) / 2) + 'px';
    s.top = Math.round((h - fh) / 2) + 'px';
  }

  function buildPlayer(videoId) {
    if (player) {
      try { player.destroy(); } catch (e) { /* bereits entfernt */ }
    }
    player = null;
    playerReady = false;
    els.frame.innerHTML = '<div id="player"></div>';
    const playerVars = {
      autoplay: 1,
      mute: 1,
      controls: 0,
      disablekb: 1,
      fs: 0,
      rel: 0,
      playsinline: 1,
      iv_load_policy: 3,
      modestbranding: 1,
      cc_load_policy: 0,
      origin: location.origin,
    };
    player = new YT.Player('player', {
      width: '100%',
      height: '100%',
      videoId,
      playerVars,
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError,
      },
    });
  }

  function onPlayerReady() {
    playerReady = true;
    const iframe = player.getIframe && player.getIframe();
    if (iframe) iframe.setAttribute('tabindex', '-1');
    player.mute();
    applySound();
    player.playVideo();
  }

  function onPlayerStateChange(e) {
    const S = YT.PlayerState;
    if (e.data === S.PLAYING) onPlaying();
    else if (e.data === S.ENDED) failCurrent('offline', 'beendet');
  }

  function onPlayerError(e) {
    const kind = ERRORS_UNAVAILABLE.includes(e.data) ? 'unavailable' : 'offline';
    console.warn('YouTube-Fehler', e.data, current && current.id);
    failCurrent(kind, 'Fehler ' + e.data);
  }

  function onPlaying() {
    if (!current) return;
    awaitingPlay = false;
    clearTimeout(loadTimer);
    setStatus(current.id, null);
    setNeedsStart(false);
    lastTime = safeCurrentTime();
    hideCurtain(CURTAIN_HOLD);
    applySound();
  }

  function safeCurrentTime() {
    try { return player.getCurrentTime() || 0; } catch (e) { return 0; }
  }

  function safeState() {
    try { return player.getPlayerState(); } catch (e) { return -1; }
  }

  /* ---------- Streams laden / wechseln ---------- */

  function playStream(stream, opts) {
    opts = opts || {};
    clearTimeout(loadTimer);
    clearTimeout(allFailedTimer);
    setNotice('failed', null);
    const changed = current !== stream;
    current = stream;
    const token = ++loadToken;
    stallTicks = 0;
    if (!opts.reload) reloads = 0;
    awaitingPlay = !opts.reload;
    updateNow();
    updateTiles();

    const curtainWasVisible = els.curtain.classList.contains('is-visible');
    showCurtain();

    const load = () => {
      if (token !== loadToken) return;
      setCurtainImage(stream);
      if (!player || !playerReady) {
        buildPlayer(stream.videoId);
      } else {
        player.loadVideoById(stream.videoId);
        applySound();
      }
      if (awaitingPlay) armLoadTimeout(token);
    };

    if (curtainWasVisible || !changed) load();
    else setTimeout(load, SWITCH_FADE);
  }

  function armLoadTimeout(token) {
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      if (token !== loadToken || !awaitingPlay) return;
      if (!navigator.onLine) return; // das online-Event lädt neu
      const st = playerReady ? safeState() : -1;
      if (st === YT.PlayerState.BUFFERING) {
        failCurrent('offline', 'Zeitüberschreitung');
        return;
      }
      // Kein Fehler, aber nie gestartet: Der Browser blockiert Autoplay (z. B. iPad im
      // Stromsparmodus). Der Stream ist in Ordnung – kein Failover, sondern Tap abwarten.
      console.warn('Autoplay blockiert, Status', st, current && current.id);
      setNeedsStart(true);
    }, LOAD_TIMEOUT);
  }

  // Safari startet Videos im Stromsparmodus nur, wenn der Tap direkt im Player landet.
  // Deshalb lassen wir in diesem Zustand Taps ausnahmsweise zum IFrame durch.
  function setNeedsStart(on) {
    document.body.classList.toggle('needs-start', on);
    if (on) closeOverlay();
    setNotice('start', on ? 'Tippen zum Starten' : null);
  }

  function failCurrent(kind, reason) {
    if (!current) return;
    clearTimeout(loadTimer);
    reasons[current.id] = reason || '';
    // Hinweis: Der Kanal-Fallback über /embed/live_stream?channel=… funktioniert
    // derzeit nicht mehr (YouTube antwortet mit Fehler 150), siehe README.
    setStatus(current.id, kind);
    failover(current);
  }

  function failover(from) {
    const n = streams.length;
    const start = streams.indexOf(from);
    for (let i = 1; i < n; i++) {
      const next = streams[(start + i) % n];
      if (!status[next.id]) {
        playStream(next);
        return;
      }
    }
    // Alles gescheitert: Hinweis zeigen und später von vorne versuchen.
    awaitingPlay = false;
    setNotice('failed', 'Zurzeit ist kein Stream erreichbar');
    clearTimeout(allFailedTimer);
    allFailedTimer = setTimeout(() => {
      resetStatuses(true);
      playStream(preferredStream());
    }, ALL_FAILED_RETRY);
  }

  function preferredStream() {
    return streams.find((s) => s.id === preferredId) || streams[0];
  }

  function resetStatuses(includeCurrent) {
    Object.keys(status).forEach((id) => {
      if (includeCurrent || !current || id !== current.id) delete status[id];
    });
    updateTiles();
  }

  function setStatus(id, value) {
    if (value) status[id] = value;
    else delete status[id];
    updateTiles();
  }

  function selectStream(stream) {
    preferredId = stream.id;
    store.set('streamId', stream.id);
    delete status[stream.id];
    playStream(stream);
  }

  /* ---------- Zuverlässigkeit ---------- */

  function watchdog() {
    if (!current || !playerReady || awaitingPlay || document.hidden || !navigator.onLine) return;
    if (notices.failed) return;
    const st = safeState();
    const t = safeCurrentTime();
    const progressing = t > lastTime;
    lastTime = t;
    if (st === YT.PlayerState.PLAYING && progressing) {
      stallTicks = 0;
      reloads = 0;
      return;
    }
    if (st === YT.PlayerState.PAUSED || st === YT.PlayerState.CUED) player.playVideo();
    stallTicks++;
    if (stallTicks < STALL_TICKS_BEFORE_RELOAD) return;
    stallTicks = 0;
    if (reloads >= MAX_RELOADS) {
      reloads = 0;
      failCurrent('offline');
      return;
    }
    reloads++;
    console.warn('Stream hängt – Neuladen', reloads, current.id);
    playStream(current, { reload: true });
  }

  function retryPreferred() {
    resetStatuses(false);
    const preferred = preferredStream();
    if (preferred && current !== preferred && navigator.onLine) playStream(preferred);
  }

  function scheduleDailyReload() {
    const target = new Date();
    target.setHours(DAILY_RELOAD_HOUR, 0, 0, 0);
    if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
    const at = target.getTime();
    setInterval(() => {
      if (Date.now() < at || !navigator.onLine) return;
      // Nur neu laden, wenn die Seite erreichbar ist – sonst bliebe eine Fehlerseite stehen.
      fetch(location.pathname + '?ping=' + Date.now(), { method: 'HEAD', cache: 'no-store' })
        .then((r) => { if (r.ok) location.reload(); })
        .catch(() => {});
    }, 60 * 1000);
  }

  function requestWakeLock() {
    if (!('wakeLock' in navigator) || document.hidden || wakeLock) return;
    navigator.wakeLock.request('screen')
      .then((lock) => {
        wakeLock = lock;
        lock.addEventListener('release', () => { wakeLock = null; });
      })
      .catch(() => {});
  }

  function maybeFullscreen() {
    if (window.fully) return; // Fully Kiosk regelt Vollbild selbst
    const standalone = window.navigator.standalone === true ||
      window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
    if (standalone || document.fullscreenElement || document.webkitFullscreenElement) return;
    const el = document.documentElement;
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!request) return;
    try {
      const p = request.call(el, { navigationUI: 'hide' });
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* nicht erlaubt */ }
  }

  /* ---------- Ton ---------- */

  function soundAudible() {
    if (!playerReady || !soundOn) return false;
    try { return !player.isMuted(); } catch (e) { return false; }
  }

  // Bringt den Player in den gespeicherten Tonzustand, soweit der Browser es erlaubt.
  function applySound() {
    if (!playerReady) return;
    try {
      if (soundOn && gestureSeen && !soundBlocked) {
        if (player.isMuted()) unmuteNow();
        else player.setVolume(volume);
      } else if (!player.isMuted()) {
        player.mute();
      }
    } catch (e) { /* Player noch nicht bereit */ }
    updateSoundUI();
  }

  function unmuteNow() {
    if (!playerReady) return;
    player.unMute();
    player.setVolume(volume);
    const st = safeState();
    if (st !== YT.PlayerState.PLAYING && st !== YT.PlayerState.BUFFERING) player.playVideo();
    verifySound();
  }

  // Manche Browser pausieren das Video, wenn der Ton ohne Geste eingeschaltet wird.
  // Dann zurück auf stumm, weiterspielen und "Tippen für Ton" anzeigen.
  function verifySound(attempt) {
    attempt = attempt || 0;
    clearTimeout(verifyTimer);
    verifyTimer = setTimeout(() => {
      if (!playerReady || !soundOn) return;
      const st = safeState();
      // Während ein Stream noch lädt, ist das Ergebnis nicht aussagekräftig.
      if ((st === -1 || st === YT.PlayerState.BUFFERING || awaitingPlay) && attempt < 10) {
        verifySound(attempt + 1);
        return;
      }
      let muted = true;
      try { muted = player.isMuted(); } catch (e) { /* ignorieren */ }
      if (muted || st === YT.PlayerState.PAUSED || st === YT.PlayerState.CUED) {
        soundBlocked = true;
        player.mute();
        player.playVideo();
      }
      updateSoundUI();
    }, SOUND_VERIFY_DELAY);
  }

  function toggleSound() {
    gestureSeen = true;
    soundBlocked = false;
    if (soundAudible()) {
      soundOn = false;
      clearTimeout(verifyTimer);
      if (playerReady) player.mute();
    } else {
      soundOn = true;
      unmuteNow();
    }
    store.set('soundOn', soundOn);
    updateSoundUI();
  }

  function updateSoundUI() {
    const audible = soundAudible();
    els.soundBtn.classList.toggle('is-on', audible);
    els.soundBtn.setAttribute('aria-label', audible ? 'Ton ausschalten' : 'Ton einschalten');
    // Hinweis nur, wenn der Browser den Ton (noch) verweigert – nicht während des Einschaltens.
    els.soundHint.hidden = !(soundOn && !audible && (!gestureSeen || soundBlocked));
    els.volume.disabled = !audible;
  }

  function onVolumeInput() {
    volume = clampVolume(els.volume.value);
    store.set('volume', volume);
    if (soundAudible()) player.setVolume(volume);
    bumpOverlay();
  }

  // Erster (und jeder weitere) Tap: Nutzergeste für Ton, Vollbild und Wake Lock nutzen.
  function onAnyGesture(e) {
    requestWakeLock();
    maybeFullscreen();
    if (e.target.closest && e.target.closest('#soundBtn')) return;
    if (!playerReady) {
      gestureSeen = true;
      return;
    }
    const st = safeState();
    if (st === YT.PlayerState.CUED || st === YT.PlayerState.PAUSED || st === -1) {
      player.playVideo();
      setNotice('start', null);
    }
    if (!gestureSeen || soundBlocked) {
      gestureSeen = true;
      soundBlocked = false;
      if (soundOn) unmuteNow();
    }
  }

  /* ---------- Overlay ---------- */

  function openOverlay() {
    overlayOpen = true;
    els.overlay.classList.add('is-open');
    els.overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('overlay-open');
    refreshThumbs();
    updateNow();
    updateTiles();
    updateSoundUI();
    scrollActiveIntoView();
    bumpOverlay();
  }

  function closeOverlay() {
    overlayOpen = false;
    clearTimeout(overlayTimer);
    els.overlay.classList.remove('is-open');
    els.overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('overlay-open');
  }

  function bumpOverlay() {
    if (!overlayOpen) return;
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(closeOverlay, OVERLAY_TIMEOUT);
  }

  /* ---------- Kacheln ---------- */

  const timeFormats = {};
  function localTime(tz) {
    if (!tz) return '';
    try {
      const fmt = timeFormats[tz] || (timeFormats[tz] = new Intl.DateTimeFormat('de-CH', {
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz,
      }));
      return fmt.format(new Date());
    } catch (e) {
      return '';
    }
  }

  function metaText(stream) {
    return [stream.country, localTime(stream.timezone)].filter(Boolean).join(' · ');
  }

  function buildTiles() {
    els.tiles.innerHTML = '';
    streams.forEach((stream) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tile';
      tile.setAttribute('role', 'listitem');
      tile.dataset.id = stream.id;
      tile.innerHTML =
        '<div class="tile__thumb"><img alt="" draggable="false"><span class="tile__badge"></span></div>' +
        '<div class="tile__name"></div><div class="tile__meta"></div>';
      tile.querySelector('.tile__name').textContent = stream.name;
      tile.addEventListener('click', () => {
        bumpOverlay();
        selectStream(stream);
      });
      els.tiles.appendChild(tile);
    });
  }

  function updateTiles() {
    els.tiles.querySelectorAll('.tile').forEach((tile) => {
      const stream = streams.find((s) => s.id === tile.dataset.id);
      if (!stream) return;
      const active = current === stream;
      const state = status[stream.id];
      tile.classList.toggle('is-active', active);
      tile.classList.toggle('is-down', !!state && !active);
      let badge = active ? 'Läuft' : state === 'unavailable' ? 'nicht verfügbar' : state === 'offline' ? 'offline' : '';
      if (DEBUG && state && reasons[stream.id]) badge += ' · ' + reasons[stream.id];
      tile.querySelector('.tile__badge').textContent = badge;
      tile.querySelector('.tile__meta').textContent = metaText(stream);
    });
  }

  function refreshThumbs() {
    const bust = Date.now();
    els.tiles.querySelectorAll('.tile').forEach((tile) => {
      const stream = streams.find((s) => s.id === tile.dataset.id);
      if (!stream) return;
      const vid = stream.videoId;
      const img = tile.querySelector('img');
      let fellBack = false;
      img.onerror = () => {
        if (fellBack) return;
        fellBack = true;
        img.src = 'https://i.ytimg.com/vi/' + vid + '/hqdefault.jpg?t=' + bust;
      };
      img.src = 'https://i.ytimg.com/vi/' + vid + '/hqdefault_live.jpg?t=' + bust;
    });
  }

  function scrollActiveIntoView() {
    const tile = els.tiles.querySelector('.tile.is-active');
    if (!tile) return;
    const row = els.tiles;
    const left = tile.offsetLeft - (row.clientWidth - tile.offsetWidth) / 2;
    row.scrollLeft = Math.max(0, left);
  }

  function updateNow() {
    if (!current) return;
    els.nowName.textContent = current.name;
    els.nowMeta.textContent = metaText(current);
  }

  /* ---------- Hinweise / Vorhang ---------- */

  function setNotice(key, text) {
    notices[key] = text;
    const shown = notices.offline || notices.failed || notices.start;
    els.notice.textContent = shown || '';
    els.notice.hidden = !shown;
  }

  function showCurtain() {
    clearTimeout(curtainTimer);
    els.curtain.classList.add('is-visible');
  }

  function setCurtainImage(stream) {
    const img = els.curtainImg;
    const base = 'https://i.ytimg.com/vi/' + stream.videoId + '/';
    const bust = '?t=' + Date.now();
    let fellBack = false;
    img.classList.remove('is-loaded');
    img.onload = () => img.classList.add('is-loaded');
    img.onerror = () => {
      if (fellBack) return;
      fellBack = true;
      img.src = base + 'mqdefault.jpg' + bust;
    };
    // mqdefault ist 16:9 ohne schwarze Balken; die Auflösung reicht, weil es weichgezeichnet wird.
    img.src = base + 'mqdefault_live.jpg' + bust;
  }

  function hideCurtain(delay) {
    clearTimeout(curtainTimer);
    curtainTimer = setTimeout(() => els.curtain.classList.remove('is-visible'), delay || 0);
  }

  /* ---------- Ereignisse ---------- */

  function preventDefault(e) { e.preventDefault(); }

  els.tap.addEventListener('click', () => {
    if (overlayOpen) closeOverlay();
    else openOverlay();
  });

  document.addEventListener('click', onAnyGesture, true);
  els.soundBtn.addEventListener('click', () => {
    bumpOverlay();
    toggleSound();
  });
  els.volume.value = String(volume);
  els.volume.hidden = isIOS; // iOS ignoriert programmatische Lautstärke
  els.volume.addEventListener('input', onVolumeInput);
  els.tiles.addEventListener('scroll', bumpOverlay, { passive: true });
  els.overlay.addEventListener('pointerdown', bumpOverlay);

  // Kein Zoom, kein Bounce, kein Long-Press-Menü
  document.addEventListener('gesturestart', preventDefault);
  document.addEventListener('dblclick', preventDefault);
  document.addEventListener('contextmenu', preventDefault);
  document.addEventListener('touchmove', (e) => {
    if (!e.target.closest || !e.target.closest('.tiles, .sound__volume')) e.preventDefault();
  }, { passive: false });

  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);

  window.addEventListener('offline', () => setNotice('offline', 'Keine Internetverbindung'));
  window.addEventListener('online', () => {
    setNotice('offline', null);
    if (current) playStream(current);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    requestWakeLock();
    if (playerReady && safeState() !== YT.PlayerState.PLAYING) player.playVideo();
    lastTime = safeCurrentTime();
    stallTicks = 0;
  });

  setInterval(watchdog, WATCHDOG_INTERVAL);
  setInterval(retryPreferred, PREFERRED_RETRY_INTERVAL);
  setInterval(() => {
    updateNow();
    if (overlayOpen) updateTiles();
  }, 15 * 1000);

  // Für die Fehlersuche in der Browser-Konsole
  window.fenster = {
    get player() { return player; },
    get current() { return current; },
    status,
    reasons,
  };

  layout();
  updateSoundUI();
  if (!navigator.onLine) setNotice('offline', 'Keine Internetverbindung');
  requestWakeLock();
  scheduleDailyReload();
  boot();
})();
