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
const progressFill   = document.getElementById('progress-fill');
const pageInfo       = document.getElementById('page-info');
const voiceSelect   = document.getElementById('voice-select');
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

// TTS state
const synth = window.speechSynthesis;
let voices  = [];
let voicesReady = false;

let isPlaying  = false;
let pendingAutoRead = false;  // set when TTS finishes a page → triggers read on next render
let isPaused   = false;

let sentences        = [];  // [{text, charStart}]
let sentenceIdx      = 0;
let textNodes        = [];  // [{node, start, end}]
let pageFullText     = '';
let iframeDoc        = null;
let activeMarkEls    = [];  // <mark> elements currently in DOM

// ─── Background audio state (keep alive when screen is off) ─────────────────────
let audioCtx       = null;
let silentSource   = null;
let silentAudioEl  = null;  // HTML5 audio element
let silentWatchdog = null;  // interval that restarts speech if OS kills it
let lastSpeakTime  = 0;     // debounce: avoids watchdog firing between sentences
let wakeLock       = null;  // Screen Wake Lock to prevent screen from turning off
let wasPlayingBeforeHidden = false; // track if we need to resume after screen on


// ─── Voice loading ────────────────────────────────────────────────────────────
function populateVoiceList() {
    voices = synth.getVoices();
    if (!voices.length) return;
    voicesReady = true;
    voiceSelect.innerHTML = voices.map((v, i) =>
        `<option value="${i}">${v.name} (${v.lang})</option>`
    ).join('');
    // Restore saved voice by NAME (index can vary between sessions)
    const savedVoiceName = localStorage.getItem('reader_voice_name');
    if (savedVoiceName) {
        const idx = voices.findIndex(v => v.name === savedVoiceName);
        if (idx >= 0) { voiceSelect.value = idx; return; }
    }
    // Fall back to system default
    const defIdx = voices.findIndex(v => v.default);
    if (defIdx >= 0) voiceSelect.value = defIdx;
}

// Call immediately AND on event (Chrome fires the event, Firefox already has them)
console.log('EbookReader v20250310-b loaded');
populateVoiceList();
speechSynthesis.onvoiceschanged = () => { populateVoiceList(); };

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

    const id = 'book_' + Date.now();
    const arrayBuffer = await file.arrayBuffer();
    const book = ePub(arrayBuffer);
    const metadata = await book.loaded.metadata;

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

    rendition.on('relocated', (loc) => {
        currentCfi = loc.start.cfi;
        updateProgress();
        saveProgress(loc.start.cfi);

        // relocated fires AFTER currentLocation() is updated with the new page coordinates.
        if (pendingAutoRead && isPlaying && !isPaused) {
            pendingAutoRead = false;
            lastSpeakTime = Date.now();
            startPageReading();
        } else if (isPlaying && !isPaused) {
            // Lecture synchrone intra-chapitre : mettons à jour les limites visuelles de la nouvelle page
            // de façon asynchrone sans couper le flux audio continu (Android background bypass)
            if (typeof updateVisualBoundariesOnly === 'function') updateVisualBoundariesOnly();
        }
    });

    rendition.on('rendered', () => {
        injectHighlightStyleAndClickListener();
        // Note: auto-read on page turn is handled via 'relocated' event (not here)
    });

    rendition.on('click', () => settingsPanel.classList.add('hidden'));

    // Swipe left/right to turn pages (mobile)
    addSwipeListeners(viewer);
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
            stopReading(); if (rendition) rendition.next();
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
            if (dx < 0) { stopReading(); if (rendition) rendition.next(); }
            else        { stopReading(); if (rendition) rendition.prev(); }
        }
    }, { passive: true });
}

// Find the tapped sentence in the iframe and start / redirect reading
function handleTapToRead(doc, clientX, clientY) {
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
            synth.cancel();
            sentenceIdx = findSentenceIdx(clickedCharIndex);
        }
        readSentence(sentenceIdx);
    } else {
        // Already playing — jump to tapped sentence
        if (clickedCharIndex >= 0 && sentences.length) {
            synth.cancel();
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
            settingsPanel.classList.add('hidden');
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
                    synth.cancel();
                    sentenceIdx = targetIdx;
                }
                readSentence(sentenceIdx);
            } else {
                // Already playing — jump to clicked sentence
                if (clickedCharIndex >= 0 && sentences.length) {
                    let targetIdx = findSentenceIdx(clickedCharIndex);
                    synth.cancel();
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
    localStorage.setItem(`cfi_${currentBookId}`, cfi);
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
nextBtn.onclick = () => { stopReading(); if (rendition) rendition.next(); };
backBtn.onclick = closeReader;

settingsBtn.onclick = () => settingsPanel.classList.toggle('hidden');
decreaseFontBtn.addEventListener('click', () => {
    if (fontSize > 50) {
        fontSize -= 25;
        localStorage.setItem('reader_fontSize', fontSize);
        applyAppearance();
    }
});
increaseFontBtn.addEventListener('click', () => {
    if (fontSize < 400) {
        fontSize += 25;
        localStorage.setItem('reader_fontSize', fontSize);
        applyAppearance();
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

function applyAppearance() {
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
            padding: 0 !important;
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
            'color': `${textColor} !important`
        },
        'body': { 
            'background': `${bgColor} !important`,
            'color': `${textColor} !important`
        },
        'body *': { 
            'font-size': 'inherit',
            'background-color': 'transparent !important',
            'color': `${textColor} !important`
        }
    });
}

rateSelect.oninput = (e) => {
    rateValue.textContent = e.target.value + 'x';
    if (isPlaying && !isPaused) rebuildAndResume();
};

voiceSelect.onchange = () => {
    // Persist voice by name so it survives page reload
    const v = voices[parseInt(voiceSelect.value, 10)];
    if (v) localStorage.setItem('reader_voice_name', v.name);
    if (isPlaying && !isPaused) rebuildAndResume();
};

// Reconstruit l'état de lecture complet si on change de voix ou de vitesse
async function rebuildAndResume() {
    synth.cancel();
    clearHighlight();
    await initChapterReadingState();
    readSentence(sentenceIdx);
}

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
    requestWakeLock();  // Keep screen on during reading
    startBackgroundSession();
    startPageReading();
}

function pausePlaying() {
    isPaused = true;
    stopSpeaking();
    setPlayIcon('play');
    releaseWakeLock();
}

function resumePlaying() {
    isPaused = false;
    setPlayIcon('pause');
    requestWakeLock();
    readSentence(sentenceIdx);
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
    synth.cancel();
    clearHighlight();
}

function setPlayIcon(icon) {
    playPauseBtn.innerHTML = `<i class="fas fa-${icon}"></i>`;
    if (icon === 'pause') playPauseBtn.classList.add('playing');
    else playPauseBtn.classList.remove('playing');
}

// ─── Background / screen-off audio session ────────────────────────────────
// Strategy:
//  1. Play a nearly-inaudible noise loop through Web Audio API.
//     Pure silence (zeros) is detected as "no audio" by Android and the tab
//     gets suspended. A tiny non-zero signal keeps the audio focus alive.
//  2. A watchdog timer checks every 2 s if speech synthesis is still running.
//     If it stopped unexpectedly (killed by OS), it restarts the sentence.
function startBackgroundSession() {
    // 1. HTML5 Audio tag approach (Strongest MediaSession binder for Android/iOS)
    if (!silentAudioEl) {
        // Fichier MP3 silencieux très long (1 heure) placé dans le DOM.
        // Android le traite comme un vrai flux média long type podcast ou radio,
        // ce qui maintient le processus JS actif même écran éteint.
        silentAudioEl = document.getElementById('silent-audio');
        if (!silentAudioEl) {
            silentAudioEl = new Audio('silent_1h.mp3');
        } else if (!silentAudioEl.src) {
            silentAudioEl.src = 'silent_1h.mp3';
        }
        silentAudioEl.loop = true;
        silentAudioEl.volume = 0.001; // Quasi-inaudible mais réel
    }
    silentAudioEl.play().catch(e => console.warn('Erreur lecture silentAudioEl:', e));

    // 2. Web Audio API approach (Fallback + keeping audio focus strongly)
    try {
        if (!audioCtx || audioCtx.state === 'closed') {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const sr = audioCtx.sampleRate;
            const buffer = audioCtx.createBuffer(1, sr, sr);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) {
                data[i] = (Math.random() * 2 - 1) * 0.0001;
            }
            silentSource = audioCtx.createBufferSource();
            silentSource.buffer = buffer;
            silentSource.loop = true;
            silentSource.connect(audioCtx.destination);
            silentSource.start(0);
        } else if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    } catch(e) {
        console.warn('Session audio de fond WebAudio impossible:', e);
    }

    // Watchdog: if synth stops talking while we expect it to be reading, restart.
    // Do NOT fire if a page turn is pending (there's naturally silence during page load).
    clearInterval(silentWatchdog);
    silentWatchdog = setInterval(() => {
        if (isPlaying && !isPaused && !pendingAutoRead && !synth.speaking && !synth.pending
            && Date.now() - lastSpeakTime > 3000) {
            console.warn('⚠ Watchdog: synthèse vocale stoppée de manière inattendue. Relance...');
            if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
            // Check if HTML5 audio was suspended
            if (silentAudioEl && silentAudioEl.paused) silentAudioEl.play().catch(()=>{});
            readSentence(sentenceIdx);
        }
    }, 2000);

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
        stopReading(); if (rendition) rendition.next();
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
        stopReading(); if (rendition) rendition.prev();
    });

    console.log('MediaSession configurée - Contrôles sur écran de verrouillage actifs');
}

// Watchdog de reprise au rallumage de l'écran.
// NE PAS couper le TTS à l'extinction : laisser l'OS décider (il peut le garder vivant
// grâce au silentAudioEl + AudioContext). Relancer seulement si le navigateur l'a mis en pause.
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Écran éteint : ON NE COUPE PAS. On laisse AudioContext + silentAudioEl maintenir la session.
        console.log('📱 Passage en arrière-plan — lecture TTS laissée intacte');
    } else {
        // Écran rallumé : récupérer l'AudioContext et relancer le TTS s'il a été tué
        if (isPlaying && !isPaused) {
            console.log('📱 Retour au premier plan — vérification du TTS');
            setTimeout(() => {
                // Relancer l'audio silencieux si l'OS l'a mis en veille
                if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
                if (silentAudioEl && silentAudioEl.paused) silentAudioEl.play().catch(() => {});
                // Relancer le TTS uniquement s'il s'est vraiment arrêté
                if (!synth.speaking && !synth.pending) {
                    console.log('📱 TTS arrêté par l\'OS — relance depuis phrase', sentenceIdx);
                    readSentence(sentenceIdx);
                } else if (synth.paused) {
                    synth.resume();
                }
            }, 300);
        }
    }
    if ('mediaSession' in navigator && isPlaying) {
        navigator.mediaSession.playbackState = isPaused ? 'paused' : 'playing';
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

    const layoutWidth = iframeDoc.defaultView.innerWidth;
    const colWidth    = layoutWidth / totalPages;
    const colStart = (page - 1) * colWidth;
    const colEnd   = page * colWidth;

    window.currentFirstVisibleSentence = 0;
    // VERY IMPORTANT: fallback to end of chapter if calculation fails
    window.currentLastVisibleSentence = sentences.length - 1; 
    let foundFirst = false;

    // Find which sentences fall in the current column viewport
    for (let i = 0; i < sentences.length; i++) {
        const rect = getSentenceRect(iframeDoc, sentences[i]);
        if (rect.width === 0 && rect.height === 0) continue;

        if (rect.right > colStart && rect.left < colEnd) {
            if (!foundFirst) {
                window.currentFirstVisibleSentence = i;
                foundFirst = true;
            }
            window.currentLastVisibleSentence = i;
        } else if (rect.left >= colEnd) {
            break; // Gone past the right edge, no need to check further
        }
    }
    
    console.log(`[bounds updated] page ${page}/${totalPages}, idx ${window.currentFirstVisibleSentence} to ${window.currentLastVisibleSentence}`);
}

function splitSentences(text) {
    const result = [];
    // Split on . ! ? followed by space/newline or end, keeping delimiter
    const re = /[^.!?\n]+[.!?\n]*/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (m[0].trim().length > 1) {
            result.push({ text: m[0], charStart: m.index });
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
    // L'OS Android maintiendra le flux audio puisque le SpeechSynthesis ne s'arrête pas !
    if (idx > window.currentLastVisibleSentence) {
        if (isPlaying && !isPaused) {
            // Empêche de relancer rendition.next() en boucle avant que 'relocated' ne mette à jour la limite
            window.currentLastVisibleSentence = sentences.length;
            rendition?.next();
            // On NE FAIT PAS return ! On continue à parler immédiatement pour garder l'OS éveillé !
        }
    }

    sentenceIdx = idx;
    localStorage.setItem(`sentenceIdx_${currentBookId}`, idx);
    lastSpeakTime = Date.now();
    const s = sentences[idx];

    // Highlight the sentence in the iframe DOM
    highlightRange(s.charStart, s.text.length);

    // Ensure voices are loaded
    if (!voicesReady) {
        populateVoiceList();
    }

    const utt = new SpeechSynthesisUtterance(s.text);
    const vIdx = parseInt(voiceSelect.value, 10);
    if (voices[vIdx]) utt.voice = voices[vIdx];
    utt.rate = parseFloat(rateSelect.value);
    utt.lang = voices[vIdx]?.lang || 'fr-FR';

    const startTime = Date.now();

    utt.onend = () => {
        if (isPlaying && !isPaused) readSentence(idx + 1);
    };
    utt.onerror = (e) => {
        if (e.error === 'canceled' || e.error === 'interrupted') return;
        console.error('TTS error:', e.error);
        // En arrière-plan, le TTS peut échouer instantanément : on ne fait rien,
        // le watchdog de l'événement visibilitychange prendra en charge la relance.
        if (document.hidden) {
            console.warn("⚠ TTS erreur en arrière-plan — attente du rallumage de l'écran");
            return;
        }
        if (isPlaying && !isPaused) readSentence(idx + 1);
    };

    synth.speak(utt);
}

// ─── Highlighting via Selection API (non-destructive, no DOM mutation) ────────
function clearHighlight() {
    if (!iframeDoc) return;
    try {
        const sel = iframeDoc.getSelection();
        if (sel) sel.removeAllRanges();
    } catch(e) {}
    activeMarkEls = []; // kept for compatibility
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

        const sel = iframeDoc.getSelection();
        sel.removeAllRanges();

        // Block the browser's auto-scroll when adding selection.
        // We cancel the scroll on the iframe window immediately after.
        const ifWin = iframeDoc.defaultView;
        const sx = ifWin.scrollX, sy = ifWin.scrollY;
        sel.addRange(range);
        ifWin.scrollTo(sx, sy);

        // No rect-based page detection needed: sentences[] now only contains
        // the current visible page, so page turns happen naturally when idx >= sentences.length.
    } catch(e) {
        console.error('Highlight error:', e);
    }
}

init();
