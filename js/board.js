// 착즙실 현황판: 주간생산계획표(라인·멸균 호기·시간) + 생산기록 + 설비 상태 → 공정 흐름도
//  원료(탈피실 / 4층 그리츠·직투입) → 빈쿠커 #1~4 → WT1~4·데칸타 → 탱크 9000·8000·6000·5000
//  · 탱크는 계획표 칸(멸균 호기)으로 정함. 특이 케이스는 날짜별 수동 지정(tank_routes)
//  · 흐름 색은 라인(빈쿠커 호기)별, 원료는 호퍼 색과 글자로

// 계획표 칸(멸균 호기 번호) → 탱크. 3호기(PHE)는 착즙실 탱크를 쓰지 않음, 맨 오른쪽 원액 칸(0)은 원액으로
export const TANK_OF_COL = { 0: '원액', 1: '6000', 2: '5000', 3: '', 4: '9000', 5: '8000' };
export const TANKS = ['9000', '8000', '6000', '5000', '원액'];
export const EQS = ['WT1', 'WT2', 'WT3', 'WT4', '데칸타'];

export const matKind = m => (/반할두|약콩/.test(m || '') ? 'direct' : /서리태/.test(m || '') ? 'black' : /국산콩/.test(m || '') ? 'kor' : 'imp');
export const MAT_NAME = { imp: '대두(수입산)', kor: '국산콩(원물)', black: '서리태', direct: '4층 직투입' };
const MAT_SHORT = { imp: '수입', kor: '국산', black: '서리태', direct: '직투입' };
export const ST_NAME = { run: '가동', wait: '대기', done: '완료', late: '기록 대기', stop: '정지' };

// 계획표 칸의 "#3 WT3" / "#1 데칸타" → { cooker: 3, eq: 'WT3' }
export function parseLine(s) {
  const m = String(s || '').match(/#\s*(\d)\s*(WT\s*\d|데칸타)/i);
  return m ? { cooker: +m[1], eq: m[2].replace(/\s/g, '').toUpperCase() } : null;
}
const toMin = s => { const m = String(s || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };

// 설비 목록 상태 → 빈쿠커1~4, WT1~4, 데칸타 상태 (WT는 1차·2차 중 하나라도 정상이 아니면 그 상태)
export function eqStatusMap(equipment) {
  const st = {}; const worse = (a, b) => (a === '고장' || b === '고장' ? '고장' : a === '점검중' || b === '점검중' ? '점검중' : '정상');
  for (const e of equipment || []) {
    const n = String(e.name || '').replace(/\s/g, ''); let key = null;
    let m = n.match(/빈쿠커#?(\d)/); if (m) key = '빈쿠커' + m[1];
    m = !key && n.match(/^W\/?T(\d)/i); if (m) key = 'WT' + m[1];
    if (!key && /데칸타/.test(n)) key = '데칸타';
    if (key && e.status !== '사용안함') st[key] = worse(st[key] || '정상', e.status || '정상');
  }
  return st;
}

// 그날 라인 목록과 상태
export function boardLines({ date, plan, production, equipment, routes, nowMin, products }) {
  const st = eqStatusMap(equipment);
  const matOf = code => (products || []).find(p => p.code === code)?.material || '';
  const ov = Object.fromEntries((routes || []).filter(r => r.date === date).map(r => [r.eq, r.tanks || []]));
  const out = [];
  for (const c of (plan?.cells || []).filter(c => c.date === date && !c.hide)) {
    const ln = parseLine(c.line); if (!ln) continue;
    let items = (c.items || []).map(it => ({ ...it, mat: matOf(it.code) }));
    // 원액 칸처럼 제품 행 없이 라인만 지정된 칸: 메모(예: 99.9원액/42000kg)를 제품명으로, 원료는 조건의 원료(로스팅 대두 등)로
    if (!items.length) {
      const memo = String(c.note_src || '').replace(/\s+/g, ' ').trim();
      const name = (memo.match(/[^\s]*원액[^\s]*/) || [])[0] || (c.col === 0 ? '원액' : memo.slice(0, 20) || '제품 미기재');
      const bean = c.cond?.bean || memo;
      items = [{ code: null, name, time: '', mat: /서리태/.test(bean) ? '서리태' : /반할두|약콩/.test(bean) ? bean : /국산/.test(bean) ? '국산콩(원물)' : '대두(수입산)' }];
    }
    const m = matKind(items[0].mat);
    const tanks = ov[ln.eq] || (TANK_OF_COL[c.col] ? [TANK_OF_COL[c.col]] : []);
    const line = { date, col: c.col, ...ln, items, m, src: m === 'imp' ? '탈피실' : '그리츠', tanks, manual: !!ov[ln.eq] };
    const bad = ['빈쿠커' + ln.cooker, ln.eq].filter(k => st[k] && st[k] !== '정상');
    if (bad.length) Object.assign(line, { st: 'stop', why: bad.map(k => `${k.replace('빈쿠커', '빈쿠커 #')} ${st[k]}`).join(', ') });
    else if (items.some(it => it.code && (production || []).some(p => p.date === date && p.product_code === it.code && p.juice_meter != null))) Object.assign(line, { st: 'done', why: '착즙 연류계 입력됨' });
    else {
      let any = false, before = false, after = false, run = false;
      for (const it of items) {
        const [a, b] = String(it.time || '').split('~').map(toMin);
        if (a == null) continue; any = true;
        const end = b == null ? 1440 : b <= a ? b + 1440 : b;
        if (nowMin >= a && nowMin < end) run = true; else if (nowMin < a) before = true; else after = true;
      }
      Object.assign(line, run || !any ? { st: 'run', why: any ? '' : '시간 미기재' } : before && !after ? { st: 'wait', why: '' } : { st: 'late', why: '착즙 연류계 미입력' });
    }
    out.push(line);
  }
  return { lines: out, st };
}

// ---------------------------------------------------------------- 그림 (SVG)
const NS = 'http://www.w3.org/2000/svg';
const el = (t, a = {}, kids = []) => { const e = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); for (const c of [].concat(kids)) if (c != null) e.append(c); return e; };
const txt = (x, y, s, cls, anchor = 'start') => el('text', { x, y, class: cls, 'text-anchor': anchor }, [document.createTextNode(s)]);
const P = pts => 'M' + pts.map(p => p.join(' ')).join(' L');
const cut = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
const X = { src: 120, ck: 420, eq: 720, bus: 905, tank: 1075 };
const Y = { 탈피실: 190, 그리츠: 480, ck: [110, 245, 380, 515], eq: { WT1: 80, WT2: 192, WT3: 304, WT4: 416, '데칸타': 560 }, tank: { '9000': 110, '8000': 255, '6000': 400, '5000': 545, '원액': 690 } };
const W = { src: 180, ck: 160, eq: 160, tank: 130 };
const srcOut = s => [X.src + W.src / 2, Y[s]], ckIn = i => [X.ck - W.ck / 2, Y.ck[i]], ckOut = i => [X.ck + W.ck / 2, Y.ck[i]];
const eqIn = e => [X.eq - W.eq / 2, Y.eq[e]], eqOut = e => [X.eq + W.eq / 2, Y.eq[e]], tankIn = t => [X.tank - W.tank / 2, Y.tank[t]];
const pSrcCk = (s, i) => { const a = srcOut(s), b = ckIn(i), mx = (a[0] + b[0]) / 2 + (s === '탈피실' ? -14 : 14); return P([a, [mx, a[1]], [mx, b[1]], b]); };
const pCkEq = (i, e) => { const a = ckOut(i), b = eqIn(e), mx = (a[0] + b[0]) / 2 + (e === '데칸타' ? 18 : 0); return P([a, [mx, a[1]], [mx, b[1]], b]); };
const pEqTank = (e, t) => { const a = eqOut(e), b = tankIn(t); return P([a, [X.bus, a[1]], [X.bus, b[1]], b]); };
const flowing = s => s === 'run' || s === 'wait' || s === 'stop';
const LINE_VAR = n => `var(--bd-l${n})`, MAT_VAR = k => `var(--bd-${k})`;

function frame(g, x, y, w, h, title, color, cls) {
  g.append(el('rect', { x: x - w / 2, y: y - h / 2, width: w, height: h, rx: 10, class: 'box', style: cls === 'on' ? `stroke:${color}` : '' }));
  g.append(el('circle', { cx: x + w / 2 - 12, cy: y - h / 2 + 12, r: 5, class: 'lamp', style: cls === 'on' ? `fill:${color}` : '' }));
  g.append(txt(x - w / 2 + 10, y - h / 2 + 18, title, 'k'));
}
const hopper = (x, y, w, fill) => el('path', { d: `M${x} ${y} h${w} v${w * 0.3} l-${w * 0.3} ${w * 0.4} h-${w * 0.4} l-${w * 0.3} -${w * 0.4} z`, class: 'metal', style: fill ? `fill:${fill};fill-opacity:.8` : '' });
function iconSrc(g, x, y, kind, fill) {
  if (kind === '탈피실') {
    g.append(el('rect', { x: x - 78, y: y - 6, width: 46, height: 30, class: 'metal' }));
    g.append(hopper(x - 22, y - 12, 22, fill)); g.append(hopper(x + 6, y - 12, 22, fill));
    g.append(el('rect', { x: x + 36, y: y - 8, width: 34, height: 32, rx: 4, class: 'metal' }));
    g.append(el('circle', { cx: x + 53, cy: y + 8, r: 8, class: 'metal-l' }));
  } else { g.append(hopper(x - 44, y - 14, 40, fill)); g.append(hopper(x + 6, y - 14, 40, fill)); }
}
function iconCooker(g, x, y, fill) {
  g.append(hopper(x - 62, y - 12, 32, fill));
  g.append(el('rect', { x: x - 54, y: y + 10, width: 112, height: 16, rx: 8, class: 'metal' }));
  g.append(el('path', { d: `M${x - 48} ${y + 18} H${x + 52}`, class: 'screw' }));
  g.append(el('rect', { x: x + 18, y: y - 16, width: 36, height: 24, rx: 4, class: 'metal' }));
}
function iconHomo(g, x, y, label, color, on) {
  g.append(el('rect', { x, y, width: 44, height: 26, rx: 4, class: 'metal', style: on ? `stroke:${color}` : '' }));
  for (const dy of [5, 12, 19]) g.append(el('rect', { x: x - 10, y: y + dy - 2, width: 10, height: 4, class: 'metal' }));
  g.append(txt(x + 22, y + 17, label, 'v', 'middle'));
}
function iconDecanter(g, x, y, color, on) {
  g.append(el('path', { d: `M${x - 64} ${y + 2} h96 l22 8 v10 l-22 8 h-96 z`, class: 'metal', style: on ? `stroke:${color}` : '' }));
  g.append(el('path', { d: `M${x - 58} ${y + 15} H${x + 48}`, class: 'screw' }));
  g.append(el('rect', { x: x - 72, y: y + 30, width: 128, height: 6, class: 'metal' }));
}
function iconTank(g, x, y, colors, lv) {
  const top = y - 26, h = 60;
  g.append(el('rect', { x: x - 20, y: top, width: 40, height: h, rx: 14, class: 'metal' }));
  if (lv > 0 && colors.length) { const part = lv * (h - 8) / colors.length; colors.forEach((c, k) => g.append(el('rect', { x: x - 16, y: top + h - 4 - part * (k + 1), width: 32, height: part, rx: k ? 2 : 8, style: `fill:${c}` }))); }
}

// lines: boardLines() 결과, colorBy: 'line' | 'mat', nowMin: 탱크 액위 움직임용
export function drawBoard(svg, { lines, st, colorBy = 'line', nowMin = 0 }) {
  svg.replaceChildren();
  svg.setAttribute('viewBox', '0 0 1200 770');
  const lc = c => (c.st === 'stop' ? 'var(--bd-alarm)' : colorBy === 'line' ? LINE_VAR(c.cooker) : MAT_VAR(c.m));
  [['원료', X.src], ['빈쿠커', X.ck], ['WT · 데칸타', X.eq], ['탱크', X.tank]].forEach(([s, x]) => svg.append(txt(x, 26, s, 'colhead', 'middle')));
  const bg = el('g');
  for (const s of ['탈피실', '그리츠']) for (let i = 0; i < 4; i++) bg.append(el('path', { d: pSrcCk(s, i), class: 'pipe-bg' }));
  for (let i = 0; i < 4; i++) { bg.append(el('path', { d: pCkEq(i, 'WT' + (i + 1)), class: 'pipe-bg' })); bg.append(el('path', { d: pCkEq(i, '데칸타'), class: 'pipe-bg thin' })); }
  bg.append(el('path', { d: P([[X.bus, 70], [X.bus, 700]]), class: 'pipe-bg' }));
  for (const t of TANKS) bg.append(el('path', { d: P([[X.bus, Y.tank[t]], tankIn(t)]), class: 'pipe-bg' }));
  for (const e of EQS) bg.append(el('path', { d: P([eqOut(e), [X.bus, Y.eq[e]]]), class: 'pipe-bg' }));
  svg.append(bg);
  const live = lines.filter(c => flowing(c.st));
  const fl = el('g');
  for (const c of live) {
    const cls = 'flow' + (c.st === 'wait' ? ' wait' : c.st === 'stop' ? ' stop' : ''), i = c.cooker - 1;
    for (const d of [pSrcCk(c.src, i), pCkEq(i, c.eq), ...c.tanks.map(t => pEqTank(c.eq, t))]) fl.append(el('path', { d, class: cls, style: `stroke:${lc(c)}` }));
  }
  svg.append(fl);
  const badge = (x, y, n, col) => el('g', {}, [el('circle', { cx: x, cy: y, r: 11, class: 'badge', style: `fill:${col}` }), el('text', { x, y: y + 4, 'text-anchor': 'middle', class: 'badge-t' }, [document.createTextNode(n)])]);
  for (const c of live) {
    const i = c.cooker - 1, a = ckOut(i), b = eqIn(c.eq);
    svg.append(badge((a[0] + b[0]) / 2 + (c.eq === '데칸타' ? 18 : 0), c.eq === '데칸타' ? b[1] - 24 : (a[1] + b[1]) / 2, c.cooker, lc(c)));
    for (const t of c.tanks) svg.append(badge(X.bus + 40, Y.tank[t] + (c.cooker - 2.5) * 8, c.cooker, lc(c)));
  }
  const by = f => live.filter(f);
  const clsOf = (cs, key) => (key && st[key] && st[key] !== '정상' ? 'stop' : cs.some(c => c.st === 'run') ? 'on' : '');
  for (const s of ['탈피실', '그리츠']) {
    const cs = by(c => c.src === s), run = cs.filter(c => c.st === 'run'), cls = run.length ? 'on' : '', col = cs[0] ? MAT_VAR(cs[0].m) : '';
    const g = el('g', { class: 'node ' + cls }); frame(g, X.src, Y[s], W.src, 120, s === '그리츠' ? '4층 그리츠' : '탈피실', col, cls);
    iconSrc(g, X.src, Y[s] + 4, s, cls ? col : ''); g.append(txt(X.src - W.src / 2 + 10, Y[s] + 50, run.length ? `${run.length}개 라인 공급 중` : cs.length ? '대기' : '정지', 'v'));
    svg.append(g);
  }
  for (let i = 0; i < 4; i++) {
    const key = '빈쿠커' + (i + 1), cs = by(c => c.cooker === i + 1), c = cs[0], cls = clsOf(cs, key), col = c ? lc(c) : '';
    const sub = st[key] && st[key] !== '정상' ? st[key] : c ? c.items.map(x => x.name).join(', ') : '미가동';
    const g = el('g', { class: 'node ' + cls }); frame(g, X.ck, Y.ck[i], W.ck, 108, `빈쿠커 #${i + 1}`, col, cls);
    iconCooker(g, X.ck, Y.ck[i] - 6, c ? MAT_VAR(c.m) : '');
    if (c) g.append(txt(X.ck + W.ck / 2 - 24, Y.ck[i] - 36, MAT_SHORT[c.m], 'v', 'end'));
    g.append(txt(X.ck - W.ck / 2 + 10, Y.ck[i] + 44, cut(sub, 14), cls === 'stop' ? 'alarm' : 'v'));
    svg.append(g);
  }
  for (const e of EQS) {
    const cs = by(c => c.eq === e), c = cs[0], cls = clsOf(cs, e), col = c ? lc(c) : '', hh = e === '데칸타' ? 112 : 100;
    const sub = st[e] && st[e] !== '정상' ? st[e] : c ? `빈쿠커 #${c.cooker}에서` : '미가동';
    const g = el('g', { class: 'node ' + cls }); frame(g, X.eq, Y.eq[e], W.eq, hh, e, col, cls);
    if (e === '데칸타') iconDecanter(g, X.eq + 6, Y.eq[e] - 20, col, cls === 'on');
    else { iconHomo(g, X.eq - 52, Y.eq[e] - 14, '1차', col, cls === 'on'); iconHomo(g, X.eq + 14, Y.eq[e] - 14, '2차', col, cls === 'on'); }
    g.append(txt(X.eq - W.eq / 2 + 10, Y.eq[e] + hh / 2 - 10, cut(sub, 14), cls === 'stop' ? 'alarm' : 'v'));
    svg.append(g);
  }
  for (const t of TANKS) {
    const cs = by(c => c.tanks.includes(t)), run = cs.filter(c => c.st === 'run'), cls = run.length ? 'on' : '', col = cs[0] ? lc(cs[0]) : '';
    const g = el('g', { class: 'node ' + cls }); frame(g, X.tank, Y.tank[t], W.tank, 128, t, col, cls);
    iconTank(g, X.tank, Y.tank[t] + 6, run.map(lc), cls ? 0.25 + ((nowMin % 180) / 180) * 0.6 : 0);
    g.append(txt(X.tank - W.tank / 2 + 10, Y.tank[t] + 58, cut(cs.length ? cs.map(c => c.eq).join(', ') + ' →' : '대기', 12), 'v'));
    svg.append(g);
  }
}
