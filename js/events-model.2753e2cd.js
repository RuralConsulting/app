// N4: a catchment group's events, their pure parts. New Zealand time (Pacific/Auckland) for every date and time shown or typed,
// across daylight saving; the month grid and the Upcoming / Past lists; the event form to a row and back; topics; the CSV
// export (events, and attendance), its template and the import preview; the calendar file (.ics, RFC 5545). No DOM, no reads,
// no clock: events.js reads and writes as the signed-in person (public.group_events, public.group_event_attendees) and hands
// the rows here, with "now" when it matters.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.eventsModel = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  const TZ = "Pacific/Auckland";
  const MAX_IMPORT = 500;
  const MAX_TOPICS = 12, MAX_TOPIC = 40;
  const pad = (n, w = 2) => String(n).padStart(w, "0");

  // ---- New Zealand time ----------------------------------------------------------------------------------------------------------
  const FMT = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
  const DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  // The wall-clock parts of an instant in New Zealand.
  function nz(t) {
    const p = {};
    for (const x of FMT.formatToParts(new Date(t))) if (x.type !== "literal") p[x.type] = x.value;
    return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: Number(p.hour) % 24, mm: Number(p.minute), ss: Number(p.second), dow: DOW[p.weekday] };
  }
  const wallMs = (t) => { const p = nz(t); return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss); };
  // The instant whose New Zealand wall clock reads y-m-d hh:mm. A time that does not exist (the hour lost when daylight saving
  // starts) comes out an hour later, as a phone's clock would show it; the repeated hour when it ends takes the first.
  function nzInstant(y, m, d, hh = 0, mm = 0) {
    const want = Date.UTC(y, m - 1, d, hh, mm), H = 3600000;
    // New Zealand is +13 (NZDT) or +12 (NZST): the earlier instant whose wall clock reads `want`; in the lost hour, the
    // standard-time reading, which the clock shows an hour later
    const hit = [want - 13 * H, want - 12 * H].find((t) => wallMs(t) === want);
    return new Date(hit ?? want - 12 * H);
  }
  const dayKey = (t) => { const p = nz(t); return p.y + "-" + pad(p.m) + "-" + pad(p.d); };
  const timeKey = (t) => { const p = nz(t); return pad(p.hh) + ":" + pad(p.mm); };
  const parseDay = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };
  const validDay = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate() && y >= 1990 && y < 2100;
  const addDays = (key, n) => { const [y, m, d] = parseDay(key); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.getUTCFullYear() + "-" + pad(t.getUTCMonth() + 1) + "-" + pad(t.getUTCDate()); };
  const midnight = (key) => { const [y, m, d] = parseDay(key); return nzInstant(y, m, d, 0, 0); };
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dowOfKey = (key) => { const [y, m, d] = parseDay(key); return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1; };
  const dateText = (key) => { const [y, m, d] = parseDay(key); return DAYS[dowOfKey(key) - 1] + " " + d + " " + MONTHS[m - 1].slice(0, 3) + " " + y; };
  const clock = (hhmm) => { const [h, mi] = hhmm.split(":").map(Number); return (h % 12 || 12) + (mi ? ":" + pad(mi) : "") + (h < 12 ? " am" : " pm"); };

  // ---- an event's days and words --------------------------------------------------------------------------------------------------
  // The New Zealand days an event covers, first and last (inclusive). An all-day event's stored end is the midnight after its last
  // day; a timed event ending exactly at midnight does not cover the day it ends on.
  function span(ev) {
    const first = dayKey(ev.starts_at);
    if (!ev.ends_at) return { first, last: first };
    const endMs = Date.parse(ev.ends_at);
    let last = dayKey(endMs - 1);
    if (last < first) last = first;
    return { first, last };
  }
  function whenText(ev) {
    const { first, last } = span(ev);
    if (ev.all_day) return first === last ? dateText(first) + " (all day)" : dateText(first) + " to " + dateText(last) + " (all day)";
    const start = timeKey(ev.starts_at);
    if (!ev.ends_at) return dateText(first) + ", " + clock(start);
    const end = timeKey(ev.ends_at), endDay = dayKey(ev.ends_at);
    return endDay === first ? dateText(first) + ", " + clock(start) + " to " + clock(end) : dateText(first) + ", " + clock(start) + " to " + dateText(endDay) + ", " + clock(end);
  }
  const isCancelled = (ev) => !!ev?.cancelled_at;

  // ---- the calendar ------------------------------------------------------------------------------------------------------------------
  // A month as weeks of days, Monday first, each day with the events that touch it (in start order). ym is "YYYY-MM".
  function monthGrid(ym, events, today) {
    const [y, m] = String(ym).split("-").map(Number);
    const first = y + "-" + pad(m) + "-01", days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const start = addDays(first, 1 - dowOfKey(first)), last = y + "-" + pad(m) + "-" + pad(days);
    const end = addDays(last, 7 - dowOfKey(last));
    const sorted = [...(events || [])].sort(byStart);
    const spans = sorted.map((ev) => ({ ev, ...span(ev) }));
    const weeks = [];
    for (let key = start, week = []; key <= end; key = addDays(key, 1)) {
      week.push({ date: key, day: Number(key.slice(8)), inMonth: key.slice(0, 7) === y + "-" + pad(m), today: key === today,
        events: spans.filter((s) => s.first <= key && s.last >= key).map((s) => s.ev) });
      if (week.length === 7) { weeks.push(week); week = []; }
    }
    return { key: y + "-" + pad(m), label: MONTHS[m - 1] + " " + y, weeks, prev: shiftMonth(ym, -1), next: shiftMonth(ym, 1) };
  }
  function shiftMonth(ym, n) {
    const [y, m] = String(ym).split("-").map(Number), t = (y * 12 + (m - 1)) + n;
    return Math.floor(t / 12) + "-" + pad((t % 12) + 1);
  }
  const byStart = (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || String(a.title).localeCompare(String(b.title)) || String(a.id).localeCompare(String(b.id));
  // Upcoming (not yet over, soonest first) and Past (over, latest first). An event with no end is over when its day is.
  function lists(events, now) {
    const at = Date.parse(now);
    const over = (ev) => (ev.ends_at ? Date.parse(ev.ends_at) : Date.parse(midnight(addDays(dayKey(ev.starts_at), 1)).toISOString())) <= at;
    const all = [...(events || [])];
    return { upcoming: all.filter((e) => !over(e)).sort(byStart), past: all.filter(over).sort((a, b) => byStart(b, a)) };
  }

  // ---- topics ---------------------------------------------------------------------------------------------------------------------
  // Trimmed, empty dropped, one of each ignoring case (the first spelling kept): as the database's guard keeps them. A semicolon
  // separates topics in the spreadsheet, so none is kept inside one.
  function cleanTopics(list) {
    const seen = new Set(), out = [];
    for (const raw of Array.isArray(list) ? list : String(list || "").split(/[;\n]/)) {
      const t = String(raw ?? "").replace(/;/g, ",").trim().replace(/\s+/g, " ");
      if (!t || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase()); out.push(t);
    }
    return out;
  }
  // The group's topics used before, most used first: what the form suggests.
  function topicSuggestions(events) {
    const n = new Map(), spelt = new Map();
    for (const ev of events || []) for (const t of cleanTopics(ev.topics)) {
      const k = t.toLowerCase(); n.set(k, (n.get(k) || 0) + 1); if (!spelt.has(k)) spelt.set(k, t);
    }
    return [...n.keys()].sort((a, b) => n.get(b) - n.get(a) || a.localeCompare(b)).map((k) => spelt.get(k));
  }

  // ---- the form -------------------------------------------------------------------------------------------------------------------
  // A form's values (strings, as typed) to the row the database takes, or the plain reasons it can't be saved.
  // { title, all_day, start_date, start_time, end_date, end_time, place_name, latitude, longitude, topics, notes, head_count }
  // For an all-day event the end date is its last day (inclusive), as people say it; it is stored as the midnight after.
  function toRow(f) {
    const errors = [], s = (k) => String(f?.[k] ?? "").trim();
    const title = s("title");
    if (!title) errors.push("Give the event a title.");
    else if (title.length > 200) errors.push("The title is longer than 200 characters.");
    const allDay = f?.all_day === true || /^(yes|true|1|y)$/i.test(s("all_day"));
    const sd = parseDay(s("start_date"));
    let starts = null, ends = null;
    if (!sd || !validDay(...sd)) errors.push("Give a start date (for example 2026-10-14).");
    const st = s("start_time"), et = s("end_time"), ed = s("end_date");
    const time = (v) => { const m = /^(\d{1,2}):(\d{2})$/.exec(v); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? [Number(m[1]), Number(m[2])] : null; };
    if (!allDay && st && !time(st)) errors.push("The start time should be like 09:30.");
    if (!allDay && et && !time(et)) errors.push("The end time should be like 13:00.");
    const edd = ed ? parseDay(ed) : null;
    if (ed && (!edd || !validDay(...edd))) errors.push("The end date should be like 2026-10-14.");
    if (sd && validDay(...sd) && !errors.length) {
      if (allDay) {
        starts = nzInstant(sd[0], sd[1], sd[2]);
        const lastDay = edd ? ed : s("start_date");
        ends = midnight(addDays(lastDay, 1));
      } else {
        const [h, mi] = time(st || "00:00") || [0, 0];
        starts = nzInstant(sd[0], sd[1], sd[2], h, mi);
        if (et || edd) {
          const day = edd || sd, [eh, emi] = time(et || "00:00") || [0, 0];
          ends = nzInstant(day[0], day[1], day[2], eh, emi);
        }
      }
      if (ends && ends < starts) errors.push("The event ends before it starts.");
      if (allDay && ends && ends <= starts) errors.push("The last day is before the first.");
    }
    const place = s("place_name");
    if (place.length > 200) errors.push("The place name is longer than 200 characters.");
    const lat = s("latitude"), lon = s("longitude");
    let latitude = null, longitude = null;
    if (lat || lon) {
      latitude = Number(lat); longitude = Number(lon);
      if (!lat || !lon || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        errors.push("A point needs both a latitude (like -43.5) and a longitude (like 172.6)."); latitude = longitude = null;
      }
    }
    const topics = cleanTopics(f?.topics);
    if (topics.length > MAX_TOPICS) errors.push("An event has at most " + MAX_TOPICS + " topics.");
    if (topics.some((t) => t.length > MAX_TOPIC)) errors.push("A topic is at most " + MAX_TOPIC + " characters.");
    const notes = s("notes");
    if (notes.length > 10000) errors.push("The notes are longer than 10,000 characters.");
    const hc = s("head_count");
    let head = null;
    if (hc) { head = Number(hc); if (!/^\d+$/.test(hc) || head > 100000) { errors.push("The head count should be a whole number."); head = null; } }
    if (errors.length) return { errors };
    return { errors: [], row: { title, all_day: allDay, starts_at: starts.toISOString(), ends_at: ends ? ends.toISOString() : null,
      place_name: place || null, latitude, longitude, topics, notes: notes || null, head_count: head } };
  }
  // A stored event to the form's values (New Zealand dates and times).
  function toForm(ev) {
    if (!ev) return { title: "", all_day: false, start_date: "", start_time: "", end_date: "", end_time: "", place_name: "", latitude: "", longitude: "", topics: [], notes: "", head_count: "" };
    const { first, last } = span(ev);
    return { title: ev.title || "", all_day: !!ev.all_day, start_date: first, start_time: ev.all_day ? "" : timeKey(ev.starts_at),
      end_date: ev.all_day ? (last === first ? "" : last) : ev.ends_at && dayKey(ev.ends_at) !== first ? dayKey(ev.ends_at) : "",
      end_time: !ev.all_day && ev.ends_at ? timeKey(ev.ends_at) : "", place_name: ev.place_name || "",
      latitude: ev.latitude == null ? "" : String(ev.latitude), longitude: ev.longitude == null ? "" : String(ev.longitude),
      topics: cleanTopics(ev.topics), notes: ev.notes || "", head_count: ev.head_count == null ? "" : String(ev.head_count) };
  }

  // ---- CSV ------------------------------------------------------------------------------------------------------------------------
  // The events file's columns. Dates and times are New Zealand's; topics are separated by semicolons; "id" is the event's own id
  // (leave it empty on a new row; keep it to update that event). "cancelled" is shown, never changed by an import.
  const EVENT_COLUMNS = ["id", "title", "start_date", "start_time", "end_date", "end_time", "all_day", "place_name", "latitude", "longitude", "topics", "notes", "head_count", "cancelled"];
  const ATTENDANCE_COLUMNS = ["event_id", "event_title", "event_date", "name", "kind", "note"];
  const cell = (v) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  // A UTF-8 byte order mark first, so a spreadsheet opens macrons (ā, ē, ī, ō, ū) as written; lines end CRLF (RFC 4180).
  const toCsv = (columns, rows) => "\uFEFF" + [columns.map(cell).join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
  function parseCsv(text) {
    const s = String(text || "").replace(/^\uFEFF/, ""), rows = [];
    let row = [], field = "", quoted = false, i = 0, line = 1, rowLine = 1;
    for (; i < s.length; i++) {
      const c = s[i];
      if (quoted) {
        if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
        else { if (c === "\n") line++; field += c; }
      } else if (c === '"' && field === "") quoted = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\r" || c === "\n") {
        if (c === "\r" && s[i + 1] === "\n") i++;
        row.push(field); field = ""; rows.push({ line: rowLine, cells: row }); row = []; line++; rowLine = line;
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push({ line: rowLine, cells: row }); }
    return rows.filter((r) => r.cells.some((c) => c.trim() !== ""));
  }
  function eventCsvRow(ev) {
    const f = toForm(ev);
    return { id: ev.id, title: ev.title, start_date: f.start_date, start_time: f.start_time, end_date: ev.all_day ? span(ev).last : ev.ends_at ? dayKey(ev.ends_at) : "",
      end_time: f.end_time, all_day: ev.all_day ? "yes" : "no", place_name: ev.place_name || "", latitude: f.latitude, longitude: f.longitude,
      topics: cleanTopics(ev.topics).join("; "), notes: ev.notes || "", head_count: f.head_count, cancelled: ev.cancelled_at ? "yes" : "no" };
  }
  // The events whose days fall within [from, to] (New Zealand dates, either may be empty), in start order.
  const inRange = (events, from, to) => [...(events || [])].filter((ev) => { const { first, last } = span(ev); return (!from || last >= from) && (!to || first <= to); }).sort(byStart);
  const eventsCsv = (events, from, to) => toCsv(EVENT_COLUMNS, inRange(events, from, to).map(eventCsvRow));
  const ATTENDEE_KIND = (a) => (a.user_id ? "member" : a.group_member_id ? "business" : "name");
  function attendanceCsv(events, attendees, from, to) {
    const evs = inRange(events, from, to), byId = new Map(evs.map((e) => [e.id, e]));
    const rows = (attendees || []).filter((a) => byId.has(a.event_id))
      .sort((a, b) => byStart(byId.get(a.event_id), byId.get(b.event_id)) || String(a.name).localeCompare(String(b.name)))
      .map((a) => ({ event_id: a.event_id, event_title: byId.get(a.event_id).title, event_date: span(byId.get(a.event_id)).first, name: a.name, kind: ATTENDEE_KIND(a), note: a.note || "" }));
    return toCsv(ATTENDANCE_COLUMNS, rows);
  }
  const TEMPLATE_EXAMPLE = { id: "", title: "Field day at the ford (example: replace or delete this row)", start_date: "2026-10-14", start_time: "10:00", end_date: "2026-10-14", end_time: "13:00",
    all_day: "no", place_name: "Ford Road, Waimā", latitude: "-43.0012", longitude: "172.0518", topics: "Water quality; Riparian planting", notes: "Bring boots, gumboots and lunch.", head_count: "", cancelled: "" };
  const template = () => toCsv(EVENT_COLUMNS, [TEMPLATE_EXAMPLE]);

  // ---- import ------------------------------------------------------------------------------------------------------------------------
  // A date as people and spreadsheets write it: 2026-10-14, or 14/10/2026 (New Zealand order, as Excel saves it here).
  function readDate(v) {
    const s = String(v || "").trim();
    if (!s) return "";
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s), ymd = null;
    if (m) ymd = [Number(m[1]), Number(m[2]), Number(m[3])];
    else if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s))) ymd = [Number(m[3]), Number(m[2]), Number(m[1])];
    return ymd && validDay(...ymd) ? ymd[0] + "-" + pad(ymd[1]) + "-" + pad(ymd[2]) : null;
  }
  // A time: 09:30, 9:30, 9.30, 9:30 am, 2 pm, 14:00:00.
  function readTime(v) {
    const s = String(v || "").trim().toLowerCase();
    if (!s) return "";
    const m = /^(\d{1,2})(?:[:.](\d{2}))?(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(s);
    if (!m) return null;
    let h = Number(m[1]); const mi = Number(m[2] || 0), ap = m[4]?.[0];
    if (ap) { if (h < 1 || h > 12) return null; h = (h % 12) + (ap === "p" ? 12 : 0); }
    else if (m[2] == null) return null;
    return h < 24 && mi < 60 ? pad(h) + ":" + pad(mi) : null;
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const comparable = (r) => ({ title: r.title, all_day: !!r.all_day, starts_at: Date.parse(r.starts_at), ends_at: r.ends_at ? Date.parse(r.ends_at) : null, place_name: r.place_name || null,
    latitude: r.latitude == null ? null : Number(r.latitude), longitude: r.longitude == null ? null : Number(r.longitude), topics: cleanTopics(r.topics), notes: r.notes || null,
    head_count: r.head_count == null ? null : Number(r.head_count) });
  // Each row of a CSV against the group's events as the person reads them: "add", "update" (its id is one of the group's events),
  // "same" (nothing would change) or "reject" with the plain reason. Nothing is written here. Over max rows: nothing at all.
  function importPreview(text, existing, { max = MAX_IMPORT } = {}) {
    const rows = parseCsv(text);
    if (!rows.length) return { error: "The file is empty.", rows: [], counts: {} };
    const header = rows[0].cells.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    const missing = ["title", "start_date"].filter((c) => !header.includes(c));
    if (missing.length) return { error: "The file needs the columns " + missing.join(" and ") + " in its first row. Download the template to see them all.", rows: [], counts: {} };
    const unknown = header.filter((h) => h && !EVENT_COLUMNS.includes(h));
    const body = rows.slice(1);
    if (body.length > max) return { error: "The file has " + body.length + " rows. Import at most " + max + " at a time: split the file and import each part.", rows: [], counts: {} };
    const byId = new Map((existing || []).map((e) => [String(e.id).toLowerCase(), e])), seen = new Set();
    const out = body.map(({ line, cells }) => {
      const v = Object.fromEntries(header.map((h, n) => [h, (cells[n] ?? "").trim()]));
      const reject = (reason) => ({ line, action: "reject", reason, title: v.title || "" });
      if (cells.length > header.length && cells.slice(header.length).some((c) => c.trim())) return reject("More cells than columns: check for a comma that needs quotes.");
      const sd = readDate(v.start_date), ed = readDate(v.end_date), st = readTime(v.start_time), et = readTime(v.end_time);
      if (sd === null) return reject("The start date \"" + v.start_date + "\" isn't a date (use 2026-10-14 or 14/10/2026).");
      if (ed === null) return reject("The end date \"" + v.end_date + "\" isn't a date (use 2026-10-14 or 14/10/2026).");
      if (st === null) return reject("The start time \"" + v.start_time + "\" isn't a time (use 09:30 or 9:30 am).");
      if (et === null) return reject("The end time \"" + v.end_time + "\" isn't a time (use 13:00 or 1 pm).");
      if (v.all_day && !/^(yes|no|true|false|y|n|1|0)$/i.test(v.all_day)) return reject("All day should be yes or no.");
      const allDay = /^(yes|true|y|1)$/i.test(v.all_day || "") || (!v.all_day && !st && !et && !!sd);
      const { errors, row } = toRow({ title: v.title, all_day: allDay, start_date: sd, start_time: st, end_date: ed, end_time: et, place_name: v.place_name,
        latitude: v.latitude, longitude: v.longitude, topics: v.topics, notes: v.notes, head_count: v.head_count });
      if (errors.length) return reject(errors.join(" "));
      const id = (v.id || "").trim();
      if (!id) return { line, action: "add", title: row.title, row };
      const key = id.toLowerCase();
      if (seen.has(key)) return reject("This id is on an earlier row of the file too.");
      seen.add(key);
      const ev = byId.get(key);
      if (!ev) return reject("No event of this group has this id. Leave the id empty to add it as a new event.");
      if (ev.cancelled_at) return reject("That event is cancelled: restore it in Events before changing it.");
      if (same(comparable(ev), comparable(row))) return { line, action: "same", id: ev.id, title: row.title, row };
      return { line, action: "update", id: ev.id, title: row.title, row, was: ev };
    });
    const counts = { add: 0, update: 0, same: 0, reject: 0 };
    for (const r of out) counts[r.action]++;
    return { rows: out, counts, unknown, error: null };
  }
  const ACTION_TEXT = { add: "Will add", update: "Will update", same: "No change", reject: "Rejected" };

  // ---- the calendar file (.ics, RFC 5545) -----------------------------------------------------------------------------------------
  // Text escaped (backslash, semicolon, comma, newline); lines folded at 75 octets of UTF-8, never inside a character; CRLF.
  const icsText = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
  const utf8Len = (ch) => { const c = ch.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; };
  function fold(line) {
    const out = []; let cur = "", n = 0, limit = 75;
    for (const ch of line) {
      const b = utf8Len(ch);
      if (n + b > limit) { out.push(cur); cur = " "; n = 1; }
      cur += ch; n += b;
    }
    out.push(cur);
    return out.join("\r\n");
  }
  const utc = (t) => { const d = new Date(t); return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z"; };
  const icsDate = (key) => key.replace(/-/g, "");
  // Timed events in UTC (every calendar shows them at the right New Zealand time, daylight saving included); all-day events as
  // DATE values, DTEND the day after the last (exclusive). UID is the event's id, so a calendar updates rather than duplicates.
  function ics(events, { name = "Events", host = "farm-platform", now } = {}) {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Rural Consulting//Farm platform events//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:" + icsText(name), "X-WR-TIMEZONE:" + TZ];
    for (const ev of [...(events || [])].sort(byStart)) {
      const { first, last } = span(ev);
      lines.push("BEGIN:VEVENT", "UID:" + ev.id + "@" + host, "DTSTAMP:" + utc(ev.updated_at || ev.created_at || now || ev.starts_at));
      if (ev.all_day) lines.push("DTSTART;VALUE=DATE:" + icsDate(first), "DTEND;VALUE=DATE:" + icsDate(addDays(last, 1)));
      else { lines.push("DTSTART:" + utc(ev.starts_at)); if (ev.ends_at) lines.push("DTEND:" + utc(ev.ends_at)); }
      lines.push("SUMMARY:" + icsText(ev.title));
      if (ev.place_name) lines.push("LOCATION:" + icsText(ev.place_name));
      if (ev.latitude != null && ev.longitude != null) lines.push("GEO:" + Number(ev.latitude) + ";" + Number(ev.longitude));
      const topics = cleanTopics(ev.topics);
      if (topics.length) lines.push("CATEGORIES:" + topics.map(icsText).join(","));
      const desc = [ev.notes || "", topics.length ? "Topics: " + topics.join("; ") : "", ev.head_count != null ? "Head count: " + ev.head_count : ""].filter(Boolean).join("\n\n");
      if (desc) lines.push("DESCRIPTION:" + icsText(desc));
      lines.push("STATUS:" + (ev.cancelled_at ? "CANCELLED" : "CONFIRMED"));
      if (ev.updated_at) lines.push("LAST-MODIFIED:" + utc(ev.updated_at));
      lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
  }
  // A file name from the group's name and the range: letters, digits and hyphens only.
  const fileName = (group, what, from, to, ext) => [String(group || "group").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "group",
    what, from || "start", to || "end"].join("-") + "." + ext;

  return { TZ, MAX_IMPORT, MAX_TOPICS, nz, nzInstant, dayKey, timeKey, addDays, midnight, dateText, clock, span, whenText, isCancelled, monthGrid, shiftMonth, lists,
    cleanTopics, topicSuggestions, toRow, toForm, EVENT_COLUMNS, ATTENDANCE_COLUMNS, toCsv, parseCsv, eventCsvRow, inRange, eventsCsv, attendanceCsv, template,
    readDate, readTime, importPreview, ACTION_TEXT, icsText, fold, ics, fileName, DAYS, MONTHS, ATTENDEE_KIND };
});
