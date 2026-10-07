// exceljs always rewrites the workbook's default ("Normal") font as Calibri 11.
// Cells that rely on the default font (and Excel's column width units) would then
// change, so we read the template's real default font and put it back afterwards.
import JSZip from 'jszip';

const FIRST_FONT_RE = /(<fonts\b[^>]*>\s*)(<font\b[^>]*\/>|<font\b[^>]*>[\s\S]*?<\/font>)/;

const attr = (xml, tag) => {
  const m = new RegExp(`<${tag}\\b[^>]*\\bval="([^"]*)"`).exec(xml);
  return m ? m[1] : undefined;
};

export async function readDefaultFont(buffer) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const styles = await zip.file('xl/styles.xml')?.async('string');
    const match = styles && FIRST_FONT_RE.exec(styles);
    if (!match) return null;
    const xml = match[2];
    const font = {};
    const name = attr(xml, 'name');
    const size = Number(attr(xml, 'sz'));
    const family = Number(attr(xml, 'family'));
    const scheme = attr(xml, 'scheme');
    const theme = /<color\b[^>]*\btheme="(\d+)"/.exec(xml);
    if (name) font.name = name;
    if (Number.isFinite(size) && size > 0) font.size = size;
    if (Number.isFinite(family) && family > 0) font.family = family;
    if (scheme) font.scheme = scheme;
    if (theme) font.color = { theme: Number(theme[1]) };
    return { xml, font };
  } catch {
    return null;
  }
}

export async function restoreDefaultFont(outBuffer, fontXml) {
  if (!fontXml) return outBuffer;
  try {
    const zip = await JSZip.loadAsync(outBuffer);
    const file = zip.file('xl/styles.xml');
    if (!file) return outBuffer;
    const styles = await file.async('string');
    if (!FIRST_FONT_RE.test(styles)) return outBuffer;
    zip.file('xl/styles.xml', styles.replace(FIRST_FONT_RE, (_, open) => open + fontXml));
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  } catch {
    return outBuffer;
  }
}
