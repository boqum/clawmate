// Character size (16x16 pixels -> 4x scale)
const PIXEL_SIZE = 4;
const GRID_SIZE = 16;
const CHAR_SIZE = PIXEL_SIZE * GRID_SIZE; // 64px

// Movement speed (px/frame)
const BASE_SPEED = 1.5;
const CLIMB_SPEED = 1.0;

// Speech bubble
const SPEECH_CHAR_DELAY = 30;    // ms per character
const SPEECH_DISPLAY_TIME = 5000; // ms display duration
const SPEECH_FADE_TIME = 500;     // ms fade out

// File operation safeguards
const MAX_FILES_PER_SESSION = 3;
const FILE_MOVE_COOLDOWN = 5 * 60 * 1000; // 5 minutes
const MAX_FILE_SIZE = 100 * 1024 * 1024;  // 100MB
const EXCLUDED_EXTENSIONS = ['.exe', '.dll', '.sys', '.lnk', '.ini', '.bat', '.cmd', '.ps1'];

// FSM states
const STATES = {
  IDLE: 'idle',
  WALKING: 'walking',
  CLIMBING_UP: 'climbing_up',
  CLIMBING_DOWN: 'climbing_down',
  CEILING_WALK: 'ceiling_walk',
  SLEEPING: 'sleeping',
  CARRYING: 'carrying',
  PLAYING: 'playing',
  INTERACTING: 'interacting',
  SCARED: 'scared',
  EXCITED: 'excited',
};

// Screen edges
const EDGES = {
  BOTTOM: 'bottom',
  LEFT: 'left',
  RIGHT: 'right',
  TOP: 'top',
};

// Directions
const DIRECTIONS = {
  LEFT: -1,
  RIGHT: 1,
};

// Color palette
const COLORS = {
  pet: {
    primary: '#ff4f40',
    secondary: '#ff775f',
    dark: '#3a0a0d',
    eye: '#ffffff',
    pupil: '#111111',
    claw: '#ff4f40',
    speechBorder: '#ff4f40',
    speechBg: '#fff5f5',
  },
  incarnation: {
    primary: '#ff4f40',
    secondary: '#ff775f',
    dark: '#3a0a0d',
    eye: '#00BFA5',
    pupil: '#004D40',
    claw: '#ff4f40',
    glow: '#00BFA5',
    speechBorder: '#00BFA5',
    speechBg: '#f0fffd',
  },
};

module.exports = {
  PIXEL_SIZE, GRID_SIZE, CHAR_SIZE, BASE_SPEED, CLIMB_SPEED,
  SPEECH_CHAR_DELAY, SPEECH_DISPLAY_TIME, SPEECH_FADE_TIME,
  MAX_FILES_PER_SESSION, FILE_MOVE_COOLDOWN, MAX_FILE_SIZE, EXCLUDED_EXTENSIONS,
  STATES, EDGES, DIRECTIONS, COLORS,
};
