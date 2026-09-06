import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { installPwaRuntimeGuards } from "./lib/pwa-runtime.js";
import "./styles.css";
import "./runtime.css";
import "./progressive.css";
import "./refinement.css";
import "./mobile-pwa.css";
import "./mobile-nav.css";
import "./mobile-pwa-scroll.css";
import "./interface-system.css";
import "./checkin-snackbar.css";
import "./phase1-refinement.css";
import "./phase2-operations.css";
import "./phase3-reports.css";
import "./modal-system.css";
import "./modal-polish.css";
import "./housing-assignment-v4.css";
import "./housing-operations-v5.css";
import "./housing-room-action-v8.css";
import "./components/staff-role-transition.css";
import "./modal-refinement-v2.css";
import "./sidebar-navigation-v2.css";
import "./registration-modal-v4.css";
import "./registration-checkin-v6.css";
import "./registration-flow-v7.css";
import "./account-page-v9.css";
import "./operations-ux-v10.css";
import "./access-assignments-v11.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

installPwaRuntimeGuards();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((registration) => registration.update()).catch(() => {
      // The app remains fully usable online if service-worker registration is unavailable.
    });
  });
}
