const sharp = require('sharp');
const path = require('path');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1a2e"/>
      <stop offset="100%" stop-color="#16162a"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="512" height="512" rx="108" ry="108" fill="url(#bg)"/>

  <!-- === BOOKCASE FRAME === -->
  <!-- Left side -->
  <rect x="100" y="72" width="10" height="368" rx="2" fill="#6C63FF" opacity="0.5"/>
  <!-- Right side -->
  <rect x="402" y="72" width="10" height="368" rx="2" fill="#6C63FF" opacity="0.5"/>

  <!-- === TOP SHELF (y=190) === -->
  <rect x="100" y="190" width="312" height="8" rx="2" fill="#6C63FF" opacity="0.7"/>
  <!-- Top shelf books -->
  <rect x="120" y="100" width="28" height="90" rx="2" fill="#8B80FF"/>
  <rect x="154" y="115" width="32" height="75" rx="2" fill="#6C63FF"/>
  <rect x="192" y="105" width="26" height="85" rx="2" fill="#9D95FF"/>
  <rect x="224" y="125" width="34" height="65" rx="2" fill="#5B54D4"/>
  <rect x="264" y="108" width="30" height="82" rx="2" fill="#7B73FF"/>
  <rect x="300" y="120" width="28" height="70" rx="2" fill="#8B80FF" opacity="0.8"/>
  <rect x="334" y="100" width="32" height="90" rx="2" fill="#6C63FF" opacity="0.9"/>
  <rect x="372" y="112" width="26" height="78" rx="2" fill="#9D95FF" opacity="0.7"/>

  <!-- === MIDDLE SHELF (y=310) === -->
  <rect x="100" y="310" width="312" height="8" rx="2" fill="#6C63FF" opacity="0.7"/>
  <!-- Middle shelf books -->
  <rect x="120" y="218" width="34" height="92" rx="2" fill="#9D95FF"/>
  <rect x="160" y="232" width="28" height="78" rx="2" fill="#7B73FF"/>
  <rect x="194" y="222" width="36" height="88" rx="2" fill="#6C63FF"/>
  <rect x="236" y="240" width="26" height="70" rx="2" fill="#8B80FF" opacity="0.8"/>
  <rect x="268" y="225" width="32" height="85" rx="2" fill="#5B54D4"/>
  <rect x="306" y="235" width="30" height="75" rx="2" fill="#9D95FF" opacity="0.8"/>
  <rect x="342" y="220" width="28" height="90" rx="2" fill="#7B73FF" opacity="0.9"/>
  <rect x="376" y="238" width="22" height="72" rx="2" fill="#6C63FF" opacity="0.7"/>

  <!-- === BOTTOM SHELF (y=430) === -->
  <rect x="100" y="430" width="312" height="8" rx="2" fill="#6C63FF" opacity="0.7"/>
  <!-- Bottom shelf books -->
  <rect x="120" y="340" width="30" height="90" rx="2" fill="#6C63FF" opacity="0.9"/>
  <rect x="156" y="350" width="36" height="80" rx="2" fill="#8B80FF"/>
  <rect x="198" y="338" width="28" height="92" rx="2" fill="#9D95FF" opacity="0.8"/>
  <rect x="232" y="355" width="32" height="75" rx="2" fill="#5B54D4"/>
  <rect x="270" y="342" width="26" height="88" rx="2" fill="#7B73FF"/>
  <rect x="302" y="358" width="34" height="72" rx="2" fill="#6C63FF" opacity="0.8"/>
  <rect x="342" y="345" width="28" height="85" rx="2" fill="#8B80FF" opacity="0.9"/>
  <rect x="376" y="352" width="22" height="78" rx="2" fill="#9D95FF" opacity="0.7"/>
</svg>`;

async function generate() {
  const buf = Buffer.from(svg);

  await sharp(buf).resize(512, 512).png().toFile(path.join(__dirname, 'icon-512.png'));
  await sharp(buf).resize(192, 192).png().toFile(path.join(__dirname, 'icon-192.png'));

  console.log('Icons generated: icon-192.png, icon-512.png');
}

generate().catch(console.error);
