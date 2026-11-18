// ============================================================================
// 3DSTL — إرسال إيميلات الطلبات من Gmail تبعك (3dstl.lb@gmail.com)
//
// 1. افتح https://script.google.com وأنت داخل بحساب 3dstl.lb@gmail.com → New project
// 2. امسح كل شيء والصق هذا الملف، وغيّر SECRET تحت إلى كلمة سرّ طويلة من اختراعك
// 3. Deploy → New deployment → النوع: Web app
//      Execute as: Me    ·    Who has access: Anyone
//    ثم Deploy → وافق على الصلاحية (Send email as you فقط) → انسخ Web app URL
// 4. في Railway (backend) → Variables:
//      GMAIL_SCRIPT_URL = الرابط المنسوخ
//      NOTIFY_SECRET    = نفس كلمة السرّ
// ============================================================================

const SECRET = 'غيّر-هذه-الكلمة-لكلمة-سر-طويلة';
const OWNER = '3dstl.lb@gmail.com';

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (!SECRET || d.secret !== SECRET) return out({ ok: false, error: 'forbidden' });
    const to = String(d.to || OWNER);
    // MailApp: صلاحية «إرسال إيميل» فقط — لا يقرأ ولا يمسح إيميلاتك
    MailApp.sendEmail(to, String(d.subject || '3DSTL').slice(0, 200), String(d.text || ''), {
      htmlBody: String(d.html || ''),
      name: '3DSTL Studio',
      replyTo: d.replyTo || undefined,
    });
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// زر تجربة: اختر testEmail من فوق واضغط Run — يجب أن يصلك إيميل
function testEmail() {
  MailApp.sendEmail(OWNER, 'تجربة 3DSTL ✓', 'إذا وصلك هذا الإيميل، السكربت شغّال.');
}
