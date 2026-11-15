// Care-team tile: two modes in one place.
// Contact: the thread, plus Email, which opens your own mail app addressed to
// your care team with your message filled in. LoopStack sends nothing itself.
// Notes: things to bring up with your care team, kept on this Mac, which you
// can email in one go or take to the visit.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { openCareNotes, takeCareNotes } from '../data/intent';
import { DATA, PATIENT } from '../data/current';
import { isEmail, mailto, notesBody, useCareContact, useCareNotes, type CareContact } from '../data/careContact';
import type { Go } from '../nav';
import { useStore } from '../state';
import { Segmented, useAnnounce } from '../ui/kit';
import { Thread } from './faces';

type Mode = 'contact' | 'notes';
const MODES: { value: Mode; label: string }[] = [{ value: 'contact', label: 'Contact care team' }, { value: 'notes', label: 'Notes for care team' }];
const careName = (c: CareContact | null) => c?.name || PATIENT.clinician;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const subject = (what: string) => `${what} from ${PATIENT.first} · LoopStack`;

/** A plain link to the person's own mail app. The page never sends mail. */
function MailLink({ href, children, className = 'cta glass-green', disabledReason }: { href: string | null; children: string; className?: string; disabledReason?: string }) {
  if (!href) return disabledReason ? <button type="button" className={className} disabled title={disabledReason}>{children}</button> : null;
  return <a className={className} href={href}>{children}</a>;
}

// ------------------------------------------------------------ glance

export function CareThreadGlance({ h, go }: { h: number; go: Go }) {
  const [mode, setMode] = useState<Mode>('contact');
  const [contact] = useCareContact();
  const [notes] = useCareNotes();
  return (
    <div className="face care-face">
      <Segmented size="sm" label="Care team" items={[{ value: 'contact', label: 'Contact' }, { value: 'notes', label: `Notes${notes.length ? ` · ${notes.length}` : ''}` }]} value={mode} onChange={setMode} />
      {mode === 'contact' ? (
        <>
          <span className="caption">{cap(careName(contact))} · next visit {PATIENT.nextVisit}</span>
          <div className="grow clip"><Thread side="patient" limit={h > 2 ? 4 : 2} /></div>
          <div className="row wrap care-actions">
            {contact
              ? <MailLink className="text-btn" href={mailto(contact.email, subject('A message'), '')}>{`Email ${contact.email}`}</MailLink>
              : <button type="button" className="text-btn" onClick={() => go({ tile: 'care-thread' })}>Add their email</button>}
            <button type="button" className="text-btn" onClick={() => go({ tile: 'care-thread' })}>Open the thread</button>
          </div>
        </>
      ) : (
        <>
          <div className="grow clip">
            {notes.length
              ? <ul className="care-notes compact">{notes.slice(-(h > 2 ? 4 : 2)).reverse().map((n) => <li key={n.id}><span className="caption">{n.date}</span> <span className="small">{n.text}</span></li>)}</ul>
              : <p className="small">Nothing noted yet. Jot down what you want to bring up at the next visit.</p>}
          </div>
          <button type="button" className="text-btn" onClick={() => { openCareNotes(); go({ tile: 'care-thread' }); }}>{notes.length ? 'Open your notes' : 'Add a note'}</button>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------ detail

export function CareThreadDetail() {
  // The glance's Notes links open straight on Notes.
  const [mode, setMode] = useState<Mode>(() => (takeCareNotes() ? 'notes' : 'contact'));
  return (
    <div className="stack-16" style={{ width: '100%' }}>
      <Segmented label="Care team" items={MODES} value={mode} onChange={setMode} />
      {mode === 'contact' ? <ContactPane /> : <NotesPane />}
    </div>
  );
}

function ContactPane() {
  const { send } = useStore();
  const announce = useAnnounce();
  const [contact] = useCareContact();
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    send({ from: 'sam', date: DATA.today, text: text.trim() });
    setText('');
    announce(`Added to the thread with ${careName(contact)}.`);
  };
  const emailHref = contact && text.trim() ? mailto(contact.email, subject('A message'), text.trim()) : null;
  return (
    <div className="detail-grid">
      <section className="panel stack-12" aria-label="Thread">
        <Thread side="patient" />
        <form className="composer" onSubmit={submit}>
          <label className="sr-only" htmlFor="compose">Message to {careName(contact)}</label>
          <textarea id="compose" value={text} maxLength={4000} placeholder={`Write to ${careName(contact)}`} onChange={(e) => setText(e.target.value)} />
          <div className="row between wrap">
            <span className="caption">You choose what you share. Email opens your mail app with this message; you send it.</span>
            <div className="row wrap">
              <button type="submit" className="quiet-btn">Add to thread</button>
              <MailLink href={emailHref} disabledReason={contact ? 'Write a message first' : undefined}>Email it</MailLink>
            </div>
          </div>
        </form>
      </section>
      <ContactCard />
    </div>
  );
}

/** Who the care team is, and the one address Email writes to. */
function ContactCard() {
  const [contact, setContact] = useCareContact();
  const announce = useAnnounce();
  const [editing, setEditing] = useState(!contact);
  const [name, setName] = useState(contact?.name ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const afterRef = useRef<HTMLAnchorElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [focusNext, setFocusNext] = useState<'saved' | 'removed' | null>(null);
  useEffect(() => {
    if (focusNext === 'saved') afterRef.current?.focus();
    if (focusNext === 'removed') emailRef.current?.focus();
    if (focusNext) setFocusNext(null);
  }, [focusNext]);
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) { setError('Enter one email address, like clinic@example.org.'); return; }
    setContact({ name, email });
    setError(null);
    setEditing(false);
    setFocusNext('saved');
    announce('Care-team email saved on this Mac.');
  };
  return (
    <aside className="panel stack-12" aria-labelledby="care-contact-h">
      <h3 id="care-contact-h" className="h3">{cap(careName(contact))}</h3>
      <p className="small">Next visit {PATIENT.nextVisit}. Involvement: {PATIENT.engagement.toLowerCase()}.</p>
      {editing ? (
        <form className="stack-8" onSubmit={save} noValidate>
          <label className="caption strong" htmlFor="care-name">Name (optional)</label>
          <input id="care-name" className="ai-input" value={name} maxLength={80} placeholder="Dr. Okafor’s office" onChange={(e) => setName(e.target.value)} />
          <label className="caption strong" htmlFor="care-email">Email</label>
          <input id="care-email" ref={emailRef} className="ai-input" type="email" inputMode="email" autoComplete="off" value={email} maxLength={200} placeholder="clinic@example.org" onChange={(e) => { setEmail(e.target.value); setError(null); }} aria-invalid={Boolean(error)} aria-describedby={error ? 'care-email-err' : undefined} />
          {error && <p id="care-email-err" className="caption error" role="alert">{error}</p>}
          <div className="row wrap">
            <button type="submit" className="solid-btn">Save</button>
            {contact && <button type="button" className="quiet-btn" onClick={() => { setEditing(false); setName(contact.name); setEmail(contact.email); setError(null); }}>Cancel</button>}
          </div>
          <p className="caption">Kept on this Mac only. LoopStack never sends mail; Email opens your own mail app.</p>
        </form>
      ) : contact && (
        <div className="stack-8">
          <a ref={afterRef} className="quiet-btn" href={mailto(contact.email, subject('A message'), '') ?? undefined}>Email {contact.email}</a>
          <div className="row wrap">
            <button type="button" className="text-btn" onClick={() => setEditing(true)}>Change</button>
            <button type="button" className="text-btn" onClick={() => { setContact(null); setName(''); setEmail(''); setEditing(true); setFocusNext('removed'); announce('Care-team email removed.'); }}>Remove</button>
          </div>
        </div>
      )}
      <p className="caption">LoopStack never changes your pump or your settings. Anything you agree, you change yourself in Loop.</p>
    </aside>
  );
}

function NotesPane() {
  const [notes, { add, remove }] = useCareNotes();
  const [contact] = useCareContact();
  const announce = useAnnounce();
  const [text, setText] = useState('');
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    add(text, DATA.today);
    setText('');
    announce('Note saved.');
    noteRef.current?.focus();
  };
  const emailHref = contact && notes.length ? mailto(contact.email, subject('Notes for my visit'), notesBody(notes)) : null;
  return (
    <div className="detail-grid">
      <section className="panel stack-12" aria-labelledby="notes-h">
        <h3 id="notes-h" className="h3">Notes for {careName(contact)}</h3>
        <p className="small">Questions and things you noticed, to bring up at the next visit. They stay on this Mac until you email them.</p>
        <form className="composer" onSubmit={submit}>
          <label className="sr-only" htmlFor="care-note">New note</label>
          <textarea id="care-note" ref={noteRef} value={text} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }} maxLength={2000} placeholder="For example: Sunday mornings run low after long rides. Ask about the exercise preset." onChange={(e) => setText(e.target.value)} />
          <div className="row between wrap">
            <span className="caption">Saved on this Mac only.</span>
            <button type="submit" className="quiet-btn" disabled={!text.trim()}>Save note</button>
          </div>
        </form>
        {notes.length > 0 && (
          <ol className="care-notes">
            {[...notes].reverse().map((n) => (
              <li key={n.id}>
                <div className="stack-4" style={{ minWidth: 0 }}>
                  <span className="caption">{n.date}</span>
                  <span className="small ink">{n.text}</span>
                </div>
                <button type="button" className="text-btn" aria-label={`Delete the note from ${n.date}`} onClick={() => { remove(n.id); announce(`Note from ${n.date} deleted.`); noteRef.current?.focus(); }}>Delete</button>
              </li>
            ))}
          </ol>
        )}
      </section>
      <aside className="panel stack-12" aria-label="Send your notes">
        <h3 className="h3">Send them</h3>
        {emailHref
          ? <><MailLink href={emailHref}>{`Email ${notes.length} note${notes.length === 1 ? '' : 's'}`}</MailLink><p className="caption">Opens your mail app addressed to {contact!.email}, with every note in the message. You read it and send it.</p></>
          : !contact
            ? <p className="small">Add your care team’s email under Contact care team to email your notes.</p>
            : <p className="small">Save a note first.</p>}
      </aside>
    </div>
  );
}
