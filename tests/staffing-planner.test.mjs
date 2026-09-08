import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStaffingPlan} from '../src/lib/staffing-planner.js';
import {canPlanStaff,canServeStaff,staffState,staffException} from '../src/lib/staff-state.js';
const person=(id,extra={})=>({id,name:`Staff ${id}`,operationalRole:'counselor',registrationStatus:'approved',isCurrent:true,sex:'Female',companyIds:[],...extra});
test('awaiting can plan but never serve without confirmation and arrival',()=>{
 const p=person('a',{registrationStatus:'awaiting'});
 assert.equal(canPlanStaff(p),true);assert.equal(canServeStaff(p),false);
 assert.equal(staffException(p),'Needs confirmation');
 assert.equal(canServeStaff({...p,serviceClearance:'cleared',arrivalState:'arrived'}),true);
 for(const change of [{registrationStatus:'cancelled'},{isCurrent:false},{planningState:'excluded'},{arrivalState:'no_show'},{arrivalState:'left'},{serviceClearance:'not_cleared'}])assert.equal(canPlanStaff({...p,...change}),false);
 assert.equal(staffState(person('x')).planning,'reserve');
});
test('preserve assignments, respect sex, rank cleared first, replace only gaps',()=>{
 const staff=[person('a'),person('b',{registrationStatus:'awaiting'}),person('c'),person('d',{sex:''}),person('e',{sex:'Male'})];
 const groups=[{id:'g1',name:'Group 1',sex:'Female',counselorId:'a'},{id:'g2',name:'Group 2',sex:'Female'},{id:'g3',name:'Group 3',sex:'Male'}];
 const plan=buildStaffingPlan(staff,groups,[],4);
 assert.deepEqual(plan.counselors.map(p=>[p.groupId,p.staffId]),[['g2','c'],['g3','e']]);
 assert.ok(plan.reserveIds.includes('b'));assert.ok(plan.reserveIds.includes('d'));
 assert.deepEqual(plan,buildStaffingPlan([...staff].reverse(),[...groups].reverse(),[],4));
 const replacement=buildStaffingPlan(staff.map(p=>p.id==='a'?{...p,arrivalState:'no_show'}:p),groups,[],4);
 assert.equal(replacement.counselors[0].previousStaffId,'a');
});
test('AC capacity is explicit, preserves overloads and never promotes counselors',()=>{
 const staff=[person('a',{operationalRole:'assistant_coordinator',companyIds:['c1']}),person('b')];
 const companies=[{id:'c1',name:'Company 1',assistantCoordinatorIds:['a']},{id:'c2',name:'Company 2'},{id:'c3',name:'Company 3'}];
 const plan=buildStaffingPlan(staff,[],companies,2);
 assert.equal(plan.assistants.length,1);assert.equal(plan.assistants[0].staffId,'a');assert.equal(plan.feasible,false);
 assert.ok(plan.exceptions.some(e=>e.targetId==='c3'));
 assert.throws(()=>buildStaffingPlan(staff,[],companies,0));
});
