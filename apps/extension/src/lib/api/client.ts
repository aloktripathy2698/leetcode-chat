import type { ChatRequestPayload, ChatResponse, ChatStreamEvent, Problem } from '../../types';
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

const normalizeChatResponse = (payload: ChatResponse): ChatResponse => ({
  success: payload.success ?? true,
  answer: payload.answer ?? '',
  summary: payload.summary ?? '',
  sources: payload.sources ?? [],
  error: payload.error,
});

export const streamChatRequest = async (
  payload: ChatRequestPayload,
  handleEvent: (event: ChatStreamEvent) => void = () => {},
  options: { signal?: AbortSignal | null } = {},
): Promise<ChatResponse> => {
  const baseUrl = await resolveBackendUrl();
  const url = `${baseUrl}/chat/stream`;
  const response = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
    },
    signal: options.signal ?? undefined,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Backend request failed (${response.status})`);
  }

  if (!response.body) {
    throw new Error('Streaming is not supported in this environment.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalPayload: ChatResponse | null = null;

  try {
    let streamComplete = false;
    while (!streamComplete) {
      const { value, done } = await reader.read();
      streamComplete = Boolean(done);
      if (streamComplete) {
        break;
      }

      if (value) {
        buffer += decoder.decode(value, { stream: true });
      }
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        const event = JSON.parse(line) as ChatStreamEvent;
        handleEvent(event);

        if (event.type === 'end' || event.type === 'cached') {
          finalPayload = normalizeChatResponse(event.payload);
        } else if (event.type === 'error') {
          throw new Error(event.error ?? 'Unknown error from stream.');
        }
      }
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      const event = JSON.parse(buffer) as ChatStreamEvent;
      handleEvent(event);
      if (event.type === 'end' || event.type === 'cached') {
        finalPayload = normalizeChatResponse(event.payload);
      } else if (event.type === 'error') {
        throw new Error(event.error ?? 'Unknown error from stream.');
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!finalPayload) {
    throw new Error('Chat stream completed without a final payload.');
  }

  return finalPayload;
};
