/**
 * The public viewer page — server-rendered HTML with everything inline, so the
 * only public surface besides /api/view/* is this one GET. The dashboard SPA
 * stays behind the platform perimeter.
 *
 * The page is a small state machine: gate form → dataroom index → document
 * viewer. Reading time is measured per visible page and beaconed back; the
 * timer pauses while the tab is hidden so "10 minutes on page 3" means someone
 * actually looked at page 3 for 10 minutes.
 */

export interface ViewerConfig {
  linkId: string;
  kind: "document" | "dataroom";
  /** Document or data room display name. */
  name: string;
  requireEmail: boolean;
  hasPasscode: boolean;
  /** Non-empty = the gate shows this text with a required accept checkbox. */
  agreementText: string;
  brand: { companyName: string; accentColor: string; hasLogo: boolean };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Hex color guard — anything else falls back to ink so HTML can't be injected via settings. */
const safeColor = (c: string) => (/^#[0-9a-fA-F]{3,8}$/.test(c) ? c : "#1A202C");

const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const BASE_CSS = `
  :root {
    --background: #ffffff; --surface: #ffffff; --sunken: #f1f5f9;
    --foreground: #1a202c; --muted: #475569; --faint: #94a3b8;
    --border: #e2e8f0; --ring: #2563eb; --danger: #b91c1c; --danger-tint: #fef2f2;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: #0d1117; --surface: #161b22; --sunken: #1c2128;
      --foreground: #e6edf3; --muted: #9ba7b3; --faint: #6e7681;
      --border: #30363d; --ring: #4493f8; --danger: #f85149; --danger-tint: #2d1518;
    }
  }
  * { box-sizing: border-box; }
  html { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
  body {
    margin: 0; background: var(--background); color: var(--foreground);
    font-size: 0.875rem; line-height: 1.5; -webkit-font-smoothing: antialiased;
    min-height: 100dvh;
  }
  :focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  button { font: inherit; cursor: pointer; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 0.375rem;
    height: 2.25rem; padding: 0 0.75rem; border-radius: 0.25rem; border: 1px solid var(--border);
    background: var(--surface); color: var(--foreground); font-weight: 500; font-size: 0.875rem;
    transition: background-color 0.15s ease, border-color 0.15s ease;
  }
  .btn:hover { background: var(--sunken); }
  .btn-accent { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .btn-accent:hover { filter: brightness(0.92); }
  .btn[disabled] { opacity: 0.5; pointer-events: none; }
`;

export function unavailablePage(message: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Link unavailable</title>
<style>${BASE_CSS}</style>
</head><body>
<main style="display:flex;min-height:100dvh;align-items:center;justify-content:center;padding:1.5rem">
  <div style="text-align:center;max-width:24rem">
    <p style="font-size:1rem;font-weight:600;margin:0 0 0.5rem">${esc(message)}</p>
    <p style="color:var(--muted);margin:0">Ask the person who sent you this link for a new one.</p>
  </div>
</main>
</body></html>`;
}

export function viewerPage(cfg: ViewerConfig): string {
  const accent = safeColor(cfg.brand.accentColor || "#1A202C");
  const config = JSON.stringify({
    linkId: cfg.linkId,
    kind: cfg.kind,
    name: cfg.name,
    requireEmail: cfg.requireEmail,
    hasPasscode: cfg.hasPasscode,
    agreementText: cfg.agreementText,
    companyName: cfg.brand.companyName,
    hasLogo: cfg.brand.hasLogo,
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(cfg.name)}${cfg.brand.companyName ? " · " + esc(cfg.brand.companyName) : ""}</title>
<style>
${BASE_CSS}
  :root { --accent: ${accent}; --on-accent: #ffffff; }

  header {
    position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 0.75rem;
    height: 3.5rem; padding: 0 1.25rem; background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  header .brand { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
  header .brand img { height: 1.5rem; width: auto; display: block; }
  header .brand .name { font-weight: 600; white-space: nowrap; }
  header .doc {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--muted); border-left: 1px solid var(--border); padding-left: 0.75rem;
  }
  header .spacer { flex: 1; }
  header .pageno { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }

  .gate-wrap { display: flex; min-height: calc(100dvh - 3.5rem); align-items: center; justify-content: center; padding: 1.5rem; }
  .gate {
    width: 100%; max-width: 22rem; border: 1px solid var(--border); border-radius: 0.5rem;
    background: var(--surface); overflow: hidden;
  }
  .gate .accent-bar { height: 4px; background: var(--accent); }
  .gate .zone { padding: 1.25rem; }
  .gate .zone + .zone { border-top: 1px solid var(--border); }
  .gate h1 { font-size: 1rem; margin: 0 0 0.25rem; }
  .gate p.sub { margin: 0; color: var(--muted); font-size: 0.8125rem; }
  .gate label { display: block; margin-bottom: 0.75rem; }
  .gate label span {
    display: block; margin-bottom: 0.25rem; font-size: 0.75rem; font-weight: 600;
    letter-spacing: 0.04em; color: var(--muted);
  }
  .gate input {
    width: 100%; height: 2.25rem; padding: 0 0.625rem; border-radius: 0.25rem;
    border: 1px solid var(--border); background: var(--surface); color: var(--foreground);
    font-size: 1rem;
  }
  @media (min-width: 640px) { .gate input { font-size: 0.8125rem; } }
  .gate input::placeholder { color: var(--faint); }
  .gate input:focus { border-color: var(--ring); outline: none; }
  .gate .error {
    margin: 0 0 0.75rem; padding: 0.5rem 0.625rem; border-radius: 0.25rem;
    background: var(--danger-tint); color: var(--danger); font-size: 0.8125rem;
  }
  .gate .error:empty { display: none; }
  .gate .agreement {
    margin-bottom: 0.75rem; max-height: 10rem; overflow-y: auto;
    border: 1px solid var(--border); border-radius: 0.25rem; background: var(--sunken);
    padding: 0.625rem; font-size: 0.75rem; color: var(--muted); white-space: pre-wrap;
  }
  .gate .agree-row {
    display: flex; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.75rem;
    cursor: pointer;
  }
  /* The generic .gate input sizing is for text fields — undo it here. */
  .gate .agree-row input {
    width: 1rem; height: 1rem; margin: 0.125rem 0 0; flex: none;
    accent-color: var(--accent);
  }
  .gate .agree-row span {
    font-size: 0.8125rem; font-weight: 400; letter-spacing: normal;
    color: var(--foreground); margin: 0;
  }

  .index { max-width: 46rem; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
  .index .hero {
    border-radius: 0.5rem; background: var(--accent); color: var(--on-accent);
    padding: 1.75rem 1.5rem; margin-bottom: 1.5rem;
  }
  .index .hero .co { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.8; }
  .index .hero h1 { margin: 0.25rem 0 0; font-size: 1.5rem; letter-spacing: -0.01em; }
  .index .crumb { margin: 0 0 0.75rem; color: var(--muted); font-size: 0.8125rem; }
  .index .crumb button { border: 0; background: none; padding: 0; color: var(--foreground); text-decoration: underline; text-decoration-color: var(--border); text-underline-offset: 2px; }
  .index .crumb button:hover { text-decoration-color: var(--foreground); }
  .entry {
    display: flex; width: 100%; align-items: center; gap: 0.75rem; text-align: left;
    border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface);
    padding: 0.875rem 1rem; margin-bottom: 0.5rem; color: var(--foreground);
    transition: background-color 0.15s ease;
  }
  .entry:hover { background: var(--sunken); }
  .entry svg { flex: none; color: var(--muted); }
  .entry .t { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entry .m { margin-left: auto; color: var(--faint); font-size: 0.75rem; font-variant-numeric: tabular-nums; white-space: nowrap; }

  .stage { display: flex; flex-direction: column; align-items: center; padding: 1.25rem 1rem 4.5rem; }
  .stage canvas {
    max-width: 100%; height: auto; border: 1px solid var(--border); border-radius: 0.25rem;
    background: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.06);
  }
  .pager {
    position: fixed; bottom: 1rem; left: 50%; transform: translateX(-50%); z-index: 10;
    display: flex; align-items: center; gap: 0.25rem; padding: 0.25rem;
    border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface);
    box-shadow: 0 4px 12px rgba(0,0,0,0.12);
  }
  .pager .btn { border: 0; height: 2rem; }
  .pager .pageno { padding: 0 0.5rem; color: var(--muted); font-variant-numeric: tabular-nums; font-size: 0.8125rem; }
  .hidden { display: none !important; }
  .center { display: flex; min-height: 40dvh; align-items: center; justify-content: center; color: var(--muted); }
</style>
</head><body>
<header>
  <div class="brand" id="brand"></div>
  <div class="doc" id="header-doc"></div>
  <span class="spacer"></span>
  <span class="pageno" id="header-page"></span>
  <button class="btn hidden" id="download-btn" type="button">Download</button>
</header>
<div id="app"></div>

<script id="cfg" type="application/json">${config}</script>
<script type="module">
const CFG = JSON.parse(document.getElementById("cfg").textContent);
const API = (p) => "/api/view/" + CFG.linkId + p;
const app = document.getElementById("app");

const FOLDER_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
const FILE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>';

// ── Branded header ───────────────────────────────────────────────────
{
  const brand = document.getElementById("brand");
  if (CFG.hasLogo) {
    const img = document.createElement("img");
    img.src = API("/logo");
    img.alt = CFG.companyName || "Logo";
    brand.appendChild(img);
  }
  if (CFG.companyName || !CFG.hasLogo) {
    const span = document.createElement("span");
    span.className = "name";
    span.textContent = CFG.companyName || CFG.name;
    brand.appendChild(span);
  }
}

// ── State ────────────────────────────────────────────────────────────
let session = null;   // { visit_id, allow_download, documents, folders }
let pdfjs = null;

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ── Gate ─────────────────────────────────────────────────────────────
function renderGate() {
  const emailField = CFG.requireEmail
    ? '<label><span>Email</span><input id="g-email" type="email" name="email" autocomplete="email" placeholder="name@example.com" required></label>'
    : "";
  const passField = CFG.hasPasscode
    ? '<label><span>Passcode</span><input id="g-pass" type="password" name="passcode" autocomplete="one-time-code" placeholder="Passcode" required></label>'
    : "";
  const agreement = CFG.agreementText
    ? '<div class="agreement" id="g-agreement-text"></div>' +
      '<label class="agree-row"><input id="g-agree" type="checkbox" required><span>I have read and accept the agreement above.</span></label>'
    : "";
  app.innerHTML = "";
  const node = el(\`
    <div class="gate-wrap"><form class="gate" novalidate>
      <div class="accent-bar"></div>
      <div class="zone">
        <h1></h1>
        <p class="sub">\${CFG.kind === "dataroom" ? "You have been invited to this data room." : "You have been invited to view this document."}</p>
      </div>
      <div class="zone">
        <p class="error" id="g-error" role="alert"></p>
        \${emailField}\${passField}\${agreement}
        <button class="btn btn-accent" style="width:100%" type="submit">Continue</button>
      </div>
    </form></div>\`);
  node.querySelector("h1").textContent = CFG.name;
  if (CFG.agreementText) node.querySelector("#g-agreement-text").textContent = CFG.agreementText;
  node.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = node.querySelector("button[type=submit]");
    const err = node.querySelector("#g-error");
    btn.disabled = true;
    err.textContent = "";
    try {
      const res = await fetch(API("/session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: node.querySelector("#g-email")?.value ?? "",
          passcode: node.querySelector("#g-pass")?.value ?? "",
          agreed: node.querySelector("#g-agree")?.checked ?? false,
        }),
      });
      const data = await res.json();
      if (!res.ok) { err.textContent = data.error || "Unable to open this link. Try again."; return; }
      session = data;
      if (CFG.kind === "document") openDocument(data.documents[0]);
      else renderIndex(null);
    } catch {
      err.textContent = "Unable to open this link. Check your connection and try again.";
    } finally {
      btn.disabled = false;
    }
  });
  app.appendChild(node);
  if (!CFG.requireEmail && !CFG.hasPasscode && !CFG.agreementText) {
    node.querySelector("form").requestSubmit();
    node.classList.add("hidden");
  }
}

// ── Data room index ──────────────────────────────────────────────────
function renderIndex(folderId) {
  stopTimer();
  document.getElementById("header-doc").textContent = CFG.name;
  document.getElementById("header-page").textContent = "";
  document.getElementById("download-btn").classList.add("hidden");
  app.innerHTML = "";
  const wrap = el('<div class="index"></div>');

  const folder = folderId ? session.folders.find((f) => f.id === folderId) : null;
  if (!folder) {
    const hero = el('<div class="hero"><div class="co"></div><h1></h1></div>');
    hero.querySelector(".co").textContent = CFG.companyName;
    hero.querySelector("h1").textContent = CFG.name;
    wrap.appendChild(hero);
  } else {
    const crumb = el('<p class="crumb"><button type="button"></button> / <span></span></p>');
    crumb.querySelector("button").textContent = CFG.name;
    crumb.querySelector("button").addEventListener("click", () => renderIndex(null));
    crumb.querySelector("span").textContent = folder.name;
    wrap.appendChild(crumb);
  }

  if (!folder) {
    for (const f of session.folders) {
      const count = session.documents.filter((d) => d.folder_id === f.id).length;
      const row = el(\`<button class="entry" type="button">\${FOLDER_SVG}<span class="t"></span><span class="m"></span></button>\`);
      row.querySelector(".t").textContent = f.name;
      row.querySelector(".m").textContent = count + (count === 1 ? " document" : " documents");
      row.addEventListener("click", () => renderIndex(f.id));
      wrap.appendChild(row);
    }
  }
  const docs = session.documents.filter((d) => (folder ? d.folder_id === folder.id : !d.folder_id));
  for (const d of docs) {
    const row = el(\`<button class="entry" type="button">\${FILE_SVG}<span class="t"></span><span class="m"></span></button>\`);
    row.querySelector(".t").textContent = d.name;
    row.querySelector(".m").textContent = d.page_count + (d.page_count === 1 ? " page" : " pages");
    row.addEventListener("click", () => openDocument(d, folderId));
    wrap.appendChild(row);
  }
  if (!session.folders.length && !docs.length) {
    wrap.appendChild(el('<div class="center">This data room is empty.</div>'));
  }
  app.appendChild(wrap);
}

// ── Document viewer + per-page timer ─────────────────────────────────
let view = null; // { view_id, doc, pdf, page, canvas, backTo }
let pageShownAt = 0;
let pending = {};      // page → unsent seconds
let flushTimer = null;

function noteTime() {
  // No document.hidden guard here: visibilitychange fires AFTER hidden flips,
  // and the flush on hide must still capture the chunk read before hiding.
  // The hide handler zeroes pageShownAt, which is what pauses accumulation.
  if (!view || !pageShownAt) return;
  const now = performance.now();
  const secs = (now - pageShownAt) / 1000;
  pageShownAt = now;
  if (secs > 0 && secs < 3600) pending[view.page] = (pending[view.page] || 0) + secs;
}

function flush(useBeacon) {
  noteTime();
  const pages = Object.entries(pending).map(([page, seconds]) => ({ page: +page, seconds }));
  if (!view || !pages.length) return;
  pending = {};
  const body = JSON.stringify({ view_id: view.view_id, pages });
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon(API("/beat"), new Blob([body], { type: "application/json" }));
  } else {
    fetch(API("/beat"), { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  }
}

function stopTimer() {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  flush(false);
  view = null;
  pageShownAt = 0;
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) { flush(true); pageShownAt = 0; }
  else if (view) pageShownAt = performance.now();
});
addEventListener("pagehide", () => flush(true));

async function openDocument(doc, backToFolder) {
  stopTimer();
  app.innerHTML = '<div class="center">Loading…</div>';
  try {
    const res = await fetch(API("/open"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visit_id: session.visit_id, document_id: doc.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "open failed");

    if (!pdfjs) {
      pdfjs = await import(${JSON.stringify(PDFJS)});
      pdfjs.GlobalWorkerOptions.workerSrc = ${JSON.stringify(PDFJS_WORKER)};
    }
    const pdf = await pdfjs.getDocument({ url: API("/file?view_id=" + data.view_id) }).promise;

    document.getElementById("header-doc").textContent = doc.name;
    const dl = document.getElementById("download-btn");
    dl.classList.toggle("hidden", !session.allow_download);
    dl.onclick = () => { location.href = API("/download?view_id=" + data.view_id); };

    app.innerHTML = "";
    const stage = el('<div class="stage"><canvas aria-label="Document page"></canvas></div>');
    const pager = el(\`
      <div class="pager">
        \${CFG.kind === "dataroom" ? '<button class="btn" type="button" id="p-back">Back</button>' : ""}
        <button class="btn" type="button" id="p-prev" aria-label="Previous page">‹</button>
        <span class="pageno" id="p-no"></span>
        <button class="btn" type="button" id="p-next" aria-label="Next page">›</button>
      </div>\`);
    app.appendChild(stage);
    app.appendChild(pager);

    view = { view_id: data.view_id, doc, pdf, page: 1, canvas: stage.querySelector("canvas") };
    pending = {};
    flushTimer = setInterval(() => flush(false), 10000);

    const back = pager.querySelector("#p-back");
    if (back) back.addEventListener("click", () => renderIndex(backToFolder ?? null));
    pager.querySelector("#p-prev").addEventListener("click", () => go(-1));
    pager.querySelector("#p-next").addEventListener("click", () => go(1));
    onkeydown = (e) => {
      if (!view) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight" || e.key === " ") { go(1); e.preventDefault(); }
    };
    await renderPage(1);
  } catch (e) {
    app.innerHTML = '<div class="center">Unable to load the document. Reload the page to try again.</div>';
  }
}

async function go(delta) {
  if (!view) return;
  const next = view.page + delta;
  if (next < 1 || next > view.pdf.numPages) return;
  noteTime();
  await renderPage(next);
}

// Diagonal tiled watermark drawn over the rendered page. A deterrent that ties
// a screenshot to the viewer's email — not DRM (the client renders the page).
function drawWatermark(canvas, text) {
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = "#1a202c";
  ctx.font = Math.round(canvas.width / 32) + "px sans-serif";
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(-Math.PI / 6);
  ctx.textAlign = "center";
  const stepY = canvas.height / 5;
  const stepX = Math.max(ctx.measureText(text).width * 1.6, canvas.width / 3);
  for (let y = -canvas.height; y <= canvas.height; y += stepY) {
    for (let x = -canvas.width; x <= canvas.width; x += stepX) {
      ctx.fillText(text, x, y);
    }
  }
  ctx.restore();
}

async function renderPage(no) {
  view.page = no;
  const page = await view.pdf.getPage(no);
  const scale = Math.min(2, (Math.min(innerWidth - 32, 900)) / page.getViewport({ scale: 1 }).width);
  const viewport = page.getViewport({ scale: scale * devicePixelRatio });
  view.canvas.width = viewport.width;
  view.canvas.height = viewport.height;
  view.canvas.style.width = viewport.width / devicePixelRatio + "px";
  await page.render({ canvasContext: view.canvas.getContext("2d"), viewport }).promise;
  if (session.watermark) drawWatermark(view.canvas, session.watermark);
  const label = no + " / " + view.pdf.numPages;
  document.getElementById("p-no").textContent = label;
  document.getElementById("header-page").textContent = label;
  pageShownAt = performance.now();
}

renderGate();
</script>
</body></html>`;
}
