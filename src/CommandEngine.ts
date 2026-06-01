import type { Point } from './DrawingCanvas';

export type CommandType = 'LINE' | 'CIRCLE' | 'RECTANGLE' | 'MOVE' | 'COPY' | 'TRIM' | 'ROTATE' | 'SCALE' | 'MIRROR' | 'OFFSET' | 'PAN' | null;

export const parseCoordinate = (input: string, lastPoint?: Point): Point | number | string | null => {
  const cleanInput = input.trim().toUpperCase();
  
  // Check for specific sub-commands
  if (cleanInput === 'U' || cleanInput === 'UNDO') return 'UNDO';
  if (cleanInput === 'C' || cleanInput === 'CLOSE') return 'CLOSE';

  // Match Absolute: 5,5
  const absoluteMatch = cleanInput.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (absoluteMatch) {
    return {
      x: parseFloat(absoluteMatch[1]),
      y: parseFloat(absoluteMatch[2])
    };
  }

  // Match Relative: @5,5
  const relativeMatch = cleanInput.match(/^@(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (relativeMatch && lastPoint) {
    return {
      x: lastPoint.x + parseFloat(relativeMatch[1]),
      y: lastPoint.y + parseFloat(relativeMatch[2])
    };
  }

  // Match Polar: @5<45
  const polarMatch = cleanInput.match(/^@(\d+(?:\.\d+)?)\s*<\s*(-?\d+(?:\.\d+)?)$/);
  if (polarMatch && lastPoint) {
    const dist = parseFloat(polarMatch[1]);
    const angleDeg = parseFloat(polarMatch[2]);
    const angleRad = angleDeg * (Math.PI / 180);
    return {
      x: Math.round((lastPoint.x + dist * Math.cos(angleRad)) * 100) / 100,
      y: Math.round((lastPoint.y + dist * Math.sin(angleRad)) * 100) / 100
    };
  }

  // Match single number (e.g. for radius)
  const numberMatch = cleanInput.match(/^(\d+(?:\.\d+)?)$/);
  if (numberMatch) {
    return parseFloat(numberMatch[1]);
  }

  return null;
};
