"""
Приём заявок с сайта и отправка их в Telegram.

Зачем отдельный сервер: сайт на GitHub Pages — статический, его код видит любой
посетитель. Если положить токен бота прямо в JavaScript, токен украдут и будут
слать спам от имени бота. Поэтому заявку принимает этот маленький сервер:
токен хранится только у него, в файле .env.

Как работает:
    1. Посетитель отправляет форму — сайт делает POST-запрос на /api/lead с JSON.
    2. Сервер проверяет данные, защищается от спама и собирает текст сообщения.
    3. Сообщение уходит в чат менеджеров через Telegram Bot API (метод sendMessage).

Локальный запуск:
    pip install -r requirements.txt
    cp .env.example .env            # впишите токен бота и id чата
    flask --app app run --port 5000

На сервере:
    gunicorn -w 2 -b 0.0.0.0:8000 app:app

Адрес приёма заявок (его нужно вписать в assets/js/config.js → lead.endpoint):
    https://ваш-сервер/api/lead
"""
import html                      # экранирование текста для Telegram (parse_mode=HTML)
import json                      # чтение и запись JSON
import os                        # переменные окружения и пути к файлам
import time                      # текущее время для ограничения частоты заявок
import urllib.error              # ошибки сетевых запросов
import urllib.request            # запрос к Telegram без сторонних библиотек
from collections import defaultdict, deque  # словарь со значением по умолчанию и очередь
from datetime import datetime, timezone      # отметка времени согласия

from flask import Flask, jsonify, request    # веб-фреймворк: приложение, JSON-ответ, данные запроса


def load_env(path=".env"):
    """Читает файл .env рядом с app.py и кладёт значения в переменные окружения.

    Формат строк: КЛЮЧ=значение. Пустые строки и строки с # пропускаются.
    Обходимся без библиотеки python-dotenv, чтобы было меньше зависимостей.
    """
    # Полный путь к .env: папка этого файла + имя .env
    full = os.path.join(os.path.dirname(os.path.abspath(__file__)), path)
    if not os.path.exists(full):  # файла нет — значит, настройки заданы в окружении сервера
        return
    with open(full, encoding="utf-8") as f:
        for line in f:
            line = line.strip()  # убираем пробелы и перенос строки
            if not line or line.startswith("#") or "=" not in line:
                continue  # пустая строка, комментарий или строка без «=» — пропускаем
            key, value = line.split("=", 1)  # делим по первому «=»: в значении «=» тоже бывает
            # setdefault — не перезаписываем переменную, если она уже задана в окружении
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env()  # читаем .env сразу при запуске

# Настройки из окружения (или из .env)
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")   # токен бота от @BotFather
CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")       # куда слать заявки: чат или группа менеджеров
TELEGRAM_API = os.environ.get("TELEGRAM_API", "https://api.telegram.org")  # адрес API (в тестах подменяется)
# Сайты, с которых разрешено отправлять заявки. «*» — с любых (удобно для проверки, но не для боевого сайта)
ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
RATE_LIMIT = int(os.environ.get("RATE_LIMIT", "5"))      # заявок с одного адреса...
RATE_WINDOW = int(os.environ.get("RATE_WINDOW", "600"))  # ...за 10 минут (600 секунд)

app = Flask(__name__)  # само веб-приложение
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024  # заявка — это несколько килобайт; всё, что больше 32 КБ, отклоняем

if os.environ.get("TRUST_PROXY") == "1":
    # Сервер стоит за nginx или другим прокси: настоящий IP посетителя приходит в заголовке X-Forwarded-For.
    # ProxyFix подставляет его в request.remote_addr — иначе у всех будет IP прокси и лимит сработает на всех сразу
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)

# Журнал заявок по IP: для каждого адреса — очередь времён последних заявок.
# defaultdict(deque) сам создаёт пустую очередь для нового адреса.
# Хранится в памяти процесса: после перезапуска сервера обнуляется, этого достаточно против спама
_hits = defaultdict(deque)

# Человеческие подписи для значений из формы
CHANNELS = {"phone": "звонок", "telegram": "Telegram", "email": "почта"}
WHENS = {"asap": "как можно скорее", "morning": "утром", "day": "днём", "weekend": "в выходной"}


def origin_allowed(origin):
    """Разрешён ли сайт, с которого пришёл запрос (заголовок Origin)."""
    if "*" in ALLOWED_ORIGINS:
        return True
    return (origin or "").rstrip("/") in ALLOWED_ORIGINS


@app.after_request
def add_cors(resp):
    """Добавляет к каждому ответу заголовки CORS.

    Сайт (username.github.io) и сервер живут на разных адресах. Браузер разрешит
    сайту прочитать ответ сервера, только если сервер явно скажет «этому сайту можно».
    """
    origin = request.headers.get("Origin", "")  # с какого сайта пришёл запрос
    if origin and origin_allowed(origin):
        resp.headers["Access-Control-Allow-Origin"] = "*" if "*" in ALLOWED_ORIGINS else origin
        resp.headers["Vary"] = "Origin"  # ответ зависит от Origin — кэши не должны его смешивать
        resp.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
        resp.headers["Access-Control-Max-Age"] = "86400"  # браузер может сутки не переспрашивать разрешение
    return resp


def too_many(ip):
    """True, если с этого адреса уже было RATE_LIMIT заявок за последние RATE_WINDOW секунд."""
    now = time.time()
    hits = _hits[ip]
    # Выкидываем из очереди старые заявки, которые уже вышли за окно
    while hits and now - hits[0] > RATE_WINDOW:
        hits.popleft()
    if len(hits) >= RATE_LIMIT:
        return True  # лимит исчерпан
    hits.append(now)  # запоминаем эту заявку
    return False


def clip(value, limit):
    """Строка без пробелов по краям и не длиннее limit символов (None → пустая строка)."""
    return str(value or "").strip()[:limit]


def money(value):
    """1490000 → «1 490 000 ₽». Не число — пустая строка."""
    try:
        return f"{int(value):,}".replace(",", " ") + " ₽"  # f"{x:,}" ставит запятые между разрядами — меняем на пробелы
    except (TypeError, ValueError):
        return ""


def build_message(d):
    """Собирает текст сообщения для Telegram из данных заявки.

    Telegram получает текст с разметкой HTML (жирный шрифт через <b>).
    Всё, что ввёл посетитель, экранируем: иначе символы < и > сломают разметку,
    а злоумышленник сможет вставить свою ссылку.
    """
    e = lambda v: html.escape(str(v), quote=False)  # короткое имя для экранирования
    rows = ["<b>Заявка с сайта</b>",
            f"Имя: {e(clip(d.get('name'), 80))}",
            f"Телефон: {e(clip(d.get('phone'), 32))}"]
    tg = clip(d.get("telegram"), 32).lstrip("@")  # ник без @
    if tg:
        rows.append(f"Telegram: @{e(tg)}")
    email = clip(d.get("email"), 120)
    if email:
        rows.append(f"Почта: {e(email)}")
    # Способ и время связи берём только из известных значений, чужой текст сюда не попадёт
    channel = CHANNELS.get(d.get("channel"), "звонок")
    when = WHENS.get(d.get("when"), "как можно скорее")
    rows.append(f"Связаться: {channel}, {when}")
    message = clip(d.get("message"), 1000)
    if message:
        rows.append(f"Комментарий: {e(message)}")

    est = d.get("estimate")  # расчёт из калькулятора, если посетитель его приложил
    if isinstance(est, dict):
        rows.append("")  # пустая строка — отделяем расчёт от контактов
        summary = clip(est.get("summary"), 200)
        date = clip(est.get("date"), 20)
        rows.append(f"<b>Расчёт:</b> {e(summary)}" + (f", {e(date)}" if date else ""))
        low, high = money(est.get("low")), money(est.get("high"))
        if low and high:
            rows.append(f"Вилка: {low.replace(' ₽', '')} – {high} без НДС")
        vat = est.get("vat")
        if isinstance(vat, dict) and money(vat.get("low")):
            rows.append(f"{e(clip(vat.get('label'), 20))}: {money(vat.get('low')).replace(' ₽', '')} – {money(vat.get('high'))}")
        lines = est.get("lines")  # статьи сметы
        if isinstance(lines, list):
            for line in lines[:30]:  # не больше 30 строк — защита от слишком длинных сообщений
                if isinstance(line, dict):
                    rows.append(f"• {e(clip(line.get('title'), 80))} — {money(line.get('sum'))}")
        link = clip(est.get("link"), 600)
        if link.startswith(("http://", "https://")):  # пропускаем только настоящие ссылки
            rows.append(f"Ссылка на расчёт: {e(link)}")

    # Отметка времени согласия на обработку данных: пригодится, если спросят, когда его дали
    stamp = datetime.now(timezone.utc).strftime("%d.%m.%Y %H:%M UTC")
    rows.append("")
    rows.append(f"Согласие на обработку персональных данных получено: {stamp}")
    return "\n".join(rows)[:4000]  # лимит Telegram — 4096 символов в сообщении


def send_to_telegram(text):
    """Отправляет сообщение в чат менеджеров. True — Telegram принял сообщение."""
    url = f"{TELEGRAM_API}/bot{BOT_TOKEN}/sendMessage"  # метод Bot API для отправки сообщения
    body = json.dumps({"chat_id": CHAT_ID, "text": text, "parse_mode": "HTML",
                       "disable_web_page_preview": True}).encode("utf-8")  # без превью ссылки на расчёт
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:  # ждём ответа не дольше 10 секунд
            return bool(json.load(resp).get("ok"))  # Telegram отвечает {"ok": true, ...}
    except (urllib.error.URLError, ValueError, TimeoutError):
        # Сеть недоступна, неверный токен или Telegram ответил ошибкой — пишем в журнал сервера
        app.logger.exception("Не удалось отправить заявку в Telegram")
        return False


@app.route("/api/lead", methods=["POST", "OPTIONS"])
def lead():
    """Приём заявки. Отвечает JSON: {"ok": true} или {"ok": false, "error": "причина"}."""
    if request.method == "OPTIONS":
        # Предварительный запрос браузера (CORS preflight): «можно ли отправить POST с JSON?»
        # Заголовки разрешения добавит add_cors, тело ответа не нужно
        return "", 204
    origin = request.headers.get("Origin")
    if origin and not origin_allowed(origin):
        return jsonify(ok=False, error="origin"), 403  # чужой сайт — запрещено

    data = request.get_json(silent=True)  # silent=True — при кривом JSON вернёт None, а не упадёт
    if not isinstance(data, dict):
        return jsonify(ok=False, error="bad_json"), 400
    if data.get("website"):
        # Поле-ловушка: на сайте оно спрятано, человек его не заполнит, а бот заполнит.
        # Отвечаем «всё хорошо», чтобы бот не пытался обойти защиту, но заявку никуда не шлём
        return jsonify(ok=True)

    if too_many(request.remote_addr or "unknown"):
        return jsonify(ok=False, error="rate_limited"), 429  # 429 — слишком много запросов

    # Проверяем поля ещё раз: проверку в браузере легко обойти, отправив запрос вручную
    name = clip(data.get("name"), 80)
    digits = "".join(ch for ch in clip(data.get("phone"), 32) if ch.isdigit())  # только цифры телефона
    if len(name) < 2 or len(digits) < 10:
        return jsonify(ok=False, error="validation"), 422
    if data.get("consent") is not True:
        return jsonify(ok=False, error="consent"), 422  # без согласия на обработку данных заявку не принимаем
    if not BOT_TOKEN or not CHAT_ID:
        return jsonify(ok=False, error="not_configured"), 500  # забыли заполнить .env
    if not send_to_telegram(build_message(data)):
        return jsonify(ok=False, error="telegram"), 502  # 502 — ошибка на стороне Telegram
    return jsonify(ok=True)


@app.get("/health")
def health():
    """Проверка, что сервер жив: хостинги и мониторинг дёргают этот адрес."""
    return jsonify(ok=True)


if __name__ == "__main__":
    # Запуск командой python app.py — удобно для проверки на своём компьютере
    app.run(port=int(os.environ.get("PORT", "5000")), debug=False)
