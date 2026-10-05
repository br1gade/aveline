import { Logger } from '@nestjs/common';
import { MessageChannel } from '@prisma/client';
import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { DeliveryResult, MessageTransport, OutboundMessage } from './message-channel';

/**
 * The part of a send result this transport reads.
 *
 * Declared here rather than imported: nodemailer's own result type varies by
 * which built-in transport is in use, and naming only the three fields that
 * matter keeps the compiler checking them instead of handing back `any`.
 */
interface SendResult {
  accepted?: unknown[];
  messageId?: string;
  response?: string;
}

export interface SmtpSettings {
  host: string;
  port: number;
  /** True for implicit TLS on 465; false lets STARTTLS upgrade a plain port. */
  isSecure: boolean;
  user?: string;
  password?: string;
  /** What recipients see, e.g. "Aveline <hello@aveline.am>". */
  from: string;
}

/**
 * Email over SMTP.
 *
 * Plain SMTP rather than a provider SDK on purpose. Google Workspace is where
 * this starts, and its ~500/day limit means a 400-guest wedding plus reminders
 * will outgrow it — writing against SMTP keeps that migration a change of
 * credentials rather than a change of code, because every transactional
 * provider speaks it.
 *
 * Failures are deliberately not caught here. The dispatcher classifies them
 * (see `delivery-outcome.ts`) and that decision — retry, bounce, or flag our
 * own configuration — needs the provider's own error, not a swallowed one.
 */
export class SmtpTransport implements MessageTransport {
  readonly channel = MessageChannel.EMAIL;

  private readonly logger = new Logger(SmtpTransport.name);
  private readonly transporter: Transporter;

  constructor(
    private readonly settings: SmtpSettings,
    transporter?: Transporter,
  ) {
    this.transporter =
      transporter ??
      createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.isSecure,
        auth: settings.user ? { user: settings.user, pass: settings.password } : undefined,
        // One connection reused across a batch. A 400-guest send opening 400
        // connections is what gets a sending domain rate-limited.
        pool: true,
        maxConnections: 3,
        maxMessages: 100,
        // Bounded, so a hung provider cannot hold the dispatcher open: the
        // sweep runs again shortly and the message is still queued.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const info = (await this.transporter.sendMail({
      from: this.settings.from,
      to: message.toAddress,
      subject: message.subject ?? '',
      text: message.body,
      // Templates are authored as text, so the HTML part is the same content
      // with line breaks preserved rather than a second thing to keep in sync.
      html: asHtml(message.body),
    })) as SendResult;

    const wasAccepted = (info.accepted ?? []).length > 0;
    if (!wasAccepted) {
      // A send the server neither accepted nor rejected is not a success, and
      // reporting it as one would lose the message silently.
      throw Object.assign(new Error(`${message.toAddress} was not accepted`), {
        responseCode: 451,
        response: info.response,
      });
    }

    this.logger.log(`email → ${message.toAddress} (${info.messageId})`);

    // SMTP acceptance is not delivery: the next hop can still bounce it, which
    // arrives later as a bounce report rather than as this return value.
    return { providerRef: info.messageId, isDelivered: false };
  }

  /** Closes the pooled connections on shutdown. */
  close(): void {
    this.transporter.close();
  }
}

/**
 * Minimal, deliberately.
 *
 * The content is escaped and line breaks become `<br>`; nothing else is
 * interpreted. Rendering template text as HTML without escaping would make a
 * guest's own name — typed by a host into a template variable — able to inject
 * markup into every other guest's email.
 */
export function asHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return `<div style="font-family:sans-serif;line-height:1.5">${escaped.replace(/\n/g, '<br>')}</div>`;
}
