// Pure, offline search. Identity matches always outrank contextual matches.
export function normalizeSearch(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
const idText = value => normalizeSearch(value).replace(/ /g, '');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function humanizeSearchContext(value) {
  return String(value ?? '').replace(/\b([a-z]+(?:_[a-z]+)+)\b/gi, token =>
    token.split('_').map(word => word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : '').join(' ')
  );
}

function oneEdit(a, b) {
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diffs = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i);
    return diffs.length === 1 || (diffs.length === 2 && diffs[1] === diffs[0] + 1 && a[diffs[0]] === b[diffs[1]] && a[diffs[1]] === b[diffs[0]]);
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return short.slice(i) === long.slice(i + 1);
}

function tokenRank(tokens, words, fuzzy) {
  // Each query token consumes a distinct name token (duplicate names are safe).
  const used = new Set();
  let cost = 0;
  for (const token of [...tokens].sort((a, b) => b.length - a.length || compare(a, b))) {
    let best = -1, bestCost = Infinity;
    for (let i = 0; i < words.length; i++) {
      if (used.has(i)) continue;
      const next = words[i] === token ? 0 : words[i].startsWith(token) ? 1 : fuzzy && oneEdit(token, words[i]) ? 2 : Infinity;
      if (next < bestCost) { best = i; bestCost = next; }
    }
    if (best < 0) return Infinity;
    used.add(best); cost = Math.max(cost, bestCost);
  }
  return cost;
}

export function searchDocument(row, context = []) {
  const name = normalizeSearch(row.fullName || row.name || row.display_name || row.full_name || [row.firstName, row.lastName].filter(Boolean).join(' '));
  const preferred = normalizeSearch(row.preferredName || row.preferred_name);
  const words = `${name} ${preferred}`.trim().split(' ').filter(Boolean);
  const contextText = normalizeSearch([row.unit, row.unit_name, row.stake, row.stake_name, row.companyName, row.company_name, row.company, row.groupName, row.group_name, row.group, row.operationalRole, row.person_type, ...context].filter(value => typeof value === 'string').join(' '));
  const contextWords = contextText.split(' ').filter(Boolean);
  return {
    name, preferred, words,
    ids: [row.fsyId, row.fsy_id, ...(row.previousFsyIds || [])].filter(Boolean).map(idText),
    context: contextText, contextWords, allWords: [...words, ...contextWords],
    key: String(row.id || row.personId || row.person_id || '')
  };
}

function queryProfile(query) {
  const text = normalizeSearch(query);
  return {
    text,
    compact: idText(query),
    tokens: text.split(' '),
    fuzzy: !/\d/.test(text),
  };
}

function rankDocument(doc, profile, boost = 0) {
  const { text, compact, tokens, fuzzy } = profile;
  if (!text) return 0;
  if (doc.ids.includes(compact)) return 0;
  // Queries containing digits never use typo matching, especially badge IDs.
  if (text === doc.name || text === doc.preferred) return 100;
  if (doc.name.startsWith(text) || doc.preferred.startsWith(text)) return 105;
  const nameRank = tokenRank(tokens, doc.words, fuzzy);
  if (Number.isFinite(nameRank)) return 110 + nameRank * 100 - Math.min(9, Math.max(0, boost));
  if (doc.ids.some(id => id.startsWith(compact))) return 400;
  if (Number.isFinite(tokenRank(tokens, doc.contextWords, false))) return 600 - Math.min(9, Math.max(0, boost));
  if (Number.isFinite(tokenRank(tokens, doc.allWords, false))) return 700;
  return Infinity;
}

export function documentRank(doc, query, boost = 0) {
  return rankDocument(doc, queryProfile(query), boost);
}

export const personSearchRank = (row, query, context = []) => documentRank(searchDocument(row, context), query);
export const matchesPersonSearch = (row, query, context = []) => Number.isFinite(personSearchRank(row, query, context));
export function createPersonSearch(rows, contextFor = () => []) {
  const entries = rows.map(row => ({ row, doc: searchDocument(row, contextFor(row)) }));
  return query => {
    const profile = queryProfile(query);
    return entries.map(entry => ({ ...entry, rank: rankDocument(entry.doc, profile) }))
    .filter(entry => Number.isFinite(entry.rank))
    .sort((a, b) => a.rank - b.rank || compare(a.doc.name, b.doc.name) || compare(a.doc.key, b.doc.key))
    .map(entry => {
      const row = entry.row;
      if (typeof row.context !== 'string' || !row.context.includes('_')) return row;
      return { ...row, context: humanizeSearchContext(row.context) };
    });
  };
}
export const searchPeople = (rows, query, contextFor) => createPersonSearch(rows, contextFor)(query);
