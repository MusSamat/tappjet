import { z } from 'zod';

const CURRENT_YEAR = new Date().getUTCFullYear();

/**
 * Car data fields — submitted as text parts of the multipart upload alongside
 * the four photo files (license, car_passport, car_photo, selfie).
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
  // Kyrgyz plate formats vary — uppercase letters + digits, 4–15 chars.
  carPlate: z
    .string()
    .trim()
    .min(4)
    .max(15)
    .regex(/^[A-Z0-9\-\s]+$/, 'car_plate must be uppercase letters/digits/dashes'),
  seatsCount: z.coerce.number().int().min(1).max(7),
});

export type DriverVerificationInput = z.infer<typeof DriverVerificationBody>;

/**
 * On re-upload (/drivers/verification/upload) — only specific fields for the
 * admin's request-list. Keyed by category which must match what admin asked.
 */
export const DriverReuploadQuery = z.object({
  category: z.enum(['license', 'car_passport', 'car_photo', 'selfie']),
});
