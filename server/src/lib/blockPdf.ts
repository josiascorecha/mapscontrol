import PDFDocument from 'pdfkit';

/**
 * PDF de uma quadra: cabeçalho (congregação, território, quadra), resumo e a lista
 * de casas/prédios/apartamentos na ORDEM DE CADASTRO, com situação, data e observações.
 * A última coluna fica em branco para anotações à mão (uso impresso no campo).
 */

export type Status = 'pending' | 'letter' | 'contacted';

export interface PdfRow {
  kind: 'house' | 'building' | 'unit';
  label: string;
  status: Status | null; // null para a linha-título do prédio
  lastContactOn: string | null;
  lastLetterOn: string | null;
  lastAbsentOn: string | null;
  notes: string[];
  summary?: string; // linha do prédio: "12 aptos · 3 pendentes…"
}

export interface BlockPdfData {
  congregation: string;
  territoryNumber: number;
  territoryName: string | null;
  blockNumber: number;
  blockName: string | null;
  mapsUrl: string | null;
  generatedBy: string;
  generatedAt: Date;
  rows: PdfRow[];
  totals: { pending: number; letter: number; contacted: number; total: number };
}

const C = {
  brand: '#1e1b4b',
  brand2: '#3b2f8f',
  text: '#1c1b22',
  muted: '#55535f',
  line: '#dcdbe3',
  zebra: '#f5f4fe',
  building: '#ebe9fb',
  pending: '#55535f',
  letter: '#5b21b6',
  contacted: '#166534',
};

const STATUS_LABEL: Record<Status, string> = { pending: 'Pendente', letter: 'Com carta', contacted: 'Contato realizado' };

export function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(d);
}

function dateCell(r: PdfRow): string {
  if (r.status === 'contacted') return `Contato ${fmtDate(r.lastContactOn)}`;
  if (r.status === 'letter') return `Carta ${fmtDate(r.lastLetterOn)}`;
  if (r.status === 'pending' && r.lastAbsentOn) return `Tentativa ${fmtDate(r.lastAbsentOn)}`;
  return '';
}

export function buildBlockPdf(data: BlockPdfData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 40, bottom: 50, left: 36, right: 36 },
    bufferPages: true,
    info: {
      Title: `Território ${data.territoryNumber} - Quadra ${data.blockNumber}`,
      Author: 'MapsControl',
      Subject: data.congregation,
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const cols = [
    { key: 'num', title: 'Nº', w: 70 },
    { key: 'status', title: 'Situação', w: 95 },
    { key: 'date', title: 'Data', w: 95 },
    { key: 'obs', title: 'Observações', w: 0 }, // flexível
    { key: 'hand', title: 'Anotações', w: 110 },
  ];
  cols[3].w = width - cols.reduce((s, c) => s + c.w, 0);

  // ---------- Cabeçalho ----------
  doc.rect(0, 0, doc.page.width, 8).fill(C.brand2);
  doc.fillColor(C.brand).font('Helvetica-Bold').fontSize(18)
    .text(`Território ${data.territoryNumber}${data.territoryName ? ` — ${data.territoryName}` : ''}`, left, 28, { width });
  doc.fillColor(C.text).font('Helvetica-Bold').fontSize(14)
    .text(`Quadra ${data.blockNumber}${data.blockName ? ` — ${data.blockName}` : ''}`, { width });
  doc.moveDown(0.2).font('Helvetica').fontSize(9.5).fillColor(C.muted).text(data.congregation, { width });
  if (data.mapsUrl) {
    doc.fillColor(C.brand2).text('Abrir no Google Maps', { width, link: data.mapsUrl, underline: true });
  }

  // ---------- Resumo ----------
  doc.moveDown(0.6);
  const boxY = doc.y;
  const boxW = (width - 3 * 8) / 4;
  const stats: [string, number, string][] = [
    ['Endereços', data.totals.total, C.text],
    ['Pendentes', data.totals.pending, C.pending],
    ['Com carta', data.totals.letter, C.letter],
    ['Contatos', data.totals.contacted, C.contacted],
  ];
  stats.forEach(([label, value, color], i) => {
    const x = left + i * (boxW + 8);
    doc.roundedRect(x, boxY, boxW, 42, 6).lineWidth(0.8).strokeColor(C.line).stroke();
    doc.fillColor(color).font('Helvetica-Bold').fontSize(16).text(String(value), x, boxY + 6, { width: boxW, align: 'center' });
    doc.fillColor(C.muted).font('Helvetica').fontSize(8.5).text(label, x, boxY + 26, { width: boxW, align: 'center' });
  });
  doc.y = boxY + 54;

  // ---------- Tabela ----------
  const headerRow = () => {
    const y = doc.y;
    doc.rect(left, y, width, 20).fill(C.brand);
    let x = left;
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
    for (const c of cols) {
      doc.text(c.title, x + 5, y + 6, { width: c.w - 10, lineBreak: false });
      x += c.w;
    }
    doc.y = y + 20;
  };
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  headerRow();

  if (data.rows.length === 0) {
    doc.moveDown(1).fillColor(C.muted).font('Helvetica-Oblique').fontSize(10)
      .text('Nenhum endereço cadastrado nesta quadra.', left, doc.y, { width, align: 'center' });
  }

  let zebra = false;
  for (const r of data.rows) {
    const cells: Record<string, string> = {
      num: r.kind === 'unit' ? `   ${r.label}` : r.label,
      status: r.status ? STATUS_LABEL[r.status] : r.summary ?? '',
      date: r.status ? dateCell(r) : '',
      obs: r.notes.join(' · '),
      hand: '',
    };
    const fontFor = (k: string) => (k === 'num' || r.kind === 'building' ? 'Helvetica-Bold' : 'Helvetica');
    // Altura da linha = maior célula
    let h = 0;
    for (const c of cols) {
      doc.font(fontFor(c.key)).fontSize(9);
      h = Math.max(h, doc.heightOfString(cells[c.key] || ' ', { width: c.w - 10 }));
    }
    h = Math.max(h + 10, 22);
    if (doc.y + h > bottom()) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      headerRow();
      zebra = false;
    }
    const y = doc.y;
    if (r.kind === 'building') doc.rect(left, y, width, h).fill(C.building);
    else if (zebra) doc.rect(left, y, width, h).fill(C.zebra);
    zebra = !zebra;
    let x = left;
    for (const c of cols) {
      const color =
        c.key === 'status' && r.status ? C[r.status] : c.key === 'obs' || c.key === 'date' ? C.muted : C.text;
      doc.fillColor(color).font(c.key === 'status' && r.status ? 'Helvetica-Bold' : fontFor(c.key)).fontSize(9)
        .text(cells[c.key], x + 5, y + 5, { width: c.w - 10 });
      x += c.w;
    }
    doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.5).strokeColor(C.line).stroke();
    // separador da coluna de anotações à mão
    const handX = left + width - cols[4].w;
    doc.moveTo(handX, y).lineTo(handX, y + h).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.y = y + h;
  }

  doc.moveDown(0.8);
  if (doc.y + 30 > bottom()) doc.addPage();
  doc.fillColor(C.muted).font('Helvetica').fontSize(8)
    .text('Legenda: Pendente = sem conversa ainda · Com carta = carta deixada, conversa ainda pendente · Contato realizado = conversa feita (data da conversa).', left, doc.y, { width });

  // ---------- Rodapé com paginação ----------
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - 32;
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // permite escrever no rodapé sem criar página nova
    doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
      .text(`MapsControl · gerado em ${fmtDateTime(data.generatedAt)} por ${data.generatedBy}`, left, y, { width: width - 60, lineBreak: false });
    doc.text(`${i + 1}/${range.count}`, left + width - 60, y, { width: 60, align: 'right', lineBreak: false });
    doc.page.margins.bottom = oldBottom;
  }

  doc.end();
  return done;
}
