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

/* connections are not 1:1. A wire fed by more than one output is one input
   receiving two different values that need combining — that always takes a
   real computation, so it gets a real, ordinary merge block spliced in: OR
   for a boolean input, ADD (defined above) for a numeric one — see
   mergeKindFor() in editor.js, which auto-inserts either one to look and
   behave exactly like dragging it in by hand.
   A wire feeding more than one input is the opposite case: every consumer
   wants the exact same value, which is just a wire branching — no block,
   hidden or otherwise, needed at all. codegen already assigns every
   block's output to its own named variable regardless of how many wires
   read it (outVar() in codegen.js), so that's the "hidden variable" — it
   already existed; only the router's fan-out trimming (js/router.js) was
   needed to draw the branch instead of retracing it once per consumer. */
/* legacy only — the boolean merge case above used to auto-insert this
   hidden lookalike instead of a real OR; kept, still hidden from the
   palette, purely so a project saved back then still renders and
   simulates correctly. Nothing creates a new one anymore. */
def({id:'netor',name:'•',kind:'F',hidden:true,group:'Logic',ins:[IO('a','bool'),IO('b','bool')],outs:[IO('q','bool')],step:'return bool(a) or bool(b)'});

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
/* GRID is the fine positioning lattice — block corners, port positions,
   and wire routing all live on it, and (per explicit spec) a block's
   corners can now land on ANY multiple of GRID, not just every other
   one. LANE is the old GRID (double this one) kept as its own name for
   every constant that's really about visual rhythm/clearance rather than
   the positioning lattice itself — block-to-block spacing, wire lanes,
   canvas margins — so halving GRID doesn't also halve those on its own;
   they're expressed as multiples of LANE specifically so their PIXEL
   values stay exactly what they were before this file went to a finer
   grid. */
const GRID=10;
const LANE=2*GRID;
const MINGAP=LANE;        // a downstream block sits at least one unit clear of its source
const LEFT_MARGIN=2*LANE; // every dataflow root (nothing forward-feeds it) aligns to this x — no free-floating starts
const TOP_MARGIN=2*LANE;  // row 0 starts here
const VGAP=LANE;          // vertical clearance between rows
const VPAD=GRID;          // gap between the title bar's own bottom edge and the first port row — see portPos()/layoutY() below
const snap = v => Math.round(v/GRID)*GRID;

/* ---------- content measurement — sizing happens BEFORE rendering ---
   Every block dimension (header height, port-row height, block width) is
   derived from how big its actual content really is, measured with a
   real canvas text metric (not a per-character pixel guess), then rounded
   UP to the next whole GRID unit. Sizing has to fully resolve before
   buildNode() ever runs — the router and layoutX/Y need every node's
   final width/height before any DOM exists at all, and ports/labels need
   to render flush against the block's ACTUAL edges once it does — so this
   stays a synchronous, DOM-free computation (a canvas 2D context can
   measure text without ever attaching an element to the page), not a
   render-then-measure-then-relayout cycle. */
const MONO_STACK='ui-monospace,"SF Mono","Cascadia Mono","JetBrains Mono","IBM Plex Mono",Menlo,Consolas,"Liberation Mono",monospace';
const TITLE_SIZE=13.2;                                // 11px * 1.2 — named so computeBadgeSize() below can derive from it rather than re-guessing the number
const FONT_TITLE=`300 ${TITLE_SIZE}px Sono, ${MONO_STACK}`;   // matches css .hd .ttl / .hd-bar
const FONT_LABEL=FONT_TITLE;                          // matches css .plabel — same font/weight/size as the title, per explicit request
let _measureCtx=null;
function measureCtx(){
  if(!_measureCtx) _measureCtx=document.createElement('canvas').getContext('2d');
  return _measureCtx;
}
function textWidth(text,font){
  const ctx=measureCtx(); ctx.font=font;
  return ctx.measureText(text||'').width;
}
/* real glyph-based ascent+descent for one line of a font, at whatever
   size is already baked into the font string — not an assumed
   line-height multiplier. Uses a representative string with both
   ascenders and descenders (a flat number/letter has no descender, which
   would understate real line height for anything that does). */
function textLineHeight(font){
  const ctx=measureCtx(); ctx.font=font;
  const m=ctx.measureText('Mgy0');
  return (m.actualBoundingBoxAscent||8)+(m.actualBoundingBoxDescent||3);
}
/* HDR (header slot height) and ROW (port-row height) are each computed
   ONCE — every header and every port row uses identical styling
   (font/padding never vary by content), so they're globally uniform
   constants, not something to remeasure per node. Cached lazily since
   Sono may not be loaded yet at first script evaluation; see
   invalidateSizeCache() below for the re-measure-after-fonts-load path. */
let _HDR=null, _ROW=null;
const HD_VPAD=2, ROW_VPAD=1;   // deliberate design padding, in px — the only hand-picked numbers left, and they're spacing choices, not measurements pretending to be exact
function computeHDR(){ return Math.ceil((textLineHeight(FONT_TITLE)+HD_VPAD*2)/GRID)*GRID; }
/* the row's real, un-ceiled content height — ROW_() below is this rounded
   UP to a whole GRID unit (needed so consecutive ports land exactly GRID
   apart), but blockH() below also needs the real, un-rounded value: it's
   how tall a row's label actually needs to render, independent of how
   much grid-alignment padding got rounded on top of that. */
function natRow(){ return Math.max(textLineHeight(FONT_LABEL),PORT_SIZE)+ROW_VPAD*2; }
function computeROW(){ return Math.ceil(natRow()/GRID)*GRID; }
function HDR_(){ return _HDR===null ? (_HDR=computeHDR()) : _HDR; }
function ROW_(){ return _ROW===null ? (_ROW=computeROW()) : _ROW; }
/* the badge's own font-size — same font/weight as the title (Sono,
   300), just scaled DOWN enough that the badge's own rectangle (its
   text line-height plus its own padding+border — see badgeH() below)
   comes out roughly the same height as the title text's own real glyph
   extent, not smaller or larger. Computed, not guessed: measures the
   title's real line-height at TITLE_SIZE, works out how much smaller a
   Sono string needs to render to leave exactly badgeH()'s non-text
   overhead (padding+border) of room within that same span, assuming
   line-height scales linearly with font-size for a fixed font (true for
   any real typeface's ascent/descent metrics). */
/* badge padding/border, in px — deliberate design spacing (like HD_VPAD/
   ROW_VPAD above), not measurements. Kept as named constants specifically
   so computeBadgeSize()/badgeWidth()/badgeH() (below) and the CSS badge
   rule in style.css can never drift apart the way JS/CSS constants have
   before in this file (see the PORT_GAP bug note elsewhere) — if these
   ever change, they only need to change in one place here, matched once
   in the CSS padding declaration. */
const BADGE_VPAD=0, BADGE_HPAD=1, BADGE_BORDER=1;
let _BADGE_SIZE=null;
function computeBadgeSize(){
  const titleLH=textLineHeight(FONT_TITLE);
  const overhead=2*BADGE_VPAD+2*BADGE_BORDER;   // badge's own padding + nominal border, top+bottom — must match badgeH()'s own formula
  const targetLH=Math.max(4,titleLH-overhead);
  return Math.round(targetLH/titleLH*TITLE_SIZE*10)/10;
}
function BADGE_SIZE_(){ return _BADGE_SIZE===null ? (_BADGE_SIZE=computeBadgeSize()) : _BADGE_SIZE; }
function FONT_BADGE(){ return `300 ${BADGE_SIZE_()}px Sono, ${MONO_STACK}`; }
/* called once fonts are confirmed loaded (see editor.js bootstrap) — the
   very first layout pass may have measured Sono's fallback instead of
   Sono itself; this clears the cache so the next render re-measures for
   real and self-corrects, rather than leaving a slightly-wrong constant
   baked in for the rest of the session. */
function invalidateSizeCache(){ _HDR=null; _ROW=null; _BADGE_SIZE=null; }
const PORT_SIZE=8, PORT_GAP=8;       // css .port width + the icon-to-label gap within a row (css .prow{gap:8px}) — keep in sync
const MEASURE_SLOP=2;                // canvas measureText() and actual DOM text layout don't agree to the sub-pixel; a small margin keeps the ceil() snap from landing exactly on the edge of clipping
const ROW_HPAD=6, ROW_MINGAP=LANE;   // body's own left/right inset, and the minimum daylight between the ins/outs columns when a block has both
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
/* badge width: real text width plus its own padding/border, matching css
   .hd .badge exactly. Only blk nodes with a type ever render one. */
function badgeWidth(n){
  if(n.k!=='blk') return 0;
  const t=typeOf(n.type); if(!t) return 0;
  return textWidth(t.kind,FONT_BADGE())+2*BADGE_HPAD+2*BADGE_BORDER;
}
/* badge's own real rendered height (padding+nominal border, top+bottom,
   matching css .hd .badge exactly) — used to inset the badge from the
   title bar's left edge by exactly the same amount it's already inset
   from the top/bottom via centering (see .hd-bar's padding-left in
   style.css), rather than an unrelated, independently-chosen left
   padding value. */
function badgeH(){ return textLineHeight(FONT_BADGE())+2*BADGE_VPAD+2*BADGE_BORDER; }
/* half the leftover space between the title bar's own height and the
   badge's real rendered height — that's exactly how far align-items:
   center already pushes the badge down from the bar's top edge, so
   using the same value as the bar's own left padding makes the gap on
   all three non-title sides of the badge equal, by construction, not by
   eyeballing a matching pixel value. */
function badgeInset(){ return Math.max(0,(HDR_()-badgeH())/2); }
/* one port row's natural content width: the port icon, the gap to its
   label, and the label's real measured text width. Zero if the row has
   no name (an unlabelled port still reserves its own icon-width column
   so the port itself has somewhere to sit). */
function rowContentWidth(pt){
  if(!pt||!pt.name) return PORT_SIZE;
  return PORT_SIZE+PORT_GAP+textWidth(pt.name,FONT_LABEL);
}
/* The block's port-bearing "reference" height — row-to-row stacking
   (layoutY) and the block's own rendered height (nodeSize, below VPAD)
   are both anchored to this, unaffected by VPAD. Centralized here so the
   two call sites can never drift apart the way the JS/CSS PORT_GAP
   constant once did (see the earlier bug note for that).

   Row i's grid line (portPos()'s i*ROW_() term) only needs its OWN row's
   flow-box to reach ROW_() past the PREVIOUS row's grid line — never past
   its own. Every row except the truly last one still needs a full ROW_()
   flow contribution (ports must land exactly GRID apart), but the LAST
   row is different: nothing comes after it, so its own flow-box only
   needs to be as tall as its real, un-ceiled content requires — see
   natRow() above — not a whole spare GRID unit. hasField blocks (CONST)
   are the one exception: their single row also hosts an editable value
   input (see editor.js), which needs the full ROW_() the way it always
   has, not the tighter label/port sizing.

   Rounding the whole natural sum up to one GRID unit in one step (same
   as nodeSize()'s own width, and the very first sizing rule this file
   ever established) is what keeps h a whole GRID multiple, which is all
   that's required now that block corners can land on any grid point —
   n.y is already GRID-exact (layoutY()) and adding a GRID-exact h keeps
   n.y+h GRID-exact too, with no need for the top/bottom edges to match
   any particular PHASE the way they did before grid density doubled.
   The rounding remainder IS the visible bottom breathing room; no
   second, separately-reserved VPAD term is needed the way an earlier
   version of this function used, which forced every block a full extra
   LANE taller than necessary. */
function blockH(n){
  const p=portsOf(n), rows=Math.max(p.ins.length,p.outs.length,1);
  const trailing=hasField(n) ? ROW_() : Math.max(PORT_SIZE,natRow()/2);
  const natural=VPAD+HDR_()+(rows-1)*ROW_()+trailing;
  return Math.ceil(natural/GRID)*GRID;
}
function nodeSize(n){
  const p=portsOf(n);
  let w;
  if(n.w){ w=n.w; }
  else{
    const badgeW=badgeWidth(n);
    const hbarPad=badgeW?badgeInset()+6:2*6;   // badge-bearing kinds use badgeInset() on the left (css .k-FB/.k-F .hd-bar), everyone else the plain symmetric 6px
    const titleW=(badgeW?badgeW+5:0)+textWidth(nodeTitle(n),FONT_TITLE)+hbarPad;      // +5 gap, matching css
    const insW=Math.max(0,...p.ins.map(rowContentWidth));
    const outsW=Math.max(0,...p.outs.map(rowContentWidth));
    const bodyW=(insW||outsW) ? insW+ROW_MINGAP+outsW+2*ROW_HPAD : 0;
    w=Math.max(titleW,bodyW)+MEASURE_SLOP;
  }
  w=Math.ceil(w/GRID)*GRID;                          // width is a whole number of cells
  const h=blockH(n);
  return {w,h};
}
/* hasField blocks (CONST) share their field with the port's own row
   (see editor.js's pfield positioning) rather than a dedicated row below
   it — CONST only ever has one port and one field, so there's nothing to
   separate them for. */
/* port centres land exactly on a grid intersection — no per-port padding
   needed to make that true, since block corners are themselves allowed
   to be on ANY multiple of GRID (the whole point of this file's grid
   being twice as fine as the visual LANE spacing — see the const block
   above). HDR_()/ROW_() are measured-then-ceiled constants (see above),
   not a bare GRID assumption — they only equal LANE (2*GRID) because the
   content that determines them (11px text, an 8px port icon, a couple
   px of padding) comfortably fits inside one LANE once rounded up to
   GRID; if content ever needed more room, they'd become whatever whole
   multiple of GRID it takes, and every consumer of them (this function,
   buildNode) stays correct without any further change.

   Row i's y is n.y + VPAD + HDR_() + i*ROW_(): the title block is
   exactly HDR_() tall, starting flush at n.y (no gap before it); VPAD —
   now just one GRID unit, not a half-grid offset the way it used to be
   before block corners could land on any grid point — is the gap AFTER
   the title, between its bottom edge and the first row, which is what
   gives the first row's port/label real clearance from the title bar
   instead of landing flush against it (see .body's margin-top in
   style.css). n.y itself is simply this row's accumulated position
   (layoutY() below) — GRID-exact by construction, no offset/cancelling
   needed against it now that a block's own top/bottom edges no longer
   have to satisfy a stricter "same half-grid phase" requirement than
   the ports inside them do. */
function portPos(n, side, i){
  const s=nodeSize(n);
  return { x: n.x + (side==='in'?0:s.w), y: n.y + VPAD + HDR_() + i*ROW_() };
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
/* the whole tree a block belongs to: everything reachable ignoring wire
   direction — forward and feedback both count, since it's one connected
   structure regardless of which way any given edge in it runs. */
function treeOf(graph, seeds){
  const set=new Set(seeds), q=[...seeds];
  while(q.length){ const id=q.shift();
    for(const w of graph.wires){
      if(w.f[0]===id && !set.has(w.t[0])){ set.add(w.t[0]); q.push(w.t[0]); }
      if(w.t[0]===id && !set.has(w.f[0])){ set.add(w.f[0]); q.push(w.f[0]); }
    } }
  return set;
}
/* whether grabbing this block and reordering it (the branch-level case
   dragPreview's own comment describes — not a whole-tree swap, which no
   longer visibly moves anything under free tree positioning) has ANY
   valid target to swap with at all. Mirrors dragPreview's own non-alt,
   in-band scoping exactly: everything this block forward-feeds is what
   would move together (movers); the rest of its tree, minus movers' own
   ancestors (a producer can never be reordered before its own consumer —
   see dragPreview's fuller comment), is the pool of legal swap targets.
   Empty pool means reordering this block can only ever hold at the
   original order — a straight, unbranched chain with nothing else
   sharing its tree is the common case, but any block whose whole tree IS
   its own forward closure qualifies, not just literal roots. */
function hasReorderTarget(graph,id){
  const movers=forwardClosure(graph,[id]);
  const myTree=treeOf(graph,[id]);
  const scope=[...myTree].filter(x=>!movers.has(x)).filter(x=>{
    const reach=forwardClosure(graph,[x]);
    for(const m of movers) if(reach.has(m)) return false;
    return true;
  });
  return scope.length>0;
}
/* a block with nothing forward-feeding it — the one kind of block that can
   be dragged to move its whole tree freely (see startFreeDrag in
   editor.js) rather than reordering branches within it. Same notion of
   "root" layoutX uses below (see its own required===-Infinity branch and
   positionFloatingRoots), exposed here as its own function so the drag
   code doesn't have to re-derive it. */
function isRoot(graph,id){
  return !graph.wires.some(w=>w.t[0]===id && !isBack(graph,w));
}
/* every connected component of graph.nodes (ignoring wire direction, same
   as treeOf), each handed back as its own small {nodes,wires} subgraph —
   this is what lets computeLayout below lay each tree out in its own
   local coordinate space, independent of every other tree, instead of
   auto-stacking all of them beneath one shared LEFT_MARGIN/TOP_MARGIN the
   way this file used to. A group's nodes keep graph.nodes' relative order
   (Array.filter preserves it), so group.nodes[0] is always "whichever
   member of this tree has the earliest array position" — the same
   "earliest array position is canonical" rule layoutRows already uses
   (see its own firstIndex) — which is what makes group.nodes[0] a stable,
   well-defined anchor for the tree's own offset below. */
function treeGroups(graph){
  const seen=new Set(), groups=[];
  for(const n of graph.nodes){
    if(seen.has(n.id)) continue;
    const ids=treeOf(graph,[n.id]);
    ids.forEach(id=>seen.add(id));
    groups.push({
      nodes: graph.nodes.filter(x=>ids.has(x.id)),
      wires: graph.wires.filter(w=>ids.has(w.f[0])&&ids.has(w.t[0]))
    });
  }
  return groups;
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
/* the corridor between a source and one of its forward targets needs a
   column of its own for every wire that has to bend through it — never just
   one MINGAP's worth, no matter how many unrelated wires end up sharing it.
   Two separate things add columns:
   1. any OTHER forward consumer of the same source: a consumer not on the
      source's own row pulls a wire down (or up) through this same gap on
      its way to wherever it's actually going (one extra column each).
   2. any OTHER input of the target fed from a DIFFERENT source that isn't
      aligned to arrive on the same row as that input: that wire also has
      to bend through this same gap on its way in (one extra column each).
   3. any wire ELSEWHERE in the graph that isn't part of this source/target
      pair at all, but has to cross this same gap in passing — its own
      source sits at or before s's column, and its own target sits at or
      after n's column, so wherever it actually gets routed, it has no way
      to avoid this stretch (one extra column each). This needs REAL x, not
      topological order — two siblings fed by the same source can need
      different amounts of their own clearance (exactly what point 2 above
      computes) and so land in a different x order than the order they were
      processed in; topological order isn't a safe proxy for that. Real x
      isn't available for anything at or after n on a single forward pass
      though, so layoutX below runs this whole computation twice: once to
      get everyone's provisional x (blind to crossing wires, `prior` is
      null below), then again using the first pass's positions as `prior`
      to detect crossings for real. Two fixed passes, not an open-ended
      "check and correct" loop — still a pure function of graph structure,
      always converges in exactly two evaluations, same as this codebase's
      general layout philosophy requires everywhere else.
   Without all three counted together, the router is left trying to fit
   more wires through the gap than it was ever given room for — routing can
   still find A path in the squeeze, but never a clean, consistent one; the
   fix belongs here; a router can't manufacture space that was never laid
   out for it. */
function corridorGap(graph,s,n,prior,rowOf){
  const branches=graph.wires.filter(w=>w.f[0]===s.id&&!isBack(graph,w)).length;
  const p=portsOf(n);
  let bentOther=0;
  for(let i=0;i<p.ins.length;i++){
    const w=graph.wires.find(w=>w.t[0]===n.id&&w.t[1]===i&&!isBack(graph,w));
    if(!w||w.f[0]===s.id) continue;                        // wires from s itself are already counted via `branches`
    const src=graph.nodes.find(x=>x.id===w.f[0]); if(!src) continue;
    /* a floating root layoutRows joined into n's own row (see its own
       comment) isn't just bending a WIRE through this corridor, it's
       going to sit IN it (positionFloatingRoots) — reserve its actual
       block width plus its own MINGAP clearance, not the flat one-lane
       wire-bend allowance an ordinary bent input needs. Checked via
       rowOf (already a fresh, purely structural answer this same call)
       BEFORE the plain y-comparison below, which reads n.y/src.y — those
       reflect the LAST completed render's pixel layout, since layoutX
       (this function) always runs before layoutY fills in this one's;
       for a brand-new node (like an auto-merge block just spliced in)
       that's flat-out undefined on its first-ever call. Gating the
       width reservation behind that stale comparison instead of rowOf
       let it misfire on exactly that first render, self-correcting to
       the right answer only from the second render on — a visible
       one-time jump instead of a stable result from the start. */
    if(rowOf[src.id]===rowOf[n.id]&&isRoot(graph,src.id)){ bentOther+=Math.ceil((nodeSize(src).w+MINGAP)/LANE); continue; }
    if(portPos(src,'out',w.f[1]).y===portPos(n,'in',i).y) continue;
    bentOther++;
  }
  let crossing=0;
  if(prior){
    /* x alone isn't enough — a wire whose source/target both happen to
       straddle this x-range but live entirely on OTHER rows, nowhere near
       this corridor, was getting counted as if it had to squeeze through
       here too (verified directly: unrelated same-row pairs elsewhere in
       the diagram were inflating totally uncontested gaps). Only a wire
       whose own row-span actually reaches into the row(s) s and n occupy
       can plausibly need to pass through this specific corridor. */
    const gapR0=Math.min(rowOf[s.id],rowOf[n.id]), gapR1=Math.max(rowOf[s.id],rowOf[n.id]);
    for(const w of graph.wires){
      if(isBack(graph,w)) continue;
      if(w.f[0]===s.id||w.t[0]===n.id) continue;            // already counted above
      const ax=prior[w.f[0]], bx=prior[w.t[0]];
      if(ax===undefined||bx===undefined) continue;
      if(!(ax<=prior[s.id]&&bx>=prior[n.id])) continue;
      const ra=rowOf[w.f[0]], rb=rowOf[w.t[0]];
      if(ra===undefined||rb===undefined) continue;
      const wR0=Math.min(ra,rb), wR1=Math.max(ra,rb);
      if(Math.max(gapR0,wR0)<=Math.min(gapR1,wR1)) crossing++;
    }
  }
  const extra=Math.max(0,branches-1)+bentOther+crossing;
  return extra>0 ? MINGAP+extra*LANE : MINGAP;
}
function layoutX(graph){
  const order=topoForwardOrder(graph);
  const rowOf=layoutRows(graph);             // row index per node — pure function of structure, independent of x/y pixels
  const runPass=prior=>{
    for(const id of order){
      const n=graph.nodes.find(x=>x.id===id); if(!n) continue;
      let required=-Infinity;
      for(const w of graph.wires){
        if(w.t[0]!==id) continue;
        if(isBack(graph,w)) continue;                        // a feedback wire's target never gets pulled by its source's x —
                                                                // see below for why that used to happen and why it was wrong
        const s=graph.nodes.find(x=>x.id===w.f[0]); if(!s) continue;
        required=Math.max(required, portPos(s,'out',w.f[1]).x+corridorGap(graph,s,n,prior,rowOf));
      }
      if(required===-Infinity){
        if(n.k==='gin'||n.k==='gout') continue;             // graph-boundary pins keep their own placement
        n.x=LEFT_MARGIN;                                     // a dataflow root — pinned, not free
        continue;
      }
      n.x=snap(required);
    }
  };
  runPass(null);                             // pass 1: provisional x, blind to crossing wires
  const prior={}; graph.nodes.forEach(n=>prior[n.id]=n.x);
  runPass(prior);                            // pass 2: final x, crossing-aware using pass 1's positions
  positionFloatingRoots(graph,rowOf);
}
/* a root normally has no structural reason to sit anywhere but
   LEFT_MARGIN — nothing forward-feeds it, so nothing pulls its x. But a
   root that itself forward-feeds something (a CONST wired sideways into a
   block some entirely different chain also feeds, say) DOES have a
   structural reason: it should sit right next to what it feeds, the same
   way any other block derives its x from a REQUIREMENT, just mirrored —
   pulled backward from a target instead of forward from a source.

   "Right next to" has to mean genuinely clear, not just left of the
   target's own x: the wire still has to travel from the root's row to
   the target's row, and every OTHER block sitting in any row that span
   crosses is a real obstacle in its path — a forward wire is never
   allowed to double back leftward around one (see the router's own
   comment for why that's a hard rule, not just an aesthetic preference).
   So the root is pushed left of the leftmost edge of anything occupying
   the root's own row, the target's row, or any row in between — not just
   the target itself — which is what guarantees a straight, obstacle-free
   corridor exists for the router to find, rather than leaving it to
   detour around a block that got left in the way.

   Runs only after both passes above have settled every node WITH a
   forward requirement, so "where do my targets, and whatever's around
   them, already sit" is a real, finished answer, not a stale one. A root
   feeding nothing at all has nothing to be pulled toward, so it stays at
   LEFT_MARGIN. Still a pure function of the finished layout — no memory
   of any previous position is needed to make a floating root land
   somewhere sensible. */
function positionFloatingRoots(graph,rowOf){
  for(const n of graph.nodes){
    if(n.k==='gin'||n.k==='gout') continue;
    const hasForwardIn=graph.wires.some(w=>w.t[0]===n.id&&!isBack(graph,w));
    if(hasForwardIn) continue;
    const targets=graph.wires.filter(w=>w.f[0]===n.id&&!isBack(graph,w))
      .map(w=>graph.nodes.find(x=>x.id===w.t[0])).filter(Boolean);
    if(!targets.length) continue;
    if(targets.length===1 && rowOf[n.id]===rowOf[targets[0].id]){
      /* layoutRows joined this root into its one target's own row (see
         its own comment on floatingRootsFeeding) instead of giving it a
         separate one — corridorGap already reserved this root's real
         width in the corridor leading up to the target (see its own
         comment), so it just sits immediately before it; no obstacle
         scan needed, the same way an ordinary forward node never has to
         scan for one either. */
      n.x=snap(targets[0].x-MINGAP-nodeSize(n).w);
      continue;
    }
    let leftmost=Math.min(...targets.map(t=>t.x));
    for(const t of targets){
      const r0=Math.min(rowOf[n.id],rowOf[t.id]), r1=Math.max(rowOf[n.id],rowOf[t.id]);
      for(const other of graph.nodes){
        if(other===n || other===t) continue;
        const r=rowOf[other.id];
        if(r===undefined || r<r0 || r>r1) continue;
        leftmost=Math.min(leftmost, other.x);
      }
    }
    n.x=snap(leftmost-MINGAP-nodeSize(n).w);
  }
}
/* used to also clamp x to stay "left of the feedback source" for any node
   with a backward-incoming wire — the idea being a shorter feedback shaft.
   That clamp could pull a node's x BELOW what its own forward dependencies
   required, because topoForwardOrder (correctly) processes a node before
   the target of its own outgoing feedback wire, so that target's x hadn't
   been computed yet in this same pass and read back an understated (stale
   or default) value. The result: a forward wire's target could end up left
   of its source — the one thing this whole layout system exists to make
   impossible. A forward requirement is a hard floor; nothing is allowed to
   pull a node below it, so the clamp is gone rather than patched — once
   required can never be violated, min(required, cap) always equals
   required anyway whenever cap was actually safe to apply, so the clamp
   was never doing useful work in the cases where it wasn't actively wrong. */
/* every node's row: 0,1,2,... in the order graph.nodes drives them into being.
   Rows are assigned one whole tree at a time — every row a tree uses is
   claimed before the next tree gets any — so that a tree with more than one
   independent root (two sources merging into one block further along) can
   never end up with another, unrelated tree's rows sandwiched in the gap
   between its own. Which tree goes first is decided by the earliest array
   position of ANY of its members, same rule as everywhere else: order comes
   from the array, nothing else.

   Row assignment is a genuine INSERTION into an ordered list (`rows`, each
   entry the ids sharing that row), not an ever-incrementing counter that
   only ever appends: a fan-out's second-and-later branch is spliced in
   directly after its parent's row, and — the same operation, not a
   separate one — so is any OTHER root feeding a node that's already being
   placed (a CONST wired sideways into a block some entirely different
   chain also feeds). Both are "this belongs right next to where it
   structurally attaches", so both use the identical splice; a floating
   root doesn't get shunted to the tail of the whole tree once every other
   branch has already claimed the rows in between, the way appending to a
   flat counter would. rowIndexOf() re-reads a node's row fresh every time
   rather than trusting an earlier snapshot, since a splice can shift it
   between one use and the next. */
function layoutRows(graph){
  const arrayIndex={}; graph.nodes.forEach((n,i)=>arrayIndex[n.id]=i);
  const rows=[];                                       // rows[i] = ids sharing row i, in final row order
  const rowIndexOf=id=>rows.findIndex(r=>r.includes(id));
  const seen=new Set(), trees=[];
  for(const n of graph.nodes){
    if(seen.has(n.id)) continue;
    const ids=treeOf(graph,[n.id]);
    let firstIndex=Infinity;
    ids.forEach(id=>{ seen.add(id); firstIndex=Math.min(firstIndex,arrayIndex[id]); });
    trees.push({ids,firstIndex});
  }
  trees.sort((a,b)=>a.firstIndex-b.firstIndex);
  const placed=new Set();
  for(const tree of trees){
    const members=graph.nodes.filter(n=>tree.ids.has(n.id));
    const hasForwardIn=id=>graph.wires.some(w=>w.t[0]===id && !isBack(graph,w) && tree.ids.has(w.f[0]));
    const forwardOutsOf=id=>{
      const outs=[], seenC=new Set();
      for(const w of graph.wires){
        if(w.f[0]!==id||isBack(graph,w)||seenC.has(w.t[0])||!tree.ids.has(w.t[0])) continue;
        seenC.add(w.t[0]); outs.push(w.t[0]);
      }
      outs.sort((a,b)=>arrayIndex[a]-arrayIndex[b]);        // deterministic: earlier in the array = first branch
      return outs;
    };
    /* every OTHER root feeding this node besides whichever one's cascade
       is placing it right now — still unplaced, so not the parent of
       THIS call. */
    const floatingRootsFeeding=id=>{
      const list=[];
      for(const w of graph.wires){
        if(w.t[0]!==id||isBack(graph,w)||!tree.ids.has(w.f[0])) continue;
        const src=w.f[0];
        if(placed.has(src)||hasForwardIn(src)) continue;
        list.push(src);
      }
      list.sort((a,b)=>arrayIndex[a]-arrayIndex[b]);
      return list;
    };
    /* returns the highest row index this call's own subtree ended up
       consuming, so a SIBLING insertion (another of id's own branches, or
       another floating root feeding the SAME id) can splice in right
       after everything the PREVIOUS one actually used — not right after
       id's own row again, which is only correct for the very first
       insertion at this level. Using id's own row for every sibling would
       make two unrelated insertions (say, a floating root feeding id, and
       id's own second forward branch) both target the identical slot,
       silently bumping whichever was placed first one extra row further
       than it needed to be.

       `startCursor` carries that same guarantee across a "same row" link
       too (the i===0 case below, and the outer entry point) — a whole
       CHAIN of nodes can share one row (netor -> counter -> A>B, say),
       and each one of THEM can independently have its own floating roots
       or branches to insert. Without threading the cursor through the
       chain, each link's own place() call would start counting from
       scratch at its shared row, oblivious to insertions an EARLIER link
       on the same row already made — and repeatedly bump that earlier
       link's insertion one row further every time a later link inserts
       something of its own, since both keep computing "the slot right
       after our shared row" independently. */
    const place=(id,rowIdx,startCursor)=>{
      if(placed.has(id)) return rowIndexOf(id);
      placed.add(id);
      rows[rowIdx].push(id);
      let cursor=Math.max(rowIdx,startCursor===undefined?rowIdx:startCursor);
      const floaters=floatingRootsFeeding(id);
      /* the unambiguous case — exactly one root feeding id, and id is
         the ONLY thing it feeds — joins id's own row directly instead of
         claiming a separate one: there's nothing else it could need to
         make room for or compete with for that slot, so it can sit
         literally beside id (positionFloatingRoots/corridorGap, model.js,
         reserve it real width to do exactly that) rather than being
         routed in from a different row. Anything less clear-cut (more
         than one floating root feeding id, or one that feeds something
         ELSE too) falls back to the general insert-a-new-row case below,
         same as it always has. */
      if(floaters.length===1 && forwardOutsOf(floaters[0]).length===1){
        cursor=Math.max(cursor,place(floaters[0],rowIdx,cursor));
      } else for(const r of floaters){
        const at=cursor+1;
        rows.splice(at,0,[]);
        cursor=place(r,at);
      }
      forwardOutsOf(id).forEach((cid,i)=>{
        if(i===0) cursor=Math.max(cursor,place(cid,rowIdx,cursor));
        else{ const at=cursor+1; rows.splice(at,0,[]); cursor=place(cid,at); }
      });
      return cursor;
    };
    for(const n of members){ if(placed.has(n.id)||hasForwardIn(n.id)) continue; rows.push([]); place(n.id,rows.length-1); }
    for(const n of members){ if(!placed.has(n.id)){ rows.push([]); place(n.id,rows.length-1); } }  // multi-input within the tree
  }
  const rowOf={};
  rows.forEach((ids,r)=>ids.forEach(id=>rowOf[id]=r));
  return rowOf;
}
function layoutY(graph){
  const rowOf=layoutRows(graph);
  const rowH={};
  // row stacking uses each node's REAL rendered height (blockH — already
  // GRID-exact by construction, see its own comment) so a plain +VGAP
  // increment is exactly one real grid unit of clearance between one
  // block's rendered bottom edge and the next block's rendered top edge.
  for(const n of graph.nodes){ const r=rowOf[n.id]; rowH[r]=Math.max(rowH[r]||0, blockH(n)); }
  // Now that block corners can land on ANY multiple of GRID (not just
  // every other one — the whole point of doubling grid density), n.y is
  // just this row's accumulated position directly, no offset needed:
  // blockH() is already GRID-exact, VGAP is a whole number of GRID units
  // (it's LANE), and TOP_MARGIN too, so rowY stays GRID-exact through the
  // entire accumulation with nothing to cancel against.
  const rowY={}; let y=TOP_MARGIN;
  const maxRow=Object.keys(rowH).reduce((m,r)=>Math.max(m,+r),-1);
  for(let r=0;r<=maxRow;r++){ rowY[r]=y; y+=(rowH[r]||GRID)+VGAP; }
  for(const n of graph.nodes) n.y=rowY[rowOf[n.id]];
}
/* w.back is a structural fact, decided once when the wire is made (see
   connect() in editor.js) and stored — never re-derived from geometry here.
   Re-deriving it from the x/y this very function is about to compute would
   be circular: a brand-new wire between two still-unpositioned blocks has no
   geometry yet to read a direction off. wireBack() stays available for the
   one place that legitimately needs a geometric guess: bootstrapping .back
   for a project file saved before it existed (see tagWires). */
/* Each tree (treeGroups above — one connected component) owns exactly one
   free-floating (ox,oy) offset, dragged directly by the user
   (startFreeDrag in editor.js) instead of every root auto-stacking
   beneath the last one at a shared LEFT_MARGIN. Blocks and wires
   themselves carry no position of their own — n.x/n.y are pure output,
   recomputed from scratch below on every call, never read back in as
   input — the offset is the ONLY thing remembered between renders, and it
   lives OFF the node objects entirely, in graph.treePos: a small list of
   {seed, ox, oy}, seed being whichever node the offset was last found
   attached to. layoutX/layoutY are unchanged and still exactly what
   their own comments say — a pure function of structure — run once per
   tree, in that tree's own local space, with its one offset added on top.

   A tree's entry is looked up by checking its OWN members, in array
   order, against every recorded seed — the first hit wins, same
   "earliest array position is canonical" convention this file uses
   everywhere else (see layoutRows' firstIndex). No entry found means
   this exact membership has never been anchored before: a project saved
   before this feature existed, or a tree that just changed shape (a wire
   was connected or cut, changing who's grouped with whom). Either way,
   the new entry isn't defaulted to zero; it's derived so the tree's
   array-earliest member ends up exactly where it's already, visibly
   sitting — its last-rendered x/y, still sitting untouched on the node
   object until the fresh local layout below overwrites it.

   That's the whole mechanism, and it's what makes every case work
   without any case-specific code: an old project's hand/auto-placed
   trees keep their exact positions the first time this runs. Cutting a
   wire that splits a tree in two leaves both halves exactly where they
   were — the piece that kept the old seed finds its old entry unchanged;
   the other piece finds no entry and gets a fresh one anchored to
   wherever IT was already sitting. Connecting two previously separate
   trees keeps the older of the two (whichever contains the
   array-earliest node, so whichever entry gets found first) exactly in
   place while the newer one's own former entry goes unused — and because
   positionFloatingRoots (layoutX, above) already gives every root a
   structurally sensible local position relative to whatever it feeds,
   not just LEFT_MARGIN, that one shared offset is enough on its own to
   keep an unrelated side-root (a CONST feeding sideways into a block some
   entirely different chain also feeds) sitting right where it belongs
   relative to its own tree, with no extra bookkeeping needed for it. */
function computeLayout(graph){
  graph.treePos=(graph.treePos||[]).filter(e=>graph.nodes.some(n=>n.id===e.seed));
  for(const grp of treeGroups(graph)){
    const grpIds=new Set(grp.nodes.map(n=>n.id));
    let entry=null;
    for(const n of grp.nodes){ entry=graph.treePos.find(e=>e.seed===n.id); if(entry) break; }
    const seed=grp.nodes[0];
    const before=entry?null:{x:seed.x,y:seed.y};
    layoutX(grp); layoutY(grp);
    if(!entry){
      entry={seed:seed.id, ox:snap(before.x-seed.x), oy:snap(before.y-seed.y)};
      graph.treePos.push(entry);
    }
    graph.treePos=graph.treePos.filter(e=>e===entry || !grpIds.has(e.seed));   // drop now-superseded entries this group swallowed
    for(const n of grp.nodes){ n.x+=entry.ox; n.y+=entry.oy; }
  }
}
function snapNode(n){ n.x=snap(n.x); n.y=snap(n.y); return n; }
function snapGraph(g){ (g.nodes||[]).forEach(snapNode); }
function snapProject(p){ snapGraph(p.main); Object.values(p.types||{}).forEach(t=>t.graph&&snapGraph(t.graph)); }
