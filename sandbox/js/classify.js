// What an uploaded file probably is, before a person confirms it: its kind, its tier (main, supporting or archive)
// and, for a supporting file, the main document it sits under. Ordinary code first (docs/BUILDING-BLOCKS.md §5):
// rules() reads only the file's name, type and size and the farm's main documents; it is pure and never sends
// anything anywhere. The person confirms or changes the guess in one step before anything is saved.
//
// classify.ai is the hook for the AI gateway (G1, docs/AI-GUARDRAILS.md). Until G1 exists it is null and the
// rules are the whole classifier: no provider call, and no key, ever lives in app/.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.classify = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
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

  // The file's own name as a title: no extension, no underscores, one space between words.
  const stem = (name) => String(name || "").replace(/^.*[\\/]/, "").replace(/\.[A-Za-z0-9]{1,10}$/, "");
  function titleFrom(name) {
    const t = stem(name).replace(/_+/g, " ").replace(/\s+/g, " ").trim();
    return t || "Document";
  }
  // What the storage path ends with: the lower-case extension the database expects (".pdf"), or nothing.
  const extension = (name) => (String(name || "").match(/(\.[A-Za-z0-9]{1,10})$/)?.[1] || "").toLowerCase();
  // Two names are one document in two formats when they are the same apart from the extension and "final"/case.
  const family = (name) => stem(name).toLowerCase().replace(/[\s_-]+/g, " ").replace(/\b(final|issued|signed)\b/g, "").replace(/\s+/g, " ").trim();
  const consentNo = (s) => (String(s || "").match(/\bCRC\s?\d{5,}[A-Z]?/i)?.[0] || "").replace(/\s/g, "").toUpperCase() || null;
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
    let because = tier === "primary" ? "it reads as a main document" : "it reads as background to a main document";
    if (ARCHIVE.test(words)) { tier = "archive"; because = "it reads as a working copy"; }

    // Where a supporting file sits: the other format of the same document first, then what it is about.
    let relates_to = null;
    const twin = mains.find((p) => family(p.original_name || p.title) === family(name) && family(name));
    if (twin && tier !== "archive") { tier = "supporting"; relates_to = twin.id; because = "it is " + (twin.title || "a main document") + " in another format"; }
    else if (tier === "supporting") {
      const crc = consentNo(name), byConsent = crc && mains.find((p) => consentNo(p.title) === crc && !PLAN_TYPES.includes(p.doc_type));
      const plan = [...mains].filter((p) => PLAN_TYPES.includes(p.doc_type)).sort(newest)[0];
      const under = byConsent || plan || null;
      if (under) relates_to = under.id;
    }
    return { title, doc_type, tier, relates_to, because };
  }

  return { KINDS, TIERS, rules, titleFrom, extension, family,
    // HOOK classify.ai — once G1 (the AI gateway) has merged, this becomes an async (file, guess, ctx) => guess call
    // through supabase/functions/_shared/ai.ts as the caller's own JWT (cheap tier, minimal sending, logged in
    // ai_calls). Until then it stays null, so nothing leaves the device and rules() is the only classifier.
    ai: null };
});
