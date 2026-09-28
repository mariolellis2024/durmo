const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateNight } = require('../public/sleep-math');

test('calculates a night that begins after midnight', () => {
  assert.deepEqual(calculateNight({
    wentToBed: '00:30',
    sleepLatencyMin: 0,
    awakeDuringNightMin: 0,
    finalWake: '06:00',
    gotOutOfBed: '06:00',
  }), { inBed: 330, asleep: 330 });
});

test('carries wake and out-of-bed times into the next day', () => {
  assert.deepEqual(calculateNight({
    wentToBed: '00:30',
    sleepLatencyMin: 20,
    awakeDuringNightMin: 20,
    finalWake: '06:00',
    gotOutOfBed: '06:10',
  }), { inBed: 340, asleep: 290 });
});

test('subtracts sleep latency, wakefulness, and time after final wake', () => {
  assert.deepEqual(calculateNight({
    wentToBed: '22:15',
    sleepLatencyMin: 25,
    awakeDuringNightMin: 40,
    finalWake: '06:20',
    gotOutOfBed: '06:30',
  }), { inBed: 495, asleep: 420 });
});

test('does not report negative sleep when wakeful time exceeds time in bed', () => {
  assert.deepEqual(calculateNight({
    wentToBed: '23:30',
    sleepLatencyMin: 300,
    awakeDuringNightMin: 300,
    finalWake: '06:00',
    gotOutOfBed: '06:00',
  }), { inBed: 390, asleep: 0 });
});
