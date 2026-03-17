// src/components/Reader/EpubViewer.jsx
// Lecteur EPUB avec défilement continu (vertical pur)

import { useEffect, useRef, useCallback, useState, memo } from 'react';
import { useEpubContent } from '../../hooks/useEpubContent';
import { useTTS } from '../../hooks/useTTS';
import { useReaderStore } from '../../store/readerStore';
import AudioControls from './AudioControls';
import DisplaySettings from './DisplaySettings';
import NavigationBar from './NavigationBar';

// ── Conteneur HTML Isolé (évite les re-renders et la perte des <mark>) ────
// Enveloppé dans React.memo pour ne se re-rendre QUE si le HTML ou la taille de police changent.
// Empêche isPlaying ou sentenceIdx de déclencher un redessin destructeur.
const EpubHtmlContent = memo(({ currentHtml, fontSize, setContentRefCallback, onScroll, disableAutoScroll, handleNextChapterManual, handlePrevChapterManual }) => {
  return (
    <div
      ref={setContentRefCallback}
      tabIndex="-1"
      onScroll={onScroll}
      onWheel={disableAutoScroll}
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
      style={{ fontSize: `${fontSize}px` }}
      dangerouslySetInnerHTML={{ __html: currentHtml }}
    />
  );
});

export default function EpubViewer({ book }) {
  const contentRef    = useRef(null);
  const [showSettings, setShowSettings] = useState(false);

  const {
    epubReady, currentChapter, ttsState, preferences,
    setContentEl, getSavedChapterIdx,
  } = useReaderStore();

  const {
    isLoading, currentHtml, localChapterIdx, totalChapters, bookMeta,
    initBook, goNextChapter, goPrevChapter,
  } = useEpubContent();

  const {
    play, pause, resume, stop, playFrom,
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
      refreshSentences(isPlayingRef.current);
    }, 300);
  }, [currentHtml]);

  // ── Mise à l'échelle CSS ─────────────────────────────────────────────
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.style.fontSize = `${preferences.fontSize}px`;
      setTimeout(() => refreshSentences(isPlayingRef.current), 200);
    }
  }, [preferences.fontSize]);

  useEffect(() => {
    document.documentElement.style.setProperty('--highlight-color', preferences.highlightColor);
  }, [preferences.highlightColor]);

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

  const handleScroll = useCallback(async (e) => {
    const el = e.target;
    if (isTransitioningRef.current) return;

    // Si on tire vers le bas (défilement continu vers le chapitre suivant)
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 10) {
      if (!isPlayingRef.current) {
        isTransitioningRef.current = true;
        await handleNextChapterManual();
        setTimeout(() => { isTransitioningRef.current = false; }, 800);
      }
    }
  }, [handleNextChapterManual, isPlayingRef]);

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
        onSettings={() => setShowSettings(s => !s)}
        showSettings={showSettings}
      />

      <div className={`settings-panel ${showSettings ? 'open' : ''}`}>
        <DisplaySettings />
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
            fontSize={preferences.fontSize}
            setContentRefCallback={setContentRefCallback}
            onScroll={handleScroll}
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
        sentenceCount={sentences.length}
        sentenceIdx={sentenceIdx}
        localChapterIdx={localChapterIdx}
        totalChapters={totalChapters}
        cfi={`ch${localChapterIdx + 1}/${totalChapters}`}
      />

    </div>
  );
}
