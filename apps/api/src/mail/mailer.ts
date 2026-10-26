// Outgoing email. Off unless EMAIL_ENABLED=true and EMAIL_FROM and EMAIL_PROVIDER_API_KEY
// are set. The provider is chosen by EMAIL_PROVIDER (default and only one built in:
// "resend", https://resend.com). Callers treat failure as non-fatal.

export type Mail = { to: string; subject: string; text: string };

export function mailEnabled(): boolean {
  return (
    process.env.EMAIL_ENABLED === 'true' &&
    Boolean(process.env.EMAIL_FROM) &&
    Boolean(process.env.EMAIL_PROVIDER_API_KEY)
  );
}

export async function sendMail(mail: Mail): Promise<boolean> {
  if (!mailEnabled()) return false;
  const provider = (process.env.EMAIL_PROVIDER || 'resend').toLowerCase();
  if (provider !== 'resend') {
    console.error(`Unsupported EMAIL_PROVIDER "${provider}"; email not sent.`);
    return false;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.EMAIL_PROVIDER_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
    }),
  });
  if (!response.ok) console.error('Email provider refused the message', response.status);
  return response.ok;
}
