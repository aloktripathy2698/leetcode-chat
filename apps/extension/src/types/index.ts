export interface Problem {
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  description: string;
  examples: string[];
  constraints: string;
  url: string;
  slug: string;
  problemNumber: string;
  timestamp: number;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface SourceDocument {
  title: string;
  snippet: string;
  metadata: Record<string, unknown>;
}

export interface ChatResponse {
  success: boolean;
  answer?: string;
  summary?: string;
  sources?: SourceDocument[];
  error?: string;
}

export interface ChatHistoryMessage {
  role: Message['role'];
  content: string;
}

export interface ChatRequestPayload {
  question: string;
  problem: {
    slug: string;
    title: string;
    difficulty: Problem['difficulty'];
    description: string;
    url: string;
  };
  history: ChatHistoryMessage[];
}

export interface ProblemScrapeResponse {
  success: boolean;
  problem?: Problem;
  error?: string;
}
