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
const EpubHtmlContent = memo(({ currentHtml, setContentRefCallback, onScroll, onWheel, disableAutoScroll, handleNextChapterManual, handlePrevChapterManual }) => {
  return (
    <div
      ref={setContentRefCallback}
      tabIndex="-1"
      onScroll={onScroll}
      onWheel={onWheel}
      onTouchMove={disableAutoScroll}
      onMouseDown={disableAutoScroll}
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
  const wasPlayingRef = useRef(false);

  const {
    epubReady, currentChapter, ttsState, preferences,
    setContentEl, getSavedChapterIdx,
  } = useReaderStore();

  const {
    isLoading, currentHtml, localChapterIdx, totalChapters, chapterWeights, bookMeta,
    chaptersRef, loadChapter, initBook, goNextChapter, goPrevChapter,
  } = useEpubContent();

  const {
    play, pause, resume, stop, playFrom, seekToPhrase,
    setOnPageEnd, refreshSentences,
    sentences, sentenceIdx, isPlayingRef,
    disableAutoScroll,
  } = useTTS();

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
      const isSeeking = pendingSeekFractionRef.current !== null;
      const willAutoPlay = !isSeeking && isPlayingRef.current;
      
      const freshSentences = refreshSentences(willAutoPlay);

      if (isSeeking && freshSentences?.length > 0) {
        const targetFrac = pendingSeekFractionRef.current;
        pendingSeekFractionRef.current = null;
        
        const targetSentenceIdx = Math.floor(targetFrac * freshSentences.length);
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
      contentRef.current.style.fontSize = `${preferences.fontSize}px`;
      // No longer calling refreshSentences here, allowing the DOM to retain the highlight markers
      // and preventing the sentenceIdx from resetting to 0.
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
    if (ttsState === 'idle')    play(0);
    else if (ttsState === 'playing') pause();
    else if (ttsState === 'paused')  resume();
  };

  return (
    <div className="reader-shell">

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
