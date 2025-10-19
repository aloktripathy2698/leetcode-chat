import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Globe, Link as LinkIcon, Save } from 'lucide-react';

import { checkBackendHealth } from '../lib/api/client';
import { DEFAULT_BACKEND_URL, readBackendUrl, saveBackendUrl } from '../lib/storage';

type Status = { type: 'success' | 'error' | 'info' | null; message: string };

const Settings = () => {
  const [backendUrl, setBackendUrl] = useState('');
  const [status, setStatus] = useState<Status>({ type: null, message: '' });
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'loading' | 'connected' | 'failed'>('idle');

  useEffect(() => {
    const hydrate = async () => {
      const stored = await readBackendUrl();
      setBackendUrl(stored ?? DEFAULT_BACKEND_URL);
    };

    void hydrate();
  }, []);

  const handleSave = async () => {
    const trimmed = backendUrl.trim();
    if (!trimmed) {
      setStatus({ type: 'error', message: '❌ Please provide a backend URL.' });
      return;
    }

    try {
      await saveBackendUrl(trimmed);
      setStatus({ type: 'success', message: '✅ Backend URL saved. Your extension will use it immediately.' });
      setTimeout(() => setStatus({ type: null, message: '' }), 3000);
    } catch (error) {
      setStatus({
        type: 'error',
        message: `❌ Unable to save settings: ${(error as Error).message}`,
      });
    }
  };

  const handleTestConnection = async () => {
    setConnectionStatus('loading');
    setStatus({ type: 'info', message: '🔄 Checking backend health…' });

    try {
      const reachable = await checkBackendHealth();
      setConnectionStatus(reachable ? 'connected' : 'failed');
      setStatus({
        type: reachable ? 'success' : 'error',
        message: reachable
          ? '✅ Backend reachable. Chat requests can be processed.'
          : '❌ Backend not reachable. Confirm Docker Compose services are running.',
      });
    } catch (error) {
      setConnectionStatus('failed');
      setStatus({
        type: 'error',
        message: `❌ Connection test failed: ${(error as Error).message}`,
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 py-10 px-5 text-slate-100">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-2xl">
        <header className="bg-gradient-to-r from-orange-500 to-purple-600 px-8 py-10 text-white">
          <p className="text-xs uppercase tracking-widest text-white/70">LeetCode Assistant</p>
          <h1 className="mt-2 text-3xl font-bold">Settings</h1>
          <p className="mt-3 max-w-xl text-sm text-white/80">
            Configure how the Chrome extension connects to your FastAPI backend. Keep the Docker services running when
            you want real-time guidance.
          </p>
        </header>

        <main className="space-y-8 px-8 py-10">
          <section>
            <div className="flex items-center gap-3 text-slate-200">
              <Globe className="h-6 w-6" />
              <div>
                <h2 className="text-xl font-semibold">Backend endpoint</h2>
                <p className="text-sm text-slate-300/90">
                  The extension sends chat requests and problem ingestions to this URL. Default points to the local
                  Docker Compose stack.
                </p>
              </div>
            </div>

            <label htmlFor="backend-url" className="mt-6 block text-sm font-medium text-slate-200">
              API base URL
            </label>
            <div className="mt-2 flex gap-3">
              <div className="relative flex-1">
                <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="backend-url"
                  type="url"
                  value={backendUrl}
                  onChange={(event) => setBackendUrl(event.target.value)}
                  placeholder="http://localhost:8000/api/v1"
                  className="w-full rounded-xl border border-white/15 bg-black/30 py-3 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-orange-400 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => setBackendUrl(DEFAULT_BACKEND_URL)}
                className="rounded-xl border border-white/20 px-4 py-3 text-sm font-semibold text-orange-200 transition hover:border-orange-300 hover:text-orange-50"
              >
                Reset
              </button>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  void handleSave();
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-orange-500/30 transition hover:bg-orange-500/90"
              >
                <Save className="h-4 w-4" /> Save settings
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleTestConnection();
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold text-white transition hover:border-white/40"
              >
                <CheckCircle2 className="h-4 w-4" /> Test connection
              </button>
              {connectionStatus === 'connected' && (
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200">
                  <CheckCircle2 className="h-3 w-3" /> Backend reachable
                </span>
              )}
              {connectionStatus === 'failed' && (
                <span className="inline-flex items-center gap-2 rounded-full bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-100">
                  <AlertCircle className="h-3 w-3" /> Backend unreachable
                </span>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-slate-200">
            <h3 className="text-lg font-semibold text-white">How to run the backend</h3>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-slate-300">
              <li>Install Docker and Docker Compose.</li>
              <li>Duplicate <code>apps/api/.env.example</code>, rename to <code>apps/api/.env</code>, and add your OpenAI key.</li>
              <li>
                Run <code>docker compose -f infra/docker/docker-compose.yml up --build</code> from the project root.
              </li>
              <li>
                When everything is ready, test the connection above. The API serves health checks at <code>/health</code>.
              </li>
            </ol>
          </section>

          {status.type && (
            <div
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
                status.type === 'success'
                  ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
                  : status.type === 'error'
                    ? 'border-rose-400/40 bg-rose-500/15 text-rose-100'
                    : 'border-orange-400/40 bg-orange-500/10 text-orange-100'
              }`}
            >
              {status.type === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
              <span>{status.message}</span>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default Settings;
