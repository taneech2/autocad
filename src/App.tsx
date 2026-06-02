import React, { useState, useRef, useEffect } from 'react';
import { Play, Square, Circle, PenTool, MousePointer2, Move, Copy, Scissors, ChevronLeft, ChevronRight, Clock, Trophy, RotateCw, Maximize, Layers, Monitor, Crop } from 'lucide-react';
import DrawingCanvas, { type DrawingCanvasHandle } from './DrawingCanvas';
import './App.css';

type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

interface LessonParams {
  l1_startX: number; l1_startY: number; l1_w: number; l1_h: number;
  l2_startX: number; l2_startY: number; l2_dx: number; l2_dist: number; l2_ang: number;
  l3_rectX: number; l3_rectY: number; l3_rectW: number; l3_rectH: number;
  l3_circX: number; l3_circY: number; l3_circR: number;
  l4_circX: number; l4_circY: number; l4_circR: number; l4_copyDx: number;
  l5_cx: number; l5_cy: number; l5_len: number;
  l6_x: number; l6_y: number; l6_len: number; l6_ang: number;
  l7_cx: number; l7_cy: number; l7_r: number; l7_dist: number;
  l8_rectX: number; l8_rectY: number; l8_rectW: number; l8_rectH: number; l8_radius: number;
  l9_circX: number; l9_circY: number; l9_circR: number; l9_cols: number; l9_rows: number; l9_dist: number;
}

const generateRandomParams = (): LessonParams => {
  const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
  return {
    l1_startX: randInt(-5, 5), l1_startY: randInt(-5, 5), l1_w: randInt(2, 6), l1_h: randInt(2, 6),
    l2_startX: randInt(-5, 5), l2_startY: randInt(-5, 5), l2_dx: randInt(3, 8), l2_dist: randInt(3, 8), l2_ang: [45, 90, 135][randInt(0, 2)],
    l3_rectX: randInt(-8, -2), l3_rectY: randInt(0, 5), l3_rectW: randInt(2, 5), l3_rectH: randInt(2, 5),
    l3_circX: randInt(2, 8), l3_circY: randInt(0, 5), l3_circR: randInt(1, 4),
    l4_circX: randInt(-5, 5), l4_circY: randInt(-5, 5), l4_circR: randInt(1, 3), l4_copyDx: randInt(3, 7),
    l5_cx: randInt(-2, 2), l5_cy: randInt(-2, 2), l5_len: randInt(4, 6),
    l6_x: randInt(-3, 3), l6_y: randInt(-3, 3), l6_len: randInt(3, 6), l6_ang: [90, -90, 45, -45][randInt(0, 3)],
    l7_cx: randInt(-5, 5), l7_cy: randInt(-5, 5), l7_r: randInt(2, 4), l7_dist: randInt(1, 3),
    l8_rectX: randInt(-5, -2), l8_rectY: randInt(-5, -2), l8_rectW: randInt(5, 8), l8_rectH: randInt(5, 8), l8_radius: randInt(1, 2),
    l9_circX: randInt(-8, -4), l9_circY: randInt(-8, -4), l9_circR: randInt(1, 2), l9_cols: randInt(2, 4), l9_rows: randInt(2, 4), l9_dist: randInt(3, 5)
  };
};

function App() {
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string>('พิมพ์คำสั่งเพื่อเริ่มต้น... (Type a command)');
  const [commandInput, setCommandInput] = useState<string>('');
  const [history, setHistory] = useState<string[]>(['AutoCAD 2015 Interactive Learning Platform']);
  const [typedInputToProcess, setTypedInputToProcess] = useState<string | null>(null);
  const [currentLesson, setCurrentLesson] = useState<number>(1);

  const [score, setScore] = useState<number>(0);
  const [difficulty, setDifficulty] = useState<Difficulty>('EASY');
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);
  const [lessonParams, setLessonParams] = useState<LessonParams>(generateRandomParams());

  const historyEndRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  useEffect(() => {
    if (isTimerRunning && timeLeft > 0) {
      timerRef.current = window.setTimeout(() => setTimeLeft(prev => prev - 1), 1000);
    } else if (isTimerRunning && timeLeft === 0) {
      setIsTimerRunning(false);
      handleCommandComplete();
      alert("หมดเวลา! (Time's Up) ลองพยายามใหม่อีกครั้งนะครับ");
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isTimerRunning, timeLeft]);

  const startChallenge = () => {
    setLessonParams(generateRandomParams());
    setIsTimerRunning(true);
    if (difficulty === 'EASY') setTimeLeft(60);
    else if (difficulty === 'MEDIUM') setTimeLeft(40);
    else if (difficulty === 'HARD') setTimeLeft(20);
    handleCommandComplete();
  };

  const stopChallenge = () => {
    setIsTimerRunning(false);
    setTimeLeft(0);
  };

  const handleCommandClick = (cmd: string) => {
    setActiveCommand(cmd);
    setHistory(prev => [...prev, `Command: ${cmd}`]);
    setTypedInputToProcess(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.key === ' ') e.preventDefault();
      const input = commandInput.trim().toUpperCase();
      setHistory(prev => [...prev, `> ${commandInput}`]);
      setCommandInput('');

      if (!activeCommand) {
        if (input === 'L' || input === 'LINE') handleCommandClick('LINE');
        else if (input === 'C' || input === 'CIRCLE') handleCommandClick('CIRCLE');
        else if (input === 'REC' || input === 'RECTANGLE') handleCommandClick('RECTANGLE');
        else if (input === 'M' || input === 'MOVE') handleCommandClick('MOVE');
        else if (input === 'CO' || input === 'CP' || input === 'COPY') handleCommandClick('COPY');
        else if (input === 'TR' || input === 'TRIM') handleCommandClick('TRIM');
        else if (input === 'RO' || input === 'ROTATE') handleCommandClick('ROTATE');
        else if (input === 'SC' || input === 'SCALE') handleCommandClick('SCALE');
        else if (input === 'MI' || input === 'MIRROR') handleCommandClick('MIRROR');
        else if (input === 'O' || input === 'OFFSET') handleCommandClick('OFFSET');
        else if (input === 'F' || input === 'FILLET') handleCommandClick('FILLET');
        else if (input === 'CHA' || input === 'CHAMFER') handleCommandClick('CHAMFER');
        else if (input === 'AR' || input === 'ARRAY') handleCommandClick('ARRAY');
        else if (input === 'P' || input === 'PAN') handleCommandClick('PAN');
        else if (input !== '') setPrompt(`Unknown command "${input}". Press F1 for help.`);
      } else {
        if (input === '') setTypedInputToProcess('ENTER_KEY');
        else setTypedInputToProcess(commandInput.trim());
      }
    } else if (e.key === 'Escape') {
      handleCommandComplete();
    }
  };

  const handleCommandComplete = () => {
    setActiveCommand(null);
    setTypedInputToProcess(null);
    setHistory(prev => [...prev, 'Command canceled or completed.']);
  };

  const verifyLesson = () => {
    if (!canvasRef.current) return;
    if (!isTimerRunning) {
      alert("กรุณากด 'เริ่มจับเวลา' เพื่อรับโจทย์ใหม่และทำภารกิจก่อนตรวจคำตอบครับ!");
      return;
    }

    const entities = canvasRef.current.getEntities();
    let passed = false;
    
    if (currentLesson === 1) {
      const lines = entities.filter(e => e.type === 'LINE');
      if (lines.length >= 4) passed = true;
    } else if (currentLesson === 2) {
      const lines = entities.filter(e => e.type === 'LINE');
      if (lines.length >= 3) passed = true;
    } else if (currentLesson === 3) {
      const rects = entities.filter(e => e.type === 'RECTANGLE');
      const circles = entities.filter(e => e.type === 'CIRCLE');
      if (rects.length >= 1 && circles.length >= 1) passed = true;
    } else if (currentLesson === 4) {
      const circles = entities.filter(e => e.type === 'CIRCLE');
      if (circles.length >= 2) passed = true;
    } else if (currentLesson === 5) {
      const lines = entities.filter(e => e.type === 'LINE') as any[];
      const totalLen = lines.reduce((acc, l) => {
         const dx = l.start.x - l.end.x;
         const dy = l.start.y - l.end.y;
         return acc + Math.sqrt(dx*dx + dy*dy);
      }, 0);
      if (lines.length >= 2 && Math.abs(totalLen - (1.5 * lessonParams.l5_len)) < 0.5) passed = true;
    } else if (currentLesson === 6) {
      const lines = entities.filter(e => e.type === 'LINE') as any[];
      if (lines.length === 1) {
         const l = lines[0];
         const dx = l.end.x - l.start.x;
         const dy = l.end.y - l.start.y;
         const len = Math.sqrt(dx*dx + dy*dy);
         const ang = Math.atan2(dy, dx) * (180 / Math.PI);
         let targetAng = lessonParams.l6_ang;
         if (targetAng < -180) targetAng += 360;
         if (targetAng > 180) targetAng -= 360;
         let actualAng = ang;
         if (actualAng < -180) actualAng += 360;
         if (actualAng > 180) actualAng -= 360;
         if (Math.abs(l.start.x - lessonParams.l6_x) < 0.1 && Math.abs(l.start.y - lessonParams.l6_y) < 0.1 && Math.abs(len - lessonParams.l6_len) < 0.1 && Math.abs(actualAng - targetAng) < 1) {
            passed = true;
         }
      }
    } else if (currentLesson === 7) {
      const circles = entities.filter(e => e.type === 'CIRCLE') as any[];
      if (circles.length >= 2) {
         const hasOriginal = circles.some(c => Math.abs(c.radius - lessonParams.l7_r) < 0.1);
         const hasOffset = circles.some(c => Math.abs(c.radius - (lessonParams.l7_r + lessonParams.l7_dist)) < 0.1);
         if (hasOriginal && hasOffset) passed = true;
      }
    } else if (currentLesson === 8) {
      const rects = entities.filter(e => e.type === 'RECTANGLE') as any[];
      if (rects.length >= 1) {
         const r = rects[0];
         if (r.filletRadius && Math.abs(r.filletRadius - lessonParams.l8_radius) < 0.1) passed = true;
      }
    } else if (currentLesson === 9) {
      const circles = entities.filter(e => e.type === 'CIRCLE') as any[];
      if (circles.length >= lessonParams.l9_cols * lessonParams.l9_rows) passed = true;
    }

    if (passed) {
      const points = difficulty === 'EASY' ? 10 : (difficulty === 'MEDIUM' ? 20 : 30);
      setScore(prev => prev + points);
      setIsTimerRunning(false);
      alert(`ยอดเยี่ยม! ภารกิจสำเร็จ คุณได้รับ ${points} คะแนน (เหลือเวลา ${timeLeft} วินาที)`);
      if (currentLesson < 9) setCurrentLesson(c => c + 1);
    } else {
      alert("ยังไม่ถูกต้อง ลองตรวจสอบพิกัดและวาดตามโจทย์ให้ครบถ้วนดูอีกครั้งนะครับ");
    }
  };

  return (
    <div className="app-container">
      <header className="ribbon" style={{ borderBottom: 'none' }}>
        <div className="ribbon-group">
          <button className={`ribbon-button ${activeCommand === 'LINE' ? 'active' : ''}`} onClick={() => handleCommandClick('LINE')}>
            <PenTool size={20} /><span>Line</span>
          </button>
          <button className={`ribbon-button ${activeCommand === 'RECTANGLE' ? 'active' : ''}`} onClick={() => handleCommandClick('RECTANGLE')}>
            <Square size={20} /><span>Rectangle</span>
          </button>
          <button className={`ribbon-button ${activeCommand === 'CIRCLE' ? 'active' : ''}`} onClick={() => handleCommandClick('CIRCLE')}>
            <Circle size={20} /><span>Circle</span>
          </button>
        </div>
        <div className="ribbon-group">
          <button className={`ribbon-button ${activeCommand === 'MOVE' ? 'active' : ''}`} onClick={() => handleCommandClick('MOVE')}>
            <Move size={20} /><span>Move</span>
          </button>
          <button className={`ribbon-button ${activeCommand === 'COPY' ? 'active' : ''}`} onClick={() => handleCommandClick('COPY')}>
            <Copy size={20} /><span>Copy</span>
          </button>
          <button className={`ribbon-button ${activeCommand === 'TRIM' ? 'active' : ''}`} onClick={() => handleCommandClick('TRIM')}>
            <Scissors size={20} /><span>Trim</span>
          </button>
        </div>
        <div className="ribbon-group">
          <button className={`ribbon-button ${activeCommand === 'MIRROR' ? 'active' : ''}`} onClick={() => handleCommandClick('MIRROR')}>
            <Monitor size={20} /><span>Mirror</span>
          </button>
          <button className={`ribbon-button ${activeCommand === 'OFFSET' ? 'active' : ''}`} onClick={() => handleCommandClick('OFFSET')}>
            <Layers size={20} /><span>Offset</span>
          </button>
          <button className={`ribbon-button ${activeCommand === 'FILLET' ? 'active' : ''}`} onClick={() => handleCommandClick('FILLET')}>
            <Crop size={20} /><span>Fillet</span>
          </button>
          <button className={`ribbon-button ${activeCommand === 'CHAMFER' ? 'active' : ''}`} onClick={() => handleCommandClick('CHAMFER')}>
            <Square size={20} /><span>Chamfer</span>
          </button>
          <button className={`ribbon-button ${activeCommand === 'ARRAY' ? 'active' : ''}`} onClick={() => handleCommandClick('ARRAY')}>
            <Copy size={20} /><span>Array</span>
          </button>
        </div>
        <div className="ribbon-group">
          <button className={`ribbon-button ${activeCommand === 'ROTATE' ? 'active' : ''}`} onClick={() => handleCommandClick('ROTATE')}>
            <RotateCw size={20} /><span>Rotate</span>
          </button>
          <button className={`ribbon-button ${activeCommand === 'SCALE' ? 'active' : ''}`} onClick={() => handleCommandClick('SCALE')}>
            <Maximize size={20} /><span>Scale</span>
          </button>
          <button className={`ribbon-button ${activeCommand === 'PAN' ? 'active' : ''}`} onClick={() => handleCommandClick('PAN')}>
            <MousePointer2 size={20} /><span>Pan</span>
          </button>
        </div>
      </header>

      <div className="dashboard">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Trophy size={20} color="#f1c40f" />
          <span className="score-display">คะแนน: {score}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className={`timer-display ${(isTimerRunning && timeLeft <= 10) ? 'warning' : ''}`}>
            <Clock size={16} style={{ verticalAlign: 'middle', marginRight: '5px' }} />
            {timeLeft} วิ
          </span>
        </div>
      </div>

      <div className="main-content">
        <aside className="sidebar">
          <div className="sidebar-header">
            <button onClick={() => { setCurrentLesson(Math.max(1, currentLesson - 1)); stopChallenge(); }} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}><ChevronLeft size={18} /></button>
            <span>บทเรียน (Lesson {currentLesson}/9)</span>
            <button onClick={() => { setCurrentLesson(Math.min(9, currentLesson + 1)); stopChallenge(); }} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}><ChevronRight size={18} /></button>
          </div>
          
          <div className="sidebar-content">
            <div className="difficulty-selector">
              <button className={`diff-btn ${difficulty === 'EASY' ? 'active' : ''}`} onClick={() => setDifficulty('EASY')} disabled={isTimerRunning}>ง่าย (60s)</button>
              <button className={`diff-btn ${difficulty === 'MEDIUM' ? 'active' : ''}`} onClick={() => setDifficulty('MEDIUM')} disabled={isTimerRunning}>กลาง (40s)</button>
              <button className={`diff-btn ${difficulty === 'HARD' ? 'active' : ''}`} onClick={() => setDifficulty('HARD')} disabled={isTimerRunning}>ยาก (20s)</button>
            </div>
            
            <button className="start-challenge-btn" onClick={startChallenge} disabled={isTimerRunning}>
              <Play size={18} /> {isTimerRunning ? 'กำลังจับเวลา...' : 'เริ่มจับเวลารับโจทย์ (Start)'}
            </button>

            {currentLesson === 1 && (
              <>
                <h3>บทที่ 1: การวาดเส้นพื้นฐาน</h3>
                <p>เรียนรู้การใช้คำสั่ง <strong>LINE</strong> หรือ <strong>L</strong> ตามพิกัดสัมบูรณ์ (Absolute) เพื่อวาดกล่องสี่เหลี่ยม</p>
                <ol>
                  <li>พิมพ์ <code>L</code> แล้วกด Enter</li>
                  <li><i>first point:</i> พิมพ์ <code>{lessonParams.l1_startX},{lessonParams.l1_startY}</code></li>
                  <li><i>next point:</i> พิมพ์ <code>{lessonParams.l1_startX + lessonParams.l1_w},{lessonParams.l1_startY}</code></li>
                  <li><i>next point:</i> พิมพ์ <code>{lessonParams.l1_startX + lessonParams.l1_w},{lessonParams.l1_startY + lessonParams.l1_h}</code></li>
                  <li><i>next point:</i> พิมพ์ <code>{lessonParams.l1_startX},{lessonParams.l1_startY + lessonParams.l1_h}</code></li>
                  <li><i>next point:</i> พิมพ์ <code>{lessonParams.l1_startX},{lessonParams.l1_startY}</code></li>
                  <li>กด <code>Enter</code> จบคำสั่ง</li>
                </ol>
              </>
            )}

            {currentLesson === 2 && (
              <>
                <h3>บทที่ 2: พิกัดสัมพัทธ์และเชิงมุม</h3>
                <p>เรียนรู้การใช้ <code>@</code> เพื่ออ้างอิงจากจุดเดิม และใช้ <strong>U (Undo)</strong> / <strong>C (Close)</strong></p>
                <ol>
                  <li>พิมพ์ <code>L</code> แล้วกด Enter</li>
                  <li>พิมพ์ <code>{lessonParams.l2_startX},{lessonParams.l2_startY}</code> กด Enter</li>
                  <li>พิมพ์ <code>@{lessonParams.l2_dx},0</code> กด Enter</li>
                  <li>พิมพ์ <code>@{lessonParams.l2_dist}&lt;90</code> กด Enter</li>
                  <li>พิมพ์ <code>U</code> กด Enter (ยกเลิกเส้นล่าสุด)</li>
                  <li>พิมพ์ <code>@{lessonParams.l2_dist}&lt;{lessonParams.l2_ang}</code> กด Enter</li>
                  <li>พิมพ์ <code>C</code> กด Enter เพื่อปิดรูปทรง!</li>
                </ol>
              </>
            )}

            {currentLesson === 3 && (
              <>
                <h3>บทที่ 3: รูปทรงพื้นฐาน</h3>
                <p>เรียนรู้คำสั่ง <strong>REC</strong> (Rectangle) และ <strong>C</strong> (Circle)</p>
                <ol>
                  <li><strong>วาดสี่เหลี่ยม:</strong> พิมพ์ <code>REC</code></li>
                  <li><i>first corner:</i> พิมพ์ <code>{lessonParams.l3_rectX},{lessonParams.l3_rectY}</code></li>
                  <li><i>other corner:</i> พิมพ์ <code>@{lessonParams.l3_rectW},{lessonParams.l3_rectH}</code></li>
                  <hr style={{ margin: '10px 0', borderColor: 'var(--border-color)' }}/>
                  <li><strong>วาดวงกลม:</strong> พิมพ์ <code>C</code></li>
                  <li><i>center point:</i> พิมพ์ <code>{lessonParams.l3_circX},{lessonParams.l3_circY}</code></li>
                  <li><i>radius:</i> พิมพ์ <code>{lessonParams.l3_circR}</code></li>
                </ol>
              </>
            )}

            {currentLesson === 4 && (
              <>
                <h3>บทที่ 4: การเลือกวัตถุและ OSNAP</h3>
                <p>เรียนรู้ <strong>MOVE</strong> และ <strong>COPY</strong> ร่วมกับ <strong>OSNAP</strong></p>
                <ol>
                  <li>พิมพ์ <code>C</code> สร้างวงกลมที่พิกัด <code>{lessonParams.l4_circX},{lessonParams.l4_circY}</code> รัศมี <code>{lessonParams.l4_circR}</code></li>
                  <li>พิมพ์ <code>COPY</code> (คัดลอก)</li>
                  <li>คลิกที่เส้นวงกลมที่วาด แล้วกด <code>Enter</code></li>
                  <li><i>base point:</i> ใช้เมาส์คลิกดูดจุดกึ่งกลางวงกลม (OSNAP)</li>
                  <li><i>second point:</i> พิมพ์ <code>@{lessonParams.l4_copyDx},0</code> กด Enter</li>
                </ol>
              </>
            )}

            {currentLesson === 5 && (
              <>
                <h3>บทที่ 5: การตัดเส้น (TRIM)</h3>
                <p>สร้างกากบาทและใช้ <strong>TRIM</strong> ตัดเส้นส่วนเกินทิ้ง</p>
                <ol>
                  <li>วาดเส้นนอน: พิมพ์ <code>L</code> -&gt; <code>{lessonParams.l5_cx - lessonParams.l5_len/2},{lessonParams.l5_cy}</code> -&gt; <code>@{lessonParams.l5_len},0</code> -&gt; Enter</li>
                  <li>วาดเส้นตั้ง: พิมพ์ <code>L</code> -&gt; <code>{lessonParams.l5_cx},{lessonParams.l5_cy - lessonParams.l5_len/2}</code> -&gt; <code>@0,{lessonParams.l5_len}</code> -&gt; Enter</li>
                  <li>พิมพ์ <code>TRIM</code> กด Enter (คุณจะเห็นกากบาท)</li>
                  <li><i>Select object:</i> นำเมาส์ไป <strong>คลิกที่เส้นตั้ง "ท่อนบน"</strong> เพื่อลบมันทิ้ง (ระบบจะหาจุดตัดกึ่งกลางให้อัตโนมัติ!)</li>
                </ol>
              </>
            )}

            {currentLesson === 6 && (
              <>
                <h3>บทที่ 6: การหมุนและการย่อขยาย</h3>
                <p>เรียนรู้คำสั่ง <strong>ROTATE</strong> และ <strong>SCALE</strong></p>
                <ol>
                  <li>พิมพ์ <code>L</code> วาดเส้นจาก <code>{lessonParams.l6_x},{lessonParams.l6_y}</code> ไปทางขวา <code>@{lessonParams.l6_len},0</code></li>
                  <li>พิมพ์ <code>RO</code> (ROTATE) แล้วกด Enter</li>
                  <li>คลิกเลือกเส้นที่วาด แล้วกด Enter</li>
                  <li><i>Base point:</i> ใช้เมาส์ดูดจุดปลายทางซ้าย (จุดเริ่มต้น)</li>
                  <li><i>Rotation angle:</i> พิมพ์ <code>{lessonParams.l6_ang}</code> แล้วกด Enter เพื่อหมุน</li>
                </ol>
              </>
            )}

            {currentLesson === 7 && (
              <>
                <h3>บทที่ 7: การคัดลอกแบบสมมาตรและเส้นขนาน</h3>
                <p>เรียนรู้คำสั่ง <strong>MIRROR</strong> (สะท้อน) และ <strong>OFFSET</strong> (สร้างเส้นคู่ขนาน)</p>
                <ol>
                  <li>พิมพ์ <code>C</code> สร้างวงกลมที่ <code>{lessonParams.l7_cx},{lessonParams.l7_cy}</code> รัศมี <code>{lessonParams.l7_r}</code></li>
                  <li>พิมพ์ <code>O</code> (OFFSET) หรือคลิกปุ่ม Offset</li>
                  <li>พิมพ์ระยะห่าง <code>{lessonParams.l7_dist}</code> แล้วกด Enter</li>
                  <li>คลิกที่เส้นขอบวงกลม แล้วเลื่อนเมาส์ออกมาคลิกด้านนอกวงกลม</li>
                  <li>ระบบจะสร้างวงกลมใหม่ที่ขยายใหญ่ขึ้น (รัศมี {lessonParams.l7_r + lessonParams.l7_dist})</li>
                </ol>
              </>
            )}

            {currentLesson === 8 && (
              <>
                <h3>บทที่ 8: การลบมุมโค้งและตัดมุม (FILLET & CHAMFER)</h3>
                <p>เรียนรู้การตกแต่งมุมของวัตถุด้วย <strong>FILLET</strong> (มุมโค้ง) และ <strong>CHAMFER</strong> (มุมเหลี่ยม)</p>
                <ol>
                  <li>พิมพ์ <code>REC</code> สร้างสี่เหลี่ยม <code>{lessonParams.l8_rectX},{lessonParams.l8_rectY}</code> ขนาด <code>@{lessonParams.l8_rectW},{lessonParams.l8_rectH}</code></li>
                  <li>พิมพ์ <code>F</code> (FILLET) หรือคลิกปุ่ม Fillet</li>
                  <li>ระบบจะถามระยะ รัศมี (Radius) ให้พิมพ์ <code>{lessonParams.l8_radius}</code> แล้วกด Enter</li>
                  <li>นำเมาส์ไปคลิกที่เส้นขอบของสี่เหลี่ยม เพื่อลบมุมโค้งทุกมุมพร้อมกัน!</li>
                </ol>
              </>
            )}

            {currentLesson === 9 && (
              <>
                <h3>บทที่ 9: การคัดลอกแบบจัดเรียง (ARRAY)</h3>
                <p>สร้างสำเนาวัตถุจำนวนมากอย่างเป็นระเบียบด้วย <strong>ARRAY</strong></p>
                <ol>
                  <li>พิมพ์ <code>C</code> สร้างวงกลมที่ <code>{lessonParams.l9_circX},{lessonParams.l9_circY}</code> รัศมี <code>{lessonParams.l9_circR}</code></li>
                  <li>พิมพ์ <code>AR</code> (ARRAY) แล้วคลิกเลือกวงกลม กด Enter</li>
                  <li>พิมพ์ <code>R</code> เพื่อเลือกแบบ Rectangular (ตาราง) กด Enter</li>
                  <li>พิมพ์จำนวนคอลัมน์ <code>{lessonParams.l9_cols}</code> และ จำนวนแถว <code>{lessonParams.l9_rows}</code></li>
                  <li>พิมพ์ระยะห่างคอลัมน์และแถว อย่างละ <code>{lessonParams.l9_dist}</code> กด Enter</li>
                  <li>ระบบจะสร้างวงกลมทั้งหมด {lessonParams.l9_cols * lessonParams.l9_rows} วงเรียงกัน!</li>
                </ol>
              </>
            )}

            <button onClick={verifyLesson} disabled={!isTimerRunning} style={{
              marginTop: '15px', padding: '10px 16px', 
              backgroundColor: isTimerRunning ? 'var(--accent)' : '#555', 
              color: 'white', border: 'none', borderRadius: '4px', cursor: isTimerRunning ? 'pointer' : 'not-allowed',
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              ส่งคำตอบ (Verify)
            </button>
          </div>
        </aside>

        <main className="canvas-container">
          <DrawingCanvas 
            ref={canvasRef}
            activeCommand={activeCommand} 
            typedInput={typedInputToProcess}
            onCommandComplete={handleCommandComplete} 
            onPromptChange={setPrompt}
            onInputProcessed={() => setTypedInputToProcess(null)}
          />
        </main>
      </div>

      <footer className="command-line">
        <div className="command-history">
          {history.map((msg, idx) => <div key={idx}>{msg}</div>)}
          <div ref={historyEndRef} />
        </div>
        <div className="command-input-container">
          <span className="command-prompt">{prompt}</span>
          <input 
            type="text" 
            className="command-input" 
            autoFocus
            value={commandInput}
            onChange={e => setCommandInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
      </footer>
    </div>
  );
}

export default App;
