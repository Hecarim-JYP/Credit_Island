// 문제 생성기와 맵 데이터 검증: node tests/data.test.js
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const bankDir = path.join(__dirname, '..', 'js', 'banks');
for (const f of fs.readdirSync(bankDir)) require(path.join(bankDir, f));
const { STAGES, SUBJECT_DEFS, buildQuestion, numVal } = require('../js/data.js');

assert.strictEqual(STAGES.length, SUBJECT_DEFS.length, `과목 ${SUBJECT_DEFS.length}개 중 ${STAGES.length}개만 로드됨 (문제 은행 누락)`);

let count = 0;
for (const st of STAGES) {
  for (const lec of st.lectures) {
    for (let d = 1; d <= 3; d++) {
      for (let i = 0; i < 400; i++) {
        const q = buildQuestion(lec, d);
        const tag = `${lec.id} d${d} "${q.q}" [${q.choices}]`;
        assert.strictEqual(q.choices.length, 4, `선택지 4개 아님: ${tag}`);
        assert.ok(q.answer >= 0 && q.answer < 4, `정답 위치 오류: ${tag}`);
        assert.ok(q.trap >= 0 && q.trap !== q.answer, `함정 오답 오류: ${tag}`);
        assert.strictEqual(new Set(q.choices).size, 4, `선택지 중복: ${tag}`);
        assert.ok(q.choices.every((c) => c && c !== 'NaN' && c !== 'undefined'), `빈 선택지: ${tag}`);
        assert.ok(q.explain && q.explain.length > 3, `해설 없음: ${tag}`);
        count++;
      }
    }
  }
}

// 맵: 크기, 필수 타일, 문을 순서대로 열었을 때 도달 가능 여부
const LECT = ['1', '2', '3', 'F'], GATES = ['a', 'b', 'c'];
for (const st of STAGES) {
  const rows = st.map;
  rows.forEach((r, y) => assert.strictEqual(r.length, rows[0].length, `${st.id} ${y}행 길이 다름`));
  const find = (ch) => { for (let y = 0; y < rows.length; y++) { const x = rows[y].indexOf(ch); if (x >= 0) return { x, y }; } return null; };
  for (const ch of ['S', ...LECT, ...GATES]) assert.ok(find(ch), `${st.id}: ${ch} 없음`);
  const countOf = (ch) => rows.join('').split(ch).length - 1;
  assert.strictEqual(countOf('S'), 1, `${st.id}: 시작 지점이 1개가 아님`);
  assert.ok(countOf('C') >= 5, `${st.id}: 상자가 5개 미만`);
  assert.ok(countOf('H') >= 2, `${st.id}: 휴게 지점이 2개 미만`);

  const reach = (openGates) => {
    const start = find('S'), seen = new Set([`${start.x},${start.y}`]), q = [start], touch = new Set();
    while (q.length) {
      const { x, y } = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, ch = rows[ny]?.[nx];
        if (!ch) continue;
        touch.add(ch);
        const blocked = '#~CHTRfs'.includes(ch) || LECT.includes(ch) || (GATES.includes(ch) && !openGates.includes(ch));
        if (blocked || seen.has(`${nx},${ny}`)) continue;
        seen.add(`${nx},${ny}`); q.push({ x: nx, y: ny });
      }
    }
    return touch;
  };
  assert.ok(reach([]).has('1'), `${st.id}: 시작 지점에서 강의1 도달 불가`);
  assert.ok(!reach([]).has('2'), `${st.id}: 문을 안 열어도 강의2 도달 가능`);
  assert.ok(reach(['a']).has('2'), `${st.id}: 강의2 도달 불가`);
  assert.ok(reach(['a', 'b']).has('3'), `${st.id}: 강의3 도달 불가`);
  assert.ok(reach(['a', 'b', 'c']).has('F'), `${st.id}: 기말고사 도달 불가`);
}

console.log(`OK: 문제 ${count}개 생성 검증, 맵 ${STAGES.length}개 검증`);
