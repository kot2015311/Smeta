/*
 * Схема зала в SVG: рассадка гостей под формат мероприятия.
 *
 * Чистые функции, как и в estimate.js: в браузере — window.SmetaPlan,
 * в Node.js — require('./plan.js') (так схему проверяют тесты).
 *
 * build({ layout, guests, stage, screen, light, dj, photo, reg, station, outdoor, animate })
 *   layout:  'theatre' — ряды стульев, 'banquet' — круглые столы по 10,
 *            'cocktail' — коктейльные столы по 5, 'teams' — команды по 10
 *   stage, screen, light, dj — сцена, экран, свет, место диджея
 *   photo, reg — фотозона и стойка регистрации
 *   station: 'buffet' | 'coffee' | null — линия фуршета или кофе-брейка у стены
 *   outdoor  — загородная площадка: вместо стен пунктирный шатёр
 *   animate  — схема «чертится» при появлении (только на первом экране)
 * → { svg: разметка, caption: подпись, area: площадь в м², tables: столов, guests: нарисовано гостей }
 *
 * Координаты — в «точках» холста 400 × 250 (viewBox). Браузер сам масштабирует
 * картинку под ширину блока, поэтому все размеры ниже условные, не пиксели экрана.
 */

// Обёртка UMD: модуль работает и в браузере, и в Node.js (подробнее — в начале estimate.js)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SmetaPlan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const W = 400; // ширина холста
  const H = 250; // высота холста
  const ROOM = { x0: 10, y0: 10, x1: 390, y1: 240 }; // самый большой зал; меньшие — пропорционально площади
  const NB = ' '; // неразрывный пробел

  // Склонение по числу (копия из estimate.js, чтобы модуль не зависел от других файлов)
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100;
    const d = a % 10;
    if (a > 10 && a < 20) return many;
    if (d > 1 && d < 5) return few;
    if (d === 1) return one;
    return many;
  }
  // Округление до десятых: в SVG не нужны координаты вида 123.456789
  function r1(v) { return Math.round(v * 10) / 10; }
  // Экранирование текста для вставки в разметку: «<» и «&» не должны ломать SVG
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // Подпись на схеме (текст по центру точки x, y); rotate — поворот в градусах
  function label(x, y, text, cls, rotate) {
    const tr = rotate ? ' transform="rotate(' + rotate + ' ' + r1(x) + ' ' + r1(y) + ')"' : '';
    return '<text class="pl-label' + (cls ? ' ' + cls : '') + '" x="' + r1(x) + '" y="' + r1(y) + '" text-anchor="middle" dominant-baseline="central"' + tr + '>' + esc(text) + '</text>';
  }
  // Прямоугольник: сцена, зоны, линия фуршета.
  // pathLength="1" нужен для анимации «вычерчивания». Пунктирным линиям его не ставим:
  // с ним штрих растягивается на весь контур, и пунктир выглядит сплошной линией
  function rect(x, y, w, h, cls, rx) {
    const dashed = (cls.indexOf('pl-zone') > -1 && cls.indexOf('pl-zone--solid') < 0) || cls.indexOf('pl-wall--tent') > -1;
    return '<rect class="' + cls + '" x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(w) + '" height="' + r1(h) + '"' + (rx ? ' rx="' + rx + '"' : '') + (dashed ? '' : ' pathLength="1"') + '/>';
  }

  // Гости — оранжевые точки. Собираем их отдельно от столов, чтобы нарисовать поверх.
  // anim: у каждой точки свой номер --i, по нему CSS задерживает появление (гости «рассаживаются» по очереди)
  function makeGuests(anim) {
    let i = 0;       // сколько гостей уже нарисовано
    const out = [];  // кусочки SVG-разметки
    return {
      add: function (x, y, r) { // добавить гостя в точку x, y радиусом r
        out.push('<circle class="pl-guest" cx="' + r1(x) + '" cy="' + r1(y) + '" r="' + r1(r) + '"' + (anim ? ' style="--i:' + i + '"' : '') + '/>');
        i++;
      },
      count: function () { return i; },            // сколько всего гостей
      svg: function () { return out.join(''); }     // готовая разметка
    };
  }

  // Театральная рассадка: ряды лицом к сцене с проходом посередине.
  // A — свободная область зала { x, y, w, h }, g — гостей
  function theatre(A, g, guests) {
    const aisle = 14; // ширина центрального прохода
    // Сколько мест в ряду, чтобы блок кресел повторял пропорции зала
    let perRow = Math.ceil(Math.sqrt(g * A.w / A.h));
    perRow = Math.max(4, perRow + (perRow % 2)); // чётное число: поровну слева и справа от прохода
    const rows = Math.ceil(g / perRow);           // сколько рядов
    const p = Math.min(13, (A.w - aisle) / perRow, A.h / rows); // шаг между креслами (не больше 13)
    const half = perRow / 2;                      // мест в половине ряда
    const blockW = perRow * p + aisle;            // ширина блока кресел с проходом
    const x0 = A.x + (A.w - blockW) / 2 + p / 2;  // центр первого кресла: блок выравниваем по центру
    const y0 = A.y + p / 2 + Math.max(0, (A.h - rows * p) * 0.2); // первые ряды ближе к сцене
    const dot = Math.max(1, p * 0.3);             // радиус точки-гостя
    let placed = 0;                               // сколько гостей уже рассадили
    for (let row = 0; row < rows; row++) {
      const inRow = Math.min(perRow, g - placed); // в последнем ряду может быть меньше мест
      const left = Math.ceil(inRow / 2);          // мест слева от прохода
      const right = inRow - left;                 // мест справа
      const y = y0 + row * p;
      // Левую половину прижимаем к проходу, правую — тоже, чтобы неполный ряд был по центру
      for (let i = 0; i < left; i++) guests.add(x0 + (half - left + i) * p, y, dot);
      for (let i = 0; i < right; i++) guests.add(x0 + half * p + aisle + i * p, y, dot);
      placed += inRow;
    }
    return { svg: '', count: 0 }; // у театральной рассадки нет столов
  }

  // Столы и группы: banquet — 10 за круглым столом, cocktail — 5 у высокого стола, teams — команды по 10.
  // numbers — подписывать номера столов (только у банкета и только если столы крупные)
  function groups(A, g, kind, guests, numbers) {
    const per = kind === 'cocktail' ? 5 : 10;  // гостей за одним столом / в команде
    const n = Math.ceil(g / per);              // сколько нужно столов
    const stagger = kind === 'cocktail';       // коктейльные столы ставим в шахматном порядке
    const maxC = kind === 'banquet' ? 64 : kind === 'teams' ? 60 : 46; // максимальный шаг между столами
    // Колонки и ряды подбираем так, чтобы сетка столов повторяла пропорции зала
    const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n * A.w / A.h))));
    const rows = Math.ceil(n / cols);
    const rowK = stagger ? 0.9 : 1;            // в шахматном порядке ряды можно поставить плотнее
    // c — шаг между центрами столов: всё должно поместиться и по ширине, и по высоте
    const c = Math.min(maxC, A.w / (cols + (stagger && rows > 1 ? 0.5 : 0)), A.h / (rows * rowK));
    const rowH = c * rowK;                                  // расстояние между рядами
    const y0 = A.y + (A.h - rows * rowH) / 2 + rowH / 2;    // центр первого ряда: сетка по центру зала
    // Геометрия стола: радиус стола, радиус точки-гостя и зазор между ними — в долях от шага c
    const geo = kind === 'banquet'
      ? { table: c * 0.24, dot: Math.max(1.1, c * 0.052), gap: c * 0.035 }
      : kind === 'cocktail'
        ? { table: c * 0.15, dot: Math.max(1, c * 0.06), gap: c * 0.03 }
        : { table: 0, dot: Math.max(1, c * 0.05), gap: c * 0.3 - Math.max(1, c * 0.05) }; // у команды вместо стола — флажок
    const out = [];  // разметка столов и флажков
    let left = g;    // сколько гостей ещё не рассажено
    let k = 0;       // номер стола
    for (let row = 0; row < rows; row++) {
      const inRow = Math.min(cols, n - row * cols);           // столов в этом ряду
      const shift = stagger && row % 2 ? c / 2 : 0;           // каждый второй ряд сдвигаем на полшага
      const rowW = inRow * c + (stagger && rows > 1 ? c / 2 : 0);
      const x0 = A.x + (A.w - rowW) / 2 + c / 2 + shift;      // ряд — по центру зала
      for (let i = 0; i < inRow; i++) {
        const cx = x0 + i * c;            // центр стола
        const cy = y0 + row * rowH;
        const seats = Math.min(per, left); // за последним столом может быть меньше гостей
        left -= seats;
        k++;
        if (kind === 'teams') {
          // Флажок команды: древко и треугольный флаг
          const s = c * 0.09;
          out.push('<path class="pl-flag" d="M' + r1(cx - s * 0.4) + ' ' + r1(cy + s) + 'V' + r1(cy - s) + 'l' + r1(s * 1.3) + ' ' + r1(s * 0.5) + 'l-' + r1(s * 1.3) + ' ' + r1(s * 0.5) + '"/>');
        } else {
          out.push('<circle class="pl-table' + (kind === 'cocktail' ? ' pl-table--high' : '') + '" cx="' + r1(cx) + '" cy="' + r1(cy) + '" r="' + r1(geo.table) + '" pathLength="1"/>');
          if (numbers && kind === 'banquet' && c >= 40) out.push(label(cx, cy + 0.5, k, 'pl-num')); // номер стола
        }
        // Гостей расставляем по кругу вокруг стола, начиная сверху (угол −90°)
        const ring = geo.table + geo.gap + geo.dot; // радиус круга, по которому сидят гости
        for (let j = 0; j < seats; j++) {
          const a = -Math.PI / 2 + (2 * Math.PI * j) / seats; // угол для j-го гостя
          guests.add(cx + Math.cos(a) * ring, cy + Math.sin(a) * ring, geo.dot);
        }
      }
    }
    return { svg: out.join(''), count: n };
  }

  // Площадь на одного гостя по типу рассадки, м² (средние нормы для залов)
  const AREA = { theatre: 0.9, banquet: 1.7, cocktail: 1.2, teams: 2.5 };

  // Подпись под схемой: «8 столов по 10 гостей» и т. п.
  function caption(o, g, count) {
    let main;
    if (o.layout === 'theatre') main = 'Театральная рассадка на ' + g + NB + plural(g, 'место', 'места', 'мест');
    else if (o.layout === 'banquet') main = count + NB + plural(count, 'стол', 'стола', 'столов') + (g % 10 === 0 ? ' по 10 гостей' : ', до 10 гостей за столом');
    else if (o.layout === 'teams') main = count + NB + plural(count, 'команда', 'команды', 'команд') + (g % 10 === 0 ? ' по 10 человек' : ' до 10 человек');
    else main = count + NB + plural(count, 'коктейльный стол', 'коктейльных стола', 'коктейльных столов');
    return main;
  }

  // Главная функция: параметры → готовая SVG-схема с подписью
  function build(opts) {
    const o = Object.assign({ layout: 'banquet', guests: 50 }, opts || {}); // значения по умолчанию
    if (!AREA[o.layout]) o.layout = 'banquet'; // неизвестная рассадка → банкет
    const g = Math.max(1, Math.round(o.guests)); // хотя бы один гость

    // Площадь зала: гости по норме + сцена, место диджея, фотозона, регистрация и линия питания
    let area = g * AREA[o.layout] + (o.stage ? 24 : 0) + (o.dj ? 6 : 0) + (o.photo ? 9 : 0) + (o.reg ? 6 : 0) + (o.station ? 8 : 0);
    area = Math.ceil(area / 10) * 10; // округляем вверх до 10 м²
    // Маленький зал рисуем меньше большого: размер комнаты на схеме растёт как корень из площади.
    // kx, ky — доля от самого большого зала по ширине и высоте (с нижними пределами, чтобы всё помещалось)
    const kk = Math.sqrt(area / 260);
    const kx = Math.min(1, Math.max(0.5, kk));
    const ky = Math.min(1, Math.max(0.72, kk * 1.15));
    const rw = (ROOM.x1 - ROOM.x0) * kx; // ширина комнаты
    const rh = (ROOM.y1 - ROOM.y0) * ky; // высота комнаты
    // Комната по центру холста
    const R = { x0: r1(W / 2 - rw / 2), x1: r1(W / 2 + rw / 2), y0: r1(H / 2 - rh / 2), y1: r1(H / 2 + rh / 2) };

    const parts = [];    // стены и дверь
    const fixtures = []; // сцена, экран, свет, зоны, линия питания
    const labels = [];   // подписи
    const doorW = 28;    // ширина двери
    const cx = (R.x0 + R.x1) / 2;       // центр комнаты по горизонтали
    const doorX = r1(cx - doorW / 2);   // дверь — посередине нижней стены

    if (o.outdoor) {
      // Загородная площадка: шатёр со скруглёнными углами (пунктир задаёт CSS)
      parts.push(rect(R.x0 + 2, R.y0 + 2, rw - 4, rh - 4, 'pl-wall pl-wall--tent', 22));
    } else {
      // Стены: одна линия от правого края двери по кругу до левого края двери
      parts.push('<path class="pl-wall" pathLength="1" d="M' + (doorX + doorW) + ' ' + R.y1 + 'H' + R.x1 + 'V' + R.y0 + 'H' + R.x0 + 'V' + R.y1 + 'H' + doorX + '"/>');
      // Дверь: створка и дуга открывания, как на строительных чертежах
      parts.push('<path class="pl-door" pathLength="1" d="M' + doorX + ' ' + R.y1 + 'V' + r1(R.y1 - doorW) + 'A' + doorW + ' ' + doorW + ' 0 0 1 ' + (doorX + doorW) + ' ' + R.y1 + '"/>');
    }

    let top = R.y0 + 14; // верхняя граница области для гостей
    if (o.stage) {
      const sw = Math.min(150, rw * 0.42); // ширина сцены — не больше 42% ширины зала
      const sh = 22;                       // глубина сцены
      const sx = cx - sw / 2;              // сцена по центру у верхней стены
      fixtures.push(rect(sx, R.y0, sw, sh, 'pl-stage'));
      labels.push(label(cx, R.y0 + sh / 2 + (o.screen ? 2 : 0), 'Сцена'));
      // Экран — толстая линия у задней стены сцены
      if (o.screen) fixtures.push('<path class="pl-screen" pathLength="1" d="M' + r1(sx + sw * 0.15) + ' ' + (R.y0 + 4) + 'H' + r1(sx + sw * 0.85) + '"/>');
      if (o.light) {
        // Свет — два треугольника-прибора по краям сцены
        [sx + 12, sx + sw - 12].forEach(function (x) {
          fixtures.push('<path class="pl-light" d="M' + r1(x) + ' ' + r1(R.y0 + sh + 3) + 'l4 7h-8z"/>');
        });
      }
      if (o.dj) {
        // Место диджея справа от сцены, а если не помещается — слева
        const fitsRight = sx + sw + 12 + 34 <= R.x1 - 6;
        const dx = fitsRight ? sx + sw + 12 : sx - 12 - 34;
        fixtures.push(rect(dx, R.y0 + 3, 34, 16, 'pl-zone pl-zone--solid', 2));
        labels.push(label(dx + 17, R.y0 + 11, 'DJ'));
      }
      top = R.y0 + sh + 16; // гости начинаются ниже сцены
    }

    // Нижняя граница области для гостей: у двери оставляем проход
    let bottom = o.outdoor ? R.y1 - 14 : R.y1 - 32;
    if (o.photo || o.reg) bottom = R.y1 - 42; // внизу есть зоны — поднимаем границу ещё выше
    const half = rw / 2 - doorW / 2;          // ширина стены слева (и справа) от двери
    if (o.photo) {
      // Фотозона — в левом нижнем углу
      const pw = Math.min(76, half - 18);
      fixtures.push(rect(R.x0 + 12, R.y1 - 34, pw, 22, 'pl-zone', 3));
      labels.push(label(R.x0 + 12 + pw / 2, R.y1 - 23, 'Фотозона'));
    }
    if (o.reg) {
      // Стойка регистрации — сразу справа от входа
      const regW = Math.min(72, half - 20);
      const rx = doorX + doorW + 14;
      fixtures.push(rect(rx, R.y1 - 26, regW, 14, 'pl-zone pl-zone--solid', 2));
      labels.push(label(rx + regW / 2, R.y1 - 19, 'Регистрация', 'pl-label--s'));
    }

    let right = R.x1 - 12; // правая граница области для гостей
    if (o.station) {
      // Линия фуршета или кофе-брейка — вдоль правой стены, подпись повёрнута на 90°
      const stx = R.x1 - 30;
      const sth = bottom - top;
      fixtures.push(rect(stx, top, 18, sth, 'pl-station', 2));
      labels.push(label(stx + 9, top + sth / 2, o.station === 'coffee' ? 'Кофе-брейк' : 'Фуршет', '', 90));
      right = stx - 10;
    }
    const left = R.x0 + 12;
    const A = { x: left, y: top, w: right - left, h: bottom - top }; // свободная область для рассадки

    const guests = makeGuests(!!o.animate);
    // Рассаживаем гостей: ряды для театра, иначе столы или команды
    const seats = o.layout === 'theatre' ? theatre(A, g, guests) : groups(A, g, o.layout, guests, true);
    const text = caption(o, g, seats.count) + (o.outdoor ? ', площадка от ≈' : ', зал от ≈') + NB + area + NB + 'м²';

    // Собираем SVG. Порядок слоёв важен: позже нарисованное оказывается сверху.
    // role="img" и aria-label — чтобы экранный диктор прочитал подпись схемы
    const svg = '<svg class="plan' + (o.animate ? ' plan--draw' : '') + (o.outdoor ? ' plan--outdoor' : '') + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc('Схема зала: ' + text) + '" xmlns="http://www.w3.org/2000/svg">' +
      '<g class="pl-room">' + parts.join('') + '</g>' +        // стены
      '<g class="pl-fixtures">' + fixtures.join('') + '</g>' + // сцена и зоны
      '<g class="pl-seats">' + seats.svg + '</g>' +            // столы
      '<g class="pl-guests">' + guests.svg() + '</g>' +        // гости
      '<g class="pl-labels">' + labels.join('') + '</g>' +     // подписи
      '</svg>';

    return { svg: svg, caption: text, area: area, tables: seats.count, guests: guests.count() };
  }

  // Что модуль отдаёт наружу
  return { build: build };
});
