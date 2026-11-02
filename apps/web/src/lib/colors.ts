import type { Risk } from '@bank/shared';

export const CATEGORY_PALETTE = [
  '#0F3D33',
  '#C7A667',
  '#4F6B5E',
  '#8C5A4A',
  '#3C6E63',
  '#9A7A3E',
  '#5C6B8A',
  '#A34B3E',
  '#6B7A5A',
  '#2E6B8A',
];

export function categoryColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length]!;
}

export function riskColor(risk: Risk): string {
  if (risk === 'RED') return '#B3392E';
  if (risk === 'YELLOW') return '#C9791F';
  return '#2F7D5B';
}

export function riskBackground(risk: Risk): string {
  if (risk === 'RED') return 'rgba(179,57,46,.08)';
  if (risk === 'YELLOW') return 'rgba(201,121,31,.09)';
  return 'rgba(47,125,91,.09)';
}
