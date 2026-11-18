// التحقق البشري (Cloudflare Turnstile)
// ١) الزائر يحلّ التحقق في الصفحة → نتحقق من رمزه مع Cloudflare → نعطيه «تصريحاً» موقّعاً صالحاً 24 ساعة.
// ٢) كل طلب كتابة على الـ API (طلبات، تسجيل، دخول، تقييمات...) يجب أن يحمل التصريح في الترويسة X-Human-Pass.
// إذا لم يُضبط TURNSTILE_SECRET_KEY يكون التحقق متوقفاً (حتى لا يتعطل الموقع قبل إضافة المفاتيح).
import jwt from 'jsonwebtoken';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const PASS_HOURS = 24;

const passSecret = () => process.env.HUMAN_PASS_SECRET || process.env.JWT_SECRET;
export const humanEnabled = () => !!process.env.TURNSTILE_SECRET_KEY;

export function clientIp(req) {
  const fwd = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '';
  return String(fwd).split(',')[0].trim() || req.socket?.remoteAddress || '';
}

/** يتحقق من رمز Turnstile مع Cloudflare */
export async function verifyTurnstile(token, ip) {
  if (!token || typeof token !== 'string' || token.length > 2048) return { success: false, 'error-codes': ['missing-input-response'] };
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token });
  if (ip) body.append('remoteip', ip);
  const r = await fetch(VERIFY_URL, { method: 'POST', body });
  return r.json();
}

export function issuePass() {
  const exp = Math.floor(Date.now() / 1000) + PASS_HOURS * 3600;
  return { pass: jwt.sign({ typ: 'human', exp }, passSecret()), exp: exp * 1000 };
}

/** يرفض أي طلب بلا تصريح صالح */
export function requireHuman(req, res, next) {
  if (!humanEnabled()) return next();
  const pass = req.headers['x-human-pass'];
  try {
    const p = pass && jwt.verify(String(pass), passSecret());
    if (p && p.typ === 'human') return next();
  } catch {
    // تصريح منتهٍ أو مزوّر
  }
  res.set('X-Human-Required', '1');
  return res.status(403).json({ error: 'human_verification_required', message: 'يرجى إكمال التحقق البشري ثم المحاولة مجدداً' });
}

/** يطبّق التحقق على طلبات الكتابة فقط؛ القراءة (GET) تبقى مفتوحة لمحركات البحث */
export function guardWrites(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path.startsWith('/human')) return next();
  return requireHuman(req, res, next);
}
