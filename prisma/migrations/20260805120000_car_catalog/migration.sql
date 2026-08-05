-- Car catalog: brands → models. Reference data for the make/model pickers.
-- Self-contained: creates the tables and seeds all brands + models so a plain
-- `prisma migrate deploy` populates them. Stable SMALLINT ids keep it idempotent.

CREATE TABLE "car_brands" (
    "id" SMALLINT NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "sort_position" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "car_brands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "car_brands_name_key" ON "car_brands"("name");
CREATE INDEX "car_brands_is_active_sort_position_idx" ON "car_brands"("is_active", "sort_position");

CREATE TABLE "car_models" (
    "id" SMALLINT NOT NULL,
    "brand_id" SMALLINT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "body_type" VARCHAR(20),
    "sort_position" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "car_models_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "car_models_brand_id_sort_position_idx" ON "car_models"("brand_id", "sort_position");

ALTER TABLE "car_models" ADD CONSTRAINT "car_models_brand_id_fkey"
    FOREIGN KEY ("brand_id") REFERENCES "car_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Brands (39) ──────────────────────────────────────────────────────
INSERT INTO "car_brands" ("id", "name", "sort_position") VALUES
(1,'Toyota',1),(2,'Hyundai',2),(3,'Kia',3),(4,'Honda',4),(5,'Nissan',5),
(6,'BYD',6),(7,'Lexus',7),(8,'Subaru',8),(9,'Chevrolet',9),(10,'Daewoo',10),
(11,'Geely',11),(12,'Great Wall',12),(13,'Haval',13),(14,'ВАЗ (Lada)',14),(15,'Aion',15),
(16,'Renault',16),(17,'SsangYong',17),(18,'Audi',18),(19,'BMW',19),(20,'Mercedes-Benz',20),
(21,'Daihatsu',21),(22,'Dodge',22),(23,'Ford',23),(24,'Isuzu',24),(25,'JAC',25),
(26,'Jeep',26),(27,'Mitsubishi',27),(28,'Peugeot',28),(29,'Skoda',29),(30,'Volkswagen',30),
(31,'Volvo',31),(32,'GAC',32),(33,'LiXiang',33),(34,'Nio',34),(35,'Zeekr',35),
(36,'HiPhi',36),(37,'Avatr',37),(38,'Mazda',38),(39,'Suzuki',39);

-- ─── Models (390) ─────────────────────────────────────────────────────
INSERT INTO "car_models" ("id", "brand_id", "name", "body_type", "sort_position") VALUES
(101,1,'Camry','sedan',1),(102,1,'Corolla','sedan',2),(103,1,'Land Cruiser Prado','suv',3),(104,1,'RAV4','suv',4),(105,1,'Prius','hatchback',5),(106,1,'Yaris','hatchback',6),(107,1,'Hilux','pickup',7),(108,1,'Fortuner','suv',8),(109,1,'Vitz','hatchback',9),(110,1,'Mark II','sedan',10),
(201,2,'Sonata','sedan',1),(202,2,'Elantra','sedan',2),(203,2,'Santa Fe','suv',3),(204,2,'Tucson','suv',4),(205,2,'Accent','sedan',5),(206,2,'i10','hatchback',6),(207,2,'Creta','suv',7),(208,2,'Getz','hatchback',8),(209,2,'Matrix','mpv',9),(210,2,'Avante','sedan',10),
(301,3,'Cerato','sedan',1),(302,3,'Rio','sedan',2),(303,3,'Optima','sedan',3),(304,3,'Sportage','suv',4),(305,3,'Sorento','suv',5),(306,3,'Picanto','hatchback',6),(307,3,'Forte','sedan',7),(308,3,'Niro','suv',8),(309,3,'Carnival','mpv',9),(310,3,'Telluride','suv',10),
(401,4,'Accord','sedan',1),(402,4,'Civic','sedan',2),(403,4,'CR-V','suv',3),(404,4,'Odyssey','mpv',4),(405,4,'Fit/Jazz','hatchback',5),(406,4,'City','sedan',6),(407,4,'Pilot','suv',7),(408,4,'Ridgeline','pickup',8),(409,4,'Stream','mpv',9),(410,4,'Integra','sedan',10),
(501,5,'Altima','sedan',1),(502,5,'Maxima','sedan',2),(503,5,'Qashqai','suv',3),(504,5,'X-Trail','suv',4),(505,5,'Tiida','hatchback',5),(506,5,'Teana','sedan',6),(507,5,'Sunny','sedan',7),(508,5,'Bluebird Sylphy','sedan',8),(509,5,'Note','hatchback',9),(510,5,'Patrol','suv',10),
(601,6,'Song','suv',1),(602,6,'Qin','sedan',2),(603,6,'Seagull','hatchback',3),(604,6,'F3','sedan',4),(605,6,'Yuan','suv',5),(606,6,'Atto 3','suv',6),(607,6,'Atto 2','suv',7),(608,6,'F0','hatchback',8),(609,6,'Qin Plus DM-i','sedan',9),(610,6,'Song Pro DM-i','suv',10),
(701,7,'IS','sedan',1),(702,7,'LS','sedan',2),(703,7,'RX','suv',3),(704,7,'ES','sedan',4),(705,7,'CT','hatchback',5),(706,7,'NX','suv',6),(707,7,'UX','suv',7),(708,7,'GS','sedan',8),(709,7,'LX','suv',9),(710,7,'HS','sedan',10),
(801,8,'Legacy','sedan',1),(802,8,'Outback','suv',2),(803,8,'Impreza','sedan',3),(804,8,'Forester','suv',4),(805,8,'XV/Crosstrek','suv',5),(806,8,'Justy','hatchback',6),(807,8,'Stella','hatchback',7),(808,8,'R2','hatchback',8),(809,8,'Sambar','mpv',9),(810,8,'Vivio','hatchback',10),
(901,9,'Cruze','sedan',1),(902,9,'Aveo','sedan',2),(903,9,'Captiva','suv',3),(904,9,'Lacetti','sedan',4),(905,9,'Optra','sedan',5),(906,9,'Epica','sedan',6),(907,9,'Malibu','sedan',7),(908,9,'Equinox','suv',8),(909,9,'Traverse','suv',9),(910,9,'Tahoe','suv',10),
(1001,10,'Gentra','sedan',1),(1002,10,'Matiz','hatchback',2),(1003,10,'Nubira','sedan',3),(1004,10,'Lanos','sedan',4),(1005,10,'Leganza','sedan',5),(1006,10,'Nexia','sedan',6),(1007,10,'Espero','sedan',7),(1008,10,'Winstorm','suv',8),(1009,10,'Tacuma','mpv',9),(1010,10,'Tico','hatchback',10),
(1101,11,'Emgrand EC7','sedan',1),(1102,11,'Panda','hatchback',2),(1103,11,'Kingkong','sedan',3),(1104,11,'GC6/Vision','sedan',4),(1105,11,'Moonray','sedan',5),(1106,11,'Emgrand X7','suv',6),(1107,11,'Coolray','suv',7),(1108,11,'Atlas','suv',8),(1109,11,'Borui','sedan',9),(1110,11,'Azkarra','suv',10),
(1201,12,'Voleex C30','sedan',1),(1202,12,'Haval H6','suv',2),(1203,12,'Poer','pickup',3),(1204,12,'Haval H5','suv',4),(1205,12,'Florid','sedan',5),(1206,12,'Windsoul','sedan',6),(1207,12,'M4','suv',7),(1208,12,'V80','pickup',8),(1209,12,'Hover H3','suv',9),(1210,12,'Harvard H2','suv',10),
(1301,13,'H6','suv',1),(1302,13,'H5','suv',2),(1303,13,'H9','suv',3),(1304,13,'H2','suv',4),(1305,13,'F7','suv',5),(1306,13,'Jolion','suv',6),(1307,13,'H4','suv',7),(1308,13,'M6','suv',8),(1309,13,'B01','suv',9),(1310,13,'H6 GT','suv',10),
(1401,14,'2105/2104','sedan',1),(1402,14,'2106/2103','sedan',2),(1403,14,'2109/2108/2110','hatchback',3),(1404,14,'Priora','sedan',4),(1405,14,'Niva','suv',5),(1406,14,'Samara','hatchback',6),(1407,14,'2101','sedan',7),(1408,14,'Granta','sedan',8),(1409,14,'Vesta','sedan',9),(1410,14,'Largus','mpv',10),
(1501,15,'Aion S','sedan',1),(1502,15,'Aion S Plus','sedan',2),(1503,15,'Aion S Flex','sedan',3),(1504,15,'Aion Y','suv',4),(1505,15,'Aion Y Plus','suv',5),(1506,15,'Aion X','suv',6),(1507,15,'Aion X Plus','suv',7),(1508,15,'Aion LX','suv',8),(1509,15,'Aion LX Plus','suv',9),(1510,15,'Aion V','suv',10),
(1601,16,'Logan','sedan',1),(1602,16,'Sandero','hatchback',2),(1603,16,'Duster','suv',3),(1604,16,'Clio','hatchback',4),(1605,16,'Megane','sedan',5),(1606,16,'Fluence','sedan',6),(1607,16,'Master','van',7),(1608,16,'Symbol','sedan',8),(1609,16,'Scenic','mpv',9),(1610,16,'Koleos','suv',10),
(1701,17,'Kyron','suv',1),(1702,17,'Rexton','suv',2),(1703,17,'Actyon','suv',3),(1704,17,'Stavic/Rodius','mpv',4),(1705,17,'Korando','suv',5),(1706,17,'Tivoli','suv',6),(1707,17,'Musso','pickup',7),(1708,17,'Chairman','sedan',8),(1709,17,'Istana','van',9),(1710,17,'Turismo','mpv',10),
(1801,18,'A4','sedan',1),(1802,18,'A6','sedan',2),(1803,18,'A3','hatchback',3),(1804,18,'Q5','suv',4),(1805,18,'Q7','suv',5),(1806,18,'A5','sedan',6),(1807,18,'Q3','suv',7),(1808,18,'A8','sedan',8),(1809,18,'TT','sedan',9),(1810,18,'RS Models','sedan',10),
(1901,19,'3 Series','sedan',1),(1902,19,'5 Series','sedan',2),(1903,19,'X5','suv',3),(1904,19,'X3','suv',4),(1905,19,'1 Series','hatchback',5),(1906,19,'7 Series','sedan',6),(1907,19,'X1','suv',7),(1908,19,'Z4','sedan',8),(1909,19,'M3/M5','sedan',9),(1910,19,'6 Series','sedan',10),
(2001,20,'C-Class','sedan',1),(2002,20,'E-Class','sedan',2),(2003,20,'GLK-Class','suv',3),(2004,20,'GLE-Class','suv',4),(2005,20,'A-Class','hatchback',5),(2006,20,'B-Class','hatchback',6),(2007,20,'S-Class','sedan',7),(2008,20,'M-Class/GLE','suv',8),(2009,20,'Sprinter','van',9),(2010,20,'CLA-Class','sedan',10),
(2101,21,'Terios','suv',1),(2102,21,'Xenia','mpv',2),(2103,21,'Sirion/Boon','hatchback',3),(2104,21,'Mira','hatchback',4),(2105,21,'Charade','hatchback',5),(2106,21,'Taft','suv',6),(2107,21,'Ceria','hatchback',7),(2108,21,'Rocky','suv',8),(2109,21,'Feroza','suv',9),(2110,21,'Hijet','pickup',10),
(2201,22,'Caliber','hatchback',1),(2202,22,'Caravan','mpv',2),(2203,22,'Dakota','pickup',3),(2204,22,'Ram','pickup',4),(2205,22,'Avenger','sedan',5),(2206,22,'Charger','sedan',6),(2207,22,'Nitro','suv',7),(2208,22,'Journey','suv',8),(2209,22,'Durango','suv',9),(2210,22,'Magnum','sedan',10),
(2301,23,'Focus','sedan',1),(2302,23,'Mondeo','sedan',2),(2303,23,'Fusion','sedan',3),(2304,23,'Escape','suv',4),(2305,23,'Kuga','suv',5),(2306,23,'Transit','van',6),(2307,23,'Fiesta','hatchback',7),(2308,23,'Ranger','pickup',8),(2309,23,'Edge','suv',9),(2310,23,'Galaxy','mpv',10),
(2401,24,'D-Max','pickup',1),(2402,24,'Trooper','suv',2),(2403,24,'MU','suv',3),(2404,24,'Ascender/Rodeo','suv',4),(2405,24,'Bighorn/Trooper','suv',5),(2406,24,'N-Series','truck',6),(2407,24,'NPR/NQR','truck',7),(2408,24,'Stylus/Impulse','sedan',8),(2409,24,'i-Mark/Gemini','sedan',9),(2410,24,'Vehicross','suv',10),
(2501,25,'S3/S3 Youth','suv',1),(2502,25,'J6','sedan',2),(2503,25,'S5','suv',3),(2504,25,'J2','sedan',4),(2505,25,'J7/J7 Plus','sedan',5),(2506,25,'T6','pickup',6),(2507,25,'HFC1020','truck',7),(2508,25,'Gallop','pickup',8),(2509,25,'Refine','van',9),(2510,25,'S2','suv',10),
(2601,26,'Grand Cherokee','suv',1),(2602,26,'Wrangler','suv',2),(2603,26,'Cherokee','suv',3),(2604,26,'Liberty','suv',4),(2605,26,'Compass','suv',5),(2606,26,'Patriot','suv',6),(2607,26,'Renegade','suv',7),(2608,26,'Commander','suv',8),(2609,26,'CJ','suv',9),(2610,26,'Gladiator','pickup',10),
(2701,27,'Lancer','sedan',1),(2702,27,'Outlander','suv',2),(2703,27,'Pajero','suv',3),(2704,27,'ASX','suv',4),(2705,27,'Colt','hatchback',5),(2706,27,'Mirage','hatchback',6),(2707,27,'L200','pickup',7),(2708,27,'Space Wagon','mpv',8),(2709,27,'Grandis','mpv',9),(2710,27,'Carisma','sedan',10),
(2801,28,'206','hatchback',1),(2802,28,'207','hatchback',2),(2803,28,'308','hatchback',3),(2804,28,'307','hatchback',4),(2805,28,'407','sedan',5),(2806,28,'3008','suv',6),(2807,28,'5008','mpv',7),(2808,28,'Partner','van',8),(2809,28,'Boxer','van',9),(2810,28,'2008','suv',10),
(2901,29,'Octavia','sedan',1),(2902,29,'Fabia','hatchback',2),(2903,29,'Superb','sedan',3),(2904,29,'Yeti','suv',4),(2905,29,'Rapid','sedan',5),(2906,29,'Kodiaq','suv',6),(2907,29,'Kamiq','suv',7),(2908,29,'Citigo','hatchback',8),(2909,29,'Roomster','mpv',9),(2910,29,'Scala','hatchback',10),
(3001,30,'Golf','hatchback',1),(3002,30,'Jetta','sedan',2),(3003,30,'Passat','sedan',3),(3004,30,'Polo','hatchback',4),(3005,30,'Touran','mpv',5),(3006,30,'Tiguan','suv',6),(3007,30,'Transporter T4','van',7),(3008,30,'Beetle/New Beetle','hatchback',8),(3009,30,'Caddy','van',9),(3010,30,'Caravelle','van',10),
(3101,31,'S60','sedan',1),(3102,31,'S80','sedan',2),(3103,31,'XC90','suv',3),(3104,31,'V70','sedan',4),(3105,31,'XC70','suv',5),(3106,31,'V50','sedan',6),(3107,31,'S40','sedan',7),(3108,31,'C30','hatchback',8),(3109,31,'FM/FH','truck',9),(3110,31,'XC60','suv',10),
(3201,32,'Trumpchi GS8','suv',1),(3202,32,'Trumpchi GA8','sedan',2),(3203,32,'Trumpchi GA6','sedan',3),(3204,32,'Trumpchi GS4','suv',4),(3205,32,'Trumpchi GM8','mpv',5),(3206,32,'Trumpchi GA5','sedan',6),(3207,32,'Trumpchi GA4','sedan',7),(3208,32,'Trumpchi GS3','suv',8),(3209,32,'Trumpchi M6','mpv',9),(3210,32,'Trumpchi GS5','suv',10),
(3301,33,'ONE','suv',1),(3302,33,'ONE Plus','suv',2),(3303,33,'ONE Max','suv',3),(3304,33,'L6','suv',4),(3305,33,'L7','suv',5),(3306,33,'L8','suv',6),(3307,33,'L9','suv',7),(3308,33,'Mega','mpv',8),(3309,33,'L10','suv',9),(3310,33,'X1','suv',10),
(3401,34,'ES8','suv',1),(3402,34,'ES6','suv',2),(3403,34,'EC6','suv',3),(3404,34,'ET7','sedan',4),(3405,34,'ET5','sedan',5),(3406,34,'EL6','suv',6),(3407,34,'EL7','suv',7),(3408,34,'EL8','suv',8),(3409,34,'ET9','sedan',9),(3410,34,'EP9','sedan',10),
(3501,35,'001','sedan',1),(3502,35,'007','sedan',2),(3503,35,'009','mpv',3),(3504,35,'X','suv',4),(3505,35,'Y','suv',5),(3506,35,'001 FR','sedan',6),(3507,35,'007 Plus','sedan',7),(3508,35,'009 GT','mpv',8),(3509,35,'7X','suv',9),(3510,35,'MIX','mpv',10),
(3601,36,'X','suv',1),(3602,36,'Z','sedan',2),(3603,36,'Y','suv',3),(3604,36,'Z+','sedan',4),(3605,36,'S','sedan',5),(3606,36,'1','suv',6),(3607,36,'2','suv',7),(3608,36,'3','suv',8),(3609,36,'4','suv',9),(3610,36,'Vision','suv',10),
(3701,37,'11','sedan',1),(3702,37,'12','sedan',2),(3703,37,'11 Plus','sedan',3),(3704,37,'12 Plus','sedan',4),(3705,37,'13','sedan',5),(3706,37,'10','suv',6),(3707,37,'GT','sedan',7),(3708,37,'Race','sedan',8),(3709,37,'X','suv',9),(3710,37,'14','suv',10),
(3801,38,'6','sedan',1),(3802,38,'3','sedan',2),(3803,38,'CX-5','suv',3),(3804,38,'2','hatchback',4),(3805,38,'Tribute/CX-7','suv',5),(3806,38,'Premacy','mpv',6),(3807,38,'Lantis','sedan',7),(3808,38,'RX-8','sedan',8),(3809,38,'Atenza','sedan',9),(3810,38,'Axela','sedan',10),
(3901,39,'Swift','hatchback',1),(3902,39,'Vitara','suv',2),(3903,39,'Alto','hatchback',3),(3904,39,'WagonR','hatchback',4),(3905,39,'SX4','suv',5),(3906,39,'Kizashi','sedan',6),(3907,39,'Escudo','suv',7),(3908,39,'Solio','mpv',8),(3909,39,'Every','van',9),(3910,39,'Baleno','hatchback',10);
