/**
 * apiKeyValidator.js
 * Real-time API Key validation UI for Subtitle Engine (Groq / Cloudflare)
 * Works with the existing glass UI style of FYTX
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'fytx_transcription_keys';

  // ============================================
  // Storage helpers
  // ============================================
  function loadKeys() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function saveKeys(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function getProviderKey(provider) {
    const all = loadKeys();
    return all[provider] || {};
  }

  function setProviderKey(provider, payload) {
    const all = loadKeys();
    all[provider] = { ...all[provider], ...payload, updatedAt: Date.now() };
    saveKeys(all);
  }

  // ============================================
  // Validate via backend
  // ============================================
  async function validateKey(provider, credentials) {
    const res = await fetch('/api/clipper/validate-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, ...credentials })
    });
    return res.json();
  }

  // ============================================
  // UI Status helpers
  // ============================================
  function setStatus(el, state, message) {
    if (!el) return;
    el.classList.remove('text-green-400', 'text-red-400', 'text-yellow-400', 'text-outline-variant');
    el.classList.add(
      state === 'ok' ? 'text-green-400' :
      state === 'error' ? 'text-red-400' :
      state === 'loading' ? 'text-yellow-400' : 'text-outline-variant'
    );
    el.textContent = message || '';
  }

  function setInputBorder(input, state) {
    if (!input) return;
    input.classList.remove('border-green-500/60', 'border-red-500/60', 'border-yellow-500/40');
    if (state === 'ok') input.classList.add('border-green-500/60');
    else if (state === 'error') input.classList.add('border-red-500/60');
    else if (state === 'loading') input.classList.add('border-yellow-500/40');
  }

  // ============================================
  // Debounce
  // ============================================
  function debounce(fn, wait = 600) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  // ============================================
  // Events
  // ============================================
  function wireEvents() {
    const engineSelect = document.getElementById('clipperSubtitleEngine');
    if (!engineSelect) return;

    engineSelect.addEventListener('change', () => {
      const engine = engineSelect.value;
      document.querySelectorAll('.engine-local-panel').forEach(el => el.classList.toggle('hidden', engine !== 'local'));
      document.querySelectorAll('.engine-groq-panel').forEach(el => el.classList.toggle('hidden', engine !== 'groq'));
      document.querySelectorAll('.engine-cf-panel').forEach(el => el.classList.toggle('hidden', engine !== 'cloudflare'));
    });

    // --- Groq realtime validation ---
    const groqInput = document.getElementById('groqApiKey');
    const btnTestGroq = document.getElementById('btnTestGroq');
    const groqStatus = document.getElementById('groqKeyStatus');

    const doValidateGroq = async (showLoading = true) => {
      const key = groqInput?.value?.trim();
      if (!key) {
        setStatus(groqStatus, 'idle', '');
        setInputBorder(groqInput, 'idle');
        return;
      }
      if (showLoading) {
        setStatus(groqStatus, 'loading', 'Validating...');
        setInputBorder(groqInput, 'loading');
        if (btnTestGroq) btnTestGroq.disabled = true;
      }

      try {
        const result = await validateKey('groq', { apiKey: key });
        if (result.valid) {
          setStatus(groqStatus, 'ok', result.message || 'Valid ✓');
          setInputBorder(groqInput, 'ok');
          setProviderKey('groq', { apiKey: key, valid: true });
        } else {
          setStatus(groqStatus, 'error', result.error || 'Invalid');
          setInputBorder(groqInput, 'error');
          setProviderKey('groq', { apiKey: key, valid: false });
        }
      } catch (e) {
        setStatus(groqStatus, 'error', e.message || 'Network error');
        setInputBorder(groqInput, 'error');
      } finally {
        if (btnTestGroq) btnTestGroq.disabled = false;
      }
    };

    if (groqInput) {
      groqInput.addEventListener('input', debounce(() => doValidateGroq(true), 700));
      groqInput.addEventListener('blur', () => doValidateGroq(true));
    }
    if (btnTestGroq) {
      btnTestGroq.addEventListener('click', () => doValidateGroq(true));
    }

    // --- Cloudflare realtime validation ---
    const cfAccount = document.getElementById('cfAccountId');
    const cfToken = document.getElementById('cfApiToken');
    const btnTestCf = document.getElementById('btnTestCf');
    const cfStatus = document.getElementById('cfKeyStatus');

    const doValidateCf = async (showLoading = true) => {
      const accountId = cfAccount?.value?.trim();
      const apiToken = cfToken?.value?.trim();
      if (!accountId || !apiToken) {
        setStatus(cfStatus, 'idle', '');
        setInputBorder(cfAccount, 'idle');
        setInputBorder(cfToken, 'idle');
        return;
      }
      if (showLoading) {
        setStatus(cfStatus, 'loading', 'Validating...');
        setInputBorder(cfAccount, 'loading');
        setInputBorder(cfToken, 'loading');
        if (btnTestCf) btnTestCf.disabled = true;
      }

      try {
        const result = await validateKey('cloudflare', { accountId, apiToken });
        if (result.valid) {
          setStatus(cfStatus, 'ok', result.message || 'Valid ✓');
          setInputBorder(cfAccount, 'ok');
          setInputBorder(cfToken, 'ok');
          setProviderKey('cloudflare', { accountId, apiToken, valid: true });
        } else {
          setStatus(cfStatus, 'error', result.error || 'Invalid');
          setInputBorder(cfAccount, 'error');
          setInputBorder(cfToken, 'error');
          setProviderKey('cloudflare', { accountId, apiToken, valid: false });
        }
      } catch (e) {
        setStatus(cfStatus, 'error', e.message || 'Network error');
        setInputBorder(cfAccount, 'error');
        setInputBorder(cfToken, 'error');
      } finally {
        if (btnTestCf) btnTestCf.disabled = false;
      }
    };

    const debouncedCf = debounce(() => doValidateCf(true), 800);
    if (cfAccount) {
      cfAccount.addEventListener('input', debouncedCf);
      cfAccount.addEventListener('blur', () => doValidateCf(true));
    }
    if (cfToken) {
      cfToken.addEventListener('input', debouncedCf);
      cfToken.addEventListener('blur', () => doValidateCf(true));
    }
    if (btnTestCf) {
      btnTestCf.addEventListener('click', () => doValidateCf(true));
    }
  }

  // ============================================
  // Restore saved keys on load
  // ============================================
  function restoreSavedKeys() {
    const groq = getProviderKey('groq');
    const cf = getProviderKey('cloudflare');

    const groqInput = document.getElementById('groqApiKey');
    if (groqInput && groq.apiKey) {
      groqInput.value = groq.apiKey;
      if (groq.valid) {
        setStatus(document.getElementById('groqKeyStatus'), 'ok', 'Saved ✓');
        setInputBorder(groqInput, 'ok');
      }
    }

    const cfAccount = document.getElementById('cfAccountId');
    const cfToken = document.getElementById('cfApiToken');
    if (cfAccount && cf.accountId) cfAccount.value = cf.accountId;
    if (cfToken && cf.apiToken) {
      cfToken.value = cf.apiToken;
      if (cf.valid) {
        setStatus(document.getElementById('cfKeyStatus'), 'ok', 'Saved ✓');
        setInputBorder(cfAccount, 'ok');
        setInputBorder(cfToken, 'ok');
      }
    }
  }

  // ============================================
  // Public helper: get current engine config (for clipper.js)
  // ============================================
  window.getSubtitleEngineConfig = function () {
    const engine = document.getElementById('clipperSubtitleEngine')?.value || 'local';

    if (engine === 'local') {
      return {
        engine: 'local',
        model: document.getElementById('clipperWhisperModelLocal')?.value ||
               document.getElementById('clipperWhisperModel')?.value || 'small'
      };
    }

    if (engine === 'groq') {
      const saved = getProviderKey('groq');
      return {
        engine: 'groq',
        model: document.getElementById('groqModel')?.value || 'whisper-large-v3-turbo',
        apiKey: document.getElementById('groqApiKey')?.value?.trim() || saved.apiKey || ''
      };
    }

    if (engine === 'cloudflare') {
      const saved = getProviderKey('cloudflare');
      return {
        engine: 'cloudflare',
        model: document.getElementById('cfModel')?.value || '@cf/openai/whisper-large-v3-turbo',
        accountId: document.getElementById('cfAccountId')?.value?.trim() || saved.accountId || '',
        apiToken: document.getElementById('cfApiToken')?.value?.trim() || saved.apiToken || ''
      };
    }

    return { engine: 'local', model: 'small' };
  };

  // ============================================
  // Init
  // ============================================
  function init() {
    // Wait for DOM
    if (document.getElementById('clipperSubtitleEngine')) {
      wireEvents();
      restoreSavedKeys();
      // Ensure the initial state of the dropdown is applied to UI
      const engine = document.getElementById('clipperSubtitleEngine').value;
      document.getElementById('engineLocalPanel')?.classList.toggle('hidden', engine !== 'local');
      document.getElementById('engineGroqPanel')?.classList.toggle('hidden', engine !== 'groq');
      document.getElementById('engineCloudflarePanel')?.classList.toggle('hidden', engine !== 'cloudflare');
    } else {
      // Retry a few times in case script loads early
      let tries = 0;
      const t = setInterval(() => {
        tries++;
        if (document.getElementById('clipperSubtitleEngine') || tries > 20) {
          clearInterval(t);
          if (document.getElementById('clipperSubtitleEngine')) {
            wireEvents();
            restoreSavedKeys();
            const engine = document.getElementById('clipperSubtitleEngine')?.value || 'local';
            document.querySelectorAll('.engine-local-panel').forEach(el => el.classList.toggle('hidden', engine !== 'local'));
            document.querySelectorAll('.engine-groq-panel').forEach(el => el.classList.toggle('hidden', engine !== 'groq'));
            document.querySelectorAll('.engine-cf-panel').forEach(el => el.classList.toggle('hidden', engine !== 'cloudflare'));
          }
        }
      }, 200);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
