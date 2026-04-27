// TZ §14.2 tag catalog. Server-side source of truth — the client displays the
// same list. We accept arbitrary tags (TEXT[] column), but reject anything
// outside the catalog so the data stays analyzable.

export const DRIVER_TAGS = [
  // positive
  'on_time',
  'clean_car',
  'safe_driving',
  'pleasant_chat',
  'comfortable_ride',
  // negative
  'late',
  'dirty_car',
  'dangerous_driving',
  'rudeness',
  'car_mismatch',
] as const;

export const PASSENGER_TAGS = [
  // positive
  'arrived_on_time',
  'polite',
  'no_heavy_luggage',
  'pleasant_chat',
  // negative
  'late',
  'too_much_luggage',
  'rudeness',
  'no_show',
] as const;

export type DriverTag = (typeof DRIVER_TAGS)[number];
export type PassengerTag = (typeof PASSENGER_TAGS)[number];

export const ALL_TAGS = new Set<string>([...DRIVER_TAGS, ...PASSENGER_TAGS]);
