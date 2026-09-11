import { useEffect, useState } from "react";
import { ParticipantMembershipPanel } from "../components/ParticipantMembershipPanel.jsx";
import { RegistrationJourney } from "./RegistrationJourney.jsx";
import { RegistrationReadinessV30 } from "./RegistrationReadinessV30.jsx";
import { SessionFinalization } from "./SessionFinalization.jsx";
import { PageHead, SegmentedControl } from "../components/UI.jsx";
import "./registration-review.css";
import "./registration-v5.css";
import "./registration-journey.css";
import "./registration-readiness-v28.css";
import "./registration-workspace.css";
import "./registration-journey-v31.css";

const MODE_META = {
  desk: {
    phase: "Arrival desk",
    title: "Live check-in",
    help: "Search, finish any one missing step, then check the participant in.",
  },
  roster: {
    phase: "Final roster",
    title: "Final roster",
    help: "See the settled roster and handle only new arrivals or real exceptions.",
  },
  readiness: {
    phase: "Session readiness",
    title: "Readiness",
    help: "Check the remaining setup work before Day One.",
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

  return <div className={`registration-enhanced registration-workspace registration-workspace-v5 registration-unified registration-v10 registration-v21 registration-v28 registration-v29 registration-workspace-v30 registration-mode-${mode}`}>
    <section className="page registration-workspace-intro registration-workspace-intro-v5 registration-unified-intro">
      <PageHead title="Registration & check-in" sessionName={sessionName} description="Finish each participant's next step, then move on." />
      <div className="registration-workspace-navigation registration-workspace-navigation-v5 registration-unified-navigation">
        {canUseRegistrationTools ? <SegmentedControl className="registration-mode-switch registration-workspace-tabs registration-workspace-tabs-v5 registration-unified-tabs" label="Registration and check-in work area" value={mode} onChange={chooseMode} options={[
          { value: "desk", label: "Live check-in", id: "registration-mode-desk" },
          { value: "roster", label: "Final roster", id: "registration-mode-roster" },
          { value: "readiness", label: "Readiness", id: "registration-mode-readiness" },
        ]} /> : null}
        <div className="registration-mode-cue-v5 registration-mode-cue-compact" data-mode={mode} role="status" aria-label={`${modeMeta.title}. ${modeMeta.help}`}>
          <div className="registration-mode-copy"><span className="kicker">{modeMeta.phase}</span><p>{modeMeta.help}</p></div>
        </div>
      </div>
    </section>

    <div className="registration-workspace-pane registration-workspace-pane-v5 registration-unified-pane">
      <ParticipantMembershipPanel sessionId={sessionId} participants={imported} capabilities={capabilities} live={live} mode={mode} sessionName={sessionName} />

      <div role="tabpanel" aria-labelledby={journeyMode === "desk" ? "registration-mode-desk" : "registration-mode-roster"} hidden={mode === "readiness"}>
        {mode === "roster" && live ? <SessionFinalization sessionId={sessionId} onChanged={onOperationalDataChanged} onNavigate={onNavigate} /> : null}
        <RegistrationJourney view={journeyMode} {...journeyProps} />
      </div>

      {readinessVisited ? <div role="tabpanel" aria-labelledby="registration-mode-readiness" hidden={mode !== "readiness"}>
        <RegistrationReadinessV30 imported={imported} cohort={cohortSummary} live={live} sessionId={sessionId} capabilities={capabilities} canManage={props.canManage} setImported={props.setImported} onChanged={onOperationalDataChanged} onFinalBaselineChanged={handleFinalBaselineChanged} onNavigate={onNavigate} />
      </div> : null}
    </div>
  </div>;
}
