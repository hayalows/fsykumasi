import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DismissibleLayer } from './UI.jsx';
import { loadStaff } from '../lib/operations.js';
import { personIdentity } from '../lib/person-identity.js';
import { staffException } from '../lib/staff-state.js';
import { readWorkspaceLocation } from '../lib/navigation.js';
import './person-peek.css';

const PersonContext=createContext(null);
const RETURN_LABELS={groups:'Groups & companies',assignments:'Assignments',people:'People',registration:'Registration & check-in',housing:'Housing',food:'Food',wellness:'Wellness',headcount:'Head count',birthdays:'Birthdays',reports:'Reports',access:'Access',overview:'Overview'};

function personId(person){return person?.id||person?.personId||person?.person_id||'';}

function buildOrigin(view,person,kind,target,context){
  const current=readWorkspaceLocation();
  const base={...current,view:view||current.view};
  if(view==='assignments'){
    if(target?.closest?.('.assignments-v3-person-row')) base.tab='people';
    else if(target?.closest?.('.assignments-v3-coverage-row')) base.tab=person?.operationalRole==='assistant_coordinator'?'companies':'groups';
    if(kind==='staff') base.staffId=personId(person);
  }
  if(view==='groups'){
    if(context?.groupId) base.groupId=context.groupId;
    if(context?.companyId) base.companyId=context.companyId;
  }
  return context?.returnTo?{...base,...context.returnTo}:base;
}

export function PersonProvider({children,participants=[],assignment,sessionId,onNavigate,view}) {
  const [selected,setSelected]=useState(null),[error,setError]=useState('');
  const generation=useRef(0);
  const participantById=useMemo(()=>new Map(participants.map((person)=>[person.id||person.participantId||person.person_id,person])),[participants]);
  useEffect(()=>{generation.current++;setSelected(null);setError('');},[sessionId,view]);

  const open=async(person,kind,context,target)=>{
    const version=++generation.current;
    const origin=buildOrigin(view,person,kind,target,context);
    setSelected({person,kind,context,origin,loading:true});setError('');
    try {
      const id=personId(person);
      const rows=kind==='staff'&&sessionId?await loadStaff(sessionId):participants;
      if(version!==generation.current)return;
      const canonical=rows.find(p=>personId(p)===id);
      setSelected({person:canonical||person,kind,context,origin,loading:false});
    } catch {
      if(version===generation.current){
        setError('Full details could not be refreshed.');
        setSelected({person,kind,context,origin,loading:false});
      }
    }
  };
  const close=()=>{generation.current++;setSelected(null);setError('');};
  const identity=selected?personIdentity(selected.person,selected.kind,assignment?.groups,assignment?.companies):null;
  const location=readWorkspaceLocation();
  const returnTo=location.returnTo&&location.returnTo.view&&location.returnTo.view!==view?location.returnTo:null;
  const returnLabel=returnTo?(RETURN_LABELS[returnTo.view]||'previous work'):'';

  return <PersonContext.Provider value={{open,participantById}}>
    {returnTo?<div className="workspace-return-strip" role="navigation" aria-label="Return to previous work"><button type="button" className="text-action" onClick={()=>onNavigate(returnTo)}>← Back to {returnLabel}</button><span>Your place is being kept while you check this related record.</span></div>:null}
    {children}
    {identity?<DismissibleLayer open onClose={close} title={identity.name} sheet className="person-peek-layer"><section className="person-peek"><header><div><span className="kicker">{identity.kind==='staff'?'Staff':'Participant'}</span><h2>{identity.name}</h2>{identity.preferredName&&identity.preferredName!==identity.name?<p>Also known as {identity.preferredName}</p>:null}</div><button className="icon-button" data-layer-close onClick={close} aria-label="Close person details">×</button></header><dl>{[
      ['FSY ID',identity.kind==='participant'?identity.fsyId:null],
      ['Age at session',identity.age],
      ['Role',identity.role],
      ['Company',identity.company||identity.responsibilities.join(', ')],
      ['Counselor group',identity.group],
      ['Ward / branch',identity.unit]
    ].filter(([,value])=>value!==null&&value!==undefined&&value!=='').map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{selected.kind==='staff'&&staffException(selected.person)?<p className="notice">{staffException(selected.person)}</p>:null}{selected.context?.label&&selected.context?.value?<div className="person-peek-context"><span>{selected.context.label}</span><b>{selected.context.value}</b></div>:null}{error?<p role="alert">{error}</p>:null}<button className="secondary" disabled={selected.loading||!identity.id} onClick={()=>{const id=identity.id;const returnTo=selected.origin;close();onNavigate('people',{personId:id,returnTo});}}>Open full record</button></section></DismissibleLayer>:null}
  </PersonContext.Provider>;
}

export function PersonName({person,kind='participant',context,children,className='',showAge=true,interactive=true}) {
  const personContext=useContext(PersonContext);
  const name=children||person.fullName||person.name||person.display_name||person.full_name;
  const id=personId(person);
  const canonical=kind==='participant'?personContext?.participantById?.get(id):null;
  const age=kind==='participant'?(person.age??canonical?.age):null;
  const hasAge=showAge&&age!==null&&age!==undefined&&age!==''&&Number.isFinite(Number(age));
  const content=<>{name}{hasAge?<span className="person-age-inline" aria-label={`Age ${age}`}>· {age}</span>:null}</>;
  if(!interactive||!personContext?.open)return <span className={`${interactive?'':'person-name-static '}${className}`.trim()}>{content}</span>;
  const activate=(event)=>{event.preventDefault();event.stopPropagation();personContext.open({...canonical,...person},kind,context,event.currentTarget);};
  return <span
    className={`person-name ${className}`}
    role="button"
    tabIndex={0}
    aria-label={`Open ${name} details${hasAge?`, age ${age}`:''}`}
    onClick={activate}
    onKeyDown={(event)=>{if(event.key==='Enter'||event.key===' '){activate(event);}}}
  >{content}</span>;
}
