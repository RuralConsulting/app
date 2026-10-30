// SANDBOX build (app/sandbox.cjs): the sandbox Supabase project, not production.
// Public settings. The publishable key is designed to be public: the database's row-level security decides
// what anyone signed in can see (only their own farms). NEVER put a secret (sb_secret_...) key here.
window.FP_CONFIG = {
  supabaseUrl: "https://wmvqncekfartlrxhuplx.supabase.co",
  supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndtdnFuY2VrZmFydGxyeGh1cGx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzMTIxMDIsImV4cCI6MjEwODg4ODEwMn0.GgSQaYlBbdL7Uhl3fFRFAXZjkqMH8QJ2HsfV5F3sljc",

  // LINZ Basemaps API key (basemaps.linz.govt.nz): the aerial background. Browser keys are public by design.
  // A standard key expires after 90 days; a developer key (free, from LINZ) doesn't and can be limited to the
  // app's domain (brand.json): moving domain means updating the key's allowed site at LINZ. With no key the map has a plain background. No other tile provider is used.
  linzKey: "d01m5g152dsk2a73kfxb6a9xf1k",

  // What the farm view shows when it opens. Keys: "extent", "titles", a layer's theme (e.g. "land_units"),
  // or "reference" (the farm's own bores etc.). Everything else starts off and can be switched on.
  // Layers made for a job (measured distances for a consent AEE) are listed under that job.
  farmView: {
    defaultOn: ["extent", "land_units", "plantings"],
  },

  photoLinkSeconds: 3600,
};
