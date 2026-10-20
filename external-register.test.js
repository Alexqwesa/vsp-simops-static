'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { registrationRequest } = require('./external-register.js');

test('registration preserves Unicode and normalizes email without authority claims', () => {
  assert.deepEqual(registrationRequest({fullName: ' Nguyễn Văn А ', company: ' Partner ', position: ' Supervisor ', email: ' Worker@Partner.Test ',
    status: 'approved', userInfoId: 1, approverIds: [1]}), {
    v: 1, kind: 'external-registration', fullName: 'Nguyễn Văn А', company: 'Partner', position: 'Supervisor', email: 'worker@partner.test',
  });
});

test('registration rejects missing, malformed and oversized profile fields', () => {
  const fields = { fullName: 'Worker', company: 'Partner', position: 'Supervisor', email: 'worker@partner.test' };
  for (const invalid of [{company: ''}, {position: ' '}, {email: 'invalid'}, {fullName: 'x'.repeat(201)}, {fullName: 'Name\nInjected'}, {email: null}]) {
    assert.throws(() => registrationRequest({...fields, ...invalid}));
  }
});
