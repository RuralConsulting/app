// EX1: "Share or save", one quiet control for getting OUT a copy of what the signed-in person is already looking at. The words and
// the rules are share-save-model.js's; this file draws the control, makes the files in the browser and hands them to the device.
//
//   FP.shareSave.set(offer)              the screen's control, in the header beside Add and the account (the same place on every
//                                        screen); shown while the address is the one it was set for, gone when the person moves on
//   FP.shareSave.button(offer, label?)   the same control inside a screen, for a part of it (a water quality site)
//   FP.shareSave.chartImage(block, o)    a chart block (blocks/chart.js) as a PNG, on white, with its key and the lines given
//   FP.shareSave.mapImage(map, o)        a MapLibre map as a PNG: the view, its labels, title, date, scale and the map's credits
//
// offer (or a function returning one, asked each time the sheet opens):
//   { what: "Nitrate · Surface water · 5 sites", files: [{ key, label, hint?, name, type, image?, share?, make() -> Blob | string }],
//     link?: true, print?: () => void, printLabel?, printHint? }
// The sheet lists, as apply on this device: Save (each file), Share… (the first file, to the phone's own share sheet), Copy link (this
// screen's address: it opens only after a sign-in, for people who can already see it) and Print. Every file is made here from what the
// screen already read: nothing is read, sent or stored, and nobody can see anything they could not see before.
(function (root) {
  const FP = root.FP = root.FP || {};
  const M = () => FP.shareSaveModel;
  const el = (...a) => FP.el(...a);
  const doc = root.document;

  // ---- what this device can do --------------------------------------------------------------------------------------------------
  function canvasOk() {
    try { const c = doc.createElement("canvas"); return typeof c.toBlob === "function" && !!c.getContext("2d"); } catch { return false; }
  }
  function can(first) {
    const nav = root.navigator || {};
    let shareFiles = false;
    if (first && typeof nav.share === "function" && typeof nav.canShare === "function" && typeof root.File === "function") {
      try { shareFiles = !!nav.canShare({ files: [new File(["x"], first.name || "file", { type: first.type || "application/octet-stream" })] }); } catch { shareFiles = false; }
    }
    return { share: typeof nav.share === "function", shareFiles, clipboard: typeof nav.clipboard?.writeText === "function", canvas: canvasOk() };
  }

  // ---- saying what happened -----------------------------------------------------------------------------------------------------
  function say(text) {
    let t = doc.querySelector(".toast");
    if (!t) { t = doc.createElement("p"); t.className = "toast"; t.setAttribute("role", "status"); doc.body.append(t); }
    t.textContent = text; t.hidden = false;
    clearTimeout(t._timer); t._timer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  // ---- handing a file to the device ---------------------------------------------------------------------------------------------
  const asBlob = (made, type) => (made instanceof Blob ? made : new Blob([String(made)], { type: type || "text/plain;charset=utf-8" }));
  function save(blob, name) {
    const url = URL.createObjectURL(blob), a = el("a", { href: url, download: name, hidden: true });
    doc.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    say(M().SAID.saved(name));
  }
  async function share(file, title) {
    try { await root.navigator.share({ files: [file], title }); return "shared"; }
    catch (e) { return e?.name === "AbortError" ? "cancelled" : "refused"; }
  }
  async function copyLink() {
    const link = M().linkOf(root.location.href);
    if (!link) return;
    try { await root.navigator.clipboard.writeText(link); say(M().SAID.copied); return; } catch { /* shown to copy by hand */ }
    FP.sheet.open({ title: "Copy link", where: M().LINK_HINT, className: "share-save-link", body: () => {
      const input = el("input", { type: "text", readonly: true, value: link, "aria-label": "Link to this screen", class: "share-save-linkbox" });
      setTimeout(() => { input.focus(); input.select(); }, 0);
      return [input];
    } });
  }

  // ---- the sheet ----------------------------------------------------------------------------------------------------------------
  function open(opener, offerOf) {
    const offer = typeof offerOf === "function" ? offerOf() : offerOf;
    if (!offer) return;
    const toast = doc.querySelector(".toast");
    if (toast) toast.hidden = true;   // the last "Saved …" never covers the sheet
    const files = (offer.files || []).filter(Boolean);
    const caps = can(files[0]);
    const rows = M().items(offer, caps);
    // every file is made as the sheet opens, so Share… hands it over from the tap itself (a phone's share sheet needs the tap)
    const made = new Map(), ready = new Map();
    for (const f of files) {
      if (f.image && !caps.canvas) continue;
      const p = Promise.resolve().then(() => f.make()).then((x) => { const b = asBlob(x, f.type); ready.set(f.key, b); return b; });
      p.catch(() => {});
      made.set(f.key, p);
    }
    const fileOf = (key) => files.find((f) => f.key === key);
    async function run(r) {
      const f = fileOf(r.file);
      if (r.kind === "save") {
        try { save(await made.get(f.key), f.name); } catch { say(f.image ? M().SAID.noImage : M().SAID.failed); }
      } else if (r.kind === "share") {
        const now = ready.get(f.key);
        let blob = now;
        if (!blob) { try { blob = await made.get(f.key); } catch { say(f.image ? M().SAID.noImage : M().SAID.failed); return; } }
        const got = await share(new File([blob], f.name, { type: blob.type || f.type }), offer.what || f.name);
        if (got === "shared") say(M().SAID.shared);
        else if (got === "refused") { if (now) save(blob, f.name); else say(M().SAID.notReady); }   // a device that refuses: the file is saved instead
      } else if (r.kind === "link") copyLink();
      else if (r.kind === "print") offer.print?.();
    }
    const node = FP.sheet.menu(opener, M().LABEL, rows.map((r) => ({ label: r.label, hint: r.hint, icon: r.icon, action: "share-save-" + r.key, run: () => run(r) })), offer.what || "", "share-save-sheet");
    keepInView(node, opener);
    return node;
  }
  // On a computer the sheet hangs under its button; a button low on the screen (a site's, under its chart) has it above instead
  function keepInView(node, opener) {
    const panel = node?.querySelector(".add-panel");
    if (!panel || !opener || !panel.style.top) return;
    const p = panel.getBoundingClientRect(), o = opener.getBoundingClientRect();
    if (p.bottom <= root.innerHeight - 8) return;
    panel.style.top = Math.round(Math.max(8, o.top - p.height - 10)) + "px";
    panel.classList.add("share-save-above");
  }

  // ---- the control ------------------------------------------------------------------------------------------------------------
  function control(offerOf, { label = M().LABEL, inline = false } = {}) {
    const b = el("button", { type: "button", class: inline ? "share-save-inline" : "share-save-btn", "aria-haspopup": "dialog", "aria-expanded": "false", "aria-label": label, title: label },
      FP.icon ? FP.icon("send", inline ? 18 : 20) : null, inline ? el("span", {}, label) : null);
    b.addEventListener("click", () => (FP.sheet.isOpen() && b.getAttribute("aria-expanded") === "true" ? FP.sheet.close() : open(b, typeof b._offer === "function" ? b._offer : offerOf)));
    return b;
  }
  const button = (offerOf, label) => control(offerOf, { label: label || M().LABEL, inline: true });

  // The screen's control in the visible header (a group's or a farm's), before Add; one per header, re-pointed by each screen.
  let current = null;   // { key (the address it was set for), offer }
  function headerHost() {
    return [...doc.querySelectorAll(".space-head .space-actions")].find((n) => n.getClientRects().length) || null;
  }
  function set(offerOf) {
    const host = headerHost();
    if (!host) return null;
    let b = host.querySelector(":scope > .share-save-btn");
    if (!b) { b = control(null); host.insertBefore(b, host.querySelector(".add-slot") || host.firstChild); }
    b._offer = offerOf;
    b.hidden = false;
    for (const other of doc.querySelectorAll(".share-save-btn")) if (other !== b) other.hidden = true;
    current = { key: root.location.hash, button: b };
    return b;
  }
  function clear() {
    current = null;
    for (const b of doc.querySelectorAll(".share-save-btn")) { b.hidden = true; b._offer = null; }
  }
  // (each screen that offers it also clears it as it closes)
  const moved = () => { if (current && root.location.hash !== current.key) clear(); };
  root.addEventListener("hashchange", moved);
  root.addEventListener("popstate", moved);

  // ---- images -----------------------------------------------------------------------------------------------------------------
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // The light-mode tokens (the top-level :root rules) and every rule the chart block draws with, read from the page's own stylesheets,
  // so the image is on white with the same colours as on a light screen, whatever the screen's own theme.
  function chartStyles() {
    const tokens = [], rules = [];
    for (const sheet of doc.styleSheets) {
      let list;
      try { list = sheet.cssRules; } catch { continue; }
      for (const r of list || []) {
        if (r.type !== 1) continue;   // top-level style rules only (no dark-mode media)
        if (r.selectorText === ":root") for (const p of r.style) { if (p.startsWith("--")) tokens.push(p + ":" + r.style.getPropertyValue(p)); }
        else if (/\.chart-/.test(r.selectorText)) rules.push(r.cssText);
      }
    }
    return "svg{" + tokens.join(";") + "}" + rules.join("");
  }
  // A drawn SVG string -> PNG Blob, at twice its size
  function rasterise(svgText, width, height, scale = 2) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }));
      const img = new Image();
      img.onload = () => {
        try {
          const c = doc.createElement("canvas"); c.width = Math.round(width * scale); c.height = Math.round(height * scale);
          const g = c.getContext("2d"); g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          c.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas"))), "image/png");
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image")); };
      img.src = url;
    });
  }
  // A chart block as a PNG: the title, a line under it (o.sub), the plot, its key, the block's own line about bands, then o.foot lines.
  function chartImage(block, { title = null, sub = "", foot = [] } = {}) {
    const svg = block?.querySelector(".chart-plot svg");
    if (!svg) return Promise.reject(new Error("no chart"));
    const W = Math.max(Number(svg.getAttribute("width")) || 560, 480), H = Number(svg.getAttribute("height")) || 300, pad = 20, lineH = 17;
    const chars = Math.floor((W) / 6.6);
    const head = [title || block.querySelector(".block-title")?.textContent || ""].flatMap((t) => M().wrap(t, Math.floor(W / 8.6)));
    const subs = M().wrap(sub, chars);
    const keys = [...block.querySelectorAll(".chart-legend .chart-key")].map((k) => ({ swatch: k.querySelector("svg")?.outerHTML || "", lines: M().wrap(k.querySelector("span")?.textContent || "", chars - 6) }));
    const assess = block.querySelector(".chart-assess")?.textContent || "";
    const feet = [assess, ...foot].filter(Boolean).flatMap((l) => M().wrap(l, chars).concat([""])).slice(0, -1);
    let y = pad + 4, parts = [];
    for (const t of head) { y += 20; parts.push('<text x="' + pad + '" y="' + y + '" font-size="17" font-weight="650" fill="#1d1d1f">' + esc(t) + "</text>"); }
    for (const t of subs) { y += lineH; parts.push('<text x="' + pad + '" y="' + y + '" font-size="12.5" fill="#55575c">' + esc(t) + "</text>"); }
    y += 12;
    const palette = block.classList.contains("chart-palette-sites") ? " chart-palette-sites" : "";
    const plot = svg.outerHTML.replace(/^<svg\b/, '<svg x="' + pad + '" y="' + y + '"');
    parts.push('<g class="chart-block' + palette + '"><g class="chart-plot">' + plot + "</g>");
    y += H + 10;
    for (const k of keys) {
      const sw = k.swatch.replace(/^<svg\b/, '<svg x="' + pad + '" y="' + (y + 4) + '"');
      parts.push(sw);
      k.lines.forEach((t, i) => parts.push('<text x="' + (pad + 36) + '" y="' + (y + 14 + i * lineH) + '" font-size="12.5" fill="#1d1d1f">' + esc(t) + "</text>"));
      y += Math.max(1, k.lines.length) * lineH + 2;
    }
    parts.push("</g>");
    y += 8;
    parts.push('<line x1="' + pad + '" x2="' + (W + pad) + '" y1="' + y + '" y2="' + y + '" stroke="#d6d6da" stroke-width="1"/>');
    y += 4;
    for (const t of feet) { y += t ? 15 : 6; if (t) parts.push('<text x="' + pad + '" y="' + y + '" font-size="11.5" fill="#55575c">' + esc(t) + "</text>"); }
    const width = W + pad * 2, height = y + pad;
    const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    const text = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + " " + height + '" font-family="' + esc(font) + '">' +
      "<style>" + chartStyles() + "text{font-family:" + font + "}</style>" + '<rect width="100%" height="100%" fill="#ffffff"/>' + parts.join("") + "</svg>";
    return rasterise(text, width, height);
  }

  // A MapLibre map as a PNG: the view as drawn (taken in the frame it is drawn, as the viewer's own print does), the map's own text
  // labels on top, then a band with the title and its line, and one with the scale, the date and the map's credits (LINZ's and every
  // layer's, from the map's own attribution).
  function mapImage(map, { title = "", sub = "", foot = [] } = {}) {
    return new Promise((resolve, reject) => {
      let done = false;
      const grab = () => {
        if (done) return; done = true;
        let snap;
        try {
          const c = map.getCanvas(), box = map.getContainer();
          const cssW = box.clientWidth || c.width, k = c.width / cssW;
          snap = doc.createElement("canvas"); snap.width = c.width; snap.height = c.height;
          const g = snap.getContext("2d"); g.drawImage(c, 0, 0);
          paintLabels(g, box, k);
          resolve(frame(snap, k, { title, sub, foot, scale: map.getPitch() < 5 ? M().scaleBar(M().metresPerPx(map.getCenter().lat, map.getZoom()), 120) : null, credits: creditsOf(box) }));
        } catch (e) { reject(e); }
      };
      try { map.once("render", grab); map.triggerRepaint(); } catch (e) { reject(e); return; }
      setTimeout(() => { if (!done) { done = true; reject(new Error("no frame")); } }, 4000);
    });
  }
  // the viewer's labels are text over the map (its .rv-label spans): drawn into the picture where they stand, with their halo
  function paintLabels(g, box, k) {
    const at = box.getBoundingClientRect();
    for (const e of box.querySelectorAll(".rv-label")) {
      if (!e.getClientRects().length) continue;
      const cs = getComputedStyle(e), r = e.getBoundingClientRect();
      if (cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
      const rot = /rotate\(([-\d.]+)deg\)/.exec(e.style.transform || ""), halo = /0px 0px \d+px (rgb[^)]*\)|#[0-9a-f]+)/i.exec(cs.textShadow || "")?.[1] || "#ffffff";
      g.save();
      g.translate(((r.left + r.right) / 2 - at.left) * k, ((r.top + r.bottom) / 2 - at.top) * k);
      if (rot) g.rotate((Number(rot[1]) * Math.PI) / 180);
      g.font = cs.fontStyle + " " + cs.fontWeight + " " + parseFloat(cs.fontSize) * k + "px " + cs.fontFamily;
      g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round";
      g.strokeStyle = halo; g.lineWidth = 3.2 * k; g.globalAlpha = 0.9; g.strokeText(e.textContent, 0, 0);
      g.globalAlpha = 1; g.fillStyle = cs.color; g.fillText(e.textContent, 0, 0);
      g.restore();
    }
  }
  // the map's credits as its attribution control shows them (the sources drawn now: the background's LINZ line, each reference layer's)
  function creditsOf(box) {
    const t = box.querySelector(".maplibregl-ctrl-attrib-inner")?.textContent || "";
    return t.replace(/\s*\|\s*/g, " · ").replace(/\s+/g, " ").trim();
  }
  // The picture with a band above (title, line) and below (scale bar, then the stamp and credits), on white, in ink
  function frame(snap, k, { title, sub, foot, scale, credits }) {
    const W = snap.width, pad = 16 * k, font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    const chars = Math.max(30, Math.floor(W / k / 6.4));
    const tl = M().wrap(title, Math.floor(W / k / 9)), sl = M().wrap(sub, chars);
    const fl = [...foot, credits ? "Credits: " + credits : ""].filter(Boolean).flatMap((l) => M().wrap(l, chars));
    const top = pad + tl.length * 22 * k + sl.length * 17 * k + 10 * k, bottom = (scale ? 30 * k : 10 * k) + fl.length * 15 * k + pad;
    const c = doc.createElement("canvas"); c.width = W; c.height = Math.round(top + snap.height + bottom);
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);
    let y = pad;
    g.textBaseline = "top"; g.textAlign = "left";
    g.fillStyle = "#1d1d1f"; g.font = "650 " + 17 * k + "px " + font;
    for (const t of tl) { g.fillText(t, pad, y); y += 22 * k; }
    g.fillStyle = "#55575c"; g.font = 12.5 * k + "px " + font;
    for (const t of sl) { g.fillText(t, pad, y); y += 17 * k; }
    g.drawImage(snap, 0, top);
    g.strokeStyle = "#d6d6da"; g.lineWidth = 1 * k; g.strokeRect(0.5 * k, top, W - k, snap.height);
    y = top + snap.height + 10 * k;
    if (scale) {
      const w = scale.px * k, h = 5 * k;
      g.fillStyle = "#1d1d1f"; g.fillRect(pad, y, w / 2, h); g.strokeStyle = "#1d1d1f"; g.lineWidth = k; g.strokeRect(pad, y, w, h);
      g.font = 11.5 * k + "px " + font; g.fillText("0", pad, y + h + 3 * k); g.textAlign = "right"; g.fillText(scale.label, pad + w, y + h + 3 * k); g.textAlign = "left";
      y += 30 * k;
    }
    g.fillStyle = "#55575c"; g.font = 11.5 * k + "px " + font;
    for (const t of fl) { g.fillText(t, pad, y); y += 15 * k; }
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas"))), "image/png"));
  }

  FP.shareSave = { set, clear, button, open, chartImage, mapImage, can, save, say, current: () => current };
})(window);
