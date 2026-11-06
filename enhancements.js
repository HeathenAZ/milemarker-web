/* MileMarker v32 reporting, review, resilience, and active-trip controls. */
(()=>{
"use strict";

const originalRender=render, originalRenderActive=renderActive, originalResetTracker=resetTracker;
const originalBackupData=backupData, originalNativeUpdate=nativeUpdate;
let discardNativeFinish=false;

function activeReportFilters(){
  return {
    vehicle:$("#reportVehicleFilter")?.value||"all",
    purpose:$("#reportPurposeFilter")?.value||"all",
    month:$("#reportMonthFilter")?.value||"all",
    year:+($("#reportYear")?.value||new Date().getFullYear())
  };
}
function reportTrips(){
  let f=activeReportFilters();
  return [...state.trips].filter(t=>year(t.date,f.year)&&(f.vehicle==="all"||String(t.vehicleId)===f.vehicle)&&(f.purpose==="all"||t.purpose===f.purpose)&&(f.month==="all"||new Date(t.date).getMonth()===+f.month)).sort((a,b)=>new Date(a.date)-new Date(b.date));
}
function reportExpenses(){
  let f=activeReportFilters();
  return [...state.expenses].filter(e=>year(e.date,f.year)&&(f.vehicle==="all"||String(e.vehicleId)===f.vehicle)&&(f.month==="all"||new Date(e.date).getMonth()===+f.month)).sort((a,b)=>new Date(a.date)-new Date(b.date));
}
function reportPeriod(){let f=activeReportFilters();return f.month==="all"?String(f.year):new Date(f.year,+f.month).toLocaleString("en-US",{month:"long",year:"numeric"})}
function safePdfText(value){return String(value??"").normalize("NFKD").replace(/[^\x20-\x7E]/g," ").replace(/[()\\]/g,"\\$&")}
function downloadPdf(filename,title,lines){
  const pageLines=48,pages=[];for(let i=0;i<lines.length;i+=pageLines)pages.push(lines.slice(i,i+pageLines));if(!pages.length)pages.push(["No matching records."]);
  let objects=[null],fontId=1;objects[fontId]="<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const pageIds=[],contentIds=[];
  pages.forEach(()=>{pageIds.push(objects.length);objects.push("");contentIds.push(objects.length);objects.push("")});
  const pagesId=objects.length;objects.push("");const catalogId=objects.length;objects.push("<< /Type /Catalog /Pages "+pagesId+" 0 R >>");
  pages.forEach((page,index)=>{
    let text=["BT /F1 16 Tf 48 752 Td ("+safePdfText(title)+") Tj","/F1 9 Tf 0 -24 Td"];
    page.forEach((line,i)=>text.push((i?"0 -14 Td ":"")+"("+safePdfText(line).slice(0,115)+") Tj"));text.push("ET");
    let stream=text.join("\n");objects[contentIds[index]]="<< /Length "+stream.length+" >>\nstream\n"+stream+"\nendstream";
    objects[pageIds[index]]="<< /Type /Page /Parent "+pagesId+" 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 "+fontId+" 0 R >> >> /Contents "+contentIds[index]+" 0 R >>";
  });
  objects[pagesId]="<< /Type /Pages /Kids ["+pageIds.map(id=>id+" 0 R").join(" ")+"] /Count "+pageIds.length+" >>";
  let pdf="%PDF-1.4\n",offsets=[0];for(let i=1;i<objects.length;i++){offsets[i]=pdf.length;pdf+=i+" 0 obj\n"+objects[i]+"\nendobj\n"}let xref=pdf.length;pdf+="xref\n0 "+objects.length+"\n0000000000 65535 f \n";for(let i=1;i<objects.length;i++)pdf+=String(offsets[i]).padStart(10,"0")+" 00000 n \n";pdf+="trailer\n<< /Size "+objects.length+" /Root "+catalogId+" 0 R >>\nstartxref\n"+xref+"\n%%EOF";
  download(filename,pdf,"application/pdf");
}
function reportFilename(kind,ext="pdf"){let f=activeReportFilters(),vehicle=f.vehicle==="all"?"all-vehicles":vehicleName(f.vehicle).replace(/[^a-z0-9]+/gi,"-").toLowerCase();return "milemarker-"+kind+"-"+vehicle+"-"+reportPeriod().replace(/[^a-z0-9]+/gi,"-").toLowerCase()+"."+ext}
function tripLine(t){return [date(t.date),vehicleName(t.vehicleId),t.purpose||"Missing purpose",num(t.miles)+" mi",[t.start,t.end].filter(Boolean).join(" to ")||t.notes||"No route description"].join(" | ")}

function taxAuditReport(){
  let trips=reportTrips().filter(t=>t.purpose==="Business"||t.purpose==="Medical"),business=trips.filter(t=>t.purpose==="Business").reduce((s,t)=>s+(+t.miles||0),0),medical=trips.filter(t=>t.purpose==="Medical").reduce((s,t)=>s+(+t.miles||0),0),lines=["Period: "+reportPeriod(),"Generated: "+new Date().toLocaleString(),"Business miles: "+num(business)+" | Estimated deduction: "+cash(business*state.settings.rate),"Medical miles: "+num(medical),"",...trips.map(tripLine)];
  downloadPdf(reportFilename("tax-audit"),"MileMarker Tax Audit Report",lines);
}
function reconciliationReport(){
  let f=activeReportFilters(),vehicles=f.vehicle==="all"?state.vehicles:state.vehicles.filter(v=>String(v.id)===f.vehicle),lines=["Period: "+reportPeriod(),""];
  vehicles.forEach(v=>{let trips=reportTrips().filter(t=>String(t.vehicleId)===String(v.id)),withOdo=trips.filter(t=>Number.isFinite(+t.startOdometer)&&Number.isFinite(+t.endOdometer)),tracked=trips.reduce((s,t)=>s+(+t.miles||0),0),open=withOdo.length?Math.min(...withOdo.map(t=>+t.startOdometer)):null,close=withOdo.length?Math.max(...withOdo.map(t=>+t.endOdometer)):null,change=open==null?null:close-open,gap=change==null?null:change-tracked;lines.push(v.name,"Tracked miles: "+num(tracked)+(change==null?" | Odometer data incomplete":" | Odometer change: "+num(change)+" | Unaccounted: "+num(gap)),"")});
  downloadPdf(reportFilename("mileage-reconciliation"),"Mileage Reconciliation Report",lines);
}
function tripIssues(t){let issues=[];if(!t.purpose)issues.push("missing purpose");if(!(t.miles>0))issues.push("zero/missing mileage");if(!t.start||!t.end)issues.push("missing start/end location");if(!t.notes&&!t.job)issues.push("missing purpose note/job");if(t.startOdometer==null||t.endOdometer==null)issues.push("missing odometer");if(cleanRoute(t.route).length<2)issues.push("no GPS route");return issues}
function missingReport(){let flagged=reportTrips().map(t=>({t,issues:tripIssues(t)})).filter(x=>x.issues.length),lines=["Period: "+reportPeriod(),"Trips needing review: "+flagged.length,"",...flagged.map(x=>tripLine(x.t)+" | "+x.issues.join(", "))];downloadPdf(reportFilename("missing-information"),"Missing Information Report",lines)}
function vehicleCostReport(){let f=activeReportFilters(),vehicles=f.vehicle==="all"?state.vehicles:state.vehicles.filter(v=>String(v.id)===f.vehicle),lines=["Period: "+reportPeriod(),""];vehicles.forEach(v=>{let trips=reportTrips().filter(t=>String(t.vehicleId)===String(v.id)),expenses=reportExpenses().filter(e=>String(e.vehicleId)===String(v.id)),miles=trips.reduce((s,t)=>s+(+t.miles||0),0),total=expenses.reduce((s,e)=>s+(+e.amount||0),0);lines.push(v.name,"Mileage: "+num(miles)+" | Expenses: "+cash(total)+" | Cost per mile: "+cash(miles?total/miles:0));[...new Set(expenses.map(e=>e.category))].forEach(c=>lines.push("  "+c+": "+cash(expenses.filter(e=>e.category===c).reduce((s,e)=>s+(+e.amount||0),0))));lines.push("")});downloadPdf(reportFilename("vehicle-cost"),"Vehicle Cost Report",lines)}
function comparisonReport(){let f=activeReportFilters(),current=reportTrips(),previousStart,previousEnd;if(f.month==="all"){previousStart=new Date(f.year-1,0,1);previousEnd=new Date(f.year,0,1)}else{previousStart=new Date(f.year,+f.month-1,1);previousEnd=new Date(f.year,+f.month,1)}let previous=state.trips.filter(t=>{let d=new Date(t.date);return d>=previousStart&&d<previousEnd&&(f.vehicle==="all"||String(t.vehicleId)===f.vehicle)&&(f.purpose==="all"||t.purpose===f.purpose)}),sum=a=>a.reduce((s,t)=>s+(+t.miles||0),0),cur=sum(current),prev=sum(previous),change=prev?(cur-prev)/prev*100:0;downloadPdf(reportFilename("period-comparison"),"Mileage Comparison Report",["Current period: "+reportPeriod(),"Current mileage: "+num(cur),"Previous mileage: "+num(prev),"Change: "+(prev?(change>=0?"+":"")+num(change)+"%":"No prior-period mileage"),"",...['Business','Personal','Medical'].map(p=>p+": "+num(sum(current.filter(t=>t.purpose===p)))+" vs "+num(sum(previous.filter(t=>t.purpose===p))))])}
function destinationReport(){let counts=new Map;reportTrips().forEach(t=>[t.start,t.end].filter(Boolean).forEach(place=>{let key=place.trim().toLowerCase(),old=counts.get(key)||{name:place.trim(),visits:0,miles:0};old.visits++;old.miles+=+t.miles||0;counts.set(key,old)}));let rows=[...counts.values()].sort((a,b)=>b.visits-a.visits);downloadPdf(reportFilename("frequent-destinations"),"Frequent Destinations Report",["Period: "+reportPeriod(),"",...rows.map(x=>x.name+" | "+x.visits+" visits | "+num(x.miles)+" associated miles")])}
function chooseTripDetail(){let trips=reportTrips().slice().reverse();if(!trips.length)return toast("No matching trip to report");dialog("Trip detail report",'<label class="field full">Trip<select name="trip">'+trips.map(t=>'<option value="'+esc(t.id)+'">'+esc(date(t.date)+" · "+vehicleName(t.vehicleId)+" · "+num(t.miles)+" mi")+'</option>').join("")+'</select></label>',f=>{let t=state.trips.find(x=>String(x.id)===String(f.get("trip")));if(!t)return;downloadPdf("milemarker-trip-"+localDayKey(t.date)+".pdf","MileMarker Trip Detail",[tripLine(t),"Date/time: "+new Date(t.date).toLocaleString(),"Odometer: "+(t.startOdometer??"-")+" to "+(t.endOdometer??"-"),"Duration: "+(t.duration||0)+" minutes","Job/customer: "+(t.job||"-"),"Notes: "+(t.notes||"-"),"GPS route points: "+cleanRoute(t.route).length])})}
function showTripReview(){let flagged=state.trips.map(t=>({t,issues:tripIssues(t)})).filter(x=>x.issues.length),d=document.createElement("dialog");d.innerHTML='<div class="cardhead"><div><p class="eyebrow">TRIP REVIEW</p><h2>'+flagged.length+' trip'+(flagged.length===1?'':'s')+' need attention</h2></div><button class="secondary" type="button">Close</button></div><div class="review-list">'+(flagged.length?flagged.map(x=>'<div class="review-item"><strong>'+esc(date(x.t.date)+' · '+vehicleName(x.t.vehicleId)+' · '+num(x.t.miles)+' mi')+'</strong><span>'+esc(x.issues.join(', '))+'</span><button class="link" data-review-edit="'+esc(x.t.id)+'">Edit trip</button></div>').join(''):'<div class="empty">All trips have complete records.</div>')+'</div>';document.body.appendChild(d);d.querySelector('.secondary').onclick=()=>d.close();d.onclick=e=>{let b=e.target.closest('[data-review-edit]');if(!b)return;let t=state.trips.find(x=>String(x.id)===b.dataset.reviewEdit);d.close();if(t)tripDialog(t,false,t.id)};d.onclose=()=>d.remove();d.showModal()}
async function showStorageHealth(){let estimate=await navigator.storage?.estimate?.()||{},bytes=JSON.stringify(cloneState(state)).length,routePoints=state.trips.reduce((s,t)=>s+cleanRoute(t.route).length,0),d=document.createElement("dialog"),lastBackup=state.settings.lastBackupAt?new Date(state.settings.lastBackupAt).toLocaleString():"No backup recorded",lastSync=syncStamp?new Date(syncStamp).toLocaleString():"Not synced yet";d.innerHTML='<div class="cardhead"><div><p class="eyebrow">DATA HEALTH</p><h2>Storage & sync status</h2></div><button class="secondary">Close</button></div><div class="sync-health"><div><strong>'+state.trips.length+'</strong><span>Trips</span></div><div><strong>'+routePoints.toLocaleString()+'</strong><span>Saved route points</span></div><div><strong>'+Math.max(1,Math.round(bytes/1024)).toLocaleString()+' KB</strong><span>Compressed app data</span></div><div><strong>'+Math.round((estimate.usage||0)/1048576)+' MB</strong><span>Browser storage used</span></div></div><p><strong>Last cloud sync:</strong> '+esc(lastSync)+'</p><p><strong>Last downloaded backup:</strong> '+esc(lastBackup)+'</p><p class="muted">Local records use IndexedDB, routes are compressed, and cloud access is protected by your signed-in account.</p>';document.body.appendChild(d);d.querySelector('button').onclick=()=>d.close();d.onclose=()=>d.remove();d.showModal()}

function addReportTools(){
  let reports=$("#reports");if(!reports||$("#advancedReportTools"))return;
  let wrap=document.createElement("div");wrap.id="advancedReportTools";wrap.innerHTML='<div class="report-tools">'+[
    ["Tax audit PDF","Business/medical mileage and deduction-ready trip log.","taxAudit"],["Mileage reconciliation","Compare tracked mileage with odometer changes.","reconcile"],["Missing information","Find trips that need corrections before filing.","missing"],["Vehicle cost report","Expenses, totals, and cost per mile by vehicle.","vehicleCost"],["Trip detail PDF","Download one complete trip record.","tripDetail"],["Period comparison","Compare this month/year with the previous period.","compare"],["Frequent destinations","See recurring start and end locations.","destinations"],["Review incomplete trips","Open a correction list and edit records.","review"],["Storage & sync health","Check storage size, backup, routes, and sync.","storage"]].map(x=>'<article class="card report-tool"><h3>'+x[0]+'</h3><p class="muted">'+x[1]+'</p><button class="secondary" data-report="'+x[2]+'">Open</button></article>').join('')+'</div>';
  reports.appendChild(wrap);
  let actions={taxAudit:taxAuditReport,reconcile:reconciliationReport,missing:missingReport,vehicleCost:vehicleCostReport,tripDetail:chooseTripDetail,compare:comparisonReport,destinations:destinationReport,review:showTripReview,storage:showStorageHealth};wrap.onclick=e=>{let b=e.target.closest('[data-report]');if(b)actions[b.dataset.report]?.()};
}

function installDiscardButton(){
  let controls=$(".tracker .controls"),button=$("#discardTrip");if(!button){button=document.createElement("button");button.id="discardTrip";button.className="discard-trip hide";button.textContent="Discard";controls.insertBefore(button,$("#finish"))}
  button.onclick=()=>{if(!state.active)return;if(!confirm("Discard this active trip? No trip will be saved."))return;discardNativeFinish=!!(native()&&state.active.native);if(discardNativeFinish){if(typeof window.MileMarkerNative.cancelTrip==="function")window.MileMarkerNative.cancelTrip();else window.MileMarkerNative.finishTrip()}else if(watchId!=null){navigator.geolocation.clearWatch(watchId);watchId=null}clearInterval(timer);state.active=null;nativeFinishing=false;persistState();resetTracker();render();toast("Trip discarded")};
}
renderActive=function(){originalRenderActive();let b=$("#discardTrip");if(b)b.classList.toggle("hide",!state.active)};
resetTracker=function(){originalResetTracker();$("#discardTrip")?.classList.add("hide")};
nativeUpdate=function(raw){let n;try{n=typeof raw==="string"?JSON.parse(raw):raw}catch{}if(discardNativeFinish){if(n?.finished){try{window.MileMarkerNative.consumeFinishedTrip()}catch{}discardNativeFinish=false}return}return originalNativeUpdate(raw)};

backupData=function(){state.settings.lastBackupAt=new Date().toISOString();persistState();originalBackupData()};

const oldTripDialog=tripDialog;
tripDialog=function(data={},active=false,existingId=null){
  oldTripDialog(data,active,existingId);
  let fields=$("#fields"),notes=fields?.querySelector('[name="notes"]');if(!fields||!notes)return;
  let job=document.createElement("label");job.className="field full";job.innerHTML='Customer, job, or delivery block<input name="job" value="'+esc(data.job||'')+'" placeholder="Amazon Flex block, customer, project…">';notes.closest('label').before(job);
  let previousSubmit=onSubmit;onSubmit=f=>{let candidate={date:new Date(f.get('date')).getTime(),vehicleId:f.get('vehicleId'),miles:+f.get('miles')},duplicate=state.trips.find(t=>String(t.id)!==String(existingId)&&String(t.vehicleId)===String(candidate.vehicleId)&&Math.abs(new Date(t.date).getTime()-candidate.date)<300000&&Math.abs((+t.miles||0)-candidate.miles)<.2);if(duplicate&&!confirm("This looks like a duplicate of another trip. Save it anyway?")){toast("Duplicate trip not saved");return}previousSubmit(f);let saved=existingId!==null?state.trips.find(t=>String(t.id)===String(existingId)):state.trips.at(-1);if(saved){saved.job=f.get('job')||'';save()}};
}

function imageData(file){return new Promise((resolve,reject)=>{if(!file)return resolve("");if(file.size>8*1024*1024)return reject(Error("Receipt photo must be under 8 MB"));let reader=new FileReader;reader.onerror=()=>reject(Error("Receipt could not be read"));reader.onload=()=>{let image=new Image;image.onerror=()=>reject(Error("Receipt image could not be opened"));image.onload=()=>{let scale=Math.min(1,1200/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/jpeg',.7))};image.src=reader.result};reader.readAsDataURL(file)})}
expenseDialog=function(){dialog("Add expense",'<label class=field>Date<input name=date type=date required value="'+new Date().toISOString().slice(0,10)+'"></label><label class=field>Vehicle<select name=vehicleId>'+state.vehicles.map(v=>'<option value="'+esc(v.id)+'" '+(String(v.id)===String(state.selectedVehicleId)?'selected':'')+'>'+esc(v.name)+'</option>').join('')+'</select></label><label class=field>Amount<input name=amount type=number min=.01 step=.01 required></label><label class=field>Category<select name=category><option>Fuel</option><option>Maintenance</option><option>Parking</option><option>Tolls</option><option>Insurance</option><option>Registration</option><option>Supplies</option><option>Other</option></select></label><label class=field>Odometer<input name=odometer type=number min=0></label><label class="field full">Notes<input name=notes></label><label class="field full">Receipt photo (optional)<input name=receipt type=file accept="image/*"></label>',async f=>{try{let receipt=await imageData(f.get('receipt'));state.expenses.push({id:Date.now(),vehicleId:f.get('vehicleId'),date:new Date(f.get('date')+'T12:00:00').toISOString(),amount:+f.get('amount'),category:f.get('category'),odometer:+f.get('odometer')||null,notes:f.get('notes'),receipt});save();toast("Expense saved")}catch(error){toast(error.message)}})};
$("#addExpense").onclick=()=>expenseDialog();

const oldRenderExpenses=renderExpenses;
renderExpenses=function(){oldRenderExpenses();let vf=$("#expenseVehicleFilter")?.value||"all",shown=state.expenses.filter(e=>(vf==="all"||String(e.vehicleId)===vf)&&e.receipt);shown.forEach(e=>{let rows=[...$("#expenseList").children],row=rows.find(x=>x.textContent.includes(date(e.date))&&x.textContent.includes(cash(e.amount)));if(row&&!row.querySelector('[data-receipt]')){let b=document.createElement('button');b.className='route-button';b.dataset.receipt=e.id;b.textContent='Receipt';row.appendChild(b)}})};
document.addEventListener('click',e=>{let b=e.target.closest('[data-receipt]');if(!b)return;let item=state.expenses.find(x=>String(x.id)===b.dataset.receipt);if(!item?.receipt)return;let d=document.createElement('dialog');d.innerHTML='<div class="cardhead"><h2>Receipt</h2><button class="secondary">Close</button></div><img src="'+item.receipt+'" alt="Saved receipt" style="max-width:100%;max-height:70vh;border-radius:12px">';document.body.appendChild(d);d.querySelector('button').onclick=()=>d.close();d.onclose=()=>d.remove();d.showModal()});

$("#backup").onclick=()=>backupData();$("#dashBackup").onclick=()=>backupData();
originalRenderActive();installDiscardButton();addReportTools();
render=function(){originalRender();addReportTools();renderActive()};
setTimeout(()=>{if(!state.active||native()||watchId!=null||!navigator.geolocation)return;watchId=navigator.geolocation.watchPosition(p=>{let a=state.active;if(!a||a.pausedAt)return;let n={lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy};a.gps=true;if(a.last&&n.accuracy<100){let R=3958.8,r=x=>x*Math.PI/180,dlat=r(n.lat-a.last.lat),dlon=r(n.lon-a.last.lon),z=Math.sin(dlat/2)**2+Math.cos(r(a.last.lat))*Math.cos(r(n.lat))*Math.sin(dlon/2)**2,d=2*R*Math.asin(Math.sqrt(z));if(d<2)a.miles+=d}a.last=n;persistStateSoon();renderActive()},()=>{if(state.active)state.active.gps=false},{enableHighAccuracy:true,maximumAge:5000,timeout:15000});toast("Active trip recovered")},1200);
setTimeout(()=>{let last=state.settings.lastBackupAt?Date.now()-new Date(state.settings.lastBackupAt).getTime():Infinity;if(last>30*86400000&&state.trips.length)toast("Backup reminder: download a fresh copy of your records")},2500);
})();
