import vendorErrors from './vendor-errors.en.json';

export interface ErrorText {
  code: number;
  title: string;
  content: string;
}

const table = vendorErrors as Record<string, { title: string; content: string }>;

/** Fallback labels for codes iRobot's own catalogue does not cover. */
const FALLBACK: Record<number, string> = {
  15: 'Internal error',
  16: 'Motion calibration needed',
  17: 'Could not finish cleaning',
  18: 'Docking trouble',
  19: 'Undocking failed',
  29: 'Software update needed',
  32: 'Smart map problem',
  40: 'Navigation problem',
  41: 'Mission timed out',
  46: 'Battery too low to clean',
  65: 'Hardware problem',
  74: 'Max area reached',
};

/**
 * iRobot's own error text (from the Roomba Home app's locale files) for a
 * cleanMissionStatus.error code, with `@val` replaced by the robot name.
 */
export function errorText(code: number | null | undefined, robotName = 'Roomba'): ErrorText | null {
  if (!code) return null;
  const row = table[String(code)];
  if (row) {
    return {
      code,
      title: row.title.replace(/@val/g, robotName),
      content: row.content.replace(/@val/g, robotName),
    };
  }
  return { code, title: FALLBACK[code] ?? `Error ${code}`, content: `${robotName} reported error code ${code}.` };
}

export const NOT_READY_LABELS: Record<number, string> = {
  0: 'Ready',
  1: 'Cliff detected',
  2: 'Both wheels dropped',
  3: 'Left wheel dropped',
  4: 'Right wheel dropped',
  6: 'Brush stalled',
  7: 'Bin missing',
  8: 'Bin full',
  12: 'Battery too low',
  13: 'Bin full',
  16: 'Charging / asleep',
  17: 'Invalid pad',
  31: 'Fill the tank',
  39: 'Pads being washed',
  68: 'Tank missing',
};

export function notReadyLabel(code: number | null | undefined): string | null {
  if (!code) return null;
  return NOT_READY_LABELS[code] ?? `Not ready (${code})`;
}
