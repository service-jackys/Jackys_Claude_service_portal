import type { Pool } from 'pg';
import {
  deleteChatPushSubscription,
  findUnreadMentionEmail,
  listChatPushSubscriptions,
} from '../../../../packages/db/src/chat.js';
import { mailEnabled, sendMail, type Mail } from '../mail/mailer.js';
import { pushEnabled, sendPush, type PushPayload } from './push.js';
import type { ChatPushSubscription } from '../../../../packages/db/src/chat.js';

export type NotifyInput = {
  conversationId: string;
  messageId: string;
  senderName: string;
  title: string;
  preview: string;
  recipients: { profileId: string; muted: boolean; mention: boolean; online: boolean }[];
};

export type NotifierDeps = {
  sendPush: (
    subscription: ChatPushSubscription,
    payload: PushPayload,
  ) => Promise<'ok' | 'gone' | 'failed'>;
  sendMail: (mail: Mail) => Promise<boolean>;
  pushEnabled: () => boolean;
  mailEnabled: () => boolean;
  emailDelayMs: number;
};

// Everything that reaches a person outside the open portal tab:
//  - push to a closed/background browser for people with no live connection;
//  - an email for a @mention that is still unread after a few minutes.
// Both are best effort and silent when not configured.
export function createChatNotifier(pool: Pool, overrides: Partial<NotifierDeps> = {}) {
  const deps: NotifierDeps = {
    sendPush,
    sendMail,
    pushEnabled,
    mailEnabled,
    emailDelayMs: Number(process.env.CHAT_EMAIL_DELAY_MINUTES || 5) * 60_000,
    ...overrides,
  };

  async function push(input: NotifyInput) {
    if (!deps.pushEnabled()) return;
    const targets = input.recipients.filter((r) => !r.online && (!r.muted || r.mention));
    if (!targets.length) return;
    const client = await pool.connect();
    try {
      const subscriptions = await listChatPushSubscriptions(
        client,
        targets.map((t) => t.profileId),
      );
      for (const subscription of subscriptions) {
        const mention = targets.find((t) => t.profileId === subscription.profileId)?.mention;
        const result = await deps.sendPush(subscription, {
          title: mention ? `${input.senderName} mentioned you` : input.senderName,
          body: `${input.title}: ${input.preview}`.slice(0, 160),
          conversationId: input.conversationId,
          tag: `chat-${input.conversationId}`,
        });
        if (result === 'gone') await deleteChatPushSubscription(client, subscription.endpoint);
      }
    } finally {
      client.release();
    }
  }

  function email(input: NotifyInput) {
    if (!deps.mailEnabled()) return;
    for (const person of input.recipients.filter((r) => r.mention)) {
      const timer = setTimeout(async () => {
        try {
          const client = await pool.connect();
          let target: { email: string; name: string } | null;
          try {
            target = await findUnreadMentionEmail(client, input.messageId, person.profileId);
          } finally {
            client.release();
          }
          if (!target) return;
          const base = (process.env.PORTAL_PUBLIC_URL || '').replace(/\/$/, '');
          await deps.sendMail({
            to: target.email,
            subject: `${input.senderName} mentioned you in ${input.title}`,
            text:
              `Hello ${target.name},\n\n${input.senderName} mentioned you in ${input.title}:\n\n` +
              `"${input.preview}"\n\n` +
              (base ? `Open the portal: ${base}/portal/\n\n` : '') +
              `You can turn these emails off in Chat > Notifications.`,
          });
        } catch (error) {
          console.error('Chat mention email failed', error);
        }
      }, deps.emailDelayMs);
      timer.unref();
    }
  }

  return {
    async dispatch(input: NotifyInput) {
      try {
        await push(input);
      } catch (error) {
        console.error('Chat push failed', error);
      }
      email(input);
    },
  };
}

export type ChatNotifier = ReturnType<typeof createChatNotifier>;
