// 이수 퀘스트 — 게임 데이터와 문제 생성기 (컴퓨터과학과 8과목)
// 개념형 문제는 js/banks/*.js 가 globalThis.BANKS 에 먼저 등록해 둔다
'use strict';

const U = {
  rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); },
  pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },
  // 가중치 배열에서 인덱스 하나를 고른다
  weighted(weights) {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0) return i; }
    return weights.length - 1;
  },
};

// ---------- 문제 생성 도우미 ----------

function numVal(s) { return Number(s); }

// 정답과 겹치지 않는 오답 3개를 고른다. 첫 번째 후보는 "그럴듯한 실수"(역질문 때 강의가 고르는 오답)
// numeric이면 값으로 비교하고 0 이하·비숫자는 버린다
function makeWrongs(correct, cands, filler, numeric) {
  correct = String(correct);
  const same = (a, b) => (numeric ? Math.abs(numVal(a) - numVal(b)) < 1e-9 : a === b);
  const out = [];
  const ok = (s) => {
    if (s === '' || s === 'null' || s === 'undefined' || s === 'NaN') return false;
    if (numeric) { const v = numVal(s); if (!isFinite(v) || v <= 0) return false; }
    return !same(s, correct) && !out.some((o) => same(o, s));
  };
  for (const c of cands) {
    const s = String(c);
    if (ok(s)) out.push(s);
    if (out.length === 3) return out;
  }
  for (let i = 0; i < 300 && out.length < 3; i++) {
    const s = String(filler());
    if (ok(s)) out.push(s);
  }
  return out;
}

const bin = (n, w = 0) => n.toString(2).padStart(w, '0');
const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');
const placeSum = (n) => n.toString(2).split('').map((b, i, a) => (b === '1' ? 2 ** (a.length - 1 - i) : 0)).filter(Boolean).join(' + ');
const fact = (n) => (n <= 1 ? 1 : n * fact(n - 1));
const nPr = (n, r) => fact(n) / fact(n - r);
const nCr = (n, r) => nPr(n, r) / fact(r);
const fmtSet = (s) => `{${[...s].sort((a, b) => a - b).join(', ')}}`;

// ---------- 계산형 문제 생성기 ----------
// 각 생성기는 난이도 d(1~3)를 받아 { q, correct, wrongs: [함정, 오답, 오답], explain } 을 돌려준다

const GEN = {
  // 컴퓨터의 이해 — 수의 진법
  radix(d) {
    if (d === 1) {
      const n = U.rnd(5, 31), ans = bin(n);
      return {
        q: `10진수 ${n}을(를) 2진수로 나타내면?`, correct: ans,
        // 흔한 실수: 나머지를 위에서 아래로(거꾸로) 읽는다
        wrongs: makeWrongs(ans, [[...ans].reverse().join(''), bin(n + 1), bin(n - 1), bin(n + 2)], () => bin(U.rnd(3, 40)), false),
        explain: `${n} = ${placeSum(n)} → ${ans}₂. 2로 나눈 나머지를 아래에서 위로 읽는다.`,
      };
    }
    if (d === 2) {
      const n = U.rnd(33, 127), b = bin(n);
      return {
        q: `2진수 ${b}을(를) 10진수로 나타내면?`, correct: String(n),
        wrongs: makeWrongs(n, [parseInt([...b].reverse().join(''), 2), n + 1, n - 1, n + 16, n - 16], () => n + U.rnd(-20, 20), true),
        explain: `${b}₂ = ${placeSum(n)} = ${n}`,
      };
    }
    const n = U.rnd(17, 255), b = bin(n, 8), h = hex2(n);
    return {
      q: `2진수 ${b}을(를) 16진수로 나타내면?`, correct: h,
      // 흔한 실수: 4비트 묶음의 순서를 뒤집는다
      wrongs: makeWrongs(h, [h[1] + h[0], hex2((n + 1) % 256), hex2(n ^ 16), hex2(n ^ 1)], () => hex2(U.rnd(16, 255)), false),
      explain: `4비트씩 끊는다: ${b.slice(0, 4)} | ${b.slice(4)} → ${h[0]} | ${h[1]} → ${h}₁₆`,
    };
  },

  // 컴퓨터의 이해 — 자료의 표현
  datarep(d) {
    if (d === 1) {
      if (Math.random() < 0.5) {
        const k = U.rnd(2, 8), ans = k * 1024;
        return {
          q: `${k}KB는 몇 바이트(Byte)인가?`, correct: String(ans),
          wrongs: makeWrongs(ans, [k * 1000, ans * 8, k * 512, ans + 1024], () => ans + U.rnd(-3, 3) * 100, true),
          explain: `컴퓨터에서는 1KB = 2¹⁰ = 1024바이트로 계산한다. ${k} × 1024 = ${ans}`,
        };
      }
      const k = U.rnd(2, 16), ans = k * 8;
      return {
        q: `${k}바이트는 몇 비트(bit)인가?`, correct: String(ans),
        wrongs: makeWrongs(ans, [k * 4, k * 16, k * 2, ans + 8], () => ans + U.rnd(-10, 10), true),
        explain: `1바이트 = 8비트. ${k} × 8 = ${ans}`,
      };
    }
    if (d === 2) {
      const n = U.rnd(2, 30);
      const two = bin(256 - n, 8), one = bin(255 - n, 8), pos = bin(n, 8);
      return {
        q: `-${n}을(를) 8비트 2의 보수로 나타내면?`, correct: two,
        // 흔한 실수: 1의 보수에서 멈춘다
        wrongs: makeWrongs(two, [one, `1${bin(n, 7)}`, pos], () => bin(U.rnd(128, 255), 8), false),
        explain: `${n} = ${pos} → 비트 반전(1의 보수) ${one} → 1을 더하면 ${two}`,
      };
    }
    const n = U.rnd(2, 60), b = bin(256 - n, 8);
    return {
      q: `8비트 2의 보수 ${b}이(가) 나타내는 10진수는?`, correct: String(-n),
      // 흔한 실수: 부호 없는 수로 읽는다
      wrongs: makeWrongs(String(-n), [String(256 - n), String(-(n - 1)), String(-(128 - n))], () => String(-U.rnd(1, 127)), false),
      explain: `맨 앞 비트가 1이면 음수. 비트 반전 후 1을 더하면 ${bin(n, 8)} = ${n} → -${n}`,
    };
  },

  // 자료구조 — 스택과 큐
  stackq(d) {
    const isStack = Math.random() < 0.5;
    const len = d === 1 ? 4 : d === 2 ? 6 : 7;
    let ops, vals;
    for (let tries = 0; tries < 100; tries++) {
      vals = U.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      ops = [];
      let size = 0, vi = 0;
      for (let i = 0; i < len; i++) {
        if (size > 0 && i > 0 && Math.random() < 0.4) { ops.push(null); size--; } else { ops.push(vals[vi++]); size++; }
      }
      const pops = ops.filter((o) => o === null).length;
      if (size >= 2 && (d < 3 || pops >= 2)) break;
    }
    const sim = (lifo) => {
      const a = [], out = [];
      for (const o of ops) { if (o === null) out.push(lifo ? a.pop() : a.shift()); else a.push(o); }
      return { a, out };
    };
    const me = sim(isStack), other = sim(!isStack);
    const [add, rem] = isStack ? ['push', 'pop'] : ['enqueue', 'dequeue'];
    const opText = ops.map((o) => (o === null ? `${rem}()` : `${add}(${o})`)).join(', ');
    const name = isStack ? '스택' : '큐';
    const rule = isStack ? '스택은 나중에 넣은 것이 먼저 나온다(LIFO).' : '큐는 먼저 넣은 것이 먼저 나온다(FIFO).';
    const used = ops.filter((o) => o !== null);
    if (d < 3) {
      const ans = isStack ? me.a[me.a.length - 1] : me.a[0];
      const trap = isStack ? me.a[0] : me.a[me.a.length - 1];
      return {
        q: `빈 ${name}에 ${opText}를 차례로 실행한 뒤 ${isStack ? 'top(맨 위)' : 'front(맨 앞)'} 값은?`, correct: String(ans),
        wrongs: makeWrongs(ans, [trap, ...U.shuffle(used)], () => U.rnd(1, 9), true),
        explain: `${rule} 최종 상태(${isStack ? '아래→위' : '앞→뒤'}): [${me.a.join(', ')}]`,
      };
    }
    const ans = me.out.join(', ');
    return {
      q: `빈 ${name}에 ${opText}를 실행할 때 ${rem}()로 나온 값을 순서대로 쓰면?`, correct: ans,
      // 흔한 실수: 스택과 큐를 바꿔 생각한다
      wrongs: makeWrongs(ans, [other.out.join(', '), [...me.out].reverse().join(', ')], () => U.shuffle(used).slice(0, me.out.length).join(', '), false),
      explain: `${rule} 나온 순서: ${ans}`,
    };
  },

  // 자료구조 — 트리
  tree(d) {
    if (d === 1) {
      const i = U.rnd(2, 15);
      if (Math.random() < 0.5) {
        return {
          q: `1번부터 저장하는 완전 이진 트리 배열에서 ${i}번 노드의 왼쪽 자식 번호는?`, correct: String(2 * i),
          wrongs: makeWrongs(2 * i, [2 * i + 1, i + 1, 2 * i - 1, 2 * i + 2], () => U.rnd(1, 31), true),
          explain: `왼쪽 자식 = 2i = ${2 * i}, 오른쪽 자식 = 2i + 1 = ${2 * i + 1}`,
        };
      }
      const p = Math.floor(i / 2);
      return {
        q: `1번부터 저장하는 완전 이진 트리 배열에서 ${i}번 노드의 부모 번호는?`, correct: String(p),
        wrongs: makeWrongs(p, [p + 1, i - 1, 2 * i, p - 1], () => U.rnd(1, 15), true),
        explain: `부모 = ⌊i / 2⌋ = ⌊${i} / 2⌋ = ${p}`,
      };
    }
    const L = U.shuffle('ABCDEFGHJKMNPRST'.split('')).slice(0, 7);
    const pre = (k) => (k > 7 ? [] : [L[k - 1], ...pre(2 * k), ...pre(2 * k + 1)]);
    const ino = (k) => (k > 7 ? [] : [...ino(2 * k), L[k - 1], ...ino(2 * k + 1)]);
    const post = (k) => (k > 7 ? [] : [...post(2 * k), ...post(2 * k + 1), L[k - 1]]);
    const T = { 전위: pre(1).join(''), 중위: ino(1).join(''), 후위: post(1).join(''), 레벨: L.join('') };
    const kind = d === 2 ? '전위' : U.pick(['중위', '후위']);
    const trapKind = { 전위: '레벨', 중위: '전위', 후위: '중위' }[kind];
    const order = { 전위: '루트 → 왼쪽 → 오른쪽', 중위: '왼쪽 → 루트 → 오른쪽', 후위: '왼쪽 → 오른쪽 → 루트' }[kind];
    return {
      q: `레벨 순서가 [${L.join(' ')}]인 완전 이진 트리(노드 7개)의 ${kind} 순회 결과는?`, correct: T[kind],
      wrongs: makeWrongs(T[kind], [T[trapKind], ...Object.values(T)], () => U.shuffle(L).join(''), false),
      explain: `${kind} 순회는 ${order}. 루트 ${L[0]}, 왼쪽 ${L[1]}(${L[3]}, ${L[4]}), 오른쪽 ${L[2]}(${L[5]}, ${L[6]}) → ${T[kind]}`,
    };
  },

  // 이산수학 — 집합
  sets(d) {
    if (d === 1) {
      if (Math.random() < 0.5) {
        const base = U.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        const A = base.slice(0, 4), B = base.slice(2, 6);
        const AmB = A.filter((x) => !B.includes(x)), BmA = B.filter((x) => !A.includes(x));
        const AnB = A.filter((x) => B.includes(x)), AuB = [...new Set([...A, ...B])];
        return {
          q: `A = ${fmtSet(A)}, B = ${fmtSet(B)} 일 때 A − B는?`, correct: fmtSet(AmB),
          // 흔한 실수: B − A와 헷갈린다
          wrongs: makeWrongs(fmtSet(AmB), [fmtSet(BmA), fmtSet(AnB), fmtSet(AuB)], () => fmtSet(U.shuffle(base).slice(0, 2)), false),
          explain: `A − B는 A에는 있고 B에는 없는 원소의 집합: ${fmtSet(AmB)}`,
        };
      }
      const a = U.rnd(8, 20), b = U.rnd(6, 18), c = U.rnd(2, Math.min(a, b) - 2), ans = a + b - c;
      return {
        q: `|A| = ${a}, |B| = ${b}, |A ∩ B| = ${c} 일 때 |A ∪ B|는?`, correct: String(ans),
        wrongs: makeWrongs(ans, [a + b, a + b - 2 * c, a + b + c, ans + 1], () => ans + U.rnd(-5, 5), true),
        explain: `|A ∪ B| = |A| + |B| − |A ∩ B| = ${a} + ${b} − ${c} = ${ans}`,
      };
    }
    if (d === 2) {
      const n = U.rnd(3, 7), ans = 2 ** n;
      return {
        q: `원소가 ${n}개인 집합의 부분집합은 모두 몇 개인가?`, correct: String(ans),
        // 흔한 실수: 진부분집합 개수(2ⁿ − 1)와 헷갈린다
        wrongs: makeWrongs(ans, [ans - 1, n * n, 2 * n, 2 ** (n - 1)], () => ans + U.rnd(-6, 6), true),
        explain: `원소마다 넣는다/안 넣는다 2가지 → 2^${n} = ${ans} (공집합과 자기 자신 포함)`,
      };
    }
    const abc = U.rnd(1, 3), ab = abc + U.rnd(1, 4), bc = abc + U.rnd(1, 4), ca = abc + U.rnd(1, 4);
    const a = ab + ca - abc + U.rnd(2, 6), b = ab + bc - abc + U.rnd(2, 6), c = bc + ca - abc + U.rnd(2, 6);
    const ans = a + b + c - ab - bc - ca + abc;
    return {
      q: `|A|=${a}, |B|=${b}, |C|=${c}, |A∩B|=${ab}, |B∩C|=${bc}, |C∩A|=${ca}, |A∩B∩C|=${abc} 일 때 |A∪B∪C|는?`, correct: String(ans),
      // 흔한 실수: 마지막에 |A∩B∩C|를 더하지 않는다
      wrongs: makeWrongs(ans, [ans - abc, a + b + c, ans + abc, ans - 1], () => ans + U.rnd(-6, 6), true),
      explain: `포함-배제 원리: ${a} + ${b} + ${c} − ${ab} − ${bc} − ${ca} + ${abc} = ${ans}`,
    };
  },

  // 이산수학 — 순열과 조합
  comb(d) {
    if (d === 1) {
      const n = U.rnd(4, 7), r = U.rnd(2, 3), ans = nPr(n, r);
      return {
        q: `서로 다른 ${n}개 중 ${r}개를 뽑아 일렬로 나열하는 경우의 수는?`, correct: String(ans),
        wrongs: makeWrongs(ans, [nCr(n, r), n ** r, fact(n), ans + n], () => ans + U.rnd(-10, 10), true),
        explain: `순서가 있으므로 순열: ${n}P${r} = ${n}! ÷ ${n - r}! = ${ans}`,
      };
    }
    if (d === 2) {
      const n = U.rnd(5, 9), r = U.rnd(2, 4), ans = nCr(n, r);
      return {
        q: `서로 다른 ${n}개 중 순서 없이 ${r}개를 고르는 경우의 수는?`, correct: String(ans),
        wrongs: makeWrongs(ans, [nPr(n, r), n * r, ans + n, nCr(n, r - 1)], () => ans + U.rnd(-10, 10), true),
        explain: `순서가 없으므로 조합: ${n}C${r} = ${n}P${r} ÷ ${r}! = ${nPr(n, r)} ÷ ${fact(r)} = ${ans}`,
      };
    }
    if (Math.random() < 0.5) {
      const n = U.rnd(4, 7), ans = fact(n - 1);
      return {
        q: `서로 다른 ${n}명이 원탁에 둘러앉는 방법의 수는?`, correct: String(ans),
        // 흔한 실수: 일렬 순열 n!로 계산한다
        wrongs: makeWrongs(ans, [fact(n), fact(n - 2), fact(n) / 2], () => ans + U.rnd(-10, 10), true),
        explain: `원순열은 회전해서 같은 배치를 하나로 본다: (${n} − 1)! = ${ans}`,
      };
    }
    const n = U.rnd(3, 5), r = U.rnd(3, 4), ans = n ** r;
    return {
      q: `${n}종류의 문자로 길이 ${r}인 문자열을 만드는 경우의 수는? (중복 허용)`, correct: String(ans),
      wrongs: makeWrongs(ans, [n >= r ? nPr(n, r) : n * r, r ** n, n * r, ans - 1], () => ans + U.rnd(-10, 10), true),
      explain: `자리마다 ${n}가지 → ${n}^${r} = ${ans} (중복순열)`,
    };
  },
};

// 개념형 문제 은행 → 생성기. 문항 형식: [난이도, 문제, 정답, 함정 오답, 오답, 오답, 해설]
function bankGen(list) {
  return (d) => {
    const pool = list.filter((q) => q[0] === d);
    const [qd, q, correct, trap, w2, w3, explain] = U.pick(pool.length ? pool : list);
    return { q, correct, wrongs: [trap, w2, w3], explain, d: qd };
  };
}

// 강의 하나에서 문제 하나를 만든다. 선택지를 섞고 정답·함정 위치를 기록한다
function buildQuestion(lec, d) {
  const g = GEN[U.pick(lec.gen)](d);
  const choices = U.shuffle([g.correct, ...g.wrongs]);
  return {
    q: g.q, choices, d: g.d || d,
    answer: choices.indexOf(g.correct),
    trap: choices.indexOf(g.wrongs[0]),
    explain: g.explain,
  };
}

// ---------- 맵 ----------
// 지형:  # 숲(맵 테두리·구역 경계)  T 나무  R 바위  f 울타리  ~ 물  B 다리  = 흙길  . 풀밭  , 꽃밭  " 수풀
// 오브젝트:  S 시작  C 상자  H 카페(회복·저장)  s 표지판  1 2 3 강의  F 기말고사
// 잠긴 문:  a b c (각각 강의 1, 2, 3을 이수하면 열림)
// 맵은 11칸 × 13줄 구역 4개를 숲으로 나눠 이어 붙인다. 문은 각 구역 경계의 7번째 줄에 있다

const ZONES = {
  meadow: [
    'T..,,...T..',
    '.C....""..T',
    '..TT.......',
    '....R..,,..',
    '.,,....T...',
    's..........',
    'S====1=====',
    '......T....',
    '..ff.ff..C.',
    '..f...f....',
    '.""..H..,,.',
    'T.,,...T..T',
    'TT..R....TT',
  ],
  pond: [
    '..~~~..T...',
    '.~~~~~...C.',
    '..~~~..,,..',
    '......T....',
    'T.,,.......',
    's.....R....',
    'S====1=====',
    '....T......',
    '.C...""....',
    '..,,....T..',
    '......~~~..',
    'T....~~~~.T',
    'TT....~~.TT',
  ],
  river: [
    '..~..T.....',
    '.C~....,,..',
    '..~..""...T',
    '..~~.....C.',
    '...~..T....',
    '...~.......',
    '===B==2====',
    '...~...T...',
    '.H.~..,,...',
    '...~~....R.',
    '....~..""..',
    'T...~....T.',
    'TT..~...TTT',
  ],
  grove: [
    'T....ff....',
    '..C..f.,,..',
    '...."".....',
    '.R....T..C.',
    '......T....',
    '.,,........',
    '=====3=====',
    '....T...,,.',
    '.""....R...',
    '...H.......',
    '.T...ff....',
    '....T....T.',
    'TT.....TTTT',
  ],
  plaza: [
    'TT..,,,..TT',
    'T.........T',
    '..R.....R..',
    '....fff....',
    '...f...f...',
    '..f.....f..',
    '=====.F...H',
    '..f.....f..',
    '...f...f...',
    '....f.f....',
    '.C.......C.',
    'T..,,.,,..T',
    'TT.......TT',
  ],
};

function buildLayout(zoneNames) {
  const zones = zoneNames.map((n) => ZONES[n]);
  const width = 1 + zones.length * 12;
  const rows = ['#'.repeat(width)];
  for (let r = 0; r < 13; r++) {
    let line = '#';
    zones.forEach((z, i) => {
      line += z[r].replace('3', String(i + 1)).replace(/[12]/, String(i + 1));
      if (i < zones.length - 1) line += r === 6 ? 'abc'[i] : '#';
    });
    rows.push(line + '#');
  }
  rows.push('#'.repeat(width));
  return rows;
}

const LAYOUTS = [
  buildLayout(['meadow', 'river', 'grove', 'plaza']),
  buildLayout(['pond', 'grove', 'river', 'plaza']),
];

// floor: 풀밭 두 톤, tree: 나무 잎 두 톤, path: 흙길, water: 물, deco: 꽃 색
const THEMES = {
  blue:   { floor: '#c9ecc0', floor2: '#bfe5b5', tree: '#5fbf6a', tree2: '#86d98a', path: '#f3dcae', water: '#8fd8f7', deco: ['#ffd34d', '#ffffff', '#8fb8ff'] },
  purple: { floor: '#d9f0c5', floor2: '#cfe9b9', tree: '#8f7fd6', tree2: '#b5a8f0', path: '#f5dfc0', water: '#9fd4f5', deco: ['#ff9ec7', '#ffffff', '#c9b6ff'] },
  green:  { floor: '#bfe7a8', floor2: '#b3df9a', tree: '#3fa45a', tree2: '#6fc77a', path: '#efd3a0', water: '#86d1f2', deco: ['#ffd34d', '#ff8fab', '#ffffff'] },
  red:    { floor: '#d6efc0', floor2: '#cbe8b3', tree: '#e07b8b', tree2: '#f5a5b2', path: '#f4dbb5', water: '#8fd8f7', deco: ['#ffd34d', '#ffffff', '#ff8fab'] },
  gray:   { floor: '#c8e3c0', floor2: '#bddbb4', tree: '#2f7d5b', tree2: '#4e9c78', path: '#dcd6c8', water: '#7cc4e0', deco: ['#a0f0a0', '#ffffff', '#ffe08a'] },
  sand:   { floor: '#d9edb6', floor2: '#cfe5aa', tree: '#4fae63', tree2: '#7dcc7e', path: '#f2d7a3', water: '#7fd0f5', deco: ['#ff9e6b', '#ffffff', '#ffd34d'] },
  gold:   { floor: '#e3f0bd', floor2: '#d9e9b0', tree: '#e0a63f', tree2: '#f5c76b', path: '#f3dfb6', water: '#8fd8f7', deco: ['#ff8fab', '#ffffff', '#8fb8ff'] },
  sky:    { floor: '#d6f0e6', floor2: '#cae9dc', tree: '#7fc8e8', tree2: '#b2e2f5', path: '#f4e6c8', water: '#a5e1fa', deco: ['#ffffff', '#ffd34d', '#c9b6ff'] },
};

// ---------- 과목 ----------
// tier: 난이도(★ 수). 강의 레벨·분량·공격력은 tier와 강의 순서로 정해진다

const SUBJECT_DEFS = [
  {
    id: 'comp', subject: '컴퓨터의 이해', place: '비트 연구소', icon: '💻', tier: 1, layout: 0, theme: 'blue',
    lectures: [
      { name: '수의 진법', mob: '비트 부엉이', icon: '🦉', gen: ['radix'], card: '2진수는 2로 나눈 나머지를 거꾸로 읽고, 16진수는 2진수를 4자리씩 끊어 바꾼다.' },
      { name: '자료의 표현', mob: '보수 도마뱀', icon: '🦎', gen: ['datarep'], card: '1바이트 = 8비트, 1KB = 1024바이트. 음수는 2의 보수(비트 반전 + 1)로 나타낸다.' },
      { bank: ['extra', 'comp3'] },
    ],
    final: { name: '컴퓨터의 이해 기말고사', mob: '마더보드 골렘', icon: '🤖', card: '진법, 자료의 표현, 하드웨어·소프트웨어 기초 총정리.' },
  },
  {
    id: 'dm', subject: '이산수학', place: '논리의 정원', icon: '🔢', tier: 1, layout: 1, theme: 'purple',
    lectures: [
      { name: '집합', mob: '집합 문어', icon: '🐙', gen: ['sets'], card: '|A ∪ B| = |A| + |B| − |A ∩ B|. 원소가 n개인 집합의 부분집합은 2ⁿ개.' },
      { bank: ['extra', 'dm2'] },
      { name: '순열과 조합', mob: '팩토리얼 토끼', icon: '🐇', gen: ['comb'], card: '순서가 있으면 순열 nPr, 순서가 없으면 조합 nCr = nPr ÷ r!' },
    ],
    final: { name: '이산수학 기말고사', mob: '그래프 드래곤', icon: '🐲', card: '집합, 명제 논리, 순열과 조합 총정리.' },
  },
  {
    id: 'ds', subject: '자료구조', place: '자료의 숲', icon: '🌲', tier: 2, layout: 0, theme: 'green',
    lectures: [
      { name: '스택과 큐', mob: '스택 펭귄', icon: '🐧', gen: ['stackq'], card: '스택은 나중에 넣은 것이 먼저 나오고(LIFO), 큐는 먼저 넣은 것이 먼저 나온다(FIFO).' },
      { name: '트리', mob: '순회 원숭이', icon: '🐒', gen: ['tree'], card: '전위: 루트→왼→오, 중위: 왼→루트→오, 후위: 왼→오→루트. 배열에서 i번의 자식은 2i, 2i+1.' },
      { bank: ['extra', 'ds3'] },
    ],
    final: { name: '자료구조 기말고사', mob: '해시 공룡', icon: '🦖', card: '스택·큐, 트리, 정렬·탐색과 시간복잡도 총정리.' },
  },
  { id: 'cpp', subject: 'C++', place: '클래스 성채', icon: '🧩', tier: 2, layout: 1, theme: 'red', bank: 'cpp' },
  { id: 'unix', subject: 'UNIX시스템', place: '터미널 동굴', icon: '🐚', tier: 2, layout: 0, theme: 'gray', bank: 'unix' },
  { id: 'os', subject: '운영체제', place: '커널 항구', icon: '⚙️', tier: 3, layout: 1, theme: 'sand', bank: 'os' },
  { id: 'pl', subject: '프로그래밍언어론', place: '문법 도서관', icon: '🔤', tier: 3, layout: 0, theme: 'gold', bank: 'pl' },
  { id: 'cloud', subject: '클라우드컴퓨팅', place: '구름 섬', icon: '☁️', tier: 4, layout: 1, theme: 'sky', bank: 'cloud' },
];

const LECTURE_DIFF = [[0.5, 0.4, 0.1], [0.35, 0.45, 0.2], [0.3, 0.45, 0.25]];

function lectureStats(tier, i, final) {
  const level = 1 + (tier - 1) * 3 + i;
  return {
    level,
    volume: Math.round((140 + level * 40) * (final ? 1.3 : 1)),
    attack: 10 + level * 2,
    exp: Math.round((25 + level * 12) * (final ? 2 : 1)),
  };
}

function buildStage(def) {
  const banks = globalThis.BANKS || {};
  let lecDefs, finalDef;
  if (def.bank) {
    const b = banks[def.bank];
    if (!b) return null;
    lecDefs = b.lectures;
    finalDef = b.final;
  } else {
    lecDefs = def.lectures.map((l) => (l.bank ? (banks[l.bank[0]] || {})[l.bank[1]] : l));
    finalDef = def.final;
  }
  if (lecDefs.some((l) => !l)) return null;
  const lectures = lecDefs.map((l, i) => {
    let gen = l.gen;
    if (!gen) { const key = `${def.id}-${i}`; GEN[key] = bankGen(l.questions); gen = [key]; }
    return {
      ...lectureStats(def.tier, i, false), id: `${def.id}${i + 1}`,
      name: l.name, mob: l.mob, icon: l.icon, card: l.card, gen, diff: LECTURE_DIFF[i], time: l.gen ? 20 : 22,
    };
  });
  lectures.push({
    ...lectureStats(def.tier, 3, true), id: `${def.id}F`, final: true,
    name: finalDef.name, mob: finalDef.mob, icon: finalDef.icon, card: finalDef.card,
    gen: lectures.flatMap((l) => l.gen), diff: [0.15, 0.45, 0.4], time: 22,
  });
  return {
    id: def.id, subject: def.subject, place: def.place, icon: def.icon, tier: def.tier,
    theme: THEMES[def.theme], map: LAYOUTS[def.layout], lectures,
    reward: { exp: 60 + def.tier * 40, items: { highlighter: 2, energy: 1, pass: 1, choco: 2 } },
  };
}

const STAGES = SUBJECT_DEFS.map(buildStage).filter(Boolean);

// ---------- 아이템 ----------

const ITEMS = {
  highlighter: { name: '형광펜', icon: '🖍️', key: 'Q', desc: '오답 선택지 1개를 지운다. (문제당 최대 2번)' },
  pass: { name: '패스권', icon: '🎫', key: 'W', desc: '이번 문제를 정답으로 처리한다.' },
  energy: { name: '에너지 드링크', icon: '⚡', key: 'E', desc: '다음 정답의 진도가 2배가 된다.' },
  choco: { name: '초콜릿', icon: '🍫', key: 'R', desc: '집중력을 30 회복한다.' },
};

const LOOT = [['highlighter', 35], ['choco', 30], ['energy', 25], ['pass', 10]];

// ---------- 성장·전투 수치 ----------

const RULES = {
  statsAt: (lv) => ({ maxFocus: 50 + (lv - 1) * 6, int: 20 + (lv - 1) * 4, spd: 10 + (lv - 1) * 3 }),
  expToNext: (lv) => 40 + (lv - 1) * 50,
  diffMult: { 1: 1.0, 2: 1.2, 3: 1.5 },
  revWrong: { 1: 0.2, 2: 0.45, 3: 0.7 },   // 역질문에서 강의가 틀릴 확률
  critChance: 0.08,
  itemLimit: 3,
  gradeMult: { 'A+': 1.5, A: 1.3, B: 1.1, C: 1.0, D: 1.0 },
  gpa: { 'A+': 4.5, A: 4.0, B: 3.0, C: 2.0, D: 1.0 },
  gradeOf(acc) {
    if (acc >= 0.999) return 'A+';
    if (acc >= 0.85) return 'A';
    if (acc >= 0.7) return 'B';
    if (acc >= 0.55) return 'C';
    return 'D';
  },
};

// ---------- 업적 ----------

const doneCount = (s) => Object.keys(s.done).length;

const ACHIEVEMENTS = [
  { id: 'first', icon: '🌱', name: '첫 수강', desc: '강의를 처음으로 이수했다.', test: (s) => Object.keys(s.cleared).length >= 1 },
  { id: 'subject', icon: '📜', name: '첫 이수증', desc: '과목 하나를 이수했다.', test: (s) => doneCount(s) >= 1 },
  { id: 'half', icon: '🏃', name: '반환점', desc: '과목 4개를 이수했다.', test: (s) => doneCount(s) >= 4 },
  { id: 'graduate', icon: '🎓', name: '졸업', desc: '모든 과목을 이수했다.', test: (s) => doneCount(s) >= STAGES.length },
  { id: 'streak5', icon: '🌊', name: '물 흐르듯', desc: '한 배틀에서 5문제 연속 정답.', test: (s) => s.stats.bestStreak >= 5 },
  { id: 'streak10', icon: '🔥', name: '몰입의 경지', desc: '한 배틀에서 10문제 연속 정답.', test: (s) => s.stats.bestStreak >= 10 },
  { id: 'aplus', icon: '💯', name: '만점', desc: '강의에서 A+를 받았다.', test: (s) => Object.values(s.cleared).includes('A+') },
  { id: 'sharp', icon: '🗡️', name: '날카로운 지적', desc: '역질문으로 강의의 오답을 5번 지적했다.', test: (s) => s.stats.sharp >= 5 },
  { id: 'speedy', icon: '⚡', name: '번개 손', desc: '3초 안에 정답을 10번 맞혔다.', test: (s) => s.stats.fast >= 10 },
  { id: 'treasure', icon: '🎁', name: '보물 사냥꾼', desc: '상자를 8개 열었다.', test: (s) => s.stats.chests >= 8 },
  { id: 'level5', icon: '⭐', name: '성장 중', desc: '레벨 5를 달성했다.', test: (s) => s.level >= 5 },
  { id: 'cram', icon: '😵', name: '벼락치기', desc: '집중력 20% 이하로 기말고사를 통과했다.', hidden: true,
    test: (s, e) => !!e && e.type === 'win' && e.final && e.focusRatio <= 0.2 },
  { id: 'noitem', icon: '🧠', name: '실력파', desc: '아이템 없이 기말고사를 통과했다.', hidden: true,
    test: (s, e) => !!e && e.type === 'win' && e.final && e.itemsUsed === 0 },
];

if (typeof module !== 'undefined') {
  module.exports = { U, GEN, STAGES, SUBJECT_DEFS, ITEMS, LOOT, RULES, ACHIEVEMENTS, buildQuestion, numVal };
}
