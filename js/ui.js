// 화면 공통 도구: 요소 생성, 포맷, 토스트, 모달, 폼, 표
import { uid } from './api.js';

// ---------------------------------------------------------------- DOM
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  if (tag === 'input' && ['date', 'datetime-local'].includes(el.getAttribute('type'))) return dateBox(el);
  return el;
}
// 날짜 칸: 브라우저 기본 표시 대신 "2026-10-24(토)" 로 보여주고, 누르면 달력이 열림
const WDAY = ['일', '월', '화', '수', '목', '금', '토'];
function dateBox(input) {
  const label = document.createElement('span');
  label.className = 'date-label';
  const sync = () => {
    const v = input.value;
    const m = v.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
    const d = m ? new Date(m[1] + 'T00:00:00') : null;
    label.textContent = d && !isNaN(d) ? `${m[1]}(${WDAY[d.getDay()]})${m[2] ? ' ' + m[2] : ''}` : (input.type === 'datetime-local' || input.getAttribute('type') === 'datetime-local' ? '날짜·시각 선택' : '날짜 선택');
    label.classList.toggle('empty', !d);
  };
  input.addEventListener('input', sync);
  input.addEventListener('change', sync);
  input.addEventListener('click', () => { try { input.showPicker?.(); } catch { /* 일부 브라우저는 지원 안 함 */ } });
  const box = document.createElement('span');
  box.className = 'date-box';
  if (input.style.width) { box.style.width = input.style.width; input.style.width = ''; }
  box.append(input, label);
  sync();
  return box;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const clear = (el, ...kids) => { el.replaceChildren(); append(el, kids); return el; };

const ICONS = {
  today: 'M3 10h18M8 3v4M16 3v4M5 6h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  prod: 'M4 20V9l5 3V9l5 3V5l6 4v11zM4 20h16',
  silo: 'M6 6c0-1.7 2.7-3 6-3s6 1.3 6 3v12c0 1.7-2.7 3-6 3s-6-1.3-6-3zM6 6c0 1.7 2.7 3 6 3s6-1.3 6-3M6 12c0 1.7 2.7 3 6 3s6-1.3 6-3',
  wrench: 'M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3-3 8-8-1.3-1.3a4 4 0 0 1-5-5L13 2l-2.6 2.6a4 4 0 0 0 4.3 1.7zM3 21l4-4',
  box: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  doc: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h8',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.3 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.3l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1A2 2 0 1 1 19.7 7l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
  left: 'M15 18l-6-6 6-6', right: 'M9 18l6-6-6-6', x: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5', cip: 'M12 2.7l5.7 5.7a8 8 0 1 1-11.4 0z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  cal: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01',
  cog: 'M3 7h18M3 12h18M3 17h18',
};
export function icon(name, cls = 'ico') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', name === 'more' ? '3' : '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONS[name] || ''); s.append(p);
  return s;
}

// ---------------------------------------------------------------- 날짜·숫자
export const today = () => new Date().toLocaleDateString('sv-SE');
export const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toLocaleDateString('sv-SE'); };
export const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const fmtDate = d => { if (!d) return ''; const x = new Date(String(d).length <= 10 ? d + 'T00:00:00' : d); return `${x.getMonth() + 1}/${x.getDate()} (${WD[x.getDay()]})`; };
export const fmtDateLong = d => { const x = new Date(d + 'T00:00:00'); return `${x.getFullYear()}년 ${x.getMonth() + 1}월 ${x.getDate()}일 (${WD[x.getDay()]})`; };
export const fmtDT = d => { if (!d) return ''; const x = new Date(d); return `${x.getMonth() + 1}/${x.getDate()} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`; };
export const fmtFull = d => d ? new Date(d).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '';
export const n0 = v => v == null || v === '' || isNaN(v) ? '' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 0 });
export const n1 = v => v == null || v === '' || isNaN(v) ? '' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
export const n2 = v => v == null || v === '' || isNaN(v) ? '' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
export const pct = (v, d = 0) => v == null || !isFinite(v) ? '' : `${Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
export const weekStart = d => { const x = new Date(d + 'T00:00:00'); const w = (x.getDay() + 6) % 7; x.setDate(x.getDate() - w); return x.toLocaleDateString('sv-SE'); };
export const toLocalInput = iso => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
export const nowLocal = () => toLocalInput(new Date().toISOString());

// ---------------------------------------------------------------- 토스트
export function toast(msg, type = '') {
  const t = h('div', { class: `toast ${type}` }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), type === 'err' ? 5000 : 2600);
}

// ---------------------------------------------------------------- 모달 / 드로어
export function panel({ title, body, foot, center = false, onClose }) {
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = e => { if (e.key === 'Escape') close(); };
  const ov = h('div', { class: 'overlay' + (center ? ' center' : ''), onmousedown: e => { if (e.target === ov) close(); } },
    h('div', { class: 'panel', role: 'dialog', 'aria-label': title },
      h('div', { class: 'panel-h' }, h('h3', title), h('button', { class: 'icon-btn', 'aria-label': '닫기', onclick: close }, icon('x'))),
      h('div', { class: 'panel-b' }, body),
      foot ? h('div', { class: 'panel-f' }, foot) : null));
  document.addEventListener('keydown', esc);
  document.body.append(ov);
  return { close, el: ov, body: ov.querySelector('.panel-b'), foot: ov.querySelector('.panel-f') };
}

export function confirmDlg(title, msg, okLabel = '확인', danger = false) {
  return new Promise(res => {
    let done = false;
    const p = panel({
      title, center: true, body: h('div', msg),
      foot: [h('button', { class: 'btn', onclick: () => { done = true; p.close(); res(false); } }, '취소'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { done = true; p.close(); res(true); } }, okLabel)],
      onClose: () => { if (!done) res(false); },
    });
  });
}

export function promptDlg(title, label, { type = 'text', options, required = true, value = '' } = {}) {
  return new Promise(res => {
    let done = false;
    const input = options
      ? h('select', { class: 'input' }, h('option', { value: '' }, '선택하세요'), options.map(o => h('option', { value: o, selected: o === value }, o)))
      : type === 'textarea' ? h('textarea', { class: 'input' }, value) : h('input', { class: 'input', type, value });
    const err = h('div', { class: 'form-error hidden' }, '값을 입력해 주세요.');
    const ok = () => { if (required && !input.value.trim()) { err.classList.remove('hidden'); return; } done = true; p.close(); res(input.value.trim()); };
    const p = panel({
      title, center: true, body: [h('div', { class: 'field' }, h('label', label), input), err],
      foot: [h('button', { class: 'btn', onclick: () => p.close() }, '취소'), h('button', { class: 'btn primary', onclick: ok }, '확인')],
      onClose: () => { if (!done) res(null); },
    });
    setTimeout(() => input.focus(), 50);
  });
}

// ---------------------------------------------------------------- 최근 입력값
const RECENT = 'jp_recent_v1';
export function recentValues(key) { try { return JSON.parse(localStorage.getItem(RECENT) || '{}')[key] || []; } catch { return []; } }
function pushRecent(key, v) {
  if (!v) return;
  try {
    const all = JSON.parse(localStorage.getItem(RECENT) || '{}');
    all[key] = [v, ...(all[key] || []).filter(x => x !== v)].slice(0, 8);
    localStorage.setItem(RECENT, JSON.stringify(all));
  } catch { /* 저장 불가 환경 */ }
}

// ---------------------------------------------------------------- 폼
// field: {k, label, type, req, opts, unit, ph, help, full, recent, step, show(values), readonly}
// types: text number date datetime select chips textarea check photos file custom
export function buildForm(fields, values, ctx = {}) {
  const root = h('div', { class: 'form-grid' });
  const getters = {}, errs = {}, wraps = {};
  const state = { ...values };
  const onChange = () => { for (const f of fields) if (f.show) wraps[f.k]?.classList.toggle('hidden', !f.show(collect())); ctx.onChange?.(collect()); };
  const collect = () => { const o = { ...state }; for (const k in getters) o[k] = getters[k](); return o; };

  for (const f of fields) {
    const v = values[f.k];
    let ctrl;
    const id = 'f_' + f.k + '_' + Math.random().toString(36).slice(2, 6);
    const opts = typeof f.opts === 'function' ? f.opts(values) : f.opts || [];
    const norm = o => (typeof o === 'object' ? o : { value: o, label: String(o) });
    switch (f.type) {
      case 'textarea':
        ctrl = h('textarea', { class: 'input', id, placeholder: f.ph || '', oninput: onChange }, v ?? '');
        getters[f.k] = () => ctrl.value.trim() || null; break;
      case 'select': {
        ctrl = h('select', { class: 'input', id, onchange: onChange },
          h('option', { value: '' }, f.ph || '선택하세요'),
          opts.map(norm).map(o => o.group ? h('optgroup', { label: o.group }, o.items.map(norm).map(i => h('option', { value: i.value, selected: String(i.value) === String(v ?? '') }, i.label)))
            : h('option', { value: o.value, selected: String(o.value) === String(v ?? '') }, o.label)));
        getters[f.k] = () => { const x = ctrl.value; return x === '' ? null : f.numeric ? Number(x) : x; }; break;
      }
      case 'chips': {
        let cur = f.multi ? (Array.isArray(v) ? [...v] : []) : v ?? null;
        const items = opts.map(norm);
        ctrl = h('div', { class: 'chips', id });
        const draw = () => clear(ctrl, items.map(o => h('button', {
          type: 'button', class: 'chip' + ((f.multi ? cur.includes(o.value) : String(cur) === String(o.value)) ? ' on' : ''),
          onclick: () => {
            if (f.multi) cur = cur.includes(o.value) ? cur.filter(x => x !== o.value) : [...cur, o.value];
            else cur = String(cur) === String(o.value) && !f.req ? null : o.value;
            draw(); onChange();
          },
        }, o.label)));
        draw();
        getters[f.k] = () => cur; break;
      }
      case 'check':
        ctrl = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!v, onchange: onChange }), f.checkLabel || f.label);
        getters[f.k] = () => ctrl.querySelector('input').checked; break;
      case 'photos': {
        let list = Array.isArray(v) ? [...v] : [];
        const wrap = h('div', { class: 'thumbs', id });
        const fileIn = h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, class: 'hidden', onchange: async () => {
          for (const file of fileIn.files) {
            const ph = h('div', { class: 'add' }, '올리는 중…'); wrap.insertBefore(ph, wrap.lastChild);
            try { list.push(await ctx.api.upload('photos', file)); } catch (e) { toast(e.message, 'err'); }
            ph.remove();
          }
          fileIn.value = ''; draw();
        } });
        const draw = async () => {
          clear(wrap);
          for (const p of list) {
            const img = h('img', { alt: '사진' });
            ctx.api.fileUrl('photos', p).then(u => { img.src = u; }).catch(() => {});
            wrap.append(h('div', { class: 'rm' }, img, h('button', { type: 'button', 'aria-label': '사진 삭제', onclick: () => { list = list.filter(x => x !== p); draw(); } }, '×')));
          }
          wrap.append(h('div', { class: 'add', onclick: () => fileIn.click() }, '+ 사진', h('br'), '촬영·선택'));
        };
        draw(); ctrl = h('div', wrap, fileIn);
        getters[f.k] = () => list; break;
      }
      case 'file': {
        let cur = v ? { path: v, name: values[f.nameKey] } : null;
        const label = h('span', { class: 'small muted' });
        const fileIn = h('input', { type: 'file', class: 'input', onchange: async () => {
          const file = fileIn.files[0]; if (!file) return;
          label.textContent = '올리는 중…';
          try { cur = { path: await ctx.api.upload(f.bucket || 'docs', file), name: file.name }; label.textContent = '✓ ' + file.name; }
          catch (e) { label.textContent = ''; toast(e.message, 'err'); }
        } });
        if (cur) label.textContent = '현재 파일: ' + (cur.name || '첨부됨');
        ctrl = h('div', fileIn, label);
        getters[f.k] = () => cur?.path || null;
        if (f.nameKey) getters[f.nameKey] = () => cur?.name || null;
        break;
      }
      case 'custom':
        ctrl = f.render(v, values, onChange);
        getters[f.k] = () => ctrl._value(); break;
      default: {
        const type = f.type === 'datetime' ? 'datetime-local' : f.type || 'text';
        const val = f.type === 'datetime' ? toLocalInput(v) : v ?? '';
        const listId = f.recent ? id + '_l' : null;
        ctrl = h('input', { class: 'input', id, type, value: val, placeholder: f.ph || '', step: f.step || (type === 'number' ? 'any' : null), inputmode: type === 'number' ? 'decimal' : null, list: listId, oninput: onChange, readOnly: !!f.readonly });
        if (f.recent || f.suggest) {
          const sugg = [...new Set([...(f.suggest ? f.suggest(values) : []), ...recentValues(f.recentKey || f.k)])];
          ctrl = h('div', ctrl, h('datalist', { id: listId }, sugg.map(s => h('option', { value: s }))));
          ctrl.querySelector('input').setAttribute('list', listId);
        }
        if (f.unit) ctrl = h('div', { class: 'with-unit' }, ctrl, h('span', { class: 'unit' }, f.unit));
        const inp = ctrl.tagName === 'INPUT' ? ctrl : ctrl.querySelector('input');
        getters[f.k] = () => {
          const x = inp.value.trim();
          if (x === '') return null;
          if (type === 'number') return Number(x);
          if (f.type === 'datetime') return new Date(x).toISOString();
          return x;
        };
      }
    }
    const err = h('div', { class: 'help', style: { color: 'var(--bad)' } });
    errs[f.k] = err;
    const w = f.type === 'check' && !f.labelAbove
      ? h('div', { class: 'field' + (f.full ? ' full' : '') }, ctrl, f.help ? h('div', { class: 'help' }, f.help) : null, err)
      : h('div', { class: 'field' + (f.full || ['textarea', 'photos', 'chips', 'custom'].includes(f.type) ? ' full' : '') },
        h('label', { for: id }, f.label, f.req ? h('span', { class: 'req' }, '*') : null), ctrl, f.help ? h('div', { class: 'help' }, f.help) : null, err);
    wraps[f.k] = w;
    root.append(w);
  }
  onChange();
  const validate = () => {
    const vals = collect(); let ok = true;
    for (const f of fields) {
      errs[f.k].textContent = '';
      if (f.show && !f.show(vals)) continue;
      const x = vals[f.k];
      const empty = x == null || x === '' || (Array.isArray(x) && !x.length);
      if (f.req && empty) { errs[f.k].textContent = `${f.label}을(를) 입력해 주세요.`; ok = false; }
      else if (!empty && f.type === 'number' && (isNaN(x) || (f.min != null && x < f.min))) { errs[f.k].textContent = f.min != null ? `${f.min} 이상의 숫자를 입력해 주세요.` : '숫자를 입력해 주세요.'; ok = false; }
      else if (f.check) { const m = f.check(x, vals); if (m) { errs[f.k].textContent = m; ok = false; } }
    }
    if (!ok) root.querySelector('.help:not(:empty)')?.closest('.field')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return ok;
  };
  const remember = vals => { for (const f of fields) if (f.recent && typeof vals[f.k] === 'string') pushRecent(f.recentKey || f.k, vals[f.k]); };
  return { el: root, collect, validate, remember, refresh: onChange };
}

// 저장 실패 시 입력 유지 + 재시도, 같은 요청은 client_id 로 중복 저장 방지
export function openForm({ title, fields, values = {}, onSave, draftKey, note, extra, saveLabel = '저장', onChange, api, after, doneMsg }) {
  const client_id = uid();
  let draft = null;
  if (draftKey) { try { draft = JSON.parse(sessionStorage.getItem('draft:' + draftKey)); } catch { /* */ } }
  const initial = draft ? { ...values, ...draft } : values;
  const calcBox = h('div');
  const form = buildForm(fields, initial, { api, onChange: v => { onChange?.(v, calcBox); if (draftKey) { try { sessionStorage.setItem('draft:' + draftKey, JSON.stringify(v)); } catch { /* */ } } } });
  const errBox = h('div', { class: 'form-error hidden' });
  const btn = h('button', { class: 'btn primary', onclick: () => submit() }, saveLabel);
  const p = panel({
    title,
    body: [
      draft ? h('div', { class: 'form-note' }, '작성 중이던 내용을 불러왔습니다. ', h('a', { href: '#', onclick: e => { e.preventDefault(); try { sessionStorage.removeItem('draft:' + draftKey); } catch { /* */ } p.close(); openForm(arguments[0]); } }, '새로 쓰기')) : null,
      note ? h('div', { class: 'form-note' }, note) : null,
      form.el, calcBox, extra || null, errBox,
    ],
    foot: [h('button', { class: 'btn', onclick: () => p.close() }, '취소'), btn],
  });
  onChange?.(form.collect(), calcBox);
  async function submit() {
    if (!form.validate()) return;
    const vals = form.collect();
    btn.disabled = true; btn.textContent = '저장 중…'; errBox.classList.add('hidden');
    try {
      await onSave(vals, { client_id });
      form.remember(vals);
      if (draftKey) { try { sessionStorage.removeItem('draft:' + draftKey); } catch { /* */ } }
      p.close(); toast((doneMsg && doneMsg(vals)) || '저장했습니다.', 'ok'); after?.();
    } catch (e) {
      clear(errBox, h('span', '저장하지 못했습니다: ' + (e.message || e)), h('button', { class: 'btn sm', onclick: submit }, '다시 시도'));
      errBox.classList.remove('hidden'); errBox.scrollIntoView({ block: 'nearest' });
    } finally { btn.disabled = false; btn.textContent = saveLabel; }
  }
  return p;
}

// ---------------------------------------------------------------- 표
// cols: {label, v(row)→Node|string, cls, lead}
export function table(rows, cols, { onRow, empty = '기록이 없습니다.', emptyAction, foot, cards = true } = {}) {
  if (!rows.length) return h('div', { class: 'empty' }, empty, emptyAction ? h('div', emptyAction) : null);
  return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' + (cards ? ' cards' : '') },
    h('thead', h('tr', cols.map(c => h('th', { class: c.cls || '' }, c.label)))),
    h('tbody', rows.map(r => h('tr', { class: (onRow ? 'click ' : '') + (r.is_sample ? 'row-sample' : ''), onclick: onRow ? () => onRow(r) : null },
      cols.map(c => { const v = c.v(r); return h('td', { class: (c.cls || '') + (c.lead ? ' lead' : ''), 'data-label': c.label }, v ?? ''); })))),
    foot ? h('tfoot', h('tr', cols.map((c, i) => h('td', { class: c.cls || '', 'data-label': c.label }, foot[i] ?? '')))) : null));
}

export const badge = (text, kind = '') => h('span', { class: 'badge ' + (kind ? 'b-' + kind : '') }, text);
export const sampleBadge = r => (r?.is_sample ? badge('예시', 'sample') : null);
export const loading = (t = '불러오는 중…') => h('div', { class: 'loading' }, t);
export function card(title, body, actions) {
  return h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', title), h('span', { class: 'spacer' }), actions || null), h('div', { class: 'card-b' }, body));
}
export function chipsFilter(options, cur, onPick) {
  return h('div', { class: 'chips' }, options.map(o => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return h('button', { class: 'chip sm' + (cur === v ? ' on' : ''), onclick: () => onPick(v) }, l);
  }));
}

// 간단한 막대/선 그래프 (SVG)
export function barChart(data, { unit = '', color = 'var(--brand-2)', height = 180, fmt = n0, series, int = false } = {}) {
  const W = 640, H = height, P = { l: 52, r: 8, t: 12, b: 28 };
  const ser = series || [{ key: 'v', color }];
  const raw = Math.max(1, ...data.flatMap(d => ser.map(s => d[s.key] || 0)));
  const max = int ? Math.max(4, Math.ceil(raw * 1.05 / 4) * 4) : raw * 1.1; // int: 눈금을 정수로
  const bw = (W - P.l - P.r) / Math.max(1, data.length);
  const sw = Math.min(28, bw * .7 / ser.length);
  const y = v => P.t + (H - P.t - P.b) * (1 - v / max);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= 4; i++) { const v = max / 4 * i, yy = y(v); s += `<line x1="${P.l}" x2="${W - P.r}" y1="${yy}" y2="${yy}" class="axis" stroke-dasharray="${i ? '2 3' : ''}"/><text x="${P.l - 6}" y="${yy + 4}" text-anchor="end">${fmt(v)}</text>`; }
  data.forEach((d, i) => {
    const cx = P.l + bw * i + bw / 2;
    ser.forEach((sr, j) => {
      const v = d[sr.key] || 0, x = cx - (sw * ser.length) / 2 + sw * j;
      s += `<rect x="${x}" y="${y(v)}" width="${sw - 2}" height="${Math.max(0, H - P.b - y(v))}" rx="3" fill="${sr.color}"><title>${esc(d.label)} ${esc(sr.name || '')}: ${fmt(v)}${unit}</title></rect>`;
    });
    if (data.length <= 16 || i % Math.ceil(data.length / 12) === 0) s += `<text x="${cx}" y="${H - 9}" text-anchor="middle">${esc(d.label)}</text>`;
  });
  return h('div', { class: 'chart', html: s + '</svg>' });
}
export function lineChart(points, { unit = '', min, max, height = 180, band, fmt = n2, color = 'var(--brand-2)' } = {}) {
  const W = 640, H = height, P = { l: 46, r: 10, t: 12, b: 28 };
  if (!points.length) return h('div', { class: 'empty' }, '데이터가 없습니다.');
  const vs = points.map(p => p.v);
  const lo = min ?? Math.min(...vs) * 0.98, hi = max ?? Math.max(...vs) * 1.02;
  const x = i => P.l + (W - P.l - P.r) * (points.length === 1 ? .5 : i / (points.length - 1));
  const y = v => P.t + (H - P.t - P.b) * (1 - (v - lo) / ((hi - lo) || 1));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) / 4 * i, yy = y(v); s += `<line x1="${P.l}" x2="${W - P.r}" y1="${yy}" y2="${yy}" class="axis" stroke-dasharray="${i ? '2 3' : ''}"/><text x="${P.l - 6}" y="${yy + 4}" text-anchor="end">${fmt(v)}</text>`; }
  if (band) s += `<rect x="${P.l}" width="${W - P.l - P.r}" y="${y(band[1])}" height="${Math.max(0, y(band[0]) - y(band[1]))}" fill="var(--ok-soft)" opacity=".7"/>`;
  s += `<polyline fill="none" stroke="${color}" stroke-width="2" points="${points.map((p, i) => `${x(i)},${y(p.v)}`).join(' ')}"/>`;
  points.forEach((p, i) => {
    s += `<circle cx="${x(i)}" cy="${y(p.v)}" r="3.2" fill="${color}"><title>${esc(p.label)}: ${fmt(p.v)}${unit}</title></circle>`;
    if (points.length <= 14 || i % Math.ceil(points.length / 10) === 0) s += `<text x="${x(i)}" y="${H - 9}" text-anchor="middle">${esc(p.label)}</text>`;
  });
  return h('div', { class: 'chart', html: s + '</svg>' });
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
