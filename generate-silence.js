const fs = require('fs');
// 1 second of silence in WAV format
const wavHeader = Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex');
console.log('data:audio/wav;base64,' + wavHeader.toString('base64'));
