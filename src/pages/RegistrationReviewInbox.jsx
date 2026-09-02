import { useEffect, useMemo, useState } from "react";
import { Check } from "@phosphor-icons/react/Check";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { PageHead, Status } from "../components/UI.jsx";
import { loadPersonPrivateDetails } from "../lib/operations.js";
import { operationalAgeRange } from "../lib/registration.js";
import { buildRegistrationReview, REVIEW_QUEUE_META, REVIEW_QUEUE_ORDER, reviewFlags } from "../lib/review.js";

function initials(person) {
  return `${person.firstName?.[0] || ""}${person.lastName?.[0] || ""}` || "?";
}

export function RegistrationReviewInbox({
  imported = [],
  groups = [],
  onVerify,
  onAssign,
  live = false,
  canManage = true,
  canVerify = false,
  structureSettings = {},
}) {
  const review = useMemo(() => buildRegistrationReview(imported, structureSettings), [imported, structureSettings]);
  const ageRange = operationalAgeRange(structureSettings);
  const firstNonEmpty = REVIEW_QUEUE_ORDER.find((key) => review.counts[key] > 0) || "awaiting";
  const [queue, setQueue] = useState(firstNonEmpty);
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(20);
  const [selectedId, setSelectedId] = useState("");
  const [privateDetails, setPrivateDetails] = useState(null);
  const [privateBusy, setPrivateBusy] = useState(false);
  const [groupChoice, setGroupChoice] = useState({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!review.queues[queue]?.length && review.queues[firstNonEmpty]?.length) setQueue(firstNonEmpty);
  }, [firstNonEmpty, queue, review.queues]);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const source = review.queues[queue] || [];
    if (!query) return source;
    return source.filter((person) => `${person.fullName} ${person.preferredName || ""} ${person.registrationId || ""} ${person.unit || ""} ${person.stake || ""}`.toLowerCase().includes(query));
  }, [review, queue, search]);

  const selected = imported.find((person) => person.id === selectedId) || null;
  const selectedFlags = selected ? reviewFlags(selected, structureSettings) : [];

  const switchQueue = (key) => {
    setQueue(key);
    setSearch("");
    setVisible(20);
    setSelectedId("");
    setPrivateDetails(null);
    setMessage("");
  };

  const openPerson = async (person) => {
    setSelectedId(person.id);
    setPrivateDetails(null);
    setMessage("");
    if (!live || !canManage) return;
    setPrivateBusy(true);
    try { setPrivateDetails(await loadPersonPrivateDetails("participant", person.id)); }
    catch { setPrivateDetails(null); }
    finally { setPrivateBusy(false); }
  };

  const verify = async (approved) => {
    if (!selected || !onVerify) return;
    setBusy("verify"); setMessage("");
    try {
      await onVerify(selected.id, approved);
      setSelectedId("");
      setMessage(approved ? "Participant verified. They can now move to assignment if otherwise eligible." : "On-site addition rejected and retained in the audit history.");
    } catch (error) { setMessage(error.message || "Unable to save verification."); }
    finally { setBusy(""); }
  };

  const assign = async () => {
    if (!selected || !onAssign || !groupChoice[selected.id]) return;
    setBusy("assign"); setMessage("");
    try {
      await onAssign(selected.id, groupChoice[selected.id]);
      setSelectedId("");
      setMessage(`${selected.fullName} was assigned to a counselor group.`);
    } catch (error) { setMessage(error.message || "Unable to assign this participant."); }
    finally { setBusy(""); }
  };

  return <section className="page registration-review-page">
    <PageHead title="Registration review inbox" description="See the actual people behind every registration exception, understand why they are held out, and resolve only the items that are safe to resolve locally." />

    {message ? <div className="auth-success" role="status"><Check weight="bold"/><span>{message}</span></div> : null}

    <article className="panel quality-review-summary">
      <div className="panel-head"><div><span className="kicker">Attention first</span><h2>{review.totalUnique} people need review</h2><p>Queues can overlap when one person has more than one issue, but this headline counts each person once.</p></div><Status tone={review.totalUnique ? "warn" : "good"}>{review.totalUnique ? "Review inbox" : "Clear"}</Status></div>
      <div className="quality-queue-grid">{REVIEW_QUEUE_ORDER.map((key) => {
        const meta = REVIEW_QUEUE_META[key];
        return <button key={key} className={queue === key ? "quality-queue-card active" : "quality-queue-card"} onClick={() => switchQueue(key)}><strong>{review.counts[key]}</strong><span>{meta.label}</span><small>{meta.short}</small></button>;
      })}</div>
    </article>

    <div className="quality-review-layout">
      <article className="panel quality-review-list">
        <div className="panel-head"><div><span className="kicker">{REVIEW_QUEUE_META[queue].label}</span><h2>{review.counts[queue]} record{review.counts[queue] === 1 ? "" : "s"}</h2><p>{REVIEW_QUEUE_META[queue].help}</p></div></div>
        <div className="search"><MagnifyingGlass/><input value={search} onChange={(event) => { setSearch(event.target.value); setVisible(20); }} placeholder="Search original full name, ward, stake or registration ID"/></div>
        <div className="quality-person-list">{rows.slice(0, visible).map((person) => <button key={person.id} className={selectedId === person.id ? "quality-person-row selected" : "quality-person-row"} onClick={() => openPerson(person)}><span className="person-avatar">{initials(person)}</span><span><b>{person.fullName}</b><small>Age {person.age ?? "?"} · {person.unit || "Ward/branch missing"}{person.stake ? ` · ${person.stake}` : ""}</small></span><Status tone={queue === "age_review" || queue === "cancelled" ? "warn" : "muted"}>{queue === "age_review" ? `${person.age ?? "?"} yrs` : REVIEW_QUEUE_META[queue].label}</Status></button>)}{!rows.length ? <div className="empty-inline"><b>No records in this queue</b><span>Nothing currently needs this type of review.</span></div> : null}</div>
        {rows.length > visible ? <button className="secondary show-more" onClick={() => setVisible((value) => value + 20)}>Show 20 more · {rows.length - visible} remaining</button> : null}
      </article>

      <aside className={selected ? "panel quality-person-detail open" : "panel quality-person-detail"}>
        {selected ? <>
          <div className="quality-detail-head"><div><span className="kicker">Review record</span><h2>{selected.fullName}</h2><p>{selected.preferredName && selected.preferredName !== selected.fullName ? `Preferred name: ${selected.preferredName}` : "Original registration name"}</p></div><button className="icon-button" aria-label="Close review details" onClick={() => { setSelectedId(""); setPrivateDetails(null); }}>×</button></div>
          <div className="quality-detail-facts"><div><span>Age</span><b>{selected.age ?? "Not recorded"}</b></div><div><span>Sex</span><b>{selected.sex || "Not recorded"}</b></div><div><span>Registration</span><b>{selected.registrationStatus || "Unknown"}</b></div><div><span>Verification</span><b>{selected.verificationStatus || "Unknown"}</b></div><div><span>Ward / branch</span><b>{selected.unit || "Missing"}</b></div><div><span>Stake / district</span><b>{selected.stake || "Not recorded"}</b></div><div><span>Counselor group</span><b>{selected.groupId ? "Assigned" : "Not assigned"}</b></div><div><span>Source</span><b>{selected.sourceKind === "on_site" ? "Added on-site" : "Imported"}</b></div></div>

          <div className="quality-reasons"><span className="kicker">Why this person appears here</span>{selectedFlags.map((flag) => <div key={flag}><b>{REVIEW_QUEUE_META[flag].label}</b><small>{REVIEW_QUEUE_META[flag].help}</small></div>)}</div>

          {selectedFlags.includes("age_review") ? <div className="notice compact-notice"><WarningCircle/><div><b>Operational youth range: {ageRange.min}–{ageRange.max}</b><p>Keep the source record. Correct the official registration data or intentionally change the session age rule; do not force this person into a youth group.</p></div></div> : null}
          {selectedFlags.includes("awaiting") ? <div className="notice compact-notice"><WarningCircle/><div><b>Official export remains authoritative</b><p>If a newer export changes this person to Approved, importing that complete snapshot will update this same record automatically.</p></div></div> : null}

          {queue === "unassigned" && groups.length ? <div className="quality-assign-box"><label>Assign counselor group<select value={groupChoice[selected.id] || ""} onChange={(event) => setGroupChoice({ ...groupChoice, [selected.id]: event.target.value })}><option value="">Choose compatible group</option>{groups.filter((group) => group.sex === selected.sex).map((group) => <option key={group.id} value={group.id}>{group.displayName || group.name} · {group.memberCount} youth</option>)}</select></label><button className="primary" disabled={busy === "assign" || !groupChoice[selected.id]} onClick={assign}>{busy === "assign" ? "Assigning…" : "Assign participant"}</button></div> : null}

          {queue === "verification" && selected.sourceKind === "on_site" && canVerify ? <div className="inline-actions quality-verify-actions"><button className="secondary" disabled={busy === "verify"} onClick={() => verify(false)}>Reject addition</button><button className="primary" disabled={busy === "verify"} onClick={() => verify(true)}>Verify participant</button></div> : null}

          {canManage ? <details className="quality-private-details"><summary>Imported registration details</summary>{privateBusy ? <p>Loading…</p> : privateDetails ? <div>{privateDetails.date_of_birth ? <div><span>Date of birth</span><b>{privateDetails.date_of_birth}</b></div> : null}{privateDetails.phone ? <div><span>Phone</span><b>{privateDetails.phone}</b></div> : null}{privateDetails.contact_1_phone ? <div><span>Parent / guardian phone</span><b>{privateDetails.contact_1_phone}</b></div> : null}</div> : <p>No additional private fields are stored for this participant.</p>}</details> : null}
        </> : <div className="quality-detail-empty"><WarningCircle size={34}/><h2>Select a person</h2><p>Open one record to see exactly why it needs review and what the safe next step is.</p></div>}
      </aside>
    </div>
  </section>;
}
