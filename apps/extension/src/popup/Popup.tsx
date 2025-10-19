import { useEffect, useState } from 'react';

import { checkBackendHealth } from '../lib/api/client';
import { DEFAULT_BACKEND_URL, readBackendUrl } from '../lib/storage';
import type { Problem, ProblemScrapeResponse } from '../types';

const hasChromeRuntime = () =>
  typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined';

const requestProblem = (): Promise<Problem> =>
  new Promise((resolve, reject) => {
    if (!hasChromeRuntime()) {
      reject(new Error('Chrome runtime unavailable.'));
      return;
    }

    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_PROBLEM' }, (response: ProblemScrapeResponse) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (response?.success && response.problem) {
        resolve(response.problem);
      } else {
        reject(new Error(response?.error ?? 'Unable to detect the current problem.'));
      }
    });
  });

type BackendStatus = 'loading' | 'connected' | 'configured' | 'missing';

const Popup = () => {
  const [problem, setProblem] = useState<Problem | null>(null);
  const [problemStatus, setProblemStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [problemError, setProblemError] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('loading');
  const [backendStatusMessage, setBackendStatusMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    const hydrate = async () => {
      const storedUrl = await readBackendUrl();
      const reachable = await checkBackendHealth();

      if (storedUrl) {
        setBackendStatus(reachable ? 'connected' : 'configured');
        setBackendStatusMessage(
          reachable
            ? `Connected to ${storedUrl}`
            : `Configured backend (${storedUrl}) is not reachable. Start the services or update the URL in Settings.`,
        );
      } else {
        setBackendStatus(reachable ? 'connected' : 'missing');
        setBackendStatusMessage(
          reachable
            ? `Using default backend at ${DEFAULT_BACKEND_URL}.`
            : 'No backend URL saved. Open Settings to configure one or start the local Docker stack.',
        );
      }

      try {
        const activeProblem = await requestProblem();
        setProblem(activeProblem);
        setProblemStatus('ready');
      } catch (error) {
        setProblemStatus('error');
        setProblemError(error instanceof Error ? error.message : String(error));
      }
    };

    void hydrate();
  }, []);

  const handleOpenSidePanel = () => {
    if (!hasChromeRuntime()) {
      window.open('/sidepanel.html', '_blank', 'noopener');
      return;
    }

    chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }, (response?: { success: boolean; error?: string }) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        setStatusMessage(lastError.message);
        return;
      }
      if (response?.success) {
        setStatusMessage('Side panel opened in the current tab.');
        return;
      }
      setStatusMessage(response?.error ?? 'Unable to open side panel automatically.');
    });
  };

  return (
    <div className="min-h-[360px] w-[360px] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="flex flex-col gap-4 p-4">
        <header className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg backdrop-blur">
          <p className="text-xs uppercase tracking-wide text-orange-300">LeetCode Assistant</p>
          <h1 className="mt-1 text-xl font-semibold text-white">Control Center</h1>
          <p className="mt-2 text-sm text-slate-200/80">
            Launch the side panel, refresh the detected problem, or jump to settings to adjust backend connectivity.
          </p>
        </header>

        <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4 shadow-inner">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Current problem</h2>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                problemStatus === 'ready'
                  ? 'bg-emerald-500/20 text-emerald-100'
                  : problemStatus === 'loading'
                    ? 'bg-slate-500/20 text-slate-200'
                    : 'bg-rose-500/30 text-rose-100'
              }`}
            >
              {problemStatus === 'ready' ? 'Detected' : problemStatus === 'loading' ? 'Detecting…' : 'Not found'}
            </span>
          </div>

          {problemStatus === 'ready' && problem ? (
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
              <p className="text-sm font-semibold text-white">{problem.title}</p>
              <p className="text-xs text-slate-300/70">#{problem.problemNumber} · {problem.difficulty}</p>
            </div>
          ) : (
            <p className="text-xs text-slate-200/80">Open a LeetCode problem tab to see details here.</p>
          )}

          {problemError && (
            <p className="rounded-lg border border-rose-300/40 bg-rose-500/20 px-3 py-2 text-xs text-rose-100">
              {problemError}
            </p>
          )}
        </section>

        <section className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
          <h2 className="text-sm font-semibold text-white">Quick actions</h2>
          <button
            type="button"
            onClick={handleOpenSidePanel}
            className="w-full rounded-xl bg-orange-500/90 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-orange-500/30 transition hover:bg-orange-500"
          >
            Open explanation panel
          </button>
          <button
            type="button"
            onClick={() => chrome.runtime.openOptionsPage?.()}
            className="w-full rounded-xl border border-white/20 px-4 py-3 text-sm font-semibold text-orange-200 transition hover:border-orange-400/80 hover:text-orange-50"
          >
            Configure backend settings
          </button>
        </section>

        <section className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
          <h2 className="text-sm font-semibold text-white">Backend status</h2>
          <p className="text-xs text-slate-200/80">
            {backendStatus === 'loading'
              ? 'Checking backend connectivity…'
              : backendStatus === 'connected'
                ? backendStatusMessage ?? 'Backend reachable and ready.'
                : backendStatus === 'configured'
                  ? backendStatusMessage ?? 'Backend URL saved but currently unreachable.'
                  : backendStatusMessage ?? 'No backend URL saved yet.'}
          </p>
        </section>

        {statusMessage && (
          <p className="rounded-lg border border-orange-300/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-100">
            {statusMessage}
          </p>
        )}
      </div>
    </div>
  );
};

export default Popup;
