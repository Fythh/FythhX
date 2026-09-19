// public/clipper.js
// Frontend logic for Heatmap Clipper UI. Wrapped in IIFE to avoid polluting global scope.

(() => {
  // ---------- DOM Elements ----------
  const clipperSegPanel = document.getElementById('clipperSegPanel');
  const clipperSegMeta = document.getElementById('clipperSegMeta');
  const clipperSelAll = document.getElementById('clipperSelAll');
  const clipperSelClear = document.getElementById('clipperSelClear');
  const clipperSelCount = document.getElementById('clipperSelCount');
  const clipperSegments = document.getElementById('clipperSegments');
  const clipperSettings = document.getElementById('clipperSettings');
  const clipperCrop = document.getElementById('clipperCrop');
  const clipperRatio = document.getElementById('clipperRatio');
  const clipperPadding = document.getElementById('clipperPadding');
  const clipperMaxClips = document.getElementById('clipperMaxClips');
  const clipperSubtitle = document.getElementById('clipperSubtitle');
  const clipperWhisperModel = document.getElementById('clipperWhisperModel');
  const clipperFontSel = document.getElementById('clipperFontSel');
  const clipperFontCustom = document.getElementById('clipperFontCustom');
  const clipperSubLoc = document.getElementById('clipperSubLoc');
  const clipperDraftBtn = document.getElementById('clipperDraftBtn');
  const subtitleModal = document.getElementById('subtitleModal');
  const closeSubtitleModal = document.getElementById('closeSubtitleModal');
  const saveSubtitleBtn = document.getElementById('saveSubtitleBtn');
  const subtitleEditorContainer = document.getElementById('subtitleEditorContainer');
  let currentDraftSubtitleData = null; // Store edited JSON here
  let currentDraftSegment = null; // Store segment to render later
  const clipperProgressPanel = document.getElementById('clipperProgressPanel');
  const clipperProgressBar = document.getElementById('clipperProgressBar');
  const clipperProgressText = document.getElementById('clipperProgressText');
  const clipperLogsContainer = document.getElementById('clipperLogsContainer');
  const clipperOutputs = document.getElementById('clipperOutputs');
  const clipperJobMeta = document.getElementById('clipperJobMeta');

  // ---------- State ----------
  const state = {
    videoId: null,
    previewInfo: null,
    segments: [],
    selectedSegments: new Set(),
    jobId: null,
    jobStartTime: null,
    pollingInterval: null,
    deps: null,
    isProcessing: false,
    previewClipIndex: 0,
    lastPreviewedUrl: '',
    previewIsPlaying: true,
    previewIsMuted: false,
    // Referensi object clip yang sedang aktif di canvas preview
    // Di-track by identity (===) bukan by index, agar tidak bergeser saat
    // user select/unselect klip lain di Most Replayed / Import From Trim
    activePreviewClip: null,
  };

  // ---------- Helper Functions ----------
  const extractVideoId = (url) => {
    try {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      const parsed = new URL(url);
      if (parsed.hostname === 'youtu.be' || parsed.hostname === 'www.youtu.be') {
        return parsed.pathname.slice(1);
      }
      if (parsed.hostname === 'youtube.com' || parsed.hostname === 'www.youtube.com') {
        if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
        if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.split('/')[2];
        if (parsed.pathname.startsWith('/live/')) return parsed.pathname.split('/')[2];
        if (parsed.pathname.startsWith('/embed/')) return parsed.pathname.split('/')[2];
      }
      return null;
    } catch (e) {
      return null;
    }
  };

  const showToast = (title, message, type = 'success') => {
    // Reuse same toast template from main app
    const toastTemplate = document.getElementById('toastTemplate');
    const toastContainer = document.getElementById('toastContainer');
    const clone = toastTemplate.content.cloneNode(true);
    const toastItem = clone.querySelector('.toast-item');
    const toastIcon = clone.querySelector('.toast-icon');
    const toastTitle = clone.querySelector('.toast-title');
    const toastMessage = clone.querySelector('.toast-message');
    const closeBtn = clone.querySelector('.toast-close');
    toastTitle.textContent = title;
    toastMessage.textContent = message;
    if (type === 'success') {
      toastItem.classList.add('border-success');
      toastIcon.textContent = 'check_circle';
    } else {
      toastItem.classList.add('border-error');
      toastIcon.textContent = 'error';
    }
    toastContainer.appendChild(toastItem);
    const timeout = setTimeout(() => {
      toastItem.remove();
    }, 5000);
    closeBtn.addEventListener('click', () => {
      clearTimeout(timeout);
      toastItem.remove();
    });
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  };

  const updateSelCount = () => {
    clipperSelCount.textContent = `${state.selectedSegments.size} selected`;
  };

  const getCombinedSegments = () => {
    const combined = [...state.segments];
    if (window.customTrims && window.customTrims.length > 0) {
      window.customTrims.forEach(trim => {
        combined.push({
          start: trim.start,
          duration: trim.end - trim.start,
          isCustom: true,
          customName: trim.name
        });
      });
    }
    return combined;
  };

  const updateCanvasPreviewClips = async (forceAutoplay = false, uiOnly = false) => {
    const combinedSegments = getCombinedSegments();
    const selected = combinedSegments.filter(seg => {
      const key = `${Math.round(seg.start * 1000)}:${Math.round(seg.duration * 1000)}`;
      return state.selectedSegments.has(key);
    });

    const nav = document.getElementById('clipperPreviewNav');
    const iframeTop = document.getElementById('iframeTop');
    const iframeBottom = document.getElementById('iframeBottom');
    const container = document.getElementById('previewVideoContainer');
    const lbl = document.getElementById('clipperPreviewLabelText');
    const dropdown = document.getElementById('clipperPreviewDropdown');
    const audioPreview = document.getElementById('clipperAudioPreview');

    if (!nav || !iframeTop || !lbl) return;

    // Always show nav now so it looks like a proper tool panel
    nav.classList.remove('hidden');
    nav.classList.add('flex');

    if (selected.length === 0 || !state.videoId) {
      // Jeda semua media sebelum kosongkan
      iframeTop.pause();
      if (iframeBottom) iframeBottom.pause();
      if (audioPreview) audioPreview.pause();
      lbl.textContent = 'Belum dipilih';
      if (dropdown) dropdown.innerHTML = '';
      if (container) container.classList.add('hidden');
      state.lastPreviewedUrl = '';
      state.activePreviewClip = null; // Reset tracking
      iframeTop.src = '';
      if (iframeBottom) iframeBottom.src = '';
      if (audioPreview) audioPreview.src = '';
      return;
    }

    if (container) container.classList.remove('hidden');

    // ── TENTUKAN CLIP YANG AKAN DITAMPILKAN ────────────────────────────────────
    // Prioritas:
    //  1. uiOnly mode + ada activePreviewClip yang masih di-select
    //     → temukan by object reference, jangan pakai index (index bisa geser)
    //  2. uiOnly mode + activePreviewClip di-unselect → fall through ke reload
    //  3. Normal mode → pakai previewClipIndex (clamped)
    let currentClip;

    if (uiOnly && state.activePreviewClip) {
      const pinnedIdx = selected.findIndex(seg => seg === state.activePreviewClip);
      if (pinnedIdx !== -1) {
        // Clip yang sedang dipreview masih ada di selection
        // Update index supaya sinkron, tapi JANGAN reload video
        state.previewClipIndex = pinnedIdx;
        currentClip = state.activePreviewClip;

        // Helper label
        const getLabelName = (seg, idx) => seg.isCustom ? seg.customName : `Klip ${idx}`;
        const globalIdxP = state.segments.findIndex(s => s === currentClip);
        const displayIdxP = globalIdxP !== -1 ? globalIdxP + 1 : pinnedIdx + 1;
        const currentNameP = getLabelName(currentClip, displayIdxP);
        lbl.innerHTML = `${currentClip.isCustom ? '<span class="bg-primary/20 text-primary px-1 py-0.5 rounded text-[8px] font-bold mr-1">CUSTOM</span>' : ''}${currentNameP} <span class="text-white/50 text-[10px] ml-1">(${pinnedIdx + 1}/${selected.length})</span>`;

        // Rebuild dropdown (list berubah tapi video tidak)
        if (dropdown) {
          const getV = (id) => { const val = document.getElementById(id)?.value; return val ? parseFloat(val) : null; };
          const applyCustom = (iframe, container, type, defZoom, defX, defY) => {
            const z = getV(type === 'game' ? 'clipperGameZoom' : 'clipperCamZoom') ?? defZoom;
            const x = getV(type === 'game' ? 'clipperGameX' : 'clipperCamX') ?? defX;
            const y = getV(type === 'game' ? 'clipperGameY' : 'clipperCamY') ?? defY;
            
            const iw = 1920, ih = 1080;
            const contW = container.offsetWidth || container.clientWidth;
            const contH = container.offsetHeight || container.clientHeight;
            if(!contW || !contH) return;
            
            const S = Math.min(contW / iw, contH / ih);
            const Z = z / 100;
            
            const boxW = iw * S * Z;
            const boxH = ih * S * Z;
            
            const leftPos = (contW - boxW) * (x / 100);
            const topPos = (contH - boxH) * (y / 100);
            
            iframe.style.maxWidth = 'none';
            iframe.style.width = `${boxW}px`;
            iframe.style.height = `${boxH}px`;
            iframe.style.objectFit = 'fill';
            iframe.style.left = `${leftPos}px`;
            iframe.style.top = `${topPos}px`;
            iframe.style.transform = 'none';
          };
          dropdown.innerHTML = '';
          selected.forEach((seg, i) => {
            const segGlobalIdx = combinedSegments.findIndex(s => s === seg) + 1;
            const name = getLabelName(seg, segGlobalIdx || i + 1);
            const itemDiv = document.createElement('div');
            itemDiv.className = `flex items-center justify-between w-full px-1 py-1 hover:bg-white/10 rounded-md transition-colors ${i === pinnedIdx ? 'bg-primary/10' : ''}`;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `flex-grow text-left px-2 py-1 text-xs transition-colors ${i === pinnedIdx ? 'text-primary font-bold' : 'text-white'} truncate`;
            btn.innerHTML = `${seg.isCustom ? '<span class="bg-primary/20 text-primary px-1 py-0.5 rounded text-[8px] font-bold mr-1">CUSTOM</span>' : ''}${name} <span class="text-white/50 text-[10px] ml-1">${formatDuration(seg.start)} - ${formatDuration(seg.start + seg.duration)}</span>`;
            btn.addEventListener('click', () => {
              iframeTop.pause();
              if (iframeBottom) iframeBottom.pause();
              if (document.getElementById('clipperAudioPreview')) document.getElementById('clipperAudioPreview').pause();
              state.previewClipIndex = i;
              updateCanvasPreviewClips(true);
              dropdown.classList.add('hidden');
            });
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'w-6 h-6 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded transition-colors flex-shrink-0 mr-1';
            removeBtn.innerHTML = '<span class="material-symbols-outlined text-[14px]">delete</span>';
            removeBtn.title = 'Hapus klip ini dari antrian';
            removeBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              iframeTop.pause();
              if (iframeBottom) iframeBottom.pause();
              if (document.getElementById('clipperAudioPreview')) document.getElementById('clipperAudioPreview').pause();
              const k = `${Math.round(seg.start * 1000)}:${Math.round(seg.duration * 1000)}`;
              state.selectedSegments.delete(k);
              const card = document.querySelector(`.seg-card[data-key="${k}"]`);
              if (card) { const cb = card.querySelector('input[type="checkbox"]'); if (cb) cb.checked = false; card.classList.remove('border-primary', 'bg-primary/5'); }
              if (typeof updateSelCount === 'function') updateSelCount();
              updateCanvasPreviewClips(false);
              if (state.selectedSegments.size === 0) dropdown.classList.add('hidden');
            });
            itemDiv.appendChild(btn);
            itemDiv.appendChild(removeBtn);
            dropdown.appendChild(itemDiv);
          });
        }
        // Clip aktif tidak berubah → tidak perlu menyentuh video sama sekali
        return;
      }
      // activePreviewClip sudah di-uncheck → jatuh ke bawah untuk reload
    }

    // ── NORMAL PATH: tentukan clip via index ──────────────────────────────────
    if (state.previewClipIndex >= selected.length) state.previewClipIndex = 0;
    if (state.previewClipIndex < 0) state.previewClipIndex = selected.length - 1;

    currentClip = selected[state.previewClipIndex];
    state.activePreviewClip = currentClip; // Mulai tracking by reference
    const actualStart = currentClip.start;
    const startSec = Math.floor(actualStart);
    const endSec = Math.floor(actualStart + currentClip.duration);
    
    // Simpan target mulai sebenarnya di state
    state.previewActualStart = actualStart;

    // Dapatkan urutan klip berdasarkan index global
    const globalIdx = state.segments.findIndex(seg => seg === currentClip);
    const displayIdx = globalIdx !== -1 ? globalIdx + 1 : state.previewClipIndex + 1;
    
    const getLabelName = (seg, idx) => {
      if (seg.isCustom) return seg.customName;
      return `Klip ${idx}`;
    };

    const currentName = getLabelName(currentClip, displayIdx);
    lbl.innerHTML = `${currentClip.isCustom ? '<span class="bg-primary/20 text-primary px-1 py-0.5 rounded text-[8px] font-bold mr-1">CUSTOM</span>' : ''}${currentName} <span class="text-white/50 text-[10px] ml-1">(${state.previewClipIndex + 1}/${selected.length})</span>`;

    // Render dropdown list
    if (dropdown) {
      dropdown.innerHTML = '';
      selected.forEach((seg, i) => {
        const segGlobalIdx = combinedSegments.findIndex(s => s === seg) + 1;
        const name = getLabelName(seg, segGlobalIdx || i + 1);
        
        const itemDiv = document.createElement('div');
        itemDiv.className = `flex items-center justify-between w-full px-1 py-1 hover:bg-white/10 rounded-md transition-colors ${i === state.previewClipIndex ? 'bg-primary/10' : ''}`;
        
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `flex-grow text-left px-2 py-1 text-xs transition-colors ${i === state.previewClipIndex ? 'text-primary font-bold' : 'text-white'} truncate`;
        btn.innerHTML = `${seg.isCustom ? '<span class="bg-primary/20 text-primary px-1 py-0.5 rounded text-[8px] font-bold mr-1">CUSTOM</span>' : ''}${name} <span class="text-white/50 text-[10px] ml-1">${formatDuration(seg.start)} - ${formatDuration(seg.start + seg.duration)}</span>`;
        btn.addEventListener('click', () => {
          // Pause again before switching from dropdown
          iframeTop.pause();
          if (iframeBottom) iframeBottom.pause();
          if (document.getElementById('clipperAudioPreview')) document.getElementById('clipperAudioPreview').pause();
          
          state.previewClipIndex = i;
          updateCanvasPreviewClips(true);
          dropdown.classList.add('hidden');
        });
        
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'w-6 h-6 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded transition-colors flex-shrink-0 mr-1';
        removeBtn.innerHTML = '<span class="material-symbols-outlined text-[14px]">delete</span>';
        removeBtn.title = 'Hapus klip ini dari antrian';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          // Pause audio immediately
          iframeTop.pause();
          if (iframeBottom) iframeBottom.pause();
          if (document.getElementById('clipperAudioPreview')) document.getElementById('clipperAudioPreview').pause();

          const key = `${Math.round(seg.start * 1000)}:${Math.round(seg.duration * 1000)}`;
          state.selectedSegments.delete(key);
          
          if (state.previewClipIndex >= state.selectedSegments.size) {
            state.previewClipIndex = Math.max(0, state.selectedSegments.size - 1);
          }
          
          const card = document.querySelector(`.seg-card[data-key="${key}"]`);
          if (card) {
             const cb = card.querySelector('input[type="checkbox"]');
             if (cb) cb.checked = false;
             card.classList.remove('border-primary', 'bg-primary/5');
          }
          
          if (typeof updateSelCount === 'function') updateSelCount();
          updateCanvasPreviewClips(false);
          
          if (state.selectedSegments.size === 0) {
             dropdown.classList.add('hidden');
          }
        });
        
        itemDiv.appendChild(btn);
        itemDiv.appendChild(removeBtn);
        dropdown.appendChild(itemDiv);
      });
    }

    // ── SMART SKIP: kalau clip yang aktif di canvas tidak berubah → skip reload ──
    // (Ini harusnya sudah ditangani di blok uiOnly di atas, tapi sebagai fallback
    // untuk semua path: kalau candidateKey sama dan tidak forceAutoplay, skip.)
    const candidateKey = `native:${state.videoId}:${startSec}:${endSec}`;
    if (!forceAutoplay && state.lastPreviewedUrl === candidateKey) {
      return;
    }

    // Dari sini ke bawah hanya jalan kalau clip BENAR-BENAR ganti atau forceAutoplay

    // Jeda semua media sebelum ganti klip biar audio tidak nyangkut
    iframeTop.pause();
    if (iframeBottom) iframeBottom.pause();
    if (audioPreview) audioPreview.pause();

    // Reset/sembunyikan freeze overlay saat klip baru dimuat
    const freezeTop = document.getElementById('freezeTop');
    const freezeBottom = document.getElementById('freezeBottom');
    if (freezeTop) freezeTop.classList.add('hidden');
    if (freezeBottom) freezeBottom.classList.add('hidden');

    // Update play/pause icon based on forceAutoplay
    state.previewIsPlaying = forceAutoplay;
    const playPauseBtn = document.getElementById('clipperPlayPauseBtn');
    if (playPauseBtn) playPauseBtn.innerHTML = forceAutoplay ? `<span class="material-symbols-outlined text-[16px]">pause</span>` : `<span class="material-symbols-outlined text-[16px]">play_arrow</span>`;

    // Show loader
    const loader = document.getElementById('previewLoader');
    if (loader) loader.classList.remove('hidden');

    // Helper: get native stream URL via /api/clipper/preview
    let fetchedAudioUrl = null;
    const getProxiedVideoUrl = async (videoId) => {
      try {
        const res = await fetch(`/api/clipper/preview?videoId=${videoId}&start=${startSec}&end=${endSec}`);
        const data = await res.json();
        if (data.ok && data.directUrl) {
          if (data.directAudioUrl) fetchedAudioUrl = `/api/proxy?url=${encodeURIComponent(data.directAudioUrl)}`;
          return `/api/proxy?url=${encodeURIComponent(data.directUrl)}`;
        }
      } catch (e) {}
      return null;
    };

    // Ambil proxy url SEKALI SAJA biar loadingnya sinkron barengan
    const proxyUrl = await getProxiedVideoUrl(state.videoId);

    // Use native video: set src and seek to actualStart offset
    const setNativeVideo = (videoEl, seekTime, isMain = false) => {
      if (!videoEl) return;
      if (proxyUrl) {
        videoEl.src = proxyUrl;
        videoEl.currentTime = seekTime;
        videoEl.muted = true;
        videoEl.loop = false;
        
        // Sync Audio and Bottom Video for Main Video
        if (isMain) {
          let audioEl = document.getElementById('clipperAudioPreview');
          if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = 'clipperAudioPreview';
            audioEl.style.display = 'none';
            document.body.appendChild(audioEl);
            
            videoEl.addEventListener('playing', () => {
                if (state.previewIsPlaying) {
                    audioEl.play().catch(()=>{});
                    if (iframeBottom && iframeBottom.paused) iframeBottom.play().catch(()=>{});
                }
            });
            videoEl.addEventListener('waiting', () => {
                audioEl.pause();
                if (iframeBottom) iframeBottom.pause();
            });
            videoEl.addEventListener('pause', () => {
                audioEl.pause();
                if (iframeBottom) iframeBottom.pause();
            });
            videoEl.addEventListener('seeked', () => {
              if (Math.abs(audioEl.currentTime - videoEl.currentTime) > 0.15) {
                audioEl.currentTime = videoEl.currentTime;
              }
              if (iframeBottom && Math.abs(iframeBottom.currentTime - videoEl.currentTime) > 0.15) {
                iframeBottom.currentTime = videoEl.currentTime;
              }
            });
          }
          if (fetchedAudioUrl) {
            audioEl.src = fetchedAudioUrl;
            audioEl.currentTime = seekTime;
            audioEl.muted = false;
          } else {
            videoEl.muted = false; // Fallback if it's combined stream
            audioEl.src = '';
          }
        }
        
        // Set end-time boundary: stop playing at endSec
        const onTimeUpdate = () => {
          if (videoEl.currentTime >= endSec) {
            videoEl.currentTime = actualStart;
          }
          // Strict frame sync for bottom video and audio
          if (isMain) {
             if (iframeBottom) {
                 if (Math.abs(iframeBottom.currentTime - videoEl.currentTime) > 0.15) {
                     iframeBottom.currentTime = videoEl.currentTime;
                 }
             }
             const audioEl = document.getElementById('clipperAudioPreview');
             if (audioEl && !audioEl.paused) {
                 if (Math.abs(audioEl.currentTime - videoEl.currentTime) > 0.15) {
                     audioEl.currentTime = videoEl.currentTime;
                 }
             }
          }
        };
        videoEl.removeEventListener('timeupdate', videoEl._fytxBound);
        videoEl._fytxBound = onTimeUpdate;
        videoEl.addEventListener('timeupdate', onTimeUpdate);
        if (forceAutoplay) {
            videoEl.play().catch(() => {});
        } else {
            videoEl.pause();
        }
      } else {
        // No direct URL available — hide container
        if (container) container.classList.add('hidden');
      }
      if (loader) loader.classList.add('hidden');
    };

    setNativeVideo(iframeTop, actualStart, true);
    if (iframeBottom) setNativeVideo(iframeBottom, actualStart, false);
    
    state.lastPreviewedUrl = candidateKey;

    // Trigger change event para actualizar layout
    const ratioEl = document.getElementById('clipperRatio');
    if (ratioEl) ratioEl.dispatchEvent(new Event('change'));
  };

  window.renderClipperSegments = () => { renderSegments(); };

  const renderSegments = () => {
    clipperSegments.innerHTML = '';
    
    // Separate heatmap segments and custom trims
    const heatmapSegments = state.segments;
    const hasHeatmap = heatmapSegments.length > 0;
    const hasCustomTrims = window.customTrims && window.customTrims.length > 0;
    
    const combinedSegments = [...heatmapSegments];
    if (hasCustomTrims) {
      window.customTrims.forEach(trim => {
        combinedSegments.push({
          start: trim.start,
          duration: trim.end - trim.start,
          isCustom: true,
          customName: trim.name
        });
      });
    }

    // Create Grid Container
    const gridContainer = document.createElement('div');
    gridContainer.className = `grid gap-4 w-full ${(hasHeatmap && hasCustomTrims) ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`;

    let heatmapList, customList;

    if (hasHeatmap) {
      // Left Column: Most Replay
      const leftCol = document.createElement('div');
      leftCol.className = 'flex flex-col w-full h-full';
      leftCol.innerHTML = '<h4 class="text-sm font-bold text-white border-b border-primary/30 pb-3 mb-3 uppercase tracking-wider flex items-center gap-2 w-full"><span class="material-symbols-outlined text-[18px] text-orange-400">local_fire_department</span> Most Replay</h4>';
      heatmapList = document.createElement('div');
      heatmapList.className = 'flex flex-col gap-2 max-h-[320px] overflow-y-auto custom-scrollbar pr-2';
      leftCol.appendChild(heatmapList);
      gridContainer.appendChild(leftCol);
    }

    if (hasCustomTrims) {
      // Right Column: Import From Trim
      const rightCol = document.createElement('div');
      rightCol.className = 'flex flex-col w-full h-full';
      rightCol.innerHTML = '<h4 class="text-sm font-bold text-white border-b border-primary/30 pb-3 mb-3 uppercase tracking-wider flex items-center gap-2 w-full"><span class="material-symbols-outlined text-[18px] text-secondary">content_cut</span> Import From Trim</h4>';
      customList = document.createElement('div');
      customList.className = 'flex flex-col gap-2 max-h-[320px] overflow-y-auto custom-scrollbar pr-2';
      rightCol.appendChild(customList);
      gridContainer.appendChild(rightCol);
    }

    combinedSegments.forEach((seg, idx) => {
      const key = `${Math.round(seg.start * 1000)}:${Math.round(seg.duration * 1000)}`;
      
      if (!state.autoSelectedKeys) state.autoSelectedKeys = new Set();
      if (!state.autoSelectedKeys.has(key)) {
        state.autoSelectedKeys.add(key);
        if (state.selectedSegments.size < Number(clipperMaxClips.value)) {
          if (seg.isCustom) {
            state.selectedSegments.add(key);
          }
        }
      }

      const card = document.createElement('div');
      card.className = 'seg-card flex flex-row items-start sm:items-center gap-2 md:gap-3 p-2 md:p-3 rounded-lg glass-inner cursor-pointer hover:bg-white/10 border-2 border-transparent relative';
      card.dataset.key = key;

      const thumb = document.createElement('img');
      thumb.src = state.previewInfo?.thumbnail || `https://i.ytimg.com/vi/${state.videoId}/hqdefault.jpg`;
      thumb.className = 'w-20 h-14 sm:w-32 sm:h-20 object-cover rounded flex-shrink-0 mt-1 sm:mt-0';
      card.appendChild(thumb);

      const rightWrap = document.createElement('div');
      rightWrap.className = 'flex flex-row flex-grow items-center justify-between min-w-0 h-full gap-2';

      const infoWrap = document.createElement('div');
      infoWrap.className = 'flex flex-col items-start min-w-0 gap-1';

      const title = document.createElement('div');
      title.className = 'font-medium text-xs md:text-sm text-on-surface truncate flex items-center gap-2';
      
      if (seg.isCustom) {
        title.innerHTML = `<span class="bg-primary/20 text-primary px-1.5 py-0.5 rounded text-[10px] font-bold">CUSTOM</span> ${seg.customName} <span class="font-normal opacity-70 ml-1">${formatDuration(seg.start)} - ${formatDuration(seg.start + seg.duration)}</span>`;
      } else {
        title.textContent = `Klip ${idx + 1} - ${formatDuration(seg.start)} - ${formatDuration(seg.start + seg.duration)}`;
      }
      
      const sub = document.createElement('div');
      sub.className = 'text-[10px] md:text-xs text-on-surface-variant truncate';
      
      let durationText;
      if (seg.duration >= 60) {
        const m = Math.floor(seg.duration / 60);
        const s = Math.floor(seg.duration % 60);
        durationText = `${m}m ${s}s`;
      } else {
        durationText = `${seg.duration.toFixed(1)}s`;
      }
      sub.textContent = `Duration ${durationText}`;
      infoWrap.appendChild(title);
      infoWrap.appendChild(sub);

      const previewBtn = document.createElement('button');
      previewBtn.className = 'px-2 py-1 md:px-3 md:py-1 glass-inner hover:bg-white/10 text-on-surface rounded text-[10px] md:text-xs font-medium z-10 transition-colors flex-shrink-0';
      previewBtn.textContent = 'Preview';
      previewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 glass-dropdown flex items-center justify-center z-[100] p-4';
        const iframe = document.createElement('iframe');
        iframe.className = 'w-full max-w-3xl aspect-video rounded-xl shadow-2xl bg-black';
        iframe.src = `https://www.youtube.com/embed/${state.videoId}?start=${Math.floor(seg.start)}&end=${Math.floor(seg.start + seg.duration)}&autoplay=1`;
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        iframe.allowFullscreen = true;
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'absolute top-4 right-4 text-white bg-white/10 hover:bg-white/20 p-2 rounded-full flex items-center justify-center backdrop-blur-md border border-white/20';
        closeBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
        
        modal.appendChild(iframe);
        modal.appendChild(closeBtn);
        
        modal.addEventListener('click', (e) => {
          if (e.target === modal || e.target.closest('button')) modal.remove();
        });
        document.body.appendChild(modal);
      });
      infoWrap.appendChild(previewBtn);
      rightWrap.appendChild(infoWrap);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'w-5 h-5 rounded border-2 border-white/40 bg-black/50 text-primary focus:ring-primary cursor-pointer flex-shrink-0 appearance-none checked:bg-primary checked:border-primary ml-1 relative before:content-[""] before:absolute before:inset-0 before:bg-no-repeat before:bg-center before:bg-[length:80%] checked:before:bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22white%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M12.207%204.793a1%201%200%20010%201.414l-5%205a1%201%200%2001-1.414%200l-2-2a1%201%200%20011.414-1.414L6.5%209.086l4.293-4.293a1%201%200%20011.414%200z%22%2F%3E%3C%2Fsvg%3E")] transition-colors';
      checkbox.addEventListener('click', (e) => e.stopPropagation());
      checkbox.addEventListener('change', (e) => {
        if (checkbox.checked) {
          if (state.selectedSegments.size >= Number(clipperMaxClips.value)) {
            showToast('Info', `Maximum ${clipperMaxClips.value} segments are selected`, 'error');
            checkbox.checked = false;
            return;
          }
          state.selectedSegments.add(key);
          card.classList.add('border-primary');
          card.classList.add('bg-primary/5');
        } else {
          state.selectedSegments.delete(key);
          card.classList.remove('border-primary');
          card.classList.remove('bg-primary/5');
        }
        updateSelCount();
        // uiOnly=true → hanya update label & dropdown, video canvas tidak di-reload
        // kecuali kalau clip yg sedang dipreview ikut di-uncheck (previewClipIndex pindah)
        updateCanvasPreviewClips(false, true);
      });
      rightWrap.appendChild(checkbox);
      card.appendChild(rightWrap);

      if (state.selectedSegments.has(key)) {
        card.classList.add('border-primary');
        card.classList.add('bg-primary/5');
        checkbox.checked = true;
      }

      card.addEventListener('click', () => {
        checkbox.click();
      });

      if (seg.isCustom && customList) {
        customList.appendChild(card);
      } else if (!seg.isCustom && heatmapList) {
        heatmapList.appendChild(card);
      }
    });
    
    clipperSegments.appendChild(gridContainer);
    // Update meta count
    clipperSegMeta.textContent = `${combinedSegments.length} segmen`;
    updateSelCount();
    // renderSegments dipanggil saat scan selesai atau select-all/clear;
    // pertama kali baru muat video (lastPreviewedUrl kosong) → uiOnly diabaikan otomatis
    updateCanvasPreviewClips(false, true);

    // Ensure panels are visible if we have segments
    const clipperTitle = document.getElementById('clipperTitle');
    if (combinedSegments.length > 0) {
      if (clipperTitle) clipperTitle.innerHTML = '<span class="material-symbols-outlined text-secondary">content_cut</span> Moment Clip Found!';
      clipperSegPanel.classList.remove('hidden');
      clipperSettings.classList.remove('hidden');
    } else {
      if (clipperTitle) {
        clipperTitle.innerHTML = `
          <div class="flex flex-col gap-3 w-full">
            <div class="flex items-center gap-2 text-outline-variant">
              <span class="material-symbols-outlined">sentiment_dissatisfied</span> 
              <span>This video does not have Heatmap data (Popular Moments).</span>
            </div>
            <div class="glass-inner p-3 rounded-lg border border-primary/30 text-white/90 text-sm flex gap-3 items-start w-full">
              <span class="material-symbols-outlined text-primary text-[20px] mt-0.5">lightbulb</span>
              <div class="leading-relaxed whitespace-normal font-normal">
                <strong>Tip:</strong> You can create clips manually! Go to the <strong>Trim</strong> menu, select your preferred video sections, and click <strong class="text-primary">"Export to Clips"</strong>.
              </div>
            </div>
          </div>
        `;
      }
      clipperSegPanel.classList.add('hidden');
      clipperSettings.classList.add('hidden');
    }
  };

  // ---------- Global Scan Handler ----------
  window.scanHeatmap = async (url, meta, cachedSegments) => {
    state.videoId = window.extractVideoId ? window.extractVideoId(url) : extractVideoId(url);
    state.previewInfo = meta || null;
    
    const clipperTitle = document.getElementById('clipperTitle');
    if (clipperTitle) {
      clipperTitle.innerHTML = '<span class="material-symbols-outlined text-secondary animate-pulse">sync</span> Find Most Replayed...';
    }
    clipperSegPanel.classList.add('hidden');
    clipperSettings.classList.add('hidden');
    
    // Auto scan
    try {
      if (cachedSegments) {
        state.segments = cachedSegments;
        state.selectedSegments.clear();
      } else {
        const res = await fetch('/api/clipper/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        state.segments = data.segments || [];
        state.selectedSegments.clear();
      }
      
      // Removed auto-select logic to let user select manually
      
      renderSegments();

      // DYNAMIC RESOLUTION UPDATE
      if (meta && meta.formats && meta.formats.video && meta.formats.video.length > 0) {
        const resSelect = document.getElementById('clipperResolution');
        const resContainer = document.getElementById('clipperResolutionContainer');
        if (resSelect) {
          // Remove old custom dropdown wrapper if exists
          const wrapper = document.getElementById('dropdown_clipperResolution');
          if (wrapper) wrapper.remove();
          resSelect.classList.remove('custom-select-initialized');

          resSelect.innerHTML = '';
          if (resContainer) resContainer.innerHTML = '';
          
          meta.formats.video.forEach((f, idx) => {
             const fpsStr = f.fps ? ` (${f.fps}fps)` : '';
             const isSelected = idx === 0 ? 'selected' : '';
             
             // Populate dropdown
             resSelect.innerHTML += `<option value="${f.format_id}" data-height="${f.height || 1080}" ${isSelected}>${f.resolution}${fpsStr}</option>`;
             
             // Populate buttons
             if (resContainer) {
                 const btn = document.createElement('button');
                 btn.type = 'button';
                 btn.className = `w-full p-3 rounded-lg text-xs transition-all flex flex-col items-center justify-center gap-1 border ${idx === 0 ? 'bg-primary/20 text-primary border-primary/50 font-bold' : 'border-primary/30 bg-black/40 text-white/70 hover:border-primary/60 hover:bg-white/5 hover:text-white'}`;
                 btn.innerHTML = `<span>${f.resolution}${fpsStr}</span>`;
                 btn.onclick = () => {
                    Array.from(resContainer.children).forEach(c => {
                       c.className = `w-full p-3 rounded-lg text-xs transition-all flex flex-col items-center justify-center gap-1 border border-primary/30 bg-black/40 text-white/70 hover:border-primary/60 hover:bg-white/5 hover:text-white`;
                    });
                    btn.className = `w-full p-3 rounded-lg text-xs transition-all flex flex-col items-center justify-center gap-1 border bg-primary/20 text-primary border-primary/50 font-bold`;
                    
                    // Sync to select
                    resSelect.value = f.format_id;
                    const evt = new Event('change');
                    resSelect.dispatchEvent(evt);
                 };
                 resContainer.appendChild(btn);
             }
          });
          
          // Re-initialize custom dropdown just for this select
          if (typeof upgradeSelectsToCustomDropdowns === 'function') {
             upgradeSelectsToCustomDropdowns();
          }
          
          // Trigger layout update to recalculate canvas height based on the new settings panel height
          setTimeout(() => {
             const ratioSel = document.getElementById('clipperRatio');
             if (ratioSel) ratioSel.dispatchEvent(new Event('change'));
          }, 50);
        }
      }
    } catch (err) {
      if (clipperTitle) clipperTitle.innerHTML = '<span class="material-symbols-outlined text-error">error</span> Gagal memindai heatmap.';
      showToast('Error', 'Gagal memindai heatmap: ' + err.message, 'error');
    }
  };

  const getCombinedSegmentsRef = () => {
    return getCombinedSegments();
  };

  const handleSelectAll = () => {
    const combined = getCombinedSegments();
    const max = Number(clipperMaxClips.value);
    state.selectedSegments.clear();
    for (let i = 0; i < Math.min(combined.length, max); i++) {
      const seg = combined[i];
      state.selectedSegments.add(`${Math.round(seg.start * 1000)}:${Math.round(seg.duration * 1000)}`);
    }
    renderSegments();
  };

  const handleClearSelection = () => {
    state.selectedSegments.clear();
    renderSegments();
  };

  const handleStartClip = async () => {
    if (state.isProcessing) return;
    const selected = Array.from(state.selectedSegments);
    if (selected.length === 0) return showToast('Error', 'Pilih setidaknya satu segmen', 'error');
    // Build segment objects matching server expectations
    const combined = getCombinedSegments();
    const segments = combined.filter(seg => {
      const key = `${Math.round(seg.start * 1000)}:${Math.round(seg.duration * 1000)}`;
      return state.selectedSegments.has(key);
    });

    const engineConfig = window.getSubtitleEngineConfig ? window.getSubtitleEngineConfig() : { engine: 'local', model: clipperWhisperModel.value };
    
    if (clipperSubtitle.value === 'y') {
      if (engineConfig.engine === 'groq' && !engineConfig.apiKey) {
        return showToast('Error', 'API Key Groq belum diisi. Silakan isi terlebih dahulu.', 'error');
      }
      if (engineConfig.engine === 'cloudflare' && (!engineConfig.accountId || !engineConfig.apiToken)) {
        return showToast('Error', 'Cloudflare Account ID / API Token belum diisi.', 'error');
      }
    }

    const payload = {
      url: state.videoId ? `https://youtu.be/${state.videoId}` : '',
      segments,
      uploader: state.previewInfo?.uploader || state.previewInfo?.author || 'Kreator',
      crop: document.getElementById('clipperCrop')?.value || 'center',
      facecamPos: document.getElementById('clipperFacecamPos')?.value || 'bottom',
      camZoom: parseFloat(document.getElementById('clipperCamZoom')?.value) || 220,
      camX: document.getElementById('clipperCamX')?.value !== '' ? parseFloat(document.getElementById('clipperCamX')?.value) : null,
      camY: document.getElementById('clipperCamY')?.value !== '' ? parseFloat(document.getElementById('clipperCamY')?.value) : null,
      gameZoom: parseFloat(document.getElementById('clipperGameZoom')?.value) || 216,
      gameX: document.getElementById('clipperGameX')?.value !== '' ? parseFloat(document.getElementById('clipperGameX')?.value) : null,
      gameY: document.getElementById('clipperGameY')?.value !== '' ? parseFloat(document.getElementById('clipperGameY')?.value) : null,
      ratio: clipperRatio.value,
      subtitle: clipperSubtitle.value === 'y',
      subtitleEngine: engineConfig.engine,
      whisperModel: engineConfig.model,
      groqApiKey: engineConfig.apiKey,
      cfAccountId: engineConfig.accountId,
      cfApiToken: engineConfig.apiToken,
      resolution: document.getElementById('clipperResolution')?.value || '1080',
      resolutionHeight: (function(){
        const sel = document.getElementById('clipperResolution');
        if (!sel || sel.selectedIndex === -1) return 1080;
        return sel.options[sel.selectedIndex].getAttribute('data-height') || 1080;
      })(),
            
      font: clipperFontSel.value === 'custom' ? clipperFontCustom.value : clipperFontSel.value,
      fontSize: document.getElementById('clipperFontSize')?.value || '70',
      outlineType: document.getElementById('clipperOutlineType')?.value || 'stroke',
      outlineColor: document.getElementById('clipperOutlineColor')?.value || '&H000000&',
      color: document.getElementById('clipperColorSel').value,
      textCase: document.getElementById('clipperTextCase')?.value || 'title',
      posX: document.getElementById('clipperPosX')?.value || '50',
      posY: document.getElementById('clipperPosY')?.value || '80',
      letterSpacing: document.getElementById('clipperLetterSpacing')?.value || '0',
      maxWords: document.getElementById('clipperMaxWords')?.value || '3',
      padding: Number(clipperPadding.value),
      fontArt: document.getElementById('clipperFontArt')?.value || 'none',
      animStyle: document.getElementById('clipperAnimStyle')?.value || 'none',
      animIn: parseInt(document.getElementById('clipperAnimIn')?.value || '150'),
      animOut: parseInt(document.getElementById('clipperAnimOut')?.value || '150'),
      watermark: {
        enabled: document.getElementById('clipperWatermarkToggle')?.value === 'y',
        text: document.getElementById('clipperWatermarkText')?.value || '',
        size: document.getElementById('clipperWmSize')?.value || '40',
        opacity: document.getElementById('clipperWmOpacity')?.value || '50',
        posX: document.getElementById('clipperWmPosX')?.value || '50',
        posY: document.getElementById('clipperWmPosY')?.value || '20',
      }
    };
    try {
      clipperStartBtn.disabled = true;
      clipperStartBtn.classList.add('opacity-50', 'pointer-events-none');
      const textEl = document.getElementById('clipperStartText');
      if (textEl) textEl.textContent = 'Memproses...';
      
      const res = await fetch('/api/clipper/clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      state.jobId = data.jobId;
      state.jobStartTime = Date.now();
      state.isProcessing = true;
      clipperProgressPanel.classList.remove('hidden');
      if (clipperSegmentsProgress) {
        clipperSegmentsProgress.classList.remove('hidden');
        clipperSegmentsProgress.innerHTML = '<div>> Menyiapkan task...</div>';
      }
      clipperOutputs.innerHTML = '';
      pollJob();
    } catch (err) {
      clipperStartBtn.disabled = false;
      clipperStartBtn.classList.remove('opacity-50', 'pointer-events-none');
      const textEl = document.getElementById('clipperStartText');
      if (textEl) textEl.textContent = 'Export Clips';
      showToast('Error', err.message, 'error');
    }
  };

  const pollJob = () => {
    if (state.pollingInterval) clearInterval(state.pollingInterval);
    state.pollingInterval = setInterval(async () => {
      if (!state.jobId) return;
      try {
        const res = await fetch(`/api/clipper/job/${state.jobId}`);
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        const job = data.job;
        
        if (!state.jobStartTime && job.status === 'running') {
          state.jobStartTime = Date.now();
        }
        
        const percent = job.total ? (job.progress / job.total) * 100 : 0;
        clipperProgressBar.style.width = `${percent}%`;
        
        let etaStr = '';
        if (job.status === 'running' && percent > 0 && percent < 100 && state.jobStartTime) {
           const elapsedMs = Date.now() - state.jobStartTime;
           if (elapsedMs > 5000) {
             const totalEstMs = elapsedMs / (percent / 100);
             const remainMs = Math.max(0, totalEstMs - elapsedMs);
             const remainSec = Math.round(remainMs / 1000);
             if (remainSec > 60) {
                etaStr = ` | Time remaining: ${Math.floor(remainSec/60)}m ${remainSec%60}s`;
             } else {
                etaStr = ` | Time remaining: ${remainSec}s`;
             }
           }
        }
        
        clipperProgressText.textContent = `Progress ${Math.round(percent)}% - ${job.status}${etaStr}`;
        
        // Render Segments Progress
        if (job.segmentsData && clipperSegmentsProgress) {
          clipperSegmentsProgress.classList.remove('hidden');
          clipperSegmentsProgress.innerHTML = '';
          
          job.segmentsData.forEach((seg, idx) => {
            const isCurrent = idx === job.currentSegmentIndex;
            const isDone = idx < job.currentSegmentIndex || (job.status === 'done' && idx <= job.currentSegmentIndex);
            
            let statusText = isDone ? 'Selesai' : (isCurrent ? (job.status === 'error' ? 'Error' : 'Diproses...') : 'Menunggu');
            let statusColor = isDone ? 'text-green-400' : (isCurrent ? (job.status === 'error' ? 'text-red-400' : 'text-primary') : 'text-gray-400');
            let progressVal = isDone ? 100 : (isCurrent ? (job.segmentProgress || 0) : 0);
            
            const card = document.createElement('div');
            card.className = `p-3 rounded-lg border flex flex-col gap-2 transition-all ${isCurrent ? 'bg-primary/10 border-primary/30 shadow-[0_0_15px_rgba(200,100,255,0.15)]' : 'bg-black/40 border-white/5'}`;
            
            card.innerHTML = `
              <div class="flex justify-between items-center text-xs">
                <span class="font-bold text-white">Klip ${idx + 1} <span class="text-white/50 font-normal ml-1">(${formatDuration(seg.start)} - ${formatDuration(seg.start + seg.duration)})</span></span>
                <span class="${statusColor} font-medium">${statusText} ${isCurrent ? Math.round(progressVal) + '%' : ''}</span>
              </div>
              <div class="h-1.5 w-full bg-black/50 rounded-full overflow-hidden">
                <div class="h-full bg-gradient-to-r from-primary to-secondary transition-all duration-300" style="width: ${progressVal}%"></div>
              </div>
            `;
            clipperSegmentsProgress.appendChild(card);
          });
        }

        if (job.status === 'done' || job.status === 'cancelled' || job.status === 'error') {
          clearInterval(state.pollingInterval);
          state.isProcessing = false;
          clipperProgressPanel.classList.add('hidden');
          clipperStartBtn.disabled = false;
          clipperStartBtn.classList.remove('opacity-50', 'pointer-events-none');
          const textEl = document.getElementById('clipperStartText');
          if (textEl) textEl.textContent = 'Export Clips';
          
          if (job.status === 'done') {
            renderOutputs(job.outputs);
            showToast('Success', 'Clipping Complete', 'success');
          } else if (job.status === 'cancelled') {
            showToast('Warning', 'The clipping process was canceled', 'error');
          } else if (job.status === 'error') {
            const lastLog = job.logs && job.logs.length ? job.logs[job.logs.length - 1] : 'An error occurred during the clipping process';
            showToast('Error', lastLog, 'error');
          }
        }
      } catch (e) {
        console.error(e);
      }
    }, 1500);
  };

  const renderOutputs = (outputs) => {
    clipperOutputs.innerHTML = '';
    
    // Ambil segmen yang terpilih untuk menyusun format nama file di UI
    const selectedArr = state.segments.filter(seg => {
      const key = `${Math.round(seg.start * 1000)}:${Math.round(seg.duration * 1000)}`;
      return state.selectedSegments.has(key);
    });

    outputs.forEach((item, idx) => {
      const div = document.createElement('div');
      div.className = 'flex items-center justify-between p-3 glass-inner rounded-lg cursor-pointer hover:bg-white/5 transition-all';
      
      const seg = selectedArr[idx];
      const uploader = state.previewInfo?.uploader || state.previewInfo?.author || 'Kreator';
      let finalName = item.filename;
      if (seg) {
        if (seg.isCustom) {
          finalName = `[CUSTOM] ${seg.customName} - ${uploader}.mp4`;
        } else {
          finalName = `Clips ${idx + 1} - ${uploader} - ${formatDuration(seg.start)} - ${formatDuration(seg.start + seg.duration)}.mp4`;
        }
      }
      
      const currentJobId = state.jobId;
      const finalUrl = `/api/clipper/file/${currentJobId}/${encodeURIComponent(item.filename)}`;

      div.innerHTML = `
        <div class="flex items-center gap-3 min-w-0 flex-grow">
          <span class="material-symbols-outlined text-green-400 flex-shrink-0">check_circle</span>
          <div class="min-w-0 flex-grow">
            <div class="font-medium text-sm text-white truncate">${finalName}</div>
            <div class="text-xs text-outline-variant">Berhasil disimpan di folder /clips</div>
          </div>
        </div>
        <button class="open-folder-btn p-2 rounded-lg hover:bg-white/10 text-outline-variant hover:text-white transition-colors" title="Buka Folder">
          <span class="material-symbols-outlined text-xl">folder</span>
        </button>`;
      
      div.addEventListener('click', (e) => {
        if (e.target.closest('.open-folder-btn')) {
          e.stopPropagation();
          fetch('/api/open-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'clips', filename: item.filename }) });
          return;
        }
        if (window.playDirectMedia) {
          window.playDirectMedia(finalUrl, finalName);
        }
      });
      
      clipperOutputs.appendChild(div);
    });
  };

  // ---------- Tab & UI Bindings ----------
  const tabDownloader = document.getElementById('tabDownloader');
  const tabClipper = document.getElementById('tabClipper');
  const downloaderSection = document.getElementById('downloaderSection');
  const clipperSection = document.getElementById('clipperSection');
  const urlInput = document.getElementById('urlInput'); // from app.js

  // Tab logic is now handled in app.js

  clipperSelAll.addEventListener('click', handleSelectAll);
  clipperSelClear.addEventListener('click', handleClearSelection);
  clipperStartBtn.addEventListener('click', handleStartClip);

  const btnPrevClip = document.getElementById('clipperPrevClipBtn');
  const btnNextClip = document.getElementById('clipperNextClipBtn');
  const previewLabelBtn = document.getElementById('clipperPreviewLabel');
  const previewDropdown = document.getElementById('clipperPreviewDropdown');
  
  if (btnPrevClip && btnNextClip) {
      btnPrevClip.addEventListener('click', () => {
          state.previewClipIndex--;
          updateCanvasPreviewClips();
      });
      btnNextClip.addEventListener('click', () => {
          state.previewClipIndex++;
          updateCanvasPreviewClips();
      });
  }

  if (previewLabelBtn && previewDropdown) {
      previewLabelBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          previewDropdown.classList.toggle('hidden');
      });
      document.addEventListener('click', (e) => {
          if (!previewLabelBtn.contains(e.target) && !previewDropdown.contains(e.target)) {
              previewDropdown.classList.add('hidden');
          }
      });
  }
  
  const playPauseBtn = document.getElementById('clipperPlayPauseBtn');
  const muteBtn = document.getElementById('clipperMuteBtn');

  // Helper: get native video elements (they now are <video> tags)
  const getNativeVideos = () => ({
    top: document.getElementById('iframeTop'),
    bottom: document.getElementById('iframeBottom')
  });

  window.setClipperPlayState = (isPlaying) => {
    state.previewIsPlaying = isPlaying;
    if (playPauseBtn) {
      playPauseBtn.innerHTML = `<span class="material-symbols-outlined text-[16px]">${state.previewIsPlaying ? 'pause' : 'play_arrow'}</span>`;
    }
  };

  if (playPauseBtn) {
    playPauseBtn.addEventListener('click', () => {
      const { top, bottom } = getNativeVideos();
      if (typeof window.setClipperPlayState === 'function') {
        window.setClipperPlayState(!state.previewIsPlaying);
      }
      if (state.previewIsPlaying) {
        if (top && top.src) top.play().catch(() => {});
        if (bottom && bottom.src) bottom.play().catch(() => {});
      } else {
        if (top) top.pause();
        if (bottom) bottom.pause();
      }
    });
  }

  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      state.previewIsMuted = !state.previewIsMuted;
      muteBtn.innerHTML = `<span class="material-symbols-outlined text-[16px]">${state.previewIsMuted ? 'volume_off' : 'volume_up'}</span>`;
      const { top, bottom } = getNativeVideos();
      if (top) top.muted = state.previewIsMuted;
      if (bottom) bottom.muted = state.previewIsMuted;
    });
  }

  // Subtitle option show/hide sub-settings
  clipperSubtitle.addEventListener('change', () => {
    const subToggles = document.querySelectorAll('.clipper-sub-toggle');
    const rightPane = document.getElementById('clipperSubSettingsRight');
    const subtitlePreview = document.getElementById('subtitlePreview');
    
    if (clipperSubtitle.value === 'y') {
      if (rightPane) {
        rightPane.classList.remove('opacity-30', 'pointer-events-none', 'hidden');
      }
      subtitlePreview?.classList.remove('hidden');
      subToggles.forEach(el => el.classList.remove('opacity-30', 'pointer-events-none', 'hidden'));
    } else {
      if (rightPane) {
        rightPane.classList.add('opacity-30', 'pointer-events-none');
        rightPane.classList.remove('hidden');
      }
      subtitlePreview?.classList.add('hidden');
      subToggles.forEach(el => {
        el.classList.add('opacity-30', 'pointer-events-none');
        el.classList.remove('hidden');
      });
    }
  });

  // Trigger initial layout state
  setTimeout(() => {
    clipperSubtitle.dispatchEvent(new Event('change'));
  }, 100);

  // Watermark option show/hide settings
  const clipperWatermarkToggle = document.getElementById('clipperWatermarkToggle');
  const clipperWatermarkSettings = document.getElementById('clipperWatermarkSettings');
  const clipperWatermarkTextWrapper = document.getElementById('clipperWatermarkTextWrapper');
  if (clipperWatermarkToggle && clipperWatermarkSettings) {
    clipperWatermarkToggle.addEventListener('change', () => {
      if (clipperWatermarkToggle.value === 'y') {
        clipperWatermarkSettings.classList.remove('opacity-30', 'pointer-events-none', 'hidden');
        if(clipperWatermarkTextWrapper) clipperWatermarkTextWrapper.classList.remove('opacity-30', 'pointer-events-none');
      } else {
        clipperWatermarkSettings.classList.add('opacity-30', 'pointer-events-none');
        clipperWatermarkSettings.classList.remove('hidden');
        if(clipperWatermarkTextWrapper) clipperWatermarkTextWrapper.classList.add('opacity-30', 'pointer-events-none');
      }
    });
  }

  // Font custom input toggle
  clipperFontSel.addEventListener('change', () => {
    if (clipperFontSel.value === 'custom') {
      clipperFontCustom?.classList.remove('hidden');
    } else {
      clipperFontCustom?.classList.add('hidden');
    }
  });

  // Handle Cancel button
  const clipperCancelBtn = document.getElementById('clipperCancelBtn');
  if (clipperCancelBtn) {
    clipperCancelBtn.addEventListener('click', async () => {
      if (!state.jobId || !state.isProcessing) return;
      try {
        const res = await fetch(`/api/clipper/cancel/${state.jobId}`, {
          method: 'POST'
        });
        const data = await res.json();
        if (data.ok) {
          showToast('Info', 'Membatalkan proses...', 'info');
        }
      } catch(e) {
        console.error(e);
      }
    });
  }

  // --- LIVE PREVIEW LOGIC ---
  const updatePreview = () => {
    const preview = document.getElementById('subtitlePreview');
    if (!preview) return;

    const font = clipperFontSel.value === 'custom' ? (clipperFontCustom?.value || 'Arial') : clipperFontSel.value;
    const size = document.getElementById('clipperFontSize')?.value || '70';
    const colorHex = document.getElementById('clipperColorSel').value; // &HFFFFFF&
    const outlineType = document.getElementById('clipperOutlineType')?.value || 'stroke';
    const outlineColorHex = document.getElementById('clipperOutlineColor')?.value || '&H000000&';
    
    // NEW: Font Art & Animations
    const fontArt = document.getElementById('clipperFontArt')?.value || 'none';
    const animStyle = document.getElementById('clipperAnimStyle')?.value || 'none';
    const animIn = parseInt(document.getElementById('clipperAnimIn')?.value || '150');
    const animOut = parseInt(document.getElementById('clipperAnimOut')?.value || '150');
    
    // Conditional Dim standard font options if using Font Art
    const fontSelWrap = clipperFontSel?.closest('.block');
    const outlineTypeWrap = document.getElementById('clipperOutlineType')?.closest('.block');
    const outlineColorWrap = document.getElementById('clipperOutlineColor')?.closest('.block');
    const colorSelWrap = document.getElementById('clipperColorSel')?.closest('.block');
    
    if (fontArt !== 'none') {
       fontSelWrap?.classList.add('opacity-30', 'pointer-events-none');
       outlineTypeWrap?.classList.add('opacity-30', 'pointer-events-none');
       outlineColorWrap?.classList.add('opacity-30', 'pointer-events-none');
       colorSelWrap?.classList.add('opacity-30', 'pointer-events-none');
    } else {
       fontSelWrap?.classList.remove('opacity-30', 'pointer-events-none');
       outlineTypeWrap?.classList.remove('opacity-30', 'pointer-events-none');
       outlineColorWrap?.classList.remove('opacity-30', 'pointer-events-none');
       colorSelWrap?.classList.remove('opacity-30', 'pointer-events-none');
    }
    const posX = document.getElementById('clipperPosX')?.value || '50';
    const posY = document.getElementById('clipperPosY')?.value || '80';
    const ratio = document.getElementById('clipperRatio')?.value || '9:16';
    
    const container = document.getElementById('canvasPreviewContainer');
    const layoutContainer = document.getElementById('clipperSubSettingsLayout');
    const leftPane = document.getElementById('clipperLeftPane');

    if (container) {
      const topGrid = document.getElementById('clipperTopGrid');
      if (leftPane) {
        if (ratio === '9:16') {
          leftPane.style.minHeight = '600px';
          if (topGrid) {
            topGrid.className = "grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-4 items-stretch w-full";
            leftPane.parentElement.classList.remove('w-full');
            leftPane.classList.remove('w-full');
          }
        } else if (ratio === '1:1') {
          leftPane.style.minHeight = '';
          if (topGrid) {
            topGrid.className = "grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-4 items-stretch w-full";
            leftPane.parentElement.classList.remove('w-full');
            leftPane.classList.remove('w-full');
          }
        } else {
          leftPane.style.minHeight = '';
          if (topGrid) {
            topGrid.className = "grid grid-cols-1 lg:grid-cols-2 gap-4 items-start w-full";
            leftPane.parentElement.classList.add('w-full');
            leftPane.classList.add('w-full');
          }
        }
      }

      // Rely on synchronous layout reflow
      const parent = container.parentElement;
      if (parent) {
        const pw = parent.clientWidth;
        const ph = parent.clientHeight || 600; // fallback if invisible
        
        if (ph > 0) {
          let r = 16/9;
          if (ratio === '9:16') {
            r = 9/16;
            container.style.aspectRatio = '9/16';
          } else if (ratio === '1:1') {
            r = 1;
            container.style.aspectRatio = '1/1';
          } else if (ratio === '16:9') {
            r = 16/9;
            container.style.aspectRatio = '16/9';
          } else {
            container.style.aspectRatio = 'auto';
            r = 16/9; // fallback
          }

          if (ratio === '9:16' || ratio === '1:1') {
            container.style.width = 'auto';
            container.style.height = '100%';
            container.style.maxWidth = '100%';
            container.style.maxHeight = '100%';
          } else if (ratio === 'original') {
            container.style.width = '100%';
            container.style.height = '100%';
            container.style.maxWidth = '100%';
            container.style.maxHeight = '100%';
          } else {
            container.style.width = '100%';
            container.style.height = 'auto';
            container.style.maxWidth = '100%';
            container.style.maxHeight = '100%';
          }
        }
      }

      // Update Split/Crop visual logic
      const cropMode = document.getElementById('clipperCrop')?.value || 'default';
      const facecamPos = document.getElementById('clipperFacecamPos')?.value || 'bottom';
      const pvTop = document.getElementById('pvTop');
      const pvBottom = document.getElementById('pvBottom');
      const iframeTop = document.getElementById('iframeTop');
      const iframeBottom = document.getElementById('iframeBottom');

      if (pvTop && pvBottom && iframeTop && iframeBottom) {
        if (ratio === '9:16' && cropMode.startsWith('split_')) {
          pvBottom.classList.remove('hidden');
          
          // Gameplay (pvTop) gets ~68.4%, Facecam (pvBottom) gets ~31.6%
          pvTop.style.width = '100%';
          pvTop.style.height = '68.4%';
          pvBottom.style.width = '100%';
          pvBottom.style.height = '31.6%';
          
          if (facecamPos === 'top') {
            pvBottom.style.top = '0';
            pvTop.style.top = '31.6%';
          } else {
            pvTop.style.top = '0';
            pvBottom.style.top = '68.4%';
          }

          // --- DYNAMIC SCALING & PANNING ---
          const getV = (id) => { const val = document.getElementById(id)?.value; return val ? parseFloat(val) : null; };
          const applyCustom = (iframe, type, defZoom, defX, defY) => {
            const z = getV(type === 'game' ? 'clipperGameZoom' : 'clipperCamZoom') ?? defZoom;
            const x = getV(type === 'game' ? 'clipperGameX' : 'clipperCamX') ?? defX;
            const y = getV(type === 'game' ? 'clipperGameY' : 'clipperCamY') ?? defY;
            
            const container = iframe.parentElement;
            const iw = 1920, ih = 1080;
            const contW = container.offsetWidth || container.clientWidth;
            const contH = container.offsetHeight || container.clientHeight;
            if(!contW || !contH) return;
            
            // ── Source-Based Crop (SBC) – sama persis dengan FFmpeg srcCrop() ──
            // S = scale fit-inside untuk dapat ratio source → container
            const S = Math.min(contW / iw, contH / ih);
            const zoom = z / 100;
            // Berapa piksel source yang kelihatan (kebalikan dari zoom)
            const srcW = Math.min(iw, contW / (S * zoom));
            const srcH = Math.min(ih, contH / (S * zoom));
            // Offset source berdasarkan X,Y 0-100
            const srcX = (iw - srcW) * (x / 100);
            const srcY = (ih - srcH) * (y / 100);
            
            // Scale full video ke layar, geser supaya area yang di-crop kelihatan
            const displayScale = Math.min(contW / srcW, contH / srcH);
            const dispW = iw * displayScale;
            const dispH = ih * displayScale;
            
            iframe.style.maxWidth = 'none';
            iframe.style.width = `${dispW}px`;
            iframe.style.height = `${dispH}px`;
            iframe.style.objectFit = 'fill';
            iframe.style.left = `${-srcX * displayScale}px`;
            iframe.style.top  = `${-srcY * displayScale}px`;
            iframe.style.transform = 'none';
          };


          pvTop.style.filter = 'none';
          pvBottom.style.filter = 'none';

          // Gameplay default is zoom 216%, centered at 50,50
          applyCustom(iframeTop, 'game', 216, 50, 50);

          // Facecam defaults based on cropMode
          let defCX = 50, defCY = 100;
          if (cropMode === 'split_left_mid') { defCX = 0; defCY = 50; }
          else if (cropMode === 'split_right_mid') { defCX = 100; defCY = 50; }
          else if (cropMode === 'split_right') { defCX = 100; defCY = 100; }
          else { defCX = 0; defCY = 100; } // split_left defaults to bottom-left

          applyCustom(iframeBottom, 'cam', 220, defCX, defCY);
        } else {
          pvBottom.classList.add('hidden');
          pvTop.style.width = '100%';
          pvTop.style.height = '100%';
          pvTop.style.top = '0';

          pvTop.style.filter = 'none';
          iframeTop.style.top = '0';
          iframeTop.style.height = '100%';

          if (cropMode === 'fit') {
             iframeTop.style.width = '100%';
             iframeTop.style.left = '0';
             iframeTop.style.transform = 'none';
             iframeTop.style.objectFit = 'contain';
          } else if (ratio === '9:16') {
             iframeTop.style.width = '316%';
             iframeTop.style.left = '50%';
             iframeTop.style.transform = 'translateX(-50%)';
             iframeTop.style.objectFit = 'cover';
          } else if (ratio === '1:1') {
             iframeTop.style.width = '177.7%';
             iframeTop.style.left = '50%';
             iframeTop.style.transform = 'translateX(-50%)';
             iframeTop.style.objectFit = 'cover';
          } else {
             iframeTop.style.width = '100%';
             iframeTop.style.left = '0';
             iframeTop.style.transform = 'none';
             iframeTop.style.objectFit = 'cover';
          }
        }
      }
    }

    // Parse BGR to RGB
    const parseColor = (assCol) => {
      if (!assCol) return '#ffffff';
      const hex = assCol.substring(2, 8);
      return `#${hex.substring(4, 6)}${hex.substring(2, 4)}${hex.substring(0, 2)}`;
    };

    const cPrim = parseColor(colorHex);
    const cOut = parseColor(outlineColorHex);

    // Dynamic Size calc:
    // If ratio is 9:16, real height is 1920. If 16:9, real height is 1080.
    const realHeight = (ratio === '9:16' || ratio === 'original') ? 1920 : 1080;
    const canvasHeight = container ? container.clientHeight : 300;
    // We add a tiny delay or compute immediately, if canvasHeight is 0 fallback to approx
    const safeCanvasHeight = canvasHeight > 0 ? canvasHeight : (ratio === '9:16' ? 444 : 140);
    const cssFontSize = (Number(size) / realHeight) * safeCanvasHeight;

    // Handle Text Case
    const textCase = document.getElementById('clipperTextCase')?.value || 'title';
    if (textCase === 'upper') {
      preview.style.textTransform = 'uppercase';
    } else if (textCase === 'lower') {
      preview.style.textTransform = 'lowercase';
    } else {
      preview.style.textTransform = 'capitalize';
    }

    // Reset styles first
    preview.style.textShadow = '';
    
    // Apply basic font and color OR Font Art CSS Classes
    if (fontArt === 'none') {
       preview.style.fontFamily = `"${font}", sans-serif`;
       preview.style.color = cPrim;
       const fontWeight = document.getElementById('clipperFontWeight')?.value || '700';
       preview.style.fontWeight = fontWeight;
    } else {
       preview.style.fontFamily = '';
       preview.style.color = '';
       preview.style.fontWeight = '';
    }
    
    // Managed 3-Loop Animation
    if (window.previewAnimTimeout) clearTimeout(window.previewAnimTimeout);
    
    preview.style.animation = 'none';
    preview.style.opacity = '1';
    preview.style.transform = 'translate(-50%, -50%)';
    preview.className = `absolute left-1/2 top-1/2 text-center whitespace-nowrap pointer-events-none z-20 font-art-${fontArt}`;
    
    if (animStyle !== 'none') {
       let loopCount = 0;
       const playAnim = () => {
          if (loopCount >= 3) {
             // IDLE state
             preview.style.animation = 'none';
             preview.style.opacity = '1';
             preview.style.transform = 'translate(-50%, -50%)';
             preview.className = `absolute left-1/2 top-1/2 text-center whitespace-nowrap pointer-events-none z-20 font-art-${fontArt}`;
             return;
          }
          loopCount++;
          preview.style.animation = 'none';
          preview.className = `absolute left-1/2 top-1/2 text-center whitespace-nowrap pointer-events-none z-20 font-art-${fontArt}`;
          preview.offsetHeight; // force reflow
          preview.style.animation = ''; // Clear inline so CSS class works
          preview.className = `absolute left-1/2 top-1/2 text-center whitespace-nowrap pointer-events-none z-20 font-art-${fontArt} anim-${animStyle}`;
          preview.style.animationDuration = `${(animIn + animOut + 1000) / 1000}s`;
          
          window.previewAnimTimeout = setTimeout(playAnim, animIn + animOut + 1000);
       };
       playAnim();
    }
    
    preview.style.fontSize = `${cssFontSize}px`;
    preview.style.left = `${posX}%`;
    preview.style.top = `${posY}%`;
    const letterSpacing = document.getElementById('clipperLetterSpacing')?.value || '0';
    preview.style.letterSpacing = `${letterSpacing}px`;
    const fontWeightForLbl = document.getElementById('clipperFontWeight')?.value || '700';
    const lblFontWeight = document.getElementById('lblFontWeight');
    if (lblFontWeight) lblFontWeight.textContent = fontWeightForLbl;

    // Watermark logic
    const wmToggle = document.getElementById('clipperWatermarkToggle')?.value === 'y';
    const wmText = document.getElementById('clipperWatermarkText')?.value || '';
    const wmSize = document.getElementById('clipperWmSize')?.value || '40';
    const wmOpacity = document.getElementById('clipperWmOpacity')?.value || '50';
    const wmPosX = document.getElementById('clipperWmPosX')?.value || '50';
    const wmPosY = document.getElementById('clipperWmPosY')?.value || '20';
    const wmPreview = document.getElementById('wmPreview');
    
    if (wmPreview) {
      if (wmToggle && wmText) {
        wmPreview.classList.remove('hidden');
        wmPreview.textContent = wmText;
        const cssWmSize = (Number(wmSize) / realHeight) * safeCanvasHeight;
        wmPreview.style.fontSize = `${cssWmSize}px`;
        wmPreview.style.opacity = Number(wmOpacity) / 100;
        wmPreview.style.left = `${wmPosX}%`;
        wmPreview.style.top = `${wmPosY}%`;
        // Font size label
        const lblWmSize = document.getElementById('lblWmSize');
        if (lblWmSize) lblWmSize.textContent = wmSize;
        // Opacity label
        const lblWmOpacity = document.getElementById('lblWmOpacity');
        if (lblWmOpacity) lblWmOpacity.textContent = wmOpacity;
      } else {
        wmPreview.classList.add('hidden');
      }
    }

    // Sync font size label
    const lblFontSizeVal = document.getElementById('lblFontSizeVal');
    if (lblFontSizeVal) lblFontSizeVal.textContent = size;
    
    // Reset effects
    preview.style.textShadow = 'none';
    preview.style.webkitTextStroke = '0px transparent';

    // Handle outline type state (disable color input if 'none')
    const outlineColorSelect = document.getElementById('clipperOutlineColor');
    if (outlineColorSelect) {
      const parentLabel = outlineColorSelect.closest('label');
      if (outlineType === 'none') {
        outlineColorSelect.disabled = true;
        if (parentLabel) parentLabel.classList.add('opacity-30', 'pointer-events-none');
      } else {
        outlineColorSelect.disabled = false;
        if (parentLabel) parentLabel.classList.remove('opacity-30', 'pointer-events-none');
      }
    }

    if (outlineType === 'glow') {
      // Create a thick glowing effect (simulating \blur5 with Outline=6)
      preview.style.textShadow = `
        0 0 4px ${cOut}, 0 0 8px ${cOut}, 0 0 12px ${cOut}, 
        0 0 16px ${cOut}, 0 0 20px ${cOut}
      `;
    } else if (outlineType === 'shadow') {
      // Soft drop shadow (offset + blur)
      preview.style.textShadow = `3px 3px 6px ${cOut}`;
    } else if (outlineType === 'stroke_shadow') {
      preview.style.webkitTextStroke = `2px ${cOut}`;
      preview.style.textShadow = `2px 2px 2px ${cOut}`;
    } else if (outlineType === 'stroke') {
      preview.style.webkitTextStroke = `2px ${cOut}`;
    }
  };

  // Attach preview listeners
  // Attach preview listeners
  ['clipperFontSel', 'clipperFontSize', 'clipperColorSel', 'clipperOutlineType', 'clipperOutlineColor', 'clipperFontCustom', 'clipperRatio', 'clipperPosX', 'clipperPosY', 'clipperLetterSpacing', 'clipperTextCase', 'clipperWatermarkToggle', 'clipperWatermarkText', 'clipperWmSize', 'clipperWmOpacity', 'clipperWmPosX', 'clipperWmPosY', 'clipperCrop', 'clipperFacecamPos', 'clipperPadding', 'clipperFontWeight', 'clipperFontArt', 'clipperAnimStyle', 'clipperAnimIn', 'clipperAnimOut'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', updatePreview);
      el.addEventListener('input', updatePreview);
    }
  });

  // Aspect ratio visualizer disable logic and layout shifting
  if (clipperRatio) {
    const handleRatioChange = () => {
      const isLandscape = clipperRatio.value === '16:9' || clipperRatio.value === 'original';
      const cropDropdown = document.getElementById('dropdown_clipperCrop');
      const posDropdown = document.getElementById('dropdown_clipperFacecamPos');
      const selCrop = document.getElementById('clipperCrop');
      const isDefaultCrop = selCrop && (selCrop.value === 'default' || selCrop.value === 'fit');
      
      if (isLandscape) {
        if (cropDropdown) {
          cropDropdown.classList.add('opacity-50', 'pointer-events-none');
          document.getElementById('label_clipperCrop').textContent = 'Not Support (16:9)';
        }
        if (posDropdown) {
          posDropdown.classList.add('opacity-50', 'pointer-events-none');
          document.getElementById('label_clipperFacecamPos').textContent = 'Not Support (16:9)';
        }
      } else {
        if (cropDropdown) {
          cropDropdown.classList.remove('opacity-50', 'pointer-events-none');
          if (selCrop) document.getElementById('label_clipperCrop').textContent = selCrop.options[selCrop.selectedIndex]?.text;
        }
        if (posDropdown) {
          if (isDefaultCrop) {
            posDropdown.classList.add('opacity-50', 'pointer-events-none');
            if (selCrop && selCrop.value === 'fit') {
              document.getElementById('label_clipperFacecamPos').textContent = 'Not Support Fit To Screen';
            } else {
              document.getElementById('label_clipperFacecamPos').textContent = 'Not Support Fit To Center';
            }
          } else {
            posDropdown.classList.remove('opacity-50', 'pointer-events-none');
            const selPos = document.getElementById('clipperFacecamPos');
            if (selPos) document.getElementById('label_clipperFacecamPos').textContent = selPos.options[selPos.selectedIndex]?.text;
          }
        }
      }

      // Dynamic Layout shifting
      const ratio = clipperRatio.value;
      const resWrap = document.getElementById('clipperResWrap');
      const resButtonsWrap = document.getElementById('clipperResButtonsWrap');
      const maxClipsWrap = document.getElementById('clipperMaxClipsWrap');
      const settingsGrid = document.getElementById('clipperSettingsGrid');
      const bottomGrid = document.getElementById('clipperBottomGrid');
      const saveBlock = document.getElementById('clipperSaveConfigBlock');
      const simpanTitle = document.getElementById('simpanConfigTitle');
      
      if (ratio === '9:16') {
         // Show buttons, hide dropdown
         if (resButtonsWrap) resButtonsWrap.classList.remove('hidden');
         if (resWrap) resWrap.classList.add('hidden');
         
         if (bottomGrid && maxClipsWrap && saveBlock) {
             bottomGrid.className = 'grid grid-cols-1 sm:grid-cols-2 gap-4 w-full';
             bottomGrid.insertBefore(maxClipsWrap, saveBlock);
             if (simpanTitle) simpanTitle.classList.remove('hidden');
         }
      } else {
         // Show dropdown, hide buttons
         if (resButtonsWrap) resButtonsWrap.classList.add('hidden');
         if (resWrap) resWrap.classList.remove('hidden');
         
         if (settingsGrid && maxClipsWrap && resWrap && bottomGrid) {
             settingsGrid.appendChild(resWrap);
             settingsGrid.appendChild(maxClipsWrap);
             bottomGrid.className = 'grid grid-cols-1 md:grid-cols-1 gap-4 w-full';
             if (simpanTitle) simpanTitle.classList.remove('hidden');
         }
      }
    };
    
    clipperRatio.addEventListener('change', handleRatioChange);
    
    // State storage for each crop mode
    const cropStatesField = document.createElement('input');
    cropStatesField.type = 'hidden';
    cropStatesField.id = 'clipperCropStatesJSON';
    cropStatesField.value = '{}';
    document.body.appendChild(cropStatesField);
    
    let lastCropMode = document.getElementById('clipperCrop')?.value || 'split_right_mid';
    
    const clipperCropSel = document.getElementById('clipperCrop');
    if (clipperCropSel) {
      clipperCropSel.addEventListener('change', () => {
        const newMode = clipperCropSel.value;
        const stateObj = JSON.parse(document.getElementById('clipperCropStatesJSON').value || '{}');
        
        // Save current to lastMode before switching
        const camZ = document.getElementById('clipperCamZoom')?.value;
        const camX = document.getElementById('clipperCamX')?.value;
        const camY = document.getElementById('clipperCamY')?.value;
        const gameZ = document.getElementById('clipperGameZoom')?.value;
        const gameX = document.getElementById('clipperGameX')?.value;
        const gameY = document.getElementById('clipperGameY')?.value;
        
        if(camZ || camX || camY || gameZ || gameX || gameY) {
            stateObj[lastCropMode] = { camZ, camX, camY, gameZ, gameX, gameY };
        } else {
            delete stateObj[lastCropMode];
        }
        
        // Load newMode state
        const newState = stateObj[newMode] || { camZ:'', camX:'', camY:'', gameZ:'', gameX:'', gameY:'' };
        
        const setV = (id, v) => { const el = document.getElementById(id); if(el) el.value = (v === undefined || v === null) ? '' : v; };
        setV('clipperCamZoom', newState.camZ);
        setV('clipperCamX', newState.camX);
        setV('clipperCamY', newState.camY);
        setV('clipperGameZoom', newState.gameZ);
        setV('clipperGameX', newState.gameX);
        setV('clipperGameY', newState.gameY);
        
        document.getElementById('clipperCropStatesJSON').value = JSON.stringify(stateObj);
        lastCropMode = newMode;
        
        handleRatioChange();
      });
    }
    // Initial call to set correct layout on load
    handleRatioChange();
  }

  const toggleParentsZIndex = (element, elevate) => {
    let curr = element;
    while (curr && curr.id !== 'clipperSection' && curr !== document.body) {
      if (elevate) {
        if (curr.dataset.origZIndex === undefined) curr.dataset.origZIndex = curr.style.zIndex || '';
        curr.style.zIndex = '50';
        if (window.getComputedStyle(curr).position === 'static') {
          curr.dataset.forcedRelative = 'true';
          curr.style.position = 'relative';
        }
      } else {
        if (curr.dataset.origZIndex !== undefined) {
          curr.style.zIndex = curr.dataset.origZIndex;
        }
        if (curr.dataset.forcedRelative) {
          curr.style.position = '';
          delete curr.dataset.forcedRelative;
        }
      }
      curr = curr.parentElement;
    }
  };

  // --- UI UPGRADE LOGIC ---
  const upgradeSelectsToCustomDropdowns = () => {
    const selectsToUpgrade = document.querySelectorAll('#clipperSettings select:not(.custom-select-initialized)');
    
    selectsToUpgrade.forEach(select => {
      select.classList.add('custom-select-initialized');
      select.style.display = 'none'; // hide the native select
      
      const wrapper = document.createElement('div');
      wrapper.className = 'relative custom-dropdown';
      wrapper.id = 'dropdown_' + select.id;
      
      let selectedText = select.options[select.selectedIndex]?.text || '-- Pilih --';
      
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'w-full bg-black/40 border border-primary/30 text-on-surface rounded-lg py-2.5 px-4 hover:border-primary/60 transition-all cursor-pointer outline-none flex justify-between items-center text-sm text-left';
      
      const labelSpan = document.createElement('span');
      labelSpan.id = 'label_' + select.id;
      labelSpan.className = 'truncate pr-2';
      labelSpan.textContent = selectedText;
      
      const iconSpan = document.createElement('span');
      iconSpan.className = 'material-symbols-outlined text-outline-variant pointer-events-none transition-transform duration-200';
      iconSpan.textContent = 'expand_more';
      
      btn.appendChild(labelSpan);
      btn.appendChild(iconSpan);
      
      const menu = document.createElement('div');
      menu.className = 'absolute z-50 w-full mt-2 glass-dropdown rounded-lg shadow-2xl custom-select-menu hidden flex flex-col overflow-hidden max-h-48 overflow-y-auto';
      menu.style.top = '100%';
      
      Array.from(select.options).forEach(opt => {
        const optionBtn = document.createElement('button');
        optionBtn.type = 'button';
        optionBtn.className = 'dropdown-option w-full text-left px-4 py-2.5 text-white hover:bg-secondary/20 hover:text-secondary transition-colors text-sm';
        optionBtn.dataset.value = opt.value;
        optionBtn.textContent = opt.text;
        
        optionBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          select.value = opt.value;
          labelSpan.textContent = opt.text;
          menu.classList.add('hidden');
          iconSpan.style.transform = 'rotate(0deg)';
          toggleParentsZIndex(wrapper, false);
          select.dispatchEvent(new Event('change'));
        });
        
        menu.appendChild(optionBtn);
      });
      
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('#clipperSettings .custom-select-menu').forEach(m => {
          if (m !== menu) {
            m.classList.add('hidden');
            const icon = m.parentElement.querySelector('.material-symbols-outlined');
            if (icon) icon.style.transform = 'rotate(0deg)';
            toggleParentsZIndex(m.parentElement, false);
          }
        });
        
        menu.classList.toggle('hidden');
        if (menu.classList.contains('hidden')) {
          iconSpan.style.transform = 'rotate(0deg)';
          toggleParentsZIndex(wrapper, false);
        } else {
          iconSpan.style.transform = 'rotate(180deg)';
          toggleParentsZIndex(wrapper, true);
        }
      });
      
      select.addEventListener('change', () => {
        labelSpan.textContent = select.options[select.selectedIndex]?.text || '-- Pilih --';
      });
      
      wrapper.appendChild(btn);
      wrapper.appendChild(menu);
      
      select.parentNode.insertBefore(wrapper, select.nextSibling);
    });
  };

  // Close menus when clicking outside
  document.addEventListener('click', () => {
    document.querySelectorAll('#clipperSettings .custom-select-menu').forEach(m => {
      m.classList.add('hidden');
      toggleParentsZIndex(m.parentElement, false);
    });
    document.querySelectorAll('#clipperSettings .custom-dropdown button .material-symbols-outlined').forEach(icon => {
      icon.style.transform = 'rotate(0deg)';
    });

  });


  // Observe resize to update font scale perfectly
  const resizeObserver = new ResizeObserver(() => updatePreview());
  const canvasContainer = document.getElementById('canvasPreviewContainer');
  if (canvasContainer) resizeObserver.observe(canvasContainer);

  // Modal logic for Crop Info
  const btnCropInfo = document.getElementById('btnCropInfo');
  const cropModal = document.getElementById('cropModal');
  const closeCropModal = document.getElementById('closeCropModal');

  if (btnCropInfo && cropModal && closeCropModal) {
    btnCropInfo.addEventListener('click', () => {
      cropModal.classList.remove('hidden');
      // trigger reflow
      void cropModal.offsetWidth;
      cropModal.classList.remove('opacity-0');
    });

    closeCropModal.addEventListener('click', () => {
      cropModal.classList.add('opacity-0');
      setTimeout(() => cropModal.classList.add('hidden'), 300);
    });

    cropModal.addEventListener('click', (e) => {
      if (e.target === cropModal) {
        cropModal.classList.add('opacity-0');
        setTimeout(() => cropModal.classList.add('hidden'), 300);
      }
    });
  }

  // Modal logic for Pos Info
  const btnPosInfo = document.getElementById('btnPosInfo');
  const posModal = document.getElementById('posModal');
  const closePosModal = document.getElementById('closePosModal');

  if (btnPosInfo && posModal && closePosModal) {
    btnPosInfo.addEventListener('click', () => {
      posModal.classList.remove('hidden');
      void posModal.offsetWidth;
      posModal.classList.remove('opacity-0');
    });

    closePosModal.addEventListener('click', () => {
      posModal.classList.add('opacity-0');
      setTimeout(() => posModal.classList.add('hidden'), 300);
    });

    posModal.addEventListener('click', (e) => {
      if (e.target === posModal) {
        posModal.classList.add('opacity-0');
        setTimeout(() => posModal.classList.add('hidden'), 300);
      }
    });
  }

  // Initial update
  setTimeout(updatePreview, 100);
  // --- END LIVE PREVIEW LOGIC ---
  // Load dependency info on init (optional)
  (async () => {
    try {
      const res = await fetch('/api/clipper/check-deps', { method: 'POST' });
      const data = await res.json();
      if (data.ok) state.deps = data.deps;
    } catch (e) {
      console.warn('Failed to check deps');
    }
  })();

  // --- SAVE / RESTORE CONFIGURATION ---
  const configKeys = [
    'clipperCrop', 'clipperFacecamPos', 'clipperRatio', 'clipperPadding', 'clipperMaxClips',
    'clipperCamZoom', 'clipperCamX', 'clipperCamY', 'clipperCropStatesJSON', 'clipperGameZoom', 'clipperGameX', 'clipperGameY',
    'clipperWatermarkToggle', 'clipperWatermarkText', 'clipperWmSize', 'clipperWmOpacity', 'clipperWmPosX', 'clipperWmPosY',
    'clipperSubtitle', 'clipperWhisperModel', 'clipperFontSel', 'clipperFontSize', 'clipperColorSel', 'clipperOutlineType',
    'clipperOutlineColor', 'clipperTextCase', 'clipperPosX', 'clipperPosY', 'clipperLetterSpacing', 'clipperFontWeight',
    'clipperFontArt', 'clipperAnimStyle', 'clipperAnimIn', 'clipperAnimOut'
  ];

  // --- PROFILE MANAGEMENT ---
  const profileSelect = document.getElementById('clipperProfileSelect');
  
  const loadProfileNames = () => {
    if (!profileSelect) return;
    for (let i = 0; i < profileSelect.options.length; i++) {
      const opt = profileSelect.options[i];
      const savedName = localStorage.getItem('fythhx_profilename_' + opt.value);
      if (savedName) {
        opt.text = savedName;
      }
    }
  };

  // Fix: Custom dropdown (btnX/menuX/inputHidden/lblX) gak nge-update labelnya sendiri
  // kalau value di-set programatik (bukan lewat klik menu). Dipakai buat sinkronin
  // clipperFontArt & clipperAnimStyle pas restore config/profile/autosave, biar
  // label yg ketampil ga desync dari value asli (bug: label "None" tapi animasi jalan).
  const CUSTOM_DROPDOWN_MAP = {
    clipperFontArt:   { menuId: 'menuFontArt',   lblId: 'lblFontArt' },
    clipperAnimStyle: { menuId: 'menuAnimStyle', lblId: 'lblAnimStyle' },
  };
  const syncCustomDropdownLabel = (inputId, value) => {
    const map = CUSTOM_DROPDOWN_MAP[inputId];
    if (!map) return;
    const menu = document.getElementById(map.menuId);
    const lbl  = document.getElementById(map.lblId);
    if (!menu || !lbl) return;
    const btn = Array.from(menu.querySelectorAll('button[data-value]'))
      .find(b => b.getAttribute('data-value') === value);
    if (btn) {
      lbl.textContent = btn.textContent;
      if (inputId === 'clipperFontArt') {
        lbl.className = 'truncate ' + Array.from(btn.classList).filter(c => c.startsWith('font-art-')).join(' ');
      }
    }
  };
  // Dipakai juga sama autosave.js (file terpisah) buat sinkron label pas restore per-URL
  window.syncClipperCustomDropdownLabel = syncCustomDropdownLabel;

  const loadConfig = (profileId = 'profile1') => {
    let changed = false;
    configKeys.forEach(id => {
      let saved = localStorage.getItem('fythhx_' + profileId + '_' + id);
      if (saved === null && profileId === 'profile1') {
        saved = localStorage.getItem('fythhx_' + id); // legacy fallback
      }
      const el = document.getElementById(id);
      if (saved !== null && el) {
        if (el.type === 'checkbox') {
           el.checked = saved === 'true';
        } else {
           el.value = saved;
        }
        changed = true;
        
        // Trigger manual events for UI updates
        if (id === 'clipperWatermarkToggle' || id === 'clipperSubtitle' || id === 'clipperFontSel' || id === 'clipperOutlineType') {
          el.dispatchEvent(new Event('change'));
        }
        if (id === 'clipperWmOpacity' || id === 'clipperWmPosX' || id === 'clipperWmPosY') {
          el.dispatchEvent(new Event('input'));
        }
        // Sinkronin label custom-dropdown biar match sama value yg baru di-restore
        syncCustomDropdownLabel(id, saved);
      }
    });
    if (changed) updatePreview();
  };

  // Initialize UI upgrades once DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      upgradeSelectsToCustomDropdowns();
      // Ensure aspect ratio logic runs on load
      if (clipperRatio) clipperRatio.dispatchEvent(new Event('change'));
    }, 200);
    window.addEventListener('resize', () => {
      // Small debounce for resize to avoid spamming layout recalculations
      clearTimeout(window._resizeTimer);
      window._resizeTimer = setTimeout(updatePreview, 50);
    });
  });

  if (profileSelect) {
    loadProfileNames();
    const lastProfile = localStorage.getItem('fythhx_last_profile') || 'profile1';
    profileSelect.value = lastProfile;
    
    profileSelect.addEventListener('change', () => {
      localStorage.setItem('fythhx_last_profile', profileSelect.value);
      loadConfig(profileSelect.value);
      showToast('Profil Dimuat', 'Memuat konfigurasi ' + profileSelect.options[profileSelect.selectedIndex].text, 'info');
    });
  }

  const saveConfigBtn = document.getElementById('clipperSaveConfigBtn');
  if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', () => {
      const activeProfile = profileSelect ? profileSelect.value : 'profile1';
      configKeys.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          localStorage.setItem('fythhx_' + activeProfile + '_' + id, el.type === 'checkbox' ? el.checked : el.value);
        }
      });
      const profileName = profileSelect ? profileSelect.options[profileSelect.selectedIndex].text : 'Profil';
      showToast('Tersimpan', 'Konfigurasi telah disimpan ke ' + profileName, 'success');
    });
  }

  // Load configuration on page load
  setTimeout(() => loadConfig(profileSelect ? profileSelect.value : 'profile1'), 50);

  // Spacebar play/pause for Clipper Preview
  document.addEventListener('keydown', (e) => {
    const clipperSection = document.getElementById('clipperSection');
    if (!clipperSection || clipperSection.classList.contains('hidden')) return;
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    
    if (e.code === 'Space') {
      e.preventDefault();
      const iframeTop = document.getElementById('iframeTop');
      const iframeBottom = document.getElementById('iframeBottom');
      const audioPreview = document.getElementById('clipperAudioPreview');
      
      if (iframeTop && typeof iframeTop.pause === 'function') {
        if (iframeTop.paused) {
          if (typeof window.setClipperPlayState === 'function') window.setClipperPlayState(true);
          iframeTop.play().catch(()=>{});
          if (iframeBottom) iframeBottom.play().catch(()=>{});
          if (audioPreview && audioPreview.src) audioPreview.play().catch(()=>{});
        } else {
          if (typeof window.setClipperPlayState === 'function') window.setClipperPlayState(false);
          iframeTop.pause();
          if (iframeBottom) iframeBottom.pause();
          if (audioPreview) audioPreview.pause();
        }
      }
    }
  });

const interactiveCropSetup = () => {
  const pvTop = document.getElementById('pvTop');
  const pvBottom = document.getElementById('pvBottom');
  if(!pvTop || !pvBottom) return;

  const handleInteract = (container, type) => {
    let isDragging = false;
    let startX, startY;
    let initialX, initialY;
    let initialZoom;
    
    const getVal = (id) => parseFloat(document.getElementById(id)?.value) || null;
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if(el) { el.value = val; el.dispatchEvent(new Event('input')); }
    };
    
    // Zoom via wheel
    container.addEventListener('wheel', (e) => {
      if(!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const zoomInputId = type === 'game' ? 'clipperGameZoom' : 'clipperCamZoom';
      let currentZoom = getVal(zoomInputId);
      if(!currentZoom) {
         // Default zoom
         if(type === 'game') currentZoom = 100;
         else currentZoom = 220;
      }
      
      const delta = e.deltaY > 0 ? -10 : 10;
      let newZoom = currentZoom + delta;
      newZoom = Math.max(10, Math.min(newZoom, 1000));
      setVal(zoomInputId, newZoom);
      updatePreview();
    }, {passive: false});

    // Drag to pan
    const onDragStart = (e) => {
      if (e.target.closest('.no-drag')) return;
      isDragging = true;
      startX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
      startY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
      
      const xInput = type === 'game' ? 'clipperGameX' : 'clipperCamX';
      const yInput = type === 'game' ? 'clipperGameY' : 'clipperCamY';
      
      initialX = getVal(xInput);
      initialY = getVal(yInput);
      
      // Default offsets if none set
      if(initialX === null) {
         if(type === 'game') initialX = 50;
         else {
            const mode = document.getElementById('clipperCrop')?.value;
            initialX = (mode==='split_right' || mode==='split_right_mid') ? 100 : 0;
         }
      }
      if(initialY === null) {
         if(type === 'game') initialY = 50;
         else {
            const mode = document.getElementById('clipperCrop')?.value;
            initialY = (mode==='split_right_mid' || mode==='split_left_mid') ? 50 : 100;
         }
      }
    };

    const onDragMove = (e) => {
      if(!isDragging) return;
      e.preventDefault(); // Prevent scrolling on mobile
      const cx = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
      const cy = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
      
      const dx = cx - startX;
      const dy = cy - startY;
      
      // Convert pixel delta to percentage of container
      const rect = container.getBoundingClientRect();
      const pX = (dx / rect.width) * 100;
      const pY = (dy / rect.height) * 100;
      
      const xInput = type === 'game' ? 'clipperGameX' : 'clipperCamX';
      const yInput = type === 'game' ? 'clipperGameY' : 'clipperCamY';
      
      // Drag kanan = viewport geser kanan = X TURUN (natural camera feel)
      // Ini berlaku sama untuk game maupun cam
      setVal(xInput, Math.min(100, Math.max(0, initialX - pX)));
      setVal(yInput, Math.min(100, Math.max(0, initialY - pY)));
      updatePreview();
    };

    const onDragEnd = () => { isDragging = false; };

    container.addEventListener('mousedown', onDragStart);
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
    
    container.addEventListener('touchstart', onDragStart, {passive: false});
    window.addEventListener('touchmove', onDragMove, {passive: false});
    window.addEventListener('touchend', onDragEnd);
  };
  
  handleInteract(pvTop, 'game');
  handleInteract(pvBottom, 'cam');
};
window.addEventListener('DOMContentLoaded', interactiveCropSetup);
})();

  // Custom Dropdowns Logic
  function setupCustomDropdown(btnId, menuId, inputId, lblId) {
    const btn = document.getElementById(btnId);
    const menu = document.getElementById(menuId);
    const input = document.getElementById(inputId);
    const lbl = document.getElementById(lblId);
    if (!btn || !menu || !input) return;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('hidden');
    });

    menu.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') {
        const val = e.target.getAttribute('data-value');
        input.value = val;
        lbl.textContent = e.target.textContent;
        // Copy classes for font art
        if (btnId === 'btnFontArt') {
           lbl.className = 'truncate ' + Array.from(e.target.classList).filter(c => c.startsWith('font-art-')).join(' ');
        }
        menu.classList.add('hidden');
        input.dispatchEvent(new Event('change'));
      }
    });

    document.addEventListener('click', (e) => {
      if (!btn.contains(e.target) && !menu.contains(e.target)) {
        menu.classList.add('hidden');
      }
    });
  }
  
  document.addEventListener('DOMContentLoaded', () => {
    setupCustomDropdown('btnFontArt', 'menuFontArt', 'clipperFontArt', 'lblFontArt');
    setupCustomDropdown('btnAnimStyle', 'menuAnimStyle', 'clipperAnimStyle', 'lblAnimStyle');
  });





