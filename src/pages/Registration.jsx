import { useEffect, useMemo, useState } from "react";
import { Registration as RegistrationLegacy } from "./RegistrationLegacy.jsx";
import { RegistrationReviewInbox } from "./RegistrationReviewInbox.jsx";
import { ArrivalOperations, IdentityFoundation } from "./RegistrationOperations.jsx";
import { loadStructureSettings, DEFAULT_STRUCTURE_SETTINGS } from "../lib/operations.js";
import { operationalEligibility } from "../lib/registration.js";
import { formatCount } from "../lib/cohort.js";
import { PageHead, SegmentedControl } from "../components/UI.jsx";
import "./registration-review.css";

export function Registration(props) {
  const { imported = [], live = false, sessionId, sessionName, capabilities = [], onOperationalDataChanged } = props;
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

  const cohortSummary = props.cohort;

  return <div className="registration-enhanced registration-workspace">
    <section className="page registration-workspace-intro">
      <PageHead
        title="Registration"
        sessionName={sessionName}
        description="Keep one current registration list, reconcile arrivals, issue operational FSY IDs, and resolve exceptions without creating duplicate records."
      />
      <div className="registration-workspace-navigation">
        <SegmentedControl
          className="registration-mode-switch registration-workspace-tabs"
          label="Registration workspace"
          value={mode}
          onChange={setMode}
          options={[
            { value: "registration", label: "Registration", id: "registration-mode-registration" },
            { value: "arrival", label: "Arrival", id: "registration-mode-arrival" },
            { value: "identity", label: "FSY IDs", id: "registration-mode-identity" },
            { value: "review", label: "Review inbox", count: cohortSummary?.reviewExceptions || 0, id: "registration-mode-review" },
          ]}
        />
        {cohortSummary ? <p className="cohort-context" role="status">
          <b>{formatCount(cohortSummary.eligible)} eligible youth</b>
          <span>{formatCount(cohortSummary.records)} registration records · {cohortSummary.reviewExceptions ? `${formatCount(cohortSummary.reviewExceptions)} data exceptions` : cohortSummary.unassigned ? `${formatCount(cohortSummary.unassigned)} ready for placement` : "no data exceptions"}</span>
        </p> : null}
      </div>
    </section>

    <div className="registration-workspace-pane">
      {mode === "registration" ? <div role="tabpanel" aria-labelledby="registration-mode-registration"><RegistrationLegacy {...props} imported={operationallyMapped} sessionName={sessionName}/></div> : null}
      {mode === "arrival" ? <div role="tabpanel" aria-labelledby="registration-mode-arrival"><ArrivalOperations sessionId={sessionId} capabilities={capabilities} onChanged={onOperationalDataChanged}/></div> : null}
      {mode === "identity" ? <div role="tabpanel" aria-labelledby="registration-mode-identity"><IdentityFoundation sessionId={sessionId} capabilities={capabilities} onChanged={onOperationalDataChanged}/></div> : null}
      {mode === "review" ? <div role="tabpanel" aria-labelledby="registration-mode-review"><RegistrationReviewInbox {...props} structureSettings={structureSettings} sessionName={sessionName}/></div> : null}
    </div>
  </div>;
}
