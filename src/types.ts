export type SourceMode = "zhihu-search" | "zhihu-hot" | "zhihu-public" | "zhihu-cache";

export interface Highlight {
  id: string;
  text: string;
  paragraphIndex: number;
  label?: string;
}

export interface Answer {
  id: string;
  title: string;
  author: string;
  excerpt: string;
  paragraphs: string[];
  url: string;
  relevance: number;
  votes?: number;
  isExcerpt: boolean;
  workId?: string;
  highlights?: Highlight[];
  highlightMethod?: "extractive" | "model";
}

export interface Question {
  id: string;
  title: string;
  excerpt: string;
  keywords: string[];
  relevance: number;
  color: string;
  answers: Answer[];
  url?: string;
  kind?: "question" | "topic" | "article";
  answersExpanded?: boolean;
  hotRank?: number;
}

export interface ExploreResponse {
  query: string;
  keywords: string[];
  questions: Question[];
  source: SourceMode;
  notice?: string;
  fetchedAt: string;
  stale?: boolean;
}

export interface QuestionResponse {
  question: Question;
  notice?: string;
}

export interface HighlightResponse {
  answerId: string;
  highlights: Highlight[];
  method: "extractive" | "model";
  notice?: string;
}

export interface ConnectionStatus {
  ok: boolean;
  configured: boolean;
  publicCount: number;
  model: {
    configured: boolean;
    provider: "compatible" | "zhihu" | "extractive";
    name?: string;
  };
}

export interface SavedItem {
  id: string;
  type: "question" | "answer";
  title: string;
  excerpt: string;
  author?: string;
  url?: string;
  questionId: string;
  answerId?: string;
  query: string;
  savedAt: string;
}

export interface Reflection {
  id: string;
  targetId: string;
  targetTitle: string;
  quote?: string;
  text: string;
  query: string;
  createdAt: string;
}

export interface JourneyStop {
  id: string;
  title: string;
  type: "question" | "answer";
  questionId: string;
  answerId?: string;
  query: string;
  visitedAt: string;
}

export interface ObservatoryEntry {
  query: string;
  returnUrl?: string;
}
