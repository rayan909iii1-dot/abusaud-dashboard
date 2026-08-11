const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_URL = process.env.SITE_URL || 'https://abusaud-dashboard-production.up.railway.app';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const sessionsPath = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsPath)) fs.mkdirSync(sessionsPath, { recursive: true });

app.use(session({
    store: new FileStore({ path: sessionsPath }),
    secret: process.env.SESSION_SECRET || 'change-this-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
}));

const databasePath = path.join(__dirname, 'database.json');

function getDB() {
    if (!fs.existsSync(databasePath)) {
        const initial = {
            users: [
                { username: 'abu saud', password: '123', email: 'admin@example.com', isAdmin: true, emailVerified: true }
            ],
            bots: []
        };
        fs.writeFileSync(databasePath, JSON.stringify(initial, null, 2), 'utf8');
    }

    try {
        return JSON.parse(fs.readFileSync(databasePath, 'utf8'));
    } catch {
        return { users: [], bots: [] };
    }
}

function saveDB(data) {
    fs.writeFileSync(databasePath, JSON.stringify(data, null, 2), 'utf8');
}

/*
 * SMTP
 * ضع هذه المتغيرات في Railway Variables:
 *
 * SMTP_HOST
 * SMTP_PORT
 * SMTP_USER
 * SMTP_PASS
 * MAIL_FROM
 *
 * مثال Brevo:
 * SMTP_HOST=smtp-relay.brevo.com
 * SMTP_PORT=587
 * SMTP_USER=your-brevo-login
 * SMTP_PASS=your-brevo-smtp-key
 * MAIL_FROM="AbuSaud Store <your-verified-email@example.com>"
 */
const mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_PORT) === '465',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

async function sendVerificationEmail(email, username, code) {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        throw new Error('SMTP environment variables are not configured.');
    }

    await mailTransporter.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: email,
        subject: 'كود التحقق - AbuSaud Store',
        text: `مرحباً ${username}\n\nكود التحقق الخاص بك هو: ${code}\n\nينتهي الكود خلال 10 دقائق.`,
        html: `
<!doctype html>
<html lang="ar" dir="rtl">
<body style="margin:0;background:#070b14;font-family:Arial,Tahoma,sans-serif;color:#fff;padding:35px">
  <div style="max-width:520px;margin:auto;background:#0d1422;border:1px solid #243149;border-radius:18px;padding:30px">
    <h2 style="margin-top:0">AbuSaud Store</h2>
    <p>مرحباً <b>${escapeHtml(username)}</b>،</p>
    <p style="color:#b6c2d4">استخدم الكود التالي لتأكيد بريدك الإلكتروني:</p>
    <div style="font-size:32px;font-weight:800;letter-spacing:8px;text-align:center;background:#080d17;border:1px solid #273449;border-radius:12px;padding:18px;margin:25px 0">${code}</div>
    <p style="color:#94a3b8;font-size:13px">الكود صالح لمدة 10 دقائق فقط.</p>
  </div>
</body>
</html>`
    });
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function makeCode() {
    return crypto.randomInt(100000, 1000000).toString();
}

function hashCode(code) {
    return crypto.createHash('sha256').update(code).digest('hex');
}

function pendingUser(req) {
    return req.session.pendingRegistration || null;
}

const embedData = {
    siteUrl: SITE_URL,
    title: 'AbuSaud Store | لوحة تحكم البوتات',
    description: 'لوحة تحكم متكاملة لإدارة وتشغيل البوتات بسهولة.',
    image: `${SITE_URL}/images/banner.png`
};

/* Home */
app.get('/', (req, res) => {
    if (!req.session.user) {
        return res.render('login', { error: null, embed: embedData });
    }

    const db = getDB();
    const isAdmin = Boolean(req.session.user.isAdmin);
    const bots = isAdmin
        ? db.bots
        : db.bots.filter(b => b.owner === req.session.user.username);

    res.render('index', {
        currentUser: req.session.user.username,
        isAdmin,
        bots,
        allUsers: db.users,
        availableScripts: ['Welcome', 'Tickets', 'Protection'],
        embed: embedData
    });
});

/* Login */
app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('login', { error: null, embed: embedData });
});

app.post('/login', (req, res) => {
    const db = getDB();
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    const user = db.users.find(u => u.username === username && u.password === password);

    if (!user) {
        return res.render('login', {
            error: 'بيانات الدخول غير صحيحة',
            embed: embedData
        });
    }

    if (user.email && user.emailVerified === false) {
        return res.render('login', {
            error: 'يجب تأكيد بريدك الإلكتروني أولاً. أنشئ الحساب من جديد لإرسال كود التحقق.',
            embed: embedData
        });
    }

    req.session.user = {
        username: user.username,
        isAdmin: Boolean(user.isAdmin)
    };

    req.session.save(() => res.redirect('/'));
});

/* Register */
app.get('/register', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('register', { error: null, embed: embedData });
});

app.post('/register', async (req, res) => {
    const db = getDB();

    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!username || !email || !password) {
        return res.render('register', {
            error: 'يرجى تعبئة جميع البيانات',
            embed: embedData
        });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.render('register', {
            error: 'يرجى إدخال بريد إلكتروني صحيح',
            embed: embedData
        });
    }

    if (password.length < 6) {
        return res.render('register', {
            error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل',
            embed: embedData
        });
    }

    if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
        return res.render('register', {
            error: 'اسم المستخدم موجود مسبقاً',
            embed: embedData
        });
    }

    if (db.users.some(u => u.email && u.email.toLowerCase() === email)) {
        return res.render('register', {
            error: 'هذا البريد الإلكتروني مستخدم مسبقاً',
            embed: embedData
        });
    }

    const code = makeCode();

    req.session.pendingRegistration = {
        username,
        email,
        password,
        codeHash: hashCode(code),
        expiresAt: Date.now() + 10 * 60 * 1000,
        lastSentAt: Date.now()
    };

    try {
        await sendVerificationEmail(email, username, code);

        res.render('verify', {
            error: null,
            email,
            embed: embedData
        });
    } catch (error) {
        console.error('Email send error:', error);
        delete req.session.pendingRegistration;

        res.render('register', {
            error: 'تعذر إرسال كود التحقق. تأكد من إعدادات البريد في Railway.',
            embed: embedData
        });
    }
});

/* Verify email */
app.get('/verify-email', (req, res) => {
    const pending = pendingUser(req);

    if (!pending) return res.redirect('/register');

    res.render('verify', {
        error: null,
        email: pending.email,
        embed: embedData
    });
});

app.post('/verify-email', (req, res) => {
    const pending = pendingUser(req);
    const code = String(req.body.code || '').trim();

    if (!pending) return res.redirect('/register');

    if (Date.now() > pending.expiresAt) {
        delete req.session.pendingRegistration;

        return res.render('register', {
            error: 'انتهت صلاحية الكود. أعد التسجيل للحصول على كود جديد.',
            embed: embedData
        });
    }

    if (!/^\d{6}$/.test(code) || hashCode(code) !== pending.codeHash) {
        return res.render('verify', {
            error: 'كود التحقق غير صحيح',
            email: pending.email,
            embed: embedData
        });
    }

    const db = getDB();

    if (db.users.some(u => u.username.toLowerCase() === pending.username.toLowerCase())) {
        delete req.session.pendingRegistration;
        return res.render('register', {
            error: 'اسم المستخدم أصبح مستخدماً بالفعل',
            embed: embedData
        });
    }

    if (db.users.some(u => u.email && u.email.toLowerCase() === pending.email)) {
        delete req.session.pendingRegistration;
        return res.render('register', {
            error: 'البريد الإلكتروني أصبح مستخدماً بالفعل',
            embed: embedData
        });
    }

    db.users.push({
        username: pending.username,
        password: pending.password,
        email: pending.email,
        isAdmin: false,
        emailVerified: true
    });

    saveDB(db);

    req.session.user = {
        username: pending.username,
        isAdmin: false
    };

    delete req.session.pendingRegistration;

    req.session.save(() => res.redirect('/'));
});

/* Resend code */
app.post('/resend-verification', async (req, res) => {
    const pending = pendingUser(req);

    if (!pending) return res.redirect('/register');

    const wait = 60 * 1000 - (Date.now() - pending.lastSentAt);

    if (wait > 0) {
        return res.render('verify', {
            error: `انتظر ${Math.ceil(wait / 1000)} ثانية قبل إعادة إرسال الكود.`,
            email: pending.email,
            embed: embedData
        });
    }

    const code = makeCode();

    pending.codeHash = hashCode(code);
    pending.expiresAt = Date.now() + 10 * 60 * 1000;
    pending.lastSentAt = Date.now();

    try {
        await sendVerificationEmail(pending.email, pending.username, code);

        res.render('verify', {
            error: 'تم إرسال كود جديد إلى بريدك الإلكتروني.',
            email: pending.email,
            success: true,
            embed: embedData
        });
    } catch (error) {
        console.error('Resend email error:', error);

        res.render('verify', {
            error: 'تعذر إعادة إرسال الكود حالياً.',
            email: pending.email,
            embed: embedData
        });
    }
});

/* Add bot */
app.post('/add-bot', (req, res) => {
    if (!req.session.user || !req.session.user.isAdmin) return res.redirect('/');

    const db = getDB();

    db.bots.push({
        ...req.body,
        createdAt: new Date().toISOString()
    });

    saveDB(db);
    res.redirect('/');
});

/* Logout */
app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Website: ${SITE_URL}`);
});
