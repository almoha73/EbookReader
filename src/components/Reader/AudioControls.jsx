// src/components/Reader/AudioControls.jsx
// Barre de contrôle TTS : Play/Pause, Stop, vitesse, voix

import { useState, useEffect } from 'react';
import { useReaderStore } from '../../store/readerStore';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

export default function AudioControls({ ttsState, onPlayPause, onStop, onSeek, onGlobalSeek, sentenceCount, sentenceIdx, sentences, localChapterIdx, totalChapters, chapterWeights, contentRef, getActiveSentenceIdx }) {
  const { preferences, setPreference, currentBook } = useReaderStore();
  const [voices, setVoices] = useState([]);
  const [showVoices, setShowVoices] = useState(false);
  const [dragProgress, setDragProgress] = useState(null);
  const [dragSentenceIdx, setDragSentenceIdx] = useState(null);
  const [accordionOpen, setAccordionOpen] = useState(true);

  // Chargement des voix disponibles
  useEffect(() => {
    const loadVoices = async () => {
      try {
        const { voices: allVoices } = await TextToSpeech.getSupportedVoices();
        const mappedVoices = allVoices.map((v, i) => ({ ...v, globalIndex: i }));
        const v = mappedVoices.filter(v => v.lang?.toLowerCase().startsWith('fr'));
        
        // Dédoublonner par URI pour éviter de fusionner des voix différentes ayant le même nom (ex: Samsung TTS)
        const uniqueVoicesMap = new Map();
        for (const voice of v) {
            const key = voice.voiceURI || voice.name;
            if (!uniqueVoicesMap.has(key)) {
                uniqueVoicesMap.set(key, voice);
            }
        }
        
        const finalVoices = uniqueVoicesMap.size > 0 ? Array.from(uniqueVoicesMap.values()) : mappedVoices.slice(0, 10);
        setVoices(finalVoices);
        
        // Si aucune voix n'est sélectionnée, on prend par défaut la première voix française
        if (preferences.voice === undefined && finalVoices.length > 0) {
          setPreference('voice', finalVoices[0].globalIndex);
        }
      } catch (e) {
        console.warn('TextToSpeech non disponible', e);
      }
    };
    loadVoices();
  }, [preferences.voice, setPreference]);

  const isPlaying = ttsState === 'playing';
  const isPaused = ttsState === 'paused';
  const isActive = isPlaying || isPaused;
  
  // Estimation de la phrase en cours selon le scroll quand le TTS est idle
  const [scrollSentenceIdx, setScrollSentenceIdx] = useState(0);

  useEffect(() => {
    if (ttsState !== 'idle' || !contentRef?.current || !getActiveSentenceIdx) return;
    
    const interval = setInterval(() => {
      const el = contentRef.current;
      if (!el) return;
      const targetY = el.scrollTop + el.clientHeight / 3;
      const idx = getActiveSentenceIdx(targetY);
      if (idx !== null && !isNaN(idx)) {
        setScrollSentenceIdx(idx);
      }
    }, 300);

    return () => clearInterval(interval);
  }, [ttsState, contentRef, getActiveSentenceIdx]);

  // Progression interne de la phrase (0-100)
  const displaySentenceIdx = dragSentenceIdx !== null ? dragSentenceIdx : (ttsState === 'idle' ? scrollSentenceIdx : sentenceIdx);
  const sentenceProgress = sentenceCount > 0 ? (displaySentenceIdx / sentenceCount) * 100 : 0;
  
  // Progression globale estimée (% du livre) fraction de la phrase actuelle
  const chapterProgressFraction = sentenceCount > 0 ? (displaySentenceIdx / sentenceCount) : 0;
  
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
  const displayProgress = dragProgress !== null ? dragProgress : totalProgress;

  // Calcul du temps restant estimé
  let remainingTimeStr = "";
  if (sentences && sentences.length > 0 && typeof preferences.ttsRate === 'number') {
    let remainingCharsChapter = 0;
    for (let i = displaySentenceIdx; i < sentences.length; i++) {
      remainingCharsChapter += sentences[i].length;
    }
    
    // Vitesse moyenne : 12 caractères / seconde à x1.0 (voir useTTS.js)
    const charsPerSecond = 12 * (preferences.ttsRate || 1.0);
    const remainingSecondsChapter = remainingCharsChapter / charsPerSecond;
    
    let totalCharsChapter = 0;
    for (let i = 0; i < sentences.length; i++) {
      totalCharsChapter += sentences[i].length;
    }
    const totalSecondsChapter = totalCharsChapter / charsPerSecond;
    
    let totalRemainingSecondsBook = remainingSecondsChapter;
    if (chapterWeights && chapterWeights.weights.length > localChapterIdx) {
      const currentChapterWeight = chapterWeights.weights[localChapterIdx];
      if (currentChapterWeight > 0) {
        const secondsPerPercent = totalSecondsChapter / (currentChapterWeight * 100);
        const remainingPercentGlobal = 100 - displayProgress;
        totalRemainingSecondsBook = remainingPercentGlobal * secondsPerPercent;
      }
    }
    
    const formatTime = (totalSeconds) => {
      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      if (h > 0) return `${h}h${m.toString().padStart(2, '0')}`;
      if (m > 0) return `${m} min`;
      return `< 1 min`;
    };
    
    remainingTimeStr = `Chap: ${formatTime(remainingSecondsChapter)} - Livre: ${formatTime(totalRemainingSecondsBook)}`;
  }

  return (
    <div 
      className="glass-panel mx-0 mb-0 mt-1 px-2 sm:px-4 pt-3 pb-3" 
      style={{ 
        borderBottomLeftRadius: 0, 
        borderBottomRightRadius: 0, 
        borderBottom: 'none',
        borderLeft: 'none',
        borderRight: 'none',
        paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' 
      }}
    >
      {/* Accordéon pour le téléprompteur */}
      {sentenceCount > 0 && (
        <details className="mb-3 group cursor-pointer marker:text-transparent" open={accordionOpen}>
          <summary 
            className="flex items-center justify-between text-xs text-gray-300 mb-1 hover:text-white transition-colors list-none select-none"
            onClick={(e) => {
              e.preventDefault();
              setAccordionOpen(!accordionOpen);
            }}
          >
            <div className="flex items-center gap-1.5 [&::-webkit-details-marker]:hidden">
              <svg className="w-4 h-4 transform transition-transform group-open:rotate-90 text-gray-300 group-hover:text-white" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/>
              </svg>
              <span>Navigation par phrase ({sentenceIdx + 1}/{sentenceCount})</span>
            </div>
            {remainingTimeStr && <span className="text-[10px] text-brand-300 ml-2 font-medium bg-brand-500/20 px-1.5 py-0.5 rounded">⏱️ {remainingTimeStr}</span>}
          </summary>
          
          <div className="pt-2 pb-1 cursor-default">
            <div className="relative w-full flex items-center group/range h-2">
              <input
                type="range"
                min="0"
                max={Math.max(0, sentenceCount - 1)}
                value={displaySentenceIdx}
                onChange={(e) => setDragSentenceIdx(parseInt(e.target.value, 10))}
                onMouseUp={() => {
                  if (dragSentenceIdx !== null) {
                    onSeek?.(dragSentenceIdx);
                    setDragSentenceIdx(null);
                  }
                }}
                onTouchEnd={() => {
                  if (dragSentenceIdx !== null) {
                    onSeek?.(dragSentenceIdx);
                    setDragSentenceIdx(null);
                  }
                }}
                onKeyUp={(e) => {
                  if (dragSentenceIdx !== null) {
                    onSeek?.(dragSentenceIdx);
                    setDragSentenceIdx(null);
                  }
                }}
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

      {/* Timeline Globale du livre */}
      {showTotalProgress && (
        <div className="mb-3 px-1">
          <div className="flex justify-between text-[10px] text-gray-300 mb-1 font-mono">
            <span>0%</span>
            <span>Livre entier : {displayProgress.toFixed(1)}%</span>
            <span>100%</span>
          </div>
          <div className="relative w-full flex items-center group/global h-3">
            <input
              type="range"
              min="0"
              max="1000"
              value={Math.round(displayProgress * 10)}
              onChange={(e) => setDragProgress(parseInt(e.target.value, 10) / 10)}
              onPointerUp={() => {
                if (dragProgress !== null) {
                  onGlobalSeek?.(dragProgress);
                  setDragProgress(null);
                }
              }}
              onKeyUp={(e) => {
                if (dragProgress !== null) {
                  onGlobalSeek?.(dragProgress);
                  setDragProgress(null);
                }
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 m-0"
              title="Naviguer dans tout le livre"
            />
            <div className="absolute inset-0 w-full h-1.5 my-auto bg-dark-600 rounded-full overflow-hidden border border-white/5">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-400 rounded-full transition-all duration-100"
                style={{ width: `${displayProgress}%` }}
              />
            </div>
            <div 
              className="absolute h-3 w-3 bg-white rounded-full shadow-md transform -translate-x-1/2 transition-transform duration-200 group-hover/global:scale-125"
              style={{ left: `${displayProgress}%`, pointerEvents: 'none' }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 sm:gap-3">

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
          <span className="text-xs text-gray-300 italic">En pause</span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Contrôle vitesse */}
        <div className="flex items-center gap-0.5 sm:gap-1 bg-white/5 rounded-lg px-1 sm:px-2 py-1">
          <button
            onClick={() => setPreference('ttsRate', Math.max(0.5, Number((preferences.ttsRate - 0.1).toFixed(1))))}
            className="w-6 h-6 sm:w-8 sm:h-8 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 rounded-md transition-colors"
            aria-label="Réduire la vitesse"
          >
            -
          </button>
          
          <div className="relative w-12 sm:w-16 mx-0.5 sm:mx-1">
            <input
              type="number"
              min="0.5"
              max="2.0"
              step="0.1"
              value={preferences.ttsRate}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) {
                   setPreference('ttsRate', Math.max(0.5, Math.min(2.0, Number(val.toFixed(1)))));
                }
              }}
              className="w-full bg-black/30 border border-white/10 rounded px-1 py-1 text-center text-sm text-white focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>

          <button
            onClick={() => setPreference('ttsRate', Math.min(2.0, Number((preferences.ttsRate + 0.1).toFixed(1))))}
            className="w-6 h-6 sm:w-8 sm:h-8 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 rounded-md transition-colors"
            aria-label="Augmenter la vitesse"
          >
            +
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
              <p className="text-xs text-gray-200 px-2 pb-2 font-medium">Choisir une voix</p>
              {voices.length === 0 && (
                <div className="px-2 pb-2">
                  <p className="text-xs text-gray-300 mb-2">Aucune voix disponible.</p>
                  <button 
                    onClick={() => TextToSpeech.openInstall()}
                    className="w-full btn-primary text-xs py-1"
                  >
                    Installer la voix Android
                  </button>
                </div>
              )}
              {voices.map((voice) => (
                <button
                  key={voice.name}
                  onClick={() => {
                    // Typeof check to clean up old string preferences from window.speechSynthesis
                    setPreference('voice', voice.globalIndex);
                    setShowVoices(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-all duration-150 ${
                    preferences.voice === voice.globalIndex
                      ? 'bg-brand-500/20 text-brand-400'
                      : 'text-gray-300 hover:bg-white/10 hover:text-white'
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

      </div>
    </div>
  );
}
