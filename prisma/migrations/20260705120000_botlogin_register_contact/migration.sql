-- Free Telegram registration: remember which Telegram account is mid-registration
-- on a bot-login token while we wait for it to share its phone (request_contact).
ALTER TABLE "telegram_bot_login_tokens" ADD COLUMN "telegram_id" BIGINT;
CREATE INDEX "telegram_bot_login_tokens_telegram_id_idx" ON "telegram_bot_login_tokens"("telegram_id");
