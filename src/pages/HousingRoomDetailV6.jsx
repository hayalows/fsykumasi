import { useMemo, useState } from "react";
import { ArrowLeft } from "@phosphor-icons/react/ArrowLeft";
import { Bed } from "@phosphor-icons/react/Bed";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { PencilSimple } from "@phosphor-icons/react/PencilSimple";
import { Plus } from "@phosphor-icons/react/Plus";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, Empty, MutationFeedback, SearchField } from "../components/UI.jsx";
import { loadHousingRooms } from "../lib/field-operations.js";
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

  return <DismissibleLayer open onClose={onClose} title={room.name} sheet className="housing-v4-room-detail-layer housing-v6-room-detail-layer">
    <div className="housing-v4-modal housing-v6-room-detail-modal">
      <header className="housing-v4-modal-head housing-v6-room-detail-head">
        <div>
          <span className="kicker">{mode === "add" ? "Add to room" : "Housing room"}</span>
          <h2>{room.name}</h2>
          <p>{roomLocation(room)}</p>
        </div>
        <button type="button" data-layer-close className="icon-button" onClick={onClose} aria-label="Close"><X/></button>
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
            <div className="housing-v4-occupants">
              {occupants.map((item) => <div key={item.id}><span className="person-avatar">{initials(item.name)}</span><span><b>{item.name}</b><small>{item.personType === "staff" ? `Staff${item.company ? ` · ${item.company}` : ""}` : [item.fsyId, item.company, item.group].filter(Boolean).join(" · ") || "Participant"}</small><em>{item.personType === "staff" ? "Staff" : item.checkinStatus === "arrived" ? "Checked in" : "Awaiting check-in"}</em></span>{item.bedLabel ? <span className="housing-v4-bed"><small>Bed / key</small><b>{item.bedLabel}</b></span> : null}</div>)}
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

          {selectedPerson ? <details className="housing-v4-details housing-v6-assignment-extra" open={Boolean(bedLabel)}><summary><span><b>Assignment detail</b><small>{bedLabel ? `Bed / key ${bedLabel}` : "Bed or key label, if needed"}</small></span><span>+</span></summary><div><label><span className="housing-field-label"><b>Bed / key label</b><em>Optional</em></span><input value={bedLabel} onChange={(event) => setBedLabel(event.target.value)} placeholder="e.g. Bed B or Key 203-2"/></label></div></details> : null}
        </>}
        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      </div>

      {mode === "add" ? <footer className="housing-v5-assignment-actions housing-v6-room-assign-footer">
        <div>{selectedPerson ? <><b>{selectedPerson.name}</b><small>Assign to {room.name}</small></> : <><b>Select a person</b><small>{open} space{open === 1 ? "" : "s"} currently open</small></>}</div>
        <button type="button" className="primary" disabled={busy || !selectedPerson} onClick={assign}>{busy ? "Checking & assigning…" : selectedPerson ? `Assign to ${room.name}` : "Choose a person"}</button>
      </footer> : null}
    </div>
  </DismissibleLayer>;
}
