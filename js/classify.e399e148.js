// What an uploaded file probably is, before a person confirms it: its kind, its tier (main, supporting or archive)
// and, for a supporting file, the main document it sits under. Ordinary code first (docs/BUILDING-BLOCKS.md §5):
// rules() reads only the file's name, type and size and the farm's main documents; it is pure and never sends
// anything anywhere. The person confirms or changes the guess in one step before anything is saved.
//
// sniff() is the one place a file's contents are looked at, on the device and never sent anywhere: the sheet names
// of a workbook, to tell the FEP generations the plan reader (PL2, tools/plans/readers) reads. The app cannot run
// that reader (it is Python, run by an advisor: docs/ONBOARDING-REPORT.md R1), so this is a light mirror of its first
// signal, nothing more; the reader itself decides again at read-in and refuses a file it does not know.
//
// classify.ai is the hook for the AI gateway (G1, docs/AI-GUARDRAILS.md). Until G1 exists it is null and the
// rules are the whole classifier: no provider call, and no key, ever lives in app/.
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./consent-no.js") : root.FP.consentNo);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.classify = api; }
})(typeof window === "undefined" ? globalThis : window, function (CN) {
  // The kinds a person can choose from, in the order the chooser lists them: [doc_type, plain name].
  const KINDS = [
    ["fep", "Farm Environment Plan"], ["fep_audit", "FEP audit"], ["fwfp", "Freshwater Farm Plan"], ["nzfap_checklist", "NZFAP+ checklist"],
    ["consent_decision", "Consent decision"], ["consent_application", "Consent application"], ["aee", "Assessment of environmental effects"],
    ["overseer_report", "Nutrient budget"], ["land_unit_map", "Land unit map"], ["luc_report", "Land use capability report"],
    ["ghg_report", "Greenhouse gas report"], ["memo", "Notes"], ["correspondence", "Correspondence"],
    ["smap_factsheet", "S-map soil fact sheet"], ["gis_artifact", "Map extract"], ["image", "Photo or image"], ["other", "Other"],
  ];
  const TIERS = ["primary", "supporting", "archive"];

  // Kept, never shown first: working copies, backups and anything marked superseded.
  const ARCHIVE = /\bwip\b|work[\s_-]*in[\s_-]*progress|\bcopy[\s_-]+of\b|\bbackup\b|\bold\b|\bsuperseded\b|\barchived?\b|^~\$/i;
  // [pattern on the name, doc_type, tier]; the first that matches wins. Tier "supporting" sits under a main document.
  const RULES = [
    // an audit of the plan is its record, not the plan (an irrigation, effluent or meter audit is not this kind)
    [/(\bfep\b|\bfemp\b|farm[\s_-]*environment[\s_-]*plan).*\baudit|\baudit\b.*(\bfep\b|farm[\s_-]*environment[\s_-]*plan)/i, "fep_audit", "supporting"],
    [/farm[\s_-]*environment[\s_-]*plan|\bfep\b|\bfemp\b/i, "fep", "primary"],
    [/freshwater[\s_-]*farm[\s_-]*plan|\bfwfp\b/i, "fwfp", "primary"],
    [/nzfap/i, "nzfap_checklist", "primary"],
    [/s[\s_-]?92|\bcorrespondence\b|\be-?mail\b|\bletter\b|\binfo(?:rmation)?[\s_-]*(?:request|response|\d+)\b/i, "correspondence", "supporting"],
    [/\bs[\s_-]?map\b|smap|soil[\s_-]*(?:fact|report)/i, "smap_factsheet", "supporting"],
    [/visit[\s_-]*notes?|farm[\s_-]*walk|\bnotes?\b|\bmemo\b|\bminutes\b/i, "memo", "supporting"],
    [/\bdecision\b|\bgranted\b|consent[\s_-]*notice/i, "consent_decision", "primary"],
    [/\baee\b|assessment[\s_-]*of[\s_-]*environmental/i, "aee", "primary"],
    [/consent[\s_-]*application|\bapplication\b/i, "consent_application", "primary"],
    [/overseer|nutrient[\s_-]*budget|\bfarm[\s_-]*impact[\s_-]*report\b/i, "overseer_report", "primary"],
    [/greenhouse|\bghg\b|emissions/i, "ghg_report", "primary"],
    [/land[\s_-]*use[\s_-]*capability|\bluc\b/i, "luc_report", "primary"],
    [/\blmu\b|land[\s_-]*(?:management[\s_-]*)?units?|farm[\s_-]*map|property[\s_-]*map/i, "land_unit_map", "supporting"],
    [/\bclip\b|buffer|within[\s_-]*\d+[\s_-]*km|\bextract\b|boundary/i, "gis_artifact", "supporting"],
  ];
  const IMAGE = /^image\//i, IMAGE_EXT = /\.(?:jpe?g|png|gif|webp|heic|tiff?)$/i, GIS_EXT = /\.(?:gpkg|shp|kml|kmz|geojson|zip)$/i;
  const PLAN_TYPES = ["fep", "fwfp"];

  // The FEP workbook generations PL2 detects by their sheets: [reader id, plain name, the sheets it requires]. These are
  // each layout's detect.required_sheet_names in tools/plans/generations (tests/app/b3dz.test.cjs fails if they drift).
  // A PDF or Word plan is told by its name (RULES above): reading its text is the reader's job, not the browser's.
  const GENERATIONS = [
    ["fep-hdlg-2021", "the HDLG FEP workbook (October 2021)", ["SetupFEP", "Title page", "Property Details", "Sum of Act", "Risk Ass", "Irrigation",
      "Nutrient", "Soil", "Waterbody", "PointSource", "Objective Evidence", "Data sheet - do not touch"]],
    ["fep-aic", "the Amuri Irrigation Company FEP workbook", ["FEP_Info Part 1", "FEP_Info Part 2", "FEP_auto", "Lists"]],
  ];
  const WORKBOOK_EXT = /\.xls[xm]$/i, XML_ENTITY = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
  const SNIFF_ZIP_TAIL = 65557, SNIFF_MAX_PART = 8 * 1024 * 1024;
  // A real xl/workbook.xml is a few KB. Past this many bytes unpacked it is not read at all: a zip can claim, or hide, a thousandfold.
  const SNIFF_MAX_XML = 1024 * 1024;

  // The sheet names of an .xlsx/.xlsm (a zip), read from its central directory and xl/workbook.xml alone. file: a Blob/File.
  // Anything unexpected (not a zip, zip64, an encrypted or oversized part) is null: no guess is better than a wrong one.
  async function workbookSheets(file) {
    const bytes = async (from, to) => new Uint8Array(await file.slice(from, to).arrayBuffer());
    const size = file.size, tailAt = Math.max(0, size - SNIFF_ZIP_TAIL), tail = await bytes(tailAt, size), tv = new DataView(tail.buffer);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tv.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) return null;
    const entries = tv.getUint16(end + 10, true), cdSize = tv.getUint32(end + 12, true), cdAt = tv.getUint32(end + 16, true);
    if (entries === 0xffff || cdSize === 0xffffffff || cdAt === 0xffffffff || cdSize > SNIFF_MAX_PART) return null;
    const cd = await bytes(cdAt, cdAt + cdSize), v = new DataView(cd.buffer), dec = new TextDecoder();
    for (let p = 0, n = 0; p + 46 <= cd.length && n < entries; n++) {
      if (v.getUint32(p, true) !== 0x02014b50) return null;
      const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true), packed = v.getUint32(p + 20, true), unpacked = v.getUint32(p + 24, true), at = v.getUint32(p + 42, true);
      const nameLen = v.getUint16(p + 28, true), skip = nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true), name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));
      p += 46 + skip;
      if (name !== "xl/workbook.xml") continue;
      if ((flags & 1) || packed > SNIFF_MAX_XML || unpacked > SNIFF_MAX_XML) return null;   // encrypted, or larger than a workbook's sheet list can be
      const head = await bytes(at, at + 30), hv = new DataView(head.buffer);
      if (hv.getUint32(0, true) !== 0x04034b50) return null;
      const from = at + 30 + hv.getUint16(26, true) + hv.getUint16(28, true), raw = file.slice(from, from + packed);
      let xml;
      if (method === 0) xml = dec.decode(new Uint8Array(await raw.arrayBuffer()));
      else if (method === 8 && typeof DecompressionStream === "function") {
        // The declared size can lie, so count what actually comes out and stop at the cap.
        const reader = raw.stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader(), chunks = [];
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > SNIFF_MAX_XML) { reader.cancel().catch(() => {}); return null; }
          chunks.push(value);
        }
        const all = new Uint8Array(total);
        for (let i = 0, at2 = 0; i < chunks.length; at2 += chunks[i].length, i++) all.set(chunks[i], at2);
        xml = dec.decode(all);
      } else return null;
      const plain = (t) => t.replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => XML_ENTITY[m]);
      return [...xml.matchAll(/<sheet\s[^<>]*?\bname="([^"]*)"/g)].map((m) => plain(m[1]));
    }
    return null;
  }
  // Which FEP generation a workbook is, by its sheets: { id, label } or null (not a workbook, or none the reader knows).
  // Never throws: a file that cannot be read this way is simply not recognised here, and falls back to its name.
  async function sniff(file) {
    try {
      if (!file || !WORKBOOK_EXT.test(String(file.name || "")) || typeof file.slice !== "function") return null;
      const sheets = await workbookSheets(file);
      if (!sheets) return null;
      const have = new Set(sheets), hit = GENERATIONS.find(([, , need]) => need.every((s) => have.has(s)));
      return hit ? { id: hit[0], label: hit[1] } : null;
    } catch { return null; }
  }

  // The file's own name as a title: no extension, no underscores, one space between words.
  const stem = (name) => String(name || "").replace(/^.*[\\/]/, "").replace(/\.[A-Za-z0-9]{1,10}$/, "");
  function titleFrom(name) {
    const t = stem(name).replace(/_+/g, " ").replace(/\s+/g, " ").trim();
    return t || "File";
  }
  // What the storage path ends with: the lower-case extension the database expects (".pdf"), or nothing.
  const extension = (name) => (String(name || "").match(/(\.[A-Za-z0-9]{1,10})$/)?.[1] || "").toLowerCase();
  // Two names are one document in two formats when they are the same apart from the extension and "final"/case.
  const family = (name) => stem(name).toLowerCase().replace(/[\s_-]+/g, " ").replace(/\b(final|issued|signed)\b/g, "").replace(/\s+/g, " ").trim();
  // The first consent number a name carries (ECAN1: consent-no.js, which also reads CRC000369A.1 and the legacy NCY, SCY, WTK and MLB numbers), else null
  const consentNo = (s) => CN.find(s)[0] || null;
  const newest = (a, b) => String(b.date_prepared || b.created_at || "").localeCompare(String(a.date_prepared || a.created_at || ""));

  // file: { name, type, size }; primaries: the farm's main documents ({ id, title, doc_type, original_name, date_prepared }).
  // Returns { title, doc_type, tier, relates_to, because } where because is the plain reason for the tier.
  function rules(file, primaries = []) {
    const name = String(file?.name || ""), type = String(file?.type || ""), words = stem(name).replace(/[_]+/g, " ");
    const mains = (Array.isArray(primaries) ? primaries : []).filter((p) => p && p.id);
    const title = titleFrom(name);
    let [, doc_type, tier] = RULES.find(([re]) => re.test(words)) || [null, null, null];
    if (!doc_type && (IMAGE.test(type) || IMAGE_EXT.test(name))) [doc_type, tier] = ["image", "supporting"];
    if (!doc_type && GIS_EXT.test(name)) [doc_type, tier] = ["gis_artifact", "supporting"];
    if (!doc_type) [doc_type, tier] = ["other", "supporting"];
    let because = tier === "primary" ? "it reads as a main file" : "it reads as background to a main file";
    if (ARCHIVE.test(words)) { tier = "archive"; because = "it reads as a working copy"; }

    // Where a supporting file sits: the other format of the same document first, then what it is about.
    let relates_to = null;
    const twin = mains.find((p) => family(p.original_name || p.title) === family(name) && family(name));
    if (twin && tier !== "archive") { tier = "supporting"; relates_to = twin.id; because = "it is " + (twin.title || "a main file") + " in another format"; }
    else if (tier === "supporting") {
      const crc = consentNo(name), byConsent = crc && mains.find((p) => consentNo(p.title) === crc && !PLAN_TYPES.includes(p.doc_type));
      const plan = [...mains].filter((p) => PLAN_TYPES.includes(p.doc_type)).sort(newest)[0];
      const under = byConsent || plan || null;
      if (under) relates_to = under.id;
    }
    return { title, doc_type, tier, relates_to, because };
  }

  return { KINDS, TIERS, rules, sniff, workbookSheets, GENERATIONS, titleFrom, extension, family,
    // HOOK classify.ai — once G1 (the AI gateway) has merged, this becomes an async (file, guess, ctx) => guess call
    // through supabase/functions/_shared/ai.ts as the caller's own JWT (cheap tier, minimal sending, logged in
    // ai_calls). Until then it stays null, so nothing leaves the device and rules() is the only classifier.
    ai: null };
});
