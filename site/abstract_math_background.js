/* ============================================================================
   abstract_math_background.js
   Canvas-2D port of FourierSignalGarden (Manim CE).

   Draws into  <canvas class="mm-hero-canvas">  positioned absolutely inside
   .mm-hero. The canvas is transparent, so the hero's own background colour
   (--mm-abyss) shows through and blends automatically.

   Every quantity below is periodic in `phase` with period TAU, so the loop
   is seamless without any cross-fade tricks.
   ========================================================================= */

(function () {
  "use strict";

  const TAU = Math.PI * 2;

  /* ---- Configuration (mirrors the .py header) ------------------------ */
  const LOOP_DURATION = 8.0;   // seconds per loop
  const INTENSITY     = 2.5;   // global brightness / thickness knob
  const MAX_DPR       = 2;     // cap device-pixel-ratio for perf

  /* Manim frame: 14.22 x 8.00 units */
  const FRAME_W = 14.22;
  const FRAME_H = 8.00;

  const X_LEFT  = 0.90;
  const X_RIGHT = 7.45;

  /* Manim renders 8 units into 1080 px, and a stroke_width of 4 lands at
     roughly 2.4 px, so 1 stroke unit ~= 0.6 px at that reference size. */
  const STROKE_REF_PX   = 0.6;
  const MANIM_PX_PER_UNIT = 135;

  /* Palette — matches the CSS custom properties in styles.css */
  const CYAN     = "85, 230, 230";   // #55E6E6
  const CYAN_DIM = "35, 122, 131";   // #237A83
  const CORAL    = "255, 123, 114";  // #FF7B72

  /* ---- Math helpers (verbatim from the .py) -------------------------- */
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const smoothstep = (v) => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); };

  const leftFade  = (x) => smoothstep((x - X_LEFT) / 1.35);
  const rightFade = (x) => smoothstep((X_RIGHT - x) / 0.35);
  const visibilityEnvelope = (x) => leftFade(x) * rightFade(x);

  const breathing  = (p) => 0.82 + 0.18 * (1 - Math.cos(p)) / 2;
  const coralPulse = (p) => { const t = (1 - Math.cos(p)) / 2; return t * t * t * t; };

  const normX = (x) => (x - X_LEFT) / (X_RIGHT - X_LEFT);

  const sOp = (o) => Math.min(o * INTENSITY, 1.0);
  const sW  = (w) => w * INTENSITY;
  const sR  = (r) => r * (1 + 0.3 * (INTENSITY - 1));

  const rgba = (c, a) => "rgba(" + c + "," + clamp(a, 0, 1).toFixed(4) + ")";

  /* ---- Waveform definitions (verbatim from the .py) ------------------ */
  const drift = (p, amount, mul) => amount * Math.sin(p * mul);

  function yFundamental(x, p) {
    const u = normX(x);
    const a = 0.52 * breathing(p);
    return 0.40 + a * Math.sin(TAU * 1.35 * u + p + drift(p, 0.16, 1.0));
  }

  function ySecond(x, p) {
    const u = normX(x);
    const a = 0.27 * breathing(p);
    return -0.63 + a * Math.sin(TAU * 2.70 * u + 2 * p + 0.55 + drift(p, 0.11, 0.5));
  }

  function yThird(x, p) {
    const u = normX(x);
    const a = 0.17 * breathing(p);
    return -1.42 + a * Math.sin(TAU * 4.05 * u + 3 * p - 0.35 + drift(p, 0.08, 2.0));
  }

  function ySummed(x, p) {
    const u = normX(x);
    const a = breathing(p);
    const f  = 0.32 * Math.sin(TAU * 1.35 * u + p       + drift(p, 0.16, 1.0));
    const h2 = 0.15 * Math.sin(TAU * 2.70 * u + 2 * p   + 0.55);
    const h3 = 0.08 * Math.sin(TAU * 4.05 * u + 3 * p   - 0.35);
    return -2.28 + a * (f + h2 + h3);
  }

  /* ====================================================================
     Renderer
     ==================================================================== */

  const MAX_SAMPLES = 160;
  const NB = 12;                     // opacity buckets per wave

  function HeroBackground(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });

    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.scale = 1;
    this.ox = 0;
    this.oy = 0;

    this.phase = 0;
    this.running = false;
    this.rafId = 0;
    this.t0 = 0;

    this._xs = new Float64Array(MAX_SAMPLES);
    this._ys = new Float64Array(MAX_SAMPLES);
    this._buckets = [];
    for (let i = 0; i < NB; i++) this._buckets.push([]);
  }

  /* ---- Coordinate mapping -------------------------------------------
     Reproduces  object-fit: cover; object-position: right center  on a
     14.22 x 8.00 Manim frame. Returns CSS pixels; the DPR transform is
     applied once per frame via setTransform().                         */

  HeroBackground.prototype.px = function (mx) {
    return this.ox + (mx + FRAME_W / 2) * this.scale;
  };
  HeroBackground.prototype.py = function (my) {
    return this.oy + (FRAME_H / 2 - my) * this.scale;
  };
  HeroBackground.prototype.ps = function (u) {
    return u * this.scale;
  };
  /* Manim stroke-width units -> CSS px at the current zoom. */
  HeroBackground.prototype.sw = function (w) {
    return Math.max(0.5, w * STROKE_REF_PX * (this.scale / MANIM_PX_PER_UNIT));
  };

  /* ---- Layout -------------------------------------------------------- */

  HeroBackground.prototype.resize = function () {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

    this.dpr = dpr;
    this.w = rect.width;
    this.h = rect.height;

    this.canvas.width  = Math.max(1, Math.round(rect.width  * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));

    const s = Math.max(rect.width / FRAME_W, rect.height / FRAME_H);
    this.scale = s;
    this.ox = rect.width  - FRAME_W * s;          // right-aligned
    this.oy = (rect.height - FRAME_H * s) / 2;    // vertically centred
  };

  /* ---- Frame --------------------------------------------------------- */

  HeroBackground.prototype.draw = function (p) {
    const ctx = this.ctx;
    if (this.w < 1 || this.h < 1) return;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    this.drawAtmosphere();
    this.drawPhaseDiagram();
    this.drawPhasors(p);       // phasors, then waves on top — matches self.add() order
    this.drawWaves(p);
    this.drawParticles(p);
    this.drawRipples(p);
  };

  /* ---- Atmospheric glow ---------------------------------------------- */

  HeroBackground.prototype.drawAtmosphere = function () {
    const ctx = this.ctx;
    const spots = [
      { x: 5.65, y: 0.45, r: 2.65, a: sOp(0.018) },
      { x: 5.75, y: 1.35, r: 1.75, a: sOp(0.015) },
    ];
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const cx = this.px(s.x);
      const cy = this.py(s.y);
      const r  = this.ps(s.r);
      /* Soft-edged instead of Manim's hard circle — invisible at these
         alphas but avoids a faint rim on high-DPI displays. */
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0.00, rgba(CYAN, s.a));
      g.addColorStop(0.55, rgba(CYAN, s.a * 0.55));
      g.addColorStop(1.00, rgba(CYAN, 0));
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fillStyle = g;
      ctx.fill();
    }
  };

  /* ---- Phase diagram (static rings, arcs, markers) -------------------- */

  HeroBackground.prototype.drawPhaseDiagram = function () {
    const ctx = this.ctx;
    const CX = 5.65, CY = 1.65, R = 0.88;
    const ccx = this.px(CX), ccy = this.py(CY);

    const circles = [
      [R,        sW(1.8), sOp(0.28)],
      [R * 0.68, sW(1.4), sOp(0.18)],
      [R * 0.34, sW(1.2), sOp(0.14)],
    ];
    for (let i = 0; i < circles.length; i++) {
      ctx.beginPath();
      ctx.arc(ccx, ccy, this.ps(circles[i][0]), 0, TAU);
      ctx.strokeStyle = rgba(CYAN_DIM, circles[i][2]);
      ctx.lineWidth = this.sw(circles[i][1]);
      ctx.stroke();
    }

    /* Manim angles are CCW with +y up; canvas +y is down, so negate the
       angles and sweep anticlockwise. */
    const arcs = [
      [R * 1.18, 0.18 * Math.PI, 0.44 * Math.PI, CYAN,  sW(2.2), sOp(0.24)],
      [R * 1.18, 1.20 * Math.PI, 0.30 * Math.PI, CYAN,  sW(2.2), sOp(0.17)],
      [R * 0.82, 0.78 * Math.PI, 0.37 * Math.PI, CORAL, sW(2.0), sOp(0.18)],
    ];
    for (let i = 0; i < arcs.length; i++) {
      const a = arcs[i];
      ctx.beginPath();
      ctx.arc(ccx, ccy, this.ps(a[0]), -a[1], -(a[1] + a[2]), true);
      ctx.strokeStyle = rgba(a[3], a[5]);
      ctx.lineWidth = this.sw(a[4]);
      ctx.stroke();
    }

    /* 12 evenly spaced markers on the outer ring */
    const markerR = this.ps(sR(0.018));
    ctx.fillStyle = rgba(CYAN_DIM, sOp(0.23));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const mx = CX + R * Math.cos(a);
      const my = CY + R * Math.sin(a);
      ctx.beginPath();
      ctx.arc(this.px(mx), this.py(my), markerR, 0, TAU);
      ctx.fill();
    }
  };

  /* ---- Phasors -------------------------------------------------------- */

  HeroBackground.prototype.drawPhasors = function (p) {
    const CX = 5.65, CY = 1.65, R = 0.88;

    this.drawPhasor(
      CX, CY, p, R, CYAN,
      sOp(0.78), this.sw(sW(2.7)), sR(0.045)
    );
    this.drawPhasor(
      CX, CY, 2 * p + 0.45, R * 0.61, CORAL,
      sOp(0.28 + 0.50 * coralPulse(p)), this.sw(sW(2.1)), sR(0.035)
    );
  };

  HeroBackground.prototype.drawPhasor = function (
    cx, cy, angle, radius, color, opacity, width, dotR
  ) {
    const ctx = this.ctx;

    const ex = cx + radius * Math.cos(angle);
    const ey = cy + radius * Math.sin(angle);

    const x0 = this.px(cx), y0 = this.py(cy);
    const x1 = this.px(ex), y1 = this.py(ey);

    /* outer glow */
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = rgba(color, opacity * 0.045);
    ctx.lineWidth = width * 4.5;
    ctx.stroke();

    /* main line */
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = rgba(color, opacity);
    ctx.lineWidth = width;
    ctx.stroke();

    this.drawGlowingDot(ex, ey, color, dotR, opacity);

    /* centre pivot */
    ctx.beginPath();
    ctx.arc(x0, y0, this.ps(sR(0.018)), 0, TAU);
    ctx.fillStyle = rgba(color, 0.35 * opacity);
    ctx.fill();
  };

  /* ---- Waveforms ------------------------------------------------------ */

  HeroBackground.prototype.drawWaves = function (p) {
    /* Order matters: back-to-front, exactly as in the .py self.add() call. */
    this.strokeWave(p, yThird,       CYAN_DIM, this.sw(sW(1.7)), sOp(0.36), 130, false);
    this.strokeWave(p, ySecond,      CYAN_DIM, this.sw(sW(2.1)), sOp(0.50), 120, false);
    this.strokeWave(p, yFundamental, CYAN,     this.sw(sW(3.0)), sOp(0.88), 110, true);
    this.strokeWave(p, ySummed,      CORAL,    this.sw(sW(2.6)),
                    sOp(0.11 + 0.79 * coralPulse(p)), 130, true);
  };

  /**
   * Draws one segmented waveform.
   *
   * The spatial fade (visibilityEnvelope) is what forced Manim to split the
   * curve into hundreds of individual Line objects. Canvas 2D can do the same
   * thing with a single globalAlpha per path — but a path has one alpha for
   * all its segments, so we quantise the envelope into NB buckets and issue
   * one stroke() per bucket. That is ~12 draw calls per wave instead of 130.
   */
  HeroBackground.prototype.strokeWave = function (
    p, yFn, color, width, base, samples, glow
  ) {
    const ctx = this.ctx;
    const xs = this._xs;
    const ys = this._ys;

    if (base <= 0.004) return;

    /* 1. Sample the curve once. */
    for (let i = 0; i < samples; i++) {
      const x = X_LEFT + (X_RIGHT - X_LEFT) * (i / (samples - 1));
      xs[i] = x;
      ys[i] = yFn(x, p);
    }

    /* 2. Bucket the segments by their envelope value. Because
          opacity == base * envelope, bucketing the envelope (not the
          opacity) lets us reconstruct the true alpha per bucket. */
    const buckets = this._buckets;
    for (let b = 0; b < NB; b++) buckets[b].length = 0;

    for (let i = 0; i < samples - 1; i++) {
      const mx = 0.5 * (xs[i] + xs[i + 1]);
      const env = visibilityEnvelope(mx);
      if (env < 0.01) continue;
      const b = Math.min(NB - 1, Math.floor(env * NB));
      buckets[b].push(i);
    }

    /* 3. Glow pass (wide, very low alpha) then main pass (thin, full alpha).
          Doing all glows first gives a cleaner halo than Manim's
          interleaved ordering, and costs nothing extra. */
    if (glow) {
      const gw = width * 4.0;
      for (let b = 0; b < NB; b++) {
        const segs = buckets[b];
        if (segs.length === 0) continue;
        const a = base * ((b + 0.5) / NB) * 0.07;
        if (a < 0.004) continue;
        ctx.beginPath();
        for (let k = 0; k < segs.length; k++) {
          const i = segs[k];
          ctx.moveTo(this.px(xs[i]),     this.py(ys[i]));
          ctx.lineTo(this.px(xs[i + 1]), this.py(ys[i + 1]));
        }
        ctx.strokeStyle = rgba(color, a);
        ctx.lineWidth = gw;
        ctx.stroke();
      }
    }

    for (let b = 0; b < NB; b++) {
      const segs = buckets[b];
      if (segs.length === 0) continue;
      const a = base * ((b + 0.5) / NB);
      if (a < 0.004) continue;
      ctx.beginPath();
      for (let k = 0; k < segs.length; k++) {
        const i = segs[k];
        ctx.moveTo(this.px(xs[i]),     this.py(ys[i]));
        ctx.lineTo(this.px(xs[i + 1]), this.py(ys[i + 1]));
      }
      ctx.strokeStyle = rgba(color, a);
      ctx.lineWidth = width;
      ctx.stroke();
    }
  };

  /* ---- Particles ------------------------------------------------------ */

  HeroBackground.prototype.drawParticles = function (p) {
    const specs = [
      { off: 0.02, fn: yFundamental, color: CYAN,     r: sR(0.038), speed: 1.0,      base: 1.0 },
      { off: 0.39, fn: yFundamental, color: CYAN,     r: sR(0.030), speed: 1.0,      base: 1.0 },
      { off: 0.18, fn: ySecond,      color: CYAN_DIM, r: sR(0.026), speed: 0.5,      base: 1.0 },
      { off: 0.64, fn: yThird,       color: CYAN_DIM, r: sR(0.022), speed: 1.0 / 3,  base: 1.0 },
      { off: 0.47, fn: ySummed,      color: CORAL,    r: sR(0.033), speed: 1.0,
        base: sOp(0.12 + 0.88 * coralPulse(p)) },
    ];

    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      const prog = ((s.off + s.speed * p / TAU) % 1 + 1) % 1;
      const x = X_RIGHT - prog * (X_RIGHT - X_LEFT);
      const y = s.fn(x, p);
      const a = s.base * visibilityEnvelope(x);
      if (a < 0.01) continue;
      this.drawGlowingDot(x, y, s.color, s.r, a);
    }
  };

  HeroBackground.prototype.drawGlowingDot = function (mx, my, color, radius, opacity) {
    const ctx = this.ctx;
    const cx = this.px(mx);
    const cy = this.py(my);

    const layers = [
      [3.6, 0.05],
      [2.1, 0.13],
      [1.0, 0.95],
    ];
    for (let i = 0; i < layers.length; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0.4, this.ps(radius * layers[i][0])), 0, TAU);
      ctx.fillStyle = rgba(color, layers[i][1] * opacity);
      ctx.fill();
    }
  };

  /* ---- Phase ripples -------------------------------------------------- */

  HeroBackground.prototype.drawRipples = function (p) {
    const ctx = this.ctx;
    const CX = 5.65, CY = 1.65;
    const offsets = [0.0, 0.33, 0.66];
    const width = this.sw(sW(1.7));

    /* Subtle parallax jitter, shared by all three rings. */
    const jx = 0.07  * Math.sin(p);
    const jy = 0.025 * Math.sin(2 * p);

    for (let i = 0; i < offsets.length; i++) {
      const prog = ((p / TAU + offsets[i]) % 1 + 1) % 1;
      const r = 0.20 + 1.30 * prog;

      const fadeIn  = smoothstep(prog / 0.12);
      const fadeOut = smoothstep((1.0 - prog) / 0.72);
      const a = sOp(0.11 * fadeIn * fadeOut * 1.35);
      if (a < 0.004) continue;

      ctx.beginPath();
      ctx.arc(this.px(CX + jx), this.py(CY + jy), this.ps(r), 0, TAU);
      ctx.strokeStyle = rgba(CYAN, a);
      ctx.lineWidth = width;
      ctx.stroke();
    }
  };

  /* ---- Playback ------------------------------------------------------- */

  HeroBackground.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    /* Resume from wherever we left off, so pausing off-screen does not
       snap the animation back to phase 0. */
    this.t0 = performance.now() - (this.phase / TAU) * LOOP_DURATION * 1000;

    const self = this;
    const tick = function (now) {
      if (!self.running) return;
      self.phase = (((now - self.t0) / 1000 / LOOP_DURATION) * TAU) % TAU;
      self.draw(self.phase);
      self.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  };

  HeroBackground.prototype.stop = function () {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  };

  /* Mid-loop is where the coral pulse peaks, so the still frame is the most
     representative one. */
  HeroBackground.prototype.renderStatic = function () {
    this.phase = Math.PI;
    this.draw(this.phase);
  };

  /* ---- Boot ----------------------------------------------------------- */

  function init() {
    const canvas = document.querySelector(".mm-hero-canvas");
    if (!canvas) return;

    const bg = new HeroBackground(canvas);

    const relayout = function () {
      bg.resize();
      if (!bg.running) bg.renderStatic();
    };
    relayout();

    let resizeTimer = 0;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(relayout, 120);
    }, { passive: true });

    /* Honour reduced-motion: show one static frame, never animate. */
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      bg.renderStatic();
      return;
    }

    /* Pause when scrolled out of view — a hero is decoration, it should not
       burn a phone battery after the reader scrolls past. */
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        for (let i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) bg.start();
          else bg.stop();
        }
      }, { threshold: 0 }).observe(canvas);
    } else {
      bg.start();
    }

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) bg.stop();
      else bg.start();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();