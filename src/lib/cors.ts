import { env, isProd } from '@/config/env.js';

/**
 * Single source of truth for allowed browser origins, shared by REST (server.ts)
 * and Socket.IO (socketServer.ts). The Mini App origin comes from MINI_APP_URL
 * so a tunnel/domain change is a one-line .env edit — no code change.
 */

// Origins never carry a trailing slash; normalize so MINI_APP_URL matches.
const miniApp = env.MINI_APP_URL?.replace(/\/$/, '');

export const allowedOrigins: string[] = isProd
  ? [
      ...(env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      ...(miniApp ? [miniApp] : []),
    ]
  : [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      ...(miniApp ? [miniApp] : []),
    ];

// Any localhost/127.0.0.1 port — covers Flutter web (`flutter run -d chrome`).
const localhostRe = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** Whether a request Origin is permitted. No Origin = same-origin / server-to-server. */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (isProd) return allowedOrigins.includes(origin);
  return localhostRe.test(origin) || allowedOrigins.includes(origin);
}
