import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import type { MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from 'react';
import { parseCoordinate } from './CommandEngine';

export interface Point { x: number; y: number; }
export interface BaseEntity { id: string; }
export interface Line extends BaseEntity { type: 'LINE'; start: Point; end: Point; }
export interface Circle extends BaseEntity { type: 'CIRCLE'; center: Point; radius: number; }
export interface Rectangle extends BaseEntity { type: 'RECTANGLE'; p1: Point; p2: Point; }
export type Entity = Line | Circle | Rectangle;

interface DrawingCanvasProps {
  activeCommand: string | null;
  typedInput: string | null;
  onCommandComplete: () => void;
  onPromptChange: (prompt: string) => void;
  onInputProcessed: () => void;
}

export interface DrawingCanvasHandle {
  getEntities: () => Entity[];
}

// Math utils
const distance = (p1: Point, p2: Point) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));

const distanceToLineSegment = (p: Point, v: Point, w: Point) => {
  const l2 = Math.pow(distance(v, w), 2);
  if (l2 === 0) return distance(p, v);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return distance(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
};

const getLineSegmentIntersection = (p1: Point, p2: Point, p3: Point, p4: Point): Point | null => {
  const c2x = p3.x - p4.x;
  const c3x = p1.x - p2.x;
  const c2y = p3.y - p4.y;
  const c3y = p1.y - p2.y;
  const d  = c3x * c2y - c3y * c2x;

  if (d === 0) return null; // parallel

  const u1 = p1.x * p2.y - p1.y * p2.x;
  const u4 = p3.x * p4.y - p3.y * p4.x;
  const px = (u1 * c2x - c3x * u4) / d;
  const py = (u1 * c2y - c3y * u4) / d;
  
  const p = { x: px, y: py };

  // check if p is on both segments (with slight tolerance)
  const tol = 1e-5;
  if (px >= Math.min(p1.x, p2.x) - tol && px <= Math.max(p1.x, p2.x) + tol &&
      py >= Math.min(p1.y, p2.y) - tol && py <= Math.max(p1.y, p2.y) + tol &&
      px >= Math.min(p3.x, p4.x) - tol && px <= Math.max(p3.x, p4.x) + tol &&
      py >= Math.min(p3.y, p4.y) - tol && py <= Math.max(p3.y, p4.y) + tol) {
    return p;
  }
  return null;
};

const generateId = () => Math.random().toString(36).substr(2, 9);

// Math helpers
const rotatePoint = (pt: Point, origin: Point, angleDeg: number): Point => {
  const rad = angleDeg * (Math.PI / 180);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = pt.x - origin.x;
  const dy = pt.y - origin.y;
  return {
    x: origin.x + (dx * cos - dy * sin),
    y: origin.y + (dx * sin + dy * cos)
  };
};

const scalePoint = (pt: Point, origin: Point, factor: number): Point => {
  return {
    x: origin.x + (pt.x - origin.x) * factor,
    y: origin.y + (pt.y - origin.y) * factor
  };
};

const mirrorPoint = (pt: Point, p1: Point, p2: Point): Point => {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  if (dx === 0 && dy === 0) return pt;
  const a = (dx * dx - dy * dy) / (dx * dx + dy * dy);
  const b = 2 * dx * dy / (dx * dx + dy * dy);
  return {
    x: a * (pt.x - p1.x) + b * (pt.y - p1.y) + p1.x,
    y: b * (pt.x - p1.x) - a * (pt.y - p1.y) + p1.y
  };
};

const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(({ 
  activeCommand, 
  typedInput,
  onCommandComplete,
  onPromptChange,
  onInputProcessed
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Viewport state
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(20); 
  const [isPanning, setIsPanning] = useState(false);
  const [lastMousePos, setLastMousePos] = useState<Point>({ x: 0, y: 0 });

  // Drawing state
  const [entities, setEntities] = useState<Entity[]>([]);
  const [cursorPos, setCursorPos] = useState<Point>({ x: 0, y: 0 });
  
  // OSNAP state
  const [snapPoint, setSnapPoint] = useState<{point: Point, type: 'endpoint'|'center'} | null>(null);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Command state
  const [commandStep, setCommandStep] = useState<number>(0);
  const [tempPoints, setTempPoints] = useState<Point[]>([]);

  useImperativeHandle(ref, () => ({
    getEntities: () => entities,
  }));

  // Update prompt based on command state
  useEffect(() => {
    if (!activeCommand) {
      onPromptChange('พิมพ์คำสั่งเพื่อเริ่มต้น... (Type a command)');
      setCommandStep(0);
      setTempPoints([]);
      setSelectedIds(new Set());
      return;
    }

    if (activeCommand === 'LINE') {
      if (commandStep === 0) onPromptChange('LINE Specify first point:');
      else if (commandStep === 1) onPromptChange('LINE Specify next point or [Undo/Close]:');
    } else if (activeCommand === 'RECTANGLE') {
      if (commandStep === 0) onPromptChange('RECTANGLE Specify first corner point:');
      else if (commandStep === 1) onPromptChange('RECTANGLE Specify other corner point:');
    } else if (activeCommand === 'CIRCLE') {
      if (commandStep === 0) onPromptChange('CIRCLE Specify center point for circle:');
      else if (commandStep === 1) onPromptChange('CIRCLE Specify radius of circle:');
    } else if (activeCommand === 'MOVE' || activeCommand === 'COPY') {
      if (commandStep === 0) onPromptChange(`${activeCommand} Select objects: (${selectedIds.size} found) [Press Enter to continue]`);
      else if (commandStep === 1) onPromptChange(`${activeCommand} Specify base point:`);
      else if (commandStep === 2) onPromptChange(`${activeCommand} Specify second point of displacement:`);
    } else if (activeCommand === 'TRIM') {
      onPromptChange('TRIM Select object to trim (Line only):');
    } else if (activeCommand === 'ROTATE' || activeCommand === 'SCALE' || activeCommand === 'MIRROR') {
      if (commandStep === 0) onPromptChange(`${activeCommand} Select objects: (${selectedIds.size} found) [Press Enter to continue]`);
      else if (commandStep === 1) onPromptChange(`${activeCommand} Specify first point of mirror line / base point:`);
      else if (commandStep === 2) onPromptChange(`${activeCommand} Specify second point / factor / angle:`);
    } else if (activeCommand === 'OFFSET') {
      if (commandStep === 0) onPromptChange(`OFFSET Specify offset distance:`);
      else if (commandStep === 1) onPromptChange(`OFFSET Select object to offset:`);
    }
  }, [activeCommand, commandStep, selectedIds.size, onPromptChange]);

  // Process typed input
  useEffect(() => {
    if (typedInput && activeCommand) {
      if (typedInput === 'ENTER_KEY') {
        if ((activeCommand === 'MOVE' || activeCommand === 'COPY' || activeCommand === 'ROTATE' || activeCommand === 'SCALE' || activeCommand === 'MIRROR') && commandStep === 0) {
          if (selectedIds.size > 0) setCommandStep(1);
        } else if (activeCommand === 'LINE' && commandStep === 1) {
          onCommandComplete();
        } else if (activeCommand === 'TRIM') {
          onCommandComplete();
        }
        onInputProcessed();
        return;
      }

      const lastPoint = tempPoints.length > 0 ? tempPoints[tempPoints.length - 1] : undefined;
      const parsed = parseCoordinate(typedInput, lastPoint);
      
      if (parsed !== null) {
        handleCommandInput(parsed);
      } else {
        onPromptChange(`Invalid input: ${typedInput}`);
        setTimeout(() => setCommandStep(s => s), 2000);
      }
      onInputProcessed();
    }
  }, [typedInput]);

  // Find OSNAP
  const calculateSnap = (worldPos: Point) => {
    const snapDistance = 15 / zoom; 
    let bestSnap: {point: Point, type: 'endpoint'|'center'} | null = null;
    let minDist = snapDistance;

    entities.forEach(entity => {
      if (entity.type === 'LINE') {
        const d1 = distance(worldPos, entity.start);
        if (d1 < minDist) { minDist = d1; bestSnap = { point: entity.start, type: 'endpoint' }; }
        const d2 = distance(worldPos, entity.end);
        if (d2 < minDist) { minDist = d2; bestSnap = { point: entity.end, type: 'endpoint' }; }
      } else if (entity.type === 'RECTANGLE') {
        const pts = [
          entity.p1, entity.p2, 
          { x: entity.p1.x, y: entity.p2.y }, 
          { x: entity.p2.x, y: entity.p1.y }
        ];
        pts.forEach(pt => {
          const d = distance(worldPos, pt);
          if (d < minDist) { minDist = d; bestSnap = { point: pt, type: 'endpoint' }; }
        });
      } else if (entity.type === 'CIRCLE') {
        const d = distance(worldPos, entity.center);
        if (d < minDist) { minDist = d; bestSnap = { point: entity.center, type: 'center' }; }
      }
    });

    setSnapPoint(bestSnap);
    const bs = bestSnap as {point: Point, type: 'endpoint'|'center'} | null;
    return bs ? bs.point : worldPos;
  };

  // Hit testing
  const hitTest = (worldPos: Point): string | null => {
    const pickDistance = 10 / zoom;
    let bestEntityId: string | null = null;
    let minDist = pickDistance;

    entities.forEach(entity => {
      if (entity.type === 'LINE') {
        const d = distanceToLineSegment(worldPos, entity.start, entity.end);
        if (d < minDist) { minDist = d; bestEntityId = entity.id; }
      } else if (entity.type === 'CIRCLE') {
        const d = Math.abs(distance(worldPos, entity.center) - entity.radius);
        if (d < minDist) { minDist = d; bestEntityId = entity.id; }
      } else if (entity.type === 'RECTANGLE') {
        const { p1, p2 } = entity;
        const pts = [p1, {x: p1.x, y: p2.y}, p2, {x: p2.x, y: p1.y}, p1];
        for (let i=0; i<4; i++) {
          const d = distanceToLineSegment(worldPos, pts[i], pts[i+1]);
          if (d < minDist) { minDist = d; bestEntityId = entity.id; }
        }
      }
    });
    return bestEntityId;
  };

  const getEntitySegments = (entity: Entity): {p1: Point, p2: Point}[] => {
    if (entity.type === 'LINE') return [{p1: entity.start, p2: entity.end}];
    if (entity.type === 'RECTANGLE') {
      const {p1, p2} = entity;
      return [
        {p1: p1, p2: {x: p1.x, y: p2.y}},
        {p1: {x: p1.x, y: p2.y}, p2: p2},
        {p1: p2, p2: {x: p2.x, y: p1.y}},
        {p1: {x: p2.x, y: p1.y}, p2: p1}
      ];
    }
    return [];
  };

  const executeTrim = (targetId: string, clickPos: Point) => {
    const targetEntity = entities.find(e => e.id === targetId);
    if (!targetEntity || targetEntity.type !== 'LINE') return; // Only support trimming lines for now

    // Find all intersections
    const intersections: Point[] = [];
    entities.forEach(other => {
      if (other.id === targetId) return;
      const segments = getEntitySegments(other);
      segments.forEach(seg => {
        const pt = getLineSegmentIntersection(targetEntity.start, targetEntity.end, seg.p1, seg.p2);
        if (pt) intersections.push(pt);
      });
    });

    // Remove duplicate intersections
    const uniqueIntersections = intersections.filter((pt, index, self) =>
      index === self.findIndex((t) => (Math.abs(t.x - pt.x) < 1e-4 && Math.abs(t.y - pt.y) < 1e-4))
    );

    // Build points array starting from line start to line end
    let pts = [targetEntity.start, ...uniqueIntersections, targetEntity.end];
    pts.sort((a, b) => distance(targetEntity.start, a) - distance(targetEntity.start, b));

    // Find which segment was clicked
    let clickedIndex = -1;
    let minDist = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = distanceToLineSegment(clickPos, pts[i], pts[i+1]);
      if (d < minDist) {
        minDist = d;
        clickedIndex = i;
      }
    }

    if (clickedIndex >= 0) {
      setEntities(prev => {
        const next = prev.filter(e => e.id !== targetId); // remove original
        // Add all segments except the clicked one
        for (let i = 0; i < pts.length - 1; i++) {
          if (i !== clickedIndex) {
            // Only add if segment has length
            if (distance(pts[i], pts[i+1]) > 1e-4) {
              next.push({ id: generateId(), type: 'LINE', start: pts[i], end: pts[i+1] });
            }
          }
        }
        return next;
      });
    }
  };

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
        render();
      }
    };
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    function drawEntity(ctx: CanvasRenderingContext2D, entity: Entity, isSelected: boolean, isPreview: boolean = false) {
      if (isSelected) {
        ctx.strokeStyle = '#005f9e'; 
        ctx.lineWidth = 2 / zoom;
        ctx.setLineDash([5/zoom, 5/zoom]);
      } else {
        ctx.strokeStyle = isPreview ? 'rgba(255, 255, 255, 0.5)' : 'white';
        ctx.lineWidth = 1 / zoom;
        ctx.setLineDash(isPreview ? [5/zoom, 5/zoom] : []);
      }

      if (entity.type === 'LINE') {
        ctx.beginPath();
        ctx.moveTo(entity.start.x, entity.start.y);
        ctx.lineTo(entity.end.x, entity.end.y);
        ctx.stroke();
      } else if (entity.type === 'RECTANGLE') {
        ctx.beginPath();
        const width = entity.p2.x - entity.p1.x;
        const height = entity.p2.y - entity.p1.y;
        ctx.rect(entity.p1.x, entity.p1.y, width, height);
        ctx.stroke();
      } else if (entity.type === 'CIRCLE') {
        ctx.beginPath();
        ctx.arc(entity.center.x, entity.center.y, entity.radius, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.setLineDash([]); 
    }

    function render() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      
      ctx.translate(canvas.width / 2 + pan.x, canvas.height / 2 + pan.y);
      ctx.scale(zoom, -zoom);

      drawGrid(ctx);

      entities.forEach(entity => {
        drawEntity(ctx, entity, selectedIds.has(entity.id));
      });

      if (activeCommand === 'LINE' && commandStep === 1 && tempPoints.length > 0) {
        drawEntity(ctx, { id: 'temp', type: 'LINE', start: tempPoints[tempPoints.length - 1], end: cursorPos }, false, true);
      } else if (activeCommand === 'RECTANGLE' && commandStep === 1 && tempPoints.length > 0) {
        drawEntity(ctx, { id: 'temp', type: 'RECTANGLE', p1: tempPoints[0], p2: cursorPos }, false, true);
      } else if (activeCommand === 'CIRCLE' && commandStep === 1 && tempPoints.length > 0) {
        const r = distance(tempPoints[0], cursorPos);
        drawEntity(ctx, { id: 'temp', type: 'CIRCLE', center: tempPoints[0], radius: r }, false, true);
      } else if ((activeCommand === 'MOVE' || activeCommand === 'COPY') && commandStep === 2 && tempPoints.length > 0) {
        const dx = cursorPos.x - tempPoints[0].x;
        const dy = cursorPos.y - tempPoints[0].y;
        
        entities.filter(e => selectedIds.has(e.id)).forEach(entity => {
          if (entity.type === 'LINE') drawEntity(ctx, { ...entity, start: {x: entity.start.x + dx, y: entity.start.y + dy}, end: {x: entity.end.x + dx, y: entity.end.y + dy} }, false, true);
          else if (entity.type === 'CIRCLE') drawEntity(ctx, { ...entity, center: {x: entity.center.x + dx, y: entity.center.y + dy} }, false, true);
          else if (entity.type === 'RECTANGLE') drawEntity(ctx, { ...entity, p1: {x: entity.p1.x + dx, y: entity.p1.y + dy}, p2: {x: entity.p2.x + dx, y: entity.p2.y + dy} }, false, true);
        });
      } else if (commandStep === 2 && tempPoints.length > 0) {
         const origin = tempPoints[0];
         if (activeCommand === 'ROTATE') {
           const angle = Math.atan2(cursorPos.y - origin.y, cursorPos.x - origin.x) * (180 / Math.PI);
           ctx.globalAlpha = 0.5;
           entities.forEach(entity => {
              if (selectedIds.has(entity.id)) {
                 ctx.beginPath();
                 if (entity.type === 'LINE') {
                   const s = rotatePoint(entity.start, origin, angle);
                   const e = rotatePoint(entity.end, origin, angle);
                   ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y);
                 } else if (entity.type === 'CIRCLE') {
                   const c = rotatePoint(entity.center, origin, angle);
                   ctx.arc(c.x, c.y, entity.radius, 0, 2 * Math.PI);
                 }
                 ctx.stroke();
              }
           });
           ctx.globalAlpha = 1.0;
         } else if (activeCommand === 'SCALE') {
           const dNew = distance(origin, cursorPos);
           const factor = dNew > 0 ? dNew : 1;
           ctx.globalAlpha = 0.5;
           entities.forEach(entity => {
              if (selectedIds.has(entity.id)) {
                 ctx.beginPath();
                 if (entity.type === 'LINE') {
                   const s = scalePoint(entity.start, origin, factor);
                   const e = scalePoint(entity.end, origin, factor);
                   ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y);
                 } else if (entity.type === 'CIRCLE') {
                   const c = scalePoint(entity.center, origin, factor);
                   ctx.arc(c.x, c.y, entity.radius * factor, 0, 2 * Math.PI);
                 } else if (entity.type === 'RECTANGLE') {
                   const p1 = scalePoint(entity.p1, origin, factor);
                   const p2 = scalePoint(entity.p2, origin, factor);
                   ctx.rect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
                 }
                 ctx.stroke();
              }
           });
           ctx.globalAlpha = 1.0;
         } else if (activeCommand === 'MIRROR') {
           const p1 = tempPoints[0];
           const p2 = cursorPos;
           ctx.globalAlpha = 0.5;
           entities.forEach(entity => {
              if (selectedIds.has(entity.id)) {
                 ctx.beginPath();
                 if (entity.type === 'LINE') {
                   const s = mirrorPoint(entity.start, p1, p2);
                   const e = mirrorPoint(entity.end, p1, p2);
                   ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y);
                 } else if (entity.type === 'CIRCLE') {
                   const c = mirrorPoint(entity.center, p1, p2);
                   ctx.arc(c.x, c.y, entity.radius, 0, 2 * Math.PI);
                 } else if (entity.type === 'RECTANGLE') {
                   const m1 = mirrorPoint(entity.p1, p1, p2);
                   const m2 = mirrorPoint(entity.p2, p1, p2);
                   ctx.rect(Math.min(m1.x, m2.x), Math.min(m1.y, m2.y), Math.abs(m2.x - m1.x), Math.abs(m2.y - m1.y));
                 }
                 ctx.stroke();
              }
           });
           ctx.globalAlpha = 1.0;
         }
      }

      if (snapPoint) {
        const sp = snapPoint as {point: Point, type: 'endpoint'|'center'};
        ctx.strokeStyle = '#ffff00'; 
        ctx.lineWidth = 2 / zoom;
        const size = 10 / zoom;
        ctx.beginPath();
        if (sp.type === 'endpoint') ctx.rect(sp.point.x - size/2, sp.point.y - size/2, size, size);
        else if (sp.type === 'center') ctx.arc(sp.point.x, sp.point.y, size/2, 0, 2 * Math.PI);
        ctx.stroke();
      }

      ctx.restore();
      
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 1;
      const sp = snapPoint as {point: Point, type: 'endpoint'|'center'} | null;
      const effectivePos = sp ? sp.point : cursorPos;
      const screenX = (effectivePos.x * zoom) + canvas.width/2 + pan.x;
      const screenY = (-effectivePos.y * zoom) + canvas.height/2 + pan.y;
      
      ctx.beginPath();
      ctx.moveTo(screenX, 0); ctx.lineTo(screenX, canvas.height);
      ctx.moveTo(0, screenY); ctx.lineTo(canvas.width, screenY);
      ctx.stroke();
      
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px Consolas';
      ctx.fillText(`(${effectivePos.x.toFixed(2)}, ${effectivePos.y.toFixed(2)})`, screenX + 10, screenY - 10);
    }

    render();
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [pan, zoom, entities, cursorPos, activeCommand, commandStep, tempPoints, selectedIds, snapPoint]);

  const drawGrid = (ctx: CanvasRenderingContext2D) => {
    ctx.strokeStyle = '#3e3e42';
    ctx.lineWidth = 1 / zoom;
    const extents = 50; 
    ctx.beginPath();
    for (let i = -extents; i <= extents; i += 1) {
      ctx.moveTo(i, -extents); ctx.lineTo(i, extents);
      ctx.moveTo(-extents, i); ctx.lineTo(extents, i);
    }
    ctx.stroke();
    
    ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 2 / zoom;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(extents, 0); ctx.stroke();
    ctx.strokeStyle = '#4dff4d'; 
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, extents); ctx.stroke();
  };

  const getWorldCoord = (e: ReactMouseEvent | MouseEvent): Point => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const x = (screenX - rect.width / 2 - pan.x) / zoom;
    const y = -(screenY - rect.height / 2 - pan.y) / zoom;
    return { x, y }; 
  };

  const handleMouseMove = (e: ReactMouseEvent) => {
    let wPos = getWorldCoord(e);
    const roundedPos = { x: Math.round(wPos.x * 2) / 2, y: Math.round(wPos.y * 2) / 2 };
    const snapped = calculateSnap(wPos); 
    setCursorPos(snapped === wPos ? roundedPos : wPos); 

    if (isPanning) {
      setPan(prev => ({ x: prev.x + e.clientX - lastMousePos.x, y: prev.y + e.clientY - lastMousePos.y }));
      setLastMousePos({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseDown = (e: ReactMouseEvent) => {
    if (e.button === 1 || activeCommand === 'PAN') { 
      setIsPanning(true);
      setLastMousePos({ x: e.clientX, y: e.clientY });
      return;
    }
    if (e.button === 0 && activeCommand) {
      const wPos = getWorldCoord(e);
      const roundedPos = { x: Math.round(wPos.x * 2) / 2, y: Math.round(wPos.y * 2) / 2 };
      const sp = snapPoint as {point: Point, type: 'endpoint'|'center'} | null;
      const pt = sp ? sp.point : roundedPos;
      
      if ((activeCommand === 'MOVE' || activeCommand === 'COPY' || activeCommand === 'ROTATE' || activeCommand === 'SCALE' || activeCommand === 'MIRROR') && commandStep === 0) {
         const hitId = hitTest(wPos);
         if (hitId) {
            setSelectedIds(prev => {
              const next = new Set(prev);
              if (next.has(hitId)) next.delete(hitId);
              else next.add(hitId);
              return next;
            });
         }
         return;
      }
      
      if (activeCommand === 'TRIM') {
        const hitId = hitTest(wPos);
        if (hitId) {
          executeTrim(hitId, wPos);
        }
        return;
      }

      handleCommandInput(pt);
    }
  };

  const handleMouseUp = () => setIsPanning(false);

  const handleWheel = (e: ReactWheelEvent) => {
    e.preventDefault();
    const direction = e.deltaY < 0 ? 1 : -1;
    setZoom(prev => Math.max(2, prev * (direction > 0 ? 1.1 : 0.9)));
  };

  const handleCommandInput = (input: Point | number | string) => {
    if (activeCommand === 'LINE') {
      if (input === 'UNDO' && tempPoints.length > 0) {
        setEntities(prev => {
          const newEntities = [...prev];
          for (let i = newEntities.length - 1; i >= 0; i--) {
            if (newEntities[i].type === 'LINE') { newEntities.splice(i, 1); break; }
          }
          return newEntities;
        });
        setTempPoints(prev => prev.slice(0, -1)); 
        if (tempPoints.length <= 1) setCommandStep(0); 
        return;
      }
      if (input === 'CLOSE' && tempPoints.length > 2) {
        setEntities(prev => [...prev, { id: generateId(), type: 'LINE', start: tempPoints[tempPoints.length - 1], end: tempPoints[0] }]);
        onCommandComplete();
        return;
      }
      if (typeof input === 'object' && 'x' in input) {
        if (commandStep === 0) {
          setTempPoints([input]);
          setCommandStep(1);
        } else if (commandStep === 1) {
          setEntities(prev => [...prev, { id: generateId(), type: 'LINE', start: tempPoints[tempPoints.length - 1], end: input }]);
          setTempPoints(prev => [...prev, input]);
        }
      }
    } else if (activeCommand === 'RECTANGLE') {
      if (typeof input === 'object' && 'x' in input) {
        if (commandStep === 0) {
          setTempPoints([input]);
          setCommandStep(1);
        } else if (commandStep === 1) {
          setEntities(prev => [...prev, { id: generateId(), type: 'RECTANGLE', p1: tempPoints[0], p2: input }]);
          onCommandComplete();
        }
      }
    } else if (activeCommand === 'CIRCLE') {
      if (commandStep === 0 && typeof input === 'object' && 'x' in input) {
        setTempPoints([input]);
        setCommandStep(1);
      } else if (commandStep === 1) {
        let radius = 0;
        if (typeof input === 'number') radius = input;
        else if (typeof input === 'object' && 'x' in input) radius = distance(tempPoints[0], input);
        setEntities(prev => [...prev, { id: generateId(), type: 'CIRCLE', center: tempPoints[0], radius }]);
        onCommandComplete();
      }
    } else if (activeCommand === 'MOVE' || activeCommand === 'COPY') {
      if (commandStep === 1 && typeof input === 'object' && 'x' in input) {
        setTempPoints([input]);
        setCommandStep(2);
      } else if (commandStep === 2 && typeof input === 'object' && 'x' in input) {
        const dx = input.x - tempPoints[0].x;
        const dy = input.y - tempPoints[0].y;
        setEntities(prev => {
          const next = [...prev];
          selectedIds.forEach(id => {
            const idx = next.findIndex(e => e.id === id);
            if (idx >= 0) {
              const e = next[idx];
              let modified: Entity | null = null;
              if (e.type === 'LINE') modified = { ...e, id: activeCommand==='COPY' ? generateId() : e.id, start: {x: e.start.x + dx, y: e.start.y + dy}, end: {x: e.end.x + dx, y: e.end.y + dy} };
              else if (e.type === 'CIRCLE') modified = { ...e, id: activeCommand==='COPY' ? generateId() : e.id, center: {x: e.center.x + dx, y: e.center.y + dy} };
              else if (e.type === 'RECTANGLE') modified = { ...e, id: activeCommand==='COPY' ? generateId() : e.id, p1: {x: e.p1.x + dx, y: e.p1.y + dy}, p2: {x: e.p2.x + dx, y: e.p2.y + dy} };
              if (activeCommand === 'COPY' && modified) next.push(modified);
              else if (modified) next[idx] = modified;
            }
          });
          return next;
        });
        onCommandComplete();
      } else if (activeCommand === 'OFFSET' && commandStep === 1) {
        if (typeof input !== 'object' || !('x' in input)) return;
        const pt = input as Point;
        const hitId = hitTest(pt);
        if (hitId) {
           const dist = tempPoints[0].x;
           const target = entities.find(e => e.id === hitId);
           if (target) {
              if (target.type === 'CIRCLE') {
                 const r = target.radius + dist;
                 if (r > 0) setEntities(prev => [...prev, { ...target, id: generateId(), radius: r }]);
              } else if (target.type === 'RECTANGLE') {
                 // expand outwards
                 const w = Math.abs(target.p2.x - target.p1.x);
                 const h = Math.abs(target.p2.y - target.p1.y);
                 const cx = (target.p1.x + target.p2.x) / 2;
                 const cy = (target.p1.y + target.p2.y) / 2;
                 const p1 = { x: cx - (w/2 + dist), y: cy - (h/2 + dist) };
                 const p2 = { x: cx + (w/2 + dist), y: cy + (h/2 + dist) };
                 setEntities(prev => [...prev, { ...target, id: generateId(), p1, p2 }]);
              } else if (target.type === 'LINE') {
                 // Offset line by distance in its normal direction
                 const dx = target.end.x - target.start.x;
                 const dy = target.end.y - target.start.y;
                 const len = Math.sqrt(dx*dx + dy*dy);
                 if (len > 0) {
                    const nx = -dy / len;
                    const ny = dx / len;
                    // Determine which side clicked point is on
                    const cross = (pt.x - target.start.x) * dy - (pt.y - target.start.y) * dx;
                    const dir = cross > 0 ? 1 : -1;
                    const start = { x: target.start.x + nx * dist * dir, y: target.start.y + ny * dist * dir };
                    const end = { x: target.end.x + nx * dist * dir, y: target.end.y + ny * dist * dir };
                    setEntities(prev => [...prev, { ...target, id: generateId(), start, end }]);
                 }
              }
           }
           onCommandComplete();
        }
      }
    } else if (activeCommand === 'ROTATE' || activeCommand === 'SCALE' || activeCommand === 'MIRROR') {
       if (commandStep === 1 && typeof input === 'object' && 'x' in input) {
         setTempPoints([input]);
         setCommandStep(2);
       } else if (commandStep === 2 && typeof input === 'object' && 'x' in input) {
         const origin = tempPoints[0];
         setEntities(prev => {
            const next = [...prev];
            if (activeCommand === 'ROTATE') {
              const angle = Math.atan2(input.y - origin.y, input.x - origin.x) * (180 / Math.PI);
              selectedIds.forEach(id => {
                const idx = next.findIndex(e => e.id === id);
                if (idx >= 0) {
                   const e = next[idx];
                   if (e.type === 'LINE') next[idx] = { ...e, start: rotatePoint(e.start, origin, angle), end: rotatePoint(e.end, origin, angle) };
                   else if (e.type === 'CIRCLE') next[idx] = { ...e, center: rotatePoint(e.center, origin, angle) };
                   else if (e.type === 'RECTANGLE') next[idx] = { ...e, type: 'LINE', start: rotatePoint(e.p1, origin, angle), end: rotatePoint(e.p2, origin, angle) };
                }
              });
            } else if (activeCommand === 'SCALE') {
               const factor = distance(origin, input);
               selectedIds.forEach(id => {
                const idx = next.findIndex(e => e.id === id);
                if (idx >= 0) {
                   const e = next[idx];
                   if (e.type === 'LINE') next[idx] = { ...e, start: scalePoint(e.start, origin, factor), end: scalePoint(e.end, origin, factor) };
                   else if (e.type === 'CIRCLE') next[idx] = { ...e, center: scalePoint(e.center, origin, factor), radius: e.radius * factor };
                   else if (e.type === 'RECTANGLE') next[idx] = { ...e, p1: scalePoint(e.p1, origin, factor), p2: scalePoint(e.p2, origin, factor) };
                }
               });
            } else if (activeCommand === 'MIRROR') {
               const p1 = origin;
               const p2 = input;
               selectedIds.forEach(id => {
                const idx = next.findIndex(e => e.id === id);
                if (idx >= 0) {
                   const e = next[idx];
                   if (e.type === 'LINE') {
                     next.push({ ...e, id: generateId(), start: mirrorPoint(e.start, p1, p2), end: mirrorPoint(e.end, p1, p2) });
                   } else if (e.type === 'CIRCLE') {
                     next.push({ ...e, id: generateId(), center: mirrorPoint(e.center, p1, p2) });
                   } else if (e.type === 'RECTANGLE') {
                     next.push({ ...e, id: generateId(), p1: mirrorPoint(e.p1, p1, p2), p2: mirrorPoint(e.p2, p1, p2) });
                   }
                }
               });
            }
            return next;
         });
         onCommandComplete();
       }
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      if (e.key === 'Escape') {
        onCommandComplete();
      } else if (e.key === 'Enter') {
         if ((activeCommand === 'MOVE' || activeCommand === 'COPY' || activeCommand === 'ROTATE' || activeCommand === 'SCALE' || activeCommand === 'MIRROR') && commandStep === 0) {
           if (selectedIds.size > 0) setCommandStep(1);
         } else if (activeCommand === 'LINE' && commandStep === 1) {
           onCommandComplete();
         }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCommandComplete, activeCommand, commandStep, selectedIds.size]);

  return (
    <canvas ref={canvasRef} onMouseMove={handleMouseMove} onMouseDown={handleMouseDown} onMouseUp={handleMouseUp} onWheel={handleWheel} onContextMenu={(e) => e.preventDefault()} style={{ touchAction: 'none' }} />
  );
});

export default DrawingCanvas;
