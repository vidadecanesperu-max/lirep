// QA248 | Single-view admin navigation and topbar hamburger.
// All tests are local, no Supabase writes, consumer notifications, or sessions.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]?.trimStart().replace(/^import[^\n]+\n/,"");
assert.ok(script);new vm.Script(script);
assert.match(html,/<header class="lirep-topbar">[\s\S]*?LIREP[\s\S]*?id="lirepNavToggle"/);
assert.match(html,/<button id="lirepNavToggle"[^>]*hidden><span class="bars" aria-hidden="true">☰<\/span><\/button>/);
assert.doesNotMatch(html,/<button id="lirepNavToggle"[^>]*>[\s\S]*?Secciones<\/span>/);
const ids=["introPanel","summaryPanel","complaintsPanel","detailPanel","responseViewPanel","notesViewPanel","membersPanel"];
for(const id of ids)assert.match(html,new RegExp('id="'+id+'"[^>]*data-workspace-panel'));
for(const name of ["formalResponsePanel","history","entryForm"])assert.match(html,new RegExp('id="'+name+'"'));
assert.match(html,/\[data-workspace-panel\]\[data-view-hidden="true"\]\{display:none!important\}/);
assert.match(html,/data-section="responseViewPanel"/);
assert.match(html,/data-section="notesViewPanel"/);
assert.match(html,/\.lirep-topbar \.lirep-nav-toggle:not\(\[hidden\]\)\{display:inline-flex!important\}/);
class Element {
 constructor(id=""){
  this.id=id;this.hidden=["dashboard","detailPanel","responseViewPanel","notesViewPanel","membersPanel","lirepNavShade","lirepNavToggle"].includes(id);
  this.value="";this.textContent="";this.innerHTML="";this.dataset={};this.style={};this.listeners={};this.attributes={};this.className="";
 }
 addEventListener(type,handler){this.listeners[type]=handler}
 setAttribute(name,v){this.attributes[name]=String(v)}
 removeAttribute(name){delete this.attributes[name]}
 getAttribute(name){return this.attributes[name]||null}
 focus(){}
 replaceChildren(...values){this.value=values[0]?.value||""}
 querySelectorAll(selector){return this.id==="lirepSidebar"&&selector.includes("data-section")?navButtons:[]}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null}
 async click(){return this.listeners.click?.({target:this})}
}
const sections=ids.map(id=>{const b=new Element("nav-"+id);b.dataset.section=id;b.hidden=["detailPanel","responseViewPanel","notesViewPanel"].includes(id);return b});
const navButtons=sections;
const items=new Map();
function get(id){if(!items.has(id))items.set(id,new Element(id));return items.get(id)}
const doc={
 getElementById:get,
 createElement:()=>new Element(),
 activeElement:null,
 querySelectorAll:(selector)=>selector==="[data-case-nav]"?sections.filter(x=>["detailPanel","responseViewPanel","notesViewPanel"].includes(x.dataset.section)):[],
 addEventListener(){},
};
const fakeDb={
 auth:{
 async getSession(){return {data:{session:null}}},
 async getUser(){return {data:{user:null}}},
 onAuthStateChange(){},
 async signOut(){},
 async signInWithOtp(){return {error:null}}
 },
 rpc:async()=>({data:null,error:null})
};
let scrollCalls=0;
const w={innerWidth:380,addEventListener(){},scrollTo(){scrollCalls++}};
const storage=new Map();
const ctx=vm.createContext({
 createClient:()=>fakeDb,document:doc,window:w,URLSearchParams,
 location:{search:"?public_prefix=VIDACANE",pathname:"/",hash:"",replace(){}},
 history:{replaceState(){}},
 sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 Date,Map,Promise,setTimeout,clearTimeout,console
});
vm.runInContext(script,ctx);
const run=x=>vm.runInContext(x,ctx);
assert.equal(get("lirepNavToggle").hidden,true,"menu hidden until login");
get("lirepNavToggle").hidden=false;
assert.equal(run("showWorkspaceView('summaryPanel')"),true);
assert.equal(get("summaryPanel").dataset.viewHidden,"false");
for(const id of ids.filter(x=>x!=="summaryPanel"))assert.equal(get(id).dataset.viewHidden,"true",id+" must be hidden");
assert.equal(get("lirepNavToggle").getAttribute("aria-expanded")||"false","false");
run("openSidebar()");
assert.equal(get("lirepSidebar").dataset.open,"true");
assert.equal(get("lirepNavToggle").getAttribute("aria-expanded"),"true");
run("closeSidebar()");
assert.equal(get("lirepSidebar").dataset.open,"false");
assert.equal(get("lirepNavShade").hidden,true);
assert.equal(run("showWorkspaceView('responseViewPanel')"),false,"no response panel without open case");
get("detailPanel").hidden=false;
run("updateCaseNavigation()");
assert.equal(get("responseViewPanel").hidden,false);
assert.equal(get("notesViewPanel").hidden,false);
assert.equal(run("showWorkspaceView('responseViewPanel')"),true);
assert.equal(get("responseViewPanel").dataset.viewHidden,"false");
assert.equal(get("detailPanel").hidden,false,"case is still open and never implicitly closed");
assert.equal(get("detailPanel").dataset.viewHidden,"true","case detail not shown under answer");
assert.equal(get("notesViewPanel").dataset.viewHidden,"true","notes not stacked under answer");
assert.equal(run("showWorkspaceView('notesViewPanel')"),true);
assert.equal(get("notesViewPanel").dataset.viewHidden,"false");
assert.equal(get("responseViewPanel").dataset.viewHidden,"true");
run("showWorkspaceView('detailPanel')");
assert.equal(get("detailPanel").dataset.viewHidden,"false");
get("formalResponseText").value="";
await get("closeDetail").click();
assert.equal(get("detailPanel").hidden,true,"closing case must only happen by user");
assert.equal(get("notesViewPanel").hidden,true);
assert.equal(get("responseViewPanel").hidden,true);
assert.equal(get("complaintsPanel").dataset.viewHidden,"false","close returns to complaints");
assert.equal(get("introPanel").dataset.viewHidden,"true");
assert.ok(scrollCalls>=4,"navigation moves to the chosen view");
console.log("QA248 PASS | header hamburger, exclusive content, case persistence, section switch and close by user");
