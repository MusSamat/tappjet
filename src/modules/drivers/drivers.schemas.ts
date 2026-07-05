import { z } from 'zod';

const CURRENT_YEAR = new Date().getUTCFullYear();

/**
 * Car data fields — submitted as text parts of the multipart upload alongside
 * the six photo files (license front/back, car_passport front/back, car_photo, selfie).
 * TZ §9.1 step 1 + §5.3 CHECK constraints.
 */
export const DriverVerificationBody = z.object({
  carMake: z.string().trim().min(1).max(50),
  carModel: z.string().trim().min(1).max(50),
  carYear: z.coerce
    .number()
    .int()
    .min(1980, 'car must be from 1980 or newer')
    .max(CURRENT_YEAR + 1, `car_year cannot exceed ${CURRENT_YEAR + 1}`),
  carColor: z.string().trim().min(1).max(30),
  // KG plate standard (2016+): <region 01–10> "KG" <3 digits> <3 latin letters>,
  // e.g. 01KG003ADD. Lowercase/spaces are normalized here, format is strict.
  carPlate: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase().replace(/[\s-]/g, ''))
    .pipe(
      z
        .string()
        // Standard 2016+ plate, or a manual/legacy entry (uppercase alnum,
        // 4–10 chars) — the wizard's «ввести вручную» escape hatch for cars
        // still carrying old-format plates.
        .regex(
          /^(?:(?:0[1-9]|10)KG\d{3}[A-Z]{3}|[A-Z0-9]{4,10})$/,
          'car_plate must be 01KG123ABC or a legacy uppercase plate',
        ),
    ),
  seatsCount: z.coerce.number().int().min(1).max(7),
});

export type DriverVerificationInput = z.infer<typeof DriverVerificationBody>;

/**
 * On re-upload (/drivers/verification/upload) — only specific fields for the
 * admin's request-list. Keyed by category which must match what admin asked.
 */
export const DriverReuploadQuery = z.object({
  category: z.enum(['license', 'license_back', 'car_passport', 'car_passport_back', 'car_photo', 'selfie']),
});
