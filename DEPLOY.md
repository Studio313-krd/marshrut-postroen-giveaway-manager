# Развёртывание

Сайт: https://giveaway.marshrut-postroen.com

Portainer: Stack **marshrut-giveaway**, ID 97, environment 3 на сервере 185.72.147.187

Репозиторий: https://github.com/Studio313-krd/marshrut-postroen-giveaway-manager.git / ветка `refs/heads/main` / файл `docker-compose.yml`

## Конфигурация

Новая версия 4 использует Node.js и FFmpeg, собирает frontend в отдельной стадии Dockerfile и запускается от пользователя `node` / Порт и подключение к прокси сохранены: `9998:4310`, внешняя сеть `${PROXY_NETWORK:-web}`, псевдоним `marshrut-giveaway`

`PUBLIC_URL=https://giveaway.marshrut-postroen.com` разрешает рабочий домен, проверяет Origin запросов и включает Secure cookie за HTTPS-прокси / Произвольные X-Forwarded-Host и X-Forwarded-Proto не используются для доверия запросу

Закрытый внешний том **marshrut-giveaway_reels-data** подключён в `/app/runtime`

```text
participants.json       проверенный список аккаунтов и его SHA-256
state/auth.json         логин, соль и scrypt-хеш пароля
state/settings.json     количество основных и резервных мест
state/draw-*.json        сохранённые результаты
output/*.mp4            готовые видео
output/result-*.json     сведения о результатах
```

Том принадлежит UID/GID 1000 / Он должен быть подготовлен до первого развёртывания / Приложение не подставляет тестовых участников вместо отсутствующего списка

Список можно подготовить скриптом `scripts/import-participants.py`, авторизацию — `scripts/configure-admin.mjs` с паролем из переменной окружения / Передавайте эти файлы в том через защищённое соединение с сервером, без добавления в Git или Docker build context / При переносе существующей установки копируйте её `auth.json`, `draw-*.json`, `settings.json` и видео вместе со списком

Новая версия использует фиксированный проверенный список текущего конкурса / Она не импортирует архив старого менеджера конкурсов и не добавляет загрузку Excel через интерфейс

## Обновление

1. Выполните `npm ci`, `npm test`, `npm run build`, `npm run test:browser` и `docker build -t giveaway-reels:verify .`
2. Сохраните копию закрытого тома / Убедитесь, что менеджер завершил запись
3. Сделайте commit и push в main
4. В Portainer откройте Stack и нажмите **Pull and redeploy** / `pull_policy: build` пересобирает образ из Git
5. Проверьте состояние healthy и `GET /api/health`: `service: giveaway`, `version: 4.0.0`, `ready: true`
6. Проверьте HTTPS, вход, настройки, промпт, инструкцию и скачивание MP4 / Запросы к `/api/state` и видео без сессии должны возвращать 401

Пароль, настройки и выбранные места сохраняются в томе между обновлениями / Серверные сессии завершаются при перезапуске

## Откат к прежнему менеджеру

Предыдущий Git commit: `ae96513667041f7c74e0406dd9727388c47a5dad`

Перед заменой сохранён образ **marshrut-postroen-giveaway:rollback-ae96513** / Старый том **marshrut-giveaway_giveaway-data** остаётся на сервере и не подключается к новой версии

В каталоге `reels-migration-backup` старого тома сохранены согласованная копия SQLite, созданная через `VACUUM INTO`, и прежняя авторизация / Дополнительная локальная копия и исходная конфигурация стека находятся в `.local/deployment-backup` на компьютере развёртывания

Для отката смените Git reference стека на указанный commit и выполните Pull and redeploy / Исходный Compose подключит прежний том, порт и сеть / Не удаляйте ни старый, ни новый том / Если нужен откат без сборки, используйте сохранённый Compose с образом `marshrut-postroen-giveaway:rollback-ae96513`, без `build` и с `pull_policy: never`

Прокси должен разрешать загрузку видео и ожидание FFmpeg / При настройке нового сервера задайте для домена `client_max_body_size 2g` и `proxy_read_timeout 1800s` / Остальные домены и контейнеры при обновлении приложения не изменяются
