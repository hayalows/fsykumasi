import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { UsersThree } from "@phosphor-icons/react/UsersThree";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, Empty, MutationFeedback, SearchField } from "../components/UI.jsx";
import {
  addOnSiteGroundParticipant,
  checkInParticipantOnGround,
  loadParticipantGroundRoster,
  moveParticipantOnGround,
  subscribeParticipantGroundRoster,
} from "../lib/ground-roster.js";
import { loadOnSiteReferenceDate } from "../lib/onsite.js";
import { searchPeople } from "../lib/person-search.js";
import { buildUnitDirectory } from "../lib/registration-lookup.js";
import { loadRegistrationWorkspaceV29 } from "../lib/registration-workspace-v29.js";
import "./participant-ground-roster.css";

const TSHIRT_SIZES = ["Small", "Medium", "Large", "Extra Large", "Extra Extra Large"];
const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  preferredName: "",
  sex: "Female",
  birthday: "",
  unit: "",
  stake: "",
  phone: "",
  guardianName: "",
  guardianPhone: "",
  tshirtSize: "",
  medicalInformation: "",
  dietaryInformation: "",
};

function initials(name = "FSY") {
  return String(name || "FSY").split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function sexKey(value) {
  return String(value || "").toLowerCase().includes("female") ? "female" : "male";
}

function splitSearchName(value = "") {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

function companyLabel(company) {
  return company?.companyName || "Company";
}

function groupLabel(group) {
  return group?.groupName || "Counselor group";
}

function friendlyError(error, fallback) {
  const message = String(error?.message || "").trim();
  if (!message) return fallback;
  if (/function .* does not exist|schema cache|pgrst|sqlstate|column reference|syntax error/i.test(message)) {
    return `${fallback} Refresh the page and try again.`;
  }
  return message;
}

function QuickOnSiteSheet({ query, sessionStart, unitDirectory, busy, error, onClose, onSave }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, ...splitSearchName(query) }));
  const unitListId = useRef(`ground-units-${Math.random().toString(36).slice(2)}`);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const knownStakeByUnit = useMemo(() => new Map(unitDirectory.map((item) => [item.unit.trim().toLowerCase(), item.stake || ""])), [unitDirectory]);
  const updateUnit = (value) => {
    setForm((current) => ({
      ...current,
      unit: value,
      stake: knownStakeByUnit.get(value.trim().toLowerCase()) || current.stake,
    }));
  };
  const complete = form.firstName.trim() && form.lastName.trim() && form.birthday && form.unit.trim() && form.stake.trim() && form.guardianPhone.trim();

  return <DismissibleLayer open onClose={() => !busy && onClose()} title="Add participant on site" sheet className="ground-onsite-layer">
    <form className="ground-onsite-sheet" onSubmit={(event) => { event.preventDefault(); if (complete) onSave(form); }}>
      <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} disabled={busy} aria-label="Close"><X /></button>
      <span className="kicker">On-site arrival</span>
      <h2>Add, place and check in</h2>
      <p>Use the minimum identity and parent contact details. The system will place this youth into a live same-sex space, issue the FSY ID and record arrival in one save.</p>

      <div className="ground-onsite-grid two">
        <label>First name<input data-layer-autofocus required value={form.firstName} onChange={(event) => set("firstName", event.target.value)} /></label>
        <label>Last name<input required value={form.lastName} onChange={(event) => set("lastName", event.target.value)} /></label>
        <label>Sex<select value={form.sex} onChange={(event) => set("sex", event.target.value)}><option>Female</option><option>Male</option></select></label>
        <label>Date of birth<input required type="date" max={sessionStart || undefined} value={form.birthday} onChange={(event) => set("birthday", event.target.value)} /></label>
        <label className="span-2">Ward / branch<input required list={unitListId.current} value={form.unit} onChange={(event) => updateUnit(event.target.value)} placeholder="Start typing the unit" /></label>
        <datalist id={unitListId.current}>{unitDirectory.map((item) => <option key={`${item.unit}-${item.stake}`} value={item.unit}>{item.stake}</option>)}</datalist>
        <label className="span-2">Stake / district<input required value={form.stake} onChange={(event) => set("stake", event.target.value)} placeholder="Filled automatically when the unit is known" /></label>
        <label>Parent / guardian name <small>Optional</small><input value={form.guardianName} onChange={(event) => set("guardianName", event.target.value)} /></label>
        <label>Parent / guardian phone<input required type="tel" inputMode="tel" value={form.guardianPhone} onChange={(event) => set("guardianPhone", event.target.value)} /></label>
      </div>

      <details className="ground-onsite-more">
        <summary>Optional details</summary>
        <div className="ground-onsite-grid two">
          <label>Preferred name<input value={form.preferredName} onChange={(event) => set("preferredName", event.target.value)} /></label>
          <label>Participant phone<input type="tel" inputMode="tel" value={form.phone} onChange={(event) => set("phone", event.target.value)} /></label>
          <label>T-shirt size<select value={form.tshirtSize} onChange={(event) => set("tshirtSize", event.target.value)}><option value="">Not recorded</option>{TSHIRT_SIZES.map((size) => <option value={size} key={size}>{size}</option>)}</select></label>
          <label>Medical information<textarea rows="2" value={form.medicalInformation} onChange={(event) => set("medicalInformation", event.target.value)} /></label>
          <label className="span-2">Dietary information<textarea rows="2" value={form.dietaryInformation} onChange={(event) => set("dietaryInformation", event.target.value)} /></label>
        </div>
      </details>

      <div className="ground-paperwork-note"><b>Arrival will not wait for payment or approval screens.</b><span>The source registration is kept as awaiting so any required paperwork can be followed up separately instead of being falsely marked complete.</span></div>
      {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      <footer><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="primary" disabled={busy || !complete}>{busy ? "Adding…" : "Add, place & check in"}<ArrowRight /></button></footer>
    </form>
  </DismissibleLayer>;
}

function MoveParticipantSheet({ person, groups, companies, busy, error, onClose, onChoose }) {
  const compatible = useMemo(() => groups
    .filter((group) => group.state === "published" && group.sex === sexKey(person.sex) && (group.groupId === person.groupId || group.arrivedCount < group.maxSize))
    .sort((a, b) => {
      if (a.groupId === person.groupId) return -1;
      if (b.groupId === person.groupId) return 1;
      const aCompany = companies.get(a.companyId)?.arrived || 0;
      const bCompany = companies.get(b.companyId)?.arrived || 0;
      return aCompany - bCompany || a.arrivedCount - b.arrivedCount || (a.companyNumber || 9999) - (b.companyNumber || 9999) || (a.groupNumber || 9999) - (b.groupNumber || 9999);
    }), [groups, companies, person]);

  return <DismissibleLayer open onClose={() => !busy && onClose()} title="Change counselor group" sheet className="ground-move-layer">
    <div className="ground-move-sheet">
      <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} disabled={busy} aria-label="Close"><X /></button>
      <span className="kicker">Live placement</span>
      <h2>Move {String(person.fullName || "participant").split(/\s+/)[0]}</h2>
      <p>Only the people already checked in consume these places. Moving to another company may change the active FSY ID.</p>
      <div className="ground-move-list">
        {compatible.map((group) => {
          const company = companies.get(group.companyId);
          const current = group.groupId === person.groupId;
          const open = Math.max(0, group.maxSize - group.arrivedCount);
          return <button type="button" key={group.groupId} disabled={busy || current} className={current ? "current" : ""} onClick={() => onChoose(group)}>
            <span><b>{groupLabel(group)}</b><small>{company?.name || group.companyName} · {group.arrivedCount}/{group.maxSize} on ground · {open} open</small></span>
            <strong>{current ? "Current" : "Move"}</strong>
          </button>;
        })}
        {!compatible.length ? <Empty title="No compatible live space" text="Every same-sex group is full on the ground. Review the company structure before moving this participant." /> : null}
      </div>
      {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    </div>
  </DismissibleLayer>;
}

export function ParticipantGroundRoster({ sessionId, onOperationalDataChanged, onNavigate }) {
  const [participants, setParticipants] = useState([]);
  const [groups, setGroups] = useState([]);
  const [sessionStart, setSessionStart] = useState("");
  const [query, setQuery] = useState("");
  const [companyView, setCompanyView] = useState("active");
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [onsiteOpen, setOnsiteOpen] = useState(false);
  const [onsiteError, setOnsiteError] = useState("");
  const [moveTarget, setMoveTarget] = useState(null);
  const [moveError, setMoveError] = useState("");
  const searchRef = useRef(null);

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!sessionId) return;
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const [nextParticipants, nextGroups] = await Promise.all([
        loadRegistrationWorkspaceV29(sessionId),
        loadParticipantGroundRoster(sessionId),
      ]);
      setParticipants(nextParticipants);
      setGroups(nextGroups);
      setError("");
    } catch (err) {
      setError(friendlyError(err, "The on-ground roster could not load."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) { setLoading(false); return undefined; }
    void refresh();
    loadOnSiteReferenceDate(sessionId).then(setSessionStart).catch(() => {});
    return subscribeParticipantGroundRoster(sessionId, () => void refresh({ quiet: true }));
  }, [sessionId, refresh]);

  const currentParticipants = useMemo(() => participants.filter((person) => person.isCurrent), [participants]);
  const unitDirectory = useMemo(() => buildUnitDirectory(currentParticipants), [currentParticipants]);
  const searching = Boolean(query.trim());
  const matches = useMemo(() => {
    if (!searching) return [];
    return searchPeople(currentParticipants, query, (person) => [person.fsyId, person.companyName, person.groupName]).slice(0, 12);
  }, [currentParticipants, query, searching]);

  const companies = useMemo(() => {
    const map = new Map();
    for (const group of groups) {
      const entry = map.get(group.companyId) || {
        id: group.companyId,
        name: group.companyName,
        number: group.companyNumber,
        arrived: 0,
        roster: 0,
        capacity: 0,
        groups: [],
        fullGroups: 0,
      };
      entry.arrived += group.arrivedCount;
      entry.roster += group.rosterCount;
      entry.capacity += group.maxSize;
      entry.groups.push(group);
      if (group.arrivedCount >= group.maxSize) entry.fullGroups += 1;
      map.set(group.companyId, entry);
    }
    return map;
  }, [groups]);

  const companyRows = useMemo(() => [...companies.values()]
    .filter((company) => companyView === "all" || companyView === "full" ? companyView === "all" || company.arrived >= company.capacity : company.arrived > 0)
    .sort((a, b) => (a.number || 9999) - (b.number || 9999) || a.name.localeCompare(b.name, undefined, { numeric: true })), [companies, companyView]);

  const totals = useMemo(() => {
    const companyList = [...companies.values()];
    return {
      arrived: groups.reduce((sum, group) => sum + group.arrivedCount, 0),
      occupiedGroups: groups.filter((group) => group.arrivedCount > 0).length,
      fullGroups: groups.filter((group) => group.arrivedCount >= group.maxSize).length,
      occupiedCompanies: companyList.filter((company) => company.arrived > 0).length,
      fullCompanies: companyList.filter((company) => company.arrived >= company.capacity).length,
    };
  }, [groups, companies]);

  const runRefresh = async () => {
    await refresh({ quiet: true });
    await Promise.resolve(onOperationalDataChanged?.()).catch(() => {});
  };

  const checkIn = async (person) => {
    setBusy(person.participantId);
    setError("");
    setNotice("");
    try {
      const result = await checkInParticipantOnGround({ sessionId, participantId: person.participantId });
      await runRefresh();
      setNotice(`${person.fullName} is on ground · ${result?.companyName || "Company"} · ${result?.groupName || "Counselor group"}${result?.fsyId ? ` · ${result.fsyId}` : ""}${result?.paperworkFollowUp ? " · paperwork follow-up remains" : ""}.`);
      setQuery("");
      window.requestAnimationFrame(() => searchRef.current?.focus?.());
    } catch (err) {
      setError(friendlyError(err, "Check-in could not be saved."));
    } finally {
      setBusy("");
    }
  };

  const addOnSite = async (form) => {
    setBusy("onsite");
    setOnsiteError("");
    try {
      const result = await addOnSiteGroundParticipant({ sessionId, ...form });
      await runRefresh();
      setOnsiteOpen(false);
      setNotice(`${form.firstName} ${form.lastName} was added and checked in · ${result?.companyName || "Company"} · ${result?.groupName || "Counselor group"}${result?.fsyId ? ` · ${result.fsyId}` : ""}. Paperwork can be followed up separately.`);
      setQuery("");
      window.requestAnimationFrame(() => searchRef.current?.focus?.());
    } catch (err) {
      setOnsiteError(friendlyError(err, "This participant could not be added."));
    } finally {
      setBusy("");
    }
  };

  const moveParticipant = async (group) => {
    if (!moveTarget) return;
    setBusy(moveTarget.participantId);
    setMoveError("");
    try {
      const result = await moveParticipantOnGround({ participantId: moveTarget.participantId, groupId: group.groupId });
      await runRefresh();
      setMoveTarget(null);
      setNotice(`${moveTarget.fullName} moved to ${result?.companyName || group.companyName} · ${result?.groupName || group.groupName}${result?.fsyId ? ` · ${result.fsyId}` : ""}.`);
    } catch (err) {
      setMoveError(friendlyError(err, "The participant could not be moved."));
    } finally {
      setBusy("");
    }
  };

  const noMatch = searching && !loading && matches.length === 0;

  return <section className="participant-ground" aria-label="Participant on-ground roster">
    <div className="ground-principle">
      <div><span className="kicker">Day One operating roster</span><h2>Work with the people who are actually here</h2><p>Paper assignments remain as history. A live place is used only when the participant checks in, so a no-show does not block somebody standing at the desk.</p></div>
      {refreshing ? <small role="status">Updating…</small> : null}
    </div>

    <div className="ground-metrics" aria-label="Live participant counts">
      <div><b>{loading ? "—" : totals.arrived.toLocaleString()}</b><span>On ground</span></div>
      <div><b>{loading ? "—" : totals.occupiedCompanies}</b><span>Companies active</span></div>
      <div><b>{loading ? "—" : totals.occupiedGroups}</b><span>Groups active</span></div>
      <div className={totals.fullGroups ? "attention" : ""}><b>{loading ? "—" : totals.fullGroups}</b><span>Groups full</span></div>
    </div>

    <article className="panel ground-arrival-desk">
      <div className="ground-arrival-head"><div><b>Find participant</b><span>Search name, FSY ID, ward, company or group. Then one tap places and checks the person in.</span></div></div>
      <SearchField inputRef={searchRef} value={query} onChange={(value) => { setQuery(value); setError(""); setNotice(""); }} label="Find participant" placeholder="Name, FSY ID, ward, company or group" />
      {notice ? <MutationFeedback tone="success">{notice}</MutationFeedback> : null}
      {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}

      {searching ? <div className="ground-search-scope"><MagnifyingGlass /><span><b>Searching the whole current roster</b><small>Checked-in participants stay searchable, so you can confirm or move them without leaving this desk.</small></span></div> : null}

      {loading ? <div className="ground-loading" role="status">Loading the live roster…</div> : null}
      {!loading && searching && matches.length ? <div className="ground-search-results">
        {matches.map((person) => {
          const arrived = person.checkinStatus === "arrived";
          const blocked = person.registrationStatus === "cancelled" || person.operationalStatus === "withdrawn";
          return <article key={person.participantId} className={`ground-person${arrived ? " arrived" : ""}`}>
            <span className="ground-avatar" aria-hidden="true">{initials(person.fullName)}</span>
            <div className="ground-person-copy">
              <div><b>{person.fullName}</b>{arrived ? <span className="ground-present"><CheckCircle weight="fill" /> On ground</span> : null}</div>
              <span>{[person.unit, person.stake].filter(Boolean).join(" · ") || "Unit not recorded"}</span>
              <small>{[person.fsyId, person.companyName, person.groupName].filter(Boolean).join(" · ") || "Placement will be chosen at check-in"}</small>
              {person.registrationStatus === "awaiting" ? <em>Source status: awaiting · does not block on-ground arrival</em> : null}
              {blocked ? <em className="danger">This record needs coordinator review before arrival.</em> : null}
            </div>
            <div className="ground-person-actions">
              {arrived ? <button type="button" className="secondary" disabled={busy === person.participantId} onClick={() => { setMoveTarget(person); setMoveError(""); }}>Change group</button>
                : <button type="button" className="primary" disabled={Boolean(busy) || blocked} onClick={() => checkIn(person)}>{busy === person.participantId ? "Placing…" : "Check in & place"}<ArrowRight /></button>}
            </div>
          </article>;
        })}
      </div> : null}

      {noMatch ? <div className="ground-no-match">
        <div><b>No current participant matches this search.</b><span>If this youth is physically here, add the minimum details and the system will place and check them in immediately.</span></div>
        <button type="button" className="primary" disabled={query.trim().length < 3} onClick={() => { setOnsiteError(""); setOnsiteOpen(true); }}><UserPlus />Add on site</button>
      </div> : null}

      {!searching && !loading ? <div className="ground-search-prompt"><MagnifyingGlass /><span><b>Start with the name.</b><small>Existing record: check in. No record: add on site. The company and group are handled from live capacity.</small></span></div> : null}
    </article>

    <article className="panel ground-companies">
      <div className="ground-section-head"><div><span className="kicker">Companies and groups</span><h3>Live occupancy</h3><p>The first number is who is physically checked in. The old roster count is kept only as reference.</p></div><div className="ground-company-filter" role="group" aria-label="Company view"><button type="button" className={companyView === "active" ? "active" : ""} onClick={() => setCompanyView("active")}>With arrivals</button><button type="button" className={companyView === "full" ? "active" : ""} onClick={() => setCompanyView("full")}>Full</button><button type="button" className={companyView === "all" ? "active" : ""} onClick={() => setCompanyView("all")}>All 40</button></div></div>
      <div className="ground-company-list">
        {!loading && companyRows.map((company) => <section className={`ground-company${company.arrived >= company.capacity ? " full" : ""}`} key={company.id}>
          <header><div><b>{company.name}</b><small>{company.arrived}/{company.capacity} on ground · {company.roster} on paper</small></div><strong>{company.capacity - company.arrived > 0 ? `${company.capacity - company.arrived} live places` : "Full"}</strong></header>
          <div className="ground-group-list">{company.groups.sort((a, b) => (a.groupNumber || 9999) - (b.groupNumber || 9999) || a.groupName.localeCompare(b.groupName, undefined, { numeric: true })).map((group) => <div className={`ground-group${group.arrivedCount >= group.maxSize ? " full" : ""}`} key={group.groupId}>
            <span><b>{group.groupName}</b><small>{group.sex === "female" ? "Female" : "Male"} · paper {group.rosterCount}</small></span>
            <strong>{group.arrivedCount}/{group.maxSize}</strong>
            <em>{group.counselorName ? `${group.counselorArrived ? "Counselor here" : "Counselor assigned"}` : "Staff later"}</em>
          </div>)}</div>
        </section>)}
        {!loading && !companyRows.length ? <Empty icon={UsersThree} title={companyView === "full" ? "No company is full on the ground" : "No company has an arrival yet"} text={companyView === "full" ? "Live capacity is still available." : "Companies will appear here as participants check in."} /> : null}
      </div>
      <div className="ground-staff-later"><span><b>Participants first, staff next.</b><small>You can let the ground roster settle, then assign counselors to the groups that actually have youth and Assistant Coordinators to the companies that are active.</small></span>{onNavigate ? <button type="button" className="secondary" onClick={() => onNavigate({ view: "assignments", mode: "groups", filter: "all" })}>Open staff assignments</button> : null}</div>
    </article>

    {onsiteOpen ? <QuickOnSiteSheet query={query} sessionStart={sessionStart} unitDirectory={unitDirectory} busy={busy === "onsite"} error={onsiteError} onClose={() => !busy && setOnsiteOpen(false)} onSave={addOnSite} /> : null}
    {moveTarget ? <MoveParticipantSheet person={moveTarget} groups={groups} companies={companies} busy={busy === moveTarget.participantId} error={moveError} onClose={() => !busy && setMoveTarget(null)} onChoose={moveParticipant} /> : null}
  </section>;
}
