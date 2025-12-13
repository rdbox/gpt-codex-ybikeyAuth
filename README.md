# YubiKey Auth Demo (WebAuthn/FIDO2)

Демо‑микросервис для регистрации и входа с аппаратным ключом YubiKey через WebAuthn/FIDO2. Показывает весь поток: challenge → WebAuthn → attestation/assertion → проверка на сервере, с визуализацией сырых данных.

## Что нужно
- Node.js 18+
- Аппаратный ключ с поддержкой FIDO2/WebAuthn (YubiKey)
- Браузер с поддержкой WebAuthn (Chrome/Edge/Firefox)

## Установка
```bash
git clone git@github.com-rdbox:rdbox/gpt-codex.git
cd gpt-codex
npm install
```

## Запуск
- Сервер (Fastify + @simplewebauthn/server, статика SPA):
  ```bash
  npm start
  ```
- Открыть фронтенд: `http://localhost:3000`

## Конфигурация
Настройте переменные в `.env` (необязательно, есть значения по умолчанию):
```
PORT=3000
RP_ID=localhost
RP_NAME=YubiKey Auth Demo
ORIGIN=http://localhost:3000
ATTESTATION=none   # direct для показа данных устройства
```

## Флоу регистрации
1. Введите username → «Зарегистрироваться».
2. Браузер получает challenge (`/api/register/options`) и вызывает `navigator.credentials.create()`.
3. Коснитесь ключа. UI покажет `clientDataJSON`, `attestationObject`, флаги и данные, которые уходят на сервер.
4. Сервер валидирует (challenge, rpId, origin, attestation) и сохраняет credential (publicKey, credentialId, signCount).

## Флоу входа
1. Введите существующий username → «Войти с YubiKey».
2. Браузер получает challenge (`/api/login/options`) и вызывает `navigator.credentials.get()`.
3. Коснитесь ключа — получим assertion (`authenticatorData`, `signature`).
4. Сервер проверяет подпись, rpIdHash, origin, рост `signCount`; при успехе вход завершён.

## API (кратко)
- `POST /api/register/options { username }` → PublicKeyCredentialCreationOptions
- `POST /api/register/verify { username, attestationResponse }` → { verified, registrationInfo }
- `POST /api/login/options { username }` → PublicKeyCredentialRequestOptions
- `POST /api/login/verify { username, assertionResponse }` → { verified, authenticationInfo }
- `GET /api/users/:username` → список credential и signCount (демо)

## Хранилище
In-memory (Map). Данные живут, пока работает сервер. Структура пользователя: username, userId, credentials[{ credentialID, publicKey, counter, deviceType, backedUp, aaguid, transports }].

## Замечания по безопасности
- Для продакшна нужен HTTPS (WebAuthn этого требует); localhost работает на HTTP.
- Проверяем `origin`, `rpId`, одноразовый `challenge`, рост `signCount`.
- Username ограничен до `a-z0-9_-` (1..32) для демо.

## Типичные ошибки
- `NotAllowedError`: пользователь отменил диалог или истёк таймаут.
- `InvalidStateError` при регистрации: credential уже зарегистрирован.
- `rpId`/`origin` mismatch: проверьте `.env` и домен страницы.

## Разработка
Проект без сборки фронта (простая статика). Всё лежит в `public/`, бек — в `server/`. Если нужно расширить, можно добавить Vite/React поверх текущей структуры.
