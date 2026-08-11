const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const databasePath = path.join(__dirname, 'database.json');

function getDB() {
    if (!fs.existsSync(databasePath)) {
        const initial = { users: [], bots: [] };
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

function makeCode() {
    return crypto.randomInt(100000, 1000000).toString();
}

function hashCode(code) {
    return crypto.createHash('sha256').update(code).digest('hex');
}

// تخزين مؤقت لعمليات التسجيل وتأكيد الأكواد
const pendingRegistrations = new Map();
const pendingLogins = new Map();

client.once('ready', () => {
    console.log(`Discord Bot logged in as ${client.user.tag}`);
});

// أمر بسيط لإرسال رسالة السيت أب ( Setup ) في الروم اللي تبيها
// اكتب في الديسكورد داخل الروم: !setup
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

// التعامل مع الضغط على الأزرار وفتح النوافذ (Modals)
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

    // استقبال بيانات إنشاء الحساب وإرسال كود التحقق للخاص
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

            pendingRegistrations.set(interaction.user.id, {
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

        // تأكيد الكود وإتمام التسجيل وحفظه في قاعدة البيانات
        else if (interaction.customId === 'verify_modal') {
            const enteredCode = interaction.fields.getTextInputValue('verify_code').trim();
            const pending = pendingRegistrations.get(interaction.user.id);

            if (!pending) {
                return interaction.reply({ content: 'انتهت الجلسة، يرجى إعادة المحاولة.', ephemeral: true });
            }

            if (Date.now() > pending.expiresAt) {
                pendingRegistrations.delete(interaction.user.id);
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
            pendingRegistrations.delete(interaction.user.id);

            await interaction.reply({ content: 'تم إنشاء حسابك وتأكيد بريدك بنجاح تام! يمكنك الآن تسجيل الدخول بالموقع.', ephemeral: true });
        }

        // تسجيل الدخول عبر البريد وإرسال كود التحقق للخاص
        else if (interaction.customId === 'login_modal') {
            const email = interaction.fields.getTextInputValue('login_email').trim().toLowerCase();
            const db = getDB();
            const user = db.users.find(u => u.email && u.email.toLowerCase() === email);

            if (!user) {
                return interaction.reply({ content: 'لم يتم العثور على حساب مرتبط بهذا البريد الإلكتروني.', ephemeral: true });
            }

            const code = makeCode();
            pendingLogins.set(interaction.user.id, {
                username: user.username,
                codeHash: hashCode(code),
                expiresAt: Date.now() + 10 * 60 * 1000
            });

            try {
                await interaction.user.send(`مرحباً **${user.username}**،\nكود تسجيل الدخول الخاص بك هو:\n\`\`\`${code}\`\`\nصالحة لمدة 10 دقائق.`);
                
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

        // تأكيد كود الدخول
        else if (interaction.customId === 'login_verify_modal') {
            const enteredCode = interaction.fields.getTextInputValue('login_verify_code').trim();
            const pending = pendingLogins.get(interaction.user.id);

            if (!pending || Date.now() > pending.expiresAt) {
                return interaction.reply({ content: 'انتهت الصلاحية، أعد المحاولة.', ephemeral: true });
            }

            if (hashCode(enteredCode) !== pending.codeHash) {
                return interaction.reply({ content: 'الكود غير صحيح!', ephemeral: true });
            }

            pendingLogins.delete(interaction.user.id);
            await interaction.reply({ content: `تم التحقق بنجاح! أهلاً بك يا ${pending.username}.`, ephemeral: true });
        }
    }
});

// ضع توكن البوت هنا أو في متغيرات البيئة
client.login("MTUzNjYyNTg5MTYxNzI3NTkyNA.GKI_sc.-1uSs79lx1cxpLcj7eBCojUMwjzuRVRKbSHmpk");
