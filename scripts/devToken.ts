/**
 * Mint a dev JWT without going through OTP/Telegram.
 *
 *   npm run dev:token                     # default phone +996700111222
 *   npm run dev:token -- +996700444444    # specific phone
 *   npm run dev:token -- +996700555555 driver   # second arg seeds roles
 *
 * Uses the same signing code path as the real auth module, so any token
 * emitted here is indistinguishable in the app from one minted via OTP.
 *
 * Disabled in production — refuses to run if NODE_ENV=production so this
 * file never becomes a shipped backdoor.
 */

process.loadEnvFile?.('.env');

if (process.env.NODE_ENV === 'production') {
  // eslint-disable-next-line no-console
  console.error('devToken is disabled in production. Exiting.');
  process.exit(1);
}

import { PrismaClient } from '@prisma/client';
import {
  refreshTtlSeconds,
  signAccessToken,
  signRefreshToken,
  type Role,
} from '../src/lib/jwt.js';
import { generateUuid, sha256Hex } from '../src/lib/random.js';

const phone = process.argv[2] ?? '+996700111222';
const roleArg = process.argv[3];
const roles: Role[] = roleArg ? (roleArg.split(',') as Role[]) : ['passenger'];

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    let user = await prisma.user.findFirst({ where: { phone, deletedAt: null } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          phone,
          name: 'Dev User',
          roles,
          phoneVerifiedAt: new Date(),
        },
      });
    } else if (roleArg && roles.some((r) => !user!.roles.includes(r))) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { roles: Array.from(new Set([...user.roles, ...roles])) },
      });
    }

    const accessToken = signAccessToken({
      sub: user.id,
      phone: user.phone,
      roles: user.roles as Role[],
      telegram_id: user.telegramId ? user.telegramId.toString() : null,
      provider: 'phone',
    });
    const ttl = refreshTtlSeconds();
    const tokenId = generateUuid();
    const refreshToken = signRefreshToken({ sub: user.id, tokenId }, ttl);
    await prisma.refreshToken.create({
      data: {
        id: tokenId,
        userId: user.id,
        tokenHash: sha256Hex(refreshToken),
        deviceInfo: 'dev-token-cli',
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });

    const out = {
      userId: user.id,
      phone: user.phone,
      roles: user.roles,
      accessToken,
      refreshToken,
      accessTokenExpiresIn: 15 * 60,
      refreshTokenExpiresIn: ttl,
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(out, null, 2));
    // eslint-disable-next-line no-console
    console.log(
      `\nUsage:\n  curl http://localhost:3000/v1/users/me -H 'Authorization: Bearer ${accessToken}'\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
