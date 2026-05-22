require('dotenv').config();
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { searchBook }                      = require('./api/naver');
const { findShintreeLibCode, checkBookAvailability } = require('./api/data4lib');
const { generateCuration, getCurationData }          = require('./curation');
const { generateHeaderImage }                        = require('./api/openai-image');
const { generateNaverCuration }                      = require('./api/naver-curation');
const { generateAICuration }                         = require('./api/claude-curation');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/* ── 정적 파일 서빙 ──────────────────────────────────
   public/  → manifest.json, sw.js, icons/, index.html(SPA)
   output/  → 생성된 HTML 파일 (레거시 호환)
────────────────────────────────────────────────── */
app.use(express.static(path.join(__dirname, 'public')));
app.use('/output', express.static(path.join(__dirname, 'output')));

/* ── 헬스 체크 ──────────────────────────────────────── */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: '신트리 큐레이션 서버 실행 중' });
});

/* ── GET /api/curation ─────────────────────────────
   SPA용 JSON: weekly.json + 표지 URL + 대출 가능 여부
   캐시 파일(output/curation-cache.json)이 동일 주차면 재사용
────────────────────────────────────────────────── */
app.get('/api/curation', async (_req, res) => {
  const weeklyPath = path.join(__dirname, 'books/weekly.json');
  if (!fs.existsSync(weeklyPath)) {
    return res.status(404).json({ error: 'books/weekly.json 파일 없음' });
  }
  try {
    const data = await getCurationData(weeklyPath);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/refresh ─────────────────────────────
   1순위: ANTHROPIC_API_KEY 설정 시 Claude AI로 즉석 생성
          → books/pool/ 에 자동 저장 (히스토리 누적)
   2순위: pool 파일을 vol 순서대로 순환 (API 키 없을 때)
   → weekly.json 교체 → 캐시 삭제 → 새 큐레이션 반환
────────────────────────────────────────────────── */
app.post('/api/refresh', async (_req, res) => {
  const weeklyPath = path.join(__dirname, 'books', 'weekly.json');
  const poolDir    = path.join(__dirname, 'books', 'pool');
  const cacheFile  = path.join(__dirname, 'output', 'curation-cache.json');

  const clearCache = () => {
    if (fs.existsSync(cacheFile)) { try { fs.unlinkSync(cacheFile); } catch { /* 무시 */ } }
  };

  /* ── 1순위: Claude AI 생성 (ANTHROPIC_API_KEY 설정 시) ── */
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      console.log('\n  🤖 Claude AI 큐레이션 생성 중...');
      if (!fs.existsSync(poolDir)) fs.mkdirSync(poolDir, { recursive: true });
      const data = await generateAICuration(poolDir, weeklyPath);
      clearCache();
      console.log(`  ✅ AI 큐레이션 완료: ${data.vol}`);
      return res.json({ ...data, _source: 'ai' });
    } catch (err) {
      console.warn(`  ⚠️  Claude AI 생성 실패 (네이버 폴백): ${err.message}`);
    }
  }

  /* ── 2순위: 네이버 베스트셀러 기반 자동 생성 ──────── */
  try {
    console.log('\n  📚 네이버 베스트셀러 큐레이션 생성 중...');
    if (!fs.existsSync(poolDir)) fs.mkdirSync(poolDir, { recursive: true });
    await generateNaverCuration(poolDir, weeklyPath);  // pool/ 저장 + weekly.json 교체
    clearCache();
    const data = await getCurationData(weeklyPath);
    console.log(`  ✅ 큐레이션 완료: ${data.vol}`);
    return res.json({ ...data, _source: 'naver' });
  } catch (err) {
    console.warn(`  ⚠️  네이버 큐레이션 생성 실패 (pool 폴백): ${err.message}`);
    /* pool 폴백으로 계속 */
  }

  /* ── 2순위: pool 순환 ───────────────────────────── */
  if (!fs.existsSync(poolDir)) {
    return res.status(404).json({ error: 'books/pool/ 폴더가 없습니다.' });
  }

  try {
    /* vol 번호 순으로 정렬 */
    const files = fs.readdirSync(poolDir)
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => {
        try {
          const va = JSON.parse(fs.readFileSync(path.join(poolDir, a), 'utf-8')).vol || '';
          const vb = JSON.parse(fs.readFileSync(path.join(poolDir, b), 'utf-8')).vol || '';
          const na = parseInt(va.match(/\d+$/)?.[0] || '0', 10);
          const nb = parseInt(vb.match(/\d+$/)?.[0] || '0', 10);
          return na - nb;
        } catch { return a.localeCompare(b); }
      });

    if (files.length === 0) {
      return res.status(404).json({ error: 'books/pool/ 에 큐레이션 파일이 없습니다.' });
    }

    let currentVol = null;
    try { currentVol = JSON.parse(fs.readFileSync(weeklyPath, 'utf-8')).vol; } catch { /* 무시 */ }

    const currentIdx = files.findIndex(f => {
      try { return JSON.parse(fs.readFileSync(path.join(poolDir, f), 'utf-8')).vol === currentVol; }
      catch { return false; }
    });

    const nextIdx = (currentIdx + 1) % files.length;
    const picked  = files[nextIdx];
    fs.copyFileSync(path.join(poolDir, picked), weeklyPath);
    console.log(`  🔄 pool 순환: [${nextIdx + 1}/${files.length}] ${picked}`);
  } catch (err) {
    console.warn('  ⚠️  pool 순환 실패, 기존 유지:', err.message);
  }

  if (!fs.existsSync(weeklyPath)) {
    return res.status(404).json({ error: 'books/weekly.json 파일 없음' });
  }

  clearCache();

  try {
    const data = await getCurationData(weeklyPath);
    res.json({ ...data, _source: 'pool' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/history ───────────────────────────────
   pool/ 의 큐레이션 목록 반환 (최신순)
────────────────────────────────────────────────── */
app.get('/api/history', (req, res) => {
  const poolDir = path.join(__dirname, 'books', 'pool');
  if (!fs.existsSync(poolDir)) return res.json({ items: [] });

  try {
    const items = fs.readdirSync(poolDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(poolDir, f), 'utf-8'));
          return {
            filename:    f,
            vol:         data.vol         || '',
            publishDate: data.publishDate || '',
            concept:     data.concept     || {},
            bookCount:   Object.values(data.sections || {}).reduce((s, sec) => s + (sec.books?.length || 0), 0),
          };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => {
        // vol 번호 내림차순 (최신 먼저)
        const na = parseInt((a.vol.match(/Vol\.(\d+)/i) || [])[1] || '0', 10);
        const nb = parseInt((b.vol.match(/Vol\.(\d+)/i) || [])[1] || '0', 10);
        return nb - na;
      });

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/pool/:filename ─────────────────────────
   특정 pool 파일의 큐레이션 데이터 반환 (표지 enrichment 포함)
────────────────────────────────────────────────── */
app.get('/api/pool/:filename', async (req, res) => {
  const filename = req.params.filename.replace(/[^a-zA-Z0-9\-_.]/g, ''); // 경로 탈출 방지
  if (!filename.endsWith('.json')) return res.status(400).json({ error: '잘못된 파일명' });

  const filePath = path.join(__dirname, 'books', 'pool', filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '파일 없음' });

  try {
    const data = await getCurationData(filePath);
    res.json({ ...data, _source: 'history' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/book-cover ─────────────────────────── */
app.get('/api/book-cover', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'query 파라미터 필요' });
  try {
    const result = await searchBook(query);
    res.json(result ?? { error: '검색 결과 없음' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/libcode ────────────────────────────── */
app.get('/api/libcode', async (_req, res) => {
  try {
    const libs = await findShintreeLibCode();
    res.json({ libs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/availability ──────────────────────── */
app.get('/api/availability', async (req, res) => {
  const { isbn13, libCode } = req.query;
  if (!isbn13) return res.status(400).json({ error: 'isbn13 파라미터 필요' });
  try {
    const result = await checkBookAvailability(isbn13, libCode);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/generate-header-image ────────────────
   DALL-E 3으로 헤더 이미지 생성
   body: { concept: { emoji, title, description }, cacheKey: string }
   → { imageUrl: "/generated/xxx.png" }
────────────────────────────────────────────────── */
app.post('/api/generate-header-image', async (req, res) => {
  const { concept, cacheKey } = req.body;
  if (!concept || !concept.title) {
    return res.status(400).json({ error: 'concept (title 포함) 파라미터 필요' });
  }
  try {
    const publicDir  = path.join(__dirname, 'public');
    const imageUrl   = await generateHeaderImage(concept, cacheKey || 'header', publicDir);

    // 큐레이션 캐시에 headerImageUrl 저장 (다음 로드에 자동 포함)
    const cacheFile = path.join(__dirname, 'output', 'curation-cache.json');
    if (fs.existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        if (!cached.headerImageUrl) {
          cached.headerImageUrl = imageUrl;
          fs.writeFileSync(cacheFile, JSON.stringify(cached, null, 2), 'utf-8');
        }
      } catch { /* 캐시 업데이트 실패는 무시 */ }
    }

    res.json({ imageUrl });
  } catch (err) {
    console.error('헤더 이미지 생성 오류:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/generate ─────────────────────────────
   정적 HTML 파일 생성 (레거시 / 인쇄용 백업)
────────────────────────────────────────────────── */
app.post('/api/generate', async (_req, res) => {
  const weeklyPath = path.join(__dirname, 'books/weekly.json');
  if (!fs.existsSync(weeklyPath)) {
    return res.status(404).json({ error: 'books/weekly.json 파일 없음' });
  }
  try {
    const outputPath = await generateCuration(weeklyPath);
    const filename   = path.basename(outputPath);
    res.json({ success: true, file: filename, url: `/output/${filename}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── SPA 폴백 ────────────────────────────────────────
   /api/* 이외의 모든 GET 요청 → index.html 반환 (PWA 딥링크 지원)
   Express 5 호환: app.use() 미들웨어 방식 사용
────────────────────────────────────────────────── */
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/output/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ── 서버 시작 ──────────────────────────────────────── */
app.listen(PORT, () => {
  const poolCount = (() => {
    try { return require('fs').readdirSync(require('path').join(__dirname,'books','pool')).filter(f=>f.endsWith('.json')).length; } catch { return 0; }
  })();
  console.log(`\n🌿 신트리 큐레이션 서버 시작`);
  console.log(`   http://localhost:${PORT}  ← PWA 앱`);
  console.log(`   큐레이션 pool: ${poolCount}개 저장됨`);
  console.log(`   📚 새로고침 버튼 → 네이버 베스트셀러로 자동 큐레이션 생성`);
  console.log(`\n   GET  /api/curation        → 큐레이션 JSON`);
  console.log(`   POST /api/refresh          → 네이버 자동생성 → pool 폴백`);
  console.log(`   POST /api/generate         → 정적 HTML 생성`);
  console.log(`   GET  /api/book-cover?query= → 네이버 표지 검색`);
  console.log(`   GET  /api/availability?isbn13= → 대출 가능 여부`);
  console.log(`   GET  /health               → 헬스 체크\n`);
});
