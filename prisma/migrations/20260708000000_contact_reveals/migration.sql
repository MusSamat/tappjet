-- Phone-reveal audit («Позвонить» taps): who saw whose number, in which
-- context. Unique per (viewer, context) so repeat taps don't inflate the
-- daily anti-scraping limit.
CREATE TABLE "contact_reveals" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "viewer_id"      UUID NOT NULL,
  "target_user_id" UUID NOT NULL,
  "context_type"   VARCHAR(30) NOT NULL,
  "context_id"     UUID NOT NULL,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "contact_reveals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contact_reveals_viewer_id_context_type_context_id_key"
  ON "contact_reveals"("viewer_id", "context_type", "context_id");
CREATE INDEX "contact_reveals_viewer_id_created_at_idx" ON "contact_reveals"("viewer_id", "created_at");
CREATE INDEX "contact_reveals_target_user_id_idx" ON "contact_reveals"("target_user_id");
