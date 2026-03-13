const fs = require('fs');
const epubjs = fs.readFileSync('/home/agnes/Bureau/Sites web/EbookReader/epub.min.js', 'utf8');
const match = epubjs.match(/locations\.(.*?)\b/g);
// Not easily readable because it's minified.
