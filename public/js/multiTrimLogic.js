// --- MULTI-TRIM LOGIC ---
window.customTrims = [];

// Helper: format seconds to HH:MM:SS
function formatTime(sec) {
  if (typeof sec !== 'number' || isNaN(sec)) return '00:00:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

const customTrimNameInput = document.getElementById('customTrimNameInput');
const addCustomTrimBtn = document.getElementById('addCustomTrimBtn');
const customTrimListContainer = document.getElementById('customTrimListContainer');
const customTrimCount = document.getElementById('customTrimCount');
const sendToClipperBtn = document.getElementById('sendToClipperBtn');

// multiTrimContainer is always visible once trimmerSection is shown
const multiTrimContainer = document.getElementById('multiTrimContainer');

// ============================================================
// Save Trim Button
// ============================================================
if (addCustomTrimBtn) {
  addCustomTrimBtn.addEventListener('click', () => {
    if (!trimmerEngine) {
      alert('Timeline not active. Load video first.');
      return;
    }
    const region = trimmerEngine.getSelection();
    if (!region || region.start === region.end) {
      alert('No valid region in timeline. Enable Video Trim first.');
      return;
    }
    const getNextClipNumber = () => {
      let max = 0;
      window.customTrims.forEach(t => {
        if (t.name) {
          const match = t.name.match(/^Clip\s+(\d+)$/i);
          if (match) {
            const num = parseInt(match[1]);
            if (num > max) max = num;
          }
        }
      });
      return max + 1;
    };
    const name = customTrimNameInput.value.trim() || `Clip ${getNextClipNumber()}`;

    const isOverlap = window.customTrims.some(t => 
      region.start < t.end - 0.1 && region.end > t.start + 0.1
    );

    if (isOverlap) {
      if (typeof window.showToast === 'function') {
        window.showToast('Overlap Detected', 'Cannot save a clip that overlaps with an already marked clip.', 'error');
      }
      return;
    }

    const trimData = {
      id: Date.now().toString(),
      name,
      start: region.start,
      end: region.end,
      checked: true // default checked
    };

    window.customTrims.push(trimData);
    window.activeTrimId = trimData.id; // Lock onto the clip we just saved
    customTrimNameInput.value = '';

    updateCustomTrimUI();
  });
}

// ============================================================
// Render checkbox list
// ============================================================
function updateCustomTrimUI(skipZoom = false) {
  const list = document.getElementById('customTrimCheckboxList');
  if (!list) return;

  if (window.customTrims.length > 0) {
    customTrimListContainer.classList.remove('hidden');
    const bulkActions = document.getElementById('multiTrimBulkActions');
    if (bulkActions) bulkActions.classList.remove('hidden');
    if (sendToClipperBtn) sendToClipperBtn.classList.remove('hidden');
    list.innerHTML = '';

    window.customTrims.forEach(trim => {
      const item = document.createElement('div');
      item.className = 'multi-trim-item flex items-center gap-3 p-4 rounded-lg bg-black/30 hover:bg-black/50 border border-white/5 hover:border-primary/30 transition-all group cursor-pointer';
      item.dataset.id = trim.id;

      // Checkbox
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = trim.checked;
      cb.className = 'w-4 h-4 rounded border-white/30 bg-black/50 text-primary focus:ring-primary cursor-pointer flex-shrink-0 accent-[var(--color-primary)] pointer-events-none';
      
      const toggleTrimState = () => {
        trim.checked = !trim.checked;
        cb.checked = trim.checked;
        item.classList.toggle('border-primary/50', trim.checked);
        item.classList.toggle('bg-primary/5', trim.checked);
        
        // Handle locking/unlocking the timeline
        if (trim.checked && trimmerEngine) {
          window.activeTrimId = null; // disable sync briefly to prevent corrupting the previously locked clip
          trimmerEngine.selection.setRange(trim.start, trim.end);
          trimmerEngine.selection.setPlayhead(trim.start);
          window.activeTrimId = trim.id; // Lock onto the clip they just checked
          if (trimmerEngine.playback) trimmerEngine.playback.seek(trim.start, true);
        } else if (!trim.checked && trimmerEngine && window.activeTrimId === trim.id) {
          // If they unchecked the currently locked clip, unlock it
          window.activeTrimId = null;
        }
        
        // updateTrimCount handles re-rendering timeline UI (renderMultiTrims and updateAll)
        updateTrimCount();
      };

      // Item click toggles checkbox and seeks
      item.addEventListener('click', toggleTrimState);

      // Apply initial state
      if (trim.checked) {
        item.classList.add('border-primary/50', 'bg-primary/5');
      }

      // Label
      const lbl = document.createElement('div');
      lbl.className = 'flex-grow min-w-0';
      lbl.innerHTML = `<div class="text-xs font-bold text-white truncate">${trim.name}</div>`;
      
      // Time
      const text = document.createElement('div');
      text.id = `trim-text-${trim.id}`; // Add ID for live updates
      text.className = 'text-xs text-white/60 font-mono mt-1';
      text.innerHTML = `${formatTime(trim.start)} &mdash; ${formatTime(trim.end)} <span class="text-xs text-white/40 ml-1">(${(trim.end - trim.start).toFixed(1)}s)</span>`;
      lbl.appendChild(text);

      // Delete button
      const del = document.createElement('button');
      del.type = 'button';
      del.title = 'Remove clip';
      del.className = 'flex items-center justify-center text-white/60 hover:text-[#B64949] transition-colors p-1';
      del.innerHTML = '<span class="material-symbols-outlined text-[20px]">delete</span>';
      del.addEventListener('click', (e) => {
        e.stopPropagation(); // Don't trigger the item click
        window.customTrims = window.customTrims.filter(t => t.id !== trim.id);
        updateCustomTrimUI();
        if (typeof window.renderClipperSegments === 'function') {
          window.renderClipperSegments();
        }
      });

      // Actions Container
      const actions = document.createElement('div');
      actions.className = 'flex items-center gap-3 flex-shrink-0';
      
      actions.appendChild(del);
      
      const divider = document.createElement('div');
      divider.className = 'w-px h-5 bg-white/20';
      actions.appendChild(divider);
      
      actions.appendChild(cb);

      item.appendChild(lbl);
      item.appendChild(actions);
      list.appendChild(item);
    });

    updateTrimCount(skipZoom);
  } else {
    customTrimListContainer.classList.add('hidden');
    const bulkActions = document.getElementById('multiTrimBulkActions');
    if (bulkActions) bulkActions.classList.add('hidden');
    if (sendToClipperBtn) sendToClipperBtn.classList.add('hidden');
    updateTrimCount(skipZoom);
  }
}

function updateTrimCount(skipZoom = false) {
  const btnMultiTrim = document.getElementById('tl-btn-multi-trim');
  const isMultiTrimActive = btnMultiTrim && btnMultiTrim.classList.contains('active');
  const checked = window.customTrims.filter(t => t.checked).length;
  if (customTrimCount) customTrimCount.textContent = checked;
  
  // Update trim button label
  const dlBtnText = document.getElementById('downloadBtnText');
  if (dlBtnText) {
    if (isMultiTrimActive && checked > 1) {
      dlBtnText.textContent = `Trim ${checked} Clips`;
    } else {
      dlBtnText.textContent = 'Trim Video';
    }
  }
  
  if (typeof trimmerEngine !== 'undefined' && trimmerEngine && trimmerEngine.ui) {
    trimmerEngine.ui.renderMultiTrims();
    trimmerEngine.ui.updateAll();
    
    // Auto-reset when everything is cleared/unselected
    if (checked === 0) {
      window.activeTrimId = null;
      const currentPlayhead = trimmerEngine.selection.playhead;
      trimmerEngine.selection.setStart(0);
      trimmerEngine.selection.setEnd(trimmerEngine.selection.duration);
      trimmerEngine.selection.setPlayhead(currentPlayhead);
      if (!skipZoom) {
        trimmerEngine.ui.setZoom(1);
      }
    } else {
      // Adjust zoom to fit all selected trims
      if (!skipZoom) trimmerEngine.ui.zoomToFitTrims();
    }
  }
}

// Expose getCheckedTrims so app.js can read them
window.getCheckedTrims = () => {
  const btnMultiTrim = document.getElementById('tl-btn-multi-trim');
  if (btnMultiTrim && !btnMultiTrim.classList.contains('active')) {
    return [];
  }
  return window.customTrims.filter(t => t.checked);
};

// ============================================================
// Send to Clipper
// ============================================================
if (sendToClipperBtn) {
  sendToClipperBtn.addEventListener('click', () => {
    const checked = window.customTrims.filter(t => t.checked);
    if (checked.length === 0) {
      if (typeof showToast === 'function') {
        showToast('Info', 'No clips selected (checked). Please check at least one clip.', 'warning');
      } else {
        alert('No clips selected (checked). Please check at least one clip.');
      }
      return;
    }

    const allAlreadyExported = checked.every(t => t.exportedToClipper);
    if (allAlreadyExported) {
      if (typeof window.showToast === 'function') {
        window.showToast('Info', 'Trim already exported to clips.', 'info');
      }
      return;
    }

    // Mark as exported
    checked.forEach(t => t.exportedToClipper = true);

    if (window.renderClipperSegments) {
      window.renderClipperSegments();
    }

    if (window.activateMainTab) {
      window.activateMainTab('clipper');
    }
  });
}

// ============================================================
// Select All / Clear
// ============================================================
const multiTrimSelAllBtn = document.getElementById('multiTrimSelAllBtn');
const multiTrimClearBtn = document.getElementById('multiTrimClearBtn');

if (multiTrimSelAllBtn) {
  multiTrimSelAllBtn.addEventListener('click', () => {
    window.customTrims.forEach(t => t.checked = true);
    updateCustomTrimUI();
  });
}

if (multiTrimClearBtn) {
  multiTrimClearBtn.addEventListener('click', () => {
    window.customTrims.forEach(t => t.checked = false);
    updateCustomTrimUI();
  });
}
