const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!BOT_TOKEN) {
console.error('❌ Error: Bot Token is missing!');
process.exit(1);
}

// الرمز (Prefix) الخاص بالأوامر
const PREFIX = "!";

// مسار ملف الإعدادات الخاص بكل بوت لكي يحفظ روم الترحيب بشكل مستقل
const configPath = path.join(__dirname, config_${CLIENT_ID}.json);

function getConfig() {
if (!fs.existsSync(configPath)) {
fs.writeFileSync(configPath, JSON.stringify({ welcomeChannelId: "", autoRoleId: "" }, null, 2));
}
return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function saveConfig(data) {
fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
}

const client = new Client({
intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMembers,
GatewayIntentBits.GuildInvites,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent
],
partials: [Partials.GuildMember]
});

const invitesCache = new Map();
const ownerId = "1113483140086907093"; // آيدي حسابك إذا دخل برابط مباشر

client.once('ready', async () => {
console.log(✨ Welcome Bot is online as ${client.user.tag} (ID: ${CLIENT_ID}));

client.guilds.cache.forEach(async guild => {
    try {
        const firstInvites = await guild.invites.fetch();
        invitesCache.set(guild.id, firstInvites);
    } catch (err) {
        console.log(`فشل في جلب دعوات السيرفر: ${guild.name}`);
    }
});


});

// التعامل مع الأوامر النصية بالبريفكس
client.on('messageCreate', async message => {
if (message.author.bot || !message.guild) return;
if (!message.content.startsWith(PREFIX)) return;

const args = message.content.slice(PREFIX.length).trim().split(/ +/);
const command = args.shift().toLowerCase();

if (command === 'setwelcome') {
    // التحقق من صلاحيات المسؤول
    if (!message.member.permissions.has('Administrator')) {
        return message.reply('❌ عذراً، يجب أن تمتلك صلاحية المسؤول (Administrator) لتحديد روم الترحيب.');
    }

    const config = getConfig();
    config.welcomeChannelId = message.channel.id;
    saveConfig(config);

    await message.reply(`✅ تم بنجاح تعيين هذه الروم (<#${message.channel.id}>) لتكون روم الترحيب الخاصة بالبوت!`);
}


});

client.on('inviteCreate', async invite => {
const guildInvites = invitesCache.get(invite.guild.id);
if (guildInvites) guildInvites.set(invite.code, invite);
});

client.on('inviteDelete', async invite => {
const guildInvites = invitesCache.get(invite.guild.id);
if (guildInvites) guildInvites.delete(invite.code);
});

client.on('guildMemberAdd', async member => {
try {
const guild = member.guild;
const config = getConfig();

    // 1. إعطاء الرتبة التلقائية (إذا وجدت)
    if (config.autoRoleId) {
        await member.roles.add(config.autoRoleId).catch(() => {});
    }

    // 2. تتبع الدعوات
    let inviterId = null;
    const cachedInvites = invitesCache.get(guild.id);
    
    if (cachedInvites) {
        const newInvites = await guild.invites.fetch();
        const foundInvite = newInvites.find(inv => {
            const cached = cachedInvites.get(inv.code);
            return cached && inv.uses > cached.uses;
        });
        if (foundInvite && foundInvite.inviter) {
            inviterId = foundInvite.inviter.id;
            invitesCache.set(guild.id, newInvites);
        }
    }

    const finalInviter = inviterId ? `<@${inviterId}>` : `<@${ownerId}>`;

    // 3. روم الترحيب (المحفوظة عبر الأمر أو روم النظام كاحتياط)
    const channelId = config.welcomeChannelId || guild.systemChannelId;
    if (!channelId) return;
    
    const welcomeChannel = guild.channels.cache.get(channelId);
    if (!welcomeChannel) return;

    const createdAt = Math.floor(member.user.createdTimestamp / 1000);
    const memberNumber = guild.memberCount;

    // 4. بناء الإيمبد
    const welcomeEmbed = new EmbedBuilder()
        .setColor('#1e293b')
        .setAuthor({ 
            name: `${member.user.username}`, 
            iconURL: member.user.displayAvatarURL({ dynamic: true }) 
        })
        .setTitle('Welcome To ♃ Abu Saud Server ♃')
        .addFields(
            { name: 'Member :', value: `<@${member.id}>`, inline: true },
            { name: 'Create Discord :', value: `<t:${createdAt}:R>`, inline: true },
            { name: 'Number :', value: `${memberNumber}`, inline: true },
            { name: 'Invited By :', value: `${finalInviter}`, inline: false }
        )
        .setImage('https://media.discordapp.net/attachments/1532884755698421861/1532890629888016484/ChatGPT_Image_1_2026_02_20_00_.png?ex=6a6e7f25&is=6a6d2da5&hm=dc51d61a19c78fd2caf26ac3071643294fa57b7c99898f47bf2e78878675bc9a&=&format=webp&quality=lossless&width=1024&height=1024')
        .setThumbnail(guild.iconURL({ dynamic: true }))
        .setFooter({ 
            text: `Powered By [ ${guild.name} & Abu Saud ]`, 
            iconURL: guild.iconURL({ dynamic: true }) 
        })
        .setTimestamp();

    await welcomeChannel.send({
        content: `<@${member.id}>`,
        embeds: [welcomeEmbed]
    });

} catch (error) {
    console.error('Error in guildMemberAdd:', error);
}


});

client.login(BOT_TOKEN);
