-- Extend driver_profiles with request_more_docs flow + submitted_at (needed for FIFO queue
-- and SLA escalation cron — TZ §9.2 + §21.1 "escalate_verifications").

ALTER TABLE "driver_profiles"
    ADD COLUMN "requested_docs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "submitted_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Extend verification status enum to include "docs_requested" (TZ §9.1 step 9).
ALTER TABLE "driver_profiles" DROP CONSTRAINT "driver_profiles_status_check";
ALTER TABLE "driver_profiles"
    ADD CONSTRAINT "driver_profiles_status_check" CHECK (
        "verification_status" IN ('pending', 'verified', 'rejected', 'docs_requested', 'suspended', 'blocked')
    );

-- FIFO queue index (TZ §17.2 "Сортировка: по дате ASC (FIFO)").
CREATE INDEX "idx_driver_profiles_status_submitted"
    ON "driver_profiles" ("verification_status", "submitted_at" ASC);
