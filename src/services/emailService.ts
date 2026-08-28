import nodemailer, { type Transporter } from 'nodemailer';
import crypto from 'crypto';
import { getDatabaseClient, execQuery } from '../database/sqliteClient.js';

type Ticket = Record<string, unknown>;

let transporter: Transporter | null | undefined;

const asText = (value: unknown, fallback = '') => typeof value === 'string' ? value.trim() : fallback;
const escapeHtml = (value: unknown) => asText(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const ticketValue = (ticket: Ticket, ...keys: string[]) => keys.map(key => ticket[key]).find(value => typeof value === 'string' && value.trim()) as string | undefined;

function deriveKeyFromEnv(masterKey: string) {
  // Normalize key to 32 bytes (sha256) for AES-256
  return crypto.createHash('sha256').update(masterKey).digest();
}

export function encryptSecret(plain: string, masterKey: string) {
  const key = deriveKeyFromEnv(masterKey);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString('base64');
}

export function decryptSecret(ciphertextBase64: string, masterKey: string) {
  try {
    const key = deriveKeyFromEnv(masterKey);
    const payload = Buffer.from(ciphertextBase64, 'base64');
    const iv = payload.slice(0, 16);
    const encrypted = payload.slice(16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (e) {
    throw new Error('Decryption failed');
  }
}

async function getTransporter() {
  if (transporter !== undefined) return transporter;

  try {
    // Read Gmail credentials from database settings
    const { data, error } = await execQuery(getDatabaseClient().from('app_settings').select('*').eq('id', 'main'));
    if (error || !data?.[0]) {
      console.warn('[EMAIL] Gmail settings not found in database');
      transporter = null;
      return transporter;
    }

    const row = data[0];
    let user = (row.gmail_user || '').toString().trim();
    let pass = (row.gmail_app_password || '').toString().trim();

    // Decrypt password if encryption key is available
    if (pass && process.env.NEXA_SECRET_KEY) {
      try {
        pass = decryptSecret(pass, process.env.NEXA_SECRET_KEY);
      } catch (e) {
        console.warn('[EMAIL] Password decryption failed, using stored value as-is');
      }
    }

    if (!user || !pass) {
      transporter = null;
      console.warn('[EMAIL] Email system is disabled: Gmail credentials not configured in Notification Settings.');
      return transporter;
    }

    // Direct Gmail configuration using database credentials
    transporter = nodemailer.createTransport({ 
      service: 'gmail', 
      auth: { user, pass } 
    });
    
    console.info('[EMAIL] Gmail transporter created successfully using database settings');
    return transporter;
  } catch (err) {
    console.warn('[EMAIL] Failed to create transporter:', err instanceof Error ? err.message : err);
    transporter = null;
    return transporter;
  }
}

type NotificationSettings = {
  notificationEmail: string;
  notifyAdminOnTicket: boolean;
  sendStudentAcknowledgement: boolean;
  sendStudentReplyNotifications: boolean;
};

async function getNotificationSettings(): Promise<NotificationSettings> {
  const defaults: NotificationSettings = {
    notificationEmail: '',
    notifyAdminOnTicket: true,
    sendStudentAcknowledgement: true,
    sendStudentReplyNotifications: true
  };
  try {
    const { data, error } = await execQuery(getDatabaseClient().from('app_settings').select('*').eq('id', 'main'));
    if (error || !data?.[0]) return defaults;
    const row = data[0];
    return {
      notificationEmail: asText(row.notification_email),
      notifyAdminOnTicket: row.notify_admin_on_ticket !== 0 && row.notify_admin_on_ticket !== false,
      sendStudentAcknowledgement: row.send_student_acknowledgement !== 0 && row.send_student_acknowledgement !== false,
      sendStudentReplyNotifications: row.send_student_reply_notifications !== 0 && row.send_student_reply_notifications !== false
    };
  } catch (error) {
    console.warn('[EMAIL] Could not load notification settings:', error instanceof Error ? error.message : error);
    return defaults;
  }
}

function statusColor(status: string) {
  if (/resolved|closed/i.test(status)) return '#059669';
  if (/progress|pending/i.test(status)) return '#2563eb';
  return '#d97706';
}

function emailShell(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head><body style="margin:0;background:#f1f5f9;font-family:Arial,'Noto Sans Telugu','Noto Sans Devanagari',sans-serif;color:#172033"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:28px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dbe4f0"><tr><td style="background:#0f172a;padding:22px 28px;color:#ffffff"><div style="font-size:20px;font-weight:800;letter-spacing:.2px">Narayana NEXA</div><div style="margin-top:4px;font-size:12px;color:#a5b4fc">Narayana Engineering College Helpdesk</div></td></tr><tr><td style="padding:28px"><h1 style="font-size:21px;margin:0 0 16px;color:#0f172a">${escapeHtml(title)}</h1>${body}</td></tr><tr><td style="padding:16px 28px;background:#f8fafc;color:#64748b;font-size:12px">This is an automated helpdesk notification. Please do not share passwords or personal financial details by email.</td></tr></table></td></tr></table></body></html>`;
}

function ticketSummary(ticket: Ticket, includeResponse = false) {
  const id = ticketValue(ticket, 'id', 'ticket_id', 'ticketId') || '—';
  const studentName = ticketValue(ticket, 'student_name', 'studentName') || 'Student';
  const status = ticketValue(ticket, 'status') || 'Received';
  const timestamp = ticketValue(ticket, 'responded_at', 'timestamp') || new Date().toISOString();
  const response = ticketValue(ticket, 'admin_response', 'adminResponse');
  const question = ticketValue(ticket, 'query') || ticketValue(ticket, 'student_question') || '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px"><tr><td style="padding:8px 0;color:#64748b;width:115px">Ticket ID</td><td style="padding:8px 0;font-family:monospace;font-weight:700">${escapeHtml(id)}</td></tr><tr><td style="padding:8px 0;color:#64748b">Student Name</td><td style="padding:8px 0">${escapeHtml(studentName)}</td></tr><tr><td style="padding:8px 0;color:#64748b">Status</td><td style="padding:8px 0"><span style="display:inline-block;border-radius:999px;padding:5px 10px;color:white;background:${statusColor(status)};font-size:12px;font-weight:700">${escapeHtml(status)}</span></td></tr><tr><td style="padding:8px 0;color:#64748b">Date &amp; time</td><td style="padding:8px 0">${escapeHtml(new Date(timestamp).toLocaleString('en-IN'))}</td></tr>${question ? `<tr><td style="padding:12px 0 4px;color:#64748b;vertical-align:top">Question</td><td style="padding:12px 0 4px;line-height:1.55;white-space:pre-wrap">${escapeHtml(question)}</td></tr>` : ''}${includeResponse && response ? `<tr><td style="padding:12px 0 4px;color:#64748b;vertical-align:top">Reply</td><td style="padding:12px 0 4px;line-height:1.55;white-space:pre-wrap">${escapeHtml(response)}</td></tr>` : ''}</table>`;
}

function ticketTextSummary(ticket: Ticket, includeResponse = false) {
  const id = ticketValue(ticket, 'id', 'ticket_id', 'ticketId') || '—';
  const studentName = ticketValue(ticket, 'student_name', 'studentName') || 'Student';
  const status = ticketValue(ticket, 'status') || 'Received';
  const timestamp = ticketValue(ticket, 'responded_at', 'timestamp') || new Date().toISOString();
  const response = ticketValue(ticket, 'admin_response', 'adminResponse');
  const question = ticketValue(ticket, 'query') || ticketValue(ticket, 'student_question') || '';
  let lines = [`Ticket ID: ${id}`, `Student Name: ${studentName}`, `Status: ${status}`, `Date & time: ${new Date(timestamp).toLocaleString('en-IN')}`];
  if (question) lines.push(`Question: ${question}`);
  if (includeResponse && response) lines.push(`Reply: ${response}`);
  return lines.join('\n');
}

export async function deliver(to: string | undefined, subject: string, html: string, text: string) {
  console.log('[EMAIL DEBUG] deliver called with to:', to, 'subject:', subject);
  
  const transport = await getTransporter();
  if (!transport) {
    console.error('[EMAIL DEBUG] Transporter is null/undefined');
    return false;
  }
  if (!to) {
    console.error('[EMAIL DEBUG] Recipient email is null/undefined');
    return false;
  }
  
  try {
    // Prefer configured from address and sender name in app settings
    let fromAddress = process.env.EMAIL_FROM || '';
    try {
      const { data, error } = await execQuery(getDatabaseClient().from('app_settings').select('*').eq('id', 'main'));
      const row = (!error && data && data[0]) ? data[0] : {};
      const senderName = (row.sender_name || '').toString().trim();
      const emailFrom = (row.email_from || '').toString().trim();
      if (emailFrom) {
        fromAddress = senderName ? `${senderName} <${emailFrom}>` : emailFrom;
      }
    } catch (e) {
      // ignore
    }

    if (!fromAddress) {
      // ultimate fallback
      fromAddress = `Narayana NEXA <${process.env.GMAIL_USER || ''}>`;
    }

    console.log('[EMAIL DEBUG] Sending email from:', fromAddress, 'to:', to);
    const info = await transport.sendMail({ from: fromAddress, to, subject, html, text });
    console.info(`[EMAIL] Email sent successfully. Message ID: ${info.messageId}`);
    console.info(`[EMAIL] Accepted recipients:`, info.accepted);
    console.info(`[EMAIL] Rejected recipients:`, info.rejected);
    console.info(`[EMAIL] Sent to: ${to.replace(/(^.).*(@.*$)/, '$1***$2')}`);
    return true;
  } catch (error) {
    console.error('[EMAIL] Email sending failed:', error instanceof Error ? error.message : error);
    console.error('[EMAIL] Full error:', error);
    return false;
  }
}

export async function sendTicketCreatedEmails(ticket: Ticket): Promise<boolean> {
  const settings = await getNotificationSettings();
  const studentName = ticketValue(ticket, 'student_name', 'studentName') || 'Student';
  const studentEmail = ticketValue(ticket, 'email', 'student_email', 'studentEmail');
  const adminEmail = settings.notificationEmail;
  const ticketId = ticketValue(ticket, 'id', 'ticket_id', 'ticketId') || '';
  const query = ticketValue(ticket, 'query') || '';
  const subject = ticketValue(ticket, 'subject') || 'Support Request';
  const timestamp = ticketValue(ticket, 'timestamp') || new Date().toISOString();
  
  // Admin email with full ticket details
  const adminEmailBody = `<p style="line-height:1.6">New Support Ticket</p>
<p style="line-height:1.6"><strong>Ticket ID:</strong> <span style="font-family:monospace;font-weight:700">${escapeHtml(ticketId)}</span></p>
<p style="line-height:1.6"><strong>Student:</strong> ${escapeHtml(studentName)}</p>
<p style="line-height:1.6"><strong>Student Email:</strong> ${escapeHtml(studentEmail)}</p>
<p style="line-height:1.6"><strong>Category:</strong> Support Request</p>
<p style="line-height:1.6"><strong>Subject:</strong> ${escapeHtml(subject)}</p>
<p style="line-height:1.6"><strong>Description:</strong></p>
<p style="line-height:1.6;white-space:pre-wrap">${escapeHtml(query)}</p>
<p style="line-height:1.6"><strong>Created At:</strong> ${escapeHtml(new Date(timestamp).toLocaleString())}</p>
<p style="margin-top:18px;line-height:1.6">Regards,<br/>Support System</p>`;
  
  const adminTextBody = `New Support Ticket\n\nTicket ID: ${ticketId}\nStudent: ${studentName}\nStudent Email: ${studentEmail}\nCategory: Support Request\nSubject: ${subject}\nDescription: ${query}\nCreated At: ${new Date(timestamp).toLocaleString()}\n\nRegards,\nSupport System`;
  
  // Student acknowledgement email
  const studentEmailBody = `<p style="line-height:1.6">Hello ${escapeHtml(studentName)},</p>
<p style="line-height:1.6">Your support ticket has been successfully created.</p>
<p style="line-height:1.6"><strong>Ticket ID:</strong> <span style="font-family:monospace;font-weight:700">${escapeHtml(ticketId)}</span></p>
<p style="line-height:1.6"><strong>Subject:</strong> ${escapeHtml(subject)}</p>
<p style="line-height:1.6"><strong>Description:</strong></p>
<p style="line-height:1.6;white-space:pre-wrap">${escapeHtml(query)}</p>
<p style="margin-top:18px;line-height:1.6">Our support team will review your request and respond shortly.</p>
<p style="margin-top:18px;line-height:1.6">Regards,<br/>Support Team</p>`;
  
  const studentTextBody = `Hello ${studentName},\n\nYour support ticket has been successfully created.\n\nTicket ID: ${ticketId}\nSubject: ${subject}\nDescription: ${query}\n\nOur support team will review your request and respond shortly.\n\nRegards,\nSupport Team`;
  
  const results = await Promise.allSettled([
    settings.notifyAdminOnTicket ? deliver(
      adminEmail,
      `New Support Ticket - #${ticketId}`,
      emailShell('New Support Ticket', adminEmailBody),
      adminTextBody
    ) : Promise.resolve(false),
    settings.sendStudentAcknowledgement ? deliver(
      studentEmail,
      `Ticket Created Successfully - #${ticketId}`,
      emailShell('Ticket Created', studentEmailBody),
      studentTextBody
    ) : Promise.resolve(false)
  ]);
  
  // Return true if at least one email was sent successfully
  return results.some(result => result.status === 'fulfilled' && result.value === true);
}

export async function sendTicketUpdateEmail(ticket: Ticket): Promise<boolean> {
  console.log('[EMAIL DEBUG] sendTicketUpdateEmail called with ticket:', ticket);
  
  const settings = await getNotificationSettings();
  console.log('[EMAIL DEBUG] Email settings:', settings);
  
  if (!settings.sendStudentReplyNotifications) {
    console.log('[EMAIL DEBUG] Student reply notifications are disabled, skipping email');
    return false;
  }
  
  const studentName = ticketValue(ticket, 'student_name', 'studentName') || 'Student';
  const studentEmail = ticketValue(ticket, 'email', 'student_email', 'studentEmail');
  const ticketId = ticketValue(ticket, 'id', 'ticket_id', 'ticketId') || '';
  const adminResponse = ticketValue(ticket, 'admin_response', 'adminResponse') || '';
  const status = ticketValue(ticket, 'status') || '';
  
  console.log('[EMAIL DEBUG] Resolved student email:', studentEmail);
  console.log('[EMAIL DEBUG] Student name:', studentName);
  console.log('[EMAIL DEBUG] Ticket ID:', ticketId);
  
  if (!studentEmail) {
    console.error('[EMAIL DEBUG] Student email not found for ticket', ticketId);
    return false;
  }
  
  const emailBody = `<p style="line-height:1.6">Hello ${escapeHtml(studentName)},</p>
<p style="line-height:1.6">There is a new response to your support ticket.</p>
<p style="line-height:1.6"><strong>Ticket:</strong> ${escapeHtml(ticketId)}</p>
<p style="line-height:1.6"><strong>Admin Response:</strong></p>
<p style="line-height:1.6;white-space:pre-wrap">${escapeHtml(adminResponse)}</p>
<p style="line-height:1.6"><strong>Current Status:</strong> ${escapeHtml(status)}</p>
<p style="margin-top:18px;line-height:1.6">Regards,<br/>Narayana NEXA Support</p>`;
  
  const textBody = `Hello ${studentName},\n\nThere is a new response to your support ticket.\n\nTicket: ${ticketId}\nAdmin Response: ${adminResponse}\nCurrent Status: ${status}\n\nRegards,\nNarayana NEXA Support`;
  
  console.log('[EMAIL DEBUG] Calling deliver to:', studentEmail);
  const result = await deliver(
    studentEmail,
    `New Reply on Ticket #${ticketId}`,
    emailShell('Ticket Update', emailBody),
    textBody
  );
  
  console.log('[EMAIL DEBUG] Email deliver result:', result);
  return result;
}

export async function sendTicketStatusEmail(ticket: Ticket): Promise<boolean> {
  const settings = await getNotificationSettings();
  if (!settings.sendStudentReplyNotifications) return false;
  const studentName = ticketValue(ticket, 'student_name', 'studentName') || 'Student';
  const studentEmail = ticketValue(ticket, 'email', 'student_email', 'studentEmail');
  const ticketId = ticketValue(ticket, 'id', 'ticket_id', 'ticketId') || '';
  const status = ticketValue(ticket, 'status') || '';
  
  if (!studentEmail) {
    console.error('[EMAIL DEBUG] Student email not found for ticket status update', ticketId);
    return false;
  }
  
  const emailBody = `<p style="line-height:1.6">Hello ${escapeHtml(studentName)},</p>
<p style="line-height:1.6">Your support ticket <strong>#${escapeHtml(ticketId)}</strong> has been marked as <strong>${escapeHtml(status)}</strong>.</p>
<p style="margin-top:18px;line-height:1.6">Regards,<br/>Narayana NEXA Support</p>`;
  
  const textBody = `Hello ${studentName},\n\nYour support ticket #${ticketId} has been marked as ${status}.\n\nRegards,\nNarayana NEXA Support`;
  
  const result = await deliver(
    studentEmail,
    `Ticket #${ticketId} Status Updated`,
    emailShell('Ticket Status Update', emailBody),
    textBody
  );
  
  return result;
}

export async function sendQueryResponseEmail(studentName: string, studentEmail: string, query: string, response: string) {
  const emailBody = `<p style="line-height:1.6">Hello ${escapeHtml(studentName)},</p>
<p style="line-height:1.6">Your query has received a response.</p>
<p style="line-height:1.6"><strong>Your Query:</strong></p>
<p style="line-height:1.6;white-space:pre-wrap">${escapeHtml(query)}</p>
<p style="line-height:1.6"><strong>Response:</strong></p>
<p style="line-height:1.6;white-space:pre-wrap">${escapeHtml(response)}</p>
<p style="margin-top:18px;line-height:1.6">You can return to the application to continue the conversation.</p>
<p style="margin-top:18px;line-height:1.6">Regards,<br/>Support Team</p>`;
  
  const textBody = `Hello ${studentName},\n\nYour query has received a response.\n\nYour Query:\n${query}\n\nResponse:\n${response}\n\nYou can return to the application to continue the conversation.\n\nRegards,\nSupport Team`;
  
  await deliver(
    studentEmail,
    'New Response to Your Query',
    emailShell('Query Response', emailBody),
    textBody
  );
}

export async function sendQueryReceivedAdminEmail(studentName: string, studentEmail: string, query: string) {
  const settings = await getNotificationSettings();
  if (!settings.notifyAdminOnTicket) return false;
  
  const adminEmail = settings.notificationEmail;
  if (!adminEmail) {
    console.warn('[EMAIL] Admin notification email not configured');
    return false;
  }

  const emailBody = `<p style="line-height:1.6">New student query received.</p>
<p style="line-height:1.6"><strong>Student Name:</strong> ${escapeHtml(studentName)}</p>
<p style="line-height:1.6"><strong>Student Email:</strong> ${escapeHtml(studentEmail)}</p>
<p style="line-height:1.6"><strong>Query:</strong></p>
<p style="line-height:1.6;white-space:pre-wrap">${escapeHtml(query)}</p>
<p style="margin-top:18px;line-height:1.6">Regards,<br/>Support System</p>`;
  
  const textBody = `New student query received.\n\nStudent Name: ${studentName}\nStudent Email: ${studentEmail}\nQuery: ${query}\n\nRegards,\nSupport System`;
  
  const result = await deliver(
    adminEmail,
    'New Student Query Received',
    emailShell('New Query', emailBody),
    textBody
  );
  
  return result;
}

export async function sendEmail({ to, subject, html, text }: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
  return await deliver(to, subject, html, text);
}
