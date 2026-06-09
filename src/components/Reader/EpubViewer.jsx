// src/components/Reader/EpubViewer.jsx
// Lecteur EPUB avec défilement continu (vertical pur).
//
// Ce composant est volontairement court (~250 lignes).
// Toute la logique métier est déléguée à des hooks spécialisés :
//   - useEpubContent   : chargement et parsing du fichier EPUB
//   - useTTS           : synthèse vocale et suivi des phrases
//   - useViewerLayout  : ResizeObserver, fontSize, couleurs CSS
//   - useChapterTransition : transitions de chapitres, signets, seek
//   - useAutoScroll    : défilement automatique (avec gestion chapitres courts)

import { useEffect, useRef, useCallback, useState, memo } from 'react';
import { useEpubContent }        from '../../hooks/useEpubContent';
import { useTTS }                from '../../hooks/useTTS';
import { useReaderStore }        from '../../store/readerStore';
import { useViewerLayout }       from '../../hooks/useViewerLayout';
import { useChapterTransition }  from '../../hooks/useChapterTransition';
import { useAutoScroll }         from '../../hooks/useAutoScroll';
import {
  pendingSeekFractionRef,
  pendingSeekSentenceIdxRef,
  sharedCurrentFractionRef,
} from '../../hooks/readerSharedRefs';
import AudioControls    from './AudioControls';
import DisplaySettings  from './DisplaySettings';
import NavigationBar    from './NavigationBar';
import TocPanel         from './TocPanel';
import { KeepAwake }    from '@capacitor-community/keep-awake';

// ── Conteneur HTML isolé ──────────────────────────────────────────────────────
// Enveloppé dans React.memo pour ne se re-rendre QUE si le HTML ou l'audioMode changent.
// Empêche isPlaying ou sentenceIdx de déclencher un redessin destructeur.
const EpubHtmlContent = memo(({
  currentHtml, setContentRefCallback, onScroll, onWheel,
  handleTouchStart, handleTouchEnd,
  disableAutoScroll, handleNextChapterManual, handlePrevChapterManual,
  onDoubleClick, onContextMenu, audioMode, onClick,
}) => (
  <div
    ref={setContentRefCallback}
    tabIndex="-1"
    onScroll={onScroll}
    onWheel={onWheel}
    onTouchStart={handleTouchStart}
    onTouchEnd={handleTouchEnd}
    onTouchMove={disableAutoScroll}
    onMouseDown={disableAutoScroll}
    onDoubleClick={onDoubleClick}
    onContextMenu={onContextMenu}
    onClick={onClick}
    onKeyDown={(e) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Space'].includes(e.code)) {
        disableAutoScroll();
      }
      if (e.key === 'ArrowRight') handleNextChapterManual();
      if (e.key === 'ArrowLeft')  handlePrevChapterManual();
    }}
    className={`reader-content focus:outline-none ${audioMode ? 'audio-mode-padding' : 'clean-mode-padding'}`}
    dangerouslySetInnerHTML={{ __html: currentHtml }}
  />
));

// ── Composant principal ───────────────────────────────────────────────────────
export default function EpubViewer({ book }) {
  const contentRef = useRef(null);

  // ── UI : barre de nav, paramètres, TOC ────────────────────────────────────
  const [showSettings, setShowSettings] = useState(false);
  const [showToc,      setShowToc]      = useState(false);
  const [showUi,       setShowUi]       = useState(true);
  const uiTimeoutRef = useRef(null);

  const resetUiTimeout = useCallback(() => {
    setShowUi(true);
    if (uiTimeoutRef.current) clearTimeout(uiTimeoutRef.current);
    const delay = (showSettings || showToc) ? 5000 : 4000;
    uiTimeoutRef.current = setTimeout(() => {
      setShowUi(false);
      setShowSettings(false);
      setShowToc(false);
    }, delay);
  }, [showSettings, showToc]);

  useEffect(() => () => { if (uiTimeoutRef.current) clearTimeout(uiTimeoutRef.current); }, []);
  useEffect(() => { resetUiTimeout(); }, [showToc, showSettings, resetUiTimeout]);

  // Fermeture des paramètres au clic extérieur
  useEffect(() => {
    if (!showSettings) return;
    const handleOutside = (e) => {
      const panel = document.querySelector('.settings-panel');
      const btn   = document.getElementById('settings-btn');
      if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('click',      handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('click',      handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [showSettings]);

  // ── Store ──────────────────────────────────────────────────────────────────
  const {
    epubReady, currentChapter, ttsState, preferences,
    setContentEl, getSavedProgress, showToast,
  } = useReaderStore();

  // ── Chargement du contenu EPUB ─────────────────────────────────────────────
  const {
    isLoading, currentHtml, localChapterIdx, totalChapters, chapterWeights, bookMeta,
    chaptersRef, loadChapter, initBook, goNextChapter, goPrevChapter, error, setError,
  } = useEpubContent();

  // ── Synthèse vocale ────────────────────────────────────────────────────────
  const {
    play, pause, resume, stop, playFrom, seekToPhrase, playFromSelection,
    setOnPageEnd, refreshSentences,
    sentences, sentenceIdx, isPlayingRef,
    disableAutoScroll, getActiveSentenceIdx, highlightSentence,
  } = useTTS();

  // Arrêter le TTS si l'utilisateur désactive le mode audio
  useEffect(() => {
    if (!preferences.audioMode) stop();
  }, [preferences.audioMode, stop]);

  // ── Double ref : contentRef local + store ─────────────────────────────────
  const setContentRefCallback = useCallback((el) => {
    contentRef.current = el;
    setContentEl(el);
  }, [setContentEl]);

  // ── Layout (resize, fontSize, couleurs) ────────────────────────────────────
  // sharedCurrentFractionRef est le singleton de module partagé avec useChapterTransition.
  useViewerLayout({ contentRef, currentFractionRef: sharedCurrentFractionRef, currentHtml });

  // Ref partagé entre useChapterTransition et useAutoScroll.
  // Permet à handleScroll de savoir si l'auto-scroll est actif (et de ne pas
  // déclencher checkScrollTransition dans ce cas).
  const isAutoScrollingRef = useRef(false);

  // ── Transitions de chapitres ───────────────────────────────────────────────
  const {
    isTransitioningRef,
    saveProgressTimeoutRef,
    handleScroll: _handleScroll,
    handleWheel:  _handleWheel,
    handleTouchStart,
    handleTouchEnd,
    handleNextChapterManual,
    handlePrevChapterManual,
    handleGlobalSeek,
    handleBookmarkSeek,
    handleSaveBookmark,
  } = useChapterTransition({
    contentRef,
    epubContent: {
      currentHtml, localChapterIdx, totalChapters, chapterWeights,
      loadChapter, goNextChapter, goPrevChapter,
    },
    tts: {
      play, pause, stop, playFrom, seekToPhrase,
      setOnPageEnd, refreshSentences,
      sentences, sentenceIdx, isPlayingRef,
      getActiveSentenceIdx, highlightSentence,
      disableAutoScroll,
    },
    book,
    showToast,
    isAutoScrollingRef,
  });

  // Adapter handleWheel pour passer resetUiTimeout
  const handleWheel = useCallback((e) => {
    _handleWheel(e, resetUiTimeout);
  }, [_handleWheel, resetUiTimeout]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  const {
    isAutoScrolling,
    toggleAutoScroll,
    handleUserInteraction,
  } = useAutoScroll({
    contentRef,
    handleNextChapterManual,
    disableAutoScroll,
    sentenceCount: sentences.length,
    showToast,
    isTransitioningRef,
    isAutoScrollingRef,
  });

  // ── Empêcher la mise en veille de l'écran ─────────────────────────────────
  useEffect(() => {
    const shouldKeepAwake = isAutoScrolling || ttsState === 'playing';
    const manageAwake = async () => {
      try {
        if (shouldKeepAwake) {
          await KeepAwake.keepAwake();
        } else {
          await KeepAwake.allowSleep();
        }
      } catch (e) {
        console.warn('KeepAwake error:', e);
      }
    };
    manageAwake();
    
    // Cleanup on unmount
    return () => { KeepAwake.allowSleep().catch(() => {}) };
  }, [isAutoScrolling, ttsState]);

  // Wrapper handleScroll : réinitialise le timer UI + délègue
  // ⚠️ Ne pas appeler resetUiTimeout pendant l'auto-scroll ou le TTS :
  // Les événements scroll viennent du système et garderaient l'UI visible en permanence.
  const handleScroll = useCallback((e) => {
    if (!isAutoScrollingRef.current && !isPlayingRef.current) resetUiTimeout();
    _handleScroll(e);
  }, [resetUiTimeout, _handleScroll, isAutoScrollingRef, isPlayingRef]);

  // ── Initialisation du livre ────────────────────────────────────────────────
  useEffect(() => {
    if (!book?.file) return;
    const { idx: savedIdx, fraction: savedFraction, sentenceIdx: savedSentenceIdx } = getSavedProgress();
    initBook(book.file, savedIdx).then((meta) => {
      if (meta) {
        // Écrire dans les refs de module : elles seront lues par useChapterTransition
        // dès que le premier HTML de chapitre arrivera
        if (savedSentenceIdx > 0) pendingSeekSentenceIdxRef.current = savedSentenceIdx;
        if (savedFraction   > 0) pendingSeekFractionRef.current    = savedFraction;
        setTimeout(() => refreshSentences(false), 400);
      }
    });
    return () => stop();
  }, [book]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Gestionnaires divers ───────────────────────────────────────────────────
  const handleContextMenu = useCallback((e) => {
    const sel = window.getSelection();
    if (sel?.toString().trim().length > 0) {
      e.preventDefault();
      playFromSelection();
    }
  }, [playFromSelection]);

  const handleContentClick = useCallback(() => {
    if (showSettings) setShowSettings(false);
    if (showToc)      setShowToc(false);
  }, [showSettings, showToc]);

  const handlePlayPause = () => {
    if (ttsState === 'idle') {
      let targetIdx = sentenceIdx;
      const container = contentRef.current;
      if (container && sentences?.length > 0) {
        const targetY = container.scrollTop + container.clientHeight / 3;
        targetIdx = getActiveSentenceIdx(targetY);
      }
      play(targetIdx);
    } else if (ttsState === 'playing') {
      pause();
    } else if (ttsState === 'paused') {
      resume();
    }
  };

  // ── Rendu ──────────────────────────────────────────────────────────────────
  return (
    <div
      className={`reader-shell relative theme-${preferences.theme || 'dark'}`}
      onClick={resetUiTimeout}
      onTouchStart={resetUiTimeout}
      onMouseMove={resetUiTimeout}
    >
      {/* Écran d'erreur */}
      {error && (
        <div className="absolute inset-0 bg-[#070b12]/95 flex flex-col items-center justify-center p-6 text-center z-[100]">
          <div className="text-5xl mb-4">⚠️</div>
          <h3 className="text-xl font-bold text-white mb-2">Erreur de chargement</h3>
          <p className="text-sm text-[#8b949e] max-w-lg mb-6 whitespace-pre-wrap font-mono bg-black/40 p-4 rounded-lg border border-white/10 text-left overflow-auto max-h-60">
            {error}
          </p>
          <div className="flex gap-4">
            <button
              onClick={() => {
                setError(null);
                const { idx: savedIdx } = getSavedProgress();
                if (book?.file) initBook(book.file, savedIdx);
              }}
              className="btn-primary"
            >
              Réessayer
            </button>
            <button
              onClick={() => {
                setError(null);
                useReaderStore.getState().closeBook();
              }}
              className="btn-ghost"
            >
              Retour
            </button>
          </div>
        </div>
      )}

      {/* Barre de navigation supérieure */}
      <div className={`absolute top-0 left-0 right-0 z-40 transition-all duration-500 ease-in-out ${showUi || showSettings || showToc ? 'opacity-100' : 'opacity-0 pointer-events-none invisible'}`}>
        <NavigationBar
          title={bookMeta?.title || book?.title || 'Chargement…'}
          chapter={currentChapter}
          onSettings={() => {
            setShowSettings(s => !s);
            if (showToc) setShowToc(false);
          }}
          showSettings={showSettings}
          onToggleToc={() => {
            setShowToc(t => !t);
            if (showSettings) setShowSettings(false);
          }}
          showToc={showToc}
          onSaveBookmark={() => handleSaveBookmark(book)}
        />
      </div>

      {/* Panneau paramètres */}
      <div
        className={`absolute top-[60px] right-0 z-40 settings-panel ${showSettings ? 'open' : ''}`}
        onClick={(e) => { e.stopPropagation(); resetUiTimeout(); }}
      >
        <DisplaySettings />
      </div>

      {/* Panneau TOC */}
      <div
        className={`fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-all duration-300 ${showToc ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none invisible'}`}
        onClick={() => setShowToc(false)}
        onTouchStart={() => setShowToc(false)}
      >
        <div
          className={`absolute top-0 right-0 w-80 max-w-[85vw] h-full shadow-2xl transition-transform duration-300 ease-out ${showToc ? 'translate-x-0' : 'translate-x-full'}`}
          onClick={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
        >
          <TocPanel
            chapters={chaptersRef?.current || []}
            currentIdx={localChapterIdx}
            onSelectChapter={(idx) => {
              isTransitioningRef.current = true;
              if (saveProgressTimeoutRef.current) clearTimeout(saveProgressTimeoutRef.current);
              loadChapter(idx);
            }}
            onSelectBookmark={handleBookmarkSeek}
            onClose={() => setShowToc(false)}
          />
        </div>
      </div>

      {/* Zone de lecture */}
      <div className="reading-area px-0 sm:px-4">
        <div
          className="book-stage"
          onClick={() => {
            if (showSettings || showToc) {
              setShowSettings(false);
              setShowToc(false);
            }
          }}
        >
          {(!epubReady || isLoading) && (
            <div className="loading-overlay z-10">
              <div className="spinner-ring" />
              <span className="loading-emoji">📖</span>
              <p className="loading-text">Chargement du chapitre…</p>
            </div>
          )}

          <EpubHtmlContent
            currentHtml={currentHtml}
            setContentRefCallback={setContentRefCallback}
            onScroll={handleScroll}
            onWheel={handleWheel}
            handleTouchStart={handleTouchStart}
            handleTouchEnd={handleTouchEnd}
            disableAutoScroll={handleUserInteraction}
            handleNextChapterManual={handleNextChapterManual}
            handlePrevChapterManual={handlePrevChapterManual}
            onDoubleClick={playFromSelection}
            onContextMenu={handleContextMenu}
            audioMode={preferences.audioMode}
            onClick={handleContentClick}
          />
        </div>
      </div>

      {/* Contrôles audio (mode TTS uniquement) */}
      {preferences.audioMode && (
        <div className={`absolute bottom-0 left-0 right-0 z-40 transition-all duration-500 ease-in-out ${showUi || showSettings || showToc ? 'opacity-100' : 'opacity-0 pointer-events-none invisible'}`}>
          <AudioControls
            ttsState={ttsState}
            onPlayPause={handlePlayPause}
            onStop={stop}
            onSeek={(idx) => {
              if (isPlayingRef.current) playFrom(idx);
              else seekToPhrase(idx);
            }}
            onGlobalSeek={handleGlobalSeek}
            sentenceCount={sentences?.length || 0}
            sentenceIdx={sentenceIdx}
            localChapterIdx={localChapterIdx}
            totalChapters={totalChapters}
            chapterWeights={chapterWeights}
            contentRef={contentRef}
            getActiveSentenceIdx={getActiveSentenceIdx}
            cfi={`ch${localChapterIdx + 1}/${totalChapters}`}
          />
        </div>
      )}

      {/* Bouton FAB auto-scroll (lecture normale uniquement) */}
      {preferences.autoScrollEnabled && !preferences.audioMode && (
        <button
          onClick={toggleAutoScroll}
          className={`autoscroll-fab ${isAutoScrolling ? 'active' : ''} ${showUi || showSettings || showToc ? 'opacity-100' : 'opacity-0 pointer-events-none invisible'}`}
          title={isAutoScrolling ? 'Suspendre le défilement auto' : 'Lancer le défilement auto'}
          aria-label="Défilement automatique"
        >
          {isAutoScrolling ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="ml-1">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
