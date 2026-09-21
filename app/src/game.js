/* 끝말잇기 대국 — 게임 로직.
   사전은 dict.json에서 받아 오고, 토스 SDK는 platform.js가 감싼다. */
export function startGame({ DICT_IDX, DICT_TIERS, DEX_MAIN, DEX_HARD, platform, saved }) {
  var SAVE_KEY = 'wchain5';

  "use strict";
  var $ = function(id){ return document.getElementById(id); };

  /* ── 사전 ───────────────────────────────────────────────
     DICT_IDX   : 첫 음절 -> 나머지 음절(개행 구분). 2~4음절 표제어 281,389개. 내가 쓸 수 있는 말.
     DICT_TIERS : 한글이가 아는 말을 빈도 3단으로 나눈 것. 명사 사전으로 걸러 24,912개.
                  난이도가 오를수록 윗단을 열어준다 = 한글이의 어휘가 넓어진다.        */
  var CNT = {};
  for (var k in DICT_IDX){
    var s = "\n" + DICT_IDX[k] + "\n";
    DICT_IDX[k] = s;
    var c = 0, i = -1;
    while ((i = s.indexOf("\n", i+1)) >= 0) c++;
    CNT[k] = c - 1;
  }
  var TIER = DICT_TIERS.map(function(s){ return s.split("\n"); });
  var IS_BASIC = {};
  var FIRST = [{},{},{}];
  TIER.forEach(function(list, t){
    list.forEach(function(w){
      IS_BASIC[w] = 1;
      (FIRST[t][w[0]] = FIRST[t][w[0]] || []).push(w);
    });
  });

  function inDict(w){
    var s = DICT_IDX[w[0]];
    return !!s && s.indexOf("\n" + w.slice(1) + "\n") >= 0;
  }

  var Y = [2,3,6,7,12,17,20];
  function mk(c,j,t){ return String.fromCharCode(0xAC00 + c*588 + j*28 + t); }
  function allowedStarts(ch){
    var out=[ch], code=ch.charCodeAt(0)-0xAC00;
    if (code < 0 || code > 11171) return out;
    var cho=Math.floor(code/588), jung=Math.floor((code%588)/28), jong=code%28;
    if (cho === 5){ out.push(Y.indexOf(jung) >= 0 ? mk(11,jung,jong) : mk(2,jung,jong)); }
    else if (cho === 2 && Y.indexOf(jung) >= 0){ out.push(mk(11,jung,jong)); }
    return out;
  }

  var st = {
    moves:[], used:{}, usedFirst:{}, left:30, timer:null, over:false,
    rankIdx:0, prog:0, dexWords:0, dexKill:0, dexRare:0,
    undoUsed:false, difficulty:0.35, started:false,
    dex:{}, rareList:[], exam:false, examReady:false,
    sound:true, haptic:true, hint:null, hintsUsed:0,
    ads:false, freeHint:true, sinceAd:0, best:0
  };
  st.ads = ADS_DEFAULT;
  var NEED_WINS = 3;
  /* 광고 스위치.
     인앱 광고를 켜려면 사업자등록이 필요하다(누적 예상수익 5,000원까지만 유예).
     그때까지는 꺼둔 채로 낸다 — 끄면 보상 기능이 사라지는 게 아니라 '한 판에 1회 무료'가 된다.
     실제 출시 때는 이 값 하나만 바꾸면 광고 흐름이 전부 살아난다. */
  var ADS_DEFAULT = false;
  /* 전면광고는 몇 판에 한 번만. 매 판마다 끼우면 이탈한다.
     토스 문서 기준 eCPM은 리워드 > 전면 > 배너라, 전면은 드물게 두고 리워드에 무게를 싣는다. */
  var AD_EVERY = 3;

  /* 난이도 -> 한글이가 열어둘 어휘 단수 */
  /* 급수가 높을수록 한글이가 내려갈 수 있는 바닥이 올라간다.
     초반은 완만하고 위로 갈수록 가팔라서, 어딘가에서 반드시 막히게 된다. */
  function rankFloor(){
    return 0.10 + 0.72 * Math.pow(st.rankIdx / (RANKS.length - 1), 1.6);
  }
  function level(){ return Math.min(1, st.difficulty + (st.exam ? 0.3 : 0)); }
  function prefTier(){ var d = level(); return d < 0.34 ? 0 : (d < 0.70 ? 1 : 2); }
  /* 한글이 급수는 실제 난이도를 따라간다. 고정 표기는 거짓말이었다. */
  function aiRank(){ return RANKS[Math.min(RANKS.length-1, Math.round(level()*(RANKS.length-1)))]; }
  /* 한글이가 '말이 안 떠오르는' 확률.
     지고 있을수록 커지되, 실제로 자리가 빡빡할 때만 일어난다.
     「가」처럼 수백 개가 있는 자리에서 막히면 그 자체가 티가 나기 때문이다. */
  function blankChance(n){
    if (st.exam) return 0;                 /* 시험에서는 봐주지 않는다 */
    if (st.difficulty >= 0.7) return 0;
    var ease   = Math.max(0, 0.7 - st.difficulty) / 0.6;
    var scarce = n <= 4 ? 1 : n <= 12 ? 0.8 : n <= 30 ? 0.4 : n <= 60 ? 0.06 : 0;
    return 0.6 * ease * scarce;
  }

  function remaining(word){
    var n = 0;
    allowedStarts(word[word.length-1]).forEach(function(c){
      n += (CNT[c] || 0) - (st.usedFirst[c] || 0);
    });
    return n;
  }
  function aiOptions(word){
    var out = [];
    allowedStarts(word[word.length-1]).forEach(function(c){
      for (var t = 0; t < 3; t++){
        (FIRST[t][c] || []).forEach(function(w){ if (!st.used[w]) out.push({w:w, t:t}); });
      }
    });
    return out;
  }
  function markUsed(w){
    st.used[w] = 1;
    st.usedFirst[w[0]] = (st.usedFirst[w[0]] || 0) + 1;
  }

  var RANKS = ["18급","15급","12급","10급","8급","6급","5급","4급","3급","2급","1급","초단","2단","3단"];

  /* ── 소리 · 진동 ─────────────────────────
     토스 게임 심사 항목: 효과음·햅틱이 있어야 하고, 사용자가 직접 끌 수 있어야 하며,
     백그라운드로 가면 즉시 멈춰야 한다. 파일 없이 WebAudio로 합성한다.
     바둑돌은 잡음 버스트 + 공명음, 종과 징은 비조화 배음을 겹쳐 만든다. */
  var AC = null, MASTER = null, muted = false;
  function actx(){
    if (muted || !st.sound) return null;
    try{
      if (!AC){
        AC = new (window.AudioContext || window.webkitAudioContext)();
        MASTER = AC.createGain();
        MASTER.gain.value = 0.9;
        MASTER.connect(AC.destination);
      }
      if (AC.state === 'suspended') AC.resume();
      return AC;
    }catch(e){ return null; }
  }
  function noiseBuf(c){
    if (c._nb) return c._nb;
    var n = Math.floor(c.sampleRate * 0.15);
    var b = c.createBuffer(1, n, c.sampleRate), ch = b.getChannelData(0);
    for (var i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
    c._nb = b; return b;
  }
  /* 단음 */
  function tone(freq, dur, vol, type, delay, glideTo){
    var c = actx(); if (!c) return;
    try{
      var t = c.currentTime + (delay || 0);
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(MASTER);
      o.start(t); o.stop(t + dur + 0.03);
    }catch(e){}
  }
  /* 비조화 배음을 겹친 종·징 */
  var PARTIALS = {
    gong: [[1,1,1],[2.01,0.55,0.8],[2.98,0.32,0.62],[4.17,0.2,0.45],[5.43,0.12,0.34]],
    bell: [[1,1,1],[2.0,0.5,0.7],[3.01,0.28,0.5],[4.19,0.15,0.36]]
  };
  function bell(base, dur, vol, kind, delay){
    var c = actx(); if (!c) return;
    (PARTIALS[kind] || PARTIALS.bell).forEach(function(p){
      tone(base * p[0], dur * p[2], vol * p[1], 'sine', delay || 0);
    });
  }
  /* 바둑돌: 짧은 잡음 + 나무 공명 */
  function stoneHit(bright, vol){
    var c = actx(); if (!c) return;
    try{
      var t = c.currentTime;
      var s = c.createBufferSource(); s.buffer = noiseBuf(c);
      var bp = c.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = bright; bp.Q.value = 1.4;
      var g = c.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
      s.connect(bp); bp.connect(g); g.connect(MASTER);
      s.start(t); s.stop(t + 0.08);
    }catch(e){}
    tone(bright * 0.34, 0.1, vol * 0.5, 'triangle');
  }

  var SFX = {
    /* 대국 개시 — 낮은 징 한 번 */
    start: function(){ bell(146.8, 2.4, 0.16, 'gong'); tone(73.4, 1.2, 0.09, 'sine'); },
    stone: function(who){ stoneHit(who === 'me' ? 2100 : 1450, who === 'me' ? 0.2 : 0.17); },
    tap:   function(){ stoneHit(2600, 0.08); },
    tick:  function(){ tone(1180, 0.035, 0.05, 'square'); },
    /* 낯선 말 — 위로 튀는 잔종 */
    rare:  function(){ [0,0.07,0.14].forEach(function(dt,i){ bell(880*Math.pow(1.26,i), 0.5, 0.075, 'bell', dt); }); },
    /* 한방 — 묵직하게 닫는 소리 */
    kill:  function(){ bell(392, 1.1, 0.15, 'gong'); tone(196, 0.5, 0.1, 'sine', 0.02); },
    /* 불계승 — 올라가는 세 음 */
    win:   function(){ [523.3,659.3,784].forEach(function(f,i){ bell(f, 1.3, 0.13, 'bell', i*0.11); }); },
    /* 불계패 — 내려앉는 두 음 */
    lose:  function(){ bell(311.1, 1.0, 0.12, 'bell'); tone(155.6, 0.9, 0.09, 'sine', 0.13, 130); },
    /* 승급 — 승리보다 길고 밝게, 징으로 마무리 */
    promote: function(){
      [523.3,659.3,784,1046.5].forEach(function(f,i){ bell(f, 1.4, 0.12, 'bell', i*0.1); });
      bell(261.6, 2.6, 0.1, 'gong', 0.42);
    }
  };
  function buzz(ms){
    if (!st.haptic) return;
    try{ platform.haptic(ms); }catch(e){}
  }
  document.addEventListener('visibilitychange', function(){
    muted = document.hidden;
    try{ if (AC) document.hidden ? AC.suspend() : AC.resume(); }catch(e){}
  });

  function load(){
    try{
      var v = saved || {};
      ['rankIdx','prog','dexWords','dexKill','dexRare','difficulty'].forEach(function(k){
        if (typeof v[k] === 'number') st[k] = v[k];
      });
      if (v.dex && typeof v.dex === 'object') st.dex = v.dex;
      if (Array.isArray(v.rareList)) st.rareList = v.rareList;
      if (typeof v.examReady === 'boolean') st.examReady = v.examReady;
      if (typeof v.sound === 'boolean') st.sound = v.sound;
      if (typeof v.haptic === 'boolean') st.haptic = v.haptic;
      if (typeof v.hintsUsed === 'number') st.hintsUsed = v.hintsUsed;
      if (typeof v.ads === 'boolean') st.ads = v.ads;
      if (typeof v.sinceAd === 'number') st.sinceAd = v.sinceAd;
      if (typeof v.best === 'number') st.best = v.best;
      st.difficulty = Math.min(1, Math.max(rankFloor(), st.difficulty));
    }catch(e){}
  }
  function save(){
    try{ platform.storage.set(SAVE_KEY, JSON.stringify({
      rankIdx:st.rankIdx, prog:st.prog, dexWords:st.dexWords,
      dexKill:st.dexKill, dexRare:st.dexRare, difficulty:st.difficulty,
      dex:st.dex, rareList:st.rareList.slice(-60), examReady:st.examReady,
      sound:st.sound, haptic:st.haptic, hintsUsed:st.hintsUsed, ads:st.ads, sinceAd:st.sinceAd, best:st.best })); }catch(e){}
  }

  function pinKibo(){
    var k = $('kibo'); if (!k) return;
    var go = function(){ k.scrollTop = k.scrollHeight; };
    go();                       // 레이아웃이 이미 끝난 경우
    setTimeout(go, 0);          // 패널이 다시 그려진 직후
    setTimeout(go, 80);         // 글꼴·애니메이션으로 높이가 늦게 잡히는 경우
  }

  function place(word, who, rare){
    st.moves.push({w:word, who:who});
    markUsed(word);
    var k=$('kibo'), el=document.createElement('div');
    el.className = 'mv ' + (who === 'me' ? 'me' : '');
    el.innerHTML = '<span class="no">' + st.moves.length + '</span>' +
      '<span class="word ' + (who === 'me' ? (rare ? 'rare' : 'w') : 'b') + '">' + word +
      (rare ? '<span class="seal">낯선 말</span>' : '') + '</span>';
    k.appendChild(el);
    SFX.stone(who); if (who === 'me') buzz(12);
    pinKibo();
  }
  function last(){ return st.moves[st.moves.length-1].w; }
  function needChar(){ return last()[last().length-1]; }

  /* 둘 수를 먼저 정한다. 화면에 보이는 '고민'은 이 결정과 분리돼 있다. */
  function planAi(){
    var all = aiOptions(last());
    if (!all.length) return {concede:true, stuck:true, opts:0};
    if (st.moves.length >= 8 && Math.random() < blankChance(all.length)){
      return {concede:true, stuck:false, opts:all.length};
    }
    var P = prefTier();
    var cands = all.filter(function(o){ return o.t <= P; });
    if (!cands.length) cands = all;
    cands = cands.map(function(o){ return o.w; });
    if (cands.length > 240){
      for (var a = cands.length - 1; a > 0; a--){
        var b = Math.floor(Math.random()*(a+1)), t = cands[a]; cands[a]=cands[b]; cands[b]=t;
      }
      cands = cands.slice(0, 240);
    }
    var scored = cands.map(function(w){ return {w:w, f:remaining(w) - 1}; });
    var pool = scored.filter(function(s){ return s.f > 0; });
    if (!pool.length) pool = scored;
    pool.sort(function(x,y){ return y.f - x.f; });
    var i = Math.floor(level() * (pool.length - 1));
    if (Math.random() < 0.45) i += (Math.random() < 0.5 ? -1 : 1);
    i = Math.max(0, Math.min(pool.length - 1, i));
    return {concede:false, word:pool[i].w, opts:all.length};
  }

  /* 고민하는 시간.
     핵심은 '오래 생각하면 진다'가 되지 않는 것이다. 질 때는 반드시 오래 생각하지만,
     오래 생각하고도 두는 경우가 더 많아야 고민이 패배의 신호가 되지 않는다.
     또 실제로 둘 수 있는 말이 적을수록 더 오래 생각한다 — 이건 진짜 정보다. */
  function runAi(){
    var plan = planAi();
    var n = plan.opts;
    /* 지고 있을수록 평소에도 더 뜸을 들인다. 그래야 고민이 패배의 신호가 되지 않는다. */
    var slow = 1 + Math.max(0, 0.7 - level()) * 1.5;
    var tight = Math.min(0.95, (n <= 3 ? 0.92 : n <= 10 ? 0.6 : n <= 40 ? 0.34 : 0.2) * slow);
    var ponder = plan.concede || Math.random() < tight;
    var need = needChar();
    var el = $('think');
    var jobs = [], total;

    if (ponder){
      total = 1900 + Math.random()*1500 + (plan.concede ? 800 : 0);
      jobs.push([750,  '한글이가 오래 생각합니다']);
      jobs.push([1500, '「' + need + '」… 「' + need + '」…']);
      if (total > 3000) jobs.push([2800, '한글이가 한참을 망설입니다']);
    } else {
      total = 430 + Math.random()*380;
    }
    jobs.forEach(function(j){
      setTimeout(function(){
        if ($('think') && !st.over){ $('think').textContent = j[1]; pinKibo(); }
      }, j[0]);
    });
    setTimeout(function(){
      if (st.over) return;
      if (plan.concede){
        finish(true, plan.stuck ? '한글이가 이을 말을 찾지 못했습니다.'
                                : '한글이가 한참 생각하다 고개를 저었습니다.');
        return;
      }
      place(plan.word, 'ai');
      if (remaining(plan.word) <= 0){ finish(false, '이을 말이 없습니다. 한글이가 길을 막았습니다.'); return; }
      startTurn();
    }, total);
  }

  /* 힌트 = 다음에 둘 수 있는 말의 '두 번째 글자'.
     첫 글자는 이미 알고 있으니 두 번째를 열어줘야 실제로 도움이 된다.
     한글이가 아는 흔한 말에서 고르므로, 힌트를 따라가면 반드시 답이 있다. */
  function hintFor(){
    var s = allowedStarts(needChar());
    for (var t = 0; t < 3; t++){
      var pool = [];
      for (var a = 0; a < s.length; a++){
        (FIRST[t][s[a]] || []).forEach(function(w){ if (!st.used[w] && w.length >= 2) pool.push(w); });
      }
      if (pool.length) return pool[Math.floor(Math.random() * pool.length)][1];
    }
    return null;
  }

  function startTurn(){ st.left = 30; st.hint = null; renderTurn(); if (st.started) tick(); }
  function tick(){
    clearInterval(st.timer);
    st.timer = setInterval(function(){
      st.left--;
      var c = $('clock');
      if (c){ c.textContent = st.left; c.className = 'clock' + (st.left <= 10 ? ' hot' : ''); }
      if (st.left <= 10 && st.left > 0) SFX.tick();
      if (st.left <= 0){ clearInterval(st.timer); finish(false, '초읽기를 넘겼습니다.'); }
    }, 1000);
  }
  function renderTurn(){
    $('panel').innerHTML =
      '<div class="turn"><span class="need"><b>' + needChar() + '</b>' +
        (st.hint ? '<b class="hint">' + st.hint + '</b>' : '') + ' 로 시작</span>' +
        '<span class="clock" id="clock">' + st.left + '</span></div>' +
      '<div class="entry">' +
        '<input id="inp" type="text" inputmode="text" autocomplete="off" autocapitalize="off" ' +
        'spellcheck="false" placeholder="' + (st.hint ? needChar() + st.hint + '…' : '두 글자 이상') + '" ' +
        'aria-label="단어 입력">' +
        '<button class="btn" id="go">두다</button></div>' +
      '<p class="msg" id="msg"></p>' +
      '<div class="aux">' +
        (st.hint
          ? '<span class="lnk on" style="text-decoration:none">힌트를 받았습니다</span>'
          : (st.ads || st.freeHint
              ? '<button class="lnk" id="hint">힌트 보기' + (st.ads ? ' (광고)' : '') + '</button>'
              : '<span class="lnk" style="text-decoration:none;opacity:.5">힌트를 다 썼습니다</span>')) +
        '<button class="lnk" id="give">모르겠습니다</button>' +
      '</div>';
    var begin = function(){ if (!st.started){ st.started = true; tick(); } };
    $('inp').addEventListener('focus', begin);
    $('inp').addEventListener('keydown', function(e){ if (e.key === 'Enter') submit(); });
    $('go').addEventListener('click', function(){ begin(); submit(); });
    $('give').addEventListener('click', function(){ finish(false, '항복하셨습니다.'); });
    if ($('hint')) $('hint').addEventListener('click', function(){ SFX.tap(); askHint(); });
    pinKibo();
  }

  /* 리워드 광고 자리.
     광고를 보는 동안 초읽기를 멈춘다 — 광고 때문에 시간패하면 아무도 안 본다. */
  function askHint(){
    var ch = hintFor();
    if (!ch){ say('알려드릴 말이 없습니다.'); return; }
    if (!st.ads){                       /* 광고를 끈 상태 — 한 판에 한 번 무료 */
      if (!st.freeHint){ say('이번 판의 힌트를 다 썼습니다.'); return; }
      st.freeHint = false;
      grantHint(ch);
      return;
    }
    clearInterval(st.timer);
    var keep = $('panel').innerHTML;
    $('panel').innerHTML =
      '<div class="turn"><span class="need"><b>' + needChar() + '</b> 로 시작</span>' +
        '<span class="clock">' + st.left + '</span></div>' +
      '<div class="adbox"><span class="tag">리워드 광고 자리</span>' +
        '<p>광고를 보면 <b>두 번째 글자</b>를 알려드립니다.<br>' +
        '보는 동안 초읽기는 멈춥니다.</p>' +
        '<div class="pair"><button class="btn ghost" id="adNo">그만두기</button>' +
        '<button class="btn" id="adYes">광고 보기</button></div></div>';
    $('adNo').addEventListener('click', function(){
      SFX.tap(); $('panel').innerHTML = keep; rebindTurn(); tick();
    });
    $('adYes').addEventListener('click', function(){ SFX.tap(); playAd(ch); });
  }

  function playAd(ch){
    var left = 3;
    $('panel').innerHTML =
      '<div class="adplay"><span class="big">광고 재생 중</span>' +
      '<span class="small" id="adSec">' + left + '초 뒤 보상</span></div>';
    var iv = setInterval(function(){
      left--;
      var e = $('adSec');
      if (e) e.textContent = left > 0 ? left + '초 뒤 보상' : '보상을 받았습니다';
      if (left <= 0){ clearInterval(iv); grantHint(ch); }
    }, 1000);
  }

  function grantHint(ch){
    st.hint = ch; st.hintsUsed++;
    SFX.rare(); buzz([10,40,10]);
    renderTurn(); tick();
    say('두 번째 글자는 「' + ch + '」입니다.', 'rare');
  }

  /* 광고를 취소했을 때 원래 차례 화면의 핸들러를 다시 건다 */
  function rebindTurn(){
    var begin = function(){ if (!st.started){ st.started = true; tick(); } };
    if ($('inp')){
      $('inp').addEventListener('focus', begin);
      $('inp').addEventListener('keydown', function(e){ if (e.key === 'Enter') submit(); });
    }
    if ($('go')) $('go').addEventListener('click', function(){ begin(); submit(); });
    if ($('give')) $('give').addEventListener('click', function(){ finish(false, '항복하셨습니다.'); });
    if ($('hint')) $('hint').addEventListener('click', function(){ SFX.tap(); askHint(); });
  }
  function say(t, cls){ var m=$('msg'); if(m){ m.textContent=t; m.className='msg'+(cls?' '+cls:''); } }

  function submit(){
    if (st.over) return;
    var inp = $('inp'); if (!inp) return;
    var w = (inp.value || '').trim();
    if (w.length < 2){ say('두 글자 이상이어야 합니다.'); return; }
    if (allowedStarts(needChar()).indexOf(w[0]) < 0){ say('"' + needChar() + '" (으)로 시작해야 합니다.'); return; }
    if (st.used[w]){ say('이미 나온 말입니다.'); return; }
    if (!inDict(w)){ say('사전에 없는 말입니다.'); return; }
    clearInterval(st.timer);
    inp.value = '';
    var rare = !IS_BASIC[w];
    st.dexWords++;
    if (rare){ st.dexRare++; if (st.rareList.indexOf(w) < 0) st.rareList.push(w); }
    place(w, 'me', rare);
    if (rare) setTimeout(function(){ SFX.rare(); buzz([10,40,10]); }, 90);
    if (remaining(w) <= 0){
      if (st.moves.length < 8){
        st.moves.pop(); delete st.used[w]; st.usedFirst[w[0]]--;
        if (rare) st.dexRare--;
        st.dexWords--;
        $('kibo').removeChild($('kibo').lastChild);
        say('「' + w + '」은 한방단어입니다. 8수가 지나기 전에는 쓸 수 없습니다.');
        st.started = true; tick();
        return;
      }
      st.dexKill++;
      var ch = w[w.length-1];
      var isNew = !st.dex[ch];
      if (isNew) st.dex[ch] = w;
      setTimeout(function(){ SFX.kill(); }, 80);
      finish(true, '「' + ch + '」— 이을 수 있는 말이 사전에 없습니다. 도감에 올렸습니다.');
      return;
    }
    if (!aiOptions(w).length){
      st.dexKill++;
      finish(true, rare ? '「' + w + '」— 한글이가 모르는 말이었습니다.'
                        : '한글이가 이을 말을 찾지 못했습니다.');
      return;
    }
    $('panel').innerHTML = '<div class="turn"><span class="need" id="think">한글이가 생각 중…</span></div>' +
      (rare ? '<p class="msg rare">「' + w + '」— 한글이가 모르는 말입니다. 인정!</p>' : '');
    pinKibo();
    runAi();
  }

  function finish(win, why){
    if (st.over) return;
    st.over = true; clearInterval(st.timer);
    var app = document.querySelector('.app');
    app.classList.add('done'); app.classList.remove('exam');
    st.difficulty = win ? st.difficulty + 0.09 : st.difficulty - 0.13;

    var wasExam = st.exam, promoted = false;
    st.exam = false;
    if (wasExam){
      if (win && st.rankIdx < RANKS.length - 1){
        st.rankIdx++; st.prog = 0; st.examReady = false; promoted = true;
      }
      /* 떨어져도 급수는 그대로. 시험 자격은 남는다. */
    } else if (win){
      st.prog++;
      if (st.prog >= NEED_WINS && st.rankIdx < RANKS.length - 1) st.examReady = true;
    }
    /* 급수가 정해진 뒤에 바닥을 적용한다. 승급하면 그 자리에서 바로 세진다. */
    st.sinceAd++;
    var record = st.moves.length > st.best;
    if (record) st.best = st.moves.length;
    st.difficulty = Math.min(1, Math.max(rankFloor(), st.difficulty));
    save();
    if (win){
      if (promoted){ SFX.promote(); buzz([16,50,16,50,40]); }
      else { SFX.win(); buzz([14,60,24]); }
    } else { SFX.lose(); buzz(40); }
    /* 승패음이 끝난 뒤에 기록 소리를 얹는다 */
    if (record && st.moves.length >= 6){
      setTimeout(function(){ SFX.rare(); buzz([10,40,10]); }, 700);
      /* 리더보드는 토스가 관리한다. 우리는 점수만 올리고 유효성만 책임진다. */
      platform.leaderboard.submit(st.best);
    }
    var h = '<section class="over">' +
      '<h2>' + (wasExam ? (win ? '합격' : '불합격') : (win ? '불계승' : '불계패')) + '</h2>' +
      '<p class="why">' + why + '</p>' +
      (promoted ? '<p class="why" style="color:var(--accent);font-weight:700">' +
        RANKS[st.rankIdx] + '으로 승급하셨습니다.</p>' +
        '<p class="why">한글이도 ' + aiRank() + '이 되었습니다. 더는 그 아래로 물러서지 않습니다.</p>' : '') +
      (wasExam && !win ? '<p class="why">급수는 그대로입니다. 다시 응시할 수 있습니다.</p>' : '') +
      (record && st.moves.length >= 6
        ? '<p class="why" style="color:var(--rare);font-weight:700">최장 기록입니다 — ' +
          st.moves.length + '수까지 이었습니다.</p>'
        : '<p class="why">' + st.moves.length + '수 · 최장 ' + st.best + '수</p>') +
      '<div class="rankbar"><div class="lab"><span>' + RANKS[st.rankIdx] + '</span>' +
        '<span>' + (st.rankIdx >= RANKS.length - 1 ? '최고 단'
          : st.examReady ? '승급 시험 응시 가능'
          : '시험까지 ' + Math.max(0, NEED_WINS - st.prog) + '판') + '</span></div>' +
        '<div class="track"><div class="fill" style="width:' +
          (st.rankIdx >= RANKS.length - 1 || st.examReady ? 100
            : Math.min(100, st.prog/NEED_WINS*100)) + '%"></div></div></div>' +
      '<div class="dex">' +
        '<div><span class="n">' + st.dexWords + '</span><span class="t">모은 단어</span></div>' +
        '<div><span class="n">' + st.dexKill + '</span><span class="t">찾은 한방</span></div>' +
        '<div class="hi"><span class="n">' + st.dexRare + '</span><span class="t">낯선 말</span></div>' +
      '</div>';
    if (!win && !st.undoUsed){
      h += st.ads
        ? '<div class="adslot"><span class="tag">리워드 광고 자리</span>' +
          '<button class="btn ghost wide" id="undo" style="margin-top:0">광고 보고 한 수 무르기</button></div>'
        : '<button class="btn ghost wide" id="undo">한 수 무르기</button>';
    }
    if (st.examReady){
      h += '<button class="btn wide" id="exam">' + RANKS[st.rankIdx+1] + ' 승급 시험 보기</button>';
    }
    h += '<button class="btn wide" id="again">' + (win ? '한 판 더' : '다시 두기') + '</button>' +
         '<button class="dexbtn" id="book">단어 도감 ' + dexCount().got + ' / ' +
           (dexCount().open2 ? dexCount().total : DEX_MAIN.length) + '</button>' +
         (platform.leaderboard.available()
            ? '<button class="dexbtn" id="rank">전국 순위 보기</button>' : '') +
         '<button class="dexbtn" id="toHome">메인으로</button></section>';
    lastResult = h;
    $('panel').innerHTML = h;
    bindResult();
    revealResult();
  }

  function bindResult(){
    if ($('undo')) $('undo').addEventListener('click', function(){
      st.undoUsed = true; st.over = false;
      document.querySelector('.app').classList.remove('done');
      while (st.moves.length && st.moves[st.moves.length-1].who === 'me'){
        var m = st.moves.pop();
        delete st.used[m.w]; st.usedFirst[m.w[0]]--;
        $('kibo').removeChild($('kibo').lastChild);
      }
      startTurn(); st.started = true; tick();
    });
    $('again').addEventListener('click', function(){ SFX.tap(); startGame(false); });
    if ($('exam')) $('exam').addEventListener('click', function(){ SFX.tap(); startGame(true); });
    if ($('book')) $('book').addEventListener('click', function(){ SFX.tap(); bookFrom = 'game'; showBook(); });
    if ($('rank')) $('rank').addEventListener('click', function(){ SFX.tap(); platform.leaderboard.open(); });
    if ($('toHome')) $('toHome').addEventListener('click', function(){ SFX.tap(); go('home'); });
  }

  /* 마지막 수가 살짝 보이는 자리에 성적표를 놓는다 */
  function revealResult(){
    var sec = $('panel').querySelector('.over'); if (!sec) return;
    var go = function(){
      var y = sec.getBoundingClientRect().top + (window.pageYOffset || 0) - 120;
      y = Math.max(0, y);
      window.scrollTo(0, y);
    };
    go();
    setTimeout(go, 0);
    setTimeout(go, 90);
    setTimeout(go, 280);
  }

  /* ── 단어 도감 ───────────────────────────
     수집 대상은 '끝내는 글자'다. 사전 전체에서 이을 말이 없는 글자가 201개인데,
     그중 흔한 말로 닿을 수 있는 건 15개뿐이라 도감 크기로 딱 맞다. */
  function dexCount(){
    var main = 0, hard = 0, extra = 0;
    for (var c in st.dex){
      if (DEX_MAIN.some(function(m){ return m.s === c; })) main++;
      else if (DEX_HARD.some(function(m){ return m.s === c; })) hard++;
      else extra++;
    }
    return {
      main:main, hard:hard, extra:extra,
      open2: main >= DEX_MAIN.length,                 /* 1권을 채워야 2권이 열린다 */
      got: main + hard, total: DEX_MAIN.length + DEX_HARD.length
    };
  }

  function cells(list, locked){
    return list.map(function(m){
      var mine = st.dex[m.s];
      if (mine) return '<div class="cell got"><span class="s">' + m.s + '</span><span class="w">' + mine + '</span></div>';
      if (locked) return '<div class="cell miss lock"><span class="s">?</span><span class="w">잠김</span></div>';
      return '<div class="cell miss"><span class="s">' + m.s + '</span><span class="w">? ? ?</span></div>';
    }).join('');
  }

  function showBook(){
    go('book');
    var cnt = dexCount(), main = cnt.main, extra = cnt.extra;

    var rares = st.rareList.slice(-24).reverse();
    var h = '<section class="book">' +
      '<h2>단 어 도 감</h2>' +
      '<p class="sub">끝말잇기에서 이을 말이 없는 글자를 <b>끝내는 글자</b>라고 합니다.<br>' +
      '사전 전체에 201개가 있습니다. 그중 모을 만한 것이 ' +
      DEX_MAIN.length + ' + ' + DEX_HARD.length + '개, 나머지는 고어·방언으로만 닿습니다.</p>' +
      '<p class="sect">1권 · 흔한 말로 닿는 글자 ' + main + ' / ' + DEX_MAIN.length + '</p>' +
      '<div class="grid">' + cells(DEX_MAIN, false) + '</div>' +
      '<p class="sect">2권 · 아는 사람만 아는 글자 ' +
        (cnt.open2 ? cnt.hard + ' / ' + DEX_HARD.length : '잠김') + '</p>' +
      (cnt.open2
        ? '<div class="grid">' + cells(DEX_HARD, false) + '</div>'
        : '<div class="grid">' + cells(DEX_HARD, true) + '</div>' +
          '<p class="empty">1권을 다 채우면 열립니다.</p>') +
      (extra ? '<div class="bookrow"><span>그 밖에 찾아낸 글자</span><b>' + extra + '</b></div>' : '') +
      '<p class="sect">한글이가 모르던 말 ' + st.dexRare + '</p>' +
      (rares.length
        ? '<div class="chips">' + rares.map(function(w){ return '<span class="chip">' + w + '</span>'; }).join('') + '</div>'
        : '<p class="empty">아직 없습니다. 한글이는 흔한 명사 24,912개만 압니다. 그 밖의 말을 두면 여기 쌓입니다.</p>') +
      '<div class="bookrow"><span>최장 수순</span><b>' + st.best + '수</b></div>' +
      '<div class="bookrow"><span>지금까지 둔 말</span><b>' + st.dexWords + '</b></div>' +
      '<div class="bookrow"><span>이긴 한방</span><b>' + st.dexKill + '</b></div>' +
      '<button class="btn wide" id="back">돌아가기</button>' +
    '</section>';
    $('panel').innerHTML = h;
    window.scrollTo(0, 0);
    $('back').addEventListener('click', function(){
      SFX.tap();
      document.querySelector('.app').classList.remove('book');
      if (bookFrom === 'home'){ go('home'); }
      else { screen = 'game'; finishScreen(); }
    });
  }

  var lastResult = null;
  function finishScreen(){
    if (!lastResult) return;
    $('panel').innerHTML = lastResult;
    bindResult();
    revealResult();
  }

  /* ── 화면 ────────────────────────────────
     토스 심사: 진입 즉시 팝업 없이 첫 화면이 떠야 하고, 모든 화면에서 나갈 수 있어야 하며,
     안드로이드 백버튼이 뒤로가기나 종료로 동작해야 한다. */
  var screen = 'home', bookFrom = 'game';
  function go(name){
    screen = name;
    var app = document.querySelector('.app');
    app.classList.remove('s-home','s-set','book');
    if (name === 'home'){ app.classList.add('s-home'); renderHome(); }
    else if (name === 'set'){ app.classList.add('s-set'); renderSettings(); }
    else if (name === 'book'){ app.classList.add('book'); }
    window.scrollTo(0, 0);
    try{
      if (name === 'home') history.replaceState({s:'home'}, '');
      else history.pushState({s:name}, '');
    }catch(e){}
  }
  window.addEventListener('popstate', function(){
    if (screen === 'home') return;          /* 실제 미니앱에서는 여기서 종료 확인 모달 */
    if (screen === 'book' && bookFrom === 'game'){ screen = 'game'; finishScreen(); return; }
    go('home');
  });

  function renderHome(){
    var cnt = dexCount();
    var nextRank = st.rankIdx < RANKS.length - 1 ? RANKS[st.rankIdx + 1] : null;
    $('home').innerHTML =
      '<div class="hero"><h1>끝말잇기<br>대국</h1>' +
        '<p>표준국어대사전 281,389단어</p></div>' +
      '<div class="myrank">' +
        '<div class="top"><span class="g">' + RANKS[st.rankIdx] + '<small>나</small></span>' +
          '<span class="r">한글이 ' + aiRank() + '<br>' +
          (!nextRank ? '최고 단 · 한글이가 더는 물러서지 않습니다'
            : st.examReady ? '승급 시험 응시 가능'
            : nextRank + '까지 ' + Math.max(0, NEED_WINS - st.prog) + '판') +
          '</span></div>' +
        '<div class="track"><div class="fill" style="width:' +
          (!nextRank || st.examReady ? 100 : Math.min(100, st.prog / NEED_WINS * 100)) + '%"></div></div>' +
        '<div class="stats">' +
          '<div class="rec"><span class="n">' + st.best + '</span><span class="t">최장 수순</span></div>' +
          '<div><span class="n">' + st.dexWords + '</span><span class="t">둔 말</span></div>' +
          '<div><span class="n">' + st.dexKill + '</span><span class="t">이긴 한방</span></div>' +
          '<div class="hi"><span class="n">' + st.dexRare + '</span><span class="t">낯선 말</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="menu">' +
        '<button class="btn" id="hStart">대국 시작</button>' +
        (st.examReady && nextRank ? '<button class="btn ghost" id="hExam">' + nextRank + ' 승급 시험</button>' : '') +
        '<button class="dexbtn" id="hBook">단어 도감 ' + cnt.got + ' / ' +
          (cnt.open2 ? cnt.total : DEX_MAIN.length) + '</button>' +
        '<button class="dexbtn" id="hSet">설정</button>' +
      '</div>';
    $('hStart').addEventListener('click', function(){ SFX.tap(); startGame(false); });
    if ($('hExam')) $('hExam').addEventListener('click', function(){ SFX.tap(); startGame(true); });
    $('hBook').addEventListener('click', function(){ SFX.tap(); bookFrom = 'home'; showBook(); });
    $('hSet').addEventListener('click', function(){ SFX.tap(); go('set'); });
  }

  function renderSettings(){
    function row(id, label, desc, on){
      return '<div class="setrow"><div><div class="lbl">' + label + '</div>' +
        '<div class="desc">' + desc + '</div></div>' +
        '<button class="sw" id="' + id + '" role="switch" aria-checked="' + (on ? 'true' : 'false') +
        '" aria-label="' + label + '"><i></i></button></div>';
    }
    $('settings').innerHTML =
      '<div class="hero" style="padding-block:34px 4px"><h1 style="font-size:23px">설 정</h1></div>' +
      row('swSound', '효과음', '돌 놓는 소리, 초읽기, 승패', st.sound) +
      row('swHaptic', '진동', '수를 둘 때 짧게 울립니다', st.haptic) +
      row('swAds', '광고', st.ads
            ? '힌트·무르기는 리워드, 전면은 ' + AD_EVERY + '판에 한 번'
            : '꺼짐 — 힌트는 한 판에 한 번 무료입니다', st.ads) +
      '<p class="sect">기록</p>' +
      '<div class="bookrow"><span>최장 수순</span><b>' + st.best + '수</b></div>' +
      '<div class="bookrow"><span>둔 말</span><b>' + st.dexWords + '</b></div>' +
      '<div class="bookrow"><span>끝내는 글자</span><b>' + dexCount().got + ' / ' +
        (dexCount().open2 ? dexCount().total : DEX_MAIN.length) + '</b></div>' +
      '<div class="bookrow"><span>급수</span><b>' + RANKS[st.rankIdx] + '</b></div>' +
      '<div class="bookrow"><span>본 힌트</span><b>' + st.hintsUsed + '</b></div>' +
      '<button class="dexbtn" id="sReset" style="margin-top:22px">기록 지우기</button>' +
      '<button class="btn wide" id="sBack">돌아가기</button>';
    function toggle(id, key){
      $(id).addEventListener('click', function(){
        st[key] = !st[key];
        this.setAttribute('aria-checked', st[key] ? 'true' : 'false');
        save();
        if (key === 'sound' && st.sound) SFX.tap();
        if (key === 'haptic' && st.haptic) buzz(18);
      });
    }
    toggle('swSound', 'sound');
    toggle('swHaptic', 'haptic');
    toggle('swAds', 'ads');
    $('swAds').addEventListener('click', function(){ renderSettings(); });
    $('sReset').addEventListener('click', function(){
      if (this.dataset.armed){
        try{ platform.storage.remove(SAVE_KEY); }catch(e){}
        st.rankIdx = 0; st.prog = 0; st.dexWords = 0; st.dexKill = 0; st.dexRare = 0;
        st.dex = {}; st.rareList = []; st.examReady = false; st.difficulty = 0.35; st.best = 0;
        save(); go('home');
      } else {
        this.dataset.armed = '1';
        this.textContent = '정말 지울까요? 한 번 더 누르세요';
      }
    });
    $('sBack').addEventListener('click', function(){ SFX.tap(); go('home'); });
  }

  /* 대국 시작 지점은 여기 하나로 모은다. 전면광고는 이 길목에서만 끼어든다. */
  function startGame(exam){
    st.exam = !!exam;
    if (st.ads && !exam && st.sinceAd >= AD_EVERY){
      st.sinceAd = 0; save();
      showInterstitial(reset);
      return;
    }
    reset();
  }

  function showInterstitial(done){
    clearInterval(st.timer);
    var app = document.querySelector('.app');
    app.classList.remove('s-home','s-set','book','done');
    app.classList.add('s-ad');
    screen = 'ad';
    var left = 5;
    $('panel').innerHTML =
      '<section class="full"><span class="tag">전면 광고 자리</span>' +
      '<div class="frame"><span class="big">광고</span>' +
      '<span class="small" id="adCnt">' + left + '초 후 닫을 수 있습니다</span></div>' +
      '<button class="btn wide" id="adClose" disabled>닫기</button></section>';
    window.scrollTo(0, 0);
    var iv = setInterval(function(){
      left--;
      var c = $('adCnt'), b = $('adClose');
      if (c) c.textContent = left > 0 ? left + '초 후 닫을 수 있습니다' : '광고가 끝났습니다';
      if (left <= 0){
        clearInterval(iv);
        if (b){ b.disabled = false; b.addEventListener('click', function(){ SFX.tap(); app.classList.remove('s-ad'); done(); }); }
      }
    }, 1000);
  }

  function reset(){
    clearInterval(st.timer);
    st.moves=[]; st.used={}; st.usedFirst={}; st.over=false;
    st.undoUsed=false; st.started=false; st.left=30; st.freeHint=true;
    document.querySelector('.app').classList.remove('done');
    window.scrollTo(0,0);
    $('kibo').innerHTML = '<div class="spacer"></div>';
    $('myRank').textContent = RANKS[st.rankIdx];
    $('aiRank').textContent = aiRank();
    var app = document.querySelector('.app');
    app.classList.remove('book','s-home','s-set','s-ad');
    screen = 'game';
    app.classList.toggle('exam', st.exam);
    var tag = $('examTag');
    if (tag) tag.textContent = st.exam ? '승 급 시 험' : '';
    var opener, guard = 0;
    do { opener = TIER[0][Math.floor(Math.random()*TIER[0].length)]; guard++; }
    while (guard < 200 && (aiOptions(opener).length < 5 || remaining(opener) < 60));
    /* 징이 울리는 동안 지난 판의 성적표가 남아 보이지 않게 비운다 */
    $('panel').innerHTML = '<div class="turn"><span class="need">' +
      (st.exam ? '승급 시험을 시작합니다' : '대국을 시작합니다') + '</span></div>';
    SFX.start(); buzz(20);
    setTimeout(function(){ place(opener, 'ai'); startTurn(); }, 420);
  }

  var NOTE = '<div>' +
    '<b>사전이 진짜입니다.</b> 표준국어대사전 계열 2~4음절 <b>281,389개</b>를 통째로 넣었습니다. ' +
    '「유보」「유륜」「유성」「유한」 전부 통합니다. 서버도 API도 쓰지 않는 <b>완전 오프라인</b>입니다.' +
    '<hr>' +
    '<b>한글이는 24,912개만 압니다.</b> 명사 사전으로 거른 말들이라 「내가」「거야」 같은 건 두지 않습니다. ' +
    '한글이가 모르는 말을 두면 금색 돌로 놓이고 도감의 <b>낯선 말</b>에 쌓입니다. ' +
    '그 말로 길이 끊기면 그대로 이깁니다.' +
    '<hr>' +
    '<b>질 때는 고민합니다.</b> 처음엔 이길 때든 질 때든 620밀리초로 똑같이 뒀더니, ' +
    '갑자기 못 두는 순간이 그대로 들통났습니다. 지금은 세 가지가 걸려 있습니다 — ' +
    '<b>①</b> 질 때는 반드시 오래 생각합니다(2.7~4.2초, 「물」… 「물」… 하고 되뇝니다). ' +
    '<b>①-1</b> 그리고 <b>빡빡한 자리에서만 막힙니다.</b> 실측해보니 한글이가 둘 수 있는 말이 ' +
    '61개를 넘는 국면이 <b>62.8%</b>인데, 거기서 포기하면 그 자체가 들통납니다. ' +
    '지금은 4개 이하면 그대로, 13~30개면 40%로, <b>61개가 넘으면 아예 막히지 않습니다.</b> ' +
    '<b>②</b> 그런데 <b>오래 생각하고도 두는 경우가 더 많습니다.</b> 이게 없으면 뜸들이는 것 자체가 신호가 됩니다. ' +
    '<b>③</b> 둘 수 있는 말이 적을수록, 그리고 지고 있을수록 평소에도 더 뜸을 들입니다. 실측하면 <b>고민했을 때 지는 비율이 11~31%</b>입니다. 대부분은 뜸들이고 나서 둡니다.' +
    '<hr>' +
    '<b>급수가 한글이의 바닥을 정합니다.</b> 난이도가 승패만 따라 움직이면 승률이 59%에 수렴해서 ' +
    '<b>오래 한 사람은 누구나 3단</b>이 됩니다. 그런 급수는 자랑이 안 됩니다. ' +
    '그래서 승급할 때마다 한글이가 내려갈 수 있는 바닥도 같이 올라갑니다 — ' +
    '18급 0.10 / 10급 0.31 / 1급 0.65 / 3단 0.82. 초반은 완만하고 위로 갈수록 가팔라서 ' +
    '<b>어딘가에서 반드시 막힙니다.</b> 막히는 자리가 곧 실력입니다.' +
    '<hr>' +
    '<b>어휘가 모자라서 지는 일은 없습니다.</b> 처음엔 난이도로 한글이의 어휘를 잘라봤는데, ' +
    '「스포츠」 한 번에 2수 만에 끝나버렸습니다. 어휘 구멍으로 지는 건 실력이 아니라 사고입니다. ' +
    '그래서 한글이는 <b>늘 24,912개를 다 쓰고</b>, 난이도는 두 가지만 정합니다 — ' +
    '<b>어느 단의 말을 고를지</b>(쉬울수록 흔한 말), 그리고 <b>말이 안 떠오를 확률</b>(최대 14%, 8수 이후에만). ' +
    '사람이 한 번씩 막히는 것과 같은 모양입니다.' +
    '<hr>' +
    '<b>초반 8수 안에는 한방단어를 쓸 수 없습니다.</b> 「스포츠」처럼 사전에 이을 말이 없는 말이 ' +
    '첫 수에 나오면 대국이 성립하지 않습니다. 8수가 지나면 그대로 승리입니다.' +
    '<hr>' +
    '<b>AI가 하는 일.</b> 열린 어휘 안에서 이을 말을 뽑고, 각 수가 상대에게 남기는 선택지 수를 ' +
    '사전 전체 기준으로 셉니다. 여지가 많은 수를 둘지 좁은 수를 둘지도 난이도가 정합니다. ' +
    '이기면 0.09씩 조이고 지면 0.13씩 풉니다. 푸는 쪽이 빠른 건 연패가 이탈로 직결되기 때문입니다.' +
    '<hr>' +
    '<b>두음법칙.</b> 「계란」 다음에 「난관」이 됩니다. 실제 끝말잇기의 다툼이 여기서 나서, ' +
    '없으면 가짜처럼 느껴집니다.' +
    '</div>';

  function boot(){
    load();
    $('myRank').textContent = RANKS[st.rankIdx];
    $('noteBody').innerHTML = NOTE;
    go('home');
  }
  if (typeof window !== 'undefined' && window.__wc) {
    Object.assign(window.__wc, {st:st, go:go, finish:finish, place:place,
      showBook:showBook, DEX:DEX_MAIN, HARD:DEX_HARD, RANKS:RANKS, reset:reset});
  }
  boot();
}
