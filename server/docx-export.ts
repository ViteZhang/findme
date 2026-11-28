import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { PortraitRecord } from './store.ts';

export async function buildPortraitDocxBase64(
  portrait: PortraitRecord,
  includeExcerpts = false,
): Promise<string> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [
        new TextRun({
          text: portrait.headline || `个人优劣势画像 v${portrait.version}`,
          bold: true,
          size: 36,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 280 },
      children: [
        new TextRun({
          text: `${portrait.subtitle}（v${portrait.version} · ${String(
            portrait.confirmed_at || portrait.generated_at,
          ).slice(0, 10)}）`,
          color: '525252',
          size: 22,
        }),
      ],
    }),
  ];

  for (const sec of portrait.sections || []) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 280, after: 120 },
        children: [
          new TextRun({
            text: `${sec.section}. ${sec.title}`,
            bold: true,
            size: 28,
          }),
        ],
      }),
    );

    if (sec.claims && sec.claims.length > 0) {
      for (const cl of sec.claims) {
        children.push(
          new Paragraph({
            spacing: { before: 120, after: 60 },
            children: [
              new TextRun({ text: `【${cl.wording}】`, bold: true, color: '23406E', size: 22 }),
              new TextRun({ text: cl.headline, bold: true, size: 24 }),
              ...(cl.user_edited
                ? [new TextRun({ text: '（你修改过）', color: '737373', size: 20 })]
                : []),
            ],
          }),
          new Paragraph({
            spacing: { after: 60 },
            children: [
              new TextRun({
                text: `依据：${cl.evidence_summary}${cl.scenarios ? ` ｜ 适合场景：${cl.scenarios}` : ''}${cl.tip ? ` ｜ 建议：${cl.tip}` : ''}`,
                color: '525252',
                size: 20,
              }),
            ],
          }),
        );

        if (includeExcerpts && cl.excerpts?.length) {
          for (const ex of cl.excerpts) {
            children.push(
              new Paragraph({
                indent: { left: 360 },
                spacing: { after: 40 },
                children: [
                  new TextRun({
                    text: `· 原话〔${ex.source_type}〕：${ex.deleted ? '来源已删除' : ex.excerpt}`,
                    color: '737373',
                    size: 19,
                  }),
                ],
              }),
            );
          }
        }
      }
    }

    if (sec.values_top5 && sec.values_top5.length > 0) {
      for (const v of sec.values_top5) {
        children.push(
          new Paragraph({
            spacing: { after: 60 },
            children: [
              new TextRun({ text: `${v.rank}. ${v.value}：`, bold: true, size: 22 }),
              new TextRun({ text: v.definition, size: 22 }),
            ],
          }),
        );
      }
    }

    if (sec.energy) {
      children.push(
        new Paragraph({
          spacing: { before: 80, after: 40 },
          children: [new TextRun({ text: '让你充电：', bold: true, size: 22 })],
        }),
      );
      for (const item of sec.energy.charging) {
        children.push(
          new Paragraph({
            indent: { left: 240 },
            children: [new TextRun({ text: `· ${item.text}（${item.badge}）`, size: 21 })],
          }),
        );
      }
      children.push(
        new Paragraph({
          spacing: { before: 80, after: 40 },
          children: [new TextRun({ text: '让你消耗：', bold: true, size: 22 })],
        }),
      );
      for (const item of sec.energy.draining) {
        children.push(
          new Paragraph({
            indent: { left: 240 },
            children: [new TextRun({ text: `· ${item.text}（${item.badge}）`, size: 21 })],
          }),
        );
      }
    }

    if (sec.best_state) {
      for (const [label, val] of [
        ['什么时候', sec.best_state.when],
        ['怎么做', sec.best_state.how],
        ['跟谁一起', sec.best_state.with_whom],
        ['避开', sec.best_state.avoid],
      ]) {
        children.push(
          new Paragraph({
            spacing: { after: 60 },
            children: [
              new TextRun({ text: `${label}：`, bold: true, size: 22 }),
              new TextRun({ text: val, size: 22 }),
            ],
          }),
        );
      }
    }

    if (sec.watch_items && sec.watch_items.length > 0) {
      for (const w of sec.watch_items) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `· ${w.statement}（${w.source_label}${w.tag ? ` · ${w.tag}` : ''}）`,
                size: 21,
              }),
            ],
          }),
        );
      }
    }

    if (sec.diff_note) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: sec.diff_note, color: '525252', size: 21 })],
        }),
      );
    } else if (sec.empty_note) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: sec.empty_note, color: '737373', size: 21 })],
        }),
      );
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer).toString('base64');
}
