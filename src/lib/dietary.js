// Only exact, unambiguous non-answers are hidden. Unknown text always needs review.
const NON_NEEDS = new Set(['', 'na', 'none', 'nil', 'no', 'nothing', 'notapplicable',
  'food', 'normal', 'normalfood', 'noallergies', 'noallergy', 'nodietaryneeds',
  'nodietaryrestrictions', 'norestrictions', 'nospecialdiet', 'noproblem']);
export function dietaryNeedsReview(value) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return !NON_NEEDS.has(normalized);
}
