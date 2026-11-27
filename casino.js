(function () {
    'use strict';
    if (window.plugin_velicron_casino) return;
    window.plugin_velicron_casino = true;

    var KEY  = 'velicron_casino';
    var BETS = [10, 25, 50, 100, 250];
    var SYM  = [
        {s:'♥', c:'#ff5d73', x:5,   w:30},
        {s:'♦', c:'#ffa63d', x:8,   w:25},
        {s:'♣', c:'#4ecb71', x:12,  w:20},
        {s:'♠', c:'#59b4ff', x:20,  w:13},
        {s:'★', c:'#c07cff', x:50,  w:8},
        {s:'7', c:'#ffd400', x:100, w:4}
    ];

    function fresh(){ return {bank:1000, spins:0, won:0, lost:0, best:0, day:'', rescue:0}; }
    function db(){
        var d = Lampa.Storage.get(KEY, null), f = fresh();
        if (!d || typeof d !== 'object') d = f;
        for (var k in f) if (typeof d[k] === 'undefined') d[k] = f[k];
        d.bank = Math.max(0, parseInt(d.bank, 10) || 0);
        return d;
    }
    function save(d){ Lampa.Storage.set(KEY, d); }
    function today(){ var t = new Date(); return t.getFullYear()+'-'+(t.getMonth()+1)+'-'+t.getDate(); }
    function roll(){ var r = Math.random()*100; for (var i=0;i<SYM.length;i++){ r -= SYM[i].w; if (r<0) return i; } return SYM.length-1; }
    function opt(n, def){ var v = Lampa.Storage.field(n); return typeof v === 'undefined' ? def : (v === true || v === 'true'); }

    var ac;
    function tone(f, dur, type, delay){
        if (!opt('casino_sound', true)) return;
        try{
            ac = ac || new (window.AudioContext || window.webkitAudioContext)();
            if (ac.state === 'suspended' && ac.resume) ac.resume();
            var t0 = ac.currentTime + (delay || 0);
            var o = ac.createOscillator(), g = ac.createGain();
            o.type = type || 'square'; o.frequency.setValueAtTime(f, t0);
            g.gain.setValueAtTime(0.05, t0);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            o.connect(g); g.connect(ac.destination); o.start(t0); o.stop(t0 + dur);
        }catch(e){}
    }
    function sfxWin(big){
        var n = big ? [523,659,784,1047,1319] : [523,659,784];
        for (var i=0;i<n.length;i++) tone(n[i], .18, 'triangle', i*0.09);
    }

    Lampa.Template.add('casino_css', '<style>\
    .casino{padding:1.5em 2em;color:#fff}\
    .casino__head{display:flex;justify-content:space-between;align-items:center;margin-bottom:.8em}\
    .casino__title{font-size:1.9em;font-weight:700;letter-spacing:.08em}\
    .casino__title span{color:#ffd400}\
    .casino__bank{font-size:1.7em;font-weight:700;color:#ffd400}\
    .casino__reels{display:flex;margin-bottom:.4em}\
    .casino__reel{width:2.2em;height:2.2em;line-height:2.2em;text-align:center;font-size:3.4em;\
      background:rgba(255,255,255,.06);border:2px solid rgba(255,255,255,.14);border-radius:.25em;margin-right:.2em}\
    .casino__reel.win{border-color:#ffd400;background:rgba(255,212,0,.12);\
      -webkit-animation:casino-pulse .55s ease-in-out 3;animation:casino-pulse .55s ease-in-out 3}\
    .casino__msg{font-size:1.35em;min-height:1.7em;color:#ddd}\
    .casino__msg.win{color:#ffd400}\
    .casino__big{font-size:1.5em;font-weight:700;color:#ffd400;min-height:1.4em;opacity:0;\
      -webkit-transition:opacity .3s;transition:opacity .3s}\
    .casino__big.show{opacity:1}\
    .casino__panel{display:flex;flex-wrap:wrap;margin-top:.4em}\
    .casino__btn{padding:.65em 1.3em;margin:0 .6em .6em 0;font-size:1.25em;background:rgba(255,255,255,.12);border-radius:.4em}\
    .casino__btn.focus{background:#fff;color:#000}\
    .casino__info{display:none;font-size:1.1em;line-height:1.8;color:#bbb;max-width:40em}\
    .casino__info.show{display:block}\
    .casino__info b{color:#fff}\
    @-webkit-keyframes casino-pulse{0%,100%{-webkit-transform:scale(1)}50%{-webkit-transform:scale(1.07)}}\
    @keyframes casino-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}\
    </style>');

    Lampa.Template.add('casino_main', '<div class="casino">\
        <div class="casino__head"><div class="casino__title">VELICRON <span>CASINO</span></div><div class="casino__bank">0</div></div>\
        <div class="casino__reels"><div class="casino__reel">7</div><div class="casino__reel">7</div><div class="casino__reel">7</div></div>\
        <div class="casino__msg">Ставка — влево/вправо, крутить — OK</div>\
        <div class="casino__big"></div>\
        <div class="casino__panel">\
            <div class="casino__btn selector" data-act="bet">Ставка</div>\
            <div class="casino__btn selector" data-act="spin">КРУТИТЬ</div>\
            <div class="casino__btn selector" data-act="bonus">Бонус</div>\
            <div class="casino__btn selector" data-act="info">Инфо</div>\
            <div class="casino__btn selector" data-act="reset">Сброс</div>\
        </div>\
        <div class="casino__info"></div></div>');

    function Casino(){
        var scroll = new Lampa.Scroll({mask:true, over:true});
        var html   = Lampa.Template.get('casino_main', {});
        var reels  = html.find('.casino__reel');
        var msg    = html.find('.casino__msg');
        var big    = html.find('.casino__big');
        var bankEl = html.find('.casino__bank');
        var betBtn = html.find('[data-act="bet"]');
        var info   = html.find('.casino__info');
        var Nav    = Lampa.Navigator;

        var bi = 2, busy = false, timers = [], pending = null, last = null;

        function later(fn, ms){ timers.push(setTimeout(fn, ms)); }
        function clearTimers(){ for (var i=0;i<timers.length;i++) clearTimeout(timers[i]); timers = []; }
        function setSym(el, i){ el.text(SYM[i].s).css('color', SYM[i].c); }
        function focusedAct(){ return html.find('.focus').eq(0).data('act'); }

        function renderInfo(){
            var d = db(), line = '', i;
            for (i=0;i<SYM.length;i++)
                line += '<span style="color:'+SYM[i].c+'">'+SYM[i].s+SYM[i].s+SYM[i].s+'</span> ×'+SYM[i].x+'&nbsp;&nbsp; ';
            var net = d.won - d.lost, back = d.lost ? Math.round(d.won/d.lost*100) : 0;
            info.html('<div><b>Выплаты:</b> '+line+'</div>'+
                '<div>Любая пара — возврат ставки. Теоретический возврат ≈ 92%.</div>'+
                '<div><b>Спинов:</b> '+d.spins+' &nbsp; <b>Выиграно:</b> '+d.won+' &nbsp; <b>Поставлено:</b> '+d.lost+'</div>'+
                '<div><b>Итог:</b> '+(net>0?'+':'')+net+' &nbsp; <b>Лучший:</b> '+d.best+' &nbsp; <b>Факт. возврат:</b> '+back+'%</div>');
        }

        function paint(){
            var d = db();
            while (bi > 0 && BETS[bi] > d.bank) bi--;
            bankEl.text(d.bank + ' фишек');
            betBtn.text('Ставка: ' + BETS[bi]);
            if (info.hasClass('show')) renderInfo();
        }

        function countUp(from, to){
            var t0 = Date.now();
            function step(){
                var p = Math.min(1, (Date.now()-t0)/450);
                bankEl.text(Math.round(from + (to-from)*p) + ' фишек');
                if (p < 1) later(step, 40);
            }
            step();
        }

        function cycleBet(dir){
            var d = db(), n = BETS.length, i = bi, k;
            for (k=0;k<n;k++){ i = (i + dir + n) % n; if (BETS[i] <= d.bank){ bi = i; break; } }
            paint(); tone(dir > 0 ? 460 : 380, .04);
        }

        function animateReel(el, idx, dur, done){
            var t0 = Date.now();
            function step(){
                var p = (Date.now()-t0)/dur;
                if (p >= 1){ setSym(el, idx); done(); return; }
                setSym(el, Math.floor(Math.random()*SYM.length));
                later(step, 55 + Math.pow(p, 3)*190);
            }
            step();
        }

        function settle(){
            if (!pending) return;
            var p = pending; pending = null; busy = false;
            clearTimers();
            reels.each(function(i){ setSym($(this), p.res[i]); });

            var win = 0, line = [];
            if (p.res[0]===p.res[1] && p.res[1]===p.res[2]){ win = p.bet*SYM[p.res[0]].x; line=[0,1,2]; }
            else if (p.res[0]===p.res[1]){ win = p.bet; line=[0,1]; }
            else if (p.res[1]===p.res[2]){ win = p.bet; line=[1,2]; }
            else if (p.res[0]===p.res[2]){ win = p.bet; line=[0,2]; }

            reels.removeClass('win');
            for (var i=0;i<line.length;i++) reels.eq(line[i]).addClass('win');

            var d = db(), before = d.bank;
            if (win){
                d.bank += win; d.won += win;
                if (win > d.best) d.best = win;
                msg.addClass('win').text('Выигрыш ' + win + ' фишек');
                sfxWin(win >= p.bet*20);
                if (win >= p.bet*20){
                    big.text('★ БОЛЬШОЙ ВЫИГРЫШ ×' + Math.round(win/p.bet) + ' ★').addClass('show');
                    later(function(){ big.removeClass('show'); }, 2600);
                }
            } else {
                msg.removeClass('win').text('Мимо. Ещё раз?');
                tone(150, .12, 'sine');
            }
            save(d); paint();
            if (win) countUp(before, d.bank);
        }

        function spin(){
            if (busy) return;
            var d = db(), bet = BETS[bi];
            if (d.bank < bet){ Lampa.Noty.show('Не хватает фишек — забери бонус'); return; }
            clearTimers();
            busy = true;
            reels.removeClass('win'); big.removeClass('show');
            msg.removeClass('win').text('Крутим...');
            d.bank -= bet; d.spins++; d.lost += bet; save(d); paint();
            tone(220, .06);

            var fast = opt('casino_fast', false);
            var base = fast ? 320 : 800, gap = fast ? 170 : 430;
            var res = [roll(), roll(), roll()], stopped = 0;
            pending = {res: res, bet: bet};

            reels.each(function(i){
                var el = $(this);
                animateReel(el, res[i], base + i*gap, function(){
                    tone(300 + i*130, .07);
                    stopped++;
                    if (stopped === 3) settle();
                });
            });
        }

        function bonus(){
            var d = db(), now = Date.now();
            if (d.day !== today()){
                d.day = today(); d.bank += 250; save(d); paint();
                Lampa.Noty.show('Дневной бонус: +250 фишек'); sfxWin(false); return;
            }
            if (d.bank < BETS[0]){
                var left = 3600000 - (now - (d.rescue || 0));
                if (left <= 0){
                    d.rescue = now; d.bank += 100; save(d); paint();
                    Lampa.Noty.show('Спонсорский купон: +100 фишек'); return;
                }
                Lampa.Noty.show('Купон через ' + Math.ceil(left/60000) + ' мин'); return;
            }
            Lampa.Noty.show('Бонус уже забран сегодня');
        }

        function reset(){
            Lampa.Select.show({
                title: 'Сбросить банк и статистику?',
                items: [{title:'Да, начать заново', ok:true}, {title:'Отмена'}],
                onSelect: function(a){
                    if (a.ok){ save(fresh()); bi = 2; paint(); Lampa.Noty.show('Прогресс сброшен'); }
                    Lampa.Controller.toggle('content');
                },
                onBack: function(){ Lampa.Controller.toggle('content'); }
            });
        }

        html.find('.casino__btn').on('hover:enter', function(){
            last = this;
            var act = $(this).data('act');
            if (act === 'bet') cycleBet(1);
            else if (act === 'spin') spin();
            else if (act === 'bonus') bonus();
            else if (act === 'info'){ info.toggleClass('show'); renderInfo(); }
            else if (act === 'reset') reset();
        });

        this.create  = function(){ scroll.append(html); paint(); return this.render(); };
        this.render  = function(js){ return js ? html : scroll.render(); };

        this.start = function(){
            Lampa.Controller.add('content', {
                toggle: function(){
                    Lampa.Controller.collectionSet(html);
                    Lampa.Controller.collectionFocus(last || html.find('[data-act="spin"]')[0], html);
                },
                left:  function(){ if (focusedAct() === 'bet') cycleBet(-1); else Nav.move('left'); },
                right: function(){ if (focusedAct() === 'bet') cycleBet(1);  else Nav.move('right'); },
                up:    function(){ Nav.move('up'); },
                down:  function(){ Nav.move('down'); },
                enter: function(){ var f = html.find('.focus').eq(0); if (f.length) f.trigger('hover:enter'); },
                back:  function(){ Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause   = function(){ settle(); clearTimers(); big.removeClass('show'); };
        this.stop    = function(){};
        this.destroy = function(){ settle(); clearTimers(); scroll.destroy(); html.remove(); };
        this.back    = function(){ Lampa.Activity.backward(); };
    }

    Lampa.Component.add('casino', Casino);

    if (Lampa.SettingsApi){
        Lampa.SettingsApi.addComponent({
            component: 'casino', name: 'Казино',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 9v6M12 9v6M16 9v6"/></svg>'
        });
        Lampa.SettingsApi.addParam({
            component:'casino', param:{name:'casino_sound', type:'trigger', default:true},
            field:{name:'Звук', description:'Щелчки барабанов и фанфары выигрыша'}
        });
        Lampa.SettingsApi.addParam({
            component:'casino', param:{name:'casino_fast', type:'trigger', default:false},
            field:{name:'Быстрый спин', description:'Короткая анимация барабанов'}
        });
    }

    function menu(){
        var item = $('<li class="menu__item selector" data-action="casino">\
            <div class="menu__ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\
            <rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 9v6M12 9v6M16 9v6"/></svg></div>\
            <div class="menu__text">Казино</div></li>');
        item.on('hover:enter', function(){
            Lampa.Activity.push({component:'casino', title:'Velicron Casino', page:1});
        });
        $('.menu .menu__list').eq(0).append(item);
    }

    $('body').append(Lampa.Template.get('casino_css', {}, true));
    if (window.appready) menu();
    else Lampa.Listener.follow('app', function(e){ if (e.type == 'ready') menu(); });
})();
