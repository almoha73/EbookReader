module.exports = async function handler(req, res) {
    const text = req.query.text;
    if (!text) return res.status(400).send('Missing text');
    
    // Google Translate TTS URL
    const url = new URL('https://translate.googleapis.com/translate_tts');
    url.searchParams.append('client', 'gtx');
    url.searchParams.append('sl', 'fr');
    url.searchParams.append('tl', 'fr');
    url.searchParams.append('dt', 't');
    url.searchParams.append('q', text);
    
    try {
        const response = await fetch(url.toString(), {
            headers: {
                // Mimic standard browser to bypass restrictions
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Referer': 'https://translate.google.com/'
            }
        });
        
        if (!response.ok) {
            console.error('Google TTS error:', response.status, response.statusText);
            return res.status(response.status).send('Google TTS proxy error');
        }
        
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
        
        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (error) {
        console.error('Proxy Fetch Error:', error);
        res.status(500).send('Internal Server Error');
    }
}
