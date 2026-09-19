// public/autosave.js
// ============================================================
// FytX Auto-Save — per-URL progress persistence
// ------------------------------------------------------------
// Setiap URL yang di-fetch punya "progress" sendiri (trims +
// pengaturan clipper) yang disimpan ke localStorage. Progress
// otomatis kesave tiap ada perubahan (klik/checkbox/input), dan
// otomatis dipulihkan lagi begitu URL yang sama di-fetch ulang —
// bahkan setelah tab ditutup / browser di-refresh.
//
// Catatan penting: karena stream URL dari yt-dlp itu sementara
// (expired), file ini TIDAK skip proses fetch. Yang dipulihkan
// cuma trims & settings-nya, video/metadata tetap harus di-fetch
// ulang seperti biasa.
// ============================================================

(() => {
  const STORAGE_KEY = 'fytx_url_progress_v1';
  const LAST_URL_KEY = 'fytx_last_active_url';
  const DEBOUNCE_MS = 400;
  const PERIODIC_MS = 4000;
  const MAX_ENTRIES = 50; // biar localStorage ga bengkak, simpan progress 50 URL terakhir aja

  let saveTimer = null;
  let activeUrl = '';
  let lastSavedHash = '';

  const getEl = (id) => document.getElementById(id);
  const norm = (url) => (url || '').trim();

  function readStore() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (e) {
      console.warn('[AutoSave] store korup, reset:', e.message);
      return {};
    }
  }

  function writeStore(store) {
    try {
      // Batasi jumlah entri: buang yang paling lama diupdate
      const keys = Object.keys(store);
      if (keys.length > MAX_ENTRIES) {
        keys
          .sort((a, b) => (store[a].updatedAt || 0) - (store[b].updatedAt || 0))
          .slice(0, keys.length - MAX_ENTRIES)
          .forEach((k) => delete store[k]);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
      // Kalau quota localStorage penuh, jangan sampai bikin app crash
      console.warn('[AutoSave] gagal nyimpen progress:', e.message);
    }
  }

  function collectClipperSettings() {
    return {
      crop: getEl('clipperCrop') ? getEl('clipperCrop').checked : undefined,
      ratio: getEl('clipperRatio') ? getEl('clipperRatio').value : undefined,
      padding: getEl('clipperPadding') ? getEl('clipperPadding').value : undefined,
      maxClips: getEl('clipperMaxClips') ? getEl('clipperMaxClips').value : undefined,
      subtitle: getEl('clipperSubtitle') ? getEl('clipperSubtitle').checked : undefined,
      whisperModel: getEl('clipperWhisperModel') ? getEl('clipperWhisperModel').value : undefined,
      fontSel: getEl('clipperFontSel') ? getEl('clipperFontSel').value : undefined,
      fontCustom: getEl('clipperFontCustom') ? getEl('clipperFontCustom').value : undefined,
      subLoc: getEl('clipperSubLoc') ? getEl('clipperSubLoc').value : undefined,
    };
  }

  function collectFormatQuality() {
    try {
      // `state` datang dari app.js — top-level const di classic <script>,
      // jadi otomatis kebaca lintas file selama urutan <script> app.js duluan.
      return {
        format: (typeof state !== 'undefined' && state.selectedFormat) || null,
        quality: (typeof state !== 'undefined' && state.selectedQuality) || null,
        qualityHeight: (typeof state !== 'undefined' && state.selectedQualityHeight) || null,
      };
    } catch (e) {
      return { format: null, quality: null, qualityHeight: null };
    }
  }

  function buildSnapshot() {
    return {
      trims: Array.isArray(window.customTrims) ? window.customTrims.map((t) => ({ ...t })) : [],
      clipper: collectClipperSettings(),
      fq: collectFormatQuality(),
      updatedAt: Date.now(),
    };
  }

  function saveProgress(url) {
    url = norm(url);
    if (!url) return;
    const snapshot = buildSnapshot();
    const hash = JSON.stringify(snapshot.trims) + JSON.stringify(snapshot.clipper) + JSON.stringify(snapshot.fq);
    if (hash === lastSavedHash) return; // ga ada perubahan, skip write ke localStorage
    lastSavedHash = hash;

    const store = readStore();
    store[url] = snapshot;
    writeStore(store);
    localStorage.setItem(LAST_URL_KEY, url);
  }

  function scheduleSave() {
    if (!activeUrl) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveProgress(activeUrl), DEBOUNCE_MS);
  }

  function restoreProgress(url) {
    url = norm(url);
    const store = readStore();
    const saved = store[url];

    activeUrl = url;
    lastSavedHash = ''; // paksa evaluasi ulang di save berikutnya

    if (!saved) return false;

    // --- Restore trims ---
    if (Array.isArray(saved.trims)) {
      window.customTrims = saved.trims.map((t) => ({ ...t }));
      if (typeof window.updateCustomTrimUI === 'function') {
        window.updateCustomTrimUI();
      }
    }

    // --- Restore pengaturan clipper ---
    if (saved.clipper) {
      const c = saved.clipper;
      if (getEl('clipperCrop') && c.crop !== undefined) getEl('clipperCrop').checked = c.crop;
      if (getEl('clipperRatio') && c.ratio !== undefined) getEl('clipperRatio').value = c.ratio;
      if (getEl('clipperPadding') && c.padding !== undefined) getEl('clipperPadding').value = c.padding;
      if (getEl('clipperMaxClips') && c.maxClips !== undefined) getEl('clipperMaxClips').value = c.maxClips;
      if (getEl('clipperSubtitle') && c.subtitle !== undefined) getEl('clipperSubtitle').checked = c.subtitle;
      if (getEl('clipperWhisperModel') && c.whisperModel !== undefined) getEl('clipperWhisperModel').value = c.whisperModel;
      if (getEl('clipperFontSel') && c.fontSel !== undefined) getEl('clipperFontSel').value = c.fontSel;
      if (getEl('clipperFontCustom') && c.fontCustom !== undefined) getEl('clipperFontCustom').value = c.fontCustom;
      if (getEl('clipperSubLoc') && c.subLoc !== undefined) getEl('clipperSubLoc').value = c.subLoc;
    }

    // --- Restore format/quality (best effort, UI grid quality dibuat ulang per metadata) ---
    if (saved.fq && typeof state !== 'undefined') {
      if (saved.fq.format) state.selectedFormat = saved.fq.format;
      if (saved.fq.quality) state.selectedQuality = saved.fq.quality;
      if (saved.fq.qualityHeight) state.selectedQualityHeight = saved.fq.qualityHeight;
    }

    const trimCount = Array.isArray(saved.trims) ? saved.trims.length : 0;
    if (typeof window.showToast === 'function' && trimCount > 0) {
      window.showToast('Progress Dipulihkan', `${trimCount} trim & pengaturan sebelumnya untuk URL ini berhasil dimuat ulang.`, 'success');
    }
    return true;
  }

  // ---------------- Public API ----------------
  window.FytXAutoSave = {
    // Panggil setelah fetch metadata berhasil untuk URL tertentu
    onFetchSuccess(url) {
      // Delay dikit biar elemen (customTrimListContainer, dll) yang muncul
      // setelah metadata render sempat ke-mount duluan.
      setTimeout(() => restoreProgress(url), 150);
    },
    setActiveUrl(url) {
      activeUrl = norm(url);
    },
    forceSave() {
      if (activeUrl) saveProgress(activeUrl);
    },
    clearUrl(url) {
      const store = readStore();
      delete store[norm(url)];
      writeStore(store);
    },
    clearAll() {
      localStorage.removeItem(STORAGE_KEY);
    },
  };

  // ---------------- Auto-triggers ----------------
  // Delegated di document (capture:true) biar tetap kecatat walau elemen
  // pemicunya manggil e.stopPropagation() (misal tombol hapus trim).
  document.addEventListener('click', scheduleSave, true);
  document.addEventListener('change', scheduleSave, true);
  document.addEventListener('input', scheduleSave, true);

  // Safety-net: jaga-jaga ada perubahan programatik (drag di timeline, dll)
  // yang ga lewat click/change/input event.
  setInterval(() => {
    if (activeUrl) saveProgress(activeUrl);
  }, PERIODIC_MS);

  // Flush pas mau nutup tab / refresh / pindah tab
  window.addEventListener('beforeunload', () => {
    if (activeUrl) saveProgress(activeUrl);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && activeUrl) saveProgress(activeUrl);
  });

  // Pas halaman baru dibuka: isi lagi URL terakhir yang ada progress-nya
  // (TIDAK auto-fetch — biar ga nembak yt-dlp/API tanpa user minta).
  document.addEventListener('DOMContentLoaded', () => {
    const lastUrl = localStorage.getItem(LAST_URL_KEY);
    const urlInputEl = getEl('urlInput');
    if (lastUrl && urlInputEl && !urlInputEl.value) {
      const store = readStore();
      if (store[norm(lastUrl)]) {
        urlInputEl.value = lastUrl;
        if (typeof window.showToast === 'function') {
          window.showToast('Progress Ditemukan', 'Klik Fetch lagi buat lanjutin progress URL terakhir kamu.', 'success');
        }
      }
    }
  });
})();
