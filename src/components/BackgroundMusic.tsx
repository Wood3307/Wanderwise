import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, LoaderCircle, Pause, Play, Volume2, VolumeX } from "lucide-react";
import "./background-music.css";

const preferenceKey = "wanderwise.music.v1";
type Preferences = { volume: number; muted: boolean };

function loadPreferences(): Preferences {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(preferenceKey) || "null");
    if (saved && typeof saved === "object" && "volume" in saved && "muted" in saved
      && typeof saved.volume === "number" && Number.isFinite(saved.volume)
      && saved.volume >= 0 && saved.volume <= 1 && typeof saved.muted === "boolean") {
      return { volume: saved.volume, muted: saved.muted };
    }
  } catch { /* Unavailable storage must not prevent playback. */ }
  return { volume: 0.28, muted: false };
}

export default function BackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const wantsPlayback = useRef(false);
  const playRequest = useRef(0);
  const [preferences, setPreferences] = useState(loadPreferences);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const panelId = useId();

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = preferences.volume;
      audioRef.current.muted = preferences.muted;
    }
    try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); } catch { /* Optional persistence. */ }
  }, [preferences]);

  useEffect(() => {
    if (!expanded) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setExpanded(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [expanded]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      wantsPlayback.current = false;
      playRequest.current += 1;
      audio?.pause();
    };
  }, []);

  function playbackFailed() {
    wantsPlayback.current = false;
    setLoading(false);
    setPlaying(false);
    setError("音乐暂时无法播放，请点击播放重试。");
    setExpanded(true);
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    const request = ++playRequest.current;
    if (wantsPlayback.current) {
      wantsPlayback.current = false;
      audio.pause();
      setLoading(false);
      setPlaying(false);
      return;
    }
    wantsPlayback.current = true;
    setLoading(true);
    setError("");
    if (audio.error) audio.load();
    // Keep play() directly inside the user's gesture for browser autoplay rules.
    void audio.play().catch(() => {
      if (request === playRequest.current && wantsPlayback.current) playbackFailed();
    });
  }

  return (
    <div
      ref={containerRef}
      className={`background-music ${playing ? "is-playing" : ""}`}
      onKeyDown={(event) => {
        if (expanded && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setExpanded(false);
          settingsRef.current?.focus();
        }
      }}
    >
      <audio
        ref={audioRef}
        preload="none"
        loop
        aria-label="Day One 背景音乐"
        onPlaying={() => {
          if (!wantsPlayback.current) { audioRef.current?.pause(); return; }
          setPlaying(true);
          setLoading(false);
        }}
        onPause={() => {
          if (audioRef.current?.paused) {
            wantsPlayback.current = false;
            setPlaying(false);
            setLoading(false);
          }
        }}
        onWaiting={() => { if (wantsPlayback.current) setLoading(true); }}
        onError={playbackFailed}
      >
        <source src="/audio/day-one.mp3" type="audio/mpeg" />
        <source src="/audio/day-one.flac" type="audio/flac" />
      </audio>
      <button
        type="button"
        className="music-toggle"
        aria-label={playing || loading ? "暂停背景音乐" : "播放背景音乐"}
        aria-pressed={playing}
        title={`${playing || loading ? "暂停" : "播放"} · Day One`}
        onClick={togglePlayback}
      >
        {loading ? <LoaderCircle size={15} className="spinning" /> : playing ? <Pause size={15} /> : <Play size={15} />}
        <span className="music-glimmer" aria-hidden="true" />
      </button>
      <button
        ref={settingsRef}
        type="button"
        className="music-settings-toggle"
        aria-label="背景音乐设置"
        aria-expanded={expanded}
        aria-controls={panelId}
        title="背景音乐设置"
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronDown size={12} />
      </button>
      {expanded && (
        <div className="music-projection" id={panelId} role="group" aria-label="背景音乐控制">
          <div className="music-track"><span>DAY ONE</span><small>Hans Zimmer</small></div>
          <div className="music-volume-row">
            <button
              type="button"
              className="music-mute"
              aria-label={preferences.muted ? "取消音乐静音" : "音乐静音"}
              aria-pressed={preferences.muted}
              onClick={() => setPreferences((value) => ({ ...value, muted: !value.muted }))}
            >
              {preferences.muted || preferences.volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(preferences.volume * 100)}
              aria-label="背景音乐音量"
              aria-valuetext={`${Math.round(preferences.volume * 100)}%`}
              onChange={(event) => setPreferences({ volume: Number(event.target.value) / 100, muted: false })}
            />
            <output>{Math.round(preferences.volume * 100)}%</output>
          </div>
          {error && <p className="music-error" role="status">{error}</p>}
        </div>
      )}
    </div>
  );
}
