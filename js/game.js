// 이수 퀘스트 — 필드, 퀴즈 배틀, 성장, 업적, 저장
'use strict';
(() => {
  const SAVE_KEY = 'isu-quest-save-v2';
  const TILE = 32, VIEW_W = 640, VIEW_H = 360, RES = 2;
  const STEP_MS = 140;
  const DEBUG = new URLSearchParams(location.search).has('debug');
  const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

  const $ = (s) => document.querySelector(s);
  const app = $('#app'), canvas = $('#field'), ui = $('#ui'), hud = $('#hud'), toasts = $('#toasts');
  const ctx = canvas.getContext('2d');
  canvas.width = VIEW_W * RES; canvas.height = VIEW_H * RES;
  ctx.scale(RES, RES);

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const stats = () => RULES.statsAt(S.level);

  let S = null;        // 저장되는 게임 상태
  let mode = 'title';  // title | field | battle | menu | modal
  let map = null;      // 현재 스테이지
  let B = null;        // 진행 중인 배틀
  const player = { x: 0, y: 0, px: 0, py: 0, fromX: 0, fromY: 0, t: 0, dir: 'down', moving: false, bumpCd: 0 };
  const held = [];

  // ================= 상태와 저장 =================

  function newState(name) {
    return {
      v: 2, name, level: 1, exp: 0, focus: RULES.statsAt(1).maxFocus,
      bag: { highlighter: 2, pass: 1, energy: 1, choco: 1 },
      stage: -1, pos: null, cleared: {}, done: {}, opened: {},
      stats: { correct: 0, bestStreak: 0, fast: 0, sharp: 0, chests: 0, items: 0 },
      ach: {}, playMs: 0, graduated: false,
    };
  }

  function save() {
    if (!S) return;
    if (map) S.pos = { x: player.x, y: player.y, dir: player.dir };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* 저장 불가 환경이면 저장 없이 진행 */ }
  }

  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      return s && s.v === 2 ? s : null;
    } catch (e) { return null; }
  }

  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 무시 */ } }

  function addItems(items) { for (const [id, n] of Object.entries(items)) S.bag[id] = (S.bag[id] || 0) + n; }
  const itemsText = (items) => Object.entries(items).map(([id, n]) => `${ITEMS[id].icon} ${ITEMS[id].name} ×${n}`).join(', ');

  function rollLoot(n) {
    const got = {};
    for (let i = 0; i < n; i++) {
      const [id] = LOOT[U.weighted(LOOT.map((l) => l[1]))];
      got[id] = (got[id] || 0) + 1;
    }
    return got;
  }

  // 경험치를 더하고 오른 레벨 수를 돌려준다. 레벨이 오르면 집중력 완전 회복
  function gainExp(n) {
    let ups = 0;
    S.exp += n;
    while (S.exp >= RULES.expToNext(S.level)) { S.exp -= RULES.expToNext(S.level); S.level++; ups++; }
    if (ups) S.focus = stats().maxFocus;
    return ups;
  }

  function checkAch(ev) {
    for (const a of ACHIEVEMENTS) {
      if (S.ach[a.id]) continue;
      let ok = false;
      try { ok = a.test(S, ev); } catch (e) { ok = false; }
      if (ok) { S.ach[a.id] = Date.now(); toast(`🏆 업적 달성! ${a.icon} ${a.name}`, 'ach'); }
    }
  }

  // ================= 알림 =================

  let lastToast = { text: '', at: 0 };
  function toast(text, kind = '') {
    lastToast = { text, at: performance.now() };
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    toasts.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3000);
  }
  function softToast(text) { if (lastToast.text !== text || performance.now() - lastToast.at > 1500) toast(text); }

  // ================= 맵 =================

  const LECT = { 1: 0, 2: 1, 3: 2, F: 3 }, GATE = { a: 0, b: 1, c: 2 };

  function loadStage(i, pos) {
    const st = STAGES[i], rows = st.map;
    map = { st, rows, w: rows[0].length, h: rows.length, lecPos: [] };
    let start = { x: 1, y: 1 };
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === 'S') start = { x, y };
      if (ch in LECT) map.lecPos.push({ x, y, lec: st.lectures[LECT[ch]] });
    }));
    const p = pos || { ...start, dir: 'down' };
    Object.assign(player, { x: p.x, y: p.y, dir: p.dir || 'down', px: p.x * TILE, py: p.y * TILE, moving: false, t: 0 });
  }

  const tileAt = (x, y) => (y < 0 || y >= map.h || x < 0 || x >= map.w ? '#' : map.rows[y][x]);
  const lecOf = (ch) => map.st.lectures[LECT[ch]];
  const gateOpen = (ch) => !!S.cleared[map.st.lectures[GATE[ch]].id];

  const SOLID = new Set(['#', 'T', 'R', 'f', '~', 'C', 'H', 's']);

  function isBlocked(x, y) {
    const ch = tileAt(x, y);
    if (SOLID.has(ch)) return true;
    if (ch in GATE) return !gateOpen(ch);
    if (ch in LECT) return !S.cleared[lecOf(ch).id];
    return false;
  }

  function bump(x, y) {
    const ch = tileAt(x, y);
    if (ch in LECT) { const lec = lecOf(ch); if (!S.cleared[lec.id]) startBattle(lec); return; }
    if (ch in GATE) { softToast('🔒 앞 강의를 이수해야 열리는 문이다.'); return; }
    if (ch === 'C') { openChest(x, y); return; }
    if (ch === 'H') { rest(); return; }
    if (ch === 's') softToast(`🪧 「${map.st.place}」 강의 3개를 차례로 이수하고 기말고사에 도전하자! (Tab 월드맵)`);
  }

  function openChest(x, y) {
    const key = `${map.st.id}:${x},${y}`;
    if (S.opened[key]) { softToast('빈 상자다.'); return; }
    S.opened[key] = true;
    S.stats.chests++;
    const got = rollLoot(Math.random() < 0.4 ? 2 : 1);
    addItems(got);
    toast(`🎁 상자를 열었다! ${itemsText(got)}`);
    checkAch();
    save();
  }

  function rest() {
    const max = stats().maxFocus;
    if (S.focus >= max) softToast('☕ 집중력은 이미 가득하다. (저장 완료)');
    else { S.focus = max; toast('☕ 커피 한 잔! 집중력이 모두 회복되었다. (저장 완료)'); }
    save();
    updateHUD();
  }

  // ================= 필드 갱신과 그리기 =================

  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

  function updateField(dt) {
    player.bumpCd -= dt;
    if (player.moving) {
      player.t += dt;
      const k = Math.min(1, player.t / STEP_MS);
      player.px = (player.fromX + (player.x - player.fromX) * k) * TILE;
      player.py = (player.fromY + (player.y - player.fromY) * k) * TILE;
      if (k < 1) return;
      player.moving = false;
    }
    const dir = held[held.length - 1];
    if (!dir) return;
    player.dir = dir;
    const nx = player.x + DIRS[dir][0], ny = player.y + DIRS[dir][1];
    if (isBlocked(nx, ny)) {
      if (player.bumpCd <= 0) { player.bumpCd = 450; bump(nx, ny); }
      return;
    }
    Object.assign(player, { fromX: player.x, fromY: player.y, x: nx, y: ny, t: 0, moving: true });
  }

  function emoji(ch, x, y, size) {
    ctx.font = `${size}px ${EMOJI_FONT}`;
    ctx.fillStyle = '#000';  // 반투명 fillStyle이 남아 있으면 이모지도 흐려진다
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, x, y);
  }

  // ---------- 카툰풍 타일 그리기 ----------

  const INK = '#3d2c4e';
  const UI_FONT = '"Jua", "Malgun Gothic", sans-serif';
  const hash = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }
  function box(x, y, w, h, r, fill, lw = 2) {
    rr(x, y, w, h, r);
    ctx.fillStyle = fill; ctx.fill();
    if (lw) { ctx.lineWidth = lw; ctx.strokeStyle = INK; ctx.stroke(); }
  }
  function blob(x, y, r, fill, lw = 2) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    if (lw) { ctx.lineWidth = lw; ctx.strokeStyle = INK; ctx.stroke(); }
  }
  function shadow(x, y, rx, ry) {
    ctx.fillStyle = 'rgba(61,44,78,.18)';
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  }

  const isPathCh = (ch) => ch === '=' || ch === 'S' || ch === 'B';
  // 강의·문 타일은 좌우가 길이면 바닥도 길로 그린다
  const groundIsPath = (x, y, ch) => isPathCh(ch) || ((ch in LECT || ch in GATE) && (isPathCh(tileAt(x - 1, y)) || isPathCh(tileAt(x + 1, y))));

  function drawGround(x, y, sx, sy, ch) {
    const th = map.st.theme, h = hash(x, y);
    ctx.fillStyle = (x + y) % 2 ? th.floor : th.floor2;
    ctx.fillRect(sx, sy, TILE, TILE);
    if (groundIsPath(x, y, ch)) {
      ctx.fillStyle = th.path;
      const up = groundIsPath(x, y - 1, tileAt(x, y - 1)), down = groundIsPath(x, y + 1, tileAt(x, y + 1));
      rr(sx - 1, sy + (up ? 0 : 4), TILE + 2, TILE - (up ? 0 : 4) - (down ? 0 : 4), up || down ? 0 : 6);
      ctx.fill();
      ctx.fillStyle = 'rgba(160,110,60,.25)';
      ctx.beginPath(); ctx.arc(sx + 6 + (h % 18), sy + 10 + (h % 11), 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 22 - (h % 9), sy + 22 - (h % 7), 1.2, 0, Math.PI * 2); ctx.fill();
      return;
    }
    // 풀 무늬
    if (h % 5 === 0) {
      ctx.strokeStyle = 'rgba(60,120,60,.35)'; ctx.lineWidth = 1.5;
      const gx = sx + 6 + (h % 20), gy = sy + 12 + (h % 14);
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx - 2, gy - 4); ctx.moveTo(gx + 3, gy); ctx.lineTo(gx + 4, gy - 5); ctx.stroke();
    }
  }

  function drawTree(sx, sy, h, dense) {
    const th = map.st.theme;
    shadow(sx + 16, sy + 28, 12, 4);
    box(sx + 13, sy + 18, 6, 11, 2, '#b57a48');
    const r = dense ? 13 : 11 + (h % 2);
    blob(sx + 16, sy + 12, r, th.tree);
    blob(sx + 9 + (h % 3), sy + 15, r * 0.55, th.tree, 0);
    ctx.fillStyle = th.tree2;
    ctx.beginPath(); ctx.arc(sx + 12, sy + 7, r * 0.35, 0, Math.PI * 2); ctx.fill();
  }

  function drawWater(x, y, sx, sy, now) {
    const th = map.st.theme;
    ctx.fillStyle = th.water; ctx.fillRect(sx, sy, TILE, TILE);
    const wet = (c) => c === '~' || c === 'B';
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    if (!wet(tileAt(x, y - 1))) { rr(sx, sy, TILE, 4, 2); ctx.fill(); }
    if (!wet(tileAt(x - 1, y))) ctx.fillRect(sx, sy, 3, TILE);
    if (!wet(tileAt(x + 1, y))) ctx.fillRect(sx + TILE - 3, sy, 3, TILE);
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2;
    const o = Math.sin(now / 500 + x + y) * 3;
    ctx.beginPath(); ctx.arc(sx + 11 + o, sy + 16, 4, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx + 22 - o, sy + 25, 3.5, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  }

  function drawTile(x, y, sx, sy, now) {
    const ch = tileAt(x, y), th = map.st.theme, h = hash(x, y);
    if (ch === '~') { drawWater(x, y, sx, sy, now); return; }
    if (ch === 'B') {
      drawWater(x, y, sx, sy, now);
      box(sx - 1, sy + 3, TILE + 2, TILE - 6, 2, '#d39a5e');
      ctx.strokeStyle = 'rgba(61,44,78,.45)'; ctx.lineWidth = 1.5;
      for (let i = 6; i < TILE; i += 6) { ctx.beginPath(); ctx.moveTo(sx + i, sy + 4); ctx.lineTo(sx + i, sy + TILE - 4); ctx.stroke(); }
      return;
    }
    drawGround(x, y, sx, sy, ch);
    if (ch === '#' || ch === 'T') { drawTree(sx, sy, h, ch === '#'); return; }
    if (ch === ',') {
      for (let i = 0; i < 3; i++) {
        const fx = sx + 6 + ((h >> (i * 3)) % 20), fy = sy + 7 + ((h >> (i * 4 + 2)) % 18);
        ctx.fillStyle = th.deco[(h + i) % th.deco.length];
        for (let p = 0; p < 5; p++) { const a = (p / 5) * Math.PI * 2; ctx.beginPath(); ctx.arc(fx + Math.cos(a) * 2.4, fy + Math.sin(a) * 2.4, 1.8, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#ffcf3f'; ctx.beginPath(); ctx.arc(fx, fy, 1.4, 0, Math.PI * 2); ctx.fill();
      }
    } else if (ch === '"') {
      ctx.fillStyle = th.tree;
      for (let i = 0; i < 3; i++) {
        const gx = sx + 6 + i * 9, gy = sy + 24 - (i % 2) * 6;
        ctx.beginPath(); ctx.moveTo(gx - 4, gy); ctx.quadraticCurveTo(gx - 3, gy - 9, gx, gy - 12); ctx.quadraticCurveTo(gx + 2, gy - 6, gx + 4, gy); ctx.closePath(); ctx.fill();
        ctx.lineWidth = 1.2; ctx.strokeStyle = INK; ctx.stroke();
      }
    } else if (ch === 'R') {
      shadow(sx + 16, sy + 27, 12, 4);
      ctx.beginPath(); ctx.ellipse(sx + 16, sy + 19, 12, 9, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#c3c7d1'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
      ctx.fillStyle = '#e6e8ee'; ctx.beginPath(); ctx.ellipse(sx + 12, sy + 15, 4, 2.5, -0.4, 0, Math.PI * 2); ctx.fill();
    } else if (ch === 'f') {
      box(sx - 1, sy + 13, TILE + 2, 4, 1, '#d9965a', 1.5);
      box(sx - 1, sy + 21, TILE + 2, 4, 1, '#d9965a', 1.5);
      box(sx + 4, sy + 9, 5, 19, 2, '#c98447', 1.5);
      box(sx + 23, sy + 9, 5, 19, 2, '#c98447', 1.5);
    } else if (ch === 's') {
      shadow(sx + 16, sy + 28, 8, 3);
      box(sx + 14, sy + 14, 4, 15, 1, '#b57a48');
      box(sx + 5, sy + 5, 22, 13, 3, '#f0b878');
      ctx.strokeStyle = 'rgba(61,44,78,.55)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx + 9, sy + 10); ctx.lineTo(sx + 23, sy + 10); ctx.moveTo(sx + 9, sy + 14); ctx.lineTo(sx + 19, sy + 14); ctx.stroke();
    } else if (ch in GATE) {
      if (!gateOpen(ch)) {
        box(sx + 1, sy + 1, 14, 30, 3, '#c98447');
        box(sx + 17, sy + 1, 14, 30, 3, '#c98447');
        box(sx + 9, sy + 11, 14, 12, 4, '#ffd95e');
        emoji('🔒', sx + 16, sy + 17, 11);
      }
    } else if (ch in LECT) {
      const lec = lecOf(ch);
      if (S.cleared[lec.id]) {
        ctx.beginPath(); ctx.ellipse(sx + 16, sy + 24, 11, 4, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#d7f5e6'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = INK; ctx.stroke();
        emoji('🚩', sx + 17, sy + 15, 16);
      } else {
        const bob = Math.sin(now / 280 + x) * 2.5;
        ctx.beginPath(); ctx.ellipse(sx + 16, sy + 26, lec.final ? 16 : 13, 5, 0, 0, Math.PI * 2);
        ctx.fillStyle = lec.final ? '#ff9a9a' : '#ffd1e0'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
        if (lec.final) {
          ctx.fillStyle = 'rgba(255,90,90,.18)';
          ctx.beginPath(); ctx.arc(sx + 16, sy + 14, 20 + Math.sin(now / 200) * 2, 0, Math.PI * 2); ctx.fill();
        }
        emoji(lec.icon, sx + 16, sy + 14 + bob, lec.final ? 32 : 26);
        if (Math.abs(x - player.x) + Math.abs(y - player.y) <= 2) {
          box(sx + 22, sy - 12 + bob, 13, 14, 5, '#fffdf7', 1.5);
          ctx.fillStyle = '#ff4d6d'; ctx.font = `12px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('!', sx + 28.5, sy - 4.5 + bob);
        }
      }
    } else if (ch === 'C') {
      const open = S.opened[`${map.st.id}:${x},${y}`];
      const hop = open ? 0 : Math.max(0, Math.sin(now / 250 + x * 2)) * -2;
      shadow(sx + 16, sy + 28, 11, 3.5);
      box(sx + 5, sy + 14 + hop, 22, 13, 3, '#d98c45');
      if (open) {
        box(sx + 5, sy + 4, 22, 7, 3, '#eaa45c');
        ctx.fillStyle = '#6b3d1f'; ctx.fillRect(sx + 7, sy + 14, 18, 3);
      } else {
        box(sx + 4, sy + 8 + hop, 24, 9, 4, '#eaa45c');
        box(sx + 13, sy + 11 + hop, 6, 9, 2, '#ffd95e', 1.5);
        if (Math.floor(now / 400 + x) % 4 === 0) emoji('✨', sx + 27, sy + 6, 10);
      }
    } else if (ch === 'H') {
      shadow(sx + 16, sy + 28, 12, 4);
      box(sx + 3, sy + 13, 26, 15, 4, '#ffc2d4');
      box(sx + 1, sy + 6, 30, 8, 4, '#ff8fab');
      emoji('☕', sx + 16, sy + 20, 14);
    }
  }

  function drawPlayer(sx, sy, now) {
    const t = player.moving ? player.t / STEP_MS : 0;
    const bob = player.moving ? -Math.abs(Math.sin(t * Math.PI)) * 3 : Math.sin(now / 450) * 0.7;
    const y = sy + bob, dir = player.dir;
    shadow(sx + 16, sy + 29, 9, 3);
    const step = player.moving ? Math.sin(t * Math.PI * 2) * 2 : 0;
    box(sx + 10, y + 23 + step, 5, 6, 2, '#6b5a8a', 1.5);
    box(sx + 17, y + 23 - step, 5, 6, 2, '#6b5a8a', 1.5);
    box(sx + 8, y + 15, 16, 11, 5, '#7cb4ff');                    // 몸
    box(sx + 14, y + 16, 4, 6, 1, '#ffd95e', 1);                   // 넥타이
    blob(sx + 16, y + 10, 8.5, '#ffe3c8');                         // 얼굴
    if (dir !== 'up') {
      const ex = dir === 'left' ? -2 : dir === 'right' ? 2 : 0;
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.arc(sx + 13 + ex, y + 11, 1.3, 0, Math.PI * 2); ctx.arc(sx + 19 + ex, y + 11, 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,120,150,.55)';
      ctx.beginPath(); ctx.arc(sx + 11 + ex, y + 13.5, 1.8, 0, Math.PI * 2); ctx.arc(sx + 21 + ex, y + 13.5, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    box(sx + 10, y + 1, 12, 5, 2, INK, 0);                         // 학사모
    box(sx + 5, y - 1, 22, 4, 1, INK, 0);
    ctx.strokeStyle = '#ffd95e'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sx + 24, y + 1); ctx.lineTo(sx + 25, y + 7); ctx.stroke();
    blob(sx + 25, y + 8, 1.6, '#ffd95e', 0);
  }

  function drawLabel(text, cx, y, fill = '#fffdf7') {
    ctx.font = `11px ${UI_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 14;
    box(cx - w / 2, y - 9, w, 17, 8, fill, 1.5);
    ctx.fillStyle = INK; ctx.fillText(text, cx, y + 0.5);
  }

  // 좌측 하단 미니맵: 지형, 강의(분홍·빨강 = 미이수, 초록 = 이수), 상자(노랑), 카페(분홍), 현재 화면 범위, 내 위치
  function drawMinimap(camX, camY, now) {
    const th = map.st.theme, s = 3, pad = 6, top = 15;
    const w = map.w * s, h = map.h * s;
    const x0 = 8, y0 = VIEW_H - (h + pad * 2 + top) - 8;
    box(x0, y0, w + pad * 2, h + pad * 2 + top, 9, 'rgba(255,253,247,.95)', 2.5);
    ctx.font = `10px ${UI_FONT}`; ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`미니맵 · ${map.st.place}`, x0 + pad + 1, y0 + 10);
    const mx = x0 + pad, my = y0 + top + pad - 3;
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const ch = map.rows[y][x];
        let c = th.floor;
        if (ch === '#' || ch === 'T') c = th.tree;
        else if (ch === '~') c = th.water;
        else if (isPathCh(ch)) c = th.path;
        else if (ch === 'R') c = '#b4b8c2';
        else if (ch === 'f') c = '#d9965a';
        else if (ch in GATE) c = gateOpen(ch) ? th.path : '#ff6b6b';
        ctx.fillStyle = c;
        ctx.fillRect(mx + x * s, my + y * s, s, s);
      }
    }
    const dot = (tx, ty, r, fill) => {
      ctx.beginPath(); ctx.arc(mx + tx * s + s / 2, my + ty * s + s / 2, r, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = INK; ctx.stroke();
    };
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const ch = map.rows[y][x];
        if (ch === 'C' && !S.opened[`${map.st.id}:${x},${y}`]) dot(x, y, 1.8, '#ffd95e');
        else if (ch === 'H') dot(x, y, 1.8, '#ff9ec7');
      }
    }
    for (const p of map.lecPos) {
      if (S.cleared[p.lec.id]) dot(p.x, p.y, 2, '#3ddc97');
      else dot(p.x, p.y, p.lec.final ? 3.2 : 2.5, p.lec.final ? '#ff4d6d' : '#ff8fab');
    }
    ctx.strokeStyle = 'rgba(61,44,78,.75)'; ctx.lineWidth = 1;
    ctx.strokeRect(mx + (camX / TILE) * s, my + (camY / TILE) * s, (VIEW_W / TILE) * s, (VIEW_H / TILE) * s);
    dot(player.px / TILE, player.py / TILE, Math.floor(now / 300) % 2 ? 3 : 2.3, '#ffffff');
  }

  function drawField(now) {
    const mapW = map.w * TILE, mapH = map.h * TILE;
    let camX = player.px + TILE / 2 - VIEW_W / 2, camY = player.py + TILE / 2 - VIEW_H / 2;
    camX = Math.round(mapW <= VIEW_W ? (mapW - VIEW_W) / 2 : clamp(camX, 0, mapW - VIEW_W));
    camY = Math.round(mapH <= VIEW_H ? (mapH - VIEW_H) / 2 : clamp(camY, 0, mapH - VIEW_H));
    ctx.fillStyle = map.st.theme.floor; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const x0 = Math.floor(camX / TILE), y0 = Math.floor(camY / TILE);
    const py = player.moving ? Math.max(player.y, player.fromY) : player.y;
    // 위에서 아래로 그려서 아래쪽 나무가 위쪽을 덮게 한다. 플레이어는 자기 줄 차례에 그린다
    for (let y = y0 - 1; y <= y0 + Math.ceil(VIEW_H / TILE) + 1; y++) {
      for (let x = x0 - 1; x <= x0 + Math.ceil(VIEW_W / TILE) + 1; x++) drawTile(x, y, x * TILE - camX, y * TILE - camY, now);
      if (y === py) drawPlayer(player.px - camX, player.py - camY, now);
    }
    for (const p of map.lecPos) {
      if (S.cleared[p.lec.id] || Math.abs(p.x - player.x) + Math.abs(p.y - player.y) > 4) continue;
      drawLabel(`${p.lec.final ? '🔥 ' : ''}${p.lec.mob} Lv.${p.lec.level}`, p.x * TILE - camX + 16, p.y * TILE - camY - 20, p.lec.final ? '#ffd1d1' : '#fffdf7');
    }
    drawMinimap(camX, camY, now);
  }

  let hudHTML = '';
  function updateHUD() {
    if (!S || !map) { hud.innerHTML = ''; hudHTML = ''; return; }
    const st = stats(), next = RULES.expToNext(S.level);
    const lecs = map.st.lectures.map((l) => `<span title="${esc(l.name)}">${S.cleared[l.id] ? '✅' : l.final ? '🔥' : '⬜'}</span>`).join('');
    const html = `
      <div class="hud-l">
        <div class="hud-name">🎓 ${esc(S.name)} <b>Lv.${S.level}</b></div>
        <div class="bar focus"><i style="width:${(S.focus / st.maxFocus) * 100}%"></i><span>집중력 ${S.focus}/${st.maxFocus}</span></div>
        <div class="bar exp"><i style="width:${(S.exp / next) * 100}%"></i><span>EXP ${S.exp}/${next}</span></div>
      </div>
      <div class="hud-r">
        <div class="hud-stage">${map.st.icon} ${map.st.subject} · ${map.st.place}</div>
        <div class="hud-lecs">${lecs}</div>
        <div class="hud-btns"><button class="btn small" data-act="courses">🗺️ 월드맵 (Tab)</button><button class="btn small" data-act="menu">☰ 메뉴 (M)</button></div>
      </div>
      <div class="hud-help">방향키/WASD 이동 · 강의·상자·☕·🪧에 부딪히면 상호작용</div>`;
    if (html !== hudHTML) { hud.innerHTML = html; hudHTML = html; }
  }

  // ================= 퀴즈 배틀 =================

  function startBattle(lec) {
    mode = 'battle';
    held.length = 0;
    B = {
      lec, final: !!lec.final, progress: 0, combo: 0, maxCombo: 0, turn: 0, asked: 0, correct: 0,
      itemsUsed: 0, energy: false, seen: new Set(), phase: 'intro', q: null, removed: [],
      timing: false, tStart: 0, tLimit: 0, say: '', fx: '', float: null,
    };
    show();
    renderBattle();
  }

  function pickQuestion(d) {
    for (let i = 0; i < 15; i++) {
      const q = buildQuestion(B.lec, d);
      if (!B.seen.has(q.q)) { B.seen.add(q.q); return q; }
    }
    return buildQuestion(B.lec, d);
  }

  function startTimer(sec) {
    B.tLimit = sec * 1000 * (1 + stats().spd * 0.01);
    B.tStart = performance.now();
    B.timing = true;
  }

  function nextTurn() {
    if (B.progress >= B.lec.volume) { endBattle(true); return; }
    if (S.focus <= 0) { endBattle(false); return; }
    B.turn++;
    B.removed = [];
    B.picked = -1;
    if (B.turn % 3 === 0) {
      B.phase = 'revPick';
      B.cards = [1, 2, 3].map((d) => pickQuestion(d));
      B.say = '좋아, 이번엔 네가 문제를 내 봐!';
    } else {
      B.phase = 'ask';
      B.q = pickQuestion(U.weighted(B.lec.diff) + 1);
      B.asked++;
      B.say = U.pick(['자, 문제 나간다!', '이건 풀 수 있을까?', '집중해서 들어!', '다음 문제!']);
      startTimer(B.lec.time);
    }
    renderBattle();
  }

  function addProgress(base) {
    let gain = base;
    if (B.energy) { gain *= 2; B.energy = false; }
    gain = Math.max(1, Math.round(gain));
    B.progress = Math.min(B.lec.volume, B.progress + gain);
    B.combo++;
    B.maxCombo = Math.max(B.maxCombo, B.combo);
    B.correct++;
    S.stats.correct++;
    S.stats.bestStreak = Math.max(S.stats.bestStreak, B.combo);
    B.fx = 'hit';
    B.float = { text: `+${gain}`, kind: 'gain' };
    return gain;
  }

  function takeDamage(n) {
    S.focus = Math.max(0, S.focus - n);
    B.combo = 0;
    B.fx = 'hurt';
    B.float = { text: `−${n}`, kind: 'dmg' };
  }

  // i: 고른 선택지 (-1이면 시간 초과), viaPass: 패스권 사용
  function answer(i, viaPass) {
    if (B.phase !== 'ask') return;
    B.timing = false;
    const elapsed = performance.now() - B.tStart;
    B.picked = i;
    if (viaPass || i === B.q.answer) {
      const fast = !viaPass && elapsed < B.tLimit / 2;
      const crit = !viaPass && Math.random() < RULES.critChance;
      const comboMult = 1 + Math.min(B.combo, 5) * 0.1;
      const gain = addProgress(stats().int * RULES.diffMult[B.q.d] * comboMult * (fast ? 1.2 : 1) * (crit ? 1.5 : 1));
      if (!viaPass && elapsed < 3000) S.stats.fast++;
      B.result = { ok: true, text: viaPass ? `🎫 패스! 정답 처리, 진도 +${gain}` : `${crit ? '💥 치명타! ' : ''}${fast ? '⚡ 빠른 정답! ' : '⭕ 정답! '}진도 +${gain}` };
      B.say = viaPass ? '패스권이라니… 인정한다.' : U.pick(['크윽, 제법인데?', '정답이다…!', '이해가 빠르군!']);
    } else {
      const dmg = B.lec.attack;
      takeDamage(dmg);
      B.result = { ok: false, text: i < 0 ? `⏰ 시간 초과! 집중력 −${dmg}` : `❌ 오답! 집중력 −${dmg}` };
      B.say = i < 0 ? '시간 끝!' : '후후, 틀렸어!';
    }
    B.phase = 'askResult';
    checkAch();
    renderBattle();
  }

  function useItem(id) {
    if (!B || B.phase !== 'ask' || !S.bag[id] || B.itemsUsed >= RULES.itemLimit) return;
    if (id === 'highlighter') {
      const wrongs = B.q.choices.map((_, k) => k).filter((k) => k !== B.q.answer && !B.removed.includes(k));
      if (B.removed.length >= 2 || !wrongs.length) { softToast('더 지울 선택지가 없다.'); return; }
      B.removed.push(U.pick(wrongs));
    } else if (id === 'energy') {
      if (B.energy) { softToast('이미 에너지 드링크 효과가 대기 중이다.'); return; }
      B.energy = true;
    } else if (id === 'choco') {
      if (S.focus >= stats().maxFocus) { softToast('집중력이 이미 가득하다.'); return; }
      S.focus = Math.min(stats().maxFocus, S.focus + 30);
    }
    S.bag[id]--;
    B.itemsUsed++;
    S.stats.items++;
    if (id === 'pass') { answer(-1, true); return; }
    renderBattle();
  }

  function pickCard(k) {
    if (B.phase !== 'revPick') return;
    const q = B.cards[k];
    B.q = q;
    const gap = Math.max(0, B.lec.level - S.level) * 0.05;
    B.monsterWrong = Math.random() < Math.max(0.05, RULES.revWrong[q.d] - gap);
    B.monsterPick = B.monsterWrong ? q.trap : q.answer;
    B.cards.forEach((c, j) => { if (j !== k) B.seen.delete(c.q); });  // 고르지 않은 카드는 나중에 다시 나올 수 있게
    B.say = `정답은 ${'①②③④'[B.monsterPick]} "${q.choices[B.monsterPick]}" 이지!`;
    B.phase = 'revJudge';
    startTimer(12);
    renderBattle();
  }

  // saysRight: 플레이어가 "강의의 답이 맞았다"고 채점했는지 (null이면 시간 초과)
  function judge(saysRight) {
    if (B.phase !== 'revJudge') return;
    B.timing = false;
    B.asked++;
    const truth = !B.monsterWrong;
    if (saysRight !== null && saysRight === truth) {
      const base = truth ? stats().int * 0.5 : stats().int * 1.5 * RULES.diffMult[B.q.d];
      const gain = addProgress(base);
      if (!truth) S.stats.sharp++;
      B.result = { ok: true, text: truth ? `👍 인정! 강의의 답이 맞았다. 진도 +${gain}` : `🗡️ 지적 성공! 진도 +${gain}` };
      B.say = truth ? '당연하지, 내가 누군데.' : '으악, 들켰다…!';
    } else {
      const dmg = B.lec.attack;
      takeDamage(dmg);
      B.result = {
        ok: false,
        text: saysRight === null ? `⏰ 시간 초과! 집중력 −${dmg}`
          : truth ? `😳 억지 지적! 사실 강의의 답이 맞았다. 집중력 −${dmg}`
            : `🤦 속았다! 강의의 답은 틀렸다. 집중력 −${dmg}`,
      };
      B.say = truth ? '내 답이 맞거든?' : '후후, 속았지?';
    }
    B.phase = 'revResult';
    checkAch();
    renderBattle();
  }

  function endBattle(win) {
    B.timing = false;
    B.phase = 'end';
    B.won = win;
    if (win) {
      const acc = B.asked ? B.correct / B.asked : 1;
      const grade = RULES.gradeOf(acc);
      const ev = { type: 'win', final: B.final, focusRatio: S.focus / stats().maxFocus, itemsUsed: B.itemsUsed };
      const exp = Math.round(B.lec.exp * RULES.gradeMult[grade]);
      const drops = rollLoot((B.final ? 2 : 1) + (grade === 'A+' || grade === 'A' ? 1 : 0));
      addItems(drops);
      const prev = S.cleared[B.lec.id];
      if (!prev || RULES.gpa[grade] > RULES.gpa[prev]) S.cleared[B.lec.id] = grade;
      const ups = gainExp(exp);
      B.summary = { grade, acc, exp, drops, ups };
      checkAch(ev);
    } else {
      S.focus = Math.ceil(stats().maxFocus * 0.5);
    }
    save();
    renderBattle();
  }

  function closeBattle() {
    const { won, final } = B;
    B = null;
    hide();
    mode = 'field';
    held.length = 0;
    updateHUD();
    if (!won) toast('😴 깜빡 졸아 버렸다… 집중력이 절반 회복되었다.');
    else if (final) stageClear();
    else toast('🔓 다음 구역의 문이 열렸다!');
  }

  // ---------- 배틀 화면 ----------

  const DLABEL = { 1: '쉬움', 2: '보통', 3: '어려움' };

  function bar(cls, pct, label) {
    return `<div class="bar ${cls}"><i style="width:${clamp(pct, 0, 100)}%"></i><span>${label}</span></div>`;
  }

  function choicesHTML(q, opts = {}) {
    return `<div class="choices">${q.choices.map((c, i) => {
      const cls = ['choice'];
      if (opts.reveal && i === q.answer) cls.push('correct');
      if (opts.reveal && i === opts.picked && i !== q.answer) cls.push('wrong');
      if (opts.monster === i) cls.push('mpick');
      if (B.removed.includes(i)) cls.push('removed');
      const dis = opts.locked || B.removed.includes(i) ? 'disabled' : '';
      return `<button class="${cls.join(' ')}" data-act="ans" data-arg="${i}" ${dis}><b>${i + 1}</b>${esc(c)}${opts.monster === i ? `<em>${B.lec.icon}</em>` : ''}</button>`;
    }).join('')}</div>`;
  }

  function itemsHTML() {
    const left = RULES.itemLimit - B.itemsUsed;
    return `<div class="items">${Object.entries(ITEMS).map(([id, it]) =>
      `<button class="item" data-act="item" data-arg="${id}" title="${esc(it.desc)}" ${!S.bag[id] || left <= 0 ? 'disabled' : ''}>${it.icon} ${it.name} <b>${S.bag[id] || 0}</b><kbd>${it.key}</kbd></button>`,
    ).join('')}<span class="limit">이번 배틀 남은 사용 ${left}/${RULES.itemLimit}</span></div>`;
  }

  const timerHTML = () => '<div class="timer"><i id="timerBar"></i><span id="timerText"></span></div>';
  const nextBtn = (label = '다음 ▶') => `<button class="btn primary" data-act="bnext">${label} <kbd>Enter</kbd></button>`;

  function panelHTML() {
    const L = B.lec, q = B.q;
    switch (B.phase) {
      case 'intro':
        return `<div class="intro">
          <h3>${B.final ? '🔥 기말고사 시작!' : '📖 강의 시작!'} 「${esc(L.name)}」</h3>
          <div class="card">💡 ${esc(L.card)}</div>
          <p class="rule">정답 → 진도 ↑ · 오답·시간 초과 → 집중력 ↓ · <b>3턴마다 역질문 턴</b>(내가 문제를 내고 강의의 답을 채점) · 진도 100%면 이수!</p>
          ${nextBtn('수강 시작 ▶')}</div>`;
      case 'ask':
        return `${timerHTML()}<div class="qtext"><span class="qd d${q.d}">${DLABEL[q.d]}</span> Q${B.asked}. ${esc(q.q)}</div>
          ${choicesHTML(q)}${itemsHTML()}`;
      case 'askResult':
        return `<div class="qtext"><span class="qd d${q.d}">${DLABEL[q.d]}</span> Q${B.asked}. ${esc(q.q)}</div>
          ${choicesHTML(q, { reveal: true, picked: B.picked, locked: true })}
          <div class="result ${B.result.ok ? 'ok' : 'bad'}">${B.result.text}</div>
          <div class="explain">📘 ${esc(q.explain)}</div>${nextBtn()}`;
      case 'revPick':
        return `<div class="rev-title">🔄 <b>역질문 턴!</b> 강의에게 낼 문제를 고르세요. 어려울수록 강의가 자주 틀리지만, <b>채점은 당신 몫</b>입니다.</div>
          <div class="cards">${B.cards.map((c, k) => `<button class="qcard d${c.d}" data-act="card" data-arg="${k}">
            <div class="qcard-d"><kbd>${k + 1}</kbd> ${DLABEL[c.d]} ${'★'.repeat(c.d)}</div>
            <div class="qcard-q">${esc(c.q)}</div>
            <div class="qcard-r">지적 성공 시 진도 ×${(1.5 * RULES.diffMult[c.d]).toFixed(1)}</div></button>`).join('')}</div>`;
      case 'revJudge':
        return `${timerHTML()}<div class="qtext">내가 낸 문제: ${esc(q.q)}</div>
          ${choicesHTML(q, { monster: B.monsterPick, locked: true })}
          <div class="judge"><span>강의의 답이 맞았을까?</span>
            <button class="btn ok" data-act="judge" data-arg="1">⭕ 맞았다 <kbd>O</kbd></button>
            <button class="btn no" data-act="judge" data-arg="0">❌ 틀렸다 <kbd>X</kbd></button></div>`;
      case 'revResult':
        return `<div class="qtext">내가 낸 문제: ${esc(q.q)}</div>
          ${choicesHTML(q, { reveal: true, monster: B.monsterPick, picked: B.monsterPick, locked: true })}
          <div class="result ${B.result.ok ? 'ok' : 'bad'}">${B.result.text}</div>
          <div class="explain">📘 ${esc(q.explain)}</div>${nextBtn()}`;
      case 'end': {
        if (!B.won) {
          return `<div class="end lose"><h2>😴 깜빡 졸아 버렸다…</h2>
            <p>집중력이 바닥났다. ☕에서 쉬거나 아이템을 챙겨 다시 도전하자. (진도 초기화, 집중력 50% 회복)</p>${nextBtn('필드로 돌아가기')}</div>`;
        }
        const s = B.summary;
        return `<div class="end win">
          <h2>🎉 ${B.final ? '기말고사 통과!' : '강의 이수!'} 「${esc(L.name)}」</h2>
          <div class="grade g${s.grade.replace('+', 'p')}">${s.grade}</div>
          <div class="end-stats">정답률 ${Math.round(s.acc * 100)}% (${B.correct}/${B.asked}) · 최대 콤보 ${B.maxCombo} · 아이템 ${B.itemsUsed}개 사용</div>
          <div class="end-reward">보상: EXP +${s.exp} · ${itemsText(s.drops)}</div>
          ${s.ups ? `<div class="lvup">⬆️ 레벨 업! Lv.${S.level} — 집중력 완전 회복</div>` : ''}
          ${nextBtn('계속 ▶')}</div>`;
      }
      default: return '';
    }
  }

  function renderBattle() {
    const L = B.lec, st = stats();
    const prog = (B.progress / L.volume) * 100;
    ui.innerHTML = `<div class="battle ${B.final ? 'final' : ''} ${B.fx === 'hurt' ? 'hurt' : ''}">
      <div class="b-head">
        <div class="b-title">${B.final ? '🔥 기말고사' : '📖 강의'} · ${esc(L.name)} <span class="lv">Lv.${L.level}</span></div>
        ${bar('prog', prog, `진도 ${Math.floor(prog)}%`)}
      </div>
      <div class="b-stage">
        <div class="b-mob ${B.fx === 'hit' ? 'hit' : ''}">${L.icon}</div>
        <div class="b-mobname">${esc(L.mob)}</div>
        ${B.say ? `<div class="bubble">${esc(B.say)}</div>` : ''}
        ${B.float ? `<div class="float ${B.float.kind}">${B.float.text}</div>` : ''}
      </div>
      <div class="b-me">
        <span class="b-name">🎓 ${esc(S.name)} Lv.${S.level}</span>
        ${bar('focus', (S.focus / st.maxFocus) * 100, `집중력 ${S.focus}/${st.maxFocus}`)}
        <span class="chip">콤보 ×${B.combo}</span>
        ${B.energy ? '<span class="chip energy">⚡ 다음 정답 2배</span>' : ''}
      </div>
      <div class="b-panel">${panelHTML()}</div>
    </div>`;
    B.fx = '';
    B.float = null;
  }

  function updateTimer(now) {
    if (!B || !B.timing) return;
    const left = 1 - (now - B.tStart) / B.tLimit;
    const barEl = document.getElementById('timerBar'), txt = document.getElementById('timerText');
    if (barEl) { barEl.style.width = `${Math.max(0, left) * 100}%`; barEl.classList.toggle('low', left < 0.3); }
    if (txt) txt.textContent = `${Math.max(0, Math.ceil((left * B.tLimit) / 1000))}초`;
    if (left <= 0) { if (B.phase === 'ask') answer(-1, false); else if (B.phase === 'revJudge') judge(null); }
  }

  function battleNext() {
    if (!B) return;
    if (B.phase === 'intro' || B.phase === 'askResult' || B.phase === 'revResult') nextTurn();
    else if (B.phase === 'end') closeBattle();
  }

  // ================= 과목 이수와 엔딩 =================

  function stageClear() {
    const st = STAGES[S.stage];
    S.done[st.id] = true;
    addItems(st.reward.items);
    const ups = gainExp(st.reward.exp);
    checkAch();
    save();
    const last = Object.keys(S.done).length >= STAGES.length;
    // 이수한 과목에서 나온다
    S.lastStage = S.stage;
    S.stage = -1;
    S.pos = null;
    map = null;
    hud.innerHTML = ''; hudHTML = '';
    save();
    mode = 'modal';
    ui.innerHTML = `<div class="screen clear">
      <div class="cert">📜 이수증</div>
      <h2>${st.icon} ${st.subject} 과목 이수!</h2>
      <table class="grades">${st.lectures.map((l) => `<tr><td>${l.icon} ${esc(l.name)}</td><td class="g">${S.cleared[l.id] || '-'}</td></tr>`).join('')}</table>
      <div class="reward">이수 보상: EXP +${st.reward.exp} · ${itemsText(st.reward.items)}</div>
      ${ups ? `<div class="lvup">⬆️ 레벨 업! Lv.${S.level}</div>` : ''}
      <div class="sub">이수 과목 ${Object.keys(S.done).length} / ${STAGES.length}</div>
      <button class="btn primary" data-act="${last ? 'ending' : 'courses'}">${last ? '🎓 졸업식으로' : '🗺️ 월드맵으로'} <kbd>Enter</kbd></button>
    </div>`;
    show();
  }

  // ---------- 월드맵 (수강신청) ----------
  // 섬 위에 과목 8개를 길로 잇는다. 좌표는 640×360 기준 퍼센트
  const WORLD_POS = { comp: [13, 72], dm: [26, 44], ds: [38, 74], cpp: [50, 45], unix: [62, 76], os: [71, 40], pl: [83, 68], cloud: [88, 22] };
  const WORLD_TREES = [[60, 205], [118, 112], [205, 92], [282, 305], [352, 108], [430, 318], [505, 112], [598, 205], [150, 300], [468, 238], [300, 240], [215, 200], [560, 300], [95, 160]];
  const ISLAND = 'M60,230 C28,150 92,78 182,92 C250,48 362,66 420,104 C484,74 566,118 594,190 C626,262 580,342 470,330 C380,354 260,346 180,330 C92,336 70,292 60,230 Z';
  let worldOpen = false;

  function smoothPath(p) {
    let d = `M${p[0][0]},${p[0][1]}`;
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`;
    }
    return d;
  }

  function showWorld() {
    if (B) return;
    const inStage = !!(map && STAGES[S.stage]);
    if (inStage) save();
    mode = 'modal';
    worldOpen = true;
    held.length = 0;
    const doneN = Object.keys(S.done).length;
    const here = inStage ? S.stage : (S.lastStage ?? -1);
    const pos = STAGES.map((st, i) => WORLD_POS[st.id] || [10 + i * 11, 50]);
    const road = smoothPath(pos.map(([x, y]) => [x * 6.4, y * 3.6]));
    const cloudPos = WORLD_POS.cloud ? [WORLD_POS.cloud[0] * 6.4, WORLD_POS.cloud[1] * 3.6] : null;
    ui.innerHTML = `<div class="screen world">
      <svg class="world-bg" viewBox="0 0 640 360" preserveAspectRatio="none" aria-hidden="true">
        <defs><pattern id="wave" width="44" height="22" patternUnits="userSpaceOnUse"><path d="M2 12 Q12 4 22 12 T42 12" fill="none" stroke="#c9f0ff" stroke-width="2.5" stroke-linecap="round"/></pattern></defs>
        <rect width="640" height="360" fill="#8fd8f7"/>
        <rect width="640" height="360" fill="url(#wave)"/>
        <path d="${ISLAND}" fill="#f3dcae" stroke="#3d2c4e" stroke-width="4" transform="translate(0 6)"/>
        <path d="${ISLAND}" fill="#bfe7a8" stroke="#3d2c4e" stroke-width="4"/>
        ${cloudPos ? `<g class="w-cloud-isle"><ellipse cx="${cloudPos[0]}" cy="${cloudPos[1] + 14}" rx="54" ry="22" fill="#ffffff" stroke="#3d2c4e" stroke-width="3"/><ellipse cx="${cloudPos[0] - 30}" cy="${cloudPos[1] + 6}" rx="24" ry="16" fill="#ffffff" stroke="#3d2c4e" stroke-width="3"/><ellipse cx="${cloudPos[0] + 28}" cy="${cloudPos[1] + 4}" rx="22" ry="15" fill="#ffffff" stroke="#3d2c4e" stroke-width="3"/><ellipse cx="${cloudPos[0]}" cy="${cloudPos[1] + 10}" rx="48" ry="16" fill="#ffffff"/></g>` : ''}
        ${WORLD_TREES.map(([x, y]) => `<g><rect x="${x - 2.5}" y="${y}" width="5" height="9" rx="2" fill="#b57a48" stroke="#3d2c4e" stroke-width="1.5"/><circle cx="${x}" cy="${y - 2}" r="10" fill="#5fbf6a" stroke="#3d2c4e" stroke-width="2"/><circle cx="${x - 3}" cy="${y - 6}" r="3" fill="#8fdc90"/></g>`).join('')}
        <path d="${road}" fill="none" stroke="#3d2c4e" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="${road}" fill="none" stroke="#f6e3b8" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="${road}" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-dasharray="7 9" stroke-linecap="round"/>
        <g class="w-clouds"><ellipse cx="70" cy="42" rx="34" ry="12" fill="#fff" opacity=".85"/><ellipse cx="300" cy="28" rx="40" ry="11" fill="#fff" opacity=".8"/><ellipse cx="420" cy="345" rx="36" ry="10" fill="#fff" opacity=".7"/></g>
      </svg>
      <div class="world-head"><b>🗺️ 월드맵</b><span>이수 ${doneN} / ${STAGES.length} · 과목 건물을 눌러 수강신청 · Lv.${S.level}</span></div>
      ${STAGES.map((st, i) => {
        const done = !!S.done[st.id];
        const n = st.lectures.filter((l) => S.cleared[l.id]).length;
        const [x, y] = pos[i];
        return `<button class="wnode t${st.tier} ${done ? 'done' : ''} ${i === here ? 'here' : ''}" style="left:${x}%;top:${y}%" data-act="course" data-arg="${i}" ${done ? 'disabled' : ''} title="${esc(st.place)}">
          ${i === here ? '<span class="w-me">🎓</span>' : ''}
          <span class="w-badge">${st.icon}${done ? '<i class="w-flag">🚩</i>' : ''}</span>
          <span class="w-name">${esc(st.subject)}</span>
          <span class="w-meta">${'★'.repeat(st.tier)} · Lv.${st.lectures[0].level}+ · ${done ? '이수' : `${n}/4`}</span>
        </button>`;
      }).join('')}
      ${inStage ? '<button class="btn world-close" data-act="closeWorld">↩ 돌아가기 <kbd>Tab</kbd></button>' : ''}
    </div>`;
    show();
  }

  function closeWorld() {
    if (!map) return;
    worldOpen = false;
    hide();
    mode = 'field';
    updateHUD();
  }

  function enterCourse(i) {
    if (!STAGES[i] || S.done[STAGES[i].id]) return;
    worldOpen = false;
    if (map && S.stage === i) { closeWorld(); return; }
    S.stage = i;
    S.lastStage = i;
    S.pos = null;
    loadStage(i);
    hide();
    mode = 'field';
    save();
    updateHUD();
    toast(`${map.st.icon} ${map.st.subject} — ${map.st.place}. 첫 강의를 찾아가 보자!`);
  }

  const showCourses = showWorld;

  function gpaOf() {
    const gs = STAGES.flatMap((st) => st.lectures.map((l) => S.cleared[l.id])).filter(Boolean);
    return gs.length ? (gs.reduce((s, g) => s + RULES.gpa[g], 0) / gs.length).toFixed(2) : '0.00';
  }

  const fmtTime = (ms) => `${Math.floor(ms / 60000)}분 ${Math.floor((ms % 60000) / 1000)}초`;

  function ending() {
    S.graduated = true;
    save();
    mode = 'modal';
    hud.innerHTML = ''; hudHTML = '';
    const achN = Object.keys(S.ach).length;
    ui.innerHTML = `<div class="screen ending">
      <div class="logo">🎓 졸업을 축하합니다!</div>
      <p class="sub">${esc(S.name)} 님은 모든 과목을 이수했습니다.</p>
      <div class="ending-grid">
        <div><b>${gpaOf()}</b><span>평점 (4.5 만점)</span></div>
        <div><b>Lv.${S.level}</b><span>최종 레벨</span></div>
        <div><b>${S.stats.correct}</b><span>맞힌 문제</span></div>
        <div><b>${S.stats.bestStreak}</b><span>최고 연속 정답</span></div>
        <div><b>${S.stats.sharp}</b><span>지적 성공</span></div>
        <div><b>${achN}/${ACHIEVEMENTS.length}</b><span>업적</span></div>
      </div>
      <p class="sub">플레이 시간 ${fmtTime(S.playMs)}</p>
      <button class="btn primary" data-act="restart">처음부터 다시 하기</button>
    </div>`;
    show();
  }

  // ================= 메뉴 =================

  let menuTab = 'status';

  function openMenu(tab) {
    if (mode !== 'field') return;
    mode = 'menu';
    held.length = 0;
    menuTab = tab || menuTab;
    renderMenu();
    show();
  }

  function closeMenu() { hide(); mode = 'field'; updateHUD(); }

  function renderMenu() {
    const st = stats(), next = RULES.expToNext(S.level);
    const tabs = [['status', '📊 상태'], ['bag', '🎒 가방'], ['ach', '🏆 업적'], ['grades', '📜 성적표']];
    let body = '';
    if (menuTab === 'status') {
      body = `<div class="status">
        <div class="avatar">🎓</div>
        <div><h3>${esc(S.name)} <small>Lv.${S.level}</small></h3>
        ${bar('exp', (S.exp / next) * 100, `EXP ${S.exp}/${next}`)}
        <table class="stat-table">
          <tr><td>❤️ 집중력</td><td>${S.focus}/${st.maxFocus}</td><td>몇 번까지 틀려도 버티는지</td></tr>
          <tr><td>🧠 지력</td><td>${st.int}</td><td>정답 하나당 오르는 진도</td></tr>
          <tr><td>⏱️ 순발력</td><td>${st.spd}</td><td>제한시간 +${st.spd}%</td></tr>
        </table>
        <p class="muted">레벨이 오르면 모든 능력치가 오르고 집중력이 완전 회복됩니다. · 플레이 ${fmtTime(S.playMs)}</p></div></div>`;
    } else if (menuTab === 'bag') {
      body = `<div class="bag">${Object.entries(ITEMS).map(([id, it]) => `<div class="bag-item"><span class="bi">${it.icon}</span>
        <div><b>${it.name} ×${S.bag[id] || 0}</b><p>${it.desc}</p></div><kbd>${it.key}</kbd></div>`).join('')}
        <p class="muted">아이템은 강의 배틀 중 문제를 풀 때 사용합니다. 배틀당 ${RULES.itemLimit}개까지.</p></div>`;
    } else if (menuTab === 'ach') {
      body = `<div class="achs">${ACHIEVEMENTS.map((a) => {
        const got = !!S.ach[a.id], secret = a.hidden && !got;
        return `<div class="ach ${got ? 'got' : ''}"><span class="ai">${secret ? '❔' : a.icon}</span>
          <div><b>${secret ? '???' : a.name}</b><p>${secret ? '숨겨진 업적' : a.desc}</p></div></div>`;
      }).join('')}</div>`;
    } else {
      body = `<div class="gradesheet">${STAGES.map((stg) => `<div class="gs"><h4>${stg.icon} ${stg.subject} ${S.done[stg.id] ? '<span class="tag">이수</span>' : ''}</h4>
        <table class="grades">${stg.lectures.map((l) => `<tr><td>${l.icon} ${esc(l.name)}</td><td class="g">${S.cleared[l.id] || '-'}</td></tr>`).join('')}</table></div>`).join('')}
        <p class="muted">평점 ${gpaOf()} / 4.5</p></div>`;
    }
    ui.innerHTML = `<div class="screen menu">
      <div class="tabs">${tabs.map(([id, label]) => `<button class="tab ${menuTab === id ? 'on' : ''}" data-act="tab" data-arg="${id}">${label}</button>`).join('')}
        <button class="tab close" data-act="closeMenu">✕ 닫기 (M)</button></div>
      <div class="menu-body">${body}</div></div>`;
  }

  // ================= 타이틀 =================

  function showTitle() {
    mode = 'title';
    S = null; map = null;
    hud.innerHTML = ''; hudHTML = '';
    const saved = loadSave();
    ui.innerHTML = `<div class="screen title">
      <div class="logo">📚 이수 퀘스트</div>
      <p class="sub">컴퓨터과학과 ${STAGES.length}과목을 탐험하고, 강의를 퀴즈로 이겨 졸업하라!</p>
      ${saved ? `<button class="btn primary big" data-act="continue">▶ 이어하기 — ${esc(saved.name)} Lv.${saved.level}</button>` : ''}
      <div class="newgame">
        <input id="nameInput" maxlength="8" placeholder="이름 (최대 8자)" value="${saved ? '' : '새내기'}" autocomplete="off">
        <button class="btn ${saved ? '' : 'primary'}" data-act="newgame">새로 시작</button>
      </div>
      <div class="howto">
        <div>🗺️ <b>탐험</b> 방향키/WASD로 이동, 🎁 상자에서 아이템 획득, ☕에서 회복·저장</div>
        <div>⚔️ <b>퀴즈 배틀</b> 강의에 부딪히면 시작. 정답으로 진도를 채우면 이수!</div>
        <div>🔄 <b>역질문</b> 3턴마다 내가 문제를 내고, 강의의 답을 채점한다</div>
        <div>🎒 <b>아이템</b> Q 형광펜 · W 패스권 · E 에너지 드링크 · R 초콜릿</div>
      </div>
    </div>`;
    show();
    const input = $('#nameInput');
    if (input && !saved) input.focus();
  }

  function beginGame(state) {
    S = state;
    if (S.graduated) { ending(); return; }
    if (!STAGES[S.stage]) { showCourses(); return; }
    loadStage(S.stage, S.pos);
    hide();
    mode = 'field';
    updateHUD();
    save();
  }

  // ================= 입력 =================

  function show() { ui.classList.add('show'); }
  function hide() { ui.classList.remove('show'); ui.innerHTML = ''; }

  const ACT = {
    continue: () => { const s = loadSave(); if (s) beginGame(s); },
    newgame: () => {
      const name = (($('#nameInput') || {}).value || '').trim() || '새내기';
      clearSave();
      beginGame(newState(name.slice(0, 8)));
    },
    menu: () => openMenu(),
    closeMenu: () => closeMenu(),
    tab: (id) => { menuTab = id; renderMenu(); },
    bnext: () => battleNext(),
    ans: (i) => answer(Number(i), false),
    item: (id) => useItem(id),
    card: (k) => pickCard(Number(k)),
    judge: (v) => judge(v === '1'),
    courses: () => { if (mode === 'field' || mode === 'modal') showCourses(); },
    course: (i) => enterCourse(Number(i)),
    closeWorld: () => closeWorld(),
    ending: () => ending(),
    restart: () => { clearSave(); showTitle(); },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = ACT[el.dataset.act];
    if (fn) fn(el.dataset.arg);
  });

  const KEYDIR = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  const ITEMKEY = { KeyQ: 'highlighter', KeyW: 'pass', KeyE: 'energy', KeyR: 'choco' };

  function battleKey(e) {
    const c = e.code;
    const num = /^(Digit|Numpad)([1-4])$/.exec(c);
    if (c === 'Enter' || c === 'Space') { e.preventDefault(); battleNext(); return; }
    if (DEBUG && c === 'KeyK' && B.phase !== 'end') { B.progress = B.lec.volume; endBattle(true); return; }
    if (B.phase === 'ask') {
      if (num) { const i = Number(num[2]) - 1; if (!B.removed.includes(i)) answer(i, false); return; }
      if (ITEMKEY[c]) useItem(ITEMKEY[c]);
    } else if (B.phase === 'revPick') {
      if (num && Number(num[2]) <= 3) pickCard(Number(num[2]) - 1);
    } else if (B.phase === 'revJudge') {
      if (c === 'KeyO' || (num && num[2] === '1')) judge(true);
      else if (c === 'KeyX' || (num && num[2] === '2')) judge(false);
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') { if (e.key === 'Enter') ACT.newgame(); return; }
    if (e.repeat && mode !== 'field') return;
    const dir = KEYDIR[e.code];
    if (mode === 'field') {
      if (dir) { e.preventDefault(); if (!held.includes(dir)) held.push(dir); return; }
      if (e.code === 'KeyM' || e.code === 'Escape') { openMenu(); return; }
      if (e.code === 'Tab') { e.preventDefault(); showWorld(); return; }
      if (DEBUG && e.code === 'KeyL') { gainExp(RULES.expToNext(S.level) - S.exp); updateHUD(); toast(`[디버그] Lv.${S.level}`); }
      if (DEBUG && e.code === 'KeyN') { const st = STAGES[S.stage]; st.lectures.forEach((l) => { S.cleared[l.id] = S.cleared[l.id] || 'B'; }); updateHUD(); toast('[디버그] 현재 과목 강의 전부 이수 처리'); }
    } else if (mode === 'menu') {
      if (e.code === 'KeyM' || e.code === 'Escape') closeMenu();
    } else if (mode === 'battle') {
      battleKey(e);
    } else if (mode === 'modal') {
      if (worldOpen && (e.code === 'Tab' || e.code === 'Escape')) { e.preventDefault(); closeWorld(); return; }
      if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); const b = ui.querySelector('.btn.primary'); if (b) b.click(); }
    } else if (mode === 'title') {
      if (e.code === 'Enter') { const b = ui.querySelector('.btn.primary'); if (b) b.click(); }
    }
  });

  document.addEventListener('keyup', (e) => {
    const dir = KEYDIR[e.code];
    if (dir) { const i = held.indexOf(dir); if (i >= 0) held.splice(i, 1); }
  });
  window.addEventListener('blur', () => { held.length = 0; });
  window.addEventListener('beforeunload', save);

  // 터치 방향 패드
  document.querySelectorAll('#dpad [data-dir]').forEach((btn) => {
    const d = btn.dataset.dir;
    const on = (ev) => { ev.preventDefault(); if (!held.includes(d)) held.push(d); };
    const off = (ev) => { ev.preventDefault(); const i = held.indexOf(d); if (i >= 0) held.splice(i, 1); };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointerleave', off);
    btn.addEventListener('pointercancel', off);
  });

  // ================= 화면 크기와 루프 =================

  function fit() {
    const w = Math.min(window.innerWidth - 24, ((window.innerHeight - 30) * 16) / 9);
    app.style.width = `${w}px`;
    app.style.height = `${(w * 9) / 16}px`;
    app.style.fontSize = `${Math.max(9, (w / 640) * 12)}px`;
  }
  window.addEventListener('resize', fit);
  fit();

  let last = performance.now(), saveTimer = 0;
  function loop(now) {
    const dt = Math.min(100, now - last);
    last = now;
    if (S && !S.graduated) {
      S.playMs += dt;
      saveTimer += dt;
      if (saveTimer > 5000 && mode === 'field') { saveTimer = 0; save(); }
    }
    if (mode === 'field') { updateField(dt); updateHUDThrottled(now); }
    if (map && S) drawField(now);
    else { ctx.fillStyle = '#1b2033'; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
    if (mode === 'battle') updateTimer(now);
    requestAnimationFrame(loop);
  }

  // HUD는 상태가 바뀔 때 갱신하지만, 놓친 경우를 대비해 0.5초마다 한 번 더 갱신
  let hudAt = 0;
  function updateHUDThrottled(now) { if (now - hudAt > 500) { hudAt = now; updateHUD(); } }

  showTitle();
  requestAnimationFrame(loop);

  // 자동 점검용 (콘솔에서 확인 가능)
  window.__game = { get S() { return S; }, get P() { return player; }, tick: (dt) => updateField(dt), get B() { return B; }, get mode() { return mode; }, ACT, startBattle, answer, judge, pickCard, useItem, battleNext, nextTurn };
})();
