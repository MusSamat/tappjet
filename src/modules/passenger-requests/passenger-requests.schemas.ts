import { z } from 'zod';

const CityName = z.string().trim().min(1).max(50);

export const CreatePassengerRequestBody = z
  .object({
    originCity: CityName,
    destinationCity: CityName,
    seatsNeeded: z.coerce.number().int().min(1).max(8),
    departureDate: z.string().datetime({ offset: true }),
    flexible: z.boolean().default(false),
    comment: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.originCity !== v.destinationCity, {
    message: 'origin and destination must differ',
    path: ['destinationCity'],
  });

export type CreatePassengerRequestInput = z.infer<typeof CreatePassengerRequestBody>;

export const ListRequestsQuery = z.object({
  from_city: CityName.optional(),
  to_city: CityName.optional(),
  date: z.string().datetime({ offset: true }).optional(),
  seats: z.coerce.number().int().min(1).max(8).optional(),
  // Plain uuid, or 'nb_'-prefixed uuid when paginating the same-raion
  // nearby tier (see districtCityNames fallback in the service).
  cursor: z.string().regex(/^(nb_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListRequestsInput = z.infer<typeof ListRequestsQuery>;

export const RequestIdParam = z.object({ id: z.string().uuid() });

// Per-day open-request counts for the route (calendar hints in the date picker).
export const RequestCalendarQuery = z.object({
  from_city: CityName,
  to_city: CityName,
});

export const RespondBody = z.object({
  price: z.number().int().min(1).max(100_000),
  departureTime: z.string().datetime({ offset: true }),
  message: z.string().trim().max(500).optional(),
});
export type RespondInput = z.infer<typeof RespondBody>;

export const ResponseIdParam = z.object({
  id: z.string().uuid(),
  responseId: z.string().uuid(),
});
