/* ─────────────────────────────────────────────────
   신트리 큐레이션 — OpenAI DALL-E 3 헤더 이미지 생성
   - 큐레이션 컨셉 → DALL-E 3 프롬프트 변환
   - 생성된 이미지는 public/generated/ 에 저장 (캐시)
───────────────────────────────────────────────── */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const https = require('https');

/**
 * 큐레이션 컨셉 → DALL-E 3 영문 프롬프트 변환
 * @param {{ emoji: string, title: string, description: string }} concept
 * @returns {string}
 */
function buildImagePrompt(concept) {
  const combined = `${concept.emoji || ''} ${concept.title || ''} ${concept.description || ''}`.toLowerCase();

  /* ── 계절 감지 ── */
  const isWinter = /❄|⛄|눈|겨울|winter|cold/.test(combined);
  const isAutumn = /🍂|🍁|가을|autumn|fall/.test(combined);
  const isSummer = /☀|🌞|여름|summer|hot/.test(combined);

  /* ── 감정/주제 감지 ── */
  const hasWeariness  = /권태|지침|피로|지루|tired|weary|ennui|boredom/.test(combined);
  const hasLoneliness = /외로|고독|혼자|lonely|solitude/.test(combined);
  const hasHope       = /희망|용기|살아있|다시|alive|hope|courage/.test(combined);
  const hasLove       = /사랑|love|heart|연인/.test(combined);
  const hasReading    = /책|읽|book|read|도서/.test(combined);
  const hasGrowth     = /성장|growth|여행|journey|변화/.test(combined);
  const hasMelancholy = /슬|우울|눈물|sad|meland|grief/.test(combined);

  /* ── 배경 설정 ── */
  let setting;
  if (isWinter)      setting = 'snowy winter landscape, soft blue-white palette, delicate snowflakes, icy bokeh orbs, silver birch trees';
  else if (isAutumn) setting = 'autumn landscape, golden and crimson leaves gently falling, warm amber-orange palette, cozy misty light';
  else if (isSummer) setting = 'bright summer meadow, lush green leaves, warm golden sunshine, yellow-green palette, tiny wildflowers';
  else               setting = 'gentle spring scene, soft pink cherry blossoms, fresh pastel green leaves, floating petals, dappled light';

  /* ── 인물 표현 ── */
  let character;
  if (hasWeariness && hasHope)    character = 'A small cute clay character lying languidly on soft grass, heavy-lidded dreamy eyes, one hand reaching gently toward the sky';
  else if (hasWeariness)          character = 'A small cute clay character lying languidly among flowers, heavy-lidded dreamy eyes, utterly relaxed posture';
  else if (hasMelancholy)         character = 'A small clay character sitting quietly with knees drawn up, soft melancholic expression, gentle tears';
  else if (hasLoneliness)         character = 'A small solitary clay character sitting on a hilltop, soft contemplative expression, looking into the horizon';
  else if (hasHope || hasGrowth)  character = 'A small clay character looking upward with wide sparkling eyes, arms gently open, cheerful hopeful posture';
  else if (hasReading)            character = 'A small clay character sitting cross-legged reading a tiny book, cozy absorbed expression, soft smile';
  else if (hasLove)               character = 'Two small clay characters sitting side by side, warm gentle expressions, soft glow between them';
  else                            character = 'A small charming clay character with a gentle peaceful smile, relaxed sitting pose';

  /* ── 부가 요소 ── */
  let extras;
  if (hasReading)      extras = 'tiny floating books and paper pages, soft glowing pastel bokeh orbs';
  else if (hasLove)    extras = 'small soft floating hearts, warm glowing orbs, rose petals';
  else if (hasGrowth)  extras = 'tiny glowing stars, floating feathers, warm light rays';
  else                 extras = 'soft glowing pastel bokeh orbs, delicate translucent floating shapes';

  /* ── 프롬프트 조립 ── */
  const style  = 'Soft 3D clay illustration style, warm pastel color palette, smooth rounded matte forms, gentle ambient lighting, shallow depth of field, cute chibi proportions.';
  const scene  = `${character}, ${setting}, ${extras}.`;
  const format = 'Wide horizontal banner composition (16:9), subject centered with breathing room, calm dreamy atmosphere, soft vignette edges. No text, no letters, no numbers, no watermarks anywhere in the image.';

  return `${style} ${scene} ${format}`;
}

/**
 * URL에서 이미지를 다운로드해 로컬 파일로 저장
 */
function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, res => {
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(`이미지 다운로드 실패: HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', err => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }).on('error', err => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * 큐레이션 컨셉으로 헤더 이미지 생성 (DALL-E 3)
 * 이미 생성된 이미지가 있으면 캐시에서 반환.
 *
 * @param {{ emoji: string, title: string, description: string }} concept
 * @param {string} cacheKey  - 주차별 고유 키 (publishDate or vol)
 * @param {string} publicDir - public/ 디렉터리 절대 경로
 * @returns {Promise<string>} - 서버 상대 URL, e.g. "/generated/2026-05-23.png"
 */
async function generateHeaderImage(concept, cacheKey, publicDir) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.');
  }

  const generatedDir = path.join(publicDir, 'generated');
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }

  /* 파일명 안전하게 변환 */
  const safeKey  = (cacheKey || 'header').replace(/[^a-zA-Z0-9\-_]/g, '_');
  const filePath = path.join(generatedDir, `${safeKey}.png`);
  const fileUrl  = `/generated/${safeKey}.png`;

  /* 캐시 히트 — 이미 생성된 이미지 */
  if (fs.existsSync(filePath)) {
    console.log(`  🖼️  헤더 이미지 캐시 사용: ${fileUrl}`);
    return fileUrl;
  }

  /* gpt-image-1 호출 */
  const prompt = buildImagePrompt(concept);
  console.log(`\n  🎨 gpt-image-1 이미지 생성 시작`);
  console.log(`  📝 Prompt (앞 120자): ${prompt.slice(0, 120)}...`);

  /* OpenAI SDK — dynamic require (설치 여부 확인) */
  let openaiModule;
  try {
    openaiModule = require('openai');
  } catch {
    throw new Error('openai 패키지가 설치되지 않았습니다. npm install openai 를 실행하세요.');
  }

  const { OpenAI } = openaiModule;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  /* gpt-image-1: 1536×1024 (가로형 배너), base64 응답 */
  const response = await client.images.generate({
    model:   'gpt-image-1',
    prompt,
    n:       1,
    size:    '1536x1024',
    quality: 'medium',
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('OpenAI API 응답에 이미지 데이터가 없습니다.');
  }

  /* base64 → PNG 파일로 저장 */
  fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
  console.log(`  ✅ 헤더 이미지 저장: ${fileUrl}\n`);

  return fileUrl;
}

module.exports = { generateHeaderImage, buildImagePrompt };
