-- CreateTable
CREATE TABLE "analytics_snapshots" (
    "key" VARCHAR(50) NOT NULL,
    "data" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_snapshots_pkey" PRIMARY KEY ("key")
);
