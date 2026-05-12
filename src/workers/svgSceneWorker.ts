import type { DrawCommand } from '../interpreter/interpreter';

const SVG_PATH_SEGMENT_LIMIT = 2000;

type SvgScene = {
  bgColor: string;
  markup: string;
};

type ResetMessage = {
  type: 'reset';
  id: number;
  canvasColor: string;
};

type AppendMessage = {
  type: 'append';
  id: number;
  commands: DrawCommand[];
};

type BuildMessage = {
  type: 'build';
  id: number;
};

type WorkerRequest = ResetMessage | AppendMessage | BuildMessage;

type BuildResponse = {
  id: number;
  scene: SvgScene;
};

function fmtSvgNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
}

function escSvgAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escSvgText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let activeId = 0;
let bgColor = '#ffffff';
let markup: string[] = [];
let pathParts: string[] = [];
let pathColor = '';
let pathWidth = -1;
let pathSegments = 0;

function flushPath(): void {
  if (pathSegments === 0) return;
  markup.push(
    `<path d="${pathParts.join(' ')}" fill="none" stroke="${escSvgAttr(pathColor)}" stroke-width="${fmtSvgNumber(pathWidth)}" stroke-linecap="square" stroke-linejoin="bevel" />`,
  );
  pathParts = [];
  pathSegments = 0;
}

function resetState(id: number, canvasColor: string): void {
  activeId = id;
  bgColor = canvasColor;
  markup = [];
  pathParts = [];
  pathColor = '';
  pathWidth = -1;
  pathSegments = 0;
}

function appendCommand(cmd: DrawCommand): void {
  switch (cmd.type) {
    case 'clear':
      flushPath();
      markup.length = 0;
      break;

    case 'canvasColor':
      flushPath();
      if (cmd.color) bgColor = cmd.color;
      markup.length = 0;
      break;

    case 'line': {
      if (
        cmd.x1 === undefined || cmd.y1 === undefined ||
        cmd.x2 === undefined || cmd.y2 === undefined
      ) break;
      const color = cmd.color || '#000';
      const width = cmd.width ?? 1;
      if (
        pathSegments > 0 &&
        (color !== pathColor || width !== pathWidth || pathSegments >= SVG_PATH_SEGMENT_LIMIT)
      ) {
        flushPath();
      }
      if (pathSegments === 0) {
        pathColor = color;
        pathWidth = width;
      }
      pathParts.push(
        `M${fmtSvgNumber(cmd.x1)} ${fmtSvgNumber(cmd.y1)}L${fmtSvgNumber(cmd.x2)} ${fmtSvgNumber(cmd.y2)}`,
      );
      pathSegments++;
      break;
    }

    case 'text': {
      flushPath();
      if (cmd.x1 === undefined || cmd.y1 === undefined || !cmd.text) break;
      const color = escSvgAttr(cmd.color || '#000');
      const size = cmd.fontSize ?? 12;
      markup.push(
        `<text x="${fmtSvgNumber(cmd.x1)}" y="${fmtSvgNumber(cmd.y1)}" fill="${color}" font-size="${fmtSvgNumber(size)}" font-family="sans-serif" dominant-baseline="hanging">${escSvgText(cmd.text)}</text>`,
      );
      break;
    }
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'reset') {
    resetState(message.id, message.canvasColor);
    return;
  }

  if (message.id !== activeId) return;

  if (message.type === 'append') {
    for (const command of message.commands) appendCommand(command);
    return;
  }

  flushPath();
  self.postMessage({
    id: message.id,
    scene: { bgColor, markup: markup.join('') },
  } satisfies BuildResponse);
};
