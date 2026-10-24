/*
 * Настройки сайта: контакты, график работы, цены и услуги калькулятора.
 * Чтобы поменять цены или добавить услугу, достаточно править этот файл.
 *
 * Все цены — в рублях без НДС. Массив из трёх чисел — цены для уровней
 * [Стандарт, Комфорт, Премиум]. Одно число — одна цена для всех уровней.
 *
 * Как считается позиция (поле unit):
 *   fixed          — фиксированная сумма; scale: true — растёт для больших мероприятий (scaleTiers)
 *   perGuest       — цена × гости; min — минимальная сумма; discounts — скидки от количества
 *   perHour        — цена × часы; minHours — минимум часов
 *   perStaff       — цена × люди (один на perGuests гостей, не меньше minStaff) — за день
 *   perStaffHour   — цена × люди × часы
 *   perVehicle     — цена × транспорт (seats — мест в одном)
 *   basePlusGuest  — база + extra за каждого гостя сверх included
 *   perGuestSetup  — разовая сумма setup + цена × гости
 * Дополнительно:
 *   hourly: true   — сумма умножается на коэффициент длительности (hourFactor)
 *   breaks: true   — кофе-брейк: при 6+ часах считается два перерыва
 *   seasonal: false — сезонная наценка и срочность не применяются
 *
 * Пояснения (note) — шаблоны: {g} гости, {h} часы, {n} количество
 * (людей, автобусов, перерывов); {g|гость|гостя|гостей} — склонение по числу.
 */
(function (root) {
  'use strict';

  var CONFIG = {
    brand: 'Расчёт сметы', // название в PDF-смете (в шапке и подвале сайта оно записано в index.html)

    // Полный адрес сайта, например 'https://username.github.io/smeta/'.
    // Нужен для ссылки на расчёт в заявке и PDF. Пусто — берётся адрес открытой страницы.
    siteUrl: '',

    // Контакты. Пока поле пустое, на сайте показывается заглушка и ссылка не создаётся.
    contacts: {
      phone: '',     // как показывать на сайте: '+7 (999) 123-45-67'
      telegram: '',  // имя без @: 'agency_events'
      email: ''      // 'hello@agency.ru'
    },

    // Часы работы менеджеров (по поясу tz)
    schedule: { tz: 'Europe/Moscow', tzLabel: 'МСК', weekday: [8, 17], weekend: [10, 15] },

    // Куда отправлять заявки. Пример сервера для Telegram — в папке server/.
    // Пусто — заявка откроется письмом в почтовой программе на contacts.email.
    lead: { endpoint: '', timeoutMs: 12000 },

    vat: { rate: 0.22, label: 'НДС 22%' },  // null — не показывать сумму с НДС
    range: { low: 0.9, high: 1.15 },         // вилка вокруг расчёта

    // Гости: от min до max, шаг ползунка и кнопки быстрого выбора
    guests: { min: 10, max: 500, step: 5, presets: [20, 50, 100, 200, 300, 500] },
    hours: [2, 3, 4, 6, 8], // варианты длительности, часов
    // Во сколько раз дороже аренда площадки и техники (позиции с hourly: true) при такой длительности
    hourFactor: { 2: 0.7, 3: 0.85, 4: 1, 6: 1.25, 8: 1.5 },
    // Рост фиксированных позиций со scale: true: до 100 гостей ×1, до 200 ×1.25 и т. д.
    scaleTiers: [[100, 1], [200, 1.25], [350, 1.5], [100000, 1.8]],

    // Сезон: декабрь +20%, январь −10%. Срочность: меньше 14 дней до даты — +15%.
    season: { months: { 12: 0.2, 1: -0.1 }, urgentDays: 14, urgentPct: 0.15 },

    // Работа агентства: процент от сметы по уровням, но не меньше min
    agency: { title: 'Работа агентства', note: 'менеджер проекта, подрядчики и координация', pct: [0.10, 0.12, 0.15], min: 25000 },

    // Уровни организации. Порядок важен: цены-массивы в услугах идут в этом же порядке
    levels: [
      { id: 'standard', title: 'Стандарт', desc: 'Проверенные подрядчики, базовое оформление, чёткая программа' },
      { id: 'comfort', title: 'Комфорт', desc: 'Расширенная программа, продуманный декор и техника' },
      { id: 'premium', title: 'Премиум', desc: 'Авторская концепция, топовые площадки и артисты' }
    ],

    // layout — как рисовать схему зала: theatre (ряды), teams (команды), auto (по типу питания)
    formats: [
      {
        id: 'business', title: 'Деловое мероприятие', desc: 'Конференция, семинар, презентация, форум', icon: 'briefcase', layout: 'theatre',
        program: { title: 'Программа и модерация', unit: 'fixed', scale: true, price: [30000, 60000, 120000],
          note: ['сценарий и тайминг', 'сценарий, модерация, работа со спикерами', 'концепция, режиссура, подготовка спикеров'] },
        defaults: { hours: 6, venue: 'conference', food: 'coffee', drinks: false, services: ['host', 'av', 'screen', 'registration', 'photo', 'coord'] }
      },
      {
        id: 'corporate', title: 'Корпоратив', desc: 'Новый год, день компании, тематическая вечеринка', icon: 'glass', layout: 'auto',
        program: { title: 'Сценарий и режиссура', unit: 'fixed', scale: true, price: [40000, 90000, 200000],
          note: ['сценарий вечера и тайминг', 'концепция, сценарий, репетиция', 'авторская концепция и режиссура'] },
        defaults: { hours: 4, venue: 'loft', food: 'banquet', drinks: true, services: ['host', 'show', 'dj', 'av', 'decor', 'photo'] }
      },
      {
        id: 'offsite', title: 'Выездное мероприятие', desc: 'Выезд за город, стратегическая сессия, фестиваль для команды', icon: 'tent', layout: 'auto',
        program: { title: 'Программа выезда', unit: 'perGuest', price: [3000, 5000, 9000], min: [80000, 120000, 250000],
          note: ['активности на {g} {g|гостя|гостей|гостей}', 'программа дня и активности', 'авторская программа и режиссура'] },
        defaults: { hours: 8, venue: 'country', food: 'buffet', drinks: false, services: ['transfer', 'av', 'photo', 'coord'] }
      },
      {
        id: 'pr', title: 'PR и маркетинг', desc: 'Запуск продукта, пресс-событие, промоакция', icon: 'megaphone', layout: 'auto',
        program: { title: 'Креативная концепция', unit: 'fixed', scale: true, price: [60000, 150000, 350000],
          note: ['идея и сценарий', 'концепция, сценарий, работа с прессой', 'большая идея, режиссура и спецпроекты'] },
        defaults: { hours: 3, venue: 'loft', food: 'buffet', drinks: false, services: ['av', 'screen', 'decor', 'design', 'photo', 'video', 'promo'] }
      },
      {
        id: 'team', title: 'Тимбилдинг', desc: 'Квест, командная игра, спортивная программа', icon: 'flag', layout: 'teams',
        program: { title: 'Игровая программа', unit: 'perGuest', price: [2500, 4000, 6500], min: [60000, 90000, 160000],
          note: ['готовая игра, ведущие и реквизит', 'игра под цели команды', 'авторская игра и разбор итогов'] },
        defaults: { hours: 4, venue: 'loft', food: 'coffee', drinks: false, services: ['av', 'photo', 'coord'] }
      }
    ],

    // Площадки. unit: 'none' — без аренды (своя площадка); outdoor: true — на схеме рисуется шатёр
    venues: [
      { id: 'own', title: 'Своя площадка', desc: 'Офис или зал, который у вас уже есть', unit: 'none' },
      { id: 'loft', title: 'Лофт или банкетный зал', desc: 'Аренда площадки в городе', unit: 'perGuest', hourly: true,
        price: [1200, 2000, 3500], min: [40000, 70000, 150000], note: 'аренда на {h} ч' },
      { id: 'conference', title: 'Конференц-зал', desc: 'Бизнес-центр или отель с базовой техникой', unit: 'perGuest', hourly: true,
        price: [1500, 2500, 4000], min: [50000, 80000, 160000], note: 'аренда на {h} ч' },
      { id: 'country', title: 'Загородная площадка', desc: 'База отдыха, усадьба или шатёр на территории', unit: 'perGuest', hourly: true, outdoor: true,
        price: [2500, 4000, 7000], min: [80000, 140000, 300000], note: 'аренда территории на {h} ч' }
    ],

    // Питание. breaks: true — кофе-брейк: при 6+ часах два перерыва
    food: [
      { id: 'none', title: 'Без питания', desc: 'Питание организуете сами', unit: 'none' },
      { id: 'coffee', title: 'Кофе-брейк', desc: 'Напитки и лёгкие закуски', unit: 'perGuest', breaks: true,
        price: [900, 1500, 2500], min: [15000, 25000, 40000], note: '{n} {n|перерыв|перерыва|перерывов} на {g} {g|гостя|гостей|гостей}' },
      { id: 'buffet', title: 'Фуршет', desc: 'Закуски и горячее, гости общаются стоя', unit: 'perGuest',
        price: [3000, 4500, 7500], min: 50000, note: 'на {g} {g|гостя|гостей|гостей}, с обслуживанием' },
      { id: 'banquet', title: 'Банкет', desc: 'Рассадка за столами и подача блюд', unit: 'perGuest',
        price: [5500, 8000, 13000], min: 50000, note: 'на {g} {g|гостя|гостей|гостей}, с обслуживанием' }
    ],

    // Алкоголь — отдельный переключатель; onlyWith — к какому питанию его можно добавить
    drinks: { title: 'Алкогольные напитки', desc: 'Вино, игристое и крепкие напитки к фуршету или банкету', unit: 'perGuest',
      price: [1500, 2500, 4000], note: 'на {g} {g|гостя|гостей|гостей}', onlyWith: ['buffet', 'banquet'] },

    // Группы услуг в калькуляторе — в этом порядке они идут на странице и в смете
    groups: [
      { id: 'program', title: 'Программа' },
      { id: 'tech', title: 'Техника и трансляция' },
      { id: 'decor', title: 'Оформление' },
      { id: 'media', title: 'Фото и видео' },
      { id: 'team', title: 'Команда и логистика' },
      { id: 'gifts', title: 'Подарки' }
    ],

    // Услуги. group — в какой группе показывать, остальные поля описаны в начале файла
    services: [
      { id: 'host', group: 'program', title: 'Ведущий', desc: 'Ведёт программу и держит тайминг', unit: 'perHour', minHours: 2,
        price: [8000, 15000, 30000], note: '{h} {h|час|часа|часов} работы' },
      { id: 'show', group: 'program', title: 'Шоу и артисты', desc: 'Живая музыка, шоу-программа, артисты', unit: 'fixed',
        price: [60000, 150000, 400000], note: ['музыкант или кавер-дуэт', 'кавер-группа или шоу-программа', 'известные артисты и спецэффекты'] },
      { id: 'dj', group: 'program', title: 'Диджей', desc: 'Музыка на весь вечер', unit: 'fixed',
        price: [25000, 40000, 80000], note: ['музыка на весь вечер', 'плейлист под концепцию', 'диджей-хедлайнер'] },
      { id: 'workshop', group: 'program', title: 'Мастер-класс', desc: 'Кулинарный, творческий или винный', unit: 'perGuest',
        price: [2000, 2600, 3500], min: [30000, 40000, 60000], note: 'на {g} {g|гостя|гостей|гостей}' },

      { id: 'av', group: 'tech', title: 'Свет и звук', desc: 'Комплект с техником на площадке', unit: 'basePlusGuest', hourly: true, included: 50,
        price: [40000, 80000, 180000], extra: [250, 400, 700], note: 'комплект на {g} {g|гостя|гостей|гостей}' },
      { id: 'screen', group: 'tech', title: 'Экран и проектор', desc: 'Для презентаций, видео и трансляций в зале', unit: 'fixed',
        price: [25000, 45000, 90000], note: ['проектор, экран, микрофоны', 'большой экран, микрофоны, кликер', 'LED-экран и видеорежиссёр'] },
      { id: 'stream', group: 'tech', title: 'Онлайн-трансляция', desc: 'Для тех, кто подключится удалённо', unit: 'fixed',
        price: [60000, 120000, 250000], note: ['одна камера и звук с пульта', 'две камеры и графика', 'многокамерная съёмка и студия'] },

      { id: 'decor', group: 'decor', title: 'Декор и фотозона', desc: 'Оформление зала по концепции', unit: 'fixed', scale: true,
        price: [40000, 100000, 250000], note: ['фотозона и базовый декор', 'декор по концепции и фотозона', 'авторский декор и арт-объекты'] },
      { id: 'design', group: 'decor', title: 'Дизайн события', desc: 'Айдентика, приглашения, навигация', unit: 'fixed',
        price: [35000, 70000, 150000], note: ['приглашения и навигация', 'айдентика события и печать', 'полный фирменный стиль события'] },

      { id: 'photo', group: 'media', title: 'Фотограф', desc: 'Репортаж и обработка снимков', unit: 'perHour', minHours: 2,
        price: [5000, 8000, 15000], note: '{h} {h|час|часа|часов} съёмки и обработка' },
      { id: 'video', group: 'media', title: 'Видеоролик', desc: 'Ролик о мероприятии', unit: 'fixed',
        price: [30000, 60000, 150000], note: ['репортажный ролик на 1–2 минуты', 'ролик и интервью с гостями', 'фильм о событии'] },

      { id: 'coord', group: 'team', title: 'Координаторы', desc: 'Встречают гостей и решают вопросы на месте', unit: 'perStaff', perGuests: 50, minStaff: 1,
        price: [6000, 8000, 12000], note: '{n} {n|координатор|координатора|координаторов} на день' },
      { id: 'promo', group: 'team', title: 'Хостес и промоперсонал', desc: 'Встреча, навигация, работа со стендом', unit: 'perStaffHour', perGuests: 40, minStaff: 2,
        price: [600, 900, 1500], note: '{n} {n|человек|человека|человек} на {h} ч' },
      { id: 'registration', group: 'team', title: 'Регистрация гостей', desc: 'Списки, стойка регистрации, бейджи', unit: 'perGuestSetup',
        setup: [10000, 15000, 30000], price: [250, 400, 700], note: 'стойка и бейджи на {g} {g|гостя|гостей|гостей}' },
      { id: 'transfer', group: 'team', title: 'Трансфер', desc: 'Автобусы туда и обратно', unit: 'perVehicle', seats: 45,
        price: [28000, 35000, 50000], note: '{n} {n|автобус|автобуса|автобусов} туда и обратно' },

      { id: 'gifts', group: 'gifts', title: 'Подарки с логотипом', desc: 'Наборы для гостей, скидка от 50 штук', unit: 'perGuest', seasonal: false,
        price: [1370, 2200, 4900], discounts: [[300, 0.3], [150, 0.2], [50, 0.1]], note: '{g} шт.' }
    ],

    // Примеры смет. dateRule — ближайшая будущая дата с этим месяцем и днём.
    presets: [
      { id: 'conference', title: 'Конференция на 80 человек',
        state: { format: 'business', guests: 80, hours: 6, level: 'comfort', venue: 'conference', food: 'coffee', drinks: false,
          services: ['host', 'av', 'screen', 'registration', 'photo', 'coord'] } },
      { id: 'newyear', title: 'Новогодний корпоратив на 80 человек', dateRule: { month: 12, day: 19 },
        state: { format: 'corporate', guests: 80, hours: 4, level: 'comfort', venue: 'loft', food: 'banquet', drinks: true,
          services: ['host', 'show', 'dj', 'av', 'decor', 'photo', 'gifts'] } },
      { id: 'offsite', title: 'Выезд команды на 40 человек',
        state: { format: 'offsite', guests: 40, hours: 8, level: 'standard', venue: 'country', food: 'buffet', drinks: false,
          services: ['transfer', 'workshop', 'photo', 'coord'] } },
      { id: 'launch', title: 'Запуск продукта на 120 гостей',
        state: { format: 'pr', guests: 120, hours: 3, level: 'comfort', venue: 'loft', food: 'buffet', drinks: false,
          services: ['av', 'screen', 'decor', 'design', 'photo', 'video', 'promo', 'stream'] } }
    ]
  };

  if (typeof module === 'object' && module.exports) module.exports = CONFIG;
  else root.SMETA_CONFIG = CONFIG;
})(typeof self !== 'undefined' ? self : this);
