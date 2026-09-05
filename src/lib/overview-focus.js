export const SESSION_LEADERS = new Set(['coordinator','logistics_admin','session_director']);

export function overviewFocus({role, capabilities = [], headcount, rosterSummary, waitingRooms = 0, foodOpen = 0, wellnessOpen = 0, reviewCount = 0}) {
  const has = key => capabilities.includes(key);
  const whole = SESSION_LEADERS.has(role);
  const companies = headcount?.companies || [];
  const round = rosterSummary?.round || headcount?.round;
  const reports = (headcount?.submissions || []).filter(row => row.round_id === round?.id);
  const awaiting = rosterSummary?.round ? Number(rosterSummary.unresolved||0) : Math.max(0, companies.length - reports.length);
  const missing = rosterSummary?.round ? Number(rosterSummary.missing||0) : reports.reduce((n,row) => n + Math.max(0,row.expected_count-row.accounted_count),0);
  const items = [];
  if (round && !round.closes_at && has('headcount_view')) items.push({id:'headcount', title:round.label, detail:`${awaiting} ${rosterSummary?.round ? "people not checked" : (awaiting===1?"company still to report":"companies still to report")}${missing ? ` · ${missing} missing` : ""}`, action:'Open head count', priority: missing ? 100 : awaiting ? 80 : 5});
  if (has('wellness_private') && wellnessOpen) items.push({id:'wellness',title:`${wellnessOpen} open Wellness visits`,detail:'Review the current queue and follow-up needs.',action:'Open Wellness',priority:90});
  if (has('housing_view') && waitingRooms) items.push({id:'housing',title:`${waitingRooms} arrivals waiting for a room`,detail:'Registration has checked them in. Continue their room assignment.',action:'Assign rooms',priority:70});
  if (has('food_view') && foodOpen) items.push({id:'food',title:`${foodOpen} dietary responses to review`,detail:'Check each response and confirm the accommodation with the Food team.',action:'Review dietary needs',priority:50});
  if (has('registration_manage') && reviewCount) items.push({id:'registration',title:`${reviewCount} registration records need review`,detail:'Resolve the records that need a registration decision.',action:'Review registration',priority:40});
  const fallback = role === 'assistant_coordinator' ? {id:'groups',title:'Your companies',detail:companies.length ? 'Review your groups and the people you are responsible for.' : 'No companies assigned. Ask an administrator to check your assignment.',action:'View companies'}
    : has('registration_manage') ? {id:'registration',title:'Registration & check-in',detail:'Find a participant and continue their arrival.',action:'Open check-in desk'}
    : has('housing_view') ? {id:'housing',title:'Housing',detail:'Review rooms and incoming arrivals.',action:'Open Housing'}
    : has('food_view') || has('meal_attendance_view') ? {id:'food',title:'Meal operations',detail:'Review the current meal and serving progress.',action:'Open Food'}
    : has('wellness_status') ? {id:'wellness',title:'Wellness',detail:'Review the current operational status.',action:'Open Wellness'}
    : {id:'profile',title:'Your responsibilities',detail:'Review the access assigned to your account.',action:'View profile'};
  items.sort((a,b)=>b.priority-a.priority);
  return {whole, primary:items[0] || fallback, others:items.slice(1), awaiting, missing};
}
