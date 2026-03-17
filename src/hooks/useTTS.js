// src/hooks/useTTS.js

import { useCallback, useRef, useEffect } from 'react';
import { useReaderStore } from '../store/readerStore';

// ─────────────────────────────────────────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────────────────────────────────────────

function splitIntoSentences(text) {
  if (!text?.trim()) return [];
  const raw = text.split(/(?<=[.!?…»])\s+(?=[A-ZÁÀÂÉÈÊËÎÏÔÙÛÜÇŒÆ«"—\-\d])/u);
  return raw.map(s => s.trim()).filter(s => s.length > 3);
}

function extractAllTextNodes(container) {
  if (!container) return [];
  const nodes = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const tag = node.parentElement?.tagName?.toLowerCase();
      if (['script', 'style'].includes(tag)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let node;
  while ((node = walker.nextNode())) {
    nodes.push({ node, text: node.textContent, length: node.textContent.length });
  }
  return nodes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook TTS
// ─────────────────────────────────────────────────────────────────────────────

export function useTTS() {
  const {
    ttsState, setTtsState,
    sentences, setSentences,
    sentenceIdx, setSentenceIdx,
    preferences, showToast,
  } = useReaderStore();

  const synthRef             = useRef(window.speechSynthesis);
  const isPlayingRef         = useRef(false);
  const isPausedRef          = useRef(false);
  const sentenceIdxRef       = useRef(0);
  const sentencesRef         = useRef([]);
  const sentencesMetaRef     = useRef([]);
  const allNodesRef          = useRef([]);
  const currentSentenceYRef  = useRef(0); // Position Y absolue de la phrase en cours
  const recoveryTimerRef     = useRef(null);
  const audioCtxRef          = useRef(null);
  const silentSourceRef      = useRef(null);
  const onPageEndRef         = useRef(null);
  const autoScrollEnabledRef   = useRef(true);
  const scrollAnimRef          = useRef(null);
  const isProgrammaticScrollRef = useRef(false);
  const reEnableScrollTimerRef = useRef(null); // Timer pour réactiver l'auto-scroll
  const currentMarkRef         = useRef(null);  // Élément <mark> actuellement injecté

  const setOnPageEnd = useCallback((fn) => { onPageEndRef.current = fn; }, []);

  // Désactive l'auto-scroll sur interaction utilisateur,
  // puis le réactive automatiquement après 3 secondes d'inactivité.
  const disableAutoScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current) return;
    autoScrollEnabledRef.current = false;
    // Annuler le timer précédent et en repartir un nouveau
    if (reEnableScrollTimerRef.current) clearTimeout(reEnableScrollTimerRef.current);
    if (isPlayingRef.current && !isPausedRef.current) {
      reEnableScrollTimerRef.current = setTimeout(() => {
        autoScrollEnabledRef.current = true;
      }, 3000);
    }
  }, []);

  // ── Keep-alive audio ─────────────────────────────────────────────────
  const startSilentKeepAlive = useCallback(() => {
    try {
      if (audioCtxRef.current) return;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      src.connect(ctx.destination); src.start(0);
      audioCtxRef.current = ctx; silentSourceRef.current = src;
    } catch (_) {}
  }, []);

  const stopSilentKeepAlive = useCallback(() => {
    try { silentSourceRef.current?.stop(); audioCtxRef.current?.close(); } catch (_) {}
    audioCtxRef.current = silentSourceRef.current = null;
  }, []);

  // ── Surlignage Sécurisé (DOM <mark>) ────────────────────────────────────
  // On remplace le texte temporairement sans perdre les offsets originaux
  const clearHighlight = useCallback(() => {
    try {
      const marks = currentMarkRef.current;
      if (!marks) return;
      const list = Array.isArray(marks) ? marks : [marks];
      
      list.forEach(mark => {
        if (mark?.parentNode) {
          const parent = mark.parentNode;
          // Restaurer le contenu textuel exact à la place de la balise mark
          while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
          parent.removeChild(mark);
        }
      });
      
      // On regroupe les noeuds splités pour que allNodesRef reste valide
      // On normalise SEULEMENT le conteneur principal à la volée avant la prochaine extraction
    } catch (_) {}
    currentMarkRef.current = null;
  }, []);

  const highlightSentence = useCallback((idx) => {
    clearHighlight();

    const sentMeta = sentencesMetaRef.current[idx];
    if (!sentMeta) return;

    // Normaliser avant d'extraire (fusionne proprement les restes du clearHighlight précédent)
    const container = useReaderStore.getState().contentEl;
    if (!container) return;
    
    // On extrait toujours des noeuds "frais" et propres
    container.normalize();
    const freshNodes = extractAllTextNodes(container);

    const { start, length } = sentMeta;
    const globalEnd = start + length;
    let offset = 0;
    const marks = [];

    console.log(`[TTS DEBUG] Sentence ${idx}: start=${start}, globalEnd=${globalEnd}, freshNodes=${freshNodes.length}`);

    for (let i = 0; i < freshNodes.length; i++) {
      const len = freshNodes[i].length;
      const ns  = offset;
      const ne  = offset + len;

      if (ne > start && ns < globalEnd) {
        const localStart = Math.max(0, start - ns);
        const localEnd   = Math.min(len, globalEnd - ns);
        
        console.log(`[TTS DEBUG] Node ${i} MATCH: ns=${ns}, ne=${ne}, localStart=${localStart}, localEnd=${localEnd}, text="${freshNodes[i].text}"`);

        if (localStart < localEnd) {
          try {
            const textNode = freshNodes[i].node;
            const range = document.createRange();
            range.setStart(textNode, localStart);
            range.setEnd(textNode, localEnd);
            
            const mark = document.createElement('mark');
            mark.className = 'tts-highlight';
            range.surroundContents(mark);
            marks.push(mark);
          } catch (e) {
             console.warn('[TTS] highlight node failed:', e.message);
          }
        }
      }
      offset += len;
    }

    currentMarkRef.current = marks;

    // ── Téléprompteur : centre Y de la phrase ─────────────────────────────
    if (marks.length > 0 && container) {
      const rect  = marks[0].getBoundingClientRect();
      const cRect = container.getBoundingClientRect();
      // Si on est dans le viewport avec une vraie hauteur (pas caché)
      if (rect.height > 0) {
        currentSentenceYRef.current = rect.top - cRect.top + container.scrollTop + rect.height / 2;
      }
    }
  }, [clearHighlight]);

  // ── Boucle Téléprompteur ───────────────────────────────────────────────────────
  // Principe : garder la phrase en cours CENTRÉE verticalement.
  // Approche : interpolation linéaire (lerp) vers la cible.
  // Simple, robuste, comporte une décélération naturelle.
  useEffect(() => {
    let frameId;

    const teleprompterLoop = () => {
      frameId = requestAnimationFrame(teleprompterLoop);

      if (!isPlayingRef.current || !autoScrollEnabledRef.current || isPausedRef.current) return;

      const container = useReaderStore.getState().contentEl;
      if (!container) return;

      // Toujours sécuriser scroll-behavior = auto (pas de transition CSS)
      container.style.scrollBehavior = 'auto';

      const containerHeight = container.clientHeight;
      // Cible : phrase centrée dans la fenêtre
      const targetScroll = Math.max(0, currentSentenceYRef.current - containerHeight / 2);
      const currentScroll = container.scrollTop;
      const dist = targetScroll - currentScroll;

      if (Math.abs(dist) < 0.5) return; // Déjà en place

      // Pour les grands sauts (début de lecture, changement de chapitre) → saut immédiat
      if (Math.abs(dist) > containerHeight * 0.6) {
        isProgrammaticScrollRef.current = true;
        container.scrollTop = targetScroll;
        isProgrammaticScrollRef.current = false;
        return;
      }

      // Lerp : se déplacer de 10 % de la distance restante par frame
      // → décélération naturelle, vitesse adaptée à la distance
      // Vitesse min 1.5px pour ne pas stagner, vitesse max 80px pour ne pas être brusque
      const step = Math.sign(dist) * Math.min(Math.max(Math.abs(dist) * 0.10, 1.5), 80);

      isProgrammaticScrollRef.current = true;
      container.scrollTop = currentScroll + step;
      isProgrammaticScrollRef.current = false;
    };

    frameId = requestAnimationFrame(teleprompterLoop);
    return () => cancelAnimationFrame(frameId);
  }, []);

  // ── Lecture phrase par phrase ─────────────────────────────────────────
  const readSentence = useCallback((idx) => {
    if (!isPlayingRef.current || isPausedRef.current) return;

    const sents = sentencesRef.current;
    if (idx >= sents.length) {
      clearHighlight();
      onPageEndRef.current?.();
      return;
    }

    sentenceIdxRef.current = idx;
    setSentenceIdx(idx);

    const text  = sents[idx];
    const synth = synthRef.current;
    const utt   = new SpeechSynthesisUtterance(text);

    const voices = synth.getVoices();
    const saved  = preferences.voice;
    if (saved) { const v = voices.find(v => v.name === saved); if (v) utt.voice = v; }
    else       { const fr = voices.find(v => v.lang?.startsWith('fr')); if (fr) utt.voice = fr; }
    utt.rate = preferences.ttsRate || 1.0;
    utt.lang = utt.voice?.lang || 'fr-FR';

    utt.onend = () => {
      if (!isPlayingRef.current || isPausedRef.current) return;
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
      setTimeout(() => readSentence(idx + 1), 50);
    };

    utt.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      setTimeout(() => {
        if (isPlayingRef.current && !isPausedRef.current) readSentence(idx);
      }, 300);
    };

    if (synth.speaking || synth.pending) {
      // Annuler la voix précédente (essentiel si on change de vitesse)
      synth.cancel();
    }
    synth.speak(utt);
    highlightSentence(idx);

    if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
    const ms = (text.length / 12) * (1 / (utt.rate || 1)) * 1000;
    recoveryTimerRef.current = setTimeout(() => {
      if (isPlayingRef.current && !isPausedRef.current && !synth.speaking && !synth.pending) {
        try { synth.cancel(); } catch (_) {}
        setTimeout(() => { if (isPlayingRef.current && !isPausedRef.current) readSentence(sentenceIdxRef.current); }, 100);
      }
    }, ms + 3000);
  }, [preferences, highlightSentence, clearHighlight, setSentenceIdx]);

  // ── Extraction des phrases ─────────────────────────────────────────────
  const refreshSentences = useCallback((autoPlay = false) => {
    const container = useReaderStore.getState().contentEl;
    if (!container) return [];

    // IMPORTANT : effacer le surlignage avant d'extraire les nœuds texte.
    // Le <mark> injecté modifie la structure du DOM et décalerait les offsets.
    clearHighlight();

    const nodes = extractAllTextNodes(container);
    allNodesRef.current = nodes;

    try { container.focus(); } catch(_) {}

    if (nodes.length === 0) {
      sentencesRef.current = []; setSentences([]);
      sentenceIdxRef.current = 0; setSentenceIdx(0);
      return [];
    }

    const fullText = nodes.map(n => n.text).join('');
    const sents    = splitIntoSentences(fullText);
    sentencesRef.current = sents;
    setSentences(sents);

    const meta = [];
    let searchIdx = 0;
    for (let i = 0; i < sents.length; i++) {
      const s = fullText.indexOf(sents[i], searchIdx);
      if (s !== -1) { meta[i] = { start: s, length: sents[i].length }; searchIdx = s + sents[i].length; }
      else          { meta[i] = { start: searchIdx, length: sents[i].length }; }
    }
    sentencesMetaRef.current = meta;
    sentenceIdxRef.current = 0;
    setSentenceIdx(0);

    if (autoPlay && isPlayingRef.current) {
      if (synthRef.current.speaking || synthRef.current.pending) synthRef.current.cancel();
      setTimeout(() => {
        if (isPlayingRef.current && !isPausedRef.current) readSentence(0);
      }, 50);
    }
    return sents;
  }, [clearHighlight, setSentences, setSentenceIdx, readSentence]);

  // ── Contrôles ─────────────────────────────────────────────────────────
  const play = useCallback((fromIdx = 0) => {
    if (!useReaderStore.getState().contentEl) { showToast('⚠️ Livre non chargé'); return; }
    startSilentKeepAlive();
    isPlayingRef.current = true; isPausedRef.current = false;
    autoScrollEnabledRef.current = true;
    setTtsState('playing');
    // Toujours rafraîchir : garantit que allNodesRef est propre et à jour
    // (crucial après un stop, un changement de chapitre, ou un highlight précédent)
    const s = refreshSentences(false);
    if (!s?.length) { showToast('⚠️ Aucun texte trouvé'); setTtsState('idle'); isPlayingRef.current = false; return; }
    readSentence(fromIdx);
  }, [startSilentKeepAlive, setTtsState, refreshSentences, readSentence, showToast]);

  const pause = useCallback(() => {
    isPausedRef.current = true; isPlayingRef.current = false;
    setTtsState('paused'); synthRef.current.cancel();
    if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
  }, [setTtsState]);

  const resume = useCallback(() => {
    isPausedRef.current = false; isPlayingRef.current = true;
    autoScrollEnabledRef.current = true;
    setTtsState('playing');
    readSentence(sentenceIdxRef.current); // readSentence appelle highlightSentence
  }, [setTtsState, readSentence]);

  const stop = useCallback(() => {
    isPlayingRef.current = false; isPausedRef.current = false;
    setTtsState('idle'); synthRef.current.cancel();
    sentenceIdxRef.current = 0; setSentenceIdx(0);
    clearHighlight();
    stopSilentKeepAlive();
    if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
  }, [setTtsState, setSentenceIdx, clearHighlight, stopSilentKeepAlive]);

  const playFrom = useCallback((idx) => { stop(); setTimeout(() => play(idx), 100); }, [stop, play]);

  useEffect(() => {
    return () => {
      synthRef.current.cancel();
      clearHighlight();
      stopSilentKeepAlive();
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
    };
  }, [stopSilentKeepAlive, clearHighlight]);

  return {
    ttsState, sentences, sentenceIdx,
    play, pause, resume, stop, playFrom,
    refreshSentences, setOnPageEnd, isPlayingRef,
    disableAutoScroll,
  };
}
