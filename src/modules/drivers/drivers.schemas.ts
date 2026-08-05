import { z } from 'zod';
import { PLATE_REGEX, normalizePlate } from '@/lib/plate.js';

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
    .min(2000, 'car must be from 2000 or newer')
    .max(CURRENT_YEAR + 1, `car_year cannot exceed ${CURRENT_YEAR + 1}`),
  carColor: z.string().trim().min(1).max(30),
  // Единый стандарт номера — тот же, что в гараже (cars.schemas): после
  // нормализации 4–10 латинских букв/цифр (покрывает 2016+ формат 01KG123ABC
  // и номера старого образца).
  carPlate: z
    .string()
    .trim()
    .transform(normalizePlate)
    .pipe(
      z.string().regex(PLATE_REGEX, 'car_plate must be 4-10 latin letters and digits'),
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
