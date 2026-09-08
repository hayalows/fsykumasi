import { useEffect, useMemo, useState } from "react";
import { RegistrationJourney } from "./RegistrationJourney.jsx";
import { RegistrationReadinessV30 } from "./RegistrationReadinessV30.jsx";
import { formatCount } from "../lib/cohort.js";
import { registrationBlockerCount } from "../lib/registration-workflow-v30.js";
import { PageHead, SegmentedControl } from "../components/UI.jsx";
import "./registration-review.css";
import "./registration-v5.css";
import "./registration-journey.css";
import "./registration-readiness-v28.css";

const MODE_META = {
  desk: {
    phase: "Arrival desk",
    title: "Live check-in",
    help: "Find the participant and complete normal arrivals quickly. If something blocks check-in, send only that person to Solutions.",
  },
  roster: {
    phase: "Exception work",
    title: "Solutions",
    help: "One place for participant blockers: approval, eligibility, verification, placement, identity and arrival follow-up.",
  },
  readiness: {
    phase: "Session readiness",
    title: "Readiness",
    help: "See whether the final roster, participant identities and Staff are ready. Participant exceptions stay in Solutions instead of being repeated here.",
  },
};

function normalizeRegistrationMode(initialMode, canUseRegistrationTools) {
  if (!canUseRegistrationTools) return "desk";
  if (initialMode === "setup") return "readiness";
  return ["desk", "roster", "readiness"].includes(initialMode) ? initialMode : "desk";
}

export function Registration(props) {
  const { imported = [], live = false, sessionId, sessionName, capabilities = [], onOperationalDataChanged, initialMode = "desk", initialFilter = "", onNavigate } = props;
  const canUseRegistrationTools = capabilities.includes("registration_view") || capabilities.includes("registration_manage") || !live;
  const normalizedMode = normalizeRegistrationMode(initialMode, canUseRegistrationTools);
  const [mode, setMode] = useState(normalizedMode);
  const [journeyMode, setJourneyMode] = useState(normalizedMode === "roster" ? "roster" : "desk");
  const [readinessVisited, setReadinessVisited] = useState(normalizedMode === "readiness");
  const solutionCount = useMemo(() => registrationBlockerCount(imported), [imported]);

  useEffect(() => {
    setMode(normalizedMode);
    if (normalizedMode === "desk" || normalizedMode === "roster") setJourneyMode(normalizedMode);
    if (normalizedMode === "readiness") setReadinessVisited(true);
  }, [normalizedMode]);

  const chooseMode = (next) => {
    setMode(next);
    if (next === "desk" || next === "roster") setJourneyMode(next);
    if (next === "readiness") setReadinessVisited(true);
    onNavigate?.({ view: "registration", mode: next, filter: next === "roster" ? initialFilter : "" });
  };

  const handleFinalBaselineChanged = async () => {
    await onOperationalDataChanged?.();
    if (typeof window !== "undefined") window.location.reload();
  };

  const cohortSummary = props.cohort;
  const modeMeta = MODE_META[mode];
  const journeyProps = {
    participants: imported,
    initialGroups: props.groups || [],
    initialFilter,
    sessionId,
    capabilities,
    onOperationalDataChanged,
  };

  return <div className="registration-enhanced registration-workspace registration-workspace-v5 registration-unified registration-v10 registration-v21 registration-v28 registration-v29 registration-workspace-v30">
    <section className="page registration-workspace-intro registration-workspace-intro-v5 registration-unified-intro">
      <PageHead
        title="Registration & check-in"
        sessionName={sessionName}
        description="Keep normal arrivals fast. Resolve participant blockers in one Solutions queue, and use Readiness for the supporting setup."
      />
      <div className="registration-workspace-navigation registration-workspace-navigation-v5 registration-unified-navigation">
        {canUseRegistrationTools ? <SegmentedControl
          className="registration-mode-switch registration-workspace-tabs registration-workspace-tabs-v5 registration-unified-tabs"
          label="Registration and check-in work area"
          value={mode}
          onChange={chooseMode}
          options={[
            { value: "desk", label: "Live check-in", id: "registration-mode-desk" },
            { value: "roster", label: "Solutions", count: solutionCount, id: "registration-mode-roster" },
            { value: "readiness", label: "Readiness", id: "registration-mode-readiness" },
          ]}
        /> : null}
        <div className="registration-mode-cue-v5" role="status">
          <div><span className="kicker">{modeMeta.phase}</span><b>{modeMeta.title}</b></div>
          <p>{modeMeta.help}</p>
          {cohortSummary ? <small><b>{formatCount(cohortSummary.eligible)} eligible youth</b><span>{formatCount(cohortSummary.records)} registration records{solutionCount ? ` · ${formatCount(solutionCount)} blocked` : " · no participant blockers"}</span></small> : null}
        </div>
      </div>
    </section>

    <div className="registration-workspace-pane registration-workspace-pane-v5 registration-unified-pane">
      <div role="tabpanel" aria-labelledby={journeyMode === "desk" ? "registration-mode-desk" : "registration-mode-roster"} hidden={mode === "readiness"}>
        <RegistrationJourney view={journeyMode} {...journeyProps} />
      </div>

      {readinessVisited ? <div role="tabpanel" aria-labelledby="registration-mode-readiness" hidden={mode !== "readiness"}>
        <RegistrationReadinessV30
          imported={imported}
          cohort={cohortSummary}
          live={live}
          sessionId={sessionId}
          capabilities={capabilities}
          canManage={props.canManage}
          setImported={props.setImported}
          onChanged={onOperationalDataChanged}
          onFinalBaselineChanged={handleFinalBaselineChanged}
          onNavigate={onNavigate}
        />
      </div> : null}
    </div>
  </div>;
}
