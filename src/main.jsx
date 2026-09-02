import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";
import "./runtime.css";
import "./progressive.css";
import "./refinement.css";
import "./mobile-pwa.css";
import "./mobile-nav.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((registration) => registration.update()).catch(() => {
      // The app remains fully usable online if service-worker registration is unavailable.
    });
  });
}
