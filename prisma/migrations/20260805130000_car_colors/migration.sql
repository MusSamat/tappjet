-- Car colors catalog — reference data for the colour picker (name + hex swatch).
-- Self-contained: creates the table and seeds the 15 colours.

CREATE TABLE "car_colors" (
    "id" SMALLINT NOT NULL,
    "name_ru" VARCHAR(50) NOT NULL,
    "name_ky" VARCHAR(50) NOT NULL,
    "hex_code" VARCHAR(9) NOT NULL,
    "sort_position" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "car_colors_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "car_colors_is_active_sort_position_idx" ON "car_colors"("is_active", "sort_position");

INSERT INTO "car_colors" ("id", "name_ru", "name_ky", "hex_code", "sort_position") VALUES
(1,'Белый','Ак','#FFFFFF',1),
(2,'Черный','Кара','#1C1C1C',2),
(3,'Серебристый','Күмүш түстүү','#C0C0C0',3),
(4,'Серый','Боз','#808080',4),
(5,'Синий','Көк','#1E3A8A',5),
(6,'Красный','Кызыл','#B91C1C',6),
(7,'Коричневый','Күрөң','#6B4226',7),
(8,'Бежевый','Күрөңсүл ак','#E8DCC4',8),
(9,'Зеленый','Жашыл','#166534',9),
(10,'Golden/Шампань','Алтын түстүү','#C9A66B',10),
(11,'Темно-синий','Ачык көк','#0F2557',11),
(12,'Бордовый','Кочкул кызыл','#7F1D1D',12),
(13,'Желтый','Сары','#EAB308',13),
(14,'Оранжевый','Кызгылт сары','#EA580C',14),
(15,'Фиолетовый','Кызгылт көк','#6D28D9',15);
