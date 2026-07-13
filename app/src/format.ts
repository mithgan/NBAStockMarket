export function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

export function formatSignedMoney(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${formatMoney(Math.abs(value))}`;
}
