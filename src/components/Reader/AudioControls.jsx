// src/components/Reader/AudioControls.jsx
// Barre de contrôle TTS : Play/Pause, Stop, vitesse, voix

import { useState, useEffect } from 'react';
import { useReaderStore } from '../../store/readerStore';

export default function AudioControls({ ttsState, onPlayPause, onStop, onSeek, sentenceCount, sentenceIdx, localChapterIdx, totalChapters, chapterWeights, cfi }) {
  const { preferences, setPreference, showToast, currentBook, addBookmark } = useReaderStore();
  const [voices, setVoices] = useState([]);
  const [showVoices, setShowVoices] = useState(false);

  // Chargement des voix disponibles
  useEffect(() => {
    const synth = window.speechSynthesis;
    const loadVoices = () => {
      const v = synth.getVoices().filter(v => v.lang?.toLowerCase().startsWith('fr'));
      setVoices(v.length > 0 ? v : synth.getVoices().slice(0, 10));
    };
    loadVoices();
    synth.addEventListener('voiceschanged', loadVoices);
    return () => synth.removeEventListener('voiceschanged', loadVoices);
  }, []);

  const isPlaying = ttsState === 'playing';
  const isPaused = ttsState === 'paused';
  const isActive = isPlaying || isPaused;
  
  // Progression interne de la phrase (0-100)
  const sentenceProgress = sentenceCount > 0 ? (sentenceIdx / sentenceCount) * 100 : 0;
  
  // Progression globale estimée (% du livre) fraction de la phrase actuelle
  const chapterProgressFraction = sentenceCount > 0 ? (sentenceIdx / sentenceCount) : 0;
  
  let rawProgress = 0;
  
  // Utilisation des poids réels calculés en background (précision au caractère près)
  if (chapterWeights && chapterWeights.offsets.length > localChapterIdx) {
    const offset = chapterWeights.offsets[localChapterIdx];      // ex: 0.12 (12%)
    const weight = chapterWeights.weights[localChapterIdx] || 0; // ex: 0.05 (5%)
    rawProgress = (offset + (chapterProgressFraction * weight)) * 100;
  } else {
    // Fallback pendant les 2 premières secondes de calcul background
    rawProgress = totalChapters > 0 ? ((localChapterIdx + chapterProgressFraction) / totalChapters) * 100 : 0;
  }
  
  const totalProgress = Math.min(100, Math.max(0, rawProgress));
  const showTotalProgress = totalChapters > 0;

  const handleSaveBookmark = () => {
    if (cfi && currentBook) {
      addBookmark({
        id: Date.now(),
        chapterIdx: localChapterIdx,
        progress: totalProgress,
        sentenceIdx: sentenceIdx,
        timestamp: Date.now()
      });
      showToast(`🔖 Signet sauvegardé (${totalProgress.toFixed(1)}%)`);
    } else {
      showToast('⚠️ Impossible de sauvegarder le signet');
    }
  };

  return (
    <div className="glass-panel mx-2 mb-2 mt-1 px-4 py-3">
      {/* Accordéon pour le téléprompteur */}
      {sentenceCount > 0 && (
        <details className="mb-3 group cursor-pointer marker:text-transparent" open>
          <summary className="flex items-center justify-between text-xs text-dark-400 mb-1 hover:text-white transition-colors list-none select-none">
            <div className="flex items-center gap-1.5 [&::-webkit-details-marker]:hidden">
              <svg className="w-4 h-4 transform transition-transform group-open:rotate-90 text-dark-400 group-hover:text-white" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/>
              </svg>
              <span>Navigation (Phrase {sentenceIdx + 1}/{sentenceCount})</span>
            </div>
            {showTotalProgress && (
               <span className="font-mono bg-white/10 px-2 py-0.5 rounded text-[10px] text-white/80">
                 Livre : {totalProgress.toFixed(1)}%
               </span>
            )}
          </summary>
          
          <div className="pt-2 pb-1 cursor-default">
            <div className="relative w-full flex items-center group/range h-2">
              <input
                type="range"
                min="0"
                max={Math.max(0, sentenceCount - 1)}
                value={sentenceIdx}
                onChange={(e) => onSeek?.(parseInt(e.target.value, 10))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 m-0"
                title="Sauter à une phrase"
              />
              <div className="absolute inset-0 w-full h-1 my-auto bg-dark-500 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-brand-600 to-brand-400 rounded-full transition-all duration-300"
                  style={{ width: `${sentenceProgress}%` }}
                />
              </div>
              <div 
                className="absolute h-3 w-3 bg-white rounded-full shadow-md transform -translate-x-1/2 transition-transform duration-200 group-hover/range:scale-125"
                style={{ left: `${sentenceProgress}%`, pointerEvents: 'none' }}
              />
            </div>
          </div>
        </details>
      )}

      {/* Affichage direct de la progression quand le lecteur est arrêté */}
      {(!isActive || sentenceCount === 0) && showTotalProgress && (
        <div className="flex justify-end mb-2">
          <span className="font-mono bg-white/10 px-2 py-0.5 rounded text-[10px] text-dark-300">
             Progression livre : {totalProgress.toFixed(1)}%
          </span>
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
        <div className="flex items-center gap-1 bg-white/5 rounded-lg px-2 py-1">
          <button
            onClick={() => setPreference('ttsRate', Math.max(0.5, Number((preferences.ttsRate - 0.1).toFixed(1))))}
            className="w-8 h-8 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 rounded-md transition-colors"
            aria-label="Réduire la vitesse"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <span className="text-xs font-mono text-white/90 w-8 text-center select-none">
            {preferences.ttsRate.toFixed(1)}x
          </span>
          <button
            onClick={() => setPreference('ttsRate', Math.min(2.5, Number((preferences.ttsRate + 0.1).toFixed(1))))}
            className="w-8 h-8 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 rounded-md transition-colors"
            aria-label="Augmenter la vitesse"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
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
