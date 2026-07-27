export function formatMoney(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$${Math.abs(rounded).toLocaleString('en-US')}`;
}

export function formatSignedMoney(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${formatMoney(Math.abs(value))}`;
}

function compactMagnitude(value: number): string {
  if (value >= 999_500_000) {
    return `${Number((value / 1_000_000_000).toFixed(1))}B`;
  }
  if (value >= 999_500) {
    return `${Number((value / 1_000_000).toFixed(1))}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`;
  }
  return Math.round(value).toLocaleString('en-US');
}

export function formatCompactMoney(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$${compactMagnitude(Math.abs(rounded))}`;
}

export function formatCompactSignedMoney(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${compactMagnitude(Math.abs(Math.round(value)))}`;
}
