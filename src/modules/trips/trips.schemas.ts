import { z } from 'zod';

// TZ §10.1 constants:
//   departure: not less than 30 min from now, not more than 60 days ahead
//   price: 50–10_000 сом per seat
//   seats: 1–7 (tighter than driver's vehicle capacity, which is validated
//          against driver_profile.seats_count at service level)
//   horizon rules validated in service because they depend on "now"

const CityName = z.string().trim().min(1).max(50);

export const Waypoint = z.object({
  city: CityName,
  address: z.string().trim().max(200).optional(),
});

// Extra route points (any region): pickupCities = where the driver can still
// board passengers (origin side), dropoffCities = where the driver can drop
// passengers (destination side). Existence is validated at the service level.
const RouteCities = z.array(CityName).max(5).default([]);

export const TripCreateBody = z
  .object({
    originCity: CityName,
    destinationCity: CityName,
    // Which of the user's cars rides this trip; omitted → newest car.
    carId: z.string().uuid().optional(),
    originAddress: z.string().trim().min(1).max(200),
    originLat: z.number().min(-90).max(90).optional(),
    originLng: z.number().min(-180).max(180).optional(),
    pickupCities: RouteCities,
    dropoffCities: RouteCities,
    waypoints: z.array(Waypoint).max(3).default([]),
    departureAt: z.string().datetime({ offset: true }),
    // Optional «выезд примерно до» — trip departs between departureAt and this.
    departureWindowEnd: z.string().datetime({ offset: true }).optional(),
    departureFlexible: z.boolean().default(false),
    seatsTotal: z.coerce.number().int().min(1).max(7),
    pricePerSeat: z.coerce.number().int().min(50).max(10_000),
    priceNegotiable: z.boolean().default(false),
    luggage: z.enum(['yes', 'small', 'no']).default('no'),
    // Full key set the clients actually send (web maps no_smoking→smoking,
    // pets→animals). Unknown keys used to be silently stripped, which left
    // trips without the data the search filters need.
    preferences: z
      .object({
        clean: z.boolean().optional(),
        music: z.boolean().optional(),
        smoking: z.boolean().optional(),
        ac: z.boolean().optional(),
        animals: z.boolean().optional(),
        quiet: z.boolean().optional(),
        chat: z.boolean().optional(),
        women_only: z.boolean().optional(),
        // legacy client keys
        silence: z.boolean().optional(),
        no_smoking: z.boolean().optional(),
      })
      .partial()
      .default({}),
    comment: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.originCity !== v.destinationCity, {
    message: 'origin and destination must differ',
    path: ['destinationCity'],
  })
  .refine(
    (v) => {
      if (!v.departureWindowEnd) return true;
      const start = Date.parse(v.departureAt);
      const end = Date.parse(v.departureWindowEnd);
      // Window must end after it starts and stay within the same 24h.
      return end > start && end - start <= 24 * 60 * 60 * 1000;
    },
    { message: 'departureWindowEnd must be after departureAt (max 24h)', path: ['departureWindowEnd'] },
  );

export type TripCreateInput = z.infer<typeof TripCreateBody>;

export const TripIdParam = z.object({ id: z.string().uuid() });

// Per-day trip counts for the route (calendar availability in the date picker).
export const TripCalendarQuery = z.object({
  from_city: CityName,
  to_city: CityName,
});

export const TripSearchQuery = z.object({
  from_city: CityName.optional(),
  to_city: CityName.optional(),
  date: z.string().datetime({ offset: true }).optional(),
  seats: z.coerce.number().int().min(1).max(4).default(1),
  min_price: z.coerce.number().int().min(0).optional(),
  max_price: z.coerce.number().int().min(0).optional(),
  only_verified: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  min_rating: z.coerce.number().min(0).max(5).optional(),
  women_only: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  no_smoking: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  pets: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  luggage: z.enum(['yes', 'small', 'no']).optional(),
  sort: z.enum(['time', 'price_asc', 'rating_desc']).default('time'),
  // Plain uuid, or 'nb_'-prefixed uuid when paginating the same-raion
  // nearby tier (see districtCityNames fallback in the service).
  cursor: z.string().regex(/^(nb_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type TripSearchInput = z.infer<typeof TripSearchQuery>;

export const TripPatchBody = z
  .object({
    pricePerSeat: z.coerce.number().int().min(50).max(10_000).optional(),
    priceNegotiable: z.boolean().optional(),
    comment: z.string().trim().max(300).nullable().optional(),
    luggage: z.enum(['yes', 'small', 'no']).optional(),
    preferences: z
      .object({
        silence: z.boolean().optional(),
        music: z.boolean().optional(),
        no_smoking: z.boolean().optional(),
      })
      .partial()
      .optional(),
    // Allowing departureAt shift within a small window would be nice UX — but
    // TZ §10 doesn't explicitly permit or forbid it. Keeping this out of MVP
    // so we don't have to re-validate the one-trip-per-day constraint and
    // notify booked passengers. Driver must cancel + republish to change date.
  })
  .strict();

export type TripPatchInput = z.infer<typeof TripPatchBody>;

// Manual seat adjust («занято по телефону» / «место освободилось») — call-first
// reality: deals happen over the phone, the driver keeps availability honest.
export const SeatsAdjustBody = z.object({
  delta: z.union([z.literal(1), z.literal(-1)]),
});
export type SeatsAdjustInput = z.infer<typeof SeatsAdjustBody>;

export const MyTripsQuery = z.object({
  tab: z.enum(['active', 'in_transit', 'past', 'cancelled']).default('active'),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type MyTripsInput = z.infer<typeof MyTripsQuery>;

export const PriceSuggestionQuery = z.object({
  from: CityName,
  to: CityName,
});

export const IdempotencyHeader = z.object({
  'idempotency-key': z.string().uuid(),
});
