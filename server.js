const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

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

const mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    tls: {
        rejectUnauthorized: false
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

    console.log(`========================================`);
    console.log(`[VERIFICATION CODE] For user: ${username} (${email})`);
    console.log(`CODE IS: --> ${code} <--`);
    console.log(`========================================`);

    req.session.pendingRegistration = {
        username,
        email,
        password,
        codeHash: hashCode(code),
        expiresAt: Date.now() + 10 * 60 * 1000,
        lastSentAt: Date.now()
    };

    try {
        await Promise.race([
            sendVerificationEmail(email, username, code),
            new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP_TIMEOUT')), 8000))
        ]);

        res.render('verify', {
            error: null,
            email,
            embed: embedData
        });
    } catch (error) {
        console.error('Email send error (Code is printed above in logs):', error);
        
        res.render('verify', {
            error: 'تعذر إرسال الإيميل، لكن تم طباعة الكود في سجلات Railway (Logs).',
            email,
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

    console.log(`========================================`);
    console.log(`[RESEND CODE] For user: ${pending.username} (${pending.email})`);
    console.log(`NEW CODE IS: --> ${code} <--`);
    console.log(`========================================`);

    pending.codeHash = hashCode(code);
    pending.expiresAt = Date.now() + 10 * 60 * 1000;
    pending.lastSentAt = Date.now();

    try {
        await Promise.race([
            sendVerificationEmail(pending.email, pending.username, code),
            new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP_TIMEOUT')), 8000))
        ]);

        res.render('verify', {
            error: 'تم إرسال كود جديد إلى بريدك الإلكتروني (ومتوفر في Logs).',
            email: pending.email,
            success: true,
            embed: embedData
        });
    } catch (error) {
        console.error('Resend email error:', error);

        res.render('verify', {
            error: 'تعذر إرسال الإيميل، الكود موجود في Railway Logs.',
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

// تشغيل موقع الـ Express
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Website: ${SITE_URL}`);
});


// ==========================================
// تشغيل بوت الديسكورد مدمجاً في نفس السيرفر
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const discordPendingRegistrations = new Map();
const discordPendingLogins = new Map();

client.once('ready', () => {
    console.log(`Discord Bot logged in as ${client.user.tag}`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content === '!setup') {
        const embed = new EmbedBuilder()
            .setTitle('AbuSaud Store | تسجيل وفتح الحسابات')
            .setDescription('انقر على الزر بالأسفل لإنشاء حسابك الجديد أو تسجيل الدخول بكل سهولة وسيتم إرسال كود التحقق الخاص بك على الخاص مباشرة.')
            .setColor(0x0099ff);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('open_register_modal')
                .setLabel('إنشاء حساب جديد')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('open_login_modal')
                .setLabel('تسجيل الدخول')
                .setStyle(ButtonStyle.Success)
        );

        await message.channel.send({ embeds: [embed], components: [row] });
        await message.delete().catch(() => {});
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        if (interaction.customId === 'open_register_modal') {
            const modal = new ModalBuilder()
                .setCustomId('register_modal')
                .setTitle('إنشاء حساب جديد');

            const usernameInput = new TextInputBuilder()
                .setCustomId('reg_username')
                .setLabel('اسم المستخدم')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const emailInput = new TextInputBuilder()
                .setCustomId('reg_email')
                .setLabel('البريد الإلكتروني')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const passwordInput = new TextInputBuilder()
                .setCustomId('reg_password')
                .setLabel('كلمة المرور (6 أحرف على الأقل)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(usernameInput),
                new ActionRowBuilder().addComponents(emailInput),
                new ActionRowBuilder().addComponents(passwordInput)
            );

            await interaction.showModal(modal);
        } else if (interaction.customId === 'open_login_modal') {
            const modal = new ModalBuilder()
                .setCustomId('login_modal')
                .setTitle('تسجيل الدخول عبر الديسكورد');

            const emailInput = new TextInputBuilder()
                .setCustomId('login_email')
                .setLabel('البريد الإلكتروني المسجل به')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(emailInput));
            await interaction.showModal(modal);
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'register_modal') {
            const username = interaction.fields.getTextInputValue('reg_username').trim();
            const email = interaction.fields.getTextInputValue('reg_email').trim().toLowerCase();
            const password = interaction.fields.getTextInputValue('reg_password');

            const db = getDB();

            if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
                return interaction.reply({ content: 'اسم المستخدم مستخدم مسبقاً!', ephemeral: true });
            }

            if (db.users.some(u => u.email && u.email.toLowerCase() === email)) {
                return interaction.reply({ content: 'البريد الإلكتروني مستخدم مسبقاً!', ephemeral: true });
            }

            const code = makeCode();

            discordPendingRegistrations.set(interaction.user.id, {
                username,
                email,
                password,
                codeHash: hashCode(code),
                expiresAt: Date.now() + 10 * 60 * 1000
            });

            try {
                await interaction.user.send(`مرحباً **${username}**،\nكود التحقق الخاص بإنشاء حسابك في AbuSaud Store هو:\n\`\`\`${code}\`\`\`\nهذا الكود صالح لمدة 10 دقائق.`);
                
                const verifyModal = new ModalBuilder()
                    .setCustomId('verify_modal')
                    .setTitle('تأكيد كود التحقق');

                const codeInput = new TextInputBuilder()
                    .setCustomId('verify_code')
                    .setLabel('أدخل الكود المرسل إلى الخاص')
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(6)
                    .setMaxLength(6)
                    .setRequired(true);

                verifyModal.addComponents(new ActionRowBuilder().addComponents(codeInput));
                await interaction.showModal(verifyModal);
            } catch {
                await interaction.reply({ content: 'تعذر إرسال رسالة الخاص (DM). تأكد من فتح الخاص ولديك رسائل خاصة مسموحة.', ephemeral: true });
            }
        }
        else if (interaction.customId === 'verify_modal') {
            const enteredCode = interaction.fields.getTextInputValue('verify_code').trim();
            const pending = discordPendingRegistrations.get(interaction.user.id);

            if (!pending) {
                return interaction.reply({ content: 'انتهت الجلسة، يرجى إعادة المحاولة.', ephemeral: true });
            }

            if (Date.now() > pending.expiresAt) {
                discordPendingRegistrations.delete(interaction.user.id);
                return interaction.reply({ content: 'انتهت صلاحية الكود. أعد التسجيل من جديد.', ephemeral: true });
            }

            if (hashCode(enteredCode) !== pending.codeHash) {
                return interaction.reply({ content: 'كود التحقق غير صحيح!', ephemeral: true });
            }

            const db = getDB();
            db.users.push({
                username: pending.username,
                password: pending.password,
                email: pending.email,
                isAdmin: false,
                emailVerified: true,
                discordId: interaction.user.id
            });
            saveDB(db);
            discordPendingRegistrations.delete(interaction.user.id);

            await interaction.reply({ content: 'تم إنشاء حسابك وتأكيد بريدك بنجاح تام! يمكنك الآن تسجيل الدخول بالموقع.', ephemeral: true });
        }
        else if (interaction.customId === 'login_modal') {
            const email = interaction.fields.getTextInputValue('login_email').trim().toLowerCase();
            const db = getDB();
            const user = db.users.find(u => u.email && u.email.toLowerCase() === email);

            if (!user) {
                return interaction.reply({ content: 'لم يتم العثور على حساب مرتبط بهذا البريد الإلكتروني.', ephemeral: true });
            }

            const code = makeCode();
            discordPendingLogins.set(interaction.user.id, {
                username: user.username,
                codeHash: hashCode(code),
                expiresAt: Date.now() + 10 * 60 * 1000
            });

            try {
                await interaction.user.send(`مرحباً **${user.username}**،\nكود تسجيل الدخول الخاص بك هو:\n\`\`\`${code}\`\`\`\nصالحة لمدة 10 دقائق.`);
                
                const loginVerifyModal = new ModalBuilder()
                    .setCustomId('login_verify_modal')
                    .setTitle('تأكيد تسجيل الدخول');

                const codeInput = new TextInputBuilder()
                    .setCustomId('login_verify_code')
                    .setLabel('أدخل كود الدخول المرسل للخاص')
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(6)
                    .setMaxLength(6)
                    .setRequired(true);

                loginVerifyModal.addComponents(new ActionRowBuilder().addComponents(codeInput));
                await interaction.showModal(loginVerifyModal);
            } catch {
                await interaction.reply({ content: 'تعذر إرسال الكود على الخاص. تأكد من إعدادات حسابك.', ephemeral: true });
            }
        }
        else if (interaction.customId === 'login_verify_modal') {
            const enteredCode = interaction.fields.getTextInputValue('login_verify_code').trim();
            const pending = discordPendingLogins.get(interaction.user.id);

            if (!pending || Date.now() > pending.expiresAt) {
                return interaction.reply({ content: 'انتهت الصلاحية، أعد المحاولة.', ephemeral: true });
            }

            if (hashCode(enteredCode) !== pending.codeHash) {
                return interaction.reply({ content: 'الكود غير صحيح!', ephemeral: true });
            }

            discordPendingLogins.delete(interaction.user.id);
            await interaction.reply({ content: `تم التحقق بنجاح! أهلاً بك يا ${pending.username}.`, ephemeral: true });
        }
    }
});

// تسجيل الدخول بالبوت باستخدام متغير البيئة DISCORD_TOKEN
client.login(process.env.DISCORD_TOKEN);
