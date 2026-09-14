import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Backpack,
  Check,
  ChevronRight,
  Compass,
  Download,
  Expand,
  Footprints,
  Home,
  Info,
  LoaderCircle,
  Map,
  Mouse,
  Orbit,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Telescope,
  Trash2,
  WandSparkles,
  X,
  PenLine,
  Quote,
  Minimize,
  Navigation,
  BookOpen,
  Cable,
  Minus,
} from "lucide-react";
import GalaxyScene from "./components/GalaxyScene";
import AssociationSpace from "./components/AssociationSpace";
import WormholePortal from "./components/WormholePortal";
import WormholeTransit from "./components/WormholeTransit";
import { useWormhole } from "./lib/useWormhole";
import "./components/wormhole-flow.css";
import ReadingRoom from "./components/ReadingRoom";
import BackgroundMusic from "./components/BackgroundMusic";
import RichText from "./components/RichText";
import { BIRTH_MS, COLLAPSE_MS, type SearchVoyage } from "./lib/search-voyage";
import "./components/search-voyage.css";
import type {
  Answer,
  ExploreResponse,
  JourneyStop,
  Question,
  Reflection,
  SavedItem,
  QuestionResponse,
  HighlightResponse,
  ConnectionStatus,
} from "./types";
import {
  downloadMarkdown,
  exportNotebook,
  loadCollection,
  loadJourney,
  loadReflections,
  saveCollection,
  saveJourney,
  saveReflections,
} from "./lib/storage";
import {
  getInitialEntry,
  registerObservatoryEntry,
  returnToObservatory,
  exportJourneyToObservatory,
} from "./lib/integration";
import { createJourneyExport, startNewTrip, type JourneyExportPacket } from "./lib/trip";
import { useJourneyExitGuard } from "./lib/useJourneyExitGuard";
import "./components/trip-exit.css";

type Drawer =
  | "collection"
  | "journey"
  | "help"
  | "return"
  | "connection"
  | null;
const depthNames = ["问题星海", "观点星系", "文章恒星"];
const number = (value: number) => value.toString().padStart(2, "0");
const timeLabel = (date: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
function IconButton({
  children,
  label,
  onClick,
  active = false,
  className = "",
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""} ${className}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function Modal({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button, a[href], input, textarea, [tabindex="0"]',
        ) ?? [],
      ).filter((el) => !el.hasAttribute("disabled"));
    focusable()[0]?.focus();
    function trap(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const list = focusable();
      if (!list.length) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === list[0]) {
        event.preventDefault();
        list.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === list.at(-1)) {
        event.preventDefault();
        list[0]?.focus();
      }
    }
    dialog?.addEventListener("keydown", trap);
    return () => {
      dialog?.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <IconButton label="关闭弹窗" onClick={onClose}>
            <X size={19} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [entry, setEntry] = useState(getInitialEntry);
  const [query, setQuery] = useState(entry.query);
  const [searchText, setSearchText] = useState(entry.query);
  const [discoveryMode, setDiscoveryMode] = useState<"hot" | "public">("hot");
  const [data, setData] = useState<ExploreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [voyage, setVoyage] = useState<SearchVoyage | null>(null);
  const voyageRef = useRef(voyage);
  voyageRef.current = voyage;
  const searchSerial = useRef(0);
  const wormholeResult = useRef<ExploreResponse | null>(null);
  const finishCollapse = useRef<(() => void) | null>(null);
  const sceneSnapshot = useRef<{
    questions: Question[];
    questionId: string | null;
    answerId: string | null;
    depth: number;
    paragraph: number | null;
    quote?: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(
    null,
  );
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Answer>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailRetry, setDetailRetry] = useState(0);
  const [readerOpen, setReaderOpen] = useState(false);
  const [expandedQuestions, setExpandedQuestions] = useState<
    Record<string, Question>
  >({});
  const [highlights, setHighlights] = useState<
    Record<string, HighlightResponse & { sourceKey: string }>
  >({});
  const [answerLoading, setAnswerLoading] = useState(false);
  const [answerError, setAnswerError] = useState("");
  const [answerRetry, setAnswerRetry] = useState(0);
  const [highlightLoading, setHighlightLoading] = useState(false);
  const [highlightError, setHighlightError] = useState("");
  const [highlightRetry, setHighlightRetry] = useState(0);
  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [connectionRetry, setConnectionRetry] = useState(0);
  const [selectedQuote, setSelectedQuote] = useState<string | undefined>();
  const [depth, setDepth] = useState(0);
  const [flightMode, setFlightMode] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [collectionTab, setCollectionTab] = useState<"saved" | "thoughts">(
    "saved",
  );
  const [collection, setCollection] = useState(loadCollection);
  const [reflections, setReflections] = useState(loadReflections);
  const [journey, setJourney] = useState(loadJourney);
  const [tripExit, setTripExit] = useState<"return" | "close" | null>(null);
  const [tripFinished, setTripFinished] = useState(false);
  const tripFinishedRef = useRef(false);
  const [tripStatus, setTripStatus] = useState("");
  const [tripError, setTripError] = useState("");
  const [finishedExport, setFinishedExport] = useState<JourneyExportPacket | null>(null);
  const { allowLeave, rearm } = useJourneyExitGuard({
    dirty: journey.length > 0 && !tripFinished,
    onCloseAttempt: () => { setTripError(""); setTripExit("close"); },
  });
  const [selectedParagraph, setSelectedParagraph] = useState<number | null>(
    null,
  );
  const [reflectionTarget, setReflectionTarget] = useState<{
    id: string;
    title: string;
    quote?: string;
  } | null>(null);
  const [reflectionText, setReflectionText] = useState("");
  const [toast, setToast] = useState("");
  const [showMap, setShowMap] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReducedMotion(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (reducedMotion) {
      finishCollapse.current?.();
      setVoyage(null);
    }
  }, [reducedMotion]);
  const voyageReady = useCallback((id: number) => {
    setVoyage((current) => current?.id === id && current.phase === "birth" && !current.ready
      ? { ...current, ready: true, startedAt: performance.now() } : current);
  }, []);
  useEffect(() => {
    if (voyage?.phase !== "birth" || !voyage.ready) return;
    const id = voyage.id;
    const timer = window.setTimeout(() => setVoyage((current) =>
      current?.id === id && current.phase === "birth" ? null : current), BIRTH_MS);
    return () => clearTimeout(timer);
  }, [voyage?.id, voyage?.phase, voyage?.startedAt, voyage?.ready]);
  const pendingVisit = useRef<{ questionId: string; answerId?: string } | null>(
    null,
  );
  const level = depth < 0.65 ? 0 : depth < 1.65 ? 1 : 2;
  const questions = useMemo(
    () =>
      (data?.questions ?? []).map((original) => {
        const question = expandedQuestions[original.id] ?? original;
        return {
          ...question,
          answers: question.answers.map((originalAnswer) => {
            const answer = details[originalAnswer.id] ?? originalAnswer;
            const selection = highlights[answer.id];
            return selection &&
              selection.sourceKey === answerSourceKey(answer) &&
              quotesMatch(answer, selection)
              ? {
                  ...answer,
                  highlights: selection.highlights,
                  highlightMethod: selection.method,
                }
              : answer;
          }),
        };
      }),
    [data, details, expandedQuestions, highlights],
  );
  const selectedQuestion =
    questions.find((question) => question.id === selectedQuestionId) ??
    questions[0];
  const selectedAnswer =
    selectedQuestion?.answers.find(
      (answer) => answer.id === selectedAnswerId,
    ) ?? selectedQuestion?.answers[0];
  const selectedSourceKey = useMemo(
    () => (selectedAnswer ? answerSourceKey(selectedAnswer) : ""),
    [selectedAnswer?.title, selectedAnswer?.paragraphs],
  );
  const totalAnswers = questions.reduce(
    (total, question) => total + question.answers.length,
    0,
  );
  const isPublic = data?.source === "zhihu-public" || data?.source === "zhihu-cache";
  const activeSavedId = level === 2 ? selectedAnswer?.id : selectedQuestion?.id;
  const isSaved = collection.some(
    (item) =>
      item.id === activeSavedId &&
      item.type === (level === 2 ? "answer" : "question"),
  );

  const [spaceReadyKey, setSpaceReadyKey] = useState<string | null>(null);
  const [galaxyReadyKey, setGalaxyReadyKey] = useState<string | null>(null);
  const wormhole = useWormhole({
    seed: query || selectedQuestion?.title || "今日热点",
    context: [...(data?.keywords ?? []), ...questions.map(question => question.title)].slice(0, 12),
    onBegin: () => {
      setSpaceReadyKey(null);
      setGalaxyReadyKey(null);
      if (tripFinishedRef.current) beginTrip();
      setFlightMode(false);
      setReaderOpen(false);
      setDrawer(null);
    },
    onArrive: (result, keyword) => {
      // Reuse this exact search response; travelling must not spend quota twice.
      setGalaxyReadyKey(null);
      wormholeResult.current = result;
      pendingVisit.current = null;
      setDiscoveryMode("hot");
      setSearchText(keyword);
      setQuery(keyword);
      setEntry(previous => ({ ...previous, query: keyword }));
      setResetToken(value => value + 1);
      const url = new URL(window.location.href);
      url.searchParams.delete("topic");
      url.searchParams.set("q", keyword);
      window.history.replaceState(window.history.state, "", url);
      if (keyword === query) setRetry(value => value + 1);
    },
  });
  const resetWormhole = wormhole.reset;
  const wormholeActive = wormhole.phase !== "idle";
  const wormholeSuspended = wormhole.phase === "entering" || wormhole.phase === "space" || wormhole.phase === "departing";
  const spaceRenderKey = JSON.stringify([wormhole.seed, wormhole.topics.map(topic => topic.keyword)]);
  const galaxyRenderKey = JSON.stringify([query, data?.query, data?.fetchedAt, resetToken, questions.map(question => question.id)]);
  const spaceReady = useCallback(() => setSpaceReadyKey(spaceRenderKey), [spaceRenderKey]);
  const galaxyReady = useCallback(() => setGalaxyReadyKey(galaxyRenderKey), [galaxyRenderKey]);
  const entryReady = spaceReadyKey === spaceRenderKey && !wormhole.loading;
  const exitReady = galaxyReadyKey === galaxyRenderKey && !loading && data?.query === query;
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(
    () =>
      registerObservatoryEntry((next) => {
        resetWormhole();
        wormholeResult.current = null;
        pendingVisit.current = null;
        beginTrip();
        setDiscoveryMode("hot");
        setEntry(next);
        setQuery(next.query);
        setSearchText(next.query);
        setDrawer(null);
        setReaderOpen(false);
        setDepth(0);
        setRetry((value) => value + 1);
      }),
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    const serial = ++searchSerial.current;
    const previousVoyage = voyageRef.current;
    const prepared = wormholeResult.current?.query === query ? wormholeResult.current : null;
    wormholeResult.current = null;
    const animateSearch = !prepared && !reducedMotionRef.current && !pendingVisit.current && !!sceneSnapshot.current?.questions.length
      && (!!data?.questions.length || !!previousVoyage);
    const startedAt = animateSearch && previousVoyage && previousVoyage.phase !== "birth"
      ? previousVoyage.startedAt : performance.now();
    const remaining = animateSearch ? Math.max(0, COLLAPSE_MS - (performance.now() - startedAt)) : 0;
    let collapseTimer = 0;
    const minimum = new Promise<void>((resolve) => {
      if (!animateSearch) { resolve(); return; }
      const finish = () => { clearTimeout(collapseTimer); resolve(); };
      finishCollapse.current = finish;
      controller.signal.addEventListener("abort", finish, { once: true });
      collapseTimer = window.setTimeout(() => {
        if (!controller.signal.aborted && !reducedMotionRef.current)
          setVoyage({ id: serial, phase: "wait", startedAt });
        resolve();
      }, remaining);
    });
    setVoyage(animateSearch ? { id: serial, phase: remaining ? "collapse" : "wait", startedAt } : null);
    setLoading(true);
    setError("");
    setDepth(0);
    setSelectedParagraph(null);
    setData(null);
    setDetails({});
    setExpandedQuestions({});
    setHighlights({});
    setReaderOpen(false);
    setSelectedQuote(undefined);
    (prepared ? Promise.resolve(prepared) : fetch(`/api/explore?q=${encodeURIComponent(query)}${!query && discoveryMode === "public" ? "&mode=public" : ""}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.message ??
              result.error?.message ??
              result.error ??
              "暂时无法连接知识星海",
          );
        return result as ExploreResponse;
      }))
      .then(async (result) => {
        await minimum;
        if (controller.signal.aborted) return;
        const pending = pendingVisit.current;
        let destination = pending
          ? locateStop(result.questions, pending)
          : undefined;
        let restoreError: string | undefined;
        if (pending?.answerId && !destination) {
          const parent = result.questions.find(
            (question) => question.id === pending.questionId,
          );
          if (
            parent &&
            !parent.answersExpanded &&
            parent.kind !== "topic" &&
            parent.kind !== "article"
          ) {
            try {
              const expanded = await fetch(
                `/api/questions/${encodeURIComponent(parent.id)}?q=${encodeURIComponent(query)}`,
                { signal: controller.signal },
              ).then(readResponse<QuestionResponse>);
              if (controller.signal.aborted) return;
              if (expanded.question.id !== parent.id)
                throw new Error(
                  "原问题暂时无法确认，请通过收藏中的来源链接阅读。",
                );
              result = {
                ...result,
                questions: result.questions.map((question) =>
                  question.id === parent.id ? expanded.question : question,
                ),
              };
              destination = locateStop(result.questions, pending);
            } catch (reason) {
              if (controller.signal.aborted) return;
              restoreError =
                reason instanceof Error
                  ? reason.message
                  : "暂时无法展开原问题，请稍后再试。";
            }
          }
        }
        if (controller.signal.aborted) return;
        if (animateSearch) setResetToken((value) => value + 1);
        setData(result);
        const selected = destination?.question ?? result.questions[0];
        setSelectedQuestionId(selected?.id ?? null);
        setSelectedAnswerId(
          destination?.answerId ?? selected?.answers[0]?.id ?? null,
        );
        if (pending) {
          setDepth(destination ? (destination.answerId ? 2 : 1) : 0);
          if (!destination)
            notify(
              restoreError ??
                "这条收藏或足迹暂未出现在最新结果中，可从行囊中的来源链接继续阅读。",
            );
          pendingVisit.current = null;
        }
        if (animateSearch && !reducedMotionRef.current && result.questions.length) {
          // Start the full visual duration after Three.js has presented its
          // first frame; shader preparation must not consume the ignition.
          setVoyage({ id: serial, phase: "birth", startedAt: performance.now(), ready: false });
        } else setVoyage(null);
      })
      .catch(async (reason) => {
        await minimum;
        if (!controller.signal.aborted) {
          setVoyage(null);
          setError(
            reason instanceof Error ? reason.message : "连接中断，请稍后重试",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      clearTimeout(collapseTimer);
    };
  }, [query, retry, discoveryMode]);

  useEffect(() => {
    setDetailError("");
    setDetailLoading(false);
    if (
      level !== 2 ||
      !selectedAnswer?.workId ||
      !selectedAnswer.isExcerpt ||
      selectedAnswer.paragraphs.length > 0 ||
      details[selectedAnswer.id]
    )
      return;
    const controller = new AbortController();
    setDetailLoading(true);
    fetch(`/api/knowledge/${encodeURIComponent(selectedAnswer.workId)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.message ??
              result.error?.message ??
              result.error ??
              "暂时无法加载正文",
          );
        return result as Answer;
      })
      .then((answer) => {
        if (controller.signal.aborted) return;
        setDetails((previous) => ({
          ...previous,
          [selectedAnswer.id]: answer,
        }));
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setDetailError(
            reason instanceof Error ? reason.message : "正文加载失败",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [
    level,
    selectedAnswer?.id,
    selectedAnswer?.workId,
    selectedAnswer?.isExcerpt,
    details,
    detailRetry,
  ]);

  useEffect(() => {
    if (
      loading ||
      tripFinishedRef.current ||
      data?.query !== query ||
      level === 0 ||
      !selectedQuestion ||
      (level === 2 && !selectedAnswer)
    )
      return;
    const item: JourneyStop & { url?: string } = {
      id: crypto.randomUUID(),
      title: level === 2 ? selectedAnswer!.title : selectedQuestion.title,
      type: level === 2 ? "answer" : "question",
      questionId: selectedQuestion.id,
      answerId: level === 2 ? selectedAnswer?.id : undefined,
      query,
      visitedAt: new Date().toISOString(),
      url: level === 2 ? selectedAnswer?.url : selectedQuestion.url,
    };
    setJourney((previous) => {
      const last = previous.at(-1);
      if (
        last?.questionId === item.questionId &&
        last?.answerId === item.answerId &&
        last?.query === item.query
      )
        return previous;
      const next = [...previous, item].slice(-300);
      if (!saveJourney(next))
        notify("浏览器未能保存足迹，请导出旅行手记保留本次记录");
      return next;
    });
  }, [
    level,
    selectedQuestion?.id,
    selectedAnswer?.id,
    query,
    loading,
    data?.query,
    tripFinished,
    notify,
  ]);

  function chooseQuestion(id: string, interruptVoyage = false) {
    if (voyage && !interruptVoyage) return;
    if (tripFinishedRef.current) beginTrip();
    if (interruptVoyage) setVoyage(null);
    const question = questions.find((item) => item.id === id);
    setSelectedQuestionId(id);
    setSelectedAnswerId(question?.answers[0]?.id ?? null);
    setSelectedParagraph(null);
    setSelectedQuote(undefined);
    setReaderOpen(false);
  }
  function chooseAnswer(id: string) {
    if (voyage) return;
    if (tripFinishedRef.current) beginTrip();
    setSelectedAnswerId(id);
    setSelectedParagraph(null);
    setSelectedQuote(undefined);
    setReaderOpen(false);
  }
  function search(event: FormEvent) {
    event.preventDefault();
    if (tripFinishedRef.current) beginTrip();
    setDiscoveryMode("hot");
    pendingVisit.current = null;
    const next = searchText.trim().slice(0, 160);
    setQuery(next);
    setEntry((previous) => ({ ...previous, query: next }));
    const url = new URL(window.location.href);
    url.searchParams.delete("topic");
    if (next) url.searchParams.set("q", next);
    else url.searchParams.delete("q");
    window.history.replaceState({}, "", url);
    if (next === query) setRetry((value) => value + 1);
    searchRef.current?.blur();
  }
  function discover() {
    if (tripFinishedRef.current) beginTrip();
    setDiscoveryMode("hot");
    pendingVisit.current = null;
    setSearchText("");
    setQuery("");
    setEntry((previous) => ({ ...previous, query: "" }));
    const url = new URL(window.location.href);
    url.searchParams.delete("q");
    url.searchParams.delete("topic");
    window.history.replaceState({}, "", url);
    if (!query) setRetry((value) => value + 1);
  }
  function browsePublic() {
    discover();
    setDiscoveryMode("public");
  }
  function toggleSave() {
    if (level === 0 || !selectedQuestion || !activeSavedId) return;
    const type: SavedItem["type"] = level === 2 ? "answer" : "question";
    const next: SavedItem[] = isSaved
      ? collection.filter(
          (item) => !(item.id === activeSavedId && item.type === type),
        )
      : [
          {
            id: activeSavedId,
            type,
            title: level === 2 ? selectedAnswer!.title : selectedQuestion.title,
            excerpt:
              level === 2 ? selectedAnswer!.excerpt : selectedQuestion.excerpt,
            author: level === 2 ? selectedAnswer?.author : undefined,
            url: level === 2 ? selectedAnswer?.url : selectedQuestion.url,
            questionId: selectedQuestion.id,
            answerId: level === 2 ? selectedAnswer?.id : undefined,
            query,
            savedAt: new Date().toISOString(),
          },
          ...collection,
        ].slice(0, 500);
    setCollection(next);
    const persisted = saveCollection(next);
    notify(
      persisted
        ? isSaved
          ? "已从知识行囊中移除"
          : "一束灵感，已收入知识行囊"
        : "浏览器存储不可用，请导出旅行手记保存",
    );
  }
  function openReflection() {
    if (level === 0 || !selectedQuestion || (level === 2 && !selectedAnswer))
      return;
    setReflectionTarget({
      id: level === 2 ? selectedAnswer!.id : selectedQuestion.id,
      title: level === 2 ? selectedAnswer!.title : selectedQuestion.title,
      quote:
        level === 2 && selectedParagraph !== null
          ? (selectedQuote ?? selectedAnswer?.paragraphs[selectedParagraph])
          : undefined,
    });
    setReflectionText("");
  }
  function saveReflection(event: FormEvent) {
    event.preventDefault();
    if (!reflectionTarget || !reflectionText.trim()) return;
    const next: Reflection[] = [
      {
        id: crypto.randomUUID(),
        targetId: reflectionTarget.id,
        targetTitle: reflectionTarget.title,
        quote: reflectionTarget.quote,
        text: reflectionText.trim(),
        query,
        createdAt: new Date().toISOString(),
      },
      ...reflections,
    ].slice(0, 500);
    setReflections(next);
    const persisted = saveReflections(next);
    setReflectionTarget(null);
    setReflectionText("");
    notify(
      persisted
        ? "思考已留下，回到小屋时再慢慢展开"
        : "浏览器存储不可用，请导出旅行手记保存",
    );
  }
  function visit(item: Pick<JourneyStop, "questionId" | "answerId" | "query">) {
    if (tripFinishedRef.current) beginTrip();
    const targetMode = /^(?:topic-|knowledge-)/.test(item.questionId) ? "public" : "hot";
    setDiscoveryMode(targetMode);
    setDrawer(null);
    setSearchText(item.query);
    setEntry((previous) => ({ ...previous, query: item.query }));
    const url = new URL(window.location.href);
    url.searchParams.delete("topic");
    if (item.query) url.searchParams.set("q", item.query);
    else url.searchParams.delete("q");
    window.history.replaceState({}, "", url);
    const destination = locateStop(questions, item);
    if (query === item.query && destination && (query || targetMode === discoveryMode)) {
      chooseQuestion(destination.question.id, true);
      if (destination.answerId) setSelectedAnswerId(destination.answerId);
      setDepth(destination.answerId ? 2 : 1);
    } else {
      pendingVisit.current = item;
      setSearchText(item.query);
      setQuery(item.query);
      if (query === item.query) setRetry((value) => value + 1);
    }
  }
  function exportNotes() {
    downloadMarkdown(
      exportNotebook(collection, reflections, tripFinished ? finishedExport?.journey ?? [] : journey),
      `Wanderwise-旅行手记-${new Date().toISOString().slice(0, 10)}.md`,
    );
    notify("旅行手记已导出");
  }
  function returnHome() {
    if (journey.length && !tripFinishedRef.current) {
      setDrawer(null);
      setTripError("");
      setTripExit("return");
      return;
    }
    allowLeave();
    if (!returnToObservatory(entry, { collection, reflections, journey: [] }))
      setDrawer("return");
  }
  function beginTrip() {
    startNewTrip();
    tripFinishedRef.current = false;
    setTripFinished(false);
    setJourney([]);
    setTripExit(null);
    setTripError("");
    setTripStatus("");
    setFinishedExport(null);
    rearm();
  }
  function finishTrip(exportRequested: boolean) {
    const mode = tripExit;
    let packet: JourneyExportPacket | undefined;
    let status = "本次旅行已结束，足迹未导出。";
    if (exportRequested) {
      try {
        packet = createJourneyExport({ query, journey });
        const result = exportJourneyToObservatory(packet);
        if (!result.stored && !result.acknowledged) {
          setTripError("足迹暂时未能保存或交付，请重试。本次记录仍然保留。");
          return;
        }
        status = result.acknowledged
          ? "占星台已接收本次漫游足迹。"
          : "本次足迹已保存，待占星台领取。";
      } catch {
        setTripError("足迹暂时未能导出，请重试。本次记录仍然保留。");
        return;
      }
    }
    // An ended trip must never be replaced by a late wormhole destination.
    resetWormhole();
    wormholeResult.current = null;
    // Disable the native guard synchronously before handing navigation to a host.
    allowLeave();
    startNewTrip();
    tripFinishedRef.current = true;
    setTripFinished(true);
    setJourney([]);
    setTripExit(null);
    setTripStatus(status);
    setFinishedExport(packet ?? null);
    setTripError("");
    setDrawer(null);
    setReaderOpen(false);
    setReflectionTarget(null);
    setDepth(0);
    setVoyage(null);
    if (mode === "return") {
      const returned = returnToObservatory(entry, {
        collection, reflections, journey: packet?.journey ?? [], ...(packet ? { trip: packet } : {}),
      });
      if (!returned) setDrawer("return");
    } else notify(`${status}现在可以关闭此页。`);
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      notify("当前浏览器暂不支持全屏模式");
    }
  }
  useEffect(() => {
    const change = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (wormholeActive && !tripExit) {
        if (event.key === "Escape") { event.preventDefault(); wormhole.back(); }
        return;
      }
      const editing =
        event.target instanceof Element &&
        event.target.closest(
          'input, textarea, select, [contenteditable="true"]',
        );
      if (event.key === "Escape") {
        if (tripExit) setTripExit(null);
        else if (reflectionTarget) setReflectionTarget(null);
        else if (drawer) setDrawer(null);
        else if (readerOpen) setReaderOpen(false);
        else if (level > 0) setDepth(level - 1);
        else setFlightMode(false);
        return;
      }
      if (
        editing ||
        tripExit ||
        drawer ||
        reflectionTarget ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      if (event.key.toLowerCase() === "e") toggleSave();
      if (event.key.toLowerCase() === "r") openReflection();
      if (event.key.toLowerCase() === "f") {
        if (!event.repeat && level === 2 && selectedAnswer) {
          event.preventDefault();
          setReaderOpen((value) => !value);
        }
        return;
      }
      if (readerOpen) return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "?") setDrawer("help");
      if (!readerOpen && !event.repeat && event.key.toLowerCase() === "v")
        setFlightMode((value) => !value);
      if (!readerOpen && event.key === "Enter" && level === 2 && selectedAnswer)
        openReader();
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });

  useEffect(() => {
    const controller = new AbortController();
    setConnectionError("");
    fetch("/api/health", { signal: controller.signal })
      .then(readResponse<ConnectionStatus>)
      .then(setConnection)
      .catch((reason) => {
        if (!controller.signal.aborted)
          setConnectionError(
            reason instanceof Error ? reason.message : "连接状态暂不可用",
          );
      });
    return () => controller.abort();
  }, [connectionRetry]);

  useEffect(() => {
    setAnswerError("");
    setAnswerLoading(false);
    if (
      loading ||
      data?.query !== query ||
      level === 0 ||
      !selectedQuestion ||
      selectedQuestion.answersExpanded ||
      selectedQuestion.kind === "topic" ||
      selectedQuestion.kind === "article"
    )
      return;
    const controller = new AbortController();
    const questionId = selectedQuestion.id;
    setAnswerLoading(true);
    fetch(
      `/api/questions/${encodeURIComponent(questionId)}?q=${encodeURIComponent(query)}`,
      { signal: controller.signal },
    )
      .then(readResponse<QuestionResponse>)
      .then((result) => {
        if (controller.signal.aborted) return;
        setExpandedQuestions((previous) => ({
          ...previous,
          [questionId]: result.question,
        }));
        if (result.notice) notify(result.notice);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setAnswerError(
            reason instanceof Error
              ? reason.message
              : "暂未能展开这个问题的回答",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setAnswerLoading(false);
      });
    return () => controller.abort();
  }, [
    query,
    level,
    selectedQuestion?.id,
    selectedQuestion?.answersExpanded,
    answerRetry,
    loading,
    data?.query,
  ]);

  useEffect(() => {
    setHighlightError("");
    setHighlightLoading(false);
    if (
      loading ||
      data?.query !== query ||
      level !== 2 ||
      !selectedAnswer ||
      !selectedQuestion ||
      answerLoading ||
      (highlights[selectedAnswer.id]?.sourceKey === selectedSourceKey &&
        quotesMatch(selectedAnswer, highlights[selectedAnswer.id]))
    )
      return;
    const controller = new AbortController();
    const answerId = selectedAnswer.id;
    setHighlightLoading(true);
    fetch(
      `/api/answers/${encodeURIComponent(answerId)}/highlights?q=${encodeURIComponent(query)}&questionId=${encodeURIComponent(selectedQuestion.id)}`,
      { signal: controller.signal },
    )
      .then(readResponse<HighlightResponse>)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (
          result.answerId !== answerId ||
          !quotesMatch(selectedAnswer, result)
        )
          throw new Error("片段与当前原文不匹配，已保留原文内容。");
        setHighlights((previous) => ({
          ...previous,
          [answerId]: { ...result, sourceKey: selectedSourceKey },
        }));
        if (result.notice) notify(result.notice);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setHighlightError(
            reason instanceof Error
              ? reason.message
              : "片段筛选暂时不可用，仍可直接阅读原文",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setHighlightLoading(false);
      });
    return () => controller.abort();
  }, [
    query,
    level,
    selectedQuestion?.id,
    selectedAnswer?.id,
    selectedSourceKey,
    answerLoading,
    highlightRetry,
    loading,
    data?.query,
  ]);

  useEffect(() => {
    if (!selectedQuote || !selectedAnswer) return;
    const index = selectedAnswer.paragraphs.findIndex((paragraph) =>
      paragraph.includes(selectedQuote),
    );
    setSelectedParagraph(index >= 0 ? index : null);
    if (index < 0) setSelectedQuote(undefined);
  }, [selectedSourceKey]);

  function selectParagraph(index: number, quote?: string) {
    setSelectedParagraph(index);
    setSelectedQuote(
      quote ??
        selectedAnswer?.highlights?.find(
          (highlight) => highlight.paragraphIndex === index,
        )?.text ??
        selectedAnswer?.paragraphs[index],
    );
  }
  function openReader(paragraphIndex?: number, quote?: string) {
    if (!selectedAnswer) return;
    if (paragraphIndex !== undefined) selectParagraph(paragraphIndex, quote);
    setReaderOpen(true);
  }
  function changeDepth(value: number) {
    if (voyage) return;
    if (tripFinishedRef.current && value > 0) beginTrip();
    setDepth(
      Math.max(
        0,
        Math.min(selectedAnswer ? 2 : selectedQuestion ? 1 : 0, value),
      ),
    );
    setReaderOpen(false);
  }
  const modalActive = !!drawer || !!reflectionTarget || readerOpen || !!tripExit;
  if ((!loading && !voyage || voyage?.phase === "birth") && questions.length) {
    sceneSnapshot.current = {
      questions, questionId: selectedQuestion?.id ?? null,
      answerId: selectedAnswer?.id ?? null, depth,
      paragraph: selectedParagraph, quote: selectedQuote,
    };
  }
  const departingScene = voyage && voyage.phase !== "birth" ? sceneSnapshot.current : null;

  return (
    <main
      className={`app immersion-v2 depth-${level} ${modalActive ? "has-modal" : ""}`}
      data-wormhole={wormhole.phase}
      data-wormhole-space-ready={entryReady}
      data-wormhole-galaxy-ready={exitReady}
    >
      <div
        className="universe"
        aria-label="交互式三维知识宇宙"
        {...(modalActive || wormholeActive ? { inert: "" } : {})}
        aria-hidden={wormholeActive}
      >
        <GalaxyScene
          questions={departingScene?.questions ?? questions}
          selectedQuestionId={departingScene ? departingScene.questionId : selectedQuestion?.id ?? null}
          selectedAnswerId={departingScene ? departingScene.answerId : selectedAnswer?.id ?? null}
          depth={departingScene?.depth ?? depth}
          voyage={voyage}
          suspended={wormholeSuspended}
          onReady={galaxyReady}
          onVoyageReady={voyageReady}
          onDepthChange={changeDepth}
          onSelectQuestion={chooseQuestion}
          onSelectAnswer={chooseAnswer}
          flightMode={flightMode && !modalActive && !voyage && !wormholeActive}
          reducedMotion={reducedMotion}
          resetToken={resetToken}
          onOpenReader={openReader}
          selectedParagraph={departingScene ? departingScene.paragraph : selectedParagraph}
          selectedQuote={departingScene ? departingScene.quote : selectedQuote}
          onSelectParagraph={selectParagraph}
        />
      </div>
      <div className="universe-vignette" />
      <div className="interface" {...(modalActive || wormholeActive ? { inert: "" } : {})} aria-hidden={wormholeActive}>
        <header className="topbar">
          <button
            className="brand"
            onClick={() => {
              changeDepth(0);
              setResetToken((value) => value + 1);
            }}
            aria-label="Wanderwise 返回星海"
          >
            <span className="brand-symbol">
              <Sparkles size={26} strokeWidth={1.2} />
            </span>
            <span>Wanderwise</span>
          </button>
          <form className="search-box" onSubmit={search} role="search">
            <Search size={17} />
            <input
              ref={searchRef}
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="带着一个问题出发"
              aria-label="探索问题或话题"
              maxLength={160}
            />
            {(query || discoveryMode === "public") && (
              <button
                type="button"
                className="search-clear"
                aria-label={query ? "回到自由漫游" : "返回知乎热榜"}
                onClick={discover}
              >
                <X size={14} />
              </button>
            )}
            <button
              type="submit"
              className="search-submit"
              aria-label="开始探索"
            >
              {loading ? (
                <LoaderCircle className="spinning" size={16} />
              ) : (
                <ArrowRight size={17} />
              )}
            </button>
          </form>
          <nav className="main-nav" aria-label="主导航">
            <button
              className="nav-link"
              aria-label="知识行囊"
              onClick={() => setDrawer("collection")}
            >
              <Backpack size={18} />
              <span>行囊</span>
              {collection.length > 0 && (
                <span className="nav-count">{collection.length}</span>
              )}
            </button>
            <button
              className="nav-link"
              aria-label="探索足迹"
              onClick={() => setDrawer("journey")}
            >
              <Footprints size={18} />
              <span>足迹</span>
            </button>
            <BackgroundMusic />
            <button
              className="nav-link home-link"
              aria-label="返回占星台"
              title="返回占星台"
              onClick={returnHome}
            >
              <Telescope size={19} />
            </button>
          </nav>
        </header>
        {loading && !voyage && (
          <div className="center-message loading-message" role="status">
            <span className="loading-orbit">
              <Orbit size={31} />
            </span>
            <h2>正在展开知识星海</h2>
          </div>
        )}
        {voyage && <span className="search-voyage-status" role="status">
          {voyage.phase === "birth" ? "新的知识星海正在涌现" : "正在穿越黑洞，寻找新的星光"}
        </span>}
        {!loading && level === 0 && data?.source === "zhihu-hot" && data.stale && (
          <div className="orbit-status" role="status">
            <Info size={13} />
            <span>热榜暂时未能更新，当前显示 {timeLabel(data.fetchedAt)} 获取的缓存。</span>
          </div>
        )}
        {!loading && (error || !questions.length) && (
          <div className="center-message empty-universe" role="status">
            <Telescope size={34} />
            <h2>
              {error ? "暂时无法抵达这片星海" : "这个问题还没有匹配的星光"}
            </h2>
            <p>
              {error ||
                (connection?.configured
                  ? "试试更简短的关键词，寻找另一个方向。"
                  : "当前检索知乎公开知识。连接知乎搜索后，可以探索更多真实问题与回答。")}
            </p>
            <div className="button-row">
              <button
                className="primary-button"
                onClick={
                  error ? () => setRetry((value) => value + 1) : browsePublic
                }
              >
                {error ? <RefreshCw size={15} /> : <Compass size={15} />}
                {error ? "重新连接" : "浏览公开知识"}
              </button>
              {error && !query && discoveryMode === "hot" && (
                <button className="secondary-button" onClick={browsePublic}>
                  浏览公开知识
                </button>
              )}
              {!connection?.configured && (
                <button
                  className="secondary-button"
                  onClick={() => setDrawer("connection")}
                >
                  <Cable size={15} />
                  连接知乎
                </button>
              )}
            </div>
          </div>
        )}
        {!loading &&
          (answerLoading ||
            highlightLoading ||
            answerError ||
            highlightError) && (
            <div className="orbit-status" role="status">
              {answerLoading || highlightLoading ? (
                <>
                  <LoaderCircle className="spinning" size={13} />
                  <span>
                    {answerLoading
                      ? "正在寻找这个问题下的回答"
                      : "正在筛选原文片段"}
                  </span>
                </>
              ) : (
                <>
                  <Info size={14} />
                  <span>{level === 1 ? answerError : highlightError}</span>
                  <button
                    onClick={() =>
                      level === 1
                        ? setAnswerRetry((value) => value + 1)
                        : setHighlightRetry((value) => value + 1)
                    }
                  >
                    重试
                  </button>
                </>
              )}
            </div>
          )}
        <div className="universe-navigation">
          {level > 0 && (
            <button
              className="back-orbit"
              onClick={() => changeDepth(level - 1)}
              aria-label="返回上一层"
            >
              <ArrowLeft size={17} />
              <span>返回</span>
            </button>
          )}
          <button
            className={`map-toggle ${showMap ? "selected" : ""}`}
            onClick={() => setShowMap((value) => !value)}
            aria-label="星海图谱"
            title="星海图谱"
          >
            <Map size={17} />
          </button>
          {showMap && (
            <div className="minimap glass-panel">
              <div className="minimap-title">
                <span>选择星系</span>
                <IconButton
                  label="关闭星海图谱"
                  onClick={() => setShowMap(false)}
                >
                  <X size={13} />
                </IconButton>
              </div>
              {questions.map((question, index) => (
                <button
                  key={question.id}
                  onClick={() => {
                    chooseQuestion(question.id);
                    changeDepth(1);
                    setShowMap(false);
                  }}
                  className={
                    selectedQuestion?.id === question.id ? "selected" : ""
                  }
                >
                  <span style={{ color: question.color }}>
                    {number(index + 1)}
                  </span>
                  <span>{question.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {level > 0 && selectedQuestion && (
          <div className="context-actions" aria-label="当前内容操作">
            <button
              aria-label={isSaved ? "取消收藏当前内容" : "收藏当前内容"}
              onClick={toggleSave}
            >
              {isSaved ? <Check size={15} /> : <Backpack size={15} />}
              <span>{isSaved ? "已收藏" : "收藏"}</span>
              <kbd>E</kbd>
            </button>
            <i />
            <button aria-label="留下思考" onClick={openReflection}>
              <PenLine size={15} />
              <span>
                {selectedParagraph !== null && level === 2
                  ? "段落思考"
                  : "思考"}
              </span>
              <kbd>R</kbd>
            </button>
            {level === 2 && (
              <>
                <i />
                <button aria-label="打开原文阅览" onClick={() => openReader()}>
                  <BookOpen size={15} />
                  <span>原文</span>
                  <kbd>F</kbd>
                </button>
              </>
            )}
          </div>
        )}
        <div className="scene-tools">
          <IconButton
            label={flightMode ? "退出自由飞行 (V)" : "自由飞行 (V)"}
            active={flightMode}
            onClick={() => setFlightMode((value) => !value)}
          >
            <Navigation size={17} />
          </IconButton>
          <IconButton
            label="重置视角"
            onClick={() => {
              setResetToken((value) => value + 1);
              changeDepth(0);
            }}
          >
            <RefreshCw size={16} />
          </IconButton>
          <IconButton
            label={fullscreen ? "退出全屏" : "进入全屏"}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize size={16} /> : <Expand size={16} />}
          </IconButton>
          <IconButton
            label="内容与模型连接"
            onClick={() => setDrawer("connection")}
            className={connection?.configured ? "connection-live" : ""}
          >
            <Cable size={17} />
          </IconButton>
          <IconButton label="探索指南" onClick={() => setDrawer("help")}>
            <span className="help-icon">?</span>
          </IconButton>
        </div>
      </div>
      <div className="wormhole-flow" {...(modalActive ? { inert: "" } : {})}>
        {wormhole.phase === "idle" && (
          <WormholePortal onEnter={wormhole.enter} reducedMotion={reducedMotion}
            disabled={modalActive || loading || !!voyage || !questions.length} />
        )}
        {(wormhole.phase === "entering" || wormhole.phase === "space" || wormhole.phase === "departing") && (
          <AssociationSpace key={spaceRenderKey} active={wormhole.phase === "space"} onReady={spaceReady} seed={wormhole.seed} topics={wormhole.topics} reducedMotion={reducedMotion}
            paused={modalActive || wormhole.phase === "departing"} loading={wormhole.loading}
            error={wormhole.error} onRetry={wormhole.retry} onChoose={wormhole.choose} onBack={wormhole.back} />
        )}
        {wormhole.phase === "entering" && (
          <WormholeTransit key="enter" direction="in" ready={entryReady} reducedMotion={reducedMotion} onComplete={wormhole.transitComplete} />
        )}
        {(wormhole.phase === "departing" || wormhole.phase === "emerging") && (
          <WormholeTransit key="leave" direction="out" ready={wormhole.phase === "emerging" && exitReady}
            reducedMotion={reducedMotion} onComplete={wormhole.transitComplete} />
        )}
      </div>
      {readerOpen && selectedAnswer && !tripExit && (
        <ReadingRoom
          answer={selectedAnswer}
          selectedParagraph={selectedParagraph}
          saved={isSaved}
          onClose={() => setReaderOpen(false)}
          onSave={toggleSave}
          onReflect={openReflection}
          onSelectParagraph={selectParagraph}
          dimmed={!!reflectionTarget}
        />
      )}
      {drawer && !tripExit && (
        <Modal
          title={
            drawer === "collection"
              ? "知识行囊"
              : drawer === "journey"
                ? "探索足迹"
                : drawer === "return"
                  ? "带着星光，回到出发的地方"
                  : drawer === "connection"
                    ? "内容与模型连接"
                    : "探索指南"
          }
          onClose={() => setDrawer(null)}
          className={
            drawer === "collection" || drawer === "journey" ? "drawer" : ""
          }
        >
          {drawer === "collection" && (
            <>
              <p className="modal-subtitle">把让你停留的光，装进行囊。</p>
              <div className="drawer-tabs">
                <button
                  className={collectionTab === "saved" ? "active" : ""}
                  onClick={() => setCollectionTab("saved")}
                >
                  收藏 <span>{collection.length}</span>
                </button>
                <button
                  className={collectionTab === "thoughts" ? "active" : ""}
                  onClick={() => setCollectionTab("thoughts")}
                >
                  我的思考 <span>{reflections.length}</span>
                </button>
              </div>
              <div className="drawer-content">
                {collectionTab === "saved" ? (
                  collection.length ? (
                    collection.map((item) => (
                      <article
                        className="saved-card"
                        key={`${item.type}-${item.id}`}
                      >
                        <div className="saved-card-meta">
                          <span>
                            {item.type === "question" ? "问题星系" : "文章恒星"}
                          </span>
                          <IconButton
                            label={`移除收藏：${item.title}`}
                            onClick={() => {
                              const next = collection.filter(
                                (other) =>
                                  !(
                                    other.id === item.id &&
                                    other.type === item.type
                                  ),
                              );
                              setCollection(next);
                              if (!saveCollection(next))
                                notify("本次移除未能同步到浏览器存储");
                            }}
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        </div>
                        <button
                          className="saved-card-title"
                          onClick={() => visit(item)}
                        >
                          <RichText text={item.title} inline />
                          <ArrowUpRight size={16} />
                        </button>
                        <p><RichText text={item.excerpt} inline /></p>
                        <div className="saved-card-bottom">
                          <span>{item.author || "一个值得继续探索的问题"}</span>
                          <time>{timeLabel(item.savedAt)}</time>
                        </div>
                        {item.url && (
                          <a
                            className="saved-source-link"
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            查看内容来源
                            <ArrowUpRight size={12} />
                          </a>
                        )}
                      </article>
                    ))
                  ) : (
                    <EmptyState
                      icon={<Backpack />}
                      title="行囊轻轻，旅途才刚开始"
                      text="进入一个星系后，按 E 收藏问题或文章。"
                    />
                  )
                ) : reflections.length ? (
                  reflections.map((item) => (
                    <article
                      className="saved-card reflection-card"
                      key={item.id}
                    >
                      <div className="saved-card-meta">
                        <span>
                          <PenLine size={13} />
                          我的思考
                        </span>
                        <IconButton
                          label="删除这条思考"
                          onClick={() => {
                            const next = reflections.filter(
                              (other) => other.id !== item.id,
                            );
                            setReflections(next);
                            if (!saveReflections(next))
                              notify("本次删除未能同步到浏览器存储");
                          }}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                      <h3>{item.targetTitle}</h3>
                      {item.quote && <blockquote><RichText text={item.quote} inline /></blockquote>}
                      <p className="reflection-content"><RichText text={item.text} inline /></p>
                      <time>{timeLabel(item.createdAt)}</time>
                    </article>
                  ))
                ) : (
                  <EmptyState
                    icon={<PenLine />}
                    title="留一点此刻的想法"
                    text="在问题或文章中按 R，让灵感留下痕迹。"
                  />
                )}
              </div>
              <div className="drawer-footer">
                <span>保存在当前浏览器中</span>
                <button className="secondary-button" onClick={exportNotes}>
                  <Download size={15} />
                  导出旅行手记
                </button>
              </div>
            </>
          )}
          {drawer === "journey" && (
            <>
              <p className="modal-subtitle">仅记录本次旅行，结束时可交给占星台。</p>
              <div className="journey-summary">
                <strong>{journey.length}</strong>
                <span>次停留</span>
                <i />
                <span>本次漫游</span>
              </div>
              <div className="drawer-content journey-list">
                {journey.length ? (
                  [...journey].reverse().map((stop, index) => (
                    <button
                      className="journey-stop"
                      key={stop.id}
                      onClick={() => visit(stop)}
                    >
                      <span className="journey-marker">
                        {stop.type === "question" ? (
                          <Orbit size={16} />
                        ) : (
                          <Sparkles size={15} />
                        )}
                      </span>
                      <span>
                        <small>
                          {stop.type === "question" ? "走进问题" : "停留阅读"} ·{" "}
                          {timeLabel(stop.visitedAt)}
                        </small>
                        <strong><RichText text={stop.title} inline /></strong>
                        <em>{stop.query || "自由漫游"}</em>
                      </span>
                      <ArrowUpRight size={15} />
                    </button>
                  ))
                ) : (
                  <EmptyState
                    icon={<Footprints />}
                    title="你的星座，等待第一条连线"
                    text="进入一片星系，开始留下探索的足迹。"
                  />
                )}
              </div>
              <div className="drawer-footer">
                <span>本次最近 300 次停留</span>
                <button className="secondary-button" onClick={returnHome}>
                  <Telescope size={15} />
                  结束旅行
                </button>
              </div>
            </>
          )}
          {drawer === "help" && (
            <>
              <p className="modal-subtitle">
                不用急着找到答案，先享受靠近的过程。
              </p>
              <div className="help-levels">
                {["问题汇成星海", "回答围绕问题", "段落围绕文章"].map(
                  (text, index) => (
                    <div key={text}>
                      <span>0{index + 1}</span>
                      <strong>{text}</strong>
                      <p>
                        {
                          [
                            "从远处看见相关主题，星光亮度随语义相关度变化。",
                            "走近一个问题，选择作者的观点继续探索。",
                            "在文章周围选择原文片段；点击中央标题打开原文阅览。",
                          ][index]
                        }
                      </p>
                    </div>
                  ),
                )}
              </div>
              <div className="shortcuts">
                {[
                  ["滚轮 / 双指缩放", "调整探索纵深"],
                  ["拖动鼠标 / 单指滑动", "转动视角"],
                  ["Shift + 拖动 / 右键拖动", "平移视角"],
                  ["点击 / 双击星体", "选择 / 进入内容"],
                  ["F", "打开 / 收起原文"],
                  ["V · W A S D", "切换飞行 · 移动"],
                  ["E / R", "收藏 / 留下思考"],
                  ["Esc / /", "返回上一层 / 搜索"],
                ].map(([key, value]) => (
                  <div key={key}>
                    <span>{value}</span>
                    <kbd>{key}</kbd>
                  </div>
                ))}
              </div>
              <label className="motion-toggle">
                <span>减少动态效果</span>
                <input
                  type="checkbox"
                  checked={reducedMotion}
                  onChange={(event) => setReducedMotion(event.target.checked)}
                />
              </label>
              <div className="source-explanation">
                <Info size={17} />
                <div>
                  <strong>关于这里的知识</strong>
                  <p>
                    {data?.notice ||
                      "内容来自知乎官方接口。公开知识模式浏览赛事内容；配置服务端知乎凭证后可使用站内搜索。搜索摘要不会被当作全文呈现。"}
                  </p>
                  <p>
                    公开模式按主题聚合多篇真实知乎作品；它们是相关原文，不冒充同一个问题的回答。连接知乎搜索后，按真实问题归属展开回答。精选文字均可定位到原段落。收藏与思考保存在本机浏览器。
                  </p>
                </div>
              </div>
            </>
          )}
          {drawer === "connection" && (
            <div className="connection-panel">
              <div className="connection-item">
                <div>
                  <span
                    className={`connection-dot ${connection?.configured ? "connected" : ""}`}
                  />
                  <strong>知乎知识源</strong>
                </div>
                <span>
                  {connection?.configured ? "搜索已配置" : "公开知识模式"}
                </span>
              </div>
              <p className="connection-description">
                {connection?.configured
                  ? "输入问题检索真实知乎内容。进入星系时，继续检索属于这个问题的回答，保留作者和原文链接。"
                  : `当前有 ${connection?.publicCount ?? 10} 篇知乎公开作品，可按主题深入阅读。配置 Access Secret 后可搜索任意问题及其回答。`}
              </p>
              {!connection?.configured && (
                <div className="connection-setup">
                  <a
                    href="https://developer.zhihu.com/profile"
                    target="_blank"
                    rel="noreferrer"
                  >
                    获取知乎 Access Secret
                    <ArrowUpRight size={14} />
                  </a>
                  <p>
                    在服务端 .env 中设置
                    ZHIHU_ACCESS_SECRET，随后重启服务。凭证不会进入浏览器。
                  </p>
                </div>
              )}
              <div className="connection-item model-connection">
                <div>
                  <span
                    className={`connection-dot ${connection?.model?.configured ? "connected" : ""}`}
                  />
                  <strong>原文片段筛选</strong>
                </div>
                <span>
                  {connection?.model?.configured
                    ? (connection.model.name ?? "模型已配置")
                    : "原文自动筛选"}
                </span>
              </div>
              <p className="connection-description">
                {connection?.model?.configured
                  ? "模型从已有原文中选择片段。所有引文均经过来源位置校验，失败时仍可阅读和使用原文筛选。"
                  : "根据问题关键词、信息量和段落差异选择原文。也可连接本地小模型或知乎直答快速模型，提高片段选择质量。"}
              </p>
              {!connection?.model?.configured && (
                <details className="connection-model-guide">
                  <summary>连接小模型</summary>
                  <p>
                    本地模型：在服务端配置 MODEL_BASE_URL、MODEL_NAME 和可选
                    MODEL_API_KEY。支持 Ollama 的兼容接口。
                  </p>
                  <p>
                    知乎直答：已有知乎凭证时，在 .env 设置
                    ZHIHU_MODEL_ENABLED=true，使用官方快速模型。两种方式均按文章请求并缓存结果。
                  </p>
                </details>
              )}
              {connectionError && (
                <p className="connection-error" role="status">
                  {connectionError}
                </p>
              )}
              <div className="connection-footer">
                <span>搜索摘要与正文节选均会标明</span>
                <button
                  className="secondary-button"
                  onClick={() => setConnectionRetry((value) => value + 1)}
                >
                  <RefreshCw size={14} />
                  刷新状态
                </button>
              </div>
            </div>
          )}
          {drawer === "return" && (
            <>
              <div className="return-illustration">
                <Telescope size={52} strokeWidth={1} />
                <Sparkles size={24} />
              </div>
              <p className="return-copy">
                {tripFinished ? "本次旅行已结束。" : "准备回到占星台。"}
              </p>
              <p className="modal-subtitle">
                {tripStatus || "当前为独立探索页面，尚未提供占星台返回入口。收藏与思考仍保存在当前浏览器。"}
              </p>
              <div className="button-row">
                <button className="primary-button" onClick={exportNotes}>
                  <Download size={16} />
                  带走旅行手记
                </button>
                <button
                  className="secondary-button"
                  onClick={() => { if (tripFinishedRef.current) beginTrip(); setDrawer(null); }}
                >
                  继续漫游
                  <ArrowRight size={16} />
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
      {tripExit && (
        <Modal title="是否导出漫游足迹" className="trip-exit-modal" onClose={() => setTripExit(null)}>
          <p className="modal-subtitle">
            本次共记录 {journey.length} 次停留。导出后，占星台可以接收这次旅行已记录的路径。
          </p>
          {tripExit === "close" && <p className="trip-exit-note">完成选择后，可直接关闭网页。</p>}
          {tripError && <p className="trip-exit-error" role="status">{tripError}</p>}
          <div className="trip-exit-actions">
            <button className="primary-button" onClick={() => finishTrip(true)}>
              <Download size={16} />{tripExit === "return" ? "导出并返回占星台" : "导出并结束旅行"}
            </button>
            <button className="secondary-button" onClick={() => finishTrip(false)}>
              {tripExit === "return" ? "不导出并返回" : "不导出，结束旅行"}
            </button>
            <button className="trip-exit-continue" onClick={() => setTripExit(null)}>继续漫游</button>
          </div>
        </Modal>
      )}
      {reflectionTarget && !tripExit && (
        <Modal
          title="让这一刻的思考，留下来"
          onClose={() => setReflectionTarget(null)}
          className="reflection-modal"
        >
          <p className="reflection-about">关于 · <RichText text={reflectionTarget.title} inline /></p>
          {reflectionTarget.quote && (
            <blockquote className="reflection-quote">
              <RichText text={reflectionTarget.quote} inline />
            </blockquote>
          )}
          <form onSubmit={saveReflection}>
            <textarea
              value={reflectionText}
              onChange={(event) => setReflectionText(event.target.value)}
              aria-label="你的思考"
              placeholder="它让你想起了什么？你赞同、好奇，或仍有疑问…"
              rows={6}
              maxLength={5000}
              autoFocus
              required
            />
            <div className="reflection-form-footer">
              <span>{reflectionText.length} / 5000 · 仅自己可见</span>
              <button
                type="submit"
                className="primary-button"
                disabled={!reflectionText.trim()}
              >
                <PenLine size={16} />
                保存思考
              </button>
            </div>
          </form>
        </Modal>
      )}
      <div
        className={`toast ${toast ? "visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        <Check size={16} />
        {toast}
      </div>
    </main>
  );
}

function EmptyState({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      {icon}
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

async function readResponse<T>(response: Response): Promise<T> {
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result.message === "string"
        ? result.message
        : "内容暂时无法读取，请稍后重试",
    );
  return result as T;
}

function locateStop(
  questions: Question[],
  stop: { questionId: string; answerId?: string },
): { question: Question; answerId?: string } | undefined {
  const direct = questions.find((question) => question.id === stop.questionId);
  if (
    direct &&
    (!stop.answerId ||
      direct.answers.some((answer) => answer.id === stop.answerId))
  )
    return { question: direct, answerId: stop.answerId };
  // Previous versions used a public work ID as its parent question ID. Match the
  // exact source ID in the new topic hierarchy, never a merely similar title.
  if (/^knowledge-\d+$/.test(stop.questionId)) {
    const answerId = stop.answerId ?? stop.questionId;
    const topic = questions.find(
      (question) =>
        question.kind === "topic" &&
        question.answers.some((answer) => answer.id === answerId),
    );
    if (topic) return { question: topic, answerId };
  }
  return undefined;
}

function answerSourceKey(answer: Answer): string {
  return JSON.stringify([answer.title, answer.paragraphs]);
}
function quotesMatch(
  answer: Answer,
  response: HighlightResponse | undefined,
): boolean {
  return (
    !!response &&
    Array.isArray(response.highlights) &&
    response.highlights.every(
      (highlight) =>
        Number.isSafeInteger(highlight.paragraphIndex) &&
        typeof highlight.text === "string" &&
        highlight.text.length > 0 &&
        answer.paragraphs[highlight.paragraphIndex]?.includes(highlight.text),
    )
  );
}
