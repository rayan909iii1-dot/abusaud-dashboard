const {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionsBitField,
    AuditLogEvent,
    EmbedBuilder,
    Collection
} = require("discord.js");

/* =========================================================
   CONFIG
========================================================= */

const TOKEN = "MTUzNjg2NTI1NDU0ODcwMTE4Nw.GGoTnt.Zk4e7AgI4oAu3TqHb3OjGaPa8xJblxhLN8mOEY";

const CONFIG = {
    // ضع ID السيرفر
    GUILD_ID: "1535126151859535905",

    // روم اللوق
    LOG_CHANNEL_ID: "1535407121271758888",

    // الأشخاص المستثنون من الحماية
    WHITELIST: [
        "1113483140086907093"
    ],

    // Anti Raid
    RAID: {
        enabled: true,
        joinLimit: 5,
        timeWindow: 10 * 1000,
        lockdownDuration: 60 * 1000
    },

    // Anti Spam
    SPAM: {
        enabled: true,
        messageLimit: 6,
        timeWindow: 5000,
        muteDuration: 10 * 60 * 1000
    },

    // حماية حذف الرومات
    CHANNEL_DELETE: {
        enabled: true,
        limit: 2,
        timeWindow: 10000
    },

    // حماية حذف الرتب
    ROLE_DELETE: {
        enabled: true,
        limit: 2,
        timeWindow: 10000
    },

    // حماية إنشاء الرومات
    CHANNEL_CREATE: {
        enabled: true,
        limit: 5,
        timeWindow: 10000
    },

    // حماية إنشاء الرتب
    ROLE_CREATE: {
        enabled: true,
        limit: 5,
        timeWindow: 10000
    },

    // حماية البوتات
    BOT_PROTECTION: {
        enabled: true,
        allowBots: [
            // "BOT_ID"
        ]
    }
};


/* =========================================================
   CLIENT
========================================================= */

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration
    ],
    partials: [
        Partials.Channel,
        Partials.GuildMember,
        Partials.Message
    ]
});


/* =========================================================
   DATA
========================================================= */

const spamMap = new Collection();

const raidJoins = [];

const protectionCounters = {
    channelDelete: [],
    roleDelete: [],
    channelCreate: [],
    roleCreate: []
};

let lockdownActive = false;


/* =========================================================
   READY
========================================================= */

client.once("ready", async () => {

    console.log("====================================");
    console.log(`Protection Bot Online`);
    console.log(`Bot: ${client.user.tag}`);
    console.log(`Servers: ${client.guilds.cache.size}`);
    console.log("====================================");

    client.user.setPresence({
        activities: [
            {
                name: "Protection System",
                type: 3
            }
        ],
        status: "online"
    });

});


/* =========================================================
   HELPERS
========================================================= */

function isWhitelisted(id) {
    return CONFIG.WHITELIST.includes(id);
}


function isProtectedBot(id) {
    return CONFIG.BOT_PROTECTION.allowBots.includes(id);
}


function getLogChannel(guild) {

    if (!CONFIG.LOG_CHANNEL_ID) {
        return null;
    }

    return guild.channels.cache.get(CONFIG.LOG_CHANNEL_ID) || null;
}


async function sendLog(guild, title, description, color = 0x3b82f6) {

    try {

        const channel = getLogChannel(guild);

        if (!channel) return;

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(description)
            .setTimestamp()
            .setFooter({
                text: "Protection System"
            });

        await channel.send({
            embeds: [embed]
        });

    } catch (error) {

        console.log("Log Error:", error.message);

    }
}


function cleanOldEntries(array, timeWindow) {

    const now = Date.now();

    return array.filter(
        timestamp => now - timestamp <= timeWindow
    );

}


async function getExecutor(guild, type, targetId) {

    try {

        const logs = await guild.fetchAuditLogs({
            type,
            limit: 5
        });

        const entry = logs.entries.find(
            entry =>
                entry.target?.id === targetId &&
                Date.now() - entry.createdTimestamp < 10000
        );

        return entry?.executor || null;

    } catch {

        return null;

    }
}


async function punish(guild, userId, reason) {

    try {

        if (!userId) return;

        if (isWhitelisted(userId)) {
            return;
        }

        const member = await guild.members.fetch(userId).catch(() => null);

        if (!member) return;

        if (
            member.permissions.has(
                PermissionsBitField.Flags.Administrator
            )
        ) {
            await sendLog(
                guild,
                "تم اكتشاف محاولة تخريب",
                `العضو: <@${userId}>\nالسبب: ${reason}\nلم يتم اتخاذ إجراء بسبب امتلاكه Administrator.`,
                0xf59e0b
            );

            return;
        }

        try {

            await member.kick(reason);

        } catch {

            try {
                await member.timeout(
                    24 * 60 * 60 * 1000,
                    reason
                );
            } catch {}

        }

        await sendLog(
            guild,
            "تم اتخاذ إجراء أمني",
            `العضو: <@${userId}>\nالسبب: **${reason}**`,
            0xef4444
        );

    } catch (error) {

        console.log("Punishment Error:", error.message);

    }
}


/* =========================================================
   ANTI RAID
========================================================= */

client.on("guildMemberAdd", async member => {

    if (!CONFIG.RAID.enabled) return;

    if (member.user.bot) {

        if (
            !isProtectedBot(member.id) &&
            CONFIG.BOT_PROTECTION.enabled
        ) {

            const executor = await getExecutor(
                member.guild,
                AuditLogEvent.BotAdd,
                member.id
            );

            if (executor && !isWhitelisted(executor.id)) {

                await punish(
                    member.guild,
                    executor.id,
                    "إضافة بوت غير مصرح به"
                );

                await member.kick(
                    "Protection Bot: Unauthorized Bot"
                ).catch(() => {});

            }
        }

        return;
    }

    const now = Date.now();

    raidJoins.push(now);

    while (
        raidJoins.length &&
        now - raidJoins[0] > CONFIG.RAID.timeWindow
    ) {
        raidJoins.shift();
    }

    if (raidJoins.length >= CONFIG.RAID.joinLimit) {

        if (!lockdownActive) {

            lockdownActive = true;

            await sendLog(
                member.guild,
                "Anti-Raid Activated",
                `تم اكتشاف دخول **${raidJoins.length}** أعضاء خلال فترة قصيرة.\n\nتم تفعيل وضع الحماية.`,
                0xef4444
            );

            try {

                await member.guild.setVerificationLevel(
                    4,
                    "Protection Bot: Anti-Raid"
                );

            } catch {}

            setTimeout(async () => {

                try {

                    await member.guild.setVerificationLevel(
                        1,
                        "Protection Bot: Raid Protection Ended"
                    );

                } catch {}

                lockdownActive = false;

                raidJoins.length = 0;

                await sendLog(
                    member.guild,
                    "Anti-Raid Deactivated",
                    "انتهت فترة الحماية وعاد النظام للوضع الطبيعي.",
                    0x22c55e
                );

            }, CONFIG.RAID.lockdownDuration);

        }
    }

});


/* =========================================================
   ANTI SPAM
========================================================= */

client.on("messageCreate", async message => {

    if (!CONFIG.SPAM.enabled) return;

    if (!message.guild) return;

    if (message.author.bot) return;

    if (isWhitelisted(message.author.id)) return;

    const now = Date.now();

    let data = spamMap.get(message.author.id);

    if (!data) {

        data = [];

        spamMap.set(
            message.author.id,
            data
        );

    }

    data.push(now);

    const filtered = data.filter(
        timestamp =>
            now - timestamp <= CONFIG.SPAM.timeWindow
    );

    spamMap.set(
        message.author.id,
        filtered
    );

    if (
        filtered.length >=
        CONFIG.SPAM.messageLimit
    ) {

        spamMap.delete(message.author.id);

        try {
            await message.delete();
        } catch {}

        const member = message.member;

        if (member) {

            try {

                await member.timeout(
                    CONFIG.SPAM.muteDuration,
                    "Protection Bot: Anti-Spam"
                );

            } catch {}

        }

        await sendLog(
            message.guild,
            "Anti-Spam",
            `تم اكتشاف Spam من <@${message.author.id}>.\n\nتم اتخاذ إجراء تلقائي.`,
            0xef4444
        );

    }

});


/* =========================================================
   CHANNEL DELETE PROTECTION
========================================================= */

client.on("channelDelete", async channel => {

    if (!CONFIG.CHANNEL_DELETE.enabled) return;

    const guild = channel.guild;

    const executor = await getExecutor(
        guild,
        AuditLogEvent.ChannelDelete,
        channel.id
    );

    if (!executor) return;

    if (isWhitelisted(executor.id)) return;

    const now = Date.now();

    protectionCounters.channelDelete =
        cleanOldEntries(
            protectionCounters.channelDelete,
            CONFIG.CHANNEL_DELETE.timeWindow
        );

    protectionCounters.channelDelete.push(now);

    await punish(
        guild,
        executor.id,
        `حذف روم: ${channel.name}`
    );

    if (
        protectionCounters.channelDelete.length >=
        CONFIG.CHANNEL_DELETE.limit
    ) {

        await sendLog(
            guild,
            "Channel Protection",
            `تم اكتشاف حذف عدة رومات بواسطة <@${executor.id}>.`,
            0xef4444
        );

    }

});


/* =========================================================
   ROLE DELETE PROTECTION
========================================================= */

client.on("roleDelete", async role => {

    if (!CONFIG.ROLE_DELETE.enabled) return;

    const guild = role.guild;

    const executor = await getExecutor(
        guild,
        AuditLogEvent.RoleDelete,
        role.id
    );

    if (!executor) return;

    if (isWhitelisted(executor.id)) return;

    const now = Date.now();

    protectionCounters.roleDelete =
        cleanOldEntries(
            protectionCounters.roleDelete,
            CONFIG.ROLE_DELETE.timeWindow
        );

    protectionCounters.roleDelete.push(now);

    await punish(
        guild,
        executor.id,
        `حذف رتبة: ${role.name}`
    );

});


/* =========================================================
   CHANNEL CREATE PROTECTION
========================================================= */

client.on("channelCreate", async channel => {

    if (!CONFIG.CHANNEL_CREATE.enabled) return;

    const guild = channel.guild;

    const executor = await getExecutor(
        guild,
        AuditLogEvent.ChannelCreate,
        channel.id
    );

    if (!executor) return;

    if (isWhitelisted(executor.id)) return;

    const now = Date.now();

    protectionCounters.channelCreate =
        cleanOldEntries(
            protectionCounters.channelCreate,
            CONFIG.CHANNEL_CREATE.timeWindow
        );

    protectionCounters.channelCreate.push(now);

    if (
        protectionCounters.channelCreate.length >=
        CONFIG.CHANNEL_CREATE.limit
    ) {

        await channel.delete(
            "Protection Bot: Excessive Channel Creation"
        ).catch(() => {});

        await punish(
            guild,
            executor.id,
            "إنشاء عدد كبير من الرومات"
        );

    }

});


/* =========================================================
   ROLE CREATE PROTECTION
========================================================= */

client.on("roleCreate", async role => {

    if (!CONFIG.ROLE_CREATE.enabled) return;

    const guild = role.guild;

    const executor = await getExecutor(
        guild,
        AuditLogEvent.RoleCreate,
        role.id
    );

    if (!executor) return;

    if (isWhitelisted(executor.id)) return;

    const now = Date.now();

    protectionCounters.roleCreate =
        cleanOldEntries(
            protectionCounters.roleCreate,
            CONFIG.ROLE_CREATE.timeWindow
        );

    protectionCounters.roleCreate.push(now);

    if (
        protectionCounters.roleCreate.length >=
        CONFIG.ROLE_CREATE.limit
    ) {

        await role.delete(
            "Protection Bot: Excessive Role Creation"
        ).catch(() => {});

        await punish(
            guild,
            executor.id,
            "إنشاء عدد كبير من الرتب"
        );

    }

});


/* =========================================================
   BOT ADD PROTECTION
========================================================= */

client.on("guildMemberAdd", async member => {

    if (!CONFIG.BOT_PROTECTION.enabled) return;

    if (!member.user.bot) return;

    if (isProtectedBot(member.id)) return;

    const executor = await getExecutor(
        member.guild,
        AuditLogEvent.BotAdd,
        member.id
    );

    if (!executor) return;

    if (isWhitelisted(executor.id)) return;

    await member.kick(
        "Protection Bot: Unauthorized Bot"
    ).catch(() => {});

    await punish(
        member.guild,
        executor.id,
        `إضافة بوت غير مصرح به: ${member.user.tag}`
    );

});


/* =========================================================
   GUILD UPDATE PROTECTION
========================================================= */

client.on("guildUpdate", async (oldGuild, newGuild) => {

    try {

        const executor = await getExecutor(
            newGuild,
            AuditLogEvent.GuildUpdate,
            newGuild.id
        );

        if (!executor) return;

        if (isWhitelisted(executor.id)) return;

        let changes = [];

        if (oldGuild.name !== newGuild.name) {
            changes.push("تغيير اسم السيرفر");
        }

        if (oldGuild.icon !== newGuild.icon) {
            changes.push("تغيير صورة السيرفر");
        }

        if (changes.length === 0) return;

        await punish(
            newGuild,
            executor.id,
            changes.join(" + ")
        );

        await sendLog(
            newGuild,
            "Server Protection",
            `تم اكتشاف تعديل على السيرفر بواسطة <@${executor.id}>.\n\n${changes.join("\n")}`,
            0xef4444
        );

    } catch (error) {

        console.log("Guild Update Error:", error.message);

    }

});


/* =========================================================
   ERROR HANDLING
========================================================= */

process.on("unhandledRejection", error => {
    console.log("Unhandled Rejection:", error);
});

process.on("uncaughtException", error => {
    console.log("Uncaught Exception:", error);
});


/* =========================================================
   LOGIN
========================================================= */

client.login(TOKEN);
