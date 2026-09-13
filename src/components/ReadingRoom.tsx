import { useEffect, useRef } from "react";
import { ArrowUpRight, Backpack, Check, PenLine, X } from "lucide-react";
import type { Answer } from "../types";
import RichText from "./RichText";

interface Props {
  answer: Answer;
  selectedParagraph: number | null;
  saved: boolean;
  onClose: () => void;
  onSave: () => void;
  onReflect: () => void;
  onSelectParagraph: (index: number, quote: string) => void;
  dimmed?: boolean;
}

export default function ReadingRoom({
  answer,
  selectedParagraph,
  saved,
  onClose,
  onSave,
  onReflect,
  onSelectParagraph,
  dimmed,
}: Props) {
  const room = useRef<HTMLDivElement>(null);
  const initialParagraph = useRef(selectedParagraph);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    room.current?.querySelector<HTMLButtonElement>(".reader-close")?.focus();
    if (initialParagraph.current !== null)
      room.current
        ?.querySelector(`[data-paragraph="${initialParagraph.current}"]`)
        ?.scrollIntoView({ block: "center", behavior: "instant" });
    return () => previous?.focus();
  }, []);
  function trap(event: React.KeyboardEvent) {
    if (event.key !== "Tab" || dimmed) return;
    const elements = Array.from(
      room.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), a[href]",
      ) ?? [],
    );
    if (event.shiftKey && document.activeElement === elements[0]) {
      event.preventDefault();
      elements.at(-1)?.focus();
    }
    if (!event.shiftKey && document.activeElement === elements.at(-1)) {
      event.preventDefault();
      elements[0]?.focus();
    }
  }
  return (
    <div
      className={`reading-backdrop ${dimmed ? "reading-dimmed" : ""}`}
      onClick={onClose}
      {...(dimmed ? { inert: "" } : {})}
    >
      <section
        ref={room}
        className="reading-room"
        role="dialog"
        aria-modal="true"
        aria-label="原文阅览"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={trap}
      >
        <div className="reader-frame" aria-hidden="true" />
        <header className="reader-topline">
          <span>
            <i />
            原文阅览
          </span>
          <div>
            <span className="reader-source-badge">
              知乎 ·{" "}
              {answer.workId
                ? "正文节选"
                : answer.isExcerpt
                  ? "搜索摘要"
                  : "原文"}
            </span>
            <button
              className="icon-button reader-close"
              aria-label="关闭原文阅览"
              onClick={onClose}
            >
              <X size={19} />
            </button>
          </div>
        </header>
        <div className="reader-scroll">
          <div className="reader-article-heading">
            <span className="reader-glyph">✦</span>
            <h1><RichText text={answer.title} inline /></h1>
            <div className="reader-byline">
              <span className="answer-avatar">{answer.author.slice(0, 1)}</span>
              <strong>{answer.author}</strong>
              {answer.votes !== undefined && <span>{answer.votes} 赞同</span>}
            </div>
          </div>
          {answer.isExcerpt && (
            <p className="reader-content-note">
              {answer.workId
                ? "以下为知乎官方接口提供的正文节选，可能在段落中截断。"
                : "以下为知乎搜索返回的原文摘要。完整回答可通过“前往知乎原文”阅读。"}
            </p>
          )}
          <article className="reader-prose">
            {answer.paragraphs.length ? (
              answer.paragraphs.map((paragraph, index) => (
                <div
                  key={`${answer.id}-${index}`}
                  className={`reader-paragraph ${selectedParagraph === index ? "selected" : ""}`}
                  data-paragraph={index}
                  onClick={() => onSelectParagraph(index, paragraph)}
                >
                  <button
                    className="reader-paragraph-index reader-paragraph-select"
                    aria-label={`选中第 ${index + 1} 段`}
                    aria-pressed={selectedParagraph === index}
                    onClick={event => { event.stopPropagation(); onSelectParagraph(index, paragraph); }}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </button>
                  <RichText text={paragraph} />
                </div>
              ))
            ) : (
              <p className="reader-content-note">
                接口暂未提供可阅读内容，请访问知乎来源。
              </p>
            )}
          </article>
          {answer.url && (
            <a
              className="reader-original"
              href={answer.url}
              target="_blank"
              rel="noreferrer"
            >
              {answer.workId ? "查看知乎官方内容来源" : "前往知乎原文"}
              <ArrowUpRight size={16} />
            </a>
          )}
          <div className="reader-end" aria-hidden="true">
            <span />✦<span />
          </div>
        </div>
        <footer className="reader-actions">
          <span>
            {selectedParagraph !== null
              ? `已选中第 ${selectedParagraph + 1} 段`
              : "点击段落，留下思考"}
          </span>
          <div>
            <button className="secondary-button" onClick={onSave}>
              {saved ? <Check size={15} /> : <Backpack size={15} />}
              {saved ? "已收藏" : "收藏文章"}
              <kbd>E</kbd>
            </button>
            <button className="primary-button" onClick={onReflect}>
              <PenLine size={15} />
              写下思考<kbd>R</kbd>
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
