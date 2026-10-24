/*
 * Расчёт сметы.
 *
 * Здесь только «чистые» функции: они получают данные и возвращают результат,
 * но ничего не делают со страницей. Поэтому их легко проверять тестами
 * (tests/estimate.test.js) без браузера.
 *
 * В браузере функции доступны как window.SmetaEstimate,
 * в Node.js — через require('./estimate.js').
 */

// Обёртка UMD: один и тот же файл работает и в браузере, и в Node.js.
// root — глобальный объект (window в браузере), factory — функция, которая создаёт модуль.
(function (root, factory) {
  // В Node.js есть объект module — отдаём модуль через module.exports
  if (typeof module === 'object' && module.exports) module.exports = factory();
  // В браузере кладём модуль в глобальную переменную window.SmetaEstimate
  else root.SmetaEstimate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'; // строгий режим: опечатки в именах переменных станут ошибками, а не тихими багами

  const NB = ' ';    // неразрывный пробел: «1 000 ₽» не разорвётся на две строки
  const MINUS = '−'; // типографский минус (−), он шире дефиса и ровнее смотрится с цифрами
  // Названия месяцев для подписей вида «декабрь, +20%»
  const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const DAY = 86400000;   // миллисекунд в сутках: 24 × 60 × 60 × 1000

  /* ---------- Форматирование ---------- */

  // Склонение по числу: plural(1, 'гость', 'гостя', 'гостей') → 'гость', для 3 → 'гостя', для 11 → 'гостей'
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100; // две последние цифры: 111 → 11
    const d = a % 10;            // последняя цифра: 21 → 1
    if (a > 10 && a < 20) return many; // 11–19 всегда «гостей»
    if (d > 1 && d < 5) return few;    // 2, 3, 4 → «гостя»
    if (d === 1) return one;           // 1, 21, 31… → «гость»
    return many;                       // всё остальное → «гостей»
  }

  // Подставляет значения в шаблон пояснения.
  // fill('{n} {n|автобус|автобуса|автобусов}', { n: 2 }) → '2 автобуса'
  function fill(template, ctx) {
    // Регулярное выражение ищет {ключ} или {ключ|форма1|форма2|форма3}
    return String(template || '').replace(/\{(\w+)(?:\|([^|}]*)\|([^|}]*)\|([^|}]*))?\}/g, function (m, key, one, few, many) {
      if (!ctx || ctx[key] === undefined) return m; // неизвестный ключ оставляем как есть
      // Если в шаблоне есть формы слова — склоняем, иначе просто подставляем число
      return one !== undefined ? plural(ctx[key], one, few, many) : String(ctx[key]);
    });
  }

  // Форматирование чисел по-русски: 1234567 → «1 234 567»
  const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  // Intl ставит между разрядами узкий пробел (U+202F) — заменяем на обычный неразрывный,
  // он есть во всех шрифтах
  function num(n) { return nf.format(Math.round(n)).replace(/[   ]/g, NB); }
  // Сумма в рублях: «1 234 567 ₽»
  function money(n) { return num(n) + NB + '₽'; }
  // Сумма со знаком: «+ 31 000 ₽» или «− 12 000 ₽» — для наценок и скидок
  function signedMoney(n) { return (n < 0 ? MINUS : '+') + NB + money(Math.abs(n)); }

  // Миллионы с одной цифрой после запятой: 1 520 000 → «1,5»
  function millions(v) {
    const x = Math.round(v / 100000) / 10; // округляем до сотен тысяч
    return (x >= 10 ? String(Math.round(x)) : String(x)).replace('.', ','); // от 10 млн — без дробной части
  }
  // Короткая запись вилки: «540–650 тыс. ₽» или «1,5–1,9 млн ₽»
  function short(lo, hi) {
    if (hi < 1000000) return Math.round(lo / 1000) + '–' + Math.round(hi / 1000) + NB + 'тыс.' + NB + '₽';
    return millions(lo) + '–' + millions(hi) + NB + 'млн' + NB + '₽';
  }
  // Короткая запись одной суммы: «734 тыс. ₽» или «2,3 млн ₽»
  function shortOne(v) {
    if (v < 1000000) return Math.round(v / 1000) + NB + 'тыс.' + NB + '₽';
    return millions(v) + NB + 'млн' + NB + '₽';
  }

  // Дополняет число нулём слева: 5 → «05»
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- Даты ----------
   * Даты храним строкой «ГГГГ-ММ-ДД» — так их отдаёт <input type="date">.
   * Считаем в UTC, чтобы переход на летнее время и часовой пояс не сдвигали день.
   */

  // «2026-12-19» → { y: 2026, m: 12, d: 19, utc: миллисекунды }; ошибка в строке → null
  function parseDate(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null; // проверяем формат
    const p = iso.split('-').map(Number);           // ['2026','12','19'] → [2026, 12, 19]
    const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2])); // месяцы в JS считаются с нуля
    // Date «чинит» несуществующие даты (31 февраля → 3 марта), поэтому сверяем месяц и день
    if (dt.getUTCMonth() !== p[1] - 1 || dt.getUTCDate() !== p[2]) return null;
    return { y: p[0], m: p[1], d: p[2], utc: dt.getTime() };
  }
  // Сегодняшняя дата (по часам посетителя) в виде миллисекунд UTC на полночь
  function todayUTC(today) {
    const t = today || new Date();
    return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  }
  // Миллисекунды UTC → «ГГГГ-ММ-ДД»
  function isoFromUTC(ms) {
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  // Сегодня в виде «ГГГГ-ММ-ДД» — используется как минимальная дата в календаре
  function todayISO(today) { return isoFromUTC(todayUTC(today)); }
  // «2026-12-19» → «19.12.2026»
  function dateRu(iso) {
    const p = parseDate(iso);
    return p ? pad(p.d) + '.' + pad(p.m) + '.' + p.y : '';
  }
  // Сколько дней осталось до даты (отрицательное число — дата прошла)
  function daysUntil(iso, today) {
    const p = parseDate(iso);
    return p ? Math.round((p.utc - todayUTC(today)) / DAY) : null;
  }
  // Ближайшая дата с нужным месяцем и днём, до которой осталось не меньше minDays дней.
  // Нужна для примера «Новогодний корпоратив»: он всегда показывает ближайший декабрь.
  function resolveDateRule(rule, today, minDays) {
    const base = todayUTC(today);
    const y0 = new Date(base).getUTCFullYear();
    for (let y = y0; y < y0 + 3; y++) { // пробуем этот год и два следующих
      const ms = Date.UTC(y, rule.month - 1, rule.day);
      if (ms - base >= (minDays || 0) * DAY) return isoFromUTC(ms);
    }
    return '';
  }

  /* ---------- Расчёт ---------- */

  // Цена для уровня: в настройках цена — либо одно число, либо массив [Стандарт, Комфорт, Премиум]
  function pick(v, L) { return Array.isArray(v) ? v[Math.min(L, v.length - 1)] : (v || 0); }
  // Ограничивает число рамками: clamp(700, 10, 500) → 500
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  // Округление до 500 ₽ — в смете не бывает сумм вроде 31 237 ₽
  function round500(v) { return Math.round(v / 500) * 500; }
  // «Красивое» округление для вилки: чем больше сумма, тем крупнее шаг
  function nice(x) {
    const st = x < 100000 ? 1000 : x < 500000 ? 5000 : x < 2000000 ? 10000 : 50000;
    return Math.round(x / st) * st;
  }
  // Сумма поля sum по списку строк сметы
  function total(list) { return list.reduce(function (t, x) { return t + x.sum; }, 0); }
  // Коэффициент для больших мероприятий из таблицы scaleTiers: [[до 100 гостей, ×1], [до 200, ×1.25], …]
  function tier(g, tiers) {
    for (let i = 0; i < (tiers || []).length; i++) if (g <= tiers[i][0]) return tiers[i][1];
    return 1;
  }

  // Сумма одной позиции по её правилу (поле unit в config.js).
  // def — описание позиции из настроек, c — параметры мероприятия:
  // c = { g: гости, h: часы, L: уровень 0..2, hf: коэффициент длительности, tier: коэффициент масштаба }
  // Возвращает { sum: сумма, n: количество (людей, автобусов, перерывов), note: пояснение } или null.
  function price(def, c) {
    if (!def || !def.unit || def.unit === 'none') return null; // «без питания», «своя площадка» — нечего считать
    const p = pick(def.price, c.L); // цена для выбранного уровня
    const min = pick(def.min, c.L); // минимальная сумма заказа (если задана)
    let sum = 0;   // итоговая сумма позиции
    let n = 0;     // сколько единиц: людей, автобусов, перерывов
    let extra = ''; // добавка к пояснению, например «, скидка 10%»
    switch (def.unit) {
      case 'fixed': // фиксированная цена; scale — растёт для больших мероприятий
        sum = p * (def.scale ? c.tier : 1);
        break;
      case 'perGuest': { // цена за гостя, со скидкой от количества
        let d = 0;
        // discounts: [[от 300 шт., 30%], [от 150, 20%], [от 50, 10%]] — берём самую большую подходящую скидку
        (def.discounts || []).forEach(function (r) { if (c.g >= r[0]) d = Math.max(d, r[1]); });
        sum = p * c.g * (1 - d);
        if (d) extra = ', скидка ' + Math.round(d * 100) + '%';
        break;
      }
      case 'perHour': // цена за час, но не меньше minHours
        sum = p * Math.max(def.minHours || 1, c.h);
        break;
      case 'perStaff': // сотрудники на день: один на perGuests гостей, но не меньше minStaff
        n = Math.max(def.minStaff || 1, Math.ceil(c.g / def.perGuests));
        sum = p * n;
        break;
      case 'perStaffHour': // то же, но с почасовой оплатой
        n = Math.max(def.minStaff || 1, Math.ceil(c.g / def.perGuests));
        sum = p * n * c.h;
        break;
      case 'perVehicle': // транспорт: сколько автобусов нужно на всех гостей
        n = Math.ceil(c.g / def.seats);
        sum = p * n;
        break;
      case 'basePlusGuest': // база (included гостей уже входит) + доплата за каждого гостя сверху
        sum = p + Math.max(0, c.g - (def.included || 0)) * pick(def.extra, c.L);
        break;
      case 'perGuestSetup': // разовая сумма (стойка, оборудование) + цена за гостя
        sum = pick(def.setup, c.L) + p * c.g;
        break;
      default: // неизвестный unit — позицию не считаем
        return null;
    }
    if (def.hourly) sum *= c.hf; // аренда дороже при долгом мероприятии
    if (def.breaks) { n = c.h >= 6 ? 2 : 1; sum *= n; } // кофе-брейк: с 6 часов — два перерыва
    sum = Math.max(sum, min || 0); // не меньше минимального заказа
    // Пояснение: если в настройках массив — берём вариант для уровня, затем подставляем числа
    const tpl = Array.isArray(def.note) ? def.note[Math.min(c.L, def.note.length - 1)] : def.note;
    return { sum: sum, n: n, note: fill(tpl, { g: c.g, h: c.h, n: n }) + extra };
  }

  // Приводит любое состояние (из ссылки, памяти браузера, примера) к допустимому:
  // неизвестный формат → первый формат, 9999 гостей → максимум, несуществующие услуги — выкидываем.
  // Так сломанная или «подкрученная» ссылка не сломает расчёт.
  function normalize(input, cfg) {
    const s = input || {};
    const format = cfg.formats.find(function (f) { return f.id === s.format; }) || cfg.formats[0];
    let L = cfg.levels.findIndex(function (l) { return l.id === s.level; }); // номер уровня 0..2
    if (L < 0) L = Math.min(1, cfg.levels.length - 1); // неизвестный уровень → «Комфорт»
    const hrs = Number(s.hours);
    // Длительность — только из списка в настройках, иначе типовая для формата
    const hours = cfg.hours.indexOf(hrs) > -1 ? hrs : ((format.defaults && format.defaults.hours) || cfg.hours[0]);
    const gRaw = Math.round(Number(s.guests));
    // Гости: не число → 50, иначе в рамках от guests.min до guests.max
    const g = clamp(isFinite(gRaw) && gRaw > 0 ? gRaw : 50, cfg.guests.min, cfg.guests.max);
    const venue = cfg.venues.find(function (v) { return v.id === s.venue; }) || cfg.venues[0];
    const food = cfg.food.find(function (x) { return x.id === s.food; }) || cfg.food[0];
    // Алкоголь считаем только к фуршету или банкету (список onlyWith в настройках)
    const drinks = !!s.drinks && !!cfg.drinks && cfg.drinks.onlyWith.indexOf(food.id) > -1;
    const known = cfg.services.map(function (x) { return x.id; }); // id всех существующих услуг
    const services = Array.isArray(s.services)
      // оставляем только существующие услуги и убираем повторы
      ? s.services.filter(function (id, i, arr) { return known.indexOf(id) > -1 && arr.indexOf(id) === i; })
      : [];
    const date = parseDate(s.date) ? s.date : ''; // некорректная дата → «не выбрана»
    return { format: format, L: L, level: cfg.levels[L], hours: hours, g: g, venue: venue, food: food, drinks: drinks, services: services, date: date };
  }

  // Параметры, от которых зависят цены позиций (см. аргумент c в price)
  function context(s, cfg) {
    return { g: s.g, h: s.hours, L: s.L, hf: (cfg.hourFactor && cfg.hourFactor[s.hours]) || 1, tier: tier(s.g, cfg.scaleTiers) };
  }

  // «Лофт или банкетный зал» → «лофт или банкетный зал» (для пояснений в середине фразы)
  function lowerFirst(t) { return t ? t.charAt(0).toLowerCase() + t.slice(1) : t; }

  // Услуги в порядке групп из настроек: сначала «Программа», потом «Техника» и т. д.
  function sortedServices(cfg) {
    const order = (cfg.groups || []).map(function (g) { return g.id; });
    const rank = function (svc) { const i = order.indexOf(svc.group); return i < 0 ? order.length : i; };
    return cfg.services.slice().sort(function (a, b) { return rank(a) - rank(b); });
  }

  // Главная функция: состояние калькулятора → полная смета.
  // input — выбор посетителя, cfg — настройки (config.js), today — «сегодня» (в тестах подменяем дату)
  function estimate(input, cfg, today) {
    const s = normalize(input, cfg); // сначала приводим данные в порядок
    const c = context(s, cfg);
    const items = []; // строки сметы
    // Добавляет строку сметы, если у позиции есть цена.
    // prefix — начало пояснения, например «лофт или банкетный зал»
    const add = function (id, group, title, def, prefix) {
      const r = price(def, c);
      if (!r || r.sum <= 0) return; // нечего добавлять
      const note = prefix ? (r.note ? prefix + ', ' + r.note : prefix) : r.note;
      // seasonal: false — позиция не дорожает в сезон (например, подарки)
      items.push({ id: id, group: group, title: title, note: note, sum: round500(r.sum), seasonal: def.seasonal !== false });
    };

    add('program', 'base', s.format.program.title, s.format.program);    // программа формата
    add('venue', 'base', 'Площадка', s.venue, lowerFirst(s.venue.title)); // площадка
    add('food', 'base', 'Питание', s.food, lowerFirst(s.food.title));     // питание
    if (s.drinks) add('drinks', 'base', cfg.drinks.title, cfg.drinks);    // алкоголь
    sortedServices(cfg).forEach(function (svc) {                          // выбранные услуги
      if (s.services.indexOf(svc.id) > -1) add(svc.id, svc.group, svc.title, svc);
    });

    const subtotal = total(items); // сумма всех позиций
    // База для сезонной наценки — только позиции, которые дорожают в сезон
    const seasonalBase = total(items.filter(function (i) { return i.seasonal; }));
    const adjustments = []; // наценки и скидки: сезон, срочность
    let date = null;        // сведения о дате для интерфейса
    if (s.date) {
      const p = parseDate(s.date);
      const left = Math.round((p.utc - todayUTC(today)) / DAY); // дней до мероприятия
      date = { iso: s.date, month: p.m, daysLeft: left, past: left < 0 };
      if (left >= 0 && cfg.season) { // прошедшая дата цену не меняет
        const sp = (cfg.season.months && cfg.season.months[p.m]) || 0; // процент сезона, например 0.2 для декабря
        if (sp) {
          adjustments.push({
            id: 'season', title: sp > 0 ? 'Высокий сезон' : 'Низкий сезон',
            note: MONTHS[p.m - 1] + ', ' + (sp > 0 ? '+' : MINUS) + Math.round(Math.abs(sp) * 100) + '%',
            sum: round500(seasonalBase * sp)
          });
        }
        if (left < cfg.season.urgentDays) { // меньше двух недель — срочная подготовка
          const up = Math.round(cfg.season.urgentPct * 100);
          adjustments.push({
            id: 'urgent', title: 'Срочная подготовка',
            note: (left === 0 ? 'мероприятие сегодня' : 'до мероприятия ' + left + NB + plural(left, 'день', 'дня', 'дней')) + ', +' + up + '%',
            sum: round500(seasonalBase * cfg.season.urgentPct)
          });
        }
      }
    }

    const afterAdj = subtotal + total(adjustments); // сумма с учётом сезона и срочности
    const pct = pick(cfg.agency.pct, s.L);          // процент агентства для уровня
    const fee = {
      id: 'agency', title: cfg.agency.title,
      note: Math.round(pct * 100) + '% от сметы: ' + cfg.agency.note,
      sum: round500(Math.max(cfg.agency.min || 0, afterAdj * pct)) // но не меньше минимума
    };
    const sum = afterAdj + fee.sum;           // итог без НДС
    const low = nice(sum * cfg.range.low);    // нижняя граница вилки
    const high = nice(sum * cfg.range.high);  // верхняя граница вилки
    const rate = cfg.vat && cfg.vat.rate ? cfg.vat.rate : 0; // ставка НДС (0 — не показывать)
    const vat = rate ? {
      rate: rate, label: cfg.vat.label,
      sum: Math.round(sum * rate), total: Math.round(sum * (1 + rate)),
      low: nice(low * (1 + rate)), high: nice(high * (1 + rate))
    } : null;

    return {
      // ids — выбор после проверки, в виде простых значений (для ссылки и схемы зала)
      ids: { format: s.format.id, level: s.level.id, hours: s.hours, guests: s.g, venue: s.venue.id, food: s.food.id, drinks: s.drinks, services: s.services.slice(), date: s.date },
      g: s.g, hours: s.hours, L: s.L, level: s.level, format: s.format, venue: s.venue, food: s.food, drinks: s.drinks,
      items: items, subtotal: subtotal, adjustments: adjustments, fee: fee,
      total: sum, low: low, high: high, perGuest: Math.round(sum / s.g / 100) * 100, // на гостя — с точностью до 100 ₽
      vat: vat, date: date
    };
  }

  // Сколько стоила бы каждая опция при текущих параметрах — для подписей «+ 60 000 ₽» у вариантов
  function previews(input, cfg) {
    const s = normalize(input, cfg);
    const c = context(s, cfg);
    const val = function (def) { const r = price(def, c); return r ? round500(r.sum) : 0; };
    const out = { services: {}, venues: {}, food: {}, drinks: cfg.drinks ? val(cfg.drinks) : 0 };
    cfg.services.forEach(function (x) { out.services[x.id] = val(x); });
    cfg.venues.forEach(function (x) { out.venues[x.id] = val(x); });
    cfg.food.forEach(function (x) { out.food[x.id] = val(x); });
    return out;
  }

  // Что модуль отдаёт наружу
  return {
    estimate: estimate, previews: previews, price: price, normalize: normalize,
    plural: plural, fill: fill, num: num, money: money, signedMoney: signedMoney, short: short, shortOne: shortOne,
    parseDate: parseDate, dateRu: dateRu, todayISO: todayISO, daysUntil: daysUntil, resolveDateRule: resolveDateRule,
    MONTHS: MONTHS
  };
});
