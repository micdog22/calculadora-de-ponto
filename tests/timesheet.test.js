import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTime, parseMarkings, formatBalance, formatDuration, formatSeconds, formatBRL, nightMinutes, reducedNightSeconds,
  readSettings, computeDay, computePeriod, weekDates, monthDates, weekdayName, formatDateBR, addDays, csvField, toCSV,
} from '../src/timesheet.js';

const SCHEDULE = '08:00 12:00 13:00 17:00';
const settings = (extra = {}) => readSettings({ workload: '8:00', tolerance: true, schedule: '', ...extra });
const day = (markings, extra = {}) => ({ date: '2026-10-05', type: 'work', markings, workload: '', ...extra });
const balanceOf = (markings, extra) => computeDay(day(markings), settings(extra)).balance;

test('lê horários em vários formatos', () => {
  const cases = { 8: 480, '08': 480, '8:00': 480, '08:00': 480, '0800': 480, '800': 480, '17:48': 1068, 1748: 1068, '8h': 480, '8h30': 510, '0:00': 0, '24:00': 1440, 2400: 1440 };
  for (const [text, minutes] of Object.entries(cases)) assert.equal(parseTime(text), minutes, text);
  assert.equal(parseTime(''), null);
  for (const bad of ['25:00', '8:60', '24:01', 'abc', '12345', '8:5', '7.30']) assert.ok(Number.isNaN(parseTime(bad)), bad);
});

test('lê as marcações do dia', () => {
  assert.deepEqual(parseMarkings('08:00-12:00 13:00-17:48').clock, [480, 720, 780, 1068]);
  assert.deepEqual(parseMarkings('0800 1200, 1300; 1748').clock, [480, 720, 780, 1068]);
  assert.deepEqual(parseMarkings('8 às 12 e 13 até 17').clock, [480, 720, 780, 1020]);
  assert.match(parseMarkings('08:00 12:00 13:00').errors[0], /ímpar/);
  assert.match(parseMarkings('08:00 meio-dia').errors[0], /Não entendi o horário “meio”/);
  assert.match(parseMarkings('08:00 08:00').errors[0], /mesmo horário/);
  assert.match(parseMarkings('08:00 12:00 11:00 17:00').errors[0], /mais de 24 horas/);
});

test('jornada que passa da meia-noite', () => {
  const p = parseMarkings('22:00 06:00');
  assert.deepEqual(p.pairs, [[1320, 1800]]);
  const r = computeDay(day('22:00 06:00'), settings());
  assert.equal(r.worked, 480);
  assert.equal(r.balance, 0);
  const split = computeDay(day('22:00 02:00 03:00 06:00'), settings({ workload: '7:00' }));
  assert.equal(split.worked, 420);
  assert.equal(computeDay(day('16:00 24:00'), settings()).worked, 480);
});

test('vários pares de entrada e saída', () => {
  const r = computeDay(day('08:00 12:00 13:00 17:48'), settings());
  assert.equal(r.worked, 528);
  assert.equal(r.balance, 48);
  assert.equal(formatBalance(r.balance), '+0h48');
  assert.equal(computeDay(day('08:00 12:00 13:00 17:48'), settings({ workload: '8:48' })).balance, 0);
  assert.equal(computeDay(day('07:00 09:00 09:15 12:00 13:00 15:00 15:10 17:00'), settings({ tolerance: false })).worked, 2 * 60 + 165 + 120 + 110);
});

test('formatação de saldos e durações', () => {
  assert.equal(formatBalance(83), '+1h23');
  assert.equal(formatBalance(-15), '-0h15');
  assert.equal(formatBalance(0), '0h00');
  assert.equal(formatBalance(600), '+10h00');
  assert.equal(formatBalance(-605), '-10h05');
  assert.equal(formatDuration(528), '8h48');
  assert.equal(formatSeconds(28800), '8h00');
  assert.equal(formatSeconds(6171), '1h42min51s');
  assert.equal(formatBRL(123456), 'R$ 1.234,56');
  assert.equal(formatBRL(5), 'R$ 0,05');
});

test('tolerância sem horário contratual: até 10 minutos de saldo no dia', () => {
  assert.equal(balanceOf('08:04 12:00 13:00 17:00'), 0); // -4
  assert.equal(balanceOf('08:00 12:00 13:00 17:06'), 0); // +6
  assert.equal(balanceOf('07:50 12:00 13:00 17:00'), 0); // +10, no limite
  assert.equal(balanceOf('07:49 12:00 13:00 17:00'), 11); // +11 passa: conta tudo
  assert.equal(balanceOf('08:11 12:00 13:00 17:00'), -11);
  assert.equal(balanceOf('08:04 12:00 13:00 17:00', { tolerance: false }), -4);
  const r = computeDay(day('08:00 12:00 13:00 17:06'), settings());
  assert.equal(r.rawBalance, 6);
  assert.match(r.notes[0], /tolerância de 10 min/);
});

test('tolerância com horário contratual: até 5 min por marcação e 10 min no dia', () => {
  const s = { schedule: SCHEDULE };
  assert.equal(balanceOf('08:04 12:00 13:00 17:00', s), 0); // 4 min numa marcação: exato
  assert.equal(balanceOf('08:06 12:00 13:00 17:00', s), -6); // 6 min numa marcação: conta tudo
  assert.equal(balanceOf('07:55 12:00 13:00 17:05', s), 0); // 5 + 5 = 10: ainda exato
  const eleven = computeDay(day('08:03 12:04 12:57 17:01'), settings(s)); // 3 + 4 + 3 + 1 = 11
  assert.equal(eleven.rawBalance, 5);
  assert.equal(eleven.balance, 5);
  assert.match(eleven.notes[0], /somam 11 min/);
  assert.match(computeDay(day('08:06 12:00 13:00 17:00'), settings(s)).notes[0], /variou 6 min/);
  assert.deepEqual(computeDay(day('08:00 12:00 13:00 18:30'), settings(s)).notes, []); // hora extra comum: sem nota
  // chegou 6 min antes e saiu 6 min antes: o saldo é zero, mas cada marcação passou de 5 min
  const shifted = computeDay(day('07:54 12:00 13:00 16:54'), settings(s));
  assert.equal(shifted.balance, 0);
  assert.equal(shifted.notes[0], 'Uma marcação variou 6 min (mais de 5): conta toda a diferença.');
});

test('marcações diferentes do horário contratual caem na regra do saldo do dia', () => {
  const r = computeDay(day('08:00 17:00'), settings({ schedule: SCHEDULE }));
  assert.equal(r.balance, 60);
  assert.match(r.notes[0], /não batem com o horário contratual/);
  assert.equal(computeDay(day('08:00 16:05'), settings({ schedule: SCHEDULE })).balance, 0); // +5 pelo saldo do dia
});

test('horário contratual noturno compara as marcações em volta da meia-noite', () => {
  const s = { schedule: '22:00 06:00' };
  assert.equal(balanceOf('21:57 06:02', s), 0); // 3 + 2 min
  assert.equal(balanceOf('23:58 06:00', { schedule: '00:00 06:00', workload: '6:00' }), 0); // 2 min antes da meia-noite
});

test('minutos noturnos (22h às 5h) e hora noturna reduzida', () => {
  assert.equal(nightMinutes([[1320, 1740]]), 420); // 22:00 às 05:00
  assert.equal(reducedNightSeconds(420), 8 * 3600); // 7 horas reais = 8 horas noturnas
  const r = computeDay(day('22:00 06:00'), settings());
  assert.equal(r.night, 420);
  assert.equal(r.nightReducedSeconds, 28800);
  assert.equal(computeDay(day('21:00 23:30'), settings({ tolerance: false })).night, 90);
  assert.equal(formatSeconds(reducedNightSeconds(90)), '1h42min51s');
  assert.equal(computeDay(day('04:00 06:00'), settings({ tolerance: false })).night, 60);
  assert.equal(computeDay(day('22:00 02:00 03:00 06:00'), settings({ workload: '7:00' })).night, 240 + 120);
  assert.equal(computeDay(day('08:00 12:00 13:00 17:00'), settings()).night, 0);
  assert.equal(formatSeconds(reducedNightSeconds(60)), '1h08min34s');
});

test('folga, falta e dia sem marcações', () => {
  const off = computeDay(day('08:00 12:00', { type: 'off' }), settings());
  assert.equal(off.expected, 0);
  assert.equal(off.balance, 240);
  const absence = computeDay(day('', { type: 'absence' }), settings({ workload: '8:48' }));
  assert.equal(absence.balance, -528);
  assert.equal(computeDay(day(''), settings()).status, 'empty');
  assert.equal(computeDay(day('08:00 12:00', { workload: '4:00' }), settings()).balance, 0);
  assert.equal(computeDay(day('08:00 12:00', { workload: 'x' }), settings()).status, 'error');
});

test('banco de horas do período e valor das extras', () => {
  const days = [
    day('08:00 12:00 13:00 18:00'), // +1h00
    day('08:00 12:00 13:00 16:30'), // -0h30
    day(''), // fica de fora
    day('08:00 12:00 13:00 17:05'), // +5, tolerância → 0
    day('', { type: 'absence' }), // -8h00
  ];
  const p = computePeriod(days, { workload: '8:00', tolerance: true, hourlyRate: '20,00', overtimePercent: '50' });
  assert.deepEqual(p.errors, []);
  assert.equal(p.totals.days, 4);
  assert.equal(p.totals.extras, 60);
  assert.equal(p.totals.debits, -30 - 480);
  assert.equal(p.totals.balance, 60 - 30 - 480);
  assert.equal(p.totals.extrasValueCents, 3000); // 1 h × R$ 20 × 1,5
  assert.equal(p.totals.balanceValueCents, 0);
  const noRate = computePeriod(days.slice(0, 1), { workload: '8:00' });
  assert.equal(noRate.totals.extrasValueCents, null);
  const hundred = computePeriod(days.slice(0, 1), { workload: '8:00', hourlyRate: '30', overtimePercent: '100' });
  assert.equal(hundred.totals.extrasValueCents, 6000);
});

test('configurações inválidas e aviso de jornada diferente da escala', () => {
  assert.match(readSettings({ workload: '' }).errors[0], /Jornada diária inválida/);
  assert.match(readSettings({ workload: '8:00', schedule: '08:00 12:00 13:00' }).errors[0], /^Horário contratual: Número ímpar/);
  assert.match(readSettings({ workload: '8:00', hourlyRate: 'vinte' }).errors[0], /Valor da hora/);
  assert.match(readSettings({ workload: '8:00', overtimePercent: '-5' }).errors[0], /Adicional/);
  assert.match(readSettings({ workload: '8:48', schedule: SCHEDULE }).warnings[0], /soma 8h00, diferente da jornada diária de 8h48/);
  assert.match(computePeriod([], { workload: 'oito' }).errors[0], /Jornada/);
});

test('datas da semana e do mês', () => {
  assert.deepEqual(weekDates('2026-10-08'), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
  assert.deepEqual(weekDates('2026-10-11'), weekDates('2026-10-05')); // domingo fica na semana que começou na segunda
  const october = monthDates('2026-10-15');
  assert.equal(october.length, 22);
  assert.equal(october[0], '2026-10-01');
  assert.equal(october.at(-1), '2026-10-30');
  assert.equal(weekdayName('2026-10-08'), 'quinta-feira');
  assert.equal(formatDateBR('2026-10-08'), '08/10/2026');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
});

test('CSV com ponto e vírgula e escape', () => {
  assert.equal(csvField('a;b'), '"a;b"');
  assert.equal(csvField('diz "oi"'), '"diz ""oi"""');
  assert.equal(csvField('\u22120h15'), '\u22120h15');
  assert.equal(csvField('-15'), "'-15");
  const days = [
    { date: '2026-10-05', type: 'work', markings: '08:00 12:00 13:00 17:48', workload: '' },
    { date: '2026-10-06', type: 'work', markings: '22:00 06:00', workload: '' },
    { date: '2026-10-07', type: 'work', markings: '', workload: '' },
    { date: '2026-10-08', type: 'absence', markings: '', workload: '' },
  ];
  const lines = toCSV(days, computePeriod(days, { workload: '8:00' })).split('\r\n');
  assert.equal(lines[0], 'Data;Dia da semana;Situação;Marcações;Jornada;Trabalhado;Saldo;Saldo (minutos);Noturno (minutos);Noturno em hora reduzida;Observações');
  assert.equal(lines[1], '05/10/2026;segunda-feira;Trabalho;08:00 12:00 13:00 17:48;8h00;8h48;0h48;48;0;;');
  assert.equal(lines[2], '06/10/2026;terça-feira;Trabalho;22:00 06:00;8h00;8h00;0h00;0;420;8h00;');
  assert.equal(lines[3], '07/10/2026;quarta-feira;Trabalho;;8h00;;;;;;Sem marcações: o dia não entra no saldo.');
  assert.equal(lines[4], '08/10/2026;quinta-feira;Falta;;8h00;0h00;\u22128h00;-480;0;;Falta: o dia inteiro entra como débito.');
  assert.equal(lines[5], 'Total;;;;24h00;16h48;\u22127h12;-432;420;8h00;3 dias calculados');
});
