"use strict";(()=>{var f="openchamber.sdk";var Se="data-oc-scrolling",De=`
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${Se}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${Se}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${Se}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${Se}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;function He(e){let o=e.documentElement;if(o.hasAttribute("data-oc-scrollbar-activity"))return;o.setAttribute("data-oc-scrollbar-activity","");let n=new WeakMap;e.addEventListener("scroll",c=>{let l=c.target===e?o:c.target;if(!(l instanceof Element))return;l.hasAttribute("data-oc-scrolling")||l.setAttribute("data-oc-scrolling","");let _=n.get(l);_!==void 0&&clearTimeout(_),n.set(l,setTimeout(()=>{n.delete(l),l.removeAttribute("data-oc-scrolling")},1e3))},{capture:!0,passive:!0})}var Lo=`(${He.toString()})(document);`;var Ht=/^[a-z][a-z0-9-]{0,39}$/;var Nt=e=>Object(e)===e&&!Array.isArray(e),$e=(e,o)=>Object.keys(e).every(n=>o.includes(n)),Pt=e=>String(e)===e&&e.length>=1&&e.length<=60,Dt=e=>String(e)===e&&e.length>=1&&e.length<=80,$t=e=>{if(!Array.isArray(e)||e.length>4)return!1;let o=new Set;for(let n of e){if(!Nt(n)||!Ht.test(n.id)||!Pt(n.label)||n.disabled!==void 0&&n.disabled!==!0&&n.disabled!==!1||o.has(n.id))return!1;if(o.add(n.id),n.kind==="button"){if(!$e(n,["kind","id","label","disabled"]))return!1;continue}if(n.kind!=="select"||!$e(n,["kind","id","label","value","options","disabled"])||!Dt(n.value)||!Array.isArray(n.options)||n.options.length<1||n.options.length>16)return!1;let c=new Set;for(let l of n.options){if(!Nt(l)||!$e(l,["value","label"])||!Dt(l.value)||!Pt(l.label)||c.has(l.value))return!1;c.add(l.value)}if(!c.has(n.value))return!1}return!0};var Fe=e=>"bytes"in e?e.bytes.byteLength:e.content.length,Ft=(e,o)=>{if(e.path!==o.path||e.readOnly!==o.readOnly)return!1;if(e.encoding==="text"||o.encoding==="text")return e.encoding==="text"&&o.encoding==="text"&&e.content===o.content;if(e.bytes.byteLength!==o.bytes.byteLength)return!1;for(let n=0;n<e.bytes.byteLength;n+=1)if(e.bytes[n]!==o.bytes[n])return!1;return!0};var Xt=/^[A-Za-z0-9_-]{1,80}$/;var Bt=["left","right","top","bottom"];var Vt=(e,o=0,n={remaining:16e3})=>{if(--n.remaining<0||o>=32)return!1;if(e===null)return!0;let c=Array.isArray(e)?e:Object(e)===e?Object.values(e):[];for(let l of c)if(!Vt(l,o+1,n))return!1;return!0},Xe=e=>{if(e===null||e===!0||e===!1)return!0;if(Array.isArray(e))return Object.keys(e).every(o=>/^(0|[1-9]\d*)$/.test(o)&&Number(o)<e.length)&&e.every(Xe);if(Object(e)===e){let o=Object.getPrototypeOf(e);return(o===null||o===Object.prototype)&&Object.values(e).every(Xe)}return String(e)===e||Number.isFinite(e)},Be=e=>{try{return String(e.id)!==e.id||!Xt.test(e.id)||!Number.isFinite(e.anchor.x)||Math.abs(e.anchor.x)>1e5||!Number.isFinite(e.anchor.y)||Math.abs(e.anchor.y)>1e5||!Number.isFinite(e.anchor.width)||!Number.isFinite(e.anchor.height)||e.anchor.width<=0||e.anchor.height<=0||e.anchor.width>1e5||e.anchor.height>1e5||!Number.isInteger(e.width)||e.width<160||e.width>640||!Number.isInteger(e.height)||e.height<48||e.height>480||e.side!==void 0&&!Bt.includes(e.side)||e.focus!==void 0&&e.focus!==!0&&e.focus!==!1||!Vt(e.data)||!Xe(e.data)?!1:JSON.stringify(e.data).length<=16e3}catch{return!1}};var zt=["file","directory","other","missing"],je=e=>!!(e&&"sessionId"in e),ze=e=>!!(e&&"sent"in e&&!("sessionId"in e));var Kt=/^[0-9a-f]{7,64}$/i,Ke=e=>Kt.test(e),Te=500,he=32e3,Wt=16e3,Jt=128,Yt=200,Qt=2e3,Zt=16e3,qt=80,eo=200,to=16e3;var oo=2e3;var We=2e4,xe=1024,be=2e6;var ke=64e3,ge=8e3,Je=4e3;var Ye=9e4;var ro=999,no=1e4,ae=500,so=["HOST_UNAVAILABLE","HOST_TIMEOUT","HOST_REJECTED","DISCONNECTED","DISABLED","BAD_PATH","NO_INTEGRATION","NO_SERVICE","SERVICE_FAILED","REQUEST_FAILED","RESPONSE_TOO_LARGE","NO_SESSION","SESSION_BUSY","NOT_GRANTED","NO_DIRECTORY","NOT_FOUND","FILE_TOO_LARGE","DENIED","NO_MODEL","MODEL_FAILED","UNSUPPORTED"],io=["stopped","starting","ready","failed"],Go=new Set(so),ao=e=>Go.has(e),co=e=>e&&ao(e)?e:"HOST_REJECTED",J=e=>e===void 0?!1:e===null||e===!0||e===!1||String(e)===e?!0:Number(e)===e?Number.isFinite(e):Array.isArray(e)?e.every(J):Object(e)===e?Object.values(e).every(J):!1,lo=e=>J(e)&&JSON.stringify(e).length<=to,jt=e=>e?.trim().slice(0,eo)??"",Y=e=>{let o=e.id.trim().slice(0,Jt),n=e.title.trim().slice(0,Yt),c=e.url.trim().slice(0,Qt),l=e.text?.trim().slice(0,Zt),_=e.author?.trim().slice(0,qt),y=e.kind==="pull"?"pull":"issue",O={providerId:e.providerId.trim(),id:o,title:n||o,url:c,kind:y};if(l&&(O.text=l),_&&(O.author=_),y==="pull"){let U=jt(e.branches?.head),P=jt(e.branches?.base);U&&P&&(O.branches={head:U,base:P})}return lo(e.data)&&(O.data=e.data),O},Qe=e=>{let o=Y(e);return e.projectId&&(o.projectId=e.projectId),e.navigation&&(o.navigation=e.navigation),e.worktree&&(o.worktree=e.worktree),o},Ze=e=>{let o={text:e.text.trim().slice(0,Wt)};return e.send&&(o.send=!0),o},qe=e=>e===null||!Number.isFinite(e)?null:Math.min(ro,Math.max(0,Math.round(e))),et=e=>Number.isFinite(e)?Math.min(no,Math.max(0,Math.ceil(e))):0;var Q=e=>e.length>0&&e.length<=xe&&!e.includes("\0")&&!e.includes("\\");var Ae=e=>!e.startsWith("/")||e.includes("\0")||e.includes("\\")||e.includes("://")||e.length>oo?!1:!e.split("/").some(n=>n==="."||n===".."),No=new Set(io),tt=e=>!!(e&&"status"in e&&No.has(String(e.status))&&!("body"in e)),ye=e=>!!(e&&"status"in e&&"body"in e&&Number.isInteger(e.status)),ot=e=>!!(e&&"content"in e&&String(e.content)===e.content),rt=e=>!!(e&&"written"in e&&e.written===!0),nt=e=>!!(e&&"entries"in e&&Array.isArray(e.entries)),Po=new Set(zt),st=e=>!!(e&&"kind"in e&&"size"in e&&Po.has(String(e.kind))&&Number.isFinite(e.size)),it=e=>!!(e&&"text"in e&&String(e.text)===e.text&&!("status"in e)),Do=new Set(["workspace","shells","ready","directory","session","connection","settings","session-lifecycle","item","resolve","action","status-control-event","popover-closed","file-open","file-snapshot","file-saved"]),Ho=e=>Object(e)===e?e:null,Ve=e=>String(e)===e&&e.length>0,$o=e=>{if(!Ve(e.id))return null;if(e.ok===!0){let o={channel:f,v:1,type:"result",id:e.id,ok:!0};return Object(e.payload)===e.payload&&(o.payload=e.payload),o}return e.ok===!1&&Ve(e.error)?{channel:f,v:1,type:"result",id:e.id,ok:!1,error:e.error,code:co(Ve(e.code)?e.code:void 0)}:null},at=e=>{let o=Ho(e);return!o||o.channel!==f||o.v!==1?null:o.type==="result"?$o(o):!Do.has(String(o.type))||Object(o.payload)!==o.payload?null:o};var po=e=>"key"in e&&"metaKey"in e&&"ctrlKey"in e,Fo=e=>(e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==="s",a=class extends Error{code;constructor(o,n){super(n),this.name="HostRequestError",this.code=o}},uo=()=>Promise.reject(new a("BAD_PATH",'Request path must start with "/" and stay on the declared origin.')),Oe=()=>Promise.reject(new a("BAD_PATH",`File path must be 1 to ${xe} characters without NUL or backslash.`)),we=e=>{if(e!==void 0){if(Object(e)!==e||Array.isArray(e)||e.scope!==void 0&&e.scope!=="instance"&&e.scope!=="device")throw new a("HOST_REJECTED",'Storage scope must be "instance" or "device".');return e.scope==="device"?"device":void 0}},u=e=>(e.value+=1,`oc-${e.value}`),ut=(e={})=>{let o=e.target??("window"in globalThis?window:null);if(!o)throw new a("HOST_UNAVAILABLE","No window. connectHost runs in a browser frame.");let n=e.acceptSource??(t=>t===o.parent),c=e.requestTimeoutMs??We,l=new Set,_=new Set,y=new Set,O=new Set,U=new Set,P=new Set,ee=new Set,le=new Set,pe=new Set,te=null,oe=null,ue=new Set,fe=new Set,re=null,ne=null,Le=!1,z=new Map,K=new Map,W=new Map,D=!1,p={value:0},d=null,H=null,se=!1,ie=!1,yt=null,Ot=t=>t?{sessionId:t.id,phase:t.busy?"started":"completed"}:null,M=t=>{o.parent.postMessage(t,"*")},g=(t,r)=>{for(let s of t)try{s(r)}catch(i){console.error(i)}},wt=t=>{if(!(t instanceof MessageEvent)||!n(t.source))return;let r=at(t.data);if(!r)return;if(r.type==="workspace"){let i=K.get(r.payload.subscriptionId);i&&g([i],r.payload.snapshot);return}if(r.type==="shells"){let i=W.get(r.payload.subscriptionId);i&&g([i],r.payload.snapshot);return}if(r.type==="ready"){d=r.payload,H=Ot(r.payload.session),g(l,r.payload),g(_,r.payload.directory),g(y,r.payload.session),H&&g(O,H),g(U,r.payload.connection),g(P,r.payload.settings),g(ee,r.payload.item);return}if(r.type==="directory"){d&&(d={...d,directory:r.payload.directory}),g(_,r.payload.directory);return}if(r.type==="session"){d&&(d={...d,session:r.payload.session}),r.payload.session?H?.sessionId!==r.payload.session.id&&(H=Ot(r.payload.session)):H=null,g(y,r.payload.session);return}if(r.type==="session-lifecycle"){H=r.payload,g(O,r.payload);return}if(r.type==="connection"){d&&(d={...d,connection:r.payload.connection}),g(U,r.payload.connection);return}if(r.type==="settings"){d&&(d={...d,settings:r.payload.settings}),g(P,r.payload.settings);return}if(r.type==="item"){d&&(d={...d,item:r.payload.item}),g(ee,r.payload.item);return}if(r.type==="status-control-event"){g(le,r.payload);return}if(r.type==="popover-closed"){g(pe,r.payload);return}if(r.type==="action"){let i=m=>{D||M({channel:f,v:1,type:"action-result",id:r.id,payload:m})},S=oe;if(!S){i({ok:!1,error:"This extension does not handle background actions."});return}Promise.resolve().then(()=>S(r.payload)).then(()=>i({ok:!0}),m=>{let k=(m instanceof Error?m.message:String(m)).trim();i({ok:!1,error:(k||"Action failed.").slice(0,ae)})});return}if(r.type==="file-open"){let i=r.payload;if(ne&&Ft(ne,i))return;ne=i,g(ue,r.payload);return}if(r.type==="file-saved"){g(fe,r.payload.version);return}if(r.type==="file-snapshot"){let i=k=>{D||M({channel:f,v:1,type:"file-snapshot-result",id:r.id,payload:k})},S=k=>i({error:(k.trim()||"Could not read the edited file.").slice(0,ae)}),m=re;if(!m){S("This extension does not edit files.");return}Promise.resolve().then(()=>m(r.payload.purpose)).then(k=>{if(Fe(k)>2e7){S(`The file is over ${2e7} ${"bytes"in k?"bytes":"characters"}.`);return}if(k.version.length>256){S(`The snapshot version is over ${256} characters.`);return}i({snapshot:"bytes"in k?{bytes:k.bytes,version:k.version}:{content:k.content,version:k.version}})},k=>S(k instanceof Error?k.message:String(k)));return}if(r.type==="resolve"){let i=m=>{M({channel:f,v:1,type:"resolve-result",id:r.id,payload:m})},S=te;if(!S){i({error:"This extension does not resolve commands."});return}Promise.resolve().then(()=>S(r.payload)).then(m=>i({item:m?Y(m):null}),m=>{let k=(m instanceof Error?m.message:String(m)).trim();i({error:(k||"Command failed.").slice(0,ae)})});return}let s=z.get(r.id);if(s){if(clearTimeout(s.timer),z.delete(r.id),r.ok){s.resolve(r.payload);return}s.reject(new a(r.code,r.error))}};o.addEventListener("message",wt),M({channel:f,v:1,type:"hello"});let I=(t,r=c)=>D||o.parent===o?Promise.reject(new a("HOST_UNAVAILABLE","No host frame. This page is not in an iframe.")):new Promise((s,i)=>{let S=setTimeout(()=>{z.delete(t.id),i(new a("HOST_TIMEOUT","Host did not answer in time."))},r);z.set(t.id,{resolve:s,reject:i,timer:S}),M(t)}),x=t=>I(t).then(()=>{}),b={channel:f,v:1},Ge=t=>{!D&&o.parent!==o&&M(t)},vt=()=>Ge({...b,type:"file-save"}),Rt=t=>{!po(t)||!Fo(t)||(t.preventDefault(),vt())},Ut=t=>{!po(t)||t.key!=="Escape"||d?.surface!=="popover"||!d.popover||(t.preventDefault(),Lt(d.popover.id,"escape").catch(()=>{}))},Ee=()=>{let t=d?.surface==="popover"?d.popover:void 0;if(!t)return;let r=se||ie;yt!==r&&(yt=r,Gt(t.id,r).catch(()=>{}))},_e=()=>{d?.surface!=="popover"||se||(se=!0,Ee())},It=t=>{d?.surface!=="popover"||t.relatedTarget!==null||!se||(se=!1,Ee())},Ct=()=>{d?.surface!=="popover"||ie||(ie=!0,Ee())},Mt=()=>{d?.surface!=="popover"||!ie||(ie=!1,Ee())},N=(t,r=1024)=>{if(!t.trim()||t.length>r)throw new a("HOST_REJECTED",`Identity must contain 1 to ${r} characters.`)},Ne=async t=>{t.kind!=="projects"&&N(t.projectId);let r=await I({...b,type:"workspace-read",id:u(p),payload:t});if(!r||!("kind"in r)||!("state"in r)||r.kind!==t.kind)throw new a("HOST_REJECTED","Host did not return workspace data.");return r},Pe=async(t,r)=>{t.kind!=="projects"&&N(t.projectId);let s=u(p);K.set(s,r);try{await x({...b,type:"workspace-subscribe",id:u(p),payload:{subscriptionId:s,query:t}})}catch(i){throw K.delete(s),D||M({...b,type:"workspace-unsubscribe",id:u(p),payload:{subscriptionId:s}}),i}return()=>{!K.delete(s)||D||M({...b,type:"workspace-unsubscribe",id:u(p),payload:{subscriptionId:s}})}},Mo=async(t,r)=>{t.kind==="session"&&N(t.sessionId),t.kind==="project"&&N(t.projectId);let s=u(p);W.set(s,r);try{await x({...b,type:"shells-subscribe",id:u(p),payload:{subscriptionId:s,scope:t}})}catch(i){throw W.delete(s),D||M({...b,type:"shells-unsubscribe",id:u(p),payload:{subscriptionId:s}}),i}return()=>{!W.delete(s)||D||M({...b,type:"shells-unsubscribe",id:u(p),payload:{subscriptionId:s}})}},me=async t=>{if("key"in t&&(t.key.length===0||t.key.length>128))throw new a("HOST_REJECTED","Storage key must contain 1 to 128 characters.");if(t.op==="set"&&!J(t.value))throw new a("HOST_REJECTED","Storage values must be JSON.");if(t.op==="set"&&new TextEncoder().encode(JSON.stringify(t.value)).length>65536)throw new a("HOST_REJECTED","Storage value exceeds 64 KiB.");if(t.scope==="device"&&d?.features?.deviceStorage!==!0)throw new a("UNSUPPORTED","This host does not support device storage.");let r=await I({...b,type:"storage",id:u(p),payload:t});if(!r||!("storage"in r)||r.op!==t.op)throw new a("HOST_REJECTED","Host did not return storage data.");return r},Lt=(t,r)=>d?.features?.popovers!==!0&&!(d?.surface==="popover"&&d.popover?.id===t)?Promise.reject(new a("UNSUPPORTED","This host does not support popovers.")):x({...b,type:"popover-close",id:u(p),payload:r?{id:t,reason:r}:{id:t}}),Gt=(t,r)=>d?.features?.popovers!==!0&&!(d?.surface==="popover"&&d.popover?.id===t)?Promise.reject(new a("UNSUPPORTED","This host does not support popovers.")):x({...b,type:"popover-anchor",id:u(p),payload:{id:t,active:r}});return o.addEventListener("keydown",Ut,!0),o.addEventListener("pointerover",_e),o.addEventListener("pointermove",_e),o.addEventListener("pointerout",It),o.addEventListener("focus",Ct),o.addEventListener("blur",Mt),{onAction:t=>(oe=t,()=>{oe===t&&(oe=null)}),listProjects:async()=>{let t=await Ne({kind:"projects"});if(t.kind!=="projects")throw new a("HOST_REJECTED","Expected projects.");return t},listWorktrees:async t=>{let r=await Ne({kind:"worktrees",projectId:t});if(r.kind!=="worktrees")throw new a("HOST_REJECTED","Expected worktrees.");return r},listSessions:async t=>{let r=await Ne({kind:"sessions",projectId:t});if(r.kind!=="sessions")throw new a("HOST_REJECTED","Expected sessions.");return r},onProjects:t=>Pe({kind:"projects"},r=>{r.kind==="projects"&&t(r)}),onWorktrees:(t,r)=>Pe({kind:"worktrees",projectId:t},s=>{s.kind==="worktrees"&&r(s)}),onSessions:(t,r)=>Pe({kind:"sessions",projectId:t},s=>{s.kind==="sessions"&&r(s)}),onRunningShells:(t,r)=>Mo(t,r),readShellOutput:async(t,r)=>{N(t,128);let s=r?.cursor;if(s!==void 0&&(!Number.isInteger(s)||s<0))throw new a("HOST_REJECTED","Shell output cursor must be a non-negative integer.");let i=r?.tailBytes;if(i!==void 0&&(!Number.isInteger(i)||i<1||i>65536))throw new a("HOST_REJECTED",`Shell output tailBytes must be an integer between 1 and ${65536}.`);let m=await I({...b,type:"shell-output",id:u(p),payload:{shellId:t,cursor:s,tailBytes:i}});if(!m||typeof m.output!="string"||!Number.isFinite(m.cursor))throw new a("HOST_REJECTED","Host did not return shell output.");return m},stopShell:async t=>{if(N(t,128),(await I({...b,type:"shell-stop",id:u(p),payload:{shellId:t}}))?.stopped!==!0)throw new a("HOST_REJECTED","Host did not stop the shell.");return{stopped:!0}},openSession:async t=>{N(t),await x({...b,type:"open-session",id:u(p),payload:{sessionId:t}})},storage:{get:async(t,r)=>{let s=we(r),i={op:"get",key:t};s&&(i.scope=s);let S=await me(i);return S.op==="get"&&S.found?S.value:void 0},set:async(t,r,s)=>{let i=we(s),S={op:"set",key:t,value:r};i&&(S.scope=i),await me(S)},delete:async(t,r)=>{let s=we(r),i={op:"delete",key:t};s&&(i.scope=s),await me(i)},keys:async t=>{let r=we(t),s={op:"keys"};r&&(s.scope=r);let i=await me(s);if(i.op!=="keys")throw new a("HOST_REJECTED","Expected storage keys.");return i.keys}},onReady:t=>(l.add(t),d&&t(d),()=>{l.delete(t)}),onDirectory:t=>(_.add(t),d&&t(d.directory),()=>{_.delete(t)}),onSession:t=>(y.add(t),d&&t(d.session),()=>{y.delete(t)}),onSessionLifecycle:t=>(O.add(t),H&&t(H),()=>{O.delete(t)}),onConnection:t=>(U.add(t),d&&t(d.connection),()=>{U.delete(t)}),onSettings:t=>(P.add(t),d&&t(d.settings),()=>{P.delete(t)}),onItem:t=>(ee.add(t),d&&t(d.item),()=>{ee.delete(t)}),onStatusControl:t=>(le.add(t),()=>{le.delete(t)}),onPopoverClosed:t=>(pe.add(t),()=>{pe.delete(t)}),setStatusControls:t=>d?.features?.statusControls!==!0?Promise.reject(new a("UNSUPPORTED","This host does not support status controls.")):$t(t)?x({...b,type:"status-controls",id:u(p),payload:{controls:t}}):Promise.reject(new a("HOST_REJECTED","Status controls must have unique bounded ids and valid selected options.")),openPopover:t=>d?.features?.popovers!==!0?Promise.reject(new a("UNSUPPORTED","This host does not support popovers.")):Be(t)?x({...b,type:"popover-open",id:u(p),payload:t}):Promise.reject(new a("HOST_REJECTED","Popover requests need bounded geometry and JSON data.")),closePopover:Lt,setPopoverAnchorActive:Gt,onResolve:t=>(te=t,()=>{te===t&&(te=null)}),toast:t=>{let r=t.message.trim();return!r||r.length>Te?Promise.reject(new a("HOST_REJECTED",`Toast message must contain 1 to ${Te} characters.`)):t.copy&&t.copy!==!0&&(!t.copy.text.length||t.copy.text.length>he)?Promise.reject(new a("HOST_REJECTED",`Toast copy text must contain 1 to ${he} characters.`)):x({channel:f,v:1,type:"toast",id:u(p),payload:{...t,message:r}})},openUrl:t=>x({channel:f,v:1,type:"open-url",id:u(p),payload:{url:t}}),openCommit:t=>Ke(t)?x({channel:f,v:1,type:"open-commit",id:u(p),payload:{sha:t}}):Promise.reject(new a("HOST_REJECTED","Commit id must be 7 to 64 hex characters.")),openSurface:t=>x({channel:f,v:1,type:"open-surface",id:u(p),payload:{surfaceId:t}}),writeClipboard:t=>x({channel:f,v:1,type:"clipboard-write",id:u(p),payload:{text:t}}),compose:t=>x({channel:f,v:1,type:"compose",id:u(p),payload:t}),attach:t=>x({channel:f,v:1,type:"attach",id:u(p),payload:Y(t)}),startSession:async t=>{t.projectId!==void 0&&N(t.projectId);let r=t.worktree;r&&r!==!0&&(r.kind==="existing"?N(r.directory):(r.name!==void 0&&N(r.name,200),r.baseBranch!==void 0&&N(r.baseBranch,200)));let s=await I({channel:f,v:1,type:"start-session",id:u(p),payload:Qe(t)},e.requestTimeoutMs??18e4);if(!je(s))throw new a("HOST_REJECTED","Host did not return a session.");return s},prompt:t=>I({channel:f,v:1,type:"prompt",id:u(p),payload:Ze(t)}).then(r=>{if(!ze(r))throw new a("HOST_REJECTED","Host did not return a prompt result.");return r}),sessionLink:t=>x({channel:f,v:1,type:"session-link",id:u(p),payload:Y(t)}),close:()=>x({channel:f,v:1,type:"close",id:u(p)}),oauthStart:()=>x({channel:f,v:1,type:"oauth-start",id:u(p)}),oauthDisconnect:()=>x({channel:f,v:1,type:"oauth-disconnect",id:u(p)}),request:t=>(Ae(t.path)?I({channel:f,v:1,type:"request",id:u(p),payload:t}):uo()).then(r=>{if(!ye(r))throw new a("HOST_REJECTED","Host request result was empty.");return r}),serviceRequest:t=>(Ae(t.path)?I({channel:f,v:1,type:"service-request",id:u(p),payload:t}):uo()).then(r=>{if(!ye(r))throw new a("HOST_REJECTED","Host service request result was empty.");return r}),serviceStatus:()=>I({channel:f,v:1,type:"service-status",id:u(p)}).then(t=>{if(!tt(t))throw new a("HOST_REJECTED","Host did not return service status.");return t}),readFile:t=>(Q(t)?I({channel:f,v:1,type:"file-read",id:u(p),payload:{path:t}}):Oe()).then(r=>{if(!ot(r))throw new a("HOST_REJECTED","Host did not return file content.");return r}),writeFile:(t,r)=>Q(t)?r.length>be?Promise.reject(new a("FILE_TOO_LARGE",`Content is over ${be} characters.`)):I({channel:f,v:1,type:"file-write",id:u(p),payload:{path:t,content:r}}).then(s=>{if(!rt(s))throw new a("HOST_REJECTED","Host did not confirm the write.");return s}):Oe(),listDir:t=>(Q(t)?I({channel:f,v:1,type:"file-list",id:u(p),payload:{path:t}}):Oe()).then(r=>{if(!nt(r))throw new a("HOST_REJECTED","Host did not return directory entries.");return r}),stat:t=>(Q(t)?I({channel:f,v:1,type:"file-stat",id:u(p),payload:{path:t}}):Oe()).then(r=>{if(!st(r))throw new a("HOST_REJECTED","Host did not return file status.");return r}),generate:t=>{let r=t.prompt.trim(),s=t.system?.trim();if(r.length===0||r.length>ke)return Promise.reject(new a("HOST_REJECTED",`Prompt must be 1 to ${ke} characters.`));if(s!==void 0&&(s.length===0||s.length>ge))return Promise.reject(new a("HOST_REJECTED",`System prompt must be 1 to ${ge} characters.`));let i=t.maxOutputTokens===void 0?void 0:Math.min(Je,Math.max(1,Math.floor(t.maxOutputTokens)));if(i!==void 0&&!Number.isFinite(i))return Promise.reject(new a("HOST_REJECTED","maxOutputTokens must be a number."));let S={prompt:r};return s!==void 0&&(S.system=s),i!==void 0&&(S.maxOutputTokens=i),I({channel:f,v:1,type:"generate",id:u(p),payload:S},e.requestTimeoutMs??Ye).then(m=>{if(!it(m))throw new a("HOST_REJECTED","Host did not return generated text.");return m})},setBadge:t=>x({channel:f,v:1,type:"badge",id:u(p),payload:{count:qe(t)}}),setHeight:t=>x({channel:f,v:1,type:"resize",id:u(p),payload:{height:et(t)}}),onFileOpen:t=>(ue.add(t),Le||(Le=!0,o.addEventListener("keydown",Rt,!0)),ne&&t(ne),()=>{ue.delete(t)}),onFileSnapshot:t=>(re=t,()=>{re===t&&(re=null)}),onFileSaved:t=>(fe.add(t),()=>{fe.delete(t)}),reportFileChange:t=>Ge({...b,type:"file-change",payload:{dirty:t.dirty,edited:t.edited}}),requestFileSave:vt,reportFileUnsupported:()=>Ge({...b,type:"file-unsupported"}),dispose:()=>{for(let t of K.keys())M({...b,type:"workspace-unsubscribe",id:u(p),payload:{subscriptionId:t}});K.clear();for(let t of W.keys())M({...b,type:"shells-unsubscribe",id:u(p),payload:{subscriptionId:t}});W.clear(),D=!0,te=null,oe=null,re=null,ue.clear(),fe.clear(),Le&&o.removeEventListener("keydown",Rt,!0),o.removeEventListener("message",wt),o.removeEventListener("keydown",Ut,!0),o.removeEventListener("pointerover",_e),o.removeEventListener("pointermove",_e),o.removeEventListener("pointerout",It),o.removeEventListener("focus",Ct),o.removeEventListener("blur",Mt);for(let t of z.values())clearTimeout(t.timer),t.reject(new a("HOST_UNAVAILABLE","Host client was disposed."));z.clear(),l.clear(),_.clear(),y.clear(),O.clear(),U.clear(),P.clear(),ee.clear(),le.clear(),pe.clear()}}};var _o=["browser.open","browser.snapshot","browser.click","browser.type","browser.scroll","browser.back","browser.forward","browser.inspect","browser.capture","browser.resize"];var vr=new Set(_o);var mo=["none","agent","user"];var Ur=new Set(mo);var Xo=[["--oc-bg","background"],["--oc-elevated","elevated"],["--oc-fg","foreground"],["--oc-muted","muted"],["--oc-subtle","subtle"],["--oc-border","border"],["--oc-hover","hover"],["--oc-selection","selection"],["--oc-focus","focus"],["--oc-primary","primary"],["--oc-muted-surface","mutedSurface"],["--oc-elevated-fg","elevatedForeground"],["--oc-active","active"],["--oc-selection-fg","selectionForeground"],["--oc-primary-fg","primaryForeground"],["--oc-primary-text","primaryText"],["--oc-success-text","successText"],["--oc-warning-text","warningText"],["--oc-error-text","errorText"],["--oc-info-text","infoText"],["--oc-success","success"],["--oc-warning","warning"],["--oc-error","error"],["--oc-info","info"],["--oc-font","font"],["--oc-mono","mono"],["--oc-radius","radius"],["--surface-background","background"],["--surface-elevated","elevated"],["--surface-foreground","foreground"],["--surface-muted-foreground","muted"],["--surface-subtle","subtle"],["--interactive-border","border"],["--interactive-hover","hover"],["--interactive-selection","selection"],["--interactive-focus-ring","focus"],["--primary","primary"],["--surface-muted","mutedSurface"],["--surface-elevated-foreground","elevatedForeground"],["--interactive-active","active"],["--interactive-selection-foreground","selectionForeground"],["--primary-foreground","primaryForeground"],["--primary-text","primaryText"],["--success-text","successText"],["--warning-text","warningText"],["--error-text","errorText"],["--info-text","infoText"],["--status-success","success"],["--status-warning","warning"],["--status-error","error"],["--status-info","info"],["--font-sans","font"],["--font-mono","mono"],["--radius","radius"]],Bo=[["--oc-syntax-keyword","--syntax-keyword","syntaxKeyword"],["--oc-syntax-string","--syntax-string","syntaxString"],["--oc-syntax-number","--syntax-number","syntaxNumber"],["--oc-syntax-function","--syntax-function","syntaxFunction"],["--oc-syntax-type","--syntax-type","syntaxType"],["--oc-syntax-comment","--syntax-comment","syntaxComment"],["--oc-syntax-variable","--syntax-variable","syntaxVariable"],["--oc-syntax-operator","--syntax-operator","syntaxOperator"]],So=(e,o)=>{o.style.colorScheme=e.mode;for(let[n,c]of Xo)o.style.setProperty(n,e.tokens[c]);for(let[n,c,l]of Bo){let _=e.tokens[l]??"";o.style.setProperty(n,_),o.style.setProperty(c,_)}o.style.setProperty("font-family",e.tokens.font),o.style.setProperty("font-size","0.875rem"),o.style.setProperty("line-height","1.45"),o.style.setProperty("color",e.tokens.foreground)},ft=(e,o)=>{So(e.theme,o),o.dataset&&(o.dataset.ocSurface=e.surface,o.dataset.ocTheme=e.theme.mode)};var Vo={"surface-background":"bg","surface-elevated":"elevated","surface-elevated-foreground":"elevated-fg","surface-foreground":"fg","surface-muted-foreground":"muted","surface-muted":"muted-surface","surface-subtle":"subtle","interactive-border":"border","interactive-hover":"hover","interactive-active":"active","interactive-selection":"selection","interactive-selection-foreground":"selection-fg","interactive-focus-ring":"focus",primary:"primary","primary-foreground":"primary-fg","primary-text":"primary-text","success-text":"success-text","warning-text":"warning-text","error-text":"error-text","info-text":"info-text","status-success":"success","status-warning":"warning","status-error":"error","status-info":"info","font-sans":"font","font-mono":"mono",radius:"radius"},T=(e,o)=>`var(--${e}, var(--oc-${Vo[e]}, ${o}))`,B=T("surface-background","transparent"),ve=T("surface-elevated","transparent"),ce=T("surface-elevated-foreground","inherit"),F=T("surface-foreground","inherit"),h=T("surface-muted-foreground","gray"),jo=T("surface-muted","transparent"),L=T("interactive-border","currentColor"),C=T("interactive-hover","transparent"),V=T("interactive-active","transparent"),Et=T("interactive-selection","transparent"),_t=T("interactive-selection-foreground","inherit"),xo=T("interactive-focus-ring","currentColor"),$=T("primary","currentColor"),mt=T("primary-text","inherit"),St=T("error-text","inherit"),zo=T("font-sans","inherit"),Tt=T("font-mono","monospace"),bo=T("radius","9px"),ht=`calc(${bo} - 2px)`,To=`calc(${bo} - 4px)`,A=(e,o,n="transparent")=>`color-mix(in srgb, ${e} ${o}%, ${n})`,ho=`box-shadow: 0 0 0 2px ${xo};`,Re=e=>{let o=T(`status-${e}`,"currentColor");return`
.oc-sdk[data-tone="${e}"], .oc-sdk [data-tone="${e}"] { --oc-sdk-tone: ${o}; --oc-sdk-tone-text: ${T(`${e}-text`,"inherit")}; }`},Ko=`
.oc-sdk { box-sizing: border-box; font-size: 0.875rem; line-height: 1.45; }
.oc-sdk *, .oc-sdk *::before, .oc-sdk *::after { box-sizing: border-box; }
/* :where() keeps the reset at zero specificity so every primitive class below overrides it. */
:where(.oc-sdk) :where(button, input, textarea), :where(button.oc-sdk, input.oc-sdk, textarea.oc-sdk) { font: inherit; color: inherit; margin: 0; }
:where(.oc-sdk) :where(button), :where(button.oc-sdk) { cursor: pointer; background: none; border: 0; padding: 0; }
.oc-sdk button:disabled, button.oc-sdk:disabled, .oc-sdk[aria-disabled="true"], .oc-sdk [aria-disabled="true"] { opacity: .5; pointer-events: none; }

.oc-sdk-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 32px; padding: 0 12px; border: 1px solid transparent; font-size: 0.875rem; font-weight: 500; line-height: 1; white-space: nowrap; }
.oc-sdk-btn[data-size="sm"] { gap: 6px; height: 28px; padding: 0 10px; font-size: 0.8125rem; }
.oc-sdk-btn[data-size="xs"] { gap: 4px; height: 24px; padding: 0 8px; font-size: 0.75rem; }
.oc-sdk-btn[data-loading="true"] { opacity: .5; pointer-events: none; }
.oc-sdk-btn > .oc-sdk-spinner-ring { width: 14px; height: 14px; }

.oc-sdk-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-field-label { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-field-note { font-size: 0.75rem; }
.oc-sdk-input { display: block; width: 100%; min-width: 0; height: 32px; padding: 0 10px; border: 0; font-size: 0.875rem; line-height: 1.45; appearance: none; }
textarea.oc-sdk-input { height: auto; padding: 8px 10px; resize: vertical; }

.oc-sdk-search { position: relative; min-width: 0; }
.oc-sdk-search .oc-sdk-input { padding-left: 34px; padding-right: 34px; }
.oc-sdk-search-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); pointer-events: none; }
.oc-sdk-search-clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); display: none; align-items: center; justify-content: center; width: 24px; height: 24px; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-clear { display: inline-flex; }

.oc-sdk-select { position: relative; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-trigger { display: inline-flex; align-items: center; gap: 6px; width: 100%; min-width: 0; height: 28px; padding: 0 10px; border: 1px solid transparent; font-size: 0.8125rem; text-align: left; }
.oc-sdk-trigger-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-trigger-chevron { flex: 0 0 auto; }
.oc-sdk-popup { position: fixed; z-index: 50; display: flex; flex-direction: column; gap: 2px; min-width: 160px; max-width: calc(100vw - 16px); max-height: min(320px, calc(100vh - 16px)); overflow: auto; padding: 4px; border: 1px solid transparent; }
.oc-sdk-popup-search { flex: 0 0 auto; padding: 2px 2px 4px; }
.oc-sdk-popup-search .oc-sdk-input { height: 28px; font-size: 0.8125rem; }
.oc-sdk-option { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; font-size: 0.8125rem; text-align: left; }
.oc-sdk-option-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-option-hint { flex: 0 0 auto; font-size: 0.75rem; }
.oc-sdk-option-check { flex: 0 0 auto; display: inline-flex; width: 14px; visibility: hidden; }
.oc-sdk-option[aria-selected="true"] > .oc-sdk-option-check { visibility: visible; }
.oc-sdk-popup-empty { padding: 8px; font-size: 0.8125rem; }

.oc-sdk-check { display: inline-flex; align-items: flex-start; gap: 8px; width: 100%; text-align: left; }
.oc-sdk-check-box { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; margin-top: 3px; border: 1px solid transparent; }
.oc-sdk-check-box > svg { display: none; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box > svg { display: block; }
.oc-sdk-check-thumb { flex: 0 0 auto; position: relative; width: 36px; height: 20px; }
.oc-sdk-check-thumb::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; }
.oc-sdk-check-text { display: flex; flex-direction: column; min-width: 0; }
.oc-sdk-check-label { font-size: 0.875rem; }
.oc-sdk-check-desc { font-size: 0.75rem; }

.oc-sdk-tabs { display: inline-flex; gap: 2px; padding: 2px; max-width: 100%; overflow: auto; }
.oc-sdk-tab { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid transparent; font-size: 0.8125rem; font-weight: 500; white-space: nowrap; }
.oc-sdk-tab-count { font-size: 0.75rem; font-variant-numeric: tabular-nums; }

.oc-sdk-badge { display: inline-flex; align-items: center; padding: 1px 6px; font-size: 11px; font-weight: 500; line-height: 16px; white-space: nowrap; }

.oc-sdk-list { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.oc-sdk-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; text-align: left; }
.oc-sdk-row-lead { flex: 0 0 auto; width: 64px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.oc-sdk-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-meta { flex: 0 0 auto; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-list-empty { padding: 16px 8px; text-align: center; font-size: 0.8125rem; }

.oc-sdk-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 40px 16px; text-align: center; }
.oc-sdk-empty-title { margin: 0; font-size: 0.8125rem; font-weight: 600; }
.oc-sdk-empty-body { margin: 0; max-width: 32rem; font-size: 0.8125rem; }
.oc-sdk-empty-action { margin-top: 12px; }

@keyframes oc-sdk-spin { to { transform: rotate(360deg); } }
.oc-sdk-spinner { display: inline-flex; align-items: center; gap: 8px; font-size: 0.8125rem; }
.oc-sdk-spinner-ring { width: 16px; height: 16px; border: 2px solid transparent; animation: oc-sdk-spin .8s linear infinite; }
.oc-sdk-spinner[data-size="sm"] .oc-sdk-spinner-ring { width: 12px; height: 12px; }

.oc-sdk-banner { display: flex; align-items: flex-start; gap: 12px; padding: 8px 12px; border: 1px solid transparent; }
.oc-sdk-banner-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.oc-sdk-banner-title { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-banner-body { font-size: 0.8125rem; }
.oc-sdk-banner-action { flex: 0 0 auto; }

.oc-sdk-separator { display: flex; align-items: center; gap: 8px; width: 100%; margin: 8px 0; font-size: 0.75rem; }
.oc-sdk-separator::before, .oc-sdk-separator::after { content: ""; flex: 1 1 auto; height: 1px; }
.oc-sdk-separator[data-labeled="false"]::after { display: none; }
.oc-sdk-popup > .oc-sdk-separator { margin: 4px 0; }

.oc-sdk-progress { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-progress-label { display: flex; justify-content: space-between; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-progress-track { height: 6px; overflow: hidden; }
.oc-sdk-progress-fill { height: 100%; transform-origin: left; transition: transform 200ms ease-out; }

.oc-sdk-menu { position: relative; display: inline-flex; }

.oc-sdk-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.oc-sdk-text img { display: block; max-width: 100%; margin: 8px 0; }
`,ko=`
.oc-sdk { color: ${F}; font-family: ${zo}; }
.oc-sdk :focus-visible { outline: none; ${ho} }
.oc-sdk-mono { font-family: ${Tt}; }
.oc-sdk-muted { color: ${h}; }
${Re("success")}${Re("warning")}${Re("error")}${Re("info")}
.oc-sdk[data-tone="primary"], .oc-sdk [data-tone="primary"] { --oc-sdk-tone: ${$}; --oc-sdk-tone-text: ${mt}; }

.oc-sdk-btn { border-radius: ${ht}; transition: background 150ms ease-out, color 150ms ease-out; }
.oc-sdk-btn[data-size="xs"] { border-radius: ${To}; }
.oc-sdk-btn[data-variant="default"] { color: ${mt}; background: ${A($,10,B)}; border-color: ${A($,12)}; }
.oc-sdk-btn[data-variant="default"]:hover { background: ${A($,16,B)}; }
.oc-sdk-btn[data-variant="default"]:active { background: ${A($,22,B)}; }
.oc-sdk-btn[data-variant="secondary"] { background: ${jo}; color: var(--oc-fg); }
.oc-sdk-btn[data-variant="secondary"]:hover { background-image: linear-gradient(${C}, ${C}); }
.oc-sdk-btn[data-variant="secondary"]:active { background-image: linear-gradient(${V}, ${V}); }
.oc-sdk-btn[data-variant="outline"] { background: ${ve}; color: ${ce}; border-color: ${L}; }
.oc-sdk-btn[data-variant="outline"]:hover { background-image: linear-gradient(${C}, ${C}); }
.oc-sdk-btn[data-variant="outline"]:active { background-image: linear-gradient(${V}, ${V}); }
.oc-sdk-btn[data-variant="ghost"] { background: transparent; }
.oc-sdk-btn[data-variant="ghost"]:hover { background: ${C}; }
.oc-sdk-btn[data-variant="ghost"]:active { background: ${V}; }
.oc-sdk-btn[data-variant="destructive"] { --oc-sdk-tone: ${T("status-error","red")}; color: ${St}; background: ${A("var(--oc-sdk-tone)",7,B)}; border-color: ${A("var(--oc-sdk-tone)",12)}; }
.oc-sdk-btn[data-variant="destructive"]:hover { background: ${A("var(--oc-sdk-tone)",9,B)}; }
.oc-sdk-btn[data-variant="destructive"]:active { background: ${A("var(--oc-sdk-tone)",11,B)}; }

.oc-sdk-field-note { color: ${h}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-field-note { color: ${St}; }
.oc-sdk-input { border-radius: ${ht}; background: ${ve}; color: ${ce}; box-shadow: inset 0 0 0 1px ${A(L,60)}; transition: background 150ms ease-out, box-shadow 150ms ease-out; }
.oc-sdk-input::placeholder { color: ${h}; }
.oc-sdk-input:hover:not(:focus) { background-image: linear-gradient(${C}, ${C}); }
.oc-sdk-input:focus, .oc-sdk-input:focus-visible { box-shadow: inset 0 0 0 2px ${xo}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input { box-shadow: inset 0 0 0 1px ${T("status-error","red")}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input:focus { box-shadow: inset 0 0 0 2px ${T("status-error","red")}; }
.oc-sdk-input[data-mono="true"] { font-family: ${Tt}; }

.oc-sdk-search-icon { color: ${h}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-icon { color: ${$}; }
.oc-sdk-search-clear { border-radius: ${To}; color: ${h}; }
.oc-sdk-search-clear:hover { background: ${C}; color: ${F}; }

.oc-sdk-trigger { border-color: ${L}; border-radius: ${ht}; background: ${ve}; color: ${ce}; transition: background 150ms ease-out; }
.oc-sdk-trigger:hover { background-image: linear-gradient(${C}, ${C}); }
.oc-sdk-trigger[aria-expanded="true"] { background-image: linear-gradient(${V}, ${V}); }
.oc-sdk-trigger-value[data-empty="true"] { color: ${h}; }
.oc-sdk-trigger-chevron { color: ${h}; }
.oc-sdk-popup { --surface-foreground: ${ce}; border-color: ${A(L,60)}; border-radius: 12px; background: ${ve}; color: ${ce}; box-shadow: 0 8px 24px ${A(F,12)}; }
.oc-sdk-option { border-radius: 8px; }
.oc-sdk-option[data-active="true"] { background: ${C}; }
/* A selected option shows a check mark in the text colour, like the app's own pickers. Options without the mark come
   from bundles built before it existed and keep the selection fill as their only sign of the choice. */
.oc-sdk-option[aria-selected="true"]:not([data-mark]) { background: ${Et}; color: ${_t}; }
.oc-sdk-option-check { color: ${F}; }
.oc-sdk-option[data-destructive="true"] { color: ${St}; }
.oc-sdk-option[data-destructive="true"][data-active="true"] { background: ${A(T("status-error","red"),10)}; }
.oc-sdk-option-hint { color: ${h}; }
.oc-sdk-popup-empty { color: ${h}; }

/* Checked stays neutral: the mark carries the state, and the primary colour stays with primary actions. */
.oc-sdk-check-box { border-color: ${L}; border-radius: 4px; color: ${F}; transition: border-color 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box { border-color: ${A(F,60,L)}; }
.oc-sdk-check-thumb { border-radius: 9999px; background: ${L}; transition: background 150ms ease-out; }
.oc-sdk-check-thumb::after { border-radius: 9999px; background: ${B}; transition: transform 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb { background: ${$}; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb::after { transform: translateX(16px); }
.oc-sdk-check:focus-visible { box-shadow: none; }
.oc-sdk-check:focus-visible .oc-sdk-check-box, .oc-sdk-check:focus-visible .oc-sdk-check-thumb { ${ho} }
.oc-sdk-check-desc { color: ${h}; }

.oc-sdk-tabs { border-radius: 10px; }
.oc-sdk-tabs[data-track="true"] { background: ${A(F,4)}; }
.oc-sdk-tab { border-radius: 8px; color: ${h}; transition: color 150ms ease-out, background 150ms ease-out; }
.oc-sdk-tab:hover { color: ${F}; }
.oc-sdk-tab[aria-selected="true"] { color: ${_t}; background: ${Et}; border-color: ${L}; }
.oc-sdk-tab-count { color: ${h}; }

.oc-sdk-badge { border-radius: 9999px; background: ${C}; color: ${h}; }
.oc-sdk-badge[data-tone] { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); background: ${A("var(--oc-sdk-tone)",15)}; }

.oc-sdk-row { border-radius: 6px; transition: background 120ms ease-out; }
.oc-sdk-row:hover, .oc-sdk-row[data-active="true"] { background: ${C}; }
.oc-sdk-row[aria-selected="true"] { background: ${Et}; color: ${_t}; }
.oc-sdk-row-lead { font-family: ${Tt}; color: ${h}; }
.oc-sdk-row-sub { color: ${h}; }
.oc-sdk-row-meta { color: ${h}; }
.oc-sdk-row[aria-selected="true"] .oc-sdk-row-lead, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-sub, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-meta { color: inherit; opacity: .75; }
.oc-sdk-list-empty { color: ${h}; }

.oc-sdk-empty-body { color: ${h}; }

.oc-sdk-spinner { color: ${h}; }
.oc-sdk-spinner-ring { border-color: ${L}; border-top-color: ${$}; border-radius: 9999px; }

.oc-sdk-banner { border-color: ${A("var(--oc-sdk-tone)",40)}; border-radius: 8px; background: ${A("var(--oc-sdk-tone)",10)}; }
.oc-sdk-banner-title { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); }
.oc-sdk-banner-body { color: ${h}; }

.oc-sdk-separator { color: ${h}; }
.oc-sdk-separator::before, .oc-sdk-separator::after { background: ${A(L,40)}; }

.oc-sdk-progress-label { color: ${h}; }
.oc-sdk-progress-track { border-radius: 9999px; background: ${L}; }
.oc-sdk-progress-fill { border-radius: 9999px; background: var(--oc-sdk-tone, ${$}); }

.oc-sdk-text a { color: ${mt}; text-decoration: underline; text-underline-offset: 2px; }
.oc-sdk-text img { border-radius: 8px; border: 1px solid ${A(L,60)}; }
`,w=`
${De}
${Ko}
${ko}`;var go="oc-sdk-ui-style";var v=e=>{let o=document.getElementById(go);if(o instanceof HTMLStyleElement){o.textContent!==e&&(o.textContent=e);return}He(document);let n=document.createElement("style");n.id=go,n.textContent=e,document.head.appendChild(n)},R=(e,o)=>{let n=document.createElement(e);return o&&(n.className=o),n},X=e=>{let o=R("button",e);return o.type="button",o},G=(e,o)=>{let n=o??"";e.textContent!==n&&(e.textContent=n)},Z=(e,o,n)=>{n==null||n===""?e.removeAttribute(o):e.getAttribute(o)!==n&&e.setAttribute(o,n)};var Wo=()=>{let e=document.createElement("span");return e.className="oc-sdk-spinner-ring",e.setAttribute("aria-hidden","true"),e},q=(e,o)=>{v(w);let n=o,c=X("oc-sdk oc-sdk-btn"),l=Wo(),_=document.createElement("span");c.append(_),e.append(c);let y=()=>{c.dataset.variant=n.variant??"default",c.dataset.size=n.size??"default",c.disabled=!!n.disabled||!!n.loading,c.dataset.loading=n.loading?"true":"false",c.setAttribute("aria-busy",n.loading?"true":"false"),n.loading&&l.parentNode!==c?c.prepend(l):!n.loading&&l.parentNode===c&&l.remove(),G(_,n.label)},O=()=>{n.disabled||n.loading||n.onClick()};return c.addEventListener("click",O),y(),{update:U=>{n={...n,...U},y()},dispose:()=>{c.removeEventListener("click",O),c.remove()}}};var bt=(e,o)=>{Z(e,"data-tone",o&&o!=="neutral"?o:null)},kt=(e,o)=>{v(w);let n=o,c=R("span","oc-sdk oc-sdk-badge");e.append(c);let l=()=>{G(c,n.label),bt(c,n.tone)};return l(),{update:_=>{n={...n,..._},l()},dispose:()=>{c.remove()}}};var Zo=["backlog","todo","in_progress","review","done"];var Ao=1,yo=200,Oo=16e3;var qo=512,er=/^t_[a-z0-9]{6,40}$/,tr=e=>typeof e=="string"&&Zo.includes(e);var de=(e,o)=>{if(e==null)return null;if(typeof e!="string")throw new Error(`${o} must be a string`);let n=e.trim();if(!n)return null;if(n.length>qo)throw new Error(`${o} is too long`);return n},or=e=>{if(typeof e!="string")throw new Error("Title must be text");let o=e.trim();if(!o)throw new Error("A task needs a title");if(o.length>yo)throw new Error(`Title is limited to ${yo} characters`);return o},rr=e=>{if(e==null)return"";if(typeof e!="string")throw new Error("Description must be text");if(e.length>Oo)throw new Error(`Description is limited to ${Oo} characters`);return e},nr=e=>{if(e==null)return null;if(typeof e!="object")throw new Error("worktree must be an object");let o=e,n=de(o.directory,"worktree.directory");if(!n)throw new Error("worktree.directory is required");return{directory:n,branch:de(o.branch,"worktree.branch")}},gt=(e,o)=>{if(typeof e!="number"||!Number.isFinite(e)||e<0)throw new Error(`${o} must be a timestamp`);return e},sr=(e,o)=>e==null?null:gt(e,o);var wo=e=>{if(!e||typeof e!="object"||Array.isArray(e))throw new Error("Task record is not an object");let o=e;if(o.schemaVersion!==Ao)throw new Error(`Unsupported task schema ${String(o.schemaVersion)}`);if(typeof o.id!="string"||!er.test(o.id))throw new Error("Task id is invalid");if(!tr(o.status))throw new Error("Task status is invalid");if(typeof o.rank!="number"||!Number.isFinite(o.rank))throw new Error("Task rank is invalid");return{schemaVersion:Ao,id:o.id,title:or(o.title),description:rr(o.description),status:o.status,rank:o.rank,projectId:de(o.projectId,"projectId"),sourceBranch:de(o.sourceBranch,"sourceBranch"),worktree:nr(o.worktree),sessionId:de(o.sessionId,"sessionId"),createdAt:gt(o.createdAt,"createdAt"),updatedAt:gt(o.updatedAt,"updatedAt"),needsAttentionSince:sr(o.needsAttentionSince,"needsAttentionSince")}};var Ro="task:",vo=16,ir=e=>`${Ro}${e}`,Uo=async e=>{let o=(await e.storage.keys()).filter(l=>l.startsWith(Ro)),n=[],c=[];for(let l=0;l<o.length;l+=vo)await Promise.all(o.slice(l,l+vo).map(async _=>{try{let y=wo(await e.storage.get(_));if(ir(y.id)!==_)throw new Error("Task id does not match its key");n.push(y)}catch{c.push(_)}}));return{tasks:n,failedKeys:c}};var ar=`
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--oc-bg);color:var(--oc-fg);font-family:var(--oc-font);font-size:14px;line-height:1.45}
#root{min-height:100%}
.kb-page{display:flex;flex-direction:column;gap:14px;padding:16px;min-height:100%}
.kb-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.kb-toolbar .grow{flex:1;min-width:160px}
.kb-columns{display:flex;gap:12px;align-items:flex-start;overflow-x:auto;padding-bottom:8px;flex:1}
.kb-column{flex:1 0 220px;min-width:220px;max-width:320px;display:flex;flex-direction:column;background:var(--oc-muted-surface);border:1px solid var(--oc-border);border-radius:var(--oc-radius,10px);min-height:120px}
.kb-column.kb-dragover{outline:2px solid var(--oc-focus);outline-offset:-2px}
.kb-column-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--oc-border)}
.kb-column-title{font-weight:600;font-size:12px;letter-spacing:.02em;text-transform:uppercase;color:var(--oc-muted)}
.kb-column-count{font:11px var(--oc-mono);color:var(--oc-muted)}
.kb-column-body{display:flex;flex-direction:column;gap:8px;padding:10px;overflow-y:auto;flex:1;min-height:40px}
.kb-column-empty{font-size:12px;color:var(--oc-muted);padding:8px 2px}
.kb-card{background:var(--oc-elevated);color:var(--oc-elevated-fg);border:1px solid var(--oc-border);border-radius:9px;padding:10px;cursor:pointer;display:flex;flex-direction:column;gap:6px}
.kb-cockpit input[type=email],.kb-cockpit select{font:inherit;color:var(--oc-fg);background:var(--oc-elevated);border:1px solid var(--oc-border);border-radius:6px;padding:6px;max-width:100%}
.kb-cockpit input[type=checkbox]{accent-color:var(--oc-primary)}
.kb-harness-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr));gap:12px}
.kb-harness-card{cursor:default;min-width:0}
.kb-harness-path{font:11px var(--oc-mono);overflow-wrap:anywhere}
.kb-card:hover{border-color:var(--oc-hover)}
.kb-card.kb-dragging{opacity:.4}
.kb-card.kb-card-needs-attention{border-color:var(--oc-warning);border-left-width:3px}
.kb-card.kb-card-needs-attention:hover{border-color:var(--oc-warning)}
.kb-card-title{font-weight:550;font-size:13px;overflow-wrap:anywhere}
.kb-card-meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.kb-card-ref{font:11px var(--oc-mono);color:var(--oc-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.kb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:24px;z-index:50}
.kb-dialog{background:var(--oc-bg);color:var(--oc-fg);border:1px solid var(--oc-border);border-radius:12px;max-width:640px;width:100%;max-height:88vh;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:14px}
.kb-dialog h2{margin:0;font-size:18px;letter-spacing:-.01em}
.kb-dialog-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.kb-dialog-grid .kb-span2{grid-column:1/-1}
.kb-section{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--oc-border);padding-top:12px}
.kb-section-title{font-size:12px;font-weight:600;color:var(--oc-muted);text-transform:uppercase;letter-spacing:.02em}
.kb-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kb-row.between{justify-content:space-between}
.kb-muted{color:var(--oc-muted);font-size:12px}
.kb-mono{font:12px var(--oc-mono);color:var(--oc-muted)}
.kb-empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:48px 16px;color:var(--oc-muted);text-align:center}
.kb-radio-group{display:flex;flex-direction:column;gap:10px}
.kb-radio-option{display:flex;gap:10px;align-items:flex-start;cursor:pointer}
.kb-radio-option input{margin-top:3px;accent-color:var(--oc-primary)}
.kb-radio-title{font-weight:550;font-size:13px}
.kb-radio-desc{font-size:12px;color:var(--oc-muted);margin-top:2px}
.kb-banner{display:none}
.kb-banner[data-show]{display:block}
[hidden]{display:none!important}
`,Io=()=>{if(document.getElementById("kb-style"))return;let e=document.createElement("style");e.id="kb-style",e.textContent=ar,document.head.append(e)};var j=(e,o="",n="")=>{let c=document.createElement(e);return o&&(c.className=o),n&&(c.textContent=n),c};var Me=ut(),At=document.querySelector("#root");if(!At)throw new Error("Missing #root");var Co=!1;Me.onReady(e=>{if(ft(e,document.documentElement),Co)return;Co=!0,Io(),At.replaceChildren();let o=j("div","kb-page"),n=j("p","","Loading\u2026"),c=j("div","kb-row between");c.append(j("h2","","Kanban"));let l=j("span");c.append(l),o.append(c,n),o.append(j("p","kb-muted","Open the full board from the Extension pages menu above the session list to view, edit, and link tasks.")),At.append(o);let _=kt(l,{label:"0",tone:"neutral"});q(o,{label:"Refresh counts",variant:"ghost",onClick:()=>{y()}});let y=async()=>{let{tasks:O}=await Uo(Me),U=O.filter(P=>P.status!=="done").length;n.textContent=`${U} open task${U===1?"":"s"} of ${O.length} total.`,_.update({label:String(U)}),Me.setBadge(U||null).catch(()=>{})};y()});window.addEventListener("pagehide",()=>Me.dispose());})();
