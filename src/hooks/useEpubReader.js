// src/hooks/useEpubReader.js
// Intégration epub.js: chargement, rendu, navigation, CFI, thèmes

import { useCallback, useRef, useEffect } from 'react';
import ePub from 'epubjs';
import { useReaderStore } from '../store/readerStore';

export function useEpubReader({ containerRef, onPageChange }) {
  const store = useReaderStore();

  // Toutes les refs sont stables et ne causent pas de re-renders
  const bookRef = useRef(null);
  const renditionRef = useRef(null);
  const isNavigatingRef = useRef(false);
  const onPageChangeRef = useRef(onPageChange);
  const storeRef = useRef(store);

  // Mise à jour des refs à chaque render (sans déclencher d'effets)
  useEffect(() => { onPageChangeRef.current = onPageChange; });
  useEffect(() => { storeRef.current = store; });

  // ── Navigation ────────────────────────────────────────────────────────
  // useCallback sans dépendances = fonctions vraiment stables
  const clearSelection = () => {
    const iframes = containerRef.current?.querySelectorAll('iframe');
    if (iframes?.length > 0) {
      try { iframes[0].contentDocument?.getSelection()?.removeAllRanges(); } catch (e) {}
    }
  };

  const goNext = useCallback(() => {
    if (isNavigatingRef.current || !renditionRef.current) return;
    window.speechSynthesis?.cancel(); // Coupe immédiatement la voix
    clearSelection(); // EMPÊCHE LE NAVIGATEUR DE RAMENER LA VUE AU DÉBUT DU CHAPITRE !
    isNavigatingRef.current = true;
    renditionRef.current.next().finally(() => {
      setTimeout(() => { isNavigatingRef.current = false; }, 300);
    });
  }, []);

  const goPrev = useCallback(() => {
    if (isNavigatingRef.current || !renditionRef.current) return;
    window.speechSynthesis?.cancel(); // Coupe immédiatement la voix
    clearSelection(); // EMPÊCHE LE NAVIGATEUR DE RAMENER LA VUE
    isNavigatingRef.current = true;
    renditionRef.current.prev().finally(() => {
      setTimeout(() => { isNavigatingRef.current = false; }, 300);
    });
  }, []);

  const goToCfi = useCallback((cfi) => {
    window.speechSynthesis?.cancel();
    clearSelection();
    renditionRef.current?.display(cfi);
  }, []);

  // ── Initialisation ────────────────────────────────────────────────────
  // Dépendances: AUCUNE — tout passe par storeRef et les refs stables
  const initBook = useCallback(async (file) => {
    const { preferences, setRendition, setCurrentCfi, setCurrentChapter,
            setEpubReady, setTotalLocations, setCurrentLocation,
            setIframeDoc, getSavedCfi, showToast } = storeRef.current;

    // Nettoyage
    if (renditionRef.current) {
      try { renditionRef.current.destroy(); } catch (e) {}
      renditionRef.current = null;
    }
    if (bookRef.current) {
      try { bookRef.current.destroy(); } catch (e) {}
      bookRef.current = null;
    }

    setEpubReady(false);

    const arrayBuffer = await file.arrayBuffer();
    const book = ePub(arrayBuffer);
    bookRef.current = book;

    const container = containerRef.current;
    if (!container) return;

    const rendition = book.renderTo(container, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      manager: 'default',
      spread: 'none',
      allowScriptedContent: false,
    });
    renditionRef.current = rendition;
    setRendition(rendition);

    // Thème CSS: Retour au VRAI thème sombre !
    // Zéro padding/margin horizontal pour le calcul exact des colonnes epub.js
    rendition.themes.default({
      html: {
        margin: '0 !important',
        padding: '0 !important',
        'overflow-anchor': 'none !important', // Empêche le navigateur de forcer le scroll vers la sélection (surlignage TTS)
      },
      body: {
        margin: '0 !important',
        padding: '0 !important',
        'overflow-anchor': 'none !important', // Idem sur body
        fontSize: `${preferences.fontSize}px !important`,
        lineHeight: '1.75 !important',
        fontFamily: "'Inter', 'Georgia', serif !important",
        color: '#e6edf3 !important',
        background: 'transparent !important',
      },
      '::selection': { background: `${preferences.highlightColor} !important` },
      img: { maxWidth: '100% !important', height: 'auto !important' },
    });
    rendition.themes.fontSize(`${preferences.fontSize}px`);

    // Affichage initial
    const savedCfi = getSavedCfi();
    if (savedCfi) {
      try {
        await rendition.display(savedCfi);
        showToast('📖 Reprise depuis votre dernière position');
      } catch {
        await rendition.display();
      }
    } else {
      await rendition.display();
    }

    // Génération des locations
    book.ready.then(() => {
      book.locations.generate(1024).then(() => {
        storeRef.current.setTotalLocations(book.locations.total);
      });
    });

    // Événement: page changée
    rendition.on('relocated', (location) => {
      const s = storeRef.current;
      const cfi = location?.start?.cfi;
      s.setCurrentLocationObject(location);
      if (cfi) {
        s.setCurrentCfi(cfi);
        if (book.locations.total > 0) {
          s.setCurrentLocation(book.locations.locationFromCfi(cfi));
        }
      }
      book.spine.get(location?.start?.href)
        ?.load(book.load.bind(book))
        ?.then?.(doc => {
          const title = doc?.querySelector?.('title')?.textContent || '';
          if (title) s.setCurrentChapter(title);
        }).catch(() => {});

      const iframes = containerRef.current?.querySelectorAll('iframe');
      if (iframes?.length > 0) {
        const doc = iframes[0].contentDocument;
        // On efface TOUTE sélection avant d'informer le TTS de la nouvelle page.
        // Sans ça, le navigateur voit la sélection du surlignage TTS encore active
        // et active le "scroll anchor" qui force un retour au début du chapitre.
        try { doc?.getSelection()?.removeAllRanges(); } catch (_e) {}
        s.setIframeDoc(doc);
        if (onPageChangeRef.current) onPageChangeRef.current(doc, location);
      }
    });

    // Événement: section rendue (nouvelle iframe/document)
    rendition.on('rendered', (section, view) => {
      storeRef.current.setEpubReady(true);
      const iframeDoc = view?.document;
      if (iframeDoc?.documentElement) {
        iframeDoc.documentElement.style.setProperty(
          '--highlight-color', storeRef.current.preferences.highlightColor
        );
        // On met à jour le doc dans le store pour que le TTS l'utilise
        // mais on n'appelle PAS onPageChange ici : il sera appelé par relocated
        // qui arrive APRES rendered et donc quand epub.js a bien positionné la page.
        storeRef.current.setIframeDoc(iframeDoc);
      }
    });

    // Clics dans l'iframe: navigation par zones (25% bords)
    rendition.on('click', (event) => {
      if (event.target.tagName?.toLowerCase() === 'a') return;
      const x = event.clientX;
      const w = event.view ? event.view.innerWidth : window.innerWidth;
      if (x < w * 0.25) goPrev();
      else if (x > w * 0.75) goNext();
    });

    // Swipes mobiles
    let touchStartX = 0;
    let touchStartTime = 0;
    rendition.on('touchstart', (e) => {
      if (e.changedTouches?.length > 0) {
        touchStartX = e.changedTouches[0].screenX;
        touchStartTime = Date.now();
      }
    });
    rendition.on('touchend', (e) => {
      if (e.changedTouches?.length > 0) {
        const diff = touchStartX - e.changedTouches[0].screenX;
        const duration = Date.now() - touchStartTime;
        if (Math.abs(diff) > 50 && duration < 500) {
          if (diff > 0) goNext();
          else goPrev();
        }
      }
    });

    const metadata = await book.loaded.metadata;
    return metadata;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionnellement vide — tout passe par des refs stables

  // ── Taille de police ──────────────────────────────────────────────────
  const setFontSize = useCallback((size) => {
    renditionRef.current?.themes.fontSize(`${size}px`);
    const iframes = containerRef.current?.querySelectorAll('iframe');
    if (iframes?.length > 0) {
      try { iframes[0].contentDocument.body.style.fontSize = `${size}px`; } catch (e) {}
    }
  }, [containerRef]);

  // ── Couleur de surlignage ─────────────────────────────────────────────
  const setHighlightColor = useCallback((color) => {
    const iframes = containerRef.current?.querySelectorAll('iframe');
    if (iframes?.length > 0) {
      try {
        iframes[0].contentDocument.documentElement.style.setProperty('--highlight-color', color);
      } catch (e) {}
    }
  }, [containerRef]);

  // ── Nettoyage au démontage ────────────────────────────────────────────
  useEffect(() => {
    return () => {
      try { renditionRef.current?.destroy(); } catch (e) {}
      try { bookRef.current?.destroy(); } catch (e) {}
    };
  }, []);

  return { initBook, goNext, goPrev, goToCfi, setFontSize, setHighlightColor };
}
