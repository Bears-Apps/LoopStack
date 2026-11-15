import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader/AppHeader';
import { Button } from '@/components/Button/Button';
import { SampleNote } from '@/components/SampleTag/SampleTag';
import { useDataSourceContext } from '@/data/sources/DataSourceContext';
import { loadInsulinOwner } from '@/data/sources/combinedConfig';
import { activeLoopTherapy } from '@/data/loopTherapySchedules';
import { loadTargetRange } from '@/data/loopTherapyStore';
import { buildReviewEvidence, localReviewSummary, reviewHandoff, reviewMealLabels, type ReviewEvidence, type ReviewRequest } from '@/lib/ai/reviewEvidence';
import { claudeModelLabel, claudeReady, loadClaudeConfig } from '@/data/claudeConfig';
import styles from './DataChat.module.css';

const INITIAL: ReviewRequest = { question: 'What insulin was recorded and how did my glucose react the last three times I ate this food?', topic: 'meal', mealLabel: '', days: 90 };
const date = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const value = (n: number | null, unit: string) => n == null ? 'Unknown' : `${n} ${unit}`;

export function DataChat() {
  const { source, activeKind, refresh } = useDataSourceContext();
  const snapshot = useSyncExternalStore(cb => source.subscribe(cb), () => source.getSnapshot());
  const [request, setRequest] = useState<ReviewRequest>(INITIAL);
  const [reports, setReports] = useState<ReviewEvidence[]>([]);
  const [exportText, setExportText] = useState('');
  const [notice, setNotice] = useState('');
  const [weekday, setWeekday] = useState(0);
  const [hour, setHour] = useState(8);
  const labels = reviewMealLabels(snapshot.recentCarbs.data ?? []);
  const report = reports[reports.length - 1];
  const cell = report?.weekdayHours?.days[weekday]?.hours[hour];
  const [claudeConfig] = useState(loadClaudeConfig);
  // One Claude answer per generated report; a new report clears it, so an
  // explanation is never shown beside evidence it did not read.
  const [claude, setClaude] = useState<{ report: ReviewEvidence; status: 'confirm' | 'sending' | 'done' | 'error'; text: string; model?: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { abort.current?.abort(); setReports([]); setExportText(''); setNotice(''); setClaude(null); }, [source]);

  function review() {
    setReports(prev => [...prev.slice(-5), buildReviewEvidence({ snapshot, source: activeKind,
      insulinSource: activeKind === 'combined' ? loadInsulinOwner() : activeKind,
      request, therapy: activeLoopTherapy(), target: loadTargetRange(), now: new Date() })]);
    abort.current?.abort();
    setExportText(''); setNotice(''); setClaude(null);
  }
  async function askClaude() {
    if (!report) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setClaude({ report, status: 'sending', text: '' });
    try {
      const { askClaudeAboutEvidence } = await import('@/lib/ai/claudeFeedback');
      const run = await askClaudeAboutEvidence(claudeConfig, report, {
        signal: controller.signal,
        onText: text => setClaude(c => c && c.report === report && c.status === 'sending' ? { ...c, text } : c),
      });
      setClaude(c => c && c.report === report ? { report, status: 'done', text: run.text, model: run.servedBy } : c);
    } catch (err) {
      setClaude(c => c && c.report === report ? { report, status: 'error', text: err instanceof Error ? err.message : 'Claude request failed.' } : c);
    }
  }
  async function copy() {
    if (!report) return;
    const text = reviewHandoff(report);
    setExportText(text);
    try { await navigator.clipboard.writeText(text); setNotice('Copied. Paste into a Claude or ChatGPT conversation to request an AI explanation.'); }
    catch { setNotice('Select and copy the report below. Clipboard access is unavailable here.'); }
  }

  return <>
    <AppHeader title="Ask your data" showBack />
    <main className={`screen ${styles.screen}`}>
      <div>
        <h1 className="screen-title">A clearer read on your history</h1>
        <p className={styles.support}>Compare recorded meals or explore recurring low patterns, with the evidence beside the answer.</p>
      </div>
      <section className={styles.connection} aria-labelledby="claude-connection">
        <div className={styles.heading}><h2 id="claude-connection">Claude</h2><span>{claudeReady(claudeConfig) ? `Connected · ${claudeModelLabel(claudeConfig.model)}` : 'Not connected'}</span></div>
        {claudeReady(claudeConfig)
          ? <p>After you review evidence, you can ask Claude to explain it. You see the exact report before it is sent; nothing is sent automatically.</p>
          : <p>Evidence review works on this device. Connect Claude to have it explain a report, or copy the report into any AI conversation yourself.</p>}
        <Link to="/app/settings/claude">{claudeReady(claudeConfig) ? 'Claude settings' : 'Connect Claude'}</Link>
      </section>
      <form className={styles.composer} onSubmit={e => { e.preventDefault(); review(); }}>
        <div className={styles.heading}><h2>What would you like to understand?</h2><span>Local evidence</span></div>
        <label>Evidence to include
          <select value={request.topic} onChange={e => {
            const topic = e.target.value as ReviewRequest['topic'];
            setRequest(p => ({ ...p, topic, question: topic === 'meal' ? INITIAL.question : 'What do my lows by weekday and hour show, and what evidence would help understand insulin sensitivity?' }));
          }}>
            <option value="meal">Last three sittings of a food</option><option value="weekday">Weekday and hourly lows</option>
          </select>
        </label>
        <label>Look back
          <select value={request.days} onChange={e => setRequest(p => ({ ...p, days: Number(e.target.value) as ReviewRequest['days'] }))}>
            <option value={30}>30 days</option><option value={90}>90 days</option><option value={180}>180 days</option>
          </select>
        </label>
        {request.topic === 'meal' && <label>Food label from your records
          <select value={request.mealLabel} onChange={e => setRequest(p => ({ ...p, mealLabel: e.target.value }))}>
            <option value="">Choose a named food</option>{labels.map(label => <option key={label} value={label}>{label}</option>)}
          </select>
        </label>}
        {request.topic === 'meal' && !labels.length && <p className={styles.support}>No named food records loaded. Connect a source with written meal labels; an absorption icon alone cannot identify a meal.</p>}
        <label htmlFor="review-question">Your question</label>
        <textarea id="review-question" value={request.question} maxLength={2000} rows={3} onChange={e => setRequest(p => ({ ...p, question: e.target.value }))} />
        <p className={styles.support}>The local report answers the selected evidence topic. Your full question accompanies the report when copied for an AI explanation.</p>
        <Button type="submit" variant="secondary" disabled={!request.question.trim() || snapshot.recentGlucose.loading || (request.topic === 'meal' && !request.mealLabel)}>Review evidence</Button>
        {snapshot.recentGlucose.loading && <p role="status">Loading glucose history…</p>}
        {snapshot.recentGlucose.error && <p role="alert">Glucose could not refresh. <button type="button" className={styles.textButton} onClick={() => void refresh()}>Retry source</button></p>}
        <Link to="/app/settings/sources">Review connected sources</Link>
      </form>
      {report && <section className={styles.report} aria-labelledby="evidence-answer">
        <div className={styles.heading}><h2 id="evidence-answer">Evidence answer</h2><span>Calculated on device</span></div>
        <p className={styles.question}>{report.request.question}</p>
        <p role="status">{localReviewSummary(report)}</p>
        {report.sample && <SampleNote>This report contains sample data. It does not describe your personal health outcomes.</SampleNote>}
        <dl className={styles.facts}>
          <dt>Glucose source</dt><dd>{report.source}</dd>
          <dt>Insulin source</dt><dd>{report.insulinSource}</dd>
          <dt>Selected period</dt><dd>{date(report.period.startIso)} – {date(report.period.endIso)}</dd>
          <dt>Glucose slot coverage</dt><dd>{report.glucoseCoveragePct}% · {report.availableGlucose.samples.toLocaleString()} readings</dd>
          <dt>Low band</dt><dd>Below {report.target.lowMgdl} mg/dL · urgent below {report.target.urgentLowMgdl ?? 60}</dd>
          <dt>Generated</dt><dd>{date(report.generatedIso)} · {report.timeZone}</dd>
        </dl>
        {report.status.length > 0 && <ul className={styles.notes}>{report.status.map(s => <li key={s}>{s}</li>)}</ul>}
        {report.meals.map(m => <article key={m.id} className={styles.meal}>
          <h3>{date(m.iso)}</h3><p>{m.label} · {m.grams} g · {m.entries > 1 ? `${m.entries} combined entries` : 'Single entry'}</p>
          <dl className={styles.facts}>
            <dt>Recorded boluses in window</dt><dd>{value(m.bolusInWindowU, 'U')}</dd>
            <dt>Temp basal above current schedule</dt><dd>{value(m.tempBasalAboveCurrentScheduleU, 'U')}</dd>
            <dt>Temp basal below current schedule</dt><dd>{value(m.tempBasalBelowCurrentScheduleU, 'U')}</dd>
            <dt>Explicit temp-basal coverage</dt><dd>{m.tempBasalMinutes} min</dd>
            <dt>Starting glucose</dt><dd>{value(m.startMgdl, 'mg/dL')}</dd>
            <dt>Observed glucose peak</dt><dd>{value(m.peakMgdl, 'mg/dL')} · {value(m.minutesToGlucosePeak, 'min after first entry')}</dd>
            <dt>Lowest recorded glucose</dt><dd>{value(m.lowestMgdl, 'mg/dL')}</dd>
            <dt>Glucose slot coverage</dt><dd>{m.glucoseCoveragePct}% over {m.windowMinutes} min</dd>
          </dl>
          <details><summary>Delivery records and limits</summary>
            {m.boluses.map((b, i) => <p key={`${b.iso}:${i}`}>{date(b.iso)} · {b.units} U · {b.minutesFromMeal} min relative to first entry</p>)}
            <ul className={styles.notes}>{m.caveats.map(c => <li key={c}>{c}</li>)}</ul>
          </details>
        </article>)}
        {report.weekdayHours && <div className={styles.meal}>
          <h3>Weekday breakdown</h3>
          <div className={styles.weekdays}>
            {report.weekdayHours.days.map(d => {
              const eligible = d.hours.filter(h => h.reliable);
              const lowHours = eligible.filter(h => (h.lowPct ?? 0) > 0);
              return <button type="button" key={d.weekday} aria-pressed={weekday === d.weekday} onClick={() => setWeekday(d.weekday)}>
                <strong>{d.label}</strong><span>{eligible.length}/24 hours have repeated evidence · {lowHours.length} with low readings</span>
              </button>;
            })}
          </div>
          <h3>Explore one recurring hour</h3>
          <div className={styles.filters}>
            <label>Day<select value={weekday} onChange={e => setWeekday(Number(e.target.value))}>{report.weekdayHours.days.map(d => <option value={d.weekday} key={d.weekday}>{d.label}</option>)}</select></label>
            <label>Hour<select value={hour} onChange={e => setHour(Number(e.target.value))}>{Array.from({ length: 24 }, (_, h) => <option value={h} key={h}>{String(h).padStart(2, '0')}:00</option>)}</select></label>
          </div>
          {cell && <><p>{cell.reliable ? `${cell.weeksVoted} adequately sampled weeks` : `Building evidence · ${cell.weeksVoted} of 3 sampled weeks`}</p>
            <dl className={styles.facts}><dt>Median glucose</dt><dd>{value(cell.medianMgdl, 'mg/dL')}</dd>
              <dt>Below-band reading share</dt><dd>{value(cell.lowPct, '%')}</dd><dt>Weeks with low readings</dt><dd>{cell.weeksWithLow}</dd>
              <dt>Glucose change across hour</dt><dd>{value(cell.medianDeltaMgdl, 'mg/dL')}</dd></dl>
            <p className={styles.support}>Repeated hours are observations across weeks. A low pattern does not measure a new insulin sensitivity factor.</p></>}
          <Link to="/app/insights?tab=day">Open weekday charts →</Link>
        </div>}
        <details><summary>What this report can and cannot conclude</summary><ul className={styles.notes}>{report.limitations.map(l => <li key={l}>{l}</li>)}</ul></details>
        {claudeReady(claudeConfig) && (!claude || claude.report !== report) && <Button type="button" variant="primary" onClick={() => setClaude({ report, status: 'confirm', text: '' })}>Ask Claude to explain this report</Button>}
        {claude?.report === report && claude.status === 'confirm' && <div className={styles.claude}>
          <p className={styles.support}>Sends your question and this evidence report (meal times, insulin, glucose and current settings) to Anthropic. It does not include your name, source addresses or keys.</p>
          <details><summary>Exactly what will be sent</summary><textarea aria-label="Evidence that will be sent to Claude" readOnly rows={8} value={JSON.stringify({ question: report.request.question, evidence: report }, null, 2)} /></details>
          <Button type="button" variant="primary" onClick={() => void askClaude()}>Send to Claude</Button>
          <Button type="button" variant="tertiary" onClick={() => setClaude(null)}>Cancel</Button>
        </div>}
        {claude?.report === report && claude.status !== 'confirm' && <div className={styles.claude} aria-live="polite">
          <div className={styles.heading}><h3>Claude’s explanation</h3><span>{claude.status === 'done' ? `AI-generated · ${claude.model}` : claude.status === 'sending' ? 'Writing…' : 'Not completed'}</span></div>
          {claude.status === 'error' ? <p role="alert">{claude.text}</p> : <p className={`${styles.answer} ${claude.status === 'sending' ? styles.pending : ''}`}>{claude.text || 'Claude is reading the evidence…'}</p>}
          {claude.status === 'sending' && <Button type="button" variant="tertiary" onClick={() => abort.current?.abort()}>Stop</Button>}
          {claude.status === 'done' && <p className={styles.support}>An explanation of recorded evidence, not medical advice. Discuss any therapy change with your care team.</p>}
          {claude.status !== 'sending' && <Button type="button" variant="tertiary" onClick={() => setClaude({ report, status: 'confirm', text: '' })}>Ask again</Button>}
        </div>}
        <Button type="button" variant="secondary" onClick={() => void copy()}>Copy question + evidence</Button>
        {notice && <p role="status">{notice}</p>}
        {exportText && <details open><summary>Report you are choosing to share</summary><p className={styles.support}>Contains meal times, insulin, glucose and current settings. Paste only if you want to share these records with an AI service.</p><textarea aria-label="Copyable evidence report" readOnly rows={8} value={exportText} onFocus={e => e.target.select()} /></details>}
      </section>}
      {reports.length > 1 && <details><summary>Earlier reports this session ({reports.length - 1})</summary>{reports.slice(0, -1).reverse().map((r, i) => <p key={i}>{date(r.generatedIso)} · {localReviewSummary(r)}</p>)}</details>}
    </main>
  </>;
}
