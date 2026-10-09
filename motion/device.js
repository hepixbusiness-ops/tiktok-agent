/* Happi Digital — mock-ups génériques pilotés par seek(t). Aucune animation temps réel.
   Usage :
     const ph = HD.phone(stage, { media: { frames: '../rec/m-happi-scroll/f_%04d.jpg', n: 330, fps: 30 }, statusBg: '#f7f3ec' });
     ph.pose({ x: 600, y: 540, s: .9, rx: 6, ry: -18, rz: -2, lift: 20, glare: .4 });   // à chaque seek
     await ph.seek(tMedia);                                                                  // image de la séquence
     ph.tap({ x: .38, y: .66, p: 0..1 })   // cercle de tap (coordonnées relatives au viewport 390x844), p=null pour masquer
*/
(function () {
  const SVG = {
    signal: '<svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx=".8"/><rect x="5" y="5.5" width="3" height="6.5" rx=".8"/><rect x="10" y="3" width="3" height="9" rx=".8"/><rect x="15" y="0" width="3" height="12" rx=".8"/></svg>',
    wifi: '<svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 2.2c2.4 0 4.6.9 6.2 2.5l1.3-1.3C13.5 1.4 10.9.3 8 .3S2.5 1.4.5 3.4l1.3 1.3C3.4 3.1 5.6 2.2 8 2.2zm0 3.6c1.4 0 2.7.5 3.6 1.4l1.3-1.3C11.6 4.6 9.9 3.9 8 3.9s-3.6.7-4.9 2L4.4 7.2c.9-.9 2.2-1.4 3.6-1.4zM8 9.4c-.6 0-1.2.3-1.6.7L8 11.7l1.6-1.6c-.4-.4-1-.7-1.6-.7z"/></svg>',
    battery: '<svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" stroke-opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2.2"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2z" fill-opacity=".45"/></svg>',
    lock: '<svg viewBox="0 0 12 12"><path d="M3 5V3.6a3 3 0 0 1 6 0V5h.6c.5 0 .9.4.9.9v5.2c0 .5-.4.9-.9.9H2.4a.9.9 0 0 1-.9-.9V5.9c0-.5.4-.9.9-.9H3zm1.4 0h3.2V3.6a1.6 1.6 0 0 0-3.2 0V5z"/></svg>',
  };
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
  const pad = (n, w) => String(n).padStart(w, '0');

  // Média : séquence d'images {frames:'..._%04d.jpg', n, fps, start?}, vidéo {video:'x.webm'}, ou image longue {image, y:(t)=>px CSS}
  function makeMedia(host, m, cssW) {
    if (!m) return { seek: async () => {} };
    if (m.frames) {
      const img = el('img'); img.decoding = 'sync'; host.appendChild(img);
      const w = (m.frames.match(/%0(\d)d/) || [0, 4])[1];
      let cur = -1;
      return { node: img, seek: async (t) => {
        // arrondi à l'image la plus proche : les sous-images du flou de mouvement du moteur tombent toutes sur la même image
        const i = Math.min(m.n, Math.max(1, Math.round(t * (m.fps || 30)) + 1 + (m.start || 0)));
        if (i === cur) return; cur = i;
        img.src = m.frames.replace(/%0\dd/, pad(i, +w));
        try { await img.decode(); } catch (e) {}
      } };
    }
    if (m.video) {
      const v = el('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = m.video; host.appendChild(v);
      return { node: v, seek: async (t) => {
        if (v.readyState < 1) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
        const tt = Math.min(Math.max(0, t), (v.duration || 1e9) - 0.001);
        if (Math.abs(v.currentTime - tt) < 1e-4 && v.readyState >= 2) return;
        await new Promise((r) => { v.addEventListener('seeked', r, { once: true }); v.currentTime = tt; });
      } };
    }
    if (m.image) {
      const img = el('img'); img.src = m.image; host.appendChild(img);
      return { node: img, seek: async (t) => {
        if (!img.complete) await img.decode().catch(() => {});
        const k = host.clientWidth / (m.cssWidth || cssW);
        img.style.transform = `translateY(${-(m.y ? m.y(t) : 0) * k}px)`;
      } };
    }
  }

  function rigged(parent, node, o) {
    const shadow = el('div', 'hd-shadow'); parent.appendChild(shadow);
    const rig = el('div', 'hd-rig'); rig.appendChild(node); parent.appendChild(rig);
    const W = node.offsetWidth, H = node.offsetHeight;
    rig.style.width = W + 'px'; rig.style.height = H + 'px';
    return { rig, shadow, W, H, pose(p = {}) {
      const { x = 0, y = 0, s = 1, rx = 0, ry = 0, rz = 0, lift = 0, glare, persp = 2600, shadowOpacity = 1 } = p;
      rig.style.transform = `translate3d(${x - W / 2}px, ${y - H / 2 - lift}px, 0) perspective(${persp}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${s})`;
      // ombre portée chaude au sol : s'éloigne et s'adoucit quand l'objet monte
      const sw = W * s * 0.95 * (1 + lift / 900), sh = Math.max(40, H * s * 0.09) * (1 + lift / 500);
      shadow.style.width = sw + 'px'; shadow.style.height = sh + 'px';
      shadow.style.transform = `translate3d(${x - sw / 2 - ry * 2.2 * s}px, ${y + H * s * 0.5 - sh * 0.45 + Math.max(0, rx) * 3 * s}px, 0)`;
      shadow.style.opacity = (shadowOpacity * Math.max(0.25, 1 - lift / 260)).toFixed(3);
      if (glare !== undefined) node.style.setProperty('--g', glare);
    } };
  }

  function phone(parent, o = {}) {
    const ph = el('div', 'hd-phone' + (o.overlayStatus ? ' hd-overlay-status' : ''));
    ph.innerHTML = `<div class="hd-back"></div><div class="hd-edge e3"></div><div class="hd-edge e2"></div><div class="hd-edge e1"></div>
      <i class="hd-btn l" style="top:178px;height:32px"></i><i class="hd-btn l" style="top:238px;height:62px"></i><i class="hd-btn l" style="top:314px;height:62px"></i><i class="hd-btn r" style="top:262px;height:98px"></i>
      <div class="hd-rimface"></div><div class="hd-bezel"></div>
      <div class="hd-screen"><div class="hd-status"><span class="hd-time">${o.time || '9:41'}</span><span class="hd-icons">${SVG.signal}${SVG.wifi}${SVG.battery}</span></div>
      <div class="hd-content"></div><div class="hd-island"></div><div class="hd-homebar"></div><div class="hd-tap"></div><div class="hd-glare"></div></div>`;
    if (o.statusBg) ph.style.setProperty('--hd-status-bg', o.statusBg);
    if (o.statusFg) ph.style.setProperty('--hd-status-fg', o.statusFg);
    if (o.homebar === false) ph.querySelector('.hd-homebar').style.display = 'none';
    // drop shadow solidaire du téléphone (dans l'espace 3D)
    const drop = el('div'); drop.style.cssText = 'position:absolute;inset:30px 10px -10px 10px;border-radius:62px;background:rgba(96,54,22,.32);filter:blur(34px);transform:translateZ(-40px) translate(18px,34px)';
    ph.prepend(drop);
    parent.appendChild(ph);
    const r = rigged(parent, ph, o);
    const content = ph.querySelector('.hd-content'), tapEl = ph.querySelector('.hd-tap');
    const media = makeMedia(content, o.media, 390);
    return Object.assign(r, { el: ph, content, seek: (t) => media.seek(t),
      setMedia(m) { content.innerHTML = ''; Object.assign(media, makeMedia(content, m, 390)); },
      // p : 0 → apparition, 0.35 → pression, 1 → disparu (onde qui s'élargit)
      tap({ x, y, p }) {
        if (p == null || p < 0 || p > 1) { tapEl.style.opacity = 0; return; }
        const ch = content.clientHeight, cw = content.clientWidth, top = content.offsetTop;
        const k = ch / 844;
        tapEl.style.left = x * cw + 'px'; tapEl.style.top = top + y * 844 * k + 'px';
        const press = p < 0.35 ? 1 - 0.25 * (p / 0.35) : 0.75 + 1.1 * ((p - 0.35) / 0.65);
        const op = p < 0.12 ? p / 0.12 : p < 0.45 ? 1 : 1 - (p - 0.45) / 0.55;
        tapEl.style.transform = `scale(${press.toFixed(3)})`; tapEl.style.opacity = op.toFixed(3);
      } });
  }

  function browser(parent, o = {}) {
    const b = el('div', 'hd-browser');
    b.style.setProperty('--bw', (o.width || 1152) + 'px');
    b.innerHTML = `<div class="hd-bar"><div class="hd-dots"><i></i><i></i><i></i></div><div class="hd-nav"><span>‹</span><span>›</span></div>
      <div class="hd-url">${SVG.lock}<span>${o.url || 'happidigital.cm'}</span></div><div class="hd-spacer"></div></div><div class="hd-content"></div><div class="hd-glare"></div>`;
    parent.appendChild(b);
    const r = rigged(parent, b, o);
    r.shadow.style.borderRadius = '40%';
    const content = b.querySelector('.hd-content');
    const media = makeMedia(content, o.media, 1440);
    return Object.assign(r, { el: b, content, seek: (t) => media.seek(t) });
  }

  // Petits utilitaires déterministes pour les pages seek(t)
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ease = { inOut: (x) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2), out: (x) => 1 - Math.pow(1 - x, 3), sine: (x) => -(Math.cos(Math.PI * x) - 1) / 2 };
  const lerp = (a, b, x) => a + (b - a) * x;
  window.HD = { phone, browser, clamp, ease, lerp };
})();
