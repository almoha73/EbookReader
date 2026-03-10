const fs = require('fs');

async function test() {
    const text = "Ceci est un test de la voix de synthèse en arrière-plan.";
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=fr&client=tw-ob`;
    const proxyUrl = `https://cors.eu.org/${url}`;
    
    try {
        const res = await fetch(proxyUrl);
        if(!res.ok) {
            console.error("HTTP error:", res.status);
            return;
        }
        console.log("Headers:", res.headers.get('content-type'));
        const buffer = await res.arrayBuffer();
        console.log("Buffer size:", buffer.byteLength);
    } catch(e) {
        console.error(e);
    }
}
test();
