import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import type { MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from 'react';
import { parseCoordinate } from './CommandEngine';

export interface Point { x: number; y: number; }
export interface BaseEntity { id: string; }
export interface Line extends BaseEntity { type: 'LINE'; start: Point; end: Point; }
export interface Circle extends BaseEntity { type: 'CIRCLE'; center: Point; radius: number; }
export interface Rectangle extends BaseEntity { type: 'RECTANGLE'; p1: Point; p2: Point; filletRadius?: number; chamferDist?: number; }
export interface Arc extends BaseEntity { type: 'ARC'; start: Point; control: Point; end: Point; radius: number; }
export interface Text extends BaseEntity { type: 'TEXT'; start: Point; text: string; height: number; }
export interface Dimension extends BaseEntity { type: 'DIMENSION'; p1: Point; p2: Point; dimLinePos: Point; text: string; }
export interface DimAligned extends BaseEntity { type: 'DIM_ALIGNED'; p1: Point; p2: Point; dimLinePos: Point; text: string; }
export interface DimAngular extends BaseEntity { type: 'DIM_ANGULAR'; center: Point; p1: Point; p2: Point; dimLinePos: Point; text: string; }
export interface Polygon extends BaseEntity { type: 'POLYGON'; center: Point; radius: number; sides: number; }
export interface CircularArc extends BaseEntity { type: 'CIRCULAR_ARC'; center: Point; radius: number; startAngle: number; endAngle: number; }
export type Entity = Line | Circle | Rectangle | Arc | Text | Dimension | DimAligned | DimAngular | Polygon | CircularArc;

interface DrawingCanvasProps {
  activeCommand: string | null;
  typedInputToProcess: string | null;
  osnap: boolean;
  ortho: boolean;
  polar: boolean;
  otrack: boolean;
  onCommandComplete: () => void;
  onPromptChange: (prompt: string) => void;
  onInputProcessed: () => void;
  onCursorMove: (pos: Point | null) => void;
}

export interface DrawingCanvasHandle {
  getEntities: () => Entity[];
  undo: () => void;
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

const getCircleLineIntersections = (center: Point, r: number, p1: Point, p2: Point): Point[] => {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const a = dx*dx + dy*dy;
  const b = 2 * (dx*(p1.x - center.x) + dy*(p1.y - center.y));
  const c = (p1.x - center.x)**2 + (p1.y - center.y)**2 - r*r;
  const det = b*b - 4*a*c;
  if (det < 0) return [];
  if (det === 0) {
    const t = -b / (2*a);
    if (t >= 0 && t <= 1) return [{x: p1.x + t*dx, y: p1.y + t*dy}];
    return [];
  }
  const t1 = (-b + Math.sqrt(det)) / (2*a);
  const t2 = (-b - Math.sqrt(det)) / (2*a);
  const pts = [];
  if (t1 >= 0 && t1 <= 1) pts.push({x: p1.x + t1*dx, y: p1.y + t1*dy});
  if (t2 >= 0 && t2 <= 1) pts.push({x: p1.x + t2*dx, y: p1.y + t2*dy});
  return pts;
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

const getRaySegmentIntersection = (rayOrigin: Point, rayDir: {x: number, y: number}, segP1: Point, segP2: Point): Point | null => {
  const v1 = rayOrigin.x - segP1.x;
  const v2 = rayOrigin.y - segP1.y;
  const v3 = segP2.x - segP1.x;
  const v4 = segP2.y - segP1.y;

  const det = v3 * rayDir.y - v4 * rayDir.x;
  if (Math.abs(det) < 1e-6) return null;

  const t = (v1 * v4 - v3 * v2) / det;
  const u = (v1 * rayDir.y - v2 * rayDir.x) / det;

  if (t > 1e-5 && u >= -1e-5 && u <= 1.00001) {
    return { x: rayOrigin.x + t * rayDir.x, y: rayOrigin.y + t * rayDir.y };
  }
  return null;
};

const getRayCircleIntersection = (rayOrigin: Point, rayDir: {x: number, y: number}, center: Point, radius: number): Point[] => {
  const dx = rayDir.x;
  const dy = rayDir.y;
  const a = dx*dx + dy*dy;
  const b = 2 * (dx*(rayOrigin.x - center.x) + dy*(rayOrigin.y - center.y));
  const c = (rayOrigin.x - center.x)**2 + (rayOrigin.y - center.y)**2 - radius**2;
  
  const disc = b*b - 4*a*c;
  if (disc < 0) return [];
  
  const t1 = (-b + Math.sqrt(disc)) / (2*a);
  const t2 = (-b - Math.sqrt(disc)) / (2*a);
  
  const pts: Point[] = [];
  if (t1 > 1e-5) pts.push({x: rayOrigin.x + t1*dx, y: rayOrigin.y + t1*dy});
  if (t2 > 1e-5) pts.push({x: rayOrigin.x + t2*dx, y: rayOrigin.y + t2*dy});
  return pts;
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
  const sqDist = dx * dx + dy * dy;
  if (sqDist === 0) return { x: pt.x, y: pt.y };
  
  const a = (dx * dx - dy * dy) / sqDist;
  const b = 2 * dx * dy / sqDist;
  const x = pt.x - p1.x;
  const y = pt.y - p1.y;
  return {
    x: p1.x + a * x + b * y,
    y: p1.y + b * x - a * y
  };
};

const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(({ 
  activeCommand, 
  typedInputToProcess,
  osnap,
  ortho,
  polar,
  otrack,
  onCommandComplete,
  onPromptChange,
  onInputProcessed,
  onCursorMove
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Viewport state
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(20); 
  const [isPanning, setIsPanning] = useState(false);
  const [lastMousePos, setLastMousePos] = useState<Point>({ x: 0, y: 0 });

  // Drawing state
  const [entities, _setEntities] = useState<Entity[]>([]);
  const [, setHistory] = useState<Entity[][]>([]);
  const [cursorPos, setCursorPos] = useState<Point>({ x: 0, y: 0 });

  const setEntities = (action: React.SetStateAction<Entity[]>) => {
    _setEntities(prev => {
      const next = typeof action === 'function' ? (action as any)(prev) : action;
      if (prev !== next) {
        setHistory(h => [...h, prev]);
      }
      return next;
    });
  };
  
  // OSNAP state
  const [snapPoint, setSnapPoint] = useState<{point: Point, type: 'endpoint'|'center'} | null>(null);
  const [acquiredPoints, setAcquiredPoints] = useState<Point[]>([]);
  const [trackedPoint, setTrackedPoint] = useState<Point | null>(null);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionBox, setSelectionBox] = useState<{start: Point, end: Point} | null>(null);

  // Command state
  const [commandStep, setCommandStep] = useState<number>(0);
  const [tempPoints, setTempPoints] = useState<Point[]>([]);
  const [stretchedPoints, setStretchedPoints] = useState<{id: string, isStart: boolean}[]>([]);

  useImperativeHandle(ref, () => ({
    getEntities: () => entities,
    undo: () => {
      setHistory(h => {
        if (h.length === 0) return h;
        const prev = h[h.length - 1];
        _setEntities(prev);
        return h.slice(0, -1);
      });
    }
  }));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      if (e.key === 'Escape') {
        if (activeCommand === 'LINE' && commandStep === 1) {
          onCommandComplete();
          setSelectedIds(new Set());
        } else if (activeCommand) {
          onCommandComplete();
          setSelectedIds(new Set());
        } else {
          setSelectedIds(new Set());
        }
      }
      
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        setEntities(prev => prev.filter(e => !selectedIds.has(e.id)));
        setSelectedIds(new Set());
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeCommand, commandStep, selectedIds]);

  // Update prompt based on command state
  useEffect(() => {
    if (!activeCommand) {
      onPromptChange('พิมพ์คำสั่งเพื่อเริ่มต้น... (Type a command)');
      setCommandStep(0);
      setTempPoints([]);
      setStretchedPoints([]);
      return;
    }

    const commandsWithSelection = ['MOVE', 'COPY', 'ROTATE', 'SCALE', 'MIRROR', 'ARRAY', 'EXPLODE', 'STRETCH'];
    if (commandStep === 0 && selectedIds.size > 0 && commandsWithSelection.includes(activeCommand)) {
      setCommandStep(1);
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
    } else if (activeCommand === 'ROTATE' || activeCommand === 'SCALE' || activeCommand === 'MIRROR' || activeCommand === 'EXPLODE') {
      if (commandStep === 0) onPromptChange(`${activeCommand} Select objects: (${selectedIds.size} found) [Press Enter to continue]`);
      else if (commandStep === 1) onPromptChange(`${activeCommand} Specify first point of mirror line / base point:`);
      else if (commandStep === 2) onPromptChange(`${activeCommand} Specify second point / factor / angle:`);
    } else if (activeCommand === 'OFFSET') {
      if (commandStep === 0) onPromptChange(`OFFSET Specify offset distance:`);
      else if (commandStep === 1) onPromptChange(`OFFSET Select object to offset:`);
      else if (commandStep === 2) onPromptChange(`OFFSET Specify point on side to offset:`);
    } else if (activeCommand === 'FILLET') {
      if (commandStep === 0) onPromptChange(`FILLET Specify fillet radius:`);
      else if (commandStep === 1) onPromptChange(`FILLET Select first object (Rectangle or Line):`);
      else if (commandStep === 2) onPromptChange(`FILLET Select second line:`);
    } else if (activeCommand === 'CHAMFER') {
      if (commandStep === 0) onPromptChange(`CHAMFER Specify chamfer distance:`);
      else if (commandStep === 1) onPromptChange(`CHAMFER Select first object (Rectangle or Line):`);
      else if (commandStep === 2) onPromptChange(`CHAMFER Select second line:`);
    } else if (activeCommand === 'ARRAY') {
      if (commandStep === 0) onPromptChange(`ARRAY Select objects: (${selectedIds.size} found) [Press Enter to continue]`);
      else if (commandStep === 1) onPromptChange(`ARRAY Enter Array type [Rectangular(R) / Polar(P)]:`);
      else if (commandStep === 2) onPromptChange(tempPoints[0]?.x === 0 ? `ARRAY Enter number of columns:` : `ARRAY Specify center point of polar array:`);
      else if (commandStep === 3) onPromptChange(tempPoints[0]?.x === 0 ? `ARRAY Enter number of rows:` : `ARRAY Enter number of items:`);
      else if (commandStep === 4) onPromptChange(tempPoints[0]?.x === 0 ? `ARRAY Enter distance between columns:` : `ARRAY Enter angle to fill (e.g. 360):`);
      else if (commandStep === 5) onPromptChange(`ARRAY Enter distance between rows:`);
    } else if (activeCommand === 'TEXT') {
      if (commandStep === 0) onPromptChange(`TEXT Specify start point of text:`);
      else if (commandStep === 1) onPromptChange(`TEXT Specify height:`);
      else if (commandStep === 2) onPromptChange(`TEXT Enter text:`);
    } else if (activeCommand === 'DIMENSION') {
      if (commandStep === 0) onPromptChange(`DIMENSION Specify first extension line origin:`);
      else if (commandStep === 1) onPromptChange(`DIMENSION Specify second extension line origin:`);
      else if (commandStep === 2) onPromptChange(`DIMENSION Specify dimension line location:`);
    } else if (activeCommand === 'DIMALIGNED') {
      if (commandStep === 0) onPromptChange(`DIMALIGNED Specify first extension line origin:`);
      else if (commandStep === 1) onPromptChange(`DIMALIGNED Specify second extension line origin:`);
      else if (commandStep === 2) onPromptChange(`DIMALIGNED Specify dimension line location:`);
    } else if (activeCommand === 'DIMANGULAR') {
      if (commandStep === 0) onPromptChange(`DIMANGULAR Specify angle vertex:`);
      else if (commandStep === 1) onPromptChange(`DIMANGULAR Specify first angle endpoint:`);
      else if (commandStep === 2) onPromptChange(`DIMANGULAR Specify second angle endpoint:`);
      else if (commandStep === 3) onPromptChange(`DIMANGULAR Specify dimension arc line location:`);
    } else if (activeCommand === 'EXTEND') {
      onPromptChange(`EXTEND Select object to extend:`);
    } else if (activeCommand === 'STRETCH') {
      if (commandStep === 0) onPromptChange(`STRETCH Select first corner of crossing window:`);
      else if (commandStep === 1) onPromptChange(`STRETCH Select opposite corner:`);
      else if (commandStep === 2) onPromptChange(`STRETCH Specify base point:`);
      else if (commandStep === 3) onPromptChange(`STRETCH Specify second point:`);
    } else if (activeCommand === 'ARC') {
      if (commandStep === 0) onPromptChange(`ARC Specify start point of arc:`);
      else if (commandStep === 1) onPromptChange(`ARC Specify second point of arc:`);
      else if (commandStep === 2) onPromptChange(`ARC Specify end point of arc:`);
    } else if (activeCommand === 'POLYGON') {
      if (commandStep === 0) onPromptChange(`POLYGON Enter number of sides:`);
      else if (commandStep === 1) onPromptChange(`POLYGON Specify center of polygon:`);
      else if (commandStep === 2) onPromptChange(`POLYGON Specify radius of circle:`);
    }
  }, [activeCommand, commandStep, selectedIds.size, onPromptChange]);

  // Process typed input
  useEffect(() => {
    if (typedInputToProcess && activeCommand) {
      if (typedInputToProcess === 'ENTER_KEY') {
        if ((activeCommand === 'MOVE' || activeCommand === 'COPY' || activeCommand === 'ROTATE' || activeCommand === 'SCALE' || activeCommand === 'MIRROR' || activeCommand === 'ARRAY') && commandStep === 0) {
          if (selectedIds.size > 0) setCommandStep(1);
        } else if (activeCommand === 'LINE' && commandStep === 1) {
          onCommandComplete();
        } else if (activeCommand === 'TRIM' || activeCommand === 'EXTEND') {
          onCommandComplete();
        }
        const lastPoint = tempPoints.length > 0 ? tempPoints[tempPoints.length - 1] : {x:0, y:0};
        const parsed = parseCoordinate(typedInputToProcess, lastPoint);
        if (parsed) {
          handleCommandInput(parsed);
        } else {
          handleCommandInput(typedInputToProcess);
        }
        onInputProcessed();
        return;
      }

      const lastPoint = tempPoints.length > 0 ? tempPoints[tempPoints.length - 1] : undefined;
      const parsed = parseCoordinate(typedInputToProcess, lastPoint);
      
      if (activeCommand === 'TEXT' && commandStep === 2) {
        handleCommandInput(typedInputToProcess);
      } else if (parsed !== null) {
        handleCommandInput(parsed);
      } else {
        onPromptChange(`Invalid input: ${typedInputToProcess}`);
        setTimeout(() => setCommandStep(s => s), 2000);
      }
      onInputProcessed();
    } else if (typedInputToProcess) {
      onPromptChange(`Invalid input: ${typedInputToProcess}`);
      onInputProcessed();
      setTimeout(() => setCommandStep(s => s), 1500); // Trigger prompt refresh
    }
  }, [typedInputToProcess]);

  // Find OSNAP
  const calculateSnap = (wPos: Point) => {
    setSnapPoint(null);
    if (!osnap) return wPos;

    const snapDistance = 15 / zoom; 
    let bestSnap: {point: Point, type: 'endpoint'|'center'} | null = null;
    let minDist = snapDistance;

    entities.forEach(entity => {
      if (entity.type === 'LINE') {
        const d1 = distance(wPos, entity.start);
        if (d1 < minDist) { minDist = d1; bestSnap = { point: entity.start, type: 'endpoint' }; }
        const d2 = distance(wPos, entity.end);
        if (d2 < minDist) { minDist = d2; bestSnap = { point: entity.end, type: 'endpoint' }; }
      } else if (entity.type === 'RECTANGLE') {
        const pts = [
          entity.p1, entity.p2, 
          { x: entity.p1.x, y: entity.p2.y }, 
          { x: entity.p2.x, y: entity.p1.y }
        ];
        pts.forEach(pt => {
          const d = distance(wPos, pt);
          if (d < minDist) { minDist = d; bestSnap = { point: pt, type: 'endpoint' }; }
        });
      } else if (entity.type === 'CIRCLE') {
        const d = distance(wPos, entity.center);
        if (d < minDist) { minDist = d; bestSnap = { point: entity.center, type: 'center' }; }
      } else if (entity.type === 'CIRCULAR_ARC') {
        const d = distance(wPos, entity.center);
        if (d < minDist) { minDist = d; bestSnap = { point: entity.center, type: 'center' }; }
      } else if (entity.type === 'POLYGON') {
        const d = distance(wPos, entity.center);
        if (d < minDist) { minDist = d; bestSnap = { point: entity.center, type: 'center' }; }
      }
    });

    setSnapPoint(bestSnap);
    return bestSnap ? bestSnap.point : wPos;
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
        if (d <= pickDistance && d < minDist) { minDist = d; bestEntityId = entity.id; }
      } else if (entity.type === 'CIRCULAR_ARC') {
        const d = Math.abs(distance(worldPos, entity.center) - entity.radius);
        if (d <= pickDistance && d < minDist) {
          let ang = Math.atan2(worldPos.y - entity.center.y, worldPos.x - entity.center.x);
          if (ang < 0) ang += 2*Math.PI;
          let sa = entity.startAngle < 0 ? entity.startAngle + 2*Math.PI : entity.startAngle;
          let ea = entity.endAngle < 0 ? entity.endAngle + 2*Math.PI : entity.endAngle;
          let inArc = ea < sa ? (ang >= sa || ang <= ea) : (ang >= sa && ang <= ea);
          if (inArc) { minDist = d; bestEntityId = entity.id; }
        }
      } else if (entity.type === 'POLYGON') {
        const d = distance(worldPos, entity.center);
        if (d <= entity.radius + pickDistance) { minDist = 0; bestEntityId = entity.id; }
      } else if (entity.type === 'RECTANGLE') {
        const minX = Math.min(entity.p1.x, entity.p2.x) - pickDistance;
        const maxX = Math.max(entity.p1.x, entity.p2.x) + pickDistance;
        const minY = Math.min(entity.p1.y, entity.p2.y) - pickDistance;
        const maxY = Math.max(entity.p1.y, entity.p2.y) + pickDistance;
        if (worldPos.x >= minX && worldPos.x <= maxX && worldPos.y >= minY && worldPos.y <= maxY) {
          minDist = 0; bestEntityId = entity.id;
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
    if (entity.type === 'POLYGON') {
      const pts = [];
      const angleStep = (Math.PI * 2) / entity.sides;
      let startAngle = -Math.PI / 2;
      for (let i = 0; i < entity.sides; i++) {
        pts.push({
          x: entity.center.x + entity.radius * Math.cos(startAngle + i * angleStep),
          y: entity.center.y + entity.radius * Math.sin(startAngle + i * angleStep)
        });
      }
      const segs = [];
      for (let i = 0; i < pts.length; i++) {
        segs.push({p1: pts[i], p2: pts[(i + 1) % pts.length]});
      }
      return segs;
    }
    return [];
  };

  const executeTrim = (targetId: string, clickPos: Point) => {
    const targetEntity = entities.find(e => e.id === targetId);
    if (!targetEntity) return;

    if (targetEntity.type !== 'LINE' && targetEntity.type !== 'CIRCLE' && targetEntity.type !== 'CIRCULAR_ARC') {
       // Just delete if unsupported for trim but clicked
       setEntities(prev => prev.filter(e => e.id !== targetId));
       return;
    }

    // Find all intersections
    const intersections: Point[] = [];
    entities.forEach(other => {
      if (other.id === targetId) return;
      const segmentsOther = getEntitySegments(other);
      
      if (targetEntity.type === 'LINE') {
        segmentsOther.forEach(seg => {
          const pt = getLineSegmentIntersection(targetEntity.start, targetEntity.end, seg.p1, seg.p2);
          if (pt) intersections.push(pt);
        });
        if (other.type === 'CIRCLE' || other.type === 'CIRCULAR_ARC') {
          let pts = getCircleLineIntersections(other.center, (other as any).radius, targetEntity.start, targetEntity.end);
          if (other.type === 'CIRCULAR_ARC') {
             pts = pts.filter(pt => {
                let ang = Math.atan2(pt.y - (other as any).center.y, pt.x - (other as any).center.x);
                if (ang < 0) ang += 2*Math.PI;
                let sa = (other as any).startAngle < 0 ? (other as any).startAngle + 2*Math.PI : (other as any).startAngle;
                let ea = (other as any).endAngle < 0 ? (other as any).endAngle + 2*Math.PI : (other as any).endAngle;
                if (ea < sa) return ang >= sa || ang <= ea;
                return ang >= sa && ang <= ea;
             });
          }
          intersections.push(...pts);
        }
      } else if (targetEntity.type === 'CIRCLE' || targetEntity.type === 'CIRCULAR_ARC') {
        segmentsOther.forEach(seg => {
          let pts = getCircleLineIntersections((targetEntity as any).center, (targetEntity as any).radius, seg.p1, seg.p2);
          intersections.push(...pts);
        });
      }
    });

    // Remove duplicate intersections
    const uniqueIntersections = intersections.filter((pt, index, self) =>
      index === self.findIndex((t) => (Math.abs(t.x - pt.x) < 1e-4 && Math.abs(t.y - pt.y) < 1e-4))
    );

    if (uniqueIntersections.length === 0) {
      setEntities(prev => prev.filter(e => e.id !== targetId));
      return;
    }

    if (targetEntity.type === 'LINE') {
      let pts = [targetEntity.start, ...uniqueIntersections, targetEntity.end];
      pts.sort((a, b) => distance(targetEntity.start, a) - distance(targetEntity.start, b));
  
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
          const next = prev.filter(e => e.id !== targetId);
          if (clickedIndex > 0 && distance(pts[0], pts[clickedIndex]) > 1e-4) {
            next.push({ id: generateId(), type: 'LINE', start: pts[0], end: pts[clickedIndex] });
          }
          if (clickedIndex < pts.length - 2 && distance(pts[clickedIndex + 1], pts[pts.length - 1]) > 1e-4) {
            next.push({ id: generateId(), type: 'LINE', start: pts[clickedIndex + 1], end: pts[pts.length - 1] });
          }
          return next;
        });
      }
    } else if (targetEntity.type === 'CIRCLE' || targetEntity.type === 'CIRCULAR_ARC') {
      let angles = uniqueIntersections.map(pt => Math.atan2(pt.y - (targetEntity as any).center.y, pt.x - (targetEntity as any).center.x));
      if (targetEntity.type === 'CIRCULAR_ARC') {
        angles.push((targetEntity as any).startAngle, (targetEntity as any).endAngle);
      }
      angles = angles.map(a => a < 0 ? a + 2*Math.PI : a);
      angles.sort((a, b) => a - b);
      angles = angles.filter((a, index, self) => index === self.findIndex(t => Math.abs(t - a) < 1e-4));
      
      let clickAngle = Math.atan2(clickPos.y - (targetEntity as any).center.y, clickPos.x - (targetEntity as any).center.x);
      if (clickAngle < 0) clickAngle += 2*Math.PI;
      
      let clickedIndex = -1;
      for (let i = 0; i < angles.length; i++) {
        const nextAngle = i === angles.length - 1 ? angles[0] + 2*Math.PI : angles[i+1];
        let ca = clickAngle;
        if (i === angles.length - 1 && ca < angles[i]) ca += 2*Math.PI;
        
        if (ca >= angles[i] && ca <= nextAngle) {
          clickedIndex = i;
          break;
        }
      }
      
      if (clickedIndex >= 0) {
        setEntities(prev => {
           const next = prev.filter(e => e.id !== targetId);
           if (targetEntity.type === 'CIRCLE') {
             if (angles.length === 1) return prev; // Cannot trim circle with 1 point
             let startAngle = clickedIndex === angles.length - 1 ? angles[0] : angles[clickedIndex + 1];
             let endAngle = angles[clickedIndex];
             next.push({ id: generateId(), type: 'CIRCULAR_ARC', center: (targetEntity as any).center, radius: (targetEntity as any).radius, startAngle, endAngle });
           } else if (targetEntity.type === 'CIRCULAR_ARC') {
             for (let i = 0; i < angles.length; i++) {
               if (i === clickedIndex) continue;
               const nextI = i === angles.length - 1 ? 0 : i + 1;
               let sa = angles[i];
               let ea = angles[nextI];
               
               let midAngle = sa + (ea < sa ? ea + 2*Math.PI - sa : ea - sa) / 2;
               if (midAngle > 2*Math.PI) midAngle -= 2*Math.PI;
               
               let origSA = (targetEntity as any).startAngle < 0 ? (targetEntity as any).startAngle + 2*Math.PI : (targetEntity as any).startAngle;
               let origEA = (targetEntity as any).endAngle < 0 ? (targetEntity as any).endAngle + 2*Math.PI : (targetEntity as any).endAngle;
               let inOriginal = origEA < origSA ? (midAngle >= origSA || midAngle <= origEA) : (midAngle >= origSA && midAngle <= origEA);
               
               if (inOriginal) {
                  next.push({ id: generateId(), type: 'CIRCULAR_ARC', center: (targetEntity as any).center, radius: (targetEntity as any).radius, startAngle: sa, endAngle: ea });
               }
             }
           }
           return next;
        });
      }
    }
  };



  const executeExtend = (targetId: string, clickPos: Point) => {
    const targetEntity = entities.find(e => e.id === targetId);
    if (!targetEntity || targetEntity.type !== 'LINE') return;

    const dStart = distance(clickPos, targetEntity.start);
    const dEnd = distance(clickPos, targetEntity.end);
    
    let rayStart: Point, rayEnd: Point;
    let clickedEndIsEnd = dEnd < dStart;
    
    if (clickedEndIsEnd) {
       rayStart = targetEntity.start;
       rayEnd = targetEntity.end;
    } else {
       rayStart = targetEntity.end;
       rayEnd = targetEntity.start;
    }
    
    const rayDir = { x: rayEnd.x - rayStart.x, y: rayEnd.y - rayStart.y };
    const len = Math.sqrt(rayDir.x*rayDir.x + rayDir.y*rayDir.y);
    if (len === 0) return;
    rayDir.x /= len;
    rayDir.y /= len;

    const intersections: Point[] = [];
    
    entities.forEach(other => {
       if (other.id === targetId) return;
       const segments = getEntitySegments(other);
       segments.forEach(seg => {
           const pt = getRaySegmentIntersection(rayEnd, rayDir, seg.p1, seg.p2);
           if (pt) intersections.push(pt);
       });
       if (other.type === 'CIRCLE' || other.type === 'CIRCULAR_ARC') {
           const pts = getRayCircleIntersection(rayEnd, rayDir, (other as any).center, (other as any).radius);
           if (other.type === 'CIRCULAR_ARC') {
              const validPts = pts.filter(pt => {
                 let ang = Math.atan2(pt.y - (other as any).center.y, pt.x - (other as any).center.x);
                 if (ang < 0) ang += 2*Math.PI;
                 let sa = (other as any).startAngle < 0 ? (other as any).startAngle + 2*Math.PI : (other as any).startAngle;
                 let ea = (other as any).endAngle < 0 ? (other as any).endAngle + 2*Math.PI : (other as any).endAngle;
                 if (ea < sa) return ang >= sa || ang <= ea;
                 return ang >= sa && ang <= ea;
              });
              intersections.push(...validPts);
           } else {
              intersections.push(...pts);
           }
       }
    });
    
    if (intersections.length > 0) {
       let closest = intersections[0];
       let minDist = distance(rayEnd, closest);
       for (let i = 1; i < intersections.length; i++) {
           const d = distance(rayEnd, intersections[i]);
           if (d < minDist) {
               minDist = d;
               closest = intersections[i];
           }
       }
       
       setEntities(prev => prev.map(e => {
           if (e.id === targetId && e.type === 'LINE') {
               if (clickedEndIsEnd) {
                   return { ...e, end: closest };
               } else {
                   return { ...e, start: closest };
               }
           }
           return e;
       }));
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

      const drawArrowhead = (x: number, y: number, angle: number) => {
        const arrowLength = 2.0 / zoom;
        const arrowWidth = 0.5 / zoom;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-arrowLength, arrowWidth);
        ctx.lineTo(-arrowLength, -arrowWidth);
        ctx.closePath();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
        ctx.restore();
      };

      if (entity.type === 'LINE') {
        ctx.beginPath();
        ctx.moveTo(entity.start.x, entity.start.y);
        ctx.lineTo(entity.end.x, entity.end.y);
        ctx.stroke();
      } else if (entity.type === 'RECTANGLE') {
        ctx.beginPath();
        const minX = Math.min(entity.p1.x, entity.p2.x);
        const maxX = Math.max(entity.p1.x, entity.p2.x);
        const minY = Math.min(entity.p1.y, entity.p2.y);
        const maxY = Math.max(entity.p1.y, entity.p2.y);
        const w = maxX - minX;
        const h = maxY - minY;
        
        if (entity.filletRadius && entity.filletRadius > 0) {
            const r = Math.min(entity.filletRadius, w / 2, h / 2);
            ctx.moveTo(minX + r, minY);
            ctx.lineTo(maxX - r, minY);
            ctx.arcTo(maxX, minY, maxX, minY + r, r);
            ctx.lineTo(maxX, maxY - r);
            ctx.arcTo(maxX, maxY, maxX - r, maxY, r);
            ctx.lineTo(minX + r, maxY);
            ctx.arcTo(minX, maxY, minX, maxY - r, r);
            ctx.lineTo(minX, minY + r);
            ctx.arcTo(minX, minY, minX + r, minY, r);
        } else if (entity.chamferDist && entity.chamferDist > 0) {
            const d = Math.min(entity.chamferDist, w / 2, h / 2);
            ctx.moveTo(minX + d, minY);
            ctx.lineTo(maxX - d, minY);
            ctx.lineTo(maxX, minY + d);
            ctx.lineTo(maxX, maxY - d);
            ctx.lineTo(maxX - d, maxY);
            ctx.lineTo(minX + d, maxY);
            ctx.lineTo(minX, maxY - d);
            ctx.lineTo(minX, minY + d);
            ctx.closePath();
        } else {
            ctx.rect(minX, minY, w, h);
        }
        ctx.stroke();
      } else if (entity.type === 'CIRCLE') {
        ctx.beginPath();
        ctx.arc(entity.center.x, entity.center.y, entity.radius, 0, 2 * Math.PI);
        ctx.stroke();
      } else if (entity.type === 'CIRCULAR_ARC') {
        ctx.beginPath();
        ctx.arc(entity.center.x, entity.center.y, entity.radius, entity.startAngle, entity.endAngle);
        ctx.stroke();
      } else if (entity.type === 'POLYGON') {
        const angleStep = (Math.PI * 2) / entity.sides;
        ctx.beginPath();
        for (let i = 0; i <= entity.sides; i++) {
          const ptX = entity.center.x + entity.radius * Math.cos(i * angleStep);
          const ptY = entity.center.y + entity.radius * Math.sin(i * angleStep);
          if (i === 0) ctx.moveTo(ptX, ptY);
          else ctx.lineTo(ptX, ptY);
        }
        ctx.stroke();
      } else if (entity.type === 'ARC') {
        ctx.beginPath();
        ctx.moveTo(entity.start.x, entity.start.y);
        ctx.arcTo(entity.control.x, entity.control.y, entity.end.x, entity.end.y, entity.radius);
        ctx.stroke();
      } else if (entity.type === 'TEXT') {
        ctx.save();
        ctx.scale(1, -1);
        ctx.font = `${entity.height}px Consolas`;
        ctx.fillStyle = isSelected ? '#3399ff' : '#ffffff';
        ctx.fillText(entity.text, entity.start.x, -entity.start.y);
        ctx.restore();
      } else if (entity.type === 'DIMENSION') {
        ctx.beginPath();
        // Calculate dimension line points
        let isVertical = Math.abs(entity.p1.x - entity.p2.x) < Math.abs(entity.p1.y - entity.p2.y);
        
        let d1, d2;
        if (isVertical) {
            d1 = { x: entity.dimLinePos.x, y: entity.p1.y };
            d2 = { x: entity.dimLinePos.x, y: entity.p2.y };
            ctx.moveTo(entity.p1.x, entity.p1.y); ctx.lineTo(d1.x, d1.y);
            ctx.moveTo(entity.p2.x, entity.p2.y); ctx.lineTo(d2.x, d2.y);
        } else {
            d1 = { x: entity.p1.x, y: entity.dimLinePos.y };
            d2 = { x: entity.p2.x, y: entity.dimLinePos.y };
            ctx.moveTo(entity.p1.x, entity.p1.y); ctx.lineTo(d1.x, d1.y);
            ctx.moveTo(entity.p2.x, entity.p2.y); ctx.lineTo(d2.x, d2.y);
        }
        ctx.moveTo(d1.x, d1.y); ctx.lineTo(d2.x, d2.y);
        ctx.stroke();
        
        drawArrowhead(d1.x, d1.y, Math.atan2(d1.y - d2.y, d1.x - d2.x));
        drawArrowhead(d2.x, d2.y, Math.atan2(d2.y - d1.y, d2.x - d1.x));
        
        // Draw text
        ctx.save();
        ctx.scale(1, -1);
        ctx.font = `1.5px Consolas`;
        ctx.fillStyle = isSelected ? '#3399ff' : '#00ffaa';
        const midX = (d1.x + d2.x) / 2;
        const midY = (d1.y + d2.y) / 2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(entity.text, midX, -midY - 0.5);
        ctx.restore();
      } else if (entity.type === 'DIM_ALIGNED') {
        ctx.beginPath();
        
        const dx = entity.p2.x - entity.p1.x;
        const dy = entity.p2.y - entity.p1.y;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len > 0) {
           const ux = dx / len;
           const uy = dy / len;
           
           // Vector from p1 to dimLinePos
           const vx = entity.dimLinePos.x - entity.p1.x;
           const vy = entity.dimLinePos.y - entity.p1.y;
           
           // Project v onto u
           const projLength = vx * ux + vy * uy;
           const projX = entity.p1.x + projLength * ux;
           const projY = entity.p1.y + projLength * uy;
           
           // Normal vector from projected point to dimLinePos
           const nx = entity.dimLinePos.x - projX;
           const ny = entity.dimLinePos.y - projY;
           
           const d1 = { x: entity.p1.x + nx, y: entity.p1.y + ny };
           const d2 = { x: entity.p2.x + nx, y: entity.p2.y + ny };
           
           ctx.moveTo(entity.p1.x, entity.p1.y); ctx.lineTo(d1.x, d1.y);
           ctx.moveTo(entity.p2.x, entity.p2.y); ctx.lineTo(d2.x, d2.y);
           ctx.moveTo(d1.x, d1.y); ctx.lineTo(d2.x, d2.y);
           ctx.stroke();
           
           drawArrowhead(d1.x, d1.y, Math.atan2(d1.y - d2.y, d1.x - d2.x));
           drawArrowhead(d2.x, d2.y, Math.atan2(d2.y - d1.y, d2.x - d1.x));
           
           ctx.save();
           const midX = (d1.x + d2.x) / 2;
           const midY = (d1.y + d2.y) / 2;
           ctx.translate(midX, midY);
           let angle = Math.atan2(dy, dx);
           if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
           ctx.rotate(angle);
           ctx.scale(1, -1);
           ctx.font = `1.5px Consolas`;
           ctx.fillStyle = isSelected ? '#3399ff' : '#00ffaa';
           ctx.textAlign = 'center';
           ctx.textBaseline = 'bottom';
           ctx.fillText(entity.text, 0, -0.5);
           ctx.restore();
        }
      } else if (entity.type === 'DIM_ANGULAR') {
        const r = distance(entity.center, entity.dimLinePos);
        let a1 = Math.atan2(entity.p1.y - entity.center.y, entity.p1.x - entity.center.x);
        let a2 = Math.atan2(entity.p2.y - entity.center.y, entity.p2.x - entity.center.x);
        
        ctx.beginPath();
        // Draw extension lines
        const maxDist = Math.max(distance(entity.center, entity.p1), distance(entity.center, entity.p2), r * 1.2);
        ctx.moveTo(entity.center.x, entity.center.y);
        ctx.lineTo(entity.center.x + Math.cos(a1) * maxDist, entity.center.y + Math.sin(a1) * maxDist);
        ctx.moveTo(entity.center.x, entity.center.y);
        ctx.lineTo(entity.center.x + Math.cos(a2) * maxDist, entity.center.y + Math.sin(a2) * maxDist);
        
        // Ensure arc goes the shortest way or follows the click
        let startA = a1 < 0 ? a1 + 2*Math.PI : a1;
        let endA = a2 < 0 ? a2 + 2*Math.PI : a2;
        let clickA = Math.atan2(entity.dimLinePos.y - entity.center.y, entity.dimLinePos.x - entity.center.x);
        if (clickA < 0) clickA += 2*Math.PI;
        
        // Determine whether to draw clockwise or counterclockwise based on click point
        let inArc = false;
        if (startA < endA) {
           inArc = clickA >= startA && clickA <= endA;
        } else {
           inArc = clickA >= startA || clickA <= endA;
        }
        
        ctx.arc(entity.center.x, entity.center.y, r, startA, endA, !inArc);
        ctx.stroke();
        
        const pA = { x: entity.center.x + Math.cos(startA) * r, y: entity.center.y + Math.sin(startA) * r };
        const pB = { x: entity.center.x + Math.cos(endA) * r, y: entity.center.y + Math.sin(endA) * r };
        
        // The tangent at startA points at startA +/- PI/2
        // We want the arrowhead to point OUT of the arc.
        // If the arc is drawn from startA to endA using !inArc (counterClockwise),
        // the tangent pointing away from the arc at startA is startA - PI/2 if !inArc is true, else startA + PI/2.
        const counterClockwise = !inArc;
        drawArrowhead(pA.x, pA.y, startA + (counterClockwise ? -Math.PI/2 : Math.PI/2));
        drawArrowhead(pB.x, pB.y, endA + (counterClockwise ? Math.PI/2 : -Math.PI/2));
        
        ctx.save();
        ctx.scale(1, -1);
        ctx.font = `1.5px Consolas`;
        ctx.fillStyle = isSelected ? '#3399ff' : '#00ffaa';
        const textX = entity.center.x + Math.cos(clickA) * (r + 1.5);
        const textY = entity.center.y + Math.sin(clickA) * (r + 1.5);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(entity.text + "°", textX, -textY);
        ctx.restore();
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

      // Draw UCS Icon (XY indicator)
      function drawUCS(ctx: CanvasRenderingContext2D) {
        ctx.save();
        ctx.lineWidth = 1 / zoom;
        
        // X axis
        ctx.strokeStyle = '#ff4444';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(3, 0);
        ctx.stroke();
        
        // Y axis
        ctx.strokeStyle = '#44ff44';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, 3);
        ctx.stroke();

        // Origin box
        ctx.strokeStyle = '#ffffff';
        ctx.strokeRect(-0.2, -0.2, 0.4, 0.4);

        // Text
        ctx.scale(1, -1);
        ctx.font = `0.8px Consolas`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText('X', 3.2, 0.3);
        ctx.fillText('Y', 0.3, -3.2);

        ctx.restore();
      }
      drawUCS(ctx);

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
          else if (entity.type === 'POLYGON') drawEntity(ctx, { ...entity, center: {x: entity.center.x + dx, y: entity.center.y + dy} }, false, true);
        });
      } else if (activeCommand === 'STRETCH' && commandStep === 1 && tempPoints.length > 0) {
        ctx.strokeStyle = '#00ffaa'; 
        ctx.lineWidth = 1 / zoom;
        ctx.setLineDash([5/zoom, 5/zoom]);
        ctx.strokeRect(Math.min(tempPoints[0].x, cursorPos.x), Math.min(tempPoints[0].y, cursorPos.y), Math.abs(cursorPos.x - tempPoints[0].x), Math.abs(cursorPos.y - tempPoints[0].y));
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(0, 255, 170, 0.1)';
        ctx.fillRect(Math.min(tempPoints[0].x, cursorPos.x), Math.min(tempPoints[0].y, cursorPos.y), Math.abs(cursorPos.x - tempPoints[0].x), Math.abs(cursorPos.y - tempPoints[0].y));
      } else if (activeCommand === 'STRETCH' && commandStep === 3 && tempPoints.length > 0) {
        const basePoint = tempPoints[0];
        const dx = cursorPos.x - basePoint.x;
        const dy = cursorPos.y - basePoint.y;
        
        entities.forEach(entity => {
          if (entity.type === 'LINE') {
            const stretchStart = stretchedPoints.some(p => p.id === entity.id && p.isStart);
            const stretchEnd = stretchedPoints.some(p => p.id === entity.id && !p.isStart);
            if (stretchStart || stretchEnd) {
              const s = stretchStart ? {x: entity.start.x + dx, y: entity.start.y + dy} : entity.start;
              const e = stretchEnd ? {x: entity.end.x + dx, y: entity.end.y + dy} : entity.end;
              ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
            } else {
              drawEntity(ctx, entity, false, true);
            }
          }
        });
      } else if (activeCommand === 'ARC') {
         if (commandStep === 1 && tempPoints.length === 1) {
             ctx.beginPath(); ctx.moveTo(tempPoints[0].x, tempPoints[0].y); ctx.lineTo(cursorPos.x, cursorPos.y); ctx.stroke();
         } else if (commandStep === 2 && tempPoints.length === 2) {
             const p1 = tempPoints[0];
             const p2 = tempPoints[1];
             const p3 = cursorPos;
             const A = p2.x - p1.x, B = p2.y - p1.y;
             const C = p3.x - p1.x, D = p3.y - p1.y;
             const E = A * (p1.x + p2.x) + B * (p1.y + p2.y);
             const F = C * (p1.x + p3.x) + D * (p1.y + p3.y);
             const G = 2 * (A * (p3.y - p2.y) - B * (p3.x - p2.x));
             if (Math.abs(G) > 1e-6) {
                 const cx = (D * E - B * F) / G;
                 const cy = (A * F - C * E) / G;
                 const r = Math.sqrt((p1.x - cx)**2 + (p1.y - cy)**2);
                 let sa = Math.atan2(p1.y - cy, p1.x - cx);
                 let ang2 = Math.atan2(p2.y - cy, p2.x - cx);
                 let ea = Math.atan2(p3.y - cy, p3.x - cx);
                 if (sa < 0) sa += 2*Math.PI;
                 if (ang2 < 0) ang2 += 2*Math.PI;
                 if (ea < 0) ea += 2*Math.PI;
                 
                 let covers = false;
                 if (ea < sa) covers = (ang2 >= sa || ang2 <= ea);
                 else covers = (ang2 >= sa && ang2 <= ea);
                 
                 ctx.beginPath();
                 if (covers) ctx.arc(cx, cy, r, sa, ea);
                 else ctx.arc(cx, cy, r, ea, sa);
                 ctx.stroke();
             }
         }
      } else if (activeCommand === 'POLYGON' && commandStep === 2 && tempPoints.length > 0) {
        const center = tempPoints[0];
        const r = distance(center, cursorPos);
        const sides = Number(typedInputToProcess) || 5; 
        drawEntity(ctx, { id: 'preview', type: 'POLYGON', center: center, radius: r, sides: sides }, false, true);
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

      if (selectionBox) {
        const isLeftToRight = selectionBox.end.x > selectionBox.start.x;
        const width = selectionBox.end.x - selectionBox.start.x;
        const height = selectionBox.end.y - selectionBox.start.y;
        
        ctx.fillStyle = isLeftToRight ? 'rgba(0, 100, 255, 0.2)' : 'rgba(0, 255, 100, 0.2)';
        ctx.strokeStyle = isLeftToRight ? 'rgba(0, 100, 255, 0.8)' : 'rgba(0, 255, 100, 0.8)';
        ctx.lineWidth = 1 / zoom;
        if (!isLeftToRight) ctx.setLineDash([5/zoom, 5/zoom]);
        else ctx.setLineDash([]);
        
        ctx.fillRect(selectionBox.start.x, selectionBox.start.y, width, height);
        ctx.strokeRect(selectionBox.start.x, selectionBox.start.y, width, height);
        ctx.setLineDash([]);
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
      
      // Draw OTRACK acquired points (small crosses)
      if (otrack) {
        ctx.save();
        ctx.strokeStyle = '#4dff4d';
        ctx.lineWidth = 1;
        acquiredPoints.forEach(p => {
          const px = (p.x * zoom) + canvas.width/2 + pan.x;
          const py = (-p.y * zoom) + canvas.height/2 + pan.y;
          ctx.beginPath();
          ctx.moveTo(px - 4, py - 4); ctx.lineTo(px + 4, py + 4);
          ctx.moveTo(px - 4, py + 4); ctx.lineTo(px + 4, py - 4);
          ctx.stroke();
        });
        
        // Draw OTRACK tracking line
        if (trackedPoint) {
          const px = (trackedPoint.x * zoom) + canvas.width/2 + pan.x;
          const py = (-trackedPoint.y * zoom) + canvas.height/2 + pan.y;
          const cx = (cursorPos.x * zoom) + canvas.width/2 + pan.x;
          const cy = (-cursorPos.y * zoom) + canvas.height/2 + pan.y;
          
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(cx, cy);
          
          // extend line
          const extLen = 1000;
          const ang = Math.atan2(cy - py, cx - px);
          ctx.lineTo(cx + Math.cos(ang)*extLen, cy + Math.sin(ang)*extLen);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Draw Polar/Ortho Tracking Line
      if ((ortho || polar) && tempPoints.length > 0 && activeCommand && commandStep > 0 && !trackedPoint) {
        let basePoint: Point | null = tempPoints[0];
        if (typeof basePoint === 'object' && 'x' in basePoint) {
          const dx = Math.abs(cursorPos.x - basePoint.x);
          const dy = Math.abs(cursorPos.y - basePoint.y);
          // Only draw if we actually aligned (ortho or polar angle)
          // For simplicity, just draw a green dashed line from base to cursor if distance > 0
          if (distance(basePoint, cursorPos) > 0.1 && (
               (ortho && (dx < 0.01 || dy < 0.01)) ||
               (polar) // If polar is active, handleMouseMove already snapped it if it was within 5 deg
             )) {
             const bx = (basePoint.x * zoom) + canvas.width/2 + pan.x;
             const by = (-basePoint.y * zoom) + canvas.height/2 + pan.y;
             const cx = (cursorPos.x * zoom) + canvas.width/2 + pan.x;
             const cy = (-cursorPos.y * zoom) + canvas.height/2 + pan.y;
             
             ctx.save();
             ctx.strokeStyle = '#4dff4d';
             ctx.setLineDash([5, 5]);
             ctx.beginPath();
             ctx.moveTo(bx, by);
             ctx.lineTo(cx, cy);
             // extend line slightly past cursor for visual effect
             const extLen = 1000;
             const ang = Math.atan2(cy - by, cx - bx);
             ctx.lineTo(cx + Math.cos(ang)*extLen, cy + Math.sin(ang)*extLen);
             ctx.stroke();
             ctx.restore();
          }
        }
      }

      // Draw Crosshair
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
  }, [pan, zoom, entities, cursorPos, activeCommand, commandStep, tempPoints, selectedIds, snapPoint, selectionBox]);

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
    const snapped = calculateSnap(wPos); 
    let finalPos = snapped;
    setTrackedPoint(null);

    if (otrack) {
      if (snapped !== wPos) {
        if (!acquiredPoints.some(p => distance(p, snapped) < 0.1)) {
          setAcquiredPoints(prev => [...prev, snapped].slice(-3));
        }
      } else {
        const snapDist = 10 / zoom;
        let matched = null;
        for (const p of acquiredPoints) {
          if (Math.abs(wPos.x - p.x) < snapDist) {
            finalPos = { x: p.x, y: wPos.y };
            matched = p;
            break;
          } else if (Math.abs(wPos.y - p.y) < snapDist) {
            finalPos = { x: wPos.x, y: p.y };
            matched = p;
            break;
          }
        }
        if (matched) setTrackedPoint(matched);
      }
    }
    
    // If we didn't snap to an object or track point, apply Ortho / Polar
    if (finalPos === wPos && tempPoints.length > 0 && activeCommand && commandStep > 0) {
      let basePoint: Point | null = tempPoints[0];
      
      // For commands where tempPoints[0] is not a Point but a number/flag, skip ORTHO
      if (typeof basePoint === 'object' && 'x' in basePoint) {
        if (ortho) {
          const dx = Math.abs(wPos.x - basePoint.x);
          const dy = Math.abs(wPos.y - basePoint.y);
          if (dx > dy) {
            finalPos = { x: wPos.x, y: basePoint.y };
          } else {
            finalPos = { x: basePoint.x, y: wPos.y };
          }
        } else if (polar) {
          const dx = wPos.x - basePoint.x;
          const dy = wPos.y - basePoint.y;
          let angle = Math.atan2(dy, dx) * 180 / Math.PI;
          if (angle < 0) angle += 360;
          const dist = distance(basePoint, wPos);
          
          const snapAngle = Math.round(angle / 45) * 45;
          const diff = Math.abs(angle - snapAngle);
          if (diff < 5 || diff > 355) {
            const rad = snapAngle * Math.PI / 180;
            finalPos = { x: basePoint.x + Math.cos(rad) * dist, y: basePoint.y + Math.sin(rad) * dist };
          }
        }
      }
    }
    
    const roundedPos = { x: Math.round(finalPos.x * 2) / 2, y: Math.round(finalPos.y * 2) / 2 };
    const newCursorPos = snapped === wPos && finalPos === wPos ? roundedPos : finalPos;
    
    setCursorPos(newCursorPos);
    onCursorMove(newCursorPos);

    if (isPanning) {
      setPan(prev => ({ x: prev.x + e.clientX - lastMousePos.x, y: prev.y + e.clientY - lastMousePos.y }));
      setLastMousePos({ x: e.clientX, y: e.clientY });
    } else if (selectionBox) {
      setSelectionBox(prev => prev ? { ...prev, end: wPos } : null);
    }
  };

  const handleMouseDown = (e: ReactMouseEvent) => {
    if (e.button === 1 || activeCommand === 'PAN') { 
      setIsPanning(true);
      setLastMousePos({ x: e.clientX, y: e.clientY });
      return;
    }
    if (e.button === 0) {
      setAcquiredPoints([]);
      const wPos = getWorldCoord(e);
      const roundedPos = { x: Math.round(wPos.x * 2) / 2, y: Math.round(wPos.y * 2) / 2 };
      const sp = snapPoint as {point: Point, type: 'endpoint'|'center'} | null;
      const pt = sp ? sp.point : roundedPos;
      
      if (!activeCommand || ((activeCommand === 'MOVE' || activeCommand === 'COPY' || activeCommand === 'ROTATE' || activeCommand === 'SCALE' || activeCommand === 'MIRROR' || activeCommand === 'ARRAY' || activeCommand === 'EXPLODE') && commandStep === 0)) {
         const hitId = hitTest(wPos);
         if (hitId) {
            setSelectedIds(prev => {
              const next = new Set(prev);
              if (next.has(hitId)) next.delete(hitId);
              else next.add(hitId);
              return next;
            });
         } else {
            setSelectionBox({ start: wPos, end: wPos });
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
      
      if (activeCommand === 'EXTEND') {
        const hitId = hitTest(wPos);
        if (hitId) {
          executeExtend(hitId, wPos);
        }
        return;
      }

      handleCommandInput(pt, wPos);
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    if (selectionBox) {
       const isLeftToRight = selectionBox.end.x > selectionBox.start.x;
       const minX = Math.min(selectionBox.start.x, selectionBox.end.x);
       const maxX = Math.max(selectionBox.start.x, selectionBox.end.x);
       const minY = Math.min(selectionBox.start.y, selectionBox.end.y);
       const maxY = Math.max(selectionBox.start.y, selectionBox.end.y);
       
       const newSelected = new Set<string>();
       entities.forEach(entity => {
           let inside = false;
           let intersect = false;
           
           const ptInside = (pt: Point) => pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY;
           
           if (entity.type === 'LINE') {
               inside = ptInside(entity.start) && ptInside(entity.end);
               intersect = inside || ptInside(entity.start) || ptInside(entity.end);
               if (!intersect) {
                   const segs = [
                       {p1: {x: minX, y: minY}, p2: {x: maxX, y: minY}},
                       {p1: {x: maxX, y: minY}, p2: {x: maxX, y: maxY}},
                       {p1: {x: maxX, y: maxY}, p2: {x: minX, y: maxY}},
                       {p1: {x: minX, y: maxY}, p2: {x: minX, y: minY}}
                   ];
                   intersect = segs.some(seg => getLineSegmentIntersection(entity.start, entity.end, seg.p1, seg.p2) !== null);
               }
           } else if (entity.type === 'RECTANGLE') {
               inside = ptInside(entity.p1) && ptInside(entity.p2);
               const rMinX = Math.min(entity.p1.x, entity.p2.x);
               const rMaxX = Math.max(entity.p1.x, entity.p2.x);
               const rMinY = Math.min(entity.p1.y, entity.p2.y);
               const rMaxY = Math.max(entity.p1.y, entity.p2.y);
               intersect = !(rMaxX < minX || rMinX > maxX || rMaxY < minY || rMinY > maxY);
           } else if (entity.type === 'CIRCLE') {
               inside = (entity.center.x - entity.radius >= minX) && (entity.center.x + entity.radius <= maxX) &&
                        (entity.center.y - entity.radius >= minY) && (entity.center.y + entity.radius <= maxY);
               const closestX = Math.max(minX, Math.min(entity.center.x, maxX));
               const closestY = Math.max(minY, Math.min(entity.center.y, maxY));
               const dx = entity.center.x - closestX;
               const dy = entity.center.y - closestY;
               intersect = (dx * dx + dy * dy) <= (entity.radius * entity.radius);
           }
           
           if (inside || (!isLeftToRight && intersect)) {
               newSelected.add(entity.id);
           }
       });

       if (newSelected.size > 0) {
           setSelectedIds(prev => new Set([...prev, ...newSelected]));
       }
       setSelectionBox(null);
    }
  };

  const handleWheel = (e: ReactWheelEvent) => {
    e.preventDefault();
    const direction = e.deltaY < 0 ? 1 : -1;
    setZoom(prev => Math.max(2, prev * (direction > 0 ? 1.1 : 0.9)));
  };

  const handleCommandInput = (input: Point | number | string, rawWPos?: Point) => {
    if (activeCommand === 'STRETCH') {
       const pt = typeof input === 'object' ? input : { x: 0, y: 0 };
       if (commandStep === 0) {
           setTempPoints([pt]);
           setCommandStep(1);
       } else if (commandStep === 1) {
           const p1 = tempPoints[0];
           const p2 = pt;
           const minX = Math.min(p1.x, p2.x);
           const maxX = Math.max(p1.x, p2.x);
           const minY = Math.min(p1.y, p2.y);
           const maxY = Math.max(p1.y, p2.y);
           
           const ptsToStretch: {id: string, isStart: boolean}[] = [];
           entities.forEach(e => {
               if (e.type === 'LINE') {
                   if (e.start.x >= minX && e.start.x <= maxX && e.start.y >= minY && e.start.y <= maxY) {
                       ptsToStretch.push({ id: e.id, isStart: true });
                   }
                   if (e.end.x >= minX && e.end.x <= maxX && e.end.y >= minY && e.end.y <= maxY) {
                       ptsToStretch.push({ id: e.id, isStart: false });
                   }
               }
           });
           setStretchedPoints(ptsToStretch);
           setTempPoints([]); 
           setCommandStep(2);
       } else if (commandStep === 2) {
           setTempPoints([pt]);
           setCommandStep(3);
       } else if (commandStep === 3) {
           const basePoint = tempPoints[0];
           const dx = pt.x - basePoint.x;
           const dy = pt.y - basePoint.y;
           
           setEntities(prev => prev.map(e => {
               if (e.type !== 'LINE') return e;
               let newStart = { ...e.start };
               let newEnd = { ...e.end };
               
               const stretchStart = stretchedPoints.find(p => p.id === e.id && p.isStart);
               const stretchEnd = stretchedPoints.find(p => p.id === e.id && !p.isStart);
               
               if (stretchStart) {
                   newStart.x += dx; newStart.y += dy;
               }
               if (stretchEnd) {
                   newEnd.x += dx; newEnd.y += dy;
               }
               
               if (stretchStart || stretchEnd) {
                   return { ...e, start: newStart, end: newEnd };
               }
               return e;
           }));
           onCommandComplete();
       }
       return;
    }

    if (activeCommand === 'POLYGON') {
       if (commandStep === 0) {
          const s = Number(input);
          if (!isNaN(s) && s >= 3) {
             setTempPoints([{x: s, y: s}]);
             setCommandStep(1);
          } else {
             onPromptChange('POLYGON Requires an integer between 3 and 1024');
             setTimeout(() => setCommandStep(s => s), 2000);
          }
       } else if (commandStep === 1) {
          setTempPoints(prev => [...prev, typeof input === 'object' ? input as Point : {x:0, y:0}]);
          setCommandStep(2);
       } else if (commandStep === 2) {
          const sides = tempPoints[0].x; 
          const center = tempPoints[1];
          const r = typeof input === 'number' ? input : distance(center, input as Point);
          setEntities(prev => [...prev, { id: generateId(), type: 'POLYGON', center: center, radius: r, sides: sides }]);
          onCommandComplete();
       }
       return;
    }

    if (activeCommand === 'ARC') {
        if (typeof input !== 'object' || !('x' in input)) return;
        const pt = input as Point;
        if (commandStep === 0) {
            setTempPoints([pt]);
            setCommandStep(1);
        } else if (commandStep === 1) {
            setTempPoints(prev => [...prev, pt]);
            setCommandStep(2);
        } else if (commandStep === 2) {
             const p1 = tempPoints[0];
             const p2 = tempPoints[1];
             const p3 = pt;
             const A = p2.x - p1.x, B = p2.y - p1.y;
             const C = p3.x - p1.x, D = p3.y - p1.y;
             const E = A * (p1.x + p2.x) + B * (p1.y + p2.y);
             const F = C * (p1.x + p3.x) + D * (p1.y + p3.y);
             const G = 2 * (A * (p3.y - p2.y) - B * (p3.x - p2.x));
             if (Math.abs(G) > 1e-6) {
                 const cx = (D * E - B * F) / G;
                 const cy = (A * F - C * E) / G;
                 const r = Math.sqrt((p1.x - cx)**2 + (p1.y - cy)**2);
                 let sa = Math.atan2(p1.y - cy, p1.x - cx);
                 let ang2 = Math.atan2(p2.y - cy, p2.x - cx);
                 let ea = Math.atan2(p3.y - cy, p3.x - cx);
                 if (sa < 0) sa += 2*Math.PI;
                 if (ang2 < 0) ang2 += 2*Math.PI;
                 if (ea < 0) ea += 2*Math.PI;
                 
                 let covers = false;
                 if (ea < sa) covers = (ang2 >= sa || ang2 <= ea);
                 else covers = (ang2 >= sa && ang2 <= ea);
                 
                 setEntities(prev => [...prev, {
                     id: generateId(),
                     type: 'CIRCULAR_ARC',
                     center: {x: cx, y: cy},
                     radius: r,
                     startAngle: covers ? sa : ea,
                     endAngle: covers ? ea : sa
                 }]);
             }
             onCommandComplete();
        }
        return;
    }

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
      }
    } else if (activeCommand === 'OFFSET' && commandStep === 0) {
        if (typeof input === 'number') {
            setTempPoints([{ x: input, y: 0 }]); 
            setCommandStep(1);
        }
    } else if (activeCommand === 'ARRAY' && commandStep === 1) {
        if (typeof input !== 'object' || !('x' in input)) return;
        const pt = input as Point;
        setTempPoints([pt]);
        setCommandStep(2);
    } else if (activeCommand === 'OFFSET' && commandStep === 1) {
        if (typeof input !== 'object' || !('x' in input)) return;
        const pt = input as Point;
        const clickPos = rawWPos || pt;
        const hitId = hitTest(clickPos);
        if (hitId) {
            setSelectedIds(new Set([hitId]));
            setCommandStep(2);
        }
    } else if (activeCommand === 'OFFSET' && commandStep === 2) {
        if (typeof input !== 'object' || !('x' in input)) return;
        const pt = input as Point;
        const clickPos = rawWPos || pt;
        
        const dist = tempPoints[0].x;
        const targetId = Array.from(selectedIds)[0];
        const target = entities.find(e => e.id === targetId);
        
        if (target) {
            if (target.type === 'CIRCLE') {
                const dCenter = distance(clickPos, target.center);
                const isOutside = dCenter > target.radius;
                const r = isOutside ? target.radius + dist : target.radius - dist;
                if (r > 0) setEntities(prev => [...prev, { ...target, id: generateId(), radius: r }]);
            } else if (target.type === 'RECTANGLE') {
                const cx = (target.p1.x + target.p2.x) / 2;
                const cy = (target.p1.y + target.p2.y) / 2;
                const rMinX = Math.min(target.p1.x, target.p2.x);
                const rMaxX = Math.max(target.p1.x, target.p2.x);
                const rMinY = Math.min(target.p1.y, target.p2.y);
                const rMaxY = Math.max(target.p1.y, target.p2.y);
                const isInside = clickPos.x >= rMinX && clickPos.x <= rMaxX && clickPos.y >= rMinY && clickPos.y <= rMaxY;
                const d = isInside ? -dist : dist;
                const w = Math.abs(target.p2.x - target.p1.x);
                const h = Math.abs(target.p2.y - target.p1.y);
                if (w + 2*d > 0 && h + 2*d > 0) {
                    const p1 = { x: cx - (w/2 + d), y: cy - (h/2 + d) };
                    const p2 = { x: cx + (w/2 + d), y: cy + (h/2 + d) };
                    setEntities(prev => [...prev, { ...target, id: generateId(), p1, p2 }]);
                }
            } else if (target.type === 'LINE') {
                const dx = target.end.x - target.start.x;
                const dy = target.end.y - target.start.y;
                const len = Math.sqrt(dx*dx + dy*dy);
                if (len > 0) {
                    const nx = -dy / len;
                    const ny = dx / len;
                    const cross = dx * (clickPos.y - target.start.y) - dy * (clickPos.x - target.start.x);
                    const dir = cross > 0 ? 1 : -1;
                    const start = { x: target.start.x + nx * dist * dir, y: target.start.y + ny * dist * dir };
                    const end = { x: target.end.x + nx * dist * dir, y: target.end.y + ny * dist * dir };
                    setEntities(prev => [...prev, { ...target, id: generateId(), start, end }]);
                }
            }
        }
        onCommandComplete();
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
    } else if (activeCommand === 'FILLET' || activeCommand === 'CHAMFER') {
        if (commandStep === 0 && typeof input === 'number') {
            setTempPoints([{ x: input, y: 0 }]); // store radius or distance
            setCommandStep(1);
        } else if (commandStep === 1) {
            if (typeof input !== 'object' || !('x' in input)) return;
            const pt = input as Point;
            const clickPos = rawWPos || pt;
            const hitId = hitTest(clickPos);
            if (hitId) {
                const target = entities.find(e => e.id === hitId);
                if (target && target.type === 'RECTANGLE') {
                    const val = tempPoints[0].x;
                    setEntities(prev => {
                        const next = [...prev];
                        const idx = next.findIndex(e => e.id === hitId);
                        if (idx >= 0) {
                            if (activeCommand === 'FILLET') {
                                next[idx] = { ...target, filletRadius: val, chamferDist: 0 };
                            } else {
                                next[idx] = { ...target, chamferDist: val, filletRadius: 0 };
                            }
                        }
                        return next;
                    });
                    onCommandComplete();
                } else if (target && target.type === 'LINE') {
                    setSelectedIds(new Set([hitId]));
                    setCommandStep(2);
                }
            }
        } else if (commandStep === 2) {
            if (typeof input !== 'object' || !('x' in input)) return;
            const pt = input as Point;
            const clickPos = rawWPos || pt;
            const hitId = hitTest(clickPos);
            if (hitId) {
                const target2 = entities.find(e => e.id === hitId);
                const target1Id = Array.from(selectedIds)[0];
                const target1 = entities.find(e => e.id === target1Id);
                if (target1 && target2 && target1.type === 'LINE' && target2.type === 'LINE' && target1.id !== target2.id) {
                    const val = tempPoints[0].x;
                    
                    const p1 = target1.start, p2 = target1.end;
                    const p3 = target2.start, p4 = target2.end;
                    const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
                    if (Math.abs(denom) > 1e-6) {
                        const xi = ((p3.x - p4.x) * (p1.x * p2.y - p1.y * p2.x) - (p1.x - p2.x) * (p3.x * p4.y - p3.y * p4.x)) / denom;
                        const yi = ((p3.y - p4.y) * (p1.x * p2.y - p1.y * p2.x) - (p1.y - p2.y) * (p3.x * p4.y - p3.y * p4.x)) / denom;
                        const P = { x: xi, y: yi };
                        
                        const d1s = distance(P, target1.start);
                        const d1e = distance(P, target1.end);
                        const keep1 = d1s > d1e ? target1.start : target1.end;
                        
                        const d2s = distance(P, target2.start);
                        const d2e = distance(P, target2.end);
                        const keep2 = d2s > d2e ? target2.start : target2.end;
                        
                        const v1 = { x: keep1.x - P.x, y: keep1.y - P.y };
                        const v2 = { x: keep2.x - P.x, y: keep2.y - P.y };
                        const len1 = Math.hypot(v1.x, v1.y);
                        const len2 = Math.hypot(v2.x, v2.y);
                        
                        if (len1 > 0 && len2 > 0) {
                            const u = { x: v1.x / len1, y: v1.y / len1 };
                            const v = { x: v2.x / len2, y: v2.y / len2 };
                            const dotVal = Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y));
                            const theta = Math.acos(dotVal);
                            
                            if (theta > 0.01) {
                                const d = activeCommand === 'FILLET' ? val / Math.tan(theta / 2) : val;
                                const T1 = { x: P.x + u.x * d, y: P.y + u.y * d };
                                const T2 = { x: P.x + v.x * d, y: P.y + v.y * d };
                                
                                setEntities(prev => {
                                    const next = [...prev];
                                    const idx1 = next.findIndex(e => e.id === target1.id);
                                    const idx2 = next.findIndex(e => e.id === target2.id);
                                    if (idx1 >= 0) next[idx1] = { ...target1, start: keep1, end: T1 };
                                    if (idx2 >= 0) next[idx2] = { ...target2, start: keep2, end: T2 };
                                    if (val > 0) {
                                        if (activeCommand === 'FILLET') {
                                            next.push({ id: generateId(), type: 'ARC', start: T1, control: P, end: T2, radius: val });
                                        } else {
                                            next.push({ id: generateId(), type: 'LINE', start: T1, end: T2 });
                                        }
                                    }
                                    return next;
                                });
                            }
                        }
                    }
                }
                setSelectedIds(new Set());
                onCommandComplete();
            }
        }
    } else if (activeCommand === 'ARRAY') {
        if (commandStep === 1 && typeof input === 'string') {
            const t = input.trim().toUpperCase();
            if (t === 'R' || t === 'RECTANGULAR') {
                setTempPoints([{ x: 0, y: 0 }]); // 0 means Rectangular
                setCommandStep(2);
            } else if (t === 'P' || t === 'POLAR') {
                setTempPoints([{ x: 1, y: 0 }]); // 1 means Polar
                setCommandStep(2);
            }
        } else if (commandStep === 2) {
            const isPolar = tempPoints[0].x === 1;
            if (isPolar && typeof input === 'object' && 'x' in input) {
                setTempPoints(prev => [...prev, input]); // prev[1] is center
                setCommandStep(3);
            } else if (!isPolar && typeof input === 'number') {
                setTempPoints(prev => [{ ...prev[0], y: input }]); // y is cols
                setCommandStep(3);
            }
        } else if (commandStep === 3 && typeof input === 'number') {
            const isPolar = tempPoints[0].x === 1;
            if (isPolar) {
                setTempPoints(prev => [...prev, { x: input, y: 0 }]); // prev[2].x is items
                setCommandStep(4);
            } else {
                setTempPoints(prev => [...prev, { x: input, y: 0 }]); // prev[1].x is rows
                setCommandStep(4);
            }
        } else if (commandStep === 4 && typeof input === 'number') {
            const isPolar = tempPoints[0].x === 1;
            if (isPolar) {
                const center = tempPoints[1];
                const items = tempPoints[2].x;
                const angleFill = input;
                const angleStep = items > 1 ? angleFill / items : 0;
                
                setEntities(prev => {
                    const next = [...prev];
                    const selected = Array.from(selectedIds).map(id => prev.find(e => e.id === id)).filter(Boolean) as Entity[];
                    for (let i = 1; i < items; i++) {
                        const ang = i * angleStep;
                        selected.forEach(e => {
                            if (e.type === 'LINE') next.push({ ...e, id: generateId(), start: rotatePoint(e.start, center, ang), end: rotatePoint(e.end, center, ang) });
                            else if (e.type === 'CIRCLE') next.push({ ...e, id: generateId(), center: rotatePoint(e.center, center, ang) });
                            else if (e.type === 'RECTANGLE') next.push({ ...e, id: generateId(), type: 'LINE', start: rotatePoint(e.p1, center, ang), end: rotatePoint(e.p2, center, ang) });
                            else if (e.type === 'ARC') next.push({ ...e, id: generateId(), start: rotatePoint(e.start, center, ang), control: rotatePoint(e.control, center, ang), end: rotatePoint(e.end, center, ang) });
                        });
                    }
                    return next;
                });
                onCommandComplete();
            } else {
                setTempPoints(prev => [{ ...prev[0] }, { ...prev[1], y: input }]); // prev[1].y is colSpacing
                setCommandStep(5);
            }
        } else if (commandStep === 5 && typeof input === 'number') {
            const cols = tempPoints[0].y;
            const rows = tempPoints[1].x;
            const colSpacing = tempPoints[1].y;
            const rowSpacing = input;
            
            setEntities(prev => {
                const next = [...prev];
                const selected = Array.from(selectedIds).map(id => prev.find(e => e.id === id)).filter(Boolean) as Entity[];
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        if (r === 0 && c === 0) continue; // Original is already there
                        const dx = c * colSpacing;
                        const dy = r * rowSpacing;
                        selected.forEach(e => {
                            if (e.type === 'LINE') next.push({ ...e, id: generateId(), start: {x: e.start.x + dx, y: e.start.y + dy}, end: {x: e.end.x + dx, y: e.end.y + dy} });
                            else if (e.type === 'CIRCLE') next.push({ ...e, id: generateId(), center: {x: e.center.x + dx, y: e.center.y + dy} });
                            else if (e.type === 'RECTANGLE') next.push({ ...e, id: generateId(), p1: {x: e.p1.x + dx, y: e.p1.y + dy}, p2: {x: e.p2.x + dx, y: e.p2.y + dy} });
                            else if (e.type === 'ARC') next.push({ ...e, id: generateId(), start: {x: e.start.x + dx, y: e.start.y + dy}, control: {x: e.control.x + dx, y: e.control.y + dy}, end: {x: e.end.x + dx, y: e.end.y + dy} });
                        });
                    }
                }
                return next;
            });
            onCommandComplete();
        }
    } else if (activeCommand === 'TEXT') {
        if (commandStep === 0 && typeof input === 'object' && 'x' in input) {
            setTempPoints([input]);
            setCommandStep(1);
        } else if (commandStep === 1 && typeof input === 'number') {
            setTempPoints(prev => [...prev, { x: input, y: 0 }]); // x represents height
            setCommandStep(2);
        } else if (commandStep === 2 && typeof input === 'string') {
            const start = tempPoints[0];
            const height = tempPoints[1].x;
            setEntities(prev => [...prev, { id: generateId(), type: 'TEXT', start, text: input, height }]);
            onCommandComplete();
        }
    } else if (activeCommand === 'DIMENSION') {
        if (commandStep === 0 && typeof input === 'object' && 'x' in input) {
            setTempPoints([input]);
            setCommandStep(1);
        } else if (commandStep === 1 && typeof input === 'object' && 'x' in input) {
            setTempPoints(prev => [...prev, input]);
            setCommandStep(2);
        } else if (commandStep === 2 && typeof input === 'object' && 'x' in input) {
            const p1 = tempPoints[0];
            const p2 = tempPoints[1];
            const dimLinePos = input;
            const dist = Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2)).toFixed(2);
            setEntities(prev => [...prev, { id: generateId(), type: 'DIMENSION', p1, p2, dimLinePos, text: dist }]);
            onCommandComplete();
        }
    } else if (activeCommand === 'DIMALIGNED') {
        if (commandStep === 0 && typeof input === 'object' && 'x' in input) {
            setTempPoints([input]);
            setCommandStep(1);
        } else if (commandStep === 1 && typeof input === 'object' && 'x' in input) {
            setTempPoints(prev => [...prev, input]);
            setCommandStep(2);
        } else if (commandStep === 2 && typeof input === 'object' && 'x' in input) {
            const p1 = tempPoints[0];
            const p2 = tempPoints[1];
            const dimLinePos = input;
            const dist = distance(p1, p2).toFixed(2);
            setEntities(prev => [...prev, { id: generateId(), type: 'DIM_ALIGNED', p1, p2, dimLinePos, text: dist }]);
            onCommandComplete();
        }
    } else if (activeCommand === 'DIMANGULAR') {
        if (commandStep === 0 && typeof input === 'object' && 'x' in input) {
            setTempPoints([input]);
            setCommandStep(1);
        } else if (commandStep === 1 && typeof input === 'object' && 'x' in input) {
            setTempPoints(prev => [...prev, input]);
            setCommandStep(2);
        } else if (commandStep === 2 && typeof input === 'object' && 'x' in input) {
            setTempPoints(prev => [...prev, input]);
            setCommandStep(3);
        } else if (commandStep === 3 && typeof input === 'object' && 'x' in input) {
            const center = tempPoints[0];
            const p1 = tempPoints[1];
            const p2 = tempPoints[2];
            const dimLinePos = input;
            
            const a1 = Math.atan2(p1.y - center.y, p1.x - center.x);
            const a2 = Math.atan2(p2.y - center.y, p2.x - center.x);
            let diff = Math.abs(a1 - a2) * (180 / Math.PI);
            
            // Adjust diff based on click point
            let startA = a1 < 0 ? a1 + 2*Math.PI : a1;
            let endA = a2 < 0 ? a2 + 2*Math.PI : a2;
            let clickA = Math.atan2(dimLinePos.y - center.y, dimLinePos.x - center.x);
            if (clickA < 0) clickA += 2*Math.PI;
            
            let inArc = false;
            if (startA < endA) {
               inArc = clickA >= startA && clickA <= endA;
            } else {
               inArc = clickA >= startA || clickA <= endA;
            }
            if (!inArc) {
                diff = 360 - diff;
            }
            
            setEntities(prev => [...prev, { id: generateId(), type: 'DIM_ANGULAR', center, p1, p2, dimLinePos, text: diff.toFixed(1) }]);
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
         } else if (activeCommand === 'EXPLODE' && commandStep === 0) {
           if (selectedIds.size > 0) {
             setEntities(prev => {
               const next = [...prev];
               selectedIds.forEach(id => {
                 const idx = next.findIndex(e => e.id === id);
                 if (idx >= 0) {
                   const e = next[idx];
                   if (e.type === 'RECTANGLE') {
                     next.splice(idx, 1);
                     next.push({ id: generateId(), type: 'LINE', start: e.p1, end: { x: e.p2.x, y: e.p1.y } });
                     next.push({ id: generateId(), type: 'LINE', start: { x: e.p2.x, y: e.p1.y }, end: e.p2 });
                     next.push({ id: generateId(), type: 'LINE', start: e.p2, end: { x: e.p1.x, y: e.p2.y } });
                     next.push({ id: generateId(), type: 'LINE', start: { x: e.p1.x, y: e.p2.y }, end: e.p1 });
                   } else if (e.type === 'POLYGON') {
                     next.splice(idx, 1);
                     for (let i = 0; i < e.sides; i++) {
                       const a1 = -Math.PI / 2 + i * (2 * Math.PI / e.sides);
                       const a2 = -Math.PI / 2 + (i + 1) * (2 * Math.PI / e.sides);
                       next.push({ 
                         id: generateId(), type: 'LINE', 
                         start: { x: e.center.x + e.radius * Math.cos(a1), y: e.center.y + e.radius * Math.sin(a1) },
                         end: { x: e.center.x + e.radius * Math.cos(a2), y: e.center.y + e.radius * Math.sin(a2) }
                       });
                     }
                   }
                 }
               });
               return next;
             });
             onCommandComplete();
           }
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
