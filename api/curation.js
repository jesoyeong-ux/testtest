/* ─────────────────────────────────────────────────
   신트리 큐레이션 — Claude AI 실시간 큐레이션 생성
   - 새로고침 시 Claude API로 즉석 큐레이션 생성
   - 현재 계절/월/트렌드 반영
   - pool/ 에 저장해 재사용 가능
───────────────────────────────────────────────── */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');

/** 현재 날짜 기반 계절/분위기 컨텍스트 */
function getSeasonContext() {
  const now   = new Date();
  const month = now.getMonth() + 1; // 1-12
  const day   = now.getDate();
  const year  = now.getFullYear();
  const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

  const seasonMap = {
    3: '봄 (새학기, 새출발, 벚꽃)',
    4: '봄 (따뜻한 햇살, 야외활동)',
    5: '봄 (가정의달, 어린이날, 어버이날)',
    6: '초여름 (휴가 준비, 무더위 시작)',
    7: '여름 (무더운 여름, 바다, 피서)',
    8: '여름 (여름휴가, 독서의 계절)',
    9: '가을 (독서의 계절, 풍성한 수확)',
    10: '가을 (단풍, 깊어가는 가을)',
    11: '늦가을 (겨울 준비, 쓸쓸한 감성)',
    12: '겨울 (연말, 크리스마스, 한해 마무리)',
    1:  '겨울 (새해 시작, 다짐)',
    2:  '겨울 끝 (봄 기다림, 졸업)',
  };

  return {
    dateStr,
    month,
    year,
    season: seasonMap[month] || '봄',
    isSpecial: getSpecialEvent(month, day),
  };
}

function getSpecialEvent(month, day) {
  if (month === 1 && day <= 3)   return '새해 첫 날';
  if (month === 3 && day <= 10)  return '새학기 시작';
  if (month === 5 && day >= 1 && day <= 10) return '어린이날/어버이날';
  if (month === 12 && day >= 20) return '연말/크리스마스';
  return null;
}

/** pool/ 폴더에서 현재 최대 vol 번호 추출 */
function getNextVolNumber(poolDir) {
  if (!fs.existsSync(poolDir)) return 3;
  try {
    const files = fs.readdirSync(poolDir).filter(f => f.endsWith('.json'));
    let maxVol = 0;
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(poolDir, f), 'utf-8'));
        const volStr = data.vol || '';
        const match = volStr.match(/Vol\.(\d+)/i);
        if (match) maxVol = Math.max(maxVol, parseInt(match[1], 10));
      } catch { /* skip */ }
    }
    return maxVol + 1;
  } catch { return 3; }
}

/** 기존 pool 도서 ISBN 목록 추출 (중복 방지용) */
function getPoolISBNs(poolDir) {
  const isbns = new Set();
  if (!fs.existsSync(poolDir)) return isbns;
  try {
    const files = fs.readdirSync(poolDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(poolDir, f), 'utf-8'));
        for (const sec of Object.values(data.sections || {})) {
          for (const book of sec.books || []) {
            if (book.isbn13) isbns.add(book.isbn13);
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return isbns;
}

/** AI 생성 프롬프트 구성 */
function buildCurationPrompt(ctx, nextVol, existingISBNs) {
  const isbnHint = existingISBNs.size > 0
    ? `\n\n⚠️ 아래 ISBN은 이미 추천된 도서이므로 반드시 제외:\n${[...existingISBNs].join(', ')}`
    : '';

  return `당신은 인천광역시교육청 신트리도서관의 주간 북큐레이터입니다.
오늘 날짜: ${ctx.dateStr}
현재 계절/분위기: ${ctx.season}${ctx.isSpecial ? ` / 특별한 날: ${ctx.isSpecial}` : ''}

공공도서관 이용자(20~50대 성인)를 위한 이번 주 큐레이션 7권을 선정해주세요.${isbnHint}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 Q&A 작성 핵심 원칙 (가장 중요)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Q&A는 이 큐레이션의 핵심 콘텐츠입니다. 반드시 아래를 지켜주세요.

✅ 질문(Q) — 독자가 실제로 궁금해할 것:
  · 책의 줄거리·핵심 소재·인물을 언급한 구체적 질문
  · 최신 한국 트렌드와 연결 (예: "유튜브 알고리즘", "인스타 릴스", "요즘 드라마 OST", "워라밸", "갓생", "MZ 번아웃", "챗GPT 시대", "부동산 영끌", 수능, 육아 등)
  · 독자의 상황과 연결 (예: "이직 고민인데", "연애가 잘 안 풀릴 때", "번아웃이 왔을 때")
  · "읽기 쉬운가요?", "어떤 분위기인가요?" 같은 뻔한 질문 절대 금지

✅ 답변(A) — 사서의 친근하고 정보 풍부한 답변:
  · 책의 실제 내용·줄거리·핵심 주제를 구체적으로 언급
  · 저자 배경, 출판 당시 화제, 독자 반응, 수상 경력 등 사실 기반 정보 포함
  · 현재 사회적 트렌드(SNS, 방송, 이슈)와 자연스럽게 연결
  · 2~4문장, 친근한 구어체, 이모지 1~2개
  · 읽는 데 걸리는 시간이나 권수 정보도 자연스럽게 포함 가능

✅ 좋은 Q&A 예시 참고:
  Q: "제목이 너무 자극적이지 않아요?"
  A: "그게 포인트예요. 죽고 싶다 = 사라지고 싶다 = 쉬고 싶다. 이 책은 그 감정에 이름을 붙여줘요. MZ 번아웃 시대에 읽으면 '나만 이런 게 아니었구나' 싶어요 🌙"

  Q: "노벨상 받은 다음에 읽으면 다르다는 게 진짜예요?"
  A: "진짜예요. 2024년 수상 이후 전 세계 독자들이 동시에 읽는 느낌이에요. '이게 왜 노벨상인가'가 오히려 선명하게 보여요 🌿"

  Q: "틱톡·유튜브 쇼츠 때문에 집중력 떨어진 거잖아요, 그게 책까지 읽을 거예요?"
  A: "이 책 읽고 나면 폰 잡을 때마다 '아 지금 내 집중력이 팔리고 있구나'가 느껴져요. 디지털 디톡스 챌린지 유행하는 이유가 있거든요 😤"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
JSON만 출력하세요 (설명문 없이):

{
  "vol": "${ctx.year} · Vol.${String(nextVol).padStart(2,'0')}",
  "publishDate": "${ctx.dateStr}",
  "concept": {
    "emoji": "이번 주 무드를 표현하는 이모지 1개",
    "title": "큐레이션 제목 (15자 이내, 매주 다른 주제)",
    "description": "이번 주 큐레이션 소개 2~3문장. 현재 계절/시기/트렌드 반영. 개행은 \\n"
  },
  "sections": {
    "essay": {
      "label": "✍️ 에세이",
      "books": [
        {
          "title": "실제 존재하는 책 제목",
          "author": "저자명",
          "isbn13": "9791234567890 (정확한 13자리)",
          "hookSentence": "독자 마음을 즉시 사로잡는 한 문장 (30자 이내, 책 핵심 분위기 반영)",
          "qa": [
            {
              "q": "이 책의 실제 내용이나 트렌드와 연결된 구체적 질문",
              "a": "책 내용·저자·트렌드를 언급한 2~4문장 구어체 답변 이모지포함"
            },
            {
              "q": "다른 각도의 두 번째 질문 (추천 대상, 사회 이슈, 줄거리 힌트 등)",
              "a": "두 번째 답변 이모지포함"
            }
          ],
          "tags": ["#태그1", "#태그2", "#태그3"]
        }
      ]
    },
    "novel": { "label": "📖 소설", "books": [ /* 동일 구조 2권 */ ] },
    "selfdev": { "label": "💡 자기계발", "books": [ /* 동일 구조 2권 */ ] },
    "bonus": { "label": "🎁 이번 주 보너스 픽", "books": [ /* 동일 구조 1권, 보너스 이유 Q에 포함 */ ] }
  },
  "curatorNote": "사서의 진심 어린 마무리 코멘트 (2~3문장, 현재 시기 반영)",
  "hashtags": "#신트리도서관 #주간큐레이션 #부평도서관 #책추천 #관련태그"
}`;
}

/** Claude API 응답에서 JSON 추출 */
function extractJSON(text) {
  // JSON 코드블록 안에 있을 수 있음
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlock) return codeBlock[1].trim();

  // 바로 JSON 시작
  const jsonStart = text.indexOf('{');
  const jsonEnd   = text.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    return text.slice(jsonStart, jsonEnd + 1);
  }

  throw new Error('Claude 응답에서 JSON을 찾을 수 없습니다');
}

/** 생성된 큐레이션 유효성 검사 및 보정 */
function validateCuration(data, ctx, nextVol) {
  const required = ['vol', 'publishDate', 'concept', 'sections', 'curatorNote', 'hashtags'];
  for (const key of required) {
    if (!data[key]) throw new Error(`큐레이션 필드 누락: ${key}`);
  }

  // sections 필수 검사
  const requiredSections = ['essay', 'novel', 'selfdev', 'bonus'];
  for (const sec of requiredSections) {
    if (!data.sections[sec]?.books?.length) {
      throw new Error(`섹션 [${sec}] 누락 또는 책 없음`);
    }
  }

  // 날짜 보정
  data.publishDate = ctx.dateStr;

  // hashtags에 신트리도서관 포함 보장
  if (!data.hashtags.includes('신트리도서관')) {
    data.hashtags = '#신트리도서관 ' + data.hashtags;
  }

  return data;
}

/**
 * Claude API로 실시간 큐레이션 생성
 * @param {string} poolDir   - books/pool/ 절대 경로
 * @param {string} weeklyPath - books/weekly.json 경로 (저장 대상)
 * @returns {Promise<object>} - 생성된 큐레이션 데이터
 */
async function generateAICuration(poolDir, weeklyPath) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.');
  }

  /* Anthropic SDK 로드 */
  let AnthropicClient;
  try {
    const sdk = require('@anthropic-ai/sdk');
    AnthropicClient = sdk.Anthropic || sdk.default;
  } catch {
    throw new Error('@anthropic-ai/sdk 패키지가 없습니다. npm install @anthropic-ai/sdk 를 실행하세요.');
  }

  const client = new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY });

  const ctx          = getSeasonContext();
  const nextVol      = getNextVolNumber(poolDir);
  const existingISBNs = getPoolISBNs(poolDir);

  console.log(`\n  🤖 Claude AI 큐레이션 생성 시작`);
  console.log(`  📅 날짜: ${ctx.dateStr} / 계절: ${ctx.season}`);
  console.log(`  📚 Vol.${nextVol} 생성 중...`);

  const prompt = buildCurationPrompt(ctx, nextVol, existingISBNs);

  /* Claude API 호출 */
  const response = await client.messages.create({
    model:      'claude-sonnet-4-6',  // 고품질 큐레이션 (Sonnet 4.6)
    max_tokens: 4096,
    temperature: 1,                   // 창의성 최대
    messages: [
      { role: 'user', content: prompt }
    ],
  });

  const rawText = response.content?.[0]?.text;
  if (!rawText) throw new Error('Claude API 응답이 비어 있습니다');

  console.log(`  ✅ Claude 응답 수신 (${rawText.length}자)`);

  /* JSON 파싱 및 검증 */
  const jsonStr   = extractJSON(rawText);
  const curation  = JSON.parse(jsonStr);
  const validated = validateCuration(curation, ctx, nextVol);

  /* pool/ 에 저장 (추후 재사용) */
  if (!fs.existsSync(poolDir)) fs.mkdirSync(poolDir, { recursive: true });
  const poolFileName = `vol-${String(nextVol).padStart(2,'0')}-ai-${ctx.dateStr}.json`;
  const poolFilePath = path.join(poolDir, poolFileName);
  fs.writeFileSync(poolFilePath, JSON.stringify(validated, null, 2), 'utf-8');
  console.log(`  💾 pool 저장: ${poolFileName}`);

  /* weekly.json 교체 */
  const weeklyDir = path.dirname(weeklyPath);
  if (!fs.existsSync(weeklyDir)) fs.mkdirSync(weeklyDir, { recursive: true });
  fs.writeFileSync(weeklyPath, JSON.stringify(validated, null, 2), 'utf-8');
  console.log(`  🔄 weekly.json 교체 완료`);

  return validated;
}

module.exports = { generateAICuration };
