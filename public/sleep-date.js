(function exposeSleepDate(root) {
  function todayISO(now = new Date(), timeZone = 'America/Sao_Paulo') {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function isNotFutureDate(isoDate, now = new Date(), timeZone = 'America/Sao_Paulo') {
    return typeof isoDate === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(isoDate)
      && isoDate <= todayISO(now, timeZone);
  }

  function ageAtISODate(birthDate, referenceDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(referenceDate))) return null;
    const [birthYear, birthMonth, birthDay] = birthDate.split('-').map(Number);
    const [year, month, day] = referenceDate.split('-').map(Number);
    let age = year - birthYear;
    if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1;
    return age;
  }

  function lastCompletedNightDates(todayDate) {
    const [year, month, day] = todayDate.split('-').map(Number);
    const yesterday = new Date(Date.UTC(year, month - 1, day - 1));
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(yesterday);
      date.setUTCDate(yesterday.getUTCDate() - 6 + index);
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    });
  }

  const api = { todayISO, isNotFutureDate, ageAtISODate, lastCompletedNightDates };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SonoSleepDate = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
