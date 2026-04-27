-- CreateTable
CREATE TABLE "telegram_link_tokens" (
    "id" UUID NOT NULL,
    "token" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "telegram_id" BIGINT,
    "status" VARCHAR(10) NOT NULL DEFAULT 'waiting',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_link_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_link_tokens_token_key" ON "telegram_link_tokens"("token");

-- CreateIndex
CREATE INDEX "telegram_link_tokens_expires_at_idx" ON "telegram_link_tokens"("expires_at");
