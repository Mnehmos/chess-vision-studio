import { toCanvas } from 'html-to-image';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { downloadBlob } from './exportState';

export interface ElementGifOptions {
  element: HTMLElement;
  frameCount: number;
  filename: string;
  setFrame: (index: number) => void;
  delayMs?: number;
  pixelRatio?: number;
  backgroundColor?: string;
  onProgress?: (done: number, total: number) => void;
}

const waitForPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

function cropCanvasToMarkedRegions(source: HTMLCanvasElement, element: HTMLElement): HTMLCanvasElement {
  const markers = Array.from(element.querySelectorAll<HTMLElement>('[data-gif-crop="true"]'))
    .filter((node) => node.offsetParent !== null);
  if (markers.length === 0) return source;

  const elementRect = element.getBoundingClientRect();
  if (elementRect.width <= 0 || elementRect.height <= 0) return source;

  const union = markers.reduce(
    (acc, node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: Math.min(acc.left, rect.left),
        top: Math.min(acc.top, rect.top),
        right: Math.max(acc.right, rect.right),
        bottom: Math.max(acc.bottom, rect.bottom),
      };
    },
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
  );

  if (!Number.isFinite(union.left) || union.right <= union.left || union.bottom <= union.top) {
    return source;
  }

  const padding = 8;
  const scaleX = source.width / elementRect.width;
  const scaleY = source.height / elementRect.height;
  const sx = Math.max(0, Math.floor((union.left - elementRect.left - padding) * scaleX));
  const sy = Math.max(0, Math.floor((union.top - elementRect.top - padding) * scaleY));
  const sw = Math.min(
    source.width - sx,
    Math.ceil((union.right - union.left + padding * 2) * scaleX),
  );
  const sh = Math.min(
    source.height - sy,
    Math.ceil((union.bottom - union.top + padding * 2) * scaleY),
  );
  if (sw <= 0 || sh <= 0 || (sx === 0 && sy === 0 && sw === source.width && sh === source.height)) {
    return source;
  }

  const cropped = document.createElement('canvas');
  cropped.width = sw;
  cropped.height = sh;
  const ctx = cropped.getContext('2d');
  if (!ctx) return source;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return cropped;
}

export async function exportElementGif({
  element,
  frameCount,
  filename,
  setFrame,
  delayMs = 850,
  pixelRatio = 1,
  backgroundColor = '#15120f',
  onProgress,
}: ElementGifOptions): Promise<void> {
  if (frameCount <= 0) return;
  const gif = GIFEncoder();

  for (let i = 0; i < frameCount; i += 1) {
    setFrame(i);
    await waitForPaint();

    const fullCanvas = await toCanvas(element, {
      cacheBust: true,
      pixelRatio,
      backgroundColor,
      filter: (node) =>
        !(node instanceof HTMLElement && node.getAttribute('data-gif-exclude') === 'true'),
    });
    const canvas = cropCanvasToMarkedRegions(fullCanvas, element);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('GIF capture failed: canvas context unavailable');
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const palette = quantize(frame.data, 256);
    const index = applyPalette(frame.data, palette);
    gif.writeFrame(index, canvas.width, canvas.height, {
      palette,
      delay: i === frameCount - 1 ? delayMs * 1.4 : delayMs,
      repeat: 0,
    });
    onProgress?.(i + 1, frameCount);
  }

  gif.finish();
  const bytes = gif.bytes();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  downloadBlob(filename, new Blob([buffer], { type: 'image/gif' }));
}
