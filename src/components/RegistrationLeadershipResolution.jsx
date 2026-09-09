import { useEffect, useState } from "react";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { ParticipantExceptionForm } from "./ParticipantExceptionForm.jsx";
import { getMyAccessState } from "../lib/backend.js";

const EXCEPTION_REASONS = new Set([
  "Registration is not approved",
  "Too young for this FSY year",
  "Turns 19 before or on the end of this session",
  "Age 19 or older at session start",
]);

export function RegistrationLeadershipResolution({ sessionId, row, eligibility, onResolved }) {
  const [role, setRole] = useState("");
  const [loadingRole, setLoadingRole] = useState(true);
  const reason = eligibility?.eligible === false ? eligibility.reason || "Needs review" : "";
  const relevant = EXCEPTION_REASONS.has(reason);

  useEffect(() => {
    let active = true;
    if (!relevant || !sessionId) { setLoadingRole(false); return () => { active = false; }; }
    setLoadingRole(true);
    getMyAccessState()
      .then((rows) => {
        if (!active) return;
        const grant = (rows || []).find((item) => item.session_id === sessionId && item.active && item.role);
        setRole(grant?.role || "");
      })
      .catch(() => { if (active) setRole(""); })
      .finally(() => { if (active) setLoadingRole(false); });
    return () => { active = false; };
  }, [relevant, sessionId]);

  if (!relevant) return null;
  const canFinalize = ["session_director", "logistics_admin", "coordinator", "area_advisory_couple"].includes(role);

  return <section className="registration-leadership-resolution">
    <div className="registration-leadership-resolution-head">
      <ShieldCheck size={21} weight="fill" aria-hidden="true" />
      <div>
        <b>Final roster decision</b>
        <span>{reason}</span>
      </div>
    </div>
    {loadingRole ? <p>Checking final roster access…</p> : canFinalize ? <>
      <p>Record the local session decision after the required checks are confirmed. The imported registration record stays unchanged.</p>
      <ParticipantExceptionForm person={{...row,id:row.participantId||row.id}} onSaved={onResolved} />
    </> : <>
      <p>This record needs a final session decision before normal check-in. A whole-session leader can record it.</p>
      <span className="registration-resolution-source-note">The source registration status is not changed locally.</span>
    </>}
  </section>;
}
