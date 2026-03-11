const CLIENT_ID = '48999229055-1uichl6e4ot9r4cnjaj8ts0dum7g71p3.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

let tokenClient;
let gapiInited = false;
let gisInited = false;
let driveAccessToken = null;

function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
    await gapi.client.init({
        discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
    });
    gapiInited = true;
    checkExistingToken();
}

function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse.error !== undefined) {
                console.error(tokenResponse);
                return;
            }
            driveAccessToken = tokenResponse.access_token;
            localStorage.setItem('drive_token', driveAccessToken);
            localStorage.setItem('drive_token_expiry', Date.now() + 3500 * 1000); // Expires in 1h
            updateSyncBtnState(true);
            triggerFullSync(true); // Force sync from cloud on login
        },
    });
    gisInited = true;
}

function checkExistingToken() {
    const savedToken = localStorage.getItem('drive_token');
    const expiry = localStorage.getItem('drive_token_expiry');
    // Vérifier si le token n'est pas expiré (marge de sécurité)
    if (savedToken && expiry && Date.now() < parseInt(expiry, 10)) {
        gapi.client.setToken({ access_token: savedToken });
        driveAccessToken = savedToken;
        updateSyncBtnState(true);
        // Sync silencieuse en arrière-plan à l'ouverture de l'appli
        triggerFullSync(false);
    } else {
        localStorage.removeItem('drive_token');
        localStorage.removeItem('drive_token_expiry');
        updateSyncBtnState(false);
    }
}

function updateSyncBtnState(isConnected) {
    const btn = document.getElementById('google-sync-btn');
    if (!btn) return;
    if (isConnected) {
        btn.innerHTML = '<i class="fas fa-check"></i> Drive Synchronisé';
        btn.style.background = 'linear-gradient(135deg, #34A853, #1e8e3e)';
    } else {
        btn.innerHTML = '<i class="fab fa-google"></i> Cloud Sync';
        btn.style.background = 'linear-gradient(135deg, #4285F4, #34A853)';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const syncBtn = document.getElementById('google-sync-btn');
    if (syncBtn) {
        syncBtn.addEventListener('click', () => {
            if (driveAccessToken) {
                // Déjà connecté, on force une synchro et on affiche une alerte amicale
                triggerFullSync(true);
                alert("Synchronisation locale → Cloud en cours...");
            } else {
                // Pas connecté, on ouvre la popup Google
                tokenClient.requestAccessToken({prompt: 'consent'});
            }
        });
    }
});

// --- Drive File Logic ---

async function getOrCreateSyncFile() {
    try {
        const response = await gapi.client.drive.files.list({
            spaces: 'appDataFolder',
            q: "name='ebook_reader_sync.json'",
            fields: 'files(id, name)'
        });
        const files = response.result.files;
        if (files && files.length > 0) {
            return files[0].id;
        } else {
            console.log("Création du fichier de synchronisation initial sur Drive...");
            const fileMetadata = {
                'name': 'ebook_reader_sync.json',
                'parents': ['appDataFolder']
            };
            const createRes = await gapi.client.drive.files.create({
                resource: fileMetadata,
                fields: 'id'
            });
            return createRes.result.id;
        }
    } catch (err) {
        console.error("Erreur d'accès au Drive: ", err);
        return null;
    }
}

// Uploads a JSON object to the specified file ID
async function uploadToDrive(fileId, dataObj) {
    const boundary = '-------314159265358979323846';
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";

    const contentType = 'application/json';
    const body = JSON.stringify(dataObj);

    const multipartRequestBody =
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify({ mimeType: contentType }) +
        delimiter +
        'Content-Type: ' + contentType + '\r\n\r\n' +
        body +
        close_delim;

    try {
        await gapi.client.request({
            'path': '/upload/drive/v3/files/' + fileId,
            'method': 'PATCH',
            'params': {'uploadType': 'multipart'},
            'headers': {
                'Content-Type': 'multipart/related; boundary="' + boundary + '"'
            },
            'body': multipartRequestBody
        });
        console.log("☁️ Sauvegardé sur le Cloud avec succès !");
    } catch (e) {
        console.error("Erreur d'upload vers Cloud", e);
    }
}

// Download cloud state
async function downloadFromDrive(fileId) {
    try {
        const response = await gapi.client.drive.files.get({
            fileId: fileId,
            alt: 'media'
        });
        return typeof response.result === 'object' ? response.result : JSON.parse(response.result);
    } catch (err) {
        if (err.status === 404) return {}; 
        return null;
    }
}

// Extraction depuis LocalStorage
function getLocalSyncState() {
    const state = {
        last_sync: Date.now(),
        settings: {
            theme: localStorage.getItem('reader_theme') || 'light',
            rate: localStorage.getItem('reader_playbackRate') || '1.0',
            highlightColor: localStorage.getItem('reader_highlightColor') || '#FFE033'
        },
        books: {}
    };

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('cfi_')) {
            const bookId = key.substring(4);
            if (!state.books[bookId]) state.books[bookId] = {};
            state.books[bookId].cfi = localStorage.getItem(key);
            state.books[bookId].last_update = parseInt(localStorage.getItem(`last_${bookId}`) || '0', 10);
            
            // On récupère aussi la phrase si elle existe
            const sIdx = localStorage.getItem(`sentenceIdx_${bookId}`);
            if (sIdx !== null) state.books[bookId].sentenceIdx = parseInt(sIdx, 10);
        }
    }
    return state;
}

// Fusionne le statut Cloud dans le local
function mergeCloudState(cloudState, forceRefresh) {
    if (!cloudState || !cloudState.books) return;
    
    // Application des paramètres si on veut forcer
    if (forceRefresh && cloudState.settings) {
        if (cloudState.settings.theme) localStorage.setItem('reader_theme', cloudState.settings.theme);
        if (cloudState.settings.rate) localStorage.setItem('reader_playbackRate', cloudState.settings.rate);
        if (cloudState.settings.highlightColor) localStorage.setItem('reader_highlightColor', cloudState.settings.highlightColor);
    }

    let aBookWasUpdated = false;
    let currentBookUpdated = false;

    // Comparaison des dates pour chaque livre
    for (const [bookId, cloudBook] of Object.entries(cloudState.books)) {
        const localUpdateTime = parseInt(localStorage.getItem(`last_${bookId}`) || '0', 10);
        const cloudUpdateTime = cloudBook.last_update || 0;

        // Si le cloud a une version plus récente
        if (cloudUpdateTime > localUpdateTime) {
            console.log(`Mise à jour Cloud pour le livre ${bookId}`);
            if (cloudBook.cfi) localStorage.setItem(`cfi_${bookId}`, cloudBook.cfi);
            if (cloudBook.sentenceIdx !== undefined) localStorage.setItem(`sentenceIdx_${bookId}`, cloudBook.sentenceIdx);
            localStorage.setItem(`last_${bookId}`, cloudUpdateTime.toString());
            aBookWasUpdated = true;
            if (typeof window.currentBookId !== 'undefined' && window.currentBookId === bookId) {
                currentBookUpdated = true;
            }
        }
    }
    
    if (aBookWasUpdated && forceRefresh) {
        alert("Des positions de lecture plus récentes ont été récupérées depuis le Cloud.");
        location.reload();
    } else if (currentBookUpdated) {
        // L'utilisateur est en train de lire et le cloud vient de télécharger en arrière-plan une meilleure position
        console.log("Sync background: Le livre en cours a été mis à jour par le Cloud. Rafraîchissement...");
        location.reload();
    }
}

// La fonction principale de synchro
async function triggerFullSync(forceRefresh = false) {
    if (!driveAccessToken) return;

    try {
        const fileId = await getOrCreateSyncFile();
        if (!fileId) return;

        // 1. On rapatrie d'abord ce qui est sur le cloud pour avoir la dernière version
        const cloudState = await downloadFromDrive(fileId);
        if (cloudState) {
            mergeCloudState(cloudState, forceRefresh);
        }
        
        // 2. On pousse notre statut local fusionné vers le Cloud
        const newState = getLocalSyncState();
        await uploadToDrive(fileId, newState);

    } catch (e) {
        console.error("Échec de la synchronisation", e);
        if (e.status === 401) {
            localStorage.removeItem('drive_token');
            localStorage.removeItem('drive_token_expiry');
            driveAccessToken = null;
            updateSyncBtnState(false);
        }
    }
}

// Fonction utilitaire attachée à window pour être appelée depuis app.js
window.requestCloudSync = () => {
    if (!driveAccessToken) return;
    if (window.cloudSyncTimer) clearTimeout(window.cloudSyncTimer);
    // Debounce : on attend 5 secondes après la dernière activité pour ne pas spammer Google Drive
    window.cloudSyncTimer = setTimeout(() => {
        triggerFullSync(false);
    }, 5000);
};
