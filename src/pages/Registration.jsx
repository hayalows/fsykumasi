import { useEffect, useState } from "react";
import { RegistrationFinalBaselineV21 } from "./RegistrationFinalBaselineV21.jsx";
import { RegistrationReviewInbox } from "./RegistrationReviewInbox.jsx";
import { IdentityFoundationV28 } from "./RegistrationIdentityV28.jsx";
import { RegistrationJourney } from "./RegistrationJourney.jsx";
import { StaffReadiness } from "./StaffReadiness.jsx";
import { loadStructureSettings, DEFAULT_STRUCTURE_SETTINGS } from "../lib/operations.js";
import { formatCount } from "../lib/cohort.js";
import { PageHead, SegmentedControl } from "../components/UI.jsx";
import "./registration-review.css";
import "./registration-v5.css";
import "./registration-journey.css";
import "./registration-readiness-v28.css";

const MODE_META = {
  desk: {
    phase: "Arrival desk",
    title: "Live check-in",
    help: "Search the participant. If something blocks check-in, resolve only that issue and keep the desk moving. Problems continue in Solutions.",
  },
  roster: {
    phase: "Solutions table",
    title: "Resolve issues",
    help: "Work only the people who cannot continue normally: approval, eligibility, placement, identity and on-site registration.",
  },
  setup: {
    phase: "Before session",
    title: "Prepare",
    help: "Review participant and Staff readiness, confirm FSY IDs, and keep the final source roster available when a new official snapshot arrives.",
  },
};

export function Registration(props) {
  const { imported = [], live = false, sessionId, sessionName, capabilities = [], onOperationalDataChanged, initialMode = "desk", initialFilter = "", onNavigate } = props;
  const canUseRegistrationTools = capabilities.includes("registration_view") || capabilities.includes("registration_manage") || !live;
  const normalizedMode = canUseRegistrationTools && ["desk", "roster", "setup"].includes(initialMode) ? initialMode : "desk";
  const [mode, setMode] = useState(normalizedMode);
  const [journeyMode, setJourneyMode] = useState(normalizedMode === "roster" ? "roster" : "desk");
  const [setupMode, setSetupMode] = useState("review");
  const [visitedSetupModes, setVisitedSetupModes] = useState(() => new Set(normalizedMode === "setup" ? ["review"] : []));
  const [structureSettings, setStructureSettings] = useState(DEFAULT_STRUCTURE_SETTINGS);

  const rememberSetup = (next) => setVisitedSetupModes((current) => {
    if (current.has(next)) return current;
    const updated = new Set(current);
    updated.add(next);
    return updated;
  });

  useEffect(() => {
    setMode(normalizedMode);
    if (normalizedMode === "desk" || normalizedMode === "roster") setJourneyMode(normalizedMode);
    if (normalizedMode === "setup") rememberSetup(setupMode);
  }, [normalizedMode]);

  const chooseMode = (next) => {
    setMode(next);
    if (next === "desk" || next === "roster") setJourneyMode(next);
    if (next === "setup") rememberSetup(setupMode);
    onNavigate?.({ view: "registration", mode: next, filter: "" });
  };
  const chooseSetupMode = (next) => {
    setSetupMode(next);
    rememberSetup(next);
  };

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

  return <div className="registration-enhanced registration-workspace registration-workspace-v5 registration-unified registration-v10 registration-v21 registration-v28 registration-v29">
    <section className="page registration-workspace-intro registration-workspace-intro-v5 registration-unified-intro">
      <PageHead
        title="Registration & check-in"
        sessionName={sessionName}
        description="Normal arrivals stay fast. Problems move to Solutions, and preparation work stays separate from the live desk."
      />
      <div className="registration-workspace-navigation registration-workspace-navigation-v5 registration-unified-navigation">
        {canUseRegistrationTools ? <SegmentedControl
          className="registration-mode-switch registration-workspace-tabs registration-workspace-tabs-v5 registration-unified-tabs"
          label="Registration and check-in work area"
          value={mode}
          onChange={chooseMode}
          options={[
            { value: "desk", label: "Live check-in", id: "registration-mode-desk" },
            { value: "roster", label: "Solutions", count: cohortSummary?.reviewExceptions || 0, id: "registration-mode-roster" },
            { value: "setup", label: "Prepare", count: cohortSummary?.reviewExceptions || 0, id: "registration-mode-setup" },
          ]}
        /> : null}
        <div className="registration-mode-cue-v5" role="status">
          <div><span className="kicker">{modeMeta.phase}</span><b>{modeMeta.title}</b></div>
          <p>{modeMeta.help}</p>
          {cohortSummary ? <small><b>{formatCount(cohortSummary.eligible)} eligible youth</b><span>{formatCount(cohortSummary.records)} registration records{cohortSummary.reviewExceptions ? ` · ${formatCount(cohortSummary.reviewExceptions)} need review` : ""}</span></small> : null}
        </div>
      </div>
    </section>

    <div className="registration-workspace-pane registration-workspace-pane-v5 registration-unified-pane">
      <div role="tabpanel" aria-labelledby={journeyMode === "desk" ? "registration-mode-desk" : "registration-mode-roster"} hidden={mode === "setup"}>
        <RegistrationJourney view={journeyMode} {...journeyProps} />
      </div>

      {visitedSetupModes.size ? <div role="tabpanel" aria-labelledby="registration-mode-setup" className="registration-setup-shell" hidden={mode !== "setup"}>
        <div className="registration-setup-nav-wrap">
          <SegmentedControl
            className="registration-setup-tabs"
            label="Registration preparation area"
            value={setupMode}
            onChange={chooseSetupMode}
            options={[
              { value: "review", label: "Preflight review", count: cohortSummary?.reviewExceptions || 0, id: "registration-setup-review" },
              { value: "identity", label: "FSY IDs", id: "registration-setup-identity" },
              { value: "staff", label: "Staff readiness", id: "registration-setup-staff" },
              { value: "final", label: "Final roster", id: "registration-setup-final" },
            ]}
          />
        </div>
        {visitedSetupModes.has("review") ? <div hidden={setupMode !== "review"}><RegistrationReviewInbox {...props} imported={imported} structureSettings={structureSettings} sessionName={sessionName} /></div> : null}
        {visitedSetupModes.has("identity") ? <div hidden={setupMode !== "identity"}><IdentityFoundationV28 sessionId={sessionId} capabilities={capabilities} onChanged={onOperationalDataChanged} /></div> : null}
        {visitedSetupModes.has("staff") ? <div hidden={setupMode !== "staff"}><StaffReadiness sessionId={sessionId} onNavigate={onNavigate} /></div> : null}
        {visitedSetupModes.has("final") ? <div hidden={setupMode !== "final"}><RegistrationFinalBaselineV21 sessionId={sessionId} canManage={props.canManage} setImported={props.setImported} onChanged={handleFinalBaselineChanged} onNavigate={onNavigate} /></div> : null}
      </div> : null}
    </div>
  </div>;
}
