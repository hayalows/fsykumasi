import { operationalAgeRange, operationalEligibility } from "./registration.js";

export const REVIEW_QUEUE_ORDER=["awaiting","age_review","verification","unassigned","missing_unit","not_attending","omitted","cancelled"];
export const REVIEW_QUEUE_META={
 awaiting:{label:"Awaiting approval",short:"Awaiting official registration approval",help:"Kept in the registration list, but excluded from groups, check-in and head count until a newer official export marks the person Approved."},
 age_review:{label:"Age review",short:"FSY session-date eligibility needs attention",help:"The source record is preserved. Where date of birth and session dates are available, eligibility follows the FSY year/session boundary rather than a broad planning age label."},
 verification:{label:"Needs verification",short:"On-site record needs an administrator decision",help:"Verify the day-of addition before assigning a counselor group or checking the participant in."},
 unassigned:{label:"Ready but unassigned",short:"Approved and eligible, but no counselor group yet",help:"Assign a compatible counselor group before check-in. This queue excludes age-review and approval-review records."},
 missing_unit:{label:"Missing ward / branch",short:"Church unit is missing",help:"Keep the source record, correct the official data when possible, then upload the newer complete export. Do not guess a unit."},
 not_attending:{label:"Confirmed not attending",short:"Leadership confirmed this person will not attend",help:"The registration record remains intact, but the person is removed from current operational eligibility until restored as expected."},
 omitted:{label:"Missing from latest export",short:"Previously imported but omitted from the newest snapshot",help:"The record is protected when operational work already exists. Confirm the newest official export before taking further action."},
 cancelled:{label:"Cancelled",short:"Registration is cancelled",help:"Visible for reference, but intentionally excluded from groups, check-in and head count."},
};

function serverAgeReview(person){const reason=person.serverEligibility?.reason||"";return ["Too young for this FSY year","Turns 19 before or on the end of this session","Date of birth is missing"].includes(reason);}
export function reviewFlags(person,settings={}){
 const flags=[];const{min,max}=operationalAgeRange(settings);const age=Number(person.age);const hasServer=person.serverEligibility&&typeof person.serverEligibility.eligible==="boolean";
 if(person.registrationStatus==="awaiting")flags.push("awaiting");
 if(person.registrationStatus==="cancelled")flags.push("cancelled");
 if(person.reconciliationStatus==="missing_from_latest")flags.push("omitted");
 if((person.verificationStatus||"verified")!=="verified")flags.push("verification");
 if(!String(person.unit||"").trim())flags.push("missing_unit");
 if(person.serverEligibility?.reason==="Confirmed not attending")flags.push("not_attending");
 if(hasServer?serverAgeReview(person):(!Number.isFinite(age)||age<min||age>max))flags.push("age_review");
 if(operationalEligibility(person,settings).ok&&!person.groupId)flags.push("unassigned");
 return flags;
}
export function buildRegistrationReview(participants=[],settings={}){
 const queues=Object.fromEntries(REVIEW_QUEUE_ORDER.map((key)=>[key,[]]));const unique=new Set();
 for(const person of participants){const flags=reviewFlags(person,settings);for(const flag of flags){queues[flag].push(person);unique.add(person.id);}}
 for(const key of REVIEW_QUEUE_ORDER)queues[key].sort((left,right)=>String(left.fullName||"").localeCompare(String(right.fullName||"")));
 return{queues,totalUnique:unique.size,counts:Object.fromEntries(REVIEW_QUEUE_ORDER.map((key)=>[key,queues[key].length]))};
}
