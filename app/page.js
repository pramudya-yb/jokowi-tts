"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ── Config ────────────────────────────────────────────────────────────────
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const JOKOWI_PRESETS = [
  "Saudara-saudara sebangsa dan setanah air...",
  "Ini bukan tentang saya, ini tentang Indonesia.",
  "Kita harus bekerja, bekerja, dan bekerja!",
  "Indonesia Maju! Kita bisa!",
  "Saya ingin membangun Indonesia dari pinggiran.",
  "Jangan biarkan siapapun menghentikan langkah kita.",
  "Rakyat adalah sumber kekuatan kita yang utama.",
  "Infrastruktur adalah fondasi kemajuan bangsa.",
];

const DEFAULT_SETTINGS = {
  pitchShift: 0,
  speed: -5,
  volume: 1.0,
  indexRate: 0.75,
};

const FALLBACK_VOICES = [
  { ShortName: "id-ID-ArdiNeural",  FriendlyName: "Ardi — Pria Indonesia ★ Recommended" },
  { ShortName: "id-ID-GadisNeural", FriendlyName: "Gadis — Wanita Indonesia" },
];

const MAX_CHARS = 2000;

// ── Helpers ───────────────────────────────────────────────────────────────
function formatTime(sec) {
  if (!isFinite(sec) || isNaN(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Component ─────────────────────────────────────────────────────────────
export default function JokowiTTS() {
  // ── Playback state ─────────────────────────────────────────────────
  const [text, setText]             = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused]     = useState(false);
  const [isLoading, setIsLoading]   = useState(false);
  const [serverOnline, setServerOnline] = useState(null);

  // Audio player state
  const [currentAudioUrl, setCurrentAudioUrl] = useState(null);
  const [audioProgress, setAudioProgress]     = useState(0);
  const [audioDuration, setAudioDuration]     = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);

  // ── Settings ───────────────────────────────────────────────────────
  const [pitchShift, setPitchShift] = useState(DEFAULT_SETTINGS.pitchShift);
  const [speed, setSpeed]           = useState(DEFAULT_SETTINGS.speed);
  const [volume, setVolume]         = useState(DEFAULT_SETTINGS.volume);
  const [indexRate, setIndexRate]   = useState(DEFAULT_SETTINGS.indexRate);
  const [edgeVoices, setEdgeVoices] = useState(FALLBACK_VOICES);
  const [selectedVoice, setSelectedVoice] = useState("id-ID-ArdiNeural");
  const [f0Method, setF0Method]     = useState("harvest");

  // ── History & Toast ────────────────────────────────────────────────
  const [history, setHistory] = useState([]);
  const [toast, setToast]     = useState({ show: false, message: "", type: "" });

  // ── Refs ───────────────────────────────────────────────────────────
  const audioRef        = useRef(null);     // <audio> element
  const canvasRef       = useRef(null);     // waveform canvas
  const audioCtxRef     = useRef(null);     // AudioContext
  const analyserRef     = useRef(null);     // AnalyserNode
  const sourceNodeRef   = useRef(null);     // MediaElementSource (created once)
  const animFrameRef    = useRef(null);     // requestAnimationFrame id
  const toastTimerRef   = useRef(null);
  const blobUrlsRef     = useRef([]);
  const isMountedRef    = useRef(true);
  const abortCtrlRef    = useRef(null);

  // ── Toast ──────────────────────────────────────────────────────────
  const showToast = useCallback((message, type = "info") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ show: true, message, type });
    toastTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) setToast({ show: false, message: "", type: "" });
    }, 3500);
  }, []);

  // ── Mount / unmount ────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    try {
      const saved = localStorage.getItem("jokowi-tts-history");
      if (saved) setHistory(JSON.parse(saved));
    } catch { /* ignore */ }

    return () => {
      isMountedRef.current = false;
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
      abortCtrlRef.current?.abort();
      blobUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
    };
  }, []);

  // ── Server health check every 15 s ────────────────────────────────
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`${API_URL}/health`, {
          signal: AbortSignal.timeout(3000),
        });
        if (isMountedRef.current) setServerOnline(res.ok);
      } catch {
        if (isMountedRef.current) setServerOnline(false);
      }
    };
    check();
    const id = setInterval(check, 15_000);
    return () => clearInterval(id);
  }, []);

  // ── Fetch Edge TTS voices once server comes online ─────────────────
  useEffect(() => {
    if (!serverOnline) return;
    fetch(`${API_URL}/voices`)
      .then(r => r.json())
      .then(data => {
        if (isMountedRef.current && data.voices?.length > 0)
          setEdgeVoices(data.voices);
      })
      .catch(() => { /* keep fallback */ });
  }, [serverOnline]);

  // ── Sync volume slider → audio element ────────────────────────────
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // ── Persist history ────────────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem("jokowi-tts-history", JSON.stringify(history)); }
    catch { /* ignore */ }
  }, [history]);

  // ── Waveform: setup Web Audio API (once per audio element) ────────
  const setupAnalyser = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!audioRef.current) return;

    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;

      if (!audioCtxRef.current) {
        audioCtxRef.current = new Ctx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume();

      // MediaElementSource can only be created once per element
      if (!sourceNodeRef.current) {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.75;

        const src = ctx.createMediaElementSource(audioRef.current);
        src.connect(analyser);
        analyser.connect(ctx.destination);

        sourceNodeRef.current = src;
        analyserRef.current   = analyser;
      }
    } catch (e) {
      console.warn("Web Audio setup failed:", e);
    }
  }, []);

  // ── Waveform: draw loop ────────────────────────────────────────────
  const startWaveformDraw = useCallback(() => {
    const analyser = analyserRef.current;
    const canvas   = canvasRef.current;
    if (!analyser || !canvas) return;

    const bufLen  = analyser.frequencyBinCount;
    const data    = new Uint8Array(bufLen);

    const tick = () => {
      if (!isMountedRef.current) return;
      animFrameRef.current = requestAnimationFrame(tick);

      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      if (canvas.width !== W)  canvas.width  = W;
      if (canvas.height !== H) canvas.height = H;

      const c = canvas.getContext("2d");
      analyser.getByteTimeDomainData(data);

      c.clearRect(0, 0, W, H);

      // Subtle horizontal rule
      c.strokeStyle = "rgba(220,38,38,0.12)";
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(0, H / 2);
      c.lineTo(W, H / 2);
      c.stroke();

      // Waveform
      const grad = c.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0,    "rgba(220,38,38,0.1)");
      grad.addColorStop(0.25, "rgba(220,38,38,0.8)");
      grad.addColorStop(0.5,  "rgba(220,38,38,1)");
      grad.addColorStop(0.75, "rgba(220,38,38,0.8)");
      grad.addColorStop(1,    "rgba(220,38,38,0.1)");

      c.lineWidth    = 2.5;
      c.strokeStyle  = grad;
      c.shadowColor  = "rgba(220,38,38,0.45)";
      c.shadowBlur   = 10;
      c.beginPath();

      const slice = W / bufLen;
      let x = 0;
      for (let i = 0; i < bufLen; i++) {
        const v = data[i] / 128.0;                 // 0-2
        const y = H / 2 - (v - 1) * H * 0.45;     // flip so positive = up
        if (i === 0) c.moveTo(x, y);
        else         c.lineTo(x, y);
        x += slice;
      }
      c.lineTo(W, H / 2);
      c.stroke();
      c.shadowBlur = 0;
    };

    tick();
  }, []);

  // ── Waveform: stop + show flat idle line ──────────────────────────
  const stopWaveformDraw = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.offsetWidth || canvas.width;
    const H = canvas.offsetHeight || canvas.height;
    if (canvas.width !== W)  canvas.width  = W;
    if (canvas.height !== H) canvas.height = H;
    const c = canvas.getContext("2d");
    c.clearRect(0, 0, W, H);
    c.strokeStyle = "rgba(220,38,38,0.25)";
    c.lineWidth   = 1.5;
    c.setLineDash([4, 6]);
    c.beginPath();
    c.moveTo(0, H / 2);
    c.lineTo(W, H / 2);
    c.stroke();
    c.setLineDash([]);
  }, []);

  // ── Core: Text → FastAPI → Audio ──────────────────────────────────
  const speak = useCallback(async (textOverride) => {
    const textToSpeak = textOverride ?? text;
    if (!textToSpeak.trim()) {
      showToast("Silakan masukkan teks terlebih dahulu", "error");
      return;
    }
    if (!serverOnline) {
      showToast("Server tidak aktif — jalankan backend terlebih dahulu", "error");
      return;
    }

    abortCtrlRef.current?.abort();
    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsSpeaking(false);
    setIsPaused(false);
    setIsLoading(true);
    setAudioProgress(0);
    setAudioCurrentTime(0);
    setAudioDuration(0);

    try {
      const res = await fetch(`${API_URL}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          text: textToSpeak,
          voice: selectedVoice,
          pitch_shift: pitchShift,
          index_rate: indexRate,
          speed,
          f0_method: f0Method,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Server error ${res.status}`);
      }

      const blob     = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      blobUrlsRef.current.push(audioUrl);

      setCurrentAudioUrl(audioUrl);

      const entry = {
        id:       Date.now(),
        text:     textToSpeak.slice(0, 100),
        fullText: textToSpeak,
        audioUrl,
        time: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
      };
      setHistory(prev => [entry, ...prev.slice(0, 9)]);

      if (audioRef.current && isMountedRef.current) {
        audioRef.current.src    = audioUrl;
        audioRef.current.volume = volume;
        await audioRef.current.play();
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      if (isMountedRef.current) showToast(err.message || "Gagal mensintesis suara", "error");
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [
    text, selectedVoice, pitchShift, indexRate, speed, f0Method,
    volume, serverOnline, showToast,
  ]);

  const stopSpeaking = useCallback(() => {
    abortCtrlRef.current?.abort();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    stopWaveformDraw();
    setIsSpeaking(false);
    setIsPaused(false);
    setIsLoading(false);
    setAudioProgress(0);
    setAudioCurrentTime(0);
  }, [stopWaveformDraw]);

  const togglePause = useCallback(() => {
    if (!audioRef.current) return;
    if (isPaused) {
      audioRef.current.play();
    } else {
      audioRef.current.pause();
    }
  }, [isPaused]);

  // ── History replay ─────────────────────────────────────────────────
  const handleHistoryPlay = useCallback((entry) => {
    setText(entry.fullText);
    if (entry.audioUrl) {
      setCurrentAudioUrl(entry.audioUrl);
      if (audioRef.current) {
        audioRef.current.src    = entry.audioUrl;
        audioRef.current.volume = volume;
        audioRef.current.play();
      }
    } else {
      speak(entry.fullText);
    }
  }, [volume, speak]);

  // ── Download ───────────────────────────────────────────────────────
  const downloadAudio = useCallback((url, label = "jokowi_speech") => {
    if (!url) return;
    const safe = label.slice(0, 40)
      .replace(/[^\w\s]/g, "").trim()
      .replace(/\s+/g, "_") || "jokowi";
    const a = document.createElement("a");
    a.href     = url;
    a.download = `${safe}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast("Audio berhasil diunduh ✓");
  }, [showToast]);

  // ── Seek on progress bar click ─────────────────────────────────────
  const handleSeek = useCallback((e) => {
    if (!audioRef.current || !audioDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = pct * audioDuration;
  }, [audioDuration]);

  const clearHistory  = useCallback(() => { setHistory([]); showToast("Riwayat dihapus"); }, [showToast]);
  const resetSettings = useCallback(() => {
    setPitchShift(DEFAULT_SETTINGS.pitchShift);
    setSpeed(DEFAULT_SETTINGS.speed);
    setVolume(DEFAULT_SETTINGS.volume);
    setIndexRate(DEFAULT_SETTINGS.indexRate);
    showToast("Pengaturan direset ke default Jokowi");
  }, [showToast]);

  // ── Derived ────────────────────────────────────────────────────────
  const charCount  = text.length;
  const charClass  = charCount > MAX_CHARS ? "danger" : charCount > MAX_CHARS * 0.8 ? "warning" : "";
  const isBusy     = isLoading || isSpeaking;

  const statusLabel =
    isLoading  ? "Memproses dengan AI…" :
    isSpeaking ? (isPaused ? "Dijeda" : "Sedang Diputar") :
    serverOnline === null ? "Memeriksa server…" :
    serverOnline          ? "Server Aktif" :
                            "Server Tidak Aktif";

  const statusDotClass =
    isLoading  ? "loading"  :
    isSpeaking ? "speaking" :
    serverOnline ? "ready"  : "offline";

  // ── Audio element event handlers ───────────────────────────────────
  const handleAudioPlay = useCallback(() => {
    setIsSpeaking(true);
    setIsPaused(false);
    setupAnalyser();
    startWaveformDraw();
  }, [setupAnalyser, startWaveformDraw]);

  const handleAudioPause = useCallback(() => {
    setIsPaused(true);
    stopWaveformDraw();
  }, [stopWaveformDraw]);

  const handleAudioEnded = useCallback(() => {
    setIsSpeaking(false);
    setIsPaused(false);
    stopWaveformDraw();
  }, [stopWaveformDraw]);

  const handleTimeUpdate = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    const cur = el.currentTime;
    const dur = el.duration || 0;
    setAudioCurrentTime(cur);
    setAudioProgress(dur > 0 ? (cur / dur) * 100 : 0);
  }, []);

  const handleDurationChange = useCallback(() => {
    setAudioDuration(audioRef.current?.duration || 0);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <>
      <div className="bg-pattern" />
      <div className="bg-grid" />

      {/* Hidden audio element — all playback is programmatic */}
      <audio
        ref={audioRef}
        onPlay={handleAudioPlay}
        onPause={handleAudioPause}
        onEnded={handleAudioEnded}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={handleDurationChange}
        onError={() => {
          setIsSpeaking(false);
          setIsPaused(false);
          stopWaveformDraw();
          showToast("Gagal memutar audio", "error");
        }}
      />

      <div className="app-container">

        {/* ── Header ───────────────────────────────────────────────── */}
        <header className="header">
          <div className="header-badge">
            <span className="dot" />
            RVC AI &bull; Suara Asli Jokowi
          </div>

          <div className="avatar-container">
            <div className="avatar-ring" />
            <img
              src="/jokowi-avatar.png"
              alt="Jokowi Avatar"
              className="avatar-img"
              width={100}
              height={100}
            />
          </div>

          <h1>Jokowi <span className="accent">Voice</span> Generator</h1>
          <p>
            Menggunakan model RVC terlatih 175 epoch dengan suara asli Pak Jokowi.
            Jauh lebih realistis dari Text-to-Speech biasa.
          </p>

          <div className="features">
            <span className="feature-chip"><span className="chip-icon">🤖</span> RVC AI Model</span>
            <span className="feature-chip"><span className="chip-icon">🎙️</span> Suara Asli</span>
            <span className="feature-chip"><span className="chip-icon">⬇️</span> Bisa Diunduh</span>
            <span className="feature-chip"><span className="chip-icon">🇮🇩</span> Bahasa Indonesia</span>
          </div>
        </header>

        {/* ── Server offline banner ─────────────────────────────────── */}
        {serverOnline === false && (
          <div className="server-banner offline">
            <span>⚠️</span>
            <span>
              Backend tidak berjalan. Buka terminal di folder{" "}
              <code>backend/</code>, lalu jalankan:{" "}
              <code>start.bat</code> (Windows) atau <code>./start.sh</code> (Mac/Linux)
            </span>
          </div>
        )}

        {/* ── Main card ─────────────────────────────────────────────── */}
        <div className={`glass-card ${isSpeaking ? "active-card" : ""}`}>

          {/* Text input */}
          <div className="input-section">
            <label className="input-label" htmlFor="tts-input">
              <span className="icon">✍️</span>Masukkan Teks Pidato
            </label>
            <div className="textarea-wrapper">
              <textarea
                id="tts-input"
                className="text-input"
                value={text}
                onChange={e => setText(e.target.value.slice(0, MAX_CHARS))}
                placeholder='"Saudara-saudara sebangsa dan setanah air..."'
                disabled={isBusy}
              />
              <span className={`char-counter ${charClass}`}>{charCount}/{MAX_CHARS}</span>
            </div>
          </div>

          {/* Presets */}
          <div className="presets-section">
            <div className="presets-label"><span className="icon">💬</span>Kutipan Ikonik</div>
            <div className="presets-grid">
              {JOKOWI_PRESETS.map((p, i) => (
                <button key={i} className="preset-btn" onClick={() => setText(p)} disabled={isBusy}>
                  {p.length > 40 ? p.slice(0, 40) + "…" : p}
                </button>
              ))}
            </div>
          </div>

          {/* Voice + F0 method */}
          <div className="controls-grid" style={{ marginBottom: 16 }}>
            <div className="control-group" style={{ gridColumn: "1 / -1" }}>
              <label className="control-label" htmlFor="voice-select">
                <span>🎙️ Suara Edge TTS (sumber)</span>
                <span className="info-tooltip">ℹ️
                  <span className="tooltip-text">
                    Suara asal sebelum dikonversi ke Jokowi.
                    Ardi (pria) memberi hasil terbaik karena mendekati register suara Jokowi.
                  </span>
                </span>
              </label>
              <select id="voice-select" className="voice-select"
                value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)} disabled={isBusy}>
                {edgeVoices.map(v => (
                  <option key={v.ShortName} value={v.ShortName}>
                    {v.FriendlyName ?? v.ShortName}
                  </option>
                ))}
              </select>
            </div>

            <div className="control-group" style={{ gridColumn: "1 / -1" }}>
              <label className="control-label" htmlFor="f0-select">
                <span>🎵 Metode F0 (pitch tracking)</span>
                <span className="info-tooltip">ℹ️
                  <span className="tooltip-text">
                    harvest = cepat, tanpa download.
                    rmvpe = kualitas terbaik, unduh ~200 MB otomatis pertama kali.
                  </span>
                </span>
              </label>
              <select id="f0-select" className="voice-select"
                value={f0Method} onChange={e => setF0Method(e.target.value)} disabled={isBusy}>
                <option value="harvest">harvest — cepat (default)</option>
                <option value="pm">pm — sangat cepat</option>
                <option value="rmvpe">rmvpe — kualitas terbaik (auto-download ~200 MB)</option>
              </select>
            </div>
          </div>

          {/* Parameter sliders */}
          <div className="controls-grid">
            <div className="control-group">
              <label className="control-label" htmlFor="pitch-slider">
                <span>🎼 Pitch Shift</span>
                <span className="control-value">{pitchShift > 0 ? `+${pitchShift}` : pitchShift} st</span>
              </label>
              <input id="pitch-slider" type="range" className="slider"
                min="-12" max="12" step="1" value={pitchShift}
                onChange={e => setPitchShift(parseInt(e.target.value, 10))} disabled={isBusy} />
            </div>

            <div className="control-group">
              <label className="control-label" htmlFor="speed-slider">
                <span>⚡ Kecepatan</span>
                <span className="control-value">{speed >= 0 ? `+${speed}` : speed}%</span>
              </label>
              <input id="speed-slider" type="range" className="slider"
                min="-50" max="50" step="5" value={speed}
                onChange={e => setSpeed(parseFloat(e.target.value))} disabled={isBusy} />
            </div>

            <div className="control-group">
              <label className="control-label" htmlFor="index-slider">
                <span>🔊 Index Rate</span>
                <span className="info-tooltip">ℹ️
                  <span className="tooltip-text">
                    Seberapa kuat fitur suara Jokowi dari FAISS index diterapkan.
                    0 = suara TTS asli, 1 = 100% Jokowi.
                  </span>
                </span>
                <span className="control-value">{Math.round(indexRate * 100)}%</span>
              </label>
              <input id="index-slider" type="range" className="slider"
                min="0" max="1" step="0.05" value={indexRate}
                onChange={e => setIndexRate(parseFloat(e.target.value))} disabled={isBusy} />
            </div>

            <div className="control-group">
              <label className="control-label" htmlFor="volume-slider">
                <span>🔈 Volume</span>
                <span className="control-value">{Math.round(volume * 100)}%</span>
              </label>
              <input id="volume-slider" type="range" className="slider"
                min="0" max="1" step="0.05" value={volume}
                onChange={e => setVolume(parseFloat(e.target.value))} />
            </div>
          </div>

          {/* Action buttons */}
          <div className="actions">
            {!isSpeaking && !isLoading ? (
              <button className="btn btn-primary" onClick={() => speak()}
                disabled={!text.trim() || serverOnline !== true}>
                <span className="icon">▶️</span>
                {serverOnline === false ? "Server Offline" :
                 serverOnline === null  ? "Memeriksa…"    : "Mulai Bicara"}
              </button>
            ) : isSpeaking ? (
              <>
                <button className="btn btn-secondary" onClick={togglePause}>
                  <span className="icon">{isPaused ? "▶️" : "⏸️"}</span>
                  {isPaused ? "Lanjutkan" : "Jeda"}
                </button>
                <button className="btn btn-stop" onClick={stopSpeaking}>
                  <span className="icon">⏹️</span>Berhenti
                </button>
              </>
            ) : (
              <button className="btn btn-primary" disabled>
                <span className="btn-spinner" />
                Memproses AI…
              </button>
            )}

            {currentAudioUrl && !isLoading && (
              <button className="btn btn-download"
                onClick={() => downloadAudio(currentAudioUrl, text || "jokowi_speech")}
                title="Unduh audio sebagai WAV">
                <span>⬇️</span> Unduh WAV
              </button>
            )}

            <button className="btn btn-secondary" onClick={resetSettings}
              disabled={isBusy} title="Reset ke pengaturan default Jokowi">
              <span className="icon">🔄</span>Reset
            </button>

            {(isLoading || isSpeaking) && (
              <button className="btn btn-stop" onClick={stopSpeaking}>
                <span className="icon">✕</span>Batalkan
              </button>
            )}
          </div>

          {/* ── Audio player — waveform + progress bar ────────────── */}
          {currentAudioUrl && (
            <div className="audio-player">
              {/* Waveform canvas */}
              <canvas ref={canvasRef} className="waveform-canvas" />

              {/* Progress bar + time + download */}
              <div className="audio-progress-row">
                <span className="audio-time">{formatTime(audioCurrentTime)}</span>
                <div className="audio-progress-bar" onClick={handleSeek}
                  title="Klik untuk seek" role="slider"
                  aria-valuenow={Math.round(audioProgress)}
                  aria-valuemin={0} aria-valuemax={100}>
                  <div className="audio-progress-fill" style={{ width: `${audioProgress}%` }} />
                  <div className="audio-progress-thumb"
                    style={{ left: `${audioProgress}%` }} />
                </div>
                <span className="audio-time">{formatTime(audioDuration)}</span>
              </div>
            </div>
          )}

          {/* Loading wave (while synthesising, before audio is ready) */}
          {isLoading && (
            <div className="speaking-indicator">
              <div className="wave-bars">
                {[...Array(8)].map((_, i) => <div key={i} className="wave-bar" />)}
              </div>
              <span className="speaking-text">Mensintesis suara Jokowi…</span>
            </div>
          )}

          {/* Status bar */}
          <div className="status-bar">
            <span className={`status-dot ${statusDotClass}`} />
            <span>{statusLabel}</span>
            <span style={{ marginLeft: "auto" }}>RVC v1 &bull; 175 Epoch</span>
          </div>
        </div>

        {/* ── History ───────────────────────────────────────────────── */}
        {history.length > 0 && (
          <div className="glass-card history-section">
            <div className="history-header">
              <div className="history-title"><span>📜</span> Riwayat</div>
              <button className="history-clear" onClick={clearHistory}>Hapus Semua</button>
            </div>
            <div className="history-list">
              {history.map(entry => (
                <div key={entry.id} className="history-item"
                  onClick={() => handleHistoryPlay(entry)}
                  role="button" tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleHistoryPlay(entry);
                    }
                  }}>
                  <div className="play-icon">▶</div>
                  <span className="history-text">{entry.text}</span>
                  <span className="history-time">{entry.time}</span>
                  {entry.audioUrl && (
                    <button
                      className="history-dl-btn"
                      title="Unduh audio ini"
                      onClick={e => { e.stopPropagation(); downloadAudio(entry.audioUrl, entry.text); }}
                    >
                      ⬇️
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Footer ────────────────────────────────────────────────── */}
        <footer className="footer">
          <p className="footer-text">
            <span className="footer-flag">🇮🇩</span>
            Powered by RVC + Edge TTS &bull; Model 175 Epoch
          </p>
        </footer>
      </div>

      {/* Toast */}
      <div className={`toast ${toast.show ? "show" : ""} ${toast.type}`}>
        {toast.message}
      </div>
    </>
  );
}
