// EX1 (the owner, 15 Nov 2026: "Also consider sharing and downloading / exporting buttons / functionality"): the pure part of
// "Share or save", the one quiet control a screen offers to get OUT a copy of what the signed-in person is already looking at.
// No DOM, network or clock: the words, the file names, what the sheet lists on this device, the header lines a spreadsheet carries,
// and the plain wrapping of lines for an image. share-save.js draws the control and does the saving.
//
// Nothing here reads, sends or widens anything: a copy is made in the browser from what the screen already read, and handed to the
// person's own device (a download, the phone's own share sheet, the clipboard, the print dialog).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.shareSaveModel = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  const LABEL = "Share or save";
  const list = (v) => (Array.isArray(v) ? v : []);
  const text = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());

  // A file name from its parts: lower case, plain letters and digits joined by "-", macrons kept as their letters ("Ōtipua" "otipua"),
  // at most 100 characters before the extension. ("HDLG (example)", "water quality", "nitrate", "2026-11-15") + "csv" ->
  // "hdlg-example-water-quality-nitrate-2026-11-15.csv"
  function fileName(parts, ext) {
    const base = list(parts).map(text).filter(Boolean).join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100).replace(/-+$/, "");
    return (base || "export") + "." + String(ext || "txt").replace(/^\./, "");
  }

  // A day as people read it ("15 Nov 2026"), from "YYYY-MM-DD"; anything else is passed through as it is.
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
  function dayWords(day) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ""));
    return m ? Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + " " + m[1] : text(day);
  }

  // The line every copy carries, in its header or footer: what it is, whose, from where and when.
  // ({ what: "Water quality", place: "HDLG (example)", product: "Farm platform", day: "2026-11-15" }) ->
  // "Water quality · HDLG (example) · from Farm platform, 15 Nov 2026"
  function stamp({ what = "", place = "", product = "", day = "" } = {}) {
    const from = [product ? "from " + text(product) : "", dayWords(day)].filter(Boolean).join(", ");
    return [text(what), text(place), from].filter(Boolean).join(" · ");
  }

  // The last line of every copy: where and when it came from, and that it holds only what its maker could see.
  // ({ product: "Farm platform", day: "2026-11-15" }) -> "Saved from Farm platform on 15 Nov 2026. It holds only what the person who saved it could see."
  const savedLine = ({ product = "", day = "" } = {}) => "Saved from " + (text(product) || "the farm platform") + (day ? " on " + dayWords(day) : "") + ". It holds only what the person who saved it could see.";

  // A spreadsheet with its context: the header lines first (each its own one-cell row, quoted when it needs to be, never starting with
  // = + - @ so a spreadsheet never runs one), an empty row, then the table exactly as made (csvText, which may start with a byte order
  // mark: it is kept once, at the very start, so macrons survive).
  const BOM = "﻿";
  function cell(v) {
    let s = text(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function withHeader(lines, csvText) {
    const body = String(csvText || "").replace(/^﻿/, "");
    const head = list(lines).map(text).filter(Boolean).map(cell);
    return BOM + (head.length ? head.join("\r\n") + "\r\n\r\n" : "") + body;
  }

  // What the sheet lists on this device. offer: { files: [{ key, label, hint?, name }], link?: true, print?: true }.
  // can: { share (navigator.share), shareFiles (navigator.canShare({ files }) for the first file), clipboard, canvas (an image can be made) }.
  // Each file is a Save row (a file that needs an image is left out where no image can be made); one "Share…" row hands the first file to
  // the phone's own share sheet where the device can share files (a device that cannot is offered Save only, never a dead row); "Copy
  // link" copies the screen's own address (it opens only after a sign-in, for people who may already see it); "Print" where the screen
  // has a print layout.
  function items(offer, can = {}) {
    const files = list(offer?.files).filter((f) => f && f.key && (!f.image || can.canvas));
    const out = files.map((f) => ({ key: "save:" + f.key, kind: "save", file: f.key, label: f.label, hint: f.hint || f.name || "", icon: "download" }));
    if (files.length && can.share && can.shareFiles) out.push({ key: "share", kind: "share", file: files[0].key, label: "Share…", hint: shareHint(files[0]), icon: "send" });
    if (offer?.link) out.push({ key: "link", kind: "link", label: "Copy link", hint: can.clipboard ? LINK_HINT : LINK_HINT + " Shown to copy by hand.", icon: "link" });
    if (offer?.print) out.push({ key: "print", kind: "print", label: offer.printLabel || "Print", hint: offer.printHint || "Or save as a PDF", icon: "print" });
    return out;
  }
  const LINK_HINT = "To this screen. It opens only after signing in, for people who can already see it.";
  const shareHint = (f) => "The " + (f.share || f.label.replace(/^Save (the |this |these )?/i, "").toLowerCase()) + ", to another app";

  // The screen's own address, without anything the app keeps only for itself (a demo's or a test's query is kept: it is the address).
  // Never a signed storage link: those open without a sign-in, so they are not links to share.
  function linkOf(href) {
    const s = String(href || "");
    if (/[?&](token|signature|sig|X-Amz-Signature)=/i.test(s) || /\/storage\/v1\/object\/sign\//.test(s)) return null;
    return s;
  }

  // Lines wrapped to a number of characters, for the lines under an image (words kept whole; a word longer than the width on its own line).
  function wrap(line, width = 90) {
    const words = text(line).split(" ").filter(Boolean), out = [];
    let cur = "";
    for (const w of words) {
      if (!cur) cur = w;
      else if ((cur + " " + w).length <= width) cur += " " + w;
      else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    return out;
  }

  // A scale bar for a map image: the longest round length (1, 2 or 5 times a power of ten) that fits in maxPx at metresPerPx.
  // -> { px, label } ("500 m", "2 km")
  function scaleBar(metresPerPx, maxPx = 120) {
    const m = Number(metresPerPx);
    if (!Number.isFinite(m) || m <= 0) return null;
    const most = m * maxPx, p = 10 ** Math.floor(Math.log10(most));
    const n = [5, 2, 1].map((k) => k * p).find((v) => v <= most) || p;
    return { px: n / m, metres: n, label: n >= 1000 ? +(n / 1000).toFixed(3) + " km" : +n.toFixed(2) + " m" };
  }
  // Ground metres per CSS pixel at a latitude and a web map zoom (512-pixel tiles, as MapLibre counts them)
  const metresPerPx = (lat, zoom) => (40075016.686 * Math.cos((Number(lat) * Math.PI) / 180)) / (512 * 2 ** Number(zoom));

  // Plain words for what happened, said in the toast
  const SAID = {
    saved: (name) => "Saved " + name + ".",
    shared: "Shared.",
    copied: "Link copied. It opens only after signing in.",
    noImage: "This browser couldn't make the image. Try Print instead, or take a screenshot.",
    notReady: "Still getting it ready. Tap Share… again in a moment.",
    failed: "Couldn't make the file just now.",
  };

  return { LABEL, fileName, dayWords, stamp, savedLine, cell, withHeader, items, LINK_HINT, linkOf, wrap, scaleBar, metresPerPx, SAID, BOM };
});
