// ═══ Firebase SDK — inicialización ═══
var _db = null;
try {
  if (typeof firebase !== 'undefined') {
    var FIREBASE_CONFIG = {
      apiKey: "AIzaSyD4YxIPAoaPbyoA62ERRLwkF-0WT09HfqA",
      authDomain: "testap-6035f.firebaseapp.com",
      projectId: "testap-6035f",
      storageBucket: "testap-6035f.firebasestorage.app",
      messagingSenderId: "407524776135",
      appId: "1:407524776135:web:987f8679ef8f945bcb46e2",
      measurementId: "G-LPFMK5NVXM"
    };
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    _db = firebase.firestore();
    console.log("✅ Firebase listo");
  }
} catch(e) { console.warn("⚠️ Firebase no inicializado:", e.message); }

const UVT=52374,UMBRAL_PAT=72000*UVT,EXCL_VIV=12000*UVT,INFL=.0517,T_AHORRO=.015,T_CDT=.08,T_FONDO=.08,DEVAL=.04;
/* Art 296-3 ET — Impuesto al patrimonio personas naturales (régimen permanente 2023-2026)
   Base = patrimonio líquido (activos - deudas) - exclusión vivienda (12,000 UVT)
   Tramos: 0-72k UVT: 0% | 72k-122k UVT: 0.5% | 122k+ UVT: 1.0% (1.5% temporal hasta 2026 para >239k) */
function calcImpPatV2(patBruto,deuda){
 var pl=Math.max(0,patBruto-deuda);
 if(pl<UMBRAL_PAT)return 0;
 var base=Math.max(0,pl-EXCL_VIV);
 var t1=72000,t2=122000;
 var bUVT=base/UVT;
 if(bUVT<=t1)return 0;
 var imp=0;
 var r1=Math.min(bUVT,t2)-t1;
 if(r1>0)imp+=r1*0.005;
 if(bUVT>t2){imp+=(bUVT-t2)*0.01}
 return Math.round(imp*UVT);
}
/* Art. 241 ET — Tabla renta personas naturales residentes (vigente 2023-2026)
   Tramos verificados contra estatuto.co */
function calcRenta(r){var u=r/UVT,imp=0,t=[{d:0,h:1090,f:0},{d:1090,h:1700,f:.19},{d:1700,h:4100,f:.28},{d:4100,h:8670,f:.33},{d:8670,h:18970,f:.35},{d:18970,h:31000,f:.37},{d:31000,h:1/0,f:.39}];for(var i=0;i<t.length;i++){var x=t[i];if(u>x.d)imp+=(Math.min(u,x.h)-x.d)*x.f*UVT}return imp}
/* Art. 242 ET — Dividendos gravados (que ya pagaron impuesto corporativo)
   0-300 UVT: 0%, 300-1090 UVT: 10%, 1090+: 10% (simplificado, la sub-cédula tiene
   tarifa combinada pero para estimación usamos 10% sobre el total >300 UVT) */
function calcImpDiv(divAnual){var u=divAnual/UVT;if(u<=300)return 0;return Math.round((divAnual-300*UVT)*0.10)}

var ALL_Q=[
{id:"n1",sec:"01",secN:"TUS NÚMEROS",prof:"both",type:"slider",q:"¿Cuál es tu patrimonio total estimado? Incluye inmuebles, empresa, inversiones, vehículos — todo.",slider:{min:500,max:5000,step:100,value:1500,unit:"M",prefix:"$",suffix:" millones COP"},ctx:function(v){var u=Math.round(UMBRAL_PAT/1e6);return v*1e6>=UMBRAL_PAT?'⚠️ <strong>Supera $'+u.toLocaleString('es-CO')+'M.</strong> Obligado a impuesto al patrimonio en 2026.':'Por debajo del umbral ($'+u.toLocaleString('es-CO')+'M).'}},
{id:"n2",sec:"01",secN:"TUS NÚMEROS",prof:"both",type:"slider",q:"¿Cuánto gasta tu familia al mes? Incluye vivienda, colegios, seguros, alimentación, transporte, todo.",slider:{min:5,max:50,step:1,value:15,unit:"M",prefix:"$",suffix:" millones COP / mes"},ctx:function(v){return'<strong>$'+(v*12).toLocaleString('es-CO')+'M al año</strong> en gastos fijos.'}},
{id:"n3e",sec:"01",secN:"TUS NÚMEROS",prof:"empresario",type:"slider",q:"¿Cuánto recibes al mes entre salario, honorarios, dividendos y retiros de tu empresa?",slider:{min:5,max:80,step:1,value:25,unit:"M",prefix:"$",suffix:" millones COP / mes"},ctx:function(v,s){var g=s&&s.n2?s.n2:15;if(v<=g)return'⚠️ <strong>Ingresos no superan gastos.</strong>';var a=Math.round(((v-g)/v)*100);return'Tasa de ahorro: <strong>'+a+'%</strong>.'+(a<=10?' Tu patrimonio no crece.':'')}},
{id:"n3p",sec:"01",secN:"TUS NÚMEROS",prof:"profesional",type:"slider",q:"¿Cuánto recibes al mes entre salario, honorarios, bonificaciones y otros ingresos?",slider:{min:5,max:80,step:1,value:25,unit:"M",prefix:"$",suffix:" millones COP / mes"},ctx:function(v,s){var g=s&&s.n2?s.n2:15;if(v<=g)return'⚠️ <strong>Ingresos no superan gastos.</strong>';var a=Math.round(((v-g)/v)*100);return'Tasa de ahorro: <strong>'+a+'%</strong>.'+(a<=10?' Tu patrimonio no crece.':'')}},
{id:"np",sec:"01",secN:"TUS NÚMEROS",prof:"both",type:"slider",q:"¿Cuánto recibes al mes en ingresos pasivos? Arriendos, dividendos, intereses, regalías.",slider:{min:0,max:30,step:1,value:0,unit:"M",prefix:"$",suffix:" millones COP / mes"},ctx:function(v,s){var g=s&&s.n2?s.n2:15;if(!v)return'Sin ingresos pasivos — dependes 100% de tu ingreso activo.';var p=Math.round((v/g)*100);return p>=100?'✅ <strong>Cubren todos tus gastos.</strong>':'Cubren <strong>'+p+'%</strong> de tus gastos.'}},
// ── CAMBIO 1: step fijo de 10 ──
{id:"nl",sec:"01",secN:"TU PATRIMONIO",prof:"both",type:"slider",q:"¿Cuánto tienes en activos líquidos? Cuentas de ahorro, CDTs, fondos de inversión, acciones.",slider:function(s){var p=s&&s.n1?s.n1:1500;return{min:0,max:p,step:10,value:Math.round(p*.2),unit:"M",prefix:"$",suffix:" millones COP"}},ctx:function(v,s){var g=s&&s.n2?s.n2:15;var m=g>0?Math.round(v/g):0;return m<3?'⚠️ <strong>Solo '+m+' meses en liquidez.</strong>':m<9?'<strong>'+m+' meses</strong> de gastos. Debajo de lo ideal.':'✅ <strong>'+m+' meses</strong> cubiertos.'}},
{id:"n4",sec:"01",secN:"TU PATRIMONIO",prof:"both",type:"slider",q:"De tus activos líquidos, ¿cuánto está en cuentas de ahorro, CDTs o instrumentos que rindan menos del 5% anual?",slider:function(s){var l=s&&s.nl?s.nl:300;return{min:0,max:l,step:Math.max(5,Math.round(l/100)*5),value:Math.round(l*.5),unit:"M",prefix:"$",suffix:" millones en bajo rendimiento"}},ctx:function(v){var er=Math.round(v*(INFL-T_AHORRO));return v>0?'<strong>$'+v.toLocaleString('es-CO')+'M</strong> rindiendo bajo inflación. Erosión: ~<strong>$'+er.toLocaleString('es-CO')+'M/año</strong>.':'Sin patrimonio en bajo rendimiento.'}},
{id:"nn",sec:"01",secN:"TU PATRIMONIO",prof:"both",type:"slider",q:"¿Cuánto tienes en activos NO líquidos? Inmuebles, vehículos, participación en empresa, arte.",slider:function(s){var p=s&&s.n1?s.n1:1500;return{min:0,max:p,step:Math.max(10,Math.round(p/100)*10),value:Math.round(p*.7),unit:"M",prefix:"$",suffix:" millones COP"}},ctx:function(v,s){var l=s&&s.nl?s.nl:300;var t=l+v;var p=t>0?Math.round((v/t)*100):0;return p>85?'🔴 <strong>'+p+'% ilíquido.</strong> Alta concentración.':p>70?'🟠 <strong>'+p+'% ilíquido.</strong> Moderada-alta.':'<strong>'+p+'%</strong> ilíquido. Distribución razonable.'}},
{id:"n5",sec:"01",secN:"TU PATRIMONIO",prof:"both",type:"slider",q:"¿Qué porcentaje de tu patrimonio está en pesos colombianos?",slider:{min:50,max:100,step:10,value:90,unit:"%",prefix:"",suffix:"% en pesos colombianos"},ctx:function(v){return v>=80?'⚠️ <strong>Más del 80% en COP.</strong> Devaluación promedio: ~'+(DEVAL*100).toFixed(1)+'%/año.':'Concentración '+(v>=60?'moderada':'saludable')+' en COP.'}},
{id:"nd",sec:"01",secN:"TU PATRIMONIO",prof:"both",type:"slider",q:"¿Cuánto debes en total? Hipoteca, créditos, tarjetas, libre inversión.",slider:function(s){var l=s&&s.nl?s.nl:300;var n=s&&s.nn?s.nn:1200;var t=l+n;return{min:0,max:Math.max(t,500),step:Math.max(5,Math.round(t/100)*5),value:Math.round(t*.15),unit:"M",prefix:"$",suffix:" millones COP"}},ctx:function(v,s){if(!v)return'✅ <strong>Sin deuda.</strong>';var l=s&&s.nl?s.nl:300;var n=s&&s.nn?s.nn:1200;var r=Math.round((v/(l+n))*100);return r>50?'🔴 <strong>Deuda = '+r+'% de activos.</strong>':'Deuda = <strong>'+r+'%</strong> de activos.'}},
{id:"ndc",sec:"01",secN:"TU PATRIMONIO",prof:"both",type:"slider",q:"¿Cuánto de esa deuda es de consumo? Tarjetas, libre inversión, vehículo — deuda sin retorno.",slider:function(s){var d=s&&s.nd?s.nd:100;return{min:0,max:Math.max(d,10),step:Math.max(1,Math.round(d/50)),value:Math.round(d*.3),unit:"M",prefix:"$",suffix:" millones en deuda de consumo"}},ctx:function(v,s){if(!v)return'Toda tu deuda es estructural. Excelente.';var d=s&&s.nd?s.nd:100;var p=d>0?Math.round((v/d)*100):0;return p>40?'🔴 <strong>'+p+'% de tu deuda es consumo.</strong> Prioriza eliminarla.':'<strong>'+p+'%</strong> de tu deuda es consumo.'}},
{id:"f1e",sec:"02",secN:"ESTRUCTURA FISCAL",prof:"empresario",type:"choice",q:"¿Cómo sacas el dinero de tu empresa para tu uso personal?",opts:[{pts:3,text:"Esquema optimizado: mezcla salario + dividendos con asesoría fiscal"},{pts:2,text:"Principalmente como salario o honorarios"},{pts:1,text:"Retiro según necesito, sin estrategia"},{pts:0,text:"No sé exactamente — a veces salario, a veces retiro"}],vuln:{threshold:1,icon:"⚠️",color:"#C0392B",title:"Sin estrategia de retiro de utilidades"}},
{id:"f1p",sec:"02",secN:"ESTRUCTURA FISCAL",prof:"profesional",type:"choice",q:"¿Alguien ha revisado si estás pagando más impuestos de lo necesario?",opts:[{pts:3,text:"Sí, asesoría fiscal activa cada año"},{pts:2,text:"Tengo contador pero nunca evaluamos optimización"},{pts:1,text:"No tengo claridad"},{pts:0,text:"Pago lo que dice el contador"}],vuln:{threshold:1,icon:"⚠️",color:"#C0392B",title:"Sin optimización fiscal activa"}},
{id:"f2e",sec:"02",secN:"ESTRUCTURA FISCAL",prof:"empresario",type:"choice",q:"¿Tienes utilidades acumuladas sin repartir en tu empresa?",opts:[{pts:3,text:"Repartimos estratégicamente cada año"},{pts:2,text:"Algo acumulado, repartimos mayoría"},{pts:1,text:"Sí, de varios años"},{pts:0,text:"Nunca repartimos formalmente"}],vuln:{threshold:1,icon:"⚠️",color:"#C0392B",title:"Utilidades acumuladas sin estrategia"}},
{id:"inv",sec:"02",secN:"ESTRUCTURA FISCAL",prof:"both",type:"choice",q:"¿Dónde tienes la mayor parte de tus inversiones financieras hoy?",opts:[{pts:3,text:"Portafolio diversificado: fondos internacionales, ETFs, renta fija + variable"},{pts:2,text:"Fondos de inversión locales o pensión voluntaria"},{pts:1,text:"Principalmente CDTs o cuentas remuneradas"},{pts:0,text:"No tengo inversiones — solo inmuebles o cuentas bancarias"}],vuln:{threshold:1,icon:"🔺",color:"#D4821A",title:"Sin portafolio diversificado"}},
{id:"f3e",sec:"02",secN:"ESTRUCTURA FISCAL",prof:"empresario",type:"slider",q:"¿Qué porcentaje de tu patrimonio total representa tu empresa?",slider:{min:20,max:100,step:5,value:65,unit:"%",prefix:"",suffix:"% es tu empresa"},ctx:function(v,s){var p=s&&s.n1?s.n1:1500;var m=Math.round(p*v/100);return v>=70?'⚠️ <strong>$'+m.toLocaleString('es-CO')+'M atados a tu negocio.</strong> Concentración > 70%.':'<strong>$'+m.toLocaleString('es-CO')+'M</strong> en tu empresa.'}},
{id:"f3p",sec:"02",secN:"ESTRUCTURA FISCAL",prof:"profesional",type:"slider",q:"¿Qué porcentaje de tus ingresos depende de una sola fuente?",slider:{min:20,max:100,step:5,value:80,unit:"%",prefix:"",suffix:"% de una sola fuente"},ctx:function(v){return v>=80?'⚠️ <strong>Más del 80% de una sola fuente.</strong>':'Dependencia '+(v>=50?'moderada.':'baja.')}},
{id:"c2e",sec:"03",secN:"CRECIMIENTO",prof:"empresario",type:"choice",q:"¿Tus flujos personales están separados de los de tu empresa?",opts:[{pts:3,text:"Sí, cuentas separadas y esquema claro"},{pts:2,text:"Parcialmente"},{pts:1,text:"Con frecuencia mezclo los flujos"},{pts:0,text:"No existe separación"}],vuln:{threshold:1,icon:"⚠️",color:"#C0392B",title:"Flujos personales y empresariales mezclados"}},
{id:"strat",sec:"03",secN:"CRECIMIENTO",prof:"both",type:"choice",q:"¿Tienes una estrategia de inversión definida con horizonte y asignación de activos?",opts:[{pts:3,text:"Sí, política escrita con metas y plazos"},{pts:2,text:"Invierto con criterio pero sin formalizar"},{pts:1,text:"Invierto cuando aparecen oportunidades"},{pts:0,text:"No tengo estrategia — mi dinero está quieto"}],vuln:{threshold:1,icon:"🔵",color:"#2471A3",title:"Sin estrategia de inversión"}}
];

var RESULTS={empresario:[{min:0,max:3,label:"Patrimonio en Riesgo Crítico",color:"#C0392B",gauge:"#E74C3C",desc:"Tu patrimonio y tu empresa están expuestos en múltiples frentes."},{min:4,max:7,label:"Estructura Deficiente",color:"#D4821A",gauge:"#E67E22",desc:"Tienes piezas pero hay huecos costosos que se acumulan."},{min:8,max:11,label:"En Construcción",color:"#2471A3",gauge:"#3498DB",desc:"Vas por buen camino pero hay oportunidades ocultas."},{min:12,max:15,label:"Arquitectura Sólida",color:"#1E8449",gauge:"#27AE60",desc:"Base bien construida. La optimización fina revela $15M–$40M anuales en mejoras."}],profesional:[{min:0,max:2,label:"Patrimonio en Riesgo Crítico",color:"#C0392B",gauge:"#E74C3C",desc:"Tu patrimonio depende de tu capacidad de trabajar."},{min:3,max:5,label:"Estructura Deficiente",color:"#D4821A",gauge:"#E67E22",desc:"Estructura frágil con erosión silenciosa."},{min:6,max:7,label:"En Construcción",color:"#2471A3",gauge:"#3498DB",desc:"Buen camino con oportunidades."},{min:8,max:9,label:"Arquitectura Sólida",color:"#1E8449",gauge:"#27AE60",desc:"Base bien construida."}]};

var selectedProfile=null,questionSequence=[],current=0,answers={},sliderValues={};
function buildSeq(p){var o=p==='empresario'?["n1","n2","n3e","np","nl","n4","nn","n5","nd","ndc","f1e","f2e","inv","strat","f3e","c2e"]:["n1","n2","n3p","np","nl","n4","nn","n5","nd","ndc","f1p","inv","strat","f3p"];return o.map(function(id){return ALL_Q.find(function(q){return q.id===id})}).filter(Boolean)}
function showProfile(){document.getElementById('start-screen').style.display='none';document.getElementById('profile-screen').style.display='block'}
function backToStart(){document.getElementById('profile-screen').style.display='none';document.getElementById('start-screen').style.display='block'}
function selectProfile(p){selectedProfile=p;document.getElementById('card-empresario').classList.toggle('selected',p==='empresario');document.getElementById('card-profesional').classList.toggle('selected',p==='profesional');document.getElementById('btn-profile-next').disabled=false}
function startWithProfile(){if(!selectedProfile)return;questionSequence=buildSeq(selectedProfile);current=0;answers={};sliderValues={};document.getElementById('profile-screen').style.display='none';document.getElementById('question-screen').style.display='block';renderQ()}
function renderQ(){var q=questionSequence[current],tot=questionSequence.length,card=document.getElementById('question-card'),sl=document.getElementById('section-label');card.classList.remove('visible');sl.classList.remove('visible');document.getElementById('section-num').textContent=q.sec;document.getElementById('section-name').textContent=q.secN;document.getElementById('q-number').textContent='Pregunta '+String(current+1).padStart(2,'0')+' de '+tot;document.getElementById('q-text').textContent=q.q;document.getElementById('profile-badge-wrap').innerHTML=q.prof!=='both'?'<div class="profile-badge">'+(selectedProfile==='empresario'?'Para empresarios':'Para profesionales')+'</div>':'';document.getElementById('progress-fill').style.width=((current+1)/tot*100)+'%';document.getElementById('progress-count').textContent=(current+1)+' / '+tot;var area=document.getElementById('answer-area');if(q.type==='slider'){var s=typeof q.slider==='function'?q.slider(sliderValues):q.slider;var sv=sliderValues[q.id]!==undefined?Math.min(Math.max(sliderValues[q.id],s.min),s.max):s.value;var ctx=q.ctx?q.ctx(sv,sliderValues):'';area.innerHTML='<div class="slider-wrap"><div class="slider-display"><div class="slider-value-big" id="sv-d">'+s.prefix+sv.toLocaleString('es-CO')+s.unit+'</div><div class="slider-value-unit">'+s.suffix+'</div></div><input type="range" id="sv-i" min="'+s.min+'" max="'+s.max+'" step="'+s.step+'" value="'+sv+'"><div class="slider-labels"><span>'+s.prefix+s.min.toLocaleString('es-CO')+s.unit+'</span><span>'+s.prefix+s.max.toLocaleString('es-CO')+s.unit+'</span></div><div class="slider-context" id="sv-c">'+ctx+'</div></div>';var inp=document.getElementById('sv-i');inp.addEventListener('input',function(){var v=parseInt(this.value);sliderValues[q.id]=v;document.getElementById('sv-d').textContent=s.prefix+v.toLocaleString('es-CO')+s.unit;if(q.ctx)document.getElementById('sv-c').innerHTML=q.ctx(v,sliderValues);sFill(this)});sliderValues[q.id]=sv;sFill(inp);document.getElementById('btn-next').disabled=false;document.getElementById('skip-hint').textContent=''}else{var h='<div class="options">';q.opts.forEach(function(o,i){h+='<div class="option'+(answers[q.id]===i?' selected':'')+'" onclick="selOpt('+i+')"><div class="option-radio"></div><span class="option-text">'+o.text+'</span></div>'});h+='</div>';area.innerHTML=h;document.getElementById('btn-next').disabled=answers[q.id]===undefined;document.getElementById('skip-hint').textContent=answers[q.id]!==undefined?'':'Selecciona una opción'}document.getElementById('btn-back').style.visibility=current===0?'hidden':'visible';document.getElementById('btn-next').textContent=current===tot-1?'Ver mi diagnóstico →':'Siguiente →';requestAnimationFrame(function(){requestAnimationFrame(function(){sl.classList.add('visible');card.classList.add('visible')})})}
function sFill(s){var p=((s.value-s.min)/(s.max-s.min))*100;s.style.background='linear-gradient(to right,var(--gold) 0%,var(--gold) '+p+'%,rgba(255,255,255,.1) '+p+'%,rgba(255,255,255,.1) 100%)'}
function selOpt(i){answers[questionSequence[current].id]=i;document.querySelectorAll('.option').forEach(function(el,idx){el.classList.toggle('selected',idx===i)});document.getElementById('btn-next').disabled=false;document.getElementById('skip-hint').textContent=''}
function goNext(){var q=questionSequence[current];if(q.type==='choice'&&answers[q.id]===undefined)return;if(current<questionSequence.length-1){current++;renderQ()}else showCap()}
function goBack(){if(current>0){current--;renderQ()}}
function showCap(){document.getElementById('question-screen').style.display='none';document.getElementById('capture-screen').style.display='block';window.scrollTo({top:0,behavior:'smooth'})}
async function submitCapture(){
 var nom=document.getElementById('cap-nombre').value.trim();
 var em=document.getElementById('cap-email').value.trim();
 ['cap-nombre','cap-email'].forEach(function(id){document.getElementById(id).classList.remove('error')});
 if(!nom){document.getElementById('cap-nombre').classList.add('error');return}
 if(!em||em.indexOf('@')<0){document.getElementById('cap-email').classList.add('error');return}
 document.getElementById('btn-capture').disabled=true;
 document.getElementById('capture-status').classList.add('visible');

 // Calcular score
 var sc=0,sS={"02":0,"03":0},sM={"02":0,"03":0};
 questionSequence.forEach(function(q){
  if(q.type==='slider')return;
  var a=answers[q.id];
  if(a!==undefined){sc+=q.opts[a].pts;if(sS[q.sec]!==undefined)sS[q.sec]+=q.opts[a].pts}
  if(sM[q.sec]!==undefined)sM[q.sec]+=3
 });
 var mx=questionSequence.filter(function(q){return q.type==='choice'}).length*3;
 var niv=(RESULTS[selectedProfile]||RESULTS.empresario).find(function(r){return sc>=r.min&&sc<=r.max});

 // Vulnerabilidades
 var vul=[];
 questionSequence.forEach(function(q){
  if(q.type==='slider'||!q.vuln)return;
  var a=answers[q.id];
  if(a!==undefined&&q.opts[a].pts<=q.vuln.threshold)vul.push(q.vuln.title)
 });
 var pasM=sliderValues.np||0,gasM=sliderValues.n2||15;
 if(gasM>0&&pasM<gasM*.2)vul.push('Alta dependencia del ingreso activo');

 // Calcular costos
 var C=calcC();

 // Meses de autonomía (para email)
 var mesesAut=gasM>0?Math.round((sliderValues.nl||0)/gasM*10)/10:0;

 // ── Lead object — alineado con index.js (Cloud Functions) ──
 var lead={
  nombre: nom,
  email: em.toLowerCase(),
  whatsapp: document.getElementById('cap-whatsapp').value.trim()||null,
  perfil: selectedProfile,
  score_total: sc,
  score_max: mx,
  nivel: niv?niv.label:'',
  scores_por_capa: {
   estructura_fiscal: sS["02"]||0,
   crecimiento: sS["03"]||0
  },
  numeros_reales: {
   patrimonio_m:     sliderValues.n1||null,
   gastos_mes_m:     sliderValues.n2||null,
   ingreso_mes_m:    sliderValues.n3e||sliderValues.n3p||null,
   liquidos_m:       sliderValues.nl||null,
   no_liquidos_m:    sliderValues.nn||null,
   deuda_total_m:    sliderValues.nd||null,
   deuda_consumo_m:  sliderValues.ndc||null,
   ingreso_pasivo_m: sliderValues.np||null,
   pct_improductivo: sliderValues.n4||null,
   pct_cop:          sliderValues.n5||null,
   pct_empresa:      sliderValues.f3e||null,
   pct_fuente_unica: sliderValues.f3p||null
  },
  costos_calculados: {
   total_anual:            C.totalAnual||0,
   erosion_real:           C.erosion||0,
   costo_oportunidad:      C.oport||0,
   sobrecarga_fiscal:      C.fiscal||0,
   impuesto_patrimonio:    C.impPat||0,
   meses_autonomia:        mesesAut,
   exposicion_devaluacion: C.expDeval||0,
   liquidez:               C.liqBruta||0,
   numero_magico:          C.nMag||0,
   patrimonio_en_riesgo:   C.patRiesgo||0
  },
  indicadores: {
   independencia_financiera: {
    avance_pct:       C.avIF||0,
    numero_magico:    C.nMag||0,
    ingreso_pasivo_mes: C.retSost||0,
    gap_mensual:      C.gapIF||0,
    portafolio_productivo: C.pp||0
   },
   fondo_emergencia: {
    meses_cubiertos:  C.mCub||0,
    meta_meses:       C.metaM||0,
    fondo_ideal:      C.fondoId||0,
    gap:              C.gapFE||0,
    liquidez_actual:  C.liqBruta||0
   },
   concentracion: {
    pct_liquido:      C.pLiq||0,
    pct_iliquido:     C.pNLiq||0,
    monto_liquido:    C.monLiq||0,
    monto_iliquido:   C.monNLiq||0
   },
   deuda: {
    deuda_total:      C.deuTot||0,
    deuda_consumo:    C.deuCon||0,
    ratio_deuda_pct:  C.rDeu||0,
    pct_consumo:      C.pDC||0,
    patrimonio_neto:  C.pNeto||0
   }
  },
  vulnerabilidades_detectadas: vul,
  origen: new URLSearchParams(window.location.search).get('origen')||'directo',
  agendo_calendly: false,
  estado: 'nuevo',
  timestamp: _db?firebase.firestore.FieldValue.serverTimestamp():new Date().toISOString()
 };

 // ── Guardar en Firestore ──
 try {
  if(_db){
   var docRef=await _db.collection('leads_test').add(lead);
   console.log('✅ Lead guardado en Firestore. ID:', docRef.id);
  } else {
   var s=JSON.parse(localStorage.getItem('leads_test_v4')||'[]');
   lead.timestamp=new Date().toISOString();
   s.push(lead);
   localStorage.setItem('leads_test_v4',JSON.stringify(s));
   console.warn('⚠️ Firebase sin configurar — lead en localStorage');
  }
 } catch(e){
  console.error('❌ Error guardando lead:', e.message);
  try {
   var s2=JSON.parse(localStorage.getItem('leads_test_v4')||'[]');
   lead.timestamp=new Date().toISOString();
   s2.push(lead);
   localStorage.setItem('leads_test_v4',JSON.stringify(s2));
  } catch(e2){}
 }

 document.getElementById('capture-status').classList.remove('visible');
 document.getElementById('capture-screen').style.display='none';
 showRes(nom);
}

function calcSc(){var t=0;questionSequence.forEach(function(q){if(q.type==='choice'&&answers[q.id]!==undefined)t+=q.opts[answers[q.id]].pts});return t}
function aPts(id){var q=questionSequence.find(function(qq){return qq.id===id});if(q&&q.type==='choice'&&answers[id]!==undefined)return q.opts[answers[id]].pts;return-1}

function calcC(){
 var patM=sliderValues.n1||1500,pat=patM*1e6,gasM=sliderValues.n2||15,gasMes=gasM*1e6,gasAn=gasMes*12;
 var ingM=sliderValues.n3e||sliderValues.n3p||25,ingMes=ingM*1e6,ingAn=ingMes*12;
 var improdM=sliderValues.n4||0,improd=improdM*1e6;
 var pCOP=(sliderValues.n5||90)/100,pEmp=selectedProfile==='empresario'?(sliderValues.f3e||65)/100:0;
 var liqM=sliderValues.nl||Math.round(patM*.2),liq=liqM*1e6;
 var nlM=sliderValues.nn||Math.round(patM*.7),nl=nlM*1e6;
 var pasM=sliderValues.np||0,pas=pasM*1e6;
 var dM=sliderValues.nd||0,deu=dM*1e6,dcM=sliderValues.ndc||0,dc=dcM*1e6;
 var tAct=liq+nl,pNeto=tAct-deu;
 var c={_pat:pat,_gasMes:gasMes,_gasAn:gasAn,_ingAn:ingAn,_ingMes:ingMes,_pCOP:pCOP,_pEmp:pEmp,_pas:pas};

 // ── Erosión: patrimonio improductivo pierde valor real ──
 var dE=INFL-T_AHORRO;c.erosion=Math.round(improd*dE);c.erosionMes=Math.round(c.erosion/12);c.improdM=Math.round(improd);

 // ── Costo de oportunidad: diferencial vs portafolio moderado (8% neto) ──
 // Solo sobre la parte improductiva que podría reasignarse (excluimos 3 meses de gastos como colchón)
 var colchon=Math.min(improd,gasMes*3);
 var improdReasig=Math.max(0,improd-colchon);
 var ip=aPts('inv'),ra=ip>=3?.08:ip>=2?.065:ip>=1?T_CDT:T_AHORRO;
 c.oport=Math.round(improdReasig*Math.max(0,T_FONDO-ra));c.rAct=ra;

 // ── Fiscal empresario: modelo salario + dividendos con Art 242 progresivo ──
 var fp=selectedProfile==='empresario'?aPts('f1e'):aPts('f1p');if(fp<0)fp=3;
 if(selectedProfile==='empresario'){
  // Sin optimizar: todo como renta laboral
  var si=calcRenta(ingAn);
  // Optimizado: 40% salario en renta + 60% dividendos con tabla Art 242
  var salOpt=ingAn*0.4;
  var divOpt=ingAn*0.6;
  var so=calcRenta(salOpt)+calcImpDiv(divOpt);
  var ap=Math.max(0,si-so);
  // Factores de captura según nivel de optimización actual
  c.fiscal=fp<=0?Math.round(ap*.80):fp===1?Math.round(ap*.60):fp===2?Math.round(ap*.30):0;
 } else {
  // Profesional: 25% exento Art 206 num 10, tope 240 UVT/mes = 2880 UVT/año
  var dd=Math.min(ingAn*.25,2880*UVT);
  var si2=calcRenta(ingAn);
  var so2=calcRenta(ingAn-dd);
  var ap2=Math.max(0,si2-so2);
  c.fiscal=fp<=0?Math.round(ap2*.75):fp===1?Math.round(ap2*.50):fp===2?Math.round(ap2*.20):0;
 }

 // ── Impuesto al patrimonio: usa patrimonio líquido (Art 294-3 ET) ──
 c.impPat=calcImpPatV2(pat,deu);

 if(selectedProfile==='empresario')c.patRiesgo=Math.round(pat*pEmp);
 c.totalAnual=c.erosion+c.oport+c.fiscal+c.impPat;

 // ── Independencia Financiera ──
 // Número Mágico: gastos anuales / tasa retiro segura (3.5% para mercados emergentes)
 var tasaRetiro=0.035;
 var nMag=gasAn/tasaRetiro;
 var avIF=gasMes>0?(pas/gasMes)*100:0;
 var retSost=pas;
 var gapIF=Math.max(0,gasMes-pas);
 // Portafolio productivo: solo líquidos invertidos (no inmuebles ni empresa)
 var ppEst=Math.max(0,liq-improd);
 c.nMag=Math.round(nMag);c.pp=Math.round(ppEst);
 c.avIF=Math.round(avIF*10)/10;c.retSost=Math.round(retSost);c.gapIF=Math.round(gapIF);

 // ── Fondo de emergencia ──
 var metaM=selectedProfile==='empresario'?9:6;
 var defMes=Math.max(0,gasMes-pas);
 c.metaM=metaM;c.fondoId=Math.round(defMes*metaM);c.mCub=defMes>0?Math.round(liq/defMes*10)/10:99;c.gapFE=Math.round(Math.max(0,defMes*metaM-liq));c.liqBruta=Math.round(liq);

 // ── Concentración ──
 c.pLiq=tAct>0?Math.round(liq/tAct*1000)/10:0;c.pNLiq=tAct>0?Math.round(nl/tAct*1000)/10:0;c.monLiq=Math.round(liq);c.monNLiq=Math.round(nl);

 // ── Deuda ──
 c.deuTot=Math.round(deu);c.deuCon=Math.round(dc);c.rDeu=tAct>0?Math.round(deu/tAct*1000)/10:0;c.pDC=deu>0?Math.round(dc/deu*1000)/10:0;c.pNeto=Math.round(pNeto);

 // ── Exposición cambiaria: solo sobre activos financieros líquidos en COP ──
 // No sobre inmuebles (se revalorizan en COP con inflación local)
 c.expDeval=Math.round(liq*pCOP*DEVAL);
 return c;
}

function fmt(n){if(n<0)n=0;if(n>=1e9)return'$'+(n/1e9).toFixed(1).replace('.0','')+' mil M';if(n>=1e6)return'$'+Math.round(n/1e6).toLocaleString('es-CO')+'M';if(n>=1e3)return'$'+Math.round(n/1e3).toLocaleString('es-CO')+'K';return'$'+n.toLocaleString('es-CO')}
function pF(n){return(n*100).toFixed(1)+'%'}

function showRes(nombre){
 document.getElementById('result-screen').style.display='block';
 var tot=calcSc(),C=calcC(),mx=questionSequence.filter(function(q){return q.type==='choice'}).length*3;
 document.getElementById('score-max').textContent=mx;
 document.getElementById('result-profile-tag').textContent=(nombre?nombre+' · ':'')+(selectedProfile==='empresario'?'Empresario':'Profesional');
 var cnt=0,sEl=document.getElementById('score-number');
 var iv=setInterval(function(){cnt++;sEl.textContent=cnt;if(cnt>=tot)clearInterval(iv)},tot>0?Math.max(30,900/tot):100);
 var lv=(RESULTS[selectedProfile]||RESULTS.empresario).find(function(r){return tot>=r.min&&tot<=r.max})||(RESULTS[selectedProfile]||RESULTS.empresario)[0];
 setTimeout(function(){document.getElementById('gauge-fill').style.width=(tot/mx*100)+'%'},200);
 document.getElementById('gauge-fill').style.background='linear-gradient(90deg,'+lv.gauge+','+lv.gauge+'BB)';
 document.getElementById('result-diagnosis').textContent=lv.label;
 document.getElementById('result-diagnosis').style.color=lv.color;
 document.getElementById('result-desc').textContent=lv.desc;
 // Total loss
 var comp=[];if(C.erosion>0)comp.push('erosión ('+fmt(C.erosion)+')');if(C.oport>0)comp.push('oportunidad ('+fmt(C.oport)+')');if(C.fiscal>0)comp.push('fiscal ('+fmt(C.fiscal)+')');if(C.impPat>0)comp.push('imp. patrimonio ('+fmt(C.impPat)+')');
 document.getElementById('total-loss-number').textContent=fmt(C.totalAnual)+' / año';
 document.getElementById('total-loss-sub').textContent=comp.join(' + ')+'. Equivale a '+fmt(Math.round(C.totalAnual/12))+'/mes.';
 // Cost cards
 var g=document.getElementById('cost-grid'),h='';
 if(C.erosion>0)h+='<div class="cost-card red"><div class="cost-card-label red">Erosión patrimonio improductivo</div><div class="cost-card-number">'+fmt(C.erosion)+' / año</div><div class="cost-card-sub">'+fmt(C.improdM)+' bajo inflación ('+pF(INFL)+'). Pierdes '+fmt(C.erosionMes)+'/mes.</div><div class="cost-detail">'+fmt(C.improdM)+' × ('+pF(INFL)+' − '+pF(T_AHORRO)+') = '+fmt(C.erosion)+'</div></div>';
 if(C.oport>0)h+='<div class="cost-card orange"><div class="cost-card-label orange">Costo de oportunidad</div><div class="cost-card-number">'+fmt(C.oport)+' / año</div><div class="cost-card-sub">Diferencial vs portafolio al '+pF(T_FONDO)+'.</div></div>';
 if(C.fiscal>0)h+='<div class="cost-card red"><div class="cost-card-label red">Sobrecarga fiscal</div><div class="cost-card-number">'+fmt(C.fiscal)+' / año</div><div class="cost-card-sub">Sobre ingresos de '+fmt(C._ingAn)+'/año.</div><div class="cost-detail">Art. 241 ET · UVT '+UVT.toLocaleString('es-CO')+'</div></div>';
 if(C.impPat>0)h+='<div class="cost-card orange"><div class="cost-card-label orange">Impuesto patrimonio 2026</div><div class="cost-card-number">'+fmt(C.impPat)+'</div><div class="cost-card-sub">Patrimonio líquido supera '+fmt(UMBRAL_PAT)+'. Art. 296-3 ET.</div></div>';
 if(selectedProfile==='empresario'&&C._pEmp>=.5)h+='<div class="cost-card orange"><div class="cost-card-label orange">Concentrado en negocio</div><div class="cost-card-number">'+fmt(C.patRiesgo)+'</div><div class="cost-card-sub">'+Math.round(C._pEmp*100)+'% en un activo ilíquido.</div></div>';
 g.innerHTML=h;

 // ═══ CAMBIO 3: INDICADORES — IF siempre muestra Número Mágico + gap/excedente ═══
 var iG=document.getElementById('ind-grid'),iH='';
 // 1. IF
 var ifC=C.avIF>=100?'green':C.avIF>=40?'blue':C.avIF>=15?'orange':'red';
 iH+='<div class="ind-card '+ifC+'"><div class="ind-header"><div class="ind-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"/><line x1="12" y1="6" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="18"/></svg></div><div class="ind-title">Independencia Financiera</div><span class="ind-badge">'+C.avIF+'% de avance</span></div>';
 iH+='<div class="ind-value">'+fmt(C.nMag)+'</div>';
 iH+='<div class="ind-desc">Tu <strong>Número Mágico</strong> es '+fmt(C.nMag)+' — el patrimonio productivo que necesitas para que tus inversiones cubran tus gastos de '+fmt(C._gasMes)+'/mes. ';
 if(C.gapIF>0){iH+='Hoy tus ingresos pasivos generan <strong>'+fmt(C.retSost)+'/mes</strong> — un gap de <strong>'+fmt(C.gapIF)+'/mes</strong>.';}
 else{var exc=C.retSost-C._gasMes;iH+='Tus ingresos pasivos generan <strong>'+fmt(C.retSost)+'/mes</strong> — excedente de <strong>'+fmt(exc)+'/mes</strong> sobre tus gastos.';}
 iH+='</div><div class="ind-bar-wrap"><div class="ind-bar" style="width:0%" data-w="'+Math.min(C.avIF,100)+'"></div></div>';
 iH+='<div class="ind-detail"><div class="ind-detail-item"><div class="ind-detail-label">Ingresos pasivos actuales</div><div class="ind-detail-val">'+fmt(C.retSost)+'/mes</div></div><div class="ind-detail-item"><div class="ind-detail-label">Portafolio productivo est.</div><div class="ind-detail-val">'+fmt(C.pp)+'</div></div></div></div>';

 // 2. FE
 var feR=C.metaM>0?(C.mCub/C.metaM)*100:100;var feC=feR>=100?'green':feR>=50?'orange':'red';
 iH+='<div class="ind-card '+feC+'"><div class="ind-header"><div class="ind-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg></div><div class="ind-title">Fondo de Emergencia</div><span class="ind-badge">'+Math.min(C.mCub,99).toFixed(1)+' de '+C.metaM+' meses</span></div>';
 iH+='<div class="ind-value">'+(C.gapFE>0?fmt(C.gapFE)+' de gap':'✓ Óptimo')+'</div>';
 iH+='<div class="ind-desc">'+(C.gapFE>0?'Te faltan <strong>'+fmt(C.gapFE)+'</strong> para '+C.metaM+' meses ('+(selectedProfile==='empresario'?'9 para empresarios':'6 para profesionales')+').'+(C._pas>0?' Tus ingresos pasivos de '+fmt(C._pas)+'/mes reducen el déficit real.':''):'✅ Liquidez cubre <strong>'+Math.min(C.mCub,99).toFixed(1)+' meses</strong> de déficit.')+'</div>';
 iH+='<div class="ind-bar-wrap"><div class="ind-bar" style="width:0%" data-w="'+Math.min(feR,100)+'"></div></div>';
 iH+='<div class="ind-detail"><div class="ind-detail-item"><div class="ind-detail-label">Fondo ideal</div><div class="ind-detail-val">'+fmt(C.fondoId)+'</div></div><div class="ind-detail-item"><div class="ind-detail-label">Liquidez actual</div><div class="ind-detail-val">'+fmt(C.liqBruta)+'</div></div></div></div>';

 // 3. Concentración
 var coC=C.pNLiq>85?'red':C.pNLiq>70?'orange':'green';
 iH+='<div class="ind-card '+coC+'"><div class="ind-header"><div class="ind-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg></div><div class="ind-title">Concentración de Activos</div><span class="ind-badge">'+C.pNLiq.toFixed(0)+'% ilíquido</span></div>';
 iH+='<div class="ind-value">'+(C.pNLiq>70?C.pNLiq.toFixed(0)+'% ilíquido':'Diversificado')+'</div>';
 iH+='<div class="ind-desc">'+(C.pNLiq>70?'<strong>'+C.pNLiq.toFixed(0)+'%</strong> atrapado en activos ilíquidos. Solo <strong>'+fmt(C.monLiq)+'</strong> disponible.':'Distribución líquidos (<strong>'+C.pLiq.toFixed(0)+'%</strong>) vs ilíquidos (<strong>'+C.pNLiq.toFixed(0)+'%</strong>) razonable.')+'</div>';
 iH+='<div class="ind-bar-wrap"><div class="ind-bar" style="width:0%" data-w="'+C.pLiq+'"></div></div>';
 iH+='<div class="ind-detail"><div class="ind-detail-item"><div class="ind-detail-label">Líquidos</div><div class="ind-detail-val">'+fmt(C.monLiq)+'</div></div><div class="ind-detail-item"><div class="ind-detail-label">No líquidos</div><div class="ind-detail-val">'+fmt(C.monNLiq)+'</div></div></div></div>';

 // 4. Deuda
 if(C.deuTot>0){var dC=C.rDeu>50?'red':C.rDeu>35?'orange':'green';
  iH+='<div class="ind-card '+dC+'"><div class="ind-header"><div class="ind-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></div><div class="ind-title">Estructura de Deuda</div><span class="ind-badge">Ratio: '+C.rDeu.toFixed(1)+'%</span></div>';
  iH+='<div class="ind-value">'+fmt(C.deuTot)+'</div>';
  iH+='<div class="ind-desc">Deuda = <strong>'+C.rDeu.toFixed(1)+'%</strong> de activos.'+(C.deuCon>0?' <strong>'+fmt(C.deuCon)+' de consumo</strong> ('+C.pDC.toFixed(0)+'%).':'')+'</div>';
  iH+='<div class="ind-bar-wrap"><div class="ind-bar" style="width:0%" data-w="'+Math.min(C.rDeu*1.5,100)+'"></div></div>';
  iH+='<div class="ind-detail"><div class="ind-detail-item"><div class="ind-detail-label">Patrimonio neto</div><div class="ind-detail-val">'+fmt(C.pNeto)+'</div></div><div class="ind-detail-item"><div class="ind-detail-label">Deuda consumo</div><div class="ind-detail-val">'+fmt(C.deuCon)+'</div></div></div></div>';}
 iG.innerHTML=iH;
 setTimeout(function(){iG.querySelectorAll('.ind-bar').forEach(function(b){b.style.width=(b.dataset.w||0)+'%'})},400);

 // Alert
 var al='<div class="alert-2026-title">Contexto fiscal 2026</div><div class="alert-2026-text">';
 if(C.impPat>0)al+='<strong>Imp. patrimonio:</strong> <span class="alert-2026-number">'+fmt(C.impPat)+'</span>. Vence mayo/sep 2026.<br><br>';
 if(C.fiscal>0)al+='<strong>Renta:</strong> Sobrecarga <span class="alert-2026-number">'+fmt(C.fiscal)+'</span>/año.<br><br>';
 if(C._pCOP>.7)al+='<strong>Cambiario:</strong> <span class="alert-2026-number">'+Math.round(C._pCOP*100)+'%</span> de tus líquidos en COP → costo de oportunidad cambiario <span class="alert-2026-number">'+fmt(C.expDeval)+'</span>/año.';
 al+='</div>';document.getElementById('alert-2026').innerHTML=al;
 // Breakdown
 var capas=[{ids:["f1e","f1p","f2e","inv"],name:"💰 Estructura fiscal"},{ids:["c2e","strat"],name:"📈 Crecimiento"}];
 var bd=document.getElementById('breakdown');bd.innerHTML='';
 capas.forEach(function(ca){var p=0,m=0;ca.ids.forEach(function(id){var q=questionSequence.find(function(qq){return qq.id===id});if(q&&q.type==='choice'&&answers[q.id]!==undefined){p+=q.opts[answers[q.id]].pts;m+=3}});if(!m)return;var pc=p/m*100;var cl=pc<40?'#C0392B':pc<65?'#D4821A':pc<85?'#2471A3':'#1E8449';bd.innerHTML+='<div class="breakdown-card"><div class="breakdown-title">'+ca.name+'</div><div class="breakdown-score"><span class="bd-pts">'+p+'</span><span class="bd-max">/ '+m+'</span></div><div class="bd-bar"><div class="bd-bar-fill" style="width:0%;background:'+cl+'" data-width="'+pc+'"></div></div></div>'});
 setTimeout(function(){document.querySelectorAll('.bd-bar-fill').forEach(function(el){el.style.width=el.dataset.width+'%'})},400);
 // Vulns
 var vl=document.getElementById('vulns-list');vl.innerHTML='';var vc=0;
 questionSequence.forEach(function(q){if(q.type!=='choice'||!q.vuln)return;var a=answers[q.id];if(a!==undefined&&q.opts[a].pts<=q.vuln.threshold&&vc<5){var ct='';if(q.id==='f1e'||q.id==='f1p')ct=fmt(C.fiscal)+'/año';else if(q.id==='inv')ct=fmt(C.oport)+'/año';else if(q.id==='c2e')ct='Mezclar flujos = riesgo fiscal';else if(q.id==='strat')ct='Dinero quieto no genera rendimiento';vl.innerHTML+='<div class="vuln-item" style="border-color:'+q.vuln.color+'"><div class="vuln-icon">'+q.vuln.icon+'</div><div class="vuln-text"><strong>'+q.vuln.title+'</strong>'+(ct?'<span class="vuln-cost">'+ct+'</span>':'')+'</div></div>';vc++}});
 var pasivo=sliderValues.np||0,gastos=sliderValues.n2||15;
 if(gastos>0&&pasivo<gastos*.2&&vc<6){var pctCub=Math.round(pasivo/gastos*100);vl.innerHTML+='<div class="vuln-item" style="border-color:#D4821A"><div class="vuln-icon">🔺</div><div class="vuln-text"><strong>Alta dependencia del ingreso activo</strong>Ingresos pasivos cubren el '+pctCub+'% de tus gastos.<span class="vuln-cost">Pasivos: '+fmt(pasivo*1e6)+'/mes vs gastos: '+fmt(gastos*1e6)+'/mes</span></div></div>'}
 // CTA
 document.getElementById('cta-amount').textContent=fmt(C.totalAnual)+' al año';
 document.getElementById('cta-sub').textContent='Tu patrimonio de '+fmt(C._pat)+' está dejando '+fmt(C.totalAnual)+' al año. En la sesión analizamos tus números y te mostramos dónde recuperarlo.';
 window.scrollTo({top:0,behavior:'smooth'});
}

function restartTest(){selectedProfile=null;questionSequence=[];current=0;answers={};sliderValues={};document.getElementById('result-screen').style.display='none';document.getElementById('capture-screen').style.display='none';['cap-nombre','cap-email','cap-whatsapp'].forEach(function(id){document.getElementById(id).value='';document.getElementById(id).classList.remove('error')});document.getElementById('btn-capture').disabled=false;document.getElementById('card-empresario').classList.remove('selected');document.getElementById('card-profesional').classList.remove('selected');document.getElementById('btn-profile-next').disabled=true;document.getElementById('start-screen').style.display='block';window.scrollTo({top:0,behavior:'smooth'})}