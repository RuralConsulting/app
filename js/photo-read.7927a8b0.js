// B4 slice 1: what a photo file says about itself, read in the browser before upload: when it was taken, where, and
// which way the camera looked; and the size to resize it to. Pure (bytes in, numbers out; no image library), so the
// capture block (a photo taken in the app) and the bulk import (a phone's photo folder) read a photo exactly as
// tools/load_layers.py reads the loaded ones, and an app photo swings in on the map like them (photo-model.js).
//
// Direction, as load_layers.py: degrees clockwise from TRUE north, 0 to under 360. EXIF GPSImgDirection first; its
// GPSImgDirectionRef "M" (magnetic) needs the farm's declination (east positive) and is left out without one; no
// reference or "T" is taken as true north. Then the XMP packet's drone-dji:GimbalYawDegree, then FlightYawDegree
// (-180..180, taken as true north). Only the first 1 MB of the file is searched (the headers sit at its start).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else { root.FP = root.FP || {}; root.FP.photoRead = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  const HEAD = 1 << 20;

  // A direction value as degrees, or null: numbers, numeric text and EXIF fractions ("4523/100"). Text is read as
  // Python's float() reads it in load_layers.py (a sign, "45.", ".5", an exponent), so DJI's "+45.50" is a direction.
  const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
  const num = (t) => (NUM.test(t.trim()) ? Number(t.trim()) : NaN);
  function degrees(v) {
    if (v == null || typeof v === "boolean" || typeof v === "object") return null;
    const s = String(v).trim(), slash = s.indexOf("/");
    const n = slash >= 0 ? num(s.slice(0, slash)) / num(s.slice(slash + 1)) : num(s);
    return Number.isFinite(n) ? n : null;
  }
  // To one decimal as Python's round(x, 1) does, on the double's exact value: toFixed reads that value, and the only
  // exact ties (x.x5 held exactly) are quarters, which go to the even tenth (45.25 -> 45.2; 359.95 is 359.9499... -> 359.9).
  const tenth = (x) => { const q = x * 4; if (Number.isInteger(q) && q % 2 !== 0) { const f = Math.floor(x * 10); return (f % 2 === 0 ? f : f + 1) / 10; } return Number(x.toFixed(1)); };
  const wrap = (deg) => { const w = deg % 360; return w < 0 ? w + 360 : w; };   // Python's x % 360 (no round trip through +360)
  const turn = (deg) => { const d = tenth(wrap(deg)); return d === 360 || d === 0 ? 0 : d; };

  // The EXIF TIFF block of a JPEG (its APP1 "Exif" segment), or the bytes themselves when they are a TIFF (e.g. DNG).
  const isTiff = (b, at = 0) => b.length >= at + 4 && ((b[at] === 0x49 && b[at + 1] === 0x49 && b[at + 2] === 0x2a && b[at + 3] === 0) ||
    (b[at] === 0x4d && b[at + 1] === 0x4d && b[at + 2] === 0 && b[at + 3] === 0x2a));
  function exifTiff(b) {
    if (isTiff(b)) return b;
    if (b[0] !== 0xff || b[1] !== 0xd8) return null;
    let at = 2;
    while (at + 4 <= b.length && b[at] === 0xff) {
      const marker = b[at + 1];
      if (marker === 0xda) break;                       // start of scan: the headers are over
      const length = (b[at + 2] << 8) | b[at + 3];
      if (length < 2) break;
      if (marker === 0xe1 && b[at + 4] === 0x45 && b[at + 5] === 0x78 && b[at + 6] === 0x69 && b[at + 7] === 0x66 && b[at + 8] === 0 && b[at + 9] === 0)
        return b.subarray(at + 10, Math.min(b.length, at + 2 + length));
      at += 2 + length;
    }
    return null;
  }

  // SH1: a HEIF/HEIC photo (an iPhone's own format, when the phone hands the file over as it is): an ISO box file whose `meta` box
  // names an item of type "Exif" (iinf) and where its bytes lie in the file (iloc). heifExif(b) gives { offset, length } of that item
  // in the file, or null (not a HEIF, no Exif item, or one stored some other way than at a plain file offset). The item's own first
  // four bytes say how far past them the TIFF header starts (usually "Exif\0\0" first).
  const fourcc = (b, at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
  const isHeif = (b) => b.length >= 12 && fourcc(b, 4) === "ftyp" && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif|avis)$/.test(fourcc(b, 8));
  function boxes(b, start, end) {
    const out = [];
    let at = start;
    while (at + 8 <= end) {
      let size = ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3], head = 8;
      if (size === 1) { if (at + 16 > end) break; size = Number(new DataView(b.buffer, b.byteOffset + at + 8, 8).getBigUint64(0)); head = 16; }
      else if (size === 0) size = end - at;
      if (size < head) break;
      out.push({ type: fourcc(b, at + 4), start: at + head, end: Math.min(end, at + size) });
      at += size;
    }
    return out;
  }
  function heifExif(b) {
    if (!b || !isHeif(b)) return null;
    const meta = boxes(b, 0, b.length).find((x) => x.type === "meta");
    if (!meta) return null;
    const kids = boxes(b, meta.start + 4, meta.end);   // (meta is a full box: version and flags first)
    const iinf = kids.find((x) => x.type === "iinf"), iloc = kids.find((x) => x.type === "iloc");
    if (!iinf || !iloc) return null;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const uint = (at, n) => (n === 0 ? 0 : n === 2 ? dv.getUint16(at) : n === 4 ? dv.getUint32(at) : n === 8 ? Number(dv.getBigUint64(at)) : NaN);
    // the Exif item's id
    let id = null;
    const iv = b[iinf.start], entriesAt = iinf.start + 4 + (iv === 0 ? 2 : 4);
    for (const e of boxes(b, entriesAt, iinf.end)) {
      if (e.type !== "infe") continue;
      const v = b[e.start];
      if (v < 2) continue;
      const item = v === 2 ? dv.getUint16(e.start + 4) : dv.getUint32(e.start + 4), typeAt = e.start + 4 + (v === 2 ? 2 : 4) + 2;
      if (typeAt + 4 <= e.end && fourcc(b, typeAt) === "Exif") { id = item; break; }
    }
    if (id === null) return null;
    // where it is
    const v = b[iloc.start];
    let at = iloc.start + 4;
    const offSize = b[at] >> 4, lenSize = b[at] & 15, baseSize = b[at + 1] >> 4, indexSize = v === 1 || v === 2 ? b[at + 1] & 15 : 0;
    at += 2;
    const count = v < 2 ? dv.getUint16(at) : dv.getUint32(at);
    at += v < 2 ? 2 : 4;
    for (let i = 0; i < count && at < iloc.end; i++) {
      const item = v < 2 ? dv.getUint16(at) : dv.getUint32(at);
      at += v < 2 ? 2 : 4;
      let method = 0;
      if (v === 1 || v === 2) { method = dv.getUint16(at) & 15; at += 2; }
      at += 2;   // data_reference_index
      const base = uint(at, baseSize); at += baseSize;
      const extents = dv.getUint16(at); at += 2;
      let first = null;
      for (let k = 0; k < extents; k++) {
        at += indexSize;
        const off = uint(at, offSize); at += offSize;
        const len = uint(at, lenSize); at += lenSize;
        if (k === 0) first = { off, len };
      }
      if (item === id) return method === 0 && first && Number.isFinite(first.off + base) ? { offset: base + first.off, length: first.len || null } : null;
    }
    return null;
  }
  // The TIFF block inside a HEIF Exif item's bytes (its first four bytes: how far past them the TIFF header is), or null.
  function heifTiff(item) {
    if (!item || item.length < 8) return null;
    const skip = new DataView(item.buffer, item.byteOffset, 4).getUint32(0), at = 4 + skip;
    if (isTiff(item, at)) return item.subarray(at);
    for (let i = 4; i + 4 <= Math.min(item.length, 64); i++) if (isTiff(item, i)) return item.subarray(i);   // (a writer that got the count wrong)
    return null;
  }

  // The tags this reads, from the TIFF: DateTimeOriginal (Exif IFD), and GPS latitude, longitude and image direction.
  function readTiff(t) {
    if (!isTiff(t)) return {};
    const dv = new DataView(t.buffer, t.byteOffset, t.byteLength), le = t[0] === 0x49;
    const u16 = (o) => (o + 2 <= t.length ? dv.getUint16(o, le) : null), u32 = (o) => (o + 4 <= t.length ? dv.getUint32(o, le) : null);
    function ifd(off) {
      const out = {}, n = off == null ? null : u16(off);
      if (n == null) return out;
      for (let i = 0; i < n; i++) {
        const at = off + 2 + 12 * i;
        if (at + 12 > t.length) break;
        out[u16(at)] = { type: u16(at + 2), count: u32(at + 4), at: at + 8 };
      }
      return out;
    }
    const ascii = (e) => {
      if (!e || e.type !== 2) return null;
      const start = e.count <= 4 ? e.at : u32(e.at);
      if (start == null || start + e.count > t.length) return null;
      let s = ""; for (let i = 0; i < e.count && t[start + i]; i++) s += String.fromCharCode(t[start + i]);
      return s.trim();
    };
    const rationals = (e) => {                          // RATIONAL (5) or SRATIONAL (10), always at an offset
      if (!e || (e.type !== 5 && e.type !== 10)) return null;
      const off = u32(e.at);
      if (off == null || off + 8 * e.count > t.length) return null;
      const out = [];
      for (let i = 0; i < e.count; i++) {
        const num = e.type === 5 ? dv.getUint32(off + 8 * i, le) : dv.getInt32(off + 8 * i, le);
        const den = e.type === 5 ? dv.getUint32(off + 8 * i + 4, le) : dv.getInt32(off + 8 * i + 4, le);
        out.push(den === 0 ? NaN : num / den);
      }
      return out;
    };
    const pointer = (e) => (e && (e.type === 4 || e.type === 13) ? u32(e.at) : null);
    const root = ifd(u32(4)), exif = ifd(pointer(root[0x8769])), gps = ifd(pointer(root[0x8825]));
    const dms = (e, ref) => {
      const r = rationals(e);
      if (!r || r.length !== 3 || !r.every(Number.isFinite)) return null;
      const v = r[0] + r[1] / 60 + r[2] / 3600;
      return /^[SW]/i.test(ref || "") ? -v : v;
    };
    const dir = rationals(gps[0x0011]);
    return {
      taken: ascii(exif[0x9003]) || ascii(root[0x0132]) || null,   // DateTimeOriginal, else DateTime
      lat: dms(gps[0x0002], ascii(gps[0x0001])), lon: dms(gps[0x0004], ascii(gps[0x0003])),
      direction: dir && dir.length && Number.isFinite(dir[0]) ? dir[0] : null, directionRef: ascii(gps[0x0010]) || "",
    };
  }

  // The `<x:xmpmeta ... </x:xmpmeta>` text, by two plain searches, and one property from it (attribute or element).
  function xmpPacket(b) {
    const text = latin1(b), s = text.indexOf("<x:xmpmeta"), e = s >= 0 ? text.indexOf("</x:xmpmeta>", s) : -1;
    return e >= 0 ? text.slice(s, e + 12) : null;
  }
  function xmpValue(xmp, name) {
    const m = xmp.match(new RegExp("[\\s<](?:[\\w.-]+:)?" + name + "\\s*=\\s*[\"']([^\"']*)[\"']")) || xmp.match(new RegExp("<(?:[\\w.-]+:)?" + name + "\\s*>([^<]*)<"));
    return m ? m[1].trim() : null;
  }
  function latin1(b) { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return s; }

  // EXIF "2024:10:02 13:37:29" -> "2024-10-02T13:37:29" (the camera's own clock: no time zone), or null.
  function stamp(s) {
    const m = typeof s === "string" && s.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m || m[1] === "0000") return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3] || +m[4] > 23 || +m[5] > 59) return null;
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || "00"}`;
  }

  // What a photo file says: { taken_at, lat, lon, direction, direction_from: "exif"|"xmp"|null, magnetic_left_out }.
  // `bytes` is a Uint8Array or ArrayBuffer of the file (only its first 1 MB is read); `declination` is the farm's
  // magnetic declination in degrees, east positive, or null. Nothing found is null, never a guess.
  // SH1: a HEIF's Exif item can lie past the first 1 MB; `heifItem` (that item's bytes, read by the caller from where heifExif said)
  // is read in its place.
  function read(bytes, declination = null, { heifItem = null } = {}) {
    declination = degrees(declination);   // a number or numeric text ("24.5"), as the loader's float()
    const out = { taken_at: null, lat: null, lon: null, direction: null, direction_from: null, magnetic_left_out: false };
    if (!bytes) return out;
    let b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    b = b.subarray(0, HEAD);
    let tags = {};
    try {
      let t = heifItem ? heifTiff(heifItem instanceof Uint8Array ? heifItem : new Uint8Array(heifItem)) : exifTiff(b);
      if (!t && isHeif(b)) { const x = heifExif(b); if (x && x.offset < b.length) t = heifTiff(b.subarray(x.offset, x.length ? x.offset + x.length : b.length)); }
      if (t) tags = readTiff(t);
    } catch (_) { tags = {}; }
    out.taken_at = stamp(tags.taken);
    if (Number.isFinite(tags.lat) && Number.isFinite(tags.lon) && Math.abs(tags.lat) <= 90 && Math.abs(tags.lon) <= 180 && !(tags.lat === 0 && tags.lon === 0)) {
      out.lat = Math.round(tags.lat * 1e7) / 1e7; out.lon = Math.round(tags.lon * 1e7) / 1e7;
    }
    const d = degrees(tags.direction);
    if (d != null) {
      if (/^M/i.test(tags.directionRef)) {
        if (declination != null) { out.direction = turn(d + declination); out.direction_from = "exif"; return out; }
        out.magnetic_left_out = true;
      } else { out.direction = turn(d); out.direction_from = "exif"; return out; }
    }
    const xmp = xmpPacket(b);
    if (xmp) for (const name of ["GimbalYawDegree", "FlightYawDegree"]) {
      const y = degrees(xmpValue(xmp, name));
      if (y != null) { out.direction = turn(y); out.direction_from = "xmp"; out.magnetic_left_out = false; return out; }
    }
    return out;
  }

  // The size to resize a photo to before upload: its long edge at most `maxEdge` px (default 2048), aspect kept, never
  // enlarged. A 12 MP phone photo (4032 x 3024) becomes 2048 x 1536; encodeUnder then keeps it under
  // B4's 600 KB (the size test on real photos comes with the capture slice, in the browser checks).
  function fit(width, height, maxEdge = 2048) {
    if (!(width > 0 && height > 0)) return null;
    const k = Math.min(1, maxEdge / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
  }

  // Encode under a byte budget: `encode(quality)` returns a Promise of a Blob (canvas.toBlob in the app); qualities
  // are tried from 0.82 down to 0.5, and the first under `budget` (default 600 KB) is kept. If none is, the smallest is
  // returned with `over: true`, so the caller can step the size down rather than upload an oversized copy unseen.
  async function encodeUnder(encode, budget = 600 * 1024) {
    let best = null;
    for (const q of [0.82, 0.74, 0.66, 0.58, 0.5]) {
      const blob = await encode(q);
      if (!blob) continue;
      if (blob.size <= budget) return { blob, quality: q, over: false };
      if (!best || blob.size < best.blob.size) best = { blob, quality: q };
    }
    return best ? { ...best, over: true } : null;
  }

  return { read, fit, encodeUnder, HEAD, heifExif, isHeif };
});
