(() => {
  let nextId = 0;
  const id = prefix => prefix + (++nextId);

  function mineSvg(owner, capturing = false) {
    const side = owner === 'blue' || owner === 'red' ? owner : null;
    const uid = id('mine-emblem-');
    const palette = side === 'blue'
      ? { light: '#a9dcff', mid: '#3d8bfd', dark: '#12335f' }
      : side === 'red'
        ? { light: '#ffc0c4', mid: '#f04444', dark: '#501923' }
        : { light: '#e6edf8', mid: '#8995a8', dark: '#303949' };
    const classes = 'mine-svg' + (side ? ' owner-' + side : ' neutral') + (capturing && side ? ' capture' : '');
    return '<svg class="' + classes + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">'
      + '<defs><linearGradient id="' + uid + '-shield" x1=".12" y1=".04" x2=".88" y2=".96"><stop stop-color="' + palette.light + '"/><stop offset=".22" stop-color="' + palette.mid + '"/><stop offset=".64" stop-color="' + palette.mid + '"/><stop offset="1" stop-color="' + palette.dark + '"/></linearGradient></defs>'
      + '<path d="M32 5 55 13v18c0 14-8.5 23.6-23 29C17.5 54.6 9 45 9 31V13z" transform="translate(0 2)" fill="#020711" opacity=".72"/>'
      + '<path d="M32 4 55 12v18.5c0 14.4-8.4 24-23 29.5C16.4 54.5 8 44.9 8 30.5V12z" fill="url(#' + uid + '-shield)" stroke="' + palette.light + '" stroke-width="2.1"/>'
      + '<path d="M32 8 51 14.5v16c0 11.6-6.5 19.7-19 24.7C19.5 50.2 13 42.1 13 30.5v-16z" fill="none" stroke="#fff" stroke-opacity=".26" stroke-width="1.2"/>'
      + '<path d="M13 14 32 8l19 6" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="2" stroke-linecap="round"/>'
      + '<svg class="mine-glyph' + (capturing && side ? ' capture' : '') + '" x="14" y="12" width="36" height="36" viewBox="0 0 32 32" aria-hidden="true" focusable="false">'
      + capturedMineContents(uid) + '</svg></svg>';
  }

  function bombSvg() {
    const uid = id('attack-bomb-');
    return '<svg class="attack-bomb-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true" focusable="false">'
      + '<defs><radialGradient id="' + uid + '-body" cx=".31" cy=".24" r=".8"><stop stop-color="#ffb0ad"/><stop offset=".28" stop-color="#ff5964"/><stop offset=".58" stop-color="#f04444"/><stop offset=".78" stop-color="#d7243d"/><stop offset="1" stop-color="#721323"/></radialGradient><linearGradient id="' + uid + '-cap" x2="0" y2="1"><stop stop-color="#ffe3a3"/><stop offset="1" stop-color="#9e572d"/></linearGradient></defs>'
      + '<path d="M13 8c-2-3-.5-5 2-6" fill="none" stroke="#ffe6a3" stroke-width="2" stroke-linecap="round"/><path d="m16 1 1.7 2.2 2.5-.6-1.2 2.3 1.6 1.8-2.6-.2-1.3 2.1-.5-2.5-2.4-.9 2.4-.9z" fill="#fff0a6"/>'
      + '<rect x="11" y="8" width="9" height="5" rx="1.5" fill="url(#' + uid + '-cap)" stroke="#6d3b2b" stroke-width=".8"/>'
      + '<circle cx="15.5" cy="19" r="10.5" fill="#3b0d18" opacity=".55"/><circle cx="15" cy="18" r="9.5" fill="url(#' + uid + '-body)" stroke="#ffb0ad" stroke-width="1"/>'
      + '<path d="M9 16c1-3 3-4.5 5-5" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="1.8" stroke-linecap="round"/>'
      + '<path d="m21 22 2 2m-1-7 2-1m-8 9v2" stroke="#ffe1a0" stroke-width="1.1" stroke-linecap="round" opacity=".8"/>'
      + '</svg>';
  }

  function capturedMineContents(uid) {
    // Draw depth directly; SVG filters can freeze Chromium during capture animation.
    return '<defs><radialGradient id="' + uid + '-body" cx=".3" cy=".24" r=".85"><stop stop-color="#8a9bb0"/><stop offset=".22" stop-color="#60758c"/><stop offset=".5" stop-color="#354457"/><stop offset=".82" stop-color="#1c2838"/><stop offset="1" stop-color="#03070e"/></radialGradient><linearGradient id="' + uid + '-cap" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e5c789"/><stop offset=".45" stop-color="#a58046"/><stop offset="1" stop-color="#52391e"/></linearGradient></defs>'
      + '<ellipse cx="17" cy="29" rx="9" ry="1.6" fill="#020711" opacity=".35"/>'
      + '<path class="mine-fuse" d="M23 7c-.6-2.1.5-3.8 3-3.5" fill="none" stroke="#d9bd87" stroke-width="1.5" stroke-linecap="round"/>'
      + '<circle cx="26" cy="3.5" r=".8" fill="#ffe8ac"/>'
      + '<rect x="20.5" y="6" width="5" height="4" rx="1" transform="rotate(24 23 8)" fill="url(#' + uid + '-cap)" stroke="#362718" stroke-width=".6"/>'
      + '<circle class="mine-body" cx="16" cy="18" r="12" fill="url(#' + uid + '-body)" stroke="#182230" stroke-width=".7"/>'
      + '<path d="M5.5 16c.8-4.7 4.2-7.9 8.1-8.6" fill="none" stroke="#b7c9df" stroke-width=".7" stroke-linecap="round" opacity=".4"/>'
      + '<ellipse class="mine-highlight" cx="11.5" cy="11.7" rx="3.3" ry="1.5" transform="rotate(-32 11.5 11.7)" fill="#dce7f4" opacity=".32"/>'
      + '<path d="M24.5 20c-.4 2-1.3 3.6-2.5 4.9" fill="none" stroke="#71829a" stroke-width=".7" stroke-linecap="round" opacity=".18"/>';
  }

  function counterMineContents(uid) {
    return '<defs><radialGradient id="' + uid + '-metal" cx=".3" cy=".24" r=".8"><stop stop-color="#f4f7fc"/><stop offset=".32" stop-color="#cbd5e1"/><stop offset=".52" stop-color="#aab5c8"/><stop offset=".76" stop-color="#718096"/><stop offset="1" stop-color="#303949"/></radialGradient></defs>'
      + '<g fill="none" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"><path d="M16 2v5M16 25v5M2 16h5M25 16h5M6 6l4 4m12 12 4 4M26 6l-4 4M10 22l-4 4"/></g>'
      + '<circle cx="16" cy="16" r="9" fill="url(#' + uid + '-metal)" stroke="#eef2f7" stroke-width="1"/><circle cx="13" cy="12.5" r="2.3" fill="#fff" opacity=".7"/>';
  }

  function counterMineSvg() {
    const uid = id('counter-mine-');
    return '<svg class="counter-mine-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true" focusable="false">'
      + counterMineContents(uid) + '</svg>';
  }

  window.MineIcons = { mineSvg, bombSvg, counterMineSvg };
})();
