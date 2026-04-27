-- TZ v2.1 §7 + §8: auth system revision.
--   • users gains password_hash + last_password_changed_at (phone+password + reset)
--   • refresh_tokens gains used_at (Token Reuse Detection per §7.5)
--   • New auth_providers table — one row per (user_id, provider)
--   • Backfill: every existing users.telegram_id gets an auth_providers row so
--     Telegram logins keep working after deploy

ALTER TABLE "users"
    ADD COLUMN "password_hash" VARCHAR(100),
    ADD COLUMN "last_password_changed_at" TIMESTAMPTZ(6);

ALTER TABLE "refresh_tokens"
    ADD COLUMN "used_at" TIMESTAMPTZ(6);

CREATE TABLE "auth_providers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "provider_user_id" VARCHAR(200) NOT NULL,
    "provider_data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_providers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auth_providers_provider_check" CHECK (
        "provider" IN ('telegram', 'google', 'apple', 'phone')
    )
);

CREATE UNIQUE INDEX "auth_providers_provider_provider_user_id_key"
    ON "auth_providers" ("provider", "provider_user_id");

CREATE INDEX "auth_providers_user_id_idx" ON "auth_providers" ("user_id");

ALTER TABLE "auth_providers"
    ADD CONSTRAINT "auth_providers_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: existing Telegram-linked users get an auth_providers row so
-- subsequent logins still find them via provider lookup.
INSERT INTO "auth_providers" (id, user_id, provider, provider_user_id, provider_data, created_at)
SELECT gen_random_uuid(),
       id,
       'telegram',
       telegram_id::text,
       '{}'::jsonb,
       created_at
FROM "users"
WHERE telegram_id IS NOT NULL AND deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- Users who registered via phone-only in v2.0 get a 'phone' provider row, so
-- repeat /auth/phone/login (when they later set a password) works uniformly.
INSERT INTO "auth_providers" (id, user_id, provider, provider_user_id, provider_data, created_at)
SELECT gen_random_uuid(), id, 'phone', phone, '{}'::jsonb, created_at
FROM "users"
WHERE phone_verified_at IS NOT NULL
  AND telegram_id IS NULL
  AND deleted_at IS NULL
  AND NOT phone LIKE '+tg:%'
  AND NOT phone LIKE '+del:%'
ON CONFLICT DO NOTHING;
