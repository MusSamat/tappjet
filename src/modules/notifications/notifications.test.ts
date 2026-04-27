import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { testPrisma } from '../../../tests/setup.js';
import { createApp } from '@/server.js';
import { createUser } from '../../../tests/factories.js';

let app: Express;

beforeEach(() => {
  app = createApp(testPrisma);
});

async function seedNotifications(userId: string, n: number): Promise<void> {
  await testPrisma.notification.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      userId,
      type: 'booking_accepted',
      channel: 'telegram' as const,
      payload: { i },
    })),
  });
}

describe('GET /v1/notifications', () => {
  it('returns caller\'s notifications newest-first with unread count', async () => {
    const u = await createUser(testPrisma);
    await seedNotifications(u.id, 3);

    const res = await request(app)
      .get('/v1/notifications')
      .set('Authorization', `Bearer ${u.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.unreadCount).toBe(3);
  });

  it('filters ?unread=true', async () => {
    const u = await createUser(testPrisma);
    await seedNotifications(u.id, 2);
    const all = await testPrisma.notification.findMany();
    await testPrisma.notification.update({
      where: { id: all[0]!.id },
      data: { readAt: new Date() },
    });

    const res = await request(app)
      .get('/v1/notifications?unread=true')
      .set('Authorization', `Bearer ${u.accessToken}`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.unreadCount).toBe(1);
  });

  it('does not leak other users\' notifications', async () => {
    const u1 = await createUser(testPrisma);
    const u2 = await createUser(testPrisma);
    await seedNotifications(u1.id, 2);
    await seedNotifications(u2.id, 5);
    const res = await request(app)
      .get('/v1/notifications')
      .set('Authorization', `Bearer ${u1.accessToken}`);
    expect(res.body.data).toHaveLength(2);
  });
});

describe('PATCH /v1/notifications/:id/read', () => {
  it('marks a notification read and decrements unreadCount', async () => {
    const u = await createUser(testPrisma);
    await seedNotifications(u.id, 2);
    const first = (await testPrisma.notification.findMany())[0]!;

    const res = await request(app)
      .patch(`/v1/notifications/${first.id}/read`)
      .set('Authorization', `Bearer ${u.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.readAt).not.toBeNull();

    const feed = await request(app)
      .get('/v1/notifications')
      .set('Authorization', `Bearer ${u.accessToken}`);
    expect(feed.body.unreadCount).toBe(1);
  });

  it('404 when trying to mark someone else\'s notification', async () => {
    const u1 = await createUser(testPrisma);
    const u2 = await createUser(testPrisma);
    await seedNotifications(u1.id, 1);
    const other = (await testPrisma.notification.findMany())[0]!;
    const res = await request(app)
      .patch(`/v1/notifications/${other.id}/read`)
      .set('Authorization', `Bearer ${u2.accessToken}`);
    expect(res.status).toBe(404);
  });
});
