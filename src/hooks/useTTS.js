// src/hooks/useTTS.js

import { useCallback, useRef, useEffect } from 'react';
import { useReaderStore } from '../store/readerStore';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

// ─────────────────────────────────────────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────────────────────────────────────────

function splitIntoSentences(text) {
  if (!text?.trim()) return [];
  // Séparation classique sur les espaces
  // OU séparation sans espace (paragraphes collés dans le DOM) si :
  // 1. La suite est une lettre maj/tiret/guillemet ET le précédent n'est pas une maj (évite U.S.A.)
  // 2. La suite est un chiffre ET le précédent n'est ni maj ni chiffre (évite 3.14)
  const regex = /(?<=[.!?…»])\s+(?=[A-ZÁÀÂÉÈÊËÎÏÔÙÛÜÇŒÆ«"'\-—–‒―−\d])|(?<=[^A-ZÁÀÂÉÈÊËÎÏÔÙÛÜÇŒÆ\s]\.)(?=[A-ZÁÀÂÉÈÊËÎÏÔÙÛÜÇŒÆ«"'\-—–‒―−])|(?<=[!?…»])(?=[A-ZÁÀÂÉÈÊËÎÏÔÙÛÜÇŒÆ«"'\-—–‒―−])|(?<=[^A-ZÁÀÂÉÈÊËÎÏÔÙÛÜÇŒÆ\s\d]\.)(?=\d)|(?<=[!?…»])(?=\d)/u;
  const raw = text.split(regex);
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
  const silentHtmlAudioRef   = useRef(null); // Force HTML5 Media playback (for aggressive OSes)
  const onPageEndRef         = useRef(null);
  const autoScrollEnabledRef   = useRef(true);
  const scrollAnimRef          = useRef(null);
  const isProgrammaticScrollRef = useRef(false);
  const reEnableScrollTimerRef = useRef(null); // Timer pour réactiver l'auto-scroll
  const currentMarkRef         = useRef(null);  // Élément <mark> actuellement injecté
  const synthResumeIntervalRef = useRef(null);  // Timer anti-freeze Chrome Android (~14s bug)
  const playFromTimeoutRef     = useRef(null);

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
    // 1. Trick Web Audio API
    try {
      if (!audioCtxRef.current) {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
        const src = ctx.createBufferSource();
        src.buffer = buf; src.loop = true;
        src.connect(ctx.destination); src.start(0);
        audioCtxRef.current = ctx; silentSourceRef.current = src;
      }
    } catch (_) {}

    // 2. Audio HTML5 silencieux — ancre la MediaSession sur Android Chrome.
    //    Sans ça, l'écran éteint tue le TTS même avec la Web Audio API,
    //    et la notification ne s'affiche pas avec un fichier de 0 secondes.
    try {
      if (!silentHtmlAudioRef.current) {
        const audio = new Audio('/silence.wav');
        audio.loop = true;
        audio.volume = 0.001; // Quasi-silencieux mais reconnu comme média actif
        audio.play().catch(() => {}); // Peut échouer sans geste utilisateur préalable
        silentHtmlAudioRef.current = audio;
      }
    } catch (_) {}

    // 3. Timer anti-freeze Chrome Android : le speechSynthesis se fige toutes les ~14s.
    //    Un appel périodique à resume() le maintient vivant sans interrompre la phrase.
    if (!synthResumeIntervalRef.current) {
      synthResumeIntervalRef.current = setInterval(() => {
        // Pas nécessaire avec le plugin natif, mais on le garde pour le fallback web.
      }, 10000);
    }
  }, []);

  const stopSilentKeepAlive = useCallback(() => {
    // Web Audio API
    try { silentSourceRef.current?.stop(); audioCtxRef.current?.close(); } catch (_) {}
    audioCtxRef.current = silentSourceRef.current = null;

    // Audio HTML5 silencieux
    try {
      if (silentHtmlAudioRef.current) {
        silentHtmlAudioRef.current.pause();
        silentHtmlAudioRef.current.src = '';
        silentHtmlAudioRef.current = null;
      }
    } catch (_) {}

    // Timer anti-freeze
    if (synthResumeIntervalRef.current) {
      clearInterval(synthResumeIntervalRef.current);
      synthResumeIntervalRef.current = null;
    }
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

  const pause = useCallback(() => {
    isPausedRef.current = true; isPlayingRef.current = false;
    setTtsState('paused'); TextToSpeech.stop().catch(()=>{});
    import('@capgo/capacitor-media-session').then(({ MediaSession }) => MediaSession.setPlaybackState({ playbackState: 'paused' }).catch(()=>{})).catch(()=>{});
    if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
  }, [setTtsState]);

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

    const container = useReaderStore.getState().contentEl;
    if (container) {
       const newHeight = Math.max(1, container.scrollHeight - container.clientHeight);
       const fraction = container.scrollTop / newHeight;
       useReaderStore.getState().saveCurrentPosition(fraction);
    }

    const text  = sents[idx];
    
    // 1. Séparer les paragraphes collés
    const spacedText = text.replace(/([.!?…»])([A-ZÁÀÂÉÈÊËÎÏÔÙÛÜÇŒÆ])/gu, '$1 $2');

    // 2. Nettoyage agressif
    const cleanText = spacedText.replace(/[\.…;:!\?]+[^\p{L}\p{N}]*$/u, '');

    highlightSentence(idx);

    const currentPrefs = useReaderStore.getState().preferences;

    if (!cleanText.trim()) {
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
      setTimeout(() => {
        if (isPlayingRef.current && !isPausedRef.current) readSentence(idx + 1);
      }, 50);
      return;
    }

    if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
    const ms = (text.length / 12) * (1 / (currentPrefs.ttsRate || 1)) * 1000;
    recoveryTimerRef.current = setTimeout(() => {
      if (isPlayingRef.current && !isPausedRef.current) {
        TextToSpeech.stop().catch(()=>{});
        setTimeout(() => { if (isPlayingRef.current && !isPausedRef.current) readSentence(sentenceIdxRef.current); }, 100);
      }
    }, ms + 5000);

    TextToSpeech.speak({
      text: cleanText,
      lang: 'fr-FR',
      rate: currentPrefs.ttsRate || 1.0,
      voice: typeof currentPrefs.voice === 'number' ? currentPrefs.voice : undefined,
    }).then(() => {
      if (!isPlayingRef.current || isPausedRef.current) return;
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
      setTimeout(() => readSentence(idx + 1), 50);
    }).catch((e) => {
      console.warn('TTS Speak error:', e);
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
      // Auto-pause to prevent infinite retry loop that causes screen jumping
      pause();
      showToast('⚠️ Erreur vocale, lecture en pause');
    });

  }, [highlightSentence, clearHighlight, setSentenceIdx, pause, showToast]);

  // ── Application immédiate des changements de voix/vitesse ─────────────
  // Relance la phrase en cours si on change la vitesse ou la voix pendant la lecture
  useEffect(() => {
    if (isPlayingRef.current && !isPausedRef.current) {
         TextToSpeech.stop().catch(()=>{});
         setTimeout(() => {
           if (isPlayingRef.current && !isPausedRef.current) {
             readSentence(sentenceIdxRef.current);
           }
         }, 50);
    }
  }, [preferences.ttsRate, preferences.voice, readSentence]);

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
      TextToSpeech.stop().catch(()=>{});
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
    import('@capgo/capacitor-media-session').then(({ MediaSession }) => MediaSession.setPlaybackState({ playbackState: 'playing' }).catch(()=>{})).catch(()=>{});
    
    // On ne force pas le rafraîchissement complet si on a déjà les phrases
    let s = sentencesRef.current;
    if (!s || s.length === 0) {
      s = refreshSentences(false);
    }
    if (!s?.length) { showToast('⚠️ Aucun texte trouvé'); setTtsState('idle'); isPlayingRef.current = false; return; }
    readSentence(fromIdx);
  }, [startSilentKeepAlive, setTtsState, refreshSentences, readSentence, showToast]);

  const resume = useCallback(() => {
    isPausedRef.current = false; isPlayingRef.current = true;
    autoScrollEnabledRef.current = true;
    setTtsState('playing');
    import('@capgo/capacitor-media-session').then(({ MediaSession }) => MediaSession.setPlaybackState({ playbackState: 'playing' }).catch(()=>{})).catch(()=>{});
    readSentence(sentenceIdxRef.current); // readSentence appelle highlightSentence
  }, [setTtsState, readSentence]);

  const stop = useCallback(() => {
    if (playFromTimeoutRef.current) { clearTimeout(playFromTimeoutRef.current); playFromTimeoutRef.current = null; }
    isPlayingRef.current = false; isPausedRef.current = false;
    setTtsState('idle'); TextToSpeech.stop().catch(()=>{});
    import('@capgo/capacitor-media-session').then(({ MediaSession }) => MediaSession.setPlaybackState({ playbackState: 'none' }).catch(()=>{})).catch(()=>{});
    sentenceIdxRef.current = 0; setSentenceIdx(0);
    clearHighlight();
    stopSilentKeepAlive();
    if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
  }, [setTtsState, setSentenceIdx, clearHighlight, stopSilentKeepAlive]);

  const playFrom = useCallback((idx) => { 
    if (playFromTimeoutRef.current) clearTimeout(playFromTimeoutRef.current);
    if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
    
    TextToSpeech.stop().catch(()=>{});
    isPlayingRef.current = true;
    isPausedRef.current = false;
    setTtsState('playing');
    
    playFromTimeoutRef.current = setTimeout(() => {
      if (isPlayingRef.current && !isPausedRef.current) {
        readSentence(idx);
      }
    }, 150); 
  }, [readSentence, setTtsState]);

  const seekToPhrase = useCallback((idx) => {
    stop();
    if (idx >= 0 && idx < sentencesRef.current.length) {
       sentenceIdxRef.current = idx;
       setSentenceIdx(idx);
       highlightSentence(idx);
       autoScrollEnabledRef.current = true;

       const container = useReaderStore.getState().contentEl;
       if (container) {
           const targetScroll = Math.max(0, currentSentenceYRef.current - container.clientHeight / 2);
           isProgrammaticScrollRef.current = true;
           container.scrollTop = targetScroll;
           isProgrammaticScrollRef.current = false;
       }
    }
  }, [stop, setSentenceIdx, highlightSentence]);

  // ── Session Audio & Contrôles écran de verrouillage ───────────────────
  useEffect(() => {
    // Importation asynchrone pour ne pas crasher le web
    import('@capgo/capacitor-media-session').then(({ MediaSession }) => {
      const state = useReaderStore.getState();
      const title = state.currentChapter || state.currentBook?.title || 'Lecture en cours';
      const author = state.currentBook?.author || 'EbookReader';
      const coverUrl = state.currentBook?.coverUrl || '';

      try {
        MediaSession.setMetadata({
          title: title,
          artist: author,
          album: 'EbookReader',
          artwork: coverUrl ? [{ src: coverUrl, sizes: '512x512', type: 'image/jpeg' }] : []
        }).catch(()=>{});

        MediaSession.setActionHandler({ action: 'play' }, resume);
        MediaSession.setActionHandler({ action: 'pause' }, pause);
        MediaSession.setActionHandler({ action: 'previoustrack' }, () => {
          const prevIdx = Math.max(0, sentenceIdxRef.current - 1);
          playFrom(prevIdx);
        });
        MediaSession.setActionHandler({ action: 'nexttrack' }, () => {
          const nextIdx = sentenceIdxRef.current + 1;
          if (nextIdx < sentencesRef.current.length) {
            playFrom(nextIdx);
          } else {
            onPageEndRef.current?.();
          }
        });
      } catch (e) {
        console.warn('Native MediaSession not supported', e);
      }
    }).catch(() => {
      // Fallback HTML5 si le plugin n'est pas installé ou supporté (sur navigateur par exemple)
      if ('mediaSession' in navigator) {
        const state = useReaderStore.getState();
        const title = state.currentChapter || state.currentBook?.title || 'Lecture en cours';
        const author = state.currentBook?.author || 'EbookReader';
        const coverUrl = state.currentBook?.coverUrl || '';

        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: title,
          artist: author,
          artwork: coverUrl ? [{ src: coverUrl, sizes: '512x512', type: 'image/jpeg' }] : []
        });

        navigator.mediaSession.setActionHandler('play', resume);
        navigator.mediaSession.setActionHandler('pause', pause);

        navigator.mediaSession.setActionHandler('previoustrack', () => {
          const prevIdx = Math.max(0, sentenceIdxRef.current - 1);
          playFrom(prevIdx);
        });

        navigator.mediaSession.setActionHandler('nexttrack', () => {
          const nextIdx = sentenceIdxRef.current + 1;
          if (nextIdx < sentencesRef.current.length) {
            playFrom(nextIdx);
          } else {
            onPageEndRef.current?.();
          }
        });
      }
    });
  }, [resume, pause, playFrom]);

  // ── Watchdog de reprise en sortie de veille ─────────────────────────────
  useEffect(() => {
    const handleVisibilityChange = () => {
      // Si la page redevient visible et qu'on est censé jouer mais que le synthétiseur s'est tu
      if (!document.hidden && isPlayingRef.current && !isPausedRef.current) {
        // Native plugin automatically resumes / handles background in most cases, 
        // but we can enforce a restart if we wanted. For now, let the plugin handle it.
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [resume]);

  useEffect(() => {
    return () => {
      TextToSpeech.stop().catch(()=>{});
      clearHighlight();
      stopSilentKeepAlive();
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
    };
  }, [stopSilentKeepAlive, clearHighlight]);

  const playFromSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    let targetNode = range.startContainer;
    
    if (targetNode.nodeType !== Node.TEXT_NODE) {
      const walker = document.createTreeWalker(targetNode, NodeFilter.SHOW_TEXT, null);
      const firstText = walker.nextNode();
      if (firstText) targetNode = firstText;
    }
    
    if (targetNode.nodeType !== Node.TEXT_NODE) return;

    const container = useReaderStore.getState().contentEl;
    if (!container) return;

    const freshNodes = extractAllTextNodes(container);
    let offset = 0;
    let foundNs = -1;

    for (let i = 0; i < freshNodes.length; i++) {
      if (freshNodes[i].node === targetNode) {
         foundNs = offset + range.startOffset;
         break;
      }
      offset += freshNodes[i].length;
    }
    
    if (foundNs !== -1) {
       const meta = sentencesMetaRef.current;
       for (let i = 0; i < meta.length; i++) {
          if (foundNs >= meta[i].start && foundNs <= meta[i].start + meta[i].length) {
             playFrom(i);
             selection.removeAllRanges();
             return;
          }
       }
    }
  }, [playFrom]);

  return {
    ttsState, sentences, sentenceIdx,
    play, pause, resume, stop, playFrom, seekToPhrase, playFromSelection,
    refreshSentences, setOnPageEnd, isPlayingRef,
    disableAutoScroll,
  };
}
