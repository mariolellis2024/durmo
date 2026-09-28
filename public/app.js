const authView = document.querySelector('#authView');
const profileView = document.querySelector('#profileView');
const appView = document.querySelector('#appView');
const authForm = document.querySelector('#authForm');
const authMessage = document.querySelector('#authMessage');
const profileForm = document.querySelector('#profileForm');
const entryForm = document.querySelector('#entryForm');
const entryMessage = document.querySelector('#entryMessage');
const nightDate = document.querySelector('#nightDate');
const estimate = document.querySelector('#sleepEstimate');
const calendarPopover = document.querySelector('#calendarPopover');
const calendarGrid = document.querySelector('#calendarGrid');
const { calculateNight } = window.SonoSleepMath;
let authMode = 'login';
let currentUser = null;
let entries = [];
let historyEntries = [];
let registeredDates = new Set();
let selectedQuality = null;
let currentProgram = null;
let selectedDateISO = addDaysISO(SonoSleepDate.todayISO(), -1);
let calendarMonth = monthStart(selectedDateISO);
const assessmentQuestions = [
  'Tenho dificuldade para pegar no sono.',
  'Acordo no meio da noite e tenho dificuldade para voltar a dormir.',
  'Acordo mais cedo do que gostaria e não consigo voltar a dormir.',
  'Estou insatisfeito(a) com a qualidade do meu sono.',
  'Isso atrapalha minha energia, humor ou concentração durante o dia.',
];

document.querySelectorAll('.auth-tab').forEach((button) => {
  button.addEventListener('click', () => setAuthMode(button.dataset.mode));
});

document.querySelectorAll('.view-tab').forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view));
});

document.querySelector('#weekShortcut').addEventListener('click', (event) => {
  event.preventDefault();
  setView('week');
});

document.querySelector('#backToDiary').addEventListener('click', () => setView('diary'));
document.querySelector('#logoutButton').addEventListener('click', logout);
const accountDialog = document.querySelector('#accountDialog');
document.querySelector('#deleteAccountButton').addEventListener('click', () => {
  document.querySelector('#accountDeleteMessage').textContent = '';
  accountDialog.showModal();
});
document.querySelector('#cancelDeleteAccount').addEventListener('click', () => accountDialog.close());
document.querySelector('#confirmDeleteAccount').addEventListener('click', deleteAccount);

document.querySelectorAll('#wentToBed,#sleepLatencyMin,#awakeDuringNightMin,#finalWake,#gotOutOfBed').forEach((input) => {
  input.addEventListener('input', updateEstimate);
});
document.querySelector('#awakenings').addEventListener('input', updateEstimate);

for (let value = 1; value <= 5; value += 1) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'quality-choice';
  button.textContent = '★';
  button.dataset.value = String(value);
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-label', `${value} de 5`);
  button.addEventListener('click', () => setQuality(value));
  document.querySelector('#qualityPicker').append(button);
}

renderAssessment(document.querySelector('#baselineAssessment'), 'baseline');
renderAssessment(document.querySelector('#finalAssessment'), 'final');
nightDate.value = isoToBrazilian(selectedDateISO);
renderCalendar();
setQuality(selectedQuality);
updateEstimate();
restoreSession();

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const isRegister = mode === 'register';
  document.querySelector('#authTitle').textContent = isRegister ? 'Comece pelo seu e-mail.' : 'Um passo de cada vez.';
  document.querySelector('#authPin').setAttribute('autocomplete', isRegister ? 'new-password' : 'current-password');
  document.querySelector('#pinHelp').textContent = isRegister
    ? 'Escolha um PIN numérico de 6 dígitos.'
    : 'Use seu PIN para acessar suas anotações.';
  document.querySelector('#authSubmit').textContent = isRegister ? 'Criar minha conta' : 'Entrar';
  authMessage.textContent = '';
}

function setQuality(value) {
  selectedQuality = value;
  document.querySelectorAll('.quality-choice').forEach((button) => {
    const selected = Number(button.dataset.value) === value;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-checked', String(selected));
  });
}

function setView(view) {
  const isDiary = view === 'diary';
  const isWeek = view === 'week';
  document.querySelector('#diaryView').classList.toggle('hidden', !isDiary);
  document.querySelector('#weekView').classList.toggle('hidden', !isWeek);
  document.querySelector('#planView').classList.toggle('hidden', view !== 'plan');
  document.querySelectorAll('.view-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  if (isWeek) renderWeek();
  if (view === 'plan') renderProgram();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function restoreSession() {
  try {
    const result = await api('/api/me');
    currentUser = result.user;
    await enterApp();
  } catch {
    showAuth();
  }
}

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  authMessage.textContent = '';
  const submit = document.querySelector('#authSubmit');
  submit.disabled = true;
  submit.textContent = authMode === 'register' ? 'Criando conta…' : 'Entrando…';
  try {
    const user = await api(`/api/${authMode}`, {
      method: 'POST',
      body: JSON.stringify({
        email: document.querySelector('#authEmail').value,
        pin: document.querySelector('#authPin').value,
      }),
    });
    currentUser = user.user;
    authForm.reset();
    await enterApp();
  } catch (error) {
    authMessage.textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = authMode === 'register' ? 'Criar minha conta' : 'Entrar';
  }
});

const profileBirthDate = document.querySelector('#profileBirthDate');
profileBirthDate.addEventListener('input', () => {
  const digits = profileBirthDate.value.replace(/\D/g, '').slice(0, 8);
  if (digits.length > 4) profileBirthDate.value = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  else if (digits.length > 2) profileBirthDate.value = `${digits.slice(0, 2)}/${digits.slice(2)}`;
  else profileBirthDate.value = digits;
});

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const profileMessage = document.querySelector('#profileMessage');
  const submit = document.querySelector('#profileSubmit');
  const birthDate = brazilianToISO(profileBirthDate.value);
  if (!birthDate) {
    profileMessage.textContent = 'Digite uma data válida no formato dd/mm/aaaa.';
    return;
  }
  profileMessage.textContent = '';
  submit.disabled = true;
  submit.textContent = 'Salvando…';
  try {
    const result = await api('/api/profile', {
      method: 'PUT',
      body: JSON.stringify({
        firstName: document.querySelector('#profileFirstName').value,
        birthDate,
        sex: document.querySelector('#profileSex').value,
      }),
    });
    currentUser = result.user;
    await enterApp();
  } catch (error) {
    profileMessage.textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Continuar';
  }
});

entryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setEntryMessage('');
  const parsedDate = brazilianToISO(nightDate.value);
  if (!parsedDate) {
    setEntryMessage('Digite uma data válida no formato dd/mm/aaaa.');
    nightDate.focus();
    return;
  }
  if (parsedDate > SonoSleepDate.todayISO()) {
    setEntryMessage('Escolha uma data de hoje ou anterior.');
    return;
  }
  if (hasEntryForDate(parsedDate)) {
    setEntryMessage('Esta noite já está registrada. Escolha uma data disponível no calendário.');
    renderCalendar();
    return;
  }
  if (selectedQuality == null) {
    setEntryMessage('Escolha uma nota para a qualidade do sono.');
    return;
  }
  selectedDateISO = parsedDate;
  renderCalendar();
  const button = entryForm.querySelector('button[type="submit"]');
  button.disabled = true;
  button.dataset.saving = 'true';
  button.textContent = 'Salvando…';
  try {
    const data = readEntryForm();
    await api(`/api/entries/${selectedDateISO}`, { method: 'PUT', body: JSON.stringify(data) });
    await loadEntries();
    renderCalendar();
    fillEntryForm();
    setEntryMessage('', true);
    renderWeek();
    if (currentProgram) renderProgram();
  } catch (error) {
    if (error.status === 401) return showAuth();
    if (error.status === 409) {
      await loadEntries();
      renderCalendar();
      updateSaveButton();
    }
    setEntryMessage(error.message);
  } finally {
    delete button.dataset.saving;
    updateSaveButton();
  }
});

function commitDateInput() {
  const parsedDate = brazilianToISO(nightDate.value);
  if (!parsedDate) {
    setEntryMessage('Digite uma data válida no formato dd/mm/aaaa.');
    nightDate.value = isoToBrazilian(selectedDateISO);
    return;
  }
  if (parsedDate > SonoSleepDate.todayISO()) {
    nightDate.value = isoToBrazilian(selectedDateISO);
    setEntryMessage('Escolha uma data de hoje ou anterior.');
    return;
  }
  if (hasEntryForDate(parsedDate) && parsedDate !== selectedDateISO) {
    nightDate.value = isoToBrazilian(selectedDateISO);
    setEntryMessage('Esta noite já está registrada. Escolha outra data.');
    return;
  }
  if (parsedDate === selectedDateISO) {
    setEntryMessage('');
    return;
  }
  selectedDateISO = parsedDate;
  calendarMonth = monthStart(selectedDateISO);
  renderCalendar();
  setEntryMessage('');
  fillEntryForm();
  updateSaveButton();
}

nightDate.addEventListener('change', commitDateInput);
nightDate.addEventListener('blur', commitDateInput);

nightDate.addEventListener('input', () => {
  const digits = nightDate.value.replace(/\D/g, '').slice(0, 8);
  if (digits.length > 4) nightDate.value = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  else if (digits.length > 2) nightDate.value = `${digits.slice(0, 2)}/${digits.slice(2)}`;
  else nightDate.value = digits;
});

document.querySelector('#calendarToggle').addEventListener('click', () => setCalendarOpen(calendarPopover.classList.contains('hidden')));
document.querySelector('#calendarPrev').addEventListener('click', () => shiftCalendarMonth(-1));
document.querySelector('#calendarNext').addEventListener('click', () => shiftCalendarMonth(1));
document.querySelector('#calendarMonth').addEventListener('click', () => {
  calendarMonth = monthStart(selectedDateISO);
  renderCalendar();
});
document.querySelector('#calendarYesterday').addEventListener('click', () => selectCalendarDate(addDaysISO(SonoSleepDate.todayISO(), -1)));
document.querySelector('#calendarToday').addEventListener('click', () => selectCalendarDate(SonoSleepDate.todayISO()));
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.date-control')) setCalendarOpen(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !calendarPopover.classList.contains('hidden')) {
    setCalendarOpen(false);
    document.querySelector('#calendarToggle').focus();
  }
});

document.querySelector('#startProgramButton').addEventListener('click', startProgram);
document.querySelector('#saveWakeTime').addEventListener('click', saveWakeTime);
document.querySelector('#calculateWindow').addEventListener('click', calculateSleepWindow);
document.querySelector('#advanceWeekButton').addEventListener('click', advanceProgramWeek);
document.querySelector('#saveFinalAssessment').addEventListener('click', saveFinalAssessment);
document.querySelector('#reviewWeekButton').addEventListener('click', reviewProgramWeek);
document.querySelector('#applyWindowButton').addEventListener('click', applySuggestedWindow);

async function enterApp() {
  authView.classList.add('hidden');
  if (!currentUser.first_name || !currentUser.birth_date || !currentUser.sex) {
    appView.classList.add('hidden');
    profileView.classList.remove('hidden');
    document.querySelector('#profileFirstName').value = currentUser.first_name || '';
    document.querySelector('#profileBirthDate').value = currentUser.birth_date ? isoToBrazilian(currentUser.birth_date) : '';
    document.querySelector('#profileSex').value = currentUser.sex || '';
    return;
  }
  profileView.classList.add('hidden');
  appView.classList.remove('hidden');
  document.querySelector('#userEmail').textContent = currentUser.email;
  document.querySelector('#welcomeName').textContent = currentUser.first_name;
  await loadEntries();
  await loadProgram();
  if (hasEntryForDate(selectedDateISO)) selectedDateISO = findLatestAvailableDate(addDaysISO(SonoSleepDate.todayISO(), -1));
  calendarMonth = monthStart(selectedDateISO);
  nightDate.value = isoToBrazilian(selectedDateISO);
  renderCalendar();
  fillEntryForm();
  updateSaveButton();
  setView('diary');
}

function showAuth() {
  currentUser = null;
  currentProgram = null;
  appView.classList.add('hidden');
  profileView.classList.add('hidden');
  authView.classList.remove('hidden');
}

async function logout() {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  entries = [];
  historyEntries = [];
  registeredDates = new Set();
  showAuth();
  setAuthMode('login');
}

async function deleteAccount() {
  const button = document.querySelector('#confirmDeleteAccount');
  const message = document.querySelector('#accountDeleteMessage');
  button.disabled = true;
  button.textContent = 'Excluindo…';
  message.textContent = '';
  try {
    await api('/api/account', { method: 'DELETE' });
    entries = [];
    historyEntries = [];
    registeredDates = new Set();
    selectedQuality = null;
    currentProgram = null;
    authForm.reset();
    accountDialog.close();
    showAuth();
    setAuthMode('login');
    authMessage.textContent = 'Sua conta e seus registros foram excluídos.';
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Excluir definitivamente';
  }
}

async function loadEntries() {
  const [result, dateResult, historyResult] = await Promise.all([
    api('/api/entries'), api('/api/entry-dates'), api('/api/entries/history'),
  ]);
  entries = result.entries;
  registeredDates = new Set(dateResult.dates);
  historyEntries = historyResult.entries;
}

async function loadProgram() {
  const result = await api('/api/program');
  currentProgram = result.program;
}

function renderAssessment(container, prefix, scores = []) {
  container.innerHTML = assessmentQuestions.map((question, index) => `
    <div class="assessment-row"><span>${question}</span><div class="assessment-choices" role="radiogroup" aria-label="Nota para pergunta ${index + 1}">
      ${[0, 1, 2, 3].map((score) => `<label>${score}<input type="radio" name="${prefix}-${index}" value="${score}" ${Number(scores[index]) === score ? 'checked' : ''}></label>`).join('')}
    </div></div>`).join('');
}

function readAssessment(prefix) {
  const answers = assessmentQuestions.map((_, index) => document.querySelector(`input[name="${prefix}-${index}"]:checked`));
  return answers.every(Boolean) ? answers.map((input) => Number(input.value)) : null;
}

function renderProgram() {
  const setup = document.querySelector('#programSetup');
  const active = document.querySelector('#programActive');
  setup.classList.toggle('hidden', Boolean(currentProgram));
  active.classList.toggle('hidden', !currentProgram);
  if (!currentProgram) {
    document.querySelector('#programStartDateHint').textContent = `A Semana 0 começará na noite selecionada no diário: ${isoToBrazilian(selectedDateISO)}.`;
    return;
  }

  const week = Number(currentProgram.current_week);
  const titles = [
    'Conhecer o seu sono', 'Criar uma base segura', 'Ensinar que a cama é lugar de dormir',
    'Acalmar a cabeça e o corpo', 'Comparar e decidir os próximos passos',
  ];
  const descriptions = [
    'Durante sete noites, preencha o diário sem tentar mudar nada. O objetivo é observar.',
    'Escolha um horário fixo para acordar. Revise o diário e, se a checagem de segurança permitir, calcule a janela de sono.',
    'Continue os registros e pratique as regras da cama apresentadas no guia.',
    'Continue o diário e pratique uma rotina de desaceleração que funcione para você.',
    'Compare o início e o fim do plano usando o diário e a autoavaliação.',
  ];
  const start = dateOnly(currentProgram.start_date);
  const weekStart = addDaysISO(start, week * 7);
  const weekEnd = addDaysISO(weekStart, 6);
  const weekEntries = entries.filter((entry) => dateOnly(entry.night_date) >= weekStart && dateOnly(entry.night_date) <= weekEnd);
  document.querySelector('#programWeekNumber').textContent = `SEMANA ${week}`;
  document.querySelector('#programWeekTitle').textContent = titles[week];
  document.querySelector('#programWeekDescription').textContent = `${descriptions[week]} Período: ${isoToBrazilian(weekStart)} a ${isoToBrazilian(weekEnd)}.`;
  document.querySelector('#programWeekProgress').textContent = `${weekEntries.length} de 7 noites`;
  document.querySelector('#fixedWakeTime').value = currentProgram.fixed_wake_time ? String(currentProgram.fixed_wake_time).slice(0, 5) : '';
  document.querySelector('#saveWakeTime').classList.toggle('hidden', week > 0);
  const advanceButton = document.querySelector('#advanceWeekButton');
  advanceButton.classList.toggle('hidden', week >= 4);
  advanceButton.textContent = week === 0 ? 'Concluir Semana 0 e começar Semana 1 →' : `Concluir Semana ${week} e avançar →`;
  document.querySelector('#programRules').classList.toggle('hidden', week < 1);

  const safetyNotice = document.querySelector('#programSafetyNotice');
  const hasSafetyFlag = Array.isArray(currentProgram.safety_flags) && currentProgram.safety_flags.length > 0;
  safetyNotice.classList.toggle('hidden', !hasSafetyFlag);
  safetyNotice.textContent = hasSafetyFlag
    ? 'A checagem marcou um item de segurança. O guia orienta fazer os cálculos e ajustes da janela com um profissional. Você pode continuar usando o diário e vendo seus registros.'
    : '';

  const needsWakeTime = week === 0 && !currentProgram.fixed_wake_time;
  const needsWeeklyReview = week > 0 && !hasSafetyFlag
    && (Number(currentProgram.last_reviewed_week) !== week || currentProgram.sleep_window_min == null || currentProgram.pending_window_min != null);
  advanceButton.disabled = week < 4 && (weekEntries.length < 7 || needsWakeTime || needsWeeklyReview);
  const advanceHint = document.querySelector('#advanceWeekHint');
  if (weekEntries.length < 7) {
    const missing = 7 - weekEntries.length;
    advanceHint.textContent = `Preencha ${missing} ${missing === 1 ? 'noite que falta' : 'noites que faltam'} desta semana para liberar o avanço.`;
  } else if (needsWakeTime) {
    advanceHint.textContent = 'Defina e salve o horário fixo para acordar para liberar a Semana 1.';
  } else if (needsWeeklyReview) {
    advanceHint.textContent = 'Faça a revisão semanal e aplique a janela sugerida para liberar o avanço.';
  } else {
    advanceHint.textContent = week < 4 ? 'As sete noites estão preenchidas. Você já pode concluir esta semana.' : '';
  }

  const windowCard = document.querySelector('#windowCard');
  const canCalculate = week === 1 && !hasSafetyFlag;
  const showWindow = week >= 1;
  windowCard.classList.toggle('hidden', !showWindow);
  document.querySelector('#calculateWindow').classList.toggle('hidden', !canCalculate || Boolean(currentProgram.sleep_window_min));
  if (currentProgram.sleep_window_min) {
    const duration = Number(currentProgram.sleep_window_min);
    document.querySelector('#windowResult').textContent = `${formatMinutes(duration)} na cama`;
    document.querySelector('#windowExplanation').textContent = currentProgram.fixed_wake_time
      ? `Pelo guia, a hora de deitar seria a partir de ${subtractMinutesFromTime(String(currentProgram.fixed_wake_time).slice(0, 5), duration)}. Reveja esta orientação junto com seu profissional se tiver dúvidas.`
      : 'Sua janela está calculada.';
  } else {
    document.querySelector('#windowResult').textContent = 'Sua janela ainda não foi calculada.';
    document.querySelector('#windowExplanation').textContent = hasSafetyFlag
      ? 'A janela não será calculada pelo app porque a checagem recomenda acompanhamento profissional.'
      : 'O cálculo fica disponível após sete noites preenchidas na Semana 0 e a escolha do horário fixo para acordar.';
  }

  const weeklyReview = document.querySelector('#weeklyReview');
  const canReview = week >= 1 && week <= 3 && Boolean(currentProgram.sleep_window_min) && !hasSafetyFlag;
  weeklyReview.classList.toggle('hidden', !canReview);
  document.querySelector('#daytimeFeeling').value = currentProgram.daytime_feeling || '';
  document.querySelector('#reviewWeekButton').classList.toggle('hidden', !canReview || Number(currentProgram.last_reviewed_week) === week);
  document.querySelector('#applyWindowButton').classList.toggle('hidden', !canReview || currentProgram.pending_window_min == null);
  if (canReview && currentProgram.pending_window_min != null) {
    document.querySelector('#weeklyReviewResult').textContent = `Sugestão: ${formatMinutes(Number(currentProgram.pending_window_min))} na cama. Aplique para salvar antes de avançar.`;
  } else if (canReview && Number(currentProgram.last_reviewed_week) === week) {
    document.querySelector('#weeklyReviewResult').textContent = `Janela atual: ${formatMinutes(Number(currentProgram.sleep_window_min))}. Revisão concluída para esta semana.`;
  } else {
    document.querySelector('#weeklyReviewResult').textContent = '';
  }

  const finalPanel = document.querySelector('#week4AssessmentPanel');
  finalPanel.classList.toggle('hidden', week !== 4);
  if (week === 4) {
    renderAssessment(document.querySelector('#finalAssessment'), 'final', currentProgram.week4_assessment || []);
    const initial = currentProgram.baseline_assessment || [];
    const final = currentProgram.week4_assessment || [];
    if (final.length === 5) {
      const initialTotal = initial.reduce((sum, value) => sum + Number(value), 0);
      const finalTotal = final.reduce((sum, value) => sum + Number(value), 0);
      document.querySelector('#finalAssessmentResult').textContent = `Pontuação inicial: ${initialTotal}/15 · agora: ${finalTotal}/15. A pontuação é um registro pessoal, não um diagnóstico.`;
    } else {
      document.querySelector('#finalAssessmentResult').textContent = '';
    }
  }
}

async function startProgram() {
  const message = document.querySelector('#programSetupMessage');
  message.textContent = '';
  const assessment = readAssessment('baseline');
  if (!assessment) {
    message.textContent = 'Responda às cinco perguntas antes de começar.';
    return;
  }
  const safetyFlags = [...document.querySelectorAll('input[name="safety"]:checked')].map((input) => input.value);
  const button = document.querySelector('#startProgramButton');
  button.disabled = true;
  try {
    const result = await api('/api/program', {
      method: 'POST',
      body: JSON.stringify({ startDate: selectedDateISO, safetyFlags, baselineAssessment: assessment }),
    });
    currentProgram = result.program;
    renderProgram();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function saveWakeTime() {
  const message = document.querySelector('#programMessage');
  const fixedWakeTime = document.querySelector('#fixedWakeTime').value;
  if (!fixedWakeTime) {
    message.textContent = 'Escolha um horário fixo para acordar.';
    return;
  }
  try {
    const result = await api('/api/program', { method: 'PATCH', body: JSON.stringify({ fixedWakeTime }) });
    currentProgram = result.program;
    message.textContent = 'Horário fixo salvo.';
    renderProgram();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function calculateSleepWindow() {
  const message = document.querySelector('#programMessage');
  message.textContent = '';
  try {
    const result = await api('/api/program/window', { method: 'POST', body: JSON.stringify({}) });
    currentProgram = result.program;
    renderProgram();
    document.querySelector('#windowExplanation').textContent = `Média de sono da Semana 0: ${formatMinutes(result.averageSleepMin)}. O guia arredonda para o intervalo de 15 minutos mais próximo e não usa menos de 5 horas.`;
  } catch (error) {
    message.textContent = error.message;
  }
}

async function advanceProgramWeek() {
  const message = document.querySelector('#programMessage');
  message.textContent = '';
  try {
    const result = await api('/api/program/advance', { method: 'POST', body: JSON.stringify({}) });
    currentProgram = result.program;
    renderProgram();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function reviewProgramWeek() {
  const resultLabel = document.querySelector('#weeklyReviewResult');
  const daytimeFeeling = document.querySelector('#daytimeFeeling').value;
  if (!daytimeFeeling) {
    resultLabel.textContent = 'Conte como você se sentiu durante o dia para fazer a revisão.';
    return;
  }
  try {
    const result = await api('/api/program/review', { method: 'POST', body: JSON.stringify({ daytimeFeeling }) });
    currentProgram = result.program;
    renderProgram();
    resultLabel.textContent = `Média de sono: ${formatMinutes(result.averageSleepMin)} · média na cama: ${formatMinutes(result.averageBedMin)} · eficiência: ${result.efficiency}%. ${result.reason} Sugestão: ${formatMinutes(Number(currentProgram.pending_window_min))} na cama.`;
  } catch (error) {
    resultLabel.textContent = error.message;
  }
}

async function applySuggestedWindow() {
  const message = document.querySelector('#programMessage');
  message.textContent = '';
  try {
    const result = await api('/api/program/apply-window', { method: 'POST', body: JSON.stringify({}) });
    currentProgram = result.program;
    renderProgram();
    message.textContent = 'Janela atualizada. Agora você pode concluir a semana quando estiver pronta(o).';
  } catch (error) {
    message.textContent = error.message;
  }
}

async function saveFinalAssessment() {
  const resultLabel = document.querySelector('#finalAssessmentResult');
  const assessment = readAssessment('final');
  if (!assessment) {
    resultLabel.textContent = 'Responda às cinco perguntas antes de salvar.';
    return;
  }
  try {
    const result = await api('/api/program', { method: 'PATCH', body: JSON.stringify({ week4Assessment: assessment }) });
    currentProgram = result.program;
    renderProgram();
  } catch (error) {
    resultLabel.textContent = error.message;
  }
}

function readEntryForm() {
  const value = (id) => document.querySelector(`#${id}`).value;
  return {
    wentToBed: value('wentToBed'),
    sleepLatencyMin: Number(value('sleepLatencyMin')),
    awakenings: Number(value('awakenings')),
    awakeDuringNightMin: Number(value('awakeDuringNightMin')),
    finalWake: value('finalWake'),
    gotOutOfBed: value('gotOutOfBed'),
    quality: selectedQuality,
    caffeineLastTime: value('caffeineLastTime'),
    alcoholDoses: value('alcoholDoses'),
    alcoholLastTime: value('alcoholLastTime'),
    cigaretteLastTime: value('cigaretteLastTime'),
    medicationNotes: value('medicationNotes'),
    habits: Object.fromEntries([...document.querySelectorAll('input[name="habit"]')].map((input) => [input.value, input.checked])),
  };
}

function fillEntryForm() {
  entryForm.reset();
  const details = entryForm.querySelector('.optional-details');
  if (details) details.open = false;
  nightDate.value = isoToBrazilian(selectedDateISO);
  document.querySelectorAll('input[name="habit"]').forEach((input) => { input.checked = false; });
  setQuality(null);
  setEntryMessage('');
  updateEstimate();
  updateSaveButton();
}

function hasEntryForDate(iso) {
  return registeredDates.has(iso) || entries.some((entry) => dateOnly(entry.night_date) === iso);
}

function findLatestAvailableDate(preferredISO) {
  for (let offset = 0; offset < 28; offset += 1) {
    const candidate = addDaysISO(preferredISO, -offset);
    if (!hasEntryForDate(candidate)) return candidate;
  }
  return preferredISO;
}

function updateSaveButton() {
  const button = entryForm.querySelector('button[type="submit"]');
  if (button.dataset.saving === 'true') return;
  const alreadySaved = hasEntryForDate(selectedDateISO);
  button.disabled = alreadySaved;
  button.innerHTML = alreadySaved ? 'Noite já registrada' : 'Salvar noite <span aria-hidden="true">→</span>';
}

function setEntryMessage(message, success = false) {
  entryMessage.classList.toggle('success-message', success);
  if (success) {
    entryMessage.innerHTML = '<span class="save-check" aria-hidden="true">✓</span><span>Noite registrada com sucesso!</span>';
  } else {
    entryMessage.textContent = message || '';
  }
}

function updateEstimate() {
  const bed = document.querySelector('#wentToBed').value;
  const rise = document.querySelector('#gotOutOfBed').value;
  const finalWake = document.querySelector('#finalWake').value;
  if (!bed || !finalWake || !rise) {
    estimate.innerHTML = '<span class="estimate-copy">Preencha os horários para ver a estimativa.</span>';
    return;
  }
  const night = calculateNight({
    wentToBed: bed,
    sleepLatencyMin: Number(document.querySelector('#sleepLatencyMin').value || 0),
    awakeDuringNightMin: Number(document.querySelector('#awakeDuringNightMin').value || 0),
    finalWake,
    gotOutOfBed: rise,
  });
  const { inBed, asleep } = night;
  const efficiency = inBed ? Math.round((asleep / inBed) * 100) : 0;
  estimate.innerHTML = `<div><span class="estimate-copy">Estimativa desta noite</span><small>Com base nos horários e nos seus palpites</small></div><div><strong>${formatMinutes(asleep)} de sono</strong><small>${efficiency}% de eficiência · ${formatMinutes(inBed)} na cama</small></div>`;
}

function renderWeek() {
  const sorted = [...entries].sort((a, b) => dateOnly(b.night_date).localeCompare(dateOnly(a.night_date)));
  const values = SonoSleepDate.lastCompletedNightDates(SonoSleepDate.todayISO()).map((date) => {
    const entry = sorted.find((item) => dateOnly(item.night_date) === date);
    if (!entry) return { date, bed: 0, sleep: 0, hasEntry: false };
    const { inBed, asleep } = calculateNight({
      wentToBed: timePart(entry.went_to_bed),
      sleepLatencyMin: entry.sleep_latency_min,
      awakeDuringNightMin: entry.awake_during_night_min,
      finalWake: timePart(entry.final_wake),
      gotOutOfBed: timePart(entry.got_out_of_bed),
    });
    return { date, bed: inBed, sleep: asleep, hasEntry: true };
  });
  const recorded = values.filter((item) => item.hasEntry);
  renderHistory();
  document.querySelector('#weekCount').textContent = `${recorded.length} de 7 noites com registro`;
  if (!recorded.length) {
    document.querySelector('#avgBed').textContent = '—';
    document.querySelector('#avgSleep').textContent = '—';
    document.querySelector('#avgEfficiency').textContent = '—';
    document.querySelector('#weekChart').innerHTML = '<p class="week-empty">Suas noites registradas vão aparecer aqui.</p>';
    return;
  }
  const avg = (key) => Math.round(recorded.reduce((total, item) => total + item[key], 0) / recorded.length);
  const averageBed = avg('bed');
  const averageSleep = avg('sleep');
  document.querySelector('#weekCount').textContent = `${recorded.length} de 7 noites com registro`;
  document.querySelector('#avgBed').textContent = formatMinutes(averageBed);
  document.querySelector('#avgSleep').textContent = formatMinutes(averageSleep);
  document.querySelector('#avgEfficiency').textContent = `${averageBed ? Math.round((averageSleep / averageBed) * 100) : 0}%`;
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const max = Math.max(480, ...values.map((item) => item.sleep));
  document.querySelector('#weekChart').innerHTML = values.map((item) => {
    const height = Math.max(2, Math.round((item.sleep / max) * 100));
    const day = new Date(`${item.date}T12:00:00`).getDay();
    return `<div class="bar-column"><div class="bar-area"><span class="bar-value" style="--bar-height:${height}%">${item.hasEntry ? shortHours(item.sleep) : '—'}</span><div class="bar${item.hasEntry ? '' : ' bar-empty'}" style="height:${height}%"></div></div><span class="bar-label">${days[day]}</span></div>`;
  }).join('');
}

function renderHistory() {
  const list = document.querySelector('#historyList');
  const empty = document.querySelector('#historyEmpty');
  list.replaceChildren();
  empty.classList.toggle('hidden', historyEntries.length > 0);
  historyEntries.forEach((entry) => {
    const { asleep } = calculateNight({
      wentToBed: timePart(entry.went_to_bed),
      sleepLatencyMin: entry.sleep_latency_min,
      awakeDuringNightMin: entry.awake_during_night_min,
      finalWake: timePart(entry.final_wake),
      gotOutOfBed: timePart(entry.got_out_of_bed),
    });
    const item = document.createElement('li');
    const details = document.createElement('div');
    const date = document.createElement('strong');
    date.textContent = isoToBrazilian(dateOnly(entry.night_date));
    const quality = document.createElement('small');
    quality.textContent = `Qualidade do sono: ${entry.quality} de 5`;
    details.append(date, quality);
    const sleep = document.createElement('strong');
    sleep.textContent = `${formatMinutes(asleep)} de sono`;
    item.append(details, sleep);
    list.append(item);
  });
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || 'Algo deu errado. Tente novamente.');
    error.status = response.status;
    throw error;
  }
  return body;
}

function minutesBetween(start, end) {
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  let difference = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
  if (difference < 0) difference += 24 * 60;
  return difference;
}

function formatMinutes(value) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${hours}h${String(minutes).padStart(2, '0')}`;
}

function shortHours(value) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${hours}h${minutes ? String(minutes).padStart(2, '0') : ''}`;
}

function timePart(value) {
  return String(value).slice(0, 5);
}

function dateOnly(value) {
  return String(value).slice(0, 10);
}

function addDaysISO(iso, amount) {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return toDateInput(date);
}

function subtractMinutesFromTime(value, amount) {
  const [hour, minute] = value.split(':').map(Number);
  const result = ((hour * 60 + minute - amount) % 1440 + 1440) % 1440;
  return `${String(Math.floor(result / 60)).padStart(2, '0')}:${String(result % 60).padStart(2, '0')}`;
}

function toDateInput(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function isoToBrazilian(iso) {
  return iso.split('-').reverse().join('/');
}

function brazilianToISO(value) {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const check = new Date(Number(year), Number(month) - 1, Number(day));
  if (check.getFullYear() !== Number(year) || check.getMonth() !== Number(month) - 1 || check.getDate() !== Number(day)) return null;
  return `${year}-${month}-${day}`;
}

function monthStart(iso) {
  return `${iso.slice(0, 7)}-01`;
}

function shiftCalendarMonth(amount) {
  const [year, month] = calendarMonth.split('-').map(Number);
  const next = new Date(year, month - 1 + amount, 1);
  calendarMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
  renderCalendar();
}

function renderCalendar() {
  const [year, month] = calendarMonth.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(year, month - 1, 1 - mondayOffset);
  const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(firstDay);
  document.querySelector('#calendarMonth').textContent = monthLabel.charAt(0).toLocaleUpperCase('pt-BR') + monthLabel.slice(1);
  const weekdays = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  calendarGrid.innerHTML = weekdays.map((day) => `<span class="calendar-weekday" role="columnheader">${day}</span>`).join('');
  const todayISO = SonoSleepDate.todayISO();
  for (let index = 0; index < 42; index += 1) {
    const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'calendar-day';
    button.textContent = String(day.getDate());
    button.setAttribute('role', 'gridcell');
    button.setAttribute('aria-label', new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(day));
    button.setAttribute('aria-pressed', String(iso === selectedDateISO));
    if (day.getMonth() !== month - 1) button.classList.add('outside-month');
    if (iso === selectedDateISO) button.classList.add('selected');
    if (iso === todayISO) button.classList.add('today');
    const registered = hasEntryForDate(iso);
    if (registered) {
      button.classList.add('has-entry');
      button.title = 'Esta noite já foi registrada';
      button.setAttribute('aria-label', `${button.getAttribute('aria-label')}. Noite já registrada`);
    }
    if (iso > todayISO || registered) button.disabled = true;
    button.addEventListener('click', () => selectCalendarDate(iso));
    calendarGrid.append(button);
  }
}

function selectCalendarDate(iso) {
  if (hasEntryForDate(iso)) {
    setEntryMessage('Esta noite já está registrada. Escolha uma data disponível.');
    return;
  }
  selectedDateISO = iso;
  nightDate.value = isoToBrazilian(iso);
  calendarMonth = monthStart(iso);
  renderCalendar();
  setCalendarOpen(false);
  setEntryMessage('');
  fillEntryForm();
  updateSaveButton();
}

function setCalendarOpen(open) {
  calendarPopover.classList.toggle('hidden', !open);
  nightDate.setAttribute('aria-expanded', String(open));
  document.querySelector('#calendarToggle').setAttribute('aria-expanded', String(open));
}
