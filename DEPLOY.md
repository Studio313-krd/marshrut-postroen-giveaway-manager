# Развёртывание для Маршрут-Построен

Адрес: https://giveaway.marshrut-postroen.com · сервер 185.72.147.187.

На сервере уже используется Nginx Proxy Manager, сеть `web`, порты 80 и 443. Новый Caddy не требуется. Приложение не публикует собственный порт наружу, доступно прокси по имени `marshrut-giveaway:4310`.

## Portainer

1. DNS: A-запись `giveaway.marshrut-postroen.com` → `185.72.147.187`.
2. Stacks → Add stack → имя `marshrut-giveaway` → Repository.
3. Repository URL: `https://github.com/Studio313-krd/marshrut-postroen-giveaway-manager.git`, reference `refs/heads/main`, Compose path `docker-compose.yml`.
4. Environment variables: `PROXY_NETWORK=web` и `ADMIN_PASSWORD_HASH` из созданного локально `data/auth.json` (поле passwordHash). Пароль не отправляйте в GitHub. Альтернатива: случайный `SETUP_TOKEN` минимум 32 символа для первичной настройки через форму. Не задавайте общий пароль по умолчанию.
5. Deploy the stack. Первая сборка скачивает браузер Chromium и может занять несколько минут.
6. Nginx Proxy Manager → Add Proxy Host: домен `giveaway.marshrut-postroen.com`, scheme `http`, Forward Hostname `marshrut-giveaway`, port `4310`. Advanced: `client_max_body_size 25m;` и `proxy_read_timeout 120s;`. SSL → выпустить сертификат Let's Encrypt, Force SSL. Не включайте Cache Assets для API.
7. Откройте HTTPS-адрес и войдите как `admin`. Если выбран SETUP_TOKEN: единожды откройте `https://giveaway.marshrut-postroen.com/#setup=ЗНАЧЕНИЕ_ТОКЕНА` и создайте пароль. Ссылка содержит секрет, не публикуйте её.

## Данные и обновления

База SQLite, хеш пароля и профиль Instagram хранятся в томе `marshrut-giveaway_giveaway-data`. Не удаляйте том при обновлении. Для резервной копии используйте SQLite backup / VACUUM INTO либо копирование всего тома при остановленном приложении. Не копируйте только основной sqlite-файл при работающем WAL.

Новые версии: commit/push → Portainer → stack → Pull and redeploy. `pull_policy: build` пересобирает приложение. Сессии менеджеров после перезапуска завершаются; данные и результаты остаются. Перед обновлением сохраните резервную копию, откат — на предыдущий Git commit с тем же томом.

Проверка: `/healthz` возвращает `{ok:true}`, `/api/contests` без входа возвращает 401. Данные выгрузок также доступны только после авторизации. Индексация отключена заголовком X-Robots-Tag и robots.txt.

## Instagram на сервере

Сбор работает в headless Chromium, прокручивает внутреннее окно комментариев, сохраняет порции и раскрывает доступные ответы. Доступ с IP дата-центра может отличаться от локального. При ограничении или требовании входа сервис показывает неполноту и позволяет загрузить JSON из локального сборщика:

```powershell
npm run collect -- --url https://www.instagram.com/reel/CODE/ --out comments.json
```

В открытом локальном Chrome пользователь самостоятельно входит в Instagram, если это требуется. Затем нажимает Enter в терминале. Профиль и cookies не добавляются в репозиторий.

## Локальный Docker

```powershell
npm ci
node scripts/setup.mjs --env-only
docker compose -f compose.local.yml up -d --build
node scripts/setup.mjs --docker
```

Адрес: http://127.0.0.1:4311. Том `giveaway-local-data` отделён от обычной локальной папки `data`. `.env` локальный и исключён из Git и Docker build context. `.env.example` содержит только шаблон.
