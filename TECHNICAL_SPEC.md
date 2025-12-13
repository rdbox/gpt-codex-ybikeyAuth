# Техническое задание
## WebAuthn/FIDO2 аутентификация с YubiKey

---

## 1. Общее описание

**Цель:** Разработать веб-приложение для демонстрации passwordless аутентификации с использованием аппаратных ключей YubiKey через протокол WebAuthn/FIDO2.

**Результат:** Пользователи могут регистрироваться и входить в систему касанием YubiKey, без паролей.

---

## 2. Технологический стек

| Компонент | Технология | Версия |
|-----------|------------|--------|
| Backend | Node.js + Express | ^4.18 |
| WebAuthn | @simplewebauthn/server | ^9.0.3 |
| Сессии | express-session | ^1.17.3 |
| CORS | cors | ^2.8.5 |
| Frontend | Vanilla JS + CSS | - |
| Хранение данных | JSON файлы | - |

---

## 3. Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                        БРАУЗЕР                               │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────┐  │
│  │ index.html  │    │ webauthn.js  │    │  styles.css    │  │
│  │ (UI)        │◄───┤ (логика)     │    │  (стили)       │  │
│  └─────────────┘    └──────┬───────┘    └────────────────┘  │
└────────────────────────────┼────────────────────────────────┘
                             │ fetch API
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                     EXPRESS SERVER                           │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                     index.js                            │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │ │
│  │  │ Registration │  │ Authentication│  │  Settings    │  │ │
│  │  │ /register/*  │  │ /login/*     │  │  /settings/* │  │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                           │                                  │
│  ┌────────────────────────▼───────────────────────────────┐ │
│  │                    config.js                            │ │
│  │     Режимы: touch_only | pin_required | preferred       │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                     DATA (./data/)                           │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐   │
│  │ users.json   │  │ challenges.json  │  │   .lock      │   │
│  │ (credentials)│  │ (temp challenges)│  │ (sync)       │   │
│  └──────────────┘  └──────────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. API Endpoints

### 4.1 Регистрация

**POST `/api/register/options`**
```javascript
// Request
{ "username": "string", "displayName": "string" }

// Response
{
  "challenge": "base64url",
  "rp": { "name": "string", "id": "string" },
  "user": { "id": "base64url", "name": "string", "displayName": "string" },
  "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }, ...],
  "excludeCredentials": [...],
  "authenticatorSelection": {
    "authenticatorAttachment": "cross-platform",
    "userVerification": "discouraged|required|preferred",
    "residentKey": "discouraged|required"
  }
}
```

**POST `/api/register/verify`**
```javascript
// Request
{
  "username": "string",
  "credential": {
    "id": "string",
    "rawId": "base64url",
    "type": "public-key",
    "response": {
      "clientDataJSON": "base64url",
      "attestationObject": "base64url"
    }
  }
}

// Response
{ "verified": true, "username": "string" }
```

### 4.2 Аутентификация

**POST `/api/login/options`**
```javascript
// Request
{ "username": "string" }

// Response
{
  "challenge": "base64url",
  "rpId": "string",
  "allowCredentials": [
    { "id": "base64url", "type": "public-key", "transports": ["usb", "nfc"] }
  ],
  "userVerification": "discouraged|required|preferred"
}
```

**POST `/api/login/verify`**
```javascript
// Request
{
  "username": "string",
  "credential": {
    "id": "string",
    "rawId": "base64url",
    "type": "public-key",
    "response": {
      "clientDataJSON": "base64url",
      "authenticatorData": "base64url",
      "signature": "base64url",
      "userHandle": "base64url|null"
    }
  }
}

// Response
{
  "verified": true,
  "username": "string",
  "displayName": "string",
  "technicalInfo": {
    "credentialId": "string",
    "counter": 123,
    "transports": ["usb", "nfc"],
    "userVerified": false,
    "rpId": "localhost",
    "origin": "http://localhost:3000"
  }
}
```

### 4.3 Настройки

**GET `/api/settings`**
```javascript
// Response
{
  "modes": [
    { "id": "touch_only", "name": "Только касание", "userVerification": "discouraged" },
    { "id": "pin_required", "name": "PIN обязателен", "userVerification": "required" },
    { "id": "preferred", "name": "Авто", "userVerification": "preferred" }
  ],
  "protocols": [
    { "id": "webauthn", "name": "WebAuthn/FIDO2", "enabled": true },
    { "id": "u2f", "name": "FIDO U2F", "enabled": true }
  ],
  "currentMode": "touch_only",
  "currentProtocol": "webauthn",
  "canChangeMode": true,
  "isLocked": false
}
```

**POST `/api/settings/mode`**
```javascript
// Request
{ "mode": "touch_only|pin_required|preferred" }

// Response
{ "success": true, "currentMode": "string" }
```

### 4.4 Пользователи

**GET `/api/users`**
```javascript
// Response
[
  { "username": "string", "displayName": "string", "credentialsCount": 1 }
]
```

**GET `/api/user`** — текущий пользователь сессии

**POST `/api/logout`** — выход из системы

---

## 5. Структура данных

### 5.1 users.json
```javascript
{
  "username": {
    "id": "base64",           // 16 случайных байт
    "username": "string",
    "displayName": "string",
    "credentials": [
      {
        "credentialID": "base64url",
        "credentialPublicKey": "base64",
        "counter": 0,
        "transports": ["usb", "nfc"],
        "createdAt": "ISO8601",
        "lastUsed": "ISO8601"
      }
    ]
  }
}
```

### 5.2 challenges.json
```javascript
{
  "username": "challenge_string"   // Временные challenge для верификации
}
```

---

## 6. Режимы аутентификации

| Режим | userVerification | Поведение |
|-------|------------------|-----------|
| `touch_only` | `discouraged` | Только касание, PIN не запрашивается |
| `pin_required` | `required` | Обязательно PIN + касание |
| `preferred` | `preferred` | PIN если настроен на ключе, иначе касание |

---

## 7. Клиентская логика (webauthn.js)

### 7.1 Основные функции

```javascript
// Регистрация
async function register() {
  // 1. Получить options с сервера (POST /api/register/options)
  // 2. Преобразовать challenge и user.id из base64url в ArrayBuffer
  // 3. Показать модальное окно "Коснитесь YubiKey"
  // 4. Вызвать navigator.credentials.create({ publicKey: options })
  // 5. Преобразовать ответ обратно в base64url
  // 6. Отправить на сервер (POST /api/register/verify)
  // 7. При успехе — показать сообщение, переключить на вход
}

// Аутентификация
async function login() {
  // 1. Получить options с сервера (POST /api/login/options)
  // 2. Преобразовать challenge и allowCredentials[].id
  // 3. Показать модальное окно
  // 4. Вызвать navigator.credentials.get({ publicKey: options })
  // 5. Преобразовать ответ в base64url
  // 6. Отправить на сервер (POST /api/login/verify)
  // 7. При успехе — показать dashboard с техническими данными
}
```

### 7.2 Утилиты преобразования

```javascript
// ArrayBuffer → base64url
function bufferToBase64URL(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const byte of bytes) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// base64url → ArrayBuffer
function base64URLToBuffer(base64URL) {
  const base64 = base64URL.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
```

---

## 8. Безопасность

### 8.1 Обязательные требования

| Требование | Реализация |
|------------|------------|
| HTTPS или localhost | WebAuthn работает только на secure context |
| rpID = hostname | `localhost` для разработки |
| Origin validation | Сервер проверяет origin при верификации |
| Challenge — одноразовый | Генерируется для каждой операции, удаляется после использования |
| Counter validation | Защита от клонирования ключа |

### 8.2 Конфигурация сессий
```javascript
session({
  secret: crypto.randomBytes(32).toString('hex'),  // Случайный при старте
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 24*60*60*1000 }
})
```

### 8.3 Lock-файл для конкурентного доступа
```javascript
function acquireLock(timeout = 5000) {
  // Ожидание освобождения lock-файла
  // Stale lock (>30 сек) удаляется автоматически
}
```

---

## 9. UI/UX требования

### 9.1 Страницы

1. **Экран аутентификации**
   - Табы: Регистрация / Вход
   - Поля ввода: username, displayName (только для регистрации)
   - Кнопки с иконками

2. **Dashboard (после входа)**
   - Приветствие пользователя
   - Статус аутентификации
   - Техническая информация (сворачиваемая секция)
   - Кнопка выхода

3. **Боковая панель**
   - Настройки режима (radio buttons)
   - Выбор протокола
   - Информация о ключе
   - Статистика
   - История действий

4. **Модальное окно YubiKey**
   - Анимация ожидания
   - Инструкция "Коснитесь ключа"
   - Индикатор загрузки

### 9.2 Цветовая схема (светлая тема)

| Элемент | Цвет |
|---------|------|
| Primary | #2563eb (синий) |
| Success | #10b981 (зелёный) |
| Error | #ef4444 (красный) |
| Warning | #f59e0b (оранжевый) |
| Background | #ffffff / #f8fafc |
| Text | #1e293b |

---

## 10. Переменные окружения

| Переменная | Описание | Значение по умолчанию |
|------------|----------|----------------------|
| `PORT` | Порт сервера | 3000 |
| `RP_ID` | Relying Party ID | localhost |
| `AUTH_MODE` | Режим по умолчанию | touch_only |
| `AUTH_PROTOCOL` | Протокол | webauthn |
| `LOCK_SETTINGS` | Заблокировать настройки | false |
| `SESSION_SECRET` | Секрет сессии | auto-generated |

---

## 11. Структура файлов

```
webauthn-yubikey-demo/
├── server/
│   ├── index.js          # Express сервер, API endpoints
│   └── config.js         # Конфигурация режимов и настроек
├── public/
│   ├── index.html        # HTML разметка
│   ├── styles.css        # CSS стили
│   └── webauthn.js       # Клиентская логика WebAuthn
├── data/                 # Создаётся автоматически
│   ├── users.json        # Данные пользователей
│   ├── challenges.json   # Активные challenges
│   └── .lock             # Lock-файл
├── package.json          # Зависимости npm
├── CLAUDE.md             # Инструкция для разработки
└── TECHNICAL_SPEC.md     # Это техническое задание
```

---

## 12. Этапы реализации

### Этап 1: Backend

1. Инициализация проекта (npm init, установка зависимостей)
2. Express сервер + middleware (cors, json, session)
3. Система персистентности (loadUsers, saveUsers, loadChallenges, saveChallenges)
4. Lock-файл для синхронизации (acquireLock, releaseLock)
5. API регистрации: POST `/api/register/options`, POST `/api/register/verify`
6. API аутентификации: POST `/api/login/options`, POST `/api/login/verify`
7. API настроек: GET `/api/settings`, POST `/api/settings/mode`
8. API пользователей: GET `/api/users`, GET `/api/user`, POST `/api/logout`

### Этап 2: Frontend

1. HTML разметка (формы регистрации/входа, dashboard, модальное окно)
2. CSS стили (светлая тема, адаптивность, анимации)
3. webauthn.js — основные функции register() и login()
4. Утилиты преобразования base64url ↔ ArrayBuffer
5. Управление настройками через UI
6. История действий (addHistoryItem, renderHistory)
7. Отображение технической информации после входа

### Этап 3: Тестирование

1. Проверка работы на localhost:3000
2. Тест регистрации нового пользователя с YubiKey
3. Тест входа (режим touch_only)
4. Тест входа (режим pin_required)
5. Тест входа (режим preferred)
6. Тест смены настроек через UI
7. Проверка persistence — перезапуск сервера, данные сохранены
8. Тест с несколькими пользователями

---

## 13. Требования к оборудованию и ПО

### Аппаратные ключи (поддерживаемые)
- YubiKey 5 NFC
- YubiKey 5C
- YubiKey 5 Nano
- Любой FIDO2-совместимый ключ

### Браузеры
- Google Chrome 67+
- Mozilla Firefox 60+
- Microsoft Edge 79+
- Safari 14+ (macOS)

### Серверное окружение
- Node.js 16+
- npm 8+

---

## 14. Запуск проекта

### Установка
```bash
cd C:/Users/admin/Desktop/claude-projects/webauthn-yubikey-demo
npm install
```

### Запуск
```bash
node server/index.js
```

### Открыть в браузере
```
http://localhost:3000
```

**Важно:** Использовать именно `localhost`, не IP-адрес. WebAuthn требует secure context.

---

## 15. Возможные улучшения (roadmap)

1. **База данных** — заменить JSON на SQLite/PostgreSQL
2. **HTTPS** — добавить SSL сертификаты для production
3. **Discoverable credentials** — вход без ввода username
4. **Множественные ключи** — управление несколькими YubiKey на аккаунт
5. **Аудит** — логирование всех операций
6. **Rate limiting** — защита от брутфорса
7. **2FA fallback** — резервные коды восстановления

---

*Документ создан: 2024-12-13*
*Версия: 1.0*
