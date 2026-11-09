// 데이터 계층: Supabase(운영) 또는 데모(브라우저 저장) 중 하나를 같은 방식으로 사용합니다.
import { CONFIG } from '../config.js';
import { DEFAULT_SETTINGS, MODULE_OF, OWN_EDIT, demoSeed } from './defaults.js';

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() :
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  }));

export class ApiError extends Error {
  constructor(message, code, retryable) { super(message); this.code = code; this.retryable = !!retryable; }
}

function normErr(e) {
  if (e instanceof ApiError) return e;
  const msg = String(e?.message || e || '');
  if (/Failed to fetch|NetworkError|network|timeout|Load failed/i.test(msg))
    return new ApiError('네트워크 연결이 불안정합니다. 입력 내용은 그대로 있으니 다시 시도해 주세요.', 'network', true);
  if (e?.code === '42501' || /row-level security|permission denied/i.test(msg))
    return new ApiError('이 작업을 할 권한이 없습니다. (본인 기록은 정해진 시간 안에만 정정할 수 있어요)', 'forbidden');
  if (e?.code === '23505') return new ApiError('이미 같은 값이 등록되어 있습니다. (중복)', 'duplicate');
  if (e?.code === '23514') return new ApiError('입력값이 규칙에 맞지 않습니다. 수량·필수 항목을 확인해 주세요.', 'check');
  if (/Invalid login credentials/i.test(msg)) return new ApiError('이메일 또는 비밀번호가 올바르지 않습니다.', 'auth');
  if (/Email not confirmed/i.test(msg)) return new ApiError('이메일 인증이 아직 안 되었습니다. 메일함을 확인해 주세요.', 'unconfirmed');
  if (/only request this after|rate limit|too many/i.test(msg)) { const s = msg.match(/after (\d+) seconds?/); return new ApiError(`메일은 잠시 후에 다시 보낼 수 있습니다.${s ? ` (${s[1]}초 뒤)` : ' (1분쯤 뒤)'}`, 'auth'); }
  if (/already registered/i.test(msg)) return new ApiError('이미 가입된 이메일입니다.', 'auth');
  if (/provider is not enabled|Unsupported provider/i.test(msg)) return new ApiError('구글 로그인이 아직 설정되지 않았습니다. 관리자가 Supabase에서 Google 로그인을 켜야 합니다. (README ④-2)', 'auth');
  if (/Password should be/i.test(msg)) return new ApiError('비밀번호는 6자 이상이어야 합니다.', 'auth');
  return new ApiError(msg || '알 수 없는 오류가 발생했습니다.', e?.code, true);
}

// ---------------------------------------------------------------- Supabase
async function makeSupabase() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } });
  const run = async p => { try { const { data, error } = await p; if (error) throw error; return data; } catch (e) { throw normErr(e); } };
  return {
    mode: 'supabase',
    async session() { const { data } = await sb.auth.getSession(); return data.session?.user || null; },
    onAuth(cb) { sb.auth.onAuthStateChange((ev, s) => cb(s?.user || null, ev)); },
    signUp: ({ email, password, name, dept, emp_no }) =>
      run(sb.auth.signUp({ email, password, options: { data: { name, dept, emp_no }, emailRedirectTo: location.origin + location.pathname } })),
    signIn: (email, password) => run(sb.auth.signInWithPassword({ email, password })),
    signInWithGoogle: () => run(sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname, queryParams: CONFIG.GOOGLE_DOMAIN ? { hd: CONFIG.GOOGLE_DOMAIN, prompt: 'select_account' } : { prompt: 'select_account' } },
    })),
    signOut: () => sb.auth.signOut(),
    resetPassword: email => run(sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })),
    // 가입 인증 메일 다시 보내기 (예전 메일 링크가 만료됐을 때)
    resendSignup: email => run(sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: location.origin + location.pathname } })),
    updatePassword: password => run(sb.auth.updateUser({ password })),
    // 포털 연계: 지금 로그인 토큰 (연계 포털에 "이 사람이 맞다"를 확인시킬 때만 사용)
    async accessToken() { const { data } = await sb.auth.getSession(); return data.session?.access_token || null; },
    // 다른 포털의 토큰으로 이 포털에 연계 게스트 로그인 (Edge Function portal-link가 확인)
    async linkLogin(portal_url, token) {
      const { data, error } = await sb.functions.invoke('portal-link', { body: { portal_url, token } });
      if (error) {
        let m = error.message || '';
        try { const j = await error.context?.json(); if (j?.error) m = j.error; } catch { /* */ }
        if (/Failed to send|not found|404|NOT_FOUND/i.test(m)) m = '이 포털에 연계 기능(portal-link)이 아직 설치되지 않았습니다. 관리자에게 알려 주세요.';
        throw new ApiError(m, 'link');
      }
      await run(sb.auth.verifyOtp({ token_hash: data.token_hash, type: 'magiclink' }));
      return data;
    },
    linkHash: token_hash => run(sb.auth.verifyOtp({ token_hash, type: 'magiclink' })),
    async me() {
      const u = (await sb.auth.getUser()).data.user; if (!u) return null;
      return run(sb.from('profiles').select('*').eq('id', u.id).maybeSingle());
    },
    async list(table, { where = [], order, asc = false, limit } = {}) {
      let q = sb.from(table).select('*');
      for (const [c, op, v] of where) q = op === 'in' ? q.in(c, v) : q[op](c, v);
      if (order) q = q.order(order, { ascending: asc });
      if (limit) q = q.limit(limit);
      return run(q);
    },
    async insert(table, row) {
      const { data, error } = await sb.from(table).insert(row).select().single().then(r => r, e => ({ error: e }));
      if (error?.code === '23505' && row.client_id) {
        const again = await run(sb.from(table).select('*').eq('client_id', row.client_id).maybeSingle());
        if (again) return again; // 이미 저장된 요청(재시도) → 성공 처리
      }
      if (error) throw normErr(error);
      return data;
    },
    update: (table, id, patch) => run(sb.from(table).update(patch).eq('id', id).select().single()),
    remove: (table, id) => run(sb.from(table).delete().eq('id', id)),
    rpc: (fn, args) => run(sb.rpc(fn, args)),
    async upload(bucket, file) {
      const ext = (file.name.match(/\.[\w]+$/) || [''])[0].toLowerCase();
      const path = `${new Date().toISOString().slice(0, 7)}/${uid()}${ext}`;
      await run(sb.storage.from(bucket).upload(path, file, { contentType: file.type }));
      return path;
    },
    async fileUrl(bucket, path) {
      const d = await run(sb.storage.from(bucket).createSignedUrl(path, 3600)); return d.signedUrl;
    },
    history: (table, id) => run(sb.from('audit_log').select('*').eq('table_name', table).eq('row_id', String(id)).order('at', { ascending: false })),
  };
}

// ---------------------------------------------------------------- Demo (localStorage)
function makeDemo() {
  const KEY = 'juice_portal_demo_v1';
  let db;
  const load = () => {
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
    if (!db) { db = demoSeed(uid); try { save(); } catch { /* 저장 불가: 이번 접속 동안만 유지 */ } }
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { throw new ApiError('브라우저 저장 공간이 부족합니다. (데모 모드)', 'quota'); } };
  load();
  const listeners = [];
  const T = name => (db.t[name] ||= []);
  const me = () => T('profiles').find(p => p.id === db.session);
  const role = () => { const p = me(); return p?.status === 'active' ? p.role : null; };
  const can = (module, action) => {
    const r = role(); if (!r) return false; if (r === 'admin') return true;
    const perm = T('settings').find(s => s.id === 'permissions')?.value || DEFAULT_SETTINGS.permissions;
    return !!perm?.[r]?.[module]?.[action];
  };
  const editHours = () => T('settings').find(s => s.id === 'rules')?.value?.worker_edit_hours ?? 24;
  const deny = () => { throw new ApiError('이 작업을 할 권한이 없습니다. (본인 기록은 정해진 시간 안에만 정정할 수 있어요)', 'forbidden'); };
  const audit = (table, row_id, action, old_data, new_data) =>
    T('audit_log').push({ id: T('audit_log').length + 1, table_name: table, row_id: String(row_id), action, old_data, new_data, by: db.session, at: new Date().toISOString() });
  const clone = x => JSON.parse(JSON.stringify(x));
  const delay = () => new Promise(r => setTimeout(r, 120));
  const match = (row, [c, op, v]) => {
    const x = row[c];
    switch (op) {
      case 'eq': return x === v; case 'neq': return x !== v;
      case 'gte': return x != null && x >= v; case 'lte': return x != null && x <= v;
      case 'gt': return x != null && x > v; case 'lt': return x != null && x < v;
      case 'in': return v.includes(x); case 'is': return v === null ? x == null : x === v;
      default: return true;
    }
  };
  // 데이터베이스의 자동 입력 규칙 흉내: 수입콩 1차 연류계 = 그날 국산 SILO를 뺀 사용량 합계
  // 그날 수입콩 SILO 사용량: SILO 1·2번 콩은 대두(수입산) 제품에만 사용 → 그날 사용량 전부 (SQL import_usage와 같은 규칙)
  const importUsage = d => T('silo_tx').filter(t => t.date === d && t.type === '사용').reduce((a, t) => a + Number(t.qty_kg || 0), 0);
  // 생산기록: 설비가 비어 있으면 BOM 설비, 제품TS는 BOM 값 (SQL production_from_bom과 같은 규칙)
  const bomFill = r => { const b = T('products').find(p => p.code === r.product_code); if (!b) return; if (!r.equipment) r.equipment = b.equipment || null; r.ts = b.ts ?? null; };
  const fillMeter1 = d => {
    if (!d) return; const total = importUsage(d);
    for (const p of T('production')) {
      if (p.date !== d || p.bean_type !== '수입콩') continue;
      if (total > 0 && (p.meter1 == null || p.meter1_auto)) { p.meter1 = total; p.meter1_auto = true; }
      else if (!(total > 0) && p.meter1_auto) { p.meter1 = null; p.meter1_auto = false; }
    }
  };
  const readable = t => t === 'profiles' ? !!me() : t === 'settings' || t === 'audit_log' ? !!role() : t === 'part_usage' ? can('parts', 'read') || can('maintenance', 'read') : can(MODULE_OF[t] || 'x', 'read');

  return {
    mode: 'demo',
    async session() { const p = me(); return p ? { id: p.id, email: p.email } : null; },
    onAuth(cb) { listeners.push(cb); },
    async signUp({ email, password, name, dept, emp_no }) {
      await delay();
      email = email.trim().toLowerCase();
      if (db.users.find(u => u.email === email)) throw new ApiError('이미 가입된 이메일입니다.', 'auth');
      if (!password || password.length < 6) throw new ApiError('비밀번호는 6자 이상이어야 합니다.', 'auth');
      const id = uid();
      const first = !T('profiles').some(p => p.role === 'admin');
      db.users.push({ id, email, password });
      T('profiles').push({ id, email, name, dept, emp_no, role: first ? 'admin' : 'worker', status: first ? 'active' : 'pending', created_at: new Date().toISOString() });
      db.session = id; save(); listeners.forEach(f => f({ id, email }, 'SIGNED_IN'));
    },
    async signIn(email, password) {
      await delay();
      const u = db.users.find(u => u.email === email.trim().toLowerCase() && u.password === password);
      if (!u) throw new ApiError('이메일 또는 비밀번호가 올바르지 않습니다.', 'auth');
      db.session = u.id; save(); listeners.forEach(f => f({ id: u.id, email: u.email }, 'SIGNED_IN'));
    },
    async signInWithGoogle() { throw new ApiError('데모 모드에서는 구글 로그인을 쓸 수 없습니다. 실제 사이트에서는 이 버튼으로 바로 가입·로그인됩니다.', 'demo'); },
    async signOut() { db.session = null; save(); listeners.forEach(f => f(null, 'SIGNED_OUT')); },
    async resetPassword() { throw new ApiError('데모 모드에서는 비밀번호 재설정 메일을 보낼 수 없습니다.', 'demo'); },
    async resendSignup() { throw new ApiError('데모 모드에서는 인증 메일을 보낼 수 없습니다.', 'demo'); },
    async accessToken() { return null; },
    async linkLogin() { throw new ApiError('데모 모드에서는 포털 연계를 쓸 수 없습니다.', 'demo'); },
    async linkHash() { throw new ApiError('데모 모드에서는 포털 연계를 쓸 수 없습니다.', 'demo'); },
    async updatePassword(password) { const u = db.users.find(u => u.id === db.session); if (u) { u.password = password; save(); } },
    async me() { await delay(); const p = me(); return p ? clone(p) : null; },
    async list(table, { where = [], order, asc = false, limit } = {}) {
      await delay();
      if (!readable(table)) return [];
      let rows = T(table).filter(r => where.every(w => match(r, w)));
      if (table === 'profiles' && !role()) rows = rows.filter(r => r.id === db.session);
      if (order) rows.sort((a, b) => ((a[order] ?? '') > (b[order] ?? '') ? 1 : (a[order] ?? '') < (b[order] ?? '') ? -1 : 0) * (asc ? 1 : -1));
      if (limit) rows = rows.slice(0, limit);
      return clone(rows);
    },
    async insert(table, row) {
      await delay();
      if (table === 'settings') { if (role() !== 'admin') deny(); T('settings').push({ ...row }); save(); return clone(row); }
      if (!can(MODULE_OF[table], 'write')) deny();
      if (row.client_id) { const ex = T(table).find(r => r.client_id === row.client_id); if (ex) return clone(ex); }
      if (table === 'parts' && T('parts').some(p => p.part_no === row.part_no)) throw new ApiError('이미 같은 품번이 등록되어 있습니다. (중복)', 'duplicate');
      if (table === 'products' && T('products').some(p => p.code === row.code)) throw new ApiError('이미 같은 제품코드가 등록되어 있습니다. (중복)', 'duplicate');
      if (table === 'parts') row.stock = 0;
      const rec = { id: uid(), is_sample: false, ...row, created_by: db.session, created_at: new Date().toISOString(), updated_by: null, updated_at: null };
      if (table === 'production') bomFill(rec);
      if (table === 'production' && rec.bean_type === '수입콩' && rec.meter1 == null) { const t = importUsage(rec.date); if (t > 0) { rec.meter1 = t; rec.meter1_auto = true; } }
      T(table).push(rec); audit(table, rec.id, 'insert', null, rec);
      if (table === 'silo_tx') fillMeter1(rec.date);
      save();
      return clone(rec);
    },
    async update(table, id, patch) {
      await delay();
      const rows = T(table); const i = rows.findIndex(r => r.id === id);
      if (i < 0) throw new ApiError('기록을 찾을 수 없습니다.', 'notfound');
      const old = rows[i];
      if (table === 'profiles') {
        if (role() !== 'admin' && id !== db.session) deny();
        if (role() !== 'admin') { delete patch.role; delete patch.status; }
        else if (old.status !== 'active' && patch.status === 'active') { patch.approved_by = db.session; patch.approved_at = new Date().toISOString(); }
        rows[i] = { ...old, ...patch, id }; save(); return clone(rows[i]);
      }
      if (table === 'settings') { if (role() !== 'admin') deny(); rows[i] = { ...old, ...patch }; save(); return clone(rows[i]); }
      if (!can(MODULE_OF[table], 'write')) deny();
      if (OWN_EDIT.includes(table) && table !== 'silo_tx' && role() !== 'admin') {
        if (table === 'production' && (old.juice_meter == null || (old.updated_by === db.session && (Date.now() - new Date(old.updated_at)) / 3.6e6 <= editHours()))) { /* 착즙 연류계 대기 중이거나 내가 최근 채운 기록 */ }
        else if (table === 'production' && Object.keys(patch).every(k => ['meter1', 'meter2', 'juice_meter', 'meter1_auto', 'dehull_yield', 'soy_input_kg', 'extract_yield', 'yield_status'].includes(k) || patch[k] === old[k])) { /* 1·2차 연류계와 그 계산값만 바꾸는 경우는 누구나 */ }
        else if (old.plan_key) { // 계획표 자동 등록 기록: 아직 아무도 안 채웠거나, 내가 채운 지 정해진 시간 안
          if (old.updated_by && (old.updated_by !== db.session || (Date.now() - new Date(old.updated_at)) / 3.6e6 > editHours())) deny();
        } else {
          const age = (Date.now() - new Date(old.created_at)) / 3.6e6;
          if (old.created_by !== db.session || age > editHours()) deny();
        }
      }
      if (table === 'parts' && 'stock' in patch && patch.stock !== old.stock) throw new ApiError('부품 재고는 입고·사용·정정 기록으로만 바꿀 수 있습니다.', 'check');
      const rec = { ...old, ...patch, id, created_by: old.created_by, created_at: old.created_at, updated_by: db.session, updated_at: new Date().toISOString() };
      if (table === 'production') bomFill(rec);
      rows[i] = rec; audit(table, id, 'update', old, rec);
      if (table === 'products' && (rec.ts !== old.ts || rec.equipment !== old.equipment)) for (const p of T('production')) if (p.product_code === rec.code) bomFill(p);
      if (table === 'silo_tx') { fillMeter1(old.date); fillMeter1(rec.date); }
      save();
      return clone(rec);
    },
    async remove(table, id) {
      await delay();
      const rows = T(table); const i = rows.findIndex(r => r.id === id);
      // 인수인계는 작성자 본인도 삭제 가능, 그 외는 관리자만
      // 부품의 설비별 수량은 부품 기록 권한이 있으면 삭제 가능
      if (role() !== 'admin' && !(table === 'handovers' && i >= 0 && rows[i].created_by === db.session && can('today', 'write')) && !(table === 'part_usage' && can('parts', 'write')) && !(table === 'tank_routes' && can('board', 'write')) && !(table === 'silo_tx' && can('silo', 'write'))) deny();
      if (i >= 0) {
        const gone = rows[i]; audit(table, id, 'delete', gone, null); rows.splice(i, 1); if (table === 'silo_tx') fillMeter1(gone.date);
        if (table === 'parts' || table === 'equipment') { const k = table === 'parts' ? 'part_id' : 'equipment_id'; db.t.part_usage = T('part_usage').filter(u => u[k] !== id); }
        save();
      }
    },
    async rpc(fn, a) {
      await delay();
      if (fn === 'plan_prune') { // 계획표 새 버전: 오늘 이후·입력 전·새 계획에 없는 자동 등록 기록 삭제
        if (!can('production', 'write')) throw new ApiError('생산 기록 권한이 없습니다.', 'forbidden');
        const t0 = new Date().toLocaleDateString('sv-SE'); const keep = new Set(a.p_keep || []);
        const gone = T('production').filter(r => r.plan_key && r.date >= a.p_from && r.date <= a.p_to && r.date >= t0 && !keep.has(r.plan_key) && r.juice_meter == null && r.meter2 == null && (r.meter1 == null || r.meter1_auto));
        for (const r of gone) { audit('production', r.id, 'delete', r, null); T('production').splice(T('production').indexOf(r), 1); }
        save(); return gone.length;
      }
      if (fn === 'admin_delete_part') {
        if (role() !== 'admin') throw new Error('관리자만 부품을 삭제할 수 있습니다.');
        const old = T('parts').find(x => x.id === a.p_id); if (!old) throw new Error('부품을 찾을 수 없습니다.');
        db.t.part_tx = T('part_tx').filter(x => x.part_id !== a.p_id); db.t.part_usage = T('part_usage').filter(x => x.part_id !== a.p_id);
        db.t.parts = T('parts').filter(x => x.id !== a.p_id); audit('parts', old.id, 'delete', old, null); save(); return null;
      }
      if (fn === 'touch_seen') { const p = me(); if (p) { const r = T('profiles').find(x => x.id === p.id); if (r) { r.last_seen_at = new Date().toISOString(); save(); } } return null; }
      if (fn === 'board_data') { // 착즙실 현황판: 그날 계획표 칸·생산기록·설비 상태·탱크 수동 지정
        if (!can('board', 'read')) deny();
        const d = a.p_date;
        const wp = T('weekly_plans').find(w => w.week_start <= d && w.week_end >= d);
        return clone({
          cells: (wp?.cells || []).filter(c => c.date === d),
          production: T('production').filter(r => r.date === d).map(r => ({ date: r.date, product_code: r.product_code, juice_meter: r.juice_meter })),
          equipment: T('equipment').map(e => ({ name: e.name, status: e.status })),
          products: T('products').map(x => ({ code: x.code, material: x.material })),
          routes: T('tank_routes').filter(r => r.date === d),
        });
      }
      if (fn === 'admin_delete_user') { // 사용자 계정 삭제 (관리자, 사용 중인 팀원은 먼저 정지)
        if (role() !== 'admin') deny();
        const p = T('profiles').find(x => x.id === a.p_uid);
        if (!p) return null; if (p.id === db.session) throw new ApiError('자기 계정은 지울 수 없습니다.');
        if (p.status === 'active' && !p.linked_from) throw new ApiError('사용 중인 팀원은 먼저 정지한 뒤 삭제할 수 있습니다.');
        db.t.profiles = T('profiles').filter(x => x.id !== p.id); db.users = db.users.filter(x => x.id !== p.id); save(); return null;
      }
      if (fn !== 'part_move') throw new ApiError('지원하지 않는 기능입니다.');
      if (!can('parts', 'write')) throw new ApiError('부품 기록 권한이 없습니다.', 'forbidden');
      if (a.p_client) { const ex = T('part_tx').find(t => t.client_id === a.p_client); if (ex) return clone(ex); }
      const qty = Number(a.p_qty);
      if (['입고', '사용'].includes(a.p_type) && !(qty > 0)) throw new ApiError('수량은 1 이상이어야 합니다.', 'check');
      if (a.p_type === '정정' && (!qty || !String(a.p_reason || '').trim())) throw new ApiError('정정은 변경 수량과 사유가 필요합니다.', 'check');
      const part = T('parts').find(p => p.id === a.p_part);
      if (!part) throw new ApiError('부품을 찾을 수 없습니다.');
      const delta = a.p_type === '사용' ? -qty : qty;
      if (part.stock + delta < 0) throw new ApiError(`재고가 부족합니다. (현재 ${part.stock} 개)`, 'check');
      part.stock += delta;
      const rec = { id: uid(), part_id: part.id, type: a.p_type, qty: delta, stock_after: part.stock, maintenance_id: a.p_maintenance || null, reason: a.p_reason || null, client_id: a.p_client || null, created_by: db.session, created_at: new Date().toISOString() };
      T('part_tx').push(rec); audit('part_tx', rec.id, 'insert', null, rec); save();
      return clone(rec);
    },
    async upload(bucket, file) {
      const dataUrl = await shrink(file);
      const path = uid(); (db.files ||= {})[path] = { dataUrl, name: file.name }; save();
      return path;
    },
    async fileUrl(bucket, path) { return db.files?.[path]?.dataUrl || ''; },
    async history(table, id) { await delay(); return clone(T('audit_log').filter(a => a.table_name === table && a.row_id === String(id)).reverse()); },
    resetDemo() { try { localStorage.removeItem(KEY); } catch { /* */ } db = null; load(); },
  };
}

// 데모 모드에서 사진을 작게 줄여 저장 (용량 절약)
function shrink(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new ApiError('파일을 읽지 못했습니다.'));
    fr.onload = () => {
      if (!file.type.startsWith('image/')) { if (fr.result.length > 1.5e6) return rej(new ApiError('데모 모드에서는 1MB 이하 파일만 저장할 수 있습니다.')); return res(fr.result); }
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, 900 / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => rej(new ApiError('이미지를 읽지 못했습니다.'));
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

export async function createApi() {
  return CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY ? makeSupabase() : makeDemo();
}
