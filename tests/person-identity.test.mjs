import test from 'node:test';
import assert from 'node:assert/strict';
import {personIdentity} from '../src/lib/person-identity.js';
test('shared identity projects operational facts and never copies private properties',()=>{
 const source={id:'p',fullName:'Ama Test',age:16,groupId:'g',unit:'Test Ward',fsyId:'C01-01-TST',phone:'private',medicalInformation:'private',registrationId:'internal'};
 const result=personIdentity(source,'participant',[{id:'g',companyId:'c',name:'Group 1'}],[{id:'c',name:'Company 1'}]);
 assert.equal(result.group,'Group 1');assert.equal(result.company,'Company 1');assert.equal(result.fsyId,'C01-01-TST');
 assert.ok(!('phone' in result));assert.ok(!('medicalInformation' in result));assert.ok(!('registrationId' in result));
 const staff=personIdentity({id:'s',name:'Test staff',operationalRole:'assistant_coordinator',companyIds:['c']},'staff',[],[{id:'c',name:'Company 1'}]);
 assert.deepEqual(staff.responsibilities,['Company 1']);
});
