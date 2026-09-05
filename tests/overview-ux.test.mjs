import test from 'node:test';
import assert from 'node:assert/strict';
import { overviewFocus } from '../src/lib/overview-focus.js';
test('an AC with several committee tools is still company-scoped',()=>{
 const f=overviewFocus({role:'assistant_coordinator',capabilities:['housing_view','food_view','wellness_status']});
 assert.equal(f.whole,false); assert.equal(f.primary.id,'groups');
});
test('unresolved head count takes precedence over routine registration',()=>{
 const f=overviewFocus({role:'coordinator',capabilities:['headcount_view','registration_manage'],reviewCount:12,headcount:{round:{id:'r',label:'Lunch'},companies:[{id:'c'}],submissions:[{round_id:'r',expected_count:40,accounted_count:38}]}});
 assert.equal(f.primary.id,'headcount');assert.equal(f.missing,2);assert.equal(f.others[0].id,'registration');
});
test('a food committee member receives their own work without session leadership',()=>{
 const f=overviewFocus({role:'committee_viewer',capabilities:['food_view'],foodOpen:5});
 assert.equal(f.primary.id,'food');assert.equal(f.whole,false);assert.equal(f.others.length,0);
});
test('closed head count does not remain a live action',()=>{
 const f=overviewFocus({role:'assistant_coordinator',capabilities:['headcount_view'],headcount:{round:{id:'r',closes_at:'2026-09-05'},companies:[{}]}});
 assert.equal(f.primary.id,'groups');
});
