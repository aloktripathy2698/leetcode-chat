import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { Moon, RefreshCcw, Settings, Sun } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import type { LanguageFn } from 'react-syntax-highlighter/dist/esm/types';
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import remarkGfm from 'remark-gfm';

import { checkBackendHealth, ingestProblem, streamChatRequest } from '../lib/api/client';
import { readBackendUrl } from '../lib/storage';
import type { ChatHistoryMessage, Message, Problem, ProblemScrapeResponse } from '../types';

const DIFFICULTY_STYLES: Record<Problem['difficulty'], string> = {
  Easy: 'bg-[#e6f4ea] text-[#137333] dark:bg-[#23352b] dark:text-[#b6ffcf]',
  Medium: 'bg-[#fef3d9] text-[#b4690e] dark:bg-[#2a231b] dark:text-[#ffd18a]',
  Hard: 'bg-[#fde7e9] text-[#a50e0e] dark:bg-[#352020] dark:text-[#ffb1b1]',
};

const REGISTERED_LANGUAGES: Array<[string, LanguageFn]> = [
  ['bash', bash as LanguageFn],
  ['python', python as LanguageFn],
  ['javascript', javascript as LanguageFn],
  ['typescript', typescript as LanguageFn],
  ['java', java as LanguageFn],
  ['cpp', cpp as LanguageFn],
  ['json', json as LanguageFn],
];

const registerPrismLanguage = (name: string, language: LanguageFn) => {
  const highlighter = SyntaxHighlighter as unknown as {
    registerLanguage: (lang: string, fn: LanguageFn) => void;
  };
  highlighter.registerLanguage(name, language);
};

REGISTERED_LANGUAGES.forEach(([name, language]) => {
  registerPrismLanguage(name, language);
});

const CODE_THEME = oneDark as unknown as Record<string, CSSProperties>;

const KNOWN_LANGUAGES = new Set(['bash', 'python', 'javascript', 'typescript', 'java', 'cpp', 'json']);

const toPlainText = (node: ReactNode): string => {
  if (node === null || node === undefined) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (typeof node === 'number' || typeof node === 'boolean') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return (node as ReactNode[]).map((child) => toPlainText(child)).join('');
  }
  return '';
};

type CodeBlockProps = {
  language: string;
  value: string;
};

const CodeBlock = ({ language, value }: CodeBlockProps) => {
  const [copied, setCopied] = useState(false);

  const resolvedLanguage = KNOWN_LANGUAGES.has(language) ? language : 'text';

  const handleCopy = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/60 bg-[#0f172a] shadow-inner dark:border-slate-700/60 dark:bg-[#0b1220]">
      <div className="flex items-center justify-between border-b border-slate-200/40 bg-black/20 px-3 py-2 text-[11px] font-medium uppercase tracking-widest text-slate-300 dark:border-slate-700/50 dark:bg-white/5 dark:text-slate-300">
        <span>{resolvedLanguage === 'text' ? 'code' : resolvedLanguage}</span>
        <button
          type="button"
          onClick={() => {
            void handleCopy();
          }}
          className="inline-flex items-center gap-1 rounded-full border border-white/20 px-2 py-1 text-[11px] font-semibold uppercase tracking-widest text-white/80 transition hover:border-white/40 hover:text-white"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter
        language={resolvedLanguage}
        style={CODE_THEME}
        wrapLongLines
        customStyle={{
          background: 'transparent',
          margin: 0,
          padding: '16px 18px',
          fontSize: '0.92rem',
          lineHeight: 1.55,
          borderRadius: 0,
        }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
};

const buildGreeting = (title: string): Message => ({
  role: 'assistant',
  content: `Ready to explore “${title}”. Ask me anything about the problem, constraints, or solution strategy.`,
  timestamp: Date.now(),
});

const hasChromeRuntime = () => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined';
const THEME_STORAGE_KEY = 'leetcode-assistant-theme-preference';

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

  const [, setIngestStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  const listRef = useRef<HTMLDivElement | null>(null);

  const hasValidSetup = useMemo(
    () => problemStatus === 'ready' && backendStatus === 'ready' && Boolean(problem),
    [problem, problemStatus, backendStatus],
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') {
        setTheme(stored);
        return;
      }
    } catch {
      // ignore storage errors (e.g., disabled localStorage)
    }

    if (typeof window.matchMedia === 'function') {
      setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  useEffect(() => {
    const initialise = async () => {
      const storedUrl = await readBackendUrl();
      const reachable = await checkBackendHealth();

      setBackendStatus(
        reachable ? 'ready' : storedUrl ? 'error' : 'missing',
      );

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

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
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

  const submitQuestion = useCallback(async () => {
    const question = input.trim();
    if (!question || !hasValidSetup || isThinking || !problem) {
      return;
    }

    setInput('');
    setChatError(null);

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
    queueMicrotask(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
    });
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
              break;
            case 'token':
              setMessages((prev) =>
                prev.map((message) =>
                  message.timestamp === assistantId
                    ? { ...message, content: `${message.content}${streamEvent.token}` }
                    : message,
                ),
              );
              queueMicrotask(() => {
                listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
              });
              break;
            case 'summary':
              break;
            case 'end':
              setMessages((prev) =>
                prev.map((message) =>
                  message.timestamp === assistantId
                    ? { ...message, content: streamEvent.payload.answer }
                    : message,
                ),
              );
              queueMicrotask(() => {
                listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
              });
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
              queueMicrotask(() => {
                listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
              });
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
  }, [hasValidSetup, input, isThinking, messages, problem]);

  const handleSend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitQuestion();
  };

  return (
    <div className={theme === 'dark' ? 'dark h-screen overflow-hidden' : 'h-screen overflow-hidden'}>
      <div className="flex h-full flex-col bg-[#f7f7f9] text-slate-900 transition-colors dark:bg-[#1f2430] dark:text-slate-100">
        <div className="flex h-full flex-col">
          <header className="border-b border-slate-200 bg-white px-5 py-4 shadow-sm transition-colors dark:border-slate-700 dark:bg-[#171c26]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold text-[#222] dark:text-slate-100">LeetCode Assistant</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Stay in sync with the problem you have open on LeetCode.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  title="Refresh problem"
                  onClick={() => {
                    void refreshProblem();
                  }}
                  className="flex items-center gap-2 rounded-full border border-[#ffa116] px-3 py-2 text-xs font-semibold text-[#b4690e] transition hover:bg-[#fff3df] dark:border-[#f89d2a] dark:text-[#f7b349] dark:hover:bg-[#2a2f3a]"
                >
                  <RefreshCcw className="h-4 w-4" strokeWidth={2} />
                  Refresh
                </button>
                <button
                  type="button"
                  title="Open settings"
                  onClick={openSettingsPage}
                  className="flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-[#232936]"
                >
                  <Settings className="h-4 w-4" strokeWidth={2} />
                  Settings
                </button>
                <button
                  type="button"
                  title="Toggle theme"
                  onClick={toggleTheme}
                  className="flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-[#232936]"
                >
                  {theme === 'dark' ? <Sun className="h-4 w-4" strokeWidth={2} /> : <Moon className="h-4 w-4" strokeWidth={2} />}
                  {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                </button>
              </div>
            </div>

            {problemError && (
              <p className="mt-3 rounded-lg border border-[#eeb4b9] bg-[#fde7e9] px-3 py-2 text-xs text-[#a50e0e] dark:border-[#64363a] dark:bg-[#3a2224] dark:text-[#ffb4b9]">
                {problemError}
              </p>
            )}
            {backendStatus === 'error' && (
              <p className="mt-3 rounded-lg border border-[#eeb4b9] bg-[#fde7e9] px-3 py-2 text-xs text-[#a50e0e] dark:border-[#64363a] dark:bg-[#3a2224] dark:text-[#ffb4b9]">
                Backend is unreachable. Start the backend or update the URL in settings.
              </p>
            )}
            {backendStatus === 'missing' && (
              <p className="mt-3 rounded-lg border border-[#f8dda6] bg-[#fff7e6] px-3 py-2 text-xs text-[#b4690e] dark:border-[#5c4423] dark:bg-[#3a2f1e] dark:text-[#f8d28a]">
                Backend URL is not configured. Open settings to set your FastAPI endpoint.
              </p>
            )}
          </header>

          <main className="flex flex-1 flex-col gap-5 overflow-hidden bg-[#f7f7f9] p-5 transition-colors dark:bg-[#1f2430]">
            <section className="shrink-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors dark:border-slate-700 dark:bg-[#171c26]">
            {problemStatus === 'ready' && problem ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-[#222] dark:text-slate-100">
                  {problem.problemNumber ? `${problem.problemNumber}. ${problem.title}` : problem.title}
                </h2>
                <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${DIFFICULTY_STYLES[problem.difficulty]}`}>
                  {problem.difficulty}
                </span>
              </div>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Open a problem on <span className="font-semibold text-[#b4690e] dark:text-[#f7b349]">leetcode.com</span> to start a session.
              </p>
            )}
            </section>

            <section className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-colors dark:border-slate-700 dark:bg-[#171c26]">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 text-sm font-semibold text-slate-700 transition-colors dark:border-slate-700 dark:text-slate-100">
                <h2>Chat</h2>
                <span className="text-[11px] font-medium text-slate-400 dark:text-slate-400">
                  {messages.length} {messages.length === 1 ? 'message' : 'messages'}
                </span>
              </div>

              <div ref={listRef} className="flex-1 min-h-0 space-y-3 overflow-y-auto px-5 py-4">
                {messages.map((message) => (
                  <div
                    key={`${message.timestamp}-${message.role}-${message.content.slice(0, 8)}`}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow ${
                        message.role === 'user'
                          ? 'bg-[#f7b349] text-[#1a1c2f] shadow-[#f7b349]/40 dark:bg-[#2b2319] dark:text-white dark:shadow-[#2b2319]/50'
                          : 'bg-slate-100 text-slate-700 shadow-slate-200/50 dark:bg-[#232936] dark:text-slate-200'
                      }`}
                    >
                      <ReactMarkdown
                        className="markdown-body text-sm leading-relaxed text-slate-800 dark:text-slate-100"
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ ...props }) => (
                            <p className="mb-2 last:mb-0 whitespace-pre-wrap" {...props} />
                          ),
                          ul: ({ ...props }) => (
                            <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0" {...props} />
                          ),
                          ol: ({ ...props }) => (
                            <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0" {...props} />
                          ),
                          code: ({ inline, className, children, ...props }) => {
                            const textContent = toPlainText(children);
                            if (inline) {
                              return (
                                <code
                                  className="rounded bg-black/10 px-1.5 py-0.5 text-[0.85em] font-mono dark:bg-white/10"
                                  {...props}
                                >
                                  {textContent}
                                </code>
                              );
                            }

                            const language = (className ?? '').replace('language-', '').toLowerCase();
                            const normalized = textContent.replace(/\n+$/, '\n');
                            return <CodeBlock language={language} value={normalized} />;
                          },
                          strong: ({ ...props }) => <strong className="font-semibold" {...props} />,
                          em: ({ ...props }) => <em className="italic" {...props} />,
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                      <span className="mt-2 block text-right text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400">
                        {message.role === 'user' ? 'You' : 'Assistant'} •{' '}
                        {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))}
                {isThinking && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 text-xs text-slate-600 dark:bg-[#232936] dark:text-slate-200">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-[#ffa116]" />
                      Assistant is thinking…
                    </div>
                  </div>
                )}
              </div>

              <form
                onSubmit={(event) => {
                  void handleSend(event);
                }}
                className="border-t border-slate-200 p-4 transition-colors dark:border-slate-700"
              >
                <fieldset className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-2 focus-within:border-[#ffa116] focus-within:ring-1 focus-within:ring-[#ffa116] dark:border-slate-700 dark:bg-[#232936]">
                  <label htmlFor="sidepanel-input" className="sr-only">
                    Ask a question about the problem
                  </label>
                  <textarea
                    id="sidepanel-input"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void submitQuestion();
                      }
                    }}
                    placeholder={
                      backendStatus === 'ready'
                        ? problemStatus === 'ready'
                          ? `Ask about ${problem?.title ?? 'the problem'}…`
                          : 'Problem not detected yet.'
                        : 'Backend unavailable. Configure it in Settings.'
                    }
                    className="h-24 flex-1 resize-none rounded-xl border-0 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                    spellCheck
                    disabled={!hasValidSetup || isThinking || problemStatus !== 'ready'}
                  />
                  <button
                    type="submit"
                    disabled={!hasValidSetup || isThinking || problemStatus !== 'ready' || !input.trim()}
                    className="self-end rounded-xl bg-[#ffa116] px-4 py-2 text-sm font-semibold text-[#2d2f31] shadow-md shadow-[#ffa116]/30 transition hover:bg-[#ffb545] disabled:cursor-not-allowed disabled:bg-[#ffd699] dark:bg-[#f7b349] dark:text-[#1f2430] dark:hover:bg-[#f8c166] dark:disabled:bg-[#3a2f1e]"
                  >
                    Send
                  </button>
                </fieldset>
                {chatError && (
                  <p className="mt-2 rounded-lg border border-[#eeb4b9] bg-[#fde7e9] px-3 py-2 text-xs text-[#a50e0e] dark:border-[#64363a] dark:bg-[#3a2224] dark:text-[#ffb4b9]">
                    {chatError}
                  </p>
                )}
              </form>
          </section>

          
        </main>
      </div>
    </div>
  </div>
  );
};

export default SidePanel;
