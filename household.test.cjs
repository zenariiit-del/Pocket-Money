const assert=require('node:assert/strict');
const C=require('../core.js');
const snapshot={today:'2026-10-18',start_month:'2026-09-01',categories:[{id:'food',name:'食費',kind:'expense'},{id:'pay',name:'給与',kind:'income'},{id:'school',name:'教育・保育',kind:'expense'}],budgets:[{month:'2026-10-01',cents:15000}],entries:[
 {id:'a1',person:'Ritsuya',entry_date:'2026-10-01',kind:'expense',cents:3000,memo:'趣味'},
 {id:'a2',person:'honami',entry_date:'2026-10-02',kind:'expense',cents:2000},
 {id:'a3',person:'Ritsuya',entry_date:'2026-10-03',kind:'refund',cents:5000},
 {id:'a4',person:'Ritsuya',entry_date:'2026-10-04',kind:'expense_refund',cents:1000},
 {id:'a5',person:'honami',entry_date:'2026-09-04',kind:'expense',cents:500},
 ],household:[
 {id:'h1',person:'家族共通',entry_date:'2026-10-03',kind:'expense',category_id:'food',cents:8000},
 {id:'h2',person:'家族共通',entry_date:'2026-10-01',kind:'income',category_id:'pay',cents:400000},
 {id:'h3',person:'Hayu',entry_date:'2026-10-02',kind:'expense',category_id:'school',cents:4500},
 {id:'h4',person:'家族共通',entry_date:'2026-11-01',kind:'expense',category_id:'food',cents:8000},
]};
let m=C.monthly(snapshot,'2026-10');
assert.equal(m.income,400000);assert.equal(m.spent,16500);assert.equal(m.net,383500);assert.equal(m.remaining,-1500);
assert.equal(m.rows.length,6);assert.equal(m.groups.find(g=>g.key==='allowance').cents,4000);
assert.equal(m.byPerson.find(p=>p.person==='Hayu').cents,4500);
assert.equal(C.summary(snapshot,'Ritsuya').balance,33000);assert.equal(C.summary(snapshot,'Ritsuya').spent,2000);
assert.equal(C.monthly(snapshot,'2026-09').spent,500);
assert.equal(C.monthly(snapshot,'2026-09').budget,null);
assert.equal(C.monthly(snapshot,'2026-11').spent,0);
snapshot.entries[0].cents=3500;assert.equal(C.monthly(snapshot,'2026-10').spent,17000);assert.equal(C.summary(snapshot,'Ritsuya').balance,32500);
snapshot.entries=snapshot.entries.filter(e=>e.id!=='a1');assert.equal(C.monthly(snapshot,'2026-10').spent,13500);assert.equal(C.summary(snapshot,'Ritsuya').balance,36000);
snapshot.categories.push({id:'new',name:'習い事',kind:'expense'});snapshot.household.push({id:'h5',person:'Hayu',entry_date:'2026-10-05',kind:'expense',category_id:'new',cents:500});assert.equal(C.monthly(snapshot,'2026-10').groups.find(g=>g.key==='new').name,'習い事');
const empty={...snapshot,entries:[],household:[],budgets:[{month:'2026-10-01',cents:0}]};assert.equal(C.monthly(empty,'2026-10').spent,0);assert.equal(C.monthly(empty,'2026-10').remaining,0);assert.equal(C.summary(empty,'honami').balance,30000);
console.log('PASS: allowance linking, no double counting, refunds versus top-ups, Hayu, monthly totals, edits/deletes, budgets and custom categories.');
