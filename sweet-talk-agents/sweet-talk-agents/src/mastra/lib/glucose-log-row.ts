/** Columns present on glucose_logs before the snacks migration is applied. */
export const GLUCOSE_LOG_SELECT =
  'glucose_value, glucose_unit, foods_eaten, comments, logged_at, entry_tag';

type GlucoseLogInsertInput = {
  user_id: string;
  glucose_value: number;
  glucose_unit: string;
  foods_eaten: string;
  snacks?: string | null;
  comments: string;
  logged_at: string;
  entry_tag: string;
};

/** Build an insert row that works whether or not the snacks column exists yet. */
export function toGlucoseLogInsert(row: GlucoseLogInsertInput) {
  const snacks = row.snacks?.trim();
  const foods = row.foods_eaten?.trim() || '';
  const foods_eaten =
    snacks && snacks !== 'none'
      ? foods
        ? `${foods} (snacks: ${snacks})`
        : `Snacks: ${snacks}`
      : foods;

  return {
    user_id: row.user_id,
    glucose_value: row.glucose_value,
    glucose_unit: row.glucose_unit,
    foods_eaten,
    comments: row.comments,
    logged_at: row.logged_at,
    entry_tag: row.entry_tag,
  };
}

/** Strip snacks from partial updates until the column exists in Supabase. */
export function toGlucoseLogUpdate(fields: Record<string, unknown>): Record<string, unknown> {
  const { snacks, ...rest } = fields;
  if (snacks !== undefined && typeof rest.foods_eaten === 'string') {
    const snackText = String(snacks).trim();
    if (snackText && snackText !== 'none') {
      const foods = rest.foods_eaten.trim();
      rest.foods_eaten = foods ? `${foods} (snacks: ${snackText})` : `Snacks: ${snackText}`;
    }
  }
  return rest;
}
