// Public settings. The publishable key is designed to be public: the database's row-level security decides
// what anyone signed in can see (only their own farms). NEVER put a secret (sb_secret_...) key here.
window.FP_CONFIG = {
  supabaseUrl: "https://swbpymacxycbmdbexnuw.supabase.co",
  supabaseKey: "sb_publishable_ezMJPCuTFBl3wQAVeOJPXg_BoXxVY8A",

  // LINZ Basemaps API key (basemaps.linz.govt.nz): the aerial background. Browser keys are public by design.
  // A standard key expires after 90 days; a developer key (free, from LINZ) doesn't and can be limited to the
  // app's domain (brand.json): moving domain means updating the key's allowed site at LINZ. With no key the map has a plain background. No other tile provider is used.
  linzKey: "d01m5g152dsk2a73kfxb6a9xf1k",

  // What the farm view shows when it opens: the quiet map (E5, Josh 31 Oct): the farm boundary. Photos is on, but its
  // pins show only once the map is zoomed in past the farm's frame (FP.photoModel.pinsShown). Land units are the FEP's
  // and come up by context (farm-space.js sceneFor), as the FEP's other layers do. Keys:
  // "extent", "titles", a layer's theme (e.g. "land_units"), a reference source's key (e.g. "ecan-wells") or
  // "reference" (every reference row). Everything else comes up by context (farm-space.js sceneFor) or a switch in
  // Layers. Layers made for a job (measured distances for a consent AEE) are listed under that job.
  farmView: {
    defaultOn: ["extent", "photos"],
    // PERF1b: the reference rows read ahead, one at a time, once the farm is drawn and the map is idle: what the standing
    // answers most often bring up (Rivers, bores, consents, water-quality sites). Every other source is read when
    // something switches it on; the region-wide zone polygons are never read ahead.
    prefetch: ["rivers", "ecan-wells", "ecan-consents", "ecan-wq-sites"],
  },
  // PERF3b: what a catchment group's map opens with when one of its layers is too large to come inline (group_map's
  // `deferred`): the group's area, the member farms, its member blocks (read once for the frame, simplified) and Rivers;
  // paddocks and the farm-plan layers are a switch away, read for the map in view. A group with every layer inline opens
  // with them all, as before. maxFeatures: more than this in view and the layer asks the person to zoom in. prefetch: the
  // reference sources read ahead once the group is drawn and the map is idle (never a zone polygon).
  groupView: {
    defaultOn: ["extent", "member_farms", "member_blocks", "rivers"],
    maxFeatures: 4000,
    prefetch: ["ecan-wq-sites"],
  },

  photoLinkSeconds: 3600,
};
