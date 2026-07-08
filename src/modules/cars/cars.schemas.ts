import { z } from 'zod';

export const CarCreateBody = z.object({
  make: z.string().trim().min(1).max(50),
  model: z.string().trim().min(1).max(50),
  color: z.string().trim().max(30).optional(),
  plate: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4,15}$/, 'latin letters and digits'),
  seatsCount: z.coerce.number().int().min(1).max(7).default(4),
});
export type CarCreateInput = z.infer<typeof CarCreateBody>;

export const CarIdParam = z.object({ id: z.string().uuid() });
