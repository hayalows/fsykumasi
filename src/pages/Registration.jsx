import { useEffect, useMemo, useState } from "react";
import { Registration as RegistrationLegacy } from "./RegistrationLegacy.jsx";
import { RegistrationReviewInbox } from "./RegistrationReviewInbox.jsx";
import { loadStructureSettings, DEFAULT_STRUCTURE_SETTINGS } from "../lib/operations.js";
import { operationalEligibility } from "../lib/registration.js";
import "./registration-review.css";

export function Registration(props) {
  const { imported = [], live = false, sessionId, sessionName } = props;
  const [mode, setMode] = useState("registration");
  const [structureSettings, setStructureSettings] = useState(DEFAULT_STRUCTURE_SETTINGS);

  useEffect(() => {
    let active = true;
    if (!live || !sessionId) {
      setStructureSettings(DEFAULT_STRUCTURE_SETTINGS);
      return () => { active = false; };
    }
    loadStructureSettings(sessionId)
      .then((settings) => { if (active) setStructureSettings(settings); })
      .catch(() => { if (active) setStructureSettings(DEFAULT_STRUCTURE_SETTINGS); });
    return () => { active = false; };
  }, [live, sessionId]);

  const operationallyMapped = useMemo(() => imported.map((person) => {
    const eligibility = operationalEligibility(person, structureSettings);
    return eligibility.ok ? person : { ...person, status: "Not eligible" };
  }), [imported, structureSettings]);

  return <div className="registration-enhanced">
    <div className="registration-mode-switch" role="tablist" aria-label="Registration workspace">
      <button className={mode === "registration" ? "active" : ""} onClick={() => setMode("registration")}>Registration</button>
      <button className={mode === "review" ? "active" : ""} onClick={() => setMode("review")}>Review inbox</button>
    </div>

    {mode === "registration"
      ? <RegistrationLegacy {...props} imported={operationallyMapped} sessionName={sessionName}/>
      : <RegistrationReviewInbox {...props} structureSettings={structureSettings} sessionName={sessionName}/>
    }
  </div>;
}

