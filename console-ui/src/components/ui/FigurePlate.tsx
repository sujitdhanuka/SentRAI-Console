import { ReactNode } from 'react';

/**
 * A blueprint plate (SR-DL-001 · P3 "Figures are plates"). Figures are the
 * brand's hero imagery, so a plate is ALWAYS the Prussian ground with pale
 * cyan line-work — independent of the console theme — and it always carries a
 * title block (figure no. · title · scale · revision · ref). Content passed as
 * children is expected to draw in the plate palette (cyan #B9D6EC line-work,
 * white for emphasis).
 */
export const PLATE = {
  ground: '#0E2A4E',
  line: '#B9D6EC',
  dim: '#4E7196',
  white: '#ffffff',
  verify: '#7FB3A0',
} as const;

interface Field {
  label: string;
  value: string;
}

const gridBg =
  'repeating-linear-gradient(0deg, rgba(185,214,236,.06) 0 1px, transparent 1px 24px),' +
  'repeating-linear-gradient(90deg, rgba(185,214,236,.06) 0 1px, transparent 1px 24px),' +
  '#0E2A4E';

export function FigurePlate({
  fig,
  title,
  fields = [],
  caption,
  children,
}: {
  fig: string;
  title: string;
  fields?: Field[];
  caption?: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className="m-0">
      <div
        className="overflow-hidden rounded"
        style={{ background: gridBg, border: '1px solid #17456f', color: PLATE.line }}
      >
        <div className="p-4">{children}</div>
        <div
          className="flex flex-wrap font-mono text-[9px] tracking-[.08em]"
          style={{ borderTop: '1px solid rgba(185,214,236,.35)' }}
        >
          <TitleCell label="FIG" value={fig} />
          <TitleCell value={title} />
          {fields.map((f) => (
            <TitleCell key={f.label} label={f.label} value={f.value} />
          ))}
        </div>
      </div>
      {caption && (
        <figcaption className="mt-1.5 max-w-[70ch] font-mono text-[9.5px] leading-snug text-text-tertiary">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

function TitleCell({ label, value }: { label?: string; value: string }) {
  return (
    <div
      className="px-3 py-2"
      style={{ borderRight: '1px solid rgba(185,214,236,.35)' }}
    >
      {label && (
        <b className="block font-semibold tracking-[.1em]" style={{ color: PLATE.white }}>
          {label}
        </b>
      )}
      <span style={{ color: PLATE.dim }}>{value}</span>
    </div>
  );
}
