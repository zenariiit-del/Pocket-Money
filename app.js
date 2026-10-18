'use strict';
const $=id=>document.getElementById(id), C=window.AllowanceCore, cfg=window.ALLOWANCE_CONFIG||{};
const demo=new URLSearchParams(location.search).get('demo')==='1';
let db=null,snapshot=null,person='Ritsuya',editing=null,busy=false,loading=false,requestId=crypto.randomUUID();
let householdEditing=null, householdRequestId=crypto.randomUUID(), budgetEditVersion=0;
const kindLabels={expense:'支出',expense_refund:'支出の返金',refund:'追加チャージ',income:'収入',charge:'毎月のお小遣い'};
const money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);$('message').hidden=false;clearTimeout(message.timer);message.timer=setTimeout(()=>$('message').hidden=true,error?12000:5000);}
function fail(e){message(String(e.message||e).includes('CONFLICT')?'ほかの端末で変更されています。更新してから編集し直してください。':(e.code==='PGRST202'&&String(e.message||e).includes('household_'))?'家計簿の初回設定が必要です。Supabaseで household_upgrade.sql を実行してください。':`保存・通信を確認してください：${e.message||e}`,true);}
function setBusy(value){busy=value;document.querySelectorAll('#entryForm button,#entryForm input,#entryForm select,#householdForm button,#householdForm input,#householdForm select,#budgetForm button,#budgetForm input,#categoryForm button,#categoryForm input,#categoryForm select,.record button').forEach(el=>el.disabled=value);$('logout').disabled=value;}
function choose(value){person=value;document.querySelectorAll('[data-person]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.person===person)));$('save').textContent=editing?'変更を保存':`${person} の${kindLabels[$('kind').value]}を記録`;}
function reset(){editing=null;requestId=crypto.randomUUID();$('entryForm').reset();$('date').value=snapshot.today;$('formTitle').textContent='使ったお金を記録';$('cancel').hidden=true;choose(person);}
function render(){
 $('cards').innerHTML=C.people.map(p=>{const s=C.summary(snapshot,p);return `<article class="wallet ${p==='honami'?'honami':''}"><div class="wallet-top"><span class="wallet-name">${p}</span><span class="avatar">${p[0].toUpperCase()}</span></div><p class="balance-label">現在の残高</p><div class="balance ${s.balance<0?'negative':''}"><span class="currency">$</span>${esc((s.balance<0?'−':'')+(Math.abs(s.balance)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}))}</div><div class="meter"><span style="width:${Math.max(0,Math.min(100,s.balance/15000*100))}%"></span></div><div class="stats"><span>今月の支出 ${money(s.spent)}</span><span>毎月 +$150.00</span></div></article>`}).join('');
 $('date').min=snapshot.start_month;$('date').max=snapshot.today;$('historyMonth').min=snapshot.start_month.slice(0,7);$('historyMonth').max=snapshot.today.slice(0,7);renderHistory();renderFamily();
}
function renderHistory(){
 const month=$('historyMonth').value;
 let entries=snapshot.entries.filter(e=>e.entry_date.slice(0,7)===month);
 if(month>=snapshot.start_month.slice(0,7)&&month<=snapshot.today.slice(0,7))entries=[...entries,...C.people.map(p=>({id:'charge-'+p,person:p,entry_date:month+'-01',kind:'charge',cents:15000,memo:'毎月のお小遣い'}))];
 entries.sort((a,b)=>b.entry_date.localeCompare(a.entry_date));
 $('history').innerHTML=entries.length?entries.map(e=>`<div class="record"><span class="record-icon ${e.kind==='charge'?'charge':e.person==='honami'?'honami':''}">${e.kind==='charge'?'+':e.person[0].toUpperCase()}</span><div class="record-body"><div class="record-title">${esc(e.memo|| kindLabels[e.kind])}</div><div class="record-meta">${esc(e.person)} · ${esc(e.entry_date.replaceAll('-','/'))}</div></div><span class="record-amount ${e.kind==='expense'?'':'credit'}">${e.kind==='expense'?'−':'+'}${money(e.cents)}</span>${e.kind==='charge'?'':`<div class="record-actions"><button data-edit="${e.id}" aria-label="${esc(e.person)}の${esc(e.memo||'記録')}を編集">編集</button><button data-delete="${e.id}">削除</button></div>`}</div>`).join(''):'<p class="empty">この月の記録はまだありません。</p>';
}
async function load(){
 if(loading||busy)return;loading=true;$('refresh').disabled=true;$('save').disabled=true;$('householdSave').disabled=true;$('householdRefresh').disabled=true;
 try{if(!demo){const {data,error}=await db.rpc('household_snapshot');if(error)throw error;snapshot=data;}
 if(!snapshot)throw Error('データが取得できませんでした。');
 $('loginPanel').hidden=true;$('appPanel').hidden=false;
 if(!$('historyMonth').value)$('historyMonth').value=snapshot.today.slice(0,7);
 if(!$('date').value)$('date').value=snapshot.today;
 if(!$('householdDate').value)$('householdDate').value=snapshot.today;
 if(!$('familyMonth').value)$('familyMonth').value=snapshot.today.slice(0,7);
 render();$('syncStatus').textContent=demo?'お試し中 · データは保存されません':`最終同期 ${new Date().toLocaleTimeString('ja-JP')} · 米国東部時間基準`;
 }catch(e){fail(e);$('syncStatus').textContent='同期失敗 · 更新してください';}finally{loading=false;$('refresh').disabled=false;$('save').disabled=false;$('householdSave').disabled=false;$('householdRefresh').disabled=false;}
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
 snapshot.entries.forEach(e=>rows.push([e.entry_date,e.person,kindLabels[e.kind],(e.cents/100*(e.kind==='expense'?-1:1)).toFixed(2),e.memo]));
 rows.splice(1,rows.length-1,...rows.slice(1).sort((a,b)=>a[0].localeCompare(b[0])));
 const quote=v=>'"'+String(v).replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
 const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download='our-allowance.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('logout').onclick=async()=>{if(demo){location.href=location.pathname;return;}const {error}=await db.auth.signOut();if(error)return fail(error);snapshot=null;resetLogin();};
function resetLogin(){$('loginPanel').hidden=false;$('appPanel').hidden=true;$('password').value='';$('historyMonth').value='';$('date').value='';editing=null;householdEditing=null;$('householdForm').reset();$('familyMonth').value='';$('householdCancel').hidden=true;$('householdFormTitle').textContent='家計を記録';$('budgetDetails').open=false;$('categoryDialog').close();}
$('loginForm').onsubmit=async e=>{e.preventDefault();if(!db)return message('先に config.js の接続情報を設定してください。',true);$('loginButton').disabled=true;try{const {error}=await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;$('password').value='';await load();}catch(err){fail(err);}finally{$('loginButton').disabled=false;}};
async function init(){
 if(demo){const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());snapshot={today:date,start_month:'2026-09-01',entries:[{id:crypto.randomUUID(),version:1,person:'Ritsuya',entry_date:date,kind:'expense',cents:2450,memo:'週末のランチ'},{id:crypto.randomUUID(),version:1,person:'honami',entry_date:date,kind:'expense',cents:3800,memo:'お気に入りの服'}]};snapshot.categories=demoCategories();snapshot.household=demoHousehold(snapshot.categories,date);snapshot.budgets=[];await load();return;}
 if(!cfg.SUPABASE_URL||cfg.SUPABASE_URL.includes('PASTE_')||!cfg.SUPABASE_ANON_KEY||cfg.SUPABASE_ANON_KEY.includes('PASTE_')){message('初回設定が必要です。README.txt に沿って config.js を設定してください。',true);return;}
 if(!window.supabase){message('ログイン機能を読み込めませんでした。ネット接続を確認して再読み込みしてください。',true);return;}
 db=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{storageKey:'our-allowance-auth-v1',persistSession:true,autoRefreshToken:true}});$('email').value=cfg.LOGIN_EMAIL||'';
 db.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){snapshot=null;resetLogin();}});
 const {data,error}=await db.auth.getSession();if(error)fail(error);if(data?.session)await load();
}
window.addEventListener('focus',()=>{if(snapshot)load();});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&snapshot)load();});setInterval(()=>{if(snapshot&&!document.hidden)load();},20000);

if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./service-worker.js').catch(()=>{});

function switchTab(tab){
 const household=tab==='household';$('householdScreen').hidden=!household;$('allowanceScreen').hidden=household;
 $('tabHousehold').setAttribute('aria-pressed',String(household));$('tabAllowance').setAttribute('aria-pressed',String(!household));
}
function fillCategories(preferred){
 const selected=preferred||$('householdCategory').value;
 const cats=snapshot.categories.filter(c=>c.kind===$('householdKind').value);
 $('householdCategory').innerHTML=cats.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
 if(cats.some(c=>c.id===selected))$('householdCategory').value=selected;
 $('householdSave').textContent=householdEditing?'変更を保存':`${kindLabels[$('householdKind').value]}を記録`;
}
function renderFamily(){
 fillCategories();
 $('householdDate').min='2000-01-01';$('householdDate').max=snapshot.today;
 $('familyMonth').min='2000-01';$('familyMonth').max=snapshot.today.slice(0,7);
 $('nextMonth').disabled=$('familyMonth').value>=snapshot.today.slice(0,7);
 $('previousMonth').disabled=$('familyMonth').value<='2000-01';
 const month=$('familyMonth').value, stats=C.monthly(snapshot,month);
 $('familyTotals').innerHTML=[['収入',stats.income,'income','この月に入ったお金'],['支出',stats.spent,'spending','お小遣いの支出も含む'],['収支',stats.net,'net','収入 − 支出']].map(([label,value,cls,note])=>`<article class="total-card ${cls}"><div class="total-label">${label}</div><div class="total-value ${value<0?'negative':''}">${money(value)}</div><div class="total-note">${note}</div></article>`).join('');
 $('budgetSummary').innerHTML=stats.budget===null?'<p class="fine">月の予算を設定すると、あといくら使えるかを確認できます。</p>':`<div class="budget-line"><span>${stats.remaining>=0?'予算の残り':'予算オーバー'}</span><span class="${stats.remaining<0?'negative':''}">${money(Math.abs(stats.remaining))}</span></div><div class="budget-track"><span class="${stats.remaining<0?'over':''}" style="width:${Math.min(100,Math.max(0,stats.budget?stats.spent/stats.budget*100:stats.spent>0?100:0))}%"></span></div><p class="fine">月の予算 ${money(stats.budget)} ／ 支出 ${money(stats.spent)}</p>`;
 $('breakdownMonth').textContent=month.replace('-','年')+'月';
 const max=Math.max(1,...stats.groups.map(g=>Math.abs(g.cents)));
 $('categoryBreakdown').innerHTML=stats.groups.length?stats.groups.map(g=>`<div class="category-row"><div class="category-label"><span>${esc(g.name)}</span><span>${money(g.cents)}</span></div><div class="category-bar"><span style="width:${Math.max(0,g.cents)/max*100}%"></span></div></div>`).join(''):'<p class="household-empty">支出を記録すると、項目別の内訳が表示されます。</p>';
 $('personTotals').innerHTML=stats.byPerson.map(p=>`<div class="person-total">${esc(p.person)}<span>${money(p.cents)}</span></div>`).join('');
 const selected=$('categoryFilter').value;
 $('categoryFilter').innerHTML='<option value="">すべて</option><option value="allowance">お小遣い</option>'+snapshot.categories.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}（${kindLabels[c.kind]}）</option>`).join('');
 if([...$('categoryFilter').options].some(o=>o.value===selected))$('categoryFilter').value=selected;
 renderFamilyHistory();
}
function filteredFamilyRows(){
 const search=$('historySearch').value.trim().toLocaleLowerCase();
 return C.monthly(snapshot,$('familyMonth').value).rows.filter(e=>(!$('personFilter').value||e.person===$('personFilter').value)&&(!$('categoryFilter').value||e.category_key===$('categoryFilter').value)&&(!search||[e.memo,e.category,e.person,e.payment].join(' ').toLocaleLowerCase().includes(search)));
}
function renderFamilyHistory(){
 if(!snapshot)return;const rows=filteredFamilyRows();
 const spent=rows.filter(e=>e.kind!=='income').reduce((s,e)=>s+(e.kind==='refund'?-e.cents:e.cents),0);
 $('filterSummary').textContent=`${rows.length}件 · 表示中の支出 ${money(spent)}（上の集計は月全体）`;
 $('familyHistory').innerHTML=rows.length?rows.map(e=>`<div class="record"><span class="record-icon ${e.kind==='income'?'income':e.person==='Hayu'?'Hayu':e.person==='honami'?'honami':e.person==='家族共通'?'shared':''}">${e.kind==='income'?'+':e.person==='家族共通'?'家':e.person[0].toUpperCase()}</span><div class="record-body"><div class="record-title">${esc(e.memo||e.category)}${e.source==='allowance'?'<span class="source-badge">お小遣い連携</span>':''}</div><div class="record-meta">${esc(e.entry_date.replaceAll('-','/'))} · ${esc(e.person)} · ${esc(e.category)}${e.kind==='refund'?' · 返金':''}${e.payment&&e.payment!=='未指定'&&e.source!=='allowance'?' · '+esc(e.payment):''}</div></div><span class="record-amount ${e.kind==='expense'?'':'credit'}">${e.kind==='expense'?'−':'+'}${money(e.cents)}</span><div class="record-actions"><button data-source="${e.source}" data-edit="${e.id}" aria-label="${esc(e.memo||e.category)}を編集">編集</button><button data-source="${e.source}" data-delete="${e.id}">削除</button></div></div>`).join(''):'<p class="empty">この条件に合う記録はありません。</p>';
}
function resetHousehold(){
 const rememberedPerson=$('householdPerson').value,rememberedCategory=$('householdCategory').value;
 householdEditing=null;householdRequestId=crypto.randomUUID();$('householdForm').reset();$('householdPerson').value=rememberedPerson||'家族共通';$('householdDate').value=snapshot.today;$('householdFormTitle').textContent='家計を記録';$('householdCancel').hidden=true;fillCategories(rememberedCategory);
}
function editAllowance(row){
 switchTab('allowance');editing={...row};person=row.person;$('amount').value=(row.cents/100).toFixed(2);$('date').value=row.entry_date;$('kind').value=row.kind;$('memo').value=row.memo;$('formTitle').textContent='記録を編集';$('cancel').hidden=false;choose(person);$('entryForm').scrollIntoView({behavior:'smooth',block:'center'});
}
function setMonth(month){$('familyMonth').value=month;renderFamily();if($('budgetDetails').open)prepareBudget();}
function shiftMonth(delta){const i=C.monthIndex($('familyMonth').value)+delta;setMonth(`${Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`);}
function prepareBudget(){const b=snapshot.budgets.find(b=>b.month.slice(0,7)===$('familyMonth').value);budgetEditVersion=b?.version||0;$('budgetAmount').value=b?(b.cents/100).toFixed(2):'';}
function downloadCsv(filename,rows){
 const quote=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
 const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('tabHousehold').onclick=()=>switchTab('household');$('tabAllowance').onclick=()=>switchTab('allowance');
$('householdRefresh').onclick=load;$('householdKind').onchange=()=>fillCategories();$('householdCancel').onclick=resetHousehold;
$('familyMonth').onchange=()=>{if($('familyMonth').value)setMonth($('familyMonth').value);};
$('previousMonth').onclick=()=>shiftMonth(-1);$('nextMonth').onclick=()=>shiftMonth(1);$('currentMonth').onclick=()=>setMonth(snapshot.today.slice(0,7));
$('personFilter').onchange=renderFamilyHistory;$('categoryFilter').onchange=renderFamilyHistory;$('historySearch').oninput=renderFamilyHistory;
$('householdForm').onsubmit=async e=>{
 e.preventDefault();if(busy||loading)return;
 let row;try{row={id:householdEditing?.id||householdRequestId,version:householdEditing?.version||0,person:$('householdPerson').value,entry_date:$('householdDate').value,kind:$('householdKind').value,category_id:$('householdCategory').value,cents:C.parseCents($('householdAmount').value),memo:$('householdMemo').value.trim(),payment:$('householdPayment').value};if(!row.category_id)throw Error('項目を選んでください。');if(row.entry_date<'2000-01-01'||row.entry_date>snapshot.today)throw Error('日付は2000年1月1日から今日までを選んでください。');}catch(err){return message(err.message,true);}
 setBusy(true);try{
  if(demo){const i=snapshot.household.findIndex(e=>e.id===row.id);if(i>=0)snapshot.household[i]={...row,version:row.version+1};else snapshot.household.unshift({...row,version:1});}
  else{const {error}=await db.rpc('household_save',{p_id:row.id,p_version:row.version,p_person:row.person,p_date:row.entry_date,p_kind:row.kind,p_category:row.category_id,p_cents:row.cents,p_memo:row.memo,p_payment:row.payment});if(error)throw error;}
  $('familyMonth').value=row.entry_date.slice(0,7);resetHousehold();message(demo?'お試しの記録を追加しました。':'保存しました。');
 }catch(err){fail(err);}finally{setBusy(false);await load();}
};
$('familyHistory').onclick=async e=>{
 const b=e.target.closest('button');if(!b||busy||loading)return;
 const source=b.dataset.source,id=b.dataset.edit||b.dataset.delete;
 const row=(source==='allowance'?snapshot.entries:snapshot.household).find(r=>r.id===id);if(!row)return;
 if(b.dataset.edit){
  if(source==='allowance'){editAllowance(row);return;}
  householdEditing={...row};$('householdKind').value=row.kind;fillCategories(row.category_id);$('householdPerson').value=row.person;$('householdAmount').value=(row.cents/100).toFixed(2);$('householdDate').value=row.entry_date;$('householdMemo').value=row.memo;$('householdPayment').value=row.payment;$('householdFormTitle').textContent='家計の記録を編集';$('householdCancel').hidden=false;$('householdForm').scrollIntoView({behavior:'smooth',block:'center'});return;
 }
 if(!confirm(`${row.person} の ${money(row.cents)} を削除しますか？${source==='allowance'?' お小遣いの残高にも反映されます。':''}`))return;
 setBusy(true);try{
  if(demo){const key=source==='allowance'?'entries':'household';snapshot[key]=snapshot[key].filter(r=>r.id!==id);}
  else{const {error}=await db.rpc(source==='allowance'?'allowance_delete':'household_delete',{p_id:id,p_version:row.version});if(error)throw error;}
  if(source==='allowance'&&editing?.id===id)reset();if(source==='household'&&householdEditing?.id===id)resetHousehold();message('削除しました。');
 }catch(err){fail(err);}finally{setBusy(false);await load();}
};
$('addCategory').onclick=()=>{$('categoryKind').value=$('householdKind').value;$('categoryName').value='';$('categoryDialog').showModal();};
$('closeCategory').onclick=()=>$('categoryDialog').close();
$('categoryForm').onsubmit=async e=>{
 e.preventDefault();if(busy||loading)return;const name=$('categoryName').value.trim(),kind=$('categoryKind').value;if(!name)return message('項目名を入力してください。',true);
 setBusy(true);let newId;
 try{if(demo){const existing=snapshot.categories.find(c=>c.kind===kind&&c.name===name);newId=existing?.id||crypto.randomUUID();if(!existing)snapshot.categories.push({id:newId,kind,name});}
 else{const {data,error}=await db.rpc('household_add_category',{p_name:name,p_kind:kind});if(error)throw error;newId=data;}
 $('categoryDialog').close();$('householdKind').value=kind;message('項目を追加しました。');
 }catch(err){fail(err);}finally{setBusy(false);await load();if(newId)fillCategories(newId);}
};
$('budgetDetails').ontoggle=()=>{if($('budgetDetails').open&&snapshot)prepareBudget();};
$('budgetForm').onsubmit=async e=>{
 e.preventDefault();if(busy||loading)return;const month=$('familyMonth').value+'-01';let cents;
 try{cents=/^0(?:\.0{1,2})?$/.test($('budgetAmount').value)?0:C.parseCents($('budgetAmount').value);}catch(err){return message(err.message,true);}
 setBusy(true);try{if(demo){const i=snapshot.budgets.findIndex(b=>b.month===month),row={month,cents,version:budgetEditVersion+1};if(i>=0)snapshot.budgets[i]=row;else snapshot.budgets.push(row);}
 else{const {error}=await db.rpc('household_save_budget',{p_month:month,p_cents:cents,p_version:budgetEditVersion});if(error)throw error;}
 $('budgetDetails').open=false;message('予算を保存しました。');
 }catch(err){fail(err);}finally{setBusy(false);await load();}
};
$('familyExport').onclick=()=>{
 const month=$('familyMonth').value;
 downloadCsv(`family-budget-${month}.csv`,[['日付','誰の分','種類','項目','金額 USD','支払・受取方法','メモ','記録元'],...C.monthly(snapshot,month).rows.map(e=>[e.entry_date,e.person,e.kind==='refund'?'支出の返金':kindLabels[e.kind],e.category,(e.cents/100).toFixed(2),e.payment,e.memo,e.source==='allowance'?'お小遣い':'家計簿'])]);
};
function demoCategories(){return [['expense','食費'],['expense','外食'],['expense','日用品'],['expense','住居'],['expense','教育・保育'],['expense','旅行・レジャー'],['income','給与'],['income','その他']].map(([kind,name])=>({id:crypto.randomUUID(),kind,name}));}
function demoHousehold(cats,date){return [['家族共通','income','給与',420000,'10月の給与'],['家族共通','expense','食費',8643,'週末の食料品'],['Hayu','expense','教育・保育',4500,'習い事'],['honami','expense','日用品',1980,'生活用品']].map(([person,kind,category,cents,memo])=>({id:crypto.randomUUID(),version:1,person,kind,category_id:cats.find(c=>c.name===category).id,cents,memo,entry_date:date,payment:kind==='income'?'銀行振込':'クレジットカード'}));}
init().catch(fail);
