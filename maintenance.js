/* MileMarker v33 - Vehicle maintenance: schedules by miles and/or time, service history, due alerts. */
(()=>{
"use strict";
const NOTIFY_KEY="milemarker-maint-notified-v1";
const SUGGEST=["Oil change","Tire rotation","Air filter","Cabin air filter","Brake inspection","Transmission fluid","Coolant flush","Wiper blades","Battery check","Spark plugs","Registration renewal","Emissions test"];
const DEFAULTS={"oil change":{miles:5000,months:6},"tire rotation":{miles:6000,months:6},"air filter":{miles:15000,months:12},"cabin air filter":{miles:15000,months:12},"wiper blades":{miles:0,months:12},"registration renewal":{miles:0,months:12}};
const live=list=>(list||[]).filter(x=>x&&!x.deleted);
const todayKey=()=>localDayKey(Date.now());
const vehicleById=id=>state.vehicles.find(v=>String(v.id)===String(id));

function parseDay(s){if(!s)return null;let p=String(s).slice(0,10).split("-").map(Number);if(!p[0]||!p[1]||!p[2])return null;return new Date(p[0],p[1]-1,p[2])}
function addMonths(s,n){let d=parseDay(s);if(!d||!(+n>0))return null;let day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+(+n));d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));return d}
function fmtDay(d){return d?d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):""}
const hasNum=v=>v!==""&&v!=null&&Number.isFinite(+v);

/* ---------- data ---------- */
function ensureMaint(){
  if(!Array.isArray(state.maintItems)){
    // One-time conversion of the old odometer-only "service reminders".
    state.maintItems=(state.services||[]).map(s=>{let def=DEFAULTS[String(s.name||"").toLowerCase()]||{miles:5000,months:6};return{id:"maint-svc-"+s.id,vehicleId:s.vehicleId||state.selectedVehicleId,name:s.name||"Service",intervalMiles:def.miles,intervalMonths:def.months,lastOdometer:Math.max(0,(+s.due||0)-def.miles),lastDate:"",remindMiles:500,remindDays:14,updatedAt:0}});
  }
  if(!Array.isArray(state.maintLog))state.maintLog=[];
}
function itemStatus(it){
  let v=vehicleById(it.vehicleId),odo=+(v?.odometer)||0,today=parseDay(todayKey());
  let dueMiles=(+it.intervalMiles>0&&hasNum(it.lastOdometer))?(+it.lastOdometer)+(+it.intervalMiles):null;
  let milesLeft=dueMiles!=null?Math.round(dueMiles-odo):null;
  let dueDate=addMonths(it.lastDate,it.intervalMonths);
  let daysLeft=dueDate?Math.round((dueDate-today)/86400000):null;
  let overdue=(milesLeft!=null&&milesLeft<=0)||(daysLeft!=null&&daysLeft<=0);
  let soon=!overdue&&((milesLeft!=null&&milesLeft<=(+it.remindMiles||0))||(daysLeft!=null&&daysLeft<=(+it.remindDays||0)));
  let level=overdue?"overdue":soon?"soon":(dueMiles==null&&!dueDate)?"unset":"ok";
  let pm=dueMiles!=null?(odo-(+it.lastOdometer))/(+it.intervalMiles):0;
  let start=parseDay(it.lastDate),pd=(dueDate&&start&&dueDate>start)?(today-start)/(dueDate-start):0;
  return{v,odo,dueMiles,milesLeft,dueDate,daysLeft,level,pct:Math.max(0,Math.min(1,Math.max(pm,pd)))};
}
function statusText(s){
  let parts=[];
  if(s.milesLeft!=null)parts.push(s.milesLeft<=0?num(-s.milesLeft,0)+" mi overdue":num(s.milesLeft,0)+" mi left");
  if(s.daysLeft!=null)parts.push(s.daysLeft<0?Math.abs(s.daysLeft)+" days overdue":s.daysLeft===0?"due today":s.daysLeft+" days left");
  return parts.join(" · ")||"Log the last service to start tracking";
}
function intervalText(it){let a=[];if(+it.intervalMiles>0)a.push(num(it.intervalMiles,0)+" mi");if(+it.intervalMonths>0)a.push(it.intervalMonths+(+it.intervalMonths===1?" month":" months"));return a.length?"Every "+a.join(" or "):"No interval set"}
function dueText(s){let a=[];if(s.dueMiles!=null)a.push(num(s.dueMiles,0)+" mi");if(s.dueDate)a.push(fmtDay(s.dueDate));return a.length?"Due at "+a.join(" or ")+(a.length>1?", whichever comes first":""):""}
function attention(vehicleFilter="all"){return live(state.maintItems).filter(it=>vehicleFilter==="all"||String(it.vehicleId)===String(vehicleFilter)).map(it=>({it,s:itemStatus(it)})).filter(x=>x.s.level==="overdue"||x.s.level==="soon").sort((a,b)=>(a.s.level==="overdue"?0:1)-(b.s.level==="overdue"?0:1))}
const LEVEL={overdue:"Overdue",soon:"Due soon",ok:"OK",unset:"Not started"};

/* ---------- sync: merge maintenance records by id, newest edit wins ---------- */
function mergeByTime(remote=[],local=[]){let m=new Map((remote||[]).map(x=>[String(x.id),x]));(local||[]).forEach(x=>{let o=m.get(String(x.id));if(!o||(+x.updatedAt||0)>=(+o.updatedAt||0))m.set(String(x.id),x)});return[...m.values()]}
const origMeaningful=meaningfulSyncData;
meaningfulSyncData=function(value){return origMeaningful(value)||live(value?.maintLog).length>0||(value?.maintItems||[]).some(x=>+x.updatedAt>0)};
const origMerge=mergeSyncData;
mergeSyncData=function(remote,local){let out=origMerge(remote,local);if(!meaningfulSyncData(local))return out;out.maintItems=mergeByTime(remote?.maintItems,local?.maintItems);out.maintLog=mergeByTime(remote?.maintLog,local?.maintLog);return out};

/* ---------- dialogs ---------- */
function vehicleSelect(selected){return '<select name=vehicleId>'+state.vehicles.map(v=>'<option value="'+esc(v.id)+'" '+(String(v.id)===String(selected)?"selected":"")+'>'+esc(v.name)+'</option>').join("")+'</select>'}
function scheduleDialog(it){
  ensureMaint();let editing=!!it;it=it||{vehicleId:maintFilter()==="all"?state.selectedVehicleId:maintFilter(),remindMiles:500,remindDays:14};
  dialog(editing?"Edit maintenance schedule":"Add maintenance schedule",
    '<label class="field full">Service<input name=name list=maintSuggest required placeholder="Oil change" value="'+esc(it.name||"")+'"></label>'+
    '<label class="field full">Vehicle'+vehicleSelect(it.vehicleId)+'</label>'+
    '<label class=field>Every (miles)<input name=intervalMiles type=number min=0 step=1 placeholder="5000" value="'+esc(+it.intervalMiles>0?it.intervalMiles:"")+'"></label>'+
    '<label class=field>Every (months)<input name=intervalMonths type=number min=0 step=1 placeholder="6" value="'+esc(+it.intervalMonths>0?it.intervalMonths:"")+'"></label>'+
    '<label class=field>Last done (date)<input name=lastDate type=date value="'+esc(it.lastDate||"")+'"></label>'+
    '<label class=field>Last done (odometer)<input name=lastOdometer type=number min=0 step=1 value="'+esc(hasNum(it.lastOdometer)?Math.round(it.lastOdometer):"")+'"></label>'+
    '<label class=field>Remind me this many miles before<input name=remindMiles type=number min=0 step=1 value="'+esc(it.remindMiles??500)+'"></label>'+
    '<label class=field>Remind me this many days before<input name=remindDays type=number min=0 step=1 value="'+esc(it.remindDays??14)+'"></label>'+
    '<p class="muted field full">Whichever comes first (miles or date) triggers the reminder. Not sure when it was last done? Leave it blank and use <b>Log done</b> next time.</p>',
    f=>{
      let miles=+f.get("intervalMiles")||0,months=+f.get("intervalMonths")||0;
      if(!miles&&!months){toast("Enter a miles or months interval");return scheduleDialog(editing?it:null)}
      let rec={name:String(f.get("name")).trim(),vehicleId:f.get("vehicleId"),intervalMiles:miles,intervalMonths:months,lastDate:f.get("lastDate")||"",lastOdometer:hasNum(f.get("lastOdometer"))&&f.get("lastOdometer")!==""?+f.get("lastOdometer"):"",remindMiles:+f.get("remindMiles")||0,remindDays:+f.get("remindDays")||0,updatedAt:Date.now()};
      if(editing)Object.assign(it,rec);else state.maintItems.push({id:"maint-"+Date.now(),...rec});
      save();toast(editing?"Schedule updated":"Schedule added")});
  let form=$("#form"),name=form.elements.name,mi=form.elements.intervalMiles,mo=form.elements.intervalMonths;
  name.addEventListener("change",()=>{let d=DEFAULTS[name.value.trim().toLowerCase()];if(!d)return;if(!mi.value&&d.miles)mi.value=d.miles;if(!mo.value&&d.months)mo.value=d.months});
}
function logDialog(it){
  ensureMaint();let vid=it?it.vehicleId:(maintFilter()==="all"?state.selectedVehicleId:maintFilter()),v=vehicleById(vid)||currentVehicle();
  dialog(it?"Log "+it.name:"Log a service",
    (it?'<input type=hidden name=vehicleId value="'+esc(it.vehicleId)+'"><input type=hidden name=name value="'+esc(it.name)+'">':
      '<label class="field full">Service<input name=name list=maintSuggest required placeholder="Oil change"></label><label class="field full">Vehicle'+vehicleSelect(vid)+'</label>')+
    '<label class=field>Date<input name=date type=date required value="'+todayKey()+'"></label>'+
    '<label class=field>Odometer<input name=odometer type=number min=0 step=1 required value="'+Math.round(+v.odometer||0)+'"></label>'+
    '<label class=field>Cost<input name=cost type=number min=0 step=.01 placeholder="0.00"></label>'+
    '<label class=field>Shop or place<input name=shop placeholder="Jiffy Lube, DIY…"></label>'+
    '<label class="field full">Notes<input name=notes placeholder="5W-30 synthetic, rotated front to back…"></label>'+
    '<label class="field full maint-check"><input type=checkbox name=addExpense checked> Also add the cost to Expenses (Maintenance)</label>',
    f=>{
      let name=String(f.get("name")).trim(),vehicleId=f.get("vehicleId"),day=f.get("date"),odo=+f.get("odometer")||0,cost=+f.get("cost")||0,shop=String(f.get("shop")||"").trim(),notes=String(f.get("notes")||"").trim(),now=Date.now();
      let item=it||live(state.maintItems).find(x=>String(x.vehicleId)===String(vehicleId)&&x.name.trim().toLowerCase()===name.toLowerCase());
      let entry={id:"mlog-"+now,vehicleId,itemId:item?.id||null,name,date:day,odometer:odo,cost,shop,notes,updatedAt:now};
      if(cost>0&&f.get("addExpense")){let exp={id:now,vehicleId,date:new Date(day+"T12:00:00").toISOString(),amount:cost,category:"Maintenance",odometer:odo||null,notes:[name,shop,notes].filter(Boolean).join(" – "),receipt:""};state.expenses.push(exp);entry.expenseId=exp.id}
      state.maintLog.push(entry);
      if(item){let newer=!item.lastDate||day>=item.lastDate;if(newer){item.lastDate=day;item.lastOdometer=odo;item.updatedAt=now}}
      let veh=vehicleById(vehicleId);if(veh&&odo>(+veh.odometer||0))veh.odometer=odo;
      save();toast(name+" logged"+(item?"":" (no schedule for it yet)"))});
}
function recomputeItem(item){let logs=live(state.maintLog).filter(l=>String(l.itemId)===String(item.id)).sort((a,b)=>a.date<b.date?1:-1);if(logs[0]){item.lastDate=logs[0].date;item.lastOdometer=logs[0].odometer;item.updatedAt=Date.now()}}

/* ---------- notifications ---------- */
function nativeNotify(){return window.MileMarkerNative&&typeof window.MileMarkerNative.showReminder==="function"}
function alertMode(){if(nativeNotify())return"native";if(!("Notification" in window))return"none";return Notification.permission}
function sendAlert(title,body,tag){
  if(nativeNotify()){try{window.MileMarkerNative.showReminder(title,body);return}catch{}}
  if("Notification" in window&&Notification.permission==="granted"){
    let opts={body,tag,icon:"./assets/milemarker-app-icon.png"};
    if(navigator.serviceWorker?.getRegistration){navigator.serviceWorker.getRegistration().then(r=>r?r.showNotification(title,opts):new Notification(title,opts)).catch(()=>{try{new Notification(title,opts)}catch{}})}
    else{try{new Notification(title,opts)}catch{}}
  }
}
function checkAlerts(){
  if(!Array.isArray(state.maintItems))return;
  let sent={};try{sent=JSON.parse(localStorage.getItem(NOTIFY_KEY)||"{}")}catch{}
  let week=Math.floor(Date.now()/(7*86400000)),fresh=[];
  attention().forEach(({it,s})=>{let key=[s.level,it.lastDate,it.lastOdometer,it.intervalMiles,it.intervalMonths,s.level==="overdue"?week:""].join("|");if(sent[it.id]!==key){sent[it.id]=key;fresh.push({it,s})}});
  if(!fresh.length)return;
  try{localStorage.setItem(NOTIFY_KEY,JSON.stringify(sent))}catch{}
  fresh.forEach(({it,s})=>sendAlert(it.name+(s.level==="overdue"?" is overdue":" is due soon"),(s.v?.name||"Vehicle")+": "+statusText(s),"maint-"+it.id));
  toast(fresh.length===1?fresh[0].it.name+(fresh[0].s.level==="overdue"?" is overdue":" is due soon"):fresh.length+" maintenance items need attention");
}
async function enableAlerts(){
  let mode=alertMode();
  if(mode==="native")return toast("Phone notifications are on");
  if(mode==="none")return toast("This browser can't show notifications. Reminders will appear in the app.");
  if(mode==="denied")return toast("Notifications are blocked. Allow them in your browser's site settings.");
  if(mode==="default"){let r=await Notification.requestPermission();if(r==="granted"){toast("Maintenance alerts on");try{localStorage.removeItem(NOTIFY_KEY)}catch{}checkAlerts()}}
  else toast("Alerts are already on");
  renderMaintenance();
}

// Android app: hand date-based reminders to the phone so they fire even while the app is closed.
let lastNativeSchedule="";
function syncNativeSchedule(){
  if(!(window.MileMarkerNative&&typeof window.MileMarkerNative.scheduleReminders==="function")||!Array.isArray(state.maintItems))return;
  let now=Date.now(),list=[];
  live(state.maintItems).forEach(it=>{let s=itemStatus(it);if(!s.dueDate)return;let veh=s.v?.name||"Vehicle";
    let soon=new Date(s.dueDate);soon.setDate(soon.getDate()-(+it.remindDays||0));soon.setHours(9,0,0,0);
    let due=new Date(s.dueDate);due.setHours(9,0,0,0);
    if(+it.remindDays>0&&soon.getTime()>now)list.push({id:it.id+"-soon",title:it.name+" is due soon",body:veh+": due "+fmtDay(s.dueDate)+(s.dueMiles!=null?" or at "+num(s.dueMiles,0)+" mi":""),at:soon.getTime()});
    if(due.getTime()>now)list.push({id:it.id+"-due",title:it.name+" is overdue",body:veh+": was due today ("+fmtDay(s.dueDate)+")",at:due.getTime()});
  });
  list.sort((a,b)=>a.at-b.at);let json=JSON.stringify(list.slice(0,60));
  if(json===lastNativeSchedule)return;lastNativeSchedule=json;try{window.MileMarkerNative.scheduleReminders(json)}catch(e){console.error(e)}
}

/* ---------- rendering ---------- */
const maintFilter=()=>$("#maintVehicle")?.value||"all";
function row(it,showVehicle){
  let s=itemStatus(it);
  return '<div class="maint-row '+s.level+'"><div class="expicon">⚒</div><div><h3>'+esc(it.name)+' <span class="mtag '+s.level+'">'+LEVEL[s.level]+'</span></h3>'+
    '<p>'+(showVehicle?esc(s.v?.name||"Unknown vehicle")+' · ':'')+intervalText(it)+'</p>'+
    '<p><strong>'+statusText(s)+'</strong>'+(dueText(s)?' · '+dueText(s):'')+'</p>'+
    (it.lastDate||hasNum(it.lastOdometer)?'<p>Last done '+[it.lastDate?fmtDay(parseDay(it.lastDate)):"",hasNum(it.lastOdometer)?num(it.lastOdometer,0)+" mi":""].filter(Boolean).join(" at ")+'</p>':'')+
    '<div class="maint-bar"><i style="width:'+Math.round(s.pct*100)+'%"></i></div></div>'+
    '<div class="maint-actions"><button class="route-button" data-maint-log="'+esc(it.id)+'">Log done</button><button class="route-button" data-maint-edit="'+esc(it.id)+'">Edit</button><button class="delete" aria-label="Delete schedule" data-maint-del="'+esc(it.id)+'">×</button></div></div>';
}
function renderMaintenance(){
  ensureMaint();
  let sel=$("#maintVehicle");if(!sel)return;
  let keep=sel.value||"all";sel.innerHTML='<option value="all">All vehicles</option>'+state.vehicles.map(v=>'<option value="'+esc(v.id)+'">'+esc(v.name)+'</option>').join("");
  sel.value=[...sel.options].some(o=>o.value===keep)?keep:"all";
  let vf=sel.value,many=state.vehicles.length>1&&vf==="all";
  let order={overdue:0,soon:1,ok:2,unset:3};
  let items=live(state.maintItems).filter(it=>vf==="all"||String(it.vehicleId)===vf).map(it=>({it,s:itemStatus(it)})).sort((a,b)=>order[a.s.level]-order[b.s.level]||((a.s.milesLeft??1e9)-(b.s.milesLeft??1e9)));
  $("#maintList").innerHTML=items.length?items.map(x=>row(x.it,many)).join(""):'<div class="empty">No maintenance schedules yet.<br><button class="primary" id="maintStart" style="margin-top:12px">Add oil change &amp; tire rotation</button></div>';
  let logs=live(state.maintLog).filter(l=>vf==="all"||String(l.vehicleId)===vf).sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:(b.updatedAt||0)-(a.updatedAt||0));
  $("#maintHistory").innerHTML=logs.length?logs.slice(0,60).map(l=>'<div class="service"><div class="expicon">✓</div><div><strong>'+esc(l.name)+'</strong><p>'+fmtDay(parseDay(l.date))+' · '+num(l.odometer,0)+' mi'+(many?' · '+esc(vehicleName(l.vehicleId)):'')+(l.shop?' · '+esc(l.shop):'')+'</p>'+(l.notes?'<p>'+esc(l.notes)+'</p>':'')+'</div><strong>'+(l.cost?cash(l.cost):'')+'</strong><button class="delete" aria-label="Delete entry" data-maint-dellog="'+esc(l.id)+'">×</button></div>').join(""):'<div class="empty">Nothing logged yet. Tap <b>Log done</b> after each service.</div>';
  let y=new Date().getFullYear(),att=items.filter(x=>x.s.level==="overdue"),soon=items.filter(x=>x.s.level==="soon");
  $("#maintOverdue").textContent=att.length;$("#maintSoon").textContent=soon.length;
  $("#maintSpent").textContent=cash(logs.filter(l=>parseDay(l.date)?.getFullYear()===y).reduce((a,l)=>a+(+l.cost||0),0));
  $("#maintCount").textContent=logs.length;
  let mode=alertMode(),btn=$("#maintAlerts");
  btn.textContent=mode==="native"||mode==="granted"?"Alerts on":mode==="default"?"Turn on alerts":mode==="denied"?"Alerts blocked":"In-app alerts";
  btn.classList.toggle("primary",mode==="default");btn.classList.toggle("secondary",mode!=="default");
  renderBadges();renderDashAlert();renderVehicleCard();
}
function renderBadges(){
  let n=attention().length;
  $$('[data-view="maintenance"]').forEach(b=>{let el=b.querySelector(".nav-badge");if(!n){el?.remove();return}if(!el){el=document.createElement("span");el.className="nav-badge";b.appendChild(el)}el.textContent=n});
}
function renderDashAlert(){
  let dash=$("#dashboard");if(!dash)return;let card=$("#maintAlert"),list=attention();
  if(!list.length){card?.remove();return}
  if(!card){card=document.createElement("article");card.id="maintAlert";card.className="card maint-alert";card.setAttribute("role","button");card.tabIndex=0;card.onclick=()=>go("maintenance");card.onkeydown=e=>{if(e.key==="Enter")go("maintenance")};dash.prepend(card)}
  let over=list.some(x=>x.s.level==="overdue");card.classList.toggle("overdue",over);
  card.innerHTML='<div class="expicon">⚒</div><div><p class="eyebrow">MAINTENANCE</p><strong>'+list.slice(0,3).map(x=>esc(x.it.name)+" — "+statusText(x.s)).join("<br>")+'</strong>'+(list.length>3?'<p class="muted">+'+(list.length-3)+' more</p>':'')+'</div><span class="link">View ›</span>';
}
function renderVehicleCard(){
  let list=$("#serviceList");if(!list)return;let card=list.closest("article");
  list.classList.add("hide");$("#addService")?.classList.add("hide");
  let box=$("#vehicleMaint");if(!box){box=document.createElement("div");box.id="vehicleMaint";card.appendChild(box);let h=card.querySelector("h2");if(h)h.textContent="Maintenance"}
  let v=currentVehicle(),items=live(state.maintItems).filter(it=>String(it.vehicleId)===String(v.id)).map(it=>({it,s:itemStatus(it)})).sort((a,b)=>(a.s.milesLeft??1e9)-(b.s.milesLeft??1e9)).slice(0,4);
  box.innerHTML=(items.length?items.map(x=>'<div class="service"><div class="expicon">⚒</div><div><strong>'+esc(x.it.name)+'</strong><p>'+statusText(x.s)+'</p></div><span class="mtag '+x.s.level+'">'+LEVEL[x.s.level]+'</span><span></span></div>').join(""):'<div class="empty">No maintenance schedules for this vehicle.</div>')+'<button class="secondary wide" id="openMaint" style="margin-top:12px">Open Maintenance</button>';
  $("#openMaint").onclick=()=>go("maintenance");
}
function exportCsv(){
  let rows=[["Date","Vehicle","Service","Odometer","Cost","Shop","Notes"]].concat(live(state.maintLog).sort((a,b)=>a.date<b.date?-1:1).map(l=>[l.date,vehicleName(l.vehicleId),l.name,l.odometer,(+l.cost||0).toFixed(2),l.shop||"",l.notes||""]));
  download("milemarker-maintenance-"+todayKey()+".csv",rows.map(r=>r.map(c=>'"'+String(c??"").replace(/"/g,'""')+'"').join(",")).join("\n"),"text/csv");
}

/* ---------- wiring ---------- */
document.addEventListener("click",e=>{
  if(e.target.closest("#maintStart")){let vid=maintFilter()==="all"?state.selectedVehicleId:maintFilter(),now=Date.now();["Oil change","Tire rotation"].forEach((n,i)=>{let d=DEFAULTS[n.toLowerCase()];state.maintItems.push({id:"maint-"+(now+i),vehicleId:vid,name:n,intervalMiles:d.miles,intervalMonths:d.months,lastDate:"",lastOdometer:"",remindMiles:500,remindDays:14,updatedAt:now})});save();toast("Added – tap Edit to enter when each was last done");return}
  let b=e.target.closest("[data-maint-log],[data-maint-edit],[data-maint-del],[data-maint-dellog]");if(!b)return;
  let find=id=>state.maintItems.find(x=>String(x.id)===String(id));
  if(b.dataset.maintLog)return logDialog(find(b.dataset.maintLog));
  if(b.dataset.maintEdit)return scheduleDialog(find(b.dataset.maintEdit));
  if(b.dataset.maintDel){let it=find(b.dataset.maintDel);if(it&&confirm("Delete the "+it.name+" schedule? Its service history is kept.")){it.deleted=true;it.updatedAt=Date.now();save();toast("Schedule deleted")}return}
  if(b.dataset.maintDellog){let l=state.maintLog.find(x=>String(x.id)===b.dataset.maintDellog);if(l&&confirm("Delete this service entry?"+(l.expenseId?" The matching expense will stay in Expenses.":""))){l.deleted=true;l.updatedAt=Date.now();let it=l.itemId&&find(l.itemId);if(it)recomputeItem(it);save();toast("Entry deleted")}}
});
$("#maintAdd").onclick=()=>scheduleDialog();
$("#maintLogOther").onclick=()=>logDialog();
$("#maintCsv").onclick=exportCsv;
$("#maintAlerts").onclick=enableAlerts;
$("#maintVehicle").onchange=()=>renderMaintenance();

const prevRender=render;
render=function(){prevRender();try{renderMaintenance()}catch(err){console.error("Maintenance render failed",err)}try{syncNativeSchedule()}catch{}clearTimeout(window.__maintAlertTimer);window.__maintAlertTimer=setTimeout(checkAlerts,1500)};
const prevGo=go;
go=function(id){prevGo(id);if(id==="maintenance")$("#title").textContent="Maintenance"};
setInterval(checkAlerts,60*60*1000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)checkAlerts()});
window.MileMarkerMaintenance={status:itemStatus,attention,checkAlerts};
try{render()}catch{}
})();
