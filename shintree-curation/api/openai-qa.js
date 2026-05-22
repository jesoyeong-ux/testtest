/* ─────────────────────────────────────────────────
   신트리 큐레이션 — OpenAI 책별 Q&A 실시간 생성
   각 책의 제목·저자·소개를 기반으로
   트렌드·줄거리·추천이유가 담긴 Q&A를 생성합니다.
───────────────────────────────────────────────── */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('https');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SEASON_CONTEXT = {
  1: '새해 시작, 신년 다짐, 겨울',
  2: '졸업·입학 시즌, 봄 준비',
  3: '새학기, 벚꽃, 봄 나들이',
  4: '봄, 나들이, 어린이날 준비',
  5: '가정의 달, 어버이날, 황금연휴, 봄',
  6: '여름 준비, 장마 시작',
  7: '여름 휴가, 무더위, 바캉스',
  8: '여름 독서, 피서, 방학',
  9: '가을, 독서의 계절, 추석',
  10: '단풍, 깊어가는 가을',
  11: '수능, 늦가을, 연말 준비',
  12: '연말, 크리스마스, 한해 마무리',
};

const SECTION_HINT = {
  essay:   '에세이·산문집. 일상·감성·공감 위주.',
  novel:   '소설·픽션. 줄거리·인물·결말 분위기 중요.',
  selfdev: '자기계발·경제경영. 실용성·적용법·추천 대상 중요.',
  bonus:   '베스트셀러·화제작. 왜 지금 이 책인지, 트렌드 맥락 중요.',
};

function callOpenAI(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.92,
      max_tokens: 700,
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.error) return reject(new Error(j.error.message));
          resolve(j.choices?.[0]?.message?.content || '');
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(18000, () => { req.destroy(); reject(new Error('OpenAI 타임아웃')); });
    req.write(body);
    req.end();
  });
}

/**
 * 책 한 권의 Q&A 2개를 OpenAI로 생성
 * @param {{ title, author, _rawDescription }} book
 * @param {'essay'|'novel'|'selfdev'|'bonus'} sectionKey
 * @returns {Promise<Array<{q:string, a:string}>>}
 */
async function generateBookQA(book, sectionKey) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY 없음');

  const month   = new Date().getMonth() + 1;
  const season  = SEASON_CONTEXT[month] || '봄';
  const hint    = SECTION_HINT[sectionKey] || '';
  const desc    = (book._rawDescription || '').slice(0, 300);

  const prompt = `당신은 인천 신트리 도서관의 트렌드에 밝은 사서예요.
아래 책에 대해 도서관 방문객과 나눌 실제 대화 Q&A 2개를 써주세요.

책 정보
- 제목: ${book.title}
- 저자: ${book.author}
- 장르: ${hint}
- 책 소개: ${desc || '(정보 없음)'}
- 현재 시기: ${season}

Q&A 작성 규칙
1. 질문(Q): 독자가 실제로 궁금해할 것 — 책 내용/줄거리 힌트, 어떤 사람에게 추천하는지, 사회·SNS·TV 이슈와 연결된 질문 등. "읽기 쉬운가요?" 같은 뻔한 질문 절대 금지.
2. 답변(A): 책 실제 내용을 구체적으로 언급하거나, 저자 배경, 독자 후기, 현재 사회 트렌드(유튜브 알고리즘, 인스타그램, 한국 드라마, 사회 이슈)와 자연스럽게 연결. 2~3문장, 친근한 구어체, 이모지 1~2개.
3. 2번째 Q&A는 1번째와 완전히 다른 각도(예: 1번이 내용이면 2번은 추천 대상 또는 트렌드).

JSON 배열만 출력 (다른 텍스트 없이):
[{"q":"...","a":"..."},{"q":"...","a":"..."}]`;

  const raw = await callOpenAI([{ role: 'user', content: prompt }]);

  const match = raw.match(/\[[\s\S]*?\]/);
  if (!match) throw new Error('JSON 파싱 실패');
  const qa = JSON.parse(match[0]);
  if (!Array.isArray(qa) || qa.length < 1) throw new Error('Q&A 배열 이상');
  return qa;
}

/**
 * 섹션 내 모든 책에 AI Q&A 적용 (실패 시 기존 템플릿 유지)
 * @param {Array} books
 * @param {string} sectionKey
 * @returns {Promise<Array>}
 */
async function enrichBooksWithQA(books, sectionKey) {
  if (!OPENAI_API_KEY) return books;

  const results = await Promise.allSettled(
    books.map(book => generateBookQA(book, sectionKey))
  );

  return books.map((book, i) => {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value?.length) {
      return { ...book, qa: r.value };
    }
    console.warn(`  ⚠️  [${book.title}] AI Q&A 실패, 템플릿 사용:`, r.reason?.message || '');
    return book; // 기존 템플릿 Q&A 유지
  });
}

module.exports = { enrichBooksWithQA };
