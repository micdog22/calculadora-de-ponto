import {
  WORKLOAD_PRESETS, computePeriod, formatBalance, formatDuration, formatSeconds, formatBRL,
  weekDates, monthDates, weekdayName, addDays, toCSV,
} from './timesheet.js';

const STORAGE_KEY = 'calculadora-de-ponto:v1';
const $ = (id) => document.getElementById(id);
const TYPES = [['work', 'Trabalho'], ['off', 'Folga/feriado'], ['absence', 'Falta']];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let nextId = 1;
function newDay(date, extra = {}) {
  return { id: nextId++, date, type: 'work', markings: '', workload: '', ...extra };
}

function defaultState() {
  return {
    settings: { workloadChoice: '8:00', workloadCustom: '', schedule: '', hourlyRate: '', overtimePercent: '50', tolerance: true },
    days: weekDates(todayIso()).map((date) => newDay(date)),
  };
}

function load() {
  const base = defaultState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved && Array.isArray(saved.days) && saved.settings) {
      const text = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
      const s = saved.settings;
      return {
        settings: {
          workloadChoice: text(s.workloadChoice, '8:00'),
          workloadCustom: text(s.workloadCustom),
          schedule: text(s.schedule),
          hourlyRate: text(s.hourlyRate),
          overtimePercent: text(s.overtimePercent, '50'),
          tolerance: s.tolerance !== false,
        },
        days: saved.days.filter((d) => d && typeof d === 'object').map((d) => newDay(text(d.date), {
          type: TYPES.some(([value]) => value === d.type) ? d.type : 'work',
          markings: text(d.markings),
          workload: text(d.workload),
        })),
      };
    }
  } catch {
    // armazenamento indisponível ou corrompido: começa com a semana atual
  }
  return base;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: state.settings, days: state.days.map(({ id, ...rest }) => rest) }));
  } catch {
    // sem armazenamento: segue sem salvar
  }
}

let state = load();
let lastPeriod = null;

function settingsInput() {
  const s = state.settings;
  return {
    workload: s.workloadChoice === 'outra' ? s.workloadCustom : s.workloadChoice,
    tolerance: s.tolerance,
    schedule: s.schedule,
    hourlyRate: s.hourlyRate,
    overtimePercent: s.overtimePercent,
  };
}

// ---------- Configurações ----------

function setupSettings() {
  const select = $('jornada');
  for (const preset of WORKLOAD_PRESETS) select.append(el('option', { value: preset.value, text: preset.label }));
  select.append(el('option', { value: 'outra', text: 'Outra…' }));
  select.value = state.settings.workloadChoice;
  if (select.value !== state.settings.workloadChoice) select.value = '8:00';
  const showCustom = () => { $('jornada-outra-box').hidden = select.value !== 'outra'; };
  showCustom();
  select.addEventListener('change', () => {
    state.settings.workloadChoice = select.value;
    showCustom();
    changed();
  });

  const bind = (id, key) => {
    const input = $(id);
    input.value = state.settings[key];
    input.addEventListener('input', () => {
      state.settings[key] = input.value;
      changed();
    });
  };
  bind('jornada-outra', 'workloadCustom');
  bind('escala', 'schedule');
  bind('valor-hora', 'hourlyRate');
  bind('adicional', 'overtimePercent');
  const tolerance = $('tolerancia');
  tolerance.checked = state.settings.tolerance;
  tolerance.addEventListener('change', () => {
    state.settings.tolerance = tolerance.checked;
    changed();
  });
}

// ---------- Dias ----------

function selectWith(id, options, value) {
  const select = el('select', { id }, ...options.map(([v, label]) => el('option', { value: v, text: label })));
  select.value = value;
  return select;
}

function dayRow(day, i) {
  const base = `dia-${day.id}`;
  const date = el('input', { type: 'date', id: `${base}-data` });
  date.value = day.date;
  const weekday = el('span', { class: 'semana', text: weekdayName(day.date) });

  const workloadOptions = [['', 'Padrão'], ...WORKLOAD_PRESETS.map((p) => [p.value, p.value])];
  if (day.workload && !workloadOptions.some(([v]) => v === day.workload)) workloadOptions.push([day.workload, day.workload]);
  const workload = selectWith(`${base}-jornada`, workloadOptions, day.workload);
  const type = selectWith(`${base}-tipo`, TYPES, day.type);
  const markings = el('input', { id: `${base}-marcacoes`, placeholder: '08:00 12:00 13:00 17:00', autocomplete: 'off', spellcheck: 'false' });
  markings.value = day.markings;
  markings.disabled = day.type === 'absence';

  date.addEventListener('input', () => {
    day.date = date.value;
    weekday.textContent = weekdayName(day.date);
    changed();
  });
  type.addEventListener('change', () => {
    day.type = type.value;
    markings.disabled = day.type === 'absence';
    changed();
  });
  workload.addEventListener('change', () => { day.workload = workload.value; changed(); });
  markings.addEventListener('input', () => { day.markings = markings.value; changed(); });

  const remove = el('button', { type: 'button', class: 'remover', 'aria-label': `Remover dia ${i + 1}` }, '×');
  remove.addEventListener('click', () => {
    state.days = state.days.filter((d) => d !== day);
    renderDays();
    changed();
  });

  const field = (cls, label, input, extra) => el('div', { class: `campo ${cls}` }, el('label', { for: input.id, text: label }), input, extra);
  return el('fieldset', { class: 'dia' },
    el('legend', { class: 'sr-only', text: `Dia ${i + 1}` }),
    el('div', { class: 'dia-campos' },
      field('campo-data', 'Data', date, weekday),
      field('campo-tipo', 'Situação', type),
      field('campo-jornada', 'Jornada', workload),
      field('campo-marcacoes', 'Marcações', markings),
      remove),
    el('div', { class: 'dia-resultado', id: `${base}-resultado` }));
}

function renderDays() {
  const box = $('dias');
  if (!state.days.length) {
    box.replaceChildren(el('p', { class: 'muted', text: 'Nenhum dia na lista. Use os botões acima ou adicione um dia.' }));
    return;
  }
  box.replaceChildren(...state.days.map(dayRow));
}

// ---------- Resultado ----------

const balanceClass = (minutes) => (minutes > 0 ? 'positivo' : minutes < 0 ? 'negativo' : 'zero');

function renderDayResult(day, r) {
  const box = $(`dia-${day.id}-resultado`);
  if (!box) return;
  if (r.status === 'error') {
    box.replaceChildren(el('p', { class: 'erro', text: r.errors.join(' ') }));
    return;
  }
  if (r.status === 'empty') {
    box.replaceChildren(el('p', { class: 'muted', text: r.notes.join(' ') }));
    return;
  }
  const line = el('p', { class: 'linha' },
    `Jornada ${formatDuration(r.expected)} · Trabalhado `, el('strong', { text: formatDuration(r.worked) }),
    ' · Saldo ', el('strong', { class: balanceClass(r.balance), text: formatBalance(r.balance) }));
  if (r.night) line.append(` · Noturno ${formatDuration(r.night)} (${formatSeconds(r.nightReducedSeconds)} em hora reduzida)`);
  box.replaceChildren(line, r.notes.length ? el('p', { class: 'notas', text: r.notes.join(' ') }) : '');
}

function renderSummary(period) {
  const t = period.totals;
  $('exportar').disabled = !t.days;
  if (!t.days) {
    $('resumo').replaceChildren(el('p', { class: 'muted', text: 'Preencha as marcações de pelo menos um dia para ver o resumo.' }));
    return;
  }
  const rows = [
    ['Dias calculados', String(t.days)],
    ['Horas trabalhadas', formatDuration(t.worked)],
    ['Jornada prevista', formatDuration(t.expected)],
    ['Horas extras (dias com saldo positivo)', formatBalance(t.extras)],
    ['Débitos (dias com saldo negativo)', formatBalance(t.debits)],
  ];
  if (t.night) rows.push(['Trabalho noturno (22h às 5h)', `${formatDuration(t.night)} de relógio = ${formatSeconds(t.nightReducedSeconds)} em hora noturna reduzida`]);
  if (t.extrasValueCents !== null) {
    const pct = `${String(period.settings.overtimeBp / 100).replace('.', ',')}%`;
    rows.push([`Valor das horas extras (adicional de ${pct})`, formatBRL(t.extrasValueCents)]);
    if (t.balance > 0) rows.push(['Valor do saldo do período, se for pago', formatBRL(t.balanceValueCents)]);
  }
  const list = el('dl', { class: 'totais' });
  for (const [term, value] of rows) list.append(el('dt', { text: term }), el('dd', { text: value }));
  $('resumo').replaceChildren(
    el('p', { class: 'saldo-total' }, 'Banco de horas: ', el('strong', { class: balanceClass(t.balance), text: formatBalance(t.balance) })),
    list);
}

function update() {
  const period = computePeriod(state.days, settingsInput());
  lastPeriod = period;
  $('avisos-jornada').replaceChildren(...[...period.errors, ...period.warnings].map((text) => el('li', { text })));
  if (period.errors.length) {
    for (const day of state.days) $(`dia-${day.id}-resultado`)?.replaceChildren();
    $('resumo').replaceChildren(el('p', { class: 'erro', text: 'Corrija a jornada acima para ver os cálculos.' }));
    $('exportar').disabled = true;
    return;
  }
  period.results.forEach((r, i) => renderDayResult(state.days[i], r));
  renderSummary(period);
}

function changed() {
  save();
  update();
}

// ---------- Período, exemplo e exportação ----------

const pending = new Map();
function confirmReplace(button, message) {
  const hasData = state.days.some((d) => d.markings.trim() || d.type !== 'work');
  if (!hasData || pending.get(button)) {
    clearTimeout(pending.get(button));
    pending.delete(button);
    $('aviso-periodo').textContent = '';
    return true;
  }
  $('aviso-periodo').textContent = message;
  pending.set(button, setTimeout(() => { pending.delete(button); $('aviso-periodo').textContent = ''; }, 5000));
  return false;
}

function replaceDays(days) {
  state.days = days;
  renderDays();
  changed();
}

$('semana').addEventListener('click', (event) => {
  if (!confirmReplace(event.currentTarget, 'Isso troca a lista pelos dias da semana atual e apaga as marcações. Clique de novo em “Semana atual” para confirmar.')) return;
  replaceDays(weekDates(todayIso()).map((date) => newDay(date)));
});

$('mes').addEventListener('click', (event) => {
  if (!confirmReplace(event.currentTarget, 'Isso troca a lista pelos dias úteis do mês atual e apaga as marcações. Clique de novo em “Mês atual” para confirmar.')) return;
  replaceDays(monthDates(todayIso()).map((date) => newDay(date)));
});

$('exemplo').addEventListener('click', (event) => {
  if (!confirmReplace(event.currentTarget, 'Isso troca a lista por uma semana de exemplo. Clique de novo em “Carregar um exemplo” para confirmar.')) return;
  const sample = ['08:02 12:00 13:01 17:05', '07:58 12:00 13:00 18:30', '08:15 12:00 13:00 17:00', '08:00 12:00 13:00 17:00', '08:00 12:00 13:00 17:00 19:00 23:00'];
  replaceDays(weekDates(todayIso()).map((date, i) => newDay(date, { markings: sample[i] })));
});

$('add-dia').addEventListener('click', () => {
  const last = state.days[state.days.length - 1];
  const day = newDay(last?.date ? addDays(last.date, 1) : todayIso());
  state.days.push(day);
  renderDays();
  changed();
  $(`dia-${day.id}-marcacoes`)?.focus();
});

$('exportar').addEventListener('click', () => {
  if (!lastPeriod || lastPeriod.errors.length) return;
  const url = URL.createObjectURL(new Blob(['\ufeff', toCSV(state.days, lastPeriod)], { type: 'text/csv;charset=utf-8' }));
  const link = el('a', { href: url, download: 'ponto.csv' });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

setupSettings();
renderDays();
update();
