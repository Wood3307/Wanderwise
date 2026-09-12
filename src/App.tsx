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
} from "lucide-react";
import GalaxyScene from "./components/GalaxyScene";
import type {
  Answer,
  ExploreResponse,
  JourneyStop,
  Question,
  Reflection,
  SavedItem,
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
} from "./lib/integration";

type Drawer = "collection" | "journey" | "help" | "return" | null;
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
  const [data, setData] = useState<ExploreResponse | null>(null);
  const [loading, setLoading] = useState(true);
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
  const [readerExpanded, setReaderExpanded] = useState(false);
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
  const pendingVisit = useRef<{ questionId: string; answerId?: string } | null>(
    null,
  );
  const level = depth < 0.65 ? 0 : depth < 1.65 ? 1 : 2;
  const questions = useMemo(
    () =>
      (data?.questions ?? []).map((question) => ({
        ...question,
        answers: question.answers.map((answer) => details[answer.id] ?? answer),
      })),
    [data, details],
  );
  const selectedQuestion =
    questions.find((question) => question.id === selectedQuestionId) ??
    questions[0];
  const selectedAnswer =
    selectedQuestion?.answers.find(
      (answer) => answer.id === selectedAnswerId,
    ) ?? selectedQuestion?.answers[0];
  const totalAnswers = questions.reduce(
    (total, question) => total + question.answers.length,
    0,
  );
  const isPublic = data?.source !== "zhihu-search";
  const activeSavedId = level === 2 ? selectedAnswer?.id : selectedQuestion?.id;
  const isSaved = collection.some(
    (item) =>
      item.id === activeSavedId &&
      item.type === (level === 2 ? "answer" : "question"),
  );

  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(
    () =>
      registerObservatoryEntry((next) => {
        pendingVisit.current = null;
        setEntry(next);
        setQuery(next.query);
        setSearchText(next.query);
        setDrawer(null);
        setDepth(0);
        setRetry((value) => value + 1);
      }),
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setDepth(0);
    setSelectedParagraph(null);
    setData(null);
    setDetails({});
    fetch(`/api/explore?q=${encodeURIComponent(query)}`, {
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
      })
      .then((result) => {
        setData(result);
        const pending = pendingVisit.current;
        const destination = pending
          ? result.questions.find(
              (question) => question.id === pending.questionId,
            )
          : undefined;
        const validDestination =
          destination &&
          (!pending?.answerId ||
            destination.answers.some(
              (answer) => answer.id === pending.answerId,
            ));
        const selected = validDestination ? destination : result.questions[0];
        setSelectedQuestionId(selected?.id ?? null);
        setSelectedAnswerId(
          validDestination
            ? (pending?.answerId ?? selected?.answers[0]?.id ?? null)
            : (selected?.answers[0]?.id ?? null),
        );
        if (pending) {
          setDepth(validDestination ? (pending.answerId ? 2 : 1) : 0);
          if (!validDestination)
            notify(
              "这条收藏或足迹暂未出现在最新结果中，可从行囊中的来源链接继续阅读。",
            );
          pendingVisit.current = null;
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : "连接中断，请稍后重试",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, retry]);

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
      .then((answer) =>
        setDetails((previous) => ({
          ...previous,
          [selectedAnswer.id]: answer,
        })),
      )
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
      data?.query !== query ||
      level === 0 ||
      !selectedQuestion ||
      (level === 2 && !selectedAnswer)
    )
      return;
    const item: JourneyStop = {
      id: crypto.randomUUID(),
      title: level === 2 ? selectedAnswer!.title : selectedQuestion.title,
      type: level === 2 ? "answer" : "question",
      questionId: selectedQuestion.id,
      answerId: level === 2 ? selectedAnswer?.id : undefined,
      query,
      visitedAt: new Date().toISOString(),
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
    notify,
  ]);

  function chooseQuestion(id: string) {
    const question = questions.find((item) => item.id === id);
    setSelectedQuestionId(id);
    setSelectedAnswerId(question?.answers[0]?.id ?? null);
    setSelectedParagraph(null);
  }
  function chooseAnswer(id: string) {
    setSelectedAnswerId(id);
    setSelectedParagraph(null);
  }
  function search(event: FormEvent) {
    event.preventDefault();
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
          ? selectedAnswer?.paragraphs[selectedParagraph]
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
    setDrawer(null);
    setSearchText(item.query);
    setEntry((previous) => ({ ...previous, query: item.query }));
    const url = new URL(window.location.href);
    url.searchParams.delete("topic");
    if (item.query) url.searchParams.set("q", item.query);
    else url.searchParams.delete("q");
    window.history.replaceState({}, "", url);
    const destination = questions.find(
      (question) => question.id === item.questionId,
    );
    if (
      query === item.query &&
      destination &&
      (!item.answerId ||
        destination.answers.some((answer) => answer.id === item.answerId))
    ) {
      chooseQuestion(item.questionId);
      if (item.answerId) setSelectedAnswerId(item.answerId);
      setDepth(item.answerId ? 2 : 1);
    } else {
      pendingVisit.current = item;
      setSearchText(item.query);
      setQuery(item.query);
      if (query === item.query) setRetry((value) => value + 1);
    }
  }
  function exportNotes() {
    downloadMarkdown(
      exportNotebook(collection, reflections, journey),
      `Wanderwise-旅行手记-${new Date().toISOString().slice(0, 10)}.md`,
    );
    notify("旅行手记已导出");
  }
  function returnHome() {
    if (!returnToObservatory(entry, { collection, reflections, journey }))
      setDrawer("return");
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
      const editing = (event.target as HTMLElement).closest(
        'input, textarea, select, [contenteditable="true"]',
      );
      if (event.key === "Escape") {
        if (reflectionTarget) setReflectionTarget(null);
        else if (drawer) setDrawer(null);
        else if (readerExpanded && level === 2) setReaderExpanded(false);
        else if (level > 0) setDepth(level - 1);
        else setFlightMode(false);
        return;
      }
      if (
        editing ||
        drawer ||
        reflectionTarget ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      if (event.key.toLowerCase() === "e") toggleSave();
      if (event.key.toLowerCase() === "r") openReflection();
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "?") setDrawer("help");
      if (event.key.toLowerCase() === "f") setFlightMode((value) => !value);
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });

  return (
    <main
      className={`app depth-${level} ${drawer || reflectionTarget ? "has-modal" : ""}`}
    >
      <div
        className="universe"
        aria-label="交互式三维知识宇宙"
        {...(drawer || reflectionTarget ? { inert: "" } : {})}
      >
        <GalaxyScene
          questions={questions}
          selectedQuestionId={selectedQuestion?.id ?? null}
          selectedAnswerId={selectedAnswer?.id ?? null}
          depth={depth}
          onDepthChange={(value) =>
            setDepth(
              Math.max(
                0,
                Math.min(selectedAnswer ? 2 : selectedQuestion ? 1 : 0, value),
              ),
            )
          }
          onSelectQuestion={chooseQuestion}
          onSelectAnswer={chooseAnswer}
          flightMode={flightMode && !drawer && !reflectionTarget}
          reducedMotion={reducedMotion}
          resetToken={resetToken}
          relevanceLabel={query ? "相关" : "亮度"}
        />
      </div>
      <div className="universe-vignette" />
      <div
        className="interface"
        {...(drawer || reflectionTarget ? { inert: "" } : {})}
      >
        <header className="topbar">
          <button
            className="brand"
            onClick={() => {
              setDepth(0);
              setResetToken((value) => value + 1);
            }}
            aria-label="Wanderwise 返回问题星海"
          >
            <span className="brand-symbol">
              <Sparkles size={28} strokeWidth={1.35} />
            </span>
            <span>
              Wanderwise<span className="brand-cn">漫知</span>
            </span>
          </button>
          <nav className="main-nav" aria-label="主导航">
            <button
              className="nav-link selected"
              aria-label="星空探索"
              onClick={() => setDrawer(null)}
            >
              <Orbit size={17} />
              <span>星空探索</span>
            </button>
            <button
              className="nav-link"
              aria-label="知识行囊"
              onClick={() => setDrawer("collection")}
            >
              <Backpack size={17} />
              <span>知识行囊</span>
              {collection.length > 0 && (
                <span className="nav-count">{collection.length}</span>
              )}
            </button>
            <button
              className="nav-link"
              aria-label="探索足迹"
              onClick={() => setDrawer("journey")}
            >
              <Footprints size={17} />
              <span>探索足迹</span>
            </button>
          </nav>
          <button
            className="home-link"
            aria-label="返回占星台"
            onClick={returnHome}
          >
            <Telescope size={17} />
            <span>返回占星台</span>
            <ArrowUpRight size={14} />
          </button>
        </header>

        <section className="intro">
          <div className="eyebrow">
            <span className="status-dot" /> A UNIVERSE OF POSSIBILITIES
          </div>
          <h1>
            {level === 0 ? (
              <>
                每一个问题，
                <br />
                都是一场<span>星际旅行。</span>
              </>
            ) : level === 1 ? (
              <>
                靠近一个问题，
                <br />
                遇见<span>不同的光。</span>
              </>
            ) : (
              <>
                停驻一颗恒星，
                <br />
                让思考<span>慢慢发生。</span>
              </>
            )}
          </h1>
          <p>
            {level === 0
              ? "循着好奇心，发现知识之间意想不到的连接。"
              : level === 1
                ? "每一种真实的声音，都照亮世界的另一面。"
                : "读一段文字，带走一束属于自己的灵感。"}
          </p>
          <div className="universe-stats">
            <span>
              <strong>{number(questions.length)}</strong>
              {isPublic ? "知识主题" : "相关问题"}
            </span>
            <i />
            <span>
              <strong>{number(totalAnswers)}</strong>观点坐标
            </span>
            <i />
            <span className="source-mark">
              知<span>内容源自知乎</span>
            </span>
          </div>
        </section>

        <form className="search-box" onSubmit={search} role="search">
          <Search size={18} />
          <input
            ref={searchRef}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="带着一个问题，重新出发…"
            aria-label="探索问题或话题"
            maxLength={160}
          />
          <button type="submit" className="search-submit" aria-label="开始探索">
            {loading ? (
              <LoaderCircle className="spinning" size={17} />
            ) : (
              <ArrowRight size={18} />
            )}
          </button>
          <kbd>/</kbd>
        </form>

        <div className="journey-location">
          <span className="eyebrow">本次探索</span>
          <span>{query || "从好奇出发，自由漫游"}</span>
          {query && (
            <button
              onClick={discover}
              title="回到自由漫游"
              aria-label="回到自由漫游"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {loading && (
          <div className="center-message loading-message" role="status">
            <span className="loading-orbit">
              <Orbit size={34} />
            </span>
            <h2>正在点亮你的知识宇宙</h2>
            <p>连接真实的内容，寻找相遇的坐标</p>
          </div>
        )}
        {!loading && (error || !questions.length) && (
          <div className="center-message empty-universe" role="status">
            <Telescope size={36} />
            <h2>
              {error ? "暂时没能抵达这片星海" : "这个方向，还没有发现星光"}
            </h2>
            <p>
              {error ||
                (isPublic
                  ? "当前在知乎公开知识中检索。试试更短的话题，或回到自由漫游。"
                  : "试试更简短的关键词，寻找新的连接。")}
            </p>
            <div className="button-row">
              <button
                className="primary-button"
                onClick={
                  error ? () => setRetry((value) => value + 1) : discover
                }
              >
                {error ? <RefreshCw size={16} /> : <Compass size={16} />}
                {error ? "重新连接" : "自由漫游"}
              </button>
              {error && (
                <button className="text-button" onClick={discover}>
                  回到探索起点
                </button>
              )}
            </div>
          </div>
        )}

        {!loading && selectedQuestion && level < 2 && (
          <aside
            className="discovery-panel glass-panel"
            key={`${level}-${selectedQuestion.id}`}
            aria-label={level === 0 ? "当前知识主题" : "当前问题的观点"}
          >
            <div className="panel-overline">
              <span>
                <span className="tiny-star">✦</span>
                {level === 0 ? "此刻，与你产生引力" : "星系中的声音"}
              </span>
              <span className="mono">
                {number(questions.indexOf(selectedQuestion) + 1)} /{" "}
                {number(questions.length)}
              </span>
            </div>
            <div className="topic-tags">
              {selectedQuestion.keywords.slice(0, 2).map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
            <h2>{selectedQuestion.title}</h2>
            <p className="topic-description">
              {selectedQuestion.excerpt ||
                "选择这颗星，走近原文中的观点与思考。"}
            </p>
            <div className="relevance">
              <span>
                <span
                  style={{ backgroundColor: selectedQuestion.color }}
                  className="status-dot"
                />
                {query ? "语义相关度" : "初始星光亮度"}
              </span>
              <strong>
                {Math.round(selectedQuestion.relevance * 100)}
                <small>%</small>
              </strong>
            </div>
            <div className="relevance-track">
              <span
                style={{
                  width: `${selectedQuestion.relevance * 100}%`,
                  backgroundColor: selectedQuestion.color,
                }}
              />
            </div>
            {level === 0 ? (
              <>
                <div className="panel-meta">
                  <Orbit size={14} />
                  <span>{selectedQuestion.answers.length} 个已收录观点</span>
                  <span>·</span>
                  <span>等待你的靠近</span>
                </div>
                <button
                  className="primary-button enter-button"
                  onClick={() => setDepth(1)}
                >
                  进入这片星系
                  <ArrowUpRight size={17} />
                </button>
              </>
            ) : (
              <>
                <div className="answer-list">
                  {!selectedQuestion.answers.length && (
                    <p className="empty-answer">
                      暂未收录这个问题的回答。
                      {selectedQuestion.url && (
                        <a
                          href={selectedQuestion.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          前往知乎阅读
                          <ArrowUpRight size={12} />
                        </a>
                      )}
                    </p>
                  )}
                  {selectedQuestion.answers.map((answer, index) => (
                    <button
                      key={answer.id}
                      className={`answer-choice ${answer.id === selectedAnswer?.id ? "selected" : ""}`}
                      onClick={() => chooseAnswer(answer.id)}
                    >
                      <span className="answer-avatar">
                        {answer.author.slice(0, 1)}
                      </span>
                      <span>
                        <strong>{answer.author}</strong>
                        <small>{answer.excerpt || answer.title}</small>
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                </div>
                <button
                  className="primary-button enter-button"
                  disabled={!selectedAnswer}
                  onClick={() => setDepth(2)}
                >
                  走近这束光 · 阅读
                  <ArrowUpRight size={17} />
                </button>
                <div className="panel-actions">
                  <button onClick={toggleSave}>
                    {isSaved ? <Check size={15} /> : <Backpack size={15} />}
                    {isSaved ? "已收入行囊" : "收入行囊"}
                    <kbd>E</kbd>
                  </button>
                  <button onClick={openReflection}>
                    <PenLine size={15} />
                    留下思考<kbd>R</kbd>
                  </button>
                </div>
              </>
            )}
          </aside>
        )}

        {!loading && selectedAnswer && level === 2 && (
          <aside
            className={`article-panel glass-panel ${readerExpanded ? "expanded" : ""}`}
            aria-label="文章阅读"
          >
            <div className="article-toolbar">
              <button className="text-button" onClick={() => setDepth(1)}>
                <ArrowLeft size={15} />
                返回观点星系
              </button>
              <button
                className="text-button"
                onClick={() => setReaderExpanded((value) => !value)}
                aria-label={readerExpanded ? "收起阅读区域" : "展开阅读区域"}
              >
                {readerExpanded ? <Minimize size={14} /> : <Expand size={14} />}
                {readerExpanded ? "收起阅读" : "展开阅读"}
              </button>
            </div>
            <div className="article-scroll" key={selectedAnswer.id}>
              <div className="eyebrow">A MOMENT TO THINK</div>
              <h2>{selectedAnswer.title}</h2>
              <div className="article-author">
                <span className="answer-avatar">
                  {selectedAnswer.author.slice(0, 1)}
                </span>
                <span>
                  <strong>{selectedAnswer.author}</strong>
                  <small>
                    知乎 ·{" "}
                    {selectedAnswer.workId
                      ? "公开知识 · 正文节选"
                      : selectedAnswer.isExcerpt
                        ? "搜索摘要"
                        : "原文内容"}
                  </small>
                </span>
                {selectedAnswer.votes !== undefined && (
                  <span className="votes">{selectedAnswer.votes} 赞同</span>
                )}
              </div>
              {selectedAnswer.isExcerpt && (
                <div className="excerpt-notice">
                  <Info size={15} />
                  <span>
                    {selectedAnswer.workId
                      ? "知乎公开接口提供的正文节选，内容可能在段落中截断。"
                      : "当前内容为搜索摘要，可前往知乎阅读完整内容。"}
                  </span>
                </div>
              )}
              <p className="reading-hint">
                <Quote size={13} />
                点选一个段落，按 R 留下你的思考
              </p>
              {detailLoading && (
                <div className="inline-status">
                  <LoaderCircle size={17} className="spinning" />
                  正在读取正文…
                </div>
              )}
              {detailError && (
                <div className="excerpt-notice">
                  {detailError}
                  <button
                    className="text-button"
                    onClick={() => setDetailRetry((value) => value + 1)}
                  >
                    重试
                  </button>
                </div>
              )}
              <div className="article-body">
                {selectedAnswer.paragraphs.length ? (
                  selectedAnswer.paragraphs.map((paragraph, index) => (
                    <button
                      className={`article-paragraph ${selectedParagraph === index ? "selected" : ""}`}
                      key={`${selectedAnswer.id}-${index}`}
                      onClick={() =>
                        setSelectedParagraph(
                          selectedParagraph === index ? null : index,
                        )
                      }
                      aria-label={`选中第 ${index + 1} 段`}
                      aria-pressed={selectedParagraph === index}
                    >
                      <span className="paragraph-number">
                        {number(index + 1)}
                      </span>
                      {paragraph}
                    </button>
                  ))
                ) : (
                  <p>此内容暂未提供正文，请访问来源页面阅读。</p>
                )}
              </div>
              {selectedAnswer.url && (
                <a
                  className="original-link"
                  href={selectedAnswer.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {selectedAnswer.workId
                    ? "查看知乎官方内容来源"
                    : "阅读知乎原文"}
                  <ArrowUpRight size={15} />
                </a>
              )}
              <div className="article-end">
                ✦<span>每一次停留，都让你的宇宙更辽阔。</span>
              </div>
            </div>
            <div className="article-footer">
              <button
                className={`primary-button ${isSaved ? "saved" : ""}`}
                onClick={toggleSave}
              >
                {isSaved ? <Check size={16} /> : <Backpack size={16} />}
                {isSaved ? "已收入行囊" : "收藏这束光"}
                <kbd>E</kbd>
              </button>
              <button className="secondary-button" onClick={openReflection}>
                <PenLine size={16} />
                思考<kbd>R</kbd>
              </button>
            </div>
          </aside>
        )}

        <div className="left-bottom">
          <button
            className={`map-toggle ${showMap ? "selected" : ""}`}
            onClick={() => setShowMap((value) => !value)}
          >
            <Map size={16} />
            <span>星海图谱</span>
            <ChevronRight size={13} />
          </button>
          {showMap && (
            <div className="minimap glass-panel">
              <div className="minimap-title">
                <span>选择一个坐标</span>
                <span>{questions.length} 个主题</span>
              </div>
              {questions.map((question, index) => (
                <button
                  key={question.id}
                  onClick={() => {
                    chooseQuestion(question.id);
                    setDepth(0);
                  }}
                  className={
                    question.id === selectedQuestion?.id ? "selected" : ""
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
          <div className="legend">
            <span className="legend-glow" />
            <span>
              {query
                ? "星光越亮，与你的问题越相关"
                : "选择一束星光，发现新的方向"}
            </span>
          </div>
          <div className="source-status" title={data?.notice}>
            <span className="status-dot" />
            <span>
              {loading
                ? "正在建立连接"
                : data?.source === "zhihu-search"
                  ? "知乎搜索 · 实时内容"
                  : data?.source === "zhihu-cache"
                    ? "知乎公开知识 · 本地快照"
                    : "知乎公开知识 · 发现模式"}
            </span>
            <button onClick={() => setDrawer("help")} aria-label="内容来源说明">
              <Info size={12} />
            </button>
          </div>
        </div>

        <div className="bottom-center">
          <div className="scroll-prompt">
            <Mouse size={15} />
            <span>
              {flightMode
                ? "W A S D 移动 · 拖动转向 · F 退出飞行"
                : level === 0
                  ? "滚动鼠标，向一个问题靠近"
                  : level === 1
                    ? "继续滚动，让一个观点清晰起来"
                    : "向外滚动，带着思考继续漫游"}
            </span>
            <ArrowDown size={13} />
          </div>
          <nav className="depth-navigation" aria-label="探索纵深">
            {depthNames.map((name, index) => (
              <button
                key={name}
                className={level === index ? "active" : ""}
                onClick={() => setDepth(index)}
                disabled={
                  (index > 0 && !selectedQuestion) ||
                  (index === 2 && !selectedAnswer)
                }
              >
                <span className="depth-dot">
                  {index === 0 ? (
                    <Orbit size={17} />
                  ) : index === 1 ? (
                    <Sparkles size={17} />
                  ) : (
                    <span>✦</span>
                  )}
                </span>
                {name}
                {index < 2 && (
                  <ChevronRight className="depth-chevron" size={12} />
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="scene-tools">
          <IconButton
            label={flightMode ? "退出自由飞行 (F)" : "自由飞行 (F)"}
            active={flightMode}
            onClick={() => setFlightMode((value) => !value)}
          >
            <Navigation size={18} />
          </IconButton>
          <IconButton
            label="重置视角"
            onClick={() => {
              setResetToken((value) => value + 1);
              setDepth(0);
            }}
          >
            <RefreshCw size={17} />
          </IconButton>
          <IconButton
            label={fullscreen ? "退出全屏" : "进入全屏"}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize size={17} /> : <Expand size={17} />}
          </IconButton>
          <span className="tool-separator" />
          <IconButton label="探索指南" onClick={() => setDrawer("help")}>
            <span className="help-icon">?</span>
          </IconButton>
        </div>
        <div className="depth-scale">
          <span>远</span>
          <input
            type="range"
            aria-label="探索深度"
            min="0"
            max={selectedAnswer ? 2 : selectedQuestion ? 1 : 0}
            step="0.01"
            value={depth}
            onChange={(event) => setDepth(Number(event.target.value))}
          />
          <span>近</span>
        </div>
        <footer className="app-footer">
          <span>WANDER WITH CURIOSITY.</span>
          <span>
            让知识相遇，让思考生长 <span className="footer-star">✦</span>
          </span>
          <span>EXPLORE AT YOUR OWN PACE</span>
        </footer>
      </div>

      {drawer && (
        <Modal
          title={
            drawer === "collection"
              ? "知识行囊"
              : drawer === "journey"
                ? "探索足迹"
                : drawer === "return"
                  ? "带着星光，回到出发的地方"
                  : "你的星际旅行指南"
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
                          {item.title}
                          <ArrowUpRight size={16} />
                        </button>
                        <p>{item.excerpt}</p>
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
                      {item.quote && <blockquote>{item.quote}</blockquote>}
                      <p className="reflection-content">{item.text}</p>
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
              <p className="modal-subtitle">你走过的方向，会连成自己的星座。</p>
              <div className="journey-summary">
                <strong>{journey.length}</strong>
                <span>次停留</span>
                <i />
                <strong>{reflections.length}</strong>
                <span>束思考</span>
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
                        <strong>{stop.title}</strong>
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
                <span>记录最近 300 次停留</span>
                <button className="secondary-button" onClick={exportNotes}>
                  <Download size={15} />
                  导出手记
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
                {["问题汇成星海", "回答形成星系", "文章成为恒星"].map(
                  (text, index) => (
                    <div key={text}>
                      <span>0{index + 1}</span>
                      <strong>{text}</strong>
                      <p>
                        {
                          [
                            "从远处看见相关主题，星光亮度随语义相关度变化。",
                            "走近一个问题，选择作者的观点继续探索。",
                            "阅读段落、收集文章，为具体的文字留下思考。",
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
                  ["点击星体 · 点击进入", "选择并飞向内容"],
                  ["F · W A S D", "切换飞行 · 移动"],
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
                    公开知识作品以一个主题、一篇原文呈现。输入问题后，相关度由结果排序与关键词匹配计算；自由漫游时的初始亮度按内容顺序分配。收藏和思考仅保存在本机浏览器。
                  </p>
                </div>
              </div>
            </>
          )}
          {drawer === "return" && (
            <>
              <div className="return-illustration">
                <Telescope size={52} strokeWidth={1} />
                <Sparkles size={24} />
              </div>
              <p className="return-copy">
                这次旅行，你带回了 <strong>{collection.length}</strong>{" "}
                束星光，留下了 <strong>{reflections.length}</strong> 段思考。
              </p>
              <p className="modal-subtitle">
                当前为独立星空探索空间。接入占星台后，你可以从这里回到自己的小屋；此刻也可以导出手记，把收获带走。
              </p>
              <div className="button-row">
                <button className="primary-button" onClick={exportNotes}>
                  <Download size={16} />
                  带走旅行手记
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setDrawer(null)}
                >
                  继续漫游
                  <ArrowRight size={16} />
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
      {reflectionTarget && (
        <Modal
          title="让这一刻的思考，留下来"
          onClose={() => setReflectionTarget(null)}
          className="reflection-modal"
        >
          <p className="reflection-about">关于 · {reflectionTarget.title}</p>
          {reflectionTarget.quote && (
            <blockquote className="reflection-quote">
              {reflectionTarget.quote}
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
