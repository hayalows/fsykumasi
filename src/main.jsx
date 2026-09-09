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
import "./access-assignments-v12.css";
import "./access-assignments-v12-fix.css";
import "./operations-reliability-v12.css";
import "./housing-ux-v13.css";
import "./housing-ux-v14.css";
import "./access-assignments-v15.css";
import "./access-operations-v16.css";
import "./ux-foundation-v30.css";
import "./phase3-context-v31.css";
import "./phase4-operations-v32.css";
import "./phase5-release-v33.css";
import "./pages/wellness-v35.css";
import "./operations-product-v36.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <div id="route-announcer" role="status" aria-live="polite" aria-atomic="true" />
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
