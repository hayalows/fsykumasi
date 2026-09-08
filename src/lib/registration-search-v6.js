import { personSearchRank, matchesPersonSearch } from './person-search.js';
export const registrationSearchRank = (row,query,housing) => personSearchRank(row,query,[housing?.roomName]);
export const matchesRegistrationSearchV6 = (row,query,housing) => matchesPersonSearch(row,query,[housing?.roomName]);
