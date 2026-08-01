import type { MasksPatternKeys } from './constants';
import { Mask } from 'maska';

export default {
  toFixedRound(value: number | string, decimals: number) {
    if (!value) {
      return value;
    }
    value = Number(value);
    const factor = Math.pow(10, decimals);
    return (Math.trunc(value * factor) / factor).toFixed(decimals);
  },
  mask(pattern: MasksPatternKeys | string | string[], value: string) {
    return new Mask({
      mask: MasksPattern[pattern as keyof typeof MasksPattern] ?? pattern,
    }).masked(value);
  },
  unmask(text: string) {
    return text.replace(/[-/().]/g, '').trim();
  },
  slugify(text: string): string {
    return text
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]+/g, '')
      .replace(/--+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
  },
  mapValues(value: string | string[], map: { [key: string]: string }) {
    if (Array.isArray(value)) {
      const mapped = value.map(itemValue => (map && map[itemValue] ? map[itemValue] : itemValue));

      return mapped.join(', ');
    }

    return map && map[value] ? map[value] : value;
  },
};
