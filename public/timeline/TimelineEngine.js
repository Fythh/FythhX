/**
 * Timeline Engine - Modular & Reusable Video Trimmer Core
 * 
 * Target: Low coupling, high cohesion, reusable for future tools.
 */

// Format seconds to HH:MM:SS.ms
function formatTime(sec) {
  if (isNaN(sec)) return "00:00:00.000";
  const d = new Date(sec * 1000);
  const h = Math.floor(sec / 3600).toString().padStart(2, '0');
  const m = d.getUTCMinutes().toString().padStart(2, '0');
  const s = d.getUTCSeconds().toString().padStart(2, '0');
  const ms = d.getUTCMilliseconds().toString().padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function parseTime(timeStr) {
  const parts = timeStr.split(':');
  if (parts.length !== 3) return 0;
  const h = parseFloat(parts[0]) || 0;
  const m = parseFloat(parts[1]) || 0;
  const s = parseFloat(parts[2]) || 0;
  return (h * 3600) + (m * 60) + s;
}

class ThumbnailProvider {
  constructor(engine) {
    this.engine = engine;
    this.container = null;
    this.videoUrl = null;
    this.duration = 0;
    this._spriteCache = new Map(); // countBucket -> sprite meta
    this._currentBucket = null;
    this._refineTimer = null;
    this._loadToken = 0;
    this._rendered = false;
  }

  mount(container) {
    this.container = container;
  }

  // Kept for API compat with TimelineEngine.mount() — sprite mode doesn't
  // need the <video> element for capture anymore, backend does the decoding.
  setVideoElement(videoEl) {
    this.videoEl = videoEl;
  }

  loadMedia(url, duration, videoId = null, userAgent = null) {
    this.videoUrl = url;
    this.duration = duration;
    this.videoId = videoId;
    this.userAgent = userAgent;
    this._spriteCache.clear();
    this._currentBucket = null;
    this._rendered = false;
    clearTimeout(this._refineTimer);

    const baseCount = this._countForZoom(1);
    this._fetchAndRender(baseCount);
  }

  /** Call this from UIController whenever zoomLevel changes. Debounced + cached
   *  so spamming the wheel doesn't spam the backend — zooming back to a level
   *  you've already visited swaps instantly from cache. */
  onZoomChange(zoomLevel) {
    if (!this.videoUrl) return;
    const count = this._countForZoom(zoomLevel);
    const bucket = this._bucketFor(count);
    if (bucket === this._currentBucket) return;

    clearTimeout(this._refineTimer);
    this._refineTimer = setTimeout(() => this._fetchAndRender(count), 350);
  }

  _countForZoom(zoomLevel) {
    // FIXED: Return a static count (e.g., 100) regardless of zoom.
    // This prevents the TimelineEngine from spamming the backend (and YouTube/TikTok)
    // with FFmpeg sprite generation requests every time the user zooms in or out.
    // The frontend will simply stretch/tile the existing 60 frames dynamically.
    return 60;
  }

  _bucketFor(count) {
    return count; // Match exact count so we hit the preloaded sprite cache from app.js
  }

  async _fetchAndRender(count) {
    if (!this.videoUrl || !this.duration) return;
    const bucket = this._bucketFor(count);
    const token = ++this._loadToken;

    if (this._spriteCache.has(bucket)) {
      this._currentBucket = bucket;
      this._render(this._spriteCache.get(bucket));
      this._rendered = true;
      return;
    }

    this._renderSkeletons(bucket);

    try {
      const meta = await this._fetchSprite(bucket);
      this._spriteCache.set(bucket, meta);
      
      // Render it if it's still the requested bucket, OR if we haven't rendered anything yet
      if (token === this._loadToken || !this._rendered) {
        this._currentBucket = bucket;
        this._render(meta);
        this._rendered = true;
      }
    } catch (err) {
      console.warn('[TimelineEngine] Sprite fetch failed:', err);
    }
  }

  async _fetchSprite(count) {
    const params = new URLSearchParams({
      url: this.videoUrl,
      duration: String(this.duration),
      count: String(count),
      videoId: this.videoId || window.extractVideoId?.(this.videoUrl) || ''
    });
    if (this.userAgent) {
      params.append('ua', this.userAgent);
    }
    
    const MAX_POLL_TIME = 10 * 60 * 1000;
    const startTime = Date.now();
    
    while (Date.now() - startTime < MAX_POLL_TIME) {
      const res = await fetch(`/api/thumbnails/sprite?${params.toString()}`);
      if (!res.ok) throw new Error(`Sprite endpoint returned ${res.status}`);
      const data = await res.json();
      
      if (data.status === 'error') {
        throw new Error(data.error || 'Failed to generate sprite');
      }
      
      if (data.status !== 'pending' && data.spriteUrl) {
        return data; // Done!
      }
      
      // Still pending, wait 4 seconds then poll again
      await new Promise(r => setTimeout(r, 4000));
    }
    
    throw new Error('Sprite generation timed out');
  }

  _renderSkeletons(count) {
    if (!this.container) return;
    this.container.innerHTML = '';
    const interval = this.duration / count;
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'tl-thumbnail tl-skeleton';
      el.style.width = `${(interval / this.duration) * 100}%`;
      this.container.appendChild(el);
    }
  }

  /** Renders ALL thumbnails in one shot by slicing a single pre-baked sprite
   *  image — this is the "pop in all at once" behaviour Filmora/CapCut have,
   *  because there's exactly one network request instead of N sequential seeks. */
  _render(meta) {
    if (!this.container) return;
    const { spriteUrl, cols, rows, frameWidth, frameHeight, count, interval } = meta;

    const img = new Image();
    img.onload = () => {
      this.container.innerHTML = '';
      const sheetW = frameWidth * cols;
      const sheetH = frameHeight * rows;

      const frag = document.createDocumentFragment();
      for (let i = 0; i < count; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const el = document.createElement('div');
        el.className = 'tl-thumbnail';
        el.style.width = `${(interval / this.duration) * 100}%`;
        el.style.backgroundImage = `url('${spriteUrl}')`;
        el.style.backgroundSize = `${sheetW}px ${sheetH}px`;
        el.style.backgroundPosition = `-${col * frameWidth}px -${row * frameHeight}px`;
        frag.appendChild(el);
      }
      this.container.appendChild(frag);
    };
    img.onerror = () => {
      console.warn('[TimelineEngine] Sprite image failed to load, keeping skeletons.');
    };
    img.src = spriteUrl;
  }

  _cancel() {
    clearTimeout(this._refineTimer);
    this._loadToken++;
  }
}


class PlaybackController {
  constructor(engine) {
    this.engine = engine;
    this.videoEl = null;
    this.isPlaying = false;
    this.loopSelection = true;
    this._rafId = null;
  }

  mount(videoElement) {
    this.videoEl = videoElement;

    // Modern scrubbing API if available
    if ('requestVideoFrameCallback' in this.videoEl) {
      const loop = (now, metadata) => {
        if (this.isPlaying) this.syncEngineWithVideo();
        this._rafId = this.videoEl.requestVideoFrameCallback(loop);
      };
      this._rafId = this.videoEl.requestVideoFrameCallback(loop);
    } else {
      this.videoEl.addEventListener('timeupdate', () => {
        if (this.isPlaying) this.syncEngineWithVideo();
      });
    }

    this.videoEl.addEventListener('ended', () => {
      this.isPlaying = false;
      // Reset play button label via engine ui reference
      const btnPlay = this.engine.ui.elements.btnPlay;
      if (btnPlay) btnPlay.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">play_arrow</span> Play';
      this.pause();
    });
  }

  play() {
    if (!this.videoEl) return;
    const { start, end } = this.engine.selection;
    // Auto-restart if we are at or past the END point
    if (this.videoEl.currentTime >= end) {
      this.videoEl.currentTime = start;
    } else if (this.videoEl.currentTime < start) {
      // Jump to start if we are before IN point
      this.videoEl.currentTime = start;
    }
    const audioEl = document.getElementById('trimmerAudioPreview');
    if (audioEl) {
      audioEl.currentTime = this.videoEl.currentTime;
      audioEl.play().catch(()=>{});
    }
    this.videoEl.play();
    this.isPlaying = true;
    
    // Sync UI Button
    const btnPlay = this.engine.ui?.elements?.btnPlay;
    if (btnPlay) btnPlay.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">pause</span> Pause';
  }

  pause() {
    if (!this.videoEl) return;
    const audioEl = document.getElementById('trimmerAudioPreview');
    if (audioEl) audioEl.pause();
    this.videoEl.pause();
    this.isPlaying = false;
    
    // Sync UI Button
    const btnPlay = this.engine.ui?.elements?.btnPlay;
    if (btnPlay) btnPlay.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">play_arrow</span> Play';
  }

  togglePlay() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  seek(time, force = false) {
    if (!this.videoEl) return;
    const audioEl = document.getElementById('trimmerAudioPreview');
    const now = Date.now();
    if (force || !this._lastSeek || (now - this._lastSeek > 250)) {
      this.videoEl.currentTime = time;
      if (audioEl) audioEl.currentTime = time;
      this._lastSeek = now;
      clearTimeout(this._seekDebounce);
    } else {
      clearTimeout(this._seekDebounce);
      this._seekDebounce = setTimeout(() => {
        if (this.videoEl) {
          this.videoEl.currentTime = time;
          if (audioEl) audioEl.currentTime = time;
          this._lastSeek = Date.now();
        }
      }, 250);
    }
  }

  syncEngineWithVideo() {
    const time = this.videoEl.currentTime;
    const { end } = this.engine.selection;
        if (this.loopSelection && time >= end) {
        this.seek(this.engine.selection.start, true);
      } else if (!this.loopSelection && time >= end) {
        this.pause();
        // Reset play button state
        const btnPlay = this.engine.ui.elements.btnPlay;
        if (btnPlay) btnPlay.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">play_arrow</span> Play';
      } else {
        this.engine.selection.setPlayhead(time, false);
        this.engine.ui.updatePlayhead();
      }
  }
}

class SelectionManager {
  constructor(engine) {
    this.engine = engine;
    this.start = 0;
    this.end = 0;
    this.playhead = 0;
    this.duration = 0;
  }

  setDuration(duration) {
    this.duration = duration;
    this.start = 0;
    this.end = duration;
    this.playhead = 0;
  }

  setStart(time) {
    let minAllowed = 0;
    if (typeof window !== 'undefined' && window.activeTrimId && window.customTrims) {
      const otherTrims = window.customTrims.filter(t => t.id !== window.activeTrimId);
      const beforeTrims = otherTrims.filter(t => t.end <= this.end);
      if (beforeTrims.length > 0) minAllowed = Math.max(...beforeTrims.map(t => t.end));
    }
    this.start = Math.max(minAllowed, Math.min(time, this.end - 0.5));
    if (this.playhead < this.start) this.setPlayhead(this.start);
    this.syncActiveTrim();
    this.engine.ui.updateAll();
  }

  setEnd(time) {
    let maxAllowed = this.duration;
    if (typeof window !== 'undefined' && window.activeTrimId && window.customTrims) {
      const otherTrims = window.customTrims.filter(t => t.id !== window.activeTrimId);
      const afterTrims = otherTrims.filter(t => t.start >= this.start);
      if (afterTrims.length > 0) maxAllowed = Math.min(...afterTrims.map(t => t.start));
    }
    this.end = Math.min(maxAllowed, Math.max(time, this.start + 0.5));
    if (this.playhead > this.end) this.setPlayhead(this.end);
    this.syncActiveTrim();
    this.engine.ui.updateAll();
  }

  setRange(start, end) {
    if (start >= end) return;
    this.start = start;
    this.end = end;
    if (this.playhead < this.start) this.setPlayhead(this.start);
    if (this.playhead > this.end) this.setPlayhead(this.end);
    this.engine.ui.updateAll();
  }
  
  syncActiveTrim() {
    if (typeof window !== 'undefined' && window.activeTrimId && window.customTrims) {
      const activeTrim = window.customTrims.find(t => t.id === window.activeTrimId);
      if (activeTrim) {
        activeTrim.start = this.start;
        activeTrim.end = this.end;
        if (window.updateTrimCount) window.updateTrimCount(true); // updates download button and list bounds without auto-zooming
        const textEl = document.getElementById(`trim-text-${activeTrim.id}`);
        if (textEl) {
          const fmt = (t) => {
            const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
            return h > 0 ? `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
                         : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
          };
          textEl.innerHTML = `${fmt(activeTrim.start)} &mdash; ${fmt(activeTrim.end)} <span class="text-xs text-white/40 ml-1">(${(activeTrim.end - activeTrim.start).toFixed(1)}s)</span>`;
        }
      }
    }
  }

  setPlayhead(time, seekVideo = true) {
    this.playhead = Math.max(0, Math.min(time, this.duration));
    if (seekVideo && this.engine.playback) {
      this.engine.playback.seek(this.playhead);
    }
    this.engine.ui.updateCurrentTimeIndicator();
  }

  applyPreset(seconds) {
    let newEnd = this.playhead + seconds;
    if (newEnd > this.duration) {
      newEnd = this.duration;
      this.setPlayhead(newEnd - seconds > 0 ? newEnd - seconds : 0);
    }
    this.start = this.playhead;
    this.end = newEnd;
    this.syncActiveTrim();
    this.engine.ui.updateAll();
  }

  reset() {
    this.start = 0;
    this.end = this.duration;
    this.setPlayhead(0);
    this.engine.ui.updateAll();
  }
}

class UIController {
  constructor(engine) {
    this.engine = engine;
    this.elements = {};
    this.isDragging = false;
    this.dragTarget = null;
    this.zoomLevel = 1;
  }

  mount(container) {
    this.container = container;
    this.render();
    this.setupEvents();
  }

  render() {
    this.container.innerHTML = `
      <div class="timeline-engine-container">

        <div class="w-full flex flex-col md:flex-row gap-2 md:justify-between">
          <!-- Left Group: Play, Mute, IN, OUT -->
          <div class="flex gap-1.5 md:gap-2 w-full md:w-auto">
            <button id="tl-btn-play" class="tl-btn flex-1 md:flex-none">
              <span class="material-symbols-outlined" style="font-size:16px">play_arrow</span> Play
            </button>
            <button id="tl-btn-mute" class="tl-btn flex-1 md:flex-none">
              <span class="material-symbols-outlined" style="font-size:16px">volume_up</span> Mute
            </button>
            <button id="tl-btn-set-in" class="tl-btn flex-1 md:flex-none flex items-center justify-center transition-all duration-300" style="width: 32px;" title="Trim Start to Playhead">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0">
                <line x1="12" y1="2" x2="12" y2="22" stroke-width="2.5"></line>
                <path d="M4 12h7"></path>
                <path d="M8 8l3 4-3 4"></path>
                <rect x="14" y="6" width="8" height="12" rx="2" fill="currentColor" fill-opacity="0.3"></rect>
              </svg>
            </button>
            <button id="tl-btn-set-out" class="tl-btn flex-1 md:flex-none flex items-center justify-center transition-all duration-300" style="width: 32px;" title="Trim End to Playhead">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0">
                <line x1="12" y1="2" x2="12" y2="22" stroke-width="2.5"></line>
                <path d="M20 12h-7"></path>
                <path d="M16 8l-3 4 3 4"></path>
                <rect x="2" y="6" width="8" height="12" rx="2" fill="currentColor" fill-opacity="0.3"></rect>
              </svg>
            </button>
          </div>
          <!-- Right Group: Preset, Loop, Reset -->
          <div class="flex gap-1.5 md:gap-2 w-full md:w-auto">
            <div class="relative flex-1 md:flex-none" id="tl-preset-wrapper">
              <button id="tl-btn-preset-toggle" class="tl-btn w-full flex justify-between items-center px-3" style="min-width: 90px;">
                Preset <span class="material-symbols-outlined ml-1" style="font-size:16px;">expand_more</span>
              </button>
              <div id="tl-preset-dropdown" class="hidden absolute top-full mt-1 left-0 w-full rounded-lg glass-inner border border-white/10 flex flex-col z-[100] shadow-lg overflow-hidden py-1">
                <button class="tl-preset-opt px-3 py-2 text-sm text-white hover:bg-white/10 text-left transition-colors" data-val="15">15s</button>
                <button class="tl-preset-opt px-3 py-2 text-sm text-white hover:bg-white/10 text-left transition-colors" data-val="30">30s</button>
                <button class="tl-preset-opt px-3 py-2 text-sm text-white hover:bg-white/10 text-left transition-colors" data-val="60">1m</button>
                <button class="tl-preset-opt px-3 py-2 text-sm text-white hover:bg-white/10 text-left transition-colors" data-val="300">5m</button>
              </div>
            </div>
            <button id="tl-btn-loop" class="tl-btn active flex-1 md:flex-none">
              <span class="material-symbols-outlined" style="font-size:16px">repeat</span> Loop
            </button>
            <button id="tl-btn-reset" class="tl-btn flex-1 md:flex-none">
              <span class="material-symbols-outlined" style="font-size:16px">restart_alt</span> Reset
            </button>
            <button id="tl-btn-multi-trim" class="tl-btn flex-1 md:flex-none group flex items-center gap-1 overflow-hidden transition-all duration-300" style="max-width: 32px;">
              <span class="material-symbols-outlined flex-shrink-0" style="font-size:16px">library_add</span>
              <span class="whitespace-nowrap transition-all duration-300 text-xs opacity-0 max-w-0 group-hover:opacity-100 group-hover:max-w-[100px] group-[.active]:opacity-100 group-[.active]:max-w-[100px]">Multi Trim</span>
            </button>
          </div>
        </div>

        <hr class="tl-divider">

        <div class="tl-header" style="padding-bottom: 12px; margin-bottom: 12px;">
          <div style="display:flex;flex-direction:column;align-items:flex-start;gap:2px">
            <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:rgba(255,255,255,0.35);font-weight:600">Durasi Trim</span>
            <span class="tl-current-time text-[12px] sm:text-[14px]" id="tl-duration-label">00:00:00.000</span>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
            <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:rgba(255,255,255,0.35);font-weight:600">Posisi Playback</span>
            <span class="tl-current-time text-[12px] sm:text-[14px] text-white" id="tl-current-time">00:00:00.000</span>
          </div>
        </div>

        <div class="tl-scroll-area" id="tl-scroll-area">
          <div class="tl-track-wrapper" id="tl-track-wrapper">
            <!-- Ruler Container -->
            <div class="tl-ruler" id="tl-ruler"></div>
            
            <!-- Multi Trim Overlays (Moved outside zoom container so labels aren't clipped) -->
            <div class="tl-multi-trim-container" id="tl-multi-trim-container"></div>
            
            <div class="tl-zoom-container" id="tl-zoom-container">
              <!-- Empty state: visible when no media is loaded -->
              <div class="tl-empty-state" id="tl-empty-state">
                <span class="material-symbols-outlined">video_file</span>
                <span>Pilih format dan kualitas untuk memuat timeline</span>
              </div>

              <div class="tl-thumbnails" id="tl-thumbnails"></div>

              <div class="tl-overlay tl-overlay-left" id="tl-overlay-left"></div>
              <div class="tl-selection-box" id="tl-selection-box"></div>
              <div class="tl-overlay tl-overlay-right" id="tl-overlay-right"></div>

              <div class="tl-handle tl-handle-left" id="tl-handle-start"></div>
              <div class="tl-handle tl-handle-right" id="tl-handle-end"></div>

              <div class="tl-playhead" id="tl-playhead"></div>
              <div class="tl-playhead-hitbox" id="tl-playhead-hitbox"></div>
              <div class="tl-tooltip" id="tl-tooltip">00:00:00.000</div>
            </div>
          </div>
        </div>

        <div class="w-full flex justify-between items-center mt-3">
          <div class="flex items-center gap-2">
            <label style="font-size: 10px; color: rgba(255,255,255,0.4); font-weight: 600; letter-spacing: 0.08em;">IN</label>
            <input type="text" id="tl-input-start" class="tl-time-input" value="00:00:00.000" style="background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, 0.08); color: white; padding: 4px 8px; border-radius: 6px; width: 106px; text-align: center; font-size: 12px; font-family: monospace;">
          </div>
          <div class="flex items-center gap-2">
            <label style="font-size: 10px; color: rgba(255,255,255,0.4); font-weight: 600; letter-spacing: 0.08em;">OUT</label>
            <input type="text" id="tl-input-end" class="tl-time-input" value="00:00:00.000" style="background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, 0.08); color: white; padding: 4px 8px; border-radius: 6px; width: 106px; text-align: center; font-size: 12px; font-family: monospace;">
          </div>
        </div>
      </div>
    `;

    this.elements = {
      scrollArea:     this.container.querySelector('#tl-scroll-area'),
      trackWrapper:   this.container.querySelector('#tl-track-wrapper'),
      zoomContainer:  this.container.querySelector('#tl-zoom-container'),
      emptyState:     this.container.querySelector('#tl-empty-state'),
      thumbnails:     this.container.querySelector('#tl-thumbnails'),
      ruler:          this.container.querySelector('#tl-ruler'),
      multiTrimContainer: this.container.querySelector('#tl-multi-trim-container'),
      overlayLeft:    this.container.querySelector('#tl-overlay-left'),
      overlayRight:   this.container.querySelector('#tl-overlay-right'),
      selectionBox:   this.container.querySelector('#tl-selection-box'),
      handleStart:    this.container.querySelector('#tl-handle-start'),
      handleEnd:      this.container.querySelector('#tl-handle-end'),
      playhead:       this.container.querySelector('#tl-playhead'),
      playheadHitbox: this.container.querySelector('#tl-playhead-hitbox'),
      tooltip:        this.container.querySelector('#tl-tooltip'),
      inputStart:     this.container.querySelector('#tl-input-start'),
      inputEnd:       this.container.querySelector('#tl-input-end'),
      durationLabel:  this.container.querySelector('#tl-duration-label'),
      currentTimeLabel: this.container.querySelector('#tl-current-time'),
      btnPlay:        this.container.querySelector('#tl-btn-play'),
      btnMute:        this.container.querySelector('#tl-btn-mute'),
      btnLoop:        this.container.querySelector('#tl-btn-loop'),
      btnReset:       this.container.querySelector('#tl-btn-reset'),
      btnMultiTrim:   this.container.querySelector('#tl-btn-multi-trim'),
      btnSetIn:       this.container.querySelector('#tl-btn-set-in'),
      btnSetOut:      this.container.querySelector('#tl-btn-set-out'),
      btnPresetToggle:this.container.querySelector('#tl-btn-preset-toggle'),
      presetDropdown: this.container.querySelector('#tl-preset-dropdown'),
      presetOpts:     this.container.querySelectorAll('.tl-preset-opt')
    };
  }

  setupEvents() {
    const { elements, engine } = this;
    
    // Drag Handles
    const startDrag = (target) => (e) => {
      this.isDragging = true;
      this.dragTarget = target;
      document.addEventListener('mousemove', onDrag);
      document.addEventListener('mouseup', endDrag);
      document.addEventListener('touchmove', onDrag, { passive: false });
      document.addEventListener('touchend', endDrag);
    };

    const onDrag = (e) => {
      if (!this.isDragging) return;
      e.preventDefault();
      
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const rect = elements.zoomContainer.getBoundingClientRect();
      let percent = (clientX - rect.left) / rect.width;
      percent = Math.max(0, Math.min(1, percent));
      
      let time = percent * engine.selection.duration;
      
      // Auto Snap (100ms) unless Alt key is pressed
      if (!e.altKey) {
        time = Math.round(time * 10) / 10; 
      }

      if (this.dragTarget === 'start') engine.selection.setStart(time);
      else if (this.dragTarget === 'end') engine.selection.setEnd(time);
      else if (this.dragTarget === 'playhead') {
        const clampedTime = Math.max(engine.selection.start, Math.min(time, engine.selection.end));
        engine.selection.setPlayhead(clampedTime);
      }

      this.updateAll();
    };

    const endDrag = () => {
      this.isDragging = false;
      this.dragTarget = null;
      document.removeEventListener('mousemove', onDrag);
      document.removeEventListener('mouseup', endDrag);
      document.removeEventListener('touchmove', onDrag);
      document.removeEventListener('touchend', endDrag);
    };

    elements.handleStart.addEventListener('mousedown', startDrag('start'));
    elements.handleStart.addEventListener('touchstart', startDrag('start'));
    
    elements.handleEnd.addEventListener('mousedown', startDrag('end'));
    elements.handleEnd.addEventListener('touchstart', startDrag('end'));

    elements.playheadHitbox.addEventListener('mousedown', startDrag('playhead'));
    elements.playheadHitbox.addEventListener('touchstart', startDrag('playhead'));

    // Track click to move playhead (Single click ONLY moves, no locking/unlocking)
    elements.trackWrapper.addEventListener('click', (e) => {
      if (this.isDragging || e.target.classList.contains('tl-handle')) return;
      const rect = elements.zoomContainer.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      let time = percent * engine.selection.duration;
      
      // Snap to current locked selection
      time = Math.max(engine.selection.start, Math.min(time, engine.selection.end));
      engine.selection.setPlayhead(time);
      
      this.updateAll();
      if (this.engine.playback && !this.engine.playback.isPlaying) {
        this.engine.playback.seek(engine.selection.playhead, true);
      }
    });

    // Double click to Lock/Unlock trims
    elements.trackWrapper.addEventListener('dblclick', (e) => {
      if (this.isDragging || e.target.classList.contains('tl-handle')) return;
      const rect = elements.zoomContainer.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      let time = percent * engine.selection.duration;
      
      const trims = typeof window !== 'undefined' && window.customTrims ? window.customTrims : [];

      // Double click inside a saved clip → lock to it
      const clickedTrim = trims.find(t => time >= t.start && time <= t.end);
      if (clickedTrim) {
        // Uncheck all other clips to make selection exclusive on double-click
        trims.forEach(t => {
          if (t.id !== clickedTrim.id) t.checked = false;
        });

        window.activeTrimId = null; // disable sync briefly
        engine.selection.setRange(clickedTrim.start, clickedTrim.end);
        engine.selection.setPlayhead(time);
        window.activeTrimId = clickedTrim.id; // re-enable sync

        clickedTrim.checked = true;
        if (typeof window.updateCustomTrimUI === 'function') window.updateCustomTrimUI();
      } else if (window.activeTrimId) {
        // Double click outside + a trim is currently locked → unlock and reset handles to full video
        const activeTrim = trims.find(t => t.id === window.activeTrimId);
        if (activeTrim && activeTrim.checked) {
          activeTrim.checked = false;
          if (typeof window.updateCustomTrimUI === 'function') window.updateCustomTrimUI();
        }
        window.activeTrimId = null;
        engine.selection.setRange(0, engine.selection.duration);
        time = Math.max(0, Math.min(time, engine.selection.duration));
        engine.selection.setPlayhead(time);
      } else {
        // Double click outside + nothing locked (trim belum di-save) → jangan sentuh handles, cuma geser playhead
        time = Math.max(engine.selection.start, Math.min(time, engine.selection.end));
        engine.selection.setPlayhead(time);
      }
      
      this.renderMultiTrims();
      this.updateAll();
      if (this.engine.playback && !this.engine.playback.isPlaying) {
        this.engine.playback.seek(engine.selection.playhead, true);
      }
    });

    // Hover Tooltip
    elements.trackWrapper.addEventListener('mousemove', (e) => {
      const rect = elements.zoomContainer.getBoundingClientRect();
      let percent = (e.clientX - rect.left) / rect.width;
      percent = Math.max(0, Math.min(1, percent));
      const time = percent * engine.selection.duration;
      elements.tooltip.textContent = formatTime(time);
      elements.tooltip.style.left = `${percent * 100}%`;
    });

    // Inputs
    elements.inputStart.addEventListener('change', (e) => {
      engine.selection.setStart(parseTime(e.target.value));
      this.updateAll();
    });
    elements.inputEnd.addEventListener('change', (e) => {
      engine.selection.setEnd(parseTime(e.target.value));
      this.updateAll();
    });

    // Buttons
    elements.btnPlay.addEventListener('click', () => {
      engine.playback.togglePlay();
    });
    elements.btnLoop.addEventListener('click', () => {
      engine.playback.loopSelection = !engine.playback.loopSelection;
      elements.btnLoop.classList.toggle('active', engine.playback.loopSelection);
    });
    elements.btnReset.addEventListener('click', () => engine.selection.reset());
    if (elements.btnMultiTrim) {
      elements.btnMultiTrim.addEventListener('click', () => {
        if (elements.btnMultiTrim.disabled) return;
        const row = document.getElementById('multiTrimContainer');
        if (row) {
          const isHidden = row.classList.toggle('hidden');
          const isActive = !isHidden;
          elements.btnMultiTrim.classList.toggle('active', isActive);
          if (isActive) {
            elements.btnMultiTrim.style.maxWidth = '120px';
            
            // Auto-save existing selection if they had one before toggling Multi Trim
            const isFullVideo = (engine.selection.start === 0 && engine.selection.end === engine.selection.duration);
            if (!isFullVideo) {
              const addBtn = document.getElementById('addCustomTrimBtn');
              if (addBtn) addBtn.click();
            }
            
          } else if (!elements.btnMultiTrim.matches(':hover')) {
            elements.btnMultiTrim.style.maxWidth = '32px';
          }
          if (!isActive) {
            window.activeTrimId = null;
            engine.selection.reset();
            this.setZoom(1);
          }
          this.renderMultiTrims();
          if (typeof window.updateTrimCount === 'function') {
            window.updateTrimCount();
          }
        }
      });
      // Also apply CSS change on hover using JS to override the max-width style smoothly
      elements.btnMultiTrim.addEventListener('mouseenter', () => {
        if (!elements.btnMultiTrim.disabled) {
          elements.btnMultiTrim.style.maxWidth = '120px';
        }
      });
      elements.btnMultiTrim.addEventListener('mouseleave', () => {
        if (!elements.btnMultiTrim.classList.contains('active')) {
          elements.btnMultiTrim.style.maxWidth = '32px';
        }
      });
    }

    // Mute
    elements.btnMute.addEventListener('click', () => {
      if (engine.playback.videoEl) {
        engine.playback.videoEl.muted = !engine.playback.videoEl.muted;
        elements.btnMute.innerHTML = engine.playback.videoEl.muted
          ? '<span class="material-symbols-outlined" style="font-size:16px">volume_off</span> Unmute'
          : '<span class="material-symbols-outlined" style="font-size:16px">volume_up</span> Mute';
        elements.btnMute.classList.toggle('active', engine.playback.videoEl.muted);
      }
    });

    // Set IN / OUT
    if (elements.btnSetIn) {
      elements.btnSetIn.addEventListener('click', () => {
        engine.selection.setStart(engine.selection.playhead);
        this.updateAll();
      });
    }
    if (elements.btnSetOut) {
      elements.btnSetOut.addEventListener('click', () => {
        engine.selection.setEnd(engine.selection.playhead);
        this.updateAll();
      });
    }

    // Presets Custom Dropdown
    if (elements.btnPresetToggle && elements.presetDropdown) {
      elements.btnPresetToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        elements.presetDropdown.classList.toggle('hidden');
      });

      document.addEventListener('click', (e) => {
        if (!elements.btnPresetToggle.contains(e.target) && !elements.presetDropdown.contains(e.target)) {
          elements.presetDropdown.classList.add('hidden');
        }
      });

      elements.presetOpts.forEach(opt => {
        opt.addEventListener('click', (e) => {
          const val = parseFloat(opt.getAttribute('data-val'));
          if (val > 0) {
            engine.selection.applyPreset(val);
          }
          elements.presetDropdown.classList.add('hidden');
        });
      });
    }

    // Right-click drag to pan (horizontal scroll)
    let isPanning = false;
    let panStartX = 0;
    let panScrollLeft = 0;

    elements.scrollArea.addEventListener('mousedown', (e) => {
      if (e.button === 2) { // Right click
        e.preventDefault();
        isPanning = true;
        panStartX = e.clientX;
        panScrollLeft = elements.scrollArea.scrollLeft;
        elements.scrollArea.style.cursor = 'grabbing';
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!isPanning) return;
      e.preventDefault();
      const dx = e.clientX - panStartX;
      elements.scrollArea.scrollLeft = panScrollLeft - dx;
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 2 && isPanning) {
        isPanning = false;
        elements.scrollArea.style.cursor = '';
      }
    });

    elements.scrollArea.addEventListener('contextmenu', (e) => {
      e.preventDefault(); // Prevent standard right-click menu
    });

    // Zoom functionality
    elements.scrollArea.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        // Use multiplicative zoom for smoother scaling across huge ranges
        const newZoom = e.deltaY < 0 ? this.zoomLevel * 1.25 : this.zoomLevel / 1.25;
        this.setZoom(newZoom, e.clientX);
      }
    }, { passive: false });

    // Simple Pinch-to-zoom for mobile
    let initialPinchDistance = null;
    let initialZoomLevel = 1;
    elements.scrollArea.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        initialPinchDistance = Math.sqrt(dx*dx + dy*dy);
        initialZoomLevel = this.zoomLevel;
      }
    }, { passive: false });

    elements.scrollArea.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && initialPinchDistance) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const scale = dist / initialPinchDistance;
        
        // Calculate center of pinch
        const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        this.setZoom(initialZoomLevel * scale, centerX);
      }
    }, { passive: false });

    elements.scrollArea.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        initialPinchDistance = null;
      }
    });
  }

  setZoom(newZoom, originX) {
    const oldZoom = this.zoomLevel;
    this.zoomLevel = Math.max(1, Math.min(newZoom, 10000)); // Min 1x, Max 10000x
    
    // Calculate new width
    this.elements.trackWrapper.style.width = `${this.zoomLevel * 100}%`;
    
    // Adjust scroll to keep mouse/touch point centered
    if (this.elements.scrollArea && originX) {
      const scrollLeft = this.elements.scrollArea.scrollLeft;
      const rect = this.elements.scrollArea.getBoundingClientRect();
      const relativeX = originX - rect.left;
      
      const ratio = this.zoomLevel / oldZoom;
      const newScrollLeft = (scrollLeft + relativeX) * ratio - relativeX;
      
      this.elements.scrollArea.scrollLeft = newScrollLeft;
    }

    // Ask for a denser filmstrip as the user zooms in (debounced + cached inside)
    if (this.engine.thumbnails) {
      this.engine.thumbnails.onZoomChange(this.zoomLevel);
    }
    
    // Re-render ruler since widths changed
    this.renderRuler();
  }

  renderRuler() {
    const { selection } = this.engine;
    if (selection.duration === 0 || !this.elements.ruler) return;
    
    const trackWidth = this.elements.trackWrapper.offsetWidth;
    const pxPerSec = trackWidth / selection.duration;
    
    // We want at least ~70px between labels to prevent overlapping text
    const minPxSpacing = 70;
    const minInterval = minPxSpacing / pxPerSec;
    
    const niceIntervals = [
      1, 2, 5, 10, 15, 30,       // seconds
      60, 120, 300, 600, 900, 1800, // 1m, 2m, 5m, 10m, 15m, 30m
      3600, 7200, 14400, 28800   // 1h, 2h, 4h, 8h
    ];
    
    let interval = niceIntervals.find(inv => inv >= minInterval);
    if (!interval) {
       // Fallback for extremely long videos on tiny screens
       interval = Math.ceil(minInterval / 3600) * 3600; 
    }
    
    const count = Math.ceil(selection.duration / interval);
    const frag = document.createDocumentFragment();
    
    for (let i = 0; i <= count; i++) {
      const time = i * interval;
      if (time > selection.duration) break;
      
      const pct = (time / selection.duration) * 100;
      
      const tick = document.createElement('div');
      tick.className = 'tl-tick-major';
      tick.style.left = `${pct}%`;
      
      const label = document.createElement('div');
      label.className = 'tl-tick-label';
      label.textContent = formatTime(time);
      tick.appendChild(label);
      
      frag.appendChild(tick);
    }
    
    this.elements.ruler.innerHTML = '';
    this.elements.ruler.appendChild(frag);
  }

  renderMultiTrims() {
    if (!this.elements.multiTrimContainer) return;
    
    // Check if toggle is active
    if (this.elements.btnMultiTrim && !this.elements.btnMultiTrim.classList.contains('active')) {
       this.elements.multiTrimContainer.innerHTML = '';
       return;
    }
    
    const allTrims = typeof window !== 'undefined' && window.customTrims ? window.customTrims : [];
    
    const { selection } = this.engine;
    if (selection.duration === 0) return;
    
    const frag = document.createDocumentFragment();
    
    // Merge trims to find solid selected regions for gap calculation
    let intervals = allTrims.map(t => ({ start: t.start, end: t.end }));
    
    // Also add the current active selection if we are creating a new clip
    if (typeof window !== 'undefined' && window.activeTrimId === null && selection.end > selection.start) {
      intervals.push({ start: selection.start, end: selection.end });
    }
    
    intervals.sort((a, b) => a.start - b.start);
    let merged = [];
    if (intervals.length > 0) {
      merged.push({ ...intervals[0] });
      for (let i = 1; i < intervals.length; i++) {
        let last = merged[merged.length - 1];
        let curr = intervals[i];
        if (curr.start <= last.end) {
          last.end = Math.max(last.end, curr.end);
        } else {
          merged.push({ ...curr });
        }
      }
    }
    
    // Draw dark gap overlays for unselected parts
    let currentPos = 0;
    merged.forEach(m => {
      if (m.start > currentPos) {
        let gap = document.createElement('div');
        gap.style.position = 'absolute';
        gap.style.top = '0';
        gap.style.height = '100%';
        gap.style.background = 'transparent'; // No darkening per user request
        gap.style.zIndex = '2';
        gap.style.pointerEvents = 'none';
        gap.style.left = `${(currentPos / selection.duration) * 100}%`;
        gap.style.width = `${((m.start - currentPos) / selection.duration) * 100}%`;
        frag.appendChild(gap);
      }
      currentPos = Math.max(currentPos, m.end);
    });
    // Final gap
    if (currentPos < selection.duration) {
      let gap = document.createElement('div');
      gap.style.position = 'absolute';
      gap.style.top = '0';
      gap.style.height = '100%';
      gap.style.background = 'transparent';
      gap.style.zIndex = '2';
      gap.style.pointerEvents = 'none';
      gap.style.left = `${(currentPos / selection.duration) * 100}%`;
      gap.style.width = `${((selection.duration - currentPos) / selection.duration) * 100}%`;
      frag.appendChild(gap);
    }
    
    allTrims.forEach(trim => {
      const startPct = (trim.start / selection.duration) * 100;
      const endPct = (trim.end / selection.duration) * 100;
      
      const box = document.createElement('div');
      box.className = 'tl-multi-trim-box';
      // Force transparent background via JS to bypass CSS cache
      box.style.background = 'transparent';
      box.style.backdropFilter = 'brightness(2) contrast(1.2)';
      if (!trim.checked) {
        box.classList.add('tl-multi-trim-ghost');
        box.style.background = 'rgba(0,0,0,0.5)'; // dim unchecked
        box.style.backdropFilter = 'none';
      }
      if (trim.checked) box.classList.add('checked');
      if (typeof window !== 'undefined' && window.activeTrimId === trim.id) {
        box.classList.add('active');
        box.style.background = 'rgba(106, 176, 243, 0.15)'; // slight tint for active
      }
      
      box.style.left = `${startPct}%`;
      box.style.width = `${endPct - startPct}%`;
      // We don't set pointer-events: auto on the box, so clicks fall through to the track 
      // allowing precise playhead positioning inside the trim.
      
      const label = document.createElement('div');
      label.className = 'tl-multi-trim-label';
      if (trim.checked) label.classList.add('checked');
      if (typeof window !== 'undefined' && window.activeTrimId === trim.id) {
        label.classList.add('active');
      }
      label.textContent = trim.name;
      
      // All trims have double-clickable labels to lock the playhead
      label.style.pointerEvents = 'auto'; // allow clicks
      label.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        
        // Uncheck all other clips
        if (typeof window !== 'undefined' && window.customTrims) {
          window.customTrims.forEach(t => {
            if (t.id !== trim.id) t.checked = false;
          });
        }

        window.activeTrimId = null; // disable sync briefly
        this.engine.selection.setRange(trim.start, trim.end);
        this.engine.selection.setPlayhead(trim.start);
        window.activeTrimId = trim.id; // re-enable sync
        
        trim.checked = true;
        if (typeof window.updateCustomTrimUI === 'function') window.updateCustomTrimUI();
        
        this.renderMultiTrims();
        this.updateAll();
        if (this.engine.playback) this.engine.playback.seek(trim.start, true);
      });
      
      box.appendChild(label);
      
      frag.appendChild(box);
    });
    
    this.elements.multiTrimContainer.innerHTML = '';
    this.elements.multiTrimContainer.appendChild(frag);
  }

  zoomToFitTrims() {
    const trims = typeof window !== 'undefined' && window.getCheckedTrims ? window.getCheckedTrims() : [];
    if (trims.length === 0) return;
    
    const { selection } = this.engine;
    if (selection.duration === 0) return;

    let minStart = Infinity;
    let maxEnd = -Infinity;
    
    trims.forEach(t => {
      if (t.start < minStart) minStart = t.start;
      if (t.end > maxEnd) maxEnd = t.end;
    });
    
    const span = maxEnd - minStart;
    
    // If span covers almost entire video, just reset zoom to 1
    if (span >= selection.duration * 0.95 || span === 0) {
      this.setZoom(1);
      if (this.elements.scrollArea) this.elements.scrollArea.scrollLeft = 0;
      return;
    }
    
    // We want the span to take up about 80% of the visible container width
    const containerWidth = this.elements.scrollArea.clientWidth;
    // zoomLevel = (selection.duration / span) * 0.8
    let desiredZoom = (selection.duration / span) * 0.8;
    
    // Clamp auto zoom level to 15x max so it doesn't zoom too far on short clips
    desiredZoom = Math.max(1, Math.min(desiredZoom, 15));
    
    this.setZoom(desiredZoom);
    
    // Now center the scroll area on the middle of the span
    const midTime = minStart + (span / 2);
    const midPct = midTime / selection.duration;
    
    const trackWidth = this.elements.trackWrapper.offsetWidth; // which is zoomLevel * 100%
    const centerPx = midPct * trackWidth;
    
    this.elements.scrollArea.scrollLeft = centerPx - (containerWidth / 2);
  }

  updateAll() {
    this.updateHandles();
    this.updatePlayhead();
    this.updateInputs();
    this.updateCurrentTimeIndicator();
  }

  updateHandles() {
    const { selection } = this.engine;
    if (selection.duration === 0) return;
    
    const startPct = (selection.start / selection.duration) * 100;
    const endPct = (selection.end / selection.duration) * 100;

    this.elements.handleStart.style.left = `${startPct}%`;
    this.elements.handleEnd.style.left = `${endPct}%`;
    
    const trims = typeof window !== 'undefined' && window.getCheckedTrims ? window.getCheckedTrims() : [];
    if (trims.length > 0) {
      // Hide main selection UI if multi-trims are active so they don't merge visually
      this.elements.overlayLeft.style.display = 'none';
      this.elements.overlayRight.style.display = 'none';
      if (typeof window !== 'undefined' && window.activeTrimId) {
        this.elements.handleStart.style.display = 'flex';
        this.elements.handleEnd.style.display = 'flex';
        this.elements.handleStart.style.zIndex = '50';
        this.elements.handleEnd.style.zIndex = '50';
        this.elements.selectionBox.style.display = 'none';
      } else {
        this.elements.handleStart.style.display = 'flex';
        this.elements.handleEnd.style.display = 'flex';
        this.elements.handleStart.style.zIndex = '50';
        this.elements.handleEnd.style.zIndex = '50';
        this.elements.selectionBox.style.display = 'block';
        this.elements.selectionBox.style.left = `${startPct}%`;
        this.elements.selectionBox.style.width = `${endPct - startPct}%`;
      }
    } else {
      // Show normally
      this.elements.overlayLeft.style.display = 'block';
      this.elements.overlayRight.style.display = 'block';
      this.elements.selectionBox.style.display = 'block';
      this.elements.handleStart.style.display = 'flex';
      this.elements.handleEnd.style.display = 'flex';
      
      this.elements.overlayLeft.style.width = `${startPct}%`;
      this.elements.overlayRight.style.width = `${100 - endPct}%`;
      
      this.elements.selectionBox.style.left = `${startPct}%`;
      this.elements.selectionBox.style.width = `${endPct - startPct}%`;
    }
  }

  updatePlayhead() {
    const { selection } = this.engine;
    if (selection.duration === 0) return;
    const pct = (selection.playhead / selection.duration) * 100;
    this.elements.playhead.style.left = `${pct}%`;
    this.elements.playheadHitbox.style.left = `${pct}%`;
    this.updateCurrentTimeIndicator();
    
    // Auto-scroll logic if zoomed in and playing
    if (this.zoomLevel > 1 && this.engine.playback && this.engine.playback.isPlaying) {
      const scrollArea = this.elements.scrollArea;
      const trackWidth = this.elements.trackWrapper.offsetWidth;
      const playheadX = (pct / 100) * trackWidth;
      
      const visibleLeft = scrollArea.scrollLeft;
      const visibleRight = scrollArea.scrollLeft + scrollArea.clientWidth;
      
      // If playhead approaches the right edge (within 10% of viewport width)
      if (playheadX > visibleRight - (scrollArea.clientWidth * 0.1)) {
        // Scroll so playhead is at 20% from the left (as requested: "kurang lebih posisi nya disitu ga terlalu di pojok kiri banget")
        scrollArea.scrollLeft = playheadX - (scrollArea.clientWidth * 0.2);
      }
      
      // Also handle jumping backwards
      if (playheadX < visibleLeft + (scrollArea.clientWidth * 0.05)) {
        scrollArea.scrollLeft = playheadX - (scrollArea.clientWidth * 0.5);
      }
    }
  }

  updateInputs() {
    const { selection } = this.engine;
    this.elements.inputStart.value = formatTime(selection.start);
    this.elements.inputEnd.value = formatTime(selection.end);
    
    // Accumulate total duration if multi-trims exist
    const trims = typeof window !== 'undefined' && window.getCheckedTrims ? window.getCheckedTrims() : [];
    if (trims.length > 0) {
      let totalDuration = 0;
      trims.forEach(t => {
        totalDuration += (t.end - t.start);
      });
      this.elements.durationLabel.textContent = formatTime(totalDuration);
    } else {
      this.elements.durationLabel.textContent = formatTime(selection.end - selection.start);
    }
  }

  updateCurrentTimeIndicator() {
    this.elements.currentTimeLabel.textContent = formatTime(this.engine.selection.playhead);
  }
}

class KeyboardController {
  constructor(engine) {
    this.engine = engine;
    this.onKeyDown = this.onKeyDown.bind(this);
  }
  mount() {
    document.addEventListener('keydown', this.onKeyDown);
  }
  unmount() {
    document.removeEventListener('keydown', this.onKeyDown);
  }
  onKeyDown(e) {
    if (!this.engine.ui.container.offsetParent) return; // Only if visible
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return; // Ignore if typing

    const { selection, playback } = this.engine;
    if (e.code === 'Space') {
      e.preventDefault();
      playback.togglePlay();
      return;
    }

    let step = 0;
    if (e.key === 'ArrowLeft') step = -0.1;
    if (e.key === 'ArrowRight') step = 0.1;

    if (step !== 0) {
      if (e.shiftKey) step *= 10; // 1s
      if (e.ctrlKey) step *= 50; // 5s
      let newTime = selection.playhead + step;
      newTime = Math.max(selection.start, Math.min(newTime, selection.end));
      selection.setPlayhead(newTime);
      this.engine.ui.updatePlayhead();
      e.preventDefault();
    }

    if (e.key === 'Home') {
      selection.setPlayhead(selection.start);
      e.preventDefault();
    }
    if (e.key === 'End') {
      selection.setPlayhead(selection.end);
      e.preventDefault();
    }
    if (e.key === ' ') {
      playback.togglePlay();
      e.preventDefault();
    }
  }
}

class TimelineEngine {
  constructor() {
    this.thumbnails = new ThumbnailProvider(this);
    this.selection = new SelectionManager(this);
    this.playback = new PlaybackController(this);
    this.ui = new UIController(this);
    this.keyboard = new KeyboardController(this);
  }

  mount(containerElement, videoElement) {
    this.ui.mount(containerElement);
    this.thumbnails.mount(this.ui.elements.thumbnails);
    // Pass video element to ThumbnailProvider for canvas-based frame capture
    this.thumbnails.setVideoElement(videoElement);
    this.playback.mount(videoElement);
    this.keyboard.mount();
  }

  loadMedia(url, duration, videoId = null, userAgent = null) {
    this.selection.setDuration(duration);
    this.ui.setZoom(1); // Reset zoom level for new video
    this.ui.renderMultiTrims(); // Clear/refresh overlays
    this.ui.updateAll();
    // Hide empty state once media is loaded
    if (this.ui.elements.emptyState) {
      this.ui.elements.emptyState.style.display = 'none';
    }
    this.thumbnails.loadMedia(url, duration, videoId, userAgent);
  }

  getSelection() {
    return {
      start: this.selection.start,
      end: this.selection.end
    };
  }
}

// Attach to window globally
window.TimelineEngine = TimelineEngine;
