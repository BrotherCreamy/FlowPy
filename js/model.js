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
/* how far the moving set may slide in x before some wire would change type */
function dxBounds(graph, movers){
  let lo=-Infinity, hi=Infinity;
  for(const w of graph.wires){
    const s=graph.nodes.find(n=>n.id===w.f[0]), d=graph.nodes.find(n=>n.id===w.t[0]);
    if(!s||!d) continue;
    const ms=movers.has(s.id), md=movers.has(d.id);
    if(ms===md) continue;                                   // both move, or neither
    const ox=portPos(s,'out',w.f[1]).x, ix=portPos(d,'in',w.t[1]).x;
    const back=isBack(graph,w);
    if(ms){ if(back) lo=Math.max(lo, ix-ox); else hi=Math.min(hi, ix-ox-MINGAP); }
    else  { if(back) hi=Math.min(hi, ox-ix); else lo=Math.max(lo, ox-ix+MINGAP); }
  }
  return {lo:Math.min(0,lo), hi:Math.max(0,hi)};   // a drag can always start
}
/* --- automatic layout: no arbitrarily long wires, no overlapping blocks ---
   Two passes, iterated to a fixpoint:
   compactForward()  pulls every block with a forward incoming wire to the
                      exact minimum x its sources require — never more slack
                      than MINGAP, never less. Backward (feedback) wires are
                      never used as a lower bound, and a block on the
                      receiving end of a backward wire is capped so the pull
                      can never flatten that wire into a same-scan one.
   resolveOverlaps()  keeps every pair of blocks at least GRID apart. Blocks
                      whose x is owned by compactForward (they have a forward
                      incoming wire) are only ever separated along y — x stays
                      exactly where compactForward put it. Free blocks (no
                      forward incoming wire) can be pushed on either axis,
                      whichever needs the smaller nudge.                    */
function topoForwardOrder(graph){
  const ids=graph.nodes.map(n=>n.id);
  const indeg={}, adj={};
  ids.forEach(id=>{indeg[id]=0; adj[id]=[];});
  for(const w of graph.wires){
    if(!(w.f[0] in adj)||!(w.t[0] in indeg)) continue;
    if(wireBack(graph,w)) continue;
    adj[w.f[0]].push(w.t[0]); indeg[w.t[0]]++;
  }
  const q=ids.filter(id=>indeg[id]===0), order=[];
  while(q.length){ const id=q.shift(); order.push(id); for(const m of adj[id]) if(--indeg[m]===0) q.push(m); }
  if(order.length<ids.length) for(const id of ids) if(!order.includes(id)) order.push(id);
  return order;
}
function compactForward(graph){
  let changed=false;
  for(const id of topoForwardOrder(graph)){
    const n=graph.nodes.find(x=>x.id===id); if(!n) continue;
    let required=-Infinity, cap=Infinity;
    for(const w of graph.wires){
      if(w.t[0]!==id) continue;
      const s=graph.nodes.find(x=>x.id===w.f[0]); if(!s) continue;
      if(wireBack(graph,w)) cap=Math.min(cap, portPos(s,'out',w.f[1]).x);       // stay left of the feedback source
      else required=Math.max(required, portPos(s,'out',w.f[1]).x+MINGAP);      // exactly MINGAP clear, never more
    }
    if(required===-Infinity){
      if(n.k==='gin'||n.k==='gout') continue;             // graph-boundary pins keep their own placement
      if(n.x!==LEFT_MARGIN){ n.x=LEFT_MARGIN; changed=true; }
      continue;                                            // a dataflow root — no forward source to align to
    }
    const nx=snap(Math.min(required,cap));
    if(nx!==n.x){ n.x=nx; changed=true; }
  }
  return changed;
}
function rectOf(n){ const s=nodeSize(n); return {x0:n.x,y0:n.y,x1:n.x+s.w,y1:n.y+s.h}; }
function resolveOverlaps(graph, fixedIds, xLockedIds){
  const fixed=new Set(fixedIds||[]), xLocked=xLockedIds||new Set();
  const nodes=graph.nodes;
  let changed=false;
  for(let pass=0; pass<40; pass++){
    let movedThisPass=false;
    for(let i=0;i<nodes.length;i++) for(let j=0;j<nodes.length;j++){
      if(i===j) continue;
      const a=nodes[i], b=nodes[j];
      if(fixed.has(b.id)) continue;
      const ra=rectOf(a), rb=rectOf(b);
      const xOverlap=Math.min(ra.x1,rb.x1)-Math.max(ra.x0,rb.x0);
      const yOverlap=Math.min(ra.y1,rb.y1)-Math.max(ra.y0,rb.y0);
      const penX=GRID+xOverlap, penY=GRID+yOverlap;
      if(penX<=0||penY<=0) continue;                       // already at least GRID clear on one axis
      const canX=!xLocked.has(b.id);
      if(canX&&penX<=penY){
        const dir=((rb.x0+rb.x1)>=(ra.x0+ra.x1))?1:-1;
        b.x=snap(b.x+dir*penX);
      } else {
        const dir=((rb.y0+rb.y1)>=(ra.y0+ra.y1))?1:-1;
        b.y=snap(b.y+dir*penY);
      }
      movedThisPass=true; changed=true;
    }
    if(!movedThisPass) break;
  }
  return changed;
}
/* run both passes to a fixpoint, then refresh every wire's forward/back tag
   against the settled geometry. fixedIds (optional) are blocks that must not
   themselves be displaced by the overlap pass — e.g. the block someone is
   actively dragging displaces others, not itself. */
function hasOverlap(graph){
  const nodes=graph.nodes;
  for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++){
    const ra=rectOf(nodes[i]), rb=rectOf(nodes[j]);
    const xOverlap=Math.min(ra.x1,rb.x1)-Math.max(ra.x0,rb.x0);
    const yOverlap=Math.min(ra.y1,rb.y1)-Math.max(ra.y0,rb.y0);
    if(GRID+xOverlap>0 && GRID+yOverlap>0) return true;
  }
  return false;
}
function relayout(graph, fixedIds){
  const xLocked=new Set();
  for(const w of graph.wires) if(!wireBack(graph,w)) xLocked.add(w.t[0]);
  let any=false;
  for(let i=0;i<8;i++){
    const c=compactForward(graph);
    const o=resolveOverlaps(graph, fixedIds, xLocked);
    if(c||o) any=true;
    if(!c&&!o) break;
  }
  /* a block sandwiched between a fixed anchor and an unmoved neighbour on the
     other side can deadlock a purely local, pairwise push (each side wants it
     to yield in the opposite direction). If anything is still overlapping,
     fall back to a fully free pass — the diagram must never settle on a
     collision, even if that means nudging the anchor's own chain too. */
  if(hasOverlap(graph)){
    for(let i=0;i<8;i++){
      const c=compactForward(graph);
      const o=resolveOverlaps(graph, null, xLocked);
      if(!c&&!o) break;
    }
    any=true;
  }
  graph.wires.forEach(w=>{ w.back=wireBack(graph,w); });
  return any;
}
function snapNode(n){ n.x=snap(n.x); n.y=snap(n.y); return n; }
function snapGraph(g){ (g.nodes||[]).forEach(snapNode); }
function snapProject(p){ snapGraph(p.main); Object.values(p.types||{}).forEach(t=>t.graph&&snapGraph(t.graph)); }
