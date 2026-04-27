import { z } from 'zod';

// TZ §16.2 categories.
export const ComplaintCategory = z.enum(['safety', 'fraud', 'rudeness', 'no_show', 'other']);

export const ComplaintCreateBody = z
  .object({
    category: ComplaintCategory,
    // TZ §16.2 step 3 "Обязательно · до 2000 символов".
    description: z.string().trim().min(3).max(2000),
    targetUserId: z.string().uuid().optional(),
    targetTripId: z.string().uuid().optional(),
  })
  .refine((v) => v.targetUserId || v.targetTripId, {
    message: 'targetUserId or targetTripId is required',
    path: ['targetUserId'],
  });

export type ComplaintCreateInput = z.infer<typeof ComplaintCreateBody>;

export const MyComplaintsQuery = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
