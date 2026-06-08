// src/hooks/useViewerLayout.js
// Gère le redimensionnement (ResizeObserver), la mise à l'échelle de la police,
// et la variable CSS de couleur de surligna ge.
// Ce hook est purement à effets de bord : il ne retourne rien.

import { useEffect, useRef } from 'react';
import { useReaderStore } from '../store/readerStore';

/**
 * @param {React.RefObject} contentRef      - Ref du conteneur scrollable (.reader-content)
 * @param {React.RefObject} currentFractionRef - Fraction de scroll courant (partagée avec useChapterTransition)
 * @param {string} currentHtml              - Le HTML du chapitre courant (déclencheur de re-observe)
 */
export function useViewerLayout({ contentRef, currentFractionRef, currentHtml }) {
  const { preferences } = useReaderStore();

  const lastWidthRef    = useRef(0);
  const lastHeightRef   = useRef(0);
  const lastFontSizeRef = useRef(0);

  // ── ResizeObserver : conserve la position de lecture lors d'un redimensionnement ──
  useEffect(() => {
    if (!contentRef.current) return;
    const container   = contentRef.current;
    const innerContent = container.firstElementChild;

    // Réinitialiser les dimensions de référence à chaque nouveau chapitre (ou changement de police).
    // Cela force la branche "première observation" du ResizeObserver qui enregistre les
    // dimensions initiales SANS appliquer de fraction de scroll — évite que la fraction
    // résiduelle du chapitre précédent (~1.0) soit appliquée au nouveau chapitre.
    lastWidthRef.current    = 0;
    lastHeightRef.current   = 0;
    lastFontSizeRef.current = 0;

    const resizeObserver = new ResizeObserver(() => {
      // Si du texte TTS est surligné, on centre la vue sur lui
      const mark = container.querySelector('mark.tts-highlight');
      if (mark) {
        const targetScroll = Math.max(0, mark.offsetTop - container.clientHeight / 2);
        container.scrollTop = targetScroll;
        return;
      }

      const currentWidth    = container.clientWidth;
      const currentHeight   = container.scrollHeight;
      const currentFontSize = preferences.fontSize;

      if (lastWidthRef.current === 0) {
        // Première observation : initialisation sans défilement
        lastWidthRef.current    = currentWidth;
        lastHeightRef.current   = currentHeight;
        lastFontSizeRef.current = currentFontSize;
      } else if (
        currentWidth    !== lastWidthRef.current    ||
        currentFontSize !== lastFontSizeRef.current
      ) {
        // Taille (largeur) ou police changée : on repositionne à la même fraction.
        // On ignore les changements de hauteur seuls (ex: apparition de la barre de navigation,
        // ou ajout du padding audio-mode) car cela ne change pas la position absolue du texte depuis le haut.
        const newMaxScroll = Math.max(1, currentHeight - container.clientHeight);
        container.scrollTop = currentFractionRef.current * newMaxScroll;

        lastWidthRef.current    = currentWidth;
        lastHeightRef.current   = currentHeight;
        lastFontSizeRef.current = currentFontSize;
      }
    });

    resizeObserver.observe(container);
    if (innerContent) resizeObserver.observe(innerContent);

    return () => resizeObserver.disconnect();
  }, [preferences.fontSize, currentHtml]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mise à l'échelle CSS de la taille de police ──────────────────────────
  useEffect(() => {
    if (!contentRef.current) return;
    const container = contentRef.current;
    const oldScroll  = container.scrollTop;
    const oldHeight  = Math.max(1, container.scrollHeight - container.clientHeight);
    const fraction   = oldScroll / oldHeight;

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
  }, [preferences.fontSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Variable CSS de couleur de surlignage ────────────────────────────────
  useEffect(() => {
    document.documentElement.style.setProperty('--highlight-color', preferences.highlightColor);
  }, [preferences.highlightColor]);
}
