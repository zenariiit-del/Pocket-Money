(function(root){
'use strict';
const people=['Ritsuya','honami'];
const monthIndex=d=>Number(d.slice(0,4))*12+Number(d.slice(5,7))-1;
function summary(snapshot,person){
 const months=Math.max(0,monthIndex(snapshot.today)-monthIndex(snapshot.start_month)+1);
 const valid=snapshot.entries.filter(e=>e.person===person&&e.entry_date<=snapshot.today);
 const signed=e=>e.kind==='expense'?-e.cents:e.cents;
 const thisMonth=valid.filter(e=>e.entry_date.slice(0,7)===snapshot.today.slice(0,7));
 return {balance:months*15000+valid.reduce((s,e)=>s+signed(e),0),spent:thisMonth.filter(e=>e.kind==='expense'||e.kind==='expense_refund').reduce((s,e)=>s+(e.kind==='expense' ? e.cents : -e.cents),0),refund:thisMonth.filter(e=>e.kind==='refund').reduce((s,e)=>s+e.cents,0),months};
}
function parseCents(value){if(!/^\d+(\.\d{1,2})?$/.test(value))throw Error('Use up to two decimal places.');const parts=value.split('.');const cents=Number(parts[0])*100+Number((parts[1]||'').padEnd(2,'0'));if(!Number.isSafeInteger(cents)||cents<=0||cents>100000000)throw Error('Enter an amount from $0.01 to $1,000,000.');return cents;}
const family=['Ritsuya','honami','Hayu','家族共通'];
const legacyCategoryLabels={'食費':'Food','外食':'Dining out','日用品':'Daily essentials','住居':'Home','水道・光熱':'Utilities','通信':'Phone & internet','交通・車':'Transport & car','教育・保育':'Education & childcare','医療・健康':'Health','衣服・美容':'Clothing & beauty','旅行・レジャー':'Travel & leisure','サブスク':'Subscriptions','その他':'Other','給与':'Salary','賞与':'Bonus','手当':'Benefits'};
const categoryLabel=name=>legacyCategoryLabels[name]||name;
const defaultCategories=['Home','Essentials','Entertainment','Social','Dining out','Car','Electricity','Gas','Water'];

function ledger(snapshot){
 const categories=new Map((snapshot.categories||[]).map(c=>[c.id,categoryLabel(c.name)]));
 return [
  ...(snapshot.household||[]).map(e=>({...e,source:'household',category:categories.get(e.category_id)||'Uncategorized',category_key:e.category_id})),
  ...snapshot.entries.filter(e=>e.kind==='expense'||e.kind==='expense_refund').map(e=>({...e,source:'allowance',kind:e.kind==='expense'?'expense':'refund',category:'Allowance',category_key:'allowance',payment:'Allowance'}))
 ].filter(e=>e.entry_date<=snapshot.today).sort((a,b)=>b.entry_date.localeCompare(a.entry_date)||(b.created_at||'').localeCompare(a.created_at||''));
}
function monthly(snapshot,month){
 const rows=ledger(snapshot).filter(e=>e.entry_date.slice(0,7)===month);
 const income=rows.filter(e=>e.kind==='income').reduce((s,e)=>s+e.cents,0);
 const expenses=rows.filter(e=>e.kind!=='income');
 const sign=e=>e.kind==='refund'?-e.cents:e.cents;
 const spent=expenses.reduce((s,e)=>s+sign(e),0);
 const groups=new Map();
 expenses.forEach(e=>{const g=groups.get(e.category_key)||{key:e.category_key,name:e.category,cents:0};g.cents+=sign(e);groups.set(e.category_key,g);});
 const budget=(snapshot.budgets||[]).find(b=>b.month.slice(0,7)===month);
 return {rows,income,spent,net:income-spent,budget:budget?budget.cents:null,remaining:budget?budget.cents-spent:null,groups:[...groups.values()].sort((a,b)=>b.cents-a.cents),byPerson:family.map(person=>({person,cents:expenses.filter(e=>e.person===person).reduce((s,e)=>s+sign(e),0)}))};
}
const api={people,family,categoryLabel,defaultCategories,monthIndex,summary,parseCents,ledger,monthly};if(typeof module!=='undefined')module.exports=api;root.AllowanceCore=api;
})(typeof window==='undefined'?globalThis:window);
