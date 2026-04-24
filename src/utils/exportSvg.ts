import { DrawCommand, TurtleState } from '../interpreter/interpreter';

/**
 * Serialize the current turtle drawing into a self-contained SVG string.
 *
 * Matches KTurtle's `saveAsSvg` semantics: one SVG file per drawing, with
 * each line as a separate `<line>` element (mirroring Qt's QGraphicsLineItem
 * approach) so the resulting file opens correctly in Inkscape, browsers,
 * and vector editors.
 *
 * The viewBox matches the canvas size; canvas color becomes the SVG's
 * background rectangle. Turtle sprite is intentionally omitted — KTurtle
 * hides it when saving SVG to avoid clutter.
 */
export function drawingsToSvg(turtle: TurtleState, drawings: DrawCommand[]): string {
  const w = turtle.canvasWidth;
  const h = turtle.canvasHeight;

  // Walk commands in order; `clear` and `canvasColor` wipe accumulated
  // geometry just like the live canvas does. Background is set from the
  // LAST effective canvas color (initial turtle color overridden by any
  // canvasColor / clear commands encountered).
  let background = turtle.canvasColor || '#ffffff';
  let elements: string[] = [];

  for (const cmd of drawings) {
    switch (cmd.type) {
      case 'clear':
        elements = [];
        break;

      case 'canvasColor':
        if (cmd.color) background = cmd.color;
        elements = [];
        break;

      case 'line': {
        if (
          cmd.x1 === undefined || cmd.y1 === undefined ||
          cmd.x2 === undefined || cmd.y2 === undefined
        ) break;
        const color = escAttr(cmd.color || '#000');
        const width = cmd.width ?? 1;
        elements.push(
          `  <line x1="${fmt(cmd.x1)}" y1="${fmt(cmd.y1)}" x2="${fmt(cmd.x2)}" y2="${fmt(cmd.y2)}" stroke="${color}" stroke-width="${fmt(width)}" stroke-linecap="square" stroke-linejoin="bevel" />`,
        );
        break;
      }

      case 'text': {
        if (cmd.x1 === undefined || cmd.y1 === undefined || !cmd.text) break;
        const color = escAttr(cmd.color || '#000');
        const size = cmd.fontSize ?? 12;
        elements.push(
          `  <text x="${fmt(cmd.x1)}" y="${fmt(cmd.y1)}" fill="${color}" font-size="${fmt(size)}" font-family="sans-serif" dominant-baseline="hanging">${escText(cmd.text)}</text>`,
        );
        break;
      }
    }
  }

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n` +
    `  <rect x="0" y="0" width="${w}" height="${h}" fill="${escAttr(background)}" />\n` +
    elements.join('\n') +
    `\n</svg>\n`
  );
}

/** Trigger a browser download of the SVG with the given filename. */
export function downloadSvg(svg: string, filename: string): void {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.svg') ? filename : `${filename}.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function fmt(n: number): string {
  // Keep SVG compact: drop trailing zeros, cap at 2 decimals.
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
