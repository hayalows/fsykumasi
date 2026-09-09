import { useMemo, useState } from "react";
import { ArrowLeft } from "@phosphor-icons/react/ArrowLeft";
import { Bed } from "@phosphor-icons/react/Bed";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { PencilSimple } from "@phosphor-icons/react/PencilSimple";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { ActionToast, ConfirmActionSheet, DismissibleLayer, Empty, MutationFeedback, SearchField } from "../components/UI.jsx";
import { clearHousingAssignment, loadHousingRooms, restoreHousingAssignment } from "../lib/field-operations.js";
import { saveHousingAssignment } from "../lib/housing-actions.js";
import { loadHousingAssignmentsV2 } from "../lib/housing-context.js";
import { initials, roomHasWayfinding, roomLocation, sexLabel } from "./HousingDialogsV4.jsx";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const CANDIDATE_BATCH = 50;

function personKey(person) {
  return `${person.kind}:${person.id}`;
}

function candidateReason(person, waitingKeys, occupantGroups, occupantCompanies) {
  const waiting = waitingKeys.has(personKey(person));
  const sameGroup = Boolean(person.group && occupantGroups.has(person.group));
  const sameCompany = Boolean(person.company && occupantCompanies.has(person.company));
  const score = (waiting ? 10000 : 0) + (sameGroup ? 1000 : 0) + (sameCompany ? 300 : 0);
  const label = waiting ? "Checked in" : sameGroup ? "Same counselor group" : sameCompany ? "Same company" : "Needs room";
  return { waiting, sameGroup, sameCompany, score, label };
}

export function RoomDetailV6({
  sessionId,
  room,
  assignments = [],
  people = [],
  waitingPeople = [],
  canManage,
  onClose,
  onEdit,
  onSaved,
  onRefresh,
}) {
  const [mode, setMode] = useState("detail");
  const [query, setQuery] = useState("");
  const [personType, setPersonType] = useState("all");
  const [candidateLimit, setCandidateLimit] = useState(CANDIDATE_BATCH);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [bedLabel, setBedLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removeTarget, setRemoveTarget] = useState(null);
  const [undoAssignment, setUndoAssignment] = useState(null);
  const [undoBusy, setUndoBusy] = useState(false);

  const occupants = useMemo(() => assignments.filter((item) => item.roomId === room.id), [assignments, room.id]);
  const assignedKeys = useMemo(() => new Set(assignments.map((item) => `${item.personType}:${item.personId}`)), [assignments]);
  const waitingKeys = useMemo(() => new Set(waitingPeople.map(personKey)), [waitingPeople]);
  const occupantGroups = useMemo(() => new Set(occupants.map((item) => item.group).filter(Boolean)), [occupants]);
  const occupantCompanies = useMemo(() => new Set(occupants.map((item) => item.company).filter(Boolean)), [occupants]);
  const open = Math.max(0, Number(room.capacity || 0) - occupants.length);
  const percent = Math.min(100, (occupants.length / Math.max(1, Number(room.capacity || 0))) * 100);
  const locationReady = roomHasWayfinding(room);

  const candidates = useMemo(() => {
    const text = query.trim().toLowerCase();
    return people
      .filter((person) => !assignedKeys.has(personKey(person)))
      .filter((person) => !room.sex || person.sex === room.sex)
      .filter((person) => personType === "all" || person.kind === personType)
      .filter((person) => !text || `${person.name} ${person.context} ${person.group || ""} ${person.company || ""}`.toLowerCase().includes(text))
      .map((person) => ({ person, reason: candidateReason(person, waitingKeys, occupantGroups, occupantCompanies) }))
      .sort((a, b) => b.reason.score - a.reason.score || collator.compare(a.person.name, b.person.name));
  }, [people, assignedKeys, room.sex, personType, query, waitingKeys, occupantGroups, occupantCompanies]);

  const visibleCandidates = candidates.slice(0, candidateLimit);
  const hasParticipants = candidates.some(({ person }) => person.kind === "participant");
  const hasStaff = candidates.some(({ person }) => person.kind === "staff");

  const beginAdd = () => {
    if (!canManage || !locationReady || open < 1) return;
    setMode("add");
    setQuery("");
    setPersonType("all");
    setCandidateLimit(CANDIDATE_BATCH);
    setSelectedPerson(null);
    setBedLabel("");
    setError("");
  };

  const assign = async () => {
    if (!selectedPerson || busy) return;
    setBusy(true);
    setError("");
    try {
      const [latestAssignments, latestRooms] = await Promise.all([
        loadHousingAssignmentsV2(sessionId),
        loadHousingRooms(sessionId),
      ]);
      const alreadyAssigned = latestAssignments.find((item) => item.personType === selectedPerson.kind && item.personId === selectedPerson.id);
      if (alreadyAssigned) {
        setError(`${selectedPerson.name} was assigned to ${alreadyAssigned.roomName || "another room"} while this room was open. Housing has been refreshed.`);
        await onRefresh?.();
        return;
      }
      const latestRoom = latestRooms.find((item) => item.id === room.id);
      if (!latestRoom || !roomHasWayfinding(latestRoom) || Number(latestRoom.occupancy || 0) >= Number(latestRoom.capacity || 0)) {
        setError("This room is no longer available for a new assignment. Housing has been refreshed.");
        await onRefresh?.();
        return;
      }
      await saveHousingAssignment({
        sessionId,
        personType: selectedPerson.kind,
        personId: selectedPerson.id,
        roomId: room.id,
        bedLabel,
        moveReason: "",
      });
      await onSaved?.(selectedPerson);
      setSelectedPerson(null);
      setBedLabel("");
      setQuery("");
      setMode("detail");
    } catch (err) {
      setError(err.message || "Unable to assign this person to the room.");
    } finally {
      setBusy(false);
    }
  };

  const unassign = async () => {
    if (!removeTarget?.id || busy) return;
    const target = removeTarget;
    setBusy(true);
    setError("");
    try {
      await clearHousingAssignment({
        sessionId,
        personType: target.personType,
        personId: target.personId,
        assignmentId: target.id,
      });
      setRemoveTarget(null);
      setUndoAssignment(target);
      await onRefresh?.();
    } catch (err) {
      setError(err.message || "This room assignment could not be removed. It may have changed elsewhere. Housing has been refreshed.");
      setRemoveTarget(null);
      await onRefresh?.();
    } finally {
      setBusy(false);
    }
  };

  const undoUnassign = async () => {
    if (!undoAssignment?.id || undoBusy) return;
    const target = undoAssignment;
    setUndoBusy(true);
    setError("");
    try {
      await restoreHousingAssignment({ sessionId, assignmentId: target.id });
      setUndoAssignment(null);
      await onRefresh?.();
    } catch (err) {
      setUndoAssignment(null);
      setError(err.message || "The previous room could not be restored. Review the person's current Housing state before assigning again.");
      await onRefresh?.();
    } finally {
      setUndoBusy(false);
    }
  };

  return <DismissibleLayer open onClose={onClose} title={room.name} sheet className="housing-v4-room-detail-layer housing-v6-room-detail-layer housing-v36-room-detail-layer">
    <div className="housing-v4-modal housing-v6-room-detail-modal">
      <header className="housing-v4-modal-head housing-v6-room-detail-head">
        <div>
          <span className="kicker">{mode === "add" ? "Add to room" : "Housing room"}</span>
          <h2>{room.name}</h2>
          <p>{roomLocation(room)}</p>
        </div>
        <button type="button" data-layer-close className="icon-button" onClick={onClose} disabled={busy || undoBusy} aria-label="Close"><X/></button>
      </header>

      <div className="housing-v4-modal-body housing-v6-room-detail-body">
        {mode === "detail" ? <>
          <div className="housing-v4-room-overview">
            <div><span>Occupancy</span><b>{occupants.length}/{room.capacity}</b><small>{open ? `${open} space${open === 1 ? "" : "s"} open` : "Room is full"}</small></div>
            <div><span>Room use</span><b>{room.sex ? sexLabel(room.sex) : "Any"}</b><small>{room.sex ? `${sexLabel(room.sex)} housing` : "No restriction"}</small></div>
            <i><span style={{ width: `${percent}%` }}/></i>
          </div>

          {!locationReady ? <div className="housing-location-warning"><WarningCircle/><span><b>Location needed before another assignment</b><small>Add building or floor details so staff can actually find this room.</small></span></div> : null}
          {room.notes ? <div className="housing-v4-note"><b>Room note</b><p>{room.notes}</p></div> : null}

          <section>
            <div className="housing-v4-section-head housing-v6-room-section-head">
              <div><h3>People in this room</h3><p>{occupants.length ? `${occupants.length} assigned · ${open} remaining` : `No one assigned · ${room.capacity} spaces available`}</p></div>
              {canManage ? <div className="housing-v6-room-actions">
                {open > 0 && locationReady ? <button type="button" className="primary" onClick={beginAdd}><UserPlus/>Add person</button> : null}
                <button type="button" className="secondary" onClick={onEdit}><PencilSimple/>Edit room</button>
              </div> : null}
            </div>
            <div className="housing-v4-occupants housing-v36-occupants">
              {occupants.map((item) => <div key={item.id} className="housing-v36-occupant-row"><span className="person-avatar">{initials(item.name)}</span><span className="housing-v36-occupant-copy"><b>{item.name}</b><small>{item.personType === "staff" ? `Staff${item.company ? ` · ${item.company}` : ""}` : [item.fsyId, item.company, item.group].filter(Boolean).join(" · ") || "Participant"}</small><em>{item.personType === "staff" ? "Staff" : item.checkinStatus === "arrived" ? "Checked in" : "Awaiting check-in"}</em></span>{item.bedLabel ? <span className="housing-v4-bed"><small>Bed / key</small><b>{item.bedLabel}</b></span> : null}{canManage ? <button type="button" className="secondary danger-text housing-v36-room-unassign" disabled={busy || undoBusy} onClick={() => setRemoveTarget(item)}>Unassign</button> : null}</div>)}
              {!occupants.length ? <Empty icon={Bed} title="No one assigned yet" text={`${room.capacity} spaces are available.`}/> : null}
            </div>
          </section>
        </> : <>
          <div className="housing-v6-add-person-head">
            <button type="button" className="secondary housing-v6-back" onClick={() => { setMode("detail"); setSelectedPerson(null); setError(""); }}><ArrowLeft/>Room details</button>
            <div><h3>Choose someone for this room</h3><p>{room.sex ? `Only unassigned ${sexLabel(room.sex).toLowerCase()} people are shown. Checked-in arrivals are ranked first.` : "Unassigned people are shown, with checked-in arrivals ranked first."}</p></div>
          </div>

          <div className="housing-v6-candidate-tools">
            <SearchField value={query} onChange={(value) => { setQuery(value); setCandidateLimit(CANDIDATE_BATCH); setSelectedPerson(null); }} label="Find person for this room" placeholder="Search name, group, company or unit" autoFocus/>
            {hasParticipants && hasStaff ? <label><span>People</span><select value={personType} onChange={(event) => { setPersonType(event.target.value); setCandidateLimit(CANDIDATE_BATCH); setSelectedPerson(null); }}><option value="all">Everyone</option><option value="participant">Participants</option><option value="staff">Staff</option></select></label> : null}
          </div>

          <div className="housing-v6-candidate-list">
            {visibleCandidates.map(({ person, reason }) => {
              const selected = selectedPerson && personKey(selectedPerson) === personKey(person);
              return <button type="button" key={personKey(person)} className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => setSelectedPerson(person)}>
                <span className="person-avatar">{initials(person.name)}</span>
                <span className="copy"><b>{person.name}</b><small>{person.context}</small><em>{reason.label}</em></span>
                <CheckCircle size={23} weight={selected ? "fill" : "regular"}/>
              </button>;
            })}
            {!candidates.length ? <Empty icon={UserPlus} title={room.sex ? `No unassigned ${sexLabel(room.sex).toLowerCase()} people match` : "No unassigned people match"} text={query ? "Try another search or people filter." : "Everyone compatible with this room is already assigned."}/> : null}
          </div>
          {candidates.length > visibleCandidates.length ? <button type="button" className="secondary housing-v5-more" onClick={() => setCandidateLimit((value) => value + CANDIDATE_BATCH)}>Show {Math.min(CANDIDATE_BATCH, candidates.length - candidateLimit)} more</button> : null}

          {selectedPerson ? <details className="housing-v4-details housing-v6-assignment-extra" open={Boolean(bedLabel)}><summary><span><b>Bed / key</b><small>{bedLabel ? bedLabel : "Optional"}</small></span><span>+</span></summary><div><label><span className="housing-field-label"><b>Bed / key label</b><em>Optional</em></span><input value={bedLabel} onChange={(event) => setBedLabel(event.target.value)} placeholder="e.g. Bed B or Key 203-2"/></label></div></details> : null}
        </>}
        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      </div>

      {mode === "add" ? <footer className="housing-v5-assignment-actions housing-v6-room-assign-footer">
        <div>{selectedPerson ? <><b>{selectedPerson.name}</b><small>Assign to {room.name}</small></> : <><b>Select a person</b><small>{open} space{open === 1 ? "" : "s"} currently open</small></>}</div>
        <button type="button" className="primary" disabled={busy || !selectedPerson} onClick={assign}>{busy ? "Checking & assigning…" : selectedPerson ? `Assign to ${room.name}` : "Choose a person"}</button>
      </footer> : null}

      {removeTarget ? <ConfirmActionSheet open title={`Unassign ${removeTarget.name} from ${room.name}?`} description="This ends their current room assignment without deleting the person or Housing history." impact="They will return to the Needs room list. You can undo immediately if this was accidental and the previous room is still available." confirmLabel="Unassign room" cancelLabel="Keep room" busy={busy} onClose={() => setRemoveTarget(null)} onConfirm={unassign}/> : null}
      <ActionToast message={undoAssignment ? `${undoAssignment.name} unassigned from ${room.name}.` : ""} actionLabel="Undo" onAction={undoUnassign} onDismiss={() => setUndoAssignment(null)} busy={undoBusy}/>
    </div>
  </DismissibleLayer>;
}
