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
    rendition.hooks.content.register((contents) => {
      const css = `
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          box-sizing: border-box !important;
        }
        .tts-active-word {
          background-color: var(--highlight-color, rgba(255, 255, 0, 0.4)) !important;
          border-radius: 2px;
          transition: background-color 0.2s ease;
        }
      `;
      contents.addStylesheetRules(css);
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
        }
        
        const start = fullText.length;
        fullText += text;
        const end = fullText.length;
        
        nodesMap.push({ node, start, end, text });
      }
    }

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

    // Gestion du cas où on tourne une page "sans texte" (ex: image de couverture)
    if (sentences.length === 0) {
      const timer = setTimeout(() => {
        renditionRef.current?.next();
      }, 1500);
      return () => clearTimeout(timer);
    }

    // On concatène toutes les phrases de la page pour le TTS
    const pageText = sentences.map(s => s.text).join(' ');
    const utterance = new SpeechSynthesisUtterance(pageText);
    utterance.lang = 'fr-FR';
    utterance.rate = ttsRate;

    // Surlignage dynamique
    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        highlightWordAtOffset(event.charIndex, event.charLength);
      }
    };

    utterance.onend = () => {
      clearHighlight();
      if (isPlaying) {
        console.log("TTS fin de page : nextPage automatique via Epubjs");
        renditionRef.current?.next();
      }
    };

    utterance.onerror = (e) => {
      console.error("Erreur Web Speech API :", e);
      setIsPlaying(false);
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.cancel(); // Vide le tampon
    window.speechSynthesis.speak(utterance);

    return () => {
      window.speechSynthesis.cancel();
      clearHighlight();
    };
  }, [isPlaying, sentences, ttsRate, setIsPlaying]);

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
    <div className="w-full h-full relative flex items-center justify-center bg-gray-100 dark:bg-gray-900 pb-[10vh]">
      <div 
        ref={viewerRef} 
        className="w-full h-full max-w-4xl mx-auto shadow-sm bg-white dark:bg-[#121212]"
      ></div>
      
      {/* Boutons transparents superposés pour tourner la page manuellement */}
      <div 
        title="Page Précédente"
        className="absolute top-0 left-0 w-[20%] h-full cursor-pointer z-10" 
        onClick={() => { setIsPlaying(false); renditionRef.current?.prev(); }}
      />
      <div 
        title="Page Suivante"
        className="absolute top-0 right-0 w-[20%] h-full cursor-pointer z-10" 
        onClick={() => { setIsPlaying(false); renditionRef.current?.next(); }}
      />
    </div>
  );
};

export default Reader;
