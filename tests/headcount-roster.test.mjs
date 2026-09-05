import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeHeadcount,searchHeadcount} from '../src/lib/headcount-roster.js';
import {dietaryNeedsReview} from '../src/lib/dietary.js';
import {overviewFocus} from '../src/lib/overview-focus.js';
test('accounted totals keep unchecked and missing explicit',()=>{
 const rows=['present','missing','unresolved','known_elsewhere','not_expected'].map(status=>({status}));
 assert.deepEqual(summarizeHeadcount(rows),{total:5,present:1,missing:1,unresolved:1,known_elsewhere:1,not_expected:1,accounted:3});
});
test('headcount finds staff and ID independently of presentation',()=>{
 const rows=[{display_name:'Test youth',fsy_id:'C01-12-TEST',person_type:'participant',status:'unresolved'},{display_name:'Test leader',person_type:'staff',status:'missing'}];
 assert.equal(searchHeadcount(rows,'c01-12')[0],rows[0]);
 assert.equal(searchHeadcount(rows,'staff','missing')[0],rows[1]);
 assert.equal(searchHeadcount(rows,'staff','present').length,0);
});
test('unfamiliar dietary language is retained for review',()=>{assert.equal(dietaryNeedsReview('牛奶过敏'),true);assert.equal(dietaryNeedsReview('N/A'),false);});
test('Overview uses current roster instead of an earlier aggregate count',()=>{
 const focus=overviewFocus({role:'coordinator',capabilities:['headcount_view'],headcount:{round:{id:'old',label:'Old'},companies:[]},rosterSummary:{round:{id:'new',label:'Lunch'},unresolved:7,missing:2}});
 assert.equal(focus.primary.title,'Lunch');assert.match(focus.primary.detail,/7 people not checked · 2 missing/);
});
