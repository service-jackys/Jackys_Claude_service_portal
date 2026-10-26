import webpush from 'web-push';
import type { ChatPushSubscription } from '../../../../packages/db/src/chat.js';

// Browser push (works when the browser is closed). Needs a VAPID key pair in the
// environment: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and optionally VAPID_SUBJECT
// (a mailto: or https: contact). Generate with `npm run vapid`. Off when unset.

export const pushEnabled = () =>
  Boolean(process.env.VAPID_PUBLIC_KEY) && Boolean(process.env.VAPID_PRIVATE_KEY);
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? '';

let configured = false;
function configure() {
  if (configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ||
      (process.env.EMAIL_FROM ? `mailto:${process.env.EMAIL_FROM}` : 'mailto:admin@example.com'),
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  conversationId: string;
  tag: string;
};

// 'gone' means the browser has unsubscribed and the row should be deleted.
export async function sendPush(
  subscription: ChatPushSubscription,
  payload: PushPayload,
): Promise<'ok' | 'gone' | 'failed'> {
  if (!pushEnabled()) return 'failed';
  configure();
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      { TTL: 3600, urgency: 'high' },
    );
    return 'ok';
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    return status === 404 || status === 410 ? 'gone' : 'failed';
  }
}
