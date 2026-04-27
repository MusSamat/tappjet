import { z } from 'zod';

export const BookingIdParam = z.object({ booking_id: z.string().uuid() });

export const MessageIdParam = z.object({ id: z.string().uuid() });

export const MessagesQuery = z.object({
  cursor: z.string().uuid().optional(),
  // TZ §13.3 "Rate limit: 20 messages/min" — not a page size concern but keep
  // consistent with other cursor-paginated endpoints.
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const SendMessageBody = z.object({
  text: z.string().trim().min(1).max(2000),
  clientMsgId: z.string().max(100).optional(),
});

export type MessagesQueryInput = z.infer<typeof MessagesQuery>;
export type SendMessageInput = z.infer<typeof SendMessageBody>;
