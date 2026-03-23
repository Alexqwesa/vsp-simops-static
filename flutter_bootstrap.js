/* ========= Flutter CanvasKit bootstrap (iframe-aware + progress + compressed sizes) ========= */

// 0) Detect iframe
const inIframe = (() => {
try { return window.self !== window.top; } catch (_) { return true; }
})();

// 1) Choose CanvasKit base
//    - Inside iframe: use basic (/canvaskit/) to avoid isolation dependencies
//    - Top-level:     use chromium (/canvaskit/chromium/)
const CK_BASE = inIframe ? '/canvaskit/' : '/canvaskit/chromium/';

// 2) Tell Flutter how to load CanvasKit (must be BEFORE flutter.js)
window.flutterConfiguration = Object.assign({}, window.flutterConfiguration, {
renderer: 'canvaskit',
canvasKitBaseUrl: CK_BASE,
canvasKitVariant: inIframe ? 'full' : 'chromium' // hint to loader to not probe both
});

  console.log('[Flutter config]', window.flutterConfiguration);

// ── Insert overlay (CSS + HTML) safely
function ensureOverlay() {
  if (!document.getElementById('ck-preloader-style')) {
    var style = document.createElement('style');
    style.id = 'ck-preloader-style';
    style.textContent =
      '#ck-preloader{position:fixed;inset:0;background:#0b0b0f;color:#eee;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;font:14px system-ui,-apple-system,Segoe UI,Roboto,Arial}' +
      '.loader-container{display:flex;align-items:center;justify-content:center;margin-bottom:20px;gap:8px}' +
      '.bracket{font-size:24px;color:#4da3ff;animation:pulse 1.5s infinite}' +
      '.kt-text{font-size:18px;color:#eee}' +
      '@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}' +
      '#ck-title{margin-bottom:12px;opacity:.9}' +
      '#ck-bar{width:min(420px,80vw);height:8px;background:#222;border-radius:999px;overflow:hidden;box-shadow:inset 0 0 0 1px #333}' +
      '#ck-fill{height:100%;width:0%;background:#4da3ff;transition:width .15s linear}' +
      '#ck-sub{margin-top:10px;font-size:12px;color:#aaa}' +
      '.ck-hide{opacity:0;pointer-events:none;transition:opacity 0.5s ease-out}';
    document.head.appendChild(style);
  }
  if (!document.getElementById('ck-preloader')) {
    var div = document.createElement('div');
    div.id = 'ck-preloader';
    div.innerHTML =
      '<div class="loader-container">' +
      '    <span class="bracket left">{</span>' +
      '    <span class="kt-text">SIMOPS</span>' +
      '    <span class="bracket right">}</span>' +
      '</div>' +
      '<div id="ck-title">Installing…</div>' +
      '<div id="ck-bar"><div id="ck-fill"></div></div>' +
      '<div id="ck-sub">Initializing CanvasKit</div>';

    // Ensure body exists before appending
    if (document.body) {
      document.body.appendChild(div);
    } else {
      document.addEventListener('DOMContentLoaded', function() {
        document.body.appendChild(div);
      }, { once: true });
    }
  }
}
ensureOverlay();

// ── Null-safe helpers (won't crash if nodes missing)
function el(id) { return document.getElementById(id); }
function setSub(txt) { var n = el('ck-sub'); if (n) n.textContent = txt; }
var targetPct = 0, rafId = 0;

function setPct(p) {
  targetPct = Math.max(0, Math.min(100, p|0));
  if (!rafId) rafId = requestAnimationFrame(step);
}

function step() {
  var fill = el('ck-fill');
  if (!fill) { rafId = 0; return; }
  var current = parseFloat(fill.style.width || '0');
  var next = current + Math.max(0.5, (targetPct - current) * 0.2);
  if (next >= targetPct - 0.1) next = targetPct;
  fill.style.width = next + '%';
  if (next < targetPct) {
    rafId = requestAnimationFrame(step);
  } else {
    rafId = 0;
  }
}

setSub('Preparing renderer…');
setPct(8);

// 5) Human-readable bytes (keeps at most 1 decimal, trims trailing zeros)
// Format bytes to human readable format
function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = bytes / Math.pow(k, i);

  // Keep at most `dm` decimals, then strip trailing zeros / trailing ".0"
  let s = val.toFixed(dm);
  if (dm > 0) {
    s = s.replace(/(\.\d*[1-9])0+$/, '$1').replace(/\.0+$/, '');
  }

  return s + ' ' + sizes[i];
}

// 6) Intercept fetch for CanvasKit WASM, show progress.
//    Works for both compressed and uncompressed responses:
//    - If Content-Encoding present, Content-Length is compressed size.
//    - We label accordingly so % matches actual transferred bytes.
var origFetch = window.fetch;
var WASM_FALLBACK = 6.5 * 1024 * 1024; // used if server provides no length

window.fetch = async function(input, init) {
var url = (typeof input === 'string') ? input : (input && input.url);
//var isWasm = url && url.indexOf(CK_BASE) === 0 && /\/canvaskit\.wasm(?:$|\?)/.test(url);
var isWasm =  /\/canvaskit\.wasm(?:$|\?)/.test(url);

if (!isWasm) return origFetch(input, init);

try {
  setSub('Downloading CanvasKit…');
  setPct(12);

  var resp = await origFetch(input, init);
  if (!resp.ok) return resp;

  var encoding = (resp.headers.get('content-encoding') || '').toLowerCase();
  var lenHeader = resp.headers.get('content-length');
  var total = lenHeader ? parseInt(lenHeader, 10) : WASM_FALLBACK;
  var compressed = /gzip|br|zstd/.test(encoding);
  var totalLabel = formatBytes(total) + ' network transfer ' + (compressed ? ' (compressed)' : '');

  setSub('Downloading CanvasKit… (0 / ' + totalLabel + ')');

  // If streaming supported, track progressive download
  if (resp.body && resp.body.getReader) {
    var reader = resp.body.getReader();
    var loaded = 0;

    var stream = new ReadableStream({
      start(controller) {
        function pump() {
          reader.read().then(({ done, value }) => {
            if (done) {
              setPct(95);
              setSub('Download complete');
              controller.close();
              return;
            }
            loaded += value.byteLength;
            var pct = 12 + Math.min(80, (loaded / total) * 80);
            setPct(pct);
            setSub('Downloading CanvasKit… (' + formatBytes(loaded) + ' / ' + totalLabel + ')');
            controller.enqueue(value);
            pump();
          }).catch(err => controller.error(err));
        }
        pump();
      }
    });

    return new Response(stream, {
      headers: resp.headers,
      status: resp.status,
      statusText: resp.statusText
    });
  } else {
    // No streaming: best-effort messaging
    setPct(60);
    setSub('Downloading CanvasKit… (processing)');
    return resp;
  }
} catch (e) {
  // One retry fallback
  setSub('Retrying download…');
  setPct(40);
  return origFetch(input, init);
}
};

// 7) Hide overlay when Flutter paints first frame
window.addEventListener('flutter-first-frame', function() {
  setSub('Launching…');
  setPct(100);
  var root = el('ck-preloader');
  if (root) {
    root.classList.add('ck-hide');
    // Remove from DOM after transition
    setTimeout(function() {
      if (root.parentNode) {
        root.parentNode.removeChild(root);
      }
    }, 500);
  }
});

// 8) Preload the chosen variant only (prevents double downloads)
(function preloadChosenVariant() {
var head = document.head || document.getElementsByTagName('head')[0];
if (!head) return;
var js = document.createElement('link');
js.rel = 'preload';
js.as = 'script';
js.href = CK_BASE + 'canvaskit.js';
js.crossOrigin = 'anonymous';
head.appendChild(js);

var wasm = document.createElement('link');
wasm.rel = 'preload';
wasm.as = 'fetch';
wasm.type = 'application/wasm';
wasm.href = CK_BASE + 'canvaskit.wasm';
wasm.crossOrigin = 'anonymous';
head.appendChild(wasm);
})();

(()=>{var _={blink:!0,gecko:!1,webkit:!1,unknown:!1},K=()=>navigator.vendor==="Google Inc."||navigator.userAgent.includes("Edg/")?"blink":navigator.vendor==="Apple Computer, Inc."?"webkit":navigator.vendor===""&&navigator.userAgent.includes("Firefox")?"gecko":"unknown",C=K(),R=()=>typeof ImageDecoder>"u"?!1:C==="blink",B=()=>typeof Intl.v8BreakIterator<"u"&&typeof Intl.Segmenter<"u",z=()=>{let i=[0,97,115,109,1,0,0,0,1,5,1,95,1,120,0];return WebAssembly.validate(new Uint8Array(i))},M=()=>{let i=document.createElement("canvas");return i.width=1,i.height=1,i.getContext("webgl2")!=null?2:i.getContext("webgl")!=null?1:-1},D=()=>window.chrome&&chrome.runtime&&chrome.runtime.id,w={browserEngine:C,hasImageCodecs:R(),hasChromiumBreakIterators:B(),supportsWasmGC:z(),crossOriginIsolated:window.crossOriginIsolated,webGLVersion:M(),isChromeExtension:D()};function c(...i){return new URL(I(...i),document.baseURI).toString()}function I(...i){return i.filter(e=>!!e).map((e,n)=>n===0?S(e):F(S(e))).filter(e=>e.length).join("/")}function F(i){let e=0;for(;e<i.length&&i.charAt(e)==="/";)e++;return i.substring(e)}function S(i){let e=i.length;for(;e>0&&i.charAt(e-1)==="/";)e--;return i.substring(0,e)}function E(i,e){return i.canvasKitBaseUrl?i.canvasKitBaseUrl:e.engineRevision&&!e.useLocalCanvasKit?I("https://www.gstatic.com/flutter-canvaskit",e.engineRevision):"canvaskit"}var v=class{constructor(){this._scriptLoaded=!1}setTrustedTypesPolicy(e){this._ttPolicy=e}async loadEntrypoint(e){let{entrypointUrl:n=c("main.dart.js"),onEntrypointLoaded:t,nonce:r}=e||{};return this._loadJSEntrypoint(n,t,r)}async load(e,n,t,r,a){a??=l=>{l.initializeEngine(t).then(u=>u.runApp())};let{entrypointBaseUrl:s}=t,{entryPointBaseUrl:o}=t;if(!s&&o&&(console.warn("[deprecated] `entryPointBaseUrl` is deprecated and will be removed in a future release. Use `entrypointBaseUrl` instead."),s=o),e.compileTarget==="dart2wasm")return this._loadWasmEntrypoint(e,n,s,a);{let l=e.mainJsPath??"main.dart.js",u=c(s,l);return this._loadJSEntrypoint(u,a,r)}}didCreateEngineInitializer(e){typeof this._didCreateEngineInitializerResolve=="function"&&(this._didCreateEngineInitializerResolve(e),this._didCreateEngineInitializerResolve=null,delete _flutter.loader.didCreateEngineInitializer),typeof this._onEntrypointLoaded=="function"&&this._onEntrypointLoaded(e)}_loadJSEntrypoint(e,n,t){let r=typeof n=="function";if(!this._scriptLoaded){this._scriptLoaded=!0;let a=this._createScriptTag(e,t);if(r)console.debug("Injecting <script> tag. Using callback."),this._onEntrypointLoaded=n,document.head.append(a);else return new Promise((s,o)=>{console.debug("Injecting <script> tag. Using Promises. Use the callback approach instead!"),this._didCreateEngineInitializerResolve=s,a.addEventListener("error",o),document.head.append(a)})}}async _loadWasmEntrypoint(e,n,t,r){if(!this._scriptLoaded){this._scriptLoaded=!0,this._onEntrypointLoaded=r;let{mainWasmPath:a,jsSupportRuntimePath:s}=e,o=c(t,a),l=c(t,s);this._ttPolicy!=null&&(l=this._ttPolicy.createScriptURL(l));let d=(await import(l)).compileStreaming(fetch(o)),p;e.renderer==="skwasm"?p=(async()=>{let h=await n.skwasm;return window._flutter_skwasmInstance=h,{skwasm:h.wasmExports,skwasmWrapper:h,ffi:{memory:h.wasmMemory}}})():p=Promise.resolve({}),await(await(await d).instantiate(await p,{loadDynamicModule:async(h,j)=>{let A=fetch(c(t,h)),L=c(t,j);this._ttPolicy!=null&&(L=this._ttPolicy.createScriptURL(L));let x=import(L);return[await A,await x]}})).invokeMain()}}_createScriptTag(e,n){let t=document.createElement("script");t.type="application/javascript",n&&(t.nonce=n);let r=e;return this._ttPolicy!=null&&(r=this._ttPolicy.createScriptURL(e)),t.src=r,t}};async function T(i,e,n){if(e<0)return i;let t,r=new Promise((a,s)=>{t=setTimeout(()=>{s(new Error(`${n} took more than ${e}ms to resolve. Moving on.`,{cause:T}))},e)});return Promise.race([i,r]).finally(()=>{clearTimeout(t)})}var g=class{setTrustedTypesPolicy(e){this._ttPolicy=e}loadServiceWorker(e){if(!e||!("serviceWorker"in navigator))return Promise.resolve();let n=()=>{console.warn(`Loading the service worker using Flutter bootstrap is deprecated and will stop working in a future release.
For more details, see: https://github.com/flutter/flutter/issues/156910`)},t=()=>{let{serviceWorkerVersion:r,serviceWorkerUrl:a=c(`flutter_service_worker.js?v=${r}`),timeoutMillis:s=4e3}=e,o=a;this._ttPolicy!=null&&(o=this._ttPolicy.createScriptURL(o));let l=navigator.serviceWorker.register(o).then(u=>this._getNewServiceWorker(u,r)).then(this._waitForServiceWorkerActivation);return T(l,s,"prepareServiceWorker")};return e.serviceWorkerUrl!=null?(n(),t()):navigator.serviceWorker.getRegistration().then(r=>r?t():Promise.resolve())}async _getNewServiceWorker(e,n){if(!e.active&&(e.installing||e.waiting))return console.debug("Installing/Activating first service worker."),e.installing||e.waiting;if(e.active.scriptURL.endsWith(n))return console.debug("Loading from existing service worker."),e.active;{let t=await e.update();return console.debug("Updating service worker."),t.installing||t.waiting||t.active}}async _waitForServiceWorkerActivation(e){if(!e||e.state==="activated")if(e){console.debug("Service worker already active.");return}else throw new Error("Cannot activate a null service worker!");return new Promise((n,t)=>{e.addEventListener("statechange",()=>{e.state==="activated"&&(console.debug("Activated new service worker."),n())})})}};var y=class{constructor(e,n="flutter-js"){let t=e||[/\.js$/,/\.mjs$/];window.trustedTypes&&(this.policy=trustedTypes.createPolicy(n,{createScriptURL:function(r){if(r.startsWith("blob:"))return r;let a=new URL(r,window.location),s=a.pathname.split("/").pop();if(t.some(l=>l.test(s)))return a.toString();console.error("URL rejected by TrustedTypes policy",n,":",r,"(download prevented)")}}))}};var k=i=>{let e=WebAssembly.compileStreaming(fetch(i));return(n,t)=>((async()=>{let r=await e,a=await WebAssembly.instantiate(r,n);t(a,r)})(),{})};var U=(i,e,n,t)=>(window.flutterCanvasKitLoaded=(async()=>{if(window.flutterCanvasKit)return window.flutterCanvasKit;let r=n.hasChromiumBreakIterators&&n.hasImageCodecs;if(!r&&e.canvasKitVariant=="chromium")throw"Chromium CanvasKit variant specifically requested, but unsupported in this browser";let a=r&&e.canvasKitVariant!=="full",s=t;e.canvasKitVariant=="experimentalWebParagraph"?s=c(s,"experimental_webparagraph"):a&&(s=c(s,"chromium"));let o=c(s,"canvaskit.js");i.flutterTT.policy&&(o=i.flutterTT.policy.createScriptURL(o));let l=k(c(s,"canvaskit.wasm")),u=await import(o);return window.flutterCanvasKit=await u.default({instantiateWasm:l}),window.flutterCanvasKit})(),window.flutterCanvasKitLoaded);var W=async(i,e,n,t)=>{let a=!n.hasImageCodecs||!n.hasChromiumBreakIterators?"skwasm_heavy":e.enableWimp?"wimp":"skwasm",s=c(t,`${a}.js`),o=s;i.flutterTT.policy&&(o=i.flutterTT.policy.createScriptURL(o));let l=k(c(t,`${a}.wasm`));return await(await import(o)).default({skwasmSingleThreaded:e.enableWimp||!n.crossOriginIsolated||n.isChromeExtension||e.forceSingleThreadedSkwasm,instantiateWasm:l,locateFile:(d,p)=>d.endsWith(".ww.js")?URL.createObjectURL(new Blob([`
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
`],{type:"application/javascript"})):c(t,d),mainScriptUrlOrBlob:s})};var P=w.supportsWasmGC,G=P&&w.webGLVersion>0,b=class{async loadEntrypoint(e){let{serviceWorker:n,...t}=e||{},r=new y,a=new g;a.setTrustedTypesPolicy(r.policy),await a.loadServiceWorker(n).catch(o=>{console.warn("Exception while loading service worker:",o)});let s=new v;return s.setTrustedTypesPolicy(r.policy),this.didCreateEngineInitializer=s.didCreateEngineInitializer.bind(s),s.loadEntrypoint(t)}async load({serviceWorkerSettings:e,onEntrypointLoaded:n,nonce:t,config:r}={}){r??={};let a=_flutter.buildConfig;if(!a)throw"FlutterLoader.load requires _flutter.buildConfig to be set";let s=r.wasmAllowList?.[w.browserEngine]??_[w.browserEngine],o=m=>{switch(m){case"skwasm":return G&&s;default:return!0}},l=m=>m.compileTarget==="dart2wasm"&&!P||r.renderer&&r.renderer!=m.renderer?!1:o(m.renderer),u=a.builds.find(l);if(!u)throw"FlutterLoader could not find a build compatible with configuration and environment.";let d={};d.flutterTT=new y,e&&(d.serviceWorkerLoader=new g,d.serviceWorkerLoader.setTrustedTypesPolicy(d.flutterTT.policy),await d.serviceWorkerLoader.loadServiceWorker(e).catch(m=>{console.warn("Exception while loading service worker:",m)}));let p=E(r,a);u.renderer==="canvaskit"?d.canvasKit=U(d,r,w,p):u.renderer==="skwasm"&&(d.skwasm=W(d,r,w,p));let f=new v;return f.setTrustedTypesPolicy(d.flutterTT.policy),this.didCreateEngineInitializer=f.didCreateEngineInitializer.bind(f),f.load(u,d,r,t,n)}};window._flutter||(window._flutter={});window._flutter.loader||(window._flutter.loader=new b);})();
//# sourceMappingURL=flutter.js.map

if (!window._flutter) {
  window._flutter = {};
}
_flutter.buildConfig = {"engineRevision":"052f31d115eceda8cbff1b3481fcde4330c4ae12","builds":[{"compileTarget":"dart2js","renderer":"canvaskit","mainJsPath":"main.dart.js"},{}]};


// Flutter loader initialization
_flutter.loader.load({
  onEntrypointLoaded: async function(engineInitializer) {
    const appRunner = await engineInitializer.initializeEngine();
    await appRunner.runApp();
  }
});