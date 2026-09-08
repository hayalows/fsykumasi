import test from 'node:test';
import assert from 'node:assert/strict';
import { searchPeople, matchesPersonSearch, createPersonSearch } from '../src/lib/person-search.js';
const rows = [
  {id:'2',name:'Kwame Mensah',preferredName:'Kofi',fsyId:'C01-01-KUM',unit:'Asokwa'},
  {id:'1',name:'Kwame Mensah',fsyId:'C01-02-KUM'},
  {id:'3',name:'Élise Anne-Marie',unit:'Kwame Mensah'},
];
test('reversed names, accents, punctuation, aliases, prefixes and conservative typos',()=>{
  for(const q of ['Mensah Kwame','men kwa','Kofi','Kwmae Mensah','Kwame Mensh']) assert.equal(searchPeople(rows,q)[0].name,'Kwame Mensah');
  assert.equal(searchPeople(rows,'Marie Elise Anne')[0].id,'3');
  assert.equal(searchPeople(rows,'  ÉLISE--Anne ')[0].id,'3');
  assert.equal(searchPeople(rows,'Ko')[0].id,'2');
  assert.equal(searchPeople(rows,'Xwame Mzzzz').length,0);
});
test('badge exact first, never fuzzy, duplicate names deterministic',()=>{
  assert.equal(searchPeople(rows,'c01 01 kum')[0].id,'2');
  assert.equal(searchPeople(rows,'C01-01-KUN').length,0);
  assert.deepEqual(searchPeople(rows,'Kwame Mensah').map(r=>r.id),['1','2','3']);
  assert.deepEqual(searchPeople([...rows].reverse(),'Mensah Kwame').map(r=>r.id),['1','2','3']);
  assert.equal(matchesPersonSearch(rows[0],'Kwame Kwame'),false);
});
test('production sized reusable index remains fast',()=>{
  const index=createPersonSearch(Array.from({length:2500},(_,i)=>({...rows[i%3],id:String(i)})));
  const start=performance.now();
  for(let i=0;i<20;i++) assert.ok(index('Mensah Kwame').length);
  assert.ok(performance.now()-start<2000);
});
