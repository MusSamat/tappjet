CREATE TABLE "telegram_bot_login_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token" VARCHAR(36) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'waiting',
    "user_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_bot_login_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_bot_login_tokens_token_key" ON "telegram_bot_login_tokens"("token");
CREATE INDEX "telegram_bot_login_tokens_expires_at_idx" ON "telegram_bot_login_tokens"("expires_at");
