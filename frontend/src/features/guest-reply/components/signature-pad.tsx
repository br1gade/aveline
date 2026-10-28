import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Icon } from '@/ui';

import { fieldId } from '../fields';
import {
  extendStroke,
  hasInk,
  PAD_HEIGHT,
  PAD_WIDTH,
  startStroke,
  toCanvasPoint,
  type Point,
  type Stroke,
} from '../strokes';
import { useFieldError, useReplyForm } from './form-context';

type PadState = 'drawing' | 'uploading' | 'checking' | 'ready' | 'failed';

/** One segment, or a dot for a tap, in the ink colour the canvas inherits from its tokens. */
function drawSegment(canvas: HTMLCanvasElement, from: Point, to: Point) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.strokeStyle = getComputedStyle(canvas).color;
  context.lineWidth = 4;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
  canvas?.getContext('2d')?.clearRect(0, 0, PAD_WIDTH, PAD_HEIGHT);
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Pointer events onto strokes, drawn as they come: a re-render per move would lag on a phone. */
function usePen(canvasRef: RefObject<HTMLCanvasElement | null>, isLocked: boolean) {
  const strokes = useRef<Stroke[]>([]);
  const pointOf = (event: PointerEvent<HTMLCanvasElement>) =>
    toCanvasPoint(
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
    );
  const down = (event: PointerEvent<HTMLCanvasElement>) => {
    if (isLocked) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = pointOf(event);
    strokes.current = startStroke(strokes.current, point);
    drawSegment(event.currentTarget, point, point);
  };
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (isLocked || !event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
    const point = pointOf(event);
    const previous = strokes.current.at(-1)?.at(-1) ?? point;
    strokes.current = extendStroke(strokes.current, point);
    drawSegment(event.currentTarget, previous, point);
  };
  const clear = () => {
    strokes.current = [];
    clearCanvas(canvasRef.current);
  };
  /** Read when "Use this signature" is pressed, never while rendering. */
  const isInked = () => hasInk(strokes.current);
  return { down, move, clear, isInked };
}

function PadStatus({ state }: { state: PadState }) {
  const { t } = useTranslation('reply');
  const words: Record<PadState, string> = {
    drawing: '',
    uploading: t('pad.uploading'),
    checking: t('pad.checking'),
    ready: t('pad.ready'),
    failed: t('pad.failed'),
  };
  return (
    <p role="status" className="text-ink-muted m-0 flex items-center gap-2 text-sm leading-5">
      {state === 'ready' ? <Icon name="check" size={16} /> : null}
      {words[state]}
    </p>
  );
}

/**
 * Saving the drawing: uploaded, checked, then its id set on the form; drawing again forgets the
 * last one. A page left while it waits stops waiting.
 */
function useDrawingUpload(questionId: string, canvasRef: RefObject<HTMLCanvasElement | null>) {
  const { t } = useTranslation('reply');
  const { form, signing } = useReplyForm();
  const [state, setState] = useState<PadState>('drawing');
  const [hint, setHint] = useState('');
  const abort = useRef<AbortController | null>(null);
  const pen = usePen(canvasRef, state !== 'drawing');
  const path = `signatures.${questionId}` as const;
  useEffect(() => () => abort.current?.abort(), []);

  const use = async () => {
    const canvas = canvasRef.current;
    const drawing = canvas && pen.isInked() ? await canvasBlob(canvas) : null;
    if (!drawing) {
      setHint(t('pad.empty'));
      return;
    }
    setHint('');
    setState('uploading');
    const controller = new AbortController();
    abort.current = controller;
    const id = await signing
      .upload(drawing, controller.signal, () => setState('checking'))
      .catch(() => null);
    if (controller.signal.aborted) return;
    setState(id ? 'ready' : 'failed');
    if (id) form.setValue(`${path}.assetId`, id, { shouldValidate: form.formState.isSubmitted });
  };
  const again = () => {
    const previous = form.getValues(`${path}.assetId`);
    if (previous) signing.remove(previous);
    form.setValue(`${path}.assetId`, '');
    pen.clear();
    setState('drawing');
  };
  const typeInstead = () => form.setValue(`${path}.method`, 'TYPED');
  return { state, hint, pen, use, again, typeInstead };
}

function PadActions({ upload }: { upload: ReturnType<typeof useDrawingUpload> }) {
  const { t } = useTranslation('reply');
  const { state, pen } = upload;
  return (
    <div className="flex flex-wrap gap-3">
      {state === 'drawing' ? (
        <>
          <Button variant="secondary" onClick={() => void upload.use()}>
            {t('pad.use')}
          </Button>
          <Button variant="quiet" onClick={pen.clear}>
            {t('pad.clear')}
          </Button>
        </>
      ) : null}
      {state === 'ready' || state === 'failed' ? (
        <Button variant="secondary" onClick={upload.again}>
          {t('pad.again')}
        </Button>
      ) : null}
      <Button variant="quiet" onClick={upload.typeInstead}>
        {t('pad.typeInstead')}
      </Button>
    </div>
  );
}

/**
 * Drawing a signature (design PD-52): a plain canvas, no library, with pointer events for finger,
 * pen and mouse. "Type your name instead" is always offered, the alternative for anyone who
 * cannot draw (WCAG 2.5.7). Once drawn, the image is uploaded and checked before it can sign.
 */
export function SignaturePad({ questionId }: { questionId: string }) {
  const { t } = useTranslation('reply');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const upload = useDrawingUpload(questionId, canvasRef);
  const path = `signatures.${questionId}` as const;
  const error = useFieldError(`${path}.assetId`);
  const helpId = `${fieldId(path)}-pad-help`;
  return (
    <div id={fieldId(`${path}.assetId`)} tabIndex={-1} className="grid gap-3 focus:outline-none">
      <p id={helpId} className="text-ink-muted m-0 text-sm leading-5">
        {t('pad.help')}
      </p>
      <canvas
        ref={canvasRef}
        width={PAD_WIDTH}
        height={PAD_HEIGHT}
        role="img"
        aria-label={t('pad.label')}
        aria-describedby={helpId}
        className="border-control-edge bg-porcelain text-ink aspect-[3/1] w-full touch-none border"
        onPointerDown={upload.pen.down}
        onPointerMove={upload.pen.move}
      />
      {error ? <p className="text-error m-0 text-sm leading-5">{error}</p> : null}
      {upload.hint ? <p className="text-error m-0 text-sm leading-5">{upload.hint}</p> : null}
      <PadStatus state={upload.state} />
      <PadActions upload={upload} />
    </div>
  );
}
