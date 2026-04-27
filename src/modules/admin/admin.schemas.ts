import { z } from 'zod';
import { CursorPaginationQuery } from '@/lib/pagination.js';

// ─── Shared ──────────────────────────────────────────────────────────────
export const IdParam = z.object({ id: z.string().uuid() });

// ─── Verifications ───────────────────────────────────────────────────────
export const VerificationsQuery = CursorPaginationQuery.extend({
  status: z
    .enum(['pending', 'verified', 'rejected', 'docs_requested', 'suspended', 'blocked'])
    .optional(),
});

export const RejectBody = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const RequestDocsBody = z.object({
  docs: z
    .array(z.enum(['license', 'car_passport', 'car_photo', 'selfie']))
    .min(1, 'at least one document must be requested')
    .max(4),
  note: z.string().trim().max(500).optional(),
});

// ─── Users ───────────────────────────────────────────────────────────────
export const UsersQuery = CursorPaginationQuery.extend({
  q: z.string().trim().min(1).max(100).optional(),
  role: z.enum(['passenger', 'driver']).optional(),
  blocked: z.enum(['true', 'false']).optional(),
  sort: z.enum(['created_desc', 'created_asc', 'rating_desc', 'rating_asc']).default('created_desc'),
});

export const BlockBody = z.object({
  reason: z.string().trim().min(3).max(500),
});

// ─── Cities ──────────────────────────────────────────────────────────────
export const CityCreateBody = z.object({
  nameRu: z.string().trim().min(1).max(100),
  nameKg: z.string().trim().min(1).max(100),
  region: z.string().trim().max(50).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  isActive: z.boolean().optional(),
});

export const CityUpdateBody = CityCreateBody.partial();

export const CityIdParam = z.object({ id: z.coerce.number().int().positive() });

// ─── Admins ──────────────────────────────────────────────────────────────
export const AdminCreateBody = z.object({
  email: z.string().email().max(200),
  name: z.string().trim().min(2).max(100),
  password: z.string().min(12).max(200),
  role: z.enum(['admin', 'superadmin']).default('admin'),
});

// ─── Audit log ───────────────────────────────────────────────────────────
export const AuditLogQuery = CursorPaginationQuery.extend({
  adminId: z.string().uuid().optional(),
  action: z.string().min(1).max(50).optional(),
});

// ─── Complaints ──────────────────────────────────────────────────────────
export const ComplaintsAdminQuery = CursorPaginationQuery.extend({
  status: z.enum(['new', 'in_review', 'resolved', 'dismissed']).optional(),
  category: z.enum(['safety', 'fraud', 'rudeness', 'no_show', 'other']).optional(),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
});

export const ComplaintResolveBody = z.object({
  status: z.enum(['resolved', 'dismissed']),
  resolution: z.string().trim().min(3).max(2000),
});

// ─── Trips ───────────────────────────────────────────────────────────────
export const TripsAdminQuery = CursorPaginationQuery.extend({
  status: z.enum(['active', 'completed', 'cancelled', 'all']).default('active'),
  from: z.string().trim().max(50).optional(),
  to: z.string().trim().max(50).optional(),
});

export const TripIdParam = z.object({ id: z.string().uuid() });
export type TripsAdminQueryInput = z.infer<typeof TripsAdminQuery>;

// ─── Force cancel trip ──────────────────────────────────────────────────
export const ForceCancelBody = z.object({
  reason: z.string().trim().min(3).max(500),
});

// ─── Analytics ───────────────────────────────────────────────────────────
export const ChartNameParam = z.object({
  name: z.enum([
    'registrations_by_day',
    'trips_by_day',
    'top_routes',
    'activity_heatmap',
    'rating_by_day',
    'onboarding_funnel',
  ]),
});
