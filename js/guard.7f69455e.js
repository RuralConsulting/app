// Refuse to show the app inside another site's frame (clickjacking); GitHub Pages can't send frame headers.
if (window.top !== window.self) {
  document.documentElement.style.display = "none";
  try { window.top.location = window.self.location.href; } catch (e) { /* framed by another site: stay hidden */ }
}
// PERF1b: the page's start, marked by its first script (since TIM1 the drawn-time measures start at their route instead: route-timing.js).
try { performance.mark("fp-page-start"); } catch (e) { /* no performance API: no figure */ }
