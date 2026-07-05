import type { Prisma, PrismaClient } from '@prisma/client';
import { Errors } from '@/lib/errors.js';
import { toFileUrl } from '@/lib/uploads.js';
import { cursorArgs, sliceAndNext, type CursorPaginationInput } from '@/lib/pagination.js';
import { writeAdminAction } from './admin.audit.js';
import { PRIORITY } from '@/modules/complaints/complaints.service.js';

export interface AdminComplaintsService {
  list(
    filter: CursorPaginationInput & { status?: string; category?: string; priority?: string },
  ): Promise<{ data: AdminComplaintItem[]; nextCursor: string | null }>;
  get(id: string): Promise<AdminComplaintDetail>;
  resolve(
    id: string,
    adminId: string,
    input: { status: 'resolved' | 'dismissed'; resolution: string },
    ip?: string | null,
  ): Promise<AdminComplaintDetail>;
}

export interface AdminComplaintItem {
  id: string;
  category: string;
  priority: string;
  status: string;
  reporterId: string;
  reporterName: string;
  targetUserId: string | null;
  targetTripId: string | null;
  description: string;
  attachments: string[];
  createdAt: Date;
  resolvedAt: Date | null;
  resolution: string | null;
  handledBy: string | null;
  slaBreach: boolean; // per-priority SLA threshold from TZ §16.3
}

export type AdminComplaintDetail = AdminComplaintItem;

const SLA_HOURS: Record<string, number> = { P0: 1, P1: 6, P2: 24, P3: 72 };

export function createAdminComplaintsService(prisma: PrismaClient): AdminComplaintsService {
  function toItem(
    r: {
      id: string;
      category: string;
      status: string;
      description: string;
      attachments: string[];
      targetUserId: string | null;
      targetTripId: string | null;
      reporterId: string;
      createdAt: Date;
      resolvedAt: Date | null;
      resolution: string | null;
      handledBy: string | null;
      reporter: { name: string; deletedAt: Date | null };
    },
  ): AdminComplaintItem {
    const priority = PRIORITY[r.category] ?? 'P3';
    const slaHours = SLA_HOURS[priority] ?? 72;
    const openNow = r.status === 'new' || r.status === 'in_review';
    const ageHours = (Date.now() - r.createdAt.getTime()) / 3_600_000;
    return {
      id: r.id,
      category: r.category,
      priority,
      status: r.status,
      reporterId: r.reporterId,
      reporterName: r.reporter.deletedAt ? 'Удалённый пользователь' : r.reporter.name,
      targetUserId: r.targetUserId,
      targetTripId: r.targetTripId,
      description: r.description,
      // Storage paths → absolute URLs (bare paths 404 in the browser).
      attachments: r.attachments.map((a) => toFileUrl(a) ?? a),
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      resolution: r.resolution,
      handledBy: r.handledBy,
      slaBreach: openNow && ageHours > slaHours,
    };
  }

  async function list(
    filter: CursorPaginationInput & { status?: string; category?: string; priority?: string },
  ): Promise<{ data: AdminComplaintItem[]; nextCursor: string | null }> {
    const where: Prisma.ComplaintWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.category) where.category = filter.category;
    if (filter.priority) {
      // Map priority back to categories, since priority isn't stored.
      const allowedCats = Object.entries(PRIORITY)
        .filter(([, p]) => p === filter.priority)
        .map(([c]) => c);
      where.category = { in: allowedCats };
    }
    const rows = await prisma.complaint.findMany({
      where,
      orderBy: [
        // P0 first — order by "synthetic" priority via category sort and then
        // createdAt. Prisma doesn't support computed-column sort natively, so
        // we use a simple heuristic: safety → fraud → rudeness/no_show → other.
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      ...cursorArgs(filter),
      include: {
        reporter: { select: { name: true, deletedAt: true } },
      },
    });
    const mapped = rows.map(toItem);
    // Secondary in-memory sort: SLA-breached and P0 to the top.
    const prioRank = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;
    mapped.sort((a, b) => {
      if (a.slaBreach !== b.slaBreach) return a.slaBreach ? -1 : 1;
      const pa = prioRank[a.priority as keyof typeof prioRank] ?? 3;
      const pb = prioRank[b.priority as keyof typeof prioRank] ?? 3;
      if (pa !== pb) return pa - pb;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    return sliceAndNext(mapped, filter.limit);
  }

  async function get(id: string): Promise<AdminComplaintDetail> {
    const r = await prisma.complaint.findUnique({
      where: { id },
      include: { reporter: { select: { name: true, deletedAt: true } } },
    });
    if (!r) throw Errors.notFound('Complaint');
    return toItem(r);
  }

  async function resolve(
    id: string,
    adminId: string,
    input: { status: 'resolved' | 'dismissed'; resolution: string },
    ip?: string | null,
  ): Promise<AdminComplaintDetail> {
    const r = await prisma.complaint.findUnique({ where: { id } });
    if (!r) throw Errors.notFound('Complaint');
    if (r.status === 'resolved' || r.status === 'dismissed') {
      throw Errors.conflict('Already closed', { current_status: r.status });
    }

    await prisma.complaint.update({
      where: { id },
      data: {
        status: input.status,
        resolution: input.resolution,
        handledBy: adminId,
        resolvedAt: new Date(),
      },
    });

    await writeAdminAction(prisma, {
      adminId,
      action: input.status === 'resolved' ? 'resolve_complaint' : 'dismiss_complaint',
      targetId: id,
      targetType: 'complaint',
      details: { resolution: input.resolution },
      ipAddress: ip ?? null,
    });

    return get(id);
  }

  return { list, get, resolve };
}
