'use strict';
const $=id=>document.getElementById(id), C=window.AllowanceCore, cfg=window.ALLOWANCE_CONFIG||{};
const demo=new URLSearchParams(location.search).get('demo')==='1';
let db=null,snapshot=null,person='Ritsuya',editing=null,busy=false,loading=false,requestId=crypto.randomUUID();
const money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);$('message').hidden=false;clearTimeout(message.timer);message.timer=setTimeout(()=>$('message').hidden=true,error?12000:5000);}
function fail(e){message(String(e.message||e).includes('CONFLICT')?'ほかの端末で変更されています。更新してから編集し直してください。':`保存・通信を確認してください：${e.message||e}`,true);}
function setBusy(value){busy=value;document.querySelectorAll('#entryForm button,#entryForm input,#entryForm select,.record button').forEach(el=>el.disabled=value);$('logout').disabled=value;}
function choose(value){person=value;document.querySelectorAll('[data-person]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.person===person)));$('save').textContent=editing?'変更を保存':`${person} の${$('kind').value==='expense'?'支出':'返金・追加'}を記録`;}
function reset(){editing=null;requestId=crypto.randomUUID();$('entryForm').reset();$('date').value=snapshot.today;$('formTitle').textContent='使ったお金を記録';$('cancel').hidden=true;choose(person);}
function render(){
 $('cards').innerHTML=C.people.map(p=>{const s=C.summary(snapshot,p);return `<article class="wallet ${p==='honami'?'honami':''}"><div class="wallet-top"><span class="wallet-name">${p}</span><span class="avatar">${p[0].toUpperCase()}</span></div><p class="balance-label">現在の残高</p><div class="balance ${s.balance<0?'negative':''}"><span class="currency">$</span>${esc((s.balance<0?'−':'')+(Math.abs(s.balance)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}))}</div><div class="meter"><span style="width:${Math.max(0,Math.min(100,s.balance/15000*100))}%"></span></div><div class="stats"><span>今月の支出 ${money(s.spent)}</span><span>毎月 +$150.00</span></div></article>`}).join('');
 $('date').min=snapshot.start_month;$('date').max=snapshot.today;$('historyMonth').min=snapshot.start_month.slice(0,7);$('historyMonth').max=snapshot.today.slice(0,7);renderHistory();
}
function renderHistory(){
 const month=$('historyMonth').value;
 let entries=snapshot.entries.filter(e=>e.entry_date.slice(0,7)===month);
 if(month>=snapshot.start_month.slice(0,7)&&month<=snapshot.today.slice(0,7))entries=[...entries,...C.people.map(p=>({id:'charge-'+p,person:p,entry_date:month+'-01',kind:'charge',cents:15000,memo:'毎月のお小遣い'}))];
 entries.sort((a,b)=>b.entry_date.localeCompare(a.entry_date));
 $('history').innerHTML=entries.length?entries.map(e=>`<div class="record"><span class="record-icon ${e.kind==='charge'?'charge':e.person==='honami'?'honami':''}">${e.kind==='charge'?'+':e.person[0].toUpperCase()}</span><div class="record-body"><div class="record-title">${esc(e.memo|| (e.kind==='expense'?'支出':'返金・追加チャージ'))}</div><div class="record-meta">${esc(e.person)} · ${esc(e.entry_date.replaceAll('-','/'))}</div></div><span class="record-amount ${e.kind==='expense'?'':'credit'}">${e.kind==='expense'?'−':'+'}${money(e.cents)}</span>${e.kind==='charge'?'':`<div class="record-actions"><button data-edit="${e.id}" aria-label="${esc(e.person)}の${esc(e.memo||'記録')}を編集">編集</button><button data-delete="${e.id}">削除</button></div>`}</div>`).join(''):'<p class="empty">この月の記録はまだありません。</p>';
}
async function load(){
 if(loading||busy)return;loading=true;$('refresh').disabled=true;$('save').disabled=true;
 try{if(!demo){const {data,error}=await db.rpc('allowance_snapshot');if(error)throw error;snapshot=data;}
 if(!snapshot)throw Error('データが取得できませんでした。');
 $('loginPanel').hidden=true;$('appPanel').hidden=false;
 if(!$('historyMonth').value)$('historyMonth').value=snapshot.today.slice(0,7);
 if(!$('date').value)$('date').value=snapshot.today;
 render();$('syncStatus').textContent=demo?'お試し中 · データは保存されません':`最終同期 ${new Date().toLocaleTimeString('ja-JP')} · 米国東部時間基準`;
 }catch(e){fail(e);$('syncStatus').textContent='同期失敗 · 更新してください';}finally{loading=false;$('refresh').disabled=false;$('save').disabled=false;}
}
document.querySelectorAll('[data-person]').forEach(el=>el.onclick=()=>choose(el.dataset.person));
$('kind').onchange=()=>choose(person);$('cancel').onclick=reset;$('historyMonth').onchange=renderHistory;$('refresh').onclick=load;
$('entryForm').onsubmit=async e=>{
 e.preventDefault();if(busy||loading)return;
 let row;try{row={id:editing?editing.id:requestId,version:editing?editing.version:0,person,entry_date:$('date').value,kind:$('kind').value,cents:C.parseCents($('amount').value),memo:$('memo').value.trim()};if(row.entry_date<snapshot.start_month||row.entry_date>snapshot.today)throw Error('日付は開始月から今日までを選んでください。');}catch(err){return message(err.message,true);}
 setBusy(true);
 try{if(demo){const index=snapshot.entries.findIndex(x=>x.id===row.id);const saved={...row,version:row.version+1};if(index>=0)snapshot.entries[index]=saved;else snapshot.entries.unshift(saved);}else{const {error}=await db.rpc('allowance_save',{p_id:row.id,p_version:row.version,p_person:row.person,p_date:row.entry_date,p_kind:row.kind,p_cents:row.cents,p_memo:row.memo});if(error)throw error;}
 reset();message(demo?'お試しの記録を追加しました。':'保存しました。');
 }catch(err){fail(err);}finally{setBusy(false);await load();}
};
$('history').onclick=async e=>{
 const button=e.target.closest('button');if(!button||busy)return;
 const id=button.dataset.edit||button.dataset.delete, row=snapshot.entries.find(x=>x.id===id);if(!row)return;
 if(button.dataset.edit){editing={...row};person=row.person;$('amount').value=(row.cents/100).toFixed(2);$('date').value=row.entry_date;$('kind').value=row.kind;$('memo').value=row.memo;$('formTitle').textContent='記録を編集';$('cancel').hidden=false;choose(person);$('entryForm').scrollIntoView({behavior:'smooth',block:'center'});return;}
 if(!confirm(`${row.person} の ${money(row.cents)} の記録を削除しますか？`))return;
 setBusy(true);try{if(demo)snapshot.entries=snapshot.entries.filter(x=>x.id!==id);else{const {error}=await db.rpc('allowance_delete',{p_id:id,p_version:row.version});if(error)throw error;}if(editing?.id===id)reset();message('削除しました。');}catch(err){fail(err);}finally{setBusy(false);await load();}
};
$('export').onclick=()=>{
 if(!snapshot)return;const rows=[['日付','名前','種類','金額 USD','メモ']];
 for(let m=C.monthIndex(snapshot.start_month);m<=C.monthIndex(snapshot.today);m++){const month=`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}-01`;C.people.forEach(p=>rows.push([month,p,'毎月のお小遣い','150.00','自動加算']));}
 snapshot.entries.forEach(e=>rows.push([e.entry_date,e.person,e.kind==='expense'?'支出':'返金・追加',(e.cents/100*(e.kind==='expense'?-1:1)).toFixed(2),e.memo]));
 rows.splice(1,rows.length-1,...rows.slice(1).sort((a,b)=>a[0].localeCompare(b[0])));
 const quote=v=>'"'+String(v).replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
 const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download='our-allowance.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('logout').onclick=async()=>{if(demo){location.href=location.pathname;return;}const {error}=await db.auth.signOut();if(error)return fail(error);snapshot=null;resetLogin();};
function resetLogin(){$('loginPanel').hidden=false;$('appPanel').hidden=true;$('password').value='';$('historyMonth').value='';$('date').value='';editing=null;}
$('loginForm').onsubmit=async e=>{e.preventDefault();if(!db)return message('先に config.js の接続情報を設定してください。',true);$('loginButton').disabled=true;try{const {error}=await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;$('password').value='';await load();}catch(err){fail(err);}finally{$('loginButton').disabled=false;}};
async function init(){
 if(demo){const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());snapshot={today:date,start_month:'2026-09-01',entries:[{id:crypto.randomUUID(),version:1,person:'Ritsuya',entry_date:date,kind:'expense',cents:2450,memo:'週末のランチ'},{id:crypto.randomUUID(),version:1,person:'honami',entry_date:date,kind:'expense',cents:3800,memo:'お気に入りの服'}]};await load();return;}
 if(!cfg.SUPABASE_URL||cfg.SUPABASE_URL.includes('PASTE_')||!cfg.SUPABASE_ANON_KEY||cfg.SUPABASE_ANON_KEY.includes('PASTE_')){message('初回設定が必要です。README.txt に沿って config.js を設定してください。',true);return;}
 if(!window.supabase){message('ログイン機能を読み込めませんでした。ネット接続を確認して再読み込みしてください。',true);return;}
 db=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{storageKey:'our-allowance-auth-v1',persistSession:true,autoRefreshToken:true}});$('email').value=cfg.LOGIN_EMAIL||'';
 db.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){snapshot=null;resetLogin();}});
 const {data,error}=await db.auth.getSession();if(error)fail(error);if(data?.session)await load();
}
window.addEventListener('focus',()=>{if(snapshot)load();});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&snapshot)load();});setInterval(()=>{if(snapshot&&!document.hidden)load();},20000);
init().catch(fail);
if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
