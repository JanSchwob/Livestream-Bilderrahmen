/* Fenster – YouTube-Livestream im Bilderrahmen (Variante 1b „Wohnlich“). */
(() => {
  'use strict';

  const ART_W = 1194;
  const ART_H = 834;
  const MAT_COLORS = { creme: '#ece2d0', weiss: '#f5f3ee', anthrazit: '#2a2623' };
  const MAT_WIDTHS = { s: 36, m: 64, l: 104 };
  const BEVEL_LIGHT = '0 0 0 2px rgba(255,255,255,.7), 0 0 0 3px rgba(60,40,20,.25), inset 0 2px 6px rgba(0,0,0,.35)';
  const BEVEL_DARK = '0 0 0 2px rgba(255,255,255,.12), 0 0 0 3px rgba(0,0,0,.5)';

  const WATCHDOG_INTERVAL = 30 * 1000;
  const STALL_TICKS_BEFORE_RELOAD = 2;
  const MAX_RELOADS = 3;
  const LOAD_TIMEOUT = 20 * 1000;
  const PREFERRED_RETRY_INTERVAL = 60 * 60 * 1000;
  const ALL_FAILED_RETRY = 2 * 60 * 1000;
  const DAILY_RELOAD_HOUR = 4;
  const SWITCH_FADE = 600;
  // YouTube blendet nach dem Start einige Sekunden Titel und Bedienelemente ein;
  // so lange bleibt der Vorhang (mit weichgezeichnetem Vorschaubild) zu.
  const CURTAIN_HOLD = 4500;
  const SOUND_VERIFY_DELAY = 1500;
  const NOTICE_DURATION = 6000;
  const SEARCH_DEBOUNCE = 300;

  const ERRORS_UNAVAILABLE = [101, 150, 153];

  const DEFAULT_SETTINGS = {
    mat: true,
    matColor: 'creme',
    matSize: 'm',
    night: false,
    hideAfter: 5,
    startSound: 'stumm',
    rotate: 'aus',
  };

  const params = new URLSearchParams(location.search);
  // Für Kiosk-Browser mit erlaubtem Autoplay: Ton ohne ersten Tap.
  const AUTOSOUND = params.get('autosound') === '1';
  // Zeigt oben links ein Protokoll der Player-Ereignisse.
  const DEBUG = params.get('debug') === '1';

  const $ = (sel) => document.querySelector(sel);
  const els = {
    stage: $('#stage'),
    win: $('#win'),
    frame: $('#frame'),
    curtain: $('#curtain'),
    curtainImg: $('#curtainImg'),
    tap: $('#tap'),
    ui: $('#ui'),
    overlay: $('#overlay'),
    favList: $('#favList'),
    curTitle: $('#curTitle'),
    curLoc: $('#curLoc'),
    menuBtn: $('#menuBtn'),
    soundBtn: $('#soundBtn'),
    notice: $('#notice'),
    screens: {
      menu: $('#screen-menu'),
      search: $('#screen-search'),
      settings: $('#screen-settings'),
    },
    countLabel: $('#countLabel'),
    grid: $('#grid'),
    emptyFav: $('#emptyFav'),
    q: $('#q'),
    resultLabel: $('#resultLabel'),
    results: $('#results'),
    preview: $('#preview'),
    previewWin: $('#previewWin'),
    previewImg: $('#previewImg'),
    previewCaption: $('#previewCaption'),
    settingsList: $('#settingsList'),
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
  let favorites = [];
  let settings = Object.assign({}, DEFAULT_SETTINGS, store.get('settings', {}));
  let apiKey = store.get('apiKey', '');
  let preferredId = store.get('currentId', null);
  let screen = 'live';
  let filter = 'all';

  const status = {};         // id -> 'offline' | 'unavailable'
  const reasons = {};        // id -> letzter Fehlergrund (Debug)
  let wantSound = AUTOSOUND || settings.startSound === 'ton';
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
  let scale = 1;
  let rotateKey = '';
  const notices = { offline: null, failed: null, start: null, info: null };
  let infoTimer = 0;

  /* ---------- Start ---------- */

  function sanitizeStreams(list) {
    return (Array.isArray(list) ? list : [])
      .filter((s) => s && typeof s.id === 'string' && /^[\w-]{11}$/.test(s.id))
      .map((s) => ({ id: s.id, title: String(s.title || 'Livestream'), location: String(s.location || '') }));
  }

  function loadDefaultStreams() {
    return fetch('streams.json', { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error('streams.json: HTTP ' + r.status);
        return r.json();
      })
      .then((list) => {
        const valid = sanitizeStreams(list);
        if (!valid.length) throw new Error('streams.json enthält keine Streams');
        return valid;
      });
  }

  function loadStreams() {
    const saved = sanitizeStreams(store.get('streams', null));
    if (saved.length) return Promise.resolve(saved);
    return loadDefaultStreams().then((list) => {
      store.set('streams', list);
      return list;
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
        const savedFavs = store.get('favorites', null);
        favorites = Array.isArray(savedFavs)
          ? savedFavs.filter((id) => streams.some((s) => s.id === id))
          : streams.slice(0, 3).map((s) => s.id);
        setNotice('start', null);
        rotateKey = rotationKey();
        renderFavbar();
        playStream(preferredStream());
      })
      .catch((err) => {
        console.warn(err);
        setNotice('start', navigator.onLine ? 'Wird geladen …' : null);
        setTimeout(boot, navigator.onLine ? 15000 : 5000);
      });
  }

  function findStream(id) {
    return streams.find((s) => s.id === id) || null;
  }

  function preferredStream() {
    return findStream(preferredId) || streams[0];
  }

  /* ---------- Layout ---------- */

  function layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    scale = Math.min(w / ART_W, h / ART_H);

    // UI-Ebene: Artboard-Masse, auf die Gerätegrösse skaliert
    const ui = els.ui.style;
    ui.width = w / scale + 'px';
    ui.height = h / scale + 'px';
    ui.transform = 'scale(' + scale + ')';

    // Passepartout
    const mat = settings.mat ? Math.round(MAT_WIDTHS[settings.matSize] * scale) : 0;
    const matColor = MAT_COLORS[settings.matColor];
    const bevel = !settings.mat ? 'none' : settings.matColor === 'anthrazit' ? BEVEL_DARK : BEVEL_LIGHT;
    els.stage.style.background = matColor;
    els.win.style.inset = mat + 'px';
    els.win.style.boxShadow = bevel;
    els.preview.style.background = matColor;
    els.previewWin.style.inset = (settings.mat ? Math.round(MAT_WIDTHS[settings.matSize] * 0.3) : 0) + 'px';
    els.previewWin.style.boxShadow = bevel;

    // Video füllt den Ausschnitt immer (Cover), 2 px Überstand gegen Haarlinien
    const ww = w - 2 * mat;
    const wh = h - 2 * mat;
    let fw = Math.max(ww, wh * 16 / 9);
    let fh = fw * 9 / 16;
    fw = Math.ceil(fw) + 2;
    fh = Math.ceil(fh) + 2;
    const s = els.frame.style;
    s.width = fw + 'px';
    s.height = fh + 'px';
    s.left = Math.round((ww - fw) / 2) + 'px';
    s.top = Math.round((wh - fh) / 2) + 'px';
  }

  /* ---------- Player ---------- */

  function buildPlayer(videoId) {
    if (player) {
      try { player.destroy(); } catch (e) { /* bereits entfernt */ }
    }
    player = null;
    playerReady = false;
    els.frame.innerHTML = '<div id="player"></div>';
    player = new YT.Player('player', {
      width: '100%',
      height: '100%',
      videoId,
      playerVars: {
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
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError,
      },
    });
  }

  function onPlayerReady() {
    playerReady = true;
    log('bereit');
    const iframe = player.getIframe && player.getIframe();
    if (iframe) iframe.setAttribute('tabindex', '-1');
    player.mute();
    applySound();
    player.playVideo();
  }

  function onPlayerStateChange(e) {
    const S = YT.PlayerState;
    log('Status ' + e.data);
    if (e.data === S.PLAYING) onPlaying();
    else if (e.data === S.ENDED) failCurrent('offline', 'beendet');
  }

  function onPlayerError(e) {
    const kind = ERRORS_UNAVAILABLE.includes(e.data) ? 'unavailable' : 'offline';
    console.warn('YouTube-Fehler', e.data, current && current.id);
    log('Fehler ' + e.data);
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
    renderCurrent();
    log(opts.reload ? 'neu laden' : 'starten');

    const curtainWasVisible = els.curtain.classList.contains('is-visible');
    showCurtain();

    const load = () => {
      if (token !== loadToken) return;
      setCurtainImage(stream);
      if (!player || !playerReady) {
        buildPlayer(stream.id);
      } else {
        player.loadVideoById(stream.id);
        applySound();
      }
      if (awaitingPlay) armLoadTimeout(token);
    };

    // Kurzes Überblenden beim Wechsel
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
      log('kein Start nach 20 s, Status ' + st);
      setNeedsStart(true);
    }, LOAD_TIMEOUT);
  }

  // Safari startet Videos im Stromsparmodus nur, wenn der Tap direkt im Player landet.
  // Deshalb wird in diesem Zustand der Vorhang entfernt (YouTubes Startknopf bzw.
  // Meldung ist sichtbar) und Taps gehen zum IFrame – ausser im unteren Streifen,
  // der weiterhin das Overlay öffnet.
  function setNeedsStart(on) {
    const was = document.body.classList.contains('needs-start');
    document.body.classList.toggle('needs-start', on);
    if (on && !was) closeOverlay();
    setNotice('start', on ? 'Auf das Bild tippen zum Starten' : null);
  }

  const logLines = [];
  const logEl = DEBUG ? document.createElement('pre') : null;
  if (logEl) {
    logEl.className = 'debuglog';
    document.body.appendChild(logEl);
  }

  function log(msg) {
    if (!logEl) return;
    const t = new Date().toTimeString().slice(0, 8);
    logLines.push(t + ' ' + (current ? current.id + ': ' : '') + msg);
    if (logLines.length > 14) logLines.shift();
    logEl.textContent = logLines.join('\n');
  }

  function failCurrent(kind, reason) {
    if (!current) return;
    clearTimeout(loadTimer);
    reasons[current.id] = reason || '';
    setStatus(current.id, kind);
    showInfo('Dieser Ort ist gerade nicht live');
    failover(current);
  }

  // Reihenfolge beim Ausweichen: erst die Favoriten, dann alle übrigen Orte.
  function failoverOrder(from) {
    const favs = favorites.map(findStream).filter(Boolean);
    const rest = streams.filter((s) => !favorites.includes(s.id));
    const order = favs.concat(rest);
    const i = order.indexOf(from);
    return i < 0 ? order : order.slice(i + 1).concat(order.slice(0, i));
  }

  function failover(from) {
    const next = failoverOrder(from).find((s) => !status[s.id]);
    if (next) {
      playStream(next);
      return;
    }
    // Alles gescheitert: Hinweis zeigen und später von vorne versuchen.
    awaitingPlay = false;
    setNotice('failed', 'Zurzeit ist kein Ort erreichbar');
    clearTimeout(allFailedTimer);
    allFailedTimer = setTimeout(() => {
      resetStatuses(true);
      playStream(preferredStream());
    }, ALL_FAILED_RETRY);
  }

  function resetStatuses(includeCurrent) {
    Object.keys(status).forEach((id) => {
      if (includeCurrent || !current || id !== current.id) delete status[id];
    });
  }

  function setStatus(id, value) {
    if (value) status[id] = value;
    else delete status[id];
    if (screen === 'menu') renderGrid();
  }

  function selectStream(stream) {
    preferredId = stream.id;
    store.set('currentId', stream.id);
    delete status[stream.id];
    if (current !== stream) playStream(stream);
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
      failCurrent('offline', 'hängt');
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
      if (Date.now() < at || !navigator.onLine || screen !== 'live') return;
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

  /* ---------- Nacht und Favoriten-Wechsel ---------- */

  function updateNight() {
    const hour = new Date().getHours();
    const night = settings.night && (hour >= 22 || hour < 7);
    document.body.classList.toggle('is-night', night);
  }

  function rotationKey() {
    const d = new Date();
    if (settings.rotate === 'stunde') return d.toDateString() + ' ' + d.getHours();
    if (settings.rotate === 'tag') return d.toDateString();
    return '';
  }

  function checkRotation() {
    const key = rotationKey();
    if (!key || key === rotateKey) {
      rotateKey = key;
      return;
    }
    rotateKey = key;
    const favs = favorites.map(findStream).filter(Boolean);
    if (favs.length < 2) return;
    const i = favs.indexOf(current);
    selectStream(favs[(i + 1) % favs.length]);
  }

  /* ---------- Ton ---------- */

  function soundAudible() {
    if (!playerReady || !wantSound) return false;
    try { return !player.isMuted(); } catch (e) { return false; }
  }

  // Bringt den Player in den gewünschten Tonzustand, soweit der Browser es erlaubt.
  function applySound() {
    if (!playerReady) return;
    try {
      if (wantSound && gestureSeen && !soundBlocked) {
        if (player.isMuted()) unmuteNow();
        else player.setVolume(100);
      } else if (!player.isMuted()) {
        player.mute();
      }
    } catch (e) { /* Player noch nicht bereit */ }
    updateSoundUI();
  }

  function unmuteNow() {
    if (!playerReady) return;
    player.unMute();
    player.setVolume(100);
    const st = safeState();
    if (st !== YT.PlayerState.PLAYING && st !== YT.PlayerState.BUFFERING) player.playVideo();
    verifySound();
  }

  // Manche Browser pausieren das Video, wenn der Ton ohne Geste eingeschaltet wird.
  // Dann zurück auf stumm und weiterspielen.
  function verifySound(attempt) {
    attempt = attempt || 0;
    clearTimeout(verifyTimer);
    verifyTimer = setTimeout(() => {
      if (!playerReady || !wantSound) return;
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
      wantSound = false;
      clearTimeout(verifyTimer);
      if (playerReady) player.mute();
    } else {
      wantSound = true;
      unmuteNow();
    }
    updateSoundUI();
  }

  function updateSoundUI() {
    const on = soundAudible();
    els.soundBtn.classList.toggle('is-on', on);
    els.soundBtn.setAttribute('aria-label', on ? 'Ton ausschalten' : 'Ton einschalten');
  }

  // Jeder Tap: Nutzergeste für Ton, Vollbild und Wake Lock nutzen.
  function onAnyGesture(e) {
    requestWakeLock();
    maybeFullscreen();
    if (e.target.closest && e.target.closest('#soundBtn')) return;
    if (!playerReady) {
      gestureSeen = true;
      return;
    }
    const st = safeState();
    if (st === YT.PlayerState.CUED || st === YT.PlayerState.PAUSED || st === -1) player.playVideo();
    if (!gestureSeen || soundBlocked) {
      gestureSeen = true;
      soundBlocked = false;
      if (wantSound) unmuteNow();
    }
  }

  /* ---------- Overlay ---------- */

  function openOverlay() {
    overlayOpen = true;
    els.overlay.classList.add('is-open');
    els.overlay.setAttribute('aria-hidden', 'false');
    renderCurrent();
    renderFavbar();
    updateSoundUI();
    bumpOverlay();
  }

  function closeOverlay() {
    overlayOpen = false;
    clearTimeout(overlayTimer);
    els.overlay.classList.remove('is-open');
    els.overlay.setAttribute('aria-hidden', 'true');
  }

  // Startet den Auto-Hide-Timer neu (Einstellung „Steuerung ausblenden nach“).
  function bumpOverlay() {
    if (!overlayOpen) return;
    clearTimeout(overlayTimer);
    if (settings.hideAfter > 0) overlayTimer = setTimeout(closeOverlay, settings.hideAfter * 1000);
  }

  function renderCurrent() {
    if (!current) return;
    els.curTitle.textContent = current.title;
    els.curLoc.textContent = current.location;
  }

  function renderFavbar() {
    els.favList.innerHTML = '';
    const favs = favorites.map(findStream).filter(Boolean);
    favs.forEach((stream) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fav' + (stream === current ? ' is-active' : '');
      btn.title = stream.title;
      btn.setAttribute('aria-label', stream.title);
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      setThumb(img, stream.id, ['mqdefault_live', 'mqdefault']);
      btn.appendChild(img);
      btn.addEventListener('click', () => {
        selectStream(stream);
        renderFavbar();
        bumpOverlay();
      });
      els.favList.appendChild(btn);
    });
    els.favList.parentElement.hidden = !favs.length;
  }

  /* ---------- Vorschaubilder ---------- */

  // Lädt das erste verfügbare Vorschaubild; das stündliche ?t= hält Live-Bilder frisch.
  function setThumb(img, id, chain) {
    const bust = '?t=' + Math.floor(Date.now() / 3600000);
    let i = 0;
    img.onerror = () => {
      i++;
      if (i < chain.length) img.src = 'https://i.ytimg.com/vi/' + id + '/' + chain[i] + '.jpg' + bust;
    };
    img.src = 'https://i.ytimg.com/vi/' + id + '/' + chain[0] + '.jpg' + bust;
  }

  const LARGE_THUMBS = ['maxresdefault_live', 'hqdefault_live', 'maxresdefault', 'hqdefault'];

  /* ---------- Screens ---------- */

  function setScreen(name) {
    screen = name;
    Object.keys(els.screens).forEach((key) => {
      els.screens[key].hidden = key !== name;
    });
    if (name === 'live') {
      els.q.blur();
      openOverlay();
      return;
    }
    closeOverlay();
    if (name === 'menu') renderMenu();
    if (name === 'search') {
      renderSearch();
      setTimeout(() => els.q.focus(), 50);
    }
    if (name === 'settings') renderSettings();
  }

  /* ---------- Meine Fenster ---------- */

  function renderMenu() {
    els.countLabel.textContent = streams.length + ' Livestreams · ' + favorites.length + ' Favoriten';
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.classList.toggle('is-active', tab.dataset.filter === filter);
    });
    renderGrid();
  }

  function renderGrid() {
    const list = filter === 'fav' ? favorites.map(findStream).filter(Boolean) : streams;
    els.grid.innerHTML = '';
    els.emptyFav.hidden = !(filter === 'fav' && !list.length);
    list.forEach((stream) => {
      const isFav = favorites.includes(stream.id);
      const card = document.createElement('div');
      card.className = 'card' + (status[stream.id] && stream !== current ? ' is-down' : '');
      card.innerHTML =
        '<button class="card__mat" type="button"><div class="card__img"><img alt="" draggable="false"></div></button>' +
        '<div class="card__row"><div class="card__text"><div class="card__title"></div>' +
        '<div class="card__loc"></div></div>' +
        '<button class="star-btn" type="button"></button></div>';
      setThumb(card.querySelector('img'), stream.id, LARGE_THUMBS);
      card.querySelector('.card__title').textContent = stream.title;
      const loc = card.querySelector('.card__loc');
      if (stream === current) {
        const dot = document.createElement('span');
        dot.className = 'dot';
        loc.appendChild(dot);
      }
      loc.appendChild(document.createTextNode(stream.location));
      const star = card.querySelector('.star-btn');
      star.textContent = isFav ? '★' : '☆';
      star.classList.toggle('is-fav', isFav);
      star.setAttribute('aria-label', isFav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen');
      star.addEventListener('click', () => toggleFavorite(stream.id));
      card.querySelector('.card__mat').addEventListener('click', () => {
        selectStream(stream);
        setScreen('live');
      });
      els.grid.appendChild(card);
    });
  }

  function toggleFavorite(id) {
    favorites = favorites.includes(id) ? favorites.filter((f) => f !== id) : favorites.concat(id);
    store.set('favorites', favorites);
    renderMenu();
    renderFavbar();
  }

  /* ---------- Neues Fenster (YouTube-Suche) ---------- */

  let searchTimer = 0;
  let searchToken = 0;
  let results = [];

  function parseVideoId(text) {
    const t = text.trim();
    // Nackte Video-ID nur, wenn sie nicht wie ein Suchwort aussieht
    if (/^[\w-]{11}$/.test(t) && /\d/.test(t) && /[A-Z]/.test(t) && /[a-z]/.test(t)) return t;
    const m = t.match(/(?:youtu\.be\/|[?&]v=|\/live\/|\/embed\/|\/shorts\/)([\w-]{11})/);
    return m ? m[1] : null;
  }

  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, SEARCH_DEBOUNCE);
  }

  function runSearch() {
    const q = els.q.value.trim();
    const token = ++searchToken;
    const done = (list, label) => {
      if (token !== searchToken) return;
      results = list;
      renderResults(label);
    };

    if (!q) {
      done([], null);
      return;
    }

    const linkId = parseVideoId(q);
    if (linkId) {
      fetch('https://www.youtube.com/oembed?format=json&url=' +
        encodeURIComponent('https://www.youtube.com/watch?v=' + linkId))
        .then((r) => {
          if (!r.ok) throw new Error('oEmbed ' + r.status);
          return r.json();
        })
        .then((d) => {
          // Gelöschte oder private Videos liefern keine Metadaten
          if (!d.title) throw new Error('ohne Titel');
          return d;
        })
        .then((d) => done([{
          id: linkId,
          title: d.title,
          location: d.author_name || '',
          thumb: 'https://i.ytimg.com/vi/' + linkId + '/hqdefault.jpg',
          viewers: 'YouTube-Link',
        }], null))
        .catch(() => done([], 'Video nicht gefunden'));
      return;
    }

    if (!apiKey) {
      done([], 'nokey');
      return;
    }

    const base = 'https://www.googleapis.com/youtube/v3/';
    fetch(base + 'search?part=snippet&type=video&eventType=live&maxResults=20' +
      '&q=' + encodeURIComponent(q) + '&key=' + encodeURIComponent(apiKey))
      .then((r) => r.json().then((d) => {
        if (!r.ok) throw new Error((d.error && d.error.message) || 'HTTP ' + r.status);
        return d;
      }))
      .then((d) => {
        const items = (d.items || []).filter((it) => it.id && it.id.videoId);
        const list = items.map((it) => ({
          id: it.id.videoId,
          title: decodeEntities(it.snippet.title),
          location: decodeEntities(it.snippet.channelTitle || ''),
          thumb: (it.snippet.thumbnails.high || it.snippet.thumbnails.medium || {}).url,
          viewers: '',
        }));
        if (!list.length) return list;
        return fetch(base + 'videos?part=liveStreamingDetails&id=' +
          list.map((x) => x.id).join(',') + '&key=' + encodeURIComponent(apiKey))
          .then((r) => r.json())
          .then((v) => {
            (v.items || []).forEach((it) => {
              const n = it.liveStreamingDetails && Number(it.liveStreamingDetails.concurrentViewers);
              const hit = list.find((x) => x.id === it.id);
              if (hit && Number.isFinite(n)) hit.viewers = n.toLocaleString('de-CH') + ' schauen zu';
            });
            return list;
          })
          .catch(() => list);
      })
      .then((list) => done(list, null))
      .catch((err) => {
        console.warn(err);
        done([], 'Suche fehlgeschlagen – API-Schlüssel prüfen');
      });
  }

  function decodeEntities(text) {
    const ta = document.createElement('textarea');
    ta.innerHTML = text;
    return ta.value;
  }

  function renderSearch() {
    if (!els.q.value.trim()) renderResults(null);
  }

  function renderResults(error) {
    els.results.innerHTML = '';
    const q = els.q.value.trim();
    const scroll = els.results.parentElement;
    scroll.querySelectorAll('.search-hint').forEach((n) => n.remove());

    if (error === 'nokey' || (!q && !apiKey)) {
      els.resultLabel.textContent = 'Suche ohne API-Schlüssel nicht möglich';
      addHint('Füge hier einen YouTube-Link ein – oder hinterlege in den Einstellungen einen ' +
        'Schlüssel der YouTube Data API, um nach Livestreams zu suchen.');
      return;
    }
    if (!q) {
      els.resultLabel.textContent = '';
      return;
    }
    if (error) {
      els.resultLabel.textContent = error;
      return;
    }
    els.resultLabel.textContent = results.length
      ? results.length + ' Livestream' + (results.length === 1 ? '' : 's') + ' auf YouTube'
      : 'Keine Livestreams gefunden';

    results.forEach((r) => {
      const added = !!findStream(r.id);
      const card = document.createElement('div');
      card.className = 'result';
      card.innerHTML =
        '<div class="result__img"><img alt="" draggable="false"></div>' +
        '<div class="result__text"><div class="result__title"></div><div class="result__loc"></div>' +
        '<div class="result__viewers"></div></div>' +
        '<button class="add-btn" type="button"></button>';
      const img = card.querySelector('img');
      if (r.thumb) img.src = r.thumb;
      else setThumb(img, r.id, ['hqdefault']);
      card.querySelector('.result__title').textContent = r.title;
      card.querySelector('.result__loc').textContent = r.location;
      card.querySelector('.result__viewers').textContent = r.viewers ? '● ' + r.viewers : '';
      const btn = card.querySelector('.add-btn');
      btn.textContent = added ? '✓' : '+';
      btn.classList.toggle('is-added', added);
      btn.setAttribute('aria-label', added ? 'Hinzugefügt' : 'Hinzufügen');
      btn.addEventListener('click', () => {
        if (findStream(r.id)) return;
        streams = streams.concat({ id: r.id, title: r.title, location: r.location });
        store.set('streams', streams);
        renderResults(null);
      });
      els.results.appendChild(card);
    });
  }

  function addHint(text) {
    const hint = document.createElement('div');
    hint.className = 'search-hint';
    hint.textContent = text;
    els.results.parentElement.appendChild(hint);
  }

  /* ---------- Einstellungen ---------- */

  const SETTING_ROWS = [
    { group: 'Passepartout' },
    { key: 'mat', type: 'toggle', title: 'Passepartout', desc: 'Zeigt den Livestream mit einem Rand wie bei einem gerahmten Bild.' },
    { key: 'matColor', type: 'seg', when: 'mat', title: 'Farbe', desc: 'Ton des Rands.',
      options: [['creme', 'Creme'], ['weiss', 'Weiß'], ['anthrazit', 'Anthrazit']] },
    { key: 'matSize', type: 'seg', when: 'mat', title: 'Breite', desc: 'Wie viel Rand um das Bild bleibt.',
      options: [['s', 'Schmal'], ['m', 'Mittel'], ['l', 'Breit']] },
    { group: 'Bild' },
    { key: 'night', type: 'toggle', title: 'Nachts abdunkeln', desc: 'Zwischen 22 und 7 Uhr wird der Bildschirm gedimmt.' },
    { group: 'Bedienung' },
    { key: 'hideAfter', type: 'seg', title: 'Steuerung ausblenden nach', desc: 'Zeit bis das Overlay nach dem Tippen verschwindet.',
      options: [[5, '5 s'], [10, '10 s'], [30, '30 s'], [0, 'Nie']] },
    { key: 'startSound', type: 'seg', title: 'Ton beim Start', desc: 'Ob ein Stream beim Öffnen mit Ton startet.',
      options: [['stumm', 'Stumm'], ['ton', 'Mit Ton']] },
    { key: 'rotate', type: 'seg', title: 'Favoriten wechseln', desc: 'Wechselt automatisch zum nächsten Favoriten.',
      options: [['aus', 'Aus'], ['stunde', 'Stündlich'], ['tag', 'Täglich']] },
    { group: 'YouTube' },
    { type: 'apikey', title: 'API-Schlüssel', desc: 'Für die Suche nach neuen Livestreams. Bleibt nur auf diesem Gerät gespeichert.' },
    { type: 'reset', title: 'Startliste wiederherstellen', desc: 'Setzt Orte und Favoriten auf die neun Start-Streams zurück.' },
  ];

  function renderSettings() {
    els.previewImg.onerror = null;
    if (current) setThumb(els.previewImg, current.id, LARGE_THUMBS);
    els.previewCaption.textContent = 'Vorschau · ' + (current ? current.title : '');
    layout();

    const list = els.settingsList;
    const scrollTop = list.scrollTop;
    list.innerHTML = '';
    SETTING_ROWS.forEach((row) => {
      if (row.when && !settings[row.when]) return;
      if (row.group) {
        const g = document.createElement('div');
        g.className = 'group';
        g.textContent = row.group;
        list.appendChild(g);
        return;
      }
      const el = document.createElement('div');
      el.className = 'row';
      el.innerHTML = '<div class="row__text"><div class="row__title"></div><div class="row__desc"></div></div>';
      el.querySelector('.row__title').textContent = row.title;
      el.querySelector('.row__desc').textContent = row.desc;
      el.appendChild(settingControl(row));
      list.appendChild(el);
    });
    list.scrollTop = scrollTop;
  }

  function settingControl(row) {
    if (row.type === 'toggle') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toggle' + (settings[row.key] ? ' is-on' : '');
      btn.setAttribute('role', 'switch');
      btn.setAttribute('aria-checked', String(!!settings[row.key]));
      btn.setAttribute('aria-label', row.title);
      btn.addEventListener('click', () => changeSetting(row.key, !settings[row.key]));
      return btn;
    }
    if (row.type === 'seg') {
      const seg = document.createElement('div');
      seg.className = 'seg';
      row.options.forEach(([value, label]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.classList.toggle('is-active', settings[row.key] === value);
        btn.addEventListener('click', () => changeSetting(row.key, value));
        seg.appendChild(btn);
      });
      return seg;
    }
    if (row.type === 'apikey') {
      const input = document.createElement('input');
      input.className = 'key-input';
      input.type = 'text';
      input.placeholder = 'AIza…';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('autocapitalize', 'off');
      input.setAttribute('autocorrect', 'off');
      input.value = apiKey;
      input.addEventListener('change', () => {
        apiKey = input.value.trim();
        store.set('apiKey', apiKey);
      });
      return input;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'plain-btn';
    btn.textContent = 'Zurücksetzen';
    btn.addEventListener('click', resetStreams);
    return btn;
  }

  function changeSetting(key, value) {
    settings[key] = value;
    store.set('settings', settings);
    if (key === 'night') updateNight();
    if (key === 'rotate') rotateKey = rotationKey();
    renderSettings();
  }

  function resetStreams() {
    if (!window.confirm('Orte und Favoriten auf die Startliste zurücksetzen?')) return;
    loadDefaultStreams()
      .then((list) => {
        streams = list;
        favorites = list.slice(0, 3).map((s) => s.id);
        store.set('streams', streams);
        store.set('favorites', favorites);
        if (!findStream(current && current.id)) selectStream(streams[0]);
        renderFavbar();
        renderSettings();
      })
      .catch(() => window.alert('Die Startliste konnte nicht geladen werden.'));
  }

  /* ---------- Hinweise / Vorhang ---------- */

  function setNotice(key, text) {
    notices[key] = text;
    const shown = notices.offline || notices.failed || notices.start || notices.info;
    els.notice.textContent = shown || '';
    els.notice.hidden = !shown;
  }

  function showInfo(text) {
    clearTimeout(infoTimer);
    setNotice('info', text);
    infoTimer = setTimeout(() => setNotice('info', null), NOTICE_DURATION);
  }

  function showCurtain() {
    clearTimeout(curtainTimer);
    els.curtain.classList.add('is-visible');
  }

  function setCurtainImage(stream) {
    const img = els.curtainImg;
    img.classList.remove('is-loaded');
    img.onload = () => img.classList.add('is-loaded');
    setThumb(img, stream.id, ['mqdefault_live', 'mqdefault']);
  }

  function hideCurtain(delay) {
    clearTimeout(curtainTimer);
    curtainTimer = setTimeout(() => els.curtain.classList.remove('is-visible'), delay || 0);
  }

  /* ---------- Ereignisse ---------- */

  function preventDefault(e) { e.preventDefault(); }

  els.tap.addEventListener('click', () => {
    if (screen !== 'live') return;
    if (document.body.classList.contains('needs-start') && playerReady) {
      try { player.playVideo(); } catch (e) { /* ignorieren */ }
    }
    if (overlayOpen) closeOverlay();
    else openOverlay();
  });

  document.addEventListener('click', onAnyGesture, true);

  els.soundBtn.addEventListener('click', () => {
    toggleSound();
    bumpOverlay();
  });
  els.menuBtn.addEventListener('click', () => setScreen('menu'));
  els.overlay.addEventListener('pointerdown', bumpOverlay);

  document.querySelectorAll('[data-go]').forEach((btn) => {
    btn.addEventListener('click', () => setScreen(btn.dataset.go));
  });
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      filter = tab.dataset.filter;
      renderMenu();
    });
  });

  els.q.addEventListener('input', onSearchInput);
  els.q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(searchTimer);
      runSearch();
      els.q.blur();
    }
  });

  // Kein Zoom, kein Bounce, kein Long-Press-Menü
  document.addEventListener('gesturestart', preventDefault);
  document.addEventListener('dblclick', preventDefault);
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest || !e.target.closest('input')) e.preventDefault();
  });
  document.addEventListener('touchmove', (e) => {
    if (!e.target.closest || !e.target.closest('.scroll, .favbar__list')) e.preventDefault();
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
    updateNight();
    checkRotation();
  }, 60 * 1000);

  // Für die Fehlersuche in der Browser-Konsole
  window.fenster = {
    get player() { return player; },
    get current() { return current; },
    get settings() { return settings; },
    status,
    reasons,
  };

  layout();
  updateNight();
  updateSoundUI();
  if (!navigator.onLine) setNotice('offline', 'Keine Internetverbindung');
  requestWakeLock();
  scheduleDailyReload();
  boot();
})();
