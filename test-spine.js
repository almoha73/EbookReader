import ePub from 'epubjs';

async function run() {
  const book = ePub('https://s3.amazonaws.com/moby-dick/moby-dick.epub');
  await book.ready;
  console.log("Spine items:", book.spine.length);
  book.spine.each((item) => {
    console.log(`Href: ${item.href}, Size/Length/Index:`, Object.keys(item).filter(k => typeof item[k] === 'number' || typeof item[k] === 'string').map(k => `${k}:${item[k]}`));
  });
}
run();
