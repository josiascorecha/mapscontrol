import PDFDocument from 'pdfkit';

/**
 * Fichas para recorte (modelo "Controle de Territórios" da congregação): folha A4 com
 * 4 fichas (2 × 2). Cada ficha tem TERRITÓRIO, QUADRA, PUBLICADORES e uma tabela
 * "CASA Nº | DATA | CASA Nº | DATA" com 18 linhas — 36 endereços por ficha.
 *
 * Os endereços entram na ordem de cadastro, descendo a primeira coluna e depois a
 * segunda. Quadra com mais de 36 endereços continua em outra ficha ("cont.").
 * As posições que sobram na última folha saem em branco, como no modelo, para uso à mão.
 */

export interface CardEntry {
  label: string; // "12", "120/101", "120/B-101"
  date: string | null; // AAAA-MM-DD
}

export interface CardBlock {
  territoryNumber: number;
  blockNumber: number;
  publishers: string[];
  entries: CardEntry[];
}

interface Card {
  territory: string;
  block: string;
  publishers: string;
  entries: CardEntry[];
}

export const ROWS_PER_CARD = 18;
export const ENTRIES_PER_CARD = ROWS_PER_CARD * 2;

// Medidas em pontos (A4 = 595,28 × 841,89), proporcionais ao modelo.
const CARD_W = 239;
const GAP_X = 49;
const ROW_H = 14.5;
const HEADER_H = 48; // linhas TERRITÓRIO/QUADRA e PUBLICADORES até a tabela
const CARD_H = HEADER_H + ROW_H * (ROWS_PER_CARD + 1);
const GAP_Y = 30;
const TOP = 58;

function fmt(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** Divide as quadras em fichas de 36 endereços. Quadra sem endereços ainda ganha uma ficha. */
export function toCards(blocks: CardBlock[]): Card[] {
  const cards: Card[] = [];
  for (const b of blocks) {
    const parts = Math.max(1, Math.ceil(b.entries.length / ENTRIES_PER_CARD));
    for (let i = 0; i < parts; i++) {
      cards.push({
        territory: String(b.territoryNumber),
        block: parts > 1 ? `${b.blockNumber} (${i + 1}/${parts})` : String(b.blockNumber),
        publishers: b.publishers.join(', '),
        entries: b.entries.slice(i * ENTRIES_PER_CARD, (i + 1) * ENTRIES_PER_CARD),
      });
    }
  }
  return cards;
}

export function buildCardsPdf(blocks: CardBlock[], opts: { title: string; generatedAt: Date }): Promise<Buffer> {
  const cards = toCards(blocks);
  while (cards.length === 0 || cards.length % 4 !== 0) cards.push({ territory: '', block: '', publishers: '', entries: [] });

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    bufferPages: true,
    info: { Title: opts.title, Author: 'MapsControl' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const pageW = doc.page.width;
  const left = (pageW - (CARD_W * 2 + GAP_X)) / 2;
  const pages = cards.length / 4;
  const stamp = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(opts.generatedAt);

  for (let p = 0; p < pages; p++) {
    if (p > 0) doc.addPage();
    cutGuides(doc, left, pageW);
    for (let i = 0; i < 4; i++) {
      const card = cards[p * 4 + i];
      const x = left + (i % 2) * (CARD_W + GAP_X);
      const y = TOP + Math.floor(i / 2) * (CARD_H + GAP_Y);
      drawCard(doc, card, x, y);
    }
    doc.fillColor('#777777').font('Helvetica').fontSize(7)
      .text(`MapsControl · ${opts.title} · gerado em ${stamp} · folha ${p + 1}/${pages}`, 0, doc.page.height - 34, {
        width: pageW, align: 'center', lineBreak: false,
      });
  }
  doc.end();
  return done;
}

function cutGuides(doc: PDFKit.PDFDocument, left: number, pageW: number) {
  const midX = left + CARD_W + GAP_X / 2;
  const midY = TOP + CARD_H + GAP_Y / 2;
  doc.save().lineWidth(0.5).strokeColor('#b5b5b5').dash(4, { space: 3 });
  doc.moveTo(midX, TOP - 22).lineTo(midX, TOP + CARD_H * 2 + GAP_Y + 18).stroke();
  doc.moveTo(left - 16, midY).lineTo(pageW - left + 16, midY).stroke();
  doc.undash().restore();
}

/** Texto centralizado que cabe na largura: reduz a fonte até `min` e, se ainda não couber, corta com "…". */
function fitText(doc: PDFKit.PDFDocument, text: string, x: number, y: number, w: number, size: number, font: string, min = 6) {
  if (!text) return;
  let s = size;
  doc.font(font).fontSize(s);
  while (s > min && doc.widthOfString(text) > w) doc.fontSize((s -= 0.5));
  let t = text;
  while (t.length > 1 && doc.widthOfString(t) > w) t = `${t.slice(0, -2)}…`;
  doc.text(t, x, y + (size - s) / 2, { width: w, align: 'center', lineBreak: false });
}

function labelLine(doc: PDFKit.PDFDocument, label: string, value: string, x: number, y: number, lineW: number): number {
  doc.fillColor('#000000').font('Helvetica-Bold').fontSize(9.5).text(label, x, y, { lineBreak: false });
  const lx = x + doc.widthOfString(label) + 1;
  doc.moveTo(lx, y + 10).lineTo(lx + lineW, y + 10).lineWidth(0.7).strokeColor('#000000').stroke();
  doc.fillColor('#1e1b4b');
  fitText(doc, value, lx + 1, y - 1, lineW - 2, 10, 'Helvetica');
  return lx + lineW;
}

function drawCard(doc: PDFKit.PDFDocument, card: Card, x: number, y: number) {
  // Cabeçalho
  const end = labelLine(doc, 'TERRITÓRIO:', card.territory, x + 2, y + 6, 52);
  doc.font('Helvetica-Bold').fontSize(9.5);
  labelLine(doc, 'QUADRA:', card.block, end + 10, y + 6, x + CARD_W - (end + 10) - doc.widthOfString('QUADRA:') - 3);
  doc.font('Helvetica-Bold').fontSize(9.5);
  labelLine(doc, 'PUBLICADORES:', card.publishers, x + 2, y + 26, CARD_W - doc.widthOfString('PUBLICADORES:') - 5);

  // Tabela
  const top = y + HEADER_H;
  const colW = CARD_W / 4;
  const tableH = ROW_H * (ROWS_PER_CARD + 1);
  doc.lineWidth(0.6).strokeColor('#000000');
  for (let r = 1; r <= ROWS_PER_CARD; r++) doc.moveTo(x, top + r * ROW_H).lineTo(x + CARD_W, top + r * ROW_H).stroke();
  for (let c = 1; c < 4; c++) doc.moveTo(x + c * colW, top).lineTo(x + c * colW, top + tableH).stroke();
  doc.lineWidth(1.6).rect(x, top, CARD_W, tableH).stroke();

  doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8.5);
  ['CASA Nº', 'DATA', 'CASA Nº', 'DATA'].forEach((h, i) => {
    doc.text(h, x + i * colW, top + 4, { width: colW, align: 'center', lineBreak: false });
  });

  doc.fillColor('#1e1b4b');
  card.entries.forEach((e, i) => {
    const col = i < ROWS_PER_CARD ? 0 : 2;
    const row = i % ROWS_PER_CARD;
    const ty = top + (row + 1) * ROW_H + 3.6;
    fitText(doc, e.label, x + col * colW + 2, ty, colW - 4, 8.5, 'Helvetica-Bold');
    fitText(doc, fmt(e.date), x + (col + 1) * colW + 2, ty, colW - 4, 8.5, 'Helvetica');
  });
}
