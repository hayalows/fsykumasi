import { useEffect, useMemo, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { UserCircle } from "@phosphor-icons/react/UserCircle";
import { UsersThree } from "@phosphor-icons/react/UsersThree";
import { X } from "@phosphor-icons/react/X";
import { PageHead, Status } from "../components/UI.jsx";
import {
  assignCounselorToGroup,
  loadOperationalStructure,
  loadPersonPrivateDetails,
  loadStaff,
  setStaffCompanyAssignment,
  setStaffOperationalRole,
  unassignCounselorFromGroup,
} from "../lib/operations.js";
import "./operations.css";

const ROLE_LABELS = {
  counselor: "Counselor",
  assistant_coordinator: "Assistant coordinator",
  coordinator: "Coordinator",
  committee_member: "Committee member",
  logistics_admin: "Logistical administrator",
  session_director: "Session directing couple",
  other: "Other staff",
};

function initials(name = "FSY") {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function prettyPrivateLabel(key) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function People({ sessionId, participants = [], canManage = false }) {
  const [staff, setStaff] = useState([]);
  const [structure, setStructure] = useState({ groups: [], companies: [] });
  const [tab, setTab] = useState("participants");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [privateDetails, setPrivateDetails] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = async () => {
    if (!sessionId) return;
    const [nextStaff, nextStructure] = await Promise.all([loadStaff(sessionId), loadOperationalStructure(sessionId)]);
    setStaff(nextStaff);
    setStructure(nextStructure);
  };

  useEffect(() => { reload().catch((err) => setError(err.message || "Unable to load people.")); }, [sessionId]);

  const groupMap = useMemo(() => new Map(structure.groups.map((group) => [group.id, group])), [structure.groups]);
  const companyMap = useMemo(() => new Map(structure.companies.map((company) => [company.id, company])), [structure.companies]);
  const staffMap = useMemo(() => new Map(staff.map((person) => [person.id, person])), [staff]);

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    const source = tab === "staff" ? staff : participants;
    return source.filter((person) => {
      if (tab === "staff" && roleFilter !== "all" && person.operationalRole !== roleFilter) return false;
      const haystack = tab === "staff"
        ? `${person.name} ${person.preferredName || ""} ${person.unit || ""} ${person.stake || ""} ${person.operationalRole || ""}`
        : `${person.fullName} ${person.preferredName || ""} ${person.registrationId || ""} ${person.unit || ""} ${person.stake || ""}`;
      return !text || haystack.toLowerCase().includes(text);
    }).slice(0, 100);
  }, [participants, staff, tab, query, roleFilter]);

  const openPerson = async (kind, person) => {
    setSelected({ kind, person });
    setPrivateDetails(null);
    setError("");
    if (!canManage) return;
    try { setPrivateDetails(await loadPersonPrivateDetails(kind, person.id)); }
    catch (err) { setError(err.message || "Private registration details could not be loaded."); }
  };

  const mutateStaff = async (action) => {
    setBusy(true); setError("");
    try {
      await action();
      await reload();
      const refreshed = (await loadStaff(sessionId)).find((person) => person.id === selected?.person?.id);
      if (refreshed) setSelected({ kind: "staff", person: refreshed });
    } catch (err) { setError(err.message || "Staff assignment could not be saved."); }
    finally { setBusy(false); }
  };

  const selectedGroup = selected?.kind === "participant" ? groupMap.get(selected.person.groupId) : null;
  const selectedCompany = selectedGroup ? companyMap.get(selectedGroup.companyId) : null;

  return <section className="page">
    <PageHead title="People" description="Find a participant or staff member, understand their current place in FSY, and make the few assignments that need leadership attention." />
    {error ? <div className="form-error page-error" role="alert">{error}</div> : null}

    <div className="people-toolbar panel">
      <div className="segmented people-tabs">
        <button className={tab === "participants" ? "active" : ""} onClick={() => { setTab("participants"); setSelected(null); }}>Participants <b>{participants.length.toLocaleString()}</b></button>
        <button className={tab === "staff" ? "active" : ""} onClick={() => { setTab("staff"); setSelected(null); }}>Staff <b>{staff.length.toLocaleString()}</b></button>
      </div>
      <div className="search"><MagnifyingGlass/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "staff" ? "Search staff, role, ward or stake" : "Search participant, ward, stake or registration ID"}/></div>
      {tab === "staff" ? <select className="people-role-filter" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="all">All staff roles</option>{Object.entries(ROLE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select> : null}
    </div>

    <div className="people-layout">
      <article className="panel people-list-panel">
        <div className="panel-head"><div><span className="kicker">Directory</span><h2>{rows.length === 100 ? "First 100 matches" : `${rows.length} match${rows.length === 1 ? "" : "es"}`}</h2></div><UsersThree size={22}/></div>
        <div className="people-list">{rows.map((person) => {
          const name = tab === "staff" ? person.name : person.fullName;
          const secondary = tab === "staff"
            ? `${ROLE_LABELS[person.operationalRole] || person.operationalRole} · ${person.unit || "Unit not recorded"}`
            : `${person.age ?? "Age ?"} · ${person.unit || "Unit not recorded"}`;
          return <button key={person.id} className={selected?.person?.id === person.id ? "selected" : ""} onClick={() => openPerson(tab === "staff" ? "staff" : "participant", person)}>
            <span className="person-avatar">{initials(name)}</span><span><b>{name}</b><small>{secondary}</small></span><Status tone={(person.registrationStatus || "approved") === "approved" ? "good" : "warn"}>{person.registrationStatus || "approved"}</Status>
          </button>;
        })}{!rows.length ? <div className="empty-inline"><b>No matches</b><span>Try a shorter name, ward, stake, or a different role filter.</span></div> : null}</div>
      </article>

      <article className="panel person-detail-panel">
        {!selected ? <div className="person-empty"><UserCircle size={42}/><h2>Select someone</h2><p>Open a person to see their registration context and current FSY assignment.</p></div> : <>
          <div className="person-detail-head"><span className="person-avatar large">{initials(selected.kind === "staff" ? selected.person.name : selected.person.fullName)}</span><div><span className="kicker">{selected.kind === "staff" ? "Staff record" : "Participant record"}</span><h2>{selected.kind === "staff" ? selected.person.name : selected.person.fullName}</h2><p>{selected.person.unit || "Unit not recorded"}{selected.person.stake ? ` · ${selected.person.stake}` : ""}</p></div><button className="icon-button" aria-label="Close details" onClick={() => setSelected(null)}><X/></button></div>

          {selected.kind === "participant" ? <div className="person-facts">
            <div><span>Age</span><b>{selected.person.age ?? "Not recorded"}</b></div><div><span>Sex</span><b>{selected.person.sex}</b></div><div><span>Status</span><b>{selected.person.registrationStatus}</b></div><div><span>Source</span><b>{selected.person.sourceKind === "on_site" ? "Added on-site" : "Imported"}</b></div><div><span>Counselor group</span><b>{selectedGroup?.displayName || selectedGroup?.name || "Not assigned"}</b></div><div><span>Company</span><b>{selectedCompany?.displayName || selectedCompany?.name || "Not assigned"}</b></div>
          </div> : <>
            <div className="person-facts"><div><span>Age</span><b>{selected.person.age ?? "Not recorded"}</b></div><div><span>Sex</span><b>{selected.person.sex || "Not recorded"}</b></div><div><span>Status</span><b>{selected.person.registrationStatus}</b></div><div><span>Current role</span><b>{ROLE_LABELS[selected.person.operationalRole] || selected.person.operationalRole}</b></div></div>
            {canManage ? <div className="staff-assignment-box"><label>FSY operational role<select disabled={busy} value={selected.person.operationalRole} onChange={(event) => mutateStaff(() => setStaffOperationalRole(selected.person.id, event.target.value))}>{Object.entries(ROLE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              {selected.person.operationalRole === "counselor" ? <label>Counselor group<select disabled={busy} value={selected.person.counselorGroupId || ""} onChange={(event) => mutateStaff(() => event.target.value ? assignCounselorToGroup(selected.person.id, event.target.value) : unassignCounselorFromGroup(selected.person.counselorGroupId))}><option value="">Not assigned</option>{structure.groups.filter((group) => !selected.person.sex || group.sex === selected.person.sex).map((group) => { const owner = staff.find((item) => item.counselorGroupId === group.id); return <option value={group.id} key={group.id}>{group.displayName} · {group.memberCount} youth{owner && owner.id !== selected.person.id ? ` · ${owner.name}` : ""}</option>; })}</select></label> : null}
              {selected.person.operationalRole === "assistant_coordinator" ? <div><span className="field-label">Assigned companies</span><div className="company-assignment-list">{structure.companies.map((company) => <label key={company.id}><input type="checkbox" checked={selected.person.companyIds.includes(company.id)} disabled={busy} onChange={(event) => mutateStaff(() => setStaffCompanyAssignment(selected.person.id, company.id, event.target.checked))}/><span>{company.displayName}</span></label>)}</div></div> : null}
            </div> : null}
          </>}

          {canManage && privateDetails ? <details className="private-details"><summary>Imported contact & registration details</summary><div>{Object.entries(privateDetails).filter(([key, value]) => value && !["participant_id","staff_id","session_id","updated_at"].includes(key)).map(([key, value]) => <div key={key}><span>{prettyPrivateLabel(key)}</span><b>{String(value)}</b></div>)}</div></details> : canManage ? <p className="form-hint">No additional private fields are stored for this person.</p> : <p className="form-hint">Sensitive registration details are limited to administrators.</p>}
        </>}
      </article>
    </div>
  </section>;
}
