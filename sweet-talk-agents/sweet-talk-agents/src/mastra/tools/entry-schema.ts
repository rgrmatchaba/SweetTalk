import { z } from 'zod';

/**
 * A single glucose log entry as produced by the Extraction Agent and
 * consumed by the Validation + Confirmation Agent. Fields are optional
 * here because entries may be INCOMPLETE while still being validated —
 * `validateEntriesTool` checks which required fields are missing.
 */
export const entrySchema = z.object({
  glucose_value: z.number().nullable().optional().describe('Numeric glucose reading'),
  glucose_unit: z.string().nullable().optional().describe("From the user's profile, e.g. mmol/L"),
  foods_eaten: z.string().nullable().optional().describe('Main meal/food description'),
  snacks: z.string().nullable().optional().describe('Snacks, or "none" if not mentioned'),
  comments: z.string().nullable().optional().describe('Feelings/symptoms, e.g. "feeling fine"'),
  logged_at: z.string().nullable().optional().describe('ISO timestamp for the reading'),
  timing_context: z
    .string()
    .nullable()
    .optional()
    .describe('e.g. "morning", "after lunch", "before dinner"'),
});

export type Entry = z.infer<typeof entrySchema>;

/** Fields that must be present (non-null) before an entry can be saved. */
export const REQUIRED_ENTRY_FIELDS = ['glucose_value', 'foods_eaten', 'comments', 'logged_at'] as const;
