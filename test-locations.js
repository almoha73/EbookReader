const ePub = require('epubjs');
async function run() {
  console.time('Load');
  const book = ePub('https://s3.amazonaws.com/moby-dick/moby-dick.epub');
  await book.ready;
  console.timeEnd('Load');
  
  console.time('Locations');
  await book.locations.generate(1600);
  console.timeEnd('Locations');
  
  console.log('Total locations:', book.locations.total);
  const cfi = book.spine.get(10).href;
  console.log('Percentage of chapter 10:', book.locations.percentageFromCfi(cfi));
}
run().catch(console.error);
