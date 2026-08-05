import type { PrismaClient } from '@prisma/client';
import { Errors } from '@/lib/errors.js';
import type { CarCreateInput } from './cars.schemas.js';

/**
 * User cars (Phase 1: publish without verification). Any authed user keeps a
 * garage; a trip references the car it rides on. Soft delete — trips keep
 * their car snapshot via the FK.
 */

export interface CarDTO {
  id: string;
  make: string;
  model: string;
  color: string | null;
  year: number | null;
  plate: string;
  seatsCount: number;
  createdAt: Date;
}

const carSelect = {
  id: true,
  make: true,
  model: true,
  color: true,
  year: true,
  plate: true,
  seatsCount: true,
  createdAt: true,
} as const;

export function createCarsService(prisma: PrismaClient) {
  async function listMy(userId: string): Promise<CarDTO[]> {
    return prisma.car.findMany({
      where: { userId, deletedAt: null },
      select: carSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async function create(userId: string, input: CarCreateInput): Promise<CarDTO> {
    const count = await prisma.car.count({ where: { userId, deletedAt: null } });
    if (count >= 5) throw Errors.conflict('Too many cars', { reason: 'max_cars', max: 5 });
    const dup = await prisma.car.findFirst({
      where: { userId, plate: input.plate, deletedAt: null },
    });
    if (dup) throw Errors.conflict('Car already exists', { reason: 'duplicate_plate' });
    return prisma.car.create({
      data: {
        userId,
        make: input.make,
        model: input.model,
        color: input.color ?? null,
        year: input.year ?? null,
        plate: input.plate,
        seatsCount: input.seatsCount,
      },
      select: carSelect,
    });
  }

  async function remove(userId: string, carId: string): Promise<void> {
    const car = await prisma.car.findUnique({ where: { id: carId } });
    if (!car || car.deletedAt) throw Errors.notFound('Car');
    if (car.userId !== userId) throw Errors.forbidden({ reason: 'not_owner' });
    const activeTrips = await prisma.trip.count({
      where: { carId, status: 'active', departureAt: { gt: new Date() } },
    });
    if (activeTrips > 0) {
      throw Errors.conflict('Car is used by active trips', { reason: 'car_in_use', activeTrips });
    }
    await prisma.car.update({ where: { id: carId }, data: { deletedAt: new Date() } });
  }

  return { listMy, create, remove };
}
