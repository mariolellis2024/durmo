(function exposeSleepMath(root) {
  function calculateNight(entry) {
    const minuteOfDay = (value) => {
      const [hour, minute] = String(value).slice(0, 5).split(':').map(Number);
      return hour * 60 + minute;
    };

    const wentToBed = minuteOfDay(entry.wentToBed);
    let finalWake = minuteOfDay(entry.finalWake);
    while (finalWake < wentToBed) finalWake += 1440;
    let gotOutOfBed = minuteOfDay(entry.gotOutOfBed);
    while (gotOutOfBed < finalWake) gotOutOfBed += 1440;

    const inBed = Math.max(0, gotOutOfBed - wentToBed);
    const awakeBeforeGettingUp = Math.max(0, gotOutOfBed - finalWake);
    const asleep = Math.max(0, inBed - Number(entry.sleepLatencyMin || 0)
      - Number(entry.awakeDuringNightMin || 0) - awakeBeforeGettingUp);
    return { inBed, asleep };
  }

  const api = { calculateNight };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SonoSleepMath = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
