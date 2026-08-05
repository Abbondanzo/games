/**
 * Renders every icon the site needs from one trophy drawing.
 *
 *   pnpm icons
 *
 * Run this after changing the artwork below; the output is committed so that
 * neither CI nor a deploy needs to rasterise anything.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

const ACCENT = '#5b9cff';

/** The trophy itself, drawn on a 32x32 grid. */
const TROPHY = `
  <g fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 6.5 h10 v6 a5 5 0 0 1 -10 0 Z"/>
    <path d="M11 8 H7.5 a4 4 0 0 0 4 4"/>
    <path d="M21 8 h3.5 a4 4 0 0 1 -4 4"/>
    <line x1="16" y1="17.5" x2="16" y2="21"/>
    <path d="M11.5 25 h9 v-1.5 a2.5 2.5 0 0 0 -2.5 -2.5 h-4 a2.5 2.5 0 0 0 -2.5 2.5 Z"/>
  </g>`;

/**
 * @param {object} opts
 * @param {number} opts.radius  Corner radius on the 32 grid. 0 is full bleed.
 * @param {number} opts.scale   Trophy scale about the centre, for mask safe zones.
 */
const icon = ({
  radius = 7,
  scale = 1,
} = {}) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="${radius}" fill="${ACCENT}"/>
  <g transform="translate(16 16) scale(${scale}) translate(-16 -16)">${TROPHY}
  </g>
</svg>
`;

/**
 * Rounded for the browser tab, where the icon sits on its own.
 * Square everywhere else: iOS and Android apply their own mask, and a rounded
 * source would get its corners clipped twice.
 */
const ROUNDED = icon({ radius: 7 });
const SQUARE = icon({ radius: 0 });
// Maskable icons must keep their content inside the middle 80%, because the
// platform is free to crop to a circle.
const MASKABLE = icon({ radius: 0, scale: 0.62 });

/**
 * `opaque` decides whether transparency is flattened away. Home-screen and
 * install icons must be opaque; the rounded tab favicons keep their alpha so
 * the corners stay transparent instead of being filled in.
 *
 * @type {{name: string, svg: string, size: number, opaque: boolean}[]}
 */
const PNGS = [
  { name: 'favicon-32.png', svg: ROUNDED, size: 32, opaque: false },
  { name: 'favicon-16.png', svg: ROUNDED, size: 16, opaque: false },
  { name: 'apple-touch-icon.png', svg: SQUARE, size: 180, opaque: true },
  { name: 'icon-192.png', svg: SQUARE, size: 192, opaque: true },
  { name: 'icon-512.png', svg: SQUARE, size: 512, opaque: true },
  { name: 'icon-maskable-512.png', svg: MASKABLE, size: 512, opaque: true },
];

await mkdir(PUBLIC, { recursive: true });
await writeFile(join(PUBLIC, 'favicon.svg'), ROUNDED);
console.log('favicon.svg');

for (const { name, svg, size, opaque } of PNGS) {
  let img = sharp(Buffer.from(svg), { density: 512 }).resize(size, size, { fit: 'contain' });
  // iOS composites home-screen icons on white, so a transparent PNG would show
  // white wherever the artwork is not.
  if (opaque) img = img.flatten({ background: ACCENT });
  await img.png({ compressionLevel: 9 }).toFile(join(PUBLIC, name));
  console.log(`${name.padEnd(24)} ${size}x${size}${opaque ? '' : '  (alpha)'}`);
}
