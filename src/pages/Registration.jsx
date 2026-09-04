import { useEffect, useMemo, useState } from "react";
import { Registration as RegistrationLegacy } from "./RegistrationLegacy.jsx";
import { RegistrationReviewInbox } from "./RegistrationReviewInbox.jsx";
import { ArrivalOperations, IdentityFoundation } from "./RegistrationOperationsV2.jsx";
import { loadStructureSettings, DEFAULT_STRUCTURE_SETTINGS } from "../lib/operations.js";
import { operationalEligibility } from "../lib/registration.js";
import { formatCount } from "../lib/cohort.js";
import { PageHead, SegmentedControl } from "../components/UI.jsx";
import "./registration-review.css";
import "./registration-v5.css";

const MODE_META = {
  registration: {
    title: "Registration list",
    help: "Keep the official snapshot current, add genuine on-site exceptions safely, and avoid duplicate records.",
  },
  arrival: {
    title: "Arrival",
    help: "See who has checked in, who is still expected, and who needs follow-up without changing the original registration record.",
  },
  identity: {
    title: "FSY IDs",
    help: "Prepare operational IDs, resolve origin and badge-name issues, then finalize when the roster is ready.",
  },
  review: {
    title: "Review inbox",
    help: "Work only the records that need attention and follow the safest next action for each exception.",
  },
};

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
  const modeMeta = MODE_META[mode];

  return <div className="registration-enhanced registration-workspace registration-workspace-v5">
    <section className="page registration-workspace-intro registration-workspace-intro-v5">
      <PageHead
        title="Registration"
        sessionName={sessionName}
        description="Run one clean registration workflow from the current list through arrival, FSY identity, and day-of exceptions."
      />
      <div className="registration-workspace-navigation registration-workspace-navigation-v5">
        <SegmentedControl
          className="registration-mode-switch registration-workspace-tabs registration-workspace-tabs-v5"
          label="Registration workspace"
          value={mode}
          onChange={setMode}
          options={[
            { value: "registration", label: "Registration", id: "registration-mode-registration" },
            { value: "arrival", label: "Arrival", id: "registration-mode-arrival" },
            { value: "identity", label: "FSY IDs", id: "registration-mode-identity" },
            { value: "review", label: "Review", count: cohortSummary?.reviewExceptions || 0, id: "registration-mode-review" },
          ]}
        />
        <div className="registration-mode-cue-v5" role="status">
          <div><span className="kicker">Current work area</span><b>{modeMeta.title}</b></div>
          <p>{modeMeta.help}</p>
          {cohortSummary ? <small><b>{formatCount(cohortSummary.eligible)} eligible youth</b><span>{formatCount(cohortSummary.records)} records{cohortSummary.reviewExceptions ? ` · ${formatCount(cohortSummary.reviewExceptions)} need review` : " · no review exceptions"}</span></small> : null}
        </div>
      </div>
    </section>

    <div className="registration-workspace-pane registration-workspace-pane-v5">
      {mode === "registration" ? <div role="tabpanel" aria-labelledby="registration-mode-registration"><RegistrationLegacy {...props} imported={operationallyMapped} sessionName={sessionName}/></div> : null}
      {mode === "arrival" ? <div role="tabpanel" aria-labelledby="registration-mode-arrival"><ArrivalOperations sessionId={sessionId} capabilities={capabilities} onChanged={onOperationalDataChanged}/></div> : null}
      {mode === "identity" ? <div role="tabpanel" aria-labelledby="registration-mode-identity"><IdentityFoundation sessionId={sessionId} capabilities={capabilities} onChanged={onOperationalDataChanged}/></div> : null}
      {mode === "review" ? <div role="tabpanel" aria-labelledby="registration-mode-review"><RegistrationReviewInbox {...props} structureSettings={structureSettings} sessionName={sessionName}/></div> : null}
    </div>
  </div>;
}
