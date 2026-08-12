const{Client,GatewayIntentBits,Partials,EmbedBuilder}=require("discord.js"),fs=require("fs"),path=require("path");
const token=process.env.BOT_TOKEN,id=process.env.CLIENT_ID;if(!token)process.exit(1);
const cfg=path.join(__dirname,`welcome_${id}.json`);
function config(){if(!fs.existsSync(cfg))fs.writeFileSync(cfg,JSON.stringify({welcomeChannelId:"",autoRoleId:""},null,2));return JSON.parse(fs.readFileSync(cfg,"utf8"))}
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent],partials:[Partials.GuildMember]});
client.once("ready",()=>console.log(`Welcome online: ${client.user.tag}`));
client.on("guildMemberAdd",async m=>{try{const c=config();if(c.autoRoleId)await m.roles.add(c.autoRoleId).catch(()=>{});const ch=m.guild.channels.cache.get(c.welcomeChannelId||m.guild.systemChannelId);if(!ch)return;const e=new EmbedBuilder().setColor("#1e293b").setTitle(`Welcome To ${m.guild.name}`).addFields({name:"Member",value:`<@${m.id}>`,inline:true},{name:"Number",value:String(m.guild.memberCount),inline:true}).setThumbnail(m.guild.iconURL()||undefined).setTimestamp();await ch.send({content:`<@${m.id}>`,embeds:[e]})}catch(e){console.error(e.message)}});
client.login(token).catch(e=>{console.error("Discord login failed:",e.message);process.exit(1)});
