const MONEY_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;

function normalizedInput(value) {
  return String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
}

/** Parse a user-entered yuan value into an exact integer number of fen. */
export function parseYuanToFen(value, { allowZero = false } = {}) {
  const match = MONEY_PATTERN.exec(normalizedInput(value));
  if (!match) return null;
  const [, integerPart, fractionalPart = ''] = match;
  const yuan = Number(integerPart);
  if (!Number.isSafeInteger(yuan)) return null;
  const fen = yuan * 100 + Number(fractionalPart.padEnd(2, '0'));
  if (!Number.isSafeInteger(fen) || fen < 0 || (!allowZero && fen === 0)) return null;
  return fen;
}

export function yuanToFen(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
}

export function amountFenOf(item) {
  if (Number.isSafeInteger(item?.amountFen)) return item.amountFen;
  return yuanToFen(item?.amount);
}

export function periodFenOf(period, field) {
  const fenField = `${field}Fen`;
  if (Number.isSafeInteger(period?.[fenField])) return period[fenField];
  return yuanToFen(period?.[field]);
}

export function fenToYuan(fen) {
  return (Number(fen) || 0) / 100;
}

export function roundRationalFen(numerator, denominator = 1) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.round(numerator / denominator);
}

export function formatFenInput(fen) {
  const sign = fen < 0 ? '-' : '';
  const absolute = Math.abs(Number(fen) || 0);
  const yuan = Math.floor(absolute / 100);
  const remainder = String(absolute % 100).padStart(2, '0').replace(/0+$/, '');
  return `${sign}${yuan}${remainder ? `.${remainder}` : ''}`;
}
