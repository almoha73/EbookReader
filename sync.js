// ─── Google Drive Sync Module ─────────────────────────────────────────────────
// Synchronise la progression de lecture (CFI, sentenceIdx, réglages) vers
// le dossier AppData de Google Drive — invisible dans le drive de l'utilisateur.

const CLIENT_ID = '48999229055-1uichl6e4ot9r4cnjaj8ts0dum7g71p3.apps.googleusercontent.com';
const SCOPES    = 'https://www.googleapis.com/auth/drive.appdata';
const SYNC_FILENAME = 'ebook_reader_sync.json';

let tokenClient     = null;
let driveAccessToken = null;
let syncFileId      = null; // cache pour éviter de refaire list() à chaque fois

// ─── Initialisation GAPI ──────────────────────────────────────────────────────
function gapiLoaded() {
    gapi.load('client', async () => {
        await gapi.client.init({
            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
        });
        console.log('[Sync] GAPI client initialisé');
        tryRestoreSession();
    });
}

// ─── Initialisation GIS ───────────────────────────────────────────────────────
function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: handleTokenResponse,
    });
    console.log('[Sync] GIS tokenClient initialisé');
}

function handleTokenResponse(resp) {
    if (resp.error) {
        console.error('[Sync] Erreur token:', resp);
        return;
    }
    driveAccessToken = resp.access_token;
    const expiry = Date.now() + (resp.expires_in - 60) * 1000;
    localStorage.setItem('drive_token', driveAccessToken);
    localStorage.setItem('drive_token_expiry', String(expiry));
    gapi.client.setToken({ access_token: driveAccessToken });
    updateSyncBtn(true);
    console.log('[Sync] Connecté à Google Drive');
    // Synchronisation immédiate après connexion
    doSync(true);
}

// ─── Restauration de session ──────────────────────────────────────────────────
function tryRestoreSession() {
    const token  = localStorage.getItem('drive_token');
    const expiry = parseInt(localStorage.getItem('drive_token_expiry') || '0', 10);
    if (token && Date.now() < expiry) {
        driveAccessToken = token;
        gapi.client.setToken({ access_token: token });
        updateSyncBtn(true);
        console.log('[Sync] Session restaurée depuis localStorage');
        // Sync silencieuse au démarrage
        doSync(false);
    } else {
        localStorage.removeItem('drive_token');
        localStorage.removeItem('drive_token_expiry');
        updateSyncBtn(false);
    }
}

// ─── UI du bouton ─────────────────────────────────────────────────────────────
function updateSyncBtn(connected) {
    const btn = document.getElementById('google-sync-btn');
    if (!btn) return;
    if (connected) {
        btn.innerHTML  = '<i class="fas fa-check-circle"></i> Drive ✓';
        btn.style.background = 'linear-gradient(135deg, #34A853, #1a7a38)';
    } else {
        btn.innerHTML  = '<i class="fab fa-google"></i> Cloud Sync';
        btn.style.background = 'linear-gradient(135deg, #4285F4, #34A853)';
    }
}

// ─── Clic sur le bouton ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('google-sync-btn');
    if (!btn) return;

    btn.addEventListener('click', () => {
        if (driveAccessToken) {
            // Menu : Forcer synchro ou déconnexion
            const choice = confirm(
                'Drive synchronisé ✓\n\n' +
                'Cliquez sur OK pour FORCER une synchronisation maintenant.\n' +
                'Cliquez sur Annuler pour vous DÉCONNECTER du Cloud.'
            );
            if (choice) {
                doSync(true).then(() => alert('Synchronisation terminée !'));
            } else {
                disconnect();
            }
        } else {
            if (!tokenClient) { alert('Chargement en cours, réessayez dans 2 secondes.'); return; }
            tokenClient.requestAccessToken({ prompt: 'consent' });
        }
    });
});

function disconnect() {
    localStorage.removeItem('drive_token');
    localStorage.removeItem('drive_token_expiry');
    driveAccessToken  = null;
    syncFileId        = null;
    if (gapi.client) gapi.client.setToken(null);
    updateSyncBtn(false);
    console.log('[Sync] Déconnecté');
}

// ─── Utilitaires Drive ────────────────────────────────────────────────────────
async function getSyncFileId() {
    if (syncFileId) return syncFileId; // cache HIT
    const res = await gapi.client.drive.files.list({
        spaces: 'appDataFolder',
        q: `name='${SYNC_FILENAME}'`,
        fields: 'files(id)',
        pageSize: 1,
    });
    const files = res.result.files;
    if (files && files.length > 0) {
        syncFileId = files[0].id;
        console.log('[Sync] Fichier Drive trouvé:', syncFileId);
    } else {
        // Créer le fichier
        const createRes = await gapi.client.drive.files.create({
            resource: { name: SYNC_FILENAME, parents: ['appDataFolder'] },
            fields: 'id',
        });
        syncFileId = createRes.result.id;
        console.log('[Sync] Fichier Drive créé:', syncFileId);
    }
    return syncFileId;
}

async function uploadState(fileId, data) {
    const content = JSON.stringify(data);
    const boundary = 'eb83cf6b8e2a4bad';
    const body =
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
        JSON.stringify({ mimeType: 'application/json' }) +
        `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
        content +
        `\r\n--${boundary}--`;

    await gapi.client.request({
        path: `/upload/drive/v3/files/${fileId}`,
        method: 'PATCH',
        params: { uploadType: 'multipart' },
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
    });
    console.log('[Sync] ☁️ Upload OK, état local poussé sur Drive');
}

async function downloadState(fileId) {
    try {
        const res = await gapi.client.drive.files.get({ fileId, alt: 'media' });
        const data = (typeof res.result === 'object') ? res.result : JSON.parse(res.result);
        console.log('[Sync] ⬇️ Téléchargé depuis Drive:', data);
        return data;
    } catch (e) {
        if (e.status === 404) return null;
        console.error('[Sync] Erreur download:', e);
        throw e;
    }
}

// ─── Collecte de l'état local ─────────────────────────────────────────────────
function getLocalState() {
    const state = {
        _version: 2,
        settings: {
            theme:          localStorage.getItem('reader_theme') || 'light',
            rate:           localStorage.getItem('reader_playbackRate') || '1.0',
            highlightColor: localStorage.getItem('reader_highlightColor') || '#FFE033',
        },
        books: {},
    };
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('cfi_')) {
            const bookId = key.slice(4);
            const lastUpdate = parseInt(localStorage.getItem(`last_${bookId}`) || '0', 10);
            const sIdx = localStorage.getItem(`sentenceIdx_${bookId}`);
            state.books[bookId] = {
                cfi: localStorage.getItem(key),
                last_update: lastUpdate,
                ...(sIdx !== null ? { sentenceIdx: parseInt(sIdx, 10) } : {}),
            };
        }
    }
    console.log('[Sync] État local collecté:', JSON.stringify(state.books));
    return state;
}

// ─── Fusion cloud → local ─────────────────────────────────────────────────────
// forceJump=true : saut immédiat (reconnexion explicite par l'utilisateur)
// forceJump=false : mise à jour silencieuse du localStorage uniquement (background)
function mergeCloud(cloudState, forceJump = false) {
    if (!cloudState || !cloudState.books) return false;

    let updated = false;
    for (const [bookId, cloudBook] of Object.entries(cloudState.books)) {
        const localTime = parseInt(localStorage.getItem(`last_${bookId}`) || '0', 10);
        const cloudTime = cloudBook.last_update || 0;
        console.log(`[Sync] Livre ${bookId}: local=${localTime}, cloud=${cloudTime}`);
        if (cloudTime > localTime) {
            console.log(`[Sync] → Cloud plus récent, mise à jour locale pour ${bookId}`);
            if (cloudBook.cfi) localStorage.setItem(`cfi_${bookId}`, cloudBook.cfi);
            localStorage.setItem(`last_${bookId}`, String(cloudTime));
            if (cloudBook.sentenceIdx !== undefined) {
                localStorage.setItem(`sentenceIdx_${bookId}`, String(cloudBook.sentenceIdx));
            }
            updated = true;

            // On saute vers la bonne page si :
            // 1) L'utilisateur l'a forcé (bouton Cloud Sync) OU
            // 2) L'audio n'est PAS en cours (c'est le chargement initial ou le téléphone est posé)
            const userIsReading = typeof window.isPlaying !== 'undefined' && window.isPlaying;
            const isCurrentBook = typeof window.currentBookId !== 'undefined' && window.currentBookId === bookId;
            if (isCurrentBook && (!userIsReading || forceJump)) {
                if (typeof window.rendition !== 'undefined' && window.rendition && cloudBook.cfi) {
                    console.log('[Sync] Livre ouvert → saut vers', cloudBook.cfi);
                    window.rendition.display(cloudBook.cfi);
                }
            }
        }
    }
    return updated;
}

// ─── Sync complète ────────────────────────────────────────────────────────────
async function doSync(notifyIfUpdated = false) {
    if (!driveAccessToken) return;
    try {
        const fileId = await getSyncFileId();

        // 1. Télécharger l'état cloud
        const cloudState = await downloadState(fileId);
        if (cloudState) {
            // forceJump=notifyIfUpdated : sauter vers la bonne page seulement si l'utilisateur a cliqué le bouton
            mergeCloud(cloudState, notifyIfUpdated);
        }

        // 2. Pousser l'état local (potentiellement enrichi)
        const localState = getLocalState();
        await uploadState(fileId, localState);

        if (cloudUpdated && notifyIfUpdated) {
            console.log('[Sync] Positions récupérées depuis le Cloud');
        }
    } catch (e) {
        console.error('[Sync] Erreur:', e);
        if (e.status === 401) disconnect(); // Token expiré
    }
}

// ─── Hook pour app.js ─────────────────────────────────────────────────────────
let _syncDebounceTimer = null;
window.requestCloudSync = () => {
    if (!driveAccessToken) return;
    clearTimeout(_syncDebounceTimer);
    _syncDebounceTimer = setTimeout(() => doSync(false), 5000);
};
