export function personIdentity(person, kind='participant', groups=[], companies=[]) {
  const group=groups.find(g=>g.id===(person.groupId||person.counselorGroupId));
  const company=companies.find(c=>c.id===(group?.companyId||person.companyId));
  const label=p=>p?.displayName||p?.name||'';
  return {
    id:person.id||person.personId||person.person_id, kind,
    name:person.fullName||person.name||person.display_name||person.full_name||'Person',
    preferredName:person.preferredName||'', fsyId:person.fsyId||person.fsy_id||'',
    age:person.age ?? null, unit:person.unit||person.unit_name||'',
    group:label(group)||person.groupName||person.group_name||person.group||'',
    company:label(company)||person.companyName||person.company_name||person.company||'',
    responsibilities:kind==='staff'?(person.companyIds||[]).map(id=>label(companies.find(c=>c.id===id))).filter(Boolean):[],
    role:kind==='staff'?String(person.operationalRole||'staff').replace(/_/g,' '):'',
  };
}
