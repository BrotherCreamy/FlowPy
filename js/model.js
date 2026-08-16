'use strict';
/* =====================================================================
   FlowPy — model + builtin block library
   ===================================================================== */
const $  = (s,r)=> (r||document).querySelector(s);
const $$ = (s,r)=> Array.from((r||document).querySelectorAll(s));
const el = (t,a,...kids)=>{const n=document.createElement(t);
  if(a) for(const k in a){ if(k==='cls')n.className=a[k]; else if(k==='html')n.innerHTML=a[k];
    else if(k.startsWith('on'))n.addEventListener(k.slice(2),a[k]); else if(a[k]!==null&&a[k]!==undefined)n.setAttribute(k,a[k]); }
  for(const c of kids.flat()) if(c!==null&&c!==undefined) n.append(c.nodeType?c:document.createTextNode(c));
  return n;};
let _uid = 1; const uid = p => (p||'x') + (_uid++);
const clone = o => JSON.parse(JSON.stringify(o));
const dedent = s => { const l=s.replace(/^\n/,'').replace(/\s+$/,'').split('\n');
  const ind = Math.min(...l.filter(x=>x.trim()).map(x=>x.match(/^ */)[0].length));
  return l.map(x=>x.slice(ind)).join('\n'); };

/* ---------- builtin block library -------------------------------- */
const P=(name,type,def,opts)=>Object.assign({name,type,def},opts||{});
const IO=(name,type)=>({name,type});
const B=[];
const def=(o)=>{o.builtin=true;o.impl='py';B.push(o);return o;};

/* --- stateless functions (F) --- */
def({id:'and',name:'AND',kind:'F',group:'Logic',ins:[IO('a','bool'),IO('b','bool')],outs:[IO('q','bool')],step:'return bool(a) and bool(b)'});
def({id:'or', name:'OR', kind:'F',group:'Logic',ins:[IO('a','bool'),IO('b','bool')],outs:[IO('q','bool')],step:'return bool(a) or bool(b)'});
def({id:'xor',name:'XOR',kind:'F',group:'Logic',ins:[IO('a','bool'),IO('b','bool')],outs:[IO('q','bool')],step:'return bool(a) != bool(b)'});
def({id:'not',name:'NOT',kind:'F',group:'Logic',ins:[IO('x','bool')],outs:[IO('q','bool')],step:'return not x'});

def({id:'add',name:'ADD',kind:'F',group:'Math',ins:[IO('a','num'),IO('b','num')],outs:[IO('y','num')],step:'return a + b'});
def({id:'sub',name:'SUB',kind:'F',group:'Math',ins:[IO('a','num'),IO('b','num')],outs:[IO('y','num')],step:'return a - b'});
def({id:'mul',name:'MUL',kind:'F',group:'Math',ins:[IO('a','num'),IO('b','num')],outs:[IO('y','num')],step:'return a * b'});
def({id:'div',name:'DIV',kind:'F',group:'Math',ins:[IO('a','num'),IO('b','num')],outs:[IO('y','num')],step:'return (a / b) if b else 0.0'});
def({id:'gt', name:'A > B',kind:'F',group:'Math',ins:[IO('a','num'),IO('b','num')],outs:[IO('q','bool')],step:'return a > b'});
def({id:'lt', name:'A < B',kind:'F',group:'Math',ins:[IO('a','num'),IO('b','num')],outs:[IO('q','bool')],step:'return a < b'});
def({id:'eq', name:'A == B',kind:'F',group:'Math',ins:[IO('a','any'),IO('b','any')],outs:[IO('q','bool')],step:'return a == b'});
def({id:'b2n',name:'BOOL→NUM',kind:'F',group:'Math',ins:[IO('b','bool')],outs:[IO('y','num')],step:'return 1 if b else 0'});
def({id:'sel',name:'SELECT',kind:'F',group:'Math',ins:[IO('s','bool'),IO('a','any'),IO('b','any')],outs:[IO('y','any')],step:'return a if s else b'});
def({id:'scale',name:'SCALE',kind:'F',group:'Math',params:[P('in_lo','num',0),P('in_hi','num',1),P('out_lo','num',0),P('out_hi','num',100)],
  ins:[IO('x','num')],outs:[IO('y','num')],step:dedent(`
    if in_hi == in_lo: return out_lo
    return out_lo + (x - in_lo) * (out_hi - out_lo) / (in_hi - in_lo)`)});
def({id:'clamp',name:'CLAMP',kind:'F',group:'Math',params:[P('lo','num',0),P('hi','num',1)],ins:[IO('x','num')],outs:[IO('y','num')],
  step:'return lo if x < lo else (hi if x > hi else x)'});

/* --- stateful function blocks (FB) --- */
def({id:'pin_in',name:'PIN IN',kind:'FB',group:'I/O',params:[P('pin','int',0),P('pull_up','bool',true),P('invert','bool',true)],
  outs:[IO('q','bool')],
  init:dedent(`
    self.p = Pin(pin, Pin.IN, Pin.PULL_UP) if pull_up else Pin(pin, Pin.IN)
    self.inv = invert`),
  step:dedent(`
    v = bool(self.p.value())
    return (not v) if self.inv else v`)});

def({id:'pin_out',name:'PIN OUT',kind:'FB',group:'I/O',params:[P('pin','int',2)],ins:[IO('d','bool')],outs:[],
  init:'self.p = Pin(pin, Pin.OUT)', step:'self.p.value(1 if d else 0)'});

def({id:'adc',name:'ADC',kind:'FB',group:'I/O',params:[P('pin','int',34)],outs:[IO('v','num')],
  init:dedent(`
    self.a = ADC(Pin(pin))
    try: self.a.atten(ADC.ATTN_11DB)
    except Exception: pass`),
  step:'return self.a.read_u16() / 65535.0'});

def({id:'pwm',name:'PWM',kind:'FB',group:'I/O',params:[P('pin','int',2),P('freq','int',1000)],ins:[IO('duty','num')],outs:[],
  init:dedent(`
    self.p = PWM(Pin(pin))
    try: self.p.freq(freq)
    except Exception: pass`),
  step:dedent(`
    d = 0.0 if duty < 0 else (1.0 if duty > 1 else duty)
    self.p.duty_u16(int(d * 65535))`)});

def({id:'blink',name:'BLINK',kind:'FB',group:'Time',params:[P('period_ms','int',500)],outs:[IO('q','bool')],
  init:'self.t = ticks_ms()\nself.q = False',
  step:dedent(`
    now = ticks_ms()
    if ticks_diff(now, self.t) >= period_ms // 2:
        self.t = now
        self.q = not self.q
    return self.q`)});

def({id:'ticks',name:'TICKS ms',kind:'FB',group:'Time',outs:[IO('ms','num')],init:'pass',step:'return ticks_ms()'});

def({id:'ton',name:'TIMER ON',kind:'FB',group:'Time',params:[P('pt_ms','int',1000)],ins:[IO('x','bool')],outs:[IO('q','bool'),IO('et','num')],
  init:'self.t0 = 0\nself.run = False',
  step:dedent(`
    if x:
        if not self.run:
            self.run = True
            self.t0 = ticks_ms()
        et = ticks_diff(ticks_ms(), self.t0)
        return (et >= pt_ms), et
    self.run = False
    return False, 0`)});

def({id:'counter',name:'COUNTER',kind:'FB',group:'Logic',ins:[IO('up','bool'),IO('rst','bool')],outs:[IO('n','num')],
  init:'self.n = 0\nself.last = False',
  step:dedent(`
    if up and not self.last:
        self.n += 1
    self.last = bool(up)
    if rst:
        self.n = 0
    return self.n`)});

def({id:'toggle',name:'TOGGLE',kind:'FB',group:'Logic',ins:[IO('t','bool')],outs:[IO('q','bool')],
  init:'self.q = False\nself.last = False',
  step:dedent(`
    if t and not self.last:
        self.q = not self.q
    self.last = bool(t)
    return self.q`)});

def({id:'edge',name:'EDGE',kind:'FB',group:'Logic',ins:[IO('x','bool')],outs:[IO('rise','bool'),IO('fall','bool')],
  init:'self.last = False',
  step:dedent(`
    x = bool(x)
    r = x and not self.last
    f = (not x) and self.last
    self.last = x
    return r, f`)});

def({id:'sr',name:'SR LATCH',kind:'FB',group:'Logic',ins:[IO('s','bool'),IO('r','bool')],outs:[IO('q','bool')],
  init:'self.q = False',
  step:dedent(`
    if s: self.q = True
    if r: self.q = False
    return self.q`)});

def({id:'hyst',name:'SCHMITT',kind:'FB',group:'Math',params:[P('lo','num',0.4),P('hi','num',0.6)],ins:[IO('x','num')],outs:[IO('q','bool')],
  init:'self.q = False',
  step:dedent(`
    if x >= hi: self.q = True
    elif x <= lo: self.q = False
    return self.q`)});

def({id:'ema',name:'FILTER (EMA)',kind:'FB',group:'Math',params:[P('alpha','num',0.1)],ins:[IO('x','num')],outs:[IO('y','num')],
  init:'self.y = 0.0',
  step:'self.y = self.y + alpha * (x - self.y)\nreturn self.y'});

def({id:'delay',name:'DELAY z⁻¹',kind:'FB',group:'Logic',breaker:true,params:[P('initial','num',0)],ins:[IO('x','any')],outs:[IO('q','any')],
  init:'self.q = initial', pre:'return self.q', post:'self.q = x'});

def({id:'print',name:'PRINT',kind:'FB',group:'Debug',params:[P('label','str','x'),P('on_change','bool',true)],ins:[IO('x','any')],outs:[],
  init:'self.p = None',
  step:dedent(`
    if (not on_change) or x != self.p:
        self.p = x
        _log("%s = %s" % (label, x))`)});

const BUILTIN = {}; B.forEach(t=>BUILTIN[t.id]=t);

/* ---------- project ---------------------------------------------- */
function emptyProject(){
  return { name:'untitled', types:{}, vars:[], main:{nodes:[],wires:[]}, scan_ms:20, tele_ms:100 };
}
let P_ = emptyProject();

const typeOf = id => BUILTIN[id] || P_.types[id];
const allTypes = () => Object.assign({}, BUILTIN, P_.types);

function newType(kind){
  const id = uid('t');
  const t = { id, name: (kind==='F'?'MyFunc':'MyBlock')+id.slice(1), kind, impl:'py', group:'User',
    ins:[IO('a', 'num')], outs:[IO('y','num')], params:[],
    init: kind==='FB' ? 'self.n = 0' : undefined,
    step: kind==='FB' ? 'self.n += a\nreturn self.n' : 'return a * 2',
    graph:{nodes:[],wires:[]} };
  P_.types[id]=t; return t;
}

/* ---------- geometry (everything lives on the grid) --------------- */
const GRID=20, HDR=GRID, ROW=GRID;
const MINGAP=2*GRID;      // a downstream block sits at least two units clear of its source
const LEFT_MARGIN=2*GRID; // every dataflow root (nothing forward-feeds it) aligns to this x — no free-floating starts
const TOP_MARGIN=2*GRID;  // row 0 starts here
const snap = v => Math.round(v/GRID)*GRID;
function portsOf(n){
  if(n.k==='blk'){ const t=typeOf(n.type); if(!t) return {ins:[],outs:[]};
    return {ins:(t.ins||[]).slice(), outs:(t.outs||[]).slice()}; }
  if(n.k==='const') return {ins:[], outs:[IO('', n.vtype||'num')]};
  if(n.k==='vget'){ const v=P_.vars.find(v=>v.name===n.varName); return {ins:[],outs:[IO('', v?v.type:'any')]}; }
  if(n.k==='vset'){ const v=P_.vars.find(v=>v.name===n.varName); return {ins:[IO('', v?v.type:'any')],outs:[]}; }
  if(n.k==='var'){ const v=P_.vars.find(v=>v.name===n.varName); const ty=v?v.type:'any'; return {ins:[IO('',ty)], outs:[IO('',ty)]}; }
  if(n.k==='gin'){ const t=typeOf(n.owner); return {ins:[],outs:[IO(t&&t.ins[n.pi]?t.ins[n.pi].name:'?', t&&t.ins[n.pi]?t.ins[n.pi].type:'any')]}; }
  if(n.k==='gout'){ const t=typeOf(n.owner); return {ins:[IO(t&&t.outs[n.pi]?t.outs[n.pi].name:'?', t&&t.outs[n.pi]?t.outs[n.pi].type:'any')],outs:[]}; }
  return {ins:[],outs:[]};
}
function nodeTitle(n){
  if(n.k==='blk'){ const t=typeOf(n.type); return t?t.name:'?? '+n.type; }
  if(n.k==='const') return 'CONST';
  if(n.k==='vget') return '\u21a6 '+n.varName;
  if(n.k==='vset') return n.varName+' \u21a4';
  if(n.k==='var') return n.varName;
  if(n.k==='gin') return 'IN';
  if(n.k==='gout') return 'OUT';
}
function nodeKindClass(n){
  if(n.k==='blk'){ const t=typeOf(n.type); return 'k-'+(t?t.kind:'F'); }
  if(n.k==='const') return 'k-const';
  if(n.k==='gin'||n.k==='gout') return 'k-io';
  return 'k-var';
}
function hasField(n){ return n.k==='const'; }
function nodeSize(n){
  const p=portsOf(n), rows=Math.max(p.ins.length,p.outs.length,1);
  let w = n.w || Math.max(120, nodeTitle(n).length*7.6+54);
  if(n.k==='blk'){ const t=typeOf(n.type);
    const lw = Math.max(...p.ins.map(x=>x.name.length),0)*6.5, rw=Math.max(...p.outs.map(x=>x.name.length),0)*6.5;
    w = Math.max(w, lw+rw+62, (t?t.name.length:4)*7.6+54); }
  w = Math.ceil(w/GRID)*GRID;                       // width is a whole number of cells
  let h = GRID*(rows+2);                            // header cell + one cell per port row + margin
  if(hasField(n)) h += GRID;
  return {w,h};
}
/* port centres always land on a grid intersection */
function portPos(n, side, i){
  const s=nodeSize(n);
  return { x: n.x + (side==='in'?0:s.w), y: n.y + GRID*(2+i) };
}
/* a wire that does not travel strictly left-to-right is a feedback wire:
   it carries the PREVIOUS scan's value. Because every forward wire strictly
   increases x, the forward-only graph can never contain a cycle. */
function wireBack(graph,w){
  const a=graph.nodes.find(n=>n.id===w.f[0]), b=graph.nodes.find(n=>n.id===w.t[0]);
  if(!a||!b) return false;
  return portPos(b,'in',w.t[1]).x <= portPos(a,'out',w.f[1]).x;
}
/* the wire's recorded type. Geometry decides it at creation; after that the
   editor guarantees geometry keeps agreeing (drags are clamped, widening
   blocks push their dependents right). */
function isBack(graph,w){ return (w.back===undefined)? wireBack(graph,w) : !!w.back; }
function tagWires(graph){ (graph.wires||[]).forEach(w=>{ if(w.back===undefined) w.back=wireBack(graph,w); }); }
function tagProject(p){ tagWires(p.main); Object.values(p.types||{}).forEach(t=>t.graph&&tagWires(t.graph)); }

/* --- moving a block carries everything it feeds ------------------- */
function forwardClosure(graph, seeds){
  const set=new Set(seeds), q=[...seeds];
  while(q.length){ const id=q.shift();
    for(const w of graph.wires){
      if(w.f[0]!==id || isBack(graph,w) || set.has(w.t[0])) continue;
      if(!graph.nodes.find(n=>n.id===w.t[0])) continue;
      set.add(w.t[0]); q.push(w.t[0]); } }
  return set;
}
/* --- layout: a pure function from graph structure to (x,y) ---------------
   No position is ever "corrected" — every render recomputes every block's x
   and y from scratch, from two things only:

   x  dependency depth along forward wires: a block sits exactly MINGAP right
      of the rightmost thing that forward-feeds it. Nothing with no forward
      source floats free — it pins to LEFT_MARGIN. Single deterministic pass
      in topological order; nothing to iterate or converge.

   y  a row number driven purely by graph.nodes' array order — the only place
      "where things are relative to each other" is recorded at all. A block
      chained by exactly one forward wire to a single consumer keeps its
      source's row (a straight run reads as one line); a fan-out gives every
      further branch, and every root with nothing feeding it, the next free
      row, in the order they appear in the array. Reordering that array —
      what a drag commits — is the only thing that changes a row. Cutting a
      wire elsewhere never moves a row that wasn't touched: at worst later
      rows shift down to make space for a block that just became its own
      root, exactly the way inserting a line shifts the ones below it. An
      island's own position is never touched by disconnecting it from
      another island — nothing about the array changes when a wire is cut.

   Two blocks can only ever share a row by being on the same forward chain,
   and x strictly increases along a chain, so row-sharing can never overlap —
   there is no separate collision pass because there is nothing left for one
   to catch. */
function topoForwardOrder(graph){
  const ids=graph.nodes.map(n=>n.id);
  const indeg={}, adj={};
  ids.forEach(id=>{indeg[id]=0; adj[id]=[];});
  for(const w of graph.wires){
    if(!(w.f[0] in adj)||!(w.t[0] in indeg)) continue;
    if(isBack(graph,w)) continue;
    adj[w.f[0]].push(w.t[0]); indeg[w.t[0]]++;
  }
  const q=ids.filter(id=>indeg[id]===0), order=[];
  while(q.length){ const id=q.shift(); order.push(id); for(const m of adj[id]) if(--indeg[m]===0) q.push(m); }
  if(order.length<ids.length) for(const id of ids) if(!order.includes(id)) order.push(id);
  return order;
}
function layoutX(graph){
  for(const id of topoForwardOrder(graph)){
    const n=graph.nodes.find(x=>x.id===id); if(!n) continue;
    let required=-Infinity, cap=Infinity;
    for(const w of graph.wires){
      if(w.t[0]!==id) continue;
      const s=graph.nodes.find(x=>x.id===w.f[0]); if(!s) continue;
      if(isBack(graph,w)) cap=Math.min(cap, portPos(s,'out',w.f[1]).x);         // stay left of the feedback source
      else required=Math.max(required, portPos(s,'out',w.f[1]).x+MINGAP);      // exactly MINGAP clear, never more
    }
    if(required===-Infinity){
      if(n.k==='gin'||n.k==='gout') continue;             // graph-boundary pins keep their own placement
      n.x=LEFT_MARGIN;                                     // a dataflow root — pinned, not free
      continue;
    }
    n.x=snap(Math.min(required,cap));
  }
}
/* every node's row: 0,1,2,... in the order graph.nodes drives them into being */
function layoutRows(graph){
  const rowOf={};
  let nextRow=0;
  const arrayIndex={}; graph.nodes.forEach((n,i)=>arrayIndex[n.id]=i);
  const forwardOutsOf=id=>{
    const seen=new Set(), outs=[];
    for(const w of graph.wires){
      if(w.f[0]!==id||isBack(graph,w)||seen.has(w.t[0])||!(w.t[0] in arrayIndex)) continue;
      seen.add(w.t[0]); outs.push(w.t[0]);
    }
    outs.sort((a,b)=>arrayIndex[a]-arrayIndex[b]);          // deterministic: earlier in the array = first branch
    return outs;
  };
  const place=(id,row)=>{
    if(rowOf[id]!==undefined) return;
    rowOf[id]=row;
    forwardOutsOf(id).forEach((cid,i)=>{ if(i===0) place(cid,row); else place(cid,++nextRow); });
  };
  const hasForwardIn=id=>graph.wires.some(w=>w.t[0]===id && !isBack(graph,w) && (w.f[0] in arrayIndex));
  for(const n of graph.nodes){ if(rowOf[n.id]!==undefined||hasForwardIn(n.id)) continue; place(n.id,nextRow); nextRow++; }
  for(const n of graph.nodes){ if(rowOf[n.id]===undefined){ place(n.id,nextRow); nextRow++; } }  // multi-input / fed-from-later
  return rowOf;
}
function layoutY(graph){
  const rowOf=layoutRows(graph);
  const rowH={};
  for(const n of graph.nodes){ const r=rowOf[n.id]; rowH[r]=Math.max(rowH[r]||0, nodeSize(n).h); }
  const rowY={}; let y=TOP_MARGIN;
  const maxRow=Object.keys(rowH).reduce((m,r)=>Math.max(m,+r),-1);
  for(let r=0;r<=maxRow;r++){ rowY[r]=y; y+=(rowH[r]||GRID)+GRID; }
  for(const n of graph.nodes) n.y=rowY[rowOf[n.id]];
}
/* w.back is a structural fact, decided once when the wire is made (see
   connect() in editor.js) and stored — never re-derived from geometry here.
   Re-deriving it from the x/y this very function is about to compute would
   be circular: a brand-new wire between two still-unpositioned blocks has no
   geometry yet to read a direction off. wireBack() stays available for the
   one place that legitimately needs a geometric guess: bootstrapping .back
   for a project file saved before it existed (see tagWires). */
function computeLayout(graph){
  layoutX(graph);
  layoutY(graph);
}
function snapNode(n){ n.x=snap(n.x); n.y=snap(n.y); return n; }
function snapGraph(g){ (g.nodes||[]).forEach(snapNode); }
function snapProject(p){ snapGraph(p.main); Object.values(p.types||{}).forEach(t=>t.graph&&snapGraph(t.graph)); }
