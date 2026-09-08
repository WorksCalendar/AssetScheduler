import { useEffect, useState } from 'react';

import { sendTestPush, type Settings } from './api';
import type { Member } from './types';

interface Props {
  settings: Settings;
  members: Member[];
  onSave: (next: Settings) => void;
  onClose: () => void;
}

/**
 * Where each phone is told which person it belongs to and how to reach the
 * house. The ntfy topic shown here is the piece that has to be copied into the
 * ntfy app by hand — there is no way for a web page to subscribe a phone to
 * push on its behalf.
 */
export function SettingsDialog({ settings, members, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [pushState, setPushState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [pushError, setPushError] = useState('');
  const [copied, setCopied] = useState(false);

  const me = members.find((m) => m.id === draft.meId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function testPush() {
    if (!me) return;
    setPushState('sending');
    setPushError('');
    try {
      await sendTestPush(draft, me.id);
      setPushState('sent');
    } catch (err) {
      setPushState('failed');
      setPushError(err instanceof Error ? err.message : String(err));
    }
  }

  async function copyTopic() {
    if (!me?.ntfyTopic) return;
    try {
      await navigator.clipboard.writeText(me.ntfyTopic);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused outside a secure context; the topic is on
      // screen and can be typed.
    }
  }

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Settings">
        <header className="dialog-head">
          <h2>Settings</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="dialog-body">
          <div className="field">
            <label className="field-label" htmlFor="set-me">This phone belongs to</label>
            <select
              id="set-me"
              className="input"
              value={draft.meId}
              onChange={(e) => setDraft({ ...draft, meId: e.target.value })}
            >
              <option value="">Nobody in particular</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName}</option>
              ))}
            </select>
            <p className="field-hint">
              Used so you are not notified about your own edits, and to show the right push topic below.
            </p>
          </div>

          {me && (
            <div className="field notify-box">
              <span className="field-label">Push notifications for {me.displayName}</span>
              {me.ntfyTopic === '' ? (
                <p className="field-hint">
                  The topic is only served on the home network. Open this app on home wifi to see it.
                </p>
              ) : (
                <>
                  <ol className="steps">
                    <li>Install the <strong>ntfy</strong> app.</li>
                    <li>
                      Add a subscription on <code>{draft.ntfyUrl}</code> to this topic:
                      <code className="topic">{me.ntfyTopic}</code>
                    </li>
                    <li>Send yourself a test below.</li>
                  </ol>
                  <div className="button-row">
                    <button type="button" className="button" onClick={copyTopic}>
                      {copied ? 'Copied' : 'Copy topic'}
                    </button>
                    <button type="button" className="button" onClick={testPush} disabled={pushState === 'sending'}>
                      {pushState === 'sending' ? 'Sending…' : 'Send test'}
                    </button>
                  </div>
                  {pushState === 'sent' && <p className="field-hint good">Sent. It should arrive in a second or two.</p>}
                  {pushState === 'failed' && <p className="field-error">{pushError}</p>}
                  <p className="field-hint">
                    Anyone who knows this topic can read your notifications. Rotate it from the
                    server if it leaks: <code>POST /api/members/{me.id}/rotate-topic</code>
                  </p>
                </>
              )}
            </div>
          )}

          <div className="field">
            <label className="field-label" htmlFor="set-home">Home server</label>
            <input
              id="set-home"
              className="input mono"
              value={draft.homeUrl}
              placeholder="http://192.168.1.20:8090"
              onChange={(e) => setDraft({ ...draft, homeUrl: e.target.value.trim() })}
            />
            <p className="field-hint">Leave empty if this app is served by the home server itself.</p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="set-token">API token</label>
            <input
              id="set-token"
              className="input mono"
              type="password"
              value={draft.apiToken}
              onChange={(e) => setDraft({ ...draft, apiToken: e.target.value.trim() })}
            />
            <p className="field-hint">Only if the server was started with FC_API_TOKEN.</p>
          </div>

          <details className="field">
            <summary className="field-label">Reading from away (optional)</summary>
            <p className="field-hint">
              The home server is not on the internet. Point this at the Supabase mirror and the
              calendar still opens on mobile data — read only; edits wait for home wifi.
            </p>
            <input
              className="input mono"
              value={draft.supabaseUrl}
              placeholder="https://yourproject.supabase.co"
              aria-label="Supabase URL"
              onChange={(e) => setDraft({ ...draft, supabaseUrl: e.target.value.trim() })}
            />
            <input
              className="input mono"
              type="password"
              value={draft.supabaseAnonKey}
              placeholder="anon key"
              aria-label="Supabase anon key"
              onChange={(e) => setDraft({ ...draft, supabaseAnonKey: e.target.value.trim() })}
            />
          </details>

          <div className="field">
            <label className="field-label" htmlFor="set-ntfy">ntfy server</label>
            <input
              id="set-ntfy"
              className="input mono"
              value={draft.ntfyUrl}
              onChange={(e) => setDraft({ ...draft, ntfyUrl: e.target.value.trim() })}
            />
          </div>
        </div>

        <footer className="dialog-foot">
          <span className="spacer" />
          <button type="button" className="button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => { onSave(draft); onClose(); }}
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
