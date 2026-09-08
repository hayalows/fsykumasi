import { useEffect, useState } from "react";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { ParticipantExceptionForm } from "./ParticipantExceptionForm.jsx";
import { getMyAccessState } from "../lib/backend.js";

const EXCEPTION_REASONS = new Set([
  "Registration is not approved",
  "Too young for this FSY year",
  "Turns 19 before or on the end of this session",
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
  const director = role === "session_director";

  return <section className="registration-leadership-resolution">
    <div className="registration-leadership-resolution-head">
      <ShieldCheck size={21} weight="fill" aria-hidden="true" />
      <div>
        <b>Solutions Table decision</b>
        <span>{reason}</span>
      </div>
    </div>
    {loadingRole ? <p>Checking who can record this decision…</p> : director ? <>
      <p>The source registration stays unchanged. Record the authorized session decision only after the required registration, guardian and bishop/branch-president or FSY leadership checks are complete.</p>
      <ParticipantExceptionForm person={{...row,id:row.participantId||row.id}} onSaved={onResolved} />
    </> : <>
      <p>This participant cannot be cleared from the normal check-in desk. Send them to the Solutions Table. A Session Directing Couple must record the authorized participation decision after the required checks are confirmed.</p>
      <span className="registration-resolution-source-note">Do not change the official registration status locally.</span>
    </>}
  </section>;
}
