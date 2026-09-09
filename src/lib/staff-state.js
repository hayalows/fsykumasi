export const STAFF_PLANNING = ['primary', 'reserve', 'provisional', 'excluded'];
export const STAFF_ARRIVAL = ['expected', 'arrived', 'no_show', 'left'];
export const STAFF_CLEARANCE = ['cleared', 'confirmation_required', 'not_cleared'];

const ROLE_LABELS = {
  counselor: 'Counselor',
  assistant_coordinator: 'Assistant coordinator',
  coordinator: 'Coordinator',
  logistics_admin: 'Logistical administrator',
  session_director: 'Session directing couple',
  committee_member: 'Committee',
  other: 'Staff',
};

function committeeLabel(value = '') {
  const clean = String(value).trim().replace(/\s+committee$/i, '');
  if (!clean) return 'Committee';
  return `${clean.charAt(0).toUpperCase()}${clean.slice(1)} committee`;
}

export function staffState(person) {
  return {
    planning: person.planningState || (person.registrationStatus === 'cancelled' || person.isCurrent === false ? 'excluded' : person.registrationStatus === 'awaiting' ? 'provisional' : person.counselorGroupId || person.companyIds?.length ? 'primary' : 'reserve'),
    arrival: person.arrivalState || 'expected',
    clearance: person.serviceClearance || (person.registrationStatus === 'approved' ? 'cleared' : 'confirmation_required'),
  };
}

export function canPlanStaff(person) {
  const state = staffState(person);
  return person.isCurrent !== false && person.registrationStatus !== 'cancelled' && state.planning !== 'excluded' && state.clearance !== 'not_cleared' && !['no_show', 'left'].includes(state.arrival);
}

export function isFinalStaff(person) {
  const state = staffState(person);
  return person.isCurrent !== false
    && person.registrationStatus !== 'cancelled'
    && state.planning !== 'excluded'
    && state.clearance === 'cleared'
    && !['no_show', 'left'].includes(state.arrival);
}

export function canServeStaff(person) { return isFinalStaff(person) && staffState(person).arrival === 'arrived'; }

export function staffResponsibilityLabel(person = {}) {
  if (person.operationalRole === 'committee_member') return committeeLabel(person.committeeDuties?.[0] || '');
  return ROLE_LABELS[person.operationalRole] || 'Staff';
}

export function staffException(person) {
  const state = staffState(person);
  if (['no_show', 'left'].includes(state.arrival)) return person.counselorGroupId || person.companyIds?.length ? 'Replacement needed' : state.arrival === 'left' ? 'Left' : 'No-show';
  if (state.clearance === 'not_cleared') return 'Not cleared';
  if (state.clearance === 'confirmation_required') return 'Needs confirmation';
  if (state.planning === 'excluded') return 'Excluded from planning';
  return '';
}
