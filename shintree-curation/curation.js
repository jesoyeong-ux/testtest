require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { searchBook } = require('./api/naver');
const { checkBookAvailability } = require('./api/data4lib');

const SHINTREE_SEARCH_BASE =
  'https://lib.ice.go.kr/shintree/intro/search/index.do?menu_idx=285&searchKeyWord=';

// HTML 이스케이프 — XSS 방지
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

const BADGE_CLASS = {
  green: 'badge-green',
  yellow: 'badge-yellow',
  blue: 'badge-blue',
  gray: 'badge-gray',
};

// 개별 검색 URL (신트리 OPAC, 제목만 사용)
function buildSearchUrl(title) {
  return SHINTREE_SEARCH_BASE + encodeURIComponent(title);
}

function renderBook(book, coverUrl, availability) {
  const badge = availability?.badge ?? '🔗 신트리 확인';
  const badgeClass = BADGE_CLASS[availability?.color ?? 'gray'];
  const searchUrl = buildSearchUrl(book.title);

  const safeTitle = escapeHtml(book.title);
  const safeAuthor = escapeHtml(book.author);
  const safeHook = escapeHtml(book.hookSentence);

  const coverHtml = coverUrl
    ? `<img class="book-cover" src="${escapeHtml(coverUrl)}" alt="${safeTitle} 표지" loading="lazy">`
    : `<div class="book-cover-placeholder">📚</div>`;

  const qaHtml = book.qa
    .map(
      ({ q, a }) => `
      <div class="qa-item">
        <div class="qa-q">🙋 &ldquo;${escapeHtml(q)}&rdquo;</div>
        <div class="qa-a">📚 ${escapeHtml(a)}</div>
      </div>`
    )
    .join('');

  const tagsHtml = book.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');

  return `
    <div class="book-card">
      <div class="book-top">
        ${coverHtml}
        <div class="book-meta">
          <span class="book-badge ${badgeClass}">${escapeHtml(badge)}</span>
          <div class="book-title">${safeTitle}</div>
          <div class="book-author">${safeAuthor}</div>
        </div>
      </div>
      <div class="hook-sentence">&ldquo;${safeHook}&rdquo;</div>
      <div class="qa-list">${qaHtml}</div>
      <div class="tag-list">${tagsHtml}</div>
    </div>`;
}

function renderSection(key, label, booksHtml) {
  const isBonus = key === 'bonus';
  const labelHtml = isBonus
    ? `${escapeHtml(label)}<span class="bonus-pill">BONUS</span>`
    : escapeHtml(label);
  return `
    <div class="section-group">
      <div class="section-label">${labelHtml}</div>
      ${booksHtml}
    </div>`;
}

async function enrichBook(book) {
  // naver-curation.js가 이미 가져온 이미지 우선 사용 (불필요한 재호출 방지)
  let coverUrl = book._naverImage || null;

  if (!coverUrl) {
    // 구 pool 파일(vol-01, vol-02) 또는 _naverImage 없는 경우에만 Naver API 호출
    try {
      if (book.isbn13) {
        const byIsbn = await searchBook(book.isbn13);
        if (byIsbn?.image) coverUrl = byIsbn.image;
      }
      if (!coverUrl) {
        const byTitle = await searchBook(book.title);
        if (byTitle?.image) coverUrl = byTitle.image;
      }
    } catch (err) {
      console.warn(`  ⚠️  표지 로딩 실패 [${book.title}]: ${err.message}`);
    }
  }

  // availability는 프런트에서 온디맨드로 /api/availability 호출
  const availability = { badge: '', color: 'gray' };

  return { book, coverUrl, availability };
}

async function generateCuration(weeklyDataPath) {
  const weekly = JSON.parse(fs.readFileSync(weeklyDataPath, 'utf-8'));
  const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf-8');

  console.log(`\n📚 큐레이션 생성 시작: ${weekly.vol}`);
  console.log(`🎯 컨셉: ${weekly.concept.emoji} ${weekly.concept.title}\n`);

  // 전체 도서 데이터 수집 (병렬)
  const sectionKeys = Object.keys(weekly.sections);
  const allBooksFlat = sectionKeys.flatMap((key) => weekly.sections[key].books);

  console.log(`책 정보 수집 중 (총 ${allBooksFlat.length}권)...`);
  const enriched = await Promise.all(allBooksFlat.map(enrichBook));

  // 고유 키: isbn13 있으면 isbn13, 없으면 "title::index" 로 충돌 방지
  const enrichedMap = {};
  enriched.forEach(({ book, coverUrl, availability }, idx) => {
    const key = book.isbn13 || `${book.title}::${idx}`;
    enrichedMap[key] = { coverUrl, availability };
  });

  // 섹션별 HTML 생성 — 전체 flat 인덱스로 동일한 키 계산
  let globalIdx = 0;
  const sectionsHtml = sectionKeys
    .map((key) => {
      const section = weekly.sections[key];
      const booksHtml = section.books
        .map((book) => {
          const mapKey = book.isbn13 || `${book.title}::${globalIdx}`;
          globalIdx++;
          const { coverUrl, availability } = enrichedMap[mapKey];
          return renderBook(book, coverUrl, availability);
        })
        .join('');
      return renderSection(key, section.label, booksHtml);
    })
    .join('');

  // 템플릿 치환 (g 플래그로 전체 치환)
  const html = template
    .replace(/{{VOL}}/g, weekly.vol)
    .replace(/{{CONCEPT_EMOJI}}/g, weekly.concept.emoji)
    .replace(/{{CONCEPT_TITLE}}/g, weekly.concept.title)
    .replace(/{{CONCEPT_DESC}}/g, weekly.concept.description)
    .replace(/{{SECTIONS}}/g, sectionsHtml)
    .replace(/{{CURATOR_NOTE}}/g, weekly.curatorNote)
    .replace(/{{PUBLISH_DATE}}/g, weekly.publishDate)
    .replace(/{{HASHTAGS}}/g, weekly.hashtags);

  // output/ 폴더에 저장
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
  const outputPath = path.join(outputDir, `${weekly.publishDate}.html`);
  fs.writeFileSync(outputPath, html, 'utf-8');

  console.log(`\n✅ 완료! 파일 생성: output/${weekly.publishDate}.html`);
  return outputPath;
}

/**
 * getCurationData — SPA용 JSON 데이터 반환
 * weekly.json + Naver 표지 + 대출 가능 여부를 합쳐 JSON으로 반환.
 * 캐시 파일(output/curation-cache.json)이 동일 주차·vol이면 재사용.
 */
async function getCurationData(weeklyDataPath) {
  const weekly     = JSON.parse(fs.readFileSync(weeklyDataPath, 'utf-8'));
  const outputDir  = path.join(__dirname, 'output');
  const cacheFile  = path.join(outputDir, 'curation-cache.json');

  // 캐시 유효성 검사
  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      if (cached._vol === weekly.vol && cached._publishDate === weekly.publishDate) {
        // 캐시 hit — 헤더 이미지는 파일시스템에서 최신 상태 반영
        const safeKeyC        = (weekly.publishDate || weekly.vol || 'header').replace(/[^a-zA-Z0-9\-_]/g, '_');
        const genImgPathC     = path.join(__dirname, 'public', 'generated', `${safeKeyC}.png`);
        cached.headerImageUrl = fs.existsSync(genImgPathC) ? `/generated/${safeKeyC}.png` : null;
        console.log('  📦 캐시에서 큐레이션 데이터 로드');
        return cached;
      }
    } catch { /* 캐시 손상 → 재생성 */ }
  }

  console.log(`\n📚 큐레이션 JSON 생성: ${weekly.vol}`);

  const sectionKeys  = Object.keys(weekly.sections);
  const allBooksFlat = sectionKeys.flatMap((key) => weekly.sections[key].books);

  console.log(`  책 정보 수집 중 (총 ${allBooksFlat.length}권)...`);
  const enriched = await Promise.all(allBooksFlat.map(enrichBook));

  // enrichedMap 구성 (isbn13 없으면 "title::idx" 키로 충돌 방지)
  const enrichedMap = {};
  enriched.forEach(({ book, coverUrl, availability }, idx) => {
    const key = book.isbn13 || `${book.title}::${idx}`;
    enrichedMap[key] = { coverUrl: coverUrl || null, availability };
  });

  // 섹션에 coverUrl / availability 삽입
  let globalIdx = 0;
  const enrichedSections = {};
  for (const key of sectionKeys) {
    const section = weekly.sections[key];
    enrichedSections[key] = {
      ...section,
      books: section.books.map((book) => {
        const mapKey = book.isbn13 || `${book.title}::${globalIdx}`;
        globalIdx++;
        const { coverUrl, availability } = enrichedMap[mapKey];
        return { ...book, coverUrl, availability };
      }),
    };
  }

  // 이미 생성된 헤더 이미지 감지
  const safeKey          = (weekly.publishDate || weekly.vol || 'header').replace(/[^a-zA-Z0-9\-_]/g, '_');
  const generatedImgPath = path.join(__dirname, 'public', 'generated', `${safeKey}.png`);
  const headerImageUrl   = fs.existsSync(generatedImgPath) ? `/generated/${safeKey}.png` : null;

  const result = {
    ...weekly,
    sections:       enrichedSections,
    headerImageUrl,
    _vol:           weekly.vol,
    _publishDate:   weekly.publishDate,
    _cachedAt:      new Date().toISOString(),
  };

  // 캐시 저장
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
  fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2), 'utf-8');
  console.log('  ✅ 큐레이션 JSON 생성 완료');

  return result;
}

module.exports = { generateCuration, getCurationData };

if (require.main === module) {
  const weeklyPath = path.join(__dirname, 'books/weekly.json');
  generateCuration(weeklyPath).catch((err) => {
    console.error('생성 실패:', err);
    process.exit(1);
  });
}
