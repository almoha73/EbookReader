import JSZip from 'jszip';

/**
 * Génère le contenu d'un fichier container.xml standard pour EPUB
 */
const getContainerXml = () => `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

/**
 * Génère le fichier content.opf (manifeste et métadonnées)
 */
const getOpfXml = (title, author, chapters, coverId, coverMimeType) => `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</dc:title>
    <dc:creator>${author.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</dc:creator>
    <dc:language>fr</dc:language>
    <dc:identifier id="BookID">urn:uuid:${crypto.randomUUID()}</dc:identifier>
    ${coverId ? `<meta name="cover" content="${coverId}"/>` : ''}
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${coverId ? `<item id="${coverId}" href="cover.jpg" media-type="${coverMimeType || 'image/jpeg'}"/>` : ''}
    ${chapters.map((ch, i) => `<item id="chapter_${i}" href="chapter_${i}.html" media-type="application/xhtml+xml"/>`).join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${chapters.map((ch, i) => `<itemref idref="chapter_${i}"/>`).join('\n    ')}
  </spine>
</package>`;

/**
 * Génère le fichier toc.ncx (table des matières)
 */
const getNcxXml = (title, chapters) => `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${crypto.randomUUID()}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></docTitle>
  <navMap>
    ${chapters.map((ch, i) => `
    <navPoint id="navPoint-${i+1}" playOrder="${i+1}">
      <navLabel><text>${ch.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></navLabel>
      <content src="chapter_${i}.html"/>
    </navPoint>`).join('')}
  </navMap>
</ncx>`;

/**
 * Génère une page HTML pour un chapitre
 */
const getHtmlPage = (title, bodyHtml) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<title>${title}</title>
</head>
<body>
${bodyHtml}
</body>
</html>`;

/**
 * Convertit un fichier texte en EPUB.
 * Découpe artificiellement le texte en "chapitres" s'il est trop long.
 */
export async function convertTxtToEpub(file) {
  const text = await file.text();
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  
  const title = file.name.replace(/\.txt$/i, '');
  const author = "Inconnu";
  
  // Regrouper par paquets de 200 paragraphes (~1 chapitre)
  const chapters = [];
  const chunkSize = 200;
  for (let i = 0; i < paragraphs.length; i += chunkSize) {
    const chunk = paragraphs.slice(i, i + chunkSize);
    const bodyHtml = chunk.map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('\n');
    chapters.push({
      title: `Partie ${Math.floor(i / chunkSize) + 1}`,
      bodyHtml
    });
  }

  return buildEpubFile(title, author, chapters, `${title}.epub`);
}

/**
 * Convertit un fichier FB2 (XML) en EPUB.
 */
export async function convertFb2ToEpub(file) {
  const xmlText = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "text/xml");

  // Si erreur de parsing
  if (doc.querySelector("parsererror")) {
    throw new Error("Le fichier FB2 n'est pas un XML valide.");
  }

  // Extraire les métadonnées
  const titleNode = doc.querySelector("description title-info book-title");
  let title = titleNode ? titleNode.textContent.trim() : file.name.replace(/\.fb2$/i, '');

  const authorFirstName = doc.querySelector("description title-info author first-name")?.textContent || "";
  const authorLastName = doc.querySelector("description title-info author last-name")?.textContent || "";
  let author = `${authorFirstName} ${authorLastName}`.trim();
  if (!author) author = "Inconnu";

  // Extraire la couverture
  let coverBase64 = null;
  let coverMimeType = "image/jpeg";
  const coverImageNode = doc.querySelector("description title-info coverpage image");
  
  if (coverImageNode) {
    const href = coverImageNode.getAttribute("l:href") || coverImageNode.getAttribute("xlink:href") || coverImageNode.getAttribute("href");
    if (href && href.startsWith("#")) {
      const id = href.substring(1);
      const binaryNode = doc.querySelector(`binary[id="${id}"]`);
      if (binaryNode) {
        coverBase64 = binaryNode.textContent.trim();
        coverMimeType = binaryNode.getAttribute("content-type") || "image/jpeg";
      }
    }
  }

  // Extraire le contenu (les <section> dans le <body> principal)
  const bodies = Array.from(doc.querySelectorAll("body"));
  const mainBody = bodies[0]; // Normalement le premier body contient le texte, les autres les notes.
  
  if (!mainBody) {
      throw new Error("Impossible de trouver le contenu (body) dans le fichier FB2.");
  }

  const chapters = [];
  const sections = Array.from(mainBody.children).filter(el => el.tagName === "section");

  if (sections.length === 0) {
      // Si pas de sections, on prend tout le body
      const bodyHtml = parseFb2Node(mainBody);
      chapters.push({ title: "Contenu", bodyHtml });
  } else {
      for (let i = 0; i < sections.length; i++) {
          const section = sections[i];
          const sectionTitleNode = section.querySelector("title");
          const sectionTitle = sectionTitleNode ? sectionTitleNode.textContent.trim() : `Chapitre ${i + 1}`;
          const bodyHtml = parseFb2Node(section);
          chapters.push({ title: sectionTitle, bodyHtml });
      }
  }

  return buildEpubFile(title, author, chapters, `${title}.epub`, coverBase64, coverMimeType);
}

/**
 * Transforme récursivement les balises FB2 en balises HTML basiques
 */
function parseFb2Node(node) {
  let html = "";
  for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
          html += child.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      } else if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.tagName.toLowerCase();
          switch(tag) {
              case 'p':
                  html += `<p>${parseFb2Node(child)}</p>`;
                  break;
              case 'title':
                  html += `<h2>${parseFb2Node(child)}</h2>`;
                  break;
              case 'subtitle':
                  html += `<h3>${parseFb2Node(child)}</h3>`;
                  break;
              case 'empty-line':
                  html += `<br/>`;
                  break;
              case 'strong':
                  html += `<strong>${parseFb2Node(child)}</strong>`;
                  break;
              case 'emphasis':
                  html += `<em>${parseFb2Node(child)}</em>`;
                  break;
              case 'section':
                  // Si des sections sont imbriquées, on les met bout à bout
                  html += `<div>${parseFb2Node(child)}</div>`;
                  break;
              default:
                  // Ignore ou passe-plat
                  html += parseFb2Node(child);
                  break;
          }
      }
  }
  return html;
}

/**
 * Fabrique le fichier .epub final
 */
async function buildEpubFile(title, author, chapters, filename, coverBase64 = null, coverMimeType = null) {
  const zip = new JSZip();

  // Mimetype (doit être le premier fichier, non compressé, mais jszip le gère)
  zip.file("mimetype", "application/epub+zip");

  // META-INF
  const metaInf = zip.folder("META-INF");
  metaInf.file("container.xml", getContainerXml());

  // OEBPS
  const oebps = zip.folder("OEBPS");
  const coverId = coverBase64 ? "cover-image" : null;
  oebps.file("content.opf", getOpfXml(title, author, chapters, coverId, coverMimeType));
  oebps.file("toc.ncx", getNcxXml(title, chapters));

  if (coverBase64) {
    oebps.file("cover.jpg", coverBase64, { base64: true });
  }

  chapters.forEach((ch, i) => {
    oebps.file(`chapter_${i}.html`, getHtmlPage(ch.title, ch.bodyHtml));
  });

  // Générer le Blob
  const content = await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
  
  // Transformer en objet File
  return new File([content], filename, { type: "application/epub+zip" });
}
