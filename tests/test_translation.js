const https = require('https');

async function testOnline() {
  console.log('Testing MyMemory online translation...');
  const text = 'The attention mechanism achieves state-of-the-art performance.';
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`;
  
  const res = await fetch(url);
  const data = await res.json();
  console.log('Status:', res.status);
  console.log('Result:', data?.responseData?.translatedText);

  console.log('Testing audio voice endpoint...');
  const audioRes = await fetch('https://dict.youdao.com/dictvoice?audio=hypothesis&type=2');
  console.log('Audio Status:', audioRes.status, audioRes.headers.get('content-type'));
}

testOnline().catch(console.error);
