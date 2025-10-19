import type { Problem } from '../types';

type ParsedProblem = Omit<Problem, 'timestamp'>;

const SIDE_PANEL_PATH = 'sidepanel.html';

const hasSidePanel = () =>
  typeof chrome !== 'undefined' &&
  Boolean(chrome.sidePanel?.open) &&
  Boolean(chrome.sidePanel?.setOptions);

chrome.runtime.onInstalled.addListener(() => {
  if (hasSidePanel() && chrome.sidePanel?.setPanelBehavior) {
    void chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {
        // Ignore; still allow manual opening.
      });
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (!hasSidePanel() || tab.id === undefined) {
    return;
  }

  void (async () => {
    try {
      await chrome.sidePanel.setOptions({
        tabId: tab.id as number,
        path: SIDE_PANEL_PATH,
        enabled: true,
      });
      await chrome.sidePanel.open({ tabId: tab.id as number });
    } catch (error) {
      console.error('Unable to open side panel from action click', error);
    }
  })();
});

const openSidePanelForCurrentTab = async (): Promise<{ success: boolean; error?: string }> => {
  if (!hasSidePanel()) {
    return { success: false, error: 'Side panel API is not available in this Chrome version.' };
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    return { success: false, error: 'No active tab to attach the side panel to.' };
  }

  try {
    await chrome.sidePanel.setOptions({
      tabId: activeTab.id,
      path: SIDE_PANEL_PATH,
      enabled: true,
    });
    await chrome.sidePanel.open({ tabId: activeTab.id });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to open side panel';
    return { success: false, error: message };
  }
};

chrome.runtime.onMessage.addListener((rawMessage: unknown, _sender, sendResponse) => {
  if (!rawMessage || typeof rawMessage !== 'object') {
    return;
  }

  const message = rawMessage as { type?: string };

  if (message.type === 'OPEN_SIDE_PANEL') {
    void openSidePanelForCurrentTab()
      .then(sendResponse)
      .catch((error) => {
        const messageText = error instanceof Error ? error.message : 'Unexpected error';
        sendResponse({ success: false, error: messageText });
      });
    return true;
  }

  if (message.type === 'GET_ACTIVE_PROBLEM') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        sendResponse({ success: false, error: lastError.message });
        return;
      }

      const activeTab = tabs[0];
      if (!activeTab?.id) {
        sendResponse({ success: false, error: 'No active tab detected.' });
        return;
      }

      scrapeProblemFromTab(activeTab.id)
        .then((problem) => {
          sendResponse({ success: true, problem });
        })
        .catch((error: unknown) => {
          const messageText = error instanceof Error ? error.message : 'Unexpected error while scraping.';
          sendResponse({ success: false, error: messageText });
        });
    });
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') {
    return;
  }
  const url = tab.url ?? '';
  if (!url.startsWith('https://leetcode.com/problems/')) {
    return;
  }

  void chrome.runtime.sendMessage({ type: 'ACTIVE_PROBLEM_CHANGED', tabId }).catch((error) => {
    console.warn('Broadcast failed', error);
  });
});

const scrapeProblemInPage = async (): Promise<Problem | null> => {
  const toSlug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  const normalizeDifficulty = (value: string | undefined | null): 'Easy' | 'Medium' | 'Hard' => {
    if (!value) return 'Medium';
    const normalized = value.trim();
    if (normalized === 'Easy' || normalized === 'Medium' || normalized === 'Hard') {
      return normalized;
    }
    return 'Medium';
  };

  const currentSlug = () => toSlug(window.location.pathname.split('/').filter(Boolean)[1] ?? '');

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

    const candidateSlug = toSlug(
      (candidate.titleSlug as string | undefined) ?? (candidate.slug as string | undefined) ?? title,
    );
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
      slug: candidateSlug || slug,
      problemNumber: String(problemNumber),
    };
  };

  const extractFromNextData = (): ParsedProblem | null => {
    const data = (window as typeof window & { __NEXT_DATA__?: unknown }).__NEXT_DATA__;
    if (!data || typeof data !== 'object') {
      return null;
    }

    const slug = currentSlug();
    const stack: unknown[] = [];
    if (Array.isArray(data)) {
      for (const item of data as unknown[]) {
        stack.push(item);
      }
    } else {
      stack.push(data);
    }

    const enqueue = (value: unknown) => {
      if (!value || typeof value !== 'object') {
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value as unknown[]) {
          stack.push(item);
        }
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
          return parsed;
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
      slug: toSlug(title),
      problemNumber: String(problemNumber),
    };
  };

  const findDifficulty = (): 'Easy' | 'Medium' | 'Hard' => {
    const diffAttr =
      document.querySelector('[diff]')?.getAttribute('diff') ??
      document.querySelector('[data-difficulty]')?.getAttribute('data-difficulty');
    return normalizeDifficulty(diffAttr);
  };

  const fetchQuestionViaGraphQL = async (
    slug: string,
  ): Promise<Record<string, unknown> | null> => {
    if (!slug) {
      return null;
    }
    try {
      const response = await fetch('https://leetcode.com/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          query: `
            query questionData($titleSlug: String!) {
              question(titleSlug: $titleSlug) {
                questionFrontendId
                title
                difficulty
                content
              }
            }
          `,
          variables: { titleSlug: slug },
        }),
      });
      if (!response.ok) {
        return null;
      }
      const json = (await response.json()) as Record<string, unknown>;
      const data = json?.data;
      if (!data || typeof data !== 'object') {
        return null;
      }
      const question = (data as Record<string, unknown>).question;
      if (!question || typeof question !== 'object') {
        return null;
      }
      return question as Record<string, unknown>;
    } catch (error) {
      console.warn('GraphQL scrape failed', error);
      return null;
    }
  };

  const parsed = extractFromNextData() ?? extractFromDom();
  if (parsed) {
    return {
      ...parsed,
      timestamp: Date.now(),
    };
  }

  const slug = currentSlug();
  const graphQuestion = await fetchQuestionViaGraphQL(slug);
  if (!graphQuestion) {
    return null;
  }

  const htmlContent =
    typeof graphQuestion.content === 'string' ? graphQuestion.content : '';
  const { description, examples, constraints } = parseHtmlContent(htmlContent);

  return {
    title: typeof graphQuestion.title === 'string' ? graphQuestion.title : slug,
    difficulty: normalizeDifficulty(
      typeof graphQuestion.difficulty === 'string' ? graphQuestion.difficulty : undefined,
    ),
    description,
    examples,
    constraints,
    url: window.location.href,
    slug,
    problemNumber: String(
      (typeof graphQuestion.questionFrontendId === 'string'
        ? graphQuestion.questionFrontendId
        : undefined) ??
        (typeof graphQuestion.frontendQuestionId === 'string'
          ? graphQuestion.frontendQuestionId
          : undefined) ??
        slug,
    ),
    timestamp: Date.now(),
  };
};

const executeScrape = (tabId: number): Promise<Problem | null> =>
  new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        func: scrapeProblemInPage,
      },
      (injectionResults) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        const [firstResult] = injectionResults ?? [];
        const candidate: unknown = firstResult?.result ?? null;
        if (candidate && typeof candidate === 'object' && 'title' in candidate) {
          resolve(candidate as Problem);
          return;
        }
        resolve(null);
      },
    );
  });

const scrapeProblemFromTab = async (tabId: number, timeoutMs = 12_000): Promise<Problem> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const problem = await executeScrape(tabId);
    if (problem) {
      return problem;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Could not detect a LeetCode problem on this page.');
};
