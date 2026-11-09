// 주간 근무표 PDF에서 착즙 오전(주간)·오후(야간), 4층, 배합, 휴무자를 읽어냅니다.
// 양식: 위쪽에 "기간 : 10월 19일 ~ 10월 25일", 머리행에 "19(월) … 25(일)",
//       왼쪽 구분 열에 "착즙" 이 두 번(오전 칸, 오후 칸) 있고, 각 "착즙" 줄 바로 위가 근무시간, 바로 아래가 근무자.

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
let pdfjsReady = null;
function loadPdfJs() {
  if (globalThis.pdfjsLib) return Promise.resolve(globalThis.pdfjsLib);
  return (pdfjsReady ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = PDFJS + 'pdf.min.js';
    s.onload = () => { globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; res(globalThis.pdfjsLib); };
    s.onerror = () => { pdfjsReady = null; rej(new Error('PDF 읽기 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
    document.head.append(s);
  }));
}

// PDF 파일 → 글자 조각 목록 [{str, x, y, w}] (y는 아래에서 위로)
export async function pdfItems(file) {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/', cMapPacked: true }).promise;
  const page = await pdf.getPage(1);
  const tc = await page.getTextContent();
  return tc.items.filter(i => i.str && i.str.trim()).map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
}

// 글자가 그림으로 들어 있는 PDF(화면 캡처형): 브라우저에서 글자 인식(OCR, tesseract.js)
// 결과를 pdfItems와 같은 모양 {str, x, y, w}(PDF 좌표, y는 아래에서 위로)으로 돌려줌
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let tessReady = null;
function loadTesseract() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  return (tessReady ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = TESS;
    s.onload = () => res(globalThis.Tesseract);
    s.onerror = () => { tessReady = null; rej(new Error('글자 인식 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
    document.head.append(s);
  }));
}
// 그림 PDF → 회색조 밝기 배열 + 캔버스
async function renderForOcr(file) {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(4, 3000 / base.width);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas'); canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return toGray(canvas);
}
export function toGray(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, img = ctx.getImageData(0, 0, W, H), px = img.data;
  const g = new Uint8Array(W * H);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) { const l = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]); g[j] = l; px[i] = px[i + 1] = px[i + 2] = l; }
  ctx.putImageData(img, 0, 0);
  return { canvas, g, W, H };
}

// 표의 선(가로·세로 테두리)을 찾아 칸 위치를 정함. 글자 위치에 기대지 않아서 칸이 밀리지 않음
const LINE = 235, INK = 160;
const groups = (idx, gap = 2) => { const o = []; for (const v of idx) { const l = o[o.length - 1]; if (l && v - l[1] <= gap) l[1] = v; else o.push([v, v]); } return o; };
export function rosterGrid({ g, W, H }) {
  const rowCnt = new Int32Array(H);
  for (let y = 0; y < H; y++) { let c = 0; const o = y * W; for (let x = 0; x < W; x++) if (g[o + x] < LINE) c++; rowCnt[y] = c; }
  const hIdx = []; for (let y = 0; y < H; y++) if (rowCnt[y] > W * 0.5) hIdx.push(y);
  let hl = groups(hIdx);
  if (hl.length < 6) throw new Error('근무표의 표 선을 찾지 못했습니다.');
  // 머리행(남색 칠한 줄)은 두꺼운 덩어리 → 그 아래가 본문 시작
  const thick = Math.max(6, H * 0.012);
  const hi = hl.findIndex(l => l[1] - l[0] > thick);
  const headTop = hl[Math.max(0, hi)][0];
  if (hi > 0) hl = hl.slice(hi);
  const top = hl[0][1], bottom = hl[hl.length - 1][0];
  const span = bottom - headTop;
  const colCnt = new Int32Array(W);
  for (let y = headTop; y <= bottom; y++) { const o = y * W; for (let x = 0; x < W; x++) if (g[o + x] < LINE) colCnt[x]++; }
  const vIdx = []; for (let x = 0; x < W; x++) if (colCnt[x] > span * 0.8) vIdx.push(x);
  const vl = groups(vIdx);
  if (vl.length < 4) throw new Error('근무표의 날짜 칸을 찾지 못했습니다.');
  // 오른쪽부터 같은 너비가 이어지는 칸 = 날짜 칸
  const cols = vl.slice(1).map((l, i) => [vl[i][1] + 1, l[0] - 1]);
  const last = cols[cols.length - 1], w0 = last[1] - last[0];
  let k = cols.length - 1; while (k > 0 && Math.abs((cols[k - 1][1] - cols[k - 1][0]) - w0) < w0 * 0.12) k--;
  const days = cols.slice(k), left = [vl[0][1] + 1, days[0][0] - 2];
  const bands = hl.slice(1).map((l, i) => [hl[i][1] + 1, l[0] - 1]).filter(b => b[1] - b[0] > 6);
  return { headTop, top, bottom, days, left, bands };
}
// 상자 안의 글자 줄 위치 [{x0,y0,x1,y1}]. 짧은 "-" 는 빼고 돌려줌
export function inkLines({ g, W }, x0, y0, x1, y1) {
  const minH = Math.max(4, Math.round(W / 400)), out = [];
  let s = -1;
  const rowInk = y => { const o = y * W; for (let x = x0; x <= x1; x++) if (g[o + x] < INK) return true; return false; };
  const close = (a, b) => {
    if (b - a < minH) return;
    let lx = x1, rx = x0;
    for (let y = a; y < b; y++) { const o = y * W; for (let x = x0; x <= x1; x++) if (g[o + x] < INK) { if (x < lx) lx = x; if (x > rx) rx = x; } }
    if (rx - lx < (b - a) * 1.2) return; // "-" 또는 점
    out.push({ x0: lx, y0: a, x1: rx, y1: b });
  };
  for (let y = y0; y <= y1; y++) { const ink = rowInk(y); if (ink && s < 0) s = y; if (!ink && s >= 0) { close(s, y); s = -1; } }
  if (s >= 0) close(s, y1 + 1);
  return out;
}

// 그림으로 된 주간근무표 읽기: 표 선으로 칸을 나누고, 칸 안의 글자 줄을 한 줄씩 인식
export async function readRosterImage(file, { known = [], today = new Date(), onProgress } = {}) {
  const img = await renderForOcr(file);
  const T = await loadTesseract();
  const worker = await T.createWorker('kor', 1);
  let psm = '';
  const recognize = async (b, mode) => {
    if (psm !== mode) { await worker.setParameters({ tessedit_pageseg_mode: mode }); psm = mode; }
    const pad = 10, c = document.createElement('canvas');
    const x0 = Math.max(0, b.x0 - 8), y0 = Math.max(0, b.y0 - 6), w = Math.min(img.W, b.x1 + 9) - x0, h = Math.min(img.H, b.y1 + 7) - y0;
    c.width = w + pad * 2; c.height = h + pad * 2;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img.canvas, x0, y0, w, h, pad, pad, w, h);
    const { data } = await worker.recognize(c);
    return (data.text || '').trim();
  };
  try { return await readRosterGray(img, recognize, { known, today, onProgress }); }
  finally { await worker.terminate(); }
}

// recognize(box, psm) → 글자. 브라우저는 tesseract.js, 시험할 때는 다른 인식기를 넣을 수 있음
export async function readRosterGray(img, recognize, { known = [], today = new Date(), onProgress } = {}) {
  const prog = p => onProgress && onProgress(p);
  const warn = [];
  prog(0.03);
  const G = rosterGrid(img);
  const nDays = G.days.length;
  const bandH = Math.min(...G.bands.map(b => b[1] - b[0]));
  // 기간 줄: 표 위쪽 왼편
  let period = '';
  for (const l of inkLines(img, 0, Math.max(0, G.headTop - bandH * 3), Math.round(img.W * 0.55), G.headTop - 4)) {
    period += await recognize(l, '7') + ' ';
  }
  const pm = period.replace(/\s/g, '').replace(/[∼〜～–—−-]/g, '~').match(/(\d{1,2})월(\d{1,2})일~(\d{1,2})월(\d{1,2})일/);
  if (!pm) throw new Error('근무표에서 "기간 : ○월 ○일 ~ ○월 ○일" 줄을 읽지 못했습니다.');
  const nPeriod = Math.round((new Date(2000, pm[3] - 1, pm[4]) - new Date(2000, pm[1] - 1, pm[2])) / 864e5) + 1;
  if (nPeriod !== nDays) warn.push(`기간은 ${nPeriod}일인데 표의 날짜 칸은 ${nDays}개입니다. 날짜를 확인해 주세요.`);
  // 칸 읽기
  const total = G.bands.length * nDays; let done = 0;
  const cell = async (band, i, mode = '7') => {
    const [x0, x1] = G.days[i];
    const ls = inkLines(img, x0 + 6, band[0] + 4, x1 - 6, band[1] - 3);
    const t = []; for (const l of ls) t.push(ocrClean(await recognize(l, mode)));
    prog(0.05 + 0.9 * (++done / total));
    t.boxes = ls;
    return t;
  };
  const row = async band => { const r = []; for (let i = 0; i < nDays; i++) r.push(await cell(band, i)); return r; };
  const isTime = cells => { const f = cells.filter(c => c.length); return f.length > 0 && f.every(c => TIME_RE.test(c.join(''))); };
  const hoursOf = c => { const m = c.join('').replace(/\s/g, '').match(/\d{1,2}:\d{2}(?:[~\-]?\d{1,2}:\d{2}|~)?/); return m ? m[0].replace(/(\d{2})-(\d)/, '$1~$2').replace(/(\d{2}:\d{2})(\d)/, '$1~$2') : ''; };
  // 시간 칸 하나가 "07:30~" 처럼 덜 읽히면: 다른 방식으로 다시 읽고, 그래도 안 되면 같은 줄의 다른 날 시간(시작이 같은 것)으로 채움
  const FULL = /^\d{1,2}:\d{2}~\d{1,2}:\d{2}$/;
  const fixHours = async r => {
    const hs = r.map(hoursOf);
    for (let i = 0; i < hs.length; i++) {
      if (FULL.test(hs[i]) || !r[i].boxes || !r[i].boxes.length) continue;
      const peers = hs.filter(h => FULL.test(h) && (!hs[i] || h.startsWith(hs[i].replace(/~$/, ''))));
      if (!peers.length) continue; // 줄 전체가 "16:00~" 같은 경우는 그대로
      for (const mode of ['13', '6']) {
        const t = []; for (const l of r[i].boxes) t.push(ocrClean(await recognize(l, mode)));
        const h = hoursOf(t); if (FULL.test(h)) { hs[i] = h; break; }
      }
      if (!FULL.test(hs[i])) { const cnt = {}; peers.forEach(h => { cnt[h] = (cnt[h] || 0) + 1; }); hs[i] = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0]; }
    }
    return hs;
  };
  const blocks = []; let restCells = null;
  for (let b = 0; b < G.bands.length; b++) {
    const r = await row(G.bands[b]);
    if (isTime(r) && b + 1 < G.bands.length) {
      const names = await row(G.bands[b + 1]);
      const ls = inkLines(img, G.left[0] + 4, G.bands[b][0] + 3, G.left[1] - 4, G.bands[b + 1][1] - 3);
      let left = ''; for (const l of ls) left += await recognize(l, '7');
      blocks.push({ hours: await fixHours(r), names: names.map(c => c.join(',')), left: left.replace(/\s/g, '') });
      b++;
    } else if (blocks.length) { restCells = r.map(c => c.join(',')); break; }
  }
  prog(0.97);
  if (!restCells) warn.push('"휴무자" 칸을 찾지 못했습니다.');
  // 칸 이름 (배합/착즙/4층/정상)
  const sub = s => (/[착즙즘줍]/.test(s) ? '착즙' : /층|^4/.test(s) ? '4층' : /[배합]/.test(s) ? '배합' : /정상|상$/.test(s) ? '정상' : '');
  const TEMPLATE = ['배합', '착즙', '배합', '배합', '착즙', '4층', '정상'];
  blocks.forEach(b => { b.label = sub(b.left); });
  if (blocks.length === TEMPLATE.length && blocks.filter((b, k) => b.label && b.label !== TEMPLATE[k]).length <= 2) blocks.forEach((b, k) => { b.label = TEMPLATE[k]; });
  const juice = blocks.filter(b => b.label === '착즙');
  if (juice.length < 2) throw new Error(`근무표에서 "착즙" 칸을 ${juice.length}개만 찾았습니다. (오전·오후 2개 필요)`);
  const floor4 = blocks.find(b => b.label === '4층');
  if (!floor4) warn.push('"4층" 칸을 찾지 못했습니다.');
  const mixes = blocks.filter(b => b.label === '배합');
  mixes.forEach((b, k) => { b.part = ['오전', '중간', '오후'][k] || ''; });
  const ppl = raw => splitNames(raw, known);
  const team = raw => { const ps = ppl(raw).filter(p => p.name.length >= 3 || known.includes(p.name)); return ps.filter((p, i) => ps.findIndex(q => q.name === p.name) === i); };
  // 날짜
  let year = today.getFullYear(); const sm = Number(pm[1]);
  if (sm - (today.getMonth() + 1) > 6) year -= 1; else if ((today.getMonth() + 1) - sm > 6) year += 1;
  const WDS = ['일', '월', '화', '수', '목', '금', '토'];
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const d0 = new Date(year, sm - 1, Number(pm[2]));
  const days = G.days.map((_, i) => {
    const d = new Date(d0); d.setDate(d0.getDate() + i);
    return {
      date: iso(d), label: `${d.getMonth() + 1}/${d.getDate()}(${WDS[d.getDay()]})`,
      am: { hours: juice[0].hours[i], workers: team(juice[0].names[i]) },
      pm: { hours: juice[1].hours[i], workers: team(juice[1].names[i]) },
      floor4: floor4 ? { hours: floor4.hours[i], workers: team(floor4.names[i]) } : { hours: '', workers: [] },
      mix: mixes.flatMap(b => team(b.names[i]).map(p => ({ ...p, hours: p.hours || b.hours[i], part: b.part }))),
      rest: [...new Set(team(restCells ? restCells[i] : '').map(p => p.name))],
    };
  });
  prog(1);
  return { start: days[0].date, end: days[days.length - 1].date, days, warn, debug: { blocks: blocks.map(b => [b.label, b.part || '', b.left]), restCells } };
}

// OCR로 읽은 칸 글자 → 사람 목록. 줄바꿈·쉼표·마침표로 나누고, 붙어 버린 이름은 알려진 이름/3글자 단위로 나눔
export function splitNames(raw, known = []) {
  const s = String(raw || '').replace(/[|｜¦_]/g, '').replace(/\s*\(\s*/g, '(').replace(/\s*\)\s*/g, ')').replace(/\r?\n/g, ',').replace(/([가-힣])\s*[.·:;]\s*(?=[가-힣])/g, '$1,').replace(/([가-힣])\s+(?=[가-힣])/g, '$1');
  const out = [];
  for (const p of toPeople(s.replace(/\s+/g, ''))) {
    const name = p.name.replace(/[^가-힣]/g, '');
    if (name.length < 2 || /^[으브므너그느즈스효호프트드르흐애에]+$/.test(name)) continue; // 테두리선 등이 글자로 읽힌 잡음
    for (const n of segmentName(name, known)) out.push({ name: fixName(n, known), hours: p.hours });
  }
  return out;
}
function segmentName(s, known) {
  if (s.length <= 4) return [s];
  // 2~3글자 조각으로 나누기: 알려진 이름(한 글자 차이 포함) 우선, 그다음 3글자
  const score = n => (known.includes(n) ? 3 : fixName(n, known) !== n ? 2 : n.length === 3 ? 1 : 0);
  const memo = new Map();
  const go = i => {
    if (i === s.length) return { sc: 0, parts: [] };
    if (memo.has(i)) return memo.get(i);
    let r = { sc: -1e9, parts: [] };
    for (const L of [3, 2, 4]) { if (i + L > s.length) continue; const rest = go(i + L); const sc = rest.sc + score(s.slice(i, i + L)); if (sc > r.sc) r = { sc, parts: [s.slice(i, i + L), ...rest.parts] }; }
    memo.set(i, r); return r;
  };
  return go(0).parts;
}

const DAY_RE = /^(\d{1,2})\s*\(\s*([월화수목금토일])\s*\)$/;
const TIME_RE = /\d{1,2}:\d{2}/;

// 같은 높이의 조각을 한 줄로 묶기
function lines(items, tol = 4) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const out = [];
  for (const it of sorted) {
    const ln = out.find(l => Math.abs(l.y - it.y) <= tol);
    if (ln) ln.items.push(it); else out.push({ y: it.y, items: [it] });
  }
  for (const l of out) l.items.sort((a, b) => a.x - b.x);
  return out;
}
const joinText = its => its.map(i => i.str).join('').replace(/\s+/g, ' ').trim();

// OCR 글자 정리: 물결·하이픈 통일, 시간의 ; . → :, 표 테두리 조각 제거
const ocrClean = t => String(t).replace(/[∼〜～–—−]/g, '~').replace(/(\d)\s*[;.,]\s*(\d{2})(?!\d)/g, '$1:$2').replace(/[|｜¦]/g, '').trim();
// 이름 하나가 알려진 이름과 한 글자만 다르면 고침 (예: 황응식 → 황용식)
function fixName(name, known) {
  if (!known.length || known.includes(name)) return name;
  const near = known.filter(k => k.length === name.length && [...k].filter((ch, i) => ch !== name[i]).length <= 1);
  return near.length === 1 ? near[0] : name;
}

export function parseRoster(items, { today = new Date(), ocr = false, known = [] } = {}) {
  const warn = [];
  if (ocr) items = items.map(i => ({ ...i, str: ocrClean(i.str) })).filter(i => i.str);
  const L = lines(items, ocr ? 5 : 4);
  const people = t => {
    if (!ocr) return toPeople(t);
    const norm = String(t).replace(/\s*\(\s*/g, '(').replace(/\s*\)\s*/g, ')').replace(/([가-힣])[.·]\s*(?=[가-힣])/g, '$1,').replace(/\s+/g, ',');
    return toPeople(norm).map(p => ({ ...p, name: fixName(p.name.replace(/[^가-힣]/g, ''), known) })).filter(p => p.name.length >= 2);
  };
  // 기간 (예: "기간 : 11월 2일 ~ 11월 8일")
  const allText = L.map(l => joinText(l.items)).join(' ').replace(/\s/g, '');
  const pm = allText.match(/(\d{1,2})월(\d{1,2})일[~\-](\d{1,2})월(\d{1,2})일/);

  // 1) 날짜 머리행: "19(월)" 형태가 5개 이상 있는 줄
  let header = null;
  for (const l of L) {
    // 글자 단위로 쪼개진 경우를 위해, 가까운 조각을 붙여 단어로 만든 뒤 검사
    const words = []; let cur = null;
    for (const it of l.items) {
      if (cur && it.x - (cur.x + cur.w) < 3) { cur.str += it.str; cur.w = it.x + it.w - cur.x; }
      else { cur && words.push(cur); cur = { ...it }; }
    }
    cur && words.push(cur);
    const days = words.map(w => ({ ...w, m: w.str.replace(/\s/g, '').match(DAY_RE) })).filter(w => w.m);
    if (days.length >= 5) { header = days; break; }
  }
  let cols;
  if (header) cols = header.map(d => ({ day: Number(d.m[1]), wd: d.m[2], cx: d.x + d.w / 2 }));
  else {
    // 날짜 칸을 못 읽으면(그림 PDF 등): 시간 글자("06:00~15:00")들의 가로 위치를 기간의 날짜 수만큼 묶어 칸을 정함
    const nDays = pm ? Math.round((new Date(2000, pm[3] - 1, pm[4]) - new Date(2000, pm[1] - 1, pm[2])) / 864e5) + 1 : 7;
    const xs = items.filter(i => TIME_RE.test(i.str)).map(i => i.x + (i.w || 0) / 2).sort((a, b) => a - b);
    if (!pm || xs.length < nDays * 2 || nDays < 2 || nDays > 10) throw new Error('근무표에서 날짜 칸("19(월)" 형태)을 찾지 못했습니다. 양식이 바뀌었는지 확인해 주세요.');
    const gaps = xs.slice(1).map((x, i) => ({ i, g: x - xs[i] })).sort((a, b) => b.g - a.g).slice(0, nDays - 1).map(g => g.i).sort((a, b) => a - b);
    const groups = []; let st = 0; for (const gi of [...gaps, xs.length - 1]) { groups.push(xs.slice(st, gi + 1)); st = gi + 1; }
    const WDS = ['일', '월', '화', '수', '목', '금', '토'];
    const d0 = new Date(today.getFullYear(), Number(pm[1]) - 1, Number(pm[2]));
    cols = groups.map((g, i) => { const d = new Date(d0); d.setDate(d0.getDate() + i); return { day: d.getDate(), wd: WDS[d.getDay()], cx: g.reduce((a, b) => a + b, 0) / g.length }; });
    if (ocr) warn.push('날짜 칸 글자를 읽지 못해 "기간"으로 날짜를 정했습니다.');
  }
  const gap = cols.length > 1 ? (cols[cols.length - 1].cx - cols[0].cx) / (cols.length - 1) : 100;
  const colOf = x => { let best = -1, bd = Infinity; cols.forEach((c, i) => { const d = Math.abs(c.cx - x); if (d < bd) { bd = d; best = i; } }); return bd <= gap * 0.6 ? best : -1; };
  const leftEdge = cols[0].cx - gap * 0.5;

  // 2) 기간 → 실제 날짜
  let startMonth = pm ? Number(pm[1]) : today.getMonth() + 1;
  if (!pm) warn.push('"기간" 줄을 찾지 못해 이번 달로 가정했습니다.');
  let year = today.getFullYear();
  if (startMonth - (today.getMonth() + 1) > 6) year -= 1; else if ((today.getMonth() + 1) - startMonth > 6) year += 1;
  const start = new Date(year, startMonth - 1, cols[0].day);
  const dates = cols.map((c, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  dates.forEach((d, i) => { if (d.getDate() !== cols[i].day) warn.push(`날짜 칸 ${cols[i].day}일이 기간과 맞지 않습니다.`); });
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const cellItems = line => {
    const out = cols.map(() => []);
    if (line) for (const it of line.items) { if (it.x + (it.w || 0) / 2 < leftEdge) continue; const c = colOf(it.x + (it.w || 0) / 2); if (c >= 0) out[c].push(it); }
    return out;
  };
  const cellTexts = line => cellItems(line).map(joinText);
  const leftText = l => joinText(l.items.filter(i => i.x + (i.w || 0) / 2 < leftEdge)).replace(/\s/g, '');

  // 시간 줄: 칸 내용이 전부 "07:30~16:00", "16:00~", "-" 같은 시간뿐인 줄
  const TIME_ONLY = /^(\d{1,2}:\d{2}\s*[~\-]?\s*(\d{1,2}:\d{2})?|[-~_]+)?$/;
  const isTimeLine = l => { const c = cellTexts(l); const ok = c.filter(t => TIME_ONLY.test(t.trim())).length; return c.filter(t => TIME_RE.test(t)).length >= 3 && (ocr ? ok >= c.length - 1 : ok === c.length); };

  // 3) 칸 묶음: 시간 줄 + 그 아래 이름 줄들. 다음 시간 줄, 요약 줄, 큰 빈칸을 만나면 끝
  const STOP = /^(휴무자|배합근무|착즙근무|1팀지원)/;
  const blocks = []; let cur = null;
  for (const l of L) {
    if (header && l.y >= header[0].y - 1) continue; // 날짜 머리행과 그 위(제목·기간)는 건너뜀
    const left = leftText(l);
    if (isTimeLine(l)) { cur = { hours: cellTexts(l).map(t => (TIME_RE.test(t) ? t.replace(/\s/g, '').replace(/(\d{2})-(\d)/, '$1~$2') : '')), lines: [], left: [], lastY: l.y, y: l.y }; blocks.push(cur); continue; }
    if (!cur) continue;
    if (STOP.test(left) || cur.lastY - l.y > (ocr ? 26 : 18)) { cur = null; continue; }
    if (left) cur.left.push(left);
    cur.lines.push(l); cur.lastY = l.y;
  }
  for (const b of blocks) {
    const lab = b.left.join('');
    b.label = /착즙/.test(lab) ? '착즙' : /4층/.test(lab) ? '4층' : /배합/.test(lab) ? '배합' : /정상/.test(lab) ? '정상' : lab;
    b.part = /오.*전|전.*오/.test(lab) ? '오전' : /중.*간|간.*중/.test(lab) ? '중간' : /오.*후|후.*오/.test(lab) ? '오후' : '';
    b.names = cols.map(() => []);
    for (const l of b.lines) cellTexts(l).forEach((t, i) => b.names[i].push(...people(t)));
  }
  const juice = blocks.filter(b => b.label === '착즙');
  if (juice.length < 2) throw new Error(`근무표에서 "착즙" 칸을 ${juice.length}개만 찾았습니다. (오전·오후 2개 필요)`);
  if (juice.length > 2) warn.push('"착즙" 칸이 3개 이상이라 위의 두 칸만 사용했습니다.');
  const floor4 = blocks.find(b => b.label === '4층');
  if (!floor4) warn.push('"4층" 칸을 찾지 못했습니다.');
  const mixes = blocks.filter(b => b.label === '배합');
  mixes.forEach((b, k) => { if (!b.part) b.part = ['오전', '중간', '오후'][k] || ''; });

  // 4) 휴무자: 왼쪽 열 "휴 무 자" 줄 위아래로 여러 줄에 걸쳐 칸마다 적혀 있음
  const restCells = cols.map(() => []);
  const restLabel = L.find(l => (ocr ? /휴무/ : /^휴무자$/).test(leftText(l)));
  const stopLine = restLabel && L.find(l => l.y < restLabel.y && STOP.test(leftText(l)));
  const prevBlock = restLabel && blocks.filter(b => b.y > restLabel.y).sort((a, b) => a.y - b.y)[0];
  if (ocr && restLabel && stopLine && prevBlock) {
    // 그림 PDF: 휴무자 칸이 여러 줄 → 바로 위 칸(시간 줄 + 이름 줄) 아래부터 "배합 근무" 줄 위까지
    for (const l of L) if (l.y < prevBlock.y - 30 && l.y > stopLine.y + 3 && !TIME_RE.test(joinText(l.items))) cellTexts(l).forEach((t, i) => restCells[i].push(...people(t).map(p => p.name)));
  } else if (restLabel) {
    for (const l of L) {
      if (Math.abs(l.y - restLabel.y) > 26 || TIME_RE.test(joinText(l.items))) continue;
      const left = leftText(l);
      if (l !== restLabel && left && left !== '휴무자') continue; // 다른 구분 줄(정상, 배합 근무 등)은 제외
      cellTexts(l).forEach((t, i) => restCells[i].push(...people(t).map(p => p.name)));
    }
  } else warn.push('"휴무자" 줄을 찾지 못해 휴무 정보는 비워 두었습니다.');

  const days = cols.map((c, i) => ({
    date: iso(dates[i]), label: `${dates[i].getMonth() + 1}/${dates[i].getDate()}(${c.wd})`,
    am: { hours: juice[0].hours[i], workers: juice[0].names[i] },
    pm: { hours: juice[1].hours[i], workers: juice[1].names[i] },
    floor4: floor4 ? { hours: floor4.hours[i], workers: floor4.names[i] } : { hours: '', workers: [] },
    mix: mixes.flatMap(b => b.names[i].map(p => ({ ...p, hours: p.hours || b.hours[i], part: b.part }))),
    rest: [...new Set(restCells[i])],
  }));
  return { start: days[0].date, end: days[days.length - 1].date, days, warn };
}

// "우정균(08:00~17:00), 김진명" → [{name:'우정균', hours:'08:00~17:00'}, {name:'김진명', hours:''}]
const PERSON_TIME = /\(?\s*(\d{1,2}(?::\d{2})?\s*[~\-]\s*(?:\d{1,2}(?::\d{2})?)?)\s*\)?/;
export function toPeople(text) {
  return String(text || '').split(/[,，、/]/).map(part => {
    const m = part.match(PERSON_TIME);
    const hours = m ? m[1].replace(/\s/g, '').replace('-', '~') : '';
    const name = (m ? part.replace(m[0], '') : part).replace(/[()\s]/g, '');
    return { name, hours };
  }).filter(p => p.name && p.name !== '-');
}
// 저장용 문자열: 기본 시간과 다른 사람만 괄호로 시간 표기
export function peopleText(list, baseHours = '', always = false) {
  return list.map(p => p.name + (p.hours && (always || p.hours !== baseHours) ? `(${p.hours})` : '')).join(', ');
}
