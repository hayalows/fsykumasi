import { canPlanStaff, staffState } from './staff-state.js';
const label = row => row.displayName || row.name || '';
const stable = (a,b) => label(a).localeCompare(label(b),'en',{numeric:true}) || String(a.id).localeCompare(String(b.id),'en');
const sex = value => String(value || '').toLowerCase();
export function buildStaffingPlan(staff, groups, companies, maxCompanyLoad = 4) {
  if (!Number.isInteger(Number(maxCompanyLoad)) || Number(maxCompanyLoad) < 1) throw new Error('Choose a positive whole number of companies per Assistant Coordinator.');
  const limit = Number(maxCompanyLoad), byId = new Map(staff.map(p=>[p.id,p]));
  const eligible = staff.filter(canPlanStaff).sort((a,b)=>Number(staffState(a).clearance!=='cleared')-Number(staffState(b).clearance!=='cleared')||stable(a,b));
  const occupied = new Set(groups.map(g=>g.counselorId).filter(Boolean));
  const pool = eligible.filter(p=>p.operationalRole==='counselor'&&!occupied.has(p.id)&&!p.counselorGroupId);
  const counselors=[], assistants=[], exceptions=[], used=new Set();
  for(const group of [...groups].sort(stable)) {
    if(group.counselorId && canPlanStaff(byId.get(group.counselorId)||{isCurrent:false})) continue;
    const person=pool.find(p=>!used.has(p.id)&&sex(p.sex)&&sex(p.sex)===sex(group.sex));
    if(!person){exceptions.push({type:'counselor',targetId:group.id,message:`${label(group)}: Replacement needed`});continue;}
    used.add(person.id);
    counselors.push({groupId:group.id,groupName:label(group),staffId:person.id,staffName:person.name,previousStaffId:group.counselorId||null,needsConfirmation:staffState(person).clearance!=='cleared'});
  }
  const acs=eligible.filter(p=>p.operationalRole==='assistant_coordinator');
  const loads=new Map(acs.map(p=>[p.id,companies.filter(c=>(c.assistantCoordinatorIds||[]).includes(p.id)).length]));
  for(const company of [...companies].sort(stable)) {
    const existing=company.assistantCoordinatorIds||[];
    if(existing.some(id=>canPlanStaff(byId.get(id)||{isCurrent:false}))) continue;
    const person=[...acs].filter(p=>loads.get(p.id)<limit).sort((a,b)=>loads.get(a.id)-loads.get(b.id)||stable(a,b))[0];
    if(!person){exceptions.push({type:'assistant',targetId:company.id,message:`${label(company)}: Assistant Coordinator needed`});continue;}
    assistants.push({companyId:company.id,companyName:label(company),staffId:person.id,staffName:person.name,previousStaffIds:[...existing].sort(),needsConfirmation:staffState(person).clearance!=='cleared'});
    loads.set(person.id,loads.get(person.id)+1);
  }
  for(const person of acs) if(loads.get(person.id)>limit) exceptions.push({type:'load',targetId:person.id,message:`${person.name}: ${loads.get(person.id)} companies exceeds target ${limit}; existing coverage preserved`});
  return {counselors,assistants,exceptions,reserveIds:pool.filter(p=>!used.has(p.id)).map(p=>p.id),limit,feasible:!exceptions.length};
}
