import { formatDistanceToNow } from 'date-fns';
import { extendTailwindMerge, type ClassNameValue } from 'tailwind-merge';
import type { H3Event } from 'h3';
import type { IFetchNativeResponseError, IFetchResponseError } from '~~/server/types';

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const textSizes = [
  'label',
  'caption',
  'body',
  'heading',
  'metric',
  'metric-sm',
  'title',
  'display',
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: textSizes }],
    },
  },
});

export function mergeClasses(...classString: ClassNameValue[]) {
  return twMerge(classString);
}

export const formatBytes = (bytes?: number) => {
  if (!bytes) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

export const formatDuration = (milliseconds?: number) => {
  if (!milliseconds) {
    return '—';
  }

  const seconds = Math.round(milliseconds / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
};

export const formatRelativeTime = (value?: string | Date) => {
  if (!value) {
    return undefined;
  }

  return formatDistanceToNow(new Date(value), { addSuffix: true });
};

export const normalizeFetchErrorServer = (
  event: H3Event,
  err: unknown,
  returnUndefined?: boolean,
) => {
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const error = err as IFetchNativeResponseError;

    setResponseStatus(event, error.statusCode);

    if (!error.data || typeof error.data === 'string') {
      const filteredError: IFetchResponseError = {
        statusCode: error.statusCode,
        message: error.statusMessage,
      };

      return filteredError;
    }

    return error.data;
  }

  if (err instanceof Error) {
    setResponseStatus(event, 500);

    const apiUrl = process.env.URL_API;
    const message = apiUrl ? err.message?.replaceAll(apiUrl, '**') : err.message;

    return {
      statusCode: 500,
      message: message || 'Internal error',
    };
  }

  console.error('Internal error [...path.ts]', err);

  return returnUndefined
    ? undefined
    : {
        statusCode: 500,
        message: 'Internal error',
      };
};

export const removeUndefinedKeys = <T>(obj: T): T => {
  if (Array.isArray(obj)) {
    return obj.map(item => removeUndefinedKeys(item)).filter(item => item !== undefined) as T;
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};

    Object.entries(obj).forEach(([key, value]) => {
      const cleanedValue = removeUndefinedKeys(value);

      const isEmptyObject =
        cleanedValue &&
        typeof cleanedValue === 'object' &&
        !Array.isArray(cleanedValue) &&
        Object.keys(cleanedValue).length === 0;

      if (cleanedValue !== undefined && !isEmptyObject) {
        result[key] = cleanedValue;
      }
    });

    return result as T;
  }

  return obj;
};

export const hasValue = (value: any) => {
  if (value === undefined || value === null) {
    return false;
  }

  return true;
};

export const orDash = (value: any) =>
  value === null || value === undefined || value === '' ? '-' : value;

export type AnsiSegment = { text: string; style: string };

type AnsiState = {
  color?: string;
  background?: string;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
};

const ANSI_PALETTE = [
  '#4f5666',
  '#e05561',
  '#8cc265',
  '#d18f52',
  '#4aa5f0',
  '#c162de',
  '#42b3c2',
  '#d7dae0',
  '#6b7385',
  '#ff616e',
  '#a5e075',
  '#f0a45d',
  '#4dc4ff',
  '#de73ff',
  '#4cd1e0',
  '#ffffff',
];

const ANSI_SEQUENCE =
  // eslint-disable-next-line no-control-regex
  /\u001B(?:\[[0-9;?]*[ -/]*[@-~]|\][\s\S]*?(?:\u0007|\u001B\\)|[@-Z\\-_])/g;

const emptyAnsiState = (): AnsiState => ({
  color: undefined,
  background: undefined,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
});

const ansi256Color = (code = 0) => {
  if (code < 16) {
    return ANSI_PALETTE[code];
  }

  if (code > 231) {
    const level = 8 + (code - 232) * 10;

    return `rgb(${level} ${level} ${level})`;
  }

  const steps = [0, 95, 135, 175, 215, 255];
  const offset = code - 16;

  return `rgb(${steps[Math.floor(offset / 36)]} ${steps[Math.floor(offset / 6) % 6]} ${steps[offset % 6]})`;
};

const applyAnsiCodes = (state: AnsiState, codes: number[]) => {
  let index = 0;

  while (index < codes.length) {
    const code = codes[index] ?? 0;

    if (code === 0) {
      Object.assign(state, emptyAnsiState());
    } else if (code === 1) {
      state.bold = true;
    } else if (code === 2) {
      state.dim = true;
    } else if (code === 3) {
      state.italic = true;
    } else if (code === 4) {
      state.underline = true;
    } else if (code === 22) {
      state.bold = false;
      state.dim = false;
    } else if (code === 23) {
      state.italic = false;
    } else if (code === 24) {
      state.underline = false;
    } else if (code === 39) {
      state.color = undefined;
    } else if (code === 49) {
      state.background = undefined;
    } else if (code >= 30 && code <= 37) {
      state.color = ANSI_PALETTE[code - 30];
    } else if (code >= 90 && code <= 97) {
      state.color = ANSI_PALETTE[code - 82];
    } else if (code >= 40 && code <= 47) {
      state.background = ANSI_PALETTE[code - 40];
    } else if (code >= 100 && code <= 107) {
      state.background = ANSI_PALETTE[code - 92];
    } else if (code === 38 || code === 48) {
      const mode = codes[index + 1];
      const extended =
        mode === 5
          ? ansi256Color(codes[index + 2])
          : mode === 2
            ? `rgb(${codes[index + 2] ?? 0} ${codes[index + 3] ?? 0} ${codes[index + 4] ?? 0})`
            : undefined;

      if (code === 38) {
        state.color = extended;
      } else {
        state.background = extended;
      }

      index += mode === 5 ? 2 : mode === 2 ? 4 : 0;
    }

    index += 1;
  }
};

const ansiStateToStyle = (state: AnsiState) =>
  [
    state.color ? `color:${state.color}` : '',
    state.background ? `background-color:${state.background}` : '',
    state.bold ? 'font-weight:600' : '',
    state.dim ? 'opacity:0.65' : '',
    state.italic ? 'font-style:italic' : '',
    state.underline ? 'text-decoration:underline' : '',
  ]
    .filter(Boolean)
    .join(';');

const collapseCarriageReturns = (text: string) =>
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.slice(line.lastIndexOf('\r') + 1))
    .join('\n');

export const parseAnsi = (input: string): AnsiSegment[] => {
  const text = collapseCarriageReturns(input ?? '');
  const state = emptyAnsiState();
  const segments: AnsiSegment[] = [];

  let cursor = 0;

  const push = (value: string) => {
    if (value) {
      segments.push({ text: value, style: ansiStateToStyle(state) });
    }
  };

  for (const match of text.matchAll(ANSI_SEQUENCE)) {
    push(text.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    if (match[0].endsWith('m')) {
      applyAnsiCodes(
        state,
        match[0]
          .slice(2, -1)
          .split(';')
          .map(part => Number(part) || 0),
      );
    }
  }

  push(text.slice(cursor));

  return segments;
};

export const stripAnsi = (input: string) =>
  collapseCarriageReturns(input ?? '').replace(ANSI_SEQUENCE, '');

const hashName = (name: string) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (Math.imul(hash, 31) + name.charCodeAt(i)) | 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
};

export const getHueFromName = (name: string) => {
  if (!name?.trim()) {
    return {
      '--generated-hue': '0deg',
      '--generated-sat': '0%',
    };
  }

  const hash = hashName(name);
  const hue = hash % 360;
  const saturation = 55 + ((hash >>> 9) % 20);

  return {
    '--generated-hue': `${hue}deg`,
    '--generated-sat': `${saturation}%`,
  };
};

export const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const getColorFromName = (name: string) => {
  if (!name?.trim()) return `hsl(0 0% 55%)`;

  const hash = hashName(name);
  const hue = hash % 360;
  const saturation = 55 + ((hash >>> 9) % 20);
  const lightness = 45 + ((hash >>> 17) % 18);

  return `hsl(${hue} ${saturation}% ${lightness}%)`;
};
