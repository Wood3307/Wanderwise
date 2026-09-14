/* eslint-disable no-control-regex -- Validate untrusted single-line topic text. */
export interface AssociationTopic {
  id: string;
  keyword: string;
  relation: string;
}

export interface AssociationResponse {
  seed: string;
  topics: AssociationTopic[];
  method: "model" | "semantic";
  notice?: string;
}

export type WormholePhase = "idle" | "entering" | "space" | "departing" | "emerging";

/** Suggestions are directions for a new search, never invented source articles. */
export function readAssociationTopics(value: unknown): AssociationTopic[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as AssociationResponse).topics))
    throw new Error("联想方向暂时无法展开，请重试。");
  const seen = new Set<string>();
  const topics = (value as AssociationResponse).topics.flatMap((topic) => {
    if (!topic || typeof topic.keyword !== "string" || typeof topic.relation !== "string") return [];
    const keyword = topic.keyword.trim();
    const key = keyword.toLocaleLowerCase();
    if (!keyword || keyword.length > 160 || /[\u0000-\u001f\u007f]/.test(keyword) || seen.has(key)) return [];
    seen.add(key);
    return [{ id: `direction-${seen.size}`, keyword, relation: topic.relation.slice(0, 160) }];
  }).slice(0, 12);
  if (topics.length < 5) throw new Error("联想方向还不完整，请重新展开。");
  return topics;
}
