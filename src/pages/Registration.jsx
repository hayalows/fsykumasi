import { useEffect, useMemo, useState } from "react";
import { PreSessionFinalizationSummary } from "../components/PreSessionFinalizationSummary.jsx";
import { RegistrationJourney } from "./RegistrationJourney.jsx";
import { RegistrationReadinessV30 } from "./RegistrationReadinessV30.jsx";
import { formatCount } from "../lib/cohort.js";
import { registrationBlockerCount } from "../lib/registration-workflow-v30.js";
import { PageHead, SegmentedControl } from "../components/UI.jsx";
import "./registration-review.css";
import "./registration-v5.css";
import "./registration-journey.css";
import "./registration-readiness-v28.css";
import "../pre-session-finalization-v38.css";

const MODE_META = {
  desk: {
    phase: "Arrival desk",
    title: "Live check-in",
    help: "Find the participant and complete normal arrivals quickly. If something needs a decision, move that person to Final roster review.",
  },
  roster: {
    phase: "Pre-session roster",
    title: "Final roster",
    help: "Finish the remaining participant decisions before the session. Included youth continue to placement and identity; people kept out stay in source history but leave active operations.",
  },
  readiness: {
    phase: "Session readiness",
    title: "Readiness",
    help: "Check the final roster, participant identities and Staff coverage before the rehearsal and Day One.",
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
    onNavigate?.({ view: "registration", mode: next, filter: "" });
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
    onCheckin: props.onCheckin,
    onUndoCheckin: props.onUndoCheckin,
    onSetOperationalStatus: props.onSetOperationalStatus,
  };

  return <div className="registration-enhanced registration-workspace registration-workspace-v5 registration-unified registration-v10 registration-v21 registration-v28 registration-v29 registration-workspace-v30">
    <section className="page registration-workspace-intro registration-workspace-intro-v5 registration-unified-intro">
      <PageHead
        title="Registration & check-in"
        sessionName={sessionName}
        description="Finish the participant list before the session, keep normal arrivals fast, and use Readiness for identities and Staff coverage."
      />
      <div className="registration-workspace-navigation registration-workspace-navigation-v5 registration-unified-navigation">
        {canUseRegistrationTools ? <SegmentedControl
          className="registration-mode-switch registration-workspace-tabs registration-workspace-tabs-v5 registration-unified-tabs"
          label="Registration and check-in work area"
          value={mode}
          onChange={chooseMode}
          options={[
            { value: "desk", label: "Live check-in", id: "registration-mode-desk" },
            { value: "roster", label: "Final roster", count: solutionCount, id: "registration-mode-roster" },
            { value: "readiness", label: "Readiness", id: "registration-mode-readiness" },
          ]}
        /> : null}
        <div className="registration-mode-cue-v5" role="status">
          <div><span className="kicker">{modeMeta.phase}</span><b>{modeMeta.title}</b></div>
          <p>{modeMeta.help}</p>
          {cohortSummary ? <small><b>{formatCount(cohortSummary.eligible)} eligible youth</b><span>{formatCount(cohortSummary.records)} registration records{solutionCount ? ` · ${formatCount(solutionCount)} decisions left` : " · final participant list clear"}</span></small> : null}
        </div>
      </div>
    </section>

    <div className="registration-workspace-pane registration-workspace-pane-v5 registration-unified-pane">
      <div role="tabpanel" aria-labelledby={journeyMode === "desk" ? "registration-mode-desk" : "registration-mode-roster"} hidden={mode === "readiness"}>
        {mode === "roster" && live ? <PreSessionFinalizationSummary sessionId={sessionId} onNavigate={onNavigate} /> : null}
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
