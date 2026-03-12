// ─── DOM Elements ───────────────────────────────────────────────────────────
const libraryView   = document.getElementById('library-view');
const readerView    = document.getElementById('reader-view');
const bookList      = document.getElementById('book-list');
const bookUpload    = document.getElementById('book-upload');
const viewer        = document.getElementById('viewer');
const titleElem     = document.getElementById('current-book-title');
const prevBtn       = document.getElementById('prev-page');
const nextBtn       = document.getElementById('next-page');
const backBtn       = document.getElementById('back-to-library');
const playPauseBtn  = document.getElementById('play-pause-btn');
const settingsBtn   = document.getElementById('settings-btn');
const settingsPanel  = document.getElementById('settings-panel');
const navPanelBtn    = document.getElementById('nav-panel-btn');
const navPanel       = document.getElementById('nav-panel');
const addBookmarkBtn = document.getElementById('add-bookmark-btn');
const bookmarksList  = document.getElementById('bookmarks-list');
const gotoPageInput  = document.getElementById('goto-page-input');
const gotoPageBtn    = document.getElementById('goto-page-btn');
const progressFill   = document.getElementById('progress-fill');
const pageInfo       = document.getElementById('page-info');
const rateSelect    = document.getElementById('rate-select');
const rateValue     = document.getElementById('rate-value');
const decreaseFontBtn = document.getElementById('decrease-font');
const increaseFontBtn = document.getElementById('increase-font');
const themeLightBtn   = document.getElementById('theme-light');
const themeDarkBtn    = document.getElementById('theme-dark');

// ─── State ───────────────────────────────────────────────────────────────────
let currentBook   = null;
let rendition     = null;
let currentCfi    = null;
let currentBookId = null;
let fontSize = parseInt(localStorage.getItem('reader_fontSize') || '100', 10);
const fontSizeDisplayEl = document.getElementById('font-size-display');
if (fontSizeDisplayEl) fontSizeDisplayEl.textContent = fontSize + '%';

let currentTheme = localStorage.getItem('reader_theme') || 'light';
let currentHighlightColor = localStorage.getItem('reader_highlightColor') || '#FFE033';

// Init TTS rate
const savedRate = localStorage.getItem('reader_playbackRate') || '1.0';
if (rateSelect) {
    rateSelect.value = savedRate;
    if (rateValue) rateValue.textContent = parseFloat(savedRate).toFixed(1) + 'x';
}

// Init Highlight Color Picker
const colorBtns = document.querySelectorAll('.color-btn');
if (colorBtns.length > 0) {
    colorBtns.forEach(btn => {
        if (btn.dataset.color === currentHighlightColor) {
            colorBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }
        btn.addEventListener('click', (e) => {
            colorBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentHighlightColor = e.target.dataset.color;
            localStorage.setItem('reader_highlightColor', currentHighlightColor);
            
            // Refresh in-progress highlight if it's currently on screen
            if (rendition && sentences.length > 0 && sentenceIdx >= 0 && sentenceIdx < sentences.length) {
                clearHighlight();
                highlightRange(sentences[sentenceIdx].charStart, sentences[sentenceIdx].text.length);
            }
        });
    });
}

// TTS — Google TTS uniquement via WebAudio (SpeechSynthesis/Acapela supprimé)
const globalTTSAudio = new Audio();
globalTTSAudio.referrerPolicy = 'no-referrer';
globalTTSAudio.preload = 'auto';

let isPlaying  = false;
let pendingAutoRead = false;
let isPaused   = false;

let sentences        = [];  // [{text, charStart}]
let sentenceIdx      = 0;
let textNodes        = [];  // [{node, start, end}]
let pageFullText     = '';
let iframeDoc        = null;

// ─── Background audio state (keep alive when screen is off) ─────────────────────
let audioCtx        = null;
let silentSource    = null;

let silentAudioEl   = null;
let silentWatchdog  = null;
let lastSpeakTime   = 0;
let wakeLock        = null;

// ─── Audio prefetch cache ─────────────────────────────────────────────────────────────
const PREFETCH_AHEAD = 6;
let prefetchCache   = new Map();
let prefetchInFlight = new Set();


console.log("EbookReader v20250311c — Google TTS only");

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
    // Two stores: one for large EPUB files, one for small metadata
    localforage.config({ name: 'EbookReader', storeName: 'books' });
    loadLibrary();
}

// ─── Library ─────────────────────────────────────────────────────────────────
bookUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const arrayBuffer = await file.arrayBuffer();
    const book = ePub(arrayBuffer);
    const metadata = await book.loaded.metadata;

    // ID déterministe (Le MÊME livre sur PC ou sur le téléphone aura la même "plaque d'immatriculation")
    const rawId = (metadata.title || file.name) + '_' + (metadata.creator || file.size);
    // On nettoie la chaîne pour éviter les problèmes de clés dans le LocalStorage
    const id = 'book_' + btoa(encodeURIComponent(rawId)).replace(/[^a-zA-Z0-9]/g, '').substring(0, 40);

    // Convert cover blob URL → data URL (blob URLs die on page reload)
    let coverDataUrl = null;
    try {
        const blobUrl = await book.coverUrl();
        if (blobUrl) {
            const resp = await fetch(blobUrl);
            const blob = await resp.blob();
            coverDataUrl = await new Promise(res => {
                const r = new FileReader();
                r.onload = () => res(r.result);
                r.readAsDataURL(blob);
            });
        }
    } catch(_) {}

    // Store file and metadata separately so progress saves stay fast and small
    await localforage.setItem(`${id}_file`, arrayBuffer);
    await localforage.setItem(`${id}_meta`, {
        id, title: metadata.title || file.name,
        author: metadata.creator || 'Auteur inconnu',
        coverDataUrl, progress: 0, cfi: null
    });
    e.target.value = '';
    loadLibrary();
});

async function loadLibrary() {
    bookList.innerHTML = '';
    const keys = await localforage.keys();
    const metaKeys = keys.filter(k => k.endsWith('_meta'));

    if (!metaKeys.length) {
        bookList.innerHTML = `
            <div class="empty-library">
                <i class="fas fa-book-open"></i>
                <h2>Votre bibliothèque est vide</h2>
                <p>Cliquez sur "Ajouter un EPUB" pour commencer.</p>
            </div>`;
        return;
    }
    for (const key of metaKeys) {
        const meta = await localforage.getItem(key);
        if (!meta) continue;
        const coverSrc = meta.coverDataUrl || `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect fill="%232a313c" width="200" height="300"/><text fill="%23aaa" font-family="sans-serif" font-size="16" x="100" y="150" text-anchor="middle">Sans couverture</text></svg>`;
        const card = document.createElement('div');
        card.className = 'book-card';
        card.innerHTML = `
            <img class="book-cover" src="${coverSrc}" alt="cover">
            <div class="book-title">${meta.title}</div>
            <div class="book-author">${meta.author}</div>
            <button class="remove-btn" title="Supprimer" onclick="event.stopPropagation();deleteBook('${meta.id}')"><i class="fas fa-times"></i></button>
            <div class="book-progress"><div class="book-progress-fill" style="width:${meta.progress || 0}%"></div></div>`;
        card.onclick = () => openBook(meta);
        bookList.appendChild(card);
    }
}

window.deleteBook = async (id) => {
    if (confirm('Supprimer ce livre ?')) {
        await localforage.removeItem(`${id}_file`);
        await localforage.removeItem(`${id}_meta`);
        localStorage.removeItem(`cfi_${id}`);
        loadLibrary();
    }
};

// ─── Reader ───────────────────────────────────────────────────────────────────
async function openBook(meta) {
    currentBookId = meta.id;
    titleElem.textContent = meta.title;
    libraryView.classList.remove('active');
    readerView.classList.add('active');

    // Load file separately (not stored in meta)
    const arrayBuffer = await localforage.getItem(`${meta.id}_file`);
    if (!arrayBuffer) {
        alert('Fichier introuvable. Veuillez réimporter le livre.');
        libraryView.classList.add('active');
        readerView.classList.remove('active');
        return;
    }

    currentBook = ePub(arrayBuffer);
    rendition = currentBook.renderTo('viewer', {
        width: '100%', height: '100%',
        spread: 'none', flow: 'paginated'
    });

    applyAppearance();
    // CFI is stored in localStorage (synchronous = survives page reload)
    const savedCfi = localStorage.getItem(`cfi_${meta.id}`);
    console.log('Reprise à la position CFI:', savedCfi);
    rendition.display(savedCfi || undefined);

    if (pageInfo) pageInfo.textContent = "Calcul des pages...";

    currentBook.ready
        .then(() => currentBook.locations.generate(1600))
        .then(() => {
            console.log('[pagination] Calcul terminé');
            updateProgress();
        });

    let isInitialRelocation = true;
    rendition.on('relocated', (loc) => {
        currentCfi = loc.start.cfi;
        updateProgress();
        
        if (isInitialRelocation) {
            isInitialRelocation = false;
            // Ne pas écraser la date de sauvegarde au premier rendu,
            // pour ne pas corrompre le timestamp de la synchronisation cloud
        } else {
            saveProgress(loc.start.cfi);
        }

        // relocated fires AFTER currentLocation() is updated with the new page coordinates.
        if (pendingAutoRead && isPlaying && !isPaused) {
            pendingAutoRead = false;
            lastSpeakTime = Date.now();
            startPageReading();
        } else if (isPlaying && !isPaused) {
            // Lecture synchrone intra-chapitre
            if (typeof updateVisualBoundariesOnly === 'function') updateVisualBoundariesOnly();
        }
    });

    rendition.on('rendered', () => {
        injectHighlightStyleAndClickListener();
    });

    rendition.on('click', () => settingsPanel.classList.add('hidden'));

    // Swipe left/right to turn pages (mobile)
    addSwipeListeners(viewer);
}

// ─── Navigation sûre : contourne le bug epubjs qui bloque sur la "fausse" dernière page ─
// epub.js utilise des colonnes CSS. Parfois la dernière colonne dépasse du conteneur
// mais epub.js refuse d'avancer car il croit être déjà à la fin.
// safeNext() vérifie si le scrollWidth de l'iframe dépasse la largeur attendue,
// et si oui, force le passage au chapitre suivant via l'API spine directement.
async function safeNext() {
    if (!rendition) return;
    const loc = rendition.currentLocation();
    const displayed = loc?.start?.displayed;
    
    // Si epub.js pense être sur la dernière page du chapitre → on force la spine.
    // On ne fait plus de détection de scrollWidth (trop peu fiable selon le navigateur).
    // Si on est vraiment sur la dernière page du dernier chapitre, nextItem sera null
    // et on retombe sur rendition.next() qui ne fera rien (fin du livre).
    if (displayed && displayed.page >= displayed.total) {
        try {
            const spineItem = currentBook.spine.get(loc.start.cfi);
            if (spineItem) {
                const nextItem = currentBook.spine.get(spineItem.index + 1);
                if (nextItem) {
                    console.log('[safeNext] Dernière page → passage direct au chapitre suivant via spine');
                    rendition.display(nextItem.href);
                    return;
                }
            }
        } catch(e) {
            console.error('[safeNext] Erreur passage spine:', e);
        }
    }
    
    // Sinon, navigation normale entre pages du même chapitre
    rendition.next();
}

// ─── Swipe gesture support ────────────────────────────────────────────────────
let swipeTouchStartX = 0;
let swipeTouchStartY = 0;
let lastTapTime = 0;  // prevents double-trigger: touchend tap + synthetic click

function addSwipeListeners(el) {
    el.addEventListener('touchstart', (e) => {
        swipeTouchStartX = e.changedTouches[0].screenX;
        swipeTouchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    el.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].screenX - swipeTouchStartX;
        const dy = e.changedTouches[0].screenY - swipeTouchStartY;

        // Only count as horizontal swipe if dx > dy (not a scroll)
        if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;

        if (dx < 0) {
            // Swipe left → next page
            stopReading(); safeNext();
        } else {
            // Swipe right → previous page
            stopReading(); if (rendition) rendition.prev();
        }
    }, { passive: true });
}

// Unified touch handler inside the EPUB iframe:
//   - Short tap (< 15 px movement) → click-to-read at the touched position
//   - Horizontal swipe (> 50 px)   → next / prev page
function addIframeSwipeListeners(doc) {
    if (!doc) return;

    let tapStartX = 0, tapStartY = 0, tapStartTime = 0;

    doc.addEventListener('touchstart', (e) => {
        const t = e.changedTouches[0];
        swipeTouchStartX = t.screenX;
        swipeTouchStartY = t.screenY;
        tapStartX = t.clientX;   // client coords for caretRangeFromPoint
        tapStartY = t.clientY;
        tapStartTime = Date.now();
    }, { passive: true });

    doc.addEventListener('touchend', (e) => {
        const t = e.changedTouches[0];
        const dx = t.screenX - swipeTouchStartX;
        const dy = t.screenY - swipeTouchStartY;
        const dist = Math.hypot(dx, dy);

        // ── TAP (< 15 px, < 400 ms): start / redirect reading ──
        if (dist < 15 && Date.now() - tapStartTime < 400) {
            handleTapToRead(doc, tapStartX, tapStartY);
            return;
        }

        // ── SWIPE (horizontal, > 50 px): page turn ──
        if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)) {
            if (dx < 0) { stopReading(); safeNext(); }
            else        { stopReading(); if (rendition) rendition.prev(); }
        }
    }, { passive: true });
}

// Find the tapped sentence in the iframe and start / redirect reading
function handleTapToRead(doc, clientX, clientY) {
    // Si le panneau de paramètres est ouvert, le clic sert uniquement à le fermer (pas de lecture)
    if (!settingsPanel.classList.contains('hidden')) {
        settingsPanel.classList.add('hidden');
        lastTapTime = Date.now(); // Évite le faux clic synthétique 300ms plus tard
        return;
    }

    let clickedCharIndex = -1;
    try {
        let range;
        if (doc.caretRangeFromPoint) {
            range = doc.caretRangeFromPoint(clientX, clientY);
        } else if (doc.caretPositionFromPoint) {
            const pos = doc.caretPositionFromPoint(clientX, clientY);
            if (pos) { range = doc.createRange(); range.setStart(pos.offsetNode, pos.offset); }
        }
        if (range && textNodes.length) {
            const node   = range.startContainer;
            const offset = range.startOffset;
            for (const tn of textNodes) {
                if (tn.node === node) {
                    clickedCharIndex = tn.start + offset;
                    break;
                }
            }
        }
    } catch(err) {
        console.error('handleTapToRead error:', err);
    }

    // Mark this tap as handled — the synthetic click (~300ms later) will be ignored
    lastTapTime = Date.now();

    if (!isPlaying) {
        // Start reading from the tapped sentence
        isPlaying   = true;
        isPaused    = false;
        sentenceIdx = 0;
        setPlayIcon('pause');
        startBackgroundSession();
        startPageReadingThenSeek(clickedCharIndex);
    } else if (isPaused) {
        isPaused = false;
        setPlayIcon('pause');
        if (clickedCharIndex >= 0 && sentences.length) {
            sentenceIdx = findSentenceIdx(clickedCharIndex);
        }
        readSentence(sentenceIdx);
    } else {
        // Already playing — jump to tapped sentence
        if (clickedCharIndex >= 0 && sentences.length) {
            sentenceIdx = findSentenceIdx(clickedCharIndex);
            setTimeout(() => readSentence(sentenceIdx), 80);
        }
    }
}

function injectHighlightStyleAndClickListener() {
    try {
        const contents = rendition.getContents();
        if (!contents || !contents.length) return;
        const doc = contents[0].document;
        if (!doc) return;

        // Inject highlight CSS
        const old = doc.getElementById('reader-hl-style');
        if (old) old.remove();
        const style = doc.createElement('style');
        style.id = 'reader-hl-style';
        style.textContent = `
            ::selection {
                background-color: #FFE033 !important;
                color: #000 !important;
            }
            body { 
                cursor: text; 
            }
        `;
        doc.head.appendChild(style);

        // Apply font size and theme colors directly into the new iframe (fallback for mobile)
        applyAppearance();

        // Touch swipe in the iframe to turn pages (mobile)
        addIframeSwipeListeners(doc);

        // Click-to-read: clicking on any sentence starts / redirects reading
        doc.body.addEventListener('click', (e) => {
            // Si le panneau paramètre est ouvert, on annule l'action de lecture pour se contenter de fermer le panneau
            if (!settingsPanel.classList.contains('hidden')) {
                settingsPanel.classList.add('hidden');
                return;
            }

            // On mobile a tap fires touchend (handled) THEN a synthetic click ~300ms later.
            // Ignore that synthetic click to avoid reading the same sentence twice.
            if (Date.now() - lastTapTime < 500) return;

            // Find the character offset of the click position
            let clickedCharIndex = -1;
            try {
                let range;
                if (doc.caretRangeFromPoint) {
                    range = doc.caretRangeFromPoint(e.clientX, e.clientY);
                } else if (doc.caretPositionFromPoint) {
                    const pos = doc.caretPositionFromPoint(e.clientX, e.clientY);
                    range = doc.createRange();
                    range.setStart(pos.offsetNode, pos.offset);
                }
                if (range) {
                    const clickedNode = range.startContainer;
                    const clickedOffset = range.startOffset;

                    // If we already have textNodes built (reading was started), use them
                    if (textNodes.length) {
                        for (const tn of textNodes) {
                            if (tn.node === clickedNode) {
                                clickedCharIndex = tn.start + clickedOffset;
                                break;
                            }
                        }
                    }
                }
            } catch(err) {
                console.error('Click-to-read: erreur de position:', err);
            }

            if (!isPlaying) {
                // Reading was stopped — start fresh, then after the page is parsed
                // jump to the clicked sentence
                isPlaying = true;
                isPaused  = false;
                sentenceIdx = 0;
                setPlayIcon('pause');
                startBackgroundSession();

                // We start the page, then seek once sentences are built
                startPageReadingThenSeek(clickedCharIndex);
            } else if (isPaused) {
                // Was paused — resume at clicked position
                isPaused = false;
                setPlayIcon('pause');
                if (clickedCharIndex >= 0 && sentences.length) {
                    let targetIdx = findSentenceIdx(clickedCharIndex);
                    sentenceIdx = targetIdx;
                }
                readSentence(sentenceIdx);
            } else {
                // Already playing — jump to clicked sentence
                if (clickedCharIndex >= 0 && sentences.length) {
                    let targetIdx = findSentenceIdx(clickedCharIndex);
                    sentenceIdx = targetIdx;
                    setTimeout(() => readSentence(sentenceIdx), 80);
                }
            }
        });
    } catch(e) {}
}

function updateProgress() {
    if (!currentCfi && rendition && rendition.currentLocation()) {
        currentCfi = rendition.currentLocation()?.start?.cfi;
    }
    if (currentBook?.locations?.length() > 0 && currentCfi) {
        const pct = Math.round(currentBook.locations.percentageFromCfi(currentCfi) * 100);
        progressFill.style.width = pct + '%';
        
        // Update page info
        const currentPage = currentBook.locations.locationFromCfi(currentCfi);
        const totalPages = currentBook.locations.total || 0;
        if (pageInfo && totalPages > 0 && currentPage >= 0) {
            pageInfo.textContent = `Page ${currentPage} sur ${totalPages}`;
        }

        // Save progress % to localforage (async is fine for this non-critical data)
        localforage.getItem(`${currentBookId}_meta`).then(meta => {
            if (meta) { meta.progress = pct; localforage.setItem(`${currentBookId}_meta`, meta); }
        });
    } else if (pageInfo && (!currentBook || currentBook.locations.length() === 0)) {
        // En attente du calcul
        pageInfo.textContent = "Calcul des pages...";
    }
}

function saveProgress(cfi) {
    // localStorage is SYNCHRONOUS — survives F5/page reload immediately
    if (!currentBookId) return;
    localStorage.setItem(`cfi_${currentBookId}`, cfi);
    localStorage.setItem(`last_${currentBookId}`, Date.now().toString());
    if (typeof window.requestCloudSync === 'function') window.requestCloudSync();
}

function closeReader() {
    stopReading();
    currentBook?.destroy();
    viewer.innerHTML = '';
    currentBook = rendition = null;
    readerView.classList.remove('active');
    libraryView.classList.add('active');
    loadLibrary();
}

// ─── Nav buttons ─────────────────────────────────────────────────────────────
prevBtn.onclick = () => { stopReading(); if (rendition) rendition.prev(); };
nextBtn.onclick = () => { stopReading(); safeNext(); };
backBtn.onclick = closeReader;

settingsBtn.onclick = () => {
    settingsPanel.classList.toggle('hidden');
    navPanel.classList.add('hidden');
};
navPanelBtn.onclick = () => {
    navPanel.classList.toggle('hidden');
    settingsPanel.classList.add('hidden');
    renderBookmarks();
};
document.addEventListener('click', (e) => {
    if (!settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) {
        settingsPanel.classList.add('hidden');
    }
    if (!navPanel.contains(e.target) && !navPanelBtn.contains(e.target)) {
        navPanel.classList.add('hidden');
    }
});
decreaseFontBtn.addEventListener('click', () => {
    if (fontSize > 50) {
        fontSize -= 25;
        localStorage.setItem('reader_fontSize', fontSize);
        applyAppearance(true);
    }
});
increaseFontBtn.addEventListener('click', () => {
    if (fontSize < 400) {
        fontSize += 25;
        localStorage.setItem('reader_fontSize', fontSize);
        applyAppearance(true);
    }
});
if (themeLightBtn) {
    themeLightBtn.addEventListener('click', () => {
        currentTheme = 'light';
        localStorage.setItem('reader_theme', currentTheme);
        applyAppearance();
    });
}
if (themeDarkBtn) {
    themeDarkBtn.addEventListener('click', () => {
        currentTheme = 'dark';
        localStorage.setItem('reader_theme', currentTheme);
        applyAppearance();
    });
}

function applyAppearance(layoutChanged = false) {
    const display = document.getElementById('font-size-display');
    if (display) display.textContent = fontSize + '%';

    // Ajuste la taille du panneau paramètres (DOM parent, hors iframe)
    const settingsPanelEl = document.getElementById('settings-panel');
    if (settingsPanelEl) settingsPanelEl.style.fontSize = (fontSize / 100) + 'rem';

    if (themeLightBtn && themeDarkBtn) {
        if (currentTheme === 'light') {
            themeLightBtn.style.background = 'var(--primary-color)';
            themeLightBtn.style.color = '#fff';
            themeDarkBtn.style.background = 'rgba(255,255,255,0.1)';
            themeDarkBtn.style.color = '#fff';
        } else {
            themeDarkBtn.style.background = 'var(--primary-color)';
            themeDarkBtn.style.color = '#fff';
            themeLightBtn.style.background = 'rgba(255,255,255,0.1)';
            themeLightBtn.style.color = '#fff';
        }
    }

    if (!rendition) return;

    // font-size en px absolus pour l'iframe courante + modifs CSS du theme
    const basePx = Math.round(16 * fontSize / 100);
    const bgColor = currentTheme === 'dark' ? '#0d1117' : '#ffffff';
    const textColor = currentTheme === 'dark' ? '#e6edf3' : '#000000';
    
    // Le parent .viewer-container doit aussi switcher
    if (viewer) {
        if (currentTheme === 'dark') {
            viewer.classList.add('dark-mode');
            viewer.style.background = '#0d1117';
        } else {
            viewer.classList.remove('dark-mode');
            viewer.style.background = '#ffffff';
        }
    }

    const css = `
        html, body { 
            font-size: ${basePx}px !important;
            background: ${bgColor} !important;
            color: ${textColor} !important;
            margin: 0 !important;
            padding: 0 0 10vh 0 !important;
        } 
        body * { 
            font-size: inherit !important;
            background-color: transparent !important;
            color: ${textColor} !important;
        }
    `;

    // Injection directe dans l'iframe (effet immédiat)
    try {
        const contents = rendition.getContents();
        if (contents && contents.length) {
            const doc = contents[0].document;
            let styleEl = doc.getElementById('reader-appearance');
            if (!styleEl) {
                styleEl = doc.createElement('style');
                styleEl.id = 'reader-appearance';
                doc.head.appendChild(styleEl);
            }
            styleEl.textContent = css;
        }
    } catch(e) { console.error('[app] Erreur injection CSS:', e); }

    // Via le thème EPUB.js (persistance entre pages)
    rendition.themes.default({
        'html': { 
            'font-size': basePx + 'px',
            'background': `${bgColor} !important`,
            'color': `${textColor} !important`,
            'margin': '0 !important'
        },
        'body': { 
            'background': `${bgColor} !important`,
            'color': `${textColor} !important`,
            'margin': '0 !important',
            'padding': '0 0 10vh 0 !important'
        },
        'body *': { 
            'font-size': 'inherit',
            'background-color': 'transparent !important',
            'color': `${textColor} !important`
        }
    });

    // Si la police change, epub.js perd le calcul des pages (displayed.total).
    // On doit forcer un rendu complet de la position actuelle pour qu'il recalcule tout.
    if (layoutChanged && currentCfi && rendition.location && rendition.location.start) {
        clearHighlight();
        
        let wasPlaying = (isPlaying && !isPaused);
        let oldSentenceIdx = sentenceIdx; // <-- SAUVEGARDE DE LA POSITION VOCALE EXACTE
        if (wasPlaying) pausePlaying(); 
        
        // On demande à epub.js de rouvrir le livre exactement au même mot (currentCfi)
        // en utilisant la nouvelle taille de colonne
        rendition.display(currentCfi).then(() => {
            // Re-cartographie du texte de la nouvelle iframe
            initChapterReadingState().then(() => {
                sentenceIdx = oldSentenceIdx; // <-- RESTAURATION À L'IDENTIQUE
                if (wasPlaying) {
                    resumePlaying();
                } else {
                    if (sentenceIdx >= 0 && sentenceIdx < sentences.length) {
                        highlightRange(sentences[sentenceIdx].charStart, sentences[sentenceIdx].text.length);
                    }
                }
            });
        });
    }
}

rateSelect.oninput = (e) => {
    const val = parseFloat(e.target.value).toFixed(1);
    rateValue.textContent = val + 'x';
    localStorage.setItem('reader_playbackRate', val);
    if (isPlaying && !isPaused) {
        stopTTSAudio();
        readSentence(sentenceIdx);
    }
};

// ─── Play / Pause ─────────────────────────────────────────────────────────────
playPauseBtn.onclick = () => {
    if (!isPlaying)  { startPlaying(); }
    else if (!isPaused) { pausePlaying(); }
    else             { resumePlaying(); }
};

function startPlaying() {
    if (!rendition) return;
    isPlaying = true;
    isPaused  = false;
    sentenceIdx = 0;
    setPlayIcon('pause');
    // Unlock audio on real user gesture
    globalTTSAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
    globalTTSAudio.play().catch(()=>{});
    requestWakeLock();  // Keep screen on during reading
    startBackgroundSession();
    startPageReading();
}

// Affiche un message temporaire dans le page-info (statut TTS)
let _ttsStatusTimer = null;
function showTtsStatus(msg) {
    if (!pageInfo) return;
    if (!msg) {
        // Restaurer le vrai texte de progression
        updateProgress();
        return;
    }
    pageInfo.textContent = msg;
    clearTimeout(_ttsStatusTimer);
    if (msg.startsWith('❌')) {
        // Garder le message d'erreur visible 5s
        _ttsStatusTimer = setTimeout(() => updateProgress(), 5000);
    }
}

function pausePlaying() {
    isPaused = true;
    globalTTSAudio.onended = null;
    globalTTSAudio.pause();

    // CRUCIAL : Mettre en pause les flux de silence, sinon Android croit que la musique
    // continue et laisse l'icône bloquée sur "Pause" dans la notification !
    if (typeof silentAudioEl !== 'undefined' && silentAudioEl) {
        silentAudioEl.pause();
    }
    if (typeof audioCtx !== 'undefined' && audioCtx && audioCtx.state === 'running') {
        audioCtx.suspend().catch(()=>{});
    }

    clearHighlight();
    setPlayIcon('play');
    releaseWakeLock();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
}

function resumePlaying() {
    isPlaying = true;
    isPaused = false;
    lastSpeakTime = Date.now();

    // Réactiver le son silencieux de fond pour rafraîchir le "media focus" d'Android
    if (typeof silentAudioEl !== 'undefined' && silentAudioEl && silentAudioEl.paused) {
        silentAudioEl.play().catch(()=>{});
    }
    if (typeof audioCtx !== 'undefined' && audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(()=>{});
    }

    // NE JAMAIS faire globalTTSAudio.play() sur le buffer existant après une pause en arrière-plan !
    // Android vide agressivement le buffer des <audio> en pause pour libérer de la RAM.
    // Résultat : play() reste suspendu à l'infini sans déclencher d'erreur.
    // Solution : On force toujours le rechargement propre de la phrase courante.
    readSentence(sentenceIdx);

    setPlayIcon('pause');
    requestWakeLock();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
}



function stopReading() {
    isPlaying  = false;
    isPaused   = false;
    pendingAutoRead = false;
    sentenceIdx = 0;
    stopSpeaking();
    setPlayIcon('play');
    stopBackgroundSession();
    releaseWakeLock();
}

// ─── Wake Lock (empêche l'écran de s'éteindre automatiquement) ─────────────────
async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('🔒 Wake Lock acquis — l\'écran restera allumé');
        wakeLock.addEventListener('release', () => {
            console.log('🔓 Wake Lock libéré');
        });
    } catch(e) {
        console.warn('Wake Lock impossible:', e);
    }
}

function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
    }
}

// (visibilitychange is handled below, after setupMediaSession)

function stopSpeaking() {
    stopTTSAudio();
    clearHighlight();
}

function setPlayIcon(icon) {
    playPauseBtn.innerHTML = `<i class="fas fa-${icon}"></i>`;
    if (icon === 'pause') playPauseBtn.classList.add('playing');
    else playPauseBtn.classList.remove('playing');
}

// ─── Background / screen-off audio session ──────────────────────────────────
//
// Stratégie en 3 couches :
//  1. silentAudioEl (silent_1h.mp3 loop) → maintient la SESSION MÉDIA vivante.
//     C'est ce qui empêche Android de suspendre complètement le JS.
//  3. silentWatchdog (setInterval 2s) → détecte si l'audio est complètement mort
//     et relance readSentence si besoin.
//
function startBackgroundSession() {
    // ─ Couche 1 : HTML5 Audio silencieux (garde la session média active) ─────
    if (!silentAudioEl) {
        silentAudioEl = document.getElementById('silent-audio');
        if (!silentAudioEl) {
            silentAudioEl = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==');
        } else if (!silentAudioEl.src) {
            silentAudioEl.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
        }
        silentAudioEl.loop = true;
        silentAudioEl.volume = 0.001; // Quasi-inaudible mais non nul (important !)
    }
    silentAudioEl.play().catch(e => console.warn('silentAudioEl:', e));

    // ─ Web Audio API : bruit blanc infime (double protection) ───────────────
    try {
        if (!audioCtx || audioCtx.state === 'closed') {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const sr = audioCtx.sampleRate;
            const buffer = audioCtx.createBuffer(1, sr, sr);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.0001;
            silentSource = audioCtx.createBufferSource();
            silentSource.buffer = buffer;
            silentSource.loop = true;
            silentSource.connect(audioCtx.destination);
            silentSource.start(0);
        } else if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    } catch(e) { console.warn('WebAudio background:', e); }

    // ─ Couche 3 : Watchdog de relance complète ───────────────────────────────
    // Le silentAudioEl doit battre en permanence pour que la notification Android
    // reste affichée même entre deux phrases (quand globalTTSAudio est en pause).
    clearInterval(silentWatchdog);
    silentWatchdog = setInterval(() => {
        if (!isPlaying || isPaused || pendingAutoRead) return;
        // Maintenir silentAudioEl en vie à tout moment (battement de cœur de la notification)
        if (silentAudioEl && silentAudioEl.paused) silentAudioEl.play().catch(() => {});
        // Relancer si plus aucun audio TTS ne joue depuis 4s
        if (globalTTSAudio.paused && Date.now() - lastSpeakTime > 4000) {
            showTtsStatus('⏳ Réveil audio...'); console.warn('Watchdog');
            readSentence(sentenceIdx);
        }
    }, 1500);

    setupMediaSession();
}


function stopBackgroundSession() {
    clearInterval(silentWatchdog);
    silentWatchdog = null;
    try {
        if (silentAudioEl) silentAudioEl.pause();
        silentSource?.stop();
        audioCtx?.close();
    } catch(e) {}
    audioCtx = null;
    silentSource = null;
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none';
    }
}

// Registers the app as a media player so lock screen controls appear on Android/iOS
function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    const title = titleElem?.textContent || 'EbookReader';
    navigator.mediaSession.metadata = new MediaMetadata({
        title: title,
        artist: 'EbookReader',
        album: 'Lecture audio',
        artwork: [
            { src: 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="18" fill="%230d1117"/><text y="68" x="48" font-size="60" text-anchor="middle" font-family="serif">📖</text></svg>`), sizes: '96x96', type: 'image/svg+xml' }
        ]
    });
    navigator.mediaSession.playbackState = 'playing';

    // Lock screen buttons
    navigator.mediaSession.setActionHandler('play', () => {
        if (!isPlaying || isPaused) resumePlaying();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
        if (isPlaying && !isPaused) pausePlaying();
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
        if (!isPlaying || !rendition) return;
        pendingAutoRead = true; // Continuer la lecture à la prochaine page
        rendition.next();
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
        if (!isPlaying || !rendition) return;
        pendingAutoRead = true;
        rendition.prev();
    });

    console.log('MediaSession configurée - Contrôles sur écran de verrouillage actifs');
}

// Watchdog de reprise au rallumage de l'écran.
// NE PAS couper le TTS à l'extinction : laisser l'OS décider.
// Relancer seulement si le navigateur l'a mis en pause ou rechargé la page.
document.addEventListener('visibilitychange', async () => {
    if (document.hidden) {
        console.log('📱 Passage en arrière-plan — audio continu');
        return;
    }

    // Ralentir un peu pour laisser le navigateur finir de réactiver l'iframe
    await new Promise(r => setTimeout(r, 800));

    if ('mediaSession' in navigator && isPlaying) {
        navigator.mediaSession.playbackState = isPaused ? 'paused' : 'playing';
    }

    if (!isPlaying || isPaused) return;

    // 1. Réactiver le flux de fond silencieux si Android l'a coupé
    if (silentAudioEl && silentAudioEl.paused) silentAudioEl.play().catch(() => {});
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

    // 2. Vérifier si l'iframe est toujours valide (Android recharge parfois la page)
    let iframeStillValid = false;
    try {
        const contentsArr = rendition?.getContents?.();
        if (contentsArr && contentsArr.length) {
            const doc = contentsArr[0].document;
            // Vérifier que le DOM de l'iframe a du contenu (n'a pas été rechargé vide)
            iframeStillValid = !!(doc && doc.body && doc.body.innerText.trim().length > 0);
        }
    } catch(e) {
        iframeStillValid = false;
    }

    if (!iframeStillValid) {
        // L'iframe a été détruite → naviguer vers la position CFI sauvegardée
        console.log('📱 Iframe invalide au rallumage — navigation vers CFI sauvegardée');
        const savedCfi = localStorage.getItem(`cfi_${currentBookId}`);
        if (savedCfi && rendition) {
            pendingAutoRead = true; // Relancer la lecture quand 'relocated' arrive
            await rendition.display(savedCfi);
        }
        return;
    }

    // 3. Iframe valide mais audio mort → relancer la phrase courante
    if (globalTTSAudio.paused) {
        console.log('📱 Audio mort au rallumage — relance phrase', sentenceIdx);

        // Réappliquer le surlignage sur la phrase courante (il peut avoir disparu)
        if (sentences[sentenceIdx]) {
            const s = sentences[sentenceIdx];
            highlightRange(s.charStart, s.text.length);
        }

        readSentence(sentenceIdx);
    }
});

// Also sync MediaSession state when pause/resume
const _origPause = pausePlaying;
const _origResume = resumePlaying;
// We don't override here since they're declared later with identical names;
// mediaSession state is updated in setPlayIcon


// ─── Page text extraction ────────────────────────────────────────────────────

// Build textNodes from the ENTIRE chapter (iframe body).
// No coordinate filtering here, this guarantees paragraphs are never brutally sliced
// and sentence boundary detection works perfectly.
function buildChapterTextNodes(doc) {
    const result = { textNodes: [], pageFullText: '' };
    if (!doc) return result;

    const walk  = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
    let node;

    while ((node = walk.nextNode())) {
        const text = node.textContent;
        // Don't skip empty nodes entirely if they contain spaces needed to un-stick words,
        // but for simplicity we skip purely empty ones.
        if (text.trim() === '') {
            // Include a space if it's purely whitespace so words don't merge across spans
            if (text.length > 0) {
                result.textNodes.push({ node,
                    start: result.pageFullText.length,
                    end:   result.pageFullText.length + 1 });
                result.pageFullText += ' ';
            }
            continue;
        }

        result.textNodes.push({ node,
            start: result.pageFullText.length,
            end:   result.pageFullText.length + text.length });
        result.pageFullText += text;
    }
    return result;
}

function getSentenceRect(doc, s) {
    let offset = s.charStart;
    // Skip leading whitespaces for more accurate rect positioning
    while (offset < s.charStart + s.text.length && /\s/.test(pageFullText[offset])) { offset++; }
    if (offset >= s.charStart + s.text.length) offset = s.charStart;

    let targetNode = null;
    let nodeOffset = 0;
    for (let tn of textNodes) {
        if (offset >= tn.start && offset < tn.end) {
            targetNode = tn.node;
            nodeOffset = offset - tn.start;
            break;
        }
    }

    if (!targetNode) return { top:0, left:0, right:0, bottom:0, width:0, height:0 };

    const range = doc.createRange();
    range.setStart(targetNode, nodeOffset);
    range.setEnd(targetNode, Math.min(nodeOffset + 1, targetNode.textContent.length));
    return range.getBoundingClientRect();
}

// Find which sentence index contains the given character offset
function findSentenceIdx(charIndex) {
    if (charIndex < 0 || !sentences.length) return 0;
    let targetIdx = 0;
    for (let i = 0; i < sentences.length; i++) {
        if (sentences[i].charStart <= charIndex) targetIdx = i;
        else break;
    }
    return targetIdx;
}

async function startPageReadingThenSeek(seekCharIndex) {
    if (!isPlaying || isPaused || !rendition) return;
    stopSpeaking();
    await initChapterReadingState();

    const startIdx = seekCharIndex >= 0 ? findSentenceIdx(seekCharIndex) : window.currentFirstVisibleSentence;
    readSentence(startIdx);
}

async function startPageReading() {
    if (!isPlaying || isPaused || !rendition) return;
    stopSpeaking();
    await initChapterReadingState();

    // Determine the start index:
    // If we have a saved index in local storage from a previous read, use it.
    // Otherwise fallback to the first visually visible sentence on the current page.
    let startIdx = window.currentFirstVisibleSentence;
    const savedSentenceIdx = parseInt(localStorage.getItem(`sentenceIdx_${currentBookId}`) || '-1', 10);
    
    // Resume from saved index if it is valid and belongs to the current page view
    // or if we just manually switched pages (in which case we probably want the top of the page anyway, 
    // but pendingAutoRead = true preserves the exact sentenceIdx over the turn)
    if (savedSentenceIdx >= window.currentFirstVisibleSentence && savedSentenceIdx <= window.currentLastVisibleSentence) {
        startIdx = savedSentenceIdx;
        console.log('Reprise à la phrase n°', startIdx);
    } else if (pendingAutoRead && savedSentenceIdx > window.currentLastVisibleSentence) {
        // Fallback safety
        startIdx = window.currentFirstVisibleSentence;
    }

    readSentence(startIdx);
}

async function initChapterReadingState() {
    sentenceIdx  = 0;
    sentences    = [];
    textNodes    = [];
    pageFullText = '';
    iframeDoc    = null;

    if (!rendition.currentLocation()) return;
    try {
        const contentsArr = rendition.getContents();
        if (!contentsArr || !contentsArr.length) return;
        iframeDoc = contentsArr[0].document;
    } catch(e) { console.error('Cannot get iframe doc:', e); return; }

    const built  = buildChapterTextNodes(iframeDoc);
    textNodes    = built.textNodes;
    pageFullText = built.pageFullText;

    if (!pageFullText.trim()) return;
    sentences = splitSentences(pageFullText);

    updateVisualBoundariesOnly();
}

function updateVisualBoundariesOnly() {
    if (!iframeDoc || !sentences.length || !rendition) return;

    // Compute visual boundaries
    const loc       = rendition.currentLocation();
    const displayed = loc?.start?.displayed;
    const totalPages = displayed?.total || 1;
    const page       = displayed?.page  || 1;

    const viewportWidth = iframeDoc.defaultView.innerWidth;
    const viewportHeight = iframeDoc.defaultView.innerHeight;

    window.currentFirstVisibleSentence = 0;
    // VERY IMPORTANT: fallback to end of chapter if calculation fails
    window.currentLastVisibleSentence = sentences.length - 1; 
    let foundFirst = false;

    // Find which sentences fall in the current viewport
    for (let i = 0; i < sentences.length; i++) {
        const rect = getSentenceRect(iframeDoc, sentences[i]);
        if (rect.width === 0 && rect.height === 0) continue;

        // Une phrase est visible si elle intersecte l'écran actuel (coordonnées relatives au viewport)
        if (rect.right > 0 && rect.left < viewportWidth && rect.bottom > 0 && rect.top < viewportHeight) {
            if (!foundFirst) {
                window.currentFirstVisibleSentence = i;
                foundFirst = true;
            }
            window.currentLastVisibleSentence = i;
        } else if (foundFirst && rect.left >= viewportWidth) {
            break; // On a trouvé la première phrase, et on est passé à droite de l'écran, on peut s'arrêter
        }
    }
    
    console.log(`[bounds updated] page ${page}/${totalPages}, idx ${window.currentFirstVisibleSentence} to ${window.currentLastVisibleSentence}`);
}

function splitSentences(text) {
    const result = [];
    // Découpage principal sur la ponctuation forte et sauts de ligne
    const re = /[^.!?\n]+[.!?\n]*/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        let snippet = m[0];
        let offset = m.index;
        
        // Sous-découpage pour Google TTS (limite ~200 chars), on sécurise à 160.
        while (snippet.length > 160) {
            let cutIndex = -1;
            // On cherche la dernière virgule, tiret ou deux-points dans les 160 premiers caractères
            const weakPunctuation = /[,;:\-—–]/g;
            let wm;
            while ((wm = weakPunctuation.exec(snippet.substring(0, 160))) !== null) {
                cutIndex = wm.index + wm[0].length; // Inclut la ponctuation
            }
            
            // Si aucune ponctuation faible, on cherche le dernier espace
            if (cutIndex === -1) {
                const spaceIndex = snippet.substring(0, 160).lastIndexOf(' ');
                cutIndex = spaceIndex > 0 ? spaceIndex + 1 : 160;
            }
            
            const chunk = snippet.substring(0, cutIndex);
            if (chunk.trim().length > 0) {
                result.push({ text: chunk, charStart: offset });
            }
            
            snippet = snippet.substring(cutIndex);
            offset += cutIndex;
        }
        
        if (snippet.trim().length > 0) {
            result.push({ text: snippet, charStart: offset });
        }
    }
    return result;
}

// ─── Sentence reader ──────────────────────────────────────────────────────────
function readSentence(idx) {
    if (!isPlaying || isPaused) return;

    // FIN DE CHAPITRE (tableau de phrases épuisé) : on doit charger le fichier HTML suivant.
    // L'audio s'arrête le temps du calcul, donc ça coupera si Android ferme l'accès écran éteint.
    if (idx >= sentences.length) {
        clearHighlight();
        localStorage.removeItem(`sentenceIdx_${currentBookId}`);
        if (isPlaying && !isPaused) {
            lastSpeakTime = Date.now();
            pendingAutoRead = true; // wait for 'relocated' to trigger read
            rendition?.next();
        }
        return;
    }

    // FIN DE PAGE (mais même chapitre) : audio continu synchronisé
    // On tourne VISUELLEMENT, mais l'audio s'enchaîne de façon continue dans le code
    // L'OS Android maintiendra le flux audio grâce au lecteur persistant et au silentAudioEl !
    if (idx > window.currentLastVisibleSentence) {
        if (isPlaying && !isPaused) {
            // Empêche de relancer rendition.next() en boucle avant que 'relocated' ne mette à jour la limite
            window.currentLastVisibleSentence = sentences.length;
            
            // Protection : Si epub.js pense qu'on est déjà à la dernière page du chapitre,
            // on l'empêche de sauter prématurément au chapitre suivant. On laisse l'audio
            // terminer de lire le texte invisible que epub.js a mal calculé.
            const loc = rendition.currentLocation();
            const displayed = loc?.start?.displayed;
            const isLastPage = displayed && (displayed.page >= displayed.total);
            
            if (!isLastPage) {
                rendition?.next();
            } else {
                console.warn("[TTS] Texte invisible en fin de chapitre. L'audio continue sans page turn prématuré.");
            }
            // On NE FAIT PAS return ! On continue à parler immédiatement pour garder l'OS éveillé !
        }
    }

    sentenceIdx = idx;
    localStorage.setItem(`sentenceIdx_${currentBookId}`, idx);
    localStorage.setItem(`last_${currentBookId}`, Date.now().toString());
    if (typeof window.requestCloudSync === 'function') window.requestCloudSync();
    
    lastSpeakTime = Date.now();
    const s = sentences[idx];

    // Highlight the sentence in the iframe DOM
    highlightRange(s.charStart, s.text.length);

    const lang = 'fr-FR'; // Google TTS langue fixée au français
    const rate = parseFloat(rateSelect.value);

    // ─── Google TTS via <audio> HTML5 — SANS proxy, SANS CORS ──────────────────
    // new Audio(url) ne subit pas de restriction CORS, contrairement à fetch().
    // C'est la méthode la plus fiable pour bypasser Acapela et les proxies cassés.
    playTTSAudio(idx, s.text, rate);
} // end readSentence


// ─── Moteur TTS : Google Translate avec 1 seul lecteur persistant ────────────
//
// Un unique `Audio` (globalTTSAudio) est instancié au chargement et débloqué au 1er play.
// Cela résout les problèmes d'Autoplay Policy d'Android qui bloquent
// la création dynamique d'éléments <audio> asynchrones, et permet
// de contourner l'attente infinie.
//
let ttsFailCount = 0;

async function playTTSAudio(idx, text, rate) {
    if (!isPlaying || isPaused) return;

    // Reset du lecteur commun pour la nouvelle phrase
    globalTTSAudio.pause();
    globalTTSAudio.onended = null;
    globalTTSAudio.onerror = null;
    globalTTSAudio.playbackRate = Math.min(Math.max(rate, 0.5), 2.0);

    const t200 = encodeURIComponent(text.trim().substring(0, 200));
    const random = Math.floor(Math.random() * 100000);
    // Appelle le point d'accès relatif (marche sur le Node local ET sur Vercel serverless)
    const serverUrl = '/api/tts';
    
    const urls = [
        `${serverUrl}?text=${t200}&cb=${random}`
    ];

    let currentUrlIdx = 0;

    const tryNext = () => {
        if (!isPlaying || isPaused) return;
        if (currentUrlIdx >= urls.length) {
            ttsFailCount++;
            console.error('[TTS] Échec total phrase', idx);
            if (ttsFailCount >= 3) {
                showTtsStatus('❌ Connexion Google TTS bloquée ou instable. Cliquez sur PAUSE puis PLAY pour relancer.');
                pausePlaying();
            } else {
                showTtsStatus('⏳ Erreur réseau, nouvelle tentative...');
                setTimeout(() => { if (isPlaying && !isPaused) readSentence(idx); }, 3000);
            }
            return;
        }

        const url = urls[currentUrlIdx++];
        console.log(`[TTS] Essai ${currentUrlIdx}: ${url.substring(0, 80)}...`);
        
        // Timeout de sécurité pour cette URL
        const loadTimer = setTimeout(() => {
            if (globalTTSAudio.src === url && (globalTTSAudio.paused || globalTTSAudio.readyState < 2)) {
                console.warn('[TTS] Timeout URL — essai suivant');
                tryNext();
            }
        }, 7000);

        globalTTSAudio.onended = () => {
            clearTimeout(loadTimer);
            ttsFailCount = 0;
            lastSpeakTime = Date.now();
            showTtsStatus('');
            if (isPlaying && !isPaused) readSentence(idx + 1);
        };

        globalTTSAudio.onerror = () => {
            clearTimeout(loadTimer);
            console.warn('[TTS] Erreur URL — essai suivant');
            tryNext();
        };

        globalTTSAudio.src = url;
        
        // Le navigateur réinitialise souvent le playbackRate après un changement de src.
        // On le force donc EXPLICITEMENT juste avant de jouer, avec defaultPlaybackRate en bonus de sécurité
        const safeRate = Math.min(Math.max(rate, 0.5), 2.0);
        globalTTSAudio.defaultPlaybackRate = safeRate;
        globalTTSAudio.playbackRate = safeRate;
        
        globalTTSAudio.play().catch(e => {
            // Autoplay peut être bloqué si le geste utilisateur est trop vieux
            console.warn('[TTS] play() bloqué ou erreur:', e.message);
            // On ne tryNext pas forcément ici, on laisse le onerror ou timeout agir
        });
    };

    tryNext();
}

// Arrête l'audio TTS
function stopTTSAudio() {
    globalTTSAudio.pause();
    globalTTSAudio.onended = null;
    globalTTSAudio.onerror = null;
}

// ─── Highlighting via Overlays absolus (non destructif, reste visible sans focus) ────────
function clearHighlight() {
    if (!iframeDoc) return;
    try {
        const old = iframeDoc.getElementById('tts-hl-container');
        if (old) old.remove();
        
        // Nettoyage de l'ancienne méthode de Selection (au cas où elle traîne)
        const sel = iframeDoc.getSelection();
        if (sel) sel.removeAllRanges();
    } catch(e) {}
}

function highlightRange(charStart, length) {
    clearHighlight();
    if (!iframeDoc || !textNodes.length) return;

    const charEnd = charStart + length;
    let startNode = null, startOffset = 0;
    let endNode   = null, endOffset   = 0;

    for (const tn of textNodes) {
        if (tn.end <= charStart) continue;
        if (tn.start >= charEnd) break;

        if (!startNode) {
            startNode   = tn.node;
            startOffset = Math.max(0, charStart - tn.start);
        }
        endNode   = tn.node;
        endOffset = Math.min(tn.node.textContent.length, charEnd - tn.start);
    }

    if (!startNode || !endNode) return;

    try {
        const range = iframeDoc.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);

        // Créer un calque conteneur pour les rectangles de surlignage
        const container = iframeDoc.createElement('div');
        container.id = 'tts-hl-container';
        container.style.position = 'absolute';
        container.style.top = '0';
        container.style.left = '0';
        container.style.pointerEvents = 'none'; // Laisser passer les clics au texte en dessous !
        container.style.zIndex = '9999';

        // Obtenir toutes les boîtes du texte (couvre les textes sur plusieurs lignes)
        const rects = range.getClientRects();
        const ifWin = iframeDoc.defaultView;
        
        for (const rect of Array.from(rects)) {
            const m = iframeDoc.createElement('div');
            m.style.position = 'absolute';
            m.style.left = (rect.left + ifWin.scrollX) + 'px';
            m.style.top = (rect.top + ifWin.scrollY) + 'px';
            m.style.width = rect.width + 'px';
            m.style.height = rect.height + 'px';
            
            // Apparence du surlignage :
            const isDark = (document.body.dataset.theme === 'dark' || currentTheme === 'dark');
            m.style.backgroundColor = currentHighlightColor;
            m.style.opacity = isDark ? '0.45' : '0.35'; // Assez transparent pour voir le texte
            m.style.borderRadius = '3px';
            // Un tout petit peu de marge pour envelopper le texte
            m.style.padding = '1px 2px';
            m.style.transform = 'translate(-2px, -1px)';
            
            container.appendChild(m);
        }
        
        // Ajouter à l'iframe
        iframeDoc.documentElement.appendChild(container);

        // Faire défiler automatiquement l'iframe vers la phrase si elle sort de l'écran (seulement en bas)
        const firstRect = rects[0];
        if (firstRect) {
            const bottom = firstRect.bottom;
            if (bottom > ifWin.innerHeight) {
                ifWin.scrollBy({ top: bottom - ifWin.innerHeight + 50, behavior: 'smooth' });
            }
        }
    } catch(e) {
        console.error('Highlight error:', e);
    }
}

// ─── Cloud Sync Live Updater ──────────────────────────────────────────────────
window.applyCloudUpdate = (cloudState) => {
    if (!currentBookId) return;
    
    // Si nous sommes dans le livre et que la position a changé
    const bookState = cloudState.books[currentBookId];
    if (bookState && bookState.cfi) {
        console.log("CloudUpdate: Application de la position de lecture distante:", bookState.cfi);
        
        // Stopper la lecture en cours si l'appli était en train de lire
        if (isPlaying) {
            stopReading();
        }
        
        // Mettre à jour l'interface avec un indicateur
        if (pageInfo) pageInfo.textContent = "Saut vers la position Cloud...";
        
        // Se rendre à la nouvelle position
        rendition.display(bookState.cfi);
        
        // Mettre à jour l'index si disponible
        if (bookState.sentenceIdx !== undefined) {
            sentenceIdx = bookState.sentenceIdx;
        }
    }
    
    // Si nous sommes dans la bibliothèque, on recharge simplement l'UI
    if (libraryView.classList.contains('active')) {
        loadLibrary();
    }
};

init();
// ─── Marque-pages et Navigation ────────────────────────────────────────────────
function getBookmarks(bookId) {
    try {
        const stored = localStorage.getItem(`bookmarks_${bookId}`);
        return stored ? JSON.parse(stored) : [];
    } catch { return []; }
}

function saveBookmarks(bookId, marks) {
    localStorage.setItem(`bookmarks_${bookId}`, JSON.stringify(marks));
    if (typeof window.requestCloudSync === 'function') window.requestCloudSync();
}

function renderBookmarks() {
    if (!bookmarksList || !currentBookId) return;
    const marks = getBookmarks(currentBookId);
    bookmarksList.innerHTML = '';
    
    if (marks.length === 0) {
        bookmarksList.innerHTML = '<li style="color:#aaa; font-style:italic; font-size:0.9rem;">Aucun marque-page</li>';
        return;
    }

    marks.forEach((mark, index) => {
        const li = document.createElement('li');
        li.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:8px 12px; border-radius:6px; margin-bottom:5px;";
        
        const textSpan = document.createElement('span');
        textSpan.style.cssText = "cursor:pointer; flex: 1; font-size:0.9rem;";
        textSpan.textContent = mark.name || `Page ${mark.page}`;
        textSpan.title = mark.date;
        textSpan.onclick = () => {
            if (rendition && mark.cfi) {
                stopTTSAudio();
                const wasPlaying = (isPlaying && !isPaused);
                if (wasPlaying) pausePlaying();
                
                rendition.display(mark.cfi).then(() => {
                    initChapterReadingState().then(() => {
                        navPanel.classList.add('hidden');
                    });
                });
            }
        };

        const delBtn = document.createElement('button');
        delBtn.innerHTML = '<i class="fas fa-trash"></i>';
        delBtn.style.cssText = "background:transparent; border:none; color:#FF6B6B; cursor:pointer; padding:5px;";
        delBtn.onclick = (e) => {
            e.stopPropagation();
            marks.splice(index, 1);
            saveBookmarks(currentBookId, marks);
            renderBookmarks();
        };

        li.appendChild(textSpan);
        li.appendChild(delBtn);
        bookmarksList.appendChild(li);
    });
}

if (addBookmarkBtn) {
    addBookmarkBtn.addEventListener('click', () => {
        if (!currentBookId || !currentCfi || !rendition) return;

        const loc = rendition.currentLocation();
        const page = loc?.start?.displayed?.page || "?";
        
        const marks = getBookmarks(currentBookId);
        const dateStr = new Date().toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
        
        // On évite les doublons de page exacte si possible
        const existing = marks.findIndex(m => m.cfi === currentCfi);
        if (existing >= 0) {
            alert("Il y a déjà un marque-page ici.");
            return;
        }

        const name = prompt("Nom du marque-page :", `Page ${page}`);
        if (name === null) return; // Annulé

        marks.push({
            cfi: currentCfi,
            page: page,
            name: name || `Page ${page}`,
            date: dateStr,
            timestamp: Date.now()
        });
        
        saveBookmarks(currentBookId, marks);
        
        // Petit effet visuel
        addBookmarkBtn.style.color = "var(--primary-color)";
        setTimeout(() => addBookmarkBtn.style.color = "", 1000);
    });
}

if (gotoPageBtn && gotoPageInput) {
    gotoPageBtn.addEventListener('click', () => {
        if (!currentBook || !rendition) return;
        const targetPage = parseInt(gotoPageInput.value, 10);
        if (isNaN(targetPage) || targetPage < 1) return;

        const totalPages = currentBook.locations.total || 0;
        if (totalPages === 0) {
            alert("La pagination n'est pas encore prête, veuillez patienter.");
            return;
        }

        const maxPage = Math.max(1, totalPages);
        const safePage = Math.min(targetPage, maxPage);
        
        const wasPlaying = (isPlaying && !isPaused);
        if (wasPlaying) pausePlaying();

        // epub.js récupère la CFI par rapport à la localisation
        let targetCfi = currentBook.locations.cfiFromLocation(safePage);
        
        if (targetCfi) {
            rendition.display(targetCfi).then(() => {
                initChapterReadingState().then(() => {
                    navPanel.classList.add('hidden');
                    gotoPageInput.value = '';
                });
            });
        }
    });

    gotoPageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            gotoPageBtn.click();
        }
    });
}

// Ensure EPUB pagination generation finishes before go to page becomes usable
// It's already generated in loadChapter (currentBook.locations.generate(1600)).
