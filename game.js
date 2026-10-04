/* =============================================================
   El Robo de Randes: Misión Surge
   Endless runner 2D con HTML5 Canvas y JavaScript vanilla.

   Índice
     1. Configuración
     2. Utilidades
     3. Carga de sprites con respaldo automático
     4. Dibujo de respaldo (formas geométricas)
     5. Fondo con parallax
     6. Sonido (WebAudio, sin archivos)
     7. Estado del juego y entidades
     8. Entrada (teclado, ratón y táctil)
     9. Lógica: jugador, Randes, obstáculos, dinero, power-ups
    10. Render
    11. Interfaz (HUD y pantallas)
    12. Bucle principal (paso fijo de 60 Hz) y arranque
   ============================================================= */
'use strict';

(function () {

  // ===========================================================
  // 1. CONFIGURACIÓN
  // ===========================================================
  const W = 960;          // ancho lógico del mundo (px)
  const H = 420;          // alto lógico del mundo (px)
  const GROUND_Y = 352;   // línea del suelo: aquí apoyan los pies
  const STEP = 1 / 60;    // paso fijo de simulación (60 actualizaciones/s)

  const CFG = {
    // Físicas de Surge
    gravity: 2600,             // px/s²
    jumpVelocity: 900,         // impulso del primer salto
    doubleJumpVelocity: 800,   // impulso del doble salto
    jumpCutFactor: 0.5,        // al soltar el salto pronto, se corta la subida (salto variable)
    fastFallGravity: 5200,     // gravedad extra al pulsar abajo en el aire
    jumpBuffer: 0.12,          // s: un salto pulsado justo antes de aterrizar no se pierde

    // Velocidad del mundo
    startSpeed: 380,           // px/s
    maxSpeed: 880,
    speedGain: 6.5,            // px/s ganados por segundo de partida

    // Posición horizontal de Surge (esprint)
    playerBaseX: 170,
    playerMaxX: 560,
    sprintSpeed: 330,
    returnSpeed: 160,

    // Vidas
    lives: 3,
    maxLives: 5,
    invulnerableTime: 1.6,

    // Puntuación
    pxPerMeter: 40,
    values: { coin: 10, bill: 50, gem: 250 },
    tagBonusBase: 100,         // bonus directo por tocar a Randes (se multiplica por la racha)

    // Power-ups
    magnetRadius: 290,
    powerDuration: { magnet: 8, shield: 12, double: 10 },
    powerEvery: [12, 20],      // segundos entre apariciones
  };

  // ===========================================================
  // 2. UTILIDADES
  // ===========================================================
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /** Elige una opción de [[valor, peso], ...] según su peso. */
  function weighted(options) {
    const total = options.reduce((s, o) => s + o[1], 0);
    let r = Math.random() * total;
    for (const [value, weight] of options) {
      r -= weight;
      if (r <= 0) return value;
    }
    return options[options.length - 1][0];
  }

  /** Colisión entre dos rectángulos {x, y, w, h}. */
  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /** Colisión círculo (cx, cy, r) contra rectángulo. */
  function circleRect(cx, cy, r, rect) {
    const nx = clamp(cx, rect.x, rect.x + rect.w);
    const ny = clamp(cy, rect.y, rect.y + rect.h);
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy <= r * r;
  }

  const fmtNum = n => Math.floor(n).toLocaleString('es-ES');
  const fmtMoney = n => fmtNum(n) + ' €';

  const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  const reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** localStorage puede fallar (modo privado, permisos): siempre con try/catch. */
  const storage = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : v; }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch (e) { /* sin persistencia */ }
    },
  };

  // ===========================================================
  // 3. CARGA DE SPRITES CON RESPALDO AUTOMÁTICO
  // -----------------------------------------------------------
  // Cada sprite declara su tamaño original (w, h) y la "caja" del
  // contenido visible [x, y, ancho, alto] dentro de la imagen.
  // Así el personaje se apoya exactamente en el suelo aunque el
  // PNG tenga márgenes transparentes. Si la imagen no carga, se
  // dibuja la forma de respaldo en esa misma caja: el juego nunca
  // se rompe ni se queda en blanco.
  // Puedes sustituir los PNG por otros (mejor con la misma
  // proporción); se estiran al mismo tamaño en pantalla.
  // ===========================================================
  const SPRITES = {
    player: { src: 'assets/player.png',             w: 32, h: 32, box: [10, 6, 11, 20], scale: 3 },
    thief:  { src: 'assets/ladron.png',             w: 32, h: 32, box: [8, 7, 13, 19],  scale: 3 },
    tree:   { src: 'assets/obstaculoterrestre.png', w: 32, h: 32, box: [0, 0, 32, 32],  scale: 2.5 },
    bird:   { src: 'assets/obstaculoaereo.png',     w: 54, h: 48, box: [7, 5, 38, 36],  scale: 1.6 },
    coin:   { src: 'assets/dineromoneda.png',       w: 16, h: 16, box: [3, 2, 11, 11],  scale: 2.2 },
    bill:   { src: 'assets/dinerobillete.png',      w: 16, h: 16, box: [1, 2, 14, 13],  scale: 2.2 },
    gem:    { src: 'assets/dinerogema.png',         w: 16, h: 16, box: [0, 3, 16, 11],  scale: 2.2 },

    // Opcionales: si no existen, se dibujan con formas (es lo esperado).
    background: { src: 'assets/fondo.png',          optional: true },
    pwMagnet:   { src: 'assets/powerup_iman.png',   optional: true },
    pwShield:   { src: 'assets/powerup_escudo.png', optional: true },
    pwDouble:   { src: 'assets/powerup_x2.png',     optional: true },
    pwLife:     { src: 'assets/powerup_vida.png',   optional: true },
  };

  const images = {};          // clave -> HTMLImageElement (solo si cargó bien)
  const failedAssets = [];    // sprites obligatorios que no cargaron

  function loadImage(key, def) {
    return new Promise(resolve => {
      const img = new Image();
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        if (ok && img.naturalWidth > 0) {
          images[key] = img;
        } else if (!def.optional) {
          failedAssets.push(def.src);
          console.warn('[Randes] No se pudo cargar ' + def.src + '. Se usará el dibujo de respaldo.');
        }
        resolve();
      };
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      setTimeout(() => finish(false), 6000); // nunca esperar para siempre
      img.src = def.src;
    });
  }

  function loadAllAssets() {
    return Promise.all(Object.entries(SPRITES).map(([k, d]) => loadImage(k, d)));
  }

  /**
   * Dibuja un sprite anclado por el centro inferior de su caja de contenido.
   * (cx, bottom): posición en el mundo; sx, sy: escalado extra (squash & stretch).
   * Si el sprite no está disponible, llama a la función de respaldo.
   */
  function drawActor(key, cx, bottom, sx = 1, sy = 1, t = 0) {
    const def = SPRITES[key];
    const s = def.scale;
    const [bx, by, bw, bh] = def.box;
    ctx.save();
    ctx.translate(cx, bottom);
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    const img = images[key];
    if (img) {
      ctx.drawImage(img, -(bx + bw / 2) * s, -(by + bh) * s, def.w * s, def.h * s);
    } else {
      FALLBACK[key](ctx, -bw * s / 2, -bh * s, bw * s, bh * s, t);
    }
    ctx.restore();
  }

  // ===========================================================
  // 4. DIBUJO DE RESPALDO (formas sólidas + texto claro)
  // ===========================================================
  function fallbackLabel(c, text, x, y) {
    c.font = 'bold 11px "Trebuchet MS", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    c.lineWidth = 3;
    c.strokeStyle = '#1D2350';
    c.strokeText(text, x, y);
    c.fillStyle = '#FFFFFF';
    c.fillText(text, x, y);
  }

  const FALLBACK = {
    player(c, x, y, w, h) {
      c.fillStyle = '#F3E08A'; c.fillRect(x + 2, y, w - 4, h * 0.14);             // pelo
      c.fillStyle = '#8A5A3C'; c.fillRect(x + 2, y + h * 0.12, w - 4, h * 0.22);  // cara
      c.fillStyle = '#6E8B2E'; c.fillRect(x, y + h * 0.34, w, h * 0.42);          // camiseta
      c.fillStyle = '#2B2B2B';
      c.fillRect(x + 2, y + h * 0.76, w * 0.36, h * 0.24);                         // piernas
      c.fillRect(x + w * 0.58, y + h * 0.76, w * 0.36, h * 0.24);
      fallbackLabel(c, 'SURGE', x + w / 2, y - 4);
    },
    thief(c, x, y, w, h) {
      c.fillStyle = '#1FA38A'; c.fillRect(x - 6, y + h * 0.35, w * 0.35, h * 0.4); // saco
      c.fillStyle = '#E6C7A0'; c.fillRect(x + 4, y, w - 8, h * 0.32);             // cabeza
      c.fillStyle = '#1A1A1A'; c.fillRect(x + 4, y + h * 0.1, w - 8, h * 0.08);   // antifaz
      for (let i = 0; i < 4; i++) {                                                // rayas
        c.fillStyle = i % 2 ? '#FFFFFF' : '#1A1A1A';
        c.fillRect(x + 2, y + h * (0.34 + i * 0.1), w - 4, h * 0.1);
      }
      c.fillStyle = '#1A1A1A';
      c.fillRect(x + 4, y + h * 0.74, w * 0.32, h * 0.26);
      c.fillRect(x + w * 0.58, y + h * 0.74, w * 0.32, h * 0.26);
      fallbackLabel(c, 'RANDES', x + w / 2, y - 4);
    },
    tree(c, x, y, w, h) {
      c.fillStyle = '#7A5A2B'; c.fillRect(x + w * 0.42, y + h * 0.45, w * 0.16, h * 0.5);
      c.fillStyle = '#3F8F2F';
      c.beginPath();
      c.arc(x + w * 0.3, y + h * 0.35, w * 0.25, 0, Math.PI * 2);
      c.arc(x + w * 0.7, y + h * 0.3, w * 0.27, 0, Math.PI * 2);
      c.arc(x + w * 0.5, y + h * 0.2, w * 0.22, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#2E6E22'; c.fillRect(x + w * 0.15, y + h * 0.9, w * 0.7, h * 0.1);
    },
    bird(c, x, y, w, h, t) {
      const flap = Math.sin(t * 18) * h * 0.25;
      c.fillStyle = '#D9822B';
      c.beginPath(); c.ellipse(x + w * 0.55, y + h * 0.55, w * 0.38, h * 0.3, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#B5541D';                                                     // ala
      c.beginPath();
      c.moveTo(x + w * 0.45, y + h * 0.45);
      c.lineTo(x + w * 0.85, y + h * 0.2 - flap);
      c.lineTo(x + w * 0.75, y + h * 0.55);
      c.fill();
      c.fillStyle = '#B03FB0';                                                     // pico (mira a la izquierda)
      c.beginPath(); c.moveTo(x, y + h * 0.5); c.lineTo(x + w * 0.2, y + h * 0.42); c.lineTo(x + w * 0.2, y + h * 0.6); c.fill();
      c.fillStyle = '#FFFFFF'; c.fillRect(x + w * 0.25, y + h * 0.4, 5, 5);
    },
    coin(c, x, y, w, h) {
      c.fillStyle = '#F2B705';
      c.beginPath(); c.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#7A4E00';
      c.font = 'bold 14px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('€', x + w / 2, y + h / 2 + 1);
    },
    bill(c, x, y, w, h) {
      c.fillStyle = '#5DBB63'; c.fillRect(x, y + h * 0.15, w, h * 0.7);
      c.strokeStyle = '#2E7A33'; c.lineWidth = 2; c.strokeRect(x + 1, y + h * 0.15 + 1, w - 2, h * 0.7 - 2);
      c.fillStyle = '#1E5A22';
      c.font = 'bold 12px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('50', x + w / 2, y + h / 2 + 1);
    },
    gem(c, x, y, w, h) {
      c.fillStyle = '#21C45A';
      c.beginPath();
      c.moveTo(x + w * 0.2, y); c.lineTo(x + w * 0.8, y); c.lineTo(x + w, y + h * 0.35);
      c.lineTo(x + w / 2, y + h); c.lineTo(x, y + h * 0.35); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillRect(x + w * 0.3, y + h * 0.12, w * 0.15, h * 0.2);
    },
  };

  /** Power-ups: se usan los PNG opcionales si existen; si no, iconos dibujados. */
  const POWERS = {
    magnet: { asset: 'pwMagnet', color: '#E8473C', name: 'Imán de dinero' },
    shield: { asset: 'pwShield', color: '#3A8DDE', name: 'Escudo' },
    double: { asset: 'pwDouble', color: '#8E4FD6', name: 'Dinero doble' },
    life:   { asset: 'pwLife',   color: '#E8473C', name: 'Vida extra' },
  };

  function drawPowerIcon(type, cx, cy, size, t) {
    const def = POWERS[type];
    const img = images[def.asset];
    const r = size / 2;
    // Halo pulsante para que se vea de lejos
    ctx.save();
    ctx.globalAlpha = 0.25 + Math.sin(t * 6) * 0.1;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    if (img) { ctx.drawImage(img, cx - r, cy - r, size, size); return; }

    // Burbuja base
    ctx.fillStyle = '#1D2350';
    ctx.beginPath(); ctx.arc(cx, cy, r + 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.arc(cx, cy, r - 1, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineCap = 'butt';
    if (type === 'magnet') {
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(0, -1, 8, Math.PI, 0, true); ctx.stroke();  // U del imán
      ctx.beginPath(); ctx.moveTo(-8, -1); ctx.lineTo(-8, -9); ctx.moveTo(8, -1); ctx.lineTo(8, -9); ctx.stroke();
      ctx.strokeStyle = '#1D2350'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(-8, -9); ctx.lineTo(-8, -13); ctx.moveTo(8, -9); ctx.lineTo(8, -13); ctx.stroke();
    } else if (type === 'shield') {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(0, -12); ctx.lineTo(10, -7); ctx.lineTo(8, 5); ctx.lineTo(0, 12);
      ctx.lineTo(-8, 5); ctx.lineTo(-10, -7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3A8DDE'; ctx.fillRect(-2, -7, 4, 13);
    } else if (type === 'double') {
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 17px "Pixelify Sans", "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('x2', 0, 1);
    } else if (type === 'life') {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(0, 10);
      ctx.bezierCurveTo(-14, 0, -8, -12, 0, -4);
      ctx.bezierCurveTo(8, -12, 14, 0, 0, 10);
      ctx.fill();
    }
    ctx.restore();
  }

  // ===========================================================
  // 5. FONDO CON PARALLAX (pre-renderizado una sola vez)
  // ===========================================================
  const Background = {
    city: null, hills: null, ground: null, skyGradient: null,
    clouds: [],
    offsets: { city: 0, hills: 0, ground: 0, image: 0 },

    build() {
      // Generador pseudoaleatorio con semilla: el fondo siempre sale igual
      let seed = 7;
      const srand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

      // --- Ciudad lejana (tileable) ---
      const cw = 1200, ch = 190;
      this.city = makeCanvas(cw, ch, c => {
        const drawBuilding = (bx, bw, bh) => {
          c.fillStyle = '#8DB0CF';
          c.fillRect(bx, ch - bh, bw, bh);
          c.fillStyle = '#A9C6DE';
          for (let wy = ch - bh + 10; wy < ch - 14; wy += 16) {
            for (let wx = bx + 7; wx < bx + bw - 10; wx += 13) {
              if (srand() > 0.25) c.fillRect(wx, wy, 6, 8);
            }
          }
        };
        let x = 0;
        while (x < cw) {
          const bw = 40 + Math.floor(srand() * 55);
          const bh = 60 + Math.floor(srand() * 120);
          drawBuilding(x, bw, bh);
          if (x + bw > cw) drawBuilding(x - cw, bw, bh); // costura del tile
          x += bw + Math.floor(srand() * 10);
        }
      });

      // --- Colinas y arbustos (tileable con senos de periodo exacto) ---
      const hw = 1000, hh = 110;
      this.hills = makeCanvas(hw, hh, c => {
        const layer = (color, base, amps) => {
          c.fillStyle = color;
          c.beginPath();
          c.moveTo(0, hh);
          for (let x = 0; x <= hw; x += 4) {
            let y = base;
            amps.forEach(([a, k, p]) => { y -= a * Math.sin((x / hw) * Math.PI * 2 * k + p); });
            c.lineTo(x, Math.round(y / 4) * 4); // escalones de 4px: aspecto pixel
          }
          c.lineTo(hw, hh); c.closePath(); c.fill();
        };
        layer('#9ED37E', 50, [[18, 2, 0.4], [10, 5, 1.2]]);
        layer('#78C25A', 72, [[14, 3, 2.1], [8, 7, 0.3]]);
      });

      // --- Suelo (tile de 64px) ---
      const gw = 64, gh = H - GROUND_Y;
      this.ground = makeCanvas(gw, gh, c => {
        c.fillStyle = '#8A5A34'; c.fillRect(0, 0, gw, gh);
        c.fillStyle = '#4E9A35'; c.fillRect(0, 0, gw, 10);
        c.fillStyle = '#3C7D29'; c.fillRect(0, 10, gw, 4);
        c.fillStyle = '#6CB84A';
        for (let i = 0; i < 6; i++) c.fillRect(Math.floor(srand() * 60), 0, 4, 4);
        for (let i = 0; i < 10; i++) {
          c.fillStyle = srand() > 0.5 ? '#6E4426' : '#A06B40';
          c.fillRect(Math.floor(srand() * 60), 20 + Math.floor(srand() * (gh - 24)), 4, 4);
        }
      });

      this.skyGradient = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
      this.skyGradient.addColorStop(0, '#5FB7E5');
      this.skyGradient.addColorStop(1, '#CFEFF8');

      this.clouds = [];
      for (let i = 0; i < 5; i++) {
        this.clouds.push({ x: rand(0, W), y: rand(30, 150), s: rand(0.7, 1.4) });
      }
    },

    update(dt, speed) {
      this.offsets.city = (this.offsets.city + speed * 0.15 * dt) % 1200;
      this.offsets.hills = (this.offsets.hills + speed * 0.4 * dt) % 1000;
      this.offsets.ground = (this.offsets.ground + speed * dt) % 64;
      this.offsets.image += speed * 0.15 * dt;
      for (const cl of this.clouds) {
        cl.x -= (12 + speed * 0.05 * cl.s) * dt;
        if (cl.x < -140) { cl.x = W + rand(20, 200); cl.y = rand(30, 150); cl.s = rand(0.7, 1.4); }
      }
    },

    draw() {
      const bgImg = images.background;
      if (bgImg) {
        // Fondo personalizado: escalado a la altura del suelo y repetido en horizontal
        const scale = GROUND_Y / bgImg.naturalHeight;
        const iw = bgImg.naturalWidth * scale;
        const off = this.offsets.image % iw;
        for (let x = -off; x < W; x += iw) ctx.drawImage(bgImg, x, 0, iw, GROUND_Y);
      } else {
        ctx.fillStyle = this.skyGradient;
        ctx.fillRect(0, 0, W, GROUND_Y);
        // Sol
        ctx.fillStyle = '#FFF4B8';
        ctx.fillRect(800, 46, 48, 48);
        ctx.fillStyle = '#FFE680';
        ctx.fillRect(808, 54, 32, 32);
        // Nubes pixeladas
        ctx.fillStyle = '#FFFFFF';
        for (const cl of this.clouds) {
          const s = cl.s, x = Math.round(cl.x), y = Math.round(cl.y);
          ctx.fillRect(x, y + 12 * s, 96 * s, 16 * s);
          ctx.fillRect(x + 16 * s, y, 44 * s, 16 * s);
          ctx.fillRect(x + 52 * s, y + 6 * s, 28 * s, 10 * s);
        }
        // Ciudad
        const cy = GROUND_Y - 190 - 30;
        const cOff = Math.round(this.offsets.city);
        ctx.drawImage(this.city, -cOff, cy);
        ctx.drawImage(this.city, 1200 - cOff, cy);
      }
      // Colinas
      const hy = GROUND_Y - 110;
      const hOff = Math.round(this.offsets.hills);
      ctx.drawImage(this.hills, -hOff, hy);
      ctx.drawImage(this.hills, 1000 - hOff, hy);
      // Suelo
      const gOff = Math.round(this.offsets.ground);
      for (let x = -gOff; x < W; x += 64) ctx.drawImage(this.ground, x, GROUND_Y);
    },
  };

  function makeCanvas(w, h, paint) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = false;
    paint(cx);
    return c;
  }

  // ===========================================================
  // 6. SONIDO (sintetizado con WebAudio: no necesita archivos)
  // ===========================================================
  const Sound = {
    ctx: null,
    muted: storage.get('randes-surge-muted', '0') === '1',

    unlock() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { this.ctx = new AC(); } catch (e) { this.ctx = null; } }
    },

    tone(freq, dur, { type = 'square', vol = 0.06, slide = 0, delay = 0 } = {}) {
      if (this.muted || !this.ctx) return;
      const t0 = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },

    play(name) {
      switch (name) {
        case 'jump':   this.tone(320, 0.12, { slide: 320, vol: 0.05 }); break;
        case 'double': this.tone(480, 0.14, { slide: 520, vol: 0.05, type: 'triangle' }); break;
        case 'coin':   this.tone(988, 0.06, { vol: 0.04 }); this.tone(1319, 0.08, { vol: 0.04, delay: 0.05 }); break;
        case 'bill':   this.tone(784, 0.07, { vol: 0.05 }); this.tone(1175, 0.1, { vol: 0.05, delay: 0.06 }); break;
        case 'gem':    [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(f, 0.08, { vol: 0.045, delay: i * 0.05 })); break;
        case 'hit':    this.tone(220, 0.3, { type: 'sawtooth', slide: -170, vol: 0.08 }); break;
        case 'shield': this.tone(600, 0.2, { type: 'triangle', slide: -300, vol: 0.07 }); break;
        case 'tag':    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.09, { vol: 0.05, delay: i * 0.05 })); break;
        case 'power':  this.tone(440, 0.25, { type: 'triangle', slide: 660, vol: 0.07 }); break;
        case 'over':   [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', vol: 0.07, delay: i * 0.15 })); break;
      }
    },

    toggle() {
      this.muted = !this.muted;
      storage.set('randes-surge-muted', this.muted ? '1' : '0');
    },
  };

  // ===========================================================
  // 7. ESTADO DEL JUEGO Y ENTIDADES
  // ===========================================================
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let viewScale = 1;

  const BEST_KEY = 'randes-surge-best';
  let bestScore = parseInt(storage.get(BEST_KEY, '0'), 10) || 0;

  // mode: 'loading' | 'menu' | 'playing' | 'paused' | 'dying' | 'over'
  let mode = 'loading';

  let state, player, randes;
  let obstacles = [], items = [], powerups = [], particles = [], texts = [];

  function newState() {
    return {
      time: 0,
      speed: CFG.startSpeed,
      distance: 0,
      money: 0,
      lives: CFG.lives,
      tags: 0,
      combo: 0,
      nextObstacle: 600,               // px de mundo hasta el siguiente obstáculo
      powerTimer: rand(6, 10),         // el primer power-up llega pronto
      power: { magnet: 0, shield: 0, double: 0 },
      shake: 0,
      flash: 0, flashColor: '#FFFFFF',
      banner: null,                    // { text, life, max }
      dyingTime: 0,
      tutorialShown: false,
    };
  }

  function newPlayer() {
    return {
      cx: CFG.playerBaseX,  // centro horizontal
      y: GROUND_Y,          // posición de los pies
      vy: 0,
      onGround: true,
      jumpsUsed: 0,
      jumpCut: false,
      buffer: 0,
      crouch: false,
      invul: 0,
      runT: 0,
      squash: 0,            // >0 aplasta (aterrizaje)
      dustT: 0,
    };
  }

  function newRandes() {
    return {
      cx: 760, y: GROUND_Y, vy: 0, onGround: true,
      state: 'fleeing',          // 'fleeing' | 'tired' | 'escaping'
      stateT: rand(7, 10),
      targetX: 760,
      dropT: 1.2,
      tagCooldown: 0,
      duck: false,
      runT: 0,
      sweatT: 0,
      say: null,                 // { text, life }
    };
  }

  /** Caja de colisión de Surge (un poco más pequeña que el dibujo: más justo para el jugador). */
  function playerBox() {
    const crouching = player.crouch && player.onGround;
    const h = crouching ? 32 : 54;
    return { x: player.cx - 12.5, y: player.y - h, w: 25, h };
  }

  function randesBox() {
    const h = randes.duck ? 36 : 54;
    return { x: randes.cx - 16, y: randes.y - h, w: 32, h };
  }

  /** Caja de colisión de un obstáculo (dibujo menos márgenes). */
  function obstacleBox(o) {
    return { x: o.x + o.inset[0], y: o.y + o.inset[1], w: o.w - o.inset[0] - o.inset[2], h: o.h - o.inset[1] - o.inset[3] };
  }

  // ===========================================================
  // 8. ENTRADA
  // ===========================================================
  const input = { jumpHeld: false, crouch: false, sprint: false };

  function pressJump() {
    Sound.unlock();
    if (mode === 'menu' || mode === 'over') { startGame(); return; }
    if (mode !== 'playing') return;
    input.jumpHeld = true;
    player.buffer = CFG.jumpBuffer;
  }
  function releaseJump() {
    input.jumpHeld = false;
    // Salto variable: soltar pronto corta la subida
    if (player && player.vy < 0 && !player.jumpCut) {
      player.vy *= CFG.jumpCutFactor;
      player.jumpCut = true;
    }
  }

  const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW'];
  const CROUCH_KEYS = ['ArrowDown', 'KeyS'];
  const SPRINT_KEYS = ['ArrowRight', 'KeyD', 'ShiftLeft', 'ShiftRight'];

  window.addEventListener('keydown', e => {
    const k = e.code;
    if (JUMP_KEYS.includes(k) || CROUCH_KEYS.includes(k) || SPRINT_KEYS.includes(k)) e.preventDefault();

    // Cuando un botón tiene el foco, Enter/Espacio lo activan de forma nativa
    const onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';

    if (JUMP_KEYS.includes(k)) {
      if (!e.repeat && !(onButton && k === 'Space' && mode !== 'playing')) pressJump();
    } else if (CROUCH_KEYS.includes(k)) {
      input.crouch = true;
    } else if (SPRINT_KEYS.includes(k)) {
      input.sprint = true;
    } else if (k === 'KeyP' || k === 'Escape') {
      if (mode === 'playing') pauseGame();
      else if (mode === 'paused') resumeGame();
    } else if (k === 'Enter' && !onButton) {
      if (mode === 'menu' || mode === 'over') { Sound.unlock(); startGame(); }
      else if (mode === 'paused') resumeGame();
    }
  });

  window.addEventListener('keyup', e => {
    const k = e.code;
    if (JUMP_KEYS.includes(k)) releaseJump();
    else if (CROUCH_KEYS.includes(k)) input.crouch = false;
    else if (SPRINT_KEYS.includes(k)) input.sprint = false;
  });

  // Tocar/clicar el canvas también salta
  canvas.addEventListener('pointerdown', e => {
    if (mode === 'playing') { e.preventDefault(); pressJump(); }
  });
  canvas.addEventListener('pointerup', releaseJump);
  canvas.addEventListener('pointercancel', releaseJump);

  // Botones táctiles
  document.querySelectorAll('.touch-btn').forEach(btn => {
    const action = btn.dataset.action;
    const down = e => {
      e.preventDefault();
      btn.classList.add('is-pressed');
      if (btn.setPointerCapture) { try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignorar */ } }
      if (action === 'jump') pressJump();
      else if (action === 'crouch') input.crouch = true;
      else if (action === 'sprint') input.sprint = true;
    };
    const up = () => {
      btn.classList.remove('is-pressed');
      if (action === 'jump') releaseJump();
      else if (action === 'crouch') input.crouch = false;
      else if (action === 'sprint') input.sprint = false;
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
    btn.addEventListener('contextmenu', e => e.preventDefault());
  });

  // Si se cambia de pestaña, pausa automática y teclas liberadas
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && mode === 'playing') pauseGame();
  });
  window.addEventListener('blur', () => {
    input.crouch = false; input.sprint = false; input.jumpHeld = false;
  });

  // ===========================================================
  // 9. LÓGICA DEL JUEGO
  // ===========================================================

  // ---------- Efectos ----------
  function burst(x, y, color, n, { speed = 220, gravity = 600, size = 4, life = 0.6, world = true } = {}) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(speed * 0.3, speed);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: gravity, life: rand(life * 0.6, life), max: life, color, size, world });
    }
  }

  function floatText(text, x, y, color = '#FFD23F', size = 18) {
    texts.push({ text, x, y, vy: -60, life: 1.1, max: 1.1, color, size });
  }

  function banner(text, life = 2.2) {
    state.banner = { text, life, max: life };
  }

  function addMoney(amount, x, y) {
    const value = amount * (state.power.double > 0 ? 2 : 1);
    state.money += value;
    if (x !== undefined) floatText('+' + value, x, y, state.power.double > 0 ? '#E3B8FF' : '#FFD23F', 16);
    return value;
  }

  // ---------- Generación de obstáculos ----------
  const TREE = SPRITES.tree.w * SPRITES.tree.scale;                  // 80px
  const BIRD_W = SPRITES.bird.w * SPRITES.bird.scale;                // ~86px
  const BIRD_H = SPRITES.bird.h * SPRITES.bird.scale;                // ~77px
  const BIRD_INSET = [7 * 1.6 + 8, 5 * 1.6 + 8, (54 - 45) * 1.6 + 8, (48 - 41) * 1.6 + 8];

  function makeBird(hitBottom) {
    return {
      kind: 'bird', x: W + 60, y: hitBottom + BIRD_INSET[3] - BIRD_H,
      w: BIRD_W, h: BIRD_H, inset: BIRD_INSET, extraSpeed: 70, t: rand(0, 6), baseY: 0,
    };
  }

  function spawnObstacle() {
    const t = state.time;
    const options = [['tree', 50]];
    if (t > 10) options.push(['birdLow', 14]);
    if (t > 16) options.push(['birdMid', 14]);
    if (t > 20) options.push(['tree2', 12]);
    if (t > 26) options.push(['birdHigh', 10]);
    const kind = weighted(options);

    let o;
    if (kind === 'tree') {
      o = { kind: 'tree', count: 1, x: W + 60, y: GROUND_Y + 4 - TREE, w: TREE, h: TREE, inset: [16, 12, 16, 6] };
    } else if (kind === 'tree2') {
      o = { kind: 'tree', count: 2, x: W + 60, y: GROUND_Y + 4 - TREE, w: TREE * 2 - 12, h: TREE, inset: [16, 12, 16, 6] };
    } else if (kind === 'birdLow') {
      o = makeBird(GROUND_Y - 4);      // a ras de suelo: hay que saltar
    } else if (kind === 'birdMid') {
      o = makeBird(GROUND_Y - 42);     // a la altura de la cabeza: agáchate o salta alto
    } else {
      o = makeBird(GROUND_Y - 122);    // alto: sigue corriendo por debajo, no saltes
    }
    o.sub = kind;
    o.baseY = o.y;
    o.hit = false;
    obstacles.push(o);

    // Distancia hasta el siguiente: crece con la velocidad para que siempre dé tiempo a reaccionar
    const minGap = state.speed * 0.62 + 230;
    const gap = minGap * rand(1, 1.85);
    state.nextObstacle = gap;
    decorateGap(o, gap);
  }

  // ---------- Dinero y power-ups colocados en el escenario ----------
  function spawnItem(type, x, y, falling = false, vx = 0, vy = 0) {
    items.push({ type, x, y, vx, vy, falling, t: rand(0, 6), magnet: false });
  }

  function decorateGap(o, gap) {
    const freeStart = o.x + o.w + 60;
    const freeEnd = o.x + gap - 60;
    const cx = o.x + o.w / 2;

    // Power-up a mitad del hueco si toca
    if (state.powerTimer <= 0 && freeEnd - freeStart > 160) {
      const canLife = state.lives < CFG.maxLives;
      const type = weighted([['magnet', 40], ['shield', 25], ['double', 25], ['life', canLife ? 10 : 0]]);
      const px = (freeStart + freeEnd) / 2;
      powerups.push({ type, x: px, y: GROUND_Y - (Math.random() < 0.5 ? 60 : 120), t: 0 });
      state.powerTimer = rand(CFG.powerEvery[0], CFG.powerEvery[1]);
      return;
    }

    const r = Math.random();
    if ((o.sub === 'tree' || o.sub === 'birdLow') && r < 0.4) {
      // Arco de monedas siguiendo la trayectoria del salto
      for (let i = -2; i <= 2; i++) {
        const dx = i * 52;
        const h = 80 + 80 * (1 - (dx / 130) ** 2);
        spawnItem('coin', cx + dx, GROUND_Y - h);
      }
    } else if (o.sub === 'birdHigh' && r < 0.7) {
      // Premio por NO saltar: monedas a ras de suelo bajo el pájaro
      for (let i = -1; i <= 1; i++) spawnItem('coin', cx + i * 40, GROUND_Y - 22);
    } else if (r < 0.7 && freeEnd - freeStart > 200) {
      // Línea de monedas en el suelo
      const n = randInt(4, 7);
      for (let i = 0; i < n && freeStart + i * 40 < freeEnd; i++) spawnItem('coin', freeStart + i * 40, GROUND_Y - 22);
    } else if (r < 0.85 && freeEnd - freeStart > 200) {
      // Línea alta de billetes con gema: requiere doble salto
      const mid = (freeStart + freeEnd) / 2;
      spawnItem('bill', mid - 50, GROUND_Y - 200);
      spawnItem('gem', mid, GROUND_Y - 215);
      spawnItem('bill', mid + 50, GROUND_Y - 200);
    }
  }

  // ---------- Surge ----------
  function updatePlayer(dt) {
    const p = player;
    p.crouch = input.crouch;

    // Movimiento horizontal: esprintar acerca a Surge a Randes
    if (input.sprint) p.cx = Math.min(CFG.playerMaxX, p.cx + CFG.sprintSpeed * dt);
    else p.cx = Math.max(CFG.playerBaseX, p.cx - CFG.returnSpeed * dt);

    // Salto (con buffer) y doble salto
    if (p.buffer > 0) {
      if (p.onGround) {
        p.vy = -CFG.jumpVelocity;
        p.onGround = false;
        p.jumpsUsed = 1;
        p.jumpCut = false;
        p.buffer = 0;
        Sound.play('jump');
        burst(p.cx, GROUND_Y, '#C9A27A', 6, { speed: 120, gravity: 300, life: 0.35 });
        if (!input.jumpHeld) { p.vy *= CFG.jumpCutFactor; p.jumpCut = true; } // toque corto = salto corto
      } else if (p.jumpsUsed < 2) {
        p.vy = -CFG.doubleJumpVelocity;
        p.jumpsUsed = 2;
        p.jumpCut = false;
        p.buffer = 0;
        Sound.play('double');
        burst(p.cx, p.y - 10, '#FFFFFF', 10, { speed: 160, gravity: 0, life: 0.35 });
      }
      p.buffer -= dt;
    }

    // Gravedad (más fuerte si pulsas abajo en el aire)
    if (!p.onGround) {
      const g = p.crouch ? CFG.fastFallGravity : CFG.gravity;
      p.vy += g * dt;
      p.y += p.vy * dt;
      if (p.y >= GROUND_Y) {
        p.y = GROUND_Y;
        p.squash = clamp(p.vy / 1400, 0.1, 0.35);
        p.vy = 0;
        p.onGround = true;
        p.jumpsUsed = 0;
        burst(p.cx, GROUND_Y, '#C9A27A', 6, { speed: 110, gravity: 300, life: 0.3 });
      }
    }

    p.squash = Math.max(0, p.squash - dt * 2.2);
    p.invul = Math.max(0, p.invul - dt);
    p.runT += dt * (state.speed / 380);

    // Polvo al correr
    p.dustT -= dt;
    if (p.onGround && p.dustT <= 0) {
      p.dustT = input.sprint ? 0.05 : 0.12;
      particles.push({ x: p.cx - 10, y: GROUND_Y - 2, vx: -rand(20, 60), vy: -rand(20, 60), g: 200, life: 0.35, max: 0.35, color: '#C9A27A', size: 4, world: true });
    }
  }

  // ---------- Randes ----------
  function updateRandes(dt, demo = false) {
    const r = randes;
    r.runT += dt * (state.speed / 380);
    r.tagCooldown = Math.max(0, r.tagCooldown - dt);
    if (r.say) { r.say.life -= dt; if (r.say.life <= 0) r.say = null; }

    if (!demo) {
      r.stateT -= dt;
      if (r.state === 'fleeing') {
        r.targetX = 760 + Math.sin(state.time * 0.8) * 40;
        if (r.stateT <= 0) {
          r.state = 'tired';
          r.stateT = 4.5;
          r.say = { text: '¡Uf, uf...!', life: 1.5 };
          if (!state.tutorialShown) { banner(isTouch ? '¡Randes se cansa! Mantén Esprintar' : '¡Randes se cansa! Mantén → para alcanzarlo', 3); state.tutorialShown = true; }
          else banner('¡Randes se cansa!', 1.6);
        }
      } else if (r.state === 'tired') {
        r.targetX = 500 + Math.sin(state.time * 2) * 18;
        r.sweatT -= dt;
        if (r.sweatT <= 0) {
          r.sweatT = 0.15;
          particles.push({ x: r.cx + rand(-8, 8), y: r.y - 60, vx: rand(-40, 40), vy: -rand(60, 120), g: 700, life: 0.5, max: 0.5, color: '#9FD8FF', size: 4, world: false });
        }
        if (r.stateT <= 0) escapeRandes('¡Demasiado lento!');
      } else if (r.state === 'escaping') {
        r.targetX = 820;
        if (r.stateT <= 0) { r.state = 'fleeing'; r.stateT = rand(8, 13); }
      }
    }

    // Movimiento hacia su posición objetivo
    const maxStep = (r.state === 'escaping' ? 600 : r.state === 'tired' ? 120 : 200) * dt;
    r.cx += clamp(r.targetX - r.cx, -maxStep, maxStep);

    // Salta los obstáculos de suelo y se agacha ante los pájaros medios
    r.duck = false;
    for (const o of obstacles) {
      const b = obstacleBox(o);
      const ahead = b.x - (r.cx + 18);
      if ((o.sub === 'tree' || o.sub === 'tree2' || o.sub === 'birdLow') && r.onGround && ahead > 0 && ahead < 60) {
        r.vy = -820; r.onGround = false;
      }
      if (o.sub === 'birdMid' && b.x < r.cx + 30 && b.x + b.w > r.cx - 30 && r.onGround) r.duck = true;
    }
    if (!r.onGround) {
      r.vy += CFG.gravity * dt;
      r.y += r.vy * dt;
      if (r.y >= GROUND_Y) { r.y = GROUND_Y; r.vy = 0; r.onGround = true; }
    }

    // Va soltando dinero del saco (más a menudo si está cansado)
    if (!demo) {
      r.dropT -= dt;
      if (r.dropT <= 0) {
        r.dropT = r.state === 'tired' ? rand(0.3, 0.6) : rand(0.6, 1.2);
        const type = weighted([['coin', 78], ['bill', 19], ['gem', 3]]);
        spawnItem(type, r.cx - 20, r.y - 40, true, rand(-60, 40), rand(-380, -200));
      }
    }
  }

  function escapeRandes(text) {
    randes.state = 'escaping';
    randes.stateT = 1.6;
    randes.tagCooldown = 2;
    if (text) randes.say = { text, life: 1.4 };
  }

  function tagRandes() {
    state.tags++;
    state.combo++;
    const bonus = addMoney(CFG.tagBonusBase * state.combo);
    floatText('¡Toque! +' + bonus + ' €', randes.cx, randes.y - 80, '#FFFFFF', 20);
    if (state.combo > 1) banner('Racha x' + state.combo, 1.2);

    // Lluvia de dinero: más grande cuanto más larga sea la racha
    const n = 12 + Math.min(state.combo * 2, 10);
    for (let i = 0; i < n; i++) {
      const type = weighted([['coin', 58], ['bill', 34], ['gem', 8]]);
      spawnItem(type, randes.cx, randes.y - 40, true, rand(-260, 220), rand(-640, -320));
    }
    // A veces suelta además un power-up
    if (Math.random() < 0.3) {
      const type = weighted([['magnet', 50], ['double', 35], ['shield', 15]]);
      powerups.push({ type, x: randes.cx + 140, y: GROUND_Y - 70, t: 0 });
    }

    burst(randes.cx, randes.y - 30, '#FFD23F', 18, { speed: 280, gravity: 500, world: false });
    state.shake = Math.max(state.shake, 5);
    state.flash = 0.18; state.flashColor = '#FFD23F';
    Sound.play('tag');
    escapeRandes(weighted([['¡Suelta eso!', 1], ['¡Ay, mi botín!', 1], ['¡No me pillarás!', 1]]));
  }

  // ---------- Daño ----------
  function hurt(o) {
    o.hit = true;
    if (player.invul > 0) return;

    const b = obstacleBox(o);
    if (state.power.shield > 0) {
      state.power.shield = 0;
      player.invul = 0.6;
      o.dead = true;
      burst(b.x + b.w / 2, b.y + b.h / 2, '#9FD8FF', 18, { speed: 260 });
      floatText('¡Escudo!', player.cx, player.y - 80, '#9FD8FF', 18);
      Sound.play('shield');
      return;
    }

    state.lives--;
    state.combo = 0;
    player.invul = CFG.invulnerableTime;
    state.shake = 12;
    state.flash = 0.25; state.flashColor = '#E8473C';
    Sound.play('hit');
    burst(player.cx, player.y - 30, '#E8473C', 14, { speed: 240 });

    if (randes.state === 'tired') escapeRandes('¡Ja, ja!');
    else randes.say = { text: '¡Ja, ja!', life: 1.2 };

    if (state.lives <= 0) {
      mode = 'dying';
      state.dyingTime = 0.9;
      Sound.play('over');
    }
  }

  // ---------- Power-ups ----------
  function collectPower(pw) {
    Sound.play('power');
    burst(pw.x, pw.y, POWERS[pw.type].color, 14, { speed: 200, world: false });
    if (pw.type === 'life') {
      state.lives = Math.min(CFG.maxLives, state.lives + 1);
      banner('Vida extra');
    } else {
      state.power[pw.type] = CFG.powerDuration[pw.type];
      banner(POWERS[pw.type].name);
    }
  }

  // ---------- Actualización principal ----------
  function update(dt) {
    if (mode === 'menu') {
      // Pantalla de inicio: persecución de ambiente sin obstáculos
      state.time += dt;
      Background.update(dt, 300);
      player.runT += dt * 0.8;
      randes.targetX = 830 + Math.sin(state.time * 0.7) * 30;
      updateRandes(dt, true);
      return;
    }
    if (mode !== 'playing' && mode !== 'dying') return;

    let dtWorld = dt;
    if (mode === 'dying') {
      state.dyingTime -= dt;
      dtWorld = dt * Math.max(0.1, state.dyingTime); // cámara lenta final
      if (state.dyingTime <= 0) { endGame(); return; }
    }

    state.time += dtWorld;
    state.speed = Math.min(CFG.maxSpeed, CFG.startSpeed + CFG.speedGain * state.time);
    const scroll = state.speed * dtWorld;
    state.distance += scroll / CFG.pxPerMeter;

    Background.update(dtWorld, state.speed);
    if (mode === 'playing') updatePlayer(dtWorld);
    updateRandes(dtWorld);

    // Temporizadores de power-ups
    for (const k in state.power) state.power[k] = Math.max(0, state.power[k] - dtWorld);
    state.powerTimer -= dtWorld;

    // Generación de obstáculos por distancia
    state.nextObstacle -= scroll;
    if (state.nextObstacle <= 0 && mode === 'playing') spawnObstacle();

    const pBox = playerBox();
    const pcx = player.cx, pcy = player.y - pBox.h / 2;

    // Obstáculos
    for (const o of obstacles) {
      o.x -= scroll + (o.extraSpeed || 0) * dtWorld;
      if (o.kind === 'bird') {
        o.t += dtWorld;
        o.y = o.baseY + Math.sin(o.t * 4) * 3;
      }
      if (mode === 'playing' && !o.hit && !o.dead && overlap(pBox, obstacleBox(o))) hurt(o);
    }
    obstacles = obstacles.filter(o => !o.dead && o.x + o.w > -40);

    // Dinero
    const magnetOn = state.power.magnet > 0;
    for (const it of items) {
      it.t += dtWorld;
      const dx = pcx - it.x, dy = pcy - it.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (magnetOn && mode === 'playing' && dist < CFG.magnetRadius) it.magnet = true;

      if (it.magnet && mode === 'playing') {
        const v = 1000 * dtWorld;
        it.x += (dx / dist) * Math.min(v, dist);
        it.y += (dy / dist) * Math.min(v, dist);
      } else {
        it.x -= scroll;
        if (it.falling) {
          it.vy += 1800 * dtWorld;
          it.x += it.vx * dtWorld;
          it.y += it.vy * dtWorld;
          const floor = GROUND_Y - 16;
          if (it.y >= floor) {
            it.y = floor;
            if (Math.abs(it.vy) > 220) { it.vy *= -0.35; it.vx *= 0.5; }
            else { it.vy = 0; it.vx = 0; it.falling = false; }
          }
        }
      }

      if (mode === 'playing' && circleRect(it.x, it.y, 14, { x: pBox.x - 6, y: pBox.y - 6, w: pBox.w + 12, h: pBox.h + 12 })) {
        it.collected = true;
        addMoney(CFG.values[it.type], it.x, it.y - 10);
        Sound.play(it.type);
        burst(it.x, it.y, it.type === 'coin' ? '#FFE680' : '#9BF0A8', it.type === 'gem' ? 12 : 5, { speed: 150, gravity: 200, size: 3, life: 0.4 });
      }
    }
    items = items.filter(it => !it.collected && it.x > -40);

    // Power-ups
    for (const pw of powerups) {
      pw.x -= scroll;
      pw.t += dtWorld;
      const py = pw.y + Math.sin(pw.t * 3) * 6;
      if (mode === 'playing' && circleRect(pw.x, py, 22, pBox)) { pw.collected = true; collectPower(pw); }
    }
    powerups = powerups.filter(pw => !pw.collected && pw.x > -40);

    // Tocar a Randes
    if (mode === 'playing' && randes.state !== 'escaping' && randes.tagCooldown <= 0) {
      const rb = randesBox();
      const reach = { x: rb.x - 6, y: rb.y - 6, w: rb.w + 12, h: rb.h + 12 };
      if (overlap(pBox, reach)) tagRandes();
    }

    updateEffects(dtWorld, scroll);
  }

  function updateEffects(dt, scroll) {
    for (const p of particles) {
      p.vy += p.g * dt;
      p.x += p.vx * dt - (p.world ? scroll : 0);
      p.y += p.vy * dt;
      p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);

    for (const t of texts) { t.y += t.vy * dt; t.life -= dt; }
    texts = texts.filter(t => t.life > 0);

    if (state.banner) { state.banner.life -= dt; if (state.banner.life <= 0) state.banner = null; }
    state.shake = Math.max(0, state.shake - dt * 30);
    state.flash = Math.max(0, state.flash - dt);
  }

  // ===========================================================
  // 10. RENDER
  // ===========================================================
  function render() {
    ctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);
    ctx.imageSmoothingEnabled = false;

    if (!state) { ctx.fillStyle = '#5FB7E5'; ctx.fillRect(0, 0, W, H); return; }

    ctx.save();
    if (state.shake > 0 && !reducedMotion) {
      ctx.translate(rand(-state.shake, state.shake), rand(-state.shake, state.shake));
    }

    Background.draw();

    // Dinero
    for (const it of items) {
      const def = SPRITES[it.type];
      const h = def.box[3] * def.scale;
      const bob = it.falling || it.magnet ? 0 : Math.sin(it.t * 4) * 2;
      // Giro falso de la moneda: estrecha el ancho periódicamente
      const spin = it.type === 'coin' ? 0.55 + 0.45 * Math.abs(Math.cos(it.t * 3)) : 1;
      drawActor(it.type, it.x, it.y + h / 2 + bob, spin, 1, it.t);
    }

    // Power-ups
    for (const pw of powerups) drawPowerIcon(pw.type, pw.x, pw.y + Math.sin(pw.t * 3) * 6, 38, pw.t);

    // Randes
    drawRandes();

    // Obstáculos
    for (const o of obstacles) {
      if (o.kind === 'tree') {
        for (let i = 0; i < o.count; i++) {
          drawActor('tree', o.x + TREE / 2 + i * (TREE - 12), o.y + o.h, 1, 1);
        }
      } else {
        const flap = images.bird ? 1 + Math.sin(o.t * 16) * 0.06 : 1; // aleteo sugerido con el sprite estático
        drawActor('bird', o.x + o.w / 2, o.y + o.h, 1, flap, o.t);
      }
    }

    // Surge
    drawPlayer();

    // Partículas
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // Textos flotantes
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of texts) {
      ctx.globalAlpha = clamp(t.life / t.max * 1.5, 0, 1);
      drawOutlinedText(t.text, t.x, t.y, t.size, t.color);
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    // Destello de pantalla
    if (state.flash > 0) {
      ctx.globalAlpha = state.flash * 1.2;
      ctx.fillStyle = state.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    // Aviso central (power-ups, Randes cansado, rachas)
    if (state.banner && mode !== 'menu') {
      const b = state.banner;
      const a = clamp(b.life / 0.3, 0, 1) * clamp((b.max - b.life) / 0.15, 0, 1);
      ctx.globalAlpha = a;
      drawOutlinedText(b.text, W / 2, 112, 26, '#FFFFFF');
      ctx.globalAlpha = 1;
    }
  }

  function drawOutlinedText(text, x, y, size, color) {
    ctx.font = '700 ' + size + 'px "Pixelify Sans", "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1D2350';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function drawPlayer() {
    const p = player;
    if (p.invul > 0 && Math.floor(p.invul * 14) % 2 === 0 && mode !== 'dying') return; // parpadeo

    let sx = 1, sy = 1, bob = 0;
    const crouching = p.crouch && p.onGround;
    if (crouching) { sx = 1.15; sy = 0.6; }
    else if (!p.onGround) { const s = clamp(-p.vy / 3000, -0.12, 0.15); sx = 1 - s; sy = 1 + s; }
    else bob = Math.abs(Math.sin(p.runT * 16)) * 3;
    if (p.squash > 0) { sx += p.squash * 0.6; sy -= p.squash * 0.6; }

    // Aura del imán
    if (state.power.magnet > 0 && mode !== 'menu') {
      ctx.save();
      ctx.globalAlpha = 0.12 + Math.sin(state.time * 8) * 0.04;
      ctx.strokeStyle = '#E8473C';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.arc(p.cx, p.y - 30, CFG.magnetRadius * 0.5, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // Sombra
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    const shadowW = clamp(30 - (GROUND_Y - p.y) * 0.08, 12, 30);
    ctx.fillRect(Math.round(p.cx - shadowW / 2), GROUND_Y - 3, Math.round(shadowW), 4);

    ctx.save();
    if (input.sprint && p.onGround && mode === 'playing') {
      ctx.translate(p.cx, p.y); ctx.rotate(0.08); ctx.translate(-p.cx, -p.y); // inclinado al esprintar
    }
    drawActor('player', p.cx, p.y - bob, sx, sy, p.runT);
    ctx.restore();

    // Burbuja del escudo
    if (state.power.shield > 0 && mode !== 'menu') {
      ctx.save();
      ctx.globalAlpha = 0.35 + Math.sin(state.time * 10) * 0.1;
      ctx.strokeStyle = '#9FD8FF';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(p.cx, p.y - (crouching ? 20 : 32), crouching ? 34 : 46, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  function drawRandes() {
    const r = randes;
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(Math.round(r.cx - 15), GROUND_Y - 3, 30, 4);

    let sx = 1, sy = 1, bob = 0;
    if (r.duck) { sx = 1.15; sy = 0.62; }
    else if (r.onGround) bob = Math.abs(Math.sin(r.runT * (r.state === 'tired' ? 9 : 16))) * 3;

    drawActor('thief', r.cx, r.y - bob, sx, sy, r.runT);

    // Indicador de "cansado": señal clara de que es el momento de esprintar
    if (r.state === 'tired' && mode === 'playing') {
      const y = r.y - 84 + Math.sin(state.time * 8) * 3;
      drawOutlinedText('!', r.cx, y, 30, '#FFD23F');
    }
    if (r.say) {
      ctx.globalAlpha = clamp(r.say.life * 3, 0, 1);
      drawOutlinedText(r.say.text, r.cx, r.y - (r.state === 'tired' ? 112 : 84), 15, '#FFFFFF');
      ctx.globalAlpha = 1;
    }
  }

  // ===========================================================
  // 11. INTERFAZ (HUD y pantallas)
  // ===========================================================
  const ui = {
    hud: document.getElementById('hud'),
    score: document.getElementById('hud-score'),
    money: document.getElementById('hud-money'),
    lives: document.getElementById('hud-lives'),
    chips: {},
    screens: {
      loading: document.getElementById('screen-loading'),
      start: document.getElementById('screen-start'),
      pause: document.getElementById('screen-pause'),
      over: document.getElementById('screen-over'),
    },
    bestStart: document.getElementById('best-start'),
    muteBtn: document.getElementById('btn-mute'),
    last: { score: -1, money: -1, lives: -1 },
  };
  document.querySelectorAll('.power-chip').forEach(el => {
    ui.chips[el.dataset.power] = { el, bar: el.querySelector('i') };
  });

  function showScreen(name) {
    for (const k in ui.screens) ui.screens[k].classList.toggle('is-hidden', k !== name);
    const focusBtn = {
      start: 'btn-play', pause: 'btn-resume', over: 'btn-restart',
    }[name];
    if (focusBtn) setTimeout(() => document.getElementById(focusBtn).focus({ preventScroll: true }), 30);
  }

  function score() { return Math.floor(state.distance) + Math.floor(state.money); }

  function updateHUD() {
    if (mode !== 'playing' && mode !== 'dying') return;
    const s = score();
    if (s !== ui.last.score) { ui.score.textContent = fmtNum(s); ui.last.score = s; }
    if (state.money !== ui.last.money) { ui.money.textContent = fmtMoney(state.money); ui.last.money = state.money; }
    if (state.lives !== ui.last.lives) {
      const slots = Math.max(CFG.lives, state.lives);
      let html = '';
      for (let i = 0; i < slots; i++) html += i < state.lives ? '♥' : '<span class="lost">♥</span>';
      ui.lives.innerHTML = html;
      ui.last.lives = state.lives;
    }
    for (const k in ui.chips) {
      const remaining = state.power[k];
      const chip = ui.chips[k];
      chip.el.classList.toggle('is-hidden', remaining <= 0);
      if (remaining > 0) chip.bar.style.transform = 'scaleX(' + clamp(remaining / CFG.powerDuration[k], 0, 1) + ')';
    }
  }

  function updateMuteButton() {
    ui.muteBtn.textContent = Sound.muted ? '🔇' : '🔊';
    ui.muteBtn.setAttribute('aria-label', Sound.muted ? 'Activar sonido' : 'Silenciar sonido');
  }

  // ---------- Flujo de partida ----------
  function resetWorld() {
    state = newState();
    player = newPlayer();
    randes = newRandes();
    obstacles = []; items = []; powerups = []; particles = []; texts = [];
    input.crouch = false; input.sprint = false; input.jumpHeld = false;
  }

  function goToMenu() {
    resetWorld();
    randes.cx = 830;   // en el inicio, la persecución se ve a la derecha de la tarjeta
    player.cx = 640;
    mode = 'menu';
    ui.hud.classList.add('is-hidden');
    ui.bestStart.textContent = fmtNum(bestScore);
    showScreen('start');
  }

  function startGame() {
    resetWorld();
    mode = 'playing';
    ui.last = { score: -1, money: -1, lives: -1 };
    ui.hud.classList.remove('is-hidden');
    showScreen(null);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    banner('¡Atrapa a Randes!', 1.6);
    updateHUD();
  }

  function pauseGame() {
    if (mode !== 'playing') return;
    mode = 'paused';
    showScreen('pause');
  }

  function resumeGame() {
    if (mode !== 'paused') return;
    input.crouch = false; input.sprint = false; input.jumpHeld = false;
    mode = 'playing';
    showScreen(null);
    lastTime = 0; // evita un salto de tiempo tras la pausa
  }

  function endGame() {
    mode = 'over';
    const final = score();
    const isRecord = final > bestScore;
    if (isRecord) { bestScore = final; storage.set(BEST_KEY, String(bestScore)); }
    document.getElementById('over-score').textContent = fmtNum(final);
    document.getElementById('over-money').textContent = fmtMoney(state.money);
    document.getElementById('over-distance').textContent = fmtNum(state.distance) + ' m';
    document.getElementById('over-tags').textContent = fmtNum(state.tags);
    document.getElementById('over-best').textContent = fmtNum(bestScore);
    document.getElementById('over-record').classList.toggle('is-hidden', !isRecord);
    ui.hud.classList.add('is-hidden');
    showScreen('over');
  }

  // Botones de la interfaz
  const on = (id, fn) => document.getElementById(id).addEventListener('click', e => {
    Sound.unlock();
    fn();
    // Quita el foco de los botones del HUD para que Espacio siga siendo "saltar"
    if (mode === 'playing') e.currentTarget.blur();
  });
  on('btn-play', startGame);
  on('btn-restart', startGame);
  on('btn-menu', goToMenu);
  on('btn-resume', resumeGame);
  on('btn-quit', goToMenu);
  on('btn-pause', () => (mode === 'playing' ? pauseGame() : resumeGame()));
  on('btn-mute', () => { Sound.toggle(); updateMuteButton(); });

  // ===========================================================
  // 12. BUCLE PRINCIPAL Y ARRANQUE
  // -----------------------------------------------------------
  // Paso fijo: la física se actualiza siempre a 60 Hz, aunque la
  // pantalla vaya a 30, 60, 120 o 144 Hz. Así el juego se siente
  // igual en cualquier dispositivo.
  // ===========================================================
  let lastTime = 0;
  let accumulator = 0;

  function frame(now) {
    if (!lastTime) lastTime = now;
    let delta = (now - lastTime) / 1000;
    lastTime = now;
    if (delta > 0.25) delta = 0.25; // tras un parón, no simular segundos de golpe

    accumulator += delta;
    let steps = 0;
    while (accumulator >= STEP && steps < 8) {
      update(STEP);
      accumulator -= STEP;
      steps++;
    }
    if (steps === 8) accumulator = 0;

    render();
    updateHUD();
    requestAnimationFrame(frame);
  }

  /** Ajusta la resolución interna del canvas al tamaño en pantalla (nítido en pantallas retina). */
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewScale = (rect.width * dpr) / W;
    canvas.width = Math.round(W * viewScale);
    canvas.height = Math.round(H * viewScale);
    ctx.imageSmoothingEnabled = false;
  }

  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);

  function boot() {
    resize();
    updateMuteButton();
    Background.build();
    resetWorld();
    requestAnimationFrame(frame); // el canvas pinta desde el primer instante

    loadAllAssets().then(() => {
      if (failedAssets.length) {
        const warn = document.getElementById('asset-warning');
        warn.textContent = 'Algunos sprites no se encontraron en /assets/ y se muestran con formas de respaldo: ' +
          failedAssets.map(s => s.replace('assets/', '')).join(', ');
        warn.classList.remove('is-hidden');
      }
      goToMenu();
    });
  }

  boot();
})();
