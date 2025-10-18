/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import type { Problem } from '../types';

type ParsedProblem = Omit<Problem, 'timestamp'>;

const QUERY_TIMEOUT_MS = 12_000;

const toSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const currentSlug = () => toSlug(window.location.pathname.split('/').filter(Boolean)[1] ?? '');

const normalizeDifficulty = (value: string | undefined | null): 'Easy' | 'Medium' | 'Hard' => {
  if (!value) return 'Medium';
  const normalized = value.trim();
  if (normalized === 'Easy' || normalized === 'Medium' || normalized === 'Hard') {
    return normalized;
  }
  return 'Medium';
};

const parseHtmlContent = (html: string) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const body = doc.body;

  const descriptionParts: string[] = [];
  for (const child of Array.from(body.children)) {
    const strongText = child.querySelector('strong')?.textContent?.trim().toLowerCase() ?? '';
    if (strongText.startsWith('example') || strongText.startsWith('constraints')) {
      break;
    }
    if (child.tagName.toLowerCase() === 'pre') {
      break;
    }
    const text = child.textContent?.trim();
    if (text) {
      descriptionParts.push(text);
    }
  }

  const description =
    descriptionParts.join('\n\n') || body.textContent?.trim() || 'Unable to extract the problem description.';

  const examples = Array.from(body.querySelectorAll('pre'))
    .map((node) => node.textContent?.trim() ?? '')
    .filter(Boolean);

  const strongNodes = Array.from(body.querySelectorAll('strong'));
  const constraintNode = strongNodes.find((node) => (node.textContent ?? '').toLowerCase().includes('constraint'));
  let constraints = 'Constraints not detected.';
  if (constraintNode) {
    const listCandidate = constraintNode.parentElement?.nextElementSibling;
    if (listCandidate && (listCandidate.tagName === 'UL' || listCandidate.tagName === 'OL')) {
      constraints = Array.from(listCandidate.children)
        .map((item) => item.textContent?.trim() ?? '')
        .filter(Boolean)
        .join('\n');
    } else {
      constraints = constraintNode.parentElement?.textContent?.trim() ?? constraints;
    }
  }

  return { description, examples, constraints };
};

const isCandidate = (value: unknown) => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.title === 'string' && (typeof candidate.content === 'string' || typeof candidate.body === 'string');
};

const extractFromCandidate = (candidate: Record<string, unknown>, slug: string): ParsedProblem | null => {
  const title =
    (candidate.title as string | undefined) ??
    (candidate.questionTitle as string | undefined) ??
    (candidate.question?.title as string | undefined);
  if (!title) {
    return null;
  }

  const content =
    (candidate.content as string | undefined) ??
    (candidate.question?.content as string | undefined) ??
    (candidate.body as string | undefined);
  if (!content) {
    return null;
  }

  const candidateSlug =
    toSlug((candidate.titleSlug as string | undefined) ?? (candidate.slug as string | undefined) ?? title);
  if (slug && candidateSlug && candidateSlug !== slug) {
    return null;
  }

  const difficulty = normalizeDifficulty(
    (candidate.difficulty as string | undefined) ?? (candidate.question?.difficulty as string | undefined),
  );

  const problemNumber =
    (candidate.questionFrontendId as string | undefined) ??
    (candidate.frontendQuestionId as string | undefined) ??
    (candidate.questionId as string | undefined) ??
    (candidate.question?.questionFrontendId as string | undefined) ??
    (candidate.question?.frontendQuestionId as string | undefined) ??
    (candidate.question?.questionId as string | undefined) ??
    (window.location.pathname.split('/').filter(Boolean)[1] ?? title);

  const { description, examples, constraints } = parseHtmlContent(content);

  return {
    title,
    difficulty,
    description,
    examples,
    constraints,
    url: window.location.href,
    problemNumber: String(problemNumber),
  };
};

const extractFromNextData = (): ParsedProblem | null => {
  const data = (window as typeof window & { __NEXT_DATA__?: unknown }).__NEXT_DATA__;
  if (!data || typeof data !== 'object') {
    return null;
  }

  const slug = currentSlug();
  const stack: unknown[] = Array.isArray(data) ? [...(data as unknown[])] : [data];

  const enqueue = (value: unknown) => {
    if (!value || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      stack.push(...(value as unknown[]));
    } else {
      stack.push(value);
    }
  };

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') {
      continue;
    }

    if (isCandidate(node)) {
      const parsed = extractFromCandidate(node as Record<string, unknown>, slug);
      if (parsed) {
        return { ...parsed };
      }
    }

    if (Array.isArray(node)) {
      enqueue(node);
      continue;
    }

    for (const value of Object.values(node as Record<string, unknown>)) {
      enqueue(value);
    }
  }

  return null;
};

const extractFromDom = (): ParsedProblem | null => {
  const titleNode = document.querySelector('[data-cy="question-title"]');
  if (!titleNode) {
    return null;
  }

  const rawTitle = titleNode.textContent?.trim() ?? '';
  if (!rawTitle) {
    return null;
  }

  const match = rawTitle.match(/^(\d+)\.\s*(.+)$/);
  const problemNumber = match?.[1] ?? window.location.pathname.split('/').filter(Boolean)[1] ?? rawTitle;
  const title = match?.[2] ?? rawTitle;

  const contentRoot =
    document.querySelector('[data-cy="question-content"]') ??
    document.querySelector('.question-content__JfgR');
  if (!contentRoot) {
    return null;
  }

  const descriptionParts: string[] = [];
  for (const child of Array.from(contentRoot.children)) {
    const strongText = child.querySelector('strong')?.textContent?.trim().toLowerCase() ?? '';
    if (strongText.startsWith('example') || strongText.startsWith('constraints')) {
      break;
    }
    if (child.tagName.toLowerCase() === 'pre') {
      break;
    }
    const text = child.textContent?.trim();
    if (text) {
      descriptionParts.push(text);
    }
  }

  const examples = Array.from(contentRoot.querySelectorAll('pre'))
    .map((node) => node.textContent?.trim() ?? '')
    .filter(Boolean);

  const strongNodes = Array.from(contentRoot.querySelectorAll('strong'));
  const constraintNode = strongNodes.find((node) => (node.textContent ?? '').toLowerCase().includes('constraint'));
  let constraints = 'Constraints not detected.';
  if (constraintNode) {
    const listCandidate = constraintNode.parentElement?.nextElementSibling;
    if (listCandidate && (listCandidate.tagName === 'UL' || listCandidate.tagName === 'OL')) {
      constraints = Array.from(listCandidate.children)
        .map((item) => item.textContent?.trim() ?? '')
        .filter(Boolean)
        .join('\n');
    } else {
      constraints = constraintNode.parentElement?.textContent?.trim() ?? constraints;
    }
  }

  return {
    title,
    difficulty: findDifficulty(),
    description: descriptionParts.join('\n\n') || contentRoot.textContent?.trim() || 'Unable to extract the problem description.',
    examples,
    constraints,
    url: window.location.href,
    problemNumber: String(problemNumber),
  };
};

const scrapeProblem = (): ParsedProblem | null => extractFromNextData() ?? extractFromDom();

const toErrorMessage = (value: unknown): string => {
  if (value && typeof value === 'object' && 'message' in value) {
    const candidate = (value as { message?: unknown }).message;
    if (typeof candidate === 'string') {
      return candidate;
    }
  }
  return 'Unexpected error while scraping.';
};

const waitForProblem = (timeoutMs: number): Promise<Problem> =>
  new Promise((resolve, reject) => {
    const attempt = () => {
      const parsed = scrapeProblem();
      if (parsed) {
        cleanup();
        resolve({ ...parsed, timestamp: Date.now() });
      }
    };

    const observer = new MutationObserver(() => {
      attempt();
    });

    const readyListener = () => {
      if (document.readyState === 'interactive' || document.readyState === 'complete') {
        attempt();
      }
    };

    const cleanup = () => {
      observer.disconnect();
      document.removeEventListener('readystatechange', readyListener);
      window.clearTimeout(timeoutId);
    };

    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('readystatechange', readyListener);

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Could not detect a LeetCode problem on this page.'));
    }, timeoutMs);

    attempt();
  });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return;
  }

  if ((message as { type?: string }).type === 'SCRAPE_PROBLEM') {
    void (async () => {
      try {
        const problem = await waitForProblem(QUERY_TIMEOUT_MS);
        console.info(`Problem scraped: ${problem.problemNumber}. ${problem.title}`);
        sendResponse({ success: true, problem });
      } catch (error: unknown) {
        const errorMessage = toErrorMessage(error);
        sendResponse({ success: false, error: errorMessage });
      }
    })();
    return true;
  }
});
