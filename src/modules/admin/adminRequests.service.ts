import type { Prisma, PrismaClient } from '@prisma/client';
import { Errors, publicPhone } from '@/lib/errors.js';
import { cursorArgs, sliceAndNext, type CursorPaginationInput } from '@/lib/pagination.js';
import { writeAdminAction } from './admin.audit.js';

/**
 * Admin view of passenger requests — parity with the Trips admin: browse +
 * detail + force-cancel with a message that reaches the passenger. A request
 * has no price (drivers offer it), so the admin sees the offers instead.
 */
export interface AdminRequestItem {
  id: string;
  originCity: string;
  destinationCity: string;
  departureDate: Date;
  seatsNeeded: number;
  status: string;
  offersCount: number;
  passenger: { id: string; name: string; phone: string };
  createdAt: Date;
}

export interface AdminRequestDetail extends AdminRequestItem {
  comment: string | null;
  flexible: boolean;
  offers: Array<{
    id: string;
    driverId: string;
    driverName: string;
    price: number;
    departureTime: Date;
    status: string;
    createdAt: Date;
  }>;
}

export function createAdminRequestsService(prisma: PrismaClient) {
  async function listRequests(
    filter: CursorPaginationInput & { status?: string; q?: string },
  ): Promise<{ data: AdminRequestItem[]; nextCursor: string | null }> {
    const where: Prisma.PassengerRequestWhereInput = {};
    if (filter.status && filter.status !== 'all') where.status = filter.status;
    if (filter.q) {
      where.OR = [
        { originCity: { contains: filter.q, mode: 'insensitive' } },
        { destinationCity: { contains: filter.q, mode: 'insensitive' } },
        { passenger: { name: { contains: filter.q, mode: 'insensitive' } } },
      ];
    }

    const rows = await prisma.passengerRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...cursorArgs(filter),
      include: {
        passenger: { select: { id: true, name: true, phone: true } },
        _count: { select: { responses: true } },
      },
    });

    const mapped: AdminRequestItem[] = rows.map((r) => ({
      id: r.id,
      originCity: r.originCity,
      destinationCity: r.destinationCity,
      departureDate: r.departureDate,
      seatsNeeded: r.seatsNeeded,
      status: r.status,
      offersCount: r._count.responses,
      passenger: { id: r.passenger.id, name: r.passenger.name, phone: publicPhone(r.passenger.phone) },
      createdAt: r.createdAt,
    }));

    return sliceAndNext(mapped, filter.limit);
  }

  async function getRequestDetail(id: string): Promise<AdminRequestDetail> {
    const r = await prisma.passengerRequest.findUnique({
      where: { id },
      include: {
        passenger: { select: { id: true, name: true, phone: true } },
        responses: {
          include: { driver: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!r) throw Errors.notFound('PassengerRequest');

    return {
      id: r.id,
      originCity: r.originCity,
      destinationCity: r.destinationCity,
      departureDate: r.departureDate,
      seatsNeeded: r.seatsNeeded,
      status: r.status,
      comment: r.comment,
      flexible: r.flexible,
      offersCount: r.responses.length,
      passenger: { id: r.passenger.id, name: r.passenger.name, phone: publicPhone(r.passenger.phone) },
      offers: r.responses.map((o) => ({
        id: o.id,
        driverId: o.driverId,
        driverName: o.driver.name,
        price: o.price,
        departureTime: o.departureTime,
        status: o.status,
        createdAt: o.createdAt,
      })),
      createdAt: r.createdAt,
    };
  }

  async function forceCancel(
    id: string,
    adminId: string,
    reason: string,
    ip?: string | null,
  ): Promise<{ status: 'cancelled' }> {
    const req = await prisma.passengerRequest.findUnique({ where: { id } });
    if (!req) throw Errors.notFound('PassengerRequest');
    if (req.status !== 'open') throw Errors.conflict('Request is not open', { current_status: req.status });

    await prisma.$transaction(async (tx) => {
      await tx.passengerRequest.update({ where: { id }, data: { status: 'cancelled' } });
      // Deliver the admin's message to the passenger via the notifications feed.
      await tx.notification.create({
        data: {
          userId: req.passengerId,
          type: 'request_cancelled_admin',
          channel: 'telegram',
          payload: {
            requestId: id,
            originCity: req.originCity,
            destinationCity: req.destinationCity,
            reason,
            body: reason,
          },
        },
      });
    });

    await writeAdminAction(prisma, {
      adminId,
      action: 'force_cancel_request',
      targetId: id,
      targetType: 'passenger_request',
      details: { reason },
      ipAddress: ip ?? null,
    });

    return { status: 'cancelled' };
  }

  return { listRequests, getRequestDetail, forceCancel };
}
