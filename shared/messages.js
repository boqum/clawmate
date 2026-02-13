/**
 * Speech bubble message DB
 * All messages maintain a positive, playful tone
 */
const MESSAGES = {
  greetings: {
    morning: [
      'Good morning! \u2600\uFE0F',
      'Let\'s crush it today!',
      'Rise and shine~!',
      'You\'re up? Let\'s have a great day!',
      'Morning! What\'s the plan?',
    ],
    afternoon: [
      'Had lunch yet?',
      'Keep it up this afternoon!',
      'Hungry... time to eat!',
      'Watch out for the afternoon slump~',
    ],
    evening: [
      'Great work today!',
      'Evening time~ take it easy!',
      'Have a nice evening!',
      'How was your day?',
    ],
    night: [
      'Good night... zzZ',
      'It\'s late, shouldn\'t you sleep?',
      'It\'s getting late... nighty night!',
      'See you tomorrow! zzz',
    ],
  },

  reactions: {
    pet: [
      'Eek! That tickles~',
      'Hehe, do it again!',
      'Love it love it!',
      'Nom nom~ feels good!',
      'Click! (claw snap)',
      'Thanks for paying attention to me!',
      'We\'re getting closer, right?',
      'Clicky clack~ \u270C\uFE0F',
    ],
    incarnation: [
      '...Detected.',
      'The connection grows stronger.',
      'I sense your presence.',
      'An interesting human.',
      'Can you feel the power of the Claw?',
      'Positive energy detected.',
      'Good to be together.',
      'I acknowledge you as a partner.',
    ],
  },

  tips: [
    'You can drag me around!',
    'Triple-click to switch modes!',
    'Change settings from the tray icon!',
    'At night I get sleepy too... zzz',
    'You can undo file moves from the tray!',
    'Stay with me long enough and I might evolve~',
  ],

  milestones: {
    first_click: 'First meeting! Nice to meet you!',
    clicks_10: 'Already 10 times! We\'re friends now, right?',
    clicks_50: '50 times! Am I popular or what? \u2B50',
    clicks_100: '100 times! You\'re truly a special friend!',
    clicks_500: '500 times... a legendary partner!',
    days_1: 'One day together! Let\'s do it again tomorrow!',
    days_7: 'One week anniversary! We go way back~',
    days_30: 'One month anniversary! Best partner ever!',
    days_100: '100 days! Isn\'t our bond something special?',
  },

  idle_chatter: [
    'So bored~',
    'Whatcha doing?',
    '(claw click)',
    'Exploring the desktop~',
    'Nice spot right here!',
    '(stretches)',
    'How\'s the weather today?',
  ],

  // Browsing watch comments (keyword -> comment arrays)
  browsing: {
    // Shopping
    shopping: {
      keywords: ['coupang', '11st', 'gmarket', 'auction', 'wemakeprice', 'tmon', 'amazon', 'aliexpress', 'musinsa', 'oliveyoung', 'shopping'],
      comments: [
        'Shopping again? Your wallet is crying...',
        'What are you buying? Show me!',
        'Impulse purchase alert!',
        'What are you splurging on this time?',
        'Ever thought about emptying that cart?',
        'When\'s the package arriving? Can\'t wait!',
      ],
    },
    // YouTube / Video
    video: {
      keywords: ['youtube', 'twitch', 'netflix', 'disney+', 'wavve', 'tving', 'watcha'],
      comments: [
        'What are you watching? Let me watch too!',
        'Watching videos again~',
        'Is this one good?',
        'Turn on subtitles so I can follow!',
        'Just one more episode... and suddenly it\'s 3 AM!',
        'Did you hit subscribe?',
      ],
    },
    // SNS
    sns: {
      keywords: ['instagram', 'twitter', 'x.com', 'facebook', 'threads', 'tiktok', 'reddit'],
      comments: [
        'On social media again? I\'m right here in real life!',
        'Hitting that like button, aren\'t you?',
        'Infinite scroll alert!',
        'Don\'t comment, you\'ll start a fight!',
        'Take a pic of me too~',
        'Don\'t ignore me for your feed!',
      ],
    },
    // News
    news: {
      keywords: ['news', 'naver.com', 'daum', 'bbc', 'cnn'],
      comments: [
        'What\'s going on in the world?',
        'Reading the news... anything happening today?',
        'Don\'t just read bad news, it\'ll bring you down!',
        'Any good news? Let me know!',
      ],
    },
    // Dev / Programming
    dev: {
      keywords: ['github', 'gitlab', 'stackoverflow', 'stack overflow', 'vscode', 'codepen', 'npm', 'developer', 'documentation', 'docs', 'api'],
      comments: [
        'Coding! That\'s awesome!',
        'Got an error? Tell me, I\'ll cheer you up!',
        'Squashing bugs? You got this!',
        'Copy-pasting from Stack Overflow is a dev essential!',
        'Remember to commit often!',
      ],
    },
    // Search
    search: {
      keywords: ['google.com/search', 'google', 'naver.com/search', 'bing'],
      comments: [
        'What are you looking for?',
        'Search and you shall find~',
        'Why search when you can ask me!',
        'Something on your mind?',
      ],
    },
    // Gaming
    game: {
      keywords: ['steam', 'epic games', 'league of', 'valorant', 'overwatch', 'minecraft', 'roblox'],
      comments: [
        'Gaming! Let me join!',
        'You gotta win! Go go go!',
        'Just one more round... you said that last time!',
        'Gaming addiction alert~',
      ],
    },
    // Music
    music: {
      keywords: ['spotify', 'melon', 'genie', 'bugs', 'apple music', 'soundcloud'],
      comments: [
        'What are you listening to? Is it good?',
        'Let me hear too~',
        'Nice taste in music!',
        'You like this song? Me too!',
      ],
    },
    // Mail
    mail: {
      keywords: ['gmail', 'outlook', 'mail'],
      comments: [
        'Checking emails~',
        'Any important ones?',
        'Watch out for spam!',
      ],
    },
    // General browser detection (fallback)
    general: {
      keywords: ['chrome', 'edge', 'firefox', 'safari', 'brave', 'whale'],
      comments: [
        'Surfing the web~',
        'Find anything fun? Tell me!',
        'Clean up those tabs... too many!',
        'Is the wifi working okay?',
      ],
    },
  },

  // Evolution messages
  evolution: {
    stage_1: 'Something\'s changing...!',
    stage_2: 'Do I look different? Maybe it\'s just me!',
    stage_3: 'Our friendship is transforming me!',
    stage_4: 'Getting closer to my final form!',
    stage_5: 'This is my completed form!',
  },
};

// Make accessible globally in renderer
if (typeof window !== 'undefined') {
  window._messages = MESSAGES;
} else if (typeof module !== 'undefined') {
  module.exports = MESSAGES;
}
