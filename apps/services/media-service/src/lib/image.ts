import sharp from 'sharp';

const MAX_DIMENSION = 4000;
const THUMBNAIL_WIDTH = 400;
const THUMBNAIL_HEIGHT = 300;
const WEBP_QUALITY = 85;
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

/**
 * Process a listing image: resize to max 4000px on longest side, convert to WebP at quality 85.
 */
export async function processListingImage(buffer: Buffer): Promise<Buffer> {
  const image = sharp(buffer);
  const metadata = await image.metadata();

  const { width = 0, height = 0 } = metadata;
  const needsResize = width > MAX_DIMENSION || height > MAX_DIMENSION;

  const pipeline = needsResize
    ? image.resize(MAX_DIMENSION, MAX_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      })
    : image;

  return pipeline.webp({ quality: WEBP_QUALITY }).toBuffer();
}

/**
 * Add a semi-transparent text watermark diagonally across the image.
 */
export async function addWatermark(buffer: Buffer, text: string): Promise<Buffer> {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const { width = 800, height = 600 } = metadata;

  const fontSize = Math.max(24, Math.min(60, Math.floor(width / 15)));
  const diagonalAngle = -30;

  // Build SVG watermark overlay — tiled pattern
  const svgWatermark = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="watermark" x="0" y="0" width="350" height="200" patternUnits="userSpaceOnUse" patternTransform="rotate(${diagonalAngle})">
          <text
            x="0"
            y="${fontSize}"
            font-family="Arial, sans-serif"
            font-size="${fontSize}"
            font-weight="bold"
            fill="rgba(255,255,255,0.25)"
            letter-spacing="3"
          >${text}</text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#watermark)" />
    </svg>
  `;

  const svgBuffer = Buffer.from(svgWatermark);

  return sharp(buffer)
    .composite([{ input: svgBuffer, blend: 'over' }])
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

/**
 * Generate a 400x300 thumbnail in WebP format.
 */
export async function generateThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, {
      fit: 'cover',
      position: 'centre',
    })
    .webp({ quality: 75 })
    .toBuffer();
}

/**
 * Validate that an image meets minimum dimension requirements (800x600).
 * Throws an error if dimensions are too small.
 */
export async function validateImageDimensions(buffer: Buffer): Promise<{ width: number; height: number }> {
  const metadata = await sharp(buffer).metadata();
  const { width = 0, height = 0 } = metadata;

  if (width < MIN_WIDTH || height < MIN_HEIGHT) {
    throw new Error(
      `Image dimensions too small. Minimum required: ${MIN_WIDTH}x${MIN_HEIGHT}px. ` +
      `Provided: ${width}x${height}px`,
    );
  }

  return { width, height };
}
