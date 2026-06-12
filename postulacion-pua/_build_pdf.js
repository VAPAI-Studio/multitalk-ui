const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const { JSDOM } = require('jsdom');
const htmlToPdfmake = require('html-to-pdfmake');
const PdfPrinter = require('pdfmake');

const SRC = '/home/user/multitalk-ui/postulacion-pua';
const OUT = path.join(SRC, 'Postulacion_PUA_The_Man_Who_Thought_He_Was_Thinking.pdf');

const order = [
  '00_INDICE_Y_CHECKLIST.md',
  '01_FORMULARIO_Y_FICHA_TECNICA.md',
  '02_LOGLINE_Y_SINOPSIS.md',
  '03_NOTA_DE_INTENCION_DIRECCION.md',
  '04_PROPUESTA_PUESTA_EN_ESCENA.md',
  '05_PROPUESTA_DE_PRODUCCION.md',
  '06_PRESUPUESTO_Y_PLAN_FINANCIERO.md',
  '07_ESTRATEGIA_DISTRIBUCION_FESTIVALES.md',
  '08_ANTECEDENTES_EMPRESA_Y_EQUIPO.md',
  '09_DECLARACIONES_Y_ANEXOS.md',
];

const titles = {
  '00_INDICE_Y_CHECKLIST.md': '00 · Índice y checklist',
  '01_FORMULARIO_Y_FICHA_TECNICA.md': '01 · Formulario y ficha técnica',
  '02_LOGLINE_Y_SINOPSIS.md': '02 · Logline y sinopsis',
  '03_NOTA_DE_INTENCION_DIRECCION.md': '03 · Nota de intención de dirección',
  '04_PROPUESTA_PUESTA_EN_ESCENA.md': '04 · Propuesta de puesta en escena',
  '05_PROPUESTA_DE_PRODUCCION.md': '05 · Propuesta de producción',
  '06_PRESUPUESTO_Y_PLAN_FINANCIERO.md': '06 · Presupuesto y plan de financiación',
  '07_ESTRATEGIA_DISTRIBUCION_FESTIVALES.md': '07 · Distribución y festivales',
  '08_ANTECEDENTES_EMPRESA_Y_EQUIPO.md': '08 · Antecedentes de empresa y equipo',
  '09_DECLARACIONES_Y_ANEXOS.md': '09 · Declaraciones y anexos',
};

// Replace glyphs not present in Roboto (emoji, box-drawing) with text equivalents
function sanitize(md) {
  const map = {
    '✅': '[OK]', '⚠️': '[!]', '⚠': '[!]', '⏳': '(en proceso)',
    '🟢': '(confirmado)', '🟡': '(en gestión)', '🔴': '(a gestionar)',
    '✔': 'OK', '❌': '[no]', '✗': 'x', '💭': '', '🚀': '', '🎯': '', '🎬': '',
    '📊': '', '🔒': '', '🧪': '', '📁': '', '🔍': '', '📱': '', '🏗': '',
    '👥': '', '🔄': '', '📋': '', '🧹': '', '💡': '', '📝': '', '🚨': '',
    '🏥': '', '🔐': '', '📚': '', '🤖': '', '🎨': '', '►': '>', '●': '*',
  };
  for (const [k, v] of Object.entries(map)) md = md.split(k).join(v);
  md = md.replace(/█/g, '#');
  // strip any remaining emoji / surrogate pairs
  md = md.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '');
  return md;
}

const fonts = {
  Roboto: {
    normal: '/tmp/pdfbuild/node_modules/pdfmake/fonts/Roboto/Roboto-Regular.ttf',
    bold: '/tmp/pdfbuild/node_modules/pdfmake/fonts/Roboto/Roboto-Medium.ttf',
    italics: '/tmp/pdfbuild/node_modules/pdfmake/fonts/Roboto/Roboto-Italic.ttf',
    bolditalics: '/tmp/pdfbuild/node_modules/pdfmake/fonts/Roboto/Roboto-MediumItalic.ttf',
  },
};

const window = new JSDOM('').window;

const BLUE = '#1f3a93';
const GRAY = '#555555';

const content = [];

// ---- Cover page ----
content.push(
  { text: '\n\n\n\n', fontSize: 6 },
  { text: 'CARPETA DE POSTULACIÓN', color: GRAY, fontSize: 13, characterSpacing: 2, alignment: 'center' },
  { text: 'Programa Uruguay Audiovisual (PUA)', color: GRAY, fontSize: 12, alignment: 'center', margin: [0, 2, 0, 30] },
  { text: 'THE MAN WHO THOUGHT HE WAS THINKING', fontSize: 26, bold: true, color: BLUE, alignment: 'center' },
  { text: 'El hombre que pensó que estaba pensando', fontSize: 13, italics: true, color: GRAY, alignment: 'center', margin: [0, 6, 0, 30] },
  { text: 'Largometraje de ficción · Animación con IA generativa', fontSize: 12, alignment: 'center', margin: [0, 0, 0, 4] },
  { text: 'Dirección y guion: Federico Veiroj', fontSize: 12, alignment: 'center' },
  { text: 'Línea: Producción de Contenidos Audiovisuales (Nacional)', fontSize: 11, color: GRAY, alignment: 'center', margin: [0, 30, 0, 4] },
  { text: 'Productora postulante: VELIDER SAS (Souts) — RUT 220073360012', fontSize: 11, alignment: 'center' },
  { text: 'Coproducción mayoritaria uruguaya', fontSize: 11, color: GRAY, alignment: 'center', margin: [0, 2, 0, 40] },
  { text: 'Documento de trabajo · Generado ' + new Date().toISOString().slice(0, 10), fontSize: 9, color: GRAY, alignment: 'center' },
  { text: '', pageBreak: 'after' },
);

// ---- Sections ----
for (const file of order) {
  let md = fs.readFileSync(path.join(SRC, file), 'utf8');
  md = sanitize(md);
  const html = marked.parse(md, { gfm: true, mangle: false, headerIds: false });
  const pdfContent = htmlToPdfmake(html, { window, tableAutoSize: true, defaultStyles: {
    h1: { fontSize: 18, bold: true, color: BLUE, margin: [0, 0, 0, 8] },
    h2: { fontSize: 14, bold: true, color: BLUE, margin: [0, 12, 0, 6] },
    h3: { fontSize: 11.5, bold: true, color: '#333333', margin: [0, 8, 0, 4] },
    p: { fontSize: 9.5, margin: [0, 0, 0, 6], lineHeight: 1.15 },
    li: { fontSize: 9.5, margin: [0, 1, 0, 1] },
    table: { fontSize: 8.5, margin: [0, 4, 0, 8] },
    th: { bold: true, fillColor: '#eef1f8', fontSize: 8.5 },
    blockquote: { fontSize: 9, italics: true, color: GRAY, margin: [8, 4, 0, 8] },
    code: { fontSize: 8, color: '#333333' },
    a: { color: BLUE, decoration: 'underline' },
  }});
  content.push(pdfContent);
  if (file !== order[order.length - 1]) content.push({ text: '', pageBreak: 'after' });
}

const docDefinition = {
  pageSize: 'A4',
  pageMargins: [44, 54, 44, 50],
  info: {
    title: 'Postulación PUA — The Man Who Thought He Was Thinking',
    author: 'VELIDER SAS (Souts)',
  },
  defaultStyle: { font: 'Roboto', fontSize: 9.5, color: '#1a1a1a' },
  styles: {
    docTitle: { fontSize: 20, bold: true, color: BLUE, margin: [0, 0, 0, 10] },
  },
  header: (currentPage) => currentPage === 1 ? null : ({
    text: 'The Man Who Thought He Was Thinking — Postulación PUA',
    alignment: 'right', color: '#999999', fontSize: 7.5, margin: [0, 22, 44, 0],
  }),
  footer: (currentPage, pageCount) => currentPage === 1 ? null : ({
    columns: [
      { text: 'VELIDER SAS (Souts)', alignment: 'left', color: '#999999', fontSize: 7.5, margin: [44, 0, 0, 0] },
      { text: currentPage + ' / ' + pageCount, alignment: 'right', color: '#999999', fontSize: 7.5, margin: [0, 0, 44, 0] },
    ],
  }),
  content,
};

(async () => {
  if (typeof PdfPrinter.setLocalAccessPolicy === 'function') {
    PdfPrinter.setLocalAccessPolicy(() => true);
  }
  PdfPrinter.addFonts(fonts);
  const doc = PdfPrinter.createPdf(docDefinition);
  await doc.write(OUT);
  console.log('PDF WRITTEN:', OUT);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
