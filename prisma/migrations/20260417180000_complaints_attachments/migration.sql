-- TZ §16.2 step 4 — complaints can carry up to 5 screenshots.
-- escalated_at lets the escalate_complaints cron fire at most once per P0.
ALTER TABLE "complaints"
    ADD COLUMN "attachments" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "escalated_at" TIMESTAMPTZ(6);
