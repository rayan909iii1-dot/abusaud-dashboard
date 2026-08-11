const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const fs = require('fs');
const path = require('path');

const app = express();

// Railway يعطي PORT تلقائياً
const PORT = process.env.PORT || 3000;

// رابط موقعك
const SITE_URL =
    process.env.SITE_URL ||
    'https://abusaud-dashboard-production.up.railway.app';

// =========================
// إعدادات Express
// =========================

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ملفات public
app.use(express.static(path.join(__dirname, 'public')));

// =========================
// إنشاء مجلد sessions
// =========================

const sessionsPath = path.join(__dirname, 'sessions');

if (!fs.existsSync(sessionsPath)) {
    fs.mkdirSync(sessionsPath, { recursive: true });
}

// =========================
// Session
// =========================

app.use(
    session({
        store: new FileStore({
            path: sessionsPath
        }),

        secret:
            process.env.SESSION_SECRET ||
            'AbuSaudSecretKey909',

        resave: false,
        saveUninitialized: false,

        cookie: {
            secure: false,
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24 * 7
        }
    })
);

// =========================
// قاعدة البيانات
// =========================

const databasePath = path.join(__dirname, 'database.json');

const getDB = () => {
    if (!fs.existsSync(databasePath)) {
        const defaultDB = {
            users: [
                {
                    username: 'abu saud',
                    password: '123',
                    isAdmin: true
                }
            ],
            bots: []
        };

        fs.writeFileSync(
            databasePath,
            JSON.stringify(defaultDB, null, 2),
            'utf8'
        );
    }

    try {
        return JSON.parse(
            fs.readFileSync(databasePath, 'utf8')
        );
    } catch (error) {
        console.error('Database read error:', error);

        return {
            users: [],
            bots: []
        };
    }
};

const saveDB = (data) => {
    fs.writeFileSync(
        databasePath,
        JSON.stringify(data, null, 2),
        'utf8'
    );
};

// =========================
// بيانات الـ Embed
// =========================

const embedData = {
    siteUrl: SITE_URL,

    title: 'AbuSaud Store | لوحة تحكم البوتات',

    description:
        'لوحة تحكم متكاملة لإدارة وتشغيل البوتات الخاصة بك بسهولة وعلى مدار الساعة.',

    image:
        `${SITE_URL}/images/banner.png`
};

// =========================
// الصفحة الرئيسية
// =========================

app.get('/', (req, res) => {

    // إذا المستخدم غير مسجل دخول
    // نعرض صفحة تسجيل الدخول مباشرة
    // بدلاً من redirect
    if (!req.session.user) {
        return res.render('login', {
            error: null,
            embed: embedData
        });
    }

    // المستخدم مسجل دخول
    const db = getDB();

    const isAdmin =
        req.session.user.isAdmin || false;

    const userBots = isAdmin
        ? db.bots
        : db.bots.filter(
            bot =>
                bot.owner ===
                req.session.user.username
        );

    return res.render('index', {

        currentUser:
            req.session.user.username,

        isAdmin,

        bots: userBots,

        allUsers: db.users,

        availableScripts: [
            'Welcome',
            'Tickets',
            'Protection'
        ],

        embed: embedData
    });
});

// =========================
// تسجيل الدخول
// =========================

app.get('/login', (req, res) => {

    // إذا كان مسجل دخول
    if (req.session.user) {
        return res.redirect('/');
    }

    res.render('login', {
        error: null,
        embed: embedData
    });
});

app.post('/login', (req, res) => {

    const db = getDB();

    const username =
        (req.body.username || '').trim();

    const password =
        req.body.password || '';

    const user = db.users.find(
        u =>
            u.username === username &&
            u.password === password
    );

    if (!user) {
        return res.render('login', {
            error: 'بيانات الدخول غير صحيحة',
            embed: embedData
        });
    }

    req.session.user = {
        username: user.username,
        isAdmin: user.isAdmin
    };

    req.session.save(() => {
        res.redirect('/');
    });
});

// =========================
// إنشاء حساب
// =========================

app.get('/register', (req, res) => {

    res.render('register', {
        error: null,
        embed: embedData
    });
});

app.post('/register', (req, res) => {

    const db = getDB();

    const username =
        (req.body.username || '').trim();

    const password =
        req.body.password || '';

    if (!username || !password) {
        return res.render('register', {
            error: 'يرجى تعبئة جميع البيانات',
            embed: embedData
        });
    }

    const existingUser =
        db.users.find(
            u => u.username === username
        );

    if (existingUser) {
        return res.render('register', {
            error: 'اسم المستخدم موجود مسبقاً',
            embed: embedData
        });
    }

    db.users.push({
        username,
        password,
        isAdmin: false
    });

    saveDB(db);

    res.redirect('/login');
});

// =========================
// إضافة بوت
// =========================

app.post('/add-bot', (req, res) => {

    if (
        !req.session.user ||
        !req.session.user.isAdmin
    ) {
        return res.redirect('/');
    }

    const db = getDB();

    db.bots.push({
        ...req.body,
        createdAt: new Date().toISOString()
    });

    saveDB(db);

    res.redirect('/');
});

// =========================
// تسجيل الخروج
// =========================

app.get('/logout', (req, res) => {

    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// =========================
// Health Check
// =========================

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// =========================
// تشغيل السيرفر
// =========================

app.listen(PORT, '0.0.0.0', () => {

    console.log(
        `Server running on port ${PORT}`
    );

    console.log(
        `Website: ${SITE_URL}`
    );
});
