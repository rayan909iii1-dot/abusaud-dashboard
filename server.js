const express=require("express"),session=require("express-session"),fs=require("fs"),path=require("path"),crypto=require("crypto"),{spawn}=require("child_process");
const app=express(),PORT=process.env.PORT||3000,DB=path.join(__dirname,"database.json"),BOTDIR=path.join(__dirname,"bots");
app.use(express.json());app.use(express.urlencoded({extended:true}));
app.use(session({secret:process.env.SESSION_SECRET||"CHANGE_THIS",resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"lax",maxAge:86400000}}));
app.use(express.static(path.join(__dirname,"public")));
function read(){if(!fs.existsSync(DB))fs.writeFileSync(DB,JSON.stringify({users:[],bots:[]},null,2));return JSON.parse(fs.readFileSync(DB,"utf8"))}
function write(x){fs.writeFileSync(DB,JSON.stringify(x,null,2))}
function auth(req,res,next){if(!req.session.user)return res.status(401).json({success:false,error:"غير مسجل الدخول"});next()}
function admin(req,res,next){if(!req.session.user?.isAdmin)return res.status(403).json({success:false,error:"Admin فقط"});next()}
const procs=new Map();
function scriptFor(s){return {welcome:"welcome.js",protection:"protection.js"}[s]}
function startBot(bot){
 if(procs.has(bot.id))return;
 const script=scriptFor(bot.script); if(!script)throw Error("نوع البوت غير معروف");
 if(!bot.token)throw Error("Bot Token مفقود");
 const child=spawn(process.execPath,[path.join(BOTDIR,script)],{cwd:__dirname,env:{...process.env,BOT_TOKEN:bot.token,CLIENT_ID:bot.id},stdio:["ignore","pipe","pipe"]});
 procs.set(bot.id,child);
 child.stdout.on("data",d=>console.log(`[${bot.id}] ${d}`)); child.stderr.on("data",d=>console.error(`[${bot.id}] ${d}`));
 child.on("exit",(code)=>{procs.delete(bot.id);const db=read(),b=db.bots.find(x=>x.id===bot.id);if(b){b.status="offline";b.lastError=code?"Process exited "+code:null;write(db)}});
}
function stopBot(id){const p=procs.get(id);if(!p)return false;try{p.kill("SIGTERM")}catch{};procs.delete(id);return true}

app.post("/api/login",(req,res)=>{const db=read(),u=db.users.find(x=>x.username===req.body.username&&x.password===req.body.password);if(!u)return res.status(401).json({success:false,error:"بيانات الدخول غير صحيحة"});req.session.user={username:u.username,isAdmin:!!u.isAdmin};res.json({success:true,user:req.session.user})});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({success:true})));
app.get("/api/me",auth,(req,res)=>res.json({success:true,user:req.session.user}));
app.get("/api/my-bots",auth,(req,res)=>{const db=read();res.json({success:true,bots:db.bots.filter(b=>b.owner===req.session.user.username).map(b=>({...b,token:b.token?"********":"",status:procs.has(b.id)?"online":b.status}))})});
app.post("/api/bots/:id/start",auth,(req,res)=>{const db=read(),b=db.bots.find(x=>x.id===req.params.id&&x.owner===req.session.user.username);if(!b)return res.status(404).json({success:false,error:"البوت غير موجود"});try{b.status="starting";b.lastError=null;write(db);startBot(b);res.json({success:true,status:"starting"})}catch(e){b.status="offline";b.lastError=e.message;write(db);res.status(500).json({success:false,error:e.message})}});
app.post("/api/bots/:id/stop",auth,(req,res)=>{const db=read(),b=db.bots.find(x=>x.id===req.params.id&&x.owner===req.session.user.username);if(!b)return res.status(404).json({success:false,error:"البوت غير موجود"});stopBot(b.id);b.status="offline";write(db);res.json({success:true,status:"offline"})});

app.get("/api/admin/users",auth,admin,(req,res)=>{const db=read();res.json({success:true,users:db.users.map(u=>({username:u.username,isAdmin:!!u.isAdmin,bots:db.bots.filter(b=>b.owner===u.username).length}))})});
app.post("/api/admin/users",auth,admin,(req,res)=>{const{username,password,isAdmin}=req.body,db=read();if(!username||!password)return res.status(400).json({success:false,error:"username/password مطلوبان"});if(db.users.some(u=>u.username===username))return res.status(409).json({success:false,error:"الحساب موجود"});db.users.push({username,password,isAdmin:!!isAdmin});write(db);res.json({success:true})});
app.get("/api/admin/bots",auth,admin,(req,res)=>{const db=read();res.json({success:true,bots:db.bots.map(b=>({id:b.id,name:b.name,script:b.script,owner:b.owner,status:procs.has(b.id)?"online":b.status,lastError:b.lastError||null}))})});
app.post("/api/admin/bots",auth,admin,(req,res)=>{const{name,token,script,owner}=req.body,db=read();if(!name||!token||!script||!owner)return res.status(400).json({success:false,error:"كل الحقول مطلوبة"});if(!scriptFor(script))return res.status(400).json({success:false,error:"script غير مسموح"});if(!db.users.some(u=>u.username===owner))return res.status(404).json({success:false,error:"المالك غير موجود"});const id=crypto.randomBytes(10).toString("hex");db.bots.push({id,name,token,script,owner,status:"offline",lastError:null});write(db);res.json({success:true,id})});
app.post("/api/admin/bots/:id/delete",auth,admin,(req,res)=>{const db=read(),i=db.bots.findIndex(b=>b.id===req.params.id);if(i<0)return res.status(404).json({success:false,error:"غير موجود"});stopBot(req.params.id);db.bots.splice(i,1);write(db);res.json({success:true})});

app.listen(PORT,()=>console.log(`Panel: http://localhost:${PORT}`));
