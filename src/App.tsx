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
    </svg>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [currentNote, setCurrentNote] = useState<StaffNote>(() => randomNote());
  const [keyStates, setKeyStates] = useState<Record<string, KeyState>>({});
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const greenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyClick = useCallback((label: string) => {
    // Cancel and clear any lingering green key immediately
    if (greenTimerRef.current !== null) {
      clearTimeout(greenTimerRef.current);
      greenTimerRef.current = null;
    }

    const isCorrect = label === currentNote.keyboardLabel;

    if (isCorrect) {
      setScore(s => ({ correct: s.correct + 1, total: s.total + 1 }));
      // Advance to next note immediately
      setCurrentNote(prev => {
        let next = randomNote();
        while (next.label === prev.label) next = randomNote();
        return next;
      });
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
  }, [currentNote]);

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

        {/* Staff */}
        <div style={{
          marginTop: 28,
          background: '#fffef8',
          borderRadius: 10,
          boxShadow: '0 2px 16px rgba(0,0,0,0.10)',
          padding: '20px 0',
          overflow: 'hidden',
        }}>
          <MusicStaff staffNote={currentNote} />
          <div style={{
            textAlign: 'center', fontSize: 13, color: '#bbb', marginTop: 8,
          }}>
            Click the matching key on the piano
          </div>
        </div>

        {/* Keyboard */}
        <div style={{ overflowX: 'auto', paddingBottom: 8, marginTop: 28 }}>
          <PianoKeyboard keyStates={keyStates} onKeyClick={handleKeyClick} />
        </div>

      </div>
    </div>
  );
}
