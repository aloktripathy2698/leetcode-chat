import { useCallback, useEffect, useMemo, useState } from 'react';

import { checkBackendHealth, ingestProblem, streamChatRequest } from '../lib/api/client';
import { DEFAULT_BACKEND_URL, readBackendUrl } from '../lib/storage';
import type {
  ChatHistoryMessage,
  Message,
  Problem,
  ProblemScrapeResponse,
  SourceDocument,
} from '../types';

const buildGreeting = (title: string): Message => ({
  role: 'assistant',
  content: `Ready to explore “${title}”. Ask me anything about the problem, constraints, or solution strategy.`,
  timestamp: Date.now(),
});

const hasChromeRuntime = () => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined';

const openSettingsPage = () => {
  if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
    chrome.runtime.openOptionsPage();
    return;
  }
  window.open('/settings.html', '_blank', 'noopener');
};

const requestActiveProblem = (): Promise<Problem> =>
  new Promise((resolve, reject) => {
    if (!hasChromeRuntime()) {
      reject(new Error('Chrome runtime is not available.'));
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
        reject(new Error(response?.error ?? 'Unable to capture the current problem.'));
      }
    });
  });

const SidePanel = () => {
  const [problem, setProblem] = useState<Problem | null>(null);
  const [problemStatus, setProblemStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [problemError, setProblemError] = useState<string | null>(null);

  const [backendStatus, setBackendStatus] = useState<'loading' | 'ready' | 'error' | 'missing'>('loading');
  const [backendMessage, setBackendMessage] = useState<string | null>(null);

  const [ingestStatus, setIngestStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [latestSummary, setLatestSummary] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceDocument[]>([]);

  const hasValidSetup = useMemo(
    () => Boolean(problem && backendStatus === 'ready'),
    [problem, backendStatus],
  );

  useEffect(() => {
    const initialise = async () => {
      const storedUrl = await readBackendUrl();
      const reachable = await checkBackendHealth();

      if (storedUrl) {
        setBackendStatus(reachable ? 'ready' : 'error');
        setBackendMessage(
          reachable
            ? `Connected to ${storedUrl}`
            : `Configured backend (${storedUrl}) is not reachable. Start the Docker stack or adjust the URL in Settings.`,
        );
      } else {
        setBackendStatus(reachable ? 'ready' : 'missing');
        setBackendMessage(
          reachable
            ? `Using default backend at ${DEFAULT_BACKEND_URL}.`
            : 'No backend URL saved. Open Settings to configure your FastAPI endpoint.',
        );
      }

      try {
        const activeProblem = await requestActiveProblem();
        setProblem(activeProblem);
        setProblemStatus('ready');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to detect the current problem.';
        setProblemStatus('error');
        setProblemError(message);
      }
    };

    void initialise();
  }, []);

  useEffect(() => {
    if (!problem) {
      return;
    }
    setMessages([buildGreeting(problem.title)]);
    setLatestSummary(null);
    setSources([]);
  }, [problem]);

  const refreshProblem = useCallback(async () => {
    setProblemStatus('loading');
    setProblemError(null);
    setIngestStatus('idle');
    try {
      const activeProblem = await requestActiveProblem();
      setProblem(activeProblem);
      setProblemStatus('ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to detect the current problem.';
      setProblemStatus('error');
      setProblemError(message);
    }
  }, []);

  useEffect(() => {
    if (!hasChromeRuntime()) {
      return;
    }

    const handleRuntimeMessage: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message) => {
      if (message && typeof message === 'object' && (message as { type?: string }).type === 'ACTIVE_PROBLEM_CHANGED') {
        void refreshProblem();
      }
    };

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    };
  }, [refreshProblem]);

  useEffect(() => {
    if (!problem || backendStatus !== 'ready') {
      return;
    }

    setIngestStatus('syncing');
    setChatError(null);

    ingestProblem(problem)
      .then(() => {
        setIngestStatus('synced');
      })
      .catch((error) => {
        setIngestStatus('error');
        setChatError((error as Error).message);
      });
  }, [problem, backendStatus]);

  const handleSend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = input.trim();
    if (!question || !problem || backendStatus !== 'ready') {
      return;
    }

    setInput('');
    setChatError(null);
    setLatestSummary(null);
    setSources([]);

    const userMessage: Message = {
      role: 'user',
      content: question,
      timestamp: Date.now(),
    };
    const assistantMessage: Message = {
      role: 'assistant',
      content: '',
      timestamp: Date.now() + 1,
    };
    const assistantId = assistantMessage.timestamp;

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setIsThinking(true);

    const history: ChatHistoryMessage[] = [...messages, userMessage].map((message) => ({
      role: message.role,
      content: message.content,
    }));

    try {
      await streamChatRequest(
        {
          question,
          problem: {
            slug: problem.slug,
            title: problem.title,
            difficulty: problem.difficulty,
            description: problem.description,
            url: problem.url,
          },
          history,
        },
        (streamEvent) => {
          switch (streamEvent.type) {
            case 'sources':
              setSources(streamEvent.sources);
              break;
            case 'token':
              setMessages((prev) =>
                prev.map((message) =>
                  message.timestamp === assistantId
                    ? { ...message, content: `${message.content}${streamEvent.token}` }
                    : message,
                ),
              );
              break;
            case 'summary':
              setLatestSummary(streamEvent.summary);
              break;
            case 'end':
              setMessages((prev) =>
                prev.map((message) =>
                  message.timestamp === assistantId
                    ? { ...message, content: streamEvent.payload.answer }
                    : message,
                ),
              );
              setLatestSummary(streamEvent.payload.summary);
              setSources(streamEvent.payload.sources);
              setIsThinking(false);
              break;
            case 'cached':
              setMessages((prev) =>
                prev.map((message) =>
                  message.timestamp === assistantId
                    ? { ...message, content: streamEvent.payload.answer }
                    : message,
                ),
              );
              setLatestSummary(streamEvent.payload.summary);
              setSources(streamEvent.payload.sources);
              setIsThinking(false);
              break;
            case 'error':
              setChatError(streamEvent.error);
              setMessages((prev) =>
                prev.map((message) =>
                  message.timestamp === assistantId
                    ? {
                        ...message,
                        content: 'Assistant encountered an error. Please try again.',
                      }
                    : message,
                ),
              );
              setIsThinking(false);
              break;
            default:
              break;
          }
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error while contacting the backend.';
      setChatError(message);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.timestamp === assistantId
            ? { ...msg, content: 'Assistant failed to respond. Please try again.' }
            : msg,
        ),
      );
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="flex h-screen flex-col">
        <header className="border-b border-white/5 bg-gradient-to-r from-purple-600 via-purple-500 to-orange-500 p-5 text-white shadow-lg">
          <p className="text-xs uppercase tracking-widest text-white/70">LeetCode Assistant</p>
          <h1 className="mt-1 text-2xl font-semibold">Problem workspace</h1>
          <p className="mt-1 text-sm text-white/80">
            Ask focused questions about the problem you have open on LeetCode and get guidance powered by your FastAPI backend.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span
              className={`rounded-full px-3 py-1 font-semibold ${
                problemStatus === 'ready'
                  ? 'bg-emerald-500/20 text-emerald-100'
                  : problemStatus === 'loading'
                    ? 'bg-slate-500/20 text-slate-200'
                    : 'bg-rose-500/30 text-rose-100'
              }`}
            >
              {problemStatus === 'ready' ? 'Problem detected' : problemStatus === 'loading' ? 'Detecting problem…' : 'Problem not found'}
            </span>
            <span
              className={`rounded-full px-3 py-1 font-semibold ${
                backendStatus === 'ready'
                  ? 'bg-emerald-500/20 text-emerald-100'
                  : backendStatus === 'loading'
                    ? 'bg-slate-500/20 text-slate-200'
                    : backendStatus === 'missing'
                      ? 'bg-amber-500/30 text-amber-100'
                      : 'bg-rose-500/30 text-rose-100'
              }`}
            >
              {backendStatus === 'ready'
                ? 'Backend reachable'
                : backendStatus === 'loading'
                  ? 'Checking backend…'
                  : backendStatus === 'missing'
                    ? 'Backend not configured'
                    : 'Backend unreachable'}
            </span>
            {ingestStatus !== 'idle' && (
              <span
                className={`rounded-full px-3 py-1 font-semibold ${
                  ingestStatus === 'synced'
                    ? 'bg-emerald-500/20 text-emerald-100'
                    : ingestStatus === 'syncing'
                      ? 'bg-slate-500/20 text-slate-200'
                      : 'bg-rose-500/30 text-rose-100'
                }`}
              >
                {ingestStatus === 'synced'
                  ? 'Context synced'
                  : ingestStatus === 'syncing'
                    ? 'Syncing context…'
                    : 'Context sync failed'}
              </span>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void refreshProblem();
              }}
              className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white transition hover:border-white/60"
            >
              Refresh problem
            </button>
            <button
              type="button"
              onClick={openSettingsPage}
              className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white transition hover:border-white/60"
            >
              Open settings
            </button>
          </div>
          {problemError && (
            <p className="mt-3 rounded-lg border border-rose-300/40 bg-rose-500/20 px-3 py-2 text-xs text-rose-100">
              {problemError}
            </p>
          )}
          {backendMessage && (
            <p className="mt-3 rounded-lg border border-white/20 bg-black/20 px-3 py-2 text-xs text-white/80">
              {backendMessage}
            </p>
          )}
        </header>

        <main className="flex-1 overflow-y-auto space-y-5 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-5">
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg">
            {problemStatus === 'ready' && problem ? (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-widest text-orange-200/70">Current problem</p>
                  <h2 className="mt-1 text-xl font-semibold text-white">{problem.title}</h2>
                  <p className="text-xs text-slate-300/70">
                    #{problem.problemNumber} · {problem.difficulty}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                    problem.difficulty === 'Easy'
                      ? 'bg-emerald-500/15 text-emerald-200'
                      : problem.difficulty === 'Medium'
                        ? 'bg-amber-500/20 text-amber-100'
                        : 'bg-rose-500/20 text-rose-100'
                  }`}
                >
                  {problem.difficulty}
                </span>
              </div>
            ) : (
              <p className="text-sm text-slate-200/80">
                Open a problem on <span className="font-semibold text-orange-200">leetcode.com</span> to start a session.
              </p>
            )}

            {problem?.url && (
              <button
                type="button"
                onClick={() => window.open(problem.url, '_blank', 'noopener')}
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-orange-300/50 px-4 py-2 text-xs font-semibold text-orange-200 transition hover:border-orange-200 hover:text-orange-50"
              >
                View on LeetCode ↗
              </button>
            )}
          </section>

          <section className="flex h-[420px] flex-col rounded-2xl border border-white/10 bg-white/5 shadow-lg">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <h2 className="text-sm font-semibold text-white">Chat</h2>
              <span className="text-[11px] text-slate-300/80">
                {messages.length} {messages.length === 1 ? 'message' : 'messages'}
              </span>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {messages.map((message) => (
                <div
                  key={`${message.timestamp}-${message.role}-${message.content.slice(0, 8)}`}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow ${
                      message.role === 'user'
                        ? 'bg-orange-500/90 text-white shadow-orange-500/40'
                        : 'bg-black/40 text-slate-100 shadow-black/30'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{message.content}</p>
                    <span className="mt-2 block text-right text-[10px] uppercase tracking-widest text-white/60">
                      {message.role === 'user' ? 'You' : 'Assistant'} •{' '}
                      {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
              {isThinking && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl bg-black/40 px-4 py-3 text-xs text-slate-200">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-orange-300" />
                    Assistant is thinking…
                  </div>
                </div>
              )}
            </div>

            <form
              onSubmit={(event) => {
                void handleSend(event);
              }}
              className="border-t border-white/10 p-4"
            >
              <fieldset className="flex gap-2 rounded-2xl border border-white/10 bg-black/40 p-2 focus-within:border-orange-400/80">
                <label htmlFor="sidepanel-input" className="sr-only">
                  Ask a question about the problem
                </label>
                <textarea
                  id="sidepanel-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={
                    backendStatus === 'ready'
                      ? problemStatus === 'ready'
                        ? `Ask about ${problem?.title ?? 'the problem'}…`
                        : 'Problem not detected yet.'
                      : 'Backend unavailable. Configure it in Settings.'
                  }
                  className="h-20 flex-1 resize-none rounded-xl border-0 bg-transparent text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none"
                  spellCheck
                  disabled={!hasValidSetup || isThinking || problemStatus !== 'ready'}
                />
                <button
                  type="submit"
                  disabled={!hasValidSetup || isThinking || problemStatus !== 'ready' || !input.trim()}
                  className="self-end rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-orange-500/30 transition disabled:cursor-not-allowed disabled:bg-orange-500/40"
                >
                  Send
                </button>
              </fieldset>
              {chatError && (
                <p className="mt-2 rounded-lg border border-rose-300/40 bg-rose-500/20 px-3 py-2 text-xs text-rose-100">
                  {chatError}
                </p>
              )}
            </form>
          </section>

          {(latestSummary || sources.length > 0) && (
            <section className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg">
              {latestSummary && (
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-orange-200/80">Key takeaways</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200/90">{latestSummary}</p>
                </div>
              )}

              {sources.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-orange-200/80">Context used</h3>
                  <ul className="mt-2 space-y-2 text-sm text-slate-200/90">
                    {sources.map((source, index) => (
                      <li key={`${source.title}-${index}`} className="rounded-xl border border-white/10 bg-black/40 p-3">
                        <p className="font-semibold text-white">{source.title}</p>
                        <p className="mt-1 text-xs text-slate-300/80">{source.snippet}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
};

export default SidePanel;
