import type { PrismaClient } from '@prisma/client';
import { Errors } from '@/lib/errors.js';
import { cursorArgs, sliceAndNext } from '@/lib/pagination.js';
import { persistImage, removeImage } from '@/lib/uploads.js';
import type { Notifier } from '@/lib/notifier.js';
import type { ComplaintCreateInput } from './complaints.schemas.js';
import { logger } from '@/lib/logger.js';

// TZ §16.3 priority matrix — exposed so the admin UI can show it too.
export const PRIORITY: Record<string, 'P0' | 'P1' | 'P2' | 'P3'> = {
  safety: 'P0',
  fraud: 'P1',
  no_show: 'P2',
  rudeness: 'P2',
  other: 'P3',
};

const MAX_ATTACHMENTS = 5; // TZ §16.2 step 4

export interface ComplaintsService {
  create(
    reporterId: string,
    body: ComplaintCreateInput,
    files: Express.Multer.File[],
  ): Promise<{ id: string; status: string; priority: string }>;
  listMine(
    reporterId: string,
    query: { cursor?: string; limit: number },
  ): Promise<{ data: Array<ComplaintListItem>; nextCursor: string | null }>;
}

export interface ComplaintListItem {
  id: string;
  category: string;
  priority: string;
  status: string;
  description: string;
  attachments: string[];
  targetUserId: string | null;
  targetTripId: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  resolution: string | null;
}

export function createComplaintsService(
  prisma: PrismaClient,
  notifier: Notifier,
): ComplaintsService {
  async function create(
    reporterId: string,
    body: ComplaintCreateInput,
    files: Express.Multer.File[],
  ): Promise<{ id: string; status: string; priority: string }> {
    if (files.length > MAX_ATTACHMENTS) {
      throw Errors.validation({ reason: 'too_many_attachments', max: MAX_ATTACHMENTS });
    }
    if (body.targetUserId && body.targetUserId === reporterId) {
      throw Errors.validation({ reason: 'cannot_report_self' });
    }
    if (body.targetUserId) {
      const u = await prisma.user.findUnique({ where: { id: body.targetUserId } });
      if (!u || u.deletedAt) throw Errors.notFound('Target user');
    }
    if (body.targetTripId) {
      const t = await prisma.trip.findUnique({ where: { id: body.targetTripId } });
      if (!t) throw Errors.notFound('Target trip');
    }

    // Persist attachments first — we only write complaint row once we're sure
    // every file is valid.
    const stored: string[] = [];
    try {
      for (const f of files) {
        const s = await persistImage(f, 'complaint_attachments');
        stored.push(s.path);
      }
    } catch (err) {
      for (const p of stored) await removeImage(p);
      throw err;
    }

    const created = await prisma.complaint.create({
      data: {
        reporterId,
        targetUserId: body.targetUserId ?? null,
        targetTripId: body.targetTripId ?? null,
        category: body.category,
        description: body.description,
        attachments: stored,
        status: 'new',
      },
    });

    const priority = PRIORITY[body.category] ?? 'P3';
    logger.info(
      { complaint_id: created.id, priority, category: body.category, reporterId },
      'complaint filed',
    );

    // Broadcast to admins (Socket.IO rooms + in-app feed per notifier impl).
    await notifier.broadcastToAdmins('new_complaint', {
      complaint_id: created.id,
      category: body.category,
      priority,
      target_user_id: body.targetUserId ?? null,
      target_trip_id: body.targetTripId ?? null,
    });

    return { id: created.id, status: created.status, priority };
  }

  async function listMine(
    reporterId: string,
    query: { cursor?: string; limit: number },
  ): Promise<{ data: ComplaintListItem[]; nextCursor: string | null }> {
    const rows = await prisma.complaint.findMany({
      where: { reporterId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs({ cursor: query.cursor, limit: query.limit }),
    });
    return sliceAndNext(
      rows.map((r) => ({
        id: r.id,
        category: r.category,
        priority: PRIORITY[r.category] ?? 'P3',
        status: r.status,
        description: r.description,
        attachments: r.attachments,
        targetUserId: r.targetUserId,
        targetTripId: r.targetTripId,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
        resolution: r.resolution,
      })),
      query.limit,
    );
  }

  return { create, listMine };
}
