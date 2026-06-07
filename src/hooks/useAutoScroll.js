// src/hooks/useAutoScroll.js
// Moteur de défilement automatique (auto-scroll).
// Gère :
//   - La boucle requestAnimationFrame de défilement
//   - La pause / reprise
//   - L'enchaînement automatique des chapitres
//   - Les chapitres trop courts pour avoir une barre de défilement :
//     dans ce cas, on simule un temps de lecture (phrases × 3s) avant de passer au suivant.

import { useState, useRef, useCallback, useEffect } from 'react';
import { useReaderStore } from '../store/readerStore';
import { resumeAutoScrollRef, onResumeAutoScrollRef, autoScrollWasActiveRef } from './readerSharedRefs';

/**
 * @param {object} params
 * @param {React.RefObject}  params.contentRef             - Conteneur scrollable
 * @param {function}         params.handleNextChapterManual - Navigue au chapitre suivant
 * @param {function}         params.disableAutoScroll       - Du hook TTS (stoppe le TTS)
 * @param {number}           params.sentenceCount           - Nombre de phrases du chapitre courant
 * @param {function}         params.showToast               - Affiche un toast
 */
export function useAutoScroll({
  contentRef,
  handleNextChapterManual,
  disableAutoScroll,
  sentenceCount,
  showToast,
  isTransitioningRef, // ← ref partagé de useChapterTransition
  isAutoScrollingRef, // ← ref partagé créé dans EpubViewer
}) {
  const [isAutoScrolling, setIsAutoScrolling] = useState(false);
  // isAutoScrollingRef est passé depuis EpubViewer (partagé avec useChapterTransition)
  const autoScrollFrameRef  = useRef(null);
  const lastTimeRef         = useRef(null);
  const accumulatedScrollRef = useRef(0);
  const shortChapterTimerRef = useRef(null); // Timer pour les chapitres courts

  // ── Pause du défilement ───────────────────────────────────────────────────
  const pauseAutoScroll = useCallback((silent = false) => {
    if (!isAutoScrollingRef.current) return;
    isAutoScrollingRef.current = false;
    setIsAutoScrolling(false);

    // Si la pause est due à une action utilisateur (silent=false), on annule la reprise automatique
    if (!silent) {
      autoScrollWasActiveRef.current = false;
    }

    if (autoScrollFrameRef.current) {
      cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
    if (shortChapterTimerRef.current) {
      clearTimeout(shortChapterTimerRef.current);
      shortChapterTimerRef.current = null;
    }
    if (!silent) showToast('⏸️ Défilement suspendu');
  }, [showToast]);

  // ── Démarrage du défilement ───────────────────────────────────────────────
  const startAutoScroll = useCallback((forceStartAtZero = false) => {
    window.dbg(`A: isActive=${isAutoScrollingRef.current}`);
    if (isAutoScrollingRef.current) return;

    // Si le TTS joue, on l'arrête d'abord
    const { ttsState } = useReaderStore.getState();
    if (ttsState === 'playing') {
      // On arrête le TTS (disableAutoScroll coupe la lecture TTS en interne)
      disableAutoScroll();
    }

    const container = contentRef.current;
    if (!container) return;

    isAutoScrollingRef.current = true;
    setIsAutoScrolling(true);
    lastTimeRef.current = performance.now();
    autoScrollWasActiveRef.current = true; // ← marque le chapitre courant comme "auto-scroll actif"

    if (forceStartAtZero) {
      container.scrollTop = 0;
      accumulatedScrollRef.current = 0;
    } else {
      accumulatedScrollRef.current = container.scrollTop;
    }

    const maxScroll = container.scrollHeight - container.clientHeight;
    window.dbg(`B: maxScroll=${Math.round(maxScroll)} h=${container.scrollHeight}`);

    // ── Cas : chapitre trop court pour avoir une scrollbar ───────────────
    if (maxScroll <= 2) {
      // On simule un temps de lecture proportionnel au nombre de phrases
      // Durée = phrases × 3 secondes (minimum 5s, maximum 30s)
      const nbPhrases  = sentenceCount || 1;
      const delayMs    = Math.min(30000, Math.max(5000, nbPhrases * 3000));

      showToast('▶️ Défilement automatique (chapitre court…)');

      shortChapterTimerRef.current = setTimeout(async () => {
        if (!isAutoScrollingRef.current) return;
        pauseAutoScroll(true);
        resumeAutoScrollRef.current = true;
        const ok = await handleNextChapterManual();
        if (!ok) {
          resumeAutoScrollRef.current = false;
          showToast('🎉 Fin du livre');
        } else {
          showToast('📖 Chapitre suivant…');
        }
      }, delayMs);

      return; // Pas de boucle RAF pour les chapitres courts
    }

    window.dbg('C: RAF loop démarre');

    // ── Boucle principale (chapitres normaux) ────────────────────────────
    const loop = (time) => {
      if (!isAutoScrollingRef.current) return;

      const containerEl = contentRef.current;
      if (containerEl) {
        const speed          = useReaderStore.getState().preferences.autoScrollSpeed || 30;
        const deltaTime      = (time - lastTimeRef.current) / 1000;
        const pxToScroll     = speed * deltaTime;

        accumulatedScrollRef.current += pxToScroll;

        const previousScrollTop = containerEl.scrollTop;
        containerEl.scrollTop   = Math.round(accumulatedScrollRef.current);

        const currentMaxScroll = containerEl.scrollHeight - containerEl.clientHeight;
        // Tolérance plus large (2px) pour les problèmes de sous-pixels ou de capping navigateur
        const atBottom = containerEl.scrollTop >= currentMaxScroll - 2
                      || (containerEl.scrollTop === previousScrollTop && containerEl.scrollTop >= currentMaxScroll - 10);

        if (atBottom) {
          window.dbg(`1: atBottom! scrollTop=${Math.round(containerEl.scrollTop)} maxScroll=${Math.round(currentMaxScroll)}`);
          pauseAutoScroll(true);
          resumeAutoScrollRef.current = true;
          handleNextChapterManual().then((ok) => {
            window.dbg(`2: chap suivant ok=${ok}`);
            if (!ok) {
              resumeAutoScrollRef.current = false;
              showToast('🎉 Fin du livre');
            } else {
              showToast('📖 Chapitre suivant…');
            }
          });
          return; // Sortie de la boucle
        }
      }

      lastTimeRef.current = time;
      autoScrollFrameRef.current = requestAnimationFrame(loop);
    };

    autoScrollFrameRef.current = requestAnimationFrame(loop);
    showToast('▶️ Défilement automatique démarré');
  }, [contentRef, handleNextChapterManual, disableAutoScroll, sentenceCount, showToast, pauseAutoScroll, isTransitioningRef]);

  // ── Bascule marche/arrêt ──────────────────────────────────────────────────
  const toggleAutoScroll = useCallback(() => {
    if (isAutoScrolling) pauseAutoScroll();
    else startAutoScroll(false);
  }, [isAutoScrolling, startAutoScroll, pauseAutoScroll]);

  // ── Interaction utilisateur : stoppe l'auto-scroll ───────────────────────
  const handleUserInteraction = useCallback(() => {
    disableAutoScroll(); // Coupe aussi le TTS interne
    if (isAutoScrollingRef.current) pauseAutoScroll();
  }, [disableAutoScroll, pauseAutoScroll]);

  // ── Enregistrement du callback de reprise (consommé par useChapterTransition) ──
  // Quand un chapitre est chargé et que shouldResumeAutoScroll est true,
  // useChapterTransition appellera onResumeAutoScrollRef.current()
  useEffect(() => {
    onResumeAutoScrollRef.current = () => startAutoScroll(true);
    return () => { onResumeAutoScrollRef.current = null; };
  }, [startAutoScroll]);

  // ── Pause automatique si le TTS démarre ──────────────────────────────────
  const { ttsState, preferences } = useReaderStore();
  useEffect(() => {
    if (ttsState === 'playing' || preferences.audioMode) {
      pauseAutoScroll(true);
    }
  }, [ttsState, preferences.audioMode, pauseAutoScroll]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (autoScrollFrameRef.current) cancelAnimationFrame(autoScrollFrameRef.current);
      if (shortChapterTimerRef.current) clearTimeout(shortChapterTimerRef.current);
    };
  }, []);

  return {
    isAutoScrolling,
    isAutoScrollingRef,
    startAutoScroll,
    pauseAutoScroll,
    toggleAutoScroll,
    handleUserInteraction,
  };
}
