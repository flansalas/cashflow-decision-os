const fs = require('fs');
const Tesseract = require('tesseract.js');

Tesseract.recognize(
  '/Users/flans/.gemini/antigravity/brain/1b0df994-bd3b-4d01-b2f8-8b77a61a1e47/media__1776343244756.png',
  'eng',
  { logger: m => {} }
).then(({ data: { text } }) => {
  console.log("OCR Extracted Text:");
  console.log(text);
}).catch(console.error);
