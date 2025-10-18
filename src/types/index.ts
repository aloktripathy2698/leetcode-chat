export interface Problem {
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  description: string;
  examples: string[];
  constraints: string;
  url: string;
  problemNumber: string;
  timestamp: number;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ChatResponse {
  success: boolean;
  response?: string;
  summary?: string;
  error?: string;
}

export interface ProblemScrapeResponse {
  success: boolean;
  problem?: Problem;
  error?: string;
}
