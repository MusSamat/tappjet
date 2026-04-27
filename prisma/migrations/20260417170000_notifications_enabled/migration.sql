-- TZ §25.2 /unsubscribe: "сохраняем в users.notifications_enabled=false".
ALTER TABLE "users"
    ADD COLUMN "notifications_enabled" BOOLEAN NOT NULL DEFAULT true;
