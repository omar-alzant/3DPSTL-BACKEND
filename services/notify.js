// src/services/notify.js — email to the shop when a customer sends an order or a credit top-up request.
//
// Railway (Hobby plan) blocks SMTP ports, so emails go over HTTPS, in one of two ways:
//  A) the simplest: your own Gmail through a small Google Apps Script (see DB/gmail_notify_script.gs)
//     GMAIL_SCRIPT_URL — the script's web-app URL
//     NOTIFY_SECRET    — the same secret written in the script
//  B) Resend: RESEND_API_KEY — from resend.com (free plan is enough)
// Other Railway variables:
//   NOTIFY_EMAIL    — who receives the notifications (default 3dstl.lb@gmail.com)
//   MAIL_FROM       — sender (default "3DSTL Studio <onboarding@resend.dev>": works without a domain,
//                     but then Resend only delivers to the email you signed up with → sign up with NOTIFY_EMAIL)
//   SITE_URL        — the website, for the admin links (default https://www.3dpstl.com)
//
// A failed email never breaks the order: it is only logged.

const TO = () => process.env.NOTIFY_EMAIL || '3dstl.lb@gmail.com';
const FROM = () => process.env.MAIL_FROM || '3DSTL Studio <onboarding@resend.dev>';
const SITE = () => (process.env.SITE_URL || 'https://www.3dpstl.com').replace(/\/$/, '');

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function send({ to, subject, html, text, replyTo }) {
  const dest = to || TO();
  // A) Gmail via Google Apps Script
  const script = process.env.GMAIL_SCRIPT_URL;
  if (script) {
    try {
      const r = await fetch(script, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret: process.env.NOTIFY_SECRET || '', to: dest, subject, html, text, replyTo }),
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
      const out = await r.text().catch(() => '');
      if (!r.ok || !/"ok"\s*:\s*true/.test(out)) {
        console.error('notify: gmail script failed', r.status, out.slice(0, 200));
        return false;
      }
      return true;
    } catch (err) {
      console.error('notify: gmail script error', err.message);
      return false;
    }
  }

  // B) Resend
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('notify: GMAIL_SCRIPT_URL / RESEND_API_KEY not set — email skipped:', subject);
    return false;
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM(), to: [dest], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      console.error('notify: email failed', r.status, await r.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (err) {
    console.error('notify: email error', err.message);
    return false;
  }
}

const table = (rows) =>
  `<table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">${rows
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<tr><td style="color:#666;white-space:nowrap;vertical-align:top">${esc(k)}</td><td><b>${v}</b></td></tr>`)
    .join('')}</table>`;

const button = (href, label) =>
  `<p><a href="${href}" style="display:inline-block;background:#6a4dff;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-family:Arial,sans-serif">${esc(label)}</a></p>`;

// إعدادات التصميم بدون الصور (data:...) — للعرض في الإيميل فقط
const designSummary = (params = {}) =>
  Object.entries(params)
    .filter(([, v]) => !(typeof v === 'string' && v.startsWith('data:')) && v !== '' && v !== null && typeof v !== 'object')
    .slice(0, 40)
    .map(([k, v]) => `${esc(k)}: ${esc(v)}`)
    .join('<br>');

/** طلب طباعة جديد من الـ Studio */
export function notifyStudioOrder(o) {
  const est = o.estimate || {};
  const hasImage = Object.values(o.params || {}).some((v) => typeof v === 'string' && v.startsWith('data:'));
  const html = `<div dir="rtl" style="font-family:Arial,sans-serif">
    <h2 style="margin:0 0 8px">طلب طباعة جديد — ${esc(o.id)}</h2>
    ${table([
      ['الأداة', esc(o.tool_name || o.tool_id)],
      ['الاسم', esc(o.customer_name)],
      ['الهاتف', `<a href="tel:${esc(o.customer_phone)}">${esc(o.customer_phone)}</a> · <a href="https://wa.me/${esc(String(o.customer_phone).replace(/\D/g, ''))}">WhatsApp</a>`],
      ['العنوان', esc(o.customer_address)],
      ['الكمية', esc(o.qty)],
      ['الوزن التقريبي', est.grams ? `${esc(est.grams)} غ` : ''],
      ['الوقت التقريبي', est.minutes ? `${esc(est.minutes)} د` : ''],
      ['السعر التقريبي', est.price ? `${esc(est.price)} ${esc(est.currency)}` : ''],
      ['المقاس', Array.isArray(o.size) ? `${o.size.map(esc).join(' × ')} مم` : ''],
      ['ملاحظات', esc(o.notes)],
      ['الحساب', esc(o.email)],
    ])}
    ${hasImage ? '<p>📎 التصميم فيه صورة/لوغو مرفوع — افتحه من لوحة الإدارة.</p>' : ''}
    ${button(`${SITE()}/admin/studio`, 'افتح الطلب في لوحة الإدارة')}
    <details><summary style="color:#666">إعدادات التصميم</summary><p style="font-size:12px;color:#444" dir="ltr">${designSummary(o.params)}</p></details>
  </div>`;
  return send({
    subject: `🖨️ طلب Studio جديد ${o.id} — ${o.customer_name} (${o.tool_name || o.tool_id})`,
    html,
    text: `طلب طباعة جديد ${o.id}\n${o.tool_name || o.tool_id}\n${o.customer_name} — ${o.customer_phone}\n${o.customer_address}\nالكمية: ${o.qty}\n${SITE()}/admin/studio`,
    replyTo: o.email || undefined,
  });
}

/** طلب شحن كريدت جديد (Whish / Neo) */
export function notifyCreditRequest(r) {
  const method = r.method === 'neo' ? 'Neo' : 'Whish Money';
  const html = `<div dir="rtl" style="font-family:Arial,sans-serif">
    <h2 style="margin:0 0 8px">طلب شحن كريدت — ${esc(r.id)}</h2>
    ${table([
      ['الزبون', `${esc(r.full_name)} ${r.email ? `(${esc(r.email)})` : ''}`],
      ['الباقة', `${esc(Number(r.credits).toLocaleString())} كريدت`],
      ['المبلغ', `${esc(Number(r.price).toFixed(2))} ${esc(r.currency)}`],
      ['طريقة الدفع', method],
      ['رقم العملية', `<span dir="ltr">${esc(r.reference)}</span>`],
      ['المحوِّل', esc(r.sender)],
    ])}
    <p>⚠️ تأكد من وصول المبلغ في تطبيق ${method} قبل الموافقة.</p>
    ${button(`${SITE()}/admin/credits`, 'راجع الطلب ووافق')}
  </div>`;
  return send({
    subject: `💰 طلب شحن ${Number(r.credits).toLocaleString()} كريدت — ${Number(r.price).toFixed(2)} ${r.currency} عبر ${method}`,
    html,
    text: `طلب شحن ${r.id}\n${r.email}\n${r.credits} كريدت — ${r.price} ${r.currency}\n${method} — رقم العملية: ${r.reference}\n${SITE()}/admin/credits`,
    replyTo: r.email || undefined,
  });
}

// ─────────────────────────── shop orders ───────────────────────────

/** طلب جديد من المتجر — للمحل */
export function notifyShopOrder(order, items = [], email) {
  const lines = items
    .map((i) => `${esc(i.product_name)} ${i.size ? `(${esc(i.size)})` : ''} ${i.color ? `— ${esc(i.color)}` : ''} × ${esc(i.qty)} — $${esc(Number(i.price).toFixed(2))}`)
    .join('<br>');
  const html = `<div dir="rtl" style="font-family:Arial,sans-serif">
    <h2 style="margin:0 0 8px">طلب جديد من المتجر — #${esc(order.id)}</h2>
    ${table([
      ['الاسم', esc(order.shipping_name)],
      ['الهاتف', `<a href="tel:${esc(order.shipping_phone)}">${esc(order.shipping_phone)}</a> · <a href="https://wa.me/${esc(String(order.shipping_phone || '').replace(/\D/g, ''))}">WhatsApp</a>`],
      ['العنوان', `${esc(order.shipping_address)} ${order.shipping_city ? `— ${esc(order.shipping_city)}` : ''}`],
      ['المنتجات', lines],
      ['المجموع', `$${esc(Number(order.total_amount).toFixed(2))}`],
      ['ملاحظات', esc(order.note)],
      ['الحساب', esc(email)],
    ])}
    ${button(`${SITE()}/admin/orders`, 'افتح الطلبات')}
  </div>`;
  return send({
    subject: `🛒 طلب جديد #${order.id} — ${order.shipping_name} — $${Number(order.total_amount).toFixed(2)}`,
    html,
    text: `طلب جديد #${order.id}\n${order.shipping_name} — ${order.shipping_phone}\n$${order.total_amount}\n${SITE()}/admin/orders`,
    replyTo: email || undefined,
  });
}

// ─────────────────────────── to the customer ───────────────────────────

const customerShell = (title, body) => `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:560px">
  <h2 style="margin:0 0 8px;color:#6a4dff">3DSTL</h2>
  <h3 style="margin:0 0 12px">${title}</h3>
  ${body}
  <p style="color:#666;font-size:13px;margin-top:20px">لأي سؤال، ردّ على هذا الإيميل أو راسلنا على 3dstl.lb@gmail.com<br>— فريق 3DSTL</p>
</div>`;

const toCustomer = (email, subject, title, body, text) =>
  email ? send({ to: email, subject, html: customerShell(title, body), text, replyTo: TO() }) : Promise.resolve(false);

/** تأكيد طلب المتجر للزبون */
export function confirmShopOrder(order, items = [], email) {
  const lines = items.map((i) => `${esc(i.product_name)} ${i.size ? `(${esc(i.size)})` : ''} × ${esc(i.qty)}`).join('<br>');
  return toCustomer(
    email,
    `✅ استلمنا طلبك #${order.id} — 3DSTL`,
    `شكراً ${esc(order.shipping_name)}، استلمنا طلبك!`,
    `${table([
      ['رقم الطلب', `#${esc(order.id)}`],
      ['المنتجات', lines],
      ['المجموع', `$${esc(Number(order.total_amount).toFixed(2))}`],
      ['التوصيل إلى', `${esc(order.shipping_address)} ${order.shipping_city ? `— ${esc(order.shipping_city)}` : ''}`],
    ])}
    <p>رح نتواصل معك على ${esc(order.shipping_phone)} لتأكيد الطلب والتوصيل.</p>
    ${button(`${SITE()}/profile`, 'طلباتي')}`,
    `استلمنا طلبك #${order.id} — المجموع $${order.total_amount}. رح نتواصل معك قريباً. 3DSTL`,
  );
}

/** تأكيد طلب الطباعة من الـ Studio للزبون */
export function confirmStudioOrder(o) {
  const est = o.estimate || {};
  return toCustomer(
    o.email,
    `✅ استلمنا طلب الطباعة ${o.id} — 3DSTL`,
    `شكراً ${esc(o.customer_name)}، استلمنا طلب الطباعة!`,
    `${table([
      ['رقم الطلب', esc(o.id)],
      ['التصميم', esc(o.tool_name || o.tool_id)],
      ['الكمية', esc(o.qty)],
      ['السعر التقريبي', est.price ? `${esc(est.price)} ${esc(est.currency)}` : ''],
    ])}
    <p>السعر تقريبي — رح نتواصل معك على ${esc(o.customer_phone)} لتأكيد التفاصيل والسعر النهائي قبل الطباعة.</p>`,
    `استلمنا طلب الطباعة ${o.id}. رح نتواصل معك قريباً. 3DSTL`,
  );
}

/** تأكيد استلام طلب الشحن للزبون */
export function confirmCreditRequest(r) {
  return toCustomer(
    r.email,
    `⏳ استلمنا طلب شحن الكريدت ${r.id} — 3DSTL`,
    'استلمنا طلب الشحن وعم نراجعه',
    `${table([
      ['رقم الطلب', esc(r.id)],
      ['الباقة', `${esc(Number(r.credits).toLocaleString())} كريدت`],
      ['المبلغ', `${esc(Number(r.price).toFixed(2))} ${esc(r.currency)}`],
      ['رقم العملية', `<span dir="ltr">${esc(r.reference)}</span>`],
    ])}
    <p>بس نتأكد من وصول التحويل، بينزل الرصيد بحسابك وبيوصلك إيميل.</p>
    ${button(`${SITE()}/credits`, 'رصيدي')}`,
    `استلمنا طلب الشحن ${r.id} (${r.credits} كريدت). رح نراجعه قريباً. 3DSTL`,
  );
}

/** نتيجة طلب الشحن للزبون: approved | rejected */
export function notifyCreditDecision(r, approved, balance) {
  return approved
    ? toCustomer(
        r.email,
        `🎉 انضاف ${Number(r.credits).toLocaleString()} كريدت لحسابك — 3DSTL`,
        'تمّت الموافقة على طلب الشحن',
        `${table([
          ['رقم الطلب', esc(r.id)],
          ['الكريدت المضاف', `${esc(Number(r.credits).toLocaleString())}`],
          ['رصيدك الحالي', balance != null ? esc(Number(balance).toLocaleString()) : ''],
        ])}
        ${button(`${SITE()}/studio`, 'ابدأ التصميم')}`,
        `انضاف ${r.credits} كريدت لحسابك. رصيدك: ${balance ?? ''}. 3DSTL`,
      )
    : toCustomer(
        r.email,
        `طلب الشحن ${r.id} لم يُقبل — 3DSTL`,
        'ما قدرنا نأكّد التحويل',
        `<p>ما لقينا تحويل مطابق لطلب الشحن ${esc(r.id)} (رقم العملية <span dir="ltr">${esc(r.reference)}</span>).</p>
        ${r.admin_note ? `<p>ملاحظة: ${esc(r.admin_note)}</p>` : ''}
        <p>إذا دفعت فعلاً، ردّ على هذا الإيميل مع صورة عن الإيصال ومنصلّحها.</p>`,
        `طلب الشحن ${r.id} لم يُقبل. ردّ على هذا الإيميل مع الإيصال إذا دفعت. 3DSTL`,
      );
}
