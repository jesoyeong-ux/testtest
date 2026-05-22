require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('https');

const CLIENT_ID = process.env.NAVER_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

function searchBook(query) {
  return new Promise((resolve, reject) => {
    const encodedQuery = encodeURIComponent(query);
    const options = {
      hostname: 'openapi.naver.com',
      path: `/v1/search/book.json?query=${encodedQuery}&display=1`,
      method: 'GET',
      headers: {
        'X-Naver-Client-Id': CLIENT_ID,
        'X-Naver-Client-Secret': CLIENT_SECRET,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        // HTTP 상태 코드 검증 — 401/403은 인증 오류로 명시
        if (res.statusCode === 401 || res.statusCode === 403) {
          return reject(new Error(`네이버 API 인증 오류 (${res.statusCode}): API 키를 확인해주세요.`));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`네이버 API 응답 오류: HTTP ${res.statusCode}`));
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed.items && parsed.items.length > 0) {
            const item = parsed.items[0];
            resolve({
              title: item.title.replace(/<[^>]+>/g, ''),
              author: item.author,
              image: item.image,
              isbn: item.isbn,
              description: item.description,
              publisher: item.publisher,
              pubdate: item.pubdate,
              link: item.link,
            });
          } else {
            resolve(null);
          }
        } catch (e) {
          reject(new Error(`응답 파싱 실패: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    // 타임아웃 10초 (data4lib.js와 동일 기준)
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('네이버 API 타임아웃 (10초)'));
    });
    req.end();
  });
}

// 단독 실행 시 연결 테스트
if (require.main === module) {
  (async () => {
    console.log('네이버 책 API 연결 테스트...\n');
    const testQuery = '불편한 편의점';
    try {
      const result = await searchBook(testQuery);
      if (result) {
        console.log('✅ 연결 성공!\n');
        console.log(`제목:   ${result.title}`);
        console.log(`저자:   ${result.author}`);
        console.log(`ISBN:   ${result.isbn}`);
        console.log(`표지:   ${result.image}`);
        console.log(`출판사: ${result.publisher}`);
      } else {
        console.log('❌ 검색 결과 없음');
      }
    } catch (err) {
      console.error('❌ API 호출 실패:', err.message);
    }
  })();
}

module.exports = { searchBook };
