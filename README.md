# YubiKey Auth Demo (WebAuthn/FIDO2)

Демо для регистрации и входа касанием YubiKey. Отдельные состояния до/после входа, таймер сессии и показ сырых данных только после успешных действий.

## Требования
- Node.js 18+
- FIDO2/WebAuthn ключ (YubiKey)
- Браузер с WebAuthn (Chrome/Edge/Firefox)

## Запуск локально
```bash
npm install
npm start           # поднимет http://localhost:4000
```
Если нужен другой домен/порт, задайте `.env`:
```
PORT=4000
RP_ID=localhost
ORIGIN=http://localhost:4000
RP_NAME=YubiKey Auth Demo
ATTESTATION=none
```

Продакшн хост: `https://gpt-codex.b244.ru` (RP_ID = gpt-codex.b244.ru). Креды, созданные на другом домене, не подойдут.

## Поток регистрации
1) Вкладка «Регистрация»: вводим username (и display name) → «Зарегистрироваться».  
2) `/api/register/options` → `navigator.credentials.create()` → касание/PIN.  
3) После успеха UI переключается на «Вход». Сырые данные и ответ сервера становятся видимыми.

## Поток входа
1) Вкладка «Вход»: вводим существующий username → «Войти».  
2) `/api/login/options` → `navigator.credentials.get()` → касание/PIN.  
3) При успехе показывается статус online, имя пользователя и таймер до авто-выхода (по cookie maxAge). Кнопки «Войти/Зарегистрироваться» скрываются, остаётся «Выйти».

## Интерфейс
- До входа: форма, выбор режима, таймлайн; данные скрыты.  
- После входа: карточка сессии (online/offline, TTL), кнопки «Выйти», показ сырых данных и ответа сервера после действий.  
- Скрытие/показ карточек данных завязано на результатах регистрации/входа.

## API кратко
- `POST /api/register/options` / `verify`
- `POST /api/login/options` / `verify`
- `GET /api/session` — статус сессии, ttlMs
- `GET /api/settings`, `POST /api/settings/mode`
- `GET /.well-known/webauthn` — rpId/origin метаданные

## Хранилище
JSON-файлы в `data/` (`users.json`, `challenges.json`). При необходимости миграции/очистки — останавливайте PM2 и чистите файлы.

## Полезно знать
- WebAuthn жёстко привязан к RP ID: используйте тот домен, под который регистрировали credential.  
- `NotAllowedError` чаще всего из-за отмены/таймаута диалога или неверного RP.  
- Все статики отдаём с `Cache-Control: no-store` + версионирование `?v=`; при изменении UI делайте hard refresh.
