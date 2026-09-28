const test = require('node:test');
const assert = require('node:assert/strict');
const { todayISO, isNotFutureDate, ageAtISODate, lastCompletedNightDates } = require('../public/sleep-date');

test('uses the Brazilian calendar day around midnight UTC', () => {
  assert.equal(todayISO(new Date('2026-09-28T02:59:00Z')), '2026-09-27');
  assert.equal(todayISO(new Date('2026-09-28T03:00:00Z')), '2026-09-28');
});

test('calculates age on the chosen date', () => {
  assert.equal(ageAtISODate('1961-09-29', '2026-09-28'), 64);
  assert.equal(ageAtISODate('1961-09-28', '2026-09-28'), 65);
  assert.equal(ageAtISODate('1990-02-01', '2026-01-31'), 35);
});

test('returns the seven completed nights ending yesterday', () => {
  assert.deepEqual(lastCompletedNightDates('2026-09-28'), [
    '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24',
    '2026-09-25', '2026-09-26', '2026-09-27',
  ]);
});

test('allows today and past dates but rejects future or malformed dates', () => {
  const now = new Date('2026-09-28T15:00:00Z');
  assert.equal(isNotFutureDate('2026-09-28', now), true);
  assert.equal(isNotFutureDate('2026-09-27', now), true);
  assert.equal(isNotFutureDate('2026-09-29', now), false);
  assert.equal(isNotFutureDate('28/09/2026', now), false);
});
