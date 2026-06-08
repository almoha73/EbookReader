// src/hooks/useChapterTransition.js
// Gère toutes les transitions de chapitres :
//   - Scroll manuel → chapitre suivant/précédent
//   - Seek depuis un signet ou la timeline globale
//   - Initialisation du chapitre courant (fonts, images, positionnement)
//   - Suivi de la phrase active en lecture normale (sans TTS)
//   - Sauvegarde de la progression en temps réel

import { useEffect, useRef, useCallback, useState } from 'react';
import {
  resumeAutoScrollRef, onResumeAutoScrollRef,
  pendingSeekFractionRef, pendingSeekSentenceIdxRef,
  sharedCurrentFractionRef, autoScrollWasActiveRef,
} from './readerSharedRefs';
import { useReaderStore } from '../store/readerStore';

/**
 * @param {object} params
 * @param {React.RefObject} params.contentRef
 * @param {object} params.epubContent     - Retour de useEpubContent()
 * @param {object} params.tts             - Retour de useTTS()
 * @param {object} params.book            - Prop book passée à EpubViewer
 * @param {function} params.showToast     - Du store
 */
export function useChapterTransition({ contentRef, epubContent, tts, book, showToast, isAutoScrollingRef }) {
  const {
    currentHtml, localChapterIdx, totalChapters, chapterWeights,
    sentences: epubSentences, // non utilisé ici mais disponible via tts
    loadChapter, goNextChapter, goPrevChapter,
  } = epubContent;

  const {
    play, pause, stop, playFrom, seekToPhrase,
    setOnPageEnd, refreshSentences,
    sentences, sentenceIdx, isPlayingRef,
    getActiveSentenceIdx, highlightSentence,
    disableAutoScroll,
  } = tts;

  const { ttsState, addBookmark, getSavedProgress } = useReaderStore();

  // ── Refs locales ──────────────────────────────────────────────────────────
  const isTransitioningRef       = useRef(true); // true au démarrage pour bloquer les transitions accidentelles
  const wasPlayingRef            = useRef(false);
  const saveProgressTimeoutRef   = useRef(null);
  const lastActiveSentenceIdxRef = useRef(-1);
  const lastHighlightTimeRef     = useRef(0);
  // Les refs de seek et de fraction courante sont des singletons de module (voir exports ci-dessous)
  // afin d'être accessibles depuis EpubViewer.jsx et useViewerLayout sans prop-drilling.
  const currentFractionRef        = sharedCurrentFractionRef;

  // ── Synchronisation de la fraction lors du changement de chapitre ─────────
  // Technique "render-time side effect" pour éviter un useEffect avec décalage d'une frame
  const [prevChapterIdx, setPrevChapterIdx] = useState(localChapterIdx);
  if (localChapterIdx !== prevChapterIdx) {
    setPrevChapterIdx(localChapterIdx);
    currentFractionRef.current =
      pendingSeekFractionRef.current !== null ? pendingSeekFractionRef.current : 0;
  }

  // ── Navigation vers le chapitre suivant (manuel ou auto) ─────────────────
  const handleNextChapterManual = useCallback(async (e) => {
    if (e?.stopPropagation) e.stopPropagation();
    isTransitioningRef.current = true;
    if (saveProgressTimeoutRef.current) clearTimeout(saveProgressTimeoutRef.current);
    // ⚠️ Remise à 0 immédiate pour éviter que le ResizeObserver ne repositionne
    // le nouveau chapitre avec la fraction de fin du chapitre précédent (~1.0).
    sharedCurrentFractionRef.current = 0;
    stop();
    const ok = await goNextChapter();
    if (!ok) isTransitioningRef.current = false;
    return ok;
  }, [goNextChapter, stop]);

  // ── Navigation vers le chapitre précédent (manuel) ────────────────────────
  const handlePrevChapterManual = useCallback(async (e) => {
    if (e?.stopPropagation) e.stopPropagation();
    isTransitioningRef.current = true;
    if (saveProgressTimeoutRef.current) clearTimeout(saveProgressTimeoutRef.current);
    sharedCurrentFractionRef.current = 0;
    stop();
    pendingSeekFractionRef.current = 0.999; // Positionner à la fin du chapitre précédent
    const ok = await goPrevChapter();
    if (!ok) {
      isTransitioningRef.current = false;
      pendingSeekFractionRef.current = null;
    }
    return ok;
  }, [goPrevChapter, stop]);

  // ── Chargement du chapitre suivant à la fin du TTS ───────────────────────
  const onChapterEnd = useCallback(async () => {
    const ok = await goNextChapter();
    if (!ok) stop(); // Fin du livre
  }, [goNextChapter, stop]);

  useEffect(() => {
    setOnPageEnd(onChapterEnd);
  }, [setOnPageEnd, onChapterEnd]);

  // ── Initialisation et positionnement quand le HTML du chapitre change ─────
  useEffect(() => {
    if (!currentHtml || !contentRef.current) return;
    isTransitioningRef.current = true;
    const container = contentRef.current;
    container.scrollTop = 0;

    // ⚠️ CRITIQUE : remettre la fraction à 0 IMMÉDIATEMENT pour éviter que
    // le ResizeObserver (useViewerLayout) ne repositionne le scroll du nouveau
    // chapitre à la fraction de la fin du chapitre précédent (~1.0).
    // Cette remise à 0 doit précéder toute attente asynchrone (fonts, images, RAF).
    currentFractionRef.current = 0;

    let isCancelled = false;

    // Référence vers shouldResumeAutoScroll (injectée depuis useAutoScroll via callback)
    // On utilise une ref globale pour éviter une dépendance circulaire
    const resumeRef = resumeAutoScrollRef;

    const performSeek = () => {
      if (isCancelled) return;

      const isSeekingIdx  = pendingSeekSentenceIdxRef.current !== null;
      const isSeekingFrac = pendingSeekFractionRef.current !== null;
      // ⚠️ Si l'auto-scroll a demandé une reprise (resumeRef=true),
      // on NE DOIT PAS chercher une position sauvegardue.
      // On efface les refs de seek en attente pour retomber dans la branche "else".
      if (resumeRef.current && (isSeekingIdx || isSeekingFrac)) {
        pendingSeekSentenceIdxRef.current = null;
        pendingSeekFractionRef.current    = null;
      }

      const isSeeking     = pendingSeekSentenceIdxRef.current !== null
                         || pendingSeekFractionRef.current    !== null;
      const willAutoPlay  = !isSeeking && isPlayingRef.current;

      window.dbg(`3: seek=${isSeeking} resume=${resumeRef.current}`);

      const freshSentences = refreshSentences(willAutoPlay);

      if (isSeeking && freshSentences?.length > 0) {
        let targetIdx = 0;
        let fracToRestore = 0;

        if (pendingSeekSentenceIdxRef.current !== null) {
          targetIdx = pendingSeekSentenceIdxRef.current;
          fracToRestore = pendingSeekFractionRef.current || 0;
          pendingSeekSentenceIdxRef.current = null;
          pendingSeekFractionRef.current    = null;
        } else {
          fracToRestore = pendingSeekFractionRef.current || 0;
          pendingSeekFractionRef.current = null;
          targetIdx = Math.floor(fracToRestore * freshSentences.length);
        }

        const clamped = Math.max(0, Math.min(targetIdx, freshSentences.length - 1));

        setTimeout(() => {
          if (isCancelled) return;
          if (wasPlayingRef.current) {
            wasPlayingRef.current = false;
            playFrom(clamped);
          } else {
            highlightSentence(clamped, true);
            if (container) {
               const maxScroll = Math.max(1, container.scrollHeight - container.clientHeight);
               container.scrollTop = fracToRestore * maxScroll;
            }
          }
          setTimeout(() => { isTransitioningRef.current = false; }, 500);
        }, 50);

      } else {
        // Transition naturelle de chapitre, reprise auto-scroll, ou clic TOC : reset complet
        container.scrollTop = 0;
        currentFractionRef.current       = 0;
        lastActiveSentenceIdxRef.current = 0;
        autoScrollWasActiveRef.current   = false; // ← nouveau chapitre : auto-scroll pas encore démarré
        highlightSentence(0, true);

        if (resumeRef.current) {
          resumeRef.current = false;
          window.dbg('4: appel onResumeAutoScrollRef');
          if (typeof onResumeAutoScrollRef.current === 'function') {
            setTimeout(() => {
              if (!isCancelled) {
                window.dbg('5: callback OK! startAutoScroll...');
                onResumeAutoScrollRef.current();
              } else {
                window.dbg('5: isCancelled!');
              }
            }, 300);
          } else {
            window.dbg('4: callback NULL!');
          }
        }
        setTimeout(() => { isTransitioningRef.current = false; }, 500);
      }
    };

    const initChapter = async () => {
      await document.fonts.ready;
      if (isCancelled) return;

      const images = Array.from(container.querySelectorAll('img'));
      const imagePromises = images.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
          img.onload  = resolve;
          img.onerror = resolve;
        });
      });

      // Maximum 1.5s d'attente pour les images
      await Promise.race([
        Promise.all(imagePromises),
        new Promise(resolve => setTimeout(resolve, 1500)),
      ]);

      if (isCancelled) return;

      requestAnimationFrame(() => {
        setTimeout(() => {
          if (!isCancelled) performSeek();
        }, 100);
      });
    };

    initChapter();
    return () => { isCancelled = true; };
  }, [currentHtml, refreshSentences, playFrom, seekToPhrase, highlightSentence]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Détection de la transition par scroll ─────────────────────────────────
  const checkScrollTransition = useCallback(async (direction, el) => {
    if (isTransitioningRef.current || isPlayingRef.current) return;

    if (direction === 'down' && el.scrollHeight - el.scrollTop - el.clientHeight < 10) {
      isTransitioningRef.current = true;
      // ⚠️ Si l'auto-scroll était actif dans ce chapitre (même si l'utilisateur
      // l'a mis en pause involontairement), on le relève dans le chapitre suivant.
      if (autoScrollWasActiveRef.current) {
        window.dbg('checkScrollTransition: autoScrollWasActive=true → resume');
        resumeAutoScrollRef.current = true;
      }
      await handleNextChapterManual();
    } else if (direction === 'up' && el.scrollTop <= 0) {
      isTransitioningRef.current = true;
      await handlePrevChapterManual();
    }
  }, [handleNextChapterManual, handlePrevChapterManual, isPlayingRef]);

  // ── Gestionnaire de scroll ────────────────────────────────────────────
  const handleScroll = useCallback((e) => {
    if (isTransitioningRef.current) return;

    // ⚠️ Ne pas déclencher checkScrollTransition pendant l'auto-scroll :
    // les événements scroll viennent de la boucle RAF (pas de l'utilisateur).
    // La boucle RAF gère elle-même le passage au chapitre suivant.
    // Déclencher ici aussi provoquerait un double appel à handleNextChapterManual.
    if (!isAutoScrollingRef?.current) {
      checkScrollTransition('down', e.target);
      if (e.target.scrollTop === 0) checkScrollTransition('up', e.target);
    }

    // Surlignage de la phrase active (lecture normale, throttlé à 150ms)
    if (Date.now() - lastHighlightTimeRef.current > 150) {
      lastHighlightTimeRef.current = Date.now();
      if (!isPlayingRef.current) {
        const el     = e.target;
        const targetY = el.scrollTop + el.clientHeight / 3;
        const idx    = getActiveSentenceIdx(targetY);
        if (idx !== lastActiveSentenceIdxRef.current) {
          lastActiveSentenceIdxRef.current = idx;
          highlightSentence(idx, true);
        }
      }
    }

    // Sauvegarde différée de la position (500ms après arrêt du scroll)
    if (saveProgressTimeoutRef.current) clearTimeout(saveProgressTimeoutRef.current);
    saveProgressTimeoutRef.current = setTimeout(() => {
      // Ne pas mettre à jour la fraction si une transition de chapitre est en cours :
      // cela évite qu'une valeur périmée (~1.0) soit appliquée au nouveau chapitre
      // par le ResizeObserver ou lors du prochain chargement.
      if (isTransitioningRef.current) return;
      const el        = e.target;
      const newHeight = Math.max(1, el.scrollHeight - el.clientHeight);
      const fraction  = el.scrollTop / newHeight;
      currentFractionRef.current = fraction;
      useReaderStore.getState().saveCurrentPosition(fraction, lastActiveSentenceIdxRef.current);
    }, 500);
  }, [checkScrollTransition, getActiveSentenceIdx, highlightSentence, isPlayingRef]);

  // ── Gestionnaire de touch pour les limites de scroll (mobile) ─────────────
  const touchStartYRef = useRef(null);

  const handleTouchStart = useCallback((e) => {
    touchStartYRef.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e) => {
    if (touchStartYRef.current === null || !contentRef.current) return;
    const touchEndY = e.changedTouches[0].clientY;
    const deltaY = touchStartYRef.current - touchEndY; // > 0 signifie swipe vers le haut (scroll vers le bas)
    touchStartYRef.current = null;

    const el = contentRef.current;
    // Si l'utilisateur swipe alors qu'il est DÉJÀ en butée, onScroll ne se déclenche pas.
    // On force la transition si le swipe est assez grand (> 40px)
    if (deltaY > 40 && el.scrollHeight - el.scrollTop - el.clientHeight < 5) {
      checkScrollTransition('down', el);
    } else if (deltaY < -40 && el.scrollTop <= 0) {
      checkScrollTransition('up', el);
    }
  }, [checkScrollTransition]);

  // ── Gestionnaire de molette ───────────────────────────────────────────────
  const handleWheel = useCallback((e, resetUiTimeout) => {
    if (resetUiTimeout) resetUiTimeout();
    disableAutoScroll();
    if (!contentRef.current) return;
    if (e.deltaY > 0) checkScrollTransition('down', contentRef.current);
    else if (e.deltaY < 0) checkScrollTransition('up', contentRef.current);
  }, [disableAutoScroll, checkScrollTransition]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Seek depuis la timeline globale ──────────────────────────────────────
  const handleGlobalSeek = useCallback(async (percentage) => {
    const targetOffset = percentage / 100;
    let targetChapterIdx = 0;
    let targetFraction   = 0;

    if (chapterWeights?.offsets?.length > 0) {
      for (let i = 0; i < chapterWeights.offsets.length; i++) {
        const offset = chapterWeights.offsets[i];
        const weight = chapterWeights.weights[i] || 0;
        if (targetOffset >= offset && targetOffset <= offset + weight) {
          targetChapterIdx = i;
          targetFraction   = weight > 0 ? (targetOffset - offset) / weight : 0;
          break;
        }
      }
    } else if (totalChapters > 0) {
      targetChapterIdx = Math.min(
        Math.floor(targetOffset * totalChapters),
        totalChapters - 1
      );
      targetFraction = (targetOffset * totalChapters) - targetChapterIdx;
    }

    wasPlayingRef.current = isPlayingRef.current;
    stop();
    isTransitioningRef.current = true;

    if (targetChapterIdx !== localChapterIdx) {
      pendingSeekFractionRef.current = targetFraction;
      await loadChapter(targetChapterIdx);
    } else {
      const idx     = Math.floor(targetFraction * sentences.length);
      const clamped = Math.max(0, Math.min(idx, sentences.length - 1));
      if (wasPlayingRef.current) {
        wasPlayingRef.current = false;
        playFrom(clamped);
      } else {
        seekToPhrase(clamped);
      }
      setTimeout(() => { isTransitioningRef.current = false; }, 500);
    }
  }, [chapterWeights, totalChapters, localChapterIdx, isPlayingRef, stop, loadChapter, sentences.length, playFrom, seekToPhrase]);

  // ── Seek depuis un signet ─────────────────────────────────────────────────
  const handleBookmarkSeek = useCallback(async (bookmark) => {
    if (!bookmark) return;

    wasPlayingRef.current = isPlayingRef.current;
    if (saveProgressTimeoutRef.current) clearTimeout(saveProgressTimeoutRef.current);
    stop();
    isTransitioningRef.current = true;

    if (bookmark.chapterIdx !== localChapterIdx) {
      pendingSeekSentenceIdxRef.current = bookmark.sentenceIdx || 0;
      pendingSeekFractionRef.current    = bookmark.chapterFraction || 0;
      await loadChapter(bookmark.chapterIdx);
    } else {
      currentFractionRef.current = bookmark.chapterFraction || 0;
      const clamped = Math.max(0, Math.min(bookmark.sentenceIdx || 0, sentences.length - 1));
      if (wasPlayingRef.current) {
        wasPlayingRef.current = false;
        playFrom(clamped);
      } else {
        highlightSentence(clamped, true);
        const container = contentRef.current || document.querySelector('.reader-content');
        if (container) {
           const maxScroll = Math.max(1, container.scrollHeight - container.clientHeight);
           container.scrollTop = (bookmark.chapterFraction || 0) * maxScroll;
        }
      }
      setTimeout(() => { isTransitioningRef.current = false; }, 500);
    }
  }, [localChapterIdx, isPlayingRef, stop, loadChapter, sentences.length, playFrom, seekToPhrase]);

  // ── Sauvegarde d'un signet ────────────────────────────────────────────────
  const handleSaveBookmark = useCallback((bookRef) => {
    if (!bookRef) return;

    let targetIdx = sentenceIdx;
    let fraction  = 0;

    const container = contentRef.current || document.querySelector('.reader-content');
    if (container) {
      const maxScroll = Math.max(1, container.scrollHeight - container.clientHeight);
      fraction = maxScroll > 0 ? container.scrollTop / maxScroll : 0;

      if (ttsState !== 'playing' && sentences?.length > 0) {
        targetIdx = getActiveSentenceIdx(container.scrollTop + container.clientHeight / 3);
      }
    }

    const chapterProgressFraction =
      (ttsState === 'playing' && sentences?.length > 0)
        ? targetIdx / sentences.length
        : fraction;

    let rawProgress = 0;
    if (chapterWeights?.offsets?.length > localChapterIdx) {
      const offset = chapterWeights.offsets[localChapterIdx];
      const weight = chapterWeights.weights[localChapterIdx] || 0;
      rawProgress  = (offset + chapterProgressFraction * weight) * 100;
    } else {
      rawProgress = totalChapters > 0
        ? ((localChapterIdx + chapterProgressFraction) / totalChapters) * 100
        : 0;
    }

    const totalProgress = Math.min(100, Math.max(0, rawProgress));

    addBookmark({
      id:              Date.now(),
      chapterIdx:      localChapterIdx,
      progress:        totalProgress,
      sentenceIdx:     targetIdx,
      chapterFraction: fraction,
      timestamp:       Date.now(),
    });

    showToast(`🔖 Signet sauvegardé (${totalProgress.toFixed(1)}%)`);
  }, [sentenceIdx, ttsState, sentences, chapterWeights, localChapterIdx, totalChapters,
      addBookmark, showToast, getActiveSentenceIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isTransitioningRef,
    saveProgressTimeoutRef,
    currentFractionRef,
    lastActiveSentenceIdxRef,
    lastHighlightTimeRef,
    touchStartYRef,
    handleScroll,
    handleWheel,
    handleTouchStart,
    handleTouchEnd,
    handleNextChapterManual,
    handlePrevChapterManual,
    handleGlobalSeek,
    handleBookmarkSeek,
    handleSaveBookmark,
  };
}
