-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "telegram_id" BIGINT,
    "phone" VARCHAR(20) NOT NULL,
    "phone_verified_at" TIMESTAMPTZ(6),
    "name" VARCHAR(100) NOT NULL,
    "avatar_url" VARCHAR(500),
    "roles" TEXT[] DEFAULT ARRAY['passenger']::TEXT[],
    "rating" DECIMAL(3,2) NOT NULL DEFAULT 0.00,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "language" VARCHAR(2) NOT NULL DEFAULT 'ru',
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "blocked_reason" TEXT,
    "terms_accepted_at" TIMESTAMPTZ(6),
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "car_make" VARCHAR(50) NOT NULL,
    "car_model" VARCHAR(50) NOT NULL,
    "car_year" SMALLINT NOT NULL,
    "car_color" VARCHAR(30) NOT NULL,
    "car_plate" VARCHAR(15) NOT NULL,
    "seats_count" SMALLINT NOT NULL,
    "license_photo_path" VARCHAR(500) NOT NULL,
    "car_passport_path" VARCHAR(500) NOT NULL,
    "car_photo_path" VARCHAR(500) NOT NULL,
    "selfie_path" VARCHAR(500) NOT NULL,
    "verification_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "rejection_reason" TEXT,
    "verified_at" TIMESTAMPTZ(6),
    "verified_by" UUID,
    "total_trips" INTEGER NOT NULL DEFAULT 0,
    "cancellations_30d" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "origin_city" VARCHAR(50) NOT NULL,
    "destination_city" VARCHAR(50) NOT NULL,
    "origin_address" VARCHAR(200) NOT NULL,
    "origin_lat" DOUBLE PRECISION,
    "origin_lng" DOUBLE PRECISION,
    "waypoints" JSONB NOT NULL DEFAULT '[]',
    "departure_at" TIMESTAMPTZ(6) NOT NULL,
    "departure_flexible" BOOLEAN NOT NULL DEFAULT false,
    "estimated_duration_min" INTEGER NOT NULL,
    "seats_total" SMALLINT NOT NULL,
    "seats_available" SMALLINT NOT NULL,
    "price_per_seat" INTEGER NOT NULL,
    "price_negotiable" BOOLEAN NOT NULL DEFAULT false,
    "luggage" VARCHAR(10) NOT NULL DEFAULT 'no',
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "comment" VARCHAR(300),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "cancelled_reason" TEXT,
    "idempotency_key" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "seats_count" SMALLINT NOT NULL,
    "comment" VARCHAR(300),
    "status" VARCHAR(25) NOT NULL DEFAULT 'pending',
    "cancelled_by" VARCHAR(10),
    "cancelled_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "text" VARCHAR(2000) NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "rater_id" UUID NOT NULL,
    "ratee_id" UUID NOT NULL,
    "score" SMALLINT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "comment" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "channel" VARCHAR(10) NOT NULL,
    "payload" JSONB NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaints" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "target_user_id" UUID,
    "target_trip_id" UUID,
    "category" VARCHAR(50) NOT NULL,
    "description" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'new',
    "resolution" TEXT,
    "handled_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "code_hash" VARCHAR(100) NOT NULL,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(100) NOT NULL,
    "device_info" VARCHAR(300),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" SERIAL NOT NULL,
    "name_ru" VARCHAR(100) NOT NULL,
    "name_ky" VARCHAR(100) NOT NULL,
    "region" VARCHAR(50),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" UUID NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "password_hash" VARCHAR(100) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'admin',
    "totp_secret" VARCHAR(200),
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_actions" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "target_id" UUID,
    "target_type" VARCHAR(30),
    "details" JSONB,
    "ip_address" INET,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_locks" (
    "job_name" VARCHAR(100) NOT NULL,
    "locked_at" TIMESTAMPTZ(6) NOT NULL,
    "locked_until" TIMESTAMPTZ(6) NOT NULL,
    "locked_by" VARCHAR(100) NOT NULL,

    CONSTRAINT "cron_locks_pkey" PRIMARY KEY ("job_name")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE INDEX "users_language_idx" ON "users"("language");

-- CreateIndex
CREATE UNIQUE INDEX "driver_profiles_user_id_key" ON "driver_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "driver_profiles_car_plate_key" ON "driver_profiles"("car_plate");

-- CreateIndex
CREATE INDEX "driver_profiles_verification_status_idx" ON "driver_profiles"("verification_status");

-- CreateIndex
CREATE UNIQUE INDEX "trips_idempotency_key_key" ON "trips"("idempotency_key");

-- CreateIndex
CREATE INDEX "trips_driver_id_idx" ON "trips"("driver_id");

-- CreateIndex
CREATE INDEX "trips_status_idx" ON "trips"("status");

-- CreateIndex
CREATE INDEX "trips_departure_at_idx" ON "trips"("departure_at");

-- CreateIndex
CREATE INDEX "idx_trips_search" ON "trips"("origin_city", "destination_city", "departure_at", "status");

-- CreateIndex
CREATE INDEX "bookings_trip_id_idx" ON "bookings"("trip_id");

-- CreateIndex
CREATE INDEX "bookings_passenger_id_idx" ON "bookings"("passenger_id");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status");

-- CreateIndex
CREATE INDEX "bookings_expires_at_idx" ON "bookings"("expires_at");

-- CreateIndex
CREATE INDEX "messages_booking_id_idx" ON "messages"("booking_id");

-- CreateIndex
CREATE INDEX "messages_created_at_idx" ON "messages"("created_at");

-- CreateIndex
CREATE INDEX "ratings_ratee_id_idx" ON "ratings"("ratee_id");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_trip_id_rater_id_ratee_id_key" ON "ratings"("trip_id", "rater_id", "ratee_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "notifications_delivered_idx" ON "notifications"("delivered");

-- CreateIndex
CREATE INDEX "complaints_status_idx" ON "complaints"("status");

-- CreateIndex
CREATE INDEX "complaints_created_at_idx" ON "complaints"("created_at");

-- CreateIndex
CREATE INDEX "otp_codes_phone_created_at_idx" ON "otp_codes"("phone", "created_at");

-- CreateIndex
CREATE INDEX "otp_codes_expires_at_idx" ON "otp_codes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "cities_name_ru_key" ON "cities"("name_ru");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "admin_actions_admin_id_idx" ON "admin_actions"("admin_id");

-- CreateIndex
CREATE INDEX "admin_actions_created_at_idx" ON "admin_actions"("created_at");

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rater_id_fkey" FOREIGN KEY ("rater_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_ratee_id_fkey" FOREIGN KEY ("ratee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_handled_by_fkey" FOREIGN KEY ("handled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Additional constraints not expressible in Prisma DSL ─────────

-- A passenger cannot have two simultaneously-active bookings on the same trip
-- (TZ §5.5 UNIQUE constraint)
CREATE UNIQUE INDEX "idx_bookings_trip_passenger_active"
    ON "bookings" ("trip_id", "passenger_id")
    WHERE "status" IN ('pending', 'accepted');

-- Partial index on active users (TZ §5.2 "idx_users_deleted_at WHERE NULL")
CREATE INDEX "idx_users_active" ON "users" ("id") WHERE "deleted_at" IS NULL;

-- CHECK constraints (TZ §5.2–§5.8)
ALTER TABLE "users"
    ADD CONSTRAINT "users_language_check" CHECK ("language" IN ('ru', 'ky')),
    ADD CONSTRAINT "users_rating_range" CHECK ("rating" >= 0.00 AND "rating" <= 5.00);

ALTER TABLE "driver_profiles"
    ADD CONSTRAINT "driver_profiles_car_year_range" CHECK ("car_year" BETWEEN 1980 AND 2030),
    ADD CONSTRAINT "driver_profiles_seats_range" CHECK ("seats_count" BETWEEN 1 AND 7),
    ADD CONSTRAINT "driver_profiles_status_check" CHECK (
        "verification_status" IN ('pending', 'verified', 'rejected', 'suspended', 'blocked')
    );

ALTER TABLE "trips"
    ADD CONSTRAINT "trips_seats_total_range" CHECK ("seats_total" BETWEEN 1 AND 7),
    ADD CONSTRAINT "trips_seats_available_range" CHECK ("seats_available" >= 0 AND "seats_available" <= "seats_total"),
    ADD CONSTRAINT "trips_price_range" CHECK ("price_per_seat" >= 50 AND "price_per_seat" <= 10000),
    ADD CONSTRAINT "trips_luggage_check" CHECK ("luggage" IN ('yes', 'small', 'no')),
    ADD CONSTRAINT "trips_status_check" CHECK ("status" IN ('active', 'completed', 'cancelled'));

ALTER TABLE "bookings"
    ADD CONSTRAINT "bookings_seats_range" CHECK ("seats_count" BETWEEN 1 AND 4),
    ADD CONSTRAINT "bookings_status_check" CHECK (
        "status" IN (
            'pending', 'accepted', 'rejected',
            'cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_late',
            'no_show', 'completed', 'expired'
        )
    ),
    ADD CONSTRAINT "bookings_cancelled_by_check" CHECK (
        "cancelled_by" IS NULL OR "cancelled_by" IN ('driver', 'passenger')
    );

ALTER TABLE "ratings"
    ADD CONSTRAINT "ratings_score_range" CHECK ("score" BETWEEN 1 AND 5);

ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_channel_check" CHECK ("channel" IN ('telegram', 'push', 'both'));

ALTER TABLE "complaints"
    ADD CONSTRAINT "complaints_status_check" CHECK (
        "status" IN ('new', 'in_review', 'resolved', 'dismissed')
    ),
    ADD CONSTRAINT "complaints_category_check" CHECK (
        "category" IN ('safety', 'fraud', 'rudeness', 'no_show', 'other')
    );

ALTER TABLE "admins"
    ADD CONSTRAINT "admins_role_check" CHECK ("role" IN ('admin', 'superadmin'));
