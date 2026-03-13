import React, { useEffect, useRef, useState, useCallback } from 'react';
import ePub from 'epubjs';
import useReaderStore from '../store/useReaderStore';
import { saveProgress, loadProgress } from '../utils/storage';

const Reader = ({ epubUrl, bookId }) => {
  const viewerRef = useRef(null);
  const bookRef = useRef(null);
  const renditionRef = useRef(null);
  const utteranceRef = useRef(null);

  const setCfi = useReaderStore((state) => state.setCfi);
  const isPlaying = useReaderStore((state) => state.isPlaying);
  const setIsPlaying = useReaderStore((state) => state.setIsPlaying);
  const fontSize = useReaderStore((state) => state.fontSize);
  const ttsRate = useReaderStore((state) => state.ttsRate);
  
  const [sentences, setSentences] = useState([]);
  const textNodesRef = useRef([]);

  // 1. Initialisation de Epub.js
  useEffect(() => {
    if (!epubUrl || !viewerRef.current) return;

    // Clean up if re-rendering
    if (bookRef.current) {
        bookRef.current.destroy();
    }

    const book = ePub(epubUrl);
    bookRef.current = book;

    const rendition = book.renderTo(viewerRef.current, {
      width: '100%',
      height: '100%',
      spread: 'none',   // Important pour mobile (une seule page)
      flow: 'paginated',
    });
    renditionRef.current = rendition;

    // Correction CSS structurelle : annuler marges et débordements webkit
    // addStylesheetRules n'existe plus dans epubjs 0.3 — on injecte via le document de l'iframe
    rendition.hooks.content.register((contents) => {
      const style = contents.document.createElement('style');
      style.textContent = `
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          box-sizing: border-box !important;
        }
        .tts-active-word {
          background-color: rgba(255, 255, 0, 0.4);
          border-radius: 2px;
        }
      `;
      contents.document.head.appendChild(style);
    });

    const savedCfi = loadProgress(bookId);
    rendition.display(savedCfi || undefined);

    rendition.on('relocated', (location) => {
      setCfi(location.start.cfi);
      saveProgress(bookId, location.start.cfi);
      extractTextFromCurrentPage(rendition);
    });

    return () => {
      window.speechSynthesis.cancel();
      book.destroy();
    };
  }, [epubUrl, bookId]); // Initialisation uniquement au changement d'EPUB

  // 2. Font Size réactif
  useEffect(() => {
    if (renditionRef.current) {
      renditionRef.current.themes.fontSize(`${fontSize}%`);
      setIsPlaying(false); // On coupe la lecture si on redimensionne le layout
    }
  }, [fontSize, setIsPlaying]);

  // 3. Extraction de texte & Mapping DOM pour le TTS
  const extractTextFromCurrentPage = useCallback((rendition) => {
    const contentsArr = rendition.getContents();
    if (!contentsArr || !contentsArr.length) return;
    
    const iframeDoc = contentsArr[0].document;
    const body = iframeDoc.body;
    
    const walk = iframeDoc.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    let fullText = "";
    let nodesMap = [];
    
    while ((node = walk.nextNode())) {
      const text = node.textContent;
      if (text.trim().length > 0) {
        const parent = node.parentElement;
        if (parent) {
          const style = iframeDoc.defaultView.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          
          // Vérification CRITIQUE : on ne prend que les textes visibles sur *cette* page !
          // Epubjs en mode paginé garde tout le chapitre dans le DOM, décalé horizontalement.
          const rect = parent.getBoundingClientRect();
          const viewportWidth = window.innerWidth;
          // Si l'élément est hors écran à gauche ou à droite, on zappe
          if (rect.right < 0 || rect.left > viewportWidth) {
             continue; // Pas affiché sur la page actuelle
          }
        }
        
        const start = fullText.length;
        fullText += text;
        const end = fullText.length;
        
        nodesMap.push({ node, start, end, text });
      }
    }

    console.log(`[TTS] Extraction: ${nodesMap.length} nœuds texte visibles sur cette page.`);
    textNodesRef.current = nodesMap;
    
    const splitSentences = [];
    const re = /[^.!?\n]+[.!?\n]*/g;
    let m;
    while ((m = re.exec(fullText)) !== null) {
      if (m[0].trim().length > 0) {
        splitSentences.push({
          text: m[0],
          charStart: m.index,
          charEnd: m.index + m[0].length
        });
      }
    }
    
    setSentences(splitSentences);
  }, []);

    // 4. Moteur TTS (Web Speech API native avec surlignage par onboundary)
  useEffect(() => {
    if (!isPlaying) {
      window.speechSynthesis.cancel();
      clearHighlight();
      return;
    }

    // Astuce Chrome : si aucune phrase on force la page d'après
    if (sentences.length === 0) {
      console.log("TTS: Aucune phrase trouvée sur cette page. Passage page suivante...");
      const timer = setTimeout(() => {
        if (isPlaying) renditionRef.current?.next();
      }, 1500);
      return () => clearTimeout(timer);
    }

    // On concatène toutes les phrases de la page pour le TTS
    const pageText = sentences.map(s => s.text).join(' ');
    const utterance = new SpeechSynthesisUtterance(pageText);
    
    utterance.lang = 'fr-FR';
    utterance.rate = ttsRate;
    
    // Assigner une voix française ("Premium" de préférence) si les voix sont déjà dans la console
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      const frVoice = voices.find(v => v.lang.startsWith('fr-') && (v.name.includes('Premium') || v.name.includes('Google')));
      if (frVoice) utterance.voice = frVoice;
    }

    // Surlignage dynamique
    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        highlightWordAtOffset(event.charIndex, event.charLength);
      }
    };

    utterance.onstart = () => {
      console.log(`[TTS] Début de lecture (Vitesse: ${ttsRate}) : "${pageText.substring(0, 30)}..."`);
    };

    utterance.onend = () => {
      console.log("[TTS] Phrase terminée.");
      clearHighlight();
      if (useReaderStore.getState().isPlaying) {
        console.log("[TTS] Changement de page automatique via Epubjs...");
        renditionRef.current?.next();
      }
    };

    utterance.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      console.error("[TTS] Erreur Web Speech API reçue :", e.error, e);
      setIsPlaying(false);
    };

    utteranceRef.current = utterance;
    
    // On lance la phrase directement ! Chrome/Firefox se débrouille avec la defaultVoice.
    window.speechSynthesis.speak(utterance);

    return () => {
      console.log("[TTS] Cleanup du useEffect (cancel).");
      window.speechSynthesis.cancel();
      clearHighlight();
    };
  }, [isPlaying, sentences, ttsRate, setIsPlaying, highlightWordAtOffset, clearHighlight]);

  // 5. Manipulation DOM interne Iframe : Injection du span
  const highlightWordAtOffset = useCallback((charIndex, charLength) => {
    clearHighlight();

    if (!textNodesRef.current.length || !renditionRef.current) return;
    
    const contentsArr = renditionRef.current.getContents();
    if (!contentsArr || !contentsArr.length) return;
    const iframeDoc = contentsArr[0].document;

    const span = iframeDoc.createElement('span');
    span.className = 'tts-active-word';
    span.id = 'tts-current-highlight';

    const targetNodeObj = textNodesRef.current.find(n => charIndex >= n.start && charIndex < n.end);
    
    if (targetNodeObj) {
      try {
        const localOffset = charIndex - targetNodeObj.start;
        const textNode = targetNodeObj.node;
        const safeLength = Math.min(charLength || 5, textNode.textContent.length - localOffset);
        
        if (safeLength > 0) {
           const range = iframeDoc.createRange();
           range.setStart(textNode, localOffset);
           range.setEnd(textNode, localOffset + safeLength);
           range.surroundContents(span);
        }
      } catch (e) {
        // Ignorer silencieusement si le layout Epub.js bouge pendant la manipulation
      }
    }
  }, []);

  const clearHighlight = useCallback(() => {
    if (!renditionRef.current) return;
    const contentsArr = renditionRef.current.getContents();
    if (!contentsArr || !contentsArr.length) return;
    
    const iframeDoc = contentsArr[0].document;
    const spans = iframeDoc.querySelectorAll('.tts-active-word');
    spans.forEach(span => {
      const parent = span.parentNode;
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
      parent.normalize();
    });
  }, []);

  return (
    <div style={{width:'100%', height:'100%', position:'relative', background:'#f3f4f6'}}>
      {/* Le viewer epub.js : hauteur 100% explicitement pour que epub.js le mesure correctement */}
      <div 
        ref={viewerRef} 
        style={{width:'100%', height:'100%', background:'white'}}
      />
      
      {/* Zones de tap pour tourner la page manuellement */}
      <div 
        title="Page Précédente"
        style={{position:'absolute', top:0, left:0, width:'20%', height:'100%', zIndex:10, cursor:'pointer'}}
        onClick={() => { setIsPlaying(false); renditionRef.current?.prev(); }}
      />
      <div 
        title="Page Suivante"
        style={{position:'absolute', top:0, right:0, width:'20%', height:'100%', zIndex:10, cursor:'pointer'}}
        onClick={() => { setIsPlaying(false); renditionRef.current?.next(); }}
      />
    </div>
  );
};

export default Reader;
