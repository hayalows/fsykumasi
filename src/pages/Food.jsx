import { useEffect, useMemo, useState } from "react";
import { Check } from "@phosphor-icons/react/Check";
import { ForkKnife } from "@phosphor-icons/react/ForkKnife";
import { ArrowCounterClockwise } from "@phosphor-icons/react/ArrowCounterClockwise";
import { MutationFeedback, PageHead, SearchField, Status } from "../components/UI.jsx";
import { hasCapability, loadFoodNeeds, setFoodAcknowledgement } from "../lib/field-operations.js";
import "./field-operations.css";

export function Food({ sessionId, capabilities = [], sessionName }) {
  const canView = hasCapability(capabilities, "food_view");
  const canManage = hasCapability(capabilities, "food_manage");
  const [needs, setNeeds] = useState([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const reload = async () => { if (sessionId && canView) setNeeds(await loadFoodNeeds(sessionId)); };
  useEffect(() => { reload().catch((err) => setError(err.message || "Unable to load dietary needs.")); }, [sessionId, canView]);
  const rows = useMemo(() => { const text=query.trim().toLowerCase(); return needs.filter((item) => !text || `${item.name} ${item.dietaryInformation} ${item.group} ${item.company}`.toLowerCase().includes(text)); }, [needs,query]);
  const openCount = needs.filter((item) => !item.acknowledged).length;

  const toggle = async (item) => {
    setBusy(`${item.personType}:${item.personId}`); setError(""); setSaved("");
    try { await setFoodAcknowledgement({ sessionId, personType:item.personType, personId:item.personId, acknowledged:!item.acknowledged }); await reload(); setSaved(item.acknowledged ? "Dietary item reopened." : "Dietary item acknowledged."); }
    catch (err) { setError(err.message || "Unable to save this Food item."); }
    finally { setBusy(""); }
  };

  return <section className="page field-page">
    <PageHead title="Food" sessionName={sessionName} description={canView ? "See the dietary information needed for meal operations without exposing unrelated Wellness notes." : "Food information is limited to people assigned to this work."} />
    {!canView ? <article className="panel field-no-access"><ForkKnife size={30}/><h2>Food is not in your access</h2><p>Ask an administrator to add the Food team if meal and dietary support is part of your assignment.</p></article> : <>
      {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}{saved ? <MutationFeedback>{saved}</MutationFeedback> : null}
      <div className="field-metrics"><div><span>Dietary records</span><strong>{needs.length}</strong><small>Participants and staff</small></div><div><span>Needs acknowledgement</span><strong>{openCount}</strong><small>Food team attention</small></div><div><span>Acknowledged</span><strong>{needs.length-openCount}</strong><small>Reviewed by Food</small></div></div>
      <article className="panel"><div className="panel-head"><div><span className="kicker">Dietary operations</span><h2>Food needs</h2></div><ForkKnife size={22}/></div><SearchField value={query} onChange={setQuery} label="Search dietary needs" placeholder="Search name, company, group or restriction" />
        <div className="food-list">{rows.map((item) => <div key={`${item.personType}:${item.personId}`} className={item.acknowledged ? "food-row acknowledged" : "food-row"}><div><b>{item.name}</b><small>{item.personType === "staff" ? "Staff" : [item.company,item.group].filter(Boolean).join(" · ") || "Participant"}</small></div><p>{item.dietaryInformation}</p><div className="food-row-action">{item.acknowledged ? <Status tone="good"><Check/>Acknowledged</Status> : <Status tone="warn">Needs review</Status>}{canManage ? <button className="secondary compact-button" disabled={busy===`${item.personType}:${item.personId}`} onClick={() => toggle(item)}>{item.acknowledged ? <ArrowCounterClockwise/> : <Check/>}{busy===`${item.personType}:${item.personId}` ? "Saving…" : item.acknowledged ? "Reopen" : "Acknowledge"}</button> : null}</div></div>)}{!rows.length ? <div className="empty-inline"><b>No matching dietary needs</b><span>{needs.length ? "Try a shorter search." : "No dietary restrictions are stored in your current scope."}</span></div> : null}</div>
      </article>
    </>}
  </section>;
}
