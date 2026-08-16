'use strict';
/* =====================================================================
   FlowPy — editor UI
   ===================================================================== */
const cwrap=$('#cwrap'), world=$('#world'), nodesL=$('#nodes'), wireg=$('#wireg');
let cam={x:60,y:60,z:1};
let view={stack:[]};                 // [{typeId, path}]
let sel={nodes:new Set(), wires:new Set()};
let LIVE={};                          // slotKey -> value (current graph path)
let RANGE={};                         // slotKey -> {lo,hi}
let showVals=true;

/* ---------- hover value tooltip (wires, input ports, input labels) ------ */
const valTip=el('div',{id:'valtip'});
document.body.append(valTip);
function hookValueHover(elm,keyFn){
  elm.addEventListener('mousemove',e=>{
    const key=keyFn();
    if(key==null||!(key in LIVE)){ valTip.style.display='none'; return; }
    valTip.textContent=fmt(LIVE[key]);
    valTip.style.left=(e.clientX+14)+'px'; valTip.style.top=(e.clientY-10)+'px';
    valTip.style.display='block';
  });
  elm.addEventListener('mouseleave',()=>{ valTip.style.display='none'; });
}
function inputKeyFn(nodeId,idx){
  return ()=>{ const g=G(); const w=g.wires.find(x=>x.t[0]===nodeId&&x.t[1]===idx);
    return w? slotKey(w.f[0],w.f[1]) : null; };
}

const curType = ()=> view.stack.length? P_.types[view.stack[view.stack.length-1].typeId] : null;
const curPath = ()=> view.stack.length? view.stack[view.stack.length-1].path : '';
const G = ()=> { const t=curType(); return t? (t.graph||(t.graph={nodes:[],wires:[]})) : P_.main; };
const nodeById = id => G().nodes.find(n=>n.id===id);

function applyCam(){ world.style.transform=`translate(${cam.x}px,${cam.y}px) scale(${cam.z})`;
  const g=GRID*cam.z;
  cwrap.style.backgroundSize=g+'px '+g+'px, auto';
  cwrap.style.backgroundPosition=cam.x+'px '+cam.y+'px, 0 0'; }
function toGraph(cx,cy){ const r=cwrap.getBoundingClientRect();
  return {x:(cx-r.left-cam.x)/cam.z, y:(cy-r.top-cam.y)/cam.z}; }

/* ---------- palette ---------------------------------------------- */
function renderPalette(){
  const pal=$('#pal'); pal.innerHTML='';
  const groups={};
  for(const t of Object.values(allTypes())){ const g=t.builtin?(t.group||'Misc'):'User blocks';
    (groups[g]=groups[g]||[]).push(t); }
  const order=['User blocks','Logic','Math','Time','I/O','Debug','Misc'];
  // special nodes
  const sg=el('div',{cls:'palgroup'},el('div',{cls:'t'},'Basics'));
  sg.append(palItem({name:'CONST',kind:'K'},'const'));
  sg.append(palItem({name:'VARIABLE',kind:'V'},'var'));
  pal.append(sg);
  for(const g of order){ if(!groups[g]) continue;
    const d=el('div',{cls:'palgroup'},el('div',{cls:'t'},g));
    for(const t of groups[g].sort((a,b)=>a.name.localeCompare(b.name))) d.append(palItem(t,'blk'));
    pal.append(d); }
}
function palItem(t,kind){
  const it=el('div',{cls:'palitem'},
    el('span',{cls:'k '+(t.kind||'')},t.kind||'·'),
    el('span',{cls:'n'},t.name));
  if(kind==='blk'&&!t.builtin) it.append(el('span',{cls:'e',title:'edit type',
    onclick:e=>{e.stopPropagation();openType(t.id);}},'✎'));
  it.addEventListener('mousedown',e=>{ e.preventDefault(); startPaletteDrag(e,kind,t); });
  return it;
}
let ghostDrag=null;
function startPaletteDrag(e,kind,t){
  const g=$('#ghost'); g.innerHTML=`<div class="node ${kind==='blk'?('k-'+t.kind):(kind==='const'?'k-const':'k-var')}" style="width:130px">
    <div class="hd"><span class="ttl">${t.name}</span></div><div class="body" style="height:26px"></div></div>`;
  g.style.display='block'; ghostDrag={kind,t};
  const mv=ev=>{g.style.left=(ev.clientX-20)+'px'; g.style.top=(ev.clientY-12)+'px';};
  const up=ev=>{ document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up);
    g.style.display='none';
    const r=cwrap.getBoundingClientRect();
    if(ev.clientX>r.left&&ev.clientX<r.right&&ev.clientY>r.top&&ev.clientY<r.bottom){
      const p=toGraph(ev.clientX-20,ev.clientY-12); addNode(kind,t,p.x,p.y); }
    ghostDrag=null; };
  mv(e); document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);
}
function addNode(kind,t,x,y){
  const g=G(); const n={id:uid('n'),k:kind,x:snap(x),y:snap(y)};
  if(kind==='blk'){ n.type=t.id; n.params={}; (t.params||[]).forEach(p=>n.params[p.name]=p.def); }
  if(kind==='const'){ n.value=1; n.vtype='num'; }
  if(kind==='vget'||kind==='vset'||kind==='var'){ if(!P_.vars.length){ toast('Create a variable first (Vars tab)'); return; } n.varName=P_.vars[0].name; }
  g.nodes.push(n); selectOnly(n.id); _relayoutAnchors=[n.id]; renderGraph(); markDirty(); return n;
}

/* ---------- graph render ----------------------------------------- */
function syncIONodes(){ const t=curType(); if(t) syncIOFor(t); }
let _relayoutAnchors=null;             // set by a caller just before renderGraph() to protect those blocks from being displaced by the overlap pass
function renderGraph(){
  syncIONodes();
  if(relayout(G(), _relayoutAnchors)) toast('blocks repositioned — no overlaps, no arbitrarily long wires');
  _relayoutAnchors=null;
  nodesL.innerHTML=''; wireg.innerHTML='';
  const g=G();
  for(const n of g.nodes) nodesL.append(buildNode(n));
  for(const w of g.wires) wireg.append(buildWire(w));
  rerouteAll(); renderCrumb(); renderInspector();
}
/* click a block's type name to rename it in place. Typing the name of an
   existing type retypes the block to that type; typing an unknown name creates
   a brand-new type (same kind as before) with that name and retypes to it. */
function retypeBlock(n,newName){
  newName=(newName||'').trim();
  const cur=typeOf(n.type);
  if(!newName||(cur&&cur.name===newName)){ renderGraph(); return; }
  let target=Object.values(allTypes()).find(t=>t.name.toLowerCase()===newName.toLowerCase());
  if(!target){ target=newType(cur?cur.kind:'F'); target.name=newName; }
  const g=G();
  const oldParams=(cur&&cur.params)||[];
  const params={};
  (target.params||[]).forEach(p=>{
    const hadSame=oldParams.some(op=>op.name===p.name);
    params[p.name]=(hadSame&&n.params&&n.params[p.name]!==undefined)?n.params[p.name]:p.def;
  });
  n.type=target.id; n.params=params;
  const ni=(target.ins||[]).length, no=(target.outs||[]).length;
  g.wires=g.wires.filter(w=>{
    if(w.f[0]===n.id&&w.f[1]>=no) return false;
    if(w.t[0]===n.id&&w.t[1]>=ni) return false;
    return true;
  });
  g.nodes.filter(x=>x.auto).forEach(x=>collapseAutoMerge(g,x.id));
  renderPalette(); renderGraph(); markDirty();
}
function titleEl(n){
  if(n.k!=='blk') return el('span',{cls:'ttl'},nodeTitle(n));
  const span=el('span',{cls:'ttl',title:'click to change type'});
  span.textContent=nodeTitle(n);
  span.addEventListener('mousedown',e=>e.stopPropagation());
  span.addEventListener('click',e=>{
    e.stopPropagation();
    const inp=el('input',{value:nodeTitle(n),cls:'ttl-edit'});
    span.replaceWith(inp); inp.focus(); inp.select();
    let done=false;
    const commit=()=>{ if(done) return; done=true; retypeBlock(n,inp.value); };
    inp.addEventListener('keydown',ev=>{
      if(ev.key==='Enter'){ ev.preventDefault(); inp.blur(); }
      else if(ev.key==='Escape'){ ev.preventDefault(); done=true; renderGraph(); }
    });
    inp.addEventListener('blur',commit);
  });
  return span;
}
function buildNode(n){
  const s=nodeSize(n), p=portsOf(n);
  const isVarBox=n.k==='var';
  const d=el('div',{cls:'node '+nodeKindClass(n)+(n.auto?' auto':'')+(isVarBox?' vbox':'')+(sel.nodes.has(n.id)?' sel':''),'data-id':n.id});
  d.style.cssText=`left:${n.x}px;top:${n.y}px;width:${s.w}px;height:${s.h}px`;
  const t = n.k==='blk'?typeOf(n.type):null;
  const hd=el('div',{cls:'hd'});
  if(t) hd.append(el('span',{cls:'badge'},t.kind));
  hd.append(titleEl(n));
  d.append(hd);
  const body=el('div',{cls:'body'});
  const gg=G();
  p.ins.forEach((pt,i)=>{
    const y=GRID*(2+i)-HDR;
    const wired=isVarBox&&gg.wires.some(w=>w.t[0]===n.id&&w.t[1]===i);
    const port=el('div',{cls:'port'+(pt.type==='bool'?' bool':'')+(wired?' wired':''),style:`left:-5px;top:${y-5}px`,'data-n':n.id,'data-s':'in','data-i':i,title:isVarBox?'set '+n.varName:pt.name+':'+pt.type});
    hookValueHover(port,inputKeyFn(n.id,i));
    body.append(port);
    if(pt.name){ const lbl=el('div',{cls:'plabel',style:`left:12px;top:${y-7}px`},pt.name);
      hookValueHover(lbl,inputKeyFn(n.id,i)); body.append(lbl); } });
  p.outs.forEach((pt,i)=>{
    const y=GRID*(2+i)-HDR;
    const wired=isVarBox&&gg.wires.some(w=>w.f[0]===n.id&&w.f[1]===i);
    body.append(el('div',{cls:'port'+(pt.type==='bool'?' bool':'')+(wired?' wired':''),style:`left:${s.w-5}px;top:${y-5}px`,'data-n':n.id,'data-s':'out','data-i':i,title:isVarBox?'get '+n.varName:pt.name+':'+pt.type}));
    if(pt.name) body.append(el('div',{cls:'plabel',style:`right:12px;top:${y-7}px;text-align:right`},pt.name)); });
  if(hasField(n)){
    const rows=Math.max(p.ins.length,p.outs.length,1);
    const f=el('input',{value:String(n.value),title:'python literal'});
    f.addEventListener('change',()=>{ n.value=f.value; n.vtype=guessType(f.value); renderGraph(); markDirty(); });
    f.addEventListener('mousedown',e=>e.stopPropagation());
    body.append(el('div',{cls:'pfield',style:`top:${GRID*(rows+1)-HDR+1}px`},f));
  }
  d.append(body);
  return d;
}
function guessType(v){ const s=String(v).trim();
  if(s==='True'||s==='False') return 'bool';
  if(/^-?[\d.]+$/.test(s)) return 'num'; return 'any'; }

const NS='http://www.w3.org/2000/svg';
function buildWire(w){
  const g=document.createElementNS(NS,'g'); g.setAttribute('data-id',w.id);
  g.innerHTML=`<path class="hit"></path><path class="wire"></path><text class="wlabel" text-anchor="middle"></text>`;
  const hit=g.querySelector('.hit');
  hit.addEventListener('mousedown',e=>{e.stopPropagation(); selectWire(w.id);});
  hit.addEventListener('dblclick',e=>{e.stopPropagation(); delWire(w.id);});
  hookValueHover(hit,()=>slotKey(w.f[0],w.f[1]));
  return g;
}
function slotKey(nodeId,port){ return nodeId+':'+port; }
function updateWires(fast){
  const g=G();
  for(const w of g.wires){
    const a=nodeById(w.f[0]), b=nodeById(w.t[0]); if(!a||!b) continue;
    const p1=portPos(a,'out',w.f[1]), p2=portPos(b,'in',w.t[1]);
    const grp=wireg.querySelector(`g[data-id="${w.id}"]`); if(!grp) continue;
    const back = isBack(g,w);
    const d = (!fast && ROUTES[w.id]) ? ROUTES[w.id] : quickPath(p1,p2,back);
    grp.querySelector('.hit').setAttribute('d',d);
    const path=grp.querySelector('.wire'); path.setAttribute('d',d);
    const po=portsOf(a).outs[w.f[1]]; const ty=po?po.type:'any';
    const key=slotKey(w.f[0],w.f[1]);
    const has=(key in LIVE);
    const v=LIVE[key];
    path.setAttribute('class','wire'+(back?' back':'')+(sel.wires.has(w.id)?' sel':''));
    if(has){ const c=valColor(v,ty,key); path.style.stroke=c.stroke; path.style.strokeWidth=c.width;
      path.style.filter=c.glow?'drop-shadow(0 0 4px '+c.stroke+')':''; }
    else { path.style.stroke=''; path.style.strokeWidth=''; path.style.filter=''; }
    const tx=grp.querySelector('text');
    const label = (back?'\u21ba z\u207b\u00b9':'') + (has&&showVals?(back?' ':'')+fmt(v):'');
    if(label){ tx.textContent=label;
      let mid={x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2};
      try{ const L=path.getTotalLength(); if(L>0) mid=path.getPointAtLength(L*0.5); }catch(e){}
      tx.setAttribute('x',mid.x); tx.setAttribute('y',mid.y-6);
      tx.setAttribute('class','wlabel'+(back?' backlabel':'')); tx.style.display=''; }
    else tx.style.display='none';
  }
}
const fmt=v=> (typeof v==='boolean')?(v?'TRUE':'FALSE') : (typeof v==='number'? (Number.isInteger(v)?String(v):v.toFixed(3)) : String(v));
function lerpHex(a,b,t){ const p=h=>[1,3,5].map(i=>parseInt(h.substr(i,2),16));
  const A=p(a),Bb=p(b); return '#'+A.map((v,i)=>Math.round(v+(Bb[i]-v)*t).toString(16).padStart(2,'0')).join(''); }
function ramp(t){ t=Math.max(0,Math.min(1,t));
  return t<0.5? lerpHex('#1e5fd0','#f5b23f',t*2) : lerpHex('#f5b23f','#ff4d4d',(t-0.5)*2); }
function valColor(v,type,key){
  if(typeof v==='boolean'||type==='bool') return v?{stroke:'#22e06a',width:3,glow:true}:{stroke:'#2f4a3c',width:2,glow:false};
  if(typeof v==='number'){
    const r=RANGE[key]||(RANGE[key]={lo:v,hi:v});
    r.lo=Math.min(r.lo,v); r.hi=Math.max(r.hi,v);
    const sp=r.hi-r.lo; const t=sp>1e-9?(v-r.lo)/sp:0.5;
    return {stroke:ramp(t),width:2+t*1.6,glow:t>0.7};
  }
  return {stroke:'#7c8aa0',width:2,glow:false};
}

/* ---------- selection & editing ---------------------------------- */
function selectOnly(id){ sel.nodes=new Set(id?[id]:[]); sel.wires=new Set(); refreshSel(); }
function selectWire(id){ sel.nodes=new Set(); sel.wires=new Set([id]); refreshSel(); }
function refreshSel(){
  $$('.node').forEach(d=>d.classList.toggle('sel',sel.nodes.has(d.dataset.id)));
  updateWires(); renderInspector();
}
function delWire(id){
  const g=G();
  const w=g.wires.find(x=>x.id===id);
  g.wires=g.wires.filter(w=>w.id!==id);
  if(w) collapseAutoMerge(g,w.t[0]);
  renderGraph(); markDirty();
}
function delSelection(){
  const g=G();
  const ids=[...sel.nodes].filter(id=>{const n=nodeById(id); return n && n.k!=='gin' && n.k!=='gout';});
  g.nodes=g.nodes.filter(n=>!ids.includes(n.id));
  g.wires=g.wires.filter(w=>!ids.includes(w.f[0])&&!ids.includes(w.t[0])&&!sel.wires.has(w.id));
  g.nodes.filter(n=>n.auto).forEach(n=>collapseAutoMerge(g,n.id));
  selectOnly(null); renderGraph(); markDirty();
}
/* A wire's direction is never a choice the user makes — it's derived from
   where the two blocks already sit, same as every other geometric fact about
   the diagram. Output -> input where the target is currently upstream of the
   source reads back-to-front, so it becomes feedback (right-to-left, z⁻¹)
   automatically; otherwise it's a same-scan forward wire. There is no way to
   force one or the other independent of layout.
   Connecting a second wire onto an input that's already fed doesn't replace the
   first one: a small merge block (OR for booleans, ADD for numbers) is spliced
   in automatically, so both signals still reach the input. A third wire chains
   another merge block off the first, and so on. */
function mergeKindFor(portType){ return portType==='bool'?'or' : portType==='num'?'add' : null; }
function connect(fn,fi,tn,ti){
  const g=G();
  if(fn===tn) return;
  if(!nodeById(fn)||!nodeById(tn)) return;
  const existing=g.wires.find(w=>w.t[0]===tn&&w.t[1]===ti);
  if(existing && existing.f[0]===fn && existing.f[1]===fi) return;   // already wired exactly this way
  if(existing){
    const dst=nodeById(tn);
    const portType=(portsOf(dst).ins[ti]||{}).type;
    const mergeKind=mergeKindFor(portType);
    if(!mergeKind){ toast('this input already has a connection — only boolean (→OR) or numeric (→ADD) inputs accept more than one wire'); return; }
    const exFn=existing.f[0], exFi=existing.f[1], exSrc=nodeById(exFn);
    const mt=typeOf(mergeKind);
    const m={id:uid('n'),k:'blk',type:mergeKind,auto:mergeKind,x:snap(exSrc.x),y:snap(exSrc.y+nodeSize(exSrc).h+GRID),params:{}};
    (mt.params||[]).forEach(p=>m.params[p.name]=p.def);
    g.wires=g.wires.filter(w=>w!==existing);
    g.nodes.push(m);
    _wireUp(g,exFn,exFi,m.id,0);
    _wireUp(g,fn,fi,m.id,1);
    _wireUp(g,m.id,0,tn,ti);
    renderGraph(); markDirty();
    return;
  }
  _wireUp(g,fn,fi,tn,ti);
  renderGraph(); markDirty();
}
function _wireUp(g,fn,fi,tn,ti){
  const src=nodeById(fn), dst=nodeById(tn);
  if(!src||!dst) return;
  g.wires=g.wires.filter(w=>!(w.t[0]===tn&&w.t[1]===ti));   // one source per input
  const w={id:uid('w'),f:[fn,fi],t:[tn,ti]};
  w.back=wireBack(g,w);
  g.wires.push(w);
}
/* an auto-merge block left with one or zero inputs (its other source got
   disconnected) is pointless — collapse it back to a plain wire, or remove it
   entirely, rather than leaving a stray OR/ADD with a dangling input. */
function collapseAutoMerge(g,nodeId){
  const n=g.nodes.find(x=>x.id===nodeId);
  if(!n||!n.auto) return;
  const inWires=g.wires.filter(w=>w.t[0]===nodeId);
  if(inWires.length>1) return;
  const outWires=g.wires.filter(w=>w.f[0]===nodeId);
  g.nodes=g.nodes.filter(x=>x.id!==nodeId);
  g.wires=g.wires.filter(w=>w.t[0]!==nodeId&&w.f[0]!==nodeId);
  if(inWires.length===1){
    const src=inWires[0];
    for(const ow of outWires) _wireUp(g,src.f[0],src.f[1],ow.t[0],ow.t[1],false);
  }
}

/* ---------- canvas interaction ------------------------------------ */
let drag=null;
cwrap.addEventListener('mousedown',e=>{
  if(e.button===1||e.button===2) return;
  const port=e.target.closest('.port');
  if(port){ e.preventDefault(); startWireDrag(port,e); return; }
  const nd=e.target.closest('.node');
  if(nd){ const n=nodeById(nd.dataset.id);
    if(!sel.nodes.has(n.id)) selectOnly(n.id);
    const g=G();
    const movers = e.altKey ? new Set(sel.nodes) : forwardClosure(g,[...sel.nodes]);
    const start=[...movers].map(id=>{const q=nodeById(id); return {n:q,x:q.x,y:q.y};});
    const bounds=dxBounds(g,movers);
    const xLocked=new Set(); for(const w of g.wires) if(!wireBack(g,w)) xLocked.add(w.t[0]);
    movers.forEach(id=>{const d=nodesL.querySelector(`.node[data-id="${id}"]`); if(d)d.classList.add('moving');});
    const p0=toGraph(e.clientX,e.clientY);
    drag={type:'node',start,p0,bounds,xLocked,moved:false,clamped:false}; e.preventDefault(); return; }
  selectOnly(null);
  drag={type:'pan',x0:e.clientX,y0:e.clientY,cx:cam.x,cy:cam.y};
});
cwrap.addEventListener('dblclick',e=>{
  const nd=e.target.closest('.node'); if(!nd) return;
  const n=nodeById(nd.dataset.id);
  if(n.k==='blk'){ const t=typeOf(n.type);
    if(t&&!t.builtin){ if(t.impl==='graph') enterType(t.id,n.id); else openType(t.id); }
    else openType(n.type); }
});
document.addEventListener('mousemove',e=>{
  if(!drag) return;
  if(drag.type==='pan'){ cam.x=drag.cx+(e.clientX-drag.x0); cam.y=drag.cy+(e.clientY-drag.y0); applyCam(); }
  else if(drag.type==='node'){ const p=toGraph(e.clientX,e.clientY);
    let dx=snap(p.x-drag.p0.x); const dy=snap(p.y-drag.p0.y); drag.moved=true;
    const cl=Math.max(drag.bounds.lo, Math.min(drag.bounds.hi, dx));
    if(cl!==dx){ if(!drag.clamped){ drag.clamped=true;
        toast('held by a wire — a block cannot cross a block it exchanges signals with (Alt-drag to move it alone)'); } }
    else drag.clamped=false;
    dx=cl;
    for(const s of drag.start){ s.n.x=s.x+dx; s.n.y=s.y+dy; }
    /* reorder is live, not just corrected on drop: push whatever's in the way
       out of the mover's path as the mouse moves, so the new order is visible
       before you let go, same as dragging an item in a sortable list. */
    const g=G();
    const movedIds=drag.start.map(s=>s.n.id);
    resolveOverlaps(g, movedIds, drag.xLocked);
    if(hasOverlap(g)) resolveOverlaps(g, null, drag.xLocked);   // sandwiched-deadlock fallback, see relayout()
    for(const n of g.nodes){ const d=nodesL.querySelector(`.node[data-id="${n.id}"]`); if(d){d.style.left=n.x+'px'; d.style.top=n.y+'px';} }
    updateWires(true); }
  else if(drag.type==='wire'){ const p=toGraph(e.clientX,e.clientY);
    const q={x:snap(p.x),y:snap(p.y)}, anc={x:drag.ax,y:drag.ay};
    drag.temp.setAttribute('d', drag.rev? quickPath(q,anc,anc.x<=q.x) : quickPath(anc,q,q.x<=anc.x));
    const t=document.elementFromPoint(e.clientX,e.clientY);
    $$('.port.tgt').forEach(x=>x.classList.remove('tgt'));
    if(t&&t.classList.contains('port')&&t.dataset.s===(drag.rev?'out':'in')) t.classList.add('tgt'); }
});
document.addEventListener('mouseup',e=>{
  if(!drag) return;
  if(drag.type==='wire'){
    const t=document.elementFromPoint(e.clientX,e.clientY);
    drag.temp.remove();
    if(t&&t.classList.contains('port')&&t.dataset.s===(drag.rev?'out':'in')){
      if(drag.rev) connect(t.dataset.n,+t.dataset.i,drag.node,drag.idx);
      else connect(drag.node,drag.idx,t.dataset.n,+t.dataset.i);
    } else renderGraph();
    $$('.port.tgt').forEach(x=>x.classList.remove('tgt'));
  }
  if(drag.type==='node'){ $$('.node.moving').forEach(d=>d.classList.remove('moving'));
    if(drag.moved){ _relayoutAnchors=drag.start.map(s=>s.n.id); renderGraph(); markDirty(); } }
  drag=null;
});
function startWireDrag(port,e){
  const nid=port.dataset.n, side=port.dataset.s, idx=+port.dataset.i;
  const g=G();
  if(side==='in'){
    const ex=g.wires.find(w=>w.t[0]===nid&&w.t[1]===idx);
    if(ex){ g.wires=g.wires.filter(w=>w!==ex); renderGraph();
      const a=nodeById(ex.f[0]); const p=portPos(a,'out',ex.f[1]);
      const temp=mkTemp(); drag={type:'wire',node:ex.f[0],idx:ex.f[1],ax:p.x,ay:p.y,temp,rev:false}; return; }
    const n=nodeById(nid), p=portPos(n,'in',idx);
    const temp=mkTemp(); drag={type:'wire',node:nid,idx,ax:p.x,ay:p.y,temp,rev:true}; return;
  }
  const n=nodeById(nid), p=portPos(n,'out',idx);
  const temp=mkTemp(); drag={type:'wire',node:nid,idx,ax:p.x,ay:p.y,temp,rev:false};
}
function mkTemp(){ const p=document.createElementNS(NS,'path');
  p.setAttribute('class','wire'); p.style.stroke='#4fa3ff'; p.style.strokeDasharray='5 4'; wireg.append(p); return p; }
cwrap.addEventListener('wheel',e=>{ e.preventDefault();
  const r=cwrap.getBoundingClientRect(), mx=e.clientX-r.left, my=e.clientY-r.top;
  const z=Math.max(.25,Math.min(2.5,cam.z*(e.deltaY<0?1.12:1/1.12)));
  cam.x=mx-(mx-cam.x)*(z/cam.z); cam.y=my-(my-cam.y)*(z/cam.z); cam.z=z; applyCam(); },{passive:false});
document.addEventListener('keydown',e=>{
  if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if(e.key==='Delete'||e.key==='Backspace'){ e.preventDefault(); delSelection(); }
  if(e.key==='Escape'){ selectOnly(null); }
  if((e.ctrlKey||e.metaKey)&&e.key==='s'){ e.preventDefault(); saveProject(); }
});

/* ---------- breadcrumb / navigation ------------------------------- */
function renderCrumb(){
  const c=$('#crumb'); c.innerHTML='';
  c.append(el('a',{onclick:()=>{view.stack=[];renderGraph();}},'Main'));
  view.stack.forEach((s,i)=>{ const t=P_.types[s.typeId];
    c.append(document.createTextNode(' / '));
    c.append(el('a',{onclick:()=>{view.stack=view.stack.slice(0,i+1);renderGraph();}},(t?t.name:'?')+' ['+(t?t.kind:'')+']')); });
  if(view.stack.length){ const s=view.stack[view.stack.length-1];
    const paths=(GEN.instPaths&&GEN.instPaths[s.typeId])||[];
    if(paths.length>1){
      const sl=el('select',{style:'margin-left:8px',onchange:ev=>{s.path=ev.target.value;renderGraph();}});
      paths.forEach(p=>sl.append(el('option',{value:p,selected:p===s.path?'':null},'inst '+(p||'—'))));
      c.append(sl); }
    c.append(el('span',{cls:'chip',style:'margin-left:8px'},(P_.types[s.typeId]||{}).impl==='graph'?'flow impl':'python impl'));
  }
}
function enterType(typeId,instNodeId){
  const base=curPath(); const path=(base?base+'/':'')+(instNodeId||'');
  view.stack.push({typeId,path}); selectOnly(null); renderGraph();
}
function openType(typeId){
  const t=typeOf(typeId);
  if(t&&t.impl==='graph'&&!t.builtin){ const paths=(GEN.instPaths&&GEN.instPaths[typeId])||[''];
    view.stack=[{typeId,path:paths[0]||''}]; renderGraph(); }
  showTab('type'); TYPESEL=typeId; renderTypeTab();
}

/* ---------- tabs --------------------------------------------------- */
let TAB='insp';
$$('.tabs .tab').forEach(t=>t.addEventListener('click',()=>showTab(t.dataset.t)));
function showTab(t){ TAB=t; $$('.tabs .tab').forEach(x=>x.classList.toggle('on',x.dataset.t===t));
  ['insp','type','vars','code'].forEach(k=>$('#tb-'+k).style.display=(k===t?'':'none'));
  if(t==='code') renderCode(); if(t==='type') renderTypeTab(); if(t==='vars') renderVars(); if(t==='insp') renderInspector(); }

/* ---------- inspector ---------------------------------------------- */
function renderInspector(){
  const b=$('#tb-insp'); if(TAB!=='insp'){return;} b.innerHTML='';
  if(sel.wires.size){ const w=G().wires.find(x=>sel.wires.has(x.id));
    if(w){ const a=nodeById(w.f[0]),c=nodeById(w.t[0]);
      b.append(el('div',{cls:'sub'},'Wire'));
      b.append(el('div',{cls:'mono',style:'font-size:11px;color:var(--fg2)'},
        `${nodeTitle(a)}.${(portsOf(a).outs[w.f[1]]||{}).name||'out'} → ${nodeTitle(c)}.${(portsOf(c).ins[w.t[1]]||{}).name||'in'}`));
      const bk=isBack(G(),w);
      b.append(el('div',{style:'margin-top:6px;font-size:11px;color:'+(bk?'#c9a4ff':'var(--fg2)')},
        bk? '\u21ba right-to-left \u2014 carries LAST scan\u2019s value (z\u207b\u00b9). Move the target block to the right of the source to make it same-scan.'
          : 'left-to-right \u2014 evaluated in the same scan'));
      const key=slotKey(w.f[0],w.f[1]);
      if(key in LIVE) b.append(el('div',{style:'margin-top:8px;font-size:20px',cls:'mono'},fmt(LIVE[key])));
      b.append(el('div',{cls:'hr'}));
      b.append(el('button',{cls:'danger',onclick:()=>delWire(w.id)},'Delete wire'));
      return; } }
  if(!sel.nodes.size){ b.append(el('div',{style:'color:var(--fg2)'},'Nothing selected. Drag a block from the left, wire ports together, then Deploy or Simulate.'));
    b.append(el('div',{cls:'hr'}));
    b.append(el('div',{cls:'sub'},'Scan settings'));
    b.append(numRow('Scan (ms)',P_.scan_ms,v=>{P_.scan_ms=Math.max(1,v|0);markDirty();}));
    b.append(numRow('Telemetry (ms)',P_.tele_ms,v=>{P_.tele_ms=Math.max(20,v|0);markDirty();}));
    return; }
  const n=nodeById([...sel.nodes][0]); if(!n) return;
  b.append(el('div',{cls:'sub'},'Node'));
  b.append(el('div',{style:'display:flex;gap:6px;align-items:center'},
    el('b',{},nodeTitle(n)), el('span',{cls:'chip'},n.id)));
  if(n.k==='blk'){
    const t=typeOf(n.type);
    b.append(el('div',{style:'margin:6px 0;color:var(--fg2)'},(t.kind==='FB'?'stateful function block':'stateless function')+(t.builtin?' · builtin':' · user')));
    if((t.params||[]).length){ b.append(el('div',{cls:'sub'},'Parameters'));
      for(const p of t.params) b.append(paramRow(n,p)); }
    if(t.kind==='FB'&&(t.refs||[]).length){ b.append(el('div',{cls:'sub'},'Variable references (by reference, not copied per-scan)'));
      for(const r of t.refs) b.append(refRow(n,r)); }
    if(!t.builtin){ b.append(el('div',{cls:'hr'}));
      b.append(el('button',{onclick:()=> t.impl==='graph'? enterType(t.id,n.id) : openType(t.id)},
        t.impl==='graph'?'Open flow implementation ▸':'Edit Python ▸')); }
  }
  if(n.k==='const'){ b.append(el('div',{cls:'sub'},'Value (python literal)'));
    b.append(inputRow('value',n.value,v=>{n.value=v;n.vtype=guessType(v);renderGraph();markDirty();})); }
  if(n.k==='vget'||n.k==='vset'||n.k==='var'){ b.append(el('div',{cls:'sub'},'Variable'));
    const s=el('select',{onchange:e=>{n.varName=e.target.value;renderGraph();markDirty();}});
    P_.vars.forEach(v=>s.append(el('option',{value:v.name,selected:v.name===n.varName?'':null},v.name+' : '+v.type)));
    b.append(el('div',{cls:'row'},s));
    if(n.k==='var') b.append(el('div',{style:'margin-top:4px;font-size:11px;color:var(--fg2)'},
      'hover the left/right edge to reveal the set/get connection point — a point stays visible once wired')); }
  inspectorExtra(b,n);
  const outs=portsOf(n).outs;
  if(outs.length){ b.append(el('div',{cls:'sub'},'Live outputs'));
    outs.forEach((p,i)=>{ const k=slotKey(n.id,i);
      b.append(el('div',{cls:'row'},el('label',{},p.name||'out'),
        el('span',{cls:'mono',style:'flex:1'},(k in LIVE)?fmt(LIVE[k]):'—'))); }); }
  b.append(el('div',{cls:'hr'}));
  if(n.k!=='gin'&&n.k!=='gout') b.append(el('button',{cls:'danger',onclick:delSelection},'Delete node'));
}
function paramRow(n,p){
  const wrap=el('div',{cls:'row'},el('label',{title:p.type},p.name));
  if(p.type==='bool'){ const c=el('input',{type:'checkbox',style:'width:auto'});
    c.checked=!!n.params[p.name]; c.onchange=()=>{n.params[p.name]=c.checked;markDirty();}; wrap.append(c); }
  else { const i=el('input',{value:String(n.params[p.name]??p.def)});
    i.onchange=()=>{ n.params[p.name]= p.type==='str'? i.value : Number(i.value); markDirty(); }; wrap.append(i); }
  return wrap;
}
/* a reference slot binds a variable to an FB instance by name (not by value):
   the constructor receives the variable's attribute name as a string, and the
   block's own Python code reads/writes it via getattr/setattr(V, self._ref_X)
   whenever and however it wants — a whole element, only sometimes, etc. —
   instead of the graph copying a value in/out once every scan. */
function refRow(n,r){
  const wrap=el('div',{cls:'row'},el('label',{title:'getattr/setattr(V, self._ref_'+r.name+')'},r.name));
  const s=el('select');
  s.append(el('option',{value:''},'— none —'));
  P_.vars.forEach(v=>s.append(el('option',{value:v.name,selected:((n.refs&&n.refs[r.name])===v.name)?'':null},v.name+' : '+v.type)));
  s.onchange=()=>{ n.refs=n.refs||{}; n.refs[r.name]=s.value; markDirty(); };
  wrap.append(s);
  return wrap;
}
function inputRow(lbl,val,cb){ const i=el('input',{value:String(val)}); i.onchange=()=>cb(i.value);
  return el('div',{cls:'row'},el('label',{},lbl),i); }
function numRow(lbl,val,cb){ const i=el('input',{type:'number',value:String(val)}); i.onchange=()=>cb(Number(i.value));
  return el('div',{cls:'row'},el('label',{},lbl),i); }

/* ---------- type tab ----------------------------------------------- */
let TYPESEL=null;
function renderTypeTab(){
  const b=$('#tb-type'); if(TAB!=='type') return; b.innerHTML='';
  const sl=el('select',{onchange:e=>{TYPESEL=e.target.value;renderTypeTab();}});
  sl.append(el('option',{value:''},'— select a type —'));
  Object.values(P_.types).forEach(t=>sl.append(el('option',{value:t.id,selected:t.id===TYPESEL?'':null},t.name+'  ['+t.kind+']')));
  Object.values(BUILTIN).forEach(t=>sl.append(el('option',{value:t.id,selected:t.id===TYPESEL?'':null},t.name+'  [builtin]')));
  b.append(el('div',{cls:'row'},sl));
  b.append(el('div',{cls:'row'},
    el('button',{onclick:()=>{const t=newType('F');TYPESEL=t.id;renderPalette();renderTypeTab();markDirty();}},'+ new F'),
    el('button',{onclick:()=>{const t=newType('FB');TYPESEL=t.id;renderPalette();renderTypeTab();markDirty();}},'+ new FB')));
  const t=TYPESEL?typeOf(TYPESEL):null; if(!t) return;
  b.append(el('div',{cls:'hr'}));
  const ro=!!t.builtin;
  const nameI=el('input',{value:t.name,disabled:ro?'':null});
  nameI.onchange=()=>{t.name=nameI.value.trim()||t.name;renderPalette();renderGraph();markDirty();};
  b.append(el('div',{cls:'row'},el('label',{},'name'),nameI));
  const kindS=el('select',{disabled:ro?'':null,onchange:e=>{t.kind=e.target.value;
    if(t.kind==='FB'&&t.init===undefined)t.init='pass'; renderPalette();renderTypeTab();renderGraph();markDirty();}});
  ['F','FB'].forEach(k=>kindS.append(el('option',{value:k,selected:k===t.kind?'':null},k==='F'?'F — stateless function':'FB — stateful block')));
  b.append(el('div',{cls:'row'},el('label',{},'kind'),kindS));
  const implS=el('select',{disabled:ro?'':null,onchange:e=>{t.impl=e.target.value;renderTypeTab();renderGraph();markDirty();}});
  ['py','graph'].forEach(k=>implS.append(el('option',{value:k,selected:k===t.impl?'':null},k==='py'?'Python source':'Flow diagram')));
  b.append(el('div',{cls:'row'},el('label',{},'impl'),implS));
  if(t.kind==='FB'&&!ro){
    const c=el('input',{type:'checkbox',style:'width:auto'}); c.checked=!!t.breaker;
    c.onchange=()=>{t.breaker=c.checked; if(c.checked){t.pre=t.pre||'return self.q';t.post=t.post||'self.q = x';} renderTypeTab();markDirty();};
    b.append(el('div',{cls:'row'},el('label',{title:'outputs read from state before inputs are computed — use to close feedback loops'},'z⁻¹ breaker'),c));
  }
  b.append(el('div',{cls:'sub'},'Inputs'));   b.append(portEditor(t,'ins',ro));
  b.append(el('div',{cls:'sub'},'Outputs'));  b.append(portEditor(t,'outs',ro));
  b.append(el('div',{cls:'sub'},'Parameters (constructor args)')); b.append(paramEditor(t,ro));
  if(t.kind==='FB'){
    b.append(el('div',{cls:'sub'},'Variable references (bound per instance in the Inspector; access with getattr/setattr(V, self._ref_<name>) — the code decides when and how much to read or write)'));
    b.append(refEditor(t,ro));
  }
  b.append(el('div',{cls:'hr'}));
  if(t.impl==='graph'&&!ro){
    b.append(el('button',{cls:'pri',onclick:()=>enterType(t.id,'')},'Open flow implementation ▸'));
    b.append(el('div',{style:'margin-top:8px;color:var(--fg2);font-size:11px'},'Wire the IN/OUT nodes inside the diagram.'));
  } else {
    if(t.kind==='FB'&&!t.breaker) b.append(codeBox(t,'init','__init__ body  (params in scope: '+(t.params||[]).map(p=>p.name).join(', ')+')',ro));
    if(t.kind==='FB'&&t.breaker){
      b.append(codeBox(t,'init','__init__ body',ro));
      b.append(codeBox(t,'pre','pre()  — returns outputs from state',ro));
      b.append(codeBox(t,'post','post('+(t.ins||[]).map(p=>p.name).join(', ')+')  — stores inputs',ro));
    } else {
      const sig=(t.kind==='FB'?'self, ':'')+(t.params||[]).map(p=>p.name).concat((t.ins||[]).map(p=>p.name)).join(', ');
      b.append(codeBox(t,'step',(t.kind==='FB'?'step':'call')+'('+sig+') body — return '+((t.outs||[]).map(p=>p.name).join(', ')||'None'),ro));
    }
  }
  if(!ro){ b.append(el('div',{cls:'hr'}));
    b.append(el('button',{cls:'danger',onclick:()=>{ if(!confirm('Delete type '+t.name+'?'))return;
      delete P_.types[t.id]; TYPESEL=null; renderPalette(); renderTypeTab(); renderGraph(); markDirty(); }},'Delete type')); }
}
function portEditor(t,key,ro){
  const box=el('div',{cls:'plist'});
  (t[key]||[]).forEach((p,i)=>{
    const nm=el('input',{value:p.name,disabled:ro?'':null}); nm.onchange=()=>{p.name=nm.value.trim()||p.name;renderGraph();markDirty();};
    const ty=el('select',{disabled:ro?'':null}); ['num','bool','any'].forEach(k=>ty.append(el('option',{value:k,selected:k===p.type?'':null},k)));
    ty.onchange=()=>{p.type=ty.value;renderGraph();markDirty();};
    const rm=el('button',{disabled:ro?'':null,onclick:()=>{t[key].splice(i,1);renderTypeTab();renderGraph();markDirty();}},'×');
    box.append(el('div',{cls:'pr'},nm,ty,rm));
  });
  if(!ro) box.append(el('div',{cls:'pr'},el('button',{onclick:()=>{ (t[key]=t[key]||[]).push(IO(key==='ins'?'in'+(t[key].length+1):'out'+(t[key].length+1),'num'));
    renderTypeTab();renderGraph();markDirty();}},'+ add')));
  return box;
}
function paramEditor(t,ro){
  const box=el('div',{cls:'plist'});
  (t.params||[]).forEach((p,i)=>{
    const nm=el('input',{value:p.name,disabled:ro?'':null}); nm.onchange=()=>{p.name=nm.value.trim()||p.name;markDirty();};
    const ty=el('select',{disabled:ro?'':null}); ['num','int','bool','str'].forEach(k=>ty.append(el('option',{value:k,selected:k===p.type?'':null},k)));
    ty.onchange=()=>{p.type=ty.value;markDirty();};
    const dv=el('input',{value:String(p.def),disabled:ro?'':null,style:'width:60px;flex:0 0 60px'});
    dv.onchange=()=>{p.def= p.type==='str'?dv.value : (p.type==='bool'? dv.value==='true' : Number(dv.value)); markDirty();};
    const rm=el('button',{disabled:ro?'':null,onclick:()=>{t.params.splice(i,1);renderTypeTab();markDirty();}},'×');
    box.append(el('div',{cls:'pr'},nm,ty,dv,rm));
  });
  if(!ro) box.append(el('div',{cls:'pr'},el('button',{onclick:()=>{ (t.params=t.params||[]).push(P('p'+((t.params||[]).length+1),'num',0));
    renderTypeTab();markDirty();}},'+ add')));
  return box;
}
function refEditor(t,ro){
  const box=el('div',{cls:'plist'});
  (t.refs||[]).forEach((r,i)=>{
    const nm=el('input',{value:r.name,disabled:ro?'':null}); nm.onchange=()=>{r.name=nm.value.trim()||r.name;markDirty();};
    const rm=el('button',{disabled:ro?'':null,onclick:()=>{t.refs.splice(i,1);renderTypeTab();markDirty();}},'×');
    box.append(el('div',{cls:'pr'},nm,rm));
  });
  if(!ro) box.append(el('div',{cls:'pr'},el('button',{onclick:()=>{ (t.refs=t.refs||[]).push({name:'ref'+((t.refs||[]).length+1)});
    renderTypeTab();markDirty();}},'+ add')));
  return box;
}
function codeBox(t,key,label,ro){
  const w=el('div');
  w.append(el('div',{cls:'sub'},label));
  const ta=el('textarea',{cls:'code',rows:Math.max(4,String(t[key]||'').split('\n').length+1),spellcheck:'false',disabled:ro?'':null});
  ta.value=t[key]||'';
  ta.addEventListener('keydown',e=>{ if(e.key==='Tab'){e.preventDefault();
    const s=ta.selectionStart; ta.value=ta.value.slice(0,s)+'    '+ta.value.slice(ta.selectionEnd); ta.selectionStart=ta.selectionEnd=s+4;} });
  ta.addEventListener('change',()=>{ t[key]=ta.value; markDirty(); });
  w.append(ta);
  return w;
}

/* ---------- vars tab ------------------------------------------------ */
function renderVars(){
  const b=$('#tb-vars'); if(TAB!=='vars') return; b.innerHTML='';
  b.append(el('div',{cls:'sub'},'Variables (global, shared across all diagrams)'));
  const box=el('div',{cls:'plist'});
  P_.vars.forEach((v,i)=>{
    const nm=el('input',{value:v.name}); nm.onchange=()=>{ const old=v.name; const nn=nm.value.trim().replace(/\W/g,'_')||old;
      renameVar(old,nn); renderVars(); };
    const ty=el('select'); ['num','bool','any'].forEach(k=>ty.append(el('option',{value:k,selected:k===v.type?'':null},k)));
    ty.onchange=()=>{v.type=ty.value;renderGraph();markDirty();};
    const iv=el('input',{value:String(v.init),style:'width:56px;flex:0 0 56px',title:'initial value'});
    iv.onchange=()=>{v.init=iv.value;markDirty();};
    const live=el('span',{cls:'mono',style:'width:58px;flex:0 0 58px;color:var(--ok);text-align:right;overflow:hidden'},
      (VARLIVE&&(v.name in VARLIVE))?fmt(VARLIVE[v.name]):'—');
    const force=el('button',{title:'write value to running device',onclick:()=>{ const val=prompt('Force '+v.name+' =', String(VARLIVE[v.name]??v.init)); if(val!==null) forceVar(v.name,val); }},'⇢');
    const rm=el('button',{onclick:()=>{P_.vars.splice(i,1);renderVars();renderPalette();renderGraph();markDirty();}},'×');
    box.append(el('div',{cls:'pr'},nm,ty,iv,live,force,rm));
  });
  box.append(el('div',{cls:'pr'},el('button',{onclick:()=>{ P_.vars.push({name:'v'+(P_.vars.length+1),type:'num',init:'0'});
    renderVars();renderPalette();markDirty();}},'+ add variable')));
  b.append(box);
  b.append(el('div',{style:'margin-top:10px;color:var(--fg2);font-size:11px'},
    'Drop GET/SET var nodes onto any diagram. SET writes at its position in scan order; GET reads the current value.'));
}
function renameVar(oldN,newN){
  const v=P_.vars.find(v=>v.name===oldN); if(!v) return; v.name=newN;
  const walk=g=>g.nodes.forEach(n=>{
    if((n.k==='vget'||n.k==='vset'||n.k==='var')&&n.varName===oldN) n.varName=newN;
    if(n.k==='blk'&&n.refs){ for(const k in n.refs) if(n.refs[k]===oldN) n.refs[k]=newN; }
  });
  walk(P_.main); Object.values(P_.types).forEach(t=>t.graph&&walk(t.graph));
  renderGraph(); markDirty();
}

/* ---------- code tab ------------------------------------------------ */
function renderCode(){
  const b=$('#tb-code'); if(TAB!=='code') return; b.innerHTML='';
  let src='';
  try{ src=generate().full; }catch(e){ src='# codegen error:\n# '+e.message; }
  b.append(el('div',{cls:'row'},
    el('button',{onclick:()=>{navigator.clipboard.writeText(src);toast('copied');}},'copy'),
    el('button',{onclick:()=>dl(P_.name+'.py',src)},'download .py'),
    el('span',{cls:'chip'},src.split('\n').length+' lines')));
  b.append(el('pre',{cls:'code'},src));
}

/* ---------- misc ---------------------------------------------------- */
function log(s,cls){ const c=$('#con'); const d=el('div',{cls:cls||''},s); c.append(d);
  while(c.children.length>500) c.firstChild.remove(); c.scrollTop=c.scrollHeight; }
function toast(s){ log('· '+s,'i'); }
let statusBase='idle', statusKind='';
function setStatus(t,k){ $('#statusTxt').textContent=t; const d=$('#dot'); d.className='dot'+(k?' '+k:''); }
function setBase(t,k){ statusBase=t; statusKind=k||''; setStatus(t,k); }
let dirty=false;
function markDirty(){ dirty=true; try{ generate(); setStatus(statusBase,statusKind); }catch(e){ setStatus('codegen: '+e.message,'err'); }
  if(TAB==='code') renderCode(); if(TAB==='vars') renderVars(); }
function dl(name,txt,mime){ const b=new Blob([txt],{type:mime||'text/plain'}); const u=URL.createObjectURL(b);
  const a=el('a',{href:u,download:name}); document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),1000); }
$('#bClear').onclick=()=>$('#con').innerHTML='';
$('#bMin').onclick=()=>{ $('#bottom').classList.toggle('min'); $('#bMin').textContent=$('#bottom').classList.contains('min')?'▴':'▾'; };
$('#cbVals').onchange=e=>{showVals=e.target.checked;updateWires();};
$('#bNewF').onclick=()=>{const t=newType('F');renderPalette();TYPESEL=t.id;showTab('type');};
$('#bNewFB').onclick=()=>{const t=newType('FB');renderPalette();TYPESEL=t.id;showTab('type');};
