function dateKey(value){if(!value)return"";const match=String(value).match(/^\d{4}-\d{2}-\d{2}/);return match?match[0]:"";}
export function sessionPhase({startsOn,endsOn,now=new Date()}){
 const today=dateKey(now instanceof Date?now.toISOString():now),start=dateKey(startsOn),end=dateKey(endsOn);
 if(!start||!today)return"unknown";
 if(today<start)return"pre_session";
 if(today===start)return"arrival";
 if(end&&today<=end)return"live";
 if(end&&today>end)return"post_session";
 return"live";
}
export function phaseLabel(phase){return phase==="pre_session"?"Pre-session":phase==="arrival"?"Arrival day":phase==="live"?"Session live":phase==="post_session"?"Session complete":"Session";}
export function shapeOverviewForPhase(summary={},phase="unknown"){
 if(phase!=="pre_session")return summary;
 return {...summary,
  session:{...(summary.session||{}),checkedIn:0,recentArrivals:0},
  registration:{...(summary.registration||{}),ready:0,arrived:0},
  housing:{...(summary.housing||{}),waiting:0},
  headcount:{},wellness:{...(summary.wellness||{}),open:0},
  food:{...(summary.food||{}),remaining:0,serviceStatus:"planned"},
 };
}
export function preSessionArea(summary={}){
 const registration=summary.registration||{},scope=summary.scope||{},access=summary.access||{};
 return {areaTitle:"Pre-session readiness",areaDetail:"Preparation issues take priority until the session starts. Test check-ins and live-day signals stay out of the way.",metrics:[{label:"Registration review",value:Number(registration.attention||0),attention:Number(registration.attention||0)>0},{label:"Uncovered groups",value:Number(scope.uncoveredGroups||0),attention:Number(scope.uncoveredGroups||0)>0},{label:"Access setup",value:Number(access.pending||0),attention:Number(access.pending||0)>0},{label:"Companies",value:Number(scope.companyCount||0)}]};
}
