// 착즙팀 업무 포털 — 화면
import { CONFIG } from '../config.js';
import { createApi } from './api.js';
import { DEFAULT_SETTINGS, MODULES } from './defaults.js';
import { pdfItems, readRosterImage, parseRoster, toPeople, peopleText } from './roster.js';
import { parsePlan } from './plan.js';
import { boardLines, drawBoard, EQS, TANKS, MAT_NAME, ST_NAME, TANK_OF_COL } from './board.js';
import {
  h, clear, icon, today, addDays, fmtDate, fmtDateLong, fmtDT, fmtFull, n0, n1, n2, pct, weekStart, WD, nowLocal,
  toast, panel, confirmDlg, promptDlg, openForm, table, badge, sampleBadge, loading, card, chipsFilter, barChart, lineChart,
} from './ui.js';

let api, me = null;
const S = {};                 // 설정
const C = { people: {}, products: [], equipment: [], parts: [], usage: [], usageReady: false }; // 공용 캐시
const root = document.getElementById('app');

// 로고: config.js 의 LOGO 이미지가 있으면 사용, 없으면 '착' 글자
function brandMark(style) {
  const box = h('div', { class: 'brand-mark' + (CONFIG.LOGO ? ' has-logo' : ''), style }, CONFIG.LOGO ? null : '착');
  if (CONFIG.LOGO) {
    const img = h('img', { src: CONFIG.LOGO, alt: `${CONFIG.TEAM_NAME} 로고` });
    img.addEventListener('error', () => { box.classList.remove('has-logo'); clear(box, '착'); });
    box.append(img);
  }
  return box;
}

// ================================================================ 권한
const isAdmin = () => me?.role === 'admin' && me?.status === 'active';
const isLinked = () => !!me?.linked_from;   // 다른 포털에서 연계로 들어온 게스트 (보기만)
function can(module, action = 'read') {
  if (!me || me.status !== 'active') return false;
  if (isLinked() && action !== 'read') return false;
  if (me.role === 'admin') return true;
  return !!S.permissions?.[me.role]?.[module]?.[action];
}
const ROLE = { admin: '관리자', worker: '작업자', guest: '게스트' };
const personName = id => (id && C.people[id]?.name) || (id ? '삭제된 사용자' : '');

// ================================================================ 데이터 로딩
async function loadSettings() {
  const rows = await api.list('settings');
  for (const k of Object.keys(DEFAULT_SETTINGS)) S[k] = structuredClone(DEFAULT_SETTINGS[k]);
  for (const r of rows) S[r.id] = r.value;
  S.lists = { ...DEFAULT_SETTINGS.lists, ...(S.lists || {}) };
  // 새로 생긴 메뉴(예: 착즙실 현황판)는 저장된 권한표에 없으면 기본값으로
  for (const r of Object.keys(DEFAULT_SETTINGS.permissions)) for (const [k, v] of Object.entries(DEFAULT_SETTINGS.permissions[r])) ((S.permissions ||= {})[r] ||= {})[k] ??= { ...v };
  S.rules = { ...DEFAULT_SETTINGS.rules, ...(S.rules || {}) };
  S.yield_calc = { ...DEFAULT_SETTINGS.yield_calc, ...(S.yield_calc || {}) };
  // 설비별 수율 기준 (WT / 데칸타). 아직 저장한 적 없으면 지금 쓰는 공통 기준에서 시작
  const base = S.yield_rules || DEFAULT_SETTINGS.yield_rules, eqr = S.yield_rules_eq || {};
  S.yield_rules_eq = Object.fromEntries(YIELD_EQS.map(e => [e, Object.fromEntries(Object.keys(base).map(b => [b, { ...base[b], ...(eqr[e]?.[b] || {}) }]))]));
}
async function loadCommon() {
  const [people, products, equipment, parts, usage] = await Promise.all([
    api.list('profiles'),
    can('master') ? api.list('products', { order: 'code', asc: true }) : [],
    can('master') || can('maintenance') ? api.list('equipment', { order: 'category', asc: true }) : [],
    can('parts') ? api.list('parts', { order: 'name', asc: true }) : [],
    can('parts') || can('maintenance') ? api.list('part_usage').then(r => ({ ok: true, r }), () => ({ ok: false, r: [] })) : { ok: false, r: [] },
  ]);
  C.usage = usage.r; C.usageReady = usage.ok;   // migrate_13 실행 전이면 설비별 수량 기능은 숨김
  C.people = Object.fromEntries(people.map(p => [p.id, p]));
  // 설비: 분류(설정 순서) → 설비명(1차, 2차…) → 설비번호(1-1, 1-2, 2-1… 숫자 순)
  const catOrder = c => { const i = (S.lists?.equipment_categories || []).indexOf(c); return i < 0 ? 999 : i; };
  const nat = (a, b) => String(a || '').localeCompare(String(b || ''), 'ko', { numeric: true });
  equipment.sort((a, b) => catOrder(a.category) - catOrder(b.category) || nat(a.category, b.category) || nat(a.name, b.name) || nat(a.code, b.code));
  C.products = products; C.equipment = equipment; C.parts = parts;
}
const productName = (code, fallback) => C.products.find(p => p.code === code)?.name || fallback || code || '';
const productOpts = () => C.products.filter(p => p.active !== false).map(p => ({ value: p.code, label: `${p.code} · ${p.name}` }));
// 설비 이름: 이름에 번호가 이미 들어 있으면 번호를 다시 붙이지 않음
// 정비 구분: 관리 → 기준값에서 바꿀 수 있음. 긴급·사후정비는 '고장' 성격(증상 필수, 반복 고장 집계)
const maintKinds = () => (S.lists.maint_kinds && S.lists.maint_kinds.length ? S.lists.maint_kinds : DEFAULT_SETTINGS.lists.maint_kinds);
const isBreakdown = k => ['긴급정비', '사후정비', '고장정비'].includes(k);
// 고장 증상은 여러 개를 ", "로 이어 저장
const symptomsOf = m => String(m?.symptom || '').split(',').map(x => x.trim()).filter(Boolean);
const eqLabel = e => (e.code && !String(e.name).includes(e.code) ? `${e.name} (${e.code})` : e.name);
const eqName = id => { const e = C.equipment.find(x => x.id === id); return e ? eqLabel(e) : ''; };
const equipmentOpts = () => {
  const cats = [...new Set(C.equipment.map(e => e.category))];
  return cats.map(c => ({ group: c, items: C.equipment.filter(e => e.category === c && e.status !== '사용안함').map(e => ({ value: e.id, label: eqLabel(e) })) }));
};

// 시트와 같은 계산식
//  탈피수율 = 수입콩: 고정값(89%) / 국산콩: 2차 연류계 ÷ 1차 연류계 (4층 미가동으로 0, 0이면 88.88%)
//  대두 투입량 = 착즙 연류계 ÷ 탈피수율
//  두유액 = 두유 Output × 7%,  착즙수율 = 두유액 ÷ 착즙 연류계
//  두유수율 = 두유 Output ÷ 대두 투입량
//  직투입 원료(국산콩(반할두)·약콩): 탈피 없음 → 탈피수율 100%(1로 가정), 대두 투입량 = 착즙 연류계
//   두유수율 = 두유 Output ÷ 착즙 연류계. 수율 상태(양호·주의…) 기준은 테스트 후 정할 예정이라 판정하지 않음
function calcProduction(v) {
  const c = S.yield_calc || DEFAULT_SETTINGS.yield_calc;
  if (v.direct) {
    const liquid = v.soymilk_output_kg > 0 ? v.soymilk_output_kg * c.liquid_pct / 100 : null;
    const r = n => (n == null ? null : Math.round(n * 1e4) / 1e4);
    return { dehull_yield: 100, soy_input_kg: v.juice_meter > 0 ? r(v.juice_meter) : null, extract_yield: liquid && v.juice_meter > 0 ? r(liquid / v.juice_meter * 100) : null, liquid: r(liquid) };
  }
  const noDehull = v.meter1 === 0 && v.meter2 === 0; // 4층(탈피) 미가동: 1·2차 연류계 0, 0
  const dehull = v.bean_type === '국산콩'
    ? (noDehull ? (c.no_dehull_pct ?? 88.88) : v.meter1 > 0 && v.meter2 > 0 ? v.meter2 / v.meter1 * 100 : null)
    : (v.juice_meter > 0 || v.meter1 > 0 ? c.import_dehull_pct : null);
  const soy_input_kg = v.juice_meter > 0 && dehull ? v.juice_meter / (dehull / 100) : null;
  const liquid = v.soymilk_output_kg > 0 ? v.soymilk_output_kg * c.liquid_pct / 100 : null;
  const extract_yield = liquid && v.juice_meter > 0 ? liquid / v.juice_meter * 100 : null;
  const r = n => (n == null ? null : Math.round(n * 1e4) / 1e4);
  return { dehull_yield: r(dehull), soy_input_kg: r(soy_input_kg), extract_yield: r(extract_yield), liquid: r(liquid) };
}
// 두유수율(%) = 두유 Output ÷ 대두 투입량 × 100 → 시트 기준으로 상태 판정
const soyYield = r => (r.soy_input_kg > 0 && r.soymilk_output_kg > 0 ? r.soymilk_output_kg / r.soy_input_kg * 100 : null);
// 수율 기준은 설비별(WT / 데칸타). 설비가 정해지지 않은 기록은 WT 기준
const YIELD_EQS = ['WT', '데칸타'];
const ruleOf = (bean, eq) => S.yield_rules_eq?.[eq === '데칸타' ? '데칸타' : 'WT']?.[bean] || S.yield_rules?.[bean];
function yieldStatus(bean, y, eq) {
  const rule = ruleOf(bean, eq); if (y == null || !rule) return null;
  return y >= rule.good ? '양호' : y >= rule.caution ? '주의' : y >= rule.warning ? '경고' : '불량';
}
const YS_KIND = { 양호: 'ok', 주의: 'caution', 경고: 'warn', 불량: 'bad' };
const ysBadge = s => (s ? badge(s, YS_KIND[s]) : '');
const STATUS_KIND = { 대기: '', 진행: 'info', 완료: 'ok', 중단: 'bad', 접수: 'warn', 예정: 'info' };
const stBadge = s => badge(s, STATUS_KIND[s] ?? '');

// ================================================================ 라우팅·레이아웃
const NAV = [
  { group: null, items: [['board', '착즙실 현황판', 'prod', 'board'], ['today', '오늘의 업무', 'today', 'today']] },
  { group: '생산', items: [['plans', '주간생산계획표', 'cal', 'production'], ['production', '생산기록', 'prod', 'production'], ['silo', '대두 SILO', 'silo', 'silo']] },
  { group: '설비', items: [['maint', '정비 기록', 'wrench', 'maintenance'], ['schedule', '정비 일정', 'cal', 'maintenance'], ['equipment', '설비 목록', 'cog', 'master'], ['eqstats', '정비·부품 통계', 'chart', 'maintenance']] },
  { group: '자재·자료', items: [['parts', '부품관리', 'box', 'parts'], ['docs', '자료실', 'doc', 'docs'], ['stats', '통계', 'chart', 'stats']] },
  { group: '관리', admin: true, items: [['admin-users', '사용자·승인', 'users', null], ['admin-products', '제품·BOM', 'prod', null], ['admin-settings', '기준값·권한', 'gear', null], ['links', '연계 포털', 'users', null]] },
];
const SECTIONS = { // 휴대폰 하단 탭 묶음
  today: ['board', 'today'], prod: ['plans', 'production', 'silo'], maint: ['maint', 'schedule', 'equipment', 'eqstats'], parts: ['parts'],
  more: ['docs', 'stats', 'admin-users', 'admin-products', 'admin-settings', 'links', 'me'],
};
const TITLES = Object.fromEntries(NAV.flatMap(g => g.items.map(i => [i[0], i[1]])).concat([['me', '내 정보']]));
const routeModule = r => NAV.flatMap(g => g.items).find(i => i[0] === r)?.[3];
const allowed = r => r === 'me' || r === 'more' || (r === 'links' && api.mode === 'supabase' && isAdmin()) || (r.startsWith('admin-') ? isAdmin() : can(routeModule(r)));
let badges = { pending: 0, lowParts: 0 };

function route() { const r = location.hash.replace(/^#\/?/, '').split('?')[0]; return VIEWS[r] ? r : (can('board') ? 'board' : 'today'); }
function params() { return new URLSearchParams(location.hash.split('?')[1] || ''); }
const go = (r, q) => { location.hash = '#/' + r + (q ? '?' + new URLSearchParams(q) : ''); };

function shell(content) {
  const r = route();
  const sec = r === 'more' ? 'more' : Object.entries(SECTIONS).find(([, v]) => v.includes(r))?.[0] || 'today';
  const side = h('aside', { class: 'side' },
    h('div', { class: 'brand' }, brandMark(), h('div', h('b', `${CONFIG.TEAM_NAME} 업무 포털`), h('span', api.mode === 'demo' ? '데모 모드' : '사내 전용'))),
    NAV.filter(g => !g.admin || isAdmin()).map(g => h('nav', { class: 'nav' },
      g.group ? h('div', { class: 'nav-group' }, g.group) : null,
      g.items.filter(i => allowed(i[0])).map(([k, label, ic]) => h('a', { href: '#/' + k, class: r === k ? 'on' : '' }, icon(ic), label,
        k === 'admin-users' && badges.pending ? h('span', { class: 'count' }, badges.pending) : null,
        k === 'parts' && badges.lowParts ? h('span', { class: 'count' }, badges.lowParts) : null)))),
    h('div', { class: 'side-foot' }, h('div', h('b', me.name || me.email), ` · ${ROLE[me.role]}`),
      h('div', { style: { marginTop: '8px', display: 'flex', gap: '8px' } },
        h('a', { href: '#/me', style: { color: '#dbe7e1' } }, '내 정보'), h('a', { href: '#', style: { color: '#dbe7e1' }, onclick: e => { e.preventDefault(); logout(); } }, '로그아웃'))));
  const tabs = [['today', '오늘', 'today', '#/' + (firstAllowed('today') || 'today')], ['prod', '생산', 'prod', '#/' + firstAllowed('prod')], ['maint', '정비', 'wrench', '#/' + firstAllowed('maint')],
    ['parts', '부품', 'box', '#/parts'], ['more', '더보기', 'more', '#/more']].filter(t => t[0] === 'more' || firstAllowed(t[0]));
  const tabbar = h('nav', { class: 'tabbar', style: { gridTemplateColumns: `repeat(${tabs.length}, 1fr)` } }, tabs.map(([k, l, ic, href]) =>
    h('a', { href, class: sec === k ? 'on' : '' }, icon(ic), l, k === 'more' && badges.pending && isAdmin() ? h('span', { class: 'dot' }, badges.pending) : null,
      k === 'parts' && badges.lowParts ? h('span', { class: 'dot' }, badges.lowParts) : null)));
  const sub = SECTIONS[sec].filter(allowed);
  const subtabs = sec !== 'more' && sub.length > 1 ? h('div', { class: 'subtabs' }, sub.map(k => h('a', { href: '#/' + k, class: r === k ? 'on' : '' }, TITLES[k]))) : null;
  return [
    api.mode === 'demo' ? h('div', { class: 'demo-bar' }, h('b', '데모 모드'), '이 브라우저에만 저장되는 예시 화면입니다. 보라색 "예시" 표시는 실제 기록이 아닙니다.',
      h('button', { onclick: async () => { if (await confirmDlg('데모 초기화', '데모 데이터를 처음 상태로 되돌릴까요?', '초기화', true)) { api.resetDemo(); location.reload(); } } }, '데모 초기화')) : null,
    isLinked() ? h('div', { class: 'demo-bar link-bar' }, h('b', '연계 게스트'), `${me.linked_from}에서 들어왔습니다. 이 포털의 기록은 보기만 할 수 있고, 작성·수정은 ${CONFIG.TEAM_NAME} 로그인 인원만 할 수 있습니다.`) : null,
    h('div', { class: 'shell' }, side, h('main', { class: 'main' }, subtabs, content), tabbar),
  ];
}
const firstAllowed = sec => SECTIONS[sec].find(allowed);

function pageHead(title, sub, ...actions) {
  return h('div', { class: 'page-head' }, h('div', h('h1', title), sub ? h('div', { class: 'sub' }, sub) : null), h('span', { class: 'spacer' }), actions);
}
const addBtn = (label, onclick) => h('button', { class: 'btn primary', onclick }, icon('plus'), label);

async function render() {
  if (!me) return;
  const r = route();
  const content = h('div');
  clear(root, shell(content));
  window.scrollTo(0, 0);
  if (!allowed(r)) { clear(content, pageHead('접근 권한 없음'), card('안내', '이 메뉴를 볼 권한이 없습니다. 관리자에게 권한을 요청하세요.')); return; }
  const view = VIEWS[r] || VIEWS.today;
  clear(content, loading());
  try { await view(content); } catch (e) {
    console.error(e);
    clear(content, pageHead(TITLES[r] || ''), h('div', { class: 'form-error' }, '화면을 불러오지 못했습니다: ' + e.message, h('button', { class: 'btn sm', onclick: render }, '다시 시도')));
  }
}
const rerender = () => render();

// ================================================================ 상세 보기 (작성자·수정 이력 포함)
const FIELD_LABELS = {
  hours: '근무시간', date: '날짜', sterilizer: '멸균기', product_code: '제품코드', scm_qty: 'SCM 계획량', shift: '근무조', workers: '근무자', status: '상태',
  stop_reason: '중단 사유', memo: '비고', bean_type: '원료 구분', equipment: '설비', batches: '배치수', capa: 'CAPA', soy_input_kg: '대두 투입량', soymilk_output_kg: '두유 Output',
  meter1: '1차 연류계', meter2: '2차 연류계', juice_meter: '착즙 연류계', product_name: '제품명', dehull_yield: '탈피수율', extract_yield: '착즙수율', sterile_transfer: '멸균 이송량',
  yield_status: '수율 상태', silo: 'SILO', type: '구분', origin: '원산지', qty_kg: '수량', equipment_id: '설비', kind: '정비 구분', symptom: '고장 증상', occurred_at: '발생 시각',
  action: '조치 내용', worker: '작업자', photos: '사진', due_date: '예정일', done_at: '완료일', target: '대상', steps: '단계별 기록', result: '결과', checker: '확인자',
  name: '이름', part_no: '품번', location: '보관 위치', min_stock: '적정재고', stock: '현재고', category: '분류', code: '코드', title: '제목', body: '내용', revised_on: '개정일',
  tags: '태그', important: '중요', start_date: '게시 시작', end_date: '게시 종료', content: '내용', done: '완료', pm_cycle_days: '정기정비 주기', bom_std: '표준수량(BOM)', ts: '제품TS',
  plan_key: '계획표 연결', meter1_auto: '1차 연류계 자동', roast_temp: '로스팅 온도', roast_time: '로스팅 시간', germ: '씨눈', cooker_temp: '빈쿠커 온도', material: '원료 분류', homog_pressure: '균질압', plan_id: '연결 계획', file_name: '파일',
};
const SKIP = new Set(['id', 'client_id', 'created_by', 'created_at', 'updated_by', 'updated_at', 'is_sample', 'done_by', 'done_at_hidden', 'file_path']);
function showVal(v) { if (v == null || v === '') return '—'; if (typeof v === 'boolean') return v ? '예' : '아니오'; if (Array.isArray(v)) return v.length ? `${v.length}건` : '—'; if (typeof v === 'object') return JSON.stringify(v); return String(v); }

function metaBox(r) {
  return h('div', { class: 'meta-box' },
    h('div', '작성: ', h('b', personName(r.created_by) || '시스템'), ' · ', fmtFull(r.created_at)),
    r.updated_at ? h('div', '최종 수정: ', h('b', personName(r.updated_by)), ' · ', fmtFull(r.updated_at)) : h('div', '수정 이력 없음'),
    r.is_sample ? h('div', sampleBadge(r), ' 예시 데이터 — 실제 기록이 아닙니다') : null);
}
async function historyBox(tableName, id) {
  const box = h('div', { class: 'hist' }, loading('이력 불러오는 중…'));
  try {
    const rows = await api.history(tableName, id);
    const items = rows.map(a => {
      let chg = null;
      if (a.action === 'update' && a.old_data && a.new_data) {
        const keys = Object.keys(a.new_data).filter(k => !SKIP.has(k) && JSON.stringify(a.old_data[k]) !== JSON.stringify(a.new_data[k]));
        chg = keys.length ? keys.map(k => h('div', { class: 'chg' }, `${FIELD_LABELS[k] || k}: `, h('del', showVal(a.old_data[k])), ' → ', h('ins', showVal(a.new_data[k])))) : h('div', { class: 'chg' }, '(내용 변화 없음)');
      }
      return h('div', h('div', { class: 'when' }, fmtFull(a.at), ' · ', h('b', personName(a.by) || '시스템'), ' · ', { insert: '작성', update: '수정', delete: '삭제' }[a.action]), chg);
    });
    clear(box, items.length ? items : h('div', { class: 'muted' }, '기록된 이력이 없습니다.'));
  } catch (e) { clear(box, h('div', { class: 'muted' }, '이력을 불러오지 못했습니다.')); }
  return box;
}
async function detail({ title, tableName, row, rows: kv, actions = [], extra }) {
  const histWrap = h('div');
  const p = panel({
    title,
    body: [
      h('dl', { class: 'kv' }, kv.filter(Boolean).map(([k, v]) => [h('dt', k), h('dd', v == null || v === '' ? '—' : v)])),
      extra || null,
      metaBox(row),
      h('details', { ontoggle: async e => { if (e.target.open && !histWrap.childNodes.length) histWrap.append(await historyBox(tableName, row.id)); } }, h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '변경 이력 보기'), histWrap),
    ],
    foot: actions.length ? actions.map(a => h('button', { class: 'btn ' + (a.kind || ''), onclick: () => { p.close(); a.run(); } }, a.label)) : null,
  });
  return p;
}
function canEditRow(module, tableName, row) {
  // 생산기록: 착즙 연류계가 이미 들어간 기록도 연류계(1·2차·착즙)는 누구나 입력·수정 가능 (나머지 칸은 아래 규칙대로)
  if (tableName === 'production' && can(module, 'write')) return true;
  if (tableName === 'silo_tx' && can(module, 'write')) return true;   // SILO 기록은 작업자도 누구 기록이든 수정·삭제
  return canEditFull(module, tableName, row);
}
function canEditFull(module, tableName, row) {
  if (!can(module, 'write')) return false;
  if (isAdmin()) return true;
  if (['production', 'silo_tx'].includes(tableName)) {
    const hrs = S.rules.worker_edit_hours ?? 24;
    const fresh = t => (Date.now() - new Date(t)) / 3.6e6 <= hrs;
    if (tableName === 'production') {
      // 착즙 연류계가 아직 비어 있으면(4층이 1·2차만 먼저 저장한 경우 등) 누구나 이어서 입력 가능
      if (row.juice_meter == null) return true;
      if (row.updated_by === me.id && fresh(row.updated_at)) return true;
    }
    // 주간생산계획표에서 자동 등록된 생산기록: 아직 아무도 값을 채우지 않았거나, 내가 채운 지 정해진 시간 안이면 수정 가능
    if (row.plan_key) return !row.updated_by || (row.updated_by === me.id && (Date.now() - new Date(row.updated_at)) / 3.6e6 <= hrs);
    return row.created_by === me.id && (Date.now() - new Date(row.created_at)) / 3.6e6 <= hrs;
  }
  return true;
}
function rowActions(module, tableName, row, edit) {
  const a = [];
  if (canEditRow(module, tableName, row)) a.push({ label: '수정', kind: 'primary', run: edit });
  if (isAdmin() || (tableName === 'silo_tx' && can(module, 'write'))) a.unshift({ label: '삭제', kind: 'danger', run: async () => { if (await confirmDlg('삭제', '이 기록을 삭제할까요? 삭제 이력은 남습니다.', '삭제', true)) { try { await api.remove(tableName, row.id); toast('삭제했습니다.', 'ok'); rerender(); } catch (e) { toast(e.message, 'err'); } } } });
  return a;
}
const saveRow = (tableName, row) => async (vals, { client_id }) => (row?.id ? api.update(tableName, row.id, vals) : api.insert(tableName, { ...vals, client_id }));

// ================================================================ 1. 오늘의 업무
const VIEWS = {};
// ================================================================ 1-0. 착즙실 현황판
let boardTimer = null;
VIEWS.board = async el => {
  const q = params();
  const date = q.get('d') || today(), isToday = date === today();
  const colorBy = q.get('c') === 'mat' ? 'mat' : 'line';
  const nowM = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  let tmin = q.get('t') != null ? +q.get('t') : isToday ? nowM() : 12 * 60;
  let data;
  try { data = await api.rpc('board_data', { p_date: date }); }
  catch (e) { clear(el, pageHead('착즙실 현황판'), h('div', { class: 'form-error' }, /board_data|function/.test(e.message) ? '현황판 기능이 아직 설치되지 않았습니다. Supabase에서 migrate_18_board.sql 을 실행해 주세요.' : e.message)); return; }
  const w = can('board', 'write');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '착즙실 공정 흐름도');
  const rows = h('tbody'), title = h('div', { style: { fontWeight: 600, marginBottom: '6px' } }), legend = h('div', { class: 'bd-legend' }), tlabel = h('span', { class: 'bd-time' });
  const slider = h('input', { type: 'range', min: 0, max: 1439, step: 10, value: tmin, 'aria-label': '시각', oninput: e => { tmin = +e.target.value; draw(); } });
  const order = { stop: 0, run: 1, late: 2, wait: 3, done: 4 };
  const draw = () => {
    const { lines, st } = boardLines({ date, plan: { cells: data.cells || [] }, production: data.production, equipment: data.equipment, routes: data.routes, nowMin: tmin, products: data.products });
    drawBoard(svg, { lines, st, colorBy, nowMin: tmin });
    tlabel.textContent = `${String(Math.floor(tmin / 60)).padStart(2, '0')}:${String(tmin % 60).padStart(2, '0')}`;
    title.textContent = `${fmtDate(date)} ${tlabel.textContent} · 가동 ${lines.filter(c => c.st === 'run').length}${lines.some(c => c.st === 'stop') ? ` · 정지 ${lines.filter(c => c.st === 'stop').length}` : ''} / 계획 ${lines.length}라인`;
    legend.replaceChildren(...(colorBy === 'line' ? [1, 2, 3, 4].map(n => [`l${n}`, `빈쿠커 #${n} 라인`]) : Object.entries(MAT_NAME).map(([k, l]) => [k, l])).concat([['alarm', '설비 정지']]).map(([k, l]) => h('span', h('i', { style: { background: `var(--bd-${k})` } }), l)));
    rows.replaceChildren(...[...lines].sort((a, b) => order[a.st] - order[b.st] || a.cooker - b.cooker).map(c => h('tr',
      h('td', h('span', { class: 'bd-pill ' + c.st }, ST_NAME[c.st]), c.why ? h('div', { class: 'muted small' }, c.why) : null),
      h('td', h('span', { class: 'bd-no', style: { background: `var(--bd-l${c.cooker})` } }, `#${c.cooker}`), ` ${c.src === '탈피실' ? '탈피실' : c.m === 'direct' ? '4층 직투입' : '4층 그리츠'} → 빈쿠커 #${c.cooker} → ${c.eq} → ${c.tanks.length ? c.tanks.join(', ') : '탱크 미지정'}`, c.manual ? [' ', badge('수동', 'caution')] : null),
      h('td', h('span', { class: 'bd-dot', style: { background: `var(--bd-${c.m})` } }), c.items.map(x => x.name).join(', '), h('div', { class: 'muted small' }, c.items[0].mat || '원료 미등록')),
      h('td', { class: 'num' }, c.items.map(x => x.time).filter(Boolean).join(', ')))));
    if (!lines.length) rows.replaceChildren(h('tr', h('td', { colspan: 4, class: 'muted' }, data.cells?.length ? '이날 계획표에 빈쿠커 라인이 지정된 제품이 없습니다.' : '이날을 포함한 주간생산계획표가 없습니다.')));
  };
  // 특이 케이스: 그날 탱크 수동 지정 (예: WT1·WT2 → 9000)
  const routeForm = () => {
    const dayLines = boardLines({ date, plan: { cells: data.cells || [] }, production: [], equipment: [], routes: data.routes, nowMin: 0, products: data.products }).lines;
    const used = EQS.filter(e => dayLines.some(c => c.eq === e));
    if (!used.length) return toast('이날 계획표에 지정된 라인이 없습니다.', 'err');
    const cur = Object.fromEntries(used.map(e => [e, new Set(dayLines.find(c => c.eq === e).tanks)]));
    const tbl = h('table', { class: 'tbl' }, h('thead', h('tr', h('th', '탱크'), used.map(e => h('th', e)))),
      h('tbody', TANKS.map(t => h('tr', h('td', { class: 'num' }, t === '원액' ? '원액' : t), used.map(e => h('td', h('input', { type: 'checkbox', checked: cur[e].has(t), 'aria-label': `${e} → 탱크 ${t}`, style: { width: '20px', height: '20px' }, onchange: ev => { ev.target.checked ? cur[e].add(t) : cur[e].delete(t); } })))))));
    const p = panel({ title: `${fmtDate(date)} 탱크 지정`, body: [h('div', { class: 'muted small', style: { marginBottom: '8px' } }, `기본은 계획표 칸(멸균 호기)으로 정합니다: 1호기 → ${TANK_OF_COL[1]} · 2호기 → ${TANK_OF_COL[2]} · 4호기 → ${TANK_OF_COL[4]} · 5호기 → ${TANK_OF_COL[5]} · 원액 칸 → 원액. 다르게 보낸 날만 체크를 바꾸세요. 한 탱크에 여러 설비를 체크할 수 있습니다.`), tbl],
      foot: [h('button', { class: 'btn', onclick: async () => { try { for (const r of data.routes.filter(r => r.date === date)) await api.remove('tank_routes', r.id); p.close(); toast('기본 연결로 되돌렸습니다.', 'ok'); render(); } catch (e) { toast(e.message, 'err'); } } }, '기본으로'),
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            for (const e of used) {
              const tanks = TANKS.filter(t => cur[e].has(t)), def = dayLines.find(c => c.eq === e), base = TANK_OF_COL[def.col] ? [TANK_OF_COL[def.col]] : [];
              const ex = data.routes.find(r => r.date === date && r.eq === e), same = tanks.join() === base.join();
              if (same) { if (ex) await api.remove('tank_routes', ex.id); }
              else if (ex) await api.update('tank_routes', ex.id, { tanks }); else await api.insert('tank_routes', { date, eq: e, tanks });
            }
            p.close(); toast('저장했습니다.', 'ok'); render();
          } catch (e) { toast(e.message, 'err'); }
        } }, '저장')] });
  };
  const nav = h('div', { class: 'daynav' },
    h('button', { class: 'icon-btn', 'aria-label': '전날', onclick: () => go('board', { d: addDays(date, -1), c: colorBy }) }, icon('left')),
    h('div', { class: 'date-label' }, fmtDateLong(date)),
    h('button', { class: 'icon-btn', 'aria-label': '다음 날', onclick: () => go('board', { d: addDays(date, 1), c: colorBy }) }, icon('right')),
    !isToday ? h('button', { class: 'btn sm', onclick: () => go('board', { c: colorBy }) }, '오늘') : null);
  // 한 화면에 들어오게: 제목·날짜·색·탱크 지정을 한 줄로
  clear(el, h('div', { class: 'toolbar bd-head' }, h('h1', { class: 'bd-title' }, '착즙실 현황판'), nav, chipsFilter([['line', '색: 라인별'], ['mat', '색: 원료별']], colorBy, v => go('board', { d: date, c: v })),
      h('span', { class: 'spacer', style: { flex: 1 } }), w ? h('button', { class: 'btn', onclick: routeForm }, '탱크 지정') : null),
    h('div', { class: 'bd-wrap' },
      h('div', { class: 'bd-top' }, legend, h('div', { class: 'bd-clock' }, tlabel, slider)),
      h('div', { class: 'bd-board' }, svg)),
    card('라인', [title, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl bd-list' }, h('thead', h('tr', h('th', '상태'), h('th', '흐름'), h('th', '제품'), h('th', '계획 시간'))), rows)),
      h('div', { class: 'unit-note' }, '정지: 빈쿠커·WT·데칸타가 설비 목록에서 점검중·고장 · 완료: 착즙 연류계 입력됨 · 가동: 계획 시간 안 · 기록 대기: 계획 시간이 지났는데 착즙 연류계 없음')]));
  draw();
  // 오늘 화면은 1분마다 시각·상태 새로 고침 (다른 화면으로 가면 멈춤)
  clearInterval(boardTimer);
  if (isToday && q.get('t') == null) boardTimer = setInterval(() => { if (route() !== 'board') { clearInterval(boardTimer); return; } tmin = nowM(); slider.value = tmin; draw(); }, 60000);
};

VIEWS.today = async el => {
  const q = params();
  const date = q.get('d') || today();
  const mode = q.get('m') || 'day';
  const nav = h('div', { class: 'daynav' },
    h('button', { class: 'icon-btn', 'aria-label': mode === 'week' ? '지난주' : '전날', onclick: () => go('today', { d: addDays(date, mode === 'week' ? -7 : -1), m: mode }) }, icon('left')),
    h('div', { class: 'date-label' }, mode === 'week' ? `${fmtDate(weekStart(date))} 주` : fmtDateLong(date)),
    h('button', { class: 'icon-btn', 'aria-label': mode === 'week' ? '다음주' : '다음 날', onclick: () => go('today', { d: addDays(date, mode === 'week' ? 7 : 1), m: mode }) }, icon('right')),
    date !== today() ? h('button', { class: 'btn sm', onclick: () => go('today', { m: mode }) }, '오늘') : null);
  const modeSw = chipsFilter([['day', '일간'], ['week', '주간']], mode, m => go('today', { d: date, m }));
  const head = pageHead('오늘의 업무', `${me.name || ''}님, 안녕하세요.`, h('input', { type: 'date', class: 'input', style: { width: 'auto' }, value: date, onchange: e => e.target.value && go('today', { d: e.target.value, m: mode }) }));
  if (mode === 'week') return weekView(el, date, head, nav, modeSw);

  const [notices, roster, rosterDocs, wplan, handovers, maints, prodWait] = await Promise.all([
    api.list('notices', { order: 'created_at' }),
    api.list('roster', { where: [['date', 'eq', date]] }),
    can('docs') ? api.list('docs', { where: [['category', 'eq', '근무표'], ['revised_on', 'lte', date], ['revised_on', 'gte', addDays(date, -6)]], order: 'revised_on' }) : [],
    can('production') ? loadWeekPlan(date) : null,
    api.list('handovers', { where: [['date', 'gte', addDays(date, -7)], ['date', 'lte', date]], order: 'created_at' }),
    can('maintenance') ? api.list('maintenance', { where: [['status', 'in', ['접수', '예정', '진행']]], order: 'due_date', asc: true }) : [],
    can('production') ? api.list('production', { where: [['date', 'gte', addDays(date, -7)], ['date', 'lte', date]], order: 'date' }) : [],
  ]);
  // 4층에서 1·2차 연류계만 먼저 저장하고 착즙 연류계를 기다리는 생산기록
  const juiceWait = prodWait.filter(r => r.date === date && r.juice_meter == null && (r.meter1 != null || r.meter2 != null || isDirectRow(r))); // 보고 있는 날짜 것만
  const activeNotices = notices.filter(n => n.start_date <= date && (!n.end_date || n.end_date >= date));
  const important = activeNotices.filter(n => n.important);
  const todayHand = handovers.filter(x => x.date === date);
  const dueMaint = maints.filter(m => !m.due_date || m.due_date <= addDays(date, 7));

  const writeToday = can('today', 'write');
  const shifts = S.lists.shifts;
  const rosterDoc = rosterDocs[0];
  const rosterCard = card('근무자', [
    rosterBoard(roster, date, writeToday),
    rosterDoc ? h('button', { class: 'btn sm', style: { marginTop: '10px' }, onclick: () => openFile('docs', rosterDoc.file_path, rosterDoc.file_name) }, icon('doc'), `근무표 PDF 보기 (${fmtDate(rosterDoc.revised_on)} 주)`) : null,
  ], isAdmin() ? h('button', { class: 'btn sm', onclick: () => rosterUpload() }, icon('plus'), '근무표 PDF 등록') : null);

  const planCard = can('production') ? card(`주간생산계획표 · ${weekLabel(date)}`,
    wplan ? [planLegend(), planDays(wplan, date)] : h('div', { class: 'empty' }, '이 주에 등록된 주간생산계획표가 없습니다.', can('production', 'write') ? h('div', h('button', { class: 'btn', onclick: () => planUpload() }, '계획표 PDF 등록')) : null),
    h('button', { class: 'btn sm', onclick: () => go('plans', { d: date }) }, '주간 전체 보기')) : null;

  // 인수인계 작성·수정 (작성자 본인 또는 관리자만 수정·삭제)
  const handForm = x => openForm({
    api, title: x ? '인수인계 수정' : '인수인계 작성', draftKey: x ? null : 'handover', fields: [
      ...(x ? [{ k: 'date', label: '날짜', type: 'date', req: true }] : []),
      { k: 'shift', label: '근무조', type: 'chips', opts: shifts, req: true },
      { k: 'content', label: '전달 내용', type: 'textarea', req: true, ph: '다음 근무조가 꼭 알아야 할 내용' }],
    values: x ? { date: x.date, shift: x.shift, content: x.content } : { shift: shifts[new Date().getHours() >= 19 || new Date().getHours() < 7 ? 1 : 0] },
    onSave: (v, c) => (x ? api.update('handovers', x.id, v) : api.insert('handovers', { date, ...v, client_id: c.client_id })), after: rerender,
  });
  const canFixHand = x => writeToday && (isAdmin() || x.created_by === me.id);
  const delHand = async x => {
    if (!(await confirmDlg('인수인계 삭제', `"${String(x.content).slice(0, 40)}${String(x.content).length > 40 ? '…' : ''}" 인수인계를 삭제할까요? 삭제 이력은 남습니다.`, '삭제', true))) return;
    try { await api.remove('handovers', x.id); toast('삭제했습니다.', 'ok'); rerender(); } catch (e) { toast(e.message, 'err'); }
  };
  const handItem = x => h('div', { class: 'li' },
    writeToday ? h('input', { type: 'checkbox', checked: x.done, style: { width: '22px', height: '22px', marginTop: '2px', accentColor: 'var(--brand)' }, 'aria-label': '확인 완료',
      onchange: async e => { try { await api.update('handovers', x.id, { done: e.target.checked, done_by: e.target.checked ? me.id : null, done_at: e.target.checked ? new Date().toISOString() : null }); toast(e.target.checked ? '확인 처리했습니다.' : '확인을 취소했습니다.', 'ok'); rerender(); } catch (er) { e.target.checked = !e.target.checked; toast(er.message, 'err'); } } }) : null,
    h('div', { class: 'grow' }, h('div', { style: { textDecoration: x.done ? 'line-through' : '', color: x.done ? 'var(--ink-3)' : '' } }, x.content),
      h('div', { class: 's' }, `${fmtDate(x.date)} ${x.shift || ''} · ${personName(x.created_by)}`, x.done ? ` · 확인 ${personName(x.done_by)}` : '', ' ', sampleBadge(x))),
    canFixHand(x) ? h('div', { class: 'li-acts' },
      h('button', { class: 'btn sm', onclick: () => handForm(x) }, '수정'),
      h('button', { class: 'btn sm danger-text', onclick: () => delHand(x) }, '삭제')) : null);
  const handCard = card('인수인계', [
    todayHand.length ? h('div', { class: 'list' }, todayHand.map(handItem)) : h('div', { class: 'muted small' }, '오늘 작성된 인수인계가 없습니다.'),
  ], writeToday ? h('button', { class: 'btn sm', onclick: () => handForm() }, icon('plus'), '작성') : null);

  const pendingItems = [
    ...juiceWait.map(r => h('div', { class: 'li click', onclick: () => (canEditRow('production', 'production', r) ? productionForm(r) : productionDetail(r)) }, badge('착즙 연류계 대기', 'info'),
      h('div', { class: 'grow' }, h('div', { class: 't' }, `${productName(r.product_code, r.product_name)} · ${r.equipment || ''}`),
        h('div', { class: 's' }, isDirectRow(r) ? `${fmtDate(r.date)} · 직투입 (${bomOf(r.product_code).material})` : `${fmtDate(r.date)} · 1차 ${n0(r.meter1)}${r.meter2 != null ? ' · 2차 ' + n0(r.meter2) : ''} · ${personName(r.updated_by || r.created_by)} 입력`)))),
  ];
  const pendCard = card(`미완료 업무 (${pendingItems.length})`, pendingItems.length ? h('div', { class: 'list' }, pendingItems) : h('div', { class: 'muted small' }, '이 날 밀린 업무가 없습니다. 👍'));

  const schedCard = can('maintenance') ? card('예정 정비', h('div', { class: 'list' },
    dueMaint.slice(0, 8).map(m => h('div', { class: 'li click', onclick: () => go('maint', { id: m.id }) }, stBadge(m.status),
      h('div', { class: 'grow' }, h('div', { class: 't' }, `${eqName(m.equipment_id)} · ${m.kind || ''}${m.symptom ? ' · ' + m.symptom : m.action ? ' · ' + m.action : ''}`),
        h('div', { class: 's' }, m.due_date ? (m.due_date < date ? `예정일 지남 (${fmtDate(m.due_date)})` : `예정일 ${fmtDate(m.due_date)}`) : `접수 ${fmtDT(m.occurred_at || m.created_at)}`)))),
    !dueMaint.length ? h('div', { class: 'muted small', style: { paddingTop: '8px' } }, '7일 안에 예정된 정비가 없습니다.') : null)) : null;

  const otherNotices = activeNotices.filter(n => !n.important);
  const noticeCard = card('공지', [
    activeNotices.length ? h('div', { class: 'list' }, activeNotices.map(n => h('div', { class: 'li click', onclick: () => noticeDetail(n) }, n.important ? badge('중요', 'bad') : badge('공지'), h('div', { class: 'grow' }, h('div', { class: 't' }, n.title, ' ', sampleBadge(n)), h('div', { class: 's' }, `${personName(n.created_by)} · ${fmtDate(n.start_date)}${n.end_date ? ' ~ ' + fmtDate(n.end_date) : ''}`))))) : h('div', { class: 'muted small' }, '게시 중인 공지가 없습니다.'),
  ], writeToday ? h('button', { class: 'btn sm', onclick: () => noticeForm() }, icon('plus'), '공지') : null);
  void otherNotices;

  clear(el,
    head, h('div', { class: 'toolbar' }, nav, h('span', { class: 'spacer', style: { flex: 1 } }), modeSw),
    important.map(n => h('div', { class: 'notice-strip', onclick: () => noticeDetail(n) }, h('b', '중요 공지'), h('div', n.title, ' ', sampleBadge(n)))),
    h('div', { class: 'grid g2' },
      h('div', { class: 'grid' }, planCard, handCard),
      h('div', { class: 'grid' }, rosterCard, pendCard, schedCard, noticeCard)));
};


// ---------------------------------------------------------------- 근무표
// 저장 단위(roster.shift): 주간 · 야간 · 휴무(착즙) · 4층 · 4층 휴무 · 배합지원
// workers 는 "이름, 이름(08:00~17:00)" 형식 — 괄호 시간은 그 사람만 다른 근무시간
const SH = () => ({ day: S.lists.shifts[0] || '주간', night: S.lists.shifts[1] || '야간', rest: '휴무', f4: '4층', f4rest: '4층 휴무', mix: '배합지원' });
const rosterOrder = () => { const k = SH(); return [k.day, k.night, k.rest, k.f4, k.f4rest, k.mix]; };
const floor4Hours = () => S.rules.floor4_hours || '07:30~16:00';

function rosterBoard(rows, date, canWrite) {
  const k = SH();
  const get = sh => rows.find(x => x.shift === sh);
  const timeTag = (hours, changed) => hours ? h('span', { class: 'r-time' + (changed ? ' changed' : '') }, hours, changed ? ' 변경' : '') : null;
  const empty = t => h('div', { class: 'r-empty' }, t);

  // 착즙
  const shiftRow = (sh, kind) => {
    const r = get(sh);
    return h('div', { class: 'r-row' }, badge(sh, kind),
      h('div', { class: 'r-main' }, r ? [h('b', r.workers), ' ', sampleBadge(r)] : h('span', { class: 'muted' }, '미입력'), r?.hours ? h('div', { class: 'r-sub' }, r.hours) : null));
  };
  const rest = get(k.rest);
  const left = h('section', { class: 'r-col' },
    h('div', { class: 'r-head' }, h('h3', '착즙'), canWrite ? h('button', { class: 'btn sm ghost', onclick: () => rosterEdit('juice', rows, date) }, '수정') : null),
    shiftRow(k.day, 'info'), shiftRow(k.night, 'brand'),
    h('div', { class: 'r-row' }, badge('휴무'), h('div', { class: 'r-main' }, rest ? h('span', rest.workers) : h('span', { class: 'muted' }, '없음'))));

  // 4층: 사람마다 근무 정상 + 시간
  const f4 = get(k.f4), f4rest = get(k.f4rest);
  const base = f4?.hours || floor4Hours();
  const f4people = toPeople(f4?.workers);
  const right = h('section', { class: 'r-col' },
    h('div', { class: 'r-head' }, h('h3', '4층'), canWrite ? h('button', { class: 'btn sm ghost', onclick: () => rosterEdit('floor4', rows, date) }, '수정') : null),
    f4people.length ? f4people.map(p => h('div', { class: 'r-row' }, badge('정상', 'ok'), h('b', { class: 'r-name' }, p.name), timeTag(p.hours || base, !!p.hours && p.hours !== base)))
      : !f4rest ? empty('미입력') : null,
    f4rest ? h('div', { class: 'r-row' }, badge('휴무'), h('div', { class: 'r-main' }, f4rest.workers)) : null);

  // 배합지원 (두 칸 아래 전체 폭)
  const mix = get(k.mix);
  const mixPeople = toPeople(mix?.workers);
  const bottom = mixPeople.length || canWrite ? h('section', { class: 'r-col r-mix' },
    h('div', { class: 'r-head' }, h('h3', '배합지원'), canWrite ? h('button', { class: 'btn sm ghost', onclick: () => rosterEdit('mix', rows, date) }, mixPeople.length ? '수정' : '입력') : null),
    mixPeople.length ? h('div', { class: 'r-mix-list' }, mixPeople.map(p => h('div', { class: 'r-row' }, badge('정상', 'ok'), h('b', { class: 'r-name' }, p.name), timeTag(p.hours || mix.hours, false))))
      : empty('배합 지원 인원 없음')) : null;

  if (!rows.length) return h('div', h('div', { class: 'muted small', style: { marginBottom: '8px' } }, '근무자가 아직 입력되지 않았습니다.' + (isAdmin() ? ' 근무표 PDF를 등록하면 자동으로 채워집니다.' : '')), h('div', { class: 'r-split' }, left, right), bottom);
  return h('div', h('div', { class: 'r-split' }, left, right), bottom);
}

// 하루치 근무 묶음 저장: 값이 비면 삭제, 바뀐 것만 수정
async function saveShifts(date, entries, existing, client_id) {
  for (const { shift, workers, hours } of entries) {
    const ex = existing.find(x => x.date === date && x.shift === shift);
    if (!workers) { if (ex) await api.remove('roster', ex.id); continue; }
    if (ex) { if (ex.workers !== workers || (ex.hours || null) !== (hours || null)) await api.update('roster', ex.id, { workers, hours: hours || null }); }
    else await api.insert('roster', { date, shift, workers, hours: hours || null, client_id: `${client_id}-${date}-${shift}` });
  }
}
const normPeople = t => peopleText(toPeople(t), '', true);

function rosterEdit(part, rows, date) {
  const k = SH(); const v = sh => rows.find(x => x.shift === sh);
  const timeHelp = '시간이 다른 사람은 이름 옆에 괄호로 적어 주세요. 예: 우정균(08:00~17:00)';
  const cfg = {
    juice: { title: '착즙 근무자', fields: [
      { k: 'am', label: `${k.day} 근무자`, ph: '예: 황용식, 목진웅', recent: true, recentKey: 'roster_names' }, { k: 'amH', label: `${k.day} 근무시간`, ph: '05:30~14:30', recent: true, recentKey: 'roster_hours' },
      { k: 'pm', label: `${k.night} 근무자`, ph: '예: 이연우, 장영빈', recent: true, recentKey: 'roster_names' }, { k: 'pmH', label: `${k.night} 근무시간`, ph: '14:30~23:00', recent: true, recentKey: 'roster_hours' },
      { k: 'rest', label: '착즙 휴무', ph: '예: 채승엽, 이원석', full: true }],
      values: { am: v(k.day)?.workers, amH: v(k.day)?.hours, pm: v(k.night)?.workers, pmH: v(k.night)?.hours, rest: v(k.rest)?.workers },
      entries: x => [{ shift: k.day, workers: normPeople(x.am || ''), hours: x.amH }, { shift: k.night, workers: normPeople(x.pm || ''), hours: x.pmH }, { shift: k.rest, workers: normPeople(x.rest || '') }] },
    floor4: { title: '4층 근무자', fields: [
      { k: 'f4', label: '근무자 (정상)', ph: '예: 우정균, 김진명', full: true, help: timeHelp }, { k: 'f4H', label: '기본 근무시간', ph: floor4Hours() },
      { k: 'f4rest', label: '4층 휴무', ph: '예: 김진명' }],
      values: { f4: v(k.f4)?.workers, f4H: v(k.f4)?.hours || floor4Hours(), f4rest: v(k.f4rest)?.workers },
      entries: x => [{ shift: k.f4, workers: peopleText(toPeople(x.f4 || ''), x.f4H || floor4Hours()), hours: x.f4H || floor4Hours() }, { shift: k.f4rest, workers: normPeople(x.f4rest || '') }] },
    mix: { title: '배합지원', fields: [
      { k: 'mix', label: '배합지원 근무자와 시간', ph: '예: 채승엽(06:00~15:00)', full: true, help: '이름 옆 괄호에 근무시간을 적어 주세요.' }],
      values: { mix: v(k.mix)?.workers },
      entries: x => [{ shift: k.mix, workers: normPeople(x.mix || '') }] },
  }[part];
  openForm({ api, title: `${fmtDate(date)} ${cfg.title}`, fields: cfg.fields, values: cfg.values,
    onSave: (x, { client_id }) => saveShifts(date, cfg.entries(x), rows, client_id), after: rerender });
}
async function openFile(bucket, path, name) {
  try { const u = await api.fileUrl(bucket, path); const a = h('a', { href: u, target: '_blank', rel: 'noopener', download: name || '' }); document.body.append(a); a.click(); a.remove(); }
  catch (e) { toast(e.message, 'err'); }
}
function rosterUpload() {
  const fileIn = h('input', { type: 'file', accept: 'application/pdf,.pdf', class: 'hidden' });
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files[0]; fileIn.remove(); if (!file) return;
    toast('근무표를 읽는 중…');
    try {
      const items = await pdfItems(file);
      let r;
      if (items.length < 30) {
        // 글자가 그림으로 된 PDF → 글자 인식(OCR). 처음 한 번은 인식 데이터를 내려받느라 시간이 걸림
        const prog = h('div', { class: 'ocr-progress' }, h('b', '근무표 글자 인식 중…'), h('span', ' 처음 한 번은 30초~1분 걸릴 수 있습니다.'), h('div', { class: 'bar' }, h('i', { style: { width: '3%' } })));
        document.body.append(prog);
        const known = [...new Set([...(S.lists.team_members || []), ...(S.lists.floor4_members || [])])];
        try { r = await readRosterImage(file, { known, onProgress: p => { prog.querySelector('i').style.width = Math.max(3, Math.round(p * 100)) + '%'; } }); }
        finally { prog.remove(); }
        r.warn.unshift('그림으로 된 PDF라 글자를 인식해서 채웠습니다. 저장하기 전에 이름과 시간을 한 번 확인해 주세요.');
      } else r = parseRoster(items);
      rosterPreview(r, file);
    } catch (e) { console.error(e); toast('근무표를 읽지 못했습니다: ' + e.message, 'err'); }
  });
  document.body.append(fileIn); fileIn.click();
}
function rosterPreview(r, file) {
  const k = SH();
  const fromWeek = f => [...new Set(r.days.flatMap(f))];
  const team = (S.lists.team_members || []).length ? S.lists.team_members : fromWeek(d => [...d.am.workers, ...d.pm.workers].map(p => p.name));
  const f4team = (S.lists.floor4_members || []).length ? S.lists.floor4_members : fromWeek(d => d.floor4.workers.map(p => p.name));
  const rows = r.days.map(d => {
    const f4base = d.floor4.hours || (d.floor4.workers.length ? floor4Hours() : '');
    return {
      d, f4base,
      am: peopleText(d.am.workers, d.am.hours), pm: peopleText(d.pm.workers, d.pm.hours),
      rest: d.rest.filter(n => team.includes(n)).join(', '),
      f4: peopleText(d.floor4.workers, f4base), f4rest: d.rest.filter(n => f4team.includes(n)).join(', '),
      mix: peopleText(d.mix.filter(p => team.includes(p.name)), '', true),
    };
  });
  const COLS = [['am', k.day], ['pm', k.night], ['rest', '착즙 휴무'], ['f4', '4층'], ['f4rest', '4층 휴무'], ['mix', '배합지원']];
  const grid = () => {
    const inputs = [];
    const el = h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', h('tr', h('th', '날짜'), COLS.map(([, l]) => h('th', l)), h('th', '확인'))),
      h('tbody', rows.map(row => {
        const ins = Object.fromEntries(COLS.map(([key]) => [key, h('input', { class: 'input', value: row[key], placeholder: '없음', style: { minWidth: key === 'mix' ? '170px' : '130px' } })]));
        const chk = h('td');
        const names = keys => keys.flatMap(key => toPeople(ins[key].value).map(p => p.name));
        const check = () => {
          const out = [];
          for (const [group, keys, label] of [[team, ['am', 'pm', 'rest', 'mix'], '착즙'], [f4team, ['f4', 'f4rest'], '4층']]) {
            const n = names(keys);
            const missing = group.filter(x => !n.includes(x)), dup = [...new Set(n.filter((x, i) => n.indexOf(x) !== i))];
            if (missing.length) out.push(badge(`${label} 미배정 ${missing.join(',')}`, 'warn'));
            if (dup.length) out.push(badge(`${label} 중복 ${dup.join(',')}`, 'bad'));
          }
          clear(chk, out.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, out) : badge('확인', 'ok'));
        };
        Object.values(ins).forEach(i => i.addEventListener('input', check)); check();
        inputs.push({ row, ins });
        const hoursOf = key => ({ am: row.d.am.hours, pm: row.d.pm.hours, f4: row.f4base }[key]);
        return h('tr', h('td', h('b', row.d.label)), COLS.map(([key]) => h('td', ins[key], hoursOf(key) ? h('div', { class: 'small muted' }, hoursOf(key)) : null)), chk);
      }))));
    el._value = () => inputs.map(({ row, ins }) => ({ row, ...Object.fromEntries(Object.entries(ins).map(([key, i]) => [key, i.value])) }));
    return el;
  };
  openForm({
    api, title: `근무표 확인 · ${fmtDate(r.start)} ~ ${fmtDate(r.end)}`, saveLabel: '확정하고 게시',
    note: `PDF에서 착즙 오전(${k.day})·오후(${k.night}), 4층 근무자, 착즙·4층 휴무자를 따로 읽고, 배합 칸에 들어간 착즙 인원은 배합지원으로 옮겼습니다. 이름 옆 괄호는 그 사람만 다른 근무시간입니다. 틀린 곳을 고친 뒤 확정하세요. 이 기간에 이미 입력된 근무자는 새 값으로 바뀝니다.`,
    extra: r.warn.length ? h('div', { class: 'form-error' }, r.warn.join(' ')) : null,
    fields: [{ k: 'grid', label: '날짜별 근무자', type: 'custom', render: grid }],
    onSave: async (v, { client_id }) => {
      const existing = await api.list('roster', { where: [['date', 'gte', r.start], ['date', 'lte', r.end]] });
      for (const x of v.grid) {
        const d = x.row.d;
        await saveShifts(d.date, [
          { shift: k.day, workers: normPeople(x.am), hours: d.am.hours }, { shift: k.night, workers: normPeople(x.pm), hours: d.pm.hours },
          { shift: k.rest, workers: normPeople(x.rest) },
          { shift: k.f4, workers: peopleText(toPeople(x.f4), x.row.f4base || floor4Hours()), hours: x.row.f4base || floor4Hours() },
          { shift: k.f4rest, workers: normPeople(x.f4rest) },
          { shift: k.mix, workers: normPeople(x.mix) },
        ], existing, client_id);
      }
      // 원본 PDF 보관 (자료실 '근무표')
      const path = await api.upload('docs', file);
      const docs = await api.list('docs', { where: [['category', 'eq', '근무표'], ['revised_on', 'eq', r.start]] });
      const doc = { category: '근무표', title: `근무표 ${fmtDate(r.start)} ~ ${fmtDate(r.end)}`, revised_on: r.start, file_path: path, file_name: file.name, tags: '근무표' };
      if (docs[0]) await api.update('docs', docs[0].id, doc); else await api.insert('docs', { ...doc, client_id: client_id + '-doc' });
    },
    after: rerender,
  });
}

async function weekView(el, date, head, nav, modeSw) {
  const ws = weekStart(date), we = addDays(ws, 6);
  const [wplan, maints, roster] = await Promise.all([
    can('production') ? loadWeekPlan(ws) : null,
    can('maintenance') ? api.list('maintenance', { where: [['due_date', 'gte', ws], ['due_date', 'lte', we]] }) : [],
    api.list('roster', { where: [['date', 'gte', ws], ['date', 'lte', we]] }),
  ]);
  const days = [...Array(7)].map((_, i) => addDays(ws, i));
  clear(el, head, h('div', { class: 'toolbar' }, nav, h('span', { style: { flex: 1 } }), modeSw),
    h('div', { class: 'week' }, days.map(d => {
      const ps = (wplan?.cells || []).filter(c => c.date === d && cellInfo(c).active && cellInfo(c).type).sort((a, b) => (a.col || 9) - (b.col || 9)), ms = maints.filter(m => m.due_date === d);
      return h('div', { class: 'wday' + (d === today() ? ' today' : ''), onclick: () => go('today', { d }) },
        h('h4', h('span', fmtDate(d)), h('span', { class: 'muted' }, ps.length ? `착즙 ${ps.length}건` : '')),
        rosterOrder().map(sh => { const r = roster.find(x => x.date === d && x.shift === sh); return r ? h('div', { class: 'small', style: { color: /휴무/.test(sh) ? 'var(--ink-3)' : 'var(--ink-2)' } }, h('b', (sh === '휴무' ? '착즙 휴무' : sh) + ' '), r.workers) : null; }),
        ps.map(c => h('div', { class: `wp wp-${cellInfo(c).type}` }, `${colName(c.col)} `, h('b', c.line || (cellInfo(c).type === 'dc' ? '데칸타' : 'WT')), (c.hopper || []).length || c.note ? h('span', { style: { color: 'var(--plan-red)' } }, ' · ' + [...(c.hopper || []), c.note].filter(Boolean).join(', ')) : null)),
        ms.map(m => h('div', { class: 'wp', style: { borderColor: 'var(--accent)' } }, `🔧 ${eqName(m.equipment_id)}`)),
        !ps.length && !ms.length ? h('div', { class: 'muted small', style: { marginTop: '4px' } }, '생산·정비 일정 없음') : null);
    })),
    h('div', { class: 'unit-note' }, '날짜를 누르면 그날의 상세 업무로 이동합니다. 🔧는 정비 예정입니다.'));
}

function noticeDetail(n) {
  detail({ title: n.title, tableName: 'notices', row: n, rows: [['중요', n.important ? '예' : '아니오'], ['게시 기간', `${fmtDate(n.start_date)} ~ ${n.end_date ? fmtDate(n.end_date) : '종료일 없음'}`], ['내용', n.body]],
    actions: rowActions('today', 'notices', n, () => noticeForm(n)) });
}
function noticeForm(n) {
  openForm({ api, title: n ? '공지 수정' : '공지 작성', draftKey: n ? null : 'notice', values: n || { start_date: today() }, fields: [
    { k: 'title', label: '제목', req: true, full: true }, { k: 'body', label: '내용', type: 'textarea' },
    { k: 'important', label: '중요 공지', type: 'check', checkLabel: '중요 공지 (오늘의 업무 맨 위에 표시)' },
    { k: 'start_date', label: '게시 시작', type: 'date', req: true }, { k: 'end_date', label: '게시 종료', type: 'date', help: '비우면 계속 게시', check: (v, all) => (v && all.start_date && v < all.start_date ? '종료일이 시작일보다 빠릅니다.' : null) },
  ], onSave: saveRow('notices', n), after: rerender });
}

function rangeBar(r, from, to, extra) {
  const set = (f, t) => go(r, { ...Object.fromEntries(params()), from: f, to: t });
  const t = today(), m0 = t.slice(0, 8) + '01';
  return h('div', { class: 'toolbar' },
    h('input', { type: 'date', class: 'input', value: from, onchange: e => set(e.target.value, to), 'aria-label': '시작일' }), '~',
    h('input', { type: 'date', class: 'input', value: to, onchange: e => set(from, e.target.value), 'aria-label': '종료일' }),
    h('button', { class: 'btn sm', onclick: () => set(weekStart(t), addDays(weekStart(t), 6)) }, '이번 주'),
    h('button', { class: 'btn sm', onclick: () => set(m0, t) }, '이번 달'),
    h('button', { class: 'btn sm', onclick: () => set(addDays(t, -29), t) }, '최근 30일'),
    extra || null);
}

// ================================================================ 주간생산계획표
// weekly_plans: 한 주에 한 줄. cells = [{date, col(1~5 호기, 0 = 원액), items:[{code,name,qty,pack,time}], note_src, batch,
//                                      line, hopper:[], note, cond:{bean,roast,cooker,pressure}, hide}]
const PLAN_DEFAULTS = { nums: ['#1', '#2', '#3', '#4'], machines: ['WT1', 'WT2', 'WT3', 'WT4', '데칸타'], hopper: ['호퍼비우기', '2&4층 호퍼비우기'], roast_time: '15분', germ: '씨눈함유', cooker_temp: '90℃ / ±5℃', normal_material: '대두(수입산)' };
const PS = () => ({ ...PLAN_DEFAULTS, ...(S.plan || {}) });
const thursdayOf = d => addDays(weekStart(d), 3);
function weekLabel(d) { const t = thursdayOf(d); const [, m, dd] = t.split('-').map(Number); return `${m}월 ${Math.floor((dd - 1) / 7) + 1}주차`; }
const bomOf = code => C.products.find(p => p.code === code);
// BOM 원료 → 수율 계산용 원료 구분 (국산콩(원물)·국산콩(반할두)·약콩·서리태 = 국산콩, 대두(수입산) = 수입콩)
const beanOfMaterial = m => (!m ? null : /국산|약콩|서리태/.test(m) ? '국산콩' : '수입콩');
// 외부에서 탈피된 콩이 들어와 바로 투입하는 원료: 탈피수율 없음
const isDirectMaterial = m => /반할두|약콩/.test(m || '');
const isDirectRow = r => !!r?.product_code && isDirectMaterial(bomOf(r.product_code)?.material);
const orderKg = it => { const p = bomOf(it.code); return p?.bom_std && it.qty ? p.bom_std * it.qty : null; };
const pressText = p => (p ? `${String(p).replace(/\s/g, '').replace('/', ' / ')}bar` : '');

// 칸에 보여줄 내용 계산 (BOM 자동값 + 작업자 수정값)
function cellInfo(c) {
  const ps = PS();
  const bomItems = (c.items || []).filter(it => bomOf(it.code));
  const lead = bomItems.map(it => bomOf(it.code)).find(p => p.material && p.material !== ps.normal_material) || (bomItems[0] && bomOf(bomItems[0].code));
  const special = lead && lead.material && lead.material !== ps.normal_material;
  const auto = {
    bean: special ? lead.material : '',
    roast: special && lead.roast_temp ? `로스팅 대두 ${lead.roast_temp}/${lead.roast_time || ps.roast_time} ${lead.germ || ps.germ}` : '',
    cooker: special ? (lead.cooker_temp || ps.cooker_temp) : '',
    pressure: special ? pressText(lead.homog_pressure) : '',
  };
  const cond = {}; for (const k of Object.keys(auto)) cond[k] = c.cond && c.cond[k] != null ? c.cond[k] : auto[k];
  const bomType = lead?.equipment === '데칸타' ? 'dc' : lead?.equipment ? 'wt' : '';
  const type = c.line ? (/데칸타/.test(c.line) ? 'dc' : 'wt') : bomType;
  const active = !c.hide && (bomItems.length > 0 || !!c.line || Object.values(c.cond || {}).some(Boolean));
  return { auto, cond, type, active, lineLabel: c.line || (type === 'dc' ? '데칸타 (호기 미지정)' : type === 'wt' ? 'WT (호기 미지정)' : ''), bomItems };
}

function planCellBody(c, { compact = false } = {}) {
  const info = cellInfo(c);
  const list = c.items || [];
  const kgs = list.map(orderKg);
  const multi = kgs.filter(k => k).length >= 2;          // 지시수량이 2개 이상이면 품목별은 작게, 합계는 맨 아래
  const total = kgs.reduce((a, k) => a + (k || 0), 0);
  const times = [...new Set(list.map(it => it.time).filter(Boolean))];
  const sharedTime = times.length === 1 ? times[0] : '';
  const items = list.map((it, k) => h('div', { class: 'pc-item' },
    h('div', { class: 'pc-name' }, it.name || bomOf(it.code)?.name || it.code),
    h('div', { class: 'pc-meta' }, [it.qty ? `${n0(it.qty)}개` : '', it.code, it.pack].filter(Boolean).join(' · ')),
    kgs[k] ? h('div', { class: multi ? 'pc-kg sub' : 'pc-kg' }, `지시수량 ${n0(kgs[k])} kg`) : null,
    !sharedTime && it.time ? h('div', { class: 'pc-meta' }, it.time) : null));
  const notes = [...(c.hopper || []), ...(c.note ? [c.note] : [])];
  void compact;
  return [
    c.note_src ? h('div', { class: 'pc-src' }, c.note_src) : null,
    items,
    sharedTime ? h('div', { class: 'pc-meta' }, sharedTime) : null,
    batchView(c.batch),
    info.active ? h('div', { class: 'pc-ann' },
      info.cond.bean ? h('div', { class: 'pa-bean' }, info.cond.bean) : null,
      info.cond.roast ? h('div', { class: 'pa-roast' }, roastLines(info.cond.roast).map(t => h('div', t))) : null,
      info.cond.cooker ? h('div', { class: 'pa-green' }, info.cond.cooker) : null,
      info.cond.pressure ? h('div', { class: 'pa-green' }, info.cond.pressure) : null,
      info.lineLabel ? h('div', { class: 'pa-line ' + info.type + (c.line ? '' : ' unset') }, info.lineLabel) : null) : null,
    notes.length ? h('div', { class: 'pa-red' }, notes.map(n => h('div', n))) : null,
    multi ? h('div', { class: 'pc-total' }, `합계 지시수량 ${n0(total)} kg`) : null,
  ];
}
// Batch(L)·포장기 칸: "<11> 5,769B 4 (w.t)" → "<11> 5,769B · 포장기 4 · (w.t)"
function batchView(raw) {
  const t = String(raw || '').replace(/포장기/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = t.match(/^(.*?)(<\d+>)?\s*([\d,]+B)?\s*(\d{1,2})?\s*(\(w\.?t\))?\s*$/i);
  const parts = m ? [[m[1], m[2], m[3]].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(), m[4] ? `포장기 ${m[4]}` : '', m[5] || ''].filter(Boolean) : [t];
  return h('div', { class: 'pc-batch' }, parts.join(' · '));
}
// "로스팅 대두 238℃/15분 씨눈함유" → ["로스팅 대두", "238℃/15분", "씨눈함유"]
function roastLines(t) {
  const m = String(t).trim().match(/^(로스팅\s*\S*)\s+(.+?)(?:\s+(씨눈\S*))?$/);
  return m ? [m[1], m[2], m[3]].filter(Boolean) : String(t).split('\n');
}
const cellClass = c => { const i = cellInfo(c); return 'pc' + (i.active && i.type ? ' box-' + i.type : '') + ((c.items || []).length || c.note_src || c.note || (c.hopper || []).length || i.active ? '' : ' empty'); };
const colName = col => (col ? `${col}호기` : '원액');

async function loadWeekPlan(date) {
  const rows = await api.list('weekly_plans', { where: [['week_start', 'lte', date]], order: 'week_start', limit: 4 });
  return rows.find(r => r.week_start <= date && r.week_end >= date) || null;
}
// 한 칸만 바꿔 저장 (다른 사람이 동시에 다른 칸을 고쳐도 덮어쓰지 않도록 최신본을 다시 읽고 합침)
async function savePlanCell(planId, date, col, patch) {
  if (!planId) throw new Error('계획표를 먼저 게시해 주세요.');
  const [cur] = await api.list('weekly_plans', { where: [['id', 'eq', planId]] });
  if (!cur) throw new Error('계획표를 찾을 수 없습니다.');
  const cells = cur.cells.map(c => (c.date === date && c.col === col ? { ...c, ...patch } : c));
  if (!cells.some(c => c.date === date && c.col === col)) cells.push({ date, col, items: [], ...patch });
  return api.update('weekly_plans', planId, { cells });
}

function planCellEdit(plan, c) {
  if (!can('production', 'write')) return;
  const info = cellInfo(c), ps = PS();
  const d = plan.days?.find(x => x.date === c.date);
  const condField = (k, label, cls) => ({ k: 'c_' + k, label, ph: info.auto[k] || '없음', help: info.auto[k] ? `BOM 자동값: ${info.auto[k]} (비우면 자동값 사용)` : '자동값 없음', full: true, cls });
  openForm({
    api, title: `${fmtDate(c.date)} ${colName(c.col)}`,
    note: (c.items || []).length ? (c.items.map(it => `${it.name} ${it.code}${orderKg(it) ? ` → 지시 ${n0(orderKg(it))}kg` : bomOf(it.code) ? '' : ' (BOM 없음)'}`).join(' / ')) : (c.note_src || '품목 없음'),
    values: { line: c.line || '', hopper: c.hopper || [], note: c.note || '', hide: !!c.hide, ...Object.fromEntries(['bean', 'roast', 'cooker', 'pressure'].map(k => ['c_' + k, c.cond?.[k] ?? ''])) },
    fields: [
      { k: 'line', label: '생산호기 지정 (번호 × 설비)', type: 'custom', render: v => lineMatrix(v, info.type), help: info.type ? `BOM 기준 설비: ${info.type === 'dc' ? '데칸타' : 'WT'}` : '' },
      { k: 'hopper', label: '호퍼 (빨간색)', type: 'chips', multi: true, opts: ps.hopper },
      { k: 'note', label: '호퍼/유량 메모 (빨간색)', ph: '예: 6,000 배합, 18,500KG', recent: true, recentKey: 'plan_note', full: true },
      condField('bean', '콩 종류 (검은색)'), condField('roast', '로스팅 조건 (주황색)'), condField('cooker', '빈쿠커 온도 (초록색)'), condField('pressure', 'WT 압력 / 균질압 (초록색)'),
      { k: 'hide', label: '표시', type: 'check', checkLabel: '이 칸은 색 표시하지 않기' },
    ],
    onSave: async v => {
      const cond = {}; for (const k of ['bean', 'roast', 'cooker', 'pressure']) if (v['c_' + k]) cond[k] = v['c_' + k];
      const patch = { line: v.line || null, hopper: v.hopper || [], note: v.note || null, cond, hide: !!v.hide };
      if (!plan.id) { // 게시 전 확인 화면: 화면 안에서만 바꾸고, 게시할 때 함께 저장
        const cell = plan.cells.find(x => x.date === c.date && x.col === c.col);
        if (cell) Object.assign(cell, patch); else plan.cells.push({ ...c, ...patch });
        return;
      }
      await savePlanCell(plan.id, c.date, c.col, patch);
    },
    after: plan.id ? rerender : () => plan._refresh?.(),
  });
  void d;
}

// 생산호기 선택판: 줄 = 설비(WT1~WT4, 데칸타), 칸 = 번호(#1~#4)
function lineMatrix(value, bomType) {
  const ps = PS();
  let cur = value || '';
  const wrap = h('div', { class: 'line-matrix' });
  const draw = () => clear(wrap,
    h('div', { class: 'lm-top' }, h('button', { type: 'button', class: 'chip' + (cur ? '' : ' on'), onclick: () => { cur = ''; draw(); } }, '미지정'),
      cur ? h('span', { class: 'lm-cur ' + (/데칸타/.test(cur) ? 'dc' : 'wt') }, '선택: ', h('b', cur)) : null),
    h('div', { class: 'lm-grid', style: { gridTemplateColumns: `72px repeat(${ps.nums.length}, minmax(0, 1fr))` } },
      h('div'), ps.nums.map(n => h('div', { class: 'lm-h' }, n)),
      ps.machines.map(m => {
        const dc = /데칸타/.test(m);
        const hint = bomType && ((bomType === 'dc') === dc);
        return [h('div', { class: 'lm-row ' + (dc ? 'dc' : 'wt') + (hint ? ' hint' : '') }, m),
          ps.nums.map(n => { const val = `${n} ${m}`; return h('button', { type: 'button', class: 'lm-btn ' + (dc ? 'dc' : 'wt') + (cur === val ? ' on' : ''), onclick: () => { cur = val; draw(); } }, val); })];
      })));
  draw();
  wrap._value = () => cur;
  return wrap;
}

function planLegend() {
  return h('div', { class: 'plan-legend' }, [['wt', 'WT'], ['dc', '데칸타'], ['bean', '콩 종류'], ['roast', '로스팅 조건'], ['green', '온도/균질압'], ['red', '호퍼/유량']].map(([k, l]) => h('span', { class: 'lg lg-' + k }, l)));
}

// 주간 표 (인쇄·PDF 저장도 이 모양)
function planSheet(plan) {
  const cols = [...(plan.cols || [1, 2, 3, 4, 5].map(no => ({ no, label: `멸균${no}호기` }))), { no: 0, label: '원액' }];
  const cellAt = (date, col) => plan.cells.find(c => c.date === date && c.col === col) || { date, col, items: [] };
  const w = can('production', 'write');
  return h('div', { class: 'plan-sheet' },
    h('div', { class: 'ps-head' }, h('div', { class: 'ps-title' }, `${weekLabel(plan.week_start)} 주간생산계획표`), h('div', { class: 'ps-sub' }, `${fmtDate(plan.week_start)} ~ ${fmtDate(plan.week_end)} · ${plan.title || ''}`), planLegend()),
    h('div', { class: 'ps-grid', style: { gridTemplateColumns: `52px repeat(${cols.length - 1}, minmax(0, 1fr)) minmax(0, .8fr)` } },
      h('div', { class: 'ps-h' }, '날짜'), cols.map(c => h('div', { class: 'ps-h' }, c.label)),
      plan.days.map(d => [
        h('div', { class: 'ps-day' + (d.date === today() ? ' today' : '') }, h('b', d.label), h('span', d.wd)),
        cols.map(col => { const c = cellAt(d.date, col.no); return h('div', { class: cellClass(c) + (w ? ' editable' : ''), onclick: () => planCellEdit(plan, c) }, planCellBody(c)); }),
      ])),
    (plan.notes?.juice || plan.notes?.da) ? h('div', { class: 'ps-notes' },
      plan.notes.juice ? h('div', h('b', '[착즙 F.C]'), h('div', plan.notes.juice)) : null,
      plan.notes.da ? h('div', h('b', '[D/A F.C]'), h('div', plan.notes.da)) : null) : null);
}
// 휴대폰용: 날짜별 카드
function planDays(plan, onlyDate) {
  const days = plan.days.filter(d => !onlyDate || d.date === onlyDate);
  return h('div', { class: 'plan-days' }, days.map(d => {
    const cells = plan.cells.filter(c => c.date === d.date).sort((a, b) => (a.col || 9) - (b.col || 9));
    const shown = cells.filter(c => !cellClass(c).includes('empty'));
    return h('div', { class: 'pd-day' },
      onlyDate ? null : h('div', { class: 'pd-date' + (d.date === today() ? ' today' : '') }, `${d.label} (${d.wd})`),
      shown.length ? h('div', { class: 'pd-cells' }, shown.map(c => h('div', { class: cellClass(c) + (can('production', 'write') ? ' editable' : ''), onclick: () => planCellEdit(plan, c) }, h('div', { class: 'pc-col' }, colName(c.col)), planCellBody(c, { compact: true }))))
        : h('div', { class: 'muted small' }, '생산 없음'));
  }));
}

VIEWS.plans = async el => {
  const q = params();
  const date = q.get('d') || today();
  const plan = await loadWeekPlan(date);
  const ws = weekStart(date);
  const w = can('production', 'write');
  const nav = h('div', { class: 'daynav' },
    h('button', { class: 'icon-btn', 'aria-label': '지난주', onclick: () => go('plans', { d: addDays(ws, -7) }) }, icon('left')),
    h('div', { class: 'date-label' }, weekLabel(date)),
    h('button', { class: 'icon-btn', 'aria-label': '다음주', onclick: () => go('plans', { d: addDays(ws, 7) }) }, icon('right')),
    ws !== weekStart(today()) ? h('button', { class: 'btn sm', onclick: () => go('plans') }, '이번 주') : null);
  const actions = [
    w ? h('button', { class: 'btn primary', onclick: () => planUpload() }, icon('plus'), '계획표 PDF 등록') : null,
  ];
  if (!plan) {
    clear(el, pageHead('주간생산계획표', `${weekLabel(date)} (${fmtDate(ws)} ~ ${fmtDate(addDays(ws, 6))})`, actions), h('div', { class: 'toolbar' }, nav),
      card('계획표 없음', h('div', { class: 'empty' }, '이 주에 등록된 주간생산계획표가 없습니다.', w ? h('div', h('button', { class: 'btn', onclick: () => planUpload() }, '계획표 PDF 등록')) : null)));
    return;
  }
  const sheet = planSheet(plan);
  clear(el, pageHead('주간생산계획표', `${weekLabel(plan.week_start)} (${fmtDate(plan.week_start)} ~ ${fmtDate(plan.week_end)})`,
    h('button', { class: 'btn', onclick: () => printPlan(plan) }, '인쇄'),
    h('button', { class: 'btn', onclick: e => savePlanPdf(plan, e.currentTarget) }, 'PDF 저장'),
    actions),
  h('div', { class: 'toolbar' }, nav, h('span', { style: { flex: 1 } }),
    plan.file_path ? h('button', { class: 'btn sm', onclick: () => openFile('docs', plan.file_path, plan.file_name) }, icon('doc'), '원본 PDF') : null,
    w ? h('button', { class: 'btn sm', onclick: () => planNotesEdit(plan) }, 'F.C 메모') : null,
    w ? h('button', { class: 'btn sm', onclick: async e => {
      const b = e.currentTarget; b.disabled = true; const t = b.textContent; b.textContent = '반영 중…';
      try { await loadCommon(); const r = await syncProductionFromPlan(plan); const msg = [r.added ? `${r.added}건 추가` : '', r.changed ? `${r.changed}건 수정` : '', r.removed ? `${r.removed}건 삭제(계획에서 빠짐)` : ''].filter(Boolean).join(' · '); toast(msg ? `생산기록 ${msg}` : '바뀐 것이 없습니다. (이미 모두 등록됨)', 'ok'); }
      catch (er) { toast('생산기록에 반영하지 못했습니다: ' + er.message, 'err'); }
      finally { b.disabled = false; b.textContent = t; }
    } }, '생산기록에 반영') : null),
  w ? h('div', { class: 'form-note', style: { marginBottom: '10px' } }, '칸을 누르면 생산호기(WT·데칸타), 호퍼비우기, 메모, 조건을 고칠 수 있습니다. 지시수량 = BOM 표준수량 × 생산량.') : null,
  h('div', { class: 'plan-wide' }, h('div', { class: 'plan-scroll' }, sheet)),
  h('div', { class: 'plan-narrow' }, planLegend(), planDays(plan),
    (plan.notes?.juice || plan.notes?.da) ? card('F.C 메모', h('div', { class: 'ps-notes' }, plan.notes.juice ? h('div', h('b', '[착즙 F.C]'), h('div', plan.notes.juice)) : null, plan.notes.da ? h('div', h('b', '[D/A F.C]'), h('div', plan.notes.da)) : null)) : null));
};

function planNotesEdit(plan) {
  openForm({ api, title: `${weekLabel(plan.week_start)} F.C 메모 (빨간색)`, values: { juice: plan.notes?.juice || '', da: plan.notes?.da || '' }, fields: [
    { k: 'juice', label: '[착즙 F.C]', type: 'textarea', ph: '예: 10/12(월) #1WT1' }, { k: 'da', label: '[D/A F.C]', type: 'textarea', ph: '예: 10/12(월) 5000,8000' }],
  onSave: async v => { const [cur] = await api.list('weekly_plans', { where: [['id', 'eq', plan.id]] }); await api.update('weekly_plans', plan.id, { notes: { ...(cur?.notes || {}), juice: v.juice || '', da: v.da || '' } }); }, after: rerender });
}

// ---------- 인쇄·PDF 저장용: 원본 계획표 양식 + 색 표시 (지시수량 없음)
function planPrintSheet(plan) {
  const cols = plan.cols || [1, 2, 3, 4, 5].map(no => ({ no, label: `멸균${no}호기` }));
  const cellAt = (date, col) => plan.cells.find(c => c.date === date && c.col === col) || { date, col, items: [] };
  const ann = c => {
    const info = cellInfo(c);
    const notes = [...(c.hopper || []), ...(c.note ? [c.note] : [])];
    return [
      info.active ? h('div', { class: 'pp-ann' },
        info.cond.bean ? h('div', { class: 'pa-bean' }, info.cond.bean) : null,
        info.cond.roast ? h('div', { class: 'pa-roast' }, roastLines(info.cond.roast).map(t => h('div', t))) : null,
        info.cond.cooker ? h('div', { class: 'pa-green' }, info.cond.cooker) : null,
        info.cond.pressure ? h('div', { class: 'pa-green' }, info.cond.pressure) : null,
        c.line ? h('div', { class: 'pa-line ' + info.type }, c.line) : null) : null,
      notes.length ? h('div', { class: 'pa-red' }, notes.map(n => h('div', n))) : null,
    ];
  };
  const prodCell = c => {
    const info = cellInfo(c);
    const box = info.active && info.type ? ' pp-box-' + info.type : '';
    return h('td', { class: 'pp-prod' }, h('div', { class: 'pp-in' + box },
      c.note_src ? h('div', c.note_src) : null,
      (c.items || []).map(it => h('div', { class: 'pp-item' },
        h('div', h('span', it.name || ''), it.qty ? h('span', { class: 'pp-qty' }, n0(it.qty)) : null),
        h('div', it.code), it.pack ? h('div', `(${it.pack})`) : null)),
      (() => { const t = [...new Set((c.items || []).map(it => it.time).filter(Boolean))]; return t.length ? t.map(x => h('div', x.replace('~', ' ~ '))) : null; })(),
      ann(c)));
  };
  const batchCell = c => h('td', { class: 'pp-batch' }, String(c.batch || '').replace(/포장기/g, '').trim().split(/\s+/).filter(Boolean).map(t => h('div', t)));
  const legend = h('div', { class: 'pp-legend' }, [['wt', 'WT'], ['dc', '데칸타'], ['bean', '콩 종류'], ['roast', '로스팅 조건'], ['green', '온도/균질압'], ['red', '호퍼/유량']].map(([k, l]) => h('span', { class: 'lg lg-' + k }, l)));
  return h('div', { class: 'pp-sheet' },
    h('div', { class: 'pp-top' }, legend, h('div', { class: 'pp-title' }, plan.title || '주간생산계획'), h('div', { class: 'pp-sub' }, `${weekLabel(plan.week_start)} · ${fmtDate(plan.week_start)} ~ ${fmtDate(plan.week_end)}`)),
    h('table', { class: 'pp-table' },
      h('colgroup', h('col', { style: { width: '38px' } }), h('col', { style: { width: '22px' } }), cols.map(() => [h('col'), h('col', { style: { width: '44px' } })]), h('col', { style: { width: '82px' } })),
      h('thead',
        h('tr', h('th', { rowspan: 2 }, '날짜'), h('th', { rowspan: 2 }, '요일'), cols.map(c => h('th', { colspan: 2 }, c.label)), h('th', { rowspan: 2 }, '두유원액·원액생산')),
        h('tr', cols.map(() => [h('th', '제품명 / 생산량(개)'), h('th', { class: 'pp-batch' }, 'Batch(L) 포장기')]))),
      h('tbody', plan.days.map(d => h('tr',
        h('td', { class: 'pp-day' }, d.label), h('td', { class: 'pp-day' }, d.wd),
        cols.map(col => { const c = cellAt(d.date, col.no); return [prodCell(c), batchCell(c)]; }),
        prodCell(cellAt(d.date, 0)))))),
    (plan.notes?.juice || plan.notes?.da) ? h('div', { class: 'pp-notes' },
      h('div', plan.notes.juice ? [h('div', '[착즙 F.C]'), h('div', plan.notes.juice)] : null),
      h('div', plan.notes.da ? [h('div', '[D/A F.C]'), h('div', plan.notes.da)] : null)) : null);
}

function printPlan(plan) {
  const holder = h('div', { class: 'print-holder' }, planPrintSheet(plan));
  document.body.append(holder);
  document.body.classList.add('printing-plan');
  const done = () => { document.body.classList.remove('printing-plan'); holder.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 2000); }, 80);
}
function loadScript(src) {
  return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('PDF 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); document.head.append(s); });
}
async function savePlanPdf(plan, btn) {
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'PDF 만드는 중…';
  const holder = h('div', { class: 'pdf-render' }, planPrintSheet(plan));
  try {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    document.body.append(holder);
    const canvas = await window.html2canvas(holder, { scale: 2, backgroundColor: '#ffffff' });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pw = 210 - 12, ph = 297 - 12;
    const r = Math.min(pw / canvas.width, ph / canvas.height);
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 6 + (pw - canvas.width * r) / 2, 6, canvas.width * r, canvas.height * r);
    pdf.save(`주간생산계획표_${plan.week_start}.pdf`);
    toast('PDF를 저장했습니다.', 'ok');
  } catch (e) { toast(e.message, 'err'); }
  finally { holder.remove(); btn.disabled = false; btn.textContent = label; }
}

function planUpload() {
  const fileIn = h('input', { type: 'file', accept: 'application/pdf,.pdf', class: 'hidden' });
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files[0]; fileIn.remove(); if (!file) return;
    toast('계획표를 읽는 중…');
    try { await loadCommon(); planPreview(parsePlan(await pdfItems(file)), file); }
    catch (e) { console.error(e); toast('계획표를 읽지 못했습니다: ' + e.message, 'err'); }
  });
  document.body.append(fileIn); fileIn.click();
}
async function planPreview(r, file) {
  const existing = await loadWeekPlan(r.start);
  const prev = existing && existing.week_start === r.start ? existing : null;
  // 다시 올리는 경우: 작업자가 지정한 호기·호퍼·메모·조건은 같은 날짜·호기 칸에 그대로 유지
  const cells = r.cells.map(c => { const o = prev?.cells.find(x => x.date === c.date && x.col === c.col); return o ? { ...c, line: o.line, hopper: o.hopper, note: o.note, cond: o.cond, hide: o.hide } : c; });
  const plan = { id: prev?.id, week_start: r.start, week_end: r.end, title: r.title, days: r.days, cols: r.cols, cells, notes: prev?.notes || {} };
  const sheetBox = h('div', { class: 'plan-scroll' });
  plan._refresh = () => clear(sheetBox, planSheet(plan));
  plan._refresh();
  const codes = cells.flatMap(c => c.items);
  const matched = codes.filter(it => bomOf(it.code)).length;
  const p = panel({
    title: `계획표 확인 · ${weekLabel(r.start)} (${fmtDate(r.start)} ~ ${fmtDate(r.end)})`,
    body: [
      h('div', { class: 'form-note' }, '칸을 눌러 생산호기·호퍼를 지금 지정할 수도 있습니다. ', `품목 ${codes.length}개 중 ${matched}개를 BOM에서 찾아 설비(WT·데칸타)·조건·지시수량을 자동으로 넣었습니다. BOM에 없는 품목(우유·주스 등)은 표시 없이 그대로 둡니다.`, prev ? ` 이 주에 이미 등록된 계획표(${prev.file_name || '이전 버전'})가 있습니다. 게시하면 이전 버전은 지워지고 이 파일만 남습니다. 작업자가 지정한 호기·호퍼·메모는 같은 날짜·호기 칸에 그대로 옮깁니다. 생산기록은 지난 날짜와 이미 입력한 기록은 그대로 두고, 오늘 이후 계획이 바뀐 날짜만 빠진 품목을 지우고 새 품목을 추가합니다.` : ''),
      r.warn.length ? h('div', { class: 'form-error' }, r.warn.join(' ')) : null,
      sheetBox,
    ],
    foot: [h('button', { class: 'btn', onclick: () => p.close() }, '취소'), h('button', { class: 'btn primary', onclick: async e => {
      const b = e.currentTarget; b.disabled = true; b.textContent = '저장 중…';
      try {
        const path = await api.upload('docs', file);
        const row = { week_start: r.start, week_end: r.end, title: r.title, days: r.days, cols: r.cols, cells, notes: plan.notes, file_path: path, file_name: file.name };
        if (prev) await api.update('weekly_plans', prev.id, row); else await api.insert('weekly_plans', { ...row, client_id: uidLite() });
        let res = { added: 0, removed: 0, changed: 0 };
        if (can('production', 'write')) { try { res = await syncProductionFromPlan(plan); } catch (er) { toast('계획표는 게시했지만 생산기록 자동 등록에 실패했습니다: ' + er.message, 'err'); } }
        const msg = [res.added ? `${res.added}건 추가` : '', res.changed ? `${res.changed}건 배치·CAPA 수정` : '', res.removed ? `${res.removed}건 삭제(계획에서 빠짐)` : ''].filter(Boolean).join(' · ');
        p.close(); toast(`주간생산계획표를 게시했습니다.${prev ? ' (이전 버전은 새 버전으로 바뀜)' : ''}${msg ? ' 생산기록 ' + msg : ''}`, 'ok'); go('plans', { d: r.start });
      } catch (er) { toast('저장하지 못했습니다: ' + er.message, 'err'); b.disabled = false; b.textContent = '확정하고 게시'; }
    } }, '확정하고 게시')],
  });
  p.el.querySelector('.panel').classList.add('wide');
}
// 주간생산계획표 → 생산기록 자동 등록
// 칸마다 BOM에 있는 첫 번째 품목 1건만, 배치수는 Batch 칸의 <n>, CAPA는 Batch 용량(5,8xxB → 6000, 7,7xxB → 8000)
// 같은 날짜·같은 제품코드 기록이 이미 있으면 건너뜀 (계획표를 다시 올려도 중복 없음, 기존 기록은 그대로)
function planProductionRows(plan) {
  const yc = S.yield_calc || DEFAULT_SETTINGS.yield_calc;
  const out = [];
  for (const c of plan.cells || []) {
    if (c.hide || !c.col) continue;
    const it = (c.items || []).find(x => bomOf(x.code));
    if (!it) continue;
    const p = bomOf(it.code);
    const b = String(c.batch || '');
    const batches = Number((b.match(/<(\d+)>/) || [])[1]) || null;
    const vol = Number(((b.match(/([\d,]+)\s*B/) || [])[1] || '').replace(/,/g, '')) || null;
    const capa = vol ? Math.ceil(vol / 2000) * 2000 : null;
    const type = cellInfo(c).type;
    if (!type) continue; // WT·데칸타로 생산하는 품목만
    out.push({
      date: c.date, product_code: it.code, product_name: p.name,
      bean_type: beanOfMaterial(p.material) || '수입콩',
      equipment: type === 'dc' ? '데칸타' : type === 'wt' ? 'WT' : (p.equipment || null), ts: p.ts ?? null,
      batches, capa, soymilk_output_kg: batches && capa ? Math.round(batches * capa * yc.output_per_capa * 100) / 100 : null,
      memo: `주간생산계획표 ${c.col}호기` + ((c.items || []).length > 1 ? ` (같은 칸: ${(c.items || []).map(x => x.name).join(', ')})` : ''),
      plan_key: `${c.date}|${it.code}`, client_id: `plan-${c.date}-${it.code}`,
    });
  }
  return out;
}
// 계획표를 새 버전으로 다시 올리면:
//  · 새 계획에도 있는 날짜·제품 → 그대로 둠 (아직 아무도 입력 안 했으면 배치수·CAPA만 새 계획대로 고침)
//  · 새 계획에서 빠진 날짜·제품 → 오늘 이후이고 아직 입력 전이면 삭제 (지난 날짜·입력한 기록은 남김)
//  · 새로 생긴 날짜·제품 → 추가
const planRowUntouched = r => r.juice_meter == null && r.meter2 == null && (r.meter1 == null || r.meter1_auto);
async function syncProductionFromPlan(plan) {
  const rows = planProductionRows(plan);
  const keep = rows.map(r => r.plan_key);
  let removed = 0, changed = 0, n = 0;
  if (plan.week_start && plan.week_end) {
    try { removed = await api.rpc('plan_prune', { p_from: plan.week_start, p_to: plan.week_end, p_keep: keep }) || 0; }
    catch (e) { if (!/plan_prune|function|지원하지/.test(e.message)) throw e; toast('이전 버전 생산기록 정리는 건너뛰었습니다. (Supabase에서 migrate_11_plan_prune.sql 실행 필요)', 'err'); }
  }
  const existing = await api.list('production', { where: [['date', 'gte', plan.week_start], ['date', 'lte', plan.week_end]] });
  const byKey = new Map(existing.map(r => [`${r.date}|${r.product_code}`, r]));
  for (const row of rows) {
    const old = byKey.get(row.plan_key);
    if (old) {
      if (old.plan_key && planRowUntouched(old) && (old.batches !== row.batches || old.capa !== row.capa || old.equipment !== row.equipment)) {
        try { await api.update('production', old.id, { batches: row.batches, capa: row.capa, equipment: row.equipment, soymilk_output_kg: row.soymilk_output_kg, memo: row.memo }); changed++; } catch { /* 권한 없으면 그대로 */ }
      }
      continue;
    }
    await api.insert('production', row); byKey.set(row.plan_key, row); n++;
  }
  return { added: n, removed, changed };
}
const uidLite = () => 'wp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ================================================================ 3. 생산기록
function productionForm(r) {
  const yc = S.yield_calc || DEFAULT_SETTINGS.yield_calc;
  const autoOutput = v => (v.batches > 0 && v.capa > 0 ? Math.round(v.batches * v.capa * yc.output_per_capa * 100) / 100 : null);
  // 원료 구분은 제품의 BOM 원료로 자동 결정 (BOM에 원료가 없는 제품만 직접 선택)
  const matOf = v => bomOf(v.product_code)?.material || null;
  const beanEff = v => beanOfMaterial(matOf(v)) || v.bean_type;
  const directOf = v => isDirectMaterial(matOf(v));
  const matBox = h('div', { class: 'mat-box' });
  const showMat = v => { const m = matOf(v); clear(matBox, m ? [h('b', m), h('span', { class: 'muted' }, isDirectMaterial(m) ? ' → 직투입: 탈피수율 100%로 계산 (수율 상태 판정 없음)' : ` → ${beanOfMaterial(m)} 기준으로 계산${beanOfMaterial(m) === '국산콩' ? ' (4층 미가동 시 1·2차 0, 0 → 탈피수율 88.88%)' : ''}`)] : h('span', { class: 'muted' }, v.product_code ? 'BOM에 원료가 없는 제품입니다. 아래에서 원료 구분을 골라 주세요.' : '제품을 고르면 BOM 원료가 자동으로 표시됩니다.')); };
  // 연류계(1·2차·착즙)만 수정 가능한 기록 (착즙 연류계가 이미 들어갔고 내가 최근에 쓴 기록이 아님)
  const lim = !!r && !canEditFull('production', 'production', r);
  const hide = f => (lim && !['date', 'meter1', 'meter2', 'juice_meter', '_mat'].includes(f.k) ? { ...f, show: () => false } : lim && f.k === 'date' ? { ...f, readonly: true } : f);
  openForm({
    api, title: r ? (lim ? '연류계 수정' : '생산기록 수정') : '생산기록', draftKey: r ? null : 'production',
    values: r || { date: today(), bean_type: '수입콩', capa: 8000 },
    note: lim ? `${productName(r.product_code, r.product_name)} · 배치 ${r.batches ?? '—'} — 이미 입력된 기록이라 1·2차·착즙 연류계만 입력·수정할 수 있습니다 (잘못 적은 값 고치기). 수율은 저장할 때 다시 계산됩니다.` : '생산 종료 후 계량전표의 "누계중량 ▶ 연류계" 값을 입력하세요. 4층에서 1·2차 연류계만 먼저 저장해 두면, 2층에서 생산이 끝난 뒤 같은 기록을 열어 착즙 연류계를 이어서 입력할 수 있습니다. 수율과 대두 투입량은 착즙 연류계까지 들어가면 자동 계산됩니다.',
    fields: [
      { k: 'date', label: '생산일', type: 'date', req: true },
      { k: 'product_code', label: '제품', type: 'select', opts: productOpts, req: true, full: true },
      { k: '_mat', label: '원료 (BOM)', type: 'custom', render: (_, vals) => { showMat(vals); matBox._value = () => null; return matBox; } },
      { k: 'bean_type', label: '원료 구분', type: 'chips', opts: Object.keys(S.yield_rules || { 수입콩: 1, 국산콩: 1 }), req: true, show: v => !matOf(v) },
      { k: 'equipment', label: '설비', type: 'chips', opts: ['WT', '데칸타'] },
      { k: 'batches', label: '배치수', type: 'number', min: 0, unit: '배치', req: true },
      { k: 'capa', label: 'CAPA', type: 'number', min: 0, req: true },
      { k: 'meter1', label: '1차 연류계', type: 'number', min: 0, unit: 'kg', help: '탈피 전 · 수입콩은 대두 SILO에 그날 사용량을 적으면 자동 입력', show: v => !directOf(v) },
      { k: 'meter2', label: '2차 연류계', type: 'number', min: 0, unit: 'kg', help: '탈피 후 (4층 미가동 시 0)', show: v => beanEff(v) === '국산콩' && !directOf(v) },
      { k: 'juice_meter', label: '착즙 연류계', type: 'number', min: 0, unit: 'kg', help: '수입콩: 연류계 · 국산콩: 그리츠 연류계 · 생산 종료 후 입력 (비워 두고 저장 가능)' },
      { k: 'soymilk_output_kg', label: '두유 Output', type: 'number', min: 0, help: '비우면 배치수 × CAPA × ' + yc.output_per_capa + ' 로 자동 입력' },
      { k: 'memo', label: '비고', type: 'textarea' },
    ].map(hide),
    onChange: (v00, box) => {
      const v0 = lim ? { ...r, ...v00, date: r.date, product_code: r.product_code } : v00;
      showMat(v0); const v = { ...v0, bean_type: beanEff(v0), direct: directOf(v0) };
      const out = v.soymilk_output_kg ?? autoOutput(v);
      const c = calcProduction({ ...v, soymilk_output_kg: out });
      const y = soyYield({ soy_input_kg: c.soy_input_kg, soymilk_output_kg: out }), eqv = v.equipment || bomOf(v.product_code)?.equipment, st = v.direct ? null : yieldStatus(v.bean_type, y, eqv), rule = ruleOf(v.bean_type, eqv);
      clear(box, h('div', { class: 'calc' },
        h('span', '탈피수율 ', h('b', v.direct ? '100% (직투입)' : c.dehull_yield ? pct(c.dehull_yield, 2) : '—'), v.bean_type === '국산콩' && v.meter1 === 0 && v.meter2 === 0 ? h('span', { class: 'muted small' }, ' (4층 미가동)') : null),
        h('span', '대두 투입량 ', h('b', c.soy_input_kg ? n1(c.soy_input_kg) + ' kg' : '—')),
        h('span', '1B 대두투입량 ', h('b', v.juice_meter != null && v.batches > 0 ? n1(v.juice_meter / v.batches) + ' kg' : '—')),
        bomOf(v.product_code)?.ts != null ? h('span', '제품TS ', h('b', fmtTs(bomOf(v.product_code).ts))) : null,
        h('span', '착즙수율 ', h('b', c.extract_yield ? pct(c.extract_yield, 2) : '—')),
        h('span', '두유수율 ', h('b', y ? pct(y) : '—')), st ? ysBadge(st) : null,
        v.soymilk_output_kg == null && out ? h('span', { class: 'muted small' }, `두유 Output 자동 ${n2(out)}`) : null,
        v.direct ? h('div', { class: 'muted small', style: { width: '100%' } }, '직투입 원료: 탈피수율 100% (대두 투입량 = 착즙 연류계) · 수율 상태 기준은 테스트 후 정할 예정') : rule ? h('div', { class: 'muted small', style: { width: '100%' } }, `${eqv === '데칸타' ? '데칸타' : 'WT'} · ${v.bean_type} 기준: 양호 ≥${rule.good}% · 주의 ≥${rule.caution}% · 경고 ≥${rule.warning}%`) : null));
    },
    onSave: async (v, c) => {
      if (lim) { // 1·2차 연류계와 그에 따른 계산값만 저장
        const direct = directOf(r); const row = { ...r, meter1: direct ? null : v.meter1 ?? null, meter2: beanEff(r) === '국산콩' ? v.meter2 ?? null : null, juice_meter: v.juice_meter ?? null };
        const calc = calcProduction({ ...row, bean_type: beanEff(r), direct });
        const patch = { meter1: row.meter1, meter2: row.meter2, juice_meter: row.juice_meter, meter1_auto: !!(r.meter1_auto && row.meter1 === r.meter1), dehull_yield: calc.dehull_yield, soy_input_kg: calc.soy_input_kg, extract_yield: calc.extract_yield };
        patch.yield_status = direct ? null : yieldStatus(beanEff(r), soyYield({ ...r, ...patch }), r.equipment || bomOf(r.product_code)?.equipment);
        return api.update('production', r.id, patch);
      }
      const { _silo, _mat, ...row } = v; void _silo; void _mat; // 예전 임시 저장값 무시
      row.bean_type = beanEff(row);
      const direct = directOf(row);
      if (direct) { row.meter1 = null; row.meter2 = null; }
      if (row.soymilk_output_kg == null && row.juice_meter != null) row.soymilk_output_kg = autoOutput(row);
      if (row.bean_type !== '국산콩') row.meter2 = null;
      const calc = calcProduction({ ...row, direct });
      Object.assign(row, { dehull_yield: calc.dehull_yield, soy_input_kg: calc.soy_input_kg, extract_yield: calc.extract_yield });
      row.product_name = productName(row.product_code, row.product_name);
      const bom = bomOf(row.product_code);
      if (!row.equipment && bom?.equipment) row.equipment = bom.equipment;   // 설비를 비우면 BOM 설비
      if (bom) row.ts = bom.ts ?? null;                                     // 제품TS는 BOM 값
      row.yield_status = direct ? null : yieldStatus(row.bean_type, soyYield(row), row.equipment);
      // 1차 연류계를 직접 바꾸면 자동 입력 대상에서 빠짐 (SILO 사용량이 바뀌어도 덮어쓰지 않음)
      row.meter1_auto = r && r.meter1_auto && row.meter1 === r.meter1;
      const saved = r ? await api.update('production', r.id, row) : await api.insert('production', { ...row, client_id: c.client_id });
      return saved;
    },
    doneMsg: v => (v.juice_meter == null ? '저장했습니다. 착즙 연류계는 생산 종료 후 이 기록을 열어 이어서 입력하세요.' : null),
    after: rerender,
  });
}
// 제품TS·설비는 BOM 값 (생산기록에 저장된 값이 없으면 BOM에서)
const prodTs = r => { const b = bomOf(r.product_code); return b?.ts ?? r.ts ?? null; };
const prodEq = r => r.equipment || bomOf(r.product_code)?.equipment || '';
const perBatch = r => (r.juice_meter != null && r.batches > 0 ? r.juice_meter / r.batches : null);   // 1B 대두투입량 = 착즙 연류계 ÷ 배치수
const fmtTs = v => (v == null || v === '' ? '' : n2(v));
const prodState = r => (r.juice_meter != null ? null : r.plan_key && r.meter1 == null && !isDirectRow(r) ? badge('계획표 · 입력 필요', 'caution') : badge('착즙 연류계 대기', 'info')); // 직투입 원료는 1·2차가 없어 바로 착즙 연류계 대기
function productionDetail(r) {
  const y = soyYield(r);
  detail({ title: `생산기록 ${fmtDate(r.date)}`, tableName: 'production', row: r, rows: [
    ['생산일', h('span', fmtDateLong(r.date), ' ', prodState(r))], ['원료', bomOf(r.product_code)?.material ? `${bomOf(r.product_code).material} (${r.bean_type})` : r.bean_type], ['설비', prodEq(r)], ['제품', `${r.product_code || '코드 없음'} · ${productName(r.product_code, r.product_name)}`],
    ['배치수 / CAPA', `${n0(r.batches)} 배치 / ${n0(r.capa)}`], ['제품TS', prodTs(r) != null ? fmtTs(prodTs(r)) : '— (제품·BOM에서 입력)'],
    ['연류계', [r.meter1 != null ? `1차 ${n0(r.meter1)}${r.meter1_auto ? '(SILO 자동)' : ''}` : '', r.meter2 != null ? `2차 ${n0(r.meter2)}` : '', r.juice_meter != null ? `${r.bean_type === '국산콩' ? '그리츠' : '착즙'} ${n0(r.juice_meter)}` : ''].filter(Boolean).join(' · ')],
    ['대두 투입량', r.soy_input_kg != null ? `${n1(r.soy_input_kg)} kg` : ''], ['1B 대두투입량', perBatch(r) != null ? `${n1(perBatch(r))} kg (착즙 연류계 ÷ 배치수)` : ''], ['두유 Output', n2(r.soymilk_output_kg)],
    ['두유수율', y ? h('span', h('b', pct(y)), ' ', isDirectRow(r) ? badge('직투입 · 기준 미정') : ysBadge(yieldStatus(r.bean_type, y, prodEq(r)))) : ''],
    ['탈피 / 착즙수율', `${r.dehull_yield != null ? pct(r.dehull_yield, 2) : '—'} / ${r.extract_yield != null ? pct(r.extract_yield, 2) : '—'}`],
    ['비고', r.memo]],
    actions: rowActions('production', 'production', r, () => productionForm(r)) });
}
VIEWS.production = async el => {
  const q = params();
  const from = q.get('from') || addDays(today(), -29), to = q.get('to') || today(), bean = q.get('bean') || '';
  let rows = await api.list('production', { where: [['date', 'gte', from], ['date', 'lte', to]], order: 'date' });
  if (bean) rows = rows.filter(r => r.bean_type === bean);
  const sum = k => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const tin = sum('soy_input_kg'), tout = rows.filter(r => r.soymilk_output_kg > 0 && r.soy_input_kg > 0 && !isDirectRow(r));
  const avgY = tout.length ? tout.reduce((a, r) => a + r.soymilk_output_kg, 0) / tout.reduce((a, r) => a + r.soy_input_kg, 0) * 100 : null;
  const w = can('production', 'write');
  clear(el, pageHead('생산기록', `${fmtDate(from)} ~ ${fmtDate(to)} · ${rows.length}건`, w ? addBtn('기록 추가', () => productionForm()) : null),
    rangeBar('production', from, to, chipsFilter([['', '전체'], ...Object.keys(S.yield_rules).map(k => [k, k])], bean, b => go('production', { from, to, bean: b }))),
    h('div', { class: 'grid g3', style: { marginBottom: '14px' } },
      stat('대두 투입량 합계', n0(tin), 'kg'), stat('배치수 합계', n0(sum('batches')), '배치'),
      stat('평균 두유수율', avgY ? pct(avgY) : '—', '', '두유 Output 합 ÷ 대두 투입량 합')),
    card('기록 목록', table(rows, [
      { label: '생산일', v: r => h('span', fmtDate(r.date), ' ', sampleBadge(r), prodState(r)), lead: true },
      { label: '원료', v: r => bomOf(r.product_code)?.material || r.bean_type }, { label: '설비', v: r => prodEq(r) },
      { label: '제품', v: r => productName(r.product_code, r.product_name) },
      { label: '배치', v: r => n0(r.batches), cls: 'num' },
      { label: '제품TS', v: r => fmtTs(prodTs(r)), cls: 'num' },
      { label: '대두 투입(kg)', v: r => n0(r.soy_input_kg), cls: 'num' },
      { label: '착즙수율', v: r => (r.extract_yield != null ? pct(r.extract_yield, 1) : ''), cls: 'num' },
      { label: '두유수율', v: r => pct(soyYield(r)), cls: 'num' },
      { label: '수율 상태', v: r => (isDirectRow(r) ? (soyYield(r) ? badge('직투입 · 기준 미정') : '') : ysBadge(yieldStatus(r.bean_type, soyYield(r), prodEq(r)))) },
      { label: '1B 대두투입량', v: r => (perBatch(r) != null ? n1(perBatch(r)) : ''), cls: 'num' },
    ], { onRow: productionDetail, emptyAction: w ? h('button', { class: 'btn', onclick: () => productionForm() }, '기록 추가') : null })),
    h('div', { class: 'unit-note' }, '두유수율(%) = 두유 Output ÷ 대두 투입량 × 100 · 대두 투입량 = 착즙 연류계 ÷ 탈피수율 · 1B 대두투입량(kg) = 착즙 연류계 ÷ 배치수 · 제품TS = 제품·BOM 값 · 착즙수율 = 두유액(Output × 7%) ÷ 착즙 연류계. 기준값은 관리 → 기준값·권한에서 바꿀 수 있습니다.'));
};
function stat(lbl, val, unit, foot) {
  return h('div', { class: 'card stat' }, h('div', { class: 'lbl' }, lbl), h('div', { class: 'val' }, val, unit ? h('small', unit) : null), foot ? h('div', { class: 'foot' }, foot) : null);
}

// ================================================================ 4. 대두 SILO
const siloDelta = t => (t.type === '입고' ? t.qty_kg : t.type === '사용' ? -t.qty_kg : t.qty_kg);
// 사용 기록: 날짜 · SILO · 구분(사용) · 수량
// 입고 기록: 날짜 · SILO · 구분(입고/조정) · 원산지 · 수량
function siloForm(t, preset = {}) {
  const use = (t?.type || preset.type) === '사용';
  openForm({
    api, title: t ? `SILO ${use ? '사용' : '입고'} 기록 수정` : use ? 'SILO 사용 기록' : 'SILO 입고 기록', draftKey: t ? null : use ? 'silo-use' : 'silo-in',
    values: t || { date: today(), type: use ? '사용' : '입고', silo: S.lists.silos[0], ...preset },
    fields: [
      { k: 'date', label: '날짜', type: 'date', req: true },
      { k: 'silo', label: 'SILO', type: 'chips', opts: S.lists.silos.map(s => ({ value: s, label: `${s}번 SILO` })), req: true },
      { k: 'type', label: '구분', type: 'chips', opts: use ? ['사용'] : ['입고', '조정'], req: true, help: use ? '' : '조정: 실사 재고와 맞추거나 기초 재고를 넣을 때 사용 (+/− 가능)' },
      ...(use ? [] : [{ k: 'origin', label: '원산지', type: 'chips', opts: S.lists.origins, check: (x, v) => (v.type === '입고' && !x ? '입고는 원산지를 꼭 선택해 주세요.' : null) }]),
      { k: 'qty_kg', label: '수량', type: 'number', unit: 'kg', req: true, help: use ? '그날 사용량 · 원산지는 그 SILO의 입고 기록으로 판단하고, 수입콩이면 그날 1차 연류계에 자동 반영' : '',
        check: (x, v) => (v.type !== '조정' && !(x > 0) ? '0보다 큰 값을 입력해 주세요.' : x === 0 ? '0은 입력할 수 없습니다.' : null) },
    ],
    onSave: async (v, c) => {
      const row = { ...v, silo: Number(v.silo) };
      if (!use) row.origin = v.origin || null;
      return t ? api.update('silo_tx', t.id, row) : api.insert('silo_tx', { ...row, client_id: c.client_id });
    },
    after: rerender,
  });
}
function siloDetail(t) {
  detail({ title: `${t.silo}번 SILO ${t.type}`, tableName: 'silo_tx', row: t, rows: [
    ['날짜', fmtDateLong(t.date)], ['SILO', `${t.silo}번`], ['구분', t.type], ['원산지', t.origin], ['수량', `${n0(t.qty_kg)} kg`],
    t.product_code ? ['생산 품목', productName(t.product_code)] : null, t.batches ? ['배치수', n0(t.batches)] : null, ['비고', t.memo]],
    actions: rowActions('silo', 'silo_tx', t, () => siloForm(t)) });
}
VIEWS.silo = async el => {
  const q = params();
  const year = Number(q.get('y') || today().slice(0, 4));
  const from = q.get('from') || addDays(today(), -13), to = q.get('to') || today();
  const all = await api.list('silo_tx', { order: 'date', asc: true });
  all.sort((a, b) => a.date.localeCompare(b.date) || String(a.created_at).localeCompare(String(b.created_at)));
  const cap = S.rules.silo_capacity_kg || 0;
  const silos = S.lists.silos;
  const w = can('silo', 'write');

  // 현재 재고·원산지 구성: 재고가 0kg이 된 뒤(완전히 비운 뒤) 들어온 입고만으로 판단
  //  한 원산지만 들어왔으면 그 원산지, 다른 원산지가 섞여 들어오면 '원산지 혼합'
  const stocks = {};
  const cards = silos.map(s => {
    const tx = all.filter(t => t.silo === s);
    // 하루 단위로 판단: 전일 재고 + 조정 − 그날 사용량 ≤ 0 이면 그날 비운 것 →
    // 원산지는 그날 들어온 입고만으로 다시 시작 (같은 날 입고·사용 입력 순서와 무관)
    let stock = 0, emptied = null, byOrigin = {};
    const days = [...new Set(tx.map(t => t.date))].sort();
    for (const d of days) {
      const dt = tx.filter(t => t.date === d);
      const inQ = {}; let inSum = 0, use = 0, adj = 0;
      for (const t of dt) {
        if ((t.type === '입고' || (t.type === '조정' && t.origin)) && t.qty_kg > 0) { const o = t.origin || '미지정'; inQ[o] = (inQ[o] || 0) + t.qty_kg; inSum += t.qty_kg; }
        else if (t.type === '사용') use += t.qty_kg;
        else adj += siloDelta(t);
      }
      if (stock + adj - use <= 0) { emptied = d; byOrigin = { ...inQ }; }
      else for (const [o, q] of Object.entries(inQ)) byOrigin[o] = (byOrigin[o] || 0) + q;
      stock = stock + inSum + adj - use;
      if (stock <= 0) byOrigin = {};
    }
    const origins = Object.keys(byOrigin);
    stocks[s] = stock;
    const last = [...tx].reverse().find(t => t.type === '입고');
    const ratio = cap ? Math.min(100, stock / cap * 100) : null;
    const tag = stock <= 0 ? badge('비어 있음') : origins.length > 1 ? badge('원산지 혼합', 'caution') : origins.length ? badge(origins[0], 'info') : null;
    return h('div', { class: 'card stat' },
      h('div', { class: 'lbl', style: { display: 'flex', gap: '6px', alignItems: 'center' } }, `${s}번 SILO 현재고`, tag),
      h('div', { class: 'val' }, n0(stock), h('small', 'kg')),
      ratio != null ? h('div', { class: 'bar' + (ratio < 15 ? ' low' : ''), style: { margin: '6px 0' }, title: `용량 ${n0(cap)} kg 기준` }, h('i', { style: { width: Math.max(0, ratio) + '%' } })) : null,
      h('div', { class: 'foot' }, stock <= 0 ? `${emptied ? fmtDate(emptied) + ' 에 비움 · ' : ''}다음 입고 원산지로 표시됩니다`
        : origins.length ? `${emptied ? fmtDate(emptied) + ' 비운 뒤' : '처음부터'} 입고: ${origins.map(o => `${o} ${n0(byOrigin[o])}kg`).join(', ')}` : '원산지 기록 없음 (입고하면 표시)'),
      h('div', { class: 'foot' }, last ? `마지막 입고 ${fmtDate(last.date)} · ${last.origin} ${n0(last.qty_kg)}kg` : ''));
  });

  // 일자별 장부 (전일 재고 → 입고 → 사용 → 금일 재고)
  const ledger = [];
  for (const s of silos) {
    const tx = all.filter(t => t.silo === s);
    let bal = tx.filter(t => t.date < from).reduce((a, t) => a + siloDelta(t), 0);
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const dayTx = tx.filter(t => t.date === d);
      const inQ = {}; let use = 0, adj = 0;
      for (const t of dayTx) { if (t.type === '입고') inQ[t.origin] = (inQ[t.origin] || 0) + t.qty_kg; else if (t.type === '사용') use += t.qty_kg; else adj += t.qty_kg; }
      const prev = bal; bal = prev + Object.values(inQ).reduce((a, b) => a + b, 0) - use + adj;
      if (dayTx.length || d === to) ledger.push({ d, s, prev, inQ, use, adj, bal, memo: dayTx.map(t => t.memo).filter(Boolean).join(' / '), tx: dayTx });
    }
  }
  ledger.sort((a, b) => b.d.localeCompare(a.d) || a.s - b.s);
  const origins = S.lists.origins;

  // 올해 원산지별 입고량 · 월별 사용량
  const yr = all.filter(t => t.date.startsWith(String(year)));
  const inByOrigin = origins.map(o => ({ o, v: yr.filter(t => t.type === '입고' && t.origin === o).reduce((a, t) => a + t.qty_kg, 0) })).filter(x => x.v > 0);
  const monthly = [...Array(12)].map((_, i) => ({ label: `${i + 1}월`, v: yr.filter(t => t.type === '사용' && Number(t.date.slice(5, 7)) === i + 1).reduce((a, t) => a + t.qty_kg, 0) }));
  const yrIn = yr.filter(t => t.type === '입고').reduce((a, t) => a + t.qty_kg, 0), yrUse = monthly.reduce((a, m) => a + m.v, 0);

  // 1·2번 SILO 합계 현재고
  const siloTotal = () => {
    const total = silos.reduce((a, k) => a + (stocks[k] || 0), 0), capAll = cap * silos.length;
    const ratio = capAll ? Math.min(100, total / capAll * 100) : null;
    return h('div', { class: 'card stat' },
      h('div', { class: 'lbl' }, `SILO 합계 현재고 (${silos.map(k => k + '번').join('+')})`),
      h('div', { class: 'val' }, n0(total), h('small', 'kg')),
      ratio != null ? h('div', { class: 'bar' + (ratio < 15 ? ' low' : ''), style: { margin: '6px 0' }, title: `용량 ${n0(capAll)} kg 기준` }, h('i', { style: { width: Math.max(0, ratio) + '%' } })) : null,
      h('div', { class: 'foot' }, silos.map(k => `${k}번 ${n0(stocks[k] || 0)}kg`).join(' · ')),
      capAll ? h('div', { class: 'foot' }, `전체 용량 ${n0(capAll)}kg 중 ${Math.round(ratio)}%`) : null);
  };
  clear(el, pageHead('대두 SILO 재고', '입고·사용 기록으로 재고를 자동 계산합니다.',
    w ? h('button', { class: 'btn primary use', onclick: () => siloForm(null, { type: '사용' }) }, icon('minus'), '사용 기록') : null, w ? addBtn('입고 기록', () => siloForm(null, { type: '입고' })) : null),
    h('div', { class: 'grid g3', style: { marginBottom: '14px' } }, stat(`${year}년 총 입고량`, n0(yrIn), 'kg'), stat(`${year}년 총 사용량`, n0(yrUse), 'kg'), siloTotal()),
    h('div', { class: 'grid g2', style: { marginBottom: '14px' } }, cards),
    card('일자별 장부', [rangeBar('silo', from, to), table(ledger, [
      { label: '날짜', v: r => h('span', h('b', fmtDate(r.d)), ` · ${r.s}번`), lead: true },
      { label: '전일 재고', v: r => n0(r.prev), cls: 'num' },
      ...origins.filter(o => ledger.some(l => l.inQ[o])).map(o => ({ label: `입고(${o})`, v: r => n0(r.inQ[o]), cls: 'num' })),
      { label: '사용량', v: r => n0(r.use || null), cls: 'num' },
      { label: '조정', v: r => (r.adj ? (r.adj > 0 ? '+' : '') + n0(r.adj) : ''), cls: 'num' },
      { label: '금일 재고', v: r => h('b', n0(r.bal)), cls: 'num' },
      { label: '비고', v: r => r.memo },
    ], { onRow: r => r.tx.length && siloDayDetail(r), empty: '기간 안의 기록이 없습니다.' })]),
    h('div', { class: 'grid g2', style: { marginTop: '14px' } },
      card(`${year}년 원산지별 입고량`, inByOrigin.length ? table(inByOrigin, [{ label: '원산지', v: r => r.o, lead: true }, { label: '입고량(kg)', v: r => n0(r.v), cls: 'num' }], { foot: ['합계', n0(yrIn)], cards: false }) : h('div', { class: 'muted small' }, '입고 기록이 없습니다.'),
        h('select', { class: 'input', style: { width: 'auto', minHeight: '32px' }, onchange: e => go('silo', { ...Object.fromEntries(params()), y: e.target.value }) }, [year + 1, year, year - 1, year - 2].map(y => h('option', { value: y, selected: y === year }, `${y}년`)))),
      card(`${year}년 월별 대두 사용량`, [barChart(monthly, { unit: ' kg' }), h('div', { class: 'unit-note' }, '단위: kg (SILO 사용 기록 합계)')])));
}

function siloDayDetail(r) {
  const p = panel({ title: `${fmtDate(r.d)} ${r.s}번 SILO 기록`, body: h('div', { class: 'list' }, r.tx.map(t => h('div', { class: 'li click', onclick: () => { p.close(); siloDetail(t); } },
    badge(t.type, t.type === '입고' ? 'ok' : t.type === '사용' ? 'info' : 'caution'),
    h('div', { class: 'grow' }, h('div', { class: 't' }, `${n0(t.qty_kg)} kg ${t.origin ? '· ' + t.origin : ''}`, ' ', sampleBadge(t)), h('div', { class: 's' }, `${personName(t.created_by)} · ${fmtFull(t.created_at)}${t.memo ? ' · ' + t.memo : ''}`))))) });
}

// ================================================================ 5. 설비·정비
function repeatInfo(list) {
  const days = S.rules.repeat_days || 30, cnt = S.rules.repeat_count || 3;
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const map = {};
  for (const m of list) if (isBreakdown(m.kind) && (m.done_at || m.occurred_at || m.created_at) >= since)
    for (const sy of symptomsOf(m)) { const k = m.equipment_id + '|' + sy; map[k] = (map[k] || 0) + 1; }
  const hits = m => symptomsOf(m).filter(sy => (map[m.equipment_id + '|' + sy] || 0) >= cnt);
  return { map, cnt, days, hits, is: m => hits(m).length > 0 };
}
// 정비 완료일(날짜만): 같은 날이면 원래 시각 유지, 오늘이면 지금 시각, 그 외는 그날 정오로 저장 (정렬용)
const localDay = iso => new Date(iso).toLocaleDateString('sv-SE');
const doneStamp = (day, prev) => (prev && localDay(prev) === day ? prev : day === today() ? new Date().toISOString() : new Date(day + 'T12:00:00').toISOString());
async function maintForm(m, preset = {}) {
  // 정비 일정에서 잡은 '예정' 기록(또는 예정으로 새로 잡기)만 상태 선택, 그 외는 항상 완료
  const planned = (m?.status && m.status !== '완료') || preset.status === '예정';
  const isNew = !m;
  const partRows = [];
  let curEq = m?.equipment_id || preset.equipment_id || null;
  let curSym = m ? symptomsOf(m) : (preset.symptom || []);
  let showAll = false, sugg = [], hist = [], histEq = null;
  const sugBox = h('div', { class: 'part-sug' });
  const allChk = h('input', { type: 'checkbox', onchange: () => { showAll = allChk.checked; partRows.forEach(r => fillOpts(r.sel)); } });
  const allLbl = h('label', { class: 'muted small', style: { display: 'none', alignItems: 'center', gap: '6px', fontWeight: 400 } }, allChk, '다른 설비 부품도 보기');
  const partsBox = isNew && can('parts', 'write') && C.parts.length ? h('div', { class: 'field full' }, h('label', '사용 부품 (재고에서 자동 차감)'),
    h('div', { class: 'muted small' }, '설비를 고르면 그 설비에 들어가는 부품만 나옵니다. 고장 증상을 고르면 필요한 부품을 먼저 보여 줍니다.'),
    sugBox, h('div', { class: 'list' }),
    h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' } }, h('button', { class: 'btn sm', type: 'button', onclick: () => addPartRow() }, icon('plus'), '부품 추가'), allLbl)) : null;
  const mineOf = eq => eq ? C.parts.filter(x => usageOf(x.id).some(u => u.equipment_id === eq)) : [];
  const fillOpts = sel => { const v = sel.value; clear(sel, h('option', { value: '' }, '부품 선택'), partOpts(C.parts, curEq, { all: showAll, first: sugg.map(r => r.id) }).map(o => h('option', { value: o.value, selected: o.value === v }, o.label))); if (v && sel.value !== v) { const x = C.parts.find(p => p.id === v); if (x) { sel.append(h('option', { value: v, selected: true }, partLabel(x, curEq))); } } };
  const qtyOn = id => { const u = curEq && usageOf(id).find(u => u.equipment_id === curEq); return u ? u.qty : 1; };
  const addPartRow = (pid) => {
    const sel = h('select', { class: 'input' });
    const qty = h('input', { class: 'input', type: 'number', min: 1, value: 1, inputmode: 'numeric', style: { width: '90px' } });
    sel.addEventListener('change', () => { qty.value = qtyOn(sel.value); drawSug(); });
    const row = h('div', { class: 'li' }, h('div', { class: 'grow' }, sel), qty, h('button', { class: 'icon-btn', type: 'button', 'aria-label': '삭제', onclick: () => { row.remove(); partRows.splice(partRows.indexOf(entry), 1); drawSug(); } }, icon('x')));
    const entry = { sel, qty }; partRows.push(entry); partsBox.querySelector('.list').append(row);
    fillOpts(sel); if (pid) { sel.value = pid; qty.value = qtyOn(pid); }
    drawSug();
  };
  // 추천 부품 칩: 누르면 바로 사용 부품에 추가 (1대당 수량으로)
  const drawSug = () => {
    if (!partsBox) return;
    allLbl.style.display = mineOf(curEq).length ? 'inline-flex' : 'none';
    const picked = new Set(partRows.map(r => r.sel.value));
    if (!sugg.length) { clear(sugBox, curEq && curSym.length ? h('div', { class: 'muted small' }, `"${curSym.join(', ')}"에 지정된 부품이 아직 없습니다. 부품관리 → 정보 수정의 "관련 정비 항목"에서 지정하면 다음부터 먼저 나옵니다.`) : null); return; }
    const left = sugg.filter(r => !picked.has(r.id));
    clear(sugBox, h('div', { class: 'part-sug-head' }, h('b', `추천 부품 · ${curSym.join(', ')}`), left.length > 1 ? h('button', { class: 'btn sm', type: 'button', onclick: () => left.forEach(r => addPartRow(r.id)) }, `모두 추가 (${left.length})`) : null),
      h('div', { class: 'chips' }, sugg.map(r => { const x = C.parts.find(p => p.id === r.id); const on = picked.has(r.id);
        return h('button', { type: 'button', class: 'chip sm' + (on ? ' on' : ''), disabled: on, title: r.set ? '부품에 지정된 정비 항목' : `이 설비에서 같은 정비 때 ${r.n}번 사용`, onclick: () => addPartRow(r.id) },
          `${on ? '✓ ' : '+ '}${x.name}${x.spec ? ' ' + x.spec : ''} · ${qtyOn(r.id)}개 · `, h('span', { class: 'sug-meta' + (x.stock < qtyOn(r.id) ? ' bad' : '') }, `재고 ${x.stock}`), !r.set && r.n ? h('span', { class: 'sug-meta' }, `\u00a0· 이전 ${r.n}회`) : null); })));
  };
  const refreshSug = async () => {
    if (!partsBox) return;
    if (curEq && curEq !== histEq) { // 이 설비의 지난 정비에서 증상별로 쓴 부품
      histEq = curEq; hist = [];
      try {
        const ms = (await api.list('maintenance', { where: [['equipment_id', 'eq', curEq]], order: 'created_at', limit: 300 })).filter(x => symptomsOf(x).length);
        if (ms.length) { const tx = await api.list('part_tx', { where: [['maintenance_id', 'in', ms.map(x => x.id)]] }); const sy = Object.fromEntries(ms.map(x => [x.id, symptomsOf(x)])); hist = tx.filter(t => t.type === '사용').map(t => ({ part_id: t.part_id, syms: sy[t.maintenance_id] || [] })); }
      } catch { hist = []; }
      if (histEq !== curEq) return;
    }
    sugg = suggestParts(curEq, curSym, hist);
    partRows.forEach(r => fillOpts(r.sel)); drawSug();
  };
  openForm({
    api, title: m ? '정비 기록 수정' : '정비 기록', draftKey: m ? null : 'maint',
    values: m ? { ...m, symptom: symptomsOf(m), done_at: m.done_at ? localDay(m.done_at) : null } : { kind: maintKinds()[0], status: '완료', done_at: today(), worker: me.name, symptom: [], ...preset },
    fields: [
      { k: 'equipment_id', label: '설비', type: 'select', opts: equipmentOpts, req: true, full: true, ph: '설비 선택' },
      { k: 'kind', label: '정비 구분', type: 'chips', opts: [...new Set([...maintKinds(), ...(m?.kind ? [m.kind] : [])])], req: true },
      ...(planned ? [{ k: 'status', label: '진행 상태', type: 'chips', opts: ['예정', '완료'], req: true, help: '정비를 마쳤으면 완료로 바꿔 저장하세요.' }] : []),
      { k: 'symptom', label: '고장 증상 (여러 개 선택 가능)', type: 'chips', multi: true, opts: [...new Set([...S.lists.symptoms, ...(m ? symptomsOf(m) : [])])], help: '긴급정비·사후정비는 꼭 선택', check: (x, v) => (isBreakdown(v.kind) && !(x || []).length ? '긴급정비·사후정비는 증상을 하나 이상 선택해 주세요.' : null) },
      { k: 'done_at', label: '정비 완료일', type: 'date', show: v => v.status !== '예정', help: '비워 두면 오늘 날짜로 기록' },
      { k: 'due_date', label: '정비 예정일', type: 'date', show: v => v.status === '예정' },
      { k: 'action', label: '조치 내용', type: 'textarea', ph: '점검·수리·교체한 내용' },
      { k: 'worker', label: '작업자', recent: true },
      { k: 'photos', label: '사진', type: 'photos' },
    ],
    extra: partsBox ? (refreshSug(), partsBox) : partsBox,
    onChange: v => {
      const eq = v.equipment_id || null, sy = v.symptom || [];
      if (eq !== curEq || sy.join('|') !== curSym.join('|')) { curEq = eq; curSym = sy; refreshSug(); }
    },
    onSave: async (v, c) => {
      if (!planned) v.status = '완료';
      const row = { ...v, done_at: v.status === '완료' ? doneStamp(v.done_at || today(), m?.done_at) : null, symptom: (v.symptom || []).join(', ') || null };
      const used = partRows.map(p => ({ part: p.sel.value, qty: Number(p.qty.value) })).filter(p => p.part);
      for (const u of used) if (!(u.qty > 0)) throw new Error('부품 수량은 1 이상이어야 합니다.');
      const saved = m ? await api.update('maintenance', m.id, row) : await api.insert('maintenance', { ...row, client_id: c.client_id });
      const fails = [];
      for (const u of used) {
        try { await api.rpc('part_move', { p_part: u.part, p_type: '사용', p_qty: u.qty, p_maintenance: saved.id, p_reason: `정비 사용 · ${eqName(row.equipment_id)}`, p_client: `${c.client_id}-${u.part}` }); }
        catch (e) { fails.push(`${C.parts.find(p => p.id === u.part)?.name}: ${e.message}`); }
      }
      if (row.status === '완료') { const eq = C.equipment.find(e => e.id === row.equipment_id); if (eq && eq.status !== '정상' && can('master', 'write')) { try { await api.update('equipment', eq.id, { status: '정상' }); } catch { /* */ } } }
      if (fails.length) { await loadCommon(); throw new Error('정비 기록은 저장했지만 일부 부품 차감에 실패했습니다 → ' + fails.join(' / ') + ' (부품관리에서 확인하세요)'); }
      await loadCommon();
      return saved;
    },
    after: rerender,
  });
}
async function maintDetail(m, all = []) {
  const [tx] = await Promise.all([can('parts') ? api.list('part_tx', { where: [['maintenance_id', 'eq', m.id]] }) : []]);
  const photos = h('div', { class: 'thumbs' });
  for (const p of m.photos || []) { const img = h('img', { alt: '정비 사진', style: { cursor: 'zoom-in' } }); api.fileUrl('photos', p).then(u => { img.src = u; img.onclick = () => window.open(u, '_blank'); }); photos.append(img); }
  const rep = repeatInfo(all);
  detail({ title: `정비 · ${eqName(m.equipment_id)}`, tableName: 'maintenance', row: m, rows: [
    ['설비', eqName(m.equipment_id)], ['구분', m.kind], ['상태', stBadge(m.status)],
    m.symptom ? ['고장 증상', h('span', m.symptom, ' ', rep.hits(m).map(sy => [' ', badge(`반복: ${sy} (${rep.days}일 내 ${rep.map[m.equipment_id + '|' + sy]}회)`, 'bad')]))] : null,
    m.done_at ? ['정비 완료일', fmtDateLong(localDay(m.done_at))] : null, m.occurred_at ? ['발생 시각', fmtFull(m.occurred_at)] : null, m.due_date ? ['예정일', fmtDateLong(m.due_date)] : null,
    ['조치 내용', m.action], ['작업자', m.worker],
    ['사용 부품', tx.length ? tx.map(t => `${C.parts.find(p => p.id === t.part_id)?.name || '부품'} ${Math.abs(t.qty)}개`).join(', ') : '없음'],
    ['사진', (m.photos || []).length ? photos : '없음']],
    actions: [
      ...(can('parts', 'write') && C.parts.length ? [{ label: '부품 사용 추가', run: () => partMove(null, '사용', m) }] : []),
      ...rowActions('maintenance', 'maintenance', m, () => maintForm(m))] });
}
VIEWS.maint = async el => {
  const q = params();
  const st = q.get('st') || 'all', cat = q.get('cat') || '';
  const all = await api.list('maintenance', { order: 'created_at' });
  const rep = repeatInfo(all);
  let rows = all.filter(m => st === 'all' ? true : st === 'open' ? m.status !== '완료' : m.status === '완료');
  if (cat) rows = rows.filter(m => C.equipment.find(e => e.id === m.equipment_id)?.category === cat);
  rows.sort((a, b) => String(b.done_at || b.occurred_at || b.due_date || b.created_at).localeCompare(String(a.done_at || a.occurred_at || a.due_date || a.created_at)));
  const repeats = Object.entries(rep.map).filter(([, n]) => n >= rep.cnt);
  const w = can('maintenance', 'write');
  if (q.get('id')) { const m = all.find(x => x.id === q.get('id')); if (m) setTimeout(() => maintDetail(m, all), 0); }
  clear(el, pageHead('정비 기록', `${rows.length}건`, w ? addBtn('정비 기록', () => maintForm()) : null),
    repeats.length ? h('div', { class: 'notice-strip', style: { cursor: 'default' } }, h('b', '반복 고장'), h('div', repeats.map(([k, n]) => { const [eid, sym] = k.split('|'); return h('div', `${eqName(eid)} · ${sym} — 최근 ${rep.days}일 ${n}회`); }))) : null,
    h('div', { class: 'toolbar' }, chipsFilter([['all', '전체'], ['open', '예정'], ['done', '완료']], st, v => go('maint', { st: v, cat })),
      h('select', { class: 'input', onchange: e => go('maint', { st, cat: e.target.value }) }, h('option', { value: '' }, '전체 설비 분류'), S.lists.equipment_categories.map(c => h('option', { value: c, selected: c === cat }, c)))),
    card('정비 목록', table(rows, [
      { label: '설비', v: r => h('span', h('b', eqName(r.equipment_id)), ' ', sampleBadge(r)), lead: true },
      { label: '구분', v: r => r.kind },
      { label: '증상·내용', v: r => h('span', r.symptom || r.action || '', ' ', rep.is(r) ? badge('반복', 'bad') : null) },
      { label: '완료일', v: r => (r.done_at ? fmtDate(r.done_at) : r.due_date ? '예정 ' + fmtDate(r.due_date) : r.occurred_at ? '발생 ' + fmtDT(r.occurred_at) : '') },
      { label: '작업자', v: r => r.worker },
      { label: '상태', v: r => stBadge(r.status) },
    ], { onRow: r => maintDetail(r, all), emptyAction: w ? h('button', { class: 'btn', onclick: () => maintForm() }, '정비 기록') : null })));
};
VIEWS.schedule = async el => {
  const all = await api.list('maintenance', { order: 'due_date', asc: true });
  const t = today();
  const planned = all.filter(m => m.status !== '완료' && m.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date));
  // 정기정비 도래: 설비별 주기 vs 마지막 예방정비 완료일
  const pm = C.equipment.filter(e => e.pm_cycle_days > 0 && e.status !== '사용안함').map(e => {
    const last = all.filter(m => m.equipment_id === e.id && m.kind === '예방정비' && m.status === '완료').map(m => (m.done_at || m.created_at).slice(0, 10)).sort().pop();
    const next = last ? addDays(last, e.pm_cycle_days) : null;
    const hasPlan = planned.some(m => m.equipment_id === e.id && m.kind === '예방정비');
    return { e, last, next, hasPlan };
  }).filter(x => !x.hasPlan && (!x.next || x.next <= addDays(t, 14))).sort((a, b) => String(a.next || '').localeCompare(String(b.next || '')));
  const done = all.filter(m => m.status === '완료').sort((a, b) => String(b.done_at).localeCompare(String(a.done_at))).slice(0, 15);
  const w = can('maintenance', 'write');
  clear(el, pageHead('정비 일정', '예정된 정비와 정기정비 도래 설비', w ? addBtn('정비 예정 등록', () => maintForm(null, { kind: '예방정비', status: '예정', occurred_at: null, due_date: addDays(t, 1) })) : null),
    h('div', { class: 'grid g2' },
      card(`예정 정비 (${planned.length})`, table(planned, [
        { label: '예정일', v: r => h('span', h('b', fmtDate(r.due_date)), ' ', r.due_date < t ? badge('지남', 'bad') : r.due_date === t ? badge('오늘', 'warn') : null, ' ', sampleBadge(r)), lead: true },
        { label: '설비', v: r => eqName(r.equipment_id) }, { label: '내용', v: r => r.action || r.symptom || r.kind }, { label: '상태', v: r => stBadge(r.status) },
      ], { onRow: r => maintDetail(r, all), empty: '예정된 정비가 없습니다.' })),
      card('정기정비 도래 (14일 이내)', pm.length ? h('div', { class: 'list' }, pm.map(x => h('div', { class: 'li' },
        h('div', { class: 'grow' }, h('div', { class: 't' }, `${eqLabel(x.e)} · ${x.e.category}`),
          h('div', { class: 's' }, x.last ? `마지막 예방정비 ${fmtDate(x.last)} · 주기 ${x.e.pm_cycle_days}일 → ${x.next < t ? '기한 지남' : '도래 ' + fmtDate(x.next)}` : `예방정비 완료 이력 없음 · 주기 ${x.e.pm_cycle_days}일`)),
        w ? h('button', { class: 'btn sm', onclick: () => maintForm(null, { equipment_id: x.e.id, kind: '예방정비', status: '예정', occurred_at: null, due_date: x.next && x.next > t ? x.next : addDays(t, 1), action: '정기 예방정비' }) }, '예정 등록') : null)))
        : h('div', { class: 'muted small' }, '도래한 정기정비가 없습니다. (설비 목록에서 정비 주기를 넣으면 자동 계산됩니다)'))),
    h('div', { style: { marginTop: '14px' } }, card('최근 완료 이력', table(done, [
      { label: '완료일', v: r => h('b', fmtDate(r.done_at)), lead: true }, { label: '설비', v: r => eqName(r.equipment_id) }, { label: '구분', v: r => r.kind },
      { label: '내용', v: r => r.action || r.symptom }, { label: '작업자', v: r => r.worker },
    ], { onRow: r => maintDetail(r, all), empty: '완료 이력이 없습니다.' }))));
};

// 설비 목록
function equipmentForm(e) {
  openForm({ api, title: e ? '설비 수정' : '설비 추가', values: e || { status: '정상', category: S.lists.equipment_categories[0] }, fields: [
    { k: 'category', label: '설비 분류', type: 'chips', opts: S.lists.equipment_categories, req: true, check: x => (S.lists.equipment_categories.includes(x) ? null : '설정에 있는 분류를 골라 주세요.') },
    { k: 'name', label: '설비명', req: true }, { k: 'code', label: '설비번호' },
    { k: 'location', label: '위치', recent: true }, { k: 'pm_cycle_days', label: '정기정비 주기', type: 'number', min: 1, unit: '일', help: '비우면 정기정비 알림 없음' },
    { k: 'status', label: '상태', type: 'chips', opts: ['정상', '점검중', '고장', '사용안함'], req: true },
  ], onSave: saveRow('equipment', e), after: async () => { await loadCommon(); rerender(); } });
}
VIEWS.equipment = async el => {
  const all = await api.list('maintenance');
  const w = can('master', 'write');
  const cats = S.lists.equipment_categories;
  // 설정에서 지운 분류에 남은 설비: 사용 중이면 '분류 없음'으로 따로 보여주고, 사용안함이면 숨김
  const orphans = C.equipment.filter(e => !cats.includes(e.category));
  const orphanActive = orphans.filter(e => e.status !== '사용안함');
  const hiddenCount = orphans.length - orphanActive.length;
  const shownCount = C.equipment.length - hiddenCount;
  clear(el, pageHead('설비 목록', `${shownCount}대 · 실제 설비명과 번호로 수정해 사용하세요.`, w ? addBtn('설비 추가', () => equipmentForm()) : null),
    h('div', { class: 'eq-grid' }, eqLayout(cats).concat(orphanActive.length ? [['__none']] : []).map((row, ri) => h('div', { class: 'eq-row', style: `--n:${row.length}` }, row.map(c => {
      const list = c === '__none' ? orphanActive : C.equipment.filter(e => e.category === c);
      return h('div', { class: 'eq-card' }, card(c === '__none' ? '분류 없음 (설정에서 지운 분류)' : c, table(list, [
        { label: '설비', v: e => h('span', h('b', eqLabel(e)), ' ', sampleBadge(e)), lead: true },
        { label: '정비 주기', v: e => (e.pm_cycle_days ? `${e.pm_cycle_days}일` : '') },
        { label: '정비 건수', v: e => n0(all.filter(m => m.equipment_id === e.id).length), cls: 'num' },
        { label: '상태', v: e => badge(e.status, { 정상: 'ok', 점검중: 'caution', 고장: 'bad' }[e.status] || '') },
      ], { onRow: e => detail({ title: e.name, tableName: 'equipment', row: e, rows: [['분류', e.category], ['설비번호', e.code], ['위치', e.location], ['정기정비 주기', e.pm_cycle_days ? `${e.pm_cycle_days}일` : '—'], ['상태', e.status],
        ['정비 이력', `${all.filter(m => m.equipment_id === e.id).length}건`]],
        extra: eqDetailExtra(e, all),
        actions: [...(can('maintenance', 'write') ? [{ label: '정비 기록', run: () => maintForm(null, { equipment_id: e.id }) }] : []), ...(w ? rowActions('master', 'equipment', e, () => equipmentForm(e)) : [])] }),
      empty: '이 분류에 등록된 설비가 없습니다.' }),
      c === '__none' && isAdmin() ? h('button', { class: 'btn sm primary', onclick: () => removeCategoriesDialog([...new Set(orphanActive.map(e => e.category))], orphanActive, cats) }, '정리하기') : null));
    })))),
    hiddenCount ? h('div', { class: 'unit-note' }, `지운 분류의 설비 ${hiddenCount}대는 '사용안함'으로 숨겨져 있습니다. 관리 → 기준값·권한 → 설비 분류에 그 분류를 다시 추가하면 보입니다.`) : null);
};

// 설비 상세 아래쪽: 정비 이력 / 들어가는 부품 (부품 연결이 있을 때만 탭)
function eqDetailExtra(e, all) {
  const n = C.usage.filter(u => u.equipment_id === e.id).length;
  if (!n || !can('parts')) return eqHistory(e, all);
  const box = h('div');
  let tab = 'hist';
  const tabs = h('div', { class: 'chips', style: { margin: '4px 0 10px' } });
  const draw = () => {
    clear(tabs, [['hist', '정비 이력'], ['parts', `들어가는 부품 ${n}종`]].map(([k, l]) => h('button', { type: 'button', class: 'chip sm' + (tab === k ? ' on' : ''), onclick: () => { tab = k; draw(); } }, l)));
    clear(box, tab === 'hist' ? eqHistory(e, all) : eqParts(e));
  };
  draw();
  return h('div', tabs, box);
}
// 설비 상세: 이 설비에서 어떤 부분을 언제 정비했는지 (부분별 요약 + 날짜별 목록)
function eqHistory(e, all) {
  const day = m => (m.done_at ? localDay(m.done_at) : m.due_date || localDay(m.occurred_at || m.created_at));
  const list = all.filter(m => m.equipment_id === e.id && m.status === '완료').sort((a, b) => day(b).localeCompare(day(a)) || String(b.created_at).localeCompare(String(a.created_at)));
  const planned = all.filter(m => m.equipment_id === e.id && m.status !== '완료');
  if (!list.length && !planned.length) return h('div', { class: 'muted small', style: { marginTop: '6px' } }, '아직 정비 기록이 없습니다.');
  const what = m => symptomsOf(m).length ? symptomsOf(m) : [m.action || m.kind || '기타'];
  const by = {};
  for (const m of list) for (const w of what(m)) (by[w] ||= []).push(day(m));
  const parts = Object.entries(by).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const sd = d => { const [, mm, dd] = d.split('-'); return `${+mm}/${+dd}`; };
  const gap = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
  // 교체 날짜를 칸으로 나열 (화면 폭에 맞춰 자동 줄바꿈). 각 칸 아래 = 앞 교체로부터 며칠
  //  평균의 절반보다 짧은 간격은 빨간색으로 표시 (빨리 다시 교체한 경우)
  const gapLine = asc => {
    const g = asc.map((d, i) => (i ? gap(asc[i - 1], d) : null)), pos = g.filter(x => x > 0);
    const avg = pos.length ? pos.reduce((a, b) => a + b, 0) / pos.length : 0;
    return h('div', { class: 'gap-flow' }, asc.map((d, i) => h('div', { class: 'gap-item' + (i && avg && g[i] < avg / 2 ? ' short' : ''), title: d },
      h('b', sd(d)), h('small', !i ? '첫 기록' : g[i] ? `+${g[i]}일` : '같은 날'))));
  };
  const gapSummary = desc => {
    const asc = [...desc].reverse(), g = asc.slice(1).map((d, i) => gap(asc[i], d)).filter(x => x > 0);
    const since = gap(desc[0], today());
    return g.length
      ? `평균 ${Math.round(g.reduce((a, b) => a + b, 0) / g.length)}일 간격 (최소 ${Math.min(...g)}일 · 최대 ${Math.max(...g)}일) · 마지막 ${fmtDate(desc[0])}, ${since}일 경과`
      : `마지막 ${fmtDate(desc[0])}, ${since}일 경과`;
  };
  return h('div',
    parts.length ? [h('div', { style: { fontWeight: 600, margin: '4px 0 2px' } }, '부분별 정비'), h('div', { class: 'muted small' }, '칸 아래 숫자 = 앞 교체로부터 지난 일수 · 빨간 칸 = 평균 간격의 절반도 안 돼 다시 교체'),
      h('div', { class: 'list', style: { marginBottom: '14px' } }, parts.map(([w, ds]) => h('div', { class: 'li' },
        h('div', { class: 'grow' }, h('div', { class: 't' }, w, ' ', h('span', { class: 'muted small' }, `${ds.length}회`)),
          gapLine([...ds].reverse()),
          h('div', { class: 's' }, gapSummary(ds))))))] : null,
    h('div', { style: { fontWeight: 600, margin: '4px 0 6px' } }, `정비 이력 (${list.length}건)`),
    table(list, [
      { label: '완료일', v: m => h('b', fmtDate(day(m))), lead: true },
      { label: '구분', v: m => m.kind },
      { label: '정비 내용', v: m => what(m).join(', ') + (m.action && symptomsOf(m).length ? ` · ${m.action}` : '') },
      { label: '작업자', v: m => m.worker },
    ], { onRow: m => maintDetail(m, all), empty: '완료된 정비가 없습니다.' }),
    planned.length ? h('div', { class: 'muted small', style: { marginTop: '8px' } }, `예정된 정비 ${planned.length}건: ` + planned.map(m => `${m.due_date ? fmtDate(m.due_date) : '날짜 미정'} ${m.kind || ''}`).join(', ')) : null);
}

// 설비 목록 배치: 첫 줄 = 마쇄기·WT, 둘째 줄 = 나머지(설정 순서). 휴대폰에서는 한 줄에 하나
function eqLayout(cats) {
  const first = ['마쇄기', 'WT'].map(k => cats.find(c => c.includes(k))).filter(Boolean);
  const rest = cats.filter(c => !first.includes(c));
  const rows = [];
  if (first.length) rows.push([...new Set(first)]);
  for (let i = 0; i < rest.length; i += 3) rows.push(rest.slice(i, i + 3));
  return rows;
}

// ================================================================ 6. 부품관리
// 부품 × 설비별 수량(part_usage): 어느 설비에 1대당 몇 개 들어가는지
const usageOf = pid => C.usage.filter(u => u.part_id === pid);
const needOf = p => usageOf(p.id).reduce((a, u) => a + u.qty, 0);   // 1회 교체분 = 사용 설비 1대당 수량의 합
const isGauge = p => /PRESSURE\s*GAUGE|압력계/i.test(`${p.name} ${p.spec || ''}`);
const stageLabel = p => (p.stage ? (isGauge(p) ? `${p.stage} 압력계` : p.stage) : '');
const partLow = p => p.stock < p.min_stock;
const partShort = p => { const n = needOf(p); return n > 0 && p.stock < n; };
const eqOfCat = c => C.equipment.filter(e => e.category === c);
// 설비명이 모두 "○호기 ○차" 꼴인 분류(WT 등)는 호기 × 차 표로 보여 줌
const UNIT_RE = /(\d+)\s*호기\s*(\d+)\s*차/;
function unitGrid(eqs) {
  const m = eqs.map(e => ({ e, k: String(e.name).match(UNIT_RE) }));
  if (eqs.length < 2 || m.some(x => !x.k)) return null;
  const hs = [...new Set(m.map(x => +x.k[1]))].sort((a, b) => a - b), cs = [...new Set(m.map(x => +x.k[2]))].sort((a, b) => a - b);
  return { hs, cs, at: (hh, cc) => m.find(x => +x.k[1] === hh && +x.k[2] === cc)?.e || null };
}
// 목록용 작은 표: 호기 × 차 칸에 1대당 수량 (그 외 분류는 "설비명 ×수량")
function usageMini(p) {
  const us = usageOf(p.id);
  if (!us.length) return p.equipment ? h('span', { class: 'muted' }, p.equipment) : '';
  const byCat = {};
  for (const u of us) { const e = C.equipment.find(x => x.id === u.equipment_id); if (e) (byCat[e.category] ||= []).push([e, u.qty]); }
  const cats = Object.keys(byCat);
  return h('div', { class: 'umini-wrap' }, cats.map(c => {
    const g = unitGrid(eqOfCat(c)); const q = new Map(byCat[c].map(([e, n]) => [e.id, n]));
    if (!g) return h('div', { class: 'uchips' }, byCat[c].map(([e, n]) => h('span', { class: 'uchip' }, `${eqLabel(e)} ×${n}`)));
    return h('div', { class: 'umini', style: { gridTemplateColumns: `30px repeat(${g.hs.length}, 26px)` } },
      h('i', { class: 'hd', title: c }, cats.length > 1 ? c.slice(0, 2) : ''), g.hs.map(x => h('i', { class: 'hd', title: `${x}호기` }, `${x}호`)),
      g.cs.map(cc => [h('i', { class: 'hd' }, `${cc}차`), g.hs.map(hh => {
        const e = g.at(hh, cc); const n = e && q.get(e.id);
        return h('i', { class: n ? 'on' : '', title: e ? `${eqLabel(e)} · ${n ? n + '개' : '안 들어감'}` : '' }, n ? String(n) : '·');
      })]));
  }));
}
const spareBadge = p => { const need = needOf(p); if (!need) return null; const s = p.stock - need; return badge((s > 0 ? '+' : '') + s, s >= 0 ? 'ok' : p.stock === 0 ? 'bad' : 'warn'); };

// 부품 등록·수정 화면의 "사용 설비와 1대당 수량" 칸
function usageEditor(p) {
  const val = new Map((p ? usageOf(p.id) : []).map(u => [u.equipment_id, u.qty]));
  const cats = S.lists.equipment_categories.filter(c => eqOfCat(c).length);
  const firstUsed = [...val.keys()].map(id => C.equipment.find(e => e.id === id)).find(Boolean);
  let cat = firstUsed?.category || cats.find(c => unitGrid(eqOfCat(c))) || cats[0];
  const chips = h('div', { class: 'chips' }), box = h('div'), sum = h('div', { class: 'usage-sum' });
  const inp = e => {
    const i = h('input', { class: 'input uq' + (val.get(e.id) ? ' on' : ''), type: 'number', min: 0, step: 1, inputmode: 'numeric', value: val.get(e.id) || '', 'aria-label': `${eqLabel(e)} 1대당 수량` });
    i.addEventListener('input', () => { const n = Math.round(Number(i.value)); if (n > 0) val.set(e.id, n); else val.delete(e.id); i.classList.toggle('on', n > 0); summary(); });
    return i;
  };
  const summary = () => {
    const used = [...val.entries()].map(([id, n]) => [C.equipment.find(e => e.id === id), n]).filter(x => x[0]);
    const tot = used.reduce((a, [, n]) => a + n, 0);
    const other = [...new Set(used.filter(([e]) => e.category !== cat).map(([e]) => e.category))];
    const spare = p ? p.stock - tot : null;
    clear(sum, used.length ? [h('span', `사용 설비 ${used.length}대`), h('span', `1회 교체분 ${tot}개`),
      p ? h('span', `현재고 ${p.stock}개 → 여유 `, h('b', { style: { color: spare < 0 ? 'var(--bad)' : 'var(--ok)' } }, (spare > 0 ? '+' : '') + spare)) : null,
      other.length ? h('span', `다른 분류에도 있음: ${other.join(', ')}`) : null] : h('span', '아직 사용 설비가 없습니다.'));
  };
  const draw = () => {
    clear(chips, cats.map(c => {
      const n = [...val.keys()].filter(id => C.equipment.find(e => e.id === id)?.category === c).length;
      return h('button', { type: 'button', class: 'chip sm' + (c === cat ? ' on' : ''), onclick: () => { cat = c; draw(); summary(); } }, n ? `${c} ${n}` : c);
    }));
    const eqs = eqOfCat(cat), g = unitGrid(eqs);
    clear(box, g
      ? h('div', { class: 'ugrid', style: { gridTemplateColumns: `52px repeat(${g.hs.length}, minmax(0, 1fr))` } },
        h('span'), g.hs.map(x => h('span', { class: 'hd' }, `${x}호기`)),
        g.cs.map(cc => [h('span', { class: 'hd' }, `${cc}차`), g.hs.map(hh => { const e = g.at(hh, cc); return e ? inp(e) : h('span'); })]))
      : h('div', { class: 'ulist' }, eqs.map(e => h('label', { class: 'ulist-i' }, h('span', eqLabel(e)), inp(e)))));
  };
  draw(); summary();
  const el = h('div', { class: 'field full usage-ed' }, h('label', '사용 설비와 1대당 수량'),
    h('div', { class: 'muted small' }, '설비 1대에 들어가는 개수를 넣으세요. 빈칸은 그 설비에 안 들어가는 것으로 봅니다.'), chips, box, sum);
  return { el, value: () => new Map(val) };
}
// 바뀐 칸만 저장 (추가·수량 변경·삭제)
async function saveUsage(partId, next, prev) {
  for (const u of prev) {
    if (!next.has(u.equipment_id)) await api.remove('part_usage', u.id);
    else if (next.get(u.equipment_id) !== u.qty) await api.update('part_usage', u.id, { qty: next.get(u.equipment_id) });
  }
  for (const [eid, qty] of next) if (!prev.some(u => u.equipment_id === eid)) await api.insert('part_usage', { part_id: partId, equipment_id: eid, qty });
}

function partForm(p) {
  const ue = C.usageReady ? usageEditor(p) : null;
  const mats = [...new Set(C.parts.map(x => x.material).filter(Boolean))].sort();
  openForm({ api, title: p ? '부품 정보 수정' : '부품 등록', draftKey: p ? null : 'part', values: p ? { symptoms: [], ...p, symptoms: p.symptoms || [], photo: p.photo ? [p.photo] : [], stage: p.stage || '없음' } : { min_stock: 0, stage: '없음' },
    note: p ? '현재고는 여기서 바꿀 수 없습니다. 입고·사용·정정 기록으로만 변경됩니다.' : null,
    fields: [
      { k: 'part_no', label: 'Part No (품번)', req: true, help: '같은 품번은 중복 등록되지 않습니다.' }, { k: 'name', label: '부품명', req: true },
      { k: 'spec', label: '규격', ph: '예: Ø44.2*3, 400Bar', recent: true },
      { k: 'material', label: '설비 안 위치 (Material)', ph: '예: HOMO, CHECK VALVE', suggest: () => mats },
      { k: 'stage', label: '1차 / 2차 구분', type: 'chips', opts: ['없음', '1차', '2차'], help: '압력계는 "1차 압력계 / 2차 압력계"로 표시됩니다.' },
      ...(symReady() || (!C.parts.length && C.usageReady) ? [{ k: 'symptoms', label: '관련 정비 항목', type: 'chips', multi: true, full: true, opts: [...new Set([...S.lists.symptoms, ...(p?.symptoms || [])])], help: '정비 기록에서 이 항목(고장 증상)을 고르면 이 부품을 사용 부품 맨 위에 추천합니다. 예: 1번 Seal 교체 → Seal·O-ring' }] : []),
      { k: 'location', label: '보관 위치', recent: true }, { k: 'min_stock', label: '적정재고', type: 'number', min: 0, unit: '개', req: true, help: '이보다 적으면 "재고 부족"으로 알립니다.' },
      { k: 'due_date', label: '입고 예정일', type: 'date' },
      ...(!ue || (p?.equipment && !usageOf(p.id).length) ? [{ k: 'equipment', label: '적용 설비 (메모)', suggest: () => C.equipment.map(e => e.name), recent: true, help: '위 표로 옮긴 뒤에는 비워도 됩니다.' }] : []),
      { k: 'photo', label: '사진', type: 'photos' },
      ...(!p ? [{ k: '_init', label: '현재 재고 (선택)', type: 'number', min: 0, unit: '개', help: '입력하면 등록과 동시에 입고로 기록합니다.' }] : []),
      { k: 'note', label: '비고', type: 'textarea', full: true },
    ],
    extra: ue?.el,
    onSave: async (v, c) => {
      const { _init, photo, ...row } = v; row.photo = (photo || [])[0] || null; row.spec = row.spec || null; row.note = row.note || null; row.min_stock = Math.round(row.min_stock);
      row.material = row.material || null; row.stage = row.stage === '1차' || row.stage === '2차' ? row.stage : null; row.due_date = row.due_date || null;
      if (!C.usageReady) { delete row.material; delete row.stage; delete row.due_date; }
      if ('symptoms' in row) row.symptoms = row.symptoms || []; if (!symReady() && C.parts.length) delete row.symptoms;
      let saved;
      if (p) saved = await api.update('parts', p.id, row);
      else {
        if (C.parts.some(x => x.part_no === row.part_no)) throw new Error('이미 같은 품번이 등록되어 있습니다.');
        saved = await api.insert('parts', { ...row, client_id: c.client_id });
        if (_init > 0) await api.rpc('part_move', { p_part: saved.id, p_type: '입고', p_qty: Math.round(_init), p_reason: '최초 등록 재고', p_client: c.client_id + '-init' });
      }
      if (ue) await saveUsage(saved.id, ue.value(), p ? usageOf(p.id) : []);
      return saved;
    },
    after: async () => { await loadCommon(); rerender(); } });
  // 설비별 수량 칸은 "1차 / 2차 구분" 바로 아래로 (아래쪽 사진·비고보다 먼저 보이게)
  if (ue) { const f = [...(ue.el.closest('.panel') || document).querySelectorAll('.field')].find(x => x !== ue.el && /^1차 \/ 2차/.test(x.querySelector('label')?.textContent || '')); if (f) f.after(ue.el); }
}
function partMove(p, type, maint) {
  const parts = p ? [p] : C.parts;
  openForm({
    api, title: `부품 ${type}${p ? ' · ' + p.name : ''}`, saveLabel: `${type} 저장`,
    note: type === '정정' ? '잘못 입력된 재고를 바로잡습니다. 늘릴 때는 +, 줄일 때는 − 숫자를 입력하고 사유를 꼭 적어 주세요. 원래 기록은 지워지지 않고 정정 기록이 추가됩니다.'
      : type === '사용' ? '재고보다 많이 사용할 수 없습니다.' : null,
    values: { part: p?.id || null, qty: type === '정정' ? null : 1 },
    fields: [
      ...(!p ? [{ k: 'part', label: '부품', type: 'select', req: true, full: true, opts: partOpts(parts, maint?.equipment_id) }] : []),
      { k: 'qty', label: type === '정정' ? '변경 수량 (+/−)' : '수량', type: 'number', unit: '개', req: true, step: 1,
        check: x => (!Number.isInteger(x) ? '정수로 입력해 주세요.' : type !== '정정' && x <= 0 ? '1 이상 입력해 주세요.' : x === 0 ? '0은 입력할 수 없습니다.' : null) },
      { k: 'reason', label: type === '정정' ? '정정 사유' : '메모', type: 'textarea', req: type === '정정', ph: type === '입고' ? '예: 구매 입고, 업체명' : '' },
    ],
    onSave: async (v, c) => {
      const id = p?.id || v.part;
      const r = await api.rpc('part_move', { p_part: id, p_type: type, p_qty: v.qty, p_maintenance: maint?.id || null, p_reason: v.reason || (maint ? `정비 사용 · ${eqName(maint.equipment_id)}` : null), p_client: c.client_id });
      await loadCommon(); return r;
    },
    after: rerender,
  });
}
// 부품 고르기 목록: 설비가 정해져 있으면 그 설비 부품을 먼저
const partLabel = (x, eqId) => { const u = eqId && usageOf(x.id).find(u => u.equipment_id === eqId); return `${x.name}${x.spec ? ' ' + x.spec : ''} (${x.part_no})${stageLabel(x) ? ' · ' + stageLabel(x) : ''} · 재고 ${x.stock}${u ? ` · 1대당 ${u.qty}` : ''}`; };
// all=false 이고 설비에 등록된 부품이 있으면 그 설비 부품만 / first: 추천 부품(맨 위)
function partOpts(parts, eqId, { all = true, first = [] } = {}) {
  const mine = eqId ? parts.filter(x => usageOf(x.id).some(u => u.equipment_id === eqId)) : [];
  const o = x => ({ value: x.id, label: partLabel(x, eqId) });
  const top = first.map(id => parts.find(x => x.id === id)).filter(Boolean);
  const pool = mine.length && !all ? mine : parts;
  const rest = pool.filter(x => !top.includes(x));
  const mark = x => (mine.length && all && mine.includes(x) ? '★ ' : '');
  return [...top.map(x => ({ ...o(x), label: '추천 · ' + o(x).label })), ...rest.filter(x => mine.includes(x)).map(x => ({ ...o(x), label: mark(x) + o(x).label })), ...rest.filter(x => !mine.includes(x)).map(o)];
}
// 정비 증상별 추천 부품: 부품에 지정한 '관련 정비 항목' + 이 설비에서 같은 증상 정비 때 썼던 부품
const symReady = () => api.mode === 'demo' || (C.parts.length > 0 && 'symptoms' in C.parts[0]);
function suggestParts(eqId, syms, hist) {
  if (!eqId || !syms.length) return [];
  const onEq = id => !C.usage.length || !C.usage.some(u => u.part_id === id) || usageOf(id).some(u => u.equipment_id === eqId);
  const out = new Map();
  for (const x of C.parts) { const hit = (x.symptoms || []).filter(sy => syms.includes(sy)); if (hit.length && onEq(x.id)) out.set(x.id, { id: x.id, set: true, n: 0 }); }
  for (const t of hist) if (onEq(t.part_id) && syms.some(sy => t.syms.includes(sy))) { const r = out.get(t.part_id) || { id: t.part_id, set: false, n: 0 }; r.n++; out.set(t.part_id, r); }
  return [...out.values()].filter(r => C.parts.some(x => x.id === r.id)).sort((a, b) => (b.set - a.set) || (b.n - a.n));
}
async function partDetail(p) {
  const tx = await api.list('part_tx', { where: [['part_id', 'eq', p.id]], order: 'created_at' });
  const img = p.photo ? h('img', { alt: p.name, style: { maxWidth: '100%', maxHeight: '220px', borderRadius: '10px', border: '1px solid var(--line)' } }) : null;
  if (img) api.fileUrl('photos', p.photo).then(u => { img.src = u; });
  const w = can('parts', 'write');
  const need = needOf(p), us = usageOf(p.id);
  detail({ title: p.name, tableName: 'parts', row: p, rows: [
    ['Part No', p.part_no], ['규격', p.spec], p.material ? ['설비 안 위치', p.material] : null, stageLabel(p) ? ['구분', stageLabel(p)] : null,
    us.length ? ['사용 설비', h('div', usageMini(p), h('div', { class: 'muted small', style: { marginTop: '6px' } }, us.map(u => `${eqName(u.equipment_id)} ${u.qty}개`).join(' · ')))] : ['적용 설비', p.equipment],
    (p.symptoms || []).length ? ['관련 정비 항목', p.symptoms.join(', ')] : null,
    ['보관 위치', p.location],
    ['현재고 / 적정재고', h('span', h('b', `${p.stock}개`), ` / ${p.min_stock}개 `, partLow(p) ? badge('부족', 'bad') : badge('충분', 'ok'))],
    need ? ['1회 교체분 / 여유', h('span', `${need}개 / `, spareBadge(p))] : null,
    p.due_date ? ['입고 예정일', fmtDateLong(p.due_date)] : null,
    img ? ['사진', img] : null, p.note ? ['비고', h('span', { style: { whiteSpace: 'pre-wrap' } }, p.note)] : null],
    extra: h('div', h('div', { style: { fontWeight: 600, margin: '4px 0 6px' } }, '입고·사용 이력'), table(tx, [
      { label: '일시', v: t => fmtDT(t.created_at), lead: true }, { label: '구분', v: t => badge(t.type, t.type === '입고' ? 'ok' : t.type === '사용' ? 'info' : 'caution') },
      { label: '수량', v: t => (t.qty > 0 ? '+' : '') + t.qty, cls: 'num' }, { label: '이후 재고', v: t => t.stock_after, cls: 'num' },
      { label: '기록자', v: t => personName(t.created_by) }, { label: '메모', v: t => t.reason },
    ], { empty: '이력이 없습니다.' })),
    actions: (isAdmin() ? [{ label: '삭제', kind: 'danger', run: async () => {
      const n = (C.usage || []).filter(u => u.part_id === p.id).length;
      if (!(await confirmDlg('부품 삭제', `${p.part_no || ''} ${p.name || ''} 부품을 삭제할까요?\n입고·사용 이력${n ? `과 사용 설비 ${n}곳의 수량` : ''}도 함께 지워지고 되돌릴 수 없습니다. (삭제했다는 기록은 변경 이력에 남습니다)`, '삭제', true))) return;
      try { await api.rpc('admin_delete_part', { p_id: p.id }); toast('부품을 삭제했습니다.', 'ok'); await loadCommon(); rerender(); } catch (e) { toast(e.message, 'err'); }
    } }] : []).concat(w ? [{ label: '정정', run: () => partMove(p, '정정') }, { label: '정보 수정', run: () => partForm(p) }, { label: '사용', run: () => partMove(p, '사용') }, { label: '입고', kind: 'primary', run: () => partMove(p, '입고') }] : []) });
}
VIEWS.parts = async el => {
  const q = params(); const s = (q.get('q') || '').toLowerCase(); const st = q.get('st') || (q.get('low') === '1' ? 'low' : '');
  const cat = q.get('cat') || '', eq = q.get('eq') || '', mat = q.get('mat') || '';
  await loadCommon();
  const nav = patch => go('parts', { q: search.value, st, cat, eq, mat, ...patch });
  const eqCat = id => C.equipment.find(e => e.id === id)?.category;
  const inCat = p => !cat || usageOf(p.id).some(u => eqCat(u.equipment_id) === cat) || (!usageOf(p.id).length && eqOfCat(cat).some(e => p.equipment && String(p.equipment).includes(e.name)));
  const base = C.parts.filter(inCat).filter(p => !eq || usageOf(p.id).some(u => u.equipment_id === eq));
  let rows = base.filter(p => (!mat || p.material === mat) && (!s || [p.name, p.part_no, p.spec, p.equipment, p.location, p.note, p.material].join(' ').toLowerCase().includes(s)));
  if (st === 'low') rows = rows.filter(partLow);
  if (st === 'short') rows = rows.filter(partShort);
  if (st === 'zero') rows = rows.filter(p => p.stock === 0);
  const nat = (a, b) => String(a || '').localeCompare(String(b || ''), 'ko', { numeric: true });
  rows.sort((a, b) => (a.material ? 0 : 1) - (b.material ? 0 : 1) || nat(a.material, b.material) || nat(a.name, b.name) || nat(a.spec, b.spec));
  const lowCount = C.parts.filter(partLow).length;
  const w = can('parts', 'write');
  const usedCats = S.lists.equipment_categories.filter(c => C.parts.some(p => usageOf(p.id).some(u => eqCat(u.equipment_id) === c)));
  const mats = [...new Set(base.map(p => p.material).filter(Boolean))].sort(nat);
  const eqs = cat ? eqOfCat(cat) : C.equipment;
  const search = h('input', { class: 'input search', type: 'search', placeholder: 'Part No·부품명·규격·위치 검색', value: q.get('q') || '', onkeydown: e => { if (e.key === 'Enter') nav({}); } });
  const cnt = f => base.filter(f).length;
  clear(el, pageHead('부품관리', `${C.parts.length}종 · 재고 부족 ${lowCount}종`,
    w ? h('button', { class: 'btn', onclick: () => partMove(null, '입고') }, '입고') : null, w ? h('button', { class: 'btn', onclick: () => partMove(null, '사용') }, '사용') : null,
    w && C.usageReady ? h('button', { class: 'btn', onclick: () => partsImport() }, '엑셀로 일괄 등록') : null,
    w ? addBtn('부품 등록', () => partForm()) : null),
    !C.usageReady && isAdmin() ? h('div', { class: 'notice-strip', style: { cursor: 'default' } }, h('b', '설비별 수량 기능 준비 필요'), h('div', 'Supabase SQL Editor에서 migrate_13_part_usage.sql 을 한 번 실행하면 부품마다 사용 설비와 수량을 넣을 수 있습니다.')) : null,
    usedCats.length ? h('div', { class: 'toolbar' }, chipsFilter([['', '전체'], ...usedCats.map(c => [c, c])], cat, v => nav({ cat: v, eq: '', mat: '' }))) : null,
    h('div', { class: 'toolbar' }, search, h('button', { class: 'btn', onclick: () => nav({}) }, '검색'),
      C.usageReady ? h('select', { class: 'input', 'aria-label': '설비', onchange: e => nav({ eq: e.target.value }) }, h('option', { value: '' }, '전체 설비'), eqs.map(e => h('option', { value: e.id, selected: e.id === eq }, eqLabel(e)))) : null,
      mats.length ? h('select', { class: 'input', 'aria-label': '설비 안 위치', onchange: e => nav({ mat: e.target.value }) }, h('option', { value: '' }, '전체 위치'), mats.map(m => h('option', { value: m, selected: m === mat }, m))) : null),
    h('div', { class: 'toolbar' }, chipsFilter([['', `전체 ${base.length}`], ['low', `적정재고 미만 ${cnt(partLow)}`], ...(C.usageReady ? [['short', `1회 교체분 부족 ${cnt(partShort)}`], ['zero', `재고 없음 ${cnt(p => p.stock === 0)}`]] : [])], st, v => nav({ st: v }))),
    card(`부품 목록 (${rows.length})`, table(rows, [
      { label: '부품', v: p => h('div', h('div', h('b', p.name), ' ', stageLabel(p) ? badge(stageLabel(p), 'info') : null, ' ', sampleBadge(p)), h('div', { class: 'muted small' }, p.part_no)), lead: true },
      { label: '규격', v: p => p.spec },
      { label: '위치', v: p => p.material || p.location },
      { label: '사용 설비 (1대당)', v: p => usageMini(p) },
      { label: '1회 교체분', v: p => (needOf(p) || ''), cls: 'num' },
      { label: '현재고', v: p => h('b', { style: { color: partLow(p) || p.stock === 0 ? 'var(--bad)' : '' } }, p.stock), cls: 'num' },
      { label: '여유', v: p => spareBadge(p) || (partLow(p) ? badge(`적정 ${p.min_stock - p.stock}개 부족`, 'bad') : badge('충분', 'ok')) },
      { label: '입고 예정', v: p => (p.due_date ? fmtDate(p.due_date) : '') },
    ], { onRow: partDetail, empty: s || cat || eq || st ? '조건에 맞는 부품이 없습니다.' : '등록된 부품이 없습니다.', emptyAction: w && !s ? h('button', { class: 'btn', onclick: () => partForm() }, '부품 등록') : null })),
    C.usage.length ? h('div', { class: 'unit-note' }, '1회 교체분 = 사용 설비를 한 번씩 모두 교체할 때 필요한 수량 · 여유 = 현재고 − 1회 교체분') : null);
};

// 설비 상세: 이 설비에 들어가는 부품 (설비 안 위치별)
function eqParts(e) {
  const list = C.parts.map(p => ({ p, u: usageOf(p.id).find(u => u.equipment_id === e.id) })).filter(x => x.u);
  if (!list.length) return h('div', { class: 'muted small', style: { marginTop: '6px' } }, '이 설비에 연결된 부품이 없습니다. 부품관리에서 부품마다 사용 설비를 넣으면 여기에 모입니다.');
  const nat = (a, b) => String(a || '').localeCompare(String(b || ''), 'ko', { numeric: true });
  const groups = {};
  for (const x of list.sort((a, b) => nat(a.p.name, b.p.name))) (groups[x.p.material || '위치 미지정'] ||= []).push(x);
  const zero = list.filter(x => x.p.stock === 0).length, short = list.filter(x => x.p.stock > 0 && x.p.stock < x.u.qty).length;
  return h('div',
    h('div', { class: 'muted small', style: { margin: '2px 0 8px' } }, `${list.length}종 · 재고 없음 ${zero}종 · 1대분보다 적음 ${short}종`),
    Object.keys(groups).sort((a, b) => (a === '위치 미지정') - (b === '위치 미지정') || (a < b ? -1 : a > b ? 1 : 0)).map(g => h('div', { style: { marginBottom: '12px' } },
      h('div', { style: { fontWeight: 600, margin: '4px 0' } }, g, ' ', h('span', { class: 'muted small' }, `${groups[g].length}종`)),
      table(groups[g], [
        { label: '부품', v: ({ p }) => h('div', h('b', p.name), ' ', stageLabel(p) ? badge(stageLabel(p), 'info') : null, h('div', { class: 'muted small' }, p.part_no)), lead: true },
        { label: '규격', v: ({ p }) => p.spec },
        { label: '1대당', v: ({ u }) => u.qty, cls: 'num' },
        { label: '현재고', v: ({ p }) => h('b', p.stock), cls: 'num' },
        { label: '상태', v: ({ p, u }) => (p.stock === 0 ? badge('재고 없음', 'bad') : p.stock < u.qty ? badge('부족', 'warn') : badge('충분', 'ok')) },
      ], { onRow: ({ p }) => partDetail(p) }))));
}

// 엑셀로 부품 일괄 등록: Part No · 부품명 · 규격 · Material · 비고 · (설비별 수량 열) · 현재고 · 입고예정일
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let xlsxReady = null;
const loadXlsx = () => globalThis.XLSX ? Promise.resolve(globalThis.XLSX) : (xlsxReady ||= new Promise((res, rej) => {
  const sc = h('script', { src: XLSX_URL }); sc.onload = () => res(globalThis.XLSX); sc.onerror = () => { xlsxReady = null; rej(new Error('엑셀 읽기 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); }; document.head.append(sc);
}));
function partsImport() {
  const fileIn = h('input', { type: 'file', accept: '.xlsx,.xls', class: 'hidden' });
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files[0]; fileIn.remove(); if (!file) return;
    try {
      const X = await loadXlsx();
      const wb = X.read(await file.arrayBuffer(), { type: 'array' });
      const sheets = wb.SheetNames.map(n => ({ name: n, rows: X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) }));
      importPreview(sheets);
    } catch (e) { console.error(e); toast('엑셀을 읽지 못했습니다: ' + e.message, 'err'); }
  });
  document.body.append(fileIn); fileIn.click();
}
// 표 머리행·열 찾기 + 설비 열을 실제 설비에 연결
function parsePartsSheet(rows, equipment, cat) {
  const norm = v => String(v ?? '').replace(/\s+/g, '').toLowerCase();
  const hi = rows.findIndex(r => (r || []).some(v => /^(partno|품번)$/.test(norm(v))));
  if (hi < 0) throw new Error('"Part No" 머리행을 찾지 못했습니다.');
  const head = rows[hi].map(norm);
  const col = (...ks) => head.findIndex(v => ks.includes(v));
  const C_NO = col('partno', '품번'), C_NAME = col('부품명', 'partname', 'name'), C_SPEC = col('규격', 'spec'), C_MAT = col('material', '위치'),
    C_NOTE = head.indexOf('비고'), C_STOCK = col('현재고', '재고'), C_DUE = col('입고예정일');
  const eqs = equipment.filter(e => !cat || e.category === cat);
  const eqCols = [];
  head.forEach((v, i) => {
    const m = String(rows[hi][i] ?? '').match(/(\d+)\s*호기\s*(\d+)\s*차/);
    if (m) { const e = eqs.find(x => { const k = String(x.name).match(UNIT_RE); return k && +k[1] === +m[1] && +k[2] === +m[2]; }); eqCols.push({ i, label: String(rows[hi][i]).trim(), e: e || null }); return; }
    if (i === C_NO || i === C_NAME || i === C_SPEC || i === C_MAT || i === C_NOTE || i === C_STOCK || i === C_DUE || !v) return;
    const e = eqs.find(x => norm(x.name) === v || norm(eqLabel(x)) === v);
    if (e) eqCols.push({ i, label: String(rows[hi][i]).trim(), e });
  });
  const txt = v => (v == null ? '' : String(v).replace(/\s*\n\s*/g, ' · ').trim());
  const toDate = v => { if (v == null || v === '') return null; if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); } const m = String(v).match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null; };
  const items = [];
  for (const r of rows.slice(hi + 1)) {
    const no = txt(r?.[C_NO]); if (!no || !txt(r[C_NAME])) continue;
    const memo = C_NOTE >= 0 ? txt(r[C_NOTE]) : '';
    const sm = memo.match(/^([12])차\s*(?:\((.*)\))?\s*(.*)$/);
    const usage = eqCols.filter(c => c.e && Number(r[c.i]) > 0).map(c => ({ equipment_id: c.e.id, qty: Math.round(Number(r[c.i])) }));
    const stock = C_STOCK >= 0 && r[C_STOCK] != null && r[C_STOCK] !== '' && !isNaN(Number(r[C_STOCK])) ? Math.max(0, Math.round(Number(r[C_STOCK]))) : null;
    items.push({ part_no: no, name: txt(r[C_NAME]), spec: C_SPEC >= 0 ? txt(r[C_SPEC]) || null : null, material: C_MAT >= 0 ? txt(r[C_MAT]) || null : null,
      stage: sm ? `${sm[1]}차` : null, note: (sm ? [sm[2], sm[3]].filter(Boolean).join(' ') : memo) || null, usage, stock, due_date: C_DUE >= 0 ? toDate(r[C_DUE]) : null });
  }
  return { items, eqCols };
}
function importPreview(sheets) {
  const usable = sheets.filter(s => s.rows.some(r => (r || []).some(v => /^(part\s*no|품번)$/i.test(String(v ?? '').trim()))));
  if (!usable.length) { toast('엑셀에서 "Part No" 머리행이 있는 시트를 찾지 못했습니다.', 'err'); return; }
  let sheet = usable.find(s => /최종/.test(s.name)) || usable[usable.length - 1];
  const cats = S.lists.equipment_categories.filter(c => eqOfCat(c).length);
  const guessCat = s => { let best = cats[0], n = -1; for (const c of cats) { try { const k = parsePartsSheet(s.rows, C.equipment, c).eqCols.filter(x => x.e).length; if (k > n) { n = k; best = c; } } catch { /* */ } } return best; };
  let cat = guessCat(sheet), withStock = true;
  const body = h('div');
  const draw = () => {
    let r; try { r = parsePartsSheet(sheet.rows, C.equipment, cat); } catch (e) { clear(body, h('div', { class: 'form-error' }, e.message)); return; }
    const byNo = new Map(C.parts.map(p => [p.part_no, p]));
    const nNew = r.items.filter(x => !byNo.has(x.part_no)).length;
    const stockChg = r.items.filter(x => x.stock != null && (byNo.get(x.part_no)?.stock ?? 0) !== x.stock).length;
    const miss = r.eqCols.filter(c => !c.e);
    clear(body,
      h('div', { class: 'grid g2', style: { gap: '10px' } },
        h('div', { class: 'field' }, h('label', '시트'), h('select', { class: 'input', onchange: e => { sheet = usable[e.target.value]; cat = guessCat(sheet); draw(); } }, usable.map((s, i) => h('option', { value: i, selected: s === sheet }, s.name)))),
        h('div', { class: 'field' }, h('label', '설비 분류'), h('select', { class: 'input', onchange: e => { cat = e.target.value; draw(); } }, cats.map(c => h('option', { value: c, selected: c === cat }, c))))),
      h('div', { class: 'usage-sum', style: { margin: '10px 0' } }, h('b', { style: { color: 'var(--ink)' } }, `${r.items.length}종`),
        h('span', `새로 등록 ${nNew}종`), h('span', `기존 부품 갱신 ${r.items.length - nNew}종`), h('span', `설비 열 ${r.eqCols.filter(c => c.e).length}개 연결`)),
      h('div', { class: 'muted small' }, '설비 열 연결: ', r.eqCols.map(c => h('span', { class: 'uchip', style: { color: c.e ? '' : 'var(--bad)' } }, `${c.label} → ${c.e ? eqLabel(c.e) : '설비 없음'}`))),
      miss.length ? h('div', { class: 'form-error' }, `설비 목록에 없는 열 ${miss.length}개는 빠집니다. 설비 목록에 먼저 추가하거나 분류를 바꿔 보세요.`) : null,
      h('label', { class: 'login-opts', style: { margin: '10px 0' } }, h('input', { type: 'checkbox', checked: withStock, onchange: e => { withStock = e.target.checked; } }),
        ` 현재고도 엑셀 값으로 맞추기 (${stockChg}종 변경 · 입고/정정 기록으로 남음)`),
      table(r.items.slice(0, 30), [
        { label: 'Part No', v: x => h('span', h('b', x.part_no), byNo.has(x.part_no) ? '' : [' ', badge('새 부품', 'info')]), lead: true },
        { label: '부품명', v: x => x.name }, { label: '규격', v: x => x.spec }, { label: '위치', v: x => x.material },
        { label: '구분', v: x => x.stage ? stageLabel(x) : '' },
        { label: '사용 설비 (1대당)', v: x => x.usage.map(u => { const e = C.equipment.find(q => q.id === u.equipment_id); const k = e && String(e.name).match(UNIT_RE); return `${k ? `${k[1]}-${k[2]}` : eqName(u.equipment_id)}:${u.qty}`; }).join(' ') },
        { label: '현재고', v: x => x.stock, cls: 'num' }, { label: '비고', v: x => x.note },
      ], { cards: false }),
      r.items.length > 30 ? h('div', { class: 'muted small' }, `… 외 ${r.items.length - 30}종`) : null);
    body._r = r;
  };
  draw();
  const go1 = h('button', { class: 'btn primary', onclick: async () => {
    const r = body._r; if (!r) return;
    go1.disabled = true; const t0 = go1.textContent;
    try { const n = await runPartsImport(r.items, withStock, cat, (i, nAll) => { go1.textContent = `등록 중… ${i}/${nAll}`; }); pnl.close(); toast(`${n}종 등록·갱신했습니다.`, 'ok'); await loadCommon(); rerender(); }
    catch (e) { console.error(e); toast(e.message, 'err'); await loadCommon(); }
    finally { go1.disabled = false; go1.textContent = t0; }
  } }, '등록');
  const pnl = panel({ title: '엑셀로 부품 일괄 등록', body, foot: [h('button', { class: 'btn', onclick: () => pnl.close() }, '취소'), go1] });
}
async function runPartsImport(items, withStock, cat, onStep) {
  let n = 0;
  for (const x of items) {
    onStep?.(++n, items.length);
    const ex = C.parts.find(p => p.part_no === x.part_no);
    const info = { name: x.name, spec: x.spec, material: x.material, stage: x.stage, note: x.note, ...(x.due_date ? { due_date: x.due_date } : {}) };
    let part;
    if (ex) {
      const patch = {}; for (const [k, v] of Object.entries(info)) if ((v ?? null) !== (ex[k] ?? null)) patch[k] = v;
      part = Object.keys(patch).length ? await api.update('parts', ex.id, patch) : ex;
    } else part = await api.insert('parts', { ...info, part_no: x.part_no, min_stock: 0, client_id: `xlsx-${x.part_no}` });
    const next = new Map(x.usage.map(u => [u.equipment_id, u.qty]));
    // 고른 분류의 설비 수량만 엑셀대로 바꾸고, 다른 분류 설비에 넣어 둔 수량은 그대로
    const prev = usageOf(part.id).filter(u => C.equipment.find(e => e.id === u.equipment_id)?.category === cat);
    await saveUsage(part.id, next, prev);
    if (withStock && x.stock != null) {
      const cur = ex ? ex.stock : 0, d = x.stock - cur;
      if (d) await api.rpc('part_move', { p_part: part.id, p_type: ex ? '정정' : '입고', p_qty: ex ? d : x.stock, p_reason: '엑셀 일괄 등록 (현재고 맞춤)', p_client: `xlsx-${x.part_no}-${x.stock}-${Date.now()}` });
    }
  }
  return n;
}

// ================================================================ 7. 자료실
function docForm(d) {
  openForm({ api, title: d ? '자료 수정' : '자료 등록', draftKey: d ? null : 'doc', values: d || { category: S.lists.doc_categories[0], revised_on: today() }, fields: [
    { k: 'category', label: '분류', type: 'chips', opts: S.lists.doc_categories, req: true },
    { k: 'title', label: '제목', req: true, full: true }, { k: 'revised_on', label: '개정일', type: 'date' }, { k: 'tags', label: '태그', ph: '쉼표로 구분 (예: 데칸타, 진동)' },
    { k: 'file_path', label: '첨부 파일', type: 'file', bucket: 'docs', nameKey: 'file_name', full: true, help: 'PDF, 이미지, 엑셀 등' },
    { k: 'body', label: '내용·요약', type: 'textarea', ph: '트러블슈팅은 증상 → 원인 → 조치 순으로 적으면 찾기 쉽습니다.' },
  ], onSave: saveRow('docs', d), after: rerender });
}
VIEWS.docs = async el => {
  const q = params(); const cat = q.get('cat') || ''; const s = (q.get('q') || '').toLowerCase();
  let rows = await api.list('docs', { order: 'revised_on' });
  const total = rows.length;
  if (cat) rows = rows.filter(d => d.category === cat);
  if (s) rows = rows.filter(d => [d.title, d.body, d.tags, d.file_name].join(' ').toLowerCase().includes(s));
  const w = can('docs', 'write');
  const search = h('input', { class: 'input search', type: 'search', placeholder: '제목·내용·태그 검색', value: q.get('q') || '', onkeydown: e => { if (e.key === 'Enter') go('docs', { cat, q: search.value }); } });
  clear(el, pageHead('자료실', `${total}건`, w ? addBtn('자료 등록', () => docForm()) : null),
    h('div', { class: 'toolbar' }, search, h('button', { class: 'btn', onclick: () => go('docs', { cat, q: search.value }) }, '검색')),
    h('div', { class: 'subtabs' }, [['', '전체'], ...S.lists.doc_categories.map(c => [c, c])].map(([v, l]) => h('a', { href: '#/docs?' + new URLSearchParams({ cat: v, q: q.get('q') || '' }), class: cat === v ? 'on' : '' }, l))),
    card('자료 목록', table(rows, [
      { label: '제목', v: d => h('span', h('b', d.title), ' ', sampleBadge(d)), lead: true }, { label: '분류', v: d => badge(d.category) },
      { label: '태그', v: d => d.tags }, { label: '개정일', v: d => fmtDate(d.revised_on) }, { label: '파일', v: d => (d.file_path ? '📎 ' + (d.file_name || '첨부') : '') },
    ], { onRow: d => {
      const open = d.file_path ? h('button', { class: 'btn', onclick: () => openFile('docs', d.file_path, d.file_name) }, '📎 ' + (d.file_name || '파일 열기')) : '없음';
      detail({ title: d.title, tableName: 'docs', row: d, rows: [['분류', d.category], ['개정일', d.revised_on ? fmtDateLong(d.revised_on) : ''], ['태그', d.tags], ['첨부', open], ['내용', d.body]], actions: rowActions('docs', 'docs', d, () => docForm(d)) });
    }, empty: s || cat ? '조건에 맞는 자료가 없습니다.' : '등록된 자료가 없습니다.' })));
};

// ================================================================ 8. 통계
VIEWS.stats = async el => {
  const q = params();
  const from = q.get('from') || addDays(today(), -89), to = q.get('to') || today();
  const by = q.get('by') || 'month';
  const [prod] = await Promise.all([
    can('production') ? api.list('production', { where: [['date', 'gte', from], ['date', 'lte', to]], order: 'date', asc: true }) : [],
  ]);
  const key = d => (by === 'month' ? d.slice(0, 7) : by === 'week' ? weekStart(d) : d);
  const label = k => (by === 'month' ? `${Number(k.slice(5, 7))}월` : fmtDate(k).replace(/ \(.\)/, ''));
  const groups = {};
  for (const r of prod) { const k = key(r.date); (groups[k] ||= []).push(r); }
  const keys = Object.keys(groups).sort();
  const beans = Object.keys(S.yield_rules);
  const colors = ['var(--brand-2)', 'var(--accent)', '#6b8fc2', '#b5654a'];
  const inputData = keys.map(k => ({ label: label(k), ...Object.fromEntries(beans.map(b => [b, groups[k].filter(r => r.bean_type === b).reduce((a, r) => a + (r.soy_input_kg || 0), 0)])) }));
  const yOk = r => r.soy_input_kg > 0 && r.soymilk_output_kg > 0 && !isDirectRow(r);
  const avgOf = rs => (rs.length ? rs.reduce((a, r) => a + r.soymilk_output_kg, 0) / rs.reduce((a, r) => a + r.soy_input_kg, 0) * 100 : null);
  // 설비(WT/데칸타)별 · 원료(수입콩/국산콩)별 두유수율 추이. 설비는 생산기록 값, 비어 있으면 BOM 설비
  const eqYield = (eq, b) => keys.map(k => { const v = avgOf(groups[k].filter(r => prodEq(r) === eq && r.bean_type === b && yOk(r))); return v != null ? { label: label(k), v } : null; }).filter(Boolean);
  const eqCard = eq => card(`두유수율 추이 · ${eq} 제품`, [beans.map((b, i) => {
    const pts = eqYield(eq, b), r = ruleOf(b, eq), avg = avgOf(prod.filter(x => prodEq(x) === eq && x.bean_type === b && yOk(x)));
    return h('div', { style: { marginBottom: '10px' } },
      h('div', { class: 'small', style: { fontWeight: 600, display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'baseline' } }, `${b}`,
        avg != null ? h('span', '기간 평균 ', h('b', pct(avg)), ' ', ysBadge(yieldStatus(b, avg, eq))) : h('span', { class: 'muted' }, '기록 없음'),
        h('span', { class: 'muted' }, `(양호 ${r.good}% 이상)`)),
      pts.length ? lineChart(pts, { unit: '%', fmt: v => n0(v) + '%', color: colors[i], height: 130, band: [r.good, Math.max(r.good * 1.3, ...pts.map(p => p.v))] }) : null);
  }), h('div', { class: 'unit-note' }, `${eq}로 생산한 제품만 · 두유수율(%) = 두유 Output 합 ÷ 대두 투입량 합 × 100 · 연녹색 = 양호 구간`)]);
  const noEq = prod.filter(r => yOk(r) && !['WT', '데칸타'].includes(prodEq(r))).length;
  const byProd = Object.values(prod.reduce((m, r) => { const key = r.product_code || r.product_name; const x = m[key] ||= { code: r.product_code, name: r.product_name, n: 0, b: 0, i: 0, o: 0 }; x.n++; x.b += r.batches || 0; x.i += r.soy_input_kg || 0; x.o += r.soy_input_kg > 0 ? r.soymilk_output_kg || 0 : 0; x.e = (x.e || 0) + (r.extract_yield > 0 ? 1 : 0); return m; }, {})).sort((a, b) => b.i - a.i);

  clear(el, pageHead('통계', `${fmtDate(from)} ~ ${fmtDate(to)}`, can('maintenance') ? h('button', { class: 'btn', onclick: () => go('eqstats') }, '정비·부품 통계 →') : null),
    rangeBar('stats', from, to, chipsFilter([['day', '일별'], ['week', '주별'], ['month', '월별']], by, v => go('stats', { from, to, by: v }))),
    h('div', { class: 'grid g2' },
      can('production') ? card('대두 투입량', [h('div', { class: 'legend' }, beans.map((b, i) => h('span', h('i', { style: { background: colors[i] } }), b))),
        barChart(inputData, { unit: ' kg', series: beans.map((b, i) => ({ key: b, name: b, color: colors[i] })) }), h('div', { class: 'unit-note' }, `단위: kg · 생산기록의 대두 투입량 합계 (${by === 'month' ? '월별' : by === 'week' ? '주별, 월요일 시작' : '일별'})`)]) : null,
      can('production') ? eqCard('WT') : null,
      can('production') ? card('품목별 생산', [table(byProd, [{ label: '제품', v: x => productName(x.code, x.name), lead: true }, { label: '기록', v: x => `${x.n}건`, cls: 'num' }, { label: '배치', v: x => n0(x.b), cls: 'num' }, { label: '대두 투입(kg)', v: x => n0(x.i), cls: 'num' }, { label: '두유수율', v: x => (x.i ? pct(x.o / x.i * 100) : ''), cls: 'num' }], { cards: false, empty: '기록이 없습니다.' })]) : null,
      can('production') ? eqCard('데칸타') : null),
    noEq ? h('div', { class: 'unit-note' }, `설비(WT/데칸타)가 정해지지 않은 기록 ${noEq}건은 설비별 수율 추이에서 빠졌습니다. 제품·BOM에 설비를 넣으면 반영됩니다.`) : null);
};

// ================================================================ 8-2. 정비·부품 통계 (설비 메뉴)
//  일별 = 한 달의 날짜별 / 주별 = 최근 12주 / 월별 = 한 해의 달별
//  정비는 완료일 기준, 부품 사용은 연결된 정비의 완료일(없으면 기록한 날) 기준
VIEWS.eqstats = async el => {
  const q = params();
  const by = q.get('by') || 'month';
  const anchor = q.get('d') || today();
  const [maint, ptx] = await Promise.all([api.list('maintenance'), can('parts') ? api.list('part_tx', { where: [['type', 'eq', '사용']] }) : []]);
  const pad = n => String(n).padStart(2, '0');
  const y = +anchor.slice(0, 4), mo = +anchor.slice(5, 7);
  let keys, title, prev, next, keyOf, colLabel, chartLabel;
  if (by === 'day') {
    const days = new Date(y, mo, 0).getDate();
    keys = Array.from({ length: days }, (_, i) => `${y}-${pad(mo)}-${pad(i + 1)}`);
    title = `${y}년 ${mo}월`; keyOf = d => d; colLabel = k => String(+k.slice(8)); chartLabel = colLabel;
    prev = `${mo === 1 ? y - 1 : y}-${pad(mo === 1 ? 12 : mo - 1)}-01`; next = `${mo === 12 ? y + 1 : y}-${pad(mo === 12 ? 1 : mo + 1)}-01`;
  } else if (by === 'week') {
    const last = weekStart(anchor);
    keys = Array.from({ length: 12 }, (_, i) => addDays(last, (i - 11) * 7));
    title = `${fmtDate(keys[0]).replace(/ \(.\)/, '')} ~ ${fmtDate(addDays(last, 6)).replace(/ \(.\)/, '')} (12주)`;
    keyOf = d => weekStart(d); colLabel = k => fmtDate(k).replace(/ \(.\)/, '') + '~'; chartLabel = k => fmtDate(k).replace(/ \(.\)/, '');
    prev = addDays(last, -7 * 12); next = addDays(last, 7 * 12);
  } else {
    keys = Array.from({ length: 12 }, (_, i) => `${y}-${pad(i + 1)}`);
    title = `${y}년`; keyOf = d => d.slice(0, 7); colLabel = k => `${+k.slice(5)}월`; chartLabel = colLabel;
    prev = `${y - 1}-01-01`; next = `${y + 1}-01-01`;
  }
  const kset = new Set(keys);
  const mDay = m => (m.done_at ? localDay(m.done_at) : null);
  const mById = Object.fromEntries(maint.map(m => [m.id, m]));
  const done = maint.filter(m => m.status === '완료' && mDay(m) && kset.has(keyOf(mDay(m))));
  const tDay = t => (t.maintenance_id && mById[t.maintenance_id] && mDay(mById[t.maintenance_id])) || localDay(t.created_at);
  const used = ptx.filter(t => kset.has(keyOf(tDay(t))));
  const qtyOf = t => Math.abs(t.qty);
  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

  // 표: 행 × 기간 칸 (+합계). 숫자가 클수록 진하게, 긴급·사후정비가 섞인 칸은 빨간 글씨
  const matrix = (rows, cell, { unit = '', bad } = {}) => {
    const max = Math.max(1, ...rows.flatMap(r => keys.map(k => cell(r, k))));
    return h('div', { class: 'mx-wrap' }, h('table', { class: 'mx' + (keys.length > 14 ? ' dense' : '') },
      h('thead', h('tr', h('th', { class: 'mx-name' }, ''), keys.map(k => h('th', colLabel(k))), h('th', { class: 'mx-sum' }, '합계'))),
      h('tbody', rows.map(r => { const tot = sum(keys, k => cell(r, k)); return h('tr', { class: tot ? '' : 'mx-zero' },
        h('th', { class: 'mx-name' }, r.label, r.sub ? h('small', r.sub) : null),
        keys.map(k => { const v = cell(r, k); return h('td', { class: (v ? 'l' + Math.min(4, Math.ceil(v / max * 4)) : '') + (v && bad && bad(r, k) ? ' bd' : ''), title: v ? `${r.label} · ${colLabel(k)} ${v}${unit}` : '' }, v || ''); }),
        h('td', { class: 'mx-sum' }, tot ? `${tot}${unit}` : '–')); }))));
  };

  const cats = S.lists.equipment_categories || [];
  const eqCats = [...cats, ...new Set(C.equipment.filter(e => !cats.includes(e.category) && done.some(m => m.equipment_id === e.id)).map(e => e.category))];
  const eqCount = (e, k, f = () => true) => done.filter(m => m.equipment_id === e.id && keyOf(mDay(m)) === k && f(m)).length;
  const bdTotal = done.filter(m => isBreakdown(m.kind)).length;
  const topEq = C.equipment.map(e => [e, done.filter(m => m.equipment_id === e.id).length]).sort((a, b) => b[1] - a[1])[0];
  const partsUsed = C.parts.filter(p => used.some(t => t.part_id === p.id)).sort((a, b) => sum(used.filter(t => t.part_id === b.id), qtyOf) - sum(used.filter(t => t.part_id === a.id), qtyOf));
  const colors = ['var(--brand-2)', 'var(--accent)', '#6b8fc2', '#b5654a'];
  const topParts = partsUsed.slice(0, 4);

  const nav = h('div', { class: 'daynav' },
    h('button', { class: 'icon-btn', 'aria-label': '이전', onclick: () => go('eqstats', { by, d: prev }) }, icon('left')),
    h('div', { class: 'date-label' }, title),
    h('button', { class: 'icon-btn', 'aria-label': '다음', onclick: () => go('eqstats', { by, d: next }) }, icon('right')),
    anchor !== today() ? h('button', { class: 'btn sm', onclick: () => go('eqstats', { by }) }, '오늘') : null);
  const unitName = by === 'day' ? '일별' : by === 'week' ? '주별 (월요일 시작)' : '월별';
  clear(el, pageHead('정비·부품 통계', `${title} · ${unitName}`),
    h('div', { class: 'toolbar' }, nav, h('span', { class: 'spacer', style: { flex: 1 } }), chipsFilter([['day', '일별'], ['week', '주별'], ['month', '월별']], by, v => go('eqstats', { by: v, d: anchor }))),
    h('div', { class: 'grid g3', style: { marginBottom: '14px' } },
      stat('정비 횟수', n0(done.length), '회', `긴급·사후정비 ${bdTotal}회`),
      can('parts') ? stat('부품 사용', n0(sum(used, qtyOf)), '개', `${partsUsed.length}종`) : null,
      stat('가장 많이 정비한 설비', topEq && topEq[1] ? topEq[0].name : '—', topEq && topEq[1] ? ` ${topEq[1]}회` : '')),
    h('div', { class: 'grid g2' },
      card(`기간별 정비 횟수`, [h('div', { class: 'legend' }, h('span', h('i', { style: { background: 'var(--bad)' } }), '긴급·사후정비'), h('span', h('i', { style: { background: 'var(--brand-2)' } }), '그 외 정비')),
        barChart(keys.map(k => ({ label: chartLabel(k), 고장: done.filter(m => keyOf(mDay(m)) === k && isBreakdown(m.kind)).length, 계획: done.filter(m => keyOf(mDay(m)) === k && !isBreakdown(m.kind)).length })), { unit: '회', int: true, series: [{ key: '고장', name: '긴급·사후정비', color: 'var(--bad)' }, { key: '계획', name: '그 외 정비', color: 'var(--brand-2)' }] })]),
      can('parts') ? card('기간별 부품 사용량', topParts.length ? [h('div', { class: 'legend' }, topParts.map((p, i) => h('span', h('i', { style: { background: colors[i] } }), p.part_no || p.name))),
        barChart(keys.map(k => ({ label: chartLabel(k), ...Object.fromEntries(topParts.map(p => [p.id, sum(used.filter(t => t.part_id === p.id && keyOf(tDay(t)) === k), qtyOf)])) })), { unit: '개', int: true, series: topParts.map((p, i) => ({ key: p.id, name: p.part_no || p.name, color: colors[i] })) })]
        : h('div', { class: 'empty' }, '기간 내 부품 사용 기록이 없습니다.')) : null),
    h('h3', { class: 'sec-title' }, '설비별 정비 횟수'),
    h('div', { class: 'grid' }, eqCats.map(c => {
      const eqs = C.equipment.filter(e => e.category === c && (e.status !== '사용안함' || done.some(m => m.equipment_id === e.id)));
      if (!eqs.length) return null;
      const n = done.filter(m => eqs.some(e => e.id === m.equipment_id)).length;
      return card(`${c} · ${n}회`, matrix(eqs.map(e => ({ label: e.name, e })), (r, k) => eqCount(r.e, k), { unit: '', bad: (r, k) => eqCount(r.e, k, m => isBreakdown(m.kind)) > 0 }));
    })),
    h('div', { class: 'unit-note' }, '단위: 회 · 정비 완료일 기준 · 진한 칸일수록 많이 정비 · 빨간 숫자 = 긴급·사후정비 포함'),
    can('parts') ? [h('h3', { class: 'sec-title' }, '부품 사용량'),
      card(`부품별 사용 개수 · ${n0(sum(used, qtyOf))}개`, partsUsed.length ? matrix(partsUsed.map(p => ({ label: p.name, sub: p.part_no, p })), (r, k) => sum(used.filter(t => t.part_id === r.p.id && keyOf(tDay(t)) === k), qtyOf), { unit: '개' }) : h('div', { class: 'empty' }, '기간 내 부품 사용 기록이 없습니다.')),
      h('div', { class: 'unit-note' }, '단위: 개 · 정비에 연결된 부품은 그 정비의 완료일, 아니면 사용 기록한 날 기준')] : null);
};

// ================================================================ 9. 관리
VIEWS['admin-users'] = async el => {
  const users = await api.list('profiles', { order: 'created_at' });
  const team = users.filter(u => !u.linked_from), linked = users.filter(u => u.linked_from);
  const pending = team.filter(u => u.status === 'pending'), active = team.filter(u => u.status === 'active'), susp = team.filter(u => u.status === 'suspended');
  // 사용자 삭제: 로그인 계정까지 지움 (작성한 기록은 남고 작성자는 "삭제된 사용자"로 표시). 사용 중인 팀원은 먼저 정지해야 삭제 가능
  const delUser = async u => {
    if (!(await confirmDlg('사용자 삭제', `${u.name || u.email}님의 계정을 완전히 지울까요? 다시 쓰려면 새로 가입해야 합니다. 작성한 기록은 그대로 남고 작성자는 "삭제된 사용자"로 표시됩니다.`, '삭제', true))) return;
    try { await api.rpc('admin_delete_user', { p_uid: u.id }); toast('삭제했습니다.', 'ok'); await loadCommon(); badges.pending = (await api.list('profiles', { where: [['status', 'eq', 'pending']] })).length; rerender(); }
    catch (e) { toast(/admin_delete_user|function/.test(e.message) ? '삭제 기능이 아직 설치되지 않았습니다. Supabase에서 migrate_17_user_delete.sql 을 실행해 주세요.' : e.message, 'err'); }
  };
  const delBtn = u => h('button', { class: 'btn sm danger', onclick: e => { e.stopPropagation(); delUser(u); } }, '삭제');
  const setU = async (u, patch, msg) => { try { await api.update('profiles', u.id, patch); toast(msg, 'ok'); await loadCommon(); badges.pending = (await api.list('profiles', { where: [['status', 'eq', 'pending']] })).length; rerender(); } catch (e) { toast(e.message, 'err'); } };
  const approve = async u => {
    const role = await promptDlg(`${u.name || u.email} 승인`, '부여할 역할', { options: ['작업자', '게스트', '관리자'], value: '작업자' });
    if (!role) return;
    setU(u, { status: 'active', role: { 작업자: 'worker', 게스트: 'guest', 관리자: 'admin' }[role] }, '승인했습니다.');
  };
  const admins = active.filter(u => u.role === 'admin').length;
  // 관리자: 이름·부서·사번 수정 (이메일은 로그인 계정이라 바꿀 수 없음)
  const editUser = u => openForm({
    api, title: `${u.name || u.email} 정보 수정`, values: u,
    note: `이메일: ${u.email} (로그인 계정이라 바꿀 수 없습니다)`,
    fields: [{ k: 'name', label: '이름', req: true }, { k: 'dept', label: '부서', recent: true, suggest: () => [...new Set(users.map(x => x.dept).filter(Boolean))] }, { k: 'emp_no', label: '사번' }],
    onSave: async v => { await api.update('profiles', u.id, { name: v.name, dept: v.dept || null, emp_no: v.emp_no || null }); if (u.id === me.id) me = { ...me, ...v }; await loadCommon(); },
    after: rerender,
  });
  const editBtn = u => h('button', { class: 'btn sm', onclick: e => { e.stopPropagation(); editUser(u); } }, '수정');
  const userCols = extra => [
    { label: '이름', v: u => h('span', h('b', u.name || '(이름 없음)'), u.id === me.id ? ' (나)' : ''), lead: true },
    { label: '이메일', v: u => u.email }, { label: '부서', v: u => u.dept || h('span', { class: 'muted' }, '미입력') }, { label: '사번', v: u => u.emp_no || h('span', { class: 'muted' }, '미입력') },
    { label: '정보', v: u => editBtn(u) }, ...extra];
  // 마지막 접속: 날짜·시각 + 얼마 전인지
  const seenCell = u => {
    if (!u.last_seen_at) return h('span', { class: 'muted' }, '기록 없음');
    const m = Math.floor((Date.now() - new Date(u.last_seen_at)) / 60e3);
    const ago = m < 10 ? '접속 중' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.floor(m / 60)}시간 전` : `${Math.floor(m / 1440)}일 전`;
    return h('span', fmtDT(u.last_seen_at), ' ', h('span', { class: 'muted small' }, `(${ago})`));
  };
  const linkedCols = [
    { label: '이름', v: u => h('span', h('b', u.name || '(이름 없음)'), ' ', badge('연계', 'info')), lead: true },
    { label: '들어온 포털', v: u => u.linked_from },
    { label: '처음 접속', v: u => fmtDT(u.created_at) },
    { label: '마지막 접속', v: seenCell },
    { label: '상태', v: u => (u.status === 'active' ? badge('보기만 가능', 'ok') : badge('정지', 'bad')) },
    { label: '', v: u => h('div', { style: { display: 'flex', gap: '6px' } },
      u.status === 'active' ? h('button', { class: 'btn sm', onclick: e => { e.stopPropagation(); setU(u, { status: 'suspended' }, '연계 접속을 막았습니다.'); } }, '정지')
        : h('button', { class: 'btn sm', onclick: e => { e.stopPropagation(); setU(u, { status: 'active' }, '다시 들어올 수 있게 했습니다.'); } }, '정지 해제'),
      delBtn(u)) },
  ];
  clear(el, pageHead('사용자·승인', `팀원: 승인 대기 ${pending.length}명 · 사용 중 ${active.length}명${linked.length ? ` · 연계 게스트 ${linked.length}명` : ''}`),
    h('div', { class: 'form-note', style: { marginBottom: '14px' } }, '가입 신청한 사람이 실제 동료인지 이름·부서·사번으로 확인한 뒤 승인하세요. 퇴사·이동자는 먼저 "정지"하고, 계정을 완전히 지우려면 정지 목록에서 "삭제"하세요. 지워도 작성한 기록은 그대로 남습니다 (작성자는 "삭제된 사용자"로 표시).'),
    h('div', { class: 'grid' },
      card(`승인 대기 (${pending.length})`, table(pending, userCols([
        { label: '신청일', v: u => fmtDT(u.created_at) },
        { label: '', v: u => h('div', { style: { display: 'flex', gap: '6px' } }, h('button', { class: 'btn sm primary', onclick: e => { e.stopPropagation(); approve(u); } }, '승인'), h('button', { class: 'btn sm', onclick: e => { e.stopPropagation(); setU(u, { status: 'suspended' }, '거절(정지) 처리했습니다.'); } }, '거절'), delBtn(u)) },
      ]), { empty: '승인 대기 중인 사람이 없습니다.', onRow: editUser })),
      card(`팀원 · 사용 중 (${active.length})`, table(active, userCols([
        { label: '역할', v: u => h('select', { class: 'input', style: { minHeight: '34px', width: 'auto' }, disabled: u.id === me.id, onclick: e => e.stopPropagation(), onchange: e => setU(u, { role: e.target.value }, '역할을 변경했습니다.') }, Object.entries(ROLE).map(([k, l]) => h('option', { value: k, selected: u.role === k }, l))) },
        { label: '마지막 접속', v: seenCell },
        { label: '승인', v: u => (u.approved_at ? `${fmtDate(u.approved_at.slice(0, 10))} ${personName(u.approved_by)}` : '') },
        { label: '', v: u => (u.id === me.id || (u.role === 'admin' && admins <= 1) ? '' : h('button', { class: 'btn sm danger', onclick: async e => { e.stopPropagation(); if (await confirmDlg('사용 정지', `${u.name}님의 접속을 막을까요? 작성한 기록은 그대로 남습니다.`, '정지', true)) setU(u, { status: 'suspended' }, '정지했습니다.'); } }, '정지')) },
      ]), { onRow: editUser })),
      susp.length ? card(`팀원 · 정지 (${susp.length})`, table(susp, userCols([{ label: '', v: u => h('div', { style: { display: 'flex', gap: '6px' } }, h('button', { class: 'btn sm', onclick: e => { e.stopPropagation(); setU(u, { status: 'active' }, '다시 사용하도록 했습니다.'); } }, '정지 해제'), delBtn(u)) }]), { onRow: editUser })) : null,
      linked.length ? card(`연계 게스트 (${linked.length})`, [h('div', { class: 'muted small', style: { marginBottom: '8px' } }, '다른 팀 포털에서 연계로 들어온 사람입니다. 보기만 할 수 있고 작성·수정은 할 수 없습니다. 지우면 다음에 연계로 들어올 때 새로 만들어집니다 (막으려면 "정지").'),
        table(linked, linkedCols)]) : null));
};

VIEWS['admin-products'] = async el => {
  await loadCommon();
  const form = p => openForm({ api, title: p ? '제품 수정' : '제품 등록', values: p || { active: true }, fields: [
    { k: 'code', label: '제품코드', req: true, readonly: !!p, help: p ? '제품코드는 바꿀 수 없습니다.' : '' }, { k: 'name', label: '제품명', req: true, full: true },
    { k: 'bom_std', label: '표준수량(BOM)', type: 'number', min: 0, help: 'SCM 계획량 1단위당 대두 kg (지시수량 = 계획량 × 표준수량)' },
    { k: 'ts', label: '제품TS', type: 'number', min: 0, step: 'any', help: '입력하면 이 제품의 생산기록 제품TS 칸에 자동으로 들어갑니다.' },
    { k: 'material', label: '원료 분류', recent: true, suggest: () => ['국산콩(원물)', '대두(수입산)'] }, { k: 'equipment', label: '설비', type: 'chips', opts: ['WT', '데칸타'] },
    { k: 'homog_pressure', label: '균질압 (WT 압력)', ph: '예: 250/500' }, { k: 'roast_temp', label: '로스팅 온도', ph: '예: 238℃' },
    { k: 'roast_time', label: '로스팅 시간', ph: '비우면 기본값 (관리 → 기준값)' }, { k: 'germ', label: '씨눈', type: 'chips', opts: ['씨눈함유', '씨눈분리'], help: '비우면 기본값' },
    { k: 'cooker_temp', label: '빈쿠커 온도', ph: '비우면 기본값 예: 90℃ / ±5℃' },
    { k: 'active', label: '사용', type: 'check', checkLabel: '생산계획에서 선택 가능' },
  ], onSave: async (v, c) => { if (!p && C.products.some(x => x.code === v.code)) throw new Error('이미 등록된 제품코드입니다.'); return p ? api.update('products', p.id, v) : api.insert('products', { ...v, client_id: c.client_id }); }, after: async () => { await loadCommon(); rerender(); } });
  clear(el, pageHead('제품·BOM', `${C.products.length}개 (기존 시트의 DB_BOM)`, addBtn('제품 등록', () => form())),
    card('제품 목록', table(C.products, [
      { label: '제품코드', v: p => h('span', h('b', p.code), ' ', sampleBadge(p)), lead: true }, { label: '제품명', v: p => p.name },
      { label: '표준수량', v: p => (p.bom_std != null ? Number(p.bom_std).toFixed(4) : ''), cls: 'num' }, { label: '제품TS', v: p => fmtTs(p.ts), cls: 'num' }, { label: '원료', v: p => p.material },
      { label: '설비', v: p => p.equipment }, { label: '균질압', v: p => p.homog_pressure }, { label: '사용', v: p => (p.active === false ? badge('중지') : badge('사용', 'ok')) },
    ], { onRow: p => detail({ title: p.name, tableName: 'products', row: p, rows: [['제품코드', p.code], ['표준수량(BOM)', p.bom_std], ['제품TS', fmtTs(p.ts)], ['원료 분류', p.material], ['설비', p.equipment], ['균질압', p.homog_pressure], ['로스팅 온도', p.roast_temp]], actions: rowActions('master', 'products', p, () => form(p)) }) })));
};

// 설비 분류를 지울 때 그 분류에 남은 설비 처리: 다른 분류로 옮기기 또는 사용안함으로 숨기기
function removeCategoriesDialog(removed, affected, newCats) {
  openForm({
    api, title: '설비 분류 지우기', saveLabel: '적용하고 저장',
    note: `지우려는 분류(${removed.join(', ')})에 설비 ${affected.length}대가 있습니다: ${affected.map(e => e.name + (e.code ? `(${e.code})` : '')).join(', ')}. 정비 이력은 그대로 남습니다.`,
    values: { mode: 'hide' },
    fields: [
      { k: 'mode', label: '이 설비들을', type: 'chips', req: true, opts: [{ value: 'hide', label: '사용안함으로 숨기기' }, { value: 'move', label: '다른 분류로 옮기기' }] },
      { k: 'target', label: '옮길 분류', type: 'chips', opts: newCats, show: v => v.mode === 'move', check: (x, v) => (v.mode === 'move' && !x ? '옮길 분류를 골라 주세요.' : null) },
    ],
    onSave: async v => {
      for (const e of affected) await api.update('equipment', e.id, v.mode === 'move' ? { category: v.target } : { status: '사용안함' });
      const saved = await api.list('settings');
      const lists = { ...(saved.find(x => x.id === 'lists')?.value || S.lists), equipment_categories: newCats };
      await api.update('settings', 'lists', { value: lists });
      S.lists = { ...S.lists, equipment_categories: newCats };
      await loadCommon();
    },
    after: rerender,
  });
}

VIEWS['admin-settings'] = async el => {
  await loadSettings();
  const saveSetting = async (id, value) => {
    const exists = (await api.list('settings')).some(s => s.id === id);
    if (exists) await api.update('settings', id, { value });
    else await api.insert('settings', { id, value });
    S[id] = value; toast('저장했습니다.', 'ok');
  };
  // 목록 설정
  const LIST_LABELS = { maint_kinds: '정비 구분', team_members: '착즙팀 인원 (근무표 휴무·배합지원 확인용)', floor4_members: '4층 근무 인원 (근무표 휴무 확인용)', origins: '원산지', shifts: '근무조', stop_reasons: '작업 중단 사유', symptoms: '고장 증상', equipment_categories: '설비 분류', doc_categories: '자료 분류', silos: 'SILO 번호', sterilizers: '멸균기 번호' };
  const listEditors = Object.entries(LIST_LABELS).map(([k, l]) => {
    const ta = h('textarea', { class: 'input', rows: 4 }, (S.lists[k] || []).join('\n'));
    return h('div', { class: 'field' }, h('label', l), ta, h('div', { class: 'help' }, '한 줄에 하나씩'), h('button', { class: 'btn sm', style: { alignSelf: 'flex-start' }, onclick: async () => {
      let vals = ta.value.split('\n').map(x => x.trim()).filter(Boolean);
      if (['silos', 'sterilizers'].includes(k)) { vals = vals.map(Number); if (vals.some(isNaN)) return toast('숫자만 입력해 주세요.', 'err'); }
      if (!vals.length) return toast('하나 이상 입력해 주세요.', 'err');
      vals = [...new Set(vals)];
      if (k === 'equipment_categories') {
        await loadCommon();
        const removed = (S.lists.equipment_categories || []).filter(c => !vals.includes(c));
        const affected = C.equipment.filter(e => removed.includes(e.category) && e.status !== '사용안함');
        if (affected.length) return removeCategoriesDialog(removed, affected, vals);
      }
      try { await saveSetting('lists', { ...S.lists, [k]: vals }); } catch (e) { toast(e.message, 'err'); }
    } }, '저장'));
  });
  // 수율 기준
  const yr = structuredClone(S.yield_rules_eq);
  const yrBox = h('div', { class: 'grid', style: { gap: '14px' } }, YIELD_EQS.map(eq => h('div',
    h('div', { style: { fontWeight: 700, margin: '2px 0 6px' } }, `${eq} 제품`),
    h('div', { class: 'grid', style: { gap: '10px' } }, Object.entries(yr[eq]).map(([b, r]) => h('div', { class: 'grid g3', style: { gap: '8px', alignItems: 'end' } },
      ['good', 'caution', 'warning'].map(k => h('div', { class: 'field' }, h('label', `${eq} · ${b} · ${{ good: '양호', caution: '주의', warning: '경고' }[k]} 이상`), h('div', { class: 'with-unit' }, h('input', { class: 'input', type: 'number', value: r[k], inputmode: 'decimal', oninput: e => { r[k] = Number(e.target.value); } }), h('span', { class: 'unit' }, '%'))))))))));
  // 수율 계산 상수
  const yc = structuredClone(S.yield_calc || DEFAULT_SETTINGS.yield_calc);
  const ycIn = (k, l, unit, help) => h('div', { class: 'field' }, h('label', l), h('div', { class: 'with-unit' }, h('input', { class: 'input', type: 'number', step: 'any', value: yc[k] ?? '', oninput: e => { yc[k] = Number(e.target.value); } }), h('span', { class: 'unit' }, unit)), help ? h('div', { class: 'help' }, help) : null);
  // 주간생산계획표 설정
  const pl = structuredClone(PS());
  const planIn = (k, l, ph, help) => h('div', { class: 'field' }, h('label', l), h('input', { class: 'input', value: pl[k] || '', placeholder: ph, oninput: e => { pl[k] = e.target.value.trim(); } }), help ? h('div', { class: 'help' }, help) : null);
  const planTa = (k, l, help) => h('div', { class: 'field' }, h('label', l), h('textarea', { class: 'input', rows: 4, oninput: e => { pl[k + 'Text'] = e.target.value; } }, (pl[k] || []).join('\n')), help ? h('div', { class: 'help' }, help) : null);
  // 운영 규칙
  const rules = structuredClone(S.rules);
  const ruleIn = (k, l, unit, help) => h('div', { class: 'field' }, h('label', l), h('div', { class: 'with-unit' }, h('input', { class: 'input', type: 'number', value: rules[k] ?? '', oninput: e => { rules[k] = Number(e.target.value); } }), h('span', { class: 'unit' }, unit)), help ? h('div', { class: 'help' }, help) : null);
  // 권한표
  const perm = structuredClone(S.permissions);
  const permTable = h('div', { class: 'tbl-wrap' }, h('table', { class: 'perm' },
    h('thead', h('tr', h('th', '메뉴'), h('th', '작업자 보기'), h('th', '작업자 쓰기'), h('th', '게스트 보기'), h('th', '게스트 쓰기'))),
    h('tbody', MODULES.map(([k, l]) => h('tr', h('td', l), ['worker', 'guest'].flatMap(r => ['read', 'write'].map(a => h('td', h('input', { type: 'checkbox', checked: !!perm[r]?.[k]?.[a], style: { width: '20px', height: '20px', accentColor: 'var(--brand)' },
      onchange: e => { ((perm[r] ||= {})[k] ||= {})[a] = e.target.checked; if (a === 'write' && e.target.checked) perm[r][k].read = true; } })))))))));
  const saveBtn = (fn) => h('button', { class: 'btn primary', onclick: async () => { try { await fn(); } catch (e) { toast(e.message, 'err'); } } }, '저장');

  clear(el, pageHead('기준값·권한', '관리자만 바꿀 수 있습니다. 바꾼 값은 바로 모든 사용자에게 적용됩니다.'),
    h('div', { class: 'grid' },
      card('수율 상태 기준 (두유수율 %)', [h('div', { class: 'muted small', style: { marginBottom: '10px' } }, '기존 시트 수식과 같은 방식입니다: 양호 기준 이상 → 양호, 주의 기준 이상 → 주의, 경고 기준 이상 → 경고, 그 미만 → 불량. 데칸타 제품과 WT 제품은 각각의 기준으로 판정합니다. (설비가 정해지지 않은 기록은 WT 기준)'), yrBox],
        saveBtn(async () => { for (const eq of YIELD_EQS) for (const r of Object.values(yr[eq])) if (!(r.good >= r.caution && r.caution >= r.warning)) throw new Error(`${eq}: 양호 ≥ 주의 ≥ 경고 순서가 되어야 합니다.`); await saveSetting('yield_rules_eq', yr); })),
      card('수율 계산 상수', h('div', { class: 'form-grid' },
        ycIn('import_dehull_pct', '수입콩 탈피수율 (고정)', '%', '시트 기준 89%'),
        ycIn('no_dehull_pct', '국산콩 4층 미가동 탈피수율', '%', '1·2차 연류계가 0, 0일 때 (시트 기준 88.88%)'),
        ycIn('liquid_pct', '두유액 비율', '%', '두유액 = 두유 Output × 이 비율 (시트 기준 7%)'),
        ycIn('output_per_capa', '두유 Output 자동 계산 계수', '', 'Output 미입력 시 = 배치수 × CAPA × 이 값 (시트 기준 0.686)')),
        saveBtn(async () => { if (!(yc.import_dehull_pct > 0 && yc.liquid_pct > 0 && yc.output_per_capa > 0)) throw new Error('0보다 큰 값을 넣어 주세요.'); await saveSetting('yield_calc', yc); })),
      card('주간생산계획표', h('div', { class: 'form-grid' },
        planTa('nums', '생산호기 번호 (한 줄에 하나)', '예: #1, #2, #3, #4'), planTa('machines', '생산호기 설비 (한 줄에 하나)', '"데칸타"가 들어가면 보라색, 아니면 파란색(WT)'), planTa('hopper', '호퍼 선택지 (빨간색)'),
        planIn('roast_time', '기본 로스팅 시간', '15분'), planIn('germ', '기본 씨눈', '씨눈함유'), planIn('cooker_temp', '기본 빈쿠커 온도', '90℃ / ±5℃'),
        planIn('normal_material', '일반 대두 분류 이름', '대두(수입산)', '이 분류가 아닌 콩(국산콩·약콩·서리태 등)만 콩 종류·조건을 표시')),
        saveBtn(async () => { for (const k of ['nums', 'machines', 'hopper']) { pl[k] = String(pl[k + 'Text'] ?? pl[k].join('\n')).split('\n').map(x => x.trim()).filter(Boolean); delete pl[k + 'Text']; } delete pl.lines; await saveSetting('plan', pl); })),
      card('운영 규칙', h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', '4층 기본 근무시간'), h('input', { class: 'input', value: rules.floor4_hours || '07:30~16:00', placeholder: '07:30~16:00', oninput: e => { rules.floor4_hours = e.target.value.trim(); } }), h('div', { class: 'help' }, '근무표에 시간이 없거나 이름 옆에 시간이 따로 없을 때 쓰는 시간')),
        ruleIn('worker_edit_hours', '작업자 정정 가능 시간', '시간', '생산·SILO 기록은 작성 후 이 시간 안에 본인만 정정 가능 (관리자는 언제나)'),
        ruleIn('silo_capacity_kg', 'SILO 1기 용량', 'kg', '재고 막대 표시에 사용'),
        ruleIn('repeat_days', '반복 고장 판단 기간', '일'), ruleIn('repeat_count', '반복 고장 판단 횟수', '회', '같은 설비·같은 증상이 기간 안에 이 횟수 이상이면 반복 고장 표시')),
        saveBtn(() => saveSetting('rules', rules))),
      card('선택 항목 목록', h('div', { class: 'grid g3' }, listEditors)),
      card('역할별 권한', [h('div', { class: 'muted small', style: { marginBottom: '8px' } }, '관리자는 모든 메뉴를 보고 쓸 수 있습니다. 쓰기를 켜면 보기도 함께 켜집니다.'), permTable], saveBtn(() => saveSetting('permissions', perm)))));
};

VIEWS.more = async el => {
  const items = SECTIONS.more.filter(allowed);
  clear(el, pageHead('더보기'), card('메뉴', h('div', { class: 'list' }, items.map(k => h('a', { href: '#/' + k, class: 'li click', style: { textDecoration: 'none', color: 'inherit' } },
    h('div', { class: 'grow' }, h('div', { class: 't' }, TITLES[k])), k === 'admin-users' && badges.pending ? badge(`대기 ${badges.pending}`, 'bad') : null, icon('right'))),
  h('a', { href: '#', class: 'li click', style: { textDecoration: 'none', color: 'var(--bad)' }, onclick: e => { e.preventDefault(); logout(); } }, h('div', { class: 'grow t' }, '로그아웃')))));
};
TITLES.more = '더보기';

VIEWS.me = async el => {
  clear(el, pageHead('내 정보'), h('div', { class: 'grid g2' },
    card('프로필', [
      h('dl', { class: 'kv' }, h('dt', '이메일'), h('dd', me.email), h('dt', '역할'), h('dd', ROLE[me.role]), h('dt', '가입일'), h('dd', fmtFull(me.created_at))),
      h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn', onclick: () => openForm({ api, title: '프로필 수정', values: me, fields: [{ k: 'name', label: '이름', req: true }, { k: 'dept', label: '부서' }, { k: 'emp_no', label: '사번' }],
        onSave: async v => { me = await api.update('profiles', me.id, v); await loadCommon(); }, after: rerender }) }, '프로필 수정'))]),
    card('비밀번호 변경', h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
      h('input', { class: 'input', type: 'password', id: 'pw1', placeholder: '새 비밀번호 (6자 이상)', autocomplete: 'new-password' }),
      h('input', { class: 'input', type: 'password', id: 'pw2', placeholder: '새 비밀번호 확인', autocomplete: 'new-password' }),
      h('button', { class: 'btn primary', onclick: async () => {
        const a = document.getElementById('pw1').value, b = document.getElementById('pw2').value;
        if (a.length < 6) return toast('6자 이상 입력해 주세요.', 'err'); if (a !== b) return toast('두 비밀번호가 다릅니다.', 'err');
        try { await api.updatePassword(a); toast('비밀번호를 바꿨습니다.', 'ok'); } catch (e) { toast(e.message, 'err'); }
      } }, '변경')))));
};

// ================================================================ 로그인·가입
// 로그인 화면: 아이디 저장 · 자동 로그인 (이 브라우저에만 저장)
//  자동 로그인을 끄면, 브라우저를 완전히 닫았다 열 때 로그아웃 (세션 쿠키로 판단, 탭끼리는 공유)
const PREF = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* */ } } };
const markAlive = () => { document.cookie = 'jp_alive=1; path=/; SameSite=Lax'; };
const loginPrefs = box => {
  const save = box.querySelector('#rem_id')?.checked, auto = box.querySelector('#auto_login')?.checked, em = box.querySelector('#em')?.value.trim();
  PREF.set('jp_saved_email', save && em ? em : null); PREF.set('jp_save_id', save ? '1' : '0');
  PREF.set('jp_auto_login', auto ? '1' : '0'); markAlive();
};
function authScreen(mode = 'login', msg) {
  const card = h('div', { class: 'auth-card' });
  const err = h('div', { class: 'form-error' + (msg ? '' : ' hidden') }, msg || '');
  // 이메일 인증이 안 된 계정: 인증 메일 다시 보내기 (예전 메일의 링크는 시간이 지나면 만료됨)
  const resendBox = h('div', { class: 'resend-box hidden' },
    h('div', { class: 'small' }, '인증 메일의 링크가 만료됐거나 메일을 못 찾으면 새로 받으세요. 가장 최근에 받은 메일의 링크만 작동합니다.'),
    h('button', { class: 'btn', type: 'button', onclick: async e => {
      const b = e.currentTarget, em = card.querySelector('#em')?.value.trim();
      if (!em) { showErr('이메일을 입력해 주세요.'); return; }
      b.disabled = true; const t = b.textContent; b.textContent = '보내는 중…';
      try { await api.resendSignup(em); err.className = 'form-note'; err.textContent = `${em} 로 인증 메일을 다시 보냈습니다. 메일함(스팸함 포함)에서 새 메일의 링크를 누른 뒤 로그인하세요.`; }
      catch (x) { showErr(x.message); }
      finally { b.disabled = false; b.textContent = t; }
    } }, '인증 메일 다시 보내기'));
  const showErr = (m, code) => { err.className = 'form-error'; err.textContent = m; err.classList.remove('hidden'); if (code === 'unconfirmed') resendBox.classList.remove('hidden'); };
  const inp = (id, type, ph, ac) => h('input', { class: 'input', id, type, placeholder: ph, autocomplete: ac });
  const btn = (label, fn) => {
    const b = h('button', { class: 'btn primary lg', onclick: async () => { err.classList.add('hidden'); b.disabled = true; const t = b.textContent; b.textContent = '처리 중…'; try { await fn(); } catch (e) { showErr(e.message, e.code); } finally { b.disabled = false; b.textContent = t; } } }, label);
    return b;
  };
  const val = id => card.querySelector('#' + id)?.value.trim() || '';
  const googleBtn = () => (CONFIG.GOOGLE_LOGIN === false ? null : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    h('button', { class: 'btn lg', type: 'button', onclick: async () => { err.classList.add('hidden'); try { if (mode === 'login') loginPrefs(card); else markAlive(); await api.signInWithGoogle(); } catch (e) { err.className = 'form-error'; showErr(e.message); } } },
      h('span', { html: '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>', style: { display: 'inline-flex' } }),
      'Google 계정으로 계속하기'),
    h('div', { class: 'small muted', style: { textAlign: 'center' } }, CONFIG.GOOGLE_DOMAIN ? `${CONFIG.GOOGLE_DOMAIN} 계정만 이용할 수 있습니다. ` : '', '처음이면 자동으로 가입 신청되고, 관리자 승인 후 이용할 수 있습니다.'),
    h('div', { class: 'small muted', style: { display: 'flex', alignItems: 'center', gap: '10px' } }, h('span', { style: { flex: 1, height: '1px', background: 'var(--line)' } }), '또는 이메일로', h('span', { style: { flex: 1, height: '1px', background: 'var(--line)' } }))));
  const head = h('div', brandMark({ marginBottom: '12px' }), h('h1', `${CONFIG.TEAM_NAME} 업무 포털`));
  if (mode === 'login') {
    clear(card, head, h('p', { class: 'lead' }, '승인된 팀원만 이용할 수 있습니다.'), err, resendBox, googleBtn(),
      h('div', { class: 'field' }, h('label', { for: 'em' }, '이메일'), inp('em', 'email', 'name@company.com', 'username')),
      h('div', { class: 'field' }, h('label', { for: 'pw' }, '비밀번호'), inp('pw', 'password', '비밀번호', 'current-password')),
      h('div', { class: 'login-opts' },
        h('label', h('input', { type: 'checkbox', id: 'rem_id', checked: PREF.get('jp_save_id') === '1' }), '아이디 저장'),
        h('label', h('input', { type: 'checkbox', id: 'auto_login', checked: PREF.get('jp_auto_login') === '1' }), '자동 로그인')),
      h('div', { class: 'small muted', style: { marginTop: '-4px' } }, '여러 사람이 함께 쓰는 PC에서는 자동 로그인을 켜지 마세요.'),
      btn('로그인', async () => { if (!val('em') || !val('pw')) throw new Error('이메일과 비밀번호를 입력해 주세요.'); loginPrefs(card); await api.signIn(val('em'), card.querySelector('#pw').value); }),
      h('div', { class: 'auth-links' }, h('a', { onclick: () => authScreen('signup') }, '회원가입 신청'), h('a', { onclick: () => authScreen('reset') }, '비밀번호를 잊었어요')),
      h('div', { class: 'auth-links', style: { justifyContent: 'center' } }, h('a', { onclick: () => { resendBox.classList.remove('hidden'); card.querySelector('#em')?.focus(); } }, '인증 메일을 다시 받고 싶어요')),
      api.mode === 'demo' ? h('div', { class: 'demo-accounts' }, h('b', '데모 모드'), ' — 예시 계정으로 바로 들어가 볼 수 있습니다.', h('br'),
        [['관리자', 'admin@demo.kr'], ['작업자', 'worker@demo.kr'], ['승인 대기자', 'new@demo.kr']].map(([l, e]) => h('button', { class: 'btn sm', onclick: () => { card.querySelector('#em').value = e; card.querySelector('#pw').value = 'demo1234'; } }, l))) : null);
    card.addEventListener('keydown', e => { if (e.key === 'Enter') card.querySelector('.btn.primary').click(); });
    const saved = PREF.get('jp_saved_email');
    if (saved) { card.querySelector('#em').value = saved; setTimeout(() => card.querySelector('#pw')?.focus(), 0); }
  } else if (mode === 'signup') {
    clear(card, head, h('p', { class: 'lead' }, '가입 후 관리자가 승인하면 이용할 수 있습니다. 동료임을 확인할 수 있도록 실명·부서·사번을 정확히 적어 주세요.'), err, googleBtn(),
      h('div', { class: 'field' }, h('label', '이름 *'), inp('nm', 'text', '홍길동', 'name')),
      h('div', { class: 'grid g2', style: { gap: '10px' } }, h('div', { class: 'field' }, h('label', '부서'), inp('dp', 'text', '착즙팀', 'organization')), h('div', { class: 'field' }, h('label', '사번'), inp('en', 'text', '', 'off'))),
      h('div', { class: 'field' }, h('label', '이메일 *'), inp('em', 'email', 'name@company.com', 'email')),
      h('div', { class: 'field' }, h('label', '비밀번호 * (6자 이상)'), inp('pw', 'password', '', 'new-password')),
      btn('가입 신청', async () => {
        if (!val('nm') || !val('em')) throw new Error('이름과 이메일을 입력해 주세요.');
        const pw = card.querySelector('#pw').value; if (pw.length < 6) throw new Error('비밀번호는 6자 이상이어야 합니다.');
        const r = await api.signUp({ email: val('em'), password: pw, name: val('nm'), dept: val('dp'), emp_no: val('en') });
        if (api.mode === 'supabase' && !r?.session) authScreen('login', '가입 신청이 접수되었습니다. 메일함의 인증 링크를 누른 뒤 로그인하세요. 관리자 승인 후 이용할 수 있습니다.');
      }),
      h('div', { class: 'auth-links' }, h('a', { onclick: () => authScreen('login') }, '← 로그인으로')));
  } else {
    clear(card, head, h('p', { class: 'lead' }, '가입한 이메일로 비밀번호 재설정 링크를 보내드립니다.'), err,
      h('div', { class: 'field' }, h('label', '이메일'), inp('em', 'email', '', 'email')),
      btn('재설정 메일 보내기', async () => { await api.resetPassword(val('em')); authScreen('login', '재설정 메일을 보냈습니다. 메일의 링크를 눌러 새 비밀번호를 정하세요.'); }),
      h('div', { class: 'auth-links' }, h('a', { onclick: () => authScreen('login') }, '← 로그인으로')));
  }
  if (msg) { err.className = 'form-note'; }
  // 구글 브랜드 인증용: 앱 소개와 개인정보처리방침 링크 (로그인 없이 보이는 화면)
  const about = h('div', { class: 'auth-about' },
    h('p', `${CONFIG.TEAM_NAME} 업무 포털은 ${CONFIG.TEAM_NAME} 구성원이 생산기록·대두 SILO·정비·부품·주간생산계획표를 함께 기록하고 확인하는 사내 업무용 웹사이트입니다.`),
    h('a', { href: 'privacy.html' }, '개인정보처리방침'));
  clear(root, h('div', { class: 'auth' }, h('div', { class: 'auth-wrap' }, card, about)));
}
function waitScreen() {
  const susp = me.status === 'suspended';
  const missing = !susp && (!me.name || !me.dept || !me.emp_no);
  const inp = (id, label, v, ph) => h('div', { class: 'field' }, h('label', { for: id }, label), h('input', { class: 'input', id, value: v || '', placeholder: ph || '' }));
  const box = h('div', { class: 'grid', style: { gap: '10px' } },
    h('div', { class: 'form-note' }, missing ? '관리자가 동료인지 확인할 수 있도록 이름·부서·사번을 적어 주세요.' : '신청 정보를 고칠 수 있습니다.'),
    inp('w_nm', '이름', me.name, '홍길동'), h('div', { class: 'grid g2', style: { gap: '10px' } }, inp('w_dp', '부서', me.dept, '착즙팀'), inp('w_en', '사번', me.emp_no)),
    h('button', { class: 'btn', onclick: async () => {
      const v = { name: document.getElementById('w_nm').value.trim(), dept: document.getElementById('w_dp').value.trim(), emp_no: document.getElementById('w_en').value.trim() };
      if (!v.name) return toast('이름을 입력해 주세요.', 'err');
      try { me = await api.update('profiles', me.id, v); toast('신청 정보를 저장했습니다.', 'ok'); waitScreen(); } catch (e) { toast(e.message, 'err'); }
    } }, '신청 정보 저장'));
  clear(root, h('div', { class: 'auth' }, h('div', { class: 'auth-card' },
    brandMark(), h('h1', susp ? '이용이 정지된 계정입니다' : '승인 대기 중입니다'),
    h('p', { class: 'lead', style: { margin: 0 } }, susp ? '관리자에게 문의하세요.' : `${me.name || me.email}님의 가입 신청이 접수되었습니다. 관리자가 승인하면 바로 이용할 수 있습니다.`),
    h('div', { class: 'meta-box' }, h('div', `이메일: ${me.email}`), h('div', `부서·사번: ${me.dept || '—'} · ${me.emp_no || '—'}`), h('div', `신청: ${fmtFull(me.created_at)}`)),
    susp ? null : box,
    h('button', { class: 'btn primary lg', onclick: boot }, '승인 여부 다시 확인'),
    h('button', { class: 'btn', onclick: logout }, '로그아웃'))));
}
async function logout() { await api.signOut(); me = null; authScreen(); }

// ================================================================ 포털 연계
// 다른 팀 포털(각자 Supabase)과 서로 "연계 코드"를 등록하면,
//  · 내 포털 → [연계 포털] → [게스트로 열기] : 상대 포털이 새 창으로 열리고, 내 로그인을 상대 서버가 직접 확인 → 상대 포털에 게스트(보기만)로 입장
//  · 연계 코드에는 공개용 정보만 들어감 (사이트 주소, Supabase 주소, 공개용 publishable 키). 비밀 키는 절대 넣지 않음
const linkCode = () => btoa(unescape(encodeURIComponent(JSON.stringify({ v: 1, name: `${CONFIG.TEAM_NAME} 업무 포털`, site_url: location.origin + location.pathname.replace(/index\.html$/, ''), supabase_url: CONFIG.SUPABASE_URL, anon_key: CONFIG.SUPABASE_ANON_KEY }))));
const readLinkCode = s => {
  let o; try { o = JSON.parse(decodeURIComponent(escape(atob(String(s).trim())))); } catch { throw new Error('연계 코드를 읽지 못했습니다. 상대 포털의 "이 포털의 연계 코드"를 그대로 복사해 붙여 넣으세요.'); }
  if (!o?.site_url || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/i.test(o.supabase_url || '') || !o.anon_key) throw new Error('연계 코드에 필요한 정보가 없습니다.');
  if (/service_role|sb_secret_/i.test(o.anon_key) || (() => { try { return JSON.parse(atob(o.anon_key.split('.')[1])).role === 'service_role'; } catch { return false; } })()) throw new Error('비밀 키가 들어 있는 코드는 받을 수 없습니다. 공개용 키만 써야 합니다.');
  if (o.supabase_url.replace(/\/$/, '') === CONFIG.SUPABASE_URL.replace(/\/$/, '')) throw new Error('이 포털 자신의 연계 코드입니다.');
  return { name: String(o.name || '연계 포털').slice(0, 60), site_url: o.site_url, supabase_url: o.supabase_url.replace(/\/$/, ''), anon_key: o.anon_key };
};
function openPartner(lp) {
  const site = lp.site_url.replace(/\/$/, '');
  const origin = new URL(site).origin;
  const w = window.open(`${site}/#/link-in`, '_blank');
  if (!w) { toast('새 창이 막혔습니다. 팝업 차단을 풀고 다시 눌러 주세요.', 'err'); return; }
  const onMsg = async e => {
    if (e.source !== w || e.origin !== origin || e.data?.type !== 'portal-link-ready') return;
    window.removeEventListener('message', onMsg);
    const token = await api.accessToken();
    w.postMessage({ type: 'portal-link-token', token, from: CONFIG.SUPABASE_URL }, origin);   // 그 포털 주소로만 보냄
  };
  window.addEventListener('message', onMsg);
  setTimeout(() => window.removeEventListener('message', onMsg), 60000);
}
// 이 포털 쪽: 연계 포털이 연 창 (#/link-in) → 열어 준 창에 토큰을 받아 확인 → 연계 게스트로 로그인
async function linkIn() {
  // 방식 2: 상대 포털이 portal-link 함수를 직접 불러 받은 일회용 입장 코드를 주소로 넘김 (#/link-in?token_hash=…)
  const hash = new URLSearchParams(location.hash.split('?')[1] || '').get('token_hash');
  history.replaceState(null, '', location.pathname + '#/today');   // 코드는 주소창에서 바로 지움
  if (hash) {
    clear(root, h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, brandMark(), h('h1', '연계 포털 확인 중…'))));
    try { await api.linkHash(hash); return false; }
    catch (e) { authScreen('login', '입장 코드가 만료됐거나 이미 사용됐습니다. 원래 포털에서 다시 눌러 주세요. (' + e.message + ')'); return true; }
  }
  const cur = await api.session();
  if (cur) { const m = await api.me(); if (m && !m.linked_from) return false; }   // 이미 이 포털 팀원으로 로그인돼 있으면 그대로
  if (!window.opener) { authScreen('login', '연계 포털 화면의 [게스트로 열기] 버튼으로 들어와 주세요.'); return true; }
  clear(root, h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, brandMark(), h('h1', '연계 포털 확인 중…'), h('p', { class: 'lead' }, '열어 준 포털의 로그인을 확인하고 있습니다.'))));
  try {
    const data = await new Promise((res, rej) => {
      const t = setTimeout(() => { window.removeEventListener('message', f); rej(new Error('연계 포털에서 응답이 없습니다. 연계 포털 화면에서 다시 눌러 주세요.')); }, 20000);
      function f(e) { if (e.source !== window.opener || e.data?.type !== 'portal-link-token') return; clearTimeout(t); window.removeEventListener('message', f); res(e.data); }
      window.addEventListener('message', f);
      window.opener.postMessage({ type: 'portal-link-ready' }, '*');   // 비밀 없는 신호. 토큰은 상대 창이 이 주소로만 보냄
    });
    if (!data.token) throw new Error('연계 포털에서 로그인 정보를 받지 못했습니다. 그 포털에 로그인한 뒤 다시 눌러 주세요.');
    await api.linkLogin(data.from, data.token);
    return false;   // 로그인 완료 → 이어서 boot
  } catch (e) { authScreen('login', e.message); return true; }
}
VIEWS.links = async el => {
  const rows = await api.list('linked_portals', { order: 'name', asc: true });
  const act = rows.filter(r => r.active);
  const code = linkCode();
  const codeBox = h('textarea', { class: 'input mono', rows: 3, readOnly: true, onclick: e => e.target.select() }, code);
  clear(el, pageHead('연계 포털', isLinked() ? `${me.linked_from}에서 연계로 들어온 게스트입니다.` : '다른 팀 포털을 내 계정으로 게스트(보기만)로 열 수 있습니다.'),
    isLinked() ? h('div', { class: 'unit-note' }, '연계 게스트는 다른 포털로 다시 연계해 들어갈 수 없습니다. 원래 포털에서 여세요.') :
      card('연계된 포털', act.length ? h('div', { class: 'list' }, act.map(lp => h('div', { class: 'li' },
        h('div', { class: 'grow' }, h('div', { class: 't' }, lp.name), h('div', { class: 's' }, lp.site_url)),
        lp.site_url ? h('button', { class: 'btn primary sm', onclick: () => openPartner(lp) }, '게스트로 열기') : h('span', { class: 'muted small' }, '사이트 주소 미등록'))))
        : h('div', { class: 'muted small' }, isAdmin() ? '아직 연계된 포털이 없습니다. 아래에서 상대 포털의 연계 코드를 등록하세요.' : '아직 연계된 포털이 없습니다. 관리자가 등록하면 여기에 나옵니다.')),
    isAdmin() ? h('div', { class: 'grid g2', style: { marginTop: '14px' } },
      card('이 포털의 연계 코드', [h('div', { class: 'muted small', style: { marginBottom: '8px' } }, '연계할 상대 포털의 관리자에게 이 코드를 보내 주세요. 공개용 정보(사이트 주소·Supabase 주소·공개용 키)만 들어 있고, 비밀 키는 들어 있지 않습니다.'),
        codeBox, h('button', { class: 'btn', style: { marginTop: '8px' }, onclick: async () => { try { await navigator.clipboard.writeText(code); toast('복사했습니다.', 'ok'); } catch { codeBox.select(); toast('코드를 선택했습니다. Ctrl+C로 복사하세요.'); } } }, '코드 복사'),
        h('div', { class: 'muted small', style: { marginTop: '8px' } }, `Supabase 주소: ${CONFIG.SUPABASE_URL}`)]),
      card('상대 포털 등록', [h('div', { class: 'muted small', style: { marginBottom: '8px' } }, '상대 포털 관리자에게 받은 연계 코드를 붙여 넣으세요. 등록한 포털의 승인된 사용자만 이 포털에 게스트로 들어올 수 있고, 이 포털 사람도 그 포털을 열 수 있습니다. (양쪽 모두 서로를 등록해야 합니다)'),
        h('textarea', { class: 'input mono', rows: 3, id: 'lk_in', placeholder: '연계 코드 붙여 넣기' }),
        h('button', { class: 'btn primary', style: { marginTop: '8px' }, onclick: async () => {
          try {
            const lp = readLinkCode(document.getElementById('lk_in').value);
            const ex = rows.find(r => r.supabase_url.replace(/\/$/, '') === lp.supabase_url);
            if (ex) await api.update('linked_portals', ex.id, { ...lp, active: true }); else await api.insert('linked_portals', lp);
            toast(`${lp.name}을(를) 등록했습니다.`, 'ok'); render();
          } catch (e) { toast(e.message, 'err'); }
        } }, '등록')])) : null,
    isAdmin() && rows.length ? card('등록된 연계 포털 관리', table(rows, [
      { label: '포털', v: r => h('b', r.name), lead: true }, { label: '사이트', v: r => r.site_url }, { label: 'Supabase', v: r => r.supabase_url },
      { label: '상태', v: r => (r.active ? badge('사용', 'ok') : badge('중지')) },
      { label: '', v: r => h('span', { style: { display: 'flex', gap: '6px' } },
        h('button', { class: 'btn sm', onclick: async e => { e.stopPropagation(); try { await api.update('linked_portals', r.id, { active: !r.active }); render(); } catch (x) { toast(x.message, 'err'); } } }, r.active ? '중지' : '다시 사용'),
        h('button', { class: 'btn sm danger', onclick: async e => { e.stopPropagation(); if (await confirmDlg('연계 해제', `${r.name} 연계를 지울까요? 그 포털 사람은 더 이상 게스트로 들어올 수 없습니다.`, '지우기', true)) { try { await api.remove('linked_portals', r.id); render(); } catch (x) { toast(x.message, 'err'); } } } }, '지우기')) },
    ], { cards: false })) : null,
    h('div', { class: 'unit-note' }, '연계 게스트가 볼 수 있는 메뉴는 기준값·권한의 "게스트 보기" 설정을 따릅니다. 작성·수정·삭제는 설정과 관계없이 항상 막혀 있습니다. 연계로 들어온 사람은 사용자·승인 화면에 "연계"로 표시되고, 정지할 수 있습니다.'));
};

// ================================================================ 시작
let booting = false;
// 마지막 접속 시각: 포털을 열어 둔 동안 5분마다 기록 (기능이 아직 설치 안 됐으면 조용히 넘어감)
let seenTimer = null;
function touchSeen() {
  const go = () => { if (me && document.visibilityState !== 'hidden') api.rpc('touch_seen', {}).catch(() => {}); };
  go(); if (!seenTimer) { seenTimer = setInterval(go, 5 * 60e3); document.addEventListener('visibilitychange', go); }
}

async function boot() {
  if (booting) return; booting = true;
  try {
    if (/^#\/?link-in/.test(location.hash)) { const stop = await linkIn(); if (stop) return; }
    const u = await api.session();
    if (!u) { me = null; authScreen(); return; }
    me = await api.me();
    if (!me) { authScreen('login', '프로필을 찾지 못했습니다. 잠시 후 다시 로그인해 주세요.'); return; }
    if (me.status !== 'active') { waitScreen(); return; }
    touchSeen();
    await loadSettings(); await loadCommon();
    badges.lowParts = C.parts.filter(p => p.stock < p.min_stock).length;
    if (isAdmin()) badges.pending = (await api.list('profiles', { where: [['status', 'eq', 'pending']] })).length;
    await render();
  } catch (e) {
    console.error(e);
    clear(root, h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, h('h1', '연결하지 못했습니다'), h('div', { class: 'form-error' }, e.message || String(e)), h('button', { class: 'btn primary lg', onclick: boot }, '다시 시도'), h('button', { class: 'btn', onclick: logout }, '로그아웃'))));
  } finally { booting = false; }
}

(async () => {
  api = await createApi();
  // 자동 로그인을 끈 상태에서 브라우저를 새로 열었으면 로그아웃 (세션 쿠키 없음)
  if (PREF.get('jp_auto_login') === '0' && !document.cookie.split('; ').includes('jp_alive=1')) {
    try { if (await api.session()) await api.signOut(); } catch { /* */ }
  }
  api.onAuth((u, ev) => {
    if (ev === 'PASSWORD_RECOVERY') { boot().then(() => go('me')); return; }
    if (ev === 'SIGNED_OUT' || (ev === 'SIGNED_IN' && (!me || me.id !== u?.id))) boot();
  });
  window.addEventListener('hashchange', () => { if (me?.status === 'active') { badges.lowParts = C.parts.filter(p => p.stock < p.min_stock).length; render(); } });
  boot();
})();
