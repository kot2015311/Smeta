// Тесты расчёта и схемы зала: node --test tests/estimate.test.js  (Node.js 18+, без зависимостей)
const test = require('node:test');
const assert = require('node:assert/strict');

const C = require('../assets/js/config.js');
const E = require('../assets/js/estimate.js');
const P = require('../assets/js/plan.js');

const TODAY = new Date(2026, 9, 24); // 24 октября 2026
const base = {
  format: 'corporate', guests: 80, hours: 4, level: 'comfort',
  venue: 'loft', food: 'banquet', drinks: true, services: ['host', 'show', 'av']
};
const est = (patch) => E.estimate(Object.assign({}, base, patch), C, TODAY);
const sum = (list) => list.reduce((t, x) => t + x.sum, 0);

test('итог равен сумме всех строк сметы', () => {
  const e = est({ date: '2026-12-18' });
  assert.equal(e.total, sum(e.items) + sum(e.adjustments) + e.fee.sum);
  assert.ok(e.low < e.total && e.total < e.high);
});

test('уровни дорожают по порядку', () => {
  const [s, c, p] = ['standard', 'comfort', 'premium'].map((level) => est({ level }).total);
  assert.ok(s < c && c < p);
});

test('декабрь дороже, январь дешевле обычного месяца', () => {
  const oct = est({ date: '2027-10-15' }).total;
  assert.ok(est({ date: '2026-12-18' }).total > oct);
  assert.ok(est({ date: '2027-01-20' }).total < oct);
});

test('срочная подготовка — если до даты меньше двух недель', () => {
  const urgent = est({ date: '2026-10-30' });
  assert.ok(urgent.adjustments.some((a) => a.id === 'urgent'));
  assert.ok(!est({ date: '2026-11-20' }).adjustments.some((a) => a.id === 'urgent'));
});

test('прошедшая дата не влияет на цену', () => {
  const past = est({ date: '2026-10-01' });
  assert.equal(past.adjustments.length, 0);
  assert.equal(past.total, est({}).total);
  assert.ok(past.date.past);
});

test('подарки: скидка от количества и без сезонной наценки', () => {
  const g49 = E.price(C.services.find((s) => s.id === 'gifts'), { g: 49, h: 4, L: 0, hf: 1, tier: 1 });
  const g50 = E.price(C.services.find((s) => s.id === 'gifts'), { g: 50, h: 4, L: 0, hf: 1, tier: 1 });
  assert.equal(g49.sum, 49 * 1370);
  assert.equal(g50.sum, 50 * 1370 * 0.9);
  assert.match(g50.note, /скидка 10%/);
  const dec = est({ services: ['gifts'], date: '2026-12-18' });
  const season = dec.adjustments.find((a) => a.id === 'season');
  const seasonalBase = sum(dec.items.filter((i) => i.id !== 'gifts'));
  assert.equal(season.sum, Math.round(seasonalBase * 0.2 / 500) * 500);
});

test('гости ограничены рамками из настроек', () => {
  assert.equal(est({ guests: 3 }).g, C.guests.min);
  assert.equal(est({ guests: 9999 }).g, C.guests.max);
  assert.equal(est({ guests: 'abc' }).g, 50);
});

test('неизвестные услуги и повторы отбрасываются', () => {
  const e = est({ services: ['host', 'host', 'teleport'] });
  assert.deepEqual(e.ids.services, ['host']);
});

test('НДС считается от итога', () => {
  const e = est({});
  assert.equal(e.vat.total, Math.round(e.total * 1.22));
  assert.ok(e.vat.low > e.low && e.vat.high > e.high);
});

test('кофе-брейк: два перерыва при 6 часах и больше', () => {
  const four = est({ food: 'coffee', hours: 4 }).items.find((i) => i.id === 'food');
  const six = est({ food: 'coffee', hours: 6 }).items.find((i) => i.id === 'food');
  assert.equal(six.sum, four.sum * 2);
  assert.match(six.note, /2 перерыва/);
});

test('алкоголь считается только к фуршету или банкету', () => {
  assert.ok(est({ food: 'banquet' }).items.some((i) => i.id === 'drinks'));
  assert.ok(!est({ food: 'coffee' }).items.some((i) => i.id === 'drinks'));
});

test('своя площадка не попадает в смету', () => {
  assert.ok(!est({ venue: 'own' }).items.some((i) => i.id === 'venue'));
});

test('работа агентства не меньше минимума', () => {
  const tiny = E.estimate({ format: 'team', guests: 10, hours: 2, level: 'standard', venue: 'own', food: 'none', services: [] }, C, TODAY);
  assert.equal(tiny.fee.sum, C.agency.min);
});

test('склонения и форматирование', () => {
  assert.equal(E.plural(1, 'гость', 'гостя', 'гостей'), 'гость');
  assert.equal(E.plural(3, 'гость', 'гостя', 'гостей'), 'гостя');
  assert.equal(E.plural(11, 'гость', 'гостя', 'гостей'), 'гостей');
  assert.equal(E.plural(21, 'гость', 'гостя', 'гостей'), 'гость');
  assert.equal(E.fill('{n} {n|автобус|автобуса|автобусов}', { n: 2 }), '2 автобуса');
  assert.equal(E.money(1234567), '1 234 567 ₽');
  assert.equal(E.short(540000, 650000), '540–650 тыс. ₽');
  assert.equal(E.short(1500000, 1940000), '1,5–1,9 млн ₽');
});

test('дата из примера — ближайший будущий декабрь', () => {
  assert.equal(E.resolveDateRule({ month: 12, day: 19 }, TODAY, 15), '2026-12-19');
  assert.equal(E.resolveDateRule({ month: 12, day: 19 }, new Date(2026, 11, 10), 15), '2027-12-19');
});

test('схема зала рисует каждого гостя', () => {
  for (const layout of ['theatre', 'banquet', 'cocktail', 'teams']) {
    for (const guests of [10, 37, 80, 500]) {
      const plan = P.build({ layout, guests, stage: true, photo: true, reg: true, station: 'buffet', dj: true });
      assert.equal(plan.guests, guests, layout + ' ' + guests);
      assert.match(plan.svg, /^<svg[\s\S]*<\/svg>$/);
    }
  }
  assert.equal(P.build({ layout: 'banquet', guests: 80 }).tables, 8);
});

test('настройки цен корректны', () => {
  const ids = C.services.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'id услуг уникальны');
  const groups = C.groups.map((g) => g.id);
  const units = ['fixed', 'perGuest', 'perHour', 'perStaff', 'perStaffHour', 'perVehicle', 'basePlusGuest', 'perGuestSetup', 'none'];
  for (const def of [...C.services, ...C.venues, ...C.food, ...C.formats.map((f) => f.program)]) {
    assert.ok(units.includes(def.unit), 'неизвестный unit: ' + def.unit);
    if (def.unit !== 'none') {
      const prices = Array.isArray(def.price) ? def.price : [def.price];
      assert.ok(prices.every((x) => typeof x === 'number' && x > 0), 'цена должна быть числом');
    }
  }
  C.services.forEach((s) => assert.ok(groups.includes(s.group), 'нет группы ' + s.group));
  C.formats.forEach((f) => {
    assert.ok(C.venues.some((v) => v.id === f.defaults.venue));
    assert.ok(C.food.some((x) => x.id === f.defaults.food));
    f.defaults.services.forEach((id) => assert.ok(ids.includes(id), 'нет услуги ' + id));
  });
  C.presets.forEach((p) => assert.ok(E.estimate(p.state, C, TODAY).total > 0));
});
