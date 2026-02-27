import { useState, useCallback } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────

const WHITE_KEY_WIDTH = 38;
const WHITE_KEY_HEIGHT = 160;
const BLACK_KEY_WIDTH = 24;
const BLACK_KEY_HEIGHT = 96;
const OCTAVE_WIDTH = 7 * WHITE_KEY_WIDTH;

const LINE_SPACING = 20; // px between staff lines
const STAFF_TOP = 80;    // y of the top staff line in the SVG

// Horizontal position of the note head within the staff SVG
const NOTE_X = 300;

// ─── Types ────────────────────────────────────────────────────────────────────

type Clef = 'treble' | 'bass';
type KeyColor = 'white' | 'black';
type KeyState = 'normal' | 'correct' | 'wrong';

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
  accidental: 'sharp' | null;
  ledgerLines: number[];
}

// ─── Piano Keyboard Layout ────────────────────────────────────────────────────

const OCTAVE_NOTES: { note: string; color: KeyColor; whiteIndex: number; blackOffset?: number }[] = [
  { note: 'C',  color: 'white', whiteIndex: 0 },
  { note: 'C#', color: 'black', whiteIndex: 0, blackOffset: 0.67 },
  { note: 'D',  color: 'white', whiteIndex: 1 },
  { note: 'D#', color: 'black', whiteIndex: 1, blackOffset: 1.67 },
  { note: 'E',  color: 'white', whiteIndex: 2 },
  { note: 'F',  color: 'white', whiteIndex: 3 },
  { note: 'F#', color: 'black', whiteIndex: 3, blackOffset: 3.63 },
  { note: 'G',  color: 'white', whiteIndex: 4 },
  { note: 'G#', color: 'black', whiteIndex: 4, blackOffset: 4.63 },
  { note: 'A',  color: 'white', whiteIndex: 5 },
  { note: 'A#', color: 'black', whiteIndex: 5, blackOffset: 5.63 },
  { note: 'B',  color: 'white', whiteIndex: 6 },
];

function buildKeyboard(): PianoKey[] {
  const keys: PianoKey[] = [];
  for (let octave = 2; octave <= 6; octave++) {
    const octaveStart = (octave - 2) * OCTAVE_WIDTH;
    for (const n of OCTAVE_NOTES) {
      if (octave === 6 && n.note !== 'C') continue;
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

function buildStaffNotes(): StaffNote[] {
  const notes: StaffNote[] = [];

  function addNotes(positions: Record<string, number>, clef: Clef, extraBelow = 0) {
    for (const [label, staffY] of Object.entries(positions)) {
      const match = label.match(/^([A-G])(\d)$/);
      if (!match) continue;
      const [, nat, octStr] = match;
      const octave = parseInt(octStr);
      // Natural
      notes.push({ label, note: nat, octave, clef, staffY, accidental: null,
        ledgerLines: ledgerLinesForNote(staffY, extraBelow) });
      // Sharp
      if (SHARP_NATURALS.includes(nat)) {
        const sharpLabel = `${nat}#${octStr}`;
        notes.push({ label: sharpLabel, note: `${nat}#`, octave, clef, staffY,
          accidental: 'sharp', ledgerLines: ledgerLinesForNote(staffY, extraBelow) });
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

// ─── MusicStaff Component ─────────────────────────────────────────────────────

const SVG_W = 600;
const SVG_H = 300;
const STAFF_LEFT = 50;
const STAFF_RIGHT = SVG_W - 30;
const NOTE_RX = 13;
const NOTE_RY = 9;
const STEM_LENGTH = 52;
const MIDDLE_LINE_Y = STAFF_TOP + 2 * LINE_SPACING; // B4 in treble / D3 in bass

function MusicStaff({ staffNote }: { staffNote: StaffNote }) {
  const { clef, staffY, accidental, ledgerLines } = staffNote;

  const stemUp = staffY >= MIDDLE_LINE_Y;
  const stemX = stemUp ? NOTE_X + NOTE_RX - 1 : NOTE_X - NOTE_RX + 1;
  const stemY2 = stemUp ? staffY - STEM_LENGTH : staffY + STEM_LENGTH;

  const clefGlyph = clef === 'treble' ? '\u{1D11E}' : '\u{1D122}';
  const clefY = clef === 'treble'
    ? STAFF_TOP + 4 * LINE_SPACING + 4
    : STAFF_TOP + 2 * LINE_SPACING + 8;
  const clefFontSize = clef === 'treble' ? 110 : 88;

  return (
    <svg
      width={SVG_W} height={SVG_H}
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      style={{ display: 'block', margin: '0 auto', background: '#fffef8' }}
    >
      {/* Staff lines */}
      {Array.from({ length: 5 }, (_, i) => (
        <line key={i}
          x1={STAFF_LEFT} x2={STAFF_RIGHT}
          y1={STAFF_TOP + i * LINE_SPACING} y2={STAFF_TOP + i * LINE_SPACING}
          stroke="#222" strokeWidth={2} strokeLinecap="round"
        />
      ))}

      {/* Left bar line */}
      <line
        x1={STAFF_LEFT} x2={STAFF_LEFT}
        y1={STAFF_TOP} y2={STAFF_TOP + 4 * LINE_SPACING}
        stroke="#222" strokeWidth={2.5}
      />

      {/* Clef */}
      <text x={clefY > 160 ? 62 : 62} y={clefY}
        fontSize={clefFontSize}
        fontFamily="Bravura, 'Noto Music', serif"
        fill="#222"
        style={{ userSelect: 'none' }}
      >
        {clefGlyph}
      </text>

      {/* Ledger lines */}
      {ledgerLines.map((ly) => (
        <line key={ly}
          x1={NOTE_X - 26} x2={NOTE_X + 26}
          y1={ly} y2={ly}
          stroke="#222" strokeWidth={2} strokeLinecap="round"
        />
      ))}

      {/* Accidental */}
      {accidental === 'sharp' && (
        <text x={NOTE_X - 36} y={staffY + 8}
          fontSize={30}
          fontFamily="Bravura, 'Noto Music', serif"
          fill="#222"
          style={{ userSelect: 'none' }}
        >
          ♯
        </text>
      )}

      {/* Stem */}
      <line
        x1={stemX} x2={stemX}
        y1={staffY} y2={stemY2}
        stroke="#222" strokeWidth={2.5} strokeLinecap="round"
      />

      {/* Note head */}
      <ellipse
        cx={NOTE_X} cy={staffY}
        rx={NOTE_RX} ry={NOTE_RY}
        fill="#222"
        transform={`rotate(-15, ${NOTE_X}, ${staffY})`}
      />
    </svg>
  );
}

// ─── PianoKeyboard Component ──────────────────────────────────────────────────

const KEY_COLORS: Record<KeyState, { white: string; black: string }> = {
  normal:  { white: '#ffffff', black: '#1a1a1a' },
  correct: { white: '#4caf50', black: '#2e7d32' },
  wrong:   { white: '#f44336', black: '#c62828' },
};

function PianoKeyboard({
  keyStates,
  onKeyClick,
}: {
  keyStates: Record<string, KeyState>;
  onKeyClick: (label: string) => void;
}) {
  const whiteKeys = KEYBOARD_KEYS.filter(k => k.color === 'white');
  const blackKeys = KEYBOARD_KEYS.filter(k => k.color === 'black');

  return (
    <svg
      width={KEYBOARD_WIDTH + 2}
      height={WHITE_KEY_HEIGHT + 2}
      viewBox={`0 0 ${KEYBOARD_WIDTH + 2} ${WHITE_KEY_HEIGHT + 2}`}
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
            {key.note === 'C' && (
              <text
                x={key.x + WHITE_KEY_WIDTH / 2}
                y={WHITE_KEY_HEIGHT - 12}
                textAnchor="middle"
                fontSize={11} fill="#888"
                style={{ userSelect: 'none', pointerEvents: 'none' }}
              >
                {key.label}
              </text>
            )}
          </g>
        );
      })}

      {/* Black keys (rendered on top) */}
      {blackKeys.map(key => {
        const state = keyStates[key.label] ?? 'normal';
        const fill = KEY_COLORS[state].black;
        return (
          <g key={key.label} onClick={() => onKeyClick(key.label)} style={{ cursor: 'pointer' }}>
            <rect
              x={key.x} y={0}
              width={BLACK_KEY_WIDTH} height={BLACK_KEY_HEIGHT}
              rx={2} fill={fill} stroke="#000" strokeWidth={1}
            />
          </g>
        );
      })}
    </svg>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [currentNote, setCurrentNote] = useState<StaffNote>(() => randomNote());
  const [keyStates, setKeyStates] = useState<Record<string, KeyState>>({});
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [locked, setLocked] = useState(false);

  const advanceNote = useCallback(() => {
    setCurrentNote(prev => {
      let next = randomNote();
      // Avoid repeating the same note
      while (next.label === prev.label) next = randomNote();
      return next;
    });
    setKeyStates({});
    setLocked(false);
  }, []);

  const handleKeyClick = useCallback((label: string) => {
    const isCorrect = label === currentNote.label;

    if (isCorrect) {
      if (locked) return;
      setScore(s => ({ correct: s.correct + 1, total: s.total + 1 }));
      setKeyStates({ [label]: 'correct' });
      setLocked(true);
      setTimeout(advanceNote, 1600);
    } else {
      setScore(s => ({ ...s, total: s.total + 1 }));
      setKeyStates(prev => {
        const next: Record<string, KeyState> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v === 'correct') next[k] = v;
        }
        next[label] = 'wrong';
        return next;
      });
      setTimeout(() => {
        setKeyStates(prev => {
          const next = { ...prev };
          if (next[label] === 'wrong') delete next[label];
          return next;
        });
      }, 1600);
    }
  }, [currentNote, locked, advanceNote]);

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
          <div style={{
            fontSize: 22, fontWeight: 700, color: '#333',
            background: '#fff', borderRadius: 8, padding: '6px 16px',
            boxShadow: '0 1px 6px rgba(0,0,0,0.10)',
          }}>
            {score.correct} / {score.total}
          </div>
        </div>

        {/* Keyboard */}
        <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
          <PianoKeyboard keyStates={keyStates} onKeyClick={handleKeyClick} />
        </div>

        {/* Staff */}
        <div style={{
          marginTop: 28,
          background: '#fffef8',
          borderRadius: 10,
          boxShadow: '0 2px 16px rgba(0,0,0,0.10)',
          padding: '12px 0 20px',
        }}>
          <div style={{
            textAlign: 'center', fontSize: 12, color: '#aaa',
            marginBottom: 2, textTransform: 'uppercase', letterSpacing: 1.5,
          }}>
            {currentNote.clef === 'treble' ? 'Treble Clef' : 'Bass Clef'}
          </div>
          <MusicStaff staffNote={currentNote} />
          <div style={{
            textAlign: 'center', fontSize: 13, color: '#bbb', marginTop: 8,
          }}>
            Click the matching key on the piano
          </div>
        </div>

      </div>
    </div>
  );
}
