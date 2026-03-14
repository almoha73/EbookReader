// src/hooks/useTTS.js
// Moteur TTS simplifié : pas de scroll pendant la lecture, pas de mutation DOM
// Le surlignage utilise window.getSelection() — simple et fiable dans le DOM principal

import { useCallback, useRef, useEffect } from 'react';
import { useReaderStore } from '../store/readerStore';

// ─────────────────────────────────────────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────────────────────────────────────────

function splitIntoSentences(text) {
  if (!text?.trim()) return [];
  // Découpage après ponctuation forte, avant majuscule ou guillemet ouvrant
  const raw = text.split(/(?<=[.!?…»])\s+(?=[A-ZÁÀÂÉÈÊËÎÏÔÙÛÜÇŒÆ«"—\-\d])/u);
  return raw.map(s => s.trim()).filter(s => s.length > 3);
}

// Retourne TOUS les nœuds texte du conteneur (pour lecture en scroll continu)
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

  const synthRef         = useRef(window.speechSynthesis);
  const isPlayingRef     = useRef(false);
  const isPausedRef      = useRef(false);
  const sentenceIdxRef   = useRef(0);
  const sentencesRef     = useRef([]);
  const sentencesMetaRef = useRef([]);
  const allNodesRef      = useRef([]);
  const recoveryTimerRef = useRef(null);
  const audioCtxRef      = useRef(null);
  const silentSourceRef  = useRef(null);
  const onPageEndRef     = useRef(null);

  const setOnPageEnd = useCallback((fn) => { onPageEndRef.current = fn; }, []);

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

  // ── Surlignage via Selection API ─────────────────────────────────────
  // window.getSelection() fonctionne parfaitement dans le DOM principal (pas d'iframe)
  const clearHighlight = useCallback(() => {
    try { window.getSelection()?.removeAllRanges(); } catch (_) {}
  }, []);

  const highlightSentence = useCallback((idx) => {
    clearHighlight();

    const sentMeta = sentencesMetaRef.current[idx];
    if (!sentMeta) return;

    const { start, length } = sentMeta;
    const globalEnd = start + length;
    const nodes = allNodesRef.current;
    let startNode = null, startOffset = 0, endNode = null, endOffset = 0;
    let offset = 0;

    for (let i = 0; i < nodes.length; i++) {
      const len  = nodes[i].length;
      const ns   = offset;
      const ne   = offset + len;

      if (!startNode && start >= ns && start < ne) {
        startNode = nodes[i].node; startOffset = start - ns;
      }
      if (startNode && globalEnd >= ns && globalEnd <= ne) {
        endNode = nodes[i].node; endOffset = globalEnd - ns;
        break;
      }
      if (startNode && i === nodes.length - 1) {
        endNode = nodes[i].node;
        endOffset = Math.min(len, globalEnd - ns);
      }
      offset += len;
    }

    if (!startNode || !endNode) return;

    try {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      
      // On s'assure que le conteneur a le focus pour que la sélection native affiche sa couleur complète
      const container = useReaderStore.getState().contentEl;
      if (container && document.activeElement !== container) {
        container.focus({ preventScroll: true });
      }

      // API CSS Custom Highlight (Chrome 105+)
      if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') {
        window.getSelection()?.removeAllRanges(); // Libérer la sélection native
        CSS.highlights.set('tts-active', new Highlight(range));
      } else {
        // Fallback sélection native
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      }

      // Auto-scroll : on ne ramène JAMAIS l'utilisateur en arrière.
      // On scrolle vers le bas UNIQUEMENT si l'audio arrive en bas de la vue actuelle.
      if (container) {
        const rect = range.getBoundingClientRect();
        const cRect = container.getBoundingClientRect();
        
        const bottomMargin = cRect.height * 0.2; // 20% du bas de l'écran
        
        // Si la fin de la phrase touche la marge du bas
        // ET que la phrase n'est pas "loin" en bas (ex: si vous avez scrollé en haut manuellement)
        if (rect.bottom > cRect.bottom - bottomMargin && rect.top < cRect.bottom + cRect.height * 0.5) {
          // On avance doucement l'écran vers le bas
          container.scrollBy({ top: cRect.height * 0.35, behavior: 'smooth' });
        }
      }
    } catch (e) {
      console.warn('[TTS] highlight:', e.message);
    }
  }, [clearHighlight]);

  // ── Lecture phrase par phrase ─────────────────────────────────────────
  const readSentence = useCallback((idx) => {
    if (!isPlayingRef.current || isPausedRef.current) return;

    const sents = sentencesRef.current;
    if (idx >= sents.length) {
      // Fin du chapitre complet → on informe EpubViewer de passer au chapitre suivant
      clearHighlight();
      onPageEndRef.current?.();
      return;
    }

    sentenceIdxRef.current = idx;
    setSentenceIdx(idx);

    const text  = sents[idx];
    const synth = synthRef.current;
    const utt   = new SpeechSynthesisUtterance(text);

    // Voix
    const voices = synth.getVoices();
    const saved  = preferences.voice;
    if (saved) { const v = voices.find(v => v.name === saved); if (v) utt.voice = v; }
    else       { const fr = voices.find(v => v.lang?.startsWith('fr')); if (fr) utt.voice = fr; }
    utt.rate = preferences.ttsRate || 1.0;
    utt.lang = utt.voice?.lang || 'fr-FR';

    utt.onend = () => {
      if (!isPlayingRef.current || isPausedRef.current) return;
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
      // ⚠️ jamais de synth.cancel() depuis onend (gèle Chrome/Linux)
      setTimeout(() => readSentence(idx + 1), 50);
    };

    utt.onerror = (e) => {
      if (e.error === 'interrupted') return;
      setTimeout(() => {
        if (isPlayingRef.current && !isPausedRef.current) readSentence(idx);
      }, 300);
    };

    if (synth.speaking || synth.pending) synth.cancel();
    synth.speak(utt);
    highlightSentence(idx);

    // Garde-fou : si Chrome se fige
    if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
    const ms = (text.length / 12) * (1 / (utt.rate || 1)) * 1000;
    recoveryTimerRef.current = setTimeout(() => {
      if (isPlayingRef.current && !isPausedRef.current && !synth.speaking && !synth.pending) {
        try { synth.cancel(); } catch (_) {}
        setTimeout(() => { if (isPlayingRef.current && !isPausedRef.current) readSentence(sentenceIdxRef.current); }, 100);
      }
    }, ms + 3000);
  }, [preferences, highlightSentence, clearHighlight, setSentenceIdx]);

  // ── Extraction des phrases du chapitre entier ──────────────────────────
  const refreshSentences = useCallback((autoPlay = false) => {
    const container = useReaderStore.getState().contentEl;
    if (!container) return [];

    const nodes = extractAllTextNodes(container);
    allNodesRef.current = nodes;
    console.log('[TTS] refreshSentences: nodes', nodes.length, '| autoPlay', autoPlay);

    // On s'assure que le focus est sur le conteneur pour que getSelection() soit visible
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
    console.log('[TTS] phrases:', sents.length, '| ex:', sents[0]?.slice(0, 40));

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
      // Annuler ce qui tourne encore avant de relancer sur la nouvelle zone
      if (synthRef.current.speaking || synthRef.current.pending) synthRef.current.cancel();
      setTimeout(() => {
        if (isPlayingRef.current && !isPausedRef.current) readSentence(0);
      }, 50);
    }
    return sents;
  }, [setSentences, setSentenceIdx, readSentence]);

  // ── Contrôles ────────────────────────────────────────────────────────
  const play = useCallback((fromIdx = 0) => {
    if (!useReaderStore.getState().contentEl) { showToast('⚠️ Livre non chargé'); return; }
    startSilentKeepAlive();
    isPlayingRef.current = true; isPausedRef.current = false;
    setTtsState('playing');
    if (sentencesRef.current.length === 0) {
      const s = refreshSentences(false);
      if (!s?.length) { showToast('⚠️ Aucun texte trouvé'); setTtsState('idle'); isPlayingRef.current = false; return; }
    }
    readSentence(fromIdx);
  }, [startSilentKeepAlive, setTtsState, refreshSentences, readSentence, showToast]);

  const pause = useCallback(() => {
    isPausedRef.current = true; isPlayingRef.current = false;
    setTtsState('paused'); synthRef.current.cancel();
    if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
  }, [setTtsState]);

  const resume = useCallback(() => {
    isPausedRef.current = false; isPlayingRef.current = true;
    setTtsState('playing');
    readSentence(sentenceIdxRef.current);
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
    return () => { synthRef.current.cancel(); clearHighlight(); stopSilentKeepAlive(); if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current); };
  }, [stopSilentKeepAlive, clearHighlight]);

  return {
    ttsState, sentences, sentenceIdx,
    play, pause, resume, stop, playFrom,
    refreshSentences, setOnPageEnd, isPlayingRef,
  };
}
