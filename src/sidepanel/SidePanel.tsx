import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Message, Problem, ProblemScrapeResponse } from '../types';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`;

const buildGreeting = (title: string): Message => ({
  role: 'assistant',
  content: `I'm ready to help with “${title}”. Ask anything about the problem or describe what feels unclear.`,
  timestamp: Date.now(),
});

const hasChromeRuntime = () =>
  typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined';

const openSettingsPage = () => {
  if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
    chrome.runtime.openOptionsPage();
    return;
  }
  window.open('/settings.html', '_blank', 'noopener');
};

const fetchApiKey = (): Promise<string | null> =>
  new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.sync) {
      resolve(null);
      return;
    }

    chrome.storage.sync.get(['apiKey'], (result) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      const value = typeof result.apiKey === 'string' ? result.apiKey.trim() : '';
      resolve(value || null);
    });
  });

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

const formatProblemContext = (problem: Problem) => {
  const constraints = problem.constraints ? `\nConstraints:\n${problem.constraints}` : '';
  const examples = problem.examples.length > 0 ? `\nExamples:\n${problem.examples.join('\n\n')}` : '';
  return `Problem: ${problem.title} (#${problem.problemNumber})\nDifficulty: ${problem.difficulty}\n\nDescription:\n${problem.description}${constraints}${examples}`;
};

const extractGeminiText = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates?.[0];
  if (!candidate?.content?.parts) {
    return null;
  }
  const combined = candidate.content.parts
    .map((part) => (part?.text ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
  return combined || null;
};

const SidePanel = () => {
  const [problem, setProblem] = useState<Problem | null>(null);
  const [problemStatus, setProblemStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [problemError, setProblemError] = useState<string | null>(null);

  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyStatus, setApiKeyStatus] = useState<'loading' | 'ready' | 'missing'>('loading');

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const hasValidSetup = useMemo(
    () => Boolean(problem && apiKeyStatus === 'ready' && apiKey),
    [problem, apiKeyStatus, apiKey],
  );

  useEffect(() => {
    const initialise = async () => {
      const key = await fetchApiKey();
      if (key) {
        setApiKeyStatus('ready');
        setApiKey(key);
      } else {
        setApiKeyStatus('missing');
        setApiKey(null);
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
  }, [problem]);

  const refreshProblem = useCallback(async () => {
    setProblemStatus('loading');
    setProblemError(null);
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

  const ensureApiKey = async () => {
    if (apiKeyStatus === 'loading') {
      const key = await fetchApiKey();
      if (key) {
        setApiKeyStatus('ready');
        setApiKey(key);
        return key;
      }
      setApiKeyStatus('missing');
      return null;
    }
    if (apiKeyStatus === 'ready' && apiKey) {
      return apiKey;
    }
    return null;
  };

  const handleSend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = input.trim();
    if (!question || !problem) {
      return;
    }
    setInput('');
    setChatError(null);

    const key = await ensureApiKey();
    if (!key) {
      setChatError('Gemini API key missing. Save it in Settings.');
      return;
    }

    const userMessage: Message = {
      role: 'user',
      content: question,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsThinking(true);

    try {
      const conversation = [...messages, userMessage];
      const formattedConversation = conversation
        .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
        .join('\n');
      const prompt = `${formatProblemContext(problem)}\n\nConversation so far:\n${formattedConversation}\nAssistant:`;

      const response = await fetch(`${GEMINI_ENDPOINT}?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorBody: unknown = await response.json().catch(() => null);
        const message =
          (errorBody as { error?: { message?: string } })?.error?.message ?? `Gemini error (${response.status})`;
        throw new Error(message);
      }

      const payload: unknown = await response.json();
      const answer = extractGeminiText(payload);
      if (!answer) {
        throw new Error('Gemini returned an empty response.');
      }

      const assistantMessage: Message = {
        role: 'assistant',
        content: answer,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error while contacting Gemini.';
      setChatError(message);
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
            Ask focused questions about the problem you have open on LeetCode and get guidance from Gemini.
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
                apiKeyStatus === 'ready'
                  ? 'bg-emerald-500/20 text-emerald-100'
                  : apiKeyStatus === 'loading'
                    ? 'bg-slate-500/20 text-slate-200'
                    : 'bg-amber-500/30 text-amber-100'
              }`}
            >
              {apiKeyStatus === 'ready' ? 'Gemini key loaded' : apiKeyStatus === 'loading' ? 'Checking Gemini key…' : 'Gemini key missing'}
            </span>
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
          {apiKeyStatus === 'missing' && (
            <p className="mt-3 rounded-lg border border-amber-300/40 bg-amber-500/20 px-3 py-2 text-xs text-amber-100">
              Save a Gemini API key in the Settings page to enable answers.
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
                  <p className="text-xs text-slate-300/70">#{problem.problemNumber}</p>
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
                      {message.role === 'user' ? 'You' : 'Gemini'} •{' '}
                      {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
              {isThinking && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl bg-black/40 px-4 py-3 text-xs text-slate-200">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-orange-300" />
                    Gemini is thinking…
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
                    problemStatus === 'ready'
                      ? `Ask about ${problem?.title ?? 'the problem'}…`
                      : 'Problem not detected yet.'
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
        </main>
      </div>
    </div>
  );
};

export default SidePanel;
