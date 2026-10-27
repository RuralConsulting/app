(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.plan.template = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  return {
    key: "fep_canterbury", version: 1,
    sections: [
      ["front", "Plan details"], ["summary", "Plan summary"], ["story", "1.1 Farm story"],
      ["property", "1.2 Property details"], ["stock", "1.3 Land use and stock details"],
      ["units", "2 Land units and inherent vulnerabilities"], ["actions", "3 Action plan"],
      ["areas", "4 Farming activities, risks and actions"], ["register", "5 Authorisations and how this plan meets them"],
      ["cccv", "Appendix 1: Catchment context, challenges and values"], ["risk-grid", "Appendix 2: Assessing the significance of risks to freshwater"],
      ["maps", "Appendix 3: Maps in support of the risk assessment"], ["mahinga", "Appendix 4: Mahinga kai"], ["sources", "Appendix 5: Sources and evidence"],
    ],
    managementAreas: [
      { key: "land_soil", label: "Land and soil management", core: true, kinds: ["cultivation", "winter_grazing", "grazing"] },
      { key: "waterways_wetlands", label: "Waterways and wetland management", core: true, kinds: ["stock_access", "stock_exclusion"] },
      { key: "nutrients", label: "Nutrient management", core: true, kinds: ["fertiliser", "nutrients"] },
      { key: "point_sources", label: "Point source management", core: true, kinds: ["offal_pit", "silage", "point_source"] },
      { key: "irrigation", label: "Irrigation management", kinds: ["irrigation"] },
      ...["effluent", "water_use", "biodiversity", "cultural_heritage", "biosecurity"].map((key) => ({ key, label: key.replaceAll("_", " "), kinds: [key], verification: "⚠ Heading applicability requires review" })),
    ],
    vulnerabilities: [["waterlogging", "Waterlogging"], ["p_sediment_runoff", "P and sediment runoff"], ["n_leaching", "N leaching"], ["structural", "Structural vulnerability"]],
    requiredProse: ["summary", "vision", "farm_story", "area.land_soil.description", "area.waterways_wetlands.description", "area.nutrients.description", "area.point_sources.description",
      "cccv.fmu", "cccv.zone", "cccv.objectives", "cccv.tangata_whenua", "cccv.contaminants", "mahinga_kai"],
    requiredElements: [
      { key: "farm_area", label: "Total farm area", verification: null },
      { key: "effective_area", label: "Effective area", verification: null },
      { key: "land_use", label: "Land use", verification: null },
      { key: "overall_risk_significance", label: "Overall risk significance", verification: null },
    ],
    notOwned: ["dairy_grazing"], printFullText: [],
    // Exact source-plan definitions/method text must be loaded as cited prose. Do not invent it.
    boilerplate: {
      copyright: { text: "This document remains the property of the landowners…", citation: "Cairnvale FEP p3 (excerpt; full wording not supplied)" },
      riskMethod: { text: "Risks are assessed using the method in Appendix 2.", citation: "PLAN-VIEW-SPEC §5.7; source method: Cairnvale FEP pp28–29" },
      categories: { regulated: "Regulatory", catchment: "Catchment", supplementary: "Supplementary" },
    },
    verification: "Template requirements not yet verified (crosswalk ⚠)",
  };
});
