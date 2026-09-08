import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionPhase, shapeOverviewForPhase } from '../src/lib/overview-phase.js';
import { operationalEligibility } from '../src/lib/registration.js';

test('overview phase keeps pre-session test activity out of live operations',()=>{
  const phase=sessionPhase({startsOn:'2026-09-14',endsOn:'2026-09-19',now:'2026-09-08T14:00:00Z'});
  assert.equal(phase,'pre_session');
  const shaped=shapeOverviewForPhase({
    session:{checkedIn:1,recentArrivals:1},
    registration:{ready:1743,attention:42,arrived:1},
    housing:{waiting:1},
    wellness:{open:2},
    food:{remaining:100,serviceStatus:'open'},
    headcount:{roundId:'test-round',missing:1},
  },phase);
  assert.equal(shaped.session.checkedIn,0);
  assert.equal(shaped.registration.ready,0);
  assert.equal(shaped.registration.attention,42);
  assert.equal(shaped.housing.waiting,0);
  assert.deepEqual(shaped.headcount,{});
  assert.equal(shaped.wellness.open,0);
  assert.equal(shaped.food.remaining,0);
});

test('arrival and live phases retain live operational signals',()=>{
  assert.equal(sessionPhase({startsOn:'2026-09-14',endsOn:'2026-09-19',now:'2026-09-14T08:00:00Z'}),'arrival');
  assert.equal(sessionPhase({startsOn:'2026-09-14',endsOn:'2026-09-19',now:'2026-09-16T08:00:00Z'}),'live');
  const summary={housing:{waiting:3}};
  assert.equal(shapeOverviewForPhase(summary,'arrival'),summary);
  assert.equal(shapeOverviewForPhase(summary,'live'),summary);
});

test('UUID-backed live participants never invent client eligibility when server decision is absent',()=>{
  const live={id:'d6168b42-0d57-4e8d-a2ae-db1e97ec3308',registrationStatus:'approved',verificationStatus:'verified',isCurrent:true,attendanceStatus:'expected',age:16};
  assert.deepEqual(operationalEligibility(live,{participantMinAge:13,participantMaxAge:18}),{ok:false,reason:'Eligibility is still loading'});
  assert.deepEqual(operationalEligibility({...live,serverEligibility:{eligible:true,reason:'Eligible'}}),{ok:true,reason:'Eligible'});
});

test('non-live planning data keeps a narrow 13–18 preview rule',()=>{
  assert.equal(operationalEligibility({id:'demo-16',age:16}).ok,true);
  assert.equal(operationalEligibility({id:'demo-19',age:19}).ok,false);
});
