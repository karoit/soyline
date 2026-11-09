// 상온제품 주간생산계획 PDF → 날짜 × 멸균호기 칸별 품목 목록
// 양식: 머리행 "멸균1호기 … 멸균5호기", 그 아래 "제품명 / 생산량(개) / Batch(L)" 칸, 오른쪽 끝 "두유원액·원액생산",
//       왼쪽 "10/12 월" 날짜 줄. 칸 안에는 품목마다 [제품명 생산량] → [5자리 제품코드] → (포장) → 시간 순으로 적혀 있음.

function pLines(items, tol = 2.5) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const out = [];
  for (const it of sorted) {
    const ln = out.find(l => Math.abs(l.y - it.y) <= tol);
    if (ln) ln.items.push(it); else out.push({ y: it.y, items: [it] });
  }
  for (const l of out) l.items.sort((a, b) => a.x - b.x);
  return out;
}
// 글자 단위로 쪼개진 조각을 단어로 합치기
function pWords(items) {
  const out = [];
  for (const l of pLines(items)) {
    let cur = null;
    for (const it of l.items) {
      const gap = cur ? it.x - (cur.x + cur.w) : Infinity;
      if (cur && gap < 2.2) { cur.str += it.str; cur.w = it.x + it.w - cur.x; }
      else if (cur && gap < 4.5 && !/\s$/.test(cur.str)) { cur.str += ' ' + it.str; cur.w = it.x + it.w - cur.x; }
      else { cur && out.push(cur); cur = { ...it, y: l.y }; }
    }
    cur && out.push(cur);
  }
  return out.map(w => ({ ...w, str: w.str.replace(/\s+/g, ' ').trim() })).filter(w => w.str);
}
const pText = l => l.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
const P_CODE = /^\d{5}$/;
const P_QTY = /^\d{1,3}(,\d{3})+$|^\d{4,}$/;
const P_PACK = /^\(.*\)$/;
const P_TIME = /\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}/;

export function parsePlan(rawItems, { today = new Date() } = {}) {
  const warn = [];
  const W = pWords(rawItems);
  const find = re => W.filter(w => re.test(w.str.replace(/\s/g, '')));

  // 1) 머리행: 호기 이름, 제품명·생산량·Batch 칸 위치
  const steril = find(/^멸균\d호기/).sort((a, b) => a.x - b.x);
  const nameH = find(/^제품명$/).sort((a, b) => a.x - b.x);
  const qtyH = find(/^생산량/).sort((a, b) => a.x - b.x);
  const batchH = find(/^Batch/).sort((a, b) => a.x - b.x);
  if (steril.length < 3 || nameH.length !== steril.length || batchH.length !== steril.length)
    throw new Error('계획표 머리행("멸균1호기", "제품명", "Batch(L)")을 찾지 못했습니다. 양식이 바뀌었는지 확인해 주세요.');
  const dayH = find(/^요일$/)[0];
  const subH = find(/^포장기$/);
  const headerBottom = Math.min(...nameH.map(w => w.y), ...subH.map(w => w.y)) - 2;
  const cols = steril.map((s, k) => {
    const left = k === 0 ? (dayH ? dayH.x + dayH.w + 1.5 : nameH[0].x - 18) : batchH[k - 1].x + batchH[k - 1].w + 2.5;
    return {
      no: Number(s.str.replace(/\s/g, '').match(/멸균(\d)/)[1]),
      label: s.str.replace(/\s/g, ''),
      left, qtyX: qtyH[k] ? qtyH[k].x - 4 : (nameH[k].x + batchH[k].x) / 2,
      batchX: batchH[k].x - 2, right: batchH[k].x + batchH[k].w + 2.5,
    };
  });
  const rawLeft = cols[cols.length - 1].right; // 두유원액·원액생산

  // 2) 날짜 줄
  const dates = W.filter(w => /^\d{1,2}\/\d{1,2}$/.test(w.str) && w.x < cols[0].left && w.y < headerBottom).sort((a, b) => b.y - a.y);
  if (dates.length < 5) throw new Error(`날짜 칸("10/12" 형태)을 ${dates.length}개만 찾았습니다.`);
  const totalLine = W.find(w => /^합\s*계$/.test(w.str) && w.x < cols[0].left);
  const bottom = totalLine ? totalLine.y + 4 : dates[dates.length - 1].y - (dates[0].y - dates[1].y) / 2;
  const tsMatch = W.map(w => w.str.match(/(20\d{2})-(\d{2})-(\d{2})/)).find(Boolean);
  const year = tsMatch ? Number(tsMatch[1]) : today.getFullYear();
  if (!tsMatch) warn.push('작성일(연도)을 찾지 못해 올해로 가정했습니다.');
  let prevMonth = null, y0 = year;
  const days = dates.map((d, i) => {
    const top = i === 0 ? headerBottom : (dates[i - 1].y + d.y) / 2;
    const bot = i === dates.length - 1 ? bottom : (d.y + dates[i + 1].y) / 2;
    const [m, dd] = d.str.split('/').map(Number);
    if (prevMonth === 12 && m === 1) y0 += 1;
    prevMonth = m;
    const date = `${y0}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    const wd = W.find(w => /^[월화수목금토일]$/.test(w.str) && Math.abs(w.y - d.y) < 6 && w.x < cols[0].left);
    return { date, label: `${m}/${dd}`, wd: wd?.str || '', top, bot };
  });

  // 3) 칸 나누기
  const inRow = (w, d) => w.y <= d.top && w.y > d.bot;
  const cellOf = (d, x0, x1) => rawItems.filter(it => inRow(it, d) && it.x + (it.w || 0) / 2 >= x0 && it.x + (it.w || 0) / 2 < x1);
  const cells = [];
  for (const d of days) {
    for (const c of cols) {
      const its = cellOf(d, c.left, c.batchX);
      const batch = pLines(cellOf(d, c.batchX, c.right)).map(pText).join(' ');
      cells.push({ date: d.date, col: c.no, ...parseCell(its, c.qtyX), batch });
    }
    const raw = cellOf(d, rawLeft, 10000);
    const txt = pLines(raw).map(pText).filter(Boolean);
    cells.push({ date: d.date, col: 0, items: [], note_src: txt.join(' '), batch: '' });
  }
  const title = (W.find(w => /주간생산계획/.test(w.str))?.str || '주간생산계획').trim();
  return { title, start: days[0].date, end: days[days.length - 1].date, days: days.map(({ date, label, wd }) => ({ date, label, wd })), cols: cols.map(({ no, label }) => ({ no, label })), cells, warn };
}

// 칸 안의 글자 → 품목 목록
function parseCell(its, qtyX) {
  const L = pLines(pWords(its), 2.2);
  const items = []; let names = [], qty = null; const extra = [];
  let pack = '', time = '';
  for (const l of L) {
    const t = pText(l);
    if (!t) continue;
    if (P_TIME.test(t)) { time = t.match(P_TIME)[0].replace(/\s/g, ''); continue; }
    if (P_PACK.test(t)) { pack = t.replace(/[()]/g, '').trim(); continue; }
    const codeWord = l.items.find(w => P_CODE.test(w.str));
    if (codeWord && l.items.length === 1) {
      items.push({ code: codeWord.str, name: names.join(' ').trim(), qty });
      names = []; qty = null; continue;
    }
    const q = l.items.filter(w => w.x >= qtyX && P_QTY.test(w.str));
    const n = l.items.filter(w => !q.includes(w)).map(w => w.str).join(' ').trim();
    if (q.length) qty = Number(q[q.length - 1].str.replace(/,/g, ''));
    if (n) names.push(n);
  }
  if (names.length) extra.push(names.join(' '));
  for (const it of items) { it.pack = pack; it.time = time; }
  return { items, note_src: extra.join(' ').replace(/\s+/g, ' ').trim() };
}
