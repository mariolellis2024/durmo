const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');
const { calculateNight } = require('./public/sleep-math');
const { isNotFutureDate, ageAtISODate } = require('./public/sleep-date');

loadLocalEnv();

const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const attempts = new Map();
const DAY_MS = 24 * 60 * 60 * 1000;

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, message: 'Banco de dados indisponível.' });
  }
});

app.post('/api/register', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const pin = String(req.body?.pin || '');
  if (!validEmail(email) || !/^\d{6}$/.test(pin)) {
    return res.status(400).json({ message: 'Informe um e-mail válido e um PIN de 6 números.' });
  }

  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pin, salt);
  const id = crypto.randomUUID();
  try {
    await pool.query(
      'INSERT INTO app_users (id, email, pin_salt, pin_hash) VALUES ($1, $2, $3, $4)',
      [id, email, salt, hash]
    );
    await createSession(res, id);
    res.status(201).json({ user: { email, first_name: null, birth_date: null, sex: null } });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: 'Este e-mail já tem uma conta.' });
    console.error('Falha ao criar conta:', error.message);
    res.status(500).json({ message: 'Não foi possível criar a conta agora.' });
  }
});

app.post('/api/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const pin = String(req.body?.pin || '');
  if (!validEmail(email) || !/^\d{6}$/.test(pin)) {
    return res.status(400).json({ message: 'Confira o e-mail e o PIN de 6 números.' });
  }
  if (isThrottled(req, email)) {
    return res.status(429).json({ message: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email, pin_salt, pin_hash, first_name, birth_date::text AS birth_date, sex FROM app_users WHERE LOWER(email) = $1',
      [email]
    );
    const user = result.rows[0];
    const salt = user?.pin_salt || Buffer.alloc(16);
    const expected = user?.pin_hash || Buffer.alloc(64);
    const actual = await scrypt(pin, salt);
    const accepted = crypto.timingSafeEqual(expected, actual) && Boolean(user);
    if (!accepted) {
      registerFailedAttempt(req, email);
      return res.status(401).json({ message: 'E-mail ou PIN incorreto.' });
    }
    clearAttempts(req, email);
    await createSession(res, user.id);
    res.json({ user: publicUser(user) });
  } catch (error) {
    console.error('Falha no acesso:', error.message);
    res.status(500).json({ message: 'Não foi possível entrar agora.' });
  }
});

app.post('/api/logout', async (req, res) => {
  const token = readCookie(req, 'sono_session');
  if (token) {
    await pool.query('DELETE FROM app_sessions WHERE token_hash = $1', [tokenHash(token)]).catch(() => {});
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', requireUser, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.put('/api/profile', requireUser, async (req, res) => {
  const firstName = String(req.body?.firstName || '').trim().replace(/\s+/g, ' ');
  const birthDate = String(req.body?.birthDate || '');
  const sex = String(req.body?.sex || '');
  const validSex = new Set(['female', 'male', 'intersex', 'prefer_not_to_say']);
  if (!firstName || firstName.length > 60 || !isValidDate(birthDate)
      || !isNotFutureDate(birthDate) || !validSex.has(sex)) {
    return res.status(400).json({ message: 'Confira seu primeiro nome, data de nascimento e sexo.' });
  }
  const result = await pool.query(
    `UPDATE app_users SET first_name = $2, birth_date = $3, sex = $4
      WHERE id = $1
      RETURNING email, first_name, birth_date::text AS birth_date, sex`,
    [req.user.id, firstName, birthDate, sex]
  );
  res.json({ user: publicUser(result.rows[0]) });
});

app.get('/api/entries', requireUser, async (req, res) => {
  const result = await pool.query(
    `SELECT id, night_date, went_to_bed, lights_out, sleep_latency_min, awakenings,
            awake_during_night_min, final_wake, got_out_of_bed, quality, naps_min,
            caffeine_last_time, alcohol_notes, alcohol_doses, alcohol_last_time,
            cigarette_last_time, medication_notes, habits
       FROM sleep_entries
      WHERE user_id = $1 AND night_date >= CURRENT_DATE - INTERVAL '27 days'
      ORDER BY night_date DESC`,
    [req.user.id]
  );
  res.json({ entries: result.rows });
});

app.get('/api/entries/history', requireUser, async (req, res) => {
  const result = await pool.query(
    `SELECT night_date, went_to_bed, lights_out, sleep_latency_min, awake_during_night_min,
            final_wake, got_out_of_bed, quality
       FROM sleep_entries
      WHERE user_id = $1
      ORDER BY night_date DESC
      LIMIT 28`,
    [req.user.id]
  );
  res.json({ entries: result.rows });
});

app.get('/api/entry-dates', requireUser, async (req, res) => {
  const result = await pool.query(
    'SELECT night_date::text AS date FROM sleep_entries WHERE user_id = $1 ORDER BY night_date DESC',
    [req.user.id]
  );
  res.json({ dates: result.rows.map((row) => row.date) });
});

app.put('/api/entries/:date', requireUser, async (req, res) => {
  const date = req.params.date;
  const data = req.body || {};
  if (!isValidDate(date) || !isNotFutureDate(date) || !isValidEntry(data)) {
    return res.status(400).json({ message: 'Confira a data, os horários e os dados preenchidos. A data deve ser hoje ou anterior.' });
  }
  const id = crypto.randomUUID();
  const result = await pool.query(
    `INSERT INTO sleep_entries (
       id, user_id, night_date, went_to_bed, lights_out, sleep_latency_min,
       awakenings, awake_during_night_min, final_wake, got_out_of_bed, quality,
       naps_min, caffeine_last_time, alcohol_notes, alcohol_doses, alcohol_last_time,
       cigarette_last_time, medication_notes, habits
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (user_id, night_date) DO NOTHING
     RETURNING id, night_date`,
    [id, req.user.id, date, data.wentToBed, data.lightsOut, data.sleepLatencyMin,
      data.awakenings, data.awakeDuringNightMin, data.finalWake, data.gotOutOfBed,
      data.quality, data.napsMin || 0, data.caffeineLastTime || null,
      cleanNote(data.alcoholNotes), cleanNote(data.alcoholDoses), data.alcoholLastTime || null,
      data.cigaretteLastTime || null, cleanNote(data.medicationNotes), cleanHabits(data.habits)]
  );
  if (!result.rowCount) {
    return res.status(409).json({ message: 'Esta noite já está registrada. Escolha uma data disponível.' });
  }
  res.json({ entry: result.rows[0] });
});

app.get('/api/program', requireUser, async (req, res) => {
  const result = await pool.query(
    `SELECT start_date, current_week, safety_flags, age_65_plus, baseline_assessment, week4_assessment,
            fixed_wake_time, sleep_window_min, previous_window_min, pending_window_min,
            window_change_week, below_target_weeks, last_reviewed_week, daytime_feeling
       FROM sleep_programs WHERE user_id = $1`,
    [req.user.id]
  );
  res.json({ program: result.rows[0] || null });
});

app.post('/api/program', requireUser, async (req, res) => {
  const { startDate, safetyFlags, baselineAssessment } = req.body || {};
  if (!req.user.birth_date || !isValidDate(startDate) || !isNotFutureDate(startDate) || !isValidSafetyFlags(safetyFlags) || !isValidAssessment(baselineAssessment)) {
    return res.status(400).json({ message: 'Confira a data, a checagem de segurança e as cinco respostas da autoavaliação.' });
  }
  const age65Plus = ageAtISODate(req.user.birth_date, startDate) >= 65;
  try {
    const result = await pool.query(
      `INSERT INTO sleep_programs (user_id, start_date, safety_flags, age_65_plus, baseline_assessment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING start_date, current_week, safety_flags, age_65_plus, baseline_assessment,
                 week4_assessment, fixed_wake_time, sleep_window_min, previous_window_min,
                 pending_window_min, window_change_week, below_target_weeks, last_reviewed_week, daytime_feeling`,
      [req.user.id, startDate, JSON.stringify(safetyFlags), age65Plus, JSON.stringify(baselineAssessment)]
    );
    res.status(201).json({ program: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: 'Seu plano já foi iniciado.' });
    throw error;
  }
});

app.patch('/api/program', requireUser, async (req, res) => {
  const data = req.body || {};
  const fields = [];
  const values = [req.user.id];
  if (data.fixedWakeTime !== undefined) {
    if (!isOptionalTime(data.fixedWakeTime)) return res.status(400).json({ message: 'Informe um horário válido para acordar.' });
    values.push(data.fixedWakeTime || null);
    fields.push(`fixed_wake_time = $${values.length}`);
  }
  if (data.week4Assessment !== undefined) {
    if (!isValidAssessment(data.week4Assessment)) return res.status(400).json({ message: 'Responda às cinco perguntas com uma nota de 0 a 3.' });
    values.push(JSON.stringify(data.week4Assessment));
    fields.push(`week4_assessment = $${values.length}`);
  }
  if (data.daytimeFeeling !== undefined) {
    if (!['better', 'same', 'worse'].includes(data.daytimeFeeling)) return res.status(400).json({ message: 'Selecione como você se sentiu durante o dia.' });
    values.push(data.daytimeFeeling);
    fields.push(`daytime_feeling = $${values.length}`);
  }
  if (!fields.length) return res.status(400).json({ message: 'Não há mudanças para salvar.' });
  const result = await pool.query(
    `UPDATE sleep_programs SET ${fields.join(', ')}, updated_at = NOW()
      WHERE user_id = $1
      RETURNING start_date, current_week, safety_flags, age_65_plus, baseline_assessment, week4_assessment,
                fixed_wake_time, sleep_window_min, previous_window_min, pending_window_min,
                window_change_week, below_target_weeks, last_reviewed_week, daytime_feeling`,
    values
  );
  if (!result.rowCount) return res.status(404).json({ message: 'Inicie seu plano antes de alterar essas informações.' });
  res.json({ program: result.rows[0] });
});

app.post('/api/program/advance', requireUser, async (req, res) => {
  const result = await pool.query('SELECT start_date, current_week, fixed_wake_time, last_reviewed_week, sleep_window_min, pending_window_min, safety_flags FROM sleep_programs WHERE user_id = $1', [req.user.id]);
  const program = result.rows[0];
  if (!program) return res.status(404).json({ message: 'Inicie seu plano antes de avançar.' });
  if (program.current_week >= 4) return res.status(409).json({ message: 'Você já chegou à Semana 4.' });
  if (program.current_week === 0 && !program.fixed_wake_time) {
    return res.status(400).json({ message: 'Escolha seu horário fixo para acordar antes de começar a Semana 1.' });
  }
  if (program.current_week > 0 && !program.safety_flags?.length
      && (program.last_reviewed_week !== program.current_week || program.sleep_window_min == null || program.pending_window_min != null)) {
    return res.status(400).json({ message: 'Faça a revisão semanal e aplique a janela sugerida antes de avançar.' });
  }
  const start = dateOffset(program.start_date, program.current_week * 7);
  const end = dateOffset(start, 6);
  const count = await pool.query(
    'SELECT COUNT(*)::int AS count FROM sleep_entries WHERE user_id = $1 AND night_date BETWEEN $2 AND $3',
    [req.user.id, start, end]
  );
  if (count.rows[0].count < 7) {
    return res.status(400).json({ message: `Há ${count.rows[0].count} de 7 noites preenchidas nesta semana. Complete o diário antes de avançar.` });
  }
  const updated = await pool.query(
    `UPDATE sleep_programs SET current_week = current_week + 1, pending_window_min = NULL,
        last_reviewed_week = NULL, daytime_feeling = NULL, updated_at = NOW()
      WHERE user_id = $1
      RETURNING start_date, current_week, safety_flags, age_65_plus, baseline_assessment, week4_assessment,
                fixed_wake_time, sleep_window_min, previous_window_min, pending_window_min,
                window_change_week, below_target_weeks, last_reviewed_week, daytime_feeling`,
    [req.user.id]
  );
  res.json({ program: updated.rows[0] });
});

app.post('/api/program/window', requireUser, async (req, res) => {
  const result = await pool.query(
    'SELECT start_date, current_week, safety_flags, fixed_wake_time FROM sleep_programs WHERE user_id = $1',
    [req.user.id]
  );
  const program = result.rows[0];
  if (!program) return res.status(404).json({ message: 'Inicie seu plano antes de calcular a janela.' });
  if (program.safety_flags?.length) {
    return res.status(409).json({ message: 'O guia recomenda calcular e ajustar a janela com um profissional. O diário continua disponível.' });
  }
  if (program.current_week !== 1 || !program.fixed_wake_time) {
    return res.status(400).json({ message: 'O cálculo da janela fica disponível depois da Semana 0 e da escolha do horário fixo para acordar.' });
  }
  const start = dateOffset(program.start_date, 0);
  const end = dateOffset(start, 6);
  const nights = await pool.query(
    `SELECT went_to_bed, lights_out, sleep_latency_min, awake_during_night_min, final_wake, got_out_of_bed
       FROM sleep_entries WHERE user_id = $1 AND night_date BETWEEN $2 AND $3`,
    [req.user.id, start, end]
  );
  if (nights.rowCount !== 7) return res.status(400).json({ message: 'Preencha as sete noites da Semana 0 para calcular a janela.' });
  const averageSleepMin = Math.round(nights.rows.reduce((total, night) => total + sleepMetrics(night).asleep, 0) / 7);
  const sleepWindowMin = Math.min(900, Math.max(300, Math.round(averageSleepMin / 15) * 15));
  const saved = await pool.query(
    `UPDATE sleep_programs SET sleep_window_min = $2, updated_at = NOW()
      WHERE user_id = $1
      RETURNING start_date, current_week, safety_flags, age_65_plus, baseline_assessment, week4_assessment,
                fixed_wake_time, sleep_window_min, previous_window_min, pending_window_min,
                window_change_week, below_target_weeks, last_reviewed_week, daytime_feeling`,
    [req.user.id, sleepWindowMin]
  );
  res.json({ program: saved.rows[0], averageSleepMin });
});

app.post('/api/program/review', requireUser, async (req, res) => {
  const { daytimeFeeling } = req.body || {};
  if (!['better', 'same', 'worse'].includes(daytimeFeeling)) {
    return res.status(400).json({ message: 'Selecione como você se sentiu durante o dia.' });
  }
  const result = await pool.query(
    `SELECT start_date, current_week, safety_flags, age_65_plus, sleep_window_min,
            last_reviewed_week,
            previous_window_min, window_change_week, below_target_weeks
       FROM sleep_programs WHERE user_id = $1`, [req.user.id]
  );
  const program = result.rows[0];
  if (!program) return res.status(404).json({ message: 'Inicie seu plano antes da revisão.' });
  if (program.current_week < 1 || program.current_week > 3 || program.sleep_window_min == null) {
    return res.status(400).json({ message: 'A revisão semanal fica disponível nas Semanas 1 a 3, após o cálculo da janela.' });
  }
  if (program.safety_flags?.length) {
    return res.status(409).json({ message: 'Como a checagem pede acompanhamento profissional, o app não sugere ajustes da janela.' });
  }
  if (Number(program.last_reviewed_week) === Number(program.current_week)) {
    return res.status(409).json({ message: 'Esta semana já foi revisada. Aplique a sugestão antes de avançar.' });
  }
  const start = dateOffset(program.start_date, program.current_week * 7);
  const end = dateOffset(start, 6);
  const nights = await pool.query(
    `SELECT went_to_bed, lights_out, sleep_latency_min, awake_during_night_min, final_wake, got_out_of_bed
       FROM sleep_entries WHERE user_id = $1 AND night_date BETWEEN $2 AND $3`,
    [req.user.id, start, end]
  );
  if (nights.rowCount !== 7) return res.status(400).json({ message: 'Preencha as sete noites desta semana para revisar.' });
  const totals = nights.rows.reduce((sum, night) => {
    const metrics = sleepMetrics(night);
    sum.sleep += metrics.asleep;
    sum.bed += metrics.inBed;
    return sum;
  }, { sleep: 0, bed: 0 });
  const efficiency = totals.bed ? Math.round(totals.sleep / totals.bed * 100) : 0;
  let belowTargetWeeks = efficiency < 85 ? Number(program.below_target_weeks || 0) + 1 : 0;
  let suggestedWindow = Number(program.sleep_window_min);
  let reason;
  if (belowTargetWeeks >= 2 && program.previous_window_min && program.window_change_week != null
      && program.current_week > program.window_change_week) {
    suggestedWindow = Number(program.previous_window_min);
    reason = 'A eficiência ficou abaixo de 85% por duas semanas após um aumento. O guia recomenda voltar à janela anterior.';
  } else if (efficiency < 80) {
    suggestedWindow = Math.max(300, suggestedWindow - 15);
    reason = 'A eficiência ficou abaixo de 80%; o guia sugere reduzir a janela em 15 minutos, respeitando o mínimo de 5 horas.';
  } else if (efficiency >= (program.age_65_plus ? 85 : 90)
      && !(efficiency >= 85 && daytimeFeeling === 'better')) {
    suggestedWindow = Math.min(900, suggestedWindow + 15);
    reason = `A eficiência atingiu a meta de ${program.age_65_plus ? 85 : 90}%; o guia sugere aumentar a janela em 15 minutos.`;
  } else if (efficiency >= 85 && daytimeFeeling === 'better') {
    reason = 'A eficiência chegou a pelo menos 85% e você se sente melhor durante o dia; mantenha a janela atual.';
  } else {
    reason = 'A eficiência está entre 80% e a meta desta faixa; mantenha a janela atual.';
  }
  const saved = await pool.query(
    `UPDATE sleep_programs SET pending_window_min = $2, daytime_feeling = $3,
        below_target_weeks = $4, last_reviewed_week = current_week, updated_at = NOW()
      WHERE user_id = $1
      RETURNING start_date, current_week, safety_flags, age_65_plus, baseline_assessment, week4_assessment,
                fixed_wake_time, sleep_window_min, previous_window_min, pending_window_min,
                window_change_week, below_target_weeks, last_reviewed_week, daytime_feeling`,
    [req.user.id, suggestedWindow, daytimeFeeling, belowTargetWeeks]
  );
  res.json({ program: saved.rows[0], averageSleepMin: Math.round(totals.sleep / 7), averageBedMin: Math.round(totals.bed / 7), efficiency, reason });
});

app.post('/api/program/apply-window', requireUser, async (req, res) => {
  const saved = await pool.query(
    `UPDATE sleep_programs SET
        previous_window_min = CASE WHEN pending_window_min > sleep_window_min THEN sleep_window_min ELSE previous_window_min END,
        window_change_week = CASE WHEN pending_window_min > sleep_window_min THEN current_week ELSE window_change_week END,
        sleep_window_min = pending_window_min, pending_window_min = NULL, updated_at = NOW()
      WHERE user_id = $1 AND pending_window_min IS NOT NULL AND last_reviewed_week = current_week
      RETURNING start_date, current_week, safety_flags, age_65_plus, baseline_assessment, week4_assessment,
                fixed_wake_time, sleep_window_min, previous_window_min, pending_window_min,
                window_change_week, below_target_weeks, last_reviewed_week, daytime_feeling`,
    [req.user.id]
  );
  if (!saved.rowCount) return res.status(400).json({ message: 'Faça a revisão da semana antes de aplicar uma sugestão.' });
  res.json({ program: saved.rows[0] });
});

app.delete('/api/account', requireUser, async (req, res) => {
  await pool.query('DELETE FROM app_users WHERE id = $1', [req.user.id]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

async function requireUser(req, res, next) {
  try {
    const token = readCookie(req, 'sono_session');
    if (!token) return res.status(401).json({ message: 'Entre para continuar.' });
    const result = await pool.query(
    `SELECT u.id, u.email, u.first_name, u.birth_date::text AS birth_date, u.sex
         FROM app_sessions s JOIN app_users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [tokenHash(token)]
    );
    if (!result.rowCount) {
      clearSessionCookie(res);
      return res.status(401).json({ message: 'Sua sessão terminou. Entre novamente.' });
    }
    req.user = result.rows[0];
    next();
  } catch (error) {
    console.error('Falha ao validar sessão:', error.message);
    res.status(500).json({ message: 'Não foi possível carregar sua conta.' });
  }
}

async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + 30 * DAY_MS);
  await pool.query('DELETE FROM app_sessions WHERE expires_at <= NOW()');
  await pool.query('INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [tokenHash(token), userId, expires]);
  res.cookie('sono_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie('sono_session', { httpOnly: true, sameSite: 'lax', path: '/' });
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest();
}

function readCookie(req, name) {
  const cookies = (req.headers.cookie || '').split(';');
  const pair = cookies.map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function publicUser(user) {
  return { email: user.email, first_name: user.first_name || null, birth_date: user.birth_date || null, sex: user.sex || null };
}

function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function scrypt(pin, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pin, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function attemptKey(req, email) {
  return `${req.ip || req.socket.remoteAddress}:${email}`;
}

function isThrottled(req, email) {
  const record = attempts.get(attemptKey(req, email));
  if (!record || Date.now() - record.first > 15 * 60 * 1000) return false;
  return record.count >= 8;
}

function registerFailedAttempt(req, email) {
  const key = attemptKey(req, email);
  const record = attempts.get(key);
  if (!record || Date.now() - record.first > 15 * 60 * 1000) {
    attempts.set(key, { first: Date.now(), count: 1 });
  } else {
    record.count += 1;
  }
}

function clearAttempts(req, email) {
  attempts.delete(attemptKey(req, email));
}

function isValidEntry(data) {
  const requiredTimes = ['wentToBed', 'lightsOut', 'finalWake', 'gotOutOfBed'];
  if (!requiredTimes.every((key) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(data[key] || '')))) return false;
  const optionalTimes = ['caffeineLastTime', 'alcoholLastTime', 'cigaretteLastTime'];
  if (!optionalTimes.every((key) => !data[key] || /^([01]\d|2[0-3]):[0-5]\d$/.test(String(data[key])))) return false;
  const numbers = [data.sleepLatencyMin, data.awakenings, data.awakeDuringNightMin, data.quality, data.napsMin || 0];
  if (!numbers.every((n) => Number.isInteger(Number(n)))) return false;
  return Number(data.sleepLatencyMin) >= 0 && Number(data.sleepLatencyMin) <= 720
    && Number(data.awakenings) >= 0 && Number(data.awakenings) <= 50
    && Number(data.awakeDuringNightMin) >= 0 && Number(data.awakeDuringNightMin) <= 720
    && Number(data.quality) >= 1 && Number(data.quality) <= 5
    && Number(data.napsMin || 0) >= 0 && Number(data.napsMin || 0) <= 720;
}

const SAFETY_FLAGS = new Set([
  'unintended_sleep_or_high_risk_work',
  'snoring_or_gasping',
  'restless_legs_pain_or_new_medicine',
  'bipolar_epilepsy_pregnancy_or_severe_distress',
  'age_65_or_fall_risk',
  'shift_work_night_care_or_late_sleep',
  'planning_to_change_sleep_medicine',
]);

function isValidSafetyFlags(value) {
  return Array.isArray(value) && value.length <= SAFETY_FLAGS.size
    && value.every((item) => typeof item === 'string' && SAFETY_FLAGS.has(item))
    && new Set(value).size === value.length;
}

function isValidAssessment(value) {
  return Array.isArray(value) && value.length === 5
    && value.every((score) => Number.isInteger(Number(score)) && Number(score) >= 0 && Number(score) <= 3);
}

function isOptionalTime(value) {
  return value === '' || value === null || value === undefined
    || /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value));
}

function isValidDate(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateOffset(value, days) {
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function sleepMetrics(entry) {
  return calculateNight({
    wentToBed: entry.went_to_bed,
    lightsOut: entry.lights_out,
    sleepLatencyMin: entry.sleep_latency_min,
    awakeDuringNightMin: entry.awake_during_night_min,
    finalWake: entry.final_wake,
    gotOutOfBed: entry.got_out_of_bed,
  });
}

function cleanNote(value) {
  const note = String(value || '').trim();
  return note ? note.slice(0, 300) : null;
}

function cleanHabits(value) {
  const keys = ['wokeFixedTime', 'bedWhenSleepy', 'leftBedWhenAwake', 'noNap', 'morningLight', 'keptRoutine'];
  const habits = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(keys.map((key) => [key, habits[key] === true]));
}

function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

async function start() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8'));
  app.listen(port, '0.0.0.0', () => {
    console.log(`DURMO disponível em http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error('Não foi possível iniciar o app:', error.message);
  process.exit(1);
});
