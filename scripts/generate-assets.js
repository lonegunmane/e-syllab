import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// Master SVG Logo Definition
// 512x512 ViewBox
export function generateSvg({ withBackground = true, size = 512 } = {}) {
  const bg = withBackground
    ? `<rect width="512" height="512" rx="128" fill="url(#esyllab-bg-grad)"/>
       <rect x="6" y="6" width="500" height="500" rx="122" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-opacity="0.2"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <defs>
    <linearGradient id="esyllab-bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#8B5CF6" />
      <stop offset="50%" stop-color="#7C3AED" />
      <stop offset="100%" stop-color="#5B21B6" />
    </linearGradient>

    <linearGradient id="esyllab-e-grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#EDE9FE" />
    </linearGradient>

    <linearGradient id="esyllab-accent-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#DDD6FE" stop-opacity="0.95" />
      <stop offset="50%" stop-color="#C4B5FD" />
      <stop offset="100%" stop-color="#A78BFA" stop-opacity="0.85" />
    </linearGradient>

    <filter id="esyllab-e-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#3B0764" flood-opacity="0.45" />
    </filter>
  </defs>
  ${bg}
  
  <g filter="url(#esyllab-e-shadow)">
    <!-- Bold Geometric Letter "E" -->
    <path
      d="M 148 112 H 368 C 376.8 112 384 119.2 384 128 V 166 C 384 174.8 376.8 182 368 182 H 214 V 218 H 332 C 340.8 218 348 225.2 348 234 V 262 C 348 270.8 340.8 278 332 278 H 214 V 314 H 368 C 376.8 314 384 321.2 384 330 V 368 C 384 376.8 376.8 384 368 384 H 148 C 137 384 128 375 128 364 V 132 C 128 121 137 112 148 112 Z"
      fill="url(#esyllab-e-grad)"
    />

    <!-- Subtle Top-Arm Light Glint Highlight -->
    <path
      d="M 152 114 H 366 C 374 114 380 120 380 128 V 132 C 380 124 374 118 366 118 H 152 C 142 118 134 126 134 136 V 132 C 134 122 142 114 152 114 Z"
      fill="#FFFFFF"
      fill-opacity="0.6"
    />

    <!-- Sleek Character Accent Underline / Anchor -->
    <rect
      x="128"
      y="412"
      width="256"
      height="18"
      rx="9"
      fill="url(#esyllab-accent-grad)"
    />
  </g>
</svg>`;
}

export function generateFaviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="fav-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#8B5CF6" />
      <stop offset="100%" stop-color="#5B21B6" />
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="16" fill="url(#fav-bg)"/>
  <!-- High-contrast crisp Bold E -->
  <path
    d="M 18 14 H 46 C 47.1 14 48 14.9 48 16 V 21 C 48 22.1 47.1 23 46 23 H 26 V 28 H 42 C 43.1 28 44 28.9 44 30 V 34 C 44 35.1 43.1 36 42 36 H 26 V 41 H 46 C 47.1 41 48 41.9 48 43 V 48 C 48 49.1 47.1 50 46 50 H 18 C 16.9 50 16 49.1 16 48 V 16 C 16 14.9 16.9 14 18 14 Z"
    fill="#FFFFFF"
  />
  <rect x="16" y="53" width="32" height="3" rx="1.5" fill="#DDD6FE" />
</svg>`;
}

async function buildAll() {
  const rootDir = process.cwd();
  const iconsDir = path.join(rootDir, 'icons');
  const publicIconsDir = path.join(rootDir, 'public', 'icons');
  const publicDir = path.join(rootDir, 'public');

  if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });
  if (!fs.existsSync(publicIconsDir)) fs.mkdirSync(publicIconsDir, { recursive: true });

  const svg512 = generateSvg({ withBackground: true, size: 512 });
  const svgFavicon = generateFaviconSvg();

  // Save SVGs
  fs.writeFileSync(path.join(iconsDir, 'icon.svg'), svg512);
  fs.writeFileSync(path.join(iconsDir, 'favicon.svg'), svgFavicon);
  fs.writeFileSync(path.join(publicIconsDir, 'icon.svg'), svg512);
  fs.writeFileSync(path.join(publicIconsDir, 'favicon.svg'), svgFavicon);
  fs.writeFileSync(path.join(publicDir, 'favicon.svg'), svgFavicon);

  // Generate PNGs
  const svgBuffer = Buffer.from(svg512);

  // 192x192 PNG
  const png192 = await sharp(svgBuffer)
    .resize(192, 192)
    .png({ quality: 100, compressionLevel: 9 })
    .toBuffer();

  // 512x512 PNG
  const png512 = await sharp(svgBuffer)
    .resize(512, 512)
    .png({ quality: 100, compressionLevel: 9 })
    .toBuffer();

  // 512x512 Maskable PNG (with 15% safe-zone padding)
  const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
    <rect width="512" height="512" fill="#7C3AED"/>
    <g transform="translate(51.2, 51.2) scale(0.8)">
      <path
        d="M 148 112 H 368 C 376.8 112 384 119.2 384 128 V 166 C 384 174.8 376.8 182 368 182 H 214 V 218 H 332 C 340.8 218 348 225.2 348 234 V 262 C 348 270.8 340.8 278 332 278 H 214 V 314 H 368 C 376.8 314 384 321.2 384 330 V 368 C 384 376.8 376.8 384 368 384 H 148 C 137 384 128 375 128 364 V 132 C 128 121 137 112 148 112 Z"
        fill="#FFFFFF"
      />
      <rect x="128" y="412" width="256" height="18" rx="9" fill="#DDD6FE" />
    </g>
  </svg>`;

  const pngMaskable512 = await sharp(Buffer.from(maskableSvg))
    .resize(512, 512)
    .png({ quality: 100, compressionLevel: 9 })
    .toBuffer();

  // Save PNGs to both /icons and /public/icons
  for (const dir of [iconsDir, publicIconsDir]) {
    fs.writeFileSync(path.join(dir, 'icon-192.png'), png192);
    fs.writeFileSync(path.join(dir, 'icon-512.png'), png512);
    fs.writeFileSync(path.join(dir, 'icon-maskable-512.png'), pngMaskable512);
    fs.writeFileSync(path.join(dir, 'maskable_icon.png'), pngMaskable512);
  }

  // Favicon in public/
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), png192);

  console.log('✅ Generated all E-SYLLAB icon assets successfully (PNG 192/512, SVG, and Favicons)');
}

buildAll().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
