/**
 * Seed glucose_logs with varied morning, lunch, and evening readings for the past 7 days.
 *
 * Usage:
 *   node --env-file=.env scripts/seed-glucose-readings.mjs
 *
 * Optional env:
 *   TEST_USER_ID  — Supabase auth user id (default: test user)
 *   DRY_RUN=1     — print rows without inserting
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const USER_ID = process.env.TEST_USER_ID ?? '238b4ce8-68fa-4080-aafd-92d55e192f1d';
const DRY_RUN = process.env.DRY_RUN === '1';
const GLUCOSE_UNIT = 'mmol/L';
const SEED_MARKER = 'seed-glucose-readings';

/** @param {number} min @param {number} max @param {number} decimals */
function randomInRange(min, max, decimals = 1) {
  const value = min + Math.random() * (max - min);
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** @param {Date} date @param {number} hour @param {number} minute */
function atLocalTime(date, hour, minute) {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/**
 * Per-day glucose ranges (mmol/L). Lunch is post-meal (higher); morning is fasting (lower).
 * @type {Array<{ morning: [number, number], lunch: [number, number], evening: [number, number], foods: { morning: string, lunch: string, evening: string }, comments: { morning: string, lunch: string, evening: string } }>}
 */
const dayProfiles = [
  {
    morning: [4.8, 5.6],
    lunch: [7.2, 8.4],
    evening: [6.0, 7.0],
    foods: { morning: 'oatmeal with berries', lunch: 'grilled chicken salad', evening: 'vegetable soup and bread' },
    comments: { morning: 'felt a bit hungry', lunch: 'feeling good after lunch', evening: 'relaxed, no symptoms' },
  },
  {
    morning: [5.0, 5.8],
    lunch: [8.0, 9.5],
    evening: [7.2, 8.6],
    foods: { morning: 'scrambled eggs and toast', lunch: 'rice and beans with stew', evening: 'pasta with tomato sauce' },
    comments: { morning: 'slept well', lunch: 'a little tired after eating', evening: 'slightly thirsty' },
  },
  {
    morning: [4.5, 5.4],
    lunch: [6.5, 7.8],
    evening: [5.8, 6.8],
    foods: { morning: 'yoghurt and banana', lunch: 'sadza and greens', evening: 'grilled fish and vegetables' },
    comments: { morning: 'feeling fine', lunch: 'good energy', evening: 'calm evening' },
  },
  {
    morning: [5.2, 6.1],
    lunch: [9.0, 10.8],
    evening: [8.5, 9.8],
    foods: { morning: 'peanut butter on toast', lunch: 'white rice, chicken, and coleslaw', evening: 'leftover rice and stew' },
    comments: { morning: 'normal start', lunch: 'felt sluggish after carbs', evening: 'still a bit high' },
  },
  {
    morning: [4.6, 5.5],
    lunch: [7.0, 8.2],
    evening: [6.2, 7.4],
    foods: { morning: 'milk and cereal', lunch: 'beef stew with potatoes', evening: 'chicken wrap' },
    comments: { morning: 'slightly low, had a snack later', lunch: 'satisfied', evening: 'feeling okay' },
  },
  {
    morning: [5.1, 6.0],
    lunch: [7.5, 8.9],
    evening: [6.8, 7.9],
    foods: { morning: 'boiled eggs and avocado', lunch: 'pizza slice and salad', evening: 'roast chicken and sweet potato' },
    comments: { morning: 'good energy', lunch: 'post-meal walk helped', evening: 'mild thirst' },
  },
  {
    morning: [4.9, 5.7],
    lunch: [6.8, 7.6],
    evening: [5.5, 6.5],
    foods: { morning: 'smoothie with spinach', lunch: 'lentil soup and wholegrain roll', evening: 'steamed vegetables and tofu' },
    comments: { morning: 'feeling rested', lunch: 'steady after lunch', evening: 'good end to the week' },
  },
];

function buildReadings() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows = [];

  for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
    const date = new Date(today);
    date.setDate(today.getDate() - dayOffset);
    const profile = dayProfiles[6 - dayOffset];

    const slots = [
      { key: 'morning', hour: 7, minute: 15 + (dayOffset % 3) * 10 },
      { key: 'lunch', hour: 12, minute: 30 + (dayOffset % 2) * 15 },
      { key: 'evening', hour: 18, minute: 45 + (dayOffset % 3) * 5 },
    ];

    for (const slot of slots) {
      const [min, max] = profile[slot.key];
      rows.push({
        user_id: USER_ID,
        glucose_value: randomInRange(min, max),
        glucose_unit: GLUCOSE_UNIT,
        foods_eaten: profile.foods[slot.key],
        comments: `${profile.comments[slot.key]} [${SEED_MARKER}]`,
        logged_at: atLocalTime(date, slot.hour, slot.minute),
        entry_tag: 'late_entry',
      });
    }
  }

  return rows;
}

const { data: profile, error: profileErr } = await supabase
  .from('profiles')
  .select('name, glucose_unit')
  .eq('user_id', USER_ID)
  .single();

if (profileErr) {
  console.error('Profile fetch failed:', profileErr.message);
  process.exit(1);
}

const unit = profile?.glucose_unit ?? GLUCOSE_UNIT;
const readings = buildReadings().map((row) => ({ ...row, glucose_unit: unit }));

console.log(`User:     ${profile?.name ?? USER_ID} (${USER_ID})`);
console.log(`Unit:     ${unit}`);
console.log(`Readings: ${readings.length} (7 days × morning, lunch, evening)`);
console.log(`Range:    ${readings[0].logged_at.slice(0, 10)} → ${readings.at(-1).logged_at.slice(0, 10)}`);

if (DRY_RUN) {
  console.log('\nDry run — no rows inserted.\n');
  for (const row of readings) {
    const time = new Date(row.logged_at).toLocaleString('en-ZA', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    console.log(`${time}  ${row.glucose_value} ${row.glucose_unit}  ${row.foods_eaten}`);
  }
  process.exit(0);
}

const { data, error } = await supabase.from('glucose_logs').insert(readings).select('id, logged_at, glucose_value');

if (error) {
  console.error('Insert failed:', error.message);
  process.exit(1);
}

console.log(`\nInserted ${data.length} glucose readings.\n`);
for (const row of data) {
  const time = new Date(row.logged_at).toLocaleString('en-ZA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  console.log(`${time}  ${row.glucose_value} ${unit}`);
}

console.log(`\nTo remove seed data later:
  DELETE FROM glucose_logs WHERE comments LIKE '%[${SEED_MARKER}]%' AND user_id = '${USER_ID}';`);
