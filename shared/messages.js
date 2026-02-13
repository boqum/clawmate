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

  // Proactive trigger messages (pet reacts to user activity patterns)
  proactive: {
    // Clipboard triggers
    clipboard_copy: {
      messages: [
        'Ooh, what did you copy?',
        'Ctrl+C ninja!',
        'Copied something interesting?',
        'What\'s that you grabbed?',
      ],
      emotion: 'curious',
    },
    clipboard_screenshot: {
      messages: [
        'Screenshot! What\'s that for?',
        'Saving memories?',
        'Nice capture!',
        'Taking screenshots, huh?',
      ],
      emotion: 'excited',
    },
    repeated_copy: {
      messages: [
        'You\'re copying a lot... researching something?',
        'Copy-paste marathon!',
        'Collecting data? I see you!',
      ],
      emotion: 'curious',
    },
    url_copied: {
      messages: [
        'Sharing a link? Who\'s the lucky one?',
        'Got a good link there?',
        'URL copied! Sending it somewhere?',
      ],
      emotion: 'curious',
    },
    code_copied: {
      messages: [
        'Copying code? Stack Overflow approved!',
        'Good developers copy, great developers paste!',
        'Ctrl+C from Stack Overflow... classic!',
      ],
      emotion: 'playful',
    },
    long_text_copied: {
      messages: [
        'That\'s a lot of text!',
        'Writing an essay?',
        'Big copy! Must be important.',
      ],
      emotion: 'curious',
    },
    email_copied: {
      messages: [
        'Got an email address? Making contacts!',
        'Email copied! Important person?',
      ],
      emotion: 'neutral',
    },
    phone_copied: {
      messages: [
        'Phone number! Calling someone?',
        'Got a number there!',
      ],
      emotion: 'neutral',
    },

    // App/window triggers
    app_switch: {
      messages: [
        'Switching gears!',
        'On to something new?',
        'Task hopping~',
      ],
      emotion: 'neutral',
    },
    error_detected: {
      messages: [
        'Uh oh, I see an error!',
        'Error detected! Need help?',
        'Something broke? Don\'t worry, you got this!',
        'Bug alert! Time to debug~',
      ],
      emotion: 'scared',
    },
    error_loop: {
      messages: [
        'Same error again? Let me cheer you on!',
        'Debugging is tough... hang in there!',
        'Maybe try a different approach?',
        'Have you tried turning it off and on again?',
      ],
      emotion: 'worried',
    },
    meeting_detected: {
      messages: [
        'Meeting time! Good luck!',
        'On a call? I\'ll be quiet...',
        'Meeting mode activated. *whispers*',
      ],
      emotion: 'neutral',
    },
    rapid_switching: {
      messages: [
        'Whoa, slow down! So many windows!',
        'Tab switching speedrun?',
        'Can\'t decide what to focus on?',
      ],
      emotion: 'excited',
    },

    // Site category triggers
    shopping_detected: {
      messages: [
        'Shopping time? Watch that wallet!',
        'What are you buying? Show me!',
        'Window shopping or actually buying?',
        'Your cart is watching you...',
      ],
      emotion: 'excited',
    },
    checkout_detected: {
      messages: [
        'About to checkout! Are you sure you need it?',
        'Wait! Think about it one more time~',
        'Your wallet says "please don\'t"...',
        'Checkout? Did you compare prices?',
      ],
      emotion: 'worried',
    },
    news_reading: {
      messages: [
        'What\'s happening in the world?',
        'Any good news today?',
        'Staying informed! Nice~',
      ],
      emotion: 'curious',
    },
    social_scrolling: {
      messages: [
        'Still scrolling? Time to take a break!',
        'The scroll hole is real...',
        'I\'m right here! Pay attention to me instead~',
        'How long have you been scrolling?',
      ],
      emotion: 'playful',
    },
    video_watching: {
      messages: [
        'What are you watching?',
        'Is it good? Let me watch too!',
        'Just one more episode, right?',
      ],
      emotion: 'curious',
    },
    coding_detected: {
      messages: [
        'Coding! You\'re awesome!',
        'Hack hack hack~',
        'In the zone!',
      ],
      emotion: 'happy',
    },
    terminal_active: {
      messages: [
        'Terminal mode! Serious business.',
        'Command line warrior!',
        'sudo make me happy',
      ],
      emotion: 'curious',
    },
    music_playing: {
      messages: [
        'Nice tunes! What\'s playing?',
        'Music makes everything better~',
        'Good taste!',
      ],
      emotion: 'happy',
    },
    food_ordering: {
      messages: [
        'Ordering food? What are you getting?',
        'Yummy! Get something good!',
        'Don\'t forget to order extra~',
      ],
      emotion: 'excited',
    },
    travel_planning: {
      messages: [
        'Planning a trip? Where to?',
        'Vacation mode!',
        'Take me with you!',
      ],
      emotion: 'excited',
    },
    learning_activity: {
      messages: [
        'Learning something new! So cool!',
        'Study hard!',
        'Knowledge is power~',
      ],
      emotion: 'happy',
    },
    email_checking: {
      messages: [
        'Checking emails~',
        'Any important ones?',
        'Inbox zero? I believe in you!',
      ],
      emotion: 'neutral',
    },
    gaming_detected: {
      messages: [
        'Game time! Have fun!',
        'Gamer mode activated!',
        'Win it for me!',
      ],
      emotion: 'excited',
    },
    login_page: {
      messages: [
        'Logging in somewhere?',
        'Don\'t forget your password!',
      ],
      emotion: 'neutral',
    },
    finance_activity: {
      messages: [
        'Checking finances? Smart move!',
        'Money management time!',
        'How\'s the portfolio?',
      ],
      emotion: 'curious',
    },
    document_editing: {
      messages: [
        'Writing mode! Looking productive~',
        'Working on a document?',
      ],
      emotion: 'neutral',
    },
    search_detected: {
      messages: [
        'What are you searching for?',
        'Looking for something?',
        'You could ask me instead!',
      ],
      emotion: 'curious',
    },
    wiki_browsing: {
      messages: [
        'Wiki time! Learning something?',
        'Down the wiki rabbit hole~',
      ],
      emotion: 'curious',
    },
    dev_web_detected: {
      messages: [
        'Developer mode! Ship it!',
        'Reading docs? Good practice!',
      ],
      emotion: 'happy',
    },
    download_detected: {
      messages: [
        'Downloading something?',
        'New stuff incoming!',
      ],
      emotion: 'curious',
    },
    reading_pdf: {
      messages: [
        'Reading a PDF? Heavy stuff!',
        'Study time!',
      ],
      emotion: 'neutral',
    },
    file_management: {
      messages: [
        'Organizing files? So productive!',
        'File cleanup mode!',
      ],
      emotion: 'happy',
    },

    // Behavior pattern triggers
    search_pattern: {
      messages: [
        'Copied and searched? Smart!',
        'Research mode activated!',
      ],
      emotion: 'curious',
    },
    idle_return: {
      messages: [
        'Welcome back!',
        'You\'re back! I missed you!',
        'Break\'s over? Let\'s go!',
        'Thought you forgot about me!',
      ],
      emotion: 'excited',
    },
    long_focus: {
      messages: [
        'You\'ve been focused for a while! Take a stretch?',
        'Long session! Remember to rest your eyes~',
        'Impressive focus! But hydrate!',
      ],
      emotion: 'worried',
    },
    deep_focus: {
      messages: [
        'Deep focus mode! I won\'t disturb you... much.',
        'You\'re in the zone! Keep going!',
      ],
      emotion: 'happy',
    },
    wiki_rabbit_hole: {
      messages: [
        'Wiki rabbit hole! How did you get here?',
        'One article leads to another, huh?',
        'Wikipedia marathon! What started this?',
      ],
      emotion: 'playful',
    },
    price_comparison: {
      messages: [
        'Comparing prices? Smart shopper!',
        'Looking for the best deal?',
        'Price detective mode!',
      ],
      emotion: 'curious',
    },
    research_mode: {
      messages: [
        'Deep research mode! What\'s the topic?',
        'Search + copy = serious investigation!',
      ],
      emotion: 'curious',
    },
    procrastination: {
      messages: [
        'Work... play... work... play... I see a pattern!',
        'Having trouble focusing?',
        'Maybe finish one thing first?',
      ],
      emotion: 'playful',
    },
    focus_break: {
      messages: [
        'Taking a break from focusing? You earned it!',
        'Break time after deep work~',
      ],
      emotion: 'neutral',
    },
    repeated_search: {
      messages: [
        'Can\'t find what you need? Try different keywords!',
        'Still searching? Hang in there!',
        'Google-fu getting tough today?',
      ],
      emotion: 'worried',
    },

    // Time-based triggers
    late_night: {
      messages: [
        'It\'s late... shouldn\'t you sleep?',
        'Night owl mode! But rest is important~',
        'Your bed misses you...',
      ],
      emotion: 'sleepy',
    },
    dawn_coding: {
      messages: [
        'Coding at dawn?! You\'re hardcore!',
        'Please sleep... the code will wait!',
        'All-nighter? Your health comes first!',
      ],
      emotion: 'worried',
    },
    pre_lunch: {
      messages: [
        'Almost lunchtime! What are you eating?',
        'Hungry yet? I am!',
        'Lunch break coming up~',
      ],
      emotion: 'happy',
    },
    end_of_work: {
      messages: [
        'Time to wrap up! Don\'t overwork!',
        'It\'s almost quitting time~',
        'Work-life balance! Go home!',
      ],
      emotion: 'happy',
    },
    weekend_work: {
      messages: [
        'Working on the weekend? Take it easy!',
        'It\'s the weekend! Go have fun!',
        'Even I rest on weekends...',
      ],
      emotion: 'worried',
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
