export interface ContentItem {
  id: string;
  title: string;
  author: string;
  summary: string;
  url: string;
  source: 'zhihu' | 'global';
  kind: 'search_summary' | 'answer_summary' | 'hot_summary' | 'curated';
  fetchedAt: string;
  contentType?: 'answer' | 'question' | 'article' | 'webpage';
  questionId?: string;
  hotRank?: number;
}

export interface ContentResponse {
  items: ContentItem[];
  cached: boolean;
  fetchedAt: string;
  notice?: string;
  paging?: { isEnd: boolean; nextOffset?: number };
}

export interface SearchContext { visitorId: string; refresh?: boolean }
