import type { ChatRequestPayload, ChatResponse, Problem } from '../../types';
import { DEFAULT_BACKEND_URL, readBackendUrl } from '../storage';

const envBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;

const normalizeBaseUrl = (url: string) => url.replace(/\/?$/, '');

export const resolveBackendUrl = async (): Promise<string> => {
  const stored = await readBackendUrl();
  const base = stored || envBaseUrl || DEFAULT_BACKEND_URL;
  return normalizeBaseUrl(base);
};

const parseJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Invalid JSON received from backend: ${(error as Error).message}`);
  }
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const baseUrl = await resolveBackendUrl();
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Backend request failed (${response.status})`);
  }

  return parseJson<T>(response);
};

export const checkBackendHealth = async (): Promise<boolean> => {
  try {
    await request('/health');
    return true;
  } catch {
    return false;
  }
};

export const ingestProblem = async (problem: Problem): Promise<void> => {
  await request('/documents', {
    method: 'POST',
    body: JSON.stringify({
      slug: problem.slug,
      title: problem.title,
      difficulty: problem.difficulty,
      url: problem.url,
      description: problem.description,
      examples: problem.examples,
      constraints: problem.constraints,
    }),
  });
};

export const sendChatRequest = async (payload: ChatRequestPayload): Promise<ChatResponse> =>
  request<ChatResponse>('/chat', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
