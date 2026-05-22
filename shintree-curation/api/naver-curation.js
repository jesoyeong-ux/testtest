/* ─────────────────────────────────────────────────
   신트리 큐레이션 — 네이버 책 API + OpenAI Q&A 생성
   네이버 베스트셀러 기반 책 목록 + OpenAI로 책별
   트렌드·줄거리 기반 Q&A를 실시간 생성합니다.
───────────────────────────────────────────────── */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { enrichBooksWithDescQA } = require('./desc-qa');

const CLIENT_ID     = process.env.NAVER_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

/* ── 큐레이션 컨셉 풀 (vol 번호로 순환 — 매번 다른 테마) ── */
const CONCEPT_POOL = [
  { emoji: '💌', title: '누군가에게 건네고 싶은 책',     desc: '읽고 나서 "이 사람한테 권해야지" 싶었던 책들이에요.\n마음을 전하고 싶을 때 골라보세요.' },
  { emoji: '🌙', title: '조용한 밤에 펼치는 책',         desc: '하루가 끝난 밤, 이 책 한 권이면 충분해요.\n잠들기 전 30분이 달라질 거예요.' },
  { emoji: '☕', title: '커피 한 잔과 함께 읽는 책',     desc: '카페 한 켠에서 읽기 좋은 책들을 골랐어요.\n시간이 느리게 흐르는 오후를 만들어줄 거예요.' },
  { emoji: '🔥', title: '요즘 가장 뜨거운 책',           desc: '지금 이 순간 가장 많이 읽히는 책들이에요.\n왜 이 책인지, 직접 읽어보면 알 수 있어요.' },
  { emoji: '🌊', title: '단숨에 읽히는 몰입의 책',       desc: '펼치면 멈출 수가 없어요.\n주말 오후, 이 책과 함께 사라져보세요.' },
  { emoji: '✨', title: '읽고 나서 달라진 사람들의 책',  desc: '독자들이 "인생 책"이라 부르는 책들이에요.\n지금이 만날 때인지도 몰라요.' },
  { emoji: '🧘', title: '마음이 복잡할 때 펼치는 책',    desc: '생각이 많아질수록 책이 필요해요.\n읽다 보면 어느새 마음이 정리돼요.' },
  { emoji: '🚀', title: '새로운 시각을 열어주는 책',     desc: '같은 세상을 다르게 보게 해주는 책들이에요.\n읽기 전과 후가 달라지는 일곱 권이에요.' },
  { emoji: '🏡', title: '집에서 혼자 읽기 좋은 책',      desc: '나만의 시간에 어울리는 책들이에요.\n혼자만의 독서가 더 깊어지는 일곱 권이에요.' },
  { emoji: '💪', title: '나를 단단하게 만드는 책',        desc: '읽을수록 마음 근육이 생기는 책들이에요.\n흔들릴 때 잡아주는 이야기들이에요.' },
  { emoji: '🎭', title: '이야기 속으로 완전히 빠지는 책', desc: '현실을 잊게 해주는 이야기들이에요.\n책 덮고 나서도 그 세계에 한동안 머무르게 돼요.' },
  { emoji: '🌱', title: '천천히 자라게 해주는 책',        desc: '급하지 않아도 괜찮아요.\n조금씩 스며드는 책들을 골랐어요.' },
  { emoji: '🗺️', title: '세상을 더 넓게 보게 해주는 책', desc: '내가 모르던 세계가 책 속에 있어요.\n읽을수록 시야가 넓어지는 일곱 권이에요.' },
  { emoji: '💬', title: '읽고 나서 이야기하고 싶은 책',  desc: '누군가와 함께 이야기 나누고 싶어지는 책들이에요.\n북클럽이 없어도 괜찮아요.' },
  { emoji: '⏰', title: '지금 이 순간에 필요한 책',       desc: '타이밍이 있는 책들이 있어요.\n지금 이 순간의 당신에게 딱 맞는 책들이에요.' },
  { emoji: '🎁', title: '생각지 못한 선물 같은 책',       desc: '기대하지 않았는데 마음을 얻어버리는 책들이에요.\n우연히 만난 인연처럼, 이 책들도 그래요.' },
  { emoji: '🌅', title: '새로운 시작을 앞둔 사람에게',   desc: '무언가 달라지고 싶을 때 만나는 책들이에요.\n시작은 언제나 지금이 적당해요.' },
  { emoji: '🎧', title: '깊이 집중해서 읽는 책',          desc: '이어폰 빼고, 화면 내려놓고 읽어보세요.\n온전히 몰입하게 만드는 책들이에요.' },
];

/* ── 섹션별 검색 키워드 풀 ──────────────────────── */
const SECTION_QUERIES = {
  essay:   ['에세이', '산문', '에세이집', '일상에세이', '감성에세이'],
  novel:   ['소설', '한국소설', '소설집', '장편소설', '단편소설'],
  selfdev: ['자기계발', '경제경영', '인문교양', '성공습관', '처세술'],
  bonus:   ['베스트셀러', '신간도서', '화제의책', '스테디셀러', '올해의책'],
};

/* ── 섹션별 Q&A 풀 (책 제목 해시로 선택 → 책마다 다른 Q&A) ── */
const QA_POOL = {
  essay: [
    [
      { q: '에세이 처음인데 이 책이 입문서로 좋을까요?',
        a: '에세이 첫 책으로 정말 잘 고르셨어요. 짧고 담백한 글들이라 책이 무거운 분들도 쉽게 읽혀요. 읽다 보면 "다음 에세이도 읽어봐야겠다" 싶어질 거예요 📖' },
      { q: '일상이 무료할 때 읽으면 도움이 될까요?',
        a: '오히려 그럴 때 읽으면 더 와닿아요. 공감 가는 문장 하나가 툭 하고 마음에 박히는 책이거든요. 그게 에세이의 힘이에요 🌿' },
    ],
    [
      { q: '어떤 분에게 이 책을 권하고 싶으세요?',
        a: '지쳐있거나 혼자라는 느낌이 드는 분들에게 권하고 싶어요. 거창한 위로가 아니라, 작은 문장 하나가 조용히 손 내밀어주는 책이거든요 ✨' },
      { q: '바쁜 직장인도 읽기 좋을까요?',
        a: '챕터가 짧아서 출퇴근 시간에 한 편씩 읽기 딱 좋아요. 오히려 짧게 끊어 읽으면 여운이 더 길게 남아요 ☕' },
    ],
    [
      { q: '다 읽는 데 얼마나 걸려요?',
        a: '빠르면 하루, 천천히 읽어도 사흘이면 충분해요. 근데 사실 천천히 읽는 게 더 좋아요. 좋은 문장은 밑줄 긋고 다시 읽고 싶어지거든요 ☕' },
      { q: '읽고 나서 어떤 감정이 남아요?',
        a: '묘하게 위로받는 기분이에요. 누군가 내 마음을 대신 글로 써준 것 같은 느낌. 읽고 나서 한동안 그 여운이 남는 책이에요 🌿' },
    ],
    [
      { q: '생일 선물로 줘도 좋을까요?',
        a: '이보다 더 좋은 선물은 없어요. 취향 모르는 사람에게도, 책 좋아하는 친구에게도 모두 잘 맞는 책이거든요. 짧은 메모 한 줄 끼워서 주면 더 특별해져요 🎁' },
      { q: '한 번 읽고 끝나는 책인가요?',
        a: '몇 달 뒤에 다시 펼쳐보면 또 다른 문장이 눈에 들어와요. 내가 그사이 조금 달라졌기 때문이에요. 서가에 계속 꽂아두고 싶은 책이에요 📚' },
    ],
    [
      { q: '어디서 읽으면 제일 좋을까요?',
        a: '카페 창가도 좋고, 이불 속도 좋아요. 어디서 읽든 그 공간이 좀 더 포근해지는 책이거든요. 챕터가 짧아서 이동 중에도 딱이에요 🌤️' },
      { q: '이 작가 다른 책도 있나요?',
        a: '이 책으로 처음 만났다면 운이 좋으신 거예요. 이 작가 특유의 담백하고 솔직한 문체가 이 책에 잘 담겨 있어요. 다른 작품도 찾아보고 싶어지실 거예요 ✍️' },
    ],
    [
      { q: '어떤 분에게는 안 맞을 수도 있나요?',
        a: '강한 스토리나 정보를 원하는 분에겐 약간 심심할 수 있어요. 하지만 일상의 작은 것에서 의미를 찾는 글을 좋아한다면 딱이에요 🎯' },
      { q: '읽고 나서 일상이 달라지는 게 있나요?',
        a: '무심코 지나쳤던 순간들이 다르게 보여요. 이 책이 그런 힘을 가지고 있어요. 일상을 바라보는 눈이 조금 달라지는 책이에요 👁️' },
    ],
    [
      { q: '글이 좀 무거운 편인가요, 가벼운 편인가요?',
        a: '전반적으로 가볍게 읽히는데, 어느 페이지에서 갑자기 마음이 뭉클해지기도 해요. 그 균형이 이 책의 매력이에요 💙' },
      { q: '혼자 읽기 좋은 책인가요, 같이 읽기 좋은 책인가요?',
        a: '혼자 읽으면 내면으로 깊어지고, 같이 읽으면 서로를 더 잘 알게 되는 책이에요. 두 가지 모두 좋아요 🫂' },
    ],
    [
      { q: '요즘 이런 에세이가 많은데 이 책은 뭐가 다른가요?',
        a: '다른 책들이 위로를 건네는 방식이라면, 이 책은 그냥 옆에 앉아있어 주는 느낌이에요. 말이 없어도 괜찮은 그런 책이거든요 🌙' },
      { q: '추천 연령대가 있나요?',
        a: '20대부터 50대까지 모두 즐겨 읽는 책이에요. 나이에 따라 와닿는 문장이 달라지는 게 이 책의 특징이에요 ✨' },
    ],
    [
      { q: '에세이인데 줄거리가 있나요?',
        a: '줄거리보다는 감각이 있는 책이에요. 하나의 이야기가 아니라, 일상의 여러 순간들이 모여 있어요. 읽다 보면 내 이야기 같아서 놀랄 거예요 📖' },
      { q: '이 책을 읽기 가장 좋은 계절이 있나요?',
        a: '어느 계절에 읽어도 다 좋아요. 근데 유독 비 오는 날이나 서늘한 저녁에 펼치면 더 잘 맞는 책이에요 🌧️' },
    ],
    [
      { q: '공감 가는 내용이 많은 편인가요?',
        a: '"어, 나도 이런 생각 했는데"라는 순간이 계속 찾아와요. 그 공감들이 쌓이다 보면 어느새 다 읽혀 있을 거예요 💬' },
      { q: '밑줄 많이 긋게 되는 책인가요?',
        a: '빌려 읽으면 조금 아쉬울 수 있어요. 내 책에 밑줄 긋고 싶어지는 문장들이 많거든요. 소장하면 더 좋은 책이에요 📝' },
    ],
  ],
  novel: [
    [
      { q: '책이 두꺼운 편인가요?',
        a: '막상 읽기 시작하면 얼마나 읽었는지도 잊어버려요. 이야기에 끌려 페이지가 후루룩 넘어가는 소설이거든요. 두껍다는 생각보다 "벌써 다 읽었네"가 먼저 나와요 📖' },
      { q: '소설 오랜만인데 부담스럽지 않을까요?',
        a: '처음 몇 페이지만 넘기면 자연스럽게 빠져들어요. 오히려 오랜만에 소설 읽기 시작하기 딱 좋은 책이에요. 다시 소설이 좋아지게 만드는 힘이 있거든요 🌙' },
    ],
    [
      { q: '주인공이 어떤 사람인가요?',
        a: '한 마디로 정의하기 어려운 인물이에요. 읽으면서 "나랑 비슷한 것 같기도 하고" 싶다가도 전혀 다르기도 해요. 그래서 오히려 더 기억에 남아요 🎭' },
      { q: '어떤 독자에게 이 소설을 권하고 싶으세요?',
        a: '오랫동안 소설을 멀리했던 분에게 권하고 싶어요. 다시 소설이 좋아지게 만들어주는 힘이 있는 책이거든요. 소설 입문자에게도 딱이에요 🌟' },
    ],
    [
      { q: '많이 슬픈 소설인가요?',
        a: '마음이 먹먹해지는 순간이 있어요. 하지만 그게 이 소설의 핵심이에요. 울고 나서 오히려 후련한, 그런 좋은 슬픔이에요 🌙' },
      { q: '결말이 만족스러운 편인가요?',
        a: '좋은 소설의 결말이란 게 꼭 해피엔딩일 필요는 없잖아요. 마지막 페이지를 덮고 나서 한동안 멍하게 있게 만드는, 그런 결말이에요 ✨' },
    ],
    [
      { q: '줄거리를 조금만 소개해줄 수 있나요?',
        a: '핵심만 말하면: 우리가 살면서 한 번쯤은 맞닥뜨리는 그 순간에 관한 이야기예요. 더 말하면 스포일러라서요 — 첫 챕터만 읽어보세요. 그러면 멈출 수 없을 거예요 😊' },
      { q: '하루 만에 읽을 수 있나요?',
        a: '마음먹으면 가능해요. 중간에 덮기가 어려운 소설이거든요. 다만 천천히 음미하면서 읽는 게 훨씬 좋아요. 서두르면 놓치는 것들이 있어요 🕯️' },
    ],
    [
      { q: '드라마나 영화로도 나왔나요?',
        a: '원작 소설이 훨씬 풍부해요. 이야기 속 인물들의 내면이 책에서 훨씬 더 잘 전달되거든요. 책으로 먼저 만나보시길 추천해요 🎬' },
      { q: '밤에 혼자 읽기 좋은 책인가요?',
        a: '딱 그런 책이에요. 조용한 밤, 불 하나 켜놓고 읽으면 더 좋은 소설이에요 🕯️' },
    ],
    [
      { q: '이 소설 많이 알려진 편인가요?',
        a: '소설을 좋아하는 분들 사이에서는 꽤 알려진 책이에요. 입소문으로 알게 된 독자가 많아요. 발견하는 기쁨이 있는 소설이랄까요 💫' },
      { q: '읽고 나서 무거운 기분이 남지 않나요?',
        a: '무게감은 있어요. 하지만 그 무게가 나쁜 쪽이 아니에요. 뭔가 생각하게 만드는 이야기들이 좋은 소설 아닌가요? 오래 기억되는 소설이에요 📚' },
    ],
    [
      { q: '장르가 어떻게 되나요?',
        a: '한 장르로 딱 잘라 말하기 어려운 소설이에요. 읽는 내내 장르보다는 사람에 집중하게 돼요. 인물이 살아있는 소설이라 기억에 오래 남아요 🎭' },
      { q: '10대도 읽을 수 있는 책인가요?',
        a: '나이에 따라 다르게 읽히는 소설이에요. 20대엔 설레고, 30대엔 공감하고, 40대엔 또 다르게 와닿는다는 독자 후기가 많아요 ✨' },
    ],
    [
      { q: '같은 작가 다른 책도 읽어봐야 할까요?',
        a: '이 책이 마음에 들었다면 꼭 읽어보세요. 작가가 일관되게 좋아하는 주제와 문체가 있거든요. 팬이 되는 건 시간문제예요 📖' },
      { q: '두 번 읽어볼 만한 소설인가요?',
        a: '두 번째 읽으면 처음에 놓쳤던 것들이 보여요. 작가가 숨겨놓은 것들이 있거든요. 다시 읽고 싶어지는 소설이에요 🔍' },
    ],
    [
      { q: '이 소설의 배경이 어디인가요?',
        a: '배경보다는 인물과 감정이 훨씬 강한 소설이에요. 어디가 배경이든 상관없이 내 이야기처럼 느껴지게 만드는 힘이 있어요 🌍' },
      { q: '긴 소설은 중간에 지루해지지 않나요?',
        a: '이 소설은 중간이 가장 재미있어요. 시작이 좀 느리게 느껴질 수 있지만, 한번 빠지면 멈출 수가 없어요 🌊' },
    ],
    [
      { q: '혼자보다 누군가와 같이 읽으면 어떨까요?',
        a: '읽고 나서 이야기 나누기 딱 좋은 소설이에요. "넌 이 장면에서 어떻게 생각했어?" 하는 대화가 자연스럽게 생겨요. 북클럽 교재로도 훌륭해요 💬' },
      { q: '첫 장부터 바로 빠져드나요?',
        a: '첫 페이지부터 뭔가 다른 소설이에요. 첫 문장이 좋은 소설은 대부분 끝까지 좋더라고요 ✨' },
    ],
  ],
  selfdev: [
    [
      { q: '읽고 나서 실제로 적용해볼 수 있는 내용인가요?',
        a: '챕터마다 바로 써먹을 수 있는 내용이 담겨 있어요. "이건 내일 당장 해봐야지" 싶은 게 계속 나와요. 밑줄 많이 긋게 되는 책이에요 💡' },
      { q: '자기계발서 많이 읽었는데 이 책은 뭐가 다른가요?',
        a: '뻔한 성공 공식이 아니에요. 보통 사람이 실제로 경험한 이야기에서 출발해요. 읽다 보면 "이건 나도 할 수 있겠다"는 확신이 생겨요 🔥' },
    ],
    [
      { q: '이론이 많은 책인가요, 실용적인 책인가요?',
        a: '이론은 30%, 실제 사례와 방법이 70%예요. 읽다 보면 "아, 이래서 나는 안 됐었구나" 싶은 순간이 온다는 독자 후기가 많아요 🎯' },
      { q: '어떤 분에게 특히 추천하고 싶으세요?',
        a: '변화가 필요한데 어디서 시작해야 할지 모르겠는 분들에게 권해요. 거창하지 않아도 되는 출발점을 알려주는 책이거든요 🌱' },
    ],
    [
      { q: '슬럼프를 극복하는 데 도움이 될까요?',
        a: '딱 맞는 책이에요. "나만 힘든 게 아니었구나"에서 시작해서 "이렇게 해볼 수 있겠다"로 이어지는 흐름이에요. 힘든 시기에 읽으면 더 와닿아요 💪' },
      { q: '읽는 데 시간이 오래 걸리나요?',
        a: '바쁜 직장인도 출퇴근 시간 2주면 충분해요. 챕터가 짧아서 끊어 읽기 좋거든요. 오히려 매일 조금씩 읽는 게 실천에도 도움이 돼요 ⏱️' },
    ],
    [
      { q: '회사 동료나 팀원에게 권해도 좋을까요?',
        a: '함께 읽으면 더 좋은 책이에요. 읽고 나서 "우리 팀에 이거 적용해보자"는 대화가 자연스럽게 나올 거예요. 팀 선물로도 훌륭해요 💼' },
      { q: '읽기 전과 후에 달라지는 게 있나요?',
        a: '처음엔 작은 것 같지만, 3개월 뒤에 돌아보면 뭔가 달라져 있을 거예요. 빠른 변화보다 꾸준한 변화를 만들어주는 책이에요 🌿' },
    ],
    [
      { q: '번역서인데 읽기 어렵지 않나요?',
        a: '읽다 보면 번역서라는 게 잊혀요. 문장이 자연스럽게 흘러요. 외국 사례가 나와도 한국 상황에 쉽게 대입할 수 있게 설명돼 있어요 📖' },
      { q: '자기계발서를 별로 안 좋아하는데 이 책은 어떨까요?',
        a: '사실 저도 처음엔 그랬어요. 근데 이 책은 달라요. 뻔한 성공 공식이 아니라, 보통 사람의 보통 이야기거든요. 한 챕터만 읽어보세요 😊' },
    ],
    [
      { q: '이 책에서 가장 기억에 남는 내용이 있다면요?',
        a: '작은 습관 하나가 어떻게 인생을 바꾸는지를 구체적인 사례로 보여줘요. "이건 나도 할 수 있겠다"는 확신을 주는 책이에요 ✨' },
      { q: '몇 번이고 다시 읽을 만한 책인가요?',
        a: '네, 상황에 따라 다르게 읽혀요. 취직할 때, 힘들 때, 새로운 시작 앞에서 꺼내볼 때마다 다른 챕터가 눈에 들어오는 책이에요 🔄' },
    ],
    [
      { q: '이 책 한 권이면 충분한가요, 다른 책도 함께 읽으면 좋을까요?',
        a: '이 책 한 권만으로 충분해요. 읽고 나서 실천하는 시간이 필요하거든요. 다 소화하면 그때 다음 책을 찾아도 늦지 않아요 📚' },
      { q: '성공한 사람들의 이야기만 나오는 건 아닌가요?',
        a: '실패 이야기도 많이 나와요. 오히려 그게 더 공감 가요. "나도 이런 적 있었는데"라는 생각이 드는 사례들이 담겨 있어요 🌱' },
    ],
    [
      { q: '꼭 처음부터 순서대로 읽어야 하나요?',
        a: '어디서 펼쳐도 읽히는 구조예요. 목차 보고 지금 필요한 챕터부터 읽어도 괜찮아요. 근데 처음부터 읽으면 흐름이 더 잘 이해돼요 📋' },
      { q: '어떤 사람에게는 이 책이 안 맞을 수도 있나요?',
        a: '이미 모든 걸 알고 있다고 생각하는 분들에겐 아쉬울 수 있어요. 열린 마음으로 읽으면 분명히 건질 것들이 있어요 🎯' },
    ],
    [
      { q: '이 책이 베스트셀러인 이유가 있나요?',
        a: '읽어보면 알아요. 왜 이렇게 많은 사람이 이 책에 공감하는지. 시대를 잘 읽은 책이에요. 지금 이 순간에 딱 필요한 이야기거든요 🔥' },
      { q: '읽고 나서 메모하거나 정리하고 싶어지나요?',
        a: '그런 책이에요. 책 읽으면서 노트 펼치고 싶어지는 분들에게 특히 잘 맞아요. 읽는 것 자체로도 좋지만, 적으면서 읽으면 두 배로 좋아요 📝' },
    ],
    [
      { q: '20대에게도 도움이 되는 책인가요?',
        a: '20대에 읽으면 10년을 앞서가는 느낌이에요. 저자가 수십 년간 깨달은 것들이 담겨 있거든요. 빨리 읽을수록 좋은 책이에요 🚀' },
      { q: '이 책을 읽고 실제로 변한 사람들이 있나요?',
        a: '독자 후기에 "이 책 읽고 회사를 그만뒀어요", "이 책 때문에 새로운 프로젝트를 시작했어요" 같은 이야기가 진짜 많아요. 그 정도로 영향력이 있는 책이에요 ✨' },
    ],
  ],
  bonus: [
    [
      { q: '이미 유명한 책인데 지금 읽어도 늦지 않나요?',
        a: '오히려 지금이 딱이에요. 어느 정도 알고 읽으면 더 많은 게 보이거든요. 스테디셀러에는 다 이유가 있어요 📚' },
      { q: '어떤 분위기의 책인가요?',
        a: '읽고 나서 마음이 따뜻해지는 책이에요. 곁에 두고 가끔 꺼내 읽고 싶어지는 책이랄까요 💙' },
    ],
    [
      { q: '제목은 들어봤는데 내용이 궁금해요.',
        a: '제목보다 내용이 훨씬 좋은 책이에요. 기대 이상으로 마음에 남는 이야기거든요. 지금이 처음 만날 최적의 타이밍이에요 ✨' },
      { q: '한 번에 다 읽을 수 있나요?',
        a: '술술 읽혀요. 주말 오후 한나절이면 충분해요. 읽고 나서 여운이 오래 남는 책이에요 🌊' },
    ],
    [
      { q: '이번 주 꼭 읽어야 할 이유가 있을까요?',
        a: '딱 지금 읽어야 하는 책이 있어요. 타이밍이라는 게 중요하더라고요. 읽고 나서 "왜 이제야 읽었지" 싶어질 거예요 🔥' },
      { q: '읽기 시작하면 금방 빠져드나요?',
        a: '첫 페이지부터 뭔가 다른 책이에요. 처음 몇 쪽만 읽으면 멈추기 어려워요. 주말에 읽기 시작했다가 하루 만에 다 읽었다는 후기가 많아요 🌊' },
    ],
    [
      { q: '한 번 읽고 서가에 꽂아둘 책인가요, 다시 꺼내볼 책인가요?',
        a: '다시 꺼내보게 되는 책이에요. 처음 읽을 때와 두 번째 읽을 때가 달라요. 내가 달라지면 책도 달라 보이거든요 📖' },
      { q: '표지만 보고 골라도 될까요?',
        a: '내용도 표지만큼 좋아요. 믿고 읽어보세요. 후회하지 않을 거예요 🎁' },
    ],
    [
      { q: '요즘 왜 이 책이 화제인가요?',
        a: '읽어보면 알아요. 왜 지금 이 순간 이 책인지. 시대가 필요로 하는 이야기가 담겨 있어요. 직접 읽어보시면 느껴질 거예요 💫' },
      { q: '어떤 분에게 이 책을 강력 추천하고 싶으세요?',
        a: '새로운 시작을 앞둔 분들에게 권하고 싶어요. 읽고 나서 용기 같은 게 생기거든요. 설명하기 어렵지만, 읽으면 알게 돼요 ✨' },
    ],
    [
      { q: '이 책이 요즘 베스트셀러인 이유가 뭔가요?',
        a: '지금 이 시대의 사람들이 필요로 하는 이야기를 하고 있어요. 혼자만 읽기 아깝고 주변에 권하고 싶어지는 책이거든요. 그게 입소문의 힘이에요 🔥' },
      { q: '읽고 나서 삶이 달라질 수 있을까요?',
        a: '장담할 순 없지만, 읽기 전과 후가 분명히 달라요. 작은 것 하나라도 바뀌게 만드는 책이에요. 그게 좋은 책의 증거 아닐까요 🌱' },
    ],
  ],
};

/* ── 유틸 함수들 ─────────────────────────────────── */

/** Naver 책 검색 (장르별, 여러 결과) */
function naverBookSearch(query, display = 15, sort = 'sim') {
  return new Promise((resolve, reject) => {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return reject(new Error('네이버 API 키가 설정되지 않았습니다.'));
    }
    const options = {
      hostname: 'openapi.naver.com',
      path: `/v1/search/book.json?query=${encodeURIComponent(query)}&display=${display}&sort=${sort}`,
      method: 'GET',
      headers: {
        'X-Naver-Client-Id': CLIENT_ID,
        'X-Naver-Client-Secret': CLIENT_SECRET,
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`네이버 API HTTP ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(data).items || []);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('타임아웃')); });
    req.end();
  });
}

/** Naver isbn 필드 → ISBN-13 추출 */
function extractIsbn13(isbn) {
  if (!isbn) return '';
  // Naver는 "9791234567890 9781234567" 형태로 줄 수 있음
  const parts = String(isbn).trim().split(/\s+/);
  for (const p of parts) {
    const d = p.replace(/\D/g, '');
    if (d.length === 13 && (d.startsWith('978') || d.startsWith('979'))) return d;
  }
  return parts[0]?.replace(/\D/g, '') || '';
}

/** HTML 태그 제거 */
function stripHtml(str) {
  return (str || '').replace(/<[^>]+>/g, '').trim();
}

/** 책 설명 → 훅 문장 */
function toHookSentence(description, title) {
  const clean = stripHtml(description);
  if (!clean) return `${stripHtml(title)}, 지금 신트리에서 만나보세요.`;
  // 첫 문장 추출
  const first = clean.split(/[.!?。]\s+/)[0].replace(/["""'']/g, '').trim();
  if (first.length >= 10 && first.length <= 50) return first + '.';
  if (first.length > 50) return first.slice(0, 48) + '...';
  // 첫 문장이 너무 짧으면 앞 50자
  return clean.slice(0, 50).trim() + '...';
}

/** 책 제목 해시 → 같은 책은 항상 같은 Q&A, 다른 책은 다른 Q&A */
function titleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Q&A 선택: 책 제목 해시 + vol 오프셋으로 다양화 */
function pickQA(sectionKey, title, volOffset = 0) {
  const pool = QA_POOL[sectionKey] || QA_POOL.bonus;
  return pool[(titleHash(title || '') + volOffset) % pool.length];
}

/** 네이버 마케팅 부제 제거: "소란한 고요 (일상 에세이)" → "소란한 고요" */
function cleanTitle(title) {
  return stripHtml(title)
    .replace(/\s*\([^)]{4,40}\)\s*$/, '')   // 끝의 "(긴 부연)" 제거
    .replace(/\s*\[[^\]]{4,40}\]\s*$/, '')   // 끝의 "[긴 부연]" 제거
    .trim();
}

/** 태그 풀 (책 제목 해시로 선택 → 책마다 다른 조합) */
const SECTION_TAGS = {
  essay:   [
    ['#에세이', '#공감', '#일상'],       ['#에세이', '#감성', '#위로'],
    ['#에세이', '#산문', '#읽기좋은책'], ['#에세이', '#담백한글', '#마음'],
    ['#에세이', '#혼자읽기', '#사색'],   ['#에세이', '#선물추천', '#따뜻함'],
  ],
  novel:   [
    ['#소설', '#스토리', '#몰입'],         ['#소설', '#한국소설', '#감동'],
    ['#소설', '#이야기', '#인물'],         ['#소설', '#밤독서', '#추천'],
    ['#소설', '#다시읽고싶은책', '#여운'], ['#소설', '#장편소설', '#빠져드는'],
  ],
  selfdev: [
    ['#자기계발', '#성장', '#동기부여'], ['#자기계발', '#습관', '#변화'],
    ['#자기계발', '#목표', '#실천'],     ['#자기계발', '#직장인추천', '#인사이트'],
    ['#자기계발', '#마인드셋', '#도전'], ['#자기계발', '#생산성', '#루틴'],
  ],
  bonus:   [
    ['#화제작', '#베스트셀러', '#추천도서'], ['#이달의책', '#주목작', '#읽어봤나요'],
    ['#스테디셀러', '#명작', '#필독서'],     ['#요즘책', '#트렌드', '#화제'],
  ],
};
function pickTags(sectionKey, title) {
  const pool = SECTION_TAGS[sectionKey] || SECTION_TAGS.bonus;
  return pool[titleHash(title || '') % pool.length];
}

/** pool/ 에서 최근 N개 큐레이션의 ISBN 수집 (중복 방지) */
function getRecentPoolISBNs(poolDir, recent = 5) {
  const isbns = new Set();
  if (!fs.existsSync(poolDir)) return isbns;
  try {
    const files = fs.readdirSync(poolDir)
      .filter(f => f.endsWith('.json'))
      .map(f => ({ f, mtime: fs.statSync(path.join(poolDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)   // 최신순
      .slice(0, recent)
      .map(o => o.f);

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

/** pool/ 에서 다음 vol 번호 계산 */
function getNextVolNumber(poolDir) {
  if (!fs.existsSync(poolDir)) return 3;
  try {
    const files = fs.readdirSync(poolDir).filter(f => f.endsWith('.json'));
    let max = 0;
    for (const f of files) {
      try {
        const v = JSON.parse(fs.readFileSync(path.join(poolDir, f), 'utf-8')).vol || '';
        const n = parseInt(v.match(/Vol\.(\d+)/i)?.[1] || '0', 10);
        if (n > max) max = n;
      } catch { /* skip */ }
    }
    return max + 1;
  } catch { return 3; }
}

/* ── 섹션별 책 2권 수집 ──────────────────────────── */
async function fetchBooksForSection(sectionKey, count, excludeISBNs, queryIdx = 0, qaOffset = 0) {
  const queries = SECTION_QUERIES[sectionKey];
  const books   = [];
  let   tried   = 0;

  while (books.length < count && tried < queries.length) {
    const query = queries[(queryIdx + tried) % queries.length];
    try {
      const items = await naverBookSearch(query, 20, 'sim');
      for (const item of items) {
        if (books.length >= count) break;
        const isbn13 = extractIsbn13(item.isbn);
        if (!isbn13 || excludeISBNs.has(isbn13)) continue;
        // 이미 이번 생성에서 추가된 ISBN 중복 방지
        if (books.some(b => b.isbn13 === isbn13)) continue;
        // 제목 앞 10글자 기준 동일 책(다른 판본) 중복 방지 (cleanTitle 적용)
        const titleKey = cleanTitle(item.title).replace(/\s+/g, '').slice(0, 10);
        if (books.some(b => b.title.replace(/\s+/g, '').slice(0, 10) === titleKey)) continue;

        excludeISBNs.add(isbn13);  // 이번 큐레이션 내 중복 방지
        const cleanedTitle = cleanTitle(item.title);
        books.push({
          title:            cleanedTitle,
          author:           stripHtml(item.author).replace(/\^/g, ', '),
          isbn13,
          hookSentence:     toHookSentence(item.description, cleanedTitle),
          qa:               pickQA(sectionKey, cleanedTitle, qaOffset),  // AI 실패 시 fallback
          tags:             pickTags(sectionKey, cleanedTitle),
          _naverImage:      item.image || null,
          _rawDescription:  stripHtml(item.description),  // AI Q&A 생성용 (저장 전 제거)
        });
      }
    } catch (err) {
      console.warn(`  ⚠️  섹션[${sectionKey}] 검색 실패 (${query}):`, err.message);
    }
    tried++;
    // 요청 간 간격 (네이버 API 레이트 리밋 방지)
    if (tried < queries.length) await new Promise(r => setTimeout(r, 300));
  }

  return books;
}

/* ── 메인: 네이버 기반 큐레이션 생성 ───────────────── */
/**
 * 네이버 책 API로 그날의 베스트셀러를 가져와 큐레이션 생성
 * @param {string} poolDir    books/pool/ 절대 경로
 * @param {string} weeklyPath books/weekly.json 경로
 * @returns {Promise<object>}
 */
async function generateNaverCuration(poolDir, weeklyPath) {
  console.log('\n  📚 네이버 베스트셀러 기반 큐레이션 생성 중...');

  const today     = new Date();
  const month     = today.getMonth() + 1;
  const dateStr   = today.toISOString().split('T')[0];
  const nextVol   = getNextVolNumber(poolDir);
  // vol 번호 + 월 offset으로 매번 다른 컨셉 선택
  const concept   = CONCEPT_POOL[(nextVol + month - 1) % CONCEPT_POOL.length];
  const excluded  = getRecentPoolISBNs(poolDir, 3);  // 최근 3개 큐레이션 ISBN 제외

  console.log(`  📅 ${dateStr} / Vol.${String(nextVol).padStart(2,'0')} 생성 중...`);

  // 섹션별 책 수집 — 네이버 API 레이트 리밋 방지를 위해 순차 실행
  const qi       = nextVol % 5;              // 검색 쿼리 오프셋 (5가지 순환)
  const qaOffset = nextVol % 3;              // Q&A 오프셋 (3가지 변형 순환)
  const delay    = ms => new Promise(r => setTimeout(r, ms));

  const essayBooks   = await fetchBooksForSection('essay',   2, excluded, qi, qaOffset);
  await delay(500);
  const novelBooks   = await fetchBooksForSection('novel',   2, excluded, qi, qaOffset);
  await delay(500);
  const selfdevBooks = await fetchBooksForSection('selfdev', 2, excluded, qi, qaOffset);
  await delay(500);
  const bonusBooks   = await fetchBooksForSection('bonus',   1, excluded, qi, qaOffset);

  // 최소 1권 이상 수집됐는지 확인
  if (!essayBooks.length && !novelBooks.length && !selfdevBooks.length) {
    throw new Error('네이버 API에서 책 정보를 가져오지 못했습니다.');
  }

  // 부족한 섹션 보완 — 빈 배열 guard, 중복 방지
  const fill = (arr, needed) => {
    if (!arr.length) return [];
    while (arr.length < needed) arr.push({ ...arr[arr.length - 1] });
    return arr.slice(0, needed);
  };

  // ── 책 소개 기반 Q&A 생성 (무료, 네이버 description 활용) ──
  console.log('  📝 책 소개 기반 맞춤 Q&A 생성 중...');
  const eWithQA = enrichBooksWithDescQA(fill(essayBooks,   2), 'essay');
  const nWithQA = enrichBooksWithDescQA(fill(novelBooks,   2), 'novel');
  const sWithQA = enrichBooksWithDescQA(fill(selfdevBooks, 2), 'selfdev');
  const bWithQA = enrichBooksWithDescQA(fill(bonusBooks,   1), 'bonus');

  // _rawDescription → description 으로 이름 바꿔 저장 (UI에서 책 소개 표시용)
  const cleanBook = b => {
    const { _rawDescription, ...rest } = b;
    if (_rawDescription) rest.description = _rawDescription;
    return rest;
  };
  const e = eWithQA.map(cleanBook);
  const n = nWithQA.map(cleanBook);
  const s = sWithQA.map(cleanBook);
  const b = bWithQA.map(cleanBook);

  const hashtags = `#신트리도서관 #주간큐레이션 #부평도서관 #책추천 ${concept.emoji === '🍂' ? '#가을독서' : concept.emoji === '❄️' ? '#겨울독서' : concept.emoji === '🌸' ? '#봄독서' : '#독서'}`;

  const curation = {
    vol:         `${today.getFullYear()} · Vol.${String(nextVol).padStart(2,'0')}`,
    publishDate: dateStr,
    concept: {
      emoji:       concept.emoji,
      title:       concept.title,
      description: concept.desc,
    },
    sections: {
      essay:   { label: '✍️ 에세이',          books: e },
      novel:   { label: '📖 소설',             books: n },
      selfdev: { label: '💡 자기계발',         books: s },
      bonus:   { label: '🎁 이번 주 보너스 픽', books: b },
    },
    curatorNote: `${concept.desc.split('\n')[0]} 신트리 사서가 ${dateStr} 기준 베스트셀러에서 엄선했어요.`,
    hashtags,
  };

  // pool/ 저장 (히스토리)
  if (!fs.existsSync(poolDir)) fs.mkdirSync(poolDir, { recursive: true });
  const poolFile = path.join(poolDir, `vol-${String(nextVol).padStart(2,'0')}-${dateStr}.json`);
  fs.writeFileSync(poolFile, JSON.stringify(curation, null, 2), 'utf-8');
  console.log(`  💾 pool 저장: ${path.basename(poolFile)}`);

  // weekly.json 교체
  fs.writeFileSync(weeklyPath, JSON.stringify(curation, null, 2), 'utf-8');
  console.log(`  ✅ 큐레이션 생성 완료: ${curation.vol}`);

  return curation;
}

module.exports = { generateNaverCuration };
