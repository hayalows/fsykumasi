import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { DismissibleLayer } from './UI.jsx';
import { loadStaff } from '../lib/operations.js';
import { personIdentity } from '../lib/person-identity.js';
import { staffException } from '../lib/staff-state.js';
import './person-peek.css';
const PersonContext=createContext(null);
export function PersonProvider({children,participants=[],assignment,sessionId,onNavigate,view}) {
  const [selected,setSelected]=useState(null),[error,setError]=useState('');
  const generation=useRef(0);
  useEffect(()=>{generation.current++;setSelected(null);setError('');},[sessionId,view]);
  const open=async(person,kind,context)=>{
    const version=++generation.current;
    setSelected({person,kind,context,loading:true});setError('');
    try {
      const id=person.id||person.personId||person.person_id;
      const rows=kind==='staff'&&sessionId?await loadStaff(sessionId):participants;
      if(version!==generation.current)return;
      const canonical=rows.find(p=>p.id===id);
      setSelected({person:canonical||person,kind,context,loading:false});
    } catch { if(version===generation.current){setError('Full details could not be refreshed.');setSelected({person,kind,context,loading:false});} }
  };
  const close=()=>{generation.current++;setSelected(null);setError('');};
  const identity=selected?personIdentity(selected.person,selected.kind,assignment?.groups,assignment?.companies):null;
  return <PersonContext.Provider value={open}>{children}{identity?<DismissibleLayer open onClose={close} title={identity.name} sheet className="person-peek-layer"><section className="person-peek"><header><div><span className="kicker">{identity.kind==='staff'?'Staff':'Participant'}</span><h2>{identity.name}</h2>{identity.preferredName&&identity.preferredName!==identity.name?<p>Also known as {identity.preferredName}</p>:null}</div><button className="icon-button" data-layer-close onClick={close} aria-label="Close person details">×</button></header><dl>{[
      ['FSY ID',identity.kind==='participant'?identity.fsyId:null],['Age at session',identity.age],['Role',identity.role],['Company',identity.company||identity.responsibilities.join(', ')],['Counselor group',identity.group],['Ward / branch',identity.unit]
    ].filter(([,value])=>value!==null&&value!==undefined&&value!=='').map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{selected.kind==='staff'&&staffException(selected.person)?<p className="notice">{staffException(selected.person)}</p>:null}{selected.context?.label&&selected.context?.value?<div className="person-peek-context"><span>{selected.context.label}</span><b>{selected.context.value}</b></div>:null}{error?<p role="alert">{error}</p>:null}<button className="secondary" disabled={selected.loading||!identity.id} onClick={()=>{const id=identity.id;close();onNavigate('people',{personId:id});}}>View full record</button></section></DismissibleLayer>:null}</PersonContext.Provider>;
}
export function PersonName({person,kind='participant',context,children,className=''}) {
  const open=useContext(PersonContext);
  const name=children||person.fullName||person.name||person.display_name||person.full_name;
  if(!open)return <span className={className}>{name}</span>;
  return <button type="button" className={`person-name ${className}`} onClick={event=>{event.preventDefault();event.stopPropagation();open(person,kind,context);}}>{name}</button>;
}
