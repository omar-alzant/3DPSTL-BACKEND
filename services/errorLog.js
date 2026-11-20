// services/errorLog.js — saves website errors (frontend + server) in Supabase (table app_errors,
// see DB/monitoring.sql) and emails the shop. The same error is grouped by a fingerprint and
// emailed at most once every 6 hours. Never throws.
import crypto from 'node:crypto';
import { supabaseAdmin } from '../supabase.js';
import { notifyError } from './notify.js';

let emailsToday = { day: '', n: 0 };
const MAX_EMAILS_PER_DAY = 20;

const clip = (v, n) => (v == null ? null : String(v).slice(0, n));

// "same error": same source + message + first stack frame (numbers/ids/hashes removed)
function fingerprint(source, message, stack) {
  const frame = String(stack || '').split('\n').find((l) => /at |@/.test(l)) || '';
  const norm = (s) => String(s)
    .replace(/\b[0-9a-f]{8,}\b/gi, '#')     // chunk hashes, ids
    .replace(/:\d+(:\d+)?/g, '')            // line:column
    .replace(/\d+/g, '0')
    .replace(/\?.*$/, '')
    .trim();
  return crypto.createHash('sha1').update(`${source}|${norm(message)}|${norm(frame)}`).digest('hex');
}

export async function logError({ source = 'server', message, stack, url, userAgent, userId } = {}) {
  try {
    const msg = clip(message || 'Unknown error', 1000);
    const { data: shouldEmail, error } = await supabaseAdmin.rpc('app_error_hit', {
      p_fingerprint: fingerprint(source, msg, stack),
      p_source: source,
      p_message: msg,
      p_stack: clip(stack, 4000),
      p_url: clip(url, 500),
      p_user_agent: clip(userAgent, 300),
      p_user: userId || null,
    });
    if (error) {
      console.error('errorLog: save failed', error.message);
      return;
    }
    if (!shouldEmail) return;

    const day = new Date().toISOString().slice(0, 10);
    if (emailsToday.day !== day) emailsToday = { day, n: 0 };
    if (emailsToday.n >= MAX_EMAILS_PER_DAY) return;
    emailsToday.n++;
    await notifyError({ source, message: msg, stack, url, userAgent });
  } catch (err) {
    console.error('errorLog:', err.message);
  }
}
