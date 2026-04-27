import type { Prisma, PrismaClient } from '@prisma/client';
import { Errors } from '@/lib/errors.js';
import { persistImage, removeImage, toFileUrl } from '@/lib/uploads.js';
import type { DriverVerificationInput } from './drivers.schemas.js';

/**
 * Driver verification flow — TZ §9.
 *
 * States:
 *   pending        — initial submission waiting for admin
 *   verified       — admin approved; user.roles now includes 'driver'
 *   rejected       — admin rejected with reason (driver may resubmit)
 *   docs_requested — admin asked for specific re-uploads
 *   suspended|blocked — reserved for ops actions (TZ §17)
 */

export type PhotoCategory = 'license' | 'car_passport' | 'car_photo' | 'selfie';

// Mapping between our input categories and the driver_profiles columns.
const CATEGORY_COLUMN: Record<PhotoCategory, keyof Prisma.DriverProfileUpdateInput> = {
  license: 'licensePhotoPath',
  car_passport: 'carPassportPath',
  car_photo: 'carPhotoPath',
  selfie: 'selfiePath',
};

export interface SubmissionFiles {
  license: Express.Multer.File;
  car_passport: Express.Multer.File;
  car_photo: Express.Multer.File;
  selfie: Express.Multer.File;
}

export interface DriverService {
  submitVerification(
    userId: string,
    body: DriverVerificationInput,
    files: SubmissionFiles,
  ): Promise<{ status: string }>;
  getStatus(userId: string): Promise<DriverStatusView>;
  reuploadDocument(
    userId: string,
    category: PhotoCategory,
    file: Express.Multer.File,
  ): Promise<{ status: string }>;
  updateCarPhoto(userId: string, file: Express.Multer.File): Promise<{ carPhotoUrl: string }>;
  getOwnStats(userId: string): Promise<{
    totalTrips: number;
    rating: number | null;
    ratingCount: number;
    cancellations30d: number;
  }>;
}

export interface DriverStatusView {
  status: 'none' | 'pending' | 'verified' | 'rejected' | 'docs_requested' | 'suspended' | 'blocked';
  submittedAt: Date | null;
  verifiedAt: Date | null;
  rejectionReason: string | null;
  requestedDocs: string[];
  car: {
    make: string;
    model: string;
    year: number;
    color: string;
    plate: string;
    seats: number;
    photoUrl: string | null;
  } | null;
}

export function createDriverService(prisma: PrismaClient): DriverService {
  // ─── Submit ─────────────────────────────────────────────────────────
  async function submitVerification(
    userId: string,
    body: DriverVerificationInput,
    files: SubmissionFiles,
  ): Promise<{ status: string }> {
    // Enforce unique plate (TZ §9.3 "Госномер не существует в car_plate (UNIQUE)").
    // Check BEFORE writing files to disk — avoids orphaned blobs on conflict.
    const plateOwner = await prisma.driverProfile.findUnique({
      where: { carPlate: body.carPlate },
      select: { userId: true },
    });
    if (plateOwner && plateOwner.userId !== userId) {
      throw Errors.conflict('Этот номер уже зарегистрирован', {
        reason: 'plate_taken',
        field: 'carPlate',
      });
    }

    const existing = await prisma.driverProfile.findUnique({ where: { userId } });
    // Can't submit while already verified/pending (re-submit allowed after reject).
    if (existing && ['pending', 'verified'].includes(existing.verificationStatus)) {
      throw Errors.conflict('Заявка уже в работе либо одобрена', {
        reason: 'already_active',
        current_status: existing.verificationStatus,
      });
    }

    // Persist the four images first so we have their paths for the DB row.
    const [license, carPassport, carPhoto, selfie] = await Promise.all([
      persistImage(files.license, 'driver_license'),
      persistImage(files.car_passport, 'car_passport'),
      persistImage(files.car_photo, 'car_photo'),
      persistImage(files.selfie, 'selfie'),
    ]);

    try {
      const now = new Date();
      const photoPaths = {
        licensePhotoPath: license.path,
        carPassportPath: carPassport.path,
        carPhotoPath: carPhoto.path,
        selfiePath: selfie.path,
      };

      if (existing) {
        // Resubmission after rejection — overwrite in place and clean up old
        // photo files so disk doesn't leak.
        const old = existing;
        await prisma.driverProfile.update({
          where: { userId },
          data: {
            carMake: body.carMake,
            carModel: body.carModel,
            carYear: body.carYear,
            carColor: body.carColor,
            carPlate: body.carPlate,
            seatsCount: body.seatsCount,
            ...photoPaths,
            verificationStatus: 'pending',
            rejectionReason: null,
            requestedDocs: { set: [] },
            submittedAt: now,
            verifiedAt: null,
            verifiedBy: null,
          },
        });
        await Promise.all([
          removeImage(old.licensePhotoPath),
          removeImage(old.carPassportPath),
          removeImage(old.carPhotoPath),
          removeImage(old.selfiePath),
        ]);
      } else {
        await prisma.driverProfile.create({
          data: {
            carMake: body.carMake,
            carModel: body.carModel,
            carYear: body.carYear,
            carColor: body.carColor,
            carPlate: body.carPlate,
            seatsCount: body.seatsCount,
            ...photoPaths,
            verificationStatus: 'pending',
            submittedAt: now,
            user: { connect: { id: userId } },
          },
        });
      }
    } catch (err) {
      // Roll back the freshly-written blobs if the DB write failed.
      await Promise.all([
        removeImage(license.path),
        removeImage(carPassport.path),
        removeImage(carPhoto.path),
        removeImage(selfie.path),
      ]);
      throw err;
    }

    return { status: 'pending' };
  }

  // ─── Read status ────────────────────────────────────────────────────
  async function getStatus(userId: string): Promise<DriverStatusView> {
    const dp = await prisma.driverProfile.findUnique({ where: { userId } });
    if (!dp) {
      return {
        status: 'none',
        submittedAt: null,
        verifiedAt: null,
        rejectionReason: null,
        requestedDocs: [],
        car: null,
      };
    }
    return {
      status: dp.verificationStatus as DriverStatusView['status'],
      submittedAt: dp.submittedAt,
      verifiedAt: dp.verifiedAt,
      rejectionReason: dp.rejectionReason,
      requestedDocs: dp.requestedDocs,
      car: {
        make: dp.carMake,
        model: dp.carModel,
        year: dp.carYear,
        color: dp.carColor,
        plate: dp.carPlate,
        seats: dp.seatsCount,
        photoUrl: toFileUrl(dp.carPhotoPath),
      },
    };
  }

  // ─── Re-upload after docs_requested ─────────────────────────────────
  async function reuploadDocument(
    userId: string,
    category: PhotoCategory,
    file: Express.Multer.File,
  ): Promise<{ status: string }> {
    const dp = await prisma.driverProfile.findUnique({ where: { userId } });
    if (!dp) throw Errors.notFound('Verification request');

    if (dp.verificationStatus !== 'docs_requested') {
      throw Errors.conflict('Re-upload only allowed after admin requested documents', {
        current_status: dp.verificationStatus,
      });
    }
    if (!dp.requestedDocs.includes(category)) {
      throw Errors.validation({
        reason: 'category_not_requested',
        category,
        expected: dp.requestedDocs,
      });
    }

    const stored = await persistImage(file, category);

    // Remove from requestedDocs; if list is empty afterwards, flip back to pending.
    const remaining = dp.requestedDocs.filter((c) => c !== category);
    const oldPathField = CATEGORY_COLUMN[category] as keyof typeof dp;
    const oldPath = dp[oldPathField] as string | null | undefined;

    const updates: Prisma.DriverProfileUpdateInput = {
      [CATEGORY_COLUMN[category]]: stored.path,
      requestedDocs: { set: remaining },
    };
    if (remaining.length === 0) {
      updates.verificationStatus = 'pending';
      updates.submittedAt = new Date();
    }

    await prisma.driverProfile.update({ where: { userId }, data: updates });

    // Best-effort cleanup of the replaced file.
    if (oldPath && typeof oldPath === 'string') await removeImage(oldPath);

    return { status: remaining.length === 0 ? 'pending' : 'docs_requested' };
  }

  async function updateCarPhoto(
    userId: string,
    file: Express.Multer.File,
  ): Promise<{ carPhotoUrl: string }> {
    const dp = await prisma.driverProfile.findUnique({ where: { userId } });
    if (!dp) throw Errors.notFound('DriverProfile');
    if (dp.verificationStatus !== 'verified') {
      throw Errors.forbidden({ reason: 'not_verified', current_status: dp.verificationStatus });
    }

    const stored = await persistImage(file, 'car_photo');
    const oldPath = dp.carPhotoPath;

    await prisma.driverProfile.update({
      where: { userId },
      data: { carPhotoPath: stored.path },
    });

    if (oldPath) await removeImage(oldPath);

    return { carPhotoUrl: toFileUrl(stored.path) ?? stored.path };
  }

  async function getOwnStats(userId: string): Promise<{
    totalTrips: number;
    rating: number | null;
    ratingCount: number;
    cancellations30d: number;
  }> {
    const [user, dp] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.driverProfile.findUnique({ where: { userId } }),
    ]);
    if (!user || user.deletedAt) throw Errors.notFound('User');
    if (!dp) throw Errors.forbidden({ reason: 'not_a_driver' });
    return {
      totalTrips: dp.totalTrips,
      rating: user.ratingCount >= 3 ? Number(user.rating) : null,
      ratingCount: user.ratingCount,
      cancellations30d: dp.cancellations30d,
    };
  }

  return { submitVerification, getStatus, reuploadDocument, updateCarPhoto, getOwnStats };
}
