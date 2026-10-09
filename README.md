# Calculadora de Ponto: horas trabalhadas, extras e banco de horas (HTML + JS)

Digite as marcações de ponto de cada dia e veja as horas trabalhadas, o saldo do dia, o banco de horas do período, as horas extras e o trabalho noturno. Aplica a tolerância de 5 minutos da CLT, entende turnos que viram a noite e exporta tudo em CSV.

**Acesse online:** https://micdog22.github.io/calculadora-de-ponto/

## Recursos
- Quantos pares de entrada e saída você quiser por dia (`08:00 12:00 13:00 17:48`) e turnos que passam da meia-noite (`22:00 06:00`).
- Aceita os horários como `8`, `8:00`, `08:00`, `0800` ou `8h30`.
- Jornada diária padrão de 8:00, 8:48 (44 horas em 5 dias), 6:00, 4:00 ou outra, com ajuste por dia.
- Situação de cada dia: trabalho, folga/feriado (todo o tempo trabalhado vira extra) ou falta (o dia inteiro vira débito).
- Saldo do dia e banco de horas no formato `+1h23` / `-0h15`.
- Tolerância da CLT (art. 58, § 1º, e Súmula 366 do TST), ligada por padrão, marcação por marcação quando você informa o horário contratual.
- Trabalho noturno (22h às 5h) com a conversão para hora noturna reduzida de 52min30s.
- Valor das horas extras a partir do valor da hora e do adicional (50% por padrão).
- Semana atual ou mês atual (dias úteis) com um clique, dias avulsos, exportação em CSV e tudo salvo no navegador (localStorage).

## Como usar
1. Escolha a jornada diária e, se quiser, informe o horário contratual (por exemplo, `08:00 12:00 13:00 17:00`), o valor da hora e o adicional de hora extra.
2. Preencha as marcações de cada dia em ordem: entrada, saída, entrada, saída…
3. Acompanhe o saldo de cada dia e o resumo do período; exporte o CSV se precisar.

Exemplo de semana com jornada de 8:00:

| Marcações | Trabalhado | Saldo |
|---|---|---|
| `08:02 12:00 13:01 17:05` | 8h02 | 0h00 (dentro da tolerância) |
| `07:58 12:00 13:00 18:30` | 9h32 | +1h32 |
| `08:15 12:00 13:00 17:00` | 7h45 | -0h15 |
| `08:00 12:00 13:00 17:00 19:00 23:00` | 12h00 | +4h00, com 1h00 noturna |

## Como rodar localmente
Módulos ES não carregam via `file://`, então sirva a pasta com qualquer servidor estático:

```bash
python3 -m http.server 8000
```

e abra http://localhost:8000.

## Testes
```bash
npm test
```
(usa só o `node:test`, sem dependências; precisa do Node 18 ou mais novo)

## Como funciona
- **Saldo do dia** = tempo trabalhado - jornada. O **banco de horas** é a soma dos saldos do período; dias sem marcações ficam de fora.
- **Turnos noturnos:** quando um horário é menor que o anterior, a calculadora entende que passou da meia-noite.
- **Tolerância (CLT, art. 58, § 1º, e Súmula 366 do TST):** variações de até 5 minutos por marcação, somando no máximo 10 minutos no dia, não são descontadas nem contam como extra. Passou do limite, conta a diferença inteira. Com o horário contratual, cada marcação é comparada com o horário previsto; sem ele, vale uma regra simplificada: saldo do dia de até 10 minutos, para mais ou para menos, vira zero.
- **Trabalho noturno (CLT, art. 73, trabalhador urbano):** conta os minutos entre 22h e 5h e mostra quanto eles valem em hora noturna reduzida (52min30s = 1 hora, ou seja, minutos × 60 ÷ 52,5). O saldo usa as horas de relógio; a conversão aparece à parte.
- **Horas extras:** soma dos dias com saldo positivo; o valor é horas × valor da hora × (1 + adicional).

## Aviso
Esta calculadora é uma ferramenta de apoio: não substitui o controle de ponto oficial da empresa nem orientação jurídica. Convenções e acordos coletivos podem ter regras próprias, e adicionais diferentes (domingos, feriados, adicional noturno) não entram no valor calculado.

## Contribuindo
Issues e pull requests são bem-vindos.

## Licença
MIT. Veja [LICENSE](LICENSE).
