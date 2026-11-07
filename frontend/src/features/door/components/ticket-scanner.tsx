import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { CODE_RUNNING } from '../arrival';
import { createScanGate, readScannedCode } from '../scan';
import { useCameraReader, type CameraState } from './use-camera';
import type { Door } from './use-door';

interface TicketScannerProps {
  door: Pick<Door, 'state' | 'actions'>;
  /** What became of a code sent: `false` is one the typed field keeps (no answer, a typo, too many tries). */
  onAnswer: (code: string, isDone: boolean) => void;
}

function useTicketScan({ door, onAnswer }: TicketScannerProps) {
  const [gate] = useState(createScanGate);
  const [isNotTicket, setIsNotTicket] = useState(false);
  const lastSent = useRef<string | null>(null);
  const send = async (code: string) => {
    // "Probably your earlier press" is about the same code, and the last answer about the last guest.
    if (code !== lastSent.current) door.actions.codeEdited();
    lastSent.current = code;
    door.actions.dismiss();
    onAnswer(code, await door.actions.admit(code));
  };
  const camera = useCameraReader((read) => {
    const scanned = readScannedCode(read);
    setIsNotTicket(scanned.kind === 'notTicket');
    if (scanned.kind !== 'ticket') return;
    if (gate.offer(scanned.code, Date.now(), door.state.running === null)) {
      void send(scanned.code);
    }
  });
  return { camera, isNotTicket, clearNotTicket: () => setIsNotTicket(false) };
}

function StatusWord({ words }: { words: string }) {
  return (
    <p role="status" className="m-0 text-sm font-medium">
      {words}
    </p>
  );
}

function ScannerWords({
  state,
  isSending,
  isNotTicket,
}: {
  state: CameraState;
  isSending: boolean;
  isNotTicket: boolean;
}) {
  const { t } = useTranslation('door');
  if (state.kind === 'problem') {
    return (
      <p role="alert" className="text-destructive m-0 text-sm">
        {t(`scan.problem.${state.problem}`)}
      </p>
    );
  }
  if (state.kind === 'opening') return <StatusWord words={t('scan.opening')} />;
  if (state.kind !== 'on') return null;
  return (
    <>
      {isSending ? <StatusWord words={t('scan.sending')} /> : null}
      {isNotTicket ? <StatusWord words={t('scan.notTicket')} /> : null}
    </>
  );
}

/**
 * Admitting a ticket by its QR code (design PD-173, PD-174). What it reads goes through
 * `readScannedCode`, so a guest's personal link never reaches a request, and a code in view goes once.
 * The answer is the door's usual result line. The typed field below is the way in when this fails.
 */
export function TicketScanner({ door, onAnswer }: TicketScannerProps) {
  const { t } = useTranslation('door');
  const { camera, isNotTicket, clearNotTicket } = useTicketScan({ door, onAnswer });
  const { state, video, open, close } = camera;
  const scanner = useRef<HTMLDivElement>(null);
  const isWatching = state.kind === 'on';
  useEffect(() => {
    // Below the fold on a phone otherwise, with the door's answer over what shows. The whole scanner, so
    // its Stop stays on the screen with the picture.
    if (isWatching) scanner.current?.scrollIntoView({ block: 'start' });
  }, [isWatching]);
  const isOpen = state.kind === 'opening' || isWatching;
  const press = () => {
    clearNotTicket();
    if (isOpen) close();
    else void open();
  };
  return (
    <div ref={scanner} className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        className={`${WRAPPING_BUTTON} self-start`}
        onClick={press}
      >
        {t(isOpen ? 'scan.close' : 'scan.open')}
      </Button>
      <ScannerWords
        state={state}
        isSending={door.state.running === CODE_RUNNING}
        isNotTicket={isNotTicket}
      />
      {isOpen ? (
        <video
          ref={video}
          aria-label={t('scan.viewfinder')}
          muted
          playsInline
          className="bg-muted aspect-square w-full max-w-[24rem] object-cover"
        />
      ) : null}
      {isWatching ? <p className="m-0 text-sm">{t('scan.hint')}</p> : null}
    </div>
  );
}
