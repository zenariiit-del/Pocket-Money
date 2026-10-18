(function(root){
'use strict';
const people=['Ritsuya','honami'];
const monthIndex=d=>Number(d.slice(0,4))*12+Number(d.slice(5,7))-1;
function summary(snapshot,person){
 const months=Math.max(0,monthIndex(snapshot.today)-monthIndex(snapshot.start_month)+1);
 const valid=snapshot.entries.filter(e=>e.person===person&&e.entry_date<=snapshot.today);
 const signed=e=>e.kind==='expense'?-e.cents:e.cents;
 const thisMonth=valid.filter(e=>e.entry_date.slice(0,7)===snapshot.today.slice(0,7));
 return {balance:months*15000+valid.reduce((s,e)=>s+signed(e),0),spent:thisMonth.filter(e=>e.kind==='expense').reduce((s,e)=>s+e.cents,0),refund:thisMonth.filter(e=>e.kind==='refund').reduce((s,e)=>s+e.cents,0),months};
}
function parseCents(value){if(!/^\d+(\.\d{1,2})?$/.test(value))throw Error('金額は小数点以下2桁までで入力してください。');const parts=value.split('.');const cents=Number(parts[0])*100+Number((parts[1]||'').padEnd(2,'0'));if(!Number.isSafeInteger(cents)||cents<=0||cents>100000000)throw Error('金額は $0.01〜$1,000,000 で入力してください。');return cents;}
const api={people,monthIndex,summary,parseCents};if(typeof module!=='undefined')module.exports=api;root.AllowanceCore=api;
})(typeof window==='undefined'?globalThis:window);
