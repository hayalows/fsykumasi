import { useEffect, useState } from "react";
import { ParticipantGroundRoster } from "./ParticipantGroundRoster.jsx";
import { RegistrationJourneyV53 as RegistrationJourney } from "./RegistrationJourneyV53.jsx";
import { RegistrationReadinessV30 } from "./RegistrationReadinessV30.jsx";
import { SessionFinalization } from "./SessionFinalization.jsx";
import { StaffCheckin } from "./StaffCheckin.jsx";
import { PageHead, SegmentedControl } from "../components/UI.jsx";
import { attemptParticipantMembershipCheckin, undoParticipantMembershipCheckin } from "../lib/participant-membership.js";
import "./registration-review.css";
import "./registration-v5.css";
import "./registration-journey.css";
import "./registration-readiness-v28.css";
import "./registration-workspace.css";
import "./registration-journey-v31.css";
import "../participant-membership-v54.css";
import "../participant-membership-v55.css";
import "./registration-arrival-v60.css";

const MODE_META = {
  desk: {
    phase: "Participant arrival",
    title: "Live check-in",
    help: "Work from the people who are physically here. Find the participant, use live group capacity, and record arrival without letting no-shows consume places.",
  },
  staff: {
    phase: "Staff arrival",
    title: "Staff check-in",
    help: "Find the staff member and record physical arrival. Planning, clearance and responsibilities stay in Staff status.",
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

function normalizeRegistrationMode(initialMode, canUseParticipantDesk, canUseParticipantRegistration, canUseStaffCheckin) {
  if (initialMode === "setup" && canUseParticipantRegistration) return "readiness";
  if (initialMode === "staff" && canUseStaffCheckin) return "staff";
  if (initialMode === "desk" && canUseParticipantDesk) return "desk";
  if (initialMode === "roster" && canUseParticipantRegistration) return "roster";
  if (initialMode === "readiness" && canUseParticipantRegistration) return "readiness";
  if (canUseStaffCheckin) return "staff";
  return "desk";
}

export function Registration(props) {
  const { imported = [], live = false, sessionId, sessionName, capabilities = [], onOperationalDataChanged, initialMode = "desk", initialFilter = "", onNavigate } = props;
  const canUseParticipantRegistration = capabilities.includes("registration_view") || capabilities.includes("registration_manage") || !live;
  const canUseParticipantDesk = canUseParticipantRegistration || capabilities.includes("checkin_record");
  const canUseStaffCheckin = capabilities.includes("registration_manage") || capabilities.includes("staff_manage") || !live;
  const canUseGroundRoster = live && capabilities.includes("registration_manage");
  const canUseRegistrationTools = canUseParticipantDesk || canUseStaffCheckin;
  const normalizedMode = normalizeRegistrationMode(initialMode, canUseParticipantDesk, canUseParticipantRegistration, canUseStaffCheckin);
  const [mode, setMode] = useState(normalizedMode);
  const [journeyMode, setJourneyMode] = useState(normalizedMode === "roster" ? "roster" : "desk");
  const [readinessVisited, setReadinessVisited] = useState(normalizedMode === "readiness");
  const [staffVisited, setStaffVisited] = useState(normalizedMode === "staff");

  useEffect(() => {
    setMode(normalizedMode);
    if (normalizedMode === "desk" || normalizedMode === "roster") setJourneyMode(normalizedMode);
    if (normalizedMode === "readiness") setReadinessVisited(true);
    if (normalizedMode === "staff") setStaffVisited(true);
  }, [normalizedMode]);

  const chooseMode = (next) => {
    if (next === "staff" && !canUseStaffCheckin) return;
    if (["desk", "roster", "readiness"].includes(next) && !canUseParticipantDesk) return;
    setMode(next);
    if (next === "desk" || next === "roster") setJourneyMode(next);
    if (next === "readiness") setReadinessVisited(true);
    if (next === "staff") setStaffVisited(true);
    onNavigate?.({ view: "registration", mode: next, filter: "" });
  };

  const handleFinalBaselineChanged = async () => {
    await onOperationalDataChanged?.();
    if (typeof window !== "undefined") window.location.reload();
  };

  const membershipAwareCheckin = async (participantId, status) => {
    if (!sessionId || status !== "arrived") return props.onCheckin?.(participantId, status);
    return attemptParticipantMembershipCheckin({ sessionId, participantId });
  };

  const membershipAwareUndo = async (participantId, expectedRecordedAt) => {
    if (!sessionId) return props.onUndoCheckin?.(participantId, expectedRecordedAt);
    return undoParticipantMembershipCheckin({ sessionId, participantId, expectedRecordedAt });
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
    onCheckin: membershipAwareCheckin,
    onUndoCheckin: membershipAwareUndo,
    onSetOperationalStatus: props.onSetOperationalStatus,
  };

  const modeOptions = [
    ...(canUseParticipantDesk ? [{ value: "desk", label: "Live check-in", id: "registration-mode-desk" }] : []),
    ...(canUseStaffCheckin ? [{ value: "staff", label: "Staff", id: "registration-mode-staff" }] : []),
    ...(canUseParticipantRegistration ? [
      { value: "roster", label: "Final roster", id: "registration-mode-roster" },
      { value: "readiness", label: "Readiness", id: "registration-mode-readiness" },
    ] : []),
  ];

  const arrivalGuide = mode === "desk"
    ? <p className="registration-arrival-guide-v60"><b>Find → place → check in.</b><span>{canUseGroundRoster ? "Only participants who are physically checked in consume the live 15-person group capacity." : "Search includes checked-in participants too, so an accidental check-in can be opened and undone."}</span></p>
    : mode === "staff"
      ? <p className="registration-arrival-guide-v60"><b>Find → check in → next.</b><span>If you tap the wrong person, use Undo. No-show and left stay in Staff status.</span></p>
      : null;

  return <div className={`registration-enhanced registration-workspace registration-workspace-v5 registration-unified registration-v10 registration-v21 registration-v28 registration-v29 registration-workspace-v30 registration-arrival-v60 registration-mode-${mode}`}>
    <section className="page registration-workspace-intro registration-workspace-intro-v5 registration-unified-intro">
      <PageHead title="Registration & check-in" sessionName={sessionName} description={modeMeta.help} />
      <div className="registration-workspace-navigation registration-workspace-navigation-v5 registration-unified-navigation">
        {canUseRegistrationTools && modeOptions.length > 1 ? <SegmentedControl className="registration-mode-switch registration-workspace-tabs registration-workspace-tabs-v5 registration-unified-tabs" label="Registration and check-in work area" value={mode} onChange={chooseMode} options={modeOptions} /> : null}
        {arrivalGuide}
      </div>
    </section>

    <div className="registration-workspace-pane registration-workspace-pane-v5 registration-unified-pane">
      {canUseParticipantDesk ? <div role="tabpanel" aria-labelledby={journeyMode === "desk" ? "registration-mode-desk" : "registration-mode-roster"} hidden={mode === "readiness" || mode === "staff"}>
        {mode === "roster" && live ? <SessionFinalization sessionId={sessionId} onChanged={onOperationalDataChanged} onNavigate={onNavigate} /> : null}
        {mode === "desk" && canUseGroundRoster
          ? <ParticipantGroundRoster sessionId={sessionId} onOperationalDataChanged={onOperationalDataChanged} onNavigate={onNavigate} />
          : <RegistrationJourney view={journeyMode} {...journeyProps} />}
      </div> : null}

      {staffVisited ? <div role="tabpanel" aria-labelledby="registration-mode-staff" hidden={mode !== "staff"}>
        <StaffCheckin sessionId={sessionId} live={live} capabilities={capabilities} />
      </div> : null}

      {readinessVisited ? <div role="tabpanel" aria-labelledby="registration-mode-readiness" hidden={mode !== "readiness"}>
        <RegistrationReadinessV30 imported={imported} cohort={cohortSummary} live={live} sessionId={sessionId} capabilities={capabilities} canManage={props.canManage} setImported={props.setImported} onChanged={onOperationalDataChanged} onFinalBaselineChanged={handleFinalBaselineChanged} onNavigate={onNavigate} />
      </div> : null}
    </div>
  </div>;
}
