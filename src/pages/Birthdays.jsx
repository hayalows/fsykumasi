import { useMemo, useState } from "react";
import { Cake } from "@phosphor-icons/react/Cake";
import { Check } from "@phosphor-icons/react/Check";
import { ArrowCounterClockwise } from "@phosphor-icons/react/ArrowCounterClockwise";
import { Empty, PageHead, Status } from "../components/UI.jsx";
import "./operations.css";

function formatDate(value){return new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",weekday:"short",timeZone:"UTC"}).format(new Date(`${value}T00:00:00Z`));}
function keyFor(person){return person.kind==="staff"?`staff:${person.staffId}`:`participant:${person.participantId}`;}

export function Birthdays({birthdays=[],staffBirthdays=[],onSetAcknowledgement,onSetStaffAcknowledgement,sessionName}){
 const [busyId,setBusyId]=useState("");const [error,setError]=useState("");
 const people=useMemo(()=>[
  ...birthdays.map((person)=>({...person,kind:"participant"})),
  ...staffBirthdays.map((person)=>({...person,kind:"staff"})),
 ],[birthdays,staffBirthdays]);
 const grouped=useMemo(()=>people.reduce((days,birthday)=>{(days[birthday.date]||=[]).push(birthday);return days;},{}),[people]);
 const update=async(person,acknowledged)=>{const key=keyFor(person);setBusyId(key);setError("");try{if(person.kind==="staff")await onSetStaffAcknowledgement?.(person.staffId,acknowledged);else await onSetAcknowledgement?.(person.participantId,acknowledged);}catch(err){setError(err.message||"Unable to save this acknowledgment.");}finally{setBusyId("");}};
 return <section className="page"><PageHead title="Birthdays this FSY" sessionName={sessionName} description="Youth and counselors celebrating during the session, with adult ages kept private by default."/>{error?<div className="form-error page-error" role="alert">{error}</div>:null}{!people.length?<article className="panel"><Empty icon={Cake} title="No birthdays in your current scope" text="Birthdays appear from the registration and staff records for this session."/></article>:Object.entries(grouped).sort(([a],[b])=>a.localeCompare(b)).map(([date,items])=><article className="panel birthday-day" key={date}><div className="panel-head"><div><span className="kicker">{formatDate(date)}</span><h2>{items.length} celebrating</h2></div><Cake size={24}/></div><div className="birthday-list">{items.map((person)=>{const id=keyFor(person);const staff=person.kind==="staff";const context=staff?`Counselor${person.company?` · ${person.company}`:""}`:`Turning ${person.turningAge} · ${person.unit||"Unit not recorded"}${person.company?` · ${person.company}`:""}${person.group?` / ${person.group}`:""}`;return <div key={id}><span className="person-avatar">{person.name.split(/\s+/).map((part)=>part[0]).slice(0,2).join("")}</span><span><b>{person.name}</b><small>{context}</small></span><div className="birthday-actions">{person.acknowledged?<><Status tone="good"><Check/>Acknowledged</Status><button className="secondary compact-button" disabled={busyId===id} onClick={()=>update(person,false)}><ArrowCounterClockwise/>{busyId===id?"Saving…":"Undo"}</button></>:<button className="secondary compact-button" disabled={busyId===id} onClick={()=>update(person,true)}>{busyId===id?"Saving…":"Acknowledge"}</button>}</div></div>;})}</div></article>)}</section>;
}
