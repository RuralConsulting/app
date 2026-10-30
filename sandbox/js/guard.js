// Refuse to show the app inside another site's frame (clickjacking); GitHub Pages can't send frame headers.
if (window.top !== window.self) {
  document.documentElement.style.display = "none";
  try { window.top.location = window.self.location.href; } catch (e) { /* framed by another site: stay hidden */ }
}
