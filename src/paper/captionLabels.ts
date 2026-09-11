/** Caption labels as data rather than as a hand-written alternation.
 *
 * Every publisher that broke caption detection used to add one more spelling to
 * a regex literal, which is why the rule only ever worked on the journals we
 * had already opened. The vocabulary lives here instead, the case variants are
 * generated, and the shape of the rule — label, number, separator — is what the
 * matcher actually encodes.
 */

/** Latin-script labels. Written in their normal display form; the matcher also
 * accepts the all-caps and lower-case spellings, so only add a base word. */
export const latinCaptionLabels = [
  'Figure', 'Fig', 'Table', 'Algorithm', 'Scheme', 'Chart', 'Plate', 'Box', 'Listing', 'Panel',
  'Abbildung', 'Abb', 'Tabelle', 'Tab', 'Schema',        // de
  'Tableau', 'Figura', 'Tabla', 'Cuadro', 'Esquema',      // fr, es
  'Quadro', 'Tabela', 'Tabella', 'Grafico',               // pt, it
  'Rysunek', 'Rys', 'Wykres',                             // pl
  'Şekil', 'Çizelge', 'Tablo',                            // tr
  'Afbeelding', 'Tabel', 'Figuur',                        // nl
  'Hình', 'Bảng',                                         // vi
]

/** Labels in scripts without letter case, where no capitalised title follows. */
export const nonLatinCaptionLabels = [
  'Рисунок', 'Рис', 'Таблица', 'Таблиця', 'Табл', 'Схема', // ru, uk
  '図', '表', '図表',                                        // ja
  '图', '圖', '表格',                                        // zh
  '그림', '표', '도표',                                      // ko
]

/** Qualifiers a label may carry before the word itself. */
export const captionPrefixes = ['Extended Data', 'Supplementary', 'Supplemental', 'Supp', 'Appendix', 'Online', 'Дополнительный', '補足']

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A label may be typeset as written, in full caps, or entirely lower case.
// Generating the three spellings keeps the list one word per label while the
// match stays case-sensitive, which is what separates a caption from a running
// reference ("Figure 3 illustrates ...").
const caseVariants = (label: string) => [...new Set([label, label.toUpperCase(), label.toLowerCase()])].map(escape)

const group = (labels: string[]) => labels.flatMap(caseVariants).sort((a, b) => b.length - a.length).join('|')
const prefix = `(?:(?:${captionPrefixes.flatMap(caseVariants).join('|')})\\s+)?`
// "Figure 3.17b", "Table IV", "図 2".
const number = '(?:\\d+(?:[.-]\\d+)*[a-z]?|[IVXLC]+)'
// A dot or colon ends the label; Nature-family journals use a vertical bar; an
// em or en dash counts only when a capitalised title follows, so a parenthetical
// dash in prose ("Fig. 2 - the blue curve - shows") does not start a caption.
const latinTail = '(?:\\s*[.:|](?:\\s|$)|\\s*[—–-]\\s+(?=[A-Z])|\\s*$|\\s+(?=[A-Z]))'
// Scripts without case carry no capitalisation signal, and CJK sets a label
// against its title with no space at all.
const nonLatinTail = '(?:\\s*[.:|、。]?\\s*(?=\\S)|\\s*$)'

// An abbreviated label keeps its own full stop ("Fig. 1", "Рис. 3"), which is
// part of the abbreviation rather than the separator that follows the number.
const abbreviationDot = '\\.?'

export const captionStart = new RegExp(
  `^(?:${prefix}(?:${group(latinCaptionLabels)})${abbreviationDot}\\s*${number}${latinTail}`
  + `|(?:${group(nonLatinCaptionLabels)})${abbreviationDot}\\s*${number}${nonLatinTail})`,
)

/** True when the text opens with a caption label, regardless of what follows.
 * Used where the label alone is the signal and the separator does not matter. */
export const captionLabelOnly = new RegExp(
  `^(?:${prefix}(?:${group(latinCaptionLabels)})|(?:${group(nonLatinCaptionLabels)}))${abbreviationDot}\\s*${number}\\b`,
)
