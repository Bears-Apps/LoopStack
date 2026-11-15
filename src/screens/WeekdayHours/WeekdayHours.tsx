import { useCallback, useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader/AppHeader';
import { InboxButton } from '@/components/AppHeader/InboxButton';
import { Section } from '@/components/Section/Section';
import { SampleNote } from '@/components/SampleTag/SampleTag';
import { isSample, useDayHourGrid, useWeekdayExercise, useWeekdayHourly } from '@/data/sources/hooks';
import { WEEKDAY_LABELS } from '@/lib/metrics/dayHourGrid';
import type { HourAverage } from '@/lib/metrics/weekdayHourly';
import type { HourExercise } from '@/lib/metrics/weekdayExercise';
import { findTrendStretches } from '@/lib/alerts/trendHeadsUp';
import { formatHour } from '@/lib/alerts/riskWindows';
import styles from './WeekdayHours.module.css';

// One weekday's average hours, laid out like Loop's status screen: glucose on
// top, insulin on board, carbs on board and exercise underneath, one time axis
// for all four. Dragging across any chart moves one cursor through all of them, and
// the readout above says what that hour usually holds.
//
// This is where the heads-up and the morning report open. They arrive with the
// weekday and, for a heads-up, the stretch it was about; the stretch is shaded
// so the reason for the notification is the first thing on screen.
//
// Averages over the last twelve weeks, described as what has happened. Not a
// dosing screen.

const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Shared horizontal layout, so one x maps to the same hour in every chart.
const W = 340;
const PAD_L = 4;
const PAD_R = 30;
const PLOT_W = W - PAD_L - PAD_R;
const COL = PLOT_W / 24;
const xAt = (hour: number) => PAD_L + (hour + 0.5) * COL;

const parseHour = (v: string | null): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
};

function glucoseTone(mgdl: number | null, low: number, high: number): string {
  if (mgdl == null) return 'var(--ink-300)';
  if (mgdl < low) return 'var(--range-low)';
  if (mgdl > high) return 'var(--range-high)';
  return 'var(--range-in)';
}

const hourSpan = (h: number) => `${formatHour(h)}–${formatHour((h + 1) % 24)}`;

export function WeekdayHours() {
  const [params, setParams] = useSearchParams();
  const result = useWeekdayHourly();
  const gridResult = useDayHourGrid();
  const exerciseResult = useWeekdayExercise();
  const data = result.data;
  const exercise = exerciseResult.data;

  const today = new Date().getDay();
  const weekday = parseHour(params.get('day')) ?? today;
  const validDay = weekday >= 0 && weekday <= 6 ? weekday : today;
  const from = parseHour(params.get('from'));
  const to = parseHour(params.get('to')) ?? from;
  const hourParam = parseHour(params.get('hour'));
  const hour = hourParam ?? from ?? (validDay === today ? new Date().getHours() : 8);

  const update = useCallback(
    (next: Record<string, string | null>) => {
      setParams(
        (prev: URLSearchParams) => {
          const p = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(next)) {
            if (v == null) p.delete(k);
            else p.set(k, v);
          }
          return p;
        },
        // Replace: scrubbing and flicking weekdays should not fill Back.
        { replace: true },
      );
    },
    [setParams],
  );

  const setHour = useCallback((h: number) => update({ hour: String(Math.max(0, Math.min(23, h))) }), [update]);
  // A different weekday drops the alert's stretch: it was about the day the
  // notification named.
  const setDay = (d: number) => update({ day: String(d), from: null, to: null });

  const day = data?.days.find((d) => d.weekday === validDay) ?? null;
  const hours = day?.hours ?? [];
  const cell = hours[hour] ?? null;
  const exerciseHours = exercise?.days.find((d) => d.weekday === validDay)?.hours ?? [];
  const exerciseCell = exerciseHours[hour] ?? null;
  const low = data?.targetLowMgdl ?? 70;
  const high = data?.targetHighMgdl ?? 180;
  const building = !day || day.weeksObserved < 3;

  // The stretches a heads-up would fire for, from the same grid the alerts read.
  const stretches = useMemo(
    () => (gridResult.data ? findTrendStretches(gridResult.data, validDay) : []),
    [gridResult.data, validDay],
  );

  const summary = useMemo(() => {
    const known = hours.filter((h) => h.reliable && h.glucoseMgdl != null);
    if (known.length === 0) return null;
    const by = (f: (h: HourAverage) => number | null) =>
      hours.reduce<HourAverage | null>((best, h) => {
        const v = f(h);
        return v != null && (best == null || v > (f(best) ?? -Infinity)) ? h : best;
      }, null);
    return {
      mean: Math.round(known.reduce((a, h) => a + (h.glucoseMgdl ?? 0), 0) / known.length),
      highest: by((h) => (h.reliable ? h.glucoseMgdl : null)),
      lowest: by((h) => (h.reliable && h.glucoseMgdl != null ? -h.glucoseMgdl : null)),
      peakIob: by((h) => h.iobU),
      peakCob: by((h) => h.cobG),
      peakExercise: exerciseHours.reduce<HourExercise | null>(
        (best, h) => (h.reliable && h.minutes > 0 && (best == null || h.minutes > best.minutes) ? h : best),
        null,
      ),
    };
  }, [hours, exerciseHours]);

  // ── scrubbing ──
  const scrubRef = useRef<HTMLDivElement>(null);
  const hourFromPointer = (clientX: number) => {
    const el = scrubRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    return Math.max(0, Math.min(23, Math.floor((x - PAD_L) / COL)));
  };
  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    if (e.type === 'pointermove' && e.buttons === 0 && e.pointerType === 'mouse') return;
    const h = hourFromPointer(e.clientX);
    if (h != null && h !== hour) setHour(h);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, Home: -hour, End: 23 - hour }[e.key];
    if (step == null) return;
    e.preventDefault();
    setHour(hour + step);
  };

  const iobValues = hours.map((h) => h.iobU ?? 0);
  const cobValues = hours.map((h) => h.cobG ?? 0);
  const hasIob = hours.some((h) => h.iobU != null);
  const hasCob = hours.some((h) => h.cobG != null);

  return (
    <>
      <AppHeader title="Weekday hours" showBack rightAction={<InboxButton />} />
      <main className="screen">
        <Section
          label={`Last ${data?.sampleWeeks ?? 12} weeks`}
          title={`Average ${WEEKDAY_LABELS[validDay]}`}
          description="Glucose, insulin on board, carbs on board and exercise for each hour of this weekday. Drag across the charts to move through the day."
        >
          {isSample(result) ? <SampleNote>Example history until your data source has enough weeks.</SampleNote> : null}

          <div className={styles.strip} role="tablist" aria-label="Day of week">
            {LETTERS.map((letter, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === validDay}
                aria-label={WEEKDAY_LABELS[i]}
                className={`${styles.day} ${i === validDay ? styles.dayActive : ''} ${i === today ? styles.dayToday : ''}`}
                onClick={() => setDay(i)}
              >
                {letter}
              </button>
            ))}
          </div>

          {!data ? (
            <p className={styles.note}>{result.loading ? 'Reading the last twelve weeks…' : 'No history yet.'}</p>
          ) : building ? (
            <p className={styles.note}>
              {WEEKDAY_LABELS[validDay]}s need three weeks of history before their hours say anything. {day?.weeksObserved ?? 0} so
              far.
            </p>
          ) : (
            <>
              {/* The readout: what the cursor's hour usually holds. */}
              <div className={styles.readout} aria-live="polite">
                <div className={styles.readoutHead}>
                  <span className={styles.readoutHour}>{hourSpan(hour)}</span>
                  <span className={styles.readoutWeeks}>
                    {cell?.reliable ? `${cell.weeks} weeks` : 'Too few weeks'}
                  </span>
                </div>
                <div className={styles.stats}>
                  <div className={styles.stat}>
                    <span className={styles.statLabel}>Glucose</span>
                    <span className={styles.statValue} style={{ color: glucoseTone(cell?.reliable ? cell.glucoseMgdl : null, low, high) }}>
                      {cell?.reliable && cell.glucoseMgdl != null ? cell.glucoseMgdl : '—'}
                      <small> mg/dL</small>
                    </span>
                  </div>
                  <div className={styles.stat}>
                    <span className={styles.statLabel}>IOB</span>
                    <span className={`${styles.statValue} ${styles.insulin}`}>
                      {cell?.iobU != null ? cell.iobU.toFixed(2) : '—'}
                      <small> U</small>
                    </span>
                  </div>
                  <div className={styles.stat}>
                    <span className={styles.statLabel}>COB</span>
                    <span className={`${styles.statValue} ${styles.carbs}`}>
                      {cell?.cobG != null ? cell.cobG : '—'}
                      <small> g</small>
                    </span>
                  </div>
                  <div className={styles.stat}>
                    <span className={styles.statLabel}>Exercise</span>
                    <span className={`${styles.statValue} ${styles.exercise}`}>
                      {exerciseCell?.reliable ? exerciseCell.minutes : '—'}
                      <small> min</small>
                    </span>
                  </div>
                </div>
                {cell?.reliable ? (
                  <p className={styles.readoutLine}>
                    {cell.glucoseP25 !== cell.glucoseP75 ? `Middle half of weeks ${cell.glucoseP25}–${cell.glucoseP75} mg/dL · ` : ''}
                    {cell.lowPct}% of readings under {low} · {cell.highPct}% over {high}
                  </p>
                ) : null}
                {exerciseCell?.reliable && exerciseCell.weeksActive > 0 ? (
                  <p className={styles.readoutLine}>
                    Active in this hour on {exerciseCell.weeksActive} of {exerciseCell.weeks} {WEEKDAY_LABELS[validDay]}s
                    {exerciseCell.workoutType ? ` · usually ${workoutWord(exerciseCell.workoutType)}` : ''}
                  </p>
                ) : null}
              </div>

              <div
                ref={scrubRef}
                className={styles.charts}
                role="slider"
                tabIndex={0}
                aria-label="Hour of day"
                aria-valuemin={0}
                aria-valuemax={23}
                aria-valuenow={hour}
                aria-valuetext={hourSpan(hour)}
                onPointerDown={onPointer}
                onPointerMove={onPointer}
                onKeyDown={onKey}
              >
                <ChartLabel title="Glucose" unit="mg/dL" />
                <GlucoseChart hours={hours} low={low} high={high} hour={hour} from={from} to={to} />

                <ChartLabel title="Active insulin" unit="U" />
                {hasIob ? (
                  <AreaChart values={iobValues} hour={hour} from={from} to={to} tone="insulin" format={(v) => v.toFixed(1)} floor={1} />
                ) : (
                  <p className={styles.note}>No insulin history in the last twelve weeks.</p>
                )}

                <ChartLabel title="Active carbohydrates" unit="g" />
                {hasCob ? (
                  <AreaChart values={cobValues} hour={hour} from={from} to={to} tone="carbs" format={(v) => String(Math.round(v))} floor={10} />
                ) : (
                  <p className={styles.note}>No carb entries in the last twelve weeks.</p>
                )}

                <ChartLabel title="Exercise" unit="min" />
                {exerciseHours.length > 0 ? (
                  <ExerciseChart hours={exerciseHours} hour={hour} from={from} to={to} />
                ) : (
                  <p className={styles.note}>
                    {exerciseResult.loading
                      ? 'Reading exercise…'
                      : 'Exercise comes from Apple Health. Turn it on under Sources to see when this weekday usually moves.'}
                  </p>
                )}

                <div className={styles.axis} aria-hidden>
                  {[0, 6, 12, 18].map((h) => (
                    <span key={h} style={{ left: `${(xAt(h) / W) * 100}%` }}>
                      {formatHour(h)}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </Section>

        {data && !building ? (
          <Section label="At a glance" title={`${WEEKDAY_LABELS[validDay]}s, hour by hour`}>
            {stretches.length > 0 ? (
              <ul className={styles.jumps}>
                {stretches.map((s) => (
                  <li key={`${s.kind}${s.startHour}`}>
                    <button
                      type="button"
                      className={`${styles.jump} ${s.kind === 'low' ? styles.jumpLow : styles.jumpHigh}`}
                      onClick={() => update({ hour: String(s.startHour), from: String(s.startHour), to: String(s.endHour) })}
                    >
                      <span>
                        {s.startHour === s.endHour ? formatHour(s.startHour) : `${formatHour(s.startHour)}–${formatHour(s.endHour + 1)}`}{' '}
                        often runs {s.kind}
                      </span>
                      <span className={styles.jumpMeta}>
                        {s.sharePct}% of readings · {s.weeks} weeks
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.note}>No hour of this weekday runs low or high often enough for a heads-up.</p>
            )}

            {summary ? (
              <div className={styles.glance}>
                <Glance label="Day average" value={`${summary.mean} mg/dL`} />
                {summary.highest ? (
                  <Glance label="Highest hour" value={`${formatHour(summary.highest.hour)} · ${summary.highest.glucoseMgdl}`} onPick={() => setHour(summary.highest!.hour)} />
                ) : null}
                {summary.lowest ? (
                  <Glance label="Lowest hour" value={`${formatHour(summary.lowest.hour)} · ${summary.lowest.glucoseMgdl}`} onPick={() => setHour(summary.lowest!.hour)} />
                ) : null}
                {summary.peakIob?.iobU != null ? (
                  <Glance label="Most insulin on board" value={`${formatHour(summary.peakIob.hour)} · ${summary.peakIob.iobU.toFixed(1)} U`} onPick={() => setHour(summary.peakIob!.hour)} />
                ) : null}
                {summary.peakCob?.cobG ? (
                  <Glance label="Most carbs on board" value={`${formatHour(summary.peakCob.hour)} · ${summary.peakCob.cobG} g`} onPick={() => setHour(summary.peakCob!.hour)} />
                ) : null}
                {summary.peakExercise ? (
                  <Glance
                    label="Most active hour"
                    value={`${formatHour(summary.peakExercise.hour)} · ${summary.peakExercise.minutes} min`}
                    onPick={() => setHour(summary.peakExercise!.hour)}
                  />
                ) : null}
              </div>
            ) : null}

            <p className={styles.footnote}>
              Each hour is the average of each {WEEKDAY_LABELS[validDay]}'s average, so one unusual week cannot outweigh the rest. Hours
              need three weeks of readings before they show.{' '}
              {data.iobBasis === 'net'
                ? 'Active insulin counts boluses and temp basals against your basal schedule, as Loop does, so it can dip below zero after a long low temp.'
                : 'Active insulin counts boluses only: this source carries no temp basals.'}{' '}
              Active carbs follow each entry's own absorption time.{' '}
              {exercise
                ? `Exercise is the average minutes moved in each hour across every ${WEEKDAY_LABELS[validDay]}, counting days without exercise as zero${
                    exercise.basis === 'exercise_minutes'
                      ? ", from Apple's exercise minutes, so brisk walks count as well as logged workouts."
                      : ': logged workouts only, because this source has no exercise minutes.'
                  }`
                : ''}{' '}
              Describes what has happened, not what to dose.
            </p>
          </Section>
        ) : null}
      </main>
    </>
  );
}

function ChartLabel({ title, unit }: { title: string; unit: string }) {
  return (
    <div className={styles.chartLabel}>
      <span>{title}</span>
      <span className={styles.chartUnit}>{unit}</span>
    </div>
  );
}

function Glance({ label, value, onPick }: { label: string; value: string; onPick?: () => void }) {
  const body = (
    <>
      <span className={styles.glanceLabel}>{label}</span>
      <span className={styles.glanceValue}>{value}</span>
    </>
  );
  return onPick ? (
    <button type="button" className={styles.glanceItem} onClick={onPick}>
      {body}
    </button>
  ) : (
    <div className={styles.glanceItem}>{body}</div>
  );
}

/** The alert's stretch, and the cursor, drawn the same way in every chart. */
function Overlays({ hour, from, to, top, bottom }: { hour: number; from: number | null; to: number | null; top: number; bottom: number }) {
  return (
    <>
      {from != null && to != null ? (
        <rect
          x={PAD_L + Math.min(from, to) * COL}
          y={top}
          width={(Math.abs(to - from) + 1) * COL}
          height={bottom - top}
          className={styles.stretch}
        />
      ) : null}
      <line x1={xAt(hour)} x2={xAt(hour)} y1={top} y2={bottom} className={styles.cursor} />
    </>
  );
}

const G_H = 150;
const G_TOP = 6;
const G_BOT = G_H - 6;

function GlucoseChart({
  hours,
  low,
  high,
  hour,
  from,
  to,
}: {
  hours: HourAverage[];
  low: number;
  high: number;
  hour: number;
  from: number | null;
  to: number | null;
}) {
  const shown = hours.filter((h) => h.reliable && h.glucoseMgdl != null);
  const yMin = 40;
  const yMax = Math.max(250, ...shown.map((h) => (h.glucoseP75 ?? 0) + 10));
  const y = (v: number) => G_BOT - ((Math.min(yMax, Math.max(yMin, v)) - yMin) / (yMax - yMin)) * (G_BOT - G_TOP);

  // Breaks in the line where an hour has too few weeks behind it.
  const runs: HourAverage[][] = [];
  for (const h of hours) {
    if (h.reliable && h.glucoseMgdl != null) {
      if (runs.length === 0 || runs[runs.length - 1].at(-1)!.hour !== h.hour - 1) runs.push([]);
      runs[runs.length - 1].push(h);
    }
  }
  const band = (run: HourAverage[]) =>
    `M${run.map((h) => `${xAt(h.hour)},${y(h.glucoseP75!)}`).join('L')}L${[...run]
      .reverse()
      .map((h) => `${xAt(h.hour)},${y(h.glucoseP25!)}`)
      .join('L')}Z`;
  const ticks = [low, high, Math.round(yMax / 50) * 50].filter((v, i, a) => a.indexOf(v) === i && v <= yMax);

  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${G_H}`} aria-hidden>
      <rect x={PAD_L} y={y(high)} width={PLOT_W} height={y(low) - y(high)} className={styles.targetBand} />
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD_L} x2={PAD_L + PLOT_W} y1={y(v)} y2={y(v)} className={styles.gridLine} />
          <text x={W - 2} y={y(v) + 3} textAnchor="end" className={styles.tick}>
            {v}
          </text>
        </g>
      ))}
      <Overlays hour={hour} from={from} to={to} top={G_TOP} bottom={G_BOT} />
      {runs.map((run, i) => (
        <g key={i}>
          {run.length > 1 ? <path d={band(run)} className={styles.spread} /> : null}
          <path d={`M${run.map((h) => `${xAt(h.hour)},${y(h.glucoseMgdl!)}`).join('L')}`} className={styles.glucoseLine} />
        </g>
      ))}
      {shown.map((h) => (
        <circle
          key={h.hour}
          cx={xAt(h.hour)}
          cy={y(h.glucoseMgdl!)}
          r={h.hour === hour ? 4.5 : 3}
          fill={glucoseTone(h.glucoseMgdl, low, high)}
          className={h.hour === hour ? styles.dotActive : undefined}
        />
      ))}
    </svg>
  );
}

const A_H = 76;
const A_TOP = 6;
const A_BOT = A_H - 6;

function AreaChart({
  values,
  hour,
  from,
  to,
  tone,
  format,
  floor,
}: {
  values: number[];
  hour: number;
  from: number | null;
  to: number | null;
  tone: 'insulin' | 'carbs';
  format: (v: number) => string;
  /** Smallest top of scale, so a quiet day is not drawn as a mountain. */
  floor: number;
}) {
  const yMax = Math.max(floor, ...values) * 1.1;
  // IOB is netted against the schedule and can sit below zero.
  const yMin = Math.min(0, ...values) * 1.1;
  const y = (v: number) => A_BOT - ((v - yMin) / (yMax - yMin)) * (A_BOT - A_TOP);
  const pts = values.map((v, h) => `${xAt(h)},${y(v)}`);
  const area = `M${xAt(0)},${y(0)}L${pts.join('L')}L${xAt(23)},${y(0)}Z`;

  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${A_H}`} aria-hidden>
      <line x1={PAD_L} x2={PAD_L + PLOT_W} y1={y(0)} y2={y(0)} className={styles.gridLine} />
      <text x={W - 2} y={A_TOP + 6} textAnchor="end" className={styles.tick}>
        {format(Math.max(...values))}
      </text>
      <Overlays hour={hour} from={from} to={to} top={A_TOP} bottom={A_BOT} />
      <path d={area} className={tone === 'insulin' ? styles.insulinArea : styles.carbArea} />
      <path d={`M${pts.join('L')}`} className={tone === 'insulin' ? styles.insulinLine : styles.carbLine} />
      <circle cx={xAt(hour)} cy={y(values[hour] ?? 0)} r={4} className={tone === 'insulin' ? styles.insulinDot : styles.carbDot} />
    </svg>
  );
}

const WORKOUT_WORDS: Record<string, string> = {
  running: 'a run',
  walking: 'a walk',
  cycling: 'a ride',
  swimming: 'a swim',
  strength: 'strength training',
  hiit: 'HIIT',
  cardio: 'cardio',
};
const workoutWord = (type: string) => WORKOUT_WORDS[type] ?? 'a workout';

const E_H = 56;
const E_TOP = 6;
const E_BOT = E_H - 4;

/**
 * Bars, not an area: exercise is counted per clock hour, and a line drawn
 * between hours would invent movement at the boundaries.
 */
function ExerciseChart({ hours, hour, from, to }: { hours: HourExercise[]; hour: number; from: number | null; to: number | null }) {
  // A floor of 15 minutes, so a day of short walks is not drawn as a marathon.
  const yMax = Math.max(15, ...hours.map((h) => h.minutes));
  const barW = COL * 0.7;
  const y = (v: number) => E_BOT - (v / yMax) * (E_BOT - E_TOP);
  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${E_H}`} aria-hidden>
      <line x1={PAD_L} x2={PAD_L + PLOT_W} y1={E_BOT} y2={E_BOT} className={styles.gridLine} />
      <text x={W - 2} y={E_TOP + 6} textAnchor="end" className={styles.tick}>
        {Math.round(yMax)}
      </text>
      <Overlays hour={hour} from={from} to={to} top={E_TOP} bottom={E_BOT} />
      {hours.map((h) =>
        h.minutes > 0 ? (
          <rect
            key={h.hour}
            x={xAt(h.hour) - barW / 2}
            y={y(h.minutes)}
            width={barW}
            height={E_BOT - y(h.minutes)}
            rx={1.5}
            className={`${h.hour === hour ? styles.exerciseBarActive : styles.exerciseBar} ${h.reliable ? '' : styles.exerciseBarThin}`}
          />
        ) : null,
      )}
    </svg>
  );
}
