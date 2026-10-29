/* ========= Flutter CanvasKit bootstrap (crossOriginIsolated-aware + progress + versioned assets) ========= */

/*
Deploy notes:
3) Root /index.html must stay fresh and inject:
     <script>window.__FLUTTER_BUILD__ = '202604211230';</script>
     <script src="/version/202604211230/flutter_bootstrap.js" defer></script>
4) Everything under /version/ should be hard-cached in nginx:
     Cache-Control: public, max-age=31536000, immutable
5) Root /index.html should be no-store.
6) Chromium CanvasKit is used only when window.crossOriginIsolated === true.
   Different API port alone does NOT mean iframe and does NOT require fallback.
   What matters is cross-origin isolation support on the page itself.
*/

// 0) Detect iframe
const inIframe = (() => {
  try {
    return window.self !== window.top;
  } catch (_) {
    return true;
  }
})();

const BootHelpers = window.FlutterBootstrapHelpers || (function () {
  function inferBootstrapScriptSrc(documentRef) {
    const current = documentRef.currentScript && documentRef.currentScript.src;
    if (current) {
      return current;
    }

    const scripts = documentRef.getElementsByTagName('script');
    for (let i = scripts.length - 1; i >= 0; i--) {
      const src = scripts[i] && scripts[i].src;
      if (src && /\/flutter_bootstrap\.js(?:\?|$)/.test(src)) {
        return src;
      }
    }

    return '';
  }

  function resolveBuildBase(options) {
    const injectedBuild = options && options.injectedBuild;
    const scriptSrc = options && options.scriptSrc;

    let build = injectedBuild;
    if (!build && scriptSrc) {
      const match = scriptSrc.match(/\/version\/([^/]+)\/flutter_bootstrap\.js(?:\?|$)/);
      if (match) {
        build = match[1];
      }
    }

    if (!build) {
      return { build: null, base: '/' };
    }

    return { build, base: `/version/${build}/` };
  }

  function toAbsoluteUrl(url, baseHref) {
    try {
      return new URL(url, baseHref || window.location.href).href;
    } catch (_) {
      return typeof url === 'string' ? url : '';
    }
  }

  function chooseCanvasKitBase(options) {
    const buildBase = options && options.buildBase ? options.buildBase : '/';
    const crossOriginIsolated =
      options && options.crossOriginIsolated === true;

    return crossOriginIsolated
      ? `${buildBase}canvaskit/chromium/`
      : `${buildBase}canvaskit/`;
  }

  function isTrackedCanvasKitWasmRequest(url, absoluteCanvasKitBase, baseHref) {
    if (typeof url !== 'string' || !url) {
      return false;
    }

    const absoluteUrl = toAbsoluteUrl(url, baseHref);
    return (
      absoluteUrl.startsWith(absoluteCanvasKitBase) &&
      /\/canvaskit\.wasm(?:$|\?)/.test(absoluteUrl)
    );
  }

  function isTrackedAppEntrypointRequest(url, absoluteBuildBase, baseHref) {
    if (typeof url !== 'string' || !url) {
      return false;
    }

    const absoluteUrl = toAbsoluteUrl(url, baseHref);
    if (!absoluteUrl.startsWith(absoluteBuildBase)) {
      return false;
    }

    return /\/(main\.dart\.(?:js|mjs)|main_module\.bootstrap\.js)(?:$|\?)/.test(
      absoluteUrl,
    );
  }

  return {
    inferBootstrapScriptSrc,
    resolveBuildBase,
    toAbsoluteUrl,
    chooseCanvasKitBase,
    isTrackedCanvasKitWasmRequest,
    isTrackedAppEntrypointRequest,
  };
})();

const BOOTSTRAP_SCRIPT_SRC = BootHelpers.inferBootstrapScriptSrc(document);
const BUILD_INFO = BootHelpers.resolveBuildBase({
  injectedBuild: window.__FLUTTER_BUILD__,
  scriptSrc: BOOTSTRAP_SCRIPT_SRC,
});
if (!BUILD_INFO.build) {
  console.warn(
    '[flutter_bootstrap] window.__FLUTTER_BUILD__ is not set and could not be inferred from script URL. Falling back to root /',
  );
}
const BUILD_BASE = BUILD_INFO.base;
const BOOT_MANIFEST = window.__FLUTTER_MANIFEST__ || null;

function findManifestFileByUrl(url) {
  if (!BOOT_MANIFEST || !Array.isArray(BOOT_MANIFEST.files)) {
    return null;
  }

  const absoluteUrl = BootHelpers.toAbsoluteUrl(url, window.location.href);
  const absoluteBase = BootHelpers.toAbsoluteUrl(
    BOOT_MANIFEST.base || BUILD_BASE,
    window.location.href,
  );

  if (!absoluteUrl.startsWith(absoluteBase)) {
    return null;
  }

  const relativePath = absoluteUrl
    .slice(absoluteBase.length)
    .split('?')[0]
    .split('#')[0];

  return BOOT_MANIFEST.files.find(function (file) {
    return file && file.path === relativePath;
  }) || null;
}

function preferredTransferForUrl(url, contentType, options) {
  options = options || {};

  const manifestFile = findManifestFileByUrl(url);

  if (!manifestFile) {
    throw new Error('Missing manifest entry for boot resource: ' + url);
  }

  if (!manifestFile.gzPath || !manifestFile.gzSize) {
    throw new Error(
      'Missing gzip version for boot resource: ' + manifestFile.path +
      '. Rebuild and make sure latest.json contains gzPath/gzSize.',
    );
  }

  return {
    url: BootHelpers.toAbsoluteUrl(
      `${BOOT_MANIFEST.base || BUILD_BASE}${manifestFile.gzPath}`,
      window.location.href,
    ),
    size: Number(manifestFile.gzSize || 0),
    sha256: manifestFile.gzSha256 || manifestFile.gzHash || null,
    isGzip: true,
    contentType: contentType,
    originalPath: manifestFile.path,
    transferPath: manifestFile.gzPath,
  };
}

// 1) Choose CanvasKit base.
// Use chromium variant only when the page is actually cross-origin isolated.
// Different port for API/backend does not by itself require iframe/basic mode.
const useChromiumCanvasKit = window.crossOriginIsolated === true;
const CK_BASE = BootHelpers.chooseCanvasKitBase({
  buildBase: BUILD_BASE,
  crossOriginIsolated: useChromiumCanvasKit,
});
const ABS_BUILD_BASE = BootHelpers.toAbsoluteUrl(BUILD_BASE, window.location.href);
const ABS_CK_BASE = BootHelpers.toAbsoluteUrl(CK_BASE, window.location.href);

// 2) Tell Flutter how to load from the versioned directory.
// Keep a single config object and pass it only through the modern loader API.
const ENGINE_CONFIG = {
  renderer: 'canvaskit',
  canvasKitBaseUrl: CK_BASE,
  canvasKitVariant: useChromiumCanvasKit ? 'chromium' : 'full',
  entrypointBaseUrl: BUILD_BASE,
  assetBase: BUILD_BASE,
};

console.log('[Flutter build]', BUILD_INFO.build);
console.log('[Flutter base]', BUILD_BASE);
console.log('[Flutter base absolute]', ABS_BUILD_BASE);
console.log('[CanvasKit base]', CK_BASE);
console.log('[CanvasKit base absolute]', ABS_CK_BASE);
console.log('[crossOriginIsolated]', window.crossOriginIsolated);
console.log('[inIframe]', inIframe);
console.log('[Flutter config]', ENGINE_CONFIG);

// ── Insert overlay (CSS + HTML) safely
function ensureOverlay() {
  if (!document.getElementById('ck-preloader-style')) {
    const style = document.createElement('style');
    style.id = 'ck-preloader-style';
    style.textContent =
      '#ck-preloader{position:fixed;inset:0;background:#0b0b0f;color:#eee;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;font:14px system-ui,-apple-system,Segoe UI,Roboto,Arial}' +
      '.loader-container{display:flex;align-items:center;justify-content:center;margin-bottom:20px;gap:8px}' +
      '.bracket{font-size:24px;color:#4da3ff;animation:pulse 1.5s infinite}' +
      '.kt-text{font-size:18px;color:#eee}' +
      '@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}' +
      '#ck-title{margin-bottom:12px;opacity:.9}' +
      '.ck-progress-group{width:min(420px,80vw);margin-top:10px}' +
      '.ck-progress-label{display:flex;justify-content:space-between;gap:12px;margin:0 0 4px;font-size:12px;color:#b9c2d0}' +
      '.ck-progress-track{height:8px;background:#222;border-radius:999px;overflow:hidden;box-shadow:inset 0 0 0 1px #333}' +
      '.ck-progress-fill{height:100%;width:0%;background:#4da3ff;transition:width .15s linear}' +
      '#ck-fill{transition:none}' +
      '#ck-stage-fill{background:#6dd59c}' +
      '#ck-sub{margin-top:10px;font-size:12px;color:#aaa}' +
      '#ck-reset-btn{margin-top:16px;padding:10px 16px;border:1px solid #fca5a5;border-radius:10px;background:#7f1d1d;color:#fff;font:600 13px system-ui,-apple-system,Segoe UI,Roboto,Arial;cursor:pointer;box-shadow:0 8px 20px rgba(0,0,0,.22)}' +
      '#ck-reset-btn:hover{background:#991b1b}' +
      '.ck-hide{opacity:0;pointer-events:none;transition:opacity 0.5s ease-out}';
    document.head.appendChild(style);
  }

  if (!document.getElementById('ck-preloader')) {
    const div = document.createElement('div');
    div.id = 'ck-preloader';
    div.innerHTML =
      '<div class="loader-container">' +
      '  <span class="bracket left">{</span>' +
      '  <span class="kt-text">SIMOPS</span>' +
      '  <span class="bracket right">}</span>' +
      '</div>' +
      '<div id="ck-title">Installing…</div>' +
      '<div class="ck-progress-group">' +
      '  <div class="ck-progress-label"><span id="ck-phase-label">CanvasKit</span><span id="ck-pct">0%</span></div>' +
      '  <div class="ck-progress-track"><div class="ck-progress-fill" id="ck-fill"></div></div>' +
      '</div>' +
      '<div class="ck-progress-group">' +
      '  <div class="ck-progress-label"><span>Overall progress</span><span id="ck-stage-pct">0%</span></div>' +
      '  <div class="ck-progress-track"><div class="ck-progress-fill" id="ck-stage-fill"></div></div>' +
      '</div>' +
      '<div id="ck-sub">Initializing CanvasKit</div>' +
      '<button id="ck-reset-btn" type="button">Reset app cache!</button>';

    if (document.body) {
      document.body.appendChild(div);
    } else {
      document.addEventListener(
        'DOMContentLoaded',
        function () {
          document.body.appendChild(div);
        },
        { once: true },
      );
    }
  }
}
ensureOverlay();

function openCleanupCache() {
  window.location.assign(`${BUILD_BASE}cleanup_cache.html`);
}

function bindResetButton() {
  const btn = el('ck-reset-btn');
  if (!btn || btn.__boundResetAction) {
    return;
  }

  btn.__boundResetAction = true;
  btn.addEventListener('click', openCleanupCache);
}

bindResetButton();

// ── Null-safe helpers
function el(id) {
  return document.getElementById(id);
}

function setSub(txt) {
  const n = el('ck-sub');
  if (n) n.textContent = txt;
}

let targetPct = 0;
let rafId = 0;
let currentPhase = 'CanvasKit';
let displayedPct = 0;
let stageTargetPct = 0;
let stageDisplayedPct = 0;
let stageRafId = 0;
let appPhaseTimer = 0;
let hasFirstFrame = false;
let reconnectReloadScheduled = false;
let reconnectOnlineHandler = null;

const bootResourceCache = new Map();
let canvasKitWasmBootPromise = null;

function responseFromCachedBootResource(cacheEntry) {
  const headers = new Headers();
  headers.set('Content-Type', cacheEntry.contentType || 'application/octet-stream');

  return new Response(cacheEntry.body.slice(0), {
    status: 200,
    statusText: 'OK',
    headers: headers,
  });
}

function renderFatalBootError(reason) {
  stopAppPhaseTimer();
  setPhaseLabel('Application');
  setSub('Application could not be loaded. Please check the connection and press F5.');

  const root = el('ck-preloader');
  if (!root) {
    return;
  }

  const message = reason && (reason.message || reason.name || String(reason)) || 'Unknown error';
  root.innerHTML =
    '<div style="max-width:720px;padding:24px;text-align:left;font:14px system-ui,-apple-system,Segoe UI,Roboto,Arial">' +
    '  <h2 style="margin:0 0 12px;color:#fff">Cannot load application</h2>' +
    '  <p style="margin:0 0 12px;color:#ddd">The connection was interrupted or a boot file could not be decoded.</p>' +
    '  <p style="margin:0 0 12px;color:#ddd">Please check the network and press <b>F5</b>. If it repeats, clear site data for this site.</p>' +
    '  <pre style="white-space:pre-wrap;background:#1f2937;color:#f9fafb;padding:12px;border-radius:8px;max-height:220px;overflow:auto">' +
    message.replace(/[&<>]/g, function (ch) {
      return ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;';
    }) +
    '  </pre>' +
    '  <button id="ck-reset-btn" type="button" style="margin-top:16px;padding:10px 16px;border:1px solid #fca5a5;border-radius:10px;background:#7f1d1d;color:#fff;font:600 13px system-ui,-apple-system,Segoe UI,Roboto,Arial;cursor:pointer;box-shadow:0 8px 20px rgba(0,0,0,.22)">Reset app cache!</button>' +
    '</div>';
  bindResetButton();
}

function setFillPct(pct) {
  const fill = el('ck-fill');
  if (fill) {
    fill.style.width = `${pct}%`;
  }
  const label = el('ck-pct');
  if (label) {
    label.textContent = `${Math.max(0, Math.min(100, pct | 0))}%`;
  }
}

function setStageFillPct(pct) {
  const fill = el('ck-stage-fill');
  if (fill) {
    fill.style.width = `${pct}%`;
  }
  const label = el('ck-stage-pct');
  if (label) {
    label.textContent = `${Math.max(0, Math.min(100, pct | 0))}%`;
  }
}

function setPhaseLabel(text) {
  const label = el('ck-phase-label');
  if (label) {
    label.textContent = text;
  }
}

function setPct(p) {
  targetPct = Math.max(0, Math.min(100, p | 0));
  if (!rafId) rafId = requestAnimationFrame(step);
}

function setDownloadPct(p) {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  targetPct = Math.max(0, Math.min(100, p | 0));
  displayedPct = targetPct;
  setFillPct(targetPct);
}

function setStagePct(p) {
  stageTargetPct = Math.max(0, Math.min(100, p | 0));
  if (!stageRafId) stageRafId = requestAnimationFrame(stepStage);
}

function step() {
  const fill = el('ck-fill');
  if (!fill) {
    rafId = 0;
    return;
  }

  const current = parseFloat(fill.style.width || '0');
  let next = current + Math.max(0.5, (targetPct - current) * 0.2);
  if (next >= targetPct - 0.1) next = targetPct;

  displayedPct = next;
  setFillPct(next);

  if (next < targetPct) {
    rafId = requestAnimationFrame(step);
  } else {
    rafId = 0;
  }
}

function stepStage() {
  const fill = el('ck-stage-fill');
  if (!fill) {
    stageRafId = 0;
    return;
  }

  const current = parseFloat(fill.style.width || '0');
  let next = current + Math.max(0.5, (stageTargetPct - current) * 0.18);
  if (next >= stageTargetPct - 0.1) next = stageTargetPct;

  stageDisplayedPct = next;
  setStageFillPct(next);

  if (next < stageTargetPct) {
    stageRafId = requestAnimationFrame(stepStage);
  } else {
    stageRafId = 0;
  }
}

function stopAppPhaseTimer() {
  if (appPhaseTimer) {
    clearInterval(appPhaseTimer);
    appPhaseTimer = 0;
  }
}

function setOfflineState() {
  setSub('Connection lost. Waiting for network…');
}

function cancelReloadOnReconnect() {
  if (reconnectOnlineHandler) {
    window.removeEventListener('online', reconnectOnlineHandler);
    reconnectOnlineHandler = null;
  }
  reconnectReloadScheduled = false;
}

function scheduleReloadOnReconnect() {
  if (reconnectReloadScheduled || hasFirstFrame) return;
  reconnectReloadScheduled = true;
  reconnectOnlineHandler = function handleOnline() {
    window.removeEventListener('online', reconnectOnlineHandler);
    reconnectOnlineHandler = null;
    reconnectReloadScheduled = false;
    if (!hasFirstFrame) {
      location.reload();
    }
  };

  window.addEventListener(
    'online',
    reconnectOnlineHandler,
    { once: true },
  );
}

function startAppPhaseTimer() {
  stopAppPhaseTimer();
  appPhaseTimer = setInterval(function () {
    if (currentPhase === 'Application' && targetPct < 78) {
      setPct(targetPct + 2);
    } else {
      stopAppPhaseTimer();
    }
  }, 180);
}

function switchToApplicationPhase(initialPct, subtitle) {
  stopAppPhaseTimer();
  currentPhase = 'Application';
  setPhaseLabel('main.dart.js');
  if (displayedPct > initialPct) {
    displayedPct = 0;
    setFillPct(0);
  }
  targetPct = 0;
  setPct(initialPct);
  if (subtitle) {
    setSub(subtitle);
  }
}

setSub('Preparing renderer…');
setPhaseLabel('CanvasKit');
setPct(8);
setStagePct(10);

window.addEventListener('offline', function () {
  setOfflineState();
  scheduleReloadOnReconnect();
});

// 5) Human-readable bytes
function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = bytes / Math.pow(k, i);

  let s = val.toFixed(dm);
  if (dm > 0) {
    s = s.replace(/(\.\d*[1-9])0+$/, '$1').replace(/\.0+$/, '');
  }

  return `${s} ${sizes[i]}`;
}

const origFetch = window.fetch;

function resolveFlutterBootDownloadHelpersUrl() {
  if (BUILD_INFO.build) {
    return `${BUILD_BASE}boot_download_helpers.js`;
  }

  if (BOOTSTRAP_SCRIPT_SRC) {
    try {
      return new URL('boot_download_helpers.js', BOOTSTRAP_SCRIPT_SRC).href;
    } catch (_) {
      // Fall back below.
    }
  }

  return '/boot_download_helpers.js';
}

const FLUTTER_BOOT_DOWNLOAD_HELPERS_URL = resolveFlutterBootDownloadHelpersUrl();
const WASM_DOWNLOAD_IDLE_MS = 25000;
const BOOT_FETCH_RETRY_DELAY_MS = 2000;
const BOOT_FETCH_MAX_ATTEMPTS = 200;

let flutterBootDownloadHelpersPromise = null;

function ensureBootDownloadHelpers() {
  if (window.BootDownloadHelpers) {
    return Promise.resolve(window.BootDownloadHelpers);
  }

  if (!flutterBootDownloadHelpersPromise) {
    flutterBootDownloadHelpersPromise = new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      script.src = FLUTTER_BOOT_DOWNLOAD_HELPERS_URL;
      script.async = true;
      script.onload = function () {
        if (!window.BootDownloadHelpers) {
          reject(new Error(`Cannot load ${FLUTTER_BOOT_DOWNLOAD_HELPERS_URL}`));
          return;
        }

        resolve(window.BootDownloadHelpers);
      };
      script.onerror = function () {
        reject(new Error(`Cannot load ${FLUTTER_BOOT_DOWNLOAD_HELPERS_URL}`));
      };
      (document.head || document.documentElement).appendChild(script);
    });
  }

  return flutterBootDownloadHelpersPromise;
}

/** @returns {{ url: string; init: RequestInit }} */
function normalizeWasmFetchArgs(rawInput, rawInit) {
  if (typeof rawInput === 'string') {
    return {
      url: rawInput,
      init: Object.assign({}, rawInit || {}),
    };
  }
  var rq = rawInput;
  var plain = {};

  plain.method = rq.method;
  plain.cache = rq.cache;
  plain.credentials = rq.credentials;
  plain.integrity = rq.integrity;
  plain.keepalive = rq.keepalive;
  plain.mode = rq.mode;
  plain.redirect = rq.redirect;
  plain.referrer = rq.referrer;
  plain.referrerPolicy = rq.referrerPolicy;

  plain.headers = rq.headers;
  if (rawInit) {
    Object.assign(plain, rawInit);
    if (rawInit.headers) plain.headers = rawInit.headers;
    if ('signal' in rawInit) plain.signal = rawInit.signal;
  }

  return { url: rq.url, init: plain };
}

/**
 * Downloads a large boot resource via one or more requests; stalled reads
 * reopen with Range: bytes=<offset>- and retry hard during initial load.
 */
async function fetchMergedCanvasKitWasm(wasmUrlStr, wasmInitClone, options) {
  options = options || {};

  const helpers = await ensureBootDownloadHelpers();
  var cacheKey = BootHelpers.toAbsoluteUrl(wasmUrlStr, window.location.href);
  var cached = bootResourceCache.get(cacheKey);
  if (cached) {
    return responseFromCachedBootResource(cached);
  }

  var transferInfo = preferredTransferForUrl(
    wasmUrlStr,
    options.contentType || 'application/wasm',
    options,
  );
  var transferUrlStr = transferInfo.url;
  var resourceLabel = options.label || 'resource';
  var responseContentType = transferInfo.contentType || 'application/octet-stream';
  var progressDenominator = transferInfo.size > 0 ? transferInfo.size : 6.5 * 1024 * 1024;

  var downloadResult = await helpers.downloadResumableBytes(
    transferUrlStr,
    wasmInitClone,
    {
      label: resourceLabel,
      collectBytes: true,
      totalBytesHint: transferInfo.size > 0 ? transferInfo.size : null,
      expectedSha256: transferInfo.sha256 || null,
      idleMs: WASM_DOWNLOAD_IDLE_MS,
      maxAttempts: BOOT_FETCH_MAX_ATTEMPTS,
      retryDelayMs: BOOT_FETCH_RETRY_DELAY_MS,
      maxRetryDelayMs: 5000,
      strictRangeResume: false,
      onProgress: function (loadedBytes, totalBytes) {
        var denominator = totalBytes || progressDenominator;
        var pctHud = 12 + Math.min(80, (loadedBytes / denominator) * 80);
        setDownloadPct(pctHud);
        setSub(
          `Downloading ${resourceLabel}… (${formatBytes(loadedBytes)} / ${formatBytes(denominator)} transfer${transferInfo.isGzip ? ' (.gz)' : ''})`,
        );
      },
      onRetryDelay: function (delayMs) {
        setSub(
          'Connection interrupted while loading ' + resourceLabel +
          '. Retrying in ' + Math.round(delayMs / 1000) + 's…',
        );
      },
    },
  );

  var bodyOut = downloadResult.bytes ? downloadResult.bytes.buffer : new ArrayBuffer(0);

  if (transferInfo.isGzip) {
    setSub(`Decompressing ${resourceLabel}…`);
    bodyOut = await helpers.gunzipArrayBuffer(bodyOut);
  }

  setPct(95);
  setSub('Download complete');
  setStagePct(34);

  bootResourceCache.set(cacheKey, {
    body: bodyOut.slice(0),
    contentType: responseContentType,
  });

  var syntheticHdrs = new Headers();
  syntheticHdrs.set('Content-Type', responseContentType);
  syntheticHdrs.delete('Content-Encoding');

  return new Response(bodyOut, {
    status: 200,
    statusText: 'OK',
    headers: syntheticHdrs,
  });
}


function getCanvasKitWasmUrl() {
  return BootHelpers.toAbsoluteUrl(`${CK_BASE}canvaskit.wasm`, window.location.href);
}

function ensureCanvasKitWasmReady() {
  if (canvasKitWasmBootPromise) {
    return canvasKitWasmBootPromise;
  }

  canvasKitWasmBootPromise = (async function () {
    currentPhase = 'CanvasKit';
    setPhaseLabel('CanvasKit');
    setSub('Downloading CanvasKit…');
    setPct(12);
    setStagePct(20);

    return fetchMergedCanvasKitWasm(getCanvasKitWasmUrl(), {}, {
      contentType: 'application/wasm',
      label: 'CanvasKit',
      preferGzip: true,
    });
  })()
    .then(function (response) {
      if (!response || !response.ok) {
        throw new Error(
          'Failed to download CanvasKit: ' +
          (response ? response.status : 'no response'),
        );
      }

      setSub('CanvasKit downloaded');
      setPct(95);
      setStagePct(45);
      return response;
    })
    .catch(function (error) {
      canvasKitWasmBootPromise = null;
      throw error;
    });

  return canvasKitWasmBootPromise;
}

// 6) Intercept fetch for CanvasKit WASM + main.dart.js bootstrap.

window.fetch = async function (input, init) {
  const url =
    typeof input === 'string' ? input : input && input.url;

  const isWasm = BootHelpers.isTrackedCanvasKitWasmRequest(
    url,
    ABS_CK_BASE,
    window.location.href,
  );
  const isAppEntrypoint = BootHelpers.isTrackedAppEntrypointRequest(
    url,
    ABS_BUILD_BASE,
    window.location.href,
  );

  if (!isWasm && !isAppEntrypoint) return origFetch(input, init);

  try {
    if (isWasm) {
      return ensureCanvasKitWasmReady();
    }

    // If main.dart.js is ever requested through fetch, still keep the same
    // user-facing order: CanvasKit first, then main.dart.js.
    await ensureCanvasKitWasmReady();

    switchToApplicationPhase(18, 'Loading main.dart.js…');
    setStagePct(55);
    startAppPhaseTimer();

    const appNw = normalizeWasmFetchArgs(input, init);
    const resp = await fetchMergedCanvasKitWasm(appNw.url, appNw.init, {
      contentType: 'application/javascript',
      label: 'main.dart.js',
      preferGzip: true,
    });

    if (resp.ok) {
      setSub('main.dart.js loaded');
      setPct(62);
      setStagePct(68);
    }

    return resp;
  } catch (e) {
    setOfflineState();

    if (!hasFirstFrame) {
      renderFatalBootError(e && (e.message || e.name || String(e)));
    } else {
      scheduleReloadOnReconnect();
    }

    throw e;
  }
};

// 7) Hide overlay when Flutter paints first frame
window.addEventListener('flutter-first-frame', function () {
  hasFirstFrame = true;
  cancelReloadOnReconnect();
  stopAppPhaseTimer();
  setSub('Launching…');
  setPhaseLabel('Application');
  setPct(100);
  setStagePct(100);

  const root = el('ck-preloader');
  if (root) {
    root.classList.add('ck-hide');
    setTimeout(function () {
      if (root.parentNode) {
        root.parentNode.removeChild(root);
      }
    }, 500);
  }
});

// 8) Preload only the chosen CanvasKit variant from the versioned build.

(function preloadChosenVariant() {
  // Disabled intentionally.
  // All large boot resources are loaded through the controlled gzip/range loader.
  // Native preload would use the non-gzip URL and bypass retry/progress logic.
})();



// 8b) Flutter loader usually loads main.dart.js by creating a <script> tag.
// Script-tag network requests do NOT go through window.fetch.
// Fast mode: let the native script loader run and only arm an error handler.
// Safe mode: intercept the script and load it through the try-hard gzip/range loader.
(function installMainEntrypointScriptTryHardLoader() {
  if (window.__flutterMainScriptTryHardInstalled) {
    return;
  }
  window.__flutterMainScriptTryHardInstalled = true;

  const nativeAppendChild = Node.prototype.appendChild;
  const nativeInsertBefore = Node.prototype.insertBefore;
  const nativeElementAppend = Element.prototype.append;
  const nativeElementPrepend = Element.prototype.prepend;

  function makeErrorEvent(error) {
    try {
      return new ErrorEvent('error', {
        error: error,
        message: String(error && (error.message || error) || 'script load error'),
      });
    } catch (_) {
      const ev = document.createEvent('Event');
      ev.initEvent('error', false, false);
      ev.error = error;
      ev.message = String(error && (error.message || error) || 'script load error');
      return ev;
    }
  }

  function isMainEntrypointScript(node) {
    if (!node || node.nodeType !== 1) {
      return false;
    }

    const tag = String(node.tagName || '').toUpperCase();
    if (tag !== 'SCRIPT') {
      return false;
    }

    if (node.getAttribute && node.getAttribute('data-tryhard-main-entrypoint') === '1') {
      return false;
    }

    const src = node.src || (node.getAttribute && node.getAttribute('src')) || '';
    return BootHelpers.isTrackedAppEntrypointRequest(
      src,
      ABS_BUILD_BASE,
      window.location.href,
    );
  }

  function armNativeMainScriptErrorReload(script, originalSrc) {
    if (script.getAttribute && script.getAttribute('data-tryhard-error-armed') === '1') {
      return;
    }

    if (script.setAttribute) {
      script.setAttribute('data-tryhard-error-armed', '1');
    }

    script.addEventListener('error', function (error) {
      console.warn('[flutter_bootstrap] native main.dart.js script failed:', originalSrc, error);
      if (!hasFirstFrame) {
        renderFatalBootError('native main.dart.js script error');
      }
    }, { once: true });
  }

  function loadMainEntrypointIntoScript(parent, script, originalSrc, insertBeforeNode) {
    script.setAttribute('data-tryhard-main-entrypoint', '1');

    ensureCanvasKitWasmReady()
      .then(function () {
        switchToApplicationPhase(18, 'Loading main.dart.js…');
        setStagePct(55);
        startAppPhaseTimer();

        return (async function () {
          return fetchMergedCanvasKitWasm(originalSrc, {}, {
            contentType: 'application/javascript',
            label: 'main.dart.js',
            preferGzip: true,
          });
        })();
      })
      .then(function (response) {
        if (!response || !response.ok) {
          throw new Error(
            'Failed to download main.dart.js: ' +
            (response ? response.status : 'no response'),
          );
        }

        return response.arrayBuffer();
      })
      .then(function (body) {
        const blobUrl = URL.createObjectURL(
          new Blob([body], { type: 'application/javascript' }),
        );

        function revokeBlobUrl() {
          URL.revokeObjectURL(blobUrl);
        }

        script.addEventListener('load', revokeBlobUrl, { once: true });
        script.addEventListener('error', revokeBlobUrl, { once: true });

        script.src = blobUrl;

        if (insertBeforeNode) {
          nativeInsertBefore.call(parent, script, insertBeforeNode);
        } else {
          nativeAppendChild.call(parent, script);
        }

        setSub('main.dart.js loaded');
        setPct(62);
        setStagePct(68);
      })
      .catch(function (error) {
        console.error('[flutter_bootstrap] main.dart.js try-hard load failed:', error);
        setOfflineState();

        if (!hasFirstFrame) {
          renderFatalBootError(error && (error.message || error.name || String(error)));
        } else {
          scheduleReloadOnReconnect();
        }

        script.dispatchEvent(makeErrorEvent(error));
      });
  }

  function handleMainScript(parent, script, originalSrc, insertBeforeNode) {
    // Always use the controlled gzip/range loader for main.dart.js.
    // This avoids the native <script src="main.dart.js"> non-gzip request and
    // guarantees progress/retry is visible.
    loadMainEntrypointIntoScript(parent, script, originalSrc, insertBeforeNode || null);
    return script;
  }

  Node.prototype.appendChild = function patchedAppendChild(child) {
    if (isMainEntrypointScript(child)) {
      const originalSrc = child.src || child.getAttribute('src');
      return handleMainScript(this, child, originalSrc, null);
    }

    return nativeAppendChild.call(this, child);
  };

  Node.prototype.insertBefore = function patchedInsertBefore(child, referenceNode) {
    if (isMainEntrypointScript(child)) {
      const originalSrc = child.src || child.getAttribute('src');
      return handleMainScript(this, child, originalSrc, referenceNode || null);
    }

    return nativeInsertBefore.call(this, child, referenceNode);
  };

  if (nativeElementAppend) {
    Element.prototype.append = function patchedElementAppend() {
      const normalNodes = [];

      for (let i = 0; i < arguments.length; i += 1) {
        const node = arguments[i];

        if (isMainEntrypointScript(node)) {
          const originalSrc = node.src || node.getAttribute('src');
          handleMainScript(this, node, originalSrc, null);
        } else {
          normalNodes.push(node);
        }
      }

      if (normalNodes.length > 0) {
        return nativeElementAppend.apply(this, normalNodes);
      }

      return undefined;
    };
  }

  if (nativeElementPrepend) {
    Element.prototype.prepend = function patchedElementPrepend() {
      const normalNodes = [];

      for (let i = 0; i < arguments.length; i += 1) {
        const node = arguments[i];

        if (isMainEntrypointScript(node)) {
          const originalSrc = node.src || node.getAttribute('src');
          handleMainScript(this, node, originalSrc, this.firstChild || null);
        } else {
          normalNodes.push(node);
        }
      }

      if (normalNodes.length > 0) {
        return nativeElementPrepend.apply(this, normalNodes);
      }

      return undefined;
    };
  }
})();
(()=>{var C={blink:!0,gecko:!1,webkit:!1,unknown:!1},A=()=>navigator.vendor==="Google Inc."||navigator.userAgent.includes("Edg/")?"blink":navigator.vendor==="Apple Computer, Inc."?"webkit":navigator.vendor===""&&navigator.userAgent.includes("Firefox")?"gecko":"unknown",T=A(),x=()=>typeof ImageDecoder>"u"?!1:T==="blink",R=()=>typeof Intl.v8BreakIterator<"u"&&typeof Intl.Segmenter<"u",j=()=>typeof window.TextCluster<"u",B=()=>{let n=[0,97,115,109,1,0,0,0,1,5,1,95,1,120,0];return WebAssembly.validate(new Uint8Array(n))},K=()=>{let n=document.createElement("canvas");return n.width=1,n.height=1,n.getContext("webgl2")!=null?2:n.getContext("webgl")!=null?1:-1},$=()=>window.chrome&&chrome.runtime&&chrome.runtime.id,f={browserEngine:T,hasImageCodecs:x(),hasChromiumBreakIterators:R(),hasTextCluster:j(),supportsWasmGC:B(),crossOriginIsolated:window.crossOriginIsolated,webGLVersion:K(),isChromeExtension:$()};function m(...n){return new URL(W(...n),document.baseURI).toString()}function W(...n){return n.filter(e=>!!e).map((e,s)=>s===0?L(e):F(L(e))).filter(e=>e.length).join("/")}function F(n){let e=0;for(;e<n.length&&n.charAt(e)==="/";)e++;return n.substring(e)}function L(n){let e=n.length;for(;e>0&&n.charAt(e-1)==="/";)e--;return n.substring(0,e)}function _(n,e){return n.canvasKitBaseUrl?n.canvasKitBaseUrl:e.engineRevision&&!e.useLocalCanvasKit?W("https://www.gstatic.com/flutter-canvaskit",e.engineRevision):"canvaskit"}var g=class{constructor(){this._scriptLoaded=!1}setTrustedTypesPolicy(e){this._ttPolicy=e}async loadEntrypoint(e){let{entrypointUrl:s=m("main.dart.js"),onEntrypointLoaded:t,nonce:r}=e||{};return this._loadJSEntrypoint(s,t,r)}async load(e,s,t,r,i){i??=a=>{a.initializeEngine(t).then(l=>l.runApp())};let{entrypointBaseUrl:o}=t,{entryPointBaseUrl:c}=t;if(!o&&c&&(console.warn("[deprecated] `entryPointBaseUrl` is deprecated and will be removed in a future release. Use `entrypointBaseUrl` instead."),o=c),e.compileTarget==="dart2wasm")return this._loadWasmEntrypoint(e,s,o,i);{let a=e.mainJsPath??"main.dart.js",l=m(o,a);return this._loadJSEntrypoint(l,i,r)}}didCreateEngineInitializer(e){typeof this._didCreateEngineInitializerResolve=="function"&&(this._didCreateEngineInitializerResolve(e),this._didCreateEngineInitializerResolve=null,delete _flutter.loader.didCreateEngineInitializer),typeof this._onEntrypointLoaded=="function"&&this._onEntrypointLoaded(e)}_loadJSEntrypoint(e,s,t){let r=typeof s=="function";if(!this._scriptLoaded){this._scriptLoaded=!0;let i=this._createScriptTag(e,t);if(r)console.debug("Injecting <script> tag. Using callback."),this._onEntrypointLoaded=s,document.head.append(i);else return new Promise((o,c)=>{console.debug("Injecting <script> tag. Using Promises. Use the callback approach instead!"),this._didCreateEngineInitializerResolve=o,i.addEventListener("error",c),document.head.append(i)})}}async _loadWasmEntrypoint(e,s,t,r){if(!this._scriptLoaded){this._scriptLoaded=!0,this._onEntrypointLoaded=r;let{mainWasmPath:i,jsSupportRuntimePath:o}=e,c=m(t,i),a=m(t,o);this._ttPolicy!=null&&(a=this._ttPolicy.createScriptURL(a));let p=(await import(a)).compileStreaming(fetch(c)),d;e.renderer==="skwasm"?d=(async()=>{let u=await s.skwasm;return window._flutter_skwasmInstance=u,{skwasm:u.wasmExports,skwasmWrapper:u,ffi:{memory:u.wasmMemory}}})():d=Promise.resolve({}),await(await(await p).instantiate(await d)).invokeMain()}}_createScriptTag(e,s){let t=document.createElement("script");t.type="application/javascript",s&&(t.nonce=s);let r=e;return this._ttPolicy!=null&&(r=this._ttPolicy.createScriptURL(e)),t.src=r,t}};async function E(n,e,s){if(e<0)return n;let t,r=new Promise((i,o)=>{t=setTimeout(()=>{o(new Error(`${s} took more than ${e}ms to resolve. Moving on.`,{cause:E}))},e)});return Promise.race([n,r]).finally(()=>{clearTimeout(t)})}var v=class{setTrustedTypesPolicy(e){this._ttPolicy=e}loadServiceWorker(e){if(!e||!("serviceWorker"in navigator))return Promise.resolve();let s=()=>{console.warn(`Loading the service worker using Flutter bootstrap is deprecated and will stop working in a future release.
For more details, see: https://github.com/flutter/flutter/issues/156910`)},t=()=>{let{serviceWorkerVersion:r,serviceWorkerUrl:i=m(`flutter_service_worker.js?v=${r}`),timeoutMillis:o=4e3}=e,c=i;this._ttPolicy!=null&&(c=this._ttPolicy.createScriptURL(c));let a=navigator.serviceWorker.register(c).then(l=>this._getNewServiceWorker(l,r)).then(this._waitForServiceWorkerActivation);return E(a,o,"prepareServiceWorker")};return e.serviceWorkerUrl!=null?(s(),t()):navigator.serviceWorker.getRegistration().then(r=>r?t():Promise.resolve())}async _getNewServiceWorker(e,s){if(!e.active&&(e.installing||e.waiting))return console.debug("Installing/Activating first service worker."),e.installing||e.waiting;if(e.active.scriptURL.endsWith(s))return console.debug("Loading from existing service worker."),e.active;{let t=await e.update();return console.debug("Updating service worker."),t.installing||t.waiting||t.active}}async _waitForServiceWorkerActivation(e){if(!e||e.state==="activated")if(e){console.debug("Service worker already active.");return}else throw new Error("Cannot activate a null service worker!");return new Promise((s,t)=>{e.addEventListener("statechange",()=>{e.state==="activated"&&(console.debug("Activated new service worker."),s())})})}};var y=class{constructor(e,s="flutter-js"){let t=e||[/\.js$/,/\.mjs$/];window.trustedTypes&&(this.policy=trustedTypes.createPolicy(s,{createScriptURL:function(r){if(r.startsWith("blob:"))return r;let i=new URL(r,window.location),o=i.pathname.split("/").pop();if(t.some(a=>a.test(o)))return i.toString();console.error("URL rejected by TrustedTypes policy",s,":",r,"(download prevented)")}}))}};var b=(n,e)=>{let s=window._flutter?.buildConfig?.wasmHashes,t=s?.[e];if(!t&&e.includes("/")){let a=e.split("/").pop();t=s?.[a]}let r="crossOriginStorage"in navigator&&"requestFileHandles"in navigator.crossOriginStorage;r&&console.log("Cross-Origin Storage is supported. See https://wicg.github.io/cross-origin-storage/ for more details.");let i=async a=>{let l={algorithm:"SHA-256",value:a};try{let[p]=await navigator.crossOriginStorage.requestFileHandles([l]),d=await p.getFile();return new Response(d,{headers:{"Content-Type":"application/wasm"}})}catch(p){p.name==="NotAllowedError"?console.warn(`Not allowed to retrieve ${e} (hash: ${a}).`):p.name!=="NotFoundError"&&console.warn(`Unexpected error during retrieval of ${e} (hash: ${a}).`,p)}},o=async()=>{if(r&&t){let l=await i(t);if(l)return l}let a=await fetch(n);if(r&&t&&a.ok){let l={algorithm:"SHA-256",value:t},p=a.clone();(async()=>{try{let d=await p.blob(),[h]=await navigator.crossOriginStorage.requestFileHandles([l],{create:!0}),w=await h.createWritable();await w.write(d),await w.close()}catch(d){console.warn(`Error storing ${e} (hash: ${t}):`,d)}})()}return a},c=WebAssembly.compileStreaming(o());return(a,l)=>((async()=>{let p=await c,d=await WebAssembly.instantiate(p,a);l(d,p)})(),{})};var I=(n,e,s,t)=>(window.flutterCanvasKitLoaded=(async()=>{if(window.flutterCanvasKit)return window.flutterCanvasKit;let r=s.hasChromiumBreakIterators&&s.hasImageCodecs;if(!r&&e.canvasKitVariant=="chromium")throw"Chromium CanvasKit variant specifically requested, but unsupported in this browser";let i=r&&e.canvasKitVariant!=="full",o=i&&e.preferWebParagraph&&s.hasTextCluster,c=t;o?c=m(c,"webparagraph"):i&&(c=m(c,"chromium"));let a=m(c,"canvaskit.js");n.flutterTT.policy&&(a=n.flutterTT.policy.createScriptURL(a));let l="canvaskit.wasm";o?l="webparagraph/canvaskit.wasm":i&&(l="chromium/canvaskit.wasm");let p=b(m(c,"canvaskit.wasm"),l),d=await import(a);return window.flutterCanvasKit=await d.default({instantiateWasm:p}),window.flutterCanvasKit})(),window.flutterCanvasKitLoaded);var U=async(n,e,s,t)=>{let i=!s.hasImageCodecs||!s.hasChromiumBreakIterators?"skwasm_heavy":e.enableWimp?"wimp":"skwasm",o=m(t,`${i}.js`),c=o;n.flutterTT.policy&&(c=n.flutterTT.policy.createScriptURL(c));let a=b(m(t,`${i}.wasm`),`${i}.wasm`),l=await import(c);return!s.crossOriginIsolated&&!e.forceSingleThreadedSkwasm&&!e.suppressMultithreadingWarning&&console.warn(`Flutter Web: Skwasm uses multi-threading and web workers for better performance, but your page needs to be cross-origin isolated to support multi-threading. Skwasm will run in single-threaded mode.
To enable multithreading, serve your app with these HTTP response headers:
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
See https://web.dev/articles/coop-coep for guidance.
To silence this warning, set \`suppressMultithreadingWarning: true\` in your Flutter configuration.`),await l.default({skwasmSingleThreaded:e.enableWimp||!s.crossOriginIsolated||s.isChromeExtension||e.forceSingleThreadedSkwasm,instantiateWasm:a,locateFile:(p,d)=>p.endsWith(".ww.js")?URL.createObjectURL(new Blob([`
"use strict";

let eventListener;
eventListener = (message) => {
    const pendingMessages = [];
    const data = message.data;
    data["instantiateWasm"] = (info,receiveInstance) => {
        const instance = new WebAssembly.Instance(data["wasm"], info);
        return receiveInstance(instance, data["wasm"])
    };
    import(data.js).then(async (skwasm) => {
        await skwasm.default(data);

        removeEventListener("message", eventListener);
        for (const message of pendingMessages) {
            dispatchEvent(message);
        }
    });
    removeEventListener("message", eventListener);
    eventListener = (message) => {

        pendingMessages.push(message);
    };

    addEventListener("message", eventListener);
};
addEventListener("message", eventListener);
`],{type:"application/javascript"})):m(t,p),mainScriptUrlOrBlob:o})};var P=f.supportsWasmGC,k=class{async loadEntrypoint(e){let{serviceWorker:s,...t}=e||{},r=new y,i=new v;i.setTrustedTypesPolicy(r.policy),await i.loadServiceWorker(s).catch(c=>{console.warn("Exception while loading service worker:",c)});let o=new g;return o.setTrustedTypesPolicy(r.policy),this.didCreateEngineInitializer=o.didCreateEngineInitializer.bind(o),o.loadEntrypoint(t)}async load({serviceWorkerSettings:e,onEntrypointLoaded:s,nonce:t,config:r}={}){r??={};let i=_flutter.buildConfig;if(!i)throw"FlutterLoader.load requires _flutter.buildConfig to be set";let o=r.wasmAllowList?.[f.browserEngine]??C[f.browserEngine],c=u=>{switch(u){case"skwasm":return P?f.webGLVersion>0?o?null:`Skwasm is disabled by your wasmAllowList configuration for browser engine "${f.browserEngine}".`:"Skwasm requires WebGL support; this browser does not provide it.":"Skwasm requires WasmGC support; this browser does not implement it yet.";default:return null}},a=u=>u.compileTarget==="dart2wasm"&&!P?"dart2wasm requires WasmGC support; this browser does not implement it yet.":r.renderer&&r.renderer!=u.renderer?`The application is configured to use the "${r.renderer}" renderer; this build targets "${u.renderer}".`:c(u.renderer),l,p=[];for(let u of i.builds){let S=a(u);if(S===null){l=u;break}p.push({candidate:u,reason:S})}if(r.verboseBuildSelection)for(let u of p)console.warn(`Flutter Web: build ${u.candidate.compileTarget}/${u.candidate.renderer} was skipped: ${u.reason}`);if(!l)throw console.warn("Flutter Web: no compatible build found for this browser."+(r.verboseBuildSelection?"":" Set `verboseBuildSelection: true` in your Flutter configuration to see why each candidate was rejected.")),new Error("FlutterLoader could not find a build compatible with configuration and environment.");let d={};d.flutterTT=new y,e&&(d.serviceWorkerLoader=new v,d.serviceWorkerLoader.setTrustedTypesPolicy(d.flutterTT.policy),await d.serviceWorkerLoader.loadServiceWorker(e).catch(u=>{console.warn("Exception while loading service worker:",u)}));let h=_(r,i);l.renderer==="canvaskit"?d.canvasKit=I(d,r,f,h):l.renderer==="skwasm"&&(d.skwasm=U(d,r,f,h));let w=new g;return w.setTrustedTypesPolicy(d.flutterTT.policy),this.didCreateEngineInitializer=w.didCreateEngineInitializer.bind(w),w.load(l,d,r,t,s)}};window._flutter||(window._flutter={});window._flutter.loader||(window._flutter.loader=new k);})();
//# sourceMappingURL=flutter.js.map

if (!window._flutter) {
  window._flutter = {};
}
_flutter.buildConfig = {"engineRevision":"cf636b1dfb818dd6a3ff16e390e93b1a036969c8","wasmHashes":{"skwasm.wasm":"e540fd5e8303b7b68ec2718cb49e9c421f8ade3075b15e02a7059a62654df9a1","canvaskit.wasm":"fbed517a43e82452404446683f00f2e876d835aed84410695759e67b6bb01cd3","wimp.wasm":"e924eaafd801d41e017d178f3fd5cf8a417f641fe35c9ed34a4e1d7582283e0c","skwasm_heavy.wasm":"565f5cc1cca6ab120f11934b105f01fec4b58b480c82e0889dca93af8e6f8635","chromium/canvaskit.wasm":"ae8ff1d858140f7b1300ced3fa89fb8c9dce0a400a0f4f1e11f6dcfb3315fdcf","webparagraph/canvaskit.wasm":"0ce1b05082efdc8529550e8a01f6ff0593972d55525035010e26f5600aa9f254"},"builds":[{"compileTarget":"dart2js","renderer":"canvaskit","mainJsPath":"main.dart.js"},{}]};


// 9) Flutter loader initialization from the versioned build directory.
_flutter.loader.load({
  config: ENGINE_CONFIG,
  onEntrypointLoaded: async function (engineInitializer) {
    switchToApplicationPhase(82, 'Initializing application…');
    setStagePct(82);
    const appRunner = await engineInitializer.initializeEngine(ENGINE_CONFIG);
    stopAppPhaseTimer();
    setPct(94);
    setStagePct(92);
    setSub('Starting application…');
    await appRunner.runApp();
    setPct(98);
    setStagePct(97);
  },
});
