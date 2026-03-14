// src/components/Reader/EpubViewer.jsx
// Lecteur EPUB avec défilement continu (vertical pur)

import { useEffect, useRef, useCallback, useState } from 'react';
import { useEpubContent } from '../../hooks/useEpubContent';
import { useTTS } from '../../hooks/useTTS';
import { useReaderStore } from '../../store/readerStore';
import AudioControls from './AudioControls';
import DisplaySettings from './DisplaySettings';
import NavigationBar from './NavigationBar';

export default function EpubViewer({ book }) {
  const contentRef    = useRef(null);
  const [showSettings, setShowSettings] = useState(false);

  const {
    epubReady, currentChapter, ttsState, preferences,
    setContentEl, getSavedChapterIdx,
  } = useReaderStore();

  const {
    isLoading, currentHtml, localChapterIdx, totalChapters, bookMeta,
    initBook, goNextChapter,
  } = useEpubContent();

  const {
    play, pause, resume, stop, playFrom,
    setOnPageEnd, refreshSentences,
    sentences, sentenceIdx, isPlayingRef,
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
    else setTimeout(() => refreshSentences(true), 400);
  }, [goNextChapter, stop, refreshSentences]);

  useEffect(() => {
    setOnPageEnd(onChapterEnd);
  }, [setOnPageEnd, onChapterEnd]);

  // Détection du scroll manuel (si l'utilisateur lit sans le TTS)
  const handleScroll = (e) => {
    const el = e.target;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 20) {
      // On est arrivé en bas du chapitre manuellement
      if (!isPlayingRef.current) {
         // Optionnel : on pourrait lancer onChapterEnd() ici.
         // Mais pour éviter l'avancement accidentel, on peut obliger l'utilisateur
         // à faire un geste ou laisser le TTS gérer.
      }
    }
  };

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
              <p className="loading-text">Chargement du livre…</p>
            </div>
          )}

          <div
            ref={setContentRefCallback}
            tabIndex="-1"
            onScroll={handleScroll}
            className="reader-content focus:outline-none"
            style={{ fontSize: `${preferences.fontSize}px` }}
            dangerouslySetInnerHTML={{ __html: currentHtml }}
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
        cfi={`ch${localChapterIdx + 1}/${totalChapters}`}
      />

    </div>
  );
}
