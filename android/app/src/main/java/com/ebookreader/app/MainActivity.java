package com.ebookreader.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Activer le débogage WebView en mode debug
        WebView.setWebContentsDebuggingEnabled(true);

        // Récupérer la WebView de Capacitor et configurer les permissions
        // nécessaires pour que epubjs puisse charger les EPUB (blob URLs, file access)
        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();

        // Accès aux fichiers locaux (nécessaire pour ArrayBuffer / IndexedDB)
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        // Autoriser le chargement de ressources depuis des URLs de fichier
        // (blob: URLs créées par epubjs pour les images et le contenu)
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);

        // Autoriser le contenu mixte (http dans https)
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // Activer JavaScript (normalement déjà activé par Capacitor)
        settings.setJavaScriptEnabled(true);

        // Activer le stockage DOM (localStorage, IndexedDB)
        settings.setDomStorageEnabled(true);

        // Support des bases de données web
        settings.setDatabaseEnabled(true);
    }
}
