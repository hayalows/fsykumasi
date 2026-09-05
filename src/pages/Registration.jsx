import { useEffect, useMemo, useState } from "react";
import { Registration as RegistrationLegacy } from "./RegistrationLegacy.jsx";
import { RegistrationReviewInbox } from "./RegistrationReviewInbox.jsx";
import { IdentityFoundation } from "./RegistrationOperationsV2.jsx";
import { RegistrationJourney } from "./RegistrationJourney.jsx";
import { loadStructureSettings, DEFAULT_STRUCTURE_SETTINGS } from "../lib/operations.js";
import { operationalEligibility } from "../lib/registration.js";
import { formatCount } from "../lib/cohort.js";
import { PageHead, SegmentedControl } from "../components/UI.jsx";
import "./registration-review.css";
import "./registration-v5.css";
import "./registration-journey.css";

const MODE_META = {
  desk: {
    title: "Check-in desk",
    help: "Find each youth once. Check in ready participants immediately and resolve on-site or assignment issues without leaving the journey.",
  },
  roster: {
    title: "Roster",
    help: "See the registration list, checked-in youth, on-site additions, assignments, and people who still need attention in one view.",
  },
  setup: {
    title: "Setup & review",
    help: "Maintain the registration source, prepare FSY IDs, and work data exceptions outside the live check-in line.",
  },
};

export function Registration(props) {
  const { imported = [], live = false, sessionId, sessionName, capabilities = [], onOperationalDataChanged } = props;
  const [mode, setMode] = useState("desk");
  const [setupMode, setSetupMode] = useState("registration");
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

  return <div className="registration-enhanced registration-workspace registration-workspace-v5 registration-unified">
    <section className="page registration-workspace-intro registration-workspace-intro-v5 registration-unified-intro">
      <PageHead
        title="Registration & check-in"
        sessionName={sessionName}
        description="One journey from the registration list to arrival. Find the participant, resolve what is needed, and finish check-in without sending them between pages."
      />
      <div className="registration-workspace-navigation registration-workspace-navigation-v5 registration-unified-navigation">
        <SegmentedControl
          className="registration-mode-switch registration-workspace-tabs registration-workspace-tabs-v5 registration-unified-tabs"
          label="Registration and check-in workspace"
          value={mode}
          onChange={setMode}
          options={[
            { value: "desk", label: "Check-in desk", id: "registration-mode-desk" },
            { value: "roster", label: "Roster", id: "registration-mode-roster" },
            { value: "setup", label: "Setup & review", count: cohortSummary?.reviewExceptions || 0, id: "registration-mode-setup" },
          ]}
        />
        <div className="registration-mode-cue-v5" role="status">
          <div><span className="kicker">Current work area</span><b>{modeMeta.title}</b></div>
          <p>{modeMeta.help}</p>
          {cohortSummary ? <small><b>{formatCount(cohortSummary.eligible)} eligible youth</b><span>{formatCount(cohortSummary.records)} registration records{cohortSummary.reviewExceptions ? ` · ${formatCount(cohortSummary.reviewExceptions)} need review` : ""}</span></small> : null}
        </div>
      </div>
    </section>

    <div className="registration-workspace-pane registration-workspace-pane-v5 registration-unified-pane">
      {mode === "desk" ? <div role="tabpanel" aria-labelledby="registration-mode-desk"><RegistrationJourney view="desk" sessionId={sessionId} setImported={props.setImported} capabilities={capabilities} onOperationalDataChanged={onOperationalDataChanged} /></div> : null}
      {mode === "roster" ? <div role="tabpanel" aria-labelledby="registration-mode-roster"><RegistrationJourney view="roster" sessionId={sessionId} setImported={props.setImported} capabilities={capabilities} onOperationalDataChanged={onOperationalDataChanged} /></div> : null}
      {mode === "setup" ? <div role="tabpanel" aria-labelledby="registration-mode-setup" className="registration-setup-shell">
        <div className="registration-setup-nav-wrap">
          <SegmentedControl
            className="registration-setup-tabs"
            label="Registration setup area"
            value={setupMode}
            onChange={setSetupMode}
            options={[
              { value: "registration", label: "Registration source", id: "registration-setup-source" },
              { value: "identity", label: "FSY IDs", id: "registration-setup-identity" },
              { value: "review", label: "Review", count: cohortSummary?.reviewExceptions || 0, id: "registration-setup-review" },
            ]}
          />
        </div>
        {setupMode === "registration" ? <RegistrationLegacy {...props} imported={operationallyMapped} sessionName={sessionName}/> : null}
        {setupMode === "identity" ? <IdentityFoundation sessionId={sessionId} capabilities={capabilities} onChanged={onOperationalDataChanged}/> : null}
        {setupMode === "review" ? <RegistrationReviewInbox {...props} structureSettings={structureSettings} sessionName={sessionName}/> : null}
      </div> : null}
    </div>
  </div>;
}
