// Photos on the map (E3, #221): what a photo point says, in plain words, and where the camera looked. Pure: the
// map scene (map-scene.js) frames and draws, the popup (popup.js) lays it out; this decides the words and numbers.
// A photo point carries what the camera wrote (EXIF, as the QGIS photo import gives it: Name, Date, Time, Azimuth,
// Altitude, Title...). None of those fields is shown as it is: one line says when it was taken and which way it looked.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else { root.FP = root.FP || {}; root.FP.photoModel = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  // Property names are matched without regard to case: the same field arrives as Azimuth, azimuth or AZIMUTH.
  const lower = (props) => Object.fromEntries(Object.entries(props || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const pick = (p, keys) => { for (const k of keys) if (p[k] != null && String(p[k]).trim() !== "") return p[k]; return null; };

  // Which way the camera looked, in degrees clockwise from north (0 to 360), or null when the photo does not say.
  // EXIF GPSImgDirection (sometimes written as a fraction, "4523/100"), the photo import's Azimuth, or a bearing or
  // direction recorded on the point.
  const DIRECTION = ["gpsimgdirection", "imgdirection", "img_direction", "azimuth", "bearing", "direction", "heading", "camera_direction"];
  function direction(props) {
    const raw = pick(lower(props), DIRECTION);
    if (raw == null || typeof raw === "object" || typeof raw === "boolean") return null;
    const s = String(raw).trim(), frac = s.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    const n = frac ? Number(frac[1]) / Number(frac[2]) : /^-?\d+(?:\.\d+)?$/.test(s) ? Number(s) : NaN;
    if (!Number.isFinite(n)) return null;
    const d = n % 360;
    return d < 0 ? d + 360 : d === 0 ? 0 : d;   // (and never -0)
  }
  // Eight compass words: "north", "north-east"... A bearing on a boundary goes to the nearer word, halves clockwise.
  const WORDS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  const compass = (deg) => (Number.isFinite(deg) ? WORDS[Math.round((((deg % 360) + 360) % 360) / 45) % 8] : null);

  // When it was taken, as the camera's own clock wrote it (no time zone is applied): { day: "2024-10-02", time:
  // "13:37" | null, key } or null. The import gives Date ("2024-10-02T00:00:00", the time part empty) and Time
  // ("13:37:29"); other sources give one stamp ("2024:10:02 13:37:29", "2024-10-02T13:37:29").
  const STAMP = /^(\d{4})[-:/](\d{2})[-:/](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;
  function takenAt(props) {
    const p = lower(props);
    const parse = (v) => { const m = typeof v === "string" ? v.trim().match(STAMP) : null; return m && validDay(m[1], m[2], m[3]) ? m : null; };
    const stamp = parse(pick(p, ["datetimeoriginal", "taken_at", "timestamp", "datetime", "date_time", "captured_at"]));
    const date = parse(pick(p, ["date", "date_taken"])) || stamp;
    if (!date) return null;
    let time = null;
    const t = String(pick(p, ["time", "time_taken"]) ?? "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (t && Number(t[1]) < 24 && Number(t[2]) < 60) time = [t[1].padStart(2, "0"), t[2], t[3] || "00"];
    else if (stamp && stamp[4] && !(stamp[4] === "00" && stamp[5] === "00" && (stamp[6] || "00") === "00")) time = [stamp[4], stamp[5], stamp[6] || "00"];
    else if (date[4] && !(date[4] === "00" && date[5] === "00" && (date[6] || "00") === "00")) time = [date[4], date[5], date[6] || "00"];
    const day = date[1] + "-" + date[2] + "-" + date[3];
    return { day, time: time ? time[0] + ":" + time[1] : null, key: day + "T" + (time ? time.join(":") : "") };
  }
  const validDay = (y, m, d) => { const t = new Date(Date.UTC(+y, +m - 1, +d)); return t.getUTCFullYear() === +y && t.getUTCMonth() === +m - 1 && t.getUTCDate() === +d; };
  const dayWords = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  // "13:37" -> "1:37 pm"; "00:05" -> "12:05 am"; "12:00" -> "12:00 pm".
  function clock(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return ((h % 12) || 12) + ":" + String(m).padStart(2, "0") + (h < 12 ? " am" : " pm");
  }

  // The one plain line: "Taken 2 Oct 2024, 1:37 pm, looking north-east"; "Taken 2 Oct 2024" when the photo has no
  // direction (the line then says nothing about one); "Photo, date not recorded" when it has neither.
  function line(props) {
    const at = takenAt(props), look = compass(direction(props));
    if (at) return ["Taken " + dayWords(at.day), at.time ? clock(at.time) : null, look ? "looking " + look : null].filter(Boolean).join(", ");
    return look ? "Photo looking " + look + ", date not recorded" : "Photo, date not recorded";
  }

  // The photos of one layer in the order they were taken (undated last; ties keep the layer's order).
  function inTimeOrder(features) {
    const list = (features || []).filter((f) => f?.geometry?.type === "Point" && Array.isArray(f.geometry.coordinates));
    return list.map((f, i) => ({ f, i, at: takenAt(f.properties) }))
      .sort((a, b) => (a.at ? 0 : 1) - (b.at ? 0 : 1) || (a.at && b.at ? a.at.key.localeCompare(b.at.key) : 0) || a.i - b.i)
      .map((x) => x.f);
  }

  // Is [lng, lat] inside a Polygon or MultiPolygon (holes respected)? Ray casting; a point on an edge may go either way.
  function inRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inside(pt, geom) {
    if (!geom || !Array.isArray(pt)) return false;
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
    return polys.some((rings) => rings.length && inRing(pt, rings[0]) && !rings.slice(1).some((h) => inRing(pt, h)));
  }
  // The land unit a point sits in (the first that holds it), or null.
  const unitAt = (pt, units) => (units?.features || []).find((u) => inside(pt, u.geometry)) || null;
  const unitLine = (unit) => {
    const name = unit ? [unit.properties?.code, unit.properties?.name].filter(Boolean).join(" ") : "";
    return name ? "In " + name : null;
  };

  // Everything the photo's card says, in order: the picture, the line, the land unit, the layer's source line.
  // sourceLine is FP.farmModel.sourceLine (passed in, so this module stands alone).
  function card(feature, layer, units, sourceLine) {
    const p = feature?.properties || {}, deg = direction(p);
    return { line: line(p), place: unitLine(unitAt(feature?.geometry?.coordinates, units)), source: sourceLine ? sourceLine(layer) : null,
      image: typeof p.storage_path === "string" && p.storage_path ? p.storage_path : null, direction: deg };
  }

  // The view cone: a wedge from the point, `spread` degrees wide about the look direction, `metres` long, as a GeoJSON
  // Polygon in lng/lat (small distances: a local flat-earth step is exact enough at farm scale).
  function cone(at, deg, metres, spread = 60, steps = 12) {
    if (!Array.isArray(at) || !Number.isFinite(deg) || !(metres > 0)) return null;
    const [lng, lat] = at, k = Math.PI / 180, perLat = 111320, perLng = 111320 * Math.cos(lat * k);
    const ring = [[lng, lat]];
    for (let s = 0; s <= steps; s++) {
      const b = (deg - spread / 2 + (spread * s) / steps) * k;
      ring.push([lng + (metres * Math.sin(b)) / perLng, lat + (metres * Math.cos(b)) / perLat]);
    }
    ring.push([lng, lat]);
    return { type: "Polygon", coordinates: [ring] };
  }
  // Ground metres per screen pixel at a zoom and latitude (web mercator, 512 px tiles as MapLibre draws them).
  const metresPerPixel = (zoom, lat) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

  // Where the camera goes for a photo: a modest zoom (in to 17, never out past where the person is, at most 18.5),
  // tilted and turned to look the way the camera did when the photo says; otherwise north up and flat, so the map
  // implies no direction the photo does not have.
  function camera(deg, current = {}) {
    const zoom = Math.min(Math.max(Number(current.zoom) || 0, 17), 18.5);
    return Number.isFinite(deg) ? { zoom, bearing: deg, pitch: 50 } : { zoom, bearing: 0, pitch: 0 };
  }
  // How far the photo's card covers the map (canvas px), so the point is framed in what is left: beside the card on a
  // wide map, above it (the sheet) on a narrow one. A photo with a direction sits lower, so its cone has room ahead.
  function padding(size, cardBox, sheet, directed) {
    const w = Number(size?.width) || 0, h = Number(size?.height) || 0, cw = Number(cardBox?.width) || 0, ch = Number(cardBox?.height) || 0;
    const pad = sheet ? { top: 40, left: 40, right: 40, bottom: Math.min(ch, h * 0.7) + 20 } : { top: 40, left: Math.min(cw + 24, w * 0.6) + 40, right: 56, bottom: 68 };
    if (directed) pad.top += Math.round(Math.max(0, h - pad.top - pad.bottom) * 0.3);
    return pad;
  }
  // easeTo's offset (px from the canvas centre) that puts the point at the centre of the padded frame.
  const offset = (pad) => [Math.round((pad.left - pad.right) / 2), Math.round((pad.top - pad.bottom) / 2)];

  // ---- The camera under terrain (#229). MapLibre places a camera at its zoom's distance from a reference height at the
  // centre of the map. With "Hills in 3D" on, an ease keeps the reference it started with (sea level, on a farm flown in
  // from NZ), so a camera asked for zoom 17 over ground at 320 m (x 1.3 as drawn) lands that much lower: in the hillside,
  // far too close, its pin off the frame. The map sets the reference to the ground at the photo before it moves; these
  // say what happens when it does not, and how the map knows, once the camera is at rest, that it landed where it asked.
  const FOV = Math.atan(0.75);   // MapLibre's field of view (36.87°): the camera is 1.5 map heights from the centre
  // How far the camera is from the ground at the point it looks at (metres, along the view), for a zoom, pitch and map
  // height (px), when its height is measured from `reference` and the ground there is at `ground` (both as drawn,
  // exaggeration in). 0: the camera is in the ground.
  function cameraGap(zoom, lat, pitch, height, reference = 0, ground = 0) {
    const cos = Math.cos(((Number(pitch) || 0) * Math.PI) / 180), along = (height / 2 / Math.tan(FOV / 2)) * metresPerPixel(zoom, lat);
    const above = along * cos - ((Number(ground) || 0) - (Number(reference) || 0));
    return above > 0 ? above / cos : 0;
  }
  // How many times closer the ground looks than the zoom asked for (1: as asked; Infinity: the camera is in the ground).
  function closer(zoom, lat, pitch, height, reference, ground) {
    const gap = cameraGap(zoom, lat, pitch, height, reference, ground);
    return gap > 0 ? cameraGap(zoom, lat, pitch, height) / gap : Infinity;
  }
  // A camera that sees the ground this much closer or further than its zoom says did not land where it was asked
  // (the tilt alone puts a photo's point up to a fifth closer than the centre of the map).
  const TOO_CLOSE = 1.6;
  // Once the camera is at rest on a photo: the point (canvas px), the far edge of its view cone, the canvas size and the
  // padding the point and cone must sit inside, and how much closer the ground looks than the zoom says (seen). Back:
  // { ok } when all is in frame; { zoom } (log2, never in) to take the cone back inside by zooming out about the point;
  // { lost } when the point itself is off the frame or the ground is not at the distance asked: the camera is wrong.
  function frameCheck(pin, far, size, pad, seen = 1, slack = 2) {
    const r = { left: pad.left - slack, top: pad.top - slack, right: size.width - pad.right + slack, bottom: size.height - pad.bottom + slack };
    const fine = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
    const inside = (p) => p[0] >= r.left && p[0] <= r.right && p[1] >= r.top && p[1] <= r.bottom;
    if (!fine(pin) || !inside(pin) || !(seen > 1 / TOO_CLOSE && seen < TOO_CLOSE)) return { lost: true };
    let scale = 1;
    for (const [x, y] of (far || []).filter(fine)) {
      if (x > r.right) scale = Math.min(scale, (r.right - pin[0]) / (x - pin[0]));
      if (x < r.left) scale = Math.min(scale, (pin[0] - r.left) / (pin[0] - x));
      if (y > r.bottom) scale = Math.min(scale, (r.bottom - pin[1]) / (y - pin[1]));
      if (y < r.top) scale = Math.min(scale, (pin[1] - r.top) / (pin[1] - y));
    }
    return scale >= 1 ? { ok: true } : { zoom: Math.log2(Math.max(scale, 0.25)) };
  }

  // Photo pins are curated by zoom (Josh, 31 Oct): Photos is on by default, but at the farm's own frame its pins are
  // hidden (the opening map is the boundary alone); they show once the map is zoomed in past that frame by about one
  // zoom level (PIN_ZOOM), and always while a photo is open. Photos switched off hides them at any zoom.
  // { on, open, zoom, farmZoom } -> true when the pins are drawn. No farm frame yet (the flight in): hidden.
  const PIN_ZOOM = 0.9;
  const pinsShown = ({ on, open, zoom, farmZoom } = {}) => !!on && (!!open || (Number.isFinite(zoom) && Number.isFinite(farmZoom) && zoom >= farmZoom + PIN_ZOOM));

  return { direction, compass, takenAt, line, inTimeOrder, inside, unitAt, unitLine, card, cone, metresPerPixel, camera, padding, offset,
    cameraGap, closer, TOO_CLOSE, frameCheck, pinsShown, PIN_ZOOM };
});
