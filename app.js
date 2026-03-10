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
const settingsPanel = document.getElementById('settings-panel');
const progressFill  = document.getElementById('progress-fill');
const voiceSelect   = document.getElementById('voice-select');
const rateSelect    = document.getElementById('rate-select');
const rateValue     = document.getElementById('rate-value');
const decreaseFontBtn = document.getElementById('decrease-font');
const increaseFontBtn = document.getElementById('increase-font');

// ─── State ───────────────────────────────────────────────────────────────────
let currentBook   = null;
let rendition     = null;
let currentCfi    = null;
let currentBookId = null;
let fontSize      = 100;

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
let silentWatchdog = null;  // interval that restarts speech if OS kills it
let lastSpeakTime  = 0;     // debounce: avoids watchdog firing between sentences


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

    rendition.themes.fontSize(`${fontSize}%`);
    // CFI is stored in localStorage (synchronous = survives page reload)
    const savedCfi = localStorage.getItem(`cfi_${meta.id}`);
    console.log('Reprise à la position CFI:', savedCfi);
    rendition.display(savedCfi || undefined);

    currentBook.ready
        .then(() => currentBook.locations.generate(1600))
        .then(() => updateProgress());

    rendition.on('relocated', (loc) => {
        currentCfi = loc.start.cfi;
        updateProgress();
        saveProgress(loc.start.cfi);
    });

    rendition.on('rendered', () => {
        injectHighlightStyleAndClickListener();
        // Auto-read the new page if TTS reached the end of the previous one
        if (pendingAutoRead && isPlaying && !isPaused) {
            pendingAutoRead = false;
            setTimeout(() => startPageReading(), 350);
        }
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
    if (currentBook?.locations?.length() > 0 && currentCfi) {
        const pct = Math.round(currentBook.locations.percentageFromCfi(currentCfi) * 100);
        progressFill.style.width = pct + '%';
        // Save progress % to localforage (async is fine for this non-critical data)
        localforage.getItem(`${currentBookId}_meta`).then(meta => {
            if (meta) { meta.progress = pct; localforage.setItem(`${currentBookId}_meta`, meta); }
        });
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
decreaseFontBtn.onclick = () => { if (fontSize > 50) { fontSize -= 25; rendition?.themes.fontSize(`${fontSize}%`); } };
increaseFontBtn.onclick = () => { if (fontSize < 400) { fontSize += 25; rendition?.themes.fontSize(`${fontSize}%`); } };

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

// Reconstruit les textNodes (invalides après clearHighlight/normalize)
// puis reprend la lecture à la phrase courante
function rebuildAndResume() {
    synth.cancel();
    clearHighlight();
    // Reconstruire la liste des textNodes depuis le DOM actuel
    textNodes    = [];
    pageFullText = '';
    if (!iframeDoc) return;
    try {
        const built  = buildVisibleTextNodes(iframeDoc);
        textNodes    = built.textNodes;
        pageFullText = built.pageFullText;
        sentences    = splitSentences(pageFullText);
    } catch(e) { console.error('rebuildAndResume error:', e); return; }
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
    startBackgroundSession();  // keep audio alive when screen off
    startPageReading();
}

function pausePlaying() {
    isPaused = true;
    stopSpeaking();
    setPlayIcon('play');
}

function resumePlaying() {
    isPaused = false;
    setPlayIcon('pause');
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
}

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
    try {
        if (audioCtx && audioCtx.state !== 'closed') return; // already running
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        // 1-second buffer filled with nearly-inaudible white noise (amplitude 0.0001)
        // This is ~80 dB below full scale — completely inaudible to humans
        // but clearly non-zero, so iOS/Android keep the audio session alive.
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
        console.log('► Session audio de fond : active (bruit inaudible en boucle)');
    } catch(e) {
        console.warn('Session audio de fond impossible:', e);
    }

    // Watchdog: if synth stops talking while we expect it to be reading, restart.
    clearInterval(silentWatchdog);
    silentWatchdog = setInterval(() => {
        // Only fire if we've been silent for > 3 s AND it's not just the normal
        // gap between two sentences (lastSpeakTime tracks when synth.speak() was last called)
        if (isPlaying && !isPaused && !synth.speaking && !synth.pending
            && Date.now() - lastSpeakTime > 3000) {
            console.warn('⚠ Watchdog: synthèse vocale stoppée de manière inattendue. Relance...');
            if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
            readSentence(sentenceIdx);
        }
    }, 2000);

    setupMediaSession();
}

function stopBackgroundSession() {
    clearInterval(silentWatchdog);
    silentWatchdog = null;
    try {
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

// If the browser pauses speech when the page goes to background,
// resume it as soon as the page becomes visible again.
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isPlaying && !isPaused) {
        // Some browsers pause synth on hide; force-resume
        if (synth.paused) {
            synth.resume();
        } else if (!synth.speaking) {
            // Fell through the cracks: restart current sentence
            setTimeout(() => readSentence(sentenceIdx), 200);
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
// Built textNodes explicitly for BOTH current visible pane AND the next column
// using epub.js internal column layout properties via getBoundingClientRect()
function buildVisibleTextNodes(doc) {
    const result = { textNodes: [], pageFullText: '' };
    const win    = doc.defaultView;
    const vw     = win.innerWidth;
    const vh     = win.innerHeight;

    const walk = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walk.nextNode())) {
        const text = node.textContent;
        if (!text.trim()) continue;
        
        const parent = node.parentElement;
        if (parent) {
            const r = parent.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue; 
            
            // Accept the current page (0 to vw) AND the next page (vw to vw*2)
            // This allows sentences cut exactly at the boundary or starting on the next page
            // to exist in the `sentences` array without being abruptly cut out.
            if (r.left >= vw * 2) continue;
            if (r.right <= 0) continue;
            if (r.bottom <= 0 || r.top >= vh) continue;
        }
        result.textNodes.push({ 
            node,
            start: result.pageFullText.length,
            end:   result.pageFullText.length + text.length 
        });
        result.pageFullText += text;
    }
    return result;
}

// Determines if a sentence index is visually located strictly on the next page
function isSentenceOnNextPage(doc, charStart, charEnd) {
    if (!doc || !textNodes.length) return false;

    // Use a slightly shifted start just in case charStart falls exactly on an invisible space
    let checkPos = charStart;
    let startNode = null, startOffset = 0;
    
    for (const tn of textNodes) {
        if (tn.end > checkPos) {
            startNode = tn.node;
            startOffset = Math.max(0, checkPos - tn.start);
            break;
        }
    }
    if (!startNode) return false;

    try {
        const range = doc.createRange();
        range.setStart(startNode, startOffset);
        // Expand the check slightly into the word to get a solid layout box
        range.setEnd(startNode, Math.min(startOffset + 3, startNode.textContent.length));
        
        const rect = range.getBoundingClientRect();
        const vw = doc.defaultView.innerWidth;

        // The sentence physically starts on or past the right edge (column 2)
        return (rect.left >= vw - 10 && rect.width > 0);
    } catch(e) {
        return false;
    }
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
    } catch(e) { return; }

    const built = buildVisibleTextNodes(iframeDoc);
    textNodes    = built.textNodes;
    pageFullText = built.pageFullText;

    if (!pageFullText.trim()) { if (isPlaying && !isPaused) rendition.next(); return; }
    sentences = splitSentences(pageFullText);
    if (!sentences.length) { if (isPlaying && !isPaused) rendition.next(); return; }

    const startIdx = seekCharIndex >= 0 ? findSentenceIdx(seekCharIndex) : 0;
    readSentence(startIdx);
}

async function startPageReading() {
    if (!isPlaying || isPaused || !rendition) return;
    stopSpeaking();
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

    // Only collect text nodes from the VISIBLE column (not the whole chapter)
    const built  = buildVisibleTextNodes(iframeDoc);
    textNodes    = built.textNodes;
    pageFullText = built.pageFullText;

    if (!pageFullText.trim()) { if (isPlaying && !isPaused) rendition.next(); return; }
    sentences = splitSentences(pageFullText);
    if (!sentences.length) { if (isPlaying && !isPaused) rendition.next(); return; }

    const savedCfi         = localStorage.getItem(`cfi_${currentBookId}`);
    const savedSentenceIdx = parseInt(localStorage.getItem(`sentenceIdx_${currentBookId}`) || '0', 10);
    const currentPageCfi   = rendition.currentLocation()?.start?.cfi;
    let startIdx = 0;
    
    // If we're resuming on the same CFI, resume from the exact sentence index
    if (savedSentenceIdx > 0 && savedCfi && savedCfi === currentPageCfi && savedSentenceIdx < sentences.length) {
        startIdx = savedSentenceIdx;
        console.log('Reprise à la phrase n°', startIdx);
    } else if (savedSentenceIdx > 0) {
        // If the CFI changed (page turn) but we wanted to auto-read, start at sentence 0 of the new page
        localStorage.setItem(`sentenceIdx_${currentBookId}`, 0);
        startIdx = 0;
    }
    
    readSentence(startIdx);
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
    if (idx >= sentences.length) {
        clearHighlight();
        // Clear sentence position when page ends naturally
        localStorage.removeItem(`sentenceIdx_${currentBookId}`);
        if (isPlaying && !isPaused) {
            pendingAutoRead = true;   // will be consumed by the 'rendered' event
            rendition?.next();
        }
        return;
    }

    sentenceIdx = idx;
    // Save sentence index synchronously so it survives F5
    localStorage.setItem(`sentenceIdx_${currentBookId}`, idx);
    lastSpeakTime = Date.now();
    const s = sentences[idx];

    // Core "Play Books" logic: BEFORE reading this new sentence,
    // if we detect it is strictly on the next page, we STOP right here,
    // turn the page, and RE-START reading this exact index on the new page view.
    // The previous utterance has already finished properly.
    if (isSentenceOnNextPage(iframeDoc, s.charStart, s.charStart + s.text.length)) {
        console.log('Phrase sur la page suivante détectée entre deux lectures ! Tourner la page.');
        if (isPlaying && !isPaused) {
            pendingAutoRead = true;
            localStorage.setItem(`sentenceIdx_${currentBookId}`, 0); // start fresh on new page
            rendition?.next();
        }
        return; // Do not highlight or speak it !
    }

    // Otherwise, the sentence is at least partially visible here. Highlighting and reading it!
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

    utt.onend = () => {
        // When this sentence is officially done, trigger the next one.
        // If the NEXT one happens to be on the next page, it will be caught by the check above.
        if (isPlaying && !isPaused) readSentence(idx + 1);
    };
    utt.onerror = (e) => {
        if (e.error === 'canceled' || e.error === 'interrupted') return;
        console.error('TTS error:', e.error);
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
        const ifWin = iframeDoc.defaultView;
        const sx = ifWin.scrollX, sy = ifWin.scrollY;
        sel.addRange(range);
        ifWin.scrollTo(sx, sy);
    } catch(e) {
        console.error('Highlight error:', e);
    }
}

init();
