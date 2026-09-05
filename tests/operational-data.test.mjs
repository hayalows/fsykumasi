import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRpcPages } from '../src/lib/rpc-pages.js';
import { dietaryNeedsReview } from '../src/lib/dietary.js';

test('all 1,615 people remain searchable beyond the API row limit', async () => {
  const people = Array.from({length:1615}, (_,id) => ({id}));
  const client = { rpc() { return { order() { return this; }, async range(from,to) { return {data:people.slice(from,to+1)}; } }; } };
  assert.deepEqual(await loadRpcPages(client,'roster',{},['id']),people);
});
test('a failed later page never returns a misleading partial roster', async () => {
  const client = { rpc() { return { order() { return this; }, async range(from) { return from ? {error:new Error('offline')} : {data:Array(500).fill({})}; } }; } };
  await assert.rejects(loadRpcPages(client,'roster',{},['id']), /offline/);
});
test('non-answers are hidden but restrictions and uncertain responses remain', () => {
  for (const value of ['N/A','na.','None','food','No allergies','',null]) assert.equal(dietaryNeedsReview(value),false);
  for (const value of ['No milk','No groundnuts','N/A but allergic to eggs','food allergy','Not sure','Diabetic','Vegetarian']) assert.equal(dietaryNeedsReview(value),true);
});
