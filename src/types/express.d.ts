import type { Locale } from '@/lib/i18n.js';
import type { Role } from '@/lib/jwt.js';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      locale: Locale;
      user?: {
        id: string;
        phone: string;
        roles: Role[];
      };
      admin?: {
        id: string;
        email: string;
        role: 'admin' | 'superadmin';
      };
    }
  }
}

export {};
