// ═══════════════════════════════════════════════════════════════════════
//  TEST ARQUITECTURA PATRIMONIAL — app.js v2 (consolidado)
// ═══════════════════════════════════════════════════════════════════════
//  Cambios respecto a v1:
//   1. Motor de cálculo v2 con dos números (pérdida real + oportunidad)
//   2. Eliminada pregunta n1 (patrimonio = líquidos + no líquidos)
//   3. Validación cruzada en goNext: bloquea ingresos < gastos
//   4. Validación de coherencia completa (validarDatos): improductivo ≤ líquidos,
//      deuda consumo ≤ deuda total, patrimonio mínimo, respuestas obligatorias
//   5. Lenguaje cotidiano en resultados (sin "gap", "portafolio productivo")
//   6. CTA dinámico con 4 categorías troncales y sub-variantes
//   7. Esquema Firestore v2 (sin nulls ambiguos, campos renombrados)
//   8. Validación WhatsApp Colombia (10 dígitos, empieza por 3) con mensaje claro
//   9. Validación email con detección de errores comunes de escritura
//  10. Indicadores nuevos: "Cuánto de tu Dinero te Rinde", "Diversificación por Moneda"
//
//  Estructura del archivo:
//   - Constantes del motor (UVT, INFL, T_FONDO, etc.)
//   - calcImpPat: impuesto al patrimonio Art 296-3 ET
//   - ALL_Q: array de 17 preguntas (13 prof / 15 emp según perfil)
//   - NIVELES: umbrales de score recalibrados a terciles
//   - Flujo del test: showProfile, renderQ, goNext, goBack
//   - validarDatos: chequeo de coherencia antes del cálculo
//   - calcMotorV2: motor principal de cálculo
//   - seleccionarCTA: selección dinámica entre 4 categorías
//   - submitCapture: guardado en Firestore con esquema v2
//   - showRes: pantalla de resultados con dos números
// ═══════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════
// CONSTANTES DEL MOTOR
// ═══════════════════════════════════════════════════════════════════════
const UVT = 52374;                          // UVT 2026
const INFL = 0.0517;                        // Inflación anual
const T_AHORRO = 0.015;                     // Tasa cuenta de ahorro
const T_CDT = 0.08;                         // Tasa CDT
const T_FONDO = 0.08;                       // Portafolio moderado global
const DEVAL = 0.04;                         // Devaluación COP/USD anual
const TASA_RETIRO_IF = 0.035;               // Safe withdrawal rate emergentes
const COLCHON_MESES = 3;
const UMBRAL_PAT = 72000 * UVT;             // Umbral imp. patrimonio
const EXCL_VIV = 12000 * UVT;               // Exclusión vivienda

/* Art 296-3 ET — Impuesto al patrimonio personas naturales */
function calcImpPat(patBruto, deuda) {
  var pl = Math.max(0, patBruto - deuda);
  if (pl < UMBRAL_PAT) return 0;
  var base = Math.max(0, pl - EXCL_VIV);
  var t1 = 72000, t2 = 122000, t3 = 239000;
  var bUVT = base / UVT;
  var imp = 0;
  if (bUVT > t1) imp += (Math.min(bUVT, t2) - t1) * 0.005;
  if (bUVT > t2) imp += (Math.min(bUVT, t3) - t2) * 0.010;
  if (bUVT > t3) imp += (bUVT - t3) * 0.015;
  return Math.round(imp * UVT);
}

// ═══════════════════════════════════════════════════════════════════════
// PREGUNTAS DEL TEST
// ═══════════════════════════════════════════════════════════════════════
var ALL_Q = [
  // ─── SECCIÓN 01: TUS NÚMEROS ───
  {id:"n2", sec:"01", secN:"TUS NÚMEROS", prof:"both", type:"number_input",
   q:"¿Cuánto gasta tu familia al mes? Incluye vivienda, colegios, seguros, alimentación, transporte, todo.",
   slider:{min:5, max:80, step:1, value:15, unit:"M", prefix:"$", suffix:" millones COP / mes"},
   inputHint:"Si gastas $35.000.000 al mes, escribe <strong>35</strong> · Si gastas $5.000.000, escribe <strong>5</strong>",
   ctx:function(v){return '<strong>$'+(v*12).toLocaleString('es-CO')+'M al año</strong> en gastos fijos.';}},

  {id:"n3e", sec:"01", secN:"TUS NÚMEROS", prof:"empresario", type:"number_input",
   q:"¿Cuánto recibes al mes entre salario, honorarios, dividendos y retiros de tu empresa?",
   slider:function(s){
     // Rango: desde la mitad de los gastos hasta 8x los gastos
     // (porque puede haber pasivos que complementen — la validación final está en goNext)
     var g = s&&s.n2?s.n2:15;
     return {min: Math.max(1, Math.floor(g*0.5)), max: Math.max(50, g*8), step:1, value: g, unit:"M", prefix:"$", suffix:" millones COP / mes"};
   },
   inputHint:"Si recibes $50.000.000 al mes, escribe <strong>50</strong> · Si recibes $12.000.000, escribe <strong>12</strong>",
   ctx:function(v,s){
     var g=s&&s.n2?s.n2:15;
     if(v<=g)return'⚠️ <strong>Tu ingreso activo no supera tus gastos.</strong> Necesitarás ingreso pasivo para cubrir la diferencia.';
     var a=Math.round(((v-g)/v)*100);
     return 'Tasa de ahorro: <strong>'+a+'%</strong>.'+(a<=10?' Tu patrimonio crece muy lento.':'');
   }},

  {id:"n3p", sec:"01", secN:"TUS NÚMEROS", prof:"profesional", type:"number_input",
   q:"¿Cuánto recibes al mes entre salario, honorarios, bonificaciones y otros ingresos?",
   slider:function(s){
     var g = s&&s.n2?s.n2:15;
     return {min: Math.max(1, Math.floor(g*0.5)), max: Math.max(50, g*8), step:1, value: g, unit:"M", prefix:"$", suffix:" millones COP / mes"};
   },
   inputHint:"Si recibes $50.000.000 al mes, escribe <strong>50</strong> · Si recibes $12.000.000, escribe <strong>12</strong>",
   ctx:function(v,s){
     var g=s&&s.n2?s.n2:15;
     if(v<=g)return'⚠️ <strong>Tu ingreso activo no supera tus gastos.</strong> Necesitarás ingreso pasivo para cubrir la diferencia.';
     var a=Math.round(((v-g)/v)*100);
     return 'Tasa de ahorro: <strong>'+a+'%</strong>.'+(a<=10?' Tu patrimonio crece muy lento.':'');
   }},

  {id:"np", sec:"01", secN:"TUS NÚMEROS", prof:"both", type:"number_input",
   q:"¿Cuánto recibes al mes en ingresos pasivos? Arriendos, dividendos, intereses, regalías — ingresos que no requieren tu trabajo activo.",
   slider:function(s){
     // Máximo: 5x los gastos (ya con eso es FI con holgura)
     var g = s&&s.n2?s.n2:15;
     return {min:0, max: Math.max(50, g*5), step:1, value:0, unit:"M", prefix:"$", suffix:" millones COP / mes"};
   },
   inputHint:"Si recibes $5.000.000 al mes en arriendos/dividendos, escribe <strong>5</strong> · Si no tienes, escribe <strong>0</strong>",
   ctx:function(v,s){
     var g=s&&s.n2?s.n2:15;
     var ia=s&&(s.n3e||s.n3p)?(s.n3e||s.n3p):25;
     var totalIng = ia+v;
     if(totalIng<g) return '⚠️ <strong>Tus ingresos totales ('+totalIng+'M) no cubren tus gastos ('+g+'M).</strong> Revisa los datos antes de continuar.';
     if(!v)return'Sin ingresos pasivos — dependes 100% de tu trabajo activo.';
     var p=Math.round((v/g)*100);
     return p>=100?'✅ <strong>Tus pasivos cubren todos tus gastos.</strong>':'Cubren <strong>'+p+'%</strong> de tus gastos.';
   }},

  // ─── SECCIÓN 01: TU PATRIMONIO ───
  {id:"nl", sec:"01", secN:"TU PATRIMONIO", prof:"both", type:"number_input",
   q:"¿Cuánto tienes en activos líquidos? Cuentas de ahorro, CDTs, fondos de inversión, acciones — todo lo que puedas convertir en efectivo en menos de 30 días.",
   slider:{min:0, max:10000, step:10, value:300, unit:"M", prefix:"$", suffix:" millones COP"},
   inputHint:"Si tienes $500.000.000 líquidos, escribe <strong>500</strong> · Si tienes $1.500.000.000, escribe <strong>1.500</strong>",
   ctx:function(v,s){
     var g=s&&s.n2?s.n2:15;
     var m=g>0?Math.round(v/g):0;
     return m<3?'⚠️ <strong>Solo '+m+' meses</strong> de gastos en liquidez.':m<9?'<strong>'+m+' meses</strong> de gastos. Por debajo de lo recomendado.':'✅ <strong>'+m+' meses</strong> de gastos cubiertos.';
   }},

  {id:"n4", sec:"01", secN:"TU PATRIMONIO", prof:"both", type:"number_input",
   q:"De tus activos líquidos, ¿cuánto está en cuentas de ahorro, CDTs o instrumentos que rindan menos del 5% anual?",
   slider:function(s){
     var l=s&&s.nl!==undefined?s.nl:300;
     return {min:0, max:l, step:Math.max(5,Math.round(l/100)*5), value:Math.round(l*.5), unit:"M", prefix:"$", suffix:" millones en bajo rendimiento"};
   },
   ctx:function(v){
     var er=Math.round(v*(INFL-T_AHORRO));
     return v>0?'<strong>$'+v.toLocaleString('es-CO')+'M</strong> rindiendo bajo inflación. Pierdes ~<strong>$'+er.toLocaleString('es-CO')+'M/año</strong> de poder de compra.':'Sin dinero parado — todo está rindiendo.';
   }},

  {id:"nn", sec:"01", secN:"TU PATRIMONIO", prof:"both", type:"number_input",
   q:"¿Cuánto tienes en activos NO líquidos? Inmuebles, vehículos, participación en empresa, arte — lo que tarda más de 30 días en venderse.",
   slider:{min:0, max:20000, step:10, value:1000, unit:"M", prefix:"$", suffix:" millones COP"},
   inputHint:"Si tu inmueble vale $800.000.000, escribe <strong>800</strong> · Si vale $2.500.000.000, escribe <strong>2.500</strong>",
   ctx:function(v,s){
     var l=s&&s.nl?s.nl:300;
     var t=l+v;
     if(t===0)return 'Sin patrimonio acumulado.';
     var p=Math.round((v/t)*100);
     return '<strong>Patrimonio total: $'+t.toLocaleString('es-CO')+'M</strong> ('+p+'% no líquido, '+(100-p)+'% disponible).'+(p>85?' ⚠️ Alta concentración en activos difíciles de mover.':'');
   }},

  {id:"n5", sec:"01", secN:"TU PATRIMONIO", prof:"both", type:"slider",
   q:"¿Qué porcentaje de tu patrimonio TOTAL está en pesos colombianos? Incluye inmuebles, líquidos y empresa. El resto estaría en dólares, euros u otras monedas.",
   slider:{min:0, max:100, step:5, value:90, unit:"%", prefix:"", suffix:"% en pesos colombianos"},
   ctx:function(v,s){
     // Calcular monto en pesos sobre patrimonio total para que el usuario vea la cifra
     var l = s&&s.nl?s.nl:0;
     var n = s&&s.nn?s.nn:0;
     var pat = l+n;
     var enPesos = Math.round(pat*v/100);
     var perdida = Math.round(enPesos*DEVAL);
     if(pat===0) return v>=80?'⚠️ Concentración alta en pesos.':v>=50?'Concentración moderada en pesos.':'Buena diversificación cambiaria.';
     if(v>=80) return '⚠️ <strong>$'+enPesos.toLocaleString('es-CO')+'M en pesos.</strong> Pérdida estimada por devaluación: ~$'+perdida.toLocaleString('es-CO')+'M/año.';
     if(v>=50) return '<strong>$'+enPesos.toLocaleString('es-CO')+'M en pesos.</strong> Concentración moderada.';
     return 'Buena diversificación: solo $'+enPesos.toLocaleString('es-CO')+'M en pesos.';
   }},

  {id:"nd", sec:"01", secN:"TU PATRIMONIO", prof:"both", type:"number_input",
   q:"¿Cuánto debes en total? Suma hipoteca, créditos bancarios, tarjetas de crédito, libre inversión, leasing — toda tu deuda pendiente.",
   slider:function(s){
     var l=s&&s.nl?s.nl:300;
     var n=s&&s.nn?s.nn:1000;
     var t=l+n;
     return {min:0, max:Math.max(t,500), step:Math.max(5,Math.round(t/100)*5), value:0, unit:"M", prefix:"$", suffix:" millones COP"};
   },
   ctx:function(v,s){
     if(!v)return'✅ <strong>Sin deuda.</strong> Estructura libre de apalancamiento.';
     var l=s&&s.nl?s.nl:300;
     var n=s&&s.nn?s.nn:1000;
     var r=Math.round((v/(l+n))*100);
     return r>50?'🔴 <strong>Deuda = '+r+'% de tus activos.</strong> Apalancamiento alto.':'Deuda = <strong>'+r+'%</strong> de tus activos.';
   }},

  {id:"ndc", sec:"01", secN:"TU PATRIMONIO", prof:"both", type:"number_input",
   q:"De esa deuda, ¿cuánto es deuda de consumo? Tarjetas, libre inversión, crédito de vehículo — deuda que no genera retorno.",
   slider:function(s){
     var d=s&&s.nd!==undefined?s.nd:0;
     return {min:0, max:Math.max(d,1), step:Math.max(1,Math.round(d/50)), value:0, unit:"M", prefix:"$", suffix:" millones en deuda de consumo"};
   },
   ctx:function(v,s){
     var d=s&&s.nd?s.nd:0;
     if(d===0)return 'Sin deuda total — no hay deuda de consumo.';
     if(!v)return'✅ Toda tu deuda es estructural (vivienda, inversión).';
     var p=d>0?Math.round((v/d)*100):0;
     return p>40?'🔴 <strong>'+p+'%</strong> de tu deuda es consumo. Prioriza eliminarla.':'<strong>'+p+'%</strong> de tu deuda es consumo.';
   }},

  // ─── SECCIÓN 02: ESTRUCTURA FISCAL ───
  {id:"f1e", sec:"02", secN:"ESTRUCTURA FISCAL", prof:"empresario", type:"choice",
   q:"¿Cómo sacas el dinero de tu empresa para tu uso personal?",
   opts:[
     {pts:3, text:"Esquema optimizado: mezcla salario + dividendos con asesoría fiscal"},
     {pts:2, text:"Principalmente como salario o honorarios"},
     {pts:1, text:"Retiro según necesito, sin estrategia"},
     {pts:0, text:"No sé exactamente — a veces salario, a veces retiro"}
   ],
   // threshold 2: incluye "principalmente salario" como señal (no es estructura optimizada)
   vuln:{threshold:2, severidad:'alta', titulo:"Sin estrategia de retiro de utilidades"}},

  {id:"f1p", sec:"02", secN:"ESTRUCTURA FISCAL", prof:"profesional", type:"choice",
   q:"¿Alguien ha revisado si estás pagando más impuestos de lo necesario?",
   opts:[
     {pts:3, text:"Sí, asesoría fiscal activa cada año"},
     {pts:2, text:"Tengo contador pero nunca evaluamos optimización"},
     {pts:1, text:"No tengo claridad"},
     {pts:0, text:"Pago lo que dice el contador"}
   ],
   // threshold 2: "tengo contador pero nunca optimización" SÍ es señal fiscal
   vuln:{threshold:2, severidad:'alta', titulo:"Nadie ha revisado si puedes pagar menos renta"}},

  {id:"f2e", sec:"02", secN:"ESTRUCTURA FISCAL", prof:"empresario", type:"choice",
   q:"¿Tienes utilidades acumuladas sin repartir en tu empresa?",
   opts:[
     {pts:3, text:"Repartimos estratégicamente cada año"},
     {pts:2, text:"Algo acumulado, repartimos mayoría"},
     {pts:1, text:"Sí, de varios años"},
     {pts:0, text:"Nunca repartimos formalmente"}
   ],
   vuln:{threshold:1, severidad:'alta', titulo:"Utilidades acumuladas sin estrategia"}},

  {id:"inv", sec:"02", secN:"ESTRUCTURA FISCAL", prof:"both", type:"choice",
   q:"¿Dónde tienes la mayor parte de tus inversiones financieras hoy?",
   opts:[
     {pts:3, text:"Portafolio diversificado: fondos internacionales, ETFs, renta fija + variable"},
     {pts:2, text:"Fondos de inversión locales o pensión voluntaria"},
     {pts:1, text:"Principalmente CDTs o cuentas remuneradas"},
     {pts:0, text:"No tengo inversiones — solo inmuebles o cuentas bancarias"}
   ],
   vuln:{threshold:1, severidad:'alta', titulo:"Tus inversiones están concentradas localmente"}},

  {id:"f3e", sec:"02", secN:"ESTRUCTURA FISCAL", prof:"empresario", type:"number_input",
   q:"De tus activos no líquidos, ¿cuánto representa tu empresa? (Patrimonio neto contable, valor de venta estimado o múltiplo de utilidad).",
   slider:function(s){
     var n=s&&s.nn?s.nn:1000;
     return {min:0, max:n, step:10, value:Math.round(n*.6), unit:"M", prefix:"$", suffix:" millones COP"};
   },
   ctx:function(v,s){
     var n=s&&s.nn?s.nn:1000;
     if(n===0) return 'Sin activos no líquidos registrados.';
     var p = n>0?Math.round((v/n)*100):0;
     var pPat = (s&&s.nl?s.nl:0) + n > 0 ? Math.round((v/((s.nl||0)+n))*100) : 0;
     return p>=70?'⚠️ <strong>'+p+'% de tus activos no líquidos están en tu empresa</strong> ('+pPat+'% del patrimonio total). Concentración alta.':'<strong>'+p+'%</strong> de tus no líquidos en tu empresa ('+pPat+'% del patrimonio total).';
   }},

  {id:"f3p", sec:"02", secN:"ESTRUCTURA FISCAL", prof:"profesional", type:"slider",
   q:"¿Qué porcentaje de tus ingresos depende de una sola fuente?",
   slider:{min:20, max:100, step:5, value:80, unit:"%", prefix:"", suffix:"% de una sola fuente"},
   ctx:function(v){
     return v>=80?'⚠️ <strong>Más del 80% de una sola fuente.</strong> Riesgo alto.':v>=60?'Dependencia moderada.':'Diversificación saludable.';
   }},

  // ─── SECCIÓN 03: CRECIMIENTO ───
  {id:"c2e", sec:"03", secN:"CRECIMIENTO", prof:"empresario", type:"choice",
   q:"¿Tus flujos personales están separados de los de tu empresa?",
   opts:[
     {pts:3, text:"Sí, cuentas separadas y esquema claro"},
     {pts:2, text:"Parcialmente"},
     {pts:1, text:"Con frecuencia mezclo los flujos"},
     {pts:0, text:"No existe separación"}
   ],
   vuln:{threshold:1, severidad:'alta', titulo:"Flujos personales y empresariales mezclados"}},

  {id:"strat", sec:"03", secN:"CRECIMIENTO", prof:"both", type:"choice",
   q:"¿Tienes una estrategia de inversión definida con horizonte y asignación de activos?",
   opts:[
     {pts:3, text:"Sí, política escrita con metas y plazos"},
     {pts:2, text:"Invierto con criterio pero sin formalizar"},
     {pts:1, text:"Invierto cuando aparecen oportunidades"},
     {pts:0, text:"No tengo estrategia — mi dinero está quieto"}
   ],
   vuln:{threshold:1, severidad:'media', titulo:"Inviertes sin un plan claro"}}
];

// ═══════════════════════════════════════════════════════════════════════
// NIVELES (recalibrados a terciles)
// ═══════════════════════════════════════════════════════════════════════
var NIVELES = {
  profesional: [
    {min:0, max:3, label:"Patrimonio en Riesgo Crítico", color:"#C0392B", gauge:"#E74C3C"},
    {min:4, max:6, label:"Estructura Deficiente", color:"#D4821A", gauge:"#E67E22"},
    {min:7, max:9, label:"En Construcción", color:"#2471A3", gauge:"#3498DB"},
    {min:10, max:12, label:"Arquitectura Sólida", color:"#1E8449", gauge:"#27AE60"}
  ],
  empresario: [
    {min:0, max:5, label:"Patrimonio en Riesgo Crítico", color:"#C0392B", gauge:"#E74C3C"},
    {min:6, max:10, label:"Estructura Deficiente", color:"#D4821A", gauge:"#E67E22"},
    {min:11, max:14, label:"En Construcción", color:"#2471A3", gauge:"#3498DB"},
    {min:15, max:18, label:"Arquitectura Sólida", color:"#1E8449", gauge:"#27AE60"}
  ]
};

// ═══════════════════════════════════════════════════════════════════════
// FLUJO DEL TEST
// ═══════════════════════════════════════════════════════════════════════
var selectedProfile = null;
var questionSequence = [];
var current = 0;
var answers = {};
var sliderValues = {};

function buildSeq(p) {
  var o = p === 'empresario'
    ? ["n2","n3e","np","nl","n4","nn","n5","nd","ndc","f1e","f2e","inv","f3e","strat","c2e"]
    : ["n2","n3p","np","nl","n4","nn","n5","nd","ndc","f1p","inv","f3p","strat"];
  return o.map(function(id){return ALL_Q.find(function(q){return q.id===id});}).filter(Boolean);
}

function showProfile(){
  document.getElementById('start-screen').style.display='none';
  document.getElementById('profile-screen').style.display='block';
}

function backToStart(){
  document.getElementById('profile-screen').style.display='none';
  document.getElementById('start-screen').style.display='block';
}

function selectProfile(p){
  selectedProfile=p;
  document.getElementById('card-empresario').classList.toggle('selected',p==='empresario');
  document.getElementById('card-profesional').classList.toggle('selected',p==='profesional');
  document.getElementById('btn-profile-next').disabled=false;
}

function startWithProfile(){
  if(!selectedProfile)return;
  questionSequence=buildSeq(selectedProfile);
  current=0;
  answers={};
  sliderValues={};
  document.getElementById('profile-screen').style.display='none';
  document.getElementById('question-screen').style.display='block';
  renderQ();
}

function renderQ(){
  var q=questionSequence[current],tot=questionSequence.length;
  var card=document.getElementById('question-card'),sl=document.getElementById('section-label');
  card.classList.remove('visible');
  sl.classList.remove('visible');
  document.getElementById('section-num').textContent=q.sec;
  document.getElementById('section-name').textContent=q.secN;
  document.getElementById('q-number').textContent='Pregunta '+String(current+1).padStart(2,'0')+' de '+tot;
  document.getElementById('q-text').textContent=q.q;
  document.getElementById('profile-badge-wrap').innerHTML=q.prof!=='both'
    ? '<div class="profile-badge">'+(selectedProfile==='empresario'?'Para empresarios':'Para profesionales')+'</div>'
    : '';
  document.getElementById('progress-fill').style.width=((current+1)/tot*100)+'%';
  document.getElementById('progress-count').textContent=(current+1)+' / '+tot;

  var area=document.getElementById('answer-area');
  if(q.type==='slider'){
    var s=typeof q.slider==='function'?q.slider(sliderValues):q.slider;
    var sv=sliderValues[q.id]!==undefined?Math.min(Math.max(sliderValues[q.id],s.min),s.max):s.value;
    var ctx=q.ctx?q.ctx(sv,sliderValues):'';
    area.innerHTML='<div class="slider-wrap"><div class="slider-display"><div class="slider-value-big" id="sv-d">'+s.prefix+sv.toLocaleString('es-CO')+s.unit+'</div><div class="slider-value-unit">'+s.suffix+'</div></div><input type="range" id="sv-i" min="'+s.min+'" max="'+s.max+'" step="'+s.step+'" value="'+sv+'"><div class="slider-labels"><span>'+s.prefix+s.min.toLocaleString('es-CO')+s.unit+'</span><span>'+s.prefix+s.max.toLocaleString('es-CO')+s.unit+'</span></div><div class="slider-context" id="sv-c">'+ctx+'</div></div>';
    var inp=document.getElementById('sv-i');
    inp.addEventListener('input',function(){
      var v=parseInt(this.value);
      sliderValues[q.id]=v;
      document.getElementById('sv-d').textContent=s.prefix+v.toLocaleString('es-CO')+s.unit;
      if(q.ctx)document.getElementById('sv-c').innerHTML=q.ctx(v,sliderValues);
      sFill(this);
    });
    sliderValues[q.id]=sv;
    sFill(inp);
    document.getElementById('btn-next').disabled=false;
    document.getElementById('skip-hint').textContent='';
  } else if(q.type==='number_input'){
    // ═══════════════════════════════════════════════════════════════════
    // INPUT MANUAL CON FORMATO DE MILES AUTOMÁTICO
    // ═══════════════════════════════════════════════════════════════════
    // El usuario escribe el valor en millones COP. Formateo en vivo: 1500 → 1.500
    var s=typeof q.slider==='function'?q.slider(sliderValues):q.slider;
    var sv=sliderValues[q.id]!==undefined?sliderValues[q.id]:(s.value!==undefined?s.value:0);
    // Si el valor por defecto del slider venía con un valor sugerido distinto de 0,
    // dejamos el campo VACÍO para que el usuario tenga que ingresar conscientemente.
    var valorInicial = sliderValues[q.id]!==undefined ? sliderValues[q.id] : null;
    var ctx=q.ctx?q.ctx(valorInicial!==null?valorInicial:0,sliderValues):'';
    var maxValor = s.max;
    var minValor = s.min;

    area.innerHTML =
      '<div class="number-input-wrap">'+
        '<div class="number-input-display">'+
          '<span class="ni-prefix">'+(s.prefix||'$')+'</span>'+
          '<input type="text" inputmode="numeric" id="ni-i" '+
                 'placeholder="0" '+
                 'value="'+(valorInicial!==null?valorInicial.toLocaleString('es-CO'):'')+'" '+
                 'autocomplete="off">'+
          '<span class="ni-suffix">'+(s.suffix||' millones COP').replace(/^\s+/,' ')+'</span>'+
        '</div>'+
        // v6: hint personalizado por pregunta (con ejemplos concretos para que el usuario
        // sepa exactamente qué escribir). Si no hay inputHint, mostrar rango automático.
        // Etiqueta "💡 Cómo escribir:" hace que el ojo del usuario lo note.
        (q.inputHint
          ? '<div class="number-input-hint hint-with-example">'+
              '<span class="hint-icon">💡</span>'+
              '<span class="hint-label">Cómo escribir:</span> '+
              q.inputHint+
            '</div>'
          : '<div class="number-input-hint">Rango sugerido: '+(s.prefix||'$')+minValor.toLocaleString('es-CO')+' — '+(s.prefix||'$')+maxValor.toLocaleString('es-CO')+(s.unit||'M')+'</div>'
        )+
        '<div class="slider-context" id="sv-c">'+ctx+'</div>'+
      '</div>';

    var inp = document.getElementById('ni-i');

    // Función de formateo: limpia no-dígitos y aplica separadores de miles
    function formatear(valorRaw){
      var soloDigitos = (valorRaw||'').toString().replace(/\D/g,'');
      if(!soloDigitos) return {numero:null, formateado:''};
      var n = parseInt(soloDigitos, 10);
      // Limitar al máximo permitido
      if(n > maxValor) n = maxValor;
      return {numero: n, formateado: n.toLocaleString('es-CO')};
    }

    inp.addEventListener('input', function(e){
      var pos = inp.selectionStart;
      var antesDelCursor = inp.value.substring(0, pos).replace(/\D/g,'').length;
      var resultado = formatear(inp.value);
      inp.value = resultado.formateado;

      // Actualizar valor en estado
      if(resultado.numero!==null){
        sliderValues[q.id] = resultado.numero;
        // Actualizar contexto
        if(q.ctx){
          document.getElementById('sv-c').innerHTML = q.ctx(resultado.numero, sliderValues);
        }
        document.getElementById('btn-next').disabled = false;
        document.getElementById('skip-hint').textContent = '';
      } else {
        delete sliderValues[q.id];
        if(q.ctx){
          document.getElementById('sv-c').innerHTML = '';
        }
        document.getElementById('btn-next').disabled = true;
        document.getElementById('skip-hint').textContent = 'Ingresa un valor para continuar';
      }

      // Restaurar posición del cursor (compensando los puntos añadidos)
      var nuevaPos = 0, digitosVistos = 0;
      for(var i=0; i<inp.value.length && digitosVistos<antesDelCursor; i++){
        if(/\d/.test(inp.value[i])) digitosVistos++;
        nuevaPos = i+1;
      }
      try { inp.setSelectionRange(nuevaPos, nuevaPos); } catch(e){}
    });

    // Validación al perder foco: aplicar mínimo si quedó vacío con valor previo
    inp.addEventListener('blur', function(){
      if(sliderValues[q.id]!==undefined && sliderValues[q.id] < minValor && minValor > 0){
        // Si ingresó un valor menor al mínimo razonable, advertir pero no bloquear
        var ctxEl = document.getElementById('sv-c');
        if(ctxEl){
          ctxEl.innerHTML = '⚠️ <strong>Valor por debajo del rango sugerido</strong> ('+ (s.prefix||'$')+minValor.toLocaleString('es-CO')+(s.unit||'M')+'). Confirma que es correcto.';
        }
      }
    });

    // Estado inicial del botón
    if(sliderValues[q.id]!==undefined){
      document.getElementById('btn-next').disabled = false;
      document.getElementById('skip-hint').textContent = '';
    } else {
      document.getElementById('btn-next').disabled = true;
      document.getElementById('skip-hint').textContent = 'Ingresa un valor para continuar';
    }

    // Auto-focus para que el usuario empiece a escribir directamente
    setTimeout(function(){ try { inp.focus(); } catch(e){} }, 100);

  } else {
    var h='<div class="options">';
    q.opts.forEach(function(o,i){
      h+='<div class="option'+(answers[q.id]===i?' selected':'')+'" onclick="selOpt('+i+')"><div class="option-radio"></div><span class="option-text">'+o.text+'</span></div>';
    });
    h+='</div>';
    area.innerHTML=h;
    document.getElementById('btn-next').disabled=answers[q.id]===undefined;
    document.getElementById('skip-hint').textContent=answers[q.id]!==undefined?'':'Selecciona una opción';
  }
  document.getElementById('btn-back').style.visibility=current===0?'hidden':'visible';
  document.getElementById('btn-next').textContent=current===tot-1?'Ver mi diagnóstico →':'Siguiente →';
  requestAnimationFrame(function(){requestAnimationFrame(function(){
    sl.classList.add('visible');
    card.classList.add('visible');
  })});
}

function sFill(s){
  var p=((s.value-s.min)/(s.max-s.min))*100;
  s.style.background='linear-gradient(to right,var(--gold) 0%,var(--gold) '+p+'%,rgba(255,255,255,.1) '+p+'%,rgba(255,255,255,.1) 100%)';
}

function selOpt(i){
  answers[questionSequence[current].id]=i;
  document.querySelectorAll('.option').forEach(function(el,idx){
    el.classList.toggle('selected',idx===i);
  });
  document.getElementById('btn-next').disabled=false;
  document.getElementById('skip-hint').textContent='';
}

// Helper para que el botón "Volver a corregir gastos" funcione desde el HTML inline
function volverAGastos(){
  var idxGastos=questionSequence.findIndex(function(qq){return qq.id==='n2';});
  if(idxGastos>=0){current=idxGastos;renderQ();}
}

// ═══════════════════════════════════════════════════════════════════════
// VALIDACIÓN CRUZADA AL AVANZAR
// ═══════════════════════════════════════════════════════════════════════
function goNext(){
  var q=questionSequence[current];
  if(q.type==='choice'&&answers[q.id]===undefined)return;
  // Para number_input, exigir valor ingresado (no permitir avanzar con campo vacío)
  if(q.type==='number_input'&&sliderValues[q.id]===undefined)return;

  // Validación: ingresos totales ≥ gastos (al terminar de contestar ingreso pasivo)
  // v4: NO usar confirm() — mostrar mensaje inline bajo la pregunta y bloquear avance
  if(q.id==='np'){
    var gastos=sliderValues.n2||0;
    var activo=sliderValues.n3e||sliderValues.n3p||0;
    var pasivo=sliderValues.np||0;
    if(activo+pasivo<gastos){
      var ctxEl = document.getElementById('sv-c');
      if(ctxEl){
        ctxEl.innerHTML =
          '<div class="inline-warning">'+
            '<strong>⚠ Datos por revisar:</strong> tus ingresos totales suman <strong>$'+(activo+pasivo)+'M/mes</strong> pero tus gastos son <strong>$'+gastos+'M/mes</strong>. Esto no es sostenible. '+
            '<button type="button" class="inline-warning-link" onclick="volverAGastos()">Volver a corregir gastos →</button>'+
          '</div>';
      }
      return; // bloquea avance
    }
  }

  if(current<questionSequence.length-1){
    current++;
    renderQ();
  } else {
    showCap();
  }
}

function goBack(){
  if(current>0){current--;renderQ();}
}

function showCap(){
  document.getElementById('question-screen').style.display='none';
  document.getElementById('capture-screen').style.display='block';
}

// ═══════════════════════════════════════════════════════════════════════
// REINICIAR EL TEST (botón "Hacer el test nuevamente")
// ═══════════════════════════════════════════════════════════════════════
function restartTest(){
  // Resetear todas las variables de estado
  selectedProfile = null;
  questionSequence = [];
  current = 0;
  answers = {};
  sliderValues = {};

  // Ocultar todas las pantallas y mostrar la inicial
  ['profile-screen','question-screen','capture-screen','result-screen'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.style.display = 'none';
  });
  var startScreen = document.getElementById('start-screen');
  if(startScreen) startScreen.style.display = 'block';

  // Limpiar selección visual de tarjetas de perfil
  ['card-empresario','card-profesional'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.classList.remove('selected');
  });

  // Limpiar campos del formulario de captura
  ['cap-nombre','cap-email','cap-whatsapp'].forEach(function(id){
    var el = document.getElementById(id);
    if(el){ el.value = ''; el.classList.remove('error'); }
  });

  // Resetear botones
  var btnProfile = document.getElementById('btn-profile-next');
  if(btnProfile) btnProfile.disabled = true;
  var btnCapture = document.getElementById('btn-capture');
  if(btnCapture) btnCapture.disabled = false;

  // Ocultar mensajes de error/estado
  var errBox = document.getElementById('capture-errors');
  if(errBox){ errBox.style.display = 'none'; errBox.innerHTML = ''; }
  var statusBox = document.getElementById('capture-status');
  if(statusBox) statusBox.classList.remove('visible');

  // Scroll al inicio
  window.scrollTo({top:0, behavior:'smooth'});
}

// ═══════════════════════════════════════════════════════════════════════
// MOTOR DE CÁLCULO V2
// ═══════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════
// VALIDACIÓN DE COHERENCIA DE DATOS
// ═══════════════════════════════════════════════════════════════════════
// Detecta inconsistencias estructurales antes de calcular y guardar en Firestore.
// Aunque los sliders limitan los rangos dinámicamente, el usuario puede regresar
// y modificar valores anteriores rompiendo la coherencia.
function validarDatos(){
  var sv = sliderValues, errores = [];

  // Campos obligatorios (slider numérico)
  if(sv.n2 == null) errores.push('Falta: gastos mensuales');
  if(selectedProfile==='empresario' && sv.n3e == null) errores.push('Falta: ingreso activo');
  if(selectedProfile==='profesional' && sv.n3p == null) errores.push('Falta: ingreso activo');
  if(sv.np == null) errores.push('Falta: ingreso pasivo');
  if(sv.nl == null) errores.push('Falta: activos líquidos');
  if(sv.nn == null) errores.push('Falta: activos no líquidos');
  if(sv.n4 == null) errores.push('Falta: capital improductivo');
  if(sv.n5 == null) errores.push('Falta: % en pesos colombianos');
  if(sv.nd == null) errores.push('Falta: deuda total');
  if(sv.ndc == null) errores.push('Falta: deuda de consumo');

  // Si faltan obligatorios, parar acá
  if(errores.length > 0) return { valido:false, errores:errores };

  // Validaciones cruzadas
  var gastos = sv.n2;
  var ingActivo = selectedProfile==='empresario' ? sv.n3e : sv.n3p;
  var pasivo = sv.np;

  if(ingActivo + pasivo < gastos){
    errores.push('Ingresos totales ($'+(ingActivo+pasivo)+'M) menores a gastos ($'+gastos+'M).');
  }
  if(sv.n4 > sv.nl){
    errores.push('Capital improductivo ($'+sv.n4+'M) mayor que activos líquidos ($'+sv.nl+'M).');
  }
  if(sv.ndc > sv.nd){
    errores.push('Deuda de consumo ($'+sv.ndc+'M) mayor que deuda total ($'+sv.nd+'M).');
  }
  if(sv.nl + sv.nn < 50){
    errores.push('Patrimonio total ($'+(sv.nl+sv.nn)+'M) parece muy bajo. Revisa los valores ingresados.');
  }

  // Respuestas de opción múltiple obligatorias
  var requiredChoices = selectedProfile==='empresario'
    ? ['f1e','f2e','inv','strat','c2e']
    : ['f1p','inv','strat'];
  requiredChoices.forEach(function(id){
    if(answers[id]===undefined) errores.push('Falta responder: '+id);
  });

  return { valido: errores.length===0, errores: errores };
}

function calcSc(){
  var t=0;
  questionSequence.forEach(function(q){
    if(q.type==='choice'&&answers[q.id]!==undefined)t+=q.opts[answers[q.id]].pts;
  });
  return t;
}

function aPts(id){
  var q=questionSequence.find(function(qq){return qq.id===id;});
  if(q&&q.type==='choice'&&answers[id]!==undefined)return q.opts[answers[id]].pts;
  return -1;
}

function calcMotorV2(){
  // ── Conversión a COP absolutos ──
  var gastos_mes = (sliderValues.n2||0)*1e6;
  var gastos_anuales = gastos_mes*12;
  var ingreso_activo_mes = ((selectedProfile==='empresario'?sliderValues.n3e:sliderValues.n3p)||0)*1e6;
  var ingreso_pasivo_mes = (sliderValues.np||0)*1e6;

  var liquidos = (sliderValues.nl||0)*1e6;
  var no_liquidos = (sliderValues.nn||0)*1e6;
  var improductivo = (sliderValues.n4||0)*1e6;
  var deuda_total = (sliderValues.nd||0)*1e6;
  var deuda_consumo = (sliderValues.ndc||0)*1e6;
  var pct_cop = (sliderValues.n5||0)/100;
  // f3e ahora es MONTO en millones de empresa dentro de no_liquidos (no %)
  var empresa_monto = selectedProfile==='empresario'?(sliderValues.f3e||0)*1e6:0;
  var pct_fuente_unica = selectedProfile==='profesional'?(sliderValues.f3p||0):null;

  // ── Derivados ──
  var patrimonio_bruto = liquidos+no_liquidos;
  var patrimonio_neto = patrimonio_bruto-deuda_total;
  // pct_empresa = empresa / patrimonio_bruto (para coherencia con resto del cálculo)
  var pct_empresa = patrimonio_bruto > 0 ? empresa_monto / patrimonio_bruto : 0;
  // Colchón de emergencia según perfil (6 prof / 9 emp), no fijo en 3 meses
  var meta_meses_perfil = selectedProfile==='empresario'?9:6;
  var colchon = Math.min(improductivo, gastos_mes*meta_meses_perfil);
  var capital_reasignable = Math.max(0, improductivo-colchon);

  // ═══ NÚMERO 1: PÉRDIDA REAL ANUAL ═══
  var erosion_real = Math.round(improductivo*(INFL-T_AHORRO));
  var impuesto_patrimonio = calcImpPat(patrimonio_bruto, deuda_total);
  var subtotal_perdidas = erosion_real+impuesto_patrimonio;

  // ═══ NÚMERO 2: OPORTUNIDAD ANUAL ═══
  var puntos_inv = aPts('inv');
  if(puntos_inv<0)puntos_inv=2;
  var tasa_actual = puntos_inv>=3?T_FONDO:puntos_inv===2?0.065:puntos_inv===1?T_CDT:T_AHORRO;
  var diferencial = Math.max(0, T_FONDO-tasa_actual);
  var costo_oportunidad = Math.round(capital_reasignable*diferencial);

  // v5: exposición cambiaria sobre SOLO LÍQUIDOS (ambos perfiles).
  // Razón: la empresa y los inmuebles no son activos monetarios directos —
  // su valor se ajusta a la inflación local o al flujo que generan, no se
  // devalúan automáticamente con el tipo de cambio. Solo activos monetarios
  // líquidos en COP pierden poder adquisitivo frente al USD.
  // La pregunta n5 sigue refiriéndose al patrimonio total (informativa para
  // el usuario), pero la cifra de pérdida solo aplica sobre líquidos.
  var liquidos_en_cop = liquidos*pct_cop;
  var liquidos_en_otras = liquidos - liquidos_en_cop;
  var exposicion_cambiaria = pct_cop>=0.70?Math.round(liquidos_en_cop*DEVAL):0;

  var subtotal_oportunidad = costo_oportunidad+exposicion_cambiaria;

  // ═══ TOTAL ═══
  var total_anual = subtotal_perdidas+subtotal_oportunidad;

  // ═══ INDICADORES ═══
  var numero_magico = gastos_anuales/TASA_RETIRO_IF;
  var portafolio_productivo = Math.max(0, liquidos-improductivo);
  var avance_if_pct = numero_magico>0?(portafolio_productivo/numero_magico)*100:0;
  var gap_mensual_if = Math.max(0, gastos_mes-ingreso_pasivo_mes);

  var meta_meses = selectedProfile==='empresario'?9:6;
  var fondo_ideal = gastos_mes*meta_meses;
  var meses_cubiertos = gastos_mes>0?liquidos/gastos_mes:0;
  var gap_fondo = Math.max(0, fondo_ideal-liquidos);

  var pct_liquido = patrimonio_bruto>0?(liquidos/patrimonio_bruto)*100:0;
  var pct_iliquido = patrimonio_bruto>0?(no_liquidos/patrimonio_bruto)*100:0;

  var ratio_deuda = patrimonio_bruto>0?(deuda_total/patrimonio_bruto)*100:0;
  var pct_consumo = deuda_total>0?(deuda_consumo/deuda_total)*100:0;

  // ═══ SCORING ═══
  var scoreTotal=0,scoreMax=0;
  var scoresPorCapa={estructura_fiscal:0, crecimiento:0};
  var capaPorPregunta={f1e:'estructura_fiscal',f1p:'estructura_fiscal',f2e:'estructura_fiscal',inv:'estructura_fiscal',
                       strat:'crecimiento',c2e:'crecimiento'};

  questionSequence.forEach(function(q){
    if(q.type!=='choice')return;
    var a=answers[q.id];
    if(a===undefined)return;
    var pts=q.opts[a].pts;
    scoreTotal+=pts;
    scoreMax+=3;
    var capa=capaPorPregunta[q.id];
    if(capa)scoresPorCapa[capa]+=pts;
  });

  // Bonus por % fuente única (profesional) o % empresa (empresario)
  if(selectedProfile==='profesional'&&pct_fuente_unica!==null){
    var sFuente = pct_fuente_unica>=100?0:pct_fuente_unica>=80?1:pct_fuente_unica>=60?2:3;
    scoreTotal+=sFuente;
    scoreMax+=3;
    scoresPorCapa.crecimiento+=sFuente;
  }
  if(selectedProfile==='empresario'&&pct_empresa>0){
    var sEmp = pct_empresa>=0.80?0:pct_empresa>=0.60?1:pct_empresa>=0.40?2:3;
    scoreTotal+=sEmp;
    scoreMax+=3;
    scoresPorCapa.crecimiento+=sEmp;
  }

  var niveles=NIVELES[selectedProfile]||NIVELES.profesional;
  var nivel=niveles.find(function(n){return scoreTotal>=n.min&&scoreTotal<=n.max;})||niveles[0];

  // ═══ DIAGNÓSTICO DOMINANTE ═══
  var pctReasignable = patrimonio_bruto>0?capital_reasignable/patrimonio_bruto:0;
  var ratioPasivo = gastos_mes>0?ingreso_pasivo_mes/gastos_mes:0;
  var tieneImproductivoFuerte = pctReasignable>0.30;
  var tieneCambiarioFuerte = pct_cop>0.80&&liquidos>1e9;
  var dx;
  if(tieneImproductivoFuerte&&tieneCambiarioFuerte){
    dx={tipo:'capital_y_cambiario',
        titulo:'Tienes '+fmtM(capital_reasignable)+' que no te rinden + '+Math.round(pct_cop*100)+'% de tu dinero en pesos',
        texto:'Casi la mitad de tu dinero líquido está en cuentas o CDTs que no te generan ingresos, y casi todo está en una sola moneda. Los dos problemas juntos convierten tu plata parada en pérdida lenta y constante, año tras año.'};
  } else if(tieneImproductivoFuerte){
    dx={tipo:'capital_improductivo',
        titulo:'Tienes '+fmtM(capital_reasignable)+' que no te están rindiendo',
        texto:'Una parte importante de tu patrimonio líquido está en instrumentos de bajo rendimiento. Ese dinero, reasignado, podría generar ingresos en lugar de perder valor por inflación.'};
  } else if(tieneCambiarioFuerte){
    dx={tipo:'concentracion_cambiaria',
        titulo:Math.round(pct_cop*100)+'% de tu dinero está en pesos colombianos',
        texto:'Tu liquidez está concentrada en una sola moneda. Con devaluación promedio del 4% anual, la exposición es de '+fmtM(exposicion_cambiaria)+' al año en poder de compra.'};
  } else if(ratioPasivo<0.30 && meses_cubiertos<6){
    dx={tipo:'dependencia_ingreso',
        titulo:'Dependes demasiado de tu ingreso activo',
        texto:'Tus ingresos pasivos cubren solo el '+Math.round(ratioPasivo*100)+'% de tus gastos y tu liquidez te alcanza para '+(Math.round(meses_cubiertos*10)/10)+' meses. La combinación es frágil: cualquier interrupción del ingreso activo te pone en aprietos rápido.'};
  } else if(impuesto_patrimonio>0){
    dx={tipo:'impuesto_patrimonio',
        titulo:'Tu patrimonio paga '+fmtM(impuesto_patrimonio)+' en impuesto al patrimonio',
        texto:'Estás en el rango del Art. 296-3 ET. Hay estructuras legales que reducen la base gravable sin afectar el control de tus activos.'};
  } else if(pct_iliquido>80){
    dx={tipo:'concentracion_iliquida',
        titulo:Math.round(pct_iliquido)+'% de tu patrimonio está atrapado en activos no líquidos',
        texto:'Tu patrimonio existe pero no responde rápido. Hay vehículos que liberan liquidez sin vender los activos.'};
  } else {
    dx={tipo:'general',
        titulo:'Oportunidades de ajuste identificadas',
        texto:'Tu estructura tiene ajustes finos que en conjunto representan '+fmtM(total_anual)+' al año. Individualmente pequeños, pero compuestos marcan diferencia.'};
  }

  // ═══ VULNERABILIDADES ═══
  var vulnerabilidades=[];
  questionSequence.forEach(function(q){
    if(q.type!=='choice'||!q.vuln)return;
    var a=answers[q.id];
    if(a!==undefined&&q.opts[a].pts<=q.vuln.threshold){
      vulnerabilidades.push({
        tipo:q.id,
        titulo:q.vuln.titulo||q.vuln.title,
        severidad:q.vuln.severidad||'media'
      });
    }
  });
  // v4: dependencia es señal SOLO si pasivos < 30% Y autonomía < 6 meses
  // (alguien con 5 años de liquidez no es "dependiente del ingreso activo")
  if(ratioPasivo<0.30 && meses_cubiertos<6){
    vulnerabilidades.push({tipo:'dependencia_activo',titulo:'Dependes mucho de tu ingreso activo',severidad:'media'});
  }
  if(pct_iliquido>80){
    vulnerabilidades.push({tipo:'concentracion_iliquida',titulo:'Patrimonio atrapado en activos no líquidos',severidad:'media'});
  }
  // Ordenar por severidad
  var orden={alta:0,media:1,baja:2};
  vulnerabilidades.sort(function(a,b){return orden[a.severidad]-orden[b.severidad];});
  vulnerabilidades=vulnerabilidades.slice(0,5);

  // ═══ RESULTADO FINAL ═══
  return {
    perfil:selectedProfile,
    score_total:scoreTotal,
    score_max:scoreMax,
    scores_por_capa:scoresPorCapa,
    nivel:nivel.label,
    nivel_color:nivel.color,
    nivel_gauge:nivel.gauge,
    calculos:{
      erosion_real:erosion_real,
      impuesto_patrimonio:impuesto_patrimonio,
      subtotal_perdidas:subtotal_perdidas,
      costo_oportunidad:costo_oportunidad,
      exposicion_cambiaria:exposicion_cambiaria,
      subtotal_oportunidad:subtotal_oportunidad,
      total_anual:total_anual,
      total_mensual:Math.round(total_anual/12),
      patrimonio_bruto:Math.round(patrimonio_bruto),
      patrimonio_neto:Math.round(patrimonio_neto),
      capital_reasignable:Math.round(capital_reasignable),
      colchon:Math.round(colchon),
      improductivo:Math.round(improductivo),
      tasa_actual_estimada:tasa_actual,
      meses_autonomia:Math.round(meses_cubiertos*10)/10,
      gastos_mes:gastos_mes,
      ingreso_activo_mes:ingreso_activo_mes,
      ingreso_pasivo_mes:ingreso_pasivo_mes,
      pct_cop:pct_cop,
      pct_iliquido:pct_iliquido/100
    },
    indicadores:{
      independencia_financiera:{
        numero_magico:Math.round(numero_magico),
        portafolio_productivo:Math.round(portafolio_productivo),
        avance_pct:Math.round(avance_if_pct*10)/10,
        gap_mensual:Math.round(gap_mensual_if),
        ingreso_pasivo_mes:Math.round(ingreso_pasivo_mes)
      },
      fondo_emergencia:{
        fondo_ideal:Math.round(fondo_ideal),
        liquidez_actual:Math.round(liquidos),
        meses_cubiertos:Math.round(meses_cubiertos*10)/10,
        meta_meses:meta_meses,
        gap:Math.round(gap_fondo)
      },
      concentracion:{
        monto_liquido:Math.round(liquidos),
        monto_iliquido:Math.round(no_liquidos),
        pct_liquido:Math.round(pct_liquido*10)/10,
        pct_iliquido:Math.round(pct_iliquido*10)/10
      },
      capital_productivo:{
        improductivo:Math.round(improductivo),
        productivo:Math.round(portafolio_productivo),
        reasignable:Math.round(capital_reasignable),
        pct_improductivo:liquidos>0?Math.round((improductivo/liquidos)*100):0
      },
      exposicion_moneda:{
        liquidos_cop:Math.round(liquidos_en_cop),
        liquidos_otras:Math.round(liquidos_en_otras),
        pct_cop:Math.round(pct_cop*100),
        perdida_anual_estimada:exposicion_cambiaria
      },
      deuda:{
        deuda_total:Math.round(deuda_total),
        deuda_consumo:Math.round(deuda_consumo),
        patrimonio_neto:Math.round(patrimonio_neto),
        ratio_deuda_pct:Math.round(ratio_deuda*10)/10,
        pct_consumo:Math.round(pct_consumo*10)/10
      }
    },
    diagnostico_dominante:dx,
    vulnerabilidades_detectadas:vulnerabilidades
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SELECCIÓN DE CTA DINÁMICO
// ═══════════════════════════════════════════════════════════════════════
function seleccionarCTA(R){
  var c=R.calculos;
  var ind=R.indicadores;
  var pctReasignable = c.patrimonio_bruto>0?c.capital_reasignable/c.patrimonio_bruto:0;
  var pctCop = c.pct_cop;
  var ratioPasivo = c.gastos_mes>0?c.ingreso_pasivo_mes/c.gastos_mes:0;

  var tieneImproductivoFuerte = pctReasignable>0.30;
  var tieneCambiarioFuerte = pctCop>0.80&&ind.concentracion.monto_liquido>1e9;
  var tieneFiscal = c.impuesto_patrimonio>0;
  var tieneDependencia = R.diagnostico_dominante.tipo==='dependencia_ingreso';

  // CAT 1: Capital mal estructurado
  if(tieneImproductivoFuerte&&tieneCambiarioFuerte){
    return {
      categoria:'CAT_1_CAPITAL', sub_variante:'combinado',
      eyebrow:'Dos problemas juntos',
      headline:fmtM(c.capital_reasignable)+' que no te rinden + '+Math.round(pctCop*100)+'% en pesos. Juntos te cuestan '+fmtM(c.subtotal_oportunidad)+'/año.',
      body:'Tu dinero líquido tiene dos problemas al mismo tiempo: una parte no te rinde y casi todo está en pesos. El costo combinado es real y se puede recuperar moviendo el dinero a donde sí trabaje para ti.',
      features:['Qué mover y dónde ponerlo','Cómo diversificar en dólares sin complicaciones','Orden de los movimientos para no pagar más impuestos'],
      button:'Recuperar mis '+fmtM(c.subtotal_oportunidad)+'/año'
    };
  }
  if(tieneImproductivoFuerte){
    return {
      categoria:'CAT_1_CAPITAL', sub_variante:'improductivo',
      eyebrow:'Dinero que no te rinde',
      headline:'Tienes '+fmtM(c.capital_reasignable)+' rindiendo menos que la inflación. Eso cuesta '+fmtM(c.subtotal_oportunidad)+'/año.',
      body:'Una parte importante de tu patrimonio líquido está en cuentas o CDTs de bajo rendimiento. Ese dinero, reasignado, puede generar ingresos en lugar de perder valor.',
      features:['Qué instrumentos te convienen según tu perfil','Plan de acción priorizado por impacto','Cómo mover sin pagar más impuestos'],
      button:'Mover mis '+fmtM(c.capital_reasignable)
    };
  }
  if(tieneCambiarioFuerte){
    return {
      categoria:'CAT_1_CAPITAL', sub_variante:'cambiario',
      eyebrow:'Todo en una sola moneda',
      headline:'El '+Math.round(pctCop*100)+'% de tu dinero está en pesos. Pérdida estimada: '+fmtM(c.exposicion_cambiaria)+'/año.',
      body:'Tu liquidez está concentrada en una sola moneda en un país con devaluación histórica del 4% anual. Diversificar cambiariamente no es opinión — es protección.',
      features:['Vehículos legales disponibles en Colombia','Cómo abrir cuentas en USD sin complicaciones','Plan de ejecución priorizado'],
      button:'Diversificar en dólares'
    };
  }

  // CAT 2: Estructura fiscal
  if(tieneFiscal){
    return {
      categoria:'CAT_2_FISCAL', sub_variante:'impuesto_patrimonio',
      eyebrow:'Impuesto al patrimonio 2026',
      headline:'Tu patrimonio supera el umbral. Pagas '+fmtM(c.impuesto_patrimonio)+'/año en impuesto al patrimonio.',
      body:'Con patrimonio líquido de '+fmtM(c.patrimonio_bruto)+', estás en el régimen permanente del Art. 296-3 ET. Hay estructuras legales que reducen la base gravable sin afectar el control de tus activos.',
      features:['Cálculo exacto con tu declaración 2025','Estructuras de exclusión aplicables','Calendario de acción antes del vencimiento'],
      button:'Revisar mi base gravable 2026'
    };
  }
  var tieneSenalFiscal = R.vulnerabilidades_detectadas.some(function(v){return v.tipo==='f1p'||v.tipo==='f1e';});
  if(tieneSenalFiscal){
    if(selectedProfile==='empresario'){
      return {
        categoria:'CAT_2_FISCAL', sub_variante:'retiro_empresa',
        eyebrow:'Esquema de retiro sin optimizar',
        headline:'Sacas dinero de tu empresa sin una estrategia definida.',
        body:'La mezcla entre salario, honorarios y dividendos no es decorativa — es lo que determina cuánto llega realmente a tu bolsillo. Hay estructuras del Art. 242 ET que pueden ahorrarte entre 15% y 30% anual.',
        features:['Estructura óptima salario + dividendos','Impacto proyectado en renta personal','Plan de implementación fase por fase'],
        button:'Estructurar mi retiro de utilidades'
      };
    } else {
      return {
        categoria:'CAT_2_FISCAL', sub_variante:'profesional',
        eyebrow:'Estructura fiscal sin revisar',
        headline:'Nadie ha revisado si estás pagando renta de más.',
        body:'Con tu nivel de ingreso, la diferencia entre una declaración pasiva y una estructurada puede ser de varios millones al año. El test no calcula esta cifra porque requiere tus datos fiscales reales. En la sesión sí.',
        features:['Revisión de tu última declaración de renta','Estrategias Art. 206 ET aplicables a tu caso','Plan fiscal para 2026'],
        button:'Calcular mi sobrecarga fiscal real'
      };
    }
  }

  // CAT 3: Fragilidad de flujo
  if(tieneDependencia||ind.concentracion.pct_iliquido>80){
    var ratioPasivoPct = Math.round(ratioPasivo*100);
    return {
      categoria:'CAT_3_FRAGILIDAD', sub_variante:'dependencia',
      eyebrow:'Fragilidad de flujo',
      headline:'Si dejas de trabajar, tu liquidez dura '+c.meses_autonomia+' meses.',
      body:'Tus ingresos pasivos cubren solo el '+ratioPasivoPct+'% de tus gastos. El resto depende de que sigas generando ingreso activo.',
      features:['Cálculo de tu número mágico real','Estrategia para cerrar el faltante de '+fmtM(ind.independencia_financiera.gap_mensual)+'/mes','Secuencia de inversión para los próximos 5 años'],
      button:'Diseñar mi ruta a vivir de inversiones'
    };
  }

  // CAT 4: Arquitectura ausente (fallback)
  if(R.nivel==='Arquitectura Sólida'){
    return {
      categoria:'CAT_4_ARQUITECTURA', sub_variante:'afinacion',
      eyebrow:'Afinación de arquitectura',
      headline:'Buena estructura sobre '+fmtM(c.patrimonio_bruto)+'. Aún hay '+fmtM(c.total_anual)+'/año en afinación fina.',
      body:'El diagnóstico muestra una base sólida, pero en el rango donde estás, la diferencia entre bueno y excelente se mide en decisiones de detalle. Compuesto a 10 años, '+fmtM(c.total_anual)+' anuales son una cifra que cambia las proyecciones.',
      features:['Revisión crítica de tu estructura actual','Oportunidades de optimización fina','Proyección a 10 años con y sin ajustes'],
      button:'Afinar mi arquitectura patrimonial'
    };
  }
  return {
    categoria:'CAT_4_ARQUITECTURA', sub_variante:'construccion',
    eyebrow:'Estructura en construcción',
    headline:'Base financiera estable, estructura aún incompleta. Brecha medible: '+fmtM(c.total_anual)+'/año.',
    body:'Tienes una base sólida — '+c.meses_autonomia+' meses de autonomía, deuda controlada — pero la estructura de crecimiento no está definida. El costo de no terminar de construirla son '+fmtM(c.total_anual)+' anuales que hoy no se recuperan.',
    features:['Auditoría de tu estructura actual','Plan priorizado para completar la arquitectura','Proyección con y sin ajustes'],
    button:'Completar mi arquitectura patrimonial'
  };
}

// ═══════════════════════════════════════════════════════════════════════
// HELPERS DE FORMATO
// ═══════════════════════════════════════════════════════════════════════
// Política de formato (v3): SIEMPRE en millones COP con punto de mil.
// Nunca usar "mil M" ni "K" — son ambiguos para el usuario.
//   $895       → "$895M"
//   $1.500     → "$1.500M"
//   $12.345    → "$12.345M"
//   $5.100     → "$5.100M"  (no "$5.1 mil M")
function fmt(n){
  if(n<0)n=0;
  // n viene en pesos absolutos (ej. 36700000). Lo pasamos a millones.
  var m = Math.round(n/1e6);
  return '$'+m.toLocaleString('es-CO')+'M';
}
function fmtM(cop){
  if(cop<0)cop=0;
  var m = Math.round(cop/1e6);
  return '$'+m.toLocaleString('es-CO')+'M';
}
function pF(n){return(n*100).toFixed(1)+'%';}

// ═══════════════════════════════════════════════════════════════════════
// CAPTURE Y GUARDADO EN FIRESTORE
// ═══════════════════════════════════════════════════════════════════════
async function submitCapture(){
  var nom=document.getElementById('cap-nombre').value.trim();
  var em=document.getElementById('cap-email').value.trim();
  var wa=document.getElementById('cap-whatsapp').value.trim();

  // Limpiar errores previos
  ['cap-nombre','cap-email','cap-whatsapp'].forEach(function(id){
    var el=document.getElementById(id);
    if(el)el.classList.remove('error');
  });
  // v4: si no existe el contenedor #capture-errors, lo creamos dinámicamente
  // bajo el campo de WhatsApp para que SIEMPRE se muestre inline (nunca alert).
  var errBox=document.getElementById('capture-errors');
  if(!errBox){
    errBox = document.createElement('div');
    errBox.id = 'capture-errors';
    errBox.className = 'capture-errors';
    var anchor = document.getElementById('cap-whatsapp');
    if(anchor && anchor.parentNode){
      // Insertar después del input de WhatsApp (al final del bloque de inputs)
      anchor.parentNode.parentNode.insertBefore(errBox, anchor.parentNode.nextSibling);
    } else {
      // Fallback: añadir al final del capture-screen
      var screen = document.getElementById('capture-screen');
      if(screen) screen.appendChild(errBox);
    }
  }
  errBox.style.display='none';
  errBox.innerHTML='';

  function mostrarError(mensaje){
    errBox.style.display='block';
    errBox.innerHTML=mensaje;
    // Hacer scroll visible para que el usuario vea el error
    try { errBox.scrollIntoView({behavior:'smooth', block:'center'}); } catch(e){}
  }

  // ─── Validación nombre ───
  if(!nom||nom.length<2){
    document.getElementById('cap-nombre').classList.add('error');
    mostrarError('Ingresa tu nombre completo.');
    return;
  }
  // ─── Validación email ───
  if(!em||!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)){
    document.getElementById('cap-email').classList.add('error');
    mostrarError('Revisa tu correo electrónico — parece tener un error de escritura.');
    return;
  }
  // ─── Validación WhatsApp Colombia (10 dígitos, empieza por 3) ───
  var waDigits=(wa||'').replace(/\D/g,'');
  if(waDigits.length===12&&waDigits.startsWith('57'))waDigits=waDigits.slice(2);
  var waEl=document.getElementById('cap-whatsapp');
  if(waEl){
    if(waDigits.length!==10||!waDigits.startsWith('3')){
      waEl.classList.add('error');
      mostrarError('El WhatsApp debe tener 10 dígitos y empezar por 3 (ej: 3001234567).');
      return;
    }
  }

  // ─── Validación de coherencia de datos del test ───
  var validacion = validarDatos();
  if(!validacion.valido){
    var listaErrores='<strong>Hay datos que revisar:</strong><ul style="margin:8px 0 0 20px;padding:0;">';
    validacion.errores.forEach(function(e){listaErrores+='<li>'+e+'</li>';});
    listaErrores+='</ul>';
    mostrarError(listaErrores);
    console.warn('Validación falló:', validacion.errores);
    return;
  }

  document.getElementById('btn-capture').disabled=true;
  document.getElementById('capture-status').classList.add('visible');

  // Calcular con motor v2
  var R = calcMotorV2();
  var cta = seleccionarCTA(R);

  // ── Lead object — esquema v2 ──
  var lead = {
    nombre: nom,
    email: em.toLowerCase(),
    whatsapp: waDigits.length===10?'+57'+waDigits:null,
    perfil: selectedProfile,
    score_total: R.score_total,
    score_max: R.score_max,
    nivel: R.nivel,
    scores_por_capa: R.scores_por_capa,
    numeros_reales: {
      gastos_mes_m:     sliderValues.n2 || 0,
      ingreso_activo_m: (selectedProfile==='empresario'?sliderValues.n3e:sliderValues.n3p) || 0,
      ingreso_pasivo_m: sliderValues.np || 0,
      liquidos_m:       sliderValues.nl || 0,
      improductivo_m:   sliderValues.n4 || 0,
      no_liquidos_m:    sliderValues.nn || 0,
      deuda_total_m:    sliderValues.nd || 0,
      deuda_consumo_m:  sliderValues.ndc || 0,
      pct_cop_liquido:  sliderValues.n5 || 0,
      pct_empresa:      selectedProfile==='empresario' ? (sliderValues.f3e||null) : null,
      pct_fuente_unica: selectedProfile==='profesional' ? (sliderValues.f3p||null) : null
    },
    calculos: R.calculos,
    indicadores: R.indicadores,
    diagnostico_dominante: R.diagnostico_dominante,
    vulnerabilidades_detectadas: R.vulnerabilidades_detectadas,
    cta_mostrado: cta,
    // ── Compatibilidad con Cloud Functions email v1 (mientras se actualiza) ──
    costos_calculados: {
      total_anual:            R.calculos.total_anual,
      erosion_real:           R.calculos.erosion_real,
      costo_oportunidad:      R.calculos.costo_oportunidad,
      sobrecarga_fiscal:      0,
      impuesto_patrimonio:    R.calculos.impuesto_patrimonio,
      meses_autonomia:        R.calculos.meses_autonomia,
      exposicion_devaluacion: R.calculos.exposicion_cambiaria,
      liquidez:               R.indicadores.fondo_emergencia.liquidez_actual,
      numero_magico:          R.indicadores.independencia_financiera.numero_magico,
      patrimonio_en_riesgo:   0
    },
    origen: new URLSearchParams(window.location.search).get('origen')||'directo',
    agendo_calendly: false,
    estado: 'nuevo',
    timestamp: _db ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()
  };

  // ── Guardar en Firestore ──
  try {
    if(_db){
      var docRef = await _db.collection('leads_test').add(lead);
      console.log('✅ Lead guardado en Firestore. ID:', docRef.id);
    } else {
      var s = JSON.parse(localStorage.getItem('leads_test_v4')||'[]');
      lead.timestamp = new Date().toISOString();
      s.push(lead);
      localStorage.setItem('leads_test_v4', JSON.stringify(s));
      console.warn('⚠️ Firebase sin configurar — lead en localStorage');
    }
  } catch(e){
    console.error('❌ Error guardando lead:', e.message);
    try {
      var s2 = JSON.parse(localStorage.getItem('leads_test_v4')||'[]');
      lead.timestamp = new Date().toISOString();
      s2.push(lead);
      localStorage.setItem('leads_test_v4', JSON.stringify(s2));
    } catch(e2){}
  }

  document.getElementById('capture-status').classList.remove('visible');
  document.getElementById('capture-screen').style.display='none';
  showRes(nom, R, cta);
}

// ═══════════════════════════════════════════════════════════════════════
// PANTALLA DE RESULTADOS V2
// ═══════════════════════════════════════════════════════════════════════
function showRes(nombre, R, cta){
  document.getElementById('result-screen').style.display='block';

  if(!R) R = calcMotorV2();
  if(!cta) cta = seleccionarCTA(R);

  var c = R.calculos;
  var ind = R.indicadores;
  var nivel = (NIVELES[selectedProfile]||NIVELES.profesional).find(function(n){
    return R.score_total>=n.min&&R.score_total<=n.max;
  })||NIVELES.profesional[0];

  // ── Encabezado ──
  document.getElementById('score-max').textContent = R.score_max;
  document.getElementById('result-profile-tag').textContent =
    (nombre?nombre+' · ':'')+(selectedProfile==='empresario'?'Empresario':'Profesional');

  var cnt=0, sEl=document.getElementById('score-number');
  var iv=setInterval(function(){
    cnt++;
    sEl.textContent=cnt;
    if(cnt>=R.score_total)clearInterval(iv);
  }, R.score_total>0?Math.max(30,900/R.score_total):100);

  setTimeout(function(){
    document.getElementById('gauge-fill').style.width=(R.score_total/R.score_max*100)+'%';
  },200);
  document.getElementById('gauge-fill').style.background=
    'linear-gradient(90deg,'+nivel.gauge+','+nivel.gauge+'BB)';
  document.getElementById('result-diagnosis').textContent=R.nivel;
  document.getElementById('result-diagnosis').style.color=nivel.color;
  document.getElementById('result-desc').textContent = R.diagnostico_dominante.texto;

  // ── Total anual + desglose dos números ──
  document.getElementById('total-loss-number').textContent = fmtM(c.total_anual)+' / año';
  var subPartes=[];
  if(c.subtotal_perdidas>0) subPartes.push('lo que pierdes hoy: '+fmtM(c.subtotal_perdidas));
  if(c.subtotal_oportunidad>0) subPartes.push('lo que dejas de ganar: '+fmtM(c.subtotal_oportunidad));
  document.getElementById('total-loss-sub').textContent =
    (subPartes.length?subPartes.join(' + ')+'. ':'')+'Equivale a '+fmtM(c.total_mensual)+'/mes.';

  // ── Tarjetas de costos: dos columnas ──
  var g=document.getElementById('cost-grid'),h='';
  if(c.subtotal_perdidas>0){
    h+='<div class="cost-card red">';
    h+='<div class="cost-card-label red">Lo que pierdes hoy</div>';
    h+='<div class="cost-card-number">'+fmtM(c.subtotal_perdidas)+' / año</div>';
    h+='<div class="cost-card-sub">Dinero que sale de tu bolsillo cada año.</div>';
    h+='<div class="cost-detail">';
    if(c.erosion_real>0) h+='Tu dinero pierde valor por inflación: '+fmtM(c.erosion_real)+'<br>';
    if(c.impuesto_patrimonio>0) h+='Impuesto al patrimonio: '+fmtM(c.impuesto_patrimonio);
    // (Si impuesto_patrimonio === 0 no se muestra nada — no es información útil)
    h+='</div></div>';
  }
  if(c.subtotal_oportunidad>0){
    h+='<div class="cost-card orange">';
    h+='<div class="cost-card-label orange">Lo que dejas de ganar</div>';
    h+='<div class="cost-card-number">'+fmtM(c.subtotal_oportunidad)+' / año</div>';
    h+='<div class="cost-card-sub">Ingresos adicionales si tu dinero estuviera mejor estructurado.</div>';
    h+='<div class="cost-detail">';
    if(c.costo_oportunidad>0) h+='Mejor rendimiento posible: '+fmtM(c.costo_oportunidad)+'<br>';
    if(c.exposicion_cambiaria>0) h+='Pérdida por tener todo en pesos: '+fmtM(c.exposicion_cambiaria);
    h+='</div></div>';
  }
  g.innerHTML=h;

  // ═══ INDICADORES ═══
  var iG=document.getElementById('ind-grid'),iH='';

  // 1. Camino a vivir de tus inversiones
  var ifC = ind.independencia_financiera.avance_pct>=80?'green':
            ind.independencia_financiera.avance_pct>=40?'blue':
            ind.independencia_financiera.avance_pct>=15?'orange':'red';
  iH+='<div class="ind-card '+ifC+'">';
  iH+='<div class="ind-header"><div class="ind-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"/></svg></div>';
  iH+='<div class="ind-title">Camino a Vivir de tus Inversiones</div>';
  iH+='<span class="ind-badge">'+ind.independencia_financiera.avance_pct+'% recorrido</span></div>';
  iH+='<div class="ind-value">'+fmtM(ind.independencia_financiera.numero_magico)+'</div>';
  iH+='<div class="ind-desc">Ese es el patrimonio que necesitas tener invertido para cubrir tus '+fmtM(c.gastos_mes)+'/mes de gastos sin trabajar. ';
  if(ind.independencia_financiera.gap_mensual>0){
    iH+='Hoy tu dinero invertido genera <strong>'+fmtM(c.ingreso_pasivo_mes)+'/mes</strong> — te faltan <strong>'+fmtM(ind.independencia_financiera.gap_mensual)+'/mes</strong> para llegar.';
  } else {
    var exc=c.ingreso_pasivo_mes-c.gastos_mes;
    iH+='Tus ingresos pasivos cubren los gastos con un excedente de <strong>'+fmtM(exc)+'/mes</strong>.';
  }
  iH+='</div>';
  iH+='<div class="ind-bar-wrap"><div class="ind-bar" style="width:0%" data-w="'+Math.min(ind.independencia_financiera.avance_pct,100)+'"></div></div>';
  iH+='<div class="ind-detail"><div class="ind-detail-item"><div class="ind-detail-label">Dinero invertido hoy</div><div class="ind-detail-val">'+fmtM(ind.independencia_financiera.portafolio_productivo)+'</div></div>';
  iH+='<div class="ind-detail-item"><div class="ind-detail-label">Lo que te genera al mes</div><div class="ind-detail-val">'+fmtM(c.ingreso_pasivo_mes)+'</div></div></div></div>';

  // 2. Colchón para imprevistos
  var feR=ind.fondo_emergencia.meta_meses>0?(ind.fondo_emergencia.meses_cubiertos/ind.fondo_emergencia.meta_meses)*100:100;
  var feC=feR>=100?'green':feR>=50?'orange':'red';
  iH+='<div class="ind-card '+feC+'">';
  iH+='<div class="ind-header"><div class="ind-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L3 7v5c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V7L12 2z"/><path d="M9 12l2 2 4-4"/></svg></div>';
  iH+='<div class="ind-title">Colchón para Imprevistos</div>';
  iH+='<span class="ind-badge">'+Math.min(ind.fondo_emergencia.meses_cubiertos,99).toFixed(1)+' meses de colchón</span></div>';
  iH+='<div class="ind-value">'+(ind.fondo_emergencia.gap>0?'Te faltan '+fmtM(ind.fondo_emergencia.gap):'✓ Óptimo')+'</div>';
  iH+='<div class="ind-desc">';
  if(ind.fondo_emergencia.gap>0){
    iH+='Tus líquidos cubren <strong>'+ind.fondo_emergencia.meses_cubiertos+'</strong> meses. La meta recomendada son <strong>'+ind.fondo_emergencia.meta_meses+' meses</strong> para tu perfil.';
  } else {
    iH+='Tus '+fmtM(ind.fondo_emergencia.liquidez_actual)+' líquidos alcanzan para cubrir <strong>'+Math.min(ind.fondo_emergencia.meses_cubiertos,99).toFixed(1)+' meses</strong> de gastos. La meta recomendada son <strong>'+ind.fondo_emergencia.meta_meses+' meses</strong>. Tienes un colchón sólido.';
  }
  iH+='</div>';
  iH+='<div class="ind-bar-wrap"><div class="ind-bar" style="width:0%" data-w="'+Math.min(feR,100)+'"></div></div>';
  iH+='<div class="ind-detail"><div class="ind-detail-item"><div class="ind-detail-label">Lo recomendado ('+ind.fondo_emergencia.meta_meses+'m)</div><div class="ind-detail-val">'+fmtM(ind.fondo_emergencia.fondo_ideal)+'</div></div>';
  iH+='<div class="ind-detail-item"><div class="ind-detail-label">Lo que tienes hoy</div><div class="ind-detail-val">'+fmtM(ind.fondo_emergencia.liquidez_actual)+'</div></div></div></div>';

  // 3. Liquidez del Patrimonio
  var coC = ind.concentracion.pct_iliquido>85?'red':ind.concentracion.pct_iliquido>70?'orange':'green';
  iH+='<div class="ind-card '+coC+'">';
  iH+='<div class="ind-header"><div class="ind-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg></div>';
  iH+='<div class="ind-title">Liquidez del Patrimonio</div>';
  iH+='<span class="ind-badge">'+ind.concentracion.pct_liquido.toFixed(0)+'% disponible</span></div>';
  iH+='<div class="ind-value">'+(ind.concentracion.pct_iliquido>70?ind.concentracion.pct_iliquido.toFixed(0)+'% atrapado':'Bien balanceado')+'</div>';
  iH+='<div class="ind-desc">De tus '+fmtM(c.patrimonio_bruto)+' de patrimonio, el <strong>'+ind.concentracion.pct_liquido.toFixed(0)+'%</strong> lo puedes mover en menos de 30 días (cuentas, CDTs, fondos). El <strong>'+ind.concentracion.pct_iliquido.toFixed(0)+'%</strong> restante está en inmuebles y activos que tardan más en venderse.</div>';
  iH+='<div class="ind-bar-wrap"><div class="ind-bar" style="width:0%" data-w="'+ind.concentracion.pct_liquido+'"></div></div>';
  iH+='<div class="ind-detail"><div class="ind-detail-item"><div class="ind-detail-label">Dinero movible</div><div class="ind-detail-val">'+fmtM(ind.concentracion.monto_liquido)+'</div></div>';
  iH+='<div class="ind-detail-item"><div class="ind-detail-label">Inmuebles y otros</div><div class="ind-detail-val">'+fmtM(ind.concentracion.monto_iliquido)+'</div></div></div></div>';

  // 4. Cuánto de tu Dinero te Rinde
  if(ind.capital_productivo.improductivo>0||ind.concentracion.monto_liquido>0){
    var cpC = ind.capital_productivo.pct_improductivo>50?'red':ind.capital_productivo.pct_improductivo>25?'orange':'green';
    iH+='<div class="ind-card '+cpC+'">';
    iH+='<div class="ind-header"><div class="ind-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg></div>';
    iH+='<div class="ind-title">Cuánto de tu Dinero te Rinde</div>';
    iH+='<span class="ind-badge">'+ind.capital_productivo.pct_improductivo+'% sin rendir</span></div>';
    iH+='<div class="ind-value">'+(ind.capital_productivo.improductivo>0?fmtM(ind.capital_productivo.improductivo)+' sin rendir':'✓ Todo rinde')+'</div>';
    iH+='<div class="ind-desc">';
    if(ind.capital_productivo.improductivo>0){
      iH+='El <strong>'+ind.capital_productivo.pct_improductivo+'%</strong> de tus líquidos está en cuentas o CDTs que rinden menos que la inflación. De esos, <strong>'+fmtM(ind.capital_productivo.reasignable)+'</strong> los podrías mover hoy mismo a inversiones que sí te generen ingresos (dejando '+ind.fondo_emergencia.meta_meses+' meses de gastos como colchón de emergencia).';
    } else {
      iH+='Todo tu dinero líquido está rindiendo por encima de la inflación. Estructura sólida en este indicador.';
    }
    iH+='</div>';
    iH+='<div class="ind-bar-wrap"><div class="ind-bar" style="width:0%" data-w="'+(100-ind.capital_productivo.pct_improductivo)+'"></div></div>';
    iH+='<div class="ind-detail"><div class="ind-detail-item"><div class="ind-detail-label">Dinero que no rinde</div><div class="ind-detail-val">'+fmtM(ind.capital_productivo.improductivo)+'</div></div>';
    iH+='<div class="ind-detail-item"><div class="ind-detail-label">Listo para mover</div><div class="ind-detail-val">'+fmtM(ind.capital_productivo.reasignable)+'</div></div></div></div>';
  }

  // 5. Diversificación por Moneda
  // v5: la cifra de pérdida es sobre LÍQUIDOS (única exposición real al tipo de cambio)
  // aunque la pregunta n5 sea sobre patrimonio total (informativa)
  if(ind.exposicion_moneda.pct_cop>=50){
    var emC = ind.exposicion_moneda.pct_cop>=85?'red':ind.exposicion_moneda.pct_cop>=70?'orange':'blue';
    iH+='<div class="ind-card '+emC+'">';
    iH+='<div class="ind-header"><div class="ind-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></div>';
    iH+='<div class="ind-title">Diversificación por Moneda</div>';
    iH+='<span class="ind-badge">'+ind.exposicion_moneda.pct_cop+'% del patrimonio en pesos</span></div>';
    iH+='<div class="ind-value">'+fmtM(ind.exposicion_moneda.liquidos_cop)+' en líquidos COP</div>';
    iH+='<div class="ind-desc">';
    if(ind.exposicion_moneda.pct_cop>=80){
      iH+='Más del <strong>'+ind.exposicion_moneda.pct_cop+'%</strong> de tu patrimonio está en pesos colombianos. La pérdida real por devaluación se calcula solo sobre tus <strong>activos líquidos en pesos</strong> (cuentas, CDTs, fondos en COP) — no sobre inmuebles ni empresa, que se ajustan a la inflación local. El peso suele perder <strong>4% de su valor al año</strong> frente al dólar: eso son <strong>'+fmtM(ind.exposicion_moneda.perdida_anual_estimada)+'/año</strong> de poder de compra en tus líquidos.';
    } else {
      iH+='Concentración moderada en pesos. Hay margen para diversificar más en monedas duras (USD, EUR), especialmente en la parte líquida del patrimonio.';
    }
    iH+='</div>';
    iH+='<div class="ind-bar-wrap"><div class="ind-bar" style="width:0%" data-w="'+ind.exposicion_moneda.pct_cop+'"></div></div>';
    iH+='<div class="ind-detail"><div class="ind-detail-item"><div class="ind-detail-label">Líquidos en pesos</div><div class="ind-detail-val">'+fmtM(ind.exposicion_moneda.liquidos_cop)+'</div></div>';
    iH+='<div class="ind-detail-item"><div class="ind-detail-label">Líquidos en otras monedas</div><div class="ind-detail-val">'+fmtM(ind.exposicion_moneda.liquidos_otras)+'</div></div></div></div>';
  }

  // 6. Deuda de Consumo (v3: solo importa la de consumo, la estructural no es problema)
  // Lógica: deuda hipotecaria/inversión es apalancamiento sano. Deuda de consumo
  // (TC, libre inversión, vehículo) son tasas 25-35% sobre activos sin retorno
  // → destrucción de valor. Solo eso disparamos como alerta.
  if(ind.deuda.deuda_consumo>0){
    // Color según monto absoluto y proporción del patrimonio bruto
    var pctConsumoSobrePat = c.patrimonio_bruto>0 ? (ind.deuda.deuda_consumo/c.patrimonio_bruto)*100 : 0;
    var dC;
    if(ind.deuda.deuda_consumo >= 100*1e6 || pctConsumoSobrePat > 5) dC = 'red';
    else if(ind.deuda.deuda_consumo >= 30*1e6 || pctConsumoSobrePat > 2) dC = 'orange';
    else dC = 'orange';  // cualquier deuda de consumo es alerta — nunca verde

    // Costo estimado anual de la deuda de consumo (tasa promedio efectiva 28% anual)
    var TASA_CONSUMO = 0.28;
    var costoConsumoAnual = Math.round(ind.deuda.deuda_consumo * TASA_CONSUMO);

    iH+='<div class="ind-card '+dC+'">';
    iH+='<div class="ind-header"><div class="ind-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></div>';
    iH+='<div class="ind-title">Deuda de Consumo</div>';
    iH+='<span class="ind-badge">≈'+fmtM(costoConsumoAnual)+'/año en intereses</span></div>';
    iH+='<div class="ind-value">'+fmtM(ind.deuda.deuda_consumo)+'</div>';
    iH+='<div class="ind-desc">Tienes <strong>'+fmtM(ind.deuda.deuda_consumo)+'</strong> en deuda de consumo (tarjetas, libre inversión, vehículo). A tasas típicas del <strong>25-32% efectivo anual</strong>, eso te cuesta aproximadamente <strong>'+fmtM(costoConsumoAnual)+'/año en intereses</strong>. Esta deuda no es apalancamiento — es destrucción de valor: pagas un 28% por dinero que no genera retorno.</div>';
    iH+='<div class="ind-bar-wrap"><div class="ind-bar" style="width:0%" data-w="'+Math.min(pctConsumoSobrePat*10,100)+'"></div></div>';
    iH+='<div class="ind-detail"><div class="ind-detail-item"><div class="ind-detail-label">Deuda de consumo</div><div class="ind-detail-val">'+fmtM(ind.deuda.deuda_consumo)+'</div></div>';
    iH+='<div class="ind-detail-item"><div class="ind-detail-label">Costo anual estimado</div><div class="ind-detail-val">'+fmtM(costoConsumoAnual)+'</div></div></div></div>';
  }
  // Nota v3: si solo hay deuda estructural (hipoteca, inversión) sin consumo → no se muestra
  // tarjeta. La deuda hipotecaria al 12% sobre inmueble que se valoriza al 8% es apalancamiento sano.

  iG.innerHTML=iH;
  setTimeout(function(){
    iG.querySelectorAll('.ind-bar').forEach(function(b){
      b.style.width=(b.dataset.w||0)+'%';
    });
  },400);

  // ── Sección "Contexto fiscal 2026": ELIMINADA en v3 ──
  // Lo que era útil ya está en otros indicadores:
  //   - Imp. patrimonio → ya en bloque "Lo que pierdes hoy"
  //   - Cambiario → ya en indicador "Diversificación por Moneda"
  //   - Renta sin optimizar → ya en vulnerabilidades con cifras concretas
  // Se vacía el contenedor por si existe en el HTML.
  var alertEl = document.getElementById('alert-2026');
  if(alertEl){ alertEl.innerHTML=''; alertEl.style.display='none'; }

  // ── Score por capa: ELIMINADO en v3 (no aportaba claridad, categorización rota) ──
  // Vaciar el contenedor por si existe en el HTML (no romper si está)
  var bd=document.getElementById('breakdown');
  if(bd) bd.innerHTML='';

  // ── Vulnerabilidades / Señales de alerta ──
  var vl=document.getElementById('vulns-list');
  vl.innerHTML='';
  var iconos={alta:'!',media:'▲',baja:'◆'};
  var colores={alta:'#C0392B',media:'#D4821A',baja:'#2471A3'};

  // ═══ Mensajes concretos por tipo de vulnerabilidad ═══
  // Política v3: cada mensaje debe tener una cifra estimada concreta, no
  // "El test no lo calcula — en la sesión sí" que es vago y poco accionable.
  // Las cifras son rangos defendibles basados en realidad fiscal colombiana.
  function mensajeVuln(v, ingresoActivoMes){
    var ingresoAnual = (ingresoActivoMes||0)*12;
    switch(v.tipo){
      case 'f1p':
        // Profesional sin optimización fiscal: rango 5%-15% de su ingreso anual
        // (deducciones Art 206 num 10 + dependientes + AFC + medicina prepagada).
        var minP = Math.max(8000000, Math.round(ingresoAnual*0.05));
        var maxP = Math.max(25000000, Math.round(ingresoAnual*0.15));
        return {
          titulo: 'Puedes estar pagando millones de más en impuestos',
          mensaje: 'Profesionales con tu nivel de ingreso pagan en promedio entre <strong>'+fmtM(minP)+' y '+fmtM(maxP)+'/año</strong> de más en renta por no estructurar deducciones (Art. 206 ET, AFC, dependientes, medicina prepagada).',
          cost: 'Estimado: '+fmtM(minP)+' a '+fmtM(maxP)+'/año'
        };
      case 'f1e':
        // Empresario sin esquema de retiro optimizado: 15%-30% del ingreso anual
        var minE = Math.max(15000000, Math.round(ingresoAnual*0.15));
        var maxE = Math.max(40000000, Math.round(ingresoAnual*0.30));
        return {
          titulo: 'Tu esquema de retiro te cuesta millones al año',
          mensaje: 'Empresarios sin estructura salario+dividendos pagan entre <strong>'+fmtM(minE)+' y '+fmtM(maxE)+'/año</strong> más en renta personal. La mezcla óptima (Art. 242 ET) puede reducir tu carga 15-30%.',
          cost: 'Estimado: '+fmtM(minE)+' a '+fmtM(maxE)+'/año'
        };
      case 'f2e':
        return {
          titulo: 'Utilidades acumuladas con costo fiscal en aumento',
          mensaje: 'Las utilidades retenidas tributan al <strong>35%</strong> al momento de repartirlas. Cada año que pasa sin estrategia de distribución, el costo fiscal acumulado crece.',
          cost: '35% sobre utilidades al repartir'
        };
      case 'inv':
        return {
          titulo: 'Tus inversiones están concentradas localmente',
          mensaje: 'Sin diversificación global pierdes <strong>'+fmtM(c.costo_oportunidad)+'/año</strong> en costo de oportunidad y quedas expuesto al riesgo país y cambiario.',
          cost: fmtM(c.costo_oportunidad)+'/año'
        };
      case 'strat':
        return {
          titulo: 'Inviertes sin un plan claro',
          mensaje: 'Sin reglas escritas (cuánto, en qué, por cuánto tiempo), las decisiones se toman por intuición o ruido del mercado. La diferencia compuesta a 10 años suele ser de <strong>40-60%</strong> en el patrimonio final.',
          cost: '40-60% menos de patrimonio a 10 años'
        };
      case 'c2e':
        return {
          titulo: 'Flujos personales y empresariales mezclados',
          mensaje: 'Mezclar flujos genera riesgo fiscal (gastos personales como deducibles, retiros sin documentar) y dificulta valorar correctamente la empresa. La DIAN puede recalcular renta sumando lo no documentado.',
          cost: 'Riesgo fiscal + dificultad de valoración'
        };
      case 'dependencia_activo':
        return {
          titulo: 'Dependencia frágil del ingreso activo',
          mensaje: 'Tus ingresos pasivos cubren menos del <strong>30%</strong> de tus gastos y tu liquidez alcanza solo para <strong>'+c.meses_autonomia+' meses</strong>. Si dejas de trabajar, el patrimonio se agota rápido.',
          cost: c.meses_autonomia+' meses de autonomía'
        };
      case 'concentracion_iliquida':
        return {
          titulo: 'Patrimonio atrapado en activos no líquidos',
          mensaje: 'Más del <strong>80%</strong> de tu patrimonio está en inmuebles y empresa — activos que tardan meses en venderse. Para una emergencia o oportunidad, el patrimonio existe pero no responde.',
          cost: 'Más del 80% sin liquidez rápida'
        };
      default:
        return { titulo: v.titulo, mensaje: '', cost: '' };
    }
  }

  R.vulnerabilidades_detectadas.forEach(function(v){
    var color = colores[v.severidad]||'#D4821A';
    var icono = iconos[v.severidad]||'▲';
    var msg = mensajeVuln(v, c.ingreso_activo_mes);

    vl.innerHTML+='<div class="vuln-item" style="border-color:'+color+'">'+
                  '<div class="vuln-icon">'+icono+'</div>'+
                  '<div class="vuln-text">'+
                    '<strong>'+msg.titulo+'</strong>'+
                    (msg.mensaje?'<div class="vuln-msg">'+msg.mensaje+'</div>':'')+
                    (msg.cost?'<span class="vuln-cost">'+msg.cost+'</span>':'')+
                  '</div></div>';
  });

  // ═══ CTA DINÁMICO ═══
  var ctaAmount=document.getElementById('cta-amount');
  if(ctaAmount) ctaAmount.textContent = fmtM(c.total_anual)+'/año';
  var ctaSub=document.getElementById('cta-sub');
  if(ctaSub) ctaSub.textContent = cta.body;
  var ctaEyebrow=document.getElementById('cta-eyebrow');
  if(ctaEyebrow) ctaEyebrow.textContent = cta.eyebrow;
  var ctaHeadline=document.getElementById('cta-headline');
  if(ctaHeadline) ctaHeadline.textContent = cta.headline;
  var ctaButton=document.getElementById('cta-button');
  if(ctaButton) ctaButton.textContent = cta.button+' →';
  var ctaFeatures=document.getElementById('cta-features');
  if(ctaFeatures){
    ctaFeatures.innerHTML = cta.features.map(function(f){
      return '<div class="cta-feat">'+f+'</div>';
    }).join('');
  }

  window.scrollTo({top:0,behavior:'smooth'});
}