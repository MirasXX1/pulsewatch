# Mac M1: диагностика и запуск

Проверка 24 октября 2026, macOS 26.3.1, `uname -m` → `arm64`.

| Компонент | Найдено | Действие |
| --- | --- | --- |
| Homebrew | `/opt/homebrew/bin/brew` | Сохранить |
| Docker Desktop / CLI | Не найдены | Установить Docker Desktop для Apple Silicon |
| Java 21 | Не найдена; имеются Oracle JDK 25 и 26 ARM64 | Добавить Temurin 21, сохранить существующие JDK |
| Maven | 3.9.11 внутри IntelliJ IDEA | Использовать существующий Maven через launcher |
| Node.js / npm | 24.9.0 / 11.6.0, ARM64 | Сохранить |
| Локальный PostgreSQL | Уже слушает `127.0.0.1:5432` / `[::1]:5432` | Сохранить, для Docker PulseWatch использовать `5433` |

Порт `5433` на момент проверки свободен. В `compose.yaml`, `.env.example` и настройках backend согласован `127.0.0.1:5433` для БД проекта. Если у вас уже есть `.env` со старым `DB_URL` на `5432`, не перезаписывайте файл: сохраните его копию и укажите `POSTGRES_PORT=5433`, `DB_URL=jdbc:postgresql://127.0.0.1:5433/pulsewatch`.

Maven расположен по пути `/Applications/IntelliJ IDEA.app/Contents/plugins/maven/lib/maven3/bin/mvn`. Его запуск по полному пути прошёл; отдельная команда `mvn` отсутствует в PATH. Launcher умеет использовать этот Maven, включая пробелы в пути. Если IntelliJ перемещён/удалён и другого Maven нет, он сообщит об этом; тогда отдельно потребуется `brew install maven`.

## Почему появляется compdef

В текущем `~/.zshrc`, строка 9:

```zsh
source <(ng completion script)
```

Angular CLI генерирует скрипт, в строке 25 которого вызывается `compdef`. Но `compinit` до этого не запускался. `/dev/fd/13` — временный файловый дескриптор process substitution, а не файл, который нужно редактировать. Номер дескриптора может отличаться.

Проверено без изменения домашней конфигурации: после `autoload -Uz compinit; compinit -D` загрузка Angular completion проходит, `compdef` определён как функция. `-D` использован только для диагностического запуска, чтобы не создавать `.zcompdump`.

Исходный файл также скопирован в `.local/macos/zshrc.original` проекта; `.local/` исключён из Git. Домашние `.zshrc` и `.zprofile` агент не менял.

Минимальное исправление:

```zsh
if (( ! $+functions[compdef] )); then
  autoload -Uz compinit
  compinit
fi
if (( $+commands[ng] )); then
  source <(ng completion script)
fi
```

Из корня проекта, в обычном Terminal:

```bash
python3 scripts/fix-zsh-completion.py
```

Это только предварительный diff и проверка синтаксиса. Применение:

```bash
python3 scripts/fix-zsh-completion.py --apply
```

Сначала создаётся `~/.zshrc.pulsewatch-backup-<UTC>-<PID>`, и только после успешного копирования атомарно заменяется `.zshrc`. Другие настройки, включая Flutter и aliases, сохраняются. Повторный запуск исправление не дублирует. Скрипт выводит точную команду восстановления из созданной копии. Откройте новую вкладку Terminal; ошибка `compdef` должна исчезнуть.

## Установка только недостающего

```bash
cd /Users/mirasshokybay/Desktop/uptime-monitor
bash scripts/setup-mac.sh
```

Скрипт проверяет наличие компонентов и использует нативный Homebrew `/opt/homebrew`. Для отсутствующих компонентов команды такие:

```bash
brew install --cask temurin@21
brew install --cask docker-desktop
```

Temurin устанавливается отдельным ARM64 JDK, без замены Node/Maven и без переключения системной Java 26. Перед установщиками скрипт резервирует существующие `.zshrc` и `.zprofile`, поскольку установщик Docker может настроить CLI PATH. Автообновление Homebrew на время выполнения отключено. Если Homebrew сам требует обновления метаданных, выполните `brew update` в обычном Terminal и повторите setup; `brew upgrade` для проекта не требуется.

Ручные шаги:

1. Если Java installer запросит пароль администратора, введите пароль учётной записи Mac. В Terminal символы пароля не отображаются.
2. Docker Desktop откроется автоматически; если нет — Finder → Applications → Docker, либо `open -a Docker`.
3. Подтвердите системное «Открыть», если появится; примите условия Docker и завершите стартовую настройку. При запросе установки privileged helper подтвердите системный диалог, если выбранный режим настройки его требует.
4. Дождитесь **Engine running**. Если CLI не найден в новой вкладке, launcher всё равно проверяет `~/.docker/bin` и `/Applications/Docker.app/Contents/Resources/bin`; вручную для текущей вкладки: `export PATH="$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"`.
5. `bash scripts/run-local.sh check` должен показать Java 21, Maven, Node, Compose и доступный Docker Engine.

Rosetta для данного проекта с нативными ARM64 компонентами не требуется.

## Запуск и проверка

Из корня проекта, после готовности Docker:

```bash
bash scripts/run-local.sh verify
bash scripts/run-local.sh backend
```

Во второй вкладке Terminal, из корня проекта:

```bash
bash scripts/run-local.sh frontend
```

В третьей вкладке:

```bash
bash scripts/run-local.sh smoke
```

Откройте http://127.0.0.1:3000. Вручную проверьте добавление сайта, страницу истории, `Check now`, отмену удаления и подтверждение удаления. `verify` включает PostgreSQL integration tests; `smoke` проверяет реальные HTTP-ответы, но не заменяет браузерную проверку.

## Ограничения текущей сессии агента

Сессия разрешает запись только в проект и временные папки. Из неё нельзя установить приложения в `/Applications`, JDK в `/Library`, изменить домашнюю shell-конфигурацию или разрешить системные диалоги. Запрос к Maven Central также завершился `Could not resolve host`. Пробный запуск Next.js блокируется запретом sandbox на bind локального порта. Поэтому установку и полный запуск нельзя честно отметить завершёнными до ручного выполнения шагов выше вне sandbox.

Источники: [Temurin 21 Homebrew cask](https://formulae.brew.sh/cask/temurin@21), [Docker Desktop Homebrew cask](https://formulae.brew.sh/cask/docker-desktop), [установка Docker Desktop на Mac](https://docs.docker.com/desktop/setup/install/mac-install/), [инициализация completion в zsh](https://zsh.sourceforge.io/Doc/Release/Completion-System.html#Initialization).
