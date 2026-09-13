import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, LoaderCircle, Pause, Play, Volume2, VolumeX } from "lucide-react";
import "./background-music.css";

// v1 saved a 28% default without recording whether playback was enabled.
// Start the new policy at full volume, then preserve explicit v2 choices.
const preferenceKey = "wanderwise.music.v2";
type Preferences = { enabled: boolean; volume: number; muted: boolean };

function loadPreferences(): Preferences {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(preferenceKey) || "null");
    if (saved && typeof saved === "object" && "volume" in saved && "muted" in saved && "enabled" in saved
      && typeof saved.volume === "number" && Number.isFinite(saved.volume)
      && saved.volume >= 0 && saved.volume <= 1 && typeof saved.muted === "boolean"
      && typeof saved.enabled === "boolean") {
      return { enabled: saved.enabled, volume: saved.volume, muted: saved.muted };
    }
  } catch { /* Unavailable storage must not prevent playback. */ }
  return { enabled: true, volume: 1, muted: false };
}

export default function BackgroundMusic() {
  const [preferences, setPreferences] = useState(loadPreferences);
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const preferencesRef = useRef(preferences);
  const wantsPlayback = useRef(preferences.enabled);
  const mounted = useRef(false);
  const playRequest = useRef(0);
  const pendingPlayback = useRef(false);
  const waitingForGesture = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [awaitingGesture, setAwaitingGesture] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const panelId = useId();
  preferencesRef.current = preferences;

  const playbackFailed = useCallback(() => {
    if (!mounted.current || !wantsPlayback.current) return;
    playRequest.current += 1;
    pendingPlayback.current = false;
    waitingForGesture.current = false;
    setAwaitingGesture(false);
    setLoading(false);
    setPlaying(false);
    setError("音乐暂时无法播放，可关闭后重新开启重试。");
  }, []);

  const startPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !mounted.current || !wantsPlayback.current || pendingPlayback.current) return;
    const request = ++playRequest.current;
    pendingPlayback.current = true;
    waitingForGesture.current = false;
    setAwaitingGesture(false);
    setLoading(true);
    setError("");
    if (audio.error) audio.load();
    // Called on mount and directly within trusted gestures after autoplay is blocked.
    void audio.play().then(() => {
      if (!mounted.current || !wantsPlayback.current) { audio.pause(); return; }
      if (request !== playRequest.current) return;
      pendingPlayback.current = false;
      setPlaying(!audio.paused);
      setLoading(false);
    }).catch((reason: unknown) => {
      if (!mounted.current || request !== playRequest.current || !wantsPlayback.current) return;
      pendingPlayback.current = false;
      setPlaying(false);
      setLoading(false);
      if (reason instanceof DOMException && reason.name === "NotAllowedError") {
        // Enabled is an intent; do not claim that blocked audio is already playing.
        waitingForGesture.current = true;
        setAwaitingGesture(true);
        return;
      }
      playbackFailed();
    });
  }, [playbackFailed]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = preferences.volume;
      audioRef.current.muted = preferences.muted;
    }
    try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); } catch { /* Optional persistence. */ }
  }, [preferences]);

  useEffect(() => {
    mounted.current = true;
    wantsPlayback.current = preferencesRef.current.enabled;
    startPlayback();
    const resumeFromGesture = (event: Event) => {
      if (!event.isTrusted || !wantsPlayback.current || !waitingForGesture.current) return;
      // The toggle handles its own gesture, so closing blocked audio never starts it first.
      if (event.target instanceof Element && event.target.closest(".music-toggle")
        && containerRef.current?.contains(event.target)) return;
      if (event instanceof KeyboardEvent && (event.repeat || event.ctrlKey || event.metaKey || event.altKey)) return;
      startPlayback();
    };
    document.addEventListener("pointerdown", resumeFromGesture);
    // Touch/pen browsers may grant activation only on release.
    document.addEventListener("pointerup", resumeFromGesture);
    document.addEventListener("keydown", resumeFromGesture);
    const audio = audioRef.current;
    return () => {
      mounted.current = false;
      wantsPlayback.current = false;
      waitingForGesture.current = false;
      pendingPlayback.current = false;
      playRequest.current += 1;
      document.removeEventListener("pointerdown", resumeFromGesture);
      document.removeEventListener("pointerup", resumeFromGesture);
      document.removeEventListener("keydown", resumeFromGesture);
      audio?.pause();
    };
  }, [startPlayback]);

  useEffect(() => {
    if (!expanded) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setExpanded(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [expanded]);

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (wantsPlayback.current) {
      wantsPlayback.current = false;
      waitingForGesture.current = false;
      pendingPlayback.current = false;
      playRequest.current += 1;
      setPreferences((value) => ({ ...value, enabled: false }));
      audio.pause();
      setAwaitingGesture(false);
      setLoading(false);
      setPlaying(false);
      setError("");
      return;
    }
    wantsPlayback.current = true;
    setPreferences((value) => ({ ...value, enabled: true }));
    startPlayback();
  }

  return (
    <div
      ref={containerRef}
      className={`background-music ${playing ? "is-playing" : ""}`}
      data-playback={error ? "error" : playing ? "playing" : awaitingGesture ? "awaiting-gesture" : loading ? "loading" : "paused"}
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
          if (!mounted.current || !wantsPlayback.current) { audioRef.current?.pause(); return; }
          waitingForGesture.current = false;
          setAwaitingGesture(false);
          setPlaying(true);
          setLoading(false);
        }}
        onPause={() => {
          if (mounted.current && audioRef.current?.paused) {
            setPlaying(false);
            setLoading(false);
          }
        }}
        onWaiting={() => { if (mounted.current && wantsPlayback.current) setLoading(true); }}
        onError={playbackFailed}
      >
        <source src="/audio/day-one.mp3" type="audio/mpeg" />
        <source src="/audio/day-one.flac" type="audio/flac" />
      </audio>
      <button
        type="button"
        className="music-toggle"
        aria-label={preferences.enabled ? "关闭背景音乐" : "开启背景音乐"}
        aria-pressed={preferences.enabled}
        title={error ? error : awaitingGesture ? "音乐已开启 · 与页面互动后播放" : `${preferences.enabled ? "关闭" : "开启"} · Day One`}
        onClick={togglePlayback}
      >
        {loading ? <LoaderCircle size={15} className="spinning" /> : playing ? <Pause size={15} /> : awaitingGesture ? <Volume2 size={15} /> : <Play size={15} />}
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
              onChange={(event) => setPreferences((value) => ({ ...value, volume: Number(event.target.value) / 100, muted: false }))}
            />
            <output>{Math.round(preferences.volume * 100)}%</output>
          </div>
          {awaitingGesture && <p className="music-status" role="status">与页面互动后，音乐将自动开始。</p>}
          {error && <p className="music-error" role="status">{error}</p>}
        </div>
      )}
    </div>
  );
}
