// Local raster processing only. No source bytes or metadata are copied into exports.
export const MAX_IMAGE_PIXELS = 12_000_000;
export const MAX_IMAGE_EDGE = 8000;
const MAX_FILE = 24 * 1024 * 1024;

function dimensionsAllowed(width, height) {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 &&
    width <= MAX_IMAGE_EDGE && height <= MAX_IMAGE_EDGE && width * height <= MAX_IMAGE_PIXELS;
}

function declaredDimensions(bytes, mime) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/png') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 24 || !signature.every((b, i) => bytes[i] === b) ||
        String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') throw new Error('This PNG header is invalid.');
    return [view.getUint32(16), view.getUint32(20)];
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('This JPEG header is invalid.');
  let at = 2;
  while (at + 3 < bytes.length) {
    if (bytes[at++] !== 0xff) throw new Error('This JPEG cannot be inspected safely.');
    while (bytes[at] === 0xff) at++;
    const marker = bytes[at++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (at + 2 > bytes.length) break;
    const length = view.getUint16(at);
    if (length < 2 || at + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) break;
      return [view.getUint16(at + 5), view.getUint16(at + 3)];
    }
    at += length;
  }
  throw new Error('This JPEG has no supported dimensions. Use a cleaned-up replacement.');
}

export async function decodeRaster(blob) {
  if (!['image/png', 'image/jpeg'].includes(blob.type) || blob.size <= 0 || blob.size > MAX_FILE) {
    throw new Error('Choose a PNG or JPEG no larger than 24 MiB.');
  }
  const dimensions = declaredDimensions(new Uint8Array(await blob.arrayBuffer()), blob.type);
  if (!dimensionsAllowed(...dimensions)) throw new Error('Image exceeds the editor limit: 12 megapixels or 8000 pixels per edge. Resize it locally and upload a replacement.');
  const source = await createImageBitmap(blob);
  if (!dimensionsAllowed(source.width, source.height)) {
    source.close(); throw new Error('Decoded image exceeds the editor limit.');
  }
  return source;
}

export function rotatedSize(source, rotation) {
  return rotation % 180 === 0 ? [source.width, source.height] : [source.height, source.width];
}

export function checkedRectangle(rect, width, height) {
  const { x, y, width: w, height: h } = rect;
  if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > width || y + h > height) {
    throw new Error('Rectangle must fit inside the image using whole pixel coordinates.');
  }
  return rect;
}

export function renderRaster(source, canvas, options = {}) {
  const rotation = options.rotation || 0;
  if (![0, 90, 180, 270].includes(rotation)) throw new Error('Unsupported rotation.');
  const [width, height] = rotatedSize(source, rotation);
  const crop = checkedRectangle(options.crop || {x: 0, y: 0, width, height}, width, height);
  const brightness = options.brightness ?? 100, contrast = options.contrast ?? 100;
  if (!Number.isFinite(brightness) || brightness < 50 || brightness > 150 || !Number.isFinite(contrast) || contrast < 50 || contrast > 200) throw new Error('Invalid image adjustment.');
  canvas.width = crop.width; canvas.height = crop.height;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  // Draw only the cropped region into a fresh canvas. There is no hidden image layer.
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(width / 2 - crop.x, height / 2 - crop.y);
  context.rotate(rotation * Math.PI / 180);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  context.restore();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    let r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2];
    if (options.grayscale || options.scan) r = g = b = .2126 * r + .7152 * g + .0722 * b;
    const adjust = value => ((value * brightness / 100 - 128) * contrast / 100) + 128;
    r = adjust(r); g = adjust(g); b = adjust(b);
    if (options.scan) r = g = b = r >= 160 ? 255 : 0;
    pixels.data[i] = r; pixels.data[i + 1] = g; pixels.data[i + 2] = b; pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  // Always last, fully opaque, including when brightness/grayscale change later.
  context.fillStyle = '#000'; context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
  for (const rect of options.redactions || []) {
    checkedRectangle(rect, canvas.width, canvas.height);
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
  return canvas;
}

export function exportPNG(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob || blob.size > MAX_FILE) reject(new Error('The PNG export is too large. Crop or resize it locally, then upload a replacement.'));
    else resolve(blob);
  }, 'image/png'));
}
