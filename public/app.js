/**
 * MediaFetch - Frontend Application (Tailwind Version)
 * 
 * Main logic untuk handle user interaction dan API calls
 */

// ========================================
// DOM Elements
// ========================================

const urlInput = document.getElementById('urlInput');
const clearUrlBtn = document.getElementById('clearUrlBtn');
const fetchBtn = document.getElementById('fetchBtn');
const loadingFetch = document.getElementById('loadingFetch');
const metadataSection = document.getElementById('metadataSection');
const thumbnail = document.getElementById('thumbnail');
const thumbnailContainer = document.getElementById('thumbnailContainer');
const thumbnailBlur = document.getElementById('thumbnailBlur');
const thumbnailFallback = document.getElementById('thumbnailFallback');

// Settings Elements
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const browserSelect = document.getElementById('browserSelect');
const customBrowserDropdown = document.getElementById('customBrowserDropdown');
const browserSelectBtn = document.getElementById('browserSelectBtn');
const browserSelectLabel = document.getElementById('browserSelectLabel');
const browserSelectIcon = document.getElementById('browserSelectIcon');
const browserDropdownMenu = document.getElementById('browserDropdownMenu');
const browserOptions = document.querySelectorAll('.browser-option');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const clearCacheBtn = document.getElementById('clearCacheBtn');

// Dynamic thumbnail sizing based on natural aspect ratio
if (thumbnail) {
  thumbnail.onload = function() {
    // Always force aspect-video to maintain consistent card height 
    // and crop baked-in black bars on 4:3 YouTube thumbnails
    thumbnailContainer.classList.add('aspect-video');
    thumbnailContainer.classList.remove('md:aspect-auto');
    
    if (this.naturalHeight > this.naturalWidth) {
      // Portrait (e.g. TikTok) - keep it constrained
      this.classList.add('object-contain');
      this.classList.remove('object-cover');
      if (thumbnailBlur) thumbnailBlur.style.display = 'block';
    } else {
      // Landscape (e.g. YouTube) - let it fill
      this.classList.add('object-cover');
      this.classList.remove('object-contain');
      // Hide blur background since landscape fills the space
      if (thumbnailBlur) thumbnailBlur.style.display = 'none';
    }
  };
}
const videoTitle = document.getElementById('videoTitle');
const videoUploader = document.getElementById('videoUploader');
const videoDuration = document.getElementById('videoDuration');
const videoFilesize = document.getElementById('videoFilesize');
const metadataStatusText = document.getElementById('metadataStatusText');
const metadataStatusDot = document.getElementById('metadataStatusDot');
const metadataStatus = document.getElementById('metadataStatus');
const formatSelect = document.getElementById('formatSelect');
const customFormatDropdown = document.getElementById('customFormatDropdown');
const formatSelectBtn = document.getElementById('formatSelectBtn');
const formatDropdownMenu = document.getElementById('formatDropdownMenu');
const formatSelectLabel = document.getElementById('formatSelectLabel');
const formatSelectIcon = document.getElementById('formatSelectIcon');
const formatOptions = document.querySelectorAll('.format-option');
const mobileFormatBtns = document.querySelectorAll('.mobile-format-btn');
const qualityContainer = document.getElementById('qualityContainer');
const downloadBtn = document.getElementById('downloadBtn');
const downloadBtnText = document.getElementById('downloadBtnText');
const downloadBtnIcon = document.getElementById('downloadBtnIcon');
const cancelBtn = document.getElementById('cancelBtn');
const downloadProgress = document.getElementById('downloadProgress');
const progressStatus = document.getElementById('progressStatus');
const progressPercent = document.getElementById('progressPercent');
const progressFill = document.getElementById('progressFill');
const progressSpeed = document.getElementById('progressSpeed');
const progressEta = document.getElementById('progressEta');

// Recent URLs
const recentUrlsDropdown = document.getElementById('recentUrlsDropdown');
const recentUrlsList = document.getElementById('recentUrlsList');
const clearRecentUrlsBtn = document.getElementById('clearRecentUrlsBtn');

const toastContainer = document.getElementById('toastContainer');
const toastTemplate = document.getElementById('toastTemplate');
const autoSaveToggle = document.getElementById('autoSaveToggle');


const trimmerVideoPreview = document.getElementById('trimmerVideoPreview');
const trimmerVideoWrapper = document.getElementById('trimmerVideoWrapper');
const trimmerEngineRoot = document.getElementById('trimmer-engine-root');
const trimmerSection = document.getElementById('trimmerSection');
const videoTrimToggleRow = document.getElementById('videoTrimToggleRow');
const enableTrimmerToggle = document.getElementById('enableTrimmerToggle');
let trimmerEngine = null;

// Trim mode is now driven by which top nav tab is active (Trimmer vs Downloader),
// not by a toggle switch. Downloader tab = pure download, Trimmer tab = trim always on.
window.isTrimMode = false;


// Quality dropdown stub refs (elements exist hidden for JS compat)
const customQualityDropdown = document.getElementById('customQualityDropdown');
const qualitySelectBtn = document.getElementById('qualitySelectBtn');
const qualitySelectLabel = document.getElementById('qualitySelectLabel');
const qualitySelectIcon = document.getElementById('qualitySelectIcon');
const qualityDropdownMenu = document.getElementById('qualityDropdownMenu');
const qualitySelect = document.getElementById('qualitySelect');



// ========================================
// State Management
// ========================================

const state = {
  currentMetadata: null,
  selectedFormat: null,
  selectedQuality: null,
  isLoading: false,
  isDownloading: false
};

// ========================================
// Event Listeners
// ========================================

// Settings Modal Logic
if (settingsBtn && settingsModal && closeSettingsBtn) {
  settingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
    settingsModal.classList.add('flex');
  });

  closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
    settingsModal.classList.remove('flex');
  });

  // Close when clicking outside modal content
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.add('hidden');
      settingsModal.classList.remove('flex');
    }
  });

  // Custom Browser Dropdown Logic
  let isBrowserDropdownOpen = false;

  function toggleBrowserDropdown() {
    isBrowserDropdownOpen = !isBrowserDropdownOpen;
    if (isBrowserDropdownOpen) {
      browserDropdownMenu.classList.remove('closed');
      browserDropdownMenu.classList.add('open');
      browserSelectBtn.classList.add('border-secondary');
      browserSelectIcon.style.transform = 'rotate(180deg)';
    } else {
      browserDropdownMenu.classList.remove('open');
      browserDropdownMenu.classList.add('closed');
      browserSelectBtn.classList.remove('border-secondary');
      browserSelectIcon.style.transform = 'rotate(0deg)';
    }
  }

  if (browserSelectBtn) {
    browserSelectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleBrowserDropdown();
    });
  }

  if (browserOptions) {
    browserOptions.forEach(option => {
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = option.getAttribute('data-value');
        const text = option.textContent;
        
        browserSelect.value = val;
        browserSelectLabel.textContent = text;
        
        toggleBrowserDropdown();
      });
    });
  }

  document.addEventListener('click', (e) => {
    if (isBrowserDropdownOpen && customBrowserDropdown && !customBrowserDropdown.contains(e.target)) {
      toggleBrowserDropdown();
    }
  });

  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', () => {
      localStorage.setItem('fytx_browser', browserSelect.value);
      settingsModal.classList.add('hidden');
      settingsModal.classList.remove('flex');
      showToast('Tersimpan', `Auto-Login menggunakan browser: ${browserSelectLabel.textContent}`, 'success');
    });
  }

  // Load Auto-Save State
  if (autoSaveToggle) {
    const savedAutoSave = localStorage.getItem('autoSaveDevice');
    if (savedAutoSave === 'true') {
      autoSaveToggle.checked = true;
    }
    autoSaveToggle.addEventListener('change', (e) => {
      localStorage.setItem('autoSaveDevice', e.target.checked);
    });
  }
}

// Clear Cache Button Logic
if (clearCacheBtn) {
  clearCacheBtn.addEventListener('click', async () => {
    const originalText = clearCacheBtn.innerHTML;
    clearCacheBtn.disabled = true;
    clearCacheBtn.innerHTML = '<span class="material-symbols-outlined spin">autorenew</span> Membersihkan...';
    
    try {
      const response = await fetch('/api/clear-cache', { method: 'POST' });
      if (response.ok) {
        showToast('Success', 'Cache and temporary files successfully cleared', 'success');
      } else {
        showToast('Error', 'Failed to clear cache', 'error');
      }
    } catch (err) {
      showToast('Error', err.message, 'error');
    } finally {
      clearCacheBtn.innerHTML = originalText;
      clearCacheBtn.disabled = false;
    }
  });
}

// Fetch button click
fetchBtn.addEventListener('click', handleFetch);

// Enter key on URL input
urlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    handleFetch();
  }
});

// ========================================
// Tab Navigation Logic
// ========================================
const tabDownloader = document.getElementById('tabDownloader');
const tabTrimmer = document.getElementById('tabTrimmer');
const tabClipper = document.getElementById('tabClipper');
const downloaderSection = document.getElementById('downloaderSection');
const metadataCard = document.getElementById('metadataCard');
const clipperSection = document.getElementById('clipperSection');


const tabStorage = document.getElementById('tabStorage');
const storageSection = document.getElementById('storageSection');

// Make tabs globally available for the window so other scripts can interact
window.tabDownloader = tabDownloader;
window.tabTrimmer = tabTrimmer;
window.tabClipper = tabClipper;

window.tabStorage = tabStorage;

window.activateMainTab = function(tab) {
  if (!tabDownloader || !tabClipper) return;
  
  // Reset all tabs
  const allTabs = [tabDownloader, tabTrimmer, tabClipper, tabStorage].filter(Boolean);
  const allSections = [downloaderSection, clipperSection, storageSection].filter(Boolean);
  
  allTabs.forEach(t => {
    t.classList.remove('active', 'text-primary', 'border-b-2', 'border-primary');
    t.classList.add('text-on-surface-variant', 'hover:text-white');
  });
  
  allSections.forEach(s => {
    s.classList.add('hidden');
  });

  // Metadata card (thumbnail/title/channel/duration/filesize/status) only
  // shows on the Downloader tab — Trimmer/Clipper/Storage hide it.
  if (metadataCard) {
    if (tab === 'downloader') {
      metadataCard.classList.remove('hidden');
    } else {
      metadataCard.classList.add('hidden');
    }
  }

  // Pause all playing videos to save bandwidth and prevent 403 / proxy spam
  ['videoPlayer', 'trimmerVideoPreview', 'trimmerAudioPreview', 'iframeTop', 'iframeBottom', 'clipperAudioPreview'].forEach(id => {
    const vid = document.getElementById(id);
    if (vid && typeof vid.pause === 'function') {
      vid.pause();
    }
  });

  // Also reset clipper play/pause button state to avoid glitch
  if (typeof window.setClipperPlayState === 'function') {
    window.setClipperPlayState(false);
  }
  
  // Sync TimelineEngine UI so the Play/Pause icon resets correctly
  if (trimmerEngine && typeof trimmerEngine.playback?.pause === 'function') {
    trimmerEngine.playback.pause();
  }

  // Activate target
  if (tab === 'downloader') {
    tabDownloader.classList.add('active', 'text-primary', 'border-b-2', 'border-primary');
    tabDownloader.classList.remove('text-on-surface-variant', 'hover:text-white');
    downloaderSection.classList.remove('hidden');

    // Pure download mode: trim is never active here, even if a quality was
    // already picked while the user was on the Trimmer tab.
    window.isTrimMode = false;
    hideTrimmerUI();
    if (downloadBtnText) downloadBtnText.textContent = 'Download';
    if (downloadBtnIcon) downloadBtnIcon.textContent = 'download';
  } else if (tab === 'trimmer') {
    if (tabTrimmer) {
      tabTrimmer.classList.add('active', 'text-primary', 'border-b-2', 'border-primary');
      tabTrimmer.classList.remove('text-on-surface-variant', 'hover:text-white');
    }
    // Trimmer shares the same Output Settings panel as Downloader (same
    // format/resolution pickers) — it just always keeps the trim timeline on.
    downloaderSection.classList.remove('hidden');

    window.isTrimMode = true;
    if (downloadBtnText) downloadBtnText.textContent = 'Trim Video';
    if (downloadBtnIcon) downloadBtnIcon.textContent = 'content_cut';

    if (state.currentMetadata) {
      if (state.selectedFormat === 'mp4') {
        // Format's already MP4 (picked earlier, or coming back to this tab) —
        // just make sure the preview/timeline is mounted.
        showTrimmerUI();
      } else {
        // No format picked yet (or MP3 was picked) — auto-select MP4 so the
        // preview + timeline shows immediately, no manual format/quality pick needed.
        const mp4Option = document.querySelector('.format-option[data-value="mp4"]');
        if (formatSelectLabel && mp4Option) formatSelectLabel.textContent = mp4Option.textContent;
        if (formatSelect) formatSelect.value = 'mp4';
        if (mobileFormatBtns) {
          mobileFormatBtns.forEach(btn => {
            if (btn.getAttribute('data-value') === 'mp4') {
              btn.classList.add('bg-[#02CEFF]/10', 'border-[#02CEFF]', 'text-[#02CEFF]');
              btn.classList.remove('bg-[#0A222F]', 'border-white/5', 'text-[#C4C3C5]');
            } else {
              btn.classList.remove('bg-[#02CEFF]/10', 'border-[#02CEFF]', 'text-[#02CEFF]');
              btn.classList.add('bg-[#0A222F]', 'border-white/5', 'text-[#C4C3C5]');
            }
          });
        }
        handleFormatChange({ target: { value: 'mp4' } });
      }
    }
  } else if (tab === 'clipper') {
    tabClipper.classList.add('active', 'text-primary', 'border-b-2', 'border-primary');
    tabClipper.classList.remove('text-on-surface-variant', 'hover:text-white');
    clipperSection.classList.remove('hidden');

  }
};

if (tabDownloader && tabClipper) {
  tabDownloader.addEventListener('click', () => window.activateMainTab('downloader'));
  if (tabTrimmer) {
    tabTrimmer.addEventListener('click', () => window.activateMainTab('trimmer'));
  }
  tabClipper.addEventListener('click', () => window.activateMainTab('clipper'));

  // Note: tabStorage click logic is still in storage.js, but we can also handle it here if preferred.
  // Actually, I'll let storage.js handle its own click event for now since it needs to call loadFiles(),
  // but it's fine as long as activateMainTab properly hides storageSection when other tabs are clicked.
}

// ========================================
// Recent URLs (localStorage history)
// ========================================

const RECENT_URLS_KEY = 'fytx_recent_urls';
const RECENT_URLS_MAX = 8;

function getRecentUrls() {
  try { return JSON.parse(localStorage.getItem(RECENT_URLS_KEY) || '[]'); }
  catch { return []; }
}

function saveRecentUrl(url, title) {
  if (!url || !url.startsWith('http')) return;
  let list = getRecentUrls();
  // Remove duplicates of same URL
  list = list.filter(item => item.url !== url);
  // Prepend newest
  list.unshift({ url, title: title || url, savedAt: Date.now() });
  // Keep max 8
  list = list.slice(0, RECENT_URLS_MAX);
  localStorage.setItem(RECENT_URLS_KEY, JSON.stringify(list));
  renderRecentUrls();
}

function deleteRecentUrl(url) {
  let list = getRecentUrls().filter(item => item.url !== url);
  localStorage.setItem(RECENT_URLS_KEY, JSON.stringify(list));
  renderRecentUrls();
  if (list.length === 0) hideRecentDropdown();
}

function clearAllRecentUrls() {
  localStorage.removeItem(RECENT_URLS_KEY);
  renderRecentUrls();
  hideRecentDropdown();
}

function renderRecentUrls() {
  if (!recentUrlsList) return;
  const list = getRecentUrls();
  recentUrlsList.innerHTML = '';

  if (list.length === 0) {
    recentUrlsList.innerHTML = `<div class="px-4 py-3 text-center" style="color:rgba(255,255,255,0.25);font-size:12px;">Belum ada riwayat link</div>`;
    return;
  }

  list.forEach(item => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'w-full text-left flex items-center gap-2 px-3 py-2 md:px-4 md:py-2.5 transition-colors group';
    row.style.cssText = 'border-bottom: 1px solid rgba(255,255,255,0.04);';
    row.onmouseenter = () => row.style.background = 'rgba(255,255,255,0.05)';
    row.onmouseleave = () => row.style.background = '';

    // Shorten URL for display
    const displayUrl = item.url.replace(/^https?:\/\/(www\.)?/, '').substring(0, 52) + (item.url.length > 60 ? '...' : '');
    const timeAgo = formatTimeAgo(item.savedAt);

    row.innerHTML = `
      <span class="material-symbols-outlined flex-shrink-0" style="font-size:16px;color:rgba(2,206,255,0.7);">history</span>
      <span class="flex-1 min-w-0">
        <span class="block text-white text-[12px] md:text-[13px] font-medium truncate">${escapeHtml(item.title)}</span>
        <span class="block text-[10px] md:text-[11px] truncate" style="color:rgba(255,255,255,0.35);">${escapeHtml(displayUrl)}</span>
      </span>
      <span class="flex-shrink-0 text-[9px] md:text-[10px] mr-1" style="color:rgba(255,255,255,0.25);white-space:nowrap;">${timeAgo}</span>
      <span class="delete-btn flex-shrink-0 material-symbols-outlined opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-400" style="font-size:15px;color:rgba(255,255,255,0.4);">close</span>
    `;

    // Click row = fill input
    row.addEventListener('click', (e) => {
      // If clicking delete icon
      if (e.target.classList.contains('delete-btn')) {
        e.stopPropagation();
        deleteRecentUrl(item.url);
        return;
      }
      urlInput.value = item.url;
      if (clearUrlBtn) clearUrlBtn.classList.remove('hidden');
      hideRecentDropdown();
      urlInput.focus();
    });

    recentUrlsList.appendChild(row);
  });
}

function showRecentDropdown() {
  if (!recentUrlsDropdown) return;
  const list = getRecentUrls();
  if (list.length === 0) return;
  renderRecentUrls();
  recentUrlsDropdown.classList.remove('hidden');
}

function hideRecentDropdown() {
  if (recentUrlsDropdown) recentUrlsDropdown.classList.add('hidden');
}

function formatTimeAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'baru saja';
  if (diff < 3600) return `${Math.floor(diff/60)}m lalu`;
  if (diff < 86400) return `${Math.floor(diff/3600)}j lalu`;
  return `${Math.floor(diff/86400)}h lalu`;
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Wire up recent URLs UI events
if (urlInput) {
  urlInput.addEventListener('focus', () => showRecentDropdown());
  urlInput.addEventListener('input', () => {
    // Show/hide clear button
    if (clearUrlBtn) {
      if (urlInput.value.length > 0) {
        clearUrlBtn.classList.remove('hidden');
      } else {
        clearUrlBtn.classList.add('hidden');
      }
    }

    // Hide history when user is typing something new
    if (urlInput.value.trim().length > 0) {
      hideRecentDropdown();
      // Clear previous metadata to prevent downloading with old title/formats
      if (state.currentMetadata && state.currentMetadata.url !== urlInput.value.trim()) {
        state.currentMetadata = null;
        metadataSection.classList.add('hidden');
        displayMetadata({ title: '', uploader: '', duration: 0 }); // reset form completely
        metadataSection.classList.add('hidden'); // ensure it's hidden
        updateDownloadButtonState();
      }
    } else {
      const shortcuts = document.getElementById('shortcutButtonsContainer');
      if (shortcuts) {
        shortcuts.classList.remove('hidden');
        shortcuts.style.display = '';
      }
      // URL kosong (misal user hapus manual pake backspace) — sembunyikan
      // tab menu (Downloader/Trimmer/Clipper/Storage) juga.
      const tabNav = document.getElementById('tabNavigation');
      if (tabNav) tabNav.classList.add('hidden');
      showRecentDropdown();
    }
  });
}

if (clearUrlBtn) {
  clearUrlBtn.addEventListener('click', () => {
    urlInput.value = '';
    clearUrlBtn.classList.add('hidden');
    urlInput.focus();
    
    const shortcuts = document.getElementById('shortcutButtonsContainer');
    if (shortcuts) {
      shortcuts.classList.remove('hidden');
      shortcuts.style.display = '';
    }
    
    // Clear metadata
    if (state.currentMetadata) {
      state.currentMetadata = null;
      metadataSection.classList.add('hidden');
      displayMetadata({ title: '', uploader: '', duration: 0 }); // reset form completely
      metadataSection.classList.add('hidden'); // ensure it's hidden
      updateDownloadButtonState();
    }

    // Klik X di input URL -> sembunyikan tab menu (Downloader/Trimmer/Clipper/Storage)
    const tabNav = document.getElementById('tabNavigation');
    if (tabNav) tabNav.classList.add('hidden');

    showRecentDropdown();
  });
}

document.addEventListener('click', (e) => {
  if (recentUrlsDropdown && !recentUrlsDropdown.contains(e.target) && e.target !== urlInput) {
    hideRecentDropdown();
  }
});

if (clearRecentUrlsBtn) {
  clearRecentUrlsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearAllRecentUrls();
  });
}

// Init: pre-render on load
renderRecentUrls();

let isDropdownOpen = false;

function toggleDropdown() {
  isDropdownOpen = !isDropdownOpen;
  if (isDropdownOpen) {
    formatDropdownMenu.classList.remove('closed');
    formatDropdownMenu.classList.add('open');
    formatSelectBtn.classList.add('border-secondary');
    formatSelectIcon.style.transform = 'rotate(180deg)';
  } else {
    formatDropdownMenu.classList.remove('open');
    formatDropdownMenu.classList.add('closed');
    formatSelectBtn.classList.remove('border-secondary');
    formatSelectIcon.style.transform = 'rotate(0deg)';
  }
}

formatSelectBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleDropdown();
});

document.addEventListener('click', (e) => {
  if (isDropdownOpen && !customFormatDropdown.contains(e.target)) {
    toggleDropdown();
  }
});

formatOptions.forEach(option => {
  option.addEventListener('click', (e) => {
    e.stopPropagation();
    const value = option.getAttribute('data-value');
    const label = option.textContent;
    
    // Update label and hidden select
    formatSelectLabel.textContent = label;
    formatSelect.value = value;
    
    // Trigger format change
    handleFormatChange({ target: formatSelect });
    
    // Close dropdown explicitly
    isDropdownOpen = false;
    formatDropdownMenu.classList.remove('open');
    formatDropdownMenu.classList.add('closed');
    formatSelectBtn.classList.remove('border-secondary');
    formatSelectIcon.style.transform = 'rotate(0deg)';
  });
});

mobileFormatBtns.forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const value = btn.getAttribute('data-value');
    
    // Update label for desktop consistency
    const desktopLabel = value === 'mp4' ? 'MP4 (Video)' : value === 'mp3' ? 'MP3 (Audio)' : '-- Select a format --';
    if (formatSelectLabel) formatSelectLabel.textContent = desktopLabel;
    if (formatSelect) formatSelect.value = value;
    
    // Trigger format change
    handleFormatChange({ target: formatSelect });
  });
});

// Format selection change (fallback if triggered programmatically)
formatSelect.addEventListener('change', handleFormatChange);


// Download button click
downloadBtn.addEventListener('click', handleDownload);

// Cancel button click
cancelBtn.addEventListener('click', handleCancel);

// Trimmer display: two stages
// Stage 1: showPreviewOnly() — called immediately when MP4 format is picked
// Stage 2: toggle ON — calls showTrimmerUI() to mount timeline engine
function loadPreviewWithAudio() {
  // Show preview using best available audio-capable format (no quality selection required)
  if (!state.currentMetadata) return;
  const formats = state.currentMetadata.formats;
  if (!formats.video || formats.video.length === 0) return;

  const fallback = formats.video[0];
  const previewUrl = state.currentMetadata.previewUrl || (fallback ? fallback.url : null);
  if (!previewUrl || !trimmerVideoPreview) return;

  const uaParam = state.currentMetadata && state.currentMetadata.userAgent ? `&ua=${encodeURIComponent(state.currentMetadata.userAgent)}` : '';
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(previewUrl)}${uaParam}`;
  
  if (trimmerVideoPreview.src !== proxyUrl && trimmerVideoPreview.dataset.currentProxyUrl !== proxyUrl) {
    previewRetries = 0;
  }
  trimmerVideoPreview.src = proxyUrl;
  
  // DASH Audio Syncing
  let audioPreview = document.getElementById('trimmerAudioPreview');
  if (!audioPreview) {
    audioPreview = document.createElement('audio');
    audioPreview.id = 'trimmerAudioPreview';
    audioPreview.style.display = 'none';
    document.body.appendChild(audioPreview);
    
    // Sync events
    trimmerVideoPreview.addEventListener('play', () => audioPreview.play().catch(()=>{}));
    trimmerVideoPreview.addEventListener('pause', () => audioPreview.pause());
    trimmerVideoPreview.addEventListener('seeked', () => {
      if (Math.abs(audioPreview.currentTime - trimmerVideoPreview.currentTime) > 0.5) {
        audioPreview.currentTime = trimmerVideoPreview.currentTime;
      }
    });
    trimmerVideoPreview.addEventListener('volumechange', () => {
      audioPreview.volume = trimmerVideoPreview.volume;
      audioPreview.muted = trimmerVideoPreview.muted;
    });
  }
  
  const previewAudioUrl = state.currentMetadata.previewAudioUrl;
  if (previewAudioUrl) {
    const audioProxyUrl = `/api/proxy?url=${encodeURIComponent(previewAudioUrl)}${uaParam}`;
    audioPreview.src = audioProxyUrl;
    // We don't force mute trimmerVideoPreview here because it would trigger volumechange 
    // and mute the audioPreview as well.
  } else {
    // If no separate audio, unmute video (maybe it's a combined stream)
    trimmerVideoPreview.muted = false;
    audioPreview.src = '';
  }
}

let previewRetries = 0;
trimmerVideoPreview.addEventListener('error', (e) => {
  if (previewRetries < 3) {
    previewRetries++;
    console.log(`[Preview] Error loading video (maybe edge node not synced). Retrying attempt ${previewRetries}...`);
    setTimeout(() => {
      const currentSrc = trimmerVideoPreview.src;
      if (currentSrc) {
        trimmerVideoPreview.src = '';
        trimmerVideoPreview.src = currentSrc;
        trimmerVideoPreview.load();
      }
    }, 2000);
  } else {
    console.error('[Preview] Failed to load video after 3 retries.');
  }
});

function showPreviewOnly() {
  // Show toggle row immediately on MP4 format select — no quality needed
  if (videoTrimToggleRow) videoTrimToggleRow.classList.remove('hidden');
  loadPreviewWithAudio();

  // On the Trimmer tab, mount the full preview+timeline right away — no need
  // to wait for a resolution pick first. loadMediaIntoTrimmer() falls back to
  // the first available quality when state.selectedQuality isn't set yet.
  if (window.isTrimMode) {
    showTrimmerUI();
  }
}

function showTrimmerUI() {
  // Mount and show timeline section and preview
  if (trimmerSection) trimmerSection.classList.remove('hidden');
  if (trimmerVideoWrapper) trimmerVideoWrapper.classList.remove('hidden');
  if (downloadBtnText) downloadBtnText.textContent = 'Trim Video';
  if (downloadBtnIcon) downloadBtnIcon.textContent = 'content_cut';
  if (!trimmerEngine) {
    if (trimmerVideoPreview) trimmerVideoPreview.muted = false;
    trimmerEngine = new TimelineEngine();
    trimmerEngine.mount(trimmerEngineRoot, trimmerVideoPreview);
  }
  loadMediaIntoTrimmer();
}

function hideTrimmerUI() {
  // Hide timeline section and preview
  if (trimmerSection) trimmerSection.classList.add('hidden');
  if (trimmerVideoWrapper) trimmerVideoWrapper.classList.add('hidden');
  
  // Also hide Clip Manager & Actions
  const multiTrimContainer = document.getElementById('multiTrimContainer');
  if (multiTrimContainer) multiTrimContainer.classList.add('hidden');

  if (trimmerEngine) trimmerEngine.playback.pause();
}

function hideAllTrimmerUI() {
  // Full reset: hide preview, toggle row, timeline — called on format change
  if (trimmerSection) trimmerSection.classList.add('hidden');
  if (trimmerVideoWrapper) trimmerVideoWrapper.classList.add('hidden');
  if (videoTrimToggleRow) {
    videoTrimToggleRow.classList.add('hidden');
  }

  // Also hide Clip Manager & Actions
  const multiTrimContainer = document.getElementById('multiTrimContainer');
  if (multiTrimContainer) multiTrimContainer.classList.add('hidden');
  if (downloadBtnText) downloadBtnText.textContent = 'Download';
  if (downloadBtnIcon) downloadBtnIcon.textContent = 'download';
  if (trimmerVideoPreview) {
    trimmerVideoPreview.src = '';
    delete trimmerVideoPreview.dataset.currentProxyUrl;
  }
  const noteEl = document.getElementById('trimmerPreviewNote');
  if (noteEl) noteEl.classList.add('hidden');
  if (trimmerEngine) trimmerEngine.playback.pause();
}

function loadMediaIntoTrimmer() {
  if (!trimmerEngine || !state.currentMetadata || !state.selectedFormat) return;
  // Trimmer hanya support MP4
  if (state.selectedFormat !== 'mp4') return;
  const formats = state.currentMetadata.formats;
  if (!formats || !formats.video.length) return;

  // Use selected quality for download, but preview might use a lighter format if available
  const selected = formats.video.find(f => f.format_id === state.selectedQuality);
  const downloadUrl = selected ? selected.url : (formats.video[0] ? formats.video[0].url : null);
    
  // Gunakan resolusi terendah (index 0) atau previewUrl khusus untuk PREVIEW, 
  // supaya ganti resolusi download tidak mereload video preview.
  const previewSourceUrl = state.currentMetadata.previewUrl || (formats.video[0] ? formats.video[0].url : null);
      
  // Use proxy for video preview because YouTube binds the stream URL to the specific User-Agent.
  // The user's browser might have a different UA, causing 403s. Our proxy spoofs the correct UA perfectly.
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(previewSourceUrl)}`;

  // Cuma reload video (dan restart timeline/thumbnail) kalau ini video yang
  // BENERAN beda dari yang lagi ditampilin sekarang. Ganti resolusi/quality
  // download gak pernah mengubah previewSourceUrl (lihat komentar di atas),
  // jadi proxyUrl-nya bakal identik -> skip reload, video terus jalan.
  if (trimmerVideoPreview.dataset.currentProxyUrl === proxyUrl) {
    return;
  }

  trimmerVideoPreview.dataset.currentProxyUrl = proxyUrl;
  previewRetries = 0;
  trimmerVideoPreview.src = proxyUrl;
  
  // Pass proxy URL and User-Agent to trimmerEngine so it doesn't expire
  const safeVideoId = window.state?.videoId || window.extractVideoId?.(urlInput.value) || state.currentMetadata.id || '';
  trimmerEngine.loadMedia(proxyUrl, state.currentMetadata.duration, safeVideoId, state.currentMetadata.userAgent);
}

// ========================================
// Handler Functions
// ========================================

/**
 * Handle fetch metadata
 */
// --- UTILS ---
window.extractVideoId = function(url) {
  try {
    let cleanUrl = url.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) cleanUrl = 'https://' + cleanUrl;
    const parsed = new URL(cleanUrl);
    
    if (parsed.hostname === 'youtu.be' || parsed.hostname === 'www.youtu.be') {
      const pathId = parsed.pathname.slice(1).split('?')[0]; // remove query params if any
      if (pathId) return pathId;
    }
    
    if (parsed.hostname.includes('youtube.com')) {
      if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
      if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.split('/')[2];
      if (parsed.pathname.startsWith('/live/')) return parsed.pathname.split('/')[2];
      if (parsed.pathname.startsWith('/embed/')) return parsed.pathname.split('/')[2];
    }
    
    // Fallback for TikTok, Twitter, Facebook, or other platforms:
    // Gunakan hostname + pathname sebagai ID (mengabaikan tracking parameters seperti ?si= atau &utm=)
    let fallbackId = parsed.hostname + parsed.pathname;
    return fallbackId.replace(/[^a-zA-Z0-9]/g, '_');
  } catch (e) { 
    // Fallback terakhir jika URL gak bisa di-parse
    return url.replace(/[^a-zA-Z0-9]/g, '_');
  }
};

// --- SESSION AUTO-SAVE LOGIC ---
let lastSessionStr = "";

window.saveFytxSession = function() {
try {
  if (!state.currentMetadata) return;
  if (!state.videoId) {
    if (typeof window.showToast === 'function') window.showToast('AutoSave Error', 'Gagal Auto-Save: state.videoId kosong!', 'error');
    return;
  }

  const session = {
    timestamp: Date.now(),
    metadata: state.currentMetadata,
    customTrims: window.customTrims || [],
    multiTrimActive: document.getElementById('tl-btn-multi-trim')?.classList.contains('active') || false,
    trimToggle: !!window.isTrimMode,
    format: document.getElementById('formatSelect')?.value || '',
    quality: state.selectedQuality || '',
    clipperState: {
      heatmapSegments: window.state?.segments || [],
      crop: document.getElementById('clipperCrop')?.value || 'default',
      ratio: document.getElementById('clipperRatio')?.value || '9:16',
      facecamPos: document.getElementById('clipperFacecamPos')?.value || 'bottom',
      resolution: document.getElementById('clipperResolution')?.value || '1080',
      subtitle: document.getElementById('clipperSubtitle')?.value || 'n',
      font: document.getElementById('clipperFontSel')?.value || 'Inter',
      fontCustom: document.getElementById('clipperFontCustom')?.value || '',
      fontSize: document.getElementById('clipperFontSize')?.value || '70',
      color: document.getElementById('clipperColorSel')?.value || '#FFFFFF',
      outlineType: document.getElementById('clipperOutlineType')?.value || 'stroke',
      outlineColor: document.getElementById('clipperOutlineColor')?.value || '&H000000&',
      textCase: document.getElementById('clipperTextCase')?.value || 'title',
      posX: document.getElementById('clipperPosX')?.value || '50',
      posY: document.getElementById('clipperPosY')?.value || '80',
      letterSpacing: document.getElementById('clipperLetterSpacing')?.value || '0',
      subtitleEngine: document.getElementById('clipperSubtitleEngine')?.value || 'local',
      whisperModel: document.getElementById('clipperWhisperModel')?.value || 'small',
      maxWords: document.getElementById('clipperMaxWords')?.value || '3',
      maxClips: document.getElementById('clipperMaxClips')?.value || '3',
      padding: document.getElementById('clipperPadding')?.value || '0',
      watermarkToggle: document.getElementById('clipperWatermarkToggle')?.value || 'n',
      watermarkText: document.getElementById('clipperWatermarkText')?.value || '',
      wmSize: document.getElementById('clipperWmSize')?.value || '40',
      wmOpacity: document.getElementById('clipperWmOpacity')?.value || '50',
      wmPosX: document.getElementById('clipperWmPosX')?.value || '50',
      wmPosY: document.getElementById('clipperWmPosY')?.value || '20',
      selectedSegments: Array.from(window.state?.selectedSegments || [])
    }
  };
  
  const currentSessionStr = JSON.stringify(session);
  // Cek apakah ada perubahan (kecuali timestamp)
  const sessionWithoutTime = { ...session }; delete sessionWithoutTime.timestamp;
  const currentStrNoTime = JSON.stringify(sessionWithoutTime);
  
  if (lastSessionStr !== currentStrNoTime) {
    localStorage.setItem('fytx_session_' + state.videoId, currentSessionStr);
    lastSessionStr = currentStrNoTime;
    
    // Tampilkan notifikasi kecil
    const autoSaveToast = document.getElementById('autoSaveToast');
    if (autoSaveToast) {
      autoSaveToast.classList.remove('opacity-0', 'translate-y-4');
      setTimeout(() => {
        autoSaveToast.classList.add('opacity-0', 'translate-y-4');
      }, 3000);
    } else if (typeof window.showToast === 'function') {
      window.showToast('Save Progress', 'Progress saved.', 'success');
    }
  }
} catch (err) {
  console.error("AutoSave Error:", err);
  if (typeof window.showToast === 'function') window.showToast('AutoSave Error', err.message, 'error');
}
};

// Jalankan autosave tiap 2 detik jika ada metadata
setInterval(window.saveFytxSession, 2000);

// Extra safety: save on tab switch or close
window.addEventListener('beforeunload', () => { window.saveFytxSession(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) window.saveFytxSession(); });

window.restoreSessionData = function(session, isBackgroundRefetch) {
  state.currentMetadata = session.metadata;
  const extractedId = window.extractVideoId(urlInput.value.trim());
  if (extractedId) state.videoId = extractedId;
  
  // Render Metadata Instan
  displayMetadata(session.metadata);
  saveRecentUrl(urlInput.value.trim(), session.metadata.title || urlInput.value);
  
  // Restore Trim State
  window.customTrims = session.customTrims || [];
  if (typeof updateCustomTrimUI === 'function') updateCustomTrimUI();
  
  // Multi Trim toggle state is restored in the trimToggle section below to ensure DOM exists
  
  if (session.format) {
    const fs = document.getElementById('formatSelect');
    if (fs) {
      fs.value = session.format;
      const fLabel = document.getElementById('formatSelectLabel');
      if (fLabel) fLabel.textContent = session.format === 'mp4' ? 'MP4 (Video)' : 'MP3 (Audio)';
      if (typeof handleFormatChange === 'function') handleFormatChange({ target: fs });
    }
  }
  
  if (session.quality) {
    setTimeout(() => { // wait for handleFormatChange to populate quality buttons
      const btns = document.querySelectorAll('.quality-btn');
      btns.forEach(btn => {
        if (btn.dataset.value === session.quality) {
          btn.click();
        }
      });
    }, 100);
  }
  
  if (session.trimToggle) {
    const restoreMultiTrim = () => {
      const btnMultiTrim = document.getElementById('tl-btn-multi-trim');
      if (btnMultiTrim) {
        if (session.multiTrimActive && !btnMultiTrim.classList.contains('active')) {
          btnMultiTrim.click();
        } else if (!session.multiTrimActive && btnMultiTrim.classList.contains('active')) {
          btnMultiTrim.click();
        }
      }
    };

    // Tunggu sebentar biar click dari quality dan reset UI selesai, lalu
    // pindah ke tab Trimmer (menggantikan toggle switch yang lama).
    setTimeout(() => {
      if (window.activateMainTab) window.activateMainTab('trimmer');
      setTimeout(restoreMultiTrim, 100);
    }, 150);
  }
  
  // Restore Clipper State
  if (session.clipperState) {
    const cs = session.clipperState;
    const setVal = (id, val, lblId, lblSuffix = '') => { 
      const el = document.getElementById(id); 
      if (el && val) { 
        el.value = val; 
        el.dispatchEvent(new Event('change')); 
        if (lblId) {
          const lbl = document.getElementById(lblId);
          if (lbl) lbl.textContent = val + lblSuffix;
        }
      } 
    };
    setVal('clipperCrop', cs.crop);
    setVal('clipperRatio', cs.ratio);
    setVal('clipperFacecamPos', cs.facecamPos);
    setVal('clipperResolution', cs.resolution);
    setVal('clipperSubtitle', cs.subtitle);
    setVal('clipperFontSel', cs.font);
    setVal('clipperFontCustom', cs.fontCustom);
    setVal('clipperFontSize', cs.fontSize, 'lblFontSizeVal');
    setVal('clipperColorSel', cs.color);
    setVal('clipperOutlineType', cs.outlineType);
    setVal('clipperOutlineColor', cs.outlineColor);
    setVal('clipperTextCase', cs.textCase);
    setVal('clipperPosX', cs.posX, 'lblSubPosX', '%');
    setVal('clipperPosY', cs.posY, 'lblSubPosY', '%');
    setVal('clipperLetterSpacing', cs.letterSpacing, 'lblLetterSpacing', 'px');
    setVal('clipperSubtitleEngine', cs.subtitleEngine);
    setVal('clipperWhisperModel', cs.whisperModel);
    setVal('clipperMaxWords', cs.maxWords, 'lblMaxWordsCounter');
    setVal('clipperMaxClips', cs.maxClips, 'lblMaxClipsCounter');
    setVal('clipperPadding', cs.padding);
    setVal('clipperWatermarkToggle', cs.watermarkToggle);
    setVal('clipperWatermarkText', cs.watermarkText);
    setVal('clipperWmSize', cs.wmSize, 'lblWmSize');
    setVal('clipperWmOpacity', cs.wmOpacity, 'lblWmOpacity', '%');
    setVal('clipperWmPosX', cs.wmPosX, 'lblWmPosX', '%');
    setVal('clipperWmPosY', cs.wmPosY, 'lblWmPosY', '%');
    
    // Trik buat set selectedSegments sehabis render heatmap
    if (!isBackgroundRefetch && cs.heatmapSegments && cs.heatmapSegments.length > 0 && typeof window.scanHeatmap === 'function') {
      window.scanHeatmap(urlInput.value.trim(), session.metadata, cs.heatmapSegments);
      setTimeout(() => {
        if (cs.selectedSegments) {
          window.state.selectedSegments = new Set(cs.selectedSegments);
          if (typeof window.renderClipperSegments === 'function') window.renderClipperSegments();
        }
      }, 300);
    } else if (!isBackgroundRefetch && typeof window.scanHeatmap === 'function') {
      window.scanHeatmap(urlInput.value.trim(), session.metadata);
    }
  } else {
    if (!isBackgroundRefetch && typeof window.scanHeatmap === 'function') {
      window.scanHeatmap(urlInput.value.trim(), session.metadata);
    }
  }

  if (isBackgroundRefetch) {
    showToast('Info', 'The session has been restored. Updating the streaming link in the background...', 'info');
  } else {
    showToast('Success', 'The session is restored instantly', 'success');
  }
};

async function handleFetch() {
  const url = urlInput.value.trim();

  if (!url) {
    showToast('Error', 'Please enter the URL first', 'error');
    return;
  }

  const videoId = window.extractVideoId(url);

  if (videoId) {
    try {
      const cachedStr = localStorage.getItem('fytx_session_' + videoId);
      if (cachedStr) {
        const session = JSON.parse(cachedStr);
        const ageHours = (Date.now() - session.timestamp) / (1000 * 60 * 60);
        
        if (ageHours < 4) {
          console.log('[Cache] Restoring session from cache instantly. Age:', ageHours.toFixed(2), 'hours');
          restoreSessionData(session, false);
          return;
        } else {
          console.log('[Cache] Session > 4 hours old. Restoring UI but fetching fresh URLs in background.');
          restoreSessionData(session, true);
          // Don't return, let it fetch below but we won't show loading UI!
          state.isLoading = true;
          // showLoading(true); // Disable full-screen loading because we already restored UI!
        }
      }
    } catch (e) {
      console.warn('Failed to read the cache:', e);
    }
  }

  try {
    if (!state.isLoading) {
      state.isLoading = true;
      showLoading(true);
      hideMetadata();
    }

    const browser = localStorage.getItem('fytx_browser') || 'none';

    const response = await fetch('/api/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, browser })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Gagal fetch metadata');
    }

    const result = await response.json();
    
    if (result.success) {
      // Jika background refetch, kita hanya update metadata agar URL nya fresh
      const isBackground = state.isLoading && !document.getElementById('loadingOverlay')?.classList.contains('hidden') === false;
      
      state.currentMetadata = result.data;
      if (!isBackground) {
        state.videoId = videoId;
        localStorage.setItem('fytx_last_url', url); // Simpan URL terakhir buat jaga-jaga kalau user kereload
        
        // Bersihkan state dari video lama
        window.customTrims = [];
        if (typeof updateCustomTrimUI === 'function') updateCustomTrimUI();
        if (window.state) {
          window.state.segments = [];
          if (window.state.selectedSegments) window.state.selectedSegments.clear();
        }

        displayMetadata(result.data);
        saveRecentUrl(url, result.data.title || url);
        if (typeof window.scanHeatmap === 'function') {
          window.scanHeatmap(url, result.data);
        }
        showToast('Save Progress', 'Media format and settings restored.', 'success');
      } else {
        // Update URL di player kalau lagi main
        console.log('[Cache] Background refetch complete. Stream URLs are fresh.');
      }
    } else {
      throw new Error(result.error);
    }

  } catch (error) {
    showToast('Error', error.message, 'error');
  } finally {
    state.isLoading = false;
    showLoading(false);
  }
}

/**
 * Handle format change — render quality grid buttons into qualityContainer
 */
function handleFormatChange(e) {
  const format = e.target.value;
  state.selectedFormat = format;
  state.selectedQuality = null;

  // Sync mobile buttons UI
  if (mobileFormatBtns) {
    mobileFormatBtns.forEach(btn => {
      if (btn.getAttribute('data-value') === format) {
        btn.classList.add('bg-[#02CEFF]/10', 'border-[#02CEFF]', 'text-[#02CEFF]');
        btn.classList.remove('bg-[#0A222F]', 'border-white/5', 'text-[#C4C3C5]');
      } else {
        btn.classList.remove('bg-[#02CEFF]/10', 'border-[#02CEFF]', 'text-[#02CEFF]');
        btn.classList.add('bg-[#0A222F]', 'border-white/5', 'text-[#C4C3C5]');
      }
    });
  }

  // Clear quality container
  qualityContainer.innerHTML = '';
  videoFilesize.textContent = '-';

  // Full reset of trimmer UI when format changes
  hideAllTrimmerUI();

  const qualityLabelText = document.getElementById('qualityLabelText');
  const qualityToggleIcon = document.getElementById('qualityToggleIcon');
  const qualityHeaderToggle = document.getElementById('qualityHeaderToggle');
  const qualityScrollContainer = document.getElementById('qualityScrollContainer');

  if (format === 'mp3') {
      if (qualityLabelText) qualityLabelText.textContent = 'Bitrate / Quality';
      if (qualityToggleIcon) qualityToggleIcon.style.display = 'none';
      if (qualityHeaderToggle) qualityHeaderToggle.style.pointerEvents = 'none';
      if (qualityScrollContainer) qualityScrollContainer.classList.remove('mobile-collapsed');
  } else {
      if (qualityLabelText) qualityLabelText.textContent = 'Resolution / Quality';
      if (qualityToggleIcon) qualityToggleIcon.style.display = '';
      if (qualityHeaderToggle) qualityHeaderToggle.style.pointerEvents = 'auto';
  }

  if (!format || !state.currentMetadata) {
    qualityContainer.innerHTML = `
      <div class="col-span-2 text-center py-4 text-outline-variant text-sm border border-dashed border-white/10 rounded-lg">
          Select the format first
      </div>
    `;
    updateDownloadButtonState();
    return;
  }

  const formats = state.currentMetadata.formats;
  let qualityOptions = [];

  if (format === 'mp4' && formats.video && formats.video.length > 0) {
    qualityOptions = formats.video.map(f => ({
      value: f.format_id,
      height: f.height,
      label: `${f.resolution} (${f.fps}fps)`,
      desc: f.filesize ? formatBytes(f.filesize) : 'Unknown size'
    }));
  } else if (format === 'mp3' && formats.audio && formats.audio.length > 0) {
    qualityOptions = formats.audio.map(f => ({
      value: f.format_id,
      label: f.bitrate,
      desc: f.filesize ? formatBytes(f.filesize) : 'Unknown size'
    }));
  }

  if (qualityOptions.length === 0) {
    qualityContainer.innerHTML = `
      <div class="col-span-2 text-center py-4 text-outline-variant text-sm border border-dashed border-error/30 rounded-lg text-error">
          Format tidak tersedia
      </div>
    `;
  } else {
    qualityOptions.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'quality-btn py-2 px-2 bg-[#0A222F] border border-primary/30 text-[#C4C3C5] rounded-lg font-button text-xs hover:border-primary/60 hover:text-white transition-all flex flex-col items-center justify-center';
      btn.innerHTML = `
        <span>${opt.label}</span>
        <span class="text-[9px] opacity-60 font-normal mt-0.5">${opt.desc}</span>
      `;
      btn.dataset.value = opt.value;

      btn.addEventListener('click', () => {
        // Deselect others
        document.querySelectorAll('.quality-btn').forEach(b => {
          b.classList.remove('bg-[#02CEFF]/10', 'border-[#02CEFF]', 'text-[#02CEFF]');
          b.classList.add('bg-[#0A222F]', 'border-primary/30', 'text-[#C4C3C5]');
        });
        // Select this
        btn.classList.remove('bg-[#0A222F]', 'border-primary/30', 'text-[#C4C3C5]');
        btn.classList.add('bg-[#02CEFF]/10', 'border-[#02CEFF]', 'text-[#02CEFF]');

        state.selectedQuality = opt.value;
        state.selectedQualityHeight = opt.height || null;
        videoFilesize.textContent = opt.desc;
        updateDownloadButtonState();

        // Auto-collapse on mobile after selection ONLY if we're in Trimmer mode
        if (window.innerWidth < 768 && format === 'mp4' && window.isTrimMode) {
          const scrollContainer = document.getElementById('qualityScrollContainer');
          if (scrollContainer) scrollContainer.classList.add('mobile-collapsed');
          const icon = document.getElementById('qualityToggleIcon');
          if (icon) icon.textContent = 'expand_more';
        }

        // Handle VIDEO TRIM for MP4
        if (format === 'mp4') {
          // On the Trimmer tab, trimming is always on — (re)mount the timeline
          // with the newly picked quality.
          if (window.isTrimMode) {
            showTrimmerUI();
          }
        } else {
          hideAllTrimmerUI();
        }
      });

      qualityContainer.appendChild(btn);
    });

    // Show preview immediately for MP4 — no quality needed
    if (format === 'mp4') {
      showPreviewOnly();
    }
  }

  updateDownloadButtonState();
}

/**
 * Handle download
 */
async function handleDownload() {
  if (!state.selectedFormat || !state.selectedQuality) {
    showToast('Error', 'The format and quality must be selected', 'error');
    return;
  }

  // --- MULTI-TRIM QUEUE MODE ---
  const checkedTrims = window.getCheckedTrims ? window.getCheckedTrims() : [];
  const isTrimmerActive = !!window.isTrimMode;
  const btnMultiTrim = document.getElementById('tl-btn-multi-trim');
  const isMultiTrimActive = btnMultiTrim && btnMultiTrim.classList.contains('active');
  
  if (isTrimmerActive && isMultiTrimActive && checkedTrims.length >= 2) {
    await handleMultiTrimQueue(checkedTrims);
    return;
  }

  // --- SINGLE DOWNLOAD / TRIM ---
  await handleSingleDownload();
}

/**
 * Multi-Trim Queue: download each checked trim sequentially with task queue UI
 */
async function handleMultiTrimQueue(trims) {
  const url = urlInput.value.trim();
  const format = state.selectedFormat;
  const quality = state.selectedQuality;
  const qualityHeight = state.selectedQualityHeight;

  const queueEl = document.getElementById('multiTrimQueue');
  const taskList = document.getElementById('multiTrimTaskList');
  const overallText = document.getElementById('multiTrimQueueOverall');
  const overallBar = document.getElementById('multiTrimOverallBar');
  const outputsContainer = document.getElementById('downloadOutputs');

  if (!queueEl || !taskList) return;

  // Show queue UI
  queueEl.classList.remove('hidden');
  taskList.innerHTML = '';

  // Build per-clip task rows
  const taskEls = trims.map((trim, i) => {
    const row = document.createElement('div');
    row.className = 'flex flex-col gap-0.5 p-2 rounded-lg bg-black/30 border border-white/5';
    row.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-white/80 truncate max-w-[60%]" title="${trim.name}">${i + 1}. ${trim.name}</span>
        <span class="task-badge text-[10px] px-1.5 py-0.5 rounded font-bold bg-white/10 text-white/50">Queued</span>
      </div>
      <div class="text-[10px] text-white/40">${formatTime(trim.start)} — ${formatTime(trim.end)}</div>
      <div class="w-full h-0.5 bg-white/10 rounded-full overflow-hidden mt-1">
        <div class="task-bar h-full bg-gradient-to-r from-primary to-secondary w-[0%] transition-all duration-200"></div>
      </div>
      <div class="task-status text-[10px] text-white/40 mt-0.5"></div>
    `;
    taskList.appendChild(row);
    return row;
  });

  state.isDownloading = true;
  updateDownloadButtonState();
  cancelBtn.classList.remove('hidden');
  showProgress(true);

  let cancelRequested = false;
  const originalCancelClick = cancelBtn.onclick;
  cancelBtn.onclick = async () => {
    cancelRequested = true;
    if (state.currentAbortController) {
      state.currentAbortController.abort();
    }
    try { await fetch('/api/cancel', { method: 'POST' }); } catch (e) {}
  };

  let doneCount = 0;

  const updateOverall = () => {
    const pct = trims.length > 0 ? Math.round((doneCount / trims.length) * 100) : 0;
    overallText.textContent = `${doneCount} / ${trims.length} done`;
    overallBar.style.width = `${pct}%`;
  };
  updateOverall();

  for (let i = 0; i < trims.length; i++) {
    if (cancelRequested) break;

    const trim = trims[i];
    const taskEl = taskEls[i];
    const badge = taskEl.querySelector('.task-badge');
    const bar = taskEl.querySelector('.task-bar');
    const statusEl = taskEl.querySelector('.task-status');

    badge.textContent = 'Running';
    badge.className = 'task-badge text-[10px] px-1.5 py-0.5 rounded font-bold bg-primary/30 text-primary';

    try {
      progressStatus.textContent = `Trim ${i + 1}/${trims.length}: ${trim.name}`;

      const ac = new AbortController();
      state.currentAbortController = ac;

      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify({
          url,
          format,
          quality,
          qualityHeight,
          start: trim.start,
          end: trim.end,
          title: state.currentMetadata?.title || '',
          uploader: state.currentMetadata?.uploader || state.currentMetadata?.author || '',
          browser: localStorage.getItem('fytx_browser') || 'none'
        })
      });

      if (!response.ok) throw new Error(`Server error: ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        let readResult;
        try { readResult = await reader.read(); } catch (e) { break; }
        const { done, value } = readResult;
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        for (let j = 0; j < lines.length - 1; j++) {
          const line = lines[j].trim();
          if (!line) continue;

          try {
            const data = JSON.parse(line);
            if (data.type === 'progress') {
              const p = data.data;
              const pct = p.progress || 0;
              bar.style.width = `${pct}%`;
              updateProgress(pct);
              if (p.status) {
                progressStatus.textContent = `[${i+1}/${trims.length}] ${p.status}`;
                statusEl.textContent = p.status;
              }
              if (p.speed) progressSpeed.textContent = `Speed: ${p.speed}`;
              else progressSpeed.textContent = '—';
              if (p.eta) progressEta.textContent = `Time remaining: ${p.eta}`;
              else progressEta.textContent = '';
            } else if (data.type === 'complete') {
              bar.style.width = '100%';
              badge.textContent = '✓ Done';
              badge.className = 'task-badge text-[10px] px-1.5 py-0.5 rounded font-bold bg-green-500/30 text-green-400';
              statusEl.textContent = 'Saved to /downloads';
              doneCount++;
              updateOverall();

              const fn = data.data?.filename;
              if (fn && outputsContainer) {
                const lfn = (fn || '').toLowerCase();
                let folderLabel = '/downloads';
                let type = 'downloads';
                if (lfn.startsWith('trim')) { folderLabel = '/trim'; type = 'trim'; }
                else if (lfn.startsWith('clip')) { folderLabel = '/clips'; type = 'clips'; }
                const finalUrl = data.data?.url || `/downloads/${encodeURIComponent(fn)}`;

                const div = document.createElement('div');
                div.className = 'flex items-center justify-between p-3 glass-inner rounded-lg cursor-pointer hover:bg-white/5 transition-all';
                div.innerHTML = `
                  <div class="flex items-center gap-3 min-w-0 flex-grow">
                    <span class="material-symbols-outlined text-green-400 flex-shrink-0">check_circle</span>
                    <div class="min-w-0 flex-grow">
                      <div class="font-medium text-sm text-white truncate">${fn}</div>
                      <div class="text-xs text-outline-variant">Berhasil disimpan di folder ${folderLabel}</div>
                    </div>
                  </div>
                  <button class="open-folder-btn p-2 rounded-lg hover:bg-white/10 text-outline-variant hover:text-white transition-colors" title="Buka Folder">
                    <span class="material-symbols-outlined text-xl">folder</span>
                  </button>`;
                div.addEventListener('click', (e) => {
                  if (e.target.closest('.open-folder-btn')) {
                    e.stopPropagation();
                    fetch('/api/open-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, filename: fn }) });
                    return;
                  }
                  if (window.playDirectMedia) window.playDirectMedia(finalUrl, fn);
                });
                outputsContainer.insertBefore(div, outputsContainer.firstChild);
              }
            } else if (data.type === 'error') {
              throw new Error(data.data.error || 'Trim failed');
            }
          } catch (parseErr) {
            if (parseErr.message && !parseErr.message.startsWith('JSON')) throw parseErr;
          }
        }
        buffer = lines[lines.length - 1];
      }
    } catch (err) {
      if (cancelRequested || err.name === 'AbortError') {
        badge.textContent = '⊘ Cancelled';
        badge.className = 'task-badge text-[10px] px-1.5 py-0.5 rounded font-bold bg-white/10 text-white/50';
        break;
      }
      badge.textContent = '✕ Error';
      badge.className = 'task-badge text-[10px] px-1.5 py-0.5 rounded font-bold bg-red-500/30 text-red-400';
      statusEl.textContent = err.message;
      showToast('Error', `Clip ${i+1} failed: ${err.message}`, 'error');
    }
  }

  cancelBtn.onclick = originalCancelClick;
  cancelBtn.classList.add('hidden');
  state.isDownloading = false;
  updateDownloadButtonState();
  updateProgress(100);

  if (doneCount === trims.length) {
    progressStatus.textContent = `All ${trims.length} clips trimmed successfully!`;
    showToast('Success', `${trims.length} clips saved to /downloads`, 'success');
    setTimeout(() => {
      showProgress(false);
      queueEl.classList.add('hidden');
      taskList.innerHTML = ''; // bersihkan task rows
    }, 4000);
  } else {
    // Partial done (cancel / error) → sembunyikan queue juga supaya tidak nyangkut
    const wasCancelled = doneCount < trims.length;
    if (wasCancelled && doneCount === 0) {
      progressStatus.textContent = 'Trim dibatalkan.';
    } else {
      progressStatus.textContent = `Done: ${doneCount}/${trims.length} clips`;
    }
    setTimeout(() => {
      showProgress(false);
      queueEl.classList.add('hidden');
      taskList.innerHTML = ''; // bersihkan task rows
    }, 3000);
  }
}

/**
 * Single download / trim
 */
async function handleSingleDownload() {
  let downloadComplete = false;

  try {
    state.isDownloading = true;
    showProgress(true);
    updateDownloadButtonState();

    const url = urlInput.value.trim();
    const format = state.selectedFormat;
    const quality = state.selectedQuality;
    const qualityHeight = state.selectedQualityHeight;

    let start = '';
    let end = '';
    if (window.isTrimMode && trimmerEngine) {
      const sel = trimmerEngine.getSelection();
      start = sel.start;
      end = sel.end;
    }

    updateStatusUI('downloading');

      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url,
            format,
            quality,
            qualityHeight,
            start,
            end,
            title: state.currentMetadata?.title || '',
            uploader: state.currentMetadata?.uploader || state.currentMetadata?.author || '',
            browser: localStorage.getItem('fytx_browser') || 'none'
          })
      });

    // If the server returned an error BEFORE starting the stream
    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const error = await response.json();
        throw new Error(error.error || 'Gagal download');
      } else {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Read stream until done — don't gate on state.isDownloading
    // (cancel sets state.isDownloading = false but stream may still have data)
    while (true) {
      let readResult;
      try {
        readResult = await reader.read();
      } catch (readErr) {
        // Stream was closed (e.g., cancel killed the connection)
        break;
      }

      const { done, value } = readResult;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');

      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        try {
          const data = JSON.parse(line);

          if (data.type === 'progress') {
            const p = data.data;
            updateProgress(p.progress || 0);
            if (p.status) progressStatus.textContent = p.status;
            
            if (p.speed) {
              progressSpeed.textContent = `Speed: ${p.speed}`;
            } else {
              progressSpeed.textContent = '—';
            }
            
            if (p.eta) {
              progressEta.textContent = `Time remaining: ${p.eta}`;
            } else {
              progressEta.textContent = '';
            }

          } else if (data.type === 'complete') {
            downloadComplete = true;
            updateProgress(100);
            progressStatus.textContent = data.data.status || 'Selesai';
            progressSpeed.textContent = '✓ Selesai';
            progressEta.textContent = '';
            updateStatusUI('done');
            showToast('Success', 'Download selesai! Cek folder /downloads', 'success');
            state.isDownloading = false;
            updateDownloadButtonState();
            setTimeout(() => showProgress(false), 3000);
            
            // Add playback card to downloadOutputs
            const finalFilename = data.data.filename;
            if (finalFilename) {
              const outputsContainer = document.getElementById('downloadOutputs');
              if (outputsContainer) {
                const lfn = (finalFilename || '').toLowerCase();
                let folderLabel = '/downloads';
                let type = 'downloads';
                if (lfn.startsWith('trim')) { folderLabel = '/trim'; type = 'trim'; }
                else if (lfn.startsWith('clip')) { folderLabel = '/clips'; type = 'clips'; }
                const finalUrl = data.data.url || `/downloads/${encodeURIComponent(finalFilename)}`;

                const div = document.createElement('div');
                div.className = 'flex items-center justify-between p-3 glass-inner rounded-lg cursor-pointer hover:bg-white/5 transition-all';
                div.innerHTML = `
                  <div class="flex items-center gap-3 min-w-0 flex-grow">
                    <span class="material-symbols-outlined text-green-400 flex-shrink-0">check_circle</span>
                    <div class="min-w-0 flex-grow">
                      <div class="font-medium text-sm text-white truncate">${finalFilename}</div>
                      <div class="text-xs text-outline-variant">Berhasil disimpan di folder ${folderLabel}</div>
                    </div>
                  </div>
                  <button class="open-folder-btn p-2 rounded-lg hover:bg-white/10 text-outline-variant hover:text-white transition-colors" title="Buka Folder">
                    <span class="material-symbols-outlined text-xl">folder</span>
                  </button>`;
                div.addEventListener('click', (e) => {
                  if (e.target.closest('.open-folder-btn')) {
                    e.stopPropagation();
                    fetch('/api/open-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, filename: finalFilename }) });
                    return;
                  }
                  if (window.playDirectMedia) {
                    window.playDirectMedia(finalUrl, finalFilename);
                  }
                });
                
                // prepend so latest is on top
                outputsContainer.insertBefore(div, outputsContainer.firstChild);

                // AUTO-SAVE LOGIC
                if (autoSaveToggle && autoSaveToggle.checked) {
                  const a = document.createElement('a');
                  a.href = finalUrl;
                  a.download = finalFilename;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  showToast('Auto-Save', 'File sedang diunduh secara otomatis ke HP/Perangkat Anda...', 'info');
                }
              }
            }

          } else if (data.type === 'error') {
            throw new Error(data.data.error || 'Download gagal');
          }
        } catch (parseErr) {
          // If the caught error was rethrown from inside (not a JSON parse error), propagate it
          if (parseErr.message && !parseErr.message.startsWith('JSON')) {
            throw parseErr;
          }
          // Otherwise skip non-JSON lines silently
        }
      }

      buffer = lines[lines.length - 1];
    }

  } catch (error) {
    if (error.name === 'AbortError' || error.message.includes('dibatalkan') || error.message.includes('network')) {
      showToast('Info', 'Download dibatalkan', 'info');
    } else {
      showToast('Error', error.message, 'error');
    }
  } finally {
    state.isDownloading = false;
    updateDownloadButtonState();
    if (!downloadComplete) {
      showProgress(false);
      if (metadataStatusText && metadataStatusText.textContent !== 'Done') {
        updateStatusUI('ready');
      }
    }
  }
}

/**
 * Handle Cancel
 */
async function handleCancel() {
  if (!state.isDownloading) return;
  
  cancelBtn.disabled = true;
  cancelBtn.innerHTML = '<span class="material-symbols-outlined spin">autorenew</span> Canceling...';

  try {
    const response = await fetch('/api/cancel', {
      method: 'POST'
    });
    
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.message);
    }
    
    // The fetch stream will close and throw an error natively, 
    // handled by catch block in handleDownload.
    state.isDownloading = false;
    
  } catch (error) {
    showToast('Error', 'Gagal membatalkan: ' + error.message, 'error');
  } finally {
    cancelBtn.disabled = false;
    cancelBtn.innerHTML = '<span class="material-symbols-outlined">cancel</span> Cancel Download';
    updateDownloadButtonState();
    showProgress(false);
  }
}

// ========================================
// UI Update Functions
// ========================================

function displayMetadata(metadata) {
    if (metadata.thumbnail) {
      thumbnail.src = metadata.thumbnail;
      thumbnail.style.display = 'block';
      if (thumbnailBlur) {
        thumbnailBlur.src = metadata.thumbnail;
        thumbnailBlur.style.display = 'block';
      }
      thumbnailFallback.style.display = 'none';
    } else {
      thumbnail.style.display = 'none';
      if (thumbnailBlur) thumbnailBlur.style.display = 'none';
      thumbnailFallback.style.display = 'block';
    }

  videoTitle.textContent = metadata.title;
  videoTitle.title = metadata.title;
  videoUploader.textContent = `By ${metadata.uploader}`;
  videoDuration.textContent = formatDuration(metadata.duration);

  // Auto-detect platform
  const platformTag = document.getElementById('mediaPlatformTag');
  let isYouTube = false;
  if (platformTag && typeof urlInput !== 'undefined' && urlInput) {
    const url = (urlInput.value || '').toLowerCase();
    isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
    if (isYouTube) {
      platformTag.textContent = 'YouTube';
    } else if (url.includes('instagram.com')) {
      platformTag.textContent = 'Instagram';
    } else if (url.includes('tiktok.com')) {
      platformTag.textContent = 'TikTok';
    } else if (url.includes('facebook.com') || url.includes('fb.watch')) {
      platformTag.textContent = 'Facebook';
    } else if (url.includes('twitter.com') || url.includes('x.com')) {
      platformTag.textContent = 'Twitter / X';
    } else {
      platformTag.textContent = 'Media';
    }
  }

  // Restrict Multi Trim to YouTube only
  const btnMultiTrim = document.getElementById('tl-btn-multi-trim');
  if (btnMultiTrim) {
    if (isYouTube) {
      btnMultiTrim.disabled = false;
      btnMultiTrim.classList.remove('hidden');
      btnMultiTrim.title = '';
    } else {
      btnMultiTrim.disabled = true;
      btnMultiTrim.classList.add('hidden');
      
      // If it was already active/open, forcefully close it
      const row = document.getElementById('multiTrimContainer');
      if (row && !row.classList.contains('hidden')) {
        row.classList.add('hidden');
        btnMultiTrim.classList.remove('active');
        btnMultiTrim.style.maxWidth = '32px';
      }
      
      // Clear any saved trims to prevent export to clips
      window.customTrims = [];
      const listContainer = document.getElementById('customTrimListContainer');
      if (listContainer) listContainer.classList.add('hidden');
      const countEl = document.getElementById('customTrimCount');
      if (countEl) countEl.textContent = '0';
      const checkboxList = document.getElementById('customTrimCheckboxList');
      if (checkboxList) checkboxList.innerHTML = '';
    }
  }

  // Reset selections and UI
  hideAllTrimmerUI();
  state.selectedFormat = null;
  state.selectedQuality = null;
  videoFilesize.textContent = '-';
  formatSelect.value = '';
  if (formatSelectLabel) formatSelectLabel.textContent = '-- Select a format --';
  
  // Clear mobile format buttons selection
  if (mobileFormatBtns) {
    mobileFormatBtns.forEach(btn => {
      btn.classList.remove('bg-[#02CEFF]/10', 'border-[#02CEFF]', 'text-[#02CEFF]');
      btn.classList.add('bg-[#0A222F]', 'border-white/5', 'text-[#C4C3C5]');
    });
  }

  // Ensure quality container is uncollapsed and icon is correct
  const qualityScrollContainer = document.getElementById('qualityScrollContainer');
  const qualityToggleIcon = document.getElementById('qualityToggleIcon');
  if (qualityScrollContainer) qualityScrollContainer.classList.remove('mobile-collapsed');
  if (qualityToggleIcon) qualityToggleIcon.textContent = 'expand_less';

  qualityContainer.innerHTML = `
    <div class="col-span-2 text-center py-4 text-outline-variant text-sm border border-dashed border-white/10 rounded-lg">
        Select the format first
    </div>
  `;

  showMetadata(true);
  document.getElementById('tabNavigation').classList.remove('hidden');
  
  // Reset to downloader tab by default when a new video is loaded
  if (window.activateMainTab) {
    window.activateMainTab('downloader');
  }

  updateStatusUI('ready');
  updateDownloadButtonState();

  // PRELOAD SPRITE — Async with polling
  // Backend now returns immediately with { status: 'pending' } or { status: 'done' }.
  // We keep polling every 4s until done so there's no timeout for long videos.
  const previewSourceUrl = metadata.previewUrl || (metadata.formats && metadata.formats.video && metadata.formats.video[0] ? metadata.formats.video[0].url : null);
  if (previewSourceUrl) {
    const uaParam = metadata.userAgent ? `&ua=${encodeURIComponent(metadata.userAgent)}` : '';
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(previewSourceUrl)}${uaParam}`;
    // Gunakan state.videoId jika tersedia karena lebih akurat dibanding metadata.id yang kadang kosong di live stream
    const safeVideoId = window.state?.videoId || window.extractVideoId(urlInput.value) || metadata.id || '';
    const preloadSpriteUrl = `/api/thumbnails/sprite?url=${encodeURIComponent(proxyUrl)}&duration=${metadata.duration}&count=60&videoId=${safeVideoId}${uaParam}`;

    const trimmerStatusText = document.getElementById('trimmerToggleStatusText');
    const defaultDesc = 'Biarkan OFF jika ingin download video utuh.';
    
    if (enableTrimmerToggle) {
      enableTrimmerToggle.checked = false;
      enableTrimmerToggle.disabled = false; // Trim tetap bisa dipakai walau sprite belum/gagal load — sprite cuma buat thumbnail filmstrip, bukan syarat proses trim
    }
    if (trimmerStatusText) {
      trimmerStatusText.innerHTML = `${defaultDesc}<br><span class="text-secondary animate-pulse font-medium mt-1 inline-block">Sedang menyiapkan thumbnail...</span>`;
    }

    // Polling config
    const POLL_INTERVAL_MS = 4000;  // poll every 4 seconds
    const MAX_POLL_TIME_MS = 10 * 60 * 1000; // give up after 10 minutes
    const pollStart = Date.now();
    let pollTimer = null;
    // Token: if user fetches a new URL, stop polling for the old one
    const pollToken = previewSourceUrl;

    const pollSprite = async () => {
      // Stop if user has moved on (new URL was fetched)
      if (state.currentMetadata && state.currentMetadata.previewUrl !== pollToken) return;

      if (Date.now() - pollStart > MAX_POLL_TIME_MS) {
        if (trimmerStatusText) trimmerStatusText.innerHTML = `${defaultDesc}<br><span class="text-secondary font-medium mt-1 inline-block">Thumbnail preview gagal dimuat (Timeout). Trim tetap bisa dipakai tanpa preview gambar.</span>`;
        return;
      }

      try {
        const res = await fetch(preloadSpriteUrl);
        const data = await res.json();

        if (data.status === 'done') {
          // Sprite is ready!
          if (trimmerStatusText) trimmerStatusText.textContent = defaultDesc;
        } else if (data.status === 'error') {
          // FFmpeg failed all retries — thumbnail gagal, tapi trim tetap dipakai (TimelineEngine fallback ke skeleton)
          if (trimmerStatusText) trimmerStatusText.innerHTML = `${defaultDesc}<br><span class="text-secondary font-medium mt-1 inline-block">Thumbnail preview gagal dimuat. Trim tetap bisa dipakai tanpa preview gambar.</span>`;
        } else {
          // Still pending — update progress text and poll again
          const elapsedSec = Math.round((Date.now() - pollStart) / 1000);
          if (trimmerStatusText) {
            trimmerStatusText.innerHTML = `${defaultDesc}<br><span class="text-secondary animate-pulse font-medium mt-1 inline-block">Sedang menyiapkan thumbnail (${elapsedSec}s)... Trimmer siap digunakan!</span>`;
          }
          pollTimer = setTimeout(pollSprite, POLL_INTERVAL_MS);
        }
      } catch (e) {
        // Network error, retry
        const elapsedSec = Math.round((Date.now() - pollStart) / 1000);
        if (trimmerStatusText) {
          trimmerStatusText.innerHTML = `${defaultDesc}<br><span class="text-secondary animate-pulse font-medium mt-1 inline-block">Menghubungkan ke server... (${elapsedSec}s)</span>`;
        }
        pollTimer = setTimeout(pollSprite, POLL_INTERVAL_MS);
      }
    };

    // Start immediately (backend queues job + responds in <50ms)
    pollSprite();
  }
}

function updateStatusUI(statusType) {
  if (!metadataStatusText || !metadataStatusDot) return;
  
  if (statusType === 'ready') {
    metadataStatusText.textContent = 'Ready';
    metadataStatusText.className = '';
    metadataStatusDot.className = 'w-2 h-2 rounded-full bg-secondary animate-pulse';
  } else if (statusType === 'downloading') {
    metadataStatusText.textContent = 'Downloading';
    metadataStatusText.className = 'text-primary font-bold tracking-wide';
    metadataStatusDot.className = 'w-2 h-2 rounded-full bg-primary animate-bounce';
  } else if (statusType === 'done') {
    metadataStatusText.textContent = 'Done';
    metadataStatusText.className = 'text-green-400 font-bold tracking-wide';
    metadataStatusDot.className = 'w-2 h-2 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]';
  }
}

function formatDuration(seconds) {
  if (!seconds) return '-';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function updateProgress(percent) {
  progressPercent.textContent = `${Math.round(percent)}%`;
  
  const isTrimming = !!window.isTrimMode;
  if (percent === 0 && isTrimming) {
    progressFill.style.width = '100%';
    progressFill.classList.add('progress-indeterminate');
  } else {
    progressFill.style.width = `${percent}%`;
    progressFill.classList.remove('progress-indeterminate');
  }
}

function updateDownloadButtonState() {
  if (state.isDownloading) {
    downloadBtn.classList.add('hidden');
    cancelBtn.classList.remove('hidden');
  } else {
    cancelBtn.classList.add('hidden');
    downloadBtn.classList.remove('hidden');
    
    const isEnabled = state.selectedFormat && state.selectedQuality && !state.isLoading;
    downloadBtn.disabled = !isEnabled;
  }
}

function showLoading(show) {
  fetchBtn.disabled = show;
  const loaderContainer = document.getElementById('loaderContainer');
  const shortcuts = document.getElementById('shortcutButtonsContainer');
  const tabNav = document.getElementById('tabNavigation');
  if(loaderContainer) {
    if(show) {
      loaderContainer.classList.remove('hidden');
      if (shortcuts) shortcuts.classList.add('hidden');
      // hide tab nav while fetching
      if (tabNav) tabNav.classList.add('hidden');
    } else {
      loaderContainer.classList.add('hidden');
      if (shortcuts) {
        shortcuts.classList.remove('hidden');
        shortcuts.style.display = '';
      }
    }
  }
}

let metadataTimeout;

function showMetadata(show) {
  const shortcuts = document.getElementById('shortcutButtonsContainer');
  
  if (metadataTimeout) {
    clearTimeout(metadataTimeout);
    metadataTimeout = null;
  }

  if (show) {
    metadataSection.classList.remove('hidden');
    // We intentionally DO NOT hide shortcuts here anymore, so they remain visible under the search bar.
    
    // small delay to allow display:block to apply before animating opacity
    metadataTimeout = setTimeout(() => {
      metadataSection.classList.remove('opacity-0', 'translate-y-4');
      metadataSection.classList.add('opacity-100', 'translate-y-0');
    }, 50);
  } else {
    const tabNav = document.getElementById('tabNavigation');
    if (shortcuts && !fetchBtn.disabled) {
      shortcuts.classList.remove('hidden');
      shortcuts.style.display = '';
    }
    // Hide tab navigation when metadata panel closes
    if (tabNav) tabNav.classList.add('hidden');
    metadataSection.classList.remove('opacity-100', 'translate-y-0');
    metadataSection.classList.add('opacity-0', 'translate-y-4');
    metadataTimeout = setTimeout(() => {
        metadataSection.classList.add('hidden');
    }, 500);
  }
}

function hideMetadata() {
  showMetadata(false);
}

function showProgress(show) {
  if (show) {
    downloadProgress.classList.remove('hidden');
    updateProgress(0);
    progressStatus.textContent = 'Starting download...';
    progressSpeed.textContent = 'Connecting to server...';
    progressEta.textContent = 'Please wait...';
  } else {
    downloadProgress.classList.add('hidden');
  }
}

/**
 * Show Toast Notification
 * @param {string} title 
 * @param {string} message 
 * @param {string} type 'success' | 'error'
 */
function showToast(title, message, type = 'success') {
  const clone = toastTemplate.content.cloneNode(true);
  const toastItem = clone.querySelector('.toast-item');
  const toastIcon = clone.querySelector('.toast-icon');
  const toastTitle = clone.querySelector('.toast-title');
  const toastMessage = clone.querySelector('.toast-message');
  const closeBtn = clone.querySelector('.toast-close');

  toastTitle.textContent = title;
  toastMessage.textContent = message;

  if (type === 'success') {
    toastItem.classList.add('border-success', 'text-on-surface');
    toastIcon.classList.add('text-success');
    toastIcon.textContent = 'check_circle';
    // Add success color to custom config if not exist, defaulting to green-500
    toastItem.style.borderColor = '#10b981'; 
    toastIcon.style.color = '#10b981';
  } else {
    toastItem.classList.add('border-error', 'text-on-surface');
    toastIcon.classList.add('text-error');
    toastIcon.textContent = 'error';
  }

  toastContainer.appendChild(toastItem);

  // Auto remove
  const timeout = setTimeout(() => removeToast(toastItem), 5000);

  closeBtn.addEventListener('click', () => {
    clearTimeout(timeout);
    removeToast(toastItem);
  });
}

function removeToast(element) {
  element.classList.remove('toast-enter');
  element.classList.add('toast-exit');
  setTimeout(() => {
    if (element.parentNode) {
      element.parentNode.removeChild(element);
    }
  }, 300); // match exit animation duration
}

// ========================================
// Initialization
// ========================================

console.log('FythhX UI loaded successfully');

window.addEventListener('load', async () => {
  // Load saved browser preference
  if (browserSelect && browserSelectLabel) {
    const savedBrowser = localStorage.getItem('fytx_browser');
    if (savedBrowser) {
      browserSelect.value = savedBrowser;
      // Find the corresponding option text
      if (browserOptions) {
        for (const opt of browserOptions) {
          if (opt.getAttribute('data-value') === savedBrowser) {
            browserSelectLabel.textContent = opt.textContent;
            break;
          }
        }
      }
    }
  }

  try {
    const response = await fetch('/api/health');
    if (response.ok) {
      console.log('✓ Connected to server');
    }
  } catch (err) {
    showToast('Connection Error', 'Cannot connect to local server. Make sure it is running.', 'error');
  }
});

// ========================================
// Smart Clipboard Auto-Paste
// ========================================
window.addEventListener('focus', async () => {
  if (urlInput && navigator.clipboard && navigator.clipboard.readText) {
    try {
      // Hanya berjalan jika browser diizinkan membaca clipboard
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      
      // Regex untuk mendeteksi link YouTube, TikTok, dan Instagram
      const supportedRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|tiktok\.com|instagram\.com)\/.+/i;
      
      // Jika clipboard berisi URL yang didukung DAN kolom input URL sedang kosong
      if (supportedRegex.test(trimmed) && urlInput.value === '') {
        urlInput.value = trimmed;
        // Trigger event input supaya tombol clear (X) muncul & UI ter-update
        urlInput.dispatchEvent(new Event('input'));
        
        // Kasih tahu user kalau sistem otomatis mem-paste link-nya
        if (typeof showToast === 'function') {
          showToast('Smart Paste', 'URL detected from clipboard and pasted automatically!', 'success');
        }
      }
    } catch (err) {
      // Abaikan error (misal: user belum kasih izin atau clipboard kosong)
    }
  }
});

// Sync video canvas height to follow the resolution quality height
const syncQualityHeight = () => {
    const videoWrapper = document.getElementById('trimmerVideoWrapper');
    const qualityCol = document.getElementById('qualityColumn');
    const videoPreview = document.getElementById('trimmerVideoPreview');
    if (!videoWrapper || !qualityCol) return;
    
    if (!videoWrapper.classList.contains('hidden') && window.innerWidth >= 1024) {
        // Remove restrictions to get natural height of quality options
        qualityCol.style.maxHeight = 'none';
        
        // Temporarily hide video wrapper so its intrinsic size doesn't squish the right column
        const oldDisplay = videoWrapper.style.display;
        videoWrapper.style.display = 'none';
        
        const rightHeight = qualityCol.offsetHeight;
        
        // Restore display
        videoWrapper.style.display = oldDisplay;
        
        if (rightHeight > 0) {
            // Force the video canvas to match the height of the quality options
            videoWrapper.style.height = rightHeight + 'px';
            videoWrapper.style.maxHeight = rightHeight + 'px';
            if (videoPreview) {
                videoPreview.style.height = '100%';
            }
        }
    } else {
        videoWrapper.style.height = '';
        videoWrapper.style.maxHeight = '';
        qualityCol.style.maxHeight = '';
        if (videoPreview) {
            videoPreview.style.height = '';
        }
    }
};

const observer = new ResizeObserver(() => syncQualityHeight());
window.addEventListener('resize', syncQualityHeight);

setTimeout(() => {
    const videoWrapper = document.getElementById('trimmerVideoWrapper');
    if (videoWrapper) observer.observe(videoWrapper);
    const videoPreview = document.getElementById('trimmerVideoPreview');
    if (videoPreview) observer.observe(videoPreview);
    const qualityCol = document.getElementById('qualityColumn');
    if (qualityCol) observer.observe(qualityCol);
}, 1000);
