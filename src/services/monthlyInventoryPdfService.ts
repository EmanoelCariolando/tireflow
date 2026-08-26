import type { Product } from '@prisma/client';
import PDFDocument from 'pdfkit';
import type { MonthlyReportFormatInput } from './monthlyReportService.js';

export type MonthlyInventoryProduct = Pick<
  Product,
  'id' | 'reference' | 'description' | 'stock' | 'stockLocation'
>;

export interface MonthlyInventoryPdfInput {
  report: MonthlyReportFormatInput;
  products: MonthlyInventoryProduct[];
  branchName: string;
  generatedAt: Date;
}

interface TableColumn<Row> {
  title: string;
  width: number;
  align?: 'left' | 'center' | 'right';
  value: (row: Row) => string;
}

interface InventoryRow extends MonthlyInventoryProduct {
  order: number;
}

type ZeroStockRow = MonthlyReportFormatInput['zeroStockProducts'][number];

const COLORS = {
  navy: '#183153',
  blue: '#2463A9',
  paleBlue: '#EAF2FA',
  green: '#26734D',
  paleGreen: '#E9F5EF',
  amber: '#A86400',
  paleAmber: '#FFF4DD',
  red: '#A73535',
  paleRed: '#FBEAEA',
  ink: '#1E293B',
  muted: '#64748B',
  line: '#CBD5E1',
  row: '#F8FAFC',
  white: '#FFFFFF',
} as const;

const PAGE_MARGIN = 34;
const FIRST_PAGE_CONTENT_TOP = 88;
const CONTINUATION_PAGE_TOP = 28;
// The document margin must leave room for PDFKit to draw the footer without
// treating it as overflow and silently creating extra blank pages.
const PDF_BOTTOM_MARGIN = 16;
const CONTENT_BOTTOM_MARGIN = 42;

export async function buildMonthlyInventoryPdf(
  input: MonthlyInventoryPdfInput
): Promise<Buffer> {
  const document = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: {
      top: FIRST_PAGE_CONTENT_TOP,
      right: PAGE_MARGIN,
      bottom: PDF_BOTTOM_MARGIN,
      left: PAGE_MARGIN,
    },
    bufferPages: true,
    compress: true,
    info: {
      Title: `Relatório mensal de estoque - ${formatMonthLabel(input.report.period.start)}`,
      Author: 'TireFlow',
      Subject: 'Conferência mensal de estoque',
      Creator: 'TireFlow',
    },
  });

  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer | Uint8Array) => chunks.push(Buffer.from(chunk)));

  return new Promise<Buffer>((resolve, reject) => {
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    try {
      drawPageHeader(document, input);
      drawOverview(document, input);
      drawZeroStock(document, input);
      drawInventory(document, input);
      drawSignatures(document, input);
      drawPageFooters(document, input);
      document.end();
    } catch (error) {
      reject(error);
    }
  });
}

export function getMonthlyInventoryPdfFileName(periodKey: string): string {
  return `relatorio-mensal-estoque-${periodKey}.pdf`;
}

function drawOverview(document: PDFKit.PDFDocument, input: MonthlyInventoryPdfInput): void {
  document
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('RELATÓRIO MENSAL DE ESTOQUE');
  document
    .fillColor(COLORS.muted)
    .font('Helvetica')
    .fontSize(10)
    .text(
      `Período: ${formatDate(input.report.period.start)} a ${formatDate(previousDay(input.report.period.end))}`
    );
  document.moveDown(1.1);

  const totalUnits = input.products.reduce((sum, product) => sum + product.stock, 0);
  const continuedAtZero = input.report.zeroStockProducts.filter(
    (product) => product.endedAtZero
  ).length;
  const cardGap = 10;
  const cardWidth = (contentWidth(document) - cardGap * 3) / 4;
  const cardY = document.y;
  const cards = [
    { label: 'MODELOS EM ESTOQUE', value: String(input.products.length), color: COLORS.blue },
    { label: 'TOTAL DE PNEUS', value: String(totalUnits), color: COLORS.green },
    {
      label: 'ZERARAM NO MÊS',
      value: String(input.report.zeroStockProducts.length),
      color: COLORS.amber,
    },
    { label: 'CONTINUAM ZERADOS', value: String(continuedAtZero), color: COLORS.red },
  ];

  for (const [index, card] of cards.entries()) {
    const x = PAGE_MARGIN + index * (cardWidth + cardGap);
    document.roundedRect(x, cardY, cardWidth, 55, 5).fill(COLORS.row);
    document.rect(x, cardY, 5, 55).fill(card.color);
    document
      .fillColor(COLORS.muted)
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text(card.label, x + 14, cardY + 10, { width: cardWidth - 22 });
    document
      .fillColor(card.color)
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(card.value, x + 14, cardY + 25, { width: cardWidth - 22 });
  }
  document.y = cardY + 72;
  document.x = PAGE_MARGIN;

  drawSectionTitle(document, '1. PNEUS MAIS VENDIDOS');
  if (input.report.bestSellers.length === 0) {
    drawNotice(document, input, 'Nenhum pneu foi vendido no período.', COLORS.paleBlue, COLORS.blue);
  } else {
    const rankByProduct = new Map(
      input.report.bestSellers.map((product, index) => [product, index + 1])
    );
    drawTable(
      document,
      input,
      input.report.bestSellers,
      [
        { title: 'POS.', width: 42, align: 'center', value: (row) => String(rankByProduct.get(row)) },
        { title: 'MEDIDA', width: 100, value: (row) => row.reference },
        { title: 'DESCRIÇÃO', width: 390, value: (row) => row.description },
        { title: 'VENDIDOS', width: 80, align: 'center', value: (row) => String(row.quantity) },
        { title: 'FATURAMENTO', width: 110, align: 'right', value: (row) => formatCurrency(row.totalValue) },
      ],
      'Pneus mais vendidos (continuação)'
    );
  }

}

function drawInventory(document: PDFKit.PDFDocument, input: MonthlyInventoryPdfInput): void {
  addReportPage(document, input);
  drawSectionTitle(document, '3. CONFERÊNCIA FÍSICA DO ESTOQUE');
  document
    .fillColor(COLORS.muted)
    .font('Helvetica')
    .fontSize(9)
    .text('Somente produtos ativos com saldo atual acima de zero.');
  document.moveDown(0.7);
  drawNotice(
    document,
    input,
    'COMO USAR: conte o estoque físico e preencha as colunas "Contado" e "Diferença". Os pneus estão separados por aro e ordenados por medida.',
    COLORS.paleGreen,
    COLORS.green
  );
  document.moveDown(0.7);

  if (input.products.length === 0) {
    drawNotice(
      document,
      input,
      'Nenhum produto possui estoque acima de zero.',
      COLORS.paleAmber,
      COLORS.amber
    );
    return;
  }

  const rows = sortInventoryProducts(input.products, input.report.showStockLocations).map((product, index) => ({
    ...product,
    order: index + 1,
  }));
  const groups = groupInventoryRows(rows, input.report.showStockLocations);

  for (const [groupIndex, group] of groups.entries()) {
    if (groupIndex > 0) {
      ensureSpace(document, input, 58);
      document.moveDown(0.4);
    }
    drawGroupLabel(document, group.label);
    drawTable(
      document,
      input,
      group.rows,
      inventoryColumns(input.report.showStockLocations),
      `Conferência física — ${group.label}`,
      group.label,
      groupIndex === groups.length - 1 ? 105 : 0
    );
  }
}

function drawZeroStock(document: PDFKit.PDFDocument, input: MonthlyInventoryPdfInput): void {
  document.moveDown(0.8);
  ensureSpace(document, input, 92);
  drawSectionTitle(document, '2. PNEUS QUE ZERARAM NO MÊS');
  document
    .fillColor(COLORS.muted)
    .font('Helvetica')
    .fontSize(9)
    .text('Produtos que chegaram a estoque zero em algum momento do período.');
  document.moveDown(0.8);

  const products = [...input.report.zeroStockProducts].sort((left, right) => {
    if (left.endedAtZero !== right.endedAtZero) return left.endedAtZero ? -1 : 1;
    return left.zeroedAt.getTime() - right.zeroedAt.getTime();
  });

  if (products.length === 0) {
    drawNotice(
      document,
      input,
      'Nenhum pneu chegou a estoque zero durante o mês.',
      COLORS.paleGreen,
      COLORS.green
    );
    return;
  }

  const locationWidth = input.report.showStockLocations ? 75 : 0;
  drawTable(
    document,
    input,
    products,
    [
      { title: 'MEDIDA', width: 92, value: (row) => row.reference },
      {
        title: 'DESCRIÇÃO',
        width: input.report.showStockLocations ? 245 : 320,
        value: (row) => row.description,
      },
      ...(input.report.showStockLocations
        ? [{
            title: 'LOCAL',
            width: locationWidth,
            value: (row: ZeroStockRow) => row.stockLocation ?? 'Não cadastrado',
          }]
        : []),
      { title: 'VENDIDOS', width: 65, align: 'center' as const, value: (row) => String(row.soldQuantity) },
      { title: 'ZEROU EM', width: 82, align: 'center' as const, value: (row) => formatDate(row.zeroedAt) },
      {
        title: 'SITUAÇÃO NO FECHAMENTO',
        width: 210,
        value: (row) => row.endedAtZero
          ? 'Continua zerado'
          : `Reposto em ${row.replenishedAt ? formatDate(row.replenishedAt) : 'data não identificada'}`,
      },
    ],
    'Pneus que zeraram no mês (continuação)'
  );

  document.moveDown(0.8);
  const continued = products.filter((product) => product.endedAtZero).length;
  drawNotice(
    document,
    input,
    `Resumo: ${continued} continuam zerados e ${products.length - continued} foram repostos no período.`,
    COLORS.paleAmber,
    COLORS.amber
  );
}

function drawSignatures(document: PDFKit.PDFDocument, input: MonthlyInventoryPdfInput): void {
  ensureSpace(document, input, 90);
  document.moveDown(1.5);
  const y = document.y;
  const width = contentWidth(document);
  const gap = 30;
  const fieldWidth = (width - gap) / 2;

  document.strokeColor(COLORS.line).lineWidth(0.8);
  document.moveTo(PAGE_MARGIN, y + 24).lineTo(PAGE_MARGIN + fieldWidth, y + 24).stroke();
  document
    .fillColor(COLORS.muted)
    .font('Helvetica')
    .fontSize(8)
    .text('Conferido por', PAGE_MARGIN, y + 29, { width: fieldWidth, align: 'center' });
  const secondX = PAGE_MARGIN + fieldWidth + gap;
  document.moveTo(secondX, y + 24).lineTo(secondX + fieldWidth, y + 24).stroke();
  document.text('Data da conferência', secondX, y + 29, { width: fieldWidth, align: 'center' });
  document.y = y + 55;
  document
    .fillColor(COLORS.muted)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('OBSERVAÇÕES');
  for (let index = 0; index < 2; index++) {
    const lineY = document.y + 14;
    document.moveTo(PAGE_MARGIN, lineY).lineTo(document.page.width - PAGE_MARGIN, lineY).stroke();
    document.y = lineY + 8;
  }
}

function inventoryColumns(showLocations: boolean): TableColumn<InventoryRow>[] {
  return [
    { title: '#', width: 30, align: 'center', value: (row) => String(row.order) },
    ...(showLocations
      ? [{ title: 'LOCAL', width: 72, value: (row: InventoryRow) => row.stockLocation ?? 'Não cadastrado' }]
      : []),
    { title: 'MEDIDA', width: 92, value: (row) => row.reference },
    {
      title: 'DESCRIÇÃO',
      width: showLocations ? 330 : 402,
      value: (row) => row.description,
    },
    { title: 'SISTEMA', width: 70, align: 'center', value: (row) => String(row.stock) },
    { title: 'CONTADO', width: 70, align: 'center', value: () => '________' },
    { title: 'DIFERENÇA', width: 78, align: 'center', value: () => '________' },
  ];
}

function drawTable<Row>(
  document: PDFKit.PDFDocument,
  input: MonthlyInventoryPdfInput,
  rows: Row[],
  columns: TableColumn<Row>[],
  continuationTitle: string,
  continuationGroup?: string,
  afterTableReserve = 0
): void {
  drawTableHeader(document, columns);

  for (const [index, row] of rows.entries()) {
    document.font('Helvetica').fontSize(8);
    const rowHeight = Math.max(
      23,
      ...columns.map((column) =>
        document.heightOfString(column.value(row), {
          width: column.width - 8,
          align: column.align ?? 'left',
        }) + 10
      )
    );

    const isLastRow = index === rows.length - 1;
    const reservedHeight = isLastRow ? afterTableReserve : 0;
    if (document.y + rowHeight + reservedHeight > pageBottom(document)) {
      addReportPage(document, input);
      drawSectionTitle(document, continuationTitle);
      if (continuationGroup) drawGroupLabel(document, `${continuationGroup} — continuação`);
      drawTableHeader(document, columns);
    }

    const y = document.y;
    const background = index % 2 === 0 ? COLORS.white : COLORS.row;
    document.rect(PAGE_MARGIN, y, columns.reduce((sum, column) => sum + column.width, 0), rowHeight)
      .fill(background);

    let x = PAGE_MARGIN;
    for (const column of columns) {
      document
        .rect(x, y, column.width, rowHeight)
        .strokeColor(COLORS.line)
        .lineWidth(0.35)
        .stroke();
      document
        .fillColor(COLORS.ink)
        .font('Helvetica')
        .fontSize(8)
        .text(column.value(row), x + 4, y + 6, {
          width: column.width - 8,
          align: column.align ?? 'left',
        });
      x += column.width;
    }
    document.y = y + rowHeight;
  }
}

function drawTableHeader<Row>(
  document: PDFKit.PDFDocument,
  columns: TableColumn<Row>[]
): void {
  const y = document.y;
  let x = PAGE_MARGIN;
  for (const column of columns) {
    document.rect(x, y, column.width, 22).fillAndStroke(COLORS.navy, COLORS.white);
    document
      .fillColor(COLORS.white)
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text(column.title, x + 4, y + 7, {
        width: column.width - 8,
        align: column.align ?? 'left',
      });
    x += column.width;
  }
  document.y = y + 22;
}

function drawSectionTitle(document: PDFKit.PDFDocument, title: string): void {
  const y = document.y;
  document
    .fillColor(COLORS.navy)
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(title, PAGE_MARGIN, y, { width: contentWidth(document) });
  document.moveDown(0.45);
}

function drawGroupLabel(document: PDFKit.PDFDocument, label: string): void {
  const y = document.y;
  document.roundedRect(PAGE_MARGIN, y, contentWidth(document), 22, 3).fill(COLORS.paleBlue);
  document
    .fillColor(COLORS.blue)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(label, PAGE_MARGIN + 8, y + 7, { width: contentWidth(document) - 16 });
  document.y = y + 26;
}

function drawNotice(
  document: PDFKit.PDFDocument,
  input: MonthlyInventoryPdfInput,
  text: string,
  background: string,
  foreground: string
): void {
  const height = document.heightOfString(text, { width: contentWidth(document) - 24 }) + 20;
  ensureSpace(document, input, height);
  const y = document.y;
  document.roundedRect(PAGE_MARGIN, y, contentWidth(document), height, 4).fill(background);
  document
    .fillColor(foreground)
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text(text, PAGE_MARGIN + 12, y + 10, { width: contentWidth(document) - 24 });
  document.y = y + height;
}

function drawPageHeader(document: PDFKit.PDFDocument, input: MonthlyInventoryPdfInput): void {
  const width = document.page.width;
  document.rect(0, 0, width, 66).fill(COLORS.navy);
  document
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(input.branchName.trim() || 'ATC PNEUS', PAGE_MARGIN, 18, { width: width / 2 });
  document
    .font('Helvetica')
    .fontSize(8.5)
    .text(
      `Inventário mensal • ${formatMonthLabel(input.report.period.start)}`,
      PAGE_MARGIN,
      38,
      { width: width / 2 }
    );
  document
    .font('Helvetica')
    .fontSize(8)
    .text(`Gerado em ${formatDateTime(input.generatedAt)}`, width / 2, 27, {
      width: width / 2 - PAGE_MARGIN,
      align: 'right',
    });
  document.y = FIRST_PAGE_CONTENT_TOP;
}

function addReportPage(document: PDFKit.PDFDocument, _input: MonthlyInventoryPdfInput): void {
  document.addPage({
    size: 'A4',
    layout: 'landscape',
    margins: {
      top: CONTINUATION_PAGE_TOP,
      right: PAGE_MARGIN,
      bottom: PDF_BOTTOM_MARGIN,
      left: PAGE_MARGIN,
    },
  });
  document.y = CONTINUATION_PAGE_TOP;
}

function drawPageFooters(document: PDFKit.PDFDocument, input: MonthlyInventoryPdfInput): void {
  const range = document.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    document.switchToPage(index);
    const footerY = document.page.height - 25;
    document
      .strokeColor(COLORS.line)
      .lineWidth(0.5)
      .moveTo(PAGE_MARGIN, footerY - 6)
      .lineTo(document.page.width - PAGE_MARGIN, footerY - 6)
      .stroke();
    document
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(7.5)
      .text(`${input.branchName.trim() || 'ATC PNEUS'} • TireFlow`, PAGE_MARGIN, footerY, {
        width: contentWidth(document) / 2,
        lineBreak: false,
      });
    document.text(`Página ${index - range.start + 1} de ${range.count}`, document.page.width / 2, footerY, {
      width: document.page.width / 2 - PAGE_MARGIN,
      align: 'right',
      lineBreak: false,
    });
  }
}

function ensureSpace(
  document: PDFKit.PDFDocument,
  input: MonthlyInventoryPdfInput | null,
  requiredHeight: number
): void {
  if (document.y + requiredHeight <= pageBottom(document)) return;
  if (input) {
    addReportPage(document, input);
  } else {
    document.addPage();
  }
}

function groupInventoryRows(
  rows: InventoryRow[],
  showLocations: boolean
): Array<{ label: string; rows: InventoryRow[] }> {
  const grouped = new Map<string, InventoryRow[]>();
  for (const row of rows) {
    const location = row.stockLocation?.trim() || 'Não cadastrado';
    const rim = getInventoryProductRim(row);
    const rimLabel = rim === null ? 'OUTRAS MEDIDAS' : `ARO ${formatRim(rim)}`;
    const label = showLocations ? `LOCALIZAÇÃO: ${location} • ${rimLabel}` : rimLabel;
    const group = grouped.get(label);
    if (group) {
      group.push(row);
    } else {
      grouped.set(label, [row]);
    }
  }
  return [...grouped.entries()].map(([label, groupRows]) => ({ label, rows: groupRows }));
}

function sortInventoryProducts(
  products: MonthlyInventoryProduct[],
  showLocations: boolean
): MonthlyInventoryProduct[] {
  const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
  return [...products].sort((left, right) => {
    if (showLocations) {
      const locationComparison = collator.compare(
        left.stockLocation?.trim() || 'ZZZ Não cadastrado',
        right.stockLocation?.trim() || 'ZZZ Não cadastrado'
      );
      if (locationComparison !== 0) return locationComparison;
    }
    const leftRim = getInventoryProductRim(left);
    const rightRim = getInventoryProductRim(right);
    if (leftRim !== rightRim) {
      if (leftRim === null) return 1;
      if (rightRim === null) return -1;
      return leftRim - rightRim;
    }
    const referenceComparison = collator.compare(left.reference, right.reference);
    return referenceComparison !== 0
      ? referenceComparison
      : collator.compare(left.description, right.description);
  });
}

export function getTireRim(reference: string): number | null {
  const normalized = reference.trim().toUpperCase().replace(/,/g, '.');
  const patterns = [
    /R\s*(\d+(?:\.\d+)?)/g,
    /\/\s*(\d+(?:\.\d+)?)/g,
    /-\s*(\d+(?:\.\d+)?)(?=\s|$)/g,
    /(\d+(?:\.\d+)?)\s*X\s*\d/g,
  ];

  for (const pattern of patterns) {
    const matches = [...normalized.matchAll(pattern)];
    const value = Number(matches.at(-1)?.[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function getInventoryProductRim(
  product: Pick<MonthlyInventoryProduct, 'reference' | 'description'>
): number | null {
  return getTireRim(product.reference) ?? getTireRim(product.description);
}

function formatRim(rim: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(rim);
}

function contentWidth(document: PDFKit.PDFDocument): number {
  return document.page.width - PAGE_MARGIN * 2;
}

function pageBottom(document: PDFKit.PDFDocument): number {
  return document.page.height - CONTENT_BOTTOM_MARGIN;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function formatMonthLabel(date: Date): string {
  const month = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(date).toUpperCase();
  return `${month}/${date.getFullYear()}`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function previousDay(date: Date): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - 1);
  return result;
}
