const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseLocalDate(dateKey) {
  const match = DATE_KEY_PATTERN.exec(String(dateKey));
  if (!match) throw new TypeError(`Некорректная дата: ${dateKey}`);
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new RangeError(`Несуществующая дата: ${dateKey}`);
  }
  date.setHours(12, 0, 0, 0);
  return date;
}

export function formatDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new TypeError('Ожидалась корректная Date');
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayDateKey(now = new Date()) {
  return formatDateKey(now);
}

/** Date-only budget keys must follow Guangzhou time, independent of device timezone. */
export function todayDateKeyInTimeZone(now = new Date(), timeZone = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDays(dateKey, amount) {
  if (!Number.isInteger(amount)) throw new TypeError('Количество дней должно быть целым');
  const date = parseLocalDate(dateKey);
  date.setDate(date.getDate() + amount);
  return formatDateKey(date);
}

export function compareDateKeys(left, right) {
  parseLocalDate(left);
  parseLocalDate(right);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function inclusiveDayCount(startDate, endDate) {
  if (compareDateKeys(startDate, endDate) > 0) throw new RangeError('Дата начала позже даты окончания');
  let count = 1;
  let cursor = startDate;
  while (cursor !== endDate) {
    cursor = addDays(cursor, 1);
    count += 1;
  }
  return count;
}

export function generateDateRange(startDate, endDate) {
  const count = inclusiveDayCount(startDate, endDate);
  return Array.from({ length: count }, (_, index) => addDays(startDate, index));
}

export function formatDateRange(startDate, endDate, locale = 'ru-RU') {
  const formatter = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  return `${formatter.format(parseLocalDate(startDate))} — ${formatter.format(parseLocalDate(endDate))}`;
}
