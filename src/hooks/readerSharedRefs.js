// src/hooks/readerSharedRefs.js
// Singletons de module partagés entre les hooks du lecteur.
// Permet la communication entre useChapterTransition, useAutoScroll,
// useViewerLayout et EpubViewer sans prop-drilling ni couplage circulaire.

/** Seek en attente après un changement de chapitre : fraction de scroll (0..1) */
export const pendingSeekFractionRef = { current: null };

/** Seek en attente après un changement de chapitre : index de phrase exact */
export const pendingSeekSentenceIdxRef = { current: null };

/** Fraction de scroll courant (0..1) — partagée entre useChapterTransition et useViewerLayout */
export const sharedCurrentFractionRef = { current: 0 };

/** Signal booléen : "relancer l'auto-scroll après chargement du prochain chapitre" */
export const resumeAutoScrollRef = { current: false };

/** Callback injecté par useAutoScroll pour relancer le défilement après transition */
export const onResumeAutoScrollRef = { current: null };

/**
 * true si l'auto-scroll a été actif dans le chapitre courant.
 * Permet à checkScrollTransition (scroll manuel vers le bas) de relancer l'auto-scroll
 * dans le chapitre suivant même si l'utilisateur a fait une pause involontaire.
 * Remis à false par performSeek à chaque changement de chapitre.
 */
export const autoScrollWasActiveRef = { current: false };
