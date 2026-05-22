require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('https');

const AUTH_KEY = process.env.DATA4LIB_AUTH_KEY;
const DEFAULT_LIB_CODE = process.env.SHINTREE_LIB_CODE || '241008';

function apiGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'data4library.kr',
      path,
      method: 'GET',
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`응답 파싱 실패: ${e.message}\n원문: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('요청 타임아웃 (10초)'));
    });
    req.end();
  });
}

// 신트리 도서관 libCode 조회
async function findShintreeLibCode() {
  const path = `/api/libSrch?authKey=${AUTH_KEY}&libName=${encodeURIComponent('신트리')}&format=json`;
  try {
    const data = await apiGet(path);
    const libs = data?.response?.libs;
    if (!libs || libs.length === 0) return null;
    return libs.map((l) => ({
      libCode: l.lib.libCode,
      libName: l.lib.libName,
      address: l.lib.address,
    }));
  } catch (err) {
    throw new Error(`libSrch 실패: ${err.message}`);
  }
}

// 소장/대출 가능 여부 조회
async function checkBookAvailability(isbn13, libCode = DEFAULT_LIB_CODE) {
  const path = `/api/bookExist?authKey=${AUTH_KEY}&libCode=${libCode}&isbn13=${isbn13}&format=json`;
  try {
    const data = await apiGet(path);
    // 도서관 코드 오류 응답 처리
    if (data?.response?.error) {
      return { status: 'unregistered', badge: '📍 직접 확인', color: 'gray' };
    }
    const result = data?.response?.result;
    if (!result) return { status: 'unknown', badge: '📍 직접 확인', color: 'gray' };

    if (result.loanAvailable === 'Y') {
      return { status: 'available', badge: '✅ 대출 가능', color: 'green', hasBook: true, loanAvailable: true };
    } else if (result.hasBook === 'Y') {
      return { status: 'reserved', badge: '⏳ 예약 가능', color: 'yellow', hasBook: true, loanAvailable: false };
    } else if (result.hasBook === 'N') {
      return { status: 'interlibrary', badge: '📦 상호대차', color: 'blue', hasBook: false };
    }
    return { status: 'unknown', badge: '🔗 신트리 확인', color: 'gray' };
  } catch (err) {
    // API 미승인 또는 오류 시 graceful 처리
    return { status: 'error', badge: '🔗 신트리 확인', color: 'gray', error: err.message };
  }
}

// 단독 실행 시 테스트
if (require.main === module) {
  (async () => {
    console.log('도서관 정보나루 API 테스트...\n');

    console.log('1. 신트리 도서관 libCode 조회');
    try {
      const libs = await findShintreeLibCode();
      if (libs) {
        console.log('✅ 조회 성공:');
        libs.forEach((l) => console.log(`   libCode: ${l.libCode} | ${l.libName} | ${l.address}`));
      } else {
        console.log('⚠️  검색 결과 없음 (API 승인 대기 중일 수 있음)');
      }
    } catch (err) {
      console.log(`⚠️  ${err.message}`);
      console.log('   → API 승인 후 재시도 필요. 현재 추정 libCode:', DEFAULT_LIB_CODE);
    }

    console.log('\n2. 소장/대출 가능 여부 조회 (ISBN: 9791192500201, 불편한 편의점)');
    const avail = await checkBookAvailability('9791192500201');
    console.log(`   결과: ${avail.badge} (status: ${avail.status})`);
    if (avail.error) console.log(`   오류 메시지: ${avail.error}`);
  })();
}

module.exports = { findShintreeLibCode, checkBookAvailability };
