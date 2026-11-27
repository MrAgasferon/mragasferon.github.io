/* =============================================================================
 * VELICRON CASINO for Lampa — слоты + европейская рулетка, управление пультом.
 * v1.1.0 · ES5 · без зависимостей · виртуальные фишки
 *
 * ЧТО ИСПРАВЛЕНО
 *  - Весь интерфейс рисуется в фиксированном «дизайн-холсте» и масштабируется
 *    под реальный размер области Lampa (transform: scale). Кнопки больше не
 *    уходят за экран ни на 720p, ни на 1080p, ни на узких окнах.
 *  - Три раскладки: wide (со сводкой), mid (без сводки), narrow (вертикальная).
 *  - Поле рулетки перестроено: зеро отдельной колонкой на всю высоту трёх рядов,
 *    числа flex:1 c min-width:0 — первый десяток больше не обрезается и все
 *    колонки строго выровнены. Зеро доступно пультом с любого из трёх рядов.
 *  - Канвасы (колесо, частицы) рендерятся с учётом масштаба — без мыла.
 *
 * УСТАНОВКА С GITHUB
 *   Lampa → Настройки → Плагины → Добавить плагин → URL:
 *     GitHub Pages : https://USER.github.io/REPO/casino/casino.js
 *     jsDelivr CDN : https://cdn.jsdelivr.net/gh/USER/REPO@v1.1.0/casino/casino.js
 *   raw.githubusercontent.com не подходит (text/plain + nosniff).
 *   Обновление: Pages — ?v=3 ; jsDelivr — новый тег либо purge.jsdelivr.net.
 *
 * ПУЛЬТ: ←/→ выбор в ряду · ↑/↓ между рядами · OK действие · BACK выход
 *        (фишки со стола рулетки возвращаются в банк). Мышь тоже работает.
 * ========================================================================== */
(function () {
    'use strict';
    if (window.plugin_velicron_casino) return;
    window.plugin_velicron_casino = true;

    /* ---------------------------------------------------------------- utils */
    var RAF = window.requestAnimationFrame || window.webkitRequestAnimationFrame ||
              function (f) { return setTimeout(function () { f(now()); }, 16); };
    var CAF = window.cancelAnimationFrame || window.webkitCancelAnimationFrame || clearTimeout;
    function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function mod(a, n) { return ((a % n) + n) % n; }
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function ri(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
    function fmt(n) {
        n = Math.round(n); var s = String(Math.abs(n)), out = '', i, c = 0;
        for (i = s.length - 1; i >= 0; i--) { out = s.charAt(i) + out; if (++c % 3 === 0 && i > 0) out = ' ' + out; }
        return (n < 0 ? '-' : '') + out;
    }
    function eOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function eOutQuart(t) { return 1 - Math.pow(1 - t, 4); }
    function eInOut(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function opt(name, def) {
        var v = Lampa.Storage.field(name);
        if (typeof v === 'undefined' || v === null || v === '') return def;
        return v === true || v === 'true';
    }

    /* ---------------------------------------------------------------- state */
    var KEY = 'velicron_casino';
    var LINE_BETS = [1, 2, 5, 10, 25, 50, 100];
    var CHIPS = [5, 25, 100, 500];
    var CHIP_C = { 5: '#ff8fa0', 25: '#9dffc9', 100: '#a9d8ff', 500: '#e0b3ff' };

    function fresh() {
        return { bank: 2500, start: 2500, xp: 0, level: 1, jackpot: 25000,
                 wagered: 0, returned: 0, best: 0, spins: 0, rspin: 0,
                 day: '', rescue: 0, hist: [], nums: [], last: null,
                 betIdx: 2, chipIdx: 1, game: 'slots' };
    }
    var S = fresh();
    (function load() {
        var d = Lampa.Storage.get(KEY, null), f = fresh(), k;
        if (d && typeof d === 'object') { for (k in f) if (typeof d[k] !== 'undefined') f[k] = d[k]; S = f; }
        S.bank = Math.max(0, parseInt(S.bank, 10) || 0);
        S.jackpot = Math.max(25000, parseInt(S.jackpot, 10) || 25000);
        S.betIdx = clamp(S.betIdx | 0, 0, LINE_BETS.length - 1);
        S.chipIdx = clamp(S.chipIdx | 0, 0, CHIPS.length - 1);
        if (!(S.hist instanceof Array)) S.hist = [];
        if (!(S.nums instanceof Array)) S.nums = [];
        if (S.game !== 'slots' && S.game !== 'roulette') S.game = 'slots';
    })();
    function save() { Lampa.Storage.set(KEY, S); }
    function xpNeed(l) { return 400 + (l - 1) * 260; }

    /* ---------------------------------------------------------------- sound */
    var Snd = {
        ctx: null, master: null, roll: null, rg: null, rf: null, lastTick: 0,
        ensure: function () {
            if (this.ctx) return this.ctx;
            try {
                var AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return null;
                this.ctx = new AC();
                this.master = this.ctx.createGain();
                this.master.gain.value = opt('vc_sound', true) ? .6 : 0;
                this.master.connect(this.ctx.destination);
            } catch (e) { this.ctx = null; }
            return this.ctx;
        },
        resume: function () { var c = this.ensure(); if (c && c.state === 'suspended' && c.resume) c.resume(); },
        sync: function () { if (this.master) this.master.gain.value = opt('vc_sound', true) ? .6 : 0; },
        tone: function (f, dur, type, gain, when, slide) {
            var c = this.ensure(); if (!c || !opt('vc_sound', true)) return;
            try {
                var t = c.currentTime + (when || 0), o = c.createOscillator(), g = c.createGain();
                o.type = type || 'square'; o.frequency.setValueAtTime(f, t);
                if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t + dur);
                g.gain.setValueAtTime(.0001, t);
                g.gain.exponentialRampToValueAtTime(Math.max(.0002, gain || .05), t + .012);
                g.gain.exponentialRampToValueAtTime(.0001, t + dur);
                o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + .03);
            } catch (e) {}
        },
        noise: function (dur, freq, gain, when) {
            var c = this.ensure(); if (!c || !opt('vc_sound', true)) return;
            try {
                var t = c.currentTime + (when || 0), len = Math.max(1, Math.floor(c.sampleRate * dur));
                var buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0), i;
                for (i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
                var src = c.createBufferSource(); src.buffer = buf;
                var f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.1;
                var g = c.createGain(); g.gain.value = gain || .05;
                src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
            } catch (e) {}
        },
        tick: function () { var n = now(); if (n - this.lastTick < 60) return; this.lastTick = n; this.tone(1050 + Math.random() * 250, .03, 'square', .016); },
        stopReel: function (i) { this.tone(150 + i * 22, .13, 'triangle', .07); this.noise(.08, 900, .045); },
        chip: function () { this.tone(1500, .045, 'square', .03); this.noise(.05, 2500, .03); },
        click: function () { this.tone(660, .04, 'triangle', .028); },
        move: function () { this.tone(420, .025, 'sine', .018); },
        lose: function () { this.tone(190, .16, 'sine', .04, 0, 120); },
        coin: function (i) { this.tone(880 + i * 90, .09, 'triangle', .032, i * .045); },
        win: function (m) { var b = [523, 659, 784, 1047, 1319, 1568], n = clamp(Math.round(2 + m / 6), 3, 6), i;
            for (i = 0; i < n; i++) this.tone(b[i], .2, 'triangle', .05, i * .075); },
        fanfare: function () { var q = [523, 659, 784, 1047, 784, 1047, 1319, 1568], i;
            for (i = 0; i < q.length; i++) { this.tone(q[i], .26, 'triangle', .055, i * .1); this.tone(q[i] / 2, .26, 'sine', .03, i * .1); } },
        level: function () { var q = [392, 523, 659, 880], i; for (i = 0; i < q.length; i++) this.tone(q[i], .3, 'triangle', .055, i * .09); },
        antic: function () { this.tone(300, .9, 'sawtooth', .028, 0, 900); },
        ball: function () { this.tone(2100, .05, 'square', .045); this.noise(.06, 3000, .04); },
        rollStart: function () {
            var c = this.ensure(); if (!c || !opt('vc_sound', true) || this.roll) return;
            try {
                var len = Math.floor(c.sampleRate * 2), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0), i;
                for (i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
                var src = c.createBufferSource(); src.buffer = buf; src.loop = true;
                var f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = .9;
                var g = c.createGain(); g.gain.value = 0;
                src.connect(f); f.connect(g); g.connect(this.master); src.start();
                this.roll = src; this.rg = g; this.rf = f;
            } catch (e) {}
        },
        rollSet: function (v) { if (!this.rg || !this.ctx) return;
            try { this.rg.gain.setTargetAtTime(clamp(v * .05, 0, .055), this.ctx.currentTime, .08);
                  if (this.rf) this.rf.frequency.setTargetAtTime(600 + v * 1300, this.ctx.currentTime, .1); } catch (e) {} },
        rollStop: function () { if (!this.roll) return; var r = this.roll;
            try { this.rg.gain.setTargetAtTime(0, this.ctx.currentTime, .06); } catch (e) {}
            setTimeout(function () { try { r.stop(); } catch (e) {} }, 260);
            this.roll = null; this.rg = null; this.rf = null; }
    };

    /* ------------------------------------------------------------ slots data */
    var SYM = [
        { g: '♥', c: '#ff5d73', p: [0, 0, 10, 25, 100] },
        { g: '♦', c: '#ffab2e', p: [0, 0, 10, 25, 100] },
        { g: '♣', c: '#8dff4a', p: [0, 0, 15, 50, 200] },
        { g: '♠', c: '#22e0ff', p: [0, 0, 15, 50, 200] },
        { g: '★', c: '#ff2d95', p: [0, 0, 30, 100, 320] },
        { g: '$', c: '#12c98b', p: [0, 0, 50, 160, 650] },
        { g: '7', c: '#ffd400', p: [0, 0, 80, 320, 1600] },
        { g: 'W', c: '#c9a3ff', p: [0, 0, 160, 650, 3200] },
        { g: 'B', c: '#9dfff0', p: [0, 0, 0, 0, 0] }
    ];
    var WILD = 7, SCAT = 8, WEIGHT = [7, 7, 6, 6, 4, 3, 2, 1, 1];
    var LINES = [[1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2]];
    var LC = ['#f6c453', '#22e0ff', '#ff2d95', '#8dff4a', '#ffab2e'];

    function strip(seed) {
        var a = [], i, k, s = seed, j, t, pass;
        for (i = 0; i < WEIGHT.length; i++) for (k = 0; k < WEIGHT[i]; k++) a.push(i);
        function rr() { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }
        for (i = a.length - 1; i > 0; i--) { j = Math.floor(rr() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
        for (pass = 0; pass < 3; pass++) for (i = 0; i < a.length; i++) {
            j = (i + 1) % a.length;
            if ((a[i] === SCAT && a[j] === SCAT) || (a[i] === WILD && a[j] === WILD)) {
                k = Math.floor(rr() * a.length); t = a[i]; a[i] = a[k]; a[k] = t;
            }
        }
        return a;
    }

    /* --------------------------------------------------------- roulette data */
    var ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
    var RED = {1:1,3:1,5:1,7:1,9:1,12:1,14:1,16:1,18:1,19:1,21:1,23:1,25:1,27:1,30:1,32:1,34:1,36:1};
    function colOf(n) { return n === 0 ? 'green' : (RED[n] ? 'red' : 'black'); }
    var OUT = {
        red:   { m: 1, t: function (n) { return n !== 0 && !!RED[n]; } },
        black: { m: 1, t: function (n) { return n !== 0 && !RED[n]; } },
        even:  { m: 1, t: function (n) { return n !== 0 && n % 2 === 0; } },
        odd:   { m: 1, t: function (n) { return n % 2 === 1; } },
        low:   { m: 1, t: function (n) { return n >= 1 && n <= 18; } },
        high:  { m: 1, t: function (n) { return n >= 19 && n <= 36; } },
        d1:    { m: 2, t: function (n) { return n >= 1 && n <= 12; } },
        d2:    { m: 2, t: function (n) { return n >= 13 && n <= 24; } },
        d3:    { m: 2, t: function (n) { return n >= 25 && n <= 36; } },
        c1:    { m: 2, t: function (n) { return n !== 0 && n % 3 === 1; } },
        c2:    { m: 2, t: function (n) { return n !== 0 && n % 3 === 2; } },
        c3:    { m: 2, t: function (n) { return n !== 0 && n % 3 === 0; } }
    };
    function def(k) {
        if (k.charAt(0) === 'n') { var n = parseInt(k.slice(1), 10);
            return { m: 35, t: function (r) { return r === n; } }; }
        return OUT[k];
    }

    /* ---------------------------------------------------------------- styles */
    Lampa.Template.add('vc_css', '<style>\
.vc-fit{position:relative;overflow:visible}\
.vc{position:relative;transform-origin:0 0;-webkit-transform-origin:0 0;overflow:hidden;display:flex;flex-direction:column;\
 padding:16px;color:#f6eeff;border-radius:18px;background:linear-gradient(165deg,#1c1030,#0e0718 58%,#0a0512);\
 border:1px solid rgba(246,196,83,.16);box-shadow:0 20px 60px rgba(0,0,0,.55)}\
.vc *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}\
.vc-top{flex:0 0 auto;display:flex;align-items:center;min-height:56px;margin-bottom:12px}\
.vc-logo{font-size:26px;font-weight:800;letter-spacing:.14em;color:#f6c453;margin-right:18px;white-space:nowrap;\
 text-shadow:0 0 14px rgba(246,196,83,.45)}\
.vc-logo i{font-style:normal;color:#ff2d95}\
.vc-tabs{display:flex;flex:0 0 auto}\
.vc-tab{padding:11px 20px;margin-right:8px;border-radius:10px;font-size:19px;font-weight:700;letter-spacing:.07em;\
 background:rgba(255,255,255,.08);color:#a394c0;white-space:nowrap}\
.vc-tab.act{background:linear-gradient(120deg,#7b2ff7,#ff2d95);color:#fff}\
.vc-sp{flex:1 1 auto;min-width:8px}\
.vc-stat{display:flex;flex-direction:column;align-items:flex-end;margin-right:18px;line-height:1.15;white-space:nowrap}\
.vc-stat span{font-size:11px;letter-spacing:.2em;color:#6f628c;font-weight:800}\
.vc-stat b{font-size:25px;font-weight:800;color:#ffe9a8}\
.vc-mini{padding:11px 15px;margin-left:8px;border-radius:10px;font-size:16px;font-weight:700;white-space:nowrap;\
 background:rgba(255,255,255,.08);color:#a394c0}\
.vc-mini.on{background:linear-gradient(120deg,#8dff4a,#12c98b);color:#04241a}\
.vc-body{flex:1 1 auto;display:flex;min-height:0}\
.vc-main{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;margin-right:14px}\
.vc-stage{flex:1 1 auto;min-height:0;position:relative}\
.vc-game{display:none;height:100%}\
.vc-game.act{display:block}\
.vc-ctrl{flex:0 0 auto;margin-top:12px}\
.vc-side{flex:0 0 320px;min-width:0;border-radius:14px;padding:16px;overflow-y:auto;overflow-x:hidden;\
 background:linear-gradient(160deg,#241634,#150c22);border:1px solid rgba(255,255,255,.07)}\
.vc-side::-webkit-scrollbar{width:8px}\
.vc-side::-webkit-scrollbar-track{background:rgba(123,47,247,.16);border-radius:8px}\
.vc-side::-webkit-scrollbar-thumb{background:linear-gradient(180deg,#f6c453,#a8802c);border-radius:8px}\
.vc-side::-webkit-scrollbar-thumb:hover{background:linear-gradient(180deg,#ff2d95,#7b2ff7)}\
.vc-side h4{font-size:12px;letter-spacing:.22em;color:#6f628c;font-weight:800;margin:0 0 10px}\
.vc-side h4.mt{margin-top:18px}\
.vc-prow{display:flex;align-items:center;font-size:16px;margin-bottom:6px}\
.vc-prow i{font-style:normal;width:46px;font-weight:800;font-size:19px}\
.vc-prow b{flex:1;text-align:right;color:#ffe9a8;font-weight:700}\
.vc-prow span{flex:1;color:#a394c0}\
.vc-note{font-size:13px;line-height:1.6;color:#8d7fa8;margin-top:10px}\
.vc-note b{color:#f6c453}\
.vc-cab{height:100%;display:flex;flex-direction:column;border-radius:16px;padding:14px;position:relative;\
 background:linear-gradient(170deg,#33194d,#1a0f28 55%,#160c22);border:1px solid rgba(246,196,83,.22)}\
.vc-marq{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;height:44px;padding:0 4px}\
.vc-marq b{font-size:23px;font-weight:800;letter-spacing:.16em;color:#f6c453;white-space:nowrap}\
.vc-jack{display:flex;flex-direction:column;align-items:flex-end;line-height:1.1}\
.vc-jack span{font-size:11px;letter-spacing:.24em;color:#ff2d95;font-weight:800}\
.vc-jack i{font-style:normal;font-size:23px;font-weight:800;color:#ffe9a8}\
.vc-reels{flex:1 1 auto;min-height:0;display:flex;padding:8px;border-radius:12px;position:relative;overflow:hidden;\
 background:#0a0611;border:1px solid rgba(246,196,83,.2)}\
.vc-reel{flex:1 1 0;min-width:0;margin-right:6px;position:relative;overflow:hidden;border-radius:8px;\
 background:linear-gradient(180deg,#1d1229,#241634 50%,#1a1024)}\
.vc-reel:last-child{margin-right:0}\
.vc-reel.ant{box-shadow:inset 0 0 0 3px #ff2d95}\
.vc-strip{position:absolute;left:0;right:0;top:0;will-change:transform}\
.vc-cell{position:absolute;left:0;right:0;display:flex;align-items:center;justify-content:center;font-weight:800;line-height:1}\
.vc-cell.hit{background:rgba(246,196,83,.18);box-shadow:inset 0 0 0 2px #f6c453;border-radius:8px}\
.vc-glass{position:absolute;left:8px;right:8px;top:8px;bottom:8px;border-radius:8px;pointer-events:none;\
 background:linear-gradient(178deg,rgba(255,255,255,.12),rgba(255,255,255,.02) 22%,rgba(0,0,0,0) 45%,rgba(0,0,0,0) 62%,rgba(0,0,0,.45))}\
.vc-lines{position:absolute;left:8px;right:8px;top:8px;bottom:8px;pointer-events:none}\
.vc-lines polyline{fill:none;stroke-width:4;stroke-linecap:round;stroke-linejoin:round;opacity:0}\
.vc-lines polyline.on{opacity:.95}\
.vc-fs{flex:0 0 auto;height:34px;margin-top:8px;border-radius:8px;display:none;align-items:center;justify-content:space-between;\
 padding:0 14px;font-size:16px;font-weight:700;background:linear-gradient(100deg,rgba(34,224,255,.25),rgba(141,255,74,.18))}\
.vc-fs.on{display:flex}\
.vc-fs i{font-style:normal;color:#8dff4a}\
.vc-win{flex:0 0 auto;display:flex;align-items:center;height:72px;margin-top:8px;padding:0 16px;border-radius:10px;background:rgba(0,0,0,.4)}\
.vc-win .m{flex:1 1 auto;min-width:0;font-size:17px;color:#a394c0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}\
.vc-win .m b{color:#ffe9a8}\
.vc-win .a{display:flex;align-items:baseline;flex:0 0 auto}\
.vc-win .a span{font-size:11px;letter-spacing:.2em;color:#6f628c;font-weight:800;margin-right:10px}\
.vc-win .a b{font-size:36px;font-weight:800;color:#ffe9a8}\
.vc-win .a.zero b{color:#6f628c}\
.vc-ban{position:absolute;left:0;right:0;top:34%;text-align:center;pointer-events:none;opacity:0;transition:opacity .25s}\
.vc-ban.on{opacity:1}\
.vc-ban b{display:block;font-size:52px;font-weight:800;letter-spacing:.05em;color:#ffe9a8;text-shadow:0 0 22px #ff2d95}\
.vc-ban i{font-style:normal;font-size:26px;font-weight:700;color:#22e0ff}\
.vc-row{display:flex;align-items:center}\
.vc-row+.vc-row{margin-top:10px}\
.vc-btn{padding:14px 18px;margin-right:10px;border-radius:10px;font-size:18px;font-weight:700;letter-spacing:.04em;\
 background:rgba(255,255,255,.1);color:#d9cdf0;white-space:nowrap}\
.vc-btn.on{background:linear-gradient(120deg,#ff2d95,#7b2ff7);color:#fff}\
.vc-btn.dis{opacity:.4}\
.vc-step{display:flex;align-items:center;margin-right:10px;border-radius:10px;background:rgba(0,0,0,.4);padding:4px}\
.vc-step .s{width:42px;height:42px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800;color:#f6c453}\
.vc-step b{min-width:84px;text-align:center;font-size:22px;font-weight:800}\
.vc-lab{font-size:12px;letter-spacing:.2em;color:#6f628c;font-weight:800;margin-right:12px;white-space:nowrap}\
.vc-spin{margin-left:auto;padding:17px 40px;border-radius:12px;font-size:24px;font-weight:800;letter-spacing:.1em;white-space:nowrap;\
 background:linear-gradient(140deg,#ff6fb8,#ff2d95 45%,#8c1257);color:#fff;box-shadow:0 6px 20px rgba(255,45,149,.35)}\
.vc-spin.stop{background:linear-gradient(140deg,#8ee9ff,#22e0ff 45%,#0b6a86)}\
.vc-spin.dis{opacity:.45}\
.vc-chip{width:52px;height:52px;margin-right:10px;border-radius:50%;display:flex;align-items:center;justify-content:center;\
 font-size:17px;font-weight:800;color:#2a1a05;background:#ffe9a8;box-shadow:inset 0 0 0 4px rgba(255,255,255,.55)}\
.vc-chip.act{box-shadow:inset 0 0 0 4px rgba(255,255,255,.55),0 0 0 3px #f6c453}\
.vc-rt{height:100%;display:flex;border-radius:16px;padding:14px;\
 background:linear-gradient(165deg,#0d4433,#062219 60%,#04170f);border:1px solid rgba(246,196,83,.22)}\
.vc-wcol{flex:0 0 300px;display:flex;flex-direction:column;align-items:center;margin-right:16px;min-width:0}\
.vc-wheel{flex:0 0 auto;width:280px;height:280px;border-radius:50%;padding:9px;\
 background:radial-gradient(circle at 34% 24%,#5a3a12,#2a1a08 62%,#160d04);box-shadow:inset 0 0 0 5px rgba(246,196,83,.35)}\
.vc-wheel canvas{width:100%;height:100%;display:block;border-radius:50%}\
.vc-res{display:flex;align-items:center;width:100%;margin-top:14px}\
.vc-res .n{flex:0 0 auto;width:52px;height:52px;border-radius:10px;display:flex;align-items:center;justify-content:center;\
 font-size:26px;font-weight:800;color:#fff;background:#2a2233;margin-right:12px}\
.vc-res .n.red{background:linear-gradient(150deg,#ff5a68,#c1122b)}\
.vc-res .n.black{background:linear-gradient(150deg,#3b3550,#141020)}\
.vc-res .n.green{background:linear-gradient(150deg,#25e6a5,#0a8f63)}\
.vc-res .t{flex:1 1 auto;min-width:0;font-size:14px;line-height:1.45;color:#a394c0}\
.vc-res .t b{color:#ffe9a8;font-size:18px}\
.vc-hist{display:flex;width:100%;margin-top:12px;overflow:hidden}\
.vc-hist i{font-style:normal;flex:0 0 auto;width:30px;height:30px;margin-right:5px;border-radius:7px;display:flex;\
 align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#fff;background:#2a2233}\
.vc-hist i.red{background:#c1122b}.vc-hist i.black{background:#241d33}.vc-hist i.green{background:#0a8f63}\
.vc-bwrap{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:center}\
.vc-brd{display:flex;flex-direction:column;width:100%}\
.vc-btop{display:flex;align-items:stretch}\
.vc-bzero{flex:0 0 5.5%;min-width:0;margin-right:6px;border-radius:8px;display:flex;align-items:center;justify-content:center;\
 font-size:28px;font-weight:800;color:#fff;background:linear-gradient(160deg,#25e6a5,#087a54);position:relative;overflow:hidden}\
.vc-nums{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;margin-right:6px}\
.vc-cols{flex:0 0 6.5%;min-width:0;display:flex;flex-direction:column}\
.vc-nrow{display:flex;height:70px;margin-bottom:6px}\
.vc-nrow:last-child{margin-bottom:0}\
.vc-bcell{flex:1 1 0;min-width:0;margin-right:6px;border-radius:8px;position:relative;overflow:hidden;\
 display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:#fff;background:#241d33}\
.vc-bcell:last-child{margin-right:0}\
.vc-bcell.red{background:linear-gradient(160deg,#ff5a68,#b3122a)}\
.vc-bcell.black{background:linear-gradient(160deg,#39334d,#120e1c)}\
.vc-cols .vc-bcell{flex:1 1 0;margin:0 0 6px;font-size:16px;font-weight:800;color:#ffe9a8;background:rgba(255,255,255,.1)}\
.vc-cols .vc-bcell:last-child{margin-bottom:0}\
.vc-bbot{display:flex;margin-top:6px}\
.vc-bsp{flex:0 0 5.5%;margin-right:6px}\
.vc-bsp2{flex:0 0 6.5%}\
.vc-outs{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;margin-right:6px}\
.vc-orow{display:flex;height:56px;margin-bottom:6px}\
.vc-orow:last-child{margin-bottom:0}\
.vc-orow .vc-bcell{font-size:16px;font-weight:800;letter-spacing:.05em;color:#ffe9a8;background:rgba(255,255,255,.1)}\
.vc-orow .vc-bcell.red{background:linear-gradient(160deg,#ff5a68,#b3122a);color:#fff}\
.vc-orow .vc-bcell.black{background:linear-gradient(160deg,#39334d,#120e1c);color:#fff}\
.vc-bcell.won,.vc-bzero.won{box-shadow:inset 0 0 0 3px #f6c453,0 0 16px rgba(246,196,83,.8)}\
.vc-ch{position:absolute;left:50%;top:50%;width:32px;height:32px;margin:-16px 0 0 -16px;border-radius:50%;\
 display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#2a1a05;background:#ffe9a8;\
 box-shadow:inset 0 0 0 3px rgba(255,255,255,.6),0 2px 6px rgba(0,0,0,.6)}\
.vc-fl{position:absolute;left:0;right:0;top:2px;text-align:center;font-size:13px;font-weight:800;color:#8dff4a}\
.vc-binfo{display:flex;align-items:center;margin-top:14px;font-size:15px;color:#a394c0}\
.vc-binfo b{color:#ffe9a8;font-size:20px;margin:0 22px 0 8px}\
.vc-brd.lock{opacity:.6}\
.vc .selector{transition:transform .12s,background .12s,box-shadow .12s;cursor:pointer}\
.vc .selector.focus{background:#ffe9a8!important;color:#1a1024!important;transform:scale(1.07);\
 box-shadow:0 0 0 3px #f6c453,0 0 22px rgba(246,196,83,.75);z-index:5}\
.vc .vc-bcell.selector.focus,.vc .vc-bzero.selector.focus{transform:scale(1.1);filter:brightness(1.25)}\
.vc .vc-spin.selector.focus{background:#ffe9a8!important;color:#8c1257!important}\
.vc-fx{position:absolute;left:0;top:0;pointer-events:none;z-index:20}\
.vc.mid .vc-side{display:none}\
.vc.mid .vc-main{margin-right:0}\
.vc.narrow .vc-side{display:none}\
.vc.narrow .vc-main{margin-right:0}\
.vc.narrow .vc-top{flex-wrap:wrap;min-height:0}\
.vc.narrow .vc-logo{font-size:22px;margin-right:12px}\
.vc.narrow .vc-stat{margin-right:12px}\
.vc.narrow .vc-stat b{font-size:21px}\
.vc.narrow .vc-mini{font-size:14px;padding:9px 12px;margin:6px 0 0 6px}\
.vc.narrow .vc-tab{font-size:16px;padding:9px 14px}\
.vc.narrow .vc-rt{flex-direction:column}\
.vc.narrow .vc-wcol{flex:0 0 auto;flex-direction:row;align-items:center;width:100%;margin:0 0 14px}\
.vc.narrow .vc-wheel{width:190px;height:190px;flex:0 0 190px;margin-right:16px}\
.vc.narrow .vc-wmeta{flex:1 1 auto;min-width:0}\
.vc.narrow .vc-res{margin-top:0}\
.vc.narrow .vc-bwrap{justify-content:flex-start}\
.vc.narrow .vc-nrow{height:58px}\
.vc.narrow .vc-orow{height:48px}\
.vc.narrow .vc-bcell{font-size:20px}\
.vc.narrow .vc-row{flex-wrap:wrap}\
.vc.narrow .vc-btn{font-size:16px;padding:12px 14px;margin:0 8px 8px 0}\
.vc.narrow .vc-spin{font-size:20px;padding:14px 26px;margin:0 0 8px auto}\
.vc.narrow .vc-step{margin-bottom:8px}\
.vc.narrow .vc-chip{width:46px;height:46px;font-size:15px;margin-bottom:8px}\
.vc.narrow .vc-ban b{font-size:38px}\
.vc.narrow .vc-win .a b{font-size:28px}\
</style>');

    Lampa.Template.add('vc_main', '<div class="vc-fit"><div class="vc">\
<div class="vc-top">\
  <div class="vc-logo">VELICRON <i>CASINO</i></div>\
  <div class="vc-tabs"><div class="vc-tab selector act" data-a="g:slots">СЛОТЫ</div><div class="vc-tab selector" data-a="g:roulette">РУЛЕТКА</div></div>\
  <div class="vc-sp"></div>\
  <div class="vc-stat"><span>БАНК</span><b class="vc-bank">0</b></div>\
  <div class="vc-stat"><span>УРОВЕНЬ</span><b class="vc-lvl">1</b></div>\
  <div class="vc-mini selector" data-a="bonus">БОНУС</div>\
  <div class="vc-mini selector" data-a="sound">ЗВУК</div>\
  <div class="vc-mini selector" data-a="reset">СБРОС</div>\
</div>\
<div class="vc-body">\
  <div class="vc-main">\
    <div class="vc-stage">\
      <div class="vc-game vc-gs act">\
        <div class="vc-cab">\
          <div class="vc-marq"><b>VELICRON SLOTS</b><div class="vc-jack"><span>ДЖЕКПОТ</span><i class="vc-jv">25 000</i></div></div>\
          <div class="vc-reels"><div class="vc-glass"></div><svg class="vc-lines"></svg></div>\
          <div class="vc-fs"><span class="vc-fst">ФРИСПИНЫ</span><i class="vc-fsi"></i></div>\
          <div class="vc-win"><div class="m">OK — крутить, ←/→ — ставка</div><div class="a zero"><span>ВЫИГРЫШ</span><b class="vc-wv">0</b></div></div>\
          <div class="vc-ban"><b></b><i></i></div>\
        </div>\
      </div>\
      <div class="vc-game vc-gr">\
        <div class="vc-rt">\
          <div class="vc-wcol">\
            <div class="vc-wheel"><canvas></canvas></div>\
            <div class="vc-wmeta">\
              <div class="vc-res"><div class="n">—</div><div class="t">Ставьте фишки на поле<br>и запускайте колесо</div></div>\
              <div class="vc-hist"></div>\
            </div>\
          </div>\
          <div class="vc-bwrap"><div class="vc-brd"></div>\
            <div class="vc-binfo">На столе:<b class="vc-tb">0</b>Макс. выплата:<b class="vc-mw">0</b></div>\
          </div>\
        </div>\
      </div>\
    </div>\
    <div class="vc-ctrl vc-cs">\
      <div class="vc-row">\
        <span class="vc-lab">СТАВКА</span>\
        <div class="vc-step"><div class="s selector" data-a="bet-">−</div><b class="vc-bv">25</b><div class="s selector" data-a="bet+">+</div></div>\
        <div class="vc-btn selector" data-a="max">МАКС</div>\
        <div class="vc-btn selector" data-a="auto">АВТО ×10</div>\
        <div class="vc-btn selector" data-a="turbo">ТУРБО</div>\
        <div class="vc-btn selector" data-a="fx">ЭФФЕКТЫ</div>\
        <div class="vc-spin selector" data-a="spin">КРУТИТЬ</div>\
      </div>\
    </div>\
    <div class="vc-ctrl vc-cr" style="display:none">\
      <div class="vc-row vc-chips"><span class="vc-lab">ФИШКА</span></div>\
      <div class="vc-row">\
        <div class="vc-btn selector" data-a="undo">ОТМЕНА</div>\
        <div class="vc-btn selector" data-a="clear">СНЯТЬ</div>\
        <div class="vc-btn selector" data-a="repeat">ПОВТОР</div>\
        <div class="vc-btn selector" data-a="double">×2</div>\
        <div class="vc-spin selector" data-a="rspin">ВРАЩАТЬ</div>\
      </div>\
    </div>\
  </div>\
  <div class="vc-side"></div>\
</div>\
<canvas class="vc-fx"></canvas>\
</div></div>');

    /* ================================================================ COMPONENT */
    function Casino() {
        var wrap = Lampa.Template.get('vc_main', {});
        var html = wrap.find('.vc');
        var nav = [], nr = 0, nc = 0, focusEl = null;
        var sched = [], running = false, raf = null, lastT = 0;
        var bankShown = S.bank, jackShown = S.jackpot, resetArm = 0;
        var SCALE = 1, DW = 1600, DH = 860, MODE = 'wide';

        /* ---------- авто-масштаб под экран ---------- */
        function fit() {
            var host = wrap[0].parentNode, rect = wrap[0].getBoundingClientRect();
            var hw = host && host.clientWidth ? host.clientWidth : window.innerWidth;
            var availW = Math.max(300, Math.min(hw, window.innerWidth - rect.left - 10));
            var availH = Math.max(300, window.innerHeight - rect.top - 10);
            var ar = availW / availH;
            var mode = (availW < 820 || ar < .95) ? 'narrow' : ((availW < 1320 || ar < 1.45) ? 'mid' : 'wide');
            DW = mode === 'narrow' ? 720 : (mode === 'mid' ? 1240 : 1600);
            DH = mode === 'narrow' ? 1240 : 860;
            var s = Math.min(availW / DW, availH / DH);
            s = clamp(s, .18, 2.2);
            var changed = (mode !== MODE || Math.abs(s - SCALE) > .002);
            MODE = mode; SCALE = s;
            html.removeClass('wide mid narrow').addClass(mode);
            html[0].style.width = DW + 'px';
            html[0].style.height = DH + 'px';
            html[0].style.webkitTransform = html[0].style.transform = 'scale(' + s.toFixed(4) + ')';
            wrap[0].style.width = Math.round(DW * s) + 'px';
            wrap[0].style.height = Math.round(DH * s) + 'px';
            wrap[0].style.marginLeft = Math.max(0, Math.round((availW - DW * s) / 2)) + 'px';
            if (changed) { fxResize(); slotsMeasure(); wheelResize(); buildNav(focusEl); }
        }

        /* ---------- scheduler / loop ---------- */
        function at(d, fn) { sched.push({ t: now() + d, fn: fn }); }
        function tickSched(t) {
            if (!sched.length) return;
            var due = [], keep = [], i;
            for (i = 0; i < sched.length; i++) (t >= sched[i].t ? due : keep).push(sched[i]);
            sched = keep; due.sort(function (a, b) { return a.t - b.t; });
            for (i = 0; i < due.length; i++) { try { due[i].fn(); } catch (e) {} }
        }
        function startLoop() { if (running) return; running = true; lastT = now(); raf = RAF(loop); }
        function stopLoop() { running = false; if (raf) CAF(raf); raf = null; }
        function loop(t) {
            if (!running) return;
            var dt = Math.min(.05, (t - lastT) / 1000); lastT = t;
            tickSched(t);
            if (S.game === 'slots') slotsUpdate(t, dt); else wheelUpdate(t, dt);
            fxUpdate(dt);
            if (Math.abs(bankShown - S.bank) > .5) { bankShown += (S.bank - bankShown) * Math.min(1, dt * 9); bankEl.text(fmt(bankShown)); }
            else if (bankShown !== S.bank) { bankShown = S.bank; bankEl.text(fmt(S.bank)); }
            if (Math.abs(jackShown - S.jackpot) > .5) { jackShown += (S.jackpot - jackShown) * Math.min(1, dt * 6); jackEl.text(fmt(jackShown)); }
            raf = RAF(loop);
        }

        /* ---------- refs ---------- */
        var bankEl = html.find('.vc-bank'), lvlEl = html.find('.vc-lvl'), jackEl = html.find('.vc-jv');
        var sideEl = html.find('.vc-side'), msgEl = html.find('.vc-win .m'), winEl = html.find('.vc-wv');
        var winBox = html.find('.vc-win .a'), banEl = html.find('.vc-ban');
        var reelsEl = html.find('.vc-reels'), linesEl = html.find('.vc-lines');
        var fsEl = html.find('.vc-fs'), betEl = html.find('.vc-bv');
        var brdEl = html.find('.vc-brd'), chipsEl = html.find('.vc-chips');
        var resN = html.find('.vc-res .n'), resT = html.find('.vc-res .t'), histEl = html.find('.vc-hist');
        var tbEl = html.find('.vc-tb'), mwEl = html.find('.vc-mw');
        var wheelCv = html.find('.vc-wheel canvas')[0], fxCv = html.find('.vc-fx')[0];

        /* ---------- particles ---------- */
        var FX = { ctx: null, p: [], w: 0, h: 0, shake: 0, st: 0 };
        function fxOn() { return opt('vc_fx', true); }
        function fxResize() {
            var ratio = Math.min(2, (window.devicePixelRatio || 1) * SCALE);
            FX.w = DW; FX.h = DH;
            fxCv.width = Math.max(1, Math.floor(DW * ratio));
            fxCv.height = Math.max(1, Math.floor(DH * ratio));
            fxCv.style.width = DW + 'px'; fxCv.style.height = DH + 'px';
            FX.ctx = fxCv.getContext('2d');
            FX.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        }
        function localPos(el) {
            var r = el.getBoundingClientRect(), h = html[0].getBoundingClientRect();
            return { x: (r.left - h.left) / SCALE + r.width / SCALE / 2, y: (r.top - h.top) / SCALE + r.height / SCALE / 2 };
        }
        function fxAdd(o) { if (!fxOn() || FX.p.length > 130) return; FX.p.push(o); }
        function fxBurst(el, color, n) {
            if (!el || !el[0]) return;
            var p = localPos(el[0]), i, a, s;
            for (i = 0; i < n; i++) { a = rnd(0, 6.283); s = rnd(60, 330);
                fxAdd({ t: 's', x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 240, l: 0, m: rnd(.4, .9), r: rnd(1.5, 3.4), c: color }); }
        }
        function fxCoins(el, n) {
            if (!el || !el[0]) return;
            var p = localPos(el[0]), i;
            for (i = 0; i < n; i++)
                fxAdd({ t: 'c', x: p.x, y: p.y, vx: rnd(-230, 230), vy: rnd(-520, -170), g: 980, l: 0, m: rnd(1, 1.8),
                        r: rnd(5, 11), rot: rnd(0, 6.3), vr: rnd(-8, 8), c: Math.random() < .5 ? '#f6c453' : '#ffe9a8' });
        }
        function fxKick(a) { if (fxOn()) { FX.shake = Math.max(FX.shake, a); FX.st = 0; } }
        function fxUpdate(dt) {
            var c = FX.ctx; if (!c) return;
            c.clearRect(0, 0, FX.w, FX.h);
            var i, p, k, w;
            for (i = FX.p.length - 1; i >= 0; i--) {
                p = FX.p[i]; p.l += dt;
                if (p.l >= p.m) { FX.p.splice(i, 1); continue; }
                k = 1 - p.l / p.m;
                p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= (1 - 1.1 * dt);
                if (p.t === 'c') {
                    p.rot += p.vr * dt; c.globalAlpha = clamp(k * 1.6, 0, 1);
                    c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
                    w = Math.abs(Math.cos(p.rot * 1.6)) * p.r + p.r * .3;
                    c.fillStyle = p.c; c.beginPath();
                    if (c.ellipse) c.ellipse(0, 0, w, p.r, 0, 0, 6.283); else c.arc(0, 0, p.r, 0, 6.283);
                    c.fill(); c.restore();
                } else {
                    c.globalAlpha = k; c.fillStyle = p.c;
                    c.beginPath(); c.arc(p.x, p.y, p.r * k + .4, 0, 6.283); c.fill();
                }
            }
            c.globalAlpha = 1;
            var main = html.find('.vc-main')[0];
            if (FX.shake > .2) {
                FX.st += dt; var d = FX.shake * Math.exp(-FX.st * 9);
                main.style.webkitTransform = main.style.transform = 'translate(' + rnd(-d, d).toFixed(2) + 'px,' + rnd(-d, d).toFixed(2) + 'px)';
                if (d < .25) { FX.shake = 0; main.style.webkitTransform = main.style.transform = ''; }
            } else if (main.style.transform) { main.style.webkitTransform = main.style.transform = ''; }
        }

        /* ---------- навигация пультом ---------- */
        function center(el) { var r = el.getBoundingClientRect(); return r.left + r.width / 2; }
        function locate(el) {
            for (var r = 0; r < nav.length; r++) for (var c = 0; c < nav[r].length; c++) if (nav[r][c] === el) return [r, c];
            return null;
        }
        function buildNav(keep) {
            var rows = [], i;
            rows.push(html.find('.vc-top .selector').toArray());
            if (S.game === 'slots') rows.push(html.find('.vc-cs .selector').toArray());
            else {
                for (i = 0; i < boardRows.length; i++) rows.push(boardRows[i].slice());
                rows.push(html.find('.vc-chips .selector').toArray());
                rows.push(html.find('.vc-cr .vc-row').eq(1).find('.selector').toArray());
            }
            nav = [];
            for (i = 0; i < rows.length; i++) if (rows[i].length) nav.push(rows[i]);
            if (!nav.length) return;
            var p = keep ? locate(keep) : null;
            if (p) { nr = p[0]; nc = p[1]; }
            else { nr = clamp(nr, 0, nav.length - 1); nc = clamp(nc, 0, nav[nr].length - 1); }
            applyFocus();
        }
        function applyFocus() {
            html.find('.selector').removeClass('focus');
            if (!nav.length || !nav[nr] || !nav[nr][nc]) return;
            focusEl = nav[nr][nc];
            $(focusEl).addClass('focus').trigger('hover:focus');
        }
        function navMove(dir) {
            if (!nav.length) return;
            if (dir === 'left' || dir === 'right') nc = mod(nc + (dir === 'left' ? -1 : 1), nav[nr].length);
            else {
                var r2 = nr + (dir === 'up' ? -1 : 1);
                if (r2 < 0 || r2 >= nav.length) return;
                var cx = center(nav[nr][nc]), best = 0, bd = 1e9, i, dd;
                for (i = 0; i < nav[r2].length; i++) { dd = Math.abs(center(nav[r2][i]) - cx); if (dd < bd) { bd = dd; best = i; } }
                nr = r2; nc = best;
            }
            Snd.move(); applyFocus();
        }
        function fire(el) {
            if (!el) return;
            var t = now();
            if (el._fire && t - el._fire < 160) return;
            el._fire = t;
            if (nav[nr] && nav[nr][nc] !== el) { var p = locate(el); if (p) { nr = p[0]; nc = p[1]; } }
            applyFocus();
            act($(el).data('a'), el);
        }

        /* ---------- общий UI ---------- */
        function dayKey() { var t = new Date(); return t.getFullYear() + '-' + (t.getMonth() + 1) + '-' + t.getDate(); }
        function renderTop() {
            lvlEl.text(S.level);
            var bonus = html.find('[data-a="bonus"]');
            if (S.day !== dayKey()) bonus.text('БОНУС +' + fmt(300 + S.level * 100)).addClass('on');
            else if (S.bank < CHIPS[0] && Date.now() - (S.rescue || 0) >= 1800000) bonus.text('КУПОН +150').addClass('on');
            else bonus.text('БОНУС ЗАВТРА').removeClass('on');
            html.find('[data-a="sound"]').text(opt('vc_sound', true) ? 'ЗВУК ВКЛ' : 'ЗВУК ВЫКЛ').toggleClass('on', opt('vc_sound', true));
            html.find('[data-a="turbo"]').toggleClass('on', opt('vc_turbo', false));
            html.find('[data-a="fx"]').toggleClass('on', fxOn());
        }
        function addXP(v) {
            S.xp += v;
            var need = xpNeed(S.level);
            while (S.xp >= need) {
                S.xp -= need; S.level++;
                var b = 150 * S.level; S.bank += b;
                Lampa.Noty.show('Уровень ' + S.level + ' · +' + fmt(b) + ' фишек');
                Snd.level(); fxBurst(bankEl, '#22e0ff', 24);
                need = xpNeed(S.level);
            }
            renderTop();
        }
        function pushHist(g, label, bet, win) {
            S.hist.unshift({ g: g, l: label, b: bet, w: win });
            if (S.hist.length > 14) S.hist.pop();
            renderSide();
        }
        function renderSide() {
            var h = '', i, s;
            if (S.game === 'slots') {
                h += '<h4>ВЫПЛАТЫ ×3 / ×4 / ×5</h4>';
                for (i = 0; i < SYM.length; i++) {
                    s = SYM[i]; if (i === SCAT) continue;
                    h += '<div class="vc-prow"><i style="color:' + s.c + '">' + s.g + s.g + s.g + '</i><b>' + s.p[2] + ' / ' + s.p[3] + ' / ' + s.p[4] + '</b></div>';
                }
                h += '<div class="vc-note"><b>W</b> заменяет любой символ кроме <b>B</b>. <b>B</b>×3/4/5 → 8/12/20 фриспинов, выигрыши ×2. ' +
                     'Пять <b>W</b> на линии забирают джекпот. Возврат ≈ 92%.</div>';
            } else {
                h += '<h4>РУЛЕТКА · ВЫПЛАТЫ</h4>' +
                     '<div class="vc-prow"><span>Число 0–36</span><b>35 : 1</b></div>' +
                     '<div class="vc-prow"><span>Дюжина / колонка</span><b>2 : 1</b></div>' +
                     '<div class="vc-prow"><span>Красное / чёрное</span><b>1 : 1</b></div>' +
                     '<div class="vc-prow"><span>Чёт / нечёт</span><b>1 : 1</b></div>' +
                     '<div class="vc-prow"><span>1–18 / 19–36</span><b>1 : 1</b></div>' +
                     '<div class="vc-note">Европейское колесо: 37 карманов, одно зеро. При <b>0</b> внешние ставки проигрывают. Возврат <b>97.3%</b>.</div>';
            }
            var net = S.bank - S.start;
            h += '<h4 class="mt">СЕССИЯ</h4>' +
                 '<div class="vc-prow"><span>Итог</span><b style="color:' + (net >= 0 ? '#8dff4a' : '#ff3b4e') + '">' + (net > 0 ? '+' : '') + fmt(net) + '</b></div>' +
                 '<div class="vc-prow"><span>Поставлено</span><b>' + fmt(S.wagered) + '</b></div>' +
                 '<div class="vc-prow"><span>Возврат</span><b>' + (S.wagered ? Math.round(S.returned / S.wagered * 100) + '%' : '—') + '</b></div>' +
                 '<div class="vc-prow"><span>Лучший выигрыш</span><b>' + fmt(S.best) + '</b></div>' +
                 '<div class="vc-prow"><span>Спинов / вращений</span><b>' + S.spins + ' / ' + S.rspin + '</b></div>';
            if (S.hist.length) {
                h += '<h4 class="mt">ПОСЛЕДНИЕ</h4>';
                for (i = 0; i < Math.min(4, S.hist.length); i++) {
                    var e = S.hist[i], d = e.w - e.b;
                    h += '<div class="vc-prow"><span>' + e.l + '</span><b style="color:' + (d > 0 ? '#8dff4a' : (d < 0 ? '#ff3b4e' : '#a394c0')) + '">' +
                         (d > 0 ? '+' : '') + fmt(d) + '</b></div>';
                }
            }
            sideEl.html(h);
        }

        /* ============================ SLOTS ============================ */
        var reels = [], L = 0, cellH = 100, centers = [], lineEls = [];
        var sBusy = false, sStopped = 0, sTargets = [], sGrid = [], sPending = null;
        var auto = 0, autoInf = false, freeOn = false, freeLeft = 0, freeTotal = 0;

        function slotsBuild() {
            var i, k;
            for (i = 0; i < 5; i++) {
                var el = $('<div class="vc-reel"><div class="vc-strip"></div></div>');
                reelsEl.append(el);
                var data = strip(9781 + i * 7919); L = data.length;
                var cells = [];
                for (k = 0; k < 6; k++) {
                    var c = $('<div class="vc-cell"></div>');
                    el.find('.vc-strip').append(c);
                    cells.push({ el: c[0], idx: -1 });
                }
                var p = ri(0, L - 1);
                reels.push({ el: el[0], strip: el.find('.vc-strip')[0], cells: cells, data: data,
                             pos: p, target: p, state: 'idle', start: 0, D: 0, T: 0, t0: 0, b0: 0, last: p, ant: false });
            }
            for (i = 0; i < LINES.length; i++) {
                var pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                pl.setAttribute('stroke', LC[i]);
                linesEl[0].appendChild(pl); lineEls.push(pl);
            }
        }
        function slotsMeasure() {
            if (!reels.length || !reels[0].el.clientHeight) return;
            cellH = reels[0].el.clientHeight / 3;
            var i, k;
            for (i = 0; i < reels.length; i++) for (k = 0; k < 6; k++) reels[i].cells[k].el.style.height = cellH + 'px';
            linesEl[0].setAttribute('viewBox', '0 0 ' + reelsEl[0].clientWidth + ' ' + reelsEl[0].clientHeight);
            centers = [];
            for (i = 0; i < reels.length; i++) centers.push(reels[i].el.offsetLeft + reels[i].el.offsetWidth / 2 - 8);
            for (i = 0; i < reels.length; i++) { reels[i].cells.forEach(function (c) { c.idx = -1; }); drawReel(reels[i]); }
        }
        function drawReel(r) {
            var base = Math.floor(r.pos), frac = r.pos - base, k, c, idx, s;
            for (k = -1; k < 5; k++) {
                c = r.cells[k + 1]; idx = mod(base + k, L);
                if (c.idx !== idx) {
                    c.idx = idx; s = SYM[r.data[idx]];
                    c.el.textContent = s.g; c.el.style.color = s.c;
                    c.el.style.fontSize = (cellH * .56).toFixed(1) + 'px';
                    c.el.style.textShadow = '0 0 ' + (cellH * .18).toFixed(1) + 'px ' + s.c;
                }
                var y = ((k - frac) * cellH).toFixed(2) + 'px';
                c.el.style.webkitTransform = c.el.style.transform = 'translate3d(0,' + y + ',0)';
            }
        }
        function bet() { return LINE_BETS[S.betIdx] * 5; }
        function slotsSync() {
            while (S.betIdx > 0 && LINE_BETS[S.betIdx] * 5 > S.bank && !freeOn) S.betIdx--;
            betEl.text(fmt(bet()));
            html.find('[data-a="spin"]').text(auto > 0 || autoInf ? 'СТОП' : (freeOn ? 'ФРИСПИН' : 'КРУТИТЬ'))
                .toggleClass('stop', auto > 0 || autoInf);
            html.find('[data-a="auto"]').text(autoInf ? 'АВТО ∞' : (auto > 0 ? 'АВТО ' + auto : 'АВТО ×10')).toggleClass('on', auto > 0 || autoInf);
            fsEl.toggleClass('on', freeOn);
            if (freeOn) { html.find('.vc-fst').text('ФРИСПИНЫ · ОСТАЛОСЬ ' + freeLeft); html.find('.vc-fsi').text('множитель ×2 · всего ' + freeTotal); }
        }
        function clearHits() {
            var i, k;
            for (i = 0; i < reels.length; i++) {
                reels[i].el.className = 'vc-reel';
                for (k = 0; k < 6; k++) reels[i].cells[k].el.className = 'vc-cell';
            }
            for (i = 0; i < lineEls.length; i++) { lineEls[i].setAttribute('class', ''); lineEls[i].setAttribute('points', ''); }
        }
        function profile(u) {
            var a = .10, b = .30, raw;
            if (u < a) raw = u * u / (2 * a);
            else if (u < 1 - b) raw = a / 2 + (u - a);
            else raw = a / 2 + (1 - b - a) + (b * b - (1 - u) * (1 - u)) / (2 * b);
            return raw / (1 - (a + b) / 2);
        }
        function spin() {
            Snd.resume();
            if (sBusy) return;
            var b = bet(), i;
            if (!freeOn) {
                if (S.bank < b) { Lampa.Noty.show('Не хватает фишек — забери бонус'); stopAuto(); slotsSync(); return; }
                S.bank -= b; S.wagered += b; S.spins++; S.jackpot += b * .01; addXP(b);
            } else freeLeft--;
            sBusy = true; sStopped = 0; clearHits();
            winEl.text('0'); winBox.addClass('zero'); banEl.removeClass('on');
            msgEl.html(freeOn ? 'Фриспин · множитель <b>×2</b>' : 'Барабаны вращаются…');
            slotsSync(); renderTop();
            Snd.tone(220, .07, 'square', .05); Snd.rollStart();

            var turbo = opt('vc_turbo', false);
            sTargets = []; sGrid = [];
            for (i = 0; i < 5; i++) {
                var t = ri(0, L - 1); sTargets.push(t);
                sGrid.push([reels[i].data[mod(t, L)], reels[i].data[mod(t + 1, L)], reels[i].data[mod(t + 2, L)]]);
            }
            var sc01 = 0;
            for (i = 0; i < 3; i++) { if (sGrid[0][i] === SCAT) sc01++; if (sGrid[1][i] === SCAT) sc01++; }
            var ant = sc01 >= 2, speed = turbo ? 32 : 24, base = turbo ? 520 : 1150, gap = turbo ? 110 : 250;
            for (i = 0; i < 5; i++) {
                var r = reels[i], T = base + i * gap;
                r.ant = ant && i >= 2;
                if (r.ant) T += (i - 1) * (turbo ? 260 : 620);
                var m = mod(sTargets[i] - r.pos, L), dist = speed * (T / 1000) * .8;
                var loops = Math.max(0, Math.round((dist - m) / L)), D = m + loops * L;
                if (D < 8) D += L;
                r.start = r.pos; r.D = D; r.T = T; r.t0 = now(); r.target = r.start + D; r.state = 'spin'; r.last = r.pos;
            }
            if (ant) at(base + gap * 1.6, function () {
                Snd.antic();
                for (var j = 0; j < reels.length; j++) if (reels[j].ant && reels[j].state === 'spin') reels[j].el.className = 'vc-reel ant';
            });
            sPending = { bet: b, mult: freeOn ? 2 : 1 };
        }
        function reelStop(r, i) {
            r.state = 'bounce'; r.b0 = now();
            Snd.stopReel(i); fxKick(2.2);
            if (r.ant) { r.el.className = 'vc-reel'; if (sGrid[i].indexOf(SCAT) >= 0) Snd.tone(1320, .22, 'triangle', .055); }
            if (++sStopped === 5) { Snd.rollStop(); at(150, function () { settleSlots(false); }); }
        }
        function evaluate() {
            var p = sPending, lineBet = p.bet / 5, wins = [], total = 0, jack = false, li, r, n, i;
            for (li = 0; li < LINES.length; li++) {
                var sy = [], best = null;
                for (r = 0; r < 5; r++) sy.push(sGrid[r][LINES[li][r]]);
                var cands = sy[0] === WILD ? [0, 1, 2, 3, 4, 5, 6, 7] : [sy[0]];
                for (i = 0; i < cands.length; i++) {
                    var tg = cands[i]; if (tg === SCAT) continue;
                    n = 0;
                    for (r = 0; r < 5; r++) { if (sy[r] === tg || sy[r] === WILD) n++; else break; }
                    if (n >= 3) { var pay = SYM[tg].p[n - 1] * lineBet; if (!best || pay > best.pay) best = { pay: pay, n: n, tg: tg }; }
                }
                if (best && best.pay > 0) {
                    wins.push({ li: li, n: best.n, pay: best.pay * p.mult, rows: LINES[li].slice(0, best.n) });
                    total += best.pay * p.mult;
                    if (best.n === 5 && best.tg === WILD) jack = true;
                }
            }
            var sc = 0;
            for (r = 0; r < 5; r++) for (i = 0; i < 3; i++) if (sGrid[r][i] === SCAT) sc++;
            var freeAdd = 0;
            if (sc >= 3) { total += (sc === 3 ? 2 : sc === 4 ? 10 : 50) * p.bet * p.mult; freeAdd = sc === 3 ? 8 : sc === 4 ? 12 : 20; }
            if (jack) total += S.jackpot;
            return { wins: wins, total: Math.round(total), sc: sc, freeAdd: freeAdd, jack: jack, bet: p.bet, mult: p.mult };
        }
        function settleSlots(quiet) {
            if (!sPending) return;
            var res = evaluate(), p = sPending; sPending = null;
            if (res.total > 0) {
                S.bank += res.total; S.returned += res.total;
                if (res.total > S.best) S.best = res.total;
                if (res.jack) S.jackpot = 25000;
                if (quiet) {
                    sBusy = false;
                    if (res.freeAdd) { freeOn = true; freeLeft += res.freeAdd; freeTotal += res.freeAdd; }
                    winEl.text(fmt(res.total)); winBox.removeClass('zero');
                    msgEl.html('Выплата <b>' + fmt(res.total) + '</b>');
                    pushHist('s', 'Выигрыш', p.bet, res.total);
                    slotsSync(); renderTop(); renderSide(); save();
                    return;
                }
                present(res, p);
            } else {
                msgEl.html(freeOn ? 'Фриспин без выигрыша' : 'Мимо. Барабаны ждут ещё раз');
                if (!quiet) Snd.lose();
                endRound(p.bet, 0, 'Без выигрыша');
            }
            renderTop(); save();
        }
        function present(res, p) {
            var ratio = res.total / p.bet, i, r, row, val = res.total, t0 = now();
            winBox.removeClass('zero');
            (function cnt() { var u = clamp((now() - t0) / 700, 0, 1); winEl.text(fmt(val * eOutCubic(u))); if (u < 1) at(40, cnt); })();
            for (i = 0; i < res.wins.length; i++) {
                var w = res.wins[i];
                for (r = 0; r < w.n; r++) { row = w.rows[r]; reels[r].cells[row + 1].el.className = 'vc-cell hit'; }
            }
            if (res.sc >= 3) for (r = 0; r < 5; r++) for (i = 1; i <= 3; i++)
                if (reels[r].data[reels[r].cells[i].idx] === SCAT) reels[r].cells[i].el.className = 'vc-cell hit';
            res.wins.slice(0, 5).forEach(function (w, i) {
                at(i * 220, function () {
                    var pts = [], j;
                    for (j = 0; j < w.n; j++) pts.push(centers[j].toFixed(1) + ',' + ((w.rows[j] + .5) * cellH).toFixed(1));
                    lineEls[w.li].setAttribute('points', pts.join(' '));
                    lineEls[w.li].setAttribute('class', 'on');
                    Snd.coin(i);
                });
            });
            msgEl.html('<b>' + (res.wins.length ? res.wins.length + ' лин.' : 'Скаттер') + '</b> · выплата ' + fmt(res.total) + (p.mult > 1 ? ' (×2)' : ''));
            if (res.jack) {
                banner('ДЖЕКПОТ!', '+' + fmt(res.total)); Snd.fanfare(); fxCoins(html.find('.vc-cab'), 60); fxKick(13);
                Lampa.Noty.show('ДЖЕКПОТ · пять WILD · +' + fmt(res.total));
            } else if (ratio >= 10) {
                banner(ratio >= 60 ? 'ЭПИЧЕСКИЙ ВЫИГРЫШ' : ratio >= 25 ? 'МЕГА ВЫИГРЫШ' : 'БОЛЬШОЙ ВЫИГРЫШ', '×' + Math.round(ratio) + ' · +' + fmt(res.total));
                Snd.fanfare(); fxCoins(html.find('.vc-cab'), ratio >= 25 ? 46 : 24); fxKick(ratio >= 25 ? 10 : 6);
            } else { Snd.win(ratio); fxCoins(winEl, clamp(Math.round(ratio * 2), 4, 18)); }
            if (res.freeAdd) at(700, function () {
                freeOn = true; freeLeft += res.freeAdd; freeTotal += res.freeAdd;
                Lampa.Noty.show('Фриспины ×' + res.freeAdd + ' · выигрыши удваиваются');
                Snd.fanfare(); fxBurst(html.find('.vc-cab'), '#22e0ff', 30); slotsSync();
            });
            at(clamp(900 + Math.min(res.wins.length, 5) * 220 + (ratio >= 10 ? 1400 : 0) + (res.freeAdd ? 900 : 0), 900, 3600), function () {
                endRound(p.bet, res.total, (res.jack ? 'ДЖЕКПОТ · ' : '') + (res.freeAdd ? '+' + res.freeAdd + ' фриспинов' : res.wins.length + ' лин.'));
            });
        }
        function banner(t, s) {
            banEl.find('b').text(t); banEl.find('i').text(s); banEl.addClass('on');
            at(2400, function () { banEl.removeClass('on'); });
        }
        function endRound(b, w, label) {
            pushHist('s', label, b, w);
            sBusy = false; slotsSync(); renderSide();
            if (freeOn) {
                if (freeLeft > 0) { at(opt('vc_turbo', false) ? 280 : 620, function () { if (freeOn && !sBusy) spin(); }); return; }
                freeOn = false; freeTotal = 0; slotsSync(); Lampa.Noty.show('Фриспины закончились');
            }
            if (autoInf || auto > 0) {
                if (!autoInf) auto--;
                if (S.bank < bet()) { stopAuto(); Lampa.Noty.show('Автоигра остановлена: мало фишек'); }
                else { slotsSync(); at(opt('vc_turbo', false) ? 260 : 520, function () { if ((autoInf || auto > 0) && !sBusy) spin(); }); }
            }
        }
        function stopAuto() { auto = 0; autoInf = false; slotsSync(); }
        function slotsUpdate(t, dt) {
            var i, spinCount = 0;
            for (i = 0; i < reels.length; i++) {
                var r = reels[i];
                if (r.state === 'spin') {
                    spinCount++;
                    var u = clamp((t - r.t0) / r.T, 0, 1);
                    r.pos = r.start + r.D * profile(u);
                    if (u >= 1) { r.pos = r.target; reelStop(r, i); }
                } else if (r.state === 'bounce') {
                    var k = (t - r.b0) / 300;
                    if (k >= 1) { r.pos = r.target; r.state = 'idle'; }
                    else r.pos = r.target + .17 * Math.sin(k * Math.PI * 2.2) * Math.exp(-4.2 * k);
                }
                var sp = Math.abs(r.pos - r.last) / Math.max(dt, .001); r.last = r.pos;
                if (r.state !== 'idle') drawReel(r);
                if (fxOn()) {
                    var bl = clamp((sp - 7) / 10, 0, 3), f = bl > .2 ? 'blur(' + bl.toFixed(2) + 'px)' : '';
                    if (r.strip.style.webkitFilter !== f) { r.strip.style.webkitFilter = f; r.strip.style.filter = f; }
                } else if (r.strip.style.filter) { r.strip.style.webkitFilter = ''; r.strip.style.filter = ''; }
                if (sp > .4 && sp < 13 && r.state === 'spin') Snd.tick();
            }
            Snd.rollSet(spinCount ? spinCount / 5 * .9 : 0);
        }

        /* ========================== ROULETTE ========================== */
        var boardRows = [], bets = {}, stack = [], wState = 'idle', wTheta = 0, wBeta = 0, wBallR = 0;
        var wT0 = 0, wT = 0, th0 = 0, thTr = 0, bt0 = 0, btTr = 0, wResult = 0, wSettled = 0, bounces = [];
        var wCtx = null, wBaked = null, wSize = 0, zeroEl = null;

        function boardBuild() {
            brdEl.empty(); boardRows = [];
            var top = $('<div class="vc-btop"></div>'), bot = $('<div class="vc-bbot"></div>');
            zeroEl = $('<div class="vc-bzero selector" data-a="b:n0">0</div>');
            var nums = $('<div class="vc-nums"></div>'), cols = $('<div class="vc-cols"></div>');
            var rows = [$('<div class="vc-nrow"></div>'), $('<div class="vc-nrow"></div>'), $('<div class="vc-nrow"></div>')];
            var rTop = [zeroEl[0]], rMid = [zeroEl[0]], rBot = [zeroEl[0]], n, cell, i;
            for (n = 1; n <= 36; n++) {
                cell = $('<div class="vc-bcell selector ' + colOf(n) + '" data-a="b:n' + n + '">' + n + '</div>');
                if (n % 3 === 0) { rows[0].append(cell); rTop.push(cell[0]); }
                else if (n % 3 === 2) { rows[1].append(cell); rMid.push(cell[0]); }
                else { rows[2].append(cell); rBot.push(cell[0]); }
            }
            var ck = ['c3', 'c2', 'c1'];
            for (i = 0; i < 3; i++) {
                cell = $('<div class="vc-bcell selector" data-a="b:' + ck[i] + '">2:1</div>');
                cols.append(cell);
                (i === 0 ? rTop : i === 1 ? rMid : rBot).push(cell[0]);
            }
            for (i = 0; i < 3; i++) nums.append(rows[i]);
            top.append(zeroEl).append(nums).append(cols);
            brdEl.append(top);
            boardRows = [rTop, rMid, rBot];

            var outs = $('<div class="vc-outs"></div>');
            var dz = $('<div class="vc-orow"></div>'), dzr = [], dd = [['d1', '1-я 12'], ['d2', '2-я 12'], ['d3', '3-я 12']];
            for (i = 0; i < 3; i++) { cell = $('<div class="vc-bcell selector" data-a="b:' + dd[i][0] + '">' + dd[i][1] + '</div>'); dz.append(cell); dzr.push(cell[0]); }
            var ob = $('<div class="vc-orow"></div>'), obr = [],
                oo = [['low', '1–18', ''], ['even', 'ЧЁТ', ''], ['red', 'КРАСНОЕ', 'red'], ['black', 'ЧЁРНОЕ', 'black'], ['odd', 'НЕЧЁТ', ''], ['high', '19–36', '']];
            for (i = 0; i < 6; i++) { cell = $('<div class="vc-bcell selector ' + oo[i][2] + '" data-a="b:' + oo[i][0] + '">' + oo[i][1] + '</div>'); ob.append(cell); obr.push(cell[0]); }
            outs.append(dz).append(ob);
            bot.append($('<div class="vc-bsp"></div>')).append(outs).append($('<div class="vc-bsp2"></div>'));
            brdEl.append(bot);
            boardRows.push(dzr); boardRows.push(obr);

            chipsEl.find('.vc-chip').remove();
            for (i = 0; i < CHIPS.length; i++)
                chipsEl.append($('<div class="vc-chip selector" data-a="chip:' + i + '" style="background:' + CHIP_C[CHIPS[i]] + '">' + CHIPS[i] + '</div>'));
        }
        function cellOf(k) { return k === 'n0' ? zeroEl : brdEl.find('[data-a="b:' + k + '"]'); }
        function totalBet() { var t = 0, k; for (k in bets) t += bets[k].sum; return t; }
        function maxWin() {
            var m = 0, n, k, w, d;
            for (n = 0; n <= 36; n++) { w = 0; for (k in bets) { d = def(k); if (d && d.t(n)) w += bets[k].sum * (d.m + 1); } if (w > m) m = w; }
            return m;
        }
        function paintChip(k) {
            var cell = cellOf(k); if (!cell || !cell.length) return;
            cell.find('.vc-ch').remove();
            if (bets[k] && bets[k].sum > 0)
                cell.append('<div class="vc-ch">' + (bets[k].sum >= 1000 ? (bets[k].sum / 1000).toFixed(1) + 'k' : bets[k].sum) + '</div>');
        }
        function repaint() {
            brdEl.find('.vc-ch').remove();
            brdEl.find('.vc-bcell').removeClass('won'); zeroEl.removeClass('won');
            for (var k in bets) paintChip(k);
        }
        function rSync() {
            tbEl.text(fmt(totalBet())); mwEl.text(fmt(maxWin()));
            html.find('[data-a="rspin"]').toggleClass('dis', totalBet() <= 0 || wState !== 'idle').text(wState === 'idle' ? 'ВРАЩАТЬ' : 'ШАР…');
            html.find('[data-a="undo"]').toggleClass('dis', !stack.length);
            html.find('[data-a="clear"]').toggleClass('dis', totalBet() <= 0);
            html.find('[data-a="double"]').toggleClass('dis', totalBet() <= 0);
            for (var i = 0; i < CHIPS.length; i++) html.find('[data-a="chip:' + i + '"]').toggleClass('act', i === S.chipIdx);
            brdEl.toggleClass('lock', wState !== 'idle');
        }
        function place(k, amount, quiet) {
            if (wState !== 'idle') return;
            var v = amount || CHIPS[S.chipIdx];
            if (S.bank < v) { Lampa.Noty.show('Не хватает фишек — выбери фишку меньше'); return; }
            S.bank -= v;
            if (!bets[k]) bets[k] = { sum: 0, list: [] };
            bets[k].sum += v; bets[k].list.push(v);
            stack.push({ k: k, v: v });
            if (!quiet) Snd.chip();
            paintChip(k); rSync(); renderTop(); save();
        }
        function unplace(k) {
            if (wState !== 'idle' || !bets[k] || !bets[k].list.length) return;
            var v = bets[k].list.pop(); bets[k].sum -= v; S.bank += v;
            for (var i = stack.length - 1; i >= 0; i--) if (stack[i].k === k) { stack.splice(i, 1); break; }
            if (bets[k].sum <= 0) delete bets[k];
            Snd.click(); paintChip(k); rSync(); renderTop(); save();
        }
        function clearBets(refund) {
            if (refund) S.bank += totalBet();
            bets = {}; stack = []; repaint(); rSync(); renderTop(); save();
        }
        function wheelResize() {
            var box = html.find('.vc-wheel')[0];
            if (!box || !box.clientWidth) return;
            var pad = parseFloat(getComputedStyle(box).paddingLeft) || 0;
            var w = box.clientWidth - pad * 2;
            if (w <= 4) return;
            var ratio = Math.min(2.2, (window.devicePixelRatio || 1) * SCALE);
            wSize = w;
            wheelCv.width = Math.max(1, Math.floor(w * ratio));
            wheelCv.height = Math.max(1, Math.floor(w * ratio));
            wheelCv.style.width = w + 'px'; wheelCv.style.height = w + 'px';
            wCtx = wheelCv.getContext('2d'); wCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
            bake(w, ratio); drawWheel();
        }
        function bake(size, dpr) {
            var c = document.createElement('canvas');
            c.width = Math.max(1, Math.floor(size * dpr)); c.height = Math.max(1, Math.floor(size * dpr));
            var g = c.getContext('2d'); g.scale(dpr, dpr);
            var R = size / 2, i, n, a0, a1, step = 6.283 / 37, ro = R * .84, ri2 = R * .58, col, pg;
            g.translate(R, R);
            var grd = g.createRadialGradient(-R * .25, -R * .3, R * .1, 0, 0, R);
            grd.addColorStop(0, '#6b4718'); grd.addColorStop(.6, '#33200b'); grd.addColorStop(1, '#160d04');
            g.fillStyle = grd; g.beginPath(); g.arc(0, 0, R, 0, 6.283); g.fill();
            g.strokeStyle = 'rgba(246,196,83,.35)'; g.lineWidth = R * .02;
            g.beginPath(); g.arc(0, 0, R * .93, 0, 6.283); g.stroke();
            g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = R * .05;
            g.beginPath(); g.arc(0, 0, R * .875, 0, 6.283); g.stroke();
            for (i = 0; i < 37; i++) {
                n = ORDER[i]; a0 = i * step - step / 2; a1 = i * step + step / 2;
                g.beginPath(); g.moveTo(Math.cos(a0) * ri2, Math.sin(a0) * ri2);
                g.arc(0, 0, ro, a0, a1); g.lineTo(Math.cos(a1) * ri2, Math.sin(a1) * ri2);
                g.arc(0, 0, ri2, a1, a0, true); g.closePath();
                col = colOf(n);
                pg = g.createLinearGradient(Math.cos(i * step) * ri2, Math.sin(i * step) * ri2, Math.cos(i * step) * ro, Math.sin(i * step) * ro);
                if (col === 'red') { pg.addColorStop(0, '#8f0f22'); pg.addColorStop(1, '#ff5a68'); }
                else if (col === 'black') { pg.addColorStop(0, '#0d0a14'); pg.addColorStop(1, '#3b3550'); }
                else { pg.addColorStop(0, '#06694a'); pg.addColorStop(1, '#25e6a5'); }
                g.fillStyle = pg; g.fill();
                g.strokeStyle = 'rgba(246,196,83,.55)'; g.lineWidth = 1.1; g.stroke();
                g.save(); g.rotate(i * step); g.translate(0, -R * .715); g.rotate(Math.PI / 2);
                g.fillStyle = '#fff8e6'; g.font = '700 ' + (R * .085).toFixed(1) + 'px sans-serif';
                g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 0, 0); g.restore();
            }
            var cg = g.createRadialGradient(-R * .15, -R * .2, R * .05, 0, 0, ri2);
            cg.addColorStop(0, '#7a5518'); cg.addColorStop(.55, '#3a250c'); cg.addColorStop(1, '#1d1206');
            g.beginPath(); g.arc(0, 0, ri2, 0, 6.283); g.fillStyle = cg; g.fill();
            g.strokeStyle = 'rgba(246,196,83,.4)'; g.lineWidth = R * .015; g.stroke();
            for (i = 0; i < 8; i++) { g.save(); g.rotate(i * Math.PI / 4);
                g.fillStyle = 'rgba(246,196,83,.22)'; g.beginPath();
                g.moveTo(0, -ri2 * .96); g.lineTo(R * .045, -ri2 * .35); g.lineTo(-R * .045, -ri2 * .35); g.closePath(); g.fill(); g.restore(); }
            var hg = g.createRadialGradient(-R * .06, -R * .07, R * .01, 0, 0, R * .2);
            hg.addColorStop(0, '#ffe9a8'); hg.addColorStop(.6, '#c98d16'); hg.addColorStop(1, '#6b4718');
            g.beginPath(); g.arc(0, 0, R * .2, 0, 6.283); g.fillStyle = hg; g.fill();
            wBaked = c;
        }
        function drawWheel() {
            if (!wCtx || !wSize || !wBaked) return;
            var g = wCtx, R = wSize / 2, step = 6.283 / 37;
            g.clearRect(0, 0, wSize, wSize);
            g.save(); g.translate(R, R); g.rotate(wTheta); g.drawImage(wBaked, -R, -R, wSize, wSize); g.restore();
            if (wState === 'idle' && wSettled && now() - wSettled < 4200) {
                var idx = ORDER.indexOf(wResult), a = wTheta + idx * step, k = (Math.sin(now() / 180) + 1) / 2;
                g.save(); g.translate(R, R);
                g.strokeStyle = 'rgba(246,196,83,' + (.45 + k * .5).toFixed(2) + ')'; g.lineWidth = R * .055;
                g.beginPath(); g.arc(0, 0, R * .71, a - step / 2, a + step / 2); g.stroke(); g.restore();
            }
            var br = (wState === 'idle' && wSettled) ? R * .71 : (wBallR || R * .93);
            var bx = R + Math.cos(wBeta) * br, by = R + Math.sin(wBeta) * br, rad = Math.max(3, R * .042);
            g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.arc(bx + 2, by + 3, rad * .9, 0, 6.283); g.fill();
            var bg = g.createRadialGradient(bx - rad * .35, by - rad * .4, rad * .1, bx, by, rad);
            bg.addColorStop(0, '#ffffff'); bg.addColorStop(.55, '#f0e8d8'); bg.addColorStop(1, '#9a8f7e');
            g.fillStyle = bg; g.beginPath(); g.arc(bx, by, rad, 0, 6.283); g.fill();
        }
        function rSpin() {
            Snd.resume();
            if (wState !== 'idle') return;
            var t = totalBet();
            if (t <= 0) { Lampa.Noty.show('Сначала поставь фишки на поле'); return; }
            S.last = JSON.parse(JSON.stringify(bets));
            S.wagered += t; S.rspin++; addXP(t);
            wResult = ORDER[ri(0, 36)];
            var turbo = opt('vc_turbo', false), step = 6.283 / 37;
            wT = turbo ? 2600 : 5200; wT0 = now();
            th0 = wTheta; thTr = 6.283 * (turbo ? 1.6 : 2.6) + rnd(0, 6.283);
            var idx = ORDER.indexOf(wResult), bFinal = th0 + thTr + idx * step;
            bt0 = wBeta; btTr = mod(bFinal - bt0, 6.283) - 6.283 * (turbo ? 3 : 6);
            wState = 'spin'; wBallR = wSize / 2 * .93;
            bounces = [{ u: .80, d: false }, { u: .88, d: false }, { u: .945, d: false }];
            brdEl.find('.vc-bcell').removeClass('won'); zeroEl.removeClass('won');
            brdEl.find('.vc-fl').remove();
            resN.attr('class', 'n').text('?');
            resT.html('Шар в игре…<br>Ставки: <b>' + fmt(t) + '</b>');
            Snd.rollStart(); Snd.tone(320, .2, 'triangle', .05);
            rSync(); renderTop(); save();
        }
        function wheelUpdate(t, dt) {
            var R = wSize / 2, i;
            if (!R) return;
            if (wState === 'spin') {
                var u = clamp((t - wT0) / wT, 0, 1);
                wTheta = th0 + thTr * eOutQuart(u);
                wBeta = bt0 + btTr * eOutCubic(u);
                if (u < .52) wBallR = R * .93;
                else {
                    var k = clamp((u - .52) / .38, 0, 1), r = R * .93 + (R * .71 - R * .93) * eInOut(k);
                    if (u > .90) { var b = (u - .90) / .10; r = R * .71 + Math.abs(Math.sin(b * Math.PI * 2.4)) * R * .07 * (1 - b); }
                    wBallR = r;
                }
                for (i = 0; i < bounces.length; i++) if (!bounces[i].d && u >= bounces[i].u) { bounces[i].d = true; Snd.ball(); fxKick(1.5); }
                Snd.rollSet(clamp(1 - u, 0, 1));
                if (u >= 1) { wState = 'idle'; wSettled = t; wBallR = R * .71; Snd.rollStop(); rSettle(); }
            } else {
                wTheta += dt * .075;
                if (wSettled) wBeta = wTheta + ORDER.indexOf(wResult) * (6.283 / 37);
                else wBeta -= dt * .12;
                wBallR = R * .71;
            }
            drawWheel();
        }
        function rSettle() {
            var n = wResult, col = colOf(n), win = 0, stake = totalBet(), k, d, pay;
            resN.attr('class', 'n ' + col).text(n);
            for (k in bets) {
                d = def(k);
                if (d && d.t(n)) {
                    pay = bets[k].sum * (d.m + 1); win += pay;
                    cellOf(k).addClass('won').append('<div class="vc-fl">+' + fmt(pay) + '</div>');
                }
            }
            S.bank += win; S.returned += win; if (win > S.best) S.best = win;
            var cn = col === 'red' ? 'красное' : col === 'black' ? 'чёрное' : 'зеро';
            resT.html('Выпало <b>' + n + '</b> · ' + cn + '<br>' + (win > 0 ? 'Выплата <b>' + fmt(win) + '</b>' : 'Ставка ' + fmt(stake) + ' не сыграла'));
            if (win > 0) {
                Snd.win(win / Math.max(1, stake));
                fxCoins(resN, clamp(Math.round(win / Math.max(1, stake) * 3), 6, 40));
                if (win >= stake * 8) { Snd.fanfare(); fxKick(9); Lampa.Noty.show('Крупный выигрыш: +' + fmt(win)); }
            } else Snd.lose();
            S.nums.unshift(n); if (S.nums.length > 9) S.nums.pop();
            renderNums();
            pushHist('r', 'Рулетка · ' + n + ' ' + cn, stake, win);
            bets = {}; stack = [];
            at(1600, function () { repaint(); rSync(); });
            rSync(); renderTop(); save();
        }
        function renderNums() {
            var h = '', i;
            for (i = 0; i < S.nums.length; i++) h += '<i class="' + colOf(S.nums[i]) + '">' + S.nums[i] + '</i>';
            histEl.html(h || '<i style="background:none;color:#6f628c;width:auto">история пуста</i>');
        }

        /* ---------- действия ---------- */
        function act(a, el) {
            if (!a) return;
            Snd.resume();
            var parts = a.split(':'), cmd = parts[0], arg = parts[1], k, i;
            if (cmd === 'g') { switchGame(arg); return; }
            if (cmd === 'b') { place(arg); return; }
            if (cmd === 'chip') { S.chipIdx = parseInt(arg, 10); Snd.chip(); rSync(); save(); return; }
            switch (cmd) {
                case 'sound': Lampa.Storage.set('vc_sound', !opt('vc_sound', true)); Snd.sync(); Snd.click(); renderTop(); break;
                case 'turbo': Lampa.Storage.set('vc_turbo', !opt('vc_turbo', false)); Snd.click(); renderTop(); break;
                case 'fx': Lampa.Storage.set('vc_fx', !fxOn()); if (!fxOn()) FX.p.length = 0; Snd.click(); renderTop(); break;
                case 'bonus':
                    if (S.day !== dayKey()) {
                        var amt = 300 + S.level * 100; S.day = dayKey(); S.bank += amt;
                        Lampa.Noty.show('Дневной бонус: +' + fmt(amt) + ' фишек'); Snd.win(12); fxCoins($(el), 20);
                    } else if (S.bank < CHIPS[0] && Date.now() - (S.rescue || 0) >= 1800000) {
                        S.rescue = Date.now(); S.bank += 150; Lampa.Noty.show('Спонсорский купон: +150'); Snd.win(6);
                    } else Lampa.Noty.show('Бонус уже забран — возвращайся завтра');
                    renderTop(); slotsSync(); rSync(); save(); break;
                case 'reset':
                    if (now() - resetArm < 4000) { resetArm = 0; html.find('[data-a="reset"]').text('СБРОС'); doReset(); }
                    else { resetArm = now(); $(el).text('ЕЩЁ РАЗ?'); Lampa.Noty.show('Нажми ещё раз в течение 4 секунд');
                        at(4100, function () { html.find('[data-a="reset"]').text('СБРОС'); }); }
                    break;
                case 'bet-': if (S.betIdx > 0 && !freeOn) { S.betIdx--; Snd.click(); slotsSync(); save(); } break;
                case 'bet+': if (S.betIdx < LINE_BETS.length - 1 && !freeOn) { S.betIdx++; Snd.click(); slotsSync(); save(); } break;
                case 'max':
                    if (freeOn) break;
                    i = LINE_BETS.length - 1;
                    while (i > 0 && LINE_BETS[i] * 5 > S.bank) i--;
                    S.betIdx = i; Snd.chip(); slotsSync(); save(); break;
                case 'auto':
                    if (auto > 0 || autoInf) { if (auto > 0 && !autoInf) { auto = 0; autoInf = true; Lampa.Noty.show('Автоигра ∞'); } else stopAuto(); slotsSync(); }
                    else { auto = 10; autoInf = false; slotsSync(); if (!sBusy && !freeOn) spin(); }
                    break;
                case 'spin': if (auto > 0 || autoInf) { stopAuto(); Lampa.Noty.show('Автоигра остановлена'); } else spin(); break;
                case 'rspin': rSpin(); break;
                case 'undo': if (stack.length) unplace(stack[stack.length - 1].k); break;
                case 'clear': if (totalBet() > 0) { clearBets(true); Snd.click(); Lampa.Noty.show('Фишки вернулись в банк'); } break;
                case 'repeat':
                    if (!S.last) { Lampa.Noty.show('Нет прошлого расклада'); break; }
                    if (totalBet() > 0) { Lampa.Noty.show('Сначала сними текущие ставки'); break; }
                    var need = 0; for (k in S.last) need += S.last[k].sum;
                    if (S.bank < need) { Lampa.Noty.show('Не хватает фишек: нужно ' + fmt(need)); break; }
                    for (k in S.last) place(k, S.last[k].sum, true);
                    Snd.chip(); rSync(); break;
                case 'double':
                    var cur = JSON.parse(JSON.stringify(bets)), tt = totalBet();
                    if (tt <= 0) break;
                    if (S.bank < tt) { Lampa.Noty.show('Для удвоения нужно ещё ' + fmt(tt)); break; }
                    for (k in cur) place(k, cur[k].sum, true);
                    Snd.chip(); rSync(); break;
            }
        }
        function doReset() {
            var keep = { s: opt('vc_sound', true), t: opt('vc_turbo', false), f: fxOn() };
            sched.length = 0; Snd.rollStop(); stopAuto();
            sBusy = false; sPending = null; freeOn = false; freeLeft = 0; freeTotal = 0;
            for (var i = 0; i < reels.length; i++) { reels[i].state = 'idle'; reels[i].pos = reels[i].target = Math.round(reels[i].pos); drawReel(reels[i]); }
            clearHits();
            wState = 'idle'; wSettled = 0; bets = {}; stack = []; repaint();
            S = fresh(); bankShown = S.bank; jackShown = S.jackpot;
            Lampa.Storage.set('vc_sound', keep.s); Lampa.Storage.set('vc_turbo', keep.t); Lampa.Storage.set('vc_fx', keep.f);
            winEl.text('0'); winBox.addClass('zero'); banEl.removeClass('on');
            msgEl.html('Новая сессия. OK — крутить');
            resN.attr('class', 'n').text('—'); resT.html('Ставьте фишки на поле<br>и запускайте колесо');
            renderNums(); renderTop(); renderSide(); slotsSync(); rSync(); save();
            Lampa.Noty.show('Прогресс сброшен · банк 2 500');
        }
        function switchGame(g) {
            if (S.game === g) return;
            if (S.game === 'roulette' && wState === 'idle' && totalBet() > 0) { clearBets(true); Lampa.Noty.show('Фишки со стола возвращены в банк'); }
            stopAuto();
            S.game = g; save(); Snd.click();
            html.find('.vc-tab').removeClass('act');
            html.find('[data-a="g:' + g + '"]').addClass('act');
            html.find('.vc-gs').toggleClass('act', g === 'slots');
            html.find('.vc-gr').toggleClass('act', g === 'roulette');
            html.find('.vc-cs').css('display', g === 'slots' ? 'block' : 'none');
            html.find('.vc-cr').css('display', g === 'roulette' ? 'block' : 'none');
            renderSide();
            at(50, function () {
                if (g === 'slots') slotsMeasure(); else wheelResize();
                nr = 1; nc = g === 'slots' ? html.find('.vc-cs .selector').length - 1 : 1;
                buildNav();
            });
        }

        /* ---------- события ---------- */
        html.find('.selector').on('hover:enter click', function (e) { e.preventDefault(); fire(this); });
        html.on('mouseenter', '.selector', function () {
            if (nav[nr] && nav[nr][nc] === this) return;
            var p = locate(this); if (p) { nr = p[0]; nc = p[1]; applyFocus(); }
        });
        var rzT = null;
        function onResize() { clearTimeout(rzT); rzT = setTimeout(function () { fit(); }, 120); }
        window.addEventListener('resize', onResize);
        var ro = null;
        if (window.ResizeObserver) { try { ro = new ResizeObserver(onResize); } catch (e) { ro = null; } }

        /* ---------- жизненный цикл ---------- */
        this.create = function () {
            slotsBuild(); boardBuild();
            renderTop(); renderSide(); renderNums(); slotsSync(); rSync();
            bankEl.text(fmt(S.bank)); jackEl.text(fmt(S.jackpot));
            if (S.game === 'roulette') {
                html.find('.vc-tab').removeClass('act');
                html.find('[data-a="g:roulette"]').addClass('act');
                html.find('.vc-gs').removeClass('act'); html.find('.vc-gr').addClass('act');
                html.find('.vc-cs').css('display', 'none'); html.find('.vc-cr').css('display', 'block');
            }
            return this.render();
        };
        this.render = function () { return wrap; };
        this.start = function () {
            fit();
            RAF(function () { fit(); slotsMeasure(); wheelResize(); buildNav(focusEl); });
            if (ro && wrap[0].parentNode) { try { ro.observe(wrap[0].parentNode); } catch (e) {} }
            if (!focusEl) { nr = 1; nc = S.game === 'slots' ? html.find('.vc-cs .selector').length - 1 : 1; }
            buildNav(focusEl);
            Lampa.Controller.add('content', {
                toggle: function () { applyFocus(); },
                left: function () { navMove('left'); },
                right: function () { navMove('right'); },
                up: function () { navMove('up'); },
                down: function () { navMove('down'); },
                enter: function () { if (nav[nr] && nav[nr][nc]) fire(nav[nr][nc]); },
                back: function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
            startLoop();
            if (S.day !== dayKey()) Lampa.Noty.show('Дневной бонус доступен: +' + fmt(300 + S.level * 100));
        };
        this.pause = function () { stopLoop(); Snd.rollStop(); settleSlots(true); save(); };
        this.stop = function () {};
        this.destroy = function () {
            stopLoop(); Snd.rollStop(); sched.length = 0;
            window.removeEventListener('resize', onResize);
            if (ro) { try { ro.disconnect(); } catch (e) {} }
            if (wState === 'idle' && totalBet() > 0) S.bank += totalBet();
            bets = {}; stack = [];
            save(); FX.p.length = 0; wrap.remove();
        };
        this.back = function () { Lampa.Activity.backward(); };
    }

    /* ---------------------------------------------------------------- register */
    Lampa.Component.add('vcasino', Casino);

    if (Lampa.SettingsApi) {
        Lampa.SettingsApi.addComponent({
            component: 'vcasino', name: 'Казино',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 9v6M12 9v6M16 9v6"/></svg>'
        });
        Lampa.SettingsApi.addParam({ component: 'vcasino', param: { name: 'vc_sound', type: 'trigger', default: true },
            field: { name: 'Звук', description: 'Барабаны, шар, выигрыши' } });
        Lampa.SettingsApi.addParam({ component: 'vcasino', param: { name: 'vc_turbo', type: 'trigger', default: false },
            field: { name: 'Турбо', description: 'Ускоренные спины и вращения' } });
        Lampa.SettingsApi.addParam({ component: 'vcasino', param: { name: 'vc_fx', type: 'trigger', default: true },
            field: { name: 'Эффекты', description: 'Частицы, размытие барабанов, тряска. Выключи на слабых ТВ' } });
    }

    function addMenu() {
        if ($('.menu__item[data-action="vcasino"]').length) return;
        var item = $('<li class="menu__item selector" data-action="vcasino">\
<div class="menu__ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 9v6M12 9v6M16 9v6"/></svg></div>\
<div class="menu__text">Казино</div></li>');
        item.on('hover:enter click', function () {
            Lampa.Activity.push({ url: '', component: 'vcasino', title: 'Velicron Casino', page: 1 });
        });
        $('.menu .menu__list').eq(0).append(item);
    }

    $('body').append(Lampa.Template.get('vc_css', {}, true));
    if (window.appready) addMenu();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') addMenu(); });
})();
