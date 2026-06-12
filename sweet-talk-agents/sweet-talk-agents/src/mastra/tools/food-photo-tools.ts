import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { callAgent } from '../lib/agent-call';

const SUPPORTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

const MIME_TO_EXT: Record<string, SupportedMimeType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Validate that the supplied file extension or MIME type is one the
 * Food Photo Agent supports (JPEG, PNG, WEBP).
 */
export const validateImageFormatTool = createTool({
  id: 'validate-image-format',
  description:
    'Check whether the supplied image format is supported (JPEG, PNG, WEBP). Returns isValid and the resolved MIME type. Call this before analyseImage.',
  inputSchema: z.object({
    fileExtensionOrMime: z
      .string()
      .describe(
        'Either a file extension (e.g. "jpg", "png") or a full MIME type (e.g. "image/jpeg")',
      ),
  }),
  outputSchema: z.object({
    isValid: z.boolean(),
    mimeType: z.string().nullable(),
  }),
  execute: async ({ fileExtensionOrMime }) => {
    const normalized = fileExtensionOrMime.toLowerCase().trim();

    if (SUPPORTED_MIME_TYPES.includes(normalized as SupportedMimeType)) {
      return { isValid: true, mimeType: normalized };
    }

    const resolved = MIME_TO_EXT[normalized] ?? null;
    return { isValid: resolved !== null, mimeType: resolved };
  },
});

/**
 * Send an image to the Anthropic Vision API and return a plain-text
 * description of the food visible in it.
 *
 * The image can be supplied as:
 *  - a base64-encoded string (imageBase64 + mimeType), or
 *  - a publicly accessible URL (imageUrl).
 *
 * Returns "UNCLEAR_IMAGE" when no food is identifiable.
 * Returns "UNSUPPORTED_FORMAT" when the MIME type is not one of the
 * three supported types — callers should run validateImageFormatTool first.
 */
export const analyseImageTool = createTool({
  id: 'analyse-image',
  description:
    'Send a food photo to Claude Vision and return a plain-text description of the food items visible (e.g. "white rice, grilled chicken, mixed vegetables"). Returns "UNCLEAR_IMAGE" if no food is identifiable.',
  inputSchema: z.object({
    imageBase64: z
      .string()
      .optional()
      .describe('Base64-encoded image data (without the data URI prefix)'),
    imageUrl: z
      .string()
      .optional()
      .describe('Publicly accessible URL of the image — used when base64 is not available'),
    mimeType: z
      .string()
      .optional()
      .describe('MIME type of the image, e.g. "image/jpeg". Required when using imageBase64.'),
  }),
  outputSchema: z.object({
    foodDescription: z.string(),
  }),
  execute: async ({ imageBase64, imageUrl, mimeType }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }

    // Resolve base64 + mimeType when only a URL is supplied
    let resolvedBase64 = imageBase64;
    let resolvedMime = mimeType ?? 'image/jpeg';

    if (!resolvedBase64 && imageUrl) {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image from URL: ${response.statusText}`);
      }
      const contentType = response.headers.get('content-type') ?? 'image/jpeg';
      resolvedMime = contentType.split(';')[0].trim();
      const arrayBuffer = await response.arrayBuffer();
      resolvedBase64 = Buffer.from(arrayBuffer).toString('base64');
    }

    if (!resolvedBase64) {
      throw new Error('Either imageBase64 or imageUrl must be provided');
    }

    if (!SUPPORTED_MIME_TYPES.includes(resolvedMime as SupportedMimeType)) {
      return { foodDescription: 'UNSUPPORTED_FORMAT' };
    }

    const body = {
      model: process.env.ANTHROPIC_VISION_MODEL ?? 'claude-sonnet-4-5',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: resolvedMime,
                data: resolvedBase64,
              },
            },
            {
              type: 'text',
              text: 'Identify all visible food items in this image. Be specific (e.g. "white rice, grilled chicken thigh, mixed vegetables including carrots and cabbage"). Return only the comma-separated food description, nothing else. If the image is unclear, too dark, or contains no food, reply with exactly the word: UNCLEAR_IMAGE',
            },
          ],
        },
      ],
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic Vision API error: ${err}`);
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
    };

    const text = data.content.find((c) => c.type === 'text')?.text?.trim() ?? 'UNCLEAR_IMAGE';
    return { foodDescription: text };
  },
});

/**
 * Hand the resolved food description (or UNCLEAR_IMAGE / UNSUPPORTED_FORMAT)
 * off to the Extraction + Logging Agent along with the original message, so
 * it can be incorporated into extraction as the foods_eaten field.
 */
export const handoffToExtractionTool = createTool({
  id: 'handoff-to-extraction',
  description:
    "Pass the resolved food description (or UNCLEAR_IMAGE / UNSUPPORTED_FORMAT) and the user's original message to the Extraction + Logging Agent. Returns its response to relay to the user.",
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
    foodDescription: z
      .string()
      .describe('The food description string, or "UNCLEAR_IMAGE" / "UNSUPPORTED_FORMAT"'),
    message: z.string().optional().describe("The user's original message accompanying the photo"),
  }),
  outputSchema: z.object({
    response: z.string(),
  }),
  execute: async ({ userId, foodDescription, message }, context) => {
    let prompt: string;

    if (foodDescription === 'UNCLEAR_IMAGE') {
      prompt = `userId: ${userId}\noriginal message: ${message ?? ''}\nThe attached food photo was unclear — no food could be identified. Ask the user to describe what they ate in text.`;
    } else if (foodDescription === 'UNSUPPORTED_FORMAT') {
      prompt = `userId: ${userId}\noriginal message: ${message ?? ''}\nThe attached food photo was in an unsupported format (only JPEG, PNG, WEBP are supported). Let the user know and ask them to describe what they ate in text, or resend in a supported format.`;
    } else {
      prompt = `userId: ${userId}\noriginal message: ${message ?? ''}\nphoto food description (from photo): ${foodDescription} (from photo)`;
    }

    const response = await callAgent(context.mastra, 'extraction-logging-agent', prompt);

    return { response };
  },
});
