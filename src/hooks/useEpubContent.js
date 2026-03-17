// src/hooks/useEpubContent.js
// Charge l'EPUB avec epub.js (parseur uniquement), extrait le HTML propre par chapitre.
// N'utilise AUCUN rendu epub.js dans une iframe : tout sort en HTML dans notre propre DOM.

import { useState, useRef, useCallback } from 'react';
import ePub from 'epubjs';
import { useReaderStore } from '../store/readerStore';

// ── Extraction HTML propre depuis un <body> de document EPUB ──────────────
// Traverse le DOM récursivement et ne garde que la sémantique utile.
function extractCleanHtml(body) {
  if (!body) return '';

  const SKIP = new Set(['script', 'style', 'head', 'meta', 'link', 'noscript']);

  function walk(node) {
    // Nœud texte : retourner le texte tel quel (les espaces sont importants pour le TTS)
    if (node.nodeType === 3 /* TEXT_NODE */) return node.textContent;
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return '';

    const tag = node.tagName.toLowerCase();
    if (SKIP.has(tag)) return '';

    const ch = Array.from(node.childNodes).map(walk).join('');

    switch (tag) {
      case 'p':
        return ch.trim() ? `<p>${ch}</p>` : '';
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        return ch.trim() ? `<${tag}>${ch}</${tag}>` : '';
      case 'em': case 'i':
        return ch ? `<em>${ch}</em>` : '';
      case 'strong': case 'b':
        return ch ? `<strong>${ch}</strong>` : '';
      case 'br':
        return '<br>';
      case 'img': {
        // Accepter toutes les sources (blob:, http:, data:, paths relatifs)
        // Les chemins relatifs ne s'afficheront pas mais le texte autour oui
        const src = node.getAttribute('src') || '';
        return src ? `<img src="${src}" alt="${node.getAttribute('alt') || ''}" class="epub-img">` : '';
      }
      case 'blockquote':
        return `<blockquote>${ch}</blockquote>`;
      case 'ul': return `<ul>${ch}</ul>`;
      case 'ol': return `<ol>${ch}</ol>`;
      case 'li': return `<li>${ch}</li>`;
      case 'a': return ch; // Garde le texte, pas le lien
      // Tout le reste (div, span, section, article, body...) → passe-plat
      default: return ch;
    }
  }

  const result = walk(body);

  // Fallback : si l'extraction est vide, récupérer le texte brut en paragraphes
  if (!result.trim()) {
    const text = body.textContent || '';
    if (!text.trim()) return '';
    // Découper par sauts de ligne en paragraphes
    return text
      .split(/\n{2,}/)
      .map(para => para.trim())
      .filter(para => para.length > 0)
      .map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  return result;
}

// ── Hook principal ────────────────────────────────────────────────────────
export function useEpubContent() {
  const { setEpubReady, setCurrentChapter, setCurrentChapterIdx, showToast } = useReaderStore();

  const bookRef     = useRef(null);
  const chaptersRef = useRef([]);   // [{ idx, spineIdx, href, title, html }]

  const [isLoading,       setIsLoading]       = useState(false);
  const [currentHtml,     setCurrentHtml]     = useState('');
  const [localChapterIdx, setLocalChapterIdx] = useState(0);
  const [totalChapters,   setTotalChapters]   = useState(0);
  const [bookMeta,        setBookMeta]        = useState(null);
  
  // Weights for ultra-precise progress calculation
  const [chapterWeights,  setChapterWeights]  = useState({ offsets: [], weights: [], total: 0 });

  // ── Calcule le poids textuel brut de chaque chapitre sans bloquer l'UI ni crasher la RAM ──
  const computeChapterWeights = async (chaps, bookObj) => {
    let total = 0;
    const weights = new Array(chaps.length).fill(100);
    const offsets = new Array(chaps.length).fill(0);
    
    // Pour chaque chapitre, récupérer le texte brut sans le mettre en cache
    for (let i = 0; i < chaps.length; i++) {
        try {
            const item = bookObj.spine.get(chaps[i].spineIdx);
            
            // Évite item.load() qui garde le document en RAM (provoquant des crashs React)
            // Passe direct via book.load qui retourne le Document XML, qu'on lit, puis qui est garbagé
            let textLen = 50;
            if (item.href) {
               const doc = await bookObj.load(item.href);
               const body = doc?.querySelector?.('body') ?? doc?.getElementsByTagName?.('body')?.[0] ?? doc;
               textLen = body?.textContent?.length || 50;
            }
            
            const size = Math.max(textLen, 10);
            weights[i] = size;
            total += size;
        } catch(e) {
            weights[i] = 100;
            total += 100;
        }
        // Attendre 20ms entre chaque chapitre pour laisser le navigateur souffler (évite le freeze)
        await new Promise(r => setTimeout(r, 20));
    }
    
    // Normaliser en pourcentages stricts
    let cum = 0;
    for (let i = 0; i < chaps.length; i++) {
       offsets[i] = cum / total;
       weights[i] = weights[i] / total;
       cum += weights[i] * total;
    }
    
    setChapterWeights({ offsets, weights, total });
  };

  // ── Charge un chapitre par index ───────────────────────────────────────
  const loadChapter = useCallback(async (idx) => {
    const chapters = chaptersRef.current;
    if (!chapters.length || idx < 0 || idx >= chapters.length) return false;

    const chapter = chapters[idx];

    // Lazy-load le contenu HTML du chapitre
    if (!chapter.html) {
      try {
        const book = bookRef.current;
        // Préférer l'accès par index de spine (plus fiable que par href)
        const item = book.spine.get(chapter.spineIdx);
        if (!item) {
          console.warn('[EpubContent] item spine introuvable pour idx', chapter.spineIdx);
          return false;
        }

        console.log('[EpubContent] loading chapter', idx, 'href:', chapter.href);
        const doc = await item.load(book.load.bind(book));

        // epub.js retourne l'élément <html>, pas un objet Document
        // => utiliser querySelector('body') ou chercher body dans les enfants
        const body = doc?.querySelector?.('body')
          ?? doc?.getElementsByTagName?.('body')?.[0]
          ?? doc;  // fallback : traiter le nœud lui-même comme le body

        console.log('[EpubContent] body trouvé :', body?.tagName, '| nb enfants:', body?.childNodes?.length);

        if (!body) {
          chapter.html = '<p><em>[Chapitre sans contenu texte]</em></p>';
        } else {
          chapter.html = extractCleanHtml(body);
          console.log('[EpubContent] html extrait (100 chars):', chapter.html.slice(0, 100));
        }
      } catch (e) {
        console.error('[EpubContent] Erreur chargement chapitre', idx, e);
        chapter.html = `<p><em>[Erreur de chargement: ${e.message}]</em></p>`;
      }
    }

    setLocalChapterIdx(idx);
    setCurrentChapterIdx(idx);
    setCurrentHtml(chapter.html);
    setCurrentChapter(chapter.title);
    return true;
  }, [setCurrentChapter, setCurrentChapterIdx]);

  // ── Charge le livre EPUB depuis un File ───────────────────────────────
  const initBook = useCallback(async (file, savedChapterIdx = 0) => {
    setIsLoading(true);
    setEpubReady(false);
    setCurrentHtml('');

    if (bookRef.current) {
      try { bookRef.current.destroy(); } catch (_) {}
    }

    try {
      const buffer = await file.arrayBuffer();
      const book   = ePub(buffer);
      bookRef.current = book;

      // book.ready attend que tout soit chargé (spine, metadata, navigation)
      await book.ready;

      // Métadonnées — accessibles directement après book.ready
      const pkg  = book.package?.metadata || book.packaging?.metadata || {};
      const meta = {
        title:  pkg.title  || file.name || 'Sans titre',
        author: pkg.creator || pkg.author || '',
      };
      setBookMeta(meta);

      // Navigation (table des matières)
      const nav = book.navigation;

      // Construire la liste des chapitres depuis le spine
      const chapters = [];
      book.spine.each((item) => {
        const navItem = nav?.toc?.find(t => {
          const th = t.href?.split('#')[0];
          const ih = item.href?.split('#')[0];
          return th && ih && (ih.endsWith(th) || th.endsWith(ih) || ih.includes(th) || th.includes(ih));
        });
        chapters.push({
          idx:      chapters.length,
          spineIdx: item.index,     // index numérique dans le spine
          href:     item.href,
          title:    navItem?.label?.trim() || `Chapitre ${chapters.length + 1}`,
          html:     null,           // chargé en lazy
        });
      });

      console.log('[EpubContent] Nombre de chapitres:', chapters.length);
      chaptersRef.current = chapters;
      setTotalChapters(chapters.length);

      if (chapters.length === 0) {
        showToast('❌ Aucun chapitre trouvé dans ce fichier EPUB');
        setIsLoading(false);
        return null;
      }

      // Lancer le calcul du poids de chaque chapitre en arrière-plan (non bloquant)
      computeChapterWeights(chapters, book).catch(console.error);

      // Trouver le premier chapitre avec du contenu réel
      // On commence depuis l'index sauvegardé, mais si vide on avance
      let startIdx = Math.max(0, Math.min(savedChapterIdx, chapters.length - 1));
      await loadChapter(startIdx);

      // Si le premier chapitre chargé est vide (page de titre, image de couverture...)
      // on avance jusqu'au premier avec du texte substantiel
      if (!chapters[startIdx]?.html || chapters[startIdx].html.length < 80) {
        for (let i = startIdx + 1; i < chapters.length; i++) {
          await loadChapter(i);
          if (chapters[i]?.html && chapters[i].html.length > 80) {
            startIdx = i;
            break;
          }
        }
      }

      setEpubReady(true);
      setIsLoading(false);
      return meta;
    } catch (e) {
      console.error('[EpubContent] Erreur initBook', e);
      showToast('❌ Erreur lors du chargement du livre');
      setIsLoading(false);
      return null;
    }
  }, [setEpubReady, showToast, loadChapter, setCurrentHtml]);

  // ── Navigation entre chapitres ─────────────────────────────────────────
  const goNextChapter = useCallback(async () => {
    return await loadChapter(localChapterIdx + 1);
  }, [localChapterIdx, loadChapter]);

  const goPrevChapter = useCallback(async () => {
    return await loadChapter(localChapterIdx - 1);
  }, [localChapterIdx, loadChapter]);

  return {
    isLoading,
    currentHtml,
    localChapterIdx,
    totalChapters,
    chapterWeights,
    bookMeta,
    chaptersRef,
    initBook,
    loadChapter,
    goNextChapter,
    goPrevChapter,
  };
}
