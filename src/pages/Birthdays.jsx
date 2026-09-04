import { useMemo, useState } from "react";
import { ArrowCounterClockwise } from "@phosphor-icons/react/ArrowCounterClockwise";
import { Cake } from "@phosphor-icons/react/Cake";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { Check } from "@phosphor-icons/react/Check";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { UsersThree } from "@phosphor-icons/react/UsersThree";
import { Empty, MutationFeedback, PageHead, SearchField, SegmentedControl, Status } from "../components/UI.jsx";
import "./operations.css";
import "./birthdays.css";

const STAFF_ROLE_LABELS = {
  counselor: "Counselor",
  assistant_coordinator: "Assistant Coordinator",
  coordinator: "Coordinator",
  committee_member: "Committee Member",
  logistics_admin: "Logistical Administrator",
  session_director: "Session Directing Couple",
  other: "Staff",
};

function formatDate(value) {
  if (!value) return "Date not recorded";
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function initials(name = "FSY") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function keyFor(person) {
  return person.kind === "staff" ? `staff:${person.staffId}` : `participant:${person.participantId}`;
}

function staffRoleLabel(role) {
  return STAFF_ROLE_LABELS[role] || "Staff";
}

function primaryContext(person) {
  if (person.kind === "staff") {
    return staffRoleLabel(person.staffRole);
  }
  return Number.isFinite(Number(person.turningAge)) ? `Turning ${person.turningAge}` : "Youth participant";
}

function secondaryContext(person) {
  const parts = [];
  if (person.kind === "participant" && person.unit) parts.push(person.unit);
  if (person.company) parts.push(person.company);
  if (person.group) parts.push(person.group);
  return parts;
}

function searchText(person) {
  return [
    person.name,
    person.kind,
    person.unit,
    person.company,
    person.group,
    person.staffRole,
    primaryContext(person),
  ].filter(Boolean).join(" ").toLowerCase();
}

function BirthdayPerson({ person, busy, onUpdate }) {
  const staff = person.kind === "staff";
  const details = secondaryContext(person);
  const id = keyFor(person);

  return <article className={`birthday-person ${person.acknowledged ? "acknowledged" : "needs-action"}`}>
    <div className="birthday-person-main">
      <span className={`person-avatar birthday-avatar ${staff ? "staff" : "participant"}`} aria-hidden="true">{initials(person.name)}</span>
      <div className="birthday-identity">
        <div className="birthday-identity-topline">
          <span className={`birthday-kind ${staff ? "staff" : "participant"}`}>{staff ? "Staff" : "Youth"}</span>
          <span className="birthday-primary-context">{primaryContext(person)}</span>
        </div>
        <h3>{person.name}</h3>
        {details.length ? <div className="birthday-context-chips" aria-label="FSY context">{details.map((item) => <span key={item}>{item}</span>)}</div> : <p className="birthday-context-fallback">FSY assignment details are not recorded yet.</p>}
      </div>
    </div>

    <div className="birthday-person-action">
      {person.acknowledged ? <>
        <Status tone="good"><Check />Acknowledged</Status>
        <button
          type="button"
          className="birthday-undo"
          disabled={busy}
          onClick={() => onUpdate(person, false)}
          aria-label={`Undo acknowledgement for ${person.name}`}
        >
          <ArrowCounterClockwise />{busy ? "Saving…" : "Undo"}
        </button>
      </> : <button
        type="button"
        className="primary birthday-acknowledge"
        disabled={busy}
        onClick={() => onUpdate(person, true)}
      >
        <CheckCircle />{busy ? "Saving…" : "Mark acknowledged"}
      </button>}
    </div>
  </article>;
}

function BirthdayDay({ date, items, index, openState, onOpenChange, busyId, onUpdate }) {
  const remaining = items.filter((person) => !person.acknowledged).length;
  const isOpen = openState ?? (remaining > 0 || index === 0);

  return <details
    className={`birthday-day-card ${remaining ? "has-pending" : "complete"}`}
    open={isOpen}
    onToggle={(event) => onOpenChange(date, event.currentTarget.open)}
  >
    <summary>
      <div className="birthday-day-date">
        <span className="birthday-date-icon"><Cake size={20} /></span>
        <span>
          <b>{formatDate(date)}</b>
          <small>{items.length} {items.length === 1 ? "birthday" : "birthdays"}</small>
        </span>
      </div>
      <div className="birthday-day-state">
        {remaining ? <Status tone="warn">{remaining} to acknowledge</Status> : <Status tone="good"><Check />All acknowledged</Status>}
        <CaretDown className="birthday-day-caret" aria-hidden="true" />
      </div>
    </summary>
    <div className="birthday-day-body">
      {items.map((person) => <BirthdayPerson
        key={keyFor(person)}
        person={person}
        busy={busyId === keyFor(person)}
        onUpdate={onUpdate}
      />)}
    </div>
  </details>;
}

export function Birthdays({ birthdays = [], staffBirthdays = [], onSetAcknowledgement, onSetStaffAcknowledgement, sessionName }) {
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [openDays, setOpenDays] = useState({});

  const people = useMemo(() => [
    ...birthdays.map((person) => ({ ...person, kind: "participant" })),
    ...staffBirthdays.map((person) => ({ ...person, kind: "staff" })),
  ], [birthdays, staffBirthdays]);

  const youthCount = people.filter((person) => person.kind === "participant").length;
  const staffCount = people.length - youthCount;
  const acknowledgedCount = people.filter((person) => person.acknowledged).length;
  const remainingCount = people.length - acknowledgedCount;

  const filteredPeople = useMemo(() => {
    const text = query.trim().toLowerCase();
    return people.filter((person) => {
      if (statusFilter === "pending" && person.acknowledged) return false;
      if (statusFilter === "acknowledged" && !person.acknowledged) return false;
      if (typeFilter !== "all" && person.kind !== typeFilter) return false;
      return !text || searchText(person).includes(text);
    });
  }, [people, query, statusFilter, typeFilter]);

  const grouped = useMemo(() => filteredPeople.reduce((days, birthday) => {
    (days[birthday.date] ||= []).push(birthday);
    return days;
  }, {}), [filteredPeople]);

  const days = useMemo(() => Object.entries(grouped)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, items]) => [date, [...items].sort((left, right) => {
      if (left.acknowledged !== right.acknowledged) return Number(left.acknowledged) - Number(right.acknowledged);
      if (left.kind !== right.kind) return left.kind === "participant" ? -1 : 1;
      return left.name.localeCompare(right.name);
    })]), [grouped]);

  const update = async (person, acknowledged) => {
    const key = keyFor(person);
    setBusyId(key);
    setError("");
    setNotice("");
    try {
      if (person.kind === "staff") await onSetStaffAcknowledgement?.(person.staffId, acknowledged);
      else await onSetAcknowledgement?.(person.participantId, acknowledged);
      setNotice(acknowledged ? `${person.name} was marked acknowledged.` : `Acknowledgement for ${person.name} was undone.`);
    } catch (err) {
      setError(err.message || "Unable to save this acknowledgement.");
    } finally {
      setBusyId("");
    }
  };

  const clearFilters = () => {
    setQuery("");
    setStatusFilter("all");
    setTypeFilter("all");
  };

  return <section className="page birthdays-page">
    <PageHead
      title="Birthdays"
      sessionName={sessionName}
      description="See exactly who is celebrating during this FSY and keep track of who has been acknowledged. Youth ages are shown; adult ages stay private."
    />

    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    {notice ? <MutationFeedback>{notice}</MutationFeedback> : null}

    {!people.length ? <article className="panel birthday-empty-panel"><Empty icon={Cake} title="No birthdays in your current scope" text="Birthdays appear here from participant registration and staff records for this session." /></article> : <>
      <section className="birthday-overview panel" aria-label="Birthday overview">
        <div className="birthday-overview-copy">
          <span className="birthday-overview-icon"><Cake size={28} /></span>
          <div>
            <span className="kicker">Session celebrations</span>
            <h2>{people.length} {people.length === 1 ? "birthday" : "birthdays"} during FSY</h2>
            <p>{remainingCount ? `${remainingCount} still need acknowledgement.` : "Everyone has been acknowledged."} Names and FSY context stay visible so you can identify the right person confidently.</p>
          </div>
        </div>
        <div className="birthday-summary-grid">
          <div className={remainingCount ? "attention" : "complete"}><span>Still to acknowledge</span><strong>{remainingCount}</strong><small>{remainingCount ? "Needs attention" : "All done"}</small></div>
          <div><span>Youth</span><strong>{youthCount}</strong><small>Ages shown</small></div>
          <div><span>Staff</span><strong>{staffCount}</strong><small>Adult ages private</small></div>
        </div>
      </section>

      <section className="birthday-controls panel" aria-label="Filter birthdays">
        <div className="birthday-filter-main">
          <SegmentedControl
            className="birthday-status-tabs"
            label="Birthday acknowledgement status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "All", count: people.length },
              { value: "pending", label: "Needs acknowledgement", count: remainingCount },
              { value: "acknowledged", label: "Acknowledged", count: acknowledgedCount },
            ]}
          />
          <SearchField value={query} onChange={setQuery} label="Search birthdays" placeholder="Search name, unit, company or group" />
        </div>
        <div className="birthday-type-filter" role="group" aria-label="Filter by person type">
          <span>Show</span>
          <button type="button" className={typeFilter === "all" ? "active" : ""} onClick={() => setTypeFilter("all")}>Everyone <b>{people.length}</b></button>
          <button type="button" className={typeFilter === "participant" ? "active" : ""} onClick={() => setTypeFilter("participant")}><UsersThree />Youth <b>{youthCount}</b></button>
          <button type="button" className={typeFilter === "staff" ? "active" : ""} onClick={() => setTypeFilter("staff")}>Staff <b>{staffCount}</b></button>
        </div>
      </section>

      <div className="birthday-results-head">
        <div>
          <span className="kicker">Birthday schedule</span>
          <h2>{filteredPeople.length} {filteredPeople.length === 1 ? "person" : "people"} shown</h2>
        </div>
        <small>Days with unfinished acknowledgements open first. Completed days can stay collapsed until you need them.</small>
      </div>

      {days.length ? <div className="birthday-days">
        {days.map(([date, items], index) => <BirthdayDay
          key={date}
          date={date}
          items={items}
          index={index}
          openState={openDays[date]}
          onOpenChange={(day, isOpen) => setOpenDays((current) => ({ ...current, [day]: isOpen }))}
          busyId={busyId}
          onUpdate={update}
        />)}
      </div> : <article className="panel birthday-filter-empty"><Empty
        icon={Cake}
        title="No birthdays match these filters"
        text="Try a different status, person type, or a shorter search."
        action={<button type="button" className="secondary" onClick={clearFilters}>Clear filters</button>}
      /></article>}
    </>}
  </section>;
}
