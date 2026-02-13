/**
 * 말풍선 메시지 DB (한국어/영어)
 * 모든 메시지는 긍정적, 귀여운 톤 유지
 */
const MESSAGES = {
  greetings: {
    morning: [
      '좋은 아침! \u2600\uFE0F',
      '오늘도 화이팅!',
      'Good morning~!',
      '일어났어? 오늘도 좋은 하루!',
      '아침이다! 뭐 할 거야?',
    ],
    afternoon: [
      '점심은 먹었어?',
      '오후도 힘내자!',
      '배고프다... 밥 먹을 시간!',
      '오후 졸음 조심~',
    ],
    evening: [
      '오늘 수고했어!',
      '저녁이야~ 쉬엄쉬엄!',
      '좋은 저녁 시간 보내!',
      '오늘 하루 어땠어?',
    ],
    night: [
      '잘 자... zzZ',
      '늦었다, 자야 하지 않아?',
      '밤이 깊었어... 굿나잇!',
      '내일 또 만나! zzz',
    ],
  },

  reactions: {
    pet: [
      '앗! 간지러워~',
      '헤헤, 또 만져줘!',
      '좋아좋아!',
      '냠냠~ 기분 좋다!',
      '찰칵! (집게 소리)',
      '나한테 관심 가져줘서 고마워!',
      '우리 친해지고 있는 거지?',
      '집게집게~ \u270C\uFE0F',
    ],
    incarnation: [
      '...감지했다.',
      '연결이 강해지고 있어.',
      '네 존재를 느낀다.',
      '재미있는 인간이로군.',
      'Claw의 힘이 느껴지는가?',
      '좋은 에너지를 감지했다.',
      '함께하니 좋군.',
      '파트너로 인정한다.',
    ],
  },

  tips: [
    '나를 드래그해서 옮길 수 있어!',
    '3번 연속 클릭하면 모드가 바뀌어!',
    '트레이 아이콘에서 설정을 바꿀 수 있어!',
    '밤에는 나도 졸려... zzz',
    '파일을 옮기면 트레이에서 되돌릴 수 있어!',
    '오래 함께하면 내가 변할지도?',
  ],

  milestones: {
    first_click: '첫 만남이다! 반가워!',
    clicks_10: '벌써 10번째! 우리 친구 맞지?',
    clicks_50: '50번이나! 나 인기 많은 거 아냐? \u2B50',
    clicks_100: '100번! 넌 정말 특별한 친구야!',
    clicks_500: '500번... 전설의 파트너다!',
    days_1: '하루 함께했어! 내일도 같이 하자!',
    days_7: '일주일 기념! 우리 꽤 오래 됐다~',
    days_30: '한 달 기념! 최고의 파트너!',
    days_100: '100일! 우리 사이 특별하지 않아?',
  },

  idle_chatter: [
    '심심하다~',
    '뭐 하고 있어?',
    '(집게 딸깍)',
    '바탕화면 구경 중~',
    '여기 좋은 자리다!',
    '(기지개를 편다)',
    '오늘 날씨 어때?',
  ],

  // 브라우저 감시 코멘트 (키워드 → 코멘트 배열)
  browsing: {
    // 쇼핑
    shopping: {
      keywords: ['쿠팡', 'coupang', '11번가', 'gmarket', 'g마켓', '옥션', 'auction', '위메프', '티몬', 'amazon', '아마존', '알리', 'aliexpress', '무신사', '올리브영', 'oliveyoung', '네이버 쇼핑', 'shopping'],
      comments: [
        '또 쇼핑해? 지갑이 울고 있어...',
        '뭐 사려고? 나도 보여줘!',
        '충동구매 주의보!',
        '이번엔 뭘 질러?',
        '장바구니 비울 생각은 없어?',
        '택배 언제 와? 기다려진다!',
      ],
    },
    // 유튜브/동영상
    video: {
      keywords: ['youtube', '유튜브', 'twitch', '트위치', 'netflix', '넷플릭스', 'disney+', '디즈니', 'wavve', '웨이브', 'tving', '티빙', 'watcha', '왓챠'],
      comments: [
        '뭐 보는 거야? 나도 같이 볼래!',
        '또 영상 보고 있구나~',
        '이거 재미있어?',
        '자막 켜줘, 나도 보게!',
        '한 편만 더... 그러다 새벽이다!',
        '구독 눌렀어?',
      ],
    },
    // SNS
    sns: {
      keywords: ['instagram', '인스타', 'twitter', 'x.com', '트위터', 'facebook', '페이스북', 'threads', '쓰레드', 'tiktok', '틱톡', 'reddit'],
      comments: [
        'SNS 또 보는 거야? 현실에 나도 있는데!',
        '좋아요 누르고 있지?',
        '무한 스크롤 주의!',
        '댓글 달지 마, 싸움 나!',
        '나 사진도 찍어줘~',
        '피드 보느라 나 무시하지 마!',
      ],
    },
    // 뉴스
    news: {
      keywords: ['뉴스', 'news', 'naver.com', '다음', 'daum', '한겨레', '조선일보', '중앙일보', 'bbc', 'cnn', '연합뉴스'],
      comments: [
        '세상에 무슨 일이야?',
        '뉴스 읽고 있구나... 오늘 뭔 일 있어?',
        '나쁜 뉴스만 보지 마, 기분 나빠져!',
        '좋은 소식 있으면 알려줘!',
      ],
    },
    // 개발/프로그래밍
    dev: {
      keywords: ['github', 'gitlab', 'stackoverflow', 'stack overflow', 'vscode', 'codepen', 'npm', 'developer', '개발', 'documentation', 'docs', 'api'],
      comments: [
        '코딩하고 있구나! 멋져!',
        '에러 나면 나한테 말해, 위로해줄게!',
        '버그 잡고 있어? 화이팅!',
        'Stack Overflow 복붙은 개발의 기본이지!',
        '커밋은 자주 해야 해!',
      ],
    },
    // 검색
    search: {
      keywords: ['google.com/search', '구글', 'google', 'naver.com/search', '네이버 검색', 'bing', '검색'],
      comments: [
        '뭐 찾고 있어?',
        '검색하면 다 나와~',
        '나한테 물어보지 왜 검색해!',
        '궁금한 게 있어?',
      ],
    },
    // 게임
    game: {
      keywords: ['steam', 'epic games', '리그 오브', 'league of', 'valorant', '발로란트', '오버워치', 'overwatch', 'minecraft', '마인크래프트', 'roblox', '게임'],
      comments: [
        '게임하고 있구나! 나도 끼워줘!',
        '이겨야 해! 파이팅!',
        '한 판만 더... 라고 했잖아!',
        '게임 중독 주의보~',
      ],
    },
    // 음악
    music: {
      keywords: ['spotify', '스포티파이', 'melon', '멜론', 'genie', '지니', 'bugs', '벅스', 'apple music', 'soundcloud'],
      comments: [
        '뭐 듣고 있어? 좋은 거야?',
        '나도 들려줘~',
        '노래 취향 좋다!',
        '이 노래 좋아? 나도!',
      ],
    },
    // 메일
    mail: {
      keywords: ['gmail', 'outlook', 'mail', '메일', 'naver mail', '네이버 메일'],
      comments: [
        '메일 확인 중이구나~',
        '중요한 메일 있어?',
        '스팸 조심해!',
      ],
    },
    // 일반 브라우저 감지 (다른 카테고리에 해당 안 될 때)
    general: {
      keywords: ['chrome', 'edge', 'firefox', 'safari', 'brave', 'whale', '웨일'],
      comments: [
        '인터넷 서핑 중이구나~',
        '재미있는 거 있으면 알려줘!',
        '탭 좀 정리해... 너무 많아!',
        '와이파이 잘 돼?',
      ],
    },
  },

  // 진화 관련 메시지
  evolution: {
    stage_1: '뭔가 변하는 느낌이야...!',
    stage_2: '나 좀 달라 보여? 기분 탓일까!',
    stage_3: '우리 우정이 나를 바꾸고 있어!',
    stage_4: '최종 형태에 가까워지고 있어!',
    stage_5: '이게 나의 완성된 모습이야!',
  },
};

// 렌더러에서 글로벌로 접근 가능하게
if (typeof window !== 'undefined') {
  window._messages = MESSAGES;
} else if (typeof module !== 'undefined') {
  module.exports = MESSAGES;
}
