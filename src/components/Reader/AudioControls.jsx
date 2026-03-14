// src/components/Reader/AudioControls.jsx
// Barre de contrôle TTS : Play/Pause, Stop, vitesse, voix

import { useState, useEffect } from 'react';
import { useReaderStore } from '../../store/readerStore';

export default function AudioControls({ ttsState, onPlayPause, onStop, onSeek, sentenceCount, sentenceIdx, cfi }) {
  const { preferences, setPreference, showToast, currentBook } = useReaderStore();
  const [voices, setVoices] = useState([]);
  const [showVoices, setShowVoices] = useState(false);

  // Chargement des voix disponibles
  useEffect(() => {
    const synth = window.speechSynthesis;
    const loadVoices = () => {
      const v = synth.getVoices().filter(v => v.lang?.startsWith('fr') || v.lang?.startsWith('en'));
      setVoices(v.length > 0 ? v : synth.getVoices().slice(0, 10));
    };
    loadVoices();
    synth.addEventListener('voiceschanged', loadVoices);
    return () => synth.removeEventListener('voiceschanged', loadVoices);
  }, []);

  const isPlaying = ttsState === 'playing';
  const isPaused = ttsState === 'paused';
  const isActive = isPlaying || isPaused;
  const progress = sentenceCount > 0 ? (sentenceIdx / sentenceCount) * 100 : 0;

  const handleSaveBookmark = () => {
    if (cfi) {
      showToast(`🔖 Position sauvegardée: ${cfi.slice(0, 40)}…`);
    } else {
      showToast('⚠️ Aucune position à sauvegarder');
    }
  };

  return (
    <div className="glass-panel mx-2 mb-2 mt-1 px-4 py-3">
      {/* Barre de progression interactive des phrases */}
      {isActive && sentenceCount > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-dark-400 mb-2">
            <span>Phrase {sentenceIdx + 1} / {sentenceCount}</span>
            <span className="font-mono">{Math.round(progress)}%</span>
          </div>
          
          <div className="relative w-full flex items-center group h-2">
            {/* Input range invisible mais cliquable par dessus la jauge */}
            <input
              type="range"
              min="0"
              max={Math.max(0, sentenceCount - 1)}
              value={sentenceIdx}
              onChange={(e) => onSeek?.(parseInt(e.target.value, 10))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 m-0"
              title="Avancer/Reculer dans le texte"
              aria-label="Progression de la lecture"
            />
            {/* Fond de la jauge */}
            <div className="absolute inset-0 w-full h-1 my-auto bg-dark-500 rounded-full overflow-hidden">
              {/* Remplissage de la jauge */}
              <div
                className="h-full bg-gradient-to-r from-brand-600 to-brand-400 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            {/* Curseur visuel (thumb) */}
            <div 
              className="absolute h-3 w-3 bg-white rounded-full shadow-md transform -translate-x-1/2 transition-transform duration-200 group-hover:scale-125"
              style={{ left: `${progress}%`, pointerEvents: 'none' }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">

        {/* Bouton Stop */}
        <button
          onClick={onStop}
          className={`btn-icon ${isActive ? 'text-accent-400 border-accent-400/30' : ''}`}
          title="Arrêter la lecture"
          aria-label="Arrêter"
          id="tts-stop-btn"
          disabled={!isActive}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" rx="2"/>
          </svg>
        </button>

        {/* Bouton Play/Pause principal */}
        <button
          onClick={onPlayPause}
          className="btn-play"
          title={isPlaying ? 'Pause' : isPaused ? 'Reprendre' : 'Lire'}
          aria-label={isPlaying ? 'Pause' : 'Lecture'}
          id="tts-play-btn"
        >
          {isPlaying ? (
            /* Icône Pause */
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
              <rect x="6" y="4" width="4" height="16" rx="1"/>
              <rect x="14" y="4" width="4" height="16" rx="1"/>
            </svg>
          ) : (
            /* Icône Play */
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
          )}
        </button>

        {/* Indicateur sonore animé */}
        {isPlaying && (
          <div className="sound-wave">
            <span/><span/><span/><span/><span/>
          </div>
        )}
        {isPaused && (
          <span className="text-xs text-dark-400 italic">En pause</span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Contrôle vitesse */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-dark-400 whitespace-nowrap">
            {preferences.ttsRate.toFixed(1)}×
          </span>
          <input
            type="range"
            min="0.5"
            max="2.5"
            step="0.1"
            value={preferences.ttsRate}
            onChange={(e) => setPreference('ttsRate', parseFloat(e.target.value))}
            className="range-slider w-20"
            title={`Vitesse: ${preferences.ttsRate.toFixed(1)}×`}
            aria-label="Vitesse de lecture"
            id="tts-speed-slider"
          />
          <span className="text-xs text-dark-400 hidden sm:block">Vitesse</span>
        </div>

        {/* Sélecteur de voix */}
        <div className="relative">
          <button
            onClick={() => setShowVoices(v => !v)}
            className={`btn-icon ${showVoices ? 'active' : ''}`}
            title="Choisir la voix"
            aria-label="Choisir la voix"
            id="tts-voice-btn"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
            </svg>
          </button>

          {showVoices && (
            <div className="absolute bottom-12 right-0 glass-card p-2 min-w-56 max-h-48 overflow-y-auto z-50">
              <p className="text-xs text-dark-400 px-2 pb-2 font-medium">Choisir une voix</p>
              {voices.length === 0 && (
                <p className="text-xs text-dark-400 px-2">Aucune voix disponible</p>
              )}
              {voices.map((voice) => (
                <button
                  key={voice.name}
                  onClick={() => {
                    setPreference('voice', voice.name);
                    setShowVoices(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-all duration-150 ${
                    preferences.voice === voice.name
                      ? 'bg-brand-500/20 text-brand-400'
                      : 'text-dark-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className="font-medium">{voice.name}</span>
                  <span className="ml-1 opacity-60">({voice.lang})</span>
                  {voice.localService && <span className="ml-1 text-success">●</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Bouton sauvegarder marque-page */}
        <button
          onClick={handleSaveBookmark}
          className="btn-icon"
          title="Sauvegarder la position (CFI)"
          aria-label="Sauvegarder"
          id="save-bookmark-btn"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
        </button>

      </div>
    </div>
  );
}
