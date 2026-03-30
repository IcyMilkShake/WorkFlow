// Install first: npm install sharp
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
console.log("heyyyy")
// Create icons directory
const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Include iOS-specific sizes
const sizes = [72, 96, 128, 144, 152, 180, 192, 384, 512];

// Base SVG template with WorkFlow branding
const createSVG = (size) => {
  const fontSize = size * 0.4;
  const padding = size * 0.15;
  
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#b66dff;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#9946e6;stop-opacity:1" />
    </linearGradient>
    <filter id="shadow">
      <feDropShadow dx="0" dy="${size * 0.02}" stdDeviation="${size * 0.03}" flood-opacity="0.3"/>
    </filter>
  </defs>
  
  <!-- Background with rounded corners -->
  <rect width="${size}" height="${size}" rx="${size * 0.225}" fill="url(#grad)"/>
  
  <!-- Icon: Chart/Graph representation -->
  <g transform="translate(${padding}, ${padding})">
    <!-- Bar chart bars -->
    <rect x="${size * 0.15}" y="${size * 0.4}" width="${size * 0.08}" height="${size * 0.3}" rx="${size * 0.02}" fill="white" opacity="0.9" filter="url(#shadow)"/>
    <rect x="${size * 0.35}" y="${size * 0.25}" width="${size * 0.08}" height="${size * 0.45}" rx="${size * 0.02}" fill="white" opacity="0.9" filter="url(#shadow)"/>
    <rect x="${size * 0.55}" y="${size * 0.35}" width="${size * 0.08}" height="${size * 0.35}" rx="${size * 0.02}" fill="white" opacity="0.9" filter="url(#shadow)"/>
  </g>
</svg>`;
};

// Generate PNG icons
async function generateIcons() {
  console.log('🎨 Generating PWA icons for WorkFlow...\n');
  console.log('📱 Optimized for iOS and Android\n');

  for (const size of sizes) {
    try {
      const svg = Buffer.from(createSVG(size));
      const outputPath = path.join(iconsDir, `icon-${size}x${size}.png`);
      
      await sharp(svg)
        .resize(size, size)
        .png({ quality: 100, compressionLevel: 9 })
        .toFile(outputPath);
      
      const iosTag = size === 180 ? ' (iOS Home Screen)' : '';
      const androidTag = [192, 512].includes(size) ? ' (Android)' : '';
      console.log(`✅ Generated: icon-${size}x${size}.png${iosTag}${androidTag}`);
    } catch (error) {
      console.error(`❌ Error generating ${size}x${size}:`, error.message);
    }
  }

  console.log('\n🎉 All icons generated successfully!');
  console.log('📁 Icons saved in:', iconsDir);
  console.log('\n📝 iOS-specific notes:');
  console.log('  - 180x180 is used for iPhone home screen');
  console.log('  - Icons have proper rounded corners for iOS');
  console.log('  - Transparent padding included for safe area');
}

generateIcons().catch(console.error);