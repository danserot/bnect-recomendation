export const numeric = (value: number | null, digits = 2) =>
  value === null
    ? '—'
    : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
export const dateLabel = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
    : '—';
export const money = (value: number | null, currency: string | null) =>
  `${numeric(value)}${currency ? ` ${currency}` : ''}`;
