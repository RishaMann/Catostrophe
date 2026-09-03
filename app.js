/* ================= режим приложения (game/design) ================= */
const APP_MODE=new URLSearchParams(location.search).get("mode")==="design"?"design":"game";
const IS_DESIGN=APP_MODE==="design";
document.body.classList.add(IS_DESIGN?"mode-design":"mode-game");

/* ================= проекция ================= */
const OX=270,WALL=3.4,TOPM=112,MAXY=700,SCREEN_W=540,SCREEN_H=960;
const DOOR_W=1.15,DOOR_H=2.35,WIN_W=1.8,WIN_Z0=1.1,WIN_Z1=2.5,STUB=0.55;
let params={floor:6,tilt:0.5,zoom:1},applied={...params};
let PROJ={TW:60,TH:30,ZH:72,OY:0,F:6};
const kScale=p=>60*(6/p.floor)*p.zoom;   // комната держит размер кадра, меняется дробность
function applyProj(p){
  PROJ.TW=kScale(p);PROJ.TH=PROJ.TW*p.tilt;PROJ.ZH=PROJ.TW*1.2;
  PROJ.OY=TOPM+WALL*PROJ.ZH;PROJ.F=p.floor;PROJ.tilt=p.tilt;
}
const P=(x,y,z=0)=>[OX+(x-y)*PROJ.TW,PROJ.OY+(x+y)*PROJ.TH-z*PROJ.ZH];
const unP=(sx,sy)=>{const u=(sx-OX)/PROJ.TW,v=(sy-PROJ.OY)/PROJ.TH;return [(u+v)/2,(v-u)/2];};
const poly=p=>p.map(a=>a.join(",")).join(" ");
const NS="http://www.w3.org/2000/svg";
const el=(n,a={})=>{const e=document.createElementNS(NS,n);for(const k in a)e.setAttribute(k,a[k]);return e;};
const centroid=p=>[p.reduce((s,q)=>s+q[0],0)/p.length,p.reduce((s,q)=>s+q[1],0)/p.length];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rnd=(a,b)=>a+Math.random()*(b-a);
const pick=a=>a[Math.floor(Math.random()*a.length)];

let door={side:"left",pos:3.3},win={side:"right",pos:2.6};
let light={x:2.7,y:2.7},mode="view",pageInv=0,pageSup=0;
let showWalk=false,showLabels=IS_DESIGN,showEmpty=IS_DESIGN,catOn=true;
let mood=62,fish=1247,gems=12,NAV=null;
const CAT_R=0.36,STEP=0.25;
const RANGE={left:[0.6,3.35],frontLeft:[1.8,4.4],right:[0.4,2.6],frontRight:[1.8,4.2]};
const SET={x:24,y:300,w:492,h:396};
const LBTN=[{id:"settings",l:"Настройки"},{id:"inventory",l:"Инвентарь"},{id:"supplies",l:"Корм"}];
const RBTN=[{id:"quests",l:"Задания"},{id:"shop",l:"Магазин"},{id:"spare",l:"—"}];
const SLIDERS=[
 {id:"floor",l:"Размер пола",min:4,max:9,step:0.5,fmt:v=>v.toFixed(1)+" кл."},
 {id:"tilt",l:"Наклон сцены",min:0.34,max:0.72,step:0.02,fmt:v=>Math.round(v*200)+"%"},
 {id:"zoom",l:"Приближение",min:0.65,max:1.6,step:0.05,fmt:v=>Math.round(v*100)+"%"}
];

/* ================= предметы ================= */
const ITEMS=[
 {id:"wardrobe",ru:"Шкаф",cat:"tall",s:[1.2,.7,2.3],touch:1,en:"a tall wardrobe with two solid closed doors"},
 {id:"bookshelf",ru:"Стеллаж",cat:"tall",s:[1.1,.6,2.0],en:"an open bookshelf with four shelves of aligned books"},
 {id:"lamp",ru:"Торшер",cat:"tall",s:[.45,.45,1.8],en:"a floor lamp with a level shade"},
 {id:"sofa",ru:"Диван",cat:"mid",s:[1.8,.85,.85],touch:1,en:"a compact two-seater sofa"},
 {id:"aquarium",ru:"Аквариум",cat:"mid",s:[1.4,.6,1.1],touch:1,en:"a low stand with a lit aquarium and one goldfish"},
 {id:"rug",ru:"Ковёр",cat:"low",s:[2.8,2.4,.03],en:"a woven rug"},
 {id:"table",ru:"Столик",cat:"low",s:[1.1,.7,.4],touch:1,en:"a low coffee table with one mug and a remote"},
 {id:"pouf",ru:"Пуф",cat:"low",s:[.7,.7,.35],en:"a round pouf"},
 {id:"ficus",ru:"Фикус",cat:"low",s:[.6,.6,1.0],touch:1,en:"a ficus in a ceramic pot"},
 {id:"scratch",ru:"Когтеточка",cat:"low",s:[.6,.6,1.0],touch:1,en:"a scratching post with tight sisal wrap"},
 {id:"box",ru:"Коробка",cat:"low",s:[.7,.7,.6],touch:1,en:"a closed cardboard box"},
 {id:"bed",ru:"Лежанка",cat:"low",s:[.75,.6,.25],touch:1,en:"a round cat basket with a folded blanket"},
 {id:"bowls",ru:"Миски",cat:"low",s:[.8,.5,.18],touch:1,en:"a rubber mat with a food bowl and a water bowl"},
 {id:"vacuum",ru:"Пылесос",cat:"low",s:[.5,.5,.12],en:"a robot vacuum parked flat"},
 {id:"scales",ru:"Весы",cat:"low",s:[.6,.45,.08],en:"floor scales lying flat, display at zero"},
 {id:"plaid",ru:"Плед",cat:"surface",en:"a folded plaid throw draped over the sofa"},
 {id:"curtain",ru:"Штора",cat:"wall",en:"curtains hung evenly and tied back to both sides"},
 {id:"garland",ru:"Гирлянда",cat:"wall",en:"a string of small fairy lights"},
 {id:"wshelf",ru:"Полка",cat:"wall",en:"a small wall shelf with three figurines"},
 {id:"clock",ru:"Часы",cat:"wall",en:"a round wall clock"},
 {id:"portrait",ru:"Портрет",cat:"wall",en:"a framed portrait"},
 {id:"bulb",ru:"Лампочка",cat:"ceil",en:"a bare bulb on a twisted cord"},
 {id:"chandelier",ru:"Люстра",cat:"ceil",en:"a small chandelier"}
];
const BY_ID=Object.fromEntries(ITEMS.map(i=>[i.id,i]));
const SUPPLIES=[
 {id:"dry",ru:"Сухой корм",food:1},{id:"can",ru:"Консерва",food:1},{id:"treat",ru:"Лакомство",food:1},
 {id:"wand",ru:"Удочка"},{id:"ball",ru:"Мячик"},{id:"mouse",ru:"Мышка"}];
const SUP_BY_ID=Object.fromEntries(SUPPLIES.map(i=>[i.id,i]));
const SAY={
 hand:["Вот это другое дело.","Приемлемо. Ещё.","Наконец-то сервис."],
 bowl:["Ладно, засчитано.","Я как раз проходил мимо.","Не потому что ты позвал."],
 floor:["Это. На полу. Серьёзно?","Я вам не голубь.","Придётся это закопать."],
 buried:["Похороны состоялись.","Больше никто не пострадает."],
 toy:["Оно живое!","Поймал. Оно мертво.","Кинь ещё раз, я подумаю."]
};

/* ================= раскладка под видимую область ================= */
let LAY={Wend:4.2,Lx:4.2,Ld:11.5,F:6};
function generateLayout(p){
  const F=p.floor,TW=kScale(p),TH=TW*p.tilt,ZH=TW*1.2,OY=TOPM+WALL*ZH;
  const Lx=(OX-18)/TW, Ld=(MAXY-OY)/TH;
  const Wend=Math.min(F-0.1,Lx-0.05);
  LAY={Wend,Lx,Ld,F};
  const Z=[],push=(id,band,r,ru,en,ex={})=>{
    if(r[2]-r[0]<0.6||r[3]-r[1]<0.6) return;
    if(r[0]<-0.01||r[1]<-0.01||r[2]>F||r[3]>F) return;
    Z.push({id,band,r:r.map(v=>Math.round(v*100)/100),ru,en,...ex});
  };
  push("B1","back",[0,0,1.4,1.25],"Угол между стенами","in the corner between the two back walls");
  // пол вдоль правой стены
  const rlen=Wend-1.4, rn=clamp(Math.floor(rlen/1.55),0,3);
  const rnm=[["Правая стена, у угла","against the right back wall, near the corner"],
             ["Правая стена, дальше","against the right back wall, further along"],
             ["Правая стена, дальний край","against the right back wall, at the far end"]];
  for(let i=0;i<rn;i++)
    push("RF_"+"ABC"[i],"back",[1.4+i*(rlen/rn),0,1.4+(i+1)*(rlen/rn)-0.05,1.2],rnm[i][0],rnm[i][1]);
  // середина
  const mx0=1.45,my0=1.3;
  const mx1=Math.min(F-1.35,my0+Lx-0.25,Ld-1.3-my0);
  const my1=Math.min(F-1.35,mx0+Lx-0.25,Ld-1.3-mx0);
  push("M0","mid",[mx0,my0,Math.min(mx0+3.1,mx1),Math.min(my0+3.0,my1)],
    "Центр пола (ковёр)","covering the middle of the floor",{flat:true});
  push("M1","mid",[mx0,my0,mx0+1.1,Math.min(my0+2.2,my1)],
    "Середина, вдоль левой стены","on the left side of the room, facing the centre");
  push("M4","mid",[Math.max(mx1-1.05,mx0+1.35),my0,mx1,Math.min(my0+2.05,my1)],
    "Середина, вдоль правой стены","on the right side of the room, facing the centre");
  push("M2","mid",[mx0+1.25,my0+0.05,Math.min(mx0+2.45,mx1-1.15),my0+1.35],
    "Середина, центр","in the centre of the room");
  push("M7","mid",[mx0+1.15,my0+1.5,Math.min(mx0+3.2,mx1-0.05),my0+2.6],
    "Середина, поперёк","across the middle of the room, facing the window wall");
  push("M5","mid",[mx0-0.15,my0+2.45,mx0+0.95,Math.min(my0+3.4,my1)],
    "У левого плинтуса","flat against the left baseboard");
  // передний ряд — буквой Г вдоль двух ближних краёв
  const fw=1.15,fd=1.05;
  const aMin=Math.max(1.55,F-0.1-Lx), aMax=Math.min(F-1.35,Ld-F-fd);
  const fn=clamp(Math.floor((aMax-aMin)/(fw+0.12))+1,0,3);
  for(let i=0;i<fn;i++){
    const a=aMin+i*(fw+0.12);
    push("FL_"+i,"front",[a,F-fd-0.1,a+fw,F-0.1],
      "Ближний край, слева "+(i+1),"on the near left edge of the floor");
    push("FR_"+i,"front",[F-fd-0.1,a,F-0.1,a+fw],
      "Ближний край, справа "+(i+1),"on the near right edge of the floor");
  }
  push("FC","front",[F-fd-0.1,F-fd-0.1,F-0.1,F-0.1],
    "Ближний угол","at the near corner of the floor, closest to the viewer");
  return Z;
}
let STATIC=[];
const ACCEPTS={back:["tall","mid","low"],mid:["mid","low"],front:["low"],
  wall:["wall"],ceil:["ceil"],surface:["surface"]};

function split(from,to,ids,rus,ens,make){
  const w=to-from,out=[];
  if(w<0.8) return out;
  if(w<2.9) out.push(make(from,to,ids[0],rus[0],ens[0]));
  else{const m=(from+to)/2;
    out.push(make(from,m-0.06,ids[0],rus[0],ens[0]));
    out.push(make(m+0.06,to,ids[1],rus[1],ens[1]));}
  return out;
}
const doorSpan=()=>[door.pos,door.pos+DOOR_W];
const winSpan=()=>[win.pos,win.pos+WIN_W];
let ZONES=[],ZMAP={};
function dynamicZones(){
  const z=[],[d0,d1]=doorSpan(),[w0,w1]=winSpan(),W=LAY.Wend;
  const mkL=(a,b,id,ru,en)=>({id,band:"wall",wall:"left",r:[a,1.55,b,2.75],ru,en});
  const mkR=(a,b,id,ru,en)=>({id,band:"wall",wall:"right",r:[a,1.55,b,2.75],ru,en});
  const mkFL=(a,b,id,ru,en)=>({id,band:"back",r:[0,a,1.25,b],ru,en});
  if(door.side==="left"){
    z.push(...split(1.25,Math.min(d0-0.15,W),["LF_A","LF_B"],
      ["Левая стена, у угла","Левая стена, к двери"],
      ["against the left back wall, near the corner","against the left back wall, towards the door"],mkFL));
    z.push(...split(d1+0.15,W,["LF_C","LF_D"],["Левая стена, за дверью","Левая стена, дальний край"],
      ["against the left back wall, beyond the door","against the left back wall, at the far end"],mkFL));
    z.push(...split(0.25,Math.min(d0-0.3,W),["WL_A","WL_B"],
      ["Левая стена, у угла","Левая стена, к двери"],
      ["on the left back wall, near the corner","on the left back wall, towards the door"],mkL));
    z.push(...split(d1+0.3,W,["WL_C","WL_D"],["Левая стена, за дверью","Левая стена, дальний край"],
      ["on the left back wall, beyond the door","on the left back wall, at the far end"],mkL));
    if(d1<W) z.push({id:"OVERDOOR",band:"wall",wall:"left",r:[d0+0.05,2.5,d1-0.05,3.1],
      ru:"Над дверью",en:"on the left back wall, just above the door"});
  }else{
    z.push(...split(1.25,W,["LF_A","LF_B"],["Левая стена, у угла","Левая стена, дальний край"],
      ["against the left back wall, near the corner","against the left back wall, at the far end"],mkFL));
    z.push(...split(0.25,W,["WL_A","WL_B"],["Левая стена, у угла","Левая стена, дальний край"],
      ["on the left back wall, near the corner","on the left back wall, at the far end"],mkL));
  }
  if(win.side==="right"){
    z.push(...split(0.25,Math.min(w0-0.3,W),["WR_A","WR_B"],
      ["Правая стена, у угла","Правая стена, к окну"],
      ["on the right back wall, near the corner","on the right back wall, left of the window"],mkR));
    z.push(...split(w1+0.3,W,["WR_C","WR_D"],["Правая стена, за окном","Правая стена, дальний край"],
      ["on the right back wall, right of the window","on the right back wall, at the far end"],mkR));
    z.push({id:"WIN_ROD",band:"wall",wall:"right",r:[w0-0.15,2.55,w1+0.15,3.1],
      ru:"Карниз над окном",en:"on the curtain rod above the window"});
    z.push({id:"WIN_FRAME",band:"wall",wall:"right",r:[w0-0.25,WIN_Z0-0.05,w1+0.25,WIN_Z1-0.05],
      ru:"Рама окна",en:"around the window frame"});
  }else{
    z.push(...split(0.25,W,["WR_A","WR_B"],["Правая стена, у угла","Правая стена, дальний край"],
      ["on the right back wall, near the corner","on the right back wall, at the far end"],mkR));
    z.push({id:"WIN_ROD",band:"wall",wall:"frontRight",r:[w0-0.1,0.36,w1+0.1,0.54],
      ru:"Карниз (ближний край)",en:"on the curtain rod above the window in the near right wall"});
    z.push({id:"WIN_FRAME",band:"wall",wall:"frontRight",r:[w0-0.15,0.1,w1+0.15,0.34],
      ru:"Рама (ближний край)",en:"around the window frame in the near right wall"});
  }
  const sz=Object.keys(place).find(k=>place[k]==="sofa");
  const base=Object.fromEntries(STATIC.map(x=>[x.id,x]));
  if(sz&&base[sz]){
    const z0=base[sz],cx=(z0.r[0]+z0.r[2])/2,cy=(z0.r[1]+z0.r[3])/2;
    const zw=z0.r[2]-z0.r[0],zd=z0.r[3]-z0.r[1],it=BY_ID.sofa;
    const [w,d]=zw>=zd?[it.s[0],it.s[1]]:[it.s[1],it.s[0]];
    z.push({id:"ON_SOFA",band:"surface",zh:it.s[2],ru:"На диване",en:"draped over the sofa",
      r:[cx-w/2+0.12,cy-d/2+0.1,cx+w/2-0.12,cy+d/2-0.1]});
  }
  return z;
}
const overlap=(a,b)=>a[0]<b[2]&&b[0]<a[2]&&a[1]<b[3]&&b[1]<a[3];
function buildZones(){
  const [d0,d1]=doorSpan(),[w0,w1]=winSpan(),F=PROJ.F;
  const clear=door.side==="left"?[0,d0-0.15,1.1,d1+0.15]:[d0-0.15,F-1.15,d1+0.15,F];
  ZONES=[...STATIC,...dynamicZones()].map(z=>{
    const o={...z};
    if(z.band==="back"||z.band==="mid"||z.band==="front"){
      if(overlap(z.r,clear)) o.blocked="проход к двери должен оставаться свободным";
      if(win.side==="right"&&z.band==="back"&&z.r[1]<1.25&&z.r[0]>=1.0){
        const ov=Math.min(z.r[2],w1)-Math.max(z.r[0],w0);
        if(ov>0&&ov/(z.r[2]-z.r[0])>0.5) o.maxH=1.3;
      }
    }
    return o;
  });
  ZMAP=Object.fromEntries(ZONES.map(z=>[z.id,z]));
  Object.keys(place).forEach(k=>{if(k!=="CEIL"&&!ZMAP[k]) delete place[k];});
}
const DEFAULT={B1:"lamp",LF_A:"wardrobe",RF_A:"bookshelf",M0:"rug",M1:"sofa",M2:"table",
  M4:"aquarium",M7:"pouf",M5:"vacuum",FL_0:"box",FL_1:"ficus",FR_0:"bowls",FR_1:"bed",
  ON_SOFA:"plaid",WIN_ROD:"curtain",WIN_FRAME:"garland",WL_A:"wshelf",CEIL:"bulb"};
let place={...DEFAULT};

function reject(z,it){
  if(z.blocked) return z.blocked;
  if(!ACCEPTS[z.band].includes(it.cat)) return {
    back:"сюда встаёт мебель у стен",mid:"здесь только среднее и низкое",
    front:"ближний край держим низким",wall:"это область на стене",
    ceil:"это точка на потолке",surface:"сюда кладут только то, что лежит на мебели"}[z.band];
  if(z.maxH&&it.s&&it.s[2]>z.maxH) return "загородит окно";
  if(it.s&&z.band!=="surface"){
    const zw=z.r[2]-z.r[0],zd=z.r[3]-z.r[1];
    const L=Math.max(zw,zd),S=Math.min(zw,zd);
    if(it.s[0]>L-0.1||it.s[1]>S-0.1) return "не помещается: зона короче предмета";
  }
  return null;
}
function fit(it,z){const zw=z.r[2]-z.r[0],zd=z.r[3]-z.r[1],[L,S]=it.s;return zw>=zd?[L,S]:[S,L];}

/* ================= проходимость ================= */
// ZONES/ZMAP — зоны РАЗМЕЩЕНИЯ (куда можно поставить предмет). Навигационная
// область кота — отдельная сущность: весь пол комнаты минус препятствия от уже
// поставленной мебели. Она не зависит от количества/расположения зон размещения —
// добавление, удаление или перестановка пустых зон никак её не меняет, влияет
// только фактическая занятость (place).
function footprint(zid,iid){
  const z=ZMAP[zid],it=BY_ID[iid];
  if(!it.s||z.band==="wall"||z.band==="surface") return null;
  const cx=(z.r[0]+z.r[2])/2,cy=(z.r[1]+z.r[3])/2,[w,d]=fit(it,z);
  return {r:[cx-w/2,cy-d/2,cx+w/2,cy+d/2],h:it.s[2],it,c:[cx,cy]};
}
// Границы навигационной области — весь пол F×F с отступом на радиус кота.
// Источник — только PROJ.F, никакой зависимости от ZONES.
function navFloorBounds(){
  const F=PROJ.F;
  return {x0:CAT_R,y0:CAT_R,x1:F-CAT_R,y1:F-CAT_R};
}
// Препятствия — прямоугольники уже поставленной мебели (place). ZMAP тут нужен
// только чтобы узнать, где именно стоит конкретный поставленный предмет —
// это не делает навигацию зависимой от набора зон размещения как таковых.
function navObstacles(){
  const solid=[],touch=[];
  Object.entries(place).forEach(([zid,iid])=>{
    if(zid==="CEIL"||!ZMAP[zid]) return;
    const f=footprint(zid,iid); if(!f) return;
    if(f.h>=0.2) solid.push(f.r);
    if(f.it.touch) touch.push(f);
  });
  return {solid,touch};
}
function buildNav(){
  const F=PROJ.F,GN=Math.round(F/STEP)+1;
  const bounds=navFloorBounds(),{solid,touch}=navObstacles();
  const free=(x,y)=>{
    if(x<bounds.x0||y<bounds.y0||x>bounds.x1||y>bounds.y1) return false;
    return !solid.some(r=>x>r[0]-CAT_R&&x<r[2]+CAT_R&&y>r[1]-CAT_R&&y<r[3]+CAT_R);
  };
  const idx=(i,j)=>i*GN+j,ok=[];
  for(let i=0;i<GN;i++) for(let j=0;j<GN;j++) ok[idx(i,j)]=free(i*STEP,j*STEP);
  const comp=new Array(GN*GN).fill(-1);let nc=0;const sizes=[];
  for(let i=0;i<GN;i++) for(let j=0;j<GN;j++){
    if(!ok[idx(i,j)]||comp[idx(i,j)]>=0) continue;
    const q=[[i,j]];comp[idx(i,j)]=nc;let n=0;
    while(q.length){const [a,b]=q.pop();n++;
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(([da,db])=>{
        const u=a+da,v=b+db;
        if(u<0||v<0||u>=GN||v>=GN) return;
        if(ok[idx(u,v)]&&comp[idx(u,v)]<0){comp[idx(u,v)]=nc;q.push([u,v]);}});}
    sizes[nc]=n;nc++;
  }
  const ci=clamp(Math.round(cat.x/STEP),0,GN-1),cj=clamp(Math.round(cat.y/STEP),0,GN-1);
  let home=comp[idx(ci,cj)];
  if(home<0&&sizes.length) home=sizes.indexOf(Math.max(...sizes));
  const unreachable=touch.filter(f=>{
    const [x0,y0,x1,y1]=f.r,m=CAT_R+0.45;
    const i0=clamp(Math.floor((x0-m)/STEP),0,GN-1),i1=clamp(Math.ceil((x1+m)/STEP),0,GN-1);
    const j0=clamp(Math.floor((y0-m)/STEP),0,GN-1),j1=clamp(Math.ceil((y1+m)/STEP),0,GN-1);
    for(let i=i0;i<=i1;i++) for(let j=j0;j<=j1;j++)
      if(comp[idx(i,j)]===home) return false;
    return true;
  }).map(f=>f.it.ru);
  const total=ok.filter(Boolean).length;
  return {ok,comp,home,idx,GN,free,unreachable,pockets:nc,touch,
    area:Math.round(100*total*STEP*STEP/(F*F))};
}
function findPath(fx,fy,tx,ty){
  if(!NAV) return [];
  const {GN,idx,comp,home}=NAV;
  const a=[clamp(Math.round(fx/STEP),0,GN-1),clamp(Math.round(fy/STEP),0,GN-1)];
  const b=[clamp(Math.round(tx/STEP),0,GN-1),clamp(Math.round(ty/STEP),0,GN-1)];
  if(comp[idx(b[0],b[1])]!==home) return [];
  const prev=new Array(GN*GN).fill(-1),seen=new Array(GN*GN).fill(false);
  const q=[a];seen[idx(a[0],a[1])]=true;
  while(q.length){
    const [i,j]=q.shift();
    if(i===b[0]&&j===b[1]) break;
    [[1,0],[-1,0],[0,1],[0,-1]].forEach(([di,dj])=>{
      const u=i+di,v=j+dj;
      if(u<0||v<0||u>=GN||v>=GN) return;
      const k=idx(u,v);
      if(seen[k]||comp[k]!==home) return;
      seen[k]=true;prev[k]=idx(i,j);q.push([u,v]);
    });
  }
  if(!seen[idx(b[0],b[1])]) return [];
  const path=[];let k=idx(b[0],b[1]);
  while(k>=0&&k!==idx(a[0],a[1])){path.push([Math.floor(k/GN)*STEP,(k%GN)*STEP]);k=prev[k];}
  path.reverse();
  // прореживаем, чтобы кот не дёргался по клеткам
  return path.filter((p,i)=>i%2===0||i===path.length-1);
}
function randomSpot(minD){
  if(!NAV) return null;
  for(let n=0;n<200;n++){
    const i=Math.floor(Math.random()*NAV.GN),j=Math.floor(Math.random()*NAV.GN);
    if(NAV.comp[NAV.idx(i,j)]!==NAV.home) continue;
    const x=i*STEP,y=j*STEP;
    if(Math.hypot(x-cat.x,y-cat.y)<minD) continue;
    return [x,y];
  }
  return null;
}
/* ================= кот ================= */
let cat={x:3,y:3,st:"idle",t:1,ph:0,dir:1,path:[],after:null,bubble:null,bt:0,jump:0};
function setSt(st,t,after){cat.st=st;cat.t=t;cat.after=after||null;}
function bubble(txt,dur=3.2){cat.bubble=txt;cat.bt=dur;}
function walkTo(x,y,after){
  const p=findPath(cat.x,cat.y,x,y);
  if(!p.length){setSt("idle",1.2,after);return;}
  cat.path=p;setSt("walk",99,after);
}
// IDLE стоит некоторое время, затем decideNext решает: чаще всего сразу WALK,
// иногда SIT, реже LIE. После SIT/LIE (afterRest) — обычно снова WALK, иногда
// назад в IDLE. Все ветки в итоге приходят в wander() (WALK), так что кот
// никогда не застревает в одном состоянии навсегда.
function idleCycle(){
  setSt("idle",rnd(1.2,3),decideNext);
}
function decideNext(){
  const r=Math.random();
  if(r<0.55) wander();                               // чаще всего: сразу идти
  else if(r<0.85) setSt("sit",rnd(2.5,6),afterRest);  // иногда: сесть
  else setSt("lie",rnd(4,9),afterRest);               // реже: лечь
}
function afterRest(){
  if(Math.random()<0.7) wander(); else idleCycle();
}
function wander(){
  const s=randomSpot(1.2);
  if(!s){setSt("idle",2,idleCycle);return;}
  walkTo(s[0],s[1],idleCycle);
}
function bowlPos(){
  const zid=Object.keys(place).find(k=>place[k]==="bowls");
  if(!zid||!ZMAP[zid]) return null;
  const f=footprint(zid,"bowls");return f?f.c:null;
}
function nearSpot(x,y){
  if(!NAV) return [x,y];
  let best=null,bd=1e9;
  for(let i=0;i<NAV.GN;i++) for(let j=0;j<NAV.GN;j++){
    if(NAV.comp[NAV.idx(i,j)]!==NAV.home) continue;
    const d=Math.hypot(i*STEP-x,j*STEP-y);
    if(d<bd){bd=d;best=[i*STEP,j*STEP];}
  }
  return best||[x,y];
}
function feedHand(){
  cat.path=[];bubble(pick(SAY.hand));
  setSt("eat",1.8,()=>{mood=clamp(mood+8,0,100);idleCycle();});
}
function playHand(){
  cat.path=[];cat.jump=3;bubble("");
  setSt("jump",1.6,()=>{bubble(pick(SAY.toy));mood=clamp(mood+5,0,100);idleCycle();});
}
function feedBowl(){
  const b=bowlPos();if(!b){feedFloor(cat.x,cat.y);return;}
  cat.path=[];
  setSt("sit",rnd(2,4),()=>{
    const s=nearSpot(b[0],b[1]);
    walkTo(s[0],s[1],()=>{
      bubble(pick(SAY.bowl));
      setSt("eat",2,()=>{mood=clamp(mood+10,0,100);idleCycle();});
    });
  });
}
function feedFloor(x,y){
  bubble(pick(SAY.floor));
  const s=nearSpot(x,y);
  walkTo(s[0],s[1],()=>{
    setSt("dig",2.2,()=>{
      bubble(pick(SAY.buried));mood=clamp(mood-6,0,100);idleCycle();
    });
  });
}
function tick(dt){
  if(cat.bt>0){cat.bt-=dt;if(cat.bt<=0) cat.bubble=null;}
  if(!catOn) return;
  cat.ph+=dt*(cat.st==="walk"?9:cat.st==="dig"?14:2);
  if(cat.st==="walk"){
    if(!cat.path.length){cat.path=[];const f=cat.after;cat.after=null;if(f)f();else idleCycle();return;}
    const [tx,ty]=cat.path[0];
    const dx=tx-cat.x,dy=ty-cat.y,d=Math.hypot(dx,dy),sp=0.62*dt;
    if(d<=sp){cat.x=tx;cat.y=ty;cat.path.shift();}
    else{cat.x+=dx/d*sp;cat.y+=dy/d*sp;}
    const a=P(cat.x,cat.y),b=P(tx,ty);
    if(Math.abs(b[0]-a[0])>0.5) cat.dir=b[0]>a[0]?1:-1;
    return;
  }
  cat.t-=dt;
  if(cat.t<=0){const f=cat.after;cat.after=null;if(f)f();else idleCycle();}
}

/* ================= отрисовка ================= */
const svg=document.getElementById("scene");
function zonePoly(z){
  const [a,b,c,d]=z.r,F=PROJ.F;
  if(z.band==="wall"&&z.wall==="right") return [P(a,0,b),P(c,0,b),P(c,0,d),P(a,0,d)];
  if(z.band==="wall"&&z.wall==="left")  return [P(0,a,b),P(0,c,b),P(0,c,d),P(0,a,d)];
  if(z.band==="wall"&&z.wall==="frontRight") return [P(F,a,b),P(F,c,b),P(F,c,d),P(F,a,d)];
  if(z.band==="surface") return [P(a,b,z.zh),P(c,b,z.zh),P(c,d,z.zh),P(a,d,z.zh)];
  return [P(a,b),P(c,b),P(c,d),P(a,d)];
}
function drawShell(g){
  const F=PROJ.F;
  g.appendChild(el("polygon",{points:poly([P(0,0),P(F,0),P(F,F),P(0,F)]),
    fill:"rgba(235,226,213,.045)",stroke:"rgba(235,226,213,.4)","stroke-width":"1.2"}));
  g.appendChild(el("polygon",{points:poly([P(0,0),P(F,0),P(F,0,WALL),P(0,0,WALL)]),
    fill:"rgba(235,226,213,.03)",stroke:"rgba(235,226,213,.32)","stroke-width":"1.2"}));
  g.appendChild(el("polygon",{points:poly([P(0,0),P(0,F),P(0,F,WALL),P(0,0,WALL)]),
    fill:"rgba(235,226,213,.055)",stroke:"rgba(235,226,213,.32)","stroke-width":"1.2"}));
  for(let i=1;i<F;i++){
    g.appendChild(el("line",{x1:P(i,0)[0],y1:P(i,0)[1],x2:P(i,F)[0],y2:P(i,F)[1],stroke:"rgba(235,226,213,.07)"}));
    g.appendChild(el("line",{x1:P(0,i)[0],y1:P(0,i)[1],x2:P(F,i)[0],y2:P(F,i)[1],stroke:"rgba(235,226,213,.07)"}));
  }
  [[[0,F],[F,F]],[[F,0],[F,F]]].forEach(([a,b])=>{
    g.appendChild(el("polygon",{points:poly([P(a[0],a[1]),P(b[0],b[1]),P(b[0],b[1],STUB),P(a[0],a[1],STUB)]),
      fill:"none",stroke:"rgba(235,226,213,.16)","stroke-dasharray":"2 4"}));
  });
}
function drawOpenings(g){
  const live=IS_DESIGN&&mode==="inventory",F=PROJ.F,[d0,d1]=doorSpan(),[w0,w1]=winSpan();
  const cl=door.side==="left"
    ?[P(0,d0-0.15),P(1.1,d0-0.15),P(1.1,d1+0.15),P(0,d1+0.15)]
    :[P(d0-0.15,F-1.15),P(d1+0.15,F-1.15),P(d1+0.15,F),P(d0-0.15,F)];
  g.appendChild(el("polygon",{points:poly(cl),fill:"rgba(232,163,61,.07)",
    stroke:"rgba(232,163,61,.3)","stroke-dasharray":"4 4"}));
  const cc=centroid(cl);
  const ct=el("text",{x:cc[0],y:cc[1],class:"openlabel","text-anchor":"middle"});
  ct.textContent="проход";g.appendChild(ct);
  const dp=door.side==="left"
    ?[P(0,d0,0),P(0,d1,0),P(0,d1,DOOR_H),P(0,d0,DOOR_H)]
    :[P(d0,F,0),P(d1,F,0),P(d1,F,STUB),P(d0,F,STUB)];
  const dg=el("g",live?{"data-move":"door",style:"cursor:grab"}:{});
  dg.appendChild(el("polygon",{points:poly(dp),fill:"rgba(235,226,213,.10)",
    stroke:live?"var(--amber)":"rgba(235,226,213,.4)","stroke-width":live?"1.8":"1.1"}));
  const dc=centroid(dp);
  const dt=el("text",{x:dc[0],y:dc[1]+(door.side==="left"?0:4),class:"openlabel","text-anchor":"middle"});
  dt.textContent="дверь";dg.appendChild(dt);g.appendChild(dg);
  const wp=win.side==="right"
    ?[P(w0,0,WIN_Z0),P(w1,0,WIN_Z0),P(w1,0,WIN_Z1),P(w0,0,WIN_Z1)]
    :[P(F,w0,0.08),P(F,w1,0.08),P(F,w1,STUB),P(F,w0,STUB)];
  const wg=el("g",live?{"data-move":"window",style:"cursor:grab"}:{});
  wg.appendChild(el("polygon",{points:poly(wp),fill:"rgba(120,150,190,.22)",
    stroke:live?"var(--amber)":"rgba(235,226,213,.4)","stroke-width":live?"1.8":"1.1"}));
  const wc=centroid(wp);
  const wt=el("text",{x:wc[0],y:wc[1]+4,class:"openlabel","text-anchor":"middle"});
  wt.textContent="окно";wg.appendChild(wt);g.appendChild(wg);
}
function box(cx,cy,w,d,h,st){
  const A=[cx-w/2,cy-d/2],B=[cx+w/2,cy-d/2],C=[cx+w/2,cy+d/2],D=[cx-w/2,cy+d/2];
  const g=el("g",{}),s=st||{f1:"rgba(235,226,213,.10)",f2:"rgba(235,226,213,.05)",
    f3:"rgba(235,226,213,.17)",st:"rgba(235,226,213,.6)"};
  g.appendChild(el("polygon",{points:poly([P(B[0],B[1]),P(C[0],C[1]),P(C[0],C[1],h),P(B[0],B[1],h)]),
    fill:s.f1,stroke:s.st}));
  g.appendChild(el("polygon",{points:poly([P(D[0],D[1]),P(C[0],C[1]),P(C[0],C[1],h),P(D[0],D[1],h)]),
    fill:s.f2,stroke:s.st}));
  g.appendChild(el("polygon",{points:poly([P(A[0],A[1],h),P(B[0],B[1],h),P(C[0],C[1],h),P(D[0],D[1],h)]),
    fill:s.f3,stroke:s.st}));
  return g;
}
function drawWalk(g){
  if(!showWalk||!NAV) return;
  const h=STEP*0.42;
  for(let i=0;i<NAV.GN;i++) for(let j=0;j<NAV.GN;j++){
    const c=NAV.comp[NAV.idx(i,j)];if(c<0) continue;
    const x=i*STEP,y=j*STEP;
    g.appendChild(el("polygon",{points:poly([P(x-h,y),P(x,y-h),P(x+h,y),P(x,y+h)]),
      fill:c===NAV.home?"rgba(159,196,192,.16)":"rgba(232,163,61,.28)"}));
  }
}
function drawCat(g){
  if(!catOn) return;
  const b=P(cat.x,cat.y),u=PROJ.TW/60*1.85,S=v=>v*u,d=cat.dir;
  const st=cat.st,ph=cat.ph;
  const jumpY=st==="jump"?-Math.abs(Math.sin(ph*2.2))*S(16):0;
  const cg=el("g",{"data-move":"cat",style:"cursor:grab"});
  cg.appendChild(el("ellipse",{cx:b[0],cy:b[1],rx:S(14),ry:S(14)*(PROJ.tilt||0.5),
    fill:"rgba(0,0,0,.32)"}));
  const G=el("g",{transform:"translate("+b[0]+","+(b[1]+jumpY)+") scale("+d+",1)"});
  const CS={stroke:"#9FC4C0","stroke-width":1.5*u,fill:"rgba(159,196,192,.28)","stroke-linecap":"round"};
  const low=st==="lie",sit=st==="sit",eat=st==="eat"||st==="dig";
  const bodyY=low?-S(6):sit?-S(11):-S(13);
  const bodyRX=low?S(18):sit?S(11):S(15);
  const bodyRY=low?S(6):sit?S(11):S(9);
  // хвост
  const w=Math.sin(ph*(low?0.6:1))*S(low?3:5);
  const tx=-bodyRX*0.85;
  const tail=low
    ? "M"+tx+","+(bodyY+S(2))+" q"+(-S(14))+","+S(4)+" "+(-S(20))+","+(w*0.4)
    : "M"+tx+","+(bodyY)+" q"+(-S(12))+","+(-S(10)+w)+" "+(-S(6))+","+(-S(22)+w);
  cg.appendChild(el("g",{}));
  G.appendChild(el("path",Object.assign({d:tail,fill:"none"},CS,{fill:"none"})));
  // лапы
  if(!low){
    const legs=sit?[[-S(5),S(0)],[S(7),S(0)]]:[[-S(9),0],[-S(3),0],[S(4),0],[S(9),0]];
    legs.forEach((L,i)=>{
      const sw=st==="walk"?Math.sin(ph+i*1.6)*S(3.5):0;
      const y0=bodyY+bodyRY*0.6,y1=sit&&i===0?bodyY+bodyRY*0.4:0;
      G.appendChild(el("line",{x1:L[0],y1:y0,x2:L[0]+sw,y2:y1,
        stroke:"#9FC4C0","stroke-width":1.6*u,"stroke-linecap":"round"}));
    });
  }
  // тело
  G.appendChild(el("ellipse",Object.assign({cx:0,cy:bodyY,rx:bodyRX,ry:bodyRY},CS)));
  // голова
  const hx=low?bodyRX*0.72:sit?S(8):S(12);
  const hy=low?bodyY-S(2):sit?bodyY-S(11):bodyY-S(8)+(eat?S(5):0);
  G.appendChild(el("circle",Object.assign({cx:hx,cy:hy,r:S(7.5)},CS)));
  G.appendChild(el("polygon",Object.assign({points:
    (hx-S(5))+","+(hy-S(5))+" "+(hx-S(1.5))+","+(hy-S(11))+" "+(hx+S(1))+","+(hy-S(5.5))},CS)));
  G.appendChild(el("polygon",Object.assign({points:
    (hx+S(2.5))+","+(hy-S(5.5))+" "+(hx+S(6))+","+(hy-S(10.5))+" "+(hx+S(7))+","+(hy-S(4))},CS)));
  G.appendChild(el("circle",{cx:hx+S(4),cy:hy-S(0.5),r:S(1.1),fill:"#EBE2D5"}));
  G.appendChild(el("circle",{cx:hx+S(7),cy:hy-S(0.5),r:S(1.1),fill:"#EBE2D5"}));
  cg.appendChild(G);
  if(cat.bubble){
    const tw=cat.bubble.length*5.6+18,bx=b[0]-tw/2,by=b[1]-S(46)+jumpY;
    cg.appendChild(el("rect",{x:bx,y:by-20,width:tw,height:26,rx:9,
      fill:"rgba(235,226,213,.93)",stroke:"none"}));
    cg.appendChild(el("polygon",{points:(b[0]-5)+","+(by+6)+" "+(b[0]+5)+","+(by+6)+" "+b[0]+","+(by+13),
      fill:"rgba(235,226,213,.93)"}));
    const t=el("text",{x:b[0],y:by-2,class:"bubble","text-anchor":"middle"});
    t.textContent=cat.bubble;cg.appendChild(t);
  }
  g.appendChild(cg);
}
function drawCeil(g){
  const live=mode==="inventory",iid=place.CEIL;
  const t=P(light.x,light.y,WALL),b=P(light.x,light.y,WALL-0.7);
  const cg=el("g",live?{"data-move":"light",style:"cursor:grab"}:{});
  cg.appendChild(el("polygon",{points:poly([P(light.x-.5,light.y-.5,WALL),P(light.x+.5,light.y-.5,WALL),
    P(light.x+.5,light.y+.5,WALL),P(light.x-.5,light.y+.5,WALL)]),
    fill:"rgba(232,163,61,.10)",stroke:"rgba(232,163,61,.5)","stroke-dasharray":iid?"none":"3 3"}));
  if(iid){
    cg.appendChild(el("line",{x1:t[0],y1:t[1],x2:b[0],y2:b[1],stroke:"var(--amber)","stroke-width":"1.2"}));
    cg.appendChild(el("circle",{cx:b[0],cy:b[1]+5,r:iid==="chandelier"?10:5,
      fill:"rgba(232,163,61,.3)",stroke:"var(--amber)","data-item":iid}));
    const l=el("text",{x:b[0],y:b[1]+28,class:"itemlabel","text-anchor":"middle"});
    l.textContent=BY_ID[iid].ru;cg.appendChild(l);
  }else if(showLabels){
    const l=el("text",{x:t[0],y:t[1]+4,class:"zonelabel","text-anchor":"middle"});
    l.textContent="точка света";cg.appendChild(l);
  }
  g.appendChild(cg);
}
function drawItem(zid,iid){
  const z=ZMAP[zid],it=BY_ID[iid];
  const g=el("g",{"data-item":iid,style:mode==="inventory"?"cursor:grab":"cursor:default"});
  let lp;
  if(z.band==="wall"||z.band==="surface"){
    const pts=zonePoly(z),c=centroid(pts);
    const ins=pts.map(p=>[c[0]+(p[0]-c[0])*.78,c[1]+(p[1]-c[1])*.78]);
    g.appendChild(el("polygon",{points:poly(ins),fill:"rgba(235,226,213,.16)",
      stroke:"rgba(235,226,213,.7)","stroke-width":"1.2"}));
    lp=[c[0],c[1]+3];
  }else{
    const cx=(z.r[0]+z.r[2])/2,cy=(z.r[1]+z.r[3])/2,[w,d]=fit(it,z),h=it.s[2];
    g.appendChild(box(cx,cy,w,d,h));
    const t=P(cx,cy,h);lp=[t[0],t[1]-7];
  }
  const t=el("text",{x:lp[0],y:lp[1],class:"itemlabel","text-anchor":"middle"});
  t.textContent=it.ru;g.appendChild(t);return g;
}
const depth=zid=>{const z=ZMAP[zid];return (z.r[0]+z.r[2])/2+(z.r[1]+z.r[3])/2+(z.band==="surface"?.01:0);};
/* ================= интерфейс: трапеции под сценой ================= */
function panelGeo(){
  // высота кнопочного ряда пересчитывается под текущую сцену (наклон/зум/пол могут
  // подвинуть ближний угол комнаты вниз) — не даём панели заехать в сцену.
  const F=PROJ.F,sl=PROJ.TH/PROJ.TW,corner=P(F,F);
  const bot=SCREEN_H-8,bw=68,bh0=64,footer=28,gap=8;
  const padBtn=8,padList=36; // трапеция облегает зону кнопок (+запас на заголовок инвентаря)
  const iconH=bh0*0.30*1.6; // номинальная высота иконки в ячейке, см. icon()/drawList()
  const fit=min=>clamp(bot-footer-(corner[1]+gap),min,bh0);
  const listOnR=mode==="inventory"||mode==="supplies";
  const bhL=fit(iconH/2);              // минимум кнопки — половина высоты иконки, дальше можно обрезать
  const bhR=fit(listOnR?iconH:iconH/2); // зона инвентаря — минимум целая иконка
  const byL=bot-footer-bhL,byR=bot-footer-bhR;
  const topL=byL-padBtn,topR=byR-(listOnR?padList:padBtn);
  const yL=x=>topL-(OX-x)*sl, yR=x=>topR-(x-OX)*sl;
  const L={poly:[[8,Math.max(yL(8),20)],[OX-8,topL],[OX-8,bot],[8,bot]],btn:[],iconS:bh0*0.30};
  const R={poly:[[OX+8,topR],[532,Math.max(yR(532),20)],[532,bot],[OX+8,bot]],btn:[],iconS:bh0*0.30};
  for(let i=0;i<3;i++){
    L.btn.push({x:22+i*78,y:byL,w:bw,h:bhL});
    R.btn.push({x:OX+22+i*78,y:byR,w:bw,h:bhR});
  }
  L.labelY=bot-14;R.labelY=bot-14;L.bot=bot;R.bot=bot;L.top=topL;R.top=topR;
  return {L,R};
}
let UIG=null;
function drawPanel(g,pn,active){
  g.appendChild(el("polygon",{points:poly(pn.poly),fill:"rgba(46,40,51,.93)",
    stroke:active?"var(--amber)":"rgba(235,226,213,.26)","stroke-width":"1.2"}));
}
function drawButtons(g,pn,list){
  drawPanel(g,pn,false);
  list.forEach((b,i)=>{
    const r=pn.btn[i],on=mode===b.id;
    g.appendChild(el("rect",{x:r.x,y:r.y,width:r.w,height:r.h,rx:10,"data-btn":b.id,
      style:"cursor:pointer",fill:on?"rgba(232,163,61,.18)":"rgba(235,226,213,.06)",
      stroke:on?"var(--amber)":"rgba(235,226,213,.3)","stroke-width":"1.2"}));
    const t=el("text",{x:r.x+r.w/2,y:pn.labelY,class:"btnlabel","text-anchor":"middle"});
    t.textContent=b.l;g.appendChild(t);
  });
}

/* ================= иконки предметов ================= */
function icon(g,id,cx,cy,S){
  const L={stroke:"#EBE2D5","stroke-width":1.5,fill:"none","stroke-linejoin":"round","stroke-linecap":"round"};
  const F={stroke:"#EBE2D5","stroke-width":1.4,fill:"rgba(235,226,213,.20)"};
  const A=(n,o)=>g.appendChild(el(n,Object.assign({},o.f?F:L,o.a||{})));
  const R=(x,y,w,h,fill,rx)=>A("rect",{f:fill,a:{x:cx+x*S,y:cy+y*S,width:w*S,height:h*S,rx:(rx||0)*S}});
  const C=(x,y,r,fill)=>A("circle",{f:fill,a:{cx:cx+x*S,cy:cy+y*S,r:r*S}});
  const E=(x,y,rx,ry,fill)=>A("ellipse",{f:fill,a:{cx:cx+x*S,cy:cy+y*S,rx:rx*S,ry:ry*S}});
  const Ln=(x1,y1,x2,y2)=>A("line",{a:{x1:cx+x1*S,y1:cy+y1*S,x2:cx+x2*S,y2:cy+y2*S}});
  const Pg=(pts,fill)=>A("polygon",{f:fill,a:{points:pts.map(p=>(cx+p[0]*S)+","+(cy+p[1]*S)).join(" ")}});
  switch(id){
    case"wardrobe":R(-.5,-.8,1,1.6,1,.08);Ln(0,-.8,0,.8);C(-.12,0,.06,1);C(.12,0,.06,1);break;
    case"bookshelf":R(-.55,-.8,1.1,1.6,1,.06);Ln(-.55,-.25,.55,-.25);Ln(-.55,.25,.55,.25);
      R(-.42,-.72,.14,.42,1);R(-.2,-.72,.14,.42,1);R(-.42,-.18,.14,.4,1);break;
    case"lamp":Pg([[-.45,-.35],[.45,-.35],[.28,-.85],[-.28,-.85]],1);Ln(0,-.35,0,.7);Ln(-.3,.75,.3,.75);break;
    case"sofa":R(-.75,-.35,1.5,.5,1,.1);R(-.75,.1,1.5,.42,1,.1);Ln(-.42,.1,-.42,.52);Ln(.42,.1,.42,.52);
      Ln(-.62,.52,-.62,.7);Ln(.62,.52,.62,.7);break;
    case"aquarium":R(-.7,-.5,1.4,1,1,.06);A("path",{a:{d:"M"+(cx-.7*S)+","+(cy-.18*S)+
      " q"+(.35*S)+","+(-.16*S)+" "+(.7*S)+",0 q"+(.35*S)+","+(.16*S)+" "+(.7*S)+",0"}});
      E(.1,.25,.2,.13,1);Pg([[-.14,.25],[-.3,.12],[-.3,.38]],1);break;
    case"rug":E(0,0,.8,.5,1);E(0,0,.58,.34,0);break;
    case"table":R(-.75,-.2,1.5,.22,1,.05);Ln(-.55,.02,-.55,.6);Ln(.55,.02,.55,.6);break;
    case"pouf":E(0,.1,.6,.4,1);A("path",{a:{d:"M"+(cx-.6*S)+","+(cy+.1*S)+" q"+(.6*S)+","+(-.5*S)+" "+(1.2*S)+",0"}});break;
    case"ficus":Pg([[-.32,.15],[.32,.15],[.24,.72],[-.24,.72]],1);
      E(-.28,-.25,.28,.16,1);E(.28,-.25,.28,.16,1);E(0,-.52,.26,.17,1);Ln(0,.15,0,-.4);break;
    case"scratch":R(-.22,-.6,.44,1.1,1,.06);R(-.5,.5,1,.18,1,.05);C(.45,-.45,.14,1);Ln(.22,-.55,.45,-.5);break;
    case"box":R(-.6,-.35,1.2,1,1,.05);Ln(-.6,-.35,0,-.05);Ln(.6,-.35,0,-.05);Ln(0,-.05,0,.65);break;
    case"bed":A("path",{f:1,a:{d:"M"+(cx-.75*S)+","+(cy-.1*S)+" a"+(.75*S)+","+(.6*S)+" 0 0 0 "+(1.5*S)+
      ",0 z",fill:"rgba(235,226,213,.20)",stroke:"#EBE2D5","stroke-width":1.4}});
      A("path",{a:{d:"M"+(cx-.55*S)+","+(cy-.1*S)+" a"+(.55*S)+","+(.34*S)+" 0 0 0 "+(1.1*S)+",0"}});break;
    case"bowls":E(-.36,.1,.34,.24,1);E(.38,.1,.3,.21,1);C(-.36,.04,.05,1);C(-.24,.08,.05,1);break;
    case"vacuum":C(0,.05,.6,1);C(0,.05,.2,0);Ln(-.45,-.3,.45,-.3);break;
    case"scales":R(-.6,-.4,1.2,.8,1,.14);R(-.26,-.18,.52,.22,1,.04);break;
    case"plaid":A("path",{f:1,a:{d:"M"+(cx-.7*S)+","+(cy-.3*S)+" h"+(1.4*S)+" v"+(.5*S)+
      " q"+(-.35*S)+","+(.22*S)+" "+(-.7*S)+",0 q"+(-.35*S)+","+(-.22*S)+" "+(-.7*S)+",0 z",
      fill:"rgba(235,226,213,.20)",stroke:"#EBE2D5","stroke-width":1.4}});
      Ln(-.35,-.3,-.35,.18);Ln(.35,-.3,.35,.18);break;
    case"curtain":Ln(-.8,-.6,.8,-.6);
      A("path",{f:1,a:{d:"M"+(cx-.7*S)+","+(cy-.6*S)+" v"+(1.1*S)+" q"+(.18*S)+","+(.2*S)+" "+(.36*S)+
        ",0 v"+(-1.1*S)+" z",fill:"rgba(235,226,213,.20)",stroke:"#EBE2D5","stroke-width":1.3}});
      A("path",{f:1,a:{d:"M"+(cx+.34*S)+","+(cy-.6*S)+" v"+(1.1*S)+" q"+(.18*S)+","+(.2*S)+" "+(.36*S)+
        ",0 v"+(-1.1*S)+" z",fill:"rgba(235,226,213,.20)",stroke:"#EBE2D5","stroke-width":1.3}});break;
    case"garland":A("path",{a:{d:"M"+(cx-.75*S)+","+(cy-.3*S)+" q"+(.375*S)+","+(.5*S)+" "+(.75*S)+
      ",0 q"+(.375*S)+","+(-.5*S)+" "+(.75*S)+",0"}});
      C(-.4,.08,.11,1);C(0,.16,.11,1);C(.4,.08,.11,1);break;
    case"wshelf":Ln(-.7,.2,.7,.2);Ln(-.5,.2,-.4,.5);Ln(.5,.2,.4,.5);
      R(-.5,-.2,.28,.4,1,.04);C(0,-.02,.18,1);Pg([[.3,.2],[.5,.2],[.4,-.2]],1);break;
    case"clock":C(0,0,.7,1);Ln(0,0,0,-.4);Ln(0,0,.3,.1);break;
    case"portrait":R(-.6,-.7,1.2,1.4,1,.06);C(0,-.2,.22,1);Pg([[-.4,.5],[0,.05],[.4,.5]],1);break;
    case"bulb":C(0,-.15,.42,1);R(-.16,.27,.32,.3,1,.05);Ln(0,-.57,0,-.85);break;
    case"chandelier":Ln(0,-.85,0,-.35);Ln(-.6,-.35,.6,-.35);
      Pg([[-.75,-.05],[-.45,-.05],[-.6,-.35]],1);Pg([[-.15,-.05],[.15,-.05],[0,-.35]],1);
      Pg([[.45,-.05],[.75,-.05],[.6,-.35]],1);break;
    case"dry":Pg([[-.45,-.6],[.45,-.6],[.55,.65],[-.55,.65]],1);
      C(-.2,.1,.09,1);C(.12,.24,.09,1);C(.2,-.08,.09,1);C(-.1,-.3,.09,1);break;
    case"can":E(0,-.4,.55,.22,1);R(-.55,-.4,1.1,.85,1,0);
      A("path",{a:{d:"M"+(cx-.55*S)+","+(cy+.45*S)+" a"+(.55*S)+","+(.22*S)+" 0 0 0 "+(1.1*S)+",0"}});
      Ln(-.28,-.05,.28,-.05);break;
    case"treat":E(-.05,0,.5,.3,1);Pg([[.45,0],[.8,-.28],[.8,.28]],1);C(-.28,-.07,.06,1);break;
    case"wand":Ln(-.7,.7,.15,-.15);
      A("path",{f:1,a:{d:"M"+(cx+.15*S)+","+(cy-.15*S)+" q"+(.3*S)+","+(-.55*S)+" "+(.62*S)+","+(-.25*S)+
       " q"+(-.05*S)+","+(.45*S)+" "+(-.62*S)+","+(.25*S)+" z",fill:"rgba(235,226,213,.20)",
       stroke:"#EBE2D5","stroke-width":1.3}});break;
    case"ball":C(0,0,.62,1);A("path",{a:{d:"M"+(cx-.55*S)+","+(cy-.25*S)+" q"+(.55*S)+","+(.35*S)+" "+
      (1.1*S)+",0"}});A("path",{a:{d:"M"+(cx-.4*S)+","+(cy+.48*S)+" q"+(.3*S)+","+(-.7*S)+" "+(.2*S)+","+(-1.05*S)}});break;
    case"mouse":E(0,.1,.55,.34,1);C(-.45,-.15,.22,1);C(-.52,-.34,.13,1);Ln(.5,.15,.85,.5);
      C(-.6,-.08,.05,1);break;
    default:C(0,0,.5,1);
  }
}

const listSource=()=>mode==="inventory"
  ? ITEMS.filter(i=>!new Set(Object.values(place)).has(i.id)):SUPPLIES;
function drawList(g,pn){
  const src=listSource(),per=3,pages=Math.max(1,Math.ceil(src.length/per));
  let page=clamp(mode==="inventory"?pageInv:pageSup,0,pages-1);
  if(mode==="inventory") pageInv=page;else pageSup=page;
  drawPanel(g,pn,true);
  g.appendChild(el("polygon",{points:poly(pn.poly),fill:"transparent","data-drop":"list"}));
  const ttl=el("text",{x:pn.btn[0].x,y:pn.btn[0].y-16,class:"btnlabel"});
  ttl.textContent=mode==="inventory"?"Инвентарь":"Запасы";g.appendChild(ttl);
  const cx=el("text",{x:pn.btn[2].x+pn.btn[2].w-4,y:pn.btn[0].y-14,class:"openlabel","text-anchor":"end"});
  cx.textContent="× закрыть";g.appendChild(cx);
  g.appendChild(el("rect",{x:pn.btn[2].x,y:pn.btn[0].y-30,width:pn.btn[2].w+4,height:24,
    fill:"transparent","data-btn":"close",style:"cursor:pointer"}));
  src.slice(page*per,page*per+per).forEach((it,i)=>{
    const r=pn.btn[i];
    const cell=el("g",{style:"cursor:grab","data-cell":it.id});
    cell.appendChild(el("rect",{x:r.x,y:r.y,width:r.w,height:r.h,rx:10,class:"iconbg"}));
    // иконка рисуется номинального размера и обрезается по ячейке, а не сжимается вместе с ней
    const clipId="clip-"+it.id;
    const clip=el("clipPath",{id:clipId});
    clip.appendChild(el("rect",{x:r.x,y:r.y,width:r.w,height:r.h,rx:10}));
    cell.appendChild(clip);
    const iconG=el("g",{"clip-path":"url(#"+clipId+")"});
    icon(iconG,it.id,r.x+r.w/2,r.y+r.h/2,pn.iconS);
    cell.appendChild(iconG);
    g.appendChild(cell);
    const t=el("text",{x:r.x+r.w/2,y:pn.labelY,class:"celllabel","text-anchor":"middle"});
    t.textContent=it.ru.length>11?it.ru.slice(0,10)+"…":it.ru;g.appendChild(t);
  });
  if(!src.length){
    const t=el("text",{x:pn.btn[1].x+34,y:pn.btn[1].y+38,class:"celllabel","text-anchor":"middle"});
    t.textContent="Пусто";g.appendChild(t);
  }
  if(pages>1){
    for(let i=0;i<pages;i++)
      g.appendChild(el("circle",{cx:pn.btn[1].x+34-(pages-1)*6+i*12,cy:pn.bot-4,r:3,
        fill:i===page?"var(--amber)":"rgba(235,226,213,.25)"}));
    [["-1",pn.btn[0].x-16],["1",pn.btn[2].x+pn.btn[2].w+2]].forEach(([d,x])=>{
      g.appendChild(el("rect",{x,y:pn.btn[0].y+8,width:16,height:48,rx:5,
        fill:"rgba(235,226,213,.05)","data-page":d,style:"cursor:pointer"}));
      const t=el("text",{x:x+8,y:pn.btn[0].y+38,class:"openlabel","text-anchor":"middle"});
      t.textContent=d==="1"?"›":"‹";g.appendChild(t);
    });
  }
}
/* верхние показатели */
function catFace(g,cx,cy,r){
  const F={stroke:"#9FC4C0","stroke-width":1.6,fill:"rgba(159,196,192,.26)"};
  g.appendChild(el("polygon",Object.assign({points:
    (cx-r*.78)+","+(cy-r*.42)+" "+(cx-r*.55)+","+(cy-r*1.22)+" "+(cx-r*.1)+","+(cy-r*.62)},F)));
  g.appendChild(el("polygon",Object.assign({points:
    (cx+r*.1)+","+(cy-r*.62)+" "+(cx+r*.55)+","+(cy-r*1.22)+" "+(cx+r*.78)+","+(cy-r*.42)},F)));
  g.appendChild(el("circle",Object.assign({cx,cy,r},F)));
  const sad=mood<40;
  g.appendChild(el("circle",{cx:cx-r*.34,cy:cy-r*.1,r:r*.13,fill:"#EBE2D5"}));
  g.appendChild(el("circle",{cx:cx+r*.34,cy:cy-r*.1,r:r*.13,fill:"#EBE2D5"}));
  g.appendChild(el("path",{d:sad?"M"+(cx-r*.3)+","+(cy+r*.5)+" q"+(r*.3)+","+(-r*.28)+" "+(r*.6)+",0"
    :"M"+(cx-r*.3)+","+(cy+r*.32)+" q"+(r*.3)+","+(r*.3)+" "+(r*.6)+",0",
    fill:"none",stroke:"#EBE2D5","stroke-width":1.4}));
}
function drawHUD(g){
  catFace(g,38,54,17);
  const x0=64,x1=250,y=42,h=20;
  g.appendChild(el("rect",{x:x0,y,width:x1-x0,height:h,rx:h/2,
    fill:"rgba(46,40,51,.9)",stroke:"rgba(235,226,213,.3)"}));
  const w=(x1-x0-6)*clamp(mood,0,100)/100;
  g.appendChild(el("rect",{x:x0+3,y:y+3,width:Math.max(6,w),height:h-6,rx:(h-6)/2,
    fill:mood<40?"#D79A9A":mood<70?"#D9C08E":"#9FC4C0"}));
  const m=el("text",{x:x1+8,y:y+15,class:"btnlabel"});m.textContent=Math.round(mood);g.appendChild(m);
  // рыбки
  const fx=318,fy=52;
  g.appendChild(el("ellipse",{cx:fx,cy:fy,rx:11,ry:7,fill:"rgba(120,150,190,.4)",stroke:"#8FA8C8"}));
  g.appendChild(el("polygon",{points:(fx-11)+","+fy+" "+(fx-19)+","+(fy-6)+" "+(fx-19)+","+(fy+6),
    fill:"rgba(120,150,190,.4)",stroke:"#8FA8C8"}));
  g.appendChild(el("circle",{cx:fx+4,cy:fy-2,r:1.4,fill:"#EBE2D5"}));
  const ft=el("text",{x:fx+18,y:fy+5,class:"hudnum"});ft.textContent=fish;g.appendChild(ft);
  // алмазики
  const gx=452,gy=52;
  g.appendChild(el("polygon",{points:gx+","+(gy-10)+" "+(gx+9)+","+gy+" "+gx+","+(gy+10)+" "+(gx-9)+","+gy,
    fill:"rgba(199,184,216,.42)",stroke:"#C9B8D8","stroke-width":1.4}));
  const gt=el("text",{x:gx+16,y:gy+5,class:"hudnum"});gt.textContent=gems;g.appendChild(gt);
}
const dirty=()=>JSON.stringify(params)!==JSON.stringify(applied);
function drawSettings(g){
  g.appendChild(el("rect",{x:SET.x,y:SET.y,width:SET.w,height:SET.h,rx:14,
    fill:"rgba(46,40,51,.96)",stroke:"var(--amber)","stroke-width":"1.2"}));
  const ttl=el("text",{x:SET.x+20,y:SET.y+28,class:"setlabel"});
  ttl.textContent="Настройки сцены";g.appendChild(ttl);
  const cx=el("text",{x:SET.x+SET.w-20,y:SET.y+28,class:"openlabel","text-anchor":"end"});
  cx.textContent="× закрыть";g.appendChild(cx);
  g.appendChild(el("rect",{x:SET.x+SET.w-80,y:SET.y+10,width:74,height:26,fill:"transparent",
    "data-btn":"close",style:"cursor:pointer"}));
  SLIDERS.forEach((s,i)=>{
    const y=SET.y+70+i*50,x0=SET.x+150,x1=SET.x+SET.w-76;
    const l=el("text",{x:SET.x+20,y:y+4,class:"setlabel"});l.textContent=s.l;g.appendChild(l);
    g.appendChild(el("line",{x1:x0,y1:y,x2:x1,y2:y,stroke:"rgba(235,226,213,.25)",
      "stroke-width":"3","stroke-linecap":"round"}));
    const f=(params[s.id]-s.min)/(s.max-s.min);
    g.appendChild(el("line",{x1:x0,y1:y,x2:x0+f*(x1-x0),y2:y,stroke:"var(--amber)",
      "stroke-width":"3","stroke-linecap":"round"}));
    g.appendChild(el("rect",{x:x0-12,y:y-16,width:x1-x0+24,height:32,fill:"transparent",
      "data-slider":s.id,style:"cursor:ew-resize"}));
    g.appendChild(el("circle",{cx:x0+f*(x1-x0),cy:y,r:8,fill:"var(--ground-deep)",
      stroke:"var(--amber)","stroke-width":"2","data-slider":s.id,style:"cursor:ew-resize"}));
    const v=el("text",{x:SET.x+SET.w-24,y:y+4,class:"setval","text-anchor":"end"});
    v.textContent=s.fmt(params[s.id]);g.appendChild(v);
  });
  const tg=[["cat","Кот в комнате",catOn],["labels","Подписи зон",showLabels],
            ["empty","Пустые зоны",showEmpty],["walk","Проходимость",showWalk],
            ["reset","Исходная раскладка",null],["clear","Убрать всё",null],
            ["expand","Во весь экран",null]];
  tg.forEach(([id,l,on],i)=>{
    const c=i%2,r=Math.floor(i/2);
    const x=SET.x+20+c*230,y=SET.y+236+r*42;
    g.appendChild(el("rect",{x,y,width:222,height:34,rx:8,
      "data-btn":(on===null?"":"tg-")+id,style:"cursor:pointer",
      fill:on?"rgba(232,163,61,.16)":"rgba(235,226,213,.05)",
      stroke:on?"var(--amber)":"rgba(235,226,213,.28)"}));
    const t=el("text",{x:x+111,y:y+22,class:"btnlabel","text-anchor":"middle"});
    t.textContent=l;g.appendChild(t);
  });
  const d=dirty();
  g.appendChild(el("rect",{x:SET.x+20,y:SET.y+SET.h-56,width:SET.w-40,height:42,rx:9,
    "data-btn":"save",style:"cursor:pointer",fill:d?"rgba(232,163,61,.22)":"rgba(235,226,213,.05)",
    stroke:d?"var(--amber)":"rgba(235,226,213,.28)","stroke-width":d?"1.6":"1.1"}));
  const st=el("text",{x:SET.x+SET.w/2,y:SET.y+SET.h-30,class:d?"setval":"btnlabel","text-anchor":"middle"});
  st.textContent=d?"Сохранить и пересчитать зоны":"Зоны пересчитаны под эту сцену";
  g.appendChild(st);
}
function drawUI(g){
  const {L,R}=UIG;
  drawHUD(g);
  g.appendChild(el("rect",{x:492,y:88,width:34,height:34,rx:8,"data-btn":"expand",
    style:"cursor:pointer",fill:"rgba(235,226,213,.06)",stroke:"rgba(235,226,213,.3)"}));
  const ex=el("text",{x:509,y:111,class:"openlabel","text-anchor":"middle"});
  ex.textContent=document.fullscreenElement?"⤡":"⤢";g.appendChild(ex);
  drawButtons(g,L,LBTN);
  if(mode==="inventory"||mode==="supplies") drawList(g,R);else drawButtons(g,R,RBTN);
  if(mode==="settings") drawSettings(g);
}

/* ================= сборка кадра ================= */
let catLayer=null,uiLayer=null;
function render(){
  applyProj(params);PROJ.tilt=params.tilt;buildZones();UIG=panelGeo();
  svg.textContent="";
  const shell=el("g",{});drawShell(shell);svg.appendChild(shell);
  const zg=el("g",{id:"zones"});
  ZONES.forEach(z=>{
    const pts=zonePoly(z),occ=!!place[z.id];
    const p=el("polygon",{points:poly(pts),"data-zone":z.id,"stroke-width":"1",
      fill:z.blocked?"rgba(232,163,61,.05)":(occ?"rgba(235,226,213,.02)":"rgba(235,226,213,.05)"),
      stroke:z.blocked?"rgba(232,163,61,.3)":(occ?"rgba(235,226,213,.18)":"rgba(235,226,213,.34)"),
      "stroke-dasharray":occ?"none":"3 3"});
    if(!showEmpty&&!occ){p.setAttribute("fill","rgba(0,0,0,0)");p.setAttribute("stroke","rgba(0,0,0,0)");}
    zg.appendChild(p);
    if(showLabels&&!occ&&!z.blocked){
      const c=centroid(pts);
      const t=el("text",{x:c[0],y:c[1]+3,class:"zonelabel","text-anchor":"middle"});
      t.textContent=z.ru;zg.appendChild(t);
    }
  });
  svg.appendChild(zg);
  const og=el("g",{id:"openings"});
  if(mode!=="inventory") og.setAttribute("style","pointer-events:none");
  drawOpenings(og);svg.appendChild(og);
  NAV=buildNav();
  if(cat.path.length&&cat.path.some(p=>!NAV.free(p[0],p[1]))) cat.path=[];
  if(!NAV.free(cat.x,cat.y)){const s=nearSpot(cat.x,cat.y);cat.x=s[0];cat.y=s[1];cat.path=[];}
  const wg=el("g",{id:"walk"});drawWalk(wg);svg.appendChild(wg);
  const ig=el("g",{id:"items"});
  const e=Object.entries(place).filter(([z])=>z!=="CEIL"&&ZMAP[z]);
  e.filter(([z,i])=>BY_ID[i].s&&BY_ID[i].s[2]<.06).forEach(([z,i])=>ig.appendChild(drawItem(z,i)));
  e.filter(([z,i])=>!BY_ID[i].s||BY_ID[i].s[2]>=.06)
   .sort((a,b)=>depth(a[0])-depth(b[0])).forEach(([z,i])=>ig.appendChild(drawItem(z,i)));
  drawCeil(ig);svg.appendChild(ig);
  catLayer=el("g",{id:"catlayer"});drawCat(catLayer);svg.appendChild(catLayer);
  svg.appendChild(el("g",{id:"draglayer"}));
  uiLayer=el("g",{id:"ui"});drawUI(uiLayer);svg.appendChild(uiLayer);
  renderOut();syncControls();checkCapacity();checkCat();
}
function refreshCat(){
  if(!catLayer) return;
  catLayer.textContent="";drawCat(catLayer);
}
function refreshHUD(){
  if(!uiLayer) return;
  const {L,R}=UIG;uiLayer.textContent="";drawUI(uiLayer);
}
function highlight(it){
  svg.querySelectorAll("[data-zone]").forEach(p=>{
    const z=ZMAP[p.dataset.zone],ok=it?!reject(z,it):(z.band!=="wall"&&z.band!=="surface"&&!z.blocked);
    if(ok){p.setAttribute("fill","rgba(232,163,61,.17)");p.setAttribute("stroke","var(--amber)");
      p.setAttribute("stroke-width","1.6");p.setAttribute("stroke-dasharray","none");}
    else{p.setAttribute("fill","rgba(235,226,213,.015)");p.setAttribute("stroke","rgba(235,226,213,.08)");
      p.setAttribute("stroke-width","1");}
  });
}
function checkCapacity(){
  const b=document.getElementById("cap"),used=new Set(Object.values(place));
  const bad=ITEMS.filter(it=>it.cat!=="ceil"&&!used.has(it.id)&&
    ZONES.filter(z=>!reject(z,it)&&!place[z.id]).length===0);
  const free=ZONES.filter(z=>!place[z.id]&&!z.blocked).length;
  b.className=bad.length?"bad":"";
  b.textContent=(bad.length?"Некуда поставить: "+bad.map(i=>i.ru.toLowerCase()).join(", ")+". "
    :"Всем предметам есть место. ")+"Свободных зон: "+free+".";
}
function checkCat(){
  const b=document.getElementById("nav");if(!NAV){b.textContent="";return;}
  const parts=["Свободного пола: "+NAV.area+"%."];let bad=false;
  if(NAV.area<28){bad=true;parts.push("Тесно — коту негде разгоняться.");}
  if(NAV.pockets>1){bad=true;parts.push("Пол разрезан на "+NAV.pockets+" участка.");}
  if(NAV.unreachable.length){bad=true;parts.push("Коту не подойти: "+NAV.unreachable.join(", ").toLowerCase()+".");}
  if(!bad) parts.push("Проходы шире кота, подход есть ко всему.");
  b.className=bad?"bad":"";b.textContent=parts.join(" ");
}
const BANDS=[["back","BACK BAND — tall pieces against the two back walls"],
  ["mid","MIDDLE BAND — the seating area"],
  ["front","FRONT BAND — low objects only, closest to the viewer"],
  ["surface","ON TOP OF FURNITURE"],["wall","WALLS"]];
function renderOut(){
  const s=[],[d0]=doorSpan(),[w0]=winSpan();
  s.push("ROOM: a square room, about "+PROJ.F.toFixed(1)+" tiles per side, drawn in 2:1 isometry.");
  s.push("OPENINGS:\n- the door is set into "+(door.side==="left"?"the left back wall":"the near left wall")+
    ", "+(d0<1.6?"close to the corner":d0<2.8?"midway along it":"towards the far end")+
    ".\n- the window is set into "+(win.side==="right"?"the right back wall":"the near right wall")+
    ", "+(w0<1.4?"close to the corner":w0<2.4?"midway along it":"towards the far end")+".");
  BANDS.forEach(([b,t])=>{
    const l=ZONES.filter(z=>z.band===b&&place[z.id]).map(z=>"- "+BY_ID[place[z.id]].en+" "+z.en+".");
    if(l.length) s.push(t+":\n"+l.join("\n"));
  });
  if(place.CEIL) s.push("CEILING:\n- "+BY_ID[place.CEIL].en+" hanging "+
    (Math.abs(light.x-light.y)<.8?"over the centre of the room":
     light.x>light.y?"over the right side of the room":"over the left side of the room")+".");
  document.getElementById("out").value=s.join("\n\n");
}
/* ================= ввод ================= */
let drag=null;
function toSvg(e){const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;
  return p.matrixTransform(svg.getScreenCTM().inverse());}
function dragLayer(){return svg.querySelector("#draglayer");}
function startDrag(kind,id,from,e){
  drag={kind,id,from};svg.classList.add("dragging");
  highlight(kind==="item"?BY_ID[id]:null);
  moveGhost(e);
  window.addEventListener("pointermove",moveGhost);
  window.addEventListener("pointerup",endDrag,{once:true});
}
function moveGhost(e){
  const L=dragLayer();if(!L||!drag) return;
  L.textContent="";
  const p=toSvg(e),it=drag.kind==="item"?BY_ID[drag.id]:SUP_BY_ID[drag.id];
  const st={f1:"rgba(232,163,61,.16)",f2:"rgba(232,163,61,.10)",f3:"rgba(232,163,61,.26)",
    st:"var(--amber)"};
  if(drag.kind==="item"&&it.s){
    const [tx,ty]=unP(p.x,p.y);
    const g=box(tx,ty,it.s[0],it.s[1],it.s[2],st);
    g.setAttribute("opacity","0.95");L.appendChild(g);
    const b=P(tx,ty,it.s[2]);
    const t=el("text",{x:b[0],y:b[1]-10,class:"itemlabel","text-anchor":"middle"});
    t.textContent=it.ru;L.appendChild(t);
  }else{
    L.appendChild(el("circle",{cx:p.x,cy:p.y,r:20,fill:"rgba(232,163,61,.18)",
      stroke:"var(--amber)","stroke-width":"1.6"}));
    icon(L,drag.id,p.x,p.y,13);
    const t=el("text",{x:p.x,y:p.y-28,class:"itemlabel","text-anchor":"middle"});
    t.textContent=it.ru;L.appendChild(t);
  }
}
function endDrag(e){
  window.removeEventListener("pointermove",moveGhost);
  svg.classList.remove("dragging");
  const L=dragLayer();if(L) L.textContent="";
  if(!drag) return;
  const d=drag;drag=null;
  const tgt=document.elementFromPoint(e.clientX,e.clientY);
  if(!tgt){render();return;}
  const zp=tgt.closest("[data-zone]");
  if(d.kind==="supply"){
    const p=toSvg(e),cp=P(cat.x,cat.y),sup=SUP_BY_ID[d.id];
    const onCat=catOn&&Math.hypot(p.x-cp[0],p.y-cp[1])<46;
    const [tx,ty]=unP(p.x,p.y);
    if(onCat){sup.food?feedHand():playHand();}
    else if(zp&&place[zp.dataset.zone]==="bowls"&&sup.food) feedBowl();
    else if(zp&&["back","mid","front"].includes(ZMAP[zp.dataset.zone].band)&&sup.food) feedFloor(tx,ty);
    else if(zp&&sup.food===undefined) playHand();
    render();return;
  }
  if(tgt.closest('[data-drop="list"]')){if(d.from) delete place[d.from];render();return;}
  const it=BY_ID[d.id];
  if(it.cat==="ceil"){
    const p=toSvg(e),lp=P(light.x,light.y,WALL);
    if(Math.hypot(p.x-lp[0],p.y-lp[1])<90){
      const prev=place.CEIL;if(d.from) delete place[d.from];
      place.CEIL=d.id;if(prev&&prev!==d.id&&d.from) place[d.from]=prev;
    }
    render();return;
  }
  if(!zp){render();return;}
  const z=ZMAP[zp.dataset.zone];
  if(reject(z,it)){render();return;}
  const disp=place[z.id];
  if(d.from) delete place[d.from];
  place[z.id]=d.id;
  if(disp&&disp!==d.id&&d.from) place[d.from]=disp;
  render();
}
function nearestOnSeg(p,a,b){
  const vx=b[0]-a[0],vy=b[1]-a[1],t=clamp(((p.x-a[0])*vx+(p.y-a[1])*vy)/(vx*vx+vy*vy),0,1);
  return {t,d:Math.hypot(a[0]+vx*t-p.x,a[1]+vy*t-p.y)};
}
function startMove(kind,e){
  const F=PROJ.F;
  const mv=ev=>{
    const p=toSvg(ev);
    if(kind==="cat"){
      const [nx,ny]=unP(p.x,p.y);
      if(NAV&&NAV.free(clamp(nx,0,F),clamp(ny,0,F))){
        cat.x=clamp(nx,0,F);cat.y=clamp(ny,0,F);cat.path=[];setSt("idle",1.5,idleCycle);
      }
      refreshCat();return;
    }
    if(kind==="light"){
      const u=(p.x-OX)/PROJ.TW,v=(p.y-PROJ.OY+WALL*PROJ.ZH)/PROJ.TH;
      light.x=Math.round(clamp((u+v)/2,1,F-1)*10)/10;
      light.y=Math.round(clamp((v-u)/2,1,F-1)*10)/10;
    }else if(kind==="door"){
      const e1=Math.min(RANGE.left[1],LAY.Wend-DOOR_W),e2=Math.min(RANGE.frontLeft[1],F-DOOR_W-0.3);
      const A=nearestOnSeg(p,P(0,RANGE.left[0]),P(0,e1));
      const B=nearestOnSeg(p,P(RANGE.frontLeft[0],F),P(e2,F));
      if(A.d<=B.d+18){door.side="left";door.pos=RANGE.left[0]+A.t*(e1-RANGE.left[0]);}
      else{door.side="frontLeft";door.pos=RANGE.frontLeft[0]+B.t*(e2-RANGE.frontLeft[0]);}
      door.pos=Math.round(door.pos*10)/10;
    }else{
      const e1=Math.min(RANGE.right[1],LAY.Wend-WIN_W),e2=Math.min(RANGE.frontRight[1],F-WIN_W-0.3);
      const A=nearestOnSeg(p,P(RANGE.right[0],0),P(e1,0));
      const B=nearestOnSeg(p,P(F,RANGE.frontRight[0]),P(F,e2));
      if(A.d<=B.d+18){win.side="right";win.pos=RANGE.right[0]+A.t*(e1-RANGE.right[0]);}
      else{win.side="frontRight";win.pos=RANGE.frontRight[0]+B.t*(e2-RANGE.frontRight[0]);}
      win.pos=Math.round(win.pos*10)/10;
    }
    render();
  };
  window.addEventListener("pointermove",mv);
  window.addEventListener("pointerup",()=>window.removeEventListener("pointermove",mv),{once:true});
}
function startSlider(id,e){
  const s=SLIDERS.find(x=>x.id===id),x0=SET.x+150,x1=SET.x+SET.w-76;
  const mv=ev=>{
    const p=toSvg(ev),f=clamp((p.x-x0)/(x1-x0),0,1);
    let v=s.min+f*(s.max-s.min);v=Math.round(v/s.step)*s.step;
    params[id]=Math.round(v*1000)/1000;render();
  };
  mv(e);
  window.addEventListener("pointermove",mv);
  window.addEventListener("pointerup",()=>window.removeEventListener("pointermove",mv),{once:true});
}
function cellGesture(id,e){
  const sx=e.clientX,sy=e.clientY;let done=false;
  const pages=Math.max(1,Math.ceil(listSource().length/3));
  const cleanup=()=>{window.removeEventListener("pointermove",mv);window.removeEventListener("pointerup",up);};
  const mv=ev=>{
    if(done) return;
    const dx=ev.clientX-sx,dy=ev.clientY-sy;
    if(dy<-16&&Math.abs(dy)>Math.abs(dx)){done=true;cleanup();
      startDrag(mode==="inventory"?"item":"supply",id,null,ev);}
    else if(Math.abs(dx)>22){done=true;cleanup();
      const d=dx<0?1:-1;
      if(mode==="inventory") pageInv=clamp(pageInv+d,0,pages-1);else pageSup=clamp(pageSup+d,0,pages-1);
      render();}
  };
  const up=()=>cleanup();
  window.addEventListener("pointermove",mv);
  window.addEventListener("pointerup",up,{once:true});
}
function saveLayout(){
  applied={...params};applyProj(applied);STATIC=generateLayout(applied);
  const ids=new Set(STATIC.map(z=>z.id));
  Object.keys(place).forEach(k=>{
    if(k==="CEIL"||k==="ON_SOFA"||k.startsWith("W")||k.startsWith("LF")||k==="OVERDOOR") return;
    if(!ids.has(k)) delete place[k];
  });
  const F=applied.floor;
  light.x=clamp(light.x,1,F-1);light.y=clamp(light.y,1,F-1);
  door.pos=clamp(door.pos,...(door.side==="left"?RANGE.left:RANGE.frontLeft));
  win.pos=clamp(win.pos,...(win.side==="right"?RANGE.right:RANGE.frontRight));
  door.pos=Math.min(door.pos,F-DOOR_W-0.3);win.pos=Math.min(win.pos,F-WIN_W-0.3);
  cat.x=clamp(cat.x,0.6,F-0.6);cat.y=clamp(cat.y,0.6,F-0.6);cat.path=[];
  render();
}
const canvas=document.getElementById("canvas");
function toggleFull(){
  if(!document.fullscreenElement) canvas.requestFullscreen&&canvas.requestFullscreen();
  else document.exitFullscreen();
}
document.addEventListener("fullscreenchange",render);

svg.addEventListener("pointerdown",e=>{
  const sl=e.target.closest("[data-slider]");
  if(sl){e.preventDefault();startSlider(sl.dataset.slider,e);return;}
  const pg=e.target.closest("[data-page]");
  if(pg){e.preventDefault();const d=+pg.dataset.page,pages=Math.max(1,Math.ceil(listSource().length/3));
    if(mode==="inventory") pageInv=clamp(pageInv+d,0,pages-1);else pageSup=clamp(pageSup+d,0,pages-1);
    render();return;}
  const b=e.target.closest("[data-btn]");
  if(b){
    e.preventDefault();const id=b.dataset.btn;
    if(id==="close") mode="view";
    else if(id==="settings"||id==="inventory"||id==="supplies"){mode=(mode===id?"view":id);pageInv=0;pageSup=0;}
    else if(id==="tg-cat"){catOn=!catOn;if(catOn){cat.path=[];setSt("idle",1,idleCycle);}}
    else if(id==="tg-labels") showLabels=!showLabels;
    else if(id==="tg-empty") showEmpty=!showEmpty;
    else if(id==="tg-walk") showWalk=!showWalk;
    else if(id==="reset"){door={side:"left",pos:3.3};win={side:"right",pos:2.6};
      light={x:2.7,y:2.7};place={...DEFAULT};mood=62;cat.x=3;cat.y=3;cat.path=[];}
    else if(id==="clear"){place={};mode="inventory";pageInv=0;}
    else if(id==="save"){saveLayout();return;}
    else if(id==="expand"){toggleFull();return;}
    render();return;
  }
  const c=e.target.closest("[data-cell]");
  if(c){e.preventDefault();cellGesture(c.dataset.cell,e);return;}
  const m=e.target.closest("[data-move]");
  if(m&&m.dataset.move==="cat"){e.preventDefault();startMove("cat",e);return;}
  if(m&&mode==="inventory"){
    const it=e.target.closest("[data-item]");
    if(!(m.dataset.move==="light"&&it)){e.preventDefault();startMove(m.dataset.move,e);return;}
  }
  const g=e.target.closest("[data-item]");
  if(!g||mode!=="inventory") return;
  e.preventDefault();
  const iid=g.dataset.item;
  const zid=place.CEIL===iid?"CEIL":Object.keys(place).find(k=>place[k]===iid);
  startDrag("item",iid,zid,e);
});

const dLeft=document.getElementById("dLeft"),dFront=document.getElementById("dFront"),
      wRight=document.getElementById("wRight"),wFront=document.getElementById("wFront");
function syncControls(){
  dLeft.setAttribute("aria-pressed",door.side==="left");
  dFront.setAttribute("aria-pressed",door.side==="frontLeft");
  wRight.setAttribute("aria-pressed",win.side==="right");
  wFront.setAttribute("aria-pressed",win.side==="frontRight");
  [dLeft,dFront,wRight,wFront].forEach(x=>x.disabled=mode!=="inventory");
}
dLeft.onclick=()=>{door.side="left";door.pos=clamp(door.pos,...RANGE.left);render();};
dFront.onclick=()=>{door.side="frontLeft";door.pos=clamp(door.pos,...RANGE.frontLeft);render();};
wRight.onclick=()=>{win.side="right";win.pos=clamp(win.pos,...RANGE.right);render();};
wFront.onclick=()=>{win.side="frontRight";win.pos=clamp(win.pos,...RANGE.frontRight);render();};
document.getElementById("btnCopy").onclick=async()=>{
  const ta=document.getElementById("out");
  try{await navigator.clipboard.writeText(ta.value);}catch{ta.select();document.execCommand("copy");}
};

/* ================= цикл ================= */
let last=performance.now(),moodShown=-1,catAcc=0,lastKey="";
function loop(now){
  const dt=Math.min(0.05,(now-last)/1000);last=now;
  tick(dt);
  catAcc+=dt;
  if(catAcc>0.033){
    catAcc=0;
    const key=[cat.st,Math.round(cat.x*40),Math.round(cat.y*40),Math.round(cat.ph*6),
               cat.dir,cat.bubble||""].join("|");
    if(key!==lastKey&&!drag){lastKey=key;refreshCat();}
  }
  if(Math.round(mood)!==moodShown){moodShown=Math.round(mood);refreshHUD();}
  requestAnimationFrame(loop);
}
applyProj(applied);STATIC=generateLayout(applied);render();
setSt("idle",1.5,idleCycle);
requestAnimationFrame(loop);
