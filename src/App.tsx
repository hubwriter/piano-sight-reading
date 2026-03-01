import { useState, useCallback, useEffect, useRef } from 'react';
import { Renderer, Stave, StaveNote, Accidental, Formatter } from 'vexflow';

// ─── Constants ────────────────────────────────────────────────────────────────

const WHITE_KEY_WIDTH = 38;
const WHITE_KEY_HEIGHT = 160;
const BLACK_KEY_WIDTH = 24;
const BLACK_KEY_HEIGHT = 96;
const OCTAVE_WIDTH = 7 * WHITE_KEY_WIDTH;

const LINE_SPACING = 20; // px between staff lines
const STAFF_TOP = 80;    // y of the top staff line in the SVG

// ─── Types ────────────────────────────────────────────────────────────────────

type Clef = 'treble' | 'bass';
type KeyColor = 'white' | 'black';
type KeyState = 'normal' | 'correct' | 'wrong' | 'reveal';

interface PianoKey {
  label: string;
  note: string;
  octave: number;
  color: KeyColor;
  x: number;
}

interface StaffNote {
  label: string;
  note: string;
  octave: number;
  clef: Clef;
  staffY: number;
  accidental: 'sharp' | 'flat' | null;
  ledgerLines: number[];
  keyboardLabel: string; // piano key to match (enharmonic sharp for flats)
  vfKey: string;         // VexFlow key string e.g. "c/4", "f#/3", "db/4"
}

// ─── Piano Keyboard Layout ────────────────────────────────────────────────────

const OCTAVE_NOTES: { note: string; color: KeyColor; whiteIndex: number; blackOffset?: number }[] = [
  { note: 'C',  color: 'white', whiteIndex: 0 },
  { note: 'C#', color: 'black', whiteIndex: 0, blackOffset: 1 },
  { note: 'D',  color: 'white', whiteIndex: 1 },
  { note: 'D#', color: 'black', whiteIndex: 1, blackOffset: 2 },
  { note: 'E',  color: 'white', whiteIndex: 2 },
  { note: 'F',  color: 'white', whiteIndex: 3 },
  { note: 'F#', color: 'black', whiteIndex: 3, blackOffset: 4 },
  { note: 'G',  color: 'white', whiteIndex: 4 },
  { note: 'G#', color: 'black', whiteIndex: 4, blackOffset: 5 },
  { note: 'A',  color: 'white', whiteIndex: 5 },
  { note: 'A#', color: 'black', whiteIndex: 5, blackOffset: 6 },
  { note: 'B',  color: 'white', whiteIndex: 6 },
];

function buildKeyboard(): PianoKey[] {
  const keys: PianoKey[] = [];
  for (let octave = 2; octave <= 6; octave++) {
    const octaveStart = (octave - 2) * OCTAVE_WIDTH;
    for (const n of OCTAVE_NOTES) {
      if (octave === 6 && n.note !== 'C' && n.note !== 'C#') continue;
      const x = octaveStart + (
        n.color === 'white'
          ? n.whiteIndex * WHITE_KEY_WIDTH
          : (n.blackOffset! * WHITE_KEY_WIDTH) - BLACK_KEY_WIDTH / 2
      );
      keys.push({ label: `${n.note}${octave}`, note: n.note, octave, color: n.color, x });
    }
  }
  return keys;
}

const KEYBOARD_KEYS = buildKeyboard();
const KEYBOARD_WIDTH = 4 * OCTAVE_WIDTH + WHITE_KEY_WIDTH; // C2–C6

// ─── Staff Note Definitions ───────────────────────────────────────────────────

function trebleY(stepsAboveE4: number): number {
  // E4 is on bottom staff line = STAFF_TOP + 4*LINE_SPACING
  return STAFF_TOP + 4 * LINE_SPACING - stepsAboveE4 * (LINE_SPACING / 2);
}

function bassY(stepsAboveG2: number): number {
  // G2 is on bottom staff line = STAFF_TOP + 4*LINE_SPACING
  return STAFF_TOP + 4 * LINE_SPACING - stepsAboveG2 * (LINE_SPACING / 2);
}

const TREBLE_NATURAL_POSITIONS: Record<string, number> = {
  C4: trebleY(-2),
  D4: trebleY(-1),
  E4: trebleY(0),
  F4: trebleY(1),
  G4: trebleY(2),
  A4: trebleY(3),
  B4: trebleY(4),
  C5: trebleY(5),
  D5: trebleY(6),
  E5: trebleY(7),
  F5: trebleY(8),
  G5: trebleY(9),
  A5: trebleY(10),
  B5: trebleY(11),
  C6: trebleY(12),
};

const BASS_NATURAL_POSITIONS: Record<string, number> = {
  C2: bassY(-6),
  D2: bassY(-5),
  E2: bassY(-4),
  F2: bassY(-3),
  G2: bassY(0),
  A2: bassY(1),
  B2: bassY(2),
  C3: bassY(3),
  D3: bassY(4),
  E3: bassY(5),
  F3: bassY(6),
  G3: bassY(7),
  A3: bassY(8),
  B3: bassY(9),
  C4: bassY(10),
};

function ledgerLinesForNote(staffY: number, extraBelow = 0): number[] {
  const lines: number[] = [];
  const bottomLine = STAFF_TOP + 4 * LINE_SPACING;
  const topLine = STAFF_TOP;
  // Below staff
  for (let i = 1; i <= 3 + extraBelow; i++) {
    const lineY = bottomLine + i * LINE_SPACING;
    if (staffY >= lineY - LINE_SPACING / 2) lines.push(lineY);
  }
  // Above staff
  for (let i = 1; i <= 3; i++) {
    const lineY = topLine - i * LINE_SPACING;
    if (staffY <= lineY + LINE_SPACING / 2) lines.push(lineY);
  }
  return lines;
}

const SHARP_NATURALS = ['C', 'D', 'F', 'G', 'A'];
// Naturals that can be spelled as a flat (e.g. Db uses D's staff position)
const FLAT_NATURALS = ['D', 'E', 'G', 'A', 'B'];
// Maps a natural note name to the note whose # is enharmonically equal to that natural's flat
// e.g. Db = C#, so D → C
const FLAT_TO_SHARP_BASE: Record<string, string> = { D: 'C', E: 'D', G: 'F', A: 'G', B: 'A' };

function buildStaffNotes(): StaffNote[] {
  const notes: StaffNote[] = [];

  function addNotes(positions: Record<string, number>, clef: Clef, extraBelow = 0) {
    for (const [label, staffY] of Object.entries(positions)) {
      const match = label.match(/^([A-G])(\d)$/);
      if (!match) continue;
      const [, nat, octStr] = match;
      const octave = parseInt(octStr);
      const ledgerLines = ledgerLinesForNote(staffY, extraBelow);
      // Natural
      notes.push({ label, note: nat, octave, clef, staffY, accidental: null,
        keyboardLabel: label, vfKey: `${nat.toLowerCase()}/${octStr}`, ledgerLines });
      // Sharp
      if (SHARP_NATURALS.includes(nat)) {
        const sharpLabel = `${nat}#${octStr}`;
        notes.push({ label: sharpLabel, note: `${nat}#`, octave, clef, staffY,
          accidental: 'sharp', keyboardLabel: sharpLabel,
          vfKey: `${nat.toLowerCase()}#/${octStr}`, ledgerLines });
      }
      // Flat (e.g. Db4 drawn on D's line, keyboard key = C#4)
      if (FLAT_NATURALS.includes(nat)) {
        const flatLabel = `${nat}b${octStr}`;
        const kbLabel = `${FLAT_TO_SHARP_BASE[nat]}#${octStr}`;
        notes.push({ label: flatLabel, note: `${nat}b`, octave, clef, staffY,
          accidental: 'flat', keyboardLabel: kbLabel,
          vfKey: `${nat.toLowerCase()}b/${octStr}`, ledgerLines });
      }
    }
  }

  addNotes(TREBLE_NATURAL_POSITIONS, 'treble');
  addNotes(BASS_NATURAL_POSITIONS, 'bass', 1);
  return notes;
}

const ALL_STAFF_NOTES = buildStaffNotes();

function randomNote(): StaffNote {
  return ALL_STAFF_NOTES[Math.floor(Math.random() * ALL_STAFF_NOTES.length)];
}

// ─── MusicStaff Component (VexFlow) ─────────────────────────────────────────

function MusicStaff({ staffNote }: { staffNote: StaffNote }) {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!divRef.current) return;
    divRef.current.innerHTML = '';

    const renderer = new Renderer(divRef.current, Renderer.Backends.SVG);
    renderer.resize(340, 250);
    const ctx = renderer.getContext();
    ctx.scale(1.8, 1.8);

    // Draw stave with clef
    const stave = new Stave(20, 14, 157);
    stave.addClef(staffNote.clef).setNoteStartX(95).setContext(ctx).draw();

    const note = new StaveNote({
      clef: staffNote.clef,
      keys: [staffNote.vfKey],
      duration: 'q',
    });

    if (staffNote.accidental === 'sharp') {
      note.addModifier(new Accidental('#'), 0);
    } else if (staffNote.accidental === 'flat') {
      note.addModifier(new Accidental('b'), 0);
    }

    Formatter.FormatAndDraw(ctx, stave, [note]);
  }, [staffNote]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', background: '#fffef8' }}>
      <div ref={divRef} style={{ lineHeight: 0 }} />
    </div>
  );
}

// ─── PianoKeyboard Component ──────────────────────────────────────────────────

// Format a note label for display: strip octave number, replace flat 'b' with ♭
function formatNoteName(label: string): string {
  return label.replace(/\d+$/, '').replace(/b$/, '\u266d');
}

const SHARP_TO_FLAT_NAME: Record<string, string> = {
  'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb',
};

const KEY_COLORS: Record<KeyState, { white: string; black: string }> = {
  normal:  { white: '#ffffff', black: '#1a1a1a' },
  correct: { white: '#4caf50', black: '#2e7d32' },
  wrong:   { white: '#f44336', black: '#c62828' },
  reveal:  { white: '#ff9800', black: '#e65100' },
};

function PianoKeyboard({
  keyStates,
  onKeyClick,
  clickHint,
}: {
  keyStates: Record<string, KeyState>;
  onKeyClick: (label: string) => void;
  clickHint: { noteName: string; cx: number } | null;
}) {
  const whiteKeys = KEYBOARD_KEYS.filter(k => k.color === 'white');
  const blackKeys = KEYBOARD_KEYS.filter(k => k.color === 'black');
  const HINT_H = 22;

  return (
    <svg
      width={KEYBOARD_WIDTH + 2}
      height={WHITE_KEY_HEIGHT + 2 + HINT_H}
      viewBox={`0 0 ${KEYBOARD_WIDTH + 2} ${WHITE_KEY_HEIGHT + 2 + HINT_H}`}
      style={{ display: 'block', margin: '0 auto', overflow: 'visible', cursor: 'pointer' }}
    >
      {/* White keys */}
      {whiteKeys.map(key => {
        const state = keyStates[key.label] ?? 'normal';
        const fill = KEY_COLORS[state].white;
        return (
          <g key={key.label} onClick={() => onKeyClick(key.label)} style={{ cursor: 'pointer' }}>
            <rect
              x={key.x + 1} y={1}
              width={WHITE_KEY_WIDTH - 2} height={WHITE_KEY_HEIGHT - 2}
              rx={3} fill={fill} stroke="#555" strokeWidth={1}
            />
            {key.label === 'C4' && (
              <>
                <text
                  x={key.x + WHITE_KEY_WIDTH / 2}
                  y={WHITE_KEY_HEIGHT - 22}
                  textAnchor="middle"
                  fontSize={9} fill="#aaa"
                  style={{ userSelect: 'none', pointerEvents: 'none' }}
                >
                  Middle
                </text>
                <text
                  x={key.x + WHITE_KEY_WIDTH / 2}
                  y={WHITE_KEY_HEIGHT - 11}
                  textAnchor="middle"
                  fontSize={9} fill="#aaa"
                  style={{ userSelect: 'none', pointerEvents: 'none' }}
                >
                  C
                </text>
              </>
            )}
          </g>
        );
      })}

      {/* Black keys (rendered on top) */}
      {blackKeys.map(key => {
        const state = keyStates[key.label] ?? 'normal';
        const fill = KEY_COLORS[state].black;
        // C#6 is the last key: render only the left half so it doesn't overhang
        const w = key.label === 'C#6' ? BLACK_KEY_WIDTH / 2 : BLACK_KEY_WIDTH;
        return (
          <g key={key.label} onClick={() => onKeyClick(key.label)} style={{ cursor: 'pointer' }}>
            <rect
              x={key.x} y={0}
              width={w} height={BLACK_KEY_HEIGHT}
              rx={2} fill={fill} stroke="#000" strokeWidth={1}
            />
          </g>
        );
      })}
      {/* Click hint label below keyboard */}
      {clickHint && (
        <text
          x={clickHint.cx}
          y={WHITE_KEY_HEIGHT + 16}
          textAnchor="middle"
          fontSize={13}
          fill="#888"
          fontFamily="system-ui, sans-serif"
          style={{ userSelect: 'none', pointerEvents: 'none' }}
        >
          {clickHint.noteName}
        </text>
      )}
    </svg>
  );
}

// ─── Stopwatch Component ──────────────────────────────────────────────────────

const SW_R = 80;         // face radius
const SW_SIZE = 200;     // SVG viewBox size
const SW_CX = 100;
const SW_CY = 105;
const SW_MAX = 15;       // max seconds on face

// Angle for a given second value: 0 at top, increasing clockwise
function swAngle(v: number): number {
  return (v / SW_MAX) * 2 * Math.PI - Math.PI / 2;
}

function Stopwatch({ duration, timeLeft, running }: { duration: number; timeLeft: number; running: boolean }) {
  const handAngle = swAngle(timeLeft);
  const handLen = SW_R * 0.72;
  const hx = SW_CX + handLen * Math.cos(handAngle);
  const hy = SW_CY + handLen * Math.sin(handAngle);

  // Active arc: from timeLeft position back to 0 (counterclockwise), i.e. the remaining arc
  const arcStart = swAngle(0);
  const arcEnd = swAngle(timeLeft);
  const arcLarge = timeLeft > SW_MAX / 2 ? 1 : 0;
  // arc goes from 0-angle to timeLeft-angle clockwise
  const arcX1 = SW_CX + SW_R * 0.88 * Math.cos(arcStart);
  const arcY1 = SW_CY + SW_R * 0.88 * Math.sin(arcStart);
  const arcX2 = SW_CX + SW_R * 0.88 * Math.cos(arcEnd);
  const arcY2 = SW_CY + SW_R * 0.88 * Math.sin(arcEnd);

  return (
    <svg width={SW_SIZE} height={SW_SIZE + 10} viewBox={`0 0 ${SW_SIZE} ${SW_SIZE + 10}`}>
      {/* Outer ring */}
      <circle cx={SW_CX} cy={SW_CY} r={SW_R + 8} fill="#555" />
      {/* Stem at top */}
      <rect x={SW_CX - 6} y={SW_CY - SW_R - 16} width={12} height={12} rx={3} fill="#555" />
      {/* Crown button top */}
      <rect x={SW_CX - 8} y={SW_CY - SW_R - 22} width={16} height={8} rx={4} fill="#777" />
      {/* Face */}
      <circle cx={SW_CX} cy={SW_CY} r={SW_R} fill="#fffef8" />
      {/* Remaining-time arc */}
      {timeLeft > 0 && (
        <path
          d={`M ${arcX1} ${arcY1} A ${SW_R * 0.88} ${SW_R * 0.88} 0 ${arcLarge} 1 ${arcX2} ${arcY2}`}
          fill="none"
          stroke={running ? '#4caf50' : '#90caf9'}
          strokeWidth={5}
          strokeLinecap="round"
        />
      )}
      {/* Tick marks & labels */}
      {Array.from({ length: SW_MAX + 1 }, (_, i) => {
        const a = swAngle(i);
        const isMajor = i % 5 === 0;
        const r1 = SW_R - (isMajor ? 14 : 8);
        const r2 = SW_R - 2;
        const x1 = SW_CX + r1 * Math.cos(a);
        const y1 = SW_CY + r1 * Math.sin(a);
        const x2 = SW_CX + r2 * Math.cos(a);
        const y2 = SW_CY + r2 * Math.sin(a);
        const labelR = SW_R - (isMajor ? 26 : 21);
        const lx = SW_CX + labelR * Math.cos(a);
        const ly = SW_CY + labelR * Math.sin(a);
        const showLabel = i > 0 && i < SW_MAX;
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="#555" strokeWidth={isMajor ? 2 : 1} strokeLinecap="round" />
            {showLabel && (
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central"
                fontSize={isMajor ? 11 : 8} fill="#444" fontFamily="system-ui, sans-serif"
                fontWeight={isMajor ? '600' : '400'}>
                {i}
              </text>
            )}
          </g>
        );
      })}
      {/* Duration marker dot */}
      <circle
        cx={SW_CX + (SW_R - 8) * Math.cos(swAngle(duration))}
        cy={SW_CY + (SW_R - 8) * Math.sin(swAngle(duration))}
        r={4} fill="#1976d2"
      />
      {/* Hand */}
      <line x1={SW_CX} y1={SW_CY} x2={hx} y2={hy}
        stroke="#d32f2f" strokeWidth={3} strokeLinecap="round" />
      {/* Centre pin */}
      <circle cx={SW_CX} cy={SW_CY} r={5} fill="#333" />
    </svg>
  );
}

// ─── Piano Sampler ─────────────────────────────────────────────────────────────

const GLEITZ_BASE = 'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/acoustic_grand_piano-mp3';

const SHARP_TO_GLEITZ: Record<string, string> = {
  'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb',
};

function labelToGleitz(label: string): string {
  const note = label.replace(/\d+$/, '');
  const octave = label.match(/\d+$/)?.[0] ?? '';
  return (SHARP_TO_GLEITZ[note] ?? note) + octave;
}

function usePianoSampler() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const [samplerReady, setSamplerReady] = useState(false);

  useEffect(() => {
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const labels = KEYBOARD_KEYS.map(k => k.label);
    Promise.all(
      labels.map(async label => {
        try {
          const res = await fetch(`${GLEITZ_BASE}/${labelToGleitz(label)}.mp3`);
          const arrayBuf = await res.arrayBuffer();
          const audioBuf = await ctx.decodeAudioData(arrayBuf);
          buffersRef.current.set(label, audioBuf);
        } catch (e) {
          console.warn(`Failed to load piano sample: ${label}`, e);
        }
      })
    ).then(() => setSamplerReady(true));
    return () => { ctx.close(); };
  }, []);

  const playNote = useCallback((label: string) => {
    const ctx = audioCtxRef.current;
    const buf = buffersRef.current.get(label);
    if (!ctx || !buf) return;
    if (ctx.state === 'suspended') ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  }, []);

  return { playNote, samplerReady };
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const { playNote, samplerReady } = usePianoSampler();

  const [currentNote, setCurrentNote] = useState<StaffNote>(() => randomNote());
  const [keyStates, setKeyStates] = useState<Record<string, KeyState>>({});
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const greenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [clickHint, setClickHint] = useState<{ noteName: string; cx: number } | null>(null);
  const clickHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Timed mode state
  const [timedEnabled, setTimedEnabled] = useState(false);
  const [duration, setDuration] = useState(5);
  const [timeLeft, setTimeLeft] = useState(5);
  const [timerRunning, setTimerRunning] = useState(false);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [revealNote, setRevealNote] = useState<StaffNote | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs so callbacks always see latest values without deps
  const currentNoteRef = useRef(currentNote);
  const durationRef = useRef(duration);
  useEffect(() => { currentNoteRef.current = currentNote; }, [currentNote]);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  // Keep timeLeft in sync with duration when not running
  useEffect(() => {
    if (!timerRunning) setTimeLeft(duration);
  }, [duration, timerRunning]);

  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current !== null) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (revealTimerRef.current !== null) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    setRevealNote(null);
    setKeyStates({});
    setTimerRunning(false);
  }, []);

  const startTimerInterval = useCallback(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = setInterval(() => {
      setTimeLeft(prev => Math.max(0, prev - 1));
    }, 1000);
  }, []);

  const startTimer = useCallback(() => {
    setTimerRunning(true);
    setTimeLeft(prev => prev > 0 ? prev : durationRef.current);
    startTimerInterval();
  }, [startTimerInterval]);

  // Detect timeout: when timeLeft reaches 0 while running, show reveal then advance
  useEffect(() => {
    if (timeLeft !== 0 || !timerRunning) return;
    // Pause the interval while revealing
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    const timedOut = currentNoteRef.current;
    setRevealNote(timedOut);
    setKeyStates({ [timedOut.keyboardLabel]: 'reveal' });
    revealTimerRef.current = setTimeout(() => {
      revealTimerRef.current = null;
      setRevealNote(null);
      setKeyStates({});
      setScore(s => ({ ...s, total: s.total + 1 }));
      setCurrentNote(prev => {
        let next = randomNote();
        while (next.label === prev.label) next = randomNote();
        return next;
      });
      const d = durationRef.current;
      setTimeLeft(d);
      // Restart interval after a brief delay so the new timeLeft value is set first
      timerIntervalRef.current = setInterval(() => {
        setTimeLeft(prev => Math.max(0, prev - 1));
      }, 1000);
    }, 2000);
  }, [timeLeft, timerRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop timer when timed mode is toggled off
  useEffect(() => {
    if (!timedEnabled) stopTimer();
  }, [timedEnabled, stopTimer]);

  // Clean up on unmount
  useEffect(() => () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    if (clickHintTimerRef.current) clearTimeout(clickHintTimerRef.current);
  }, []);

  const handleKeyClick = useCallback((label: string) => {
    // Ignore clicks during the timeout-reveal period
    if (revealNote !== null) return;

    // Play the piano note immediately
    playNote(label);

    // Show note name hint below the clicked key
    const clickedKey = KEYBOARD_KEYS.find(k => k.label === label);
    if (clickedKey) {
      const cx = clickedKey.x + (clickedKey.color === 'white' ? WHITE_KEY_WIDTH / 2 : BLACK_KEY_WIDTH / 2);
      // For black keys, choose sharp or flat name based on what's shown on the staff
      const rawName = label.replace(/\d+$/, '');
      const flatEquiv = SHARP_TO_FLAT_NAME[rawName];
      const displayName =
        clickedKey.color === 'black' && currentNote.accidental === 'flat' && flatEquiv
          ? formatNoteName(flatEquiv)
          : formatNoteName(label);
      if (clickHintTimerRef.current) clearTimeout(clickHintTimerRef.current);
      setClickHint({ noteName: displayName, cx });
      clickHintTimerRef.current = setTimeout(() => {
        setClickHint(null);
        clickHintTimerRef.current = null;
      }, 2000);
    }

    // Cancel and clear any lingering green key immediately
    if (greenTimerRef.current !== null) {
      clearTimeout(greenTimerRef.current);
      greenTimerRef.current = null;
    }

    const isCorrect = label === currentNote.keyboardLabel;

    if (isCorrect) {
      setScore(s => ({ correct: s.correct + 1, total: s.total + 1 }));
      setCurrentNote(prev => {
        let next = randomNote();
        while (next.label === prev.label) next = randomNote();
        return next;
      });
      // Reset countdown on correct answer
      if (timerRunning) setTimeLeft(duration);
      // Show green key, clear it after 2s
      setKeyStates({ [label]: 'correct' });
      greenTimerRef.current = setTimeout(() => {
        greenTimerRef.current = null;
        setKeyStates(prev => {
          const next = { ...prev };
          if (next[label] === 'correct') delete next[label];
          return next;
        });
      }, 2000);
    } else {
      setScore(s => ({ ...s, total: s.total + 1 }));
      setKeyStates({ [label]: 'wrong' });
      setTimeout(() => {
        setKeyStates(prev => {
          const next = { ...prev };
          if (next[label] === 'wrong') delete next[label];
          return next;
        });
      }, 1600);
    }
  }, [currentNote, timerRunning, duration, revealNote, playNote]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #e8eaf6 0%, #f5f5f0 100%)',
      padding: '24px 16px',
      boxSizing: 'border-box',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ maxWidth: KEYBOARD_WIDTH + 40, margin: '0 auto' }}>

        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}>
          <h1 style={{ margin: 0, fontSize: 26, color: '#222', letterSpacing: -0.5 }}>
            Piano Sight Reading
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {!samplerReady && (
              <span style={{
                fontSize: 12, color: '#999', fontStyle: 'italic',
              }}>
                Loading audio…
              </span>
            )}
            <div style={{
              fontSize: 22, fontWeight: 700, color: '#333',
              background: '#fff', borderRadius: 8, padding: '6px 16px',
              boxShadow: '0 1px 6px rgba(0,0,0,0.10)',
            }}>
              {score.correct} / {score.total}
            </div>
          </div>
        </div>

        {/* Main card: Timed toggle + [duration | staff | stopwatch] */}
        <div style={{
          marginTop: 16,
          background: '#fffef8',
          borderRadius: 10,
          boxShadow: '0 2px 16px rgba(0,0,0,0.10)',
          padding: '10px 24px 14px',
          overflow: 'hidden',
        }}>
          {/* Timed toggle — top left */}
          <div style={{ marginBottom: 6 }}>
            <button
              onClick={() => setTimedEnabled(v => !v)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: timedEnabled ? '#1976d2' : '#ccc',
                color: timedEnabled ? '#fff' : '#555',
                border: 'none', borderRadius: 20, padding: '6px 16px',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 1px 4px rgba(0,0,0,0.15)', transition: 'background 0.2s',
              }}
            >
              <span style={{
                width: 14, height: 14, borderRadius: '50%',
                background: timedEnabled ? '#fff' : '#888',
                display: 'inline-block', flexShrink: 0,
              }} />
              Timed
            </button>
          </div>

          {/* Three-column row: duration | staff | stopwatch */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

            {/* Left: duration controls (only when timed enabled) */}
            <div style={{ flex: '0 0 200px', display: 'flex', flexDirection: 'column',
              alignItems: 'flex-start', justifyContent: 'center', gap: 12,
              visibility: timedEnabled ? 'visible' : 'hidden', marginTop: -16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>Duration:</span>
                <button
                  onClick={() => setDuration(d => Math.max(2, d - 1))}
                  disabled={timerRunning}
                  style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #aaa',
                    background: '#fff', fontSize: 18, cursor: 'pointer', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    lineHeight: 1 }}>−</button>
                <span style={{ fontSize: 20, fontWeight: 700, minWidth: 36,
                  textAlign: 'center', color: '#222' }}>{duration}s</span>
                <button
                  onClick={() => setDuration(d => Math.min(15, d + 1))}
                  disabled={timerRunning}
                  style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #aaa',
                    background: '#fff', fontSize: 18, cursor: 'pointer', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    lineHeight: 1 }}>+</button>
              </div>
              <input
                type="range" min={2} max={15} value={duration}
                disabled={timerRunning}
                onChange={e => setDuration(Number(e.target.value))}
                style={{ width: 160, accentColor: '#1976d2' }}
              />
            </div>

            {/* Centre: staff */}
            <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column',
              alignItems: 'center', marginTop: -16 }}>
              {/* Revealed note label — fixed-height container so nothing shifts */}
              <div style={{ height: 40, display: 'flex', alignItems: 'center',
                justifyContent: 'center', width: '100%' }}>
                <div style={{
                  fontSize: 36, fontWeight: 800, color: '#222',
                  letterSpacing: 1, textAlign: 'center', lineHeight: 1,
                  visibility: revealNote ? 'visible' : 'hidden',
                }}>
                  {revealNote ? formatNoteName(revealNote.label) : '\u00a0'}
                </div>
              </div>
              <MusicStaff staffNote={currentNote} />
              <div style={{ fontSize: 13, color: '#bbb', marginTop: 8 }}>
                Click the matching key on the piano
              </div>
            </div>

            {/* Right: stopwatch + start/pause (only when timed enabled) */}
            <div style={{ flex: '0 0 200px', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 10,
              visibility: timedEnabled ? 'visible' : 'hidden' }}>
              <Stopwatch duration={duration} timeLeft={timeLeft} running={timerRunning} />
              <button
                onClick={() => timerRunning ? stopTimer() : startTimer()}
                style={{
                  padding: '10px 0', width: 120, fontSize: 16, fontWeight: 700,
                  background: timerRunning ? '#f57c00' : '#388e3c',
                  color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)', transition: 'background 0.2s',
                }}
              >
                {timerRunning ? 'Pause' : 'Start'}
              </button>
            </div>

          </div>
        </div>

        {/* Keyboard */}
        <div style={{ overflowX: 'auto', paddingBottom: 8, marginTop: 28 }}>
          <PianoKeyboard keyStates={keyStates} onKeyClick={handleKeyClick} clickHint={clickHint} />
        </div>

      </div>
    </div>
  );
}
