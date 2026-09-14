import { initBridge, renderConsole } from "./bridge.js";
import { renderDashboard, renderNewApplication } from "./dashboard.js";
import { renderApplication } from "./application.js";

const root = document.getElementById("app");

/** Hash router. Pages clean their timers up on the `page:leave` event. */
function route() {
  root.dispatchEvent(new CustomEvent("page:leave"));
  const hash = location.hash || "#/";
  const appMatch = hash.match(/^#\/app\/([a-z0-9-_]+)(?:\/v(\d+))?$/i);

  let nav = "dashboard";
  if (appMatch) {
    renderApplication(root, appMatch[1], appMatch[2] ? Number(appMatch[2]) : null);
  } else if (hash.startsWith("#/new")) {
    nav = "new";
    renderNewApplication(root);
  } else if (hash.startsWith("#/console")) {
    nav = "console";
    renderConsole(root);
  } else {
    renderDashboard(root);
  }

  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === nav));
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);
initBridge();
route();
