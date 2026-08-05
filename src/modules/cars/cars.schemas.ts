import { z } from 'zod';
import { PLATE_REGEX, normalizePlate } from '@/lib/plate.js';

export const CarCreateBody = z.object({
  make: z.string().trim().min(1).max(50),
  model: z.string().trim().min(1).max(50),
  color: z.string().trim().max(30).optional(),
  year: z.coerce.number().int().min(2000).max(new Date().getFullYear() + 1).optional(),
  // Единый стандарт номера — тот же, что в верификации (drivers.schemas).
  plate: z
    .string()
    .trim()
    .transform(normalizePlate)
    .pipe(z.string().regex(PLATE_REGEX, '4-10 latin letters and digits')),
  seatsCount: z.coerce.number().int().min(1).max(7).default(4),
});
export type CarCreateInput = z.infer<typeof CarCreateBody>;

export const CarIdParam = z.object({ id: z.string().uuid() });
