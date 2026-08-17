'use strict';
/* =====================================================================
   FlowPy — offline fallback engine (no Pyodide, no network)
   Interprets the same graph model natively. Builtin blocks are exact;
   user Python blocks are supported when they are a single `return <expr>`.
   ===================================================================== */
let JSPINS={}, JSPWM={}, JSVARS={}, JSSTATE={}, JSZ={}, JSW=[], JSUNSUP=[];
const jnow=()=>Math.round(performance.now());
const nz=v=>(typeof v==='number'?v:(v?1:0));

const JSB={
  and:(p,i)=>[!!i[0]&&!!i[1]],  or:(p,i)=>[!!i[0]||!!i[1]],
  xor:(p,i)=>[!!i[0]!==!!i[1]], not:(p,i)=>[!i[0]],
  netor:(p,i)=>[!!i[0]||!!i[1]],
  wiretap:(p,i)=>[i[0],i[0]], wiretap_num:(p,i)=>[i[0],i[0]],
  add:(p,i)=>[nz(i[0])+nz(i[1])], sub:(p,i)=>[nz(i[0])-nz(i[1])],
  mul:(p,i)=>[nz(i[0])*nz(i[1])], div:(p,i)=>[nz(i[1])?nz(i[0])/nz(i[1]):0],
  gt:(p,i)=>[nz(i[0])>nz(i[1])], lt:(p,i)=>[nz(i[0])<nz(i[1])], eq:(p,i)=>[i[0]===i[1]],
  b2n:(p,i)=>[i[0]?1:0], sel:(p,i)=>[i[0]?i[1]:i[2]],
  scale:(p,i)=>[p.in_hi===p.in_lo?p.out_lo:p.out_lo+(nz(i[0])-p.in_lo)*(p.out_hi-p.out_lo)/(p.in_hi-p.in_lo)],
  clamp:(p,i)=>[Math.min(p.hi,Math.max(p.lo,nz(i[0])))],
  pin_in:(p,i,s)=>{const v=!!JSPINS[p.pin]; return [p.invert?!v:v];},
  pin_out:(p,i)=>{JSPINS[p.pin]=i[0]?1:0; return [];},
  adc:(p,i)=>[(32768+30000*Math.sin(jnow()/700))/65535],
  pwm:(p,i)=>{JSPWM[p.pin]=Math.round(Math.min(1,Math.max(0,nz(i[0])))*65535); return [];},
  blink:(p,i,s)=>{ if(s.t===undefined){s.t=jnow();s.q=false;}
    if(jnow()-s.t>=Math.floor(p.period_ms/2)){s.t=jnow();s.q=!s.q;} return [s.q]; },
  ticks:()=>[jnow()],
  ton:(p,i,s)=>{ if(i[0]){ if(!s.run){s.run=true;s.t0=jnow();} const et=jnow()-s.t0; return [et>=p.pt_ms,et]; }
    s.run=false; return [false,0]; },
  counter:(p,i,s)=>{ s.n=s.n||0; if(i[0]&&!s.last)s.n++; s.last=!!i[0]; if(i[1])s.n=0; return [s.n]; },
  toggle:(p,i,s)=>{ if(i[0]&&!s.last)s.q=!s.q; s.last=!!i[0]; return [!!s.q]; },
  edge:(p,i,s)=>{ const x=!!i[0], r=x&&!s.last, f=!x&&!!s.last; s.last=x; return [r,f]; },
  sr:(p,i,s)=>{ if(i[0])s.q=true; if(i[1])s.q=false; return [!!s.q]; },
  hyst:(p,i,s)=>{ const x=nz(i[0]); if(x>=p.hi)s.q=true; else if(x<=p.lo)s.q=false; return [!!s.q]; },
  ema:(p,i,s)=>{ s.y=(s.y||0)+p.alpha*(nz(i[0])-(s.y||0)); return [s.y]; },
  delay:{pre:(p,i,s)=>[s.q===undefined?p.initial:s.q], post:(p,i,s)=>{s.q=i[0];}},
  print:(p,i,s)=>{ if(!p.on_change||i[0]!==s.p){ s.p=i[0]; log(p.label+' = '+fmt(i[0])); } return []; },
};

/* --- tiny python-expression bridge for user F blocks ---------------- */
const PYENV={round:(x,n)=>{const f=Math.pow(10,n||0);return Math.round(x*f)/f;},abs:Math.abs,min:Math.min,max:Math.max,
  int:x=>Math.trunc(x),float:Number,bool:Boolean,str:String,len:x=>String(x).length,pow:Math.pow};
const PYKEYS=Object.keys(PYENV), PYVALS=PYKEYS.map(k=>PYENV[k]);
const _pycache={};
function pyFn(t){
  if(t.id in _pycache) return _pycache[t.id];
  let fn=null;
  const lines=String(t.step||'').split('\n').map(l=>l.replace(/#.*$/,'').trim()).filter(Boolean);
  if(lines.length===1&&/^return\s+/.test(lines[0])&&!lines[0].includes('//')){
    let e=lines[0].replace(/^return\s+/,'');
    for(let k=0;k<5;k++){ const m=e.match(/^(.*?)\s+if\s+(.*?)\s+else\s+(.*)$/); if(!m)break;
      e=`((${m[2]}) ? (${m[1]}) : (${m[3]}))`; }
    e=e.replace(/\bTrue\b/g,'true').replace(/\bFalse\b/g,'false').replace(/\bNone\b/g,'null')
       .replace(/\bnot\s+/g,'!').replace(/\band\b/g,'&&').replace(/\bor\b/g,'||');
    const args=(t.params||[]).map(p=>p.name).concat((t.ins||[]).map(p=>p.name));
    try{ fn=new Function(...args,...PYKEYS,'return ('+e+');'); }catch(err){ fn=null; }
  }
  _pycache[t.id]=fn;
  if(!fn) JSUNSUP.push(t.name);
  return fn;
}

/* --- graph interpreter ---------------------------------------------- */
function topoOrder(graph,back){
  const deg={},adj={}; graph.nodes.forEach(n=>{deg[n.id]=0;adj[n.id]=[];});
  for(const w of graph.wires){ const d=graph.nodes.find(n=>n.id===w.t[0]),s=graph.nodes.find(n=>n.id===w.f[0]);
    if(!d||!s||isBreaker(d)||(back&&back.has(w.id)))continue; adj[s.id].push(d.id); deg[d.id]++; }
  /* ties (independent islands, parallel branches) resolve by graph.nodes' array order — the only record of sequence */
  const arrayIndex={}; graph.nodes.forEach((n,i)=>arrayIndex[n.id]=i);
  const ready=graph.nodes.filter(n=>deg[n.id]===0).map(n=>n.id), o=[];
  while(ready.length){
    ready.sort((a,b)=>arrayIndex[a]-arrayIndex[b]);
    const id=ready.shift(); o.push(id);
    for(const m of adj[id]) if(--deg[m]===0) ready.push(m);
  }
  return o;
}
function jsRun(graph,block,path,base,args){
  const V={},outs=[],posts=[];
  const st=id=>JSSTATE[path+'|'+id]||(JSSTATE[path+'|'+id]={});
  const wr=(n,i,v)=>{const o=block.local[n.id+':'+i]; if(o!==undefined)JSW[base+o]=v;};
  const back=new Set(graph.wires.filter(w=>isBack(graph,w)).map(w=>w.id));
  const zkeys=[...new Set(graph.wires.filter(w=>back.has(w.id)).map(w=>w.f[0]+':'+w.f[1]))];
  const inV=(n,i)=>{ const w=graph.wires.find(w=>w.t[0]===n.id&&w.t[1]===i);
    const p=portsOf(n).ins[i], dflt=(p&&p.type==='bool')?false:0;
    if(w&&back.has(w.id)){ const zk=path+'|z|'+w.f[0]+':'+w.f[1]; return (zk in JSZ)?JSZ[zk]:dflt; }
    if(w&&(w.f[0]+':'+w.f[1]) in V) return V[w.f[0]+':'+w.f[1]];
    return dflt; };
  for(const n of graph.nodes){ if(!isBreaker(n))continue; const t=typeOf(n.type);
    const impl=JSB[t.id]; const o=impl&&impl.pre?impl.pre(n.params,[],st(n.id)):[0];
    (t.outs||[]).forEach((p,i)=>{V[n.id+':'+i]=o[i];wr(n,i,o[i]);});
    posts.push(()=>{ const ins=(t.ins||[]).map((p,i)=>inV(n,i)); if(impl&&impl.post)impl.post(n.params,ins,st(n.id)); }); }
  for(const id of topoOrder(graph,back)){
    const n=graph.nodes.find(x=>x.id===id); if(!n||isBreaker(n))continue;
    if(n.k==='const'){ const v=pyLitVal(n.value); V[n.id+':0']=v; wr(n,0,v); continue; }
    if(n.k==='gin'){ const v=args[n.pi]; V[n.id+':0']=v; wr(n,0,v); continue; }
    if(n.k==='gout'){ outs[n.pi]=inV(n,0); continue; }
    if(n.k==='vget'){ const v=JSVARS[n.varName]; V[n.id+':0']=v; wr(n,0,v); continue; }
    if(n.k==='vset'){ JSVARS[n.varName]=inV(n,0); continue; }
    if(n.k==='var'){
      if(graph.wires.some(w=>w.t[0]===n.id&&w.t[1]===0)) JSVARS[n.varName]=inV(n,0);
      if(graph.wires.some(w=>w.f[0]===n.id&&w.f[1]===0)){ const v=JSVARS[n.varName]; V[n.id+':0']=v; wr(n,0,v); }
      continue;
    }
    if(n.k!=='blk') continue;
    const t=typeOf(n.type); if(!t) continue;
    const ins=(t.ins||[]).map((p,i)=>inV(n,i));
    let o=[];
    if(t.impl==='graph'){ o=jsRun(t.graph,GEN.blocks[t.id],(path?path+'/':'')+n.id,base+block.child[n.id],ins); }
    else if(t.builtin){ const impl=JSB[t.id]; o=impl?impl(n.params||{},ins,st(n.id)):[]; }
    else if(t.kind==='F'){ const f=pyFn(t); if(f){ const ps=(t.params||[]).map(p=>n.params?n.params[p.name]:p.def);
        try{ const r=f(...ps,...ins,...PYVALS); o=Array.isArray(r)?r:[r]; }catch(e){ o=[0]; } } else o=(t.outs||[]).map(()=>0); }
    else { if(!JSUNSUP.includes(t.name)) JSUNSUP.push(t.name); o=(t.outs||[]).map(()=>0); }
    (t.outs||[]).forEach((p,i)=>{ const v=o[i]===undefined?0:o[i]; V[n.id+':'+i]=v; wr(n,i,v); });
  }
  posts.forEach(f=>f());
  for(const k of zkeys) if(k in V) JSZ[path+'|z|'+k]=V[k];
  return outs;
}
function pyLitVal(v){ const s=String(v).trim();
  if(s==='True')return true; if(s==='False')return false; const n=Number(s); return isNaN(n)?0:n; }

function jsSimInit(){
  JSSTATE={}; JSVARS={}; JSPINS={}; JSPWM={}; JSZ={}; JSUNSUP=[]; _pycache_clear();
  P_.vars.forEach(v=>JSVARS[v.name]=pyLitVal(v.init));
  JSW=new Array(Math.max(1,GEN.nw)).fill(0);
}
function _pycache_clear(){ for(const k in _pycache) delete _pycache[k]; }
function jsSimStep(){
  if(JSW.length<GEN.nw) JSW=JSW.concat(new Array(GEN.nw-JSW.length).fill(0));
  jsRun(P_.main,GEN.mainBlock,'',0,[]);
  P_.vars.forEach((v,i)=>{ if(!(v.name in JSVARS)) JSVARS[v.name]=pyLitVal(v.init);
    JSW[GEN.varBase+i]=JSVARS[v.name]; });
}
