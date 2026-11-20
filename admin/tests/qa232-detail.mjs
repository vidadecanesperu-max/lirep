import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]?.trimStart().replace(/^import[^\n]+\n/,"");
assert.ok(script);
new vm.Script(script,{filename:"admin/index.html"});
assert.match(html,/id="closeDetail"/);
assert.doesNotMatch(html,/Registrar respuesta oficial \(sin envío\)/);
class E{
 constructor(id=""){this.id=id;this.hidden=["dashboard","detailPanel","membersPanel"].includes(id);this.value="";this.textContent="";this.innerHTML="";this.className="";this.disabled=false;this.dataset={};this.listeners={};this.style={}}
 addEventListener(t,cb){this.listeners[t]=cb}
 replaceChildren(...a){this.value=a[0]?.value||""}
 async click(){return this.listeners.click?.({})}
}
const orgA="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const orgB="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const idA="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const idB="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const uid="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const keyA="lirep.open-case.v1."+uid+"."+orgA;
const storage=new Map(),ss={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
function boot(){
 const elements=new Map(),events=[],calls=new Map();
 const get=id=>{if(!elements.has(id))elements.set(id,new E(id));return elements.get(id)};
 const db={auth:{async getSession(){return {data:{session:{user:{id:uid}}}}},async getUser(){return {data:{user:{id:uid,email:"qa@example.invalid"}}}},onAuthStateChange:cb=>events.push(cb),async signOut(){},async signInWithOtp(){return {error:null}}},
 async rpc(name,args={}){
   calls.set(name,(calls.get(name)||0)+1);
   const o=args.p_organization_id;
   const predefined={lirep_admin_accept_invitations:null,lirep_admin_my_organizations:[
     {id:orgA,role:"company_admin",name:"Org A",prefix:"VIDACANE"},
     {id:orgB,role:"company_admin",name:"Org B",prefix:"BTEST001"}],
     lirep_admin_company_memberships:[],lirep_admin_list_invitations:[],
     lirep_admin_case_entries_list:[],
     lirep_admin_a10_list:[{id:"ffffffff-ffff-4fff-8fff-ffffffffffff",status:"approved",submitted_at:"2026-11-19T19:09:00Z",body:"Respuesta validada en entorno QA",submitted_by:uid}],
     lirep_admin_response_delivery_status:[{response_id:"ffffffff-ffff-4fff-8fff-ffffffffffff",status:"pending",attempts:0}],
     lirep_admin_case_tracking:{status:'submitted',official_delivery_method:'postal',history:[{status:'submitted',changed_at:'2026-11-19T00:00:00Z'}],due_at:'2026-12-01'}};
   if(name==="lirep_admin_list_complaints")return {data:[{id:o===orgA?idA:idB,public_code:"VIDACANE-LR001",complaint_type:"reclamo",status:"submitted",submitted_at:"2026-11-19",response_due_at:"2026-12-01"}],error:null};
   if(name==="lirep_admin_case_detail")return {data:{public_code:"VIDACANE-LR001",complaint_type:"reclamo",status:"submitted",consumer:{},establishment:"QA",submitted_at:"2026-11-19",response_due_at:"2026-12-01",product_service_description:"test",product_service_type:"servicio",amount:1,preferred_response_channel:"email",detail:"QA",consumer_request:"QA"},error:null};
   if(!(name in predefined))throw Error("Unexpected RPC "+name);
   return {data:predefined[name],error:null};
 }};
 const ctx=vm.createContext({createClient:()=>db,document:{getElementById:get,createElement:()=>new E()},URLSearchParams,
   location:{search:"?public_prefix=VIDACANE",hash:"",pathname:"/"},history:{replaceState(){}},
   sessionStorage:ss,setTimeout,clearTimeout,Date,Map,Promise,console});
 vm.runInContext(script,ctx);
 return {ctx,get,events,calls};
}
const sleep=()=>new Promise(r=>setTimeout(r,20));
async function execute(page,statement){return await vm.runInContext(statement,page.ctx)}
const a=boot();await sleep();
assert.equal(a.get("detailPanel").hidden,true);
await execute(a,'openDetail("'+idA+'")');
assert.equal(a.get("detailPanel").hidden,false);
assert.equal(storage.get(keyA),idA);
assert.match(a.get("caseResponseDeliveryStatus").textContent,/Respuesta oficial: Aprobada/);
assert.match(a.get("caseResponseDeliveryStatus").textContent,/Comunicación: En cola/);
assert.equal(a.get("formalResponseForm").hidden,true,"approved answer must suppress new draft form");
assert.equal(a.get("formalResponseGuard").hidden,false,"guard message must be visible");
assert.match(a.get("formalResponseGuard").textContent,/Tu respuesta ya está aprobada/);

await a.get("refreshCaseDelivery").click();
assert.equal(a.get("detailPanel").hidden,false,"manual status refresh must preserve case");
assert.match(a.get("caseResponseDeliveryStatus").textContent,/En cola/);
assert.match(a.get("caseRefreshStatus").textContent,/Actualizado a las/);
assert.equal(a.get("refreshCaseDelivery").disabled,false);
assert.equal(a.get("refreshCaseDelivery").textContent,"Actualizar estado y entrega");

a.get("formalResponseText").value="Borrador sin guardar";
const prior=a.calls.get("lirep_admin_list_complaints");
for(const e of ["TOKEN_REFRESHED","SIGNED_IN","USER_UPDATED"])for(const cb of a.events)cb(e,{user:{id:uid}});
await sleep();
assert.equal(a.get("detailPanel").hidden,false);
assert.equal(a.get("formalResponseText").value,"Borrador sin guardar");
assert.equal(a.calls.get("lirep_admin_list_complaints"),prior);
await execute(a,"load()");
assert.equal(a.get("detailPanel").hidden,false);
const cancelled=a.get("closeDetail").click();
assert.equal(a.get("lirepDialogBackdrop").hidden,false,"custom confirmation must be visible");
assert.equal(a.get("detailPanel").hidden,false,"case must remain open while modal is visible");
await a.get("lirepDialogCancel").click();
await cancelled;
assert.equal(a.get("lirepDialogBackdrop").hidden,true);
assert.equal(a.get("detailPanel").hidden,false,"cancel must preserve the opened case");
const accepted=a.get("closeDetail").click();
assert.equal(a.get("lirepDialogBackdrop").hidden,false);
await a.get("lirepDialogAccept").click();
await accepted;
assert.equal(a.get("detailPanel").hidden,true);
assert.equal(storage.has(keyA),false);

const reasonPending=vm.runInContext('lirepDialog({title:"Motivo",text:"Indica motivo",reasonRequired:true,accept:"Rechazar",danger:true})',a.ctx);
assert.equal(a.get("lirepDialogBackdrop").hidden,false);
a.get("lirepDialogReason").value="x";
await a.get("lirepDialogAccept").click();
assert.equal(a.get("lirepDialogError").hidden,false,"no rejection without a reason");
assert.equal(a.get("lirepDialogBackdrop").hidden,false,"invalid reason keeps dialog open");
a.get("lirepDialogReason").value="No procede esta propuesta";
await a.get("lirepDialogAccept").click();
const reason=await reasonPending;
assert.equal(reason.confirmed,true);
assert.equal(reason.note,"No procede esta propuesta");
assert.equal(a.get("lirepDialogBackdrop").hidden,true);
const escapePending=vm.runInContext('lirepDialog({title:"Descartar",text:"¿Cerrar?"})',a.ctx);
let prevented=false;
a.get("lirepDialogBackdrop").listeners.keydown({key:"Escape",preventDefault(){prevented=true}});
const escaped=await escapePending;
assert.equal(escaped.confirmed,false);
assert.equal(prevented,true);
assert.equal(a.get("lirepDialogBackdrop").hidden,true);

const b=boot();await sleep();assert.equal(b.get("detailPanel").hidden,true);
await execute(b,'openDetail("'+idA+'")');
const c=boot();await sleep();
assert.equal(c.get("detailPanel").hidden,false);
c.get("org").value=orgB;await execute(c,"load()");
assert.equal(c.get("detailPanel").hidden,true);
await execute(c,'openDetail("'+idB+'")');
c.get("org").value=orgA;await execute(c,"load()");
assert.equal(c.get("detailPanel").hidden,false);
assert.equal(storage.get(keyA),idA);
console.log("QA235 PASS | session, custom modal accept/cancel, required rejection reason, ESC, reload, tenant isolation");
