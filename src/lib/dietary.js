// Only exact, unambiguous non-answers are hidden. Unknown text always needs review.
const NON_NEEDS = new Set(['', 'na', 'none', 'nil', 'no', 'nothing', 'notapplicable',
  'food', 'normal', 'normalfood', 'noallergies', 'noallergy', 'nodietaryneeds',
  'nodietaryrestrictions', 'norestrictions', 'nospecialdiet', 'noproblem']);
export function dietaryNeedsReview(value) {
  const normalized = String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return !NON_NEEDS.has(normalized);
}

export function dietaryDisplayValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw || /^(null|undefined)$/i.test(raw)) return 'No response text provided — confirm with the person';
  if (/^(non|nill?)$/i.test(raw)) return `${raw} — response is unclear; confirm before serving`;
  return raw;
}
