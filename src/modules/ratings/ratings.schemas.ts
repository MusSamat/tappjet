import { z } from 'zod';
import { ALL_TAGS } from './ratings.tags.js';

export const RatingCreateBody = z.object({
  tripId: z.string().uuid(),
  rateeId: z.string().uuid(),
  score: z.coerce.number().int().min(1).max(5),
  tags: z
    .array(z.string().min(1).max(50))
    .max(8)
    .default([])
    .refine(
      (tags) => tags.every((t) => ALL_TAGS.has(t)),
      { message: 'unknown tag' },
    ),
  comment: z.string().trim().max(500).optional(),
});

export type RatingCreateInput = z.infer<typeof RatingCreateBody>;

export const PendingRatingsQuery = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
