// src/components/Reader/EpubViewer.jsx
// Lecteur EPUB avec défilement continu (vertical pur)

import { useEffect, useRef, useCallback, useState, memo } from 'react';
import { useEpubContent } from '../../hooks/useEpubContent';
import { useTTS } from '../../hooks/useTTS';
import { useReaderStore } from '../../store/readerStore';
import AudioControls from './AudioControls';
import DisplaySettings from './DisplaySettings';
import NavigationBar from './NavigationBar';
import TocPanel from './TocPanel';

// ── Conteneur HTML Isolé (évite les re-renders et la perte des <mark>) ────
// Enveloppé dans React.memo pour ne se re-rendre QUE si le HTML ou la taille de police changent.
// Empêche isPlaying ou sentenceIdx de déclencher un redessin destructeur.
const EpubHtmlContent = memo(({ currentHtml, setContentRefCallback, onScroll, onWheel, disableAutoScroll, handleNextChapterManual, handlePrevChapterManual, onDoubleClick, onContextMenu }) => {
  return (
    <div
      ref={setContentRefCallback}
      tabIndex="-1"
      onScroll={onScroll}
      onWheel={onWheel}
      onTouchMove={disableAutoScroll}
      onMouseDown={disableAutoScroll}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Space'].includes(e.code)) {
          disableAutoScroll();
        }
        if (e.key === 'ArrowRight') handleNextChapterManual();
        if (e.key === 'ArrowLeft') handlePrevChapterManual();
      }}
      className="reader-content focus:outline-none"
      dangerouslySetInnerHTML={{ __html: currentHtml }}
    />
  );
});

export default function EpubViewer({ book }) {
  const contentRef    = useRef(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showToc,      setShowToc]      = useState(false);
  
  const pendingSeekFractionRef = useRef(null);
  const pendingSeekSentenceIdxRef = useRef(null);
  const wasPlayingRef = useRef(false);

  const {
    epubReady, currentChapter, ttsState, preferences,
    setContentEl, getSavedChapterIdx,
  } = useReaderStore();

  const {
    isLoading, currentHtml, localChapterIdx, totalChapters, chapterWeights, bookMeta,
    chaptersRef, loadChapter, initBook, goNextChapter, goPrevChapter, error, setError,
  } = useEpubContent();

  const {
    play, pause, resume, stop, playFrom, seekToPhrase, playFromSelection,
    setOnPageEnd, refreshSentences,
    sentences, sentenceIdx, isPlayingRef,
    disableAutoScroll,
  } = useTTS();

  const handleContextMenu = useCallback((e) => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      e.preventDefault();
      playFromSelection();
    }
  }, [playFromSelection]);

  const setContentRefCallback = useCallback((el) => {
    contentRef.current = el;
    setContentEl(el);
  }, [setContentEl]);

  // ── Initialisation du livre ────────────────────────────────────────────
  useEffect(() => {
    if (!book?.file) return;
    const savedIdx = getSavedChapterIdx();
    initBook(book.file, savedIdx).then((meta) => {
      if (meta) {
        setTimeout(() => refreshSentences(false), 400);
      }
    });
    return () => stop();
  }, [book]);

  // ── Quand le chapitre change (nouveau HTML) ────────────────────────────
  useEffect(() => {
    if (!currentHtml || !contentRef.current) return;
    contentRef.current.scrollTop = 0;
    setTimeout(() => {
      const isSeekingFrac = pendingSeekFractionRef.current !== null;
      const isSeekingIdx = pendingSeekSentenceIdxRef.current !== null;
      const isSeeking = isSeekingFrac || isSeekingIdx;
      const willAutoPlay = !isSeeking && isPlayingRef.current;
      
      const freshSentences = refreshSentences(willAutoPlay);

      if (isSeeking && freshSentences?.length > 0) {
        let targetSentenceIdx = 0;
        
        if (isSeekingFrac) {
            const targetFrac = pendingSeekFractionRef.current;
            pendingSeekFractionRef.current = null;
            targetSentenceIdx = Math.floor(targetFrac * freshSentences.length);
        } else if (isSeekingIdx) {
            targetSentenceIdx = pendingSeekSentenceIdxRef.current;
            pendingSeekSentenceIdxRef.current = null;
        }
        
        const clampedIdx = Math.max(0, Math.min(targetSentenceIdx, freshSentences.length - 1));
        
        setTimeout(() => {
            if (wasPlayingRef.current) {
                wasPlayingRef.current = false;
                playFrom(clampedIdx);
            } else {
                seekToPhrase(clampedIdx);
            }
        }, 50);
      }
    }, 300);
  }, [currentHtml, refreshSentences, playFrom, seekToPhrase]);

  // ── Mise à l'échelle CSS ─────────────────────────────────────────────
  useEffect(() => {
    if (contentRef.current) {
      const container = contentRef.current;
      const oldScroll = container.scrollTop;
      const oldHeight = Math.max(1, container.scrollHeight - container.clientHeight);
      const fraction = oldScroll / oldHeight;

      container.style.fontSize = `${preferences.fontSize}px`;

      setTimeout(() => {
         const mark = container.querySelector('mark.tts-highlight');
         if (mark) {
             const targetScroll = Math.max(0, mark.offsetTop - container.clientHeight / 2);
             container.scrollTop = targetScroll;
         } else {
             const newHeight = Math.max(1, container.scrollHeight - container.clientHeight);
             container.scrollTop = fraction * newHeight;
         }
      }, 50);
    }
  }, [preferences.fontSize]);

  useEffect(() => {
    document.documentElement.style.setProperty('--highlight-color', preferences.highlightColor);
  }, [preferences.highlightColor]);

  // ── Recherche Globale depuis la Timeline ────────────────────────────────
  const handleGlobalSeek = useCallback(async (percentage) => {
    const targetOffset = percentage / 100;
    let targetChapterIdx = 0;
    let targetFraction = 0;
    
    if (chapterWeights && chapterWeights.offsets.length > 0) {
      for (let i = 0; i < chapterWeights.offsets.length; i++) {
        const offset = chapterWeights.offsets[i];
        const weight = chapterWeights.weights[i] || 0;
        if (targetOffset >= offset && targetOffset <= offset + weight) {
          targetChapterIdx = i;
          targetFraction = weight > 0 ? (targetOffset - offset) / weight : 0;
          break;
        }
      }
    } else {
      if (totalChapters > 0) {
        targetChapterIdx = Math.floor(targetOffset * totalChapters);
        if (targetChapterIdx >= totalChapters) targetChapterIdx = totalChapters - 1;
        targetFraction = (targetOffset * totalChapters) - targetChapterIdx;
      }
    }

    wasPlayingRef.current = isPlayingRef.current;
    if (isPlayingRef.current) {
      window.speechSynthesis?.cancel();
    }
    stop();

    if (targetChapterIdx !== localChapterIdx) {
      pendingSeekFractionRef.current = targetFraction;
      await loadChapter(targetChapterIdx);
    } else {
      const targetSentenceIdx = Math.floor(targetFraction * sentences.length);
      const clampedIdx = Math.max(0, Math.min(targetSentenceIdx, sentences.length - 1));
      if (wasPlayingRef.current) {
          wasPlayingRef.current = false;
          playFrom(clampedIdx);
      } else {
          seekToPhrase(clampedIdx);
      }
    }
  }, [chapterWeights, totalChapters, localChapterIdx, isPlayingRef, stop, loadChapter, sentences.length, playFrom, seekToPhrase]);

  // ── Recherche vers un signet ───────────────────────────────────────────
  const handleBookmarkSeek = useCallback(async (bookmark) => {
    if (!bookmark) return;
    
    wasPlayingRef.current = isPlayingRef.current;
    if (isPlayingRef.current) {
      window.speechSynthesis?.cancel();
    }
    stop();

    if (bookmark.chapterIdx !== localChapterIdx) {
      pendingSeekSentenceIdxRef.current = bookmark.sentenceIdx || 0;
      await loadChapter(bookmark.chapterIdx);
    } else {
      const clampedIdx = Math.max(0, Math.min(bookmark.sentenceIdx || 0, sentences.length - 1));
      if (wasPlayingRef.current) {
          wasPlayingRef.current = false;
          playFrom(clampedIdx);
      } else {
          seekToPhrase(clampedIdx);
      }
    }
  }, [localChapterIdx, isPlayingRef, stop, loadChapter, sentences.length, playFrom, seekToPhrase]);

  // ── Auto-chargement du chapitre suivant ────────────────────────────────
  const onChapterEnd = useCallback(async () => {
    window.speechSynthesis?.cancel();
    const ok = await goNextChapter();
    if (!ok) stop(); // Fin du livre
    else setTimeout(() => refreshSentences(true), 400); // true = autoPlay
  }, [goNextChapter, stop, refreshSentences]);

  useEffect(() => {
    setOnPageEnd(onChapterEnd);
  }, [setOnPageEnd, onChapterEnd]);

  const handleNextChapterManual = useCallback(async (e) => {
    if (e) e.stopPropagation();
    window.speechSynthesis?.cancel();
    stop();
    await goNextChapter();
  }, [goNextChapter, stop]);

  const handlePrevChapterManual = useCallback(async (e) => {
    if (e) e.stopPropagation();
    window.speechSynthesis?.cancel();
    stop();
    await goPrevChapter();
  }, [goPrevChapter, stop]);

  // Détection du scroll manuel (si l'utilisateur lit sans le TTS)
  // Permet de passer de chapitre en chapitre juste en scrollant !
  const isTransitioningRef = useRef(false);

  const checkScrollTransition = useCallback(async (direction, el) => {
    if (isTransitioningRef.current || isPlayingRef.current) return;

    if (direction === 'down' && el.scrollHeight - el.scrollTop - el.clientHeight < 10) {
      isTransitioningRef.current = true;
      await handleNextChapterManual();
      setTimeout(() => { isTransitioningRef.current = false; }, 800);
    } else if (direction === 'up' && el.scrollTop <= 0) {
      isTransitioningRef.current = true;
      await handlePrevChapterManual();
      setTimeout(() => { isTransitioningRef.current = false; }, 800);
    }
  }, [handleNextChapterManual, handlePrevChapterManual, isPlayingRef]);

  const handleScroll = useCallback((e) => {
    // Le onScroll natif détecte surtout le scroll vers le bas car on force le scrollTop au chapitre précédent.
    checkScrollTransition('down', e.target);
    if (e.target.scrollTop === 0) checkScrollTransition('up', e.target);
  }, [checkScrollTransition]);

  const handleWheel = useCallback((e) => {
    disableAutoScroll();
    if (!contentRef.current) return;
    // Si la page est trop courte pour scroller, ou qu'on force la molette aux extrémités:
    if (e.deltaY > 0) checkScrollTransition('down', contentRef.current);
    else if (e.deltaY < 0) checkScrollTransition('up', contentRef.current);
  }, [disableAutoScroll, checkScrollTransition]);

  const handlePlayPause = () => {
    if (ttsState === 'idle')         play(sentenceIdx);
    else if (ttsState === 'playing') pause();
    else if (ttsState === 'paused')  resume();
  };

  return (
    <div className="reader-shell">

      {error && (
        <div className="absolute inset-0 bg-[#070b12]/95 flex flex-col items-center justify-center p-6 text-center z-[100]" style={{ zIndex: 100 }}>
          <div className="text-5xl mb-4">⚠️</div>
          <h3 className="text-xl font-bold text-white mb-2">Erreur de chargement</h3>
          <p className="text-sm text-[#8b949e] max-w-lg mb-6 whitespace-pre-wrap font-mono bg-black/40 p-4 rounded-lg border border-white/10 text-left overflow-auto max-h-60">
            {error}
          </p>
          <div className="flex gap-4">
            <button
              onClick={() => {
                setError(null);
                const savedIdx = getSavedChapterIdx();
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
      />

      <div className={`settings-panel ${showSettings ? 'open' : ''}`}>
        <DisplaySettings />
      </div>

      {/* Panneau latéral TOC */}
      <div 
        className={`fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${showToc ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setShowToc(false)}
      >
        <div 
          className={`absolute top-0 right-0 w-80 max-w-[85vw] h-full shadow-2xl transition-transform duration-300 ease-out ${showToc ? 'translate-x-0' : 'translate-x-full'}`}
          onClick={e => e.stopPropagation()}
        >
          <TocPanel 
            chapters={chaptersRef?.current || []}
            currentIdx={localChapterIdx}
            onSelectChapter={(idx) => {
              loadChapter(idx);
            }}
            onSelectBookmark={handleBookmarkSeek}
            onClose={() => setShowToc(false)}
          />
        </div>
      </div>

      <div className="reading-area px-0 sm:px-4">

        <div className="book-stage">
          {(!epubReady || isLoading) && (
            <div className="loading-overlay z-10">
              <div className="spinner-ring"/>
              <span className="loading-emoji">📖</span>
              <p className="loading-text">Chargement du chapitre…</p>
            </div>
          )}

          <EpubHtmlContent
            currentHtml={currentHtml}
            setContentRefCallback={setContentRefCallback}
            onScroll={handleScroll}
            onWheel={handleWheel}
            disableAutoScroll={disableAutoScroll}
            handleNextChapterManual={handleNextChapterManual}
            handlePrevChapterManual={handlePrevChapterManual}
            onDoubleClick={playFromSelection}
            onContextMenu={handleContextMenu}
          />
        </div>

      </div>

      <AudioControls
        ttsState={ttsState}
        onPlayPause={handlePlayPause}
        onStop={stop}
        onSeek={playFrom}
        onGlobalSeek={handleGlobalSeek}
        sentenceCount={sentences.length}
        sentenceIdx={sentenceIdx}
        localChapterIdx={localChapterIdx}
        totalChapters={totalChapters}
        chapterWeights={chapterWeights}
        cfi={`ch${localChapterIdx + 1}/${totalChapters}`}
      />

    </div>
  );
}
