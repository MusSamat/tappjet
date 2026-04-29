import type { PrismaClient } from '@prisma/client';
import { Bot, type Context } from 'grammy';
import { env } from '@/config/env.js';
import { logger } from '@/lib/logger.js';
import { handleTelegramLinkToken } from '@/modules/auth/auth.otp.js';
import type {
  Notifier,
  PublicBooking,
} from '@/lib/notifier.js';

/**
 * Telegram Bot — TZ §25. Uses `grammy` (fetch-based; no deprecated `request`
 * transitive deps that plague `node-telegram-bot-api`). The TZ listed the
 * latter; we picked grammy because the former pulls in critical-severity CVEs
 * in its tar/request/form-data dependency chain.
 *
 * Modes:
 *   • No token → bot stays stopped; all notifier calls become no-ops.
 *   • Token set → long-poll in-process (MVP). Stage 2 switches to webhook +
 *     own worker process; the public surface stays the same.
 *
 * Language: every outgoing notification reads users.language (ru | kg) and
 * selects the matching template. Commands: /start, /help, /mytrips, /support,
 * /lang, /unsubscribe, /subscribe.
 */

export type BotInstance = Bot;

export interface TelegramNotifierDeps {
  prisma: PrismaClient;
  bot: Bot | null;
}

interface MessageTemplate {
  ru: string;
  kg: string;
}

const T = {
  new_booking_request: {
    ru: '📬 <b>Новый запрос на поездку</b>\nОт: <b>{passengerName}</b>{ratingSuffix}\nПоездка: {from} → {to}\nДата: {date}\nМест: {seats}',
    kg: '📬 <b>Сапарга жаңы арыз</b>\nКимден: <b>{passengerName}</b>{ratingSuffix}\nСапар: {from} → {to}\nДата: {date}\nОрундар: {seats}',
  },
  booking_accepted: {
    ru: '✅ <b>{driverName}</b> принял ваш запрос! Чат открыт.',
    kg: '✅ <b>{driverName}</b> арызыңызды кабыл алды! Чат ачылды.',
  },
  booking_rejected: {
    ru: '❌ Водитель отклонил ваш запрос.',
    kg: '❌ Айдоочу арызыңызды четке какты.',
  },
  booking_expired: {
    ru: '⏰ Водитель не ответил. Попробуйте другую поездку.',
    kg: '⏰ Айдоочу жооп бербеди. Башка сапарды сынап көрүңүз.',
  },
  booking_cancelled_by_passenger: {
    ru: '🚫 {name} отменил бронирование.',
    kg: '🚫 {name} брондоону жокко чыгарды.',
  },
  booking_cancelled_by_driver: {
    ru: '🚫 Водитель отменил ваше бронирование.',
    kg: '🚫 Айдоочу брондооңузду жокко чыгарды.',
  },
  trip_cancelled: {
    ru: '🚫 Поездка {from} → {to} на {date} отменена.',
    kg: '🚫 {from} → {to} сапары {date} күнү жокко чыгарылды.',
  },
  chat_message: {
    ru: '💬 <b>{senderName}</b>: {preview}',
    kg: '💬 <b>{senderName}</b>: {preview}',
  },
  rating_received: {
    ru: '⭐ <b>{raterName}</b> поставил(-а) вам оценку {score}.',
    kg: '⭐ <b>{raterName}</b> сизге {score} баа койду.',
  },
  rating_warning: {
    ru: '⚠ Ваш рейтинг снизился до <b>{rating}</b>. Улучшите его.',
    kg: '⚠ Рейтингиңиз <b>{rating}</b> чейин түштү. Жакшыртыңыз.',
  },
  verification_approved: {
    ru: '🎉 Поздравляем! Вы верифицированы как водитель.',
    kg: '🎉 Куттуктайбыз! Сиз айдоочу катары ырасталдыңыз.',
  },
  verification_rejected: {
    ru: '❌ Верификация отклонена. Причина: {reason}',
    kg: '❌ Ырастоо четке кагылды. Себеби: {reason}',
  },
  verification_need_docs: {
    ru: '📎 Нужны дополнительные документы: {docs}',
    kg: '📎 Кошумча документтер керек: {docs}',
  },
  account_blocked: {
    ru: '🚫 Ваш аккаунт заблокирован. Причина: {reason}',
    kg: '🚫 Аккаунтуңуз бөгөттөлдү. Себеби: {reason}',
  },
  loyalty_tier_changed: {
    ru: '🏆 Ваш уровень лояльности повышен до <b>{tier}</b>!',
    kg: '🏆 Лоялтуулук деңгээлиңиз <b>{tier}</b> болуп жогорулады!',
  },
} as const;

type Vars = Record<string, string | number>;

function render(tpl: MessageTemplate, lang: 'ru' | 'kg', vars: Vars): string {
  const raw = tpl[lang] ?? tpl.ru;
  return raw.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''));
}

function formatDepartureDate(d: Date, lang: 'ru' | 'kg'): string {
  try {
    return new Intl.DateTimeFormat(lang === 'kg' ? 'ky-KG' : 'ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Bishkek',
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

export function createTelegramNotifier(deps: TelegramNotifierDeps): Notifier {
  const { prisma, bot } = deps;

  async function send(userId: string, tpl: MessageTemplate, vars: Vars): Promise<void> {
    if (!bot) return;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramId: true, language: true, notificationsEnabled: true },
    });
    if (!user || !user.telegramId || !user.notificationsEnabled) return;
    const lang: 'ru' | 'kg' = user.language === 'kg' ? 'kg' : 'ru';
    const text = render(tpl, lang, vars);
    try {
      await bot.api.sendMessage(Number(user.telegramId), text, { parse_mode: 'HTML' });
    } catch (err) {
      logger.warn({ err, userId }, 'telegram send failed');
    }
  }

  return {
    async bookingNewRequest(driverUserId, { booking, trip, passengerName, passengerRating }) {
      const ratingSuffix = passengerRating !== null
        ? ` (★ ${passengerRating.toFixed(1)})`
        : '';
      await send(driverUserId, T.new_booking_request, {
        passengerName,
        ratingSuffix,
        from: trip.originCity,
        to: trip.destinationCity,
        date: formatDepartureDate(trip.departureAt, 'ru'),
        seats: booking.seatsCount,
      });
    },
    async bookingAccepted(passengerUserId, { booking }) {
      const driverName = await driverNameForBooking(prisma, booking);
      await send(passengerUserId, T.booking_accepted, { driverName });
    },
    async bookingRequestConfirmed() {
      // Telegram delivery for driver confirmation is not needed — in-app bell only.
    },
    async bookingRejected(passengerUserId) {
      await send(passengerUserId, T.booking_rejected, {});
    },
    async bookingExpired(passengerUserId) {
      await send(passengerUserId, T.booking_expired, {});
    },
    async bookingCancelled(toUserId, payload) {
      if (payload.cancelledBy === 'passenger') {
        const passenger = await prisma.user.findUnique({
          where: { id: payload.booking.passengerId },
          select: { name: true },
        });
        await send(toUserId, T.booking_cancelled_by_passenger, {
          name: passenger?.name ?? '—',
        });
      } else {
        await send(toUserId, T.booking_cancelled_by_driver, {});
      }
    },
    async tripCancelled(passengerUserId, { trip }) {
      await send(passengerUserId, T.trip_cancelled, {
        from: trip.originCity,
        to: trip.destinationCity,
        date: formatDepartureDate(trip.departureAt, 'ru'),
      });
    },
    async newMessage(recipientUserId, { message }) {
      const sender = await prisma.user.findUnique({
        where: { id: message.senderId },
        select: { name: true },
      });
      const preview = message.text.length > 80 ? `${message.text.slice(0, 80)}…` : message.text;
      await send(recipientUserId, T.chat_message, {
        senderName: sender?.name ?? '—',
        preview,
      });
    },
    async messageRead() {
      // Too noisy for Telegram — kept in app only.
    },
    async ratingReceived(rateeUserId, payload) {
      await send(rateeUserId, T.rating_received, {
        raterName: payload.raterName,
        score: payload.score,
      });
    },
    async ratingWarning(userId, payload) {
      await send(userId, T.rating_warning, { rating: payload.rating });
    },
    async verificationApproved(userId) {
      await send(userId, T.verification_approved, {});
    },
    async verificationRejected(userId, payload) {
      await send(userId, T.verification_rejected, { reason: payload.reason });
    },
    async verificationNeedDocs(userId, payload) {
      await send(userId, T.verification_need_docs, { docs: payload.docs.join(', ') });
    },
    async accountBlocked(userId, payload) {
      await send(userId, T.account_blocked, { reason: payload.reason });
    },
    async securityAlertReuse(userId) {
      // TZ v2.1 §7.5: deliver to the user's Telegram channel (their primary
      // trusted contact) with a fixed message — no template vars so it lands
      // fast even if we don't know the IP/timezone context.
      await send(
        userId,
        {
          ru: '🚨 Обнаружена подозрительная активность. Все ваши сессии завершены — войдите снова. Если это не вы — смените пароль и свяжитесь с поддержкой.',
          kg: '🚨 Шектүү аракет табылды. Бардык сессияларыңыз жабылды — кайра кириңиз. Эгер бул сиз эмес болсоңуз — паролду алмаштырып, колдоого кайрылыңыз.',
        },
        {},
      );
    },
    async broadcastToAdmins() {
      // Admin alerts flow via Admin Panel (Socket.IO) + email (Stage 2) —
      // not the user-facing Telegram bot.
    },
    async bookingViewed() {
      // Read-receipt — in-app only, no Telegram noise.
    },
    async chatLimitWarning() {
      // In-app warning only.
    },
    async chatPhaseChanged() {
      // Phase upgrade — in-app only.
    },
    async loyaltyTierChanged(userId, payload) {
      await send(userId, T.loyalty_tier_changed, { tier: payload.tier });
    },
    async requestResponseReceived(passengerId, payload) {
      await send(passengerId, { ru: 'Водитель {name} предлагает поездку за {price} сом', kg: 'Айдоочу {name} жол {price} сом сунуштады' }, { name: payload.driverName, price: payload.price });
    },
    async requestResponseAccepted(driverId) {
      await send(driverId, { ru: 'Пассажир принял ваше предложение! Откройте чат.', kg: 'Жүргүнчү сиздин сунушту кабыл алды! Чатты ачыңыз.' }, {});
    },
    async requestResponseDeclined(driverId) {
      await send(driverId, { ru: 'Пассажир отклонил ваше предложение.', kg: 'Жүргүнчү сиздин сунушту четке какты.' }, {});
    },
    async tripCompletedRate() {
      // In-app rating prompt only — no Telegram noise.
    },
  };
}

async function driverNameForBooking(
  prisma: PrismaClient,
  booking: PublicBooking,
): Promise<string> {
  const trip = await prisma.trip.findUnique({
    where: { id: booking.tripId },
    include: { driver: { select: { name: true } } },
  });
  return trip?.driver.name ?? '—';
}

// ─── Composite notifier ─────────────────────────────────────────────
export function composeNotifiers(...notifiers: Notifier[]): Notifier {
  const call =
    <K extends keyof Notifier>(method: K) =>
    async (...args: Parameters<Notifier[K]>): Promise<void> => {
      await Promise.all(
        notifiers.map(async (n) => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (n[method] as (...a: any[]) => Promise<void>)(...args);
          } catch (err) {
            logger.error({ err, method }, 'notifier channel failed');
          }
        }),
      );
    };

  return {
    bookingNewRequest: call('bookingNewRequest'),
    bookingAccepted: call('bookingAccepted'),
    bookingRequestConfirmed: call('bookingRequestConfirmed'),
    bookingRejected: call('bookingRejected'),
    bookingExpired: call('bookingExpired'),
    bookingCancelled: call('bookingCancelled'),
    tripCancelled: call('tripCancelled'),
    newMessage: call('newMessage'),
    messageRead: call('messageRead'),
    ratingReceived: call('ratingReceived'),
    ratingWarning: call('ratingWarning'),
    verificationApproved: call('verificationApproved'),
    verificationRejected: call('verificationRejected'),
    verificationNeedDocs: call('verificationNeedDocs'),
    accountBlocked: call('accountBlocked'),
    securityAlertReuse: call('securityAlertReuse'),
    broadcastToAdmins: call('broadcastToAdmins'),
    bookingViewed: call('bookingViewed'),
    chatLimitWarning: call('chatLimitWarning'),
    chatPhaseChanged: call('chatPhaseChanged'),
    loyaltyTierChanged: call('loyaltyTierChanged'),
    requestResponseReceived: call('requestResponseReceived'),
    requestResponseAccepted: call('requestResponseAccepted'),
    requestResponseDeclined: call('requestResponseDeclined'),
    tripCompletedRate: call('tripCompletedRate'),
  };
}

// ─── Bot bootstrap + command handlers ─────────────────────────────
export async function startTelegramBot(prisma: PrismaClient): Promise<Bot | null> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    logger.info('TELEGRAM_BOT_TOKEN not set — Telegram bot disabled');
    return null;
  }
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  await bot.api
    .setMyCommands([
      { command: 'start', description: 'Начать' },
      { command: 'help', description: 'Помощь' },
      { command: 'mytrips', description: 'Мои поездки' },
      { command: 'support', description: 'Поддержка' },
      { command: 'lang', description: 'Сменить язык' },
      { command: 'unsubscribe', description: 'Отписаться от уведомлений' },
      { command: 'subscribe', description: 'Подписаться на уведомления' },
    ])
    .catch((err: unknown) => logger.warn({ err }, 'setMyCommands failed'));

  bot.command('start', async (ctx: Context) => {
    const payload = ctx.match as string | undefined;
    logger.debug({ payload, from: ctx.from?.id }, 'bot /start received');
    if (payload?.startsWith('reg_') && ctx.from) {
      await handleTelegramLinkToken(prisma, bot, payload.slice(4), ctx.from.id).catch(
        (err: unknown) => logger.warn({ err }, 'handleTelegramLinkToken failed'),
      );
      return;
    }

    const firstName = ctx.from?.first_name ?? 'друг';
    const isReturning = ctx.from
      ? !!(await prisma.authProvider.findFirst({
          where: { provider: 'telegram', providerUserId: String(ctx.from.id) },
        }))
      : false;

    const greeting = isReturning
      ? `👋 С возвращением, <b>${firstName}</b>!`
      : `👋 Привет, <b>${firstName}</b>!`;

    const text =
      `${greeting}\n\n` +
      `🚗 <b>Tappjet — поездки по Кыргызстану</b>\n\n` +
      `Попутчики и такси из Бишкека в Ош, Каракол, Нарын и другие города. Или предложи свою поездку!\n\n` +
      `✅ Верифицированные водители\n` +
      `⭐ Рейтинги и отзывы\n` +
      `💬 Встроенный чат\n` +
      `📱 Работает прямо в Telegram`;

    const isHttps = env.BASE_URL.startsWith('https://');
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          ...(isHttps
            ? [[{ text: '🚗 Открыть Tappjet', web_app: { url: env.BASE_URL } }]]
            : []),
          [
            { text: 'ℹ️ Помощь', callback_data: 'help' },
            { text: '🔔 Уведомления', callback_data: 'notify' },
          ],
        ],
      },
    });
  });

  bot.callbackQuery('help', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      'Платформа попутчиков. Публикуйте поездки, бронируйте места.\nПоддержка: @tappjet_support',
    );
  });

  bot.callbackQuery('notify', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const user = await prisma.user.findFirst({ where: { telegramId: BigInt(ctx.from.id) } });
    if (!user) {
      await ctx.reply('Войдите через приложение, чтобы управлять уведомлениями.');
      return;
    }
    const next = !user.notificationsEnabled;
    await prisma.user.update({ where: { id: user.id }, data: { notificationsEnabled: next } });
    await ctx.reply(next ? '🔔 Уведомления включены.' : '🔕 Уведомления отключены.');
  });

  bot.command('help', (ctx: Context) =>
    ctx.reply(
      'Платформа попутчиков. Публикуйте поездки, бронируйте места. Поддержка: @tappjet_support',
    ),
  );

  bot.command('support', (ctx: Context) =>
    ctx.reply('Контакт поддержки: @tappjet_support'),
  );

  bot.command('lang', async (ctx: Context) => {
    if (!ctx.from) return;
    const user = await prisma.user.findFirst({ where: { telegramId: BigInt(ctx.from.id) } });
    if (!user) return;
    const next = user.language === 'ru' ? 'kg' : 'ru';
    await prisma.user.update({ where: { id: user.id }, data: { language: next } });
    await ctx.reply(next === 'kg' ? 'Тил: кыргызча' : 'Язык: русский');
  });

  const toggleSubscribe = async (ctx: Context, enabled: boolean): Promise<void> => {
    if (!ctx.from) return;
    const user = await prisma.user.findFirst({ where: { telegramId: BigInt(ctx.from.id) } });
    if (!user) return;
    await prisma.user.update({
      where: { id: user.id },
      data: { notificationsEnabled: enabled },
    });
    await ctx.reply(
      enabled ? 'Вы подписаны на уведомления.' : 'Вы отписаны от уведомлений.',
    );
  };
  bot.command('unsubscribe', (ctx: Context) => toggleSubscribe(ctx, false));
  bot.command('subscribe', (ctx: Context) => toggleSubscribe(ctx, true));

  bot.command('mytrips', async (ctx: Context) => {
    if (!ctx.from) return;
    const user = await prisma.user.findFirst({ where: { telegramId: BigInt(ctx.from.id) } });
    if (!user) {
      await ctx.reply('Войдите через Mini App.');
      return;
    }
    const now = new Date();
    const [active, pending, accepted] = await Promise.all([
      prisma.trip.count({
        where: { driverId: user.id, status: 'active', departureAt: { gte: now } },
      }),
      prisma.booking.count({ where: { passengerId: user.id, status: 'pending' } }),
      prisma.booking.count({ where: { passengerId: user.id, status: 'accepted' } }),
    ]);
    await ctx.reply(
      `Активных поездок (как водитель): ${active}\n` +
        `Бронирований в ожидании: ${pending}\n` +
        `Принятых бронирований: ${accepted}`,
    );
  });

  bot.catch((err) => logger.warn({ err }, 'grammy bot handler error'));

  // Long-poll in background — don't await (start() resolves on stop).
  void bot.start({ drop_pending_updates: true });

  logger.info('Telegram bot started (long polling)');
  return bot;
}
