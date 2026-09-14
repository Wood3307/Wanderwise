import { useCallback, useEffect, useRef, useState } from "react";
import type { ExploreResponse } from "../types";
import { readAssociationTopics, type AssociationTopic, type WormholePhase } from "./wormhole";

interface Options {
  seed: string;
  context: string[];
  onBegin: () => void;
  onArrive: (result: ExploreResponse, keyword: string) => void;
}

export function useWormhole(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [phase, setPhase] = useState<WormholePhase>("idle");
  const phaseRef = useRef<WormholePhase>("idle");
  const [seed, setSeed] = useState("");
  const [topics, setTopics] = useState<AssociationTopic[]>([]);
  const topicsRef = useRef(topics);
  topicsRef.current = topics;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const serial = useRef(0);
  const request = useRef<AbortController | null>(null);
  const recent = useRef<string[]>([]);
  const associationInput = useRef({ query: "", context: [] as string[] });
  const transition = useCallback((next: WormholePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  const cancel = useCallback(() => {
    serial.current++;
    request.current?.abort();
    request.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const loadAssociations = useCallback(async () => {
    cancel();
    const id = serial.current;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch("/api/associations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...associationInput.current, exclude: recent.current }),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.message === "string" ? result.message : "联想空间暂时无法连接。");
      const next = readAssociationTopics(result);
      if (id !== serial.current || controller.signal.aborted) return;
      topicsRef.current = next;
      setTopics(next);
    } catch (reason) {
      if (id === serial.current) setError(controller.signal.aborted
        ? "展开方向用时较长，可以重试或返回原星海。"
        : reason instanceof Error ? reason.message : "联想空间暂时无法连接。");
    } finally {
      clearTimeout(timeout);
      if (id === serial.current) setLoading(false);
    }
  }, [cancel]);

  const enter = useCallback(() => {
    if (phaseRef.current !== "idle") return;
    const input = latest.current;
    const origin = input.seed.trim().slice(0, 160) || "好奇心";
    associationInput.current = { query: origin, context: input.context.filter(Boolean).slice(0, 12).map(text => text.slice(0, 160)) };
    setSeed(origin);
    setTopics([]);
    topicsRef.current = [];
    input.onBegin();
    transition("entering");
    void loadAssociations();
  }, [loadAssociations, transition]);

  const choose = useCallback(async (topic: AssociationTopic) => {
    if (phaseRef.current !== "space" || !topicsRef.current.some(item => item.id === topic.id && item.keyword === topic.keyword)) return;
    cancel();
    const id = serial.current;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    transition("departing");
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(`/api/explore?q=${encodeURIComponent(topic.keyword)}`, { signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.message === "string" ? result.message : "暂时无法抵达这个方向。");
      if (!Array.isArray(result.questions) || !result.questions.length)
        throw new Error("这个方向暂时没有匹配的来源，可以选择另一个入口。");
      if (id !== serial.current || controller.signal.aborted) return;
      recent.current = [...recent.current.filter(item => item !== topic.keyword), topic.keyword].slice(-32);
      latest.current.onArrive({ ...result, query: topic.keyword } as ExploreResponse, topic.keyword);
      transition("emerging");
    } catch (reason) {
      if (id === serial.current) {
        setError(controller.signal.aborted ? "抵达用时较长，已返回联想空间，可以再次选择方向。"
          : reason instanceof Error ? reason.message : "暂时无法抵达这个方向。");
        transition("space");
      }
    } finally {
      clearTimeout(timeout);
      if (id === serial.current) setLoading(false);
    }
  }, [cancel, transition]);

  const back = useCallback(() => {
    if (phaseRef.current === "idle" || phaseRef.current === "emerging") return;
    cancel();
    setLoading(false);
    setError("");
    transition(phaseRef.current === "entering" ? "idle" : "emerging");
  }, [cancel, transition]);
  const reset = useCallback(() => {
    cancel();
    recent.current = [];
    setTopics([]);
    setLoading(false);
    setError("");
    transition("idle");
  }, [cancel, transition]);
  const transitComplete = useCallback(() => {
    if (phaseRef.current === "entering") transition("space");
    else if (phaseRef.current === "emerging") transition("idle");
  }, [transition]);

  return { phase, seed, topics, loading, error, enter, choose, back, reset, transitComplete, retry: loadAssociations };
}
