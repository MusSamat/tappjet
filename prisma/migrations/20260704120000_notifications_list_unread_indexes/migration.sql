-- List query: WHERE user_id ORDER BY created_at DESC (cursor pagination)
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- Unread badge: WHERE user_id AND read_at IS NULL
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");
