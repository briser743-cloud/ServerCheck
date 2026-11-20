import test from 'node:test';
import assert from 'node:assert/strict';
import { pinnedLookup } from '../link-check.js';

test('pinned DNS returns the format requested by Node for both single and all addresses', () => {
  const address = {address:'93.184.216.34',family:4};
  const lookup = pinnedLookup(address);
  lookup('example.com',{all:true},(error,results) => { assert.equal(error,null); assert.deepEqual(results,[address]); });
  lookup('example.com',{all:false},(error,result,family) => { assert.equal(error,null); assert.equal(result,address.address); assert.equal(family,4); });
});
