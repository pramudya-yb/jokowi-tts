"use client";

import { useState, useEffect, useRef, useCallback } from "react";

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

// Default voice settings to approximate Jokowi's speaking style:
// - Slightly lower pitch (0.85) for his characteristic calm, deep tone
// - Moderate speed (0.9) matching his deliberate speaking pace
const DEFAULT_SETTINGS = {
  pitch: 0.85,
  rate: 0.9,
  volume: 1.0,
};

const MAX_CHARS = 2000;

export default function JokowiTTS() {
  const [text, setText] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [pitch, setPitch] = useState(DEFAULT_SETTINGS.pitch);
  const [rate, setRate] = useState(DEFAULT_SETTINGS.rate);
  const [volume, setVolume] = useState(DEFAULT_SETTINGS.volume);
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState("");
  const [history, setHistory] = useState([]);
  const [toast, setToast] = useState({ show: false, message: "", type: "" });
  const [isSupported, setIsSupported] = useState(true);
  const [isReady, setIsReady] = useState(false);

  const synthRef = useRef(null);
  const toastTimerRef = useRef(null);

  // Initialize speech synthesis
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!("speechSynthesis" in window)) {
      setIsSupported(false);
      showToast("Browser tidak mendukung Text-to-Speech", "error");
      return;
    }

    synthRef.current = window.speechSynthesis;

    const loadVoices = () => {
      const availableVoices = synthRef.current.getVoices();
      if (availableVoices.length > 0) {
        setVoices(availableVoices);

        // Prioritize Indonesian voices
        const idVoice = availableVoices.find(
          (v) => v.lang.startsWith("id") || v.lang.includes("ID")
        );
        const msVoice = availableVoices.find(
          (v) => v.lang.startsWith("ms") || v.lang.includes("MS")
        );

        if (idVoice) {
          setSelectedVoice(idVoice.name);
        } else if (msVoice) {
          setSelectedVoice(msVoice.name);
        } else {
          setSelectedVoice(availableVoices[0]?.name || "");
        }

        setIsReady(true);
      }
    };

    loadVoices();
    synthRef.current.onvoiceschanged = loadVoices;

    // Load history from localStorage
    try {
      const savedHistory = localStorage.getItem("jokowi-tts-history");
      if (savedHistory) {
        setHistory(JSON.parse(savedHistory));
      }
    } catch (e) {
      // Ignore localStorage errors
    }

    return () => {
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    };
  }, []);

  // Save history to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("jokowi-tts-history", JSON.stringify(history));
    } catch (e) {
      // Ignore localStorage errors
    }
  }, [history]);

  const showToast = useCallback((message, type = "info") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ show: true, message, type });
    toastTimerRef.current = setTimeout(() => {
      setToast({ show: false, message: "", type: "" });
    }, 3000);
  }, []);

  const speak = useCallback(() => {
    if (!text.trim()) {
      showToast("Silakan masukkan teks terlebih dahulu", "error");
      return;
    }

    if (!synthRef.current) return;

    // Cancel any ongoing speech
    synthRef.current.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = pitch;
    utterance.rate = rate;
    utterance.volume = volume;

    // Set voice
    const voice = voices.find((v) => v.name === selectedVoice);
    if (voice) {
      utterance.voice = voice;
    }

    utterance.onstart = () => {
      setIsSpeaking(true);
      setIsPaused(false);
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setIsPaused(false);
    };

    utterance.onerror = (event) => {
      if (event.error !== "canceled") {
        setIsSpeaking(false);
        setIsPaused(false);
        showToast("Terjadi kesalahan saat memutar suara", "error");
      }
    };

    // Add to history
    const historyEntry = {
      id: Date.now(),
      text: text.substring(0, 100),
      fullText: text,
      time: new Date().toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
    setHistory((prev) => [historyEntry, ...prev.slice(0, 9)]);

    synthRef.current.speak(utterance);
  }, [text, pitch, rate, volume, selectedVoice, voices, showToast]);

  const stopSpeaking = useCallback(() => {
    if (synthRef.current) {
      synthRef.current.cancel();
      setIsSpeaking(false);
      setIsPaused(false);
    }
  }, []);

  const togglePause = useCallback(() => {
    if (!synthRef.current) return;

    if (isPaused) {
      synthRef.current.resume();
      setIsPaused(false);
    } else {
      synthRef.current.pause();
      setIsPaused(true);
    }
  }, [isPaused]);

  const handlePreset = useCallback((presetText) => {
    setText(presetText);
  }, []);

  const handleHistoryPlay = useCallback(
    (entry) => {
      setText(entry.fullText);
      // Small delay to allow state to update
      setTimeout(() => {
        if (synthRef.current) {
          synthRef.current.cancel();
          const utterance = new SpeechSynthesisUtterance(entry.fullText);
          utterance.pitch = pitch;
          utterance.rate = rate;
          utterance.volume = volume;
          const voice = voices.find((v) => v.name === selectedVoice);
          if (voice) utterance.voice = voice;
          utterance.onstart = () => {
            setIsSpeaking(true);
            setIsPaused(false);
          };
          utterance.onend = () => {
            setIsSpeaking(false);
            setIsPaused(false);
          };
          utterance.onerror = () => {
            setIsSpeaking(false);
            setIsPaused(false);
          };
          synthRef.current.speak(utterance);
        }
      }, 100);
    },
    [pitch, rate, volume, selectedVoice, voices]
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    showToast("Riwayat berhasil dihapus");
  }, [showToast]);

  const resetSettings = useCallback(() => {
    setPitch(DEFAULT_SETTINGS.pitch);
    setRate(DEFAULT_SETTINGS.rate);
    setVolume(DEFAULT_SETTINGS.volume);
    showToast("Pengaturan direset ke default Jokowi");
  }, [showToast]);

  const charCount = text.length;
  const charClass =
    charCount > MAX_CHARS ? "danger" : charCount > MAX_CHARS * 0.8 ? "warning" : "";

  // Group Indonesian voices first
  const sortedVoices = [...voices].sort((a, b) => {
    const aIsId =
      a.lang.startsWith("id") ||
      a.lang.includes("ID") ||
      a.lang.startsWith("ms");
    const bIsId =
      b.lang.startsWith("id") ||
      b.lang.includes("ID") ||
      b.lang.startsWith("ms");
    if (aIsId && !bIsId) return -1;
    if (!aIsId && bIsId) return 1;
    return a.name.localeCompare(b.name);
  });

  if (!isSupported) {
    return (
      <div className="app-container">
        <div className="glass-card" style={{ textAlign: "center", padding: "60px 32px" }}>
          <div style={{ fontSize: "3rem", marginBottom: "16px" }}>😔</div>
          <h2 style={{ color: "var(--red-400)", marginBottom: "12px" }}>
            Browser Tidak Didukung
          </h2>
          <p style={{ color: "var(--dark-400)" }}>
            Browser Anda tidak mendukung Web Speech API. Silakan gunakan Google
            Chrome, Microsoft Edge, atau Safari versi terbaru.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-pattern" />
      <div className="bg-grid" />

      <div className="app-container">
        {/* Header */}
        <header className="header">
          <div className="header-badge">
            <span className="dot" />
            Gratis &bull; Tanpa Batas
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

          <h1>
            Jokowi <span className="accent">Voice</span> Generator
          </h1>
          <p>
            Ubah teks menjadi suara dengan gaya bicara khas Pak Jokowi.
            Menggunakan teknologi Text-to-Speech gratis langsung di browser
            Anda.
          </p>

          <div className="features">
            <span className="feature-chip">
              <span className="chip-icon">🆓</span> 100% Gratis
            </span>
            <span className="feature-chip">
              <span className="chip-icon">🔒</span> Privasi Terjaga
            </span>
            <span className="feature-chip">
              <span className="chip-icon">⚡</span> Tanpa Registrasi
            </span>
            <span className="feature-chip">
              <span className="chip-icon">🇮🇩</span> Bahasa Indonesia
            </span>
          </div>
        </header>

        {/* Main Card */}
        <div className={`glass-card ${isSpeaking ? "active-card" : ""}`}>
          {/* Text Input */}
          <div className="input-section">
            <label className="input-label" htmlFor="tts-input">
              <span className="icon">✍️</span>
              Masukkan Teks Pidato
            </label>
            <div className="textarea-wrapper">
              <textarea
                id="tts-input"
                className="text-input"
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
                placeholder='Ketik teks di sini, contoh: "Saudara-saudara sebangsa dan setanah air..."'
                disabled={isSpeaking}
              />
              <span className={`char-counter ${charClass}`}>
                {charCount}/{MAX_CHARS}
              </span>
            </div>
          </div>

          {/* Presets */}
          <div className="presets-section">
            <div className="presets-label">
              <span className="icon">💬</span>
              Kutipan Ikonik
            </div>
            <div className="presets-grid">
              {JOKOWI_PRESETS.map((preset, i) => (
                <button
                  key={i}
                  className="preset-btn"
                  onClick={() => handlePreset(preset)}
                  disabled={isSpeaking}
                >
                  {preset.length > 40 ? preset.substring(0, 40) + "..." : preset}
                </button>
              ))}
            </div>
          </div>

          {/* Voice Selection */}
          <div className="controls-grid" style={{ marginBottom: "16px" }}>
            <div className="control-group" style={{ gridColumn: "1 / -1" }}>
              <label className="control-label" htmlFor="voice-select">
                <span>🎙️ Pilih Suara</span>
                <span className="info-tooltip">
                  ℹ️
                  <span className="tooltip-text">
                    Pilih suara Indonesia (id-ID) untuk hasil terbaik
                  </span>
                </span>
              </label>
              <select
                id="voice-select"
                className="voice-select"
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                disabled={isSpeaking}
              >
                {sortedVoices.map((voice) => (
                  <option key={voice.name} value={voice.name}>
                    {voice.name} ({voice.lang})
                    {voice.lang.startsWith("id") || voice.lang.includes("ID")
                      ? " ★ Recommended"
                      : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Sliders */}
          <div className="controls-grid">
            <div className="control-group">
              <label className="control-label" htmlFor="pitch-slider">
                <span>🎵 Nada Suara</span>
                <span className="control-value">{pitch.toFixed(2)}</span>
              </label>
              <input
                id="pitch-slider"
                type="range"
                className="slider"
                min="0.1"
                max="2"
                step="0.05"
                value={pitch}
                onChange={(e) => setPitch(parseFloat(e.target.value))}
                disabled={isSpeaking}
              />
            </div>

            <div className="control-group">
              <label className="control-label" htmlFor="rate-slider">
                <span>⚡ Kecepatan</span>
                <span className="control-value">{rate.toFixed(2)}x</span>
              </label>
              <input
                id="rate-slider"
                type="range"
                className="slider"
                min="0.1"
                max="3"
                step="0.05"
                value={rate}
                onChange={(e) => setRate(parseFloat(e.target.value))}
                disabled={isSpeaking}
              />
            </div>

            <div className="control-group">
              <label className="control-label" htmlFor="volume-slider">
                <span>🔊 Volume</span>
                <span className="control-value">
                  {Math.round(volume * 100)}%
                </span>
              </label>
              <input
                id="volume-slider"
                type="range"
                className="slider"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="actions">
            {!isSpeaking ? (
              <button
                id="btn-speak"
                className="btn btn-primary"
                onClick={speak}
                disabled={!text.trim() || !isReady}
              >
                <span className="icon">▶️</span>
                {isReady ? "Mulai Bicara" : "Memuat Suara..."}
              </button>
            ) : (
              <>
                <button
                  id="btn-pause"
                  className="btn btn-secondary"
                  onClick={togglePause}
                >
                  <span className="icon">{isPaused ? "▶️" : "⏸️"}</span>
                  {isPaused ? "Lanjutkan" : "Jeda"}
                </button>
                <button
                  id="btn-stop"
                  className="btn btn-stop"
                  onClick={stopSpeaking}
                >
                  <span className="icon">⏹️</span>
                  Berhenti
                </button>
              </>
            )}

            <button
              id="btn-reset"
              className="btn btn-secondary"
              onClick={resetSettings}
              disabled={isSpeaking}
              title="Reset ke pengaturan Jokowi"
            >
              <span className="icon">🔄</span>
              Reset
            </button>
          </div>

          {/* Speaking Animation */}
          {isSpeaking && (
            <div className="speaking-indicator">
              <div className="wave-bars">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="wave-bar" />
                ))}
              </div>
              <span className="speaking-text">
                {isPaused ? "Dijeda..." : "Sedang berbicara..."}
              </span>
            </div>
          )}

          {/* Status Bar */}
          <div className="status-bar">
            <span
              className={`status-dot ${
                isSpeaking ? "speaking" : isReady ? "ready" : ""
              }`}
            />
            <span>
              {isSpeaking
                ? isPaused
                  ? "Dijeda"
                  : "Sedang Berbicara"
                : isReady
                ? "Siap Digunakan"
                : "Memuat..."}
            </span>
            <span style={{ marginLeft: "auto" }}>
              Web Speech API &bull; Gratis
            </span>
          </div>
        </div>

        {/* History */}
        {history.length > 0 && (
          <div className="glass-card history-section">
            <div className="history-header">
              <div className="history-title">
                <span>📜</span> Riwayat
              </div>
              <button className="history-clear" onClick={clearHistory}>
                Hapus Semua
              </button>
            </div>
            <div className="history-list">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="history-item"
                  onClick={() => handleHistoryPlay(entry)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleHistoryPlay(entry);
                  }}
                >
                  <div className="play-icon">▶</div>
                  <span className="history-text">{entry.text}</span>
                  <span className="history-time">{entry.time}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="footer">
          <p className="footer-text">
            <span className="footer-flag">🇮🇩</span>
            Dibuat dengan ❤️ untuk Indonesia &bull; 100% Gratis &bull; Tanpa API Key
          </p>
        </footer>
      </div>

      {/* Toast Notification */}
      <div className={`toast ${toast.show ? "show" : ""} ${toast.type}`}>
        {toast.message}
      </div>
    </>
  );
}
