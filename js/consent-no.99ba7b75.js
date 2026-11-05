// What an ECan consent number looks like (ECAN1): the one definition the app uses.
//
// ECan writes a consent number as a prefix, six digits, an optional letter and an optional version: CRC000369, CRC000369A,
// CRC000369.1, CRC000369.12, CRC000369A.1. The prefix is one of five: CRC, and the legacy catchment boards' NCY, SCY, WTK and MLB
// (all live in ECan's consents: MLB760076, MLB770012A, NCY690326.1, NCY780884B.1). An explicit list, not any three letters:
// ABC123456 is not a consent number. The same definition lives once in each layer: the database (app.consent_no_pattern(),
// migration 20261106029000) and the tools (tools/consent_no.py). If you change this one, change those and the cases in
// tests/app/consent-no.test.cjs, tests/db/consent_no_pattern.test.sql and tests/tools/test_consent_no.py, which pin all three to
// the same table.
//
//   isConsentNo(s)  s, upper-cased and with its spaces removed, is a consent number
//   normalise(s)    upper case, whitespace removed (how the register and the documents' numbers are compared)
//   find(text)      the distinct numbers a text names (a title, a file name), normalised, in order of first appearance. One space
//                   after the prefix is allowed and any case; the letter only counts when no letter or digit follows it
//                   ("CRC000369Decision.pdf" and "CRC000369v2.pdf" name CRC000369, not CRC000369D / CRC000369V); NCY, SCY, WTK and
//                   MLB only count when no letter comes before them ("Tenancy 202401" is not NCY202401; CRC has no such rule)
//   CONSENT_NO      the normalised form as a RegExp; IN_TEXT the in-text form (global, case-insensitive: use through find())
//
// Not used for "Fetch conditions from ECan" (consent-conditions.js, farm-model.js, checklist.js and the consent-conditions and
// ask functions keep their own, older form, CRC only): that path sends the number to ECan's open data portal, and a letter-suffixed
// or legacy-prefix number has not been confirmed to be accepted there.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.consentNo = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  const PREFIXES = ["CRC", "NCY", "SCY", "WTK", "MLB"];
  const PREFIX = "(?:" + PREFIXES.join("|") + ")";
  const BODY = "[0-9]{6}(?:[A-Z](?![A-Z0-9]))?(?:\\.[0-9]{1,2})?";
  const CONSENT_NO = new RegExp("^" + PREFIX + BODY + "$");
  // in a text the legacy prefixes need a non-letter before them (Tenancy 202401 is not NCY202401); CRC does not (XCRC123456 names CRC123456)
  const IN_TEXT = new RegExp("(?:CRC|(?<![A-Z])(?:NCY|SCY|WTK|MLB))\\s?" + BODY, "gi");
  const normalise = (s) => String(s ?? "").replace(/\s/g, "").toUpperCase();
  const isConsentNo = (s) => CONSENT_NO.test(normalise(s));
  const find = (text) => [...new Set([...String(text ?? "").matchAll(IN_TEXT)].map((m) => normalise(m[0])))];
  return { PREFIXES, CONSENT_NO, IN_TEXT, normalise, isConsentNo, find };
});
