/**
 * GR8MINDS · רישום לסדנאות
 *
 * הקוד הזה יושב בגוגל שיטס, לא באתר. הוא עושה שני דברים כשמישהו משלם:
 *   1. מוסיף שורה לגיליון
 *   2. שולח לנרשם מייל אישור עם כל הפרטים
 *
 * הוראות התקנה מלאות: ראו apps-script/README.md
 */

// חייב להיות זהה ל-SHEET_WEBHOOK_TOKEN שמוגדר ב-Vercel.
const TOKEN = 'שנו-אותי-למחרוזת-אקראית';

const SHEET_NAME = 'הרשמות';
const HEADERS = [
  'תאריך תשלום', 'שם', 'אימייל', 'טלפון', 'סדנה',
  'מועד', 'סכום', 'מספר הזמנה', 'מספר עסקה', 'מייל נשלח',
];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // בלי זה כל אחד שמכיר את הכתובת יכול להוסיף שורות.
    if (data.token !== TOKEN) {
      return json({ ok: false, error: 'bad token' });
    }

    const sheet = getSheet();

    // אם קארדקום שולח את אותה הודעה פעמיים, לא רושמים פעמיים.
    if (data.orderId && alreadyRecorded(sheet, data.orderId)) {
      return json({ ok: true, duplicate: true });
    }

    let mailed = 'לא';
    try {
      if (data.email) {
        sendConfirmation(data);
        mailed = 'כן';
      }
    } catch (err) {
      // המייל נכשל, אבל ההרשמה חייבת להירשם בכל מקרה.
      mailed = 'שגיאה: ' + err.message;
    }

    sheet.appendRow([
      new Date(),
      data.name || '',
      data.email || '',
      data.phone || '',
      data.workshopTitle || '',
      data.workshopWhen || '',
      data.amount || '',
      data.orderId || '',
      data.transactionId || '',
      mailed,
    ]);

    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err) });
  }
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function alreadyRecorded(sheet, orderId) {
  const col = HEADERS.indexOf('מספר הזמנה') + 1;
  const rows = sheet.getLastRow() - 1;
  if (rows < 1) return false;
  return sheet
    .getRange(2, col, rows, 1)
    .getValues()
    .some(function (r) { return r[0] === orderId; });
}

function sendConfirmation(d) {
  const subject = 'המקום שלך שמור · ' + (d.workshopTitle || 'סדנה של GR8MINDS');

  const html =
    '<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;' +
    'line-height:1.7;color:#0F0F1E;max-width:560px">' +
      '<p>היי ' + esc(d.name || '') + ',</p>' +
      '<p>התשלום התקבל והמקום שלך בסדנה שמור. הנה כל הפרטים:</p>' +
      '<table style="border-collapse:collapse;margin:18px 0">' +
        row('מה', d.workshopTitle) +
        row('מתי', d.workshopWhen) +
        row('איפה', d.workshopPlace) +
        row('מה מביאים', 'לפטופ טעון ומטען') +
      '</table>' +
      '<p><b>לפני שנפגשים, חמש דקות הכנה:</b></p>' +
      '<ul>' +
        '<li>לוודא שיש לך חשבון Claude פעיל בתשלום.</li>' +
        '<li>לחבר אליו Gmail ו-Google Calendar. נשלח הסבר קצר בהמשך.</li>' +
        '<li>להגיע עם חשבון גוגל שבאמת עובדים איתו, שם האייג\'נטים ירוצו.</li>' +
      '</ul>' +
      '<p style="color:#5A5A6E;font-size:13px">' +
        'ביטול עד 48 שעות לפני מזכה בהחזר מלא. ' +
        'מספר הזמנה: ' + esc(d.orderId || '') +
      '</p>' +
      '<p>נתראה,<br>לי, GR8MINDS<br>' +
        '<a href="mailto:ai@gr8minds.co.il">ai@gr8minds.co.il</a></p>' +
    '</div>';

  MailApp.sendEmail({
    to: d.email,
    subject: subject,
    htmlBody: html,
    name: 'GR8MINDS',
    replyTo: 'ai@gr8minds.co.il',
  });
}

function row(label, value) {
  if (!value) return '';
  return '<tr>' +
    '<td style="padding:5px 0;color:#8B8B9E;width:110px">' + esc(label) + '</td>' +
    '<td style="padding:5px 0;font-weight:bold">' + esc(value) + '</td>' +
    '</tr>';
}

// הנתונים מגיעים מהשרת שלנו, אבל השם והאימייל הוקלדו על ידי המשתמש,
// אז הם נכנסים ל-HTML כטקסט ולא כתגיות.
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** להרצה ידנית מתוך העורך, כדי לבדוק שהמייל והגיליון עובדים. */
function testRun() {
  doPost({ postData: { contents: JSON.stringify({
    token: TOKEN,
    orderId: 'test-' + Date.now(),
    transactionId: '0',
    amount: 590,
    name: 'בדיקה',
    email: Session.getActiveUser().getEmail(),
    phone: '050-0000000',
    workshopTitle: 'סדנת בדיקה',
    workshopWhen: 'שני, 7 בספטמבר 2026, 10:00 עד 12:00',
    workshopPlace: 'אריה שנקר 1, הרצליה',
  }) } });
}
