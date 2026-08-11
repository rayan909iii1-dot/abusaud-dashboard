const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    store: new FileStore({ path: './sessions' }),
    secret: 'AbuSaudSecretKey909',
    resave: false,
    saveUninitialized: false
}));

// تحميل أو إنشاء قاعدة البيانات
const getDB = () => {
    if (!fs.existsSync('database.json')) {
        fs.writeFileSync('database.json', JSON.stringify({ users: [{ username: 'abu saud', password: '123', isAdmin: true }], bots: [] }, null, 2));
    }
    return JSON.parse(fs.readFileSync('database.json', 'utf8'));
};

const saveDB = (data) => fs.writeFileSync('database.json', JSON.stringify(data, null, 2));

// --- مسارات المصادقة ---
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
    const db = getDB();
    const user = db.users.find(u => u.username === req.body.username && u.password === req.body.password);
    if (user) { req.session.user = user; res.redirect('/'); }
    else { res.render('login', { error: 'بيانات غير صحيحة' }); }
});

app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', (req, res) => {
    const db = getDB();
    if (db.users.find(u => u.username === req.body.username)) return res.render('register', { error: 'المستخدم موجود' });
    db.users.push({ username: req.body.username, password: req.body.password, isAdmin: false });
    saveDB(db);
    res.redirect('/login');
});

// --- مسار الأدمن ---
app.post('/add-bot', (req, res) => {
    if (!req.session.user || !req.session.user.isAdmin) return res.redirect('/');
    const db = getDB();
    db.bots.push(req.body);
    saveDB(db);
    res.redirect('/');
});

// --- اللوحة الرئيسية ---
app.get('/', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const db = getDB();
    const isAdmin = req.session.user.isAdmin || false;
    
    res.render('index', { 
        currentUser: req.session.user.username, 
        isAdmin,
        bots: isAdmin ? db.bots : db.bots.filter(b => b.owner === req.session.user.username),
        allUsers: db.users,
        availableScripts: ['Welcome', 'Tickets', 'Protection']
    });
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
