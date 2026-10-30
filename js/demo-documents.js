// Invented documents for the Documents block's gallery and tests (no client files, people or addresses).
// cairnvale: shaped on the live Cairnvale farm as loaded before tiers existed (29 documents, every one "primary" by
// F1e's default); hdlg: shaped on an HDLG member folder once a person has tiered it.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.demoDocuments = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  function documents() {
    const LOAD = "2026-10-28T02:00:00Z";
    let n = 0;
    const doc = (title, doc_type, extra = {}) => ({ id: "doc-" + String(++n).padStart(2, "0"), title, doc_type, tier: "primary", created_at: LOAD,
      storage_path: "demo/" + n + ".pdf", original_name: title + ".pdf", ...extra });
    const council = { author_org: "Example Regional Council" }, advisor = { author_org: "Example Advisory Ltd" };
    const cairnvale = [
      doc("Cairnvale Farm Environment Plan (2024)", "fep", { ...advisor, date_prepared: "2024-08-08", page_count: 46 }),
      doc("Land use consent decision CRC000101", "consent_decision", { ...council, date_prepared: "2025-01-14", page_count: 18 }),
      doc("Land use consent application", "consent_application", { ...advisor, date_prepared: "2024-09-20" }),
      doc("Assessment of environmental effects", "aee", { ...advisor, date_prepared: "2024-09-20", page_count: 52 }),
      doc("Overseer Farm Impact Report 2023/24", "overseer_report", { ...advisor, date_prepared: "2024-07-01" }),
      doc("Overseer Farm Impact Report 2022/23", "overseer_report", { ...advisor, date_prepared: "2023-07-01" }),
      doc("Baseline nutrient budget 2009–2013", "overseer_report", { date_prepared: "2014-03-01" }),
      doc("Nutrient budget 2021/22", "overseer_report", { date_prepared: "2022-06-30" }),
      doc("Baseline nutrient budget 2012/13 correspondence", "overseer_report"),
      doc("Nutrient budget peer review letter", "overseer_report", { date_prepared: "2024-10-02" }),
      ...[1, 2, 3, 4].map((i) => doc("CRC000101 information " + i, "consent_correspondence", { ...council, date_prepared: "2024-1" + (i - 1) + "-0" + (i + 1) })),
      doc("CRC000101 s92 response", "consent_correspondence", { ...advisor, date_prepared: "2024-12-12" }),
      ...["Eyre_3a.1", "Templeton_6a.1", "Lismore_1a.1", "Waimakariri_3a.1", "Paparua_2a.1", "Selwyn_1a.1"].map((s) => doc("S-map fact sheet " + s, "smap_factsheet")),
      ...["Wells within 2 km", "Wetlands within 1 km", "Boundary buffer 20 m", "River clip", "Drain clip"].map((t) => doc(t, "gis_artifact", { original_name: t + ".gpkg" })),
      doc("Land units map", "gis_artifact", { ...advisor, date_prepared: "2024-08-08" }),
      doc("Greenhouse gas report 2024", "ghg_report", { ...advisor, date_prepared: "2024-11-01" }),
      doc("Farm visit notes, March 2025", "memo", { ...advisor, date_prepared: "2025-03-12" }),
    ];
    n = 50;
    const at = "2026-10-29T03:00:00Z", group = { author_org: "Example Landcare Group" };
    const fep = doc("Example Downs FEP 2023 (final)", "fep", { ...group, date_prepared: "2023-06-14", page_count: 38, tiered_at: at, original_name: "Example Downs FEP 2023 final.pdf" });
    const nzfap = doc("NZFAP+ checklist 2024", "nzfap_checklist", { ...group, date_prepared: "2024-02-20", tiered_at: at });
    const under = (title, doc_type, extra = {}) => doc(title, doc_type, { tier: "supporting", relates_to: fep.id, tiered_at: at, ...extra });
    const hdlg = [fep, nzfap,
      under("Example Downs FEP 2023 (final, workbook)", "fep", { ...group, date_prepared: "2023-06-14", original_name: "Example Downs FEP 2023 final.xlsm" }),
      under("Farm visit notes, May 2023", "memo", { ...group, date_prepared: "2023-05-09" }),
      under("Draft LMU map", "land_unit_map", { ...group, date_prepared: "2023-05-20" }),
      ...["Templeton_6a.1", "Lismore_1a.1", "Eyre_3a.1"].map((s) => under("S-map report " + s, "smap_factsheet")),
      under("Farm boundary", "image", { original_name: "Farm boundary.png" }),
      doc("FEP WIP draft v3", "fep", { tier: "archive", tiered_at: at, date_prepared: "2023-05-30" }),
      doc("FEP WIP draft v2", "fep", { tier: "archive", tiered_at: at, date_prepared: "2023-05-02" }),
    ];
    return { cairnvale, hdlg };
  }
  return documents;
});
