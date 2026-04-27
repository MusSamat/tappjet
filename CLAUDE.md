# CLAUDE.md — Tappjet Platform
# Merge of: behavioral guidelines + project-specific rules
# Goal: минимум токенов, максимум точности, ноль галлюцинаций

---

## 0. Перед любым кодом — стоп

Перед реализацией явно назови:
- Что именно ты меняешь и почему
- Какой файл, какая функция, какая строка
- Какие допущения делаешь

Если задача неясна — **спроси один вопрос**. Не угадывай.
Если есть два способа — назови оба, жди выбора.

---

## 1. Стек — не изобретай

### Backend (`/backend`)
```
Node.js 20 LTS + TypeScript (strict: true)
Express.js 4.x          — HTTP сервер
Prisma 5.x              — ORM, все запросы через него
PostgreSQL 16           — единственная БД
Socket.IO 4.x           — WebSocket (отдельный процесс от API)
Zod 3.x                 — валидация входящих данных
jsonwebtoken 9.x        — JWT подпись/верификация
bcrypt 5.x              — хеши паролей и OTP
Pino 9.x                — логирование (JSON, structured)
node-cron 3.x           — cron jobs
axios 1.x               — внешние HTTP запросы
Vitest 1.x              — тесты
```

**Запрещено добавлять без явного запроса:**
- Redis (не в MVP)
- Bull/BullMQ (не в MVP)
- MinIO / S3 SDK (не в MVP)
- Kafka / RabbitMQ (не в MVP)
- любой новый npm пакет

### Mini App (`/mini-app`)
```
React 18 + TypeScript
Vite 5               — сборщик
Zustand              — state management
TanStack Query       — server state + кэш
react-hook-form      — формы
Zod                  — валидация форм
i18next              — локализация (ru | ky)
Tailwind CSS         — стили
axios                — HTTP
socket.io-client     — WebSocket
```

### Flutter (`/mobile`)
```
Flutter 3.x + Dart
Riverpod             — state management
go_router            — навигация
dio + retrofit       — HTTP
socket_io_client     — WebSocket
Hive                 — offline queue + кэш
flutter_secure_storage — токены
easy_localization    — ru | ky
flutter_map          — карты (OpenStreetMap)
image_picker + flutter_image_compress — фото документов
```

---

## 2. Архитектура — не нарушай

```
/backend
  /src
    /routes          — Express роутеры (тонкие, только HTTP)
    /controllers     — входная точка, парсинг req, вызов сервиса
    /services        — бизнес-логика (здесь всё)
    /repositories    — Prisma запросы (только DB, без логики)
    /middleware      — auth, rateLimit, validate
    /lib             — утилиты (jwt, bcrypt, sms, telegram)
    /types           — TypeScript типы
    /jobs            — cron задачи
    /socket          — Socket.IO handlers (отдельный процесс)
  prisma/
    schema.prisma
    migrations/

/mini-app
  /src
    /api             — axios инстанс + все запросы
    /store           — Zustand stores
    /hooks           — кастомные хуки
    /pages           — экраны
    /components      — переиспользуемые компоненты
    /lib             — утилиты (deferredAction, auth, etc.)
    /locales         — ru.json, ky.json

/mobile
  /lib
    /api             — dio клиент + retrofit
    /providers       — Riverpod providers
    /models          — data классы
    /screens         — экраны
    /widgets         — переиспользуемые виджеты
    /l10n            — ru.json, ky.json
```

**Правило слоёв:**
- Route → Controller → Service → Repository
- Service НЕ знает про `req`/`res`
- Repository НЕ содержит бизнес-логику
- Controller НЕ делает прямые Prisma запросы

---

## 3. Работа с кодом — хирургически

**Трогай только то что попросили.**

При редактировании:
- Не улучшай соседний код
- Не рефакторь то что не сломано
- Соблюдай существующий стиль файла
- Если заметил мёртвый код — упомяни, не удаляй

Твои изменения создали orphans → удали их.
Чужие orphans → не трогай.

**Тест:** каждая изменённая строка напрямую связана с задачей.

---

## 4. База данных — правила

```sql
-- Все PK — UUID
id UUID DEFAULT gen_random_uuid() PRIMARY KEY

-- Все timestamps — UTC
created_at TIMESTAMPTZ DEFAULT NOW()

-- Soft delete
deleted_at TIMESTAMPTZ NULL  -- NULL = не удалён

-- Никогда не делай raw SQL если можно через Prisma
-- Никогда не делай N+1 запросы — используй include/select
```

**Race condition на seats_available — всегда SELECT FOR UPDATE:**
```typescript
// ПРАВИЛЬНО
await prisma.$transaction(async (tx) => {
  const trip = await tx.$queryRaw`
    SELECT * FROM trips WHERE id = ${tripId} FOR UPDATE
  `;
  // проверка и обновление внутри транзакции
});

// НЕПРАВИЛЬНО — без блокировки
const trip = await prisma.trip.findUnique({ where: { id: tripId } });
await prisma.trip.update(...); // race condition!
```

---

## 5. Auth — строгие правила

```
Access token:  15 минут, в памяти (не localStorage)
Refresh token: продлевается при активности, разлогин через 30 дней без входа
OTP:           bcrypt(code) в БД, НЕ plain text
SMS:           только при регистрации и смене номера — НИКОГДА при повторном входе
```

**Token Reuse Detection — обязателен:**
```typescript
// При /auth/refresh — если токен уже used_at IS NOT NULL:
// → revoke ALL токены пользователя
// → уведомить пользователя
// → вернуть 401 TOKEN_REUSE_DETECTED
```

**Deferred Action — sessionStorage, TTL 15 минут:**
```typescript
// Ключ: kosho_deferred_action
// При неавторизованном защищённом действии → сохранить → редирект на логин
// После входа → прочитать → выполнить → удалить
```

---

## 6. API — соглашения

```
Base URL:     /api/v1
Авторизация:  Authorization: Bearer <access_token>
Ошибки:       { error: { code: "UPPER_SNAKE", message: "...", message_ky: "..." } }
Пагинация:    cursor-based: ?cursor=xxx&limit=20
Идемпотент:   Idempotency-Key header для POST /trips, POST /bookings
Даты:         ISO 8601 UTC везде
```

**Формат ошибки — всегда так:**
```typescript
// src/lib/errors.ts — используй готовый, не изобретай новый
throw new AppError("SEATS_NOT_AVAILABLE", 409, "Мест больше нет", "Бош орундар жок");
```

---

## 7. Локализация — обязательно

```typescript
// ПРАВИЛЬНО — ключи в файлах
t('trips.create.title')

// НЕПРАВИЛЬНО — хардкод строк
"Создать поездку"

// Структура ключей — макс 3 уровня
// common.buttons.submit
// trips.create.title
// errors.SEATS_NOT_AVAILABLE
```

При добавлении нового текста:
1. Добавь ключ в `locales/ru.json`
2. Добавь ключ в `locales/ky.json` (можно заглушку = ru текст)
3. Используй через `t()`

---

## 8. Тесты — минимально необходимые

**Пиши тест до кода (или сразу после — не через неделю).**

```typescript
// Обязательно тестировать:
// - Happy path основного флоу
// - Race condition (seats_available)
// - Auth middleware (401 без токена, 403 без прав)
// - Rate limiting (429 при превышении)
// - OTP: неверный код, истёкший, превышение попыток

// Не тестировать:
// - Prisma internals
// - Express роутинг
// - Очевидные геттеры/сеттеры
```

---

## 9. Экономия токенов — главное правило

**Не пиши если не просили:**
- Не добавляй комментарии к очевидному коду
- Не пиши README если не просили
- Не создавай типы для одноразовых объектов
- Не добавляй console.log в продакшн код (только Pino)
- Не дублируй типы — переиспользуй Prisma generated types

**Размер функции:**
- Если функция > 50 строк → скорее всего её надо разбить
- Если файл > 200 строк → спроси нужно ли разбивать

**При ответе:**
- Показывай только изменённые части файла (не весь файл)
- Используй `// ... existing code ...` для пропуска
- Если изменение < 10 строк — не нужен diff, просто код

---

## 10. Чеклист перед сдачей кода

```
[ ] TypeScript strict: нет any, нет ts-ignore без объяснения
[ ] Zod валидация на всех входящих данных (Controller уровень)
[ ] Ошибки через AppError (не throw new Error("string"))
[ ] Логирование через Pino (не console.log)
[ ] Новые ключи локализации добавлены в ru.json и ky.json
[ ] Нет прямых Prisma вызовов в Controller (только через Service)
[ ] Транзакция там где нужна атомарность
[ ] Rate limit проверен для новых публичных эндпоинтов
[ ] idempotency_key на POST /trips и POST /bookings
[ ] Тест написан для основного флоу
```

---

## 11. Что НЕ делать никогда

```
❌ prisma.trip.findMany() без WHERE — полный скан таблицы
❌ Хранить OTP plain text — только bcrypt hash
❌ JWT секрет захардкодить — только из process.env
❌ console.log в продакшн коде — только pino logger
❌ any в TypeScript без комментария почему
❌ Новый npm пакет без явного запроса
❌ Менять schema.prisma без создания миграции
❌ Прямой SQL без параметров — SQL injection
❌ sessionStorage для refresh токена — только memory/secure storage
❌ Отправлять SMS при повторном входе — только при регистрации
```

---

## 12. Быстрый справочник команд

```bash
# Backend
cd backend
npx prisma migrate dev --name "описание"   # новая миграция
npx prisma generate                         # regenerate client
npx prisma studio                           # GUI для БД
npm run dev                                 # запуск dev
npm test                                    # тесты

# Mini App
cd mini-app
npm run dev                                 # Vite dev server
npm run build                               # production build

# Flutter
cd mobile
flutter run -d chrome                       # web (для UI разработки)
flutter run -d <device_id>                  # на устройстве
flutter pub get                             # установить зависимости
```
