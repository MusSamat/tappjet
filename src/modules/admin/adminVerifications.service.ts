import type { PrismaClient } from '@prisma/client';
import { Errors, publicPhone } from '@/lib/errors.js';
import { toFileUrl } from '@/lib/uploads.js';
import type { Notifier } from '@/lib/notifier.js';
import { cursorArgs, sliceAndNext, type CursorPaginationInput } from '@/lib/pagination.js';
import { writeAdminAction } from './admin.audit.js';

export interface AdminVerificationsService {
  listQueue(
    filter: CursorPaginationInput & { status?: string },
  ): Promise<{ data: QueueItem[]; nextCursor: string | null }>;
  getDetail(id: string): Promise<VerificationDetail>;
  approve(id: string, adminId: string, ip?: string | null): Promise<VerificationDetail>;
  reject(
    id: string,
    adminId: string,
    reason: string,
    ip?: string | null,
  ): Promise<VerificationDetail>;
  requestDocs(
    id: string,
    adminId: string,
    docs: string[],
    note: string | undefined,
    ip?: string | null,
  ): Promise<VerificationDetail>;
}

export interface QueueItem {
  id: string;
  userId: string;
  userName: string;
  userPhone: string;
  carPlate: string;
  carMake: string;
  carModel: string;
  submittedAt: Date;
  verificationStatus: string;
  slaBreach: boolean; // submitted > 24h ago and still pending
}

export interface VerificationDetail {
  id: string;
  userId: string;
  user: { id: string; name: string; phone: string; language: string };
  car: { make: string; model: string; year: number; color: string; plate: string; seats: number };
  photos: {
    license: string;
    licenseBack: string | null;
    carPassport: string;
    carPassportBack: string | null;
    carPhoto: string;
    selfie: string;
  };
  verificationStatus: string;
  rejectionReason: string | null;
  requestedDocs: string[];
  submittedAt: Date;
  verifiedAt: Date | null;
  verifiedBy: string | null;
}

const SLA_MS = 24 * 60 * 60_000; // TZ §9.2 "Верификация после подачи заявки · 24 часа"

export function createAdminVerificationsService(
  prisma: PrismaClient,
  notifier: Notifier,
): AdminVerificationsService {
  async function listQueue(
    filter: CursorPaginationInput & { status?: string },
  ): Promise<{ data: QueueItem[]; nextCursor: string | null }> {
    const status = filter.status ?? 'pending';
    const rows = await prisma.driverProfile.findMany({
      where: { verificationStatus: status },
      // FIFO — oldest submission first (TZ §17.2).
      orderBy: { submittedAt: 'asc' },
      ...cursorArgs(filter),
      include: {
        user: { select: { id: true, name: true, phone: true } },
      },
    });
    const now = Date.now();
    const mapped: QueueItem[] = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.user.name,
      userPhone: publicPhone(r.user.phone),
      carPlate: r.carPlate,
      carMake: r.carMake,
      carModel: r.carModel,
      submittedAt: r.submittedAt,
      verificationStatus: r.verificationStatus,
      slaBreach:
        r.verificationStatus === 'pending' && now - r.submittedAt.getTime() > SLA_MS,
    }));
    return sliceAndNext(mapped, filter.limit);
  }

  async function getDetail(id: string): Promise<VerificationDetail> {
    const row = await prisma.driverProfile.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, phone: true, language: true } } },
    });
    if (!row) throw Errors.notFound('Verification');
    return toDetail(row);
  }

  async function approve(
    id: string,
    adminId: string,
    ip?: string | null,
  ): Promise<VerificationDetail> {
    const dp = await prisma.driverProfile.findUnique({ where: { id } });
    if (!dp) throw Errors.notFound('Verification');
    if (dp.verificationStatus === 'verified') {
      throw Errors.conflict('Already verified', { current_status: dp.verificationStatus });
    }

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.driverProfile.update({
        where: { id },
        data: {
          verificationStatus: 'verified',
          rejectionReason: null,
          requestedDocs: { set: [] },
          verifiedAt: now,
          verifiedBy: adminId,
        },
        include: { user: { select: { id: true, name: true, phone: true, language: true } } },
      });
      // TZ §9.1 step 10: на verify — driver добавляется в user.roles.
      const user = await tx.user.findUniqueOrThrow({
        where: { id: dp.userId },
        select: { roles: true },
      });
      if (!user.roles.includes('driver')) {
        await tx.user.update({
          where: { id: dp.userId },
          data: { roles: [...user.roles, 'driver'] },
        });
      }
      return updated;
    });

    await writeAdminAction(prisma, {
      adminId,
      action: 'verify_driver',
      targetId: result.userId,
      targetType: 'driver',
      details: { driver_profile_id: id, plate: result.carPlate },
      ipAddress: ip ?? null,
    });

    await notifier.verificationApproved(result.userId, { plate: result.carPlate });

    return toDetail(result);
  }

  async function reject(
    id: string,
    adminId: string,
    reason: string,
    ip?: string | null,
  ): Promise<VerificationDetail> {
    const dp = await prisma.driverProfile.findUnique({ where: { id } });
    if (!dp) throw Errors.notFound('Verification');
    if (dp.verificationStatus === 'rejected') {
      throw Errors.conflict('Already rejected');
    }

    const updated = await prisma.driverProfile.update({
      where: { id },
      data: {
        verificationStatus: 'rejected',
        rejectionReason: reason,
        requestedDocs: { set: [] },
        verifiedAt: null,
        verifiedBy: adminId,
      },
      include: { user: { select: { id: true, name: true, phone: true, language: true } } },
    });

    await writeAdminAction(prisma, {
      adminId,
      action: 'reject_driver',
      targetId: updated.userId,
      targetType: 'driver',
      details: { driver_profile_id: id, reason },
      ipAddress: ip ?? null,
    });

    await notifier.verificationRejected(updated.userId, { reason });

    return toDetail(updated);
  }

  async function requestDocs(
    id: string,
    adminId: string,
    docs: string[],
    note: string | undefined,
    ip?: string | null,
  ): Promise<VerificationDetail> {
    const dp = await prisma.driverProfile.findUnique({ where: { id } });
    if (!dp) throw Errors.notFound('Verification');
    if (dp.verificationStatus !== 'pending') {
      throw Errors.conflict('Can only request docs for pending verifications', {
        current_status: dp.verificationStatus,
      });
    }

    const updated = await prisma.driverProfile.update({
      where: { id },
      data: {
        verificationStatus: 'docs_requested',
        requestedDocs: { set: docs },
        rejectionReason: note ?? null, // reuse field as the human note for what/why
      },
      include: { user: { select: { id: true, name: true, phone: true, language: true } } },
    });

    await writeAdminAction(prisma, {
      adminId,
      action: 'request_driver_docs',
      targetId: updated.userId,
      targetType: 'driver',
      details: { driver_profile_id: id, docs, note },
      ipAddress: ip ?? null,
    });

    await notifier.verificationNeedDocs(updated.userId, { docs, note });

    return toDetail(updated);
  }

  return { listQueue, getDetail, approve, reject, requestDocs };
}

function toDetail(
  row: {
    id: string;
    userId: string;
    user: { id: string; name: string; phone: string; language: string };
    carMake: string;
    carModel: string;
    carYear: number;
    carColor: string;
    carPlate: string;
    seatsCount: number;
    licensePhotoPath: string;
    licenseBackPath: string | null;
    carPassportPath: string;
    carPassportBackPath: string | null;
    carPhotoPath: string;
    selfiePath: string;
    verificationStatus: string;
    rejectionReason: string | null;
    requestedDocs: string[];
    submittedAt: Date;
    verifiedAt: Date | null;
    verifiedBy: string | null;
  },
): VerificationDetail {
  return {
    id: row.id,
    userId: row.userId,
    user: {
      id: row.user.id,
      name: row.user.name,
      phone: publicPhone(row.user.phone),
      language: row.user.language,
    },
    car: {
      make: row.carMake,
      model: row.carModel,
      year: row.carYear,
      color: row.carColor,
      plate: row.carPlate,
      seats: row.seatsCount,
    },
    // Raw storage paths are meaningless to the browser — map to URLs.
    photos: {
      license: toFileUrl(row.licensePhotoPath) ?? row.licensePhotoPath,
      licenseBack: toFileUrl(row.licenseBackPath),
      carPassport: toFileUrl(row.carPassportPath) ?? row.carPassportPath,
      carPassportBack: toFileUrl(row.carPassportBackPath),
      carPhoto: toFileUrl(row.carPhotoPath) ?? row.carPhotoPath,
      selfie: toFileUrl(row.selfiePath) ?? row.selfiePath,
    },
    verificationStatus: row.verificationStatus,
    rejectionReason: row.rejectionReason,
    requestedDocs: row.requestedDocs,
    submittedAt: row.submittedAt,
    verifiedAt: row.verifiedAt,
    verifiedBy: row.verifiedBy,
  };
}
