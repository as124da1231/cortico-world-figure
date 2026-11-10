const effectPreviewArt = {
  native: `<g class="l2d-effect-preview-motion">
    <path d="M147 79 122 56C110 44 129 33 142 46L147 51 152 46C165 33 184 44 172 56Z"
      fill="#fb72963b" stroke="#fb9ab4" stroke-width="2.5"/>
    <path d="M109 71c-8 9-8 16-1 17 8 1 8-7 1-17" fill="#88caff"/>
    <path d="M184 56V42l10-4v13m-10 5c0 5-10 7-10 2 0-4 10-7 10-2m10-5c0 5-9 7-9 2 0-4 9-6 9-2"
      fill="none" stroke="#f9dc9a" stroke-width="2.3" stroke-linecap="round"/>
    <path d="M109 37h12l-12 13h12" fill="none" stroke="#c5b5f4" stroke-width="2.3" stroke-linecap="round"/>
  </g>`,
  kaomoji: `<text class="l2d-effect-preview-motion" x="150" y="65" text-anchor="middle"
    dominant-baseline="middle" fill="#983854" font-size="33" font-family="Segoe UI, Yu Gothic UI, Microsoft YaHei UI, sans-serif">(˶ᵔᵕᵔ˶)</text>`,
  orb: `<g class="l2d-effect-preview-motion">
    <circle cx="150" cy="60" r="35" fill="#e87fb04d" style="filter:blur(9px)"/>
    <circle cx="150" cy="60" r="31" fill="#b65c914f" stroke="#e6a1c285"/>
    <g fill="#ffd4ec">${Array.from({length:81}, (_, i) => {
      const x = i % 9 - 4, y = Math.floor(i / 9) - 4;
      return x*x + y*y > 19 ? '' : `<circle cx="${150+x*7}" cy="${60+y*7}" r="${(x+y)%3===0 ? 1.6 : .9}" opacity="${.26 + (i%5)*.13}"/>`;
    }).join('')}</g>
    <path d="M154 64c-8-6-4-12 1-8 4-4 9 2-1 8m-17 14c-8-6-4-12 1-8 4-4 9 2-1 8m36 3c-8-6-4-12 1-8 4-4 9 2-1 8" fill="#ffc5df"/>
    <g fill="#ffd2e8"><circle cx="87" cy="40" r="2"/><circle cx="104" cy="85" r="1.5"/><circle cx="212" cy="65" r="2.5"/></g>
  </g>`,
  flow: `<ellipse cx="150" cy="65" rx="19" ry="36" fill="#c5c6eb22" stroke="#dcd7ff48"/>
    <g class="l2d-effect-preview-motion" transform="rotate(-15 150 60)">
      <ellipse cx="150" cy="60" rx="106" ry="14" fill="none" stroke="#e0a6f5" stroke-width="1.8" opacity=".85"/>
      <path d="M44 59q20 29 106 22 83-6 105-24-24 20-105 15Q80 75 44 59" fill="#ffd8f6" opacity=".46"/>
      <g fill="#fff0ff"><circle cx="80" cy="50" r="2.6"/><circle cx="190" cy="67" r="2.2"/><circle cx="231" cy="39" r="1.7"/></g>
    </g>`,
  bubbles: `<ellipse cx="124" cy="74" rx="19" ry="37" fill="#c8d5f227" stroke="#dfecff51"/>
    <g class="l2d-effect-preview-motion" fill="#cfe3ff24" stroke="#f3dbffae">
      <circle cx="155" cy="81" r="5"/><circle cx="166" cy="66" r="7"/>
      <circle cx="187" cy="51" r="9"/><circle cx="212" cy="34" r="12"/>
      <path d="M182 48q2-4 6-3m18-14q2-5 8-5" fill="none" stroke="#fff9" stroke-linecap="round"/>
    </g>`,
  softglow: `<ellipse cx="151" cy="63" rx="24" ry="40" fill="#9295b730" stroke="#b1bad624"/>
    <g class="l2d-effect-preview-motion">
      <ellipse cx="124" cy="67" rx="117" ry="8" transform="rotate(-15 124 67)" fill="#ffcf84"
        opacity=".5" style="filter:blur(13px)"/>
      <ellipse cx="196" cy="64" rx="87" ry="7" transform="rotate(8 196 64)" fill="#e4b7ee"
        opacity=".68" style="filter:blur(13px)"/>
      <g fill="#fff6e6"><circle cx="69" cy="50" r="1.9"/><circle cx="108" cy="85" r="1.2"/><circle cx="195" cy="43" r="2"/><circle cx="223" cy="74" r="2.4"/></g>
    </g>`,
};

function createEffectPreview(doc, style) {
  const preview = doc.createElement('span');
  preview.className = 'l2d-effect-preview';
  preview.dataset.style = style;
  preview.setAttribute('aria-hidden', 'true');
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 300 120');
  svg.innerHTML = effectPreviewArt[style];
  preview.append(svg);
  return preview;
}
