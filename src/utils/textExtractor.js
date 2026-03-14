// src/utils/textExtractor.js
// Extraction du texte depuis l'iframe epub.js pour la synthèse vocale

/**
 * Extrait les nœuds texte d'une plage DOM précise gérée par epub.js
 * Utilise la `location` epub.js (CFIs début/fin) pour être mathématiquement parfait
 * de la première à la dernière lettre visible sur la page !
 *
 * @param {Document} iframeDoc - document de l'iframe epub.js
 * @param {object} rendition - Instance de `book.rendition` epub.js
 * @param {object} location - L'objet location avec start.cfi et end.cfi
 * @returns {Array<{node, text, element}>}
 */
export function extractTextNodes(iframeDoc) {
  if (!iframeDoc || !iframeDoc.body) return [];

  const nodes = [];
  const windowWidth = iframeDoc.defaultView?.innerWidth || 800;

  try {
    const walker = iframeDoc.createTreeWalker(
      iframeDoc.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const text = node.textContent.trim();
          if (!text) return NodeFilter.FILTER_REJECT;
          const tag = node.parentElement?.tagName?.toLowerCase();
          if (['script', 'style', 'noscript'].includes(tag)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const range = iframeDoc.createRange();
    let node;
    while ((node = walker.nextNode())) {
      range.selectNodeContents(node);
      const rects = range.getClientRects();
      if (!rects || rects.length === 0) continue;

      let isVisible = false;
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        // Rect est visible dans la vue paginée :
        if (r.right > 0 && r.left < windowWidth) {
          isVisible = true;
          break;
        }
      }

      if (isVisible) {
        nodes.push({
          node,
          text: node.textContent,
          offsetInNode: 0,
          element: node.parentElement,
        });
      }
    }
  } catch (e) {
    console.error("[TTS] Erreur d'extraction texte visuel", e);
  }

  return nodes;
}

/**
 * Découpe le texte brut en phrases pour le TTS.
 * Conserve les espaces/sauts de ligne internes pour ne pas casser le mapping d'index via indexOf.
 * @param {string} fullText
 * @returns {string[]}
 */
export function splitIntoSentences(fullText) {
  if (!fullText) return [];
  // Découpe sur . ! ? suivi d'un espace et d'une majuscule ou fin de texte
  // On ne fait PLUS de replace(/\s+/g, ' ') global ici, sinon indexOf retournera -1
  const raw = fullText
    .split(/(?<=[.!?…»])\s+(?=[A-ZÁÀÂÉÈÊËÎÏÔÙÛÜÇŒÆ«"—\-\d])/u);
  return raw.map(s => s.trim()).filter(s => s.length > 1);
}

/**
 * Extrait tout le texte VISIBLE de l'iframe epub.js en une seule chaîne.
 * (Utilise les dimensions des nœuds pour ne pas lire ce qui est sur les pages précédentes/suivantes).
 * @param {Document} iframeDoc
 * @returns {string}
 */
export function extractFullText(iframeDoc) {
  if (!iframeDoc?.body) return '';

  try {
    const walker = iframeDoc.createTreeWalker(
      iframeDoc.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const text = node.textContent.trim();
          if (!text) return NodeFilter.FILTER_REJECT;
          const tag = node.parentElement?.tagName?.toLowerCase();
          if (['script', 'style', 'noscript'].includes(tag)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const texts = [];
    const range = iframeDoc.createRange();
    const windowWidth = iframeDoc.defaultView?.innerWidth || 800;

    let node;
    while ((node = walker.nextNode())) {
      range.selectNodeContents(node);
      const rects = range.getClientRects();
      if (!rects || rects.length === 0) continue;

      let isVisible = false;
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        // Dans le mode paginé epub.js, les pages futures/passées 
        // sont translatées hors du viewport (left < 0 ou left >= windowWidth)
        if (r.right > 0 && r.left < windowWidth) {
          isVisible = true;
          break;
        }
      }

      if (isVisible) {
        texts.push(node.textContent);
      }
    }

    if (texts.length > 0) {
      return texts.join(' ').replace(/\s+/g, ' ').trim();
    }
  } catch (e) {
    console.warn('[extractFullText] Rect check failed, fallback to full extract', e);
  }

  // Fallback: si rien n'est trouvé ou si exception
  const clone = iframeDoc.body.cloneNode(true);
  clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
  return (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * Surligne un range dans l'iframe via la Selection API (sans modifier le DOM).
 * @param {Document} iframeDoc
 * @param {Node} startNode
 * @param {number} startOffset
 * @param {Node} endNode
 * @param {number} endOffset
 */
export function highlightRange(iframeDoc, startNode, startOffset, endNode, endOffset) {
  if (!iframeDoc) return;
  try {
    const sel = iframeDoc.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    const range = iframeDoc.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    sel.addRange(range);
  } catch (e) {
    // Ignore les erreurs de range invalide
  }
}

/**
 * Efface le surlignage de l'iframe.
 */
export function clearHighlight(iframeDoc) {
  if (!iframeDoc) return;
  try {
    const sel = iframeDoc.getSelection();
    if (sel) sel.removeAllRanges();
  } catch (e) {}
}
