import { searchPeople } from "./person-search.js";
export const HEADCOUNT_STATUSES = [['unresolved','Not checked'],['present','Present'],['missing','Missing'],['known_elsewhere','Known elsewhere'],['not_expected','Not expected']];
export function summarizeHeadcount(people) {
 const counts={total:people.length,present:0,missing:0,unresolved:0,known_elsewhere:0,not_expected:0};
 for(const person of people) counts[person.status in counts ? person.status : 'unresolved']++;
 return {...counts,accounted:counts.present+counts.known_elsewhere+counts.not_expected};
}
export function searchHeadcount(people,query,filter='all') {
 return searchPeople(people.filter(p=>filter==='all'||p.status===filter),query);
}
