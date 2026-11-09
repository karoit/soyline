// 기본 설정값 · 메뉴별 권한 키 · 데모용 예시 데이터

export const MODULE_OF = {
  notices: 'today', roster: 'today', handovers: 'today',
  products: 'master', equipment: 'master',
  plans: 'production', production: 'production',
  silo_tx: 'silo',
  maintenance: 'maintenance',
  parts: 'parts', part_tx: 'parts', part_usage: 'parts', docs: 'docs', weekly_plans: 'production',
  tank_routes: 'board',
};
// 작업자는 본인 기록만, 정해진 시간 안에 정정 가능한 테이블
export const OWN_EDIT = ['production', 'silo_tx'];

export const MODULES = [
  ['board', '착즙실 현황판'], ['today', '오늘의 업무'], ['production', '생산계획·생산기록'], ['silo', '대두 SILO'],
  ['maintenance', '설비·정비'], ['parts', '부품'], ['docs', '자료실'],
  ['master', '설비·제품 기준정보'], ['stats', '통계'],
];

const rw = (r, w) => ({ read: r, write: w });
export const DEFAULT_SETTINGS = {
  permissions: {
    worker: { board: rw(1, 1), today: rw(1, 1), production: rw(1, 1), silo: rw(1, 1), maintenance: rw(1, 1), parts: rw(1, 1), docs: rw(1, 1), master: rw(1, 0), stats: rw(1, 0) },
    guest: { board: rw(1, 0), today: rw(1, 0), production: rw(0, 0), silo: rw(0, 0), maintenance: rw(1, 0), parts: rw(0, 0), docs: rw(1, 0), master: rw(1, 0), stats: rw(0, 0) },
  },
  lists: {
    team_members: [],
    floor4_members: [],
    shifts: ['주간', '야간'],
    stop_reasons: ['설비 고장', '원료 부족', '품질 이상', '계획 변경', '기타'],
    maint_kinds: ['소모품 교체', '일상점검', '예방정비', '긴급정비', '사후정비', '업체정비'],
    symptoms: ['누유·누수', '이상 소음', '진동', '온도 이상', '압력 이상', '막힘', '전기·센서', '기타'],
    origins: ['국산', '미국산', '중국산', '캐나다산', '호주산'],
    silos: [1, 2],
    sterilizers: [1, 2, 3, 4, 5],
    doc_categories: ['근무표', '작업표준서', '설비 매뉴얼', '도면', '교육자료', '트러블슈팅'],
    equipment_categories: ['1·2차 마쇄기', '분리기·데칸타', 'WT·균질기', 'CIP', '열수탱크·열교환기'],
  },
  // 두유수율(%) 기준 — 시트 수식 그대로: 이상이면 해당 단계, 경고 미만은 불량
  yield_rules: {
    '수입콩': { good: 700, caution: 600, warning: 500 },
    '국산콩': { good: 1080, caution: 1050, warning: 1030 },
  },
  yield_calc: { import_dehull_pct: 89, no_dehull_pct: 88.88, liquid_pct: 7, output_per_capa: 0.686 },
  rules: { floor4_hours: '07:30~16:00', worker_edit_hours: 24, repeat_days: 30, repeat_count: 3, silo_capacity_kg: 120000 },
};
// permissions: 1/0 → true/false
for (const r of Object.values(DEFAULT_SETTINGS.permissions))
  for (const m of Object.values(r)) { m.read = !!m.read; m.write = !!m.write; }

const iso = d => d.toISOString();
const day = (n = 0) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
const at = (n, h) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return iso(d); };

// 데모 모드 예시 데이터 — 전부 is_sample: true (실제 기록 아님)
export function demoSeed(uid) {
  const admin = uid(), worker = uid(), pending = uid();
  const S = { is_sample: true, created_at: at(-1, 8), updated_by: null, updated_at: null };
  const by = (id, x) => ({ ...S, created_by: id, id: uid(), ...x });
  const eq = DEFAULT_SETTINGS.lists.equipment_categories;
  const equipment = [
    ['1·2차 마쇄기', '1차 마쇄기', 'GR-01'], ['1·2차 마쇄기', '2차 마쇄기', 'GR-02'],
    ['분리기·데칸타', '데칸타', 'DC-01'], ['WT·균질기', 'WT', 'WT-01'], ['WT·균질기', '균질기', 'HM-01'],
    ['CIP', 'CIP 유닛', 'CIP-01'], ['열수탱크·열교환기', '열수탱크', 'HW-01'], ['열수탱크·열교환기', '열교환기', 'HX-01'],
  ].map(([category, name, code]) => by(admin, { category, name, code, location: '2층 착즙실', status: '정상', pm_cycle_days: 90 }));
  equipment[2].status = '점검중'; void eq;
  const products = [
    ['90001', '[예시] 검은콩 두유 190ml', 0.0276, '대두(수입산)', 'WT', '250/500'],
    ['90002', '[예시] 고칼슘 두유 200ml', 0.0208, '대두(수입산)', '데칸타', ''],
    ['90003', '[예시] 국산콩 플레인 950ml', 0.0918, '국산콩(원물)', 'WT', '150/150'],
  ].map(([code, name, bom_std, material, equipment, homog_pressure]) => by(admin, { code, name, bom_std, material, equipment, homog_pressure, roast_temp: material === '국산콩(원물)' ? '238℃' : '', active: true }));
  const plans = [
    by(admin, { date: day(0), sterilizer: 1, product_code: '90001', scm_qty: 300000, shift: '주간', workers: '김OO, 이OO', status: '진행' }),
    by(admin, { date: day(0), sterilizer: 2, product_code: '90002', scm_qty: 240000, shift: '주간', workers: '김OO, 이OO', status: '대기' }),
    by(admin, { date: day(-1), sterilizer: 1, product_code: '90003', scm_qty: 80000, shift: '야간', workers: '박OO', status: '진행' }),
    by(admin, { date: day(1), sterilizer: 1, product_code: '90001', scm_qty: 280000, shift: '주간', workers: '', status: '대기' }),
  ];
  const production = [];
  for (let n = -40; n <= -1; n++) {
    if (new Date(day(n)).getDay() === 0) continue;
    const bean = n % 3 ? '수입콩' : '국산콩';
    const batches = bean === '수입콩' ? 10 + (n % 3) : 9, capa = bean === '수입콩' ? 8000 : 6000;
    const out = Math.round(batches * capa * 0.686 * 100) / 100;
    const ratio = bean === '수입콩' ? 5.6 + Math.random() * 3.4 : 10.2 + Math.random() * 1.6;
    const input = out / ratio;
    const dehull = bean === '수입콩' ? 89 : 85 + Math.random() * 4;
    const juice = Math.round(input * dehull / 100);
    const m1 = bean === '수입콩' ? 15000 + Math.round(Math.random() * 5000) : Math.round(juice / 0.9);
    const m2 = bean === '국산콩' ? Math.round(m1 * dehull / 100) : null;
    const soy = juice / (dehull / 100), pctY = out / soy * 100, r = DEFAULT_SETTINGS.yield_rules[bean];
    production.push(by(worker, {
      date: day(n), bean_type: bean, equipment: n % 2 ? 'WT' : '데칸타', product_code: n % 3 ? '90001' : '90003', product_name: null,
      batches, capa, meter1: m1, meter2: m2, juice_meter: juice, soymilk_output_kg: out,
      dehull_yield: Math.round(dehull * 100) / 100, soy_input_kg: Math.round(soy * 10) / 10, extract_yield: Math.round(out * 0.07 / juice * 1e4) / 100,
      sterile_transfer: null,
      yield_status: pctY >= r.good ? '양호' : pctY >= r.caution ? '주의' : pctY >= r.warning ? '경고' : '불량', memo: '', created_at: at(n, 18),
    }));
  }
  const silo_tx = [
    by(admin, { date: day(-21), silo: 1, type: '조정', origin: '국산', qty_kg: 56000, memo: '기초 재고' }),
    by(admin, { date: day(-21), silo: 2, type: '조정', origin: '미국산', qty_kg: 58000, memo: '기초 재고' }),
    by(worker, { date: day(-12), silo: 2, type: '입고', origin: '미국산', qty_kg: 26000, memo: '' }),
    by(worker, { date: day(-5), silo: 2, type: '입고', origin: '국산', qty_kg: 13000, memo: '예시: 원산지 혼입 경고 확인용' }),
  ];
  for (const p of production) silo_tx.push(by(worker, { date: p.date, silo: p.bean_type === '국산콩' ? 1 : 2, type: '사용', origin: p.bean_type === '국산콩' ? '국산' : '미국산', qty_kg: Math.round(p.soy_input_kg), product_code: p.product_code, batches: p.batches, memo: '' }));
  const maintenance = [
    by(worker, { equipment_id: equipment[2].id, kind: '사후정비', symptom: '진동', occurred_at: at(-2, 10), action: '베어링 점검 중', worker: '이OO', photos: [], status: '진행' }),
    by(worker, { equipment_id: equipment[2].id, kind: '사후정비', symptom: '진동', occurred_at: at(-12, 14), action: '볼트 체결', worker: '이OO', photos: [], status: '완료', done_at: at(-12, 16) }),
    by(worker, { equipment_id: equipment[2].id, kind: '사후정비', symptom: '진동', occurred_at: at(-25, 9), action: '밸런스 조정', worker: '박OO', photos: [], status: '완료', done_at: at(-25, 12) }),
    by(admin, { equipment_id: equipment[4].id, kind: '예방정비', symptom: '', action: '균질기 패킹 정기 교체', worker: '', photos: [], status: '예정', due_date: day(2) }),
  ];
  const parts = [
    by(admin, { name: '[예시] 데칸타 베어링', part_no: 'DC-BRG-6310', equipment: '데칸타', location: 'A-1 선반', stock: 2, min_stock: 2 }),
    by(admin, { name: '[예시] 균질기 패킹', part_no: 'HM-PK-01', equipment: '균질기', location: 'A-2 선반', stock: 1, min_stock: 4 }),
    by(admin, { name: '[예시] 마쇄기 칼날', part_no: 'GR-BL-02', equipment: '1차 마쇄기', location: 'B-1 선반', stock: 6, min_stock: 2 }),
  ];
  const part_tx = parts.map(p => ({ id: uid(), part_id: p.id, type: '입고', qty: p.stock, stock_after: p.stock, maintenance_id: null, reason: '예시 기초재고', client_id: null, created_by: admin, created_at: at(-30, 9) }));
  return {
    session: null,
    users: [
      { id: admin, email: 'admin@demo.kr', password: 'demo1234' },
      { id: worker, email: 'worker@demo.kr', password: 'demo1234' },
      { id: pending, email: 'new@demo.kr', password: 'demo1234' },
    ],
    files: {},
    t: {
      profiles: [
        { id: admin, email: 'admin@demo.kr', name: '관리자(예시)', dept: '착즙팀', emp_no: 'A001', role: 'admin', status: 'active', created_at: at(-60, 9) },
        { id: worker, email: 'worker@demo.kr', name: '작업자(예시)', dept: '착즙팀', emp_no: 'W012', role: 'worker', status: 'active', created_at: at(-40, 9) },
        { id: pending, email: 'new@demo.kr', name: '신규입사자(예시)', dept: '착즙팀', emp_no: 'W020', role: 'worker', status: 'pending', created_at: at(-1, 9) },
      ],
      settings: Object.entries(DEFAULT_SETTINGS).map(([id, value]) => ({ id, value: JSON.parse(JSON.stringify(value)) })),
      notices: [by(admin, { title: '[예시] 금주 금요일 설비 집중 점검', body: '정비 기록 누락 없도록 해주세요.', important: true, start_date: day(-1), end_date: day(4) })],
      roster: [by(admin, { date: day(0), shift: '주간', workers: '김OO, 이OO', hours: '05:30~14:30' }), by(admin, { date: day(0), shift: '야간', workers: '박OO, 정OO', hours: '14:30~23:00' }), by(admin, { date: day(0), shift: '휴무', workers: '최OO, 한OO' }), by(admin, { date: day(0), shift: '4층', workers: '우OO, 김OO(09:00~18:00)', hours: '07:30~16:00' }), by(admin, { date: day(0), shift: '배합지원', workers: '최OO(06:00~15:00)' })],
      handovers: [
        by(worker, { date: day(-1), shift: '야간', content: '[예시] 데칸타 진동 계속 있음. 주간조 확인 부탁', done: false }),
        by(worker, { date: day(-1), shift: '주간', content: '[예시] 2번 SILO 입고 예정 13시', done: true }),
      ],
      products, plans, production, silo_tx, equipment, maintenance, parts, part_tx,
      weekly_plans: [demoWeek(by, admin)],
      docs: [by(admin, { category: '트러블슈팅', title: '[예시] 데칸타 진동 발생 시 점검 순서', body: '1. 투입량 확인\n2. 볼 내부 잔여물 확인\n3. 베어링 온도 측정', revised_on: day(-30), tags: '데칸타, 진동' })],
      audit_log: [],
    },
  };
}

// 데모: 이번 주 주간생산계획표 예시
function demoWeek(by, admin) {
  const ws = (() => { const d = new Date(); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return d.toLocaleDateString('sv-SE'); })();
  const dd = n => { const d = new Date(ws + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
  const WD = ['월', '화', '수', '목', '금', '토', '일'];
  const days = WD.map((wd, i) => { const d = dd(i); return { date: d, label: `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`, wd }; });
  const it = (code, name, qty, pack, time) => ({ code, name, qty, pack, time });
  const cells = [];
  days.forEach((d, i) => {
    cells.push({ date: d.date, col: 1, items: i % 2 ? [it('90001', '[예시] 검은콩 두유', 303644, 'M 190ml', '09:00~22:00')] : [it('80001', '[예시] 딸기우유', 245098, 'C 120ml', '09:00~20:00')], batch: '' });
    cells.push({ date: d.date, col: 2, items: [it('90002', '[예시] 고칼슘 두유', 299327, 'CS 190ml', '10:00~23:00')], batch: '', line: i === 0 ? '#3 데칸타' : null });
    cells.push({ date: d.date, col: 3, items: i === 3 ? [] : [it('80002', '[예시] 멸균우유', 150663, 'M 190ml', '09:00~15:00')], note_src: i === 3 ? '정 비' : '', batch: '' });
    cells.push({ date: d.date, col: 4, items: [], note_src: '정 비', batch: '' });
    cells.push({ date: d.date, col: 5, items: [it('90003', '[예시] 국산콩 두유', 244798, 'C 190ml', '10:00~23:00'), ...(i === 4 ? [it('90001', '[예시] 검은콩 두유', 20000, 'C 190ml', '10:00~23:00')] : [])], batch: '', line: i % 3 === 0 ? '#2 WT2' : null, hopper: i === 2 ? ['2&4층 호퍼비우기'] : [], note: i === 0 ? '6,000 배합' : null });
    cells.push({ date: d.date, col: 0, items: [], note_src: i === 6 ? '[예시] 원액 10,000kg' : '', batch: '' });
  });
  return by(admin, { week_start: days[0].date, week_end: days[6].date, title: '상온제품 주간생산계획 (제품, 원액) — 예시', days, cols: [1, 2, 3, 4, 5].map(no => ({ no, label: `멸균${no}호기` })), cells, notes: { juice: '[예시] 월 #1WT1', da: '' }, file_path: null, file_name: null });
}
