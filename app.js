/*
 * Интерфейс сайта: калькулятор, схема зала, смета, примеры и заявка на звонок.
 *
 * Где что лежит:
 *   config.js   — цены, услуги, контакты, график работы (меняется чаще всего)
 *   estimate.js — формулы расчёта сметы
 *   plan.js     — схема зала
 *   app.js      — этот файл: связывает всё со страницей (кнопки, поля, вывод сметы)
 *
 * Как устроено: всё, что выбрал посетитель, хранится в одном объекте state.
 * Любое действие меняет state и вызывает update() — она пересчитывает смету
 * и перерисовывает страницу. Поэтому данные на экране всегда совпадают с расчётом.
 */

// Весь код внутри функции, которая сразу вызывается: так наши переменные
// не попадают в глобальную область и не конфликтуют с чужими скриптами
(function () {
  'use strict'; // строгий режим: больше ошибок видно сразу

  // Модули, которые подключены в index.html раньше этого файла
  const C = window.SMETA_CONFIG;  // настройки и цены
  const E = window.SmetaEstimate; // расчёт
  const P = window.SmetaPlan;     // схема зала
  if (!C || !E || !P) return;     // какой-то файл не загрузился — дальше работать нельзя

  const NB = ' ';            // неразрывный пробел: «50 гостей» не разорвётся на две строки
  const STORE_KEY = 'smeta:v1';   // ключ, под которым расчёт хранится в браузере
  // Короткие помощники для поиска элементов на странице:
  // $('#id') — первый подходящий элемент, $$('.class') — массив всех подходящих
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  // Найти в списке объект с нужным id: byId(C.formats, 'corporate')
  const byId = (list, id) => list.find((x) => x.id === id);
  // Экранирование: текст из настроек или от посетителя вставляем в HTML безопасно,
  // чтобы «<script>» показался как текст, а не выполнился
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  // Иконка из SVG-спрайта в начале index.html: icon('check') → <svg><use href="#i-check"/></svg>
  const icon = (name, cls) => '<svg class="ico' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  const hoursText = (h) => h + NB + E.plural(h, 'час', 'часа', 'часов');      // 4 → «4 часа»
  const guestsText = (g) => g + NB + E.plural(g, 'гость', 'гостя', 'гостей'); // 21 → «21 гость»
  // Посетитель попросил систему уменьшить анимацию — тогда не анимируем прокрутку и схему
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const now = () => new Date(); // текущее время (отдельная функция — чтобы было одно место)

  /* ======================= Состояние ======================= */

  // Начальное состояние калькулятора для формата: типовые площадка, питание и услуги из config.js
  function defaults(formatId) {
    const f = byId(C.formats, formatId) || byId(C.formats, 'corporate') || C.formats[0];
    return {
      format: f.id, guests: 50, hours: f.defaults.hours, level: 'comfort', date: '',
      venue: f.defaults.venue, food: f.defaults.food, drinks: !!f.defaults.drinks,
      services: f.defaults.services.slice(), // slice() — копия массива, чтобы не испортить настройки
      budget: 0,
      touched: false // true — посетитель сам менял площадку, питание или услуги
    };
  }

  // Любые входные данные (ссылка, память браузера, пример) → допустимое состояние.
  // Проверку делает E.normalize: неизвестные значения заменяются на допустимые
  function clean(raw) {
    const s = Object.assign(defaults(raw && raw.format), raw || {}); // недостающие поля берём из значений по умолчанию
    const n = E.normalize(s, C);
    return {
      format: n.format.id, guests: n.g, hours: n.hours, level: n.level.id, date: n.date,
      venue: n.venue.id, food: n.food.id, drinks: !!s.drinks, services: n.services,
      budget: Math.max(0, Math.round(Number(s.budget) || 0)), touched: !!s.touched
    };
  }

  // Состояние → строка для ссылки: ?f=corporate&g=80&h=4&l=comfort…
  // Короткие имена параметров, чтобы ссылка была покороче
  function toQuery(s) {
    const q = new URLSearchParams();
    q.set('f', s.format); q.set('g', s.guests); q.set('h', s.hours); q.set('l', s.level);
    q.set('v', s.venue); q.set('m', s.food);
    if (s.drinks) q.set('a', '1');                                     // a — алкоголь
    if (s.services.length) q.set('s', s.services.join('.'));          // услуги через точку: host.av.photo
    if (s.date) q.set('d', s.date);
    if (s.budget) q.set('b', s.budget);
    return q.toString();
  }

  // Строка из ссылки → состояние (обратное к toQuery). Нет параметра f — значит, это обычный заход на сайт
  function fromQuery(search) {
    const q = new URLSearchParams(search);
    if (!q.has('f')) return null;
    return clean({
      format: q.get('f'), guests: q.get('g'), hours: q.get('h'), level: q.get('l'), venue: q.get('v'), food: q.get('m'),
      drinks: q.get('a') === '1', services: (q.get('s') || '').split('.').filter(Boolean),
      date: q.get('d') || '', budget: q.get('b'), touched: true
    });
  }

  // Память браузера (localStorage): расчёт не пропадёт после перезагрузки страницы.
  // try/catch — в режиме инкогнито или при запрете cookies localStorage может выбросить ошибку
  const store = {
    get() { try { const v = localStorage.getItem(STORE_KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch (e) { /* память браузера недоступна — не страшно */ } }
  };

  // Адрес сайта без параметров: из config.js (siteUrl) или текущей страницы
  function pageUrl() {
    if (C.siteUrl) return C.siteUrl;
    return location.href.split(/[?#]/)[0]; // отрезаем всё после ? или #
  }
  // Ссылка, по которой откроется этот же расчёт (#calc — сразу прокрутить к калькулятору)
  function shareUrl(s) { return pageUrl() + '?' + toQuery(s) + '#calc'; }

  // Состояние для примера сметы. У новогоднего примера дата вычисляется: ближайшее 19 декабря
  function presetState(p) {
    const st = Object.assign({}, p.state, { touched: true });
    st.date = p.dateRule ? E.resolveDateRule(p.dateRule, now(), 15) : '';
    return clean(st);
  }

  // Откуда берём стартовое состояние: из ссылки → из памяти браузера → значения по умолчанию
  const linked = fromQuery(location.search);
  let state = linked || (store.get() ? clean(store.get()) : defaults('corporate'));

  /* ======================= Построение калькулятора ======================= */

  const form = $('#calc-form');

  // Создаём кнопки форматов, длительности, варианты и услуги по данным из config.js.
  // Поэтому новая услуга в настройках сама появится на странице
  function buildControls() {
    // Плитки форматов. Внутри каждой — скрытая радиокнопка: с ней работает клавиатура и экранные дикторы
    $('#formats').innerHTML = C.formats.map((f) =>
      '<label class="tile"><input type="radio" name="format" value="' + esc(f.id) + '">' +
      '<span class="tile__body">' + icon(f.icon, 'tile__ico') +
      '<span class="tile__title">' + esc(f.title) + '</span>' +
      '<span class="tile__desc">' + esc(f.desc) + '</span>' +
      '<span class="tile__check">' + icon('check') + '</span></span></label>').join('');

    // Кнопки длительности: «2 часа», «3 часа»…
    $('#hours').innerHTML = C.hours.map((h) =>
      '<label class="chip"><input type="radio" name="hours" value="' + h + '"><span>' + hoursText(h) + '</span></label>').join('');

    // Быстрый выбор числа гостей: 20, 50, 100…
    $('#guest-chips').innerHTML = C.guests.presets.map((n) =>
      '<button class="chip-btn" type="button" data-guests="' + n + '">' + n + '</button>').join('');

    // Один вариант выбора (уровень, площадка, питание). priceAttr — атрибут, в который потом впишем цену
    const opt = (name, item, priceAttr) =>
      '<label class="opt"><input type="radio" name="' + name + '" value="' + esc(item.id) + '">' +
      '<span class="opt__body"><span class="opt__radio"></span>' +
      '<span class="opt__title">' + esc(item.title) + '</span>' +
      '<span class="opt__price" ' + priceAttr + '="' + esc(item.id) + '"></span>' +
      '<span class="opt__desc">' + esc(item.desc) + '</span></span></label>';
    $('#levels').innerHTML = C.levels.map((l) => opt('level', l, 'data-level-total')).join('');
    $('#venues').innerHTML = C.venues.map((v) => opt('venue', v, 'data-venue-price')).join('');
    $('#food').innerHTML = C.food.map((f) => opt('food', f, 'data-food-price')).join('');

    // Переключатель «алкоголь»: подписи из настроек; если в настройках его нет — прячем
    if (C.drinks) {
      $('#drinks-title').textContent = C.drinks.title;
      $('#drinks-desc').textContent = C.drinks.desc;
    } else {
      $('#drinks-row').hidden = true;
    }

    // Услуги по группам: «Программа», «Техника и трансляция»…
    $('#services').innerHTML = C.groups.map((g) => {
      const list = C.services.filter((s) => s.group === g.id); // услуги этой группы
      if (!list.length) return '';                              // пустую группу не показываем
      return '<fieldset class="svc-group"><legend class="svc-group__title">' + esc(g.title) + '</legend>' +
        list.map((svc) =>
          '<label class="svc"><input type="checkbox" name="services" value="' + esc(svc.id) + '">' +
          '<span class="svc__body"><span class="svc__box">' + icon('check') + '</span>' +
          '<span class="svc__title">' + esc(svc.title) + '</span>' +
          '<span class="svc__price" data-svc-price="' + esc(svc.id) + '"></span>' +
          '<span class="svc__desc">' + esc(svc.desc) + '</span></span></label>').join('') +
        '</fieldset>';
    }).join('');

    // Границы числа гостей и шаг ползунка — тоже из настроек
    const gNum = $('#guests-num');
    const gRange = $('#guests-range');
    [gNum, gRange].forEach((el) => { el.min = C.guests.min; el.max = C.guests.max; });
    gRange.step = C.guests.step;
    $('#date').min = E.todayISO(now()); // в календаре нельзя выбрать прошедший день
  }

  // Отметить радиокнопку с нужным значением в группе name
  function setRadio(name, value) {
    $$('input[name="' + name + '"]', form).forEach((i) => { i.checked = i.value === String(value); });
  }

  // Состояние → элементы формы. Вызываем после загрузки, открытия примера, сброса
  function syncControls() {
    setRadio('format', state.format);
    setRadio('hours', state.hours);
    setRadio('level', state.level);
    setRadio('venue', state.venue);
    setRadio('food', state.food);
    $('#drinks').checked = state.drinks;
    $$('input[name="services"]', form).forEach((i) => { i.checked = state.services.indexOf(i.value) > -1; });
    $('#guests-num').value = state.guests;
    $('#guests-range').value = state.guests;
    $('#date').value = state.date || '';
    $('#budget').value = state.budget ? E.num(state.budget) : ''; // бюджет показываем с пробелами: 1 500 000
  }

  // Подставить типовой набор для формата: длительность, площадку, питание и услуги
  function applyTypical(formatId) {
    const f = byId(C.formats, formatId);
    if (!f) return;
    const d = f.defaults;
    Object.assign(state, { hours: d.hours, venue: d.venue, food: d.food, drinks: !!d.drinks, services: d.services.slice(), touched: false });
    syncControls();
  }

  // Совпадает ли текущий выбор с типовым набором формата (тогда подсказку «подставить набор» не показываем)
  function isTypical() {
    const d = (byId(C.formats, state.format) || {}).defaults;
    if (!d) return true;
    // Списки услуг сравниваем без учёта порядка: сортируем и склеиваем в строку
    const a = state.services.slice().sort().join();
    const b = d.services.slice().sort().join();
    return d.venue === state.venue && d.food === state.food && !!d.drinks === !!state.drinks && d.hours === state.hours && a === b;
  }

  // Записать число гостей в состояние, не выходя за рамки из настроек
  function setGuests(v) {
    const n = Math.round(Number(v));
    if (!isFinite(n)) return; // не число — ничего не меняем
    state.guests = Math.min(C.guests.max, Math.max(C.guests.min, n));
  }

  /* ======================= Расчёт и отрисовка ======================= */

  // Что рисовать на схеме зала — зависит от формата, питания и выбранных услуг
  function planOptions(est) {
    const has = (id) => est.ids.services.indexOf(id) > -1; // выбрана ли услуга
    const f = est.format;
    // Рассадка: у конференции — ряды, у тимбилдинга — команды, у остальных — по типу питания
    const layout = f.layout === 'theatre' ? 'theatre' : f.layout === 'teams' ? 'teams' : (est.food.id === 'banquet' ? 'banquet' : 'cocktail');
    return {
      layout: layout, guests: est.g,
      // Сцена нужна деловым событиям, корпоративам и PR — или если есть ведущий, шоу, диджей, экран
      stage: ['business', 'corporate', 'pr'].indexOf(f.id) > -1 || has('host') || has('show') || has('dj') || has('screen'),
      screen: has('screen') || has('stream'), light: has('av'), dj: has('dj'),
      photo: has('decor'), reg: has('registration'),
      station: est.food.id === 'buffet' ? 'buffet' : est.food.id === 'coffee' ? 'coffee' : null,
      outdoor: !!est.venue.outdoor
    };
  }

  // Вилка цены: «1 190 000 – 1 520 000 ₽»
  function rangeText(lo, hi) { return E.num(lo) + ' – ' + E.num(hi) + NB + '₽'; }

  // Одна строка сметы в правой колонке. kind: 'adj' — наценка или скидка, 'fee' — работа агентства
  function lineHtml(l, kind) {
    const sum = kind === 'adj' ? E.signedMoney(l.sum) : E.money(l.sum); // у наценок показываем знак
    const cls = kind === 'adj' ? (l.sum < 0 ? 'line line--adj line--minus' : 'line line--adj') : kind === 'fee' ? 'line line--fee' : 'line';
    return '<li class="' + cls + '"><span class="line__title">' + esc(l.title) + '</span><span class="line__sum">' + sum + '</span>' +
      (l.note ? '<span class="line__note">' + esc(l.note) + '</span>' : '') + '</li>';
  }

  // Схема рисуется в двух местах: в смете справа и рядом с выбором гостей (на телефоне).
  // Перерисовываем, только если параметры схемы изменились, — это экономит работу браузера
  let lastPlanKey = '';
  function renderPlans(est) {
    const opts = planOptions(est);
    const key = JSON.stringify(opts); // «отпечаток» параметров схемы
    if (key === lastPlanKey) return;  // ничего не поменялось
    lastPlanKey = key;
    const plan = P.build(opts);
    $('#plan-main').innerHTML = plan.svg;
    $('#plan-inline').innerHTML = plan.svg;
    $('#plan-cap').textContent = plan.caption;
    $('#plan-inline-cap').textContent = plan.caption;
  }

  // Смета в правой колонке, мобильная панель снизу и строка в форме заявки
  function renderSummary(est) {
    // Строка параметров: «Корпоратив, 50 гостей, 4 часа, «Комфорт», 19.12.2026»
    $('#sum-params').textContent = est.format.title + ', ' + guestsText(est.g) + ', ' + hoursText(est.hours) + ', «' + est.level.title + '»' +
      (est.date && !est.date.past ? ', ' + E.dateRu(est.date.iso) : '');

    $('#sum-range').textContent = rangeText(est.low, est.high); // вилка — главная цифра
    $('#sum-sub').textContent = '≈' + NB + E.money(est.total) + ', около ' + E.money(est.perGuest) + ' на гостя' + (est.vat ? ', без НДС' : '');
    const vatEl = $('#sum-vat');
    vatEl.hidden = !est.vat; // строка с НДС, если ставка задана в настройках
    if (est.vat) vatEl.textContent = 'С ' + est.vat.label + ': ' + rangeText(est.vat.low, est.vat.high);

    // Статьи сметы: позиции, затем сезон и срочность, затем работа агентства
    $('#sum-lines').innerHTML =
      est.items.map((l) => lineHtml(l)).join('') +
      est.adjustments.map((l) => lineHtml(l, 'adj')).join('') +
      lineHtml(est.fee, 'fee');

    markOverflow();
    $('#mbar-sum').textContent = E.short(est.low, est.high); // мобильная панель: «1,2–1,5 млн ₽»
    $('#lead-attach-sum').textContent = est.format.title + ', ' + guestsText(est.g) + ': ' + E.short(est.low, est.high);
    announce('Смета: от ' + E.money(est.low) + ' до ' + E.money(est.high)); // для экранных дикторов
  }

  // Затемнение внизу списка статей, когда в нём есть ещё строки (список прокручивается)
  function markOverflow() {
    const list = $('#sum-lines');
    const more = list.scrollHeight - list.clientHeight - list.scrollTop > 4; // есть невидимая часть внизу
    list.classList.toggle('has-more', more);
  }
  $('#sum-lines').addEventListener('scroll', markOverflow, { passive: true });
  window.addEventListener('resize', markOverflow);

  // Цены рядом с вариантами: «+ 60 000 ₽» у услуги, «≈ 1,3 млн ₽» у уровня — при текущих параметрах
  function renderPrices(est) {
    const pv = E.previews(state, C); // стоимость каждой опции при текущих гостях, часах и уровне
    $$('[data-svc-price]').forEach((el) => { el.textContent = '+' + NB + E.money(pv.services[el.dataset.svcPrice] || 0); });
    $$('[data-venue-price]').forEach((el) => {
      const v = pv.venues[el.dataset.venuePrice];
      el.textContent = v ? '+' + NB + E.money(v) : 'без аренды'; // своя площадка ничего не стоит
    });
    $$('[data-food-price]').forEach((el) => {
      const v = pv.food[el.dataset.foodPrice];
      el.textContent = v ? '+' + NB + E.money(v) : '—';
    });
    // Для уровня показываем итог всей сметы, если выбрать этот уровень
    $$('[data-level-total]').forEach((el) => {
      const t = E.estimate(Object.assign({}, state, { level: el.dataset.levelTotal }), C, now()).total;
      el.textContent = '≈' + NB + E.shortOne(t);
    });

    // Алкоголь доступен только к фуршету или банкету — иначе переключатель неактивен
    const drinksOk = C.drinks && C.drinks.onlyWith.indexOf(est.food.id) > -1;
    const dIn = $('#drinks');
    dIn.disabled = !drinksOk;
    $('#drinks-row').classList.toggle('is-off', !drinksOk);
    $('#drinks-price').textContent = drinksOk ? '+' + NB + E.money(pv.drinks) : 'к фуршету или банкету';
  }

  // Поля ввода и подсказки: число гостей, ползунок, подсказка про дату и типовой набор
  function renderInputs(est) {
    const g = est.g;
    const gNum = $('#guests-num');
    if (document.activeElement !== gNum) gNum.value = g; // не мешаем, пока человек печатает в поле
    const gRange = $('#guests-range');
    gRange.value = g;
    // --p — насколько закрашен ползунок (в процентах), используется в CSS
    gRange.style.setProperty('--p', ((g - C.guests.min) / (C.guests.max - C.guests.min) * 100).toFixed(1) + '%');
    $('#guests-unit').textContent = E.plural(g, 'гость', 'гостя', 'гостей');
    $$('[data-guests]').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.guests) === g)); // подсветка быстрого выбора
    $('#guests-max-hint').hidden = g < C.guests.max; // «больше 500 — посчитаем индивидуально»

    // Подсказка под датой: прошедшая дата, срочность, высокий или низкий сезон
    const hint = $('#date-hint');
    hint.className = 'hint'; // сбрасываем цвет предыдущей подсказки
    const months = (C.season && C.season.months) || {};
    const pct = (m) => Math.round(Math.abs(months[m] || 0) * 100); // процент сезона для месяца
    if (state.date && est.date && est.date.past) {
      hint.textContent = 'Эта дата уже прошла — выберите будущую.';
      hint.classList.add('is-err');
    } else if (est.date && est.adjustments.some((a) => a.id === 'urgent')) {
      hint.textContent = 'До мероприятия меньше ' + C.season.urgentDays + ' дней — добавили ' + Math.round(C.season.urgentPct * 100) + '% за срочную подготовку.';
      hint.classList.add('is-warn');
    } else if (est.date && months[est.date.month] > 0) {
      // Название месяца с заглавной буквы: «Декабрь — высокий сезон…»
      hint.textContent = E.MONTHS[est.date.month - 1].replace(/^./, (c) => c.toUpperCase()) + ' — высокий сезон: +' + pct(est.date.month) + '% к смете. Площадки лучше бронировать заранее.';
      hint.classList.add('is-warn');
    } else if (est.date && months[est.date.month] < 0) {
      hint.textContent = 'Низкий сезон: −' + pct(est.date.month) + '% к смете.';
    } else {
      // Дата не выбрана — просто рассказываем про сезонность
      hint.textContent = (months[12] ? 'В декабре цены выше на ' + pct(12) + '%' : '') + (months[1] ? ', в январе — ниже на ' + pct(1) + '%.' : '.');
    }

    // Посетитель сам менял набор и сменил формат — предлагаем подставить типовой набор нового формата
    const showTypical = state.touched && !isTypical();
    $('#typical-hint').hidden = !showTypical;
    if (showTypical) $('#typical-format').textContent = est.format.title;
  }

  /* Подсказки «как сэкономить» */

  // Дата «перенести на январь»: 20 января следующего года
  function januaryAfter(iso) {
    const p = E.parseDate(iso);
    return p ? (p.y + 1) + '-01-20' : '';
  }

  // Подбираем до трёх изменений, которые сильнее всего снижают смету.
  // Каждое изменение — «заплатка» (patch) к состоянию; экономию считаем честно, полным пересчётом
  function tipsFor(est) {
    const cands = []; // кандидаты в подсказки
    const L = C.levels.findIndex((l) => l.id === state.level);
    // Уровнем ниже
    if (L > 0) cands.push({ title: 'Уровень «' + C.levels[L - 1].title + '» вместо «' + C.levels[L].title + '»', patch: { level: C.levels[L - 1].id } });
    // Декабрь → январь
    if (est.date && !est.date.past && (C.season.months[est.date.month] || 0) > 0 && est.date.month === 12) {
      cands.push({ title: 'Перенести праздник на январь', patch: { date: januaryAfter(state.date) } });
    }
    // Покороче: с 6 часов предлагаем предыдущий вариант длительности
    if (state.hours >= 6) {
      const h = C.hours.filter((x) => x < state.hours).pop();
      if (h) cands.push({ title: hoursText(h) + ' вместо ' + state.hours, patch: { hours: h }, touch: true });
    }
    // Фуршет дешевле банкета
    if (state.food === 'banquet' && byId(C.food, 'buffet')) cands.push({ title: 'Фуршет вместо банкета', patch: { food: 'buffet' }, touch: true });
    // Без алкоголя
    if (est.drinks) cands.push({ title: 'Без алкогольных напитков', patch: { drinks: false }, touch: true });
    // Без самой дорогой из выбранных услуг
    const svcLines = est.items.filter((i) => est.ids.services.indexOf(i.id) > -1).sort((a, b) => b.sum - a.sum);
    if (svcLines[0]) {
      const id = svcLines[0].id;
      cands.push({ title: 'Без услуги «' + svcLines[0].title + '»', patch: { services: state.services.filter((x) => x !== id) }, touch: true });
    }
    return cands
      // save — на сколько уменьшится итог, если применить подсказку
      .map((c) => Object.assign(c, { save: est.total - E.estimate(Object.assign({}, state, c.patch), C, now()).total }))
      .filter((c) => c.save >= Math.max(5000, est.total * 0.02)) // мелкую экономию не показываем
      .sort((a, b) => b.save - a.save)                            // самые выгодные — первыми
      .slice(0, 3);                                               // не больше трёх
  }

  let tips = []; // текущие подсказки (нужны, когда нажимают «Применить»)
  // Блок «Бюджет»: укладываемся или нет, и подсказки по экономии
  function renderBudget(est) {
    const status = $('#budget-status');
    const b = state.budget;
    status.className = 'budget__status';
    if (!b) {
      status.hidden = true; // бюджет не указан — ничего не пишем
    } else {
      status.hidden = false;
      if (b >= est.high) { // бюджет выше верхней границы вилки
        status.textContent = 'Укладываетесь в бюджет, запас ≈' + NB + E.money(b - est.total) + '.';
        status.classList.add('is-ok');
      } else if (b >= est.low) { // внутри вилки
        status.textContent = 'Бюджет попадает в вилку — итог будет зависеть от площадки и даты.';
      } else { // меньше нижней границы
        status.textContent = 'Не хватает ≈' + NB + E.money(est.total - b) + '. Вот что можно изменить:';
        status.classList.add('is-over');
      }
    }
    tips = tipsFor(est);
    $('#tips').hidden = !tips.length;
    // data-tip — номер подсказки: по нему обработчик кликов поймёт, какую применить
    $('#tips-list').innerHTML = tips.map((t, i) =>
      '<li class="tip"><span class="tip__title">' + esc(t.title) + '</span><span class="tip__save">' + E.signedMoney(-t.save) + '</span>' +
      '<button class="btn btn--quiet" type="button" data-tip="' + i + '">Применить</button></li>').join('');
  }

  // Сохраняем расчёт в браузер не на каждое движение ползунка, а через 0,3 с после последнего изменения
  let saveTimer = 0;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.set(state), 300);
  }

  // Главная функция обновления: пересчитать смету и перерисовать всё, что от неё зависит.
  // requestAnimationFrame объединяет частые вызовы (например, при движении ползунка)
  // в одну перерисовку на кадр экрана
  let frame = 0;
  function update() {
    if (frame) return; // перерисовка уже запланирована
    frame = requestAnimationFrame(() => {
      frame = 0;
      const est = E.estimate(state, C, now()); // считаем смету один раз и отдаём всем
      renderSummary(est);
      renderPrices(est);
      renderInputs(est);
      renderPlans(est);
      renderBudget(est);
      saveSoon();
    });
  }

  // Сообщение для экранных дикторов. С задержкой 0,7 с, чтобы не зачитывать каждое движение ползунка
  let announceTimer = 0;
  function announce(text) {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { $('#live-total').textContent = text; }, 700);
  }

  /* ======================= События калькулятора ======================= */

  // Enter в поле калькулятора не должен перезагружать страницу
  form.addEventListener('submit', (ev) => ev.preventDefault());

  // change срабатывает, когда выбор сделан: радиокнопка, галочка, дата, поле гостей.
  // Один обработчик на всю форму: по имени поля понимаем, что поменялось
  form.addEventListener('change', (ev) => {
    const t = ev.target; // элемент, который изменили
    switch (t.name) {
      case 'format':
        state.format = t.value;
        if (!state.touched) applyTypical(t.value); // набор ещё не трогали — подставляем типовой для формата
        break;
      case 'hours': state.hours = Number(t.value); state.touched = true; break;
      case 'level': state.level = t.value; break;
      case 'venue': state.venue = t.value; state.touched = true; break;
      case 'food': state.food = t.value; state.touched = true; break;
      case 'drinks': state.drinks = t.checked; state.touched = true; break;
      case 'services':
        // Собираем заново все отмеченные услуги
        state.services = $$('input[name="services"]:checked', form).map((i) => i.value);
        state.touched = true;
        break;
      default:
        // У даты и поля гостей нет name — различаем по id
        if (t.id === 'date') state.date = E.parseDate(t.value) ? t.value : '';
        else if (t.id === 'guests-num') { setGuests(t.value); t.value = state.guests; }
        else return; // остальное нас не интересует
    }
    update();
  });

  // input срабатывает на каждое движение ползунка и каждую набранную цифру
  form.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'guests-range') { setGuests(t.value); update(); }
    else if (t.id === 'guests-num') {
      const n = Number(t.value);
      // Пока человек набирает «1» из «120», не исправляем на минимум — ждём осмысленного числа
      if (t.value !== '' && n >= C.guests.min) { setGuests(n); update(); }
    } else if (t.id === 'budget') {
      const digits = t.value.replace(/\D/g, '').slice(0, 10); // оставляем только цифры
      state.budget = digits ? Number(digits) : 0;
      update();
    }
  });

  // Когда поле бюджета теряет фокус, показываем число с пробелами: 1500000 → 1 500 000
  $('#budget').addEventListener('blur', (ev) => { ev.target.value = state.budget ? E.num(state.budget) : ''; });

  // Все кнопки страницы обрабатываем одним слушателем (делегирование событий).
  // Кнопка сообщает о себе атрибутом: data-act="pdf", data-guests="100", data-tip="0", data-preset="newyear"
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act], [data-guests], [data-tip], [data-preset]'); // ближайшая кнопка
    if (!el) return; // кликнули не по нашей кнопке
    if (el.dataset.guests) { setGuests(el.dataset.guests); update(); return; }
    if (el.dataset.tip !== undefined) { applyTip(Number(el.dataset.tip)); return; }
    if (el.dataset.preset) { openPreset(el.dataset.preset); return; }
    const step = C.guests.step || 5;
    switch (el.dataset.act) {
      // «−» и «+»: сначала выравниваем до кратного 5, потом шагаем на 5
      case 'guests-dec': setGuests(state.guests % step ? Math.floor(state.guests / step) * step : state.guests - step); update(); break;
      case 'guests-inc': setGuests(state.guests % step ? Math.ceil(state.guests / step) * step : state.guests + step); update(); break;
      case 'typical': applyTypical(state.format); update(); toast('Подставили типовой набор для формата'); break;
      case 'reset':
        state = defaults('corporate');
        syncControls(); update();
        toast('Расчёт сброшен');
        break;
      case 'link': copyText(shareUrl(state), 'Ссылка на расчёт скопирована'); break;
      case 'text': copyText(estimateText(E.estimate(state, C, now())), 'Смета скопирована — вставьте её в мессенджер или письмо'); break;
      case 'pdf': printEstimate(); break;
      case 'send':
        // «Отправить смету менеджеру»: ссылка прокручивает к форме, а мы отмечаем «приложить расчёт»
        // и ставим курсор в поле имени, когда прокрутка закончится
        $('#lead-attach').checked = true;
        setTimeout(() => { const n = $('#lead-name'); if (n) n.focus({ preventScroll: true }); }, 450);
        break;
      case 'lead-again': leadReset(); break;
      default: break;
    }
  });

  // Применить подсказку «как сэкономить»
  function applyTip(i) {
    const t = tips[i];
    if (!t) return;
    Object.assign(state, t.patch); // меняем в состоянии то, что предлагает подсказка
    if (t.touch) state.touched = true;
    syncControls();
    update();
    toast('Готово: смета меньше примерно на ' + E.money(t.save));
  }

  /* ======================= Примеры смет и уровни ======================= */

  // Раздел «Примеры смет»: каждый пример считается той же функцией, что и калькулятор
  function renderExamples() {
    $('#examples-list').innerHTML = C.presets.map((p) => {
      const st = presetState(p);
      const est = E.estimate(st, C, now());
      // Что входит: площадка, питание и услуги одной строкой, со строчной буквы после первой
      const incl = [est.venue.unit !== 'none' ? est.venue.title : '', est.food.unit !== 'none' ? est.food.title : '']
        .concat(est.items.filter((i) => st.services.indexOf(i.id) > -1).map((i) => i.title))
        .filter(Boolean).map((t, i) => (i ? t.charAt(0).toLowerCase() + t.slice(1) : t)).join(', ');
      const meta = guestsText(est.g) + ', ' + hoursText(est.hours) + ', уровень «' + est.level.title + '»' + (st.date ? ', дата ' + E.dateRu(st.date) : '');
      return '<li class="ledger__row">' +
        '<div><h3 class="ledger__title">' + esc(p.title) + '</h3><p class="ledger__meta">' + esc(meta) + '</p></div>' +
        '<p class="ledger__incl">' + esc(incl) + '</p>' +
        '<p class="ledger__price"><b>' + rangeText(est.low, est.high) + '</b><small>≈' + NB + E.money(est.perGuest) + ' на гостя, без НДС</small></p>' +
        '<button class="btn btn--line" type="button" data-preset="' + esc(p.id) + '">Открыть в калькуляторе</button>' +
        '</li>';
    }).join('');

    // Таблица «Чем отличаются уровни»: стоимость на гостя для новогоднего примера без сезонной наценки
    const base = byId(C.presets, 'newyear') || C.presets[0];
    if (base) {
      $$('[data-per-guest]').forEach((td) => {
        const st = Object.assign({}, base.state, { level: td.dataset.perGuest, date: '' });
        td.textContent = '≈' + NB + E.money(E.estimate(st, C, now()).perGuest);
      });
    }
  }

  // Открыть пример в калькуляторе (бюджет посетителя сохраняем)
  function openPreset(id) {
    const p = byId(C.presets, id);
    if (!p) return;
    state = Object.assign(presetState(p), { budget: state.budget });
    syncControls();
    update();
    document.getElementById('calc').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    toast('Открыли пример «' + p.title + '» — меняйте параметры как угодно');
  }

  /* ======================= Первый экран ======================= */

  // «Чертёж» на первом экране: схема и штамп считаются из примера «Новогодний корпоратив»,
  // поэтому цифры всегда совпадают с калькулятором
  function renderHero() {
    const p = byId(C.presets, 'newyear') || C.presets[0];
    if (!p) return;
    const st = presetState(p);
    const est = E.estimate(st, C, now());
    const plan = P.build(Object.assign(planOptions(est), { animate: !reduceMotion })); // со «вычерчиванием»
    $('#hero-plan').innerHTML = plan.svg;
    // Заполняем ячейки штампа: элементы с атрибутом data-hero="…"
    const set = (key, val) => { const el = $('[data-hero="' + key + '"]'); if (el) el.textContent = val; };
    set('title', 'Новогодний корпоратив');
    set('guests', est.g);
    set('hours', est.hours + NB + 'ч');
    set('level', est.level.title);
    set('date', st.date ? E.dateRu(st.date).slice(0, 5) : '—'); // «19.12» без года
    set('total', '≈' + NB + E.shortOne(est.total));
    set('range', E.short(est.low, est.high) + ' без НДС');
    set('caption', plan.caption + '.');
  }

  /* ======================= Текст, ссылка, PDF ======================= */

  // Смета простым текстом — для кнопки «Текстом» (вставить в мессенджер или письмо)
  function estimateText(est) {
    const lines = [];
    lines.push('Предварительная смета: ' + est.format.title);
    lines.push(guestsText(est.g) + ', ' + hoursText(est.hours) + ', уровень «' + est.level.title + '»' + (est.date && !est.date.past ? ', дата ' + E.dateRu(est.date.iso) : ''));
    lines.push('');
    est.items.forEach((l) => lines.push(l.title + ' — ' + E.money(l.sum)));
    est.adjustments.forEach((l) => lines.push(l.title + ' (' + l.note + ') — ' + E.signedMoney(l.sum)));
    lines.push(est.fee.title + ' — ' + E.money(est.fee.sum));
    lines.push('');
    lines.push('Итого: ' + rangeText(est.low, est.high) + (est.vat ? ' без НДС' : '') + ' (≈' + NB + E.money(est.total) + ')');
    if (est.vat) lines.push('С ' + est.vat.label + ': ' + rangeText(est.vat.low, est.vat.high));
    lines.push('');
    lines.push('Расчёт: ' + shareUrl(state));
    return lines.join('\n'); // \n — перенос строки
  }

  // Скопировать текст в буфер обмена.
  // Современный способ (navigator.clipboard) работает только на https; для остальных случаев — запасной
  function copyText(text, okMessage) {
    const fallback = () => {
      // Старый способ: временное невидимое поле, выделяем текст и копируем командой браузера
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) toast(okMessage);
      else window.prompt('Скопируйте вручную:', text); // совсем не получилось — показываем текст в окне
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => toast(okMessage), fallback);
    } else {
      fallback();
    }
  }

  // Номер сметы из даты и времени: 261024-1146 (24.10.2026, 11:46)
  function printNumber(d) {
    const p = (n) => (n < 10 ? '0' : '') + n;
    return String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  // Готовим лист для печати (PDF): параметры, схема, таблица статей и итог.
  // Лист лежит в <div id="print-sheet"> и виден только при печати (см. @media print в CSS)
  function fillPrintSheet() {
    const est = E.estimate(state, C, now());
    const plan = P.build(planOptions(est));
    const d = now();
    const row = (k, v) => '<tr><th>' + esc(k) + '</th><td>' + esc(v) + '</td></tr>'; // строка таблицы параметров
    const params = [
      row('Формат', est.format.title),
      row('Гостей', est.g),
      row('Длительность', hoursText(est.hours)),
      row('Уровень', est.level.title),
      row('Дата', est.date && !est.date.past ? E.dateRu(est.date.iso) : 'не выбрана'),
      row('Площадка', est.venue.title),
      row('Питание', est.food.title + (est.drinks ? ', с алкоголем' : ''))
    ].join('');
    // Пояснение в той же строке, что и название статьи, — так смета помещается на один лист
    const lineRow = (l, sum) => '<tr><td>' + esc(l.title) + (l.note ? ' <small>— ' + esc(l.note) + '</small>' : '') + '</td><td>' + sum + '</td></tr>';
    const body = est.items.map((l) => lineRow(l, E.money(l.sum))).join('') +
      est.adjustments.map((l) => lineRow(l, E.signedMoney(l.sum))).join('') +
      lineRow(est.fee, E.money(est.fee.sum));
    // Контакты агентства — только заполненные
    const contacts = [C.contacts.phone, C.contacts.telegram ? '@' + C.contacts.telegram.replace(/^@/, '') : '', C.contacts.email].filter(Boolean).join(', ');
    $('#print-sheet').innerHTML =
      '<header class="ps__head"><span class="ps__brand">' + esc(C.brand) + '</span><span class="ps__no">Смета № ' + printNumber(d) + ' от ' + E.dateRu(E.todayISO(d)) + '</span></header>' +
      '<h1 class="ps__title">Предварительная смета: ' + esc(est.format.title) + '</h1>' +
      '<p class="ps__meta">' + esc(guestsText(est.g) + ', ' + hoursText(est.hours) + ', уровень «' + est.level.title + '»') + '</p>' +
      '<div class="ps__grid"><table class="ps__params">' + params + '</table><div class="ps__plan">' + plan.svg + '<p class="ps__fine">' + esc(plan.caption) + '</p></div></div>' +
      '<table class="ps__table"><thead><tr><th>Статья</th><th>Сумма</th></tr></thead><tbody>' + body + '</tbody></table>' +
      '<div class="ps__total"><b>Итого: ' + rangeText(est.low, est.high) + '</b>' + (est.vat ? ' без НДС' : '') +
      '<br>≈ ' + E.money(est.total) + ', около ' + E.money(est.perGuest) + ' на гостя' +
      (est.vat ? '<br>С ' + esc(est.vat.label) + ': ' + rangeText(est.vat.low, est.vat.high) : '') + '</div>' +
      '<p class="ps__fine">Расчёт ориентировочный и не является публичной офертой: итог зависит от даты, площадки и подрядчиков. Точную смету подготовит менеджер.' +
      (contacts ? ' Контакты: ' + esc(contacts) + '.' : '') + '<br>Открыть расчёт: ' + esc(shareUrl(state)) + '</p>';
    document.body.classList.add('has-print'); // при печати прячем сайт и показываем только лист
  }

  // Кнопка «PDF»: открываем окно печати браузера, там можно выбрать «Сохранить как PDF»
  function printEstimate() {
    fillPrintSheet();
    window.print();
  }
  // Если человек печатает через Ctrl+P, лист тоже подготовится
  window.addEventListener('beforeprint', fillPrintSheet);
  window.addEventListener('afterprint', () => document.body.classList.remove('has-print'));

  /* ======================= Уведомления ======================= */

  // Всплывающее сообщение внизу экрана на 3,2 секунды
  let toastTimer = 0;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('is-on');
    clearTimeout(toastTimer); // новое сообщение продлевает показ
    toastTimer = setTimeout(() => t.classList.remove('is-on'), 3200);
  }

  /* ======================= Контакты и график ======================= */

  // Контакты из config.js превращаем в ссылки: телефон звонит, Telegram открывает чат, почта — письмо.
  // Незаполненный контакт остаётся серой заглушкой вида [+7 (000) 000-00-00]
  function renderContacts() {
    const c = C.contacts || {};
    const tg = (c.telegram || '').replace(/^@/, '').trim();
    const map = {
      phone: c.phone ? { href: 'tel:' + c.phone.replace(/[^\d+]/g, ''), text: c.phone } : null, // в tel: только цифры и +
      telegram: tg ? { href: 'https://t.me/' + encodeURIComponent(tg), text: '@' + tg } : null,
      email: c.email ? { href: 'mailto:' + c.email, text: c.email } : null
    };
    $$('[data-contact]').forEach((el) => {
      const v = map[el.dataset.contact];
      if (!v) { el.classList.add('is-empty'); return; }
      const a = document.createElement('a');
      a.className = 'ctc__val';
      a.href = v.href;
      a.textContent = v.text;
      if (el.dataset.contact === 'telegram') { a.target = '_blank'; a.rel = 'noopener'; } // Telegram — в новой вкладке
      el.replaceWith(a);
    });
    // Часы работы из настроек: [8, 17] → «8:00 – 17:00»
    const sc = C.schedule;
    const fmt = (r) => r[0] + ':00 – ' + r[1] + ':00';
    const wd = $('[data-sched="weekday"]');
    const we = $('[data-sched="weekend"]');
    if (wd) wd.textContent = fmt(sc.weekday);
    if (we) we.textContent = fmt(sc.weekend);
    $$('[data-tz]').forEach((el) => { el.textContent = sc.tzLabel; });
  }

  // Текущие день недели и время в часовом поясе агентства (по умолчанию — Москва),
  // а не посетителя: человек из Новосибирска должен видеть, работаем ли мы сейчас
  function agencyNow() {
    const d = now();
    const parts = {};
    try {
      // Intl.DateTimeFormat умеет показывать время в любом часовом поясе
      new Intl.DateTimeFormat('en-GB', { timeZone: C.schedule.tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(d).forEach((x) => { parts[x.type] = x.value; });
    } catch (e) { /* без часового пояса — по местному времени */ }
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday); // 0 — воскресенье
    // mins — минуты от начала суток: 10:30 → 630
    return wd < 0 ? { wd: d.getDay(), mins: d.getHours() * 60 + d.getMinutes() } : { wd: wd, mins: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
  }
  // Часы работы для дня недели: суббота и воскресенье — выходные
  function hoursFor(wd) { return wd === 0 || wd === 6 ? C.schedule.weekend : C.schedule.weekday; }
  // На связи ли менеджеры сейчас и когда ответят
  function workStatus() {
    const t = agencyNow();
    const h = hoursFor(t.wd);
    if (t.mins >= h[0] * 60 && t.mins < h[1] * 60) return { open: true, wd: t.wd, text: 'На связи до ' + h[1] + ':00', next: '' };
    if (t.mins < h[0] * 60) return { open: false, wd: t.wd, text: 'Ответим сегодня с ' + h[0] + ':00', next: 'сегодня с ' + h[0] + ':00' };
    const nh = hoursFor((t.wd + 1) % 7); // рабочий день уже закончился — смотрим часы завтрашнего дня
    return { open: false, wd: t.wd, text: 'Ответим завтра с ' + nh[0] + ':00', next: 'завтра с ' + nh[0] + ':00' };
  }
  // Зелёная точка «на связи» в шапке и в контактах, подсветка сегодняшней строки графика
  function renderStatus() {
    const st = workStatus();
    $$('[data-status]').forEach((el) => {
      el.classList.toggle('is-open', st.open);
      el.querySelector('span').textContent = st.text + ' (' + C.schedule.tzLabel + ')';
    });
    const weekend = st.wd === 0 || st.wd === 6;
    $$('[data-sched-row]').forEach((row) => row.classList.toggle('is-today', (row.dataset.schedRow === 'weekend') === weekend));
  }

  /* ======================= Заявка на звонок ======================= */

  const lead = $('#lead-form');
  // Подписи для письма и сообщения в Telegram
  const CHANNELS = { phone: 'звонок', telegram: 'Telegram', email: 'почта' };
  const WHENS = { asap: 'как можно скорее', morning: 'утром', day: 'днём', weekend: 'в выходной' };

  // Маска телефона: «89991234567» → «+7 (999) 123-45-67»
  function maskPhone(v) {
    let d = String(v || '').replace(/\D/g, ''); // только цифры
    if (!d) return '';
    if (d[0] === '8') d = '7' + d.slice(1);     // 8 999… → 7 999…
    if (d[0] !== '7') d = '7' + d;              // начали с 9 — добавляем 7
    const r = d.slice(1, 11);                   // 10 цифр номера без кода страны
    let o = '+7';
    if (r.length) o += ' (' + r.slice(0, 3);    // код оператора
    if (r.length >= 3) o += ')';
    if (r.length > 3) o += ' ' + r.slice(3, 6);
    if (r.length > 6) o += '-' + r.slice(6, 8);
    if (r.length > 8) o += '-' + r.slice(8, 10);
    return o;
  }

  let prevPhone = ''; // что было в поле до последнего изменения
  $('#lead-phone').addEventListener('input', (ev) => {
    const el = ev.target;
    const raw = el.value;
    let m = maskPhone(raw);
    // Стёрли скобку или дефис — вместе с ними убираем последнюю цифру,
    // иначе маска тут же вернёт символ, и стереть номер не получится
    if (raw.length < prevPhone.length && m.replace(/\D/g, '') === prevPhone.replace(/\D/g, '')) {
      m = maskPhone(prevPhone.replace(/\D/g, '').slice(0, -1));
    }
    el.value = m;
    prevPhone = m;
    clearError('phone'); // человек исправляет — убираем красную ошибку
  });

  // Начали исправлять поле — убираем ошибку под ним
  ['name', 'email', 'telegram'].forEach((k) => {
    const id = k === 'telegram' ? 'lead-tg' : 'lead-' + k;
    $('#' + id).addEventListener('input', () => clearError(k));
  });
  $('#lead-consent').addEventListener('change', () => clearError('consent'));
  // Сменили способ связи — ошибки «укажите Telegram/почту» больше не актуальны
  $$('input[name="channel"]', lead).forEach((r) => r.addEventListener('change', () => { clearError('telegram'); clearError('email'); }));

  // Обёртка поля (data-field="name") и само поле ввода для ключа
  function fieldEl(key) { return $('[data-field="' + key + '"]', lead); }
  function inputFor(key) { return key === 'telegram' ? $('#lead-tg') : key === 'consent' ? $('#lead-consent') : $('#lead-' + key); }
  // Убрать ошибку под полем
  function clearError(key) {
    const f = fieldEl(key);
    if (!f) return;
    f.classList.remove('has-err');
    const err = $('#err-' + key);
    if (err) { err.hidden = true; err.textContent = ''; }
    const inp = inputFor(key);
    if (inp) inp.removeAttribute('aria-invalid');
  }
  // Показать ошибку под полем. aria-invalid сообщает экранному диктору, что поле заполнено неверно
  function showError(key, text) {
    const f = fieldEl(key);
    if (!f) return;
    f.classList.add('has-err');
    const err = $('#err-' + key);
    if (err) { err.hidden = false; err.textContent = text; }
    const inp = inputFor(key);
    if (inp) inp.setAttribute('aria-invalid', 'true');
  }

  // Собрать данные формы в один объект
  function leadData() {
    const val = (id) => $(id).value.trim(); // значение поля без пробелов по краям
    const channel = ($('input[name="channel"]:checked', lead) || {}).value || 'phone';
    const when = ($('input[name="when"]:checked', lead) || {}).value || 'asap';
    return {
      name: val('#lead-name'), phone: val('#lead-phone'), email: val('#lead-email'),
      // Telegram принимаем в любом виде: @user, user, https://t.me/user → user
      telegram: val('#lead-tg').replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, ''),
      message: val('#lead-msg'), consent: $('#lead-consent').checked, attach: $('#lead-attach').checked,
      website: $('#lead-website').value, // поле-ловушка: человек его не видит, а боты заполняют
      channel: channel, when: when
    };
  }

  // Проверка полей. Возвращает объект ошибок { поле: текст }; пустой объект — всё в порядке
  function validate(d) {
    const e = {};
    if (d.name.length < 2) e.name = 'Укажите имя';
    if (d.phone.replace(/\D/g, '').length !== 11) e.phone = 'Введите номер полностью: +7 и 10 цифр';
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) e.email = 'Проверьте адрес почты'; // что-то@что-то.зона
    if (d.telegram && !/^[A-Za-z0-9_]{5,32}$/.test(d.telegram)) e.telegram = 'Ник в Telegram — 5–32 латинские буквы, цифры или _';
    if (d.channel === 'telegram' && !d.telegram) e.telegram = 'Укажите Telegram — напишем туда';
    if (d.channel === 'email' && !d.email) e.email = 'Укажите почту — ответим туда';
    if (!d.consent) e.consent = 'Отметьте согласие на обработку данных — без него мы не можем принять заявку';
    return e;
  }

  // Данные заявки для сервера: контакты + расчёт (если отмечено «приложить мой расчёт»)
  function buildPayload(d) {
    const est = E.estimate(state, C, now());
    return {
      name: d.name, phone: d.phone, email: d.email, telegram: d.telegram,
      channel: d.channel, channelLabel: CHANNELS[d.channel], when: d.when, whenLabel: WHENS[d.when],
      message: d.message, website: d.website, consent: d.consent,
      estimate: d.attach ? {
        summary: est.format.title + ', ' + guestsText(est.g) + ', ' + hoursText(est.hours) + ', уровень «' + est.level.title + '»',
        date: est.date && !est.date.past ? E.dateRu(est.date.iso) : '',
        low: est.low, high: est.high, total: est.total,
        vat: est.vat ? { label: est.vat.label, low: est.vat.low, high: est.vat.high } : null,
        lines: est.items.concat(est.adjustments, [est.fee]).map((l) => ({ title: l.title, sum: l.sum })),
        link: shareUrl(state) // менеджер откроет ссылку и увидит тот же расчёт
      } : null,
      page: location.href.split('#')[0],
      sentAt: new Date().toISOString() // время отправки
    };
  }

  // Заявка простым текстом — для письма
  function leadText(p) {
    const rows = ['Заявка с сайта', 'Имя: ' + p.name, 'Телефон: ' + p.phone];
    if (p.telegram) rows.push('Telegram: @' + p.telegram);
    if (p.email) rows.push('Почта: ' + p.email);
    rows.push('Связаться: ' + p.channelLabel + ', ' + p.whenLabel);
    if (p.message) rows.push('Комментарий: ' + p.message);
    if (p.estimate) {
      rows.push('', 'Расчёт: ' + p.estimate.summary + (p.estimate.date ? ', ' + p.estimate.date : ''));
      rows.push('Вилка: ' + rangeText(p.estimate.low, p.estimate.high) + (p.estimate.vat ? ' без НДС' : ''));
      rows.push('Ссылка: ' + p.estimate.link);
    }
    return rows.join('\n');
  }

  // Кнопка «Заказать звонок» на время отправки: неактивна и пишет «Отправляем…»
  function setSending(on) {
    const b = $('#lead-submit');
    b.disabled = on;
    b.textContent = on ? 'Отправляем…' : 'Заказать звонок';
  }

  // Экран «Заявка отправлена» вместо формы.
  // mode: 'sent' — ушла на сервер, 'mail' — открыли письмо, 'demo' — отправка ещё не настроена
  function showDone(mode, d) {
    const st = workStatus();
    const how = d.channel === 'telegram' ? 'напишет в Telegram' : d.channel === 'email' ? 'ответит на почту' : 'позвонит';
    let title = 'Заявка отправлена';
    // Честно говорим, когда ждать ответа: сейчас или в ближайшее рабочее время
    let text = st.open
      ? 'Мы на связи — менеджер ' + how + ' в ближайшее время.'
      : 'Сейчас мы не на связи. Менеджер ' + how + ' ' + st.next + ' (' + C.schedule.tzLabel + ').';
    if (mode === 'mail') {
      title = 'Письмо готово';
      text = 'Мы открыли письмо с заявкой в вашей почтовой программе — проверьте его и нажмите «Отправить». Если письмо не открылось, напишите на ' + C.contacts.email + '.';
    } else if (mode === 'demo') {
      title = 'Заявка собрана';
      text = 'Отправка заявок ещё не настроена: укажите адрес в assets/js/config.js (lead.endpoint) или почту в contacts.email. Данные никуда не отправлялись.';
    }
    $('#lead-done-title').textContent = title;
    $('#lead-done-text').textContent = text;
    lead.hidden = true;
    const done = $('#lead-done');
    done.hidden = false;
    done.focus({ preventScroll: true }); // переводим фокус, чтобы экранный диктор прочитал результат
    $('#lead-card').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  }

  // Ошибка отправки: предлагаем написать в Telegram или на почту (письмо уже с текстом заявки)
  function showSendError(p) {
    const box = $('#lead-status');
    const c = C.contacts || {};
    const tg = (c.telegram || '').replace(/^@/, '');
    let alt = '';
    if (tg) alt += ' <a href="https://t.me/' + encodeURIComponent(tg) + '" target="_blank" rel="noopener">Telegram</a>';
    if (c.email) alt += (alt ? ' или' : '') + ' <a href="mailto:' + esc(c.email) + '?subject=' + encodeURIComponent('Заявка с сайта') + '&body=' + encodeURIComponent(leadText(p)) + '">почту</a>';
    box.innerHTML = 'Не удалось отправить заявку. Проверьте интернет и попробуйте ещё раз' + (alt ? ' — или напишите нам в' + alt : '') + '.';
    box.hidden = false;
  }

  // Отправка формы заявки
  lead.addEventListener('submit', (ev) => {
    ev.preventDefault(); // не перезагружаем страницу — отправляем сами
    $('#lead-status').hidden = true;
    const d = leadData();
    ['name', 'phone', 'email', 'telegram', 'consent'].forEach(clearError); // убираем старые ошибки
    const errors = validate(d);
    const keys = Object.keys(errors);
    if (keys.length) {
      keys.forEach((k) => showError(k, errors[k]));
      const first = inputFor(keys[0]);
      if (first) first.focus(); // ставим курсор в первое поле с ошибкой
      return;
    }
    const payload = buildPayload(d);
    if (d.website) { showDone('sent', d); return; } // поле-ловушка заполнено — это бот: делаем вид, что всё ушло

    const endpoint = C.lead && C.lead.endpoint;
    if (endpoint) {
      // Вариант 1: отправляем заявку на сервер (папка server/ — пересылает в Telegram)
      setSending(true);
      // AbortController прерывает запрос, если сервер не ответил за timeoutMs
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = setTimeout(() => ctrl && ctrl.abort(), (C.lead.timeoutMs || 12000));
      fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: ctrl ? ctrl.signal : undefined
      })
        // Сервер отвечает JSON вида { ok: true }; ошибка HTTP или ok: false — считаем неудачей
        .then((res) => res.json().catch(() => ({})).then((json) => {
          if (!res.ok || json.ok === false) throw new Error('bad response');
          showDone('sent', d);
        }))
        .catch(() => showSendError(payload))
        .finally(() => { clearTimeout(timer); setSending(false); });
    } else if (C.contacts && C.contacts.email) {
      // Вариант 2: сервера нет — открываем письмо с заявкой в почтовой программе посетителя
      location.href = 'mailto:' + C.contacts.email + '?subject=' + encodeURIComponent('Заявка с сайта: ' + d.name) + '&body=' + encodeURIComponent(leadText(payload));
      showDone('mail', d);
    } else {
      // Вариант 3: ничего не настроено — заявка видна только в консоли браузера (для проверки)
      try { console.info('[Заявка не отправлена: не настроен lead.endpoint]', payload); } catch (e) { /* консоль недоступна */ }
      showDone('demo', d);
    }
  });

  // «Отправить ещё одну заявку»: очищаем форму и показываем её снова
  function leadReset() {
    lead.reset();
    prevPhone = '';
    ['name', 'phone', 'email', 'telegram', 'consent'].forEach(clearError);
    $('#lead-status').hidden = true;
    $('#lead-done').hidden = true;
    lead.hidden = false;
    $('#lead-name').focus();
  }

  /* ======================= Меню и мобильная панель ======================= */

  // Кнопка меню на телефоне: открывает и закрывает список разделов
  const hdr = $('#hdr');
  const menuBtn = $('#menu-btn');
  menuBtn.addEventListener('click', () => {
    const open = !hdr.classList.contains('is-open');
    hdr.classList.toggle('is-open', open);
    menuBtn.setAttribute('aria-expanded', String(open)); // для экранных дикторов: меню открыто или закрыто
  });
  // Выбрали раздел — меню закрываем
  $$('.nav a').forEach((a) => a.addEventListener('click', () => {
    hdr.classList.remove('is-open');
    menuBtn.setAttribute('aria-expanded', 'false');
  }));

  // Панель со сметой внизу экрана на телефоне: видна, пока человек в калькуляторе,
  // и прячется, когда сама смета уже на экране.
  // IntersectionObserver сообщает, когда элемент появляется или исчезает из видимой области
  if ('IntersectionObserver' in window) {
    const seen = { calc: false, summary: false }; // что сейчас видно
    const bar = $('#mbar');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { seen[en.target.id] = en.isIntersecting; });
      bar.classList.toggle('is-visible', seen.calc && !seen.summary);
    }, { threshold: [0, 0.05] });
    io.observe($('#calc'));
    io.observe($('#summary'));
  }

  /* ======================= Запуск ======================= */

  buildControls();   // создать кнопки и варианты по настройкам
  syncControls();    // отметить выбранное
  update();          // посчитать смету и нарисовать
  renderHero();      // чертёж на первом экране
  renderExamples();  // примеры смет и таблица уровней
  renderContacts();  // контакты и часы работы
  renderStatus();    // «на связи / не на связи»
  setInterval(renderStatus, 60000); // обновлять статус раз в минуту
  $$('[data-year]').forEach((el) => { el.textContent = now().getFullYear(); }); // год в подвале

  // Открыли по ссылке с расчётом — сразу прокручиваем к калькулятору
  if (linked) {
    requestAnimationFrame(() => document.getElementById('calc').scrollIntoView({ block: 'start' }));
  }
})();
