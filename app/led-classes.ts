import type { LedColor } from '../engine/types';

const LED_COLOR_CLASSES: Record<LedColor, string> = {
  green: 'led-color--green',
  red: 'led-color--red',
  blue: 'led-color--blue',
  yellow: 'led-color--yellow',
  orange: 'led-color--orange',
  purple: 'led-color--purple',
  dark_red: 'led-color--dark-red',
  dark_blue: 'led-color--dark-blue',
  gray: 'led-color--gray',
  red_blink: 'led-color--red-blink',
  off: 'led-color--off',
};

export function ledColorClass(color: LedColor): string {
  return LED_COLOR_CLASSES[color];
}
