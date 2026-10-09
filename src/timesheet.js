// Cálculo de ponto: horas trabalhadas, saldo do dia, banco de horas, tolerância da CLT
// (art. 58, § 1º, e Súmula 366 do TST) e trabalho noturno urbano (art. 73). Módulo puro, sem DOM.

export const WORKLOAD_PRESETS = Object.freeze([
  { value: '8:00', label: '8:00' },
  { value: '8:48', label: '8:48 (44 horas em 5 dias)' },
  { value: '6:00', label: '6:00' },
  { value: '4:00', label: '4:00' },
]);

export const TOLERANCE_PER_MARK = 5; // minutos por marcação
export const TOLERANCE_PER_DAY = 10; // minutos no dia
const DAY = 1440;
const NIGHT_START = 22 * 60; // 22:00
const NIGHT_END = 5 * 60; // 05:00

// ---------- Horários ----------

/** Horário em minutos desde 00:00. Aceita "8", "8:00", "08:00", "0800", "800", "8h", "8h30" e "24:00". */
export function parseTime(text) {
  const s = String(text ?? '').trim().toLowerCase();
  if (s === '') return null;
  let m = /^(\d{1,2})(?::|h)(\d{2})$/.exec(s) ?? /^(\d{1,2})(\d{2})$/.exec(s);
  let hours;
  let minutes;
  if (m) {
    hours = Number(m[1]);
    minutes = Number(m[2]);
  } else if ((m = /^(\d{1,2})h?$/.exec(s))) {
    hours = Number(m[1]);
    minutes = 0;
  } else {
    return NaN;
  }
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes > 0)) return NaN;
  return hours * 60 + minutes;
}

export function formatClock(minutes) {
  const m = minutes === DAY ? DAY : ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Duração sem sinal: 528 → "8h48". */
export function formatDuration(minutes) {
  const abs = Math.abs(minutes);
  return `${Math.floor(abs / 60)}h${String(abs % 60).padStart(2, '0')}`;
}

/** Saldo com sinal: +83 → "+1h23", −15 → "−0h15", 0 → "0h00". */
export function formatBalance(minutes) {
  if (minutes === 0) return '0h00';
  return `${minutes > 0 ? '+' : '−'}${formatDuration(minutes)}`;
}

/** Tempo em segundos, mostrando os segundos só quando existem: 28800 → "8h00", 6171 → "1h42min51s". */
export function formatSeconds(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return s ? `${h}h${String(m).padStart(2, '0')}min${String(s).padStart(2, '0')}s` : `${h}h${String(m).padStart(2, '0')}`;
}

export function formatBRL(cents) {
  const reais = String(Math.floor(Math.abs(cents) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cents < 0 ? '−' : ''}R$ ${reais},${String(Math.abs(cents) % 100).padStart(2, '0')}`;
}

const SEPARATORS = /[\s,;/–—-]+/;
const FILLER_WORDS = new Set(['a', 'as', 'às', 'e', 'até']);

/**
 * Lê as marcações do dia em ordem (entrada, saída, entrada, saída…). Quando um horário é menor
 * que o anterior, a jornada passou da meia-noite. Devolve os horários em minutos numa linha do
 * tempo contínua (podem passar de 1440) e os pares entrada/saída.
 */
export function parseMarkings(text) {
  const tokens = String(text ?? '').trim().split(SEPARATORS).filter((t) => t && !FILLER_WORDS.has(t.toLowerCase()));
  const errors = [];
  const clock = [];
  for (const token of tokens) {
    const t = parseTime(token);
    if (Number.isNaN(t)) errors.push(`Não entendi o horário “${token}”: use, por exemplo, 08:00, 8 ou 0800.`);
    else clock.push(t);
  }
  if (!errors.length && clock.length % 2 !== 0) {
    errors.push('Número ímpar de marcações: falta a saída (ou a entrada) de algum período.');
  }
  if (errors.length) return { clock, times: [], pairs: [], errors };

  const times = [];
  let offset = 0;
  for (const t of clock) {
    let abs = t + offset;
    if (times.length && abs < times[times.length - 1]) {
      offset += DAY;
      abs += DAY;
    }
    times.push(abs);
  }
  if (times.length && times[times.length - 1] - times[0] > DAY) {
    errors.push('Da primeira à última marcação passam mais de 24 horas: confira a ordem dos horários.');
  }
  const pairs = [];
  for (let i = 0; i < times.length; i += 2) {
    if (times[i] === times[i + 1]) errors.push(`Entrada e saída no mesmo horário (${formatClock(clock[i])}).`);
    pairs.push([times[i], times[i + 1]]);
  }
  return { clock, times, pairs, errors };
}

/** Minutos trabalhados entre 22:00 e 05:00 (trabalhador urbano, CLT art. 73). */
export function nightMinutes(pairs) {
  let total = 0;
  for (const [start, end] of pairs) {
    for (let d = -1; d <= 2; d++) {
      const windowStart = d * DAY + NIGHT_START;
      const windowEnd = (d + 1) * DAY + NIGHT_END;
      total += Math.max(0, Math.min(end, windowEnd) - Math.max(start, windowStart));
    }
  }
  return total;
}

/** Minutos noturnos reais convertidos em hora noturna reduzida (52min30s = 1 hora), em segundos. */
export function reducedNightSeconds(minutes) {
  return Math.round((minutes * 60 * 60) / 52.5);
}

function circularDiff(a, b) {
  const d = Math.abs(a - b) % DAY;
  return Math.min(d, DAY - d);
}

// ---------- Configurações ----------

function parseMoney(text) {
  const s = String(text ?? '').replace(/R\$/gi, '').replace(/\s/g, '');
  if (s === '') return null;
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(s) ?? /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return NaN;
  return Number(m[1].replace(/\./g, '')) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

function parsePercent(text) {
  const s = String(text ?? '').replace('%', '').trim().replace(',', '.');
  if (s === '') return null;
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s);
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : NaN;
}

/**
 * input: { workload, tolerance, schedule, hourlyRate, overtimePercent } (textos como digitados).
 * schedule: horário contratual opcional, no mesmo formato das marcações ("08:00 12:00 13:00 17:00").
 */
export function readSettings(input = {}) {
  const errors = [];
  const warnings = [];
  const workload = parseTime(input.workload ?? '8:00');
  if (workload === null || Number.isNaN(workload)) errors.push('Jornada diária inválida: use horas e minutos, por exemplo, 8:00.');

  let scheduleClock = null;
  let scheduleMinutes = null;
  if (String(input.schedule ?? '').trim()) {
    const parsed = parseMarkings(input.schedule);
    if (parsed.errors.length) {
      errors.push(`Horário contratual: ${parsed.errors[0]}`);
    } else {
      scheduleClock = parsed.clock;
      scheduleMinutes = parsed.pairs.reduce((sum, [s, e]) => sum + (e - s), 0);
      if (Number.isFinite(workload) && scheduleMinutes !== workload) {
        warnings.push(`O horário contratual soma ${formatDuration(scheduleMinutes)}, diferente da jornada diária de ${formatDuration(workload)}.`);
      }
    }
  }

  const rateCents = parseMoney(input.hourlyRate);
  if (Number.isNaN(rateCents)) errors.push('Valor da hora inválido: use, por exemplo, 25,50.');
  const overtimeBp = parsePercent(input.overtimePercent) ?? 5000;
  if (Number.isNaN(overtimeBp) || overtimeBp > 30000) errors.push('Adicional de hora extra inválido: use uma porcentagem, por exemplo, 50.');

  return {
    errors,
    warnings,
    workload,
    tolerance: input.tolerance !== false,
    scheduleClock,
    scheduleMinutes,
    rateCents,
    overtimeBp,
  };
}

// ---------- Dia e período ----------

/**
 * day: { date, type: 'work' | 'off' | 'absence', markings, workload } — workload vazio usa a jornada padrão;
 * 'off' = folga ou feriado (jornada 0, todo o tempo trabalhado é extra); 'absence' = falta (saldo = −jornada).
 */
export function computeDay(day, settings) {
  const type = ['off', 'absence'].includes(day.type) ? day.type : 'work';
  const base = { type, worked: 0, expected: 0, rawBalance: 0, balance: 0, night: 0, nightReducedSeconds: 0, pairs: [], notes: [], errors: [] };

  let expected = settings.workload;
  if (String(day.workload ?? '').trim()) {
    const own = parseTime(day.workload);
    if (own === null || Number.isNaN(own)) return { ...base, status: 'error', errors: ['Jornada do dia inválida: use, por exemplo, 8:00.'] };
    expected = own;
  }
  if (type === 'off') expected = 0;

  if (type === 'absence') {
    return { ...base, status: 'ok', expected, rawBalance: -expected, balance: -expected, notes: ['Falta: o dia inteiro entra como débito.'] };
  }

  const parsed = parseMarkings(day.markings);
  if (parsed.errors.length) return { ...base, status: 'error', errors: parsed.errors };
  if (parsed.pairs.length === 0) {
    return type === 'off'
      ? { ...base, status: 'ok', notes: ['Folga sem marcações.'] }
      : { ...base, status: 'empty', expected, notes: ['Sem marcações: o dia não entra no saldo.'] };
  }

  const worked = parsed.pairs.reduce((sum, [s, e]) => sum + (e - s), 0);
  const raw = worked - expected;
  let balance = raw;
  const notes = [];

  if (settings.tolerance && type === 'work') {
    const schedule = settings.scheduleClock;
    if (schedule && schedule.length === parsed.clock.length) {
      // Regra por marcação: cada variação até 5 min e, somadas, até 10 min no dia.
      const variations = parsed.clock.map((t, i) => circularDiff(t, schedule[i]));
      const total = variations.reduce((a, b) => a + b, 0);
      const largest = Math.max(...variations);
      if (largest <= TOLERANCE_PER_MARK && total <= TOLERANCE_PER_DAY) {
        balance = 0;
        if (total) notes.push(`Dentro da tolerância: ${total} min de variação nas marcações, o dia conta como exato.`);
      } else if (total <= 3 * TOLERANCE_PER_DAY) {
        // Só explica quando a tolerância "quase" valeu; hora extra grande dispensa explicação.
        notes.push(largest > TOLERANCE_PER_MARK
          ? `Uma marcação variou ${largest} min (mais de 5): conta toda a diferença.`
          : `As variações somam ${total} min (mais de 10): conta toda a diferença.`);
      }
    } else {
      // Sem horário contratual (ou com marcações diferentes dele): regra simplificada pelo saldo do dia.
      if (schedule) notes.push('As marcações não batem com o horário contratual; tolerância aplicada pelo saldo do dia.');
      if (Math.abs(raw) <= TOLERANCE_PER_DAY) {
        balance = 0;
        if (raw) notes.push(`Dentro da tolerância de 10 min no dia (${formatBalance(raw)}).`);
      }
    }
  }

  const night = nightMinutes(parsed.pairs);
  return {
    ...base,
    status: 'ok',
    worked,
    expected,
    rawBalance: raw,
    balance,
    night,
    nightReducedSeconds: reducedNightSeconds(night),
    pairs: parsed.pairs,
    notes,
  };
}

export function computePeriod(days, settingsInput) {
  const settings = readSettings(settingsInput);
  if (settings.errors.length) return { errors: settings.errors, warnings: settings.warnings, results: [], totals: null };
  const results = days.map((d) => computeDay(d, settings));
  const totals = { days: 0, worked: 0, expected: 0, balance: 0, extras: 0, debits: 0, night: 0, nightReducedSeconds: 0, extrasValueCents: null, balanceValueCents: null };
  for (const r of results) {
    if (r.status !== 'ok') continue;
    totals.days += 1;
    totals.worked += r.worked;
    totals.expected += r.expected;
    totals.balance += r.balance;
    if (r.balance > 0) totals.extras += r.balance;
    else totals.debits += r.balance;
    totals.night += r.night;
  }
  totals.nightReducedSeconds = reducedNightSeconds(totals.night);
  if (settings.rateCents !== null) {
    // valor = minutos ÷ 60 × valor da hora × (1 + adicional)
    const value = (minutes) => Math.round((settings.rateCents * minutes * (10000 + settings.overtimeBp)) / 600000);
    totals.extrasValueCents = value(totals.extras);
    totals.balanceValueCents = totals.balance > 0 ? value(totals.balance) : 0;
  }
  return { errors: [], warnings: settings.warnings, settings, results, totals };
}

// ---------- Datas ----------

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MS_PER_DAY = 86400000;

function isoToDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  return m ? Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY) : null;
}

function dayToIso(n) {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

export function weekdayName(iso) {
  const n = isoToDay(iso);
  return n === null ? '' : WEEKDAYS[new Date(n * MS_PER_DAY).getUTCDay()];
}

export function formatDateBR(iso) {
  const n = isoToDay(iso);
  if (n === null) return '';
  const [y, m, d] = dayToIso(n).split('-');
  return `${d}/${m}/${y}`;
}

export function addDays(iso, amount) {
  const n = isoToDay(iso);
  return n === null ? '' : dayToIso(n + amount);
}

/** Segunda a sexta da semana que contém a data. */
export function weekDates(iso) {
  const n = isoToDay(iso);
  const monday = n - ((new Date(n * MS_PER_DAY).getUTCDay() + 6) % 7);
  return [0, 1, 2, 3, 4].map((i) => dayToIso(monday + i));
}

/** Todos os dias de segunda a sexta do mês da data. */
export function monthDates(iso) {
  const [y, m] = iso.split('-').map(Number);
  const out = [];
  for (let n = isoToDay(`${iso.slice(0, 7)}-01`); ; n++) {
    const date = new Date(n * MS_PER_DAY);
    if (date.getUTCMonth() + 1 !== m || date.getUTCFullYear() !== y) break;
    const wd = date.getUTCDay();
    if (wd >= 1 && wd <= 5) out.push(dayToIso(n));
  }
  return out;
}

// ---------- CSV ----------

const TYPE_LABELS = { work: 'Trabalho', off: 'Folga/feriado', absence: 'Falta' };

/** Texto digitado pelo usuário: aspas quando precisa e proteção contra fórmulas ao abrir na planilha. */
export function csvField(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return csvRaw(s);
}

/** Valor gerado pela calculadora (números, horas): só coloca aspas quando precisa. */
function csvRaw(value) {
  const s = String(value ?? '');
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// No CSV o saldo positivo vai sem o "+", que a planilha leria como fórmula; o negativo usa "−".
const csvBalance = (minutes) => formatBalance(minutes).replace(/^\+/, '');

/** CSV com ponto e vírgula (abre direto no Excel e no LibreOffice em português). */
export function toCSV(days, period) {
  const header = ['Data', 'Dia da semana', 'Situação', 'Marcações', 'Jornada', 'Trabalhado', 'Saldo', 'Saldo (minutos)', 'Noturno (minutos)', 'Noturno em hora reduzida', 'Observações'];
  const lines = [header.map(csvRaw).join(';')];
  period.results.forEach((r, i) => {
    const d = days[i];
    const ok = r.status === 'ok';
    lines.push([
      csvRaw(formatDateBR(d.date)), csvRaw(weekdayName(d.date)), csvRaw(TYPE_LABELS[r.type]),
      csvField(d.type === 'absence' ? '' : String(d.markings ?? '').trim()),
      csvRaw(ok || r.status === 'empty' ? formatDuration(r.expected) : ''),
      csvRaw(ok ? formatDuration(r.worked) : ''), csvRaw(ok ? csvBalance(r.balance) : ''), csvRaw(ok ? r.balance : ''),
      csvRaw(ok ? r.night : ''), csvRaw(ok && r.night ? formatSeconds(r.nightReducedSeconds) : ''),
      csvField([...r.errors, ...r.notes].join(' ')),
    ].join(';'));
  });
  const t = period.totals;
  lines.push(['Total', '', '', '', formatDuration(t.expected), formatDuration(t.worked), csvBalance(t.balance), t.balance,
    t.night, t.night ? formatSeconds(t.nightReducedSeconds) : '', `${t.days} ${t.days === 1 ? 'dia calculado' : 'dias calculados'}`].map(csvRaw).join(';'));
  return `${lines.join('\r\n')}\r\n`;
}
